import React from 'react';

export interface DeckShuffleAnimationProps {
  size?: 'sm' | 'md' | 'lg';
  theme?: 'light' | 'felt';
  label?: string;
  sublabel?: string;
  active?: boolean;
  className?: string;
}

const CARD_SIZE_CLASSES: Record<'sm' | 'md' | 'lg', { box: string; card: string; crest: string }> = {
  sm: {
    box: 'h-11 w-14',
    card: 'h-10 w-7 rounded-[4px]',
    crest: 'h-4 w-2.5 rounded-[2px]',
  },
  md: {
    box: 'h-14 w-20',
    card: 'h-12 w-9 rounded-[5px]',
    crest: 'h-5 w-3.5 rounded-[2px]',
  },
  lg: {
    box: 'h-20 w-28',
    card: 'h-[72px] w-[52px] rounded-md',
    crest: 'h-8 w-5 rounded-[3px]',
  },
};

export const DeckShuffleAnimation: React.FC<DeckShuffleAnimationProps> = ({
  size = 'md',
  theme = 'light',
  label,
  sublabel,
  active = true,
  className = '',
}) => {
  const dims = CARD_SIZE_CLASSES[size];
  const labelTextClass = theme === 'felt' ? 'text-amber-200' : 'text-zinc-900';
  const sublabelTextClass = theme === 'felt' ? 'text-emerald-200/80' : 'text-zinc-500';

  return (
    <div
      role="status"
      aria-live="polite"
      className={`inline-flex items-center gap-3 select-none ${className}`}
    >
      <div
        aria-hidden="true"
        className={`relative flex items-center justify-center shrink-0 ${dims.box}`}
      >
        {/* Base deck stack shadow card */}
        <div
          className={`absolute ${dims.card} border border-amber-400/35 bg-zinc-900/90 shadow-sm translate-y-0.5`}
        />

        {/* Left riffle packet */}
        <div
          className={`absolute ${dims.card} border border-amber-300/70 bg-gradient-to-br from-sky-950 via-zinc-900 to-amber-950 shadow-md flex items-center justify-center ${
            active ? 'animate-deck-shuffle-left' : '-translate-x-2 -rotate-6'
          }`}
        >
          <div className={`${dims.crest} border border-amber-400/50 bg-amber-500/15`} />
        </div>

        {/* Right riffle packet */}
        <div
          className={`absolute ${dims.card} border border-sky-300/70 bg-gradient-to-bl from-sky-950 via-zinc-900 to-indigo-950 shadow-md flex items-center justify-center ${
            active ? 'animate-deck-shuffle-right' : 'translate-x-2 rotate-6'
          }`}
        >
          <div className={`${dims.crest} border border-sky-400/50 bg-sky-400/15`} />
        </div>

        {/* Center top card sleeve */}
        <div
          className={`relative ${dims.card} border border-amber-300/85 bg-gradient-to-br from-sky-950 via-zinc-900 to-amber-950 shadow-lg flex items-center justify-center ${
            active ? 'animate-deck-shuffle-center' : ''
          }`}
        >
          <div
            className={`${dims.crest} border border-amber-300/60 bg-gradient-to-b from-amber-400/20 to-sky-400/15`}
          />
        </div>
      </div>

      {(label || sublabel) && (
        <div className="min-w-0">
          {label && (
            <div className={`text-xs font-semibold leading-tight ${labelTextClass}`}>
              {label}
            </div>
          )}
          {sublabel && (
            <div className={`mt-0.5 text-[11px] leading-tight ${sublabelTextClass}`}>
              {sublabel}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
