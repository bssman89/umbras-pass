import React from 'react';
import { Flag, ScrollText, Sparkles, X } from 'lucide-react';
import type { CardMetadata, PlaytestResult, PlaytestRound } from '../types/deck';
import {
  MANA_ISSUE_TAGS,
  detectRoundManaTag,
  getManaTagMeta,
  type ManaIssueTag,
} from '../utils/manaCorrelation';
import { CardLink } from './CardInspectorModal';

interface PlaytestMatchLogSidebarProps {
  result: PlaytestResult;
  activeRoundIdx: number;
  onSelectRound: (idx: number) => void;
  manaTagsByRound: Record<number, ManaIssueTag | undefined>;
  onSetRoundManaTag: (roundNumber: number, tag: ManaIssueTag | undefined) => void;
  onAutoTagRounds: () => void;
  onClearAllTags: () => void;
  findMeta: (name: string) => CardMetadata | null;
  onInspectCard: (name: string, meta?: CardMetadata | null) => void;
}

function getYouStats(round: PlaytestRound) {
  const entry = (Array.isArray(round?.participantStats) ? round.participantStats : []).find(
    (p) => (typeof p?.player === 'string' ? p.player : '').trim().toLowerCase() === 'you'
  );
  if (entry) return entry;
  const lt = (Array.isArray(round?.lifeTotals) ? round.lifeTotals : []).find(
    (l) => (typeof l?.player === 'string' ? l.player : '').trim().toLowerCase() === 'you'
  );
  return lt
    ? {
        player: 'You',
        life: lt.life,
        lifeDelta: 0,
        poisonCounters: 0,
        poisonDelta: 0,
        commanderDamageTaken: [],
        maxCommanderDamage: 0,
        libraryRemaining: round.libraryRemaining ?? 0,
        cardsMilledTotal: round.cardsMilledToYou ?? 0,
        cardsMilledThisRound: 0,
        graveyardCount: round.graveyardCount ?? 0,
        handSize: (round.handSnapshot || []).length,
        landsInPlay: round.landsInPlay ?? 0,
        manaAvailable: round.manaAvailable ?? 0,
        creaturesInPlay: 0,
      }
    : null;
}

export const PlaytestMatchLogSidebar: React.FC<PlaytestMatchLogSidebarProps> = ({
  result,
  activeRoundIdx,
  onSelectRound,
  manaTagsByRound,
  onSetRoundManaTag,
  onAutoTagRounds,
  onClearAllTags,
  findMeta,
  onInspectCard,
}) => {
  const taggedCount = Object.values(manaTagsByRound).filter(Boolean).length;

  const openingLandsCount = (result?.openingHand || []).filter((name) => {
    const meta = findMeta(name);
    return meta ? meta.isLand : false;
  }).length;

  const firstRoundYou = result?.rounds?.[0] ? getYouStats(result.rounds[0]) : null;
  const openingLibEstimate =
    firstRoundYou && firstRoundYou.libraryRemaining > 0
      ? firstRoundYou.libraryRemaining + 1 + (firstRoundYou.cardsMilledThisRound || 0)
      : result.startingLife >= 40
      ? 92
      : 53;

  return (
    <aside
      aria-label="Match Log and Mana Tagging Sidebar"
      className="rounded-xl border border-zinc-200 bg-white lg:sticky lg:top-28 flex flex-col max-h-[760px]"
    >
      {/* Sidebar Header */}
      <div className="border-b border-zinc-100 p-4 space-y-2.5 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <ScrollText className="h-4 w-4 text-sky-700 shrink-0" />
            <h3 className="font-display text-sm font-bold text-zinc-900 truncate">
              Match Log
            </h3>
          </div>
          <span className="font-mono text-xs tabular-nums text-zinc-500 whitespace-nowrap shrink-0">
            {taggedCount} tagged
          </span>
        </div>

        <p className="text-xs leading-snug text-zinc-600">
          Select any turn to inspect synchronized combat stats, or tag turns where your mana underperformed.
        </p>

        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <button
            type="button"
            onClick={onAutoTagRounds}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Sparkles className="h-3 w-3 text-sky-700" />
            Auto-tag stalls
          </button>
          {taggedCount > 0 && (
            <button
              type="button"
              onClick={onClearAllTags}
              className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:text-zinc-900 cursor-pointer whitespace-nowrap shrink-0"
            >
              Clear tags
            </button>
          )}
        </div>
      </div>

      {/* Scrollable Chronological Turn Log */}
      <div className="overflow-y-auto divide-y divide-zinc-100 flex-1">
        {/* Turn 0 / Opening Hand Snapshot */}
        <div className="px-4 py-3 bg-zinc-50/60">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-mono font-semibold text-zinc-800">
              Turn 0 · Opening 7
            </span>
            <span className="font-mono tabular-nums text-zinc-500">
              {openingLandsCount}L · {result.startingLife} HP · {openingLibEstimate} Lib
            </span>
          </div>
          <p className="mt-1 text-xs text-zinc-600 line-clamp-2">
            {result.mulliganVerdict}
          </p>
        </div>

        {/* Turn-by-Turn Game States */}
        {(result?.rounds || []).map((round, idx) => {
          const prevRound = idx > 0 ? (result?.rounds || [])[idx - 1] : undefined;
          const isActive = idx === activeRoundIdx;
          const activeTag = manaTagsByRound[round.roundNumber];
          const tagMeta = activeTag ? getManaTagMeta(activeTag) : null;
          const youStats = getYouStats(round);
          const yourLife = youStats ? youStats.life : null;
          const suggestedTag = detectRoundManaTag(round, prevRound) || 'missed-land';
          const hasAltCounters =
            Boolean(youStats) &&
            ((youStats?.poisonCounters || 0) > 0 ||
              (youStats?.maxCommanderDamage || 0) > 0 ||
              (youStats?.cardsMilledTotal || 0) > 0 ||
              (youStats?.libraryRemaining || 0) > 0);

          return (
            <div
              key={round.roundNumber}
              className={`px-4 py-3 transition-colors ${
                isActive
                  ? 'bg-sky-50/60'
                  : activeTag
                  ? 'bg-amber-50/40'
                  : 'hover:bg-zinc-50/70'
              }`}
            >
              {/* Row Top: Round button + Key Stats */}
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => onSelectRound(idx)}
                  className="text-left font-mono text-xs font-bold text-zinc-900 hover:text-sky-700 cursor-pointer whitespace-nowrap"
                >
                  Round {round.roundNumber}
                  {isActive && (
                    <span className="ml-1.5 font-sans font-semibold text-sky-700">
                      (Viewing)
                    </span>
                  )}
                </button>

                <div className="flex items-center gap-1.5 font-mono text-[11px] tabular-nums text-zinc-600 whitespace-nowrap shrink-0">
                  <span>{round.landsInPlay}L</span>
                  <span className="text-zinc-300" aria-hidden="true">·</span>
                  <span className="text-sky-700 font-semibold">{round.manaAvailable}M</span>
                  {yourLife !== null && (
                    <>
                      <span className="text-zinc-300" aria-hidden="true">·</span>
                      <span className={yourLife <= 0 ? 'text-red-700 font-semibold' : ''}>
                        {yourLife} HP
                      </span>
                    </>
                  )}
                </div>
              </div>

              {hasAltCounters && youStats && (
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] tabular-nums text-zinc-500">
                  {youStats.poisonCounters > 0 && (
                    <span className={youStats.poisonCounters >= 10 ? 'text-red-700 font-semibold' : 'text-emerald-700 font-medium'}>
                      Poison {youStats.poisonCounters}/10
                    </span>
                  )}
                  {youStats.maxCommanderDamage > 0 && (
                    <span className={youStats.maxCommanderDamage >= 21 ? 'text-red-700 font-semibold' : 'text-amber-700 font-medium'}>
                      Cmdr {youStats.maxCommanderDamage}/21
                    </span>
                  )}
                  {youStats.cardsMilledTotal > 0 && (
                    <span className="text-sky-700 font-medium">
                      Mill {youStats.cardsMilledTotal}
                    </span>
                  )}
                  {youStats.libraryRemaining >= 0 && (
                    <span className={youStats.libraryRemaining <= 0 ? 'text-red-700 font-semibold' : ''}>
                      Lib {youStats.libraryRemaining}
                    </span>
                  )}
                </div>
              )}

              {/* Key Game State Details (Draw + Plays + Tempo Note) */}
              <div
                onClick={() => onSelectRound(idx)}
                className="mt-1.5 space-y-1 cursor-pointer"
              >
                <div className="text-xs text-zinc-700 flex flex-wrap items-baseline gap-x-1">
                  <span className="text-zinc-400">Drew:</span>
                  <span onClick={(e) => e.stopPropagation()}>
                    <CardLink
                      name={round.cardDrawn}
                      meta={findMeta(round.cardDrawn)}
                      onInspect={onInspectCard}
                      className="text-xs"
                    />
                  </span>
                </div>

                <div className="text-xs text-zinc-600">
                  <span className="text-zinc-400">Played: </span>
                  {(round.cardsPlayed || []).length > 0 ? (
                    <span className="font-medium text-zinc-800">
                      {(round.cardsPlayed || []).join(', ')}
                    </span>
                  ) : (
                    <span className="text-amber-700 font-medium">
                      No spells cast
                    </span>
                  )}
                </div>

                {round.manaOrTempoIssue && (
                  <p className="text-[11px] leading-snug text-zinc-500 line-clamp-2">
                    {round.manaOrTempoIssue}
                  </p>
                )}
              </div>

              {/* Mana Underperformance Tagging Control */}
              <div className="mt-2.5 flex items-center justify-between gap-2">
                {activeTag && tagMeta ? (
                  <div className="flex w-full items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <Flag className="h-3.5 w-3.5 text-amber-700 shrink-0" />
                      <select
                        aria-label={`Mana issue tag for Round ${round.roundNumber}`}
                        value={activeTag}
                        onChange={(e) =>
                          onSetRoundManaTag(
                            round.roundNumber,
                            e.target.value as ManaIssueTag
                          )
                        }
                        className="w-full min-w-0 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-900 focus:border-sky-600 focus:outline-none cursor-pointer"
                      >
                        {MANA_ISSUE_TAGS.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      type="button"
                      onClick={() => onSetRoundManaTag(round.roundNumber, undefined)}
                      aria-label={`Remove mana tag from Round ${round.roundNumber}`}
                      title="Remove tag"
                      className="inline-flex items-center justify-center rounded border border-zinc-200 bg-white p-1 text-zinc-500 hover:text-red-700 hover:border-red-200 cursor-pointer shrink-0"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => onSetRoundManaTag(round.roundNumber, suggestedTag)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-600 hover:border-amber-300 hover:bg-amber-50/70 hover:text-amber-900 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Flag className="h-3 w-3" />
                    Tag mana issue
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
};
