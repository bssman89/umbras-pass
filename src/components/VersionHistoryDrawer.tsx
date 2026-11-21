import React, { useEffect, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  History,
  RotateCcw,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import type {
  DeckAnalysisResult,
  DeckSelectionState,
  DeckVersionSnapshot,
} from '../types/deck';
import { downloadDeckFile } from '../utils/deckExport';
import {
  computeDecklistDiff,
  formatSnapshotTimestamp,
  selectionSignature,
} from '../utils/versionHistory';

interface VersionHistoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  snapshots: DeckVersionSnapshot[];
  currentAnalysis: DeckAnalysisResult | null;
  currentSelection: DeckSelectionState | null;
  currentResultingDeckText: string;
  currentResultingLandCount: number;
  currentTotalMainCount: number;
  onSaveSnapshot: (customLabel?: string) => void;
  onRevertSnapshot: (snapshot: DeckVersionSnapshot) => void;
  onDeleteSnapshot: (snapshotId: string) => void;
  onClearHistory: () => void;
}

export const VersionHistoryDrawer: React.FC<VersionHistoryDrawerProps> = ({
  isOpen,
  onClose,
  snapshots,
  currentAnalysis,
  currentSelection,
  currentResultingDeckText,
  currentResultingLandCount,
  currentTotalMainCount,
  onSaveSnapshot,
  onRevertSnapshot,
  onDeleteSnapshot,
  onClearHistory,
}) => {
  const [labelInput, setLabelInput] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setConfirmClearAll(false);
      return;
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSaveClick = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveSnapshot(labelInput.trim() || undefined);
    setLabelInput('');
  };

  const currentSig = currentSelection ? selectionSignature(currentSelection) : '';
  const totalDeckRecords = (snapshots || []).length;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-zinc-900/50 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="version-history-title"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-2xl flex-col bg-white border-l border-zinc-200 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-6 py-4 shrink-0">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-sky-700 shrink-0" />
              <h2
                id="version-history-title"
                className="font-display text-lg font-bold text-zinc-900"
              >
                My Deck Vault &amp; Version History
              </h2>
              <span className="font-mono text-xs tabular-nums text-zinc-500">
                ({totalDeckRecords})
              </span>
            </div>
            <p className="text-xs text-zinc-600">
              Your uploaded, analyzed, and exported decks are saved automatically on this device.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close Version History"
            className="rounded-lg border border-zinc-200 p-1.5 text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900 cursor-pointer shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Save Current Snapshot Form */}
        {currentAnalysis && currentSelection && (
          <form
            onSubmit={handleSaveClick}
            className="border-b border-zinc-200 bg-zinc-50/70 px-6 py-4 space-y-2.5 shrink-0"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                type="text"
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                placeholder={`Label snapshot (e.g. "${currentResultingLandCount} Lands + Shocklands")`}
                aria-label="Snapshot label"
                className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-sky-600 focus:outline-none"
              />
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-sky-700 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-800 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Save className="h-3.5 w-3.5" />
                Save Snapshot
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-600 font-mono tabular-nums">
              <span className="font-sans font-medium text-zinc-700">
                Current edits:
              </span>
              <span>{currentAnalysis.deckName}</span>
              <span aria-hidden="true">·</span>
              <span>{currentResultingLandCount} lands</span>
              <span aria-hidden="true">·</span>
              <span>{currentTotalMainCount} cards</span>
              <span aria-hidden="true">·</span>
              <span>
                {currentSelection.swapIds.length +
                  currentSelection.cutIds.length +
                  currentSelection.addIds.length +
                  currentSelection.landChangeIds.length}{' '}
                active changes
              </span>
            </div>
          </form>
        )}

        {/* Snapshot Timeline List */}
        <div className="flex-1 overflow-y-auto divide-y divide-zinc-200">
          {(snapshots || []).length === 0 ? (
            <div className="px-6 py-12 text-center space-y-3">
              <p className="text-sm font-medium text-zinc-800">
                No saved deck snapshots yet.
              </p>
              <p className="text-xs text-zinc-500 max-w-sm mx-auto">
                Analyze a deck or click Save Snapshot above to record your current mana base configuration before making further edits.
              </p>
            </div>
          ) : (
            (snapshots || []).map((snap) => {
              const isExpanded = expandedIds.has(snap.id);
              const isExactCurrent =
                Boolean(currentAnalysis) &&
                snap.resultingDeckText === currentResultingDeckText &&
                selectionSignature(snap.selection) === currentSig;

              const landDelta = currentAnalysis
                ? snap.resultingLandCount - currentResultingLandCount
                : 0;

              const diff =
                isExpanded && currentAnalysis
                  ? computeDecklistDiff(snap.resultingDeckText, currentResultingDeckText)
                  : null;

              return (
                <div
                  key={snap.id}
                  className={`px-6 py-4 space-y-3 ${
                    isExactCurrent ? 'bg-sky-50/40' : 'bg-white'
                  }`}
                >
                  {/* Top Row: Label + Metadata */}
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-zinc-900">
                          {snap.label}
                        </span>
                        {isExactCurrent && (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                            <Check className="h-3.5 w-3.5" />
                            Active now
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-500">
                        <span className="font-medium text-zinc-700">{snap.deckName}</span>
                        <span aria-hidden="true">·</span>
                        <span className="capitalize">
                          {snap.analysis?.metrics?.detectedFormat || 'commander'}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {formatSnapshotTimestamp(snap.createdAt)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{snap.isAutoSaved ? 'Auto-saved' : 'Saved snapshot'}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          downloadDeckFile(snap.resultingDeckText, snap.deckName, 'txt')
                        }
                        title="Export snapshot as .txt"
                        className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 cursor-pointer whitespace-nowrap shrink-0"
                      >
                        <Download className="h-3.5 w-3.5" />
                        .txt
                      </button>

                      <button
                        type="button"
                        onClick={() => onDeleteSnapshot(snap.id)}
                        aria-label={`Delete snapshot ${snap.label}`}
                        title="Delete snapshot"
                        className="inline-flex items-center justify-center rounded-md border border-zinc-200 bg-white p-1.5 text-zinc-500 hover:border-red-200 hover:text-red-700 cursor-pointer shrink-0"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Mana Base Configuration Metrics */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-mono tabular-nums text-zinc-700">
                    <span>
                      Lands:{' '}
                      <strong className="text-zinc-900">{snap.resultingLandCount}</strong>
                      {currentAnalysis && landDelta !== 0 && (
                        <span
                          className={`ml-1 font-semibold ${
                            landDelta > 0 ? 'text-sky-700' : 'text-amber-700'
                          }`}
                        >
                          ({landDelta > 0 ? `+${landDelta}` : landDelta} vs current)
                        </span>
                      )}
                    </span>
                    <span className="text-zinc-300" aria-hidden="true">·</span>
                    <span>{snap.totalMainCount} cards</span>
                    <span className="text-zinc-300" aria-hidden="true">·</span>
                    <span>Tapped: {snap.tappedLandCount}</span>
                    <span className="text-zinc-300" aria-hidden="true">·</span>
                    <span>Avg MV: {snap.averageCmcNonLand}</span>
                    <span className="text-zinc-300" aria-hidden="true">·</span>
                    <span>{snap.activeChangeCount} edits</span>
                  </div>

                  <div className="text-xs text-zinc-500 font-mono tabular-nums">
                    Mana sources: <span className="text-zinc-700">{snap.activeColorSummary}</span>
                  </div>

                  {/* Action Row */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <button
                      type="button"
                      onClick={() => toggleExpand(snap.id)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:text-sky-900 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      {isExpanded ? (
                        <>
                          <ChevronUp className="h-3.5 w-3.5" />
                          Hide diff &amp; decklist
                        </>
                      ) : (
                        <>
                          <ChevronDown className="h-3.5 w-3.5" />
                          Compare diff &amp; decklist
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      disabled={isExactCurrent}
                      onClick={() => onRevertSnapshot(snap)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      {isExactCurrent ? 'Currently Active' : 'Revert to This Version'}
                    </button>
                  </div>

                  {/* Expanded Diff & Decklist Preview */}
                  {isExpanded && (
                    <div className="pt-2 space-y-3 border-t border-zinc-100">
                      {diff && (
                        <div className="space-y-1.5 text-xs">
                          <div className="font-semibold text-zinc-700">
                            Changes if you revert to this snapshot:
                          </div>
                          {diff.isIdentical ? (
                            <p className="text-zinc-500">
                              Card list matches your current decklist exactly.
                            </p>
                          ) : (
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                              {(diff.addedInSnapshot || []).length > 0 && (
                                <div className="space-y-0.5">
                                  <div className="font-medium text-emerald-700">
                                    Restored / Added back:
                                  </div>
                                  <ul className="font-mono text-[11px] text-zinc-700 space-y-0.5">
                                    {(diff.addedInSnapshot || []).map((entry) => (
                                      <li key={`add-${entry.name}`}>
                                        +{entry.delta} {entry.name}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              {(diff.removedInSnapshot || []).length > 0 && (
                                <div className="space-y-0.5">
                                  <div className="font-medium text-red-700">
                                    Removed vs current:
                                  </div>
                                  <ul className="font-mono text-[11px] text-zinc-700 space-y-0.5">
                                    {(diff.removedInSnapshot || []).map((entry) => (
                                      <li key={`rem-${entry.name}`}>
                                        -{entry.delta} {entry.name}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      <textarea
                        readOnly
                        rows={7}
                        value={snap.resultingDeckText}
                        aria-label={`Decklist preview for ${snap.label}`}
                        className="w-full rounded-lg border border-zinc-200 bg-zinc-50 p-3 font-mono text-[11px] leading-relaxed text-zinc-800 focus:outline-none"
                      />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        {totalDeckRecords > 0 && (
          <div className="flex items-center justify-between gap-4 border-t border-zinc-200 bg-zinc-50 px-6 py-3 shrink-0">
            <span className="text-xs text-zinc-500">
              Saved locally on this device.
            </span>

            {confirmClearAll ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmClearAll(false)}
                  className="text-xs font-medium text-zinc-600 hover:text-zinc-900 cursor-pointer whitespace-nowrap"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClearHistory();
                    setConfirmClearAll(false);
                  }}
                  className="rounded-md bg-red-700 px-3 py-1 text-xs font-semibold text-white hover:bg-red-800 cursor-pointer whitespace-nowrap"
                >
                  Confirm Clear All
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClearAll(true)}
                className="text-xs font-medium text-zinc-600 hover:text-red-700 cursor-pointer whitespace-nowrap"
              >
                Clear All My Decks
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
