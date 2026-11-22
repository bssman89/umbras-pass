import type {
  BotIndignanceLevel,
  BotIntelligenceLevel,
  BotLearningProfile,
  BotOpponentConfig,
  CardMetadata,
  DeckFormat,
  ResolvedDeckCard,
} from '../types/deck';
import { getBotIntelligenceMeta } from './botIntelligence';
import {
  autoRecognizeCommandersClientSide,
  parseDecklistClientSide,
} from './clientFallbackAnalyzer';
import {
  detectArchetypeCombatBias,
  detectCardMechanics,
  getFormatSimulationRules,
  type ArchetypeCombatBias,
} from './playtestReconciler';
import {
  buildBotPastPlayBriefing,
  resolveBotLearningKey,
} from './botLearning';

export interface CreatureKeywords {
  flying: boolean;
  reach: boolean;
  trample: boolean;
  deathtouch: boolean;
  lifelink: boolean;
  vigilance: boolean;
  haste: boolean;
  firstStrike: boolean;
  menace: boolean;
  hexproof: boolean;
  indestructible: boolean;
}

export const EMPTY_KEYWORDS: CreatureKeywords = {
  flying: false,
  reach: false,
  trample: false,
  deathtouch: false,
  lifelink: false,
  vigilance: false,
  haste: false,
  firstStrike: false,
  menace: false,
  hexproof: false,
  indestructible: false,
};

export function extractCreatureKeywords(
  meta?: CardMetadata | null,
  overrides?: Partial<CreatureKeywords>
): CreatureKeywords {
  const oracle = (meta?.oracleText || '').toLowerCase();
  return {
    flying: overrides?.flying ?? /\bflying\b/.test(oracle),
    reach: overrides?.reach ?? /\breach\b/.test(oracle),
    trample: overrides?.trample ?? /\btrample\b/.test(oracle),
    deathtouch: overrides?.deathtouch ?? /\bdeathtouch\b/.test(oracle),
    lifelink: overrides?.lifelink ?? /\blifelink\b/.test(oracle),
    vigilance: overrides?.vigilance ?? /\bvigilance\b/.test(oracle),
    haste: overrides?.haste ?? /\bhaste\b/.test(oracle),
    firstStrike: overrides?.firstStrike ?? /\b(first strike|double strike)\b/.test(oracle),
    menace: overrides?.menace ?? /\bmenace\b/.test(oracle),
    hexproof: overrides?.hexproof ?? /\b(hexproof|shroud)\b/.test(oracle),
    indestructible: overrides?.indestructible ?? /\bindestructible\b/.test(oracle),
  };
}

export function formatCreatureKeywordTags(kw: Partial<CreatureKeywords> & {
  hasInfect?: boolean;
  toxicValue?: number;
}): string[] {
  const tags: string[] = [];
  if (kw.flying) tags.push('Fly');
  if (kw.reach) tags.push('Reach');
  if (kw.firstStrike) tags.push('1st Strike');
  if (kw.deathtouch) tags.push('Deathtouch');
  if (kw.trample) tags.push('Trample');
  if (kw.lifelink) tags.push('Lifelink');
  if (kw.vigilance) tags.push('Vigilance');
  if (kw.haste) tags.push('Haste');
  if (kw.menace) tags.push('Menace');
  if (kw.hexproof) tags.push('Hexproof');
  if (kw.indestructible) tags.push('Indestr.');
  if (kw.hasInfect) tags.push('Infect');
  if (kw.toxicValue && kw.toxicValue > 0) tags.push(`Toxic ${kw.toxicValue}`);
  return tags;
}

export interface LiveBotCreature extends CreatureKeywords {
  uid: string;
  name: string;
  power: number;
  toughness: number;
  tapped: boolean;
  summoningSick: boolean;
  isCommander: boolean;
  hasInfect: boolean;
  toxicValue: number;
  meta: CardMetadata | null;
}

export interface LiveBotDeckCard extends CreatureKeywords {
  name: string;
  cmc: number;
  isLand: boolean;
  entersTapped: boolean;
  isCreature: boolean;
  isBoardWipe: boolean;
  isRemoval: boolean;
  isCounterspell: boolean;
  isRamp: boolean;
  drawCount: number;
  lifegainAmount: number;
  power: number;
  toughness: number;
  hasInfect: boolean;
  toxicValue: number;
  burnAmount: number;
  millAmount: number;
  meta: CardMetadata | null;
}

export interface LivePlayerDeckContext {
  deckName: string;
  archetype: string;
  format: string;
  commanderNames: string[];
  avgCmc: number;
  keyThreats: string[];
  landCount: number;
  tappedLandCount: number;
}

export interface BotTurnPhaseStep {
  phase: 'Untap & Draw' | 'Main Phase' | 'Combat' | 'End Step';
  summary: string;
}

export interface BotLiveMemoryState {
  profileKey: string;
  botIqScore: number;
  priorMatchesPlayed: number;
  deckIdentitySummary: string;
  opponentDeckRead: string;
  grudgeScore: number;
  rivalGrudgeByBotId: Record<string, number>;
  commanderDamageDealtToRivals: Record<string, number>;
  priorRivalThreatByName: Record<string, number>;
  consecutiveTurnsOnSameTarget: number;
  observedUserThreats: string[];
  observedUserHabits: string[];
  userAggressionCount: number;
  userManaStumbles: number;
  userOpenManaPasses: number;
  userBlockCount: number;
  userTookUnblockedCount: number;
  holdManaForInteraction: boolean;
  defensivePosture: boolean;
  countersUsedThisGame: number;
  lastAdaptationNote: string;
  adaptationHistory: string[];
  damageDealtToPlayer: number;
  damageTakenFromPlayer: number;
  damageDealtToRivals: number;
  damageTakenFromRivals: number;
  biggestRivalThreatName: string;
  spellsCastCount: number;
  creaturesPlayedCount: number;
}

export interface LiveBotZoneCard {
  uid: string;
  name: string;
  cmc: number;
  typeLine: string;
  meta: CardMetadata | null;
  reason?: string;
}

export interface LiveBotState {
  id: string;
  name: string;
  archetype: string;
  indignance: BotIndignanceLevel;
  intelligence: BotIntelligenceLevel;
  commanderName: string;
  commanderPower: number;
  commanderToughness: number;
  commanderCmc: number;
  commanderMeta: CardMetadata | null;
  commanderInZone: boolean;
  commanderTax: number;
  startingLife: number;
  life: number;
  poison: number;
  commanderDamageTakenFromYou: number;
  commanderDamageDealtToYou: number;
  landsInPlay: number;
  tappedLands: number;
  manaBonusFromRamp: number;
  handCount: number;
  libraryCount: number;
  graveyardCount: number;
  exileCount: number;
  graveyardCards: LiveBotZoneCard[];
  exileCards: LiveBotZoneCard[];
  creatures: LiveBotCreature[];
  bias: ArchetypeCombatBias;
  allowsCommandZone: boolean;
  usesCommanderDamage21: boolean;
  customLibrary: LiveBotDeckCard[];
  customHand: LiveBotDeckCard[];
  lastActionSummary: string;
  lastTargetName: string;
  lastTurnSteps: BotTurnPhaseStep[];
  liveMemory: BotLiveMemoryState;
  eliminated: boolean;
  eliminatedReason: 'life' | 'poison' | 'commander' | 'mill' | null;
}

export interface PlayerBoardCreatureSnapshot extends Partial<CreatureKeywords> {
  uid: string;
  name: string;
  power: number;
  toughness: number;
  tapped: boolean;
  isCommander: boolean;
  hasInfect: boolean;
  toxicValue: number;
}

export interface PlayerBoardSnapshot {
  life: number;
  poison: number;
  libraryCount: number;
  creatures: PlayerBoardCreatureSnapshot[];
  landsCount: number;
  untappedLandsCount?: number;
  handCount?: number;
  hasCommanderInPlay: boolean;
  deckContext?: LivePlayerDeckContext;
  canRespondAtInstantSpeed?: boolean;
  hasActivatedAbilityResponse?: boolean;
  interruptAlertsEnabled?: boolean;
  fullControlPriority?: boolean;
}

export interface PendingBotAttack {
  botId: string;
  botName: string;
  commanderName: string;
  attackers: LiveBotCreature[];
  adaptationReason?: string;
}

export interface PendingBotStackSpell {
  id: string;
  botIndex: number;
  botId: string;
  botName: string;
  seatNumber: number;
  cardName: string;
  cmc: number;
  typeLine: string;
  meta: CardMetadata | null;
  category: 'board-wipe' | 'removal' | 'commander' | 'creature' | 'burn' | 'mill' | 'draw' | 'ramp';
  uncounterable: boolean;
  exilesTarget?: boolean;
  targetSummary: string;
  targetPlayerCreatureUid?: string;
  targetPlayerCreatureName?: string;
  targetBotId?: string;
  targetBotName?: string;
  targetBotCreatureUid?: string;
  targetBotCreatureName?: string;
  creaturePayload?: LiveBotCreature;
  burnAmount?: number;
  drainHealAmount?: number;
  millAmount?: number;
  drawCount?: number;
  rampManaBonus?: number;
  drawAmount?: number;
  poisonAmount?: number;
  priorPhaseSteps: BotTurnPhaseStep[];
  playedSummaries: string[];
  adaptationNote: string;
  deferredCombat: boolean;
}

export interface BotTurnResolution {
  updatedBots: LiveBotState[];
  playerLifeDelta: number;
  playerPoisonDelta: number;
  playerMillCount: number;
  removedPlayerCreatureUids: string[];
  exiledPlayerCreatureUids?: string[];
  boardWipeCast: boolean;
  logs: string[];
  phaseSteps: BotTurnPhaseStep[];
  adaptationNote: string;
  pendingAttackOnPlayer: PendingBotAttack | null;
  pendingStackSpell?: PendingBotStackSpell | null;
}

export interface LiveUserActionEvent {
  type:
    | 'play-land'
    | 'missed-land'
    | 'cast-creature'
    | 'cast-commander'
    | 'cast-spell'
    | 'cast-ramp'
    | 'attack-bot'
    | 'block-bot'
    | 'take-unblocked'
    | 'pass-open-mana'
    | 'mulligan'
    | 'counter-bot-spell'
    | 'protect-permanent'
    | 'instant-combat-trick';
  turn: number;
  cardName?: string;
  counteredSpellName?: string;
  cmc?: number;
  power?: number;
  toughness?: number;
  isCommander?: boolean;
  isTappedLand?: boolean;
  isRemoval?: boolean;
  targetBotId?: string;
  damageDealt?: number;
  poisonDealt?: number;
  commanderDamageDealt?: number;
  openMana?: number;
  blockedCount?: number;
  unblockedDamage?: number;
}

export interface UserActionBotReaction {
  updatedBots: LiveBotState[];
  counteredByBotName: string | null;
  counteredByBotId: string | null;
  counteredBySeatNumber: number | null;
  counterSpellName: string | null;
  counterSpellCmc: number;
  counterReason: string | null;
  adaptationLogs: string[];
}

interface ArchetypeCardTemplate extends Partial<CreatureKeywords> {
  name: string;
  cmc: number;
  power: number;
  toughness: number;
  hasInfect?: boolean;
  toxicValue?: number;
}

const ARCHETYPE_CREATURES: Array<{
  pattern: RegExp;
  creatures: ArchetypeCardTemplate[];
}> = [
  {
    pattern: /mono-red|aggro|burn/i,
    creatures: [
      { name: 'Monastery Swiftspear', cmc: 1, power: 2, toughness: 2, haste: true },
      { name: 'Goblin Guide', cmc: 1, power: 2, toughness: 2, haste: true },
      { name: 'Eidolon of the Great Revel', cmc: 2, power: 2, toughness: 2 },
      { name: 'Guttersnipe', cmc: 3, power: 2, toughness: 2 },
      { name: 'Rampaging Ferocidon', cmc: 3, power: 3, toughness: 3, menace: true },
      { name: 'Hellrider', cmc: 4, power: 3, toughness: 3, haste: true },
    ],
  },
  {
    pattern: /azorius|control|countermagic/i,
    creatures: [
      { name: 'Thraben Inspector', cmc: 1, power: 1, toughness: 2 },
      { name: 'Spell Queller', cmc: 3, power: 2, toughness: 3, flying: true },
      { name: 'Aven Mindcensor', cmc: 3, power: 2, toughness: 1, flying: true },
      { name: 'Consecrated Sphinx', cmc: 6, power: 4, toughness: 6, flying: true },
      { name: 'Dream Trawler', cmc: 6, power: 3, toughness: 5, flying: true, lifelink: true },
    ],
  },
  {
    pattern: /dimir.*midrange|midrange/i,
    creatures: [
      { name: 'Baleful Strix', cmc: 2, power: 1, toughness: 1, flying: true, deathtouch: true },
      { name: 'Vampire Nighthawk', cmc: 3, power: 2, toughness: 3, flying: true, deathtouch: true, lifelink: true },
      { name: 'Sheoldred, the Apocalypse', cmc: 4, power: 4, toughness: 5, deathtouch: true },
      { name: 'Grave Titan', cmc: 6, power: 6, toughness: 6, deathtouch: true },
    ],
  },
  {
    pattern: /toxic|infect|poison/i,
    creatures: [
      { name: 'Glistener Elf', cmc: 1, power: 1, toughness: 1, hasInfect: true },
      { name: 'Venerated Rotpriest', cmc: 1, power: 1, toughness: 2, toxicValue: 1 },
      { name: 'Blighted Agent', cmc: 2, power: 1, toughness: 1, hasInfect: true, flying: true },
      { name: 'Bloated Contaminator', cmc: 3, power: 4, toughness: 4, trample: true, toxicValue: 1 },
      { name: 'Skithiryx, the Blight Dragon', cmc: 5, power: 4, toughness: 4, hasInfect: true, flying: true, haste: true },
    ],
  },
  {
    pattern: /mill|library/i,
    creatures: [
      { name: 'Hedron Crab', cmc: 1, power: 0, toughness: 2 },
      { name: 'Ruin Crab', cmc: 1, power: 0, toughness: 3 },
      { name: 'Thieves\' Guild Enforcer', cmc: 1, power: 1, toughness: 1, deathtouch: true },
      { name: 'Consuming Aberration', cmc: 5, power: 5, toughness: 5 },
      { name: 'Sire of Stagnation', cmc: 6, power: 5, toughness: 7 },
    ],
  },
  {
    pattern: /simic|landfall|ramp/i,
    creatures: [
      { name: 'Llanowar Elves', cmc: 1, power: 1, toughness: 1 },
      { name: 'Lotus Cobra', cmc: 2, power: 2, toughness: 1 },
      { name: 'Tireless Provisioner', cmc: 3, power: 3, toughness: 2 },
      { name: 'Tatyova, Benthic Druid', cmc: 5, power: 3, toughness: 3 },
      { name: 'Avenger of Zendikar', cmc: 7, power: 5, toughness: 5 },
    ],
  },
  {
    pattern: /golgari|graveyard/i,
    creatures: [
      { name: 'Sakura-Tribe Elder', cmc: 2, power: 1, toughness: 1 },
      { name: 'Eternal Witness', cmc: 3, power: 2, toughness: 1 },
      { name: 'Ravenous Chupacabra', cmc: 4, power: 2, toughness: 2 },
      { name: 'Sheoldred, Whispering One', cmc: 7, power: 6, toughness: 6, menace: true },
    ],
  },
  {
    pattern: /orzhov|aristocrats|drain/i,
    creatures: [
      { name: 'Blood Artist', cmc: 2, power: 0, toughness: 1 },
      { name: 'Cruel Celebrant', cmc: 2, power: 1, toughness: 2 },
      { name: 'Woe Strider', cmc: 3, power: 3, toughness: 2 },
      { name: 'Elenda, the Dusk Rose', cmc: 4, power: 3, toughness: 3, lifelink: true },
    ],
  },
  {
    pattern: /izzet|spellslinger/i,
    creatures: [
      { name: 'Young Pyromancer', cmc: 2, power: 2, toughness: 1 },
      { name: 'Goblin Electromancer', cmc: 2, power: 2, toughness: 2 },
      { name: 'Third Path Iconoclast', cmc: 2, power: 2, toughness: 1 },
      { name: 'Crackling Drake', cmc: 4, power: 4, toughness: 4, flying: true },
    ],
  },
  {
    pattern: /gruul|stompy/i,
    creatures: [
      { name: 'Elvish Mystic', cmc: 1, power: 1, toughness: 1 },
      { name: 'Questing Beast', cmc: 4, power: 4, toughness: 4, vigilance: true, deathtouch: true, haste: true },
      { name: 'Terror of the Peaks', cmc: 5, power: 5, toughness: 4, flying: true },
      { name: 'Ghalta, Primal Hunger', cmc: 6, power: 12, toughness: 12, trample: true },
    ],
  },
  {
    pattern: /boros|voltron/i,
    creatures: [
      { name: 'Puresteel Paladin', cmc: 2, power: 2, toughness: 2 },
      { name: 'Stoneforge Mystic', cmc: 2, power: 1, toughness: 2 },
      { name: 'Aurelia, the Warleader', cmc: 6, power: 3, toughness: 4, flying: true, vigilance: true, haste: true },
    ],
  },
];

function shuffleArray<T>(list: T[]): T[] {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pushUniqueBounded(list: string[], item: string, limit = 12): string[] {
  const trimmed = item.trim();
  if (!trimmed) return list;
  const lower = trimmed.toLowerCase();
  const filtered = list.filter((x) => x.toLowerCase() !== lower);
  return [trimmed, ...filtered].slice(0, limit);
}

export function getCreatureRosterForArchetype(archetype: string): ArchetypeCardTemplate[] {
  const found = ARCHETYPE_CREATURES.find((entry) => entry.pattern.test(archetype));
  if (found) return found.creatures;
  return [
    { name: 'Vanguard Knight', cmc: 2, power: 2, toughness: 2, firstStrike: true },
    { name: 'Arcane Sentinel', cmc: 3, power: 3, toughness: 3, vigilance: true },
    { name: 'Skyward Dragon', cmc: 5, power: 4, toughness: 4, flying: true },
  ];
}

export function getPresetBotCardNames(archetypes: string[]): string[] {
  const names = new Set<string>();
  for (const arch of archetypes) {
    const roster = getCreatureRosterForArchetype(arch);
    for (const c of roster) {
      names.add(c.name);
    }
  }
  return Array.from(names);
}

function parsePt(val: string | undefined, fallback: number): number {
  if (!val) return fallback;
  const num = Number(val);
  return Number.isFinite(num) && num >= 0 ? num : fallback;
}

function getArchetypeRemovalSpellName(archetype: string): string {
  if (/azorius|control|boros|orzhov/i.test(archetype)) return 'Swords to Plowshares';
  if (/dimir|golgari/i.test(archetype)) return 'Go for the Throat';
  if (/mono-red|izzet|gruul/i.test(archetype)) return 'Abrade';
  if (/simic/i.test(archetype)) return 'Pongify';
  return 'Path to Exile';
}

function getArchetypeCounterSpellName(archetype: string): string {
  if (/azorius|control/i.test(archetype)) return 'Counterspell';
  if (/dimir|mill/i.test(archetype)) return 'Drown in the Loch';
  if (/simic/i.test(archetype)) return 'Negate';
  if (/izzet/i.test(archetype)) return 'Arcane Denial';
  return 'Mana Leak';
}

function getArchetypeDrawSpellName(archetype: string): string {
  if (/azorius|control|simic|izzet/i.test(archetype)) return 'Fact or Fiction';
  if (/dimir|golgari|orzhov/i.test(archetype)) return 'Night\'s Whisper';
  if (/mono-red|gruul|boros/i.test(archetype)) return 'Reckless Impulse';
  return 'Divination';
}

function getArchetypeBurnSpellName(archetype: string): string {
  if (/orzhov|aristocrats/i.test(archetype)) return 'Exsanguinate';
  if (/izzet/i.test(archetype)) return 'Lightning Bolt';
  return 'Price of Progress';
}

function getArchetypeMillSpellName(archetype: string): string {
  if (/dimir|mill/i.test(archetype)) return 'Maddening Cacophony';
  return 'Glimpse the Unthinkable';
}

function isExileRemovalSpell(cardName: string, meta?: CardMetadata | null): boolean {
  if (/swords to plowshares|path to exile|anguished unmaking|despark|farewell|merciless eviction/i.test(cardName)) {
    return true;
  }
  return /\bexile\b/i.test(meta?.oracleText || '');
}

export function createLiveBotZoneCardFromCreature(
  creature: LiveBotCreature,
  reason?: string
): LiveBotZoneCard {
  return {
    uid: `botz-${creature.uid}-${Math.random().toString(36).slice(2, 6)}`,
    name: creature.name,
    cmc: creature.meta?.cmc ?? Math.max(1, Math.min(6, Math.round((creature.power + creature.toughness) / 2))),
    typeLine: creature.meta?.typeLine || 'Creature',
    meta: creature.meta ?? null,
    reason,
  };
}

export function pushLiveBotZoneCard(
  bot: LiveBotState,
  zone: 'graveyard' | 'exile',
  card: Omit<LiveBotZoneCard, 'uid'> & { uid?: string }
): LiveBotState {
  const entry: LiveBotZoneCard = {
    uid: card.uid || `botz-${bot.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: card.name,
    cmc: card.cmc,
    typeLine: card.typeLine,
    meta: card.meta ?? null,
    reason: card.reason,
  };
  if (zone === 'exile') {
    const exileCards = [entry, ...(bot.exileCards || [])];
    return {
      ...bot,
      exileCards,
      exileCount: Math.max(bot.exileCount || 0, exileCards.length),
    };
  }
  const graveyardCards = [entry, ...(bot.graveyardCards || [])];
  return {
    ...bot,
    graveyardCards,
    graveyardCount: Math.max(bot.graveyardCount || 0, graveyardCards.length),
  };
}

function addBotZoneCardInPlace(
  bot: LiveBotState,
  zone: 'graveyard' | 'exile',
  card: Omit<LiveBotZoneCard, 'uid'> & { uid?: string }
): void {
  const entry: LiveBotZoneCard = {
    uid: card.uid || `botz-${bot.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: card.name,
    cmc: card.cmc,
    typeLine: card.typeLine,
    meta: card.meta ?? null,
    reason: card.reason,
  };
  if (zone === 'exile') {
    bot.exileCards = [entry, ...(bot.exileCards || [])];
    bot.exileCount = Math.max((bot.exileCount || 0) + 1, bot.exileCards.length);
  } else {
    bot.graveyardCards = [entry, ...(bot.graveyardCards || [])];
    bot.graveyardCount = Math.max((bot.graveyardCount || 0) + 1, bot.graveyardCards.length);
  }
}

function buildOpponentDeckRead(
  deckCtx: LivePlayerDeckContext | undefined,
  profile: BotLearningProfile | undefined
): string {
  if (!deckCtx) {
    return profile && profile.matchesPlayed > 0
      ? `Recalling ${profile.matchesPlayed} prior game${profile.matchesPlayed === 1 ? '' : 's'} (IQ ${profile.botIqScore}).`
      : 'Scouting your opening plays.';
  }

  const parts: string[] = [];
  if (deckCtx.commanderNames.length > 0) {
    parts.push(`Watching Cmdr ${deckCtx.commanderNames[0]}`);
  } else if (deckCtx.deckName) {
    parts.push(`Scouting ${deckCtx.deckName}`);
  }

  if (deckCtx.avgCmc > 0 && deckCtx.avgCmc <= 2.6) {
    parts.push('fast low-curve pressure');
  } else if (deckCtx.avgCmc >= 3.6) {
    parts.push('high-MV late-game threats');
  }

  if (deckCtx.tappedLandCount >= 8) {
    parts.push('punishing slow tapped lands');
  }

  if (profile?.knownPlayerThreats && profile.knownPlayerThreats.length > 0) {
    parts.push(`remembering ${profile.knownPlayerThreats.slice(0, 2).join(', ')}`);
  }

  return parts.join(' · ') || 'Adapting to your deck in real time.';
}

export function createInitialLiveBots(
  opponents: BotOpponentConfig[],
  startingLife: number,
  format: Exclude<DeckFormat, 'auto'>,
  findMeta: (name: string) => CardMetadata | null,
  botMemory?: Record<string, BotLearningProfile>,
  playerDeckContext?: LivePlayerDeckContext
): LiveBotState[] {
  const inferredMode = opponents.length <= 1 ? '1v1' : opponents.length === 2 ? '1v2' : '1v3';
  const formatRules = getFormatSimulationRules(format, inferredMode);

  return opponents.map((opp, idx) => {
    let customResolved: ResolvedDeckCard[] = [];
    if (opp.customDeckText && opp.customDeckText.trim()) {
      const parsed = parseDecklistClientSide(opp.customDeckText);
      customResolved = parsed.cards.map((c) => ({
        ...c,
        card: findMeta(c.name),
      }));
      if (formatRules.allowsCommandZone) {
        const totalQty = customResolved
          .filter((c) => c.zone === 'main' || c.zone === 'commander')
          .reduce((s, c) => s + c.quantity, 0);
        const botFmt: Exclude<DeckFormat, 'auto'> =
          customResolved.some((c) => c.zone === 'commander') || totalQty >= 85
            ? format === 'brawl'
              ? 'brawl'
              : 'commander'
            : format;
        autoRecognizeCommandersClientSide(customResolved, botFmt);
      } else {
        customResolved = customResolved.map((c) =>
          c.zone === 'commander' ? { ...c, zone: 'main' as const } : c
        );
      }
    }

    const bias = detectArchetypeCombatBias(opp, customResolved, format);
    const cmdName = formatRules.allowsCommandZone
      ? bias.defaultCommanderName || `${opp.name} Commander`
      : '';
    const cmdMeta = cmdName ? findMeta(cmdName) : null;
    const cmdMech = cmdName ? detectCardMechanics(cmdName, cmdMeta) : null;

    const customDeckPool: LiveBotDeckCard[] = [];
    for (const item of customResolved) {
      const countsAsMain =
        item.zone === 'main' || (!formatRules.allowsCommandZone && item.zone === 'commander');
      if (!countsAsMain) continue;
      const meta = item.card || findMeta(item.name);
      const mech = detectCardMechanics(item.name, meta);
      const oracle = (meta?.oracleText || '').toLowerCase();
      const isLand =
        Boolean(meta?.isLand) ||
        /\b(plains|island|swamp|mountain|forest|wastes|command tower|exotic orchard)\b/i.test(item.name);
      const isCreature = /\bcreature\b/i.test(meta?.typeLine || '');
      const isCounterspell = /\bcounter target (spell|creature|noncreature|instant|sorcery|artifact|enchantment)\b/i.test(
        oracle
      );
      const drawMatch = oracle.match(/draw (a|one|two|three|four|\d+) card/i);
      let drawCount = 0;
      if (drawMatch) {
        const word = drawMatch[1].toLowerCase();
        drawCount =
          word === 'a' || word === 'one'
            ? 1
            : word === 'two'
            ? 2
            : word === 'three'
            ? 3
            : word === 'four'
            ? 4
            : Math.min(4, Number(word) || 1);
      }
      const lifeMatch = oracle.match(/you gain (\d+) life/i);
      const lifegainAmount = lifeMatch ? Math.min(10, Number(lifeMatch[1]) || 0) : 0;
      const kw = extractCreatureKeywords(meta);

      const cardObj: LiveBotDeckCard = {
        ...kw,
        name: item.name,
        cmc: meta?.cmc ?? (isLand ? 0 : 3),
        isLand,
        entersTapped: Boolean(meta?.entersTappedLikely),
        isCreature,
        isBoardWipe: mech.isBoardWipe,
        isRemoval: mech.isCounterOrRemoval && !isCounterspell,
        isCounterspell,
        isRamp: Boolean(meta?.isRamp),
        drawCount,
        lifegainAmount,
        power: isCreature ? parsePt(meta?.power, Math.max(2, mech.estimatedPower || 2)) : 0,
        toughness: isCreature ? parsePt(meta?.toughness, 2) : 0,
        hasInfect: mech.hasInfect,
        toxicValue: mech.toxicValue,
        burnAmount: mech.burnOrDrainAmount,
        millAmount: mech.millAmount,
        meta,
      };
      for (let q = 0; q < Math.max(1, item.quantity); q++) {
        customDeckPool.push(cardObj);
      }
    }

    const shuffledCustom = shuffleArray(customDeckPool);
    const customHand = shuffledCustom.splice(0, Math.min(7, shuffledCustom.length));
    const botDeckRules = getFormatSimulationRules(
      format,
      inferredMode,
      customDeckPool.length > 0 ? customDeckPool.length : undefined
    );
    const libraryCount =
      shuffledCustom.length > 0
        ? shuffledCustom.length
        : Math.max(1, botDeckRules.targetMainDeckSize - 7);

    const profileKey = resolveBotLearningKey(opp);
    const savedProfile = botMemory?.[profileKey];
    const pastBriefing = buildBotPastPlayBriefing(savedProfile, playerDeckContext?.deckName);
    const seededThreats = [
      ...(savedProfile?.knownPlayerThreats || []).slice(0, 6),
      ...(playerDeckContext?.commanderNames || []),
      ...(playerDeckContext?.keyThreats || []).slice(0, 4),
    ].reduce<string[]>((acc, name) => pushUniqueBounded(acc, name, 10), []);

    const deckIdentitySummary = opp.customDeckText?.trim()
      ? cmdName
        ? `Custom Deck (${cmdName} · ${customDeckPool.length + (cmdName ? 1 : 0)} cards)`
        : `Custom Deck (${customDeckPool.length} cards)`
      : cmdName
      ? `${opp.archetype} (${cmdName})`
      : opp.archetype;

    const opponentDeckRead = buildOpponentDeckRead(playerDeckContext, savedProfile);

    const intelMeta = getBotIntelligenceMeta(opp.intelligence);
    const initialHoldMana =
      intelMeta.holdsInteractionMana &&
      (bias.usesControl ||
        intelMeta.id === 'mastermind' ||
        Boolean(
          savedProfile?.tacticalDirectives.some((d) => /hold|counter|commander/i.test(d))
        ));

    return {
      id: opp.id || `bot-${idx + 1}`,
      name: opp.name,
      archetype: opp.customDeckText?.trim() ? 'Custom Decklist' : opp.archetype,
      indignance: opp.indignance || 'measured',
      intelligence: intelMeta.id,
      commanderName: cmdName,
      commanderPower: cmdName ? parsePt(cmdMeta?.power, Math.max(3, cmdMech?.estimatedPower || 4)) : 0,
      commanderToughness: cmdName ? parsePt(cmdMeta?.toughness, 4) : 0,
      commanderCmc: cmdName ? (cmdMeta?.cmc ?? (bias.usesVoltronCommander ? 3 : 4)) : 0,
      commanderMeta: cmdMeta,
      commanderInZone: formatRules.allowsCommandZone,
      commanderTax: 0,
      startingLife,
      life: startingLife,
      poison: 0,
      commanderDamageTakenFromYou: 0,
      commanderDamageDealtToYou: 0,
      landsInPlay: 0,
      tappedLands: 0,
      manaBonusFromRamp: 0,
      handCount: customHand.length > 0 ? customHand.length : 7,
      libraryCount,
      graveyardCount: 0,
      exileCount: 0,
      graveyardCards: [],
      exileCards: [],
      creatures: [],
      bias,
      allowsCommandZone: formatRules.allowsCommandZone,
      usesCommanderDamage21: formatRules.usesCommanderDamage21,
      customLibrary: shuffledCustom,
      customHand,
      lastActionSummary: 'Opening 7 kept. Ready for Turn 1.',
      lastTargetName: '—',
      lastTurnSteps: [],
      liveMemory: {
        profileKey,
        botIqScore: savedProfile?.botIqScore ?? 100,
        priorMatchesPlayed: savedProfile?.matchesPlayed ?? 0,
        deckIdentitySummary,
        opponentDeckRead,
        grudgeScore: opp.indignance === 'vindictive' ? 16 : 0,
        rivalGrudgeByBotId: {},
        commanderDamageDealtToRivals: {},
        priorRivalThreatByName: { ...pastBriefing.rivalThreatByName },
        consecutiveTurnsOnSameTarget: 0,
        observedUserThreats: seededThreats,
        observedUserHabits: (savedProfile?.observedPlayerWeaknesses || []).slice(0, 4),
        userAggressionCount: 0,
        userManaStumbles: 0,
        userOpenManaPasses: 0,
        userBlockCount: 0,
        userTookUnblockedCount: 0,
        holdManaForInteraction: initialHoldMana,
        defensivePosture: false,
        countersUsedThisGame: 0,
        lastAdaptationNote: opponentDeckRead,
        adaptationHistory: [],
        damageDealtToPlayer: 0,
        damageTakenFromPlayer: 0,
        damageDealtToRivals: 0,
        damageTakenFromRivals: 0,
        biggestRivalThreatName: '',
        spellsCastCount: 0,
        creaturesPlayedCount: 0,
      },
      eliminated: false,
      eliminatedReason: null,
    };
  });
}

/**
 * Called in real time whenever the user performs an action during a Live Game.
 * Updates every surviving bot's live memory, threat priority, grudge score, and
 * optionally allows a Control/Midrange bot that deliberately held mana open to
 * react with a real counterspell against high-impact plays or known threats.
 */
export function recordUserActionForBots(
  bots: LiveBotState[],
  event: LiveUserActionEvent,
  playerDeckContext?: LivePlayerDeckContext,
  options?: { skipReactiveCounter?: boolean; targetSpellUncounterable?: boolean }
): UserActionBotReaction {
  let counteredByBotName: string | null = null;
  let counteredByBotId: string | null = null;
  let counteredBySeatNumber: number | null = null;
  let counterSpellName: string | null = null;
  let counterSpellCmc = 2;
  let counterReason: string | null = null;
  const adaptationLogs: string[] = [];

  const updatedBots = bots.map((origBot, botIdx) => {
    if (origBot.eliminated) return origBot;

    const mem: BotLiveMemoryState = {
      ...origBot.liveMemory,
      rivalGrudgeByBotId: { ...(origBot.liveMemory.rivalGrudgeByBotId || {}) },
      commanderDamageDealtToRivals: { ...(origBot.liveMemory.commanderDamageDealtToRivals || {}) },
      priorRivalThreatByName: { ...(origBot.liveMemory.priorRivalThreatByName || {}) },
      observedUserThreats: [...origBot.liveMemory.observedUserThreats],
      observedUserHabits: [...origBot.liveMemory.observedUserHabits],
      adaptationHistory: [...origBot.liveMemory.adaptationHistory],
    };

    const bot: LiveBotState = {
      ...origBot,
      graveyardCards: [...(origBot.graveyardCards || [])],
      exileCards: [...(origBot.exileCards || [])],
      customHand: [...origBot.customHand],
      liveMemory: mem,
    };

    const recordAdaptation = (note: string) => {
      mem.lastAdaptationNote = note;
      mem.adaptationHistory = pushUniqueBounded(mem.adaptationHistory, note, 14);
    };

    if (event.type === 'play-land') {
      if (event.isTappedLand && event.turn <= 4) {
        mem.observedUserHabits = pushUniqueBounded(
          mem.observedUserHabits,
          `Slow tapped-land start (${event.cardName || 'tapped land'} on T${event.turn})`,
          8
        );
        recordAdaptation(`Noted tapped land on T${event.turn} — pressing tempo while you develop.`);
      }
    } else if (event.type === 'missed-land') {
      mem.userManaStumbles += 1;
      mem.observedUserHabits = pushUniqueBounded(
        mem.observedUserHabits,
        `Missed land drop on T${event.turn}`,
        8
      );
      if (mem.userManaStumbles >= 1) {
        recordAdaptation(
          `Detected missed land drop on T${event.turn} — tracking tempo opening.`
        );
      }
    } else if (event.type === 'pass-open-mana') {
      mem.userOpenManaPasses += 1;
      if ((event.openMana || 0) >= 2) {
        mem.observedUserHabits = pushUniqueBounded(
          mem.observedUserHabits,
          `Passed with ${event.openMana} open mana (possible instant interaction)`,
          8
        );
        recordAdaptation(
          `Respecting ${event.openMana} open mana — sequencing bait spells before key threats.`
        );
      }
    } else if (event.type === 'cast-ramp') {
      if (event.cardName) {
        mem.observedUserThreats = pushUniqueBounded(mem.observedUserThreats, event.cardName, 12);
      }
      mem.grudgeScore = Math.min(100, mem.grudgeScore + 2);
      mem.observedUserHabits = pushUniqueBounded(
        mem.observedUserHabits,
        `Accelerated mana with ${event.cardName || 'ramp'} on T${event.turn}`,
        8
      );
      if (bot.bias.usesControl || mem.botIqScore >= 115) {
        mem.holdManaForInteraction = true;
      }
      recordAdaptation(
        `Saw early ramp (${event.cardName || 'mana rock'}) — holding interaction for table payoffs.`
      );
    } else if (event.type === 'cast-commander' || event.type === 'cast-creature' || event.type === 'cast-spell') {
      const cardName = event.cardName || 'spell';
      const isKnownThreat = mem.observedUserThreats.some(
        (t) => t.toLowerCase() === cardName.toLowerCase()
      );
      const isHighImpact =
        Boolean(event.isCommander) ||
        (event.cmc || 0) >= 4 ||
        (event.power || 0) >= 4 ||
        isKnownThreat;

      if (isHighImpact) {
        mem.observedUserThreats = pushUniqueBounded(mem.observedUserThreats, cardName, 12);
      }
      if (event.isCommander) {
        mem.grudgeScore = Math.min(100, mem.grudgeScore + 4);
        mem.observedUserHabits = pushUniqueBounded(
          mem.observedUserHabits,
          `Deployed Commander ${cardName} on T${event.turn}`,
          8
        );
      }

      // Reactive instant-speed counterspell check if this bot intentionally held mana open!
      const untappedLands = Math.max(0, bot.landsInPlay - bot.tappedLands);
      const customCounterIdx = bot.customHand.findIndex(
        (c) => c.isCounterspell && c.cmc <= untappedLands
      );
      const botIntel = getBotIntelligenceMeta(bot.intelligence);
      const canPresetCounter =
        bot.customHand.length === 0 &&
        (bot.bias.usesControl || botIntel.id === 'mastermind') &&
        mem.holdManaForInteraction &&
        untappedLands >= 2 &&
        bot.handCount >= 1 &&
        mem.countersUsedThisGame < botIntel.maxPresetCounters;

      if (
        !options?.skipReactiveCounter &&
        !options?.targetSpellUncounterable &&
        !counteredByBotName &&
        isHighImpact &&
        (customCounterIdx >= 0 || canPresetCounter) &&
        (event.isCommander || isKnownThreat || (event.cmc || 0) >= (botIntel.id === 'mastermind' ? 3 : 4))
      ) {
        const baseCounterChance = event.isCommander
          ? 0.72
          : isKnownThreat
          ? 0.58
          : 0.44;
        const counterChance = Math.min(0.95, baseCounterChance * botIntel.counterChanceMult);
        if (Math.random() < counterChance || (customCounterIdx >= 0 && botIntel.id !== 'novice')) {
          let spellLabel = getArchetypeCounterSpellName(bot.archetype);
          let spellMeta: CardMetadata | null = null;
          let manaSpent = 2;
          if (customCounterIdx >= 0) {
            const [counterCard] = bot.customHand.splice(customCounterIdx, 1);
            spellLabel = counterCard.name;
            spellMeta = counterCard.meta ?? null;
            manaSpent = Math.max(1, counterCard.cmc);
          }
          bot.tappedLands = Math.min(bot.landsInPlay, bot.tappedLands + manaSpent);
          bot.handCount = Math.max(0, bot.handCount - 1);
          addBotZoneCardInPlace(bot, 'graveyard', {
            name: spellLabel,
            cmc: manaSpent,
            typeLine: spellMeta?.typeLine || 'Instant',
            meta: spellMeta,
            reason: `Cast countering ${cardName}`,
          });
          mem.countersUsedThisGame += 1;
          mem.spellsCastCount += 1;
          counteredByBotName = bot.name;
          counteredByBotId = bot.id;
          counteredBySeatNumber = botIdx + 2;
          counterSpellName = spellLabel;
          counterSpellCmc = manaSpent;

          const reason = event.isCommander
            ? `Held ${manaSpent} open mana anticipating your Commander — put ${spellLabel} on the stack targeting ${cardName}!`
            : `Recognized ${cardName} as a key threat from your ${playerDeckContext?.archetype || 'deck'} — responded on the stack with ${spellLabel}!`;
          counterReason = reason;
          recordAdaptation(reason);
          bot.lastActionSummary = `Responded with ${spellLabel} on ${cardName}`;
          adaptationLogs.push(`[${bot.name} Stack Response] ${reason}`);
        }
      } else if (isHighImpact) {
        recordAdaptation(
          `Flagged ${cardName} as high priority — saving removal or blockers.`
        );
      }
    } else if (event.type === 'counter-bot-spell') {
      const yourCounter = event.cardName || 'Counterspell';
      const deniedSpell = event.counteredSpellName || 'spell';
      mem.observedUserHabits = pushUniqueBounded(
        mem.observedUserHabits,
        `Runs countermagic (${yourCounter})`,
        8
      );
      if (event.targetBotId === bot.id) {
        mem.grudgeScore = Math.min(100, mem.grudgeScore + 10);
        mem.holdManaForInteraction = true;
        const note = `You countered ${deniedSpell} with ${yourCounter} — baiting countermagic before key threats.`;
        recordAdaptation(note);
        adaptationLogs.push(`[${bot.name} Learned] ${note}`);
      } else {
        recordAdaptation(`Noted your ${yourCounter} on the stack — respecting open blue mana.`);
      }
    } else if (event.type === 'protect-permanent') {
      const protSpell = event.cardName || 'Protection spell';
      mem.observedUserHabits = pushUniqueBounded(
        mem.observedUserHabits,
        `Holds instant protection (${protSpell})`,
        8
      );
      if (event.targetBotId === bot.id) {
        mem.grudgeScore = Math.min(100, mem.grudgeScore + 6);
        const note = `Removal fizzled against ${protSpell} — waiting for shields-down windows.`;
        recordAdaptation(note);
        adaptationLogs.push(`[${bot.name} Learned] ${note}`);
      }
    } else if (event.type === 'instant-combat-trick') {
      const trickSpell = event.cardName || 'Combat trick';
      mem.observedUserHabits = pushUniqueBounded(
        mem.observedUserHabits,
        `Plays instant combat tricks (${trickSpell})`,
        8
      );
      if (event.targetBotId === bot.id) {
        const note = `Noted combat blowouts (${trickSpell}) — respecting open mana during attacks.`;
        recordAdaptation(note);
        adaptationLogs.push(`[${bot.name} Learned] ${note}`);
      }
    } else if (event.type === 'attack-bot') {
      const dmg = event.damageDealt || 0;
      const poison = event.poisonDealt || 0;
      const cmdr = event.commanderDamageDealt || 0;
      if (event.targetBotId === bot.id) {
        mem.userAggressionCount += 1;
        mem.damageTakenFromPlayer += dmg;
        const grudgeGain =
          14 +
          Math.min(25, dmg * 2) +
          poison * 6 +
          cmdr * 3 +
          (bot.indignance === 'vindictive' ? 18 : bot.indignance === 'ruthless' ? 8 : 0);
        mem.grudgeScore = Math.min(100, mem.grudgeScore + grudgeGain);
        if (bot.life - dmg <= Math.round(bot.startingLife * 0.55) || cmdr >= 6 || poison >= 3) {
          mem.defensivePosture = true;
        }
        mem.observedUserHabits = pushUniqueBounded(
          mem.observedUserHabits,
          `Targeted ${bot.name} in combat (${dmg} dmg${cmdr > 0 ? `, ${cmdr} cmdr` : ''})`,
          8
        );
        const note = mem.defensivePosture
          ? `Taking heavy focus (${dmg} dmg) — shifting defensive, holding blockers & retaliating.`
          : `You attacked ${bot.name} (${dmg} dmg) — raising threat priority on You (grudge ${mem.grudgeScore}).`;
        recordAdaptation(note);
        adaptationLogs.push(`[${bot.name} Learned] ${note}`);
      } else if (dmg >= 5) {
        mem.grudgeScore = Math.min(100, mem.grudgeScore + 5);
        recordAdaptation(`Saw you deal ${dmg} dmg to another seat — tracking your board threat.`);
      }
    } else if (event.type === 'block-bot') {
      if (event.targetBotId === bot.id) {
        mem.userBlockCount += 1;
        mem.observedUserHabits = pushUniqueBounded(
          mem.observedUserHabits,
          `Willing to block combat threats (${event.blockedCount || 1} blocker${(event.blockedCount || 1) === 1 ? '' : 's'})`,
          8
        );
        recordAdaptation(
          `Noted your combat blocks — favoring evasive attackers or removal before swinging.`
        );
      }
    } else if (event.type === 'take-unblocked') {
      if (event.targetBotId === bot.id) {
        mem.userTookUnblockedCount += 1;
        mem.damageDealtToPlayer += event.unblockedDamage || 0;
        mem.observedUserHabits = pushUniqueBounded(
          mem.observedUserHabits,
          `Took ${event.unblockedDamage || 0} unblocked damage`,
          8
        );
        recordAdaptation(
          `You absorbed ${event.unblockedDamage || 0} dmg unblocked — keeping combat pressure high.`
        );
      }
    } else if (event.type === 'mulligan') {
      mem.observedUserHabits = pushUniqueBounded(
        mem.observedUserHabits,
        'Mulliganed opening hand (lower starting card count)',
        8
      );
      recordAdaptation('Noted your mulligan — pressuring card advantage early.');
    }

    return bot;
  });

  return {
    updatedBots,
    counteredByBotName,
    counteredByBotId,
    counteredBySeatNumber,
    counterSpellName,
    counterSpellCmc,
    counterReason,
    adaptationLogs,
  };
}

/**
 * Evaluates whether any surviving bot with open mana wants to fight back on the Stack
 * (e.g. during a Counter War when the user counters a bot's spell or casts a huge instant).
 */
export function evaluateBotCounterWarResponse(
  bots: LiveBotState[],
  playerSpellName: string,
  playerSpellUncounterable: boolean,
  preferredBotId?: string
): UserActionBotReaction {
  let counteredByBotName: string | null = null;
  let counteredByBotId: string | null = null;
  let counteredBySeatNumber: number | null = null;
  let counterSpellName: string | null = null;
  let counterSpellCmc = 2;
  let counterReason: string | null = null;
  const adaptationLogs: string[] = [];

  if (playerSpellUncounterable) {
    return {
      updatedBots: bots,
      counteredByBotName: null,
      counteredByBotId: null,
      counteredBySeatNumber: null,
      counterSpellName: null,
      counterSpellCmc: 0,
      counterReason: null,
      adaptationLogs,
    };
  }

  // Order candidates so the bot whose spell is being countered gets first look
  const orderedIndices = bots
    .map((_, idx) => idx)
    .sort((a, b) => {
      if (preferredBotId) {
        if (bots[a].id === preferredBotId) return -1;
        if (bots[b].id === preferredBotId) return 1;
      }
      return a - b;
    });

  const nextBots = bots.map((b) => ({
    ...b,
    graveyardCards: [...(b.graveyardCards || [])],
    exileCards: [...(b.exileCards || [])],
    customHand: [...b.customHand],
    liveMemory: {
      ...b.liveMemory,
      rivalGrudgeByBotId: { ...(b.liveMemory.rivalGrudgeByBotId || {}) },
      commanderDamageDealtToRivals: { ...(b.liveMemory.commanderDamageDealtToRivals || {}) },
      priorRivalThreatByName: { ...(b.liveMemory.priorRivalThreatByName || {}) },
      observedUserThreats: [...b.liveMemory.observedUserThreats],
      observedUserHabits: [...b.liveMemory.observedUserHabits],
      adaptationHistory: [...b.liveMemory.adaptationHistory],
    },
  }));

  for (const idx of orderedIndices) {
    const bot = nextBots[idx];
    if (!bot || bot.eliminated) continue;

    const untappedMana = Math.max(0, bot.landsInPlay - bot.tappedLands + bot.manaBonusFromRamp);
    const customCounterIdx = bot.customHand.findIndex(
      (c) => c.isCounterspell && c.cmc <= untappedMana
    );
    const botIntel = getBotIntelligenceMeta(bot.intelligence);
    const canPresetCounter =
      bot.customHand.length === 0 &&
      (bot.bias.usesControl || botIntel.id === 'mastermind') &&
      untappedMana >= 2 &&
      bot.handCount >= 1 &&
      bot.liveMemory.countersUsedThisGame < botIntel.maxPresetCounters;

    if (customCounterIdx < 0 && !canPresetCounter) continue;

    const baseFightChance = bot.id === preferredBotId ? 0.62 : 0.34;
    const fightChance = Math.min(0.95, baseFightChance * botIntel.counterWarMult);
    if (
      (customCounterIdx >= 0 && botIntel.id !== 'novice') ||
      Math.random() < fightChance
    ) {
      let spellLabel = getArchetypeCounterSpellName(bot.archetype);
      let spellMeta: CardMetadata | null = null;
      let manaSpent = 2;
      if (customCounterIdx >= 0) {
        const [counterCard] = bot.customHand.splice(customCounterIdx, 1);
        spellLabel = counterCard.name;
        spellMeta = counterCard.meta ?? null;
        manaSpent = Math.max(1, counterCard.cmc);
      }
      bot.tappedLands = Math.min(bot.landsInPlay, bot.tappedLands + manaSpent);
      bot.handCount = Math.max(0, bot.handCount - 1);
      addBotZoneCardInPlace(bot, 'graveyard', {
        name: spellLabel,
        cmc: manaSpent,
        typeLine: spellMeta?.typeLine || 'Instant',
        meta: spellMeta,
        reason: `Stack war vs ${playerSpellName}`,
      });
      bot.liveMemory.countersUsedThisGame += 1;
      bot.liveMemory.spellsCastCount += 1;

      counteredByBotName = bot.name;
      counteredByBotId = bot.id;
      counteredBySeatNumber = idx + 2;
      counterSpellName = spellLabel;
      counterSpellCmc = manaSpent;
      counterReason =
        bot.id === preferredBotId
          ? `Fought back on the stack with ${spellLabel} to protect its spell from ${playerSpellName}!`
          : `Jumped into the stack war with ${spellLabel} targeting your ${playerSpellName}!`;
      bot.liveMemory.lastAdaptationNote = counterReason;
      bot.liveMemory.adaptationHistory = pushUniqueBounded(
        bot.liveMemory.adaptationHistory,
        counterReason,
        14
      );
      bot.lastActionSummary = `Stack War: ${spellLabel} on ${playerSpellName}`;
      adaptationLogs.push(`[${bot.name} Stack War] ${counterReason}`);
      break;
    }
  }

  return {
    updatedBots: nextBots,
    counteredByBotName,
    counteredByBotId,
    counteredBySeatNumber,
    counterSpellName,
    counterSpellCmc,
    counterReason,
    adaptationLogs,
  };
}

function scoreEnemyCreatureThreat(
  creature: {
    name: string;
    power: number;
    toughness: number;
    isCommander: boolean;
    hasInfect: boolean;
    toxicValue: number;
    flying?: boolean;
    deathtouch?: boolean;
    lifelink?: boolean;
    hexproof?: boolean;
    indestructible?: boolean;
  },
  bot: LiveBotState
): number {
  if (creature.hexproof) return -1;
  let score = creature.power * 2.4 + creature.toughness * 0.4;
  if (creature.isCommander) score += 14;
  if (creature.hasInfect) score += 12 + creature.power * 1.8;
  if (creature.toxicValue > 0) score += 6 + creature.toxicValue * 3;
  if (creature.flying) score += 3.5;
  if (creature.deathtouch) score += 3;
  if (creature.lifelink) score += 2.5;
  if (creature.indestructible) score -= 18;
  if (
    bot.liveMemory.observedUserThreats.some(
      (t) => t.toLowerCase() === creature.name.toLowerCase()
    )
  ) {
    score += 9;
  }
  return score;
}

type BotTargetRef =
  | { kind: 'player'; label: 'You' }
  | { kind: 'bot'; targetBotId: string; targetBotName: string; label: string };

interface ScoredBotTarget {
  ref: BotTargetRef;
  score: number;
  reason: string;
}

function rankBotTargets(
  bot: LiveBotState,
  allBots: LiveBotState[],
  player: PlayerBoardSnapshot,
  targetsHitThisRound: Record<string, number> = {}
): ScoredBotTarget[] {
  const rivals = allBots.filter((b) => b.id !== bot.id && !b.eliminated);
  const playerAlive =
    player.life > 0 &&
    player.poison < 10 &&
    !(bot.usesCommanderDamage21 && bot.commanderDamageDealtToYou >= 21);

  if (!playerAlive && rivals.length > 0) {
    return [...rivals]
      .sort((a, b) => a.life - b.life)
      .map((r, i) => ({
        ref: { kind: 'bot', targetBotId: r.id, targetBotName: r.name, label: r.name },
        score: 100 - i * 10,
        reason: `Focused remaining rival ${r.name}.`,
      }));
  }
  if (rivals.length === 0) {
    return [{ ref: { kind: 'player', label: 'You' }, score: 100, reason: '1v1 duel.' }];
  }

  const readyAttackers = bot.creatures.filter(
    (c) => !c.tapped && (!c.summoningSick || c.haste) && c.power > 0
  );
  const botReadyPower = readyAttackers.reduce((s, c) => s + c.power, 0);
  const botHasFlyingAttacker = readyAttackers.some((c) => c.flying);
  const botCommanderReady = readyAttackers.find((c) => c.isCommander);

  // Build normalized candidate table metrics for You + every living rival bot
  interface SeatEval {
    ref: BotTargetRef;
    seatKey: string;
    life: number;
    poison: number;
    cmdDmgFromMe: number;
    boardPower: number;
    creatureCount: number;
    untappedBlockers: number;
    untappedFlyReachBlockers: number;
    untappedPower: number;
    landsTotal: number;
    handCount: number;
    hasCommander: boolean;
    grudge: number;
    priorLearnedThreat: number;
    alreadyHitThisRound: number;
    isPlayer: boolean;
  }

  const seats: SeatEval[] = [];
  if (playerAlive) {
    const pUntapped = player.creatures.filter((c) => !c.tapped);
    seats.push({
      ref: { kind: 'player', label: 'You' },
      seatKey: 'You',
      life: player.life,
      poison: player.poison,
      cmdDmgFromMe: bot.commanderDamageDealtToYou,
      boardPower: player.creatures.reduce((s, c) => s + c.power, 0),
      creatureCount: player.creatures.length,
      untappedBlockers: pUntapped.length,
      untappedFlyReachBlockers: pUntapped.filter((c) => c.flying || c.reach).length,
      untappedPower: pUntapped.reduce((s, c) => s + c.power, 0),
      landsTotal: player.landsCount,
      handCount: player.handCount ?? 4,
      hasCommander: player.hasCommanderInPlay || player.creatures.some((c) => c.isCommander),
      grudge: bot.liveMemory.grudgeScore,
      priorLearnedThreat: 0,
      alreadyHitThisRound: targetsHitThisRound['You'] || 0,
      isPlayer: true,
    });
  }

  for (const r of rivals) {
    const rUntapped = r.creatures.filter((c) => !c.tapped);
    seats.push({
      ref: { kind: 'bot', targetBotId: r.id, targetBotName: r.name, label: r.name },
      seatKey: r.name,
      life: r.life,
      poison: r.poison,
      cmdDmgFromMe: bot.liveMemory.commanderDamageDealtToRivals?.[r.id] || 0,
      boardPower: r.creatures.reduce((s, c) => s + c.power, 0),
      creatureCount: r.creatures.length,
      untappedBlockers: rUntapped.length,
      untappedFlyReachBlockers: rUntapped.filter((c) => c.flying || c.reach).length,
      untappedPower: rUntapped.reduce((s, c) => s + c.power, 0),
      landsTotal: r.landsInPlay + r.manaBonusFromRamp,
      handCount: r.handCount,
      hasCommander: r.creatures.some((c) => c.isCommander),
      grudge: bot.liveMemory.rivalGrudgeByBotId?.[r.id] || 0,
      priorLearnedThreat:
        bot.liveMemory.priorRivalThreatByName?.[r.name.trim().toLowerCase()] || 0,
      alreadyHitThisRound: targetsHitThisRound[r.name] || targetsHitThisRound[r.id] || 0,
      isPlayer: false,
    });
  }

  // Identify the table's leading seat (board power + mana + untouched life)
  const seatLeadScores = seats.map(
    (s) => s.boardPower * 1.6 + s.landsTotal * 1.1 + s.life * 0.25 + (s.hasCommander ? 6 : 0)
  );
  const maxLeadScore = Math.max(...seatLeadScores, 1);

  const scored: ScoredBotTarget[] = seats.map((seat, idx) => {
    const canLethal =
      botReadyPower > 0 &&
      (botReadyPower - seat.untappedPower >= seat.life ||
        (bot.bias.usesInfect &&
          botReadyPower - seat.untappedPower >= Math.max(1, 10 - seat.poison)) ||
        (bot.usesCommanderDamage21 &&
          Boolean(botCommanderReady) &&
          (botCommanderReady?.power || 0) + seat.cmdDmgFromMe >= 21));

    const lethalBonus = canLethal ? 165 : 0;

    // 1. Symmetric board, mana, and Commander threat (identical rubric for You and Rival Bots)
    const threatScore =
      seat.boardPower * 1.45 +
      seat.creatureCount * 1.1 +
      (seat.hasCommander ? 6 : 0) +
      seat.landsTotal * 0.85 +
      (seat.handCount >= 6 ? 2.5 : 0) +
      seat.life * 0.14;

    // 2. Open-lane & blocker accessibility (strongly prefers open seats or flying lanes!)
    const openLaneScore =
      seat.untappedBlockers === 0
        ? 7.5
        : botHasFlyingAttacker && seat.untappedFlyReachBlockers === 0
        ? 5.5
        : -Math.min(7, seat.untappedBlockers * 1.65);

    // 3. Symmetric grudge retaliation + learned rival pod history
    const grudgeScore = seat.grudge * 0.45 + seat.priorLearnedThreat * 0.65;

    // 4. Clock momentum (poison / commander damage / low life finish)
    const clockScore =
      seat.poison * 2.1 +
      (bot.usesCommanderDamage21 ? seat.cmdDmgFromMe * 0.7 : 0) +
      (seat.life <= Math.round(bot.startingLife * 0.35) ? 4.5 : 0);

    // 5. Multiplayer pod politics: anti-dogpile & untouched table-leader bounty
    const isTableLeader = seatLeadScores[idx] >= maxLeadScore - 1.5 && maxLeadScore >= 12;
    const leaderBounty = isTableLeader ? (bot.indignance === 'ruthless' ? 8.5 : 5.5) : 0;
    const antiDogpilePenalty =
      !canLethal && seat.alreadyHitThisRound > 0 && bot.indignance !== 'vindictive'
        ? seat.alreadyHitThisRound * 7.5
        : 0;

    // 6. Anti-tunneling rotation so bots don't mindlessly focus one seat every turn
    const repeatedSameTarget = bot.lastTargetName === seat.seatKey;
    const repeatStreak = repeatedSameTarget
      ? Math.max(1, bot.liveMemory.consecutiveTurnsOnSameTarget || 1)
      : 0;
    let antiTunnelPenalty = 0;
    if (repeatedSameTarget && !canLethal) {
      if (bot.indignance === 'forgiving') {
        antiTunnelPenalty = 9 * repeatStreak;
      } else if (bot.indignance === 'measured' && !isTableLeader) {
        antiTunnelPenalty = 5.5 * repeatStreak;
      } else if (bot.indignance === 'ruthless' && !isTableLeader) {
        antiTunnelPenalty = 3.0 * repeatStreak;
      }
    }

    // 7. Calibrated indignance modifier (Measured & Ruthless have 0 blind player bias!)
    let indignanceModifier = 0;
    if (seat.isPlayer) {
      if (bot.indignance === 'vindictive') {
        indignanceModifier = 12;
      } else if (bot.indignance === 'forgiving') {
        indignanceModifier = -5;
      }
    }

    const total =
      lethalBonus +
      threatScore +
      openLaneScore +
      grudgeScore +
      clockScore +
      leaderBounty -
      antiDogpilePenalty -
      antiTunnelPenalty +
      indignanceModifier +
      Math.random() * 2.8;

    let reason = `Evaluated ${seat.seatKey} as highest-value target`;
    if (canLethal) reason = `Spotted lethal knockout line on ${seat.seatKey}`;
    else if (seat.grudge >= 18) reason = `Retaliating against ${seat.seatKey} (grudge ${Math.round(seat.grudge)})`;
    else if (isTableLeader) reason = `Contesting table leader ${seat.seatKey}`;
    else if (seat.untappedBlockers === 0) reason = `Exploiting open blockers on ${seat.seatKey}`;
    else if (seat.priorLearnedThreat >= 6) reason = `Applying past-pod memory against rival ${seat.seatKey}`;

    return { ref: seat.ref, score: total, reason };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/**
 * Evaluates which creatures a bot should profitably attack with instead of blindly
 * suiciding into larger blockers. Accounts for Flying/Reach, Menace, Deathtouch,
 * Vigilance, First Strike, Trample, Infect, Commander damage, and crackback risk.
 */
function selectSmartBotAttackers(
  bot: LiveBotState,
  eligible: LiveBotCreature[],
  defenderCreatures: Array<{
    power: number;
    toughness: number;
    tapped: boolean;
    flying?: boolean;
    reach?: boolean;
    deathtouch?: boolean;
    firstStrike?: boolean;
  }>,
  defenderLife: number,
  defenderPoison: number,
  commanderDmgAlreadyDealt: number,
  incomingCrackbackPower: number
): { attackers: LiveBotCreature[]; heldBackCount: number; reasoning: string } {
  if (eligible.length === 0) {
    return { attackers: [], heldBackCount: 0, reasoning: '' };
  }

  const untappedBlockers = defenderCreatures.filter((c) => !c.tapped && c.toughness > 0);
  const flyingBlockers = untappedBlockers.filter((b) => b.flying || b.reach);
  const totalReadyPower = eligible.reduce((s, c) => s + c.power, 0);

  // Check if an all-out swing is likely lethal (overwhelms available blockers)
  const blockerCount = untappedBlockers.length;
  const sortedByPowerDesc = [...eligible].sort((a, b) => b.power - a.power);
  const unblockedPowerEstimate = sortedByPowerDesc
    .slice(blockerCount)
    .reduce((s, c) => s + c.power, 0);

  const isLethalAlpha =
    unblockedPowerEstimate >= defenderLife ||
    (bot.bias.usesInfect && unblockedPowerEstimate >= Math.max(1, 10 - defenderPoison));

  if (isLethalAlpha) {
    return {
      attackers: eligible,
      heldBackCount: 0,
      reasoning: 'Calculated lethal alpha strike past blockers.',
    };
  }

  // Determine how many non-vigilance blockers bot should hold if threatened by crackback
  const threatenedByCrackback =
    bot.liveMemory.defensivePosture ||
    incomingCrackbackPower >= Math.max(6, Math.round(bot.life * 0.55));

  const chosen: LiveBotCreature[] = [];
  const heldBack: LiveBotCreature[] = [];

  for (const atk of eligible) {
    // Vigilance attackers NEVER sacrifice defense to attack, so only check if attack is suicidal
    const legalBlockers = atk.flying ? flyingBlockers : untappedBlockers;
    const isUnblockable =
      legalBlockers.length === 0 || (atk.menace && legalBlockers.length < 2);

    if (isUnblockable) {
      chosen.push(atk);
      continue;
    }

    // Check best single blocker the defender has against this attacker
    const strongestBlocker = [...legalBlockers].sort(
      (a, b) => b.toughness + b.power - (a.toughness + a.power)
    )[0];

    const atkKillsBlocker =
      atk.deathtouch || atk.power >= strongestBlocker.toughness;
    const blockerKillsAtk =
      !atk.indestructible &&
      (strongestBlocker.deathtouch || strongestBlocker.power >= atk.toughness) &&
      !(atk.firstStrike && atkKillsBlocker && !strongestBlocker.firstStrike);

    const isFavorableOrEvenTrade = !blockerKillsAtk || atkKillsBlocker;
    const pushesCommanderLethal =
      atk.isCommander &&
      bot.usesCommanderDamage21 &&
      commanderDmgAlreadyDealt + atk.power >= 21;

    const isGoingWide = eligible.length >= untappedBlockers.length + 2;
    const aggressiveMood =
      bot.indignance === 'vindictive' ||
      (bot.indignance === 'ruthless' && bot.liveMemory.grudgeScore >= 30);

    if (
      !blockerKillsAtk ||
      pushesCommanderLethal ||
      (atk.vigilance && isFavorableOrEvenTrade) ||
      (isGoingWide && isFavorableOrEvenTrade) ||
      (atk.trample && atk.power >= strongestBlocker.toughness + 2) ||
      (isFavorableOrEvenTrade && (aggressiveMood || bot.liveMemory.userTookUnblockedCount >= 2))
    ) {
      chosen.push(atk);
    } else {
      heldBack.push(atk);
    }
  }

  // If threatened by crackback and we have non-vigilance attackers, keep at least 1 strong blocker back
  if (threatenedByCrackback && heldBack.length === 0 && chosen.length > 1) {
    const nonVigilanceIdx = chosen.findIndex((c) => !c.vigilance && !c.flying);
    if (nonVigilanceIdx >= 0) {
      const [keeper] = chosen.splice(nonVigilanceIdx, 1);
      heldBack.push(keeper);
    }
  }

  const reasoning =
    heldBack.length > 0 && chosen.length === 0
      ? `Held ${heldBack.length} creature${heldBack.length === 1 ? '' : 's'} back — no profitable attacks into your blockers.`
      : heldBack.length > 0
      ? `Attacked with ${chosen.length} profitable/evasive threat${chosen.length === 1 ? '' : 's'} and held ${heldBack.length} blocker${heldBack.length === 1 ? '' : 's'}.`
      : totalReadyPower > 0
      ? `Committed ${chosen.length} attacker${chosen.length === 1 ? '' : 's'} (${chosen.reduce((s, c) => s + c.power, 0)} power).`
      : '';

  return { attackers: chosen, heldBackCount: heldBack.length, reasoning };
}

export function executeBotTurn(
  botIndex: number,
  bots: LiveBotState[],
  player: PlayerBoardSnapshot,
  turnNumber: number,
  findMeta: (name: string) => CardMetadata | null,
  targetsHitThisRound: Record<string, number> = {}
): BotTurnResolution {
  const nextBots = bots.map((b) => ({
    ...b,
    creatures: b.creatures.map((c) => ({ ...c })),
    graveyardCards: [...(b.graveyardCards || [])],
    exileCards: [...(b.exileCards || [])],
    customHand: [...b.customHand],
    customLibrary: [...b.customLibrary],
    lastTurnSteps: [...b.lastTurnSteps],
    liveMemory: {
      ...b.liveMemory,
      rivalGrudgeByBotId: { ...(b.liveMemory.rivalGrudgeByBotId || {}) },
      commanderDamageDealtToRivals: { ...(b.liveMemory.commanderDamageDealtToRivals || {}) },
      priorRivalThreatByName: { ...(b.liveMemory.priorRivalThreatByName || {}) },
      observedUserThreats: [...b.liveMemory.observedUserThreats],
      observedUserHabits: [...b.liveMemory.observedUserHabits],
      adaptationHistory: [...b.liveMemory.adaptationHistory],
    },
  }));

  const bot = nextBots[botIndex];
  if (!bot || bot.eliminated) {
    return {
      updatedBots: nextBots,
      playerLifeDelta: 0,
      playerPoisonDelta: 0,
      playerMillCount: 0,
      removedPlayerCreatureUids: [],
      exiledPlayerCreatureUids: [],
      boardWipeCast: false,
      logs: [],
      phaseSteps: [],
      adaptationNote: '',
      pendingAttackOnPlayer: null,
    };
  }

  const logs: string[] = [];
  const phaseSteps: BotTurnPhaseStep[] = [];
  let playerLifeDelta = 0;
  let playerPoisonDelta = 0;
  let playerMillCount = 0;
  const removedPlayerCreatureUids: string[] = [];
  const exiledPlayerCreatureUids: string[] = [];
  let boardWipeCast = false;

  // 1. Untap & clear summoning sickness
  bot.tappedLands = 0;
  bot.creatures = bot.creatures.map((c) => ({
    ...c,
    tapped: false,
    summoningSick: false,
  }));

  // 2. Draw step
  if (bot.libraryCount <= 0) {
    bot.eliminated = true;
    bot.eliminatedReason = 'mill';
    bot.lastActionSummary = 'Attempted to draw from an empty library and lost!';
    phaseSteps.push({ phase: 'Untap & Draw', summary: 'Empty library — decked out!' });
    bot.lastTurnSteps = phaseSteps;
    logs.push(`${bot.name} decked out on draw step and was eliminated.`);
    return {
      updatedBots: nextBots,
      playerLifeDelta,
      playerPoisonDelta,
      playerMillCount,
      removedPlayerCreatureUids,
      boardWipeCast,
      logs,
      phaseSteps,
      adaptationNote: bot.liveMemory.lastAdaptationNote,
      pendingAttackOnPlayer: null,
    };
  }

  bot.libraryCount -= 1;
  let drawnCardName = '1 card';
  if (bot.customLibrary.length > 0) {
    const drawn = bot.customLibrary.shift();
    if (drawn) {
      bot.customHand.push(drawn);
      drawnCardName = drawn.name;
    }
  }
  bot.handCount += 1;

  // 3. Land drop (respecting tapped lands!)
  const playedSummaries: string[] = [];
  let landNote = 'No land drop';
  if (bot.customHand.length > 0) {
    // Prefer untapped land when bot wants mana this turn
    const untappedLandIdx = bot.customHand.findIndex((c) => c.isLand && !c.entersTapped);
    const anyLandIdx = bot.customHand.findIndex((c) => c.isLand);
    const landIdx = untappedLandIdx >= 0 ? untappedLandIdx : anyLandIdx;
    if (landIdx >= 0) {
      const [land] = bot.customHand.splice(landIdx, 1);
      bot.landsInPlay += 1;
      if (land.entersTapped) {
        bot.tappedLands = Math.min(bot.landsInPlay, bot.tappedLands + 1);
      }
      bot.handCount = Math.max(0, bot.handCount - 1);
      playedSummaries.push(`${land.name}${land.entersTapped ? ' (tapped)' : ''}`);
      landNote = `Played ${land.name}${land.entersTapped ? ' (tapped)' : ''}`;
    }
  } else if (bot.handCount > 0 && (bot.landsInPlay < 4 || Math.random() < 0.76)) {
    bot.landsInPlay += 1;
    bot.handCount = Math.max(0, bot.handCount - 1);
    const entersTapped = turnNumber <= 2 && Math.random() < 0.18;
    if (entersTapped) {
      bot.tappedLands = Math.min(bot.landsInPlay, bot.tappedLands + 1);
    }
    playedSummaries.push(entersTapped ? 'Dual Land (tapped)' : 'Land');
    landNote = entersTapped ? 'Played dual land (tapped)' : 'Played land for turn';
  }

  phaseSteps.push({
    phase: 'Untap & Draw',
    summary: `Untapped all · Drew ${bot.customHand.length > 0 ? 'card' : drawnCardName} · ${landNote}`,
  });

  let availableMana = Math.max(0, bot.landsInPlay - bot.tappedLands + bot.manaBonusFromRamp);
  const rankedTargets = rankBotTargets(bot, nextBots, player, targetsHitThisRound);
  const primaryScored = rankedTargets[0] || {
    ref: { kind: 'player' as const, label: 'You' },
    score: 0,
    reason: 'Default target',
  };
  const target = primaryScored.ref;
  const targetLabel = target.kind === 'player' ? 'You' : target.targetBotName;
  if (bot.lastTargetName === targetLabel) {
    bot.liveMemory.consecutiveTurnsOnSameTarget =
      (bot.liveMemory.consecutiveTurnsOnSameTarget || 1) + 1;
  } else {
    bot.liveMemory.consecutiveTurnsOnSameTarget = 1;
  }
  bot.lastTargetName = targetLabel;

  if (target.kind === 'bot' && primaryScored.reason) {
    bot.liveMemory.lastAdaptationNote = `${primaryScored.reason}.`;
  }

  // Helper: symmetric inter-bot grudge & rival-threat memory
  const addRivalGrudge = (
    victimBot: LiveBotState,
    attackerBot: LiveBotState,
    amount: number,
    reason?: string
  ) => {
    if (victimBot.id === attackerBot.id || victimBot.eliminated || amount <= 0) return;
    const prevVal = victimBot.liveMemory.rivalGrudgeByBotId[attackerBot.id] || 0;
    const nextVal = Math.min(100, prevVal + amount);
    victimBot.liveMemory.rivalGrudgeByBotId[attackerBot.id] = nextVal;

    // Update biggestRivalThreatName based on highest rival grudge score
    let bestId = attackerBot.id;
    let bestScore = nextVal;
    for (const [rId, rScore] of Object.entries(victimBot.liveMemory.rivalGrudgeByBotId)) {
      if (rScore > bestScore) {
        bestScore = rScore;
        bestId = rId;
      }
    }
    const bestBot = nextBots.find((b) => b.id === bestId);
    if (bestBot && bestScore >= 10) {
      victimBot.liveMemory.biggestRivalThreatName = bestBot.name;
    }

    if (reason && (prevVal < 15 && nextVal >= 15 || amount >= 14)) {
      const note = `${reason} (rival threat on ${attackerBot.name})`;
      victimBot.liveMemory.lastAdaptationNote = note;
      victimBot.liveMemory.adaptationHistory = [
        ...victimBot.liveMemory.adaptationHistory.filter((h) => h !== note),
        note,
      ].slice(-6);
    }
  };

  // Helper: symmetric awareness when a bot casts its Commander or ramps (matches recordUserActionForBots)
  const notifyRivalsOfBotPlay = (amount: number, reason?: string) => {
    for (const other of nextBots) {
      if (other.id !== bot.id && !other.eliminated) {
        addRivalGrudge(other, bot, amount, reason);
      }
    }
  };

  // Helper: evaluate ALL non-hexproof creatures across You AND every living rival bot
  // so spot removal hits the true biggest threat at the table (decoupled from combat lane!)
  const pickBestTableRemovalTarget = (
    activePlayerCreatures: PlayerBoardSnapshot['creatures'],
    minScore = 1
  ):
    | { kind: 'player'; creature: PlayerBoardSnapshot['creatures'][number]; score: number }
    | { kind: 'bot'; rival: LiveBotState; creature: LiveBotCreature; score: number }
    | null => {
    type Candidate =
      | { kind: 'player'; creature: PlayerBoardSnapshot['creatures'][number]; score: number }
      | { kind: 'bot'; rival: LiveBotState; creature: LiveBotCreature; score: number };

    const pool: Candidate[] = [];
    const primaryBonus = 3.5;

    for (const pc of activePlayerCreatures) {
      const base = scoreEnemyCreatureThreat(pc, bot);
      if (base < minScore) continue;
      const seatBonus =
        (target.kind === 'player' ? primaryBonus : 0) +
        (bot.indignance === 'vindictive' ? 4 : 0) +
        bot.liveMemory.grudgeScore * 0.08;
      pool.push({ kind: 'player', creature: pc, score: base + seatBonus });
    }

    for (const r of nextBots) {
      if (r.id === bot.id || r.eliminated) continue;
      const rGrudge = bot.liveMemory.rivalGrudgeByBotId[r.id] || 0;
      const rPrior =
        bot.liveMemory.priorRivalThreatByName[r.name.trim().toLowerCase()] || 0;
      for (const rc of r.creatures) {
        const base = scoreEnemyCreatureThreat(rc, bot);
        if (base < minScore) continue;
        const seatBonus =
          (target.kind === 'bot' && target.targetBotId === r.id ? primaryBonus : 0) +
          rGrudge * 0.1 +
          rPrior * 0.12;
        pool.push({ kind: 'bot', rival: r, creature: rc, score: base + seatBonus });
      }
    }

    pool.sort((a, b) => b.score - a.score);
    return pool[0] || null;
  };

  // Decide whether Control/Midrange bot deliberately holds 2 mana open for interaction
  const playerHasCommanderReadySoon =
    Boolean(player.deckContext?.commanderNames?.length) &&
    !player.hasCommanderInPlay &&
    player.landsCount >= Math.max(2, Math.floor((player.deckContext?.avgCmc || 3) + 1));

  const rivalHasCommanderReadySoon = nextBots.some(
    (r) =>
      r.id !== bot.id &&
      !r.eliminated &&
      r.allowsCommandZone &&
      r.commanderInZone &&
      r.landsInPlay + r.manaBonusFromRamp >= Math.max(2, r.commanderCmc + r.commanderTax - 1)
  );

  const botIntel = getBotIntelligenceMeta(bot.intelligence);
  const wantsToHoldCounterMana =
    botIntel.holdsInteractionMana &&
    (bot.bias.usesControl ||
      bot.customHand.some((c) => c.isCounterspell) ||
      bot.liveMemory.holdManaForInteraction ||
      botIntel.id === 'mastermind') &&
    availableMana >= botIntel.minManaToHold &&
    bot.handCount >= 2 &&
    bot.liveMemory.countersUsedThisGame < botIntel.maxPresetCounters &&
    (playerHasCommanderReadySoon ||
      rivalHasCommanderReadySoon ||
      bot.liveMemory.observedUserThreats.length > 0 ||
      botIntel.id === 'competitive' ||
      botIntel.id === 'mastermind');

  const reserveMana = wantsToHoldCounterMana ? 2 : 0;
  let mainPhaseActions: string[] = [];

  const indignanceAggroFactor =
    bot.indignance === 'vindictive'
      ? 1.25
      : bot.indignance === 'ruthless'
      ? 1.15
      : bot.indignance === 'measured'
      ? 1.0
      : 0.8;

  const canPauseForStack = Boolean(
    player.canRespondAtInstantSpeed ||
      player.hasActivatedAbilityResponse ||
      player.interruptAlertsEnabled ||
      player.fullControlPriority
  );

  const isBotSpellUncounterable = (spellName: string, meta?: CardMetadata | null): boolean => {
    const lower = (spellName || '').toLowerCase();
    if (/supreme verdict|dovin's veto|abrupt decay|void rend|carnage tyrant|koma, cosmos serpent|niv-mizzet, parun|krosan grip/.test(lower)) {
      return true;
    }
    const oracle = (meta?.oracleText || '').toLowerCase();
    return oracle.includes("can't be countered") || oracle.includes('cannot be countered');
  };

  const makeStackPauseReturn = (
    spell: Omit<PendingBotStackSpell, 'priorPhaseSteps' | 'playedSummaries' | 'adaptationNote' | 'deferredCombat'>
  ): BotTurnResolution => {
    const pausedSteps: BotTurnPhaseStep[] = [
      ...phaseSteps,
      {
        phase: 'Main Phase',
        summary: `${mainPhaseActions.join(' · ')} (On Stack — priority passed to You)`,
      },
    ];
    bot.lastActionSummary = `Cast ${spell.cardName} (On the Stack)`;
    bot.lastTurnSteps = pausedSteps;
    logs.push(
      `${bot.name} put ${spell.cardName} on the stack (${spell.targetSummary}) — priority passes to You.`
    );
    return {
      updatedBots: nextBots,
      playerLifeDelta,
      playerPoisonDelta,
      playerMillCount,
      removedPlayerCreatureUids,
      exiledPlayerCreatureUids,
      boardWipeCast,
      logs,
      phaseSteps: pausedSteps,
      adaptationNote: bot.liveMemory.lastAdaptationNote,
      pendingAttackOnPlayer: null,
      pendingStackSpell: {
        ...spell,
        priorPhaseSteps: phaseSteps,
        playedSummaries: [...playedSummaries],
        adaptationNote: bot.liveMemory.lastAdaptationNote,
        deferredCombat: true,
      },
    };
  };

  // 4. Main Phase Casting (Custom Decklist or Archetype AI)
  if (bot.customHand.length > 0) {
    // Priority order: Ramp (early) -> Commander -> Board Wipe (if behind) -> Removal (if threat) -> Card Draw (if low hand) -> Creatures -> Burn/Mill
    const spendable = () => Math.max(0, availableMana - reserveMana);

    // 4a. Cast Commander from Command Zone if affordable & impactful
    const cmdTotalCost = bot.commanderCmc + bot.commanderTax;
    if (
      bot.allowsCommandZone &&
      bot.commanderInZone &&
      bot.commanderName &&
      spendable() >= cmdTotalCost
    ) {
      const cmdKw = extractCreatureKeywords(bot.commanderMeta);
      availableMana -= cmdTotalCost;
      bot.tappedLands = Math.min(bot.landsInPlay, bot.tappedLands + cmdTotalCost);
      bot.commanderInZone = false;
      bot.liveMemory.spellsCastCount += 1;
      const cmdCreature: LiveBotCreature = {
        ...cmdKw,
        uid: `bot-cmd-${bot.id}-${turnNumber}`,
        name: bot.commanderName,
        power: bot.commanderPower,
        toughness: bot.commanderToughness,
        tapped: false,
        summoningSick: !cmdKw.haste,
        isCommander: true,
        hasInfect: bot.bias.usesInfect,
        toxicValue: bot.bias.usesToxic ? 1 : 0,
        meta: bot.commanderMeta,
      };
      playedSummaries.push(`Commander ${bot.commanderName}`);
      mainPhaseActions.push(`Cast Commander ${bot.commanderName} (${cmdTotalCost} mana)`);
      if (canPauseForStack) {
        return makeStackPauseReturn({
          id: `bot-stack-cmd-${bot.id}-${turnNumber}-${Math.random().toString(36).slice(2, 6)}`,
          botIndex,
          botId: bot.id,
          botName: bot.name,
          seatNumber: botIndex + 2,
          cardName: bot.commanderName,
          cmc: cmdTotalCost,
          typeLine: bot.commanderMeta?.typeLine || 'Legendary Creature — Commander',
          meta: bot.commanderMeta,
          category: 'commander',
          uncounterable: isBotSpellUncounterable(bot.commanderName, bot.commanderMeta),
          targetSummary: `${bot.name}'s Battlefield (${bot.commanderPower}/${bot.commanderToughness} Commander)`,
          creaturePayload: cmdCreature,
        });
      }
      bot.liveMemory.creaturesPlayedCount += 1;
      bot.creatures.push(cmdCreature);
      notifyRivalsOfBotPlay(4, `${bot.name} deployed Commander ${bot.commanderName}`);
    }

    // Score castable custom cards accurately
    const castable = bot.customHand
      .filter((c) => !c.isLand && !c.isCounterspell && c.cmc <= spendable())
      .sort((a, b) => {
        const scoreCard = (c: LiveBotDeckCard) => {
          if (c.isRamp && turnNumber <= 4) return 90 - c.cmc;
          if (c.isBoardWipe) return 85;
          if (c.isRemoval) return 75;
          if (c.drawCount > 0 && bot.handCount <= 3) return 70;
          if (c.isCreature) return 50 + c.cmc * 4 + c.power * 2;
          return 30 + c.cmc * 3;
        };
        return scoreCard(b) - scoreCard(a);
      });

    for (const card of castable) {
      if (card.cmc > spendable()) continue;

      const activePlayerCreatures = player.creatures.filter(
        (pc) => !removedPlayerCreatureUids.includes(pc.uid)
      );

      // Don't waste board wipes when ahead — evaluate ALL opponents (You + rival bots!)
      if (card.isBoardWipe) {
        const enemyBoards = [
          {
            count: activePlayerCreatures.length,
            power: activePlayerCreatures.reduce((s, c) => s + c.power, 0),
          },
          ...nextBots
            .filter((r) => r.id !== bot.id && !r.eliminated)
            .map((r) => ({
              count: r.creatures.length,
              power: r.creatures.reduce((s, c) => s + c.power, 0),
            })),
        ];
        const maxEnemyPower = Math.max(0, ...enemyBoards.map((e) => e.power));
        const totalEnemyCreatures = enemyBoards.reduce((s, e) => s + e.count, 0);
        const ownBoardPower = bot.creatures.reduce((s, c) => s + c.power, 0);
        if (totalEnemyCreatures < 3 && ownBoardPower >= maxEnemyPower) {
          continue;
        }
      }

      // Don't waste removal if no target exists anywhere on the table
      if (card.isRemoval) {
        const bestTarget = pickBestTableRemovalTarget(activePlayerCreatures, 1);
        if (!bestTarget) continue;
      }

      const idxInHand = bot.customHand.indexOf(card);
      if (idxInHand < 0) continue;

      bot.customHand.splice(idxInHand, 1);
      bot.handCount = Math.max(0, bot.handCount - 1);
      availableMana -= card.cmc;
      bot.tappedLands = Math.min(bot.landsInPlay, bot.tappedLands + card.cmc);
      bot.liveMemory.spellsCastCount += 1;
      playedSummaries.push(card.name);

      if (card.isRamp) {
        addBotZoneCardInPlace(bot, 'graveyard', {
          name: card.name,
          cmc: card.cmc,
          typeLine: card.meta?.typeLine || 'Sorcery / Artifact',
          meta: card.meta ?? null,
          reason: `Cast Turn ${turnNumber}`,
        });
        if (canPauseForStack && (player.interruptAlertsEnabled || player.fullControlPriority)) {
          mainPhaseActions.push(`Cast Ramp: ${card.name}`);
          return makeStackPauseReturn({
            id: `bot-stack-ramp-${bot.id}-${turnNumber}-${Math.random().toString(36).slice(2, 6)}`,
            botIndex,
            botId: bot.id,
            botName: bot.name,
            seatNumber: botIndex + 2,
            cardName: card.name,
            cmc: card.cmc,
            typeLine: card.meta?.typeLine || 'Artifact / Sorcery',
            meta: card.meta,
            category: 'ramp',
            uncounterable: isBotSpellUncounterable(card.name, card.meta),
            targetSummary: `${bot.name} (+1 permanent mana acceleration)`,
            rampManaBonus: 1,
          });
        }
        bot.manaBonusFromRamp += 1;
        notifyRivalsOfBotPlay(2);
        mainPhaseActions.push(`Ramped with ${card.name}`);
      } else if (card.isBoardWipe) {
        addBotZoneCardInPlace(bot, 'graveyard', {
          name: card.name,
          cmc: card.cmc,
          typeLine: card.meta?.typeLine || 'Sorcery',
          meta: card.meta ?? null,
          reason: `Board Wipe Turn ${turnNumber}`,
        });
        if (canPauseForStack) {
          mainPhaseActions.push(`Cast Board Wipe: ${card.name}`);
          return makeStackPauseReturn({
            id: `bot-stack-wipe-${bot.id}-${turnNumber}-${Math.random().toString(36).slice(2, 6)}`,
            botIndex,
            botId: bot.id,
            botName: bot.name,
            seatNumber: botIndex + 2,
            cardName: card.name,
            cmc: card.cmc,
            typeLine: card.meta?.typeLine || 'Sorcery',
            meta: card.meta,
            category: 'board-wipe',
            uncounterable: isBotSpellUncounterable(card.name, card.meta),
            targetSummary: 'All Non-Indestructible Creatures',
          });
        }
        boardWipeCast = true;
        const ownDead = bot.creatures.filter((c) => !c.indestructible);
        bot.creatures = bot.creatures.filter((c) => c.indestructible);
        for (const d of ownDead) {
          if (d.isCommander && bot.allowsCommandZone) {
            bot.commanderInZone = true;
            bot.commanderTax += 2;
          } else {
            addBotZoneCardInPlace(bot, 'graveyard', createLiveBotZoneCardFromCreature(d, `Wiped by ${card.name}`));
          }
        }
        for (const other of nextBots) {
          if (other.id !== bot.id && !other.eliminated) {
            const destroyed = other.creatures.filter((c) => !c.indestructible);
            other.creatures = other.creatures.filter((c) => c.indestructible);
            for (const d of destroyed) {
              if (d.isCommander && other.allowsCommandZone) {
                other.commanderInZone = true;
                other.commanderTax += 2;
              } else {
                addBotZoneCardInPlace(other, 'graveyard', createLiveBotZoneCardFromCreature(d, `Wiped by ${card.name}`));
              }
            }
            if (destroyed.length > 0) {
              addRivalGrudge(
                other,
                bot,
                10 + destroyed.length * 4,
                `${bot.name} wiped ${destroyed.length} creature${destroyed.length === 1 ? '' : 's'} with ${card.name}`
              );
            }
          }
        }
        for (const pc of activePlayerCreatures) {
          if (!pc.indestructible) removedPlayerCreatureUids.push(pc.uid);
        }
        mainPhaseActions.push(`Board wipe: ${card.name}`);
        logs.push(`${bot.name} cast ${card.name} — cleared non-indestructible creatures!`);
      } else if (card.isRemoval) {
        const bestTarget = pickBestTableRemovalTarget(activePlayerCreatures, 1);
        const exilesTarget = isExileRemovalSpell(card.name, card.meta);
        addBotZoneCardInPlace(bot, 'graveyard', {
          name: card.name,
          cmc: card.cmc,
          typeLine: card.meta?.typeLine || 'Instant',
          meta: card.meta ?? null,
          reason: `Removal Turn ${turnNumber}`,
        });
        if (bestTarget?.kind === 'player') {
          const victim = bestTarget.creature;
          if (canPauseForStack) {
            mainPhaseActions.push(`Cast ${card.name} targeting your ${victim.name}`);
            return makeStackPauseReturn({
              id: `bot-stack-rem-${bot.id}-${turnNumber}-${Math.random().toString(36).slice(2, 6)}`,
              botIndex,
              botId: bot.id,
              botName: bot.name,
              seatNumber: botIndex + 2,
              cardName: card.name,
              cmc: card.cmc,
              typeLine: card.meta?.typeLine || 'Instant',
              meta: card.meta,
              category: 'removal',
              uncounterable: isBotSpellUncounterable(card.name, card.meta),
              exilesTarget,
              targetSummary: `Your ${victim.name}${victim.isCommander ? ' (Commander)' : ''}`,
              targetPlayerCreatureUid: victim.uid,
              targetPlayerCreatureName: victim.name,
            });
          }
          if (exilesTarget) exiledPlayerCreatureUids.push(victim.uid);
          else removedPlayerCreatureUids.push(victim.uid);
          mainPhaseActions.push(`Removed your ${victim.name} with ${card.name}`);
          logs.push(
            `${bot.name} cast ${card.name} targeting your highest-priority threat: ${victim.name}.`
          );
        } else if (bestTarget?.kind === 'bot') {
          const { rival, creature: victim } = bestTarget;
          rival.creatures = rival.creatures.filter((c) => c.uid !== victim.uid);
          if (victim.isCommander && rival.allowsCommandZone) {
            rival.commanderInZone = true;
            rival.commanderTax += 2;
          } else {
            addBotZoneCardInPlace(
              rival,
              exilesTarget ? 'exile' : 'graveyard',
              createLiveBotZoneCardFromCreature(victim, `${exilesTarget ? 'Exiled' : 'Removed'} by ${card.name}`)
            );
          }
          addRivalGrudge(
            rival,
            bot,
            victim.isCommander ? 20 : 12,
            `${bot.name} removed ${victim.name} with ${card.name}`
          );
          mainPhaseActions.push(`Removed ${rival.name}'s ${victim.name}`);
          logs.push(
            `${bot.name} cast ${card.name} ${exilesTarget ? 'exiling' : 'destroying'} ${rival.name}'s ${victim.name}${
              victim.isCommander ? ' (Commander threat)' : ''
            }.`
          );
        }
      } else if (card.isCreature) {
        const creatureObj: LiveBotCreature = {
          flying: card.flying,
          reach: card.reach,
          trample: card.trample,
          deathtouch: card.deathtouch,
          lifelink: card.lifelink,
          vigilance: card.vigilance,
          haste: card.haste,
          firstStrike: card.firstStrike,
          menace: card.menace,
          hexproof: card.hexproof,
          indestructible: card.indestructible,
          uid: `bot-c-${bot.id}-${turnNumber}-${Math.random().toString(36).slice(2, 6)}`,
          name: card.name,
          power: Math.max(1, card.power),
          toughness: Math.max(1, card.toughness),
          tapped: false,
          summoningSick: !card.haste,
          isCommander: false,
          hasInfect: card.hasInfect,
          toxicValue: card.toxicValue,
          meta: card.meta,
        };
        if (
          canPauseForStack &&
          (card.cmc >= 4 ||
            card.power >= 4 ||
            player.interruptAlertsEnabled ||
            player.fullControlPriority)
        ) {
          mainPhaseActions.push(`Cast ${card.name} (${card.power}/${card.toughness})`);
          return makeStackPauseReturn({
            id: `bot-stack-cr-${bot.id}-${turnNumber}-${Math.random().toString(36).slice(2, 6)}`,
            botIndex,
            botId: bot.id,
            botName: bot.name,
            seatNumber: botIndex + 2,
            cardName: card.name,
            cmc: card.cmc,
            typeLine: card.meta?.typeLine || 'Creature',
            meta: card.meta,
            category: 'creature',
            uncounterable: isBotSpellUncounterable(card.name, card.meta),
            targetSummary: `${bot.name}'s Battlefield (${creatureObj.power}/${creatureObj.toughness})`,
            creaturePayload: creatureObj,
          });
        }
        bot.liveMemory.creaturesPlayedCount += 1;
        bot.creatures.push(creatureObj);
        mainPhaseActions.push(`Deployed ${card.name} (${card.power}/${card.toughness})`);
      } else {
        addBotZoneCardInPlace(bot, 'graveyard', {
          name: card.name,
          cmc: card.cmc,
          typeLine: card.meta?.typeLine || 'Instant / Sorcery',
          meta: card.meta ?? null,
          reason: `Cast Turn ${turnNumber}`,
        });
        if (card.burnAmount > 0 && target.kind === 'player' && canPauseForStack) {
          mainPhaseActions.push(`Cast ${card.name} (${card.burnAmount} dmg → You)`);
          return makeStackPauseReturn({
            id: `bot-stack-burn-${bot.id}-${turnNumber}-${Math.random().toString(36).slice(2, 6)}`,
            botIndex,
            botId: bot.id,
            botName: bot.name,
            seatNumber: botIndex + 2,
            cardName: card.name,
            cmc: card.cmc,
            typeLine: card.meta?.typeLine || 'Instant',
            meta: card.meta,
            category: 'burn',
            uncounterable: isBotSpellUncounterable(card.name, card.meta),
            targetSummary: `You (${card.burnAmount} damage)`,
            burnAmount: card.burnAmount,
            drainHealAmount: card.lifegainAmount,
          });
        }
        if (card.drawCount > 0) {
          let drawnN = 0;
          for (let d = 0; d < card.drawCount && bot.libraryCount > 0; d++) {
            bot.libraryCount -= 1;
            const c = bot.customLibrary.shift();
            if (c) bot.customHand.push(c);
            bot.handCount += 1;
            drawnN += 1;
          }
          if (drawnN > 0) mainPhaseActions.push(`${card.name} (drew ${drawnN})`);
        }
        if (card.lifegainAmount > 0) {
          bot.life += card.lifegainAmount;
          mainPhaseActions.push(`${card.name} (+${card.lifegainAmount} life)`);
        }
        if (card.burnAmount > 0) {
          if (target.kind === 'player') {
            playerLifeDelta -= card.burnAmount;
            bot.liveMemory.damageDealtToPlayer += card.burnAmount;
          } else {
            const tb = nextBots.find((b) => b.id === target.targetBotId);
            if (tb) {
              tb.life = Math.max(0, tb.life - card.burnAmount);
              bot.liveMemory.damageDealtToRivals += card.burnAmount;
              tb.liveMemory.damageTakenFromRivals += card.burnAmount;
              addRivalGrudge(
                tb,
                bot,
                6 + card.burnAmount * 2,
                `${bot.name} burned for ${card.burnAmount} with ${card.name}`
              );
            }
          }
          mainPhaseActions.push(`${card.name} (${card.burnAmount} dmg to ${targetLabel})`);
        }
        if (card.millAmount > 0) {
          if (target.kind === 'player') {
            playerMillCount += card.millAmount;
          } else {
            const tb = nextBots.find((b) => b.id === target.targetBotId);
            if (tb) {
              const actual = Math.min(tb.libraryCount, card.millAmount);
              tb.libraryCount -= actual;
              const rivalRoster = getCreatureRosterForArchetype(tb.archetype);
              for (let m = 0; m < actual; m++) {
                const milledCustom = tb.customLibrary.shift();
                if (milledCustom) {
                  addBotZoneCardInPlace(tb, 'graveyard', {
                    name: milledCustom.name,
                    cmc: milledCustom.cmc,
                    typeLine: milledCustom.meta?.typeLine || 'Card',
                    meta: milledCustom.meta ?? null,
                    reason: `Milled by ${card.name}`,
                  });
                } else {
                  const sampleCard = rivalRoster[m % rivalRoster.length];
                  const mName = m % 3 === 0 ? 'Land' : sampleCard?.name || 'Spell';
                  addBotZoneCardInPlace(tb, 'graveyard', {
                    name: mName,
                    cmc: m % 3 === 0 ? 0 : sampleCard?.cmc || 2,
                    typeLine: m % 3 === 0 ? 'Basic Land' : 'Creature',
                    meta: mName === 'Land' ? null : findMeta(mName),
                    reason: `Milled by ${card.name}`,
                  });
                }
              }
              addRivalGrudge(
                tb,
                bot,
                6 + Math.ceil(actual / 2),
                `${bot.name} milled ${actual} cards with ${card.name}`
              );
            }
          }
          mainPhaseActions.push(`${card.name} (mill ${card.millAmount})`);
        }
      }
    }
  } else {
    // Archetype AI play sequence (accurate mana curve, threat-based removal, card draw, keywords)
    const roster = getCreatureRosterForArchetype(bot.archetype);
    const spendable = () => Math.max(0, availableMana - reserveMana);

    // 4a. Early Ramp (Turns 1-4)
    if (
      turnNumber <= 4 &&
      spendable() >= 2 &&
      bot.manaBonusFromRamp < 2 &&
      bot.handCount >= 2 &&
      (/simic|ramp|landfall|golgari|gruul/i.test(bot.archetype) || Math.random() < 0.48)
    ) {
      const rampName = bot.allowsCommandZone ? 'Arcane Signet' : 'Rampant Growth';
      const rampMeta = findMeta(rampName);
      availableMana -= 2;
      bot.tappedLands = Math.min(bot.landsInPlay, bot.tappedLands + 2);
      bot.handCount = Math.max(0, bot.handCount - 1);
      bot.liveMemory.spellsCastCount += 1;
      playedSummaries.push(rampName);
      if (!bot.allowsCommandZone) {
        addBotZoneCardInPlace(bot, 'graveyard', {
          name: rampName,
          cmc: rampMeta?.cmc || 2,
          typeLine: rampMeta?.typeLine || 'Sorcery',
          meta: rampMeta,
          reason: `Ramp Turn ${turnNumber}`,
        });
      }
      if (canPauseForStack && (player.interruptAlertsEnabled || player.fullControlPriority)) {
        mainPhaseActions.push(`Cast Ramp: ${rampName}`);
        return makeStackPauseReturn({
          id: `bot-stack-ramp-${bot.id}-${turnNumber}-${Math.random().toString(36).slice(2, 6)}`,
          botIndex,
          botId: bot.id,
          botName: bot.name,
          seatNumber: botIndex + 2,
          cardName: rampName,
          cmc: rampMeta?.cmc || 2,
          typeLine: rampMeta?.typeLine || (bot.allowsCommandZone ? 'Artifact' : 'Sorcery'),
          meta: rampMeta,
          category: 'ramp',
          uncounterable: isBotSpellUncounterable(rampName, rampMeta),
          targetSummary: `${bot.name} (+1 permanent mana acceleration)`,
          rampManaBonus: 1,
        });
      }
      bot.manaBonusFromRamp += 1;
      notifyRivalsOfBotPlay(2);
      mainPhaseActions.push(`Ramped with ${rampName}`);
    }

    // 4b. Cast Commander if Command Zone is active
    const cmdTotalCost = bot.commanderCmc + bot.commanderTax;
    if (
      bot.allowsCommandZone &&
      bot.commanderInZone &&
      bot.commanderName &&
      spendable() >= cmdTotalCost
    ) {
      const cmdKw = extractCreatureKeywords(bot.commanderMeta, {
        haste: bot.bias.usesVoltronCommander ? true : undefined,
      });
      availableMana -= cmdTotalCost;
      bot.tappedLands = Math.min(bot.landsInPlay, bot.tappedLands + cmdTotalCost);
      bot.commanderInZone = false;
      bot.liveMemory.spellsCastCount += 1;
      const cmdCreature: LiveBotCreature = {
        ...cmdKw,
        uid: `bot-cmd-${bot.id}-${turnNumber}`,
        name: bot.commanderName,
        power: bot.commanderPower,
        toughness: bot.commanderToughness,
        tapped: false,
        summoningSick: !cmdKw.haste,
        isCommander: true,
        hasInfect: bot.bias.usesInfect,
        toxicValue: bot.bias.usesToxic ? 1 : 0,
        meta: bot.commanderMeta,
      };
      playedSummaries.push(`Commander ${bot.commanderName}`);
      mainPhaseActions.push(`Cast Commander ${bot.commanderName}`);
      if (canPauseForStack) {
        return makeStackPauseReturn({
          id: `bot-stack-cmd-${bot.id}-${turnNumber}-${Math.random().toString(36).slice(2, 6)}`,
          botIndex,
          botId: bot.id,
          botName: bot.name,
          seatNumber: botIndex + 2,
          cardName: bot.commanderName,
          cmc: cmdTotalCost,
          typeLine: bot.commanderMeta?.typeLine || 'Legendary Creature — Commander',
          meta: bot.commanderMeta,
          category: 'commander',
          uncounterable: isBotSpellUncounterable(bot.commanderName, bot.commanderMeta),
          targetSummary: `${bot.name}'s Battlefield (${bot.commanderPower}/${bot.commanderToughness} Commander)`,
          creaturePayload: cmdCreature,
        });
      }
      bot.liveMemory.creaturesPlayedCount += 1;
      bot.creatures.push(cmdCreature);
      notifyRivalsOfBotPlay(4, `${bot.name} deployed Commander ${bot.commanderName}`);
    }

    // 4c. Smart Board Wipe or Table-Wide Targeted Removal based on symmetric threat scores
    const activePlayerCreatures = player.creatures.filter(
      (pc) => !removedPlayerCreatureUids.includes(pc.uid)
    );
    const enemyPowerList = [
      activePlayerCreatures.reduce((s, c) => s + c.power, 0),
      ...nextBots
        .filter((b) => b.id !== bot.id && !b.eliminated)
        .map((b) => b.creatures.reduce((s, c) => s + c.power, 0)),
    ];
    const maxEnemyBoardPower = Math.max(0, ...enemyPowerList);
    const ownBoardPower = bot.creatures.reduce((s, c) => s + c.power, 0);
    const maxOpponentCreatures = Math.max(
      activePlayerCreatures.length,
      ...nextBots
        .filter((b) => b.id !== bot.id && !b.eliminated)
        .map((b) => b.creatures.length)
    );

    const shouldWipe =
      (bot.bias.usesControl || bot.liveMemory.defensivePosture || bot.indignance === 'vindictive') &&
      availableMana >= 4 &&
      bot.handCount >= 1 &&
      maxOpponentCreatures >= 3 &&
      ownBoardPower + 2 < maxEnemyBoardPower &&
      bot.creatures.length <= 1;

    const wipeCardName = bot.allowsCommandZone ? 'Supreme Verdict' : 'Wrath of God';

    const maxRivalGrudge = Math.max(
      0,
      ...Object.values(bot.liveMemory.rivalGrudgeByBotId || {})
    );

    if (shouldWipe) {
      availableMana -= 4;
      bot.tappedLands = Math.min(bot.landsInPlay, bot.tappedLands + 4);
      bot.handCount = Math.max(0, bot.handCount - 1);
      bot.liveMemory.spellsCastCount += 1;
      playedSummaries.push(wipeCardName);
      const wipeMeta = findMeta(wipeCardName);
      addBotZoneCardInPlace(bot, 'graveyard', {
        name: wipeCardName,
        cmc: 4,
        typeLine: wipeMeta?.typeLine || 'Sorcery',
        meta: wipeMeta,
        reason: `Board Wipe Turn ${turnNumber}`,
      });
      if (canPauseForStack) {
        mainPhaseActions.push(`Cast Board Wipe: ${wipeCardName}`);
        return makeStackPauseReturn({
          id: `bot-stack-wipe-${bot.id}-${turnNumber}-${Math.random().toString(36).slice(2, 6)}`,
          botIndex,
          botId: bot.id,
          botName: bot.name,
          seatNumber: botIndex + 2,
          cardName: wipeCardName,
          cmc: 4,
          typeLine: wipeMeta?.typeLine || 'Sorcery',
          meta: wipeMeta,
          category: 'board-wipe',
          uncounterable: isBotSpellUncounterable(wipeCardName, wipeMeta),
          targetSummary: 'All Non-Indestructible Creatures',
        });
      }
      const ownDeadWipe = bot.creatures.filter((c) => !c.indestructible);
      bot.creatures = bot.creatures.filter((c) => c.indestructible);
      for (const d of ownDeadWipe) {
        if (d.isCommander && bot.allowsCommandZone) {
          bot.commanderInZone = true;
          bot.commanderTax += 2;
        } else {
          addBotZoneCardInPlace(bot, 'graveyard', createLiveBotZoneCardFromCreature(d, `Wiped by ${wipeCardName}`));
        }
      }
      for (const other of nextBots) {
        if (other.id !== bot.id && !other.eliminated) {
          const destroyed = other.creatures.filter((c) => !c.indestructible);
          other.creatures = other.creatures.filter((c) => c.indestructible);
          for (const d of destroyed) {
            if (d.isCommander && other.allowsCommandZone) {
              other.commanderInZone = true;
              other.commanderTax += 2;
            } else {
              addBotZoneCardInPlace(other, 'graveyard', createLiveBotZoneCardFromCreature(d, `Wiped by ${wipeCardName}`));
            }
          }
          if (destroyed.length > 0) {
            addRivalGrudge(
              other,
              bot,
              10 + destroyed.length * 4,
              `${bot.name} wiped ${destroyed.length} creature${destroyed.length === 1 ? '' : 's'} with ${wipeCardName}`
            );
          }
        }
      }
      for (const pc of activePlayerCreatures) {
        if (!pc.indestructible) removedPlayerCreatureUids.push(pc.uid);
      }
      boardWipeCast = true;
      mainPhaseActions.push(`Board wipe: ${wipeCardName}`);
      logs.push(`${bot.name} cast ${wipeCardName} to answer an overwhelming board!`);
    } else if (
      spendable() >= 2 &&
      bot.handCount >= 1 &&
      (bot.bias.usesControl ||
        bot.liveMemory.grudgeScore >= 18 ||
        maxRivalGrudge >= 18 ||
        bot.indignance === 'ruthless' ||
        bot.indignance === 'vindictive')
    ) {
      const removalSpell = getArchetypeRemovalSpellName(bot.archetype);
      const bestRemoval = pickBestTableRemovalTarget(activePlayerCreatures, 8);
      if (bestRemoval) {
        const isCmd = bestRemoval.creature.isCommander;
        const fireChance = isCmd
          ? Math.min(0.96, 0.85 * botIntel.removalFireMult)
          : Math.min(0.92, 0.58 * indignanceAggroFactor * botIntel.removalFireMult);
        if (Math.random() < fireChance) {
          availableMana -= 2;
          bot.tappedLands = Math.min(bot.landsInPlay, bot.tappedLands + 2);
          bot.handCount = Math.max(0, bot.handCount - 1);
          const remMeta = findMeta(removalSpell);
          const exilesTarget = isExileRemovalSpell(removalSpell, remMeta);
          addBotZoneCardInPlace(bot, 'graveyard', {
            name: removalSpell,
            cmc: remMeta?.cmc || 2,
            typeLine: remMeta?.typeLine || 'Instant',
            meta: remMeta,
            reason: `Removal Turn ${turnNumber}`,
          });
          bot.liveMemory.spellsCastCount += 1;

          if (bestRemoval.kind === 'player') {
            const topThreat = bestRemoval.creature;
            playedSummaries.push(`${removalSpell} on ${topThreat.name}`);
            if (canPauseForStack) {
              mainPhaseActions.push(`Cast ${removalSpell} targeting your ${topThreat.name}`);
              return makeStackPauseReturn({
                id: `bot-stack-rem-${bot.id}-${turnNumber}-${Math.random().toString(36).slice(2, 6)}`,
                botIndex,
                botId: bot.id,
                botName: bot.name,
                seatNumber: botIndex + 2,
                cardName: removalSpell,
                cmc: remMeta?.cmc || 2,
                typeLine: remMeta?.typeLine || 'Instant',
                meta: remMeta,
                category: 'removal',
                uncounterable: isBotSpellUncounterable(removalSpell, remMeta),
                exilesTarget,
                targetSummary: `Your ${topThreat.name}${topThreat.isCommander ? ' (Commander)' : ''}`,
                targetPlayerCreatureUid: topThreat.uid,
                targetPlayerCreatureName: topThreat.name,
              });
            }
            if (exilesTarget) exiledPlayerCreatureUids.push(topThreat.uid);
            else removedPlayerCreatureUids.push(topThreat.uid);
            mainPhaseActions.push(`Cast ${removalSpell} on your ${topThreat.name}`);
            logs.push(
              `${bot.name} cast ${removalSpell} removing your ${topThreat.name}${
                topThreat.isCommander ? ' (Commander threat)' : ''
              }.`
            );
            bot.liveMemory.lastAdaptationNote = `Prioritized ${removalSpell} on your ${topThreat.name} based on table threat assessment.`;
          } else {
            const { rival, creature: topRivalThreat } = bestRemoval;
            rival.creatures = rival.creatures.filter((c) => c.uid !== topRivalThreat.uid);
            if (topRivalThreat.isCommander && rival.allowsCommandZone) {
              rival.commanderInZone = true;
              rival.commanderTax += 2;
            } else {
              addBotZoneCardInPlace(
                rival,
                exilesTarget ? 'exile' : 'graveyard',
                createLiveBotZoneCardFromCreature(
                  topRivalThreat,
                  `${exilesTarget ? 'Exiled' : 'Removed'} by ${removalSpell}`
                )
              );
            }
            addRivalGrudge(
              rival,
              bot,
              topRivalThreat.isCommander ? 20 : 12,
              `${bot.name} removed ${topRivalThreat.name} with ${removalSpell}`
            );
            playedSummaries.push(`${removalSpell} on ${rival.name}'s ${topRivalThreat.name}`);
            mainPhaseActions.push(`Cast ${removalSpell} on ${rival.name}'s ${topRivalThreat.name}`);
            logs.push(
              `${bot.name} cast ${removalSpell} ${exilesTarget ? 'exiling' : 'destroying'} ${rival.name}'s ${topRivalThreat.name}${
                topRivalThreat.isCommander ? ' (Commander threat)' : ''
              }.`
            );
            bot.liveMemory.lastAdaptationNote = `Prioritized ${removalSpell} on ${rival.name}'s ${topRivalThreat.name} as biggest table threat.`;
          }
        }
      }
    }

    // 4d. Refill hand with card draw if running low
    if (bot.handCount <= 2 && spendable() >= 3 && bot.libraryCount >= 2) {
      const drawSpell = getArchetypeDrawSpellName(bot.archetype);
      const drawMeta = findMeta(drawSpell);
      availableMana -= 3;
      bot.tappedLands = Math.min(bot.landsInPlay, bot.tappedLands + 3);
      bot.handCount = Math.max(0, bot.handCount - 1);
      addBotZoneCardInPlace(bot, 'graveyard', {
        name: drawSpell,
        cmc: drawMeta?.cmc || 3,
        typeLine: drawMeta?.typeLine || 'Sorcery',
        meta: drawMeta,
        reason: `Card Draw Turn ${turnNumber}`,
      });
      bot.liveMemory.spellsCastCount += 1;
      playedSummaries.push(`${drawSpell} (+2 cards)`);
      if (canPauseForStack && (player.interruptAlertsEnabled || player.fullControlPriority)) {
        mainPhaseActions.push(`Cast ${drawSpell} (+2 cards)`);
        return makeStackPauseReturn({
          id: `bot-stack-draw-${bot.id}-${turnNumber}-${Math.random().toString(36).slice(2, 6)}`,
          botIndex,
          botId: bot.id,
          botName: bot.name,
          seatNumber: botIndex + 2,
          cardName: drawSpell,
          cmc: drawMeta?.cmc || 3,
          typeLine: drawMeta?.typeLine || 'Sorcery',
          meta: drawMeta,
          category: 'draw',
          uncounterable: isBotSpellUncounterable(drawSpell, drawMeta),
          targetSummary: `${bot.name} (Draw 2 cards)`,
          drawCount: 2,
        });
      }
      bot.handCount += 2;
      bot.libraryCount = Math.max(0, bot.libraryCount - 2);
      mainPhaseActions.push(`Refilled hand with ${drawSpell} (+2 cards)`);
    }

    // 4e. Deploy curve-appropriate creatures (respecting real keywords & mana reserve)
    for (let deployPass = 0; deployPass < 2; deployPass++) {
      if (bot.handCount <= 0 || bot.creatures.length >= 6) break;
      const affordable = roster
        .filter((c) => c.cmc <= spendable())
        .sort((a, b) => b.cmc - a.cmc);
      if (affordable.length === 0) break;

      // Prefer evasive creatures if bot learned the table blocks frequently!
      const sortedPool =
        bot.liveMemory.userBlockCount >= 2
          ? [...affordable].sort(
              (a, b) =>
                Number(Boolean(b.flying || b.menace || b.trample)) -
                  Number(Boolean(a.flying || a.menace || a.trample)) || b.cmc - a.cmc
            )
          : affordable;

      const pick =
        sortedPool[
          deployPass === 0 ? Math.floor(Math.random() * Math.min(2, sortedPool.length)) : 0
        ];
      availableMana -= pick.cmc;
      bot.tappedLands = Math.min(bot.landsInPlay, bot.tappedLands + pick.cmc);
      bot.handCount = Math.max(0, bot.handCount - 1);
      bot.liveMemory.spellsCastCount += 1;
      const cMeta = findMeta(pick.name);
      const kw = extractCreatureKeywords(cMeta, pick);
      const creatureObj: LiveBotCreature = {
        ...kw,
        uid: `bot-c-${bot.id}-${turnNumber}-${deployPass}-${Math.random().toString(36).slice(2, 6)}`,
        name: pick.name,
        power: pick.power,
        toughness: pick.toughness,
        tapped: false,
        summoningSick: !kw.haste,
        isCommander: false,
        hasInfect: Boolean(pick.hasInfect),
        toxicValue: pick.toxicValue || 0,
        meta: cMeta,
      };
      playedSummaries.push(pick.name);
      if (
        canPauseForStack &&
        (pick.cmc >= 4 ||
          pick.power >= 4 ||
          player.interruptAlertsEnabled ||
          player.fullControlPriority)
      ) {
        mainPhaseActions.push(`Cast ${pick.name} (${pick.power}/${pick.toughness})`);
        return makeStackPauseReturn({
          id: `bot-stack-cr-${bot.id}-${turnNumber}-${Math.random().toString(36).slice(2, 6)}`,
          botIndex,
          botId: bot.id,
          botName: bot.name,
          seatNumber: botIndex + 2,
          cardName: pick.name,
          cmc: pick.cmc,
          typeLine: cMeta?.typeLine || 'Creature',
          meta: cMeta,
          category: 'creature',
          uncounterable: isBotSpellUncounterable(pick.name, cMeta),
          targetSummary: `${bot.name}'s Battlefield (${pick.power}/${pick.toughness})`,
          creaturePayload: creatureObj,
        });
      }
      bot.liveMemory.creaturesPlayedCount += 1;
      bot.creatures.push(creatureObj);
      mainPhaseActions.push(`Cast ${pick.name} (${pick.power}/${pick.toughness})`);
    }

    // 4f. Archetype spell reach (burn / drain / mill / proliferate)
    if (spendable() >= 2 && bot.handCount > 0) {
      if (bot.bias.usesBurnDrain) {
        const spellName = getArchetypeBurnSpellName(bot.archetype);
        const burnMeta = findMeta(spellName);
        const burnDmg = Math.min(5, Math.max(2, Math.round(2.5 * indignanceAggroFactor)));
        const drainHeal = /orzhov|drain|aristocrats/i.test(bot.archetype)
          ? Math.ceil(burnDmg / 2)
          : 0;
        availableMana -= 2;
        bot.tappedLands = Math.min(bot.landsInPlay, bot.tappedLands + 2);
        bot.handCount = Math.max(0, bot.handCount - 1);
        addBotZoneCardInPlace(bot, 'graveyard', {
          name: spellName,
          cmc: burnMeta?.cmc || 2,
          typeLine: burnMeta?.typeLine || 'Instant',
          meta: burnMeta,
          reason: `Cast Turn ${turnNumber}`,
        });
        bot.liveMemory.spellsCastCount += 1;
        if (target.kind === 'player' && canPauseForStack) {
          playedSummaries.push(`${spellName} (${burnDmg} dmg to You)`);
          mainPhaseActions.push(`Cast ${spellName} (${burnDmg} dmg → You)`);
          return makeStackPauseReturn({
            id: `bot-stack-burn-${bot.id}-${turnNumber}-${Math.random().toString(36).slice(2, 6)}`,
            botIndex,
            botId: bot.id,
            botName: bot.name,
            seatNumber: botIndex + 2,
            cardName: spellName,
            cmc: burnMeta?.cmc || 2,
            typeLine: burnMeta?.typeLine || 'Instant',
            meta: burnMeta,
            category: 'burn',
            uncounterable: isBotSpellUncounterable(spellName, burnMeta),
            targetSummary: `You (${burnDmg} damage${drainHeal > 0 ? `, drain +${drainHeal}` : ''})`,
            burnAmount: burnDmg,
            drainHealAmount: drainHeal,
          });
        }
        if (target.kind === 'player') {
          playerLifeDelta -= burnDmg;
          bot.liveMemory.damageDealtToPlayer += burnDmg;
        } else {
          const tb = nextBots.find((b) => b.id === target.targetBotId);
          if (tb) {
            tb.life = Math.max(0, tb.life - burnDmg);
            bot.liveMemory.damageDealtToRivals += burnDmg;
            tb.liveMemory.damageTakenFromRivals += burnDmg;
            addRivalGrudge(
              tb,
              bot,
              6 + burnDmg * 2,
              `${bot.name} hit for ${burnDmg} with ${spellName}`
            );
          }
        }
        if (drainHeal > 0) {
          bot.life += drainHeal;
        }
        playedSummaries.push(`${spellName} (${burnDmg} dmg to ${targetLabel})`);
        mainPhaseActions.push(`Cast ${spellName} (${burnDmg} dmg → ${targetLabel})`);
      } else if (bot.bias.usesMill) {
        const spellName = getArchetypeMillSpellName(bot.archetype);
        const millMeta = findMeta(spellName);
        const millAmt = Math.min(10, 4 + turnNumber);
        availableMana -= 2;
        bot.tappedLands = Math.min(bot.landsInPlay, bot.tappedLands + 2);
        bot.handCount = Math.max(0, bot.handCount - 1);
        addBotZoneCardInPlace(bot, 'graveyard', {
          name: spellName,
          cmc: millMeta?.cmc || 2,
          typeLine: millMeta?.typeLine || 'Sorcery',
          meta: millMeta,
          reason: `Cast Turn ${turnNumber}`,
        });
        bot.liveMemory.spellsCastCount += 1;
        if (target.kind === 'player' && canPauseForStack) {
          playedSummaries.push(`${spellName} (mill ${millAmt} → You)`);
          mainPhaseActions.push(`Cast ${spellName} (mill ${millAmt})`);
          return makeStackPauseReturn({
            id: `bot-stack-mill-${bot.id}-${turnNumber}-${Math.random().toString(36).slice(2, 6)}`,
            botIndex,
            botId: bot.id,
            botName: bot.name,
            seatNumber: botIndex + 2,
            cardName: spellName,
            cmc: millMeta?.cmc || 2,
            typeLine: millMeta?.typeLine || 'Sorcery',
            meta: millMeta,
            category: 'mill',
            uncounterable: isBotSpellUncounterable(spellName, millMeta),
            targetSummary: `You (Mill ${millAmt} cards)`,
            millAmount: millAmt,
          });
        }
        if (target.kind === 'player') {
          playerMillCount += millAmt;
        } else {
          const tb = nextBots.find((b) => b.id === target.targetBotId);
          if (tb) {
            const actual = Math.min(tb.libraryCount, millAmt);
            tb.libraryCount -= actual;
            const rivalRoster = getCreatureRosterForArchetype(tb.archetype);
            for (let m = 0; m < actual; m++) {
              const milledCustom = tb.customLibrary.shift();
              if (milledCustom) {
                addBotZoneCardInPlace(tb, 'graveyard', {
                  name: milledCustom.name,
                  cmc: milledCustom.cmc,
                  typeLine: milledCustom.meta?.typeLine || 'Card',
                  meta: milledCustom.meta ?? null,
                  reason: `Milled by ${spellName}`,
                });
              } else {
                const sampleCard = rivalRoster[m % rivalRoster.length];
                const mName = m % 3 === 0 ? 'Land' : sampleCard?.name || 'Spell';
                addBotZoneCardInPlace(tb, 'graveyard', {
                  name: mName,
                  cmc: m % 3 === 0 ? 0 : sampleCard?.cmc || 2,
                  typeLine: m % 3 === 0 ? 'Basic Land' : 'Creature',
                  meta: mName === 'Land' ? null : findMeta(mName),
                  reason: `Milled by ${spellName}`,
                });
              }
            }
            addRivalGrudge(
              tb,
              bot,
              6 + Math.ceil(actual / 2),
              `${bot.name} milled ${actual} cards with ${spellName}`
            );
          }
        }
        playedSummaries.push(`${spellName} (mill ${millAmt} → ${targetLabel})`);
        mainPhaseActions.push(`Cast ${spellName} (mill ${millAmt})`);
      } else if (bot.bias.usesProliferate && target.kind === 'player' && player.poison > 0) {
        const prolifMeta = findMeta('Prologue to Phyresis');
        availableMana -= 2;
        bot.tappedLands = Math.min(bot.landsInPlay, bot.tappedLands + 2);
        bot.handCount = Math.max(0, bot.handCount - 1);
        addBotZoneCardInPlace(bot, 'graveyard', {
          name: 'Prologue to Phyresis',
          cmc: prolifMeta?.cmc || 2,
          typeLine: prolifMeta?.typeLine || 'Instant',
          meta: prolifMeta,
          reason: `Cast Turn ${turnNumber}`,
        });
        bot.liveMemory.spellsCastCount += 1;
        playerPoisonDelta += 1;
        playedSummaries.push('Prologue to Phyresis (+1 Poison)');
        mainPhaseActions.push('Proliferated +1 Poison counter on You');
      } else if (bot.bias.usesProliferate && target.kind === 'bot') {
        const tb = nextBots.find((b) => b.id === target.targetBotId);
        if (tb && tb.poison > 0) {
          const prolifMeta = findMeta('Prologue to Phyresis');
          availableMana -= 2;
          bot.tappedLands = Math.min(bot.landsInPlay, bot.tappedLands + 2);
          bot.handCount = Math.max(0, bot.handCount - 1);
          addBotZoneCardInPlace(bot, 'graveyard', {
            name: 'Prologue to Phyresis',
            cmc: prolifMeta?.cmc || 2,
            typeLine: prolifMeta?.typeLine || 'Instant',
            meta: prolifMeta,
            reason: `Cast Turn ${turnNumber}`,
          });
          bot.liveMemory.spellsCastCount += 1;
          tb.poison = Math.min(20, tb.poison + 1);
          addRivalGrudge(tb, bot, 10, `${bot.name} proliferated poison`);
          playedSummaries.push(`Proliferate (+1 Poison → ${targetLabel})`);
          mainPhaseActions.push(`Proliferated +1 Poison on ${targetLabel}`);
        }
      }
    }
  }

  if (reserveMana > 0 && bot.landsInPlay - bot.tappedLands >= 2) {
    bot.liveMemory.holdManaForInteraction = true;
    const holdNote = `Holding ${bot.landsInPlay - bot.tappedLands} open mana for interaction.`;
    mainPhaseActions.push(holdNote);
    bot.liveMemory.lastAdaptationNote = playerHasCommanderReadySoon
      ? `Holding ${bot.landsInPlay - bot.tappedLands} mana anticipating your Commander.`
      : holdNote;
  }

  phaseSteps.push({
    phase: 'Main Phase',
    summary:
      mainPhaseActions.length > 0
        ? mainPhaseActions.join(' · ')
        : 'Held mana open and passed to Combat.',
  });

  // 5. Accurate Combat Phase (with Smart Blocker-Aware Target Pivoting across ALL opponents!)
  const eligibleAttackers = bot.creatures.filter(
    (c) => !c.tapped && (!c.summoningSick || c.haste) && c.power > 0
  );

  const playerUntappedCreatures = player.creatures.filter(
    (pc) => !pc.tapped && !removedPlayerCreatureUids.includes(pc.uid)
  );
  const incomingPlayerCrackback = player.creatures
    .filter((pc) => !removedPlayerCreatureUids.includes(pc.uid))
    .reduce((s, c) => s + c.power, 0);

  let pendingAttackOnPlayer: PendingBotAttack | null = null;
  let combatSummary = 'No profitable attacks declared.';

  if (eligibleAttackers.length > 0) {
    // Evaluate ranked targets in order: if the primary seat has a wall of blockers that
    // prevents profitable swings, pivot combat to an open rival bot (or open seat) instead!
    let chosenCombatRef = target;
    let chosenSelection: {
      attackers: LiveBotCreature[];
      heldBackCount: number;
      reasoning: string;
    } | null = null;
    let pivotedFromLabel: string | null = null;

    for (let tIdx = 0; tIdx < rankedTargets.length; tIdx++) {
      const candidateRef = rankedTargets[tIdx].ref;
      let evalSel: {
        attackers: LiveBotCreature[];
        heldBackCount: number;
        reasoning: string;
      };

      if (candidateRef.kind === 'bot') {
        const rival = nextBots.find((b) => b.id === candidateRef.targetBotId);
        if (!rival || rival.eliminated) continue;
        const rivalCmdTaken = bot.liveMemory.commanderDamageDealtToRivals[rival.id] || 0;
        evalSel = selectSmartBotAttackers(
          bot,
          eligibleAttackers,
          rival.creatures,
          rival.life,
          rival.poison,
          rivalCmdTaken,
          rival.creatures.reduce((s, c) => s + c.power, 0)
        );
      } else {
        evalSel = selectSmartBotAttackers(
          bot,
          eligibleAttackers,
          playerUntappedCreatures,
          player.life,
          player.poison,
          bot.commanderDamageDealtToYou,
          incomingPlayerCrackback
        );
      }

      if (evalSel.attackers.length > 0) {
        chosenCombatRef = candidateRef;
        chosenSelection = evalSel;
        if (tIdx > 0) {
          pivotedFromLabel = targetLabel;
        }
        break;
      } else if (tIdx === 0) {
        chosenSelection = evalSel;
      }
    }

    const combatTargetLabel =
      chosenCombatRef.kind === 'player' ? 'You' : chosenCombatRef.targetBotName;

    if (pivotedFromLabel && chosenSelection && chosenSelection.attackers.length > 0) {
      bot.lastTargetName = combatTargetLabel;
      bot.liveMemory.consecutiveTurnsOnSameTarget = 1;
      const pivotNote = `Pivoted combat from ${pivotedFromLabel}'s blockers to attack ${combatTargetLabel} cleanly.`;
      bot.liveMemory.lastAdaptationNote = pivotNote;
      bot.liveMemory.adaptationHistory = [
        ...bot.liveMemory.adaptationHistory.filter((h) => h !== pivotNote),
        pivotNote,
      ].slice(-6);
    }

    if (chosenCombatRef.kind === 'bot') {
      const rival = nextBots.find((b) => b.id === chosenCombatRef.targetBotId);
      if (rival && !rival.eliminated && chosenSelection) {
        const attackers = chosenSelection.attackers;
        if (attackers.length > 0) {
          const atkIds = new Set(attackers.filter((a) => !a.vigilance).map((a) => a.uid));
          bot.creatures = bot.creatures.map((c) =>
            atkIds.has(c.uid) ? { ...c, tapped: true } : c
          );

          const availableRivalBlockers = rival.creatures.filter((c) => !c.tapped && c.toughness > 0);
          let totalDmg = 0;
          let totalPoison = 0;
          let totalCmdrDmg = 0;
          let botLifeGained = 0;

          for (const atk of attackers) {
            const legalIdx = availableRivalBlockers.findIndex(
              (b) => (!atk.flying || b.flying || b.reach) && !atk.menace
            );
            const blocker =
              legalIdx >= 0 ? availableRivalBlockers.splice(legalIdx, 1)[0] : undefined;

            if (blocker) {
              const atkKillsBlocker =
                !blocker.indestructible && (atk.deathtouch || atk.power >= blocker.toughness);
              const blockerKillsAtk =
                !atk.indestructible &&
                (blocker.deathtouch || blocker.power >= atk.toughness) &&
                !(atk.firstStrike && atkKillsBlocker && !blocker.firstStrike);

              if (atk.lifelink) botLifeGained += atk.power;
              if (blocker.lifelink) rival.life += blocker.power;

              // Trample excess damage
              if (atk.trample) {
                const lethalNeeded = atk.deathtouch ? 1 : blocker.toughness;
                const excess = Math.max(0, atk.power - lethalNeeded);
                if (excess > 0) {
                  if (atk.hasInfect) totalPoison += excess;
                  else totalDmg += excess;
                  if (atk.isCommander && bot.usesCommanderDamage21) {
                    totalCmdrDmg += excess;
                  }
                }
              }

              if (atkKillsBlocker) {
                rival.creatures = rival.creatures.filter((c) => c.uid !== blocker.uid);
                if (blocker.isCommander && rival.allowsCommandZone) {
                  rival.commanderInZone = true;
                  rival.commanderTax += 2;
                } else {
                  addBotZoneCardInPlace(rival, 'graveyard', createLiveBotZoneCardFromCreature(blocker, `Killed blocking ${atk.name}`));
                }
              }
              if (blockerKillsAtk) {
                bot.creatures = bot.creatures.filter((c) => c.uid !== atk.uid);
                if (atk.isCommander && bot.allowsCommandZone) {
                  bot.commanderInZone = true;
                  bot.commanderTax += 2;
                } else {
                  addBotZoneCardInPlace(bot, 'graveyard', createLiveBotZoneCardFromCreature(atk, `Killed in combat vs ${blocker.name}`));
                }
              }
            } else {
              if (atk.lifelink) botLifeGained += atk.power;
              if (atk.hasInfect) {
                totalPoison += atk.power;
              } else {
                totalDmg += atk.power;
                if (atk.toxicValue > 0) totalPoison += atk.toxicValue;
              }
              if (atk.isCommander && bot.usesCommanderDamage21) {
                totalCmdrDmg += atk.power;
              }
            }
          }

          if (botLifeGained > 0) bot.life += botLifeGained;
          rival.life = Math.max(0, rival.life - totalDmg);
          rival.poison = Math.min(20, rival.poison + totalPoison);
          if (totalCmdrDmg > 0) {
            bot.liveMemory.commanderDamageDealtToRivals[rival.id] =
              (bot.liveMemory.commanderDamageDealtToRivals[rival.id] || 0) + totalCmdrDmg;
          }

          bot.liveMemory.damageDealtToRivals += totalDmg;
          rival.liveMemory.damageTakenFromRivals += totalDmg;
          addRivalGrudge(
            rival,
            bot,
            12 + totalDmg * 2 + totalPoison * 5 + totalCmdrDmg * 3,
            `${bot.name} attacked for ${totalDmg} dmg${totalPoison > 0 ? ` & ${totalPoison} poison` : ''}`
          );

          const rivalCmdTotalFromBot =
            bot.liveMemory.commanderDamageDealtToRivals[rival.id] || 0;
          if (rival.poison >= 10) {
            rival.eliminated = true;
            rival.eliminatedReason = 'poison';
            rival.creatures = [];
          } else if (rival.usesCommanderDamage21 && rivalCmdTotalFromBot >= 21) {
            rival.eliminated = true;
            rival.eliminatedReason = 'commander';
            rival.creatures = [];
          } else if (rival.life <= 0) {
            rival.eliminated = true;
            rival.eliminatedReason = 'life';
            rival.creatures = [];
          }

          combatSummary = `${pivotedFromLabel ? 'Pivoted & attacked' : 'Attacked'} ${rival.name} with ${
            attackers.length
          } creature${attackers.length === 1 ? '' : 's'} (${totalDmg} dmg${
            totalPoison > 0 ? `, +${totalPoison} poison` : ''
          }${totalCmdrDmg > 0 ? `, +${totalCmdrDmg} cmdr` : ''})`;
          playedSummaries.push(combatSummary);
          logs.push(
            `${bot.name} ${pivotedFromLabel ? 'pivoted around blockers and ' : ''}attacked ${
              rival.name
            } with ${attackers.map((a) => a.name).join(', ')} for ${totalDmg} damage${
              totalPoison > 0 ? ` and ${totalPoison} poison` : ''
            }${totalCmdrDmg > 0 ? ` (${totalCmdrDmg} Commander dmg)` : ''}${
              rival.eliminated ? ` — eliminated ${rival.name}!` : '.'
            }`
          );
        } else if (chosenSelection.reasoning) {
          combatSummary = chosenSelection.reasoning;
        }
      }
    } else if (chosenSelection) {
      // Evaluating attacks against YOU
      const attackers = chosenSelection.attackers;
      if (attackers.length > 0) {
        const atkIds = new Set(attackers.filter((a) => !a.vigilance).map((a) => a.uid));
        bot.creatures = bot.creatures.map((c) =>
          atkIds.has(c.uid) ? { ...c, tapped: true } : c
        );

        // Check if player has ANY legal blocker for at least one attacker
        const playerHasLegalBlocker = attackers.some((atk) => {
          const legal = playerUntappedCreatures.filter(
            (blk) => !atk.flying || blk.flying || blk.reach
          );
          return atk.menace ? legal.length >= 2 : legal.length >= 1;
        });

        if (playerHasLegalBlocker || canPauseForStack) {
          pendingAttackOnPlayer = {
            botId: bot.id,
            botName: bot.name,
            commanderName: bot.commanderName,
            attackers,
            adaptationReason: chosenSelection.reasoning || bot.liveMemory.lastAdaptationNote,
          };
          combatSummary = `Attacking You (${attackers
            .map((a) => `${a.name} ${a.power}/${a.toughness}`)
            .join(', ')})`;
          playedSummaries.push(combatSummary);
          logs.push(
            `${bot.name} is attacking YOU with ${attackers
              .map((a) => `${a.name} (${a.power}/${a.toughness})`)
              .join(', ')} — ${
              playerHasLegalBlocker
                ? 'choose blockers, cast instant responses, or take damage!'
                : 'cast instant-speed responses (Removal / Fog / Flash) or take damage!'
            }`
          );
        } else {
          let dmg = 0;
          let poison = 0;
          let cmdrDmg = 0;
          let lifeGained = 0;
          for (const atk of attackers) {
            if (atk.lifelink) lifeGained += atk.power;
            if (atk.hasInfect) {
              poison += atk.power;
            } else {
              dmg += atk.power;
              if (atk.toxicValue > 0) poison += atk.toxicValue;
            }
            if (atk.isCommander && bot.usesCommanderDamage21) {
              cmdrDmg += atk.power;
            }
          }
          if (lifeGained > 0) bot.life += lifeGained;
          playerLifeDelta -= dmg;
          playerPoisonDelta += poison;
          bot.commanderDamageDealtToYou += cmdrDmg;
          bot.liveMemory.damageDealtToPlayer += dmg;
          combatSummary = `Attacked You unblocked (${dmg} dmg${
            poison > 0 ? `, +${poison} poison` : ''
          }${cmdrDmg > 0 ? `, +${cmdrDmg} cmdr` : ''}${lifeGained > 0 ? `, +${lifeGained} lifelink` : ''})`;
          playedSummaries.push(combatSummary);
          logs.push(
            `${bot.name} attacked You unblocked with ${attackers
              .map((a) => a.name)
              .join(', ')} for ${dmg} dmg${poison > 0 ? `, ${poison} poison` : ''}${
              cmdrDmg > 0 ? `, ${cmdrDmg} cmdr dmg` : ''
            }.`
          );
        }
      } else if (chosenSelection.reasoning) {
        combatSummary = chosenSelection.reasoning;
        bot.liveMemory.lastAdaptationNote = chosenSelection.reasoning;
      }
    }
  }

  phaseSteps.push({
    phase: 'Combat',
    summary: combatSummary,
  });

  // Update eliminated flags for rival bots hit by spells or Commander damage
  for (const other of nextBots) {
    if (!other.eliminated) {
      const maxRivalCmdOnOther = nextBots.reduce(
        (mx, b) => Math.max(mx, b.liveMemory.commanderDamageDealtToRivals?.[other.id] || 0),
        0
      );
      if (other.poison >= 10) {
        other.eliminated = true;
        other.eliminatedReason = 'poison';
        other.creatures = [];
      } else if (
        other.usesCommanderDamage21 &&
        (other.commanderDamageTakenFromYou >= 21 || maxRivalCmdOnOther >= 21)
      ) {
        other.eliminated = true;
        other.eliminatedReason = 'commander';
        other.creatures = [];
      } else if (other.life <= 0) {
        other.eliminated = true;
        other.eliminatedReason = 'life';
        other.creatures = [];
      }
    }
  }

  bot.lastActionSummary =
    playedSummaries.length > 0
      ? playedSummaries.join(' · ')
      : 'Passed turn holding mana open.';
  bot.lastTurnSteps = phaseSteps;

  if (!logs.length) {
    logs.push(`${bot.name}: ${bot.lastActionSummary}`);
  }

  return {
    updatedBots: nextBots,
    playerLifeDelta,
    playerPoisonDelta,
    playerMillCount,
    removedPlayerCreatureUids,
    exiledPlayerCreatureUids,
    boardWipeCast,
    logs,
    phaseSteps,
    adaptationNote: bot.liveMemory.lastAdaptationNote,
    pendingAttackOnPlayer,
    pendingStackSpell: null,
  };
}

/**
 * Resumes a bot's Combat Phase after its paused Main Phase spell finishes resolving
 * on the interactive Stack (whether resolved or countered!).
 */
export function executeBotPostStackCombat(
  botIndex: number,
  bots: LiveBotState[],
  player: PlayerBoardSnapshot,
  targetsHitThisRound: Record<string, number> = {},
  priorPhaseSteps: BotTurnPhaseStep[] = [],
  priorPlayedSummaries: string[] = [],
  resolvedSpellNote?: string
): BotTurnResolution {
  const nextBots = bots.map((b) => ({
    ...b,
    creatures: b.creatures.map((c) => ({ ...c })),
    graveyardCards: [...(b.graveyardCards || [])],
    exileCards: [...(b.exileCards || [])],
    customHand: [...b.customHand],
    customLibrary: [...b.customLibrary],
    lastTurnSteps: [...b.lastTurnSteps],
    liveMemory: {
      ...b.liveMemory,
      rivalGrudgeByBotId: { ...(b.liveMemory.rivalGrudgeByBotId || {}) },
      commanderDamageDealtToRivals: { ...(b.liveMemory.commanderDamageDealtToRivals || {}) },
      priorRivalThreatByName: { ...(b.liveMemory.priorRivalThreatByName || {}) },
      observedUserThreats: [...b.liveMemory.observedUserThreats],
      observedUserHabits: [...b.liveMemory.observedUserHabits],
      adaptationHistory: [...b.liveMemory.adaptationHistory],
    },
  }));

  const bot = nextBots[botIndex];
  if (!bot || bot.eliminated) {
    return {
      updatedBots: nextBots,
      playerLifeDelta: 0,
      playerPoisonDelta: 0,
      playerMillCount: 0,
      removedPlayerCreatureUids: [],
      boardWipeCast: false,
      logs: [],
      phaseSteps: priorPhaseSteps,
      adaptationNote: '',
      pendingAttackOnPlayer: null,
      pendingStackSpell: null,
    };
  }

  const logs: string[] = [];
  const phaseSteps: BotTurnPhaseStep[] = [...priorPhaseSteps];
  if (resolvedSpellNote) {
    phaseSteps.push({ phase: 'Main Phase', summary: `Stack resolved: ${resolvedSpellNote}` });
  }
  const playedSummaries: string[] = [...priorPlayedSummaries];
  let playerLifeDelta = 0;
  let playerPoisonDelta = 0;
  let pendingAttackOnPlayer: PendingBotAttack | null = null;
  let combatSummary = 'No profitable attacks declared.';

  const canPauseForInstantCombat = Boolean(
    player.canRespondAtInstantSpeed || player.fullControlPriority
  );

  const rankedTargets = rankBotTargets(bot, nextBots, player, targetsHitThisRound);
  const primaryScored = rankedTargets[0] || {
    ref: { kind: 'player' as const, label: 'You' },
    score: 0,
    reason: 'Default target',
  };
  const target = primaryScored.ref;
  const targetLabel = target.kind === 'player' ? 'You' : target.targetBotName;

  const eligibleAttackers = bot.creatures.filter(
    (c) => !c.tapped && (!c.summoningSick || c.haste) && c.power > 0
  );
  const playerUntappedCreatures = player.creatures.filter((pc) => !pc.tapped);
  const incomingPlayerCrackback = player.creatures.reduce((s, c) => s + c.power, 0);

  if (eligibleAttackers.length > 0) {
    let chosenCombatRef = target;
    let chosenSelection: {
      attackers: LiveBotCreature[];
      heldBackCount: number;
      reasoning: string;
    } | null = null;
    let pivotedFromLabel: string | null = null;

    for (let tIdx = 0; tIdx < rankedTargets.length; tIdx++) {
      const candidateRef = rankedTargets[tIdx].ref;
      let evalSel: {
        attackers: LiveBotCreature[];
        heldBackCount: number;
        reasoning: string;
      };

      if (candidateRef.kind === 'bot') {
        const rival = nextBots.find((b) => b.id === candidateRef.targetBotId);
        if (!rival || rival.eliminated) continue;
        const rivalCmdTaken = bot.liveMemory.commanderDamageDealtToRivals[rival.id] || 0;
        evalSel = selectSmartBotAttackers(
          bot,
          eligibleAttackers,
          rival.creatures,
          rival.life,
          rival.poison,
          rivalCmdTaken,
          rival.creatures.reduce((s, c) => s + c.power, 0)
        );
      } else {
        evalSel = selectSmartBotAttackers(
          bot,
          eligibleAttackers,
          playerUntappedCreatures,
          player.life,
          player.poison,
          bot.commanderDamageDealtToYou,
          incomingPlayerCrackback
        );
      }

      if (evalSel.attackers.length > 0) {
        chosenCombatRef = candidateRef;
        chosenSelection = evalSel;
        if (tIdx > 0) pivotedFromLabel = targetLabel;
        break;
      } else if (tIdx === 0) {
        chosenSelection = evalSel;
      }
    }

    if (chosenCombatRef.kind === 'bot') {
      const rival = nextBots.find((b) => b.id === chosenCombatRef.targetBotId);
      if (rival && !rival.eliminated && chosenSelection && chosenSelection.attackers.length > 0) {
        const attackers = chosenSelection.attackers;
        const atkIds = new Set(attackers.filter((a) => !a.vigilance).map((a) => a.uid));
        bot.creatures = bot.creatures.map((c) =>
          atkIds.has(c.uid) ? { ...c, tapped: true } : c
        );
        const availableRivalBlockers = rival.creatures.filter((c) => !c.tapped && c.toughness > 0);
        let totalDmg = 0;
        let totalPoison = 0;
        let totalCmdrDmg = 0;
        let botLifeGained = 0;

        for (const atk of attackers) {
          const legalIdx = availableRivalBlockers.findIndex(
            (b) => (!atk.flying || b.flying || b.reach) && !atk.menace
          );
          const blocker = legalIdx >= 0 ? availableRivalBlockers.splice(legalIdx, 1)[0] : undefined;
          if (blocker) {
            const atkKillsBlocker =
              !blocker.indestructible && (atk.deathtouch || atk.power >= blocker.toughness);
            const blockerKillsAtk =
              !atk.indestructible &&
              (blocker.deathtouch || blocker.power >= atk.toughness) &&
              !(atk.firstStrike && atkKillsBlocker && !blocker.firstStrike);
            if (atk.lifelink) botLifeGained += atk.power;
            if (blocker.lifelink) rival.life += blocker.power;
            if (atk.trample) {
              const lethalNeeded = atk.deathtouch ? 1 : blocker.toughness;
              const excess = Math.max(0, atk.power - lethalNeeded);
              if (excess > 0) {
                if (atk.hasInfect) totalPoison += excess;
                else totalDmg += excess;
                if (atk.isCommander && bot.usesCommanderDamage21) totalCmdrDmg += excess;
              }
            }
            if (atkKillsBlocker) {
              rival.creatures = rival.creatures.filter((c) => c.uid !== blocker.uid);
              if (blocker.isCommander && rival.allowsCommandZone) {
                rival.commanderInZone = true;
                rival.commanderTax += 2;
              } else {
                addBotZoneCardInPlace(rival, 'graveyard', createLiveBotZoneCardFromCreature(blocker, `Killed blocking ${atk.name}`));
              }
            }
            if (blockerKillsAtk) {
              bot.creatures = bot.creatures.filter((c) => c.uid !== atk.uid);
              if (atk.isCommander && bot.allowsCommandZone) {
                bot.commanderInZone = true;
                bot.commanderTax += 2;
              } else {
                addBotZoneCardInPlace(bot, 'graveyard', createLiveBotZoneCardFromCreature(atk, `Killed in combat vs ${blocker.name}`));
              }
            }
          } else {
            if (atk.lifelink) botLifeGained += atk.power;
            if (atk.hasInfect) totalPoison += atk.power;
            else {
              totalDmg += atk.power;
              if (atk.toxicValue > 0) totalPoison += atk.toxicValue;
            }
            if (atk.isCommander && bot.usesCommanderDamage21) totalCmdrDmg += atk.power;
          }
        }
        if (botLifeGained > 0) bot.life += botLifeGained;
        rival.life = Math.max(0, rival.life - totalDmg);
        rival.poison = Math.min(20, rival.poison + totalPoison);
        if (totalCmdrDmg > 0) {
          bot.liveMemory.commanderDamageDealtToRivals[rival.id] =
            (bot.liveMemory.commanderDamageDealtToRivals[rival.id] || 0) + totalCmdrDmg;
        }
        bot.liveMemory.damageDealtToRivals += totalDmg;
        rival.liveMemory.damageTakenFromRivals += totalDmg;
        combatSummary = `${pivotedFromLabel ? 'Pivoted & attacked' : 'Attacked'} ${rival.name} with ${
          attackers.length
        } creature${attackers.length === 1 ? '' : 's'} (${totalDmg} dmg)`;
        playedSummaries.push(combatSummary);
        logs.push(`${bot.name} attacked ${rival.name} for ${totalDmg} damage.`);
      }
    } else if (chosenSelection && chosenSelection.attackers.length > 0) {
      const attackers = chosenSelection.attackers;
      const atkIds = new Set(attackers.filter((a) => !a.vigilance).map((a) => a.uid));
      bot.creatures = bot.creatures.map((c) =>
        atkIds.has(c.uid) ? { ...c, tapped: true } : c
      );

      const playerHasLegalBlocker = attackers.some((atk) => {
        const legal = playerUntappedCreatures.filter(
          (blk) => !atk.flying || blk.flying || blk.reach
        );
        return atk.menace ? legal.length >= 2 : legal.length >= 1;
      });

      if (playerHasLegalBlocker || canPauseForInstantCombat) {
        pendingAttackOnPlayer = {
          botId: bot.id,
          botName: bot.name,
          commanderName: bot.commanderName,
          attackers,
          adaptationReason: chosenSelection.reasoning || bot.liveMemory.lastAdaptationNote,
        };
        combatSummary = `Attacking You (${attackers
          .map((a) => `${a.name} ${a.power}/${a.toughness}`)
          .join(', ')})`;
        playedSummaries.push(combatSummary);
        logs.push(
          `${bot.name} is attacking YOU with ${attackers
            .map((a) => `${a.name} (${a.power}/${a.toughness})`)
            .join(', ')} — choose blockers, cast instant responses, or take damage!`
        );
      } else {
        let dmg = 0;
        let poison = 0;
        let cmdrDmg = 0;
        let lifeGained = 0;
        for (const atk of attackers) {
          if (atk.lifelink) lifeGained += atk.power;
          if (atk.hasInfect) poison += atk.power;
          else {
            dmg += atk.power;
            if (atk.toxicValue > 0) poison += atk.toxicValue;
          }
          if (atk.isCommander && bot.usesCommanderDamage21) cmdrDmg += atk.power;
        }
        if (lifeGained > 0) bot.life += lifeGained;
        playerLifeDelta -= dmg;
        playerPoisonDelta += poison;
        bot.commanderDamageDealtToYou += cmdrDmg;
        bot.liveMemory.damageDealtToPlayer += dmg;
        combatSummary = `Attacked You unblocked (${dmg} dmg${poison > 0 ? `, +${poison} poison` : ''})`;
        playedSummaries.push(combatSummary);
        logs.push(
          `${bot.name} attacked You unblocked with ${attackers.map((a) => a.name).join(', ')} for ${dmg} dmg.`
        );
      }
    }
  }

  phaseSteps.push({ phase: 'Combat', summary: combatSummary });

  for (const other of nextBots) {
    if (!other.eliminated) {
      const maxRivalCmdOnOther = nextBots.reduce(
        (mx, b) => Math.max(mx, b.liveMemory.commanderDamageDealtToRivals?.[other.id] || 0),
        0
      );
      if (other.poison >= 10) {
        other.eliminated = true;
        other.eliminatedReason = 'poison';
        other.creatures = [];
      } else if (
        other.usesCommanderDamage21 &&
        (other.commanderDamageTakenFromYou >= 21 || maxRivalCmdOnOther >= 21)
      ) {
        other.eliminated = true;
        other.eliminatedReason = 'commander';
        other.creatures = [];
      } else if (other.life <= 0) {
        other.eliminated = true;
        other.eliminatedReason = 'life';
        other.creatures = [];
      }
    }
  }

  bot.lastActionSummary =
    playedSummaries.length > 0 ? playedSummaries.join(' · ') : 'Passed turn.';
  bot.lastTurnSteps = phaseSteps;

  return {
    updatedBots: nextBots,
    playerLifeDelta,
    playerPoisonDelta,
    playerMillCount: 0,
    removedPlayerCreatureUids: [],
    boardWipeCast: false,
    logs,
    phaseSteps,
    adaptationNote: bot.liveMemory.lastAdaptationNote,
    pendingAttackOnPlayer,
    pendingStackSpell: null,
  };
}

/**
 * Accurate MTG combat blocker engine when the USER attacks a bot.
 * Respects Flying/Reach, Menace (requires 2+ blockers), Trample, Deathtouch,
 * First Strike, Lifelink, Vigilance, and Indestructible.
 */
export function resolveBotBlocksForPlayerAttack(
  targetBot: LiveBotState,
  attackers: Array<{
    uid: string;
    name: string;
    power: number;
    toughness: number;
    isCommander: boolean;
    hasInfect: boolean;
    toxicValue: number;
    keywords: CreatureKeywords;
  }>,
  usesCommanderDamage21: boolean
): {
  lifeDmgToBot: number;
  poisonDmgToBot: number;
  cmdrDmgToBot: number;
  playerLifeGain: number;
  botLifeGain: number;
  deadPlayerAtkUids: string[];
  deadBotBlockerUids: string[];
  blockMessages: string[];
} {
  const availableBlockers = targetBot.creatures
    .filter((c) => !c.tapped && c.toughness > 0)
    .map((c) => ({ ...c }));

  const deadPlayerAtkUids: string[] = [];
  const deadBotBlockerUids: string[] = [];
  const blockMessages: string[] = [];

  let lifeDmgToBot = 0;
  let poisonDmgToBot = 0;
  let cmdrDmgToBot = 0;
  let playerLifeGain = 0;
  let botLifeGain = 0;

  const totalIncomingPower = attackers.reduce((s, a) => s + a.power, 0);
  const facingDanger =
    totalIncomingPower >= targetBot.life ||
    targetBot.life <= Math.round(targetBot.startingLife * 0.45) ||
    attackers.some(
      (a) =>
        a.hasInfect ||
        (a.isCommander && usesCommanderDamage21 && targetBot.commanderDamageTakenFromYou + a.power >= 12)
    );

  // Sort player's attackers by threat priority (Commander / Infect / highest power)
  const sortedAttackers = [...attackers].sort((a, b) => {
    const score = (x: typeof a) =>
      x.power * 2 + (x.isCommander ? 10 : 0) + (x.hasInfect ? 12 : 0) + (x.keywords.trample ? 3 : 0);
    return score(b) - score(a);
  });

  const botIntel = getBotIntelligenceMeta(targetBot.intelligence);

  for (const atk of sortedAttackers) {
    const legalBlockers = availableBlockers.filter(
      (b) => !atk.keywords.flying || b.flying || b.reach
    );
    const minNeeded = atk.keywords.menace ? 2 : 1;

    let assignedBlockers: LiveBotCreature[] = [];

    if (legalBlockers.length >= minNeeded && Math.random() <= botIntel.blockingAccuracy) {
      if (minNeeded === 1) {
        // 1. Prefer a blocker that kills the attacker AND survives
        const winningBlocker = legalBlockers.find((b) => {
          const bKillsAtk =
            !atk.keywords.indestructible && (b.deathtouch || b.power >= atk.toughness);
          const atkKillsB =
            !b.indestructible &&
            (atk.keywords.deathtouch || atk.power >= b.toughness) &&
            !(b.firstStrike && bKillsAtk && !atk.keywords.firstStrike);
          return bKillsAtk && !atkKillsB;
        });

        // 2. Otherwise prefer a favorable trade (deathtouch or lower-value blocker killing big threat)
        const tradeBlocker = legalBlockers
          .filter(
            (b) =>
              !atk.keywords.indestructible &&
              (b.deathtouch || b.power >= atk.toughness) &&
              (!b.isCommander || facingDanger)
          )
          .sort((a, b) => a.power + a.toughness - (b.power + b.toughness))[0];

        // 3. Otherwise chump-block only if facing lethal / high danger / big commander
        const chumpBlocker = facingDanger
          ? [...legalBlockers]
              .filter((b) => !b.isCommander || totalIncomingPower >= targetBot.life)
              .sort((a, b) => a.power + a.toughness - (b.power + b.toughness))[0]
          : undefined;

        const chosen = winningBlocker || tradeBlocker || chumpBlocker;
        if (chosen) {
          assignedBlockers = [chosen];
        }
      } else if (facingDanger || atk.isCommander || atk.power >= 5) {
        // Menace requires 2 blockers — assign 2 smallest that can kill or stop lethal
        const pair = [...legalBlockers]
          .sort((a, b) => a.power + a.toughness - (b.power + b.toughness))
          .slice(0, 2);
        const combinedPower = pair.reduce((s, b) => s + b.power, 0);
        if (pair.length === 2 && (combinedPower >= atk.toughness || facingDanger)) {
          assignedBlockers = pair;
        }
      }
    }

    if (assignedBlockers.length > 0) {
      // Remove assigned blockers from available pool
      for (const blk of assignedBlockers) {
        const idx = availableBlockers.findIndex((x) => x.uid === blk.uid);
        if (idx >= 0) availableBlockers.splice(idx, 1);
      }

      if (atk.keywords.lifelink) playerLifeGain += atk.power;

      // Resolve combat damage with First Strike, Deathtouch, Trample, Indestructible, Lifelink
      let remainingAtkPower = atk.power;
      const killedFirstStrikeBlockers = new Set<string>();

      if (atk.keywords.firstStrike) {
        for (const blk of assignedBlockers) {
          if (remainingAtkPower <= 0) break;
          const needed = atk.keywords.deathtouch ? 1 : blk.toughness;
          if (remainingAtkPower >= needed) {
            if (!blk.indestructible) {
              deadBotBlockerUids.push(blk.uid);
              killedFirstStrikeBlockers.add(blk.uid);
            }
            remainingAtkPower -= needed;
          }
        }
      } else {
        for (const blk of assignedBlockers) {
          if (remainingAtkPower <= 0) break;
          const needed = atk.keywords.deathtouch ? 1 : blk.toughness;
          if (remainingAtkPower >= needed) {
            if (!blk.indestructible) deadBotBlockerUids.push(blk.uid);
            remainingAtkPower -= needed;
          } else {
            remainingAtkPower = 0;
          }
        }
      }

      // Surviving blockers (or non-first-strike simultaneous blockers) deal damage back
      const hittingBlockers = assignedBlockers.filter(
        (b) => !killedFirstStrikeBlockers.has(b.uid) || b.firstStrike
      );
      const totalBlkPower = hittingBlockers.reduce((s, b) => s + b.power, 0);
      const anyBlkDeathtouch = hittingBlockers.some((b) => b.deathtouch && b.power > 0);
      for (const b of hittingBlockers) {
        if (b.lifelink) botLifeGain += b.power;
      }
      if (!atk.keywords.indestructible && (anyBlkDeathtouch || totalBlkPower >= atk.toughness)) {
        deadPlayerAtkUids.push(atk.uid);
      }

      // Trample rolls excess damage over to bot!
      if (atk.keywords.trample && remainingAtkPower > 0) {
        if (atk.hasInfect) {
          poisonDmgToBot += remainingAtkPower;
        } else {
          lifeDmgToBot += remainingAtkPower;
          if (atk.toxicValue > 0) poisonDmgToBot += atk.toxicValue;
        }
        if (atk.isCommander && usesCommanderDamage21) {
          cmdrDmgToBot += remainingAtkPower;
        }
      }

      blockMessages.push(
        `${targetBot.name} blocked ${atk.name} with ${assignedBlockers.map((b) => b.name).join(' + ')}${
          atk.keywords.trample && remainingAtkPower > 0 ? ` (${remainingAtkPower} trample dmg)` : ''
        }`
      );
    } else {
      if (atk.keywords.lifelink) playerLifeGain += atk.power;
      if (atk.hasInfect) {
        poisonDmgToBot += atk.power;
      } else {
        lifeDmgToBot += atk.power;
        if (atk.toxicValue > 0) poisonDmgToBot += atk.toxicValue;
      }
      if (atk.isCommander && usesCommanderDamage21) {
        cmdrDmgToBot += atk.power;
      }
    }
  }

  return {
    lifeDmgToBot,
    poisonDmgToBot,
    cmdrDmgToBot,
    playerLifeGain,
    botLifeGain,
    deadPlayerAtkUids,
    deadBotBlockerUids,
    blockMessages,
  };
}

/**
 * Accurate MTG combat resolution when a BOT attacks the USER and the user assigns blockers.
 */
export function resolveIncomingAttackCombat(
  attackers: LiveBotCreature[],
  playerBlockers: Array<{
    uid: string;
    name: string;
    power: number;
    toughness: number;
    keywords: CreatureKeywords;
  }>,
  blockerAssignments: Record<string, string>,
  usesCommanderDamage21: boolean
): {
  lifeDmgToPlayer: number;
  poisonDmgToPlayer: number;
  cmdrDmgToPlayer: number;
  playerLifeGain: number;
  botLifeGain: number;
  deadPlayerUids: string[];
  deadBotAttackerUids: string[];
  blockLogParts: string[];
  totalBlockersUsed: number;
} {
  let lifeDmgToPlayer = 0;
  let poisonDmgToPlayer = 0;
  let cmdrDmgToPlayer = 0;
  let playerLifeGain = 0;
  let botLifeGain = 0;
  const deadPlayerUids: string[] = [];
  const deadBotAttackerUids: string[] = [];
  const blockLogParts: string[] = [];
  let totalBlockersUsed = 0;

  for (const atk of attackers) {
    const assignedUids = Object.entries(blockerAssignments)
      .filter(([, targetAtkUid]) => targetAtkUid === atk.uid)
      .map(([blkUid]) => blkUid);

    const legalAssigned = playerBlockers.filter(
      (b) =>
        assignedUids.includes(b.uid) &&
        (!atk.flying || b.keywords.flying || b.keywords.reach)
    );

    const isLegallyBlocked = atk.menace ? legalAssigned.length >= 2 : legalAssigned.length >= 1;

    if (isLegallyBlocked) {
      totalBlockersUsed += legalAssigned.length;
      if (atk.lifelink) botLifeGain += atk.power;

      let remainingAtkPower = atk.power;
      const killedInFirstStrike = new Set<string>();

      for (const blk of legalAssigned) {
        if (remainingAtkPower <= 0) break;
        const needed = atk.deathtouch ? 1 : blk.toughness;
        if (remainingAtkPower >= needed) {
          if (!blk.keywords.indestructible) {
            deadPlayerUids.push(blk.uid);
            if (atk.firstStrike) killedInFirstStrike.add(blk.uid);
          }
          remainingAtkPower -= needed;
        } else {
          remainingAtkPower = 0;
        }
      }

      const hittingBlockers = legalAssigned.filter(
        (b) => !killedInFirstStrike.has(b.uid) || b.keywords.firstStrike
      );
      const totalBlkPower = hittingBlockers.reduce((s, b) => s + b.power, 0);
      const anyBlkDeathtouch = hittingBlockers.some(
        (b) => b.keywords.deathtouch && b.power > 0
      );
      for (const b of hittingBlockers) {
        if (b.keywords.lifelink) playerLifeGain += b.power;
      }

      if (!atk.indestructible && (anyBlkDeathtouch || totalBlkPower >= atk.toughness)) {
        deadBotAttackerUids.push(atk.uid);
      }

      // Trample rolls excess damage over to player
      if (atk.trample && remainingAtkPower > 0) {
        if (atk.hasInfect) {
          poisonDmgToPlayer += remainingAtkPower;
        } else {
          lifeDmgToPlayer += remainingAtkPower;
          if (atk.toxicValue > 0) poisonDmgToPlayer += atk.toxicValue;
        }
        if (atk.isCommander && usesCommanderDamage21) {
          cmdrDmgToPlayer += remainingAtkPower;
        }
      }

      blockLogParts.push(
        `Blocked ${atk.name} (${atk.power}/${atk.toughness}) with ${legalAssigned
          .map((b) => b.name)
          .join(' + ')}${
          atk.trample && remainingAtkPower > 0 ? ` (${remainingAtkPower} trample dmg)` : ''
        }`
      );
    } else {
      if (atk.lifelink) botLifeGain += atk.power;
      if (atk.hasInfect) {
        poisonDmgToPlayer += atk.power;
      } else {
        lifeDmgToPlayer += atk.power;
        if (atk.toxicValue > 0) poisonDmgToPlayer += atk.toxicValue;
      }
      if (atk.isCommander && usesCommanderDamage21) {
        cmdrDmgToPlayer += atk.power;
      }
    }
  }

  return {
    lifeDmgToPlayer,
    poisonDmgToPlayer,
    cmdrDmgToPlayer,
    playerLifeGain,
    botLifeGain,
    deadPlayerUids,
    deadBotAttackerUids,
    blockLogParts,
    totalBlockersUsed,
  };
}
