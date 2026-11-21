import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ColorBreakdownItem, ManaColor } from '../types/deck';

interface ColorPipsChartProps {
  colorBreakdown: ColorBreakdownItem[];
}

const MANA_FILL: Record<ManaColor, string> = {
  W: '#F59E0B',
  U: '#29ABE2',
  B: '#A855F7',
  R: '#E53924',
  G: '#22C55E',
  C: '#94A3B8',
};

interface PipChartDatum {
  color: ManaColor;
  label: string;
  pips: number;
  pipSharePct: number;
  currentSources: number;
  recommendedSources: number;
  tier: string;
  fill: string;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: PipChartDatum }>;
  mode: 'pips' | 'sources';
}

const PipTooltip: React.FC<CustomTooltipProps> = ({ active, payload, mode }) => {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0].payload;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-3.5 py-2.5 text-xs shadow-sm">
      <div className="flex items-center gap-2 font-semibold text-zinc-900">
        <span
          className="h-2.5 w-2.5 rounded-sm shrink-0"
          style={{ backgroundColor: item.fill }}
          aria-hidden="true"
        />
        <span>{item.label}</span>
        <span className="text-zinc-400">·</span>
        <span className="font-medium text-zinc-600">{item.tier}</span>
      </div>
      {mode === 'pips' ? (
        <div className="mt-1.5 space-y-0.5 font-mono tabular-nums text-zinc-700">
          <div>
            Spell Pips: <span className="font-semibold text-zinc-900">{item.pips}</span> ({item.pipSharePct}%)
          </div>
          <div>
            Mana Sources: <span className="font-semibold text-zinc-900">{item.currentSources}</span> / {item.recommendedSources} needed
          </div>
        </div>
      ) : (
        <div className="mt-1.5 space-y-0.5 font-mono tabular-nums text-zinc-700">
          <div>
            Current Sources: <span className="font-semibold text-zinc-900">{item.currentSources}</span>
          </div>
          <div>
            Recommended: <span className="font-semibold text-sky-700">{item.recommendedSources}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export const ColorPipsChart: React.FC<ColorPipsChartProps> = ({ colorBreakdown }) => {
  const [chartMode, setChartMode] = useState<'pips' | 'sources'>('pips');

  const chartData = useMemo<PipChartDatum[]>(() => {
    const active = (colorBreakdown ?? [])
      .filter((c) => c.status !== 'unused')
      .sort((a, b) => b.pips - a.pips);

    return active.map((c, idx) => {
      let tier = 'Splash';
      if (idx === 0 && c.pips > 0) tier = 'Primary';
      else if (idx === 1 && c.pips > 0 && c.pipSharePct >= 20) tier = 'Secondary';
      else if (c.pips === 0) tier = 'Unused Pips';

      return {
        color: c.color,
        label: c.label,
        pips: c.pips,
        pipSharePct: c.pipSharePct,
        currentSources: c.currentSources,
        recommendedSources: c.recommendedSources,
        tier,
        fill: MANA_FILL[c.color],
      };
    });
  }, [colorBreakdown]);

  const primaryColor = chartData.find((d) => d.pips > 0);
  const secondaryColor = chartData.filter((d) => d.pips > 0)[1];

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-base font-semibold text-zinc-900">
            Color Pips Distribution
          </h3>
          {primaryColor && (
            <p className="mt-0.5 text-xs text-zinc-500">
              Primary: <span className="font-medium text-zinc-800">{primaryColor.label} ({primaryColor.pipSharePct}%)</span>
              {secondaryColor && (
                <>
                  <span className="mx-1.5" aria-hidden="true">·</span>
                  Secondary: <span className="font-medium text-zinc-800">{secondaryColor.label} ({secondaryColor.pipSharePct}%)</span>
                </>
              )}
            </p>
          )}
        </div>

        <div className="inline-flex items-center gap-1 rounded-lg bg-zinc-100 p-1">
          <button
            type="button"
            onClick={() => setChartMode('pips')}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              chartMode === 'pips'
                ? 'bg-white text-zinc-900 shadow-sm'
                : 'text-zinc-600 hover:text-zinc-900'
            }`}
          >
            Pip Share
          </button>
          <button
            type="button"
            onClick={() => setChartMode('sources')}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              chartMode === 'sources'
                ? 'bg-white text-zinc-900 shadow-sm'
                : 'text-zinc-600 hover:text-zinc-900'
            }`}
          >
            Have vs. Need
          </button>
        </div>
      </div>

      {chartData.length === 0 ? (
        <p className="mt-8 text-sm text-zinc-500">
          This deck contains only colorless mana costs.
        </p>
      ) : (
        <div className="mt-5 h-[220px] w-full">
          <ResponsiveContainer width="100%" height={220}>
            {chartMode === 'pips' ? (
              <BarChart
                data={chartData}
                layout="vertical"
                margin={{ top: 4, right: 56, left: 4, bottom: 4 }}
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
                  dataKey="label"
                  width={64}
                  tick={{ fontSize: 12, fill: '#F4F4F5', fontWeight: 500 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(41, 171, 226, 0.12)' }}
                  content={<PipTooltip mode="pips" />}
                />
                <Bar dataKey="pips" radius={[0, 5, 5, 0]} barSize={22}>
                  {chartData.map((entry) => (
                    <Cell key={entry.color} fill={entry.fill} />
                  ))}
                  <LabelList
                    dataKey="pips"
                    position="right"
                    style={{
                      fill: '#E4E4E7',
                      fontSize: 11,
                      fontWeight: 600,
                      fontFamily: 'JetBrains Mono, monospace',
                    }}
                  />
                </Bar>
              </BarChart>
            ) : (
              <BarChart
                data={chartData}
                margin={{ top: 18, right: 12, left: -12, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#2C3444" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 12, fill: '#F4F4F5', fontWeight: 500 }}
                  axisLine={{ stroke: '#3B4458' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#B4BCD0' }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(41, 171, 226, 0.12)' }}
                  content={<PipTooltip mode="sources" />}
                />
                <Legend
                  wrapperStyle={{ fontSize: '12px', paddingTop: '6px', color: '#E4E4E7' }}
                />
                <Bar
                  dataKey="currentSources"
                  name="Have Sources"
                  fill="#29ABE2"
                  radius={[4, 4, 0, 0]}
                  barSize={20}
                >
                  <LabelList
                    dataKey="currentSources"
                    position="top"
                    style={{ fill: '#38BDF8', fontSize: 10, fontWeight: 600, fontFamily: 'JetBrains Mono, monospace' }}
                  />
                </Bar>
                <Bar
                  dataKey="recommendedSources"
                  name="Need Sources"
                  fill="#64748B"
                  radius={[4, 4, 0, 0]}
                  barSize={20}
                >
                  <LabelList
                    dataKey="recommendedSources"
                    position="top"
                    style={{ fill: '#94A3B8', fontSize: 10, fontWeight: 600, fontFamily: 'JetBrains Mono, monospace' }}
                  />
                </Bar>
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};
