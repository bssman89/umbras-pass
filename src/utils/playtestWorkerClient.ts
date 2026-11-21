import type {
  BotLearningProfile,
  CardMetadata,
  DeckFormat,
  PlaytestResult,
  ResolvedDeckCard,
} from '../types/deck';
import type {
  PlaytestWorkerLearningsPayload,
  PlaytestWorkerRequest,
  PlaytestWorkerResponse,
  PlaytestWorkerRunPayload,
} from '../workers/playtestWorker';
import { applyMatchLearningsToBotProfiles } from './botLearning';
import {
  autoRecognizeCommandersClientSide,
  parseDecklistClientSide,
  simulatePlaytestClientSideFallback,
} from './clientFallbackAnalyzer';
import { findMetaFromMap, normalizeCardLookupKey } from './playtestReconciler';
import type { OperationProgressUpdate } from './streamApi';

interface PendingWorkerRequest<T> {
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
  onProgress?: (update: OperationProgressUpdate) => void;
  cleanupAbort?: () => void;
}

let workerInstance: Worker | null = null;
let workerIdleTimer: ReturnType<typeof setTimeout> | null = null;
const WORKER_IDLE_TERMINATE_MS = 45_000;
let nextRequestId = 1;
const pendingRequests = new Map<number, PendingWorkerRequest<unknown>>();

function clearWorkerIdleTimer(): void {
  if (workerIdleTimer !== null) {
    clearTimeout(workerIdleTimer);
    workerIdleTimer = null;
  }
}

function scheduleWorkerIdleTerminate(): void {
  clearWorkerIdleTimer();
  if (!workerInstance || pendingRequests.size > 0) return;
  workerIdleTimer = setTimeout(() => {
    if (pendingRequests.size === 0) {
      terminatePlaytestWorker();
    }
  }, WORKER_IDLE_TERMINATE_MS);
}

function createAbortError(message = 'Playtest simulation cancelled.'): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException(message, 'AbortError');
  }
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

function rejectAllPending(reason: unknown): void {
  for (const [id, entry] of pendingRequests.entries()) {
    pendingRequests.delete(id);
    entry.cleanupAbort?.();
    entry.reject(reason);
  }
}

export function terminatePlaytestWorker(): void {
  clearWorkerIdleTimer();
  if (workerInstance) {
    try {
      workerInstance.terminate();
    } catch {
      // Ignore termination errors
    }
    workerInstance = null;
  }
  if (pendingRequests.size > 0) {
    rejectAllPending(createAbortError('Playtest worker terminated.'));
  }
}

function ensureWorker(): Worker | null {
  if (typeof Worker === 'undefined') {
    return null;
  }
  if (workerInstance) {
    return workerInstance;
  }

  try {
    const worker = new Worker(
      new URL('../workers/playtestWorker.ts', import.meta.url),
      { type: 'module' }
    );

    worker.onmessage = (event: MessageEvent<PlaytestWorkerResponse>) => {
      const msg = event.data;
      if (!msg || typeof msg.requestId !== 'number') return;

      const entry = pendingRequests.get(msg.requestId);
      if (!entry) return;

      if (msg.type === 'progress') {
        entry.onProgress?.({
          percent: msg.percent,
          stage: msg.stage,
          detail: msg.detail,
        });
        return;
      }

      pendingRequests.delete(msg.requestId);
      entry.cleanupAbort?.();
      scheduleWorkerIdleTerminate();

      if (msg.type === 'error') {
        entry.reject(new Error(msg.error || 'Playtest background worker failed.'));
        return;
      }

      if (msg.type === 'simulation-result') {
        entry.resolve({
          result: msg.result,
          updatedProfiles: msg.updatedProfiles,
        });
        return;
      }

      if (msg.type === 'learnings-result') {
        entry.resolve({
          updatedProfiles: msg.updatedProfiles,
        });
      }
    };

    worker.onerror = (err) => {
      const errorMsg =
        err instanceof ErrorEvent && err.message
          ? err.message
          : 'Playtest background worker encountered an error.';
      try {
        worker.terminate();
      } catch {
        // Ignore
      }
      if (workerInstance === worker) {
        workerInstance = null;
      }
      rejectAllPending(new Error(errorMsg));
    };

    worker.onmessageerror = () => {
      try {
        worker.terminate();
      } catch {
        // Ignore
      }
      if (workerInstance === worker) {
        workerInstance = null;
      }
      rejectAllPending(new Error('Failed to deserialize playtest worker message.'));
    };

    workerInstance = worker;
    return worker;
  } catch {
    return null;
  }
}

function postWorkerRequest<T>(
  buildMessage: (requestId: number) => PlaytestWorkerRequest,
  onProgress?: (update: OperationProgressUpdate) => void,
  signal?: AbortSignal
): Promise<T> {
  if (signal?.aborted) {
    return Promise.reject(createAbortError());
  }

  const worker = ensureWorker();
  if (!worker) {
    return Promise.reject(new Error('WORKER_UNAVAILABLE'));
  }

  clearWorkerIdleTimer();
  const requestId = nextRequestId++;

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      pendingRequests.delete(requestId);
      terminatePlaytestWorker();
      reject(createAbortError());
    };

    const cleanupAbort = () => {
      signal?.removeEventListener('abort', onAbort);
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    pendingRequests.set(requestId, {
      resolve: resolve as (value: unknown) => void,
      reject,
      onProgress,
      cleanupAbort,
    });

    try {
      worker.postMessage(buildMessage(requestId));
    } catch (postErr) {
      pendingRequests.delete(requestId);
      cleanupAbort();
      scheduleWorkerIdleTerminate();
      reject(postErr);
    }
  });
}

function runSimulationSyncFallback(
  payload: PlaytestWorkerRunPayload,
  onProgress?: (update: OperationProgressUpdate) => void
): { result: PlaytestResult; updatedProfiles?: BotLearningProfile[] } {
  onProgress?.({
    percent: 52,
    stage: 'Preparing custom bot decks & commanders...',
    detail: `${payload.mode.toUpperCase()} (${payload.opponents.length} bot${payload.opponents.length === 1 ? '' : 's'})`,
  });

  const metaLookup = new Map<string, CardMetadata>();
  const register = (name: string, meta: CardMetadata | null | undefined) => {
    if (!meta) return;
    metaLookup.set(normalizeCardLookupKey(name), meta);
    if (meta.name) {
      metaLookup.set(normalizeCardLookupKey(meta.name), meta);
      if (meta.name.includes(' // ')) {
        metaLookup.set(normalizeCardLookupKey(meta.name.split(' // ')[0]), meta);
      }
    }
  };
  for (const m of payload.extraCardMeta) {
    if (m?.name) register(m.name, m);
  }
  for (const rc of payload.resolvedCards) {
    register(rc.name, rc.card);
  }

  const resolvedCustomCardsByBotIndex: Record<number, ResolvedDeckCard[]> = {};
  payload.opponents.forEach((opp, idx) => {
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
        ? payload.format === 'brawl'
          ? 'brawl'
          : 'commander'
        : payload.format;
    autoRecognizeCommandersClientSide(cards, botFmt);
    resolvedCustomCardsByBotIndex[idx] = cards;
  });

  onProgress?.({
    percent: 72,
    stage: `Running deterministic ${payload.mode} match turns & endgame checks...`,
  });

  const result = simulatePlaytestClientSideFallback({
    deckName: payload.deckName,
    format: payload.format,
    resolvedCards: payload.resolvedCards,
    overrideDeckText: payload.overrideDeckText,
    testedListLabel: payload.testedListLabel,
    mode: payload.mode,
    opponents: payload.opponents,
    botMemoryProfiles: payload.botMemoryProfiles,
    extraCardMeta: payload.extraCardMeta,
    resolvedCustomCardsByBotIndex,
    botTacticalDirectives: payload.botTacticalDirectives,
  });

  let updatedProfiles: BotLearningProfile[] | undefined;
  if (payload.existingMemory && payload.analysisForLearnings) {
    updatedProfiles = applyMatchLearningsToBotProfiles({
      existingMemory: payload.existingMemory,
      opponents: payload.opponents,
      result,
      analysis: payload.analysisForLearnings,
    }).updatedProfiles;
  }

  return { result, updatedProfiles };
}

export async function runPlaytestInWorker(
  payload: PlaytestWorkerRunPayload,
  onProgress?: (update: OperationProgressUpdate) => void,
  signal?: AbortSignal
): Promise<{ result: PlaytestResult; updatedProfiles?: BotLearningProfile[] }> {
  if (signal?.aborted) {
    throw createAbortError();
  }

  try {
    return await postWorkerRequest<{
      result: PlaytestResult;
      updatedProfiles?: BotLearningProfile[];
    }>(
      (requestId) => ({
        type: 'run-simulation',
        requestId,
        payload,
      }),
      onProgress,
      signal
    );
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw err;
    }
    if (
      err instanceof Error &&
      (err.message === 'WORKER_UNAVAILABLE' || /worker/i.test(err.message))
    ) {
      return runSimulationSyncFallback(payload, onProgress);
    }
    throw err;
  }
}

export async function applyBotLearningsInWorker(
  payload: PlaytestWorkerLearningsPayload,
  signal?: AbortSignal
): Promise<BotLearningProfile[]> {
  if (signal?.aborted) {
    throw createAbortError();
  }

  try {
    const res = await postWorkerRequest<{ updatedProfiles: BotLearningProfile[] }>(
      (requestId) => ({
        type: 'apply-learnings',
        requestId,
        payload,
      }),
      undefined,
      signal
    );
    return res.updatedProfiles;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw err;
    }
    return applyMatchLearningsToBotProfiles(payload).updatedProfiles;
  }
}
