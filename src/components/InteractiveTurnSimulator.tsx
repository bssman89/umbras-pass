import React, { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  BookOpen,
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Coins,
  Crown,
  Droplets,
  FastForward,
  Flag,
  Flame,
  Layers,
  LayoutGrid,
  List,
  Loader2,
  Maximize2,
  Minimize2,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Shield,
  ShieldAlert,
  Shuffle,
  Skull,
  Sliders,
  Sparkles,
  Swords,
  Timer,
  Trophy,
  Zap,
} from 'lucide-react';
import type {
  BotLearningProfile,
  BotMatchLearningInsight,
  BotOpponentConfig,
  CardMetadata,
  DeckAnalysisResult,
  LiveBotAiDirective,
  LiveBotAiTurnDecision,
  LiveSimulationExportStats,
  ManaColor,
  PlaytestMode,
  PlaytestResult,
  ResolvedDeckCard,
} from '../types/deck';
import {
  autoRecognizeCommandersClientSide,
  parseDecklistClientSide,
} from '../utils/clientFallbackAnalyzer';
import {
  applyLiveGameLearningsToBotProfiles,
  mergeAiLearningsIntoLiveProfiles,
} from '../utils/botLearning';
import {
  detectArchetypeCombatBias,
  detectCardMechanics,
  getFormatSimulationRules,
} from '../utils/playtestReconciler';
import {
  applyAiDirectivesToLiveBots,
  createInitialLiveBots,
  createLiveBotZoneCardFromCreature,
  evaluateBotCounterWarResponse,
  executeBotPostStackCombat,
  executeBotTurn,
  extractCreatureKeywords,
  formatCreatureKeywordTags,
  pushLiveBotZoneCard,
  recordUserActionForBots,
  resolveBotBlocksForPlayerAttack,
  resolveIncomingAttackCombat,
  type BotTurnPhaseStep,
  type LiveBotCreature,
  type LiveBotState,
  type LivePlayerDeckContext,
  type LiveUserActionEvent,
  type PendingBotAttack,
  type PendingBotStackSpell,
  type PlayerBoardSnapshot,
} from '../utils/liveBotEngine';
import {
  classifyCardStackProfile,
  createStackItemFromBotSpell,
  createStackItemId,
  extractPermanentActivatedAbilities,
  getEffectiveInstantCost,
  isSpellUncounterable,
  type ActivatedAbilityOption,
  type StackItem,
} from '../utils/liveStackEngine';
import {
  buildHoverRect,
  CardHoverZoomOverlay,
  type HoveredCardPreview,
} from './CardHoverZoomOverlay';
import { CardLink } from './CardInspectorModal';
import { DeckShuffleAnimation } from './DeckShuffleAnimation';
import {
  InterruptResponseBanner,
  type InterruptWindowMode,
} from './InterruptResponseBanner';
import {
  getEffectivePermanentStats,
  LiveTabletopArena,
  playTabletopSound,
  type TabletopTokenBlueprint,
} from './LiveTabletopArena';
import {
  LiveMatchSetupLobby,
  type FirstPlayerSelection,
} from './LiveMatchSetupLobby';
import { PlaytestVisualBoard } from './PlaytestVisualBoard';
import {
  TabletopStackPanel,
  type StackCastResponseOptions,
} from './TabletopStackPanel';

export type GamePhase = 'Untap' | 'Upkeep' | 'Draw' | 'Main' | 'Combat' | 'End';

const PHASES: GamePhase[] = ['Untap', 'Upkeep', 'Draw', 'Main', 'Combat', 'End'];

const PHASE_HINTS: Record<GamePhase, string> = {
  Untap: 'All your tapped lands and permanents untap for the new turn.',
  Upkeep: 'Resolve any beginning-of-upkeep triggers, scry effects, or upkeep costs.',
  Draw: 'Draw 1 card for your turn (automatically drawn once per turn on entry).',
  Main: 'Play up to 1 land per turn, tap lands for mana, and cast spells or your Commander.',
  Combat: 'Select attacking creatures or your Commander, pick an opponent, and deal damage.',
  End: 'Resolve end-step triggers, empty unspent mana, and pass priority to start the next turn.',
};

const PHASE_STEP_SUBTITLES: Record<GamePhase, string> = {
  Untap: 'Reset board',
  Upkeep: 'Triggers',
  Draw: 'Draw 1 card',
  Main: 'Lands & spells',
  Combat: 'Attack / block',
  End: 'Cleanup & pass',
};

const MANA_KEYS: Array<{
  color: ManaColor;
  label: string;
  textClass: string;
  borderClass: string;
}> = [
  { color: 'W', label: 'W', textClass: 'text-amber-800', borderClass: 'border-amber-200' },
  { color: 'U', label: 'U', textClass: 'text-sky-700', borderClass: 'border-sky-200' },
  { color: 'B', label: 'B', textClass: 'text-zinc-800', borderClass: 'border-zinc-300' },
  { color: 'R', label: 'R', textClass: 'text-red-700', borderClass: 'border-red-200' },
  { color: 'G', label: 'G', textClass: 'text-emerald-700', borderClass: 'border-emerald-200' },
  { color: 'C', label: 'C', textClass: 'text-zinc-600', borderClass: 'border-zinc-200' },
];

interface SimCardInstance {
  uid: string;
  name: string;
  cmc: number;
  typeLine: string;
  isLand: boolean;
  isCreature: boolean;
  isCommander: boolean;
  isArtifactOrRock: boolean;
  producedMana: ManaColor[];
  power: number;
  toxicValue: number;
  hasInfect: boolean;
  extraDrawCount: number;
  lifegainAmount: number;
  meta: CardMetadata | null;
}

interface BattlefieldPermanent extends SimCardInstance {
  tapped: boolean;
  attacking: boolean;
  summoningSick: boolean;
  isToken?: boolean;
  tokenAbility?: 'treasure' | 'food' | 'clue' | 'blood' | 'none';
  baseToughness?: number;
  plusOneCounters?: number;
  minusOneCounters?: number;
  otherCounters?: Record<string, number>;
  protectedUntilEot?: boolean;
  tempPowerBoost?: number;
  tempToughnessBoost?: number;
}

interface OpponentTrackerState {
  id: string;
  name: string;
  archetype: string;
  commanderName: string;
  life: number;
  poison: number;
  commanderDamageTakenFromYou: number;
  commanderDamageDealtToYou: number;
}

interface TurnLogEntry {
  id: string;
  turn: number;
  phase: GamePhase;
  message: string;
}

type ManaPoolState = Record<ManaColor, number>;

const EMPTY_POOL: ManaPoolState = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

function formatClockMs(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatDurationSummaryMs(ms: number): string {
  const safeMs = Math.max(0, ms);
  if (safeMs < 60_000) {
    return `${(safeMs / 1000).toFixed(1)}s`;
  }
  const totalSec = Math.round(safeMs / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}m ${String(secs).padStart(2, '0')}s`;
}

function inferProducedMana(name: string, meta: CardMetadata | null): ManaColor[] {
  if (meta?.producedMana && meta.producedMana.length > 0) {
    const valid = meta.producedMana.filter((c): c is ManaColor =>
      ['W', 'U', 'B', 'R', 'G', 'C'].includes(c)
    );
    if (valid.length > 0) return valid;
  }
  const lower = name.toLowerCase();
  if (/plains/.test(lower)) return ['W'];
  if (/island/.test(lower)) return ['U'];
  if (/swamp/.test(lower)) return ['B'];
  if (/mountain/.test(lower)) return ['R'];
  if (/forest/.test(lower)) return ['G'];
  if (/sol ring|ancient tomb|temple of the false god|reliquary|wastes/.test(lower)) return ['C'];
  if (/command tower|arcane signet|exotic orchard|fellwar stone|city of brass|mana confluence/.test(lower)) {
    return ['W', 'U', 'B', 'R', 'G'];
  }
  return ['C'];
}

function isLikelyLandCard(name: string, meta: CardMetadata | null): boolean {
  if (meta) return meta.isLand;
  return /\b(plains|island|swamp|mountain|forest|wastes|command tower|exotic orchard|evolving wilds|terramorphic expanse|temple|shrine|fountain|tomb|foundry|pool|grounds|crypt|vents|garden|sanctuary|citadel|triome)\b/i.test(
    name
  );
}

function isLikelyManaRock(name: string, meta: CardMetadata | null): boolean {
  const lower = name.toLowerCase();
  if (meta?.isRamp && /artifact/i.test(meta.typeLine)) return true;
  return /\b(sol ring|arcane signet|fellwar stone|signet|talisman|mana crypt|mana vault|chrome mox|mox|mind stone|thought vessel|commander's sphere|chromatic lantern)\b/i.test(
    lower
  );
}

function shuffleInstances<T>(list: T[]): T[] {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function sumManaPool(pool: ManaPoolState): number {
  return pool.W + pool.U + pool.B + pool.R + pool.G + pool.C;
}

function parseCostColors(manaCost: string): { pips: Partial<ManaPoolState>; generic: number } {
  const pips: Partial<ManaPoolState> = {};
  let generic = 0;
  const tokens = manaCost.match(/\{([^}]+)\}/g) || [];
  for (const tok of tokens) {
    const inner = tok.slice(1, -1).toUpperCase();
    if (/^\d+$/.test(inner)) {
      generic += Number(inner);
    } else if (inner === 'W' || inner === 'U' || inner === 'B' || inner === 'R' || inner === 'G' || inner === 'C') {
      pips[inner] = (pips[inner] || 0) + 1;
    } else if (inner.includes('/')) {
      // Hybrid or Phyrexian pip -> treat as 1 generic/flexible if not pure single color
      generic += 1;
    }
  }
  return { pips, generic };
}

function deductManaFromPool(
  pool: ManaPoolState,
  manaCost: string,
  totalCost: number
): ManaPoolState | null {
  if (sumManaPool(pool) < totalCost) return null;
  const next: ManaPoolState = { ...pool };
  const { pips } = parseCostColors(manaCost);

  let remainingToPay = totalCost;
  for (const c of ['W', 'U', 'B', 'R', 'G', 'C'] as ManaColor[]) {
    const needed = pips[c] || 0;
    const paid = Math.min(next[c], needed);
    next[c] -= paid;
    remainingToPay -= paid;
  }

  // Pay remaining generic cost cleanly starting from colorless then colored mana
  for (const c of ['C', 'W', 'U', 'B', 'R', 'G'] as ManaColor[]) {
    if (remainingToPay <= 0) break;
    const take = Math.min(next[c], remainingToPay);
    next[c] -= take;
    remainingToPay -= take;
  }

  return remainingToPay <= 0 ? next : null;
}

interface InteractiveTurnSimulatorProps {
  analysis: DeckAnalysisResult;
  optimizedDeckText: string;
  effectiveUserCards?: ResolvedDeckCard[];
  useOptimizedList: boolean;
  deckVersionLabel?: string;
  mode: PlaytestMode;
  opponents: BotOpponentConfig[];
  onModeChange?: (nextMode: PlaytestMode) => void;
  onUpdateOpponentsForMode?: (nextOpponents: BotOpponentConfig[]) => void;
  findMeta: (name: string) => CardMetadata | null;
  onInspectCard: (name: string, meta?: CardMetadata | null) => void;
  liveVsBotsNonce?: number;
  playtestResult?: PlaytestResult | null;
  activeRoundIdx?: number;
  onSelectRound?: (idx: number) => void;
  playAreaMode?: 'live' | 'replay';
  onPlayAreaModeChange?: (nextMode: 'live' | 'replay') => void;
  onRunBotMatch?: () => void;
  isSimulatingBotMatch?: boolean;
  onLiveStatsChange?: (stats: LiveSimulationExportStats) => void;
  botMemory?: Record<string, BotLearningProfile>;
  onSaveBotMemoryProfiles?: (profiles: BotLearningProfile[]) => void;
  autoLearnEnabled?: boolean;
}

export const InteractiveTurnSimulator: React.FC<InteractiveTurnSimulatorProps> = ({
  analysis,
  optimizedDeckText,
  effectiveUserCards,
  useOptimizedList,
  deckVersionLabel,
  mode,
  opponents,
  onModeChange,
  onUpdateOpponentsForMode,
  findMeta,
  onInspectCard,
  liveVsBotsNonce = 0,
  playtestResult = null,
  activeRoundIdx = 0,
  onSelectRound,
  playAreaMode: controlledPlayAreaMode,
  onPlayAreaModeChange,
  onRunBotMatch,
  isSimulatingBotMatch = false,
  onLiveStatsChange,
  botMemory,
  onSaveBotMemoryProfiles,
  autoLearnEnabled = true,
}) => {
  const [internalPlayAreaMode, setInternalPlayAreaMode] = useState<'live' | 'replay'>('live');
  const activePlayAreaMode = controlledPlayAreaMode ?? internalPlayAreaMode;
  const setActivePlayAreaMode = (nextMode: 'live' | 'replay') => {
    if (onPlayAreaModeChange) {
      onPlayAreaModeChange(nextMode);
    } else {
      setInternalPlayAreaMode(nextMode);
    }
  };
  const effectiveVersionLabel =
    deckVersionLabel || (useOptimizedList ? 'Optimized List' : 'Original Upload');
  const format = analysis.metrics?.detectedFormat || 'commander';
  const baseCardCount = useMemo(
    () =>
      (effectiveUserCards && effectiveUserCards.length > 0
        ? effectiveUserCards
        : analysis.resolvedCards || []
      )
        .filter((c) => c.zone === 'main' || c.zone === 'commander')
        .reduce((s, c) => s + c.quantity, 0),
    [effectiveUserCards, analysis.resolvedCards]
  );
  const formatRules = useMemo(
    () => getFormatSimulationRules(format, mode, baseCardCount),
    [format, mode, baseCardCount]
  );
  const [customStartingLife, setCustomStartingLife] = useState<number | null>(null);
  const prevDefaultStartingLifeRef = React.useRef<number>(formatRules.startingLife);
  useEffect(() => {
    if (prevDefaultStartingLifeRef.current !== formatRules.startingLife) {
      prevDefaultStartingLifeRef.current = formatRules.startingLife;
      setCustomStartingLife(null);
    }
  }, [formatRules.startingLife]);
  const startingLife = customStartingLife ?? formatRules.startingLife;

  const activeDeckCards = useMemo<ResolvedDeckCard[]>(() => {
    let cards: ResolvedDeckCard[];
    if (effectiveUserCards && effectiveUserCards.length > 0) {
      cards = effectiveUserCards;
    } else if (!useOptimizedList || !optimizedDeckText.trim()) {
      cards = analysis.resolvedCards || [];
    } else {
      const reparsed = parseDecklistClientSide(optimizedDeckText);
      if (reparsed.cards.length === 0) {
        cards = analysis.resolvedCards || [];
      } else {
        cards = reparsed.cards.map((c) => ({
          ...c,
          card: findMeta(c.name),
        }));
        if (formatRules.allowsCommandZone) {
          autoRecognizeCommandersClientSide(cards, format);
        }
      }
    }
    if (!formatRules.allowsCommandZone) {
      return cards.map((c) => (c.zone === 'commander' ? { ...c, zone: 'main' as const } : c));
    }
    return cards;
  }, [effectiveUserCards, analysis.resolvedCards, optimizedDeckText, useOptimizedList, findMeta, format, formatRules.allowsCommandZone]);

  const deckFingerprint = useMemo(
    () =>
      `${analysis.deckName || ''}|${format}|${effectiveVersionLabel}|` +
      activeDeckCards
        .map((c) => `${c.zone}:${c.quantity}:${c.name}`)
        .join(','),
    [analysis.deckName, format, effectiveVersionLabel, activeDeckCards]
  );

  const loadedCommandersLabel = useMemo(
    () =>
      activeDeckCards
        .filter((c) => c.zone === 'commander')
        .map((c) => c.name)
        .join(' & '),
    [activeDeckCards]
  );

  const buildDeckZones = () => {
    const commanders: SimCardInstance[] = [];
    const mainLibrary: SimCardInstance[] = [];
    let uidCounter = 1;

    for (const item of activeDeckCards) {
      const meta = item.card || findMeta(item.name);
      const isLand = isLikelyLandCard(item.name, meta);
      const mech = detectCardMechanics(item.name, meta);
      const isCreature =
        /\bcreature\b/i.test(meta?.typeLine || '') || item.zone === 'commander';
      const isArtifactOrRock = isLikelyManaRock(item.name, meta);
      const producedMana = inferProducedMana(item.name, meta);

      for (let q = 0; q < Math.max(1, item.quantity); q++) {
        const isCmd = formatRules.allowsCommandZone && item.zone === 'commander';
        const instance: SimCardInstance = {
          uid: `card-${uidCounter++}`,
          name: item.name,
          cmc: meta?.cmc ?? (isLand ? 0 : 2),
          typeLine: meta?.typeLine || (isLand ? 'Land' : 'Spell'),
          isLand,
          isCreature,
          isCommander: isCmd,
          isArtifactOrRock,
          producedMana,
          power: isCreature
            ? meta?.power !== undefined
              ? mech.estimatedPower
              : Math.max(2, mech.estimatedPower || 3)
            : 0,
          toxicValue: mech.toxicValue,
          hasInfect: mech.hasInfect,
          extraDrawCount: mech.extraDrawCount,
          lifegainAmount: mech.lifegainAmount,
          meta,
        };
        if (isCmd) {
          commanders.push(instance);
        } else if (item.zone === 'main' || (!formatRules.allowsCommandZone && item.zone === 'commander')) {
          mainLibrary.push(instance);
        }
      }
    }

    const shuffled = shuffleInstances(mainLibrary);
    const openingHand = shuffled.splice(0, Math.min(7, shuffled.length));
    return { commanders, openingHand, library: shuffled };
  };

  const resolveOppBias = (opp: BotOpponentConfig) => {
    if (!opp.customDeckText || !opp.customDeckText.trim()) {
      return detectArchetypeCombatBias(opp, [], format);
    }
    const parsedBot = parseDecklistClientSide(opp.customDeckText);
    let resolvedCustomCards: ResolvedDeckCard[] = parsedBot.cards.map((c) => ({
      ...c,
      card: findMeta(c.name),
    }));
    if (formatRules.allowsCommandZone) {
      const totalQty = resolvedCustomCards
        .filter((c) => c.zone === 'main' || c.zone === 'commander')
        .reduce((s, c) => s + c.quantity, 0);
      const botFmt =
        resolvedCustomCards.some((c) => c.zone === 'commander') || totalQty >= 85
          ? format === 'brawl'
            ? 'brawl'
            : 'commander'
          : format;
      autoRecognizeCommandersClientSide(resolvedCustomCards, botFmt);
    } else {
      resolvedCustomCards = resolvedCustomCards.map((c) =>
        c.zone === 'commander' ? { ...c, zone: 'main' as const } : c
      );
    }
    return detectArchetypeCombatBias(opp, resolvedCustomCards, format);
  };

  const buildInitialOpponents = (): OpponentTrackerState[] =>
    opponents.map((opp) => {
      const bias = resolveOppBias(opp);
      return {
        id: opp.id,
        name: opp.name,
        archetype: opp.customDeckText?.trim() ? 'Custom Decklist' : opp.archetype,
        commanderName: bias.defaultCommanderName,
        life: startingLife,
        poison: 0,
        commanderDamageTakenFromYou: 0,
        commanderDamageDealtToYou: 0,
      };
    });

  const initialZones = useMemo(() => buildDeckZones(), [activeDeckCards, startingLife]);

  const [turn, setTurn] = useState<number>(1);
  const [cardsDrawnCount, setCardsDrawnCount] = useState<number>(0);
  const [turnsPassedCount, setTurnsPassedCount] = useState<number>(0);
  const [currentTurnElapsedMs, setCurrentTurnElapsedMs] = useState<number>(0);
  const [completedTurnDurations, setCompletedTurnDurations] = useState<
    Array<{ turn: number; durationMs: number }>
  >([]);
  const [isTimerPaused, setIsTimerPaused] = useState<boolean>(false);
  const [simulationEndedManually, setSimulationEndedManually] = useState<boolean>(false);
  const currentTurnElapsedRef = React.useRef<number>(0);
  const lastTickAtRef = React.useRef<number | null>(null);
  const [phaseIdx, setPhaseIdx] = useState<number>(0);
  const [drawnInDrawStep, setDrawnInDrawStep] = useState<boolean>(false);
  const [landsPlayedThisTurn, setLandsPlayedThisTurn] = useState<number>(0);
  const [emptyPoolBetweenPhases, setEmptyPoolBetweenPhases] = useState<boolean>(true);

  const [yourLife, setYourLife] = useState<number>(startingLife);
  const [yourPoison, setYourPoison] = useState<number>(0);
  const [playerCounters, setPlayerCounters] = useState<Record<string, number>>({});
  const [isMonarch, setIsMonarch] = useState<boolean>(false);
  const [manaPool, setManaPool] = useState<ManaPoolState>({ ...EMPTY_POOL });

  const [library, setLibrary] = useState<SimCardInstance[]>(initialZones.library);
  const [hand, setHand] = useState<SimCardInstance[]>(initialZones.openingHand);
  const [lastDrawnUids, setLastDrawnUids] = useState<string[]>([]);
  const [commandZone, setCommandZone] = useState<SimCardInstance[]>(initialZones.commanders);
  const [commanderTaxByUid, setCommanderTaxByUid] = useState<Record<string, number>>({});
  const [battlefield, setBattlefield] = useState<BattlefieldPermanent[]>([]);
  const [graveyard, setGraveyard] = useState<SimCardInstance[]>([]);
  const [exile, setExile] = useState<SimCardInstance[]>([]);

  const playerDeckContext = useMemo<LivePlayerDeckContext>(() => {
    const commanders = activeDeckCards
      .filter((c) => c.zone === 'commander')
      .map((c) => c.name);
    const nonLands = activeDeckCards
      .filter((c) => {
        const meta = c.card || findMeta(c.name);
        return (c.zone === 'main' || c.zone === 'commander') && !meta?.isLand;
      })
      .sort((a, b) => {
        const aCmc = (a.card || findMeta(a.name))?.cmc ?? 3;
        const bCmc = (b.card || findMeta(b.name))?.cmc ?? 3;
        return bCmc - aCmc;
      });
    const lands = activeDeckCards.filter((c) => {
      const meta = c.card || findMeta(c.name);
      return c.zone === 'main' && Boolean(meta?.isLand);
    });
    const landCount = lands.reduce((s, c) => s + c.quantity, 0);
    const tappedLandCount = lands
      .filter((c) => Boolean((c.card || findMeta(c.name))?.entersTappedLikely))
      .reduce((s, c) => s + c.quantity, 0);

    return {
      deckName: analysis.deckName || 'Your Deck',
      archetype: analysis.archetype || 'Midrange / Value',
      format,
      commanderNames: commanders,
      avgCmc: analysis.metrics?.averageCmcNonLand ?? 3.0,
      keyThreats: nonLands.slice(0, 6).map((c) => c.name),
      landCount,
      tappedLandCount,
    };
  }, [activeDeckCards, analysis.deckName, analysis.archetype, analysis.metrics?.averageCmcNonLand, format, findMeta]);

  const [liveBotMode, setLiveBotMode] = useState<boolean>(true);
  const [liveGamePhase, setLiveGamePhase] = useState<'setup' | 'playing'>('setup');
  const [hasStartedLiveGameOnce, setHasStartedLiveGameOnce] = useState<boolean>(false);
  const [firstPlayerChoice, setFirstPlayerChoice] = useState<FirstPlayerSelection>('player');
  const [resolvedFirstSeatIndex, setResolvedFirstSeatIndex] = useState<number>(0);
  const [freeFirstMulligan, setFreeFirstMulligan] = useState<boolean>(true);
  const [mulliganCount, setMulliganCount] = useState<number>(0);
  const openingBotLeadPendingRef = React.useRef<boolean>(false);
  const [guiView, setGuiView] = useState<'tabletop' | 'list'>('tabletop');
  const [soundEnabled, setSoundEnabled] = useState<boolean>(false);
  const [botTurnPace, setBotTurnPace] = useState<'normal' | 'step' | 'fast'>('normal');
  const [liveAiTurnReasoning, setLiveAiTurnReasoning] = useState<boolean>(true);
  const [thinkingBotName, setThinkingBotName] = useState<string | null>(null);
  const [liveAiStatus, setLiveAiStatus] = useState<{
    effectiveEngine: 'local-gguf' | 'cloud-gemini' | 'deterministic';
    activeModelLabel: string;
    autoLearnFromMatches: boolean;
  }>({
    effectiveEngine: 'deterministic',
    activeModelLabel: 'Deterministic MTG Rules',
    autoLearnFromMatches: true,
  });
  const liveAiStatusRef = React.useRef(liveAiStatus);
  liveAiStatusRef.current = liveAiStatus;
  const liveAiTurnReasoningRef = React.useRef(liveAiTurnReasoning);
  liveAiTurnReasoningRef.current = liveAiTurnReasoning;
  const liveMatchEpochRef = React.useRef<number>(1);
  const [isShufflingDeck, setIsShufflingDeck] = useState<boolean>(false);
  const shuffleTimerRef = React.useRef<number | null>(null);
  const liveLearningsSavedRef = React.useRef<boolean>(false);
  const targetsHitThisBotRoundRef = React.useRef<Record<string, number>>({});
  const [liveBots, setLiveBots] = useState<LiveBotState[]>(() =>
    createInitialLiveBots(opponents, startingLife, format, findMeta, botMemory, playerDeckContext)
  );
  const [botQueueIndices, setBotQueueIndices] = useState<number[]>([]);
  const [botRoundTotal, setBotRoundTotal] = useState<number>(0);
  const [activeBotIdx, setActiveBotIdx] = useState<number | null>(null);
  const [botStepAwaitingContinue, setBotStepAwaitingContinue] = useState<boolean>(false);
  const [activeBotTurnBanner, setActiveBotTurnBanner] = useState<{
    botName: string;
    seatNumber: number;
    queuePosition: number;
    queueTotal: number;
    phaseSteps: BotTurnPhaseStep[];
    adaptationNote: string;
    isLastBotInRound: boolean;
  } | null>(null);
  const [pendingIncomingAttack, setPendingIncomingAttack] =
    useState<PendingBotAttack | null>(null);
  const [blockerAssignments, setBlockerAssignments] = useState<
    Record<string, string>
  >({});
  const [stackItems, setStackItems] = useState<StackItem[]>([]);
  const [pendingBotStackContinuation, setPendingBotStackContinuation] =
    useState<PendingBotStackSpell | null>(null);
  const [fullControlPriority, setFullControlPriority] = useState<boolean>(false);
  const [combatFogActive, setCombatFogActive] = useState<boolean>(false);
  const [interruptWindowMode, setInterruptWindowMode] =
    useState<InterruptWindowMode>('12s');
  const [interruptRemainingMs, setInterruptRemainingMs] = useState<number>(0);
  const [interruptTotalMs, setInterruptTotalMs] = useState<number>(0);
  const [interruptTimerHeld, setInterruptTimerHeld] = useState<boolean>(false);
  const [interruptResetNonce, setInterruptResetNonce] = useState<number>(0);
  const hasActiveStack = stackItems.length > 0;

  const [opponentTrackers, setOpponentTrackers] = useState<OpponentTrackerState[]>(
    buildInitialOpponents
  );
  const [selectedCombatTargetId, setSelectedCombatTargetId] = useState<string>(
    opponents[0]?.id || ''
  );
  const [listHoveredCard, setListHoveredCard] = useState<HoveredCardPreview | null>(null);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const wasFullscreenRef = React.useRef<boolean>(false);

  const [turnLog, setTurnLog] = useState<TurnLogEntry[]>([
    {
      id: 'init-0',
      turn: 1,
      phase: 'Untap',
      message: `Shuffled ${initialZones.library.length + initialZones.openingHand.length} main cards, drew opening 7 (${format}, ${startingLife} starting life).`,
    },
  ]);

  useEffect(() => {
    let active = true;
    const refreshLiveAiStatus = () => {
      fetch('/api/desktop/ai-status')
        .then((res) => (res.ok ? res.json() : null))
        .then(
          (
            data: {
              effectiveEngine?: 'local-gguf' | 'cloud-gemini' | 'deterministic';
              activeModelLabel?: string;
              autoLearnFromMatches?: boolean;
            } | null
          ) => {
            if (!active || !data) return;
            setLiveAiStatus({
              effectiveEngine: data.effectiveEngine || 'deterministic',
              activeModelLabel: data.activeModelLabel || 'Deterministic MTG Rules',
              autoLearnFromMatches: data.autoLearnFromMatches !== false,
            });
          }
        )
        .catch(() => {
          // Ignore transient status fetch issues
        });
    };

    refreshLiveAiStatus();
    window.addEventListener('umbras:ai-status-updated', refreshLiveAiStatus);
    return () => {
      active = false;
      window.removeEventListener('umbras:ai-status-updated', refreshLiveAiStatus);
    };
  }, [liveGamePhase]);

  useEffect(() => {
    return () => {
      if (shuffleTimerRef.current !== null) {
        window.clearTimeout(shuffleTimerRef.current);
      }
    };
  }, []);

  // In-program Fullscreen mode: lock background scroll, support Esc to exit, and restore focus smoothly
  useEffect(() => {
    if (!isFullscreen) {
      if (wasFullscreenRef.current) {
        wasFullscreenRef.current = false;
        window.requestAnimationFrame(() => {
          containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      }
      return;
    }

    wasFullscreenRef.current = true;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    containerRef.current?.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Don't exit fullscreen if a higher modal dialog (e.g., Card Inspector or Turn Summary) is open
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      setIsFullscreen(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFullscreen]);

  const triggerDeckShuffleAnimation = (withSound = true) => {
    if (shuffleTimerRef.current !== null) {
      window.clearTimeout(shuffleTimerRef.current);
    }
    setIsShufflingDeck(true);
    if (withSound) {
      playTabletopSound(soundEnabled, 'shuffle');
    }
    shuffleTimerRef.current = window.setTimeout(() => {
      setIsShufflingDeck(false);
      shuffleTimerRef.current = null;
    }, 780);
  };

  const appendLog = (msg: string, t = turn, ph = PHASES[phaseIdx]) => {
    setTurnLog((prev) => [
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, turn: t, phase: ph, message: msg },
      ...prev.slice(0, 49),
    ]);
  };

  const handleShuffleLibrary = () => {
    if (library.length < 2 || botQueueIndices.length > 0 || pendingIncomingAttack || simulationEndedManually || liveMatchOutcome) {
      return;
    }
    setLibrary((prev) => shuffleInstances(prev));
    appendLog(`Shuffled library (${library.length} cards).`);
    triggerDeckShuffleAnimation(true);
  };

  const resetGame = (
    reasonLabel = 'Started new shuffled game',
    animateShuffle = true,
    options?: {
      firstSeatIdx?: number;
      diceSummary?: string;
      triggerOpeningLead?: boolean;
    }
  ) => {
    const zones = buildDeckZones();
    const activeFirstSeat = options?.firstSeatIdx ?? resolvedFirstSeatIndex;
    openingBotLeadPendingRef.current = false;
    setTurn(1);
    setMulliganCount(0);
    setCardsDrawnCount(0);
    setTurnsPassedCount(0);
    currentTurnElapsedRef.current = 0;
    lastTickAtRef.current = null;
    setCurrentTurnElapsedMs(0);
    setCompletedTurnDurations([]);
    setIsTimerPaused(false);
    setSimulationEndedManually(false);
    setPhaseIdx(0);
    setDrawnInDrawStep(false);
    setLandsPlayedThisTurn(0);
    setYourLife(startingLife);
    setYourPoison(0);
    setPlayerCounters({});
    setIsMonarch(false);
    setManaPool({ ...EMPTY_POOL });
    setLibrary(zones.library);
    setHand(zones.openingHand);
    setLastDrawnUids([]);
    setCommandZone(zones.commanders);
    setCommanderTaxByUid({});
    setBattlefield([]);
    setGraveyard([]);
    setExile([]);
    setBotQueueIndices([]);
    setBotRoundTotal(0);
    setActiveBotIdx(null);
    setBotStepAwaitingContinue(false);
    setActiveBotTurnBanner(null);
    setPendingIncomingAttack(null);
    setBlockerAssignments({});
    setStackItems([]);
    setPendingBotStackContinuation(null);
    setCombatFogActive(false);
    setInterruptRemainingMs(0);
    setInterruptTotalMs(0);
    setInterruptTimerHeld(false);
    liveLearningsSavedRef.current = false;
    targetsHitThisBotRoundRef.current = {};
    liveMatchEpochRef.current += 1;
    const matchEpoch = liveMatchEpochRef.current;
    setThinkingBotName(null);
    const nextLiveBots = createInitialLiveBots(
      opponents,
      startingLife,
      format,
      findMeta,
      botMemory,
      playerDeckContext
    );
    setLiveBots(nextLiveBots);
    const nextOpps = buildInitialOpponents();
    setOpponentTrackers(nextOpps);
    setSelectedCombatTargetId(nextOpps[0]?.id || '');

    if (liveBotMode && liveAiStatusRef.current.effectiveEngine !== 'deterministic') {
      void fetch('/api/live-bot/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format,
          mode,
          playerDeck: {
            deckName: playerDeckContext.deckName,
            archetype: playerDeckContext.archetype,
            commanderNames: playerDeckContext.commanderNames,
            keyThreats: playerDeckContext.keyThreats,
            avgCmc: playerDeckContext.avgCmc,
          },
          opponents,
          botMemoryProfiles: Object.values(botMemory || {}),
        }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then(
          (
            planData: {
              engineUsed?: 'local-gguf' | 'cloud-gemini' | 'deterministic';
              modelLabel?: string;
              directivesByBot?: Record<string, LiveBotAiDirective>;
            } | null
          ) => {
            if (!planData || liveMatchEpochRef.current !== matchEpoch) return;
            const label = planData.modelLabel || liveAiStatusRef.current.activeModelLabel;
            const directives = planData.directivesByBot || {};
            if (Object.keys(directives).length === 0 && !label) return;
            setLiveBots((prevBots) => {
              const updated = applyAiDirectivesToLiveBots(prevBots, directives, label);
              latestGameRef.current = {
                ...latestGameRef.current,
                liveBots: updated,
              };
              return updated;
            });
            if (Object.keys(directives).length > 0) {
              appendLog(
                `${label} calibrated pre-game tactics for ${opponents.length} bot opponent${opponents.length === 1 ? '' : 's'}.`,
                1,
                'Untap'
              );
            }
          }
        )
        .catch(() => {
          // Non-fatal fallback to built-in heuristics
        });
    }

    const firstSeatName =
      activeFirstSeat === 0
        ? 'You (Seat 1)'
        : nextLiveBots[activeFirstSeat - 1]?.name
        ? `${nextLiveBots[activeFirstSeat - 1].name} (Seat ${activeFirstSeat + 1})`
        : 'You (Seat 1)';

    const initialLogEntries: TurnLogEntry[] = [
      {
        id: `reset-${Date.now()}`,
        turn: 1,
        phase: 'Untap',
        message: `${reasonLabel} — drew opening 7 (${zones.library.length} left in library, ${startingLife} starting life). Turn order: ${firstSeatName} goes first.`,
      },
    ];
    if (options?.diceSummary) {
      initialLogEntries.unshift({
        id: `dice-${Date.now()}`,
        turn: 1,
        phase: 'Untap',
        message: options.diceSummary,
      });
    }
    setTurnLog(initialLogEntries);

    if (options?.triggerOpeningLead && liveBotMode && activeFirstSeat > 0) {
      const leadQueue: number[] = [];
      for (let i = activeFirstSeat - 1; i < nextLiveBots.length; i += 1) {
        if (!nextLiveBots[i]?.eliminated) {
          leadQueue.push(i);
        }
      }
      if (leadQueue.length > 0) {
        openingBotLeadPendingRef.current = true;
        latestGameRef.current = {
          ...latestGameRef.current,
          liveBots: nextLiveBots,
          battlefield: [],
          library: zones.library,
          hand: zones.openingHand,
          yourLife: startingLife,
          yourPoison: 0,
          turn: 1,
          untappedLandsCount: 0,
        };
        setBotRoundTotal(leadQueue.length);
        setBotQueueIndices(leadQueue);
      }
    }

    if (animateShuffle) {
      triggerDeckShuffleAnimation(true);
    }
  };

  const handleStartConfiguredLiveGame = (firstSeatIdx: number, diceSummary?: string) => {
    const safeFirstSeat =
      firstSeatIdx > 0 && firstSeatIdx <= opponents.length ? firstSeatIdx : 0;
    setResolvedFirstSeatIndex(safeFirstSeat);
    setLiveBotMode(true);
    setHasStartedLiveGameOnce(true);
    setLiveGamePhase('playing');
    resetGame('Started configured live match', true, {
      firstSeatIdx: safeFirstSeat,
      diceSummary,
      triggerOpeningLead: safeFirstSeat > 0,
    });
  };

  const handleMulligan = () => {
    if (
      turn !== 1 ||
      battlefield.length > 0 ||
      botQueueIndices.length > 0 ||
      pendingIncomingAttack ||
      hasActiveStack ||
      simulationEndedManually ||
      liveMatchOutcome
    ) {
      return;
    }
    const nextCount = mulliganCount + 1;
    const penalty = freeFirstMulligan ? Math.max(0, nextCount - 1) : nextCount;
    const targetHandSize = Math.max(3, 7 - penalty);
    const combined = shuffleInstances([...hand, ...library]);
    const nextHand = combined.splice(0, Math.min(targetHandSize, combined.length));
    setHand(nextHand);
    setLibrary(combined);
    setLastDrawnUids(nextHand.map((c) => c.uid));
    setMulliganCount(nextCount);
    const isFree = freeFirstMulligan && nextCount === 1;
    appendLog(
      isFree
        ? `Took Free First Mulligan — reshuffled and drew fresh ${nextHand.length}-card hand.`
        : `Mulligan #${nextCount} — reshuffled and drew ${nextHand.length} cards.`,
      1,
      'Untap'
    );
    triggerDeckShuffleAnimation(true);
  };

  // Switch into Live Play vs Bots when triggered from the top PlaytestArena bar
  const prevNonceRef = React.useRef<number>(liveVsBotsNonce);
  useEffect(() => {
    if (liveVsBotsNonce > prevNonceRef.current) {
      prevNonceRef.current = liveVsBotsNonce;
      setLiveBotMode(true);
      if (!hasStartedLiveGameOnce) {
        setLiveGamePhase('setup');
      } else {
        triggerDeckShuffleAnimation(true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveVsBotsNonce]);

  // Keep opponent trackers & live bots aligned ONLY when opponent configs, mode, startingLife, or meta actually change
  const opponentsSyncKey = useMemo(
    () =>
      JSON.stringify({
        mode,
        startingLife,
        opponents: opponents.map((o) => ({
          id: o.id,
          name: o.name,
          archetype: o.archetype,
          customDeckText: o.customDeckText || '',
          indignance: o.indignance || '',
          intelligence: o.intelligence || '',
        })),
      }),
    [opponents, mode, startingLife]
  );
  const prevOpponentsSyncRef = React.useRef<{
    key: string;
    findMeta: typeof findMeta;
  }>({ key: opponentsSyncKey, findMeta });

  useEffect(() => {
    if (
      prevOpponentsSyncRef.current.key === opponentsSyncKey &&
      prevOpponentsSyncRef.current.findMeta === findMeta
    ) {
      return;
    }
    prevOpponentsSyncRef.current = { key: opponentsSyncKey, findMeta };
    setLiveBots(
      createInitialLiveBots(opponents, startingLife, format, findMeta, botMemory, playerDeckContext)
    );
    setBotQueueIndices([]);
    setBotRoundTotal(0);
    setActiveBotIdx(null);
    setBotStepAwaitingContinue(false);
    setActiveBotTurnBanner(null);
    setPendingIncomingAttack(null);
    setBlockerAssignments({});
    liveLearningsSavedRef.current = false;
    setOpponentTrackers((prev) => {
      const prevById = new Map(prev.map((p) => [p.id, p]));
      return opponents.map((opp) => {
        const existing = prevById.get(opp.id);
        const bias = resolveOppBias(opp);
        return existing
          ? {
              ...existing,
              name: opp.name,
              archetype: opp.customDeckText?.trim() ? 'Custom Decklist' : opp.archetype,
              commanderName: bias.defaultCommanderName,
            }
          : {
              id: opp.id,
              name: opp.name,
              archetype: opp.customDeckText?.trim() ? 'Custom Decklist' : opp.archetype,
              commanderName: bias.defaultCommanderName,
              life: startingLife,
              poison: 0,
              commanderDamageTakenFromYou: 0,
              commanderDamageDealtToYou: 0,
            };
      });
    });
    setSelectedCombatTargetId((cur) =>
      opponents.some((o) => o.id === cur) ? cur : opponents[0]?.id || ''
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opponentsSyncKey, findMeta]);

  // Reset simulator cleanly when switching deck versions, syncing mana optimization, changing Commander, or loading a new deck
  const prevDeckFingerprintRef = React.useRef<string>(deckFingerprint);
  useEffect(() => {
    if (prevDeckFingerprintRef.current === deckFingerprint) {
      return;
    }
    prevDeckFingerprintRef.current = deckFingerprint;
    resetGame(`Loaded ${effectiveVersionLabel}`, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckFingerprint]);

  const activePhase = PHASES[phaseIdx];
  const totalManaPool = sumManaPool(manaPool);
  const untappedLandsCount = battlefield.filter((b) => b.isLand && !b.tapped).length;
  const totalAvailableMana = useMemo(() => {
    const tapperMana = battlefield
      .filter((b) => !b.tapped && (b.isLand || b.isArtifactOrRock))
      .reduce(
        (sum, perm) =>
          sum +
          (/\bsol ring|mana crypt|mana vault|ancient tomb\b/i.test(perm.name) ? 2 : 1),
        0
      );
    return totalManaPool + tapperMana;
  }, [battlefield, totalManaPool]);

  const hasCommanderInPlayNow = battlefield.some((p) => p.isCommander);
  const canRespondAtInstantSpeed = useMemo(() => {
    if (!liveBotMode) return false;
    return hand.some((card) => {
      const profile = classifyCardStackProfile(card.name, card.typeLine, card.meta);
      if (!profile.isInstantSpeed) return false;
      const cost = getEffectiveInstantCost(
        card.name,
        card.cmc,
        hasCommanderInPlayNow,
        profile
      );
      return cost <= totalAvailableMana;
    });
  }, [liveBotMode, hand, hasCommanderInPlayNow, totalAvailableMana]);

  const availableActivatedAbilities = useMemo(
    () => extractPermanentActivatedAbilities(battlefield, totalAvailableMana),
    [battlefield, totalAvailableMana]
  );

  const hasActivatedAbilityResponse = useMemo(
    () => availableActivatedAbilities.some((a) => a.canActivate && a.usesStack),
    [availableActivatedAbilities]
  );

  const interruptAlertsEnabled = liveBotMode && interruptWindowMode !== 'smart-only';
  const totalLandsInPlay = battlefield.filter((b) => b.isLand).length;

  const goToPhase = (targetIdx: number, isNewTurn = false, nextTurnNum = turn) => {
    const targetPhase = PHASES[targetIdx];
    const shouldEmpty = emptyPoolBetweenPhases && (isNewTurn || targetIdx !== phaseIdx);

    if (shouldEmpty && sumManaPool(manaPool) > 0) {
      setManaPool({ ...EMPTY_POOL });
    }

    if (targetPhase === 'Untap' && isNewTurn) {
      let stunReducedNames: string[] = [];
      setBattlefield((prev) =>
        prev.map((perm) => {
          const stunCount = perm.otherCounters?.Stun || 0;
          if (perm.tapped && stunCount > 0) {
            stunReducedNames = [...stunReducedNames, perm.name];
            const nextOther = { ...(perm.otherCounters || {}) };
            if (stunCount - 1 <= 0) {
              delete nextOther.Stun;
            } else {
              nextOther.Stun = stunCount - 1;
            }
            return {
              ...perm,
              tapped: true,
              attacking: false,
              summoningSick: false,
              protectedUntilEot: false,
              tempPowerBoost: 0,
              tempToughnessBoost: 0,
              otherCounters: nextOther,
            };
          }
          return {
            ...perm,
            tapped: false,
            attacking: false,
            summoningSick: false,
            protectedUntilEot: false,
            tempPowerBoost: 0,
            tempToughnessBoost: 0,
          };
        })
      );
      setCombatFogActive(false);
      setLandsPlayedThisTurn(0);
      setDrawnInDrawStep(false);
      appendLog(
        stunReducedNames.length > 0
          ? `Untap step: untapped permanents (removed 1 Stun counter from ${stunReducedNames.join(', ')} instead of untapping).`
          : `Untap step: untapped all permanents.`,
        nextTurnNum,
        'Untap'
      );
    } else if (targetPhase === 'Draw' && !drawnInDrawStep) {
      if (nextTurnNum === 1 && formatRules.playerSkipsTurn1Draw && resolvedFirstSeatIndex === 0) {
        setDrawnInDrawStep(true);
        appendLog('Draw step skipped (1v1 Play/Draw rule — you went first).', nextTurnNum, 'Draw');
      } else {
        setDrawnInDrawStep(true);
        setLibrary((prevLib) => {
          if (prevLib.length === 0) {
            appendLog('Attempted to draw from an empty library!', nextTurnNum, 'Draw');
            return prevLib;
          }
          const [drawn, ...rest] = prevLib;
          setHand((prevHand) => [...prevHand, drawn]);
          setLastDrawnUids([drawn.uid]);
          setCardsDrawnCount((c) => c + 1);
          appendLog(`Draw step: drew ${drawn.name}.`, nextTurnNum, 'Draw');
          return rest;
        });
      }
    } else if (!isNewTurn) {
      appendLog(`Entered ${targetPhase} phase.`, nextTurnNum, targetPhase);
    }

    setPhaseIdx(targetIdx);
  };

  const commitCurrentTurnDuration = (endedTurnNum: number) => {
    const now = Date.now();
    if (lastTickAtRef.current !== null) {
      currentTurnElapsedRef.current += Math.max(0, now - lastTickAtRef.current);
    }
    const elapsed = Math.max(0, currentTurnElapsedRef.current);
    currentTurnElapsedRef.current = 0;
    lastTickAtRef.current = now;
    setCurrentTurnElapsedMs(0);

    setCompletedTurnDurations((prev) => {
      if (prev.length > 0 && prev[prev.length - 1].turn === endedTurnNum && elapsed < 250) {
        return prev;
      }
      return [...prev, { turn: endedTurnNum, durationMs: elapsed }];
    });
  };

  const persistLiveMatchLearnings = (outcome: 'victory' | 'defeat' | 'unfinished') => {
    if (
      !liveBotMode ||
      !autoLearnEnabled ||
      !onSaveBotMemoryProfiles ||
      liveLearningsSavedRef.current ||
      liveBots.length === 0
    ) {
      return;
    }
    liveLearningsSavedRef.current = true;
    const oppById = new Map(opponents.map((o) => [o.id, o]));
    const botSummaries = liveBots.map((b) => ({
      botId: b.id,
      botName: b.name,
      archetype: b.archetype,
      customDeckText: oppById.get(b.id)?.customDeckText,
      deckIdentitySummary: b.liveMemory.deckIdentitySummary,
      endingBotLife: b.life,
      eliminated: b.eliminated,
      eliminatedReason: b.eliminatedReason,
      observedUserThreats: b.liveMemory.observedUserThreats,
      observedUserHabits: b.liveMemory.observedUserHabits,
      adaptationHistory: b.liveMemory.adaptationHistory,
      damageDealtToPlayer: b.liveMemory.damageDealtToPlayer,
      damageTakenFromPlayer: b.liveMemory.damageTakenFromPlayer,
      damageDealtToRivals: b.liveMemory.damageDealtToRivals,
      damageTakenFromRivals: b.liveMemory.damageTakenFromRivals,
      biggestRivalThreatName: b.liveMemory.biggestRivalThreatName,
      spellsCastCount: b.liveMemory.spellsCastCount,
      creaturesPlayedCount: b.liveMemory.creaturesPlayedCount,
      commanderDamageDealtToYou: b.commanderDamageDealtToYou,
      lastPosture: b.liveMemory.lastPosture,
      lastTargetName: b.lastTargetName,
      lastActionSummary: b.lastActionSummary,
    }));

    const { updatedMemory, updatedProfiles } = applyLiveGameLearningsToBotProfiles({
      existingMemory: botMemory || {},
      opponents,
      liveBotSummaries: botSummaries,
      playerDeckLabel: playerDeckContext.deckName,
      playerArchetype: playerDeckContext.archetype,
      playerCommanders: playerDeckContext.commanderNames,
      mode,
      endingPlayerLife: yourLife,
      outcome,
      turnsPlayed: turn,
    });
    if (updatedProfiles.length > 0) {
      onSaveBotMemoryProfiles(updatedProfiles);
      appendLog(
        `Bot AI Memory Updated: saved live match lessons against ${playerDeckContext.deckName} for ${updatedProfiles.length} bot${
          updatedProfiles.length === 1 ? '' : 's'
        }.`,
        turn,
        activePhase
      );
    }

    // Also synthesize deeper evolutionary AI lessons via active Qwen / custom .gguf / Cloud Gemini
    // and record structured outcomes to bot_training.json
    void fetch('/api/live-bot/learn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        format,
        mode,
        outcome,
        turnsPlayed: turn,
        endingPlayerLife: yourLife,
        playerDeckLabel: playerDeckContext.deckName,
        playerArchetype: playerDeckContext.archetype,
        playerCommanders: playerDeckContext.commanderNames,
        bots: botSummaries,
        opponents,
      }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          learnRes: {
            engineUsed?: string;
            modelLabel?: string;
            trainingRecorded?: boolean;
            botLearnings?: BotMatchLearningInsight[];
          } | null
        ) => {
          if (!learnRes) return;
          const aiLearnings = Array.isArray(learnRes.botLearnings) ? learnRes.botLearnings : [];
          if (aiLearnings.length > 0) {
            const merged = mergeAiLearningsIntoLiveProfiles({
              existingMemory: updatedMemory,
              opponents,
              aiLearnings,
              aiModelLabel: learnRes.modelLabel,
            });
            if (merged.updatedProfiles.length > 0) {
              onSaveBotMemoryProfiles(merged.updatedProfiles);
            }
          }
          if (learnRes.trainingRecorded || aiLearnings.length > 0) {
            appendLog(
              `${learnRes.modelLabel || 'AI Engine'} synthesized post-game lessons & updated persistent bot training memory.`,
              turn,
              activePhase
            );
          }
        }
      )
      .catch(() => {
        // Baseline learnings already saved cleanly
      });
  };

  const dispatchUserActionToBots = (
    event: LiveUserActionEvent,
    botsSource?: LiveBotState[],
    options?: { skipReactiveCounter?: boolean; targetSpellUncounterable?: boolean }
  ) => {
    if (!liveBotMode) {
      return {
        counteredByBotName: null as string | null,
        counteredByBotId: null as string | null,
        counteredBySeatNumber: null as number | null,
        counterSpellName: null as string | null,
        counterSpellCmc: 0,
        counterReason: null as string | null,
      };
    }
    const baseBots = botsSource || latestGameRef.current.liveBots;
    const reaction = recordUserActionForBots(baseBots, event, playerDeckContext, options);
    setLiveBots(reaction.updatedBots);
    latestGameRef.current = {
      ...latestGameRef.current,
      liveBots: reaction.updatedBots,
    };
    for (const msg of reaction.adaptationLogs) {
      appendLog(msg, event.turn, activePhase);
    }
    return {
      counteredByBotName: reaction.counteredByBotName,
      counteredByBotId: reaction.counteredByBotId,
      counteredBySeatNumber: reaction.counteredBySeatNumber,
      counterSpellName: reaction.counterSpellName,
      counterSpellCmc: reaction.counterSpellCmc,
      counterReason: reaction.counterReason,
    };
  };

  const handleEndSimulation = () => {
    if (
      botsAreActing ||
      pendingIncomingAttack ||
      hasActiveStack ||
      simulationEndedManually ||
      liveMatchOutcome
    ) {
      return;
    }
    if (currentTurnElapsedRef.current > 0 || completedTurnDurations.length === 0) {
      commitCurrentTurnDuration(turn);
    }
    if (turn >= 2) {
      persistLiveMatchLearnings('unfinished');
    }
    setSimulationEndedManually(true);
    appendLog(`Finished simulation on Turn ${turn} — Turn Duration Summary ready.`, turn, activePhase);
  };

  const startBotTurns = () => {
    // Bots observe whether you missed a land drop or passed holding open mana!
    if (liveBotMode) {
      if (landsPlayedThisTurn === 0 && turn <= 6 && totalLandsInPlay < 6) {
        dispatchUserActionToBots({ type: 'missed-land', turn });
      } else if (untappedLandsCount >= 2) {
        dispatchUserActionToBots({
          type: 'pass-open-mana',
          turn,
          openMana: untappedLandsCount + totalManaPool,
        });
      }
    }

    const aliveIndices = latestGameRef.current.liveBots
      .map((b, i) => (b.eliminated ? -1 : i))
      .filter((i) => i >= 0);

    commitCurrentTurnDuration(turn);
    setTurnsPassedCount((n) => n + 1);

    if (aliveIndices.length === 0) {
      const nextTurn = turn + 1;
      setTurn(nextTurn);
      goToPhase(0, true, nextTurn);
      return;
    }

    if (sumManaPool(manaPool) > 0) {
      setManaPool({ ...EMPTY_POOL });
    }
    setPhaseIdx(PHASES.length - 1);
    setBattlefield((prev) => prev.map((p) => ({ ...p, attacking: false })));
    setBotStepAwaitingContinue(false);
    setActiveBotTurnBanner(null);
    targetsHitThisBotRoundRef.current = {};
    setBotRoundTotal(aliveIndices.length);
    appendLog(
      `Ended Turn ${turn} — passing priority in clockwise turn order (${aliveIndices.length} bot${
        aliveIndices.length === 1 ? '' : 's'
      }).`,
      turn,
      'End'
    );
    setBotQueueIndices(aliveIndices);
  };

  const handlePassTurn = () => {
    if (
      botQueueIndices.length > 0 ||
      botStepAwaitingContinue ||
      pendingIncomingAttack ||
      hasActiveStack ||
      liveMatchOutcome ||
      simulationEndedManually
    ) {
      return;
    }
    if (liveBotMode) {
      playTabletopSound(soundEnabled, 'turn');
      startBotTurns();
    } else {
      playTabletopSound(soundEnabled, 'turn');
      commitCurrentTurnDuration(turn);
      const nextTurn = turn + 1;
      setTurnsPassedCount((n) => n + 1);
      setTurn(nextTurn);
      goToPhase(0, true, nextTurn);
      appendLog(`Passed turn — advanced to Turn ${nextTurn}.`, nextTurn, 'Untap');
    }
  };

  // Refs for fresh state during async bot step execution
  const latestGameRef = React.useRef({
    liveBots,
    battlefield,
    library,
    hand,
    yourLife,
    yourPoison,
    turn,
    untappedLandsCount,
    canRespondAtInstantSpeed,
    hasActivatedAbilityResponse,
    interruptAlertsEnabled,
    fullControlPriority,
  });
  latestGameRef.current = {
    liveBots,
    battlefield,
    library,
    hand,
    yourLife,
    yourPoison,
    turn,
    untappedLandsCount,
    canRespondAtInstantSpeed,
    hasActivatedAbilityResponse,
    interruptAlertsEnabled,
    fullControlPriority,
  };

  const maxCmdrFromBots = liveBotMode
    ? liveBots.reduce((mx, b) => Math.max(mx, b.commanderDamageDealtToYou), 0)
    : opponentTrackers.reduce((mx, o) => Math.max(mx, o.commanderDamageDealtToYou), 0);

  const liveMatchOutcome: 'victory' | 'defeat' | null = useMemo(() => {
    if (!liveBotMode) return null;
    if (
      yourLife <= 0 ||
      yourPoison >= 10 ||
      (formatRules.usesCommanderDamage21 && maxCmdrFromBots >= 21)
    ) {
      return 'defeat';
    }
    if (liveBots.length > 0 && liveBots.every((b) => b.eliminated)) {
      return 'victory';
    }
    return null;
  }, [liveBotMode, yourLife, yourPoison, maxCmdrFromBots, liveBots, formatRules.usesCommanderDamage21]);

  const isSimulationFinished = Boolean(liveMatchOutcome) || simulationEndedManually;
  const isTurnTimerRunning =
    !(liveBotMode && (botQueueIndices.length > 0 || activeBotIdx !== null || botStepAwaitingContinue)) &&
    !pendingIncomingAttack &&
    !hasActiveStack &&
    !isSimulationFinished &&
    !isTimerPaused;

  // Real-time wall-clock turn timer ticker (pauses during bot turns, blocking prompts, or match end)
  useEffect(() => {
    if (!isTurnTimerRunning) {
      lastTickAtRef.current = null;
      return;
    }

    lastTickAtRef.current = Date.now();
    const interval = window.setInterval(() => {
      const now = Date.now();
      const prev = lastTickAtRef.current ?? now;
      const delta = Math.max(0, now - prev);
      lastTickAtRef.current = now;
      currentTurnElapsedRef.current += delta;
      setCurrentTurnElapsedMs(currentTurnElapsedRef.current);
    }, 250);

    return () => {
      if (lastTickAtRef.current !== null) {
        const delta = Math.max(0, Date.now() - lastTickAtRef.current);
        currentTurnElapsedRef.current += delta;
        setCurrentTurnElapsedMs(currentTurnElapsedRef.current);
        lastTickAtRef.current = null;
      }
      window.clearInterval(interval);
    };
  }, [isTurnTimerRunning]);

  // Finalize active turn duration & persist live learnings when live game reaches Victory or Defeat
  const prevOutcomeRef = React.useRef<'victory' | 'defeat' | null>(null);
  useEffect(() => {
    if (liveMatchOutcome && !prevOutcomeRef.current) {
      if (currentTurnElapsedRef.current > 0) {
        commitCurrentTurnDuration(turn);
      }
      setBotQueueIndices([]);
      setActiveBotIdx(null);
      setBotStepAwaitingContinue(false);
      setActiveBotTurnBanner(null);
      setStackItems([]);
      setPendingBotStackContinuation(null);
      persistLiveMatchLearnings(liveMatchOutcome);
    }
    prevOutcomeRef.current = liveMatchOutcome;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveMatchOutcome]);

  const finishBotQueueToPlayerTurn = (currentTurnNum: number) => {
    setActiveBotIdx(null);
    setBotRoundTotal(0);
    if (openingBotLeadPendingRef.current) {
      openingBotLeadPendingRef.current = false;
      setTurn(1);
      goToPhase(0, true, 1);
      appendLog(
        'Opening lead-off bot turn(s) finished — your Turn 1 begins now!',
        1,
        'Untap'
      );
      return;
    }
    const nextTurn = currentTurnNum + 1;
    setTurn(nextTurn);
    goToPhase(0, true, nextTurn);
  };

  const advanceAfterCurrentBot = () => {
    setBotStepAwaitingContinue(false);
    setActiveBotTurnBanner(null);
    if (botQueueIndices.length === 0) {
      finishBotQueueToPlayerTurn(latestGameRef.current.turn);
    }
  };

  // Auto-advance timer after displaying a bot's completed turn (disabled in Step-by-Step mode)
  useEffect(() => {
    if (
      !liveBotMode ||
      !botStepAwaitingContinue ||
      pendingIncomingAttack ||
      hasActiveStack ||
      liveMatchOutcome ||
      botTurnPace === 'step'
    ) {
      return;
    }

    const delayMs = botTurnPace === 'fast' ? 320 : 1250;
    const timer = window.setTimeout(() => {
      advanceAfterCurrentBot();
    }, delayMs);

    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveBotMode, botStepAwaitingContinue, pendingIncomingAttack, hasActiveStack, liveMatchOutcome, botTurnPace, botQueueIndices]);

  // Execute queued bot turns sequentially — each surviving bot takes its own visible turn in clockwise order
  useEffect(() => {
    if (
      !liveBotMode ||
      botQueueIndices.length === 0 ||
      botStepAwaitingContinue ||
      pendingIncomingAttack ||
      hasActiveStack ||
      liveMatchOutcome
    ) {
      if (botQueueIndices.length === 0 && !botStepAwaitingContinue && !hasActiveStack && !pendingIncomingAttack) {
        setActiveBotIdx(null);
        setThinkingBotName(null);
      }
      return;
    }

    const nextBotIndex = botQueueIndices[0];
    setActiveBotIdx(nextBotIndex);

    let cancelled = false;
    const abortController = new AbortController();
    const epochAtStart = liveMatchEpochRef.current;
    const leadInMs = botTurnPace === 'fast' ? 140 : 420;

    const timer = window.setTimeout(() => {
      void (async () => {
        const snap = latestGameRef.current;
        const actingBot = snap.liveBots[nextBotIndex];
        const remaining = botQueueIndices.slice(1);

        if (!actingBot || actingBot.eliminated) {
          if (cancelled || liveMatchEpochRef.current !== epochAtStart) return;
          setBotQueueIndices(remaining);
          if (remaining.length === 0) {
            finishBotQueueToPlayerTurn(snap.turn);
          }
          return;
        }

        const buildPlayerSnapshot = (): PlayerBoardSnapshot => ({
          life: snap.yourLife,
          poison: snap.yourPoison,
          libraryCount: snap.library.length,
          handCount: snap.hand.length,
          untappedLandsCount: snap.untappedLandsCount,
          deckContext: playerDeckContext,
          canRespondAtInstantSpeed: snap.canRespondAtInstantSpeed,
          hasActivatedAbilityResponse: snap.hasActivatedAbilityResponse,
          interruptAlertsEnabled: snap.interruptAlertsEnabled,
          fullControlPriority: snap.fullControlPriority,
          creatures: snap.battlefield
            .filter((p) => p.isCreature)
            .map((p) => {
              const eff = getEffectivePermanentStats(p);
              const kw = extractCreatureKeywords(p.meta);
              return {
                ...kw,
                hexproof: kw.hexproof || Boolean(p.protectedUntilEot),
                indestructible: kw.indestructible || Boolean(p.protectedUntilEot),
                uid: p.uid,
                name: p.name,
                power: eff.power,
                toughness: eff.toughness,
                tapped: p.tapped,
                isCommander: p.isCommander,
                hasInfect: p.hasInfect,
                toxicValue: p.toxicValue,
              };
            }),
          landsCount: snap.battlefield.filter((p) => p.isLand).length,
          hasCommanderInPlay: snap.battlefield.some((p) => p.isCommander),
        });

        let aiTurnDecision: LiveBotAiTurnDecision | undefined;
        const useLlmForTurn =
          liveAiTurnReasoningRef.current &&
          liveAiStatusRef.current.effectiveEngine !== 'deterministic' &&
          botTurnPace !== 'fast';

        if (useLlmForTurn) {
          try {
            setThinkingBotName(actingBot.name);
            const playerPublicForAi = buildPlayerSnapshot();
            const estAvailMana = Math.max(
              0,
              actingBot.landsInPlay + actingBot.manaBonusFromRamp + (actingBot.handCount > 0 ? 1 : 0)
            );
            const resAi = await fetch('/api/live-bot/turn', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              signal: abortController.signal,
              body: JSON.stringify({
                turnNumber: snap.turn,
                format,
                mode,
                activeBot: {
                  id: actingBot.id,
                  name: actingBot.name,
                  archetype: actingBot.archetype,
                  intelligence: actingBot.intelligence,
                  indignance: actingBot.indignance,
                  life: actingBot.life,
                  poison: actingBot.poison,
                  landsInPlay: actingBot.landsInPlay,
                  tappedLands: 0,
                  availableMana: estAvailMana,
                  commanderName: actingBot.commanderName,
                  commanderCost: actingBot.commanderCmc + actingBot.commanderTax,
                  commanderInZone: actingBot.commanderInZone && actingBot.allowsCommandZone,
                  handCount: actingBot.handCount,
                  handCards: actingBot.customHand.slice(0, 12).map((c) => ({
                    name: c.name,
                    cmc: c.cmc,
                    category: c.isLand
                      ? 'Land'
                      : c.isBoardWipe
                      ? 'BoardWipe'
                      : c.isRemoval
                      ? 'Removal'
                      : c.isCounterspell
                      ? 'Counterspell'
                      : c.isRamp
                      ? 'Ramp'
                      : c.isCreature
                      ? 'Creature'
                      : 'Spell',
                    power: c.isCreature ? c.power : undefined,
                    toughness: c.isCreature ? c.toughness : undefined,
                  })),
                  creatures: actingBot.creatures.map((c) => ({
                    name: c.name,
                    power: c.power,
                    toughness: c.toughness,
                    tapped: c.tapped,
                    keywords: formatCreatureKeywordTags(c),
                  })),
                  grudgeScore: actingBot.liveMemory.grudgeScore,
                  observedUserThreats: actingBot.liveMemory.observedUserThreats,
                  observedUserHabits: actingBot.liveMemory.observedUserHabits,
                  aiDirective: actingBot.liveMemory.aiDirective,
                },
                playerBoard: {
                  life: playerPublicForAi.life,
                  poison: playerPublicForAi.poison,
                  landsCount: playerPublicForAi.landsCount,
                  untappedLandsCount: playerPublicForAi.untappedLandsCount ?? 0,
                  handCount: playerPublicForAi.handCount ?? 0,
                  hasCommanderInPlay: playerPublicForAi.hasCommanderInPlay,
                  creatures: playerPublicForAi.creatures.map((pc) => ({
                    name: pc.name,
                    power: pc.power,
                    toughness: pc.toughness,
                    tapped: pc.tapped,
                    isCommander: pc.isCommander,
                    hexproof: pc.hexproof,
                    indestructible: pc.indestructible,
                    flying: pc.flying,
                    reach: pc.reach,
                  })),
                },
                rivalBots: snap.liveBots
                  .filter((r) => r.id !== actingBot.id && !r.eliminated)
                  .map((r) => ({
                    name: r.name,
                    life: r.life,
                    poison: r.poison,
                    landsInPlay: r.landsInPlay,
                    creatures: r.creatures.map((rc) => ({
                      name: rc.name,
                      power: rc.power,
                      toughness: rc.toughness,
                      tapped: rc.tapped,
                      isCommander: rc.isCommander,
                      hexproof: rc.hexproof,
                    })),
                  })),
              }),
            });
            if (resAi.ok) {
              aiTurnDecision = (await resAi.json()) as LiveBotAiTurnDecision;
            }
          } catch {
            // Timeout, abort, or offline -> clean deterministic rules execution
          } finally {
            setThinkingBotName(null);
          }
        }

        if (cancelled || liveMatchEpochRef.current !== epochAtStart) {
          return;
        }

        const freshSnap = latestGameRef.current;
        const freshActingBot = freshSnap.liveBots[nextBotIndex];
        if (!freshActingBot || freshActingBot.eliminated) {
          setBotQueueIndices(remaining);
          if (remaining.length === 0) {
            finishBotQueueToPlayerTurn(freshSnap.turn);
          }
          return;
        }

        const playerSnapshot: PlayerBoardSnapshot = {
          life: freshSnap.yourLife,
          poison: freshSnap.yourPoison,
          libraryCount: freshSnap.library.length,
          handCount: freshSnap.hand.length,
          untappedLandsCount: freshSnap.untappedLandsCount,
          deckContext: playerDeckContext,
          canRespondAtInstantSpeed: freshSnap.canRespondAtInstantSpeed,
          hasActivatedAbilityResponse: freshSnap.hasActivatedAbilityResponse,
          interruptAlertsEnabled: freshSnap.interruptAlertsEnabled,
          fullControlPriority: freshSnap.fullControlPriority,
          creatures: freshSnap.battlefield
            .filter((p) => p.isCreature)
            .map((p) => {
              const eff = getEffectivePermanentStats(p);
              const kw = extractCreatureKeywords(p.meta);
              return {
                ...kw,
                hexproof: kw.hexproof || Boolean(p.protectedUntilEot),
                indestructible: kw.indestructible || Boolean(p.protectedUntilEot),
                uid: p.uid,
                name: p.name,
                power: eff.power,
                toughness: eff.toughness,
                tapped: p.tapped,
                isCommander: p.isCommander,
                hasInfect: p.hasInfect,
                toxicValue: p.toxicValue,
              };
            }),
          landsCount: freshSnap.battlefield.filter((p) => p.isLand).length,
          hasCommanderInPlay: freshSnap.battlefield.some((p) => p.isCommander),
        };

        const res = executeBotTurn(
          nextBotIndex,
          freshSnap.liveBots,
          playerSnapshot,
          freshSnap.turn,
          findMeta,
          targetsHitThisBotRoundRef.current,
          aiTurnDecision
        );

        const actedBotAfter = res.updatedBots[nextBotIndex];
        if (actedBotAfter?.lastTargetName) {
          targetsHitThisBotRoundRef.current = {
            ...targetsHitThisBotRoundRef.current,
            [actedBotAfter.lastTargetName]:
              (targetsHitThisBotRoundRef.current[actedBotAfter.lastTargetName] || 0) + 1,
          };
        }

        setLiveBots(res.updatedBots);
        latestGameRef.current = {
          ...latestGameRef.current,
          liveBots: res.updatedBots,
        };
        playTabletopSound(soundEnabled, res.pendingStackSpell ? 'alert' : 'tap');

        if (res.playerLifeDelta !== 0) {
          setYourLife((l) => Math.max(0, l + res.playerLifeDelta));
        }
        if (res.playerPoisonDelta !== 0) {
          setYourPoison((p) => Math.min(20, p + res.playerPoisonDelta));
        }
        if (res.playerMillCount > 0) {
          setLibrary((prevLib) => {
            const milled = prevLib.slice(0, res.playerMillCount);
            const rest = prevLib.slice(res.playerMillCount);
            if (milled.length > 0) {
              setGraveyard((prevGy) => [...milled, ...prevGy]);
            }
            return rest;
          });
        }
        if (
          res.removedPlayerCreatureUids.length > 0 ||
          (res.exiledPlayerCreatureUids?.length || 0) > 0
        ) {
          const removeSet = new Set(res.removedPlayerCreatureUids);
          const exileSet = new Set(res.exiledPlayerCreatureUids || []);
          setBattlefield((prevBf) => {
            const staying: BattlefieldPermanent[] = [];
            const returnedCmds: SimCardInstance[] = [];
            const gyCards: SimCardInstance[] = [];
            const exileCards: SimCardInstance[] = [];
            for (const perm of prevBf) {
              if ((removeSet.has(perm.uid) || exileSet.has(perm.uid)) && !perm.protectedUntilEot) {
                if (perm.isToken) continue;
                if (perm.isCommander) returnedCmds.push(perm);
                else if (exileSet.has(perm.uid)) exileCards.push(perm);
                else gyCards.push(perm);
              } else {
                staying.push(perm);
              }
            }
            if (returnedCmds.length > 0) {
              setCommandZone((prevCz) => [...prevCz, ...returnedCmds]);
            }
            if (gyCards.length > 0) {
              setGraveyard((prevGy) => [...gyCards, ...prevGy]);
            }
            if (exileCards.length > 0) {
              setExile((prevEx) => [...exileCards, ...prevEx]);
            }
            return staying;
          });
        }

        const activeBotName = freshActingBot.name || 'Bot';
        for (const msg of res.logs) {
          appendLog(`[Seat ${nextBotIndex + 2} · ${activeBotName}] ${msg}`, freshSnap.turn, 'Combat');
        }

        const totalInRound = Math.max(botRoundTotal, botQueueIndices.length);
        const queuePosition = Math.max(1, totalInRound - remaining.length);

        setBotQueueIndices(remaining);

        if (res.pendingStackSpell) {
          setPendingBotStackContinuation(res.pendingStackSpell);
          setStackItems([createStackItemFromBotSpell(res.pendingStackSpell)]);
          setActiveBotTurnBanner(null);
          setBotStepAwaitingContinue(false);
          return;
        }

        if (res.pendingAttackOnPlayer) {
          setPendingIncomingAttack(res.pendingAttackOnPlayer);
          setBlockerAssignments({});
          setCombatFogActive(false);
          setActiveBotTurnBanner(null);
          setBotStepAwaitingContinue(false);
          return;
        }

        // Show this bot's completed turn summary cleanly before advancing to the next bot (or back to You)
        setActiveBotTurnBanner({
          botName: activeBotName,
          seatNumber: nextBotIndex + 2,
          queuePosition,
          queueTotal: totalInRound,
          phaseSteps: res.phaseSteps,
          adaptationNote: res.adaptationNote,
          isLastBotInRound: remaining.length === 0,
        });
        setBotStepAwaitingContinue(true);
      })();
    }, leadInMs);

    return () => {
      cancelled = true;
      abortController.abort();
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveBotMode, botQueueIndices, botStepAwaitingContinue, pendingIncomingAttack, hasActiveStack, botTurnPace, liveMatchOutcome]);

  const handleResolveIncomingAttack = (ignoreBlockers = false) => {
    if (!pendingIncomingAttack) return;

    const attackingBotId = pendingIncomingAttack.botId;

    if (combatFogActive || pendingIncomingAttack.attackers.length === 0) {
      playTabletopSound(soundEnabled, 'combat');
      appendLog(
        combatFogActive
          ? `Combat vs ${pendingIncomingAttack.botName}: all combat damage prevented (Fog active)!`
          : `Combat vs ${pendingIncomingAttack.botName}: no attackers remaining.`,
        turn,
        'Combat'
      );
      setCombatFogActive(false);
      setPendingIncomingAttack(null);
      setBlockerAssignments({});

      if (botQueueIndices.length === 0) {
        finishBotQueueToPlayerTurn(turn);
      }
      return;
    }

    const assignments = ignoreBlockers ? {} : blockerAssignments;

    const combatResult = resolveIncomingAttackCombat(
      pendingIncomingAttack.attackers,
      battlefield
        .filter((p) => p.isCreature && !p.tapped)
        .map((p) => {
          const eff = getEffectivePermanentStats(p);
          const kw = extractCreatureKeywords(p.meta);
          return {
            uid: p.uid,
            name: p.name,
            power: eff.power,
            toughness: eff.toughness,
            keywords: {
              ...kw,
              indestructible: kw.indestructible || Boolean(p.protectedUntilEot),
            },
          };
        }),
      assignments,
      formatRules.usesCommanderDamage21
    );

    const netPlayerLifeDelta = combatResult.playerLifeGain - combatResult.lifeDmgToPlayer;
    if (netPlayerLifeDelta !== 0) {
      setYourLife((l) => Math.max(0, l + netPlayerLifeDelta));
    }
    if (combatResult.poisonDmgToPlayer > 0) {
      setYourPoison((p) => Math.min(20, p + combatResult.poisonDmgToPlayer));
    }

    const deadPlayerSet = new Set(combatResult.deadPlayerUids);
    const deadBotSet = new Set(combatResult.deadBotAttackerUids);

    if (deadPlayerSet.size > 0) {
      setBattlefield((prev) => {
        const staying: BattlefieldPermanent[] = [];
        const cmds: SimCardInstance[] = [];
        const gy: SimCardInstance[] = [];
        for (const p of prev) {
          if (deadPlayerSet.has(p.uid)) {
            if (p.isToken) continue;
            if (p.isCommander) cmds.push(p);
            else gy.push(p);
          } else {
            staying.push(p);
          }
        }
        if (cmds.length > 0) setCommandZone((cz) => [...cz, ...cmds]);
        if (gy.length > 0) setGraveyard((prevGy) => [...gy, ...prevGy]);
        return staying;
      });
    }

    const updatedAfterCombat = latestGameRef.current.liveBots.map((b) => {
      if (b.id !== attackingBotId) return b;
      let nextBot: LiveBotState = {
        ...b,
        graveyardCards: [...(b.graveyardCards || [])],
        exileCards: [...(b.exileCards || [])],
      };
      let cmdReturned = false;
      const surviving = b.creatures.filter((c) => {
        if (!deadBotSet.has(c.uid)) return true;
        if (c.isCommander && b.allowsCommandZone) {
          cmdReturned = true;
        } else {
          nextBot = pushLiveBotZoneCard(
            nextBot,
            'graveyard',
            createLiveBotZoneCardFromCreature(c, 'Killed in combat')
          );
        }
        return false;
      });
      return {
        ...nextBot,
        life: nextBot.life + combatResult.botLifeGain,
        creatures: surviving,
        commanderInZone: nextBot.commanderInZone || cmdReturned,
        commanderTax: cmdReturned ? nextBot.commanderTax + 2 : nextBot.commanderTax,
        commanderDamageDealtToYou: nextBot.commanderDamageDealtToYou + combatResult.cmdrDmgToPlayer,
      };
    });

    // Let bots learn immediately from how you blocked (or took unblocked damage)!
    if (combatResult.totalBlockersUsed > 0) {
      dispatchUserActionToBots(
        {
          type: 'block-bot',
          turn,
          targetBotId: attackingBotId,
          blockedCount: combatResult.totalBlockersUsed,
        },
        updatedAfterCombat
      );
    } else if (combatResult.lifeDmgToPlayer > 0 || combatResult.poisonDmgToPlayer > 0) {
      dispatchUserActionToBots(
        {
          type: 'take-unblocked',
          turn,
          targetBotId: attackingBotId,
          unblockedDamage: combatResult.lifeDmgToPlayer + combatResult.poisonDmgToPlayer,
        },
        updatedAfterCombat
      );
    } else {
      setLiveBots(updatedAfterCombat);
    }

    const summaryParts = [...combatResult.blockLogParts];
    if (combatResult.lifeDmgToPlayer > 0) summaryParts.push(`took ${combatResult.lifeDmgToPlayer} combat dmg`);
    if (combatResult.poisonDmgToPlayer > 0) summaryParts.push(`+${combatResult.poisonDmgToPlayer} poison`);
    if (combatResult.cmdrDmgToPlayer > 0) summaryParts.push(`+${combatResult.cmdrDmgToPlayer} Commander dmg`);
    if (combatResult.playerLifeGain > 0) summaryParts.push(`+${combatResult.playerLifeGain} lifelink`);
    if (combatResult.botLifeGain > 0) summaryParts.push(`${pendingIncomingAttack.botName} +${combatResult.botLifeGain} lifelink`);
    playTabletopSound(soundEnabled, 'combat');
    appendLog(
      `Combat vs ${pendingIncomingAttack.botName}: ${summaryParts.join(', ') || 'all damage blocked'}.`,
      turn,
      'Combat'
    );

    setCombatFogActive(false);
    setPendingIncomingAttack(null);
    setBlockerAssignments({});

    if (botQueueIndices.length === 0) {
      finishBotQueueToPlayerTurn(turn);
    }
  };

  // Instant-speed responses cast directly during an incoming bot attack (Removal on attacker, Flash blocker, Fog, Pump/Protection, Instant Draw)
  const handleCastCombatInstant = (
    cardUid: string,
    targetAttackerUid?: string,
    targetPlayerCreatureUid?: string
  ) => {
    if (!pendingIncomingAttack) return;
    const card = hand.find((c) => c.uid === cardUid);
    if (!card) return;
    const profile = classifyCardStackProfile(card.name, card.typeLine, card.meta);
    if (!profile.isInstantSpeed) return;

    const effectiveCost = getEffectiveInstantCost(
      card.name,
      card.cmc,
      hasCommanderInPlayNow,
      profile
    );
    const paid = spendManaForSpell(effectiveCost === 0 ? '' : card.meta?.manaCost || '', effectiveCost);
    if (!paid) {
      appendLog(`Not enough mana to cast ${card.name} (${effectiveCost} mana) in combat.`, turn, 'Combat');
      return;
    }

    setHand((prev) => prev.filter((c) => c.uid !== card.uid));
    playTabletopSound(soundEnabled, 'cast');

    if (profile.mechanic === 'fog' || profile.fogsCombat) {
      setCombatFogActive(true);
      setGraveyard((prev) => [card, ...prev]);
      if (profile.bouncesTarget || profile.exilesTarget) {
        const atkUids = new Set(pendingIncomingAttack.attackers.map((a) => a.uid));
        setLiveBots((prev) =>
          prev.map((b) => {
            if (b.id !== pendingIncomingAttack.botId) return b;
            let bouncedCount = 0;
            const remaining = b.creatures.filter((c) => {
              if (!atkUids.has(c.uid)) return true;
              bouncedCount += 1;
              return false;
            });
            return {
              ...b,
              creatures: remaining,
              handCount: profile.bouncesTarget ? b.handCount + bouncedCount : b.handCount,
            };
          })
        );
        setPendingIncomingAttack((prev) => (prev ? { ...prev, attackers: [] } : null));
      }
      dispatchUserActionToBots({
        type: 'instant-combat-trick',
        turn,
        cardName: card.name,
        targetBotId: pendingIncomingAttack.botId,
      });
      appendLog(`Combat Response: Cast ${card.name} — combat damage prevented this turn!`, turn, 'Combat');
      return;
    }

    if (profile.mechanic === 'flash-creature') {
      const kw = extractCreatureKeywords(card.meta);
      setBattlefield((prev) => [
        ...prev,
        { ...card, tapped: false, attacking: false, summoningSick: !kw.haste },
      ]);
      dispatchUserActionToBots({
        type: 'instant-combat-trick',
        turn,
        cardName: card.name,
        targetBotId: pendingIncomingAttack.botId,
      });
      appendLog(
        `Combat Response: Flashed in ${card.name} (${card.power}/${Number(card.meta?.toughness) || Math.max(2, card.power)}) — ready to block!`,
        turn,
        'Combat'
      );
      return;
    }

    if (profile.mechanic === 'instant-removal' || profile.mechanic === 'burn-or-drain') {
      setGraveyard((prev) => [card, ...prev]);
      const targetAtk =
        pendingIncomingAttack.attackers.find((a) => a.uid === targetAttackerUid) ||
        pendingIncomingAttack.attackers[0];
      if (targetAtk) {
        const killsAttacker =
          profile.mechanic === 'instant-removal'
            ? profile.exilesTarget || profile.bouncesTarget || !targetAtk.indestructible
            : !targetAtk.indestructible && profile.burnDamage >= targetAtk.toughness;

        if (killsAttacker) {
          setLiveBots((prev) =>
            prev.map((b) => {
              if (b.id !== pendingIncomingAttack.botId) return b;
              const remaining = b.creatures.filter((c) => c.uid !== targetAtk.uid);
              const cmdReturned = targetAtk.isCommander && b.allowsCommandZone && !profile.bouncesTarget;
              let nextBot: LiveBotState = {
                ...b,
                graveyardCards: [...(b.graveyardCards || [])],
                exileCards: [...(b.exileCards || [])],
              };
              if (!profile.bouncesTarget && !cmdReturned) {
                nextBot = pushLiveBotZoneCard(
                  nextBot,
                  profile.exilesTarget ? 'exile' : 'graveyard',
                  createLiveBotZoneCardFromCreature(
                    targetAtk,
                    `${profile.exilesTarget ? 'Exiled' : 'Removed'} by ${card.name}`
                  )
                );
              }
              return {
                ...nextBot,
                creatures: remaining,
                commanderInZone: nextBot.commanderInZone || cmdReturned,
                commanderTax: cmdReturned ? nextBot.commanderTax + 2 : nextBot.commanderTax,
                handCount: profile.bouncesTarget ? nextBot.handCount + 1 : nextBot.handCount,
              };
            })
          );
          setPendingIncomingAttack((prev) =>
            prev
              ? { ...prev, attackers: prev.attackers.filter((a) => a.uid !== targetAtk.uid) }
              : null
          );
          setBlockerAssignments((prev) => {
            const next = { ...prev };
            for (const [blkId, atkId] of Object.entries(next)) {
              if (atkId === targetAtk.uid) delete next[blkId];
            }
            return next;
          });
          appendLog(
            `Combat Response: Cast ${card.name} removing attacking ${targetAtk.name} from combat!`,
            turn,
            'Combat'
          );
        } else {
          appendLog(
            `Combat Response: Cast ${card.name} on ${targetAtk.name} (${
              targetAtk.indestructible
                ? 'Indestructible — survived!'
                : `dealt ${profile.burnDamage} dmg, survived`
            }).`,
            turn,
            'Combat'
          );
        }
      }
      dispatchUserActionToBots({
        type: 'instant-combat-trick',
        turn,
        cardName: card.name,
        targetBotId: pendingIncomingAttack.botId,
      });
      return;
    }

    if (profile.mechanic === 'protection' || profile.mechanic === 'combat-trick') {
      setGraveyard((prev) => [card, ...prev]);
      const pBoost = profile.pumpPower || 0;
      const tBoost = profile.pumpToughness || 0;
      setBattlefield((prev) =>
        prev.map((perm) => {
          const hit =
            profile.protectsWholeBoard
              ? perm.isCreature
              : perm.uid === targetPlayerCreatureUid;
          if (!hit) return perm;
          return {
            ...perm,
            protectedUntilEot:
              perm.protectedUntilEot || profile.mechanic === 'protection',
            tempPowerBoost: (perm.tempPowerBoost || 0) + pBoost,
            tempToughnessBoost: (perm.tempToughnessBoost || 0) + tBoost,
          };
        })
      );
      dispatchUserActionToBots({
        type: profile.mechanic === 'protection' ? 'protect-permanent' : 'instant-combat-trick',
        turn,
        cardName: card.name,
        targetBotId: pendingIncomingAttack.botId,
      });
      appendLog(
        `Combat Response: Cast ${card.name}${
          profile.protectsWholeBoard
            ? ' — your creatures are protected until end of turn!'
            : pBoost || tBoost
            ? ` (+${pBoost}/+${tBoost} until end of turn)!`
            : ' — target creature protected until end of turn!'
        }`,
        turn,
        'Combat'
      );
      return;
    }

    // Instant Draw or generic instant in combat
    setGraveyard((prev) => [card, ...prev]);
    const drawN = Math.max(card.extraDrawCount || 0, profile.mechanic === 'instant-draw' ? 1 : 0);
    if (drawN > 0) handleDrawManual(drawN, false);
    if (card.lifegainAmount > 0) setYourLife((l) => l + card.lifegainAmount);
    appendLog(`Combat Response: Cast ${card.name} at instant speed.`, turn, 'Combat');
  };

  // Interactive Stack: Player casts an instant-speed response onto the Stack (supports Counter Wars!)
  const handleCastStackResponse = (cardUid: string, options: StackCastResponseOptions) => {
    const card = hand.find((c) => c.uid === cardUid);
    if (!card) return;
    const profile = classifyCardStackProfile(card.name, card.typeLine, card.meta);
    if (!profile.isInstantSpeed) return;

    const effectiveCost = getEffectiveInstantCost(
      card.name,
      card.cmc,
      hasCommanderInPlayNow,
      profile
    );
    const paid = spendManaForSpell(effectiveCost === 0 ? '' : card.meta?.manaCost || '', effectiveCost);
    if (!paid) {
      appendLog(`Not enough mana to cast ${card.name} (${effectiveCost} mana) on the stack.`);
      return;
    }

    setHand((prev) => prev.filter((c) => c.uid !== card.uid));
    playTabletopSound(soundEnabled, 'cast');

    let targetSummary = profile.summaryHint;
    let targetBotId = options.targetBotId;
    let targetBotName: string | undefined;
    let targetBotCreatureName: string | undefined;
    let targetPlayerCreatureName: string | undefined;
    let preferredCounterWarBotId: string | undefined;

    if (profile.mechanic === 'counterspell' && options.targetStackItemId) {
      const targetStack = stackItems.find((si) => si.id === options.targetStackItemId);
      if (targetStack) {
        targetSummary = `Counter ${targetStack.controllerName}'s ${targetStack.cardName}`;
        preferredCounterWarBotId = targetStack.controllerBotId;
      }
    } else if (
      (profile.mechanic === 'instant-removal' || profile.mechanic === 'burn-or-drain') &&
      options.targetBotId
    ) {
      const tBot = liveBots.find((b) => b.id === options.targetBotId);
      const tCr = tBot?.creatures.find((c) => c.uid === options.targetBotCreatureUid);
      if (tBot && tCr) {
        targetBotName = tBot.name;
        targetBotCreatureName = tCr.name;
        targetSummary = `${tBot.name}'s ${tCr.name} (${tCr.power}/${tCr.toughness})`;
        preferredCounterWarBotId = tBot.id;
      } else if (tBot) {
        targetBotName = tBot.name;
        targetSummary = `${tBot.name} (${profile.burnDamage || 3} damage)`;
        preferredCounterWarBotId = tBot.id;
      }
    } else if (
      (profile.mechanic === 'protection' && !profile.protectsWholeBoard) ||
      profile.mechanic === 'combat-trick'
    ) {
      const pCr = battlefield.find((p) => p.uid === options.targetPlayerCreatureUid);
      if (pCr) {
        targetPlayerCreatureName = pCr.name;
        targetSummary = `Your ${pCr.name}`;
      }
    } else if (profile.protectsWholeBoard) {
      targetSummary = 'All Permanents / Creatures You Control';
    } else if (profile.mechanic === 'flash-creature') {
      targetSummary = `Your Battlefield (${card.power}/${Number(card.meta?.toughness) || Math.max(2, card.power)} Flash)`;
    }

    const playerStackItem: StackItem = {
      id: createStackItemId('player'),
      controller: 'player',
      controllerName: 'You',
      seatLabel: 'You',
      cardName: card.name,
      cmc: effectiveCost,
      typeLine: card.typeLine,
      meta: card.meta,
      mechanic: profile.mechanic,
      mechanicBadge: profile.mechanicLabel,
      uncounterable: profile.uncounterable,
      countered: false,
      targetSummary,
      targetStackItemId: options.targetStackItemId,
      targetPlayerCreatureUid: options.targetPlayerCreatureUid,
      targetPlayerCreatureName,
      targetBotId,
      targetBotName,
      targetBotCreatureUid: options.targetBotCreatureUid,
      targetBotCreatureName,
      protectsWholeBoard: profile.protectsWholeBoard,
      bouncesTarget: profile.bouncesTarget,
      exilesTarget: profile.exilesTarget,
      fogsCombat: profile.fogsCombat,
      pumpPower: profile.pumpPower,
      pumpToughness: profile.pumpToughness,
      burnDamage: profile.burnDamage,
      playerCardPayload: {
        uid: card.uid,
        name: card.name,
        cmc: card.cmc,
        typeLine: card.typeLine,
        isLand: card.isLand,
        isCreature: card.isCreature,
        isCommander: card.isCommander,
        isArtifactOrRock: card.isArtifactOrRock,
        producedMana: card.producedMana,
        power: card.power,
        toughness: Number(card.meta?.toughness) || Math.max(2, card.power),
        toxicValue: card.toxicValue,
        hasInfect: card.hasInfect,
        extraDrawCount: card.extraDrawCount,
        lifegainAmount: card.lifegainAmount,
        meta: card.meta,
      },
    };

    const nextItems: StackItem[] = [...stackItems, playerStackItem];
    appendLog(`[Stack] You cast ${card.name} (${effectiveCost} mana) — ${targetSummary}.`, turn, activePhase);

    // Check if a bot wants to fight back on the stack (Counter War!)
    if (
      liveBotMode &&
      !profile.uncounterable &&
      (profile.mechanic === 'counterspell' || profile.mechanic === 'protection')
    ) {
      const warReaction = evaluateBotCounterWarResponse(
        latestGameRef.current.liveBots,
        card.name,
        profile.uncounterable,
        preferredCounterWarBotId
      );
      if (warReaction.counteredByBotName && warReaction.counterSpellName) {
        setLiveBots(warReaction.updatedBots);
        latestGameRef.current = {
          ...latestGameRef.current,
          liveBots: warReaction.updatedBots,
        };
        for (const msg of warReaction.adaptationLogs) {
          appendLog(msg, turn, activePhase);
        }
        const counterMeta = findMeta(warReaction.counterSpellName);
        nextItems.push({
          id: createStackItemId('bot-war'),
          controller: 'bot',
          controllerBotId: warReaction.counteredByBotId || undefined,
          controllerName: warReaction.counteredByBotName,
          seatLabel: `Seat ${warReaction.counteredBySeatNumber || 2} · ${warReaction.counteredByBotName}`,
          cardName: warReaction.counterSpellName,
          cmc: warReaction.counterSpellCmc,
          typeLine: counterMeta?.typeLine || 'Instant',
          meta: counterMeta,
          mechanic: 'counterspell',
          mechanicBadge: 'Counter War!',
          uncounterable: isSpellUncounterable(warReaction.counterSpellName, counterMeta),
          countered: false,
          targetSummary: `Counter Your ${card.name}`,
          targetStackItemId: playerStackItem.id,
          botReactionNote: warReaction.counterReason || undefined,
        });
        playTabletopSound(soundEnabled, 'combat');
      }
    }

    setStackItems(nextItems);
    setInterruptResetNonce((n) => n + 1);
  };

  // Interactive Interrupt Window: Activate a battlefield permanent or token ability
  const handleActivateAbility = (
    ability: ActivatedAbilityOption,
    options: StackCastResponseOptions
  ) => {
    const perm = battlefield.find((p) => p.uid === ability.permanentUid);
    if (!perm || !ability.canActivate) return;

    if (ability.manaCost > 0) {
      const paid = spendManaForSpell('', ability.manaCost);
      if (!paid) {
        appendLog(
          `Not enough mana to activate ${ability.permanentName} (${ability.manaCost} mana).`
        );
        return;
      }
    }

    if (ability.sacrificesPermanent) {
      setBattlefield((prev) => prev.filter((p) => p.uid !== perm.uid));
      if (!perm.isToken) {
        setGraveyard((prev) => [perm, ...prev]);
      }
    } else if (ability.requiresTap) {
      setBattlefield((prev) =>
        prev.map((p) => (p.uid === perm.uid ? { ...p, tapped: true } : p))
      );
    }

    // Mana abilities resolve immediately without using the Stack (per MTG rules)
    if (!ability.usesStack && ability.effectKind === 'mana') {
      const manaColor: ManaColor = ability.producedMana?.[0] || 'U';
      const yieldAmt = ability.manaYieldCount || 1;
      setManaPool((prev) => ({
        ...prev,
        [manaColor]: prev[manaColor] + yieldAmt,
      }));
      playTabletopSound(soundEnabled, 'tap');
      setInterruptResetNonce((n) => n + 1);
      appendLog(
        `[Mana Ability] Activated ${ability.permanentName} (${ability.label}) — added ${yieldAmt} {${manaColor}} to your mana pool.`,
        turn,
        activePhase
      );
      return;
    }

    // Non-mana activated abilities go onto the LIFO Stack!
    playTabletopSound(soundEnabled, 'cast');
    let targetSummary = ability.summaryHint;
    let targetBotId = options.targetBotId;
    let targetBotName: string | undefined;
    let targetBotCreatureName: string | undefined;
    let targetPlayerCreatureName: string | undefined;

    if (ability.effectKind === 'counterspell' && options.targetStackItemId) {
      const targetStack = stackItems.find((si) => si.id === options.targetStackItemId);
      if (targetStack) {
        targetSummary = `Counter ${targetStack.controllerName}'s ${targetStack.cardName}`;
      }
    } else if (ability.effectKind === 'removal-damage' && options.targetBotId) {
      const tBot = liveBots.find((b) => b.id === options.targetBotId);
      const tCr = tBot?.creatures.find((c) => c.uid === options.targetBotCreatureUid);
      if (tBot && tCr) {
        targetBotName = tBot.name;
        targetBotCreatureName = tCr.name;
        targetSummary = `${tBot.name}'s ${tCr.name} (${tCr.power}/${tCr.toughness})`;
      } else if (tBot) {
        targetBotName = tBot.name;
        targetSummary = `${tBot.name} (${ability.damageAmount || 1} damage)`;
      }
    } else if (
      (ability.effectKind === 'protection' && !ability.protectsWholeBoard) ||
      ability.effectKind === 'pump'
    ) {
      const pCr = battlefield.find((p) => p.uid === options.targetPlayerCreatureUid);
      if (pCr) {
        targetPlayerCreatureName = pCr.name;
        targetSummary = `Your ${pCr.name}`;
      }
    } else if (ability.protectsWholeBoard) {
      targetSummary = 'All Permanents / Creatures You Control';
    }

    const mappedMechanic: StackItem['mechanic'] =
      ability.effectKind === 'counterspell'
        ? 'counterspell'
        : ability.effectKind === 'protection'
        ? 'protection'
        : ability.effectKind === 'removal-damage'
        ? 'instant-removal'
        : ability.effectKind === 'pump'
        ? 'combat-trick'
        : ability.effectKind === 'draw'
        ? 'instant-draw'
        : 'activated-ability';

    const abilityStackItem: StackItem = {
      id: createStackItemId('ability'),
      controller: 'player',
      controllerName: 'You',
      seatLabel: 'You · Ability',
      cardName: `${ability.permanentName} (${ability.label})`,
      cmc: ability.manaCost,
      typeLine: 'Activated Ability',
      meta: perm.meta,
      mechanic: mappedMechanic,
      mechanicBadge: 'Activated Ability',
      uncounterable: false,
      countered: false,
      targetSummary,
      targetStackItemId: options.targetStackItemId,
      targetPlayerCreatureUid: options.targetPlayerCreatureUid,
      targetPlayerCreatureName,
      targetBotId,
      targetBotName,
      targetBotCreatureUid: options.targetBotCreatureUid,
      targetBotCreatureName,
      protectsWholeBoard: ability.protectsWholeBoard,
      burnDamage: ability.damageAmount,
      pumpPower: ability.pumpPower,
      pumpToughness: ability.pumpToughness,
      isActivatedAbility: true,
      sourcePermanentUid: perm.uid,
      activatedEffectKind: ability.effectKind,
      drawCount: ability.drawCount,
      lifegainAmount: ability.lifegainAmount,
    };

    appendLog(
      `[Stack] Activated ${ability.permanentName} (${ability.label}) — ${targetSummary}.`,
      turn,
      activePhase
    );
    setStackItems((prev) => [...prev, abilityStackItem]);
    setInterruptResetNonce((n) => n + 1);
  };

  // Resolve top item (step-by-step) OR entire Stack in strict LIFO order!
  const resolveStack = (resolveAll: boolean) => {
    if (stackItems.length === 0) return;

    const workingStack: StackItem[] = stackItems.map((i) => ({ ...i }));
    let workingBots: LiveBotState[] = latestGameRef.current.liveBots.map((b) => ({
      ...b,
      creatures: b.creatures.map((c) => ({ ...c })),
      graveyardCards: [...(b.graveyardCards || [])],
      exileCards: [...(b.exileCards || [])],
      customHand: [...b.customHand],
      customLibrary: [...b.customLibrary],
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
    let workingBf: BattlefieldPermanent[] = latestGameRef.current.battlefield.map((p) => ({
      ...p,
    }));
    const addedToGy: SimCardInstance[] = [];
    const addedToExile: SimCardInstance[] = [];
    const returnedToCmdZone: SimCardInstance[] = [];
    const removeFromCmdZoneUids = new Set<string>();
    let extraDrawsTotal = 0;
    let playerLifeDeltaTotal = 0;
    let playerMillTotal = 0;
    let fogActivated = false;
    let resolvedBotSpellSummary = '';

    const stepsToRun = resolveAll ? workingStack.length : 1;

    for (let step = 0; step < stepsToRun; step++) {
      const item = workingStack.pop();
      if (!item) break;

      if (item.countered) {
        if (item.controller === 'player' && item.playerCardPayload) {
          if (!item.playerCardPayload.fromCommandZone) {
            addedToGy.push(item.playerCardPayload);
          }
        } else if (item.controller === 'bot' && item.botSpellPayload) {
          const bp = item.botSpellPayload;
          if (bp.category === 'commander') {
            workingBots = workingBots.map((b) =>
              b.id === bp.botId
                ? { ...b, commanderInZone: true, commanderTax: b.commanderTax + 2 }
                : b
            );
          } else if (bp.category === 'creature') {
            workingBots = workingBots.map((b) =>
              b.id === bp.botId
                ? pushLiveBotZoneCard(b, 'graveyard', {
                    name: bp.cardName,
                    cmc: bp.cmc,
                    typeLine: bp.typeLine,
                    meta: bp.meta,
                    reason: `Countered by ${item.counteredByName || 'You'}`,
                  })
                : b
            );
          }
          resolvedBotSpellSummary = `${bp.cardName} was COUNTERED by ${item.counteredByName || 'You'}!`;
        }
        appendLog(
          `[Stack] ${item.controllerName}'s ${item.cardName} was countered and fizzled.`,
          turn,
          activePhase
        );
        continue;
      }

      // 1. Counterspell resolution
      if (item.mechanic === 'counterspell') {
        const target = workingStack.find((si) => si.id === item.targetStackItemId);
        if (target && !target.countered && !target.uncounterable) {
          target.countered = true;
          target.counteredByName = item.cardName;
          appendLog(
            `[Stack] ${item.controllerName}'s ${item.cardName} COUNTERED ${target.controllerName}'s ${target.cardName}!`,
            turn,
            activePhase
          );

          if (item.controller === 'player' && target.controller === 'bot') {
            const memRes = recordUserActionForBots(
              workingBots,
              {
                type: 'counter-bot-spell',
                turn,
                cardName: item.cardName,
                counteredSpellName: target.cardName,
                targetBotId: target.controllerBotId,
              },
              playerDeckContext,
              { skipReactiveCounter: true }
            );
            workingBots = memRes.updatedBots;
            for (const msg of memRes.adaptationLogs) {
              appendLog(msg, turn, activePhase);
            }
            // Authentic Swan Song bird token for the countered bot!
            if (/swan song/i.test(item.cardName) && target.controllerBotId) {
              workingBots = workingBots.map((b) =>
                b.id === target.controllerBotId
                  ? {
                      ...b,
                      creatures: [
                        ...b.creatures,
                        {
                          flying: true,
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
                          uid: `bot-bird-${b.id}-${Date.now()}`,
                          name: 'Bird Token',
                          power: 2,
                          toughness: 2,
                          tapped: false,
                          summoningSick: true,
                          isCommander: false,
                          hasInfect: false,
                          toxicValue: 0,
                          meta: null,
                        },
                      ],
                    }
                  : b
              );
            }
          }
        } else {
          appendLog(
            `[Stack] ${item.controllerName}'s ${item.cardName} fizzled (no legal target).`,
            turn,
            activePhase
          );
        }
        if (item.controller === 'player' && item.playerCardPayload) {
          addedToGy.push(item.playerCardPayload);
        }
        continue;
      }

      // 2. Player spell resolution
      if (item.controller === 'player' && item.playerCardPayload) {
        const p = item.playerCardPayload;
        if (item.mechanic === 'protection') {
          const pBoost = item.pumpPower || 0;
          const tBoost = item.pumpToughness || 0;
          workingBf = workingBf.map((perm) => {
            const hit = item.protectsWholeBoard
              ? perm.isCreature
              : perm.uid === item.targetPlayerCreatureUid;
            if (!hit) return perm;
            return {
              ...perm,
              protectedUntilEot: true,
              tempPowerBoost: (perm.tempPowerBoost || 0) + pBoost,
              tempToughnessBoost: (perm.tempToughnessBoost || 0) + tBoost,
            };
          });
          if (item.fogsCombat) fogActivated = true;
          addedToGy.push(p);
          const memRes = recordUserActionForBots(
            workingBots,
            {
              type: 'protect-permanent',
              turn,
              cardName: item.cardName,
              targetBotId: pendingBotStackContinuation?.botId,
            },
            playerDeckContext,
            { skipReactiveCounter: true }
          );
          workingBots = memRes.updatedBots;
          appendLog(
            `[Stack] ${item.cardName} resolved — ${
              item.protectsWholeBoard
                ? 'your creatures gained Hexproof & Indestructible until end of turn!'
                : `${item.targetPlayerCreatureName || 'target creature'} is protected until end of turn!`
            }`,
            turn,
            activePhase
          );
        } else if (item.mechanic === 'fog') {
          fogActivated = true;
          addedToGy.push(p);
          appendLog(`[Stack] ${item.cardName} resolved — combat damage prevented this turn!`, turn, activePhase);
        } else if (item.mechanic === 'combat-trick') {
          const pBoost = item.pumpPower || 3;
          const tBoost = item.pumpToughness || 3;
          workingBf = workingBf.map((perm) =>
            perm.uid === item.targetPlayerCreatureUid
              ? {
                  ...perm,
                  tempPowerBoost: (perm.tempPowerBoost || 0) + pBoost,
                  tempToughnessBoost: (perm.tempToughnessBoost || 0) + tBoost,
                }
              : perm
          );
          addedToGy.push(p);
          appendLog(
            `[Stack] ${item.cardName} resolved — ${item.targetPlayerCreatureName || 'creature'} got +${pBoost}/+${tBoost}!`,
            turn,
            activePhase
          );
        } else if (item.mechanic === 'instant-removal') {
          addedToGy.push(p);
          if (item.targetBotId && item.targetBotCreatureUid) {
            workingBots = workingBots.map((b) => {
              if (b.id !== item.targetBotId) return b;
              const targetCr = b.creatures.find((c) => c.uid === item.targetBotCreatureUid);
              if (!targetCr) return b;
              if (targetCr.indestructible && !item.exilesTarget && !item.bouncesTarget) {
                appendLog(
                  `[Stack] ${item.cardName} resolved — ${targetCr.name} is Indestructible and survived!`,
                  turn,
                  activePhase
                );
                return b;
              }
              const cmdRet = targetCr.isCommander && b.allowsCommandZone && !item.bouncesTarget;
              appendLog(
                `[Stack] ${item.cardName} resolved — ${
                  item.bouncesTarget ? 'bounced' : item.exilesTarget ? 'exiled' : 'destroyed'
                } ${b.name}'s ${targetCr.name}!`,
                turn,
                activePhase
              );
              let nextBot: LiveBotState = {
                ...b,
                creatures: b.creatures.filter((c) => c.uid !== targetCr.uid),
                commanderInZone: b.commanderInZone || cmdRet,
                commanderTax: cmdRet ? b.commanderTax + 2 : b.commanderTax,
                handCount: item.bouncesTarget ? b.handCount + 1 : b.handCount,
              };
              if (!item.bouncesTarget && !cmdRet) {
                nextBot = pushLiveBotZoneCard(
                  nextBot,
                  item.exilesTarget ? 'exile' : 'graveyard',
                  createLiveBotZoneCardFromCreature(
                    targetCr,
                    `${item.exilesTarget ? 'Exiled' : 'Destroyed'} by ${item.cardName}`
                  )
                );
              }
              return nextBot;
            });
          }
        } else if (item.mechanic === 'burn-or-drain') {
          addedToGy.push(p);
          const dmg = item.burnDamage || 3;
          if (item.targetBotId) {
            workingBots = workingBots.map((b) => {
              if (b.id !== item.targetBotId) return b;
              if (item.targetBotCreatureUid) {
                const targetCr = b.creatures.find((c) => c.uid === item.targetBotCreatureUid);
                if (targetCr && !targetCr.indestructible && dmg >= targetCr.toughness) {
                  const cmdRet = targetCr.isCommander && b.allowsCommandZone;
                  appendLog(
                    `[Stack] ${item.cardName} dealt ${dmg} dmg and destroyed ${b.name}'s ${targetCr.name}!`,
                    turn,
                    activePhase
                  );
                  let nextBot: LiveBotState = {
                    ...b,
                    creatures: b.creatures.filter((c) => c.uid !== targetCr.uid),
                    commanderInZone: b.commanderInZone || cmdRet,
                    commanderTax: cmdRet ? b.commanderTax + 2 : b.commanderTax,
                  };
                  if (!cmdRet) {
                    nextBot = pushLiveBotZoneCard(
                      nextBot,
                      'graveyard',
                      createLiveBotZoneCardFromCreature(targetCr, `Destroyed by ${item.cardName}`)
                    );
                  }
                  return nextBot;
                }
              }
              const nextLife = Math.max(0, b.life - dmg);
              appendLog(
                `[Stack] ${item.cardName} dealt ${dmg} damage to ${b.name} (${nextLife} HP).`,
                turn,
                activePhase
              );
              return {
                ...b,
                life: nextLife,
                eliminated: nextLife <= 0 ? true : b.eliminated,
                eliminatedReason: nextLife <= 0 ? 'life' : b.eliminatedReason,
              };
            });
          }
        } else if (item.mechanic === 'instant-draw') {
          addedToGy.push(p);
          const drawN = Math.max(1, p.extraDrawCount || 1);
          extraDrawsTotal += drawN;
          if (p.lifegainAmount > 0) playerLifeDeltaTotal += p.lifegainAmount;
          appendLog(
            `[Stack] ${item.cardName} resolved — drew ${drawN} card${drawN === 1 ? '' : 's'}!`,
            turn,
            activePhase
          );
        } else {
          const isPermanent =
            p.fromCommandZone ||
            /\b(creature|artifact|enchantment|planeswalker|battle)\b/i.test(p.typeLine) ||
            (!/\b(instant|sorcery)\b/i.test(p.typeLine) && p.isArtifactOrRock);
          if (isPermanent) {
            if (p.fromCommandZone) removeFromCmdZoneUids.add(p.uid);
            const kw = extractCreatureKeywords(p.meta);
            workingBf.push({
              ...p,
              tapped: false,
              attacking: false,
              summoningSick: p.isCreature && !kw.haste,
            });
            appendLog(
              `[Stack] Your ${item.cardName} resolved and entered the battlefield!`,
              turn,
              activePhase
            );
          } else {
            addedToGy.push(p);
            if (p.extraDrawCount > 0) extraDrawsTotal += p.extraDrawCount;
            if (p.lifegainAmount > 0) playerLifeDeltaTotal += p.lifegainAmount;
            appendLog(`[Stack] Your ${item.cardName} resolved.`, turn, activePhase);
          }
        }
        continue;
      }

      // 2b. Player Activated Ability resolution (non-counterspell; counterspell abilities already resolved in Step 1)
      if (item.controller === 'player' && item.isActivatedAbility) {
        const kind = item.activatedEffectKind;
        if (kind === 'protection') {
          workingBf = workingBf.map((perm) => {
            const hit = item.protectsWholeBoard
              ? perm.isCreature
              : perm.uid === item.targetPlayerCreatureUid;
            return hit ? { ...perm, protectedUntilEot: true } : perm;
          });
          const memRes = recordUserActionForBots(
            workingBots,
            {
              type: 'protect-permanent',
              turn,
              cardName: item.cardName,
              targetBotId: pendingBotStackContinuation?.botId,
            },
            playerDeckContext,
            { skipReactiveCounter: true }
          );
          workingBots = memRes.updatedBots;
          appendLog(
            `[Stack] Ability ${item.cardName} resolved — ${
              item.protectsWholeBoard
                ? 'your creatures gained Hexproof & Indestructible until EOT!'
                : `${item.targetPlayerCreatureName || 'target creature'} is protected until EOT!`
            }`,
            turn,
            activePhase
          );
        } else if (kind === 'pump') {
          const pBoost = item.pumpPower || 1;
          const tBoost = item.pumpToughness || 1;
          workingBf = workingBf.map((perm) =>
            perm.uid === item.targetPlayerCreatureUid
              ? {
                  ...perm,
                  tempPowerBoost: (perm.tempPowerBoost || 0) + pBoost,
                  tempToughnessBoost: (perm.tempToughnessBoost || 0) + tBoost,
                }
              : perm
          );
          appendLog(
            `[Stack] Ability ${item.cardName} resolved — ${item.targetPlayerCreatureName || 'creature'} got +${pBoost}/+${tBoost}.`,
            turn,
            activePhase
          );
        } else if (kind === 'removal-damage') {
          const dmg = item.burnDamage || 1;
          if (item.targetBotId) {
            workingBots = workingBots.map((b) => {
              if (b.id !== item.targetBotId) return b;
              if (item.targetBotCreatureUid) {
                const targetCr = b.creatures.find((c) => c.uid === item.targetBotCreatureUid);
                if (targetCr && !targetCr.indestructible && dmg >= targetCr.toughness) {
                  const cmdRet = targetCr.isCommander && b.allowsCommandZone;
                  appendLog(
                    `[Stack] Ability ${item.cardName} removed ${b.name}'s ${targetCr.name}!`,
                    turn,
                    activePhase
                  );
                  let nextBot: LiveBotState = {
                    ...b,
                    creatures: b.creatures.filter((c) => c.uid !== targetCr.uid),
                    commanderInZone: b.commanderInZone || cmdRet,
                    commanderTax: cmdRet ? b.commanderTax + 2 : b.commanderTax,
                  };
                  if (!cmdRet) {
                    nextBot = pushLiveBotZoneCard(
                      nextBot,
                      'graveyard',
                      createLiveBotZoneCardFromCreature(targetCr, `Removed by ${item.cardName}`)
                    );
                  }
                  return nextBot;
                }
              }
              const nextLife = Math.max(0, b.life - Math.min(dmg, 10));
              appendLog(
                `[Stack] Ability ${item.cardName} dealt ${Math.min(dmg, 10)} damage to ${b.name} (${nextLife} HP).`,
                turn,
                activePhase
              );
              return {
                ...b,
                life: nextLife,
                eliminated: nextLife <= 0 ? true : b.eliminated,
                eliminatedReason: nextLife <= 0 ? 'life' : b.eliminatedReason,
              };
            });
          }
        } else if (kind === 'draw') {
          const drawN = Math.max(1, item.drawCount || 1);
          extraDrawsTotal += drawN;
          appendLog(
            `[Stack] Ability ${item.cardName} resolved — drew ${drawN} card${drawN === 1 ? '' : 's'}.`,
            turn,
            activePhase
          );
        } else if (kind === 'lifegain') {
          const heal = Math.max(1, item.lifegainAmount || 3);
          playerLifeDeltaTotal += heal;
          appendLog(
            `[Stack] Ability ${item.cardName} resolved — gained +${heal} life.`,
            turn,
            activePhase
          );
        } else if (kind === 'scry') {
          const topCard = latestGameRef.current.library[0];
          appendLog(
            topCard
              ? `[Stack] Ability ${item.cardName} resolved — Scry peeked ${topCard.name} on top of library.`
              : `[Stack] Ability ${item.cardName} resolved (Scry).`,
            turn,
            activePhase
          );
        }
        continue;
      }

      // 3. Bot spell resolution
      if (item.controller === 'bot' && item.botSpellPayload) {
        const bp = item.botSpellPayload;
        if (bp.category === 'commander' || bp.category === 'creature') {
          if (bp.creaturePayload) {
            workingBots = workingBots.map((b) =>
              b.id === bp.botId
                ? {
                    ...b,
                    creatures: [...b.creatures, bp.creaturePayload!],
                    liveMemory: {
                      ...b.liveMemory,
                      creaturesPlayedCount: b.liveMemory.creaturesPlayedCount + 1,
                    },
                  }
                : b
            );
          }
          resolvedBotSpellSummary = `${bp.cardName} resolved onto ${bp.botName}'s battlefield.`;
          appendLog(`[Stack] ${bp.botName}'s ${bp.cardName} resolved onto the battlefield.`, turn, 'Combat');
        } else if (bp.category === 'board-wipe') {
          let protectedSavedCount = 0;
          workingBots = workingBots.map((b) => {
            if (b.eliminated) return b;
            const destroyed = b.creatures.filter((c) => !c.indestructible);
            const survivors = b.creatures.filter((c) => c.indestructible);
            let nextBot: LiveBotState = {
              ...b,
              creatures: survivors,
              graveyardCards: [...(b.graveyardCards || [])],
              exileCards: [...(b.exileCards || [])],
            };
            let cmdRet = false;
            for (const d of destroyed) {
              if (d.isCommander && nextBot.allowsCommandZone) {
                cmdRet = true;
              } else {
                nextBot = pushLiveBotZoneCard(
                  nextBot,
                  'graveyard',
                  createLiveBotZoneCardFromCreature(d, `Wiped by ${bp.cardName}`)
                );
              }
            }
            return {
              ...nextBot,
              commanderInZone: nextBot.commanderInZone || cmdRet,
              commanderTax: cmdRet ? nextBot.commanderTax + 2 : nextBot.commanderTax,
            };
          });
          const stayingBf: BattlefieldPermanent[] = [];
          for (const perm of workingBf) {
            const kw = extractCreatureKeywords(perm.meta);
            if (!perm.isCreature || kw.indestructible || perm.protectedUntilEot) {
              if (perm.isCreature && perm.protectedUntilEot) protectedSavedCount += 1;
              stayingBf.push(perm);
            } else if (!perm.isToken) {
              if (perm.isCommander) returnedToCmdZone.push(perm);
              else addedToGy.push(perm);
            }
          }
          workingBf = stayingBf;
          resolvedBotSpellSummary =
            protectedSavedCount > 0
              ? `${bp.cardName} resolved (your ${protectedSavedCount} protected creature${protectedSavedCount === 1 ? '' : 's'} survived!)`
              : `${bp.cardName} wiped non-indestructible creatures.`;
          appendLog(`[Stack] ${bp.botName}'s ${resolvedBotSpellSummary}`, turn, 'Combat');
        } else if (bp.category === 'removal' && bp.targetPlayerCreatureUid) {
          const targetPerm = workingBf.find((p) => p.uid === bp.targetPlayerCreatureUid);
          if (!targetPerm) {
            resolvedBotSpellSummary = `${bp.cardName} fizzled (target already left battlefield).`;
          } else if (targetPerm.protectedUntilEot || extractCreatureKeywords(targetPerm.meta).hexproof) {
            resolvedBotSpellSummary = `${bp.cardName} FIZZLED — your ${targetPerm.name} was protected!`;
          } else {
            workingBf = workingBf.filter((p) => p.uid !== targetPerm.uid);
            if (!targetPerm.isToken) {
              if (targetPerm.isCommander) returnedToCmdZone.push(targetPerm);
              else if (bp.exilesTarget) addedToExile.push(targetPerm);
              else addedToGy.push(targetPerm);
            }
            resolvedBotSpellSummary = `${bp.cardName} ${bp.exilesTarget ? 'exiled' : 'removed'} your ${targetPerm.name}.`;
          }
          appendLog(`[Stack] ${bp.botName}'s ${resolvedBotSpellSummary}`, turn, 'Combat');
        } else if (bp.category === 'burn') {
          const dmg = bp.burnAmount || 2;
          playerLifeDeltaTotal -= dmg;
          if (bp.drainHealAmount) {
            workingBots = workingBots.map((b) =>
              b.id === bp.botId ? { ...b, life: b.life + bp.drainHealAmount! } : b
            );
          }
          resolvedBotSpellSummary = `${bp.cardName} dealt ${dmg} damage to You.`;
          appendLog(`[Stack] ${bp.botName}'s ${resolvedBotSpellSummary}`, turn, 'Combat');
        } else if (bp.category === 'mill') {
          const millAmt = bp.millAmount || 4;
          playerMillTotal += millAmt;
          resolvedBotSpellSummary = `${bp.cardName} milled ${millAmt} cards from your library.`;
          appendLog(`[Stack] ${bp.botName}'s ${resolvedBotSpellSummary}`, turn, 'Combat');
        } else if (bp.category === 'ramp') {
          const bonus = bp.rampManaBonus || 1;
          workingBots = workingBots.map((b) =>
            b.id === bp.botId ? { ...b, manaBonusFromRamp: b.manaBonusFromRamp + bonus } : b
          );
          resolvedBotSpellSummary = `${bp.cardName} resolved (+${bonus} permanent mana acceleration).`;
          appendLog(`[Stack] ${bp.botName}'s ${resolvedBotSpellSummary}`, turn, 'Combat');
        } else if (bp.category === 'draw') {
          const drawN = bp.drawCount || 2;
          workingBots = workingBots.map((b) =>
            b.id === bp.botId
              ? {
                  ...b,
                  handCount: b.handCount + drawN,
                  libraryCount: Math.max(0, b.libraryCount - drawN),
                }
              : b
          );
          resolvedBotSpellSummary = `${bp.cardName} resolved (drew ${drawN} cards).`;
          appendLog(`[Stack] ${bp.botName}'s ${resolvedBotSpellSummary}`, turn, 'Combat');
        }
      }
    }

    // Commit state updates cleanly
    setBattlefield(workingBf);
    if (addedToGy.length > 0) setGraveyard((prev) => [...addedToGy, ...prev]);
    if (addedToExile.length > 0) setExile((prev) => [...addedToExile, ...prev]);
    if (returnedToCmdZone.length > 0) setCommandZone((prev) => [...prev, ...returnedToCmdZone]);
    if (removeFromCmdZoneUids.size > 0) {
      setCommandZone((prev) => prev.filter((c) => !removeFromCmdZoneUids.has(c.uid)));
    }
    if (extraDrawsTotal > 0) handleDrawManual(extraDrawsTotal, false);
    if (playerLifeDeltaTotal !== 0) setYourLife((l) => Math.max(0, l + playerLifeDeltaTotal));
    if (playerMillTotal > 0) {
      setLibrary((prevLib) => {
        const milled = prevLib.slice(0, playerMillTotal);
        const rest = prevLib.slice(playerMillTotal);
        if (milled.length > 0) setGraveyard((prevGy) => [...milled, ...prevGy]);
        return rest;
      });
    }
    if (fogActivated) setCombatFogActive(true);

    setLiveBots(workingBots);
    latestGameRef.current = {
      ...latestGameRef.current,
      liveBots: workingBots,
      battlefield: workingBf,
    };
    setStackItems(workingStack);
    playTabletopSound(soundEnabled, 'tap');

    // If Stack is now empty AND we paused a Bot's turn before Combat, resume that bot's Combat Phase now!
    if (workingStack.length === 0 && pendingBotStackContinuation) {
      const cont = pendingBotStackContinuation;
      setPendingBotStackContinuation(null);

      const snap = latestGameRef.current;
      const freshPlayerSnapshot: PlayerBoardSnapshot = {
        life: Math.max(0, snap.yourLife + playerLifeDeltaTotal),
        poison: snap.yourPoison,
        libraryCount: Math.max(0, snap.library.length - playerMillTotal),
        handCount: snap.hand.length + extraDrawsTotal,
        untappedLandsCount: workingBf.filter((p) => p.isLand && !p.tapped).length,
        deckContext: playerDeckContext,
        canRespondAtInstantSpeed: snap.canRespondAtInstantSpeed,
        hasActivatedAbilityResponse: snap.hasActivatedAbilityResponse,
        interruptAlertsEnabled: snap.interruptAlertsEnabled,
        fullControlPriority: snap.fullControlPriority,
        creatures: workingBf
          .filter((p) => p.isCreature)
          .map((p) => {
            const eff = getEffectivePermanentStats(p);
            const kw = extractCreatureKeywords(p.meta);
            return {
              ...kw,
              hexproof: kw.hexproof || Boolean(p.protectedUntilEot),
              indestructible: kw.indestructible || Boolean(p.protectedUntilEot),
              uid: p.uid,
              name: p.name,
              power: eff.power,
              toughness: eff.toughness,
              tapped: p.tapped,
              isCommander: p.isCommander,
              hasInfect: p.hasInfect,
              toxicValue: p.toxicValue,
            };
          }),
        landsCount: workingBf.filter((p) => p.isLand).length,
        hasCommanderInPlay: workingBf.some((p) => p.isCommander),
      };

      const combatRes = executeBotPostStackCombat(
        cont.botIndex,
        workingBots,
        freshPlayerSnapshot,
        targetsHitThisBotRoundRef.current,
        cont.priorPhaseSteps,
        cont.playedSummaries,
        resolvedBotSpellSummary || `Resolved ${cont.cardName}`
      );

      setLiveBots(combatRes.updatedBots);
      latestGameRef.current = {
        ...latestGameRef.current,
        liveBots: combatRes.updatedBots,
      };
      if (combatRes.playerLifeDelta !== 0) {
        setYourLife((l) => Math.max(0, l + combatRes.playerLifeDelta));
      }
      if (combatRes.playerPoisonDelta !== 0) {
        setYourPoison((p) => Math.min(20, p + combatRes.playerPoisonDelta));
      }
      for (const msg of combatRes.logs) {
        appendLog(`[Seat ${cont.seatNumber} · ${cont.botName}] ${msg}`, snap.turn, 'Combat');
      }

      if (combatRes.pendingAttackOnPlayer) {
        setPendingIncomingAttack(combatRes.pendingAttackOnPlayer);
        setBlockerAssignments({});
        setActiveBotTurnBanner(null);
        setBotStepAwaitingContinue(false);
        return;
      }

      const totalInRound = Math.max(botRoundTotal, botQueueIndices.length + 1);
      const queuePosition = Math.max(1, totalInRound - botQueueIndices.length);
      setActiveBotTurnBanner({
        botName: cont.botName,
        seatNumber: cont.seatNumber,
        queuePosition,
        queueTotal: totalInRound,
        phaseSteps: combatRes.phaseSteps,
        adaptationNote: combatRes.adaptationNote || cont.adaptationNote,
        isLastBotInRound: botQueueIndices.length === 0,
      });
      setBotStepAwaitingContinue(true);
    }
  };

  // Fresh ref for auto-resolving stack when the Interrupt/Response countdown timer expires or Space is pressed
  const resolveStackRef = React.useRef<(resolveAll: boolean) => void>(resolveStack);
  resolveStackRef.current = resolveStack;

  const stackSignature = useMemo(
    () => stackItems.map((i) => i.id).join('|'),
    [stackItems]
  );

  // Initialize / reset the time-limited Interrupt/Response interaction window whenever a new spell/ability enters the Stack
  useEffect(() => {
    if (!hasActiveStack) {
      setInterruptRemainingMs(0);
      setInterruptTotalMs(0);
      setInterruptTimerHeld(false);
      return;
    }

    if (interruptWindowMode === 'manual') {
      setInterruptTotalMs(0);
      setInterruptRemainingMs(0);
      return;
    }

    const baseMs =
      interruptWindowMode === '8s'
        ? 8000
        : interruptWindowMode === '20s'
        ? 20000
        : 12000;

    const hasAnyReadyResponse =
      canRespondAtInstantSpeed ||
      availableActivatedAbilities.some((a) => a.canActivate) ||
      fullControlPriority ||
      stackItems.length > 1;

    // Brisk 4s alert glance when no instant/ability is ready; full response window when player can respond
    const windowMs = hasAnyReadyResponse ? baseMs : 4000;
    setInterruptTotalMs(windowMs);
    setInterruptRemainingMs(windowMs);
    setInterruptTimerHeld(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasActiveStack, stackSignature, interruptResetNonce, interruptWindowMode]);

  // Live 100ms countdown tick for the Interrupt/Response window (auto-resolves stack at 0.0s unless held)
  useEffect(() => {
    if (
      !hasActiveStack ||
      interruptWindowMode === 'manual' ||
      interruptTotalMs <= 0 ||
      interruptTimerHeld ||
      isSimulationFinished
    ) {
      return;
    }

    const tick = window.setInterval(() => {
      setInterruptRemainingMs((prev) => {
        const next = Math.max(0, prev - 100);
        if (next === 0 && prev > 0) {
          window.setTimeout(() => {
            resolveStackRef.current(true);
          }, 0);
        }
        return next;
      });
    }, 100);

    return () => window.clearInterval(tick);
  }, [
    hasActiveStack,
    interruptWindowMode,
    interruptTotalMs,
    interruptTimerHeld,
    isSimulationFinished,
  ]);

  // Keyboard shortcuts during active Interrupt/Response window: H = Hold/Resume Timer, Space = Pass & Resolve
  useEffect(() => {
    if (!hasActiveStack || isSimulationFinished) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === 'h' || e.key === 'H') {
        if (interruptWindowMode !== 'manual') {
          e.preventDefault();
          setInterruptTimerHeld((prev) => !prev);
        }
      } else if (e.code === 'Space') {
        e.preventDefault();
        resolveStackRef.current(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hasActiveStack, interruptWindowMode, isSimulationFinished]);

  const handleNextPhase = () => {
    if (botQueueIndices.length > 0 || pendingIncomingAttack || hasActiveStack || isSimulationFinished) return;
    if (phaseIdx < PHASES.length - 1) {
      goToPhase(phaseIdx + 1, false, turn);
    } else {
      handlePassTurn();
    }
  };

  const handlePrevPhase = () => {
    if (botQueueIndices.length > 0 || pendingIncomingAttack || hasActiveStack || isSimulationFinished) return;
    if (phaseIdx > 0) {
      const prevIdx = phaseIdx - 1;
      setPhaseIdx(prevIdx);
      appendLog(`Stepped back to ${PHASES[prevIdx]} phase.`, turn, PHASES[prevIdx]);
    }
  };

  const handleDrawManual = (count = 1, incrementTurnOnDraw = true) => {
    if (library.length === 0) {
      appendLog('Library is empty — no cards left to draw.');
      return;
    }
    const drawn = library.slice(0, count);
    const rest = library.slice(count);
    setLibrary(rest);
    setHand((prevHand) => [...prevHand, ...drawn]);
    setLastDrawnUids(drawn.map((d) => d.uid));
    setCardsDrawnCount((c) => c + drawn.length);
    playTabletopSound(soundEnabled, 'draw');
    if (incrementTurnOnDraw) {
      commitCurrentTurnDuration(turn);
      const nextTurn = turn + 1;
      setTurn(nextTurn);
      setPhaseIdx(2);
      setDrawnInDrawStep(true);
      setLandsPlayedThisTurn(0);
      appendLog(
        `Drew ${drawn.map((d) => d.name).join(', ')} — Turn Counter advanced to Turn ${nextTurn} (Draw phase).`,
        nextTurn,
        'Draw'
      );
    } else {
      appendLog(`Drew ${drawn.map((d) => d.name).join(', ')}.`);
    }
  };

  const handlePlayLandFromHand = (card: SimCardInstance) => {
    const isTapped = Boolean(card.meta?.entersTappedLikely);
    setHand((prev) => prev.filter((c) => c.uid !== card.uid));
    setBattlefield((prev) => [
      ...prev,
      { ...card, tapped: isTapped, attacking: false, summoningSick: false },
    ]);
    setLandsPlayedThisTurn((n) => n + 1);
    playTabletopSound(soundEnabled, 'land');
    appendLog(`Played land: ${card.name}${isTapped ? ' (enters tapped)' : ''}.`);
    dispatchUserActionToBots({
      type: 'play-land',
      turn,
      cardName: card.name,
      isTappedLand: isTapped,
    });
  };

  const spendManaForSpell = (manaCost: string, totalCost: number): boolean => {
    if (totalCost <= 0) return true;
    const directResult = deductManaFromPool(manaPool, manaCost, totalCost);
    if (directResult) {
      setManaPool(directResult);
      return true;
    }

    // Auto-tap available untapped lands / mana rocks if user hasn't pre-tapped them
    const neededAdditional = totalCost - sumManaPool(manaPool);
    const availableTappers = battlefield.filter(
      (b) => !b.tapped && (b.isLand || b.isArtifactOrRock)
    );
    if (availableTappers.length < neededAdditional) {
      return false;
    }

    const tapIds = new Set<string>();
    const workingPool: ManaPoolState = { ...manaPool };
    for (const tapper of availableTappers) {
      if (tapIds.size >= neededAdditional) break;
      tapIds.add(tapper.uid);
      const color = tapper.producedMana[0] || 'C';
      const qty = /\bsol ring|mana crypt|mana vault|ancient tomb\b/i.test(tapper.name) ? 2 : 1;
      workingPool[color] += qty;
    }

    const postTapDeduction = deductManaFromPool(workingPool, manaCost, totalCost);
    if (!postTapDeduction) return false;

    setBattlefield((prev) =>
      prev.map((perm) => (tapIds.has(perm.uid) ? { ...perm, tapped: true } : perm))
    );
    setManaPool(postTapDeduction);
    return true;
  };

  const handleCastFromHand = (card: SimCardInstance) => {
    const paid = spendManaForSpell(card.meta?.manaCost || '', card.cmc);
    if (!paid) {
      appendLog(`Not enough mana in pool or untapped lands to cast ${card.name} (MV ${card.cmc}).`);
      return;
    }

    setHand((prev) => prev.filter((c) => c.uid !== card.uid));

    const spellUncounterable = isSpellUncounterable(card.name, card.meta);

    // Bots observe your cast immediately (and Control bots that held open mana can put a counterspell on the Stack!)
    const reaction = dispatchUserActionToBots(
      {
        type: card.isArtifactOrRock || card.meta?.isRamp
          ? 'cast-ramp'
          : card.isCreature
          ? 'cast-creature'
          : 'cast-spell',
        turn,
        cardName: card.name,
        cmc: card.cmc,
        power: card.power,
        toughness: Number(card.meta?.toughness) || Math.max(2, card.power),
      },
      undefined,
      { targetSpellUncounterable: spellUncounterable }
    );

    if (reaction.counteredByBotName && reaction.counterSpellName) {
      const profile = classifyCardStackProfile(card.name, card.typeLine, card.meta);
      const playerItemId = createStackItemId('player');
      const counterMeta = findMeta(reaction.counterSpellName);
      const playerStackItem: StackItem = {
        id: playerItemId,
        controller: 'player',
        controllerName: 'You',
        seatLabel: 'You',
        cardName: card.name,
        cmc: card.cmc,
        typeLine: card.typeLine,
        meta: card.meta,
        mechanic: profile.mechanic,
        mechanicBadge: card.isCreature ? 'Creature' : profile.mechanicLabel,
        uncounterable: spellUncounterable,
        countered: false,
        targetSummary: card.isCreature
          ? `Your Battlefield (${card.power}/${Number(card.meta?.toughness) || Math.max(2, card.power)})`
          : 'Resolves to Tabletop',
        playerCardPayload: {
          ...card,
          toughness: Number(card.meta?.toughness) || Math.max(2, card.power),
        },
      };
      const botCounterItem: StackItem = {
        id: createStackItemId('bot-counter'),
        controller: 'bot',
        controllerBotId: reaction.counteredByBotId || undefined,
        controllerName: reaction.counteredByBotName,
        seatLabel: `Seat ${reaction.counteredBySeatNumber || 2} · ${reaction.counteredByBotName}`,
        cardName: reaction.counterSpellName,
        cmc: reaction.counterSpellCmc || 2,
        typeLine: counterMeta?.typeLine || 'Instant',
        meta: counterMeta,
        mechanic: 'counterspell',
        mechanicBadge: 'Counterspell',
        uncounterable: isSpellUncounterable(reaction.counterSpellName, counterMeta),
        countered: false,
        targetSummary: `Counter Your ${card.name}`,
        targetStackItemId: playerItemId,
        botReactionNote: reaction.counterReason || undefined,
      };
      setStackItems([playerStackItem, botCounterItem]);
      playTabletopSound(soundEnabled, 'combat');
      appendLog(
        `Cast ${card.name} (${card.cmc} mana) — ${reaction.counteredByBotName} put ${reaction.counterSpellName} on the Stack! Respond or resolve.`
      );
      return;
    }

    const isPermanent =
      /\b(creature|artifact|enchantment|planeswalker|battle)\b/i.test(card.typeLine) ||
      (!/\b(instant|sorcery)\b/i.test(card.typeLine) && card.isArtifactOrRock);

    const cardKw = extractCreatureKeywords(card.meta);
    if (isPermanent) {
      setBattlefield((prev) => [
        ...prev,
        { ...card, tapped: false, attacking: false, summoningSick: card.isCreature && !cardKw.haste },
      ]);
    } else {
      setGraveyard((prev) => [card, ...prev]);
    }

    if (card.extraDrawCount > 0) {
      handleDrawManual(card.extraDrawCount, false);
    }
    if (card.lifegainAmount > 0) {
      setYourLife((l) => l + card.lifegainAmount);
    }
    playTabletopSound(soundEnabled, 'cast');
    appendLog(`Cast ${card.name} (${card.cmc} mana).`);
  };

  const handleCastCommander = (cmd: SimCardInstance) => {
    const tax = commanderTaxByUid[cmd.uid] || 0;
    const totalCost = cmd.cmc + tax;
    const paid = spendManaForSpell(cmd.meta?.manaCost || '', totalCost);
    if (!paid) {
      appendLog(
        `Need ${totalCost} mana (${cmd.cmc} + ${tax} tax) in pool or untapped lands to cast ${cmd.name}.`
      );
      return;
    }

    setCommanderTaxByUid((prev) => ({ ...prev, [cmd.uid]: tax + 2 }));

    const cmdUncounterable = isSpellUncounterable(cmd.name, cmd.meta);

    const reaction = dispatchUserActionToBots(
      {
        type: 'cast-commander',
        turn,
        cardName: cmd.name,
        cmc: totalCost,
        power: cmd.power,
        toughness: Number(cmd.meta?.toughness) || Math.max(2, cmd.power),
        isCommander: true,
      },
      undefined,
      { targetSpellUncounterable: cmdUncounterable }
    );

    if (reaction.counteredByBotName && reaction.counterSpellName) {
      const playerItemId = createStackItemId('player-cmd');
      const counterMeta = findMeta(reaction.counterSpellName);
      const playerCmdItem: StackItem = {
        id: playerItemId,
        controller: 'player',
        controllerName: 'You',
        seatLabel: 'You',
        cardName: cmd.name,
        cmc: totalCost,
        typeLine: cmd.typeLine,
        meta: cmd.meta,
        mechanic: 'commander',
        mechanicBadge: 'Commander',
        uncounterable: cmdUncounterable,
        countered: false,
        targetSummary: `Your Battlefield (${cmd.power}/${Number(cmd.meta?.toughness) || Math.max(2, cmd.power)} Commander)`,
        playerCardPayload: {
          ...cmd,
          toughness: Number(cmd.meta?.toughness) || Math.max(2, cmd.power),
          fromCommandZone: true,
        },
      };
      const botCounterItem: StackItem = {
        id: createStackItemId('bot-counter'),
        controller: 'bot',
        controllerBotId: reaction.counteredByBotId || undefined,
        controllerName: reaction.counteredByBotName,
        seatLabel: `Seat ${reaction.counteredBySeatNumber || 2} · ${reaction.counteredByBotName}`,
        cardName: reaction.counterSpellName,
        cmc: reaction.counterSpellCmc || 2,
        typeLine: counterMeta?.typeLine || 'Instant',
        meta: counterMeta,
        mechanic: 'counterspell',
        mechanicBadge: 'Counterspell',
        uncounterable: isSpellUncounterable(reaction.counterSpellName, counterMeta),
        countered: false,
        targetSummary: `Counter Your Commander ${cmd.name}`,
        targetStackItemId: playerItemId,
        botReactionNote: reaction.counterReason || undefined,
      };
      setStackItems([playerCmdItem, botCounterItem]);
      playTabletopSound(soundEnabled, 'combat');
      appendLog(
        `Cast Commander ${cmd.name} (${totalCost} mana) — ${reaction.counteredByBotName} put ${reaction.counterSpellName} on the Stack! Fight back or resolve.`
      );
      return;
    }

    const cmdKw = extractCreatureKeywords(cmd.meta);
    setCommandZone((prev) => prev.filter((c) => c.uid !== cmd.uid));
    setBattlefield((prev) => [
      ...prev,
      { ...cmd, tapped: false, attacking: false, summoningSick: !cmdKw.haste },
    ]);
    playTabletopSound(soundEnabled, 'cast');
    appendLog(`Cast Commander ${cmd.name} for ${totalCost} mana.`);
  };

  const handleTogglePermanentTap = (perm: BattlefieldPermanent) => {
    const nextTapped = !perm.tapped;
    setBattlefield((prev) =>
      prev.map((p) => (p.uid === perm.uid ? { ...p, tapped: nextTapped } : p))
    );
    playTabletopSound(soundEnabled, 'tap');

    if (nextTapped && (perm.isLand || perm.isArtifactOrRock)) {
      const color = perm.producedMana[0] || 'C';
      const amount = /\bsol ring|mana crypt|mana vault|ancient tomb\b/i.test(perm.name) ? 2 : 1;
      setManaPool((prev) => ({ ...prev, [color]: prev[color] + amount }));
      appendLog(`Tapped ${perm.name} for +${amount}{${color}}.`);
    }
  };

  const handleTapAllUntappedLands = () => {
    const additions: ManaPoolState = { ...EMPTY_POOL };
    let count = 0;
    setBattlefield((prev) =>
      prev.map((perm) => {
        if (perm.isLand && !perm.tapped) {
          const c = perm.producedMana[0] || 'C';
          const amt = /\bancient tomb\b/i.test(perm.name) ? 2 : 1;
          additions[c] += amt;
          count++;
          return { ...perm, tapped: true };
        }
        return perm;
      })
    );
    if (count > 0) {
      setManaPool((prev) => ({
        W: prev.W + additions.W,
        U: prev.U + additions.U,
        B: prev.B + additions.B,
        R: prev.R + additions.R,
        G: prev.G + additions.G,
        C: prev.C + additions.C,
      }));
      appendLog(`Tapped ${count} untapped land${count === 1 ? '' : 's'} into Mana Pool.`);
      if (hasActiveStack) {
        setInterruptResetNonce((n) => n + 1);
      }
    }
  };

  const handleUntapAll = () => {
    setBattlefield((prev) => prev.map((p) => ({ ...p, tapped: false })));
    appendLog('Manually untapped all battlefield permanents.');
  };

  const handleToggleAttacker = (uid: string) => {
    setBattlefield((prev) =>
      prev.map((p) => (p.uid === uid ? { ...p, attacking: !p.attacking } : p))
    );
  };

  const handleReturnCommanderToZone = (perm: BattlefieldPermanent) => {
    setBattlefield((prev) => prev.filter((p) => p.uid !== perm.uid));
    setCommandZone((prev) => [...prev, perm]);
    appendLog(`Returned ${perm.name} to Command Zone.`);
  };

  const handleMovePermanentToGy = (perm: BattlefieldPermanent) => {
    setBattlefield((prev) => prev.filter((p) => p.uid !== perm.uid));
    if (perm.isToken) {
      appendLog(`Removed ${perm.name} token from battlefield.`);
    } else if (perm.isCommander) {
      setCommandZone((prev) => [...prev, perm]);
      appendLog(`${perm.name} left battlefield to Command Zone.`);
    } else {
      setGraveyard((prev) => [perm, ...prev]);
      appendLog(`Moved ${perm.name} to Graveyard.`);
    }
  };

  const handleCreateToken = (blueprint: TabletopTokenBlueprint) => {
    const qty = Math.max(1, Math.min(10, blueprint.quantity || 1));
    const isCreature = blueprint.kind === 'creature';
    const hasHaste = blueprint.keywords.some((k) => /haste/i.test(k));
    const hasInfect = blueprint.keywords.some((k) => /infect/i.test(k));
    const typeLine =
      blueprint.kind === 'creature'
        ? `Token Creature — ${blueprint.name}`
        : blueprint.kind === 'artifact'
        ? `Token Artifact — ${blueprint.name}`
        : `Token Enchantment — ${blueprint.name}`;

    const created: BattlefieldPermanent[] = [];
    for (let i = 0; i < qty; i++) {
      const tokenMeta: CardMetadata = {
        name: blueprint.name,
        manaCost: '',
        cmc: 0,
        typeLine,
        oracleText: blueprint.keywords.join(', '),
        colors: [],
        colorIdentity: [],
        producedMana: blueprint.tokenAbility === 'treasure' ? ['W', 'U', 'B', 'R', 'G'] : [],
        power: isCreature ? String(blueprint.power) : undefined,
        toughness: isCreature ? String(blueprint.toughness) : undefined,
        isLand: false,
        isMdfcLand: false,
        entersTappedLikely: false,
        isRamp: blueprint.tokenAbility === 'treasure',
        isDraw: blueprint.tokenAbility === 'clue' || blueprint.tokenAbility === 'blood',
        isRemoval: false,
        isBoardWipe: false,
        isProtection: false,
        imageUri: '',
        priceUsd: null,
        scryfallUri: '',
        legalInFormat: true,
        rarity: 'common',
      };

      created.push({
        uid: `token-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
        name: blueprint.name,
        cmc: 0,
        typeLine,
        isLand: false,
        isCreature,
        isCommander: false,
        isArtifactOrRock: false,
        producedMana: blueprint.tokenAbility === 'treasure' ? ['W', 'U', 'B', 'R', 'G'] : [],
        power: isCreature ? blueprint.power : 0,
        baseToughness: isCreature ? blueprint.toughness : 0,
        toxicValue: 0,
        hasInfect,
        extraDrawCount: 0,
        lifegainAmount: 0,
        meta: tokenMeta,
        tapped: false,
        attacking: false,
        summoningSick: isCreature && !hasHaste,
        isToken: true,
        tokenAbility: blueprint.tokenAbility || 'none',
      });
    }

    setBattlefield((prev) => [...prev, ...created]);
    playTabletopSound(soundEnabled, 'cast');
    appendLog(
      `Created ${qty}× ${blueprint.name} token${qty === 1 ? '' : 's'}${
        isCreature ? ` (${blueprint.power}/${blueprint.toughness})` : ''
      }${blueprint.keywords.length > 0 ? ` [${blueprint.keywords.join(', ')}]` : ''}.`
    );

    if (isCreature && liveBotMode) {
      dispatchUserActionToBots({
        type: 'cast-creature',
        turn,
        cardName: `${qty > 1 ? `${qty}x ` : ''}${blueprint.name} Token`,
        cmc: 0,
        power: blueprint.power * qty,
        toughness: blueprint.toughness,
      });
    }
  };

  const handleActivateTokenAbility = (perm: BattlefieldPermanent) => {
    setBattlefield((prev) => prev.filter((p) => p.uid !== perm.uid));
    if (perm.tokenAbility === 'treasure') {
      setManaPool((prev) => ({ ...prev, C: prev.C + 1 }));
      playTabletopSound(soundEnabled, 'tap');
      appendLog(`Sacrificed ${perm.name} token for +1 mana (added to Mana Pool).`);
    } else if (perm.tokenAbility === 'food') {
      setYourLife((l) => l + 3);
      playTabletopSound(soundEnabled, 'cast');
      appendLog(`Sacrificed ${perm.name} token to gain +3 life.`);
    } else if (perm.tokenAbility === 'clue' || perm.tokenAbility === 'blood') {
      handleDrawManual(1, false);
      appendLog(`Sacrificed ${perm.name} token to draw 1 card.`);
    }
  };

  const handleAdjustPermanentCounter = (uid: string, counterKey: string, delta: number) => {
    const target = battlefield.find((p) => p.uid === uid);
    setBattlefield((prev) =>
      prev.map((perm) => {
        if (perm.uid !== uid) return perm;
        if (counterKey === '+1/+1') {
          const next = Math.max(0, (perm.plusOneCounters || 0) + delta);
          return { ...perm, plusOneCounters: next };
        }
        if (counterKey === '-1/-1') {
          const next = Math.max(0, (perm.minusOneCounters || 0) + delta);
          return { ...perm, minusOneCounters: next };
        }
        const nextOther = { ...(perm.otherCounters || {}) };
        const nextVal = Math.max(0, (nextOther[counterKey] || 0) + delta);
        if (nextVal === 0) {
          delete nextOther[counterKey];
        } else {
          nextOther[counterKey] = nextVal;
        }
        return { ...perm, otherCounters: nextOther };
      })
    );
    if (target) {
      appendLog(
        `${delta > 0 ? 'Added' : 'Removed'} ${Math.abs(delta)} ${counterKey} counter${
          Math.abs(delta) === 1 ? '' : 's'
        } ${delta > 0 ? 'on' : 'from'} ${target.name}.`
      );
    }
  };

  const handleAdjustPlayerCounter = (label: string, delta: number) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    setPlayerCounters((prev) => {
      const next = { ...prev };
      const nextVal = Math.max(0, (next[trimmed] || 0) + delta);
      if (nextVal === 0) {
        delete next[trimmed];
      } else {
        next[trimmed] = nextVal;
      }
      return next;
    });
    appendLog(
      `${delta > 0 ? '+' : ''}${delta} ${trimmed} player counter${Math.abs(delta) === 1 ? '' : 's'}.`
    );
  };

  const handleToggleMonarch = () => {
    setIsMonarch((prev) => {
      const next = !prev;
      appendLog(next ? 'You became the Monarch.' : 'You are no longer the Monarch.');
      return next;
    });
  };

  const handleReorderBattlefield = (sourceUid: string, targetUid: string) => {
    if (sourceUid === targetUid) return;
    setBattlefield((prev) => {
      const fromIdx = prev.findIndex((p) => p.uid === sourceUid);
      const toIdx = prev.findIndex((p) => p.uid === targetUid);
      if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return prev;
      const copy = [...prev];
      const [moved] = copy.splice(fromIdx, 1);
      copy.splice(toIdx, 0, moved);
      return copy;
    });
  };

  const handleDiscardFromHand = (card: SimCardInstance) => {
    setHand((prev) => prev.filter((c) => c.uid !== card.uid));
    setGraveyard((prev) => [card, ...prev]);
    playTabletopSound(soundEnabled, 'tap');
    appendLog(`Discarded ${card.name} to Graveyard.`);
  };

  const handleExileFromHand = (card: SimCardInstance) => {
    setHand((prev) => prev.filter((c) => c.uid !== card.uid));
    setExile((prev) => [card, ...prev]);
    playTabletopSound(soundEnabled, 'tap');
    appendLog(`Exiled ${card.name} from Hand.`);
  };

  const handleMovePermanentToExile = (perm: BattlefieldPermanent) => {
    setBattlefield((prev) => prev.filter((p) => p.uid !== perm.uid));
    if (perm.isToken) {
      appendLog(`Exiled ${perm.name} token (token ceased to exist).`);
    } else if (perm.isCommander) {
      setCommandZone((prev) => [...prev, perm]);
      appendLog(`${perm.name} was exiled and returned to Command Zone.`);
    } else {
      setExile((prev) => [perm, ...prev]);
      appendLog(`Exiled ${perm.name} from Battlefield.`);
    }
    playTabletopSound(soundEnabled, 'tap');
  };

  const handleBouncePermanentToHand = (perm: BattlefieldPermanent) => {
    setBattlefield((prev) => prev.filter((p) => p.uid !== perm.uid));
    if (perm.isToken) {
      appendLog(`Bounced ${perm.name} token (token ceased to exist).`);
      return;
    }
    const cleanCard: SimCardInstance = {
      uid: perm.uid,
      name: perm.name,
      cmc: perm.cmc,
      typeLine: perm.typeLine,
      isLand: perm.isLand,
      isCreature: perm.isCreature,
      isCommander: perm.isCommander,
      isArtifactOrRock: perm.isArtifactOrRock,
      producedMana: perm.producedMana,
      power: perm.power,
      toxicValue: perm.toxicValue,
      hasInfect: perm.hasInfect,
      extraDrawCount: perm.extraDrawCount,
      lifegainAmount: perm.lifegainAmount,
      meta: perm.meta,
    };
    setHand((prev) => [...prev, cleanCard]);
    playTabletopSound(soundEnabled, 'draw');
    appendLog(`Returned ${perm.name} from Battlefield to Hand.`);
  };

  const handleMovePlayerZoneCard = (
    fromZone: 'graveyard' | 'exile',
    cardUid: string,
    destination: 'battlefield' | 'hand' | 'graveyard' | 'exile'
  ) => {
    if (fromZone === destination) return;
    const sourceList = fromZone === 'graveyard' ? graveyard : exile;
    const card = sourceList.find((c) => c.uid === cardUid);
    if (!card) return;

    if (fromZone === 'graveyard') {
      setGraveyard((prev) => prev.filter((c) => c.uid !== cardUid));
    } else {
      setExile((prev) => prev.filter((c) => c.uid !== cardUid));
    }

    const fromLabel = fromZone === 'graveyard' ? 'Graveyard' : 'Exile';

    if (destination === 'battlefield') {
      const kw = extractCreatureKeywords(card.meta);
      setBattlefield((prev) => [
        ...prev,
        {
          ...card,
          tapped: false,
          attacking: false,
          summoningSick: card.isCreature && !kw.haste,
        },
      ]);
      playTabletopSound(soundEnabled, 'cast');
      appendLog(`Returned ${card.name} from ${fromLabel} onto the Battlefield.`);
    } else if (destination === 'hand') {
      setHand((prev) => [...prev, card]);
      playTabletopSound(soundEnabled, 'draw');
      appendLog(`Returned ${card.name} from ${fromLabel} to Hand.`);
    } else if (destination === 'graveyard') {
      setGraveyard((prev) => [card, ...prev]);
      playTabletopSound(soundEnabled, 'tap');
      appendLog(`Moved ${card.name} from Exile to Graveyard.`);
    } else {
      setExile((prev) => [card, ...prev]);
      playTabletopSound(soundEnabled, 'tap');
      appendLog(`Exiled ${card.name} from Graveyard.`);
    }
  };

  const handleReturnTopGraveyardToBattlefield = () => {
    if (graveyard.length === 0) return;
    handleMovePlayerZoneCard('graveyard', graveyard[0].uid, 'battlefield');
  };

  const handleReturnTopGraveyardToHand = () => {
    if (graveyard.length === 0) return;
    handleMovePlayerZoneCard('graveyard', graveyard[0].uid, 'hand');
  };

  const handleReturnTopExileToBattlefield = () => {
    if (exile.length === 0) return;
    handleMovePlayerZoneCard('exile', exile[0].uid, 'battlefield');
  };

  const handleReturnTopExileToHand = () => {
    if (exile.length === 0) return;
    handleMovePlayerZoneCard('exile', exile[0].uid, 'hand');
  };

  const handleDragAttackOpponent = (permUid: string, opponentId: string) => {
    const attacker = battlefield.find((p) => p.uid === permUid);
    if (!attacker || !attacker.isCreature || attacker.tapped) return;
    setSelectedCombatTargetId(opponentId);
    if (phaseIdx < 4) {
      setPhaseIdx(4); // Jump cleanly into Combat phase when dragging a creature onto an opponent seat
    }
    setBattlefield((prev) =>
      prev.map((p) => (p.uid === permUid ? { ...p, attacking: true } : p))
    );
    const targetName =
      (liveBotMode
        ? liveBots.find((b) => b.id === opponentId)?.name
        : opponentTrackers.find((o) => o.id === opponentId)?.name) || 'Opponent';
    playTabletopSound(soundEnabled, 'tap');
    appendLog(`Declared ${attacker.name} attacking ${targetName} (click Deal Damage to resolve).`);
  };

  const handleResolveCombat = () => {
    const attackers = battlefield.filter((p) => p.attacking);
    const targetBot = liveBotMode
      ? liveBots.find((b) => b.id === selectedCombatTargetId && !b.eliminated) ||
        liveBots.find((b) => !b.eliminated)
      : null;
    const targetOpp =
      opponentTrackers.find((o) => o.id === selectedCombatTargetId) || opponentTrackers[0];

    if (attackers.length === 0 || (!targetBot && !targetOpp)) {
      appendLog('Declare at least one attacking creature before resolving combat.');
      return;
    }

    if (liveBotMode && targetBot) {
      const combatRes = resolveBotBlocksForPlayerAttack(
        targetBot,
        attackers.map((a) => {
          const eff = getEffectivePermanentStats(a);
          return {
            uid: a.uid,
            name: a.name,
            power: eff.power,
            toughness: eff.toughness,
            isCommander: a.isCommander,
            hasInfect: a.hasInfect,
            toxicValue: a.toxicValue,
            keywords: extractCreatureKeywords(a.meta),
          };
        }),
        formatRules.usesCommanderDamage21
      );

      const deadPlayerAtkSet = new Set(combatRes.deadPlayerAtkUids);
      const deadBotBlockerSet = new Set(combatRes.deadBotBlockerUids);

      if (combatRes.playerLifeGain > 0) {
        setYourLife((l) => l + combatRes.playerLifeGain);
      }

      setBattlefield((prev) => {
        const next: BattlefieldPermanent[] = [];
        const retCmds: SimCardInstance[] = [];
        const gyAdds: SimCardInstance[] = [];
        for (const p of prev) {
          if (deadPlayerAtkSet.has(p.uid)) {
            if (p.isToken) continue;
            if (p.isCommander) retCmds.push(p);
            else gyAdds.push(p);
          } else if (p.attacking) {
            const pKw = extractCreatureKeywords(p.meta);
            next.push({ ...p, tapped: pKw.vigilance ? p.tapped : true, attacking: false });
          } else {
            next.push(p);
          }
        }
        if (retCmds.length > 0) setCommandZone((cz) => [...cz, ...retCmds]);
        if (gyAdds.length > 0) setGraveyard((gy) => [...gyAdds, ...gy]);
        return next;
      });

      const nextBotsAfterCombat = latestGameRef.current.liveBots.map((b) => {
        if (b.id !== targetBot.id) return b;
        const nextLife = Math.max(0, b.life + combatRes.botLifeGain - combatRes.lifeDmgToBot);
        const nextPoison = Math.min(20, b.poison + combatRes.poisonDmgToBot);
        const nextCmdr =
          b.commanderDamageTakenFromYou +
          (formatRules.usesCommanderDamage21 ? combatRes.cmdrDmgToBot : 0);
        const eliminatedReason =
          nextPoison >= 10
            ? 'poison'
            : formatRules.usesCommanderDamage21 && nextCmdr >= 21
            ? 'commander'
            : nextLife <= 0
            ? 'life'
            : b.eliminatedReason;
        const eliminated = Boolean(eliminatedReason);
        let nextBot: LiveBotState = {
          ...b,
          graveyardCards: [...(b.graveyardCards || [])],
          exileCards: [...(b.exileCards || [])],
        };
        let cmdBack = false;
        const survivingCreatures = eliminated
          ? []
          : b.creatures.filter((c) => {
              if (!deadBotBlockerSet.has(c.uid)) return true;
              if (c.isCommander && b.allowsCommandZone) {
                cmdBack = true;
              } else {
                nextBot = pushLiveBotZoneCard(
                  nextBot,
                  'graveyard',
                  createLiveBotZoneCardFromCreature(c, 'Killed blocking')
                );
              }
              return false;
            });

        return {
          ...nextBot,
          life: nextLife,
          poison: nextPoison,
          commanderDamageTakenFromYou: nextCmdr,
          eliminated,
          eliminatedReason,
          creatures: survivingCreatures,
          commanderInZone: nextBot.commanderInZone || cmdBack,
          commanderTax: cmdBack ? nextBot.commanderTax + 2 : nextBot.commanderTax,
        };
      });

      // Bots learn immediately from your attack & threat focus!
      dispatchUserActionToBots(
        {
          type: 'attack-bot',
          turn,
          targetBotId: targetBot.id,
          damageDealt: combatRes.lifeDmgToBot,
          poisonDealt: combatRes.poisonDmgToBot,
          commanderDamageDealt: combatRes.cmdrDmgToBot,
          cardName: attackers[0]?.name,
        },
        nextBotsAfterCombat
      );

      const parts: string[] = [...combatRes.blockMessages];
      if (combatRes.lifeDmgToBot > 0) parts.push(`${combatRes.lifeDmgToBot} damage`);
      if (combatRes.cmdrDmgToBot > 0) parts.push(`${combatRes.cmdrDmgToBot} Commander dmg`);
      if (combatRes.poisonDmgToBot > 0) parts.push(`${combatRes.poisonDmgToBot} poison`);
      if (combatRes.playerLifeGain > 0) parts.push(`+${combatRes.playerLifeGain} lifelink`);
      if (combatRes.botLifeGain > 0) parts.push(`${targetBot.name} +${combatRes.botLifeGain} lifelink`);
      playTabletopSound(soundEnabled, 'combat');
      appendLog(
        `Attacked ${targetBot.name} with ${attackers.map((a) => a.name).join(', ')}: ${parts.join(', ') || 'blocked'}.`
      );
      return;
    }

    if (!targetOpp) return;

    let lifeDmg = 0;
    let cmdrDmg = 0;
    let poisonDmg = 0;

    for (const atk of attackers) {
      const eff = getEffectivePermanentStats(atk);
      if (atk.hasInfect) {
        poisonDmg += eff.power;
      } else {
        lifeDmg += eff.power;
        if (atk.toxicValue > 0) poisonDmg += atk.toxicValue;
      }
      if (atk.isCommander) {
        cmdrDmg += eff.power;
      }
    }

    setBattlefield((prev) =>
      prev.map((p) => {
        if (!p.attacking) return p;
        const pKw = extractCreatureKeywords(p.meta);
        return { ...p, tapped: pKw.vigilance ? p.tapped : true, attacking: false };
      })
    );

    setOpponentTrackers((prev) =>
      prev.map((o) =>
        o.id === targetOpp.id
          ? {
              ...o,
              life: Math.max(0, o.life - lifeDmg),
              poison: Math.min(20, o.poison + poisonDmg),
              commanderDamageTakenFromYou: o.commanderDamageTakenFromYou + cmdrDmg,
            }
          : o
      )
    );

    const parts: string[] = [];
    if (lifeDmg > 0) parts.push(`${lifeDmg} damage`);
    if (cmdrDmg > 0) parts.push(`${cmdrDmg} Commander dmg`);
    if (poisonDmg > 0) parts.push(`${poisonDmg} poison`);
    appendLog(
      `Combat vs ${targetOpp.name} with ${attackers.map((a) => a.name).join(', ')}: ${parts.join(', ')}.`
    );
  };

  const adjustManaPool = (color: ManaColor, delta: number) => {
    setManaPool((prev) => ({
      ...prev,
      [color]: Math.max(0, prev[color] + delta),
    }));
  };

  const adjustOpponentStat = (
    oppId: string,
    field: 'life' | 'poison' | 'commanderDamageTakenFromYou' | 'commanderDamageDealtToYou',
    delta: number
  ) => {
    if (liveBotMode) {
      setLiveBots((prev) =>
        prev.map((b) => {
          if (b.id !== oppId) return b;
          const nextVal = Math.max(0, b[field] + delta);
          const updated = { ...b, [field]: nextVal };
          const elimReason =
            updated.poison >= 10
              ? 'poison'
              : formatRules.usesCommanderDamage21 && updated.commanderDamageTakenFromYou >= 21
              ? 'commander'
              : updated.life <= 0
              ? 'life'
              : null;
          return {
            ...updated,
            eliminatedReason: elimReason,
            eliminated: Boolean(elimReason),
          };
        })
      );
      if (field === 'commanderDamageDealtToYou' && delta > 0) {
        setYourLife((l) => Math.max(0, l - delta));
      }
      return;
    }

    setOpponentTrackers((prev) =>
      prev.map((o) => {
        if (o.id !== oppId) return o;
        const nextVal = Math.max(0, o[field] + delta);
        return { ...o, [field]: nextVal };
      })
    );
    if (field === 'commanderDamageDealtToYou' && delta > 0) {
      setYourLife((l) => Math.max(0, l - delta));
      const opp = opponentTrackers.find((o) => o.id === oppId);
      appendLog(
        `Took ${delta} Commander damage from ${opp?.name || 'Opponent'} (${opp?.commanderName || 'Commander'}) and lost ${delta} life.`
      );
    }
  };

  const attackersCount = battlefield.filter((b) => b.attacking).length;
  const maxCmdrTakenFromAny = opponentTrackers.reduce(
    (mx, o) => Math.max(mx, o.commanderDamageDealtToYou),
    0
  );

  const botsAreActing =
    liveBotMode &&
    (botQueueIndices.length > 0 || activeBotIdx !== null || botStepAwaitingContinue);
  const untappedPlayerCreatures = battlefield.filter((b) => b.isCreature && !b.tapped);

  const turnDurationStats = useMemo(() => {
    const entries = [...completedTurnDurations];
    if (entries.length === 0) {
      return {
        turnsTimed: 0,
        totalMs: 0,
        avgMs: 0,
        fastest: null as { turn: number; durationMs: number } | null,
        slowest: null as { turn: number; durationMs: number } | null,
        entries,
      };
    }
    const totalMs = entries.reduce((sum, item) => sum + item.durationMs, 0);
    const avgMs = totalMs / entries.length;
    let fastest = entries[0];
    let slowest = entries[0];
    for (const item of entries) {
      if (item.durationMs < fastest.durationMs) fastest = item;
      if (item.durationMs > slowest.durationMs) slowest = item;
    }
    return {
      turnsTimed: entries.length,
      totalMs,
      avgMs,
      fastest,
      slowest,
      entries,
    };
  }, [completedTurnDurations]);

  const lastEmittedLiveStatsSigRef = React.useRef<string>('');
  useEffect(() => {
    if (!onLiveStatsChange) return;
    const creaturesOnBoard = battlefield.filter((b) => b.isCreature).length;
    const outcome: LiveSimulationExportStats['outcome'] =
      liveMatchOutcome === 'victory'
        ? 'victory'
        : liveMatchOutcome === 'defeat'
        ? 'defeat'
        : simulationEndedManually
        ? 'manual-end'
        : 'in-progress';
    const payload: LiveSimulationExportStats = {
      mode,
      testedListLabel: effectiveVersionLabel,
      liveBotMode,
      turn,
      activePhase,
      turnsPassed: turnsPassedCount,
      cardsDrawn: cardsDrawnCount,
      avgTurnDurationMs: turnDurationStats.avgMs,
      totalTurnTimeMs: turnDurationStats.totalMs,
      turnsTimed: turnDurationStats.turnsTimed,
      outcome,
      startingLife,
      yourLife,
      yourPoison,
      landsInPlay: totalLandsInPlay,
      creaturesInPlay: creaturesOnBoard,
      handSize: hand.length,
      libraryRemaining: library.length,
      opponents: liveBotMode
        ? liveBots.map((b) => ({
            name: b.name,
            archetype: b.archetype,
            life: b.life,
            eliminated: b.eliminated,
          }))
        : opponentTrackers.map((o) => ({
            name: o.name,
            archetype: o.archetype,
            life: o.life,
          })),
    };
    const sig = JSON.stringify(payload);
    if (sig === lastEmittedLiveStatsSigRef.current) return;
    lastEmittedLiveStatsSigRef.current = sig;
    onLiveStatsChange(payload);
  }, [
    onLiveStatsChange,
    mode,
    effectiveVersionLabel,
    liveBotMode,
    turn,
    activePhase,
    turnsPassedCount,
    cardsDrawnCount,
    turnDurationStats.avgMs,
    turnDurationStats.totalMs,
    turnDurationStats.turnsTimed,
    liveMatchOutcome,
    simulationEndedManually,
    startingLife,
    yourLife,
    yourPoison,
    totalLandsInPlay,
    battlefield,
    hand.length,
    library.length,
    liveBots,
    opponentTrackers,
  ]);

  const replayRounds = Array.isArray(playtestResult?.rounds) ? playtestResult.rounds : [];
  const hasReplayMatch = Boolean(playtestResult && replayRounds.length > 0);
  const commanderNamesList = useMemo(
    () =>
      Array.from(
        new Set(
          activeDeckCards
            .filter((c) => c.zone === 'commander')
            .map((c) => c.name)
            .filter(Boolean)
        )
      ),
    [activeDeckCards]
  );

  const playerDeckSerializedText = useMemo(() => {
    if (useOptimizedList && optimizedDeckText.trim()) {
      return optimizedDeckText;
    }
    const lines: string[] = [];
    const cmds = activeDeckCards.filter((c) => c.zone === 'commander');
    if (cmds.length > 0) {
      lines.push('Commander');
      for (const c of cmds) lines.push(`${c.quantity} ${c.name}`);
      lines.push('');
    }
    const mains = activeDeckCards.filter((c) => c.zone === 'main');
    if (mains.length > 0) {
      lines.push('Deck');
      for (const c of mains) lines.push(`${c.quantity} ${c.name}`);
    }
    return lines.join('\n').trim();
  }, [activeDeckCards, optimizedDeckText, useOptimizedList]);

  const showLiveSetupLobby =
    activePlayAreaMode === 'live' && liveBotMode && liveGamePhase === 'setup';
  const canMulliganNow =
    turn === 1 &&
    battlefield.length === 0 &&
    !botsAreActing &&
    !pendingIncomingAttack &&
    !hasActiveStack &&
    !isSimulationFinished;
  const firstSeatLabel =
    resolvedFirstSeatIndex === 0
      ? 'You'
      : liveBots[resolvedFirstSeatIndex - 1]?.name || 'You';

  return (
    <div
      ref={containerRef}
      id="interactive-live-game"
      className={
        isFullscreen
          ? 'fixed inset-0 z-40 h-screen w-screen overflow-y-auto bg-white p-4 sm:p-6 space-y-5'
          : 'rounded-xl border border-zinc-200 bg-white p-6 space-y-6 scroll-mt-20'
      }
    >
      {/* Unified Play Area Header (Live Play vs Bots + Visual Board Match Replay) */}
      <div
        className={`flex flex-wrap items-start justify-between gap-4 border-b pb-4 ${
          isFullscreen
            ? 'sticky top-0 z-20 -mx-4 sm:-mx-6 -mt-4 sm:-mt-6 border-zinc-200 bg-white/95 px-4 sm:px-6 pt-4 pb-3 backdrop-blur-sm'
            : 'border-zinc-100'
        }`}
      >
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h3 className="font-display text-lg font-bold text-zinc-900">
              {activePlayAreaMode === 'replay'
                ? 'Visual Board Play Area (Match Replay)'
                : liveBotMode
                ? 'Play Live Game vs AI Bots'
                : 'Interactive Turn Simulator'}
            </h3>
            {activePlayAreaMode === 'live' && botsAreActing && activeBotIdx !== null && liveBots[activeBotIdx] && (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-700">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {liveBots[activeBotIdx].name} taking turn...
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
            {activePlayAreaMode === 'replay' && hasReplayMatch && playtestResult ? (
              <>
                <span className="font-mono font-semibold tabular-nums text-sky-700">
                  Round {Math.min(activeRoundIdx + 1, replayRounds.length)} of {replayRounds.length}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  {playtestResult.mode} Simulated Match ({playtestResult.testedListLabel})
                </span>
                {commanderNamesList.length > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-semibold text-zinc-800">
                      Cmdr: {commanderNamesList.join(' & ')}
                    </span>
                  </>
                )}
              </>
            ) : showLiveSetupLobby ? (
              <>
                <span className="font-semibold text-sky-700">
                  Pre-Game Match Setup
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  {mode} Pod · {startingLife} Starting Life
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  {effectiveVersionLabel}
                </span>
                {loadedCommandersLabel && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-semibold text-zinc-800">
                      Cmdr: {loadedCommandersLabel}
                    </span>
                  </>
                )}
              </>
            ) : (
              <>
                <span className="font-mono font-semibold tabular-nums text-zinc-800">
                  Turn {turn}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-semibold text-sky-700">
                  {botsAreActing ? 'Bot Turns' : `${activePhase} Phase`}
                </span>
                {liveBotMode && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      1st: {firstSeatLabel}
                    </span>
                  </>
                )}
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  {effectiveVersionLabel}
                </span>
                {loadedCommandersLabel && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-semibold text-zinc-800">
                      Cmdr: {loadedCommandersLabel}
                    </span>
                  </>
                )}
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  {library.length} Library · {hand.length} Hand · {graveyard.length} Graveyard
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Unified Play Area Mode Switch: Live Play vs Visual Board Match Replay */}
          <div className="inline-flex items-center gap-1 rounded-lg bg-zinc-100 p-1">
            <button
              type="button"
              onClick={() => setActivePlayAreaMode('live')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activePlayAreaMode === 'live'
                  ? 'bg-white text-sky-900 shadow-sm'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              <Play className="h-3.5 w-3.5 text-sky-700" />
              Live Play vs Bots
            </button>
            <button
              type="button"
              onClick={() => setActivePlayAreaMode('replay')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activePlayAreaMode === 'replay'
                  ? 'bg-white text-emerald-900 shadow-sm'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              <Layers className="h-3.5 w-3.5 text-emerald-700" />
              Visual Board Replay
              {hasReplayMatch && (
                <span className="font-mono text-[10px] text-sky-700">
                  (R{Math.min(activeRoundIdx + 1, replayRounds.length)}/{replayRounds.length})
                </span>
              )}
            </button>
          </div>

          {activePlayAreaMode === 'live' && (
            <>
              {/* Optional Mode Switch: Live Game vs Bots vs Solo Goldfish */}
              <div className="inline-flex items-center gap-1 rounded-lg bg-zinc-100 p-1">
                <button
                  type="button"
                  onClick={() => setLiveBotMode(true)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    liveBotMode
                      ? 'bg-white text-sky-900 shadow-sm'
                      : 'text-zinc-600 hover:text-zinc-900'
                  }`}
                >
                  <Bot className="h-3.5 w-3.5 text-sky-700" />
                  Play vs Bots
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setBotQueueIndices([]);
                    setBotRoundTotal(0);
                    setActiveBotIdx(null);
                    setBotStepAwaitingContinue(false);
                    setActiveBotTurnBanner(null);
                    setPendingIncomingAttack(null);
                    setLiveBotMode(false);
                  }}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    !liveBotMode
                      ? 'bg-white text-zinc-900 shadow-sm'
                      : 'text-zinc-600 hover:text-zinc-900'
                  }`}
                >
                  Solo Goldfish
                </button>
              </div>

              {!showLiveSetupLobby && (
                <>
                  {/* GUI Style Switch: 2/3/4 Visual Tabletop vs Compact List */}
                  <div className="inline-flex items-center gap-1 rounded-lg bg-zinc-100 p-1">
                    <button
                      type="button"
                      onClick={() => setGuiView('tabletop')}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        guiView === 'tabletop'
                          ? 'bg-white text-emerald-900 shadow-sm'
                          : 'text-zinc-600 hover:text-zinc-900'
                      }`}
                    >
                      <LayoutGrid className="h-3.5 w-3.5 text-emerald-700" />
                      Tabletop GUI
                    </button>
                    <button
                      type="button"
                      onClick={() => setGuiView('list')}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        guiView === 'list'
                          ? 'bg-white text-zinc-900 shadow-sm'
                          : 'text-zinc-600 hover:text-zinc-900'
                      }`}
                    >
                      <List className="h-3.5 w-3.5 text-zinc-600" />
                      Compact List
                    </button>
                  </div>

                  {liveBotMode && (
                    <>
                      <button
                        type="button"
                        onClick={() => setLiveGamePhase('setup')}
                        title="Open Pre-Game Match Setup to edit bot intelligence, bot decks, turn order, and starting life"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-sky-300 bg-sky-50 px-2.5 py-1.5 text-xs font-semibold text-sky-900 hover:bg-sky-100 cursor-pointer whitespace-nowrap shrink-0"
                      >
                        <Sliders className="h-3.5 w-3.5 text-sky-700" />
                        Match Setup
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          setBotTurnPace((prev) =>
                            prev === 'normal' ? 'step' : prev === 'step' ? 'fast' : 'normal'
                          )
                        }
                        title="Cycle bot turn pace: Normal Pace → Step-by-Step (manual Next Bot) → Fast Bots"
                        className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium cursor-pointer whitespace-nowrap shrink-0 ${
                          botTurnPace === 'step'
                            ? 'border-amber-300 bg-amber-50 text-amber-900'
                            : botTurnPace === 'fast'
                            ? 'border-sky-300 bg-sky-50 text-sky-900'
                            : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50'
                        }`}
                      >
                        <FastForward className="h-3.5 w-3.5 text-sky-700" />
                        {botTurnPace === 'step'
                          ? 'Step-by-Step Bots'
                          : botTurnPace === 'fast'
                          ? 'Fast Bots'
                          : 'Normal Bot Pace'}
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          setInterruptWindowMode((prev) =>
                            prev === '12s'
                              ? '8s'
                              : prev === '8s'
                              ? '20s'
                              : prev === '20s'
                              ? 'manual'
                              : prev === 'manual'
                              ? 'smart-only'
                              : '12s'
                          )
                        }
                        title="Cycle Interrupt/Response notification timer when bots play cards: 12s → 8s → 20s → Manual (No Timer) → Smart Only (only pause if you hold an instant)"
                        className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium cursor-pointer whitespace-nowrap shrink-0 ${
                          interruptWindowMode === 'smart-only'
                            ? 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50'
                            : interruptWindowMode === 'manual'
                            ? 'border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100'
                            : 'border-sky-300 bg-sky-50 text-sky-900 hover:bg-sky-100'
                        }`}
                      >
                        <Bell className="h-3.5 w-3.5 text-sky-700" />
                        {interruptWindowMode === '12s'
                          ? 'Interrupt Window: 12s'
                          : interruptWindowMode === '8s'
                          ? 'Interrupt Window: 8s'
                          : interruptWindowMode === '20s'
                          ? 'Interrupt Window: 20s'
                          : interruptWindowMode === 'manual'
                          ? 'Interrupt Window: Manual'
                          : 'Interrupt: Smart Only'}
                      </button>

                      <button
                        type="button"
                        onClick={() => setFullControlPriority((prev) => !prev)}
                        aria-pressed={fullControlPriority}
                        title={
                          fullControlPriority
                            ? 'Full Control ON: Always pauses on bot spells & attacks so you can inspect the Stack or hold priority manually'
                            : 'Smart Priority: Automatically opens the Stack whenever you hold an affordable Instant/Flash spell or a bot counters your spell'
                        }
                        className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium cursor-pointer whitespace-nowrap shrink-0 ${
                          fullControlPriority
                            ? 'border-sky-500 bg-sky-700 text-white shadow-sm'
                            : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50'
                        }`}
                      >
                        <Layers className={`h-3.5 w-3.5 ${fullControlPriority ? 'text-amber-300' : 'text-sky-700'}`} />
                        {fullControlPriority ? 'Full Control: ON' : 'Smart Stack Priority'}
                      </button>
                    </>
                  )}

                  {canMulliganNow && (
                    <button
                      type="button"
                      onClick={handleMulligan}
                      title={
                        freeFirstMulligan && mulliganCount === 0
                          ? 'Free First Mulligan: reshuffle and draw a fresh 7-card hand'
                          : 'Reshuffle hand into library and draw a smaller opening hand'
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <Shuffle className="h-3.5 w-3.5 text-amber-700" />
                      {freeFirstMulligan && mulliganCount === 0
                        ? 'Free Mulligan (7)'
                        : `Mulligan (${Math.max(
                            3,
                            7 - (freeFirstMulligan ? mulliganCount : mulliganCount + 1)
                          )})`}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => handleDrawManual(1, true)}
                    disabled={library.length === 0 || botsAreActing || isShufflingDeck}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Plus className="h-3.5 w-3.5 text-sky-700" />
                    Draw Card
                  </button>
                  <button
                    type="button"
                    onClick={handleShuffleLibrary}
                    disabled={library.length < 2 || botsAreActing || Boolean(pendingIncomingAttack) || isSimulationFinished}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Shuffle className={`h-3.5 w-3.5 text-sky-700 ${isShufflingDeck ? 'animate-spin' : ''}`} />
                    {isShufflingDeck ? 'Shuffling...' : 'Shuffle'}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      resetGame('Reshuffled deck & drew fresh Opening 7', true, {
                        firstSeatIdx: resolvedFirstSeatIndex,
                        triggerOpeningLead: resolvedFirstSeatIndex > 0,
                      })
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <RotateCcw className="h-3.5 w-3.5 text-sky-700" />
                    New Game
                  </button>
                </>
              )}
            </>
          )}

          <button
            type="button"
            onClick={() => setIsFullscreen((prev) => !prev)}
            aria-pressed={isFullscreen}
            title={
              isFullscreen
                ? 'Exit Fullscreen Play Area (Esc)'
                : 'Expand Play Area to Fullscreen inside program'
            }
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
              isFullscreen
                ? 'bg-sky-700 text-white hover:bg-sky-800 shadow-sm'
                : 'border border-sky-600/40 bg-sky-50 text-sky-800 hover:bg-sky-100'
            }`}
          >
            {isFullscreen ? (
              <>
                <Minimize2 className="h-3.5 w-3.5 shrink-0" />
                Exit Fullscreen
              </>
            ) : (
              <>
                <Maximize2 className="h-3.5 w-3.5 shrink-0" />
                Fullscreen
              </>
            )}
          </button>
        </div>
      </div>

      {activePlayAreaMode === 'replay' ? (
        hasReplayMatch && playtestResult ? (
          <PlaytestVisualBoard
            embedded
            result={playtestResult}
            activeRoundIdx={Math.min(activeRoundIdx, replayRounds.length - 1)}
            onSelectRound={(idx) => onSelectRound?.(idx)}
            deckName={analysis.deckName || 'Your Deck'}
            commanderNames={commanderNamesList}
            usesCommanderDamage21={formatRules.usesCommanderDamage21}
            findMeta={findMeta}
            onInspectCard={onInspectCard}
            onSwitchToLivePlay={() => setActivePlayAreaMode('live')}
          />
        ) : (
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-6 text-center space-y-3">
            <Layers className="mx-auto h-7 w-7 text-sky-700" />
            <div className="space-y-1">
              <div className="text-sm font-bold text-zinc-900">
                No Simulated Match Replay Yet
              </div>
              <p className="text-xs text-zinc-600 max-w-md mx-auto">
                Run a simulated {mode} bot match to replay every round on the visual board, or switch back to Live Play to pilot turn-by-turn now.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
              {onRunBotMatch && (
                <button
                  type="button"
                  onClick={onRunBotMatch}
                  disabled={isSimulatingBotMatch}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-sky-700 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-800 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Play className="h-3.5 w-3.5" />
                  {isSimulatingBotMatch ? `Simulating ${mode}...` : `Play ${mode} Bot Match`}
                </button>
              )}
              <button
                type="button"
                onClick={() => setActivePlayAreaMode('live')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-4 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Bot className="h-3.5 w-3.5 text-sky-700" />
                Back to Live Play vs Bots
              </button>
            </div>
          </div>
        )
      ) : showLiveSetupLobby ? (
        <LiveMatchSetupLobby
          mode={mode}
          formatLabel={format.charAt(0).toUpperCase() + format.slice(1)}
          defaultStartingLife={formatRules.startingLife}
          startingLife={startingLife}
          opponents={opponents}
          playerDeckName={analysis.deckName || 'Your Deck'}
          playerDeckVersionLabel={effectiveVersionLabel}
          playerDeckCardCount={baseCardCount}
          playerCommanderNames={commanderNamesList}
          playerDeckSerializedText={playerDeckSerializedText}
          firstPlayerChoice={firstPlayerChoice}
          freeFirstMulligan={freeFirstMulligan}
          interruptWindowMode={interruptWindowMode}
          botTurnPace={botTurnPace}
          hasGameInProgress={hasStartedLiveGameOnce}
          onChangeMode={(nextMode) => {
            onModeChange?.(nextMode);
            if (firstPlayerChoice.startsWith('bot-')) {
              const seatNum = Number(firstPlayerChoice.replace('bot-', ''));
              const nextBotCount = nextMode === '1v1' ? 1 : nextMode === '1v2' ? 2 : 3;
              if (seatNum >= nextBotCount) {
                setFirstPlayerChoice('player');
              }
            }
          }}
          onChangeStartingLife={(life) => setCustomStartingLife(life)}
          onChangeFirstPlayerChoice={setFirstPlayerChoice}
          onChangeFreeFirstMulligan={setFreeFirstMulligan}
          onChangeInterruptWindowMode={setInterruptWindowMode}
          onChangeBotTurnPace={setBotTurnPace}
          onUpdateOpponents={(nextOpps) => {
            onUpdateOpponentsForMode?.(nextOpps);
          }}
          onStartLiveGame={handleStartConfiguredLiveGame}
          onResumeLiveGame={
            hasStartedLiveGameOnce ? () => setLiveGamePhase('playing') : undefined
          }
          activeAiModelLabel={liveAiStatus.activeModelLabel}
          effectiveAiEngine={liveAiStatus.effectiveEngine}
          liveAiTurnReasoning={liveAiTurnReasoning}
          onChangeLiveAiTurnReasoning={setLiveAiTurnReasoning}
        />
      ) : (
        <>

      {/* Dedicated Turn Counter, Real-Time Turn Timer & Game Progress Tracker */}
      <div
        aria-label="Turn Counter and Turn Timer"
        className="rounded-xl border border-sky-200 bg-sky-50/40 px-4 py-3 flex flex-wrap items-center justify-between gap-4"
      >
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2.5">
            <Clock className="h-4 w-4 text-sky-700 shrink-0" />
            <div>
              <div className="text-[11px] font-medium text-zinc-500">
                Turn Counter
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xl font-bold tabular-nums text-zinc-900">
                  Turn {turn}
                </span>
                <div className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    aria-label="Decrement turn counter"
                    disabled={turn <= 1 || botsAreActing || isSimulationFinished}
                    onClick={() => setTurn((t) => Math.max(1, t - 1))}
                    className="rounded border border-zinc-300 bg-white p-0.5 text-zinc-600 hover:text-zinc-900 disabled:opacity-35 cursor-pointer"
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    aria-label="Increment turn counter"
                    disabled={botsAreActing || isSimulationFinished}
                    onClick={() => setTurn((t) => t + 1)}
                    className="rounded border border-zinc-300 bg-white p-0.5 text-zinc-600 hover:text-sky-700 disabled:opacity-35 cursor-pointer"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Real-Time Turn Timer */}
          <div className="flex items-center gap-2.5 border-l border-zinc-200 pl-4">
            <Timer className="h-4 w-4 text-sky-700 shrink-0" />
            <div>
              <div className="text-[11px] font-medium text-zinc-500">
                Turn Timer ({botsAreActing ? 'Bot Turn' : isSimulationFinished ? 'Ended' : isTimerPaused ? 'Paused' : 'Live'})
              </div>
              <div className="flex items-center gap-2">
                <span
                  aria-live="off"
                  className="font-mono text-xl font-bold tabular-nums text-sky-700"
                >
                  {formatClockMs(currentTurnElapsedMs)}
                </span>
                <button
                  type="button"
                  onClick={() => setIsTimerPaused((p) => !p)}
                  disabled={botsAreActing || isSimulationFinished}
                  aria-label={isTimerPaused ? 'Resume turn timer' : 'Pause turn timer'}
                  title={isTimerPaused ? 'Resume turn timer' : 'Pause turn timer'}
                  className="rounded border border-zinc-300 bg-white p-1 text-zinc-600 hover:text-sky-700 disabled:opacity-35 cursor-pointer"
                >
                  {isTimerPaused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-l border-zinc-200 pl-4 font-mono text-xs tabular-nums text-zinc-600">
            <span>
              Turns Passed: <strong className="text-zinc-900">{turnsPassedCount}</strong>
            </span>
            <span className="text-zinc-300" aria-hidden="true">·</span>
            <span>
              Cards Drawn: <strong className="text-sky-700">{cardsDrawnCount}</strong>
            </span>
            {turnDurationStats.turnsTimed > 0 && (
              <>
                <span className="text-zinc-300" aria-hidden="true">·</span>
                <span>
                  Avg Turn:{' '}
                  <strong className="text-zinc-900">
                    {formatDurationSummaryMs(turnDurationStats.avgMs)}
                  </strong>
                </span>
              </>
            )}
            <span className="text-zinc-300" aria-hidden="true">·</span>
            <span>
              Phase: <strong className="text-zinc-900">{botsAreActing ? 'Bot Turns' : activePhase}</strong>
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => handleDrawManual(1, true)}
            disabled={
              library.length === 0 ||
              botsAreActing ||
              Boolean(pendingIncomingAttack) ||
              hasActiveStack ||
              isSimulationFinished
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Plus className="h-3.5 w-3.5 text-sky-700" />
            Draw Card (+1 Turn)
          </button>
          <button
            type="button"
            onClick={handlePassTurn}
            disabled={botsAreActing || Boolean(pendingIncomingAttack) || hasActiveStack || isSimulationFinished}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-sky-800 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
          >
            <ChevronRight className="h-3.5 w-3.5" />
            {liveBotMode ? 'Pass Turn → Bots (+1)' : 'Pass Turn (+1)'}
          </button>
          {!isSimulationFinished && (
            <button
              type="button"
              onClick={handleEndSimulation}
              disabled={botsAreActing || Boolean(pendingIncomingAttack) || hasActiveStack}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:border-sky-600 hover:text-sky-700 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Flag className="h-3.5 w-3.5 text-sky-700" />
              End Sim &amp; Summary
            </button>
          )}
        </div>
      </div>

      {/* End-of-Simulation Conclusion & Average Turn Duration Summary */}
      {isSimulationFinished && (
        <div
          aria-label="Simulation End Summary"
          className={`rounded-xl border p-4 space-y-3.5 ${
            liveMatchOutcome === 'victory'
              ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
              : liveMatchOutcome === 'defeat'
              ? 'border-red-300 bg-red-50 text-red-900'
              : 'border-sky-300 bg-sky-50/60 text-zinc-900'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              {liveMatchOutcome === 'victory' ? (
                <Trophy className="h-5 w-5 text-emerald-700 shrink-0" />
              ) : liveMatchOutcome === 'defeat' ? (
                <Skull className="h-5 w-5 text-red-700 shrink-0" />
              ) : (
                <Timer className="h-5 w-5 text-sky-700 shrink-0" />
              )}
              <div>
                <div className="text-sm font-bold">
                  {liveMatchOutcome === 'victory'
                    ? `Victory! You defeated all ${liveBots.length} bot opponent${liveBots.length === 1 ? '' : 's'} by Turn ${turn}.`
                    : liveMatchOutcome === 'defeat'
                    ? `Defeat on Turn ${turn} (${
                        yourPoison >= 10
                          ? '10+ Poison Counters'
                          : formatRules.usesCommanderDamage21 && maxCmdrFromBots >= 21
                          ? '21+ Commander Damage'
                          : '0 Life'
                      }).`
                    : `Simulation Complete — ${turn} Turn${turn === 1 ? '' : 's'} Played`}
                </div>
                <div className="text-xs opacity-90">
                  Real-time player decision tempo recorded across {turnDurationStats.turnsTimed} completed turn{turnDurationStats.turnsTimed === 1 ? '' : 's'}.
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {!liveMatchOutcome && simulationEndedManually && (
                <button
                  type="button"
                  onClick={() => setSimulationEndedManually(false)}
                  className="rounded-lg border border-zinc-300 bg-white px-3.5 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 cursor-pointer whitespace-nowrap shrink-0"
                >
                  Resume Sim
                </button>
              )}
              <button
                type="button"
                onClick={() => resetGame('Started new live game')}
                className="rounded-lg bg-sky-700 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-800 cursor-pointer whitespace-nowrap shrink-0"
              >
                Play Again
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 border-t border-zinc-200/70 pt-3 sm:grid-cols-4">
            <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2">
              <div className="text-[11px] font-medium text-zinc-500">
                Average Turn Duration
              </div>
              <div className="mt-0.5 font-mono text-lg font-bold tabular-nums text-sky-700">
                {turnDurationStats.turnsTimed > 0
                  ? formatDurationSummaryMs(turnDurationStats.avgMs)
                  : '0.0s'}
              </div>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2">
              <div className="text-[11px] font-medium text-zinc-500">
                Total Active Turn Time
              </div>
              <div className="mt-0.5 font-mono text-lg font-bold tabular-nums text-zinc-900">
                {formatDurationSummaryMs(turnDurationStats.totalMs)}
              </div>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2">
              <div className="text-[11px] font-medium text-zinc-500">
                Fastest Turn
              </div>
              <div className="mt-0.5 font-mono text-sm font-bold tabular-nums text-emerald-700">
                {turnDurationStats.fastest
                  ? `T${turnDurationStats.fastest.turn} · ${formatDurationSummaryMs(turnDurationStats.fastest.durationMs)}`
                  : '—'}
              </div>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2">
              <div className="text-[11px] font-medium text-zinc-500">
                Longest Turn
              </div>
              <div className="mt-0.5 font-mono text-sm font-bold tabular-nums text-amber-700">
                {turnDurationStats.slowest
                  ? `T${turnDurationStats.slowest.turn} · ${formatDurationSummaryMs(turnDurationStats.slowest.durationMs)}`
                  : '—'}
              </div>
            </div>
          </div>

          {turnDurationStats.entries.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] tabular-nums text-zinc-600">
              <span className="font-sans font-semibold text-zinc-700">Per-Turn Tempo:</span>
              {turnDurationStats.entries.map((entry, idx) => (
                <React.Fragment key={`turn-dur-${entry.turn}-${idx}`}>
                  <span>
                    T{entry.turn}: <strong className="text-zinc-900">{formatDurationSummaryMs(entry.durationMs)}</strong>
                  </span>
                  {idx < turnDurationStats.entries.length - 1 && (
                    <span className="text-zinc-300" aria-hidden="true">·</span>
                  )}
                </React.Fragment>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Visual Phase Indicator & Stepper Bar */}
      <div
        aria-label="Turn Phase Indicator"
        className="space-y-3 border-b border-zinc-100 pb-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-xs font-semibold text-zinc-800">
              Turn {turn} Phase Track
            </span>
            <span className="text-zinc-300" aria-hidden="true">·</span>
            <span className="font-mono text-xs font-semibold text-sky-700 tabular-nums">
              {botsAreActing
                ? `Bots Acting (${activeBotIdx !== null && liveBots[activeBotIdx] ? liveBots[activeBotIdx].name : 'Resolving'})`
                : `Step ${phaseIdx + 1} of ${PHASES.length}: ${activePhase}`}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handlePrevPhase}
              disabled={
                phaseIdx === 0 ||
                botsAreActing ||
                Boolean(pendingIncomingAttack) ||
                hasActiveStack ||
                isSimulationFinished
              }
              className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Prev Phase
            </button>
            <button
              type="button"
              onClick={handleNextPhase}
              disabled={botsAreActing || Boolean(pendingIncomingAttack) || hasActiveStack || isSimulationFinished}
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-sky-800 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
            >
              {phaseIdx === PHASES.length - 1
                ? liveBotMode
                  ? 'End Turn → Bots'
                  : `Next Turn (T${turn + 1})`
                : `Next: ${PHASES[phaseIdx + 1]}`}
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
            {liveBotMode && phaseIdx < PHASES.length - 1 && (
              <button
                type="button"
                onClick={startBotTurns}
                disabled={botsAreActing || Boolean(pendingIncomingAttack) || hasActiveStack || isSimulationFinished}
                className="inline-flex items-center gap-1.5 rounded-lg border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-900 hover:bg-sky-100 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Bot className="h-3.5 w-3.5 text-sky-700" />
                End Turn → Bots
              </button>
            )}
          </div>
        </div>

        {/* Visual 6-Phase Step Track (Untap, Upkeep, Draw, Main, Combat, End) */}
        <div className="space-y-2">
          <div className="grid grid-cols-6 gap-2" aria-hidden="true">
            {PHASES.map((phase, idx) => {
              const segmentClass = botsAreActing
                ? 'bg-sky-500'
                : idx < phaseIdx
                ? 'bg-emerald-500'
                : idx === phaseIdx
                ? 'bg-sky-600'
                : 'bg-zinc-200';
              return (
                <div
                  key={`${phase}-bar`}
                  className={`h-1.5 rounded-full transition-colors duration-200 ${segmentClass}`}
                />
              );
            })}
          </div>

          <div
            role="tablist"
            aria-label="Turn game phases"
            className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6"
          >
            {PHASES.map((phase, idx) => {
              const isCurrent = idx === phaseIdx && !botsAreActing;
              const isCompleted = !botsAreActing && idx < phaseIdx;
              const PhaseIcon =
                phase === 'Untap'
                  ? RotateCcw
                  : phase === 'Upkeep'
                  ? Clock
                  : phase === 'Draw'
                  ? BookOpen
                  : phase === 'Main'
                  ? Sparkles
                  : phase === 'Combat'
                  ? Swords
                  : Flag;

              return (
                <button
                  key={phase}
                  type="button"
                  role="tab"
                  disabled={botsAreActing || Boolean(pendingIncomingAttack) || isSimulationFinished}
                  aria-selected={isCurrent}
                  onClick={() => goToPhase(idx, false, turn)}
                  className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-colors cursor-pointer disabled:opacity-55 ${
                    isCurrent
                      ? 'border-sky-500 bg-sky-50 ring-1 ring-sky-500/40 text-zinc-900'
                      : isCompleted
                      ? 'border-emerald-300 bg-emerald-50/40 text-zinc-800 hover:border-emerald-400'
                      : 'border-zinc-200 bg-zinc-50 text-zinc-600 hover:border-zinc-300 hover:text-zinc-900'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`font-mono text-[10px] font-bold tabular-nums ${
                          isCurrent
                            ? 'text-sky-700'
                            : isCompleted
                            ? 'text-emerald-700'
                            : 'text-zinc-400'
                        }`}
                      >
                        0{idx + 1}
                      </span>
                      <span className="truncate text-xs font-bold">
                        {phase}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-[10px] text-zinc-500">
                      {isCurrent
                        ? 'Active phase'
                        : isCompleted
                        ? 'Completed'
                        : PHASE_STEP_SUBTITLES[phase]}
                    </div>
                  </div>

                  <span className="shrink-0">
                    {isCompleted ? (
                      <Check className="h-3.5 w-3.5 text-emerald-700" />
                    ) : (
                      <PhaseIcon
                        className={`h-3.5 w-3.5 ${
                          isCurrent ? 'text-sky-700' : 'text-zinc-400'
                        }`}
                      />
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <p className="text-xs text-zinc-600">
          {hasActiveStack
            ? `Stack Active (${stackItems.length} spell${stackItems.length === 1 ? '' : 's'})! Cast an instant-speed response (Counterspell, Protection, Removal, Flash, Draw) or pass priority to resolve.`
            : pendingIncomingAttack
            ? `${pendingIncomingAttack.botName} is attacking you! Assign your untapped creatures as blockers, cast instant combat responses, or take combat damage.`
            : botsAreActing
            ? 'Bots are resolving their draw, mana, spells, and combat turns before returning to Turn ' + (turn + 1) + ' Untap...'
            : PHASE_HINTS[activePhase]}
        </p>
      </div>

      {guiView === 'tabletop' ? (
        <div className="space-y-4">
          <LiveTabletopArena
            mode={mode}
            turn={turn}
            phaseIdx={phaseIdx}
            phases={PHASES}
            activePhase={activePhase}
            botsAreActing={botsAreActing}
            activeBotIdx={activeBotIdx}
            liveBotMode={liveBotMode}
            isSimulationFinished={isSimulationFinished}
            allowsCommandZone={formatRules.allowsCommandZone}
            usesCommanderDamage21={formatRules.usesCommanderDamage21}
            deckName={analysis.deckName || 'Your Deck'}
            startingLife={startingLife}
            yourLife={yourLife}
            yourPoison={yourPoison}
            maxCmdrFromBots={maxCmdrFromBots}
            manaPool={manaPool}
            totalManaPool={totalManaPool}
            untappedLandsCount={untappedLandsCount}
            totalLandsInPlay={totalLandsInPlay}
            landsPlayedThisTurn={landsPlayedThisTurn}
            library={library}
            hand={hand}
            lastDrawnUids={lastDrawnUids}
            commandZone={commandZone}
            commanderTaxByUid={commanderTaxByUid}
            battlefield={battlefield}
            graveyard={graveyard}
            exile={exile}
            liveBots={liveBots}
            opponentTrackers={opponentTrackers}
            selectedCombatTargetId={selectedCombatTargetId}
            pendingIncomingAttack={pendingIncomingAttack}
            blockerAssignments={blockerAssignments}
            soundEnabled={soundEnabled}
            isShufflingDeck={isShufflingDeck}
            isFullscreen={isFullscreen}
            botStepAwaitingContinue={botStepAwaitingContinue}
            activeBotTurnBanner={activeBotTurnBanner}
            onContinueNextBotTurn={advanceAfterCurrentBot}
            onToggleFullscreen={() => setIsFullscreen((prev) => !prev)}
            onToggleSound={() => setSoundEnabled((s) => !s)}
            onShuffleLibrary={handleShuffleLibrary}
            onSelectCombatTarget={setSelectedCombatTargetId}
            onAdjustYourLife={(delta) => setYourLife((l) => Math.max(0, l + delta))}
            onAdjustYourPoison={(delta) =>
              setYourPoison((p) => Math.max(0, Math.min(20, p + delta)))
            }
            onAdjustOpponentStat={adjustOpponentStat}
            onDrawCard={handleDrawManual}
            onPlayLand={handlePlayLandFromHand}
            onCastFromHand={handleCastFromHand}
            onCastCommander={handleCastCommander}
            onTogglePermanentTap={handleTogglePermanentTap}
            onTapAllUntappedLands={handleTapAllUntappedLands}
            onUntapAll={handleUntapAll}
            onEmptyManaPool={() => setManaPool({ ...EMPTY_POOL })}
            onAdjustManaPool={adjustManaPool}
            onToggleAttacker={handleToggleAttacker}
            onReturnCommanderToZone={handleReturnCommanderToZone}
            onMovePermanentToGy={handleMovePermanentToGy}
            onResolveCombat={handleResolveCombat}
            onToggleBlocker={(blkUid, atkUid) =>
              setBlockerAssignments((prev) => {
                const next = { ...prev };
                if (next[blkUid] === atkUid) delete next[blkUid];
                else next[blkUid] = atkUid;
                return next;
              })
            }
            onResolveIncomingAttack={handleResolveIncomingAttack}
            onPrevPhase={handlePrevPhase}
            onNextPhase={handleNextPhase}
            onPassTurn={handlePassTurn}
            onInspectCard={onInspectCard}
            playerCounters={playerCounters}
            isMonarch={isMonarch}
            onCreateToken={handleCreateToken}
            onActivateTokenAbility={handleActivateTokenAbility}
            onAdjustPermanentCounter={handleAdjustPermanentCounter}
            onAdjustPlayerCounter={handleAdjustPlayerCounter}
            onToggleMonarch={handleToggleMonarch}
            onReorderBattlefield={handleReorderBattlefield}
            onDiscardFromHand={handleDiscardFromHand}
            onExileFromHand={handleExileFromHand}
            onMovePermanentToExile={handleMovePermanentToExile}
            onBouncePermanentToHand={handleBouncePermanentToHand}
            onReturnTopGraveyardToBattlefield={handleReturnTopGraveyardToBattlefield}
            onReturnTopGraveyardToHand={handleReturnTopGraveyardToHand}
            onReturnTopExileToBattlefield={handleReturnTopExileToBattlefield}
            onReturnTopExileToHand={handleReturnTopExileToHand}
            onMovePlayerZoneCard={handleMovePlayerZoneCard}
            onDragAttackOpponent={handleDragAttackOpponent}
            stackItems={stackItems}
            activatedAbilities={availableActivatedAbilities}
            combatFogActive={combatFogActive}
            totalAvailableMana={totalAvailableMana}
            interruptCountdownMs={interruptRemainingMs}
            interruptTotalMs={interruptTotalMs}
            interruptTimerHeld={interruptTimerHeld}
            interruptWindowMode={interruptWindowMode}
            onToggleHoldInterrupt={() => setInterruptTimerHeld((prev) => !prev)}
            onCastStackResponse={handleCastStackResponse}
            onActivateAbility={handleActivateAbility}
            onResolveStackTop={() => resolveStack(false)}
            onResolveStackAll={() => resolveStack(true)}
            onCastCombatInstant={handleCastCombatInstant}
            activeAiModelLabel={liveAiStatus.activeModelLabel}
            effectiveAiEngine={liveAiStatus.effectiveEngine}
            thinkingBotName={thinkingBotName}
            liveAiTurnReasoning={liveAiTurnReasoning}
            onToggleLiveAiTurnReasoning={() => setLiveAiTurnReasoning((prev) => !prev)}
          />

          {/* Compact Turn Simulation Log */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 text-xs font-semibold text-zinc-800">
              <div className="flex items-center gap-1.5">
                <Zap className="h-3.5 w-3.5 text-sky-700" />
                <span>Turn Simulation Log</span>
              </div>
              <div className="flex items-center gap-2 font-mono text-[11px] text-zinc-500">
                <Coins className="h-3 w-3" />
                <span>{graveyard.length} in GY · {exile.length} in Exile</span>
                <button
                  type="button"
                  onClick={() => setTurnLog([])}
                  className="text-zinc-500 hover:text-zinc-900 underline cursor-pointer"
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-zinc-200 bg-zinc-50/60 px-3 py-2 max-h-[145px] overflow-y-auto divide-y divide-zinc-100 text-[11px]">
              {turnLog.length === 0 ? (
                <p className="py-2 text-zinc-500">No actions recorded yet.</p>
              ) : (
                turnLog.map((entry) => (
                  <div key={entry.id} className="py-1.5 flex items-baseline gap-2">
                    <span className="font-mono font-semibold text-sky-700 whitespace-nowrap shrink-0">
                      T{entry.turn} · {entry.phase}
                    </span>
                    <span className="text-zinc-700">{entry.message}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : (
        <>
          {isShufflingDeck && (
            <div className="rounded-xl border border-sky-200 bg-sky-50/60 px-4 py-3 flex items-center justify-between gap-4">
              <DeckShuffleAnimation
                size="sm"
                theme="light"
                label="Shuffling library & pod decks..."
                sublabel={`${library.length} cards remaining in library`}
              />
            </div>
          )}

          {hasActiveStack && (
            <div className="space-y-3">
              <InterruptResponseBanner
                theme="light"
                stackItems={stackItems}
                handCards={hand}
                playerCreatures={battlefield
                  .filter((p) => p.isCreature)
                  .map((p) => {
                    const eff = getEffectivePermanentStats(p);
                    return {
                      uid: p.uid,
                      name: p.name,
                      power: eff.power,
                      toughness: eff.toughness,
                      isCommander: p.isCommander,
                      protectedUntilEot: p.protectedUntilEot,
                    };
                  })}
                liveBots={liveBots}
                activatedAbilities={availableActivatedAbilities}
                totalAvailableMana={totalAvailableMana}
                untappedLandsCount={untappedLandsCount}
                hasCommanderInPlay={hasCommanderInPlayNow}
                countdownMs={interruptRemainingMs}
                totalWindowMs={interruptTotalMs}
                isTimerHeld={interruptTimerHeld}
                windowMode={interruptWindowMode}
                onToggleHoldTimer={() => setInterruptTimerHeld((prev) => !prev)}
                onCastResponse={handleCastStackResponse}
                onActivateAbility={handleActivateAbility}
                onResolveTop={() => resolveStack(false)}
                onResolveAll={() => resolveStack(true)}
                onTapAllUntappedLands={handleTapAllUntappedLands}
                onInspectCard={(name) => onInspectCard(name)}
              />
              <TabletopStackPanel
                theme="light"
                stackItems={stackItems}
                handCards={hand}
                playerCreatures={battlefield
                  .filter((p) => p.isCreature)
                  .map((p) => {
                    const eff = getEffectivePermanentStats(p);
                    return {
                      uid: p.uid,
                      name: p.name,
                      power: eff.power,
                      toughness: eff.toughness,
                      isCommander: p.isCommander,
                      protectedUntilEot: p.protectedUntilEot,
                    };
                  })}
                liveBots={liveBots}
                activatedAbilities={availableActivatedAbilities}
                totalAvailableMana={totalAvailableMana}
                totalManaPool={totalManaPool}
                untappedLandsCount={untappedLandsCount}
                hasCommanderInPlay={hasCommanderInPlayNow}
                onCastResponse={handleCastStackResponse}
                onActivateAbility={handleActivateAbility}
                onResolveTop={() => resolveStack(false)}
                onResolveAll={() => resolveStack(true)}
                onTapAllUntappedLands={handleTapAllUntappedLands}
                onInspectCard={(name) => onInspectCard(name)}
              />
            </div>
          )}
      {/* Mana Pool & Battlefield Summary Row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.2fr_1fr] border-b border-zinc-100 pb-5">
        {/* Mana Pool Controls */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-zinc-800">
              <Droplets className="h-4 w-4 text-sky-700" />
              <span>Mana Pool</span>
              <span className="font-mono tabular-nums text-sky-700">
                ({totalManaPool} floating · {untappedLandsCount}/{totalLandsInPlay} untapped lands)
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleTapAllUntappedLands}
                disabled={untappedLandsCount === 0}
                className="rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
              >
                Tap Untapped Lands
              </button>
              <button
                type="button"
                onClick={handleUntapAll}
                className="rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 cursor-pointer whitespace-nowrap shrink-0"
              >
                Untap All
              </button>
              <button
                type="button"
                onClick={() => setManaPool({ ...EMPTY_POOL })}
                disabled={totalManaPool === 0}
                className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-medium text-zinc-600 hover:text-zinc-900 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
              >
                Empty Pool
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {MANA_KEYS.map((mk) => (
              <div
                key={mk.color}
                className={`rounded-lg border ${mk.borderClass} bg-zinc-50/70 px-2.5 py-2 flex flex-col items-center gap-1.5`}
              >
                <div className="flex items-center gap-1.5 font-mono text-xs font-bold">
                  <span className={mk.textClass}>{'{' + mk.label + '}'}</span>
                  <span className="tabular-nums text-zinc-900 text-sm">{manaPool[mk.color]}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={`Remove ${mk.label} mana`}
                    onClick={() => adjustManaPool(mk.color, -1)}
                    disabled={manaPool[mk.color] <= 0}
                    className="rounded border border-zinc-300 bg-white p-1 text-zinc-600 hover:text-zinc-900 disabled:opacity-35 cursor-pointer"
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Add ${mk.label} mana`}
                    onClick={() => adjustManaPool(mk.color, 1)}
                    className="rounded border border-zinc-300 bg-white p-1 text-zinc-600 hover:text-sky-700 cursor-pointer"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <label className="inline-flex items-center gap-2 text-[11px] text-zinc-500 cursor-pointer">
            <input
              type="checkbox"
              checked={emptyPoolBetweenPhases}
              onChange={(e) => setEmptyPoolBetweenPhases(e.target.checked)}
              className="rounded border-zinc-300"
            />
            Empty unspent mana automatically between phases (MTG rule)
          </label>
        </div>

        {/* Your Life, Poison & Commander Damage Summary */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 text-xs font-semibold text-zinc-800">
            <div className="flex items-center gap-2">
              <Flame className="h-4 w-4 text-red-700" />
              <span>Your Life &amp; Survival</span>
            </div>
            <span className="font-mono text-[11px] tabular-nums text-zinc-500">
              Lands played this turn: {landsPlayedThisTurn}/1
            </span>
          </div>

          <div className="rounded-lg border border-zinc-200 bg-zinc-50/70 p-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[11px] text-zinc-500">Your Life Total</div>
                <div
                  className={`font-mono text-2xl font-bold tabular-nums ${
                    yourLife <= 0
                      ? 'text-red-700'
                      : yourLife <= 10
                      ? 'text-amber-700'
                      : 'text-sky-700'
                  }`}
                >
                  {yourLife} HP
                </div>
              </div>

              <div className="flex items-center gap-1 font-mono text-xs">
                {[-5, -1, 1, 5].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setYourLife((l) => Math.max(0, l + d))}
                    className={`rounded border px-2 py-1 font-semibold tabular-nums cursor-pointer ${
                      d < 0
                        ? 'border-red-200 bg-white text-red-700 hover:bg-red-50'
                        : 'border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50'
                    }`}
                  >
                    {d > 0 ? `+${d}` : d}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200/70 pt-2.5 text-xs">
              <div className="flex items-center gap-2 font-mono tabular-nums">
                <Skull className="h-3.5 w-3.5 text-emerald-700 shrink-0" />
                <span className="text-zinc-600">Poison:</span>
                <span
                  className={`font-bold ${
                    yourPoison >= 10
                      ? 'text-red-700'
                      : yourPoison > 0
                      ? 'text-emerald-700'
                      : 'text-zinc-800'
                  }`}
                >
                  {yourPoison}/10
                </span>
                <button
                  type="button"
                  onClick={() => setYourPoison((p) => Math.max(0, p - 1))}
                  disabled={yourPoison <= 0}
                  className="rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-[11px] disabled:opacity-40 cursor-pointer"
                >
                  -1
                </button>
                <button
                  type="button"
                  onClick={() => setYourPoison((p) => Math.min(20, p + 1))}
                  className="rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-[11px] text-emerald-700 cursor-pointer"
                >
                  +1
                </button>
              </div>

              {formatRules.usesCommanderDamage21 && (
                <div className="font-mono tabular-nums text-zinc-600">
                  Max Cmdr Taken:{' '}
                  <span
                    className={`font-bold ${
                      maxCmdrTakenFromAny >= 21
                        ? 'text-red-700'
                        : maxCmdrTakenFromAny > 0
                        ? 'text-amber-700'
                        : 'text-zinc-800'
                    }`}
                  >
                    {maxCmdrTakenFromAny}/21
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Live Bot Battlefield Seats OR Solo Goldfish Tracker Table */}
      {liveBotMode ? (
        <div className="space-y-4 border-b border-zinc-100 pb-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-zinc-800">
              <Bot className="h-4 w-4 text-sky-700" />
              <span>Bot Opponents&apos; Battlefields ({mode})</span>
            </div>
            <span className="text-[11px] text-zinc-500">
              Click any bot seat to target them in Combat ·{' '}
              {formatRules.usesCommanderDamage21
                ? '21+ Commander dmg or 10+ Poison is lethal.'
                : '10+ Poison or 0 Life is lethal.'}
            </span>
          </div>

          <div
            className={`grid grid-cols-1 gap-3.5 ${
              liveBots.length <= 1
                ? 'max-w-xl'
                : liveBots.length === 2
                ? 'md:grid-cols-2'
                : 'lg:grid-cols-3'
            }`}
          >
            {liveBots.map((bot, bIdx) => {
              const isSelectedTarget = selectedCombatTargetId === bot.id;
              const isBotActingNow = activeBotIdx === bIdx;

              return (
                <div
                  key={bot.id}
                  onClick={() => {
                    if (!bot.eliminated) setSelectedCombatTargetId(bot.id);
                  }}
                  className={`rounded-xl border p-3.5 space-y-2.5 transition-colors cursor-pointer ${
                    bot.eliminated
                      ? 'border-red-200 bg-red-50/40 opacity-75'
                      : isBotActingNow
                      ? 'border-amber-400 bg-amber-50/40'
                      : isSelectedTarget
                      ? 'border-sky-500 bg-sky-50/30 ring-1 ring-sky-500/35'
                      : 'border-zinc-200 bg-zinc-50/70 hover:border-zinc-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-xs font-bold text-zinc-900">
                          {bot.name}
                        </span>
                        {bot.eliminated ? (
                          <span className="font-mono text-[10px] font-bold uppercase text-red-700">
                            [Eliminated]
                          </span>
                        ) : isBotActingNow ? (
                          <span className="font-mono text-[10px] font-bold text-amber-700">
                            Playing...
                          </span>
                        ) : isSelectedTarget ? (
                          <span className="font-mono text-[10px] font-semibold text-sky-700">
                            Combat Target
                          </span>
                        ) : null}
                      </div>
                      <div className="text-[11px] text-zinc-500 truncate">
                        {bot.commanderName ? `${bot.commanderName} · ` : ''}{bot.archetype}
                      </div>
                    </div>

                    <div className="text-right font-mono tabular-nums shrink-0">
                      <div className={`text-base font-bold ${bot.life <= 0 ? 'text-red-700' : 'text-zinc-900'}`}>
                        {bot.life} HP
                      </div>
                      <div className="text-[10px] text-zinc-500">
                        {bot.landsInPlay}L · {bot.handCount}H · {bot.libraryCount} Lib
                      </div>
                    </div>
                  </div>

                  {/* Counters & Quick Adjust */}
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200/70 pt-2 font-mono text-[10px] tabular-nums text-zinc-600"
                  >
                    <div className="flex items-center gap-2">
                      <span className={bot.poison > 0 ? 'text-emerald-700 font-semibold' : ''}>
                        Poison {bot.poison}/10
                      </span>
                      {formatRules.usesCommanderDamage21 && (
                        <>
                          <span className="text-zinc-300">·</span>
                          <span className={bot.commanderDamageTakenFromYou > 0 ? 'text-sky-700 font-semibold' : ''}>
                            Your Cmdr {bot.commanderDamageTakenFromYou}/21
                          </span>
                          {bot.commanderDamageDealtToYou > 0 && (
                            <>
                              <span className="text-zinc-300">·</span>
                              <span className="text-amber-700 font-semibold">
                                To You {bot.commanderDamageDealtToYou}/21
                              </span>
                            </>
                          )}
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => adjustOpponentStat(bot.id, 'life', -1)}
                        className="rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-zinc-700 hover:bg-zinc-100 cursor-pointer"
                      >
                        -1
                      </button>
                      <button
                        type="button"
                        onClick={() => adjustOpponentStat(bot.id, 'life', 1)}
                        className="rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-zinc-700 hover:bg-zinc-100 cursor-pointer"
                      >
                        +1
                      </button>
                    </div>
                  </div>

                  {/* Bot's Active Creatures on Board */}
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="rounded-lg border border-zinc-200 bg-white p-2 space-y-1.5"
                  >
                    <div className="flex items-center justify-between text-[10px] font-semibold text-zinc-600">
                      <span>Board Creatures ({bot.creatures.length})</span>
                      {bot.commanderInZone && (
                        <span className="font-mono text-zinc-500">
                          Cmdr in Zone (MV {bot.commanderCmc + bot.commanderTax})
                        </span>
                      )}
                    </div>
                    {bot.creatures.length === 0 ? (
                      <div className="text-[11px] text-zinc-400">
                        No creatures on battlefield
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {bot.creatures.map((cr: LiveBotCreature) => (
                          <button
                            key={cr.uid}
                            type="button"
                            onMouseEnter={(e) => {
                              const tags: string[] = [];
                              if (cr.isCommander) tags.push('Commander');
                              if (cr.tapped) tags.push('Tapped');
                              if (cr.summoningSick && !cr.tapped) tags.push('Summoning Sick');
                              if (cr.flying) tags.push('Flying');
                              if (cr.hasInfect) tags.push('Infect');
                              setListHoveredCard({
                                name: cr.name,
                                meta: cr.meta,
                                rect: buildHoverRect(e.currentTarget),
                                ptLabel: `${cr.power}/${cr.toughness}`,
                                statusTags: tags,
                              });
                            }}
                            onMouseLeave={() => setListHoveredCard(null)}
                            onClick={() => {
                              setListHoveredCard(null);
                              onInspectCard(cr.name, cr.meta);
                            }}
                            className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium cursor-pointer transition-colors ${
                              cr.tapped
                                ? 'border-zinc-200 bg-zinc-50 text-zinc-500'
                                : 'border-zinc-300 bg-white text-zinc-800 hover:border-sky-500'
                            }`}
                          >
                            {cr.isCommander && <Crown className="h-2.5 w-2.5 text-amber-700 shrink-0" />}
                            <span className="truncate max-w-[125px]">{cr.name}</span>
                            <span className="font-mono font-bold text-sky-700">
                              {cr.power}/{cr.toughness}
                            </span>
                            {cr.tapped && <span className="text-[9px] text-zinc-400">(T)</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-1 text-[11px] text-zinc-600 leading-snug">
                    <div>
                      <span className="font-semibold text-zinc-700">Last Play:</span>{' '}
                      {bot.lastActionSummary}
                    </div>
                    {bot.liveMemory?.lastAdaptationNote && (
                      <div className="text-[10px] text-sky-800">
                        <span className="font-semibold text-sky-900">
                          Learned (IQ {bot.liveMemory.botIqScore}):
                        </span>{' '}
                        {bot.liveMemory.lastAdaptationNote}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {activeBotTurnBanner && !pendingIncomingAttack && (
            <div className="rounded-xl border border-amber-300 bg-amber-50/70 p-3.5 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-bold text-zinc-900">
                  <span className="font-mono text-amber-800">
                    Seat {activeBotTurnBanner.seatNumber}
                  </span>
                  <span>{activeBotTurnBanner.botName}&rsquo;s Turn</span>
                  <span className="text-zinc-400" aria-hidden="true">·</span>
                  <span className="font-mono text-[11px] text-zinc-600">
                    Bot {activeBotTurnBanner.queuePosition} of {activeBotTurnBanner.queueTotal}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={advanceAfterCurrentBot}
                  className="inline-flex items-center gap-1 rounded-md bg-sky-700 px-3 py-1 text-xs font-semibold text-white hover:bg-sky-800 cursor-pointer whitespace-nowrap shrink-0"
                >
                  {activeBotTurnBanner.isLastBotInRound
                    ? `Start Your Turn (T${turn + 1})`
                    : 'Next Bot Turn'}
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
              {activeBotTurnBanner.phaseSteps.length > 0 && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 text-[11px]">
                  {activeBotTurnBanner.phaseSteps.map((step, i) => (
                    <div
                      key={`${step.phase}-${i}`}
                      className="rounded-lg border border-amber-200 bg-white px-2.5 py-1.5"
                    >
                      <div className="font-mono text-[10px] font-bold uppercase text-amber-800">
                        {step.phase}
                      </div>
                      <div className="text-zinc-700">{step.summary}</div>
                    </div>
                  ))}
                </div>
              )}
              {activeBotTurnBanner.adaptationNote && (
                <div className="text-[11px] text-sky-900">
                  <strong>Live Learning:</strong> {activeBotTurnBanner.adaptationNote}
                </div>
              )}
            </div>
          )}

          {/* Interactive Declare Blockers Panel when a Bot Attacks You */}
          {pendingIncomingAttack && (
            <div className="rounded-xl border border-red-300 bg-red-50/60 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2 text-xs font-bold text-red-900">
                    <Shield className="h-4 w-4 text-red-700 shrink-0" />
                    <span>
                      Incoming Attack from {pendingIncomingAttack.botName} — Declare Blockers
                    </span>
                  </div>
                  {pendingIncomingAttack.adaptationReason && (
                    <div className="text-[11px] text-zinc-700 pl-6">
                      Bot Read: {pendingIncomingAttack.adaptationReason}
                    </div>
                  )}
                </div>
                <span className="font-mono text-[11px] text-red-800">
                  {untappedPlayerCreatures.length} untapped blocker{untappedPlayerCreatures.length === 1 ? '' : 's'} ready
                </span>
              </div>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {pendingIncomingAttack.attackers.map((atk) => {
                  const assignedIds = Object.entries(blockerAssignments)
                    .filter(([, targetId]) => targetId === atk.uid)
                    .map(([blkId]) => blkId);
                  const kwTags = formatCreatureKeywordTags(atk);

                  return (
                    <div
                      key={atk.uid}
                      className="rounded-lg border border-red-200 bg-white p-2.5 space-y-2 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-zinc-900">
                          {atk.isCommander ? '★ ' : ''}
                          {atk.name}
                        </span>
                        <span className="font-mono font-bold text-red-700">
                          {atk.power}/{atk.toughness}
                          {kwTags.length > 0 ? ` (${kwTags.slice(0, 2).join(', ')})` : ''}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        {untappedPlayerCreatures.map((blk) => {
                          const isBlockingThis = blockerAssignments[blk.uid] === atk.uid;
                          const blkTough = Number(blk.meta?.toughness) || Math.max(2, blk.power);
                          const blkKw = extractCreatureKeywords(blk.meta);
                          const canLegallyBlock = !atk.flying || blkKw.flying || blkKw.reach;
                          return (
                            <button
                              key={blk.uid}
                              type="button"
                              disabled={!canLegallyBlock}
                              title={
                                canLegallyBlock
                                  ? `Block with ${blk.name}`
                                  : `${blk.name} cannot block Flying (needs Flying or Reach)`
                              }
                              onClick={() =>
                                setBlockerAssignments((prev) => {
                                  const next = { ...prev };
                                  if (next[blk.uid] === atk.uid) {
                                    delete next[blk.uid];
                                  } else {
                                    next[blk.uid] = atk.uid;
                                  }
                                  return next;
                                })
                              }
                              className={`rounded border px-2 py-1 text-[11px] font-medium ${
                                !canLegallyBlock
                                  ? 'border-zinc-200 bg-zinc-100 text-zinc-400 cursor-not-allowed opacity-60'
                                  : isBlockingThis
                                  ? 'border-sky-600 bg-sky-700 text-white cursor-pointer'
                                  : 'border-zinc-300 bg-zinc-50 text-zinc-700 hover:bg-zinc-100 cursor-pointer'
                              }`}
                            >
                              {isBlockingThis ? 'Blocking: ' : 'Block with '}
                              {blk.name} ({blk.power}/{blkTough})
                              {!canLegallyBlock ? ' [No Fly/Reach]' : ''}
                            </button>
                          );
                        })}
                      </div>

                      {atk.menace && assignedIds.length === 1 ? (
                        <div className="text-[10px] text-amber-700 font-semibold">
                          Menace: assign 1 more blocker or damage goes through!
                        </div>
                      ) : assignedIds.length === 0 ? (
                        <div className="text-[10px] text-red-700 font-medium">
                          Unblocked ({atk.power} {atk.hasInfect ? 'poison' : 'damage'})
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => handleResolveIncomingAttack(true)}
                  className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-50 cursor-pointer"
                >
                  Take All Unblocked Damage
                </button>
                <button
                  type="button"
                  onClick={() => handleResolveIncomingAttack(false)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-sky-700 px-4 py-1.5 text-xs font-semibold text-white hover:bg-sky-800 cursor-pointer"
                >
                  <Shield className="h-3.5 w-3.5" />
                  Resolve Combat
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3 border-b border-zinc-100 pb-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-zinc-800">
              <ShieldAlert className="h-4 w-4 text-amber-700" />
              <span>
                Opponents: Life Totals{formatRules.usesCommanderDamage21 ? ' & Per-Opponent Commander Damage' : ''} ({mode})
              </span>
            </div>
            <span className="text-[11px] text-zinc-500">
              {formatRules.usesCommanderDamage21
                ? '21+ Commander damage from a single commander or 10+ Poison is lethal.'
                : '10+ Poison counters or 0 Life is lethal.'}
            </span>
          </div>

          <div className="overflow-x-auto rounded-lg border border-zinc-200">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-[11px] font-semibold text-zinc-500">
                <tr>
                  <th className="px-3 py-2">Opponent{formatRules.allowsCommandZone ? ' & Commander' : ''}</th>
                  <th className="px-3 py-2">Life Total</th>
                  <th className="px-3 py-2">Poison (/10)</th>
                  {formatRules.usesCommanderDamage21 && (
                    <>
                      <th className="px-3 py-2">Your Cmdr Dmg to Opp (/21)</th>
                      <th className="px-3 py-2">Opp Cmdr Dmg to You (/21)</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 font-mono tabular-nums">
                {opponentTrackers.map((opp) => {
                  const isEliminated =
                    opp.life <= 0 ||
                    opp.poison >= 10 ||
                    (formatRules.usesCommanderDamage21 && opp.commanderDamageTakenFromYou >= 21);

                  return (
                    <tr key={opp.id} className={isEliminated ? 'bg-red-50/30' : ''}>
                      <td className="px-3 py-2.5 font-sans">
                        <div className="font-semibold text-zinc-900">
                          {opp.name}
                          {isEliminated && (
                            <span className="ml-2 text-[11px] font-bold text-red-700">
                              [Eliminated]
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-zinc-500">
                          {opp.commanderName ? `${opp.commanderName} · ` : ''}{opp.archetype}
                        </div>
                      </td>

                      {/* Opponent Life */}
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`min-w-[44px] font-bold ${
                              opp.life <= 0 ? 'text-red-700' : 'text-zinc-900'
                            }`}
                          >
                            {opp.life} HP
                          </span>
                          {[-5, -1, 1, 5].map((d) => (
                            <button
                              key={d}
                              type="button"
                              onClick={() => adjustOpponentStat(opp.id, 'life', d)}
                              className="rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-100 cursor-pointer"
                            >
                              {d > 0 ? `+${d}` : d}
                            </button>
                          ))}
                        </div>
                      </td>

                      {/* Opponent Poison */}
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`min-w-[38px] font-semibold ${
                              opp.poison >= 10
                                ? 'text-red-700'
                                : opp.poison > 0
                                ? 'text-emerald-700'
                                : 'text-zinc-500'
                            }`}
                          >
                            {opp.poison}/10
                          </span>
                          <button
                            type="button"
                            onClick={() => adjustOpponentStat(opp.id, 'poison', -1)}
                            disabled={opp.poison <= 0}
                            className="rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[11px] disabled:opacity-40 cursor-pointer"
                          >
                            -1
                          </button>
                          <button
                            type="button"
                            onClick={() => adjustOpponentStat(opp.id, 'poison', 1)}
                            className="rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[11px] text-emerald-700 hover:bg-emerald-50 cursor-pointer"
                          >
                            +1
                          </button>
                        </div>
                      </td>

                      {formatRules.usesCommanderDamage21 && (
                        <>
                          {/* Commander Damage You Dealt To This Opponent */}
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`min-w-[44px] font-semibold ${
                                  opp.commanderDamageTakenFromYou >= 21
                                    ? 'text-red-700'
                                    : opp.commanderDamageTakenFromYou > 0
                                    ? 'text-sky-700'
                                    : 'text-zinc-500'
                                }`}
                              >
                                {opp.commanderDamageTakenFromYou}/21
                              </span>
                              {[-1, 1, 3].map((d) => (
                                <button
                                  key={d}
                                  type="button"
                                  onClick={() =>
                                    adjustOpponentStat(opp.id, 'commanderDamageTakenFromYou', d)
                                  }
                                  disabled={d < 0 && opp.commanderDamageTakenFromYou <= 0}
                                  className="rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[11px] disabled:opacity-40 hover:bg-zinc-100 cursor-pointer"
                                >
                                  {d > 0 ? `+${d}` : d}
                                </button>
                              ))}
                            </div>
                          </td>

                          {/* Commander Damage This Opponent Dealt To You */}
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`min-w-[44px] font-semibold ${
                                  opp.commanderDamageDealtToYou >= 21
                                    ? 'text-red-700'
                                    : opp.commanderDamageDealtToYou > 0
                                    ? 'text-amber-700'
                                    : 'text-zinc-500'
                                }`}
                              >
                                {opp.commanderDamageDealtToYou}/21
                              </span>
                              {[-1, 1, 3, 5].map((d) => (
                                <button
                                  key={d}
                                  type="button"
                                  onClick={() =>
                                    adjustOpponentStat(opp.id, 'commanderDamageDealtToYou', d)
                                  }
                                  disabled={d < 0 && opp.commanderDamageDealtToYou <= 0}
                                  className="rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[11px] disabled:opacity-40 hover:bg-amber-50 cursor-pointer"
                                >
                                  {d > 0 ? `+${d}` : d}
                                </button>
                              ))}
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Zones Workspace: Command Zone + Hand + Battlefield + Combat + Turn Log */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* Left Column: Command Zone + Hand */}
        <div className="space-y-5">
          {commandZone.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-zinc-800">
                Command Zone ({commandZone.length})
              </div>
              <div className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-zinc-50/60 px-3">
                {commandZone.map((cmd) => {
                  const tax = commanderTaxByUid[cmd.uid] || 0;
                  const totalCost = cmd.cmc + tax;
                  return (
                    <div
                      key={cmd.uid}
                      className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-xs"
                    >
                      <div className="min-w-0">
                        <CardLink
                          name={cmd.name}
                          meta={cmd.meta}
                          onInspect={onInspectCard}
                          className="text-xs"
                        />
                        <span className="ml-2 font-mono text-[11px] tabular-nums text-zinc-500">
                          MV {cmd.cmc}
                          {tax > 0 ? ` + ${tax} tax` : ''}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCastCommander(cmd)}
                        className="rounded-md bg-sky-700 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-sky-800 cursor-pointer whitespace-nowrap shrink-0"
                      >
                        Cast Commander ({totalCost})
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Hand */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-zinc-800">
                Your Hand ({hand.length} cards)
              </span>
              <span className="font-mono text-[11px] tabular-nums text-zinc-500">
                Available: {totalManaPool} floating + {untappedLandsCount} untapped lands
              </span>
            </div>

            {hand.length === 0 ? (
              <div className="rounded-lg border border-zinc-200 bg-zinc-50/60 px-4 py-6 text-center text-xs text-zinc-500">
                Your hand is empty. Click &ldquo;Draw Card&rdquo; or advance to Draw phase.
              </div>
            ) : (
              <div className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white px-3 max-h-[340px] overflow-y-auto">
                {hand.map((card) => {
                  const canAutoPay =
                    !card.isLand && totalManaPool + untappedLandsCount >= card.cmc;
                  const isNewlyDrawn = lastDrawnUids.includes(card.uid);
                  return (
                    <div
                      key={card.uid}
                      className={`flex flex-wrap items-center justify-between gap-2 py-2 text-xs ${
                        isNewlyDrawn ? 'animate-card-draw-slide' : ''
                      }`}
                    >
                      <div className="min-w-0 flex items-baseline gap-2">
                        <CardLink
                          name={card.name}
                          meta={card.meta}
                          onInspect={onInspectCard}
                          className="text-xs"
                        />
                        <span className="font-mono text-[11px] tabular-nums text-zinc-400 shrink-0">
                          {card.isLand ? 'Land' : `MV ${card.cmc}`}
                        </span>
                        {isNewlyDrawn && (
                          <span className="font-mono text-[10px] font-semibold text-amber-700 shrink-0">
                            Drew
                          </span>
                        )}
                      </div>

                      {card.isLand ? (
                        <button
                          type="button"
                          onClick={() => handlePlayLandFromHand(card)}
                          className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold cursor-pointer whitespace-nowrap shrink-0 ${
                            landsPlayedThisTurn === 0
                              ? 'border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100'
                              : 'border-zinc-300 bg-zinc-50 text-zinc-600 hover:text-zinc-900'
                          }`}
                        >
                          {landsPlayedThisTurn === 0 ? 'Play Land' : 'Play Extra Land'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleCastFromHand(card)}
                          disabled={!canAutoPay}
                          className="rounded-md border border-sky-300 bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-900 hover:bg-sky-100 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
                        >
                          Cast ({card.cmc})
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Battlefield + Combat Resolution + Action Log */}
        <div className="space-y-5">
          {/* Battlefield */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-zinc-800">
                Battlefield ({battlefield.length} permanents)
              </span>
              {activePhase === 'Combat' && (liveBotMode ? liveBots.some((b) => !b.eliminated) : opponentTrackers.length > 0) && (
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label="Combat target opponent"
                    value={selectedCombatTargetId}
                    onChange={(e) => setSelectedCombatTargetId(e.target.value)}
                    className="rounded border border-zinc-300 bg-white px-2 py-1 text-[11px] font-medium text-zinc-800 cursor-pointer"
                  >
                    {(liveBotMode ? liveBots.filter((b) => !b.eliminated) : opponentTrackers).map((o) => (
                      <option key={o.id} value={o.id}>
                        Attack {o.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleResolveCombat}
                    disabled={attackersCount === 0 || botsAreActing || Boolean(pendingIncomingAttack)}
                    className="inline-flex items-center gap-1 rounded-md bg-sky-700 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-sky-800 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Swords className="h-3 w-3" />
                    Deal Combat Damage ({attackersCount})
                  </button>
                </div>
              )}
            </div>

            {battlefield.length === 0 ? (
              <div className="rounded-lg border border-zinc-200 bg-zinc-50/60 px-4 py-6 text-center text-xs text-zinc-500">
                No permanents on your battlefield yet. Play a land or cast a spell from your hand.
              </div>
            ) : (
              <div className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white px-3 max-h-[260px] overflow-y-auto">
                {battlefield.map((perm) => (
                  <div
                    key={perm.uid}
                    className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs"
                  >
                    <div className="min-w-0 flex flex-wrap items-baseline gap-2">
                      <CardLink
                        name={perm.name}
                        meta={perm.meta}
                        onInspect={onInspectCard}
                        className={`text-xs ${perm.tapped ? 'opacity-65' : ''}`}
                      />
                      <span className="font-mono text-[11px] text-zinc-500">
                        {perm.tapped ? 'Tapped' : 'Untapped'}
                        {perm.isCreature ? ` · ${perm.power} Pwr` : ''}
                        {perm.isCommander ? ' · Cmdr' : ''}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleTogglePermanentTap(perm)}
                        className="rounded border border-zinc-300 bg-white px-2 py-0.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 cursor-pointer"
                      >
                        {perm.tapped
                          ? 'Untap'
                          : perm.isLand || perm.isArtifactOrRock
                          ? `Tap (+{${perm.producedMana[0] || 'C'}})`
                          : 'Tap'}
                      </button>

                      {activePhase === 'Combat' && perm.isCreature && !perm.tapped && (
                        <button
                          type="button"
                          onClick={() => handleToggleAttacker(perm.uid)}
                          className={`rounded border px-2 py-0.5 text-[11px] font-semibold cursor-pointer ${
                            perm.attacking
                              ? 'border-red-300 bg-red-50 text-red-700'
                              : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50'
                          }`}
                        >
                          {perm.attacking ? 'Attacking' : 'Attack'}
                        </button>
                      )}

                      {perm.isCommander ? (
                        <button
                          type="button"
                          onClick={() => handleReturnCommanderToZone(perm)}
                          className="rounded border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] text-zinc-600 hover:text-zinc-900 cursor-pointer"
                        >
                          To Cmd Zone
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleMovePermanentToGy(perm)}
                          className="rounded border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] text-zinc-600 hover:text-red-700 cursor-pointer"
                        >
                          To GY
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Turn Action Log */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 text-xs font-semibold text-zinc-800">
              <div className="flex items-center gap-1.5">
                <Zap className="h-3.5 w-3.5 text-sky-700" />
                <span>Turn Simulation Log</span>
              </div>
              <div className="flex items-center gap-2 font-mono text-[11px] text-zinc-500">
                <Coins className="h-3 w-3" />
                <span>{graveyard.length} in GY</span>
                <button
                  type="button"
                  onClick={() => setTurnLog([])}
                  className="text-zinc-500 hover:text-zinc-900 underline cursor-pointer"
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-zinc-200 bg-zinc-50/60 px-3 py-2 max-h-[145px] overflow-y-auto divide-y divide-zinc-100 text-[11px]">
              {turnLog.length === 0 ? (
                <p className="py-2 text-zinc-500">No actions recorded yet.</p>
              ) : (
                turnLog.map((entry) => (
                  <div key={entry.id} className="py-1.5 flex items-baseline gap-2">
                    <span className="font-mono font-semibold text-sky-700 whitespace-nowrap shrink-0">
                      T{entry.turn} · {entry.phase}
                    </span>
                    <span className="text-zinc-700">{entry.message}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
        </>
      )}

      {/* Quick Footer Reminder */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 pt-3 text-[11px] text-zinc-500">
        <span>
          Hover over any card on the field to enlarge and read it clearly, or click any card to inspect full printings &amp; prices.
        </span>
        <button
          type="button"
          onClick={() => resetGame('Reset simulator state')}
          className="inline-flex items-center gap-1 text-zinc-600 hover:text-zinc-900 font-medium cursor-pointer"
        >
          <RotateCcw className="h-3 w-3" />
          Reset Table State
        </button>
      </div>
      <CardHoverZoomOverlay
        preview={listHoveredCard}
        enabled={true}
        onDismiss={() => setListHoveredCard(null)}
      />
        </>
      )}
    </div>
  );
};
