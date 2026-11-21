import type {
  BotLearningProfile,
  BotOpponentConfig,
  CardMetadata,
  DeckAnalysisResult,
  DeckFormat,
  PlaytestMode,
  PlaytestResult,
  ResolvedDeckCard,
} from '../types/deck';
import { applyMatchLearningsToBotProfiles } from '../utils/botLearning';
import {
  autoRecognizeCommandersClientSide,
  parseDecklistClientSide,
  simulatePlaytestClientSideFallback,
  type BotMatchTacticalDirective,
} from '../utils/clientFallbackAnalyzer';
import { findMetaFromMap, normalizeCardLookupKey } from '../utils/playtestReconciler';

export interface PlaytestWorkerRunPayload {
  deckName: string;
  format: Exclude<DeckFormat, 'auto'>;
  resolvedCards: ResolvedDeckCard[];
  overrideDeckText?: string;
  testedListLabel: string;
  mode: PlaytestMode;
  opponents: BotOpponentConfig[];
  botMemoryProfiles: BotLearningProfile[];
  extraCardMeta: CardMetadata[];
  botTacticalDirectives?: Record<string, BotMatchTacticalDirective>;
  existingMemory?: Record<string, BotLearningProfile>;
  analysisForLearnings?: DeckAnalysisResult;
}

export interface PlaytestWorkerLearningsPayload {
  existingMemory: Record<string, BotLearningProfile>;
  opponents: BotOpponentConfig[];
  result: PlaytestResult;
  analysis: DeckAnalysisResult;
}

export type PlaytestWorkerRequest =
  | {
      type: 'run-simulation';
      requestId: number;
      payload: PlaytestWorkerRunPayload;
    }
  | {
      type: 'apply-learnings';
      requestId: number;
      payload: PlaytestWorkerLearningsPayload;
    };

export type PlaytestWorkerResponse =
  | {
      type: 'progress';
      requestId: number;
      percent: number;
      stage: string;
      detail?: string;
    }
  | {
      type: 'simulation-result';
      requestId: number;
      result: PlaytestResult;
      updatedProfiles?: BotLearningProfile[];
    }
  | {
      type: 'learnings-result';
      requestId: number;
      updatedProfiles: BotLearningProfile[];
    }
  | {
      type: 'error';
      requestId: number;
      error: string;
    };

function buildMetaLookup(
  resolvedCards: ResolvedDeckCard[],
  extraCardMeta: CardMetadata[]
): Map<string, CardMetadata> {
  const map = new Map<string, CardMetadata>();
  const register = (name: string, meta: CardMetadata | null | undefined) => {
    if (!meta) return;
    map.set(normalizeCardLookupKey(name), meta);
    if (meta.name) {
      map.set(normalizeCardLookupKey(meta.name), meta);
      if (meta.name.includes(' // ')) {
        map.set(normalizeCardLookupKey(meta.name.split(' // ')[0]), meta);
      }
    }
  };
  for (const m of extraCardMeta) {
    if (m?.name) register(m.name, m);
  }
  for (const rc of resolvedCards) {
    register(rc.name, rc.card);
  }
  return map;
}

const workerScope = globalThis as unknown as {
  onmessage: ((ev: MessageEvent<PlaytestWorkerRequest>) => void) | null;
  postMessage: (msg: PlaytestWorkerResponse) => void;
};

workerScope.onmessage = (event: MessageEvent<PlaytestWorkerRequest>) => {
  const msg = event.data;
  if (!msg || typeof msg.requestId !== 'number') return;

  try {
    if (msg.type === 'run-simulation') {
      const {
        deckName,
        format,
        resolvedCards,
        overrideDeckText,
        testedListLabel,
        mode,
        opponents,
        botMemoryProfiles,
        extraCardMeta,
        botTacticalDirectives,
        existingMemory,
        analysisForLearnings,
      } = msg.payload;

      workerScope.postMessage({
        type: 'progress',
        requestId: msg.requestId,
        percent: 50,
        stage: 'Preparing custom bot decks & commanders in background worker...',
        detail: `${mode.toUpperCase()} (${opponents.length} bot${opponents.length === 1 ? '' : 's'})`,
      });

      const metaLookup = buildMetaLookup(resolvedCards, extraCardMeta);
      const resolvedCustomCardsByBotIndex: Record<number, ResolvedDeckCard[]> = {};

      opponents.forEach((opp, idx) => {
        if (!opp.customDeckText || !opp.customDeckText.trim()) return;
        const parsedBot = parseDecklistClientSide(opp.customDeckText);
        const cards: ResolvedDeckCard[] = parsedBot.cards.map((c) => {
          const meta = findMetaFromMap(metaLookup, c.name) || null;
          return {
            ...c,
            name: meta ? meta.name : c.name,
            card: meta,
          };
        });
        const totalQty = cards
          .filter((c) => c.zone === 'main' || c.zone === 'commander')
          .reduce((s, c) => s + c.quantity, 0);
        const botFmt: Exclude<DeckFormat, 'auto'> =
          cards.some((c) => c.zone === 'commander') || totalQty >= 85
            ? format === 'brawl'
              ? 'brawl'
              : 'commander'
            : format;
        autoRecognizeCommandersClientSide(cards, botFmt);
        resolvedCustomCardsByBotIndex[idx] = cards;
      });

      workerScope.postMessage({
        type: 'progress',
        requestId: msg.requestId,
        percent: 72,
        stage: `Simulating ${mode} bot decisions, combat & endgame lines...`,
        detail: 'Running in background Web Worker (UI responsive)',
      });

      const result = simulatePlaytestClientSideFallback({
        deckName,
        format,
        resolvedCards,
        overrideDeckText,
        testedListLabel,
        mode,
        opponents,
        botMemoryProfiles,
        extraCardMeta,
        resolvedCustomCardsByBotIndex,
        botTacticalDirectives,
      });

      let updatedProfiles: BotLearningProfile[] | undefined;
      if (existingMemory && analysisForLearnings) {
        workerScope.postMessage({
          type: 'progress',
          requestId: msg.requestId,
          percent: 92,
          stage: 'Updating adaptive bot IQ profiles...',
        });
        updatedProfiles = applyMatchLearningsToBotProfiles({
          existingMemory,
          opponents,
          result,
          analysis: analysisForLearnings,
        }).updatedProfiles;
      }

      workerScope.postMessage({
        type: 'simulation-result',
        requestId: msg.requestId,
        result,
        updatedProfiles,
      });
      return;
    }

    if (msg.type === 'apply-learnings') {
      const { existingMemory, opponents, result, analysis } = msg.payload;
      const { updatedProfiles } = applyMatchLearningsToBotProfiles({
        existingMemory,
        opponents,
        result,
        analysis,
      });
      workerScope.postMessage({
        type: 'learnings-result',
        requestId: msg.requestId,
        updatedProfiles,
      });
    }
  } catch (err) {
    workerScope.postMessage({
      type: 'error',
      requestId: msg.requestId,
      error: err instanceof Error ? err.message : 'Playtest background worker failed.',
    });
  }
};
