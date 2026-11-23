import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Bot,
  Brain,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ClipboardPaste,
  Copy,
  Cpu,
  Crown,
  Eye,
  Flag,
  LayoutGrid,
  Loader2,
  MessageSquarePlus,
  Pencil,
  Play,
  RefreshCw,
  RotateCcw,
  Shuffle,
  Sliders,
  Sparkles,
  Swords,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Trophy,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import type {
  BotIndignanceLevel,
  BotIntelligenceLevel,
  BotLearningProfile,
  BotOpponentConfig,
  CardMetadata,
  DeckAnalysisResult,
  DeckFormat,
  LiveSimulationExportStats,
  PlaytestDeckVersion,
  PlaytestMode,
  PlaytestResult,
  ResolvedDeckCard,
  RoundDeckChange,
} from '../types/deck';
import {
  BOT_INDIGNANCE_OPTIONS,
  getBotIndignanceMeta,
} from '../utils/botIndignance';
import {
  BOT_INTELLIGENCE_OPTIONS,
  getBotIntelligenceMeta,
} from '../utils/botIntelligence';
import {
  applyUserCoachingToBotProfile,
  createDefaultBotProfile,
  loadAutoLearnFromMatchesSetting,
  QUICK_COACHING_TAGS,
  resolveBotLearningKey,
  saveAutoLearnFromMatchesSetting,
} from '../utils/botLearning';
import {
  MANA_ISSUE_TAGS,
  autoTagPlaytestRounds,
  detectRoundManaTag,
  type ManaIssueTag,
} from '../utils/manaCorrelation';
import { copyTextToClipboard, readTextFromClipboard } from '../utils/clipboard';
import {
  detectArchetypeCombatBias,
  findMetaFromMap,
  normalizeCardLookupKey,
} from '../utils/playtestReconciler';
import { getPresetBotCardNames } from '../utils/liveBotEngine';
import {
  autoRecognizeCommandersClientSide,
  parseDecklistClientSide,
  resolveCardsWithBrowserScryfall,
  serializeResolvedDeckToText,
  setDecklistCommanderClientSide,
} from '../utils/clientFallbackAnalyzer';
import {
  applyBotLearningsInWorker,
  runPlaytestInWorker,
  terminatePlaytestWorker,
} from '../utils/playtestWorkerClient';
import {
  fetchNdjsonWithProgress,
  ServerReturnedError,
} from '../utils/streamApi';
import { CardLink } from './CardInspectorModal';
import { DeckShuffleAnimation } from './DeckShuffleAnimation';
import {
  OperationProgressBar,
  type OperationProgressState,
} from './OperationProgressBar';
import { PlaytestMatchLogSidebar } from './PlaytestMatchLogSidebar';
import { PlaytestManaCorrelation } from './PlaytestManaCorrelation';
import {
  PlaytestTutorialModal,
  type TutorialStepId,
} from './PlaytestTutorialModal';
import { TurnSummaryModal } from './TurnSummaryModal';
import { MultiplayerSessionHub } from './MultiplayerSessionHub';
import { lazyWithRetry } from '../utils/lazyWithRetry';
const InteractiveTurnSimulator = lazyWithRetry(() =>
  import('./InteractiveTurnSimulator').then((m) => ({
    default: m.InteractiveTurnSimulator,
  }))
);

interface PlaytestArenaProps {
  analysis: DeckAnalysisResult;
  optimizedDeckText: string;
  manaOptimizedDeckText?: string;
  manaOptimizedLandCount?: number;
  selectedLandChangesCount?: number;
  totalLandChangesCount?: number;
  deckVersion?: PlaytestDeckVersion;
  onDeckVersionChange?: (version: PlaytestDeckVersion) => void;
  manaSyncNonce?: number;
  onApplyAllManaFixes?: () => void;
  onInspectCard: (name: string, meta?: CardMetadata | null) => void;
  botMemory: Record<string, BotLearningProfile>;
  onSaveBotMemoryProfiles: (profiles: BotLearningProfile[]) => void;
  onResetBotMemory: (botKey?: string) => void;
  onPlaytestResultChange?: (result: PlaytestResult | null) => void;
  onLiveStatsChange?: (stats: LiveSimulationExportStats) => void;
}

const BOT_ARCHETYPES = [
  'Mono-Red Aggro / Burn',
  'Azorius Control & Countermagic',
  'Dimir Midrange & Removal',
  'Simic Landfall & Ramp',
  'Golgari Graveyard Value',
  'Orzhov Aristocrats & Drain',
  'Izzet Spellslinger Combo',
  'Gruul Stompy Aggro',
  'Golgari / Simic Toxic & Infect',
  'Dimir Mill & Library Denial',
  'Boros / Voltron Commander Damage',
  'Custom Decklist',
];

const DEFAULT_OPPONENTS_BY_MODE: Record<PlaytestMode, BotOpponentConfig[]> = {
  '1v1': [
    {
      id: '1v1-bot-1',
      name: 'Bot 1 (Vex)',
      archetype: 'Mono-Red Aggro / Burn',
      indignance: 'measured',
      intelligence: 'tactical',
      customDeckText: '',
    },
  ],
  '1v2': [
    {
      id: '1v2-bot-1',
      name: 'Bot 1 (Vex)',
      archetype: 'Mono-Red Aggro / Burn',
      indignance: 'ruthless',
      intelligence: 'tactical',
      customDeckText: '',
    },
    {
      id: '1v2-bot-2',
      name: 'Bot 2 (Lyra)',
      archetype: 'Azorius Control & Countermagic',
      indignance: 'measured',
      intelligence: 'competitive',
      customDeckText: '',
    },
  ],
  '1v3': [
    {
      id: '1v3-bot-1',
      name: 'Bot 1 (Vex)',
      archetype: 'Mono-Red Aggro / Burn',
      indignance: 'ruthless',
      intelligence: 'tactical',
      customDeckText: '',
    },
    {
      id: '1v3-bot-2',
      name: 'Bot 2 (Lyra)',
      archetype: 'Azorius Control & Countermagic',
      indignance: 'measured',
      intelligence: 'competitive',
      customDeckText: '',
    },
    {
      id: '1v3-bot-3',
      name: 'Bot 3 (Kor)',
      archetype: 'Golgari Graveyard Value',
      indignance: 'forgiving',
      intelligence: 'tactical',
      customDeckText: '',
    },
  ],
};

export const PlaytestArena: React.FC<PlaytestArenaProps> = ({
  analysis,
  optimizedDeckText,
  manaOptimizedDeckText,
  manaOptimizedLandCount,
  selectedLandChangesCount = 0,
  totalLandChangesCount = 0,
  deckVersion: controlledDeckVersion,
  onDeckVersionChange,
  manaSyncNonce = 0,
  onApplyAllManaFixes,
  onInspectCard,
  botMemory,
  onSaveBotMemoryProfiles,
  onResetBotMemory,
  onPlaytestResultChange,
  onLiveStatsChange,
}) => {
  const detectedFormat: Exclude<DeckFormat, 'auto'> =
    analysis.metrics?.detectedFormat || 'commander';
  const isCommanderFormat =
    detectedFormat === 'commander' || detectedFormat === 'brawl';
  const defaultMode: PlaytestMode = isCommanderFormat ? '1v3' : '1v1';

  const [mode, setMode] = useState<PlaytestMode>(defaultMode);
  const prevIsCommanderRef = useRef<boolean>(isCommanderFormat);
  const [internalDeckVersion, setInternalDeckVersion] =
    useState<PlaytestDeckVersion>('original');
  const deckVersion = controlledDeckVersion ?? internalDeckVersion;
  const setDeckVersion = (next: PlaytestDeckVersion) => {
    if (onDeckVersionChange) {
      onDeckVersionChange(next);
    } else {
      setInternalDeckVersion(next);
    }
  };
  const [manaSyncNotice, setManaSyncNotice] = useState<string | null>(null);
  const prevManaSyncNonceRef = useRef<number>(manaSyncNonce);
  const [playerCommanderOverride, setPlayerCommanderOverride] = useState<string | null>(null);
  const [playerCustomDeckText, setPlayerCustomDeckText] = useState<string | null>(null);
  const [playerDeckDraftText, setPlayerDeckDraftText] = useState<string>('');
  const [isEditingPlayerDeck, setIsEditingPlayerDeck] = useState(false);
  const [extraScryfallMeta, setExtraScryfallMeta] = useState<Map<string, CardMetadata>>(
    () => new Map()
  );
  const [resolvingCustomMeta, setResolvingCustomMeta] = useState(false);
  const [showLoadedDeckPreview, setShowLoadedDeckPreview] = useState(false);
  const [copiedLoadedDeck, setCopiedLoadedDeck] = useState(false);
  const [clipboardNoticeKey, setClipboardNoticeKey] = useState<string | null>(null);
  const [opponentsByMode, setOpponentsByMode] = useState<
    Record<PlaytestMode, BotOpponentConfig[]>
  >(DEFAULT_OPPONENTS_BY_MODE);
  const [isMultiplayerHubOpen, setIsMultiplayerHubOpen] = useState(false);
  const [isSetupExpanded, setIsSetupExpanded] = useState(true);

  const [expandedBrainKey, setExpandedBrainKey] = useState<string | null>(null);
  const [inlineCoachTextByKey, setInlineCoachTextByKey] = useState<Record<string, string>>({});

  // Post-match User Coaching Feedback state
  const [selectedCoachBotIdx, setSelectedCoachBotIdx] = useState<number>(0);
  const [coachRating, setCoachRating] = useState<'strong' | 'mistake' | 'needs-adjustment'>('needs-adjustment');
  const [coachTags, setCoachTags] = useState<string[]>([]);
  const [coachCustomNote, setCoachCustomNote] = useState('');
  const [coachSavedNotice, setCoachSavedNotice] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const activePlaytestAbortRef = useRef<AbortController | null>(null);
  const [playtestProgress, setPlaytestProgress] = useState<OperationProgressState>({
    percent: 0,
    stage: 'Preparing pod & shuffling decks...',
  });
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PlaytestResult | null>(null);
  const [activeRoundIdx, setActiveRoundIdx] = useState(0);
  const [playAreaMode, setPlayAreaMode] = useState<'live' | 'replay'>('live');
  const [showTurnSummaryModal, setShowTurnSummaryModal] = useState(false);
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);
  const [tutorialInitialStep, setTutorialInitialStep] = useState<TutorialStepId>('setup');
  const [liveVsBotsNonce, setLiveVsBotsNonce] = useState(0);

  const openTutorial = (step: TutorialStepId = 'setup') => {
    setTutorialInitialStep(step);
    setIsTutorialOpen(true);
  };

  useEffect(() => {
    onPlaytestResultChange?.(result);
  }, [result, onPlaytestResultChange]);

  useEffect(() => {
    const handleOpenMultiplayer = () => {
      setIsMultiplayerHubOpen(true);
    };
    window.addEventListener('umbras:open-multiplayer-hub', handleOpenMultiplayer);
    return () =>
      window.removeEventListener('umbras:open-multiplayer-hub', handleOpenMultiplayer);
  }, []);
  const [manaTagsByRound, setManaTagsByRound] = useState<
    Record<number, ManaIssueTag | undefined>
  >({});
  const [localAiEngineInfo, setLocalAiEngineInfo] = useState<{
    isGgufActive: boolean;
    effectiveEngine: 'local-gguf' | 'cloud-gemini' | 'deterministic';
    modelLabel: string | null;
    computeLabel: string;
  } | null>(null);
  const [autoLearnEnabled, setAutoLearnEnabled] = useState<boolean>(() =>
    loadAutoLearnFromMatchesSetting()
  );

  useEffect(() => {
    let cancelled = false;
    const loadAiStatus = async () => {
      setAutoLearnEnabled(loadAutoLearnFromMatchesSetting());
      try {
        const res = await fetch('/api/desktop/ai-status');
        if (!res.ok || cancelled) return;
        const payload = (await res.json()) as {
          activeEngine?: string;
          effectiveEngine?: 'local-gguf' | 'cloud-gemini' | 'deterministic';
          activeModelLabel?: string;
          computeMode?: string;
          autoLearnFromMatches?: boolean;
          selectedModelId?: string | null;
          activeModelPath?: string | null;
          catalog?: Array<{ id: string; shortName: string }>;
        };
        if (cancelled) return;
        if (typeof payload.autoLearnFromMatches === 'boolean') {
          setAutoLearnEnabled(payload.autoLearnFromMatches);
          saveAutoLearnFromMatchesSetting(payload.autoLearnFromMatches);
        }
        const hasModel = Boolean(payload.activeModelPath);
        const isGgufActive =
          hasModel &&
          payload.activeEngine !== 'deterministic' &&
          payload.activeEngine !== 'cloud-gemini';
        const effectiveEngine: 'local-gguf' | 'cloud-gemini' | 'deterministic' =
          payload.effectiveEngine ||
          (isGgufActive
            ? 'local-gguf'
            : payload.activeEngine === 'cloud-gemini'
              ? 'cloud-gemini'
              : 'deterministic');
        const matchedCatalog = payload.catalog?.find(
          (item) => item.id === payload.selectedModelId
        );
        const modelLabel =
          effectiveEngine === 'local-gguf'
            ? payload.activeModelLabel || matchedCatalog?.shortName || 'Custom .gguf'
            : effectiveEngine === 'cloud-gemini'
              ? payload.activeModelLabel || 'Cloud Gemini'
              : null;
        const computeLabel = payload.computeMode === 'auto' ? 'Auto GPU/CPU' : 'CPU';
        setLocalAiEngineInfo({ isGgufActive, effectiveEngine, modelLabel, computeLabel });
      } catch {
        // Ignore transient status fetch issues
      }
    };

    void loadAiStatus();
    const handleRefresh = () => void loadAiStatus();
    window.addEventListener('umbras:ai-status-updated', handleRefresh);

    return () => {
      cancelled = true;
      activePlaytestAbortRef.current?.abort();
      terminatePlaytestWorker();
      window.removeEventListener('umbras:ai-status-updated', handleRefresh);
    };
  }, []);

  useEffect(() => {
    setResult(null);
    setActiveRoundIdx(0);
    setShowTurnSummaryModal(false);
    setManaTagsByRound({});
    setCoachSavedNotice(null);
    setManaSyncNotice(null);
    setPlayerCommanderOverride(null);
    setPlayerCustomDeckText(null);
    setIsEditingPlayerDeck(false);
  }, [analysis]);

  useEffect(() => {
    if (manaSyncNonce > prevManaSyncNonceRef.current) {
      prevManaSyncNonceRef.current = manaSyncNonce;
      setPlayerCustomDeckText(null);
      setIsEditingPlayerDeck(false);
      setManaSyncNotice(
        selectedLandChangesCount > 0
          ? `Mana optimization synced (${selectedLandChangesCount} land adjustment${selectedLandChangesCount === 1 ? '' : 's'} active · ${typeof manaOptimizedLandCount === 'number' ? `${manaOptimizedLandCount} lands` : 'ready'}).`
          : 'Mana optimization mode active. Toggle land adjustments in Mana & Lands to update live.'
      );
    }
  }, [manaSyncNonce, selectedLandChangesCount, manaOptimizedLandCount]);

  useEffect(() => {
    if (prevIsCommanderRef.current !== isCommanderFormat) {
      prevIsCommanderRef.current = isCommanderFormat;
      setMode(isCommanderFormat ? '1v3' : '1v1');
    }
  }, [isCommanderFormat]);

  const botCount = mode === '1v1' ? 1 : mode === '1v2' ? 2 : 3;
  const visibleOpponents = useMemo(
    () => (opponentsByMode[mode] ?? []).slice(0, botCount),
    [opponentsByMode, mode, botCount]
  );

  const getBotProfileForOpp = (opp: BotOpponentConfig): BotLearningProfile => {
    const key = resolveBotLearningKey(opp);
    return botMemory[key] || createDefaultBotProfile(opp);
  };

  const cardMetaLookup = useMemo(() => {
    const map = new Map<string, CardMetadata>();
    const addEntry = (keyName: string, meta?: CardMetadata | null) => {
      if (!meta) return;
      map.set(normalizeCardLookupKey(keyName), meta);
      if (meta.name) {
        map.set(normalizeCardLookupKey(meta.name), meta);
      }
    };
    for (const rc of analysis.resolvedCards ?? []) {
      addEntry(rc.name, rc.card);
    }
    for (const s of analysis.swaps ?? []) {
      addEntry(s.addCardName, s.addCardMeta);
    }
    for (const a of analysis.additions ?? []) {
      addEntry(a.cardName, a.cardMeta);
    }
    for (const lc of analysis.manaPlan?.landChanges ?? []) {
      addEntry(lc.cardName, lc.cardMeta);
    }
    for (const [k, m] of extraScryfallMeta.entries()) {
      addEntry(k, m);
    }
    return map;
  }, [analysis, extraScryfallMeta]);

  const findMeta = useMemo(
    () => (name: string): CardMetadata | null =>
      findMetaFromMap(cardMetaLookup, name) || null,
    [cardMetaLookup]
  );

  // Background-resolve Scryfall metadata for pasted Bot Custom Decklists & edited Player decklists
  // so Commander auto-detection, P/T stats, and card counts update immediately in Playtester & Turn Simulator.
  const botCustomTextsKey = visibleOpponents
    .map((o) => `${o.archetype}:${o.customDeckText || ''}`)
    .join('\n---BOT---\n');

  useEffect(() => {
    const uncachedNames = new Set<string>();
    const needsFullScryfallResolve = (name: string) => {
      const existing = findMetaFromMap(cardMetaLookup, name);
      if (!existing) return true;
      if (!existing.imageUri || existing.imageUri.includes('api.scryfall.com/cards/named')) {
        return true;
      }
      return false;
    };

    for (const rc of analysis.resolvedCards ?? []) {
      if (needsFullScryfallResolve(rc.name)) {
        uncachedNames.add(rc.name);
      }
    }

    const collectFromText = (raw: string) => {
      if (!raw || !raw.trim()) return;
      const parsed = parseDecklistClientSide(raw);
      for (const c of parsed.cards.slice(0, 115)) {
        if (needsFullScryfallResolve(c.name)) {
          uncachedNames.add(c.name);
        }
      }
    };

    if (playerCustomDeckText) {
      collectFromText(playerCustomDeckText);
    }
    const presetArchetypes: string[] = [];
    for (const opp of visibleOpponents) {
      if (opp.customDeckText && opp.customDeckText.trim()) {
        collectFromText(opp.customDeckText);
      } else {
        presetArchetypes.push(opp.archetype);
        const bias = detectArchetypeCombatBias(opp, [], detectedFormat);
        if (
          bias.defaultCommanderName &&
          needsFullScryfallResolve(bias.defaultCommanderName)
        ) {
          uncachedNames.add(bias.defaultCommanderName);
        }
      }
    }
    for (const presetName of getPresetBotCardNames(presetArchetypes)) {
      if (needsFullScryfallResolve(presetName)) {
        uncachedNames.add(presetName);
      }
    }

    if (uncachedNames.size === 0) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      setResolvingCustomMeta(true);
      resolveCardsWithBrowserScryfall(Array.from(uncachedNames), detectedFormat)
        .then((resolved) => {
          if (cancelled || resolved.size === 0) return;
          setExtraScryfallMeta((prev) => {
            const next = new Map(prev);
            for (const [k, v] of resolved.entries()) {
              const nk = normalizeCardLookupKey(k);
              if (next.has(nk)) next.delete(nk);
              next.set(nk, v);
              if (v.name) {
                const nn = normalizeCardLookupKey(v.name);
                if (next.has(nn)) next.delete(nn);
                next.set(nn, v);
              }
            }
            while (next.size > 450) {
              const oldest = next.keys().next().value;
              if (oldest === undefined) break;
              next.delete(oldest);
            }
            return next;
          });
        })
        .catch(() => {
          // Non-fatal if Scryfall is rate-limited/offline
        })
        .finally(() => {
          if (!cancelled) setResolvingCustomMeta(false);
        });
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis, botCustomTextsKey, playerCustomDeckText, detectedFormat]);

  const buildResolvedListForPlaytest = (
    overrideRawText?: string
  ): ResolvedDeckCard[] => {
    const baseCards: ResolvedDeckCard[] = (analysis.resolvedCards ?? []).map((c) => ({
      ...c,
      card: findMetaFromMap(cardMetaLookup, c.name) || c.card || null,
    }));
    const explicitOriginalCmds = new Set(
      baseCards
        .filter((c) => c.zone === 'commander')
        .map((c) => normalizeCardLookupKey(c.name))
    );

    let list: ResolvedDeckCard[] = baseCards;
    if (overrideRawText && overrideRawText.trim()) {
      const reparsed = parseDecklistClientSide(overrideRawText);
      if (reparsed.cards.length > 0) {
        list = reparsed.cards.map((c) => {
          const meta = findMetaFromMap(cardMetaLookup, c.name) || null;
          return {
            ...c,
            name: meta ? meta.name : c.name,
            card: meta,
          };
        });
        if (!list.some((c) => c.zone === 'commander') && explicitOriginalCmds.size > 0) {
          for (const c of list) {
            if (explicitOriginalCmds.has(normalizeCardLookupKey(c.name))) {
              c.zone = 'commander';
            }
          }
        }
      }
    }

    if (playerCommanderOverride && playerCommanderOverride.trim()) {
      const targetKey = normalizeCardLookupKey(playerCommanderOverride);
      const updated: ResolvedDeckCard[] = [];
      let matched = false;
      for (const item of list) {
        const itemKey = normalizeCardLookupKey(item.name);
        if (
          !matched &&
          (itemKey === targetKey ||
            itemKey.startsWith(`${targetKey} // `) ||
            targetKey.startsWith(`${itemKey} // `))
        ) {
          matched = true;
          updated.push({ ...item, quantity: 1, zone: 'commander' });
          if (item.quantity > 1) {
            updated.push({ ...item, quantity: item.quantity - 1, zone: 'main' });
          }
        } else if (item.zone === 'commander') {
          updated.push({ ...item, zone: 'main' });
        } else {
          updated.push(item);
        }
      }
      if (matched) {
        list = updated;
      }
    }

    autoRecognizeCommandersClientSide(list, detectedFormat);
    return list;
  };

  const originalResolvedList = useMemo(
    () => buildResolvedListForPlaytest(playerCustomDeckText ?? undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      analysis.resolvedCards,
      cardMetaLookup,
      detectedFormat,
      playerCommanderOverride,
      playerCustomDeckText,
    ]
  );

  const manaOptimizedResolvedList = useMemo(
    () =>
      manaOptimizedDeckText && manaOptimizedDeckText.trim()
        ? buildResolvedListForPlaytest(manaOptimizedDeckText)
        : originalResolvedList,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [manaOptimizedDeckText, originalResolvedList, cardMetaLookup, detectedFormat, playerCommanderOverride]
  );

  const optimizedResolvedList = useMemo(
    () =>
      optimizedDeckText && optimizedDeckText.trim()
        ? buildResolvedListForPlaytest(optimizedDeckText)
        : originalResolvedList,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [optimizedDeckText, originalResolvedList, cardMetaLookup, detectedFormat, playerCommanderOverride]
  );

  const originalDeckSerialized = useMemo(
    () => serializeResolvedDeckToText(originalResolvedList, analysis.deckName),
    [originalResolvedList, analysis.deckName]
  );

  const manaOptimizedDeckSerialized = useMemo(
    () => serializeResolvedDeckToText(manaOptimizedResolvedList, analysis.deckName),
    [manaOptimizedResolvedList, analysis.deckName]
  );

  const optimizedDeckSerialized = useMemo(
    () => serializeResolvedDeckToText(optimizedResolvedList, analysis.deckName),
    [optimizedResolvedList, analysis.deckName]
  );

  const effectiveUserDeck = useMemo(() => {
    const cards =
      deckVersion === 'mana-optimized'
        ? manaOptimizedResolvedList
        : deckVersion === 'full-optimized'
        ? optimizedResolvedList
        : originalResolvedList;
    const commanders = cards.filter((c) => c.zone === 'commander');
    const companions = cards.filter((c) => c.zone === 'companion');
    const mainCards = cards.filter((c) => c.zone === 'main');
    const cmdQty = commanders.reduce((s, c) => s + c.quantity, 0);
    const compQty = companions.reduce((s, c) => s + c.quantity, 0);
    const mainQty = mainCards.reduce((s, c) => s + c.quantity, 0);
    const landCount = mainCards
      .filter((c) =>
        c.card
          ? c.card.isLand
          : /\b(plains|island|swamp|mountain|forest|wastes|command tower|exotic orchard)\b/i.test(
              c.name
            )
      )
      .reduce((s, c) => s + c.quantity, 0);
    const uniqueCardNames = Array.from(
      new Set(
        cards
          .filter((c) => c.zone === 'commander' || c.zone === 'main')
          .map((c) => c.name)
      )
    );
    const serializedText =
      deckVersion === 'mana-optimized'
        ? manaOptimizedDeckSerialized
        : deckVersion === 'full-optimized'
        ? optimizedDeckSerialized
        : originalDeckSerialized;
    const overrideTextForSim =
      deckVersion !== 'original' ||
      Boolean(playerCommanderOverride) ||
      Boolean(playerCustomDeckText)
        ? serializedText
        : undefined;

    return {
      cards,
      commanders,
      commanderNames: commanders.map((c) => c.name),
      cmdQty,
      mainQty,
      landCount,
      totalMainAndCmd: cmdQty + compQty + mainQty,
      uniqueCardNames,
      serializedText,
      overrideTextForSim,
    };
  }, [
    deckVersion,
    manaOptimizedResolvedList,
    optimizedResolvedList,
    originalResolvedList,
    manaOptimizedDeckSerialized,
    optimizedDeckSerialized,
    originalDeckSerialized,
    playerCommanderOverride,
    playerCustomDeckText,
  ]);

  const analyzerCutNames = new Set([
    ...(analysis.swaps ?? []).map((s) => s.cutCardName.toLowerCase()),
    ...(analysis.cuts ?? []).map((c) => c.cardName.toLowerCase()),
    ...(analysis.manaPlan?.landChanges ?? [])
      .filter((l) => l.action === 'cut')
      .map((l) => l.cardName.toLowerCase()),
  ]);

  const analyzerAddNames = new Set([
    ...(analysis.swaps ?? []).map((s) => s.addCardName.toLowerCase()),
    ...(analysis.additions ?? []).map((a) => a.cardName.toLowerCase()),
    ...(analysis.manaPlan?.landChanges ?? [])
      .filter((l) => l.action === 'add')
      .map((l) => l.cardName.toLowerCase()),
  ]);

  const updateOpponent = (idx: number, patch: Partial<BotOpponentConfig>) => {
    setOpponentsByMode((prev) => ({
      ...prev,
      [mode]: prev[mode].map((opp, i) => (i === idx ? { ...opp, ...patch } : opp)),
    }));
  };

  const handleLoadUserDeckIntoBot = (
    idx: number,
    version: 'active' | 'original' | 'mana-optimized' | 'optimized' = 'active'
  ) => {
    const deckString =
      version === 'original'
        ? originalDeckSerialized
        : version === 'mana-optimized'
        ? manaOptimizedDeckSerialized
        : version === 'optimized'
        ? optimizedDeckSerialized
        : effectiveUserDeck.serializedText;
    updateOpponent(idx, {
      archetype: 'Custom Decklist',
      customDeckText: deckString,
    });
  };

  const handleMirrorUserDeckToAllBots = () => {
    const deckString = effectiveUserDeck.serializedText;
    setOpponentsByMode((prev) => ({
      ...prev,
      [mode]: prev[mode].map((opp) => ({
        ...opp,
        archetype: 'Custom Decklist',
        customDeckText: deckString,
      })),
    }));
  };

  const setAllModeBotsIndignance = (level: BotIndignanceLevel) => {
    setOpponentsByMode((prev) => ({
      ...prev,
      [mode]: prev[mode].map((opp) => ({ ...opp, indignance: level })),
    }));
  };

  const setAllModeBotsIntelligence = (level: BotIntelligenceLevel) => {
    setOpponentsByMode((prev) => ({
      ...prev,
      [mode]: prev[mode].map((opp) => ({ ...opp, intelligence: level })),
    }));
  };

  const sharedModeIndignance: BotIndignanceLevel | 'mixed' = visibleOpponents.every(
    (opp) => (opp.indignance || 'measured') === (visibleOpponents[0]?.indignance || 'measured')
  )
    ? visibleOpponents[0]?.indignance || 'measured'
    : 'mixed';

  const sharedModeIntelligence: BotIntelligenceLevel | 'mixed' = visibleOpponents.every(
    (opp) => (opp.intelligence || 'tactical') === (visibleOpponents[0]?.intelligence || 'tactical')
  )
    ? visibleOpponents[0]?.intelligence || 'tactical'
    : 'mixed';

  const handleCopyLoadedDeck = async () => {
    const ok = await copyTextToClipboard(effectiveUserDeck.serializedText);
    if (ok) {
      setCopiedLoadedDeck(true);
      setTimeout(() => setCopiedLoadedDeck(false), 1800);
    }
  };

  const handleCopyCustomText = async (key: string, value: string) => {
    if (!value) return;
    const ok = await copyTextToClipboard(value);
    if (ok) {
      setClipboardNoticeKey(`${key}:copied`);
      window.setTimeout(() => {
        setClipboardNoticeKey((prev) => (prev === `${key}:copied` ? null : prev));
      }, 2000);
    }
  };

  const handlePasteCustomText = async (
    key: string,
    onApply: (pasted: string) => void
  ) => {
    const { ok, text } = await readTextFromClipboard();
    if (!ok) {
      setClipboardNoticeKey(`${key}:blocked`);
      window.setTimeout(() => {
        setClipboardNoticeKey((prev) => (prev === `${key}:blocked` ? null : prev));
      }, 3000);
      return;
    }
    if (!text.trim()) return;
    onApply(text);
    setClipboardNoticeKey(`${key}:pasted`);
    window.setTimeout(() => {
      setClipboardNoticeKey((prev) => (prev === `${key}:pasted` ? null : prev));
    }, 2000);
  };

  const handleCancelPlaytest = () => {
    activePlaytestAbortRef.current?.abort();
    activePlaytestAbortRef.current = null;
    terminatePlaytestWorker();
    setLoading(false);
    setPlaytestProgress({
      percent: 0,
      stage: 'Match simulation cancelled.',
    });
  };

  const handleRunPlaytest = async (forceLocalFallback = false) => {
    activePlaytestAbortRef.current?.abort();
    const controller = new AbortController();
    activePlaytestAbortRef.current = controller;

    const shuffleStartedAt = Date.now();
    setLoading(true);
    setPlaytestProgress({
      percent: 6,
      stage: 'Shuffling player & bot pod libraries...',
      detail: `${mode.toUpperCase()} (${visibleOpponents.length} bot${visibleOpponents.length === 1 ? '' : 's'})`,
    });
    setError(null);
    setCoachSavedNotice(null);

    const testedListLabel =
      deckVersion === 'mana-optimized'
        ? 'Mana Optimization (Synced)'
        : deckVersion === 'full-optimized'
        ? 'Optimized List (With Analyzer Fixes)'
        : 'Uploaded Decklist (Original)';

    const activeBotProfiles = visibleOpponents.map((opp) => getBotProfileForOpp(opp));

    try {
      let data: PlaytestResult | null = null;
      let workerUpdatedProfiles: BotLearningProfile[] | undefined;

      if (!forceLocalFallback) {
        try {
          const rawJson = await fetchNdjsonWithProgress<PlaytestResult>(
            '/api/playtest',
            {
              deckName: analysis.deckName,
              format: detectedFormat,
              resolvedCards: effectiveUserDeck.cards,
              overrideDeckText: effectiveUserDeck.overrideTextForSim,
              testedListLabel,
              mode,
              opponents: visibleOpponents,
              botMemoryProfiles: activeBotProfiles,
              autoLearnFromMatches: autoLearnEnabled,
            },
            (update) => setPlaytestProgress(update),
            controller.signal
          );

          if (rawJson && Array.isArray(rawJson.rounds)) {
            data = {
              ...rawJson,
              openingHand: Array.isArray(rawJson.openingHand) ? rawJson.openingHand : [],
              keyTakeaways: Array.isArray(rawJson.keyTakeaways) ? rawJson.keyTakeaways : [],
              botLearnings: Array.isArray(rawJson.botLearnings) ? rawJson.botLearnings : [],
              finalStats: rawJson.finalStats,
              aiEngineUsed: rawJson.aiEngineUsed,
              aiModelLabel: rawJson.aiModelLabel,
              ggufLearningApplied: rawJson.ggufLearningApplied,
              rounds: rawJson.rounds.map((r) => ({
                ...r,
                handSnapshot: Array.isArray(r.handSnapshot) ? r.handSnapshot : [],
                cardsPlayed: Array.isArray(r.cardsPlayed) ? r.cardsPlayed : [],
                botPlays: Array.isArray(r.botPlays) ? r.botPlays : [],
                lifeTotals: Array.isArray(r.lifeTotals) ? r.lifeTotals : [],
                participantStats: Array.isArray(r.participantStats)
                  ? r.participantStats
                  : undefined,
                roundChanges: Array.isArray(r.roundChanges) ? r.roundChanges : [],
              })),
            };
          }
        } catch (apiErr) {
          if (apiErr instanceof Error && apiErr.name === 'AbortError') {
            throw apiErr;
          }
          if (apiErr instanceof ServerReturnedError) {
            throw apiErr;
          }
          // Fall back to Web Worker adaptive playtest simulator when backend is unavailable
        }
      }

      if (controller.signal.aborted) {
        return;
      }

      if (!data) {
        setPlaytestProgress({
          percent: 24,
          stage: 'Resolving custom bot decklists via Scryfall...',
          detail: 'Background Web Worker simulator mode',
        });

        const uncachedBotCardNameSet = new Set<string>();
        visibleOpponents.forEach((opp) => {
          if (opp.customDeckText && opp.customDeckText.trim()) {
            const parsedBot = parseDecklistClientSide(opp.customDeckText);
            for (const c of parsedBot.cards.slice(0, 110)) {
              if (!findMetaFromMap(cardMetaLookup, c.name)) {
                uncachedBotCardNameSet.add(c.name);
              }
            }
          }
        });
        const uncachedBotCardNames = Array.from(uncachedBotCardNameSet);

        let browserBotMeta = new Map<string, CardMetadata>();
        if (uncachedBotCardNames.length > 0) {
          try {
            browserBotMeta = await resolveCardsWithBrowserScryfall(
              uncachedBotCardNames,
              detectedFormat
            );
            if (!controller.signal.aborted && browserBotMeta.size > 0) {
              setExtraScryfallMeta((prev) => {
                const next = new Map(prev);
                browserBotMeta.forEach((meta, key) => {
                  if (next.has(key)) next.delete(key);
                  next.set(key, meta);
                });
                while (next.size > 450) {
                  const oldest = next.keys().next().value;
                  if (oldest === undefined) break;
                  next.delete(oldest);
                }
                return next;
              });
            }
          } catch {
            // Proceed offline with known/heuristic metadata if Scryfall is unreachable
          }
        }

        if (controller.signal.aborted) {
          return;
        }

        const mergedExtraMeta = Array.from(
          new Set([
            ...cardMetaLookup.values(),
            ...browserBotMeta.values(),
          ])
        );

        const workerOut = await runPlaytestInWorker(
          {
            deckName: analysis.deckName,
            format: detectedFormat,
            resolvedCards: effectiveUserDeck.cards,
            overrideDeckText: effectiveUserDeck.overrideTextForSim,
            testedListLabel,
            mode,
            opponents: visibleOpponents,
            botMemoryProfiles: activeBotProfiles,
            extraCardMeta: mergedExtraMeta,
            existingMemory: autoLearnEnabled ? botMemory : undefined,
            analysisForLearnings: autoLearnEnabled ? analysis : undefined,
          },
          (update) => setPlaytestProgress(update),
          controller.signal
        );

        data = {
          ...workerOut.result,
          aiEngineUsed: 'deterministic',
          ggufLearningApplied: false,
        };
        workerUpdatedProfiles = workerOut.updatedProfiles;
      }

      if (controller.signal.aborted) {
        return;
      }

      if (autoLearnEnabled) {
        if (!workerUpdatedProfiles) {
          setPlaytestProgress({
            percent: 95,
            stage: 'Updating adaptive bot IQ profiles in background worker...',
          });
          workerUpdatedProfiles = await applyBotLearningsInWorker(
            {
              existingMemory: botMemory,
              opponents: visibleOpponents,
              result: data,
              analysis,
            },
            controller.signal
          );
        }

        if (controller.signal.aborted) {
          return;
        }

        onSaveBotMemoryProfiles(workerUpdatedProfiles);
      } else if (controller.signal.aborted) {
        return;
      }

      const remainingShuffleMs = Math.max(0, 720 - (Date.now() - shuffleStartedAt));
      if (remainingShuffleMs > 0) {
        await new Promise<void>((resolve) => {
          const onAbort = () => {
            window.clearTimeout(timerId);
            resolve();
          };
          const timerId = window.setTimeout(() => {
            controller.signal.removeEventListener('abort', onAbort);
            resolve();
          }, remainingShuffleMs);
          controller.signal.addEventListener('abort', onAbort, { once: true });
        });
      }

      if (controller.signal.aborted) {
        return;
      }

      setPlaytestProgress({
        percent: 100,
        stage: 'Match simulation complete.',
      });
      setResult(data);
      setActiveRoundIdx(0);
      setPlayAreaMode('replay');
      setShowTurnSummaryModal(true);
      setManaTagsByRound({});
      setSelectedCoachBotIdx(0);
    } catch (err) {
      if ((err instanceof Error && err.name === 'AbortError') || controller.signal.aborted) {
        return;
      }
      setError(err instanceof Error ? err.message : 'Playtest simulation failed.');
    } finally {
      if (activePlaytestAbortRef.current === controller) {
        activePlaytestAbortRef.current = null;
        setLoading(false);
      }
    }
  };

  const handleToggleCoachTag = (tag: string) => {
    setCoachTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleSubmitPostMatchCoaching = (andRematch = false) => {
    const targetOpp = visibleOpponents[selectedCoachBotIdx] || visibleOpponents[0];
    if (!targetOpp) return;
    if (coachTags.length === 0 && !coachCustomNote.trim()) {
      return;
    }

    const botKey = resolveBotLearningKey(targetOpp);
    const updatedProfile = applyUserCoachingToBotProfile(
      botMemory[botKey],
      targetOpp,
      {
        botKey,
        botName: targetOpp.name,
        archetype: targetOpp.archetype,
        rating: coachRating,
        quickTags: coachTags,
        customNote: coachCustomNote,
      }
    );

    onSaveBotMemoryProfiles([updatedProfile]);
    setCoachTags([]);
    setCoachCustomNote('');
    setCoachSavedNotice(
      `Saved coaching to ${targetOpp.name} (IQ ${updatedProfile.botIqScore}). These tactical rules will actively shape its next matches.`
    );

    if (andRematch) {
      void handleRunPlaytest();
    }
  };

  const handleInlineAddDirective = (opp: BotOpponentConfig) => {
    const key = resolveBotLearningKey(opp);
    const note = (inlineCoachTextByKey[key] || '').trim();
    if (!note) return;

    const updatedProfile = applyUserCoachingToBotProfile(botMemory[key], opp, {
      botKey: key,
      botName: opp.name,
      archetype: opp.archetype,
      rating: 'needs-adjustment',
      quickTags: [],
      customNote: note,
    });
    onSaveBotMemoryProfiles([updatedProfile]);
    setInlineCoachTextByKey((prev) => ({ ...prev, [key]: '' }));
  };

  const handleSetRoundManaTag = (
    roundNumber: number,
    tag: ManaIssueTag | undefined
  ) => {
    setManaTagsByRound((prev) => {
      const next = { ...prev };
      if (tag === undefined) {
        delete next[roundNumber];
      } else {
        next[roundNumber] = tag;
      }
      return next;
    });
  };

  const handleAutoTagRounds = () => {
    if (!result) return;
    const detected = autoTagPlaytestRounds(result);
    if (Object.keys(detected).length === 0 && result.rounds.length > 0) {
      return;
    }
    setManaTagsByRound((prev) => ({ ...detected, ...prev }));
  };

  const handleSelectRoundByNumber = (roundNumber: number) => {
    if (!result) return;
    const idx = result.rounds.findIndex((r) => r.roundNumber === roundNumber);
    if (idx >= 0) setActiveRoundIdx(idx);
  };

  const renderRoundChange = (change: RoundDeckChange, idx: number) => {
    const isAlsoInAnalyzer =
      (change.cutCardName && analyzerCutNames.has(change.cutCardName.toLowerCase())) ||
      (change.addCardName && analyzerAddNames.has(change.addCardName.toLowerCase()));

    return (
      <div key={idx} className="py-3 first:pt-0 last:pb-0">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span
            className={`font-mono text-xs font-semibold uppercase ${
              change.action === 'cut'
                ? 'text-red-700'
                : change.action === 'add'
                ? 'text-emerald-700'
                : 'text-sky-700'
            }`}
          >
            {change.action}
          </span>

          {change.cutCardName && (
            <>
              <span className="text-xs text-zinc-400">Cut</span>
              <CardLink
                name={change.cutCardName}
                meta={findMeta(change.cutCardName)}
                onInspect={onInspectCard}
              />
            </>
          )}

          {change.cutCardName && change.addCardName && (
            <span className="text-zinc-400">→</span>
          )}

          {change.addCardName && (
            <>
              <span className="text-xs text-zinc-400">Put In</span>
              <CardLink
                name={change.addCardName}
                meta={findMeta(change.addCardName)}
                onInspect={onInspectCard}
              />
            </>
          )}

          <span className="text-zinc-300" aria-hidden="true">·</span>
          <span
            className={`text-xs font-medium ${
              change.urgency === 'critical' ? 'text-red-700' : 'text-zinc-500'
            }`}
          >
            {change.urgency === 'critical' ? 'High impact' : 'Recommended'}
          </span>

          {isAlsoInAnalyzer && (
            <>
              <span className="text-zinc-300" aria-hidden="true">·</span>
              <span className="text-xs font-medium text-sky-700">Matches Analyzer</span>
            </>
          )}
        </div>
        <p className="mt-1 text-sm text-zinc-600">{change.reason}</p>
      </div>
    );
  };

  const activeRound = result?.rounds[activeRoundIdx] || null;

  return (
    <section id="playtest-section" className="space-y-5 scroll-mt-20">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-display text-xl font-bold text-zinc-900">
            Playtest &amp; Tabletop Arena
          </h2>
          <p className="mt-0.5 text-xs text-zinc-600">
            Configure your {detectedFormat} pod below to play live on the tabletop with AI bots or friends (LAN / Online), or auto-simulate matches.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => openTutorial('setup')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 hover:text-zinc-900 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <BookOpen className="h-3.5 w-3.5 text-sky-700 shrink-0" />
            Playtest Guide
          </button>
          {localAiEngineInfo && (
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event('umbras:open-desktop-modal'))}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                localAiEngineInfo.effectiveEngine !== 'deterministic'
                  ? 'border-sky-200 bg-sky-50 text-sky-900 hover:bg-sky-100'
                  : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50'
              }`}
            >
              <Cpu className="h-3.5 w-3.5 text-sky-700 shrink-0" />
              {localAiEngineInfo.effectiveEngine === 'local-gguf'
                ? `${localAiEngineInfo.modelLabel} (.gguf)`
                : localAiEngineInfo.effectiveEngine === 'cloud-gemini'
                  ? `${localAiEngineInfo.modelLabel}`
                  : 'Local AI Engine'}
            </button>
          )}
        </div>
      </div>

      {/* Unified Pod, Deck & AI Bot Setup Card */}
      <div className="rounded-xl border border-zinc-200 bg-white p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            {/* Table Size */}
            <div className="inline-flex items-center gap-1 rounded-lg bg-zinc-100 p-1">
              {(['1v1', '1v2', '1v3'] as PlaytestMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    mode === m
                      ? 'bg-white text-zinc-900 shadow-sm'
                      : 'text-zinc-600 hover:text-zinc-900'
                  }`}
                >
                  {m === '1v1' ? '1v1 Duel' : m === '1v2' ? '1v2 (3P)' : '1v3 Pod (4P)'}
                </button>
              ))}
            </div>

            {/* Your Deck Version */}
            <div className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-zinc-100 p-1">
              <button
                type="button"
                onClick={() => setDeckVersion('original')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  deckVersion === 'original'
                    ? 'bg-white text-zinc-900 shadow-sm'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                Original Deck
              </button>
              <button
                type="button"
                onClick={() => {
                  setPlayerCustomDeckText(null);
                  setDeckVersion('mana-optimized');
                }}
                className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  deckVersion === 'mana-optimized'
                    ? 'bg-white text-sky-900 shadow-sm'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                <RefreshCw className={`h-3 w-3 ${deckVersion === 'mana-optimized' ? 'text-sky-700' : 'text-zinc-400'}`} />
                <span>Mana Fixes</span>
                {selectedLandChangesCount > 0 && (
                  <span className="font-mono text-[11px] text-sky-700">
                    ({selectedLandChangesCount})
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPlayerCustomDeckText(null);
                  setDeckVersion('full-optimized');
                }}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  deckVersion === 'full-optimized'
                    ? 'bg-white text-zinc-900 shadow-sm'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                All Fixes
              </button>
            </div>

            {!isSetupExpanded && (
              <div className="hidden xl:flex items-center gap-1.5 text-xs text-zinc-600">
                <span className="font-semibold text-zinc-900">
                  {analysis.deckName || 'Your Deck'}
                </span>
                <span className="text-zinc-300" aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  {effectiveUserDeck.totalMainAndCmd} cards
                </span>
                <span className="text-zinc-300" aria-hidden="true">·</span>
                <span>
                  vs {visibleOpponents.map((o) => o.name).join(', ')}
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setPlayAreaMode('live');
                setLiveVsBotsNonce((n) => n + 1);
                document.getElementById('interactive-live-game')?.scrollIntoView({
                  behavior: 'smooth',
                  block: 'start',
                });
              }}
              title="Start or reshuffle a live turn-by-turn tabletop game against these AI bots"
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-sky-800 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Bot className="h-3.5 w-3.5 shrink-0" />
              <span>Play Live Tabletop</span>
            </button>

            <button
              type="button"
              onClick={() => void handleRunPlaytest(false)}
              disabled={loading}
              title="Auto-simulate a multi-round bot match and inspect turn-by-turn replays & analytics"
              className="inline-flex items-center gap-1.5 rounded-lg border border-sky-300 bg-sky-50 px-3.5 py-2 text-xs font-semibold text-sky-900 hover:bg-sky-100 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
            >
              {loading ? (
                <>
                  <Shuffle className="h-3.5 w-3.5 animate-spin text-sky-700" />
                  <span>Simulating {mode}...</span>
                </>
              ) : result ? (
                <>
                  <RotateCcw className="h-3.5 w-3.5 text-sky-700" />
                  <span>Re-Simulate {mode}</span>
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5 text-sky-700" />
                  <span>Auto-Simulate Match</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => setIsMultiplayerHubOpen(true)}
              title="Host or join a 1–4 player LAN or self-hosted online multiplayer session with friends and AI bots"
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 cursor-pointer whitespace-nowrap shrink-0 transition-colors"
            >
              <Users className="h-3.5 w-3.5 text-sky-700 shrink-0" />
              <span>Multiplayer (LAN / Online)</span>
            </button>

            <button
              type="button"
              onClick={() => setIsSetupExpanded((v) => !v)}
              aria-expanded={isSetupExpanded}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-zinc-50 px-2.5 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Sliders className="h-3.5 w-3.5 text-sky-700 shrink-0" />
              <span>{isSetupExpanded ? 'Hide Setup' : `Configure Pod & Bots (${botCount})`}</span>
              {isSetupExpanded ? (
                <ChevronUp className="h-3.5 w-3.5 text-zinc-500" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
              )}
            </button>
          </div>
        </div>

        {isSetupExpanded && (
          <div className="space-y-4 border-t border-zinc-100 pt-4">
            {/* Compact Active Deck & Commander Strip */}
            <div className="rounded-lg border border-zinc-200 bg-zinc-50/70 px-3.5 py-2.5 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-700">
                  <Crown className="h-3.5 w-3.5 text-sky-700 shrink-0" />
                  <span className="font-semibold text-zinc-900">
                    {analysis.deckName || 'Your Deck'}
                  </span>
                  <span className="text-zinc-300" aria-hidden="true">·</span>
                  <span className="capitalize font-medium">{detectedFormat}</span>
                  <span className="text-zinc-300" aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums font-semibold text-zinc-900">
                    {effectiveUserDeck.totalMainAndCmd} cards
                  </span>
                  <span className="font-mono tabular-nums text-zinc-500">
                    ({effectiveUserDeck.landCount} lands)
                  </span>
                  {isCommanderFormat && effectiveUserDeck.totalMainAndCmd !== 100 && (
                    <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      Target 100
                    </span>
                  )}
                  <span className="text-zinc-300" aria-hidden="true">·</span>
                  <span className="text-zinc-600">Cmdr:</span>
                  {effectiveUserDeck.commanders.length > 0 ? (
                    effectiveUserDeck.commanders.map((cmd, cIdx) => (
                      <React.Fragment key={cmd.name}>
                        {cIdx > 0 && <span className="text-zinc-400">&amp;</span>}
                        <CardLink
                          name={cmd.name}
                          meta={cmd.card || findMeta(cmd.name)}
                          onInspect={onInspectCard}
                        />
                      </React.Fragment>
                    ))
                  ) : (
                    <span className="text-amber-700 font-medium">
                      {isCommanderFormat ? 'None selected' : 'None'}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {effectiveUserDeck.uniqueCardNames.length > 0 && (
                    <select
                      id="playtest-player-commander-select"
                      aria-label="Switch Commander"
                      value={effectiveUserDeck.commanders[0]?.name || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        setPlayerCommanderOverride(val || null);
                      }}
                      className="max-w-[190px] rounded-md border border-zinc-300 bg-white px-2 py-1 text-[11px] font-medium text-zinc-900 focus:border-sky-600 focus:outline-none"
                    >
                      <option value="">
                        {effectiveUserDeck.commanders.length > 0
                          ? 'Switch Commander...'
                          : 'Set Commander...'}
                      </option>
                      {effectiveUserDeck.uniqueCardNames.map((cardName) => (
                        <option key={cardName} value={cardName}>
                          {cardName}
                        </option>
                      ))}
                    </select>
                  )}

                  {resolvingCustomMeta && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Syncing art...
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      if (!isEditingPlayerDeck) {
                        setPlayerDeckDraftText(
                          playerCustomDeckText ?? effectiveUserDeck.serializedText
                        );
                      }
                      setIsEditingPlayerDeck((v) => !v);
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Pencil className="h-3 w-3 text-sky-700" />
                    {isEditingPlayerDeck ? 'Close Editor' : 'Edit Decklist'}
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleCopyLoadedDeck()}
                    className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    {copiedLoadedDeck ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-700" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        Copy
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowLoadedDeckPreview((v) => !v)}
                    className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Eye className="h-3 w-3 text-sky-700" />
                    {showLoadedDeckPreview ? 'Hide List' : 'View List'}
                  </button>
                </div>
              </div>

              {deckVersion === 'mana-optimized' && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200/70 pt-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2 text-zinc-700">
                    <RefreshCw className="h-3.5 w-3.5 text-sky-700 shrink-0" />
                    <span className="font-semibold text-zinc-900">
                      Synced with Mana &amp; Lands
                    </span>
                    <span className="text-zinc-300" aria-hidden="true">·</span>
                    {selectedLandChangesCount > 0 ? (
                      <span className="font-mono text-[11px] text-sky-800">
                        {selectedLandChangesCount} land change{selectedLandChangesCount === 1 ? '' : 's'} active
                      </span>
                    ) : totalLandChangesCount > 0 ? (
                      <span className="text-amber-800">
                        No land fixes selected yet.
                      </span>
                    ) : (
                      <span className="text-zinc-600">
                        No land changes needed.
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {selectedLandChangesCount === 0 && totalLandChangesCount > 0 && onApplyAllManaFixes && (
                      <button
                        type="button"
                        onClick={onApplyAllManaFixes}
                        className="rounded-md bg-sky-700 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-sky-800 cursor-pointer whitespace-nowrap"
                      >
                        Apply All Mana Fixes ({totalLandChangesCount})
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        window.dispatchEvent(
                          new CustomEvent<string>('deck-navigate-section', {
                            detail: 'mana-section',
                          })
                        )
                      }
                      className="rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 cursor-pointer whitespace-nowrap"
                    >
                      Mana &amp; Lands
                    </button>
                  </div>
                </div>
              )}

              {manaSyncNotice && (
                <div className="flex items-center justify-between gap-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs text-sky-900">
                  <span>{manaSyncNotice}</span>
                  <button
                    type="button"
                    onClick={() => setManaSyncNotice(null)}
                    aria-label="Dismiss sync notice"
                    className="text-sky-700 hover:text-sky-900 cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {isEditingPlayerDeck && (
                <div className="rounded-md border border-zinc-200 bg-white p-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                    <span className="font-semibold text-zinc-700">
                      Edit or Paste Your Active Decklist
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          void handlePasteCustomText('player-draft', (text) =>
                            setPlayerDeckDraftText(text)
                          )
                        }
                        className="inline-flex items-center gap-1 rounded border border-zinc-300 bg-zinc-50 px-2 py-0.5 font-medium text-zinc-700 hover:bg-zinc-100 cursor-pointer"
                      >
                        {clipboardNoticeKey === 'player-draft:pasted' ? (
                          <>
                            <Check className="h-3 w-3 text-emerald-700" />
                            <span>Pasted</span>
                          </>
                        ) : (
                          <>
                            <ClipboardPaste className="h-3 w-3 text-sky-700" />
                            <span>Paste</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        disabled={!playerDeckDraftText.trim()}
                        onClick={() =>
                          void handleCopyCustomText('player-draft', playerDeckDraftText)
                        }
                        className="inline-flex items-center gap-1 rounded border border-zinc-300 bg-zinc-50 px-2 py-0.5 font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-40 cursor-pointer"
                      >
                        {clipboardNoticeKey === 'player-draft:copied' ? (
                          <>
                            <Check className="h-3 w-3 text-emerald-700" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3 text-sky-700" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                      {playerCustomDeckText && (
                        <button
                          type="button"
                          onClick={() => {
                            setPlayerCustomDeckText(null);
                            setPlayerCommanderOverride(null);
                            setIsEditingPlayerDeck(false);
                          }}
                          className="rounded border border-zinc-300 bg-zinc-50 px-2 py-0.5 font-medium text-zinc-700 hover:bg-zinc-100 cursor-pointer"
                        >
                          Reset to Analyzed
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          const trimmed = playerDeckDraftText.trim();
                          setPlayerCustomDeckText(trimmed ? playerDeckDraftText : null);
                          setPlayerCommanderOverride(null);
                          setDeckVersion('original');
                          setIsEditingPlayerDeck(false);
                        }}
                        className="rounded bg-sky-700 px-2.5 py-0.5 font-semibold text-white hover:bg-sky-800 cursor-pointer"
                      >
                        Apply Decklist
                      </button>
                    </div>
                  </div>
                  {clipboardNoticeKey === 'player-draft:blocked' && (
                    <div className="text-[11px] text-amber-700">
                      Clipboard read blocked — click in the text box below and press Ctrl+V (Cmd+V on Mac).
                    </div>
                  )}
                  <textarea
                    rows={5}
                    value={playerDeckDraftText}
                    onChange={(e) => setPlayerDeckDraftText(e.target.value)}
                    placeholder="Commander&#10;1 Atraxa, Praetors' Voice&#10;&#10;Deck&#10;1 Sol Ring&#10;..."
                    className="w-full rounded-md border border-zinc-300 bg-zinc-50/60 p-2 font-mono text-[11px] text-zinc-900 focus:border-sky-600 focus:bg-white focus:outline-none"
                  />
                </div>
              )}

              {showLoadedDeckPreview && (
                <div className="rounded-md border border-zinc-200 bg-white p-3">
                  <div className="mb-1.5 flex items-center justify-between text-[11px] text-zinc-500">
                    <span>Active Decklist ({effectiveUserDeck.totalMainAndCmd} cards)</span>
                  </div>
                  <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-zinc-800">
                    {effectiveUserDeck.serializedText}
                  </pre>
                </div>
              )}
            </div>

            {/* Unified AI Bot Opponents Grid (Merged Bot Playtest + Live Match Setup) */}
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-600">
                  <span className="font-semibold text-zinc-900">
                    AI Bot Opponents ({botCount} {botCount === 1 ? 'Seat' : 'Seats'})
                  </span>
                  <span className="text-zinc-300" aria-hidden="true">·</span>
                  <span>Applies to both Live Tabletop and Auto-Simulated matches.</span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleMirrorUserDeckToAllBots}
                    className="inline-flex items-center gap-1 rounded-md border border-sky-300 bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-800 hover:bg-sky-100 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Copy className="h-3 w-3" />
                    {botCount > 1 ? 'Mirror Your Deck to All Bots' : 'Mirror Your Deck'}
                  </button>

                  {botCount > 1 && (
                    <>
                      <select
                        id={`bulk-intelligence-${mode}`}
                        aria-label="Set all bots AI Skill"
                        value={sharedModeIntelligence}
                        onChange={(e) => {
                          if (e.target.value !== 'mixed') {
                            setAllModeBotsIntelligence(e.target.value as BotIntelligenceLevel);
                          }
                        }}
                        className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-[11px] font-medium text-zinc-800 focus:border-sky-600 focus:outline-none cursor-pointer"
                      >
                        {sharedModeIntelligence === 'mixed' && (
                          <option value="mixed" disabled>
                            All Skill: Mixed
                          </option>
                        )}
                        {BOT_INTELLIGENCE_OPTIONS.map((opt) => (
                          <option key={opt.id} value={opt.id}>
                            All Skill: {opt.label}
                          </option>
                        ))}
                      </select>

                      <select
                        id={`bulk-indignance-${mode}`}
                        aria-label="Set all bots Playstyle"
                        value={sharedModeIndignance}
                        onChange={(e) => {
                          if (e.target.value !== 'mixed') {
                            setAllModeBotsIndignance(e.target.value as BotIndignanceLevel);
                          }
                        }}
                        className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-[11px] font-medium text-zinc-800 focus:border-sky-600 focus:outline-none cursor-pointer"
                      >
                        {sharedModeIndignance === 'mixed' && (
                          <option value="mixed" disabled>
                            All Playstyle: Mixed
                          </option>
                        )}
                        {BOT_INDIGNANCE_OPTIONS.map((opt) => (
                          <option key={opt.id} value={opt.id}>
                            All Playstyle: {opt.shortLabel}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                </div>
              </div>

              <div
                className={`grid grid-cols-1 gap-3 ${
                  botCount === 1
                    ? 'md:grid-cols-1 max-w-xl'
                    : botCount === 2
                    ? 'md:grid-cols-2'
                    : 'md:grid-cols-3'
                }`}
              >
                {visibleOpponents.map((opp, idx) => {
                  const indignanceMeta = getBotIndignanceMeta(opp.indignance);
                  const intelligenceMeta = getBotIntelligenceMeta(opp.intelligence);
                  const botKey = resolveBotLearningKey(opp);
                  const profile = getBotProfileForOpp(opp);
                  const isBrainOpen = expandedBrainKey === `${opp.id}:${botKey}`;
                  const totalLessons =
                    profile.learnedFromFacedDecks.length +
                    profile.learnedFromOwnDecks.length +
                    profile.tacticalDirectives.length;

                  return (
                    <div
                      key={opp.id}
                      className="rounded-lg border border-zinc-200 bg-zinc-50/60 p-3 space-y-2.5"
                    >
                      {/* Top Header: Seat Badge, Editable Name, IQ & Brain Inspector */}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className="font-mono text-[11px] font-bold text-zinc-500 shrink-0">
                            Seat {idx + 2}
                          </span>
                          <input
                            type="text"
                            value={opp.name}
                            onChange={(e) => updateOpponent(idx, { name: e.target.value })}
                            aria-label={`Opponent ${idx + 1} name`}
                            className="w-full max-w-[140px] rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs font-semibold text-zinc-900 focus:border-sky-600 focus:outline-none"
                          />
                        </div>

                        <div className="flex items-center gap-1.5 text-[11px] shrink-0">
                          <span className="font-mono font-semibold text-sky-900 tabular-nums">
                            IQ {profile.botIqScore}
                          </span>
                          <span className="text-zinc-300" aria-hidden="true">·</span>
                          <span className="font-mono text-zinc-600 tabular-nums">
                            {profile.wins}W-{profile.losses}L
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedBrainKey(isBrainOpen ? null : `${opp.id}:${botKey}`)
                            }
                            className="inline-flex items-center gap-1 rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 font-semibold text-sky-800 hover:bg-sky-100 cursor-pointer whitespace-nowrap"
                          >
                            <Brain className="h-3 w-3 text-sky-700" />
                            <span>{isBrainOpen ? 'Hide' : `Brain (${totalLessons})`}</span>
                          </button>
                        </div>
                      </div>

                      {/* Compact 3-Control Setup Grid: Deck Archetype, AI Skill, Playstyle */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div className="sm:col-span-2">
                          <label
                            htmlFor={`bot-arch-${opp.id}`}
                            className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500"
                          >
                            Bot Deck
                          </label>
                          <select
                            id={`bot-arch-${opp.id}`}
                            value={opp.archetype}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === '__MIRROR_USER_DECK__') {
                                handleLoadUserDeckIntoBot(idx, 'active');
                              } else {
                                updateOpponent(idx, { archetype: val });
                              }
                            }}
                            className="mt-0.5 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-900 focus:border-sky-600 focus:outline-none"
                          >
                            <option value="__MIRROR_USER_DECK__">
                              Mirror Your Deck ({effectiveUserDeck.commanderNames[0] || analysis.deckName || 'Your List'})
                            </option>
                            {BOT_ARCHETYPES.map((arch) => (
                              <option key={arch} value={arch}>
                                {arch}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label
                            htmlFor={`bot-skill-${opp.id}`}
                            className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500"
                          >
                            AI Skill
                          </label>
                          <select
                            id={`bot-skill-${opp.id}`}
                            value={intelligenceMeta.id}
                            onChange={(e) =>
                              updateOpponent(idx, {
                                intelligence: e.target.value as BotIntelligenceLevel,
                              })
                            }
                            title={intelligenceMeta.description}
                            className="mt-0.5 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs font-medium text-zinc-900 focus:border-sky-600 focus:outline-none"
                          >
                            {BOT_INTELLIGENCE_OPTIONS.map((opt) => (
                              <option key={opt.id} value={opt.id}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label
                            htmlFor={`bot-style-${opp.id}`}
                            className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500"
                          >
                            Playstyle
                          </label>
                          <select
                            id={`bot-style-${opp.id}`}
                            value={indignanceMeta.id}
                            onChange={(e) =>
                              updateOpponent(idx, {
                                indignance: e.target.value as BotIndignanceLevel,
                              })
                            }
                            title={indignanceMeta.description}
                            className="mt-0.5 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs font-medium text-zinc-900 focus:border-sky-600 focus:outline-none"
                          >
                            {BOT_INDIGNANCE_OPTIONS.map((opt) => (
                              <option key={opt.id} value={opt.id}>
                                {opt.shortLabel}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {isBrainOpen && (
                        <div className="rounded-lg border border-zinc-200 bg-white p-2.5 space-y-2 text-[11px]">
                          <div className="flex items-center justify-between gap-2 border-b border-zinc-100 pb-1.5">
                            <span className="font-bold text-zinc-900">
                              Adaptive Memory · {opp.name}
                            </span>
                            {profile.matchesPlayed > 0 || totalLessons > 0 ? (
                              <button
                                type="button"
                                onClick={() => onResetBotMemory(botKey)}
                                className="inline-flex items-center gap-1 text-red-700 hover:text-red-900 font-medium cursor-pointer"
                              >
                                <Trash2 className="h-3 w-3" />
                                Reset
                              </button>
                            ) : null}
                          </div>

                          {profile.matchesPlayed > 0 && (
                            <div className="rounded border border-zinc-100 bg-zinc-50 px-2 py-1.5 font-mono text-[10px] tabular-nums text-zinc-600">
                              <div className="flex flex-wrap items-center justify-between gap-1 text-zinc-800 font-semibold">
                                <span>
                                  Record: {profile.wins}W-{profile.losses}L-{profile.closes}C (
                                  {Math.round((profile.wins / Math.max(1, profile.matchesPlayed)) * 100)}% WR)
                                </span>
                                <span className="text-sky-700">IQ {profile.botIqScore}</span>
                              </div>
                            </div>
                          )}

                          {profile.tacticalDirectives.length > 0 && (
                            <div>
                              <div className="font-semibold text-zinc-700">Tactical Directives:</div>
                              <ul className="mt-0.5 list-disc list-inside space-y-0.5 text-zinc-600">
                                {profile.tacticalDirectives.slice(0, 4).map((d, i) => (
                                  <li key={i}>{d}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {profile.learnedFromFacedDecks.length > 0 && (
                            <div>
                              <div className="font-semibold text-zinc-700">Learned Matchup Notes:</div>
                              <ul className="mt-0.5 list-disc list-inside space-y-0.5 text-zinc-600">
                                {profile.learnedFromFacedDecks.slice(0, 2).map((d, i) => (
                                  <li key={i}>{d}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {totalLessons === 0 && profile.matchesPlayed === 0 && (
                            <p className="text-zinc-500">
                              No stored lessons yet. Add a coaching rule below.
                            </p>
                          )}

                          <div className="flex items-center gap-1.5 pt-1 border-t border-zinc-100">
                            <input
                              type="text"
                              value={inlineCoachTextByKey[botKey] || ''}
                              onChange={(e) =>
                                setInlineCoachTextByKey((prev) => ({
                                  ...prev,
                                  [botKey]: e.target.value,
                                }))
                              }
                              placeholder="Teach rule (e.g. Hold counter for my commander)..."
                              className="flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-[11px] text-zinc-900 focus:border-sky-600 focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => handleInlineAddDirective(opp)}
                              disabled={!(inlineCoachTextByKey[botKey] || '').trim()}
                              className="rounded bg-sky-700 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-sky-800 disabled:opacity-40 cursor-pointer"
                            >
                              Train
                            </button>
                          </div>
                        </div>
                      )}

                      {opp.archetype === 'Custom Decklist' && (() => {
                        const customRaw = opp.customDeckText || '';
                        const parsedCustom = customRaw.trim()
                          ? parseDecklistClientSide(customRaw)
                          : null;
                        const customResolved: ResolvedDeckCard[] = parsedCustom
                          ? parsedCustom.cards.map((c) => ({
                              ...c,
                              card: findMeta(c.name),
                            }))
                          : [];
                        if (customResolved.length > 0) {
                          const totalC = customResolved
                            .filter((c) => c.zone === 'main' || c.zone === 'commander')
                            .reduce((s, c) => s + c.quantity, 0);
                          autoRecognizeCommandersClientSide(
                            customResolved,
                            customResolved.some((c) => c.zone === 'commander') || totalC >= 85
                              ? 'commander'
                              : detectedFormat
                          );
                        }
                        const botCmds = customResolved.filter((c) => c.zone === 'commander');
                        const botCmdQty = botCmds.reduce((s, c) => s + c.quantity, 0);
                        const botMainQty = customResolved
                          .filter((c) => c.zone === 'main')
                          .reduce((s, c) => s + c.quantity, 0);
                        const botTotalQty = botCmdQty + botMainQty;
                        const botCandidates = Array.from(
                          new Set(
                            customResolved
                              .filter((c) => c.zone === 'commander' || c.zone === 'main')
                              .map((c) => c.name)
                          )
                        );

                        return (
                          <div className="space-y-1.5 rounded-md border border-zinc-200 bg-white p-2">
                            <div className="flex flex-wrap items-center justify-between gap-1">
                              <span className="text-[10px] font-semibold text-zinc-700">
                                Custom Decklist ({botTotalQty} cards)
                              </span>
                              <div className="flex flex-wrap items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handlePasteCustomText(`bot-${opp.id}`, (text) =>
                                      updateOpponent(idx, { customDeckText: text })
                                    )
                                  }
                                  className="inline-flex items-center gap-1 rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-700 hover:bg-zinc-100 cursor-pointer"
                                >
                                  <ClipboardPaste className="h-2.5 w-2.5 text-sky-700" />
                                  <span>Paste</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleLoadUserDeckIntoBot(idx, 'original')}
                                  className="rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800 hover:bg-sky-100 cursor-pointer"
                                >
                                  Your List
                                </button>
                                {customRaw.trim() && (
                                  <button
                                    type="button"
                                    onClick={() => updateOpponent(idx, { customDeckText: '' })}
                                    className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 hover:bg-zinc-100 cursor-pointer"
                                  >
                                    Clear
                                  </button>
                                )}
                              </div>
                            </div>

                            <textarea
                              rows={3}
                              value={customRaw}
                              onChange={(e) =>
                                updateOpponent(idx, { customDeckText: e.target.value })
                              }
                              placeholder="Paste Commander or 60-card decklist..."
                              className="w-full rounded-md border border-zinc-300 bg-white p-2 font-mono text-[11px] leading-snug text-zinc-900 placeholder:text-zinc-400 focus:border-sky-600 focus:outline-none"
                            />

                            {botCandidates.length > 0 && (
                              <select
                                id={`bot-cmd-select-${opp.id}`}
                                aria-label="Select bot commander"
                                value={botCmds[0]?.name || ''}
                                onChange={(e) => {
                                  const chosen = e.target.value;
                                  if (!chosen) return;
                                  const secondPartner =
                                    botCmds.length > 1 &&
                                    normalizeCardLookupKey(botCmds[1].name) !==
                                      normalizeCardLookupKey(chosen)
                                      ? botCmds[1].name
                                      : undefined;
                                  updateOpponent(idx, {
                                    customDeckText: setDecklistCommanderClientSide(
                                      customRaw,
                                      chosen,
                                      secondPartner
                                    ),
                                  });
                                }}
                                className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-[11px] font-medium text-zinc-900 focus:border-sky-600 focus:outline-none"
                              >
                                <option value="">
                                  {botCmds.length > 0
                                    ? `Cmdr: ${botCmds.map((c) => c.name).join(' & ')}`
                                    : 'Select bot commander...'}
                                </option>
                                {botCandidates.map((cn) => (
                                  <option key={cn} value={cn}>
                                    {cn}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {loading && (
          <div className="rounded-xl border border-sky-200 bg-sky-50/40 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <DeckShuffleAnimation
                size="lg"
                theme="light"
                label={`Shuffling ${1 + visibleOpponents.length}-Player ${mode} Pod Libraries...`}
                sublabel={`${effectiveUserDeck.totalMainAndCmd} cards · Randomizing opening 7-card hands`}
              />
              <button
                type="button"
                onClick={handleCancelPlaytest}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 cursor-pointer whitespace-nowrap shrink-0"
              >
                <X className="h-3.5 w-3.5" />
                Cancel Simulation
              </button>
            </div>
            <OperationProgressBar
              title={`Simulating ${mode} Bot Match`}
              progress={playtestProgress}
              compact
            />
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 space-y-2">
            <div>{error}</div>
            {/credit|quota|rate limit|api key/i.test(error) && (
              <div>
                <button
                  type="button"
                  onClick={() => void handleRunPlaytest(true)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-zinc-50 cursor-pointer"
                >
                  Run Local Bot Simulation (No AI)
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Unified Play Area: Live Play vs AI Bots + Visual Board Match Replay */}
      <Suspense fallback={null}>
        <InteractiveTurnSimulator
          analysis={analysis}
          optimizedDeckText={effectiveUserDeck.serializedText}
          effectiveUserCards={effectiveUserDeck.cards}
          useOptimizedList={deckVersion !== 'original'}
          deckVersionLabel={
            deckVersion === 'mana-optimized'
              ? 'Mana Optimization (Synced)'
              : deckVersion === 'full-optimized'
              ? 'All Analyzer Fixes'
              : 'Original Upload'
          }
          mode={mode}
          opponents={visibleOpponents}
          onModeChange={setMode}
          onUpdateOpponentsForMode={(nextOpps) =>
            setOpponentsByMode((prev) => ({
              ...prev,
              [mode]: nextOpps,
            }))
          }
          findMeta={findMeta}
          onInspectCard={onInspectCard}
          liveVsBotsNonce={liveVsBotsNonce}
          playtestResult={result}
          activeRoundIdx={activeRoundIdx}
          onSelectRound={setActiveRoundIdx}
          playAreaMode={playAreaMode}
          onPlayAreaModeChange={setPlayAreaMode}
          onRunBotMatch={() => void handleRunPlaytest(false)}
          isSimulatingBotMatch={loading}
          onLiveStatsChange={onLiveStatsChange}
          botMemory={botMemory}
          onSaveBotMemoryProfiles={onSaveBotMemoryProfiles}
          autoLearnEnabled={autoLearnEnabled}
          resolvingCustomMeta={resolvingCustomMeta}
        />
      </Suspense>

      {/* Match Results & Side-by-Side Round Analyzer */}
      {result && (
        <div className="space-y-6">
          {/* Match Overview & Opening Hand */}
          <div className="rounded-xl border border-zinc-200 bg-white p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-100 pb-4">
              <div className="flex items-center gap-3">
                <Swords className="h-5 w-5 text-sky-700 shrink-0" />
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`text-sm font-bold uppercase ${
                        result.outcome === 'win'
                          ? 'text-emerald-700'
                          : result.outcome === 'loss'
                          ? 'text-red-700'
                          : 'text-amber-700'
                      }`}
                    >
                      {result.outcome === 'win'
                        ? 'Simulated Victory'
                        : result.outcome === 'loss'
                        ? 'Simulated Defeat'
                        : 'Close Match'}
                    </span>
                    <span className="text-zinc-300" aria-hidden="true">·</span>
                    <span className="text-xs font-mono tabular-nums text-zinc-600">
                      {result.mode} ({result.startingLife} starting life) · {result.totalRounds} rounds
                    </span>
                    <span className="text-zinc-300" aria-hidden="true">·</span>
                    <span className="text-xs text-zinc-500">{result.testedListLabel}</span>
                    {result.aiEngineUsed === 'local-gguf' && (
                      <>
                        <span className="text-zinc-300" aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-sky-800">
                          <Cpu className="h-3 w-3 shrink-0" />
                          {result.aiModelLabel || 'Local GGUF'} (.gguf Adaptive Learning)
                        </span>
                      </>
                    )}
                    {result.finalStats && (
                      <>
                        <span className="text-zinc-300" aria-hidden="true">·</span>
                        <span className="text-xs font-semibold text-sky-700">
                          {result.finalStats.winCondition === 'poison'
                            ? 'Win Vector: 10+ Poison (Toxic/Infect)'
                            : result.finalStats.winCondition === 'commander'
                            ? 'Win Vector: 21+ Commander Damage'
                            : result.finalStats.winCondition === 'mill'
                            ? 'Win Vector: Library Milled Out'
                            : result.finalStats.winCondition === 'life'
                            ? 'Win Vector: 0 Life Elimination'
                            : `Table Clock Lead (${result.finalStats.winningPlayer})`}
                        </span>
                      </>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-zinc-700">{result.matchSummary}</p>
                  {Array.isArray(result.opponentsUsed) && result.opponentsUsed.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
                      <span className="font-medium text-zinc-600">Table Opponents:</span>
                      {(Array.isArray(result.opponentsUsed) ? result.opponentsUsed : []).map((opp, idx) => {
                        const meta = getBotIndignanceMeta(opp.indignance);
                        return (
                          <React.Fragment key={`${opp.name}-${idx}`}>
                            <span>
                              <span className="font-medium text-zinc-800">{opp.name}</span>{' '}
                              <span className={meta.textColorClass}>
                                ({meta.label})
                              </span>
                            </span>
                            {idx < (Array.isArray(result.opponentsUsed) ? result.opponentsUsed.length : 0) - 1 && (
                              <span className="text-zinc-300" aria-hidden="true">·</span>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowTurnSummaryModal(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-800 hover:bg-sky-100 cursor-pointer shrink-0"
              >
                <Trophy className="h-3.5 w-3.5 shrink-0" />
                Turn Summary
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div>
                <div className="text-xs font-semibold text-zinc-500">
                  Real Shuffled Opening 7 Cards
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-sm">
                  {(Array.isArray(result.openingHand) ? result.openingHand : []).map((card, i) => (
                    <CardLink
                      key={`${card}-${i}`}
                      name={card}
                      meta={findMeta(card)}
                      onInspect={onInspectCard}
                    />
                  ))}
                </div>
              </div>
              <div>
                <div className="text-xs font-semibold text-zinc-500">Opening Hand Verdict</div>
                <p className="mt-1 text-sm text-zinc-700">{result.mulliganVerdict}</p>
              </div>
            </div>

            {result.finalStats && result.finalStats.participants.length > 0 && (
              <div className="border-t border-zinc-100 pt-4">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                  <span className="text-xs font-semibold text-zinc-700">
                    Synchronized Final Match Scoreboard (After Round {result.finalStats.roundsPlayed})
                  </span>
                  <span className="font-mono text-[11px] tabular-nums text-zinc-500">
                    Winner: <span className="font-semibold text-zinc-900">{result.finalStats.winningPlayer}</span>
                  </span>
                </div>
                <div className="overflow-x-auto rounded-lg border border-zinc-200">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-zinc-200 bg-zinc-50 text-[11px] font-semibold text-zinc-500">
                      <tr>
                        <th className="px-3 py-2">Player</th>
                        <th className="px-3 py-2 text-right">Life</th>
                        <th className="px-3 py-2 text-right">Poison (/10)</th>
                        {detectedFormat === 'commander' && (
                          <th className="px-3 py-2 text-right">Cmdr Dmg (/21)</th>
                        )}
                        <th className="px-3 py-2 text-right">Library (Milled / GY)</th>
                        <th className="px-3 py-2 text-right">Board &amp; Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 font-mono tabular-nums">
                      {result.finalStats.participants.map((p) => {
                        const isYou = p.player === 'You';
                        const cmdBreakdown = (p.commanderDamageTaken || [])
                          .filter((c) => c.totalDamage > 0)
                          .map((c) => `${c.sourceName.split(',')[0]}: ${c.totalDamage}`)
                          .join(' · ');

                        return (
                          <tr key={p.player} className={isYou ? 'bg-sky-50/40' : ''}>
                            <td className="px-3 py-2 font-sans font-semibold text-zinc-900">
                              {p.player}
                              {p.player === result.finalStats?.winningPlayer && (
                                <span className="ml-2 text-[11px] font-semibold text-emerald-700">
                                  (Winner)
                                </span>
                              )}
                            </td>
                            <td
                              className={`px-3 py-2 text-right font-semibold ${
                                p.life <= 0
                                  ? 'text-red-700'
                                  : isYou
                                  ? 'text-sky-700'
                                  : 'text-zinc-900'
                              }`}
                            >
                              {p.life} HP
                            </td>
                            <td
                              className={`px-3 py-2 text-right ${
                                p.poisonCounters >= 10
                                  ? 'text-red-700 font-semibold'
                                  : p.poisonCounters > 0
                                  ? 'text-emerald-700 font-semibold'
                                  : 'text-zinc-400'
                              }`}
                            >
                              {p.poisonCounters}/10
                            </td>
                            {detectedFormat === 'commander' && (
                              <td className="px-3 py-2 text-right">
                                <span
                                  className={
                                    p.maxCommanderDamage >= 21
                                      ? 'text-red-700 font-semibold'
                                      : p.maxCommanderDamage > 0
                                      ? 'text-amber-700 font-semibold'
                                      : 'text-zinc-400'
                                  }
                                >
                                  {p.maxCommanderDamage}/21
                                </span>
                                {cmdBreakdown && (
                                  <div className="font-sans text-[10px] text-zinc-500">
                                    {cmdBreakdown}
                                  </div>
                                )}
                              </td>
                            )}
                            <td className="px-3 py-2 text-right text-zinc-700">
                              <span className={p.libraryRemaining <= 0 ? 'text-red-700 font-semibold' : ''}>
                                {p.libraryRemaining} Lib
                              </span>
                              <span className="text-zinc-400">
                                {' '}· {p.cardsMilledTotal} Mill · {p.graveyardCount} GY
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right text-zinc-700">
                              <span>
                                {p.landsInPlay}L · {p.creaturesInPlay}C · {p.handSize}H
                              </span>
                              {p.eliminatedBy && (
                                <span className="ml-2 font-sans font-semibold text-red-700">
                                  [{p.eliminatedBy.toUpperCase()} KO]
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Round Selector Strip */}
          {Array.isArray(result.rounds) && result.rounds.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-100 p-1">
                {result.rounds.map((r, idx) => {
                  const hasCritical = (Array.isArray(r.roundChanges) ? r.roundChanges : []).some((c) => c.urgency === 'critical');
                  const isTagged = Boolean(manaTagsByRound[r.roundNumber]);
                  return (
                    <button
                      key={r.roundNumber}
                      type="button"
                      onClick={() => setActiveRoundIdx(idx)}
                      className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs font-mono font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        activeRoundIdx === idx
                          ? 'bg-white text-zinc-900 shadow-sm'
                          : isTagged
                          ? 'text-amber-800 hover:text-amber-950'
                          : hasCritical
                          ? 'text-red-700 hover:text-red-900'
                          : 'text-zinc-700 hover:text-zinc-900'
                      }`}
                    >
                      {isTagged && (
                        <Flag className="h-3 w-3 text-amber-700 shrink-0" />
                      )}
                      Round {r.roundNumber}
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setPlayAreaMode('replay');
                    document.getElementById('interactive-live-game')?.scrollIntoView({
                      behavior: 'smooth',
                      block: 'start',
                    });
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-900 hover:bg-sky-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <LayoutGrid className="h-3.5 w-3.5 text-sky-700 shrink-0" />
                  View Round {activeRoundIdx + 1} in Play Area
                </button>
                <button
                  type="button"
                  disabled={activeRoundIdx === 0}
                  onClick={() => setActiveRoundIdx((i) => Math.max(0, i - 1))}
                  className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 cursor-pointer"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Prev
                </button>
                <button
                  type="button"
                  disabled={activeRoundIdx >= (result.rounds || []).length - 1}
                  onClick={() =>
                    setActiveRoundIdx((i) => Math.min((result.rounds || []).length - 1, i + 1))
                  }
                  className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 cursor-pointer"
                >
                  Next
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Match Log Sidebar + Round Workspace & Analyzer Correlation */}
          {activeRound && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[340px_1fr] lg:items-start">
              {/* Left Sidebar: Match Log & Mana Turn Tagging */}
              <PlaytestMatchLogSidebar
                result={result}
                activeRoundIdx={activeRoundIdx}
                onSelectRound={setActiveRoundIdx}
                manaTagsByRound={manaTagsByRound}
                onSetRoundManaTag={handleSetRoundManaTag}
                onAutoTagRounds={handleAutoTagRounds}
                onClearAllTags={() => setManaTagsByRound({})}
                findMeta={findMeta}
                onInspectCard={onInspectCard}
              />

              {/* Right Workspace: Active Round State + Round Fixes + Tagged Correlation */}
              <div className="space-y-6 min-w-0">
                <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 xl:items-start">
                  {/* Round Match State & Bot Actions */}
                  <div className="rounded-xl border border-zinc-200 bg-white p-6 space-y-5">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 pb-3">
                      <h3 className="font-display text-base font-semibold text-zinc-900">
                        Round {activeRound.roundNumber} Table State
                      </h3>
                      <div className="font-mono text-xs tabular-nums text-zinc-600">
                        Lands: <span className="font-semibold text-zinc-900">{activeRound.landsInPlay}</span>
                        <span className="mx-2 text-zinc-300">|</span>
                        Mana: <span className="font-semibold text-sky-700">{activeRound.manaAvailable}</span>
                        {typeof activeRound.libraryRemaining === 'number' && (
                          <>
                            <span className="mx-2 text-zinc-300">|</span>
                            Lib: <span className="font-semibold text-zinc-900">{activeRound.libraryRemaining}</span>
                          </>
                        )}
                        {typeof activeRound.graveyardCount === 'number' && (
                          <>
                            <span className="mx-2 text-zinc-300">|</span>
                            GY: <span className="font-semibold text-zinc-900">{activeRound.graveyardCount}</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Quick Mana Tag Control for Active Round */}
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-zinc-50/70 px-3 py-2">
                      <span className="text-xs font-medium text-zinc-600">
                        Mana performance this turn:
                      </span>
                      {manaTagsByRound[activeRound.roundNumber] ? (
                        <div className="flex items-center gap-1.5">
                          <Flag className="h-3.5 w-3.5 text-amber-700 shrink-0" />
                          <select
                            aria-label={`Active round ${activeRound.roundNumber} mana issue`}
                            value={manaTagsByRound[activeRound.roundNumber]}
                            onChange={(e) =>
                              handleSetRoundManaTag(
                                activeRound.roundNumber,
                                e.target.value as ManaIssueTag
                              )
                            }
                            className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900 focus:border-sky-600 focus:outline-none cursor-pointer"
                          >
                            {MANA_ISSUE_TAGS.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.label}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() =>
                              handleSetRoundManaTag(activeRound.roundNumber, undefined)
                            }
                            aria-label="Clear tag on this turn"
                            className="inline-flex items-center justify-center rounded border border-zinc-200 bg-white p-1 text-zinc-500 hover:text-red-700 cursor-pointer"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            const prev =
                              activeRoundIdx > 0
                                ? (result.rounds || [])[activeRoundIdx - 1]
                                : undefined;
                            handleSetRoundManaTag(
                              activeRound.roundNumber,
                              detectRoundManaTag(activeRound, prev) || 'missed-land'
                            );
                          }}
                          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-900 cursor-pointer whitespace-nowrap shrink-0"
                        >
                          <Flag className="h-3 w-3" />
                          Tag mana underperformed
                        </button>
                      )}
                    </div>

                    {/* Synchronized Participant Health, Poison, Per-Bot Commander Damage & Library Grid */}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {(Array.isArray(activeRound.participantStats) && activeRound.participantStats.length > 0
                        ? activeRound.participantStats
                        : (Array.isArray(activeRound.lifeTotals) ? activeRound.lifeTotals : []).map((lt) => ({
                            player: lt.player,
                            life: lt.life,
                            lifeDelta: 0,
                            poisonCounters: 0,
                            poisonDelta: 0,
                            commanderDamageTaken: [],
                            maxCommanderDamage: 0,
                            libraryRemaining: 0,
                            cardsMilledTotal: 0,
                            cardsMilledThisRound: 0,
                            graveyardCount: 0,
                            handSize: 0,
                            landsInPlay: 0,
                            manaAvailable: 0,
                            creaturesInPlay: 0,
                            eliminatedBy: null,
                          }))
                      ).map((ps) => {
                        const isYou = ps.player.toLowerCase() === 'you';
                        return (
                          <div
                            key={ps.player}
                            className={`rounded-lg border px-3 py-2.5 space-y-1.5 ${
                              ps.eliminatedBy
                                ? 'border-red-200 bg-red-50/40'
                                : isYou
                                ? 'border-sky-200 bg-sky-50/30'
                                : 'border-zinc-200 bg-zinc-50'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-xs font-semibold text-zinc-900">
                                {ps.player}
                              </span>
                              <div className="font-mono text-base font-bold tabular-nums flex items-baseline gap-1.5">
                                <span
                                  className={
                                    ps.life <= 0
                                      ? 'text-red-700'
                                      : isYou
                                      ? 'text-sky-700'
                                      : 'text-zinc-900'
                                  }
                                >
                                  {ps.life} HP
                                </span>
                                {ps.lifeDelta !== 0 && (
                                  <span
                                    className={`text-[11px] font-semibold ${
                                      ps.lifeDelta > 0 ? 'text-emerald-700' : 'text-red-700'
                                    }`}
                                  >
                                    ({ps.lifeDelta > 0 ? `+${ps.lifeDelta}` : ps.lifeDelta})
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 font-mono text-[11px] tabular-nums text-zinc-600">
                              <span
                                className={
                                  ps.poisonCounters >= 10
                                    ? 'text-red-700 font-semibold'
                                    : ps.poisonCounters > 0
                                    ? 'text-emerald-700 font-semibold'
                                    : 'text-zinc-500'
                                }
                              >
                                Poison {ps.poisonCounters}/10
                                {ps.poisonDelta > 0 ? ` (+${ps.poisonDelta})` : ''}
                              </span>
                              {detectedFormat === 'commander' && (
                                <>
                                  <span className="text-zinc-300" aria-hidden="true">·</span>
                                  <span
                                    className={
                                      ps.maxCommanderDamage >= 21
                                        ? 'text-red-700 font-semibold'
                                        : ps.maxCommanderDamage > 0
                                        ? 'text-amber-700 font-semibold'
                                        : 'text-zinc-500'
                                    }
                                  >
                                    Cmdr {ps.maxCommanderDamage}/21
                                  </span>
                                </>
                              )}
                              {ps.libraryRemaining > 0 && (
                                <>
                                  <span className="text-zinc-300" aria-hidden="true">·</span>
                                  <span>
                                    Lib {ps.libraryRemaining}
                                    {ps.cardsMilledTotal > 0 ? ` (${ps.cardsMilledTotal} Mill)` : ''}
                                  </span>
                                </>
                              )}
                            </div>

                            {detectedFormat === 'commander' &&
                              ps.commanderDamageTaken.some((c) => c.totalDamage > 0) && (
                                <div className="font-mono text-[10px] tabular-nums text-amber-700">
                                  {ps.commanderDamageTaken
                                    .filter((c) => c.totalDamage > 0)
                                    .map(
                                      (c) =>
                                        `${c.sourceName.split(',')[0]}: ${c.totalDamage}/21${
                                          c.delta > 0 ? ` (+${c.delta})` : ''
                                        }`
                                    )
                                    .join(' · ')}
                                </div>
                              )}

                            <div className="flex items-center justify-between font-mono text-[10px] tabular-nums text-zinc-500 pt-0.5 border-t border-zinc-200/60">
                              <span>
                                {ps.landsInPlay}L · {ps.manaAvailable}M · {ps.creaturesInPlay}C · {ps.handSize} Hand
                              </span>
                              {ps.eliminatedBy && (
                                <span className="font-sans font-semibold text-red-700 uppercase">
                                  Eliminated ({ps.eliminatedBy})
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Your Turn */}
                    <div className="space-y-2 border-t border-zinc-100 pt-4">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-zinc-800">Your Turn</span>
                          {activeRound.playerStats?.targetBot && (
                            <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-900">
                              Target: {activeRound.playerStats.targetBot}
                            </span>
                          )}
                        </div>
                        <span className="text-zinc-500">
                          Drew:{' '}
                          <CardLink
                            name={activeRound.cardDrawn}
                            meta={findMeta(activeRound.cardDrawn)}
                            onInspect={onInspectCard}
                            className="text-xs"
                          />
                        </span>
                      </div>
                      <p className="text-sm leading-relaxed text-zinc-700">
                        {activeRound.playerAction}
                      </p>
                      {activeRound.playerStats && (
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] tabular-nums text-zinc-600">
                          {activeRound.playerStats.combatDamageDealt > 0 && (
                            <span className="text-sky-700 font-semibold">
                              Dealt {activeRound.playerStats.combatDamageDealt} HP Dmg
                            </span>
                          )}
                          {activeRound.playerStats.commanderDamageDealt > 0 && (
                            <span className="text-amber-700 font-semibold">
                              +{activeRound.playerStats.commanderDamageDealt} Cmdr Dmg
                            </span>
                          )}
                          {activeRound.playerStats.poisonDealt > 0 && (
                            <span className="text-emerald-700 font-semibold">
                              +{activeRound.playerStats.poisonDealt} Poison
                            </span>
                          )}
                          {activeRound.playerStats.millDealt > 0 && (
                            <span className="text-sky-700 font-semibold">
                              Milled {activeRound.playerStats.millDealt}
                            </span>
                          )}
                          {activeRound.playerStats.lifeGained > 0 && (
                            <span className="text-emerald-700 font-semibold">
                              +{activeRound.playerStats.lifeGained} Life
                            </span>
                          )}
                          {activeRound.playerStats.cardsDrawnExtra > 0 && (
                            <span>+{activeRound.playerStats.cardsDrawnExtra} Extra Draw</span>
                          )}
                          <span>Board: {activeRound.playerStats.creaturesOnBoard} Creatures</span>
                        </div>
                      )}
                      {Array.isArray(activeRound.cardsPlayed) && activeRound.cardsPlayed.length > 0 && (
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-600">
                          <span className="font-medium text-zinc-500">Played:</span>
                          {activeRound.cardsPlayed.map((c, i) => (
                            <React.Fragment key={`${c}-${i}`}>
                              <CardLink
                                name={c}
                                meta={findMeta(c)}
                                onInspect={onInspectCard}
                                className="text-xs"
                              />
                              {i < activeRound.cardsPlayed.length - 1 && (
                                <span className="text-zinc-300">·</span>
                              )}
                            </React.Fragment>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Bot Opponents' Turns */}
                    <div className="space-y-3 border-t border-zinc-100 pt-4">
                      <div className="text-xs font-semibold text-zinc-800">
                        Bot Opponents&apos; Turns
                      </div>
                      <div className="divide-y divide-zinc-100">
                        {(Array.isArray(activeRound.botPlays) ? activeRound.botPlays : []).map((bp, i) => {
                          const botIndignance = getBotIndignanceMeta(
                            bp.indignance ||
                              (Array.isArray(result.opponentsUsed) ? result.opponentsUsed : []).find(
                                (o) => (o?.name || '').trim().toLowerCase() === (bp?.botName || '').trim().toLowerCase()
                              )?.indignance ||
                              result.opponentsUsed?.[i]?.indignance
                          );
                          const targetLabel = (bp.targetParticipant || 'You').trim();
                          const isTargetingRivalBot =
                            Boolean(targetLabel) && targetLabel.toLowerCase() !== 'you';

                          const targetLifeDelta =
                            typeof bp.targetLifeDelta === 'number' && bp.targetLifeDelta !== 0
                              ? bp.targetLifeDelta
                              : !isTargetingRivalBot && typeof bp.lifeChangeToYou === 'number'
                              ? bp.lifeChangeToYou
                              : 0;
                          const targetPoisonDelta = Math.max(
                            0,
                            bp.targetPoisonDelta ?? (!isTargetingRivalBot ? bp.poisonToYou ?? 0 : 0)
                          );
                          const targetCmdrDelta = Math.max(
                            0,
                            bp.targetCommanderDamage ?? (!isTargetingRivalBot ? bp.commanderDamageToYou ?? 0 : 0)
                          );
                          const targetMillDelta = Math.max(
                            0,
                            bp.targetMillAmount ?? (!isTargetingRivalBot ? bp.millToYou ?? 0 : 0)
                          );
                          const spillLifeToYou =
                            isTargetingRivalBot && typeof bp.lifeChangeToYou === 'number' && bp.lifeChangeToYou !== 0
                              ? bp.lifeChangeToYou
                              : 0;
                          const eachOppLife = bp.eachOpponentLifeDelta ?? 0;
                          const eachOppPoison = bp.eachOpponentPoison ?? 0;
                          const eachOppMill = bp.eachOpponentMill ?? 0;

                          const hasCombatImpact =
                            targetLifeDelta !== 0 ||
                            targetPoisonDelta > 0 ||
                            targetCmdrDelta > 0 ||
                            targetMillDelta > 0 ||
                            spillLifeToYou !== 0 ||
                            eachOppLife !== 0 ||
                            eachOppPoison > 0 ||
                            eachOppMill > 0 ||
                            (bp.creaturesRemovedOnTarget ?? 0) > 0 ||
                            Boolean(bp.boardWipeCast) ||
                            (bp.selfLifeGain ?? 0) > 0 ||
                            (bp.selfLifeLoss ?? 0) > 0;

                          return (
                            <div key={i} className="py-2.5 first:pt-0 last:pb-0 text-sm">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-semibold text-zinc-900">{bp.botName}</span>
                                  {bp.commanderName && (
                                    <span className="text-xs text-zinc-500">
                                      ({bp.commanderName})
                                    </span>
                                  )}
                                  {!bp.eliminatedThisTurn && bp.targetParticipant && (
                                    <span
                                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                        isTargetingRivalBot
                                          ? 'bg-amber-100 text-amber-900'
                                          : 'bg-sky-100 text-sky-900'
                                      }`}
                                    >
                                      Target: {targetLabel}
                                    </span>
                                  )}
                                  {bp.eliminatedThisTurn && (
                                    <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-800 uppercase">
                                      Eliminated
                                    </span>
                                  )}
                                </div>
                                <span className="text-xs text-zinc-500">
                                  {bp.archetype}
                                  <span className="mx-1.5 text-zinc-300" aria-hidden="true">·</span>
                                  <span className={`font-medium ${botIndignance.textColorClass}`}>
                                    {botIndignance.label}
                                  </span>
                                </span>
                              </div>
                              <p className="mt-1 text-zinc-700">{bp.action}</p>
                              {hasCombatImpact && (
                                <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 font-mono text-[11px] tabular-nums">
                                  {bp.boardWipeCast && (
                                    <span className="text-red-700 font-semibold">
                                      Board Wipe Cast
                                    </span>
                                  )}
                                  {targetLifeDelta !== 0 && (
                                    <span className={targetLifeDelta < 0 ? 'text-red-700 font-semibold' : 'text-emerald-700 font-semibold'}>
                                      {targetLifeDelta} {targetLabel} HP
                                    </span>
                                  )}
                                  {spillLifeToYou !== 0 && (
                                    <span className={spillLifeToYou < 0 ? 'text-red-700 font-semibold' : 'text-emerald-700 font-semibold'}>
                                      {spillLifeToYou} You HP (Table Drain)
                                    </span>
                                  )}
                                  {eachOppLife !== 0 && (
                                    <span className={eachOppLife < 0 ? 'text-red-700 font-semibold' : 'text-emerald-700 font-semibold'}>
                                      {eachOppLife} Each Other Opp HP
                                    </span>
                                  )}
                                  {eachOppPoison > 0 && (
                                    <span className="text-emerald-700 font-semibold">
                                      +{eachOppPoison} Poison Each Opp
                                    </span>
                                  )}
                                  {eachOppMill > 0 && (
                                    <span className="text-sky-700 font-semibold">
                                      +{eachOppMill} Milled Each Opp
                                    </span>
                                  )}
                                  {targetPoisonDelta > 0 && (
                                    <span className="text-emerald-700 font-semibold">
                                      +{targetPoisonDelta} Poison to {targetLabel}
                                    </span>
                                  )}
                                  {targetCmdrDelta > 0 && (
                                    <span className="text-amber-700 font-semibold">
                                      +{targetCmdrDelta} Cmdr Dmg to {targetLabel}
                                    </span>
                                  )}
                                  {targetMillDelta > 0 && (
                                    <span className="text-sky-700 font-semibold">
                                      +{targetMillDelta} Milled from {targetLabel}
                                    </span>
                                  )}
                                  {(bp.creaturesRemovedOnTarget ?? 0) > 0 && (
                                    <span className="text-amber-800 font-semibold">
                                      -{bp.creaturesRemovedOnTarget} Creature on {targetLabel}
                                    </span>
                                  )}
                                  {(bp.selfLifeGain ?? 0) > 0 && (
                                    <span className="text-zinc-600">
                                      Bot +{bp.selfLifeGain} HP
                                    </span>
                                  )}
                                  {(bp.selfLifeLoss ?? 0) > 0 && (
                                    <span className="text-zinc-500">
                                      Bot -{bp.selfLifeLoss} HP
                                    </span>
                                  )}
                                </div>
                              )}
                              <p className="mt-0.5 text-xs text-zinc-500">
                                Board threat: {bp.boardThreat}
                                {typeof bp.landsInPlay === 'number' && (
                                  <span className="ml-2 font-mono tabular-nums text-zinc-400">
                                    ({bp.landsInPlay}L · {bp.creaturesOnBoard ?? 0}C · {bp.handSize ?? 0}H)
                                  </span>
                                )}
                              </p>
                              {bp.appliedPastMemory && (
                                <p className="mt-1 text-[11px] font-medium text-sky-700">
                                  Past-game memory applied: {bp.appliedPastMemory}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Changes Needed From This Round (Alongside Analyzer) */}
                  <div className="space-y-6">
                    <div className="rounded-xl border border-zinc-200 bg-white p-6 space-y-4">
                      <div className="border-b border-zinc-100 pb-3">
                        <h3 className="font-display text-base font-semibold text-zinc-900">
                          Deck Changes From Round {activeRound.roundNumber}
                        </h3>
                        <p className="mt-1 text-xs text-zinc-600">
                          <span className="font-semibold text-zinc-800">Round Bottleneck:</span>{' '}
                          {activeRound.manaOrTempoIssue}
                        </p>
                      </div>

                      {(Array.isArray(activeRound.roundChanges) ? activeRound.roundChanges : []).length === 0 ? (
                        <p className="text-sm text-zinc-500">
                          No deck changes triggered during Round {activeRound.roundNumber}.
                        </p>
                      ) : (
                        <div className="divide-y divide-zinc-100">
                          {(Array.isArray(activeRound.roundChanges) ? activeRound.roundChanges : []).map((change, idx) =>
                            renderRoundChange(change, idx)
                          )}
                        </div>
                      )}
                    </div>

                    {Array.isArray(result.keyTakeaways) && result.keyTakeaways.length > 0 && (
                      <div className="rounded-xl border border-zinc-200 bg-white p-6 space-y-3">
                        <h3 className="font-display text-base font-semibold text-zinc-900">
                          Overall Match Takeaways ({result.mode})
                        </h3>
                        <div className="divide-y divide-zinc-100">
                          {result.keyTakeaways.map((item, idx) =>
                            renderRoundChange(item, idx)
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Direct Tagged Mana Turns ↔ Analyzer Correlation */}
                <PlaytestManaCorrelation
                  analysis={analysis}
                  result={result}
                  manaTagsByRound={manaTagsByRound}
                  onSelectRoundByNumber={handleSelectRoundByNumber}
                  onAutoTagRounds={handleAutoTagRounds}
                  findMeta={findMeta}
                  onInspectCard={onInspectCard}
                />

                {/* Post-Match Adaptive Bot Learning & User Coaching Panel */}
                <div className="rounded-xl border border-zinc-200 bg-white p-6 space-y-6">
                  <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-100 pb-4">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Sparkles className="h-4 w-4 text-sky-700 shrink-0" />
                        <h3 className="font-display text-base font-bold text-zinc-900">
                          What Bots Learned &amp; Interactive Bot Coaching
                        </h3>
                        {result.aiEngineUsed === 'local-gguf' && (
                          <span className="inline-flex items-center gap-1 rounded bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-900">
                            <Cpu className="h-3 w-3 shrink-0" />
                            Synthesized by {result.aiModelLabel || 'Local GGUF'} (.gguf)
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-600">
                        {autoLearnEnabled
                          ? 'Each bot automatically extracted lessons from your deck and its own decklist. Critique their plays or give direct tactical instructions below to make them sharper next game.'
                          : 'Automatic match learning is currently disabled in AI Model Settings. Existing bot memory was preserved unchanged—use the coaching form below to train bots with your feedback.'}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openTutorial('learning')}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <BookOpen className="h-3.5 w-3.5 text-sky-700 shrink-0" />
                        How Bot Learning Works
                      </button>
                      {!autoLearnEnabled && (
                        <button
                          type="button"
                          onClick={() => window.dispatchEvent(new Event('umbras:open-desktop-modal'))}
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          Enable Auto-Learn in AI Settings
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Match Reflection Cards */}
                  {Array.isArray(result.botLearnings) && result.botLearnings.length > 0 && (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                      {result.botLearnings.map((bl, idx) => {
                        const matchedOpp =
                          visibleOpponents.find(
                            (o) => (o?.name || '').trim().toLowerCase() === (bl?.botName || '').trim().toLowerCase()
                          ) || visibleOpponents[idx];
                        const profile = matchedOpp ? getBotProfileForOpp(matchedOpp) : null;

                        return (
                          <div
                            key={`${bl.botName}-${idx}`}
                            className="rounded-lg border border-zinc-200 bg-zinc-50/70 p-4 space-y-2.5 text-xs"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-zinc-900">{bl.botName}</span>
                              {profile && (
                                <span className="rounded bg-sky-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-sky-900">
                                  IQ {profile.botIqScore}
                                </span>
                              )}
                            </div>

                            <div className="space-y-1.5 text-zinc-700 leading-relaxed">
                              <div>
                                <span className="font-semibold text-zinc-900">From Facing You:</span>{' '}
                                {bl.lessonFromPlayerDeck}
                              </div>
                              <div>
                                <span className="font-semibold text-zinc-900">From Own Deck:</span>{' '}
                                {bl.lessonFromOwnDeck}
                              </div>
                              <div>
                                <span className="font-semibold text-sky-900">New Rule:</span>{' '}
                                {bl.tacticalAdjustment}
                              </div>
                              <div className="text-[11px] text-zinc-500 pt-1 border-t border-zinc-200">
                                {bl.adaptationSummary}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Interactive User Coaching Form */}
                  <div className="rounded-xl border border-sky-200 bg-sky-50/50 p-4 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-xs font-bold text-zinc-900">
                        <MessageSquarePlus className="h-4 w-4 text-sky-700" />
                        Coach an AI Bot With Your Input
                      </div>

                      <div className="flex items-center gap-2">
                        <label
                          htmlFor="coach-bot-select"
                          className="text-xs font-medium text-zinc-600"
                        >
                          Target Bot:
                        </label>
                        <select
                          id="coach-bot-select"
                          value={selectedCoachBotIdx}
                          onChange={(e) => setSelectedCoachBotIdx(Number(e.target.value))}
                          className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1 text-xs font-semibold text-zinc-900 focus:border-sky-600 focus:outline-none cursor-pointer"
                        >
                          {visibleOpponents.map((opp, idx) => (
                            <option key={opp.id} value={idx}>
                              {opp.name} ({opp.customDeckText?.trim() ? 'Custom Decklist' : opp.archetype})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Bot Performance Rating */}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium text-zinc-600 mr-1">
                        Rate bot play this match:
                      </span>
                      <button
                        type="button"
                        onClick={() => setCoachRating('strong')}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold cursor-pointer ${
                          coachRating === 'strong'
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                            : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50'
                        }`}
                      >
                        <ThumbsUp className="h-3.5 w-3.5" />
                        Strong Tactical Play
                      </button>
                      <button
                        type="button"
                        onClick={() => setCoachRating('needs-adjustment')}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold cursor-pointer ${
                          coachRating === 'needs-adjustment'
                            ? 'border-amber-300 bg-amber-50 text-amber-900'
                            : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50'
                        }`}
                      >
                        <Wrench className="h-3.5 w-3.5" />
                        Needs Adjustment
                      </button>
                      <button
                        type="button"
                        onClick={() => setCoachRating('mistake')}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold cursor-pointer ${
                          coachRating === 'mistake'
                            ? 'border-red-300 bg-red-50 text-red-900'
                            : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50'
                        }`}
                      >
                        <ThumbsDown className="h-3.5 w-3.5" />
                        Tactical Mistake
                      </button>
                    </div>

                    {/* Quick Coaching Directive Buttons */}
                    <div className="space-y-1.5">
                      <div className="text-xs font-medium text-zinc-600">
                        Select lessons to reinforce (optional):
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {QUICK_COACHING_TAGS.map((tag) => {
                          const active = coachTags.includes(tag);
                          return (
                            <button
                              key={tag}
                              type="button"
                              onClick={() => handleToggleCoachTag(tag)}
                              className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
                                active
                                  ? 'border-sky-700 bg-sky-700 text-white'
                                  : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100'
                              }`}
                            >
                              {active && <Check className="h-3 w-3" />}
                              <span>{tag}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Custom Coaching Directive Input */}
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        type="text"
                        value={coachCustomNote}
                        onChange={(e) => setCoachCustomNote(e.target.value)}
                        maxLength={240}
                        placeholder="Give specific advice (e.g. 'Hold countermagic for my Commander on Turn 4 instead of tapping out')..."
                        aria-label="Custom bot coaching instruction"
                        className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-sky-600 focus:outline-none"
                      />
                      <button
                        type="button"
                        disabled={coachTags.length === 0 && !coachCustomNote.trim()}
                        onClick={() => handleSubmitPostMatchCoaching(false)}
                        className="rounded-lg border border-sky-700 bg-white px-3.5 py-2 text-xs font-semibold text-sky-800 hover:bg-sky-50 disabled:opacity-40 cursor-pointer whitespace-nowrap"
                      >
                        Save Coaching
                      </button>
                      <button
                        type="button"
                        disabled={
                          loading || (coachTags.length === 0 && !coachCustomNote.trim())
                        }
                        onClick={() => handleSubmitPostMatchCoaching(true)}
                        className="rounded-lg bg-sky-700 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-800 disabled:opacity-40 cursor-pointer whitespace-nowrap"
                      >
                        Save Training &amp; Rematch
                      </button>
                    </div>

                    {coachSavedNotice && (
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-900">
                        {coachSavedNotice}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {result && (
        <TurnSummaryModal
          open={showTurnSummaryModal}
          result={result}
          findMeta={findMeta}
          onInspectCard={onInspectCard}
          onSelectRound={setActiveRoundIdx}
          onClose={() => setShowTurnSummaryModal(false)}
        />
      )}

      <PlaytestTutorialModal
        isOpen={isTutorialOpen}
        onClose={() => setIsTutorialOpen(false)}
        initialStep={tutorialInitialStep}
        autoLearnEnabled={autoLearnEnabled}
      />

      <MultiplayerSessionHub
        isOpen={isMultiplayerHubOpen}
        onClose={() => setIsMultiplayerHubOpen(false)}
        analysis={analysis}
        effectiveUserCards={effectiveUserDeck.cards}
        userCommanders={effectiveUserDeck.commanders}
        findMeta={findMeta}
        onInspectCard={onInspectCard}
      />
    </section>
  );
};
