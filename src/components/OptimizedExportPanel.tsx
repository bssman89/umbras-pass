import React, { useMemo, useState } from 'react';
import { BarChart3, Check, Copy, History, RefreshCw, Save } from 'lucide-react';
import type { DeckAnalysisResult, DeckExportSimulationStats } from '../types/deck';
import {
  buildOptimizedDeckExport,
  downloadDeckFile,
  type ExtraSwapSpec,
} from '../utils/deckExport';
import { ShareExportMenu } from './ShareExportMenu';

interface OptimizedExportPanelProps {
  analysis: DeckAnalysisResult;
  selectedSwapIds: Set<string>;
  selectedCutIds: Set<string>;
  selectedAddIds: Set<string>;
  selectedLandChangeIds: Set<string>;
  extraSwaps?: ExtraSwapSpec[];
  simulationStats?: DeckExportSimulationStats | null;
  onReanalyzeUpdated: (updatedDeckText: string) => void;
  onAutoBalanceSelection?: () => void;
  onSaveSnapshot: () => void;
  onOpenHistory: () => void;
  onOpenPdfReport: () => void;
  versionCount: number;
  justSavedSnapshot: boolean;
}

export const OptimizedExportPanel: React.FC<OptimizedExportPanelProps> = ({
  analysis,
  selectedSwapIds,
  selectedCutIds,
  selectedAddIds,
  selectedLandChangeIds,
  extraSwaps = [],
  simulationStats = null,
  onReanalyzeUpdated,
  onAutoBalanceSelection,
  onSaveSnapshot,
  onOpenHistory,
  onOpenPdfReport,
  versionCount,
  justSavedSnapshot,
}) => {
  const [copied, setCopied] = useState(false);
  const [previewFormat, setPreviewFormat] = useState<'txt' | 'csv'>('txt');
  const [includeSimulationStats, setIncludeSimulationStats] = useState(true);

  const {
    exportText,
    deckOnlyExportText,
    exportCsv,
    totalMainCount,
    resultingLandCount,
    commanderNames,
    hasSimulationStats,
    simulationSummaryLines,
  } = useMemo(
    () =>
      buildOptimizedDeckExport(
        analysis,
        selectedSwapIds,
        selectedCutIds,
        selectedAddIds,
        selectedLandChangeIds,
        extraSwaps,
        simulationStats,
        includeSimulationStats
      ),
    [
      analysis,
      selectedSwapIds,
      selectedCutIds,
      selectedAddIds,
      selectedLandChangeIds,
      extraSwaps,
      simulationStats,
      includeSimulationStats,
    ]
  );

  const activeContent = previewFormat === 'csv' ? exportCsv : exportText;
  const targetSize = analysis.metrics.targetDeckSize;
  const sizeDifference = totalMainCount - targetSize;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(activeContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable
    }
  };

  return (
    <section id="export-section" className="space-y-4 scroll-mt-20">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-display text-xl font-bold text-zinc-900">
            07. Updated Decklist &amp; Export
          </h2>
          <p className="mt-0.5 text-sm text-zinc-600">
            Updated list ready for Arena, Moxfield, Archidekt, MTGO, and ManaBox
            {commanderNames.length > 0 ? ` · ${commanderNames.join(', ')}` : ''}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs font-mono tabular-nums">
          <span
            className={`font-semibold ${
              sizeDifference === 0 ? 'text-emerald-700' : 'text-amber-700'
            }`}
          >
            Resulting Size: {totalMainCount} / {targetSize} cards
            {sizeDifference > 0
              ? ` (${sizeDifference} over)`
              : sizeDifference < 0
              ? ` (${Math.abs(sizeDifference)} short)`
              : ' (Exact)'}
          </span>
          {sizeDifference !== 0 && onAutoBalanceSelection && (
            <button
              type="button"
              onClick={onAutoBalanceSelection}
              className="rounded-md border border-sky-300 bg-sky-50 px-2.5 py-1 font-sans text-[11px] font-semibold text-sky-800 hover:bg-sky-100 cursor-pointer whitespace-nowrap"
            >
              Balance to {targetSize} Cards
            </button>
          )}
          <span className="text-zinc-400" aria-hidden="true">|</span>
          <span className="text-zinc-700">
            Lands: <span className="font-semibold">{resultingLandCount}</span>
          </span>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-1 rounded-lg bg-zinc-100 p-1">
            <button
              type="button"
              onClick={() => setPreviewFormat('txt')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                previewFormat === 'txt'
                  ? 'bg-white text-zinc-900 shadow-sm'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              Decklist (.txt)
            </button>
            <button
              type="button"
              onClick={() => setPreviewFormat('csv')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                previewFormat === 'csv'
                  ? 'bg-white text-zinc-900 shadow-sm'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              Spreadsheet / ManaBox (.csv)
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 text-xs font-medium text-zinc-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeSimulationStats}
                onChange={(e) => setIncludeSimulationStats(e.target.checked)}
                className="rounded border-zinc-300 text-sky-700 focus:ring-sky-600"
              />
              <span>Include Simulation Stats</span>
            </label>
            <span className="text-xs text-zinc-500">
              {previewFormat === 'csv'
                ? 'Includes cards & simulation summary rows'
                : 'Plain text with // comment stats for Moxfield, Archidekt & MTGO'}
            </span>
          </div>
        </div>

        {hasSimulationStats && includeSimulationStats && (
          <div className="mb-3 rounded-lg border border-sky-200 bg-sky-50/50 px-3.5 py-2.5 text-xs">
            <div className="flex items-center gap-1.5 font-semibold text-sky-900">
              <BarChart3 className="h-3.5 w-3.5 text-sky-700 shrink-0" />
              <span>Simulation Stats Included in Export</span>
            </div>
            <div className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2 font-mono text-[11px] text-zinc-700">
              {simulationSummaryLines.slice(0, 6).map((line, i) => (
                <div key={i} className="truncate" title={line}>
                  {line}
                </div>
              ))}
            </div>
          </div>
        )}

        <textarea
          readOnly
          rows={14}
          value={activeContent}
          aria-label={`Optimized decklist ${previewFormat.toUpperCase()} preview`}
          className="w-full rounded-lg border border-zinc-200 bg-zinc-50 p-4 font-mono text-xs leading-relaxed text-zinc-800 focus:outline-none"
        />

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => onReanalyzeUpdated(deckOnlyExportText)}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 cursor-pointer whitespace-nowrap shrink-0"
            >
              <RefreshCw className="h-4 w-4" />
              Re-Analyze Updated List
            </button>

            <button
              type="button"
              onClick={onSaveSnapshot}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3.5 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 cursor-pointer whitespace-nowrap shrink-0"
            >
              {justSavedSnapshot ? (
                <>
                  <Check className="h-4 w-4 text-emerald-700" />
                  <span className="text-emerald-700">Snapshot Saved</span>
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 text-zinc-600" />
                  Save Snapshot
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onOpenHistory}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3.5 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 cursor-pointer whitespace-nowrap shrink-0"
            >
              <History className="h-4 w-4 text-sky-700" />
              Version History ({versionCount})
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 cursor-pointer whitespace-nowrap shrink-0"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied' : `Copy ${previewFormat.toUpperCase()}`}
            </button>

            <ShareExportMenu
              size="md"
              onExportPdf={onOpenPdfReport}
              onExportTxt={() => {
                onSaveSnapshot();
                downloadDeckFile(exportText, analysis.deckName, 'txt');
              }}
              onExportCsv={() => {
                onSaveSnapshot();
                downloadDeckFile(exportCsv, analysis.deckName, 'csv');
              }}
            />
          </div>
        </div>
      </div>
    </section>
  );
};
