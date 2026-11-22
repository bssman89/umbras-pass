import React, { useMemo, useState } from 'react';
import {
  Ban,
  Bell,
  BookOpen,
  Check,
  Clock,
  Coins,
  Droplets,
  Flame,
  Heart,
  Pause,
  Play,
  Shield,
  ShieldAlert,
  Sparkles,
  Swords,
  Zap,
} from 'lucide-react';
import type { LiveBotState } from '../utils/liveBotEngine';
import {
  classifyCardStackProfile,
  getEffectiveInstantCost,
  type ActivatedAbilityOption,
  type StackItem,
} from '../utils/liveStackEngine';
import {
  buildHoverRect,
  hideGlobalCardHover,
  showGlobalCardHover,
} from './CardHoverZoomOverlay';
import type {
  StackCastResponseOptions,
  StackHandCardSummary,
  StackPlayerCreatureSummary,
} from './TabletopStackPanel';

export type InterruptWindowMode = '12s' | '8s' | '20s' | 'manual' | 'smart-only';

interface InterruptResponseBannerProps {
  stackItems: StackItem[];
  handCards: StackHandCardSummary[];
  playerCreatures: StackPlayerCreatureSummary[];
  liveBots: LiveBotState[];
  activatedAbilities: ActivatedAbilityOption[];
  totalAvailableMana: number;
  untappedLandsCount: number;
  hasCommanderInPlay: boolean;
  countdownMs: number;
  totalWindowMs: number;
  isTimerHeld: boolean;
  windowMode: InterruptWindowMode;
  onToggleHoldTimer: () => void;
  onCastResponse: (cardUid: string, options: StackCastResponseOptions) => void;
  onActivateAbility: (
    ability: ActivatedAbilityOption,
    options: StackCastResponseOptions
  ) => void;
  onResolveTop: () => void;
  onResolveAll: () => void;
  onTapAllUntappedLands: () => void;
  onInspectCard: (name: string) => void;
  theme?: 'tabletop' | 'light';
}

export const InterruptResponseBanner: React.FC<InterruptResponseBannerProps> = ({
  stackItems,
  handCards,
  playerCreatures,
  liveBots,
  activatedAbilities,
  totalAvailableMana,
  untappedLandsCount,
  hasCommanderInPlay,
  countdownMs,
  totalWindowMs,
  isTimerHeld,
  windowMode,
  onToggleHoldTimer,
  onCastResponse,
  onActivateAbility,
  onResolveTop,
  onResolveAll,
  onTapAllUntappedLands,
  onInspectCard,
  theme = 'tabletop',
}) => {
  const isDark = theme === 'tabletop';
  const [selectedCounterTargetId, setSelectedCounterTargetId] = useState<string>('');
  const [selectedBotCreatureKey, setSelectedBotCreatureKey] = useState<string>('');
  const [selectedPlayerCreatureUid, setSelectedPlayerCreatureUid] = useState<string>('');

  const topItem = stackItems[stackItems.length - 1];
  const latestBotItem = useMemo(
    () => [...stackItems].reverse().find((item) => item.controller === 'bot') || topItem,
    [stackItems, topItem]
  );

  const counterableStackItems = useMemo(
    () =>
      [...stackItems]
        .reverse()
        .filter((item) => !item.countered && !item.uncounterable),
    [stackItems]
  );

  const defaultCounterTargetId = useMemo(() => {
    const oppTarget = counterableStackItems.find((item) => item.controller === 'bot');
    return oppTarget?.id || counterableStackItems[0]?.id || '';
  }, [counterableStackItems]);

  const botCreatureTargets = useMemo(() => {
    const list: Array<{
      key: string;
      botId: string;
      creatureUid: string;
      label: string;
      score: number;
    }> = [];
    for (const bot of liveBots) {
      if (bot.eliminated) continue;
      for (const c of bot.creatures) {
        if (c.hexproof) continue;
        list.push({
          key: `${bot.id}::${c.uid}`,
          botId: bot.id,
          creatureUid: c.uid,
          label: `${bot.name}'s ${c.name} (${c.power}/${c.toughness})`,
          score: c.power * 2 + c.toughness + (c.isCommander ? 10 : 0),
        });
      }
    }
    return list.sort((a, b) => b.score - a.score);
  }, [liveBots]);

  const defaultPlayerCreatureUid = useMemo(() => {
    const targeted = [...stackItems]
      .reverse()
      .find((item) => !item.countered && item.targetPlayerCreatureUid)?.targetPlayerCreatureUid;
    if (targeted && playerCreatures.some((c) => c.uid === targeted)) {
      return targeted;
    }
    const sorted = [...playerCreatures].sort(
      (a, b) => (b.isCommander ? 100 : 0) + b.power - ((a.isCommander ? 100 : 0) + a.power)
    );
    return sorted[0]?.uid || '';
  }, [stackItems, playerCreatures]);

  const effectiveCounterTargetId = counterableStackItems.some(
    (item) => item.id === selectedCounterTargetId
  )
    ? selectedCounterTargetId
    : defaultCounterTargetId;

  const effectiveBotCreatureKey = botCreatureTargets.some(
    (t) => t.key === selectedBotCreatureKey
  )
    ? selectedBotCreatureKey
    : botCreatureTargets[0]?.key || '';

  const effectivePlayerCreatureUid = playerCreatures.some(
    (c) => c.uid === selectedPlayerCreatureUid
  )
    ? selectedPlayerCreatureUid
    : defaultPlayerCreatureUid;

  const instantResponses = useMemo(() => {
    return handCards
      .map((card) => {
        const profile = classifyCardStackProfile(card.name, card.typeLine, card.meta);
        if (!profile.isInstantSpeed) return null;
        const effectiveCost = getEffectiveInstantCost(
          card.name,
          card.cmc,
          hasCommanderInPlay,
          profile
        );
        const canAfford = effectiveCost <= totalAvailableMana;
        return { card, profile, effectiveCost, canAfford };
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      .sort((a, b) => Number(b.canAfford) - Number(a.canAfford) || a.effectiveCost - b.effectiveCost);
  }, [handCards, hasCommanderInPlay, totalAvailableMana]);

  const readyInstantCount = instantResponses.filter((r) => r.canAfford).length;
  const readyAbilityCount = activatedAbilities.filter((a) => a.canActivate).length;
  const totalReadyCount = readyInstantCount + readyAbilityCount;

  const hasTimer = windowMode !== 'manual' && totalWindowMs > 0;
  const ratio = hasTimer ? Math.max(0, Math.min(1, countdownMs / totalWindowMs)) : 1;
  const secondsDisplay = (Math.max(0, countdownMs) / 1000).toFixed(1);
  const isUrgent = hasTimer && !isTimerHeld && countdownMs <= 2500;
  const isWarning = hasTimer && !isTimerHeld && countdownMs > 2500 && countdownMs <= 5000;

  const timerStatusText = !hasTimer
    ? 'Manual Priority'
    : isTimerHeld
    ? 'Timer Held'
    : isUrgent
    ? 'Closing Soon'
    : 'Response Window Open';

  const progressColorClass = isTimerHeld
    ? 'bg-sky-400'
    : isUrgent
    ? 'bg-red-500'
    : isWarning
    ? 'bg-amber-400'
    : isDark
    ? 'bg-emerald-400'
    : 'bg-sky-600';

  const buildTargetOptionsForInstant = (
    mechanic: StackItem['mechanic'],
    protectsWholeBoard: boolean
  ): StackCastResponseOptions => {
    if (mechanic === 'counterspell') {
      return { targetStackItemId: effectiveCounterTargetId || undefined };
    }
    if (mechanic === 'instant-removal' || mechanic === 'burn-or-drain') {
      const targetInfo = botCreatureTargets.find((t) => t.key === effectiveBotCreatureKey);
      if (targetInfo) {
        return {
          targetBotId: targetInfo.botId,
          targetBotCreatureUid: targetInfo.creatureUid,
        };
      }
      const aliveBot = liveBots.find((b) => !b.eliminated);
      return { targetBotId: aliveBot?.id };
    }
    if ((mechanic === 'protection' && !protectsWholeBoard) || mechanic === 'combat-trick') {
      return { targetPlayerCreatureUid: effectivePlayerCreatureUid || undefined };
    }
    return {};
  };

  const buildTargetOptionsForAbility = (
    ability: ActivatedAbilityOption
  ): StackCastResponseOptions => {
    if (ability.effectKind === 'counterspell') {
      return { targetStackItemId: effectiveCounterTargetId || undefined };
    }
    if (ability.effectKind === 'removal-damage') {
      const targetInfo = botCreatureTargets.find((t) => t.key === effectiveBotCreatureKey);
      if (targetInfo) {
        return {
          targetBotId: targetInfo.botId,
          targetBotCreatureUid: targetInfo.creatureUid,
        };
      }
      const aliveBot = liveBots.find((b) => !b.eliminated);
      return { targetBotId: aliveBot?.id };
    }
    if ((ability.effectKind === 'protection' && !ability.protectsWholeBoard) || ability.effectKind === 'pump') {
      return { targetPlayerCreatureUid: effectivePlayerCreatureUid || undefined };
    }
    return {};
  };

  const needsCounterTargetSelect =
    counterableStackItems.length > 1 &&
    (instantResponses.some((r) => r.profile.mechanic === 'counterspell') ||
      activatedAbilities.some((a) => a.effectKind === 'counterspell'));

  const needsBotCreatureTargetSelect =
    botCreatureTargets.length > 0 &&
    (instantResponses.some(
      (r) => r.profile.mechanic === 'instant-removal' || r.profile.mechanic === 'burn-or-drain'
    ) ||
      activatedAbilities.some((a) => a.effectKind === 'removal-damage'));

  const needsPlayerCreatureTargetSelect =
    playerCreatures.length > 0 &&
    (instantResponses.some(
      (r) =>
        (r.profile.mechanic === 'protection' && !r.profile.protectsWholeBoard) ||
        r.profile.mechanic === 'combat-trick'
    ) ||
      activatedAbilities.some(
        (a) => (a.effectKind === 'protection' && !a.protectsWholeBoard) || a.effectKind === 'pump'
      ));

  if (stackItems.length === 0 || !latestBotItem) return null;

  const imgUrl = latestBotItem.meta?.imageUri;

  return (
    <div
      role="alert"
      aria-live="polite"
      aria-label="Interrupt and Response Notification"
      className={`rounded-xl border transition-colors ${
        isDark
          ? isUrgent
            ? 'border-red-400/90 bg-[#1B1222]/95 text-white shadow-lg'
            : 'border-amber-400/80 bg-[#0B1F33]/95 text-white shadow-lg'
          : isUrgent
          ? 'border-red-400 bg-red-50/95 text-zinc-900 shadow-sm'
          : 'border-amber-400 bg-amber-50/90 text-zinc-900 shadow-sm'
      }`}
    >
      {/* Top Countdown Progress Bar (GPU-composited scaleX transform) */}
      {hasTimer && (
        <div
          className={`h-1.5 w-full overflow-hidden rounded-t-[11px] ${
            isDark ? 'bg-slate-800/90' : 'bg-zinc-200'
          }`}
        >
          <div
            className={`h-full w-full origin-left transition-transform duration-100 ease-linear ${progressColorClass}`}
            style={{ transform: `scaleX(${ratio})` }}
          />
        </div>
      )}

      <div className="p-3.5 sm:p-4 space-y-3">
        {/* Row 1: Bot Alert Summary + Live Timer + Priority Action Controls */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <button
              type="button"
              onMouseEnter={(e) =>
                showGlobalCardHover({
                  name: latestBotItem.cardName,
                  meta: latestBotItem.meta ?? null,
                  rect: buildHoverRect(e.currentTarget),
                  statusTags: [latestBotItem.seatLabel, latestBotItem.mechanicBadge],
                })
              }
              onMouseLeave={hideGlobalCardHover}
              onClick={() => {
                hideGlobalCardHover();
                onInspectCard(latestBotItem.cardName);
              }}
              title={`Inspect ${latestBotItem.cardName}`}
              className={`h-14 w-10 rounded-md overflow-hidden border shrink-0 cursor-pointer transition-transform hover:scale-105 ${
                isDark
                  ? 'border-amber-400/60 bg-slate-900'
                  : 'border-zinc-300 bg-zinc-900'
              }`}
            >
              {imgUrl ? (
                <img
                  src={imgUrl}
                  alt={`${latestBotItem.cardName} card art`}
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="h-full w-full flex items-center justify-center p-1 text-[8px] font-bold text-center text-zinc-200 leading-tight">
                  {latestBotItem.cardName.slice(0, 14)}
                </div>
              )}
            </button>

            <div className="min-w-0 flex-1 space-y-1">
              <div
                className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs ${
                  isDark ? 'text-amber-200' : 'text-amber-900'
                }`}
              >
                <span className="inline-flex items-center gap-1.5 font-bold">
                  <Bell className="h-3.5 w-3.5 shrink-0" />
                  Interrupt / Response Alert
                </span>
                <span aria-hidden="true" className="opacity-50">
                  ·
                </span>
                <span className="font-semibold">{latestBotItem.seatLabel}</span>
                <span aria-hidden="true" className="opacity-50">
                  ·
                </span>
                <span className="font-mono tabular-nums">MV {latestBotItem.cmc}</span>
                <span aria-hidden="true" className="opacity-50">
                  ·
                </span>
                <span>{latestBotItem.mechanicBadge}</span>
                {latestBotItem.uncounterable && (
                  <>
                    <span aria-hidden="true" className="opacity-50">
                      ·
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 font-bold ${
                        isDark ? 'text-amber-300' : 'text-red-700'
                      }`}
                    >
                      <Ban className="h-3 w-3" />
                      Can&rsquo;t Be Countered
                    </span>
                  </>
                )}
              </div>

              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <button
                  type="button"
                  onClick={() => onInspectCard(latestBotItem.cardName)}
                  className={`text-sm font-bold hover:underline cursor-pointer ${
                    isDark ? 'text-white' : 'text-zinc-950'
                  }`}
                >
                  {latestBotItem.controllerName} played {latestBotItem.cardName}
                </button>
                <span
                  className={`text-xs ${isDark ? 'text-sky-200/90' : 'text-zinc-700'}`}
                >
                  — {latestBotItem.targetSummary}
                </span>
              </div>

              <div
                className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] ${
                  isDark ? 'text-slate-300' : 'text-zinc-600'
                }`}
              >
                <span className="inline-flex items-center gap-1 font-semibold">
                  <Clock className="h-3 w-3 shrink-0" />
                  {timerStatusText}
                </span>
                {hasTimer && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span
                      className={`font-mono font-bold tabular-nums ${
                        isTimerHeld
                          ? isDark
                            ? 'text-sky-300'
                            : 'text-sky-700'
                          : isUrgent
                          ? isDark
                            ? 'text-red-300'
                            : 'text-red-700'
                          : isDark
                          ? 'text-amber-300'
                          : 'text-amber-800'
                      }`}
                    >
                      {isTimerHeld ? `${secondsDisplay}s (Held)` : `${secondsDisplay}s remaining`}
                    </span>
                  </>
                )}
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  {totalAvailableMana} mana open
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  {totalReadyCount} response{totalReadyCount === 1 ? '' : 's'} ready
                </span>
              </div>
            </div>
          </div>

          {/* Action Buttons (single-line, high-contrast, keyboard hints) */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {untappedLandsCount > 0 && (
              <button
                type="button"
                onClick={onTapAllUntappedLands}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
                  isDark
                    ? 'border-sky-400/50 bg-sky-950/70 text-sky-100 hover:bg-sky-900'
                    : 'border-sky-300 bg-white text-sky-800 hover:bg-sky-50'
                }`}
              >
                <Droplets className="h-3.5 w-3.5" />
                Tap Lands ({untappedLandsCount})
              </button>
            )}

            {hasTimer && (
              <button
                type="button"
                onClick={onToggleHoldTimer}
                aria-pressed={isTimerHeld}
                title="Pause or resume the response countdown timer (Shortcut: H)"
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
                  isTimerHeld
                    ? isDark
                      ? 'border-sky-400 bg-sky-500/25 text-sky-100 hover:bg-sky-500/35'
                      : 'border-sky-500 bg-sky-100 text-sky-900 hover:bg-sky-200'
                    : isDark
                    ? 'border-amber-400/60 bg-amber-500/15 text-amber-100 hover:bg-amber-500/25'
                    : 'border-amber-400 bg-white text-amber-900 hover:bg-amber-100'
                }`}
              >
                {isTimerHeld ? (
                  <>
                    <Play className="h-3.5 w-3.5" />
                    Resume Timer (H)
                  </>
                ) : (
                  <>
                    <Pause className="h-3.5 w-3.5" />
                    Hold Priority (H)
                  </>
                )}
              </button>
            )}

            {stackItems.length > 1 && (
              <button
                type="button"
                onClick={onResolveTop}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
                  isDark
                    ? 'border-slate-500 bg-slate-800 text-slate-100 hover:bg-slate-700'
                    : 'border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-100'
                }`}
              >
                <Zap className="h-3.5 w-3.5" />
                Resolve Top
              </button>
            )}

            <button
              type="button"
              onClick={onResolveAll}
              title="Pass priority and resolve the stack immediately (Shortcut: Space)"
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-bold cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
                isDark
                  ? 'bg-emerald-500 text-zinc-950 hover:bg-emerald-400'
                  : 'bg-sky-700 text-white hover:bg-sky-800'
              }`}
            >
              <Check className="h-3.5 w-3.5" />
              {stackItems.length > 1 ? 'Resolve Stack (Space)' : 'Pass & Resolve (Space)'}
            </button>
          </div>
        </div>

        {/* Optional Target Selectors when player has targeted instants or abilities */}
        {(needsCounterTargetSelect ||
          needsBotCreatureTargetSelect ||
          needsPlayerCreatureTargetSelect) && (
          <div
            className={`flex flex-wrap items-center gap-3 border-t pt-2.5 text-[11px] ${
              isDark ? 'border-slate-700/80' : 'border-amber-200/90'
            }`}
          >
            {needsCounterTargetSelect && (
              <label className="inline-flex items-center gap-1.5">
                <span className={isDark ? 'text-sky-200 font-semibold' : 'text-zinc-700 font-semibold'}>
                  Counter Target:
                </span>
                <select
                  value={effectiveCounterTargetId}
                  onChange={(e) => setSelectedCounterTargetId(e.target.value)}
                  className={`rounded border px-2 py-1 text-[11px] font-medium ${
                    isDark
                      ? 'border-sky-500/50 bg-[#0D2137] text-white'
                      : 'border-zinc-300 bg-white text-zinc-900'
                  }`}
                >
                  {counterableStackItems.map((si) => (
                    <option key={si.id} value={si.id}>
                      {si.cardName} ({si.controllerName})
                    </option>
                  ))}
                </select>
              </label>
            )}

            {needsBotCreatureTargetSelect && (
              <label className="inline-flex items-center gap-1.5">
                <span className={isDark ? 'text-sky-200 font-semibold' : 'text-zinc-700 font-semibold'}>
                  Removal Target:
                </span>
                <select
                  value={effectiveBotCreatureKey}
                  onChange={(e) => setSelectedBotCreatureKey(e.target.value)}
                  className={`rounded border px-2 py-1 text-[11px] font-medium ${
                    isDark
                      ? 'border-sky-500/50 bg-[#0D2137] text-white'
                      : 'border-zinc-300 bg-white text-zinc-900'
                  }`}
                >
                  {botCreatureTargets.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {needsPlayerCreatureTargetSelect && (
              <label className="inline-flex items-center gap-1.5">
                <span className={isDark ? 'text-sky-200 font-semibold' : 'text-zinc-700 font-semibold'}>
                  Protect / Buff Target:
                </span>
                <select
                  value={effectivePlayerCreatureUid}
                  onChange={(e) => setSelectedPlayerCreatureUid(e.target.value)}
                  className={`rounded border px-2 py-1 text-[11px] font-medium ${
                    isDark
                      ? 'border-sky-500/50 bg-[#0D2137] text-white'
                      : 'border-zinc-300 bg-white text-zinc-900'
                  }`}
                >
                  {playerCreatures.map((c) => (
                    <option key={c.uid} value={c.uid}>
                      {c.name} ({c.power}/{c.toughness})
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}

        {/* Row 2: Instant Spells & Activated Abilities Quick-Action Strip */}
        <div
          className={`border-t pt-2.5 space-y-2 ${
            isDark ? 'border-slate-700/80' : 'border-amber-200/90'
          }`}
        >
          {instantResponses.length === 0 && activatedAbilities.length === 0 ? (
            <div
              className={`text-xs ${isDark ? 'text-slate-300' : 'text-zinc-700'}`}
            >
              No Instant/Flash spells in hand or instant-speed activated abilities on board.{' '}
              {hasTimer && !isTimerHeld
                ? `Auto-resolving in ${secondsDisplay}s — click Hold Priority to inspect or Pass & Resolve to continue immediately.`
                : 'Click Pass & Resolve to let the spell resolve.'}
            </div>
          ) : (
            <div className="space-y-2">
              {instantResponses.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1 text-[11px] font-bold whitespace-nowrap ${
                      isDark ? 'text-sky-300' : 'text-sky-800'
                    }`}
                  >
                    <Sparkles className="h-3 w-3" />
                    Instants &amp; Flash:
                  </span>
                  {instantResponses.map(({ card, profile, effectiveCost, canAfford }) => {
                    const isCounter = profile.mechanic === 'counterspell';
                    const noCounterTarget = isCounter && !effectiveCounterTargetId;
                    const disabled = !canAfford || noCounterTarget;
                    const Icon =
                      profile.mechanic === 'counterspell'
                        ? ShieldAlert
                        : profile.mechanic === 'protection' || profile.mechanic === 'fog'
                        ? Shield
                        : profile.mechanic === 'instant-removal' ||
                          profile.mechanic === 'burn-or-drain'
                        ? Flame
                        : profile.mechanic === 'instant-draw'
                        ? BookOpen
                        : profile.mechanic === 'flash-creature' ||
                          profile.mechanic === 'combat-trick'
                        ? Swords
                        : Zap;

                    return (
                      <button
                        key={card.uid}
                        type="button"
                        disabled={disabled}
                        title={
                          noCounterTarget
                            ? "Target spell can't be countered."
                            : !canAfford
                            ? `Requires ${effectiveCost} mana (${totalAvailableMana} open).`
                            : profile.summaryHint
                        }
                        onClick={() =>
                          onCastResponse(
                            card.uid,
                            buildTargetOptionsForInstant(
                              profile.mechanic,
                              profile.protectsWholeBoard
                            )
                          )
                        }
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                          disabled
                            ? isDark
                              ? 'border-slate-700 bg-slate-900/60 text-slate-500 cursor-not-allowed'
                              : 'border-zinc-200 bg-zinc-100 text-zinc-400 cursor-not-allowed'
                            : isDark
                            ? 'border-sky-400/75 bg-sky-600/30 text-sky-100 hover:bg-sky-600/45 cursor-pointer'
                            : 'border-sky-400 bg-white text-sky-900 hover:bg-sky-50 cursor-pointer'
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0" />
                        <span>{card.name}</span>
                        <span className="font-mono text-[10px] opacity-85 tabular-nums">
                          ({effectiveCost === 0 && profile.freeWithCommander ? 'Free' : `${effectiveCost}m`})
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {activatedAbilities.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1 text-[11px] font-bold whitespace-nowrap ${
                      isDark ? 'text-emerald-300' : 'text-emerald-800'
                    }`}
                  >
                    <Zap className="h-3 w-3" />
                    Activated Abilities:
                  </span>
                  {activatedAbilities.map((ability) => {
                    const isCounter = ability.effectKind === 'counterspell';
                    const noCounterTarget = isCounter && !effectiveCounterTargetId;
                    const disabled = !ability.canActivate || noCounterTarget;
                    const Icon =
                      ability.effectKind === 'mana'
                        ? Coins
                        : ability.effectKind === 'counterspell'
                        ? ShieldAlert
                        : ability.effectKind === 'protection'
                        ? Shield
                        : ability.effectKind === 'lifegain'
                        ? Heart
                        : ability.effectKind === 'removal-damage'
                        ? Flame
                        : ability.effectKind === 'draw' || ability.effectKind === 'scry'
                        ? BookOpen
                        : Swords;

                    return (
                      <button
                        key={ability.id}
                        type="button"
                        disabled={disabled}
                        title={
                          noCounterTarget
                            ? "Target spell can't be countered."
                            : ability.disabledReason || ability.summaryHint
                        }
                        onClick={() =>
                          onActivateAbility(ability, buildTargetOptionsForAbility(ability))
                        }
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                          disabled
                            ? isDark
                              ? 'border-slate-700 bg-slate-900/60 text-slate-500 cursor-not-allowed'
                              : 'border-zinc-200 bg-zinc-100 text-zinc-400 cursor-not-allowed'
                            : ability.effectKind === 'mana'
                            ? isDark
                              ? 'border-amber-400/70 bg-amber-500/20 text-amber-100 hover:bg-amber-500/35 cursor-pointer'
                              : 'border-amber-400 bg-white text-amber-900 hover:bg-amber-50 cursor-pointer'
                            : isDark
                            ? 'border-emerald-400/70 bg-emerald-600/25 text-emerald-100 hover:bg-emerald-600/40 cursor-pointer'
                            : 'border-emerald-400 bg-white text-emerald-900 hover:bg-emerald-50 cursor-pointer'
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0" />
                        <span>{ability.permanentName}</span>
                        <span className="font-mono text-[10px] opacity-85">
                          · {ability.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
