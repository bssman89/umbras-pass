import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  BotLearningProfile,
  BotMatchLearningInsight,
  BotOpponentConfig,
  LiveBotAiDirective,
  LiveBotAiTurnDecision,
  PlaytestMode,
} from '../src/types/deck.ts';
import { getBotIndignanceMeta } from '../src/utils/botIndignance.ts';
import { getBotIntelligenceMeta } from '../src/utils/botIntelligence.ts';
import {
  buildBotPastPlayBriefing,
  resolveBotLearningKey,
} from '../src/utils/botLearning.ts';
import {
  loadBotTrainingData,
  recordBotTrainingMatchOutcomes,
  type BotMoveOutcomeRecord,
} from './desktopStorage.ts';
import { withGeminiRetry } from './geminiRetry.ts';
import {
  generateJsonWithLocalGguf,
  getActiveLocalModelInfo,
  getActiveLocalModelLabel,
  isAutoLearnFromMatchesEnabled,
  shouldUseCloudGemini,
  shouldUseDeterministicOnly,
  shouldUseLocalGguf,
} from './localAi.ts';

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

function clampStr(val: unknown, maxLen: number, fallback = ''): string {
  if (typeof val !== 'string') return fallback;
  const trimmed = val.trim();
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
}

function clampNum(val: unknown, min: number, max: number, fallback: number): number {
  if (typeof val !== 'number' || !Number.isFinite(val)) return fallback;
  return Math.max(min, Math.min(max, val));
}

export interface LiveBotPlanRequest {
  format: string;
  mode: PlaytestMode;
  playerDeck: {
    deckName: string;
    archetype: string;
    commanderNames?: string[];
    keyThreats?: string[];
    avgCmc?: number;
  };
  opponents: BotOpponentConfig[];
  botMemoryProfiles?: BotLearningProfile[];
}

export interface LiveBotPlanResponse {
  engineUsed: 'local-gguf' | 'cloud-gemini' | 'deterministic';
  modelLabel: string;
  directivesByBot: Record<string, LiveBotAiDirective>;
}

const LIVE_PLAN_GGUF_SCHEMA: Record<string, unknown> = {
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
          openingStrategy: { type: 'string' },
        },
      },
    },
  },
};

export async function planLiveBotMatch(input: LiveBotPlanRequest): Promise<LiveBotPlanResponse> {
  const format = clampStr(input.format, 40, 'commander');
  const mode: PlaytestMode =
    input.mode === '1v1' || input.mode === '1v2' || input.mode === '1v3' ? input.mode : '1v3';
  const opponents = Array.isArray(input.opponents) ? input.opponents.slice(0, 4) : [];
  const botMemoryProfiles = Array.isArray(input.botMemoryProfiles) ? input.botMemoryProfiles : [];

  if (opponents.length === 0 || shouldUseDeterministicOnly()) {
    return {
      engineUsed: 'deterministic',
      modelLabel: 'Deterministic MTG Rules',
      directivesByBot: {},
    };
  }

  const memoryByKey = new Map<string, BotLearningProfile>();
  for (const mem of botMemoryProfiles) {
    if (mem?.botKey) memoryByKey.set(mem.botKey, mem);
  }

  const trainingStore = loadBotTrainingData();
  const playerDeckName = clampStr(input.playerDeck?.deckName, 120, 'Your Deck');
  const playerArchetype = clampStr(input.playerDeck?.archetype, 100, 'Midrange');
  const playerCmds = Array.isArray(input.playerDeck?.commanderNames)
    ? input.playerDeck.commanderNames.slice(0, 2).map((n) => clampStr(n, 80)).filter(Boolean)
    : [];
  const playerThreats = Array.isArray(input.playerDeck?.keyThreats)
    ? input.playerDeck.keyThreats.slice(0, 5).map((n) => clampStr(n, 80)).filter(Boolean)
    : [];

  const oppDossiers = opponents
    .map((opp) => {
      const botKey = resolveBotLearningKey(opp);
      const mem = memoryByKey.get(botKey);
      const briefing = buildBotPastPlayBriefing(mem, playerDeckName);
      const intelMeta = getBotIntelligenceMeta(opp.intelligence);
      const indMeta = getBotIndignanceMeta(opp.indignance);
      const agg = trainingStore.strategies[botKey];

      let trainingLine = '';
      if (agg && agg.movesRecorded > 0) {
        const postures = Object.entries(agg.postureStats || {})
          .map(([p, st]) => {
            const wr = st.moves > 0 ? Math.round((st.wins / st.moves) * 100) : 0;
            return `${p}:${wr}%WR`;
          })
          .join(', ');
        const winMove = agg.recentWinningMoves?.[0]?.slice(0, 80) || '';
        const avoidMove = agg.recentLosingMoves?.[0]?.slice(0, 80) || '';
        trainingLine = `bot_training.json(${agg.movesRecorded} moves, ${agg.wins}W-${agg.losses}L): [${postures}]${winMove ? ` Best:${winMove}` : ''}${avoidMove ? ` Avoid:${avoidMove}` : ''}`;
      }

      const coaching = (mem?.userFeedbackNotes || []).slice(0, 2).join(' | ');
      const priorDirs = (mem?.tacticalDirectives || []).slice(0, 2).join(' | ');
      const deckType = opp.customDeckText?.trim() ? 'Custom Decklist' : clampStr(opp.archetype, 90);

      return [
        `- "${clampStr(opp.name, 60)}" | Deck: ${deckType} | Intelligence: ${intelMeta.label} | Indignance: ${indMeta.label}`,
        `  History: ${briefing.summaryText.slice(0, 220)}`,
        priorDirs ? `  PriorDirectives: ${priorDirs.slice(0, 140)}` : '',
        coaching ? `  UserCoaching: ${coaching.slice(0, 140)}` : '',
        trainingLine ? `  ${trainingLine}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');

  const podNames = opponents.map((o) => clampStr(o.name, 60)).join(', ');
  const prompt = `/no_think
Configure live-game MTG opening tactical directives for ${format} ${mode} tabletop match.
Player Seat: "${playerDeckName}" (${playerArchetype}, Cmdr: ${playerCmds.join(', ') || 'None'}, Known Threats: ${playerThreats.join(', ') || 'Standard curve'}).
Bot Seats: [${podNames}]
BOT DOSSIERS:
${oppDossiers}

Rules:
- Respect each bot's historical learning, user coaching feedback, bot_training.json posture win-rates, intelligence tier, and indignance setting.
- priorityTarget: In 1v2/1v3 multiplayer pods, choose "table-leader", a specific rival bot name when warranted, or "You" when appropriate (never mindlessly tunnel "You" unless Vindictive or coached).
- posture: aggressive | balanced | defensive.
- manaPlan: hold-interaction (leave mana open for counterspells/removal) or tap-out-pressure.
- openingStrategy: <= 14 word live opening-turn gameplan.`;

  const systemInstruction =
    'You are an adaptive Magic: The Gathering live-game AI coordinator. Output strict JSON configuring each bot opponent strategy from memory and matchup reads.';

  const normalizeDirectives = (
    items: Array<Partial<LiveBotAiDirective>> | undefined
  ): Record<string, LiveBotAiDirective> => {
    const out: Record<string, LiveBotAiDirective> = {};
    for (const item of items || []) {
      const bName = clampStr(item?.botName, 80);
      if (!bName) continue;
      const dir: LiveBotAiDirective = {
        botName: bName,
        priorityTarget: clampStr(item.priorityTarget, 80) || undefined,
        posture:
          item.posture === 'aggressive' ||
          item.posture === 'balanced' ||
          item.posture === 'defensive'
            ? item.posture
            : undefined,
        manaPlan:
          item.manaPlan === 'hold-interaction' || item.manaPlan === 'tap-out-pressure'
            ? item.manaPlan
            : undefined,
        winVectorFocus:
          item.winVectorFocus === 'auto' ||
          item.winVectorFocus === 'life' ||
          item.winVectorFocus === 'poison' ||
          item.winVectorFocus === 'commander' ||
          item.winVectorFocus === 'mill'
            ? item.winVectorFocus
            : undefined,
        keyThreatToAnswer: clampStr(item.keyThreatToAnswer, 80) || undefined,
        focusTag: clampStr(item.focusTag, 90) || undefined,
        appliedMemoryReason: clampStr(item.appliedMemoryReason, 100) || undefined,
        openingStrategy: clampStr(item.openingStrategy, 120) || undefined,
      };
      out[bName] = dir;
      out[bName.toLowerCase()] = dir;
    }
    return out;
  };

  if (shouldUseLocalGguf()) {
    const modelLabel = getActiveLocalModelLabel() || 'Local GGUF Model';
    const modelInfo = getActiveLocalModelInfo();
    const timeoutMs = modelInfo.isCpuOnly
      ? modelInfo.tier === '27b'
        ? 35000
        : modelInfo.tier === '8b'
        ? 25000
        : 18000
      : 15000;
    try {
      const res = await generateJsonWithLocalGguf<{
        botDirectives?: Array<Partial<LiveBotAiDirective>>;
      }>({
        systemInstruction,
        prompt,
        maxTokens: 320,
        temperature: 0.25,
        jsonSchema: LIVE_PLAN_GGUF_SCHEMA,
        schemaCacheKey: 'live-bot-plan-v1',
        disableThinking: true,
        timeoutMs,
      });
      return {
        engineUsed: 'local-gguf',
        modelLabel,
        directivesByBot: normalizeDirectives(res?.botDirectives),
      };
    } catch (err) {
      console.warn('[LiveBotAi] Local GGUF pre-match plan fallback:', err);
      return {
        engineUsed: 'local-gguf',
        modelLabel,
        directivesByBot: {},
      };
    }
  }

  if (shouldUseCloudGemini()) {
    try {
      const ai = getGeminiClient();
      const response = await withGeminiRetry(() =>
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: prompt,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                botDirectives: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      botName: { type: Type.STRING },
                      priorityTarget: { type: Type.STRING },
                      posture: { type: Type.STRING },
                      manaPlan: { type: Type.STRING },
                      winVectorFocus: { type: Type.STRING },
                      keyThreatToAnswer: { type: Type.STRING },
                      focusTag: { type: Type.STRING },
                      appliedMemoryReason: { type: Type.STRING },
                      openingStrategy: { type: Type.STRING },
                    },
                    required: ['botName', 'posture', 'manaPlan'],
                  },
                },
              },
              required: ['botDirectives'],
            },
          },
        })
      );
      const parsed = JSON.parse((response.text ?? '{}').trim()) as {
        botDirectives?: Array<Partial<LiveBotAiDirective>>;
      };
      return {
        engineUsed: 'cloud-gemini',
        modelLabel: 'Cloud Gemini AI',
        directivesByBot: normalizeDirectives(parsed?.botDirectives),
      };
    } catch (err) {
      console.warn('[LiveBotAi] Cloud Gemini pre-match plan fallback:', err);
    }
  }

  return {
    engineUsed: 'deterministic',
    modelLabel: 'Deterministic MTG Rules',
    directivesByBot: {},
  };
}

export interface LiveBotTurnRequest {
  turnNumber: number;
  format: string;
  mode: PlaytestMode;
  activeBot: {
    id: string;
    name: string;
    archetype: string;
    intelligence: string;
    indignance: string;
    life: number;
    poison: number;
    landsInPlay: number;
    tappedLands: number;
    availableMana: number;
    commanderName: string;
    commanderCost: number;
    commanderInZone: boolean;
    handCount: number;
    handCards: Array<{
      name: string;
      cmc: number;
      category: string;
      power?: number;
      toughness?: number;
    }>;
    creatures: Array<{
      name: string;
      power: number;
      toughness: number;
      tapped: boolean;
      keywords?: string[];
    }>;
    grudgeScore: number;
    observedUserThreats: string[];
    observedUserHabits: string[];
    aiDirective?: LiveBotAiDirective;
  };
  playerBoard: {
    life: number;
    poison: number;
    landsCount: number;
    untappedLandsCount: number;
    handCount: number;
    hasCommanderInPlay: boolean;
    creatures: Array<{
      name: string;
      power: number;
      toughness: number;
      tapped: boolean;
      isCommander: boolean;
      hexproof?: boolean;
      indestructible?: boolean;
      flying?: boolean;
      reach?: boolean;
    }>;
  };
  rivalBots: Array<{
    name: string;
    life: number;
    poison: number;
    landsInPlay: number;
    creatures: Array<{
      name: string;
      power: number;
      toughness: number;
      tapped: boolean;
      isCommander: boolean;
      hexproof?: boolean;
    }>;
  }>;
}

const LIVE_TURN_GGUF_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    posture: { enum: ['aggressive', 'balanced', 'defensive'] },
    priorityTarget: { type: 'string' },
    holdManaForInteraction: { type: 'boolean' },
    recommendedSpellName: { type: 'string' },
    removalTargetSeat: { type: 'string' },
    removalTargetCreatureName: { type: 'string' },
    attackPlan: { enum: ['all-out', 'safe-evasion', 'hold-blockers'] },
    strategyThought: { type: 'string' },
  },
  required: ['posture', 'holdManaForInteraction', 'attackPlan', 'strategyThought'],
};

export async function decideLiveBotTurn(
  input: LiveBotTurnRequest
): Promise<LiveBotAiTurnDecision> {
  if (shouldUseDeterministicOnly() || !input?.activeBot?.name) {
    return {
      engineUsed: 'deterministic',
      modelLabel: 'Deterministic MTG Rules',
      fallback: true,
    };
  }

  const bot = input.activeBot;
  const turnNumber = clampNum(input.turnNumber, 1, 99, 1);
  const format = clampStr(input.format, 32, 'commander');
  const mode = clampStr(input.mode, 8, '1v3');

  const handLines = (Array.isArray(bot.handCards) ? bot.handCards : [])
    .slice(0, 12)
    .map(
      (c) =>
        `${clampStr(c.name, 60)} (MV ${clampNum(c.cmc, 0, 20, 0)}, ${clampStr(c.category, 24)}${
          c.power !== undefined ? `, ${c.power}/${c.toughness ?? 2}` : ''
        })`
    );

  const botCreatures = (Array.isArray(bot.creatures) ? bot.creatures : [])
    .slice(0, 12)
    .map(
      (c) =>
        `${clampStr(c.name, 50)} ${c.power}/${c.toughness}${c.tapped ? '[Tapped]' : ''}${
          c.keywords?.length ? `[${c.keywords.slice(0, 3).join(',')}]` : ''
        }`
    );

  const playerCreatures = (Array.isArray(input.playerBoard?.creatures)
    ? input.playerBoard.creatures
    : []
  )
    .slice(0, 14)
    .map(
      (c) =>
        `${clampStr(c.name, 50)} ${c.power}/${c.toughness}${c.tapped ? '[Tapped]' : '[Up]'}${
          c.isCommander ? '[Cmdr]' : ''
        }${c.hexproof ? '[Hexproof]' : ''}`
    );

  const rivalSummary = (Array.isArray(input.rivalBots) ? input.rivalBots : [])
    .slice(0, 3)
    .map((r) => {
      const rc = (r.creatures || [])
        .slice(0, 6)
        .map((c) => `${clampStr(c.name, 40)} ${c.power}/${c.toughness}${c.tapped ? '[T]' : ''}${c.isCommander ? '[C]' : ''}`)
        .join(', ');
      return `Rival "${clampStr(r.name, 50)}": ${r.life}HP/${r.poison}Psn, ${r.landsInPlay}L, Creatures[${rc || 'None'}]`;
    })
    .join('\n');

  const directiveStr = bot.aiDirective
    ? `Directive: posture=${bot.aiDirective.posture || 'balanced'}, manaPlan=${bot.aiDirective.manaPlan || 'auto'}, target=${bot.aiDirective.priorityTarget || 'auto'}, focus=${bot.aiDirective.focusTag || ''}`
    : '';

  const prompt = `/no_think
Turn ${turnNumber} (${format} ${mode}) MTG tactical turn decision for bot "${clampStr(bot.name, 60)}".
Bot Profile: ${clampStr(bot.archetype, 80)} | Intelligence: ${clampStr(bot.intelligence, 24)} | Indignance: ${clampStr(bot.indignance, 24)} | GrudgeVsYou: ${clampNum(bot.grudgeScore, 0, 100, 0)}
${directiveStr}
Your Public+Private State: ${bot.life}HP/${bot.poison}Psn | EstAvailMana: ${bot.availableMana} (Lands ${bot.landsInPlay}) | Commander: ${bot.commanderInZone && bot.commanderName ? `${bot.commanderName} in CmdZone (Cost ${bot.commanderCost})` : 'On board/inactive'}
Bot Hand (${bot.handCount} cards): ${handLines.length > 0 ? handLines.join('; ') : `Synthetic ${bot.archetype} hand`}
Bot Board: ${botCreatures.join(', ') || 'Empty'}
Public Threats: Player "You" -> ${input.playerBoard.life}HP/${input.playerBoard.poison}Psn, ${input.playerBoard.landsCount}L (${input.playerBoard.untappedLandsCount} untapped open mana), ${input.playerBoard.handCount}H, Creatures[${playerCreatures.join(', ') || 'None'}]
${rivalSummary || 'No other bots.'}
Memory Threats: ${(bot.observedUserThreats || []).slice(0, 4).join(', ') || 'None'} | Habits: ${(bot.observedUserHabits || []).slice(0, 2).join('; ') || 'None'}

Choose optimal legal MTG strategy:
- priorityTarget: "You" OR exact rival bot name above (never target a dead seat; in 1v2/1v3 spread pressure to leading/open threats!).
- recommendedSpellName: pick 1 highest-value affordable card name from Bot Hand or Commander above (or "" if archetype deck).
- removalTargetSeat & removalTargetCreatureName: non-hexproof creature to answer if holding removal (or "").
- holdManaForInteraction: true only if leaving 2+ mana up for instant interaction is stronger than tapping out.
- attackPlan: "all-out" (lethal/high pressure), "safe-evasion" (only favorable/unblocked hits), or "hold-blockers" (defend crackback).
- strategyThought: <= 14 word clear strategic reasoning.`;

  const systemInstruction =
    'You are the tactical MTG brain piloting a live AI bot opponent. Enforce paper MTG mechanics (summoning sickness, hexproof, open mana bluffs, crackback defense, multiplayer threat politics). Output strict JSON.';

  const sanitizeDecision = (
    raw: Partial<LiveBotAiTurnDecision>,
    engineUsed: 'local-gguf' | 'cloud-gemini',
    modelLabel: string
  ): LiveBotAiTurnDecision => ({
    engineUsed,
    modelLabel,
    fallback: false,
    posture:
      raw.posture === 'aggressive' || raw.posture === 'balanced' || raw.posture === 'defensive'
        ? raw.posture
        : undefined,
    priorityTarget: clampStr(raw.priorityTarget, 60) || undefined,
    holdManaForInteraction:
      typeof raw.holdManaForInteraction === 'boolean' ? raw.holdManaForInteraction : undefined,
    recommendedSpellName: clampStr(raw.recommendedSpellName, 80) || undefined,
    removalTargetSeat: clampStr(raw.removalTargetSeat, 60) || undefined,
    removalTargetCreatureName: clampStr(raw.removalTargetCreatureName, 80) || undefined,
    attackPlan:
      raw.attackPlan === 'all-out' ||
      raw.attackPlan === 'safe-evasion' ||
      raw.attackPlan === 'hold-blockers'
        ? raw.attackPlan
        : undefined,
    strategyThought: clampStr(raw.strategyThought, 140) || undefined,
  });

  if (shouldUseLocalGguf()) {
    const modelLabel = getActiveLocalModelLabel() || 'Local GGUF Model';
    const modelInfo = getActiveLocalModelInfo();
    const turnTimeoutMs = modelInfo.isCpuOnly
      ? modelInfo.tier === '27b'
        ? 16000
        : modelInfo.tier === '8b'
        ? 12000
        : 9500
      : 8000;
    try {
      const res = await generateJsonWithLocalGguf<Partial<LiveBotAiTurnDecision>>({
        systemInstruction,
        prompt,
        maxTokens: 190,
        temperature: 0.2,
        jsonSchema: LIVE_TURN_GGUF_SCHEMA,
        schemaCacheKey: 'live-bot-turn-v1',
        disableThinking: true,
        timeoutMs: turnTimeoutMs,
      });
      return sanitizeDecision(res || {}, 'local-gguf', modelLabel);
    } catch (err) {
      console.warn('[LiveBotAi] Live turn GGUF timeout/fallback:', err);
      return {
        engineUsed: 'local-gguf',
        modelLabel,
        fallback: true,
      };
    }
  }

  if (shouldUseCloudGemini()) {
    try {
      const ai = getGeminiClient();
      const response = await withGeminiRetry(() =>
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: prompt,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                posture: { type: Type.STRING },
                priorityTarget: { type: Type.STRING },
                holdManaForInteraction: { type: Type.BOOLEAN },
                recommendedSpellName: { type: Type.STRING },
                removalTargetSeat: { type: Type.STRING },
                removalTargetCreatureName: { type: Type.STRING },
                attackPlan: { type: Type.STRING },
                strategyThought: { type: Type.STRING },
              },
              required: ['posture', 'holdManaForInteraction', 'attackPlan', 'strategyThought'],
            },
          },
        })
      );
      const parsed = JSON.parse((response.text ?? '{}').trim()) as Partial<LiveBotAiTurnDecision>;
      return sanitizeDecision(parsed, 'cloud-gemini', 'Cloud Gemini AI');
    } catch (err) {
      console.warn('[LiveBotAi] Live turn Gemini fallback:', err);
      return {
        engineUsed: 'cloud-gemini',
        modelLabel: 'Cloud Gemini AI',
        fallback: true,
      };
    }
  }

  return {
    engineUsed: 'deterministic',
    modelLabel: 'Deterministic MTG Rules',
    fallback: true,
  };
}

export interface LiveBotLearnBotSummary {
  botId: string;
  botName: string;
  archetype: string;
  customDeckText?: string;
  deckIdentitySummary: string;
  endingBotLife: number;
  eliminated: boolean;
  eliminatedReason: 'life' | 'poison' | 'commander' | 'mill' | null;
  observedUserThreats: string[];
  observedUserHabits: string[];
  adaptationHistory: string[];
  damageDealtToPlayer: number;
  damageTakenFromPlayer: number;
  damageDealtToRivals: number;
  damageTakenFromRivals: number;
  biggestRivalThreatName: string;
  spellsCastCount: number;
  creaturesPlayedCount: number;
  commanderDamageDealtToYou: number;
  lastPosture?: string;
  lastTargetName?: string;
  lastActionSummary?: string;
}

export interface LiveBotLearnRequest {
  format: string;
  mode: PlaytestMode;
  outcome: 'victory' | 'defeat' | 'unfinished';
  turnsPlayed: number;
  endingPlayerLife: number;
  playerDeckLabel: string;
  playerArchetype: string;
  playerCommanders: string[];
  bots: LiveBotLearnBotSummary[];
  opponents?: BotOpponentConfig[];
}

export interface LiveBotLearnResponse {
  engineUsed: 'local-gguf' | 'cloud-gemini' | 'deterministic';
  modelLabel: string;
  autoLearnEnabled: boolean;
  trainingRecorded: boolean;
  botLearnings: BotMatchLearningInsight[];
}

const LIVE_LEARN_GGUF_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
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
        required: ['botName', 'lessonFromPlayerDeck', 'tacticalAdjustment'],
      },
    },
  },
};

export async function synthesizeLiveBotLearnings(
  input: LiveBotLearnRequest
): Promise<LiveBotLearnResponse> {
  const autoLearnEnabled = isAutoLearnFromMatchesEnabled();
  const bots = Array.isArray(input.bots) ? input.bots.slice(0, 4) : [];
  const oppById = new Map((input.opponents || []).map((o) => [o.id, o]));
  const format = clampStr(input.format, 32, 'commander');
  const mode: PlaytestMode =
    input.mode === '1v1' || input.mode === '1v2' || input.mode === '1v3' ? input.mode : '1v3';
  const turnsPlayed = clampNum(input.turnsPlayed, 1, 99, 1);
  const playerDeckLabel = clampStr(input.playerDeckLabel, 120, 'Your Deck');
  const playerArchetype = clampStr(input.playerArchetype, 90, 'Midrange');
  const playerCommanders = Array.isArray(input.playerCommanders)
    ? input.playerCommanders.slice(0, 2).map((c) => clampStr(c, 80)).filter(Boolean)
    : [];

  const activeEngine: 'local-gguf' | 'cloud-gemini' | 'deterministic' = shouldUseLocalGguf()
    ? 'local-gguf'
    : shouldUseCloudGemini()
    ? 'cloud-gemini'
    : 'deterministic';
  const modelLabel =
    activeEngine === 'local-gguf'
      ? getActiveLocalModelLabel() || 'Local GGUF Model'
      : activeEngine === 'cloud-gemini'
      ? 'Cloud Gemini AI'
      : 'Deterministic MTG Rules';

  // Record structured live game outcomes to persistent bot_training.json
  let trainingRecorded = false;
  if (autoLearnEnabled && bots.length > 0) {
    try {
      const moves: Array<Omit<BotMoveOutcomeRecord, 'id' | 'timestampIso'>> = bots.map((b) => {
        const opp = oppById.get(b.botId) || {
          id: b.botId,
          name: b.botName,
          archetype: b.archetype,
          customDeckText: b.customDeckText,
        };
        const botKey = resolveBotLearningKey(opp);
        const matchOutcomeForBot: 'win' | 'loss' | 'close' =
          input.outcome === 'defeat' && !b.eliminated
            ? 'win'
            : input.outcome === 'victory' || b.eliminated
            ? 'loss'
            : 'close';
        return {
          botKey,
          botName: clampStr(b.botName, 60),
          archetype: b.customDeckText?.trim() ? 'Custom Decklist' : clampStr(b.archetype, 80),
          format,
          mode,
          playerDeckName: `[Live] ${playerDeckLabel}`,
          roundNumber: turnsPlayed,
          action: clampStr(
            b.lastActionSummary ||
              `Live ${turnsPlayed}T match (${b.spellsCastCount} spells, ${b.damageDealtToPlayer} player dmg, ${b.damageDealtToRivals} rival dmg)`,
            180
          ),
          targetParticipant: clampStr(b.lastTargetName || 'You', 60),
          targetLifeDelta: -Math.abs(clampNum(b.damageDealtToPlayer + b.damageDealtToRivals, 0, 500, 0)),
          targetPoisonDelta: b.eliminatedReason === 'poison' ? 1 : 0,
          targetCommanderDamage: clampNum(b.commanderDamageDealtToYou, 0, 200, 0),
          targetMillAmount: 0,
          boardWipeCast: b.adaptationHistory.some((h) => /wipe/i.test(h)),
          creaturesRemoved: 0,
          postureUsed: b.lastPosture || 'balanced',
          manaPlanUsed: b.adaptationHistory.some((h) => /hold|open mana/i.test(h))
            ? 'hold-interaction'
            : 'tap-out-pressure',
          appliedMemoryReason: clampStr(b.adaptationHistory[0] || '', 140) || undefined,
          matchOutcomeForBot,
          engineUsed: activeEngine,
        };
      });
      if (moves.length > 0) {
        recordBotTrainingMatchOutcomes({ moves });
        trainingRecorded = true;
      }
    } catch (err) {
      console.warn('[LiveBotAi] Failed to persist live match into bot_training.json:', err);
    }
  }

  if (!autoLearnEnabled || bots.length === 0 || activeEngine === 'deterministic') {
    return {
      engineUsed: activeEngine,
      modelLabel,
      autoLearnEnabled,
      trainingRecorded,
      botLearnings: [],
    };
  }

  const botDigest = bots
    .map(
      (b) =>
        `- "${clampStr(b.botName, 60)}" (${clampStr(b.deckIdentitySummary, 100)}): FinalHP=${b.endingBotLife}${
          b.eliminated ? ` [ELIMINATED by ${b.eliminatedReason || 'life'}]` : ''
        } | Spells=${b.spellsCastCount}, Creatures=${b.creaturesPlayedCount}, DmgToPlayer=${b.damageDealtToPlayer}, DmgTakenFromPlayer=${b.damageTakenFromPlayer}, DmgToRivals=${b.damageDealtToRivals}, DmgFromRivals=${b.damageTakenFromRivals}${
          b.biggestRivalThreatName ? ` (TopRival: ${b.biggestRivalThreatName})` : ''
        } | ObservedThreats=[${b.observedUserThreats.slice(0, 5).join(', ')}] | Habits=[${b.observedUserHabits.slice(0, 3).join('; ')}] | KeyAdaptations=[${b.adaptationHistory.slice(0, 3).join(' | ')}]`
    )
    .join('\n');

  const prompt = `/no_think
Review this completed LIVE human-vs-AI ${format} ${mode} tabletop match and synthesize evolutionary bot learning insights for each bot's persistent memory.
Player Deck: "${playerDeckLabel}" (${playerArchetype}, Cmdr: ${playerCommanders.join(', ') || 'None'})
Outcome for Player: ${input.outcome.toUpperCase()} after ${turnsPlayed} turns (Player Final HP: ${input.endingPlayerLife}).
BOT TELEMETRY:
${botDigest}

For every bot, write sharp, concrete post-game MTG takeaways so it plays smarter in future matches:
- lessonFromPlayerDeck: what did the player deck & commander actually threaten?
- lessonFromOwnDeck: what worked or failed in this bot's own tempo/mana/creatures?
- tacticalAdjustment: concrete rule/timing adjustment for next match (e.g., hold removal for commander, pressure rival faster, save board wipe).
- adaptationSummary: 1-sentence summary of how the bot evolved from this game.
- identifiedThreats: up to 3 high-priority card/commander names seen.
- observedWeakness: concrete exploitable habit or mana/defense weakness if seen.`;

  const systemInstruction =
    'You are an evolutionary MTG coach updating persistent AI bot memory after a live tabletop game. Output strict JSON.';

  const normalizeLearnings = (
    items: Array<Partial<BotMatchLearningInsight>> | undefined
  ): BotMatchLearningInsight[] => {
    if (!Array.isArray(items)) return [];
    return bots
      .map((b, idx): BotMatchLearningInsight | null => {
        const found =
          items.find(
            (it) => clampStr(it?.botName, 60).toLowerCase() === b.botName.trim().toLowerCase()
          ) || items[idx];
        if (!found?.lessonFromPlayerDeck || !found?.tacticalAdjustment) return null;
        return {
          botName: b.botName,
          lessonFromPlayerDeck: clampStr(found.lessonFromPlayerDeck, 240),
          lessonFromOwnDeck: clampStr(
            found.lessonFromOwnDeck,
            240,
            `Piloted ${b.deckIdentitySummary} across ${turnsPlayed} live turns.`
          ),
          tacticalAdjustment: clampStr(found.tacticalAdjustment, 240),
          adaptationSummary: clampStr(
            found.adaptationSummary,
            240,
            `Updated live matchup reads vs ${playerDeckLabel}.`
          ),
          identifiedThreats: Array.isArray(found.identifiedThreats)
            ? found.identifiedThreats
                .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
                .map((t) => t.trim().slice(0, 70))
                .slice(0, 3)
            : undefined,
          observedWeakness: clampStr(found.observedWeakness, 160) || undefined,
          sourceEngine: activeEngine,
        };
      })
      .filter((x): x is BotMatchLearningInsight => x !== null);
  };

  if (activeEngine === 'local-gguf') {
    const modelInfo = getActiveLocalModelInfo();
    const timeoutMs = modelInfo.isCpuOnly
      ? modelInfo.tier === '27b'
        ? 45000
        : modelInfo.tier === '8b'
        ? 30000
        : 22000
      : 18000;
    try {
      const res = await generateJsonWithLocalGguf<{
        botLearnings?: Array<Partial<BotMatchLearningInsight>>;
      }>({
        systemInstruction,
        prompt,
        maxTokens: 520,
        temperature: 0.25,
        jsonSchema: LIVE_LEARN_GGUF_SCHEMA,
        schemaCacheKey: 'live-bot-learn-v1',
        disableThinking: true,
        timeoutMs,
      });
      return {
        engineUsed: 'local-gguf',
        modelLabel,
        autoLearnEnabled,
        trainingRecorded,
        botLearnings: normalizeLearnings(res?.botLearnings),
      };
    } catch (err) {
      console.warn('[LiveBotAi] Local GGUF live learning synthesis skipped:', err);
      return {
        engineUsed: 'local-gguf',
        modelLabel,
        autoLearnEnabled,
        trainingRecorded,
        botLearnings: [],
      };
    }
  }

  if (activeEngine === 'cloud-gemini') {
    try {
      const ai = getGeminiClient();
      const response = await withGeminiRetry(() =>
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: prompt,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                botLearnings: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      botName: { type: Type.STRING },
                      lessonFromPlayerDeck: { type: Type.STRING },
                      lessonFromOwnDeck: { type: Type.STRING },
                      tacticalAdjustment: { type: Type.STRING },
                      adaptationSummary: { type: Type.STRING },
                      identifiedThreats: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                      },
                      observedWeakness: { type: Type.STRING },
                    },
                    required: ['botName', 'lessonFromPlayerDeck', 'tacticalAdjustment'],
                  },
                },
              },
              required: ['botLearnings'],
            },
          },
        })
      );
      const parsed = JSON.parse((response.text ?? '{}').trim()) as {
        botLearnings?: Array<Partial<BotMatchLearningInsight>>;
      };
      return {
        engineUsed: 'cloud-gemini',
        modelLabel,
        autoLearnEnabled,
        trainingRecorded,
        botLearnings: normalizeLearnings(parsed?.botLearnings),
      };
    } catch (err) {
      console.warn('[LiveBotAi] Cloud Gemini live learning synthesis skipped:', err);
    }
  }

  return {
    engineUsed: activeEngine,
    modelLabel,
    autoLearnEnabled,
    trainingRecorded,
    botLearnings: [],
  };
}
