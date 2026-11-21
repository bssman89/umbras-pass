import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, History, Save } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  BotLearningProfile,
  CardMetadata,
  DeckAnalysisResult,
  DeckExportSimulationStats,
  DeckSelectionState,
  LiveSimulationExportStats,
  PlaytestDeckVersion,
  PlaytestResult,
} from '../types/deck';
import {
  buildOptimizedDeckExport,
  downloadDeckFile,
  type ExtraSwapSpec,
} from '../utils/deckExport';
import { DeckBudgetComparison } from './DeckBudgetComparison';
import { LandSpellGauge } from './LandSpellGauge';
import { ManaBreakdown } from './ManaBreakdown';
import { ManaCalculator } from './ManaCalculator';
import { SynergyAuditPanel } from './SynergyAuditPanel';
import { CardChangesPanel } from './CardChangesPanel';
import { OptimizedExportPanel } from './OptimizedExportPanel';
import { ShareExportMenu } from './ShareExportMenu';

const DeckStatsCard = lazy(() =>
  import('./DeckStatsCard').then((m) => ({ default: m.DeckStatsCard }))
);
const DeckRadarChart = lazy(() =>
  import('./DeckRadarChart').then((m) => ({ default: m.DeckRadarChart }))
);
const CardGalleryPanel = lazy(() =>
  import('./CardGalleryPanel').then((m) => ({ default: m.CardGalleryPanel }))
);
const PlaytestArena = lazy(() =>
  import('./PlaytestArena').then((m) => ({ default: m.PlaytestArena }))
);
const AdvancedDeckMetrics = lazy(() =>
  import('./AdvancedDeckMetrics').then((m) => ({ default: m.AdvancedDeckMetrics }))
);
const DeckPdfReportModal = lazy(() =>
  import('./DeckPdfReportModal').then((m) => ({ default: m.DeckPdfReportModal }))
);

const PanelFallback: React.FC<{ heightClass?: string }> = ({ heightClass = 'h-64' }) => (
  <div className={`${heightClass} animate-pulse rounded-xl border border-zinc-200 bg-white`} />
);

const EMPTY_ID_SET = new Set<string>();
const EMPTY_EXTRA_SWAPS: ExtraSwapSpec[] = [];
const EMPTY_COLOR_BREAKDOWN: DeckAnalysisResult['metrics']['colorBreakdown'] = [];
const DEFAULT_EMPTY_METRICS: DeckAnalysisResult['metrics'] = {
  detectedFormat: 'commander',
  targetDeckSize: 100,
  currentMainAndCommanderCount: 0,
  sideboardCount: 0,
  deckSizeDelta: 0,
  commanderNames: [],
  commanderColorIdentity: [],
  currentLands: 0,
  mdfcLandCount: 0,
  tappedLandCount: 0,
  recommendedLands: 37,
  landsDelta: 0,
  recommendedRamp: 10,
  currentRamp: 0,
  rampDelta: 0,
  currentDraw: 0,
  recommendedDraw: 10,
  currentRemoval: 0,
  recommendedRemoval: 10,
  currentBoardWipes: 0,
  averageCmcNonLand: 0,
  averageCmcWithLands: 0,
  curve: [],
  colorBreakdown: EMPTY_COLOR_BREAKDOWN,
  formatViolations: [],
  singletonViolations: [],
  colorIdentityViolations: [],
  unresolvedCards: [],
};

interface AverageCmcDatum {
  key: string;
  label: string;
  avgCmc: number;
  count: number;
  color: string;
  subtitle: string;
}

const AverageCmcTooltip: React.FC<{
  active?: boolean;
  payload?: Array<{ payload: AverageCmcDatum }>;
}> = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0].payload;
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3.5 py-2.5 text-xs shadow-lg">
      <div className="flex items-center gap-2 font-semibold text-zinc-900">
        <span
          className="h-2.5 w-2.5 rounded-sm shrink-0"
          style={{ backgroundColor: item.color }}
          aria-hidden="true"
        />
        <span>{item.label}</span>
      </div>
      <div className="mt-1.5 space-y-0.5 font-mono tabular-nums text-zinc-700">
        <div>
          Avg CMC: <span className="font-semibold text-zinc-900">{item.avgCmc.toFixed(2)}</span>
        </div>
        <div>
          Sample: <span className="font-semibold text-zinc-900">{item.count}</span> cards
        </div>
      </div>
      <div className="mt-1 text-[11px] text-zinc-500">{item.subtitle}</div>
    </div>
  );
};

interface AnalysisDashboardProps {
  analysis: DeckAnalysisResult;
  selection: DeckSelectionState;
  onSelectionChange: React.Dispatch<React.SetStateAction<DeckSelectionState>>;
  versionCount: number;
  justSavedSnapshot: boolean;
  onSaveSnapshot: () => void;
  onOpenHistory: () => void;
  onInspectCard: (name: string, meta?: CardMetadata | null) => void;
  onReanalyzeUpdated: (updatedDeckText: string) => void;
  botMemory: Record<string, BotLearningProfile>;
  onSaveBotMemoryProfiles: (profiles: BotLearningProfile[]) => void;
  onResetBotMemory: (botKey?: string) => void;
}

export const AnalysisDashboard: React.FC<AnalysisDashboardProps> = ({
  analysis,
  selection,
  onSelectionChange,
  versionCount,
  justSavedSnapshot,
  onSaveSnapshot,
  onOpenHistory,
  onInspectCard,
  onReanalyzeUpdated,
  botMemory,
  onSaveBotMemoryProfiles,
  onResetBotMemory,
}) => {
  const selectedSwapIds = useMemo(() => new Set(selection?.swapIds ?? []), [selection?.swapIds]);
  const selectedCutIds = useMemo(() => new Set(selection?.cutIds ?? []), [selection?.cutIds]);
  const selectedAddIds = useMemo(() => new Set(selection?.addIds ?? []), [selection?.addIds]);
  const selectedLandChangeIds = useMemo(
    () => new Set(selection?.landChangeIds ?? []),
    [selection?.landChangeIds]
  );

  const [auditExtraSwaps, setAuditExtraSwaps] = useState<ExtraSwapSpec[]>([]);
  const [isPdfModalOpen, setIsPdfModalOpen] = useState(false);
  const [playtestDeckVersion, setPlaytestDeckVersion] =
    useState<PlaytestDeckVersion>('original');
  const [manaSyncNonce, setManaSyncNonce] = useState(0);
  const [latestPlaytestResult, setLatestPlaytestResult] =
    useState<PlaytestResult | null>(null);
  const [liveSimStats, setLiveSimStats] =
    useState<LiveSimulationExportStats | null>(null);

  useEffect(() => {
    setAuditExtraSwaps([]);
    setPlaytestDeckVersion('original');
    setManaSyncNonce(0);
    setLatestPlaytestResult(null);
    setLiveSimStats(null);
  }, [analysis]);

  const simulationExportStats = useMemo<DeckExportSimulationStats>(
    () => ({
      botMatchResult: latestPlaytestResult,
      liveSessionStats: liveSimStats,
    }),
    [latestPlaytestResult, liveSimStats]
  );

  const handleToggleAuditSwap = useCallback((spec: ExtraSwapSpec) => {
    setAuditExtraSwaps((prev) => {
      const exists = prev.some(
        (item) =>
          item.cutCardName.toLowerCase() === spec.cutCardName.toLowerCase() &&
          item.addCardName.toLowerCase() === spec.addCardName.toLowerCase()
      );
      if (exists) {
        return prev.filter(
          (item) =>
            !(
              item.cutCardName.toLowerCase() === spec.cutCardName.toLowerCase() &&
              item.addCardName.toLowerCase() === spec.addCardName.toLowerCase()
            )
        );
      }
      // Replace any other staged swap for the same cut card
      return [
        ...prev.filter(
          (item) => item.cutCardName.toLowerCase() !== spec.cutCardName.toLowerCase()
        ),
        spec,
      ];
    });
  }, []);

  const optimizedExport = useMemo(
    () =>
      buildOptimizedDeckExport(
        analysis,
        selectedSwapIds,
        selectedCutIds,
        selectedAddIds,
        selectedLandChangeIds,
        auditExtraSwaps
      ),
    [
      analysis,
      selectedSwapIds,
      selectedCutIds,
      selectedAddIds,
      selectedLandChangeIds,
      auditExtraSwaps,
    ]
  );

  const manaOptimizedExport = useMemo(
    () =>
      buildOptimizedDeckExport(
        analysis,
        EMPTY_ID_SET,
        EMPTY_ID_SET,
        EMPTY_ID_SET,
        selectedLandChangeIds,
        EMPTY_EXTRA_SWAPS,
        null,
        false,
        true
      ),
    [analysis, selectedLandChangeIds]
  );

  const handleAutoBalanceSelection = useCallback(() => {
    setAuditExtraSwaps([]);
    onSelectionChange({
      swapIds: Array.isArray(analysis?.swaps) ? analysis.swaps.map((s) => s.id) : [],
      cutIds: Array.isArray(analysis?.cuts) ? analysis.cuts.map((c) => c.id) : [],
      addIds: Array.isArray(analysis?.additions) ? analysis.additions.map((a) => a.id) : [],
      landChangeIds: Array.isArray(analysis?.manaPlan?.landChanges)
        ? analysis.manaPlan.landChanges.map((lc) => lc.id)
        : [],
    });
  }, [analysis?.swaps, analysis?.cuts, analysis?.additions, analysis?.manaPlan?.landChanges, onSelectionChange]);

  const handleSelectAllLandChanges = useCallback(
    (selectAll: boolean) => {
      onSelectionChange((prev) => ({
        ...prev,
        landChangeIds:
          selectAll && Array.isArray(analysis?.manaPlan?.landChanges)
            ? analysis.manaPlan.landChanges.map((lc) => lc.id)
            : [],
      }));
    },
    [analysis?.manaPlan?.landChanges, onSelectionChange]
  );

  const handleApplyAllManaFixes = useCallback(() => {
    handleSelectAllLandChanges(true);
  }, [handleSelectAllLandChanges]);

  const handleSyncManaToPlaytest = useCallback(() => {
    const allLandChanges = analysis?.manaPlan?.landChanges ?? [];
    if (selectedLandChangeIds.size === 0 && allLandChanges.length > 0) {
      onSelectionChange((prev) => ({
        ...prev,
        landChangeIds: allLandChanges.map((lc) => lc.id),
      }));
    }
    setPlaytestDeckVersion('mana-optimized');
    setManaSyncNonce((n) => n + 1);
    const el = document.getElementById('playtest-section');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [analysis?.manaPlan?.landChanges, onSelectionChange, selectedLandChangeIds.size]);

  const toggleSelectionKey = useCallback(
    (key: keyof DeckSelectionState, id: string) => {
      onSelectionChange((prev) => {
        const current = prev[key] ?? [];
        const next = current.includes(id)
          ? current.filter((item) => item !== id)
          : [...current, id];
        return { ...prev, [key]: next };
      });
    },
    [onSelectionChange]
  );

  const safeResolvedCards = useMemo(
    () =>
      (analysis?.resolvedCards || [])
        .filter((card) => Boolean(card && typeof card === 'object'))
        .map((card) => ({
          ...card,
          name: typeof card.name === 'string' ? card.name : 'Unknown Card',
          quantity: typeof card.quantity === 'number' ? card.quantity : 1,
          zone: card.zone || 'main',
          card: card.card ?? null,
        })),
    [analysis?.resolvedCards]
  );

  const handleSelectAllChanges = useCallback(
    (selectAll: boolean) => {
      onSelectionChange((prev) => ({
        ...prev,
        swapIds: selectAll && Array.isArray(analysis?.swaps) ? analysis.swaps.map((s) => s.id) : [],
        cutIds: selectAll && Array.isArray(analysis?.cuts) ? analysis.cuts.map((c) => c.id) : [],
        addIds: selectAll && Array.isArray(analysis?.additions) ? analysis.additions.map((a) => a.id) : [],
      }));
    },
    [analysis?.swaps, analysis?.cuts, analysis?.additions, onSelectionChange]
  );

  const metrics = analysis?.metrics ?? DEFAULT_EMPTY_METRICS;
  const allRulesIssues = [
    ...(metrics?.formatViolations ?? []),
    ...(metrics?.singletonViolations ?? []),
    ...(metrics?.colorIdentityViolations ?? []),
  ];

  const activeDeckDelta = optimizedExport.totalMainCount - metrics.targetDeckSize;
  const importedChangedSize =
    optimizedExport.totalMainCount !== metrics.currentMainAndCommanderCount;

  const deckCountStatus =
    activeDeckDelta === 0
      ? importedChangedSize
        ? `Exact legal size (was ${metrics.currentMainAndCommanderCount} imported)`
        : 'Exact legal size'
      : activeDeckDelta < 0
      ? `Missing ${Math.abs(activeDeckDelta)} card${Math.abs(activeDeckDelta) === 1 ? '' : 's'}`
      : `${activeDeckDelta} card${activeDeckDelta === 1 ? '' : 's'} over limit`;

  const landStatusText =
    metrics.landsDelta > 0
      ? `Missing ${metrics.landsDelta} land${metrics.landsDelta === 1 ? '' : 's'} · Updated: ${optimizedExport.resultingLandCount}`
      : metrics.landsDelta < 0
      ? `${Math.abs(metrics.landsDelta)} excess land${Math.abs(metrics.landsDelta) === 1 ? '' : 's'} · Updated: ${optimizedExport.resultingLandCount}`
      : 'Optimal land count';

  const bracketLabels: Record<string, string> = {
    'bracket-1': 'Bracket 1: Exhibition',
    'bracket-2': 'Bracket 2: Core',
    'bracket-3': 'Bracket 3: Upgraded',
    'bracket-4': 'Bracket 4: Optimized',
    'bracket-5': 'Bracket 5: cEDH',
  };

  const { averageCmcChartData, optimizedAvgCmcNonLand, formatCmcTarget } = useMemo(() => {
    const mainEntries = safeResolvedCards.filter(
      (c) => c.zone === 'main' || c.zone === 'commander'
    );

    let totalCards = 0;
    let spellCards = 0;

    const typeGroups: Array<{
      key: string;
      label: string;
      match: RegExp;
      color: string;
      sum: number;
      count: number;
    }> = [
      { key: 'Creature', label: 'Creatures', match: /\bcreature\b/i, color: '#10B981', sum: 0, count: 0 },
      { key: 'Instant', label: 'Instants', match: /\binstant\b/i, color: '#0EA5E9', sum: 0, count: 0 },
      { key: 'Sorcery', label: 'Sorceries', match: /\bsorcery\b/i, color: '#8B5CF6', sum: 0, count: 0 },
      { key: 'Artifact', label: 'Artifacts', match: /\bartifact\b/i, color: '#94A3B8', sum: 0, count: 0 },
      { key: 'Enchantment', label: 'Enchantments', match: /\benchantment\b/i, color: '#F59E0B', sum: 0, count: 0 },
      { key: 'Planeswalker', label: 'Planeswalkers', match: /\bplaneswalker\b/i, color: '#E53924', sum: 0, count: 0 },
      { key: 'Battle', label: 'Battles', match: /\bbattle\b/i, color: '#FB923C', sum: 0, count: 0 },
    ];

    for (const entry of mainEntries) {
      const qty = Math.max(1, entry.quantity || 1);
      totalCards += qty;
      const meta = entry.card;
      const frontType = (meta?.typeLine || '').split('//')[0] || '';
      const isLand = Boolean(meta?.isLand) || /\bland\b/i.test(frontType);
      if (isLand) continue;

      const cmc = Number.isFinite(meta?.cmc) ? Number(meta?.cmc) : 0;
      spellCards += qty;

      const matchedGroup = typeGroups.find((g) => g.match.test(frontType));
      if (matchedGroup) {
        matchedGroup.sum += cmc * qty;
        matchedGroup.count += qty;
      }
    }

    let optSpellCount = 0;
    let optSpellCmcSum = 0;
    for (const entry of optimizedExport.entries) {
      if (entry.zone === 'Sideboard' || entry.zone === 'Companion' || entry.isLand) continue;
      const qty = Math.max(1, entry.qty || 1);
      const cmc = Number.isFinite(entry.meta?.cmc) ? Number(entry.meta?.cmc) : 0;
      optSpellCount += qty;
      optSpellCmcSum += cmc * qty;
    }
    const optAvg =
      optSpellCount > 0 ? Number((optSpellCmcSum / optSpellCount).toFixed(2)) : metrics.averageCmcNonLand;

    const hasSelectedAdjustments =
      selectedSwapIds.size > 0 ||
      selectedCutIds.size > 0 ||
      selectedAddIds.size > 0 ||
      selectedLandChangeIds.size > 0 ||
      auditExtraSwaps.length > 0;

    const bars: AverageCmcDatum[] = [
      {
        key: 'spells',
        label: 'Spells Avg',
        avgCmc: Number((metrics.averageCmcNonLand || 0).toFixed(2)),
        count: spellCards,
        color: '#29ABE2',
        subtitle: 'All non-land cards',
      },
      {
        key: 'all',
        label: 'With Lands',
        avgCmc: Number((metrics.averageCmcWithLands || 0).toFixed(2)),
        count: totalCards,
        color: '#64748B',
        subtitle: 'Full deck including 0-MV lands',
      },
    ];

    if (hasSelectedAdjustments) {
      bars.push({
        key: 'optimized',
        label: 'With Fixes',
        avgCmc: optAvg,
        count: optSpellCount,
        color: '#38BDF8',
        subtitle: 'Spells average after selected changes',
      });
    }

    for (const group of typeGroups) {
      if (group.count <= 0) continue;
      bars.push({
        key: group.key,
        label: group.label,
        avgCmc: Number((group.sum / group.count).toFixed(2)),
        count: group.count,
        color: group.color,
        subtitle: `Average MV across ${group.label.toLowerCase()}`,
      });
    }

    const fmt = metrics.detectedFormat;
    const goal = analysis?.goal;
    const target =
      goal === 'bracket-5'
        ? 1.85
        : goal === 'bracket-4'
        ? 2.35
        : fmt === 'legacy' || fmt === 'vintage'
        ? 1.7
        : fmt === 'commander' || fmt === 'brawl'
        ? 2.9
        : 2.25;

    return {
      averageCmcChartData: bars,
      optimizedAvgCmcNonLand: optAvg,
      formatCmcTarget: target,
    };
  }, [
    safeResolvedCards,
    optimizedExport.entries,
    metrics.averageCmcNonLand,
    metrics.averageCmcWithLands,
    metrics.detectedFormat,
    analysis?.goal,
    selectedSwapIds.size,
    selectedCutIds.size,
    selectedAddIds.size,
    selectedLandChangeIds.size,
    auditExtraSwaps.length,
  ]);

  const summaryStats = useMemo(() => {
    const totalCards = metrics.currentMainAndCommanderCount || 0;
    const landCount = metrics.currentLands || 0;
    const spellCount = Math.max(0, totalCards - landCount);
    const landPct = totalCards > 0 ? Math.round((landCount / totalCards) * 100) : 0;
    const spellPct = totalCards > 0 ? 100 - landPct : 0;

    const peakBucket = [...(metrics.curve ?? [])]
      .filter((b) => b.currentCount > 0)
      .sort((a, b) => b.currentCount - a.currentCount)[0];

    const identityColors =
      (metrics.commanderColorIdentity ?? []).length > 0
        ? metrics.commanderColorIdentity
        : (metrics.colorBreakdown ?? [])
            .filter((c) => c.status !== 'unused' && c.pips > 0)
            .map((c) => c.color);

    return {
      totalCards,
      landCount,
      spellCount,
      landPct,
      spellPct,
      peakCurveLabel: peakBucket ? `${peakBucket.cmcLabel} MV` : '—',
      peakCurveCount: peakBucket ? peakBucket.currentCount : 0,
      colorsLabel: identityColors.length > 0 ? identityColors.join(' · ') : 'Colorless',
      colorCount: identityColors.length,
      coreEngineTotal:
        (metrics.currentRamp || 0) +
        (metrics.currentDraw || 0) +
        (metrics.currentRemoval || 0),
    };
  }, [metrics]);

  const jumpToSection = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  const hasSelectedAdjustments =
    selectedSwapIds.size > 0 ||
    selectedCutIds.size > 0 ||
    selectedAddIds.size > 0 ||
    selectedLandChangeIds.size > 0 ||
    auditExtraSwaps.length > 0;

  const sectionAnchors = [
    { id: 'diagnosis-section', label: '01 Diagnosis' },
    { id: 'balance-section', label: '02 Balance' },
    { id: 'mana-section', label: '03 Mana & Curve' },
    { id: 'mana-calculator-section', label: '04 Hand Sim' },
    { id: 'synergy-audit-section', label: '05 Synergy' },
    { id: 'changes-section', label: '06 Changes' },
    { id: 'export-section', label: '07 Export' },
    { id: 'gallery-section', label: '08 Gallery' },
    { id: 'playtest-section', label: '09 Playtest' },
    { id: 'advanced-metrics-section', label: '10 Metrics' },
  ];

  return (
    <div className="mx-auto max-w-[1360px] space-y-8 px-6 py-7">
      {/* Header & Deck Identity */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <span className="capitalize font-medium text-zinc-700">{metrics.detectedFormat}</span>
            {analysis?.goal && bracketLabels[analysis.goal] && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-medium text-zinc-700">{bracketLabels[analysis.goal]}</span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span>{analysis?.archetype}</span>
            <span aria-hidden="true">·</span>
            <span>Imported via {analysis?.sourceFormat}</span>
            {(metrics.commanderNames ?? []).length > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span>Commander: {(metrics.commanderNames ?? []).join(', ')}</span>
              </>
            )}
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-zinc-900">
            {analysis?.deckName}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <ShareExportMenu
            onExportPdf={() => setIsPdfModalOpen(true)}
            onExportTxt={() => {
              const exp = buildOptimizedDeckExport(
                analysis,
                selectedSwapIds,
                selectedCutIds,
                selectedAddIds,
                selectedLandChangeIds,
                auditExtraSwaps,
                simulationExportStats,
                true
              );
              downloadDeckFile(exp.exportText, analysis?.deckName || 'deck', 'txt');
            }}
            onExportCsv={() => {
              const exp = buildOptimizedDeckExport(
                analysis,
                selectedSwapIds,
                selectedCutIds,
                selectedAddIds,
                selectedLandChangeIds,
                auditExtraSwaps,
                simulationExportStats,
                true
              );
              downloadDeckFile(exp.exportCsv, analysis?.deckName || 'deck', 'csv');
            }}
          />
          <button
            type="button"
            onClick={onSaveSnapshot}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3.5 py-2 text-xs font-medium text-zinc-800 hover:bg-zinc-50 cursor-pointer whitespace-nowrap shrink-0"
          >
            {justSavedSnapshot ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-700" />
                <span className="text-emerald-700">Saved Snapshot</span>
              </>
            ) : (
              <>
                <Save className="h-3.5 w-3.5" />
                Save Snapshot
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onOpenHistory}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3.5 py-2 text-xs font-medium text-zinc-800 hover:bg-zinc-50 cursor-pointer whitespace-nowrap shrink-0"
          >
            <History className="h-3.5 w-3.5 text-sky-700" />
            Version History ({versionCount})
          </button>
        </div>
      </div>

      {/* 4-Column KPI Summary Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-zinc-200 bg-white px-5 py-4">
          <div className="text-xs font-medium text-zinc-500">Deck Size (Updated)</div>
          <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-zinc-900">
            {optimizedExport.totalMainCount} / {metrics.targetDeckSize}
          </div>
          <div
            className={`mt-1 text-xs font-medium ${
              activeDeckDelta === 0 ? 'text-emerald-700' : 'text-amber-700'
            }`}
          >
            {deckCountStatus}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white px-5 py-4">
          <div className="text-xs font-medium text-zinc-500">Lands</div>
          <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-zinc-900">
            {metrics.currentLands} → {metrics.recommendedLands}
          </div>
          <div
            className={`mt-1 text-xs font-medium ${
              metrics.landsDelta > 0
                ? 'text-red-700'
                : metrics.landsDelta < 0
                ? 'text-amber-700'
                : 'text-emerald-700'
            }`}
          >
            {landStatusText}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white px-5 py-4">
          <div className="text-xs font-medium text-zinc-500">Ramp · Draw · Removal</div>
          <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-zinc-900">
            {metrics.currentRamp} · {metrics.currentDraw} · {metrics.currentRemoval}
          </div>
          <div className="mt-1 text-xs text-zinc-500 font-mono tabular-nums">
            Target {metrics.recommendedRamp} · {metrics.recommendedDraw} · {metrics.recommendedRemoval}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white px-5 py-4">
          <div className="text-xs font-medium text-zinc-500">Suggested Actions</div>
          <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-zinc-900">
            {(analysis?.swaps ?? []).length} swaps · {(analysis?.cuts ?? []).length} cuts
          </div>
          <div className="mt-1 text-xs text-zinc-600 font-mono tabular-nums">
            {(analysis?.additions ?? []).length} adds · {(analysis?.manaPlan?.landChanges ?? []).length} land fixes
          </div>
        </div>
      </div>

      {/* Section Quick-Jump Bar */}
      <nav
        aria-label="Report sections"
        className="flex flex-wrap items-center gap-1 rounded-xl border border-zinc-200 bg-white px-2.5 py-2"
      >
        {sectionAnchors.map((sec) => {
          const [num, ...rest] = sec.label.split(' ');
          return (
            <button
              key={sec.id}
              type="button"
              onClick={() => jumpToSection(sec.id)}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span className="font-mono text-[11px] font-semibold text-sky-700">{num}</span>
              <span>{rest.join(' ')}</span>
            </button>
          );
        })}
      </nav>

      {/* Rules / Legality / Unresolved Cards Notice */}
      {(allRulesIssues.length > 0 || (metrics.unresolvedCards ?? []).length > 0) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
            <div className="space-y-2 text-sm text-amber-950">
              {allRulesIssues.length > 0 && (
                <div>
                  <div className="font-semibold">Legality &amp; Construction Alerts</div>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-amber-900">
                    {allRulesIssues.map((issue, idx) => (
                      <li key={idx}>{issue}</li>
                    ))}
                  </ul>
                </div>
              )}
              {(metrics.unresolvedCards ?? []).length > 0 && (
                <div>
                  <div className="font-semibold">Unmatched Card Names</div>
                  <p className="mt-0.5 text-amber-900">
                    Verify spelling for: {(metrics.unresolvedCards ?? []).join(', ')}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Compact Deck Telemetry Strip */}
      <section
        aria-label="Deck Summary"
        className="grid grid-cols-2 divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white sm:grid-cols-3 lg:grid-cols-6 lg:divide-y-0 sm:divide-x"
      >
        <div className="px-4 py-3.5">
          <div className="text-[11px] font-medium text-zinc-500">Updated Cards</div>
          <div className="mt-0.5 font-mono text-xl font-bold tabular-nums text-zinc-900">
            {optimizedExport.totalMainCount}
          </div>
          <div className="mt-0.5 text-[11px] font-mono tabular-nums text-zinc-500">
            {importedChangedSize
              ? `Imported ${summaryStats.totalCards} → ${metrics.targetDeckSize}`
              : metrics.sideboardCount > 0
              ? `+${metrics.sideboardCount} sideboard`
              : `Target ${metrics.targetDeckSize}`}
          </div>
        </div>

        <div className="px-4 py-3.5">
          <div className="text-[11px] font-medium text-zinc-500">Avg Spell MV</div>
          <div className="mt-0.5 font-mono text-xl font-bold tabular-nums text-sky-700">
            {metrics.averageCmcNonLand.toFixed(2)}
          </div>
          <div className="mt-0.5 text-[11px] font-mono tabular-nums text-zinc-500">
            {metrics.averageCmcWithLands.toFixed(2)} incl. lands
          </div>
        </div>

        <div className="px-4 py-3.5">
          <div className="text-[11px] font-medium text-zinc-500">Land / Spell</div>
          <div className="mt-0.5 font-mono text-xl font-bold tabular-nums text-zinc-900">
            {summaryStats.landCount} : {summaryStats.spellCount}
          </div>
          <div className="mt-0.5 text-[11px] font-mono tabular-nums text-zinc-500">
            {summaryStats.landPct}% lands · {summaryStats.spellPct}% spells
          </div>
        </div>

        <div className="px-4 py-3.5">
          <div className="text-[11px] font-medium text-zinc-500">Curve Peak</div>
          <div className="mt-0.5 font-mono text-xl font-bold tabular-nums text-zinc-900">
            {summaryStats.peakCurveLabel}
          </div>
          <div className="mt-0.5 text-[11px] font-mono tabular-nums text-zinc-500">
            {summaryStats.peakCurveCount > 0
              ? `${summaryStats.peakCurveCount} spells at peak`
              : 'No spell data'}
          </div>
        </div>

        <div className="px-4 py-3.5">
          <div className="text-[11px] font-medium text-zinc-500">Color Identity</div>
          <div className="mt-0.5 font-mono text-lg font-bold tabular-nums text-zinc-900 truncate">
            {summaryStats.colorsLabel}
          </div>
          <div className="mt-0.5 text-[11px] text-zinc-500">
            {summaryStats.colorCount === 0
              ? 'Colorless build'
              : `${summaryStats.colorCount}-color mana`}
          </div>
        </div>

        <div className="px-4 py-3.5">
          <div className="text-[11px] font-medium text-zinc-500">Engine Mix</div>
          <div className="mt-0.5 font-mono text-xl font-bold tabular-nums text-zinc-900">
            {summaryStats.coreEngineTotal}
          </div>
          <div className="mt-0.5 text-[11px] font-mono tabular-nums text-zinc-500">
            {metrics.currentRamp}R · {metrics.currentDraw}D · {metrics.currentRemoval}I
          </div>
        </div>
      </section>

      {/* 01. Deck Diagnosis */}
      <section id="diagnosis-section" className="space-y-4 scroll-mt-20">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-display text-xl font-bold text-zinc-900">
              01. Deck Diagnosis
            </h2>
            <p className="mt-0.5 text-sm text-zinc-600">
              <span className="capitalize font-medium text-zinc-800">{metrics.detectedFormat}</span>{' '}
              · {analysis?.archetype} ·{' '}
              <span className={metrics.landsDelta === 0 ? 'text-emerald-700 font-medium' : 'text-amber-700 font-medium'}>
                {landStatusText}
              </span>
            </p>
          </div>
          <span className="font-mono text-xs tabular-nums text-zinc-500">
            {summaryStats.totalCards} cards analyzed
          </span>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-6">
          <h3 className="font-display text-lg font-semibold text-zinc-900">
            {analysis?.verdictHeadline}
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-zinc-700 max-w-4xl">
            {analysis?.verdictSummary}
          </p>

          {(analysis?.topPriorities ?? []).length > 0 && (
            <div className="mt-5 border-t border-zinc-100 pt-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Top Priorities
              </div>
              <ol className="mt-2.5 grid grid-cols-1 gap-4 md:grid-cols-3">
                {(analysis?.topPriorities ?? []).map((priority, idx) => (
                  <li key={idx} className="text-sm leading-snug text-zinc-700">
                    <span className="font-mono font-semibold text-sky-700 mr-1.5">
                      0{idx + 1}.
                    </span>
                    {priority}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </section>

      {/* 02. Composition & Balance */}
      <section id="balance-section" className="space-y-5 scroll-mt-20">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-display text-xl font-bold text-zinc-900">
              02. Composition &amp; Balance
            </h2>
            <p className="mt-0.5 text-sm text-zinc-600">
              {summaryStats.landCount} lands vs. {summaryStats.spellCount} spells · Avg MV{' '}
              <span className="font-mono font-semibold tabular-nums text-zinc-800">
                {metrics.averageCmcNonLand.toFixed(2)}
              </span>{' '}
              (target ≤ {formatCmcTarget.toFixed(2)}) · {metrics.currentRamp} ramp, {metrics.currentDraw} draw, {metrics.currentRemoval} removal.
            </p>
          </div>
        </div>

        <LandSpellGauge
          metrics={metrics}
          optimizedLands={optimizedExport.resultingLandCount}
          optimizedTotal={optimizedExport.totalMainCount}
        />

        <Suspense fallback={<PanelFallback heightClass="h-72" />}>
          <DeckStatsCard
            metrics={metrics}
            resolvedCards={safeResolvedCards}
          />
        </Suspense>

        {/* Average Converted Mana Cost (CMC) Bar Chart */}
        <div className="rounded-xl border border-zinc-200 bg-white p-6">
          <div className="flex flex-col gap-3 border-b border-zinc-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-display text-base font-semibold text-zinc-900">
                Average Mana Value by Card Type
              </h3>
              <p className="mt-0.5 text-xs text-zinc-500">
                Spell average ({metrics.averageCmcNonLand.toFixed(2)}) vs. format target (≤ {formatCmcTarget.toFixed(2)})
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 font-mono text-xs tabular-nums">
              <span className="text-zinc-600">
                Spells:{' '}
                <span className="font-semibold text-zinc-900">
                  {metrics.averageCmcNonLand.toFixed(2)}
                </span>
              </span>
              <span className="text-zinc-300" aria-hidden="true">·</span>
              <span className="text-zinc-600">
                With Lands:{' '}
                <span className="font-semibold text-zinc-900">
                  {metrics.averageCmcWithLands.toFixed(2)}
                </span>
              </span>
              {optimizedAvgCmcNonLand !== metrics.averageCmcNonLand && (
                <>
                  <span className="text-zinc-300" aria-hidden="true">·</span>
                  <span className="text-sky-700">
                    With Fixes:{' '}
                    <span className="font-semibold">{optimizedAvgCmcNonLand.toFixed(2)}</span>
                  </span>
                </>
              )}
              <span className="text-zinc-300" aria-hidden="true">·</span>
              <span className="text-zinc-500">
                Format Target ≤ {formatCmcTarget.toFixed(2)}
              </span>
            </div>
          </div>

          <div className="mt-4 h-[240px] w-full">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart
                data={averageCmcChartData}
                margin={{ top: 22, right: 12, left: -14, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#2C3444" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: '#E4E4E7', fontWeight: 500 }}
                  axisLine={{ stroke: '#3B4458' }}
                  tickLine={false}
                  interval="preserveStartEnd"
                  minTickGap={4}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#94A3B8' }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals
                  domain={[0, (dataMax: number) => Math.max(4, Math.ceil(dataMax + 0.6))]}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(41, 171, 226, 0.10)' }}
                  content={<AverageCmcTooltip />}
                />
                <ReferenceLine
                  y={formatCmcTarget}
                  stroke="#F59E0B"
                  strokeDasharray="4 4"
                  label={{
                    value: `Target ${formatCmcTarget.toFixed(2)}`,
                    position: 'insideTopRight',
                    fill: '#FBBF24',
                    fontSize: 11,
                    fontFamily: 'JetBrains Mono, monospace',
                  }}
                />
                <Bar dataKey="avgCmc" name="Average CMC" radius={[4, 4, 0, 0]} maxBarSize={42}>
                  {averageCmcChartData.map((entry) => (
                    <Cell key={entry.key} fill={entry.color} />
                  ))}
                  <LabelList
                    dataKey="avgCmc"
                    position="top"
                    formatter={(val: unknown) => Number(val).toFixed(2)}
                    style={{
                      fill: '#E4E4E7',
                      fontSize: 11,
                      fontWeight: 600,
                      fontFamily: 'JetBrains Mono, monospace',
                    }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <Suspense fallback={<PanelFallback heightClass="h-80" />}>
          <DeckRadarChart
            metrics={metrics}
            resolvedCards={safeResolvedCards}
          />
        </Suspense>

        <DeckBudgetComparison
          analysis={analysis}
          selectedSwapIds={selectedSwapIds}
          selectedCutIds={selectedCutIds}
          selectedAddIds={selectedAddIds}
          selectedLandChangeIds={selectedLandChangeIds}
          extraSwaps={auditExtraSwaps}
          onInspectCard={onInspectCard}
        />
      </section>

      {/* 03. Mana Base & Curve */}
      <ManaBreakdown
        metrics={metrics}
        manaPlan={analysis?.manaPlan}
        resolvedCards={safeResolvedCards}
        optimizedEntries={optimizedExport.entries}
        selectedLandChangeIds={selectedLandChangeIds}
        onToggleLandChange={(id) => toggleSelectionKey('landChangeIds', id)}
        onInspectCard={onInspectCard}
        manaOptimizedLandCount={manaOptimizedExport.resultingLandCount}
        isPlaytestManaSynced={playtestDeckVersion === 'mana-optimized'}
        onSelectAllLandChanges={handleSelectAllLandChanges}
        onSyncManaToPlaytest={handleSyncManaToPlaytest}
      />

      {/* 04. Opening Hand & Mana Simulator */}
      <ManaCalculator
        deckName={analysis?.deckName || 'Deck'}
        resolvedCards={safeResolvedCards}
        optimizedEntries={optimizedExport.entries}
        colorBreakdown={metrics.colorBreakdown ?? EMPTY_COLOR_BREAKDOWN}
        onInspectCard={onInspectCard}
        onSyncManaToPlaytest={handleSyncManaToPlaytest}
        isPlaytestManaSynced={playtestDeckVersion === 'mana-optimized'}
      />

      {/* 05. Synergy & Color Audit */}
      <SynergyAuditPanel
        analysis={analysis}
        selectedSwapIds={selectedSwapIds}
        selectedCutIds={selectedCutIds}
        selectedAddIds={selectedAddIds}
        selectedLandChangeIds={selectedLandChangeIds}
        extraSwaps={auditExtraSwaps}
        onToggleSwap={(id) => toggleSelectionKey('swapIds', id)}
        onToggleCut={(id) => toggleSelectionKey('cutIds', id)}
        onToggleAuditSwap={handleToggleAuditSwap}
        onClearAuditSwaps={() => setAuditExtraSwaps([])}
        onInspectCard={onInspectCard}
      />

      {/* 06. Card Swaps, Cuts & Additions */}
      <CardChangesPanel
        swaps={analysis?.swaps || []}
        cuts={analysis?.cuts || []}
        additions={analysis?.additions || []}
        selectedSwapIds={selectedSwapIds}
        selectedCutIds={selectedCutIds}
        selectedAddIds={selectedAddIds}
        onToggleSwap={(id) => toggleSelectionKey('swapIds', id)}
        onToggleCut={(id) => toggleSelectionKey('cutIds', id)}
        onToggleAdd={(id) => toggleSelectionKey('addIds', id)}
        onSelectAllChanges={handleSelectAllChanges}
        onInspectCard={onInspectCard}
      />

      {/* 07. Optimized Decklist & Export */}
      <OptimizedExportPanel
        analysis={analysis}
        selectedSwapIds={selectedSwapIds}
        selectedCutIds={selectedCutIds}
        selectedAddIds={selectedAddIds}
        selectedLandChangeIds={selectedLandChangeIds}
        extraSwaps={auditExtraSwaps}
        simulationStats={simulationExportStats}
        onReanalyzeUpdated={onReanalyzeUpdated}
        onAutoBalanceSelection={handleAutoBalanceSelection}
        onSaveSnapshot={onSaveSnapshot}
        onOpenHistory={onOpenHistory}
        onOpenPdfReport={() => setIsPdfModalOpen(true)}
        versionCount={versionCount}
        justSavedSnapshot={justSavedSnapshot}
      />

      {/* 08. Visual Card Gallery & Marketplace Prices */}
      <Suspense fallback={<PanelFallback heightClass="h-80" />}>
        <CardGalleryPanel
          analysis={analysis}
          onInspectCard={onInspectCard}
        />
      </Suspense>

      {/* 09. Bot Match Simulator & Round-by-Round Analyzer */}
      <Suspense fallback={<PanelFallback heightClass="h-96" />}>
        <PlaytestArena
          analysis={analysis}
          optimizedDeckText={optimizedExport.exportText}
          manaOptimizedDeckText={manaOptimizedExport.exportText}
          manaOptimizedLandCount={manaOptimizedExport.resultingLandCount}
          selectedLandChangesCount={selectedLandChangeIds.size}
          totalLandChangesCount={(analysis?.manaPlan?.landChanges ?? []).length}
          deckVersion={playtestDeckVersion}
          onDeckVersionChange={setPlaytestDeckVersion}
          manaSyncNonce={manaSyncNonce}
          onApplyAllManaFixes={handleApplyAllManaFixes}
          onInspectCard={onInspectCard}
          botMemory={botMemory}
          onSaveBotMemoryProfiles={onSaveBotMemoryProfiles}
          onResetBotMemory={onResetBotMemory}
          onPlaytestResultChange={setLatestPlaytestResult}
          onLiveStatsChange={setLiveSimStats}
        />
      </Suspense>

      {/* 10. Advanced Deck Metrics (Mana Curve, Color Identity & Role CMC) */}
      <Suspense fallback={<PanelFallback heightClass="h-96" />}>
        <AdvancedDeckMetrics
          analysis={analysis}
          resolvedCards={safeResolvedCards}
          optimizedEntries={optimizedExport.entries}
          hasSelectedAdjustments={hasSelectedAdjustments}
          onInspectCard={onInspectCard}
        />
      </Suspense>

      {/* PDF Report & Print Dossier Modal */}
      {isPdfModalOpen && (
        <Suspense fallback={null}>
          <DeckPdfReportModal
            isOpen={isPdfModalOpen}
            onClose={() => setIsPdfModalOpen(false)}
            analysis={analysis}
            selectedSwapIds={selectedSwapIds}
            selectedCutIds={selectedCutIds}
            selectedAddIds={selectedAddIds}
            selectedLandChangeIds={selectedLandChangeIds}
            extraSwaps={auditExtraSwaps}
            simulationStats={simulationExportStats}
          />
        </Suspense>
      )}
    </div>
  );
};
