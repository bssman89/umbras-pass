import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2 } from 'lucide-react';
import type { CardMetadata } from '../types/deck';
import {
  fetchCardPrintingsFromBrowserScryfall,
  safeParseApiJson,
} from '../utils/clientFallbackAnalyzer';

export interface HoveredCardPreview {
  name: string;
  meta: CardMetadata | null;
  rect: {
    left: number;
    right: number;
    top: number;
    bottom: number;
    width: number;
    height: number;
  };
  ptLabel?: string | null;
  statusTags?: string[];
}

interface CachedCardPreviewDetails {
  imageUri: string | null;
  typeLine: string;
  manaCost: string;
  oracleText: string;
}

const previewDetailsCache = new Map<string, CachedCardPreviewDetails>();
const STORAGE_KEY = 'umbras_tabletop_hover_zoom';

export function loadHoverZoomPreference(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === '0' || raw === 'false') return false;
    return true;
  } catch {
    return true;
  }
}

export function saveHoverZoomPreference(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // Ignore storage quota / privacy mode errors
  }
}

export function buildHoverRect(el: HTMLElement): HoveredCardPreview['rect'] {
  const r = el.getBoundingClientRect();
  return {
    left: r.left,
    right: r.right,
    top: r.top,
    bottom: r.bottom,
    width: r.width,
    height: r.height,
  };
}

interface CardHoverZoomOverlayProps {
  preview: HoveredCardPreview | null;
  enabled: boolean;
  onDismiss: () => void;
}

export const CardHoverZoomOverlay: React.FC<CardHoverZoomOverlayProps> = ({
  preview,
  enabled,
  onDismiss,
}) => {
  const [fetchedDetails, setFetchedDetails] = useState<CachedCardPreviewDetails | null>(null);
  const [loadingImage, setLoadingImage] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);

  const cardName = preview?.name?.trim() || '';
  const metaImageUri = preview?.meta?.imageUri || null;
  const metaOracle = preview?.meta?.oracleText || '';
  const metaTypeLine = preview?.meta?.typeLine || '';
  const metaManaCost = preview?.meta?.manaCost || '';

  // Dismiss cleanly on scroll, Escape, or window blur so preview never lingers
  useEffect(() => {
    if (!preview || !enabled) return;
    const handleClear = () => onDismiss();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    window.addEventListener('scroll', handleClear, { passive: true, capture: true });
    window.addEventListener('blur', handleClear);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('scroll', handleClear, { capture: true });
      window.removeEventListener('blur', handleClear);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [preview, enabled, onDismiss]);

  // Lazily fetch high-res card artwork & oracle text when metadata is incomplete (e.g. bot creatures)
  useEffect(() => {
    setImgFailed(false);
    if (!preview || !enabled || !cardName) {
      setFetchedDetails(null);
      setLoadingImage(false);
      return;
    }

    const key = cardName.toLowerCase();
    if (metaImageUri && metaOracle) {
      previewDetailsCache.set(key, {
        imageUri: metaImageUri,
        typeLine: metaTypeLine,
        manaCost: metaManaCost,
        oracleText: metaOracle,
      });
      setFetchedDetails(null);
      setLoadingImage(false);
      return;
    }

    const cached = previewDetailsCache.get(key);
    if (cached) {
      setFetchedDetails(cached);
      setLoadingImage(false);
      return;
    }

    let cancelled = false;
    setFetchedDetails(null);
    setLoadingImage(true);

    fetch(`/api/cards/printings?name=${encodeURIComponent(cardName)}`)
      .then(async (res) => {
        if (res.ok) {
          const parsed = await safeParseApiJson<{
            typeLine?: string;
            manaCost?: string;
            oracleText?: string;
            printings?: Array<{ imageUri?: string }>;
          }>(res);
          if (parsed && Array.isArray(parsed.printings)) {
            return parsed;
          }
        }
        return fetchCardPrintingsFromBrowserScryfall(cardName);
      })
      .catch(() => fetchCardPrintingsFromBrowserScryfall(cardName).catch(() => null))
      .then((data) => {
        if (cancelled || !data) return;
        const resolved: CachedCardPreviewDetails = {
          imageUri: data.printings?.[0]?.imageUri || metaImageUri || null,
          typeLine: data.typeLine || metaTypeLine || '',
          manaCost: data.manaCost ?? metaManaCost ?? '',
          oracleText: data.oracleText || metaOracle || '',
        };
        previewDetailsCache.set(key, resolved);
        setFetchedDetails(resolved);
      })
      .finally(() => {
        if (!cancelled) setLoadingImage(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cardName, enabled, metaImageUri, metaManaCost, metaOracle, metaTypeLine, preview]);

  if (!enabled || !preview || !cardName || typeof document === 'undefined') {
    return null;
  }

  const activeImage = metaImageUri || fetchedDetails?.imageUri || null;
  const activeTypeLine = metaTypeLine || fetchedDetails?.typeLine || '';
  const activeManaCost = metaManaCost || fetchedDetails?.manaCost || '';
  const activeOracle = metaOracle || fetchedDetails?.oracleText || '';
  const activePt =
    preview.ptLabel ??
    (preview.meta?.power && preview.meta?.toughness
      ? `${preview.meta.power}/${preview.meta.toughness}`
      : null);
  const statusTags = (preview.statusTags || []).filter(Boolean);

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const showSidecar = vw >= 920 && Boolean(activeOracle || activeTypeLine || statusTags.length > 0);
  const artWidth = vw >= 640 ? 276 : 228;
  const artHeight = Math.round(artWidth * (680 / 488));
  const panelWidth = showSidecar ? artWidth + 244 + 20 : artWidth + 16;
  const estimatedHeight = artHeight + 34;

  const margin = 12;
  const gap = 16;

  // Prefer right of card; flip left if not enough space; fallback to clamped horizontal center
  let left = preview.rect.right + gap;
  if (left + panelWidth > vw - margin) {
    const leftCandidate = preview.rect.left - gap - panelWidth;
    if (leftCandidate >= margin) {
      left = leftCandidate;
    } else {
      left = Math.max(margin, Math.min(vw - panelWidth - margin, (vw - panelWidth) / 2));
    }
  }

  // Vertically center against hovered card, clamped cleanly inside viewport
  const idealTop = preview.rect.top + preview.rect.height / 2 - estimatedHeight / 2;
  const top = Math.max(margin, Math.min(vh - estimatedHeight - margin, idealTop));

  return createPortal(
    <div
      role="tooltip"
      aria-hidden="true"
      style={{
        left: `${Math.round(left)}px`,
        top: `${Math.round(top)}px`,
        width: `${panelWidth}px`,
      }}
      className="fixed z-[75] pointer-events-none rounded-xl border border-zinc-700/90 bg-zinc-950/95 p-2 shadow-2xl backdrop-blur-md transition-[opacity,transform] duration-100"
    >
      <div className="flex items-stretch gap-3">
        {/* Large High-Res Card Artwork */}
        <div style={{ width: `${artWidth}px` }} className="shrink-0">
          <div className="aspect-[488/680] w-full overflow-hidden rounded-lg bg-zinc-900 shadow-inner ring-1 ring-white/10">
            {activeImage && !imgFailed ? (
              <img
                src={activeImage}
                alt={cardName}
                referrerPolicy="no-referrer"
                onError={() => setImgFailed(true)}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center p-5 text-center">
                <p className="font-display text-base font-bold text-white">{cardName}</p>
                {activeManaCost && (
                  <p className="mt-1 font-mono text-xs text-sky-300">{activeManaCost}</p>
                )}
                {activeTypeLine && (
                  <p className="mt-2 text-xs text-zinc-400">{activeTypeLine}</p>
                )}
                {loadingImage && (
                  <div className="mt-3 inline-flex items-center gap-1.5 text-xs text-sky-400">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Loading card art...
                  </div>
                )}
              </div>
            )}
          </div>
          {!showSidecar && (
            <div className="mt-1.5 flex items-center justify-between gap-2 px-1 text-xs">
              <span className="truncate font-display font-semibold text-zinc-100">
                {cardName}
              </span>
              {activePt && (
                <span className="font-mono font-bold tabular-nums text-sky-300 shrink-0">
                  {activePt}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Readable High-Contrast Oracle Text & Tabletop State Sidecar */}
        {showSidecar && (
          <div className="flex w-[236px] shrink-0 flex-col justify-between py-1 pr-1 text-left text-zinc-100">
            <div className="space-y-2.5">
              <div className="border-b border-zinc-800 pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-display text-sm font-bold leading-snug text-white">
                    {cardName}
                  </div>
                  {activeManaCost && (
                    <span className="font-mono text-xs font-semibold text-sky-300 shrink-0">
                      {activeManaCost}
                    </span>
                  )}
                </div>
                {activeTypeLine && (
                  <div className="mt-0.5 text-[11px] font-medium text-zinc-400">
                    {activeTypeLine}
                  </div>
                )}
              </div>

              {(statusTags.length > 0 || activePt) && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px]">
                  {activePt && (
                    <span className="font-bold tabular-nums text-amber-300">
                      P/T {activePt}
                    </span>
                  )}
                  {statusTags.map((tag, idx) => (
                    <React.Fragment key={`${tag}-${idx}`}>
                      {(idx > 0 || activePt) && (
                        <span className="text-zinc-600" aria-hidden="true">·</span>
                      )}
                      <span className="text-sky-300 font-semibold">{tag}</span>
                    </React.Fragment>
                  ))}
                </div>
              )}

              <div className="max-h-[255px] overflow-hidden whitespace-pre-line text-xs leading-relaxed text-zinc-200">
                {activeOracle ||
                  (loadingImage
                    ? 'Loading oracle text...'
                    : 'Click card for full Scryfall printings & rulings.')}
              </div>
            </div>

            <div className="border-t border-zinc-800 pt-2 text-[10px] text-zinc-400">
              Click card to inspect printings &amp; prices
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};
