import React, { useEffect, useMemo, useState } from 'react';
import {
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
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Shield,
  ShieldAlert,
  Shuffle,
  Skull,
  Sparkles,
  Swords,
  Timer,
  Trophy,
  Zap,
} from 'lucide-react';
import type {
  BotOpponentConfig,
  CardMetadata,
  DeckAnalysisResult,
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
  detectArchetypeCombatBias,
  detectCardMechanics,
  getFormatSimulationRules,
} from '../utils/playtestReconciler';
import {
  createInitialLiveBots,
  executeBotTurn,
  type LiveBotCreature,
  type LiveBotState,
  type PendingBotAttack,
  type PlayerBoardSnapshot,
} from '../utils/liveBotEngine';
import {
  buildHoverRect,
  CardHoverZoomOverlay,
  type HoveredCardPreview,
} from './CardHoverZoomOverlay';
import { CardLink } from './CardInspectorModal';
import { DeckShuffleAnimation } from './DeckShuffleAnimation';
import { LiveTabletopArena, playTabletopSound } from './LiveTabletopArena';
import { PlaytestVisualBoard } from './PlaytestVisualBoard';

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
}

export const InteractiveTurnSimulator: React.FC<InteractiveTurnSimulatorProps> = ({
  analysis,
  optimizedDeckText,
  effectiveUserCards,
  useOptimizedList,
  deckVersionLabel,
  mode,
  opponents,
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
  const startingLife = formatRules.startingLife;

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
  const [manaPool, setManaPool] = useState<ManaPoolState>({ ...EMPTY_POOL });

  const [library, setLibrary] = useState<SimCardInstance[]>(initialZones.library);
  const [hand, setHand] = useState<SimCardInstance[]>(initialZones.openingHand);
  const [lastDrawnUids, setLastDrawnUids] = useState<string[]>([]);
  const [commandZone, setCommandZone] = useState<SimCardInstance[]>(initialZones.commanders);
  const [commanderTaxByUid, setCommanderTaxByUid] = useState<Record<string, number>>({});
  const [battlefield, setBattlefield] = useState<BattlefieldPermanent[]>([]);
  const [graveyard, setGraveyard] = useState<SimCardInstance[]>([]);

  const [liveBotMode, setLiveBotMode] = useState<boolean>(true);
  const [guiView, setGuiView] = useState<'tabletop' | 'list'>('tabletop');
  const [soundEnabled, setSoundEnabled] = useState<boolean>(false);
  const [fastBotTurns, setFastBotTurns] = useState<boolean>(false);
  const [isShufflingDeck, setIsShufflingDeck] = useState<boolean>(false);
  const shuffleTimerRef = React.useRef<number | null>(null);
  const [liveBots, setLiveBots] = useState<LiveBotState[]>(() =>
    createInitialLiveBots(opponents, startingLife, format, findMeta)
  );
  const [botQueueIndices, setBotQueueIndices] = useState<number[]>([]);
  const [activeBotIdx, setActiveBotIdx] = useState<number | null>(null);
  const [pendingIncomingAttack, setPendingIncomingAttack] =
    useState<PendingBotAttack | null>(null);
  const [blockerAssignments, setBlockerAssignments] = useState<
    Record<string, string>
  >({});

  const [opponentTrackers, setOpponentTrackers] = useState<OpponentTrackerState[]>(
    buildInitialOpponents
  );
  const [selectedCombatTargetId, setSelectedCombatTargetId] = useState<string>(
    opponents[0]?.id || ''
  );
  const [listHoveredCard, setListHoveredCard] = useState<HoveredCardPreview | null>(null);

  const [turnLog, setTurnLog] = useState<TurnLogEntry[]>([
    {
      id: 'init-0',
      turn: 1,
      phase: 'Untap',
      message: `Shuffled ${initialZones.library.length + initialZones.openingHand.length} main cards, drew opening 7 (${format}, ${startingLife} starting life).`,
    },
  ]);

  useEffect(() => {
    return () => {
      if (shuffleTimerRef.current !== null) {
        window.clearTimeout(shuffleTimerRef.current);
      }
    };
  }, []);

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

  const resetGame = (reasonLabel = 'Started new shuffled game', animateShuffle = true) => {
    const zones = buildDeckZones();
    setTurn(1);
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
    setManaPool({ ...EMPTY_POOL });
    setLibrary(zones.library);
    setHand(zones.openingHand);
    setLastDrawnUids([]);
    setCommandZone(zones.commanders);
    setCommanderTaxByUid({});
    setBattlefield([]);
    setGraveyard([]);
    setBotQueueIndices([]);
    setActiveBotIdx(null);
    setPendingIncomingAttack(null);
    setBlockerAssignments({});
    const nextLiveBots = createInitialLiveBots(opponents, startingLife, format, findMeta);
    setLiveBots(nextLiveBots);
    const nextOpps = buildInitialOpponents();
    setOpponentTrackers(nextOpps);
    setSelectedCombatTargetId(nextOpps[0]?.id || '');
    setTurnLog([
      {
        id: `reset-${Date.now()}`,
        turn: 1,
        phase: 'Untap',
        message: `${reasonLabel} — drew opening 7 (${zones.library.length} left in library).`,
      },
    ]);
    if (animateShuffle) {
      triggerDeckShuffleAnimation(true);
    }
  };

  // Switch into Live Play vs Bots when triggered from the top PlaytestArena bar
  const prevNonceRef = React.useRef<number>(liveVsBotsNonce);
  useEffect(() => {
    if (liveVsBotsNonce > prevNonceRef.current) {
      prevNonceRef.current = liveVsBotsNonce;
      setLiveBotMode(true);
      triggerDeckShuffleAnimation(true);
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
    setLiveBots(createInitialLiveBots(opponents, startingLife, format, findMeta));
    setBotQueueIndices([]);
    setActiveBotIdx(null);
    setPendingIncomingAttack(null);
    setBlockerAssignments({});
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
  const totalLandsInPlay = battlefield.filter((b) => b.isLand).length;

  const goToPhase = (targetIdx: number, isNewTurn = false, nextTurnNum = turn) => {
    const targetPhase = PHASES[targetIdx];
    const shouldEmpty = emptyPoolBetweenPhases && (isNewTurn || targetIdx !== phaseIdx);

    if (shouldEmpty && sumManaPool(manaPool) > 0) {
      setManaPool({ ...EMPTY_POOL });
    }

    if (targetPhase === 'Untap' && isNewTurn) {
      setBattlefield((prev) =>
        prev.map((perm) => ({
          ...perm,
          tapped: false,
          attacking: false,
          summoningSick: false,
        }))
      );
      setLandsPlayedThisTurn(0);
      setDrawnInDrawStep(false);
      appendLog(`Untap step: untapped all permanents.`, nextTurnNum, 'Untap');
    } else if (targetPhase === 'Draw' && !drawnInDrawStep) {
      if (nextTurnNum === 1 && formatRules.playerSkipsTurn1Draw) {
        setDrawnInDrawStep(true);
        appendLog('Draw step skipped (1v1 Seat 1 Turn-1 rule).', nextTurnNum, 'Draw');
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

  const handleEndSimulation = () => {
    if (botsAreActing || pendingIncomingAttack || simulationEndedManually || liveMatchOutcome) {
      return;
    }
    if (currentTurnElapsedRef.current > 0 || completedTurnDurations.length === 0) {
      commitCurrentTurnDuration(turn);
    }
    setSimulationEndedManually(true);
    appendLog(`Finished simulation on Turn ${turn} — Turn Duration Summary ready.`, turn, activePhase);
  };

  const startBotTurns = () => {
    const aliveIndices = liveBots
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
    appendLog(`Ended Turn ${turn} — passing turn priority to bots.`, turn, 'End');
    setBotQueueIndices(aliveIndices);
  };

  const handlePassTurn = () => {
    if (
      botQueueIndices.length > 0 ||
      pendingIncomingAttack ||
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
    yourLife,
    yourPoison,
    turn,
  });
  latestGameRef.current = {
    liveBots,
    battlefield,
    library,
    yourLife,
    yourPoison,
    turn,
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
    !(liveBotMode && (botQueueIndices.length > 0 || activeBotIdx !== null)) &&
    !pendingIncomingAttack &&
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

  // Finalize active turn duration when live game reaches Victory or Defeat
  const prevOutcomeRef = React.useRef<'victory' | 'defeat' | null>(null);
  useEffect(() => {
    if (liveMatchOutcome && !prevOutcomeRef.current) {
      if (currentTurnElapsedRef.current > 0) {
        commitCurrentTurnDuration(turn);
      }
    }
    prevOutcomeRef.current = liveMatchOutcome;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveMatchOutcome]);

  // Execute queued bot turns sequentially with realistic pacing
  useEffect(() => {
    if (!liveBotMode || botQueueIndices.length === 0 || pendingIncomingAttack || liveMatchOutcome) {
      if (botQueueIndices.length === 0) setActiveBotIdx(null);
      return;
    }

    const nextBotIndex = botQueueIndices[0];
    setActiveBotIdx(nextBotIndex);

    const timer = window.setTimeout(() => {
      const snap = latestGameRef.current;
      const playerSnapshot: PlayerBoardSnapshot = {
        life: snap.yourLife,
        poison: snap.yourPoison,
        libraryCount: snap.library.length,
        creatures: snap.battlefield
          .filter((p) => p.isCreature)
          .map((p) => ({
            uid: p.uid,
            name: p.name,
            power: p.power,
            toughness: Number(p.meta?.toughness) || Math.max(2, p.power),
            tapped: p.tapped,
            isCommander: p.isCommander,
            hasInfect: p.hasInfect,
            toxicValue: p.toxicValue,
          })),
        landsCount: snap.battlefield.filter((p) => p.isLand).length,
        hasCommanderInPlay: snap.battlefield.some((p) => p.isCommander),
      };

      const res = executeBotTurn(
        nextBotIndex,
        snap.liveBots,
        playerSnapshot,
        snap.turn,
        findMeta
      );

      setLiveBots(res.updatedBots);

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
      if (res.removedPlayerCreatureUids.length > 0) {
        const removeSet = new Set(res.removedPlayerCreatureUids);
        setBattlefield((prevBf) => {
          const staying: BattlefieldPermanent[] = [];
          const returnedCmds: SimCardInstance[] = [];
          const gyCards: SimCardInstance[] = [];
          for (const perm of prevBf) {
            if (removeSet.has(perm.uid)) {
              if (perm.isCommander) returnedCmds.push(perm);
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
          return staying;
        });
      }

      const activeBotName = snap.liveBots[nextBotIndex]?.name || 'Bot';
      for (const msg of res.logs) {
        appendLog(`[${activeBotName}] ${msg}`, snap.turn, 'Combat');
      }

      const remaining = botQueueIndices.slice(1);
      setBotQueueIndices(remaining);

      if (res.pendingAttackOnPlayer) {
        setPendingIncomingAttack(res.pendingAttackOnPlayer);
        setBlockerAssignments({});
        return;
      }

      if (remaining.length === 0) {
        const nextTurn = snap.turn + 1;
        setActiveBotIdx(null);
        setTurn(nextTurn);
        goToPhase(0, true, nextTurn);
      }
    }, fastBotTurns ? 140 : 560);

    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveBotMode, botQueueIndices, pendingIncomingAttack, fastBotTurns, liveMatchOutcome]);

  const handleResolveIncomingAttack = (ignoreBlockers = false) => {
    if (!pendingIncomingAttack) return;

    const attackingBotId = pendingIncomingAttack.botId;
    const assignments = ignoreBlockers ? {} : blockerAssignments;

    let lifeDmg = 0;
    let poisonDmg = 0;
    let cmdrDmg = 0;
    const deadPlayerUids = new Set<string>();
    const deadBotAttackerUids = new Set<string>();
    const blockLogParts: string[] = [];

    for (const atk of pendingIncomingAttack.attackers) {
      const assignedBlockerUids = Object.entries(assignments)
        .filter(([, targetAtkUid]) => targetAtkUid === atk.uid)
        .map(([blkUid]) => blkUid);

      const blockers = battlefield.filter((p) => assignedBlockerUids.includes(p.uid));

      if (blockers.length > 0) {
        const totalBlkPower = blockers.reduce((s, b) => s + b.power, 0);
        if (totalBlkPower >= atk.toughness) {
          deadBotAttackerUids.add(atk.uid);
        }
        let remainingAtkPower = atk.power;
        for (const blk of blockers) {
          const blkTough = Number(blk.meta?.toughness) || Math.max(2, blk.power);
          if (remainingAtkPower >= blkTough) {
            deadPlayerUids.add(blk.uid);
            remainingAtkPower -= blkTough;
          }
        }
        blockLogParts.push(
          `Blocked ${atk.name} (${atk.power}/${atk.toughness}) with ${blockers.map((b) => b.name).join(' + ')}`
        );
      } else {
        if (atk.hasInfect) {
          poisonDmg += atk.power;
        } else {
          lifeDmg += atk.power;
          if (atk.toxicValue > 0) poisonDmg += atk.toxicValue;
        }
        if (atk.isCommander && formatRules.usesCommanderDamage21) {
          cmdrDmg += atk.power;
        }
      }
    }

    if (lifeDmg > 0) {
      setYourLife((l) => Math.max(0, l - lifeDmg));
    }
    if (poisonDmg > 0) {
      setYourPoison((p) => Math.min(20, p + poisonDmg));
    }

    if (deadPlayerUids.size > 0) {
      setBattlefield((prev) => {
        const staying: BattlefieldPermanent[] = [];
        const cmds: SimCardInstance[] = [];
        const gy: SimCardInstance[] = [];
        for (const p of prev) {
          if (deadPlayerUids.has(p.uid)) {
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

    setLiveBots((prev) =>
      prev.map((b) => {
        if (b.id !== attackingBotId) return b;
        let cmdReturned = false;
        let gyAdded = 0;
        const surviving = b.creatures.filter((c) => {
          if (!deadBotAttackerUids.has(c.uid)) return true;
          if (c.isCommander) cmdReturned = true;
          else gyAdded += 1;
          return false;
        });
        return {
          ...b,
          creatures: surviving,
          commanderInZone: b.commanderInZone || cmdReturned,
          commanderTax: cmdReturned ? b.commanderTax + 2 : b.commanderTax,
          graveyardCount: b.graveyardCount + gyAdded,
          commanderDamageDealtToYou: b.commanderDamageDealtToYou + cmdrDmg,
        };
      })
    );

    const summaryParts = [...blockLogParts];
    if (lifeDmg > 0) summaryParts.push(`took ${lifeDmg} combat damage`);
    if (poisonDmg > 0) summaryParts.push(`+${poisonDmg} poison`);
    if (cmdrDmg > 0) summaryParts.push(`+${cmdrDmg} Commander dmg`);
    appendLog(
      `Combat vs ${pendingIncomingAttack.botName}: ${summaryParts.join(', ') || 'all damage blocked'}.`,
      turn,
      'Combat'
    );

    setPendingIncomingAttack(null);
    setBlockerAssignments({});

    if (botQueueIndices.length === 0) {
      const nextTurn = turn + 1;
      setActiveBotIdx(null);
      setTurn(nextTurn);
      goToPhase(0, true, nextTurn);
    }
  };

  const handleNextPhase = () => {
    if (botQueueIndices.length > 0 || pendingIncomingAttack || isSimulationFinished) return;
    if (phaseIdx < PHASES.length - 1) {
      goToPhase(phaseIdx + 1, false, turn);
    } else {
      handlePassTurn();
    }
  };

  const handlePrevPhase = () => {
    if (botQueueIndices.length > 0 || pendingIncomingAttack || isSimulationFinished) return;
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
    setHand((prev) => prev.filter((c) => c.uid !== card.uid));
    setBattlefield((prev) => [
      ...prev,
      { ...card, tapped: Boolean(card.meta?.entersTappedLikely), attacking: false, summoningSick: false },
    ]);
    setLandsPlayedThisTurn((n) => n + 1);
    playTabletopSound(soundEnabled, 'land');
    appendLog(
      `Played land: ${card.name}${card.meta?.entersTappedLikely ? ' (enters tapped)' : ''}.`
    );
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
    const isPermanent =
      /\b(creature|artifact|enchantment|planeswalker|battle)\b/i.test(card.typeLine) ||
      (!/\b(instant|sorcery)\b/i.test(card.typeLine) && card.isArtifactOrRock);

    if (isPermanent) {
      setBattlefield((prev) => [
        ...prev,
        { ...card, tapped: false, attacking: false, summoningSick: card.isCreature },
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

    setCommandZone((prev) => prev.filter((c) => c.uid !== cmd.uid));
    setCommanderTaxByUid((prev) => ({ ...prev, [cmd.uid]: tax + 2 }));
    setBattlefield((prev) => [
      ...prev,
      { ...cmd, tapped: false, attacking: false, summoningSick: true },
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
    if (perm.isCommander) {
      setCommandZone((prev) => [...prev, perm]);
      appendLog(`${perm.name} left battlefield to Command Zone.`);
    } else {
      setGraveyard((prev) => [perm, ...prev]);
      appendLog(`Moved ${perm.name} to Graveyard.`);
    }
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
      // Bot smartly blocks 1 attacker if facing lethal or favorable trade with untapped creature
      const untappedBotBlockers = targetBot.creatures.filter((c) => !c.tapped && c.toughness > 0);
      const sortedAttackers = [...attackers].sort((a, b) => b.power - a.power);
      const botBlockedAtkUids = new Set<string>();
      const deadBotBlockerUids = new Set<string>();
      const deadPlayerAtkUids = new Set<string>();
      const blockMessages: string[] = [];

      const totalIncomingPower = attackers.reduce((s, a) => s + a.power, 0);
      if (untappedBotBlockers.length > 0 && (totalIncomingPower >= targetBot.life || targetBot.life <= 15 || attackers.some((a) => a.isCommander))) {
        const bestBlocker = [...untappedBotBlockers].sort((a, b) => b.toughness - a.toughness)[0];
        const targetAtk = sortedAttackers[0];
        if (bestBlocker && targetAtk) {
          botBlockedAtkUids.add(targetAtk.uid);
          const atkTough = Number(targetAtk.meta?.toughness) || Math.max(2, targetAtk.power);
          if (bestBlocker.power >= atkTough) {
            deadPlayerAtkUids.add(targetAtk.uid);
          }
          if (targetAtk.power >= bestBlocker.toughness) {
            deadBotBlockerUids.add(bestBlocker.uid);
          }
          blockMessages.push(`${targetBot.name} blocked ${targetAtk.name} with ${bestBlocker.name}`);
        }
      }

      let lifeDmg = 0;
      let cmdrDmg = 0;
      let poisonDmg = 0;

      for (const atk of attackers) {
        if (botBlockedAtkUids.has(atk.uid)) continue;
        if (atk.hasInfect) {
          poisonDmg += atk.power;
        } else {
          lifeDmg += atk.power;
          if (atk.toxicValue > 0) poisonDmg += atk.toxicValue;
        }
        if (atk.isCommander) {
          cmdrDmg += atk.power;
        }
      }

      setBattlefield((prev) => {
        const next: BattlefieldPermanent[] = [];
        const retCmds: SimCardInstance[] = [];
        const gyAdds: SimCardInstance[] = [];
        for (const p of prev) {
          if (deadPlayerAtkUids.has(p.uid)) {
            if (p.isCommander) retCmds.push(p);
            else gyAdds.push(p);
          } else {
            next.push(p.attacking ? { ...p, tapped: true, attacking: false } : p);
          }
        }
        if (retCmds.length > 0) setCommandZone((cz) => [...cz, ...retCmds]);
        if (gyAdds.length > 0) setGraveyard((gy) => [...gyAdds, ...gy]);
        return next;
      });

      setLiveBots((prev) =>
        prev.map((b) => {
          if (b.id !== targetBot.id) return b;
          const nextLife = Math.max(0, b.life - lifeDmg);
          const nextPoison = Math.min(20, b.poison + poisonDmg);
          const nextCmdr =
            b.commanderDamageTakenFromYou + (formatRules.usesCommanderDamage21 ? cmdrDmg : 0);
          const eliminatedReason =
            nextPoison >= 10
              ? 'poison'
              : formatRules.usesCommanderDamage21 && nextCmdr >= 21
              ? 'commander'
              : nextLife <= 0
              ? 'life'
              : b.eliminatedReason;
          const eliminated = Boolean(eliminatedReason);
          let cmdBack = false;
          let gyInc = 0;
          const survivingCreatures = eliminated
            ? []
            : b.creatures.filter((c) => {
                if (!deadBotBlockerUids.has(c.uid)) return true;
                if (c.isCommander) cmdBack = true;
                else gyInc += 1;
                return false;
              });

          return {
            ...b,
            life: nextLife,
            poison: nextPoison,
            commanderDamageTakenFromYou: nextCmdr,
            eliminated,
            eliminatedReason,
            creatures: survivingCreatures,
            commanderInZone: b.commanderInZone || cmdBack,
            commanderTax: cmdBack ? b.commanderTax + 2 : b.commanderTax,
            graveyardCount: b.graveyardCount + gyInc,
          };
        })
      );

      const parts: string[] = [...blockMessages];
      if (lifeDmg > 0) parts.push(`${lifeDmg} damage`);
      if (cmdrDmg > 0) parts.push(`${cmdrDmg} Commander dmg`);
      if (poisonDmg > 0) parts.push(`${poisonDmg} poison`);
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
      if (atk.hasInfect) {
        poisonDmg += atk.power;
      } else {
        lifeDmg += atk.power;
        if (atk.toxicValue > 0) poisonDmg += atk.toxicValue;
      }
      if (atk.isCommander) {
        cmdrDmg += atk.power;
      }
    }

    setBattlefield((prev) =>
      prev.map((p) => (p.attacking ? { ...p, tapped: true, attacking: false } : p))
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

  const botsAreActing = liveBotMode && (botQueueIndices.length > 0 || activeBotIdx !== null);
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

  return (
    <div
      id="interactive-live-game"
      className="rounded-xl border border-zinc-200 bg-white p-6 space-y-6 scroll-mt-20"
    >
      {/* Unified Play Area Header (Live Play vs Bots + Visual Board Match Replay) */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-100 pb-4">
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
            ) : (
              <>
                <span className="font-mono font-semibold tabular-nums text-zinc-800">
                  Turn {turn}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-semibold text-sky-700">
                  {botsAreActing ? 'Bot Turns' : `${activePhase} Phase`}
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
                    setActiveBotIdx(null);
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

              {liveBotMode && (
                <button
                  type="button"
                  onClick={() => setFastBotTurns((v) => !v)}
                  aria-pressed={fastBotTurns}
                  title="Toggle fast bot turns"
                  className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium cursor-pointer whitespace-nowrap shrink-0 ${
                    fastBotTurns
                      ? 'border-sky-300 bg-sky-50 text-sky-900'
                      : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50'
                  }`}
                >
                  <FastForward className="h-3.5 w-3.5 text-sky-700" />
                  {fastBotTurns ? 'Fast Bots' : 'Normal Pace'}
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
                onClick={() => resetGame('Reshuffled deck & drew fresh Opening 7', true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 cursor-pointer whitespace-nowrap shrink-0"
              >
                <RotateCcw className="h-3.5 w-3.5 text-sky-700" />
                New Game
              </button>
            </>
          )}
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
            disabled={botsAreActing || Boolean(pendingIncomingAttack) || isSimulationFinished}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-sky-800 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
          >
            <ChevronRight className="h-3.5 w-3.5" />
            {liveBotMode ? 'Pass Turn → Bots (+1)' : 'Pass Turn (+1)'}
          </button>
          {!isSimulationFinished && (
            <button
              type="button"
              onClick={handleEndSimulation}
              disabled={botsAreActing || Boolean(pendingIncomingAttack)}
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
              disabled={botsAreActing || Boolean(pendingIncomingAttack) || isSimulationFinished}
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
                disabled={botsAreActing || Boolean(pendingIncomingAttack) || isSimulationFinished}
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
          {pendingIncomingAttack
            ? `${pendingIncomingAttack.botName} is attacking you! Assign your untapped creatures as blockers below or take combat damage.`
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
            liveBots={liveBots}
            opponentTrackers={opponentTrackers}
            selectedCombatTargetId={selectedCombatTargetId}
            pendingIncomingAttack={pendingIncomingAttack}
            blockerAssignments={blockerAssignments}
            soundEnabled={soundEnabled}
            isShufflingDeck={isShufflingDeck}
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

                  <div className="text-[11px] text-zinc-600 leading-snug">
                    <span className="font-semibold text-zinc-700">Last Play:</span>{' '}
                    {bot.lastActionSummary}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Interactive Declare Blockers Panel when a Bot Attacks You */}
          {pendingIncomingAttack && (
            <div className="rounded-xl border border-red-300 bg-red-50/60 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-bold text-red-900">
                  <Shield className="h-4 w-4 text-red-700 shrink-0" />
                  <span>
                    Incoming Attack from {pendingIncomingAttack.botName} — Declare Blockers
                  </span>
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
                          {atk.hasInfect ? ' (Infect)' : atk.toxicValue > 0 ? ` (Toxic ${atk.toxicValue})` : ''}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        {untappedPlayerCreatures.map((blk) => {
                          const isBlockingThis = blockerAssignments[blk.uid] === atk.uid;
                          const blkTough = Number(blk.meta?.toughness) || Math.max(2, blk.power);
                          return (
                            <button
                              key={blk.uid}
                              type="button"
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
                              className={`rounded border px-2 py-1 text-[11px] font-medium cursor-pointer ${
                                isBlockingThis
                                  ? 'border-sky-600 bg-sky-700 text-white'
                                  : 'border-zinc-300 bg-zinc-50 text-zinc-700 hover:bg-zinc-100'
                              }`}
                            >
                              {isBlockingThis ? 'Blocking: ' : 'Block with '}
                              {blk.name} ({blk.power}/{blkTough})
                            </button>
                          );
                        })}
                      </div>

                      {assignedIds.length === 0 && (
                        <div className="text-[10px] text-red-700 font-medium">
                          Unblocked ({atk.power} {atk.hasInfect ? 'poison' : 'damage'})
                        </div>
                      )}
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
