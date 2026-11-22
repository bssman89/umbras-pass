import React, { useMemo } from 'react';
import { ArrowDownRight, ArrowUpRight, DollarSign } from 'lucide-react';
import type { CardMetadata, DeckAnalysisResult } from '../types/deck';
import { buildOptimizedDeckExport, type ExtraSwapSpec } from '../utils/deckExport';
import { consolidateResolvedDeckCards } from '../utils/deckRules';
import { CardLink } from './CardInspectorModal';

interface DeckBudgetComparisonProps {
  analysis: DeckAnalysisResult;
  selectedSwapIds: Set<string>;
  selectedCutIds: Set<string>;
  selectedAddIds: Set<string>;
  selectedLandChangeIds: Set<string>;
  extraSwaps: ExtraSwapSpec[];
  onInspectCard: (name: string, meta?: CardMetadata | null) => void;
}

export const DeckBudgetComparison: React.FC<DeckBudgetComparisonProps> = ({
  analysis,
  selectedSwapIds,
  selectedCutIds,
  selectedAddIds,
  selectedLandChangeIds,
  extraSwaps,
  onInspectCard,
}) => {
  const { currentTotalUsd, optimizedTotalUsd, netDeltaUsd, priceItems } = useMemo(() => {
    const detectedFormat = analysis?.metrics?.detectedFormat;
    const consolidated = consolidateResolvedDeckCards(
      analysis?.resolvedCards || [],
      detectedFormat
    );

    let currentSum = 0;
    let currentCountPriced = 0;

    for (const card of consolidated) {
      if (!card || card.zone === 'sideboard' || card.zone === 'maybeboard') continue;
      const p = card.card?.priceUsd;
      if (typeof p === 'number' && !isNaN(p) && p > 0) {
        currentSum += p * (card.quantity || 1);
        currentCountPriced += card.quantity || 1;
      }
    }

    const optimized = buildOptimizedDeckExport(
      analysis,
      selectedSwapIds,
      selectedCutIds,
      selectedAddIds,
      selectedLandChangeIds,
      extraSwaps
    );

    let optimizedSum = 0;
    for (const entry of optimized.entries) {
      if (!entry || entry.zone === 'Sideboard') continue;
      const p = entry.meta?.priceUsd;
      if (typeof p === 'number' && !isNaN(p) && p > 0) {
        optimizedSum += p * entry.qty;
      }
    }

    const delta = optimizedSum - currentSum;

    // Collect individual price items for active swaps/additions
    const items: Array<{
      name: string;
      action: 'add' | 'cut';
      qty: number;
      price: number;
      meta?: CardMetadata | null;
    }> = [];

    for (const swap of analysis?.swaps || []) {
      if (!swap || !selectedSwapIds.has(swap.id)) continue;
      const addPrice = swap.addCardMeta?.priceUsd ?? 0;
      items.push({
        name: swap.addCardName,
        action: 'add',
        qty: swap.quantity,
        price: addPrice,
        meta: swap.addCardMeta,
      });
      const cutPrice = swap.cutCardMeta?.priceUsd ?? 0;
      items.push({
        name: swap.cutCardName,
        action: 'cut',
        qty: swap.quantity,
        price: cutPrice,
        meta: swap.cutCardMeta,
      });
    }

    return {
      currentTotalUsd: currentCountPriced > 0 ? currentSum : null,
      optimizedTotalUsd: currentCountPriced > 0 ? optimizedSum : null,
      netDeltaUsd: currentCountPriced > 0 ? delta : null,
      priceItems: items,
    };
  }, [
    analysis,
    selectedSwapIds,
    selectedCutIds,
    selectedAddIds,
    selectedLandChangeIds,
    extraSwaps,
  ]);

  if (currentTotalUsd === null || optimizedTotalUsd === null) {
    return null;
  }

  const isMoreExpensive = netDeltaUsd !== null && netDeltaUsd > 0;
  const isCheaper = netDeltaUsd !== null && netDeltaUsd < 0;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 space-y-5">
      <div className="flex flex-col gap-1 border-b border-zinc-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <DollarSign className="h-5 w-5 text-sky-700 shrink-0" />
          <div>
            <h3 className="font-display text-base font-semibold text-zinc-900">
              Deck Cost Comparison
            </h3>
            <p className="mt-0.5 text-xs text-zinc-500">
              Estimated USD value before and after your selected card changes.
            </p>
          </div>
        </div>

        <div className="font-mono text-xs tabular-nums text-zinc-500">
          Scryfall USD
        </div>
      </div>

      <div className="grid grid-cols-1 divide-y divide-zinc-100 sm:grid-cols-3 sm:divide-y-0 sm:divide-x">
        <div className="py-2 sm:pr-6">
          <div className="text-xs font-medium text-zinc-500">Original Deck</div>
          <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-zinc-900">
            ${currentTotalUsd.toFixed(2)}
          </div>
          <div className="mt-0.5 text-xs text-zinc-500">
            Imported list value
          </div>
        </div>

        <div className="py-2 sm:px-6">
          <div className="text-xs font-medium text-zinc-500">Updated Deck</div>
          <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-zinc-900">
            ${optimizedTotalUsd.toFixed(2)}
          </div>
          <div className="mt-0.5 text-xs text-zinc-500">
            Includes checked swaps and fixes
          </div>
        </div>

        <div className="py-2 sm:pl-6">
          <div className="text-xs font-medium text-zinc-500">Cost Difference</div>
          <div
            className={`mt-1 font-mono text-2xl font-bold tabular-nums flex items-center gap-1 ${
              isMoreExpensive
                ? 'text-amber-800'
                : isCheaper
                ? 'text-emerald-700'
                : 'text-zinc-900'
            }`}
          >
            {isMoreExpensive ? (
              <ArrowUpRight className="h-5 w-5 shrink-0" />
            ) : isCheaper ? (
              <ArrowDownRight className="h-5 w-5 shrink-0" />
            ) : null}
            {netDeltaUsd !== null
              ? `${netDeltaUsd >= 0 ? '+' : ''}$${netDeltaUsd.toFixed(2)}`
              : '$0.00'}
          </div>
          <div className="mt-0.5 text-xs text-zinc-500">
            {isMoreExpensive
              ? 'Increases deck cost'
              : isCheaper
              ? 'Saves budget'
              : 'No net change'}
          </div>
        </div>
      </div>

      {priceItems.length > 0 && (
        <div className="border-t border-zinc-100 pt-4 space-y-3">
          <div className="text-xs font-semibold text-zinc-600">
            Selected Swap Price Impact
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {priceItems.map((item, idx) => (
              <div
                key={`${item.name}-${idx}`}
                className="flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50/70 px-3 py-2 text-xs"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`font-mono font-semibold uppercase ${
                      item.action === 'add' ? 'text-emerald-700' : 'text-red-700'
                    }`}
                  >
                    {item.action === 'add' ? '+' : '-'} {item.qty}x
                  </span>
                  <CardLink
                    name={item.name}
                    meta={item.meta}
                    onInspect={onInspectCard}
                    className="truncate text-xs"
                  />
                </div>
                <div className="font-mono tabular-nums font-semibold text-zinc-800 shrink-0 ml-2">
                  ${(item.price * item.qty).toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
