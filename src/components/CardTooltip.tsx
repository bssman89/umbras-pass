import React, { useEffect, useState } from 'react';
import type { CardMetadata } from '../types/deck';
import {
  fetchCardPrintingsFromBrowserScryfall,
  safeParseApiJson,
} from '../utils/clientFallbackAnalyzer';

interface CardLinkProps {
  name: string;
  meta?: CardMetadata | null;
  onInspect: (name: string, meta?: CardMetadata | null) => void;
  className?: string;
}

// In-memory cache for fetched card image URIs
const cardImageCache = new Map<string, string>();

export const CardLink: React.FC<CardLinkProps> = ({
  name,
  meta,
  onInspect,
  className = '',
}) => {
  const safeName = typeof name === 'string' ? name : '';
  const [isHovered, setIsHovered] = useState(false);
  const [imageUri, setImageUri] = useState<string | null>(
    meta?.imageUri || cardImageCache.get(safeName.trim().toLowerCase()) || null
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (meta?.imageUri && safeName) {
      setImageUri(meta.imageUri);
      cardImageCache.set(safeName.trim().toLowerCase(), meta.imageUri);
    }
  }, [meta?.imageUri, safeName]);

  const handleMouseEnter = () => {
    setIsHovered(true);
    const key = safeName.trim().toLowerCase();
    if (imageUri || cardImageCache.has(key)) {
      if (!imageUri && cardImageCache.has(key)) {
        setImageUri(cardImageCache.get(key)!);
      }
      return;
    }

    let cancelled = false;
    setLoading(true);

    fetch(`/api/cards/printings?name=${encodeURIComponent(name)}`)
      .then(async (res) => {
        if (res.ok) {
          const parsed = await safeParseApiJson<{ printings?: Array<{ imageUri: string }> }>(res);
          if (parsed && Array.isArray(parsed.printings)) {
            return parsed;
          }
        }
        return fetchCardPrintingsFromBrowserScryfall(name);
      })
      .catch(() => fetchCardPrintingsFromBrowserScryfall(name).catch(() => null))
      .then((data) => {
        if (cancelled) return;
        const uri = data?.printings?.[0]?.imageUri;
        if (uri) {
          cardImageCache.set(key, uri);
          setImageUri(uri);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
  };

  const activeImage = imageUri || meta?.imageUri || null;

  return (
    <span
      className="relative inline-block"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        type="button"
        onClick={() => onInspect(name, meta)}
        className={`text-left font-medium text-zinc-900 hover:text-sky-700 underline decoration-zinc-300 underline-offset-2 hover:decoration-sky-600 transition-colors cursor-pointer ${className}`}
      >
        {name}
      </button>

      {isHovered && (
        <div
          role="tooltip"
          aria-hidden="true"
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 pointer-events-none w-52 sm:w-60 rounded-xl border border-zinc-700/80 bg-zinc-950/95 p-2 shadow-2xl backdrop-blur-md transition-all animate-in fade-in zoom-in-95"
        >
          {activeImage ? (
            <div className="aspect-[488/680] w-full overflow-hidden rounded-lg bg-zinc-900 shadow-inner">
              <img
                src={activeImage}
                alt={name}
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover"
              />
            </div>
          ) : (
            <div className="flex aspect-[488/680] w-full flex-col items-center justify-center rounded-lg bg-zinc-900 p-4 text-center">
              <p className="font-display text-sm font-bold text-white">{name}</p>
              {meta?.manaCost && (
                <p className="mt-1 font-mono text-xs text-zinc-400">{meta.manaCost}</p>
              )}
              {loading && (
                <p className="mt-2 text-[11px] text-sky-400">Loading Scryfall preview...</p>
              )}
            </div>
          )}
          <div className="mt-1.5 text-center font-display text-[11px] font-semibold text-zinc-200 truncate px-1">
            {name}
          </div>
        </div>
      )}
    </span>
  );
};
