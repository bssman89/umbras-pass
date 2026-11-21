import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  RotateCcw,
  Scissors,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import type { CardMetadata, DeckAnalysisResult } from '../types/deck';
import type { ExtraSwapSpec } from '../utils/deckExport';
import {
  runSynergyAndColorAudit,
  type ColorAuditRow,
  type SynergyFlagItem,
  type SynergyIssueCategory,
} from '../utils/synergyAudit';
import { resolveCardsWithBrowserScryfall } from '../utils/clientFallbackAnalyzer';
import {
  addMapCardCount,
  consolidateResolvedDeckCards,
  getMapCardCount,
  getMaxCopiesForCard,
  isSameCardName,
} from '../utils/deckRules';
import { CardLink } from './CardInspectorModal';

interface SynergyAuditPanelProps {
  analysis: DeckAnalysisResult;
  selectedSwapIds: Set<string>;
  selectedCutIds: Set<string>;
  selectedAddIds?: Set<string>;
  selectedLandChangeIds?: Set<string>;
  extraSwaps: ExtraSwapSpec[];
  onToggleSwap: (id: string) => void;
  onToggleCut: (id: string) => void;
  onToggleAuditSwap: (spec: ExtraSwapSpec) => void;
  onClearAuditSwaps?: () => void;
  onInspectCard: (name: string, meta?: CardMetadata | null) => void;
}

type AuditFilter = 'all' | 'color' | 'anti' | 'strategy';

function formatCardPrice(meta?: CardMetadata | null): string | null {
  if (!meta || meta.priceUsd === undefined || meta.priceUsd === null) return null;
  if (meta.priceUsd <= 0) return null;
  return `$${meta.priceUsd.toFixed(2)}`;
}

const COLOR_BADGE_STYLES: Record<
  ColorAuditRow['color'],
  { symbol: string; bgClass: string; barClass: string }
> = {
  W: { symbol: 'W', bgClass: 'bg-amber-100 text-amber-900 border-amber-300', barClass: 'bg-amber-500' },
  U: { symbol: 'U', bgClass: 'bg-sky-100 text-sky-900 border-sky-300', barClass: 'bg-sky-600' },
  B: { symbol: 'B', bgClass: 'bg-zinc-200 text-zinc-900 border-zinc-400', barClass: 'bg-zinc-700' },
  R: { symbol: 'R', bgClass: 'bg-red-100 text-red-900 border-red-300', barClass: 'bg-red-600' },
  G: { symbol: 'G', bgClass: 'bg-emerald-100 text-emerald-900 border-emerald-300', barClass: 'bg-emerald-600' },
};

const MiniCardThumb: React.FC<{
  name: string;
  meta: CardMetadata | null;
  onInspect: (name: string, meta?: CardMetadata | null) => void;
}> = ({ name, meta, onInspect }) => {
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <button
      type="button"
      onClick={() => onInspect(name, meta)}
      title={`Inspect ${name}`}
      className="h-[60px] w-[44px] shrink-0 overflow-hidden rounded border border-zinc-200 bg-zinc-100 hover:border-sky-600 transition-colors cursor-pointer flex items-center justify-center"
    >
      {meta?.imageUri && !imgFailed ? (
        <img
          src={meta.imageUri}
          alt={name}
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className="h-full w-full object-cover object-top"
        />
      ) : (
        <span className="px-0.5 text-center font-mono text-[8px] font-semibold leading-tight text-zinc-500 line-clamp-3">
          {name}
        </span>
      )}
    </button>
  );
};

export const SynergyAuditPanel: React.FC<SynergyAuditPanelProps> = ({
  analysis,
  selectedSwapIds,
  selectedCutIds,
  selectedAddIds,
  selectedLandChangeIds,
  extraSwaps,
  onToggleSwap,
  onToggleCut,
  onToggleAuditSwap,
  onClearAuditSwaps,
  onInspectCard,
}) => {
  const [filter, setFilter] = useState<AuditFilter>('all');
  const [hideResolved, setHideResolved] = useState<boolean>(false);
  const [resolvedSugMeta, setResolvedSugMeta] = useState<Record<string, CardMetadata>>({});
  const attemptedSugKeysRef = useRef<Set<string>>(new Set());

  const report = useMemo(() => runSynergyAndColorAudit(analysis), [analysis]);

  // Background-resolve Scryfall metadata for curated audit replacements so
  // card tooltips, mana costs, USD prices, and thumbnails are always populated.
  const suggestionNamesKey = useMemo(() => {
    const names = new Set<string>();
    for (const flag of report.flaggedCards) {
      for (const sug of flag.suggestions) {
        if (!sug.meta && sug.cardName) {
          names.add(sug.cardName);
        }
      }
    }
    return Array.from(names).sort().join('|');
  }, [report.flaggedCards]);

  useEffect(() => {
    if (!suggestionNamesKey) return;
    const fmt = analysis?.metrics?.detectedFormat || 'commander';
    const namesToFetch = suggestionNamesKey
      .split('|')
      .filter((n) => n && !attemptedSugKeysRef.current.has(`${fmt}:${n.toLowerCase()}`));
    if (namesToFetch.length === 0) return;

    for (const n of namesToFetch) {
      attemptedSugKeysRef.current.add(`${fmt}:${n.toLowerCase()}`);
    }

    let cancelled = false;

    resolveCardsWithBrowserScryfall(namesToFetch, fmt)
      .then((fetched) => {
        if (cancelled || fetched.size === 0) return;
        setResolvedSugMeta((prev) => {
          const next = { ...prev };
          for (const [k, meta] of fetched.entries()) {
            next[k.toLowerCase()] = meta;
            if (meta.name) next[meta.name.toLowerCase()] = meta;
          }
          return next;
        });
      })
      .catch(() => {
        // Non-fatal if offline or rate-limited
      });

    return () => {
      cancelled = true;
    };
  }, [suggestionNamesKey, analysis?.metrics?.detectedFormat]);

  const isAuditSwapActive = (cutCardName: string, addCardName: string) =>
    extraSwaps.some(
      (s) =>
        isSameCardName(s.cutCardName, cutCardName) &&
        isSameCardName(s.addCardName, addCardName)
    );

  const isCutOnlyActive = (cutCardName: string) =>
    extraSwaps.some(
      (s) =>
        isSameCardName(s.cutCardName, cutCardName) &&
        s.addCardName.trim() === ''
    );

  const isFlagResolved = (item: SynergyFlagItem) => {
    if (item.linkedSwapId && selectedSwapIds.has(item.linkedSwapId)) return true;
    if (item.linkedCutId && selectedCutIds.has(item.linkedCutId)) return true;
    return extraSwaps.some((s) => isSameCardName(s.cutCardName, item.cardName));
  };

  const filteredFlags = useMemo(() => {
    const byCategory =
      filter === 'all'
        ? report.flaggedCards
        : filter === 'color'
        ? report.flaggedCards.filter(
            (f) =>
              f.issueCategory === 'color-identity' ||
              f.issueCategory === 'off-color-mana'
          )
        : filter === 'anti'
        ? report.flaggedCards.filter((f) => f.issueCategory === 'anti-synergy')
        : report.flaggedCards.filter((f) => f.issueCategory === 'off-strategy');

    if (!hideResolved) return byCategory;
    return byCategory.filter((item) => {
      if (item.linkedSwapId && selectedSwapIds.has(item.linkedSwapId)) return false;
      if (item.linkedCutId && selectedCutIds.has(item.linkedCutId)) return false;
      return !extraSwaps.some((s) => isSameCardName(s.cutCardName, item.cardName));
    });
  }, [report.flaggedCards, filter, hideResolved, selectedSwapIds, selectedCutIds, extraSwaps]);

  const categoryLabel: Record<SynergyIssueCategory, string> = {
    'color-identity': 'Color Identity',
    'off-color-mana': 'Color / Pip Mana',
    'anti-synergy': 'Anti-Synergy',
    'off-strategy': 'Strategy Fit',
  };

  const resolvedCount = report.flaggedCards.filter(isFlagResolved).length;

  const unresolvedWithFix = useMemo(
    () =>
      report.flaggedCards.filter(
        (item) => !isFlagResolved(item) && (item.suggestions || []).length > 0
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [report.flaggedCards, selectedSwapIds, selectedCutIds, extraSwaps]
  );

  const buildLiveProjectedCounts = () => {
    const detectedFormat = analysis?.metrics?.detectedFormat;
    const consolidated = consolidateResolvedDeckCards(
      analysis?.resolvedCards ?? [],
      detectedFormat
    );
    const counts = new Map<string, number>();
    for (const rc of consolidated) {
      if (rc.zone === 'main' || rc.zone === 'commander' || rc.zone === 'companion') {
        addMapCardCount(counts, rc.name, rc.quantity);
      }
    }
    for (const sw of analysis?.swaps ?? []) {
      if (!selectedSwapIds.has(sw.id)) continue;
      addMapCardCount(counts, sw.cutCardName, -sw.quantity);
      addMapCardCount(counts, sw.addCardName, sw.quantity);
    }
    for (const ex of extraSwaps ?? []) {
      addMapCardCount(counts, ex.cutCardName, -ex.quantity);
      if (ex.addCardName.trim()) {
        addMapCardCount(counts, ex.addCardName, ex.quantity);
      }
    }
    for (const cut of analysis?.cuts ?? []) {
      if (!selectedCutIds.has(cut.id)) continue;
      addMapCardCount(counts, cut.cardName, -cut.quantity);
    }
    if (selectedAddIds) {
      for (const add of analysis?.additions ?? []) {
        if (!selectedAddIds.has(add.id)) continue;
        addMapCardCount(counts, add.cardName, add.quantity);
      }
    }
    if (selectedLandChangeIds) {
      for (const lc of analysis?.manaPlan?.landChanges ?? []) {
        if (!selectedLandChangeIds.has(lc.id)) continue;
        addMapCardCount(counts, lc.cardName, lc.action === 'cut' ? -lc.quantity : lc.quantity);
      }
    }
    return counts;
  };

  const handleApplyTopFixes = () => {
    const detectedFormat = analysis?.metrics?.detectedFormat;
    const projectedCounts = buildLiveProjectedCounts();

    for (const item of unresolvedWithFix) {
      let chosenSug: (typeof item.suggestions)[number] | undefined;
      let chosenMeta: CardMetadata | null = null;
      let chosenQty = 0;

      for (const cand of item.suggestions || []) {
        if (!cand?.cardName || isSameCardName(cand.cardName, item.cardName)) continue;
        const meta =
          cand.meta || resolvedSugMeta[cand.cardName.toLowerCase()] || null;
        const maxCopies = getMaxCopiesForCard(cand.cardName, detectedFormat, meta);
        const current = getMapCardCount(projectedCounts, cand.cardName);
        const headroom = Number.isFinite(maxCopies)
          ? Math.max(0, maxCopies - current)
          : item.quantity;
        if (headroom > 0) {
          chosenSug = cand;
          chosenMeta = meta;
          chosenQty = Math.min(item.quantity, headroom);
          break;
        }
      }

      if (!chosenSug || chosenQty <= 0) continue;

      const primarySwap = item.linkedSwapId
        ? (analysis?.swaps || []).find((s) => s.id === item.linkedSwapId)
        : undefined;

      if (
        primarySwap &&
        isSameCardName(primarySwap.addCardName, chosenSug.cardName)
      ) {
        if (!selectedSwapIds.has(primarySwap.id)) {
          onToggleSwap(primarySwap.id);
        }
        addMapCardCount(projectedCounts, primarySwap.cutCardName, -primarySwap.quantity);
        addMapCardCount(projectedCounts, primarySwap.addCardName, primarySwap.quantity);
      } else {
        onToggleAuditSwap({
          cutCardName: item.cardName,
          addCardName: chosenSug.cardName,
          quantity: chosenQty,
          addMeta: chosenMeta,
        });
        addMapCardCount(projectedCounts, item.cardName, -chosenQty);
        addMapCardCount(projectedCounts, chosenSug.cardName, chosenQty);
      }
    }
  };

  const handleClearAuditFixes = () => {
    if (onClearAuditSwaps) {
      onClearAuditSwaps();
      return;
    }
    for (const ex of extraSwaps) {
      onToggleAuditSwap(ex);
    }
  };

  const gradeToneClass =
    report.scores.grade === 'A'
      ? 'text-emerald-700'
      : report.scores.grade === 'B'
      ? 'text-sky-700'
      : report.scores.grade === 'C'
      ? 'text-amber-700'
      : 'text-red-700';

  return (
    <section id="synergy-audit-section" className="space-y-4 scroll-mt-20">
      {/* Header & Category Filter */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="font-display text-xl font-bold text-zinc-900">
            05. Synergy &amp; Color Audit
          </h2>
          <p className="mt-0.5 text-sm text-zinc-600">
            <span className="font-mono font-semibold tabular-nums text-zinc-800">
              {report.totalCardsScanned}
            </span>{' '}
            cards checked ·{' '}
            <span className="font-medium text-zinc-900">
              {report.detectedStrategy.archetype}
            </span>{' '}
            <span className="text-zinc-400" aria-hidden="true">·</span>{' '}
            <span className="font-mono font-semibold text-sky-700">
              {report.detectedStrategy.identityLabel}
            </span>
            {report.detectedStrategy.dominantTribe && (
              <>
                {' '}
                <span className="text-zinc-400" aria-hidden="true">·</span>{' '}
                <span className="font-medium text-zinc-800">
                  {report.detectedStrategy.dominantTribe}
                </span>
              </>
            )}{' '}
            <span className="text-zinc-400" aria-hidden="true">·</span>{' '}
            <span className={report.counts.total === 0 ? 'text-emerald-700 font-medium' : 'text-amber-700 font-medium'}>
              {report.counts.total === 0
                ? 'All checks passed'
                : `${report.counts.total} flag${report.counts.total === 1 ? '' : 's'}`}
            </span>
          </p>
        </div>

        <div className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-100 p-1 shrink-0">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              filter === 'all'
                ? 'bg-white text-zinc-900 shadow-sm'
                : 'text-zinc-700 hover:text-zinc-900'
            }`}
          >
            All ({report.counts.total})
          </button>
          <button
            type="button"
            onClick={() => setFilter('color')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              filter === 'color'
                ? 'bg-white text-zinc-900 shadow-sm'
                : 'text-zinc-700 hover:text-zinc-900'
            }`}
          >
            Color &amp; Pips ({report.counts.colorIssues})
          </button>
          <button
            type="button"
            onClick={() => setFilter('anti')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              filter === 'anti'
                ? 'bg-white text-zinc-900 shadow-sm'
                : 'text-zinc-700 hover:text-zinc-900'
            }`}
          >
            Anti-Synergy ({report.counts.antiSynergy})
          </button>
          <button
            type="button"
            onClick={() => setFilter('strategy')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              filter === 'strategy'
                ? 'bg-white text-zinc-900 shadow-sm'
                : 'text-zinc-700 hover:text-zinc-900'
            }`}
          >
            Strategy Fit ({report.counts.offStrategy})
          </button>
        </div>
      </div>

      {/* Main Card Container */}
      <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
        {/* 1. Executive Scorecard Row */}
        <div className="grid grid-cols-2 divide-y divide-zinc-100 border-b border-zinc-200 sm:grid-cols-4 sm:divide-y-0 sm:divide-x">
          <div className="px-5 py-4">
            <div className="text-[11px] font-medium text-zinc-500">
              Audit Grade
            </div>
            <div className="mt-1 flex items-baseline gap-2 font-mono tabular-nums">
              <span className={`text-2xl font-bold ${gradeToneClass}`}>
                {report.scores.grade}
              </span>
              <span className="text-xs font-semibold text-zinc-600">
                {report.scores.overallScore}/100
              </span>
            </div>
            <div className="mt-0.5 text-[11px] text-zinc-500">
              {report.counts.critical > 0
                ? `${report.counts.critical} critical · ${report.counts.total - report.counts.critical} advisory`
                : report.counts.total > 0
                ? `${report.counts.total} advisory check${report.counts.total === 1 ? '' : 's'}`
                : 'Zero critical or off-plan flags'}
            </div>
          </div>

          <div className="px-5 py-4">
            <div className="text-[11px] font-medium text-zinc-500">
              Color &amp; Mana Integrity
            </div>
            <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-zinc-900">
              {report.scores.colorHealth}
              <span className="text-xs font-normal text-zinc-500">/100</span>
            </div>
            <div className="mt-0.5 text-[11px] text-zinc-500">
              {report.counts.colorIssues === 0
                ? 'All pips & identity legal'
                : `${report.counts.colorIssues} color/pip issue${report.counts.colorIssues === 1 ? '' : 's'}`}
            </div>
          </div>

          <div className="px-5 py-4">
            <div className="text-[11px] font-medium text-zinc-500">
              Strategy Cohesion
            </div>
            <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-sky-700">
              {report.scores.synergyCohesion}
              <span className="text-xs font-normal text-zinc-500">/100</span>
            </div>
            <div className="mt-0.5 text-[11px] text-zinc-500 truncate">
              Themes: {report.detectedStrategy.primaryThemes.join(', ')}
            </div>
          </div>

          <div className="px-5 py-4 flex flex-col justify-between gap-2 bg-zinc-50/50">
            <div>
              <div className="text-[11px] font-medium text-zinc-500">
                Fixes Staged in Export
              </div>
              <div className="mt-1 font-mono text-lg font-bold tabular-nums text-zinc-900">
                {resolvedCount} / {report.counts.total}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {unresolvedWithFix.length > 0 && (
                <button
                  type="button"
                  onClick={handleApplyTopFixes}
                  className="inline-flex items-center gap-1 rounded-md bg-sky-700 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-sky-800 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Sparkles className="h-3 w-3" />
                  Apply Top Fixes ({unresolvedWithFix.length})
                </button>
              )}
              {extraSwaps.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearAuditFixes}
                  title="Clear staged audit swaps"
                  className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <RotateCcw className="h-3 w-3" />
                  Reset
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 2. Per-Color Source vs. Pip Matrix & Theme/Role Diagnostics */}
        <div className="grid grid-cols-1 divide-y divide-zinc-200 border-b border-zinc-200 lg:grid-cols-2 lg:divide-y-0 lg:divide-x">
          {/* Left: Per-Color Pip Demand vs Mana Sources */}
          <div className="p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Color Pip Demand vs. Mana Sources
              </h3>
              <span className="font-mono text-[11px] text-zinc-500">
                Identity: <strong className="text-zinc-800">{report.detectedStrategy.identityLabel}</strong>
              </span>
            </div>

            {report.colorAuditRows.length === 0 ? (
              <p className="text-xs text-zinc-500 py-2">
                Colorless mana base — no colored pip requirements detected.
              </p>
            ) : (
              <div className="space-y-2.5">
                {report.colorAuditRows.map((row) => {
                  const style = COLOR_BADGE_STYLES[row.color];
                  const fillPct =
                    row.recommendedSources > 0
                      ? Math.min(100, Math.round((row.sources / row.recommendedSources) * 100))
                      : row.sources > 0
                      ? 100
                      : 0;
                  const statusTone =
                    row.status === 'Identity Violation' || row.status === 'Zero Sources'
                      ? 'text-red-700 font-semibold'
                      : row.status === 'Short' || row.status === 'Unused Surplus'
                      ? 'text-amber-700 font-semibold'
                      : row.status === 'Tight'
                      ? 'text-sky-700 font-medium'
                      : 'text-emerald-700 font-medium';

                  return (
                    <div key={row.color} className="space-y-1">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`inline-flex h-5 w-5 items-center justify-center rounded border font-mono text-[11px] font-bold shrink-0 ${style.bgClass}`}
                          >
                            {style.symbol}
                          </span>
                          <span className="font-semibold text-zinc-900">{row.label}</span>
                          <span className="font-mono text-[11px] tabular-nums text-zinc-500">
                            {row.pips} pips · {row.spellCount} spells
                            {row.doublePipCards > 0 ? ` · ${row.doublePipCards} double-pip` : ''}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 font-mono text-[11px] tabular-nums shrink-0">
                          <span className="text-zinc-800 font-semibold">
                            {row.sources} / {row.recommendedSources} src
                          </span>
                          <span className="text-zinc-300" aria-hidden="true">·</span>
                          <span className={`font-sans ${statusTone}`}>
                            {row.illegalCards > 0
                              ? `${row.illegalCards} Illegal`
                              : row.status}
                          </span>
                        </div>
                      </div>

                      <div className="h-1.5 w-full overflow-hidden rounded bg-zinc-100">
                        <div
                          className={`h-full transition-all duration-300 ${
                            row.status === 'Identity Violation' || row.status === 'Zero Sources'
                              ? 'bg-red-600'
                              : style.barClass
                          }`}
                          style={{ width: `${fillPct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right: Active Theme Breakdown & Role Targets */}
          <div className="p-5 space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Core Role Balance
                </h3>
                <span className="text-[11px] text-zinc-500">vs. Target</span>
              </div>
              <div className="grid grid-cols-5 gap-2 text-center">
                {report.roleSummary.map((role) => (
                  <div
                    key={role.role}
                    className="rounded-lg border border-zinc-200 bg-zinc-50/70 px-2 py-2"
                  >
                    <div className="truncate text-[10px] font-medium text-zinc-500">
                      {role.role}
                    </div>
                    <div
                      className={`mt-0.5 font-mono text-sm font-bold tabular-nums ${
                        role.status === 'Low'
                          ? 'text-amber-700'
                          : role.status === 'High'
                          ? 'text-sky-700'
                          : 'text-zinc-900'
                      }`}
                    >
                      {role.count}
                    </div>
                    <div className="font-mono text-[9px] tabular-nums text-zinc-500">
                      {role.targetMin}–{role.targetMax}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {report.themeBreakdown.length > 0 && (
              <div className="space-y-2 border-t border-zinc-100 pt-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Synergy Theme Density
                </h3>
                <div className="space-y-1.5">
                  {report.themeBreakdown.slice(0, 4).map((tb) => (
                    <div
                      key={tb.theme}
                      className="flex flex-wrap items-center justify-between gap-2 text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-semibold text-zinc-800">{tb.label}</span>
                        <span className="font-mono text-[11px] tabular-nums text-sky-700 font-semibold">
                          {tb.cardCount} cards ({tb.sharePct}%)
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-600 truncate">
                        {tb.topCards.slice(0, 2).map((tc, i) => (
                          <React.Fragment key={tc.name}>
                            {i > 0 && <span className="text-zinc-300">·</span>}
                            <CardLink
                              name={tc.name}
                              meta={tc.meta}
                              onInspect={onInspectCard}
                              className="text-[11px] font-medium"
                            />
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 3. Top On-Plan Synergy Anchors */}
        {report.strongestSynergies.length > 0 && (
          <div className="border-b border-zinc-200 bg-zinc-50/40 px-5 py-4 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Top On-Theme Synergy Pieces in Deck
              </div>
              <span className="text-[11px] text-zinc-500">
                Click any card to inspect
              </span>
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {report.strongestSynergies.map((syn) => (
                <div
                  key={syn.cardName}
                  className="rounded-lg border border-zinc-200 bg-white p-2.5 flex items-start gap-2.5"
                >
                  <MiniCardThumb
                    name={syn.cardName}
                    meta={syn.cardMeta}
                    onInspect={onInspectCard}
                  />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-baseline justify-between gap-1.5">
                      <CardLink
                        name={syn.cardName}
                        meta={syn.cardMeta}
                        onInspect={onInspectCard}
                        className="text-xs font-semibold truncate"
                      />
                      {syn.cardMeta?.manaCost && (
                        <span className="font-mono text-[10px] text-zinc-500 shrink-0">
                          {syn.cardMeta.manaCost}
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-[10px] font-semibold text-sky-700 truncate">
                      {syn.matchedThemes.join(' · ')}
                    </div>
                    <p className="text-[11px] leading-snug text-zinc-600 line-clamp-2">
                      {syn.reason}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 4. Actionable Flagged Cards Filter Bar */}
        {report.flaggedCards.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-6 py-3 text-xs bg-zinc-50/60">
            <span className="font-semibold text-zinc-800">
              Flagged Cards &amp; Recommended Fixes ({filteredFlags.length} shown)
            </span>
            {resolvedCount > 0 && (
              <label className="inline-flex items-center gap-2 text-xs text-zinc-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hideResolved}
                  onChange={(e) => setHideResolved(e.target.checked)}
                  className="rounded border-zinc-300"
                />
                Hide resolved cards ({resolvedCount})
              </label>
            )}
          </div>
        )}

        {/* Empty / Pass State OR Flagged Cards List */}
        {report.flaggedCards.length === 0 ? (
          <div className="flex items-start gap-3 px-6 py-5">
            <CheckCircle2 className="h-5 w-5 text-emerald-700 shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-zinc-900">
                All color identity, mana pip, and synergy checks passed
              </div>
              <p className="mt-0.5 text-xs text-zinc-600">
                Every main-deck card matches {report.detectedStrategy.identityLabel} and supports your {report.detectedStrategy.archetype} plan.
              </p>
            </div>
          </div>
        ) : filteredFlags.length === 0 ? (
          <div className="px-6 py-6 text-sm text-zinc-600">
            {hideResolved
              ? 'All flagged cards in this view are addressed in your optimized export. Uncheck "Hide resolved cards" to review them.'
              : 'No cards flagged in this filter category. Switch back to All to review the remaining items.'}
          </div>
        ) : (
          <div className="divide-y divide-zinc-100">
            {filteredFlags.map((item) => {
              const resolved = isFlagResolved(item);
              const cutOnlySelected = isCutOnlyActive(item.cardName);
              const primarySwap = item.linkedSwapId
                ? (analysis?.swaps || []).find((s) => s.id === item.linkedSwapId)
                : undefined;

              return (
                <div
                  key={item.id}
                  className={`px-6 py-5 transition-colors ${
                    resolved ? 'bg-sky-50/70' : ''
                  }`}
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    {/* Left: Thumbnail + Flagged Card + Issue Explanation */}
                    <div className="flex items-start gap-3.5 min-w-0 lg:max-w-xl">
                      <MiniCardThumb
                        name={item.cardName}
                        meta={item.cardMeta}
                        onInspect={onInspectCard}
                      />

                      <div className="space-y-1.5 min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          {item.severity === 'critical' ? (
                            <span className="inline-flex items-center gap-1 font-semibold text-red-700">
                              <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                              {item.issueTitle}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 font-semibold text-amber-800">
                              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                              {item.issueTitle}
                            </span>
                          )}
                          <span className="text-zinc-400" aria-hidden="true">·</span>
                          <span className="font-medium text-zinc-600">
                            {categoryLabel[item.issueCategory]}
                          </span>
                          {resolved && (
                            <>
                              <span className="text-zinc-400" aria-hidden="true">·</span>
                              <span className="inline-flex items-center gap-1 font-semibold text-sky-700">
                                <Check className="h-3.5 w-3.5" />
                                Addressed in Export
                              </span>
                            </>
                          )}
                        </div>

                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className="font-mono text-xs font-semibold tabular-nums text-zinc-600">
                            {item.quantity}x
                          </span>
                          <CardLink
                            name={item.cardName}
                            meta={item.cardMeta}
                            onInspect={onInspectCard}
                            className="text-base font-semibold"
                          />
                          {item.cardMeta?.manaCost && (
                            <span className="font-mono text-xs text-zinc-600">
                              {item.cardMeta.manaCost}
                            </span>
                          )}
                          {item.cardMeta?.typeLine && (
                            <span className="text-xs text-zinc-500">
                              · {item.cardMeta.typeLine}
                            </span>
                          )}
                        </div>

                        <p className="text-sm leading-relaxed text-zinc-700">
                          {item.reason}
                        </p>

                        <div className="pt-1 flex flex-wrap items-center gap-2">
                          {item.linkedCutId ? (
                            <button
                              type="button"
                              onClick={() => onToggleCut(item.linkedCutId!)}
                              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium cursor-pointer whitespace-nowrap shrink-0 ${
                                selectedCutIds.has(item.linkedCutId)
                                  ? 'border-sky-700 bg-sky-700 text-white'
                                  : 'border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50'
                              }`}
                            >
                              {selectedCutIds.has(item.linkedCutId)
                                ? 'Cut Included in Export'
                                : 'Stage Cut in Export'}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                onToggleAuditSwap({
                                  cutCardName: item.cardName,
                                  addCardName: '',
                                  quantity: item.quantity,
                                })
                              }
                              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium cursor-pointer whitespace-nowrap shrink-0 ${
                                cutOnlySelected
                                  ? 'border-sky-700 bg-sky-700 text-white'
                                  : 'border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50'
                              }`}
                            >
                              <Scissors className="h-3.5 w-3.5" />
                              {cutOnlySelected ? 'Cut Staged in Export' : 'Cut Card Only'}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Right: Suggested Better Replacements */}
                    <div className="lg:w-[560px] shrink-0 space-y-2">
                      <div className="text-xs font-semibold text-zinc-500">
                        Recommended Replacements
                      </div>

                      {(item.suggestions || []).length === 0 ? (
                        <p className="text-xs text-zinc-500">
                          Replace with an on-color ramp, card draw, or interaction staple matching your deck curve.
                        </p>
                      ) : (
                        <div className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-zinc-50/70">
                          {(item.suggestions || []).map((sug, sIdx) => {
                            const sugMeta =
                              sug.meta ||
                              resolvedSugMeta[sug.cardName.toLowerCase()] ||
                              null;
                            const priceStr = formatCardPrice(sugMeta);

                            const matchesPrimarySwap =
                              primarySwap &&
                              primarySwap.addCardName.toLowerCase() ===
                                sug.cardName.toLowerCase();

                            const isApplied = matchesPrimarySwap
                              ? selectedSwapIds.has(primarySwap.id)
                              : isAuditSwapActive(item.cardName, sug.cardName);

                            return (
                              <div
                                key={`${sug.cardName}-${sIdx}`}
                                className="flex flex-col gap-2 px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                              >
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-1.5 text-sm">
                                    <CardLink
                                      name={sug.cardName}
                                      meta={sugMeta}
                                      onInspect={onInspectCard}
                                      className="font-semibold text-sky-800"
                                    />
                                    {sugMeta?.manaCost && (
                                      <span className="font-mono text-[11px] text-zinc-500">
                                        {sugMeta.manaCost}
                                      </span>
                                    )}
                                    <span className="text-zinc-300" aria-hidden="true">·</span>
                                    <span className="text-xs font-medium text-zinc-700">
                                      {sug.role}
                                    </span>
                                    {sug.matchLabel && (
                                      <>
                                        <span className="text-zinc-300" aria-hidden="true">·</span>
                                        <span className="text-[11px] font-medium text-sky-700">
                                          {sug.matchLabel}
                                        </span>
                                      </>
                                    )}
                                    {priceStr && (
                                      <>
                                        <span className="text-zinc-300" aria-hidden="true">·</span>
                                        <span className="font-mono text-[11px] tabular-nums text-zinc-500">
                                          {priceStr}
                                        </span>
                                      </>
                                    )}
                                  </div>
                                  <p className="mt-0.5 text-xs leading-snug text-zinc-600">
                                    {sug.reason}
                                  </p>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => {
                                    if (matchesPrimarySwap && primarySwap) {
                                      onToggleSwap(primarySwap.id);
                                    } else {
                                      onToggleAuditSwap({
                                        cutCardName: item.cardName,
                                        addCardName: sug.cardName,
                                        quantity: item.quantity,
                                        addMeta: sugMeta,
                                      });
                                    }
                                  }}
                                  className={`inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                                    isApplied
                                      ? 'border-sky-700 bg-sky-700 text-white hover:bg-sky-800'
                                      : 'border-zinc-300 bg-white text-zinc-800 hover:border-sky-400 hover:text-sky-800'
                                  }`}
                                >
                                  {isApplied ? (
                                    <>
                                      <Check className="h-3.5 w-3.5" />
                                      Applied
                                    </>
                                  ) : (
                                    'Use Replacement'
                                  )}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};
