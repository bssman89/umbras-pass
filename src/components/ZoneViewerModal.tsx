import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRightLeft,
  Ban,
  Coins,
  Eye,
  Hand,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import type { CardMetadata } from '../types/deck';
import type { LiveBotState, LiveBotZoneCard } from '../utils/liveBotEngine';
import {
  buildHoverRect,
  hideGlobalCardHover,
  showGlobalCardHover,
} from './CardHoverZoomOverlay';
import {
  getScryfallFallbackImageUri,
  resolveCardWithCustomProxy,
} from '../utils/customCardProxiesAndTokens';

export interface ZoneViewerCardItem {
  uid: string;
  name: string;
  cmc: number;
  typeLine: string;
  meta: CardMetadata | null;
  reason?: string;
}

export interface ZoneViewerSoloOpponent {
  id: string;
  name: string;
  archetype: string;
}

interface ZoneViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialOwnerId: string;
  initialZone: 'graveyard' | 'exile';
  playerName: string;
  playerGraveyard: ZoneViewerCardItem[];
  playerExile: ZoneViewerCardItem[];
  liveBotMode: boolean;
  liveBots: LiveBotState[];
  soloOpponents: ZoneViewerSoloOpponent[];
  botsAreActing: boolean;
  hasActiveStack: boolean;
  pendingIncomingAttack: boolean;
  onInspectCard: (name: string, meta?: CardMetadata | null) => void;
  onMovePlayerZoneCard?: (
    fromZone: 'graveyard' | 'exile',
    cardUid: string,
    destination: 'battlefield' | 'hand' | 'graveyard' | 'exile'
  ) => void;
}

export const ZoneViewerModal: React.FC<ZoneViewerModalProps> = ({
  isOpen,
  onClose,
  initialOwnerId,
  initialZone,
  playerName,
  playerGraveyard,
  playerExile,
  liveBotMode,
  liveBots,
  soloOpponents,
  botsAreActing,
  hasActiveStack,
  pendingIncomingAttack,
  onInspectCard,
  onMovePlayerZoneCard,
}) => {
  const [selectedOwnerId, setSelectedOwnerId] = useState<string>(initialOwnerId || 'player');
  const [selectedZone, setSelectedZone] = useState<'graveyard' | 'exile'>(initialZone);
  const [searchQuery, setSearchQuery] = useState<string>('');

  useEffect(() => {
    if (isOpen) {
      setSelectedOwnerId(initialOwnerId || 'player');
      setSelectedZone(initialZone);
      setSearchQuery('');
    } else {
      hideGlobalCardHover();
    }
    return () => hideGlobalCardHover();
  }, [isOpen, initialOwnerId, initialZone]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  const owners = useMemo(() => {
    const list: Array<{
      id: string;
      label: string;
      subtitle: string;
      gyCards: ZoneViewerCardItem[];
      gyCount: number;
      exileCards: ZoneViewerCardItem[];
      exileCount: number;
      isPlayer: boolean;
    }> = [
      {
        id: 'player',
        label: 'You',
        subtitle: playerName || 'Your Deck',
        gyCards: playerGraveyard,
        gyCount: playerGraveyard.length,
        exileCards: playerExile,
        exileCount: playerExile.length,
        isPlayer: true,
      },
    ];

    if (liveBotMode) {
      liveBots.forEach((bot, idx) => {
        const gyCards: LiveBotZoneCard[] = bot.graveyardCards || [];
        const exileCards: LiveBotZoneCard[] = bot.exileCards || [];
        list.push({
          id: bot.id,
          label: `Seat ${idx + 2} · ${bot.name}`,
          subtitle: bot.archetype,
          gyCards,
          gyCount: Math.max(bot.graveyardCount || 0, gyCards.length),
          exileCards,
          exileCount: Math.max(bot.exileCount || 0, exileCards.length),
          isPlayer: false,
        });
      });
    } else {
      soloOpponents.forEach((opp, idx) => {
        list.push({
          id: opp.id,
          label: `Seat ${idx + 2} · ${opp.name}`,
          subtitle: opp.archetype,
          gyCards: [],
          gyCount: 0,
          exileCards: [],
          exileCount: 0,
          isPlayer: false,
        });
      });
    }

    return list;
  }, [playerName, playerGraveyard, playerExile, liveBotMode, liveBots, soloOpponents]);

  const activeOwner =
    owners.find((o) => o.id === selectedOwnerId) || owners[0];

  const activeCards =
    selectedZone === 'graveyard' ? activeOwner.gyCards : activeOwner.exileCards;
  const activeCount =
    selectedZone === 'graveyard' ? activeOwner.gyCount : activeOwner.exileCount;

  const filteredCards = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return activeCards;
    return activeCards.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.typeLine.toLowerCase().includes(q) ||
        (c.reason && c.reason.toLowerCase().includes(q))
    );
  }, [activeCards, searchQuery]);

  const typeCounts = useMemo(() => {
    let creatures = 0;
    let instantsSorceries = 0;
    let artifactsEnch = 0;
    let lands = 0;
    for (const c of activeCards) {
      const t = (c.typeLine || '').toLowerCase();
      if (/\bcreature\b/.test(t)) creatures++;
      else if (/\binstant\b|\bsorcery\b/.test(t)) instantsSorceries++;
      else if (/\bartifact\b|\benchantment\b|\bplaneswalker\b/.test(t)) artifactsEnch++;
      else if (/\bland\b/.test(t)) lands++;
    }
    return { creatures, instantsSorceries, artifactsEnch, lands };
  }, [activeCards]);

  if (!isOpen) return null;

  const canModifyPlayerZones =
    activeOwner.isPlayer &&
    Boolean(onMovePlayerZoneCard) &&
    !botsAreActing &&
    !hasActiveStack &&
    !pendingIncomingAttack;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="zone-viewer-title"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl max-h-[88vh] flex flex-col rounded-xl border border-[#247059] bg-[#0B392C] text-white shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-[#1E6E56] bg-[#092E23] px-5 py-3.5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {selectedZone === 'graveyard' ? (
                <Coins className="h-4 w-4 text-emerald-300 shrink-0" />
              ) : (
                <Ban className="h-4 w-4 text-violet-300 shrink-0" />
              )}
              <h3
                id="zone-viewer-title"
                className="font-display text-base font-bold tracking-tight text-white truncate"
              >
                {activeOwner.label} — {selectedZone === 'graveyard' ? 'Graveyard' : 'Exile'} ({activeCount})
              </h3>
            </div>
            <p className="mt-0.5 text-xs text-emerald-100/80 truncate">
              {activeOwner.subtitle} · Click any card to inspect full rules text &amp; art
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close zone viewer"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#287D64] bg-[#0F4C3A] text-emerald-100 hover:bg-[#17614B] hover:text-white cursor-pointer shrink-0 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Seat & Zone Switchers */}
        <div className="border-b border-[#1E6E56] bg-[#0C3F31] px-5 py-3 space-y-2.5">
          {/* Owner Switcher */}
          <div className="flex flex-wrap items-center gap-2">
            {owners.map((owner) => {
              const isSelected = owner.id === activeOwner.id;
              return (
                <button
                  key={owner.id}
                  type="button"
                  onClick={() => {
                    setSelectedOwnerId(owner.id);
                    setSearchQuery('');
                  }}
                  className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    isSelected
                      ? 'border-sky-400 bg-sky-900/60 text-white'
                      : 'border-[#247059] bg-[#0B392C] text-emerald-100/85 hover:border-emerald-400/60 hover:text-white'
                  }`}
                >
                  <span>{owner.label}</span>
                  <span className="font-mono text-xs tabular-nums opacity-80">
                    ({owner.gyCount}/{owner.exileCount})
                  </span>
                </button>
              );
            })}
          </div>

          {/* Zone Tabs + Search */}
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedZone('graveyard')}
                className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border px-3.5 py-2 text-xs sm:text-sm font-bold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  selectedZone === 'graveyard'
                    ? 'border-emerald-400 bg-emerald-900/65 text-white'
                    : 'border-[#247059] bg-[#092E23] text-emerald-100/80 hover:text-white'
                }`}
              >
                <Coins className="h-4 w-4 text-emerald-300" />
                Graveyard
                <span className="font-mono tabular-nums">({activeOwner.gyCount})</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedZone('exile')}
                className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border px-3.5 py-2 text-xs sm:text-sm font-bold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  selectedZone === 'exile'
                    ? 'border-violet-400 bg-violet-950/75 text-white'
                    : 'border-[#247059] bg-[#092E23] text-emerald-100/80 hover:text-white'
                }`}
              >
                <Ban className="h-4 w-4 text-violet-300" />
                Exile
                <span className="font-mono tabular-nums">({activeOwner.exileCount})</span>
              </button>
            </div>

            {activeCards.length > 0 && (
              <div className="relative flex-1 min-w-[200px] max-w-xs">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-emerald-200/60" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter by name or type..."
                  className="min-h-[38px] w-full rounded-lg border border-[#247059] bg-[#092E23] pl-9 pr-3 py-2 text-xs sm:text-sm text-white placeholder:text-emerald-200/45 focus:border-sky-400 focus:outline-none"
                />
              </div>
            )}
          </div>

          {activeCards.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-xs tabular-nums text-emerald-200/85">
              <span>
                Creatures {typeCounts.creatures} · Instants/Sorceries {typeCounts.instantsSorceries} · Artifacts/Ench {typeCounts.artifactsEnch} · Lands {typeCounts.lands}
              </span>
              {activeOwner.isPlayer && (botsAreActing || hasActiveStack || pendingIncomingAttack) && (
                <span className="text-amber-300">
                  Resolve active stack/turn before moving zone cards
                </span>
              )}
            </div>
          )}
        </div>

        {/* Card Pile Contents */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-[#082B21]">
          {filteredCards.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[#247059] bg-[#0B392C]/60 px-6 py-10 text-center space-y-1.5">
              <div className="text-sm font-semibold text-emerald-100">
                {searchQuery.trim()
                  ? `No cards match "${searchQuery.trim()}"`
                  : `${activeOwner.label}'s ${selectedZone === 'graveyard' ? 'Graveyard' : 'Exile'} pile is empty.`}
              </div>
              <p className="text-xs text-emerald-200/70 max-w-md mx-auto">
                {!liveBotMode && !activeOwner.isPlayer
                  ? 'Solo Goldfish mode tracks your zones automatically. Switch to Play Live vs Bots to track opponent Graveyard and Exile piles.'
                  : activeOwner.isPlayer
                  ? `Cards sent to ${selectedZone === 'graveyard' ? 'Graveyard' : 'Exile'} from combat, spells, discard, or drag-and-drop appear here.`
                  : `Spells cast, countered creatures, milled cards, and removed permanents belonging to ${activeOwner.label} will be listed here.`}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {filteredCards.map((card, index) => {
                const resolved = resolveCardWithCustomProxy(card.name, card.meta || null);
                const imgUri =
                  resolved.meta?.imageUri ||
                  card.meta?.imageUri ||
                  getScryfallFallbackImageUri(card.name);
                const manaCost = resolved.meta?.manaCost || card.meta?.manaCost;
                return (
                  <div
                    key={`${card.uid}-${index}`}
                    className="flex items-stretch gap-3 rounded-lg border border-[#1E6E56] bg-[#0B392C]/90 p-2.5 hover:border-emerald-400/70 transition-colors"
                  >
                    <button
                      type="button"
                      onMouseEnter={(e) =>
                        showGlobalCardHover({
                          name: card.name,
                          meta: card.meta,
                          rect: buildHoverRect(e.currentTarget),
                          statusTags: [
                            selectedZone === 'graveyard' ? 'Graveyard' : 'Exile',
                            ...(card.reason ? [card.reason] : []),
                          ],
                        })
                      }
                      onMouseLeave={hideGlobalCardHover}
                      onClick={() => {
                        hideGlobalCardHover();
                        onInspectCard(card.name, card.meta);
                      }}
                      title={`Inspect ${card.name}`}
                      className="w-12 h-[68px] rounded border border-[#287D64] bg-[#07261D] overflow-hidden shrink-0 cursor-pointer hover:border-sky-400 transition-colors flex items-center justify-center"
                    >
                      {imgUri ? (
                        <img
                          src={imgUri}
                          alt={card.name}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <span className="px-1 text-center font-mono text-[9px] text-emerald-200/75 leading-tight line-clamp-3">
                          {card.name}
                        </span>
                      )}
                    </button>

                    <div className="min-w-0 flex-1 flex flex-col justify-between gap-1.5">
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <button
                            type="button"
                            onMouseEnter={(e) =>
                              showGlobalCardHover({
                                name: card.name,
                                meta: card.meta,
                                rect: buildHoverRect(e.currentTarget),
                                statusTags: [
                                  selectedZone === 'graveyard' ? 'Graveyard' : 'Exile',
                                  ...(card.reason ? [card.reason] : []),
                                ],
                              })
                            }
                            onMouseLeave={hideGlobalCardHover}
                            onClick={() => {
                              hideGlobalCardHover();
                              onInspectCard(card.name, card.meta);
                            }}
                            className="text-left text-xs font-bold text-white hover:text-sky-300 truncate cursor-pointer"
                            title={card.name}
                          >
                            {index === 0 && (
                              <span className="mr-1.5 font-mono text-[9px] font-semibold text-amber-300">
                                TOP
                              </span>
                            )}
                            {card.name}
                          </button>
                          <span className="font-mono text-xs text-emerald-200/85 tabular-nums shrink-0">
                            {manaCost ? manaCost : `MV ${card.cmc}`}
                          </span>
                        </div>
                        <div className="text-xs text-emerald-100/80 truncate">
                          {card.typeLine}
                        </div>
                        {card.reason && (
                          <div className="text-xs text-sky-300/90 truncate mt-0.5">
                            {card.reason}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onInspectCard(card.name, card.meta)}
                          className="inline-flex min-h-[32px] items-center gap-1.5 rounded-md border border-[#287D64] bg-[#092E23] px-2.5 py-1 text-xs font-semibold text-emerald-100 hover:bg-[#17614B] cursor-pointer whitespace-nowrap shrink-0"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          Inspect
                        </button>

                        {activeOwner.isPlayer && onMovePlayerZoneCard && (
                          <>
                            <button
                              type="button"
                              disabled={!canModifyPlayerZones}
                              onClick={() =>
                                onMovePlayerZoneCard(selectedZone, card.uid, 'battlefield')
                              }
                              className="inline-flex min-h-[32px] items-center gap-1.5 rounded-md border border-emerald-400/45 bg-emerald-950/75 px-2.5 py-1 text-xs font-semibold text-emerald-200 hover:bg-emerald-900 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
                            >
                              <Sparkles className="h-3.5 w-3.5" />
                              To Field
                            </button>
                            <button
                              type="button"
                              disabled={!canModifyPlayerZones}
                              onClick={() =>
                                onMovePlayerZoneCard(selectedZone, card.uid, 'hand')
                              }
                              className="inline-flex min-h-[32px] items-center gap-1.5 rounded-md border border-sky-400/45 bg-sky-950/75 px-2.5 py-1 text-xs font-semibold text-sky-200 hover:bg-sky-900 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
                            >
                              <Hand className="h-3.5 w-3.5" />
                              To Hand
                            </button>
                            <button
                              type="button"
                              disabled={!canModifyPlayerZones}
                              onClick={() =>
                                onMovePlayerZoneCard(
                                  selectedZone,
                                  card.uid,
                                  selectedZone === 'graveyard' ? 'exile' : 'graveyard'
                                )
                              }
                              className="inline-flex min-h-[32px] items-center gap-1.5 rounded-md border border-violet-400/45 bg-violet-950/75 px-2.5 py-1 text-xs font-semibold text-violet-200 hover:bg-violet-900 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
                            >
                              <ArrowRightLeft className="h-3.5 w-3.5" />
                              {selectedZone === 'graveyard' ? 'Exile' : 'To GY'}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
