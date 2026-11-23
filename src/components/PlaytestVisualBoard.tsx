import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Crown,
  EyeOff,
  Flame,
  Layers,
  Mountain,
  Palette,
  Pause,
  Play,
  RotateCcw,
  Shield,
  Skull,
  Sparkles,
  Swords,
  ZoomIn,
} from 'lucide-react';
import type {
  CardMetadata,
  PlaytestBotPlay,
  PlaytestResult,
  PlaytestRound,
  PlayerRoundCombatStats,
} from '../types/deck';
import { getBotIndignanceMeta } from '../utils/botIndignance';
import { getCreatureRosterForArchetype } from '../utils/liveBotEngine';
import {
  buildHoverRect,
  CardHoverZoomOverlay,
  loadHoverZoomPreference,
  saveHoverZoomPreference,
  type HoveredCardPreview,
} from './CardHoverZoomOverlay';
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
import { resolveCardWithCustomProxy } from '../utils/customCardProxiesAndTokens';

interface PlaytestVisualBoardProps {
  result: PlaytestResult;
  activeRoundIdx: number;
  onSelectRound: (idx: number) => void;
  deckName: string;
  commanderNames: string[];
  usesCommanderDamage21?: boolean;
  findMeta: (name: string) => CardMetadata | null;
  onInspectCard: (name: string, meta?: CardMetadata | null) => void;
  onHideBoard?: () => void;
  embedded?: boolean;
  onSwitchToLivePlay?: () => void;
}

type TurnFocus = 'all' | 'you' | number;
type PlaybackSpeed = 1800 | 1100 | 650;

interface BoardCardTileProps {
  name: string;
  meta: CardMetadata | null;
  onInspect: (name: string, meta?: CardMetadata | null) => void;
  badge?: string;
  highlight?: 'new' | 'drawn' | 'commander' | 'threat' | 'none';
  compact?: boolean;
  isToken?: boolean;
  subtitle?: string;
  animateDraw?: boolean;
}

function isLikelyLand(name: string, meta: CardMetadata | null): boolean {
  if (meta) return meta.isLand;
  return /\b(plains|island|swamp|mountain|forest|wastes|command tower|exotic orchard|evolving wilds|terramorphic expanse|temple|shrine|fountain|tomb|foundry|pool|grounds|crypt|vents|garden|sanctuary|citadel|triome|path|marsh|mire|delta|strand|heath|foothills|mesa|tarn|catacombs|rainforest|flats)\b/i.test(
    name
  );
}

function isInstantOrSorcery(meta: CardMetadata | null): boolean {
  if (!meta?.typeLine) return false;
  return /\b(instant|sorcery)\b/i.test(meta.typeLine) && !/\bcreature|artifact|enchantment|planeswalker|land\b/i.test(meta.typeLine);
}

function isCreatureCard(name: string, meta: CardMetadata | null): boolean {
  if (meta?.typeLine) return /\bcreature\b/i.test(meta.typeLine);
  return !isLikelyLand(name, meta) && !/\b(sol ring|signet|talisman|lightning|counterspell|swords to plowshares|path to exile|cultivate|kodama|wrath|damnation|rampant)\b/i.test(name);
}

const ReplayCardBackFan: React.FC<{ count: number }> = ({ count }) => {
  const visible = Math.max(0, Math.min(6, count));
  const extra = Math.max(0, count - visible);
  if (count <= 0) {
    return <span className="font-mono text-[10px] text-emerald-200/75">0 Hand</span>;
  }
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center -space-x-2">
        {Array.from({ length: visible }).map((_, i) => (
          <div
            key={i}
            style={{ transform: `rotate(${(i - (visible - 1) / 2) * 3}deg)` }}
            className="h-6 w-4 rounded-[2px] border border-amber-300/60 bg-gradient-to-br from-sky-950 via-zinc-900 to-amber-950 shadow-sm"
          />
        ))}
      </div>
      <span className="font-mono text-[10px] font-semibold tabular-nums text-emerald-100">
        {extra > 0 ? `+${extra} (${count})` : `${count}H`}
      </span>
    </div>
  );
};

interface VisualBoardHoverContextValue {
  enabled: boolean;
  showPreview: (preview: HoveredCardPreview) => void;
  hidePreview: () => void;
}

const VisualBoardHoverContext = createContext<VisualBoardHoverContextValue>({
  enabled: true,
  showPreview: () => {},
  hidePreview: () => {},
});

const BoardCardTile: React.FC<BoardCardTileProps> = ({
  name,
  meta,
  onInspect,
  badge,
  highlight = 'none',
  compact = false,
  isToken = false,
  subtitle,
  animateDraw = false,
}) => {
  const [imgFailed, setImgFailed] = useState(false);
  const { enabled: hoverZoomEnabled, showPreview, hidePreview } = useContext(
    VisualBoardHoverContext
  );

  const borderClass =
    highlight === 'new'
      ? 'border-sky-500 ring-1 ring-sky-500/40'
      : highlight === 'drawn'
      ? 'border-amber-400 ring-1 ring-amber-400/40'
      : highlight === 'commander'
      ? 'border-amber-300'
      : highlight === 'threat'
      ? 'border-red-300'
      : 'border-zinc-200 hover:border-sky-500';

  const sizeClass = compact ? 'w-[74px]' : 'w-[86px]';
  const artHeightClass = compact ? 'h-[58px]' : 'h-[68px]';

  if (isToken) {
    return (
      <div
        className={`${sizeClass} shrink-0 rounded-lg border border-zinc-200 bg-zinc-50 p-1.5 flex flex-col justify-between text-left select-none`}
      >
        <div className={`${artHeightClass} rounded border border-zinc-200 bg-zinc-100 flex flex-col items-center justify-center gap-1 text-zinc-500`}>
          {subtitle === 'Land' ? (
            <Mountain className="h-4 w-4 text-emerald-700" />
          ) : (
            <Swords className="h-4 w-4 text-sky-700" />
          )}
          <span className="font-mono text-[9px] font-semibold uppercase tracking-wide">
            {subtitle || 'Permanent'}
          </span>
        </div>
        <div className="mt-1 truncate text-[10px] font-semibold text-zinc-700">
          {name}
        </div>
      </div>
    );
  }

  const resolvedCustom = resolveCardWithCustomProxy(name, meta);
  const effectiveMeta = resolvedCustom.meta || meta;

  useEffect(() => {
    setImgFailed(false);
  }, [name, effectiveMeta?.imageUri]);

  const ptLabel =
    effectiveMeta?.power && effectiveMeta?.toughness
      ? `${effectiveMeta.power}/${effectiveMeta.toughness}`
      : null;
  const typeSummary = effectiveMeta?.isLand
    ? 'Land'
    : effectiveMeta?.typeLine
    ? effectiveMeta.typeLine.split('—')[0].trim()
    : subtitle || 'Spell';

  const handleMouseEnter = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!hoverZoomEnabled) return;
    const tags: string[] = [];
    if (badge) tags.push(badge);
    if (highlight === 'commander' && badge !== 'Cmdr') tags.push('Commander');
    showPreview({
      name: resolvedCustom.displayTitle || name,
      meta: effectiveMeta,
      rect: buildHoverRect(e.currentTarget),
      ptLabel: ptLabel || (subtitle && /^\d+\/\d+$/.test(subtitle) ? subtitle : null),
      statusTags: tags,
    });
  };

  return (
    <button
      type="button"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={hidePreview}
      onClick={() => {
        hidePreview();
        onInspect(name, effectiveMeta);
      }}
      title={`Inspect ${name}${effectiveMeta?.manaCost ? ` (${effectiveMeta.manaCost})` : ''}`}
      className={`${sizeClass} relative shrink-0 rounded-lg border bg-white p-1.5 text-left transition-all duration-150 hover:-translate-y-0.5 cursor-pointer group ${borderClass} ${
        animateDraw ? 'animate-card-draw-slide' : ''
      } ${hoverZoomEnabled ? 'hover:z-20 hover:scale-[1.07] hover:shadow-lg' : ''}`}
    >
      <div className={`relative ${artHeightClass} w-full overflow-hidden rounded border border-zinc-200 bg-zinc-100`}>
        {effectiveMeta?.imageUri && !imgFailed ? (
          <img
            src={effectiveMeta.imageUri}
            alt={name}
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className="h-full w-full object-cover object-top"
          />
        ) : (
          <div className="h-full w-full flex flex-col items-center justify-center px-1 text-center bg-zinc-100">
            {highlight === 'commander' ? (
              <Crown className="h-3.5 w-3.5 text-amber-700 mb-0.5" />
            ) : meta?.isLand ? (
              <Mountain className="h-3.5 w-3.5 text-emerald-700 mb-0.5" />
            ) : (
              <Sparkles className="h-3.5 w-3.5 text-sky-700 mb-0.5" />
            )}
            <span className="line-clamp-2 text-[9px] font-medium leading-tight text-zinc-600">
              {typeSummary}
            </span>
          </div>
        )}

        {badge && (
          <span
            className={`absolute top-0.5 left-0.5 rounded px-1 py-0.5 font-mono text-[8px] font-bold uppercase leading-none ${
              highlight === 'drawn'
                ? 'bg-amber-50 text-amber-900 border border-amber-300'
                : highlight === 'commander'
                ? 'bg-zinc-900 text-amber-700 border border-amber-300'
                : 'bg-sky-700 text-white'
            }`}
          >
            {badge}
          </span>
        )}

        {ptLabel && (
          <span className="absolute bottom-0.5 right-0.5 rounded bg-zinc-900/90 px-1 py-0.5 font-mono text-[9px] font-bold text-white leading-none">
            {ptLabel}
          </span>
        )}
      </div>

      <div className="mt-1 space-y-0.5">
        <div className="truncate text-[10px] font-semibold text-zinc-900 group-hover:text-sky-700">
          {name}
        </div>
        <div className="flex items-center justify-between gap-1 font-mono text-[9px] text-zinc-500">
          <span className="truncate">{meta?.manaCost || (meta?.isLand ? 'Land' : '—')}</span>
          {typeof meta?.cmc === 'number' && !meta.isLand && (
            <span className="shrink-0">{meta.cmc}</span>
          )}
        </div>
      </div>
    </button>
  );
};

function getParticipantStat(
  round: PlaytestRound,
  playerName: string
): PlayerRoundCombatStats | null {
  const target = playerName.trim().toLowerCase();
  const found = (round.participantStats || []).find(
    (p) => (p.player || '').trim().toLowerCase() === target
  );
  if (found) return found;
  const lt = (round.lifeTotals || []).find(
    (l) => (l.player || '').trim().toLowerCase() === target
  );
  if (!lt) return null;
  return {
    player: lt.player,
    life: lt.life,
    lifeDelta: 0,
    poisonCounters: 0,
    poisonDelta: 0,
    commanderDamageTaken: [],
    maxCommanderDamage: 0,
    libraryRemaining: target === 'you' ? round.libraryRemaining ?? 0 : 0,
    cardsMilledTotal: target === 'you' ? round.cardsMilledToYou ?? 0 : 0,
    cardsMilledThisRound: 0,
    graveyardCount: target === 'you' ? round.graveyardCount ?? 0 : 0,
    handSize: target === 'you' ? (round.handSnapshot || []).length : 0,
    landsInPlay: target === 'you' ? round.landsInPlay ?? 0 : 0,
    manaAvailable: target === 'you' ? round.manaAvailable ?? 0 : 0,
    creaturesInPlay: target === 'you' ? round.playerStats?.creaturesOnBoard ?? 0 : 0,
    eliminatedBy: null,
  };
}

export const PlaytestVisualBoard: React.FC<PlaytestVisualBoardProps> = ({
  result,
  activeRoundIdx,
  onSelectRound,
  deckName,
  commanderNames,
  usesCommanderDamage21 = true,
  findMeta,
  onInspectCard,
  onHideBoard,
  embedded = false,
  onSwitchToLivePlay,
}) => {
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>(1100);
  const [turnFocus, setTurnFocus] = useState<TurnFocus>('all');
  const [hoverZoomEnabled, setHoverZoomEnabled] = useState<boolean>(() =>
    loadHoverZoomPreference()
  );
  const [hoveredCard, setHoveredCard] = useState<HoveredCardPreview | null>(null);
  const [playmatPrefs, setPlaymatPrefs] = useState<TabletopPlaymatPreferences>(() =>
    loadTabletopPlaymatPreferences()
  );
  const [showPlaymatCustomizer, setShowPlaymatCustomizer] = useState(false);

  useEffect(() => {
    const handleSync = () => {
      setPlaymatPrefs(loadTabletopPlaymatPreferences());
    };
    window.addEventListener(PLAYMAT_THEME_UPDATED_EVENT, handleSync);
    return () => window.removeEventListener(PLAYMAT_THEME_UPDATED_EVENT, handleSync);
  }, []);

  const tabletopSurface = resolveTabletopSurface(playmatPrefs);

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

  const rounds = useMemo(
    () => (Array.isArray(result.rounds) ? result.rounds : []),
    [result.rounds]
  );
  const activeRound = rounds[activeRoundIdx] || null;

  useEffect(() => {
    setIsAutoPlaying(false);
    setTurnFocus('all');
  }, [result]);

  useEffect(() => {
    if (!isAutoPlaying || rounds.length === 0) return;
    if (activeRoundIdx >= rounds.length - 1) {
      setIsAutoPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => {
      onSelectRound(Math.min(rounds.length - 1, activeRoundIdx + 1));
    }, playbackSpeed);
    return () => window.clearTimeout(timer);
  }, [isAutoPlaying, activeRoundIdx, rounds.length, playbackSpeed, onSelectRound]);

  // Reconstruct cumulative battlefield state up to activeRoundIdx
  const playerBoardState = useMemo(() => {
    if (!activeRound) {
      return {
        lands: [] as Array<{ name: string; roundPlayed: number; isToken?: boolean }>,
        permanents: [] as Array<{ name: string; roundPlayed: number; isCreature: boolean; isToken?: boolean }>,
        spellsCastThisRound: [] as string[],
      };
    }

    const lands: Array<{ name: string; roundPlayed: number; isToken?: boolean }> = [];
    let permanents: Array<{ name: string; roundPlayed: number; isCreature: boolean; isToken?: boolean }> = [];
    let spellsCastThisRound: string[] = [];

    const slice = rounds.slice(0, activeRoundIdx + 1);
    for (let i = 0; i < slice.length; i++) {
      const r = slice[i];
      const played = Array.isArray(r.cardsPlayed) ? r.cardsPlayed : [];
      const currentRoundSpells: string[] = [];

      for (const cardName of played) {
        const meta = findMeta(cardName);
        if (isLikelyLand(cardName, meta)) {
          lands.push({ name: cardName, roundPlayed: r.roundNumber });
        } else if (isInstantOrSorcery(meta)) {
          currentRoundSpells.push(cardName);
        } else {
          permanents.push({
            name: cardName,
            roundPlayed: r.roundNumber,
            isCreature: isCreatureCard(cardName, meta),
          });
        }
      }

      // Reflect board wipes or creature removals from bots during this round
      const boardWipeHappened = (r.botPlays || []).some((bp) => bp.boardWipeCast);
      const removedCreaturesOnYou = (r.botPlays || []).reduce((sum, bp) => {
        const target = (bp.targetParticipant || 'You').trim().toLowerCase();
        return target === 'you' ? sum + (bp.creaturesRemovedOnTarget || 0) : sum;
      }, 0);

      if (boardWipeHappened) {
        permanents = permanents.filter((p) => !p.isCreature);
      } else if (removedCreaturesOnYou > 0) {
        let toRemove = removedCreaturesOnYou;
        permanents = permanents.filter((p) => {
          if (p.isCreature && toRemove > 0) {
            toRemove -= 1;
            return false;
          }
          return true;
        });
      }

      if (i === slice.length - 1) {
        spellsCastThisRound = currentRoundSpells;
      }
    }

    // Reconcile land count with activeRound.landsInPlay
    const targetLands = Math.max(0, activeRound.landsInPlay || 0);
    while (lands.length < targetLands) {
      lands.push({
        name: 'Basic Land',
        roundPlayed: Math.max(1, lands.length + 1),
        isToken: true,
      });
    }
    const trimmedLands = lands.slice(0, Math.max(targetLands, lands.length));

    // Reconcile creature count with activeRound.playerStats?.creaturesOnBoard
    const targetCreatures = activeRound.playerStats?.creaturesOnBoard;
    if (typeof targetCreatures === 'number') {
      const currentCreatures = permanents.filter((p) => p.isCreature).length;
      if (currentCreatures < targetCreatures) {
        const missing = targetCreatures - currentCreatures;
        for (let t = 0; t < missing; t++) {
          permanents.push({
            name: 'Creature',
            roundPlayed: activeRound.roundNumber,
            isCreature: true,
            isToken: true,
          });
        }
      } else if (currentCreatures > targetCreatures) {
        let excess = currentCreatures - targetCreatures;
        permanents = permanents.filter((p) => {
          if (p.isCreature && excess > 0) {
            excess -= 1;
            return false;
          }
          return true;
        });
      }
    }

    return {
      lands: trimmedLands,
      permanents,
      spellsCastThisRound,
    };
  }, [activeRound, activeRoundIdx, rounds, findMeta]);

  if (!activeRound) return null;

  const botPlays: PlaytestBotPlay[] = Array.isArray(activeRound.botPlays)
    ? activeRound.botPlays
    : [];
  const youStats = getParticipantStat(activeRound, 'You');
  const handCards = Array.isArray(activeRound.handSnapshot)
    ? activeRound.handSnapshot
    : [];
  const playedSetThisRound = new Set(
    (activeRound.cardsPlayed || []).map((c) => c.trim().toLowerCase())
  );

  const botGridClass =
    botPlays.length <= 1
      ? 'grid-cols-1 max-w-2xl mx-auto w-full'
      : botPlays.length === 2
      ? 'grid-cols-1 md:grid-cols-2'
      : 'grid-cols-1 lg:grid-cols-3';

  return (
    <VisualBoardHoverContext.Provider
      value={{
        enabled: hoverZoomEnabled,
        showPreview: handleShowPreview,
        hidePreview: handleHidePreview,
      }}
    >
    <div
      aria-label="Visual Tabletop Play Area"
      className={
        embedded
          ? 'rounded-xl border border-zinc-200 bg-white overflow-hidden'
          : 'rounded-xl border border-zinc-200 bg-white overflow-hidden'
      }
    >
      {/* Top Tabletop Control Bar */}
      <div className="border-b border-zinc-200 bg-zinc-50 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-sky-700 shrink-0" />
            <h3 className="font-display text-sm font-bold text-zinc-900">
              Visual Board Play Area
            </h3>
          </div>
          <span className="text-zinc-300" aria-hidden="true">·</span>
          <span className="font-mono text-xs font-semibold tabular-nums text-sky-700">
            Round {activeRound.roundNumber} of {rounds.length}
          </span>
          <span className="text-zinc-300" aria-hidden="true">·</span>
          <span className="font-mono text-xs text-zinc-500">
            {result.mode} Pod
          </span>
        </div>

        {/* Turn Focus Filter */}
        <div className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-zinc-100 p-1">
          <button
            type="button"
            onClick={() => setTurnFocus('all')}
            className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              turnFocus === 'all'
                ? 'bg-white text-zinc-900 shadow-sm'
                : 'text-zinc-600 hover:text-zinc-900'
            }`}
          >
            Full Round
          </button>
          <button
            type="button"
            onClick={() => setTurnFocus('you')}
            className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              turnFocus === 'you'
                ? 'bg-white text-sky-900 shadow-sm'
                : 'text-zinc-600 hover:text-zinc-900'
            }`}
          >
            Your Turn
          </button>
          {botPlays.map((bp, idx) => (
            <button
              key={`${bp.botName}-${idx}`}
              type="button"
              onClick={() => setTurnFocus(idx)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                turnFocus === idx
                  ? 'bg-white text-zinc-900 shadow-sm'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              {bp.botName.split('(')[0].trim()}
            </button>
          ))}
        </div>

        {/* Playback Controls + Hide Toggle */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white p-1">
            <button
              type="button"
              onClick={() => {
                setIsAutoPlaying(false);
                onSelectRound(0);
              }}
              disabled={activeRoundIdx === 0 && !isAutoPlaying}
              title="Restart at Round 1"
              aria-label="Restart at Round 1"
              className="rounded px-1.5 py-1 text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                setIsAutoPlaying(false);
                onSelectRound(Math.max(0, activeRoundIdx - 1));
              }}
              disabled={activeRoundIdx === 0}
              aria-label="Previous round"
              className="rounded px-1.5 py-1 text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 cursor-pointer"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                if (!isAutoPlaying && activeRoundIdx >= rounds.length - 1) {
                  onSelectRound(0);
                }
                setIsAutoPlaying((v) => !v);
              }}
              className="inline-flex items-center gap-1 rounded bg-sky-700 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-sky-800 cursor-pointer whitespace-nowrap shrink-0"
            >
              {isAutoPlaying ? (
                <>
                  <Pause className="h-3 w-3" />
                  Pause
                </>
              ) : (
                <>
                  <Play className="h-3 w-3" />
                  {activeRoundIdx >= rounds.length - 1 ? 'Replay' : 'Play Rounds'}
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setIsAutoPlaying(false);
                onSelectRound(Math.min(rounds.length - 1, activeRoundIdx + 1));
              }}
              disabled={activeRoundIdx >= rounds.length - 1}
              aria-label="Next round"
              className="rounded px-1.5 py-1 text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 cursor-pointer"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={handleToggleHoverZoom}
            aria-pressed={hoverZoomEnabled}
            title={
              hoverZoomEnabled
                ? 'Disable enlarged card preview when hovering cards on the board'
                : 'Enable enlarged card preview when hovering cards on the board'
            }
            className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              hoverZoomEnabled
                ? 'border-sky-300 bg-sky-50 text-sky-900 hover:bg-sky-100'
                : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'
            }`}
          >
            <ZoomIn className={`h-3.5 w-3.5 ${hoverZoomEnabled ? 'text-sky-700' : 'text-zinc-400'}`} />
            {hoverZoomEnabled ? 'Hover Zoom On' : 'Hover Zoom Off'}
          </button>

          <button
            type="button"
            onClick={() => setShowPlaymatCustomizer(true)}
            title="Customize tabletop background and per-seat TCG playmats"
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-900 hover:bg-emerald-100 cursor-pointer whitespace-nowrap shrink-0 transition-colors"
          >
            <Palette className="h-3.5 w-3.5 text-emerald-700" />
            <span>Playmats &amp; Theme</span>
          </button>

          <select
            aria-label="Playback speed"
            value={playbackSpeed}
            onChange={(e) => setPlaybackSpeed(Number(e.target.value) as PlaybackSpeed)}
            className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 font-mono text-[11px] text-zinc-700 focus:border-sky-600 focus:outline-none cursor-pointer"
          >
            <option value={1800}>1x Speed</option>
            <option value={1100}>1.5x Speed</option>
            <option value={650}>2.5x Speed</option>
          </select>

          {embedded && onSwitchToLivePlay ? (
            <button
              type="button"
              onClick={onSwitchToLivePlay}
              className="inline-flex items-center gap-1.5 rounded-lg border border-sky-300 bg-sky-50 px-2.5 py-1.5 text-xs font-semibold text-sky-900 hover:bg-sky-100 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Play className="h-3.5 w-3.5 text-sky-700" />
              Play Live vs Bots
            </button>
          ) : onHideBoard ? (
            <button
              type="button"
              onClick={onHideBoard}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 cursor-pointer whitespace-nowrap shrink-0"
            >
              <EyeOff className="h-3.5 w-3.5" />
              Hide Board
            </button>
          ) : null}
        </div>
      </div>

      {/* Tabletop Playmat Surface (2 / 3 / 4 Player Felt Arena) */}
      <div
        className={`relative overflow-hidden border-t-2 p-4 sm:p-5 space-y-4 transition-colors ${tabletopSurface.outerClass}`}
      >
        <PlaymatSurfaceBackdrop surface={tabletopSurface} variant="table" />
        {/* 2 / 3 / 4 Seat Turn Order Track */}
        <div
          className={`relative z-10 grid gap-2 ${
            1 + botPlays.length === 2
              ? 'grid-cols-2'
              : 1 + botPlays.length === 3
              ? 'grid-cols-1 sm:grid-cols-3'
              : 'grid-cols-2 lg:grid-cols-4'
          }`}
        >
          <button
            type="button"
            onClick={() => setTurnFocus(turnFocus === 'you' ? 'all' : 'you')}
            className={`rounded-lg border px-3 py-2 flex items-center justify-between gap-2 text-left transition-colors cursor-pointer ${
              youStats?.eliminatedBy
                ? 'border-red-400/50 bg-red-950/50 text-red-100'
                : turnFocus === 'you'
                ? 'border-sky-400 bg-sky-950/60 ring-1 ring-sky-400/50 text-white'
                : 'border-[#247059] bg-[#0B392C]/85 text-white hover:border-sky-400/60'
            }`}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] font-bold">
                <span className="font-mono text-sky-300">S1</span>
                <span className="truncate">You</span>
                {youStats?.eliminatedBy && (
                  <span className="font-mono text-[9px] font-bold uppercase text-red-300">KO</span>
                )}
              </div>
              <div className="font-mono text-[10px] tabular-nums text-emerald-200/80">
                {handCards.length}H · {activeRound.landsInPlay} Lands · {activeRound.playerStats?.creaturesOnBoard ?? 0} Cr
              </div>
            </div>
            <div className="font-mono text-sm font-bold tabular-nums shrink-0">
              {youStats ? youStats.life : result.startingLife} HP
            </div>
          </button>

          {botPlays.map((bp, idx) => {
            const bStat = getParticipantStat(activeRound, bp.botName);
            const bKO =
              Boolean(bp.eliminatedThisTurn) ||
              Boolean(bStat?.eliminatedBy) ||
              (bStat ? bStat.life <= 0 : false);
            return (
              <button
                key={`seat-track-${bp.botName}-${idx}`}
                type="button"
                onClick={() => setTurnFocus(turnFocus === idx ? 'all' : idx)}
                className={`rounded-lg border px-3 py-2 flex items-center justify-between gap-2 text-left transition-colors cursor-pointer ${
                  bKO
                    ? 'border-red-400/45 bg-red-950/45 text-red-100 opacity-70'
                    : turnFocus === idx
                    ? 'border-sky-400 bg-[#135A45] ring-1 ring-sky-400/50 text-white'
                    : 'border-[#247059] bg-[#0B392C]/85 text-white hover:border-emerald-400/60'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold">
                    <span className="font-mono text-emerald-300">S{idx + 2}</span>
                    <span className="truncate">{bp.botName.split('(')[0].trim()}</span>
                    {bKO && (
                      <span className="font-mono text-[9px] font-bold uppercase text-red-300">KO</span>
                    )}
                  </div>
                  <div className="font-mono text-[10px] tabular-nums text-emerald-200/80">
                    {bp.handSize ?? bStat?.handSize ?? 0}H · {bp.landsInPlay ?? bStat?.landsInPlay ?? 0}L · {bp.creaturesOnBoard ?? bStat?.creaturesInPlay ?? 0} Cr
                  </div>
                </div>
                <div className="font-mono text-sm font-bold tabular-nums shrink-0">
                  {bStat ? bStat.life : '—'} HP
                </div>
              </button>
            );
          })}
        </div>

        {/* Top Zone: Bot Opponent Seats */}
        <div className={`relative z-10 grid gap-3.5 ${botGridClass}`}>
          {botPlays.map((bp, idx) => {
            const botStats = getParticipantStat(activeRound, bp.botName);
            const isEliminated =
              Boolean(bp.eliminatedThisTurn) ||
              Boolean(botStats?.eliminatedBy) ||
              (botStats ? botStats.life <= 0 : false);
            const isFocused = turnFocus === idx;
            const isDimmed = turnFocus !== 'all' && turnFocus !== idx;

            const botLands = bp.landsInPlay ?? botStats?.landsInPlay ?? Math.min(activeRound.roundNumber, 7);
            const botMana = bp.manaAvailable ?? botStats?.manaAvailable ?? botLands;
            const botCreatures = bp.creaturesOnBoard ?? botStats?.creaturesInPlay ?? 0;
            const botHand = bp.handSize ?? botStats?.handSize ?? 0;
            const cmdMeta = bp.commanderName ? findMeta(bp.commanderName) : null;
            const indignanceMeta = getBotIndignanceMeta(
              bp.indignance ||
                result.opponentsUsed?.find(
                  (o) => o.name.trim().toLowerCase() === bp.botName.trim().toLowerCase()
                )?.indignance
            );

            const targetLabel = (bp.targetParticipant || 'You').trim();
            const lifeDelta = botStats?.lifeDelta ?? 0;
            const visibleLandCount = Math.min(botLands, 10);
            const extraLandCount = Math.max(0, botLands - visibleLandCount);
            const archetypeRoster = getCreatureRosterForArchetype(bp.archetype);
            const visibleCreatureCount = Math.min(botCreatures, 5);
            const extraCreatureCount = Math.max(0, botCreatures - visibleCreatureCount);
            const botSeatNum = Math.min(4, idx + 2) as 2 | 3 | 4;
            const botSeatSurface = resolveSeatPlaymatSurface(playmatPrefs, botSeatNum);

            return (
              <div
                key={`${bp.botName}-${idx}`}
                onClick={() => setTurnFocus(isFocused ? 'all' : idx)}
                className={`relative overflow-hidden rounded-xl border p-3.5 space-y-3 transition-opacity duration-150 cursor-pointer text-white ${
                  isEliminated
                    ? 'border-red-400/45 bg-[#2A171C]/85'
                    : isFocused
                    ? botSeatSurface.seatActiveClass
                    : botSeatSurface.seatClass
                } ${isDimmed ? 'opacity-65' : 'opacity-100'}`}
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
                        {bp.botName}
                      </span>
                      {isEliminated && (
                        <span className="inline-flex items-center gap-1 font-mono text-[10px] font-bold uppercase text-red-300">
                          <Skull className="h-3 w-3" />
                          KO
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-emerald-100/80 truncate">
                      {bp.archetype}
                      <span className="mx-1 text-emerald-300/40" aria-hidden="true">·</span>
                      <span
                        className={
                          indignanceMeta.id === 'vindictive'
                            ? 'text-red-300 font-semibold'
                            : indignanceMeta.id === 'ruthless'
                            ? 'text-amber-300 font-semibold'
                            : indignanceMeta.id === 'measured'
                            ? 'text-sky-300'
                            : 'text-emerald-200'
                        }
                      >
                        {indignanceMeta.shortLabel}
                      </span>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <div className="font-mono text-base font-bold tabular-nums flex items-baseline justify-end gap-1">
                      <span className={isEliminated ? 'text-red-300' : 'text-white'}>
                        {botStats ? botStats.life : '—'} HP
                      </span>
                      {lifeDelta !== 0 && (
                        <span
                          className={`text-[11px] font-semibold ${
                            lifeDelta > 0 ? 'text-emerald-300' : 'text-red-300'
                          }`}
                        >
                          {lifeDelta > 0 ? `+${lifeDelta}` : lifeDelta}
                        </span>
                      )}
                    </div>
                    {botStats && (
                      <div className="font-mono text-[10px] tabular-nums text-emerald-200/80">
                        {botStats.poisonCounters > 0 && (
                          <span className="text-emerald-300 mr-1.5">
                            {botStats.poisonCounters}/10 PSN
                          </span>
                        )}
                        {usesCommanderDamage21 && botStats.maxCommanderDamage > 0 && (
                          <span className="text-amber-300 mr-1.5">
                            {botStats.maxCommanderDamage}/21 CMDR
                          </span>
                        )}
                        <span>{botLands}L · {botMana}M</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Hidden Hand Card Backs + Lands Pips */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-y border-[#1A624D] py-2">
                  <ReplayCardBackFan count={botHand} />

                  <div className="flex items-center gap-1">
                    {Array.from({ length: visibleLandCount }).map((_, lIdx) => (
                      <span
                        key={lIdx}
                        title="Land in play"
                        className="inline-flex h-4 w-3 items-center justify-center rounded-[2px] border border-emerald-300/50 bg-emerald-800/70 text-[8px] font-mono font-bold text-emerald-100"
                      >
                        L
                      </span>
                    ))}
                    {extraLandCount > 0 && (
                      <span className="font-mono text-[10px] text-emerald-200">
                        +{extraLandCount}
                      </span>
                    )}
                    {bp.boardWipeCast && (
                      <span className="ml-1.5 inline-flex items-center gap-0.5 font-sans text-[10px] font-bold text-red-300">
                        <Flame className="h-3 w-3" />
                        Wipe
                      </span>
                    )}
                  </div>
                </div>

                {/* Bot Battlefield Cards: Commander + Real Archetype Creature Card Tiles */}
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-start gap-2 overflow-x-auto pb-1 min-h-[104px]"
                >
                  {bp.commanderName && (
                    <BoardCardTile
                      name={bp.commanderName}
                      meta={cmdMeta}
                      onInspect={onInspectCard}
                      badge="Cmdr"
                      highlight="commander"
                      compact
                    />
                  )}

                  {botCreatures === 0 ? (
                    <div className="flex-1 rounded-lg border border-dashed border-[#247059] px-3 py-5 text-center text-[11px] text-emerald-200/70">
                      No creatures on board
                    </div>
                  ) : (
                    <>
                      {Array.from({ length: visibleCreatureCount }).map((_, cIdx) => {
                        const rosterCard = archetypeRoster[cIdx % archetypeRoster.length];
                        const crMeta = findMeta(rosterCard.name);
                        return (
                          <BoardCardTile
                            key={`${bp.botName}-cr-${cIdx}`}
                            name={rosterCard.name}
                            meta={crMeta}
                            onInspect={onInspectCard}
                            subtitle={`${rosterCard.power}/${rosterCard.toughness}`}
                            compact
                          />
                        );
                      })}
                      {extraCreatureCount > 0 && (
                        <div className="shrink-0 self-center rounded-lg border border-[#287D64] bg-[#0F4C3A] px-2.5 py-2 font-mono text-[11px] font-bold text-emerald-100">
                          +{extraCreatureCount}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Bot Turn Play Description */}
                <div className="space-y-1 text-xs border-t border-[#1A624D] pt-2">
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <span className="font-semibold text-white">
                      Round {activeRound.roundNumber} Play
                    </span>
                    {!isEliminated && bp.targetParticipant && (
                      <span
                        className={`font-mono text-[10px] font-bold ${
                          targetLabel.toLowerCase() === 'you'
                            ? 'text-red-300'
                            : 'text-amber-300'
                        }`}
                      >
                        → {targetLabel}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] leading-relaxed text-emerald-100/85 line-clamp-2">
                    {bp.action}
                  </p>
                  <div className="text-[10px] text-emerald-200/70 truncate">
                    Threat: {bp.boardThreat}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Center Combat & Action Stack Strip */}
        <div className="rounded-xl border border-[#1E6E56] bg-[#0B392C]/95 px-4 py-3 space-y-2 text-white">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold text-white">
              <Swords className="h-3.5 w-3.5 text-sky-300 shrink-0" />
              <span>Round {activeRound.roundNumber} Combat &amp; Stack Summary</span>
            </div>
            <span className="text-xs text-emerald-200/80">
              Tempo: <span className="font-medium text-white">{activeRound.manaOrTempoIssue}</span>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
            <span className="text-emerald-100">
              <strong className="text-sky-300">You</strong>
              {activeRound.playerStats?.targetBot ? (
                <>
                  {' → '}
                  <span className="font-medium text-white">{activeRound.playerStats.targetBot}</span>
                </>
              ) : null}
              {activeRound.playerStats && activeRound.playerStats.combatDamageDealt > 0 && (
                <span className="ml-1.5 font-mono text-sky-300 font-semibold">
                  ({activeRound.playerStats.combatDamageDealt} dmg
                  {activeRound.playerStats.commanderDamageDealt > 0
                    ? `, ${activeRound.playerStats.commanderDamageDealt} cmdr`
                    : ''}
                  )
                </span>
              )}
              {(activeRound.cardsPlayed || []).length === 0 && (
                <span className="ml-1.5 text-amber-300">(No spells cast)</span>
              )}
            </span>

            {botPlays.map((bp, i) => {
              const target = (bp.targetParticipant || 'You').trim();
              const dmg =
                typeof bp.targetLifeDelta === 'number' && bp.targetLifeDelta !== 0
                  ? bp.targetLifeDelta
                  : target.toLowerCase() === 'you'
                  ? bp.lifeChangeToYou ?? 0
                  : 0;
              return (
                <span key={`${bp.botName}-exchange-${i}`} className="text-emerald-100/85">
                  <span className="text-emerald-300/40 mr-2" aria-hidden="true">|</span>
                  <strong className="text-white">{bp.botName.split('(')[0].trim()}</strong>
                  {bp.eliminatedThisTurn ? (
                    <span className="ml-1 text-red-300 font-semibold">KO</span>
                  ) : (
                    <>
                      {' → '}
                      <span className={target.toLowerCase() === 'you' ? 'text-red-300 font-medium' : 'text-emerald-100'}>
                        {target}
                      </span>
                      {dmg < 0 && (
                        <span className="ml-1 font-mono text-red-300 font-semibold">
                          ({dmg} HP)
                        </span>
                      )}
                      {bp.boardWipeCast && (
                        <span className="ml-1 font-semibold text-red-300">[Wipe]</span>
                      )}
                    </>
                  )}
                </span>
              );
            })}
          </div>
        </div>

        {/* Bottom Zone: Your Playmat */}
        <div
          onClick={() => setTurnFocus(turnFocus === 'you' ? 'all' : 'you')}
          className={`rounded-xl border bg-white p-4 space-y-4 transition-opacity duration-150 cursor-pointer shadow-sm ${
            youStats?.eliminatedBy
              ? 'border-red-400 bg-red-50/30'
              : turnFocus === 'you'
              ? 'border-sky-400 ring-2 ring-sky-400/50'
              : 'border-emerald-300/80'
          } ${turnFocus !== 'all' && turnFocus !== 'you' ? 'opacity-70' : 'opacity-100'}`}
        >
          {/* Your Seat Header */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 pb-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <Shield className="h-4 w-4 text-sky-700 shrink-0" />
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold text-zinc-900">
                    Your Board · {deckName || 'Your Deck'}
                  </span>
                  <span className="font-mono text-xs text-zinc-500">
                    ({result.testedListLabel})
                  </span>
                </div>
                <p className="text-xs text-zinc-600 mt-0.5">
                  {activeRound.playerAction}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 font-mono text-xs tabular-nums">
              <div className="text-right">
                <div className="text-base font-bold text-sky-700 flex items-baseline gap-1.5">
                  <span>{youStats ? youStats.life : result.startingLife} HP</span>
                  {youStats && youStats.lifeDelta !== 0 && (
                    <span
                      className={`text-xs ${
                        youStats.lifeDelta > 0 ? 'text-emerald-700' : 'text-red-700'
                      }`}
                    >
                      {youStats.lifeDelta > 0 ? `+${youStats.lifeDelta}` : youStats.lifeDelta}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-zinc-500">
                  {youStats
                    ? `${youStats.poisonCounters}/10 PSN${
                        usesCommanderDamage21 ? ` · ${youStats.maxCommanderDamage}/21 CMDR` : ''
                      }`
                    : ''}
                </div>
              </div>
              <div className="border-l border-zinc-200 pl-3 text-[11px] text-zinc-600 space-y-0.5">
                <div>
                  Lands <strong className="text-zinc-900">{activeRound.landsInPlay}</strong>
                  <span className="mx-1.5 text-zinc-300">·</span>
                  Mana <strong className="text-sky-700">{activeRound.manaAvailable}</strong>
                </div>
                <div>
                  Lib <strong className="text-zinc-900">{youStats?.libraryRemaining ?? activeRound.libraryRemaining ?? '—'}</strong>
                  <span className="mx-1.5 text-zinc-300">·</span>
                  GY <strong className="text-zinc-900">{youStats?.graveyardCount ?? activeRound.graveyardCount ?? 0}</strong>
                </div>
              </div>
            </div>
          </div>

          {/* Your Battlefield Zones: Command Zone + Lands + Creatures/Permanents */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="grid grid-cols-1 gap-3 lg:grid-cols-[auto_1fr_1fr]"
          >
            {/* Command Zone & Cast Spells */}
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 space-y-2 min-w-[140px]">
              <div className="text-[11px] font-semibold text-zinc-700">
                Command Zone &amp; Stack
              </div>
              <div className="flex flex-wrap items-start gap-2">
                {commanderNames.length > 0 ? (
                  commanderNames.map((cmd) => (
                    <BoardCardTile
                      key={cmd}
                      name={cmd}
                      meta={findMeta(cmd)}
                      onInspect={onInspectCard}
                      badge="Cmdr"
                      highlight="commander"
                      compact
                    />
                  ))
                ) : (
                  <div className="text-[11px] text-zinc-500 py-2">
                    No Commander (Mainboard deck)
                  </div>
                )}

                {playerBoardState.spellsCastThisRound.map((spell, sIdx) => (
                  <BoardCardTile
                    key={`${spell}-${sIdx}`}
                    name={spell}
                    meta={findMeta(spell)}
                    onInspect={onInspectCard}
                    badge={`Cast R${activeRound.roundNumber}`}
                    highlight="new"
                    compact
                  />
                ))}
              </div>
            </div>

            {/* Lands Row */}
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 space-y-2 min-w-0">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="font-semibold text-zinc-700">
                  Lands in Play ({playerBoardState.lands.length})
                </span>
                <span className="font-mono text-sky-700 tabular-nums">
                  {activeRound.manaAvailable} Mana Ready
                </span>
              </div>
              {playerBoardState.lands.length === 0 ? (
                <div className="text-xs text-zinc-500 py-3">No lands in play yet.</div>
              ) : (
                <div className="flex items-start gap-2 overflow-x-auto pb-1">
                  {playerBoardState.lands.map((land, lIdx) => (
                    <BoardCardTile
                      key={`${land.name}-${lIdx}`}
                      name={land.name}
                      meta={land.isToken ? null : findMeta(land.name)}
                      onInspect={onInspectCard}
                      isToken={land.isToken}
                      subtitle="Land"
                      badge={
                        land.roundPlayed === activeRound.roundNumber && !land.isToken
                          ? `R${activeRound.roundNumber}`
                          : undefined
                      }
                      highlight={
                        land.roundPlayed === activeRound.roundNumber && !land.isToken
                          ? 'new'
                          : 'none'
                      }
                      compact
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Creatures & Nonland Permanents Row */}
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 space-y-2 min-w-0">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="font-semibold text-zinc-700">
                  Creatures &amp; Permanents ({playerBoardState.permanents.length})
                </span>
                <span className="font-mono text-zinc-500 tabular-nums">
                  {activeRound.playerStats?.creaturesOnBoard ?? 0} Creatures
                </span>
              </div>
              {playerBoardState.permanents.length === 0 ? (
                <div className="text-xs text-zinc-500 py-3">
                  No nonland permanents on battlefield yet.
                </div>
              ) : (
                <div className="flex items-start gap-2 overflow-x-auto pb-1">
                  {playerBoardState.permanents.map((perm, pIdx) => (
                    <BoardCardTile
                      key={`${perm.name}-${pIdx}`}
                      name={perm.name}
                      meta={perm.isToken ? null : findMeta(perm.name)}
                      onInspect={onInspectCard}
                      isToken={perm.isToken}
                      subtitle={perm.isCreature ? 'Creature' : 'Artifact / Ench'}
                      badge={
                        perm.roundPlayed === activeRound.roundNumber && !perm.isToken
                          ? `New`
                          : undefined
                      }
                      highlight={
                        perm.roundPlayed === activeRound.roundNumber && !perm.isToken
                          ? 'new'
                          : 'none'
                      }
                      compact
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Your Hand Tray */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 space-y-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <span className="font-semibold text-zinc-700">
                Your Hand — Round {activeRound.roundNumber} ({handCards.length} cards)
              </span>
              <span className="text-zinc-500">
                Drew:{' '}
                <button
                  type="button"
                  onClick={() => onInspectCard(activeRound.cardDrawn, findMeta(activeRound.cardDrawn))}
                  className="font-semibold text-amber-700 hover:underline cursor-pointer"
                >
                  {activeRound.cardDrawn}
                </button>
              </span>
            </div>

            {handCards.length === 0 ? (
              <div className="text-xs text-zinc-500 py-2">Hand is empty.</div>
            ) : (
              <div className="flex items-start gap-2 overflow-x-auto pb-1">
                {(() => {
                  const drawnNorm = (activeRound.cardDrawn || '').trim().toLowerCase();
                  let drawnMatchIdx = -1;
                  if (drawnNorm) {
                    for (let idx = handCards.length - 1; idx >= 0; idx--) {
                      if (handCards[idx].trim().toLowerCase() === drawnNorm) {
                        drawnMatchIdx = idx;
                        break;
                      }
                    }
                  }
                  return handCards.map((cardName, hIdx) => {
                    const isDrawn = hIdx === drawnMatchIdx;
                    const wasPlayed = playedSetThisRound.has(cardName.trim().toLowerCase());
                    return (
                      <BoardCardTile
                        key={
                          isDrawn
                            ? `${cardName}-${hIdx}-drawn-r${activeRound.roundNumber}`
                            : `${cardName}-${hIdx}`
                        }
                        name={cardName}
                        meta={findMeta(cardName)}
                        onInspect={onInspectCard}
                        badge={isDrawn ? 'Drew' : wasPlayed ? 'Played' : undefined}
                        highlight={isDrawn ? 'drawn' : wasPlayed ? 'new' : 'none'}
                        animateDraw={isDrawn}
                      />
                    );
                  });
                })()}
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
    <TabletopPlaymatCustomizerModal
      isOpen={showPlaymatCustomizer}
      onClose={() => setShowPlaymatCustomizer(false)}
      preferences={playmatPrefs}
      onChangePreferences={setPlaymatPrefs}
      seatLabels={[
        `Seat 1 (You · ${deckName || 'Your Deck'})`,
        botPlays[0]?.botName && `Seat 2 (${botPlays[0].botName})`,
        botPlays[1]?.botName && `Seat 3 (${botPlays[1].botName})`,
        botPlays[2]?.botName && `Seat 4 (${botPlays[2].botName})`,
      ]}
    />
    </VisualBoardHoverContext.Provider>
  );
};
