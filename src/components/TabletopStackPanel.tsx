import React, { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Ban,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  Coins,
  Droplets,
  Flame,
  Heart,
  History,
  Layers,
  Plus,
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
  type ResolvedStackHistoryEntry,
  type StackItem,
  type TriggerAbilityKind,
} from '../utils/liveStackEngine';
import {
  buildHoverRect,
  hideGlobalCardHover,
  showGlobalCardHover,
} from './CardHoverZoomOverlay';
import {
  getScryfallFallbackImageUri,
  resolveCardWithCustomProxy,
} from '../utils/customCardProxiesAndTokens';

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

export interface StackBoardPermanentSummary {
  uid: string;
  name: string;
  typeLine: string;
  isCreature: boolean;
  isLand: boolean;
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
  boardPermanents?: StackBoardPermanentSummary[];
  liveBots: LiveBotState[];
  activatedAbilities?: ActivatedAbilityOption[];
  resolvedStackHistory?: ResolvedStackHistoryEntry[];
  queueAllSpellsOnStack?: boolean;
  onToggleQueueAllSpellsOnStack?: () => void;
  onReorderStackItem?: (itemId: string, direction: 'up' | 'down') => void;
  onQueueManualTrigger?: (permanentUid: string, triggerKind: TriggerAbilityKind) => void;
  onClearResolvedHistory?: () => void;
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

const TRIGGER_KIND_OPTIONS: Array<{ value: TriggerAbilityKind; label: string }> = [
  { value: 'etb', label: 'ETB (Enters Battlefield)' },
  { value: 'landfall', label: 'Landfall Trigger' },
  { value: 'cast', label: 'Cast / Spellslinger Trigger' },
  { value: 'upkeep', label: 'Upkeep Trigger' },
  { value: 'attack', label: 'Combat Attack Trigger' },
  { value: 'dies', label: 'Dies / Aristocrats Trigger' },
  { value: 'end-step', label: 'End Step Trigger' },
];

export const TabletopStackPanel: React.FC<TabletopStackPanelProps> = ({
  stackItems,
  handCards,
  playerCreatures,
  boardPermanents = [],
  liveBots,
  activatedAbilities = [],
  resolvedStackHistory = [],
  queueAllSpellsOnStack = true,
  onToggleQueueAllSpellsOnStack,
  onReorderStackItem,
  onQueueManualTrigger,
  onClearResolvedHistory,
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
  const [showTriggerBuilder, setShowTriggerBuilder] = useState(false);
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false);
  const [selectedTriggerPermUid, setSelectedTriggerPermUid] = useState<string>('');
  const [selectedTriggerKind, setSelectedTriggerKind] = useState<TriggerAbilityKind>('etb');

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
        .filter((item) => !item.countered && !item.uncounterable && !item.isTriggeredAbility),
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

  const effectiveTriggerPermUid = boardPermanents.some((p) => p.uid === selectedTriggerPermUid)
    ? selectedTriggerPermUid
    : boardPermanents[0]?.uid || '';

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

  // LIFO resolution order: index 0 of reversedStack is TOP OF STACK (#1 NEXT TO RESOLVE)
  const reversedStack = useMemo(
    () =>
      stackItems
        .map((item, idx) => ({
          item,
          castOrderNumber: idx + 1,
          resolutionRank: stackItems.length - idx,
          arrayIdx: idx,
        }))
        .reverse(),
    [stackItems]
  );

  const topItem = stackItems[stackItems.length - 1];
  const hasCounterWar = stackItems.length >= 2;
  const spellCountOnStack = stackItems.filter(
    (i) => !i.isTriggeredAbility && !i.isActivatedAbility
  ).length;
  const triggerCountOnStack = stackItems.filter((i) => i.isTriggeredAbility).length;
  const activatedCountOnStack = stackItems.filter((i) => i.isActivatedAbility).length;

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

  // Compact Idle Dock when no items are currently on the Stack
  if (stackItems.length === 0) {
    return (
      <div
        role="region"
        aria-label="Visual Stack Zone and Trigger Queue"
        className={`rounded-xl border px-3.5 py-2.5 space-y-2 transition-colors ${
          isDark
            ? 'border-[#1E6E56] bg-[#0A2F24]/95 text-emerald-50'
            : 'border-zinc-200 bg-zinc-50/90 text-zinc-800'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
                isDark
                  ? 'border border-sky-400/40 bg-sky-950/70 text-sky-200'
                  : 'border border-sky-200 bg-sky-100 text-sky-900'
              }`}
            >
              <Layers className="h-3.5 w-3.5 shrink-0" />
              <span>The Stack</span>
            </span>
            <span
              className={`font-mono text-[11px] font-semibold ${
                isDark ? 'text-emerald-200/90' : 'text-zinc-600'
              }`}
            >
              0 Active · LIFO Resolution Queue (CR 405)
            </span>
            <span
              className={`hidden sm:inline text-[11px] ${
                isDark ? 'text-emerald-200/70' : 'text-zinc-500'
              }`}
            >
              — Spells &amp; Triggered Abilities resolve Top (#1) → Bottom
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onToggleQueueAllSpellsOnStack && (
              <button
                type="button"
                onClick={onToggleQueueAllSpellsOnStack}
                title="Choose whether every spell cast & triggered ability visibly enters the Stack before resolving"
                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-semibold cursor-pointer transition-colors ${
                  queueAllSpellsOnStack
                    ? isDark
                      ? 'border-sky-400/60 bg-sky-500/20 text-sky-100 hover:bg-sky-500/30'
                      : 'border-sky-400 bg-sky-50 text-sky-900 hover:bg-sky-100'
                    : isDark
                    ? 'border-[#287D64] bg-[#0F4C3A] text-emerald-100 hover:bg-[#17614B]'
                    : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100'
                }`}
              >
                <Zap className="h-3 w-3 shrink-0" />
                <span>
                  Stack Queue: {queueAllSpellsOnStack ? 'All Spells & Triggers' : 'Triggers & Responses'}
                </span>
              </button>
            )}

            {onQueueManualTrigger && boardPermanents.length > 0 && (
              <button
                type="button"
                onClick={() => setShowTriggerBuilder((v) => !v)}
                className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-semibold cursor-pointer transition-colors ${
                  showTriggerBuilder
                    ? isDark
                      ? 'border-violet-300 bg-violet-500 text-zinc-950'
                      : 'border-violet-600 bg-violet-600 text-white'
                    : isDark
                    ? 'border-violet-400/50 bg-violet-950/60 text-violet-200 hover:bg-violet-900/70'
                    : 'border-violet-300 bg-violet-50 text-violet-900 hover:bg-violet-100'
                }`}
              >
                <Plus className="h-3 w-3 shrink-0" />
                <span>+ Trigger Ability</span>
              </button>
            )}

            {resolvedStackHistory.length > 0 && (
              <button
                type="button"
                onClick={() => setShowHistoryDrawer((v) => !v)}
                className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-semibold cursor-pointer transition-colors ${
                  isDark
                    ? 'border-[#287D64] bg-[#0F4C3A] text-emerald-100 hover:bg-[#17614B]'
                    : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100'
                }`}
              >
                <History className="h-3 w-3 shrink-0" />
                <span>Resolved ({resolvedStackHistory.length})</span>
                {showHistoryDrawer ? (
                  <ChevronUp className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
              </button>
            )}
          </div>
        </div>

        {/* Manual Trigger Pusher (test ETB / Landfall / Cast / Upkeep / Attack triggers on the Stack) */}
        {showTriggerBuilder && onQueueManualTrigger && boardPermanents.length > 0 && (
          <div
            className={`rounded-lg border p-2.5 flex flex-wrap items-center justify-between gap-2 text-xs ${
              isDark
                ? 'border-violet-400/40 bg-[#17112B]/90 text-violet-100'
                : 'border-violet-200 bg-violet-50/70 text-zinc-800'
            }`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold text-[11px]">Push Triggered Ability to Stack:</span>
              <select
                aria-label="Select permanent for triggered ability"
                value={effectiveTriggerPermUid}
                onChange={(e) => setSelectedTriggerPermUid(e.target.value)}
                className={`rounded border px-2 py-1 text-[11px] font-medium ${
                  isDark
                    ? 'border-violet-400/50 bg-[#0D1A2D] text-white'
                    : 'border-zinc-300 bg-white text-zinc-900'
                }`}
              >
                {boardPermanents.map((p) => (
                  <option key={p.uid} value={p.uid}>
                    {p.name} ({p.isLand ? 'Land' : p.isCreature ? 'Creature' : 'Permanent'})
                  </option>
                ))}
              </select>

              <select
                aria-label="Select trigger type"
                value={selectedTriggerKind}
                onChange={(e) => setSelectedTriggerKind(e.target.value as TriggerAbilityKind)}
                className={`rounded border px-2 py-1 text-[11px] font-medium ${
                  isDark
                    ? 'border-violet-400/50 bg-[#0D1A2D] text-white'
                    : 'border-zinc-300 bg-white text-zinc-900'
                }`}
              >
                {TRIGGER_KIND_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={() => {
                if (!effectiveTriggerPermUid) return;
                onQueueManualTrigger(effectiveTriggerPermUid, selectedTriggerKind);
                setShowTriggerBuilder(false);
              }}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-[11px] font-bold cursor-pointer ${
                isDark
                  ? 'bg-violet-400 text-zinc-950 hover:bg-violet-300'
                  : 'bg-violet-700 text-white hover:bg-violet-800'
              }`}
            >
              <Zap className="h-3 w-3" />
              Put Trigger on Stack
            </button>
          </div>
        )}

        {/* Collapsible Recently Resolved Stack History */}
        {showHistoryDrawer && resolvedStackHistory.length > 0 && (
          <div
            className={`rounded-lg border p-2.5 space-y-1.5 text-[11px] ${
              isDark
                ? 'border-[#247059] bg-[#07221A]/90 text-emerald-100'
                : 'border-zinc-200 bg-white text-zinc-700'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold">
                Recent Stack Resolution Order (Most Recent First)
              </span>
              {onClearResolvedHistory && (
                <button
                  type="button"
                  onClick={onClearResolvedHistory}
                  className="text-[10px] underline opacity-75 hover:opacity-100 cursor-pointer"
                >
                  Clear History
                </button>
              )}
            </div>
            <div className="space-y-1 max-h-36 overflow-y-auto">
              {resolvedStackHistory.slice(0, 8).map((entry) => (
                <div
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-0.5 border-b last:border-b-0 border-current/10"
                >
                  <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                    <span className="font-mono text-[10px] opacity-75">
                      T{entry.turn} · {entry.phase}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.2 text-[10px] font-bold uppercase ${
                        entry.outcome === 'countered'
                          ? 'bg-red-600/80 text-white'
                          : entry.itemCategory === 'triggered-ability'
                          ? isDark
                            ? 'bg-violet-500/30 text-violet-200 border border-violet-400/40'
                            : 'bg-violet-100 text-violet-900'
                          : entry.itemCategory === 'activated-ability'
                          ? isDark
                            ? 'bg-emerald-500/30 text-emerald-200 border border-emerald-400/40'
                            : 'bg-emerald-100 text-emerald-900'
                          : isDark
                          ? 'bg-sky-500/30 text-sky-200 border border-sky-400/40'
                          : 'bg-sky-100 text-sky-900'
                      }`}
                    >
                      {entry.outcome === 'countered'
                        ? 'Countered'
                        : entry.itemCategory === 'triggered-ability'
                        ? 'Trigger'
                        : entry.itemCategory === 'activated-ability'
                        ? 'Ability'
                        : 'Spell'}
                    </span>
                    <span className="font-bold truncate">{entry.cardName}</span>
                    <span className="opacity-80 truncate">— {entry.targetSummary}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      role="region"
      aria-label="Interactive Spell Stack and Trigger Resolution Queue"
      className={`rounded-xl border-2 p-4 space-y-3.5 shadow-lg ${
        isDark
          ? 'border-sky-400/90 bg-[#0D2137]/95 text-sky-50'
          : 'border-sky-500 bg-sky-50/90 text-zinc-900'
      }`}
    >
      {/* Header: Stack Depth + Breakdown + Priority Controls */}
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
            {stackItems.length} {stackItems.length === 1 ? 'Item' : 'Items'} · LIFO Resolution Order
          </span>
          {spellCountOnStack > 0 && (
            <span
              className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                isDark
                  ? 'border border-sky-400/45 bg-sky-900/60 text-sky-200'
                  : 'border border-sky-300 bg-sky-100 text-sky-900'
              }`}
            >
              {spellCountOnStack} {spellCountOnStack === 1 ? 'Spell' : 'Spells'}
            </span>
          )}
          {triggerCountOnStack > 0 && (
            <span
              className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                isDark
                  ? 'border border-violet-400/60 bg-violet-500/25 text-violet-200'
                  : 'border border-violet-300 bg-violet-100 text-violet-900'
              }`}
            >
              {triggerCountOnStack} {triggerCountOnStack === 1 ? 'Triggered Ability' : 'Triggered Abilities'}
            </span>
          )}
          {activatedCountOnStack > 0 && (
            <span
              className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                isDark
                  ? 'border border-emerald-400/60 bg-emerald-500/20 text-emerald-200'
                  : 'border border-emerald-300 bg-emerald-100 text-emerald-900'
              }`}
            >
              {activatedCountOnStack} {activatedCountOnStack === 1 ? 'Activated Ability' : 'Activated Abilities'}
            </span>
          )}
          {hasCounterWar && (
            <span
              className={`rounded-md border px-2 py-0.5 text-[11px] font-bold ${
                isDark
                  ? 'border-amber-400/60 bg-amber-500/20 text-amber-200'
                  : 'border-amber-300 bg-amber-100 text-amber-900'
              }`}
            >
              Stack Chain Active
            </span>
          )}
          <span
            className={`text-xs ${isDark ? 'text-sky-200/90' : 'text-zinc-600'}`}
          >
            Priority: <strong className={isDark ? 'text-white' : 'text-zinc-900'}>You</strong>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onQueueManualTrigger && boardPermanents.length > 0 && (
            <button
              type="button"
              onClick={() => setShowTriggerBuilder((v) => !v)}
              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 ${
                showTriggerBuilder
                  ? isDark
                    ? 'border-violet-300 bg-violet-400 text-zinc-950'
                    : 'border-violet-600 bg-violet-600 text-white'
                  : isDark
                  ? 'border-violet-400/50 bg-violet-950/60 text-violet-200 hover:bg-violet-900/70'
                  : 'border-violet-300 bg-white text-violet-800 hover:bg-violet-50'
              }`}
            >
              <Plus className="h-3.5 w-3.5" />
              + Trigger
            </button>
          )}
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
            Resolve Next (#1 Top)
          </button>
          {stackItems.length > 1 && (
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
              Resolve Entire Stack ({stackItems.length})
            </button>
          )}
        </div>
      </div>

      {/* Inline Trigger Pusher when active stack is open */}
      {showTriggerBuilder && onQueueManualTrigger && boardPermanents.length > 0 && (
        <div
          className={`rounded-lg border p-2.5 flex flex-wrap items-center justify-between gap-2 text-xs ${
            isDark
              ? 'border-violet-400/50 bg-[#17112B]/95 text-violet-100'
              : 'border-violet-300 bg-violet-50 text-zinc-900'
          }`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-[11px]">Add Triggered Ability to Top of Stack:</span>
            <select
              aria-label="Select permanent for triggered ability"
              value={effectiveTriggerPermUid}
              onChange={(e) => setSelectedTriggerPermUid(e.target.value)}
              className={`rounded border px-2 py-1 text-[11px] font-medium ${
                isDark
                  ? 'border-violet-400/50 bg-[#0D1A2D] text-white'
                  : 'border-zinc-300 bg-white text-zinc-900'
              }`}
            >
              {boardPermanents.map((p) => (
                <option key={p.uid} value={p.uid}>
                  {p.name}
                </option>
              ))}
            </select>

            <select
              aria-label="Select trigger type"
              value={selectedTriggerKind}
              onChange={(e) => setSelectedTriggerKind(e.target.value as TriggerAbilityKind)}
              className={`rounded border px-2 py-1 text-[11px] font-medium ${
                isDark
                  ? 'border-violet-400/50 bg-[#0D1A2D] text-white'
                  : 'border-zinc-300 bg-white text-zinc-900'
              }`}
            >
              {TRIGGER_KIND_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={() => {
              if (!effectiveTriggerPermUid) return;
              onQueueManualTrigger(effectiveTriggerPermUid, selectedTriggerKind);
              setShowTriggerBuilder(false);
            }}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-[11px] font-bold cursor-pointer ${
              isDark
                ? 'bg-violet-400 text-zinc-950 hover:bg-violet-300'
                : 'bg-violet-700 text-white hover:bg-violet-800'
            }`}
          >
            <Zap className="h-3 w-3" />
            Push Trigger (#1 Top)
          </button>
        </div>
      )}

      {/* Resolution Order Direction Bar */}
      <div
        className={`rounded-md border px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] ${
          isDark
            ? 'border-sky-400/30 bg-[#081524]/85 text-sky-200'
            : 'border-sky-200 bg-white/80 text-zinc-700'
        }`}
      >
        <div className="flex items-center gap-1.5">
          <span className="font-mono font-bold text-amber-400">LIFO QUEUE:</span>
          <span>
            Items resolve from <strong>#1 (Top of Stack / Last In)</strong> down to{' '}
            <strong>#{stackItems.length} (Bottom of Stack / First In)</strong>.
          </span>
        </div>
        {triggerCountOnStack >= 2 && onReorderStackItem && (
          <span className={isDark ? 'text-violet-300 font-semibold' : 'text-violet-800 font-semibold'}>
            CR 603.3b: Use ↑/↓ on simultaneous triggers to choose resolution order
          </span>
        )}
      </div>

      {/* LIFO Visual Stack Tower (#1 Next to Resolve at top -> #N Resolves Last at bottom) */}
      <div className="space-y-2">
        {reversedStack.map(({ item, resolutionRank, arrayIdx }, visualIdx) => {
          const isTop = visualIdx === 0;
          const isBottom = visualIdx === reversedStack.length - 1 && reversedStack.length > 1;
          const cleanStackCardName = item.cardName.replace(/ — .*$/, '');
          const resolvedStackArt = resolveCardWithCustomProxy(
            cleanStackCardName,
            item.meta ?? null
          );
          const imgUrl =
            resolvedStackArt.meta?.imageUri ||
            item.meta?.imageUri ||
            getScryfallFallbackImageUri(cleanStackCardName);
          const isTrigger = Boolean(item.isTriggeredAbility);
          const isActivated = Boolean(item.isActivatedAbility);

          // Check if this item can be reordered with an adjacent player trigger (CR 603.3b)
          const itemAboveInStack = arrayIdx < stackItems.length - 1 ? stackItems[arrayIdx + 1] : null;
          const itemBelowInStack = arrayIdx > 0 ? stackItems[arrayIdx - 1] : null;
          const canMoveUpEarlier =
            Boolean(onReorderStackItem) &&
            isTrigger &&
            item.controller === 'player' &&
            Boolean(itemAboveInStack?.isTriggeredAbility && itemAboveInStack.controller === 'player');
          const canMoveDownLater =
            Boolean(onReorderStackItem) &&
            isTrigger &&
            item.controller === 'player' &&
            Boolean(itemBelowInStack?.isTriggeredAbility && itemBelowInStack.controller === 'player');

          // Check if this item targets another item on the stack
          const targetedStackEntry = item.targetStackItemId
            ? reversedStack.find((r) => r.item.id === item.targetStackItemId)
            : undefined;

          const categoryLabel = isTrigger
            ? 'TRIGGERED ABILITY'
            : isActivated
            ? 'ACTIVATED ABILITY'
            : 'SPELL';

          const categoryBadgeClass = isTrigger
            ? isDark
              ? 'border-violet-400/70 bg-violet-500/25 text-violet-200'
              : 'border-violet-300 bg-violet-100 text-violet-900'
            : isActivated
            ? isDark
              ? 'border-emerald-400/70 bg-emerald-500/25 text-emerald-200'
              : 'border-emerald-300 bg-emerald-100 text-emerald-900'
            : isDark
            ? 'border-sky-400/60 bg-sky-500/25 text-sky-100'
            : 'border-sky-300 bg-sky-100 text-sky-900';

          return (
            <React.Fragment key={item.id}>
              <div
                className={`animate-stack-item-slide rounded-lg border p-2.5 flex items-start gap-3 transition-colors ${
                  item.countered
                    ? isDark
                      ? 'border-red-500/40 bg-red-950/30 opacity-65'
                      : 'border-red-200 bg-red-50/60 opacity-70'
                    : isTop
                    ? isTrigger
                      ? isDark
                        ? 'border-violet-400/90 bg-[#1B1638] ring-1 ring-violet-400/40'
                        : 'border-violet-500 bg-white shadow-sm'
                      : isDark
                      ? 'border-amber-400/90 bg-[#132E4B] ring-1 ring-amber-400/40'
                      : 'border-sky-500 bg-white shadow-sm'
                    : isTrigger
                    ? isDark
                      ? 'border-violet-400/45 bg-[#121029]/90'
                      : 'border-violet-200 bg-violet-50/50'
                    : isDark
                    ? 'border-sky-500/35 bg-[#0A192A]/90'
                    : 'border-zinc-200 bg-white/85'
                }`}
              >
                {/* Resolution Order Rank Indicator (#1 Resolves First -> #N Resolves Last) */}
                <div className="flex flex-col items-center gap-1 shrink-0 pt-0.5 min-w-[54px]">
                  <span
                    className={`font-mono text-[11px] font-bold px-2 py-0.5 rounded text-center ${
                      isTop
                        ? isDark
                          ? 'bg-amber-400 text-zinc-950'
                          : 'bg-amber-500 text-white'
                        : isDark
                        ? 'bg-sky-900 text-sky-200'
                        : 'bg-zinc-200 text-zinc-700'
                    }`}
                  >
                    #{resolutionRank}
                  </span>
                  <span
                    className={`font-mono text-[9px] font-bold uppercase text-center leading-tight ${
                      isTop
                        ? isDark
                          ? 'text-amber-300'
                          : 'text-amber-700'
                        : isBottom
                        ? isDark
                          ? 'text-sky-300/75'
                          : 'text-zinc-500'
                        : isDark
                        ? 'text-sky-300/80'
                        : 'text-zinc-500'
                    }`}
                  >
                    {isTop ? 'NEXT UP' : isBottom ? 'LAST' : `STEP ${resolutionRank}`}
                  </span>

                  {/* Simultaneous Trigger Reorder Buttons (CR 603.3b) */}
                  {(canMoveUpEarlier || canMoveDownLater) && onReorderStackItem && (
                    <div className="flex items-center gap-0.5 pt-0.5">
                      <button
                        type="button"
                        disabled={!canMoveUpEarlier}
                        onClick={() => onReorderStackItem(item.id, 'up')}
                        title="Resolve this triggered ability earlier (move toward Top of Stack)"
                        className={`rounded border p-0.5 cursor-pointer disabled:opacity-30 ${
                          isDark
                            ? 'border-violet-400/50 bg-violet-950 text-violet-200 hover:bg-violet-800'
                            : 'border-violet-300 bg-white text-violet-800 hover:bg-violet-100'
                        }`}
                      >
                        <ArrowUp className="h-2.5 w-2.5" />
                      </button>
                      <button
                        type="button"
                        disabled={!canMoveDownLater}
                        onClick={() => onReorderStackItem(item.id, 'down')}
                        title="Resolve this triggered ability later (move toward Bottom of Stack)"
                        className={`rounded border p-0.5 cursor-pointer disabled:opacity-30 ${
                          isDark
                            ? 'border-violet-400/50 bg-violet-950 text-violet-200 hover:bg-violet-800'
                            : 'border-violet-300 bg-white text-violet-800 hover:bg-violet-100'
                        }`}
                      >
                        <ArrowDown className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Card / Trigger Source Art Thumbnail */}
                <button
                  type="button"
                  onMouseEnter={(e) =>
                    showGlobalCardHover({
                      name: item.cardName.replace(/ — .*$/, ''),
                      meta: item.meta ?? null,
                      rect: buildHoverRect(e.currentTarget),
                      statusTags: [
                        `Resolution Order #${resolutionRank}`,
                        categoryLabel,
                        item.seatLabel,
                        item.mechanicBadge,
                        item.countered ? 'Countered' : 'On Stack',
                      ],
                    })
                  }
                  onMouseLeave={hideGlobalCardHover}
                  onClick={() => {
                    hideGlobalCardHover();
                    onInspectCard(item.cardName.replace(/ — .*$/, ''));
                  }}
                  title={`Inspect ${item.cardName}`}
                  className={`h-14 w-10 rounded overflow-hidden border shrink-0 cursor-pointer hover:ring-2 hover:ring-sky-400 relative ${
                    isTrigger
                      ? 'border-violet-400/80 bg-violet-950'
                      : isActivated
                      ? 'border-emerald-400/80 bg-emerald-950'
                      : 'border-zinc-600/60 bg-zinc-900'
                  }`}
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
                  {isTrigger && (
                    <span className="absolute bottom-0 inset-x-0 bg-violet-600/90 text-[7px] font-bold text-white text-center uppercase py-0.2">
                      TRIG
                    </span>
                  )}
                  {isActivated && (
                    <span className="absolute bottom-0 inset-x-0 bg-emerald-600/90 text-[7px] font-bold text-white text-center uppercase py-0.2">
                      ABIL
                    </span>
                  )}
                </button>

                {/* Stack Item Details */}
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {/* Resolution Priority Status Pill on Top Item */}
                    {isTop && !item.countered && (
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide ${
                          isDark
                            ? 'bg-amber-400/25 text-amber-200 border border-amber-400/60'
                            : 'bg-amber-100 text-amber-900 border border-amber-300'
                        }`}
                      >
                        Resolves First
                      </span>
                    )}

                    {/* Category Badge: SPELL vs TRIGGERED ABILITY vs ACTIVATED ABILITY */}
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wide ${categoryBadgeClass}`}
                    >
                      {categoryLabel}
                    </span>

                    {/* Controller Badge */}
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
                          name: item.cardName.replace(/ — .*$/, ''),
                          meta: item.meta ?? null,
                          rect: buildHoverRect(e.currentTarget),
                          statusTags: [
                            `Resolution Order #${resolutionRank}`,
                            categoryLabel,
                            item.mechanicBadge,
                          ],
                        })
                      }
                      onMouseLeave={hideGlobalCardHover}
                      onClick={() => {
                        hideGlobalCardHover();
                        onInspectCard(item.cardName.replace(/ — .*$/, ''));
                      }}
                      className={`text-xs font-bold hover:underline cursor-pointer ${
                        item.countered ? 'line-through opacity-75' : ''
                      } ${isDark ? 'text-white' : 'text-zinc-900'}`}
                    >
                      {item.cardName}
                    </button>

                    {!isTrigger && (
                      <span
                        className={`font-mono text-[10px] ${
                          isDark ? 'text-sky-300' : 'text-zinc-500'
                        }`}
                      >
                        (MV {item.cmc})
                      </span>
                    )}

                    <span
                      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                        isTrigger
                          ? isDark
                            ? 'border-violet-400/40 bg-violet-950/70 text-violet-200'
                            : 'border-violet-200 bg-violet-50 text-violet-800'
                          : isDark
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

                  {/* Trigger Condition Clause (for Triggered Abilities) */}
                  {isTrigger && item.triggerConditionText && (
                    <div
                      className={`text-[10px] font-medium ${
                        isDark ? 'text-violet-200/90' : 'text-violet-800'
                      }`}
                    >
                      ⚡ Trigger Condition: <em>{item.triggerConditionText}</em>
                    </div>
                  )}

                  {/* Target / Effect & Stack Target Linkage */}
                  <div
                    className={`text-[11px] flex flex-wrap items-center gap-2 ${
                      isDark ? 'text-sky-100/90' : 'text-zinc-700'
                    }`}
                  >
                    <span>
                      <span className={isDark ? 'text-sky-300 font-semibold' : 'text-sky-700 font-semibold'}>
                        ↳ Resolution Effect:
                      </span>{' '}
                      {item.targetSummary}
                    </span>

                    {targetedStackEntry && (
                      <span
                        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${
                          isDark
                            ? 'border border-amber-400/50 bg-amber-500/20 text-amber-200'
                            : 'border border-amber-300 bg-amber-100 text-amber-900'
                        }`}
                      >
                        Targets Stack #{targetedStackEntry.resolutionRank} ({targetedStackEntry.item.cardName})
                      </span>
                    )}
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

                {/* Quick Step-Resolve button on the #1 Top of Stack item */}
                {isTop && (
                  <button
                    type="button"
                    onClick={onResolveTop}
                    title="Resolve this top item on the stack now (LIFO step)"
                    className={`hidden sm:inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-bold cursor-pointer shrink-0 self-center transition-colors ${
                      isDark
                        ? 'border-amber-400/70 bg-amber-400/20 text-amber-200 hover:bg-amber-400/35'
                        : 'border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100'
                    }`}
                  >
                    <Check className="h-3 w-3" />
                    Resolve #1
                  </button>
                )}
              </div>

              {/* Visual LIFO Flow Connector between stack items */}
              {visualIdx < reversedStack.length - 1 && (
                <div className="animate-stack-flow-slide flex items-center gap-2 pl-5 text-[10px] font-mono opacity-75">
                  <ArrowDown className={`h-3 w-3 ${isDark ? 'text-amber-300' : 'text-sky-700'}`} />
                  <span className={isDark ? 'text-sky-200' : 'text-zinc-600'}>
                    Then resolves #{resolutionRank + 1} ({reversedStack[visualIdx + 1].item.cardName})
                  </span>
                </div>
              )}
            </React.Fragment>
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
              Responding to #1 <strong>{topItem.cardName}</strong>
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
            <strong>Resolve Next (#1 Top)</strong> or <strong>Space</strong> to resolve in LIFO order.
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
                  ? "No legal spell target"
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
                      ? "Current item on stack can't be countered by a spell counter."
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
                        ? "Current item on stack can't be countered."
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
