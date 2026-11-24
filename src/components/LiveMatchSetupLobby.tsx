import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  BookmarkPlus,
  Bot,
  Brain,
  Check,
  ClipboardPaste,
  Copy,
  Cpu,
  Dices,
  FastForward,
  FileUp,
  Flame,
  Link2,
  Loader2,
  Play,
  RotateCcw,
  Shield,
  Sliders,
  Swords,
  Trash2,
  Users,
} from 'lucide-react';
import { SAMPLE_DECKS } from '../data/sampleDecks';
import type {
  BotIndignanceLevel,
  BotIntelligenceLevel,
  BotOpponentConfig,
  CardMetadata,
  PlaytestMode,
  SavedCustomBotDeck,
} from '../types/deck';
import { BOT_INDIGNANCE_OPTIONS, getBotIndignanceMeta } from '../utils/botIndignance';
import {
  BOT_INTELLIGENCE_OPTIONS,
  getBotIntelligenceMeta,
} from '../utils/botIntelligence';
import { setDecklistCommanderClientSide } from '../utils/clientFallbackAnalyzer';
import {
  getFormatSimulationRules,
  normalizeCardLookupKey,
} from '../utils/playtestReconciler';
import { copyTextToClipboard, readTextFromClipboard } from '../utils/clipboard';
import {
  deleteSavedCustomBotDeck,
  importBotDeckFromUrl,
  loadSavedCustomBotDecks,
  saveCustomBotDeck,
  summarizeCustomBotDeck,
} from '../utils/customBotDecks';
import type { InterruptWindowMode } from './InterruptResponseBanner';
import {
  D20RollOffStage,
  computeD20RollOff,
  type D20RollOffResult,
  type D20SeatDescriptor,
} from './D20RollAnimation';

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
  activeAiModelLabel?: string;
  effectiveAiEngine?: 'local-gguf' | 'cloud-gemini' | 'deterministic';
  liveAiTurnReasoning?: boolean;
  onChangeLiveAiTurnReasoning?: (enabled: boolean) => void;
  findMeta?: (name: string) => CardMetadata | null;
  resolvingCustomMeta?: boolean;
  soundEnabled?: boolean;
}

type BotDeckSourceTab = 'archetype' | 'preset' | 'custom';

function detectDeckSourceTab(opp: BotOpponentConfig, playerDeckText: string): BotDeckSourceTab {
  const custom = (opp.customDeckText || '').trim();
  if (!custom) return 'archetype';
  if (opp.customDeckName?.trim() && !SAMPLE_DECKS.some((d) => d.deckText.trim() === custom) && custom !== playerDeckText.trim()) {
    return 'custom';
  }
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
  activeAiModelLabel = 'Deterministic MTG Rules',
  effectiveAiEngine = 'deterministic',
  liveAiTurnReasoning = true,
  onChangeLiveAiTurnReasoning,
  findMeta,
  resolvingCustomMeta = false,
  soundEnabled = false,
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
          customDeckName: '',
        });
      }
    }
    return list;
  }, [opponents, targetBotCount, mode]);

  const [deckTabsByBotId, setDeckTabsByBotId] = useState<Record<string, BotDeckSourceTab>>({});
  const [savedCustomDecks, setSavedCustomDecks] = useState<SavedCustomBotDeck[]>(() =>
    loadSavedCustomBotDecks()
  );
  const [urlImportOpenByBotId, setUrlImportOpenByBotId] = useState<Record<string, boolean>>({});
  const [urlInputByBotId, setUrlInputByBotId] = useState<Record<string, string>>({});
  const [urlLoadingByBotId, setUrlLoadingByBotId] = useState<Record<string, boolean>>({});
  const [deckNoticeByBotId, setDeckNoticeByBotId] = useState<
    Record<string, { tone: 'ok' | 'err'; text: string }>
  >({});
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [previewRollResult, setPreviewRollResult] = useState<D20RollOffResult | null>(null);
  const [rollNonce, setRollNonce] = useState<number>(0);
  const [isRollSettled, setIsRollSettled] = useState<boolean>(false);
  const [launchRollModalOpen, setLaunchRollModalOpen] = useState<boolean>(false);
  const autoLaunchTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (autoLaunchTimerRef.current) {
        window.clearTimeout(autoLaunchTimerRef.current);
      }
    };
  }, []);

  const seatNames = useMemo(
    () => ['You', ...activeBots.map((b) => b.name || 'Bot')],
    [activeBots]
  );

  const seatDescriptors: D20SeatDescriptor[] = useMemo(
    () => [
      { seatIdx: 0, name: 'You', roleLabel: 'Seat 1' },
      ...activeBots.map((b, i) => ({
        seatIdx: i + 1,
        name: b.name || `Bot ${i + 1}`,
        roleLabel: `Seat ${i + 2} · AI Bot`,
      })),
    ],
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

  const setBotNotice = (botId: string, tone: 'ok' | 'err', text: string) => {
    setDeckNoticeByBotId((prev) => ({ ...prev, [botId]: { tone, text } }));
    if (tone === 'ok') {
      window.setTimeout(() => {
        setDeckNoticeByBotId((prev) => {
          if (prev[botId]?.text !== text) return prev;
          const copy = { ...prev };
          delete copy[botId];
          return copy;
        });
      }, 2800);
    }
  };

  const applyCustomDeckToAllBots = (sourceBot: BotOpponentConfig) => {
    if (!sourceBot.customDeckText?.trim()) return;
    onUpdateOpponents(
      activeBots.map((bot) => ({
        ...bot,
        archetype: 'Custom Decklist',
        customDeckText: sourceBot.customDeckText,
        customDeckName: sourceBot.customDeckName || '',
      }))
    );
    setDeckTabsByBotId((prev) => {
      const next = { ...prev };
      activeBots.forEach((b) => {
        next[b.id] = 'custom';
      });
      return next;
    });
    setBotNotice(sourceBot.id, 'ok', 'Assigned this custom deck to all bots');
  };

  const handleImportBotUrl = async (idx: number, botId: string) => {
    const rawUrl = (urlInputByBotId[botId] || '').trim();
    if (!rawUrl) {
      setBotNotice(botId, 'err', 'Paste a Moxfield, Archidekt, or MTGGoldfish URL first.');
      return;
    }
    setUrlLoadingByBotId((prev) => ({ ...prev, [botId]: true }));
    setDeckNoticeByBotId((prev) => {
      const copy = { ...prev };
      delete copy[botId];
      return copy;
    });
    try {
      const imported = await importBotDeckFromUrl(rawUrl);
      const summary = summarizeCustomBotDeck(imported.rawText, formatLabel, findMeta);
      const chosenName =
        imported.deckName?.trim() ||
        summary.suggestedName ||
        'Imported Custom Deck';
      updateBot(idx, {
        archetype: 'Custom Decklist',
        customDeckText: imported.rawText,
        customDeckName: chosenName,
      });
      setDeckTabsByBotId((prev) => ({ ...prev, [botId]: 'custom' }));
      setUrlImportOpenByBotId((prev) => ({ ...prev, [botId]: false }));
      setUrlInputByBotId((prev) => ({ ...prev, [botId]: '' }));
      setBotNotice(
        botId,
        'ok',
        `Imported ${summary.totalQty} cards (${imported.sourceFormat || 'URL'})`
      );
    } catch (err) {
      setBotNotice(
        botId,
        'err',
        err instanceof Error ? err.message : 'Could not import deck URL.'
      );
    } finally {
      setUrlLoadingByBotId((prev) => ({ ...prev, [botId]: false }));
    }
  };

  const handleUploadBotDeckFile = async (idx: number, botId: string, file: File) => {
    try {
      const text = await file.text();
      if (!text.trim()) {
        setBotNotice(botId, 'err', 'Selected file is empty.');
        return;
      }
      const cleanFileName = file.name.replace(/\.[^.]+$/, '').trim();
      const summary = summarizeCustomBotDeck(text, formatLabel, findMeta);
      updateBot(idx, {
        archetype: 'Custom Decklist',
        customDeckText: text,
        customDeckName: cleanFileName || summary.suggestedName || 'Uploaded Custom Deck',
      });
      setDeckTabsByBotId((prev) => ({ ...prev, [botId]: 'custom' }));
      setBotNotice(botId, 'ok', `Loaded ${summary.totalQty} cards from ${file.name}`);
    } catch {
      setBotNotice(botId, 'err', 'Could not read the selected file.');
    }
  };

  const applyIntelligenceToAll = (level: BotIntelligenceLevel) => {
    onUpdateOpponents(activeBots.map((bot) => ({ ...bot, intelligence: level })));
  };

  const rollForFirstSeat = (): D20RollOffResult => {
    return computeD20RollOff(seatDescriptors);
  };

  const triggerAnimatedD20Roll = () => {
    if (autoLaunchTimerRef.current) {
      window.clearTimeout(autoLaunchTimerRef.current);
      autoLaunchTimerRef.current = null;
    }
    const rolled = rollForFirstSeat();
    setPreviewRollResult(rolled);
    setIsRollSettled(false);
    setRollNonce((n) => n + 1);
    return rolled;
  };

  const handleRollPreview = () => {
    triggerAnimatedD20Roll();
  };

  const resolvedPreviewStartIdx: number | null = useMemo(() => {
    if (effectiveFirstChoice === 'player') return 0;
    if (effectiveFirstChoice === 'bot-0') return 1;
    if (effectiveFirstChoice === 'bot-1') return 2;
    if (effectiveFirstChoice === 'bot-2') return 3;
    return previewRollResult && isRollSettled ? previewRollResult.winnerSeatIdx : null;
  }, [effectiveFirstChoice, previewRollResult, isRollSettled]);

  const turnOrderPreview = useMemo(() => {
    if (resolvedPreviewStartIdx === null) {
      return previewRollResult && !isRollSettled
        ? 'Rolling d20s to determine turn order...'
        : 'Animated d20 roll on game start';
    }
    const total = seatNames.length;
    const ordered: string[] = [];
    for (let offset = 0; offset < total; offset++) {
      ordered.push(seatNames[(resolvedPreviewStartIdx + offset) % total]);
    }
    return ordered.join(' → ');
  }, [resolvedPreviewStartIdx, seatNames, previewRollResult, isRollSettled]);

  const handleLaunch = () => {
    if (effectiveFirstChoice === 'random') {
      if (previewRollResult && isRollSettled) {
        onStartLiveGame(previewRollResult.winnerSeatIdx, previewRollResult.summary);
        return;
      }
      if (!previewRollResult) {
        triggerAnimatedD20Roll();
      }
      setLaunchRollModalOpen(true);
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
      data-live-bot-setup="true"
      className="rounded-xl border border-zinc-200 bg-white p-5 sm:p-6 space-y-6"
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-100 pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Sliders className="h-4 w-4 text-sky-700 shrink-0" />
            <h3 className="text-base sm:text-lg font-bold text-zinc-950">
              Match Setup — Rules, Turn Order &amp; Bot Decks
            </h3>
          </div>
          <p className="text-xs sm:text-sm text-zinc-600">
            Configure pod size, starting life, turn order, and each opponent&apos;s skill, playstyle, or custom decklist before shuffling.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {hasGameInProgress && onResumeLiveGame && (
            <button
              type="button"
              onClick={onResumeLiveGame}
              className="inline-flex min-h-[42px] items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-4 py-2 text-xs sm:text-sm font-semibold text-zinc-800 hover:bg-zinc-50 cursor-pointer whitespace-nowrap shrink-0"
            >
              Resume Active Game
            </button>
          )}
          <button
            type="button"
            onClick={handleLaunch}
            className="inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-sky-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-sky-800 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Play className="h-4 w-4 fill-current" />
            Start Live Game
          </button>
        </div>
      </div>

      {/* Active AI Engine Summary */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-zinc-50/70 px-3.5 py-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <Cpu className="h-4 w-4 text-sky-700 shrink-0" />
          <span className="font-semibold text-zinc-800">
            Active AI Engine:
          </span>
          <span className="font-mono font-bold text-sky-800">
            {activeAiModelLabel}
          </span>
          <span className="text-zinc-500">
            {effectiveAiEngine === 'local-gguf'
              ? '— Local GGUF reasoning & bot learning active.'
              : effectiveAiEngine === 'cloud-gemini'
              ? '— Cloud Gemini reasoning & bot learning active.'
              : '— Built-in deterministic MTG rules engine.'}
          </span>
        </div>

        {effectiveAiEngine !== 'deterministic' && onChangeLiveAiTurnReasoning && (
          <label className="inline-flex items-center gap-2 text-xs font-semibold text-zinc-800 cursor-pointer select-none shrink-0">
            <input
              type="checkbox"
              checked={liveAiTurnReasoning}
              onChange={(e) => onChangeLiveAiTurnReasoning(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-300 text-sky-700 focus:ring-sky-600"
            />
            <span>Live Per-Turn AI Thinking</span>
          </label>
        )}
      </div>

      {/* Section 1: Table Format, Starting Life, Turn Order & Priority Rules */}
      <div className="space-y-4 border-b border-zinc-100 pb-6">
        <h4 className="text-sm font-bold text-zinc-900">
          01. Match Rules &amp; Turn Order
        </h4>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Left: Table Mode, Starting Life & Rules */}
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-zinc-800">
              <Users className="h-4 w-4 text-sky-700" />
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
                    setIsRollSettled(false);
                    onChangeMode(opt.id);
                  }}
                  className={`min-h-[38px] rounded-md px-3.5 py-1.5 text-xs sm:text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
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
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-zinc-800">
                <Shield className="h-4 w-4 text-sky-700" />
                <span>Starting Life</span>
                <span className="font-normal text-zinc-500">
                  (Default {defaultStartingLife})
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {[20, 25, 30, 40].map((lifeVal) => (
                  <button
                    key={lifeVal}
                    type="button"
                    onClick={() => onChangeStartingLife(lifeVal)}
                    className={`min-h-[38px] rounded-lg border px-3.5 py-1.5 font-mono text-xs sm:text-sm font-semibold tabular-nums cursor-pointer whitespace-nowrap shrink-0 ${
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
                  className="min-h-[38px] w-20 rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 font-mono text-sm font-semibold tabular-nums text-zinc-900 focus:border-sky-600 focus:outline-none"
                />
              </div>
            </div>

            <label className="inline-flex min-h-[38px] items-center gap-2 pb-1 text-xs sm:text-sm font-medium text-zinc-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={freeFirstMulligan}
                onChange={(e) => onChangeFreeFirstMulligan(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-300 text-sky-700 focus:ring-sky-600"
              />
              <span>Free First Mulligan (CR 103.5c)</span>
            </label>
          </div>

          {/* Active WotC Format Rules Summary Strip */}
          {(() => {
            const activeRules = getFormatSimulationRules(
              formatLabel.toLowerCase(),
              mode,
              playerDeckCardCount
            );
            return (
              <div className="rounded-lg border border-zinc-200 bg-zinc-50/80 px-3.5 py-2.5 text-xs text-zinc-700 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-semibold text-zinc-900">
                  WotC {formatLabel} Rules ({mode}):
                </span>
                <span>
                  Command Zone:{' '}
                  <strong className="text-zinc-900">
                    {activeRules.allowsCommandZone ? 'Active (CR 903)' : 'None'}
                  </strong>
                </span>
                <span className="text-zinc-300" aria-hidden="true">·</span>
                <span>
                  21 Cmdr KO:{' '}
                  <strong className="text-zinc-900">
                    {activeRules.usesCommanderDamage21 ? 'Yes (CR 903.10a)' : 'No'}
                  </strong>
                </span>
                <span className="text-zinc-300" aria-hidden="true">·</span>
                <span>
                  Turn 1 Draw:{' '}
                  <strong className="text-zinc-900">
                    {activeRules.playerSkipsTurn1Draw
                      ? '1st Seat Skips (CR 103.8a)'
                      : 'All Draw (CR 103.8c)'}
                  </strong>
                </span>
                <span className="text-zinc-300" aria-hidden="true">·</span>
                <span>
                  Mulligan:{' '}
                  <strong className="text-zinc-900">
                    {freeFirstMulligan ? 'London + Free 1st' : 'London (Bottom N)'}
                  </strong>
                </span>
              </div>
            );
          })()}
        </div>

        {/* Right: Turn Order (Who Goes First) + Interrupt Timer & Pace */}
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-zinc-800">
                <Dices className="h-4 w-4 text-sky-700" />
                <span>Who Goes First</span>
              </div>
              {effectiveFirstChoice === 'random' && (
                <button
                  type="button"
                  onClick={handleRollPreview}
                  className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-800 hover:bg-sky-100 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Dices className="h-4 w-4" />
                  {previewRollResult ? 'Re-roll d20' : 'Roll d20'}
                </button>
              )}
            </div>

            <div className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-zinc-100 p-1">
              <button
                type="button"
                onClick={() => {
                  setPreviewRollResult(null);
                  setIsRollSettled(false);
                  onChangeFirstPlayerChoice('player');
                }}
                className={`min-h-[38px] rounded-md px-3 py-1.5 text-xs sm:text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
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
                      setIsRollSettled(false);
                      onChangeFirstPlayerChoice(choiceKey);
                    }}
                    className={`min-h-[38px] rounded-md px-3 py-1.5 text-xs sm:text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
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
                  onChangeFirstPlayerChoice('random');
                  triggerAnimatedD20Roll();
                }}
                className={`min-h-[38px] rounded-md px-3 py-1.5 text-xs sm:text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  effectiveFirstChoice === 'random'
                    ? 'bg-white text-sky-800 shadow-sm'
                    : 'text-zinc-600 hover:text-zinc-900'
                }`}
              >
                Random (d20)
              </button>
            </div>

            <div className="text-xs text-zinc-600">
              <span className="font-semibold text-zinc-800">Turn Order:</span>{' '}
              {turnOrderPreview}
            </div>

            {effectiveFirstChoice === 'random' && previewRollResult && (
              <D20RollOffStage
                rollResult={previewRollResult}
                rollNonce={rollNonce}
                soundEnabled={soundEnabled}
                compact
                title="d20 Roll-Off — Who Goes First"
                onReroll={handleRollPreview}
                onSettled={() => setIsRollSettled(true)}
              />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <label className="space-y-1.5 text-xs sm:text-sm">
              <span className="flex items-center gap-1.5 font-semibold text-zinc-800">
                <Bell className="h-4 w-4 text-sky-700" />
                Interrupt / Response Window
              </span>
              <select
                value={interruptWindowMode}
                onChange={(e) =>
                  onChangeInterruptWindowMode(e.target.value as InterruptWindowMode)
                }
                className="min-h-[40px] rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs sm:text-sm font-medium text-zinc-800 focus:border-sky-600 focus:outline-none"
              >
                <option value="12s">12s Auto-Pass Window (Default)</option>
                <option value="8s">8s Fast Response Window</option>
                <option value="20s">20s Relaxed Response Window</option>
                <option value="manual">Manual Priority (No Timer)</option>
                <option value="smart-only">Smart Only (Pause only if holding Instant)</option>
              </select>
            </label>

            <label className="space-y-1.5 text-xs sm:text-sm">
              <span className="flex items-center gap-1.5 font-semibold text-zinc-800">
                <FastForward className="h-4 w-4 text-sky-700" />
                Bot Turn Pace
              </span>
              <select
                value={botTurnPace}
                onChange={(e) =>
                  onChangeBotTurnPace(e.target.value as 'normal' | 'step' | 'fast')
                }
                className="min-h-[40px] rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs sm:text-sm font-medium text-zinc-800 focus:border-sky-600 focus:outline-none"
              >
                <option value="normal">Normal Pace</option>
                <option value="step">Step-by-Step (Manual Next Bot)</option>
                <option value="fast">Fast Bots</option>
              </select>
            </label>
          </div>
        </div>
        </div>
      </div>

      {/* Section 2: Per-Bot Intelligence, Personality & Deck Configuration */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-sky-700 shrink-0" />
            <h4 className="text-sm font-bold text-zinc-900">
              02. AI Opponent Roster ({activeBots.length})
            </h4>
          </div>

          {activeBots.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm">
              <span className="text-zinc-600 font-medium">Set All AI Level:</span>
              {BOT_INTELLIGENCE_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => applyIntelligenceToAll(opt.id)}
                  className="min-h-[36px] rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:border-sky-400 hover:text-sky-800 cursor-pointer whitespace-nowrap shrink-0"
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

            const customSummary = summarizeCustomBotDeck(
              bot.customDeckText || '',
              formatLabel,
              findMeta
            );
            const parsedCustomCount = customSummary.totalQty;

            const isMirrorDeck =
              Boolean(playerDeckSerializedText.trim()) &&
              (bot.customDeckText || '').trim() === playerDeckSerializedText.trim();
            const matchedSampleDeck = SAMPLE_DECKS.find(
              (d) => d.deckText.trim() === (bot.customDeckText || '').trim()
            );
            const matchedSavedDeck = savedCustomDecks.find(
              (d) => d.deckText.trim() === (bot.customDeckText || '').trim()
            );
            const botNotice = deckNoticeByBotId[bot.id];
            const isUrlOpen = Boolean(urlImportOpenByBotId[bot.id]);
            const isUrlLoading = Boolean(urlLoadingByBotId[bot.id]);

            return (
              <div
                key={bot.id}
                className="rounded-xl border border-zinc-300 bg-zinc-50/70 p-4 sm:p-5 space-y-4 flex flex-col justify-between"
              >
                <div className="space-y-4">
                  {/* Seat Header & Name Input */}
                  <div className="flex items-center justify-between gap-2.5">
                    <span className="font-mono text-xs sm:text-sm font-bold text-sky-700 whitespace-nowrap shrink-0">
                      Seat {idx + 2}
                    </span>
                    <input
                      type="text"
                      value={bot.name}
                      onChange={(e) => updateBot(idx, { name: e.target.value })}
                      aria-label={`Seat ${idx + 2} bot name`}
                      className="min-h-[38px] flex-1 min-w-0 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-semibold text-zinc-900 focus:border-sky-600 focus:outline-none"
                    />
                  </div>

                  {/* Intelligence Level */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2 text-xs sm:text-sm">
                      <span className="inline-flex items-center gap-1.5 font-semibold text-zinc-800">
                        <Brain className="h-4 w-4 text-sky-700" />
                        Intelligence Level
                      </span>
                      <span className={`font-semibold ${intelMeta.textColorClass}`}>
                        {intelMeta.label}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 rounded-lg bg-zinc-200/70 p-1">
                      {BOT_INTELLIGENCE_OPTIONS.map((opt) => {
                        const selected = intelMeta.id === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => updateBot(idx, { intelligence: opt.id })}
                            className={`min-h-[34px] rounded-md px-2 py-1.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap truncate ${
                              selected
                                ? 'bg-white text-zinc-900 shadow-sm'
                                : 'text-zinc-700 hover:text-zinc-900'
                            }`}
                          >
                            {opt.shortLabel}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-xs text-zinc-600 leading-snug">
                      {intelMeta.description}
                    </p>
                  </div>

                  {/* Aggression / Indignance */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2 text-xs sm:text-sm">
                      <span className="inline-flex items-center gap-1.5 font-semibold text-zinc-800">
                        <Flame className="h-4 w-4 text-amber-600" />
                        Playstyle / Indignance
                      </span>
                      <span className={`font-semibold ${indignanceMeta.textColorClass}`}>
                        {indignanceMeta.shortLabel}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 rounded-lg bg-zinc-200/70 p-1">
                      {BOT_INDIGNANCE_OPTIONS.map((opt) => {
                        const selected = indignanceMeta.id === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => updateBot(idx, { indignance: opt.id })}
                            className={`min-h-[34px] rounded-md px-2 py-1.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap truncate ${
                              selected
                                ? 'bg-white text-zinc-900 shadow-sm'
                                : 'text-zinc-700 hover:text-zinc-900'
                            }`}
                          >
                            {opt.shortLabel}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Bot Deck Selection */}
                  <div className="space-y-2.5 border-t border-zinc-200/80 pt-3.5">
                    <div className="flex items-center justify-between gap-2 text-xs sm:text-sm">
                      <span className="inline-flex items-center gap-1.5 font-semibold text-zinc-800">
                        <Swords className="h-4 w-4 text-sky-700" />
                        Bot Deck
                      </span>
                      <span className="text-xs text-zinc-600 font-mono tabular-nums truncate max-w-[190px]">
                        {activeDeckTab === 'archetype'
                          ? 'Built-in Archetype'
                          : isMirrorDeck
                          ? `Mirror (${parsedCustomCount} cards)`
                          : matchedSampleDeck
                          ? `${parsedCustomCount} cards`
                          : parsedCustomCount > 0
                          ? `${bot.customDeckName?.trim() || 'Custom'} (${parsedCustomCount})`
                          : 'Assign custom deck'}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-1 rounded-lg bg-zinc-200/70 p-1">
                      {(
                        [
                          { id: 'archetype', label: 'Archetype' },
                          { id: 'custom', label: 'Custom Deck' },
                          { id: 'preset', label: 'Preset / Mirror' },
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
                                customDeckName: '',
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
                                  customDeckName: `Mirror (${playerDeckName})`,
                                });
                              } else if (SAMPLE_DECKS[0]) {
                                updateBot(idx, {
                                  archetype: 'Custom Decklist',
                                  customDeckText: SAMPLE_DECKS[0].deckText,
                                  customDeckName: SAMPLE_DECKS[0].title,
                                });
                              }
                            }
                          }}
                          className={`min-h-[34px] rounded-md px-2 py-1.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap truncate ${
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
                          updateBot(idx, {
                            archetype: e.target.value,
                            customDeckText: '',
                            customDeckName: '',
                          })
                        }
                        aria-label={`${bot.name} deck archetype`}
                        className="min-h-[40px] w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs sm:text-sm font-medium text-zinc-900 focus:border-sky-600 focus:outline-none"
                      >
                        {LIVE_BOT_ARCHETYPES.map((arch) => (
                          <option key={arch} value={arch}>
                            {arch}
                          </option>
                        ))}
                      </select>
                    )}

                    {activeDeckTab === 'preset' && (
                      <div className="space-y-2">
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
                                customDeckName: `Mirror (${playerDeckName})`,
                              });
                            } else {
                              const found = SAMPLE_DECKS.find((d) => d.id === val);
                              if (found) {
                                updateBot(idx, {
                                  archetype: 'Custom Decklist',
                                  customDeckText: found.deckText,
                                  customDeckName: found.title,
                                });
                              }
                            }
                          }}
                          aria-label={`${bot.name} preset deck`}
                          className="min-h-[40px] w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs sm:text-sm font-medium text-zinc-900 focus:border-sky-600 focus:outline-none"
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
                        <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
                          <span className="truncate">
                            {isMirrorDeck
                              ? 'This bot will pilot an exact copy of your active deck.'
                              : matchedSampleDeck
                              ? matchedSampleDeck.subtitle
                              : 'Full card-by-card decklist loaded for this bot.'}
                          </span>
                          {parsedCustomCount > 0 && (
                            <button
                              type="button"
                              onClick={() =>
                                setDeckTabsByBotId((prev) => ({ ...prev, [bot.id]: 'custom' }))
                              }
                              className="font-semibold text-sky-700 hover:underline cursor-pointer whitespace-nowrap shrink-0"
                            >
                              Customize List
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {activeDeckTab === 'custom' && (
                      <div className="space-y-2.5 rounded-lg border border-zinc-300 bg-white p-3">
                        {/* Saved Custom Decks Bar */}
                        <div className="flex items-center gap-2">
                          <select
                            value={matchedSavedDeck?.id || ''}
                            onChange={(e) => {
                              const picked = savedCustomDecks.find((d) => d.id === e.target.value);
                              if (!picked) return;
                              updateBot(idx, {
                                archetype: 'Custom Decklist',
                                customDeckText: picked.deckText,
                                customDeckName: picked.name,
                              });
                              setBotNotice(bot.id, 'ok', `Loaded "${picked.name}"`);
                            }}
                            aria-label={`${bot.name} saved custom deck`}
                            className="min-h-[38px] flex-1 min-w-0 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-900 focus:border-sky-600 focus:outline-none"
                          >
                            <option value="">
                              {savedCustomDecks.length > 0
                                ? `Saved Custom Decks (${savedCustomDecks.length})...`
                                : 'No saved custom decks yet — paste or import below'}
                            </option>
                            {savedCustomDecks.map((saved) => (
                              <option key={saved.id} value={saved.id}>
                                {saved.name} ({saved.cardCount} cards
                                {saved.commanderName ? ` · ${saved.commanderName}` : ''})
                              </option>
                            ))}
                          </select>
                          {matchedSavedDeck && (
                            <button
                              type="button"
                              title={`Delete saved deck "${matchedSavedDeck.name}"`}
                              onClick={() => {
                                const next = deleteSavedCustomBotDeck(matchedSavedDeck.id);
                                setSavedCustomDecks(next);
                                setBotNotice(bot.id, 'ok', `Removed "${matchedSavedDeck.name}" from saved list`);
                              }}
                              className="inline-flex min-h-[38px] min-w-[38px] items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 p-1.5 text-zinc-500 hover:border-red-300 hover:text-red-700 cursor-pointer shrink-0"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>

                        {/* Custom Deck Name + Save Button */}
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={bot.customDeckName || ''}
                            onChange={(e) =>
                              updateBot(idx, { customDeckName: e.target.value })
                            }
                            placeholder={
                              customSummary.suggestedName || 'Custom deck name (e.g. Kinnan cEDH)'
                            }
                            aria-label={`${bot.name} custom deck name`}
                            className="min-h-[38px] flex-1 min-w-0 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs sm:text-sm font-medium text-zinc-900 placeholder:text-zinc-500 focus:border-sky-600 focus:outline-none"
                          />
                          <button
                            type="button"
                            disabled={parsedCustomCount === 0}
                            onClick={() => {
                              const nameToSave =
                                (bot.customDeckName || '').trim() ||
                                customSummary.suggestedName ||
                                `${bot.name} Custom Deck`;
                              const next = saveCustomBotDeck({
                                id: matchedSavedDeck?.id,
                                name: nameToSave,
                                deckText: bot.customDeckText || '',
                                commanderName: customSummary.commanders[0],
                                cardCount: parsedCustomCount,
                              });
                              setSavedCustomDecks(next);
                              if (!bot.customDeckName?.trim()) {
                                updateBot(idx, { customDeckName: nameToSave });
                              }
                              setBotNotice(bot.id, 'ok', `Saved "${nameToSave}"`);
                            }}
                            title="Save this custom decklist for future Live Games"
                            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-800 hover:bg-sky-100 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
                          >
                            <BookmarkPlus className="h-3.5 w-3.5" />
                            Save
                          </button>
                        </div>

                        {/* Quick Action Strip: URL Import, File Upload, Paste, Copy, Copy Mine */}
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              setUrlImportOpenByBotId((prev) => ({
                                ...prev,
                                [bot.id]: !prev[bot.id],
                              }))
                            }
                            className={`inline-flex min-h-[32px] items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-semibold cursor-pointer ${
                              isUrlOpen
                                ? 'border-sky-300 bg-sky-50 text-sky-800'
                                : 'border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100'
                            }`}
                          >
                            <Link2 className="h-3.5 w-3.5 text-sky-700" />
                            URL
                          </button>
                          <button
                            type="button"
                            onClick={() => fileInputRefs.current[bot.id]?.click()}
                            className="inline-flex min-h-[32px] items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 cursor-pointer"
                          >
                            <FileUp className="h-3.5 w-3.5 text-sky-700" />
                            File
                          </button>
                          <input
                            ref={(el) => {
                              fileInputRefs.current[bot.id] = el;
                            }}
                            type="file"
                            accept=".txt,.dec,.mwdeck,.csv,.cod,text/plain"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              e.target.value = '';
                              if (file) {
                                void handleUploadBotDeckFile(idx, bot.id, file);
                              }
                            }}
                          />
                          <button
                            type="button"
                            onClick={async () => {
                              const clip = await readTextFromClipboard();
                              if (!clip.ok) {
                                setBotNotice(
                                  bot.id,
                                  'err',
                                  'Clipboard blocked — click the text box and press Ctrl+V.'
                                );
                                return;
                              }
                              if (!clip.text.trim()) {
                                setBotNotice(bot.id, 'err', 'Clipboard is empty.');
                                return;
                              }
                              const summary = summarizeCustomBotDeck(clip.text, formatLabel, findMeta);
                              updateBot(idx, {
                                archetype: 'Custom Decklist',
                                customDeckText: clip.text,
                                customDeckName:
                                  bot.customDeckName?.trim() || summary.suggestedName || '',
                              });
                              setBotNotice(bot.id, 'ok', `Pasted ${summary.totalQty} cards`);
                            }}
                            className="inline-flex min-h-[32px] items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 cursor-pointer"
                          >
                            <ClipboardPaste className="h-3.5 w-3.5 text-sky-700" />
                            Paste
                          </button>
                          {parsedCustomCount > 0 && (
                            <button
                              type="button"
                              onClick={async () => {
                                const ok = await copyTextToClipboard(bot.customDeckText || '');
                                setBotNotice(
                                  bot.id,
                                  ok ? 'ok' : 'err',
                                  ok ? 'Copied bot decklist' : 'Copy failed'
                                );
                              }}
                              className="inline-flex min-h-[32px] items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 cursor-pointer"
                            >
                              <Copy className="h-3.5 w-3.5 text-zinc-600" />
                              Copy
                            </button>
                          )}
                          {playerDeckSerializedText.trim() && (
                            <button
                              type="button"
                              onClick={() => {
                                updateBot(idx, {
                                  archetype: 'Custom Decklist',
                                  customDeckText: playerDeckSerializedText,
                                  customDeckName: `Mirror (${playerDeckName})`,
                                });
                                setBotNotice(bot.id, 'ok', `Loaded "${playerDeckName}"`);
                              }}
                              className="inline-flex min-h-[32px] items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-800 hover:bg-sky-100 cursor-pointer"
                            >
                              Copy Mine
                            </button>
                          )}
                          {activeBots.length > 1 && parsedCustomCount > 0 && (
                            <button
                              type="button"
                              onClick={() => applyCustomDeckToAllBots(bot)}
                              className="inline-flex min-h-[32px] items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 cursor-pointer"
                            >
                              All Bots
                            </button>
                          )}
                          {bot.customDeckText && (
                            <button
                              type="button"
                              onClick={() =>
                                updateBot(idx, {
                                  customDeckText: '',
                                  customDeckName: '',
                                  archetype:
                                    FALLBACK_BOT_SEATS[idx]?.archetype ||
                                    LIVE_BOT_ARCHETYPES[0],
                                })
                              }
                              className="inline-flex min-h-[32px] items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-500 hover:text-zinc-900 cursor-pointer"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                              Clear
                            </button>
                          )}
                        </div>

                        {/* Inline URL Import Input */}
                        {isUrlOpen && (
                          <div className="flex items-center gap-2">
                            <input
                              type="url"
                              value={urlInputByBotId[bot.id] || ''}
                              onChange={(e) =>
                                setUrlInputByBotId((prev) => ({
                                  ...prev,
                                  [bot.id]: e.target.value,
                                }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  void handleImportBotUrl(idx, bot.id);
                                }
                              }}
                              placeholder="https://moxfield.com/decks/... or archidekt.com/..."
                              className="min-h-[38px] flex-1 min-w-0 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs sm:text-sm text-zinc-900 placeholder:text-zinc-500 focus:border-sky-600 focus:outline-none"
                            />
                            <button
                              type="button"
                              disabled={isUrlLoading}
                              onClick={() => void handleImportBotUrl(idx, bot.id)}
                              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-sky-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-sky-800 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                            >
                              {isUrlLoading ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                'Import'
                              )}
                            </button>
                          </div>
                        )}

                        {botNotice && (
                          <div
                            className={`flex items-center gap-1.5 text-xs font-medium ${
                              botNotice.tone === 'ok' ? 'text-emerald-700' : 'text-red-700'
                            }`}
                          >
                            {botNotice.tone === 'ok' && <Check className="h-3.5 w-3.5 shrink-0" />}
                            <span>{botNotice.text}</span>
                          </div>
                        )}

                        <textarea
                          rows={4}
                          value={bot.customDeckText || ''}
                          onChange={(e) => {
                            const nextText = e.target.value;
                            updateBot(idx, {
                              archetype: nextText.trim()
                                ? 'Custom Decklist'
                                : FALLBACK_BOT_SEATS[idx]?.archetype || LIVE_BOT_ARCHETYPES[0],
                              customDeckText: nextText,
                              customDeckName: nextText.trim() ? bot.customDeckName : '',
                            });
                          }}
                          placeholder={`Paste Arena / Moxfield / Archidekt list...\n1 Sol Ring\n1 Counterspell\n...`}
                          className="w-full rounded-lg border border-zinc-300 bg-white p-2.5 font-mono text-xs leading-relaxed text-zinc-900 placeholder:text-zinc-500 focus:border-sky-600 focus:outline-none resize-y"
                        />

                        {/* Parsed Summary & Commander Selector */}
                        <div className="space-y-2 text-xs">
                          <div className="flex flex-wrap items-center justify-between gap-1 text-zinc-600">
                            <span className="font-mono tabular-nums font-medium">
                              {parsedCustomCount > 0
                                ? `${parsedCustomCount} cards (${customSummary.cmdQty} Cmdr + ${customSummary.mainQty} Main)`
                                : 'Empty list falls back to archetype deck'}
                            </span>
                            {resolvingCustomMeta && parsedCustomCount > 0 ? (
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-sky-700">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                Syncing stats...
                              </span>
                            ) : customSummary.commanders.length > 0 ? (
                              <span className="font-semibold text-sky-800 truncate max-w-[210px]">
                                Cmdr: {customSummary.commanders.join(' & ')}
                              </span>
                            ) : null}
                          </div>

                          {customSummary.candidates.length > 0 && (
                            <div className="flex items-center gap-2">
                              <label
                                htmlFor={`live-bot-cmd-${bot.id}`}
                                className="text-xs font-semibold text-zinc-700 whitespace-nowrap"
                              >
                                Bot Cmdr:
                              </label>
                              <select
                                id={`live-bot-cmd-${bot.id}`}
                                value={customSummary.commanders[0] || ''}
                                onChange={(e) => {
                                  const chosen = e.target.value;
                                  if (!chosen || !bot.customDeckText) return;
                                  const secondPartner =
                                    customSummary.commanders.length > 1 &&
                                    normalizeCardLookupKey(customSummary.commanders[1]) !==
                                      normalizeCardLookupKey(chosen)
                                      ? customSummary.commanders[1]
                                      : undefined;
                                  updateBot(idx, {
                                    archetype: 'Custom Decklist',
                                    customDeckText: setDecklistCommanderClientSide(
                                      bot.customDeckText,
                                      chosen,
                                      secondPartner
                                    ),
                                  });
                                }}
                                className="min-h-[36px] w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs sm:text-sm font-medium text-zinc-900 focus:border-sky-600 focus:outline-none"
                              >
                                <option value="">
                                  {customSummary.commanders.length > 0
                                    ? 'Change bot commander...'
                                    : 'Select commander card...'}
                                </option>
                                {customSummary.candidates.map((cn) => (
                                  <option key={cn} value={cn}>
                                    {cn}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
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
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs sm:text-sm text-zinc-600">
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
          className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-sky-700 px-6 py-2.5 text-sm font-bold text-white hover:bg-sky-800 cursor-pointer whitespace-nowrap shrink-0"
        >
          <Play className="h-4 w-4 fill-current" />
          Start Live Game ({mode} · {startingLife} Life)
        </button>
      </div>

      {/* Animated d20 Launch Roll-Off Modal (shown when launching with unrolled Random d20) */}
      {launchRollModalOpen && previewRollResult && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Rolling d20 to see who goes first"
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/75 p-4 backdrop-blur-sm"
        >
          <div className="w-full max-w-2xl rounded-2xl border border-sky-400/50 bg-white p-5 shadow-2xl space-y-4">
            <D20RollOffStage
              rollResult={previewRollResult}
              rollNonce={rollNonce}
              soundEnabled={soundEnabled}
              title="Rolling d20 to See Who Goes First..."
              autoLaunchCountdownLabel="Start Match Now"
              onSkipAndProceed={() => {
                if (autoLaunchTimerRef.current) {
                  window.clearTimeout(autoLaunchTimerRef.current);
                  autoLaunchTimerRef.current = null;
                }
                setLaunchRollModalOpen(false);
                onStartLiveGame(previewRollResult.winnerSeatIdx, previewRollResult.summary);
              }}
              onSettled={(settled) => {
                setIsRollSettled(true);
                autoLaunchTimerRef.current = window.setTimeout(() => {
                  setLaunchRollModalOpen(false);
                  onStartLiveGame(settled.winnerSeatIdx, settled.summary);
                }, 700);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
