import React from 'react';
import { ArrowDownRight, ArrowUpRight, Flag, Sparkles } from 'lucide-react';
import type {
  CardMetadata,
  DeckAnalysisResult,
  PlaytestResult,
} from '../types/deck';
import {
  buildManaCorrelationReport,
  getManaTagMeta,
  type ManaIssueTag,
} from '../utils/manaCorrelation';
import { CardLink } from './CardInspectorModal';

interface PlaytestManaCorrelationProps {
  analysis: DeckAnalysisResult;
  result: PlaytestResult;
  manaTagsByRound: Record<number, ManaIssueTag | undefined>;
  onSelectRoundByNumber: (roundNumber: number) => void;
  onAutoTagRounds: () => void;
  findMeta: (name: string) => CardMetadata | null;
  onInspectCard: (name: string, meta?: CardMetadata | null) => void;
}

export const PlaytestManaCorrelation: React.FC<PlaytestManaCorrelationProps> = ({
  analysis,
  result,
  manaTagsByRound,
  onSelectRoundByNumber,
  onAutoTagRounds,
  findMeta,
  onInspectCard,
}) => {
  const { taggedEntries, findings, correlatedCards } = buildManaCorrelationReport(
    analysis,
    result,
    manaTagsByRound
  );

  const jumpToSection = (sectionId: string) => {
    const el = document.getElementById(sectionId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  if (taggedEntries.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Flag className="h-4 w-4 text-amber-700 shrink-0" />
              <h3 className="font-display text-base font-semibold text-zinc-900">
                Tagged Mana Turns ↔ Analyzer Correlation
              </h3>
            </div>
            <p className="text-sm text-zinc-600">
              Tag any turn in the Match Log sidebar where your mana base underperformed (missed land, color screw, tapped slowdown, or flood) to map that exact turn to your Analyzer land and ramp fixes.
            </p>
          </div>
          <button
            type="button"
            onClick={onAutoTagRounds}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3.5 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Sparkles className="h-3.5 w-3.5 text-sky-700" />
            Auto-tag detected stalls
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 space-y-6">
      {/* Header & Direct Jump Links */}
      <div className="flex flex-col gap-3 border-b border-zinc-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Flag className="h-4 w-4 text-amber-700 shrink-0" />
            <h3 className="font-display text-base font-semibold text-zinc-900">
              Tagged Mana Turns ↔ Analyzer Correlation
            </h3>
            <span className="text-zinc-300" aria-hidden="true">·</span>
            <span className="font-mono text-xs font-semibold tabular-nums text-amber-800">
              {taggedEntries.length} turn{taggedEntries.length === 1 ? '' : 's'} flagged
            </span>
          </div>
          <p className="mt-1 text-xs text-zinc-600">
            Tagged playtest stalls matched directly against {analysis.deckName}&apos;s land count, color pip sources, ramp target, and card swap plan.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => jumpToSection('mana-section')}
            className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 cursor-pointer whitespace-nowrap shrink-0"
          >
            02. Mana &amp; Lands
            <ArrowUpRight className="h-3.5 w-3.5 text-zinc-500" />
          </button>
          <button
            type="button"
            onClick={() => jumpToSection('changes-section')}
            className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 cursor-pointer whitespace-nowrap shrink-0"
          >
            03. Card Changes
            <ArrowUpRight className="h-3.5 w-3.5 text-zinc-500" />
          </button>
        </div>
      </div>

      {/* Correlated Analyzer Diagnostics */}
      <div className="space-y-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Why Those Tagged Turns Stalled (Analyzer Diagnosis)
        </div>
        <div className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">
          {(findings || []).map((finding) => (
            <div key={finding.tag} className="p-4 space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span
                    className={`font-semibold ${
                      finding.severity === 'critical'
                        ? 'text-red-700'
                        : finding.severity === 'warning'
                        ? 'text-amber-800'
                        : 'text-sky-700'
                    }`}
                  >
                    {finding.tagLabel}
                  </span>
                  <span className="text-zinc-300" aria-hidden="true">·</span>
                  <span className="font-semibold text-zinc-900">
                    {finding.diagnosticTitle}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="text-zinc-400">Turns:</span>
                  {(finding.taggedRounds || []).map((rNum, idx) => (
                    <React.Fragment key={rNum}>
                      <button
                        type="button"
                        onClick={() => onSelectRoundByNumber(rNum)}
                        className="font-mono font-semibold text-sky-700 hover:underline cursor-pointer whitespace-nowrap"
                      >
                        R{rNum}
                      </button>
                      {idx < (finding.taggedRounds || []).length - 1 && (
                        <span className="text-zinc-300">,</span>
                      )}
                    </React.Fragment>
                  ))}
                </div>
              </div>
              <p className="text-sm leading-relaxed text-zinc-600">
                {finding.diagnosticDetail}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Directly Correlated Analyzer Card Fixes */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Directly Correlated Deck &amp; Land Fixes ({(correlatedCards || []).length})
          </div>
          <span className="text-xs text-zinc-500">
            Click any card to view printings &amp; marketplace prices
          </span>
        </div>

        {(correlatedCards || []).length === 0 ? (
          <p className="text-sm text-zinc-600">
            No specific mana-related card swaps were emitted in the Analyzer list for these tags — review the Mana &amp; Lands targets above.
          </p>
        ) : (
          <div className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">
            {(correlatedCards || []).map((item) => (
              <div key={item.key} className="p-4 space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span
                      className={`font-mono text-xs font-semibold uppercase ${
                        item.action === 'cut'
                          ? 'text-red-700'
                          : item.action === 'add'
                          ? 'text-emerald-700'
                          : 'text-sky-700'
                      }`}
                    >
                      {item.action}
                    </span>

                    {item.cutCardName && (
                      <>
                        <span className="text-xs text-zinc-400">Cut</span>
                        <CardLink
                          name={item.cutCardName}
                          meta={findMeta(item.cutCardName)}
                          onInspect={onInspectCard}
                        />
                      </>
                    )}

                    {item.cutCardName && item.addCardName && (
                      <span className="text-zinc-400">→</span>
                    )}

                    {item.addCardName && (
                      <>
                        <span className="text-xs text-zinc-400">Put In</span>
                        <CardLink
                          name={item.addCardName}
                          meta={findMeta(item.addCardName)}
                          onInspect={onInspectCard}
                        />
                      </>
                    )}

                    <span className="text-zinc-300" aria-hidden="true">·</span>
                    <span className="text-xs font-medium text-zinc-500">
                      {item.source}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
                    <ArrowDownRight className="h-3.5 w-3.5 text-amber-700" />
                    <span>
                      Fixes{' '}
                      {(item.matchedTags || [])
                        .map((t) => getManaTagMeta(t).shortLabel)
                        .join(' + ')}{' '}
                      (
                      {(item.matchedRounds || []).map((r, i) => (
                        <React.Fragment key={r}>
                          <button
                            type="button"
                            onClick={() => onSelectRoundByNumber(r)}
                            className="font-mono font-semibold text-sky-700 hover:underline cursor-pointer"
                          >
                            R{r}
                          </button>
                          {i < (item.matchedRounds || []).length - 1 ? ', ' : ''}
                        </React.Fragment>
                      ))}
                      )
                    </span>
                  </div>
                </div>
                <p className="text-sm text-zinc-600">{item.reason}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
