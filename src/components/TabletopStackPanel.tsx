import React, { useMemo, useState } from 'react';
import {
  Ban,
  BookOpen,
  Check,
  Coins,
  Droplets,
  Flame,
  Heart,
  Layers,
  Shield,
  ShieldAlert,
  Sparkles,
  Swords,
  Zap,
} from 'lucide-react';
import type { CardMetadata } from '../types/deck';
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

export interface StackHandCardSummary {
  uid: string;
  name: string;
  cmc: number;
  typeLine: string;
  meta: CardMetadata | null;
}

export interface StackPlayerCreatureSummary {
  uid: string;
  name: string;
  power: number;
  toughness: number;
  isCommander: boolean;
  protectedUntilEot?: boolean;
}

export interface StackCastResponseOptions {
  targetStackItemId?: string;
  targetPlayerCreatureUid?: string;
  targetBotId?: string;
  targetBotCreatureUid?: string;
}

interface TabletopStackPanelProps {
  stackItems: StackItem[];
  handCards: StackHandCardSummary[];
  playerCreatures: StackPlayerCreatureSummary[];
  liveBots: LiveBotState[];
  activatedAbilities?: ActivatedAbilityOption[];
  totalAvailableMana: number;
  totalManaPool: number;
  untappedLandsCount: number;
  hasCommanderInPlay: boolean;
  onCastResponse: (cardUid: string, options: StackCastResponseOptions) => void;
  onActivateAbility?: (
    ability: ActivatedAbilityOption,
    options: StackCastResponseOptions
  ) => void;
  onResolveTop: () => void;
  onResolveAll: () => void;
  onTapAllUntappedLands: () => void;
  onInspectCard: (name: string) => void;
  theme?: 'tabletop' | 'light';
}

export const TabletopStackPanel: React.FC<TabletopStackPanelProps> = ({
  stackItems,
  handCards,
  playerCreatures,
  liveBots,
  activatedAbilities = [],
  totalAvailableMana,
  totalManaPool,
  untappedLandsCount,
  hasCommanderInPlay,
  onCastResponse,
  onActivateAbility,
  onResolveTop,
  onResolveAll,
  onTapAllUntappedLands,
  onInspectCard,
  theme = 'tabletop',
}) => {
  const isDark = theme === 'tabletop';

  // Build available enemy targets for instant removal / burn
  const botCreatureTargets = useMemo(() => {
    const list: Array<{
      key: string;
      botId: string;
      botName: string;
      creatureUid: string;
      creatureName: string;
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
          botName: bot.name,
          creatureUid: c.uid,
          creatureName: c.name,
          label: `${bot.name}'s ${c.name} (${c.power}/${c.toughness})`,
          score: c.power * 2 + c.toughness + (c.isCommander ? 10 : 0),
        });
      }
    }
    return list.sort((a, b) => b.score - a.score);
  }, [liveBots]);

  // Default counterspell target: topmost uncountered, counterable opponent spell
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

  // Default protection/pump target: your creature targeted by a bot spell on stack, else biggest creature
  const defaultPlayerCreatureUid = useMemo(() => {
    const targetedByBot = [...stackItems]
      .reverse()
      .find((item) => !item.countered && item.targetPlayerCreatureUid)?.targetPlayerCreatureUid;
    if (targetedByBot && playerCreatures.some((c) => c.uid === targetedByBot)) {
      return targetedByBot;
    }
    const sorted = [...playerCreatures].sort(
      (a, b) => (b.isCommander ? 100 : 0) + b.power - ((a.isCommander ? 100 : 0) + a.power)
    );
    return sorted[0]?.uid || '';
  }, [stackItems, playerCreatures]);

  const [selectedCounterTargetId, setSelectedCounterTargetId] = useState<string>('');
  const [selectedBotCreatureKey, setSelectedBotCreatureKey] = useState<string>('');
  const [selectedPlayerCreatureUid, setSelectedPlayerCreatureUid] = useState<string>('');

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

  const instantCards = useMemo(() => {
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

  const reversedStack = useMemo(
    () =>
      stackItems
        .map((item, idx) => ({ item, stackNumber: idx + 1 }))
        .reverse(),
    [stackItems]
  );

  const topItem = stackItems[stackItems.length - 1];
  const hasCounterWar = stackItems.length >= 2;

  const needsCounterTargetSelect =
    counterableStackItems.length > 1 &&
    (instantCards.some((c) => c.profile.mechanic === 'counterspell') ||
      activatedAbilities.some((a) => a.effectKind === 'counterspell'));
  const needsBotCreatureTargetSelect =
    botCreatureTargets.length > 0 &&
    (instantCards.some(
      (c) =>
        c.profile.mechanic === 'instant-removal' ||
        c.profile.mechanic === 'burn-or-drain'
    ) ||
      activatedAbilities.some((a) => a.effectKind === 'removal-damage'));
  const needsPlayerCreatureTargetSelect =
    playerCreatures.length > 0 &&
    (instantCards.some(
      (c) =>
        (c.profile.mechanic === 'protection' && !c.profile.protectsWholeBoard) ||
        c.profile.mechanic === 'combat-trick'
    ) ||
      activatedAbilities.some(
        (a) =>
          (a.effectKind === 'protection' && !a.protectsWholeBoard) ||
          a.effectKind === 'pump'
      ));

  const handleClickCast = (cardUid: string, mechanic: StackItem['mechanic'], protectsWholeBoard: boolean) => {
    if (mechanic === 'counterspell') {
      if (!effectiveCounterTargetId) return;
      onCastResponse(cardUid, { targetStackItemId: effectiveCounterTargetId });
      return;
    }
    if (mechanic === 'instant-removal' || mechanic === 'burn-or-drain') {
      const targetInfo = botCreatureTargets.find((t) => t.key === effectiveBotCreatureKey);
      if (targetInfo) {
        onCastResponse(cardUid, {
          targetBotId: targetInfo.botId,
          targetBotCreatureUid: targetInfo.creatureUid,
        });
      } else {
        const aliveBot = liveBots.find((b) => !b.eliminated);
        onCastResponse(cardUid, { targetBotId: aliveBot?.id });
      }
      return;
    }
    if ((mechanic === 'protection' && !protectsWholeBoard) || mechanic === 'combat-trick') {
      onCastResponse(cardUid, {
        targetPlayerCreatureUid: effectivePlayerCreatureUid || undefined,
      });
      return;
    }
    onCastResponse(cardUid, {});
  };

  const handleClickActivate = (ability: ActivatedAbilityOption) => {
    if (!onActivateAbility) return;
    if (ability.effectKind === 'counterspell') {
      if (!effectiveCounterTargetId) return;
      onActivateAbility(ability, { targetStackItemId: effectiveCounterTargetId });
      return;
    }
    if (ability.effectKind === 'removal-damage') {
      const targetInfo = botCreatureTargets.find((t) => t.key === effectiveBotCreatureKey);
      if (targetInfo) {
        onActivateAbility(ability, {
          targetBotId: targetInfo.botId,
          targetBotCreatureUid: targetInfo.creatureUid,
        });
      } else {
        const aliveBot = liveBots.find((b) => !b.eliminated);
        onActivateAbility(ability, { targetBotId: aliveBot?.id });
      }
      return;
    }
    if (
      (ability.effectKind === 'protection' && !ability.protectsWholeBoard) ||
      ability.effectKind === 'pump'
    ) {
      onActivateAbility(ability, {
        targetPlayerCreatureUid: effectivePlayerCreatureUid || undefined,
      });
      return;
    }
    onActivateAbility(ability, {});
  };

  if (stackItems.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="Interactive Spell Stack and Priority"
      className={`rounded-xl border-2 p-4 space-y-3.5 shadow-lg ${
        isDark
          ? 'border-sky-400/90 bg-[#0D2137]/95 text-sky-50'
          : 'border-sky-500 bg-sky-50/90 text-zinc-900'
      }`}
    >
      {/* Header: Stack Depth + Priority Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${
              isDark
                ? 'bg-sky-500/25 text-sky-200 border border-sky-400/50'
                : 'bg-sky-700 text-white'
            }`}
          >
            <Layers className="h-3.5 w-3.5 shrink-0" />
            <span>The Stack</span>
          </div>
          <span
            className={`font-mono text-xs font-bold tabular-nums ${
              isDark ? 'text-amber-300' : 'text-sky-800'
            }`}
          >
            {stackItems.length} {stackItems.length === 1 ? 'Spell' : 'Spells'} · LIFO
          </span>
          {hasCounterWar && (
            <span
              className={`rounded-md border px-2 py-0.5 text-[11px] font-bold ${
                isDark
                  ? 'border-amber-400/60 bg-amber-500/20 text-amber-200'
                  : 'border-amber-300 bg-amber-100 text-amber-900'
              }`}
            >
              Stack War Active
            </span>
          )}
          <span
            className={`text-xs ${isDark ? 'text-sky-200/90' : 'text-zinc-600'}`}
          >
            Priority: <strong className={isDark ? 'text-white' : 'text-zinc-900'}>You</strong>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {untappedLandsCount > 0 && (
            <button
              type="button"
              onClick={onTapAllUntappedLands}
              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 ${
                isDark
                  ? 'border-sky-400/40 bg-sky-950/60 text-sky-200 hover:bg-sky-900/70'
                  : 'border-sky-300 bg-white text-sky-800 hover:bg-sky-100'
              }`}
            >
              <Droplets className="h-3.5 w-3.5" />
              Tap Lands ({untappedLandsCount})
            </button>
          )}
          {stackItems.length > 1 && (
            <button
              type="button"
              onClick={onResolveTop}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 ${
                isDark
                  ? 'border-amber-400/70 bg-amber-500/20 text-amber-200 hover:bg-amber-500/30'
                  : 'border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100'
              }`}
            >
              <Zap className="h-3.5 w-3.5" />
              Resolve Top (#{stackItems.length})
            </button>
          )}
          <button
            type="button"
            onClick={onResolveAll}
            className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-bold cursor-pointer whitespace-nowrap shrink-0 ${
              isDark
                ? 'bg-sky-500 text-zinc-950 hover:bg-sky-400'
                : 'bg-sky-700 text-white hover:bg-sky-800'
            }`}
          >
            <Check className="h-3.5 w-3.5" />
            {stackItems.length > 1 ? 'Resolve Entire Stack' : 'Pass Priority & Resolve'}
          </button>
        </div>
      </div>

      {/* LIFO Visual Stack Tower (Top resolves first!) */}
      <div className="space-y-2">
        {reversedStack.map(({ item, stackNumber }, visualIdx) => {
          const isTop = visualIdx === 0;
          const imgUrl = item.meta?.imageUri;
          return (
            <div
              key={item.id}
              className={`rounded-lg border p-2.5 flex items-start gap-3 transition-colors ${
                item.countered
                  ? isDark
                    ? 'border-red-500/40 bg-red-950/30 opacity-65'
                    : 'border-red-200 bg-red-50/60 opacity-70'
                  : isTop
                  ? isDark
                    ? 'border-amber-400/80 bg-[#132E4B]'
                    : 'border-sky-400 bg-white shadow-sm'
                  : isDark
                  ? 'border-sky-500/35 bg-[#0A192A]/90'
                  : 'border-zinc-200 bg-white/85'
              }`}
            >
              {/* Rank Indicator */}
              <div className="flex flex-col items-center gap-1 shrink-0 pt-0.5">
                <span
                  className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    isTop
                      ? isDark
                        ? 'bg-amber-400 text-zinc-950'
                        : 'bg-amber-500 text-white'
                      : isDark
                      ? 'bg-sky-900 text-sky-200'
                      : 'bg-zinc-200 text-zinc-700'
                  }`}
                >
                  #{stackNumber}
                </span>
                {isTop && (
                  <span
                    className={`font-mono text-[9px] font-bold uppercase ${
                      isDark ? 'text-amber-300' : 'text-amber-700'
                    }`}
                  >
                    TOP
                  </span>
                )}
              </div>

              {/* Card Thumbnail */}
              <button
                type="button"
                onMouseEnter={(e) =>
                  showGlobalCardHover({
                    name: item.cardName,
                    meta: item.meta ?? null,
                    rect: buildHoverRect(e.currentTarget),
                    statusTags: [
                      item.seatLabel,
                      item.mechanicBadge,
                      item.countered ? 'Countered' : 'On Stack',
                    ],
                  })
                }
                onMouseLeave={hideGlobalCardHover}
                onClick={() => {
                  hideGlobalCardHover();
                  onInspectCard(item.cardName);
                }}
                title={`Inspect ${item.cardName}`}
                className="h-14 w-10 rounded overflow-hidden border border-zinc-600/60 bg-zinc-900 shrink-0 cursor-pointer hover:ring-2 hover:ring-sky-400"
              >
                {imgUrl ? (
                  <img
                    src={imgUrl}
                    alt={item.cardName}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="h-full w-full flex items-center justify-center p-1 text-[8px] font-bold text-center text-zinc-200 leading-tight">
                    {item.cardName.slice(0, 14)}
                  </div>
                )}
              </button>

              {/* Details */}
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={`text-[11px] font-bold px-1.5 py-0.5 rounded ${
                      item.controller === 'player'
                        ? isDark
                          ? 'bg-emerald-500/25 text-emerald-200 border border-emerald-400/40'
                          : 'bg-emerald-100 text-emerald-800'
                        : isDark
                        ? 'bg-red-500/25 text-red-200 border border-red-400/40'
                        : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {item.seatLabel}
                  </span>

                  <button
                    type="button"
                    onMouseEnter={(e) =>
                      showGlobalCardHover({
                        name: item.cardName,
                        meta: item.meta ?? null,
                        rect: buildHoverRect(e.currentTarget),
                        statusTags: [
                          item.seatLabel,
                          item.mechanicBadge,
                          item.countered ? 'Countered' : 'On Stack',
                        ],
                      })
                    }
                    onMouseLeave={hideGlobalCardHover}
                    onClick={() => {
                      hideGlobalCardHover();
                      onInspectCard(item.cardName);
                    }}
                    className={`text-xs font-bold hover:underline cursor-pointer ${
                      item.countered ? 'line-through opacity-75' : ''
                    } ${isDark ? 'text-white' : 'text-zinc-900'}`}
                  >
                    {item.cardName}
                  </button>

                  <span
                    className={`font-mono text-[10px] ${
                      isDark ? 'text-sky-300' : 'text-zinc-500'
                    }`}
                  >
                    (MV {item.cmc})
                  </span>

                  <span
                    className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                      isDark
                        ? 'border-sky-400/40 bg-sky-900/60 text-sky-200'
                        : 'border-sky-200 bg-sky-50 text-sky-800'
                    }`}
                  >
                    {item.mechanicBadge}
                  </span>

                  {item.uncounterable && (
                    <span
                      className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        isDark
                          ? 'bg-amber-500/25 text-amber-200 border border-amber-400/50'
                          : 'bg-amber-100 text-amber-900 border border-amber-300'
                      }`}
                    >
                      <Ban className="h-2.5 w-2.5" />
                      Can&rsquo;t Be Countered
                    </span>
                  )}

                  {item.countered && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-600 text-white">
                      COUNTERED{item.counteredByName ? ` by ${item.counteredByName}` : ''}
                    </span>
                  )}
                </div>

                <div
                  className={`text-[11px] ${
                    isDark ? 'text-sky-100/90' : 'text-zinc-700'
                  }`}
                >
                  <span className={isDark ? 'text-sky-300 font-semibold' : 'text-sky-700 font-semibold'}>
                    ↳ Target / Effect:
                  </span>{' '}
                  {item.targetSummary}
                </div>

                {item.botReactionNote && (
                  <div
                    className={`text-[10px] italic ${
                      isDark ? 'text-amber-200/85' : 'text-amber-800'
                    }`}
                  >
                    Bot Read: {item.botReactionNote}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Player Instant-Speed Response Bar */}
      <div
        className={`rounded-lg border p-3 space-y-2.5 ${
          isDark
            ? 'border-sky-400/35 bg-[#081524]/90'
            : 'border-sky-200 bg-white'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-bold">
            <Sparkles className={`h-3.5 w-3.5 ${isDark ? 'text-amber-300' : 'text-sky-700'}`} />
            <span>Your Instant-Speed Responses</span>
            <span
              className={`font-mono text-[11px] font-semibold tabular-nums ${
                isDark ? 'text-sky-300' : 'text-zinc-600'
              }`}
            >
              ({totalAvailableMana} mana open · Pool {totalManaPool} + {untappedLandsCount} untapped)
            </span>
          </div>

          {topItem && (
            <span className={`text-[11px] ${isDark ? 'text-sky-200/80' : 'text-zinc-500'}`}>
              Responding to <strong>{topItem.cardName}</strong>
            </span>
          )}
        </div>

        {/* Optional Smart Target Selectors when relevant instant types are in hand */}
        {(needsCounterTargetSelect ||
          needsBotCreatureTargetSelect ||
          needsPlayerCreatureTargetSelect) && (
          <div className="flex flex-wrap items-center gap-3 text-[11px]">
            {needsCounterTargetSelect && (
              <label className="inline-flex items-center gap-1.5">
                <span className={isDark ? 'text-sky-200 font-semibold' : 'text-zinc-600 font-semibold'}>
                  Counter Target:
                </span>
                <select
                  value={effectiveCounterTargetId}
                  onChange={(e) => setSelectedCounterTargetId(e.target.value)}
                  className={`rounded border px-2 py-1 text-[11px] font-medium ${
                    isDark
                      ? 'border-sky-500/50 bg-[#0D2137] text-white'
                      : 'border-zinc-300 bg-zinc-50 text-zinc-900'
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
                <span className={isDark ? 'text-sky-200 font-semibold' : 'text-zinc-600 font-semibold'}>
                  Removal / Burn Target:
                </span>
                <select
                  value={effectiveBotCreatureKey}
                  onChange={(e) => setSelectedBotCreatureKey(e.target.value)}
                  className={`rounded border px-2 py-1 text-[11px] font-medium ${
                    isDark
                      ? 'border-sky-500/50 bg-[#0D2137] text-white'
                      : 'border-zinc-300 bg-zinc-50 text-zinc-900'
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
                <span className={isDark ? 'text-sky-200 font-semibold' : 'text-zinc-600 font-semibold'}>
                  Protect / Buff Creature:
                </span>
                <select
                  value={effectivePlayerCreatureUid}
                  onChange={(e) => setSelectedPlayerCreatureUid(e.target.value)}
                  className={`rounded border px-2 py-1 text-[11px] font-medium ${
                    isDark
                      ? 'border-sky-500/50 bg-[#0D2137] text-white'
                      : 'border-zinc-300 bg-zinc-50 text-zinc-900'
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

        {instantCards.length === 0 ? (
          <div className={`text-xs ${isDark ? 'text-sky-200/75' : 'text-zinc-500'}`}>
            No Instant or Flash spells in your hand right now. Click{' '}
            <strong>Pass Priority &amp; Resolve</strong> to continue.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {instantCards.map(({ card, profile, effectiveCost, canAfford }) => {
              const isCounter = profile.mechanic === 'counterspell';
              const noCounterTarget = isCounter && !effectiveCounterTargetId;
              const disabled = !canAfford || noCounterTarget;

              const Icon =
                profile.mechanic === 'counterspell'
                  ? ShieldAlert
                  : profile.mechanic === 'protection' || profile.mechanic === 'fog'
                  ? Shield
                  : profile.mechanic === 'instant-removal' || profile.mechanic === 'burn-or-drain'
                  ? Flame
                  : profile.mechanic === 'instant-draw'
                  ? BookOpen
                  : profile.mechanic === 'flash-creature' || profile.mechanic === 'combat-trick'
                  ? Swords
                  : Zap;

              const badgeStyle =
                profile.mechanic === 'counterspell'
                  ? isDark
                    ? 'border-sky-400/70 bg-sky-600/30 text-sky-100 hover:bg-sky-600/45'
                    : 'border-sky-400 bg-sky-50 text-sky-900 hover:bg-sky-100'
                  : profile.mechanic === 'protection' || profile.mechanic === 'fog'
                  ? isDark
                    ? 'border-emerald-400/70 bg-emerald-600/30 text-emerald-100 hover:bg-emerald-600/45'
                    : 'border-emerald-400 bg-emerald-50 text-emerald-900 hover:bg-emerald-100'
                  : profile.mechanic === 'instant-removal' || profile.mechanic === 'burn-or-drain'
                  ? isDark
                    ? 'border-red-400/70 bg-red-600/30 text-red-100 hover:bg-red-600/45'
                    : 'border-red-400 bg-red-50 text-red-900 hover:bg-red-100'
                  : isDark
                  ? 'border-amber-400/60 bg-amber-600/25 text-amber-100 hover:bg-amber-600/40'
                  : 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100';

              const targetNote = isCounter
                ? noCounterTarget
                  ? "Target can't be countered"
                  : `Counter ${
                      counterableStackItems.find((i) => i.id === effectiveCounterTargetId)
                        ?.cardName || 'spell'
                    }`
                : profile.mechanicLabel;

              return (
                <button
                  key={card.uid}
                  type="button"
                  disabled={disabled}
                  title={
                    noCounterTarget
                      ? "Current spell on stack can't be countered."
                      : !canAfford
                      ? `Needs ${effectiveCost} mana (${totalAvailableMana} available).`
                      : profile.summaryHint
                  }
                  onClick={() =>
                    handleClickCast(card.uid, profile.mechanic, profile.protectsWholeBoard)
                  }
                  className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-left text-xs font-semibold transition-colors ${
                    disabled
                      ? isDark
                        ? 'border-zinc-700 bg-zinc-900/60 text-zinc-500 cursor-not-allowed opacity-60'
                        : 'border-zinc-200 bg-zinc-100 text-zinc-400 cursor-not-allowed'
                      : `${badgeStyle} cursor-pointer`
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="font-bold">{card.name}</span>
                  <span className="font-mono text-[10px] opacity-90">
                    ({effectiveCost === 0 && profile.freeWithCommander ? 'Free · Cmdr' : `${effectiveCost} mana`})
                  </span>
                  <span className="text-[10px] opacity-85">· {targetNote}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Battlefield Activated Abilities (Mana Rocks, Tokens & Permanent Abilities) */}
        {activatedAbilities.length > 0 && onActivateAbility && (
          <div
            className={`border-t pt-2.5 space-y-1.5 ${
              isDark ? 'border-sky-400/25' : 'border-zinc-200'
            }`}
          >
            <div className="flex items-center gap-1.5 text-[11px] font-bold">
              <Zap className={`h-3 w-3 ${isDark ? 'text-emerald-300' : 'text-emerald-700'}`} />
              <span>Battlefield Activated Abilities</span>
            </div>
            <div className="flex flex-wrap gap-2">
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
                        ? "Current spell on stack can't be countered."
                        : ability.disabledReason || ability.summaryHint
                    }
                    onClick={() => handleClickActivate(ability)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                      disabled
                        ? isDark
                          ? 'border-zinc-700 bg-zinc-900/60 text-zinc-500 cursor-not-allowed opacity-60'
                          : 'border-zinc-200 bg-zinc-100 text-zinc-400 cursor-not-allowed'
                        : ability.effectKind === 'mana'
                        ? isDark
                          ? 'border-amber-400/70 bg-amber-600/25 text-amber-100 hover:bg-amber-600/40 cursor-pointer'
                          : 'border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100 cursor-pointer'
                        : isDark
                        ? 'border-emerald-400/70 bg-emerald-600/25 text-emerald-100 hover:bg-emerald-600/40 cursor-pointer'
                        : 'border-emerald-400 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 cursor-pointer'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="font-bold">{ability.permanentName}</span>
                    <span className="font-mono text-[10px] opacity-90">
                      · {ability.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
