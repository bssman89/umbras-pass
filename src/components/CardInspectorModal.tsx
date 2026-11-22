import React, { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Loader2, RefreshCw, X } from 'lucide-react';
import type { CardMetadata, CardPrinting, CardPrintingsResponse } from '../types/deck';
import {
  fetchCardPrintingsFromBrowserScryfall,
  safeParseApiJson,
} from '../utils/clientFallbackAnalyzer';

export { CardLink } from './CardTooltip';
import {
  buildHoverRect,
  hideGlobalCardHover,
  showGlobalCardHover,
} from './CardHoverZoomOverlay';

interface CardInspectorModalProps {
  cardName: string | null;
  meta: CardMetadata | null;
  onClose: () => void;
}

export const CardInspectorModal: React.FC<CardInspectorModalProps> = ({
  cardName,
  meta,
  onClose,
}) => {
  const [imgFailed, setImgFailed] = useState(false);
  const [showBackFace, setShowBackFace] = useState(false);
  const [loadingPrintings, setLoadingPrintings] = useState(false);
  const [printingsData, setPrintingsData] = useState<CardPrintingsResponse | null>(null);
  const [selectedPrintingId, setSelectedPrintingId] = useState<string>('');

  useEffect(() => {
    hideGlobalCardHover();
    setImgFailed(false);
    setShowBackFace(false);
    setPrintingsData(null);
    setSelectedPrintingId('');

    if (!cardName) return;

    return () => {
      hideGlobalCardHover();
    };
  }, [cardName]);

  useEffect(() => {
    if (!cardName) return;

    let cancelled = false;
    setLoadingPrintings(true);

    fetch(`/api/cards/printings?name=${encodeURIComponent(cardName)}`)
      .then(async (res) => {
        if (res.ok) {
          const parsed = await safeParseApiJson<CardPrintingsResponse>(res);
          if (parsed && Array.isArray(parsed.printings)) {
            return parsed;
          }
        }
        return fetchCardPrintingsFromBrowserScryfall(cardName);
      })
      .catch(() => fetchCardPrintingsFromBrowserScryfall(cardName).catch(() => null))
      .then((data) => {
        if (cancelled || !data || !Array.isArray(data.printings)) return;
        setPrintingsData(data);
        if (data.printings.length > 0) {
          const matchingSet = meta?.setCode
            ? data.printings.find(
                (p) => p.setCode.toUpperCase() === meta.setCode?.toUpperCase()
              )
            : undefined;
          setSelectedPrintingId((matchingSet || data.printings[0]).scryfallId);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingPrintings(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cardName, meta?.setCode]);

  const activePrinting: CardPrinting | null = useMemo(() => {
    const list = printingsData?.printings;
    if (!Array.isArray(list) || list.length === 0) return null;
    return (
      list.find((p) => p.scryfallId === selectedPrintingId) ||
      list[0]
    );
  }, [printingsData, selectedPrintingId]);

  const cheapestPrinting: CardPrinting | null = useMemo(() => {
    const list = printingsData?.printings;
    if (!Array.isArray(list) || list.length <= 1) return null;
    let best: CardPrinting | null = null;
    let bestPrice = Infinity;
    for (const p of list) {
      const candidates = [p.prices.tcgplayerUsd, p.prices.cardKingdomUsd].filter(
        (v): v is number => v !== null && v > 0
      );
      if (candidates.length === 0) continue;
      const minVal = Math.min(...candidates);
      if (minVal < bestPrice) {
        bestPrice = minVal;
        best = p;
      }
    }
    return best;
  }, [printingsData]);

  if (!cardName) return null;

  const displayName = printingsData?.cardName || meta?.name || cardName;
  const displayTypeLine = printingsData?.typeLine || meta?.typeLine || '';
  const displayManaCost = printingsData?.manaCost ?? meta?.manaCost ?? '';
  const displayOracle = printingsData?.oracleText || meta?.oracleText || '';
  const displayCmc = printingsData?.cmc ?? meta?.cmc;

  const frontImage = activePrinting?.imageUri || meta?.imageUri || '';
  const backImage = activePrinting?.backImageUri || meta?.backImageUri;
  const activeImage = showBackFace && backImage ? backImage : frontImage;

  const scryfallUrl =
    activePrinting?.scryfallUri ||
    meta?.scryfallUri ||
    `https://scryfall.com/search?q=${encodeURIComponent(displayName)}`;

  const fallbackTcgUrl =
    activePrinting?.urls.tcgplayer ||
    meta?.tcgplayerUrl ||
    `https://www.tcgplayer.com/search/magic/product?q=${encodeURIComponent(displayName)}`;
  const fallbackCkUrl =
    activePrinting?.urls.cardKingdom ||
    meta?.cardKingdomUrl ||
    `https://www.cardkingdom.com/catalog/search?search=header&filter%5Bname%5D=${encodeURIComponent(displayName)}`;
  const fallbackEbayListings =
    activePrinting?.urls.ebayListings ||
    meta?.ebayUrl ||
    `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(`${displayName} mtg`)}&_sacat=183454&LH_BIN=1`;
  const fallbackEbaySold =
    activePrinting?.urls.ebaySold ||
    `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(`${displayName} mtg`)}&_sacat=183454&LH_Sold=1&LH_Complete=1`;
  const fallbackCardmarket =
    activePrinting?.urls.cardmarket ||
    meta?.cardmarketUrl ||
    `https://www.cardmarket.com/en/Magic/Products/Search?searchString=${encodeURIComponent(displayName)}`;
  const fallbackCardhoarder =
    activePrinting?.urls.cardhoarder ||
    meta?.cardhoarderUrl ||
    `https://www.cardhoarder.com/cards?data%5Bsearch%5D=${encodeURIComponent(displayName)}`;

  const tcgUsd = activePrinting ? activePrinting.prices.tcgplayerUsd : meta?.priceUsd ?? null;
  const tcgFoilUsd = activePrinting ? activePrinting.prices.tcgplayerFoilUsd : meta?.priceFoilUsd ?? null;
  const ckUsd = activePrinting ? activePrinting.prices.cardKingdomUsd : meta?.cardKingdomPriceUsd ?? null;
  const ckBuyUsd = activePrinting?.prices.cardKingdomBuyUsd ?? null;
  const ckQty = activePrinting?.prices.cardKingdomQty ?? null;
  const cmEur = activePrinting ? activePrinting.prices.cardmarketEur : meta?.priceEur ?? null;
  const tix = activePrinting ? activePrinting.prices.cardhoarderTix : meta?.priceTix ?? null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/55 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Card details for ${displayName}`}
    >
      <div
        className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-zinc-200 bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-zinc-100 pb-4">
          <div>
            <h3 className="font-display text-xl font-semibold text-zinc-900">{displayName}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              {displayTypeLine && <span>{displayTypeLine}</span>}
              {displayManaCost && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono text-zinc-700">{displayManaCost}</span>
                </>
              )}
              {activePrinting && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-medium text-zinc-700">
                    {activePrinting.setName} ({activePrinting.setCode} #{activePrinting.collectorNumber})
                  </span>
                </>
              )}
              {printingsData && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    {printingsData.totalPrintings} printing{printingsData.totalPrintings === 1 ? '' : 's'}
                  </span>
                </>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close card preview"
            className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-6 md:grid-cols-[260px_1fr]">
          {/* Left: High-Res Card Artwork + Flip Control */}
          <div className="flex flex-col items-center gap-3">
            {activeImage && !imgFailed ? (
              <div
                onMouseEnter={(e) =>
                  showGlobalCardHover({
                    name: displayName,
                    meta: {
                      ...(meta || {
                        name: displayName,
                        manaCost: displayManaCost,
                        cmc: displayCmc ?? 0,
                        typeLine: displayTypeLine,
                        oracleText: displayOracle,
                        colors: [],
                        colorIdentity: [],
                        producedMana: [],
                        isLand: /land/i.test(displayTypeLine),
                        isMdfcLand: false,
                        entersTappedLikely: false,
                        isRamp: false,
                        isDraw: false,
                        isRemoval: false,
                        isBoardWipe: false,
                        isProtection: false,
                        imageUri: activeImage,
                        priceUsd: null,
                        scryfallUri: scryfallUrl,
                        legalInFormat: true,
                        rarity: activePrinting?.rarity || 'common',
                      }),
                      imageUri: activeImage,
                      typeLine: displayTypeLine,
                      manaCost: displayManaCost,
                      oracleText: displayOracle,
                    },
                    rect: buildHoverRect(e.currentTarget),
                    statusTags: activePrinting?.setName ? [activePrinting.setName] : undefined,
                  })
                }
                onMouseLeave={hideGlobalCardHover}
                className="w-full max-w-[260px] cursor-zoom-in"
              >
                <img
                  src={activeImage}
                  alt={`${displayName}${activePrinting ? ` (${activePrinting.setName})` : ''}`}
                  decoding="async"
                  referrerPolicy="no-referrer"
                  onError={() => setImgFailed(true)}
                  className="w-full rounded-xl border border-zinc-200 object-cover transition-transform duration-150 hover:scale-[1.03]"
                />
              </div>
            ) : (
              <div className="flex aspect-[5/7] w-full max-w-[260px] flex-col items-center justify-center rounded-xl border border-zinc-200 bg-zinc-100 p-4 text-center">
                <p className="font-display text-base font-semibold text-zinc-800">{displayName}</p>
                {displayManaCost && (
                  <p className="mt-1 font-mono text-xs text-zinc-600">{displayManaCost}</p>
                )}
                <p className="mt-2 text-xs text-zinc-500">
                  {displayTypeLine || 'Magic: The Gathering Card'}
                </p>
              </div>
            )}

            {backImage && (
              <button
                type="button"
                onClick={() => {
                  setImgFailed(false);
                  setShowBackFace((v) => !v);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50 cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {showBackFace ? 'Show Front Face' : 'Flip Card'}
              </button>
            )}
          </div>

          {/* Right: Set Selector, Marketplace Prices, Oracle Text */}
          <div className="flex flex-col justify-between gap-5 min-w-0">
            {/* Set / Printing Picker across all sets */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label htmlFor="printing-select" className="text-xs font-semibold text-zinc-700">
                  Edition / Set Printing (All Sets)
                </label>
                {loadingPrintings && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Loading all sets & prices...
                  </span>
                )}
                {!loadingPrintings &&
                  cheapestPrinting &&
                  activePrinting &&
                  cheapestPrinting.scryfallId !== activePrinting.scryfallId && (
                    <button
                      type="button"
                      onClick={() => {
                        setImgFailed(false);
                        setShowBackFace(false);
                        setSelectedPrintingId(cheapestPrinting.scryfallId);
                      }}
                      className="text-xs font-medium text-sky-700 hover:text-sky-800 cursor-pointer"
                    >
                      Switch to cheapest ({cheapestPrinting.setCode} · $
                      {(
                        cheapestPrinting.prices.tcgplayerUsd ??
                        cheapestPrinting.prices.cardKingdomUsd ??
                        0
                      ).toFixed(2)}
                      )
                    </button>
                  )}
              </div>

              {Array.isArray(printingsData?.printings) && printingsData.printings.length > 0 && (
                <select
                  id="printing-select"
                  value={activePrinting?.scryfallId || ''}
                  onChange={(e) => {
                    setImgFailed(false);
                    setShowBackFace(false);
                    setSelectedPrintingId(e.target.value);
                  }}
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-600/20"
                >
                  {(printingsData.printings || []).map((p) => {
                    const priceParts: string[] = [];
                    if (p.prices.tcgplayerUsd !== null) {
                      priceParts.push(`TCG $${p.prices.tcgplayerUsd.toFixed(2)}`);
                    }
                    if (p.prices.cardKingdomUsd !== null) {
                      priceParts.push(`CK $${p.prices.cardKingdomUsd.toFixed(2)}`);
                    }
                    const priceSummary = priceParts.length > 0 ? ` — ${priceParts.join(' · ')}` : '';
                    return (
                      <option key={p.scryfallId} value={p.scryfallId}>
                        {p.setName} ({p.setCode} #{p.collectorNumber} · {p.releasedAt.slice(0, 4)}){priceSummary}
                      </option>
                    );
                  })}
                </select>
              )}
            </div>

            {/* Marketplace Prices Table */}
            <div>
              <div className="text-xs font-semibold text-zinc-700 mb-2">
                Marketplace Prices & Listings
              </div>
              <div className="overflow-x-auto rounded-lg border border-zinc-200">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 bg-zinc-50 text-xs font-medium text-zinc-500">
                      <th className="py-2 px-3">Source</th>
                      <th className="py-2 px-3">Price / Details</th>
                      <th className="py-2 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    <tr>
                      <td className="py-2.5 px-3 font-medium text-zinc-900">TCGplayer.com</td>
                      <td className="py-2.5 px-3 font-mono text-xs tabular-nums text-zinc-700">
                        {tcgUsd !== null ? `$${tcgUsd.toFixed(2)} USD` : 'No market price'}
                        {tcgFoilUsd !== null ? ` · Foil $${tcgFoilUsd.toFixed(2)}` : ''}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <a
                          href={fallbackTcgUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:text-sky-800 whitespace-nowrap"
                        >
                          Shop TCGplayer
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </td>
                    </tr>

                    <tr>
                      <td className="py-2.5 px-3 font-medium text-zinc-900">CardKingdom.com</td>
                      <td className="py-2.5 px-3 font-mono text-xs tabular-nums text-zinc-700">
                        {ckUsd !== null ? `$${ckUsd.toFixed(2)} USD` : 'Check site'}
                        {ckQty !== null ? ` · ${ckQty} in stock` : ''}
                        {ckBuyUsd !== null ? ` · Buylist $${ckBuyUsd.toFixed(2)}` : ''}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <a
                          href={fallbackCkUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:text-sky-800 whitespace-nowrap"
                        >
                          Shop Card Kingdom
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </td>
                    </tr>

                    <tr>
                      <td className="py-2.5 px-3 font-medium text-zinc-900">eBay.com</td>
                      <td className="py-2.5 px-3 text-xs text-zinc-600">
                        Active Buy-It-Now & recently sold listings
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="inline-flex items-center gap-3">
                          <a
                            href={fallbackEbayListings}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:text-sky-800 whitespace-nowrap"
                          >
                            Listings
                            <ExternalLink className="h-3 w-3" />
                          </a>
                          <a
                            href={fallbackEbaySold}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-medium text-zinc-600 hover:text-zinc-900 whitespace-nowrap"
                          >
                            Sold Comps
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      </td>
                    </tr>

                    <tr>
                      <td className="py-2.5 px-3 font-medium text-zinc-900">Cardmarket.com</td>
                      <td className="py-2.5 px-3 font-mono text-xs tabular-nums text-zinc-700">
                        {cmEur !== null ? `€${cmEur.toFixed(2)} EUR` : 'Check EU market'}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <a
                          href={fallbackCardmarket}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:text-sky-800 whitespace-nowrap"
                        >
                          View Cardmarket
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </td>
                    </tr>

                    <tr>
                      <td className="py-2.5 px-3 font-medium text-zinc-900">Cardhoarder (MTGO)</td>
                      <td className="py-2.5 px-3 font-mono text-xs tabular-nums text-zinc-700">
                        {tix !== null ? `${tix.toFixed(2)} TIX` : 'N/A'}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <a
                          href={fallbackCardhoarder}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:text-sky-800 whitespace-nowrap"
                        >
                          View MTGO
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Oracle Text & Legality */}
            <div className="space-y-3 border-t border-zinc-100 pt-3">
              <div>
                <div className="text-xs font-semibold text-zinc-500">Oracle Text</div>
                <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-zinc-700">
                  {displayOracle || 'No oracle text available. View on Scryfall for full rulings.'}
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs">
                <div className="flex flex-wrap items-center gap-4">
                  {displayCmc !== undefined && (
                    <div>
                      <span className="text-zinc-500">Mana Value:</span>{' '}
                      <span className="font-mono font-semibold tabular-nums text-zinc-900">
                        {displayCmc}
                      </span>
                    </div>
                  )}
                  {(activePrinting?.rarity || meta?.rarity) && (
                    <div>
                      <span className="text-zinc-500">Rarity:</span>{' '}
                      <span className="capitalize font-medium text-zinc-900">
                        {activePrinting?.rarity || meta?.rarity}
                      </span>
                    </div>
                  )}
                  {meta && (
                    <div>
                      <span className="text-zinc-500">Format Status:</span>{' '}
                      <span
                        className={
                          meta.legalInFormat
                            ? 'font-medium text-emerald-700'
                            : 'font-medium text-red-700'
                        }
                      >
                        {meta.legalInFormat ? 'Legal' : 'Not Legal'}
                      </span>
                    </div>
                  )}
                </div>

                <a
                  href={scryfallUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-700 hover:text-sky-800"
                >
                  Open on Scryfall
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
