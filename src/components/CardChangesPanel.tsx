import React from 'react';
import { ArrowRight, Check } from 'lucide-react';
import type {
  CardAddRecommendation,
  CardCutRecommendation,
  CardMetadata,
  CardSwapRecommendation,
} from '../types/deck';
import { CardLink } from './CardInspectorModal';

interface CardChangesPanelProps {
  swaps: CardSwapRecommendation[];
  cuts: CardCutRecommendation[];
  additions: CardAddRecommendation[];
  selectedSwapIds: Set<string>;
  selectedCutIds: Set<string>;
  selectedAddIds: Set<string>;
  onToggleSwap: (id: string) => void;
  onToggleCut: (id: string) => void;
  onToggleAdd: (id: string) => void;
  onSelectAllChanges: (selectAll: boolean) => void;
  onInspectCard: (name: string, meta?: CardMetadata | null) => void;
  embedded?: boolean;
}

export const CardChangesPanel: React.FC<CardChangesPanelProps> = ({
  swaps,
  cuts,
  additions,
  selectedSwapIds,
  selectedCutIds,
  selectedAddIds,
  onToggleSwap,
  onToggleCut,
  onToggleAdd,
  onSelectAllChanges,
  onInspectCard,
  embedded = false,
}) => {
  const safeSwaps = Array.isArray(swaps) ? swaps : [];
  const safeCuts = Array.isArray(cuts) ? cuts : [];
  const safeAdditions = Array.isArray(additions) ? additions : [];
  const totalOptions = safeSwaps.length + safeCuts.length + safeAdditions.length;
  const totalSelected = selectedSwapIds.size + selectedCutIds.size + selectedAddIds.size;

  const Wrapper: React.ElementType = embedded ? 'div' : 'section';

  return (
    <Wrapper id={embedded ? undefined : 'changes-section'} className={embedded ? 'space-y-5' : 'space-y-6 scroll-mt-20'}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          {!embedded && (
            <h2 className="font-display text-xl font-bold text-zinc-900">
              Suggested Changes
            </h2>
          )}
          <p className={embedded ? 'text-sm text-zinc-600' : 'mt-0.5 text-sm text-zinc-600'}>
            Review recommended swaps, cuts, and additions, then check the ones you want applied to your updated decklist.
          </p>
        </div>

        {totalOptions > 0 && (
          <div className="flex items-center gap-3 text-xs sm:text-sm">
            <span className="font-mono tabular-nums text-zinc-500">
              {totalSelected} of {totalOptions} selected
            </span>
            <button
              type="button"
              onClick={() => onSelectAllChanges(totalSelected < totalOptions)}
              className="inline-flex min-h-[38px] items-center rounded-lg border border-zinc-300 bg-white px-3.5 py-1.5 text-xs sm:text-sm font-semibold text-sky-700 hover:bg-zinc-50 hover:text-sky-800 cursor-pointer whitespace-nowrap shrink-0"
            >
              {totalSelected < totalOptions ? 'Select All' : 'Clear All'}
            </button>
          </div>
        )}
      </div>

      {/* Direct 1-for-1 Card Replacements */}
      <div className="rounded-xl border border-zinc-200 bg-white p-6">
        <div className="border-b border-zinc-100 pb-4">
          <h3 className="font-display text-base font-semibold text-zinc-900">
            One-for-One Swaps
          </h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            Direct upgrades that keep your total deck size the same.
          </p>
        </div>

        {safeSwaps.length === 0 ? (
          <p className="py-5 text-sm text-zinc-500">
            No 1-for-1 swaps needed beyond the cuts or additions below.
          </p>
        ) : (
          <div className="divide-y divide-zinc-100">
            {safeSwaps.map((swap) => {
              const checked = selectedSwapIds.has(swap.id);
              return (
                <div key={swap.id} className="py-4">
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      onClick={() => onToggleSwap(swap.id)}
                      aria-pressed={checked}
                      aria-label={`${checked ? 'Unselect' : 'Select'} swap ${swap.cutCardName} for ${swap.addCardName}`}
                      className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors cursor-pointer ${
                        checked
                          ? 'border-sky-700 bg-sky-700 text-white'
                          : 'border-zinc-300 bg-white text-transparent hover:border-zinc-400'
                      }`}
                    >
                      <Check className="h-4 w-4" />
                    </button>

                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-mono text-xs font-semibold tabular-nums text-red-700">
                          OUT {swap.quantity}x
                        </span>
                        <CardLink
                          name={swap.cutCardName}
                          meta={swap.cutCardMeta}
                          onInspect={onInspectCard}
                        />
                        {swap.cutCardMeta && (
                          <span className="font-mono text-xs tabular-nums text-zinc-400">
                            MV {swap.cutCardMeta.cmc}
                          </span>
                        )}

                        <ArrowRight className="h-4 w-4 text-zinc-400 shrink-0" />

                        <span className="font-mono text-xs font-semibold tabular-nums text-emerald-700">
                          IN {swap.quantity}x
                        </span>
                        <CardLink
                          name={swap.addCardName}
                          meta={swap.addCardMeta}
                          onInspect={onInspectCard}
                        />
                        {swap.addCardMeta && (
                          <span className="font-mono text-xs tabular-nums text-zinc-500">
                            MV {swap.addCardMeta.cmc}
                            {swap.addCardMeta.priceUsd !== null ? ` · $${swap.addCardMeta.priceUsd.toFixed(2)}` : ''}
                          </span>
                        )}

                        <span className="text-xs text-zinc-400" aria-hidden="true">·</span>
                        <span className="text-xs font-medium text-zinc-600">{swap.role}</span>
                      </div>

                      <div className="mt-2 grid grid-cols-1 gap-2 text-sm text-zinc-600 md:grid-cols-2">
                        <div>
                          <span className="font-medium text-red-800">Why cut:</span> {swap.cutReason}
                        </div>
                        <div>
                          <span className="font-medium text-emerald-800">Why add:</span> {swap.addReason}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Standalone Cuts & Additions */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Take Out (Cuts) */}
        <div className="rounded-xl border border-zinc-200 bg-white p-6">
          <div className="border-b border-zinc-100 pb-4">
            <h3 className="font-display text-base font-semibold text-zinc-900">
              Cards to Cut
            </h3>
            <p className="mt-0.5 text-xs text-zinc-500">
              Trim extra lands or cards that slow down your game plan.
            </p>
          </div>

          {safeCuts.length === 0 ? (
            <p className="py-5 text-sm text-zinc-500">
              No extra cuts needed.
            </p>
          ) : (
            <div className="divide-y divide-zinc-100">
              {safeCuts.map((cut) => {
                const checked = selectedCutIds.has(cut.id);
                return (
                  <div key={cut.id} className="flex items-start gap-3 py-3.5">
                    <button
                      type="button"
                      onClick={() => onToggleCut(cut.id)}
                      aria-pressed={checked}
                      aria-label={`${checked ? 'Unselect' : 'Select'} cut ${cut.cardName}`}
                      className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors cursor-pointer ${
                        checked
                          ? 'border-sky-700 bg-sky-700 text-white'
                          : 'border-zinc-300 bg-white text-transparent hover:border-zinc-400'
                      }`}
                    >
                      <Check className="h-4 w-4" />
                    </button>

                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-mono text-xs font-semibold tabular-nums text-red-700">
                          -{cut.quantity}x
                        </span>
                        <CardLink
                          name={cut.cardName}
                          meta={cut.cardMeta}
                          onInspect={onInspectCard}
                        />
                        {cut.cardMeta && (
                          <span className="font-mono text-xs tabular-nums text-zinc-400">
                            MV {cut.cardMeta.cmc}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-zinc-600">{cut.reason}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Put In (Additions) */}
        <div className="rounded-xl border border-zinc-200 bg-white p-6">
          <div className="border-b border-zinc-100 pb-4">
            <h3 className="font-display text-base font-semibold text-zinc-900">
              Cards to Add
            </h3>
            <p className="mt-0.5 text-xs text-zinc-500">
              Fill open slots with card draw, ramp, or interaction.
            </p>
          </div>

          {safeAdditions.length === 0 ? (
            <p className="py-5 text-sm text-zinc-500">
              No extra additions needed.
            </p>
          ) : (
            <div className="divide-y divide-zinc-100">
              {safeAdditions.map((add) => {
                const checked = selectedAddIds.has(add.id);
                return (
                  <div key={add.id} className="flex items-start gap-3 py-3.5">
                    <button
                      type="button"
                      onClick={() => onToggleAdd(add.id)}
                      aria-pressed={checked}
                      aria-label={`${checked ? 'Unselect' : 'Select'} add ${add.cardName}`}
                      className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors cursor-pointer ${
                        checked
                          ? 'border-sky-700 bg-sky-700 text-white'
                          : 'border-zinc-300 bg-white text-transparent hover:border-zinc-400'
                      }`}
                    >
                      <Check className="h-4 w-4" />
                    </button>

                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-mono text-xs font-semibold tabular-nums text-emerald-700">
                          +{add.quantity}x
                        </span>
                        <CardLink
                          name={add.cardName}
                          meta={add.cardMeta}
                          onInspect={onInspectCard}
                        />
                        <span className="text-xs text-zinc-400" aria-hidden="true">·</span>
                        <span className="text-xs font-medium text-zinc-600">{add.role}</span>
                        {add.cardMeta && (
                          <span className="font-mono text-xs tabular-nums text-zinc-500">
                            · MV {add.cardMeta.cmc}
                            {add.cardMeta.priceUsd !== null ? ` · $${add.cardMeta.priceUsd.toFixed(2)}` : ''}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-zinc-600">{add.reason}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Wrapper>
  );
};
