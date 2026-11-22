import React, { useMemo, useState } from 'react';
import { BarChart3, Check, Copy, Download, History, RefreshCw, Save } from 'lucide-react';
import type { DeckAnalysisResult, DeckExportSimulationStats } from '../types/deck';
import {
  buildOptimizedDeckExport,
  copyTextToClipboard,
  downloadDeckFile,
  type ExportFileExtension,
  type ExportPlatform,
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
  embedded?: boolean;
}

const PLATFORM_LABELS: Record<ExportPlatform, string> = {
  standard: 'Standard',
  moxfield: 'Moxfield',
  archidekt: 'Archidekt',
  raw: 'Raw List',
};

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
  embedded = false,
}) => {
  const [copied, setCopied] = useState(false);
  const [exportPlatform, setExportPlatform] = useState<ExportPlatform>('standard');
  const [previewFormat, setPreviewFormat] = useState<ExportFileExtension>('txt');
  const [includeSimulationStats, setIncludeSimulationStats] = useState(true);

  const {
    exportText,
    deckOnlyExportText,
    rawListText,
    exportCsv,
    moxfieldText,
    moxfieldCsv,
    archidektText,
    archidektCsv,
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

  const effectiveFormat: ExportFileExtension =
    exportPlatform === 'raw' ? 'txt' : previewFormat;

  const activeContent = useMemo(() => {
    if (exportPlatform === 'raw') {
      return rawListText;
    }
    if (exportPlatform === 'moxfield') {
      return previewFormat === 'csv' ? moxfieldCsv : moxfieldText;
    }
    if (exportPlatform === 'archidekt') {
      return previewFormat === 'csv' ? archidektCsv : archidektText;
    }
    return previewFormat === 'csv' ? exportCsv : exportText;
  }, [
    exportPlatform,
    previewFormat,
    rawListText,
    moxfieldCsv,
    moxfieldText,
    archidektCsv,
    archidektText,
    exportCsv,
    exportText,
  ]);

  const formatHelperText = useMemo(() => {
    if (exportPlatform === 'raw') {
      return 'Plain card list (Qty Card Name) with no section headers, set codes, tags, or comments — built for quick clipboard copy and bulk entry.';
    }
    if (exportPlatform === 'moxfield') {
      return previewFormat === 'csv'
        ? 'Moxfield CSV columns (Count, Name, Edition, Collector Number, Tags) — pure card rows for clean Moxfield import.'
        : 'Moxfield text syntax with set codes, collector numbers, and COMMANDER:/SIDEBOARD: blocks.';
    }
    if (exportPlatform === 'archidekt') {
      return previewFormat === 'csv'
        ? 'Archidekt CSV columns (Quantity, Name, Edition Code, Collector Number, Categories) — auto-categorized for direct upload.'
        : 'Archidekt text syntax (1x Card [Category]) with automatic Commander, Ramp, Draw, Removal & Land tags.';
    }
    return previewFormat === 'csv'
      ? 'Includes cards & optional simulation summary rows for spreadsheets / ManaBox.'
      : 'Standard plain text with optional // comment stats for Arena & MTGO.';
  }, [exportPlatform, previewFormat]);

  const targetSize = analysis.metrics.targetDeckSize;
  const sizeDifference = totalMainCount - targetSize;
  const activePlatformLabel = PLATFORM_LABELS[exportPlatform];
  const downloadSuffix =
    exportPlatform === 'standard'
      ? undefined
      : exportPlatform === 'raw'
      ? 'raw-list'
      : exportPlatform;

  const handleCopy = async () => {
    const ok = await copyTextToClipboard(activeContent);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownloadActive = () => {
    onSaveSnapshot();
    downloadDeckFile(activeContent, analysis.deckName, effectiveFormat, downloadSuffix);
  };

  const Wrapper: React.ElementType = embedded ? 'div' : 'section';

  return (
    <Wrapper id={embedded ? undefined : 'export-section'} className={embedded ? 'space-y-4' : 'space-y-4 scroll-mt-20'}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          {!embedded && (
            <h2 className="font-display text-xl font-bold text-zinc-900">
              Decklist &amp; Export
            </h2>
          )}
          <p className={embedded ? 'text-sm text-zinc-600' : 'mt-0.5 text-sm text-zinc-600'}>
            Copy or download your updated list as a raw list or formatted for Moxfield, Archidekt, Arena, MTGO, or ManaBox
            {commanderNames.length > 0 ? ` (${commanderNames.join(', ')})` : ''}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs font-mono tabular-nums">
          <span
            className={`font-semibold ${
              sizeDifference === 0 ? 'text-emerald-700' : 'text-amber-700'
            }`}
          >
            Deck Size: {totalMainCount} / {targetSize}
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
          <span className="text-zinc-400" aria-hidden="true">·</span>
          <span className="text-zinc-700">
            Lands: <span className="font-semibold">{resultingLandCount}</span>
          </span>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Platform Preset Selector */}
            <div
              role="group"
              aria-label="Export platform preset"
              className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-zinc-100 p-1"
            >
              {(['standard', 'moxfield', 'archidekt', 'raw'] as ExportPlatform[]).map((platform) => (
                <button
                  key={platform}
                  type="button"
                  onClick={() => {
                    setExportPlatform(platform);
                    if (platform === 'raw') {
                      setPreviewFormat('txt');
                    }
                  }}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    exportPlatform === platform
                      ? 'bg-white text-zinc-900 shadow-sm'
                      : 'text-zinc-600 hover:text-zinc-900'
                  }`}
                >
                  {PLATFORM_LABELS[platform]}
                </button>
              ))}
            </div>

            {/* File Format Selector */}
            {exportPlatform !== 'raw' && (
              <div
                role="group"
                aria-label="Export file format"
                className="inline-flex items-center gap-1 rounded-lg bg-zinc-100 p-1"
              >
                <button
                  type="button"
                  onClick={() => setPreviewFormat('txt')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    previewFormat === 'txt'
                      ? 'bg-white text-zinc-900 shadow-sm'
                      : 'text-zinc-600 hover:text-zinc-900'
                  }`}
                >
                  Text (.txt)
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
                  CSV (.csv)
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {exportPlatform === 'standard' && (
              <label className="inline-flex items-center gap-2 text-xs font-medium text-zinc-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeSimulationStats}
                  onChange={(e) => setIncludeSimulationStats(e.target.checked)}
                  className="rounded border-zinc-300 text-sky-700 focus:ring-sky-600"
                />
                <span>Include Simulation Stats</span>
              </label>
            )}
          </div>
        </div>

        <p className="mb-3 text-xs text-zinc-500">{formatHelperText}</p>

        {exportPlatform === 'standard' && hasSimulationStats && includeSimulationStats && (
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
          aria-label={`Optimized decklist ${activePlatformLabel} ${effectiveFormat.toUpperCase()} preview`}
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

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 cursor-pointer whitespace-nowrap shrink-0"
            >
              {copied ? <Check className="h-4 w-4 text-emerald-700" /> : <Copy className="h-4 w-4" />}
              {copied
                ? 'Copied'
                : exportPlatform === 'raw'
                ? 'Copy Raw List'
                : `Copy ${activePlatformLabel} ${effectiveFormat.toUpperCase()}`}
            </button>

            <button
              type="button"
              onClick={handleDownloadActive}
              className="inline-flex items-center gap-2 rounded-lg border border-sky-600/40 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-800 hover:bg-sky-100 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Download className="h-4 w-4 text-sky-700 shrink-0" />
              Download {activePlatformLabel} .{effectiveFormat}
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
              onCopyRawList={() => copyTextToClipboard(rawListText)}
              onExportRawListTxt={() => {
                onSaveSnapshot();
                downloadDeckFile(rawListText, analysis.deckName, 'txt', 'raw-list');
              }}
              onExportMoxfieldTxt={() => {
                onSaveSnapshot();
                downloadDeckFile(moxfieldText, analysis.deckName, 'txt', 'moxfield');
              }}
              onExportMoxfieldCsv={() => {
                onSaveSnapshot();
                downloadDeckFile(moxfieldCsv, analysis.deckName, 'csv', 'moxfield');
              }}
              onExportArchidektTxt={() => {
                onSaveSnapshot();
                downloadDeckFile(archidektText, analysis.deckName, 'txt', 'archidekt');
              }}
              onExportArchidektCsv={() => {
                onSaveSnapshot();
                downloadDeckFile(archidektCsv, analysis.deckName, 'csv', 'archidekt');
              }}
            />
          </div>
        </div>
      </div>
    </Wrapper>
  );
};
