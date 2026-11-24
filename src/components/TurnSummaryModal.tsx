import React, { useEffect, useMemo } from 'react';
import {
  Crown,
  Flame,
  Mountain,
  Skull,
  Sparkles,
  Swords,
  Trophy,
  X,
} from 'lucide-react';
import type { CardMetadata, PlaytestResult } from '../types/deck';
import { CardLink } from './CardInspectorModal';

interface TurnSummaryModalProps {
  open: boolean;
  result: PlaytestResult;
  findMeta: (name: string) => CardMetadata | null;
  onInspectCard: (name: string, meta?: CardMetadata | null) => void;
  onSelectRound: (roundIdx: number) => void;
  onClose: () => void;
}

function isLikelyLandCard(name: string, meta: CardMetadata | null): boolean {
  if (meta) return meta.isLand;
  return /\b(plains|island|swamp|mountain|forest|wastes|command tower|exotic orchard|evolving wilds|terramorphic expanse|temple|shrine|fountain|tomb|foundry|pool|grounds|crypt|vents|garden|sanctuary|citadel|triome|path|marsh|mire|delta|strand|heath|foothills|mesa|tarn|catacombs|rainforest|flats)\b/i.test(
    name
  );
}

export const TurnSummaryModal: React.FC<TurnSummaryModalProps> = ({
  open,
  result,
  findMeta,
  onInspectCard,
  onSelectRound,
  onClose,
}) => {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  const summary = useMemo(() => {
    const rounds = Array.isArray(result.rounds) ? result.rounds : [];
    let namedLandsPlayed = 0;
    let spellsCastCount = 0;
    let totalDamageDealt = 0;
    let boardWipesCount = 0;
    let eliminationsCount = 0;
    const castSpellsList: string[] = [];

    const roundEvents = rounds.map((r, idx) => {
      const played = Array.isArray(r.cardsPlayed) ? r.cardsPlayed : [];
      const landsThisRound: string[] = [];
      const spellsThisRound: string[] = [];

      for (const cardName of played) {
        if (isLikelyLandCard(cardName, findMeta(cardName))) {
          landsThisRound.push(cardName);
          namedLandsPlayed += 1;
        } else {
          spellsThisRound.push(cardName);
          spellsCastCount += 1;
          if (castSpellsList.length < 18) castSpellsList.push(cardName);
        }
      }

      const prevLandsInPlay = idx > 0 ? rounds[idx - 1]?.landsInPlay || 0 : 0;
      const inferredLandDrop = Math.max(0, (r.landsInPlay || 0) - prevLandsInPlay);
      const dmgDealt = r.playerStats?.combatDamageDealt ?? 0;
      totalDamageDealt += dmgDealt;

      const botEvents: string[] = [];
      for (const bp of r.botPlays || []) {
        if (bp.boardWipeCast) {
          boardWipesCount += 1;
          botEvents.push(`${bp.botName} cast a Board Wipe`);
        }
        if (bp.eliminatedThisTurn) {
          eliminationsCount += 1;
          botEvents.push(`${bp.botName} was eliminated`);
        }
        const dmgToYou =
          (bp.targetParticipant || 'You').trim().toLowerCase() === 'you'
            ? Math.abs(bp.targetLifeDelta ?? bp.lifeChangeToYou ?? 0)
            : 0;
        if (dmgToYou > 0) {
          botEvents.push(`${bp.botName} dealt ${dmgToYou} dmg to You`);
        }
      }

      return {
        idx,
        roundNumber: r.roundNumber,
        landsInPlay: r.landsInPlay,
        manaAvailable: r.manaAvailable,
        landsThisRound,
        inferredLandDrop,
        spellsThisRound,
        dmgDealt,
        targetBot: r.playerStats?.targetBot,
        botEvents,
        manaOrTempoIssue: r.manaOrTempoIssue,
      };
    });

    const maxLandsInPlay = rounds.reduce(
      (mx, r) => Math.max(mx, r.landsInPlay || 0),
      0
    );
    const totalLandsPlayed = Math.max(namedLandsPlayed, maxLandsInPlay);

    const finalWinner =
      result.finalStats?.winningPlayer ||
      (result.outcome === 'win'
        ? 'You'
        : result.opponentsUsed?.[0]?.name || 'Bot Opponent');

    const winConditionLabel =
      result.finalStats?.winCondition === 'poison'
        ? '10+ Poison Counters'
        : result.finalStats?.winCondition === 'commander'
        ? '21+ Commander Damage'
        : result.finalStats?.winCondition === 'mill'
        ? 'Library Milled Out'
        : result.finalStats?.winCondition === 'life'
        ? '0 Life Elimination'
        : 'Table Clock Lead';

    return {
      totalLandsPlayed,
      maxLandsInPlay,
      spellsCastCount,
      castSpellsList,
      totalDamageDealt,
      boardWipesCount,
      eliminationsCount,
      finalWinner,
      winConditionLabel,
      roundEvents,
    };
  }, [result, findMeta]);

  if (!open) return null;

  const isPlayerWinner =
    summary.finalWinner.trim().toLowerCase() === 'you' ||
    result.outcome === 'win';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="turn-summary-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[88vh] flex flex-col rounded-2xl border border-zinc-200 bg-white shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-start justify-between gap-4 border-b border-zinc-200 bg-zinc-50 px-6 py-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-sky-200 bg-sky-50">
              {isPlayerWinner ? (
                <Trophy className="h-5 w-5 text-emerald-700" />
              ) : (
                <Crown className="h-5 w-5 text-amber-700" />
              )}
            </div>
            <div>
              <h2
                id="turn-summary-modal-title"
                className="font-display text-lg font-bold text-zinc-900"
              >
                Turn Summary — {result.mode} Simulated Match
              </h2>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-600">
                <span>
                  Final Winner:{' '}
                  <strong className={isPlayerWinner ? 'text-emerald-700' : 'text-amber-700'}>
                    {summary.finalWinner}
                  </strong>
                </span>
                <span className="text-zinc-300" aria-hidden="true">·</span>
                <span>{summary.winConditionLabel}</span>
                <span className="text-zinc-300" aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  {result.totalRounds} Rounds Played
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close Turn Summary modal"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-500 hover:text-zinc-900 cursor-pointer shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Key Match Totals */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3.5">
              <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
                <Mountain className="h-4 w-4 text-emerald-700 shrink-0" />
                <span>Lands Played</span>
              </div>
              <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-zinc-900">
                {summary.totalLandsPlayed}
              </div>
              <div className="text-xs text-zinc-500 font-mono tabular-nums">
                Peak {summary.maxLandsInPlay} in play
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3.5">
              <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
                <Sparkles className="h-4 w-4 text-sky-700 shrink-0" />
                <span>Spells Cast</span>
              </div>
              <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-sky-700">
                {summary.spellsCastCount}
              </div>
              <div className="text-xs text-zinc-500">
                Nonland spells resolved
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3.5">
              <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
                <Swords className="h-4 w-4 text-amber-700 shrink-0" />
                <span>Combat Damage</span>
              </div>
              <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-zinc-900">
                {summary.totalDamageDealt}
              </div>
              <div className="text-xs text-zinc-500">
                Dealt across {result.totalRounds} rounds
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3.5">
              <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
                {summary.boardWipesCount > 0 ? (
                  <Flame className="h-4 w-4 text-red-700 shrink-0" />
                ) : (
                  <Skull className="h-4 w-4 text-zinc-600 shrink-0" />
                )}
                <span>Table Disrupted</span>
              </div>
              <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-zinc-900">
                {summary.boardWipesCount} / {summary.eliminationsCount}
              </div>
              <div className="text-xs text-zinc-500">
                Wipes / Bot KOs
              </div>
            </div>
          </div>

          {/* Match Outcome Summary */}
          <div className="rounded-xl border border-sky-200 bg-sky-50/40 px-4 py-3 text-xs text-zinc-700 leading-relaxed">
            <span className="font-semibold text-zinc-900">Match Verdict: </span>
            {result.matchSummary}
          </div>

          {/* Notable Spells Cast */}
          {summary.castSpellsList.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-zinc-800">
                Spells You Cast ({summary.spellsCastCount})
              </div>
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs">
                {summary.castSpellsList.map((spell, idx) => (
                  <React.Fragment key={`${spell}-${idx}`}>
                    <CardLink
                      name={spell}
                      meta={findMeta(spell)}
                      onInspect={onInspectCard}
                      className="text-xs"
                    />
                    {idx < summary.castSpellsList.length - 1 && (
                      <span className="text-zinc-300" aria-hidden="true">·</span>
                    )}
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}

          {/* Turn-by-Turn Key Events */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-zinc-800">
              Key Events by Round
            </div>
            <div className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white">
              {summary.roundEvents.map((ev) => (
                <div
                  key={ev.roundNumber}
                  className="px-4 py-2.5 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between text-xs"
                >
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono font-bold text-zinc-900">
                        Round {ev.roundNumber}
                      </span>
                      <span className="font-mono text-[11px] tabular-nums text-zinc-500">
                        {ev.landsInPlay}L · {ev.manaAvailable}M
                      </span>
                      {ev.landsThisRound.length > 0 ? (
                        <span className="text-emerald-700 font-medium">
                          Land: {ev.landsThisRound.join(', ')}
                        </span>
                      ) : ev.inferredLandDrop > 0 ? (
                        <span className="text-emerald-700 font-medium">
                          +{ev.inferredLandDrop} Land
                        </span>
                      ) : null}
                      {ev.spellsThisRound.length > 0 && (
                        <span className="text-sky-700 font-medium">
                          Cast: {ev.spellsThisRound.join(', ')}
                        </span>
                      )}
                      {ev.dmgDealt > 0 && (
                        <span className="font-mono text-amber-700 font-semibold">
                          Dealt {ev.dmgDealt} dmg{ev.targetBot ? ` to ${ev.targetBot}` : ''}
                        </span>
                      )}
                    </div>
                    {ev.botEvents.length > 0 && (
                      <div className="text-xs text-zinc-500">
                        {ev.botEvents.join(' · ')}
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      onSelectRound(ev.idx);
                      onClose();
                    }}
                    className="inline-flex min-h-[34px] items-center self-start sm:self-center rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:border-sky-500 hover:text-sky-700 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Inspect R{ev.roundNumber}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 bg-zinc-50 px-6 py-4">
          <span className="text-xs text-zinc-500">
            Click any card name to inspect oracle rules, or jump into any round.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] rounded-lg bg-sky-700 px-5 py-2 text-xs sm:text-sm font-semibold text-white hover:bg-sky-800 cursor-pointer"
          >
            Continue to Match Details
          </button>
        </div>
      </div>
    </div>
  );
};
