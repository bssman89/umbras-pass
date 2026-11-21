import React, { useMemo } from 'react';
import { FileText, Printer, X } from 'lucide-react';
import type {
  DeckAnalysisResult,
  DeckExportSimulationStats,
} from '../types/deck';
import {
  buildOptimizedDeckExport,
  buildSimulationStatEntries,
  type ExtraSwapSpec,
} from '../utils/deckExport';
import { runSynergyAndColorAudit } from '../utils/synergyAudit';

interface DeckPdfReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  analysis: DeckAnalysisResult;
  selectedSwapIds: Set<string>;
  selectedCutIds: Set<string>;
  selectedAddIds: Set<string>;
  selectedLandChangeIds: Set<string>;
  extraSwaps: ExtraSwapSpec[];
  simulationStats?: DeckExportSimulationStats | null;
}

export const DeckPdfReportModal: React.FC<DeckPdfReportModalProps> = ({
  isOpen,
  onClose,
  analysis,
  selectedSwapIds,
  selectedCutIds,
  selectedAddIds,
  selectedLandChangeIds,
  extraSwaps,
  simulationStats = null,
}) => {
  const optimizedExport = useMemo(
    () =>
      buildOptimizedDeckExport(
        analysis,
        selectedSwapIds,
        selectedCutIds,
        selectedAddIds,
        selectedLandChangeIds,
        extraSwaps,
        simulationStats,
        true
      ),
    [
      analysis,
      selectedSwapIds,
      selectedCutIds,
      selectedAddIds,
      selectedLandChangeIds,
      extraSwaps,
      simulationStats,
    ]
  );

  const simStatEntries = useMemo(
    () => buildSimulationStatEntries(simulationStats),
    [simulationStats]
  );

  const synergyReport = useMemo(() => runSynergyAndColorAudit(analysis), [analysis]);

  if (!isOpen) return null;

  const handlePrintOrPdf = () => {
    window.print();
  };

  const bracketLabels: Record<string, string> = {
    'bracket-1': 'Bracket 1: Exhibition',
    'bracket-2': 'Bracket 2: Core',
    'bracket-3': 'Bracket 3: Upgraded',
    'bracket-4': 'Bracket 4: Optimized',
    'bracket-5': 'Bracket 5: cEDH',
  };

  const cardsWithImages = (analysis?.resolvedCards || []).filter(
    (c) => c?.card?.imageUri && c.card.imageUri.trim() !== ''
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Deck PDF Report Preview"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 sm:p-6 overflow-y-auto print:p-0 print:bg-white print:static"
    >
      <div className="relative w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl bg-white shadow-2xl print:max-h-none print:shadow-none print:rounded-none">
        {/* Modal Toolbar (hidden when printing) */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 shrink-0 print:hidden">
          <div className="flex items-center gap-2.5">
            <FileText className="h-5 w-5 text-sky-700" />
            <h2 className="font-display text-lg font-bold text-zinc-900">
              Umbras Pass — Executive Deck Dossier & PDF Report
            </h2>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handlePrintOrPdf}
              className="inline-flex items-center gap-2 rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-800 cursor-pointer whitespace-nowrap shadow-sm"
            >
              <Printer className="h-4 w-4" />
              Print / Save as PDF
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close report preview"
              className="inline-flex items-center justify-center rounded-lg border border-zinc-200 bg-white p-2 text-zinc-500 hover:text-zinc-900 cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Printable Scrollable Document Body */}
        <div className="overflow-y-auto p-8 space-y-8 bg-zinc-50/50 print:bg-white print:p-6 print:overflow-visible">
          {/* Document Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-zinc-200 pb-6">
            <div className="flex items-center gap-4">
              <img
                src="/assets/aistudio/Umbras_pass_v3-removebg-preview_58159528.png"
                alt="Umbras Pass logo"
                className="h-16 w-auto object-contain shrink-0"
                referrerPolicy="no-referrer"
              />
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-sky-700">
                  Umbras Pass · MTG Deck Dossier
                </div>
                <h1 className="font-display text-2xl font-bold text-zinc-900">
                  {analysis.deckName}
                </h1>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-600">
                  <span className="capitalize font-semibold text-zinc-800">
                    {analysis.metrics.detectedFormat}
                  </span>
                  {analysis.goal && bracketLabels[analysis.goal] && (
                    <>
                      <span>·</span>
                      <span>{bracketLabels[analysis.goal]}</span>
                    </>
                  )}
                  <span>·</span>
                  <span>{analysis.archetype}</span>
                  {analysis.metrics.commanderNames.length > 0 && (
                    <>
                      <span>·</span>
                      <span>Commander: {analysis.metrics.commanderNames.join(', ')}</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="text-right sm:text-right text-xs font-mono text-zinc-500">
              Generated: {new Date().toLocaleDateString()}
              <div className="mt-0.5 text-zinc-700 font-semibold">
                Resulting Size: {optimizedExport.totalMainCount} cards · {optimizedExport.resultingLandCount} Lands
              </div>
            </div>
          </div>

          {/* Section 1: Executive Verdict & Stats */}
          <div className="space-y-3">
            <h2 className="font-display text-base font-bold text-zinc-900 border-b border-zinc-200 pb-1.5">
              01. Executive Diagnosis & Key Metrics
            </h2>
            <div className="rounded-xl border border-zinc-200 bg-white p-5 space-y-3">
              <p className="font-semibold text-zinc-900">{analysis.verdictHeadline}</p>
              <p className="text-sm leading-relaxed text-zinc-700">{analysis.verdictSummary}</p>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-zinc-100 font-mono text-xs">
                <div className="rounded-lg bg-zinc-50 p-3">
                  <div className="text-zinc-500">Deck Size</div>
                  <div className="mt-1 text-base font-bold text-zinc-900">
                    {analysis.metrics.currentMainAndCommanderCount} / {analysis.metrics.targetDeckSize}
                  </div>
                </div>
                <div className="rounded-lg bg-zinc-50 p-3">
                  <div className="text-zinc-500">Land Count</div>
                  <div className="mt-1 text-base font-bold text-zinc-900">
                    {analysis.metrics.currentLands} → {analysis.metrics.recommendedLands} rec.
                  </div>
                </div>
                <div className="rounded-lg bg-zinc-50 p-3">
                  <div className="text-zinc-500">Non-Land Avg MV</div>
                  <div className="mt-1 text-base font-bold text-zinc-900">
                    {analysis.metrics.averageCmcNonLand}
                  </div>
                </div>
                <div className="rounded-lg bg-zinc-50 p-3">
                  <div className="text-zinc-500">Synergy Audit Flags</div>
                  <div className="mt-1 text-base font-bold text-sky-700">
                    {synergyReport.counts.total} flagged
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Recommended Card Changes & Swaps */}
          <div className="space-y-3">
            <h2 className="font-display text-base font-bold text-zinc-900 border-b border-zinc-200 pb-1.5">
              02. Actionable Card Swaps, Cuts & Additions
            </h2>
            <div className="rounded-xl border border-zinc-200 bg-white p-5 space-y-4">
              {analysis.swaps.length === 0 && analysis.cuts.length === 0 && analysis.additions.length === 0 ? (
                <p className="text-sm text-zinc-600">No major card changes recommended.</p>
              ) : (
                <div className="space-y-3">
              {Array.isArray(analysis?.swaps) && analysis.swaps.map((s) => (
                    <div key={s.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm p-3 rounded-lg border border-zinc-100 bg-zinc-50">
                      <div>
                        <span className="font-mono text-xs font-semibold uppercase text-sky-700 mr-2">
                          Swap
                        </span>
                        <span className="font-semibold text-red-700 line-through mr-1">{s.cutCardName}</span>
                        <span className="text-zinc-400 mr-1">→</span>
                        <span className="font-semibold text-emerald-700">{s.addCardName}</span>
                        <p className="mt-1 text-xs text-zinc-600">{s.addReason}</p>
                      </div>
                      <span className="text-xs font-mono text-zinc-500 shrink-0 capitalize">
                        Priority: {s.priority}
                      </span>
                    </div>
                  ))}

                  {Array.isArray(analysis?.cuts) && analysis.cuts.map((c) => (
                    <div key={c.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm p-3 rounded-lg border border-zinc-100 bg-zinc-50">
                      <div>
                        <span className="font-mono text-xs font-semibold uppercase text-red-700 mr-2">
                          Cut ({c.category})
                        </span>
                        <span className="font-semibold text-red-700">{c.cardName}</span>
                        <p className="mt-1 text-xs text-zinc-600">{c.reason}</p>
                      </div>
                      <span className="text-xs font-mono text-zinc-500 shrink-0 capitalize">
                        Priority: {c.priority}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Section 3: Visual Card Showcase Gallery with Images */}
          {cardsWithImages.length > 0 && (
            <div className="space-y-3">
              <h2 className="font-display text-base font-bold text-zinc-900 border-b border-zinc-200 pb-1.5">
                03. Key Deck Cards & Artwork Showcase
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {Array.isArray(cardsWithImages) && cardsWithImages.slice(0, 18).map((rc, idx) => {
                  const card = rc.card;
                  if (!card) return null;
                  return (
                    <div key={`${card.name}-${idx}`} className="rounded-lg border border-zinc-200 bg-white p-2 space-y-1.5 text-center">
                      <div className="aspect-[488/680] w-full overflow-hidden rounded bg-zinc-100">
                        <img
                          src={card.imageUri}
                          alt={card.name}
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <div className="truncate text-xs font-semibold text-zinc-800">
                        {card.name}
                      </div>
                      <div className="font-mono text-[10px] text-zinc-500">
                        {card.manaCost || 'Land'} · {(card.typeLine || '').split('—')[0].trim()}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Section 4: Simulation & Playtest Stats (when available) */}
          {simStatEntries.length > 0 && (
            <div className="space-y-3">
              <h2 className="font-display text-base font-bold text-zinc-900 border-b border-zinc-200 pb-1.5">
                04. Bot Match &amp; Live Simulation Stats
              </h2>
              <div className="rounded-xl border border-zinc-200 bg-white p-5">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs">
                  {simStatEntries.map((stat, idx) => (
                    <div key={idx} className="rounded-lg bg-zinc-50 p-3">
                      <div className="font-semibold text-zinc-500">{stat.label}</div>
                      <div className="mt-1 font-mono text-zinc-900">{stat.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Optimized Full Decklist */}
          <div className="space-y-3">
            <h2 className="font-display text-base font-bold text-zinc-900 border-b border-zinc-200 pb-1.5">
              {simStatEntries.length > 0 ? '05' : '04'}. Resulting Optimized Decklist
            </h2>
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 font-mono text-xs leading-relaxed text-zinc-800 whitespace-pre-line">
              {optimizedExport.exportText}
            </div>
          </div>
        </div>

        {/* Print Footer / Close */}
        <div className="border-t border-zinc-200 px-6 py-4 text-xs text-zinc-500 flex items-center justify-between shrink-0 print:hidden">
          <span>Umbras Pass · Professional Deck Dossier</span>
          <button
            type="button"
            onClick={onClose}
            className="font-medium text-zinc-700 hover:text-zinc-900 cursor-pointer"
          >
            Close Preview
          </button>
        </div>
      </div>
    </div>
  );
};
