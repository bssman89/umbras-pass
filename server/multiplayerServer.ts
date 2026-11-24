import crypto from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import type express from 'express';
import {
  applyMultiplayerCors,
  getClientSocketIp,
  isLoopbackHostCaller,
  isPrivateOrLanCaller,
  isPrivateOrReservedIpv4,
  isSafeCardOrPlaymatImageUrl,
  requireLocalhostOnly,
  sanitizeRemoteMessage,
} from './networkSecurity.ts';
import type {
  MultiplayerActionLogEntry,
  MultiplayerBotSeatConfig,
  MultiplayerCardInstance,
  MultiplayerChatMessage,
  MultiplayerConnectionMode,
  MultiplayerDeckSummary,
  MultiplayerGameActionPayload,
  MultiplayerJoinRequest,
  MultiplayerResolvedStackRecord,
  MultiplayerRoomClientView,
  MultiplayerRoomStatus,
  MultiplayerSeat,
  MultiplayerSeatGameState,
  MultiplayerSeatKind,
  MultiplayerStackEntry,
  MultiplayerTabletopPhase,
  MultiplayerTabletopState,
  NetworkDiagnosticsReport,
  NetworkLanInterface,
} from '../src/types/multiplayer.ts';
import {
  clampPlaymatX,
  clampPlaymatY,
  computeOpenBotPlaymatSpot,
  computeOpenPlayerPlaymatSpot,
  getNextPlaymatZ,
  isBacklinePlaymatCard,
  tidyBotPlaymatPositions,
  tidyPlayerPlaymatPositions,
} from '../src/utils/playmatPositioning.ts';

interface InternalSeatGameState extends MultiplayerSeatGameState {
  library: MultiplayerCardInstance[];
}

interface InternalTabletopState extends Omit<MultiplayerTabletopState, 'seats'> {
  seats: InternalSeatGameState[];
}

interface InternalJoinRequest extends MultiplayerJoinRequest {
  requestToken: string;
  seatToken?: string;
}

interface InternalMultiplayerRoom {
  roomId: string;
  roomCode: string;
  roomName: string;
  connectionMode: MultiplayerConnectionMode;
  format: string;
  maxSeats: 1 | 2 | 3 | 4;
  requireHostApproval: boolean;
  status: MultiplayerRoomStatus;
  createdAt: string;
  passcodeSalt: string;
  passcodeHash: string;
  hostSeatToken: string;
  seatTokensByIndex: Map<number, string>;
  seats: MultiplayerSeat[];
  pendingJoinRequests: InternalJoinRequest[];
  tabletop: InternalTabletopState | null;
  chatMessages: MultiplayerChatMessage[];
  processedActionIds: Set<string>;
  sseSubscribers: Map<
    string,
    {
      res: express.Response;
      seatIndex: number | null;
      isHost: boolean;
    }
  >;
  stateVersion: number;
  tabletopThemeId?: string;
  tabletopArtworkPresetId?: string;
  tabletopCustomImageUrl?: string;
}

interface OneTimeSseTicket {
  roomCode: string;
  seatIndex: number | null;
  isHost: boolean;
  expiresAt: number;
}

const roomsByCode = new Map<string, InternalMultiplayerRoom>();
const failedJoinAttemptsByKey = new Map<string, { count: number; resetAt: number }>();
const lookupAttemptsByIp = new Map<string, { count: number; resetAt: number }>();
const sseTicketsById = new Map<string, OneTimeSseTicket>();
let cachedPublicIpv4: { ip: string; fetchedAt: number } | null = null;

const PRESET_BOT_DECKS: Record<
  string,
  Array<{
    name: string;
    typeLine: string;
    manaCost: string;
    cmc: number;
    oracleText: string;
    power?: string;
    toughness?: string;
    isCommander?: boolean;
  }>
> = {
  'Mono-Red Aggro / Burn': [
    {
      name: 'Krenko, Mob Boss',
      typeLine: 'Legendary Creature — Goblin Warrior',
      manaCost: '{2}{R}{R}',
      cmc: 4,
      oracleText: '{T}: Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control.',
      power: '3',
      toughness: '3',
      isCommander: true,
    },
    {
      name: 'Mountain',
      typeLine: 'Basic Land — Mountain',
      manaCost: '',
      cmc: 0,
      oracleText: '({T}: Add {R}.)',
    },
    {
      name: 'Monastery Swiftspear',
      typeLine: 'Creature — Human Monk',
      manaCost: '{R}',
      cmc: 1,
      oracleText: 'Haste, Prowess. Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn.',
      power: '1',
      toughness: '2',
    },
    {
      name: 'Goblin Guide',
      typeLine: 'Creature — Goblin Scout',
      manaCost: '{R}',
      cmc: 1,
      oracleText: 'Haste. Whenever Goblin Guide attacks, defending player reveals the top card of their library.',
      power: '2',
      toughness: '2',
    },
    {
      name: 'Lightning Bolt',
      typeLine: 'Instant',
      manaCost: '{R}',
      cmc: 1,
      oracleText: 'Lightning Bolt deals 3 damage to any target.',
    },
    {
      name: 'Eidolon of the Great Revel',
      typeLine: 'Enchantment Creature — Spirit',
      manaCost: '{R}{R}',
      cmc: 2,
      oracleText: 'Whenever a player casts a spell with mana value 3 or less, Eidolon deals 2 damage to that player.',
      power: '2',
      toughness: '2',
    },
    {
      name: 'Bonecrusher Giant',
      typeLine: 'Creature — Giant',
      manaCost: '{2}{R}',
      cmc: 3,
      oracleText: 'When Bonecrusher Giant enters the battlefield or becomes the target of a spell, it deals 2 damage.',
      power: '4',
      toughness: '3',
    },
    {
      name: 'Torbran, Thane of Red Fell',
      typeLine: 'Legendary Creature — Dwarf Noble',
      manaCost: '{1}{R}{R}{R}',
      cmc: 4,
      oracleText: 'If a red source you control would deal damage to an opponent or permanent, it deals that much damage plus 2 instead.',
      power: '2',
      toughness: '4',
    },
  ],
  'Azorius Control & Countermagic': [
    {
      name: 'Grand Arbiter Augustin IV',
      typeLine: 'Legendary Creature — Human Advisor',
      manaCost: '{2}{W}{U}',
      cmc: 4,
      oracleText: 'White and blue spells you cast cost {1} less to cast. Spells your opponents cast cost {1} more to cast.',
      power: '2',
      toughness: '3',
      isCommander: true,
    },
    {
      name: 'Hallowed Fountain',
      typeLine: 'Land — Plains Island',
      manaCost: '',
      cmc: 0,
      oracleText: '({T}: Add {W} or {U}.)',
    },
    {
      name: 'Counterspell',
      typeLine: 'Instant',
      manaCost: '{U}{U}',
      cmc: 2,
      oracleText: 'Counter target spell.',
    },
    {
      name: 'Swords to Plowshares',
      typeLine: 'Instant',
      manaCost: '{W}',
      cmc: 1,
      oracleText: 'Exile target creature. Its controller gains life equal to its power.',
    },
    {
      name: 'Mulldrifter',
      typeLine: 'Creature — Elemental',
      manaCost: '{4}{U}',
      cmc: 5,
      oracleText: 'Flying. When Mulldrifter enters the battlefield, draw two cards.',
      power: '2',
      toughness: '2',
    },
    {
      name: 'Archmage Emeritus',
      typeLine: 'Creature — Human Wizard',
      manaCost: '{2}{U}{U}',
      cmc: 4,
      oracleText: 'Magecraft — Whenever you cast or copy an instant or sorcery spell, draw a card.',
      power: '2',
      toughness: '2',
    },
    {
      name: 'Supreme Verdict',
      typeLine: 'Sorcery',
      manaCost: '{1}{W}{W}{U}',
      cmc: 4,
      oracleText: 'This spell cannot be countered. Destroy all creatures.',
    },
  ],
  'Simic Landfall & Ramp': [
    {
      name: 'Tatyova, Benthic Druid',
      typeLine: 'Legendary Creature — Merfolk Druid',
      manaCost: '{3}{G}{U}',
      cmc: 5,
      oracleText: 'Landfall — Whenever a land enters the battlefield under your control, you gain 1 life and draw a card.',
      power: '3',
      toughness: '3',
      isCommander: true,
    },
    {
      name: 'Breeding Pool',
      typeLine: 'Land — Forest Island',
      manaCost: '',
      cmc: 0,
      oracleText: '({T}: Add {G} or {U}.)',
    },
    {
      name: 'Lotus Cobra',
      typeLine: 'Creature — Snake',
      manaCost: '{1}{G}',
      cmc: 2,
      oracleText: 'Landfall — Whenever a land enters the battlefield under your control, add one mana of any color.',
      power: '2',
      toughness: '1',
    },
    {
      name: 'Scute Swarm',
      typeLine: 'Creature — Insect',
      manaCost: '{2}{G}',
      cmc: 3,
      oracleText: 'Landfall — Whenever a land enters the battlefield under your control, create a 1/1 green Insect creature token.',
      power: '1',
      toughness: '1',
    },
    {
      name: 'Coiling Oracle',
      typeLine: 'Creature — Snake Elf Druid',
      manaCost: '{G}{U}',
      cmc: 2,
      oracleText: 'When Coiling Oracle enters the battlefield, reveal the top card of your library. If it is a land card, put it onto the battlefield.',
      power: '1',
      toughness: '1',
    },
    {
      name: 'Avenger of Zendikar',
      typeLine: 'Creature — Elemental',
      manaCost: '{5}{G}{G}',
      cmc: 7,
      oracleText: 'When Avenger of Zendikar enters the battlefield, create a 0/1 green Plant creature token for each land you control.',
      power: '5',
      toughness: '5',
    },
  ],
  'Golgari Graveyard Value': [
    {
      name: 'Meren of Clan Nel Toth',
      typeLine: 'Legendary Creature — Human Shaman',
      manaCost: '{2}{B}{G}',
      cmc: 4,
      oracleText: 'Whenever another creature you control dies, you get an experience counter. At the beginning of your end step, return a creature from your graveyard.',
      power: '3',
      toughness: '4',
      isCommander: true,
    },
    {
      name: 'Overgrown Tomb',
      typeLine: 'Land — Swamp Forest',
      manaCost: '',
      cmc: 0,
      oracleText: '({T}: Add {B} or {G}.)',
    },
    {
      name: 'Ravenous Chupacabra',
      typeLine: 'Creature — Beast Horror',
      manaCost: '{2}{B}{B}',
      cmc: 4,
      oracleText: 'When Ravenous Chupacabra enters the battlefield, destroy target creature an opponent controls.',
      power: '2',
      toughness: '2',
    },
    {
      name: 'Blood Artist',
      typeLine: 'Creature — Vampire',
      manaCost: '{1}{B}',
      cmc: 2,
      oracleText: 'Whenever Blood Artist or another creature dies, target player loses 1 life and you gain 1 life.',
      power: '0',
      toughness: '1',
    },
    {
      name: 'Sakura-Tribe Elder',
      typeLine: 'Creature — Snake Shaman',
      manaCost: '{1}{G}',
      cmc: 2,
      oracleText: 'Sacrifice Sakura-Tribe Elder: Search your library for a basic land card, put that card onto the battlefield tapped.',
      power: '1',
      toughness: '1',
    },
  ],
};

function generateRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 20; attempt++) {
    let suffix = '';
    const bytes = crypto.randomBytes(4);
    for (let i = 0; i < 4; i++) {
      suffix += alphabet[bytes[i] % alphabet.length];
    }
    const candidate = `UP-${suffix}`;
    if (!roomsByCode.has(candidate)) {
      return candidate;
    }
  }
  return `UP-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function hashPasscode(passcode: string, saltHex?: string): { salt: string; hash: string } {
  const salt = saltHex || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(passcode.trim(), salt, 32).toString('hex');
  return { salt, hash: derived };
}

function verifyPasscodeConstantTime(passcode: string, saltHex: string, expectedHashHex: string): boolean {
  try {
    const derived = crypto.scryptSync(passcode.trim(), saltHex, 32);
    const expected = Buffer.from(expectedHashHex, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

function checkAndIncrementLookupRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = lookupAttemptsByIp.get(ip);
  if (!entry || now > entry.resetAt) {
    lookupAttemptsByIp.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= 20) {
    return false;
  }
  entry.count += 1;
  return true;
}

function checkAndIncrementRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = failedJoinAttemptsByKey.get(key);
  if (!entry || now > entry.resetAt) {
    failedJoinAttemptsByKey.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= 8) {
    return false;
  }
  entry.count += 1;
  return true;
}

function clearRateLimit(key: string): void {
  failedJoinAttemptsByKey.delete(key);
}

function extractBearerToken(req: express.Request): string {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  return '';
}

function issueOneTimeSseTicket(
  roomCode: string,
  seatIndex: number | null,
  isHost: boolean
): string {
  const now = Date.now();
  for (const [id, item] of sseTicketsById.entries()) {
    if (now > item.expiresAt) {
      sseTicketsById.delete(id);
    }
  }
  const ticket = crypto.randomBytes(24).toString('hex');
  sseTicketsById.set(ticket, {
    roomCode,
    seatIndex,
    isHost,
    expiresAt: now + 30_000,
  });
  return ticket;
}

function consumeOneTimeSseTicket(
  ticket: string,
  expectedRoomCode: string
): { seatIndex: number | null; isHost: boolean } | null {
  const clean = ticket.trim();
  if (!clean) return null;
  const entry = sseTicketsById.get(clean);
  if (!entry) return null;
  sseTicketsById.delete(clean);
  if (Date.now() > entry.expiresAt || entry.roomCode !== expectedRoomCode) {
    return null;
  }
  return { seatIndex: entry.seatIndex, isHost: entry.isHost };
}

function sanitizeIncomingDeckSummary(
  deckSummary: MultiplayerDeckSummary | undefined,
  fallbackName: string,
  fallbackFormat: string
): MultiplayerDeckSummary {
  if (!deckSummary || !Array.isArray(deckSummary.cards)) {
    return {
      deckName: fallbackName.slice(0, 48),
      format: fallbackFormat,
      cardCount: 60,
      commanders: [],
      cards: [],
    };
  }

  const sanitizedCards = deckSummary.cards.slice(0, 130).map((c) => ({
    name: String(c?.name || 'Card').slice(0, 80),
    quantity: Math.max(1, Math.min(99, Number(c?.quantity) || 1)),
    isCommander: Boolean(c?.isCommander),
    typeLine: typeof c?.typeLine === 'string' ? c.typeLine.slice(0, 80) : undefined,
    manaCost: typeof c?.manaCost === 'string' ? c.manaCost.slice(0, 32) : undefined,
    cmc: typeof c?.cmc === 'number' && Number.isFinite(c.cmc) ? Math.max(0, c.cmc) : undefined,
    oracleText: typeof c?.oracleText === 'string' ? c.oracleText.slice(0, 600) : undefined,
    imageUri: isSafeCardOrPlaymatImageUrl(c?.imageUri) ? c.imageUri.slice(0, 600_000) : undefined,
    power: typeof c?.power === 'string' ? c.power.slice(0, 8) : undefined,
    toughness: typeof c?.toughness === 'string' ? c.toughness.slice(0, 8) : undefined,
    displayTitle: typeof c?.displayTitle === 'string' ? c.displayTitle.slice(0, 64) : undefined,
    isProxy: Boolean(c?.isProxy),
    proxyBadgeLabel:
      c?.proxyBadgeLabel === 'PROXY' ||
      c?.proxyBadgeLabel === 'ALT ART' ||
      c?.proxyBadgeLabel === 'CUSTOM' ||
      c?.proxyBadgeLabel === 'TOKEN'
        ? c.proxyBadgeLabel
        : undefined,
    frameStyle:
      c?.frameStyle === 'standard' ||
      c?.frameStyle === 'full-art' ||
      c?.frameStyle === 'retro' ||
      c?.frameStyle === 'gold-foil'
        ? c.frameStyle
        : undefined,
  }));

  return {
    deckName: String(deckSummary.deckName || fallbackName).slice(0, 48),
    format: String(deckSummary.format || fallbackFormat).slice(0, 32),
    cardCount: Math.max(0, Math.min(300, Number(deckSummary.cardCount) || sanitizedCards.length)),
    commanders: Array.isArray(deckSummary.commanders)
      ? deckSummary.commanders.slice(0, 4).map((n) => String(n).slice(0, 80))
      : [],
    cards: sanitizedCards,
  };
}

function resolveCallerRole(
  room: InternalMultiplayerRoom,
  token: string
): { isHost: boolean; seatIndex: number | null; requestId: string | null } {
  if (!token) {
    return { isHost: false, seatIndex: null, requestId: null };
  }
  if (token === room.hostSeatToken) {
    return { isHost: true, seatIndex: 0, requestId: null };
  }
  for (const [seatIdx, seatTok] of room.seatTokensByIndex.entries()) {
    if (seatTok === token) {
      return { isHost: seatIdx === 0, seatIndex: seatIdx, requestId: null };
    }
  }
  return { isHost: false, seatIndex: null, requestId: null };
}

function getRoomDefaultStartingLife(format: string, maxSeats: number): number {
  const lower = (format || '').toLowerCase();
  return maxSeats > 2 || lower.includes('commander') || lower.includes('brawl') ? 40 : 20;
}

function buildClientViewForCaller(
  room: InternalMultiplayerRoom,
  callerSeatIndex: number | null,
  isHost: boolean
): MultiplayerRoomClientView {
  const defaultLife = getRoomDefaultStartingLife(room.format, room.maxSeats);
  const seatLifeTotals: [number, number, number, number] = [
    typeof room.seats[0]?.lifeTotal === 'number' ? room.seats[0].lifeTotal : defaultLife,
    typeof room.seats[1]?.lifeTotal === 'number' ? room.seats[1].lifeTotal : defaultLife,
    typeof room.seats[2]?.lifeTotal === 'number' ? room.seats[2].lifeTotal : defaultLife,
    typeof room.seats[3]?.lifeTotal === 'number' ? room.seats[3].lifeTotal : defaultLife,
  ];
  let redactedTabletop: MultiplayerTabletopState | null = null;
  if (room.tabletop) {
    redactedTabletop = {
      matchId: room.tabletop.matchId,
      turnNumber: room.tabletop.turnNumber,
      activeSeatIndex: room.tabletop.activeSeatIndex,
      prioritySeatIndex: room.tabletop.prioritySeatIndex,
      phase: room.tabletop.phase,
      startingLife: room.tabletop.startingLife,
      stack: room.tabletop.stack,
      resolvedHistory: room.tabletop.resolvedHistory,
      actionLog: room.tabletop.actionLog,
      winnerSeatIndex: room.tabletop.winnerSeatIndex,
      winReason: room.tabletop.winReason,
      seats: room.tabletop.seats.map((seatState) => {
        const isCallerOwnSeat = callerSeatIndex === seatState.seatIndex;
        return {
          seatIndex: seatState.seatIndex,
          playerName: seatState.playerName,
          kind: seatState.kind,
          life: seatState.life,
          poison: seatState.poison,
          commanderTax: seatState.commanderTax,
          commanderCasts: seatState.commanderCasts,
          commanderDamageBySeat: seatState.commanderDamageBySeat,
          manaPool: seatState.manaPool,
          landsPlayedThisTurn: seatState.landsPlayedThisTurn,
          mulliganCount: seatState.mulliganCount,
          handCount: seatState.hand.length,
          libraryCount: seatState.library.length,
          hand: isCallerOwnSeat ? seatState.hand : [],
          battlefield: seatState.battlefield,
          commandZone: seatState.commandZone,
          graveyard: seatState.graveyard,
          exile: seatState.exile,
          isEliminated: seatState.isEliminated,
          eliminationReason: seatState.eliminationReason,
        };
      }),
    };
  }

  const sanitizedRequests: MultiplayerJoinRequest[] = isHost
    ? room.pendingJoinRequests.map((r) => ({
        requestId: r.requestId,
        playerName: r.playerName,
        deckSummary: r.deckSummary,
        requestedAt: r.requestedAt,
        status: r.status,
        assignedSeatIndex: r.assignedSeatIndex,
        preferredSeatIndex: r.preferredSeatIndex,
        passcodeVerified: true,
      }))
    : [];

  return {
    roomId: room.roomId,
    roomCode: room.roomCode,
    roomName: room.roomName,
    connectionMode: room.connectionMode,
    format: room.format,
    maxSeats: room.maxSeats,
    requireHostApproval: room.requireHostApproval,
    status: room.status,
    createdAt: room.createdAt,
    callerSeatIndex,
    isHost,
    seats: room.seats.slice(0, room.maxSeats),
    seatLifeTotals,
    pendingJoinRequests: sanitizedRequests,
    tabletop: redactedTabletop,
    chatMessages: room.chatMessages.slice(-60),
    stateVersion: room.stateVersion,
    tabletopThemeId: room.tabletopThemeId,
    tabletopArtworkPresetId: room.tabletopArtworkPresetId,
    tabletopCustomImageUrl: room.tabletopCustomImageUrl,
  };
}

function broadcastRoomState(room: InternalMultiplayerRoom): void {
  room.stateVersion += 1;
  for (const [subId, sub] of room.sseSubscribers.entries()) {
    try {
      const view = buildClientViewForCaller(room, sub.seatIndex, sub.isHost);
      sub.res.write(`data: ${JSON.stringify(view)}\n\n`);
    } catch {
      room.sseSubscribers.delete(subId);
    }
  }
}

function shuffleCards<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}

function buildSeatDeckInstances(
  seat: MultiplayerSeat,
  seatIndex: number
): { commandZone: MultiplayerCardInstance[]; library: MultiplayerCardInstance[] } {
  const commandZone: MultiplayerCardInstance[] = [];
  const library: MultiplayerCardInstance[] = [];
  let uidCounter = 1;

  if (seat.kind === 'bot' || !seat.deckSummary || seat.deckSummary.cards.length === 0) {
    const archetypeKey = seat.botConfig?.archetype || 'Mono-Red Aggro / Burn';
    const template =
      PRESET_BOT_DECKS[archetypeKey] || PRESET_BOT_DECKS['Mono-Red Aggro / Burn'];

    for (const entry of template) {
      if (entry.isCommander) {
        commandZone.push({
          uid: `s${seatIndex}_cmd_${uidCounter++}`,
          name: entry.name,
          typeLine: entry.typeLine,
          manaCost: entry.manaCost,
          cmc: entry.cmc,
          oracleText: entry.oracleText,
          imageUri: `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(
            entry.name.split('//')[0].trim()
          )}&format=image&version=normal`,
          power: entry.power,
          toughness: entry.toughness,
          tapped: false,
          counters: 0,
          summoningSick: false,
          isCommander: true,
          attackingSeatIndex: null,
        });
      }
    }

    const basicTemplate = template.find((c) => c.typeLine.toLowerCase().includes('land')) || {
      name: 'Mountain',
      typeLine: 'Basic Land — Mountain',
      manaCost: '',
      cmc: 0,
      oracleText: '({T}: Add {R}.)',
    };
    const nonLands = template.filter((c) => !c.isCommander && !c.typeLine.toLowerCase().includes('land'));

    for (let i = 0; i < 24; i++) {
      library.push({
        uid: `s${seatIndex}_lib_${uidCounter++}`,
        name: basicTemplate.name,
        typeLine: basicTemplate.typeLine,
        manaCost: '',
        cmc: 0,
        oracleText: basicTemplate.oracleText,
        imageUri: `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(
          basicTemplate.name.split('//')[0].trim()
        )}&format=image&version=normal`,
        tapped: false,
        counters: 0,
        summoningSick: false,
        isCommander: false,
        attackingSeatIndex: null,
      });
    }

    for (let i = 0; i < 36; i++) {
      const pick = nonLands[i % Math.max(1, nonLands.length)];
      if (!pick) continue;
      library.push({
        uid: `s${seatIndex}_lib_${uidCounter++}`,
        name: pick.name,
        typeLine: pick.typeLine,
        manaCost: pick.manaCost,
        cmc: pick.cmc,
        oracleText: pick.oracleText,
        imageUri: `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(
          pick.name.split('//')[0].trim()
        )}&format=image&version=normal`,
        power: pick.power,
        toughness: pick.toughness,
        tapped: false,
        counters: 0,
        summoningSick: false,
        isCommander: false,
        attackingSeatIndex: null,
      });
    }

    return { commandZone, library: shuffleCards(library) };
  }

  for (const card of seat.deckSummary.cards) {
    const qty = Math.max(1, Math.min(99, Number(card.quantity) || 1));
    const isCmd = Boolean(card.isCommander || seat.deckSummary.commanders.includes(card.name));
    const resolvedImg =
      card.imageUri ||
      `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(
        card.name.split('//')[0].trim()
      )}&format=image&version=normal`;
    for (let c = 0; c < qty; c++) {
      const inst: MultiplayerCardInstance = {
        uid: `s${seatIndex}_${isCmd && c === 0 ? 'cmd' : 'card'}_${uidCounter++}`,
        name: card.name,
        typeLine: card.typeLine || (card.cmc === 0 && !card.manaCost ? 'Land' : 'Spell'),
        manaCost: card.manaCost || '',
        cmc: Number(card.cmc) || 0,
        oracleText: card.oracleText || '',
        imageUri: resolvedImg,
        power: card.power,
        toughness: card.toughness,
        tapped: false,
        counters: 0,
        summoningSick: false,
        isCommander: isCmd && c === 0,
        attackingSeatIndex: null,
        displayTitle: card.displayTitle,
        isProxy: Boolean(card.isProxy),
        proxyBadgeLabel: card.proxyBadgeLabel,
        frameStyle: card.frameStyle,
      };
      if (isCmd && c === 0) {
        commandZone.push(inst);
      } else {
        library.push(inst);
      }
    }
  }

  return { commandZone, library: shuffleCards(library) };
}

function appendActionLog(
  tabletop: InternalTabletopState,
  seatIndex: number,
  seatName: string,
  message: string
): void {
  const entry: MultiplayerActionLogEntry = {
    id: `act_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
    turnNumber: tabletop.turnNumber,
    phase: tabletop.phase,
    seatIndex,
    seatName,
    message,
    timestamp: new Date().toISOString(),
  };
  tabletop.actionLog.push(entry);
  if (tabletop.actionLog.length > 90) {
    tabletop.actionLog.splice(0, tabletop.actionLog.length - 90);
  }
}

function checkStateBasedEliminations(tabletop: InternalTabletopState): void {
  for (const seat of tabletop.seats) {
    if (seat.isEliminated) continue;
    if (seat.life <= 0) {
      seat.isEliminated = true;
      seat.eliminationReason = 'Reduced to 0 life (CR 704.5a)';
      appendActionLog(tabletop, seat.seatIndex, seat.playerName, `${seat.playerName} was eliminated at ${seat.life} life.`);
    } else if (seat.poison >= 10) {
      seat.isEliminated = true;
      seat.eliminationReason = '10+ Poison Counters (CR 704.5c)';
      appendActionLog(tabletop, seat.seatIndex, seat.playerName, `${seat.playerName} was eliminated with ${seat.poison} poison counters.`);
    }
  }

  const remaining = tabletop.seats.filter((s) => !s.isEliminated);
  if (remaining.length === 1 && tabletop.seats.length > 1) {
    tabletop.winnerSeatIndex = remaining[0].seatIndex;
    tabletop.winReason = `${remaining[0].playerName} wins the match!`;
  }
}

function detectTriggersOnEvent(
  tabletop: InternalTabletopState,
  seat: InternalSeatGameState,
  sourceCard: MultiplayerCardInstance,
  eventKind: 'etb' | 'landfall' | 'cast'
): void {
  const lowerOracle = (sourceCard.oracleText || '').toLowerCase();

  if (
    eventKind === 'etb' &&
    (lowerOracle.includes('when ' + sourceCard.name.toLowerCase().split(',')[0] + ' enters') ||
      lowerOracle.includes('enters the battlefield') ||
      lowerOracle.includes('when this creature enters'))
  ) {
    const clauseMatch = sourceCard.oracleText.match(/([^.]*enters[^.]*\.)/i);
    const summary = clauseMatch ? clauseMatch[1].trim() : `ETB triggered ability of ${sourceCard.name}`;
    tabletop.stack.push({
      id: `stk_trig_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
      seatIndex: seat.seatIndex,
      seatName: seat.playerName,
      cardName: `${sourceCard.name} — ETB Trigger`,
      kind: 'triggered-ability',
      effectSummary: summary,
      triggerCondition: 'When this permanent enters the battlefield (CR 603.2)',
      imageUri: sourceCard.imageUri,
      createdAt: new Date().toISOString(),
    });
    appendActionLog(
      tabletop,
      seat.seatIndex,
      seat.playerName,
      `Triggered ability pushed to Stack: ${sourceCard.name} (ETB).`
    );
  }

  if (eventKind === 'landfall') {
    for (const perm of seat.battlefield) {
      const permOracle = (perm.oracleText || '').toLowerCase();
      if (
        permOracle.includes('landfall') ||
        permOracle.includes('whenever a land enters the battlefield under your control')
      ) {
        const clauseMatch = perm.oracleText.match(/([^.]*land enters[^.]*\.)/i);
        tabletop.stack.push({
          id: `stk_lf_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
          seatIndex: seat.seatIndex,
          seatName: seat.playerName,
          cardName: `${perm.name} — Landfall Trigger`,
          kind: 'triggered-ability',
          effectSummary: clauseMatch
            ? clauseMatch[1].trim()
            : `Landfall triggered ability from ${perm.name}`,
          triggerCondition: `Landfall — ${sourceCard.name} entered the battlefield`,
          imageUri: perm.imageUri,
          createdAt: new Date().toISOString(),
        });
        appendActionLog(
          tabletop,
          seat.seatIndex,
          seat.playerName,
          `Landfall trigger queued from ${perm.name}.`
        );
      }
    }
  }

  if (eventKind === 'cast') {
    for (const perm of seat.battlefield) {
      const permOracle = (perm.oracleText || '').toLowerCase();
      if (
        permOracle.includes('whenever you cast a') ||
        permOracle.includes('magecraft') ||
        permOracle.includes('prowess')
      ) {
        const clauseMatch = perm.oracleText.match(/([^.]*whenever you cast[^.]*\.)/i);
        tabletop.stack.push({
          id: `stk_cast_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
          seatIndex: seat.seatIndex,
          seatName: seat.playerName,
          cardName: `${perm.name} — Cast Trigger`,
          kind: 'triggered-ability',
          effectSummary: clauseMatch
            ? clauseMatch[1].trim()
            : `On-cast triggered ability from ${perm.name}`,
          triggerCondition: `Whenever you cast a spell (${sourceCard.name})`,
          imageUri: perm.imageUri,
          createdAt: new Date().toISOString(),
        });
      }
    }
  }
}

function resolveTopStackItem(tabletop: InternalTabletopState): void {
  const top = tabletop.stack.pop();
  if (!top) return;

  const controllerSeat = tabletop.seats.find((s) => s.seatIndex === top.seatIndex);
  if (!controllerSeat) return;

  if (top.countered) {
    if (top.cardPayload) {
      controllerSeat.graveyard.unshift(top.cardPayload);
    }
    tabletop.resolvedHistory.unshift({
      id: top.id,
      turnNumber: tabletop.turnNumber,
      seatName: top.seatName,
      cardName: top.cardName,
      kind: top.kind,
      summary: `Countered${top.counteredBy ? ` by ${top.counteredBy}` : ''}.`,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const lowerEffect = (top.effectSummary || '').toLowerCase();

  if (top.kind === 'spell' && top.cardPayload) {
    const card = top.cardPayload;
    const lowerType = (card.typeLine || '').toLowerCase();
    const isPermanent =
      lowerType.includes('creature') ||
      lowerType.includes('artifact') ||
      lowerType.includes('enchantment') ||
      lowerType.includes('planeswalker') ||
      lowerType.includes('battle');

    if (isPermanent) {
      card.summoningSick = lowerType.includes('creature') && !lowerEffect.includes('haste');
      const isBack = isBacklinePlaymatCard(card);
      const hasPresetCoords =
        typeof card.playmatX === 'number' && typeof card.playmatY === 'number';
      const spot = hasPresetCoords
        ? {
            x: clampPlaymatX(card.playmatX as number),
            y: clampPlaymatY(card.playmatY as number),
            z: getNextPlaymatZ(controllerSeat.battlefield),
          }
        : controllerSeat.kind === 'bot'
        ? computeOpenBotPlaymatSpot(controllerSeat.battlefield, {
            isBackline: isBack,
            preferFront: true,
          })
        : computeOpenPlayerPlaymatSpot(controllerSeat.battlefield, isBack);
      card.playmatX = spot.x;
      card.playmatY = spot.y;
      card.playmatZ = spot.z;
      controllerSeat.battlefield.push(card);
      appendActionLog(
        tabletop,
        controllerSeat.seatIndex,
        controllerSeat.playerName,
        `${card.name} resolved and entered the battlefield.`
      );
      detectTriggersOnEvent(tabletop, controllerSeat, card, 'etb');
    } else {
      if (lowerEffect.includes('draw two cards') && controllerSeat.library.length >= 2) {
        const c1 = controllerSeat.library.shift();
        const c2 = controllerSeat.library.shift();
        if (c1) controllerSeat.hand.push(c1);
        if (c2) controllerSeat.hand.push(c2);
      } else if (lowerEffect.includes('draw a card') && controllerSeat.library.length >= 1) {
        const c1 = controllerSeat.library.shift();
        if (c1) controllerSeat.hand.push(c1);
      }

      if (lowerEffect.includes('deals 3 damage')) {
        const opp = tabletop.seats.find(
          (s) => s.seatIndex !== controllerSeat.seatIndex && !s.isEliminated
        );
        if (opp) {
          opp.life -= 3;
          appendActionLog(
            tabletop,
            controllerSeat.seatIndex,
            controllerSeat.playerName,
            `${card.name} dealt 3 damage to ${opp.playerName} (${opp.life} life).`
          );
        }
      }
      controllerSeat.graveyard.unshift(card);
      appendActionLog(
        tabletop,
        controllerSeat.seatIndex,
        controllerSeat.playerName,
        `${card.name} resolved.`
      );
    }
  } else {
    // Triggered or Activated Ability resolution
    if (lowerEffect.includes('draw two cards')) {
      for (let i = 0; i < 2; i++) {
        const drawn = controllerSeat.library.shift();
        if (drawn) controllerSeat.hand.push(drawn);
      }
    } else if (lowerEffect.includes('draw a card')) {
      const drawn = controllerSeat.library.shift();
      if (drawn) controllerSeat.hand.push(drawn);
    }
    if (lowerEffect.includes('gain 1 life')) {
      controllerSeat.life += 1;
    } else if (lowerEffect.includes('gain 2 life')) {
      controllerSeat.life += 2;
    }
    appendActionLog(
      tabletop,
      controllerSeat.seatIndex,
      controllerSeat.playerName,
      `Resolved ${top.cardName}: ${top.effectSummary}`
    );
  }

  tabletop.resolvedHistory.unshift({
    id: top.id,
    turnNumber: tabletop.turnNumber,
    seatName: top.seatName,
    cardName: top.cardName,
    kind: top.kind,
    summary: top.effectSummary,
    timestamp: new Date().toISOString(),
  });
  if (tabletop.resolvedHistory.length > 40) {
    tabletop.resolvedHistory.length = 40;
  }

  checkStateBasedEliminations(tabletop);
}

function executeAutomatedBotTurn(tabletop: InternalTabletopState): void {
  const activeSeat = tabletop.seats[tabletop.activeSeatIndex];
  if (!activeSeat || activeSeat.kind !== 'bot' || activeSeat.isEliminated) return;

  // 1. Untap, pull attackers back smoothly, & Draw
  for (const perm of activeSeat.battlefield) {
    perm.tapped = false;
    perm.summoningSick = false;
    perm.attackingSeatIndex = null;
    if (
      !isBacklinePlaymatCard(perm) &&
      typeof perm.playmatY === 'number' &&
      perm.playmatY > 70
    ) {
      perm.playmatY = 58;
    }
  }
  activeSeat.landsPlayedThisTurn = 0;

  const isOneVsOneFirstTurn =
    tabletop.seats.length === 2 && tabletop.turnNumber === 1 && tabletop.activeSeatIndex === 0;
  if (!isOneVsOneFirstTurn) {
    const drawn = activeSeat.library.shift();
    if (drawn) {
      activeSeat.hand.push(drawn);
      appendActionLog(
        tabletop,
        activeSeat.seatIndex,
        activeSeat.playerName,
        `${activeSeat.playerName} drew a card for turn.`
      );
    }
  }

  // 2. Main Phase 1: Play a land if available
  tabletop.phase = 'main1';
  const landIdx = activeSeat.hand.findIndex((c) =>
    (c.typeLine || '').toLowerCase().includes('land')
  );
  if (landIdx !== -1) {
    const [landCard] = activeSeat.hand.splice(landIdx, 1);
    const landSpot = computeOpenBotPlaymatSpot(activeSeat.battlefield, {
      isBackline: true,
    });
    landCard.playmatX = landSpot.x;
    landCard.playmatY = landSpot.y;
    landCard.playmatZ = landSpot.z;
    activeSeat.battlefield.push(landCard);
    activeSeat.landsPlayedThisTurn = 1;
    appendActionLog(
      tabletop,
      activeSeat.seatIndex,
      activeSeat.playerName,
      `${activeSeat.playerName} played land ${landCard.name}.`
    );
    detectTriggersOnEvent(tabletop, activeSeat, landCard, 'landfall');
  }

  // Count available mana
  const availableLands = activeSeat.battlefield.filter((p) =>
    (p.typeLine || '').toLowerCase().includes('land') && !p.tapped
  );
  let remainingMana = availableLands.length;

  // 3. Cast Commander or highest impact affordable spell
  const cmdCard = activeSeat.commandZone[0];
  const cmdCost = cmdCard ? (cmdCard.cmc || 4) + activeSeat.commanderTax : 99;
  if (cmdCard && remainingMana >= cmdCost) {
    activeSeat.commandZone.shift();
    for (let i = 0; i < cmdCost && i < availableLands.length; i++) {
      availableLands[i].tapped = true;
    }
    remainingMana -= cmdCost;
    activeSeat.commanderCasts += 1;
    activeSeat.commanderTax = activeSeat.commanderCasts * 2;
    tabletop.stack.push({
      id: `stk_bot_cmd_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
      seatIndex: activeSeat.seatIndex,
      seatName: activeSeat.playerName,
      cardName: cmdCard.name,
      kind: 'spell',
      effectSummary: cmdCard.oracleText || `Commander ${cmdCard.name}`,
      imageUri: cmdCard.imageUri,
      cardPayload: cmdCard,
      createdAt: new Date().toISOString(),
    });
    appendActionLog(
      tabletop,
      activeSeat.seatIndex,
      activeSeat.playerName,
      `${activeSeat.playerName} cast Commander ${cmdCard.name} onto the Stack.`
    );
    detectTriggersOnEvent(tabletop, activeSeat, cmdCard, 'cast');
  } else {
    const playableIdx = activeSeat.hand.findIndex(
      (c) =>
        !(c.typeLine || '').toLowerCase().includes('land') &&
        (c.cmc || 1) <= Math.max(1, remainingMana)
    );
    if (playableIdx !== -1) {
      const [spellCard] = activeSeat.hand.splice(playableIdx, 1);
      const cost = Math.max(1, spellCard.cmc || 1);
      for (let i = 0; i < cost && i < availableLands.length; i++) {
        availableLands[i].tapped = true;
      }
      remainingMana = Math.max(0, remainingMana - cost);
      tabletop.stack.push({
        id: `stk_bot_sp_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
        seatIndex: activeSeat.seatIndex,
        seatName: activeSeat.playerName,
        cardName: spellCard.name,
        kind: 'spell',
        effectSummary: spellCard.oracleText || `Cast ${spellCard.name}`,
        imageUri: spellCard.imageUri,
        cardPayload: spellCard,
        createdAt: new Date().toISOString(),
      });
      appendActionLog(
        tabletop,
        activeSeat.seatIndex,
        activeSeat.playerName,
        `${activeSeat.playerName} cast ${spellCard.name} onto the Stack.`
      );
      detectTriggersOnEvent(tabletop, activeSeat, spellCard, 'cast');
    }
  }

  // Resolve stack items generated by the bot if no human interruption is pending
  while (tabletop.stack.length > 0) {
    resolveTopStackItem(tabletop);
  }

  // 4. Combat Phase: Attack highest-life opponent with eligible creatures
  tabletop.phase = 'combat';
  const eligibleAttackers = activeSeat.battlefield.filter((p) => {
    const lowerType = (p.typeLine || '').toLowerCase();
    const lowerOracle = (p.oracleText || '').toLowerCase();
    return (
      lowerType.includes('creature') &&
      !p.tapped &&
      !p.summoningSick &&
      !lowerOracle.includes('defender')
    );
  });

  const targetOpponents = tabletop.seats
    .filter((s) => s.seatIndex !== activeSeat.seatIndex && !s.isEliminated)
    .sort((a, b) => b.life - a.life);

  if (eligibleAttackers.length > 0 && targetOpponents.length > 0) {
    const targetOpp = targetOpponents[0];
    let totalDamage = 0;
    const attackerNames: string[] = [];
    let zCursor = getNextPlaymatZ(activeSeat.battlefield);
    for (const attacker of eligibleAttackers) {
      const hasVigilance = (attacker.oracleText || '').toLowerCase().includes('vigilance');
      if (!hasVigilance) {
        attacker.tapped = true;
      }
      attacker.attackingSeatIndex = targetOpp.seatIndex;
      attacker.playmatY = Math.max(attacker.playmatY ?? 58, 78);
      attacker.playmatZ = zCursor++;
      const pwr = Math.max(1, parseInt(attacker.power || '2', 10) || 2) + (attacker.counters || 0);
      totalDamage += pwr;
      attackerNames.push(attacker.name);
      if (attacker.isCommander) {
        targetOpp.commanderDamageBySeat[activeSeat.seatIndex] =
          (targetOpp.commanderDamageBySeat[activeSeat.seatIndex] || 0) + pwr;
      }
    }
    targetOpp.life -= totalDamage;
    appendActionLog(
      tabletop,
      activeSeat.seatIndex,
      activeSeat.playerName,
      `${activeSeat.playerName} attacked ${targetOpp.playerName} with ${attackerNames.join(', ')} for ${totalDamage} damage (${targetOpp.life} life remaining).`
    );
    checkStateBasedEliminations(tabletop);
  }
}

function advanceToNextSeatTurn(tabletop: InternalTabletopState): void {
  const totalSeats = tabletop.seats.length;
  for (const perm of tabletop.seats[tabletop.activeSeatIndex]?.battlefield || []) {
    perm.attackingSeatIndex = null;
  }

  let nextIdx = (tabletop.activeSeatIndex + 1) % totalSeats;
  let checked = 0;
  while (tabletop.seats[nextIdx]?.isEliminated && checked < totalSeats) {
    nextIdx = (nextIdx + 1) % totalSeats;
    checked += 1;
  }

  if (nextIdx <= tabletop.activeSeatIndex) {
    tabletop.turnNumber += 1;
  }
  tabletop.activeSeatIndex = nextIdx;
  tabletop.prioritySeatIndex = nextIdx;
  tabletop.phase = 'beginning';

  const nextSeat = tabletop.seats[nextIdx];
  if (!nextSeat || nextSeat.isEliminated) return;

  // Untap & draw for human seat automatically at start of turn
  if (nextSeat.kind !== 'bot') {
    for (const perm of nextSeat.battlefield) {
      perm.tapped = false;
      perm.summoningSick = false;
      perm.attackingSeatIndex = null;
    }
    nextSeat.landsPlayedThisTurn = 0;
    nextSeat.manaPool = 0;

    const isOneVsOneFirstTurn =
      tabletop.seats.length === 2 && tabletop.turnNumber === 1 && nextIdx === 0;
    if (!isOneVsOneFirstTurn) {
      const drawn = nextSeat.library.shift();
      if (drawn) {
        nextSeat.hand.push(drawn);
        appendActionLog(
          tabletop,
          nextSeat.seatIndex,
          nextSeat.playerName,
          `Turn ${tabletop.turnNumber}: ${nextSeat.playerName} untapped and drew a card.`
        );
      }
    } else {
      appendActionLog(
        tabletop,
        nextSeat.seatIndex,
        nextSeat.playerName,
        `Turn 1: ${nextSeat.playerName} begins (Turn 1 draw skipped in 1v1 per CR 103.8a).`
      );
    }
    tabletop.phase = 'main1';
  } else {
    // Execute bot seat turn and advance until a human seat is active (or all bots have acted)
    let botSafetyCounter = 0;
    while (
      tabletop.seats[tabletop.activeSeatIndex]?.kind === 'bot' &&
      !tabletop.seats[tabletop.activeSeatIndex]?.isEliminated &&
      tabletop.winnerSeatIndex === null &&
      botSafetyCounter < totalSeats
    ) {
      botSafetyCounter += 1;
      executeAutomatedBotTurn(tabletop);
      if (tabletop.winnerSeatIndex !== null) break;

      let afterBotIdx = (tabletop.activeSeatIndex + 1) % totalSeats;
      let hop = 0;
      while (tabletop.seats[afterBotIdx]?.isEliminated && hop < totalSeats) {
        afterBotIdx = (afterBotIdx + 1) % totalSeats;
        hop += 1;
      }
      if (afterBotIdx <= tabletop.activeSeatIndex) {
        tabletop.turnNumber += 1;
      }
      tabletop.activeSeatIndex = afterBotIdx;
      tabletop.prioritySeatIndex = afterBotIdx;
      tabletop.phase = 'main1';

      const arrivedSeat = tabletop.seats[afterBotIdx];
      if (arrivedSeat && arrivedSeat.kind !== 'bot' && !arrivedSeat.isEliminated) {
        for (const perm of arrivedSeat.battlefield) {
          perm.tapped = false;
          perm.summoningSick = false;
          perm.attackingSeatIndex = null;
        }
        arrivedSeat.landsPlayedThisTurn = 0;
        arrivedSeat.manaPool = 0;
        const drawn = arrivedSeat.library.shift();
        if (drawn) {
          arrivedSeat.hand.push(drawn);
        }
        appendActionLog(
          tabletop,
          arrivedSeat.seatIndex,
          arrivedSeat.playerName,
          `Turn ${tabletop.turnNumber}: ${arrivedSeat.playerName}'s turn begins.`
        );
        break;
      }
    }
  }
}

function initializeTabletopMatch(
  room: InternalMultiplayerRoom,
  options?: { firstSeatIndex?: number; diceSummary?: string }
): InternalTabletopState {
  const isCommanderOrMulti =
    room.maxSeats > 2 ||
    room.format.toLowerCase().includes('commander') ||
    room.format.toLowerCase().includes('brawl');
  const startingLife = isCommanderOrMulti ? 40 : 20;

  const activeSeats = room.seats.slice(0, room.maxSeats).map((seat, idx) => {
    if (seat.kind === 'open') {
      // Fill any unallocated open seat with an AI Bot when launching match
      const fallbackArchetypes = [
        'Mono-Red Aggro / Burn',
        'Azorius Control & Countermagic',
        'Simic Landfall & Ramp',
        'Golgari Graveyard Value',
      ];
      seat.kind = 'bot';
      seat.playerName = `AI Bot ${idx} (${fallbackArchetypes[idx % fallbackArchetypes.length].split(' ')[0]})`;
      seat.ready = true;
      seat.connected = true;
      seat.botConfig = {
        name: seat.playerName,
        archetype: fallbackArchetypes[idx % fallbackArchetypes.length],
        indignance: 'measured',
        intelligence: 'tactical',
      };
    }
    return seat;
  });

  const seatStates: InternalSeatGameState[] = activeSeats.map((seat, idx) => {
    const { commandZone, library } = buildSeatDeckInstances(seat, idx);
    const hand = library.splice(0, 7);
    return {
      seatIndex: idx,
      playerName: seat.playerName,
      kind: seat.kind,
      life: typeof seat.lifeTotal === 'number' ? seat.lifeTotal : startingLife,
      poison: 0,
      commanderTax: 0,
      commanderCasts: 0,
      commanderDamageBySeat: {},
      manaPool: 0,
      landsPlayedThisTurn: 0,
      mulliganCount: 0,
      handCount: hand.length,
      libraryCount: library.length,
      hand,
      library,
      battlefield: [],
      commandZone,
      graveyard: [],
      exile: [],
      isEliminated: false,
    };
  });

  const requestedFirst = Number(options?.firstSeatIndex);
  const safeFirstSeat =
    Number.isInteger(requestedFirst) &&
    requestedFirst >= 0 &&
    requestedFirst < seatStates.length
      ? requestedFirst
      : 0;
  const starterSeat = seatStates[safeFirstSeat] || seatStates[0];
  const diceSummary =
    typeof options?.diceSummary === 'string' && options.diceSummary.trim()
      ? options.diceSummary.trim().slice(0, 240)
      : '';

  const actionLog: InternalTabletopState['actionLog'] = [
    {
      id: `act_init_${Date.now()}`,
      turnNumber: 1,
      phase: 'main1',
      seatIndex: safeFirstSeat,
      seatName: starterSeat?.playerName || 'Host',
      message: `Multiplayer match started (${room.maxSeats} seats · ${startingLife} starting life). ${starterSeat?.playerName || 'Seat 1'} goes first! Opening 7-card hands dealt.`,
      timestamp: new Date().toISOString(),
    },
  ];
  if (diceSummary) {
    actionLog.unshift({
      id: `act_d20_${Date.now()}`,
      turnNumber: 1,
      phase: 'main1',
      seatIndex: safeFirstSeat,
      seatName: starterSeat?.playerName || 'Host',
      message: diceSummary,
      timestamp: new Date().toISOString(),
    });
  }

  const tabletop: InternalTabletopState = {
    matchId: `match_${Date.now().toString(36)}`,
    turnNumber: 1,
    activeSeatIndex: safeFirstSeat,
    prioritySeatIndex: safeFirstSeat,
    phase: 'main1',
    startingLife,
    seats: seatStates,
    stack: [],
    resolvedHistory: [],
    actionLog,
    winnerSeatIndex: null,
    winReason: null,
  };

  return tabletop;
}

function scoreLanInterfacePriority(name: string, address: string): number {
  const lowerName = name.toLowerCase();
  const isVirtual =
    lowerName.includes('vethernet') ||
    lowerName.includes('hyper-v') ||
    lowerName.includes('wsl') ||
    lowerName.includes('docker') ||
    lowerName.includes('vmware') ||
    lowerName.includes('virtualbox') ||
    lowerName.includes('tailscale') ||
    lowerName.includes('zerotier') ||
    lowerName.includes('nord') ||
    lowerName.includes('tun') ||
    lowerName.includes('tap');

  if (isVirtual) return 100;
  if (address.startsWith('192.168.')) return 1;
  if (address.startsWith('10.')) return 2;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(address)) return 3;
  return 20;
}

function enumerateLanInterfaces(port: number): NetworkLanInterface[] {
  const nets = os.networkInterfaces();
  const discovered: Array<NetworkLanInterface & { priority: number }> = [];

  for (const [name, entries] of Object.entries(nets)) {
    if (!entries) continue;
    for (const netInfo of entries) {
      const isIPv4 = netInfo.family === 'IPv4' || (netInfo as unknown as { family: number }).family === 4;
      if (isIPv4 && !netInfo.internal) {
        discovered.push({
          name,
          address: netInfo.address,
          family: 'IPv4',
          lanUrl: `http://${netInfo.address}:${port}`,
          priority: scoreLanInterfacePriority(name, netInfo.address),
        });
      }
    }
  }

  discovered.sort((a, b) => a.priority - b.priority);
  return discovered.map(({ priority: _p, ...iface }) => iface);
}

async function fetchPublicIpv4Address(forceRefresh = false): Promise<string | null> {
  const now = Date.now();
  if (!forceRefresh && cachedPublicIpv4 && now - cachedPublicIpv4.fetchedAt < 5 * 60_000) {
    return cachedPublicIpv4.ip;
  }

  const endpoints = [
    { url: 'https://api.ipify.org?format=json', json: true },
    { url: 'https://ipv4.icanhazip.com', json: false },
  ];

  for (const ep of endpoints) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    try {
      const res = await fetch(ep.url, {
        signal: controller.signal,
        headers: { Accept: ep.json ? 'application/json' : 'text/plain' },
      });
      if (!res.ok) continue;

      let candidate = '';
      if (ep.json) {
        const data = (await res.json()) as { ip?: unknown };
        candidate = typeof data?.ip === 'string' ? data.ip.trim() : '';
      } else {
        candidate = (await res.text()).trim();
      }

      if (net.isIPv4(candidate) && !isPrivateOrReservedIpv4(candidate)) {
        cachedPublicIpv4 = { ip: candidate, fetchedAt: now };
        return candidate;
      }
    } catch {
      // Try fallback provider
    } finally {
      clearTimeout(timer);
    }
  }

  return cachedPublicIpv4?.ip || null;
}

function probeTcpEndpoint(host: string, port: number, timeoutMs = 1600): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));

    try {
      socket.connect(port, host);
    } catch {
      finish(false);
    }
  });
}

function probeHttpHealthEndpoint(
  host: string,
  port: number,
  timeoutMs = 2000
): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://${host}:${port}/api/health`, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += String(chunk);
        if (body.length > 512) body = body.slice(0, 512);
      });
      res.on('end', () => {
        resolve(res.statusCode === 200 && body.includes('"ok":true'));
      });
    });
    req.on('error', () => resolve(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

function isDisallowedProbeHost(hostInput: string): boolean {
  const cleaned = hostInput.trim().toLowerCase();
  if (!cleaned) return true;
  // Block cloud metadata & link-local addresses
  if (
    cleaned === '169.254.169.254' ||
    cleaned.startsWith('169.254.') ||
    cleaned === 'metadata.google.internal' ||
    cleaned.endsWith('.internal')
  ) {
    return true;
  }
  // Allow valid IPv4 or standard hostname characters only
  if (!/^[a-z0-9.-]+$/i.test(cleaned)) {
    return true;
  }
  return false;
}

export function registerMultiplayerRoutes(app: express.Express): void {
  const getServerPort = (): number => Number(process.env.PORT || 3000);

  // Scoped CORS for authenticated guest join/state/SSE endpoints only (never wildcard on auth routes, never on localhost-only routes)
  app.use('/api/multiplayer/rooms', (req, res, next) => {
    if (applyMultiplayerCors(req, res)) return;
    next();
  });

  // 1. Network & Port-Forwarding Diagnostics (Localhost Host Only — never leak adapter names or LAN subnets remotely)
  app.get('/api/multiplayer/network-info', requireLocalhostOnly, async (_req, res) => {
    try {
      const port = getServerPort();
      const lanInterfaces = enumerateLanInterfaces(port);
      const primaryLanUrl =
        lanInterfaces[0]?.lanUrl || `http://127.0.0.1:${port}`;
      const loopbackReachable = await probeTcpEndpoint('127.0.0.1', port, 1200);
      const lanReachable = lanInterfaces[0]
        ? await probeTcpEndpoint(lanInterfaces[0].address, port, 1200)
        : loopbackReachable;
      const publicIpv4 = cachedPublicIpv4?.ip || null;
      const publicHostUrl = publicIpv4 ? `http://${publicIpv4}:${port}` : null;

      const report: NetworkDiagnosticsReport = {
        listeningPort: port,
        hostBindAddress: process.env.HOST || '0.0.0.0',
        lanInterfaces,
        primaryLanUrl,
        publicIpv4,
        publicHostUrl,
        loopbackReachable,
        lanReachable,
        firewallCommands: {
          windowsPowerShell: `New-NetFirewallRule -DisplayName "Umbras Pass Multiplayer TCP ${port}" -Direction Inbound -LocalPort ${port} -Protocol TCP -Action Allow`,
          linuxUfw: `sudo ufw allow ${port}/tcp`,
        },
        routerGuideSteps: [
          {
            step: 1,
            title: 'Verify Local Binding (0.0.0.0)',
            detail: `Umbra's Pass automatically listens on TCP port ${port} across all interfaces. Same-Wi-Fi LAN players can join via ${primaryLanUrl}.`,
          },
          {
            step: 2,
            title: 'Allow Inbound TCP Port in Windows Firewall',
            detail: `Run the Windows Firewall rule command so incoming LAN and port-forwarded traffic reaches TCP port ${port}.`,
          },
          {
            step: 3,
            title: 'Configure Router Port Forwarding (Public IPv4)',
            detail: `Open your router admin page (e.g. 192.168.1.1) -> Port Forwarding, and forward External TCP Port ${port} to Internal IP ${lanInterfaces[0]?.address || 'your PC LAN IP'} on Internal Port ${port}.`,
          },
          {
            step: 4,
            title: 'Share Public Invite + Enforce Approval',
            detail:
              'Detect your Public IPv4, share your ?join= link or Portable Room Code + Session Passcode, and approve each friend in the Lobby Gate.',
          },
        ],
      };

      res.json(report);
    } catch (err) {
      res.status(500).json({
        error: sanitizeRemoteMessage(
          err instanceof Error ? err.message : '',
          'Failed to inspect local network interfaces.'
        ),
      });
    }
  });

  // 1b. Explicit Public IPv4 Detection (Localhost Host Only)
  app.get('/api/multiplayer/host-public-ip', requireLocalhostOnly, async (req, res) => {
    try {
      const force = req.query.force === '1' || req.query.force === 'true';
      const port = getServerPort();
      const publicIpv4 = await fetchPublicIpv4Address(force);
      if (!publicIpv4) {
        res.status(502).json({
          error:
            'Could not detect public IPv4 automatically. Enter your WAN IPv4 or DDNS hostname manually.',
        });
        return;
      }
      res.json({
        publicIpv4,
        publicHostUrl: `http://${publicIpv4}:${port}`,
        listeningPort: port,
      });
    } catch {
      res.status(502).json({
        error: 'Unable to look up public IPv4 address.',
      });
    }
  });

  // 2. Port Reachability Self-Test (Localhost Host Only)
  app.post('/api/multiplayer/port-check', requireLocalhostOnly, async (req, res) => {
    try {
      const port = getServerPort();
      const { externalHost } = (req.body || {}) as { externalHost?: string };
      const lanInterfaces = enumerateLanInterfaces(port);
      const loopbackReachable = await probeTcpEndpoint('127.0.0.1', port, 1200);
      const lanReachable = lanInterfaces[0]
        ? await probeTcpEndpoint(lanInterfaces[0].address, port, 1200)
        : loopbackReachable;

      let externalPortReachable: boolean | null = null;
      let externalHttpHealthOk: boolean | null = null;
      let externalCheckDetail =
        'Detect or enter your public IPv4 or DDNS hostname to verify external port forwarding.';

      if (typeof externalHost === 'string' && externalHost.trim()) {
        let parsedHost = externalHost.trim();
        try {
          if (parsedHost.startsWith('http://') || parsedHost.startsWith('https://')) {
            const urlObj = new URL(parsedHost);
            parsedHost = urlObj.hostname;
          } else if (parsedHost.includes(':')) {
            parsedHost = parsedHost.split(':')[0].trim();
          }
        } catch {
          // Keep raw host string
        }

        if (isDisallowedProbeHost(parsedHost)) {
          res.status(400).json({
            error: 'Invalid or restricted host address for port reachability check.',
          });
          return;
        }

        externalPortReachable = await probeTcpEndpoint(parsedHost, port, 2400);
        if (externalPortReachable) {
          externalHttpHealthOk = await probeHttpHealthEndpoint(parsedHost, port, 2200);
        } else {
          externalHttpHealthOk = false;
        }

        if (externalPortReachable && externalHttpHealthOk) {
          externalCheckDetail = `Verified: TCP port ${port} and HTTP multiplayer endpoint on http://${parsedHost}:${port} are reachable!`;
        } else if (externalPortReachable) {
          externalCheckDetail = `TCP port ${port} connected on ${parsedHost}, but the health endpoint timed out. Check if another application is using port ${port}.`;
        } else {
          externalCheckDetail = `Self-probe to ${parsedHost}:${port} timed out. Check router port forwarding (TCP ${port} -> ${lanInterfaces[0]?.address || 'Host IP'}:${port}) and Windows Firewall — or note that some home routers block Hairpin NAT self-tests even when outside friends can connect cleanly.`;
        }
      }

      res.json({
        listeningPort: port,
        loopbackReachable,
        lanReachable,
        externalHostInput: externalHost?.trim() || '',
        externalPortReachable,
        externalHttpHealthOk,
        externalCheckDetail,
      });
    } catch (err) {
      res.status(500).json({
        error: sanitizeRemoteMessage(
          err instanceof Error ? err.message : '',
          'Port check failed.'
        ),
      });
    }
  });

  // 3. List Active LAN Rooms (Hidden from remote/WAN callers and never lists Self-Hosted Online rooms)
  app.options('/api/multiplayer/lan-rooms', (req, res) => {
    applyMultiplayerCors(req, res);
  });

  app.get('/api/multiplayer/lan-rooms', (req, res) => {
    if (applyMultiplayerCors(req, res)) return;
    if (!isPrivateOrLanCaller(req)) {
      res.status(403).json({
        error:
          'Active room directory is hidden for remote public connections. Enter your Room Code and Session Passcode directly.',
      });
      return;
    }

    const isHostLoopback = isLoopbackHostCaller(req);
    const visibleRooms = Array.from(roomsByCode.values())
      .filter((room) => isHostLoopback || room.connectionMode === 'lan')
      .map((room) => ({
        roomCode: room.roomCode,
        roomName: room.roomName,
        connectionMode: room.connectionMode,
        format: room.format,
        maxSeats: room.maxSeats,
        occupiedSeats: room.seats
          .slice(0, room.maxSeats)
          .filter((s) => s.kind !== 'open').length,
        status: room.status,
        createdAt: room.createdAt,
      }));
    res.json({ rooms: visibleRooms });
  });

  // 3b. Direct Room Code Lookup (Rate-limited, minimal non-PII existence verification without leaking OS paths/names)
  app.get('/api/multiplayer/rooms/:roomCode/lookup', (req, res) => {
    const clientIp = getClientSocketIp(req);
    if (!checkAndIncrementLookupRateLimit(clientIp)) {
      res.status(429).json({
        error: 'Too many room lookup attempts. Please wait a moment before trying again.',
      });
      return;
    }

    const rawCode = String(req.params.roomCode || '').trim().toUpperCase();
    const seatSuffixMatch = rawCode.match(/^(UP-[A-Z0-9]{4})-S([1-4])$/);
    const code = seatSuffixMatch ? seatSuffixMatch[1] : rawCode;

    if (!/^UP-[A-Z0-9]{4}$/.test(code)) {
      res.status(404).json({ error: 'Room was not found on this host.' });
      return;
    }

    const room = roomsByCode.get(code);
    if (!room) {
      res.status(404).json({ error: 'Room was not found on this host.' });
      return;
    }

    res.json({
      exists: true,
      roomCode: room.roomCode,
      format: room.format,
      connectionMode: room.connectionMode,
      requireHostApproval: room.requireHostApproval,
    });
  });

  // 4. Host Creates a New Multiplayer Room (Localhost Host Only)
  app.post('/api/multiplayer/rooms', requireLocalhostOnly, (req, res) => {
    try {
      const {
        roomName,
        connectionMode = 'lan',
        format = 'commander',
        maxSeats = 4,
        requireHostApproval = true,
        hostName = 'Host Player',
        passcode,
        hostDeck,
        botSeats = [],
      } = (req.body || {}) as {
        roomName?: string;
        connectionMode?: MultiplayerConnectionMode;
        format?: string;
        maxSeats?: 1 | 2 | 3 | 4;
        requireHostApproval?: boolean;
        hostName?: string;
        passcode?: string;
        hostDeck?: MultiplayerDeckSummary;
        botSeats?: Array<{
          seatIndex: number;
          kind: 'open' | 'bot';
          botConfig?: MultiplayerBotSeatConfig;
        }>;
      };

      const cleanPasscode = typeof passcode === 'string' ? passcode.trim() : '';
      if (cleanPasscode.length < 4) {
        res.status(400).json({
          error: 'Please set a session passcode of at least 4 characters to secure your room.',
        });
        return;
      }

      const cleanMode: MultiplayerConnectionMode =
        connectionMode === 'online' ? 'online' : 'lan';
      const enforcedApproval = cleanMode === 'online' ? true : requireHostApproval !== false;
      const validMaxSeats: 1 | 2 | 3 | 4 =
        maxSeats === 1 || maxSeats === 2 || maxSeats === 3 || maxSeats === 4 ? maxSeats : 4;
      const roomCode = generateRoomCode();
      const roomId = `room_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
      const { salt, hash } = hashPasscode(cleanPasscode);
      const hostSeatToken = crypto.randomBytes(32).toString('hex');

      const defaultBotArchetypes = [
        'Mono-Red Aggro / Burn',
        'Azorius Control & Countermagic',
        'Simic Landfall & Ramp',
        'Golgari Graveyard Value',
      ];

      const defaultStartingLife = getRoomDefaultStartingLife(
        format || 'commander',
        validMaxSeats
      );
      const safeHostDeck = hostDeck
        ? sanitizeIncomingDeckSummary(hostDeck, `${hostName || 'Host'}'s Deck`, format || 'commander')
        : null;

      const seats: MultiplayerSeat[] = [0, 1, 2, 3].map((idx) => {
        const seatInviteCode = `${roomCode}-S${idx + 1}`;
        if (idx === 0) {
          return {
            seatIndex: 0,
            seatId: `seat_0_${crypto.randomBytes(3).toString('hex')}`,
            seatInviteCode,
            kind: 'host',
            playerName: (hostName || 'Host Player').trim().slice(0, 32),
            connected: true,
            ready: true,
            lastSeenAt: new Date().toISOString(),
            deckSummary: safeHostDeck,
            botConfig: null,
            lifeTotal: defaultStartingLife,
          };
        }

        const customSeatCfg = botSeats.find((b) => b.seatIndex === idx);
        if (customSeatCfg?.kind === 'bot') {
          const arch =
            customSeatCfg.botConfig?.archetype ||
            defaultBotArchetypes[idx % defaultBotArchetypes.length];
          const bName =
            customSeatCfg.botConfig?.name ||
            `AI Bot ${idx} (${arch.split(' ')[0]})`;
          return {
            seatIndex: idx,
            seatId: `seat_${idx}_${crypto.randomBytes(3).toString('hex')}`,
            seatInviteCode,
            kind: 'bot',
            playerName: bName,
            connected: true,
            ready: true,
            lastSeenAt: new Date().toISOString(),
            deckSummary: null,
            botConfig: {
              name: bName,
              archetype: arch,
              indignance: customSeatCfg.botConfig?.indignance || 'measured',
              intelligence: customSeatCfg.botConfig?.intelligence || 'tactical',
            },
            lifeTotal: defaultStartingLife,
          };
        }

        return {
          seatIndex: idx,
          seatId: `seat_${idx}_${crypto.randomBytes(3).toString('hex')}`,
          seatInviteCode,
          kind: 'open',
          playerName: `Friend Seat #${idx + 1}`,
          connected: false,
          ready: false,
          lastSeenAt: new Date().toISOString(),
          deckSummary: null,
          botConfig: null,
          lifeTotal: defaultStartingLife,
        };
      });

      const seatTokensByIndex = new Map<number, string>();
      seatTokensByIndex.set(0, hostSeatToken);

      const room: InternalMultiplayerRoom = {
        roomId,
        roomCode,
        roomName:
          (typeof roomName === 'string' && roomName.trim()
            ? roomName.trim()
            : `${hostName || 'Host'}'s Tabletop Pod`
          ).slice(0, 48),
        connectionMode: cleanMode,
        format: (format || 'commander').trim().slice(0, 32),
        maxSeats: validMaxSeats,
        requireHostApproval: enforcedApproval,
        status: 'lobby',
        createdAt: new Date().toISOString(),
        passcodeSalt: salt,
        passcodeHash: hash,
        hostSeatToken,
        seatTokensByIndex,
        seats,
        pendingJoinRequests: [],
        tabletop: null,
        chatMessages: [
          {
            id: `msg_init_${Date.now()}`,
            seatIndex: 0,
            senderName: 'System',
            text: `Room ${roomCode} created (${cleanMode === 'online' ? 'Self-Hosted Online' : 'Offline LAN'} · ${validMaxSeats} ${validMaxSeats === 1 ? 'seat' : 'seats'}). Passcode & Host Approval active.`,
            isSystem: true,
            timestamp: new Date().toISOString(),
          },
        ],
        processedActionIds: new Set<string>(),
        sseSubscribers: new Map(),
        stateVersion: 1,
      };

      roomsByCode.set(roomCode, room);

      res.json({
        sessionToken: hostSeatToken,
        room: buildClientViewForCaller(room, 0, true),
      });
    } catch (err) {
      res.status(500).json({
        error: sanitizeRemoteMessage(
          err instanceof Error ? err.message : '',
          'Failed to create multiplayer room.'
        ),
      });
    }
  });

  // 5. Guest Submits Join Request (Supports Room Code UP-XXXX or Seat Invite Code UP-XXXX-S2)
  app.post('/api/multiplayer/rooms/:roomCode/join-request', (req, res) => {
    const rawCode = String(req.params.roomCode || '').trim().toUpperCase();
    const seatSuffixMatch = rawCode.match(/^(UP-[A-Z0-9]+)-S([1-4])$/);
    const code = seatSuffixMatch ? seatSuffixMatch[1] : rawCode;
    const preferredSeatIndex = seatSuffixMatch
      ? Math.max(1, Math.min(3, Number(seatSuffixMatch[2]) - 1))
      : undefined;
    const room = roomsByCode.get(code);
    const rateKey = `${getClientSocketIp(req)}:${code}`;

    if (!checkAndIncrementRateLimit(rateKey)) {
      res.status(429).json({
        error: 'Too many join attempts. Please wait 60 seconds and verify the room passcode with your host.',
      });
      return;
    }

    if (!room) {
      res.status(404).json({
        error: `Room ${code || '(empty)'} was not found on this host.`,
      });
      return;
    }

    const { playerName, passcode, deckSummary } = (req.body || {}) as {
      playerName?: string;
      passcode?: string;
      deckSummary?: MultiplayerDeckSummary;
    };

    if (!passcode || typeof passcode !== 'string' || !verifyPasscodeConstantTime(passcode, room.passcodeSalt, room.passcodeHash)) {
      res.status(403).json({
        error: 'Incorrect session passcode for this room.',
      });
      return;
    }

    clearRateLimit(rateKey);

    const cleanName = (typeof playerName === 'string' && playerName.trim() ? playerName.trim() : 'Guest Planeswalker').slice(0, 32);
    const requestId = `req_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
    const requestToken = crypto.randomBytes(32).toString('hex');

    const safeDeck: MultiplayerDeckSummary = sanitizeIncomingDeckSummary(
      deckSummary,
      `${cleanName}'s Deck`,
      room.format
    );

    const joinReq: InternalJoinRequest = {
      requestId,
      requestToken,
      playerName: cleanName,
      deckSummary: safeDeck,
      requestedAt: new Date().toISOString(),
      status: 'pending',
      preferredSeatIndex,
      passcodeVerified: true,
    };

    // If requireHostApproval is disabled and an open Friend seat exists, auto-admit immediately upon valid passcode
    if (!room.requireHostApproval) {
      const targetSeat =
        (typeof preferredSeatIndex === 'number' &&
        preferredSeatIndex > 0 &&
        preferredSeatIndex < room.maxSeats &&
        room.seats[preferredSeatIndex]?.kind === 'open'
          ? room.seats[preferredSeatIndex]
          : undefined) ||
        room.seats
          .slice(1, room.maxSeats)
          .find((s) => s.kind === 'open');

      if (targetSeat) {
        const chosenIdx = targetSeat.seatIndex;
        const seatToken = crypto.randomBytes(32).toString('hex');
        joinReq.status = 'approved';
        joinReq.assignedSeatIndex = chosenIdx;
        joinReq.seatToken = seatToken;
        room.seatTokensByIndex.set(chosenIdx, seatToken);
        room.seats[chosenIdx] = {
          seatIndex: chosenIdx,
          seatId: `seat_${chosenIdx}_${crypto.randomBytes(3).toString('hex')}`,
          seatInviteCode: `${room.roomCode}-S${chosenIdx + 1}`,
          kind: 'human',
          playerName: cleanName,
          connected: true,
          ready: true,
          lastSeenAt: new Date().toISOString(),
          deckSummary: safeDeck,
          botConfig: null,
          lifeTotal:
            typeof targetSeat.lifeTotal === 'number'
              ? targetSeat.lifeTotal
              : getRoomDefaultStartingLife(room.format, room.maxSeats),
        };
      }
    }

    room.pendingJoinRequests.push(joinReq);
    room.chatMessages.push({
      id: `msg_req_${Date.now()}`,
      seatIndex: null,
      senderName: 'System',
      text:
        joinReq.status === 'approved'
          ? `${cleanName} verified passcode and joined Seat #${(joinReq.assignedSeatIndex ?? 1) + 1} with "${safeDeck.deckName}".`
          : `${cleanName} verified passcode and requested to join${
              typeof preferredSeatIndex === 'number'
                ? ` Seat #${preferredSeatIndex + 1}`
                : ''
            } with "${safeDeck.deckName}" (${safeDeck.cardCount} cards). Waiting for host approval.`,
      isSystem: true,
      timestamp: new Date().toISOString(),
    });

    broadcastRoomState(room);

    res.json({
      requestId,
      requestToken,
      status: joinReq.status,
      roomName: room.roomName,
      roomCode: room.roomCode,
    });
  });

  // 6. Guest Polls Join Approval Status
  app.get('/api/multiplayer/rooms/:roomCode/join-status', (req, res) => {
    const rawCode = String(req.params.roomCode || '').trim().toUpperCase();
    const seatSuffixMatch = rawCode.match(/^(UP-[A-Z0-9]+)-S([1-4])$/);
    const code = seatSuffixMatch ? seatSuffixMatch[1] : rawCode;
    const room = roomsByCode.get(code);
    if (!room) {
      res.status(404).json({ error: 'Room not found.' });
      return;
    }

    const token = extractBearerToken(req);
    const matched = token
      ? room.pendingJoinRequests.find(
          (r) => r.requestToken === token || (r.seatToken && r.seatToken === token)
        )
      : undefined;
    if (!matched) {
      res.status(403).json({ error: 'Join request token not recognized.' });
      return;
    }

    if (matched.status === 'approved' && typeof matched.assignedSeatIndex === 'number' && matched.seatToken) {
      res.json({
        status: 'approved',
        seatIndex: matched.assignedSeatIndex,
        sessionToken: matched.seatToken,
        room: buildClientViewForCaller(room, matched.assignedSeatIndex, false),
      });
      return;
    }

    res.json({
      status: matched.status,
      requestId: matched.requestId,
      roomName: room.roomName,
    });
  });

  // 7. Host Approves or Denies a Pending Guest Join Request
  app.post('/api/multiplayer/rooms/:roomCode/approve-request', (req, res) => {
    const code = String(req.params.roomCode || '').trim().toUpperCase();
    const room = roomsByCode.get(code);
    if (!room) {
      res.status(404).json({ error: 'Room not found.' });
      return;
    }

    const token = extractBearerToken(req);
    const caller = resolveCallerRole(room, token);
    if (!caller.isHost) {
      res.status(403).json({ error: 'Only the room host can approve or deny join requests.' });
      return;
    }

    const { requestId, approve, targetSeatIndex } = (req.body || {}) as {
      requestId?: string;
      approve?: boolean;
      targetSeatIndex?: number;
    };

    const reqEntry = room.pendingJoinRequests.find((r) => r.requestId === requestId);
    if (!reqEntry) {
      res.status(404).json({ error: 'Join request not found.' });
      return;
    }

    if (!approve) {
      reqEntry.status = 'denied';
      room.chatMessages.push({
        id: `msg_deny_${Date.now()}`,
        seatIndex: 0,
        senderName: 'System',
        text: `Host declined join request from ${reqEntry.playerName}.`,
        isSystem: true,
        timestamp: new Date().toISOString(),
      });
      broadcastRoomState(room);
      res.json({ room: buildClientViewForCaller(room, 0, true) });
      return;
    }

    // Find an available seat (prefer requested targetSeatIndex, otherwise first open seat, otherwise first bot seat)
    let chosenSeatIdx: number | undefined;
    if (
      typeof targetSeatIndex === 'number' &&
      targetSeatIndex > 0 &&
      targetSeatIndex < room.maxSeats
    ) {
      chosenSeatIdx = targetSeatIndex;
    } else {
      const openSeat = room.seats
        .slice(1, room.maxSeats)
        .find((s) => s.kind === 'open');
      const botSeat = room.seats
        .slice(1, room.maxSeats)
        .find((s) => s.kind === 'bot');
      chosenSeatIdx = openSeat?.seatIndex ?? botSeat?.seatIndex;
    }

    if (typeof chosenSeatIdx !== 'number') {
      res.status(400).json({
        error: 'No available seats remain in this pod. Increase max seats or free a seat first.',
      });
      return;
    }

    const seatToken = crypto.randomBytes(32).toString('hex');
    reqEntry.status = 'approved';
    reqEntry.assignedSeatIndex = chosenSeatIdx;
    reqEntry.seatToken = seatToken;
    room.seatTokensByIndex.set(chosenSeatIdx, seatToken);

    room.seats[chosenSeatIdx] = {
      seatIndex: chosenSeatIdx,
      seatId: `seat_${chosenSeatIdx}_${crypto.randomBytes(3).toString('hex')}`,
      seatInviteCode: `${room.roomCode}-S${chosenSeatIdx + 1}`,
      kind: 'human',
      playerName: reqEntry.playerName,
      connected: true,
      ready: true,
      lastSeenAt: new Date().toISOString(),
      deckSummary: reqEntry.deckSummary,
      botConfig: null,
      lifeTotal:
        typeof room.seats[chosenSeatIdx]?.lifeTotal === 'number'
          ? room.seats[chosenSeatIdx].lifeTotal
          : getRoomDefaultStartingLife(room.format, room.maxSeats),
    };

    room.chatMessages.push({
      id: `msg_appr_${Date.now()}`,
      seatIndex: 0,
      senderName: 'System',
      text: `Host approved ${reqEntry.playerName} into Seat #${chosenSeatIdx + 1} (${reqEntry.deckSummary.deckName}).`,
      isSystem: true,
      timestamp: new Date().toISOString(),
    });

    broadcastRoomState(room);
    res.json({ room: buildClientViewForCaller(room, 0, true) });
  });

  // 8. Host Configures a Seat (Toggle Friend (Invite Code) vs AI Bot, or Remove Occupant)
  app.post('/api/multiplayer/rooms/:roomCode/configure-seat', (req, res) => {
    const code = String(req.params.roomCode || '').trim().toUpperCase();
    const room = roomsByCode.get(code);
    if (!room) {
      res.status(404).json({ error: 'Room not found.' });
      return;
    }

    const token = extractBearerToken(req);
    const caller = resolveCallerRole(room, token);
    if (!caller.isHost) {
      res.status(403).json({ error: 'Only the room host can configure pod seats.' });
      return;
    }

    const { seatIndex, kind, botConfig } = (req.body || {}) as {
      seatIndex?: number;
      kind?: 'open' | 'bot';
      botConfig?: MultiplayerBotSeatConfig;
    };

    if (typeof seatIndex !== 'number' || seatIndex <= 0 || seatIndex >= 4) {
      res.status(400).json({ error: 'Invalid seat index.' });
      return;
    }

    room.seatTokensByIndex.delete(seatIndex);
    for (const [subId, sub] of room.sseSubscribers.entries()) {
      if (sub.seatIndex === seatIndex) {
        try {
          sub.res.end();
        } catch {
          // Ignore already-closed stream
        }
        room.sseSubscribers.delete(subId);
      }
    }
    for (const pending of room.pendingJoinRequests) {
      if (pending.assignedSeatIndex === seatIndex) {
        delete pending.seatToken;
      }
    }
    const seatInviteCode = `${room.roomCode}-S${seatIndex + 1}`;
    const preservedLifeTotal =
      typeof room.seats[seatIndex]?.lifeTotal === 'number'
        ? room.seats[seatIndex].lifeTotal
        : getRoomDefaultStartingLife(room.format, room.maxSeats);

    if (kind === 'bot') {
      const archetype = botConfig?.archetype || 'Mono-Red Aggro / Burn';
      const botName = botConfig?.name || `AI Bot ${seatIndex} (${archetype.split(' ')[0]})`;
      room.seats[seatIndex] = {
        seatIndex,
        seatId: `seat_${seatIndex}_${crypto.randomBytes(3).toString('hex')}`,
        seatInviteCode,
        kind: 'bot',
        playerName: botName,
        connected: true,
        ready: true,
        lastSeenAt: new Date().toISOString(),
        deckSummary: null,
        botConfig: {
          name: botName,
          archetype,
          indignance: botConfig?.indignance || 'measured',
          intelligence: botConfig?.intelligence || 'tactical',
        },
        lifeTotal: preservedLifeTotal,
      };
    } else {
      room.seats[seatIndex] = {
        seatIndex,
        seatId: `seat_${seatIndex}_${crypto.randomBytes(3).toString('hex')}`,
        seatInviteCode,
        kind: 'open',
        playerName: `Friend Seat #${seatIndex + 1}`,
        connected: false,
        ready: false,
        lastSeenAt: new Date().toISOString(),
        deckSummary: null,
        botConfig: null,
        lifeTotal: preservedLifeTotal,
      };
    }

    if (room.tabletop && room.tabletop.seats[seatIndex]) {
      room.tabletop.seats[seatIndex].kind = room.seats[seatIndex].kind;
      room.tabletop.seats[seatIndex].playerName = room.seats[seatIndex].playerName;
    }

    broadcastRoomState(room);
    res.json({ room: buildClientViewForCaller(room, 0, true) });
  });

  // 8b. Host Updates Live Lobby Settings (1-4 Seat Count, Passcode Rotation, Passcode Approval Gate Toggle)
  app.post('/api/multiplayer/rooms/:roomCode/lobby-settings', (req, res) => {
    const code = String(req.params.roomCode || '').trim().toUpperCase();
    const room = roomsByCode.get(code);
    if (!room) {
      res.status(404).json({ error: 'Room not found.' });
      return;
    }

    const token = extractBearerToken(req);
    const caller = resolveCallerRole(room, token);
    if (!caller.isHost) {
      res.status(403).json({ error: 'Only the room host can update lobby settings.' });
      return;
    }

    const {
      maxSeats,
      newPasscode,
      requireHostApproval,
      roomName,
      tabletopThemeId,
      tabletopArtworkPresetId,
      tabletopCustomImageUrl,
    } = (req.body || {}) as {
      maxSeats?: 1 | 2 | 3 | 4;
      newPasscode?: string;
      requireHostApproval?: boolean;
      roomName?: string;
      tabletopThemeId?: string;
      tabletopArtworkPresetId?: string;
      tabletopCustomImageUrl?: string;
    };

    if (maxSeats === 1 || maxSeats === 2 || maxSeats === 3 || maxSeats === 4) {
      room.maxSeats = maxSeats;
    }

    if (typeof requireHostApproval === 'boolean') {
      room.requireHostApproval =
        room.connectionMode === 'online' ? true : requireHostApproval;
    }

    if (typeof roomName === 'string' && roomName.trim()) {
      room.roomName = roomName.trim().slice(0, 48);
    }

    if (typeof tabletopThemeId === 'string') {
      room.tabletopThemeId = tabletopThemeId.trim().slice(0, 40);
    }
    if (typeof tabletopArtworkPresetId === 'string') {
      room.tabletopArtworkPresetId = tabletopArtworkPresetId.trim().slice(0, 40);
    }
    if (typeof tabletopCustomImageUrl === 'string') {
      const trimmedUrl = tabletopCustomImageUrl.trim();
      if (!trimmedUrl || isSafeCardOrPlaymatImageUrl(trimmedUrl)) {
        room.tabletopCustomImageUrl = trimmedUrl.slice(0, 600_000);
      }
    }

    if (typeof newPasscode === 'string' && newPasscode.trim()) {
      if (newPasscode.trim().length < 4) {
        res.status(400).json({
          error: 'New session passcode must be at least 4 characters.',
        });
        return;
      }
      const { salt, hash } = hashPasscode(newPasscode.trim());
      room.passcodeSalt = salt;
      room.passcodeHash = hash;
      room.chatMessages.push({
        id: `msg_pass_${Date.now()}`,
        seatIndex: 0,
        senderName: 'System',
        text: 'Host rotated the room session passcode.',
        isSystem: true,
        timestamp: new Date().toISOString(),
      });
    }

    broadcastRoomState(room);
    res.json({ room: buildClientViewForCaller(room, 0, true) });
  });

  // 9. Player Updates Ready State, Playmat Theme, or Deck Summary in Lobby / Match
  app.post('/api/multiplayer/rooms/:roomCode/ready', (req, res) => {
    const code = String(req.params.roomCode || '').trim().toUpperCase();
    const room = roomsByCode.get(code);
    if (!room) {
      res.status(404).json({ error: 'Room not found.' });
      return;
    }

    const token = extractBearerToken(req);
    const caller = resolveCallerRole(room, token);
    if (caller.seatIndex === null) {
      res.status(403).json({ error: 'Unauthorized seat token.' });
      return;
    }

    const {
      ready,
      deckSummary,
      playmatThemeId,
      playmatArtworkPresetId,
      playmatCustomImageUrl,
    } = (req.body || {}) as {
      ready?: boolean;
      deckSummary?: MultiplayerDeckSummary;
      playmatThemeId?: string;
      playmatArtworkPresetId?: string;
      playmatCustomImageUrl?: string;
    };

    const seat = room.seats[caller.seatIndex];
    if (seat) {
      if (typeof ready === 'boolean') {
        seat.ready = ready;
      }
      if (typeof playmatThemeId === 'string') {
        seat.playmatThemeId = playmatThemeId.trim().slice(0, 40);
      }
      if (typeof playmatArtworkPresetId === 'string') {
        seat.playmatArtworkPresetId = playmatArtworkPresetId.trim().slice(0, 40);
      }
      if (typeof playmatCustomImageUrl === 'string') {
        const trimmedUrl = playmatCustomImageUrl.trim();
        if (!trimmedUrl || isSafeCardOrPlaymatImageUrl(trimmedUrl)) {
          seat.playmatCustomImageUrl = trimmedUrl.slice(0, 600_000);
        }
      }
      if (deckSummary && Array.isArray(deckSummary.cards)) {
        seat.deckSummary = sanitizeIncomingDeckSummary(
          deckSummary,
          seat.playerName,
          room.format
        );
      }
      seat.lastSeenAt = new Date().toISOString();
      seat.connected = true;
    }

    broadcastRoomState(room);
    res.json({
      room: buildClientViewForCaller(room, caller.seatIndex, caller.isHost),
    });
  });

  // 9b. Persistent Lobby Life Total Tracker Update (Seats 1-4)
  app.post('/api/multiplayer/rooms/:roomCode/seat-life', (req, res) => {
    const code = String(req.params.roomCode || '').trim().toUpperCase();
    const room = roomsByCode.get(code);
    if (!room) {
      res.status(404).json({ error: 'Room not found.' });
      return;
    }

    const token = extractBearerToken(req);
    const caller = resolveCallerRole(room, token);
    if (caller.seatIndex === null && !caller.isHost) {
      res.status(403).json({ error: 'Unauthorized seat token.' });
      return;
    }

    const { seatIndex, delta, lifeTotal, resetAll } = (req.body || {}) as {
      seatIndex?: number;
      delta?: number;
      lifeTotal?: number;
      resetAll?: boolean;
    };

    const defaultLife = getRoomDefaultStartingLife(room.format, room.maxSeats);

    if (resetAll) {
      if (!caller.isHost) {
        res.status(403).json({ error: 'Only the room host can reset all seat life totals.' });
        return;
      }
      for (let i = 0; i < 4; i++) {
        if (room.seats[i]) {
          room.seats[i].lifeTotal = defaultLife;
        }
        if (room.tabletop?.seats[i]) {
          room.tabletop.seats[i].life = defaultLife;
        }
      }
      broadcastRoomState(room);
      res.json({
        room: buildClientViewForCaller(room, caller.seatIndex, caller.isHost),
      });
      return;
    }

    if (typeof seatIndex !== 'number' || !Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= 4) {
      res.status(400).json({ error: 'Valid seat index (0-3) is required.' });
      return;
    }

    if (!caller.isHost && caller.seatIndex !== seatIndex) {
      res.status(403).json({ error: 'You can only adjust your own seat life total.' });
      return;
    }

    const seat = room.seats[seatIndex];
    if (!seat) {
      res.status(404).json({ error: 'Seat not found.' });
      return;
    }

    const currentLife = typeof seat.lifeTotal === 'number' ? seat.lifeTotal : defaultLife;
    let nextLife = currentLife;
    if (typeof lifeTotal === 'number' && Number.isFinite(lifeTotal)) {
      nextLife = Math.round(lifeTotal);
    } else if (typeof delta === 'number' && Number.isFinite(delta)) {
      nextLife = Math.round(currentLife + delta);
    } else {
      res.status(400).json({ error: 'Provide either delta, lifeTotal, or resetAll.' });
      return;
    }

    const clampedLife = Math.max(0, Math.min(999, nextLife));
    seat.lifeTotal = clampedLife;
    if (room.tabletop?.seats[seatIndex]) {
      room.tabletop.seats[seatIndex].life = clampedLife;
      checkStateBasedEliminations(room.tabletop);
    }

    broadcastRoomState(room);
    res.json({
      room: buildClientViewForCaller(room, caller.seatIndex, caller.isHost),
    });
  });

  // 10. Host Starts or Restarts the Synchronized Multiplayer Match
  app.post('/api/multiplayer/rooms/:roomCode/start', (req, res) => {
    const code = String(req.params.roomCode || '').trim().toUpperCase();
    const room = roomsByCode.get(code);
    if (!room) {
      res.status(404).json({ error: 'Room not found.' });
      return;
    }

    const token = extractBearerToken(req);
    const caller = resolveCallerRole(room, token);
    if (!caller.isHost) {
      res.status(403).json({ error: 'Only the host can launch the multiplayer match.' });
      return;
    }

    const body = (req.body || {}) as {
      firstSeatIndex?: number;
      diceSummary?: string;
    };
    const diceSummary =
      typeof body.diceSummary === 'string' ? body.diceSummary.trim().slice(0, 240) : '';

    room.tabletop = initializeTabletopMatch(room, {
      firstSeatIndex:
        typeof body.firstSeatIndex === 'number' ? body.firstSeatIndex : undefined,
      diceSummary: diceSummary || undefined,
    });
    room.status = 'playing';
    const firstSeatName =
      room.tabletop.seats[room.tabletop.activeSeatIndex]?.playerName || 'Seat 1';
    room.chatMessages.push({
      id: `msg_start_${Date.now()}`,
      seatIndex: 0,
      senderName: 'System',
      text: `${
        diceSummary ? `${diceSummary} · ` : ''
      }Match launched! ${firstSeatName} goes first — libraries shuffled and 7-card opening hands dealt to all ${room.maxSeats} seats.`,
      isSystem: true,
      timestamp: new Date().toISOString(),
    });

    broadcastRoomState(room);
    res.json({
      room: buildClientViewForCaller(room, 0, true),
    });
  });

  // 11. Get Current Room & Tabletop State (Authenticated per Seat)
  app.get('/api/multiplayer/rooms/:roomCode/state', (req, res) => {
    const code = String(req.params.roomCode || '').trim().toUpperCase();
    const room = roomsByCode.get(code);
    if (!room) {
      res.status(404).json({ error: 'Room not found.' });
      return;
    }

    const token = extractBearerToken(req);
    const caller = resolveCallerRole(room, token);
    if (caller.seatIndex === null && !caller.isHost) {
      res.status(403).json({ error: 'Unauthorized room access.' });
      return;
    }

    if (caller.seatIndex !== null && room.seats[caller.seatIndex]) {
      room.seats[caller.seatIndex].connected = true;
      room.seats[caller.seatIndex].lastSeenAt = new Date().toISOString();
    }

    res.json({
      room: buildClientViewForCaller(room, caller.seatIndex, caller.isHost),
    });
  });

  // 11b. Issue One-Time Short-Lived SSE Ticket (Avoids placing permanent session tokens in URL query logs)
  app.post('/api/multiplayer/rooms/:roomCode/sse-ticket', (req, res) => {
    const code = String(req.params.roomCode || '').trim().toUpperCase();
    const room = roomsByCode.get(code);
    if (!room) {
      res.status(404).json({ error: 'Room not found.' });
      return;
    }

    const token = extractBearerToken(req);
    const caller = resolveCallerRole(room, token);
    if (caller.seatIndex === null && !caller.isHost) {
      res.status(403).json({ error: 'Unauthorized event stream ticket request.' });
      return;
    }

    const ticket = issueOneTimeSseTicket(room.roomCode, caller.seatIndex, caller.isHost);
    res.json({ ticket, expiresInSeconds: 30 });
  });

  // 12. Real-Time Server-Sent Events (SSE) Stream for Synchronized Room & Tabletop Updates
  app.get('/api/multiplayer/rooms/:roomCode/events', (req, res) => {
    const code = String(req.params.roomCode || '').trim().toUpperCase();
    const room = roomsByCode.get(code);
    if (!room) {
      res.status(404).json({ error: 'Room not found.' });
      return;
    }

    const rawTicket = typeof req.query.ticket === 'string' ? req.query.ticket.trim() : '';
    const ticketCaller = rawTicket ? consumeOneTimeSseTicket(rawTicket, code) : null;
    const headerToken = extractBearerToken(req);
    const caller = ticketCaller || resolveCallerRole(room, headerToken);

    if (caller.seatIndex === null && !caller.isHost) {
      res.status(403).json({ error: 'Unauthorized event stream.' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const subId = `sub_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    room.sseSubscribers.set(subId, {
      res,
      seatIndex: caller.seatIndex,
      isHost: caller.isHost,
    });

    const initialView = buildClientViewForCaller(room, caller.seatIndex, caller.isHost);
    res.write(`data: ${JSON.stringify(initialView)}\n\n`);

    const keepAliveTimer = setInterval(() => {
      try {
        res.write(': heartbeat\n\n');
      } catch {
        clearInterval(keepAliveTimer);
      }
    }, 15_000);

    req.on('close', () => {
      clearInterval(keepAliveTimer);
      room.sseSubscribers.delete(subId);
    });
  });

  // 13. Table Chat Message Endpoint
  app.post('/api/multiplayer/rooms/:roomCode/chat', (req, res) => {
    const code = String(req.params.roomCode || '').trim().toUpperCase();
    const room = roomsByCode.get(code);
    if (!room) {
      res.status(404).json({ error: 'Room not found.' });
      return;
    }

    const token = extractBearerToken(req);
    const caller = resolveCallerRole(room, token);
    if (caller.seatIndex === null) {
      res.status(403).json({ error: 'Unauthorized seat token.' });
      return;
    }

    const { text } = (req.body || {}) as { text?: string };
    const cleanText = typeof text === 'string' ? text.trim().slice(0, 280) : '';
    if (!cleanText) {
      res.status(400).json({ error: 'Message text is required.' });
      return;
    }

    const senderSeat = room.seats[caller.seatIndex];
    room.chatMessages.push({
      id: `chat_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
      seatIndex: caller.seatIndex,
      senderName: senderSeat?.playerName || `Seat #${caller.seatIndex + 1}`,
      text: cleanText,
      timestamp: new Date().toISOString(),
    });
    if (room.chatMessages.length > 80) {
      room.chatMessages.splice(0, room.chatMessages.length - 80);
    }

    broadcastRoomState(room);
    res.json({
      room: buildClientViewForCaller(room, caller.seatIndex, caller.isHost),
    });
  });

  // 14. Authoritative Idempotent Tabletop Game Action Endpoint
  app.post('/api/multiplayer/rooms/:roomCode/action', (req, res) => {
    const code = String(req.params.roomCode || '').trim().toUpperCase();
    const room = roomsByCode.get(code);
    if (!room || !room.tabletop) {
      res.status(404).json({ error: 'Active tabletop match not found.' });
      return;
    }

    const token = extractBearerToken(req);
    const caller = resolveCallerRole(room, token);
    if (caller.seatIndex === null) {
      res.status(403).json({ error: 'Unauthorized seat token.' });
      return;
    }

    const action = req.body as MultiplayerGameActionPayload;
    if (!action || typeof action.type !== 'string' || typeof action.actionId !== 'string') {
      res.status(400).json({ error: 'Valid action type and actionId are required.' });
      return;
    }

    // Idempotency guard: if this actionId was already applied, return current state without re-applying
    if (room.processedActionIds.has(action.actionId)) {
      res.json({
        room: buildClientViewForCaller(room, caller.seatIndex, caller.isHost),
      });
      return;
    }
    room.processedActionIds.add(action.actionId);
    if (room.processedActionIds.size > 500) {
      const firstId = room.processedActionIds.values().next().value;
      if (firstId) room.processedActionIds.delete(firstId);
    }

    const tabletop = room.tabletop;
    const seatState = tabletop.seats[caller.seatIndex];
    if (!seatState) {
      res.status(400).json({ error: 'Caller seat state not found.' });
      return;
    }

    switch (action.type) {
      case 'reset-match': {
        if (!caller.isHost) {
          res.status(403).json({ error: 'Only the host can reset the match.' });
          return;
        }
        room.tabletop = initializeTabletopMatch(room);
        break;
      }

      case 'mulligan': {
        // Put current hand back into library, shuffle, draw 7, and put N cards on bottom (London Mulligan CR 103.5)
        seatState.mulliganCount += 1;
        seatState.library.push(...seatState.hand.splice(0));
        seatState.library = shuffleCards(seatState.library);
        const keepCount = Math.max(1, 7 - seatState.mulliganCount);
        seatState.hand = seatState.library.splice(0, keepCount);
        appendActionLog(
          tabletop,
          seatState.seatIndex,
          seatState.playerName,
          `${seatState.playerName} took London Mulligan #${seatState.mulliganCount} (kept ${keepCount} cards).`
        );
        break;
      }

      case 'draw-card': {
        const drawn = seatState.library.shift();
        if (!drawn) {
          seatState.isEliminated = true;
          seatState.eliminationReason = 'Attempted to draw from an empty library (CR 704.5b)';
          appendActionLog(
            tabletop,
            seatState.seatIndex,
            seatState.playerName,
            `${seatState.playerName} attempted to draw from an empty library and lost the game (CR 704.5b).`
          );
          checkStateBasedEliminations(tabletop);
        } else {
          seatState.hand.push(drawn);
          appendActionLog(
            tabletop,
            seatState.seatIndex,
            seatState.playerName,
            `${seatState.playerName} drew a card (${seatState.hand.length} in hand).`
          );
        }
        break;
      }

      case 'play-land': {
        const cardIdx = seatState.hand.findIndex((c) => c.uid === action.cardUid);
        if (cardIdx !== -1) {
          const [card] = seatState.hand.splice(cardIdx, 1);
          const spot = computeOpenPlayerPlaymatSpot(
            seatState.battlefield,
            true,
            action.dropPos
          );
          card.playmatX = spot.x;
          card.playmatY = spot.y;
          card.playmatZ = spot.z;
          seatState.battlefield.push(card);
          seatState.landsPlayedThisTurn += 1;
          appendActionLog(
            tabletop,
            seatState.seatIndex,
            seatState.playerName,
            `${seatState.playerName} played land ${card.name}.`
          );
          detectTriggersOnEvent(tabletop, seatState, card, 'landfall');
        }
        break;
      }

      case 'cast-spell': {
        const cardIdx = seatState.hand.findIndex((c) => c.uid === action.cardUid);
        if (cardIdx !== -1) {
          const [card] = seatState.hand.splice(cardIdx, 1);
          if (action.dropPos) {
            card.playmatX = clampPlaymatX(action.dropPos.x);
            card.playmatY = clampPlaymatY(action.dropPos.y);
          } else {
            delete card.playmatX;
            delete card.playmatY;
          }
          // If this is a counterspell targeting an existing stack item, mark target when resolving or target summary
          let targetDesc: string | undefined;
          if (action.targetStackId) {
            const targetedStack = tabletop.stack.find((s) => s.id === action.targetStackId);
            if (targetedStack) {
              targetDesc = `Targets ${targetedStack.cardName} on Stack`;
              if ((card.oracleText || '').toLowerCase().includes('counter target')) {
                targetedStack.countered = true;
                targetedStack.counteredBy = card.name;
              }
            }
          } else if (typeof action.targetSeatIndex === 'number') {
            const tSeat = tabletop.seats[action.targetSeatIndex];
            if (tSeat) {
              targetDesc = `Targets ${tSeat.playerName}`;
            }
          }

          tabletop.stack.push({
            id: `stk_sp_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
            seatIndex: seatState.seatIndex,
            seatName: seatState.playerName,
            cardName: card.name,
            kind: 'spell',
            effectSummary: card.oracleText || `Cast ${card.name} (MV ${card.cmc})`,
            targetSummary: targetDesc,
            imageUri: card.imageUri,
            cardPayload: card,
            createdAt: new Date().toISOString(),
          });

          appendActionLog(
            tabletop,
            seatState.seatIndex,
            seatState.playerName,
            `${seatState.playerName} cast ${card.name} onto the Stack${targetDesc ? ` (${targetDesc})` : ''}.`
          );
          detectTriggersOnEvent(tabletop, seatState, card, 'cast');
        }
        break;
      }

      case 'cast-commander': {
        const cmdIdx = seatState.commandZone.findIndex((c) => c.uid === action.cardUid);
        if (cmdIdx !== -1) {
          const [cmdCard] = seatState.commandZone.splice(cmdIdx, 1);
          if (action.dropPos) {
            cmdCard.playmatX = clampPlaymatX(action.dropPos.x);
            cmdCard.playmatY = clampPlaymatY(action.dropPos.y);
          } else {
            delete cmdCard.playmatX;
            delete cmdCard.playmatY;
          }
          const totalTaxPaid = seatState.commanderTax;
          seatState.commanderCasts += 1;
          seatState.commanderTax = seatState.commanderCasts * 2;

          tabletop.stack.push({
            id: `stk_cmd_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
            seatIndex: seatState.seatIndex,
            seatName: seatState.playerName,
            cardName: cmdCard.name,
            kind: 'spell',
            effectSummary:
              cmdCard.oracleText ||
              `Commander cast from Command Zone (Tax paid: +{${totalTaxPaid}}, next tax: +{${seatState.commanderTax}})`,
            imageUri: cmdCard.imageUri,
            cardPayload: cmdCard,
            createdAt: new Date().toISOString(),
          });

          appendActionLog(
            tabletop,
            seatState.seatIndex,
            seatState.playerName,
            `${seatState.playerName} cast Commander ${cmdCard.name} onto the Stack (next tax +{${seatState.commanderTax}}).`
          );
          detectTriggersOnEvent(tabletop, seatState, cmdCard, 'cast');
        }
        break;
      }

      case 'push-trigger': {
        const perm = seatState.battlefield.find((p) => p.uid === action.sourceUid);
        if (perm) {
          const isActivated = action.triggerKind === 'activated';
          const labelMap: Record<string, string> = {
            etb: 'ETB Trigger',
            landfall: 'Landfall Trigger',
            upkeep: 'Upkeep Trigger',
            attack: 'Attack Trigger',
            dies: 'Dies Trigger',
            activated: 'Activated Ability',
          };
          tabletop.stack.push({
            id: `stk_man_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
            seatIndex: seatState.seatIndex,
            seatName: seatState.playerName,
            cardName: `${perm.name} — ${labelMap[action.triggerKind] || 'Triggered Ability'}`,
            kind: isActivated ? 'activated-ability' : 'triggered-ability',
            effectSummary: perm.oracleText || `${labelMap[action.triggerKind]} from ${perm.name}`,
            triggerCondition: `${labelMap[action.triggerKind]} queued by ${seatState.playerName}`,
            imageUri: perm.imageUri,
            createdAt: new Date().toISOString(),
          });
          appendActionLog(
            tabletop,
            seatState.seatIndex,
            seatState.playerName,
            `${seatState.playerName} pushed ${perm.name} (${labelMap[action.triggerKind]}) onto the Stack.`
          );
        }
        break;
      }

      case 'resolve-top': {
        resolveTopStackItem(tabletop);
        break;
      }

      case 'pass-priority': {
        while (tabletop.stack.length > 0) {
          resolveTopStackItem(tabletop);
        }
        break;
      }

      case 'toggle-tap': {
        const perm = seatState.battlefield.find((p) => p.uid === action.cardUid);
        if (perm) {
          perm.tapped = !perm.tapped;
          if (perm.tapped && (perm.typeLine || '').toLowerCase().includes('land')) {
            seatState.manaPool += 1;
          }
        }
        break;
      }

      case 'adjust-counter': {
        const perm = seatState.battlefield.find((p) => p.uid === action.cardUid);
        if (perm) {
          perm.counters = Math.max(0, (perm.counters || 0) + action.delta);
        }
        break;
      }

      case 'move-zone': {
        const zones: Record<
          'hand' | 'battlefield' | 'graveyard' | 'exile' | 'commandZone',
          MultiplayerCardInstance[]
        > = {
          hand: seatState.hand,
          battlefield: seatState.battlefield,
          graveyard: seatState.graveyard,
          exile: seatState.exile,
          commandZone: seatState.commandZone,
        };
        const sourceList = zones[action.fromZone];
        const targetList = zones[action.toZone];
        if (sourceList && targetList) {
          const idx = sourceList.findIndex((c) => c.uid === action.cardUid);
          if (idx !== -1) {
            const [moved] = sourceList.splice(idx, 1);
            moved.tapped = false;
            moved.attackingSeatIndex = null;
            if (action.toZone === 'battlefield') {
              const spot = computeOpenPlayerPlaymatSpot(
                seatState.battlefield,
                isBacklinePlaymatCard(moved),
                action.dropPos
              );
              moved.playmatX = spot.x;
              moved.playmatY = spot.y;
              moved.playmatZ = spot.z;
            } else {
              delete moved.playmatX;
              delete moved.playmatY;
              delete moved.playmatZ;
            }
            targetList.push(moved);
            appendActionLog(
              tabletop,
              seatState.seatIndex,
              seatState.playerName,
              `${seatState.playerName} moved ${moved.name} from ${action.fromZone} to ${action.toZone}.`
            );
          }
        }
        break;
      }

      case 'move-playmat-card': {
        const targetIdx =
          typeof action.targetSeatIndex === 'number'
            ? action.targetSeatIndex
            : seatState.seatIndex;
        const targetSeat = tabletop.seats[targetIdx];
        if (
          targetSeat &&
          (targetSeat.seatIndex === seatState.seatIndex || targetSeat.kind === 'bot')
        ) {
          const perm = targetSeat.battlefield.find((p) => p.uid === action.cardUid);
          if (perm) {
            perm.playmatX = clampPlaymatX(Number(action.x));
            perm.playmatY = clampPlaymatY(Number(action.y));
            perm.playmatZ = getNextPlaymatZ(targetSeat.battlefield);
          }
        }
        break;
      }

      case 'auto-arrange-playmat': {
        const targetIdx =
          typeof action.targetSeatIndex === 'number'
            ? action.targetSeatIndex
            : seatState.seatIndex;
        const targetSeat = tabletop.seats[targetIdx];
        if (
          targetSeat &&
          (targetSeat.seatIndex === seatState.seatIndex || targetSeat.kind === 'bot')
        ) {
          targetSeat.battlefield =
            targetSeat.kind === 'bot'
              ? tidyBotPlaymatPositions(targetSeat.battlefield, true)
              : tidyPlayerPlaymatPositions(targetSeat.battlefield);
        }
        break;
      }

      case 'declare-attack': {
        const targetSeat = tabletop.seats[action.targetSeatIndex];
        if (targetSeat && !targetSeat.isEliminated) {
          let totalDamage = 0;
          const names: string[] = [];
          for (const uid of action.attackerUids) {
            const perm = seatState.battlefield.find((p) => p.uid === uid);
            if (!perm) continue;
            const hasVigilance = (perm.oracleText || '').toLowerCase().includes('vigilance');
            if (!hasVigilance) perm.tapped = true;
            perm.attackingSeatIndex = targetSeat.seatIndex;
            const pwr = Math.max(1, parseInt(perm.power || '2', 10) || 2) + (perm.counters || 0);
            totalDamage += pwr;
            names.push(perm.name);
            if (perm.isCommander) {
              targetSeat.commanderDamageBySeat[seatState.seatIndex] =
                (targetSeat.commanderDamageBySeat[seatState.seatIndex] || 0) + pwr;
            }
          }
          if (names.length > 0) {
            tabletop.phase = 'combat';
            targetSeat.life -= totalDamage;
            appendActionLog(
              tabletop,
              seatState.seatIndex,
              seatState.playerName,
              `${seatState.playerName} attacked ${targetSeat.playerName} with ${names.join(', ')} for ${totalDamage} damage (${targetSeat.life} life).`
            );
            checkStateBasedEliminations(tabletop);
          }
        }
        break;
      }

      case 'adjust-life': {
        const targetSeat = tabletop.seats[action.targetSeatIndex];
        if (targetSeat) {
          targetSeat.life += action.delta;
          if (room.seats[action.targetSeatIndex]) {
            room.seats[action.targetSeatIndex].lifeTotal = Math.max(0, targetSeat.life);
          }
          appendActionLog(
            tabletop,
            seatState.seatIndex,
            seatState.playerName,
            `${targetSeat.playerName} life ${action.delta >= 0 ? `+${action.delta}` : action.delta} -> ${targetSeat.life}.`
          );
          checkStateBasedEliminations(tabletop);
        }
        break;
      }

      case 'adjust-poison': {
        const targetSeat = tabletop.seats[action.targetSeatIndex];
        if (targetSeat) {
          targetSeat.poison = Math.max(0, targetSeat.poison + action.delta);
          appendActionLog(
            tabletop,
            seatState.seatIndex,
            seatState.playerName,
            `${targetSeat.playerName} poison counters -> ${targetSeat.poison}.`
          );
          checkStateBasedEliminations(tabletop);
        }
        break;
      }

      case 'add-mana': {
        seatState.manaPool = Math.max(0, seatState.manaPool + action.delta);
        break;
      }

      case 'create-token': {
        const tok = action.token;
        if (tok && typeof tok.name === 'string') {
          const cleanName = tok.name.trim().slice(0, 48) || 'Token';
          const qty = Math.max(1, Math.min(10, Number(tok.quantity) || 1));
          const isCreature = tok.kind === 'creature';
          const safeImg = isSafeCardOrPlaymatImageUrl(tok.imageUri)
            ? tok.imageUri.slice(0, 600_000)
            : undefined;
          const kwList = Array.isArray(tok.keywords)
            ? tok.keywords.map((k) => String(k).trim()).filter(Boolean)
            : [];
          const hasHaste = kwList.some((k) => k.toLowerCase() === 'haste');
          const abilityDesc =
            tok.tokenAbility === 'treasure'
              ? '{T}, Sacrifice: Add one mana of any color.'
              : tok.tokenAbility === 'food'
              ? '{2}, {T}, Sacrifice: You gain 3 life.'
              : tok.tokenAbility === 'clue'
              ? '{2}, Sacrifice: Draw a card.'
              : tok.tokenAbility === 'blood'
              ? '{1}, {T}, Discard a card, Sacrifice: Draw a card.'
              : kwList.join(', ');

          for (let i = 0; i < qty; i++) {
            const spot = computeOpenPlayerPlaymatSpot(
              seatState.battlefield,
              tok.tokenAbility === 'treasure'
            );
            const tokenInst: MultiplayerCardInstance = {
              uid: `s${seatState.seatIndex}_tok_${Date.now()}_${i}_${crypto.randomBytes(2).toString('hex')}`,
              name: `${cleanName} Token`,
              displayTitle: `${cleanName} Token`,
              typeLine: isCreature
                ? `Token Creature — ${cleanName}`
                : tok.kind === 'enchantment'
                ? 'Token Enchantment'
                : 'Token Artifact',
              manaCost: '',
              cmc: 0,
              oracleText: abilityDesc,
              imageUri: safeImg,
              power: isCreature ? String(Math.max(0, Number(tok.power) || 0)) : undefined,
              toughness: isCreature ? String(Math.max(1, Number(tok.toughness) || 1)) : undefined,
              tapped: false,
              counters: 0,
              summoningSick: isCreature && !hasHaste,
              isCommander: false,
              attackingSeatIndex: null,
              isToken: true,
              proxyBadgeLabel: 'TOKEN',
              frameStyle: tok.frameStyle || 'standard',
              tokenAbility: tok.tokenAbility || 'none',
              playmatX: spot.x,
              playmatY: spot.y,
              playmatZ: spot.z,
            };
            seatState.battlefield.push(tokenInst);
          }

          appendActionLog(
            tabletop,
            seatState.seatIndex,
            seatState.playerName,
            `${seatState.playerName} created ${qty}× ${cleanName} Token${
              isCreature ? ` (${tok.power}/${tok.toughness})` : ''
            } on the battlefield.`
          );
        }
        break;
      }

      case 'inject-proxy-card': {
        const prx = action.card;
        if (prx && typeof prx.name === 'string' && prx.name.trim()) {
          const cleanName = prx.name.trim().slice(0, 64);
          const safeImg = isSafeCardOrPlaymatImageUrl(prx.imageUri)
            ? prx.imageUri.slice(0, 600_000)
            : undefined;
          const isCreature = (prx.typeLine || '').toLowerCase().includes('creature');
          const hasHaste = (prx.oracleText || '').toLowerCase().includes('haste');

          const proxyInst: MultiplayerCardInstance = {
            uid: `s${seatState.seatIndex}_prx_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
            name: cleanName,
            displayTitle: prx.displayTitle?.trim().slice(0, 64) || cleanName,
            typeLine: (prx.typeLine || 'Spell').trim().slice(0, 80),
            manaCost: (prx.manaCost || '').trim().slice(0, 32),
            cmc: Math.max(0, Number(prx.cmc) || 0),
            oracleText: (prx.oracleText || '').trim().slice(0, 600),
            imageUri: safeImg,
            power: prx.power ? String(prx.power).slice(0, 8) : undefined,
            toughness: prx.toughness ? String(prx.toughness).slice(0, 8) : undefined,
            tapped: false,
            counters: 0,
            summoningSick: action.zone === 'battlefield' && isCreature && !hasHaste,
            isCommander: Boolean(prx.isCommander || action.zone === 'commandZone'),
            attackingSeatIndex: null,
            isProxy: true,
            proxyBadgeLabel: prx.proxyBadgeLabel || 'PROXY',
            frameStyle: prx.frameStyle || 'standard',
          };

          if (action.zone === 'battlefield') {
            const spot = computeOpenPlayerPlaymatSpot(
              seatState.battlefield,
              isBacklinePlaymatCard(proxyInst)
            );
            proxyInst.playmatX = spot.x;
            proxyInst.playmatY = spot.y;
            proxyInst.playmatZ = spot.z;
            seatState.battlefield.push(proxyInst);
          } else if (action.zone === 'commandZone') {
            seatState.commandZone.push(proxyInst);
          } else {
            seatState.hand.push(proxyInst);
          }

          appendActionLog(
            tabletop,
            seatState.seatIndex,
            seatState.playerName,
            `${seatState.playerName} added playtest proxy "${proxyInst.displayTitle || proxyInst.name}" to their ${
              action.zone === 'commandZone' ? 'Command Zone' : action.zone
            }.`
          );
        }
        break;
      }

      case 'update-card-art': {
        const targetNorm = (action.cardName || '').trim().toLowerCase();
        if (targetNorm) {
          const safeImg = isSafeCardOrPlaymatImageUrl(action.imageUri)
            ? action.imageUri.slice(0, 600_000)
            : undefined;

          const updateZones: MultiplayerCardInstance[][] = [
            seatState.hand,
            seatState.battlefield,
            seatState.commandZone,
            seatState.graveyard,
            seatState.exile,
            seatState.library,
          ];

          for (const zoneList of updateZones) {
            for (const c of zoneList) {
              if (c.name.trim().toLowerCase() === targetNorm) {
                if (safeImg !== undefined) c.imageUri = safeImg;
                if (action.displayTitle !== undefined) {
                  c.displayTitle = action.displayTitle.trim().slice(0, 64) || undefined;
                }
                if (action.proxyBadgeLabel !== undefined) {
                  c.proxyBadgeLabel = action.proxyBadgeLabel;
                }
                if (action.frameStyle !== undefined) {
                  c.frameStyle = action.frameStyle;
                }
                if (action.typeLine) c.typeLine = action.typeLine.slice(0, 80);
                if (action.manaCost !== undefined) c.manaCost = action.manaCost.slice(0, 32);
                if (typeof action.cmc === 'number') c.cmc = action.cmc;
                if (action.oracleText !== undefined) c.oracleText = action.oracleText.slice(0, 600);
                if (action.power !== undefined) c.power = action.power || undefined;
                if (action.toughness !== undefined) c.toughness = action.toughness || undefined;
              }
            }
          }
        }
        break;
      }

      case 'next-phase': {
        const phaseOrder: MultiplayerTabletopPhase[] = [
          'beginning',
          'main1',
          'combat',
          'main2',
          'ending',
        ];
        const curIdx = phaseOrder.indexOf(tabletop.phase);
        if (curIdx < phaseOrder.length - 1) {
          tabletop.phase = phaseOrder[curIdx + 1];
        } else {
          advanceToNextSeatTurn(tabletop);
        }
        break;
      }

      case 'pass-turn': {
        while (tabletop.stack.length > 0) {
          resolveTopStackItem(tabletop);
        }
        advanceToNextSeatTurn(tabletop);
        break;
      }

      case 'run-bot-step': {
        if (tabletop.seats[tabletop.activeSeatIndex]?.kind === 'bot') {
          executeAutomatedBotTurn(tabletop);
          advanceToNextSeatTurn(tabletop);
        }
        break;
      }
    }

    broadcastRoomState(room);
    res.json({
      room: buildClientViewForCaller(room, caller.seatIndex, caller.isHost),
    });
  });
}
