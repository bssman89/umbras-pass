import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  Ban,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Coins,
  Cpu,
  Crown,
  Droplets,
  Flame,
  LayoutGrid,
  Loader2,
  Maximize2,
  Minimize2,
  Minus,
  Mountain,
  Move,
  Palette,
  Plus,
  RotateCcw,
  Shield,
  Shuffle,
  Skull,
  Sparkles,
  Swords,
  Volume2,
  VolumeX,
  Wand2,
  ZoomIn,
} from 'lucide-react';
import type {
  CardMetadata,
  ManaColor,
  PlaytestMode,
} from '../types/deck';
import { getBotIntelligenceMeta } from '../utils/botIntelligence';
import {
  extractCreatureKeywords,
  formatCreatureKeywordTags,
  type BotTurnPhaseStep,
  type LiveBotCreature,
  type LiveBotState,
  type PendingBotAttack,
} from '../utils/liveBotEngine';
import {
  buildHoverRect,
  CardHoverZoomOverlay,
  loadHoverZoomPreference,
  saveHoverZoomPreference,
  type HoveredCardPreview,
} from './CardHoverZoomOverlay';
import { DeckShuffleAnimation } from './DeckShuffleAnimation';
import {
  PermanentCounterEditor,
  PlayerCountersPanel,
  TokenCreatorPanel,
  type TabletopTokenBlueprint,
} from './TabletopTokenCounterModals';
import {
  classifyCardStackProfile,
  getEffectiveInstantCost,
  type ActivatedAbilityOption,
  type ResolvedStackHistoryEntry,
  type StackItem,
  type TriggerAbilityKind,
} from '../utils/liveStackEngine';
import {
  InterruptResponseBanner,
  type InterruptWindowMode,
} from './InterruptResponseBanner';
import {
  TabletopStackPanel,
  type StackCastResponseOptions,
} from './TabletopStackPanel';
import { ZoneViewerModal } from './ZoneViewerModal';
import {
  loadTabletopPlaymatPreferences,
  PLAYMAT_THEME_UPDATED_EVENT,
  resolveSeatPlaymatSurface,
  resolveTabletopSurface,
  type TabletopPlaymatPreferences,
} from '../utils/tabletopPlaymatThemes';
import {
  PlaymatSurfaceBackdrop,
  TabletopPlaymatCustomizerModal,
} from './TabletopPlaymatCustomizerModal';
import {
  CUSTOM_CARDS_TOKENS_UPDATED_EVENT,
  loadCustomCardTokenPreferences,
  resolveCardWithCustomProxy,
  type CustomCardTokenPreferences,
} from '../utils/customCardProxiesAndTokens';
import { CustomCardProxyTokenModal } from './CustomCardProxyTokenModal';
import {
  clampPlaymatX,
  clampPlaymatY,
  computeOpenBotPlaymatSpot,
  computeOpenPlayerPlaymatSpot,
  isBacklinePlaymatCard,
  type PlaymatDropPoint,
} from '../utils/playmatPositioning';

export type { TabletopTokenBlueprint };

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
  isToken?: boolean;
  tokenAbility?: 'treasure' | 'food' | 'clue' | 'blood' | 'none';
  baseToughness?: number;
  plusOneCounters?: number;
  minusOneCounters?: number;
  otherCounters?: Record<string, number>;
  protectedUntilEot?: boolean;
  tempPowerBoost?: number;
  tempToughnessBoost?: number;
  playmatX?: number;
  playmatY?: number;
  playmatZ?: number;
}

export function getEffectivePermanentStats(perm: TabletopPermanent): {
  power: number;
  toughness: number;
} {
  const netMod = (perm.plusOneCounters || 0) - (perm.minusOneCounters || 0);
  const baseTough =
    perm.baseToughness !== undefined
      ? perm.baseToughness
      : Number(perm.meta?.toughness) || Math.max(2, perm.power);
  return {
    power: Math.max(0, perm.power + netMod + (perm.tempPowerBoost || 0)),
    toughness: Math.max(0, baseTough + netMod + (perm.tempToughnessBoost || 0)),
  };
}

type TabletopDragSource =
  | { zone: 'hand'; uid: string; name: string; isLand: boolean }
  | { zone: 'command'; uid: string; name: string }
  | {
      zone: 'battlefield';
      uid: string;
      name: string;
      lane: 'creatures' | 'lands';
      isCreature: boolean;
      isCommander: boolean;
      isToken?: boolean;
      tapped: boolean;
    }
  | { zone: 'graveyard'; uid: string; name: string }
  | { zone: 'exile'; uid: string; name: string };

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

export type TabletopSoundKind =
  | 'draw'
  | 'land'
  | 'cast'
  | 'tap'
  | 'combat'
  | 'turn'
  | 'shuffle'
  | 'alert';

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

    if (kind === 'alert') {
      const notes = [
        { freq: 523.25, offset: 0, dur: 0.09 },
        { freq: 659.25, offset: 0.085, dur: 0.14 },
      ];
      notes.forEach(({ freq, offset, dur }) => {
        if (!sharedAudioCtx) return;
        const osc = sharedAudioCtx.createOscillator();
        const gain = sharedAudioCtx.createGain();
        osc.connect(gain);
        gain.connect(sharedAudioCtx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + offset);
        gain.gain.setValueAtTime(0.045, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.001, now + offset + dur);
        osc.start(now + offset);
        osc.stop(now + offset + dur + 0.01);
      });
      return;
    }

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

    const freqMap: Record<Exclude<TabletopSoundKind, 'shuffle' | 'alert'>, [number, number, number]> = {
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
  counterChips?: string[];
  draggable?: boolean;
  isDragTarget?: boolean;
  onDragStart?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd?: () => void;
  onDragOverCard?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDropOnCard?: (e: React.DragEvent<HTMLDivElement>) => void;
  primaryAction?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    tone?: 'emerald' | 'sky' | 'red' | 'zinc' | 'amber';
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
    tone?: 'red' | 'zinc' | 'sky' | 'amber';
  };
  counterAction?: {
    active?: boolean;
    onClick: () => void;
  };
  onTileClick?: () => void;
  pointerDraggable?: boolean;
  isPointerDragging?: boolean;
  onPointerDownCard?: (e: React.PointerEvent<HTMLDivElement>) => void;
  suppressNextClickRef?: React.MutableRefObject<boolean>;
}

interface TabletopHoverContextValue {
  enabled: boolean;
  showPreview: (preview: HoveredCardPreview) => void;
  hidePreview: () => void;
  customCardPrefs?: CustomCardTokenPreferences;
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
  counterChips,
  draggable = false,
  isDragTarget = false,
  onDragStart,
  onDragEnd,
  onDragOverCard,
  onDropOnCard,
  primaryAction,
  secondaryAction,
  counterAction,
  onTileClick,
  pointerDraggable = false,
  isPointerDragging = false,
  onPointerDownCard,
  suppressNextClickRef,
}) => {
  const [imgFailed, setImgFailed] = useState(false);
  const {
    enabled: hoverZoomEnabled,
    showPreview,
    hidePreview,
    customCardPrefs,
  } = useContext(TabletopHoverContext);

  const customResolved = resolveCardWithCustomProxy(name, meta, customCardPrefs);
  const effectiveMeta: CardMetadata | null = customResolved.meta;
  const effectiveDisplayTitle = customResolved.displayTitle || name;
  const customBadge = customResolved.badgeLabel || null;

  useEffect(() => {
    setImgFailed(false);
  }, [name, effectiveMeta?.imageUri]);

  const widthClass = size === 'sm' ? 'w-[88px]' : 'w-[108px]';
  const artHeightClass = size === 'sm' ? 'h-[60px]' : 'h-[78px]';

  const frameRingClass = isDragTarget
    ? 'border-amber-400 ring-2 ring-amber-400 scale-[1.03] shadow-lg'
    : attacking
    ? 'border-red-500 ring-2 ring-red-500/80 -translate-y-1.5 shadow-md'
    : newlyDrawn
    ? 'border-amber-400 ring-2 ring-amber-400/75 animate-card-draw-slide shadow-sm'
    : playable === 'land'
    ? 'border-emerald-500 ring-2 ring-emerald-400/75 shadow-sm'
    : playable === 'spell' || playable === 'commander'
    ? 'border-sky-500 ring-2 ring-sky-400/75 shadow-sm'
    : customBadge
    ? 'border-amber-400/90 hover:border-amber-500'
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
      : effectiveMeta?.power && effectiveMeta?.toughness
      ? `${effectiveMeta.power}/${effectiveMeta.toughness}`
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
    if (customBadge) tags.push(customBadge);
    if (attacking && cornerTag !== 'ATK') tags.push('Attacking');
    if (tapped) tags.push('Tapped');
    if (summoningSick && !tapped) tags.push('Summoning Sick');
    showPreview({
      name: effectiveDisplayTitle,
      meta: effectiveMeta,
      rect: buildHoverRect(e.currentTarget),
      ptLabel: resolvedPt,
      statusTags: tags,
    });
  };

  return (
    <div
      draggable={draggable}
      onPointerDown={(e) => {
        if (!pointerDraggable || !onPointerDownCard) return;
        const targetEl = e.target as HTMLElement | null;
        if (targetEl?.closest('button[data-card-action="true"]')) return;
        hidePreview();
        onPointerDownCard(e);
      }}
      onDragStart={(e) => {
        hidePreview();
        onDragStart?.(e);
      }}
      onDragEnd={() => onDragEnd?.()}
      onDragOver={(e) => {
        if (onDragOverCard) {
          e.preventDefault();
          onDragOverCard(e);
        }
      }}
      onDrop={(e) => {
        if (onDropOnCard) {
          e.preventDefault();
          e.stopPropagation();
          onDropOnCard(e);
        }
      }}
      onMouseEnter={isPointerDragging ? undefined : handleMouseEnter}
      onMouseLeave={hidePreview}
      className={`${widthClass} relative shrink-0 rounded-lg border bg-white p-1.5 flex flex-col justify-between select-none ${
        isPointerDragging ? 'ring-2 ring-amber-300 border-amber-300 shadow-2xl scale-[1.06]' : 'transition-all duration-150'
      } ${frameRingClass} ${tapped ? 'rotate-3 opacity-80' : ''} ${
        draggable || pointerDraggable ? 'cursor-grab active:cursor-grabbing touch-none' : ''
      } ${hoverZoomEnabled && !isPointerDragging ? 'hover:z-20 hover:scale-[1.06] hover:shadow-lg' : ''}`}
    >
      <button
        type="button"
        onClick={(e) => {
          if (suppressNextClickRef?.current) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          hidePreview();
          if (onTileClick) onTileClick();
          else onInspect(name, effectiveMeta);
        }}
        title={`${effectiveDisplayTitle}${effectiveMeta?.manaCost ? ` (${effectiveMeta.manaCost})` : ''} — ${
          draggable || pointerDraggable ? 'drag anywhere on playmat or ' : ''
        }click to ${onTileClick ? 'select' : 'inspect'}`}
        className="w-full text-left cursor-pointer group focus:outline-none"
      >
        <div
          className={`relative ${artHeightClass} w-full overflow-hidden rounded border border-zinc-200 bg-zinc-100`}
        >
          {effectiveMeta?.imageUri && !imgFailed ? (
            <img
              src={effectiveMeta.imageUri}
              alt={effectiveDisplayTitle}
              draggable={false}
              referrerPolicy="no-referrer"
              onError={() => setImgFailed(true)}
              className="h-full w-full object-cover object-top"
            />
          ) : (
            <div className="h-full w-full flex flex-col items-center justify-center px-1 text-center bg-zinc-100">
              {cornerTag === 'Cmdr' ? (
                <Crown className="h-3.5 w-3.5 text-amber-700 mb-0.5" />
              ) : effectiveMeta?.isLand || subLabel === 'Land' ? (
                <Mountain className="h-3.5 w-3.5 text-emerald-700 mb-0.5" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 text-sky-700 mb-0.5" />
              )}
              <span className="line-clamp-2 text-[9px] font-semibold leading-tight text-zinc-700">
                {effectiveMeta?.typeLine ? effectiveMeta.typeLine.split('—')[0].trim() : subLabel || 'Card'}
              </span>
            </div>
          )}

          {cornerTag ? (
            <span
              className={`absolute top-0.5 left-0.5 rounded px-1 py-0.5 font-mono text-[8px] font-bold uppercase leading-none ${cornerClass}`}
            >
              {cornerTag}
            </span>
          ) : customBadge ? (
            <span className="absolute top-0.5 left-0.5 rounded bg-amber-400 px-1 py-0.5 font-mono text-[7px] font-bold uppercase leading-none text-zinc-950">
              {customBadge}
            </span>
          ) : null}

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
            {effectiveDisplayTitle}
          </div>
          <div className="flex items-center justify-between gap-1 font-mono text-[9px] text-zinc-500">
            <span className="truncate">
              {meta?.manaCost || subLabel || (meta?.isLand ? 'Land' : '—')}
            </span>
            {typeof meta?.cmc === 'number' && !meta.isLand && (
              <span className="shrink-0 tabular-nums">{meta.cmc}</span>
            )}
          </div>
          {counterChips && counterChips.length > 0 && (
            <div className="flex flex-wrap items-center gap-0.5 pt-0.5">
              {counterChips.slice(0, 3).map((chip) => (
                <span
                  key={chip}
                  className="rounded bg-emerald-900 px-1 py-0.2 font-mono text-[8px] font-bold text-amber-200 tabular-nums leading-tight"
                >
                  {chip}
                </span>
              ))}
            </div>
          )}
        </div>
      </button>

      {(primaryAction || secondaryAction || counterAction || onTileClick) && (
        <div className="mt-1.5 flex items-center gap-1 border-t border-zinc-100 pt-1">
          {primaryAction && (
            <button
              type="button"
              data-card-action="true"
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
          {counterAction && (
            <button
              type="button"
              data-card-action="true"
              onClick={() => {
                hidePreview();
                counterAction.onClick();
              }}
              title={`Edit counters on ${name}`}
              className={`rounded border px-1 py-0.5 font-mono text-[9px] font-bold leading-tight cursor-pointer whitespace-nowrap shrink-0 ${
                counterAction.active
                  ? 'border-sky-600 bg-sky-700 text-white'
                  : 'border-zinc-300 bg-zinc-100 text-zinc-800 hover:border-sky-500 hover:text-sky-700'
              }`}
            >
              ±
            </button>
          )}
          {secondaryAction && (
            <button
              type="button"
              data-card-action="true"
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
              data-card-action="true"
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
  exile?: TabletopSimCard[];
  liveBots: LiveBotState[];
  opponentTrackers: TabletopSoloOpponent[];
  selectedCombatTargetId: string;
  pendingIncomingAttack: PendingBotAttack | null;
  blockerAssignments: Record<string, string>;
  soundEnabled: boolean;
  isShufflingDeck?: boolean;
  isFullscreen?: boolean;
  botStepAwaitingContinue?: boolean;
  activeBotTurnBanner?: {
    botName: string;
    seatNumber: number;
    queuePosition: number;
    queueTotal: number;
    phaseSteps: BotTurnPhaseStep[];
    adaptationNote: string;
    isLastBotInRound: boolean;
  } | null;
  onContinueNextBotTurn?: () => void;
  onToggleFullscreen?: () => void;
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
  onPlayLand: (card: TabletopSimCard, dropPos?: PlaymatDropPoint) => void;
  onCastFromHand: (card: TabletopSimCard, dropPos?: PlaymatDropPoint) => void;
  onCastCommander: (cmd: TabletopSimCard, dropPos?: PlaymatDropPoint) => void;
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
  // Interactive Tabletop Tokens, Counters & Drag-and-Drop
  playerCounters?: Record<string, number>;
  isMonarch?: boolean;
  onCreateToken?: (blueprint: TabletopTokenBlueprint) => void;
  onActivateTokenAbility?: (perm: TabletopPermanent) => void;
  onAdjustPermanentCounter?: (uid: string, counterKey: string, delta: number) => void;
  onAdjustPlayerCounter?: (label: string, delta: number) => void;
  onToggleMonarch?: () => void;
  onReorderBattlefield?: (sourceUid: string, targetUid: string) => void;
  onMoveBattlefieldCard?: (uid: string, x: number, y: number) => void;
  onAutoArrangePlaymat?: () => void;
  onMoveBotCard?: (botId: string, uid: string, x: number, y: number) => void;
  onAutoArrangeBotPlaymat?: (botId: string) => void;
  onDiscardFromHand?: (card: TabletopSimCard) => void;
  onExileFromHand?: (card: TabletopSimCard) => void;
  onMovePermanentToExile?: (perm: TabletopPermanent) => void;
  onBouncePermanentToHand?: (perm: TabletopPermanent) => void;
  onReturnTopGraveyardToBattlefield?: (dropPos?: PlaymatDropPoint) => void;
  onReturnTopGraveyardToHand?: () => void;
  onReturnTopExileToBattlefield?: (dropPos?: PlaymatDropPoint) => void;
  onReturnTopExileToHand?: () => void;
  onMovePlayerZoneCard?: (
    fromZone: 'graveyard' | 'exile',
    cardUid: string,
    destination: 'battlefield' | 'hand' | 'graveyard' | 'exile'
  ) => void;
  onDragAttackOpponent?: (permUid: string, opponentId: string) => void;
  // Interactive Stack, Interrupt/Response Window & Activated Abilities
  stackItems?: StackItem[];
  resolvedStackHistory?: ResolvedStackHistoryEntry[];
  queueAllSpellsOnStack?: boolean;
  onToggleQueueAllSpellsOnStack?: () => void;
  onReorderStackItem?: (itemId: string, direction: 'up' | 'down') => void;
  onQueueManualTrigger?: (permanentUid: string, triggerKind: TriggerAbilityKind) => void;
  onClearResolvedHistory?: () => void;
  activatedAbilities?: ActivatedAbilityOption[];
  combatFogActive?: boolean;
  totalAvailableMana?: number;
  interruptCountdownMs?: number;
  interruptTotalMs?: number;
  interruptTimerHeld?: boolean;
  interruptWindowMode?: InterruptWindowMode;
  onToggleHoldInterrupt?: () => void;
  onCastStackResponse?: (cardUid: string, options: StackCastResponseOptions) => void;
  onActivateAbility?: (
    ability: ActivatedAbilityOption,
    options: StackCastResponseOptions
  ) => void;
  onResolveStackTop?: () => void;
  onResolveStackAll?: () => void;
  onCastCombatInstant?: (
    cardUid: string,
    targetAttackerUid?: string,
    targetPlayerCreatureUid?: string
  ) => void;
  activeAiModelLabel?: string;
  effectiveAiEngine?: 'local-gguf' | 'cloud-gemini' | 'deterministic';
  thinkingBotName?: string | null;
  liveAiTurnReasoning?: boolean;
  onToggleLiveAiTurnReasoning?: () => void;
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
  exile = [],
  liveBots,
  opponentTrackers,
  selectedCombatTargetId,
  pendingIncomingAttack,
  blockerAssignments,
  soundEnabled,
  isShufflingDeck = false,
  isFullscreen = false,
  botStepAwaitingContinue = false,
  activeBotTurnBanner = null,
  onContinueNextBotTurn,
  onToggleFullscreen,
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
  playerCounters = {},
  isMonarch = false,
  onCreateToken,
  onActivateTokenAbility,
  onAdjustPermanentCounter,
  onAdjustPlayerCounter,
  onToggleMonarch,
  onReorderBattlefield,
  onMoveBattlefieldCard,
  onAutoArrangePlaymat,
  onMoveBotCard,
  onAutoArrangeBotPlaymat,
  onDiscardFromHand,
  onExileFromHand,
  onMovePermanentToExile,
  onBouncePermanentToHand,
  onReturnTopGraveyardToBattlefield,
  onReturnTopGraveyardToHand,
  onReturnTopExileToBattlefield,
  onReturnTopExileToHand,
  onMovePlayerZoneCard,
  onDragAttackOpponent,
  stackItems = [],
  resolvedStackHistory = [],
  queueAllSpellsOnStack = true,
  onToggleQueueAllSpellsOnStack,
  onReorderStackItem,
  onQueueManualTrigger,
  onClearResolvedHistory,
  activatedAbilities = [],
  combatFogActive = false,
  totalAvailableMana,
  interruptCountdownMs = 0,
  interruptTotalMs = 0,
  interruptTimerHeld = false,
  interruptWindowMode = '12s',
  onToggleHoldInterrupt,
  onCastStackResponse,
  onActivateAbility,
  onResolveStackTop,
  onResolveStackAll,
  onCastCombatInstant,
  activeAiModelLabel,
  effectiveAiEngine = 'deterministic',
  thinkingBotName = null,
  liveAiTurnReasoning = true,
  onToggleLiveAiTurnReasoning,
}) => {
  const [hoverZoomEnabled, setHoverZoomEnabled] = useState<boolean>(() =>
    loadHoverZoomPreference()
  );
  const [hoveredCard, setHoveredCard] = useState<HoveredCardPreview | null>(null);
  const [showTokenCreator, setShowTokenCreator] = useState<boolean>(false);
  const [showPlayerCounters, setShowPlayerCounters] = useState<boolean>(false);
  const [editingCounterUid, setEditingCounterUid] = useState<string | null>(null);
  const [dragSource, setDragSource] = useState<TabletopDragSource | null>(null);
  const [activeDropZone, setActiveDropZone] = useState<string | null>(null);
  const [dragOverCardUid, setDragOverCardUid] = useState<string | null>(null);
  const [showPlaymatGuides, setShowPlaymatGuides] = useState<boolean>(true);
  const [pointerDragState, setPointerDragState] = useState<{
    kind: 'player' | 'bot';
    uid: string;
    name: string;
    botId?: string;
    x: number;
    y: number;
    isCreature: boolean;
    isCommander: boolean;
    tapped: boolean;
  } | null>(null);
  const playerPlaymatRef = useRef<HTMLDivElement | null>(null);
  const botPlaymatRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const suppressCardClickRef = useRef<boolean>(false);
  const pointerCleanupRef = useRef<(() => void) | null>(null);
  const [combatInstantTargetAtkUid, setCombatInstantTargetAtkUid] = useState<string>('');
  const [combatTrickTargetBlkUid, setCombatTrickTargetBlkUid] = useState<string>('');
  const [zoneModalTarget, setZoneModalTarget] = useState<{
    ownerId: string;
    zone: 'graveyard' | 'exile';
  } | null>(null);
  const hasActiveStack = stackItems.length > 0;
  const effectiveAvailableMana =
    totalAvailableMana !== undefined
      ? totalAvailableMana
      : totalManaPool + untappedLandsCount;
  const hasCommanderOnBoard = battlefield.some((p) => p.isCommander);

  useEffect(() => {
    return () => {
      pointerCleanupRef.current?.();
    };
  }, []);

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

  const clearDragState = useCallback(() => {
    setDragSource(null);
    setActiveDropZone(null);
    setDragOverCardUid(null);
  }, []);

  const beginDrag = (e: React.DragEvent, source: TabletopDragSource) => {
    setDragSource(source);
    try {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', `${source.zone}:${source.uid}`);
    } catch {
      // Ignore restricted dataTransfer environments
    }
  };

  const startPlaymatPointerDrag = (
    e: React.PointerEvent<HTMLDivElement>,
    params: {
      kind: 'player' | 'bot';
      uid: string;
      name: string;
      botId?: string;
      initialX: number;
      initialY: number;
      isCreature: boolean;
      isCommander: boolean;
      tapped: boolean;
    }
  ) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (botsAreActing || Boolean(pendingIncomingAttack) || isSimulationFinished) return;
    const container =
      params.kind === 'player'
        ? playerPlaymatRef.current
        : params.botId
        ? botPlaymatRefs.current[params.botId]
        : null;
    if (!container) return;

    pointerCleanupRef.current?.();
    const rect = container.getBoundingClientRect();
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    let hasMoved = false;
    let currentX = params.initialX;
    let currentY = params.initialY;
    let hoveredZone: string | null = null;

    const findHoverDropZone = (clientX: number, clientY: number): string | null => {
      if (params.kind !== 'player' || typeof document.elementsFromPoint !== 'function') {
        return null;
      }
      const els = document.elementsFromPoint(clientX, clientY);
      for (const el of els) {
        const dropKey = (el as HTMLElement).getAttribute?.('data-tabletop-drop');
        if (!dropKey) continue;
        if (dropKey.startsWith('opp:')) {
          if (params.isCreature && !params.tapped) return dropKey;
          continue;
        }
        if (dropKey === 'command') {
          if (params.isCommander) return dropKey;
          continue;
        }
        if (dropKey === 'graveyard' || dropKey === 'exile' || dropKey === 'hand') {
          return dropKey;
        }
      }
      return null;
    };

    const handleMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startClientX;
      const dy = ev.clientY - startClientY;
      if (!hasMoved) {
        if (Math.hypot(dx, dy) < 5) return;
        hasMoved = true;
        suppressCardClickRef.current = true;
        handleHidePreview();
      }
      const deltaXPct = (dx / Math.max(1, rect.width)) * 100;
      const deltaYPct = (dy / Math.max(1, rect.height)) * 100;
      currentX = clampPlaymatX(
        params.initialX + deltaXPct,
        params.kind === 'bot' ? 10 : 7,
        params.kind === 'bot' ? 90 : 93
      );
      currentY = clampPlaymatY(
        params.initialY + deltaYPct,
        params.kind === 'bot' ? 16 : 12,
        params.kind === 'bot' ? 84 : 88
      );
      hoveredZone = findHoverDropZone(ev.clientX, ev.clientY);
      setActiveDropZone(hoveredZone);
      setPointerDragState({
        kind: params.kind,
        uid: params.uid,
        name: params.name,
        botId: params.botId,
        x: currentX,
        y: currentY,
        isCreature: params.isCreature,
        isCommander: params.isCommander,
        tapped: params.tapped,
      });
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
      pointerCleanupRef.current = null;
    };

    const handleUp = () => {
      cleanup();
      setPointerDragState(null);
      setActiveDropZone(null);

      if (!hasMoved) return;

      window.setTimeout(() => {
        suppressCardClickRef.current = false;
      }, 90);

      if (params.kind === 'player' && hoveredZone) {
        const perm = battlefield.find((p) => p.uid === params.uid);
        if (hoveredZone.startsWith('opp:') && !hasActiveStack) {
          onDragAttackOpponent?.(params.uid, hoveredZone.slice(4));
          return;
        }
        if (hoveredZone === 'graveyard' && perm && !hasActiveStack) {
          onMovePermanentToGy(perm);
          return;
        }
        if (hoveredZone === 'exile' && perm && !hasActiveStack) {
          onMovePermanentToExile?.(perm);
          return;
        }
        if (hoveredZone === 'hand' && perm && !hasActiveStack) {
          onBouncePermanentToHand?.(perm);
          return;
        }
        if (hoveredZone === 'command' && perm && perm.isCommander && !hasActiveStack) {
          onReturnCommanderToZone(perm);
          return;
        }
      }

      if (params.kind === 'player') {
        onMoveBattlefieldCard?.(params.uid, currentX, currentY);
      } else if (params.kind === 'bot' && params.botId) {
        onMoveBotCard?.(params.botId, params.uid, currentX, currentY);
      }
    };

    pointerCleanupRef.current = cleanup;
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
  };

  const handleDropOnPlaymatCanvas = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const src = dragSource;
    const rect = e.currentTarget.getBoundingClientRect();
    const dropPos: PlaymatDropPoint = {
      x: clampPlaymatX(((e.clientX - rect.left) / Math.max(1, rect.width)) * 100),
      y: clampPlaymatY(((e.clientY - rect.top) / Math.max(1, rect.height)) * 100),
    };
    clearDragState();
    if (!src || botsAreActing || Boolean(pendingIncomingAttack) || hasActiveStack) return;

    if (src.zone === 'hand') {
      const card = hand.find((c) => c.uid === src.uid);
      if (!card) return;
      if (card.isLand) onPlayLand(card, dropPos);
      else onCastFromHand(card, dropPos);
    } else if (src.zone === 'command') {
      const cmd = commandZone.find((c) => c.uid === src.uid);
      if (cmd) onCastCommander(cmd, dropPos);
    } else if (src.zone === 'graveyard') {
      onReturnTopGraveyardToBattlefield?.(dropPos);
    } else if (src.zone === 'exile') {
      onReturnTopExileToBattlefield?.(dropPos);
    }
  };

  const handleDropOnGraveyard = (e: React.DragEvent) => {
    e.preventDefault();
    const src = dragSource;
    clearDragState();
    if (!src || botsAreActing || Boolean(pendingIncomingAttack) || hasActiveStack) return;

    if (src.zone === 'hand') {
      const card = hand.find((c) => c.uid === src.uid);
      if (card) onDiscardFromHand?.(card);
    } else if (src.zone === 'battlefield') {
      const perm = battlefield.find((p) => p.uid === src.uid);
      if (perm) onMovePermanentToGy(perm);
    } else if (src.zone === 'exile') {
      onMovePlayerZoneCard?.('exile', src.uid, 'graveyard');
    }
  };

  const handleDropOnExile = (e: React.DragEvent) => {
    e.preventDefault();
    const src = dragSource;
    clearDragState();
    if (!src || botsAreActing || Boolean(pendingIncomingAttack) || hasActiveStack) return;

    if (src.zone === 'hand') {
      const card = hand.find((c) => c.uid === src.uid);
      if (card) onExileFromHand?.(card);
    } else if (src.zone === 'battlefield') {
      const perm = battlefield.find((p) => p.uid === src.uid);
      if (perm) onMovePermanentToExile?.(perm);
    } else if (src.zone === 'graveyard') {
      onMovePlayerZoneCard?.('graveyard', src.uid, 'exile');
    }
  };

  const handleDropOnCommandZone = (e: React.DragEvent) => {
    e.preventDefault();
    const src = dragSource;
    clearDragState();
    if (!src || botsAreActing || Boolean(pendingIncomingAttack) || hasActiveStack) return;

    if (src.zone === 'battlefield' && src.isCommander) {
      const perm = battlefield.find((p) => p.uid === src.uid);
      if (perm) onReturnCommanderToZone(perm);
    }
  };

  const handleDropOnHand = (e: React.DragEvent) => {
    e.preventDefault();
    const src = dragSource;
    clearDragState();
    if (!src || botsAreActing || Boolean(pendingIncomingAttack) || hasActiveStack) return;

    if (src.zone === 'battlefield') {
      const perm = battlefield.find((p) => p.uid === src.uid);
      if (perm) onBouncePermanentToHand?.(perm);
    } else if (src.zone === 'graveyard') {
      onReturnTopGraveyardToHand?.();
    } else if (src.zone === 'exile') {
      onReturnTopExileToHand?.();
    }
  };

  const handleDropOnOpponentSeat = (e: React.DragEvent, oppId: string) => {
    e.preventDefault();
    const src = dragSource;
    clearDragState();
    if (!src || botsAreActing || Boolean(pendingIncomingAttack) || hasActiveStack) return;

    if (src.zone === 'battlefield' && src.isCreature && !src.tapped) {
      onDragAttackOpponent?.(src.uid, oppId);
    }
  };

  const formatPermanentCounterChips = (perm: TabletopPermanent): string[] => {
    const chips: string[] = [];
    if ((perm.plusOneCounters || 0) > 0) chips.push(`+${perm.plusOneCounters}/+${perm.plusOneCounters}`);
    if ((perm.minusOneCounters || 0) > 0) chips.push(`-${perm.minusOneCounters}/-${perm.minusOneCounters}`);
    if (perm.otherCounters) {
      for (const [label, count] of Object.entries(perm.otherCounters)) {
        if (count > 0) {
          const short = label.length > 5 ? label.slice(0, 4) : label;
          chips.push(`${short} ${count}`);
        }
      }
    }
    return chips;
  };

  const editingCounterPerm = editingCounterUid
    ? battlefield.find((p) => p.uid === editingCounterUid) || null
    : null;

  const activePlayerCounterEntries = Object.entries(playerCounters).filter(([, v]) => v > 0);

  const landsAndRocks = battlefield.filter((b) => b.isLand || b.isArtifactOrRock);
  const creaturesAndOther = battlefield.filter((b) => !b.isLand && !b.isArtifactOrRock);
  const untappedBlockers = battlefield.filter((b) => b.isCreature && !b.tapped);
  const attackersCount = battlefield.filter((b) => b.attacking).length;

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

  const [playmatPrefs, setPlaymatPrefs] = useState<TabletopPlaymatPreferences>(() =>
    loadTabletopPlaymatPreferences()
  );
  const [showPlaymatCustomizer, setShowPlaymatCustomizer] = useState(false);

  const [customCardPrefs, setCustomCardPrefs] = useState<CustomCardTokenPreferences>(() =>
    loadCustomCardTokenPreferences()
  );
  const [showCustomCardStudio, setShowCustomCardStudio] = useState(false);

  useEffect(() => {
    const handleSync = () => {
      setPlaymatPrefs(loadTabletopPlaymatPreferences());
    };
    window.addEventListener(PLAYMAT_THEME_UPDATED_EVENT, handleSync);
    return () => window.removeEventListener(PLAYMAT_THEME_UPDATED_EVENT, handleSync);
  }, []);

  useEffect(() => {
    const handleCustomCardSync = () => {
      setCustomCardPrefs(loadCustomCardTokenPreferences());
    };
    window.addEventListener(CUSTOM_CARDS_TOKENS_UPDATED_EVENT, handleCustomCardSync);
    return () => window.removeEventListener(CUSTOM_CARDS_TOKENS_UPDATED_EVENT, handleCustomCardSync);
  }, []);

  const tabletopSurface = resolveTabletopSurface(playmatPrefs);
  const yourPlaymatSurface = resolveSeatPlaymatSurface(playmatPrefs, 1, {
    isYourSeat: true,
  });

  const playerKO =
    yourLife <= 0 ||
    yourPoison >= 10 ||
    (usesCommanderDamage21 && maxCmdrFromBots >= 21);

  const allTableCardNames = Array.from(
    new Set(
      [
        ...commandZone.map((c) => c.name),
        ...battlefield.map((c) => c.name),
        ...hand.map((c) => c.name),
        ...library.map((c) => c.name),
        ...graveyard.map((c) => c.name),
      ].filter(Boolean)
    )
  );

  return (
    <TabletopHoverContext.Provider
      value={{
        enabled: hoverZoomEnabled,
        showPreview: handleShowPreview,
        hidePreview: handleHidePreview,
        customCardPrefs,
      }}
    >
    <div
      aria-label="Interactive 2/3/4 Player Card Tabletop"
      className={`relative rounded-xl border-2 text-white shadow-inner overflow-hidden transition-colors ${tabletopSurface.outerClass}`}
    >
      <PlaymatSurfaceBackdrop surface={tabletopSurface} variant="table" />
      {/* 1. Turn Order Seat Track & Tabletop Top Bar */}
      <div className={`relative z-10 border-b px-4 py-3 space-y-2.5 ${tabletopSurface.hudClass}`}>
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
              {thinkingBotName
                ? `${thinkingBotName} thinking with ${activeAiModelLabel || 'AI'}...`
                : botsAreActing && activeBotIdx !== null && liveBots[activeBotIdx]
                ? `Seat ${activeBotIdx + 2}: ${liveBots[activeBotIdx].name}'s Turn`
                : `Your Turn · ${activePhase} (${phaseIdx + 1}/${phases.length})`}
            </span>
            {activeAiModelLabel && (
              <>
                <span className="text-emerald-300/40" aria-hidden="true">·</span>
                {effectiveAiEngine !== 'deterministic' && onToggleLiveAiTurnReasoning ? (
                  <button
                    type="button"
                    onClick={onToggleLiveAiTurnReasoning}
                    title={
                      liveAiTurnReasoning
                        ? `Live Per-Turn AI Thinking ON (${activeAiModelLabel}). Click to use fast turn rules while keeping pre-match & post-match AI learning.`
                        : `Live Per-Turn AI Thinking OFF (pre-match & post-match learning still use ${activeAiModelLabel}). Click to enable per-turn AI reasoning.`
                    }
                    className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-semibold cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
                      liveAiTurnReasoning
                        ? 'border-sky-300/60 bg-sky-950/60 text-sky-100 hover:bg-sky-900/70'
                        : 'border-emerald-300/35 bg-[#0F4C3A] text-emerald-200/80 hover:bg-[#145D47]'
                    }`}
                  >
                    <Cpu className="h-3 w-3 text-sky-300" />
                    {activeAiModelLabel}
                    {liveAiTurnReasoning ? '' : ' (Fast)'}
                  </button>
                ) : (
                  <span className="inline-flex items-center gap-1 font-mono text-[10px] text-emerald-200/85">
                    <Cpu className="h-3 w-3 text-emerald-300" />
                    {activeAiModelLabel}
                  </span>
                )}
              </>
            )}
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
              onClick={() => setShowCustomCardStudio(true)}
              title="Configure custom card art, playtest proxies, and custom token visuals"
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-400/55 bg-amber-950/60 px-2.5 py-1 text-[11px] font-semibold text-amber-100 hover:bg-amber-900/70 cursor-pointer whitespace-nowrap shrink-0 transition-colors"
            >
              <Wand2 className="h-3.5 w-3.5 text-amber-300" />
              <span>Proxies &amp; Custom Art</span>
              {Object.keys(customCardPrefs.cardProxies).length > 0 && (
                <span className="rounded bg-amber-400/20 px-1 py-0.2 font-mono text-[9px] font-bold text-amber-200 tabular-nums">
                  {Object.keys(customCardPrefs.cardProxies).length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setShowPlaymatCustomizer(true)}
              title="Customize tabletop background and per-seat TCG playmats"
              className="inline-flex items-center gap-1.5 rounded-md border border-emerald-400/50 bg-emerald-950/60 px-2.5 py-1 text-[11px] font-semibold text-emerald-100 hover:bg-emerald-900/70 cursor-pointer whitespace-nowrap shrink-0 transition-colors"
            >
              <Palette className="h-3.5 w-3.5 text-emerald-300" />
              <span>Playmats &amp; Theme</span>
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
            {onToggleFullscreen && (
              <button
                type="button"
                onClick={onToggleFullscreen}
                aria-pressed={isFullscreen}
                title={
                  isFullscreen
                    ? 'Exit Fullscreen Play Area (Esc)'
                    : 'Expand Tabletop to Fullscreen inside program'
                }
                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-semibold cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
                  isFullscreen
                    ? 'border-amber-300/70 bg-amber-500/20 text-amber-100 hover:bg-amber-500/30'
                    : 'border-sky-300/60 bg-sky-950/60 text-sky-100 hover:bg-sky-900/60'
                }`}
              >
                {isFullscreen ? (
                  <>
                    <Minimize2 className="h-3.5 w-3.5 text-amber-300 shrink-0" />
                    Exit Fullscreen
                  </>
                ) : (
                  <>
                    <Maximize2 className="h-3.5 w-3.5 text-sky-300 shrink-0" />
                    Fullscreen
                  </>
                )}
              </button>
            )}
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
      <div className="relative z-10 p-4 sm:p-5 space-y-4">
        {liveBotMode ? (
          <div className={`grid gap-3.5 ${podSeatGridClass}`}>
            {liveBots.map((bot, idx) => {
              const isSelectedTarget = selectedCombatTargetId === bot.id;
              const isActing = activeBotIdx === idx;
              const untappedLands = Math.max(0, bot.landsInPlay - bot.tappedLands);
              const botSeatNum = Math.min(4, idx + 2) as 2 | 3 | 4;
              const botSeatSurface = resolveSeatPlaymatSurface(playmatPrefs, botSeatNum);

              return (
                <div
                  key={bot.id}
                  data-tabletop-drop={`opp:${bot.id}`}
                  onClick={() => {
                    if (!bot.eliminated) onSelectCombatTarget(bot.id);
                  }}
                  onDragOver={(e) => {
                    if (
                      !bot.eliminated &&
                      dragSource?.zone === 'battlefield' &&
                      dragSource.isCreature &&
                      !dragSource.tapped
                    ) {
                      e.preventDefault();
                      setActiveDropZone(`opp:${bot.id}`);
                    }
                  }}
                  onDragLeave={() => {
                    if (activeDropZone === `opp:${bot.id}`) setActiveDropZone(null);
                  }}
                  onDrop={(e) => {
                    if (!bot.eliminated) handleDropOnOpponentSeat(e, bot.id);
                  }}
                  className={`relative overflow-hidden rounded-xl border p-3.5 space-y-3 transition-colors cursor-pointer ${
                    bot.eliminated
                      ? 'border-red-400/45 bg-[#2A171C]/80 opacity-70'
                      : activeDropZone === `opp:${bot.id}`
                      ? 'border-red-400 bg-red-950/55 ring-2 ring-red-400'
                      : isActing
                      ? botSeatSurface.seatActiveClass
                      : isSelectedTarget
                      ? botSeatSurface.seatActiveClass
                      : botSeatSurface.seatClass
                  }`}
                >
                  <PlaymatSurfaceBackdrop surface={botSeatSurface} variant="seat" />
                  {/* Bot Seat Header */}
                  <div className="relative z-10 flex items-start justify-between gap-2">
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
                        {' · '}
                        <span
                          className={`font-mono text-[10px] font-semibold ${
                            bot.intelligence === 'mastermind'
                              ? 'text-amber-300'
                              : bot.intelligence === 'competitive'
                              ? 'text-sky-200'
                              : bot.intelligence === 'novice'
                              ? 'text-emerald-200/80'
                              : 'text-emerald-200'
                          }`}
                        >
                          {getBotIntelligenceMeta(bot.intelligence).label} AI
                        </span>
                        {bot.liveMemory ? (
                          <>
                            {' · '}
                            <span className="font-mono text-[10px] text-sky-200">
                              IQ {bot.liveMemory.botIqScore}
                            </span>
                            {bot.liveMemory.grudgeScore >= 18 && (
                              <span className="font-mono text-[10px] text-amber-300">
                                {' · '}Aggro {bot.liveMemory.grudgeScore}
                              </span>
                            )}
                          </>
                        ) : null}
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

                    <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] tabular-nums text-emerald-100/90">
                      <span className="inline-flex items-center gap-1">
                        {isShufflingDeck && (
                          <Shuffle className="h-2.5 w-2.5 text-amber-300 animate-spin shrink-0" />
                        )}
                        Lib {bot.libraryCount}
                      </span>
                      <span className="text-emerald-300/40" aria-hidden="true">·</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setZoneModalTarget({ ownerId: bot.id, zone: 'graveyard' });
                        }}
                        title={`View ${bot.name}'s Graveyard`}
                        className="inline-flex items-center gap-1 rounded border border-[#287D64] bg-[#0B392C] px-1.5 py-0.5 text-[10px] font-semibold text-emerald-100 hover:border-sky-400 hover:text-white cursor-pointer transition-colors"
                      >
                        <Coins className="h-2.5 w-2.5 text-emerald-300" />
                        GY {Math.max(bot.graveyardCount || 0, (bot.graveyardCards || []).length)}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setZoneModalTarget({ ownerId: bot.id, zone: 'exile' });
                        }}
                        title={`View ${bot.name}'s Exile`}
                        className="inline-flex items-center gap-1 rounded border border-[#287D64] bg-[#0B392C] px-1.5 py-0.5 text-[10px] font-semibold text-violet-200 hover:border-violet-400 hover:text-white cursor-pointer transition-colors"
                      >
                        <Ban className="h-2.5 w-2.5 text-violet-300" />
                        Exile {Math.max(bot.exileCount || 0, (bot.exileCards || []).length)}
                      </button>
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

                  {/* Free-Form Bot Playmat Canvas (bots auto-position & move attackers, players can also drag bot cards) */}
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2 text-[10px]">
                      <span className="font-mono uppercase tracking-wider text-emerald-200/75 inline-flex items-center gap-1">
                        <Move className="h-2.5 w-2.5 text-emerald-300" />
                        Bot Playmat ({bot.creatures.length} cr · {bot.landsInPlay} lands)
                      </span>
                      {bot.creatures.length > 1 && onAutoArrangeBotPlaymat && (
                        <button
                          type="button"
                          onClick={() => onAutoArrangeBotPlaymat(bot.id)}
                          className="inline-flex items-center gap-1 rounded border border-[#287D64] bg-[#0B392C]/85 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-100 hover:bg-[#17614B] cursor-pointer whitespace-nowrap shrink-0"
                        >
                          <LayoutGrid className="h-2.5 w-2.5" />
                          Tidy
                        </button>
                      )}
                    </div>

                    <div
                      ref={(el) => {
                        botPlaymatRefs.current[bot.id] = el;
                      }}
                      className={`relative rounded-lg border border-[#247059]/80 bg-[#082B21]/65 overflow-hidden ${
                        bot.creatures.length > 0 ? 'min-h-[215px]' : 'min-h-[116px]'
                      }`}
                    >
                      {/* Backline Lands Strip */}
                      <div className="relative z-10 flex flex-wrap items-center justify-between gap-2 border-b border-dashed border-emerald-400/20 bg-black/20 px-2.5 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[9px] font-semibold uppercase text-emerald-200/70">
                            Lands:
                          </span>
                          {bot.landsInPlay === 0 ? (
                            <span className="text-[9px] text-emerald-200/50">None</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {Array.from({ length: Math.min(12, bot.landsInPlay) }).map((_, li) => (
                                <span
                                  key={li}
                                  className={`inline-block h-3 w-2.5 rounded-[2px] border transition-transform ${
                                    li < bot.tappedLands
                                      ? 'border-amber-300/45 bg-amber-950/60 rotate-12 opacity-65'
                                      : 'border-emerald-300/65 bg-emerald-700/55'
                                  }`}
                                />
                              ))}
                              {bot.landsInPlay > 12 && (
                                <span className="font-mono text-[9px] text-emerald-200">
                                  +{bot.landsInPlay - 12}
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        {allowsCommandZone && bot.commanderInZone && bot.commanderName && (
                          <button
                            type="button"
                            onClick={() => onInspectCard(bot.commanderName, bot.commanderMeta)}
                            className="inline-flex items-center gap-1 rounded border border-amber-400/60 bg-amber-950/60 px-1.5 py-0.5 text-[9px] font-semibold text-amber-200 hover:bg-amber-900/70 cursor-pointer whitespace-nowrap"
                          >
                            <Crown className="h-2.5 w-2.5 text-amber-300" />
                            <span>
                              CmdZ: {bot.commanderName} (MV {bot.commanderCmc + bot.commanderTax})
                            </span>
                          </button>
                        )}
                      </div>

                      {/* Subtle Combat Frontline Marker */}
                      <div className="pointer-events-none absolute inset-x-3 bottom-2 border-b border-dashed border-red-400/25 flex justify-end">
                        <span className="font-mono text-[8px] uppercase tracking-wider text-red-200/45 pr-1">
                          Combat Frontline
                        </span>
                      </div>

                      {bot.creatures.length === 0 ? (
                        <div className="flex h-[82px] items-center justify-center px-3 text-center text-[11px] text-emerald-200/65">
                          No creatures on battlefield
                        </div>
                      ) : (
                        bot.creatures.map((cr: LiveBotCreature, crIdx: number) => {
                          const kwTags = formatCreatureKeywordTags(cr);
                          const isDraggingThis =
                            pointerDragState?.kind === 'bot' &&
                            pointerDragState.botId === bot.id &&
                            pointerDragState.uid === cr.uid;
                          const fallbackSpot = computeOpenBotPlaymatSpot(
                            bot.creatures.slice(0, crIdx),
                            { preferFront: false }
                          );
                          const posX = isDraggingThis
                            ? pointerDragState.x
                            : typeof cr.playmatX === 'number'
                            ? cr.playmatX
                            : fallbackSpot.x;
                          const posY = isDraggingThis
                            ? pointerDragState.y
                            : typeof cr.playmatY === 'number'
                            ? cr.playmatY
                            : fallbackSpot.y;
                          const posZ = isDraggingThis
                            ? 60
                            : cr.playmatZ ?? crIdx + 2;

                          return (
                            <div
                              key={cr.uid}
                              style={{
                                left: `${posX}%`,
                                top: `${posY}%`,
                                zIndex: posZ,
                                transform: 'translate(-50%, -50%)',
                              }}
                              className={`absolute ${
                                isDraggingThis
                                  ? 'transition-none'
                                  : 'transition-[left,top] duration-200 ease-out'
                              }`}
                            >
                              <TableCardTile
                                name={cr.name}
                                meta={cr.meta}
                                onInspect={onInspectCard}
                                size="sm"
                                tapped={cr.tapped}
                                summoningSick={cr.summoningSick}
                                pointerDraggable={
                                  !botsAreActing &&
                                  !pendingIncomingAttack &&
                                  !isSimulationFinished &&
                                  Boolean(onMoveBotCard)
                                }
                                isPointerDragging={isDraggingThis}
                                suppressNextClickRef={suppressCardClickRef}
                                onPointerDownCard={(ev) =>
                                  startPlaymatPointerDrag(ev, {
                                    kind: 'bot',
                                    botId: bot.id,
                                    uid: cr.uid,
                                    name: cr.name,
                                    initialX: posX,
                                    initialY: posY,
                                    isCreature: true,
                                    isCommander: cr.isCommander,
                                    tapped: cr.tapped,
                                  })
                                }
                                cornerTag={
                                  cr.isCommander
                                    ? 'Cmdr'
                                    : cr.hasInfect
                                    ? 'Infect'
                                    : cr.flying
                                    ? 'Fly'
                                    : cr.deathtouch
                                    ? 'DT'
                                    : cr.trample
                                    ? 'Trample'
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
                                subLabel={
                                  kwTags.length > 0 ? kwTags.slice(0, 2).join(' · ') : 'Creature'
                                }
                              />
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* Last Action Summary & Real-Time Adaptation Read */}
                  <div className="space-y-1 text-[11px] text-emerald-100/85 border-t border-[#1A624D] pt-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
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
                    {bot.liveMemory?.lastAiThought && (
                      <div
                        className="truncate text-[10px] text-amber-200/95"
                        title={bot.liveMemory.lastAiThought}
                      >
                        <strong className="text-amber-300">
                          {bot.liveMemory.aiEngineLabel ? `${bot.liveMemory.aiEngineLabel}:` : 'AI Plan:'}
                        </strong>{' '}
                        {bot.liveMemory.lastAiThought}
                      </div>
                    )}
                    {bot.liveMemory?.lastAdaptationNote &&
                      (!bot.liveMemory.lastAiThought ||
                        !bot.liveMemory.lastAdaptationNote.includes(bot.liveMemory.lastAiThought)) && (
                      <div
                        className="truncate text-[10px] text-sky-200/90"
                        title={bot.liveMemory.lastAdaptationNote}
                      >
                        <strong className="text-sky-300">Learned:</strong>{' '}
                        {bot.liveMemory.lastAdaptationNote}
                      </div>
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
              const oppSeatNum = Math.min(4, idx + 2) as 2 | 3 | 4;
              const oppSeatSurface = resolveSeatPlaymatSurface(playmatPrefs, oppSeatNum);

              return (
                <div
                  key={opp.id}
                  data-tabletop-drop={`opp:${opp.id}`}
                  onClick={() => onSelectCombatTarget(opp.id)}
                  onDragOver={(e) => {
                    if (
                      dragSource?.zone === 'battlefield' &&
                      dragSource.isCreature &&
                      !dragSource.tapped
                    ) {
                      e.preventDefault();
                      setActiveDropZone(`opp:${opp.id}`);
                    }
                  }}
                  onDragLeave={() => {
                    if (activeDropZone === `opp:${opp.id}`) setActiveDropZone(null);
                  }}
                  onDrop={(e) => handleDropOnOpponentSeat(e, opp.id)}
                  className={`relative overflow-hidden rounded-xl border p-3.5 space-y-2.5 transition-colors cursor-pointer ${
                    isKO
                      ? 'border-red-400/45 bg-[#2A171C]/80 opacity-75'
                      : activeDropZone === `opp:${opp.id}`
                      ? 'border-red-400 bg-red-950/55 ring-2 ring-red-400'
                      : isSelected
                      ? oppSeatSurface.seatActiveClass
                      : oppSeatSurface.seatClass
                  }`}
                >
                  <PlaymatSurfaceBackdrop surface={oppSeatSurface} variant="seat" />
                  <div className="relative z-10 flex items-start justify-between gap-2">
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
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          setZoneModalTarget({ ownerId: opp.id, zone: 'graveyard' })
                        }
                        className="inline-flex items-center gap-1 rounded border border-[#287D64] bg-[#0F4C3A] px-1.5 py-0.5 text-[10px] font-semibold text-emerald-100 hover:border-sky-400 cursor-pointer"
                      >
                        <Coins className="h-2.5 w-2.5 text-emerald-300" />
                        GY 0
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setZoneModalTarget({ ownerId: opp.id, zone: 'exile' })
                        }
                        className="inline-flex items-center gap-1 rounded border border-[#287D64] bg-[#0F4C3A] px-1.5 py-0.5 text-[10px] font-semibold text-violet-200 hover:border-violet-400 cursor-pointer"
                      >
                        <Ban className="h-2.5 w-2.5 text-violet-300" />
                        Exile 0
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 3. Center Battlefront Bar: Interrupt/Response Alert + Interactive Spell Stack OR Incoming Blockers OR Sequential Bot Turn Banner OR Combat/Mana/Phase Command Strip */}
        {hasActiveStack && onCastStackResponse && onResolveStackTop && onResolveStackAll ? (
          <div className="space-y-2.5">
            {onToggleHoldInterrupt && onActivateAbility && (
              <InterruptResponseBanner
                theme="tabletop"
                stackItems={stackItems}
                handCards={hand}
                playerCreatures={battlefield
                  .filter((p) => p.isCreature)
                  .map((p) => {
                    const eff = getEffectivePermanentStats(p);
                    return {
                      uid: p.uid,
                      name: p.name,
                      power: eff.power,
                      toughness: eff.toughness,
                      isCommander: p.isCommander,
                      protectedUntilEot: p.protectedUntilEot,
                    };
                  })}
                liveBots={liveBots}
                activatedAbilities={activatedAbilities}
                totalAvailableMana={effectiveAvailableMana}
                untappedLandsCount={untappedLandsCount}
                hasCommanderInPlay={hasCommanderOnBoard}
                countdownMs={interruptCountdownMs}
                totalWindowMs={interruptTotalMs}
                isTimerHeld={interruptTimerHeld}
                windowMode={interruptWindowMode}
                onToggleHoldTimer={onToggleHoldInterrupt}
                onCastResponse={onCastStackResponse}
                onActivateAbility={onActivateAbility}
                onResolveTop={onResolveStackTop}
                onResolveAll={onResolveStackAll}
                onTapAllUntappedLands={onTapAllUntappedLands}
                onInspectCard={(name) => onInspectCard(name)}
              />
            )}
            <TabletopStackPanel
              theme="tabletop"
              stackItems={stackItems}
              handCards={hand}
              playerCreatures={battlefield
                .filter((p) => p.isCreature)
                .map((p) => {
                  const eff = getEffectivePermanentStats(p);
                  return {
                    uid: p.uid,
                    name: p.name,
                    power: eff.power,
                    toughness: eff.toughness,
                    isCommander: p.isCommander,
                    protectedUntilEot: p.protectedUntilEot,
                  };
                })}
              boardPermanents={battlefield.map((p) => ({
                uid: p.uid,
                name: p.name,
                typeLine: p.typeLine,
                isCreature: p.isCreature,
                isLand: p.isLand,
              }))}
              liveBots={liveBots}
              activatedAbilities={activatedAbilities}
              resolvedStackHistory={resolvedStackHistory}
              queueAllSpellsOnStack={queueAllSpellsOnStack}
              onToggleQueueAllSpellsOnStack={onToggleQueueAllSpellsOnStack}
              onReorderStackItem={onReorderStackItem}
              onQueueManualTrigger={onQueueManualTrigger}
              onClearResolvedHistory={onClearResolvedHistory}
              totalAvailableMana={effectiveAvailableMana}
              totalManaPool={totalManaPool}
              untappedLandsCount={untappedLandsCount}
              hasCommanderInPlay={hasCommanderOnBoard}
              onCastResponse={onCastStackResponse}
              onActivateAbility={onActivateAbility}
              onResolveTop={onResolveStackTop}
              onResolveAll={onResolveStackAll}
              onTapAllUntappedLands={onTapAllUntappedLands}
              onInspectCard={(name) => onInspectCard(name)}
            />
          </div>
        ) : pendingIncomingAttack ? (
          <div className="rounded-xl border-2 border-red-400 bg-[#2C1216]/95 p-4 space-y-3 shadow-lg">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2 text-xs font-bold text-red-100">
                  <Shield className="h-4 w-4 text-red-300 shrink-0" />
                  <span>
                    Incoming Attack from {pendingIncomingAttack.botName} — Assign Blockers or Respond at Instant Speed
                  </span>
                </div>
                {pendingIncomingAttack.adaptationReason && (
                  <div className="text-[11px] text-amber-200/90 pl-6">
                    Bot Read: {pendingIncomingAttack.adaptationReason}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {combatFogActive && (
                  <span className="rounded border border-emerald-400/70 bg-emerald-600/30 px-2 py-0.5 text-[11px] font-bold text-emerald-100">
                    Fog Active · 0 Combat Damage
                  </span>
                )}
                <span className="font-mono text-[11px] text-red-200 tabular-nums">
                  {untappedBlockers.length} untapped creature{untappedBlockers.length === 1 ? '' : 's'} ready
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {pendingIncomingAttack.attackers.map((atk) => {
                const assignedIds = Object.entries(blockerAssignments)
                  .filter(([, targetId]) => targetId === atk.uid)
                  .map(([blkId]) => blkId);
                const atkKwTags = formatCreatureKeywordTags(atk);
                const menaceIncomplete = atk.menace && assignedIds.length === 1;

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
                      cornerTag={atk.isCommander ? 'Cmdr ATK' : atk.flying ? 'Fly ATK' : 'ATK'}
                      cornerTone="red"
                      ptLabel={`${atk.power}/${atk.toughness}`}
                      subLabel={atkKwTags.length > 0 ? atkKwTags.slice(0, 2).join(' · ') : 'Attacker'}
                    />

                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="text-[11px] font-semibold text-red-100">
                        {combatFogActive
                          ? 'Combat damage prevented this turn (Fog active)'
                          : menaceIncomplete
                          ? 'Menace: assign 1 more blocker or attack goes unblocked!'
                          : assignedIds.length > 0
                          ? `Blocked by ${assignedIds.length} creature${assignedIds.length === 1 ? '' : 's'}${
                              atk.trample ? ' (Trample excess rolls over)' : ''
                            }`
                          : `Unblocked (${atk.power} ${atk.hasInfect ? 'poison' : 'combat dmg'}${
                              atk.lifelink ? ' · Lifelink' : ''
                            })`}
                      </div>
                      {atkKwTags.length > 0 && (
                        <div className="font-mono text-[10px] text-amber-200/90">
                          {atkKwTags.join(' · ')}
                        </div>
                      )}

                      {untappedBlockers.length === 0 ? (
                        <div className="text-[11px] text-red-200/75">
                          No untapped creatures available to block.
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {untappedBlockers.map((blk) => {
                            const isBlockingThis = blockerAssignments[blk.uid] === atk.uid;
                            const blkStats = getEffectivePermanentStats(blk);
                            const blkKw = extractCreatureKeywords(blk.meta);
                            const canLegallyBlock = !atk.flying || blkKw.flying || blkKw.reach;
                            return (
                              <button
                                key={blk.uid}
                                type="button"
                                disabled={!canLegallyBlock}
                                title={
                                  canLegallyBlock
                                    ? `Toggle ${blk.name} as blocker`
                                    : `${blk.name} cannot block ${atk.name} (Flying requires Flying or Reach)`
                                }
                                onClick={() => onToggleBlocker(blk.uid, atk.uid)}
                                className={`rounded border px-2 py-1 text-[11px] font-semibold transition-colors ${
                                  !canLegallyBlock
                                    ? 'border-zinc-700 bg-zinc-950/60 text-zinc-500 cursor-not-allowed opacity-55'
                                    : isBlockingThis
                                    ? 'border-sky-400 bg-sky-700 text-white cursor-pointer'
                                    : 'border-zinc-500/60 bg-zinc-900 text-zinc-200 hover:border-sky-400 cursor-pointer'
                                }`}
                              >
                                {isBlockingThis ? 'Blocking: ' : 'Block w/ '}
                                {blk.name} ({blkStats.power}/{blkStats.toughness})
                                {blk.protectedUntilEot ? ' [Indest.]' : ''}
                                {!canLegallyBlock ? ' [No Fly/Reach]' : ''}
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

            {/* Instant-Speed Combat Responses Strip (Removal on Attackers, Flash Blockers, Fog, Pump/Protection) */}
            {onCastCombatInstant && (() => {
              const combatInstants = hand
                .map((card) => {
                  const profile = classifyCardStackProfile(card.name, card.typeLine, card.meta);
                  if (!profile.isInstantSpeed || profile.mechanic === 'counterspell') return null;
                  const effectiveCost = getEffectiveInstantCost(
                    card.name,
                    card.cmc,
                    hasCommanderOnBoard,
                    profile
                  );
                  return {
                    card,
                    profile,
                    effectiveCost,
                    canAfford: effectiveCost <= effectiveAvailableMana,
                  };
                })
                .filter((x): x is NonNullable<typeof x> => Boolean(x));

              if (combatInstants.length === 0) return null;

              const defaultAtkUid =
                pendingIncomingAttack.attackers.some((a) => a.uid === combatInstantTargetAtkUid)
                  ? combatInstantTargetAtkUid
                  : pendingIncomingAttack.attackers[0]?.uid || '';
              const playerCreaturesList = battlefield.filter((p) => p.isCreature);
              const defaultBlkUid =
                playerCreaturesList.some((c) => c.uid === combatTrickTargetBlkUid)
                  ? combatTrickTargetBlkUid
                  : playerCreaturesList[0]?.uid || '';

              const hasTargetedRemoval = combatInstants.some(
                (i) =>
                  i.profile.mechanic === 'instant-removal' ||
                  i.profile.mechanic === 'burn-or-drain'
              );
              const hasTargetedBuff =
                playerCreaturesList.length > 0 &&
                combatInstants.some(
                  (i) =>
                    i.profile.mechanic === 'combat-trick' ||
                    (i.profile.mechanic === 'protection' && !i.profile.protectsWholeBoard)
                );

              return (
                <div className="rounded-lg border border-sky-400/40 bg-[#140B16]/90 p-2.5 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                    <div className="flex items-center gap-1.5 font-bold text-sky-200">
                      <Sparkles className="h-3.5 w-3.5 text-amber-300 shrink-0" />
                      <span>Instant-Speed Combat Responses</span>
                      <span className="font-mono text-[10px] text-sky-300/90 tabular-nums">
                        ({effectiveAvailableMana} mana open)
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {hasTargetedRemoval && pendingIncomingAttack.attackers.length > 1 && (
                        <label className="inline-flex items-center gap-1 text-[10px] text-red-200">
                          <span>Target Attacker:</span>
                          <select
                            value={defaultAtkUid}
                            onChange={(e) => setCombatInstantTargetAtkUid(e.target.value)}
                            className="rounded border border-red-400/50 bg-[#2C1216] px-1.5 py-0.5 text-[10px] text-white"
                          >
                            {pendingIncomingAttack.attackers.map((a) => (
                              <option key={a.uid} value={a.uid}>
                                {a.name} ({a.power}/{a.toughness})
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      {hasTargetedBuff && (
                        <label className="inline-flex items-center gap-1 text-[10px] text-emerald-200">
                          <span>Buff/Protect:</span>
                          <select
                            value={defaultBlkUid}
                            onChange={(e) => setCombatTrickTargetBlkUid(e.target.value)}
                            className="rounded border border-emerald-400/50 bg-[#0B392C] px-1.5 py-0.5 text-[10px] text-white"
                          >
                            {playerCreaturesList.map((c) => {
                              const eff = getEffectivePermanentStats(c);
                              return (
                                <option key={c.uid} value={c.uid}>
                                  {c.name} ({eff.power}/{eff.toughness})
                                </option>
                              );
                            })}
                          </select>
                        </label>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {combatInstants.map(({ card, profile, effectiveCost, canAfford }) => (
                      <button
                        key={card.uid}
                        type="button"
                        disabled={!canAfford}
                        title={
                          canAfford
                            ? profile.summaryHint
                            : `Needs ${effectiveCost} mana (${effectiveAvailableMana} open)`
                        }
                        onClick={() =>
                          onCastCombatInstant(
                            card.uid,
                            defaultAtkUid || undefined,
                            defaultBlkUid || undefined
                          )
                        }
                        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                          !canAfford
                            ? 'border-zinc-700 bg-zinc-900/60 text-zinc-500 cursor-not-allowed'
                            : 'border-sky-400/60 bg-sky-700/35 text-sky-100 hover:bg-sky-600/50 cursor-pointer'
                        }`}
                      >
                        <Flame className="h-3 w-3 text-amber-300 shrink-0" />
                        <span>{card.name}</span>
                        <span className="font-mono text-[10px] opacity-85">
                          ({effectiveCost === 0 && profile.freeWithCommander ? 'Free' : effectiveCost})
                        </span>
                        <span className="text-[10px] opacity-80">· {profile.mechanicLabel}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}

            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => onResolveIncomingAttack(true)}
                className="rounded-lg border border-red-300/60 bg-red-950/60 px-3 py-1.5 text-xs font-semibold text-red-100 hover:bg-red-900 cursor-pointer whitespace-nowrap shrink-0"
              >
                {combatFogActive ? 'Continue (0 Damage)' : 'Take All Unblocked'}
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
        ) : activeBotTurnBanner ? (
          <div className="rounded-xl border-2 border-amber-400/80 bg-[#0B392C]/95 p-3.5 space-y-2.5 shadow-md">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {!botStepAwaitingContinue && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-300 shrink-0" />
                )}
                <span className="font-mono font-bold text-amber-300">
                  Seat {activeBotTurnBanner.seatNumber}
                </span>
                <span className="font-bold text-white">
                  {activeBotTurnBanner.botName}&rsquo;s Turn
                </span>
                <span className="text-emerald-300/45" aria-hidden="true">·</span>
                <span className="font-mono text-[11px] tabular-nums text-emerald-200">
                  Bot {activeBotTurnBanner.queuePosition} of {activeBotTurnBanner.queueTotal}
                </span>
              </div>

              {onContinueNextBotTurn && (
                <button
                  type="button"
                  onClick={onContinueNextBotTurn}
                  className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-bold text-zinc-950 hover:bg-amber-400 cursor-pointer whitespace-nowrap shrink-0"
                >
                  {activeBotTurnBanner.isLastBotInRound
                    ? `Start Your Turn (T${turn + 1})`
                    : 'Next Bot Turn'}
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {activeBotTurnBanner.phaseSteps.length > 0 && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 text-[11px]">
                {activeBotTurnBanner.phaseSteps.map((step, i) => (
                  <div
                    key={`${step.phase}-${i}`}
                    className="rounded-lg border border-[#1E6E56] bg-[#0F4C3A]/85 px-2.5 py-1.5"
                  >
                    <div className="font-mono text-[10px] font-bold uppercase text-amber-300">
                      {step.phase}
                    </div>
                    <div className="mt-0.5 text-emerald-50/95 leading-snug">
                      {step.summary}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {activeBotTurnBanner.adaptationNote && (
              <div className="text-[11px] text-sky-200">
                <strong className="text-sky-300">Live Learning:</strong>{' '}
                {activeBotTurnBanner.adaptationNote}
              </div>
            )}
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
                      disabled={attackersCount === 0 || hasActiveStack}
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
                disabled={phaseIdx === 0 || botsAreActing || hasActiveStack || isSimulationFinished}
                className="inline-flex items-center gap-1 rounded-md border border-[#2A8469] bg-[#0F4C3A] px-2 py-1 text-[11px] font-medium text-emerald-100 hover:bg-[#176B53] disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
              >
                <ChevronLeft className="h-3 w-3" />
                Prev
              </button>
              <button
                type="button"
                onClick={onNextPhase}
                disabled={botsAreActing || hasActiveStack || isSimulationFinished}
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
                  disabled={botsAreActing || hasActiveStack || isSimulationFinished}
                  className="rounded-md border border-sky-400/50 bg-sky-950/60 px-2.5 py-1 text-[11px] font-semibold text-sky-200 hover:bg-sky-900 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
                >
                  Pass → Bots
                </button>
              )}
            </div>
          </div>
        )}

        {/* Always-Accessible Visual Stack & Trigger Resolution Queue Dock (shown when Stack is currently empty) */}
        {!hasActiveStack && onCastStackResponse && onResolveStackTop && onResolveStackAll && (
          <TabletopStackPanel
            theme="tabletop"
            stackItems={stackItems}
            handCards={hand}
            playerCreatures={battlefield
              .filter((p) => p.isCreature)
              .map((p) => {
                const eff = getEffectivePermanentStats(p);
                return {
                  uid: p.uid,
                  name: p.name,
                  power: eff.power,
                  toughness: eff.toughness,
                  isCommander: p.isCommander,
                  protectedUntilEot: p.protectedUntilEot,
                };
              })}
            boardPermanents={battlefield.map((p) => ({
              uid: p.uid,
              name: p.name,
              typeLine: p.typeLine,
              isCreature: p.isCreature,
              isLand: p.isLand,
            }))}
            liveBots={liveBots}
            activatedAbilities={activatedAbilities}
            resolvedStackHistory={resolvedStackHistory}
            queueAllSpellsOnStack={queueAllSpellsOnStack}
            onToggleQueueAllSpellsOnStack={onToggleQueueAllSpellsOnStack}
            onReorderStackItem={onReorderStackItem}
            onQueueManualTrigger={onQueueManualTrigger}
            onClearResolvedHistory={onClearResolvedHistory}
            totalAvailableMana={effectiveAvailableMana}
            totalManaPool={totalManaPool}
            untappedLandsCount={untappedLandsCount}
            hasCommanderInPlay={hasCommanderOnBoard}
            onCastResponse={onCastStackResponse}
            onActivateAbility={onActivateAbility}
            onResolveTop={onResolveStackTop}
            onResolveAll={onResolveStackAll}
            onTapAllUntappedLands={onTapAllUntappedLands}
            onInspectCard={(name) => onInspectCard(name)}
          />
        )}

        {/* 4. Bottom Player Playmat (Your Seat + Battlefield + Command/Library + Hand) */}
        <div
          className={`relative overflow-hidden rounded-xl border p-3.5 sm:p-4 space-y-3.5 transition-colors ${yourPlaymatSurface.seatClass}`}
        >
          <PlaymatSurfaceBackdrop surface={yourPlaymatSurface} variant="seat" />
          {/* Your Seat Bar */}
          <div
            className={`relative z-10 flex flex-wrap items-center justify-between gap-3 border-b pb-3 ${yourPlaymatSurface.dividerBorderClass}`}
          >
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
                  {isMonarch && (
                    <span className="inline-flex items-center gap-1 font-mono text-[10px] font-bold text-amber-300">
                      <Crown className="h-3 w-3" />
                      Monarch
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Life, Poison, Tokens & Counters Controls */}
            <div className="flex flex-wrap items-center gap-2.5 font-mono text-xs tabular-nums">
              {onCreateToken && (
                <button
                  type="button"
                  onClick={() => {
                    setShowTokenCreator((v) => !v);
                    setShowPlayerCounters(false);
                  }}
                  disabled={botsAreActing || Boolean(pendingIncomingAttack) || isSimulationFinished}
                  className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 font-sans text-[11px] font-semibold cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-40 transition-colors ${
                    showTokenCreator
                      ? 'border-amber-300 bg-amber-500 text-zinc-950'
                      : 'border-amber-300/50 bg-amber-950/50 text-amber-200 hover:bg-amber-900/60'
                  }`}
                >
                  <Sparkles className="h-3 w-3 shrink-0" />
                  + Token
                </button>
              )}

              {onAdjustPlayerCounter && (
                <button
                  type="button"
                  onClick={() => {
                    setShowPlayerCounters((v) => !v);
                    setShowTokenCreator(false);
                  }}
                  className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 font-sans text-[11px] font-semibold cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
                    showPlayerCounters
                      ? 'border-sky-300 bg-sky-600 text-white'
                      : 'border-sky-300/45 bg-sky-950/50 text-sky-200 hover:bg-sky-900/60'
                  }`}
                >
                  <Plus className="h-3 w-3 shrink-0" />
                  Counters
                </button>
              )}

              <div className="flex items-center gap-1 border-l border-[#20765C] pl-2.5">
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

              <div className="flex items-center gap-1.5 border-l border-[#20765C] pl-2.5">
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

          {/* Active Player Counters Strip (only shown when player has active Energy/XP/Storm/Custom counters) */}
          {activePlayerCounterEntries.length > 0 && onAdjustPlayerCounter && (
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono tabular-nums">
              {activePlayerCounterEntries.map(([label, val]) => (
                <div
                  key={label}
                  className="inline-flex items-center gap-1.5 rounded border border-sky-300/45 bg-[#0B392C]/90 px-2 py-0.5 text-sky-100"
                >
                  <span className="font-semibold text-sky-200">{label}:</span>
                  <button
                    type="button"
                    onClick={() => onAdjustPlayerCounter(label, -1)}
                    className="rounded bg-black/25 px-1 text-emerald-200 hover:text-white cursor-pointer"
                  >
                    -
                  </button>
                  <span className="font-bold text-white">{val}</span>
                  <button
                    type="button"
                    onClick={() => onAdjustPlayerCounter(label, 1)}
                    className="rounded bg-black/25 px-1 text-emerald-200 hover:text-white cursor-pointer"
                  >
                    +
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Inline Token Creator / Player Counters / Card Counter Editor Panels */}
          {showTokenCreator && onCreateToken && (
            <TokenCreatorPanel
              onCreateToken={(bp) => {
                onCreateToken(bp);
                setShowTokenCreator(false);
              }}
              onClose={() => setShowTokenCreator(false)}
            />
          )}

          {showPlayerCounters && onAdjustPlayerCounter && onToggleMonarch && (
            <PlayerCountersPanel
              playerCounters={playerCounters}
              isMonarch={isMonarch}
              onAdjustPlayerCounter={onAdjustPlayerCounter}
              onToggleMonarch={onToggleMonarch}
              onClose={() => setShowPlayerCounters(false)}
            />
          )}

          {editingCounterPerm && onAdjustPermanentCounter && (
            <PermanentCounterEditor
              permanentUid={editingCounterPerm.uid}
              permanentName={editingCounterPerm.name}
              isCreature={editingCounterPerm.isCreature}
              plusOneCounters={editingCounterPerm.plusOneCounters || 0}
              minusOneCounters={editingCounterPerm.minusOneCounters || 0}
              otherCounters={editingCounterPerm.otherCounters || {}}
              onAdjustCounter={onAdjustPermanentCounter}
              onClose={() => setEditingCounterUid(null)}
            />
          )}

          {/* Live Drag Guidance Bar (only visible while dragging a card) */}
          {(dragSource || pointerDragState) && (
            <div className="rounded-lg border border-amber-300/70 bg-amber-950/60 px-3 py-1.5 text-[11px] font-medium text-amber-100 flex flex-wrap items-center justify-between gap-2">
              <span>
                Dragging{' '}
                <strong className="text-white">
                  {pointerDragState ? pointerDragState.name : dragSource?.name}
                </strong>{' '}
                —{' '}
                {pointerDragState?.kind === 'bot'
                  ? 'move anywhere on the bot playmat to reposition.'
                  : pointerDragState?.kind === 'player'
                  ? pointerDragState.isCreature && !pointerDragState.tapped
                    ? 'slide anywhere on your playmat, or drop onto an Opponent Seat to attack, Hand, Graveyard, or Exile.'
                    : 'slide anywhere on your playmat, or drop onto Hand, Command Zone, Graveyard, or Exile.'
                  : dragSource?.zone === 'hand'
                  ? 'drop anywhere onto your Playmat to play/cast at that exact spot, or Graveyard/Exile.'
                  : dragSource?.zone === 'command'
                  ? 'drop anywhere onto your Playmat to cast your Commander at that exact spot.'
                  : dragSource?.zone === 'graveyard'
                  ? 'drop onto your Playmat to reanimate, Hand to return, or Exile.'
                  : 'drop onto your Playmat to cast/return, Hand to return, or Graveyard.'}
              </span>
            </div>
          )}

          {/* Board Grid: Left Deck/GY/Exile/Cmd Column + Right Permanents Lanes */}
          <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[224px_1fr]">
            {/* Left Side Piles: Library Deck Stack, Graveyard, Exile, Command Zone */}
            <div className="space-y-3">
              {/* Interactive Library Card Stack */}
              <div
                className={`rounded-lg border p-2.5 flex items-center justify-between gap-2 transition-colors ${
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
                  className="min-w-0 flex-1 text-left disabled:opacity-50 cursor-pointer transition-transform hover:-translate-y-0.5"
                >
                  <div className="flex items-center gap-1.5 text-[10px] font-bold text-amber-200">
                    <BookOpen className="h-3 w-3 shrink-0" />
                    <span>{isShufflingDeck ? 'Shuffling' : 'Library'}</span>
                  </div>

                  {isShufflingDeck ? (
                    <div className="mt-1 flex items-center py-0.5">
                      <DeckShuffleAnimation size="sm" theme="felt" />
                    </div>
                  ) : (
                    <div className="mt-0.5 flex items-baseline gap-2">
                      <span className="font-mono text-lg font-bold tabular-nums text-white">
                        {library.length}
                      </span>
                      <span className="text-[9px] text-amber-200/80">Click to Draw</span>
                    </div>
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
                    className="inline-flex items-center justify-center gap-1 rounded border border-amber-300/40 bg-zinc-950/65 px-2 py-1.5 text-[10px] font-semibold text-amber-200 hover:bg-zinc-900 hover:border-amber-300 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Shuffle className={`h-2.5 w-2.5 ${isShufflingDeck ? 'animate-spin' : ''}`} />
                    {isShufflingDeck ? '...' : 'Shuffle'}
                  </button>
                )}
              </div>

              {/* Interactive Graveyard & Exile Zones (click to open zone viewer modal, drag & drop supported) */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  data-tabletop-drop="graveyard"
                  draggable={Boolean(graveyard[0]) && !botsAreActing && !pendingIncomingAttack}
                  onDragStart={(e) => {
                    if (graveyard[0]) {
                      handleHidePreview();
                      beginDrag(e, {
                        zone: 'graveyard',
                        uid: graveyard[0].uid,
                        name: graveyard[0].name,
                      });
                    }
                  }}
                  onDragEnd={clearDragState}
                  onDragOver={(e) => {
                    if (
                      dragSource &&
                      (dragSource.zone === 'hand' ||
                        dragSource.zone === 'battlefield' ||
                        dragSource.zone === 'exile')
                    ) {
                      e.preventDefault();
                      setActiveDropZone('graveyard');
                    }
                  }}
                  onDragLeave={() => {
                    if (activeDropZone === 'graveyard') setActiveDropZone(null);
                  }}
                  onDrop={handleDropOnGraveyard}
                  onMouseEnter={(e) => {
                    if (!hoverZoomEnabled || !graveyard[0]) return;
                    handleShowPreview({
                      name: graveyard[0].name,
                      meta: graveyard[0].meta,
                      rect: buildHoverRect(e.currentTarget),
                      statusTags: ['Graveyard Top · Click pile to view all'],
                    });
                  }}
                  onMouseLeave={handleHidePreview}
                  onClick={() => {
                    handleHidePreview();
                    setZoneModalTarget({ ownerId: 'player', zone: 'graveyard' });
                  }}
                  title="Click to inspect & manage your Graveyard (or drop cards here)"
                  className={`rounded-lg border p-2.5 text-left flex flex-col justify-between transition-colors cursor-pointer ${
                    activeDropZone === 'graveyard'
                      ? 'border-red-400 bg-red-950/60 ring-2 ring-red-400'
                      : graveyard[0]
                      ? 'border-[#247059] bg-[#0B392C]/90 hover:border-emerald-400'
                      : 'border-[#247059] bg-[#0B392C]/90 hover:border-emerald-400/70'
                  }`}
                >
                  <div className="flex items-center justify-between text-[10px] font-bold text-emerald-200 w-full">
                    <span>Graveyard</span>
                    <Coins className="h-3 w-3 text-emerald-300 shrink-0" />
                  </div>
                  <div className="mt-1 font-mono text-lg font-bold tabular-nums text-white">
                    {graveyard.length}
                  </div>
                  <div className="truncate text-[9px] text-emerald-200/80 w-full">
                    {activeDropZone === 'graveyard'
                      ? 'Drop to GY'
                      : graveyard[0]
                      ? graveyard[0].name
                      : 'Click to open'}
                  </div>
                </button>

                <button
                  type="button"
                  data-tabletop-drop="exile"
                  draggable={Boolean(exile[0]) && !botsAreActing && !pendingIncomingAttack}
                  onDragStart={(e) => {
                    if (exile[0]) {
                      handleHidePreview();
                      beginDrag(e, {
                        zone: 'exile',
                        uid: exile[0].uid,
                        name: exile[0].name,
                      });
                    }
                  }}
                  onDragEnd={clearDragState}
                  onDragOver={(e) => {
                    if (
                      dragSource &&
                      (dragSource.zone === 'hand' ||
                        dragSource.zone === 'battlefield' ||
                        dragSource.zone === 'graveyard')
                    ) {
                      e.preventDefault();
                      setActiveDropZone('exile');
                    }
                  }}
                  onDragLeave={() => {
                    if (activeDropZone === 'exile') setActiveDropZone(null);
                  }}
                  onDrop={handleDropOnExile}
                  onMouseEnter={(e) => {
                    if (!hoverZoomEnabled || !exile[0]) return;
                    handleShowPreview({
                      name: exile[0].name,
                      meta: exile[0].meta,
                      rect: buildHoverRect(e.currentTarget),
                      statusTags: ['Exile Top · Click pile to view all'],
                    });
                  }}
                  onMouseLeave={handleHidePreview}
                  onClick={() => {
                    handleHidePreview();
                    setZoneModalTarget({ ownerId: 'player', zone: 'exile' });
                  }}
                  title="Click to inspect & manage your Exile pile (or drop cards here)"
                  className={`rounded-lg border p-2.5 text-left flex flex-col justify-between transition-colors cursor-pointer ${
                    activeDropZone === 'exile'
                      ? 'border-violet-400 bg-violet-950/70 ring-2 ring-violet-400'
                      : exile[0]
                      ? 'border-violet-400/50 bg-[#1B1733]/80 hover:border-violet-300'
                      : 'border-[#247059] bg-[#0B392C]/90 hover:border-violet-400/70'
                  }`}
                >
                  <div className="flex items-center justify-between text-[10px] font-bold text-violet-200 w-full">
                    <span>Exile</span>
                    <Ban className="h-3 w-3 text-violet-300 shrink-0" />
                  </div>
                  <div className="mt-1 font-mono text-lg font-bold tabular-nums text-white">
                    {exile.length}
                  </div>
                  <div className="truncate text-[9px] text-violet-200/80 w-full">
                    {activeDropZone === 'exile'
                      ? 'Drop to Exile'
                      : exile[0]
                      ? exile[0].name
                      : 'Click to open'}
                  </div>
                </button>
              </div>

              {/* Command Zone Cards (also acts as drop target to return Commander) */}
              {(allowsCommandZone &&
                (commandZone.length > 0 ||
                  (pointerDragState?.kind === 'player' && pointerDragState.isCommander) ||
                  (dragSource?.zone === 'battlefield' && dragSource.isCommander))) && (
                <div
                  data-tabletop-drop="command"
                  onDragOver={(e) => {
                    if (dragSource?.zone === 'battlefield' && dragSource.isCommander) {
                      e.preventDefault();
                      setActiveDropZone('command');
                    }
                  }}
                  onDragLeave={() => {
                    if (activeDropZone === 'command') setActiveDropZone(null);
                  }}
                  onDrop={handleDropOnCommandZone}
                  className={`rounded-lg border p-2.5 space-y-2 transition-colors ${
                    activeDropZone === 'command'
                      ? 'border-amber-400 bg-amber-950/55 ring-2 ring-amber-400'
                      : 'border-[#247059] bg-[#0B392C]/85'
                  }`}
                >
                  <div className="flex items-center justify-between text-[10px] font-bold text-amber-200">
                    <span>Command Zone</span>
                    <Crown className="h-3 w-3" />
                  </div>
                  {commandZone.length === 0 ? (
                    <div className="py-2 text-center text-[10px] text-amber-200/80">
                      Drop Commander here to return to Command Zone
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {commandZone.map((cmd) => {
                        const tax = commanderTaxByUid[cmd.uid] || 0;
                        const totalCost = cmd.cmc + tax;
                        const canCast = effectiveAvailableMana >= totalCost;
                        return (
                          <TableCardTile
                            key={cmd.uid}
                            name={cmd.name}
                            meta={cmd.meta}
                            onInspect={onInspectCard}
                            size="sm"
                            draggable={!botsAreActing && !pendingIncomingAttack && !hasActiveStack && !isSimulationFinished}
                            onDragStart={(e) =>
                              beginDrag(e, { zone: 'command', uid: cmd.uid, name: cmd.name })
                            }
                            onDragEnd={clearDragState}
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
                  )}
                </div>
              )}
            </div>

            {/* Unified Free-Form Playmat Canvas: Drag & Place Any Card Anywhere */}
            <div className="space-y-2.5 min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-100">
                    <Move className="h-3.5 w-3.5 text-emerald-300 shrink-0" />
                    <span>
                      Playmat Surface ({creaturesAndOther.length} permanents · {landsAndRocks.length} lands/mana)
                    </span>
                  </span>
                  <span className="font-mono text-[10px] tabular-nums text-emerald-200/90">
                    · {untappedLandsCount}/{totalLandsInPlay} untapped lands ({totalAvailableMana} mana ready)
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setShowPlaymatGuides((v) => !v)}
                    className={`rounded border px-2 py-0.5 font-sans text-[10px] font-semibold cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
                      showPlaymatGuides
                        ? 'border-emerald-300/60 bg-emerald-900/60 text-emerald-100'
                        : 'border-[#287D64] bg-[#0B392C] text-emerald-200/75 hover:text-white'
                    }`}
                  >
                    {showPlaymatGuides ? 'Zone Guides: On' : 'Zone Guides: Off'}
                  </button>
                  {onAutoArrangePlaymat && battlefield.length > 0 && (
                    <button
                      type="button"
                      onClick={onAutoArrangePlaymat}
                      disabled={botsAreActing || Boolean(pendingIncomingAttack)}
                      className="inline-flex items-center gap-1 rounded border border-sky-300/50 bg-[#0F2C38]/80 px-2 py-0.5 font-sans text-[10px] font-semibold text-sky-100 hover:bg-sky-900/60 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <LayoutGrid className="h-3 w-3 shrink-0" />
                      <span>Tidy Board</span>
                    </button>
                  )}
                </div>
              </div>

              <div
                ref={playerPlaymatRef}
                onDragOver={(e) => {
                  if (
                    dragSource &&
                    (dragSource.zone === 'hand' ||
                      dragSource.zone === 'command' ||
                      dragSource.zone === 'graveyard' ||
                      dragSource.zone === 'exile')
                  ) {
                    e.preventDefault();
                    setActiveDropZone('creatures');
                  }
                }}
                onDragLeave={() => {
                  if (activeDropZone === 'creatures') setActiveDropZone(null);
                }}
                onDrop={handleDropOnPlaymatCanvas}
                className={`relative rounded-xl border min-h-[410px] sm:min-h-[440px] overflow-hidden transition-colors ${
                  activeDropZone === 'creatures'
                    ? 'border-sky-400 bg-sky-950/35 ring-2 ring-sky-400/80'
                    : 'border-[#247059] bg-[#082E23]/60'
                }`}
              >
                {/* Optional Frontline / Backline Felt Divider */}
                {showPlaymatGuides && (
                  <>
                    <div className="pointer-events-none absolute inset-x-4 top-2.5 flex items-center justify-between text-[9px] font-mono uppercase tracking-wider text-emerald-200/45">
                      <span>Frontline · Creatures &amp; Nonland Permanents</span>
                      <span>Drag any card freely anywhere</span>
                    </div>
                    <div className="pointer-events-none absolute inset-x-4 top-[56%] border-t border-dashed border-emerald-300/20 pt-1 flex items-center justify-between text-[9px] font-mono uppercase tracking-wider text-emerald-200/40">
                      <span>Backline · Lands &amp; Mana Sources</span>
                      {activePhase === 'Combat' && (
                        <span className="text-red-300/75">
                          Drag creatures onto an opponent seat to attack
                        </span>
                      )}
                    </div>
                  </>
                )}

                {battlefield.length === 0 ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center pointer-events-none">
                    <Move className="h-6 w-6 text-emerald-300/50 mb-2" />
                    <p className="text-xs font-semibold text-emerald-100/85">
                      {activeDropZone === 'creatures'
                        ? 'Release to place card right here on your Playmat!'
                        : 'Free-Form Tabletop Playmat'}
                    </p>
                    <p className="mt-1 max-w-md text-[11px] text-emerald-200/65">
                      Drag cards from your Hand, Command Zone, Graveyard, or Exile onto any spot, or drag permanents anywhere on the mat to arrange your board.
                    </p>
                  </div>
                ) : (
                  battlefield.map((perm, idx) => {
                    const isLandOrRock = isBacklinePlaymatCard(perm);
                    const isDraggingThis =
                      pointerDragState?.kind === 'player' &&
                      pointerDragState.uid === perm.uid;
                    const fallbackSpot = computeOpenPlayerPlaymatSpot(
                      battlefield.slice(0, idx),
                      isLandOrRock
                    );
                    const posX = isDraggingThis
                      ? pointerDragState.x
                      : typeof perm.playmatX === 'number'
                      ? perm.playmatX
                      : fallbackSpot.x;
                    const posY = isDraggingThis
                      ? pointerDragState.y
                      : typeof perm.playmatY === 'number'
                      ? perm.playmatY
                      : fallbackSpot.y;
                    const posZ = isDraggingThis ? 90 : perm.playmatZ ?? idx + 2;

                    const stats = getEffectivePermanentStats(perm);
                    const counterChips = formatPermanentCounterChips(perm);
                    const permKw = extractCreatureKeywords(perm.meta);
                    const kwTags = perm.isCreature
                      ? formatCreatureKeywordTags({
                          ...permKw,
                          hasInfect: perm.hasInfect,
                          toxicValue: perm.toxicValue,
                        })
                      : [];

                    const tokenPrimary =
                      perm.tokenAbility === 'treasure'
                        ? {
                            label: 'Sac +1 Mana',
                            onClick: () => onActivateTokenAbility?.(perm),
                            tone: 'amber' as const,
                          }
                        : perm.tokenAbility === 'food'
                        ? {
                            label: 'Sac +3 HP',
                            onClick: () => onActivateTokenAbility?.(perm),
                            tone: 'emerald' as const,
                          }
                        : perm.tokenAbility === 'clue' || perm.tokenAbility === 'blood'
                        ? {
                            label: 'Sac Draw',
                            onClick: () => onActivateTokenAbility?.(perm),
                            tone: 'sky' as const,
                          }
                        : null;

                    return (
                      <div
                        key={perm.uid}
                        style={{
                          left: `${posX}%`,
                          top: `${posY}%`,
                          zIndex: posZ,
                          transform: 'translate(-50%, -50%)',
                        }}
                        className={`absolute ${
                          isDraggingThis
                            ? 'transition-none'
                            : 'transition-[left,top] duration-150 ease-out'
                        }`}
                      >
                        <TableCardTile
                          name={perm.name}
                          meta={perm.meta}
                          onInspect={onInspectCard}
                          size={isLandOrRock ? 'sm' : 'md'}
                          tapped={perm.tapped}
                          attacking={perm.attacking}
                          summoningSick={perm.summoningSick}
                          pointerDraggable={
                            !botsAreActing &&
                            !pendingIncomingAttack &&
                            !isSimulationFinished
                          }
                          isPointerDragging={isDraggingThis}
                          suppressNextClickRef={suppressCardClickRef}
                          onPointerDownCard={(ev) =>
                            startPlaymatPointerDrag(ev, {
                              kind: 'player',
                              uid: perm.uid,
                              name: perm.name,
                              initialX: posX,
                              initialY: posY,
                              isCreature: perm.isCreature,
                              isCommander: perm.isCommander,
                              tapped: perm.tapped,
                            })
                          }
                          cornerTag={
                            perm.attacking
                              ? 'ATK'
                              : perm.isCommander
                              ? 'Cmdr'
                              : perm.isToken
                              ? 'Token'
                              : undefined
                          }
                          cornerTone={
                            perm.attacking ? 'red' : perm.isToken ? 'sky' : 'amber'
                          }
                          ptLabel={perm.isCreature ? `${stats.power}/${stats.toughness}` : null}
                          subLabel={
                            isLandOrRock
                              ? perm.producedMana.slice(0, 2).join('/') || 'Mana'
                              : kwTags.length > 0
                              ? kwTags.slice(0, 2).join(' · ')
                              : perm.isToken
                              ? perm.isCreature
                                ? 'Token Creature'
                                : 'Token'
                              : undefined
                          }
                          counterChips={counterChips}
                          onTileClick={
                            isLandOrRock ? () => onTogglePermanentTap(perm) : undefined
                          }
                          primaryAction={
                            tokenPrimary
                              ? tokenPrimary
                              : isLandOrRock
                              ? {
                                  label: perm.tapped
                                    ? 'Untap'
                                    : `+${perm.producedMana[0] || 'C'}`,
                                  onClick: () => onTogglePermanentTap(perm),
                                  tone: perm.tapped ? 'zinc' : 'emerald',
                                }
                              : activePhase === 'Combat' &&
                                perm.isCreature &&
                                !perm.tapped &&
                                (perm.attacking ||
                                  (!permKw.defender && (!perm.summoningSick || permKw.haste)))
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
                          counterAction={
                            onAdjustPermanentCounter
                              ? {
                                  active: editingCounterUid === perm.uid,
                                  onClick: () =>
                                    setEditingCounterUid((cur) =>
                                      cur === perm.uid ? null : perm.uid
                                    ),
                                }
                              : undefined
                          }
                          secondaryAction={
                            perm.isCommander
                              ? {
                                  label: 'CmdZ',
                                  onClick: () => onReturnCommanderToZone(perm),
                                  tone: 'zinc',
                                }
                              : {
                                  label: perm.isToken ? 'Del' : 'GY',
                                  onClick: () => onMovePermanentToGy(perm),
                                  tone: isLandOrRock ? 'zinc' : 'red',
                                }
                          }
                        />
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* 5. Bottom Hand Tray (also acts as drop target to bounce permanents or return from GY) */}
          <div
            data-tabletop-drop="hand"
            onDragOver={(e) => {
              if (
                dragSource &&
                (dragSource.zone === 'battlefield' ||
                  dragSource.zone === 'graveyard' ||
                  dragSource.zone === 'exile')
              ) {
                e.preventDefault();
                setActiveDropZone('hand');
              }
            }}
            onDragLeave={() => {
              if (activeDropZone === 'hand') setActiveDropZone(null);
            }}
            onDrop={handleDropOnHand}
            className={`rounded-lg border p-3 space-y-2.5 transition-colors ${
              activeDropZone === 'hand'
                ? 'border-sky-400 bg-sky-950/50 ring-2 ring-sky-400/75'
                : 'border-[#247059] bg-[#0B392C]/90'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 font-bold text-white">
                <RotateCcw className="h-3.5 w-3.5 text-amber-300 shrink-0" />
                <span>Your Hand ({hand.length} cards)</span>
                {activeDropZone === 'hand' && (
                  <span className="font-mono text-[10px] text-sky-300">
                    Drop to return to Hand
                  </span>
                )}
              </div>
              <span className="font-mono text-[11px] tabular-nums text-emerald-200">
                Available Mana: {effectiveAvailableMana} ({totalManaPool} pool + {untappedLandsCount} lands)
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
                  const canAutoPay = !card.isLand && effectiveAvailableMana >= card.cmc;
                  const playableKind: 'land' | 'spell' | 'none' = card.isLand
                    ? landsPlayedThisTurn === 0
                      ? 'land'
                      : 'none'
                    : canAutoPay
                    ? 'spell'
                    : 'none';

                  const stackProfile = classifyCardStackProfile(
                    card.name,
                    card.typeLine,
                    card.meta
                  );

                  return (
                    <TableCardTile
                      key={card.uid}
                      name={card.name}
                      meta={card.meta}
                      onInspect={onInspectCard}
                      size="md"
                      draggable={
                        !botsAreActing &&
                        !pendingIncomingAttack &&
                        !hasActiveStack &&
                        !isSimulationFinished
                      }
                      onDragStart={(e) =>
                        beginDrag(e, {
                          zone: 'hand',
                          uid: card.uid,
                          name: card.name,
                          isLand: card.isLand,
                        })
                      }
                      onDragEnd={clearDragState}
                      playable={playableKind}
                      newlyDrawn={isNewlyDrawn}
                      cornerTag={
                        isNewlyDrawn
                          ? 'Drew'
                          : card.isLand
                          ? 'Land'
                          : stackProfile.isInstantSpeed
                          ? stackProfile.mechanic === 'counterspell'
                            ? 'Counter'
                            : 'Instant'
                          : undefined
                      }
                      cornerTone={
                        isNewlyDrawn
                          ? 'amber'
                          : card.isLand
                          ? 'emerald'
                          : 'sky'
                      }
                      primaryAction={
                        card.isLand
                          ? {
                              label: landsPlayedThisTurn === 0 ? 'Play Land' : 'Extra Land',
                              onClick: () => onPlayLand(card),
                              disabled:
                                botsAreActing ||
                                Boolean(pendingIncomingAttack) ||
                                hasActiveStack,
                              tone: landsPlayedThisTurn === 0 ? 'emerald' : 'zinc',
                            }
                          : {
                              label: `Cast (${card.cmc})`,
                              onClick: () => onCastFromHand(card),
                              disabled:
                                !canAutoPay ||
                                botsAreActing ||
                                Boolean(pendingIncomingAttack) ||
                                hasActiveStack,
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
    <ZoneViewerModal
      isOpen={Boolean(zoneModalTarget)}
      onClose={() => setZoneModalTarget(null)}
      initialOwnerId={zoneModalTarget?.ownerId || 'player'}
      initialZone={zoneModalTarget?.zone || 'graveyard'}
      playerName={deckName || 'Your Deck'}
      playerGraveyard={graveyard}
      playerExile={exile}
      liveBotMode={liveBotMode}
      liveBots={liveBots}
      soloOpponents={opponentTrackers}
      botsAreActing={botsAreActing}
      hasActiveStack={hasActiveStack}
      pendingIncomingAttack={Boolean(pendingIncomingAttack)}
      onInspectCard={onInspectCard}
      onMovePlayerZoneCard={onMovePlayerZoneCard}
    />
    <CardHoverZoomOverlay
      preview={hoveredCard}
      enabled={hoverZoomEnabled}
      onDismiss={handleHidePreview}
    />
    <TabletopPlaymatCustomizerModal
      isOpen={showPlaymatCustomizer}
      onClose={() => setShowPlaymatCustomizer(false)}
      preferences={playmatPrefs}
      onChangePreferences={setPlaymatPrefs}
      seatLabels={[
        `Seat 1 (You · ${deckName || 'Your Deck'})`,
        liveBotMode
          ? liveBots[0]?.name && `Seat 2 (${liveBots[0].name})`
          : opponentTrackers[0]?.name && `Seat 2 (${opponentTrackers[0].name})`,
        liveBotMode
          ? liveBots[1]?.name && `Seat 3 (${liveBots[1].name})`
          : opponentTrackers[1]?.name && `Seat 3 (${opponentTrackers[1].name})`,
        liveBotMode
          ? liveBots[2]?.name && `Seat 4 (${liveBots[2].name})`
          : opponentTrackers[2]?.name && `Seat 4 (${opponentTrackers[2].name})`,
      ]}
    />
    <CustomCardProxyTokenModal
      isOpen={showCustomCardStudio}
      onClose={() => setShowCustomCardStudio(false)}
      preferences={customCardPrefs}
      onChangePreferences={setCustomCardPrefs}
      deckCardNames={allTableCardNames}
      onSpawnTokenOnBattlefield={
        onCreateToken && !isSimulationFinished
          ? (token) => {
              onCreateToken({
                name: token.name,
                kind: token.kind,
                power: token.power,
                toughness: token.toughness,
                quantity: token.quantity,
                keywords: token.keywords,
                tokenAbility: token.tokenAbility,
              });
            }
          : undefined
      }
    />
    </TabletopHoverContext.Provider>
  );
};
