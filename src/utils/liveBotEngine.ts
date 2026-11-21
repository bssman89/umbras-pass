import type {
  BotIndignanceLevel,
  BotOpponentConfig,
  CardMetadata,
  DeckFormat,
  ResolvedDeckCard,
} from '../types/deck';
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

export interface LiveBotCreature {
  uid: string;
  name: string;
  power: number;
  toughness: number;
  tapped: boolean;
  summoningSick: boolean;
  isCommander: boolean;
  hasInfect: boolean;
  toxicValue: number;
  flying: boolean;
  meta: CardMetadata | null;
}

export interface LiveBotDeckCard {
  name: string;
  cmc: number;
  isLand: boolean;
  isCreature: boolean;
  isBoardWipe: boolean;
  isRemoval: boolean;
  isRamp: boolean;
  power: number;
  toughness: number;
  hasInfect: boolean;
  toxicValue: number;
  flying: boolean;
  burnAmount: number;
  millAmount: number;
  meta: CardMetadata | null;
}

export interface LiveBotState {
  id: string;
  name: string;
  archetype: string;
  indignance: BotIndignanceLevel;
  commanderName: string;
  commanderPower: number;
  commanderToughness: number;
  commanderCmc: number;
  commanderMeta: CardMetadata | null;
  commanderInZone: boolean;
  commanderTax: number;
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
  creatures: LiveBotCreature[];
  bias: ArchetypeCombatBias;
  allowsCommandZone: boolean;
  usesCommanderDamage21: boolean;
  customLibrary: LiveBotDeckCard[];
  customHand: LiveBotDeckCard[];
  lastActionSummary: string;
  lastTargetName: string;
  eliminated: boolean;
  eliminatedReason: 'life' | 'poison' | 'commander' | 'mill' | null;
}

export interface PlayerBoardSnapshot {
  life: number;
  poison: number;
  libraryCount: number;
  creatures: Array<{
    uid: string;
    name: string;
    power: number;
    toughness: number;
    tapped: boolean;
    isCommander: boolean;
    hasInfect: boolean;
    toxicValue: number;
  }>;
  landsCount: number;
  hasCommanderInPlay: boolean;
}

export interface PendingBotAttack {
  botId: string;
  botName: string;
  commanderName: string;
  attackers: LiveBotCreature[];
}

export interface BotTurnResolution {
  updatedBots: LiveBotState[];
  playerLifeDelta: number;
  playerPoisonDelta: number;
  playerMillCount: number;
  removedPlayerCreatureUids: string[];
  boardWipeCast: boolean;
  logs: string[];
  pendingAttackOnPlayer: PendingBotAttack | null;
}

interface ArchetypeCardTemplate {
  name: string;
  cmc: number;
  power: number;
  toughness: number;
  hasInfect?: boolean;
  toxicValue?: number;
  flying?: boolean;
}

const ARCHETYPE_CREATURES: Array<{
  pattern: RegExp;
  creatures: ArchetypeCardTemplate[];
}> = [
  {
    pattern: /mono-red|aggro|burn/i,
    creatures: [
      { name: 'Monastery Swiftspear', cmc: 1, power: 2, toughness: 2 },
      { name: 'Goblin Guide', cmc: 1, power: 2, toughness: 2 },
      { name: 'Eidolon of the Great Revel', cmc: 2, power: 2, toughness: 2 },
      { name: 'Guttersnipe', cmc: 3, power: 2, toughness: 2 },
      { name: 'Rampaging Ferocidon', cmc: 3, power: 3, toughness: 3 },
      { name: 'Hellrider', cmc: 4, power: 3, toughness: 3 },
    ],
  },
  {
    pattern: /azorius|control|countermagic/i,
    creatures: [
      { name: 'Thraben Inspector', cmc: 1, power: 1, toughness: 2 },
      { name: 'Spell Queller', cmc: 3, power: 2, toughness: 3, flying: true },
      { name: 'Aven Mindcensor', cmc: 3, power: 2, toughness: 1, flying: true },
      { name: 'Consecrated Sphinx', cmc: 6, power: 4, toughness: 6, flying: true },
      { name: 'Dream Trawler', cmc: 6, power: 3, toughness: 5, flying: true },
    ],
  },
  {
    pattern: /toxic|infect|poison/i,
    creatures: [
      { name: 'Glistener Elf', cmc: 1, power: 1, toughness: 1, hasInfect: true },
      { name: 'Venerated Rotpriest', cmc: 1, power: 1, toughness: 2, toxicValue: 1 },
      { name: 'Blighted Agent', cmc: 2, power: 1, toughness: 1, hasInfect: true },
      { name: 'Bloated Contaminator', cmc: 3, power: 4, toughness: 4, toxicValue: 1 },
      { name: 'Skithiryx, the Blight Dragon', cmc: 5, power: 4, toughness: 4, hasInfect: true, flying: true },
    ],
  },
  {
    pattern: /mill|library/i,
    creatures: [
      { name: 'Hedron Crab', cmc: 1, power: 0, toughness: 2 },
      { name: 'Ruin Crab', cmc: 1, power: 0, toughness: 3 },
      { name: 'Thieves\' Guild Enforcer', cmc: 1, power: 1, toughness: 1 },
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
      { name: 'Sheoldred, Whispering One', cmc: 7, power: 6, toughness: 6 },
    ],
  },
  {
    pattern: /orzhov|aristocrats|drain/i,
    creatures: [
      { name: 'Blood Artist', cmc: 2, power: 0, toughness: 1 },
      { name: 'Cruel Celebrant', cmc: 2, power: 1, toughness: 2 },
      { name: 'Woe Strider', cmc: 3, power: 3, toughness: 2 },
      { name: 'Elenda, the Dusk Rose', cmc: 4, power: 3, toughness: 3 },
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
      { name: 'Questing Beast', cmc: 4, power: 4, toughness: 4 },
      { name: 'Terror of the Peaks', cmc: 5, power: 5, toughness: 4, flying: true },
      { name: 'Ghalta, Primal Hunger', cmc: 6, power: 12, toughness: 12 },
    ],
  },
  {
    pattern: /boros|voltron/i,
    creatures: [
      { name: 'Puresteel Paladin', cmc: 2, power: 2, toughness: 2 },
      { name: 'Stoneforge Mystic', cmc: 2, power: 1, toughness: 2 },
      { name: 'Aurelia, the Warleader', cmc: 6, power: 3, toughness: 4, flying: true },
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

export function getCreatureRosterForArchetype(archetype: string): ArchetypeCardTemplate[] {
  const found = ARCHETYPE_CREATURES.find((entry) => entry.pattern.test(archetype));
  if (found) return found.creatures;
  return [
    { name: 'Vanguard Knight', cmc: 2, power: 2, toughness: 2 },
    { name: 'Arcane Sentinel', cmc: 3, power: 3, toughness: 3 },
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

export function createInitialLiveBots(
  opponents: BotOpponentConfig[],
  startingLife: number,
  format: Exclude<DeckFormat, 'auto'>,
  findMeta: (name: string) => CardMetadata | null
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
      const isLand =
        Boolean(meta?.isLand) ||
        /\b(plains|island|swamp|mountain|forest|wastes|command tower|exotic orchard)\b/i.test(item.name);
      const isCreature = /\bcreature\b/i.test(meta?.typeLine || '');
      const cardObj: LiveBotDeckCard = {
        name: item.name,
        cmc: meta?.cmc ?? (isLand ? 0 : 3),
        isLand,
        isCreature,
        isBoardWipe: mech.isBoardWipe,
        isRemoval: mech.isCounterOrRemoval,
        isRamp: Boolean(meta?.isRamp),
        power: isCreature ? parsePt(meta?.power, Math.max(2, mech.estimatedPower || 2)) : 0,
        toughness: isCreature ? parsePt(meta?.toughness, 2) : 0,
        hasInfect: mech.hasInfect,
        toxicValue: mech.toxicValue,
        flying: /\bflying\b/i.test(meta?.oracleText || ''),
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

    return {
      id: opp.id || `bot-${idx + 1}`,
      name: opp.name,
      archetype: opp.customDeckText?.trim() ? 'Custom Decklist' : opp.archetype,
      indignance: opp.indignance || 'measured',
      commanderName: cmdName,
      commanderPower: cmdName ? parsePt(cmdMeta?.power, Math.max(3, cmdMech?.estimatedPower || 4)) : 0,
      commanderToughness: cmdName ? parsePt(cmdMeta?.toughness, 4) : 0,
      commanderCmc: cmdName ? (cmdMeta?.cmc ?? (bias.usesVoltronCommander ? 3 : 4)) : 0,
      commanderMeta: cmdMeta,
      commanderInZone: formatRules.allowsCommandZone,
      commanderTax: 0,
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
      creatures: [],
      bias,
      allowsCommandZone: formatRules.allowsCommandZone,
      usesCommanderDamage21: formatRules.usesCommanderDamage21,
      customLibrary: shuffledCustom,
      customHand,
      lastActionSummary: 'Opening 7 kept. Ready for Turn 1.',
      lastTargetName: '—',
      eliminated: false,
      eliminatedReason: null,
    };
  });
}

function chooseBotTarget(
  bot: LiveBotState,
  allBots: LiveBotState[],
  player: PlayerBoardSnapshot
): { kind: 'player' } | { kind: 'bot'; targetBotId: string; targetBotName: string } {
  const rivals = allBots.filter((b) => b.id !== bot.id && !b.eliminated);
  const playerAlive = player.life > 0 && player.poison < 10;
  if (!playerAlive && rivals.length > 0) {
    // Player already knocked out — surviving bots battle each other for sole survivor
    const sortedRivals = [...rivals].sort((a, b) => a.life - b.life);
    const chosen = sortedRivals[0];
    return { kind: 'bot', targetBotId: chosen.id, targetBotName: chosen.name };
  }
  if (rivals.length === 0) return { kind: 'player' };

  const botReadyPower = bot.creatures
    .filter((c) => !c.tapped && !c.summoningSick && c.power > 0)
    .reduce((s, c) => s + c.power, 0);

  const playerUntappedPower = player.creatures
    .filter((c) => !c.tapped)
    .reduce((s, c) => s + c.power, 0);
  const playerCanBeLethaled =
    botReadyPower > 0 &&
    (botReadyPower - playerUntappedPower >= player.life ||
      (bot.bias.usesInfect && botReadyPower - playerUntappedPower >= Math.max(1, 10 - player.poison)) ||
      (bot.usesCommanderDamage21 &&
        bot.creatures.some(
          (c) =>
            c.isCommander &&
            !c.tapped &&
            !c.summoningSick &&
            c.power + bot.commanderDamageDealtToYou >= 21
        )));

  const playerThreatScore =
    player.creatures.reduce((s, c) => s + c.power, 0) * 1.4 +
    (player.hasCommanderInPlay ? 6 : 0) +
    player.landsCount * 0.8 +
    player.life * 0.12 +
    (playerCanBeLethaled ? 150 : 0);

  const indignancePlayerBias =
    bot.indignance === 'vindictive'
      ? 2.1
      : bot.indignance === 'ruthless'
      ? 1.45
      : bot.indignance === 'measured'
      ? 1.15
      : 0.78;

  const candidates: Array<{
    score: number;
    ref: { kind: 'player' } | { kind: 'bot'; targetBotId: string; targetBotName: string };
  }> = [
    {
      score: playerThreatScore * indignancePlayerBias + Math.random() * 2,
      ref: { kind: 'player' },
    },
  ];

  for (const r of rivals) {
    const rivalBlockPower = r.creatures
      .filter((c) => !c.tapped)
      .reduce((s, c) => s + c.power, 0);
    const rivalCanBeLethaled =
      botReadyPower > 0 &&
      (botReadyPower - rivalBlockPower >= r.life ||
        (bot.bias.usesInfect && botReadyPower - rivalBlockPower >= Math.max(1, 10 - r.poison)));
    const rivalThreat =
      r.creatures.reduce((s, c) => s + c.power, 0) * 1.35 +
      r.landsInPlay * 0.75 +
      r.life * 0.12 +
      (rivalCanBeLethaled ? 150 : 0);
    candidates.push({
      score: rivalThreat + Math.random() * 3,
      ref: { kind: 'bot', targetBotId: r.id, targetBotName: r.name },
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].ref;
}

export function executeBotTurn(
  botIndex: number,
  bots: LiveBotState[],
  player: PlayerBoardSnapshot,
  turnNumber: number,
  findMeta: (name: string) => CardMetadata | null
): BotTurnResolution {
  const nextBots = bots.map((b) => ({
    ...b,
    creatures: b.creatures.map((c) => ({ ...c })),
    customHand: [...b.customHand],
    customLibrary: [...b.customLibrary],
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
      pendingAttackOnPlayer: null,
    };
  }

  const logs: string[] = [];
  let playerLifeDelta = 0;
  let playerPoisonDelta = 0;
  let playerMillCount = 0;
  const removedPlayerCreatureUids: string[] = [];
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
    logs.push(`${bot.name} decked out on draw step and was eliminated.`);
    return {
      updatedBots: nextBots,
      playerLifeDelta,
      playerPoisonDelta,
      playerMillCount,
      removedPlayerCreatureUids,
      boardWipeCast,
      logs,
      pendingAttackOnPlayer: null,
    };
  }

  bot.libraryCount -= 1;
  if (bot.customLibrary.length > 0) {
    const drawn = bot.customLibrary.shift();
    if (drawn) bot.customHand.push(drawn);
  }
  bot.handCount += 1;

  // 3. Land drop
  const playedSummaries: string[] = [];
  if (bot.customHand.length > 0) {
    const landIdx = bot.customHand.findIndex((c) => c.isLand);
    if (landIdx >= 0) {
      const [land] = bot.customHand.splice(landIdx, 1);
      bot.landsInPlay += 1;
      bot.handCount = Math.max(0, bot.handCount - 1);
      playedSummaries.push(land.name);
    }
  } else if (bot.handCount > 0 && (bot.landsInPlay < 4 || Math.random() < 0.72)) {
    bot.landsInPlay += 1;
    bot.handCount = Math.max(0, bot.handCount - 1);
    playedSummaries.push('Land');
  }

  let availableMana = bot.landsInPlay + bot.manaBonusFromRamp;
  const target = chooseBotTarget(bot, nextBots, player);
  const targetLabel = target.kind === 'player' ? 'You' : target.targetBotName;
  bot.lastTargetName = targetLabel;

  // 4. Main Phase Casting (Custom Decklist or Archetype AI)
  const indignanceAggroFactor =
    bot.indignance === 'vindictive'
      ? 1.25
      : bot.indignance === 'ruthless'
      ? 1.15
      : bot.indignance === 'measured'
      ? 1.0
      : 0.8;

  if (bot.customHand.length > 0) {
    // Sort castable spells by impact & curve
    const nonLands = bot.customHand
      .filter((c) => !c.isLand && c.cmc <= availableMana)
      .sort((a, b) => b.cmc - a.cmc);

    for (const card of nonLands) {
      if (card.cmc > availableMana) continue;
      if (
        card.isBoardWipe &&
        player.creatures.length < 3 &&
        bot.creatures.length >= player.creatures.length
      ) {
        continue;
      }

      const idxInHand = bot.customHand.indexOf(card);
      if (idxInHand >= 0) {
        bot.customHand.splice(idxInHand, 1);
        bot.handCount = Math.max(0, bot.handCount - 1);
        availableMana -= card.cmc;
        bot.tappedLands = Math.min(bot.landsInPlay, bot.tappedLands + card.cmc);
        playedSummaries.push(card.name);

        if (card.isRamp) {
          bot.manaBonusFromRamp += 1;
          bot.graveyardCount += 1;
        } else if (card.isBoardWipe) {
          boardWipeCast = true;
          bot.graveyardCount += 1 + bot.creatures.length;
          bot.creatures = [];
          for (const other of nextBots) {
            if (other.id !== bot.id && !other.eliminated) {
              other.graveyardCount += other.creatures.length;
              other.creatures = [];
            }
          }
          for (const pc of player.creatures) {
            removedPlayerCreatureUids.push(pc.uid);
          }
          logs.push(`${bot.name} cast ${card.name} — board wipe cleared all creatures!`);
        } else if (card.isRemoval) {
          if (target.kind === 'player' && player.creatures.length > 0) {
            const victim = [...player.creatures]
              .filter((pc) => !removedPlayerCreatureUids.includes(pc.uid))
              .sort((a, b) => b.power - a.power)[0];
            if (victim) {
              removedPlayerCreatureUids.push(victim.uid);
              logs.push(`${bot.name} cast ${card.name} destroying your ${victim.name}.`);
            }
          } else if (target.kind === 'bot') {
            const rival = nextBots.find((b) => b.id === target.targetBotId && !b.eliminated);
            const victim = rival
              ? [...rival.creatures].sort((a, b) => b.power - a.power)[0]
              : undefined;
            if (rival && victim) {
              rival.creatures = rival.creatures.filter((c) => c.uid !== victim.uid);
              if (victim.isCommander && rival.allowsCommandZone) {
                rival.commanderInZone = true;
                rival.commanderTax += 2;
              } else {
                rival.graveyardCount += 1;
              }
              logs.push(`${bot.name} cast ${card.name} destroying ${rival.name}'s ${victim.name}.`);
            }
          }
          bot.graveyardCount += 1;
        } else if (card.isCreature) {
          bot.creatures.push({
            uid: `bot-c-${bot.id}-${turnNumber}-${Math.random().toString(36).slice(2, 6)}`,
            name: card.name,
            power: Math.max(1, card.power),
            toughness: Math.max(1, card.toughness),
            tapped: false,
            summoningSick: true,
            isCommander: false,
            hasInfect: card.hasInfect,
            toxicValue: card.toxicValue,
            flying: card.flying,
            meta: card.meta,
          });
        } else {
          bot.graveyardCount += 1;
          if (card.burnAmount > 0) {
            if (target.kind === 'player') {
              playerLifeDelta -= card.burnAmount;
            } else {
              const tb = nextBots.find((b) => b.id === target.targetBotId);
              if (tb) tb.life = Math.max(0, tb.life - card.burnAmount);
            }
          }
          if (card.millAmount > 0) {
            if (target.kind === 'player') {
              playerMillCount += card.millAmount;
            } else {
              const tb = nextBots.find((b) => b.id === target.targetBotId);
              if (tb) {
                const actual = Math.min(tb.libraryCount, card.millAmount);
                tb.libraryCount -= actual;
                tb.graveyardCount += actual;
              }
            }
          }
        }
      }
    }
  } else {
    // Archetype AI play sequence
    const roster = getCreatureRosterForArchetype(bot.archetype);

    // Cast Commander if Command Zone is active in this format
    const cmdTotalCost = bot.commanderCmc + bot.commanderTax;
    if (bot.allowsCommandZone && bot.commanderInZone && availableMana >= cmdTotalCost) {
      availableMana -= cmdTotalCost;
      bot.tappedLands = Math.min(bot.landsInPlay, bot.tappedLands + cmdTotalCost);
      bot.commanderInZone = false;
      bot.creatures.push({
        uid: `bot-cmd-${bot.id}-${turnNumber}`,
        name: bot.commanderName,
        power: bot.commanderPower,
        toughness: bot.commanderToughness,
        tapped: false,
        summoningSick: !bot.bias.usesVoltronCommander,
        isCommander: true,
        hasInfect: bot.bias.usesInfect,
        toxicValue: bot.bias.usesToxic ? 1 : 0,
        flying: /\bflying\b/i.test(bot.commanderMeta?.oracleText || ''),
        meta: bot.commanderMeta,
      });
      playedSummaries.push(`Commander ${bot.commanderName}`);
    }

    // Cast format-appropriate ramp early
    if (turnNumber <= 3 && availableMana >= 2 && bot.manaBonusFromRamp < 2 && Math.random() < 0.5) {
      availableMana -= 2;
      bot.tappedLands = Math.min(bot.landsInPlay, bot.tappedLands + 2);
      bot.manaBonusFromRamp += 1;
      bot.handCount = Math.max(0, bot.handCount - 1);
      playedSummaries.push(bot.allowsCommandZone ? 'Arcane Signet' : 'Rampant Growth');
    }

    // Cast control removal or board wipe if pressured
    const activePlayerCreatures = player.creatures.filter(
      (pc) => !removedPlayerCreatureUids.includes(pc.uid)
    );
    const maxOpponentCreatures = Math.max(
      activePlayerCreatures.length,
      ...nextBots
        .filter((b) => b.id !== bot.id && !b.eliminated)
        .map((b) => b.creatures.length)
    );
    const shouldWipe =
      (bot.bias.usesControl || bot.indignance === 'vindictive') &&
      availableMana >= 4 &&
      maxOpponentCreatures >= 3 &&
      bot.creatures.length <= 1 &&
      Math.random() < 0.55;

    const wipeCardName = bot.allowsCommandZone ? 'Supreme Verdict' : 'Wrath of God';

    if (shouldWipe) {
      availableMana -= 4;
      bot.tappedLands = Math.min(bot.landsInPlay, bot.tappedLands + 4);
      bot.handCount = Math.max(0, bot.handCount - 1);
      bot.graveyardCount += 1 + bot.creatures.length;
      bot.creatures = [];
      for (const other of nextBots) {
        if (other.id !== bot.id && !other.eliminated) {
          other.graveyardCount += other.creatures.length;
          other.creatures = [];
        }
      }
      for (const pc of activePlayerCreatures) {
        removedPlayerCreatureUids.push(pc.uid);
      }
      boardWipeCast = true;
      playedSummaries.push(wipeCardName);
      logs.push(`${bot.name} cast ${wipeCardName} — wiped all creatures on the table!`);
    } else if (
      (bot.bias.usesControl || bot.indignance === 'ruthless' || bot.indignance === 'vindictive') &&
      availableMana >= 2 &&
      Math.random() < 0.45 * indignanceAggroFactor
    ) {
      if (target.kind === 'player' && activePlayerCreatures.length > 0) {
        const biggest = [...activePlayerCreatures].sort((a, b) => b.power - a.power)[0];
        if (biggest) {
          availableMana -= 2;
          bot.tappedLands = Math.min(bot.landsInPlay, bot.tappedLands + 2);
          bot.handCount = Math.max(0, bot.handCount - 1);
          bot.graveyardCount += 1;
          removedPlayerCreatureUids.push(biggest.uid);
          playedSummaries.push(`Removal on ${biggest.name}`);
          logs.push(`${bot.name} cast targeted removal on your ${biggest.name}.`);
        }
      } else if (target.kind === 'bot') {
        const rival = nextBots.find((b) => b.id === target.targetBotId && !b.eliminated);
        const biggest = rival
          ? [...rival.creatures].sort((a, b) => b.power - a.power)[0]
          : undefined;
        if (rival && biggest) {
          availableMana -= 2;
          bot.tappedLands = Math.min(bot.landsInPlay, bot.tappedLands + 2);
          bot.handCount = Math.max(0, bot.handCount - 1);
          bot.graveyardCount += 1;
          rival.creatures = rival.creatures.filter((c) => c.uid !== biggest.uid);
          if (biggest.isCommander && rival.allowsCommandZone) {
            rival.commanderInZone = true;
            rival.commanderTax += 2;
          } else {
            rival.graveyardCount += 1;
          }
          playedSummaries.push(`Removal on ${rival.name}'s ${biggest.name}`);
          logs.push(`${bot.name} cast targeted removal destroying ${rival.name}'s ${biggest.name}.`);
        }
      }
    }

    // Deploy up to 2-3 affordable creatures on curve
    for (let deployPass = 0; deployPass < 3; deployPass++) {
      if (bot.handCount <= 0 || bot.creatures.length >= 6) break;
      const affordable = roster
        .filter((c) => c.cmc <= availableMana)
        .sort((a, b) => b.cmc - a.cmc);
      if (affordable.length === 0) break;
      const pick = affordable[deployPass === 0 ? Math.floor(Math.random() * Math.min(2, affordable.length)) : 0];
      availableMana -= pick.cmc;
      bot.tappedLands = Math.min(bot.landsInPlay, bot.tappedLands + pick.cmc);
      bot.handCount = Math.max(0, bot.handCount - 1);
      const cMeta = findMeta(pick.name);
      bot.creatures.push({
        uid: `bot-c-${bot.id}-${turnNumber}-${deployPass}-${Math.random().toString(36).slice(2, 6)}`,
        name: pick.name,
        power: pick.power,
        toughness: pick.toughness,
        tapped: false,
        summoningSick: true,
        isCommander: false,
        hasInfect: Boolean(pick.hasInfect),
        toxicValue: pick.toxicValue || 0,
        flying: Boolean(pick.flying),
        meta: cMeta,
      });
      playedSummaries.push(pick.name);
    }

    // Archetype spell reach (burn/drain/mill/proliferate)
    if (availableMana >= 2 && bot.handCount > 0) {
      if (bot.bias.usesBurnDrain) {
        const burnDmg = Math.min(5, Math.max(2, Math.round(2.5 * indignanceAggroFactor)));
        availableMana -= 2;
        bot.handCount = Math.max(0, bot.handCount - 1);
        bot.graveyardCount += 1;
        if (target.kind === 'player') {
          playerLifeDelta -= burnDmg;
        } else {
          const tb = nextBots.find((b) => b.id === target.targetBotId);
          if (tb) tb.life = Math.max(0, tb.life - burnDmg);
        }
        playedSummaries.push(`Burn/Drain (${burnDmg} dmg to ${targetLabel})`);
      } else if (bot.bias.usesMill) {
        const millAmt = Math.min(10, 4 + turnNumber);
        availableMana -= 2;
        bot.handCount = Math.max(0, bot.handCount - 1);
        bot.graveyardCount += 1;
        if (target.kind === 'player') {
          playerMillCount += millAmt;
        } else {
          const tb = nextBots.find((b) => b.id === target.targetBotId);
          if (tb) {
            const actual = Math.min(tb.libraryCount, millAmt);
            tb.libraryCount -= actual;
            tb.graveyardCount += actual;
          }
        }
        playedSummaries.push(`Mill ${millAmt} (${targetLabel})`);
      } else if (bot.bias.usesProliferate && target.kind === 'player' && player.poison > 0) {
        availableMana -= 2;
        bot.handCount = Math.max(0, bot.handCount - 1);
        bot.graveyardCount += 1;
        playerPoisonDelta += 1;
        playedSummaries.push('Proliferate (+1 Poison)');
      } else if (bot.bias.usesProliferate && target.kind === 'bot') {
        const tb = nextBots.find((b) => b.id === target.targetBotId);
        if (tb && tb.poison > 0) {
          availableMana -= 2;
          bot.handCount = Math.max(0, bot.handCount - 1);
          bot.graveyardCount += 1;
          tb.poison = Math.min(20, tb.poison + 1);
          playedSummaries.push(`Proliferate (+1 Poison to ${targetLabel})`);
        }
      }
    }
  }

  // 5. Combat Phase
  const eligibleAttackers = bot.creatures.filter(
    (c) => !c.tapped && !c.summoningSick && c.power > 0
  );

  // Bot decides whether to hold 1 blocker or swing
  const shouldHoldBlocker =
    bot.indignance === 'forgiving' &&
    eligibleAttackers.length > 1 &&
    player.creatures.length >= 2;
  const attackers = shouldHoldBlocker
    ? eligibleAttackers.slice(0, eligibleAttackers.length - 1)
    : eligibleAttackers;

  let pendingAttackOnPlayer: PendingBotAttack | null = null;

  if (attackers.length > 0) {
    // Tap attackers
    const atkIds = new Set(attackers.map((a) => a.uid));
    bot.creatures = bot.creatures.map((c) =>
      atkIds.has(c.uid) ? { ...c, tapped: true } : c
    );

    if (target.kind === 'bot') {
      const rival = nextBots.find((b) => b.id === target.targetBotId);
      if (rival && !rival.eliminated) {
        const availableRivalBlockers = rival.creatures.filter((c) => !c.tapped && c.toughness > 0);
        let totalDmg = 0;
        let totalPoison = 0;
        for (const atk of attackers) {
          const blockerIdx = availableRivalBlockers.findIndex((b) => !atk.flying || b.flying);
          const blocker = blockerIdx >= 0 ? availableRivalBlockers.splice(blockerIdx, 1)[0] : undefined;
          if (blocker) {
            if (atk.power >= blocker.toughness) {
              rival.creatures = rival.creatures.filter((c) => c.uid !== blocker.uid);
              if (blocker.isCommander && rival.allowsCommandZone) {
                rival.commanderInZone = true;
                rival.commanderTax += 2;
              } else {
                rival.graveyardCount += 1;
              }
            }
            if (blocker.power >= atk.toughness) {
              bot.creatures = bot.creatures.filter((c) => c.uid !== atk.uid);
              if (atk.isCommander && bot.allowsCommandZone) {
                bot.commanderInZone = true;
                bot.commanderTax += 2;
              } else {
                bot.graveyardCount += 1;
              }
            }
          } else {
            if (atk.hasInfect) {
              totalPoison += atk.power;
            } else {
              totalDmg += atk.power;
              if (atk.toxicValue > 0) totalPoison += atk.toxicValue;
            }
          }
        }
        rival.life = Math.max(0, rival.life - totalDmg);
        rival.poison = Math.min(20, rival.poison + totalPoison);
        if (rival.poison >= 10) {
          rival.eliminated = true;
          rival.eliminatedReason = 'poison';
          rival.creatures = [];
        } else if (rival.life <= 0) {
          rival.eliminated = true;
          rival.eliminatedReason = 'life';
          rival.creatures = [];
        }
        playedSummaries.push(
          `Attacked ${rival.name} (${totalDmg} dmg${totalPoison > 0 ? `, +${totalPoison} poison` : ''})`
        );
        logs.push(
          `${bot.name} attacked ${rival.name} with ${attackers.map((a) => a.name).join(', ')} for ${totalDmg} damage${totalPoison > 0 ? ` and ${totalPoison} poison` : ''}.`
        );
      }
    } else {
      // Attacking YOU!
      const playerUntappedBlockers = player.creatures.filter(
        (pc) => !pc.tapped && !removedPlayerCreatureUids.includes(pc.uid)
      );

      if (playerUntappedBlockers.length > 0) {
        pendingAttackOnPlayer = {
          botId: bot.id,
          botName: bot.name,
          commanderName: bot.commanderName,
          attackers,
        };
        playedSummaries.push(
          `Attacking You (${attackers.map((a) => `${a.name} ${a.power}/${a.toughness}`).join(', ')})`
        );
        logs.push(
          `${bot.name} is attacking YOU with ${attackers.map((a) => `${a.name} (${a.power}/${a.toughness})`).join(', ')} — choose blockers or take damage!`
        );
      } else {
        // No untapped blockers -> deal direct damage immediately
        let dmg = 0;
        let poison = 0;
        let cmdrDmg = 0;
        for (const atk of attackers) {
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
        playerLifeDelta -= dmg;
        playerPoisonDelta += poison;
        bot.commanderDamageDealtToYou += cmdrDmg;
        playedSummaries.push(
          `Attacked You (${dmg} dmg${poison > 0 ? `, +${poison} poison` : ''}${cmdrDmg > 0 ? `, +${cmdrDmg} cmdr` : ''})`
        );
        logs.push(
          `${bot.name} attacked You unblocked with ${attackers.map((a) => a.name).join(', ')} for ${dmg} dmg${poison > 0 ? `, ${poison} poison` : ''}${cmdrDmg > 0 ? `, ${cmdrDmg} cmdr dmg` : ''}.`
        );
      }
    }
  }

  // Update eliminated flags for rival bots hit by spells
  for (const other of nextBots) {
    if (!other.eliminated) {
      if (other.poison >= 10) {
        other.eliminated = true;
        other.eliminatedReason = 'poison';
        other.creatures = [];
      } else if (other.usesCommanderDamage21 && other.commanderDamageTakenFromYou >= 21) {
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
  if (!logs.length) {
    logs.push(`${bot.name}: ${bot.lastActionSummary}`);
  }

  return {
    updatedBots: nextBots,
    playerLifeDelta,
    playerPoisonDelta,
    playerMillCount,
    removedPlayerCreatureUids,
    boardWipeCast,
    logs,
    pendingAttackOnPlayer,
  };
}
