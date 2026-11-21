import React, { useId } from 'react';
import type { DeckFormat, DeckMetrics } from '../types/deck';

interface LandSpellGaugeProps {
  metrics: DeckMetrics;
  optimizedLands: number;
  optimizedTotal: number;
}

interface BenchmarkPoint {
  label: string;
  lands: number;
  pct: number;
}

interface FormatBenchmarkConfig {
  formatLabel: string;
  sweetMinPct: number;
  sweetMaxPct: number;
  sweetRangeLabel: string;
  scaleMinPct: number;
  scaleMaxPct: number;
  archetypes: BenchmarkPoint[];
}

function getFormatBenchmarks(
  format: Exclude<DeckFormat, 'auto'>,
  targetSize: number
): FormatBenchmarkConfig {
  if (format === 'commander' || (format === 'brawl' && targetSize === 100)) {
    return {
      formatLabel: format === 'commander' ? 'Commander (100-card)' : 'Brawl (100-card)',
      sweetMinPct: 35,
      sweetMaxPct: 39,
      sweetRangeLabel: '35–39 lands (35%–39%)',
      scaleMinPct: 22,
      scaleMaxPct: 50,
      archetypes: [
        { label: 'cEDH / Fast', lands: 30, pct: 30 },
        { label: 'Focused EDH', lands: 37, pct: 37 },
        { label: 'Landfall / High MV', lands: 40, pct: 40 },
      ],
    };
  }

  if (format === 'limited') {
    return {
      formatLabel: 'Limited / Draft (40-card)',
      sweetMinPct: 40,
      sweetMaxPct: 45,
      sweetRangeLabel: '16–18 lands (40%–45%)',
      scaleMinPct: 25,
      scaleMaxPct: 55,
      archetypes: [
        { label: 'Aggro', lands: 16, pct: 40 },
        { label: 'Midrange', lands: 17, pct: 42.5 },
        { label: 'Control', lands: 18, pct: 45 },
      ],
    };
  }

  if (format === 'legacy' || format === 'vintage') {
    return {
      formatLabel: `${format === 'legacy' ? 'Legacy' : 'Vintage'} (60-card)`,
      sweetMinPct: 30,
      sweetMaxPct: 39,
      sweetRangeLabel: '18–23 lands (30%–38.3%)',
      scaleMinPct: 20,
      scaleMaxPct: 50,
      archetypes: [
        { label: 'Tempo / Delver', lands: 19, pct: 31.7 },
        { label: 'Midrange', lands: 21, pct: 35 },
        { label: 'Control', lands: 23, pct: 38.3 },
      ],
    };
  }

  if (format === 'modern' || format === 'pauper') {
    return {
      formatLabel: `${format === 'modern' ? 'Modern' : 'Pauper'} (60-card)`,
      sweetMinPct: 32,
      sweetMaxPct: 41,
      sweetRangeLabel: '19–24 lands (31.7%–40%)',
      scaleMinPct: 20,
      scaleMaxPct: 50,
      archetypes: [
        { label: 'Aggro / Burn', lands: 20, pct: 33.3 },
        { label: 'Midrange', lands: 22, pct: 36.7 },
        { label: 'Control', lands: 24, pct: 40 },
      ],
    };
  }

  const labelMap: Record<string, string> = {
    standard: 'Standard (60-card)',
    pioneer: 'Pioneer (60-card)',
    brawl: 'Brawl (60-card)',
    casual60: 'Casual 60-card',
  };

  return {
    formatLabel: labelMap[format] || 'Constructed (60-card)',
    sweetMinPct: 35,
    sweetMaxPct: 43.5,
    sweetRangeLabel: '21–26 lands (35%–43.3%)',
    scaleMinPct: 20,
    scaleMaxPct: 52,
    archetypes: [
      { label: 'Aggro', lands: 21, pct: 35 },
      { label: 'Midrange', lands: 24, pct: 40 },
      { label: 'Control', lands: 26, pct: 43.3 },
    ],
  };
}

function clampPct(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, r, startAngle);
  const end = polarToCartesian(cx, cy, r, endAngle);
  const largeArcFlag = Math.abs(endAngle - startAngle) > 180 ? 1 : 0;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArcFlag} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

export const LandSpellGauge: React.FC<LandSpellGaugeProps> = ({
  metrics,
  optimizedLands,
  optimizedTotal,
}) => {
  const gaugeGradId = useId().replace(/:/g, '');
  const config = getFormatBenchmarks(metrics.detectedFormat, metrics.targetDeckSize);

  const totalCards = Math.max(1, metrics.currentMainAndCommanderCount);
  const currentLands = metrics.currentLands;
  const currentSpells = Math.max(0, totalCards - currentLands);
  const landPct = Number(((currentLands / totalCards) * 100).toFixed(1));
  const spellPct = Number((100 - landPct).toFixed(1));

  const targetLandPct = Number(
    ((metrics.recommendedLands / Math.max(1, metrics.targetDeckSize)) * 100).toFixed(1)
  );
  const optimizedLandPct =
    optimizedTotal > 0 ? Number(((optimizedLands / optimizedTotal) * 100).toFixed(1)) : landPct;

  const isBelowSweet = landPct < config.sweetMinPct;
  const isAboveSweet = landPct > config.sweetMaxPct;

  const statusLabel = isBelowSweet
    ? `Below ${config.formatLabel} meta range`
    : isAboveSweet
    ? `Above ${config.formatLabel} meta range`
    : `Within ${config.formatLabel} meta range`;

  const statusColorClass = isBelowSweet
    ? 'text-red-700'
    : isAboveSweet
    ? 'text-amber-700'
    : 'text-emerald-700';

  const gaugeStrokeColor = isBelowSweet
    ? '#E53924'
    : isAboveSweet
    ? '#F59E0B'
    : '#10B981';

  const gaugeGlowColor = isBelowSweet
    ? 'rgba(229, 57, 36, 0.35)'
    : isAboveSweet
    ? 'rgba(245, 158, 11, 0.35)'
    : 'rgba(16, 185, 129, 0.35)';

  // Map percentage within [scaleMinPct, scaleMaxPct] to semi-circle [180deg .. 360deg]
  const pctToAngle = (pct: number) => {
    const clamped = clampPct(pct, config.scaleMinPct, config.scaleMaxPct);
    const ratio = (clamped - config.scaleMinPct) / (config.scaleMaxPct - config.scaleMinPct);
    return 180 + ratio * 180;
  };

  const pctToTrackLeft = (pct: number) => {
    const clamped = clampPct(pct, config.scaleMinPct, config.scaleMaxPct);
    return ((clamped - config.scaleMinPct) / (config.scaleMaxPct - config.scaleMinPct)) * 100;
  };

  const cx = 130;
  const cy = 114;
  const radius = 86;

  const currentAngle = pctToAngle(landPct);
  const targetAngle = pctToAngle(targetLandPct);
  const sweetStartAngle = pctToAngle(config.sweetMinPct);
  const sweetEndAngle = pctToAngle(config.sweetMaxPct);

  // Rim needle spans ONLY across the arc track so center dial text stays completely unobstructed
  const needleInner = polarToCartesian(cx, cy, radius - 14, currentAngle);
  const needleOuter = polarToCartesian(cx, cy, radius + 12, currentAngle);

  // Outer target diamond indicator
  const targetMarker = polarToCartesian(cx, cy, radius + 13, targetAngle);
  const targetInner = polarToCartesian(cx, cy, radius + 7, targetAngle);

  // Scale radial tick marks (5 evenly spaced minor/major ticks)
  const scaleTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const angle = 180 + t * 180;
    const p1 = polarToCartesian(cx, cy, radius - 12, angle);
    const p2 = polarToCartesian(cx, cy, radius - 16, angle);
    return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, major: t === 0 || t === 0.5 || t === 1 };
  });

  const sweetLeftPct = pctToTrackLeft(config.sweetMinPct);
  const sweetWidthPct = pctToTrackLeft(config.sweetMaxPct) - sweetLeftPct;
  const currentPinLeftPct = clampPct(pctToTrackLeft(landPct), 3, 97);
  const optimizedPinLeftPct = clampPct(pctToTrackLeft(optimizedLandPct), 3, 97);
  const hasDistinctOptimized =
    optimizedTotal > 0 && Math.abs(optimizedLandPct - landPct) >= 0.4;

  // Stagger bottom archetype labels automatically if two adjacent benchmarks sit close (< 18% track width)
  const archetypePositions = config.archetypes.map((arch) => ({
    ...arch,
    left: pctToTrackLeft(arch.pct),
  }));

  const spellRatioStr =
    currentLands > 0 ? `1 : ${(currentSpells / currentLands).toFixed(2)}` : '0 : 1';

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6">
      {/* Header */}
      <div className="flex flex-col gap-1 border-b border-zinc-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-display text-base font-semibold text-zinc-900">
            Land-to-Spell Ratio
          </h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            {config.formatLabel} sweet spot: {config.sweetRangeLabel}
          </p>
        </div>

        <div className={`text-xs font-semibold ${statusColorClass} whitespace-nowrap`}>
          {statusLabel}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-8 lg:grid-cols-[272px_1fr] lg:items-center">
        {/* Left: Precision Semi-Circular Gauge */}
        <div className="flex flex-col items-center rounded-xl border border-zinc-100 bg-zinc-50/60 px-4 py-4">
          <svg
            viewBox="0 0 260 138"
            className="w-full max-w-[248px] overflow-visible"
            role="img"
            aria-label={`Land percentage gauge showing ${landPct}% lands (${currentLands} of ${totalCards})`}
          >
            <defs>
              <linearGradient id={`gaugeFill-${gaugeGradId}`} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor={gaugeStrokeColor} stopOpacity="0.72" />
                <stop offset="100%" stopColor={gaugeStrokeColor} stopOpacity="1" />
              </linearGradient>
              <filter id={`gaugeGlow-${gaugeGradId}`} x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor={gaugeGlowColor} />
              </filter>
            </defs>

            {/* Subtle inner reference ring */}
            <path
              d={describeArc(cx, cy, radius - 17, 180, 360)}
              fill="none"
              stroke="#242D3D"
              strokeWidth="1"
              strokeDasharray="3 4"
            />

            {/* Radial scale tick notches */}
            {scaleTicks.map((tick, idx) => (
              <line
                key={idx}
                x1={tick.x1}
                y1={tick.y1}
                x2={tick.x2}
                y2={tick.y2}
                stroke={tick.major ? '#64748B' : '#334155'}
                strokeWidth={tick.major ? 1.5 : 1}
                strokeLinecap="round"
              />
            ))}

            {/* Background arc track */}
            <path
              d={describeArc(cx, cy, radius, 180, 360)}
              fill="none"
              stroke="#263042"
              strokeWidth="14"
              strokeLinecap="round"
            />

            {/* Meta sweet-spot zone band */}
            <path
              d={describeArc(cx, cy, radius, sweetStartAngle, sweetEndAngle)}
              fill="none"
              stroke="rgba(16, 185, 129, 0.28)"
              strokeWidth="18"
            />
            <path
              d={describeArc(cx, cy, radius, sweetStartAngle, sweetEndAngle)}
              fill="none"
              stroke="rgba(52, 211, 153, 0.55)"
              strokeWidth="2"
              transform={`translate(0, 0)`}
            />

            {/* Active progress arc */}
            <path
              d={describeArc(cx, cy, radius, 180, currentAngle)}
              fill="none"
              stroke={`url(#gaugeFill-${gaugeGradId})`}
              strokeWidth="14"
              strokeLinecap="round"
              filter={`url(#gaugeGlow-${gaugeGradId})`}
            />

            {/* Recommended target outer tick + dot */}
            <line
              x1={targetInner.x}
              y1={targetInner.y}
              x2={targetMarker.x}
              y2={targetMarker.y}
              stroke="#38BDF8"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <circle
              cx={targetMarker.x}
              cy={targetMarker.y}
              r="3.5"
              fill="#38BDF8"
              stroke="#11151D"
              strokeWidth="1.5"
            />

            {/* Rim indicator pointer (never crosses center text) */}
            <line
              x1={needleInner.x}
              y1={needleInner.y}
              x2={needleOuter.x}
              y2={needleOuter.y}
              stroke="#11151D"
              strokeWidth="6"
              strokeLinecap="round"
            />
            <line
              x1={needleInner.x}
              y1={needleInner.y}
              x2={needleOuter.x}
              y2={needleOuter.y}
              stroke="#FFFFFF"
              strokeWidth="2.8"
              strokeLinecap="round"
            />
            <circle
              cx={needleOuter.x}
              cy={needleOuter.y}
              r="3.2"
              fill={gaugeStrokeColor}
              stroke="#FFFFFF"
              strokeWidth="1.5"
            />

            {/* Center readout (completely clear & unobstructed) */}
            <text
              x={cx}
              y={cy - 22}
              textAnchor="middle"
              fill="#FFFFFF"
              className="font-mono tabular-nums"
              style={{ fontSize: '28px', fontWeight: 700, letterSpacing: '-0.02em' }}
            >
              {landPct}%
            </text>
            <text
              x={cx}
              y={cy - 3}
              textAnchor="middle"
              fill="#CBD5E1"
              className="font-mono tabular-nums"
              style={{ fontSize: '11px', fontWeight: 500 }}
            >
              {currentLands} / {totalCards} Lands
            </text>
          </svg>

          {/* Scale bounds & Target readout */}
          <div className="mt-1 flex w-full items-center justify-between px-2 text-[11px] font-mono tabular-nums text-zinc-500">
            <span>{config.scaleMinPct}%</span>
            <span className="inline-flex items-center gap-1.5 font-semibold text-sky-700">
              <span className="h-2 w-2 rounded-full bg-[#38BDF8]" aria-hidden="true" />
              Target: {targetLandPct}% ({metrics.recommendedLands})
            </span>
            <span>{config.scaleMaxPct}%</span>
          </div>
        </div>

        {/* Right: Dual-Segment Ratio Bar + Multi-Lane Meta Benchmark Track */}
        <div className="space-y-7">
          {/* 1. Current Land vs Spell Split Bar */}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-medium text-zinc-700">Deck Composition</span>
                <span className="inline-flex items-center gap-1.5 font-mono font-semibold tabular-nums text-zinc-900">
                  <span
                    className="h-2.5 w-2.5 rounded-sm shrink-0"
                    style={{ backgroundColor: gaugeStrokeColor }}
                    aria-hidden="true"
                  />
                  {currentLands} Lands ({landPct}%)
                </span>
                <span className="text-zinc-400" aria-hidden="true">/</span>
                <span className="inline-flex items-center gap-1.5 font-mono font-semibold tabular-nums text-zinc-900">
                  <span
                    className="h-2.5 w-2.5 rounded-sm bg-[#29ABE2] shrink-0"
                    aria-hidden="true"
                  />
                  {currentSpells} Spells ({spellPct}%)
                </span>
              </div>
              <span className="font-mono text-zinc-500 tabular-nums">
                Ratio {spellRatioStr}
              </span>
            </div>

            <div className="mt-2.5 flex h-6 w-full overflow-hidden rounded-lg border border-zinc-200 bg-[#11151d] p-0.5 gap-0.5">
              <div
                className="flex h-full items-center justify-center rounded-l-md text-[11px] font-mono font-semibold tabular-nums text-white transition-all duration-200"
                style={{
                  width: `${landPct}%`,
                  background: `linear-gradient(90deg, ${gaugeStrokeColor}cc, ${gaugeStrokeColor})`,
                }}
                title={`Lands: ${currentLands} (${landPct}%)`}
              >
                {landPct >= 16 && `${landPct}%`}
              </div>
              <div
                className="flex h-full items-center justify-center rounded-r-md text-[11px] font-mono font-semibold tabular-nums text-white transition-all duration-200"
                style={{
                  width: `${spellPct}%`,
                  background: 'linear-gradient(90deg, #1d6f96, #29ABE2)',
                }}
                title={`Spells: ${currentSpells} (${spellPct}%)`}
              >
                {spellPct >= 16 && `${spellPct}%`}
              </div>
            </div>
          </div>

          {/* 2. Format Meta Benchmark Comparison Track (Collision-Free 3-Lane Layout) */}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-medium text-zinc-700">
                {config.formatLabel} Meta Benchmark Track
              </span>
              <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-500">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 rounded-sm shrink-0"
                    style={{ backgroundColor: gaugeStrokeColor }}
                    aria-hidden="true"
                  />
                  Current:{' '}
                  <span className="font-mono font-semibold tabular-nums text-zinc-900">
                    {landPct}%
                  </span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 rounded-sm bg-[#38BDF8] shrink-0"
                    aria-hidden="true"
                  />
                  After Checked Fixes:{' '}
                  <span className="font-mono font-semibold tabular-nums text-sky-700">
                    {optimizedLandPct}% ({optimizedLands}/{optimizedTotal})
                  </span>
                </span>
              </div>
            </div>

            {/* Lane 1: Top Callout Tags (Strictly Above Track) */}
            <div className="relative mt-4 h-7 w-full">
              <div
                className="absolute bottom-0 flex flex-col items-center whitespace-nowrap"
                style={{
                  left: `${currentPinLeftPct}%`,
                  transform: 'translateX(-50%)',
                }}
              >
                <span
                  className="rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-white shadow-sm"
                  style={{ backgroundColor: gaugeStrokeColor }}
                >
                  Deck {landPct}%
                </span>
                <span
                  className="h-0 w-0 border-x-4 border-t-4 border-x-transparent"
                  style={{ borderTopColor: gaugeStrokeColor }}
                  aria-hidden="true"
                />
              </div>

              {hasDistinctOptimized && (
                <div
                  className="absolute bottom-0 flex flex-col items-center whitespace-nowrap"
                  style={{
                    left: `${optimizedPinLeftPct}%`,
                    transform:
                      Math.abs(optimizedPinLeftPct - currentPinLeftPct) < 16
                        ? optimizedPinLeftPct >= currentPinLeftPct
                          ? 'translateX(4px)'
                          : 'translateX(calc(-100% - 4px))'
                        : 'translateX(-50%)',
                  }}
                >
                  <span className="rounded bg-[#0284C7] px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-white shadow-sm">
                    Fixes {optimizedLandPct}%
                  </span>
                  <span
                    className="h-0 w-0 border-x-4 border-t-4 border-x-transparent border-t-[#0284C7]"
                    aria-hidden="true"
                  />
                </div>
              )}
            </div>

            {/* Lane 2: Scale Track with Sweet-Spot Window, Ticks & Pins */}
            <div className="relative mt-1 h-4 w-full rounded-full border border-zinc-200 bg-zinc-100">
              {/* Subtle 25% / 50% / 75% ruler hairlines */}
              {[25, 50, 75].map((pct) => (
                <div
                  key={pct}
                  className="pointer-events-none absolute top-0 bottom-0 w-px bg-zinc-200/70"
                  style={{ left: `${pct}%` }}
                />
              ))}

              {/* Meta sweet-spot highlighted zone */}
              <div
                className="absolute top-0 bottom-0 rounded-full border border-emerald-400/60 bg-emerald-500/25"
                style={{ left: `${sweetLeftPct}%`, width: `${sweetWidthPct}%` }}
                title={`Meta sweet spot: ${config.sweetRangeLabel}`}
              />

              {/* Archetype tick marks on the track */}
              {archetypePositions.map((arch) => (
                <div
                  key={arch.label}
                  className="absolute top-0 bottom-0 flex flex-col items-center"
                  style={{ left: `${arch.left}%`, transform: 'translateX(-50%)' }}
                >
                  <div className="h-full w-0.5 bg-zinc-400" />
                </div>
              ))}

              {/* Optimized marker pin */}
              {hasDistinctOptimized && (
                <div
                  className="absolute -top-1 h-6 w-2 rounded-full border border-white bg-[#38BDF8] shadow-sm"
                  style={{ left: `${optimizedPinLeftPct}%`, transform: 'translateX(-50%)' }}
                  title={`After Checked Fixes: ${optimizedLandPct}%`}
                />
              )}

              {/* Current deck pin */}
              <div
                className="absolute -top-1 h-6 w-2.5 rounded-full border-2 border-white shadow-md"
                style={{
                  left: `${currentPinLeftPct}%`,
                  transform: 'translateX(-50%)',
                  backgroundColor: gaugeStrokeColor,
                }}
                title={`Your Deck: ${landPct}%`}
              />
            </div>

            {/* Lane 3: Bottom Archetype Labels with Staggered Rows to Guarantee Zero Overlap */}
            <div className="relative mt-1 h-16 w-full">
              {archetypePositions.map((arch, idx) => {
                // Alternate vertical tier if neighboring labels are close horizontally
                const prevLeft = idx > 0 ? archetypePositions[idx - 1].left : -100;
                const isCrowdedWithPrev = Math.abs(arch.left - prevLeft) < 22;
                const isLowerTier = idx % 2 === 1 && isCrowdedWithPrev;

                return (
                  <div
                    key={arch.label}
                    className="absolute top-0 flex flex-col items-center"
                    style={{
                      left: `${arch.left}%`,
                      transform: 'translateX(-50%)',
                    }}
                  >
                    <div
                      className={`w-px bg-zinc-400/70 ${isLowerTier ? 'h-6' : 'h-2.5'}`}
                      aria-hidden="true"
                    />
                    <div className="whitespace-nowrap rounded px-1.5 py-0.5 text-center leading-tight">
                      <div className="text-[11px] font-medium text-zinc-700">{arch.label}</div>
                      <div className="font-mono text-[10px] tabular-nums text-zinc-500">
                        {arch.lands} lands ({arch.pct}%)
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
