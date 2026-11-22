import React, { memo, useMemo } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { DeckMetrics, ResolvedDeckCard } from '../types/deck';

interface DeckStatsCardProps {
  metrics: DeckMetrics;
  resolvedCards: ResolvedDeckCard[];
}

interface TypeBucket {
  key: string;
  label: string;
  count: number;
  pct: number;
  color: string;
}

const TYPE_ORDER: Array<{ key: string; label: string; color: string }> = [
  { key: 'Creature', label: 'Creatures', color: '#10B981' },
  { key: 'Instant', label: 'Instants', color: '#29ABE2' },
  { key: 'Sorcery', label: 'Sorceries', color: '#8B5CF6' },
  { key: 'Artifact', label: 'Artifacts', color: '#94A3B8' },
  { key: 'Enchantment', label: 'Enchantments', color: '#F59E0B' },
  { key: 'Planeswalker', label: 'Planeswalkers', color: '#E53924' },
  { key: 'Battle', label: 'Battles', color: '#FB923C' },
  { key: 'Land', label: 'Lands', color: '#14B8A6' },
  { key: 'Other', label: 'Other / Unresolved', color: '#64748B' },
];

function classifyPrimaryType(card: ResolvedDeckCard): string {
  if (!card?.card) return 'Other';
  const frontType = ((card.card.typeLine || '').split('//')[0] || '').toLowerCase();
  if (card.card.isLand || /\bland\b/.test(frontType)) return 'Land';
  if (/\bcreature\b/.test(frontType)) return 'Creature';
  if (/\bplaneswalker\b/.test(frontType)) return 'Planeswalker';
  if (/\bbattle\b/.test(frontType)) return 'Battle';
  if (/\binstant\b/.test(frontType)) return 'Instant';
  if (/\bsorcery\b/.test(frontType)) return 'Sorcery';
  if (/\bartifact\b/.test(frontType)) return 'Artifact';
  if (/\benchantment\b/.test(frontType)) return 'Enchantment';
  return 'Other';
}

interface TypeTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: TypeBucket }>;
}

const TypeTooltip: React.FC<TypeTooltipProps> = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) return null;
  const bucket = payload[0].payload;
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs shadow-lg">
      <div className="flex items-center gap-2 font-semibold text-zinc-900">
        <span
          className="h-2.5 w-2.5 rounded-sm shrink-0"
          style={{ backgroundColor: bucket.color }}
          aria-hidden="true"
        />
        <span>{bucket.label}</span>
      </div>
      <div className="mt-1 font-mono tabular-nums text-zinc-700">
        <span className="font-semibold text-zinc-900">{bucket.count}</span> cards ({bucket.pct}%)
      </div>
    </div>
  );
};

export const DeckStatsCard: React.FC<DeckStatsCardProps> = memo(({
  metrics,
  resolvedCards,
}) => {
  const { typeBuckets, totalMainCount, uniqueCardCount, estimatedUsd } = useMemo(() => {
    const mainEntries = (resolvedCards || []).filter(
      (c) => c && (c.zone === 'main' || c.zone === 'commander')
    );

    const counts = new Map<string, number>();
    const uniqueNames = new Set<string>();
    let total = 0;
    let usdSum = 0;
    let hasAnyPrice = false;

    for (const entry of mainEntries) {
      const qty = typeof entry.quantity === 'number' ? entry.quantity : 1;
      total += qty;
      uniqueNames.add((entry.name || 'unknown').toLowerCase());
      const typeKey = classifyPrimaryType(entry);
      counts.set(typeKey, (counts.get(typeKey) || 0) + qty);

      if (entry.card?.priceUsd !== null && entry.card?.priceUsd !== undefined) {
        usdSum += entry.card.priceUsd * qty;
        hasAnyPrice = true;
      }
    }

    const buckets: TypeBucket[] = TYPE_ORDER.map((t) => {
      const count = counts.get(t.key) || 0;
      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
      return {
        key: t.key,
        label: t.label,
        count,
        pct,
        color: t.color,
      };
    }).filter((b) => b.count > 0);

    return {
      typeBuckets: buckets,
      totalMainCount: total,
      uniqueCardCount: uniqueNames.size,
      estimatedUsd: hasAnyPrice ? usdSum : null,
    };
  }, [resolvedCards]);

  const maxBucketCount = Math.max(1, ...typeBuckets.map((b) => b.count));

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6">
      <div className="flex flex-col gap-1 border-b border-zinc-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-display text-base font-semibold text-zinc-900">
            Card Type Breakdown
          </h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            A snapshot of card types, average mana cost, and estimated value across {totalMainCount} cards.
          </p>
        </div>
        {metrics.sideboardCount > 0 && (
          <div className="font-mono text-xs tabular-nums text-zinc-500">
            + {metrics.sideboardCount} Sideboard
          </div>
        )}
      </div>

      {/* Key Deck-Wide Numbers */}
      <div className="mt-5 grid grid-cols-2 gap-6 border-b border-zinc-100 pb-5 sm:grid-cols-4">
        <div>
          <div className="text-xs font-medium text-zinc-500">Total Cards</div>
          <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-zinc-900">
            {totalMainCount}
          </div>
          <div className="mt-0.5 text-xs font-mono tabular-nums text-zinc-500">
            {uniqueCardCount} unique titles
          </div>
        </div>

        <div>
          <div className="text-xs font-medium text-zinc-500">Avg. Spell Cost</div>
          <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-zinc-900">
            {metrics.averageCmcNonLand.toFixed(2)}
          </div>
          <div className="mt-0.5 text-xs text-zinc-500">Excluding lands</div>
        </div>

        <div>
          <div className="text-xs font-medium text-zinc-500">Avg. Cost (All Cards)</div>
          <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-zinc-900">
            {metrics.averageCmcWithLands.toFixed(2)}
          </div>
          <div className="mt-0.5 text-xs text-zinc-500">Including lands</div>
        </div>

        <div>
          <div className="text-xs font-medium text-zinc-500">Est. Market Value</div>
          <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-zinc-900">
            {estimatedUsd !== null ? `$${estimatedUsd.toFixed(2)}` : '—'}
          </div>
          <div className="mt-0.5 text-xs text-zinc-500">Scryfall USD</div>
        </div>
      </div>

      {/* Card Type Composition Ring + Proportional Type Breakdown */}
      {typeBuckets.length > 0 && (
        <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-[220px_1fr] lg:items-center">
          {/* Interactive Type Donut Chart */}
          <div className="relative mx-auto h-[196px] w-[196px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={typeBuckets}
                  dataKey="count"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  innerRadius={56}
                  outerRadius={84}
                  paddingAngle={2.5}
                  stroke="#1a1f29"
                  strokeWidth={2}
                  isAnimationActive={false}
                >
                  {typeBuckets.map((bucket) => (
                    <Cell key={bucket.key} fill={bucket.color} />
                  ))}
                </Pie>
                <Tooltip content={<TypeTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="font-mono text-2xl font-bold tabular-nums text-zinc-900 leading-none">
                {totalMainCount}
              </span>
              <span className="mt-1 text-[11px] font-medium text-zinc-500">
                {typeBuckets.length} Types
              </span>
            </div>
          </div>

          {/* Right Column: Stacked Summary Bar + Individual Type Bars */}
          <div className="space-y-4">
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-zinc-100 p-0.5 gap-0.5">
              {typeBuckets.map((bucket) => (
                <div
                  key={bucket.key}
                  className="h-full first:rounded-l-full last:rounded-r-full transition-all duration-200"
                  style={{
                    width: `${(bucket.count / Math.max(1, totalMainCount)) * 100}%`,
                    backgroundColor: bucket.color,
                  }}
                  title={`${bucket.label}: ${bucket.count} (${bucket.pct}%)`}
                />
              ))}
            </div>

            <div className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
              {typeBuckets.map((bucket) => {
                const relativeBarPct = Math.round((bucket.count / maxBucketCount) * 100);
                return (
                  <div key={bucket.key} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="h-2.5 w-2.5 rounded-sm shrink-0"
                          style={{ backgroundColor: bucket.color }}
                          aria-hidden="true"
                        />
                        <span className="truncate font-medium text-zinc-800">{bucket.label}</span>
                      </div>
                      <div className="ml-2 shrink-0 font-mono text-xs tabular-nums text-zinc-600">
                        <span className="font-semibold text-zinc-900">{bucket.count}</span>{' '}
                        <span className="text-zinc-500">({bucket.pct}%)</span>
                      </div>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
                      <div
                        className="h-full rounded-full transition-all duration-200"
                        style={{
                          width: `${Math.max(4, relativeBarPct)}%`,
                          backgroundColor: bucket.color,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
DeckStatsCard.displayName = 'DeckStatsCard';
