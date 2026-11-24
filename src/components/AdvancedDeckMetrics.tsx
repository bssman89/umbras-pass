import React, { useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  CardMetadata,
  DeckAnalysisResult,
  ManaColor,
  ResolvedDeckCard,
} from '../types/deck';
import type { ExportDeckEntry } from '../utils/deckExport';

interface AdvancedDeckMetricsProps {
  analysis: DeckAnalysisResult;
  resolvedCards: ResolvedDeckCard[];
  optimizedEntries: ExportDeckEntry[];
  hasSelectedAdjustments: boolean;
  onInspectCard: (name: string, meta?: CardMetadata | null) => void;
  embedded?: boolean;
}

const MTG_COLOR_META: Record<
  ManaColor,
  { name: string; fill: string }
> = {
  W: { name: 'White', fill: '#E2E8F0' },
  U: { name: 'Blue', fill: '#29ABE2' },
  B: { name: 'Black', fill: '#A855F7' },
  R: { name: 'Red', fill: '#E53924' },
  G: { name: 'Green', fill: '#22C55E' },
  C: { name: 'Colorless', fill: '#64748B' },
};

const MULTICOLOR_FILL = '#F59E0B';

const COLOR_COMBINATION_NAMES: Record<string, string> = {
  '': 'Colorless',
  W: 'Mono-White',
  U: 'Mono-Blue',
  B: 'Mono-Black',
  R: 'Mono-Red',
  G: 'Mono-Green',
  WU: 'Azorius',
  UB: 'Dimir',
  BR: 'Rakdos',
  RG: 'Gruul',
  WG: 'Selesnya',
  WB: 'Orzhov',
  UR: 'Izzet',
  BG: 'Golgari',
  WR: 'Boros',
  UG: 'Simic',
  WUB: 'Esper',
  UBR: 'Grixis',
  BRG: 'Jund',
  WRG: 'Naya',
  WUG: 'Bant',
  WBG: 'Abzan',
  WUR: 'Jeskai',
  UBG: 'Sultai',
  WBR: 'Mardu',
  URG: 'Temur',
  WUBR: 'Yore-Tiller (4C)',
  UBRG: 'Glint-Eye (4C)',
  WBRG: 'Dune-Brood (4C)',
  WURG: 'Ink-Treader (4C)',
  WUBG: 'Witch-Maw (4C)',
  WUBRG: 'Five-Color (WUBRG)',
};

function getColorIdentityName(colors: string[]): string {
  const order = ['W', 'U', 'B', 'R', 'G'];
  const normalized = order.filter((c) =>
    colors.some((raw) => raw.toUpperCase() === c)
  );
  const key = normalized.join('');
  return COLOR_COMBINATION_NAMES[key] || (key ? `${normalized.length}-Color (${key})` : 'Colorless');
}

function getBucketIndex(cmc: number): number {
  const floored = Math.max(0, Math.floor(Number.isFinite(cmc) ? cmc : 0));
  return Math.min(7, floored);
}

const BUCKET_LABELS = ['0', '1', '2', '3', '4', '5', '6', '7+'];

interface CurveBucketDatum {
  bucketIdx: number;
  cmcLabel: string;
  creatures: number;
  instantsSorceries: number;
  otherNonlands: number;
  totalCurrent: number;
  totalOptimized: number;
  cumulativePct: number;
  cards: Array<{ name: string; qty: number; cmc: number; meta: CardMetadata | null }>;
}

interface ColorIdentitySlice {
  key: string;
  label: string;
  value: number;
  pct: number;
  fill: string;
  subDetail: string;
}

interface RoleCmcDatum {
  key: string;
  label: string;
  avgCmc: number;
  minCmc: number;
  maxCmc: number;
  count: number;
  fill: string;
  detail: string;
}

const CurveTooltip: React.FC<{
  active?: boolean;
  payload?: Array<{ payload: CurveBucketDatum }>;
  curveMode: 'stacked' | 'compare';
}> = ({ active, payload, curveMode }) => {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3.5 py-2.5 text-xs shadow-lg">
      <div className="flex items-center justify-between gap-4 font-semibold text-zinc-900">
        <span>Mana Value {d.cmcLabel}</span>
        <span className="font-mono tabular-nums text-sky-700">
          {d.cumulativePct}% cumulative
        </span>
      </div>
      <div className="mt-1.5 space-y-1 font-mono tabular-nums text-zinc-700">
        {curveMode === 'stacked' ? (
          <>
            <div className="flex items-center justify-between gap-4">
              <span className="text-emerald-700">Creatures</span>
              <span className="font-semibold text-zinc-900">{d.creatures}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-sky-700">Instants &amp; Sorceries</span>
              <span className="font-semibold text-zinc-900">{d.instantsSorceries}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-amber-700">Artifacts / Ench / PW</span>
              <span className="font-semibold text-zinc-900">{d.otherNonlands}</span>
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-zinc-100 pt-1">
              <span className="text-zinc-500">Total Spells</span>
              <span className="font-bold text-zinc-900">{d.totalCurrent}</span>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between gap-4">
              <span className="text-zinc-500">Original Deck</span>
              <span className="font-semibold text-zinc-900">{d.totalCurrent}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-sky-700">With Selected Fixes</span>
              <span className="font-semibold text-sky-700">{d.totalOptimized}</span>
            </div>
          </>
        )}
      </div>
      <div className="mt-1.5 text-[11px] text-zinc-500">
        Click bar to inspect cards at MV {d.cmcLabel}
      </div>
    </div>
  );
};

const IdentityPieTooltip: React.FC<{
  active?: boolean;
  payload?: Array<{ payload: ColorIdentitySlice }>;
}> = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0].payload;
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3.5 py-2.5 text-xs shadow-lg">
      <div className="flex items-center gap-2 font-semibold text-zinc-900">
        <span
          className="h-2.5 w-2.5 rounded-sm shrink-0"
          style={{ backgroundColor: item.fill }}
          aria-hidden="true"
        />
        <span>{item.label}</span>
      </div>
      <div className="mt-1.5 font-mono tabular-nums text-zinc-700">
        <span className="font-bold text-zinc-900">{item.value}</span> ({item.pct}%)
      </div>
      <div className="mt-0.5 text-[11px] text-zinc-500">{item.subDetail}</div>
    </div>
  );
};

const RoleCmcTooltip: React.FC<{
  active?: boolean;
  payload?: Array<{ payload: RoleCmcDatum }>;
}> = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0].payload;
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3.5 py-2.5 text-xs shadow-lg">
      <div className="flex items-center gap-2 font-semibold text-zinc-900">
        <span
          className="h-2.5 w-2.5 rounded-sm shrink-0"
          style={{ backgroundColor: item.fill }}
          aria-hidden="true"
        />
        <span>{item.label}</span>
      </div>
      <div className="mt-1.5 space-y-0.5 font-mono tabular-nums text-zinc-700">
        <div>
          Avg CMC: <span className="font-bold text-zinc-900">{item.avgCmc.toFixed(2)}</span>
        </div>
        <div>
          Range: <span className="text-zinc-900">{item.minCmc} – {item.maxCmc} MV</span>
        </div>
        <div>
          Cards: <span className="text-zinc-900">{item.count}</span>
        </div>
      </div>
      <div className="mt-1 text-[11px] text-zinc-500">{item.detail}</div>
    </div>
  );
};

export const AdvancedDeckMetrics: React.FC<AdvancedDeckMetricsProps> = ({
  analysis,
  resolvedCards,
  optimizedEntries,
  hasSelectedAdjustments,
  onInspectCard,
  embedded = false,
}) => {
  const [curveMode, setCurveMode] = useState<'stacked' | 'compare'>('stacked');
  const [identityMode, setIdentityMode] = useState<'cards' | 'pips'>('cards');
  const [selectedBucketIdx, setSelectedBucketIdx] = useState<number | null>(null);

  const metrics = analysis.metrics;

  const computed = useMemo(() => {
    const mainAndCmd = resolvedCards.filter(
      (c) => c.zone === 'main' || c.zone === 'commander'
    );

    const buckets: CurveBucketDatum[] = BUCKET_LABELS.map((label, idx) => ({
      bucketIdx: idx,
      cmcLabel: label,
      creatures: 0,
      instantsSorceries: 0,
      otherNonlands: 0,
      totalCurrent: 0,
      totalOptimized: 0,
      cumulativePct: 0,
      cards: [],
    }));

    const spellCmcs: number[] = [];
    let totalSpellManaWeight = 0;
    let totalSpells = 0;
    let earlySpellsCount = 0; // MV 0-2
    let midSpellsCount = 0; // MV 3-4
    let lateSpellsCount = 0; // MV 5+

    // Color identity card distribution across non-land spells
    const cardColorCounts: Record<string, number> = {
      W: 0,
      U: 0,
      B: 0,
      R: 0,
      G: 0,
      M: 0,
      C: 0,
    };

    const roleBuckets: Record<
      string,
      { label: string; fill: string; detail: string; sum: number; count: number; min: number; max: number }
    > = {
      ramp: { label: 'Ramp', fill: '#22C55E', detail: 'Mana rocks, dorks & land tutors', sum: 0, count: 0, min: Infinity, max: 0 },
      draw: { label: 'Card Draw', fill: '#29ABE2', detail: 'Card advantage & cantrips', sum: 0, count: 0, min: Infinity, max: 0 },
      removal: { label: 'Removal', fill: '#E53924', detail: 'Spot removal & countermagic', sum: 0, count: 0, min: Infinity, max: 0 },
      wipes: { label: 'Board Wipes', fill: '#A855F7', detail: 'Mass removal & sweepers', sum: 0, count: 0, min: Infinity, max: 0 },
      creatures: { label: 'Creatures', fill: '#10B981', detail: 'All creature spells', sum: 0, count: 0, min: Infinity, max: 0 },
      noncreature: { label: 'Non-Creature', fill: '#F59E0B', detail: 'Instants, sorceries, artifacts, ench, PW', sum: 0, count: 0, min: Infinity, max: 0 },
    };

    const pushRole = (key: keyof typeof roleBuckets, cmc: number, qty: number) => {
      const target = roleBuckets[key];
      target.sum += cmc * qty;
      target.count += qty;
      target.min = Math.min(target.min, cmc);
      target.max = Math.max(target.max, cmc);
    };

    for (const entry of mainAndCmd) {
      const qty = Math.max(1, entry.quantity || 1);
      const meta = entry.card;
      const frontType = (meta?.typeLine || '').split('//')[0] || '';
      const isLand = Boolean(meta?.isLand) || /\bland\b/i.test(frontType);
      if (isLand) continue;

      const cmc = Number.isFinite(meta?.cmc) ? Number(meta?.cmc) : 0;
      const bIdx = getBucketIndex(cmc);
      const isCreature = /\bcreature\b/i.test(frontType);
      const isInstantOrSorcery = /\b(instant|sorcery)\b/i.test(frontType);

      totalSpells += qty;
      totalSpellManaWeight += cmc * qty;
      for (let i = 0; i < qty; i++) spellCmcs.push(cmc);

      if (cmc <= 2) earlySpellsCount += qty;
      else if (cmc <= 4) midSpellsCount += qty;
      else lateSpellsCount += qty;

      if (isCreature) {
        buckets[bIdx].creatures += qty;
        pushRole('creatures', cmc, qty);
      } else if (isInstantOrSorcery) {
        buckets[bIdx].instantsSorceries += qty;
        pushRole('noncreature', cmc, qty);
      } else {
        buckets[bIdx].otherNonlands += qty;
        pushRole('noncreature', cmc, qty);
      }

      if (meta?.isRamp) pushRole('ramp', cmc, qty);
      if (meta?.isDraw) pushRole('draw', cmc, qty);
      if (meta?.isRemoval) pushRole('removal', cmc, qty);
      if (meta?.isBoardWipe) pushRole('wipes', cmc, qty);

      buckets[bIdx].totalCurrent += qty;
      buckets[bIdx].cards.push({
        name: entry.name,
        qty,
        cmc,
        meta,
      });

      // Card color identity bucket (W/U/B/R/G vs Multicolor vs Colorless)
      const ci = (meta?.colorIdentity && meta.colorIdentity.length > 0
        ? meta.colorIdentity
        : meta?.colors || []
      )
        .map((c) => c.toUpperCase())
        .filter((c) => ['W', 'U', 'B', 'R', 'G'].includes(c));
      const uniqueCi = Array.from(new Set(ci));

      if (uniqueCi.length === 0) {
        cardColorCounts.C += qty;
      } else if (uniqueCi.length === 1) {
        cardColorCounts[uniqueCi[0]] += qty;
      } else {
        cardColorCounts.M += qty;
      }
    }

    // Optimized mana curve overlay
    let optSpells = 0;
    let optCmcSum = 0;
    for (const entry of optimizedEntries) {
      if (entry.zone === 'Sideboard' || entry.zone === 'Companion' || entry.isLand) continue;
      const qty = Math.max(1, entry.qty || 1);
      const cmc = Number.isFinite(entry.meta?.cmc) ? Number(entry.meta?.cmc) : 0;
      const bIdx = getBucketIndex(cmc);
      buckets[bIdx].totalOptimized += qty;
      optSpells += qty;
      optCmcSum += cmc * qty;
    }

    // Compute cumulative percentage curve
    let runningSpells = 0;
    for (const b of buckets) {
      runningSpells += b.totalCurrent;
      b.cumulativePct = totalSpells > 0 ? Math.round((runningSpells / totalSpells) * 100) : 0;
      b.cards.sort((a, bCard) => a.cmc - bCard.cmc || a.name.localeCompare(bCard.name));
    }

    // Median CMC
    spellCmcs.sort((a, b) => a - b);
    let medianCmc = 0;
    if (spellCmcs.length > 0) {
      const mid = Math.floor(spellCmcs.length / 2);
      medianCmc =
        spellCmcs.length % 2 === 1
          ? spellCmcs[mid]
          : (spellCmcs[mid - 1] + spellCmcs[mid]) / 2;
    }

    const avgSpellCmc =
      totalSpells > 0 ? totalSpellManaWeight / totalSpells : metrics.averageCmcNonLand;
    const optimizedAvgCmc =
      optSpells > 0 ? optCmcSum / optSpells : avgSpellCmc;

    // Color Identity slices (by card count)
    const cardIdentitySlices: ColorIdentitySlice[] = [];
    const orderKeys: Array<{ key: string; label: string; fill: string; subDetail: string }> = [
      { key: 'W', label: 'White', fill: MTG_COLOR_META.W.fill, subDetail: 'Mono-white identity spells' },
      { key: 'U', label: 'Blue', fill: MTG_COLOR_META.U.fill, subDetail: 'Mono-blue identity spells' },
      { key: 'B', label: 'Black', fill: MTG_COLOR_META.B.fill, subDetail: 'Mono-black identity spells' },
      { key: 'R', label: 'Red', fill: MTG_COLOR_META.R.fill, subDetail: 'Mono-red identity spells' },
      { key: 'G', label: 'Green', fill: MTG_COLOR_META.G.fill, subDetail: 'Mono-green identity spells' },
      { key: 'M', label: 'Multicolor', fill: MULTICOLOR_FILL, subDetail: 'Spells with 2+ colors in identity' },
      { key: 'C', label: 'Colorless', fill: MTG_COLOR_META.C.fill, subDetail: 'Artifacts & colorless spells' },
    ];
    for (const spec of orderKeys) {
      const count = cardColorCounts[spec.key] || 0;
      if (count <= 0) continue;
      cardIdentitySlices.push({
        key: spec.key,
        label: spec.label,
        value: count,
        pct: totalSpells > 0 ? Math.round((count / totalSpells) * 100) : 0,
        fill: spec.fill,
        subDetail: spec.subDetail,
      });
    }

    // Color Identity slices (by mana pip demand)
    const activeColorBreakdown = (metrics.colorBreakdown || []).filter(
      (c) => c.status !== 'unused' && c.pips > 0
    );
    const totalPips = activeColorBreakdown.reduce((sum, c) => sum + c.pips, 0);
    const pipIdentitySlices: ColorIdentitySlice[] = activeColorBreakdown
      .slice()
      .sort((a, b) => b.pips - a.pips)
      .map((c) => ({
        key: c.color,
        label: c.label,
        value: c.pips,
        pct: totalPips > 0 ? Math.round((c.pips / totalPips) * 100) : c.pipSharePct,
        fill: MTG_COLOR_META[c.color]?.fill || '#64748B',
        subDetail: `${c.currentSources} mana sources (rec. ${c.recommendedSources})`,
      }));

    // Role Average CMC bars
    const roleCmcData: RoleCmcDatum[] = [
      {
        key: 'all-spells',
        label: 'All Spells',
        avgCmc: Number(avgSpellCmc.toFixed(2)),
        minCmc: spellCmcs.length > 0 ? spellCmcs[0] : 0,
        maxCmc: spellCmcs.length > 0 ? spellCmcs[spellCmcs.length - 1] : 0,
        count: totalSpells,
        fill: '#29ABE2',
        detail: 'Baseline non-land average mana value',
      },
      {
        key: 'with-lands',
        label: 'With Lands',
        avgCmc: Number((metrics.averageCmcWithLands || 0).toFixed(2)),
        minCmc: 0,
        maxCmc: spellCmcs.length > 0 ? spellCmcs[spellCmcs.length - 1] : 0,
        count: metrics.currentMainAndCommanderCount || totalSpells,
        fill: '#64748B',
        detail: 'Full deck average including 0-MV lands',
      },
    ];

    if (hasSelectedAdjustments) {
      roleCmcData.push({
        key: 'optimized',
        label: 'With Fixes',
        avgCmc: Number(optimizedAvgCmc.toFixed(2)),
        minCmc: 0,
        maxCmc: spellCmcs.length > 0 ? spellCmcs[spellCmcs.length - 1] : 0,
        count: optSpells,
        fill: '#38BDF8',
        detail: 'Projected average after selected swaps/cuts/adds',
      });
    }

    for (const [key, rb] of Object.entries(roleBuckets)) {
      if (rb.count <= 0) continue;
      roleCmcData.push({
        key,
        label: rb.label,
        avgCmc: Number((rb.sum / rb.count).toFixed(2)),
        minCmc: rb.min === Infinity ? 0 : rb.min,
        maxCmc: rb.max,
        count: rb.count,
        fill: rb.fill,
        detail: rb.detail,
      });
    }

    const identityColors =
      (metrics.commanderColorIdentity || []).length > 0
        ? metrics.commanderColorIdentity
        : activeColorBreakdown.map((c) => c.color);
    const identityName = getColorIdentityName(identityColors);

    const fmt = metrics.detectedFormat;
    const goal = analysis.goal;
    const formatTargetCmc =
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
      buckets,
      totalSpells,
      totalSpellManaWeight,
      avgSpellCmc,
      optimizedAvgCmc,
      medianCmc,
      earlySpellsCount,
      earlySpellsPct: totalSpells > 0 ? Math.round((earlySpellsCount / totalSpells) * 100) : 0,
      midSpellsCount,
      lateSpellsCount,
      cardIdentitySlices,
      pipIdentitySlices,
      totalPips,
      roleCmcData,
      identityName,
      identityColors,
      formatTargetCmc,
    };
  }, [
    resolvedCards,
    optimizedEntries,
    hasSelectedAdjustments,
    metrics,
    analysis.goal,
  ]);

  const activeIdentitySlices =
    identityMode === 'cards' ? computed.cardIdentitySlices : computed.pipIdentitySlices;
  const activeIdentityTotal =
    identityMode === 'cards' ? computed.totalSpells : computed.totalPips;
  const selectedBucket =
    selectedBucketIdx !== null ? computed.buckets[selectedBucketIdx] : null;

  const avgBucketLabel = BUCKET_LABELS[getBucketIndex(Math.round(computed.avgSpellCmc))];

  const Wrapper: React.ElementType = embedded ? 'div' : 'section';

  return (
    <Wrapper id={embedded ? undefined : 'advanced-metrics-section'} className={embedded ? 'space-y-5' : 'space-y-5 scroll-mt-20'}>
      {/* Section Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          {!embedded && (
            <h2 className="font-display text-xl font-bold text-zinc-900 flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-sky-700 shrink-0" />
              <span>Deep Metrics</span>
            </h2>
          )}
          <p className={embedded ? 'text-sm text-zinc-600' : 'mt-0.5 text-sm text-zinc-600'}>
            Inspect your full mana curve, color breakdown, and average mana cost across each deck role.
          </p>
        </div>
        <div className="font-mono text-xs tabular-nums text-zinc-500 whitespace-nowrap shrink-0">
          {computed.identityName}
          <span className="mx-1.5 text-zinc-300" aria-hidden="true">·</span>
          {computed.totalSpells} non-land spells
        </div>
      </div>

      {/* Top Advanced Metric Summary Strip */}
      <div className="grid grid-cols-2 divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white sm:grid-cols-4 sm:divide-y-0 sm:divide-x">
        <div className="px-5 py-4">
          <div className="text-xs font-medium text-zinc-500">Average &amp; Median Cost</div>
          <div className="mt-1 flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-2xl font-bold text-sky-700">
              {computed.avgSpellCmc.toFixed(2)}
            </span>
            <span className="text-xs text-zinc-500">
              / median {computed.medianCmc.toFixed(1)}
            </span>
          </div>
          <div className="mt-1 font-mono text-xs tabular-nums text-zinc-500">
            With lands {metrics.averageCmcWithLands.toFixed(2)} · Target ≤ {computed.formatTargetCmc.toFixed(2)}
          </div>
        </div>

        <div className="px-5 py-4">
          <div className="text-xs font-medium text-zinc-500">Total Deck Mana</div>
          <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-zinc-900">
            {computed.totalSpellManaWeight} MV
          </div>
          <div className="mt-1 font-mono text-xs tabular-nums text-zinc-500">
            Combined cost of all {computed.totalSpells} spells
          </div>
        </div>

        <div className="px-5 py-4">
          <div className="text-xs font-medium text-zinc-500">Early Plays (0–2 Mana)</div>
          <div className="mt-1 flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-2xl font-bold text-emerald-700">
              {computed.earlySpellsPct}%
            </span>
            <span className="text-xs text-zinc-500">
              ({computed.earlySpellsCount} spells)
            </span>
          </div>
          <div className="mt-1 font-mono text-xs tabular-nums text-zinc-500">
            Mid (3–4): {computed.midSpellsCount} · Late (5+): {computed.lateSpellsCount}
          </div>
        </div>

        <div className="px-5 py-4">
          <div className="text-xs font-medium text-zinc-500">Color Identity</div>
          <div className="mt-1 font-display text-lg font-bold text-zinc-900 truncate">
            {computed.identityName}
          </div>
          <div className="mt-1 font-mono text-xs tabular-nums text-zinc-500">
            {computed.totalPips} colored mana symbols
            {computed.identityColors.length > 0
              ? ` · ${computed.identityColors.join('/')}`
              : ''}
          </div>
        </div>
      </div>

      {/* Main Charts Row: Mana Curve Distribution + Color Identity Breakdown */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.35fr_1fr]">
        {/* Card 1: Advanced Mana Curve Distribution */}
        <div className="rounded-xl border border-zinc-200 bg-white p-6 flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-100 pb-4">
              <div>
                <h3 className="font-display text-base font-semibold text-zinc-900">
                  Mana Curve &amp; Castability
                </h3>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Spell count at each mana value alongside cumulative playability. Click any bar to view those cards.
                </p>
              </div>

              <div className="inline-flex items-center gap-1 rounded-xl bg-zinc-100 p-1.5">
                <button
                  type="button"
                  onClick={() => setCurveMode('stacked')}
                  className={`min-h-[36px] px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    curveMode === 'stacked'
                      ? 'bg-white text-zinc-900 shadow-sm'
                      : 'text-zinc-600 hover:text-zinc-900'
                  }`}
                >
                  By Type
                </button>
                <button
                  type="button"
                  onClick={() => setCurveMode('compare')}
                  className={`min-h-[36px] px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    curveMode === 'compare'
                      ? 'bg-white text-zinc-900 shadow-sm'
                      : 'text-zinc-600 hover:text-zinc-900'
                  }`}
                >
                  Original vs. Fixes
                </button>
              </div>
            </div>

            <div className="mt-4 h-[270px] w-full">
              <ResponsiveContainer width="100%" height={270}>
                <ComposedChart
                  data={computed.buckets}
                  margin={{ top: 16, right: 8, left: -16, bottom: 4 }}
                  onClick={(state) => {
                    const idx =
                      typeof state?.activeTooltipIndex === 'number'
                        ? state.activeTooltipIndex
                        : null;
                    if (idx !== null && idx >= 0 && idx < computed.buckets.length) {
                      setSelectedBucketIdx((prev) => (prev === idx ? null : idx));
                    }
                  }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#2C3444" vertical={false} />
                  <XAxis
                    dataKey="cmcLabel"
                    tick={{ fontSize: 11, fill: '#E4E4E7', fontWeight: 600 }}
                    axisLine={{ stroke: '#3B4458' }}
                    tickLine={false}
                    label={{
                      value: 'Mana Value',
                      position: 'insideBottomRight',
                      offset: -2,
                      fill: '#94A3B8',
                      fontSize: 10,
                    }}
                  />
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize: 11, fill: '#94A3B8' }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    domain={[0, 100]}
                    tickFormatter={(v: number) => `${v}%`}
                    tick={{ fontSize: 10, fill: '#7AD3F6' }}
                    axisLine={false}
                    tickLine={false}
                    width={38}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(41, 171, 226, 0.10)' }}
                    content={<CurveTooltip curveMode={curveMode} />}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: '11px', paddingTop: '6px', color: '#CBD5E1' }}
                  />
                  <ReferenceLine
                    yAxisId="left"
                    x={avgBucketLabel}
                    stroke="#F59E0B"
                    strokeDasharray="4 4"
                    label={{
                      value: `Avg ${computed.avgSpellCmc.toFixed(1)}`,
                      position: 'top',
                      fill: '#FBBF24',
                      fontSize: 10,
                      fontFamily: 'JetBrains Mono, monospace',
                    }}
                  />

                  {curveMode === 'stacked' ? (
                    <>
                      <Bar
                        yAxisId="left"
                        dataKey="creatures"
                        name="Creatures"
                        stackId="curve"
                        fill="#10B981"
                        maxBarSize={36}
                        className="cursor-pointer"
                      />
                      <Bar
                        yAxisId="left"
                        dataKey="instantsSorceries"
                        name="Instants / Sorceries"
                        stackId="curve"
                        fill="#29ABE2"
                        maxBarSize={36}
                        className="cursor-pointer"
                      />
                      <Bar
                        yAxisId="left"
                        dataKey="otherNonlands"
                        name="Artifacts / Ench / PW"
                        stackId="curve"
                        fill="#F59E0B"
                        radius={[4, 4, 0, 0]}
                        maxBarSize={36}
                        className="cursor-pointer"
                      />
                    </>
                  ) : (
                    <>
                      <Bar
                        yAxisId="left"
                        dataKey="totalCurrent"
                        name="Original Deck"
                        fill="#64748B"
                        radius={[4, 4, 0, 0]}
                        maxBarSize={22}
                        className="cursor-pointer"
                      />
                      <Bar
                        yAxisId="left"
                        dataKey="totalOptimized"
                        name="With Selected Fixes"
                        fill="#29ABE2"
                        radius={[4, 4, 0, 0]}
                        maxBarSize={22}
                        className="cursor-pointer"
                      />
                    </>
                  )}

                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="cumulativePct"
                    name="Cumulative %"
                    stroke="#7AD3F6"
                    strokeWidth={2}
                    dot={{ r: 3, fill: '#7AD3F6', strokeWidth: 0 }}
                    activeDot={{ r: 5, fill: '#FFFFFF', stroke: '#29ABE2', strokeWidth: 2 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Interactive Selected Curve Bucket Card List */}
          {selectedBucket && (
            <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-3.5 space-y-2">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-zinc-900">
                  Mana Value {selectedBucket.cmcLabel} Spells ({selectedBucket.totalCurrent})
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedBucketIdx(null)}
                  className="text-zinc-500 hover:text-zinc-900 font-medium cursor-pointer"
                >
                  Close
                </button>
              </div>
              {selectedBucket.cards.length === 0 ? (
                <p className="text-xs text-zinc-500">No spells at this mana value.</p>
              ) : (
                <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-xs">
                  {selectedBucket.cards.map((c) => (
                    <button
                      key={c.name}
                      type="button"
                      onClick={() => onInspectCard(c.name, c.meta)}
                      className="text-left font-medium text-sky-700 hover:underline cursor-pointer"
                    >
                      {c.qty > 1 ? `${c.qty}x ` : ''}
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Card 2: Color Identity Breakdown Donut */}
        <div className="rounded-xl border border-zinc-200 bg-white p-6 flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-100 pb-4">
              <div>
                <h3 className="font-display text-base font-semibold text-zinc-900">
                  Color Breakdown
                </h3>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {identityMode === 'cards'
                    ? 'Non-land spells grouped by color'
                    : 'Share of colored mana symbols across your spells'}
                </p>
              </div>

              <div className="inline-flex items-center gap-1 rounded-xl bg-zinc-100 p-1.5">
                <button
                  type="button"
                  onClick={() => setIdentityMode('cards')}
                  className={`min-h-[36px] px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    identityMode === 'cards'
                      ? 'bg-white text-zinc-900 shadow-sm'
                      : 'text-zinc-600 hover:text-zinc-900'
                  }`}
                >
                  By Cards
                </button>
                <button
                  type="button"
                  onClick={() => setIdentityMode('pips')}
                  className={`min-h-[36px] px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    identityMode === 'pips'
                      ? 'bg-white text-zinc-900 shadow-sm'
                      : 'text-zinc-600 hover:text-zinc-900'
                  }`}
                >
                  By Pips
                </button>
              </div>
            </div>

            {activeIdentitySlices.length === 0 ? (
              <div className="py-12 text-center text-xs text-zinc-500">
                No color data available for this deck.
              </div>
            ) : (
              <div className="mt-4 grid grid-cols-1 items-center gap-4 sm:grid-cols-[190px_1fr]">
                <div className="relative h-[196px] w-full">
                  <ResponsiveContainer width="100%" height={196}>
                    <PieChart>
                      <Pie
                        data={activeIdentitySlices}
                        dataKey="value"
                        nameKey="label"
                        cx="50%"
                        cy="50%"
                        innerRadius={54}
                        outerRadius={82}
                        paddingAngle={2}
                        stroke="#1A1F29"
                        strokeWidth={2}
                      >
                        {activeIdentitySlices.map((slice) => (
                          <Cell key={slice.key} fill={slice.fill} />
                        ))}
                      </Pie>
                      <Tooltip content={<IdentityPieTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                    <span className="font-mono text-xl font-bold tabular-nums text-zinc-900">
                      {activeIdentityTotal}
                    </span>
                    <span className="text-xs font-medium text-zinc-500">
                      {identityMode === 'cards' ? 'Spells' : 'Pips'}
                    </span>
                  </div>
                </div>

                {/* Clean Tabular Breakdown List */}
                <div className="divide-y divide-zinc-100 text-xs">
                  {activeIdentitySlices.map((slice) => (
                    <div
                      key={slice.key}
                      className="flex items-center justify-between gap-3 py-2"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="h-2.5 w-2.5 rounded-sm shrink-0"
                          style={{ backgroundColor: slice.fill }}
                          aria-hidden="true"
                        />
                        <span className="font-medium text-zinc-800 truncate">
                          {slice.label}
                        </span>
                      </div>
                      <div className="flex items-baseline gap-2 font-mono tabular-nums shrink-0">
                        <span className="font-semibold text-zinc-900">{slice.value}</span>
                        <span className="w-9 text-right text-xs text-zinc-500">
                          {slice.pct}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="mt-4 border-t border-zinc-100 pt-3 flex items-center justify-between text-xs text-zinc-500">
            <span>Detected Profile</span>
            <span className="font-mono font-semibold text-zinc-800">
              {computed.identityName}
            </span>
          </div>
        </div>
      </div>

      {/* Bottom Row: Role-Weighted Average CMC Comparison */}
      <div className="rounded-xl border border-zinc-200 bg-white p-6">
        <div className="flex flex-col gap-2 border-b border-zinc-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-display text-base font-semibold text-zinc-900">
              Average Cost by Deck Role
            </h3>
            <p className="mt-0.5 text-xs text-zinc-500">
              Compares average mana cost across ramp, card draw, removal, board wipes, and threats against your format target.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 font-mono text-xs tabular-nums">
            <span className="text-zinc-600">
              Avg Spell:{' '}
              <strong className="text-sky-700">{computed.avgSpellCmc.toFixed(2)}</strong>
            </span>
            <span className="text-zinc-300" aria-hidden="true">·</span>
            <span className="text-zinc-600">
              Median:{' '}
              <strong className="text-zinc-900">{computed.medianCmc.toFixed(1)}</strong>
            </span>
            {hasSelectedAdjustments &&
              Math.abs(computed.optimizedAvgCmc - computed.avgSpellCmc) >= 0.01 && (
                <>
                  <span className="text-zinc-300" aria-hidden="true">·</span>
                  <span className="text-emerald-700">
                    With Fixes: <strong>{computed.optimizedAvgCmc.toFixed(2)}</strong>
                  </span>
                </>
              )}
          </div>
        </div>

        <div className="mt-4 h-[230px] w-full">
          <ResponsiveContainer width="100%" height={230}>
            <BarChart
              data={computed.roleCmcData}
              margin={{ top: 22, right: 16, left: -14, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#2C3444" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: '#E4E4E7', fontWeight: 500 }}
                axisLine={{ stroke: '#3B4458' }}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={6}
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#94A3B8' }}
                axisLine={false}
                tickLine={false}
                allowDecimals
                domain={[0, (dataMax: number) => Math.max(4, Math.ceil(dataMax + 0.8))]}
              />
              <Tooltip
                cursor={{ fill: 'rgba(41, 171, 226, 0.10)' }}
                content={<RoleCmcTooltip />}
              />
              <ReferenceLine
                y={computed.formatTargetCmc}
                stroke="#F59E0B"
                strokeDasharray="4 4"
                label={{
                  value: `Target ≤ ${computed.formatTargetCmc.toFixed(2)}`,
                  position: 'insideTopRight',
                  fill: '#FBBF24',
                  fontSize: 11,
                  fontFamily: 'JetBrains Mono, monospace',
                }}
              />
              <Bar dataKey="avgCmc" name="Average CMC" radius={[4, 4, 0, 0]} maxBarSize={44}>
                {computed.roleCmcData.map((entry) => (
                  <Cell key={entry.key} fill={entry.fill} />
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
    </Wrapper>
  );
};
