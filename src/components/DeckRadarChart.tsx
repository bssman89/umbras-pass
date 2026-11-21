import React, { memo, useMemo } from 'react';
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { Compass } from 'lucide-react';
import type { DeckMetrics, ResolvedDeckCard } from '../types/deck';

interface DeckRadarChartProps {
  metrics: DeckMetrics;
  resolvedCards: ResolvedDeckCard[];
}

interface RadarAxisDatum {
  metric: string;
  shortLabel: string;
  YourDeck: number;
  Benchmark: number;
  detail: string;
}

export const DeckRadarChart: React.FC<DeckRadarChartProps> = memo(({
  metrics,
  resolvedCards,
}) => {
  const radarData = useMemo<RadarAxisDatum[]>(() => {
    const rampScore = Math.min(
      100,
      Math.round((metrics.currentRamp / Math.max(1, metrics.recommendedRamp)) * 100)
    );

    const drawScore = Math.min(
      100,
      Math.round((metrics.currentDraw / Math.max(1, metrics.recommendedDraw)) * 100)
    );

    const removalScore = Math.min(
      100,
      Math.round((metrics.currentRemoval / Math.max(1, metrics.recommendedRemoval)) * 100)
    );

    const landRatio = metrics.currentLands / Math.max(1, metrics.recommendedLands);
    const landScore = Math.max(
      0,
      Math.min(100, Math.round((1 - Math.abs(1 - landRatio)) * 100))
    );

    const mainCards = (resolvedCards || []).filter(
      (c) => c && (c.zone === 'main' || c.zone === 'commander' || c.zone === 'companion')
    );
    let proactiveCount = 0;
    let totalSpells = 0;
    for (const c of mainCards) {
      if (c.card && !c.card.isLand) {
        const qty = typeof c.quantity === 'number' ? c.quantity : 1;
        totalSpells += qty;
        if (/creature|planeswalker|battle|token/.test((c.card.typeLine || '').toLowerCase())) {
          proactiveCount += qty;
        }
      }
    }
    const proactiveRatio = totalSpells > 0 ? proactiveCount / totalSpells : 0.5;
    const proactivePct = Math.round(proactiveRatio * 100);
    const boardPresenceScore = Math.min(100, Math.round(proactiveRatio * 115));

    const avgCmc = metrics?.averageCmcNonLand ?? 0;
    const curveEfficiencyScore =
      avgCmc === 0
        ? 50
        : avgCmc <= 2.2
        ? 85
        : avgCmc <= 2.8
        ? 100
        : avgCmc <= 3.5
        ? 80
        : Math.max(40, Math.round(100 - (avgCmc - 3.5) * 25));

    return [
      {
        metric: 'Ramp & Mana',
        shortLabel: 'Ramp',
        YourDeck: rampScore,
        Benchmark: 100,
        detail: `${metrics.currentRamp} / ${metrics.recommendedRamp} target`,
      },
      {
        metric: 'Card Draw',
        shortLabel: 'Draw',
        YourDeck: drawScore,
        Benchmark: 100,
        detail: `${metrics.currentDraw} / ${metrics.recommendedDraw} target`,
      },
      {
        metric: 'Removal',
        shortLabel: 'Removal',
        YourDeck: removalScore,
        Benchmark: 100,
        detail: `${metrics.currentRemoval} / ${metrics.recommendedRemoval} target`,
      },
      {
        metric: 'Land Density',
        shortLabel: 'Lands',
        YourDeck: landScore,
        Benchmark: 100,
        detail: `${metrics.currentLands} / ${metrics.recommendedLands} lands`,
      },
      {
        metric: 'Curve Efficiency',
        shortLabel: 'Curve',
        YourDeck: curveEfficiencyScore,
        Benchmark: 100,
        detail: `${avgCmc.toFixed(2)} avg MV`,
      },
      {
        metric: 'Board Presence',
        shortLabel: 'Presence',
        YourDeck: boardPresenceScore,
        Benchmark: 100,
        detail: `${proactivePct}% proactive`,
      },
    ];
  }, [metrics, resolvedCards]);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 space-y-5">
      <div className="flex flex-col gap-2 border-b border-zinc-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <Compass className="h-5 w-5 text-sky-700 shrink-0" />
          <div>
            <h3 className="font-display text-base font-semibold text-zinc-900">
              Deck Balance Profile
            </h3>
            <p className="mt-0.5 text-xs text-zinc-500">
              Six core deck pillars scored 0–100 against {metrics.detectedFormat} benchmarks
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs font-mono shrink-0">
          <span className="flex items-center gap-1.5 text-sky-700 font-semibold">
            <span className="h-2.5 w-2.5 rounded-sm bg-[#29ABE2]" aria-hidden="true" />
            Your Deck
          </span>
          <span className="flex items-center gap-1.5 text-zinc-600">
            <span className="h-2.5 w-2.5 rounded-sm bg-[#64748B]" aria-hidden="true" />
            Benchmark (100)
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.1fr_1fr] lg:items-center">
        {/* Spider Radar Visual */}
        <div className="h-[290px] w-full rounded-xl border border-zinc-100 bg-zinc-50/50 p-2">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart cx="50%" cy="50%" outerRadius="74%" data={radarData}>
              <PolarGrid stroke="#2E3748" />
              <PolarAngleAxis
                dataKey="metric"
                tick={{ fill: '#E4E4E7', fontSize: 12, fontWeight: 500 }}
              />
              <PolarRadiusAxis
                angle={90}
                domain={[0, 100]}
                tickCount={5}
                stroke="transparent"
                tick={{ fill: '#64748B', fontSize: 10 }}
              />
              <Radar
                name="Archetype Benchmark"
                dataKey="Benchmark"
                stroke="#64748B"
                strokeDasharray="4 4"
                fill="#475569"
                fillOpacity={0.14}
                isAnimationActive={false}
              />
              <Radar
                name="Your Deck"
                dataKey="YourDeck"
                stroke="#29ABE2"
                strokeWidth={2.5}
                fill="#29ABE2"
                fillOpacity={0.32}
                dot={{ r: 4, fill: '#38BDF8', stroke: '#11151d', strokeWidth: 1.5 }}
                activeDot={{ r: 5.5, fill: '#FFFFFF', stroke: '#29ABE2', strokeWidth: 2 }}
                isAnimationActive={false}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload as RadarAxisDatum;
                    return (
                      <div className="rounded-lg border border-zinc-200 bg-white p-3 shadow-lg text-xs">
                        <div className="font-semibold text-zinc-900">{data.metric}</div>
                        <div className="mt-1 font-mono tabular-nums text-sky-700">
                          Score: <span className="font-bold">{data.YourDeck} / 100</span>
                        </div>
                        <div className="mt-0.5 font-mono text-[11px] text-zinc-500">
                          {data.detail}
                        </div>
                      </div>
                    );
                  }
                  return null;
                }}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        {/* 6-Pillar Quantitative Breakdown */}
        <div className="space-y-3.5">
          {radarData.map((axis) => {
            const barColor =
              axis.YourDeck >= 85
                ? '#10B981'
                : axis.YourDeck >= 65
                ? '#29ABE2'
                : axis.YourDeck >= 45
                ? '#F59E0B'
                : '#E53924';
            const statusTextClass =
              axis.YourDeck >= 85
                ? 'text-emerald-700'
                : axis.YourDeck >= 65
                ? 'text-sky-700'
                : axis.YourDeck >= 45
                ? 'text-amber-700'
                : 'text-red-700';

            return (
              <div key={axis.metric} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-semibold text-zinc-900">{axis.metric}</span>
                    <span className="text-zinc-400" aria-hidden="true">·</span>
                    <span className="font-mono text-[11px] tabular-nums text-zinc-500 truncate">
                      {axis.detail}
                    </span>
                  </div>
                  <span className={`font-mono font-bold tabular-nums shrink-0 ${statusTextClass}`}>
                    {axis.YourDeck}/100
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100">
                  <div
                    className="h-full rounded-full transition-all duration-200"
                    style={{
                      width: `${Math.max(4, axis.YourDeck)}%`,
                      backgroundColor: barColor,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});
DeckRadarChart.displayName = 'DeckRadarChart';
