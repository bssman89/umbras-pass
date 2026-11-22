import React from 'react';
import type { CardMetadata } from '../types/deck';
import {
  buildHoverRect,
  hideGlobalCardHover,
  showGlobalCardHover,
} from './CardHoverZoomOverlay';

interface CardLinkProps {
  name: string;
  meta?: CardMetadata | null;
  onInspect: (name: string, meta?: CardMetadata | null) => void;
  className?: string;
}

export const CardLink: React.FC<CardLinkProps> = ({
  name,
  meta,
  onInspect,
  className = '',
}) => {
  const safeName = typeof name === 'string' ? name : '';

  const handleMouseEnter = (e: React.MouseEvent<HTMLSpanElement>) => {
    if (!safeName.trim()) return;
    showGlobalCardHover({
      name: safeName,
      meta: meta ?? null,
      rect: buildHoverRect(e.currentTarget),
    });
  };

  const handleMouseLeave = () => {
    hideGlobalCardHover();
  };

  return (
    <span
      className="relative inline-block"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        type="button"
        onClick={() => {
          hideGlobalCardHover();
          onInspect(name, meta);
        }}
        className={`text-left font-medium text-zinc-900 hover:text-sky-700 underline decoration-zinc-300 underline-offset-2 hover:decoration-sky-600 transition-colors cursor-pointer ${className}`}
      >
        {name}
      </button>
    </span>
  );
};
