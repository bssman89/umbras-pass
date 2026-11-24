import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Calculator,
  Check,
  ChevronDown,
  ChevronUp,
  Dices,
  RefreshCw,
  RotateCcw,
} from 'lucide-react';
import type {
  CardMetadata,
  ColorBreakdownItem,
  ManaColor,
  ResolvedDeckCard,
} from '../types/deck';
import type { ExportDeckEntry } from '../utils/deckExport';
import {
  buildLibraryUnits,
  drawSampleOpeningHand,
  runOpeningHandMonteCarlo,
  type DrawnHandReport,
} from '../utils/manaCalculator';
import { CardLink } from './CardInspectorModal';
import {
  buildHoverRect,
  hideGlobalCardHover,
  showGlobalCardHover,
} from './CardHoverZoomOverlay';

interface ManaCalculatorProps {
  deckName: string;
  resolvedCards: ResolvedDeckCard[];
  optimizedEntries: ExportDeckEntry[];
  colorBreakdown: ColorBreakdownItem[];
  onInspectCard: (name: string, meta?: CardMetadata | null) => void;
  onSyncManaToPlaytest?: () => void;
  isPlaytestManaSynced?: boolean;
}

const PIP_OPTIONS: Array<{ color: ManaColor; label: string; badgeClass: string }> = [
  { color: 'W', label: 'W', badgeClass: 'border-amber-300 bg-amber-50 text-amber-900' },
  { color: 'U', label: 'U', badgeClass: 'border-blue-300 bg-blue-50 text-blue-900' },
  { color: 'B', label: 'B', badgeClass: 'border-zinc-400 bg-zinc-100 text-zinc-900' },
  { color: 'R', label: 'R', badgeClass: 'border-red-300 bg-red-50 text-red-900' },
  { color: 'G', label: 'G', badgeClass: 'border-emerald-300 bg-emerald-50 text-emerald-900' },
  { color: 'C', label: 'C', badgeClass: 'border-zinc-300 bg-zinc-50 text-zinc-700' },
];

export const ManaCalculator: React.FC<ManaCalculatorProps> = ({
  deckName,
  resolvedCards,
  optimizedEntries,
  colorBreakdown,
  onInspectCard,
  onSyncManaToPlaytest,
  isPlaytestManaSynced = false,
}) => {
  const [deckMode, setDeckMode] = useState<'current' | 'optimized'>('current');
  const [onPlay, setOnPlay] = useState(true);
  const [mulliganCount, setMulliganCount] = useState(0);
  const [showTopdecks, setShowTopdecks] = useState(false);
  const [simSeed, setSimSeed] = useState(0);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());

  // Default custom castability test to the deck's primary + secondary color at Turn 2
  const defaultPips = useMemo<ManaColor[]>(() => {
    const active = (colorBreakdown || [])
      .filter((c) => c && c.color !== 'C' && c.status !== 'unused' && c.pips > 0)
      .sort((a, b) => b.pips - a.pips);
    if (active.length >= 2) return [active[0].color, active[1].color];
    if (active.length === 1) return [active[0].color, active[0].color];
    return [];
  }, [colorBreakdown]);

  const defaultPipsKey = defaultPips.join(',');

  const [customTurn, setCustomTurn] = useState<number>(2);
  const [customGeneric, setCustomGeneric] = useState<number>(1);
  const [customPips, setCustomPips] = useState<ManaColor[]>(defaultPips);

  useEffect(() => {
    const nextPips = defaultPipsKey
      ? (defaultPipsKey.split(',') as ManaColor[])
      : [];
    setCustomPips(nextPips);
    setCustomGeneric(nextPips.length >= 2 ? 0 : 1);
    setCustomTurn(2);
  }, [defaultPipsKey]);

  const currentUnits = useMemo(
    () => buildLibraryUnits({ kind: 'resolved', cards: resolvedCards || [] }),
    [resolvedCards]
  );

  const optimizedUnits = useMemo(
    () => buildLibraryUnits({ kind: 'optimized', entries: optimizedEntries || [] }),
    [optimizedEntries]
  );

  const activeUnits = deckMode === 'optimized' ? optimizedUnits : currentUnits;

  const currentLandCount = useMemo(
    () => currentUnits.filter((u) => u.isLand).length,
    [currentUnits]
  );
  const optimizedLandCount = useMemo(
    () => optimizedUnits.filter((u) => u.isLand).length,
    [optimizedUnits]
  );

  const [sampleHand, setSampleHand] = useState<DrawnHandReport>(() =>
    drawSampleOpeningHand(activeUnits, 0, true)
  );

  // Re-draw sample hand when deck list or deck mode changes
  useEffect(() => {
    setMulliganCount(0);
    setFailedImages(new Set());
    setSampleHand(drawSampleOpeningHand(activeUnits, 0, onPlay));
  }, [activeUnits, onPlay]);

  const currentSim = useMemo(
    () =>
      runOpeningHandMonteCarlo({
        units: currentUnits,
        trials: 2000,
        onPlay,
        customTurn,
        customGeneric,
        customPips,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentUnits, onPlay, customTurn, customGeneric, customPips, simSeed]
  );

  const optimizedSim = useMemo(
    () =>
      runOpeningHandMonteCarlo({
        units: optimizedUnits,
        trials: 2000,
        onPlay,
        customTurn,
        customGeneric,
        customPips,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [optimizedUnits, onPlay, customTurn, customGeneric, customPips, simSeed]
  );

  const activeSim = deckMode === 'optimized' ? optimizedSim : currentSim;

  const currentSpellPctMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const sp of currentSim?.earlySpells || []) {
      map.set(sp.name.toLowerCase(), sp.castablePct);
    }
    return map;
  }, [currentSim?.earlySpells]);

  const handleDrawNewHand = () => {
    setMulliganCount(0);
    setFailedImages(new Set());
    setSampleHand(drawSampleOpeningHand(activeUnits, 0, onPlay));
  };

  const handleMulligan = () => {
    const nextMull = Math.min(4, mulliganCount + 1);
    setMulliganCount(nextMull);
    setFailedImages(new Set());
    setSampleHand(drawSampleOpeningHand(activeUnits, nextMull, onPlay));
  };

  const addCustomPip = (color: ManaColor) => {
    if (customPips.length + customGeneric >= 6) return;
    setCustomPips((prev) => [...prev, color]);
  };

  const removeCustomPip = (idx: number) => {
    setCustomPips((prev) => prev.filter((_, i) => i !== idx));
  };

  const customCostDisplay = useMemo(() => {
    const parts: string[] = [];
    if (customGeneric > 0 || customPips.length === 0) {
      parts.push(`{${customGeneric}}`);
    }
    for (const p of customPips) {
      parts.push(`{${p}}`);
    }
    return parts.join('');
  }, [customGeneric, customPips]);

  const customManaNeeded = customGeneric + customPips.length;

  return (
    <section id="mana-calculator-section" className="space-y-4 scroll-mt-20">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-display text-xl font-bold text-zinc-900">
            Opening Hands
          </h2>
          <p className="mt-0.5 text-sm text-zinc-600">
            Deal practice opening hands, test mulligans, and check your odds of casting key spells on turns 1 through 4.
          </p>
        </div>

        {onSyncManaToPlaytest && (
          <button
            type="button"
            onClick={onSyncManaToPlaytest}
            className={`inline-flex min-h-[40px] items-center gap-2 rounded-lg border px-4 py-2 text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              isPlaytestManaSynced
                ? 'border-sky-300 bg-sky-50 text-sky-900 hover:bg-sky-100'
                : 'border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50'
            }`}
          >
            {isPlaytestManaSynced ? (
              <>
                <Check className="h-4 w-4 text-sky-700 shrink-0" />
                <span>Mana Synced · Open Playtest</span>
              </>
            ) : (
              <>
                <span>Test Updated Mana in Playtest</span>
                <ArrowRight className="h-4 w-4 text-sky-700 shrink-0" />
              </>
            )}
          </button>
        )}
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-6 space-y-6">
        {/* Controls Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-100 pb-4">
          <div className="flex flex-wrap items-center gap-3">
            {/* Deck Version Switcher */}
            <div className="inline-flex flex-wrap items-center gap-1.5 rounded-xl bg-zinc-100 p-1.5">
              <button
                type="button"
                onClick={() => setDeckMode('current')}
                className={`min-h-[38px] px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  deckMode === 'current'
                    ? 'bg-white text-zinc-900 shadow-sm'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                Current List ({currentLandCount} Lands)
              </button>
              <button
                type="button"
                onClick={() => setDeckMode('optimized')}
                className={`min-h-[38px] px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  deckMode === 'optimized'
                    ? 'bg-white text-zinc-900 shadow-sm'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                With Selected Fixes ({optimizedLandCount} Lands)
              </button>
            </div>

            {/* Play / Draw Switcher */}
            <div className="inline-flex items-center gap-1.5 rounded-xl bg-zinc-100 p-1.5">
              <button
                type="button"
                onClick={() => setOnPlay(true)}
                className={`min-h-[38px] px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  onPlay
                    ? 'bg-white text-zinc-900 shadow-sm'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                On the Play
              </button>
              <button
                type="button"
                onClick={() => setOnPlay(false)}
                className={`min-h-[38px] px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  !onPlay
                    ? 'bg-white text-zinc-900 shadow-sm'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                On the Draw
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={handleDrawNewHand}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-sky-700 px-4 py-2 text-xs sm:text-sm font-semibold text-white hover:bg-sky-800 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Dices className="h-4 w-4 shrink-0" />
              Draw New 7
            </button>

            <button
              type="button"
              onClick={handleMulligan}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 py-2 text-xs sm:text-sm font-semibold text-zinc-800 hover:bg-zinc-50 cursor-pointer whitespace-nowrap shrink-0"
            >
              <RotateCcw className="h-4 w-4 shrink-0" />
              Mulligan{mulliganCount > 0 ? ` (#${mulliganCount})` : ''}
            </button>

            <button
              type="button"
              onClick={() => setSimSeed((s) => s + 1)}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 py-2 text-xs sm:text-sm font-semibold text-zinc-800 hover:bg-zinc-50 cursor-pointer whitespace-nowrap shrink-0"
            >
              <RefreshCw className="h-4 w-4 text-sky-700 shrink-0" />
              Re-simulate 2,000 Hands
            </button>
          </div>
        </div>

        {/* Sample Opening 7 Simulator */}
        <div className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-0.5">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-display font-semibold text-zinc-900">
                  Simulated Opening 7
                </span>
                <span className="text-zinc-300" aria-hidden="true">·</span>
                <span className="font-mono text-xs tabular-nums text-zinc-700">
                  {sampleHand.landsInHand} lands ({sampleHand.untappedLandsInHand} untapped,{' '}
                  {sampleHand.tappedLandsInHand} tapped)
                </span>
                <span className="text-zinc-300" aria-hidden="true">·</span>
                <span
                  className={`text-xs font-semibold ${
                    sampleHand.keepVerdict === 'keepable'
                      ? 'text-emerald-700'
                      : 'text-amber-700'
                  }`}
                >
                  {sampleHand.keepVerdict === 'keepable'
                    ? 'Keepable'
                    : sampleHand.keepVerdict === 'risky-low'
                    ? 'Mulligan Risk (Too Few Lands)'
                    : 'Mulligan Risk (Land Heavy)'}
                </span>
              </div>
              <p className="text-xs text-zinc-600">{sampleHand.keepVerdictText}</p>
            </div>

            <button
              type="button"
              onClick={() => setShowTopdecks((v) => !v)}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-zinc-100 hover:text-sky-900 cursor-pointer whitespace-nowrap shrink-0"
            >
              {showTopdecks ? (
                <>
                  <ChevronUp className="h-4 w-4 shrink-0" />
                  Hide Turns 1–4 topdecks
                </>
              ) : (
                <>
                  <ChevronDown className="h-4 w-4 shrink-0" />
                  Peek Turns 1–4 topdecks
                </>
              )}
            </button>
          </div>

          {/* 7-Card Hand Grid */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {(sampleHand?.hand || []).map((card, idx) => {
              const imgUri = card.meta?.imageUri || '';
              const broken = !imgUri || failedImages.has(`${card.id}-${idx}`);
              const statusColor = card.statusLabel.startsWith('Castable') || card.statusLabel === 'Untapped'
                ? 'text-emerald-700'
                : card.statusLabel.startsWith('Blocked') || card.statusLabel === 'Enters Tapped'
                ? 'text-amber-700'
                : 'text-zinc-500';

              const statusTooltip = card.statusLabel.startsWith('Blocked T')
                ? `Cannot cast on ${card.statusLabel.replace('Blocked T', 'Turn ')} with the lands drawn so far (missing untapped mana or required colors)`
                : card.statusLabel.startsWith('Castable T')
                ? `Castable on ${card.statusLabel.replace('Castable T', 'Turn ')} with the lands drawn so far`
                : card.statusLabel === 'Enters Tapped'
                ? 'This land enters the battlefield tapped'
                : card.statusLabel === 'Untapped'
                ? 'This land enters untapped and can produce mana immediately'
                : undefined;

              return (
                <button
                  key={`${card.id}-${idx}`}
                  type="button"
                  onMouseEnter={(e) =>
                    showGlobalCardHover({
                      name: card.name,
                      meta: card.meta,
                      rect: buildHoverRect(e.currentTarget),
                      statusTags: card.statusLabel ? [card.statusLabel] : undefined,
                    })
                  }
                  onMouseLeave={hideGlobalCardHover}
                  onClick={() => {
                    hideGlobalCardHover();
                    onInspectCard(card.name, card.meta);
                  }}
                  className="group flex flex-col text-left rounded-lg border border-zinc-200 bg-white p-2 hover:border-sky-600 transition-colors cursor-pointer"
                >
                  <div className="relative aspect-[5/7] w-full overflow-hidden rounded-md bg-zinc-100">
                    {!broken ? (
                      <img
                        src={imgUri}
                        alt={card.name}
                        referrerPolicy="no-referrer"
                        onError={() =>
                          setFailedImages((prev) =>
                            new Set(prev).add(`${card.id}-${idx}`)
                          )
                        }
                        className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                      />
                    ) : (
                      <div className="flex h-full w-full flex-col items-center justify-center p-2 text-center">
                        <span className="text-xs font-semibold text-zinc-800 line-clamp-2">
                          {card.name}
                        </span>
                        {card.manaCost && (
                          <span className="mt-1 font-mono text-[10px] text-zinc-500">
                            {card.manaCost}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="mt-2 space-y-0.5 px-0.5">
                    <div className="truncate text-xs font-semibold text-zinc-900 group-hover:text-sky-700">
                      {card.name}
                    </div>
                    <div className="flex items-center justify-between gap-1 text-xs font-mono tabular-nums">
                      <span className={`font-medium ${statusColor}`} title={statusTooltip}>
                        {card.statusLabel}
                      </span>
                      {!card.isLand && card.manaCost && (
                        <span className="text-zinc-400 truncate">
                          {card.manaCost}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Optional Topdeck Peek */}
          {showTopdecks && (sampleHand?.nextDraws || []).length > 0 && (
            <div className="border-t border-zinc-100 pt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
              <span className="font-semibold text-zinc-700">Next 4 library draws:</span>
              {(sampleHand?.nextDraws || []).map((d, i) => (
                <div key={`${d.id}-next-${i}`} className="flex items-center gap-1.5">
                  <span className="font-mono text-zinc-400">+{i + 1}:</span>
                  <CardLink
                    name={d.name}
                    meta={d.meta}
                    onInspect={onInspectCard}
                    className="text-xs"
                  />
                  <span className="font-mono text-xs text-zinc-500">
                    ({d.statusLabel})
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 2,000-Hand Monte Carlo Consistency Metrics */}
        <div className="border-t border-zinc-200 pt-6 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Calculator className="h-4 w-4 text-sky-700 shrink-0" />
              <h3 className="font-display text-base font-semibold text-zinc-900">
                2,000-Hand Consistency Forecast
              </h3>
            </div>
            <span className="font-mono text-xs tabular-nums text-zinc-500">
              {activeSim.librarySize}-card library · {activeSim.landCount} lands ·{' '}
              {onPlay ? 'On the Play' : 'On the Draw'}
            </span>
          </div>

          {/* 4-Column Summary Strip */}
          <div className="grid grid-cols-2 gap-6 border-y border-zinc-100 py-4 sm:grid-cols-4">
            <div>
              <div className="text-xs font-medium text-zinc-500">Keepable Opening 7</div>
              <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-sky-700">
                {activeSim.keepablePct}%
              </div>
              <div className="mt-0.5 text-xs text-zinc-500">
                {activeSim.librarySize >= 85 ? '2–5 lands in hand' : '2–4 lands in hand'}
              </div>
            </div>

            <div>
              <div className="text-xs font-medium text-zinc-500">Mana Screw (0–1 Lands)</div>
              <div
                className={`mt-1 font-mono text-2xl font-bold tabular-nums ${
                  activeSim.screwPct >= 25 ? 'text-red-700' : 'text-zinc-900'
                }`}
              >
                {activeSim.screwPct}%
              </div>
              <div className="mt-0.5 text-xs text-zinc-500">
                Forced low-land mulligans
              </div>
            </div>

            <div>
              <div className="text-xs font-medium text-zinc-500">Land Flood Risk</div>
              <div
                className={`mt-1 font-mono text-2xl font-bold tabular-nums ${
                  activeSim.floodPct >= 15 ? 'text-amber-700' : 'text-zinc-900'
                }`}
              >
                {activeSim.floodPct}%
              </div>
              <div className="mt-0.5 text-xs text-zinc-500">
                {activeSim.librarySize >= 85 ? '6+ lands in opening 7' : '5+ lands in opening 7'}
              </div>
            </div>

            <div>
              <div className="text-xs font-medium text-zinc-500">Avg. Lands Drawn in 7</div>
              <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-zinc-900">
                {activeSim.avgLandsInSeven.toFixed(2)}
              </div>
              <div className="mt-0.5 text-xs text-zinc-500">
                Expected opening hand lands
              </div>
            </div>
          </div>

          {/* 2-Column Analytical Split: Turn 1-4 Curve + Custom Cost | Early Spells Castability */}
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 lg:items-start">
            {/* Left: Turn 1-4 Land Drops & Custom Cost Checker */}
            <div className="space-y-6">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-zinc-900">
                    Turns 1–4 Land &amp; Mana Availability
                  </h4>
                  <span className="text-xs text-zinc-500">Accounts for tapped lands</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-zinc-200 text-xs font-medium text-zinc-500">
                        <th className="py-2 pr-3">Turn</th>
                        <th className="py-2 px-2 text-right">Hit Land Drop</th>
                        <th className="py-2 pl-2 text-right">Untapped Full Mana</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {(activeSim?.turnStats || []).map((ts) => (
                        <tr key={ts.turn} className="h-10">
                          <td className="py-2 pr-3 font-mono text-xs font-semibold text-zinc-900">
                            Turn {ts.turn} ({ts.turn} land{ts.turn === 1 ? '' : 's'})
                          </td>
                          <td className="py-2 px-2 text-right font-mono text-xs tabular-nums text-zinc-700">
                            {ts.hitLandDropPct}%
                          </td>
                          <td
                            className={`py-2 pl-2 text-right font-mono text-xs font-semibold tabular-nums ${
                              ts.fullManaOnTurnPct >= 80
                                ? 'text-emerald-700'
                                : ts.fullManaOnTurnPct >= 65
                                ? 'text-sky-700'
                                : 'text-amber-700'
                            }`}
                          >
                            {ts.fullManaOnTurnPct}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Interactive Custom Spell Cost Tester */}
              <div className="border-t border-zinc-100 pt-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold text-zinc-900">
                    Custom Early-Game Cost Verifier
                  </h4>
                  <span className="font-mono text-xs font-semibold text-sky-700">
                    Cost: {customCostDisplay} ({customManaNeeded} MV)
                  </span>
                </div>

                <div className="flex flex-wrap items-end gap-3.5">
                  <div>
                    <label htmlFor="calc-turn" className="block text-xs font-medium text-zinc-500">
                      Cast by Turn
                    </label>
                    <select
                      id="calc-turn"
                      value={customTurn}
                      onChange={(e) => setCustomTurn(Number(e.target.value))}
                      className="mt-1.5 min-h-[38px] rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs sm:text-sm font-mono text-zinc-900 focus:border-sky-600 focus:outline-none"
                    >
                      {[1, 2, 3, 4, 5].map((t) => (
                        <option key={t} value={t}>
                          Turn {t}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="calc-generic" className="block text-xs font-medium text-zinc-500">
                      Generic Mana
                    </label>
                    <select
                      id="calc-generic"
                      value={customGeneric}
                      onChange={(e) => setCustomGeneric(Number(e.target.value))}
                      className="mt-1.5 min-h-[38px] rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs sm:text-sm font-mono text-zinc-900 focus:border-sky-600 focus:outline-none"
                    >
                      {[0, 1, 2, 3, 4, 5].map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex-1 min-w-[220px]">
                    <div className="text-xs font-medium text-zinc-500">
                      Add Colored Pips (Click to add)
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      {PIP_OPTIONS.map((pip) => (
                        <button
                          key={pip.color}
                          type="button"
                          onClick={() => addCustomPip(pip.color)}
                          className={`inline-flex min-h-[36px] items-center rounded-lg border px-3 py-1.5 font-mono text-xs sm:text-sm font-semibold hover:opacity-85 cursor-pointer whitespace-nowrap shrink-0 ${pip.badgeClass}`}
                        >
                          +{pip.label}
                        </button>
                      ))}
                      {customPips.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setCustomPips([])}
                          className="inline-flex min-h-[36px] items-center rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 cursor-pointer whitespace-nowrap shrink-0"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {customPips.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-zinc-500">Required pips (click to remove):</span>
                    {customPips.map((p, idx) => (
                      <button
                        key={`${p}-${idx}`}
                        type="button"
                        onClick={() => removeCustomPip(idx)}
                        className="inline-flex min-h-[34px] items-center rounded-lg border border-zinc-300 bg-zinc-50 px-2.5 py-1 font-mono text-xs font-semibold text-zinc-800 hover:border-red-300 hover:text-red-700 cursor-pointer whitespace-nowrap shrink-0"
                      >
                        {`{${p}}`} ×
                      </button>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap items-baseline justify-between gap-2 border-y border-zinc-100 bg-zinc-50/60 px-3 py-3">
                  <div className="text-xs text-zinc-700">
                    Probability of casting <span className="font-mono font-semibold">{customCostDisplay}</span> by{' '}
                    <span className="font-semibold">Turn {customTurn}</span>:
                  </div>
                  <div className="flex items-baseline gap-2 font-mono tabular-nums">
                    <span
                      className={`text-lg font-bold ${
                        activeSim.customCheckPct >= 80
                          ? 'text-emerald-700'
                          : activeSim.customCheckPct >= 60
                          ? 'text-sky-700'
                          : 'text-red-700'
                      }`}
                    >
                      {activeSim.customCheckPct}%
                    </span>
                    {deckMode === 'optimized' &&
                      optimizedSim.customCheckPct !== currentSim.customCheckPct && (
                        <span
                          className={`text-xs font-semibold ${
                            optimizedSim.customCheckPct > currentSim.customCheckPct
                              ? 'text-emerald-700'
                              : 'text-amber-700'
                          }`}
                        >
                          ({optimizedSim.customCheckPct > currentSim.customCheckPct ? '+' : ''}
                          {optimizedSim.customCheckPct - currentSim.customCheckPct}% vs current)
                        </span>
                      )}
                  </div>
                </div>
              </div>
            </div>

            {/* Right: Early-Game Deck Spells Castability Table */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-zinc-900">
                  Early-Game Spells Castable on Curve (MV 1–3)
                </h4>
                <span className="text-xs text-zinc-500">Lands + color pips needed</span>
              </div>

              {(activeSim?.earlySpells || []).length === 0 ? (
                <p className="py-6 text-sm text-zinc-500">
                  No 1–3 mana value spells found in the main library.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-zinc-200 text-xs font-medium text-zinc-500">
                        <th className="py-2 pr-3">Spell</th>
                        <th className="py-2 px-2">Cost</th>
                        <th className="py-2 px-2 text-right">Curve Turn</th>
                        <th className="py-2 pl-2 text-right">Castable %</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {(activeSim?.earlySpells || []).map((sp) => {
                        const prevPct = currentSpellPctMap.get(sp.name.toLowerCase());
                        const delta =
                          deckMode === 'optimized' && prevPct !== undefined
                            ? sp.castablePct - prevPct
                            : 0;

                        return (
                          <tr key={sp.name} className="h-10">
                            <td className="py-2 pr-3">
                              <div className="flex items-center gap-1.5">
                                {sp.quantity > 1 && (
                                  <span className="font-mono text-xs tabular-nums text-zinc-400">
                                    {sp.quantity}x
                                  </span>
                                )}
                                <CardLink
                                  name={sp.name}
                                  meta={sp.meta}
                                  onInspect={onInspectCard}
                                  className="text-xs sm:text-sm"
                                />
                              </div>
                            </td>
                            <td className="py-2 px-2 font-mono text-xs text-zinc-600">
                              {sp.manaCost || `{${sp.cmc}}`}
                            </td>
                            <td className="py-2 px-2 text-right font-mono text-xs tabular-nums text-zinc-500">
                              Turn {sp.targetTurn}
                            </td>
                            <td className="py-2 pl-2 text-right font-mono text-xs font-semibold tabular-nums">
                              <span
                                className={
                                  sp.castablePct >= 80
                                    ? 'text-emerald-700'
                                    : sp.castablePct >= 60
                                    ? 'text-sky-700'
                                    : 'text-red-700'
                                }
                              >
                                {sp.castablePct}%
                              </span>
                              {delta !== 0 && (
                                <span
                                  className={`ml-1 text-xs ${
                                    delta > 0 ? 'text-emerald-700' : 'text-amber-700'
                                  }`}
                                >
                                  ({delta > 0 ? '+' : ''}
                                  {delta}%)
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
