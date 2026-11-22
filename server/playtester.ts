import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  BotIndignanceLevel,
  BotLearningProfile,
  BotMatchLearningInsight,
  BotOpponentConfig,
  CardMetadata,
  DeckFormat,
  PlaytestMode,
  PlaytestResult,
  ResolvedDeckCard,
} from '../src/types/deck.ts';
import { getBotIndignanceMeta } from '../src/utils/botIndignance.ts';
import {
  buildBotPastPlayBriefing,
  resolveBotLearningKey,
} from '../src/utils/botLearning.ts';
import {
  canPayManaCost,
  detectArchetypeCombatBias,
  detectCardMechanics,
  extractDeckSynergyBlueprint,
  findMetaFromMap,
  getFormatSimulationRules,
  getProducedColorsFromCard,
  normalizeCardLookupKey,
  performLondonMulligan,
  reconcilePlaytestMatchStats,
  type FormatSimulationRules,
} from '../src/utils/playtestReconciler.ts';
import {
  continueSimulationToSoleWinner,
  simulatePlaytestClientSideFallback,
  type BotMatchTacticalDirective,
} from '../src/utils/clientFallbackAnalyzer.ts';
import {
  generateJsonWithLocalGguf,
  getActiveLocalModelInfo,
  getActiveLocalModelLabel,
  isAutoLearnFromMatchesEnabled,
  shouldUseCloudGemini,
  shouldUseDeterministicOnly,
  shouldUseLocalGguf,
} from './localAi.ts';
import { parseUniversalDecklist } from './deckParser.ts';
import {
  loadBotTrainingData,
  recordBotTrainingMatchOutcomes,
  type BotMoveOutcomeRecord,
} from './desktopStorage.ts';
import {
  autoRecognizeCommanders,
  resolveCardNamesWithScryfall,
} from './scryfall.ts';
import { withGeminiRetry } from './geminiRetry.ts';

const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in environment variables.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

interface SimulatedCardSlot {
  name: string;
  cmc: number;
  manaCost: string;
  isLand: boolean;
  isRamp: boolean;
  entersTapped: boolean;
  typeLine: string;
  oracleText: string;
  producedMana: Array<'W' | 'U' | 'B' | 'R' | 'G' | 'C'>;
}

interface PrecomputedTurnSeed {
  roundNumber: number;
  cardDrawn: string;
  landPlayed: string | null;
  landsInPlay: number;
  manaAvailable: number;
  colorSourcesSummary: string;
  suggestedCasts: string[];
  handSnapshot: string[];
  strandedHighCostCards: string[];
}

function simulateRealDraws(
  cards: ResolvedDeckCard[],
  totalRounds: number,
  formatRules: FormatSimulationRules,
  isBotSeat = false
): {
  openingHand: string[];
  mulliganVerdict: string;
  turnSeeds: PrecomputedTurnSeed[];
  commanderNames: string[];
  mainDeckCount: number;
} {
  const commanders = formatRules.allowsCommandZone
    ? cards.filter((c) => c.zone === 'commander').map((c) => c.name)
    : [];
  const library: SimulatedCardSlot[] = [];

  for (const item of cards) {
    const countsAsMain =
      item.zone === 'main' || (!formatRules.allowsCommandZone && item.zone === 'commander');
    if (!countsAsMain) continue;
    const isLand = Boolean(item.card?.isLand);
    const isRamp = Boolean(item.card?.isRamp);
    const producedMana = getProducedColorsFromCard(item.name, item.card);
    for (let i = 0; i < item.quantity; i++) {
      library.push({
        name: item.name,
        cmc: item.card?.cmc ?? (isLand ? 0 : 2),
        manaCost: item.card?.manaCost ?? '',
        isLand,
        isRamp,
        entersTapped: Boolean(item.card?.entersTappedLikely),
        typeLine: item.card?.typeLine ?? '',
        oracleText: item.card?.oracleText ?? '',
        producedMana,
      });
    }
  }

  const mainDeckCount = library.length;
  const mulliganRes = performLondonMulligan({
    library,
    isMultiplayerCommander: formatRules.isMultiplayer,
    freeFirstMulligan: formatRules.freeFirstMulligan,
    maxMulligans: 2,
  });

  const hand = [...mulliganRes.keptHand];
  const shuffled = [...mulliganRes.remainingLibrary];
  const openingHand = hand.map((c) => c.name);

  const turnSeeds: PrecomputedTurnSeed[] = [];
  let landsInPlay = 0;
  let rampBonusMana = 0;
  const colorSources: Record<'W' | 'U' | 'B' | 'R' | 'G', number> = {
    W: 0,
    U: 0,
    B: 0,
    R: 0,
    G: 0,
  };

  for (let round = 1; round <= totalRounds; round++) {
    let cardDrawnName = '(Empty library)';
    const skipTurn1Draw = !isBotSeat && round === 1 && formatRules.playerSkipsTurn1Draw;
    if (!skipTurn1Draw) {
      const drawn = shuffled.shift();
      if (drawn) {
        hand.push(drawn);
        cardDrawnName = drawn.name;
      }
    } else {
      cardDrawnName = '(Opening hand on the play — skip Turn 1 draw)';
    }

    // Prefer untapped land unless we have no castable plays this turn and want to clear a tapped land early
    const untappedLandIdx = hand.findIndex((c) => c.isLand && !c.entersTapped);
    const tappedLandIdx = hand.findIndex((c) => c.isLand && c.entersTapped);
    const hasEarlyOneDrop = hand.some((c) => !c.isLand && c.cmc <= landsInPlay + rampBonusMana + 1);
    const fallbackLandIndex =
      round === 1 && !hasEarlyOneDrop && tappedLandIdx !== -1
        ? tappedLandIdx
        : untappedLandIdx !== -1
        ? untappedLandIdx
        : tappedLandIdx;

    let landPlayed: string | null = null;
    let tappedPenalty = 0;

    if (fallbackLandIndex !== -1) {
      const [land] = hand.splice(fallbackLandIndex, 1);
      landPlayed = land.name;
      landsInPlay += 1;
      if (land.entersTapped) {
        tappedPenalty = 1;
      } else {
        for (const col of land.producedMana) {
          if (col !== 'C') colorSources[col] += 1;
        }
      }
      if (land.entersTapped) {
        // Still contributes colors on future turns; add colors after computing this turn's untapped penalty
        for (const col of land.producedMana) {
          if (col !== 'C') colorSources[col] += 1;
        }
      }
    }

    const manaAvailable = Math.max(0, landsInPlay + rampBonusMana - tappedPenalty);
    let remainingMana = manaAvailable;
    const suggestedCasts: string[] = [];

    // Multi-spell sequence simulation: prefer cheap ramp first on T1-T3, then highest-impact castable spells
    for (let pass = 0; pass < 2; pass++) {
      const castableIdx = hand
        .map((c, idx) => ({ c, idx }))
        .filter(
          ({ c }) =>
            !c.isLand &&
            canPayManaCost(remainingMana, colorSources, c.cmc, c.manaCost)
        )
        .sort((a, b) => {
          if (round <= 3 && a.c.isRamp !== b.c.isRamp) return a.c.isRamp ? -1 : 1;
          return b.c.cmc - a.c.cmc;
        })[0]?.idx;

      if (castableIdx === undefined) break;
      const [casted] = hand.splice(castableIdx, 1);
      remainingMana = Math.max(0, remainingMana - casted.cmc);
      suggestedCasts.push(casted.name);
      if (casted.isRamp) {
        rampBonusMana += 1;
        for (const col of casted.producedMana) {
          if (col !== 'C') colorSources[col] += 1;
        }
      }
    }

    const handSnapshot = hand.map((c) => c.name);
    const strandedHighCostCards = hand
      .filter(
        (c) =>
          !c.isLand &&
          !canPayManaCost(manaAvailable, colorSources, c.cmc, c.manaCost)
      )
      .map((c) => `${c.name} (${c.manaCost || `MV ${c.cmc}`})`);

    const colorSourcesSummary = (['W', 'U', 'B', 'R', 'G'] as const)
      .filter((col) => colorSources[col] > 0)
      .map((col) => `${colorSources[col]}${col}`)
      .join(' ') || 'Colorless';

    turnSeeds.push({
      roundNumber: round,
      cardDrawn: cardDrawnName,
      landPlayed,
      landsInPlay,
      manaAvailable,
      colorSourcesSummary,
      suggestedCasts,
      handSnapshot,
      strandedHighCostCards,
    });
  }

  return {
    openingHand,
    mulliganVerdict: mulliganRes.mulliganVerdict,
    turnSeeds,
    commanderNames: commanders,
    mainDeckCount,
  };
}

const ROUND_CHANGE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    action: { type: Type.STRING, description: 'One of: cut, add, swap' },
    cutCardName: { type: Type.STRING, description: 'Card to remove (if action is cut or swap).' },
    addCardName: { type: Type.STRING, description: 'Real MTG card to put in (if action is add or swap).' },
    reason: { type: Type.STRING, description: 'Clear plain-English reason tied to what happened in this round.' },
    urgency: { type: Type.STRING, description: 'critical or recommended' },
  },
  required: ['action', 'reason', 'urgency'],
};

const BOT_LEARNING_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    botName: { type: Type.STRING },
    lessonFromPlayerDeck: {
      type: Type.STRING,
      description: 'Specific counterplay or threat-priority lesson this bot learned from the player AND rival bots it faced (naming actual cards/commanders or pod rivals).',
    },
    lessonFromOwnDeck: {
      type: Type.STRING,
      description: 'Specific sequencing, mulligan, overextension, or defeat/elimination lesson this bot learned from piloting its own archetype or custom decklist.',
    },
    tacticalAdjustment: {
      type: Type.STRING,
      description: 'Actionable heuristic or rule (e.g. holding blockers, threat pivoting, wipe timing) this bot will store in memory and apply in future matches.',
    },
    adaptationSummary: {
      type: Type.STRING,
      description: 'Concise 1-sentence note showing how prior simulated games or user coaching shaped its plays this game.',
    },
  },
  required: [
    'botName',
    'lessonFromPlayerDeck',
    'lessonFromOwnDeck',
    'tacticalAdjustment',
    'adaptationSummary',
  ],
};

const PLAYTEST_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    outcome: { type: Type.STRING, description: 'One of: win, loss, close' },
    matchSummary: { type: Type.STRING, description: '2-3 sentence summary of how the match played out, citing exact win vectors (life, poison, commander damage, or mill).' },
    mulliganVerdict: { type: Type.STRING, description: 'Whether the opening 7 was Keepable or a Mulligan and why.' },
    rounds: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          roundNumber: { type: Type.INTEGER },
          cardDrawn: { type: Type.STRING },
          landsInPlay: { type: Type.INTEGER },
          manaAvailable: { type: Type.INTEGER },
          handSnapshot: { type: Type.ARRAY, items: { type: Type.STRING } },
          playerAction: { type: Type.STRING, description: 'What the player did this round.' },
          cardsPlayed: { type: Type.ARRAY, items: { type: Type.STRING } },
          playerStats: {
            type: Type.OBJECT,
            properties: {
              combatDamageDealt: { type: Type.INTEGER, description: 'Total non-poison combat/burn damage player dealt to bots this turn.' },
              commanderDamageDealt: { type: Type.INTEGER, description: 'Commander combat damage player dealt to primary target bot this turn.' },
              poisonDealt: { type: Type.INTEGER, description: 'Poison counters (Infect/Toxic/Proliferate) player dealt to bots this turn.' },
              millDealt: { type: Type.INTEGER, description: 'Cards player milled from bot library this turn.' },
              lifeGained: { type: Type.INTEGER, description: 'Life player gained this turn.' },
              cardsDrawnExtra: { type: Type.INTEGER, description: 'Extra cards player drew beyond the draw step.' },
              creaturesOnBoard: { type: Type.INTEGER, description: 'Total creatures player currently controls at end of turn.' },
              targetBot: { type: Type.STRING, description: 'Exact name of the opposing bot targeted by Your primary combat attack/burn this turn (empty if passive turn).' },
            },
            required: [
              'combatDamageDealt',
              'commanderDamageDealt',
              'poisonDealt',
              'millDealt',
              'lifeGained',
              'cardsDrawnExtra',
              'creaturesOnBoard',
            ],
          },
          botPlays: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                botName: { type: Type.STRING },
                archetype: { type: Type.STRING },
                commanderName: { type: Type.STRING, description: 'This bot commander name (for tracking 21 commander damage).' },
                targetParticipant: { type: Type.STRING, description: 'The exact participant target chosen by this bot this turn: "You" OR the exact name of another opposing bot in the pod (e.g. "Bot 2 (Lyra)").' },
                action: { type: Type.STRING, description: 'Exact spells cast, interactions/blocks/wipes triggered (noting past-game memory or if eliminated), and combat/toxic/infect/commander/mill numbers.' },
                boardThreat: { type: Type.STRING },
                lifeChangeToYou: { type: Type.INTEGER, description: 'Net HP delta to You from this bot turn (negative for damage/drain, 0 if targeting another bot without "each opponent" drain, 0 if infect-only).' },
                poisonToYou: { type: Type.INTEGER, description: 'Poison counters inflicted on You this turn (0 if targeting another bot unless Proliferate/each opponent).' },
                commanderDamageToYou: { type: Type.INTEGER, description: 'Commander combat damage dealt to You by this bot commander this turn (0 if targeting another bot).' },
                millToYou: { type: Type.INTEGER, description: 'Number of cards this bot milled from Your library this turn (0 if targeting another bot).' },
                targetLifeDelta: { type: Type.INTEGER, description: 'Net HP delta inflicted by this bot onto its chosen targetParticipant (negative for combat/burn/drain damage, e.g. -6; 0 if blocked or infect-only).' },
                targetPoisonDelta: { type: Type.INTEGER, description: 'Poison counters inflicted onto targetParticipant this turn.' },
                targetCommanderDamage: { type: Type.INTEGER, description: 'Commander combat damage dealt to targetParticipant this turn (using Commander actual combat power + buffs).' },
                targetMillAmount: { type: Type.INTEGER, description: 'Cards milled from targetParticipant this turn.' },
                eachOpponentLifeDelta: { type: Type.INTEGER, description: 'Net HP delta applied to every OTHER living opponent besides attacker and targetParticipant from each-opponent drain/burn effects (0 if single-target only).' },
                eachOpponentPoison: { type: Type.INTEGER, description: 'Poison counters applied to every OTHER living opponent besides attacker and targetParticipant from each-opponent poison/proliferate (0 if none).' },
                eachOpponentMill: { type: Type.INTEGER, description: 'Cards milled from every OTHER living opponent besides attacker and targetParticipant from each-opponent mill effects (0 if none).' },
                creaturesRemovedOnTarget: { type: Type.INTEGER, description: 'Creatures on targetParticipant destroyed/exiled via removal or combat blocks this turn.' },
                boardWipeCast: { type: Type.BOOLEAN, description: 'True if this bot cast a board wipe sweeping creatures across the table this turn.' },
                selfLifeGain: { type: Type.INTEGER, description: 'Life this bot gained this turn (e.g. lifelink/drain).' },
                selfLifeLoss: { type: Type.INTEGER, description: 'Life this bot lost on its own turn (e.g. pain lands, shock, black draw).' },
                eliminatedThisTurn: { type: Type.BOOLEAN, description: 'True if this bot was already eliminated before its turn began.' },
                damageTakenFromYou: { type: Type.INTEGER, description: 'Total life damage this bot took from Your turn/blocks.' },
                poisonTakenFromYou: { type: Type.INTEGER, description: 'Poison counters this bot took from Your Infect/Toxic.' },
                commanderDamageTakenFromYou: { type: Type.INTEGER, description: 'Commander combat damage this bot took from Your Commander.' },
                millTakenFromYou: { type: Type.INTEGER, description: 'Cards milled from this bot library by You.' },
                creaturesOnBoard: { type: Type.INTEGER, description: 'Total creatures this bot controls at end of round.' },
                landsInPlay: { type: Type.INTEGER, description: 'Lands this bot currently controls.' },
                manaAvailable: { type: Type.INTEGER, description: 'Mana this bot has available this round.' },
                handSize: { type: Type.INTEGER, description: 'Cards in hand for this bot.' },
                appliedPastMemory: { type: Type.STRING, description: 'Specific prior-game lesson, loss adjustment, or known threat countered this round (empty if baseline).' },
              },
              required: [
                'botName',
                'archetype',
                'commanderName',
                'targetParticipant',
                'action',
                'boardThreat',
                'lifeChangeToYou',
                'poisonToYou',
                'commanderDamageToYou',
                'millToYou',
                'targetLifeDelta',
                'targetPoisonDelta',
                'targetCommanderDamage',
                'targetMillAmount',
                'creaturesRemovedOnTarget',
                'boardWipeCast',
                'selfLifeGain',
                'damageTakenFromYou',
                'poisonTakenFromYou',
                'commanderDamageTakenFromYou',
                'millTakenFromYou',
                'creaturesOnBoard',
                'landsInPlay',
                'manaAvailable',
                'handSize',
              ],
            },
          },
          lifeTotals: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                player: { type: Type.STRING },
                life: { type: Type.INTEGER },
              },
              required: ['player', 'life'],
            },
          },
          manaOrTempoIssue: {
            type: Type.STRING,
            description: 'Any mana screw, color bottleneck, slow tapped-land turn, missing removal, or curve bottleneck this round (or "Smooth mana").',
          },
          roundChanges: {
            type: Type.ARRAY,
            items: ROUND_CHANGE_SCHEMA,
            description: '1-2 specific deck changes revealed by this exact round.',
          },
        },
        required: [
          'roundNumber',
          'cardDrawn',
          'landsInPlay',
          'manaAvailable',
          'handSnapshot',
          'playerAction',
          'cardsPlayed',
          'playerStats',
          'botPlays',
          'lifeTotals',
          'manaOrTempoIssue',
          'roundChanges',
        ],
      },
    },
    keyTakeaways: {
      type: Type.ARRAY,
      items: ROUND_CHANGE_SCHEMA,
      description: 'Top 3-5 overall changes learned from the entire match.',
    },
    botLearnings: {
      type: Type.ARRAY,
      items: BOT_LEARNING_SCHEMA,
      description: 'Post-match adaptive reflection for EVERY active bot opponent.',
    },
  },
  required: [
    'outcome',
    'matchSummary',
    'mulliganVerdict',
    'rounds',
    'keyTakeaways',
    'botLearnings',
  ],
};

export async function runBotPlaytest(params: {
  deckName: string;
  format: Exclude<DeckFormat, 'auto'>;
  resolvedCards: ResolvedDeckCard[];
  overrideDeckText?: string;
  testedListLabel: string;
  mode: PlaytestMode;
  opponents: BotOpponentConfig[];
  botMemoryProfiles?: BotLearningProfile[];
  autoLearnFromMatches?: boolean;
  onProgress?: (percent: number, stage: string, detail?: string) => void;
}): Promise<PlaytestResult> {
  const {
    deckName,
    format,
    mode,
    opponents,
    testedListLabel,
    botMemoryProfiles = [],
    onProgress,
  } = params;
  const autoLearnEnabled =
    typeof params.autoLearnFromMatches === 'boolean'
      ? params.autoLearnFromMatches
      : isAutoLearnFromMatchesEnabled();

  onProgress?.(10, 'Preparing player & bot decklists...');

  let cardsToTest: ResolvedDeckCard[] = (params.resolvedCards || []).map((c) => ({ ...c }));
  const explicitIncomingCommanders = new Set(
    cardsToTest
      .filter((c) => c.zone === 'commander')
      .map((c) => normalizeCardLookupKey(c.name))
  );

  // Reuse all card metadata already resolved on the client / analyzer before hitting Scryfall
  const knownMetaMap = new Map<string, CardMetadata>();
  const registerKnownMeta = (lookupName: string, meta: CardMetadata | null | undefined) => {
    if (!meta) return;
    knownMetaMap.set(normalizeCardLookupKey(lookupName), meta);
    if (meta.name) {
      knownMetaMap.set(normalizeCardLookupKey(meta.name), meta);
      if (meta.name.includes(' // ')) {
        knownMetaMap.set(normalizeCardLookupKey(meta.name.split(' // ')[0]), meta);
      }
    }
  };
  for (const rc of cardsToTest) {
    registerKnownMeta(rc.name, rc.card);
  }

  let parsedOverride: ReturnType<typeof parseUniversalDecklist> | null = null;
  if (params.overrideDeckText && params.overrideDeckText.trim()) {
    const parsed = parseUniversalDecklist(params.overrideDeckText);
    if (parsed.cards.length > 0) {
      parsedOverride = parsed;
    }
  }

  const expectedOpponents = mode === '1v1' ? 1 : mode === '1v2' ? 2 : 3;
  const rawOpponents = opponents.slice(0, expectedOpponents);
  const customCardsByOppIdx = new Map<number, ResolvedDeckCard[]>();
  const parsedCustomDecks = new Map<number, ReturnType<typeof parseUniversalDecklist>>();
  const missingCardNamesSet = new Set<string>();

  if (parsedOverride) {
    for (const c of parsedOverride.cards) {
      if (!findMetaFromMap(knownMetaMap, c.name)) {
        missingCardNamesSet.add(c.name);
      }
    }
  }

  rawOpponents.forEach((opp, idx) => {
    if (opp.customDeckText && opp.customDeckText.trim()) {
      const parsedBot = parseUniversalDecklist(opp.customDeckText);
      parsedCustomDecks.set(idx, parsedBot);
      for (const c of parsedBot.cards.slice(0, 120)) {
        if (!findMetaFromMap(knownMetaMap, c.name)) {
          missingCardNamesSet.add(c.name);
        }
      }
    }
  });

  const missingCardNames = Array.from(missingCardNamesSet);
  if (missingCardNames.length > 0) {
    onProgress?.(
      18,
      'Resolving uncached player & bot cards via Scryfall...',
      `${missingCardNames.length} uncached cards`
    );
    const fetchedMap = await resolveCardNamesWithScryfall(missingCardNames, format, {
      skipMarketPrices: true,
    });
    fetchedMap.forEach((meta, key) => {
      knownMetaMap.set(key, meta);
      registerKnownMeta(meta.name, meta);
    });
  }

  if (parsedOverride) {
    cardsToTest = parsedOverride.cards.map((c) => {
      const meta = findMetaFromMap(knownMetaMap, c.name) || null;
      return {
        ...c,
        name: meta ? meta.name : c.name,
        card: meta,
      };
    });

    if (
      !cardsToTest.some((c) => c.zone === 'commander') &&
      explicitIncomingCommanders.size > 0
    ) {
      for (const c of cardsToTest) {
        if (explicitIncomingCommanders.has(normalizeCardLookupKey(c.name))) {
          c.zone = 'commander';
        }
      }
    }
  }

  const totalPlayerCardCount = cardsToTest
    .filter((c) => c.zone === 'main' || c.zone === 'commander')
    .reduce((s, c) => s + c.quantity, 0);
  const formatRules = getFormatSimulationRules(format, mode, totalPlayerCardCount);

  if (formatRules.allowsCommandZone) {
    autoRecognizeCommanders(cardsToTest, format);
  } else {
    cardsToTest = cardsToTest.map((c) =>
      c.zone === 'commander' ? { ...c, zone: 'main' as const } : c
    );
  }

  const isMultiplayer = formatRules.isMultiplayer;
  const startingLife = formatRules.startingLife;
  const totalRounds = mode === '1v1' ? 8 : 9;

  const memoryByKey = new Map<string, BotLearningProfile>();
  const memoryByName = new Map<string, BotLearningProfile>();
  for (const mem of botMemoryProfiles) {
    if (!mem) continue;
    memoryByKey.set(mem.botKey, mem);
    if (typeof mem.botName === 'string' && mem.botName.trim()) {
      memoryByName.set(mem.botName.trim().toLowerCase(), mem);
    }
  }

  const activeOpponents = rawOpponents.map((opp, idx) => {
    const indignanceMeta = getBotIndignanceMeta(opp.indignance);
    const botKey = resolveBotLearningKey(opp);
    const memory =
      memoryByKey.get(botKey) || memoryByName.get((opp.name || '').trim().toLowerCase());
    const parsedBot = parsedCustomDecks.get(idx);
    let resolvedCustomCards: ResolvedDeckCard[] = parsedBot
      ? parsedBot.cards.map((c) => {
          const meta = findMetaFromMap(knownMetaMap, c.name) || null;
          return {
            ...c,
            name: meta ? meta.name : c.name,
            card: meta,
          };
        })
      : [];
    if (resolvedCustomCards.length > 0) {
      if (formatRules.allowsCommandZone) {
        const botDeckTotal = resolvedCustomCards
          .filter((c) => c.zone === 'main' || c.zone === 'commander')
          .reduce((s, c) => s + c.quantity, 0);
        const botFormat: Exclude<DeckFormat, 'auto'> =
          resolvedCustomCards.some((c) => c.zone === 'commander') || botDeckTotal >= 85
            ? format === 'brawl'
              ? 'brawl'
              : 'commander'
            : format;
        autoRecognizeCommanders(resolvedCustomCards, botFormat);
      } else {
        resolvedCustomCards = resolvedCustomCards.map((c) =>
          c.zone === 'commander' ? { ...c, zone: 'main' as const } : c
        );
      }
    }
    customCardsByOppIdx.set(idx, resolvedCustomCards);
    const bias = detectArchetypeCombatBias(opp, resolvedCustomCards, format);
    const blueprint =
      resolvedCustomCards.length > 0 ? extractDeckSynergyBlueprint(resolvedCustomCards) : null;
    const botDraws =
      resolvedCustomCards.length > 0
        ? simulateRealDraws(resolvedCustomCards, totalRounds, formatRules, true)
        : null;
    const briefing = buildBotPastPlayBriefing(memory, deckName);

    return {
      ...opp,
      botKey,
      indignance: indignanceMeta.id as BotIndignanceLevel,
      indignanceMeta,
      memory,
      bias,
      blueprint,
      botDraws,
      briefing,
      resolvedCustomCards,
      deckSize:
        resolvedCustomCards.reduce(
          (s, c) => s + (c.zone === 'main' ? c.quantity : 0),
          0
        ) || formatRules.targetMainDeckSize,
    };
  });

  const persistMatchMovesToTrainingFile = (
    matchResult: PlaytestResult,
    engineUsed: string,
    directivesByBot: Record<string, BotMatchTacticalDirective> = {}
  ) => {
    if (!autoLearnEnabled) return;
    try {
      const winningLower = (matchResult.finalStats?.winningPlayer || '').trim().toLowerCase();
      const youFinal = (matchResult.finalStats?.participants || []).find(
        (p) => p.player === 'You'
      );

      const oppMetaByLower = new Map(
        activeOpponents.map((opp) => [(opp.name || '').trim().toLowerCase(), opp])
      );

      const outcomeByBotLower = new Map<string, 'win' | 'loss' | 'close'>();
      for (const opp of activeOpponents) {
        const oppLower = (opp.name || '').trim().toLowerCase();
        const botFinal = (matchResult.finalStats?.participants || []).find(
          (p) => (p?.player || '').trim().toLowerCase() === oppLower
        );
        const isBotEliminated = Boolean(botFinal?.eliminatedBy);
        let outcomeForBot: 'win' | 'loss' | 'close';
        if (isBotEliminated) {
          outcomeForBot = 'loss';
        } else if (activeOpponents.length <= 1) {
          outcomeForBot =
            matchResult.outcome === 'loss'
              ? 'win'
              : matchResult.outcome === 'win'
              ? 'loss'
              : 'close';
        } else if (matchResult.outcome === 'loss' && winningLower === oppLower) {
          outcomeForBot = 'win';
        } else if (matchResult.outcome === 'win') {
          outcomeForBot = 'loss';
        } else if (
          matchResult.outcome === 'close' &&
          (winningLower === oppLower ||
            (!winningLower.includes('you') && (botFinal?.life ?? 0) >= (youFinal?.life ?? 0)))
        ) {
          outcomeForBot = 'close';
        } else {
          outcomeForBot = 'loss';
        }
        outcomeByBotLower.set(oppLower, outcomeForBot);
      }

      const moves: Array<Omit<BotMoveOutcomeRecord, 'id' | 'timestampIso'>> = [];
      for (const rd of matchResult.rounds || []) {
        for (const bp of rd.botPlays || []) {
          const botNameLower = (bp.botName || '').trim().toLowerCase();
          const opp = oppMetaByLower.get(botNameLower);
          if (!opp) continue;
          const dir = directivesByBot[opp.name] || directivesByBot[botNameLower];
          moves.push({
            botKey: opp.botKey,
            botName: opp.name,
            archetype: opp.customDeckText?.trim() ? 'Custom Decklist' : opp.archetype,
            format,
            mode,
            playerDeckName: deckName,
            roundNumber: rd.roundNumber,
            action: bp.action || bp.boardThreat || 'Pass turn',
            targetParticipant: bp.targetParticipant || 'You',
            targetLifeDelta: bp.targetLifeDelta ?? 0,
            targetPoisonDelta: bp.targetPoisonDelta ?? 0,
            targetCommanderDamage: bp.targetCommanderDamage ?? 0,
            targetMillAmount: bp.targetMillAmount ?? 0,
            boardWipeCast: Boolean(bp.boardWipeCast),
            creaturesRemoved: bp.creaturesRemovedOnTarget ?? 0,
            postureUsed: dir?.posture,
            manaPlanUsed: dir?.manaPlan,
            appliedMemoryReason: bp.appliedPastMemory || dir?.appliedMemoryReason,
            matchOutcomeForBot: outcomeByBotLower.get(botNameLower) || 'loss',
            engineUsed,
          });
        }
      }

      if (moves.length > 0) {
        recordBotTrainingMatchOutcomes({ moves });
      }
    } catch (trainErr) {
      console.warn('[Playtester] Failed to persist bot_training.json outcomes:', trainErr);
    }
  };

  const runDeterministicPlaytest = () => {
    onProgress?.(68, `Simulating deterministic ${mode} pod rounds & bot IQ...`);
    const detResult = simulatePlaytestClientSideFallback({
      deckName,
      format,
      resolvedCards: cardsToTest,
      testedListLabel,
      mode,
      opponents,
      botMemoryProfiles,
      extraCardMeta: Array.from(new Set(knownMetaMap.values())),
      resolvedCustomCardsByBotIndex: Object.fromEntries(customCardsByOppIdx.entries()),
    });
    const finalDet: PlaytestResult = {
      ...detResult,
      botLearnings: autoLearnEnabled ? detResult.botLearnings : [],
      aiEngineUsed: 'deterministic' as const,
      ggufLearningApplied: false,
    };
    persistMatchMovesToTrainingFile(finalDet, 'deterministic');
    return finalDet;
  };

  if (shouldUseDeterministicOnly()) {
    onProgress?.(68, `Simulating deterministic ${mode} pod rounds & bot IQ...`);
    await yieldToEventLoop();
    return runDeterministicPlaytest();
  }

  onProgress?.(30, 'Shuffling libraries & drawing opening 7 cards...');
  await yieldToEventLoop();
  const playerBlueprint = extractDeckSynergyBlueprint(cardsToTest);
  const { openingHand, mulliganVerdict: playerSeedMulligan, turnSeeds, commanderNames, mainDeckCount } =
    simulateRealDraws(cardsToTest, totalRounds, formatRules, false);

  // Highlight special mechanics inside the player's own deck for accurate simulation
  const playerMechanicsList: string[] = [];
  for (const c of cardsToTest) {
    const mech = detectCardMechanics(c.name, c.card);
    const tags: string[] = [];
    if (mech.hasInfect) tags.push('Infect');
    if (mech.toxicValue > 0) tags.push(`Toxic ${mech.toxicValue}`);
    if (mech.hasProliferate) tags.push('Proliferate');
    if (mech.millAmount > 0) tags.push(`Mill ${mech.millAmount}`);
    if (mech.isVoltronBuff) tags.push('Cmdr/Voltron');
    if (mech.burnOrDrainAmount > 0) tags.push(`Drain/Burn ${mech.burnOrDrainAmount}`);
    if (mech.isTutor) tags.push('Tutor');
    if (mech.isCounterspell) tags.push('Counterspell');
    if (mech.isProtection) tags.push('Protection');
    if (mech.isReanimator) tags.push('Reanimator');
    if (mech.isEnginePermanent) tags.push('Engine');
    if (tags.length > 0) {
      playerMechanicsList.push(`${c.name} [${tags.join(', ')}]`);
    }
  }

  const deckCardListSummary = cardsToTest
    .filter((c) => c.zone === 'main' || c.zone === 'commander')
    .map((c) => {
      const pt =
        c.card?.power !== undefined && c.card?.toughness !== undefined
          ? `, ${c.card.power}/${c.card.toughness}`
          : '';
      return `${c.quantity}x ${c.name} (${c.card?.manaCost || '0'}, MV ${c.card?.cmc ?? '?'}, ${c.card?.typeLine || ''}${pt})`;
    })
    .join('\n');

  const opponentDescriptions = activeOpponents
    .map((opp, i) => {
      const customCommanders = opp.resolvedCustomCards.filter(
        (c) => c.zone === 'commander'
      );
      const customCmdLabel =
        customCommanders.length > 0
          ? customCommanders.map((c) => c.name).join(' & ')
          : opp.bias.defaultCommanderName;

      const formatCustomBotCard = (c: ResolvedDeckCard) => {
        const mech = detectCardMechanics(c.name, c.card);
        const pt =
          c.card?.power !== undefined && c.card?.toughness !== undefined
            ? `, ${c.card.power}/${c.card.toughness}`
            : '';
        const tags: string[] = [];
        if (mech.hasInfect) tags.push('Infect');
        if (mech.toxicValue > 0) tags.push(`Toxic ${mech.toxicValue}`);
        if (mech.hasProliferate) tags.push('Proliferate');
        if (mech.millAmount > 0) tags.push(`Mill ${mech.millAmount}`);
        if (mech.isTutor) tags.push('Tutor');
        if (mech.isProtection) tags.push('Protection');
        if (mech.isReanimator) tags.push('Reanimator');
        if (mech.isEnginePermanent) tags.push('Engine');
        if (mech.isTokenMaker) tags.push('Tokens');
        if (mech.isBoardWipe) tags.push('Wipe');
        else if (mech.isCounterspell) tags.push('Counterspell');
        else if (mech.isCounterOrRemoval) tags.push('Removal');
        if (mech.hitsEachOpponent) tags.push('EachOpp');
        const tagSuffix = tags.length > 0 ? ` [${tags.join(', ')}]` : '';
        return `${c.quantity}x ${c.name} (${c.card?.manaCost || `MV ${c.card?.cmc ?? '?'}`}, ${c.card?.typeLine || 'Card'}${pt})${tagSuffix}`;
      };

      const cmdDetails =
        customCommanders.length > 0
          ? customCommanders.map(formatCustomBotCard).join('; ')
          : opp.bias.defaultCommanderName;

      const customNonCmd = opp.resolvedCustomCards.filter((c) => c.zone === 'main');
      const bp = opp.blueprint;
      const blueprintLines = bp
        ? `\n  -> Strategic Gameplan: ${bp.primaryPlan} | Commander Role: ${bp.commanderRole}\n  -> Synergy Packages: ${bp.synergyPackages.join(', ') || 'Standard Curve'} | Key Payoffs: ${bp.keyPayoffs.join(', ') || 'Midrange threats'}`
        : '';

      const botDrawLines = opp.botDraws
        ? `\n  -> Bot's Real London Mulligan: ${opp.botDraws.mulliganVerdict} | Opening Hand: [${opp.botDraws.openingHand.join(', ')}]\n  -> Bot's Private Turn-by-Turn Drawn Cards & Colored Mana:\n${opp.botDraws.turnSeeds
            .map(
              (s) =>
                `     R${s.roundNumber}: Drew "${s.cardDrawn}", Land: ${s.landPlayed || 'MISSED'} (Lands ${s.landsInPlay}, Mana ${s.manaAvailable} [${s.colorSourcesSummary}]), Suggested Plays: [${s.suggestedCasts.join(', ') || 'Hold Open Mana'}], Remaining Hand: [${s.handSnapshot.join(', ')}]`
            )
            .join('\n')}`
        : '';

      const deckSummary =
        opp.resolvedCustomCards.length > 0
          ? `Custom Decklist (${opp.deckSize} main cards | Lands: ${opp.bias.landCount}, Ramp: ${opp.bias.rampCount}, Removal/Counters: ${opp.bias.removalCount}, Wipes: ${opp.bias.wipeCount})${blueprintLines}\n  -> Commanders: ${cmdDetails}${botDrawLines}\n  -> Full Custom Card Pool: ${customNonCmd
              .slice(0, 100)
              .map(formatCustomBotCard)
              .join(' | ')}`
          : `${opp.archetype} (Commander: ${opp.bias.defaultCommanderName})`;

      const mem = opp.memory;
      const memoryLines: string[] = [
        `  -> Historical Performance Briefing: ${opp.briefing.summaryText}`,
      ];
      if (mem && (mem.tacticalDirectives.length > 0 || mem.userFeedbackNotes.length > 0)) {
        if (mem.learnedFromFacedDecks.length > 0) {
          memoryLines.push(
            `  -> Memory from Decks Faced: ${mem.learnedFromFacedDecks.slice(0, 4).join(' | ')}`
          );
        }
        if (mem.learnedFromOwnDecks.length > 0) {
          memoryLines.push(
            `  -> Memory from Own Piloted Decks: ${mem.learnedFromOwnDecks.slice(0, 4).join(' | ')}`
          );
        }
        if (mem.userFeedbackNotes.length > 0) {
          memoryLines.push(
            `  -> User Coaching Feedback (OBEY STRICTLY): ${mem.userFeedbackNotes.slice(0, 4).join(' | ')}`
          );
        }
        if (mem.tacticalDirectives.length > 0) {
          memoryLines.push(
            `  -> Active Learned Directives: ${mem.tacticalDirectives.slice(0, 5).join(' | ')}`
          );
        }
      }

      const mechanicDirectives: string[] = [];
      if (opp.bias.usesInfect) {
        mechanicDirectives.push('INFECT (deals combat damage as poison counters instead of life loss; 10 poison = defeat)');
      }
      if (opp.bias.usesToxic) {
        mechanicDirectives.push('TOXIC & PROLIFERATE (deals normal HP combat damage + Toxic N poison counters)');
      }
      if (opp.bias.usesMill) {
        mechanicDirectives.push('MILL (removes cards from player library to graveyard via millToYou; 0 library on draw = defeat)');
      }
      if (opp.bias.usesVoltronCommander) {
        mechanicDirectives.push('COMMANDER VOLTRON (pushes commanderDamageToYou toward lethal 21 Commander damage)');
      }

      return `Bot ${i + 1}: "${opp.name}" (Cmdr Label: ${customCmdLabel}) playing ${deckSummary}\n  -> Combat Specialties: ${mechanicDirectives.join('; ') || 'Balanced Combat / Interaction / Burn'}\n  -> Indignance Setting: ${opp.indignanceMeta.label} — ${opp.indignanceMeta.aiDirective}\n${memoryLines.join('\n')}`;
    })
    .join('\n\n');

  const drawTimeline = turnSeeds
    .map(
      (t) =>
        `Round ${t.roundNumber}: Drew "${t.cardDrawn}" | Land played: ${t.landPlayed || 'NONE (MISSED LAND DROP)'} | Lands in play: ${t.landsInPlay} | Mana available: ${t.manaAvailable} [${t.colorSourcesSummary}] | Hand: [${t.handSnapshot.join(', ')}] | Stranded cards: [${t.strandedHighCostCards.join(', ') || 'None'}]`
    )
    .join('\n');

  const prompt = `Simulate a realistic, creative, strategically sharp ${totalRounds}-round Magic: The Gathering ${mode} match (${isMultiplayer ? 'Multiplayer Pod' : '1v1 Duel'}) using authentic paper-format rules, hidden-information play, real shuffled London Mulligan hands, and the Adaptive AI Bot Opponents below.

MATCH SETUP & FORMAT RULES (${format.toUpperCase()} — OBEY 100% STRICTLY):
- Player Deck: ${deckName} (${format}, Starting Life: ${startingLife}, Starting Library after Mulligan: ${Math.max(1, mainDeckCount - openingHand.length)} cards)
- Format Rules: Command Zone is ${formatRules.allowsCommandZone ? 'ACTIVE (Commanders start in Command Zone with +2 mana commander tax per recast)' : 'INACTIVE — Constructed/Limited format: NO Command Zone, NO phantom Commanders; set commanderDamageToYou and targetCommanderDamage to 0'}.
- 21 Commander Damage KO Rule: ${formatRules.usesCommanderDamage21 ? 'ENABLED (21 combat damage from one commander = elimination)' : 'DISABLED in this format (only 0 life, 10 poison, or empty-library draw eliminates a player)'}.
- Turn 1 Draw Rule (CR 103.8): ${formatRules.playerSkipsTurn1Draw ? 'Player (Seat 1) SKIPS Turn 1 draw; Bot (Seat 2) draws normally on Turn 1' : 'Every player draws a card on Turn 1'}.
- Player London Mulligan: ${playerSeedMulligan}
- Player Strategy Blueprint: ${playerBlueprint.primaryPlan} | Commanders: ${commanderNames.join(', ') || 'None'} (${playerBlueprint.commanderRole}) | Packages: ${playerBlueprint.synergyPackages.join(', ') || 'Standard'}
- Special Player Deck Mechanics Detected: ${playerMechanicsList.slice(0, 18).join('; ') || 'Standard combat/spell curve'}
- Mode: ${mode} (You + ${activeOpponents.length} Adaptive AI Bot opponent${activeOpponents.length > 1 ? 's' : ''})
- Opponents (pilot each bot creatively using its real drawn hand, synergy plan, past simulated games, and indignance setting):
${opponentDescriptions}

PLAYER'S REAL OPENING HAND:
[${openingHand.join(', ')}]

PLAYER'S REAL TURN-BY-TURN DRAWS & COLORED MANA:
${drawTimeline}

PLAYER'S FULL DECKLIST:
${deckCardListSummary}

CRITICAL MTG RULES, CREATIVE PILOTING & TELEMETRY INSTRUCTIONS:
1. FOLLOW REAL DRAWS, COLORED MANA PIPS & FORMAT RULES:
   - Follow the exact cardDrawn, landsInPlay, manaAvailable, colored sources ([W U B R G]), and handSnapshot for the Player AND for every Custom Decklist Bot's Private Drawn Timeline!
   - Do NOT let a bot cast spells requiring {U}{U} or {B}{B} unless it actually has those colored mana sources on board, and NEVER let bots invent random cards outside their hand/command zone (unless legitimately tutoring a real card from their Full Custom Card Pool or reanimating a creature from their graveyard!).
2. CREATIVE, HIGH-LEVEL BOT INTELLIGENCE & HIDDEN INFORMATION:
   - HIDDEN INFORMATION DISCIPLINE: Bots CANNOT see cards hidden in Your or rival bots' hands! They react strictly to public information (permanents on board, noncreature engines like Rhystic Study / Smothering Tithe / Blood Artist, graveyard threats, open mana held up, hand size, and Thoughtseize-revealed cards).
   - INSTANT-SPEED STACK INTERACTION & OPEN MANA: Control/Tempo bots or bots holding Counterspells / Instant Removal MUST intentionally hold up open colored mana (e.g., passing with 2U open) rather than tapping out for filler, and use counters/removal at instant speed on opponents' turns against game-changing Commanders, Tutors, Board Wipes, or combo payoffs!
   - CREATIVE SEQUENCING & SYNERGY LINES:
     * Sequence mana rocks/dorks before big threats so newly generated mana gets spent efficiently; in late-game turns (6+ mana), maximize total mana utilization by chaining double-spells (e.g., 3+4 or 4+3 + removal) or scaling X-spells rather than stranding mana on a single sub-optimal play.
     * ENDGAME STATE EVALUATION & LETHAL SWINGS: Actively check blocker-aware lethal lines each turn (counting Trample overflow, Flying/Menace/Unblockable evasion, Double Strike, Commander damage to 21, Infect/Toxic/Proliferate to 10, and spot removal clearing the key blocker before combat). Override holding up counterspell mana whenever tapping out guarantees an immediate knockout or match win.
     * Bots with Tutors search for what the live table demands (e.g., a Board Wipe when trailing, Removal for an active Voltron/Engine Commander or last blocker for lethal, Protection before risking their Commander, or Overrun/Craterhoof/X-spell finishers when ahead).
     * Bots with Protection (Swiftfoot Boots, Heroic Intervention, Deflecting Swat) protect their Commander or key payoff instead of walking blindly into open mana removal.
     * Bots with Reanimator/Aristocrats/Landfall/Spellslinger engines actively set up sacrifice/discard/spell-chain turns and trigger their noncreature payoffs authentically.
     * SWEEPER RESTRAINT & CRACKBACK DEFENSE: If an opponent holds 4+ open mana and 4+ cards, smart bots avoid overcommitting extra non-haste creatures onto an already winning board; when non-lethal and facing threatening crackback, hold non-Vigilance blockers back while poking with Vigilance and evasive threats.
3. APPLY PAST SIMULATED GAMES & LOSS LESSONS ACCURATELY:
   - When a Bot's Historical Briefing or Coaching Directives cite prior losses, known threats, or missed-land punishes, reflect that in real decisions (countering known engines, targeting fast mana/Rhystic Study early, timing wipes cleanly) and record it in "appliedPastMemory".
4. MATCH HEALTH, INTER-BOT COMBAT & STATS ARITHMETICALLY:
   - Every BotPlay entry MUST specify exact numeric integers for:
     * targetParticipant ("You" OR exact opposing bot name in the pod)
     * targetLifeDelta, targetPoisonDelta, targetCommanderDamage, targetMillAmount
     * eachOpponentLifeDelta, eachOpponentPoison, eachOpponentMill (ONLY for "each opponent" drain/burn/proliferate/mill effects hitting every OTHER living opponent besides attacker & targetParticipant; 0 if single-target!)
     * creaturesRemovedOnTarget, boardWipeCast, selfLifeGain, selfLifeLoss, eliminatedThisTurn
     * damageTakenFromYou, poisonTakenFromYou, commanderDamageTakenFromYou, millTakenFromYou
     * creaturesOnBoard, landsInPlay, manaAvailable, handSize
   - When targetParticipant is ANOTHER BOT, NEVER copy single-target combat damage dealt to that bot into lifeChangeToYou!
   - Use ACTUAL printed Power/Toughness for BOTH Player and Bot creatures/commanders, re-trigger combat abilities on surviving creatures, and follow Infect/Toxic/Proliferate/Commander Damage rules faithfully.
5. MULTIPLAYER POD STRATEGY, INTER-BOT ATTACKS & ANTI-DOGPILE POLITICS:
   - In 1v2 and 1v3 pods, this is a true free-for-all — NEVER default to dogpiling "You" when rival bots are open, ahead on board/mana, or holding dangerous Commanders/engines!
   - Evaluate threats symmetrically across ALL living players (You + every rival bot): weigh creature board power, noncreature draw/mana engines, active Commanders, near-lethal Poison/Mill/Commander clocks, open blockers, and retaliation grudges from prior attacks, removal, or board wipes.
   - Bots on Low (Forgiving), Moderate (Measured), and High (Ruthless) MUST actively attack, remove threats from, and eliminate rival bots whenever a rival bot is leading, open, retaliated against, or in lethal range; spread early pressure across seats so all bots do not blindly pile onto "You" on the same round unless "You" are the clear archenemy or the bot is Maximum (Vindictive).
6. Track playerStats (including targetBot), ensure lifeTotals stay mathematically consistent, note mana/tempo issues + 1-2 roundChanges per round, and write sharp, deck-specific "keyTakeaways" and "botLearnings".`;

  const systemInstruction =
    'You are an expert paper Magic: The Gathering rules engine, competitive Commander/Constructed pilot, and playtest coach. Simulate creative, realistic turns obeying colored mana pips, hidden information, instant-speed stack interaction, synergy sequencing (tutors, protection, reanimation, noncreature engines), smart blocker math, and bot memory/indignance. Keep all life, poison, per-bot commander damage, mill, and board counts 100% arithmetically consistent. Output strict JSON matching the schema.';

  type ParsedPlaytestPayload = {
    outcome: 'win' | 'loss' | 'close';
    matchSummary: string;
    mulliganVerdict: string;
    rounds: PlaytestResult['rounds'];
    keyTakeaways: PlaytestResult['keyTakeaways'];
    botLearnings?: BotMatchLearningInsight[];
  };

  let parsed: ParsedPlaytestPayload | null = null;

  if (shouldUseLocalGguf()) {
    const modelLabel = getActiveLocalModelLabel() || 'Local GGUF';
    const modelInfo = getActiveLocalModelInfo();
    const isSlowCpu27b = modelInfo.tier === '27b' && modelInfo.isCpuOnly;
    const preMatchTimeoutMs = modelInfo.isCpuOnly
      ? modelInfo.tier === '27b'
        ? 95000
        : modelInfo.tier === '8b'
        ? 60000
        : 45000
      : 35000;
    const synthesisTimeoutMs = modelInfo.isCpuOnly
      ? modelInfo.tier === '27b'
        ? 140000
        : modelInfo.tier === '8b'
        ? 95000
        : 75000
      : 55000;

    const LOCAL_BOT_PLAN_SCHEMA: Record<string, unknown> = {
      type: 'object',
      properties: {
        botDirectives: {
          type: 'array',
          maxItems: 4,
          items: {
            type: 'object',
            properties: {
              botName: { type: 'string' },
              priorityTarget: { type: 'string' },
              posture: { enum: ['aggressive', 'balanced', 'defensive'] },
              manaPlan: { enum: ['hold-interaction', 'tap-out-pressure'] },
              winVectorFocus: { enum: ['auto', 'life', 'poison', 'commander', 'mill'] },
              keyThreatToAnswer: { type: 'string' },
              focusTag: { type: 'string' },
              appliedMemoryReason: { type: 'string' },
            },
          },
        },
      },
    };

    const LOCAL_SYNTHESIS_SCHEMA: Record<string, unknown> = {
      type: 'object',
      properties: {
        matchSummary: { type: 'string' },
        mulliganVerdict: { type: 'string' },
        roundNotes: {
          type: 'array',
          maxItems: 12,
          items: {
            type: 'object',
            properties: {
              roundNumber: { type: 'integer' },
              manaOrTempoIssue: { type: 'string' },
            },
          },
        },
        keyTakeaways: {
          type: 'array',
          maxItems: 4,
          items: {
            type: 'object',
            properties: {
              action: { enum: ['cut', 'add', 'swap'] },
              cutCardName: { type: 'string' },
              addCardName: { type: 'string' },
              reason: { type: 'string' },
              urgency: { enum: ['critical', 'recommended'] },
            },
          },
        },
        botLearnings: {
          type: 'array',
          maxItems: 4,
          items: {
            type: 'object',
            properties: {
              botName: { type: 'string' },
              lessonFromPlayerDeck: { type: 'string' },
              lessonFromOwnDeck: { type: 'string' },
              tacticalAdjustment: { type: 'string' },
              adaptationSummary: { type: 'string' },
              identifiedThreats: {
                type: 'array',
                maxItems: 3,
                items: { type: 'string' },
              },
              observedWeakness: { type: 'string' },
            },
          },
        },
      },
    };

    // 1) Pre-Match GGUF Adaptive Learning & Tactical Bot Strategy Pass (runs for every GGUF model tier)
    const botTacticalDirectives: Record<string, BotMatchTacticalDirective> = {};
    let preMatchPlanSucceeded = false;

    try {
      const trainingStore = loadBotTrainingData();
      const playerThreatPreview = [
        ...commanderNames,
        ...playerBlueprint.keyPayoffs.slice(0, 4),
      ]
        .filter(Boolean)
        .slice(0, 5);

      const oppBriefs = activeOpponents
        .map((opp) => {
          const cmd = opp.resolvedCustomCards.find((c) => c.zone === 'commander')?.name || opp.bias.defaultCommanderName;
          const plan = opp.blueprint?.primaryPlan || opp.archetype;
          const mem = opp.memory;
          const brf = opp.briefing;
          const iqScore = mem?.botIqScore ?? 100;
          const recordStr = mem && mem.matchesPlayed > 0
            ? `${mem.matchesPlayed}G (${mem.wins}W-${mem.losses}L, IQ ${iqScore}${brf.dominantWinVector ? `, BestVector:${brf.dominantWinVector}` : ''})`
            : `Baseline (IQ ${iqScore})`;
          const knownThreatsStr = brf.knownThreats.length > 0
            ? brf.knownThreats.slice(0, 4).join(', ')
            : 'None logged';
          const weaknessStr = brf.manaWeaknesses.length > 0
            ? brf.manaWeaknesses.slice(0, 2).join('; ')
            : '';
          const coachStr = (mem?.userFeedbackNotes || [])
            .slice(0, 2)
            .map((n) => n.slice(0, 85))
            .join(' | ');
          const priorDirStr = (mem?.tacticalDirectives || [])
            .slice(0, 2)
            .map((d) => d.slice(0, 85))
            .join(' | ');
          const lossStr = brf.recentLossLessons.length > 0
            ? brf.recentLossLessons[0].slice(0, 85)
            : '';

          const agg = trainingStore.strategies[opp.botKey];
          let trainingSummaryStr = '';
          if (agg && agg.movesRecorded > 0) {
            const postureParts = Object.entries(agg.postureStats || {})
              .map(([pName, st]) => {
                const wr = st.moves > 0 ? Math.round((st.wins / st.moves) * 100) : 0;
                const avgD = st.moves > 0 ? (st.totalDamage / st.moves).toFixed(1) : '0.0';
                return `${pName}:${wr}%WR/${avgD}dmg`;
              })
              .join(', ');
            const bestMove = agg.recentWinningMoves?.[0]?.slice(0, 95) || '';
            const avoidMove = agg.recentLosingMoves?.[0]?.slice(0, 95) || '';
            trainingSummaryStr = `bot_training.json (${agg.movesRecorded} moves, ${agg.wins}W-${agg.losses}L): Postures[${postureParts}]${bestMove ? ` | WinMove: ${bestMove}` : ''}${avoidMove ? ` | AvoidMove: ${avoidMove}` : ''}`;
          }

          const rivalThreatEntries = Object.entries(brf.rivalThreatByName || {})
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([rName, score]) => `${rName}(${Math.round(score)})`)
            .join(', ');

          return [
            `- "${opp.name}" | Cmdr: ${cmd} | OwnPlan: ${plan} | Temperament: ${opp.indignanceMeta.label} | Memory: ${recordStr}`,
            `  KnownThreats: ${knownThreatsStr}${weaknessStr ? ` | ExploitableWeakness: ${weaknessStr}` : ''}${rivalThreatEntries ? ` | LearnedRivalThreats: ${rivalThreatEntries}` : ''}`,
            priorDirStr ? `  PriorDirectives: ${priorDirStr}` : '',
            coachStr ? `  UserCoaching: ${coachStr}` : '',
            lossStr ? `  LossLesson: ${lossStr}` : '',
            trainingSummaryStr ? `  TrainingLog: ${trainingSummaryStr}` : '',
          ]
            .filter(Boolean)
            .join('\n');
        })
        .join('\n');

      const podRivalNames = activeOpponents.map((o) => o.name).join(', ');
      const planPrompt = `/no_think
Use each bot's historical memory, bot_training.json move outcomes, loss lessons, learned rival-bot threats, and user coaching to set adaptive tactical directives for this ${format} ${mode} playtest.
Table seats: Player "${deckName}" (Cmdr: ${commanderNames.join(', ') || 'None'}, Plan: ${playerBlueprint.primaryPlan}, KeyCards: ${playerThreatPreview.join(', ') || 'Standard'}) AND Bots [${podRivalNames}].
BOT DOSSIERS:
${oppBriefs}

Rules:
- Adapt based on each bot's Memory/TrainingLog/UserCoaching/LossLesson (e.g., favor postures with higher win rates in TrainingLog, avoid losing move patterns, or shift posture/hold-interaction if defeated previously).
- priorityTarget: In 1v2/1v3 pods, treat rival bots as genuine threats! Prefer "table-leader" or a dangerous rival bot's exact name (especially from LearnedRivalThreats or matching aggressive/combo rival archetypes) rather than automatically picking "You" for every bot unless the bot is Maximum (Vindictive) or specifically coached to focus You.
- keyThreatToAnswer: single most dangerous card/commander name from KnownThreats, KeyCards, or a rival bot's Cmdr.
- focusTag: <= 10 word tactical rule.
- appliedMemoryReason: <= 12 words summarizing what past lesson/coaching is being applied (or "Baseline matchup calibration").
Return JSON object matching botDirectives schema.`;

      const planRes = await generateJsonWithLocalGguf<{
        botDirectives?: Array<{
          botName?: string;
          priorityTarget?: string;
          posture?: 'aggressive' | 'balanced' | 'defensive';
          manaPlan?: 'hold-interaction' | 'tap-out-pressure';
          winVectorFocus?: 'auto' | 'life' | 'poison' | 'commander' | 'mill';
          keyThreatToAnswer?: string;
          focusTag?: string;
          appliedMemoryReason?: string;
        }>;
      }>({
        systemInstruction: 'Competitive MTG adaptive bot strategist. Apply historical match learning and user coaching strictly in JSON.',
        prompt: planPrompt,
        maxTokens: isSlowCpu27b ? 320 : 380,
        temperature: 0.25,
        jsonSchema: LOCAL_BOT_PLAN_SCHEMA,
        schemaCacheKey: 'playtest-bot-plan-v2',
        disableThinking: true,
        timeoutMs: preMatchTimeoutMs,
        onProgress: ({ phase, charsGenerated, estimatedMaxChars }) => {
          if (phase === 'loading') {
            onProgress?.(36, `Loading ${modelLabel} (.gguf) into memory...`);
          } else {
            const ratio = Math.min(1, charsGenerated / Math.max(200, estimatedMaxChars * 0.55));
            onProgress?.(
              Math.min(50, Math.round(38 + ratio * 12)),
              `Adapting bot memory & strategies with ${modelLabel}...`
            );
          }
        },
      });

      for (const item of planRes?.botDirectives || []) {
        const bName = typeof item?.botName === 'string' ? item.botName.trim() : '';
        if (!bName) continue;
        const dir: BotMatchTacticalDirective = {
          priorityTarget: typeof item.priorityTarget === 'string' ? item.priorityTarget.trim() : undefined,
          posture: item.posture,
          manaPlan: item.manaPlan,
          winVectorFocus: item.winVectorFocus,
          keyThreatToAnswer: typeof item.keyThreatToAnswer === 'string' ? item.keyThreatToAnswer.trim() : undefined,
          focusTag: typeof item.focusTag === 'string' ? item.focusTag.trim() : undefined,
          appliedMemoryReason: typeof item.appliedMemoryReason === 'string' ? item.appliedMemoryReason.trim() : undefined,
        };
        botTacticalDirectives[bName] = dir;
        botTacticalDirectives[bName.toLowerCase()] = dir;
        preMatchPlanSucceeded = true;
      }
    } catch (planErr) {
      console.warn('[Playtester] Local GGUF pre-match plan skipped:', planErr);
    }

    // 2) Run fast ground-truth MTG rules, mana-pip, blocking, endgame lethal & life-total engine
    onProgress?.(
      54,
      `Simulating ${mode} match rounds & GGUF-directed plays...`,
      `Guided by ${modelLabel}`
    );
    await yieldToEventLoop();
    const baseResult = simulatePlaytestClientSideFallback({
      deckName,
      format,
      resolvedCards: cardsToTest,
      testedListLabel,
      mode,
      opponents,
      botMemoryProfiles,
      extraCardMeta: Array.from(new Set(knownMetaMap.values())),
      resolvedCustomCardsByBotIndex: Object.fromEntries(customCardsByOppIdx.entries()),
      botTacticalDirectives,
    });
    await yieldToEventLoop();

    // 3) Post-Match GGUF Synthesis & Evolutionary Bot Learning Update
    try {
      const submittedLowerMap = new Map<string, string>();
      for (const rc of cardsToTest) {
        if (rc.zone === 'main' || rc.zone === 'commander') {
          submittedLowerMap.set(rc.name.trim().toLowerCase(), rc.name);
        }
      }
      const candidateCutNames = cardsToTest
        .filter((c) => c.zone === 'main' && !c.card?.isLand)
        .sort((a, b) => (b.card?.cmc ?? 0) - (a.card?.cmc ?? 0))
        .slice(0, 14)
        .map((c) => c.name);

      const roundDigest = baseResult.rounds
        .map((rd) => {
          const hp = (rd.lifeTotals || []).map((lt) => `${lt.player}:${lt.life}`).join(' ');
          const botActs = (rd.botPlays || [])
            .map((bp) => {
              const tDelta = bp.targetLifeDelta ?? 0;
              return `${bp.botName}->${bp.targetParticipant}(${tDelta < 0 ? `${tDelta}HP` : bp.boardThreat.split('(')[0].trim()})`;
            })
            .join('; ');
          return `R${rd.roundNumber}: Drew ${rd.cardDrawn} | You[${rd.manaAvailable}M]: ${rd.cardsPlayed.join(', ') || 'Pass'} | Bots: ${botActs} | HP[${hp}]${rd.manaOrTempoIssue !== 'Smooth mana progression.' ? ` | ${rd.manaOrTempoIssue}` : ''}`;
        })
        .join('\n');

      const finalSummaryLine = (baseResult.finalStats?.participants || [])
        .map(
          (p) =>
            `${p.player}: ${p.life}HP/${p.poisonCounters}P/${p.maxCommanderDamage}Cmd${p.eliminatedBy ? `(${p.eliminatedBy} KO)` : ''}`
        )
        .join(' | ');

      const winningLower = (baseResult.finalStats?.winningPlayer || '').trim().toLowerCase();
      const botOutcomeContext = activeOpponents
        .map((opp, idx) => {
          const pStat = baseResult.finalStats?.participants.find(
            (p) => (p.player || '').trim().toLowerCase() === (opp.name || '').trim().toLowerCase()
          );
          const dir = botTacticalDirectives[opp.name] || botTacticalDirectives[opp.name.toLowerCase()];
          const mem = opp.memory;
          const prevDirectives = (mem?.tacticalDirectives || []).slice(0, 2).join('; ');
          const botOutcome = pStat?.eliminatedBy
            ? `ELIMINATED (${pStat.eliminatedBy} KO)`
            : winningLower === opp.name.trim().toLowerCase() && baseResult.outcome === 'loss'
            ? 'WON MATCH'
            : `SURVIVED (${pStat?.life ?? startingLife} HP)`;
          return `- "${opp.name}" (Idx ${idx}): IQ ${mem?.botIqScore ?? 100}, Games ${mem?.matchesPlayed ?? 0} | MatchOutcome: ${botOutcome}${dir ? ` | TestedPlan: [${dir.posture}/${dir.manaPlan}/Target:${dir.priorityTarget || 'auto'}/Answer:${dir.keyThreatToAnswer || 'none'}]` : ''}${prevDirectives ? ` | AlreadyKnows: ${prevDirectives.slice(0, 90)}` : ''}`;
        })
        .join('\n');

      const synthesisPrompt = `/no_think
Review this completed ${format} ${mode} match for "${deckName}" (Cmdr: ${commanderNames.join(', ') || 'None'}, Plan: ${playerBlueprint.primaryPlan}) and synthesize evolutionary bot learning insights.
Opening 7 (${baseResult.mulliganVerdict}): [${baseResult.openingHand.join(', ')}]
Match Rounds:
${roundDigest}
Result: ${baseResult.outcome.toUpperCase()} | Leader/Winner: ${baseResult.finalStats?.winningPlayer || 'N/A'} (${baseResult.finalStats?.winCondition || 'points-lead'}) | Final: ${finalSummaryLine}
BOT LEARNING CONTEXT & TESTED STRATEGIES:
${botOutcomeContext}
High-MV/Swap Candidates in Player Deck: [${candidateCutNames.join(', ')}]

Instructions:
- matchSummary: 2-3 crisp sentences citing actual turning points, spells, and winning vector.
- mulliganVerdict: 1 sentence evaluating the real opening hand.
- roundNotes: brief mana/tempo diagnosis for any pivotal or stalled rounds (max 6 entries).
- keyTakeaways: 3 concrete cut/add/swap deck improvements (for cutCardName use exact card names from High-MV/Swap Candidates or "" if action="add"; for addCardName use real MTG staples or "" if action="cut").
${
  autoLearnEnabled
    ? `- botLearnings: 1 entry per active bot (${activeOpponents.map((o) => `"${o.name}"`).join(', ')}):
  * lessonFromPlayerDeck: specific player card/curve threat learned in this game.
  * lessonFromOwnDeck: evaluate how this bot's deck + TestedPlan performed.
  * tacticalAdjustment: new concrete adjustment for future matches (do NOT duplicate AlreadyKnows).
  * adaptationSummary: connect prior IQ/record + this match outcome into forward adaptation.
  * identifiedThreats: 1-3 actual nonland card names from Player deck observed as threats.
  * observedWeakness: concise exploitable player weakness if observed (or "").`
    : '- botLearnings: [] (auto-learning from simulated matches is disabled; keep empty array).'
}`;

      const synthesis = await generateJsonWithLocalGguf<{
        matchSummary?: string;
        mulliganVerdict?: string;
        roundNotes?: Array<{ roundNumber?: number; manaOrTempoIssue?: string }>;
        keyTakeaways?: Array<{
          action?: 'cut' | 'add' | 'swap';
          cutCardName?: string;
          addCardName?: string;
          reason?: string;
          urgency?: 'critical' | 'recommended';
        }>;
        botLearnings?: BotMatchLearningInsight[];
      }>({
        systemInstruction:
          'You are an expert MTG playtest analyst and adaptive bot-learning coach. Output strictly valid JSON matching the schema.',
        prompt: synthesisPrompt,
        maxTokens: 820,
        temperature: 0.25,
        jsonSchema: LOCAL_SYNTHESIS_SCHEMA,
        schemaCacheKey: 'playtest-synthesis-v2',
        disableThinking: true,
        timeoutMs: synthesisTimeoutMs,
        onProgress: ({ phase, charsGenerated, estimatedMaxChars }) => {
          if (phase === 'loading') {
            onProgress?.(56, `Loading ${modelLabel} (.gguf) into memory...`);
          } else {
            const ratio = Math.min(1, charsGenerated / Math.max(500, estimatedMaxChars * 0.7));
            const pct = Math.min(92, Math.round(58 + ratio * 34));
            onProgress?.(
              pct,
              autoLearnEnabled
                ? `Synthesizing match analysis & GGUF bot learning with ${modelLabel}...`
                : `Synthesizing match analysis with ${modelLabel}...`,
              charsGenerated > 0 ? `${charsGenerated.toLocaleString()} chars` : undefined
            );
          }
        },
      });

      const roundNoteMap = new Map<number, string>();
      for (const rn of synthesis?.roundNotes || []) {
        if (typeof rn?.roundNumber === 'number' && typeof rn?.manaOrTempoIssue === 'string' && rn.manaOrTempoIssue.trim()) {
          roundNoteMap.set(rn.roundNumber, rn.manaOrTempoIssue.trim());
        }
      }

      const validatedTakeaways = (Array.isArray(synthesis?.keyTakeaways) ? synthesis.keyTakeaways : [])
        .map((tk) => {
          const action: 'cut' | 'add' | 'swap' =
            tk?.action === 'cut' || tk?.action === 'add' || tk?.action === 'swap' ? tk.action : 'swap';
          const rawCut = typeof tk?.cutCardName === 'string' ? tk.cutCardName.trim() : '';
          const matchedCut = rawCut ? submittedLowerMap.get(rawCut.toLowerCase()) : undefined;
          const rawAdd = typeof tk?.addCardName === 'string' ? tk.addCardName.trim() : '';
          const reason = typeof tk?.reason === 'string' ? tk.reason.trim() : '';
          if (!reason) return null;
          if (action === 'cut' && !matchedCut) return null;
          if (action === 'swap' && (!matchedCut || !rawAdd)) return null;
          if (action === 'add' && !rawAdd) return null;
          return {
            action,
            cutCardName: matchedCut,
            addCardName: rawAdd || undefined,
            reason,
            urgency: tk?.urgency === 'critical' ? ('critical' as const) : ('recommended' as const),
          };
        })
        .filter((x): x is NonNullable<typeof x> => Boolean(x));

      const mergedRounds = baseResult.rounds.map((rd) => {
        const note = roundNoteMap.get(rd.roundNumber);
        return note ? { ...rd, manaOrTempoIssue: note } : rd;
      });

      const mergedLearnings: BotMatchLearningInsight[] =
        Array.isArray(synthesis?.botLearnings) && synthesis.botLearnings.length > 0
          ? activeOpponents
              .map((opp, idx): BotMatchLearningInsight | null => {
                const found =
                  synthesis.botLearnings?.find(
                    (bl) => (bl?.botName || '').trim().toLowerCase() === opp.name.trim().toLowerCase()
                  ) || synthesis.botLearnings?.[idx];
                const fallback = baseResult.botLearnings?.[idx];
                if (found && found.lessonFromPlayerDeck && found.tacticalAdjustment) {
                  return {
                    botName: opp.name,
                    lessonFromPlayerDeck: found.lessonFromPlayerDeck.trim(),
                    lessonFromOwnDeck:
                      (found.lessonFromOwnDeck || '').trim() || fallback?.lessonFromOwnDeck || '',
                    tacticalAdjustment: found.tacticalAdjustment.trim(),
                    adaptationSummary:
                      (found.adaptationSummary || '').trim() || fallback?.adaptationSummary || '',
                    identifiedThreats: Array.isArray(found.identifiedThreats)
                      ? found.identifiedThreats
                          .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
                          .map((t) => t.trim())
                          .slice(0, 3)
                      : undefined,
                    observedWeakness:
                      typeof found.observedWeakness === 'string' && found.observedWeakness.trim()
                        ? found.observedWeakness.trim()
                        : undefined,
                    sourceEngine: 'local-gguf',
                  };
                }
                return fallback
                  ? {
                      ...fallback,
                      sourceEngine: preMatchPlanSucceeded ? 'local-gguf' : 'deterministic',
                    }
                  : null;
              })
              .filter((x): x is BotMatchLearningInsight => x !== null)
          : (baseResult.botLearnings || []).map((bl) => ({
              ...bl,
              sourceEngine: preMatchPlanSucceeded ? ('local-gguf' as const) : ('deterministic' as const),
            }));

      const finalGgufResult: PlaytestResult = {
        ...baseResult,
        aiEngineUsed: 'local-gguf' as const,
        aiModelLabel: modelLabel,
        ggufLearningApplied: autoLearnEnabled,
        matchSummary:
          typeof synthesis?.matchSummary === 'string' && synthesis.matchSummary.trim().length > 20
            ? synthesis.matchSummary.trim()
            : baseResult.matchSummary,
        mulliganVerdict:
          typeof synthesis?.mulliganVerdict === 'string' && synthesis.mulliganVerdict.trim().length > 10
            ? synthesis.mulliganVerdict.trim()
            : baseResult.mulliganVerdict,
        rounds: mergedRounds,
        keyTakeaways:
          validatedTakeaways.length > 0 ? validatedTakeaways : baseResult.keyTakeaways,
        botLearnings: autoLearnEnabled ? mergedLearnings : [],
      };
      persistMatchMovesToTrainingFile(finalGgufResult, 'local-gguf', botTacticalDirectives);
      return finalGgufResult;
    } catch (localErr) {
      console.warn('[Playtester] Local GGUF synthesis fallback to match summary:', localErr);
      const fallbackEngine = preMatchPlanSucceeded ? ('local-gguf' as const) : ('deterministic' as const);
      const fallbackGgufResult: PlaytestResult = {
        ...baseResult,
        botLearnings: autoLearnEnabled ? baseResult.botLearnings : [],
        aiEngineUsed: fallbackEngine,
        aiModelLabel: preMatchPlanSucceeded ? modelLabel : undefined,
        ggufLearningApplied: autoLearnEnabled && preMatchPlanSucceeded,
      };
      persistMatchMovesToTrainingFile(fallbackGgufResult, fallbackEngine, botTacticalDirectives);
      return fallbackGgufResult;
    }
  }

  if (!parsed) {
    if (!shouldUseCloudGemini()) {
      return runDeterministicPlaytest();
    }
    onProgress?.(42, `Simulating ${totalRounds} rounds (${mode}) with AI bots...`);
    const ai = getGeminiClient();
    const response = await withGeminiRetry(() =>
      ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: PLAYTEST_SCHEMA,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      })
    );

    const rawText = (response.text ?? '{}').trim();
    parsed = JSON.parse(rawText) as ParsedPlaytestPayload;
  }

  onProgress?.(91, 'Reconciling life totals, commander damage, poison & mill...');

  const indignanceByBotName = new Map<string, BotIndignanceLevel>(
    activeOpponents.map((opp) => [(opp.name || '').trim().toLowerCase(), opp.indignance])
  );
  const commanderByBotName = new Map<string, string>(
    activeOpponents.map((opp) => [(opp.name || '').trim().toLowerCase(), opp.bias.defaultCommanderName])
  );

  const rawRounds = Array.isArray(parsed.rounds) ? parsed.rounds : [];
  const enrichedRounds = rawRounds.map((round, roundIdx) => {
    const safeLifeTotals = Array.isArray(round?.lifeTotals) ? round.lifeTotals : [];
    const safeBotPlays = Array.isArray(round?.botPlays) ? round.botPlays : [];
    const safeHand = Array.isArray(round?.handSnapshot) ? round.handSnapshot : [];
    const safePlayed = Array.isArray(round?.cardsPlayed) ? round.cardsPlayed : [];
    const safeChanges = Array.isArray(round?.roundChanges) ? round.roundChanges : [];
    return {
      ...round,
      roundNumber: typeof round?.roundNumber === 'number' ? round.roundNumber : roundIdx + 1,
      handSnapshot: safeHand,
      cardsPlayed: safePlayed,
      roundChanges: safeChanges,
      lifeTotals: safeLifeTotals.map((lt) => ({
        ...lt,
        player: typeof lt?.player === 'string' ? lt.player : 'You',
      })),
      botPlays: safeBotPlays.map((bp, idx) => ({
        ...bp,
        botName:
          typeof bp?.botName === 'string' && bp.botName.trim()
            ? bp.botName
            : activeOpponents[idx]?.name || `Bot ${idx + 1}`,
        commanderName:
          bp?.commanderName ||
          commanderByBotName.get((typeof bp?.botName === 'string' ? bp.botName : '').trim().toLowerCase()) ||
          activeOpponents[idx]?.bias.defaultCommanderName,
        indignance:
          indignanceByBotName.get((typeof bp?.botName === 'string' ? bp.botName : '').trim().toLowerCase()) ||
          activeOpponents[idx]?.indignance ||
          'measured',
      })),
    };
  });

  // Enforce strict arithmetic consistency for HP, Poison, Commander Damage per Bot, Mill & Library
  const reconciled = reconcilePlaytestMatchStats({
    rounds: enrichedRounds,
    startingLife,
    format,
    mode,
    playerMainDeckCount: mainDeckCount,
    playerOpeningHandSize: openingHand.length,
    playerCommanderNames: commanderNames,
    opponents: activeOpponents.map((opp) => ({
      name: opp.name,
      archetype: opp.customDeckText?.trim() ? 'Custom Decklist' : opp.archetype,
      commanderName: formatRules.allowsCommandZone ? opp.bias.defaultCommanderName : '',
      deckSize: opp.deckSize,
      openingHandSize: opp.botDraws?.openingHand.length ?? 7,
    })),
    reportedOutcome: parsed.outcome,
  });

  // Ensure every match resolves to ONE sole surviving winner (CR 104.2a)
  const aliveAfterGemini = (reconciled.finalStats?.participants || []).filter(
    (p) => !p.eliminatedBy
  );
  let finalRounds = reconciled.rounds;
  let finalStats = reconciled.finalStats;
  let finalOutcome = reconciled.outcome;
  let finalMatchSummary = parsed.matchSummary || '';
  let finalBotLearnings = Array.isArray(parsed.botLearnings) ? parsed.botLearnings : [];

  if (aliveAfterGemini.length > 1) {
    onProgress?.(95, `Resolving endgame combat until a single sole winner remains...`);
    const continued = continueSimulationToSoleWinner({
      deckName,
      format,
      resolvedCards: cardsToTest,
      testedListLabel,
      mode,
      opponents,
      botMemoryProfiles,
      extraCardMeta: Array.from(new Set(knownMetaMap.values())),
      resolvedCustomCardsByBotIndex: Object.fromEntries(customCardsByOppIdx.entries()),
      initialRounds: reconciled.rounds,
    });
    finalRounds = continued.rounds;
    finalStats = continued.finalStats;
    finalOutcome = continued.outcome;
    if (finalMatchSummary.trim()) {
      finalMatchSummary = `${finalMatchSummary.trim()} Endgame continued through Round ${finalRounds.length} (${finalStats.winCondition} KO): Sole winner is ${finalStats.winningPlayer}.`;
    } else {
      finalMatchSummary = continued.matchSummary;
    }
    if (finalBotLearnings.length === 0 && continued.botLearnings.length > 0) {
      finalBotLearnings = continued.botLearnings;
    }
  }

  const fallbackLearnings: BotMatchLearningInsight[] = activeOpponents.map((opp) => ({
    botName: opp.name,
    lessonFromPlayerDeck: `Tracked ${deckName}'s key curves and ${formatRules.allowsCommandZone ? `Commander threats (${commanderNames.join(', ') || 'primary engines'})` : 'primary threats'}.`,
    lessonFromOwnDeck: `Refined mana & spell sequencing while piloting ${opp.customDeckText?.trim() ? 'Custom Decklist' : opp.archetype}.`,
    tacticalAdjustment: `Prioritize interaction against ${commanderNames[0] || deckName} during mid-game turns.`,
    adaptationSummary:
      opp.memory && opp.memory.matchesPlayed > 0
        ? `Applied ${opp.memory.matchesPlayed} prior simulated games (IQ ${opp.memory.botIqScore}, ${opp.briefing.winRatePct}% historical win rate).`
        : 'Completed baseline calibration against this decklist.',
  }));

  const finalGeminiResult: PlaytestResult = {
    mode,
    testedListLabel,
    startingLife,
    outcome: finalOutcome,
    totalRounds: finalRounds.length || totalRounds,
    matchSummary: finalMatchSummary,
    openingHand,
    mulliganVerdict: parsed.mulliganVerdict || '',
    aiEngineUsed: 'cloud-gemini',
    ggufLearningApplied: false,
    opponentsUsed: activeOpponents.map((opp) => ({
      name: opp.name,
      archetype: opp.customDeckText?.trim() ? 'Custom Decklist' : opp.archetype,
      indignance: opp.indignance,
    })),
    rounds: finalRounds,
    keyTakeaways: Array.isArray(parsed.keyTakeaways) ? parsed.keyTakeaways : [],
    botLearnings: autoLearnEnabled
      ? finalBotLearnings.length > 0
        ? finalBotLearnings
        : fallbackLearnings
      : [],
    finalStats,
  };
  persistMatchMovesToTrainingFile(finalGeminiResult, 'cloud-gemini');
  return finalGeminiResult;
}
