import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import type {
  CardMetadata,
  ColorBreakdownItem,
  ResolvedDeckCard,
} from '../types/deck';
import type { ExportDeckEntry } from '../utils/deckExport';
import {
  computeLandTypeBreakdown,
  mapExportEntriesForLandBreakdown,
  mapResolvedCardsForLandBreakdown,
  type LandCategoryBucket,
} from '../utils/landCategories';
import { CardLink } from './CardInspectorModal';

interface LandTypeBreakdownChartProps {
  resolvedCards: ResolvedDeckCard[];
  optimizedEntries: ExportDeckEntry[];
  colorBreakdown: ColorBreakdownItem[];
  onInspectCard: (name: string, meta?: CardMetadata | null) => void;
}

interface LandTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: LandCategoryBucket }>;
}

const LandCategoryTooltip: React.FC<LandTooltipProps> = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) return null;
  const bucket = payload[0].payload;

  return (
    <div className="max-w-xs rounded-lg border border-zinc-200 bg-white px-3.5 py-2.5 text-xs shadow-sm">
      <div className="flex items-center gap-2 font-semibold text-zinc-900">
        <span
          className="h-2.5 w-2.5 rounded-sm shrink-0"
          style={{ backgroundColor: bucket.color }}
          aria-hidden="true"
        />
        <span>{bucket.label}</span>
        {bucket.fetchableTarget && (
          <>
            <span className="text-zinc-300" aria-hidden="true">·</span>
            <span className="font-medium text-emerald-700">Fetchable target</span>
          </>
        )}
      </div>

      <div className="mt-1.5 font-mono tabular-nums text-zinc-700">
        Count: <span className="font-semibold text-zinc-900">{bucket.count}</span>{' '}
        <span className="text-zinc-500">({bucket.pct}% of lands)</span>
      </div>

      <p className="mt-1 text-[11px] leading-snug text-zinc-500">
        {bucket.description}
      </p>

      {bucket.cards.length > 0 && (
        <div className="mt-1.5 border-t border-zinc-100 pt-1.5 text-[11px] text-zinc-700">
          {bucket.cards
            .slice(0, 4)
            .map((c) => `${c.quantity}x ${c.name}`)
            .join(', ')}
          {bucket.cards.length > 4 && ` +${bucket.cards.length - 4} more`}
        </div>
      )}
    </div>
  );
};

export const LandTypeBreakdownChart: React.FC<LandTypeBreakdownChartProps> = ({
  resolvedCards,
  optimizedEntries,
  colorBreakdown,
  onInspectCard,
}) => {
  const [viewMode, setViewMode] = useState<'current' | 'optimized'>('current');

  const activeColorCount = useMemo(
    () =>
      (colorBreakdown || []).filter((c) => c && c.color !== 'C' && c.status !== 'unused')
        .length,
    [colorBreakdown]
  );

  const currentSummary = useMemo(
    () =>
      computeLandTypeBreakdown({
        cards: mapResolvedCardsForLandBreakdown(resolvedCards || []),
        activeColorCount,
      }),
    [resolvedCards, activeColorCount]
  );

  const optimizedSummary = useMemo(
    () =>
      computeLandTypeBreakdown({
        cards: mapExportEntriesForLandBreakdown(optimizedEntries || []),
        activeColorCount,
      }),
    [optimizedEntries, activeColorCount]
  );

  const activeSummary =
    viewMode === 'optimized' ? optimizedSummary : currentSummary;

  const nonEmptyBuckets = activeSummary.buckets.filter((b) => b.count > 0);
  const deltaLands =
    optimizedSummary.totalLands - currentSummary.totalLands;
  const deltaTargets =
    optimizedSummary.totalFetchableTargets - currentSummary.totalFetchableTargets;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 space-y-5">
      {/* Header & View Toggle */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-display text-base font-semibold text-zinc-900">
            Land Types &amp; Fetch Targets
          </h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            Fetches, typed duals, basics, and utility lands vs. land-search spells
          </p>
        </div>

        <div className="inline-flex items-center gap-1 rounded-lg bg-zinc-100 p-1 shrink-0">
          <button
            type="button"
            onClick={() => setViewMode('current')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              viewMode === 'current'
                ? 'bg-white text-zinc-900 shadow-sm'
                : 'text-zinc-600 hover:text-zinc-900'
            }`}
          >
            Current List ({currentSummary.totalLands})
          </button>
          <button
            type="button"
            onClick={() => setViewMode('optimized')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              viewMode === 'optimized'
                ? 'bg-white text-zinc-900 shadow-sm'
                : 'text-zinc-600 hover:text-zinc-900'
            }`}
          >
            With Selected Fixes ({optimizedSummary.totalLands})
          </button>
        </div>
      </div>

      {/* Land-Search Density Metrics Strip */}
      <div className="grid grid-cols-2 gap-6 border-y border-zinc-100 py-4 sm:grid-cols-4">
        <div>
          <div className="text-xs font-medium text-zinc-500">Total Lands</div>
          <div className="mt-1 font-mono text-xl font-bold tabular-nums text-zinc-900">
            {activeSummary.totalLands}
          </div>
          <div className="mt-0.5 text-xs font-mono tabular-nums text-zinc-500">
            {viewMode === 'optimized' && deltaLands !== 0
              ? `${deltaLands > 0 ? '+' : ''}${deltaLands} vs current`
              : `${nonEmptyBuckets.length} land categories`}
          </div>
        </div>

        <div>
          <div className="text-xs font-medium text-zinc-500">Land Searchers</div>
          <div className="mt-1 font-mono text-xl font-bold tabular-nums text-zinc-900">
            {activeSummary.totalLandSearchers}
          </div>
          <div className="mt-0.5 text-xs font-mono tabular-nums text-zinc-500">
            {activeSummary.fetchLandCount} fetches · {activeSummary.landSearchSpellCount} search spells
          </div>
        </div>

        <div>
          <div className="text-xs font-medium text-zinc-500">Fetchable Targets</div>
          <div className="mt-1 font-mono text-xl font-bold tabular-nums text-sky-700">
            {activeSummary.totalFetchableTargets}
          </div>
          <div className="mt-0.5 text-xs font-mono tabular-nums text-zinc-500">
            {activeSummary.basicTargetCount} basics · {activeSummary.typedDualTargetCount} shock/typed
            {viewMode === 'optimized' && deltaTargets !== 0
              ? ` (${deltaTargets > 0 ? '+' : ''}${deltaTargets})`
              : ''}
          </div>
        </div>

        <div>
          <div className="text-xs font-medium text-zinc-500">Targets per Search</div>
          <div className="mt-1 font-mono text-xl font-bold tabular-nums text-zinc-900">
            {activeSummary.targetsPerSearcher !== null
              ? `${activeSummary.targetsPerSearcher}x`
              : '—'}
          </div>
          <div className="mt-0.5 text-xs text-zinc-500">
            {activeSummary.totalLandSearchers > 0
              ? 'Fetchable lands / searcher'
              : 'No land searchers'}
          </div>
        </div>
      </div>

      {/* Secondary Recharts Chart + Detailed Category Cards List */}
      {activeSummary.totalLands === 0 ? (
        <p className="py-6 text-sm text-zinc-500">
          No lands found in this deck configuration.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.05fr_1fr] lg:items-start">
          {/* Recharts Horizontal Bar Chart */}
          <div className="h-[240px] w-full">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart
                data={activeSummary.buckets}
                layout="vertical"
                margin={{ top: 4, right: 36, left: 8, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#2C3444" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fontSize: 11, fill: '#B4BCD0' }}
                  axisLine={{ stroke: '#3B4458' }}
                  tickLine={false}
                  allowDecimals={false}
                />
                <YAxis
                  type="category"
                  dataKey="shortLabel"
                  width={82}
                  tick={{ fontSize: 12, fill: '#F4F4F5', fontWeight: 500 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(41, 171, 226, 0.12)' }}
                  content={<LandCategoryTooltip />}
                />
                <Bar dataKey="count" radius={[0, 5, 5, 0]} barSize={20}>
                  {activeSummary.buckets.map((bucket) => (
                    <Cell key={bucket.key} fill={bucket.color} />
                  ))}
                  <LabelList
                    dataKey="count"
                    position="right"
                    formatter={(val: unknown) => (Number(val) > 0 ? String(val) : '')}
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

          {/* Category Breakdown Table & Clickable Lands */}
          <div className="divide-y divide-zinc-100">
            {activeSummary.buckets.map((bucket) => (
              <div key={bucket.key} className="py-2.5 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="h-2.5 w-2.5 rounded-sm shrink-0"
                      style={{ backgroundColor: bucket.color }}
                      aria-hidden="true"
                    />
                    <span className="font-medium text-zinc-900 truncate">
                      {bucket.label}
                    </span>
                    {bucket.fetchableTarget && (
                      <>
                        <span className="text-zinc-300" aria-hidden="true">·</span>
                        <span className="text-xs font-medium text-emerald-700 whitespace-nowrap">
                          Fetchable
                        </span>
                      </>
                    )}
                  </div>

                  <div className="font-mono text-xs tabular-nums text-zinc-600 shrink-0">
                    <span className="font-semibold text-zinc-900">{bucket.count}</span>{' '}
                    <span className="text-zinc-400">({bucket.pct}%)</span>
                  </div>
                </div>

                {bucket.cards.length > 0 && (
                  <div className="mt-1 pl-4.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-600">
                    {bucket.cards.map((c, idx) => (
                      <React.Fragment key={`${c.name}-${idx}`}>
                        <span className="inline-flex items-baseline gap-1">
                          {c.quantity > 1 && (
                            <span className="font-mono text-[11px] tabular-nums text-zinc-500">
                              {c.quantity}x
                            </span>
                          )}
                          <CardLink
                            name={c.name}
                            meta={c.meta}
                            onInspect={onInspectCard}
                            className="text-xs"
                          />
                        </span>
                        {idx < bucket.cards.length - 1 && (
                          <span className="text-zinc-300" aria-hidden="true">·</span>
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search Density Diagnostic Footer */}
      <div className="border-t border-zinc-100 pt-4 flex items-start gap-2.5">
        {activeSummary.verdictSeverity === 'ok' ? (
          <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-700 shrink-0" />
        ) : (
          <AlertTriangle
            className={`mt-0.5 h-4 w-4 shrink-0 ${
              activeSummary.verdictSeverity === 'critical'
                ? 'text-red-700'
                : 'text-amber-700'
            }`}
          />
        )}
        <div className="text-xs leading-relaxed text-zinc-600">
          <span
            className={`font-semibold ${
              activeSummary.verdictSeverity === 'ok'
                ? 'text-emerald-800'
                : activeSummary.verdictSeverity === 'critical'
                ? 'text-red-800'
                : 'text-amber-800'
            }`}
          >
            {activeSummary.verdictHeadline}:
          </span>{' '}
          {activeSummary.verdictDetail}
        </div>
      </div>
    </div>
  );
};
