import React, { createContext, useCallback, useContext, useState } from 'react';
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Coins,
  Crown,
  Droplets,
  Flame,
  Loader2,
  Minus,
  Mountain,
  Plus,
  RotateCcw,
  Shield,
  Shuffle,
  Skull,
  Sparkles,
  Swords,
  Volume2,
  VolumeX,
  ZoomIn,
} from 'lucide-react';
import type {
  CardMetadata,
  ManaColor,
  PlaytestMode,
} from '../types/deck';
import type {
  LiveBotCreature,
  LiveBotState,
  PendingBotAttack,
} from '../utils/liveBotEngine';
import {
  buildHoverRect,
  CardHoverZoomOverlay,
  loadHoverZoomPreference,
  saveHoverZoomPreference,
  type HoveredCardPreview,
} from './CardHoverZoomOverlay';
import { DeckShuffleAnimation } from './DeckShuffleAnimation';

export type TabletopPhase = 'Untap' | 'Upkeep' | 'Draw' | 'Main' | 'Combat' | 'End';

export interface TabletopSimCard {
  uid: string;
  name: string;
  cmc: number;
  typeLine: string;
  isLand: boolean;
  isCreature: boolean;
  isCommander: boolean;
  isArtifactOrRock: boolean;
  producedMana: ManaColor[];
  power: number;
  toxicValue: number;
  hasInfect: boolean;
  extraDrawCount: number;
  lifegainAmount: number;
  meta: CardMetadata | null;
}

export interface TabletopPermanent extends TabletopSimCard {
  tapped: boolean;
  attacking: boolean;
  summoningSick: boolean;
}

export interface TabletopSoloOpponent {
  id: string;
  name: string;
  archetype: string;
  commanderName: string;
  life: number;
  poison: number;
  commanderDamageTakenFromYou: number;
  commanderDamageDealtToYou: number;
}

export type TabletopManaPool = Record<ManaColor, number>;

export type TabletopSoundKind = 'draw' | 'land' | 'cast' | 'tap' | 'combat' | 'turn' | 'shuffle';

let sharedAudioCtx: AudioContext | null = null;

export function playTabletopSound(enabled: boolean, kind: TabletopSoundKind): void {
  if (!enabled || typeof window === 'undefined') return;
  try {
    const AudioCtor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    if (!sharedAudioCtx) {
      sharedAudioCtx = new AudioCtor();
    }
    if (sharedAudioCtx.state === 'suspended') {
      void sharedAudioCtx.resume();
    }

    const now = sharedAudioCtx.currentTime;

    if (kind === 'shuffle') {
      const bursts = [0, 0.06, 0.12, 0.18];
      bursts.forEach((offset, idx) => {
        if (!sharedAudioCtx) return;
        const osc = sharedAudioCtx.createOscillator();
        const gain = sharedAudioCtx.createGain();
        osc.connect(gain);
        gain.connect(sharedAudioCtx.destination);
        osc.type = 'triangle';
        const base = 240 + idx * 35;
        osc.frequency.setValueAtTime(base, now + offset);
        osc.frequency.exponentialRampToValueAtTime(140, now + offset + 0.045);
        gain.gain.setValueAtTime(0.032, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.045);
        osc.start(now + offset);
        osc.stop(now + offset + 0.055);
      });
      return;
    }

    const osc = sharedAudioCtx.createOscillator();
    const gain = sharedAudioCtx.createGain();
    osc.connect(gain);
    gain.connect(sharedAudioCtx.destination);

    const freqMap: Record<Exclude<TabletopSoundKind, 'shuffle'>, [number, number, number]> = {
      draw: [420, 560, 0.08],
      land: [260, 310, 0.09],
      cast: [392, 587, 0.14],
      tap: [300, 240, 0.05],
      combat: [180, 120, 0.16],
      turn: [330, 440, 0.12],
    };
    const [startFreq, endFreq, dur] = freqMap[kind];
    osc.type = kind === 'combat' ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(80, endFreq), now + dur);

    gain.gain.setValueAtTime(0.04, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    osc.start(now);
    osc.stop(now + dur + 0.01);
  } catch {
    // Non-fatal if browser blocks Web Audio API
  }
}

interface TableCardTileProps {
  name: string;
  meta: CardMetadata | null;
  onInspect: (name: string, meta?: CardMetadata | null) => void;
  size?: 'sm' | 'md';
  tapped?: boolean;
  attacking?: boolean;
  summoningSick?: boolean;
  playable?: 'land' | 'spell' | 'commander' | 'none';
  newlyDrawn?: boolean;
  cornerTag?: string;
  cornerTone?: 'amber' | 'sky' | 'emerald' | 'red' | 'zinc';
  ptLabel?: string | null;
  subLabel?: string;
  primaryAction?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    tone?: 'emerald' | 'sky' | 'red' | 'zinc' | 'amber';
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
    tone?: 'red' | 'zinc' | 'sky';
  };
  onTileClick?: () => void;
}

interface TabletopHoverContextValue {
  enabled: boolean;
  showPreview: (preview: HoveredCardPreview) => void;
  hidePreview: () => void;
}

const TabletopHoverContext = createContext<TabletopHoverContextValue>({
  enabled: true,
  showPreview: () => {},
  hidePreview: () => {},
});

const TableCardTile: React.FC<TableCardTileProps> = ({
  name,
  meta,
  onInspect,
  size = 'md',
  tapped = false,
  attacking = false,
  summoningSick = false,
  playable = 'none',
  newlyDrawn = false,
  cornerTag,
  cornerTone = 'zinc',
  ptLabel,
  subLabel,
  primaryAction,
  secondaryAction,
  onTileClick,
}) => {
  const [imgFailed, setImgFailed] = useState(false);
  const { enabled: hoverZoomEnabled, showPreview, hidePreview } = useContext(TabletopHoverContext);

  const widthClass = size === 'sm' ? 'w-[84px]' : 'w-[104px]';
  const artHeightClass = size === 'sm' ? 'h-[60px]' : 'h-[78px]';

  const frameRingClass = attacking
    ? 'border-red-500 ring-2 ring-red-500/80 -translate-y-1.5 shadow-md'
    : newlyDrawn
    ? 'border-amber-400 ring-2 ring-amber-400/75 animate-card-draw-slide shadow-sm'
    : playable === 'land'
    ? 'border-emerald-500 ring-2 ring-emerald-400/75 shadow-sm'
    : playable === 'spell' || playable === 'commander'
    ? 'border-sky-500 ring-2 ring-sky-400/75 shadow-sm'
    : 'border-zinc-300 hover:border-sky-400';

  const cornerClass =
    cornerTone === 'red'
      ? 'bg-red-600 text-white'
      : cornerTone === 'amber'
      ? 'bg-amber-400 text-zinc-950'
      : cornerTone === 'emerald'
      ? 'bg-emerald-600 text-white'
      : cornerTone === 'sky'
      ? 'bg-sky-700 text-white'
      : 'bg-zinc-900/90 text-white';

  const resolvedPt =
    ptLabel !== undefined
      ? ptLabel
      : meta?.power && meta?.toughness
      ? `${meta.power}/${meta.toughness}`
      : null;

  const btnToneClass = (tone?: 'emerald' | 'sky' | 'red' | 'zinc' | 'amber') => {
    if (tone === 'emerald') return 'bg-emerald-700 text-white hover:bg-emerald-800 border-emerald-800';
    if (tone === 'sky') return 'bg-sky-700 text-white hover:bg-sky-800 border-sky-800';
    if (tone === 'red') return 'bg-red-600 text-white hover:bg-red-700 border-red-700';
    if (tone === 'amber') return 'bg-amber-500 text-zinc-950 hover:bg-amber-400 border-amber-600';
    return 'bg-zinc-100 text-zinc-800 hover:bg-zinc-200 border-zinc-300';
  };

  const handleMouseEnter = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!hoverZoomEnabled) return;
    const tags: string[] = [];
    if (cornerTag) tags.push(cornerTag);
    if (attacking && cornerTag !== 'ATK') tags.push('Attacking');
    if (tapped) tags.push('Tapped');
    if (summoningSick && !tapped) tags.push('Summoning Sick');
    showPreview({
      name,
      meta,
      rect: buildHoverRect(e.currentTarget),
      ptLabel: resolvedPt,
      statusTags: tags,
    });
  };

  return (
    <div
      onMouseEnter={handleMouseEnter}
      onMouseLeave={hidePreview}
      className={`${widthClass} relative shrink-0 rounded-lg border bg-white p-1.5 flex flex-col justify-between transition-all duration-150 select-none ${frameRingClass} ${
        tapped ? 'rotate-3 opacity-75' : ''
      } ${hoverZoomEnabled ? 'hover:z-20 hover:scale-[1.06] hover:shadow-lg' : ''}`}
    >
      <button
        type="button"
        onClick={() => {
          hidePreview();
          if (onTileClick) onTileClick();
          else onInspect(name, meta);
        }}
        title={`${name}${meta?.manaCost ? ` (${meta.manaCost})` : ''} — click to ${
          onTileClick ? 'select' : 'inspect'
        }`}
        className="w-full text-left cursor-pointer group focus:outline-none"
      >
        <div
          className={`relative ${artHeightClass} w-full overflow-hidden rounded border border-zinc-200 bg-zinc-100`}
        >
          {meta?.imageUri && !imgFailed ? (
            <img
              src={meta.imageUri}
              alt={name}
              referrerPolicy="no-referrer"
              onError={() => setImgFailed(true)}
              className="h-full w-full object-cover object-top"
            />
          ) : (
            <div className="h-full w-full flex flex-col items-center justify-center px-1 text-center bg-zinc-100">
              {cornerTag === 'Cmdr' ? (
                <Crown className="h-3.5 w-3.5 text-amber-700 mb-0.5" />
              ) : meta?.isLand || subLabel === 'Land' ? (
                <Mountain className="h-3.5 w-3.5 text-emerald-700 mb-0.5" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 text-sky-700 mb-0.5" />
              )}
              <span className="line-clamp-2 text-[9px] font-semibold leading-tight text-zinc-700">
                {meta?.typeLine ? meta.typeLine.split('—')[0].trim() : subLabel || 'Card'}
              </span>
            </div>
          )}

          {cornerTag && (
            <span
              className={`absolute top-0.5 left-0.5 rounded px-1 py-0.5 font-mono text-[8px] font-bold uppercase leading-none ${cornerClass}`}
            >
              {cornerTag}
            </span>
          )}

          {tapped && (
            <span className="absolute top-0.5 right-0.5 rounded bg-zinc-900/90 px-1 py-0.5 font-mono text-[8px] font-bold uppercase leading-none text-amber-300">
              TAP
            </span>
          )}

          {summoningSick && !tapped && (
            <span className="absolute bottom-0.5 left-0.5 rounded bg-zinc-900/85 px-1 py-0.5 font-mono text-[8px] font-semibold leading-none text-zinc-200">
              SICK
            </span>
          )}

          {resolvedPt && (
            <span className="absolute bottom-0.5 right-0.5 rounded bg-zinc-900/90 px-1 py-0.5 font-mono text-[9px] font-bold leading-none text-white tabular-nums">
              {resolvedPt}
            </span>
          )}
        </div>

        <div className="mt-1 space-y-0.5">
          <div className="truncate text-[10px] font-bold text-zinc-900 group-hover:text-sky-700">
            {name}
          </div>
          <div className="flex items-center justify-between gap-1 font-mono text-[9px] text-zinc-500">
            <span className="truncate">
              {meta?.manaCost || subLabel || (meta?.isLand ? 'Land' : '—')}
            </span>
            {typeof meta?.cmc === 'number' && !meta.isLand && (
              <span className="shrink-0 tabular-nums">{meta.cmc}</span>
            )}
          </div>
        </div>
      </button>

      {(primaryAction || secondaryAction || onTileClick) && (
        <div className="mt-1.5 flex items-center gap-1 border-t border-zinc-100 pt-1">
          {primaryAction && (
            <button
              type="button"
              disabled={primaryAction.disabled}
              onClick={() => {
                hidePreview();
                primaryAction.onClick();
              }}
              className={`flex-1 rounded border px-1 py-0.5 text-[9px] font-bold leading-tight truncate disabled:opacity-40 cursor-pointer whitespace-nowrap ${btnToneClass(
                primaryAction.tone
              )}`}
            >
              {primaryAction.label}
            </button>
          )}
          {secondaryAction && (
            <button
              type="button"
              onClick={() => {
                hidePreview();
                secondaryAction.onClick();
              }}
              title={secondaryAction.label}
              className={`rounded border px-1 py-0.5 text-[9px] font-semibold leading-tight cursor-pointer whitespace-nowrap shrink-0 ${btnToneClass(
                secondaryAction.tone
              )}`}
            >
              {secondaryAction.label}
            </button>
          )}
          {onTileClick && (
            <button
              type="button"
              onClick={() => {
                hidePreview();
                onInspect(name, meta);
              }}
              title={`Inspect ${name}`}
              className="rounded border border-zinc-200 bg-zinc-50 px-1 py-0.5 text-[9px] font-semibold text-zinc-600 hover:text-sky-700 cursor-pointer shrink-0"
            >
              ?
            </button>
          )}
        </div>
      )}
    </div>
  );
};

const CardBackFan: React.FC<{ count: number; shuffling?: boolean }> = ({
  count,
  shuffling = false,
}) => {
  const visible = Math.max(0, Math.min(7, count));
  const extra = Math.max(0, count - visible);
  if (count <= 0) {
    return (
      <span className="font-mono text-[10px] text-emerald-200/70">0 Hand</span>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <div className={`flex items-center -space-x-2 ${shuffling ? 'animate-deck-shuffle-bot' : ''}`}>
        {Array.from({ length: visible }).map((_, i) => (
          <div
            key={i}
            style={{ transform: `rotate(${(i - (visible - 1) / 2) * 3}deg)` }}
            className="h-7 w-5 rounded-[3px] border border-amber-300/60 bg-gradient-to-br from-sky-950 via-zinc-900 to-amber-950 shadow-sm flex items-center justify-center"
          >
            <div className="h-3.5 w-2 rounded-[1px] border border-amber-400/40 bg-amber-500/10" />
          </div>
        ))}
      </div>
      <span className="font-mono text-[10px] font-semibold tabular-nums text-emerald-100">
        {extra > 0 ? `+${extra} (${count})` : `${count}H`}
      </span>
    </div>
  );
};

interface LiveTabletopArenaProps {
  mode: PlaytestMode;
  turn: number;
  phaseIdx: number;
  phases: TabletopPhase[];
  activePhase: TabletopPhase;
  botsAreActing: boolean;
  activeBotIdx: number | null;
  liveBotMode: boolean;
  isSimulationFinished: boolean;
  allowsCommandZone: boolean;
  usesCommanderDamage21: boolean;
  deckName: string;
  startingLife: number;
  yourLife: number;
  yourPoison: number;
  maxCmdrFromBots: number;
  manaPool: TabletopManaPool;
  totalManaPool: number;
  untappedLandsCount: number;
  totalLandsInPlay: number;
  landsPlayedThisTurn: number;
  library: TabletopSimCard[];
  hand: TabletopSimCard[];
  lastDrawnUids: string[];
  commandZone: TabletopSimCard[];
  commanderTaxByUid: Record<string, number>;
  battlefield: TabletopPermanent[];
  graveyard: TabletopSimCard[];
  liveBots: LiveBotState[];
  opponentTrackers: TabletopSoloOpponent[];
  selectedCombatTargetId: string;
  pendingIncomingAttack: PendingBotAttack | null;
  blockerAssignments: Record<string, string>;
  soundEnabled: boolean;
  isShufflingDeck?: boolean;
  onToggleSound: () => void;
  onShuffleLibrary?: () => void;
  onSelectCombatTarget: (id: string) => void;
  onAdjustYourLife: (delta: number) => void;
  onAdjustYourPoison: (delta: number) => void;
  onAdjustOpponentStat: (
    oppId: string,
    field: 'life' | 'poison' | 'commanderDamageTakenFromYou' | 'commanderDamageDealtToYou',
    delta: number
  ) => void;
  onDrawCard: (count?: number, incrementTurnOnDraw?: boolean) => void;
  onPlayLand: (card: TabletopSimCard) => void;
  onCastFromHand: (card: TabletopSimCard) => void;
  onCastCommander: (cmd: TabletopSimCard) => void;
  onTogglePermanentTap: (perm: TabletopPermanent) => void;
  onTapAllUntappedLands: () => void;
  onUntapAll: () => void;
  onEmptyManaPool: () => void;
  onAdjustManaPool: (color: ManaColor, delta: number) => void;
  onToggleAttacker: (uid: string) => void;
  onReturnCommanderToZone: (perm: TabletopPermanent) => void;
  onMovePermanentToGy: (perm: TabletopPermanent) => void;
  onResolveCombat: () => void;
  onToggleBlocker: (blockerUid: string, attackerUid: string) => void;
  onResolveIncomingAttack: (ignoreBlockers: boolean) => void;
  onPrevPhase: () => void;
  onNextPhase: () => void;
  onPassTurn: () => void;
  onInspectCard: (name: string, meta?: CardMetadata | null) => void;
}

const MANA_BUTTONS: Array<{ color: ManaColor; chipClass: string }> = [
  { color: 'W', chipClass: 'text-amber-200 border-amber-300/40 bg-amber-950/50' },
  { color: 'U', chipClass: 'text-sky-200 border-sky-300/40 bg-sky-950/50' },
  { color: 'B', chipClass: 'text-zinc-200 border-zinc-400/40 bg-zinc-900/70' },
  { color: 'R', chipClass: 'text-red-200 border-red-300/40 bg-red-950/50' },
  { color: 'G', chipClass: 'text-emerald-200 border-emerald-300/40 bg-emerald-950/50' },
  { color: 'C', chipClass: 'text-zinc-300 border-zinc-400/35 bg-zinc-900/50' },
];

export const LiveTabletopArena: React.FC<LiveTabletopArenaProps> = ({
  mode,
  turn,
  phaseIdx,
  phases,
  activePhase,
  botsAreActing,
  activeBotIdx,
  liveBotMode,
  isSimulationFinished,
  allowsCommandZone,
  usesCommanderDamage21,
  deckName,
  startingLife,
  yourLife,
  yourPoison,
  maxCmdrFromBots,
  manaPool,
  totalManaPool,
  untappedLandsCount,
  totalLandsInPlay,
  landsPlayedThisTurn,
  library,
  hand,
  lastDrawnUids,
  commandZone,
  commanderTaxByUid,
  battlefield,
  graveyard,
  liveBots,
  opponentTrackers,
  selectedCombatTargetId,
  pendingIncomingAttack,
  blockerAssignments,
  soundEnabled,
  isShufflingDeck = false,
  onToggleSound,
  onShuffleLibrary,
  onSelectCombatTarget,
  onAdjustYourLife,
  onAdjustYourPoison,
  onAdjustOpponentStat,
  onDrawCard,
  onPlayLand,
  onCastFromHand,
  onCastCommander,
  onTogglePermanentTap,
  onTapAllUntappedLands,
  onUntapAll,
  onEmptyManaPool,
  onAdjustManaPool,
  onToggleAttacker,
  onReturnCommanderToZone,
  onMovePermanentToGy,
  onResolveCombat,
  onToggleBlocker,
  onResolveIncomingAttack,
  onPrevPhase,
  onNextPhase,
  onPassTurn,
  onInspectCard,
}) => {
  const [hoverZoomEnabled, setHoverZoomEnabled] = useState<boolean>(() =>
    loadHoverZoomPreference()
  );
  const [hoveredCard, setHoveredCard] = useState<HoveredCardPreview | null>(null);

  const handleToggleHoverZoom = () => {
    setHoverZoomEnabled((prev) => {
      const next = !prev;
      saveHoverZoomPreference(next);
      if (!next) setHoveredCard(null);
      return next;
    });
  };

  const handleShowPreview = useCallback((preview: HoveredCardPreview) => {
    setHoveredCard(preview);
  }, []);

  const handleHidePreview = useCallback(() => {
    setHoveredCard(null);
  }, []);

  const landsAndRocks = battlefield.filter((b) => b.isLand || b.isArtifactOrRock);
  const creaturesAndOther = battlefield.filter((b) => !b.isLand && !b.isArtifactOrRock);
  const untappedBlockers = battlefield.filter((b) => b.isCreature && !b.tapped);
  const attackersCount = battlefield.filter((b) => b.attacking).length;
  const totalAvailableMana = totalManaPool + untappedLandsCount;

  const opponentCount = liveBotMode ? liveBots.length : opponentTrackers.length;
  const podSeatGridClass =
    opponentCount <= 1
      ? 'grid-cols-1 max-w-xl mx-auto w-full'
      : opponentCount === 2
      ? 'grid-cols-1 md:grid-cols-2'
      : 'grid-cols-1 lg:grid-cols-3';

  const seatSummaryCount = 1 + opponentCount;
  const seatSummaryLabel =
    seatSummaryCount === 2
      ? '2-Player Duel (1v1)'
      : seatSummaryCount === 3
      ? '3-Player Pod (1v2)'
      : '4-Player Pod (1v3)';

  const playerKO =
    yourLife <= 0 ||
    yourPoison >= 10 ||
    (usesCommanderDamage21 && maxCmdrFromBots >= 21);

  return (
    <TabletopHoverContext.Provider
      value={{
        enabled: hoverZoomEnabled,
        showPreview: handleShowPreview,
        hidePreview: handleHidePreview,
      }}
    >
    <div
      aria-label="Interactive 2/3/4 Player Card Tabletop"
      className="rounded-xl border-2 border-[#186A52] bg-[#0F4C3A] text-white shadow-inner overflow-hidden"
    >
      {/* 1. Turn Order Seat Track & Tabletop Top Bar */}
      <div className="border-b border-[#1A7158] bg-[#0B392C] px-4 py-3 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5 text-xs">
            <span className="font-display font-bold text-white tracking-tight">
              {seatSummaryLabel} Tabletop
            </span>
            <span className="text-emerald-300/40" aria-hidden="true">·</span>
            <span className="font-mono font-bold tabular-nums text-amber-300">
              Turn {turn}
            </span>
            <span className="text-emerald-300/40" aria-hidden="true">·</span>
            <span className="font-semibold text-sky-200">
              {botsAreActing && activeBotIdx !== null && liveBots[activeBotIdx]
                ? `${liveBots[activeBotIdx].name} Acting...`
                : `Your Turn · ${activePhase} (${phaseIdx + 1}/${phases.length})`}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {isShufflingDeck && (
              <span
                role="status"
                aria-live="polite"
                className="inline-flex items-center gap-1.5 rounded-md border border-amber-300/45 bg-amber-950/50 px-2.5 py-1 text-[11px] font-semibold text-amber-200 whitespace-nowrap shrink-0"
              >
                <Shuffle className="h-3 w-3 animate-spin" />
                Shuffling deck...
              </span>
            )}
            <button
              type="button"
              onClick={handleToggleHoverZoom}
              aria-pressed={hoverZoomEnabled}
              title={
                hoverZoomEnabled
                  ? 'Disable enlarged card preview when hovering cards on the field'
                  : 'Enable enlarged card preview when hovering cards on the field'
              }
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
                hoverZoomEnabled
                  ? 'border-sky-300/60 bg-sky-950/60 text-sky-100 hover:bg-sky-900/60'
                  : 'border-[#287D64] bg-[#0F4C3A] text-emerald-200/80 hover:bg-[#145D47]'
              }`}
            >
              <ZoomIn
                className={`h-3.5 w-3.5 ${
                  hoverZoomEnabled ? 'text-sky-300' : 'text-emerald-300/70'
                }`}
              />
              {hoverZoomEnabled ? 'Hover Zoom On' : 'Hover Zoom Off'}
            </button>
            <button
              type="button"
              onClick={onToggleSound}
              aria-pressed={soundEnabled}
              title={soundEnabled ? 'Mute tabletop card sound effects' : 'Enable subtle tabletop card sound effects'}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#287D64] bg-[#0F4C3A] px-2.5 py-1 text-[11px] font-medium text-emerald-100 hover:bg-[#145D47] cursor-pointer whitespace-nowrap shrink-0"
            >
              {soundEnabled ? (
                <Volume2 className="h-3.5 w-3.5 text-amber-300" />
              ) : (
                <VolumeX className="h-3.5 w-3.5 text-emerald-300/70" />
              )}
              {soundEnabled ? 'Sound On' : 'Sound Off'}
            </button>
          </div>
        </div>

        {/* 2 / 3 / 4 Seat Order Strip */}
        <div
          className={`grid gap-2 ${
            seatSummaryCount === 2
              ? 'grid-cols-2'
              : seatSummaryCount === 3
              ? 'grid-cols-1 sm:grid-cols-3'
              : 'grid-cols-2 lg:grid-cols-4'
          }`}
        >
          {/* Seat 1: You */}
          <div
            className={`rounded-lg border px-3 py-2 flex items-center justify-between gap-2 transition-colors ${
              playerKO
                ? 'border-red-400/60 bg-red-950/50'
                : !botsAreActing && !isSimulationFinished
                ? 'border-sky-400 bg-sky-950/55 ring-1 ring-sky-400/50'
                : 'border-[#247059] bg-[#0F4C3A]/80'
            }`}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] font-bold">
                <span className="font-mono text-sky-300">S1</span>
                <span className="truncate text-white">You</span>
                {!botsAreActing && !playerKO && !isSimulationFinished && (
                  <span className="font-mono text-[9px] font-bold uppercase text-sky-300">
                    Active
                  </span>
                )}
                {playerKO && (
                  <span className="font-mono text-[9px] font-bold uppercase text-red-300">
                    KO
                  </span>
                )}
              </div>
              <div className="font-mono text-[10px] tabular-nums text-emerald-200/80 truncate">
                {hand.length}H · {library.length}L · {totalLandsInPlay} Lands
              </div>
            </div>

            <div className="text-right font-mono tabular-nums shrink-0">
              <div className={`text-sm font-bold ${yourLife <= 0 ? 'text-red-300' : 'text-white'}`}>
                {yourLife} HP
              </div>
              {(yourPoison > 0 || (usesCommanderDamage21 && maxCmdrFromBots > 0)) && (
                <div className="text-[9px] text-amber-200">
                  {yourPoison > 0 ? `${yourPoison}/10 PSN` : ''}
                  {yourPoison > 0 && usesCommanderDamage21 && maxCmdrFromBots > 0 ? ' · ' : ''}
                  {usesCommanderDamage21 && maxCmdrFromBots > 0 ? `${maxCmdrFromBots}/21 CMD` : ''}
                </div>
              )}
            </div>
          </div>

          {/* Seats 2..4: Bots or Solo Trackers */}
          {liveBotMode
            ? liveBots.map((bot, idx) => {
                const isActing = activeBotIdx === idx;
                const isTarget = selectedCombatTargetId === bot.id;
                return (
                  <button
                    key={bot.id}
                    type="button"
                    disabled={bot.eliminated}
                    onClick={() => onSelectCombatTarget(bot.id)}
                    className={`rounded-lg border px-3 py-2 flex items-center justify-between gap-2 text-left transition-colors cursor-pointer disabled:cursor-default ${
                      bot.eliminated
                        ? 'border-red-400/45 bg-red-950/40 opacity-65'
                        : isActing
                        ? 'border-amber-400 bg-amber-950/50 ring-1 ring-amber-400/60'
                        : isTarget
                        ? 'border-sky-400/80 bg-[#135A45]'
                        : 'border-[#247059] bg-[#0F4C3A]/80 hover:border-emerald-400/60'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-[11px] font-bold">
                        <span className="font-mono text-emerald-300">S{idx + 2}</span>
                        <span className="truncate text-white">{bot.name}</span>
                        {isActing && (
                          <Loader2 className="h-3 w-3 animate-spin text-amber-300 shrink-0" />
                        )}
                        {bot.eliminated ? (
                          <span className="font-mono text-[9px] font-bold uppercase text-red-300">
                            KO
                          </span>
                        ) : isTarget ? (
                          <span className="font-mono text-[9px] font-bold uppercase text-sky-300">
                            Target
                          </span>
                        ) : null}
                      </div>
                      <div className="font-mono text-[10px] tabular-nums text-emerald-200/80 truncate">
                        {bot.handCount}H · {bot.libraryCount}L · {bot.creatures.length} Cr
                      </div>
                    </div>

                    <div className="text-right font-mono tabular-nums shrink-0">
                      <div className={`text-sm font-bold ${bot.life <= 0 ? 'text-red-300' : 'text-white'}`}>
                        {bot.life} HP
                      </div>
                      {(bot.poison > 0 || (usesCommanderDamage21 && bot.commanderDamageTakenFromYou > 0)) && (
                        <div className="text-[9px] text-amber-200">
                          {bot.poison > 0 ? `${bot.poison}/10 PSN` : ''}
                          {bot.poison > 0 && usesCommanderDamage21 && bot.commanderDamageTakenFromYou > 0
                            ? ' · '
                            : ''}
                          {usesCommanderDamage21 && bot.commanderDamageTakenFromYou > 0
                            ? `${bot.commanderDamageTakenFromYou}/21 CMD`
                            : ''}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })
            : opponentTrackers.map((opp, idx) => {
                const isKO =
                  opp.life <= 0 ||
                  opp.poison >= 10 ||
                  (usesCommanderDamage21 && opp.commanderDamageTakenFromYou >= 21);
                const isTarget = selectedCombatTargetId === opp.id;
                return (
                  <button
                    key={opp.id}
                    type="button"
                    onClick={() => onSelectCombatTarget(opp.id)}
                    className={`rounded-lg border px-3 py-2 flex items-center justify-between gap-2 text-left transition-colors cursor-pointer ${
                      isKO
                        ? 'border-red-400/45 bg-red-950/40 opacity-70'
                        : isTarget
                        ? 'border-sky-400 bg-[#135A45]'
                        : 'border-[#247059] bg-[#0F4C3A]/80 hover:border-emerald-400/60'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-[11px] font-bold">
                        <span className="font-mono text-emerald-300">S{idx + 2}</span>
                        <span className="truncate text-white">{opp.name}</span>
                        {isKO ? (
                          <span className="font-mono text-[9px] font-bold uppercase text-red-300">
                            KO
                          </span>
                        ) : isTarget ? (
                          <span className="font-mono text-[9px] font-bold uppercase text-sky-300">
                            Target
                          </span>
                        ) : null}
                      </div>
                      <div className="text-[10px] text-emerald-200/80 truncate">
                        {opp.commanderName || opp.archetype}
                      </div>
                    </div>

                    <div className="text-right font-mono tabular-nums shrink-0">
                      <div className={`text-sm font-bold ${opp.life <= 0 ? 'text-red-300' : 'text-white'}`}>
                        {opp.life} HP
                      </div>
                    </div>
                  </button>
                );
              })}
        </div>
      </div>

      {/* 2. Top Opponent Pod Felt Area (1v1 Centered Duel, 1v2 Split, 1v3 3-Seat Arc) */}
      <div className="p-4 sm:p-5 space-y-4">
        {liveBotMode ? (
          <div className={`grid gap-3.5 ${podSeatGridClass}`}>
            {liveBots.map((bot, idx) => {
              const isSelectedTarget = selectedCombatTargetId === bot.id;
              const isActing = activeBotIdx === idx;
              const untappedLands = Math.max(0, bot.landsInPlay - bot.tappedLands);

              return (
                <div
                  key={bot.id}
                  onClick={() => {
                    if (!bot.eliminated) onSelectCombatTarget(bot.id);
                  }}
                  className={`rounded-xl border p-3.5 space-y-3 transition-colors cursor-pointer ${
                    bot.eliminated
                      ? 'border-red-400/45 bg-[#2A171C]/80 opacity-70'
                      : isActing
                      ? 'border-amber-400 bg-[#124F3D] ring-1 ring-amber-400/60'
                      : isSelectedTarget
                      ? 'border-sky-400 bg-[#114B3A] ring-1 ring-sky-400/50'
                      : 'border-[#1E6E56] bg-[#0B392C]/85 hover:border-emerald-400/60'
                  }`}
                >
                  {/* Bot Seat Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-[10px] font-bold text-emerald-300">
                          Seat {idx + 2}
                        </span>
                        <span className="truncate text-xs font-bold text-white">
                          {bot.name}
                        </span>
                        {bot.eliminated ? (
                          <span className="inline-flex items-center gap-1 font-mono text-[10px] font-bold uppercase text-red-300">
                            <Skull className="h-3 w-3" />
                            KO ({bot.eliminatedReason || 'life'})
                          </span>
                        ) : isActing ? (
                          <span className="font-mono text-[10px] font-bold text-amber-300">
                            Taking Turn...
                          </span>
                        ) : isSelectedTarget ? (
                          <span className="font-mono text-[10px] font-semibold text-sky-300">
                            Combat Target
                          </span>
                        ) : null}
                      </div>
                      <div className="text-[11px] text-emerald-100/75 truncate">
                        {bot.commanderName ? `${bot.commanderName} · ` : ''}
                        {bot.archetype}
                      </div>
                    </div>

                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1.5 shrink-0 font-mono tabular-nums"
                    >
                      <button
                        type="button"
                        onClick={() => onAdjustOpponentStat(bot.id, 'life', -1)}
                        aria-label={`Subtract 1 life from ${bot.name}`}
                        className="rounded border border-[#287D64] bg-[#0F4C3A] px-1.5 py-0.5 text-[10px] text-emerald-100 hover:bg-[#17614B] cursor-pointer"
                      >
                        -1
                      </button>
                      <span
                        className={`min-w-[46px] text-center text-base font-bold ${
                          bot.life <= 0
                            ? 'text-red-300'
                            : bot.life <= Math.round(startingLife * 0.3)
                            ? 'text-amber-300'
                            : 'text-white'
                        }`}
                      >
                        {bot.life}
                      </span>
                      <button
                        type="button"
                        onClick={() => onAdjustOpponentStat(bot.id, 'life', 1)}
                        aria-label={`Add 1 life to ${bot.name}`}
                        className="rounded border border-[#287D64] bg-[#0F4C3A] px-1.5 py-0.5 text-[10px] text-emerald-100 hover:bg-[#17614B] cursor-pointer"
                      >
                        +1
                      </button>
                    </div>
                  </div>

                  {/* Hidden Hand Fan + Library/GY + Lands Pips */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-y border-[#1A624D] py-2">
                    <CardBackFan count={bot.handCount} shuffling={isShufflingDeck} />

                    <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] tabular-nums text-emerald-100/90">
                      <span className="inline-flex items-center gap-1">
                        {isShufflingDeck && (
                          <Shuffle className="h-2.5 w-2.5 text-amber-300 animate-spin shrink-0" />
                        )}
                        Lib {bot.libraryCount}
                      </span>
                      <span className="text-emerald-300/40" aria-hidden="true">·</span>
                      <span>GY {bot.graveyardCount}</span>
                      <span className="text-emerald-300/40" aria-hidden="true">·</span>
                      <span>
                        {untappedLands}/{bot.landsInPlay} Lands
                      </span>
                      {bot.poison > 0 && (
                        <>
                          <span className="text-emerald-300/40" aria-hidden="true">·</span>
                          <span className="text-emerald-300 font-bold">{bot.poison}/10 PSN</span>
                        </>
                      )}
                      {usesCommanderDamage21 && bot.commanderDamageTakenFromYou > 0 && (
                        <>
                          <span className="text-emerald-300/40" aria-hidden="true">·</span>
                          <span className="text-sky-300 font-bold">
                            Your Cmdr {bot.commanderDamageTakenFromYou}/21
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Visual Bot Board: Command Zone + Creatures */}
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-start gap-2.5 overflow-x-auto pb-1 min-h-[110px]"
                  >
                    {allowsCommandZone && bot.commanderInZone && bot.commanderName && (
                      <TableCardTile
                        name={bot.commanderName}
                        meta={bot.commanderMeta}
                        onInspect={onInspectCard}
                        size="sm"
                        cornerTag="Cmdr Zone"
                        cornerTone="amber"
                        ptLabel={
                          bot.commanderPower > 0
                            ? `${bot.commanderPower}/${bot.commanderToughness}`
                            : null
                        }
                        subLabel={`MV ${bot.commanderCmc + bot.commanderTax}`}
                      />
                    )}

                    {bot.creatures.length === 0 ? (
                      <div className="flex-1 flex flex-col justify-center rounded-lg border border-dashed border-[#247059] px-3 py-4 text-center text-[11px] text-emerald-200/70">
                        <span>No creatures on battlefield</span>
                        {bot.landsInPlay > 0 && (
                          <div className="mt-1.5 flex flex-wrap justify-center gap-1">
                            {Array.from({ length: Math.min(10, bot.landsInPlay) }).map((_, li) => (
                              <span
                                key={li}
                                className={`inline-block h-3 w-2.5 rounded-[2px] border ${
                                  li < bot.tappedLands
                                    ? 'border-emerald-400/30 bg-emerald-950/60 rotate-12 opacity-60'
                                    : 'border-emerald-300/60 bg-emerald-700/50'
                                }`}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      bot.creatures.map((cr: LiveBotCreature) => (
                        <TableCardTile
                          key={cr.uid}
                          name={cr.name}
                          meta={cr.meta}
                          onInspect={onInspectCard}
                          size="sm"
                          tapped={cr.tapped}
                          summoningSick={cr.summoningSick}
                          cornerTag={
                            cr.isCommander
                              ? 'Cmdr'
                              : cr.hasInfect
                              ? 'Infect'
                              : cr.flying
                              ? 'Fly'
                              : undefined
                          }
                          cornerTone={
                            cr.isCommander
                              ? 'amber'
                              : cr.hasInfect
                              ? 'emerald'
                              : 'sky'
                          }
                          ptLabel={`${cr.power}/${cr.toughness}`}
                          subLabel={cr.toxicValue > 0 ? `Toxic ${cr.toxicValue}` : 'Creature'}
                        />
                      ))
                    )}
                  </div>

                  {/* Last Action Summary */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-emerald-100/85 border-t border-[#1A624D] pt-2">
                    <span className="truncate flex-1" title={bot.lastActionSummary}>
                      <strong className="text-white">Last:</strong> {bot.lastActionSummary}
                    </span>
                    {bot.lastTargetName && bot.lastTargetName !== '—' && (
                      <span
                        className={`font-mono text-[10px] font-bold shrink-0 ${
                          bot.lastTargetName === 'You' ? 'text-red-300' : 'text-amber-300'
                        }`}
                      >
                        → {bot.lastTargetName}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* Solo Goldfish Opponent Pod Cards */
          <div className={`grid gap-3.5 ${podSeatGridClass}`}>
            {opponentTrackers.map((opp, idx) => {
              const isSelected = selectedCombatTargetId === opp.id;
              const isKO =
                opp.life <= 0 ||
                opp.poison >= 10 ||
                (usesCommanderDamage21 && opp.commanderDamageTakenFromYou >= 21);

              return (
                <div
                  key={opp.id}
                  onClick={() => onSelectCombatTarget(opp.id)}
                  className={`rounded-xl border p-3.5 space-y-2.5 transition-colors cursor-pointer ${
                    isKO
                      ? 'border-red-400/45 bg-[#2A171C]/80 opacity-75'
                      : isSelected
                      ? 'border-sky-400 bg-[#114B3A] ring-1 ring-sky-400/50'
                      : 'border-[#1E6E56] bg-[#0B392C]/85 hover:border-emerald-400/60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[10px] font-bold text-emerald-300">
                          Seat {idx + 2}
                        </span>
                        <span className="truncate text-xs font-bold text-white">
                          {opp.name}
                        </span>
                        {isSelected && (
                          <span className="font-mono text-[10px] font-semibold text-sky-300">
                            Target
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-emerald-100/75 truncate">
                        {opp.commanderName ? `${opp.commanderName} · ` : ''}
                        {opp.archetype}
                      </div>
                    </div>

                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1 font-mono text-xs tabular-nums shrink-0"
                    >
                      <button
                        type="button"
                        onClick={() => onAdjustOpponentStat(opp.id, 'life', -5)}
                        className="rounded border border-[#287D64] bg-[#0F4C3A] px-1.5 py-0.5 text-[10px] hover:bg-[#17614B] cursor-pointer"
                      >
                        -5
                      </button>
                      <button
                        type="button"
                        onClick={() => onAdjustOpponentStat(opp.id, 'life', -1)}
                        className="rounded border border-[#287D64] bg-[#0F4C3A] px-1.5 py-0.5 text-[10px] hover:bg-[#17614B] cursor-pointer"
                      >
                        -1
                      </button>
                      <span className="min-w-[40px] text-center text-sm font-bold text-white">
                        {opp.life}
                      </span>
                      <button
                        type="button"
                        onClick={() => onAdjustOpponentStat(opp.id, 'life', 1)}
                        className="rounded border border-[#287D64] bg-[#0F4C3A] px-1.5 py-0.5 text-[10px] hover:bg-[#17614B] cursor-pointer"
                      >
                        +1
                      </button>
                      <button
                        type="button"
                        onClick={() => onAdjustOpponentStat(opp.id, 'life', 5)}
                        className="rounded border border-[#287D64] bg-[#0F4C3A] px-1.5 py-0.5 text-[10px] hover:bg-[#17614B] cursor-pointer"
                      >
                        +5
                      </button>
                    </div>
                  </div>

                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="flex flex-wrap items-center justify-between gap-2 border-t border-[#1A624D] pt-2 font-mono text-[10px] tabular-nums text-emerald-100/85"
                  >
                    <div className="flex items-center gap-1.5">
                      <span>Poison {opp.poison}/10</span>
                      <button
                        type="button"
                        onClick={() => onAdjustOpponentStat(opp.id, 'poison', 1)}
                        className="rounded border border-[#287D64] bg-[#0F4C3A] px-1 py-0.5 text-[9px] hover:bg-[#17614B] cursor-pointer"
                      >
                        +1
                      </button>
                    </div>
                    {usesCommanderDamage21 && (
                      <div className="flex items-center gap-2">
                        <span>
                          Your Cmdr {opp.commanderDamageTakenFromYou}/21
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            onAdjustOpponentStat(opp.id, 'commanderDamageTakenFromYou', 1)
                          }
                          className="rounded border border-[#287D64] bg-[#0F4C3A] px-1 py-0.5 text-[9px] hover:bg-[#17614B] cursor-pointer"
                        >
                          +1
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 3. Center Battlefront Bar: Incoming Blockers OR Combat/Mana/Phase Command Strip */}
        {pendingIncomingAttack ? (
          <div className="rounded-xl border-2 border-red-400 bg-[#2C1216]/95 p-4 space-y-3 shadow-lg">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-bold text-red-100">
                <Shield className="h-4 w-4 text-red-300 shrink-0" />
                <span>
                  Incoming Attack from {pendingIncomingAttack.botName} — Assign Visual Blockers
                </span>
              </div>
              <span className="font-mono text-[11px] text-red-200 tabular-nums">
                {untappedBlockers.length} untapped creature{untappedBlockers.length === 1 ? '' : 's'} ready
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {pendingIncomingAttack.attackers.map((atk) => {
                const assignedIds = Object.entries(blockerAssignments)
                  .filter(([, targetId]) => targetId === atk.uid)
                  .map(([blkId]) => blkId);

                return (
                  <div
                    key={atk.uid}
                    className="rounded-lg border border-red-400/50 bg-[#1B0C0F] p-2.5 flex items-start gap-3"
                  >
                    <TableCardTile
                      name={atk.name}
                      meta={atk.meta}
                      onInspect={onInspectCard}
                      size="sm"
                      attacking
                      cornerTag={atk.isCommander ? 'Cmdr ATK' : 'ATK'}
                      cornerTone="red"
                      ptLabel={`${atk.power}/${atk.toughness}`}
                      subLabel={
                        atk.hasInfect
                          ? 'Infect'
                          : atk.toxicValue > 0
                          ? `Toxic ${atk.toxicValue}`
                          : 'Attacker'
                      }
                    />

                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="text-[11px] font-semibold text-red-100">
                        {assignedIds.length > 0
                          ? `Blocked by ${assignedIds.length} creature${assignedIds.length === 1 ? '' : 's'}`
                          : `Unblocked (${atk.power} ${atk.hasInfect ? 'poison' : 'combat dmg'})`}
                      </div>

                      {untappedBlockers.length === 0 ? (
                        <div className="text-[11px] text-red-200/75">
                          No untapped creatures available to block.
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {untappedBlockers.map((blk) => {
                            const isBlockingThis = blockerAssignments[blk.uid] === atk.uid;
                            const blkTough = Number(blk.meta?.toughness) || Math.max(2, blk.power);
                            return (
                              <button
                                key={blk.uid}
                                type="button"
                                onClick={() => onToggleBlocker(blk.uid, atk.uid)}
                                className={`rounded border px-2 py-1 text-[11px] font-semibold cursor-pointer transition-colors ${
                                  isBlockingThis
                                    ? 'border-sky-400 bg-sky-700 text-white'
                                    : 'border-zinc-500/60 bg-zinc-900 text-zinc-200 hover:border-sky-400'
                                }`}
                              >
                                {isBlockingThis ? 'Blocking: ' : 'Block w/ '}
                                {blk.name} ({blk.power}/{blkTough})
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => onResolveIncomingAttack(true)}
                className="rounded-lg border border-red-300/60 bg-red-950/60 px-3 py-1.5 text-xs font-semibold text-red-100 hover:bg-red-900 cursor-pointer whitespace-nowrap shrink-0"
              >
                Take All Unblocked
              </button>
              <button
                type="button"
                onClick={() => onResolveIncomingAttack(false)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Shield className="h-3.5 w-3.5" />
                Resolve Combat
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-[#1E6E56] bg-[#0B392C]/95 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-3">
            {/* Mana Pool Quick Bar */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-100">
                <Droplets className="h-3.5 w-3.5 text-sky-300 shrink-0" />
                <span className="font-mono tabular-nums">
                  Pool: {totalManaPool}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1">
                {MANA_BUTTONS.map((mb) => (
                  <div
                    key={mb.color}
                    className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums ${mb.chipClass}`}
                  >
                    <button
                      type="button"
                      onClick={() => onAdjustManaPool(mb.color, -1)}
                      disabled={manaPool[mb.color] <= 0}
                      aria-label={`Remove ${mb.color} mana`}
                      className="opacity-70 hover:opacity-100 disabled:opacity-25 cursor-pointer"
                    >
                      <Minus className="h-2.5 w-2.5" />
                    </button>
                    <span>
                      {mb.color}:{manaPool[mb.color]}
                    </span>
                    <button
                      type="button"
                      onClick={() => onAdjustManaPool(mb.color, 1)}
                      aria-label={`Add ${mb.color} mana`}
                      className="opacity-70 hover:opacity-100 cursor-pointer"
                    >
                      <Plus className="h-2.5 w-2.5" />
                    </button>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={onTapAllUntappedLands}
                disabled={untappedLandsCount === 0}
                className="rounded border border-[#2A8469] bg-[#125642] px-2 py-1 text-[10px] font-semibold text-emerald-100 hover:bg-[#176B53] disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
              >
                Tap Lands ({untappedLandsCount})
              </button>
              <button
                type="button"
                onClick={onUntapAll}
                className="rounded border border-[#2A8469] bg-[#0F4C3A] px-2 py-1 text-[10px] font-medium text-emerald-100 hover:bg-[#176B53] cursor-pointer whitespace-nowrap shrink-0"
              >
                Untap All
              </button>
              {totalManaPool > 0 && (
                <button
                  type="button"
                  onClick={onEmptyManaPool}
                  className="rounded border border-[#2A8469] bg-[#0F4C3A] px-2 py-1 text-[10px] font-medium text-emerald-200 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                >
                  Empty
                </button>
              )}
            </div>

            {/* Phase Stepper OR Active Combat Resolve Controls */}
            <div className="flex flex-wrap items-center gap-2">
              {activePhase === 'Combat' &&
                !botsAreActing &&
                !isSimulationFinished &&
                (liveBotMode ? liveBots.some((b) => !b.eliminated) : opponentTrackers.length > 0) && (
                  <>
                    <select
                      aria-label="Tabletop combat target"
                      value={selectedCombatTargetId}
                      onChange={(e) => onSelectCombatTarget(e.target.value)}
                      className="rounded-md border border-[#2A8469] bg-[#0F4C3A] px-2 py-1 text-[11px] font-semibold text-white cursor-pointer"
                    >
                      {(liveBotMode ? liveBots.filter((b) => !b.eliminated) : opponentTrackers).map(
                        (o) => (
                          <option key={o.id} value={o.id}>
                            Attack {o.name}
                          </option>
                        )
                      )}
                    </select>
                    <button
                      type="button"
                      onClick={onResolveCombat}
                      disabled={attackersCount === 0}
                      className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1 text-[11px] font-bold text-white hover:bg-red-500 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <Swords className="h-3.5 w-3.5" />
                      Deal Damage ({attackersCount})
                    </button>
                  </>
                )}

              <button
                type="button"
                onClick={onPrevPhase}
                disabled={phaseIdx === 0 || botsAreActing || isSimulationFinished}
                className="inline-flex items-center gap-1 rounded-md border border-[#2A8469] bg-[#0F4C3A] px-2 py-1 text-[11px] font-medium text-emerald-100 hover:bg-[#176B53] disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
              >
                <ChevronLeft className="h-3 w-3" />
                Prev
              </button>
              <button
                type="button"
                onClick={onNextPhase}
                disabled={botsAreActing || isSimulationFinished}
                className="inline-flex items-center gap-1 rounded-md bg-sky-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-sky-500 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
              >
                {phaseIdx === phases.length - 1
                  ? liveBotMode
                    ? 'End Turn → Bots'
                    : `Next Turn (T${turn + 1})`
                  : `Next: ${phases[phaseIdx + 1]}`}
                <ChevronRight className="h-3 w-3" />
              </button>
              {liveBotMode && phaseIdx < phases.length - 1 && (
                <button
                  type="button"
                  onClick={onPassTurn}
                  disabled={botsAreActing || isSimulationFinished}
                  className="rounded-md border border-sky-400/50 bg-sky-950/60 px-2.5 py-1 text-[11px] font-semibold text-sky-200 hover:bg-sky-900 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
                >
                  Pass → Bots
                </button>
              )}
            </div>
          </div>
        )}

        {/* 4. Bottom Player Playmat (Your Seat + Battlefield + Command/Library + Hand) */}
        <div className="rounded-xl border border-emerald-400/35 bg-[#125541]/90 p-3.5 sm:p-4 space-y-4">
          {/* Your Seat Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#20765C] pb-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <Shield className="h-4 w-4 text-sky-300 shrink-0" />
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11px] font-bold text-sky-300">Seat 1</span>
                  <span className="text-sm font-bold text-white">
                    Your Playmat · {deckName || 'Your Deck'}
                  </span>
                  <span className="font-mono text-[11px] text-emerald-200/80">
                    ({mode} · Lands {landsPlayedThisTurn}/1)
                  </span>
                </div>
              </div>
            </div>

            {/* Life & Poison Controls */}
            <div className="flex flex-wrap items-center gap-3 font-mono text-xs tabular-nums">
              <div className="flex items-center gap-1">
                <Flame className="h-3.5 w-3.5 text-red-300 mr-0.5 shrink-0" />
                {[-5, -1].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => onAdjustYourLife(d)}
                    className="rounded border border-red-400/40 bg-red-950/50 px-1.5 py-0.5 text-[10px] font-bold text-red-200 hover:bg-red-900 cursor-pointer"
                  >
                    {d}
                  </button>
                ))}
                <span
                  className={`min-w-[56px] text-center text-base font-bold ${
                    yourLife <= 0
                      ? 'text-red-300'
                      : yourLife <= 10
                      ? 'text-amber-300'
                      : 'text-white'
                  }`}
                >
                  {yourLife} HP
                </span>
                {[1, 5].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => onAdjustYourLife(d)}
                    className="rounded border border-emerald-400/40 bg-emerald-950/50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-200 hover:bg-emerald-900 cursor-pointer"
                  >
                    +{d}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1.5 border-l border-[#20765C] pl-3">
                <Skull className="h-3.5 w-3.5 text-emerald-300 shrink-0" />
                <span>PSN {yourPoison}/10</span>
                <button
                  type="button"
                  onClick={() => onAdjustYourPoison(1)}
                  className="rounded border border-[#287D64] bg-[#0B392C] px-1.5 py-0.5 text-[10px] hover:bg-[#17614B] cursor-pointer"
                >
                  +1
                </button>
              </div>
            </div>
          </div>

          {/* Board Grid: Left Deck/Cmd/GY Column + Right Permanents Lanes */}
          <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[210px_1fr]">
            {/* Left Side Piles: Library Deck Stack, Command Zone, Graveyard */}
            <div className="space-y-3">
              {/* Interactive Library & Graveyard Row */}
              <div className="grid grid-cols-2 gap-2">
                <div
                  className={`rounded-lg border p-2.5 flex flex-col justify-between gap-2 transition-colors ${
                    isShufflingDeck
                      ? 'border-amber-300 ring-1 ring-amber-300/60 bg-gradient-to-br from-sky-950 via-zinc-900 to-amber-950'
                      : 'border-amber-300/45 bg-gradient-to-br from-sky-950 via-zinc-900 to-amber-950'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onDrawCard(1, true)}
                    disabled={
                      library.length === 0 ||
                      botsAreActing ||
                      Boolean(pendingIncomingAttack) ||
                      isSimulationFinished ||
                      isShufflingDeck
                    }
                    title="Click deck stack to draw 1 card (+1 Turn)"
                    className="w-full text-left disabled:opacity-50 cursor-pointer transition-transform hover:-translate-y-0.5"
                  >
                    <div className="flex items-center justify-between text-[10px] font-bold text-amber-200">
                      <span>{isShufflingDeck ? 'Shuffling' : 'Library'}</span>
                      <BookOpen className="h-3 w-3" />
                    </div>

                    {isShufflingDeck ? (
                      <div className="mt-1.5 flex items-center justify-center py-0.5">
                        <DeckShuffleAnimation size="sm" theme="felt" />
                      </div>
                    ) : (
                      <>
                        <div className="mt-1 font-mono text-lg font-bold tabular-nums text-white">
                          {library.length}
                        </div>
                        <div className="text-[9px] text-amber-200/80">Click to Draw</div>
                      </>
                    )}
                  </button>

                  {onShuffleLibrary && (
                    <button
                      type="button"
                      onClick={onShuffleLibrary}
                      disabled={
                        library.length < 2 ||
                        botsAreActing ||
                        Boolean(pendingIncomingAttack) ||
                        isSimulationFinished
                      }
                      title="Shuffle your remaining library"
                      className="inline-flex w-full items-center justify-center gap-1 rounded border border-amber-300/40 bg-zinc-950/65 px-2 py-1 text-[10px] font-semibold text-amber-200 hover:bg-zinc-900 hover:border-amber-300 disabled:opacity-40 cursor-pointer whitespace-nowrap"
                    >
                      <Shuffle className={`h-2.5 w-2.5 ${isShufflingDeck ? 'animate-spin' : ''}`} />
                      {isShufflingDeck ? 'Shuffling...' : 'Shuffle'}
                    </button>
                  )}
                </div>

                <div
                  onMouseEnter={(e) => {
                    if (!hoverZoomEnabled || !graveyard[0]) return;
                    handleShowPreview({
                      name: graveyard[0].name,
                      meta: graveyard[0].meta,
                      rect: buildHoverRect(e.currentTarget),
                      statusTags: ['Top of Graveyard'],
                    });
                  }}
                  onMouseLeave={handleHidePreview}
                  onClick={() => {
                    if (graveyard[0]) {
                      handleHidePreview();
                      onInspectCard(graveyard[0].name, graveyard[0].meta);
                    }
                  }}
                  className={`rounded-lg border border-[#247059] bg-[#0B392C]/90 p-2.5 flex flex-col justify-between ${
                    graveyard[0] ? 'cursor-pointer hover:border-sky-400/70' : ''
                  }`}
                >
                  <div className="flex items-center justify-between text-[10px] font-bold text-emerald-200">
                    <span>Graveyard</span>
                    <Coins className="h-3 w-3 text-zinc-300" />
                  </div>
                  <div className="mt-1 font-mono text-lg font-bold tabular-nums text-white">
                    {graveyard.length}
                  </div>
                  <div className="truncate text-[9px] text-emerald-200/80">
                    {graveyard[0] ? graveyard[0].name : 'Empty'}
                  </div>
                </div>
              </div>

              {/* Command Zone Cards */}
              {allowsCommandZone && commandZone.length > 0 && (
                <div className="rounded-lg border border-[#247059] bg-[#0B392C]/85 p-2.5 space-y-2">
                  <div className="flex items-center justify-between text-[10px] font-bold text-amber-200">
                    <span>Command Zone</span>
                    <Crown className="h-3 w-3" />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {commandZone.map((cmd) => {
                      const tax = commanderTaxByUid[cmd.uid] || 0;
                      const totalCost = cmd.cmc + tax;
                      const canCast = totalAvailableMana >= totalCost;
                      return (
                        <TableCardTile
                          key={cmd.uid}
                          name={cmd.name}
                          meta={cmd.meta}
                          onInspect={onInspectCard}
                          size="sm"
                          playable={canCast ? 'commander' : 'none'}
                          cornerTag={tax > 0 ? `+${tax} Tax` : 'Cmdr'}
                          cornerTone="amber"
                          primaryAction={{
                            label: `Cast (${totalCost})`,
                            onClick: () => onCastCommander(cmd),
                            disabled: !canCast || botsAreActing || Boolean(pendingIncomingAttack),
                            tone: 'amber',
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Right Lanes: Creatures/Permanents Front Row + Lands/Rocks Back Row */}
            <div className="space-y-3 min-w-0">
              {/* Front Row: Creatures & Nonland Permanents */}
              <div className="rounded-lg border border-[#247059] bg-[#0B392C]/75 p-2.5 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <span className="font-semibold text-emerald-100">
                    Creatures &amp; Nonland Permanents ({creaturesAndOther.length})
                  </span>
                  {activePhase === 'Combat' && (
                    <span className="font-mono text-[10px] text-red-300">
                      Click Atk on ready creatures to declare attackers
                    </span>
                  )}
                </div>

                {creaturesAndOther.length === 0 ? (
                  <div className="py-3 text-center text-[11px] text-emerald-200/70">
                    No creatures or nonland permanents in play yet. Cast a spell from your hand below.
                  </div>
                ) : (
                  <div className="flex items-start gap-2.5 overflow-x-auto pb-1">
                    {creaturesAndOther.map((perm) => {
                      const tough = Number(perm.meta?.toughness) || Math.max(2, perm.power);
                      return (
                        <TableCardTile
                          key={perm.uid}
                          name={perm.name}
                          meta={perm.meta}
                          onInspect={onInspectCard}
                          size="md"
                          tapped={perm.tapped}
                          attacking={perm.attacking}
                          summoningSick={perm.summoningSick}
                          cornerTag={
                            perm.attacking
                              ? 'ATK'
                              : perm.isCommander
                              ? 'Cmdr'
                              : undefined
                          }
                          cornerTone={perm.attacking ? 'red' : 'amber'}
                          ptLabel={perm.isCreature ? `${perm.power}/${tough}` : null}
                          primaryAction={
                            activePhase === 'Combat' && perm.isCreature && !perm.tapped
                              ? {
                                  label: perm.attacking ? 'Attacking' : 'Attack',
                                  onClick: () => onToggleAttacker(perm.uid),
                                  tone: perm.attacking ? 'red' : 'sky',
                                }
                              : {
                                  label: perm.tapped ? 'Untap' : 'Tap',
                                  onClick: () => onTogglePermanentTap(perm),
                                  tone: 'zinc',
                                }
                          }
                          secondaryAction={
                            perm.isCommander
                              ? {
                                  label: 'CmdZ',
                                  onClick: () => onReturnCommanderToZone(perm),
                                  tone: 'zinc',
                                }
                              : {
                                  label: 'GY',
                                  onClick: () => onMovePermanentToGy(perm),
                                  tone: 'red',
                                }
                          }
                        />
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Back Row: Lands & Mana Rocks */}
              <div className="rounded-lg border border-[#247059] bg-[#0B392C]/75 p-2.5 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <span className="font-semibold text-emerald-100">
                    Lands &amp; Mana Sources ({landsAndRocks.length})
                  </span>
                  <span className="font-mono text-[10px] tabular-nums text-emerald-200">
                    {untappedLandsCount}/{totalLandsInPlay} untapped lands · {totalAvailableMana} total mana ready
                  </span>
                </div>

                {landsAndRocks.length === 0 ? (
                  <div className="py-2.5 text-center text-[11px] text-emerald-200/70">
                    No lands or mana rocks on battlefield yet.
                  </div>
                ) : (
                  <div className="flex items-start gap-2 overflow-x-auto pb-1">
                    {landsAndRocks.map((perm) => (
                      <TableCardTile
                        key={perm.uid}
                        name={perm.name}
                        meta={perm.meta}
                        onInspect={onInspectCard}
                        size="sm"
                        tapped={perm.tapped}
                        subLabel={perm.producedMana.slice(0, 2).join('/')}
                        onTileClick={() => onTogglePermanentTap(perm)}
                        primaryAction={{
                          label: perm.tapped ? 'Untap' : `+${perm.producedMana[0] || 'C'}`,
                          onClick: () => onTogglePermanentTap(perm),
                          tone: perm.tapped ? 'zinc' : 'emerald',
                        }}
                        secondaryAction={{
                          label: 'GY',
                          onClick: () => onMovePermanentToGy(perm),
                          tone: 'zinc',
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 5. Bottom Hand Tray */}
          <div className="rounded-lg border border-[#247059] bg-[#0B392C]/90 p-3 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 font-bold text-white">
                <RotateCcw className="h-3.5 w-3.5 text-amber-300 shrink-0" />
                <span>Your Hand ({hand.length} cards)</span>
              </div>
              <span className="font-mono text-[11px] tabular-nums text-emerald-200">
                Available Mana: {totalAvailableMana} ({totalManaPool} pool + {untappedLandsCount} lands)
              </span>
            </div>

            {hand.length === 0 ? (
              <div className="py-4 text-center text-xs text-emerald-200/75">
                Your hand is empty — click the Library stack above or &ldquo;Draw Card&rdquo; to draw.
              </div>
            ) : (
              <div className="flex items-start gap-2.5 overflow-x-auto pb-1">
                {hand.map((card) => {
                  const isNewlyDrawn = lastDrawnUids.includes(card.uid);
                  const canAutoPay = !card.isLand && totalAvailableMana >= card.cmc;
                  const playableKind: 'land' | 'spell' | 'none' = card.isLand
                    ? landsPlayedThisTurn === 0
                      ? 'land'
                      : 'none'
                    : canAutoPay
                    ? 'spell'
                    : 'none';

                  return (
                    <TableCardTile
                      key={card.uid}
                      name={card.name}
                      meta={card.meta}
                      onInspect={onInspectCard}
                      size="md"
                      playable={playableKind}
                      newlyDrawn={isNewlyDrawn}
                      cornerTag={
                        isNewlyDrawn
                          ? 'Drew'
                          : card.isLand
                          ? 'Land'
                          : undefined
                      }
                      cornerTone={isNewlyDrawn ? 'amber' : 'emerald'}
                      primaryAction={
                        card.isLand
                          ? {
                              label: landsPlayedThisTurn === 0 ? 'Play Land' : 'Extra Land',
                              onClick: () => onPlayLand(card),
                              disabled: botsAreActing || Boolean(pendingIncomingAttack),
                              tone: landsPlayedThisTurn === 0 ? 'emerald' : 'zinc',
                            }
                          : {
                              label: `Cast (${card.cmc})`,
                              onClick: () => onCastFromHand(card),
                              disabled: !canAutoPay || botsAreActing || Boolean(pendingIncomingAttack),
                              tone: canAutoPay ? 'sky' : 'zinc',
                            }
                      }
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
    <CardHoverZoomOverlay
      preview={hoveredCard}
      enabled={hoverZoomEnabled}
      onDismiss={handleHidePreview}
    />
    </TabletopHoverContext.Provider>
  );
};
