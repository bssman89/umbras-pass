import React, { memo, useEffect, useMemo, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import type { CardMetadata, DeckAnalysisResult } from '../types/deck';
import {
  safeParseApiJson,
  searchMtgDatabaseFromBrowserScryfall,
} from '../utils/clientFallbackAnalyzer';
import {
  buildHoverRect,
  hideGlobalCardHover,
  showGlobalCardHover,
} from './CardHoverZoomOverlay';
import {
  getScryfallFallbackImageUri,
  resolveCardWithCustomProxy,
} from '../utils/customCardProxiesAndTokens';

interface CardGalleryPanelProps {
  analysis: DeckAnalysisResult;
  onInspectCard: (name: string, meta?: CardMetadata | null) => void;
}

type GalleryTab = 'suggestions' | 'deck' | 'database';

interface GalleryItem {
  id: string;
  name: string;
  quantity?: number;
  subtitle: string;
  meta: CardMetadata | null;
}

const GALLERY_PAGE_SIZE = 24;

export const CardGalleryPanel: React.FC<CardGalleryPanelProps> = memo(({
  analysis,
  onInspectCard,
}) => {
  const [activeTab, setActiveTab] = useState<GalleryTab>('suggestions');
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const [visibleLimit, setVisibleLimit] = useState<number>(GALLERY_PAGE_SIZE);
  const [localFilter, setLocalFilter] = useState<string>('');

  useEffect(() => {
    setVisibleLimit(GALLERY_PAGE_SIZE);
    setLocalFilter('');
  }, [activeTab, analysis.deckName]);

  // MTG Database search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<CardMetadata[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const suggestedItems = useMemo<GalleryItem[]>(() => {
    const seen = new Set<string>();
    const items: GalleryItem[] = [];

    for (const s of analysis.swaps ?? []) {
      const key = s.addCardName.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        id: `sug-swap-${s.id}`,
        name: s.addCardName,
        quantity: s.quantity,
        subtitle: `Swap In · ${s.role}`,
        meta: s.addCardMeta ?? null,
      });
    }

    for (const a of analysis.additions ?? []) {
      const key = a.cardName.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        id: `sug-add-${a.id}`,
        name: a.cardName,
        quantity: a.quantity,
        subtitle: `Put In · ${a.role}`,
        meta: a.cardMeta ?? null,
      });
    }

    for (const lc of analysis.manaPlan?.landChanges ?? []) {
      if (lc.action !== 'add') continue;
      const key = lc.cardName.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        id: `sug-land-${lc.id}`,
        name: lc.cardName,
        quantity: lc.quantity,
        subtitle: 'Mana Fix · Land / Ramp',
        meta: lc.cardMeta ?? null,
      });
    }

    return items;
  }, [analysis]);

  const deckItems = useMemo<GalleryItem[]>(() => {
    const sorted = [...(analysis.resolvedCards ?? [])].sort((a, b) => {
      if (a.zone === 'commander' && b.zone !== 'commander') return -1;
      if (b.zone === 'commander' && a.zone !== 'commander') return 1;
      const aLand = a.card?.isLand ? 1 : 0;
      const bLand = b.card?.isLand ? 1 : 0;
      if (aLand !== bLand) return aLand - bLand;
      return (a.card?.cmc ?? 99) - (b.card?.cmc ?? 99);
    });

    return sorted.map((c, idx) => ({
      id: `deck-${idx}-${c.name}`,
      name: c.name,
      quantity: c.quantity,
      subtitle:
        c.zone === 'commander'
          ? 'Commander'
          : c.zone === 'sideboard'
          ? 'Sideboard'
          : c.card?.typeLine?.split('—')[0]?.trim() || 'Mainboard',
      meta: c.card,
    }));
  }, [analysis.resolvedCards]);

  const deckMarketTotals = useMemo(() => {
    let tcgTotal = 0;
    let ckTotal = 0;
    let tcgCount = 0;
    let ckCount = 0;

    for (const c of analysis.resolvedCards ?? []) {
      if (c.zone === 'maybeboard') continue;
      if (c.card?.priceUsd !== null && c.card?.priceUsd !== undefined) {
        tcgTotal += c.card.priceUsd * c.quantity;
        tcgCount += c.quantity;
      }
      if (
        c.card?.cardKingdomPriceUsd !== null &&
        c.card?.cardKingdomPriceUsd !== undefined
      ) {
        ckTotal += c.card.cardKingdomPriceUsd * c.quantity;
        ckCount += c.quantity;
      }
    }
    return { tcgTotal, ckTotal, tcgCount, ckCount };
  }, [analysis.resolvedCards]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchError(null);
    setHasSearched(true);

    try {
      let cards: CardMetadata[] | null = null;
      try {
        const res = await fetch(
          `/api/cards/search?q=${encodeURIComponent(searchQuery.trim())}`
        );
        const data = await safeParseApiJson<{ cards?: CardMetadata[]; error?: string }>(res);
        if (data) {
          if (!res.ok) throw new Error(data.error || 'Card search failed.');
          if (Array.isArray(data.cards)) {
            cards = data.cards;
          }
        }
      } catch {
        // Fall back to direct Scryfall search
      }

      if (!cards) {
        cards = await searchMtgDatabaseFromBrowserScryfall(searchQuery.trim());
      }
      setSearchResults(cards || []);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Search failed.');
    } finally {
      setSearching(false);
    }
  };

  const renderCardGrid = (items: GalleryItem[], enableProgressive = false) => {
    if (items.length === 0) {
      return (
        <p className="py-8 text-center text-sm text-zinc-500">
          No cards to display in this view.
        </p>
      );
    }

    const q = enableProgressive ? localFilter.trim().toLowerCase() : '';
    const filteredItems = q
      ? items.filter(
          (item) =>
            item.name.toLowerCase().includes(q) ||
            item.subtitle.toLowerCase().includes(q)
        )
      : items;
    const visibleItems =
      enableProgressive && !q ? filteredItems.slice(0, visibleLimit) : filteredItems;
    const hasMore = enableProgressive && !q && visibleItems.length < filteredItems.length;

    return (
      <div className="space-y-4">
        {enableProgressive && items.length > GALLERY_PAGE_SIZE && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-full sm:w-80">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                value={localFilter}
                onChange={(e) => setLocalFilter(e.target.value)}
                placeholder="Filter cards in this view..."
                className="min-h-[40px] w-full rounded-lg border border-zinc-300 bg-white pl-9 pr-3.5 py-2 text-xs sm:text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-sky-600 focus:outline-none"
              />
            </div>
            <span className="font-mono text-xs tabular-nums text-zinc-500">
              Showing {visibleItems.length} of {filteredItems.length} cards
            </span>
          </div>
        )}

        {filteredItems.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-500">
            No cards matched "{localFilter}".
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {visibleItems.map((item) => {
              const resolved = resolveCardWithCustomProxy(item.name, item.meta || null);
              const imgUri =
                resolved.meta?.imageUri ||
                item.meta?.imageUri ||
                getScryfallFallbackImageUri(item.name);
              const isBroken = !imgUri || failedImages.has(item.id);

              return (
                <button
                  key={item.id}
                  type="button"
                  onMouseEnter={(e) =>
                    showGlobalCardHover({
                      name: item.name,
                      meta: item.meta,
                      rect: buildHoverRect(e.currentTarget),
                      statusTags: item.subtitle ? [item.subtitle] : undefined,
                    })
                  }
                  onMouseLeave={hideGlobalCardHover}
                  onClick={() => {
                    hideGlobalCardHover();
                    onInspectCard(item.name, item.meta);
                  }}
                  className="group flex flex-col text-left rounded-lg border border-zinc-200 bg-white p-2 hover:border-sky-600 transition-colors cursor-pointer"
                >
                  <div className="relative aspect-[5/7] w-full overflow-hidden rounded-md bg-zinc-100">
                    {!isBroken ? (
                      <img
                        src={imgUri}
                        alt={item.name}
                        loading="lazy"
                        decoding="async"
                        referrerPolicy="no-referrer"
                        onError={() =>
                          setFailedImages((prev) => new Set(prev).add(item.id))
                        }
                        className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                      />
                    ) : (
                      <div className="flex h-full w-full flex-col items-center justify-center p-2 text-center">
                        <div className="text-xs font-semibold text-zinc-800 line-clamp-2">
                          {item.name}
                        </div>
                        {item.meta?.manaCost && (
                          <div className="mt-1 font-mono text-[10px] text-zinc-500">
                            {item.meta.manaCost}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="mt-2 space-y-0.5 px-0.5">
                    <div className="truncate text-xs font-semibold text-zinc-900 group-hover:text-sky-700">
                      {item.quantity ? `${item.quantity}x ` : ''}
                      {item.name}
                    </div>
                    <div className="truncate text-xs text-zinc-500">
                      {item.subtitle}
                      {item.meta?.setCode ? ` · ${item.meta.setCode}` : ''}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 font-mono text-xs tabular-nums text-zinc-700">
                      <span>
                        TCG{' '}
                        {item.meta?.priceUsd !== null && item.meta?.priceUsd !== undefined
                          ? `$${item.meta.priceUsd.toFixed(2)}`
                          : '—'}
                      </span>
                      {item.meta?.cardKingdomPriceUsd !== null &&
                        item.meta?.cardKingdomPriceUsd !== undefined && (
                          <>
                            <span className="text-zinc-300" aria-hidden="true">·</span>
                            <span>CK ${item.meta.cardKingdomPriceUsd.toFixed(2)}</span>
                          </>
                        )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {hasMore && (
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => setVisibleLimit((prev) => prev + GALLERY_PAGE_SIZE)}
              className="inline-flex min-h-[40px] items-center rounded-lg border border-zinc-300 bg-white px-4 py-2 text-xs sm:text-sm font-semibold text-zinc-800 hover:bg-zinc-50 cursor-pointer whitespace-nowrap shrink-0"
            >
              Show Next {Math.min(GALLERY_PAGE_SIZE, filteredItems.length - visibleItems.length)} Cards
            </button>
            <button
              type="button"
              onClick={() => setVisibleLimit(filteredItems.length)}
              className="inline-flex min-h-[40px] items-center rounded-lg border border-zinc-300 bg-white px-4 py-2 text-xs sm:text-sm font-semibold text-zinc-700 hover:bg-zinc-50 hover:text-zinc-900 cursor-pointer whitespace-nowrap shrink-0"
            >
              Show All ({filteredItems.length})
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <section id="gallery-section" className="space-y-4 scroll-mt-20">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-display text-xl font-bold text-zinc-900">
            Card Gallery
          </h2>
          <p className="mt-0.5 text-sm text-zinc-600">
            Browse card art across your deck and suggested upgrades, inspect printings, and compare live store prices.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs font-mono tabular-nums text-zinc-600">
          {deckMarketTotals.tcgCount > 0 && (
            <span>
              TCGplayer:{' '}
              <span className="font-semibold text-zinc-900">
                ${deckMarketTotals.tcgTotal.toFixed(2)}
              </span>
            </span>
          )}
          {deckMarketTotals.ckCount > 0 && (
            <>
              <span className="text-zinc-300" aria-hidden="true">·</span>
              <span>
                Card Kingdom:{' '}
                <span className="font-semibold text-zinc-900">
                  ${deckMarketTotals.ckTotal.toFixed(2)}
                </span>
              </span>
            </>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-100 pb-4">
          <div className="inline-flex flex-wrap items-center gap-1.5 rounded-xl bg-zinc-100 p-1.5">
            <button
              type="button"
              onClick={() => setActiveTab('suggestions')}
              className={`min-h-[38px] px-4 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'suggestions'
                  ? 'bg-white text-zinc-900 shadow-sm'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              Suggested Cards ({suggestedItems.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('deck')}
              className={`min-h-[38px] px-4 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'deck'
                  ? 'bg-white text-zinc-900 shadow-sm'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              Your Deck ({deckItems.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('database')}
              className={`min-h-[38px] px-4 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'database'
                  ? 'bg-white text-zinc-900 shadow-sm'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              Search All MTG Sets
            </button>
          </div>

          <span className="text-xs text-zinc-500">
            Click any card for printings &amp; store links
          </span>
        </div>

        {activeTab === 'suggestions' && renderCardGrid(suggestedItems, true)}
        {activeTab === 'deck' && renderCardGrid(deckItems, true)}

        {activeTab === 'database' && (
          <div className="space-y-5">
            <form onSubmit={handleSearch} className="flex flex-col gap-3 sm:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder='Search any Magic card or Scryfall query (e.g. "Rhystic Study", "t:land id:ub")'
                  className="min-h-[42px] w-full rounded-lg border border-zinc-300 bg-white pl-10 pr-4 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-600/20"
                />
              </div>
              <button
                type="submit"
                disabled={searching || !searchQuery.trim()}
                className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-lg bg-sky-700 px-5 py-2 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
              >
                {searching && <Loader2 className="h-4 w-4 animate-spin" />}
                {searching ? 'Searching...' : 'Search Database'}
              </button>
            </form>

            {searchError && (
              <p className="text-sm text-red-700">{searchError}</p>
            )}

            {!hasSearched && (
              <p className="py-6 text-center text-sm text-zinc-500">
                Search the Scryfall MTG database across all sets to inspect card art, printings, and prices from TCGplayer, Card Kingdom, and eBay.
              </p>
            )}

            {hasSearched && !searching && searchResults.length === 0 && !searchError && (
              <p className="py-6 text-center text-sm text-zinc-500">
                No cards matched "{searchQuery}". Try another card name or Scryfall filter.
              </p>
            )}

            {searchResults.length > 0 &&
              renderCardGrid(
                searchResults.map((card, idx) => ({
                  id: `db-${idx}-${card.name}`,
                  name: card.name,
                  subtitle: card.typeLine.split('—')[0]?.trim() || 'Card',
                  meta: card,
                }))
              )}
          </div>
        )}
      </div>
    </section>
  );
});
CardGalleryPanel.displayName = 'CardGalleryPanel';
