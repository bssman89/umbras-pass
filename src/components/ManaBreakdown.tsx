import React, { useMemo } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  CardMetadata,
  DeckMetrics,
  ManaColor,
  ManaPlanSummary,
  ResolvedDeckCard,
} from '../types/deck';
import type { ExportDeckEntry } from '../utils/deckExport';
import { CardLink } from './CardInspectorModal';
import { ColorPipsChart } from './ColorPipsChart';
import { LandTypeBreakdownChart } from './LandTypeBreakdownChart';

interface ManaBreakdownProps {
  metrics: DeckMetrics;
  manaPlan: ManaPlanSummary;
  resolvedCards: ResolvedDeckCard[];
  optimizedEntries: ExportDeckEntry[];
  selectedLandChangeIds: Set<string>;
  onToggleLandChange: (id: string) => void;
  onInspectCard: (name: string, meta?: CardMetadata | null) => void;
  manaOptimizedLandCount?: number;
  isPlaytestManaSynced?: boolean;
  onSelectAllLandChanges?: (selectAll: boolean) => void;
  onSyncManaToPlaytest?: () => void;
  embedded?: boolean;
}

const COLOR_BAR_HEX: Record<ManaColor, string> = {
  W: '#FDE68A',
  U: '#29ABE2',
  B: '#A855F7',
  R: '#E53924',
  G: '#22C55E',
  C: '#94A3B8',
};

interface CurveChartDatum {
  cmcLabel: string;
  creatures: number;
  nonCreatures: number;
  total: number;
  sharePct: number;
}

const CurveTooltip: React.FC<{
  active?: boolean;
  payload?: Array<{ payload: CurveChartDatum }>;
}> = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0].payload;
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3.5 py-2.5 text-xs shadow-lg">
      <div className="font-semibold text-zinc-900">
        Mana Value {item.cmcLabel}
      </div>
      <div className="mt-1.5 space-y-0.5 font-mono tabular-nums text-zinc-700">
        <div>
          Total Spells: <span className="font-semibold text-zinc-900">{item.total}</span> ({item.sharePct}%)
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-[#10B981]" aria-hidden="true" />
          Creatures: <span className="font-semibold text-zinc-900">{item.creatures}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-[#29ABE2]" aria-hidden="true" />
          Non-Creatures: <span className="font-semibold text-zinc-900">{item.nonCreatures}</span>
        </div>
      </div>
    </div>
  );
};

export const ManaBreakdown: React.FC<ManaBreakdownProps> = ({
  metrics,
  manaPlan,
  resolvedCards,
  optimizedEntries,
  selectedLandChangeIds,
  onToggleLandChange,
  onInspectCard,
  manaOptimizedLandCount,
  isPlaytestManaSynced = false,
  onSelectAllLandChanges,
  onSyncManaToPlaytest,
  embedded = false,
}) => {
  const safeCurve = metrics?.curve ?? [];
  const safeColorBreakdown = metrics?.colorBreakdown ?? [];
  const safeColorIssues = manaPlan?.colorIssues ?? [];
  const safeLandChanges = manaPlan?.landChanges ?? [];
  const activeColors = safeColorBreakdown.filter((c) => c.status !== 'unused');

  const curveChartData = useMemo<CurveChartDatum[]>(() => {
    const creatureBuckets = new Map<string, number>();
    const nonCreatureBuckets = new Map<string, number>();

    for (const entry of resolvedCards || []) {
      if (!entry || (entry.zone !== 'main' && entry.zone !== 'companion')) continue;
      if (!entry.card || entry.card.isLand) continue;
      const qty = typeof entry.quantity === 'number' ? entry.quantity : 1;
      const rawCmc = Math.max(0, Math.round(entry.card.cmc ?? 0));
      const label = rawCmc >= 7 ? '7+' : String(rawCmc);
      const frontType = ((entry.card.typeLine || '').split('//')[0] || '').toLowerCase();
      if (/\bcreature\b/.test(frontType)) {
        creatureBuckets.set(label, (creatureBuckets.get(label) || 0) + qty);
      } else {
        nonCreatureBuckets.set(label, (nonCreatureBuckets.get(label) || 0) + qty);
      }
    }

    const totalSpellsAcrossBuckets = Math.max(
      1,
      safeCurve.reduce((acc, b) => acc + b.currentCount, 0)
    );

    return safeCurve.map((bucket) => {
      const creatures = creatureBuckets.get(bucket.cmcLabel) || 0;
      const resolvedNonCreatures = nonCreatureBuckets.get(bucket.cmcLabel) || 0;
      const total = bucket.currentCount;
      const nonCreatures =
        creatures + resolvedNonCreatures > 0
          ? Math.max(0, total - creatures)
          : total;

      return {
        cmcLabel: bucket.cmcLabel,
        creatures: Math.min(total, creatures),
        nonCreatures,
        total,
        sharePct: Math.round((total / totalSpellsAcrossBuckets) * 100),
      };
    });
  }, [resolvedCards, safeCurve]);

  const landDeltaLabel =
    metrics.landsDelta > 0
      ? `Add ${metrics.landsDelta} land${metrics.landsDelta === 1 ? '' : 's'}`
      : metrics.landsDelta < 0
      ? `Cut ${Math.abs(metrics.landsDelta)} land${Math.abs(metrics.landsDelta) === 1 ? '' : 's'}`
      : 'Land count on target';

  const rampDeltaLabel =
    metrics.rampDelta > 0
      ? `Add ${metrics.rampDelta} ramp piece${metrics.rampDelta === 1 ? '' : 's'}`
      : 'Ramp count healthy';

  const Wrapper: React.ElementType = embedded ? 'div' : 'section';

  return (
    <Wrapper id={embedded ? undefined : 'mana-section'} className={embedded ? 'space-y-5' : 'space-y-6 scroll-mt-20'}>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          {!embedded && (
            <h2 className="font-display text-xl font-bold text-zinc-900">
              Mana &amp; Curve
            </h2>
          )}
          <p className={embedded ? 'text-sm text-zinc-600' : 'mt-0.5 text-sm text-zinc-600'}>
            Reviews your land count, color sources, mana ramp, and spell curve so your deck casts smoothly on schedule.
          </p>
        </div>
        <div className="text-xs font-mono tabular-nums text-zinc-500 whitespace-nowrap shrink-0">
          {landDeltaLabel}
        </div>
      </div>

      {/* Plain-English Mana Summary Row */}
      <div className="rounded-xl border border-zinc-200 bg-white p-6">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3 border-b border-zinc-100 pb-5">
          <div>
            <div className="text-xs font-medium text-zinc-500">Lands (Current → Target)</div>
            <div className="mt-1 flex items-baseline gap-2.5">
              <span className="font-mono text-2xl font-bold tabular-nums text-zinc-900">
                {metrics.currentLands}
              </span>
              <span className="text-sm text-zinc-400">→</span>
              <span className="font-mono text-2xl font-bold tabular-nums text-sky-700">
                {metrics.recommendedLands}
              </span>
              <span
                className={`text-xs font-semibold ${
                  metrics.landsDelta > 0
                    ? 'text-red-700'
                    : metrics.landsDelta < 0
                    ? 'text-amber-700'
                    : 'text-emerald-700'
                }`}
              >
                ({landDeltaLabel})
              </span>
            </div>
            {metrics.mdfcLandCount > 0 && (
              <p className="mt-1 text-xs text-zinc-500">
                Includes {metrics.mdfcLandCount} MDFC spell-land{metrics.mdfcLandCount === 1 ? '' : 's'} at half weight.
              </p>
            )}
          </div>

          <div>
            <div className="text-xs font-medium text-zinc-500">Mana Ramp</div>
            <div className="mt-1 flex items-baseline gap-2.5">
              <span className="font-mono text-2xl font-bold tabular-nums text-zinc-900">
                {metrics.currentRamp}
              </span>
              <span className="text-sm text-zinc-400">→</span>
              <span className="font-mono text-2xl font-bold tabular-nums text-sky-700">
                {metrics.recommendedRamp}
              </span>
              <span
                className={`text-xs font-semibold ${
                  metrics.rampDelta > 0 ? 'text-amber-700' : 'text-emerald-700'
                }`}
              >
                ({rampDeltaLabel})
              </span>
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              Mana rocks, dorks &amp; land search
            </p>
          </div>

          <div>
            <div className="text-xs font-medium text-zinc-500">Tapped Lands</div>
            <div className="mt-1 flex items-baseline gap-2.5">
              <span className="font-mono text-2xl font-bold tabular-nums text-zinc-900">
                {metrics.tappedLandCount}
              </span>
              <span className="text-xs text-zinc-500">
                of {metrics.currentLands} lands
              </span>
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              {metrics.tappedLandCount >= 8
                ? 'Slows down early turns; consider trimming lands that enter tapped.'
                : 'Plenty of untapped lands for smooth early turns.'}
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-1">
          <div className="text-sm font-semibold text-zinc-900">
            {manaPlan.headline}
          </div>
          <p className="text-sm leading-relaxed text-zinc-700">
            {manaPlan.plainExplanation}
          </p>
        </div>

        {manaPlan.tappedLandsWarning && (
          <p className="mt-3 text-sm text-amber-800">
            <span className="font-semibold">Tempo note:</span> {manaPlan.tappedLandsWarning}
          </p>
        )}

        {safeColorIssues.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm text-zinc-700">
            {safeColorIssues.map((issue, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="font-mono text-amber-700">•</span>
                <span>{issue}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Curve + Color Pips Distribution (Recharts) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Mana Curve (Recharts Stacked Creature vs Non-Creature Chart) */}
        <div className="rounded-xl border border-zinc-200 bg-white p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-base font-semibold text-zinc-900">
                Spell Mana Curve
              </h3>
              <p className="mt-0.5 text-xs text-zinc-500">
                Creatures compared to non-creature spells, averaging {metrics.averageCmcNonLand.toFixed(2)} mana value.
              </p>
            </div>
            <span className="font-mono text-xs tabular-nums text-zinc-500">
              {curveChartData.reduce((s, d) => s + d.total, 0)} spells
            </span>
          </div>

          <div className="mt-4 h-[228px] w-full">
            <ResponsiveContainer width="100%" height={228}>
              <BarChart
                data={curveChartData}
                margin={{ top: 20, right: 8, left: -18, bottom: 2 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#2C3444" vertical={false} />
                <XAxis
                  dataKey="cmcLabel"
                  tick={{ fontSize: 12, fill: '#E4E4E7', fontWeight: 500 }}
                  axisLine={{ stroke: '#3B4458' }}
                  tickLine={false}
                  tickFormatter={(val) => `${val} MV`}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#94A3B8' }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(41, 171, 226, 0.10)' }}
                  content={<CurveTooltip />}
                />
                <Legend
                  wrapperStyle={{ fontSize: '12px', paddingTop: '6px', color: '#E4E4E7' }}
                />
                <Bar
                  dataKey="creatures"
                  name="Creatures"
                  stackId="curve"
                  fill="#10B981"
                  radius={[0, 0, 0, 0]}
                  barSize={26}
                />
                <Bar
                  dataKey="nonCreatures"
                  name="Non-Creature Spells"
                  stackId="curve"
                  fill="#29ABE2"
                  radius={[4, 4, 0, 0]}
                  barSize={26}
                >
                  <LabelList
                    dataKey="total"
                    position="top"
                    formatter={(val: unknown) => (Number(val) > 0 ? String(val) : '')}
                    style={{ fill: '#E4E4E7', fontSize: 11, fontWeight: 600, fontFamily: 'JetBrains Mono, monospace' }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Recharts Color Pips Distribution */}
        <ColorPipsChart colorBreakdown={safeColorBreakdown} />
      </div>

      {/* Secondary Land Type Breakdown & Land-Search Density Chart */}
      <LandTypeBreakdownChart
        resolvedCards={resolvedCards ?? []}
        optimizedEntries={optimizedEntries ?? []}
        colorBreakdown={safeColorBreakdown}
        onInspectCard={onInspectCard}
      />

      {/* Color Pips vs Mana Sources Table */}
      <div className="rounded-xl border border-zinc-200 bg-white p-6">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-semibold text-zinc-900">
            Color Requirements vs. Mana Sources
          </h3>
          <span className="text-xs text-zinc-500">Counts lands plus half-weight for mana rocks</span>
        </div>

        {activeColors.length === 0 ? (
          <p className="mt-6 text-sm text-zinc-500">
            This deck has no colored mana pips.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-xs font-medium text-zinc-500">
                  <th className="py-2 pr-3">Color</th>
                  <th className="py-2 px-2 text-right">Spell Pips</th>
                  <th className="py-2 px-2 text-right">Have</th>
                  <th className="py-2 px-2 text-right">Need</th>
                  <th className="py-2 px-3 w-36 hidden sm:table-cell">Coverage</th>
                  <th className="py-2 pl-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {activeColors.map((c) => {
                  const statusText =
                    c.deltaSources > 0
                      ? `Missing ${c.deltaSources}`
                      : c.deltaSources < 0
                      ? `+${Math.abs(c.deltaSources)} buffer`
                      : 'Exact';
                  const statusClass =
                    c.status === 'critical'
                      ? 'text-red-700 font-semibold'
                      : c.status === 'low'
                      ? 'text-amber-700 font-semibold'
                      : 'text-emerald-700 font-medium';
                  const coveragePct =
                    c.recommendedSources > 0
                      ? Math.min(100, Math.round((c.currentSources / c.recommendedSources) * 100))
                      : 100;
                  const coverageBarColor =
                    c.status === 'critical'
                      ? '#E53924'
                      : c.status === 'low'
                      ? '#F59E0B'
                      : '#10B981';

                  return (
                    <tr key={c.color} className="h-10">
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-2.5">
                          <span
                            className="h-3 w-3 rounded-sm shrink-0 border border-white/15"
                            style={{ backgroundColor: COLOR_BAR_HEX[c.color] }}
                            aria-hidden="true"
                          />
                          <span className="font-medium text-zinc-900">{c.label}</span>
                        </div>
                      </td>
                      <td className="py-2 px-2 text-right font-mono tabular-nums text-zinc-600">
                        {c.pips} ({c.pipSharePct}%)
                      </td>
                      <td className="py-2 px-2 text-right font-mono font-semibold tabular-nums text-zinc-900">
                        {c.currentSources}
                      </td>
                      <td className="py-2 px-2 text-right font-mono tabular-nums text-zinc-600">
                        {c.recommendedSources}
                      </td>
                      <td className="py-2 px-3 hidden sm:table-cell">
                        <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100">
                          <div
                            className="h-full rounded-full transition-all duration-200"
                            style={{
                              width: `${Math.max(4, coveragePct)}%`,
                              backgroundColor: coverageBarColor,
                            }}
                          />
                        </div>
                      </td>
                      <td className={`py-2 pl-3 text-right font-mono text-xs tabular-nums ${statusClass}`}>
                        {statusText}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Specific Lands & Mana Pieces to Add / Cut */}
      {safeLandChanges.length > 0 && (
        <div className="rounded-xl border border-zinc-200 bg-white p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-zinc-100 pb-4">
            <div>
              <h3 className="font-display text-base font-semibold text-zinc-900">
                Land &amp; Mana Adjustments
              </h3>
              <p className="text-xs text-zinc-500">
                {safeLandChanges.length} recommended mana tweak{safeLandChanges.length === 1 ? '' : 's'}. Check the ones you want to include in your export or test live.
                {typeof manaOptimizedLandCount === 'number' && selectedLandChangeIds.size > 0 && (
                  <span className="ml-1.5 font-mono font-medium text-sky-700">
                    ({manaOptimizedLandCount} lands active)
                  </span>
                )}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {onSelectAllLandChanges && (
                <button
                  type="button"
                  onClick={() =>
                    onSelectAllLandChanges(
                      selectedLandChangeIds.size < safeLandChanges.length
                    )
                  }
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 cursor-pointer whitespace-nowrap"
                >
                  {selectedLandChangeIds.size === safeLandChanges.length
                    ? 'Clear All'
                    : `Select All (${safeLandChanges.length})`}
                </button>
              )}

              {onSyncManaToPlaytest && (
                <button
                  type="button"
                  onClick={onSyncManaToPlaytest}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-sky-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-sky-800 cursor-pointer whitespace-nowrap"
                >
                  {isPlaytestManaSynced && selectedLandChangeIds.size > 0 ? (
                    <>
                      <Check className="h-3.5 w-3.5" />
                      <span>Synced ({selectedLandChangeIds.size}) · Test in Playtest</span>
                    </>
                  ) : selectedLandChangeIds.size > 0 ? (
                    <>
                      <span>
                        Sync {selectedLandChangeIds.size} Fix{selectedLandChangeIds.size === 1 ? '' : 'es'} to Playtest
                      </span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </>
                  ) : (
                    <>
                      <span>Apply All &amp; Test in Playtest</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          <div className="mt-2 divide-y divide-zinc-100">
            {safeLandChanges.map((item) => {
              const checked = selectedLandChangeIds.has(item.id);
              const isAdd = item.action === 'add';
              return (
                <div
                  key={item.id}
                  className="flex flex-col gap-2 py-3.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      onClick={() => onToggleLandChange(item.id)}
                      aria-pressed={checked}
                      aria-label={`${checked ? 'Unselect' : 'Select'} ${item.action} ${item.cardName}`}
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors cursor-pointer ${
                        checked
                          ? 'border-sky-700 bg-sky-700 text-white'
                          : 'border-zinc-300 bg-white text-transparent hover:border-zinc-400'
                      }`}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>

                    <div>
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span
                          className={`font-semibold ${
                            isAdd ? 'text-emerald-700' : 'text-red-700'
                          }`}
                        >
                          {isAdd ? `Put In +${item.quantity}` : `Take Out -${item.quantity}`}
                        </span>
                        <span aria-hidden="true" className="text-zinc-300">·</span>
                        <CardLink
                          name={item.cardName}
                          meta={item.cardMeta}
                          onInspect={onInspectCard}
                        />
                        {item.cardMeta?.priceUsd !== null && item.cardMeta?.priceUsd !== undefined && (
                          <>
                            <span aria-hidden="true" className="text-zinc-300">·</span>
                            <span className="font-mono text-xs tabular-nums text-zinc-500">
                              ${item.cardMeta.priceUsd.toFixed(2)}
                            </span>
                          </>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-zinc-600">{item.reason}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Wrapper>
  );
};
