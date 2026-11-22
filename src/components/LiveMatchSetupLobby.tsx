import React, { useMemo, useState } from 'react';
import {
  Bell,
  Bot,
  Brain,
  Copy,
  Dices,
  FastForward,
  Flame,
  Play,
  RotateCcw,
  Shield,
  Sliders,
  Swords,
  Users,
} from 'lucide-react';
import { SAMPLE_DECKS } from '../data/sampleDecks';
import type {
  BotIndignanceLevel,
  BotIntelligenceLevel,
  BotOpponentConfig,
  PlaytestMode,
} from '../types/deck';
import { BOT_INDIGNANCE_OPTIONS, getBotIndignanceMeta } from '../utils/botIndignance';
import {
  BOT_INTELLIGENCE_OPTIONS,
  getBotIntelligenceMeta,
} from '../utils/botIntelligence';
import { parseDecklistClientSide } from '../utils/clientFallbackAnalyzer';
import type { InterruptWindowMode } from './InterruptResponseBanner';

export type FirstPlayerSelection = 'player' | 'random' | 'bot-0' | 'bot-1' | 'bot-2';

export interface LiveMatchSetupConfig {
  mode: PlaytestMode;
  startingLife: number;
  firstPlayerChoice: FirstPlayerSelection;
  resolvedFirstSeatIndex: number; // 0 = You, 1 = Bot 1, 2 = Bot 2, 3 = Bot 3
  freeFirstMulligan: boolean;
  interruptWindowMode: InterruptWindowMode;
  botTurnPace: 'normal' | 'step' | 'fast';
  opponents: BotOpponentConfig[];
}

export const LIVE_BOT_ARCHETYPES: string[] = [
  'Mono-Red Aggro / Burn',
  'Azorius Control & Countermagic',
  'Dimir Midrange & Removal',
  'Simic Landfall & Ramp',
  'Golgari Graveyard Value',
  'Orzhov Aristocrats & Drain',
  'Izzet Spellslinger Combo',
  'Gruul Stompy Aggro',
  'Golgari / Simic Toxic & Infect',
  'Dimir Mill & Library Denial',
  'Boros / Voltron Commander Damage',
];

const FALLBACK_BOT_SEATS: Array<{
  name: string;
  archetype: string;
  indignance: BotIndignanceLevel;
  intelligence: BotIntelligenceLevel;
}> = [
  {
    name: 'Bot 1 (Vex)',
    archetype: 'Mono-Red Aggro / Burn',
    indignance: 'ruthless',
    intelligence: 'tactical',
  },
  {
    name: 'Bot 2 (Lyra)',
    archetype: 'Azorius Control & Countermagic',
    indignance: 'measured',
    intelligence: 'competitive',
  },
  {
    name: 'Bot 3 (Kor)',
    archetype: 'Golgari Graveyard Value',
    indignance: 'forgiving',
    intelligence: 'tactical',
  },
];

interface LiveMatchSetupLobbyProps {
  mode: PlaytestMode;
  formatLabel: string;
  defaultStartingLife: number;
  startingLife: number;
  opponents: BotOpponentConfig[];
  playerDeckName: string;
  playerDeckVersionLabel: string;
  playerDeckCardCount: number;
  playerCommanderNames: string[];
  playerDeckSerializedText: string;
  firstPlayerChoice: FirstPlayerSelection;
  freeFirstMulligan: boolean;
  interruptWindowMode: InterruptWindowMode;
  botTurnPace: 'normal' | 'step' | 'fast';
  hasGameInProgress: boolean;
  onChangeMode: (nextMode: PlaytestMode) => void;
  onChangeStartingLife: (life: number) => void;
  onChangeFirstPlayerChoice: (choice: FirstPlayerSelection) => void;
  onChangeFreeFirstMulligan: (enabled: boolean) => void;
  onChangeInterruptWindowMode: (mode: InterruptWindowMode) => void;
  onChangeBotTurnPace: (pace: 'normal' | 'step' | 'fast') => void;
  onUpdateOpponents: (nextOpponents: BotOpponentConfig[]) => void;
  onStartLiveGame: (resolvedFirstSeatIndex: number, diceSummary?: string) => void;
  onResumeLiveGame?: () => void;
}

type BotDeckSourceTab = 'archetype' | 'preset' | 'custom';

function detectDeckSourceTab(opp: BotOpponentConfig, playerDeckText: string): BotDeckSourceTab {
  const custom = (opp.customDeckText || '').trim();
  if (!custom) return 'archetype';
  if (playerDeckText.trim() && custom === playerDeckText.trim()) return 'preset';
  if (SAMPLE_DECKS.some((d) => d.deckText.trim() === custom)) return 'preset';
  return 'custom';
}

export const LiveMatchSetupLobby: React.FC<LiveMatchSetupLobbyProps> = ({
  mode,
  formatLabel,
  defaultStartingLife,
  startingLife,
  opponents,
  playerDeckName,
  playerDeckVersionLabel,
  playerDeckCardCount,
  playerCommanderNames,
  playerDeckSerializedText,
  firstPlayerChoice,
  freeFirstMulligan,
  interruptWindowMode,
  botTurnPace,
  hasGameInProgress,
  onChangeMode,
  onChangeStartingLife,
  onChangeFirstPlayerChoice,
  onChangeFreeFirstMulligan,
  onChangeInterruptWindowMode,
  onChangeBotTurnPace,
  onUpdateOpponents,
  onStartLiveGame,
  onResumeLiveGame,
}) => {
  const targetBotCount = mode === '1v1' ? 1 : mode === '1v2' ? 2 : 3;

  // Ensure exact number of bots for selected mode
  const activeBots: BotOpponentConfig[] = useMemo(() => {
    const list: BotOpponentConfig[] = [];
    for (let i = 0; i < targetBotCount; i++) {
      const existing = opponents[i];
      if (existing) {
        list.push({
          ...existing,
          intelligence: existing.intelligence || 'tactical',
          indignance: existing.indignance || 'measured',
        });
      } else {
        const fb = FALLBACK_BOT_SEATS[i] || FALLBACK_BOT_SEATS[0];
        list.push({
          id: `${mode}-bot-${i + 1}`,
          name: fb.name,
          archetype: fb.archetype,
          indignance: fb.indignance,
          intelligence: fb.intelligence,
          customDeckText: '',
        });
      }
    }
    return list;
  }, [opponents, targetBotCount, mode]);

  const [deckTabsByBotId, setDeckTabsByBotId] = useState<Record<string, BotDeckSourceTab>>({});
  const [previewRollResult, setPreviewRollResult] = useState<{
    winnerSeatIdx: number;
    summary: string;
  } | null>(null);

  const seatNames = useMemo(
    () => ['You', ...activeBots.map((b) => b.name || 'Bot')],
    [activeBots]
  );

  // Guard firstPlayerChoice if user switched from 1v3 down to 1v1
  const effectiveFirstChoice: FirstPlayerSelection = useMemo(() => {
    if (firstPlayerChoice === 'bot-1' && targetBotCount < 2) return 'player';
    if (firstPlayerChoice === 'bot-2' && targetBotCount < 3) return 'player';
    return firstPlayerChoice;
  }, [firstPlayerChoice, targetBotCount]);

  const updateBot = (idx: number, patch: Partial<BotOpponentConfig>) => {
    const next = activeBots.map((bot, i) => (i === idx ? { ...bot, ...patch } : bot));
    onUpdateOpponents(next);
  };

  const applyIntelligenceToAll = (level: BotIntelligenceLevel) => {
    onUpdateOpponents(activeBots.map((bot) => ({ ...bot, intelligence: level })));
  };

  const rollForFirstSeat = (): { winnerSeatIdx: number; summary: string } => {
    const rolls = seatNames.map((name, idx) => ({
      idx,
      name,
      roll: Math.floor(Math.random() * 20) + 1,
    }));
    // Tie-break deterministically by re-rolling tied leaders
    let maxRoll = Math.max(...rolls.map((r) => r.roll));
    let leaders = rolls.filter((r) => r.roll === maxRoll);
    while (leaders.length > 1) {
      leaders.forEach((l) => {
        l.roll = Math.floor(Math.random() * 20) + 1;
      });
      maxRoll = Math.max(...leaders.map((l) => l.roll));
      leaders = leaders.filter((l) => l.roll === maxRoll);
    }
    const winner = leaders[0];
    const summary = `d20 Roll: ${rolls
      .map((r) => `${r.name} (${r.roll})`)
      .join(' · ')} — ${winner.name} goes first!`;
    return { winnerSeatIdx: winner.idx, summary };
  };

  const handleRollPreview = () => {
    const rolled = rollForFirstSeat();
    setPreviewRollResult(rolled);
  };

  const resolvedPreviewStartIdx: number | null = useMemo(() => {
    if (effectiveFirstChoice === 'player') return 0;
    if (effectiveFirstChoice === 'bot-0') return 1;
    if (effectiveFirstChoice === 'bot-1') return 2;
    if (effectiveFirstChoice === 'bot-2') return 3;
    return previewRollResult ? previewRollResult.winnerSeatIdx : null;
  }, [effectiveFirstChoice, previewRollResult]);

  const turnOrderPreview = useMemo(() => {
    if (resolvedPreviewStartIdx === null) {
      return 'Random d20 roll on game start';
    }
    const total = seatNames.length;
    const ordered: string[] = [];
    for (let offset = 0; offset < total; offset++) {
      ordered.push(seatNames[(resolvedPreviewStartIdx + offset) % total]);
    }
    return ordered.join(' → ');
  }, [resolvedPreviewStartIdx, seatNames]);

  const handleLaunch = () => {
    if (effectiveFirstChoice === 'random') {
      const rolled = previewRollResult || rollForFirstSeat();
      onStartLiveGame(rolled.winnerSeatIdx, rolled.summary);
      return;
    }
    const seatIdx =
      effectiveFirstChoice === 'player'
        ? 0
        : effectiveFirstChoice === 'bot-0'
        ? 1
        : effectiveFirstChoice === 'bot-1'
        ? 2
        : 3;
    onStartLiveGame(seatIdx);
  };

  const botGridClass =
    targetBotCount === 1
      ? 'grid-cols-1'
      : targetBotCount === 2
      ? 'grid-cols-1 lg:grid-cols-2'
      : 'grid-cols-1 lg:grid-cols-3';

  return (
    <div
      aria-label="Live Game Match Setup Lobby"
      className="rounded-xl border border-zinc-200 bg-white p-5 sm:p-6 space-y-6"
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-100 pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Sliders className="h-4 w-4 text-sky-700 shrink-0" />
            <h3 className="text-base font-bold text-zinc-950">
              Live Game Setup — Configure Table, Bots &amp; Turn Order
            </h3>
          </div>
          <p className="text-xs text-zinc-600">
            Choose pod size, starting life, who goes first, and each bot&rsquo;s intelligence level, aggression, and deck before shuffling opening hands.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {hasGameInProgress && onResumeLiveGame && (
            <button
              type="button"
              onClick={onResumeLiveGame}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3.5 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 cursor-pointer whitespace-nowrap shrink-0"
            >
              Resume Active Game
            </button>
          )}
          <button
            type="button"
            onClick={handleLaunch}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-700 px-4 py-2 text-xs font-bold text-white hover:bg-sky-800 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            Start Live Game
          </button>
        </div>
      </div>

      {/* Section 1: Table Format, Starting Life, Turn Order & Priority Rules */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 border-b border-zinc-100 pb-6">
        {/* Left: Table Mode, Starting Life & Rules */}
        <div className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-800">
              <Users className="h-3.5 w-3.5 text-sky-700" />
              <span>Table Size &amp; Mode</span>
            </div>
            <div className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-zinc-100 p-1">
              {(
                [
                  { id: '1v1', label: '1v1 Duel (1 Bot)' },
                  { id: '1v2', label: '1v2 Trio (2 Bots)' },
                  { id: '1v3', label: '1v3 Pod (3 Bots)' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    setPreviewRollResult(null);
                    onChangeMode(opt.id);
                  }}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    mode === opt.id
                      ? 'bg-white text-sky-800 shadow-sm'
                      : 'text-zinc-600 hover:text-zinc-900'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-800">
                <Shield className="h-3.5 w-3.5 text-sky-700" />
                <span>Starting Life</span>
                <span className="font-normal text-zinc-500">
                  (Default {defaultStartingLife})
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {[20, 25, 30, 40].map((lifeVal) => (
                  <button
                    key={lifeVal}
                    type="button"
                    onClick={() => onChangeStartingLife(lifeVal)}
                    className={`rounded-md border px-2.5 py-1.5 font-mono text-xs font-semibold tabular-nums cursor-pointer whitespace-nowrap shrink-0 ${
                      startingLife === lifeVal
                        ? 'border-sky-600 bg-sky-50 text-sky-900'
                        : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'
                    }`}
                  >
                    {lifeVal}
                  </button>
                ))}
                <input
                  type="number"
                  min={5}
                  max={100}
                  value={startingLife}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (!Number.isNaN(n) && n >= 5 && n <= 100) {
                      onChangeStartingLife(n);
                    }
                  }}
                  aria-label="Custom starting life total"
                  className="w-16 rounded-md border border-zinc-300 bg-white px-2 py-1.5 font-mono text-xs font-semibold tabular-nums text-zinc-900 focus:border-sky-600 focus:outline-none"
                />
              </div>
            </div>

            <label className="inline-flex items-center gap-2 pb-1.5 text-xs font-medium text-zinc-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={freeFirstMulligan}
                onChange={(e) => onChangeFreeFirstMulligan(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-300 text-sky-700 focus:ring-sky-600"
              />
              <span>Free First Mulligan</span>
            </label>
          </div>
        </div>

        {/* Right: Turn Order (Who Goes First) + Interrupt Timer & Pace */}
        <div className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-800">
                <Dices className="h-3.5 w-3.5 text-sky-700" />
                <span>Who Goes First</span>
              </div>
              {effectiveFirstChoice === 'random' && (
                <button
                  type="button"
                  onClick={handleRollPreview}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:text-sky-900 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Dices className="h-3.5 w-3.5" />
                  Roll d20 Preview
                </button>
              )}
            </div>

            <div className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-zinc-100 p-1">
              <button
                type="button"
                onClick={() => {
                  setPreviewRollResult(null);
                  onChangeFirstPlayerChoice('player');
                }}
                className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  effectiveFirstChoice === 'player'
                    ? 'bg-white text-sky-800 shadow-sm'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                You First
              </button>
              {activeBots.map((bot, idx) => {
                const choiceKey = `bot-${idx}` as FirstPlayerSelection;
                return (
                  <button
                    key={bot.id}
                    type="button"
                    onClick={() => {
                      setPreviewRollResult(null);
                      onChangeFirstPlayerChoice(choiceKey);
                    }}
                    className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      effectiveFirstChoice === choiceKey
                        ? 'bg-white text-sky-800 shadow-sm'
                        : 'text-zinc-600 hover:text-zinc-900'
                    }`}
                  >
                    {bot.name.split(' ')[0]} {idx + 1} First
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => {
                  setPreviewRollResult(null);
                  onChangeFirstPlayerChoice('random');
                }}
                className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  effectiveFirstChoice === 'random'
                    ? 'bg-white text-sky-800 shadow-sm'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                Random (d20)
              </button>
            </div>

            <div className="text-[11px] text-zinc-600">
              <span className="font-semibold text-zinc-800">Turn Order:</span>{' '}
              {turnOrderPreview}
              {previewRollResult && (
                <div className="mt-0.5 font-mono text-[11px] text-sky-800">
                  {previewRollResult.summary}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <label className="space-y-1 text-xs">
              <span className="flex items-center gap-1 font-semibold text-zinc-800">
                <Bell className="h-3.5 w-3.5 text-sky-700" />
                Interrupt / Response Window
              </span>
              <select
                value={interruptWindowMode}
                onChange={(e) =>
                  onChangeInterruptWindowMode(e.target.value as InterruptWindowMode)
                }
                className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-800 focus:border-sky-600 focus:outline-none"
              >
                <option value="12s">12s Auto-Pass Window (Default)</option>
                <option value="8s">8s Fast Response Window</option>
                <option value="20s">20s Relaxed Response Window</option>
                <option value="manual">Manual Priority (No Timer)</option>
                <option value="smart-only">Smart Only (Pause only if holding Instant)</option>
              </select>
            </label>

            <label className="space-y-1 text-xs">
              <span className="flex items-center gap-1 font-semibold text-zinc-800">
                <FastForward className="h-3.5 w-3.5 text-sky-700" />
                Bot Turn Pace
              </span>
              <select
                value={botTurnPace}
                onChange={(e) =>
                  onChangeBotTurnPace(e.target.value as 'normal' | 'step' | 'fast')
                }
                className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-800 focus:border-sky-600 focus:outline-none"
              >
                <option value="normal">Normal Pace</option>
                <option value="step">Step-by-Step (Manual Next Bot)</option>
                <option value="fast">Fast Bots</option>
              </select>
            </label>
          </div>
        </div>
      </div>

      {/* Section 2: Per-Bot Intelligence, Personality & Deck Configuration */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-sky-700 shrink-0" />
            <h4 className="text-sm font-bold text-zinc-900">
              AI Bot Opponents ({activeBots.length})
            </h4>
          </div>

          {activeBots.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-zinc-500 font-medium">Set All AI Level:</span>
              {BOT_INTELLIGENCE_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => applyIntelligenceToAll(opt.id)}
                  className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 hover:border-sky-400 hover:text-sky-800 cursor-pointer whitespace-nowrap shrink-0"
                >
                  {opt.shortLabel}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={`grid gap-4 ${botGridClass}`}>
          {activeBots.map((bot, idx) => {
            const intelMeta = getBotIntelligenceMeta(bot.intelligence);
            const indignanceMeta = getBotIndignanceMeta(bot.indignance);
            const activeDeckTab: BotDeckSourceTab =
              deckTabsByBotId[bot.id] ||
              detectDeckSourceTab(bot, playerDeckSerializedText);

            const parsedCustomCount = bot.customDeckText?.trim()
              ? parseDecklistClientSide(bot.customDeckText).cards.reduce(
                  (sum, c) => sum + c.quantity,
                  0
                )
              : 0;

            const isMirrorDeck =
              Boolean(playerDeckSerializedText.trim()) &&
              (bot.customDeckText || '').trim() === playerDeckSerializedText.trim();
            const matchedSampleDeck = SAMPLE_DECKS.find(
              (d) => d.deckText.trim() === (bot.customDeckText || '').trim()
            );

            return (
              <div
                key={bot.id}
                className="rounded-xl border border-zinc-200 bg-zinc-50/50 p-4 space-y-4 flex flex-col justify-between"
              >
                <div className="space-y-3.5">
                  {/* Seat Header & Name Input */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-bold text-sky-800 whitespace-nowrap shrink-0">
                      Seat {idx + 2}
                    </span>
                    <input
                      type="text"
                      value={bot.name}
                      onChange={(e) => updateBot(idx, { name: e.target.value })}
                      aria-label={`Seat ${idx + 2} bot name`}
                      className="flex-1 min-w-0 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-semibold text-zinc-900 focus:border-sky-600 focus:outline-none"
                    />
                  </div>

                  {/* Intelligence Level */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="inline-flex items-center gap-1 font-semibold text-zinc-800">
                        <Brain className="h-3.5 w-3.5 text-sky-700" />
                        Intelligence Level
                      </span>
                      <span className={`font-semibold ${intelMeta.textColorClass}`}>
                        {intelMeta.label}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 rounded-lg bg-zinc-200/60 p-1">
                      {BOT_INTELLIGENCE_OPTIONS.map((opt) => {
                        const selected = intelMeta.id === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => updateBot(idx, { intelligence: opt.id })}
                            className={`rounded-md px-2 py-1 text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap truncate ${
                              selected
                                ? 'bg-white text-zinc-950 shadow-sm'
                                : 'text-zinc-600 hover:text-zinc-900'
                            }`}
                          >
                            {opt.shortLabel}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[11px] text-zinc-600 leading-snug">
                      {intelMeta.description}
                    </p>
                  </div>

                  {/* Aggression / Indignance */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="inline-flex items-center gap-1 font-semibold text-zinc-800">
                        <Flame className="h-3.5 w-3.5 text-amber-600" />
                        Playstyle / Indignance
                      </span>
                      <span className={`font-semibold ${indignanceMeta.textColorClass}`}>
                        {indignanceMeta.shortLabel}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 rounded-lg bg-zinc-200/60 p-1">
                      {BOT_INDIGNANCE_OPTIONS.map((opt) => {
                        const selected = indignanceMeta.id === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => updateBot(idx, { indignance: opt.id })}
                            className={`rounded-md px-2 py-1 text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap truncate ${
                              selected
                                ? 'bg-white text-zinc-950 shadow-sm'
                                : 'text-zinc-600 hover:text-zinc-900'
                            }`}
                          >
                            {opt.shortLabel}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Bot Deck Selection */}
                  <div className="space-y-2 border-t border-zinc-200/80 pt-3">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="inline-flex items-center gap-1 font-semibold text-zinc-800">
                        <Swords className="h-3.5 w-3.5 text-sky-700" />
                        Bot Deck
                      </span>
                      <span className="text-[11px] text-zinc-500 font-mono tabular-nums">
                        {activeDeckTab === 'archetype'
                          ? 'Built-in Archetype'
                          : isMirrorDeck
                          ? `Mirror (${parsedCustomCount} cards)`
                          : matchedSampleDeck
                          ? `${parsedCustomCount} cards`
                          : parsedCustomCount > 0
                          ? `Custom (${parsedCustomCount} cards)`
                          : 'Paste list below'}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-1 rounded-lg bg-zinc-200/60 p-1">
                      {(
                        [
                          { id: 'archetype', label: 'Archetype' },
                          { id: 'preset', label: 'Preset / Mirror' },
                          { id: 'custom', label: 'Custom List' },
                        ] as const
                      ).map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => {
                            setDeckTabsByBotId((prev) => ({ ...prev, [bot.id]: tab.id }));
                            if (tab.id === 'archetype') {
                              updateBot(idx, {
                                customDeckText: '',
                                archetype:
                                  bot.archetype === 'Custom Decklist'
                                    ? FALLBACK_BOT_SEATS[idx]?.archetype || LIVE_BOT_ARCHETYPES[0]
                                    : bot.archetype,
                              });
                            } else if (tab.id === 'preset' && !bot.customDeckText?.trim()) {
                              if (playerDeckSerializedText.trim()) {
                                updateBot(idx, {
                                  archetype: 'Custom Decklist',
                                  customDeckText: playerDeckSerializedText,
                                });
                              } else if (SAMPLE_DECKS[0]) {
                                updateBot(idx, {
                                  archetype: 'Custom Decklist',
                                  customDeckText: SAMPLE_DECKS[0].deckText,
                                });
                              }
                            }
                          }}
                          className={`rounded-md px-2 py-1 text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap truncate ${
                            activeDeckTab === tab.id
                              ? 'bg-white text-sky-800 shadow-sm'
                              : 'text-zinc-600 hover:text-zinc-900'
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>

                    {activeDeckTab === 'archetype' && (
                      <select
                        value={
                          LIVE_BOT_ARCHETYPES.includes(bot.archetype)
                            ? bot.archetype
                            : LIVE_BOT_ARCHETYPES[0]
                        }
                        onChange={(e) =>
                          updateBot(idx, { archetype: e.target.value, customDeckText: '' })
                        }
                        aria-label={`${bot.name} deck archetype`}
                        className="w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-xs font-medium text-zinc-900 focus:border-sky-600 focus:outline-none"
                      >
                        {LIVE_BOT_ARCHETYPES.map((arch) => (
                          <option key={arch} value={arch}>
                            {arch}
                          </option>
                        ))}
                      </select>
                    )}

                    {activeDeckTab === 'preset' && (
                      <div className="space-y-1.5">
                        <select
                          value={
                            isMirrorDeck
                              ? '__mirror__'
                              : matchedSampleDeck?.id || SAMPLE_DECKS[0]?.id || '__mirror__'
                          }
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === '__mirror__') {
                              updateBot(idx, {
                                archetype: 'Custom Decklist',
                                customDeckText: playerDeckSerializedText,
                              });
                            } else {
                              const found = SAMPLE_DECKS.find((d) => d.id === val);
                              if (found) {
                                updateBot(idx, {
                                  archetype: 'Custom Decklist',
                                  customDeckText: found.deckText,
                                });
                              }
                            }
                          }}
                          aria-label={`${bot.name} preset deck`}
                          className="w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-xs font-medium text-zinc-900 focus:border-sky-600 focus:outline-none"
                        >
                          {playerDeckSerializedText.trim() && (
                            <option value="__mirror__">
                              Mirror Match — Copy Your Deck ({playerDeckName})
                            </option>
                          )}
                          {SAMPLE_DECKS.map((deck) => (
                            <option key={deck.id} value={deck.id}>
                              {deck.title} ({deck.format})
                            </option>
                          ))}
                        </select>
                        <div className="text-[11px] text-zinc-500">
                          {isMirrorDeck
                            ? 'This bot will pilot an exact copy of your active deck.'
                            : matchedSampleDeck
                            ? matchedSampleDeck.subtitle
                            : 'Full card-by-card decklist loaded for this bot.'}
                        </div>
                      </div>
                    )}

                    {activeDeckTab === 'custom' && (
                      <div className="space-y-1.5">
                        <textarea
                          rows={4}
                          value={bot.customDeckText || ''}
                          onChange={(e) =>
                            updateBot(idx, {
                              archetype: e.target.value.trim()
                                ? 'Custom Decklist'
                                : FALLBACK_BOT_SEATS[idx]?.archetype || LIVE_BOT_ARCHETYPES[0],
                              customDeckText: e.target.value,
                            })
                          }
                          placeholder={`Paste Arena / Moxfield / Archidekt list...\n1 Sol Ring\n1 Counterspell\n...`}
                          className="w-full rounded-lg border border-zinc-300 bg-white p-2 font-mono text-[11px] text-zinc-900 placeholder:text-zinc-400 focus:border-sky-600 focus:outline-none resize-y"
                        />
                        <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-500">
                          <span>
                            {parsedCustomCount > 0
                              ? `Parsed ${parsedCustomCount} cards`
                              : 'Empty list falls back to archetype deck'}
                          </span>
                          <div className="flex items-center gap-2">
                            {playerDeckSerializedText.trim() && (
                              <button
                                type="button"
                                onClick={() =>
                                  updateBot(idx, {
                                    archetype: 'Custom Decklist',
                                    customDeckText: playerDeckSerializedText,
                                  })
                                }
                                className="inline-flex items-center gap-1 font-semibold text-sky-700 hover:underline cursor-pointer"
                              >
                                <Copy className="h-3 w-3" />
                                Copy Mine
                              </button>
                            )}
                            {bot.customDeckText && (
                              <button
                                type="button"
                                onClick={() =>
                                  updateBot(idx, {
                                    customDeckText: '',
                                    archetype:
                                      FALLBACK_BOT_SEATS[idx]?.archetype ||
                                      LIVE_BOT_ARCHETYPES[0],
                                  })
                                }
                                className="inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-900 cursor-pointer"
                              >
                                <RotateCcw className="h-3 w-3" />
                                Clear
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer Launch Strip */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-zinc-200 pt-4">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-zinc-600">
          <span className="font-semibold text-zinc-900">Your Deck: {playerDeckName}</span>
          <span aria-hidden="true">·</span>
          <span>{playerDeckVersionLabel}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums">{playerDeckCardCount} cards</span>
          <span aria-hidden="true">·</span>
          <span>{formatLabel}</span>
          {playerCommanderNames.length > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span>Cmdr: {playerCommanderNames.join(' & ')}</span>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={handleLaunch}
          className="inline-flex items-center gap-2 rounded-lg bg-sky-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-sky-800 cursor-pointer whitespace-nowrap shrink-0"
        >
          <Play className="h-4 w-4 fill-current" />
          Start Live Game ({mode} · {startingLife} Life)
        </button>
      </div>
    </div>
  );
};
