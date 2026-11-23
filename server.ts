import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  BotOpponentConfig,
  DeckFormat,
  DeckGoal,
  PlaytestMode,
  ResolvedDeckCard,
} from './src/types/deck.ts';
import { importDeckFromUrl, parseUniversalDecklist } from './server/deckParser.ts';
import { computeDeckMetrics, detectFormat, resolveCardNamesWithScryfall } from './server/scryfall.ts';
import { analyzeDeckWithGemini } from './server/analyzer.ts';
import { getAllPrintingsForCard, searchMtgDatabase } from './server/marketplace.ts';
import { runBotPlaytest } from './server/playtester.ts';
import {
  decideLiveBotTurn,
  planLiveBotMatch,
  synthesizeLiveBotLearnings,
  type LiveBotLearnRequest,
  type LiveBotPlanRequest,
  type LiveBotTurnRequest,
} from './server/liveBotAi.ts';
import {
  clearBotTrainingData,
  loadBotTrainingData,
  loadDesktopWorkspace,
  saveDesktopWorkspace,
  type AiEngineMode,
  type ComputeMode,
} from './server/desktopStorage.ts';
import {
  cancelActiveDownload,
  deleteInstalledModel,
  disposeCachedRuntime,
  getDesktopAiStatus,
  selectDesktopAiEngine,
  startHuggingFaceDownload,
} from './server/localAi.ts';
import {
  cancelUpdateDownload,
  checkGitHubUpdates,
  getUpdateDownloadState,
  startReleaseAssetDownload,
} from './server/updater.ts';
import { registerMultiplayerRoutes } from './server/multiplayerServer.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function redactSensitiveKey(text: string): string {
  let sanitized = text.replace(/AIza[0-9A-Za-z_-]{20,}/g, '[redacted]');
  const activeKey = process.env.GEMINI_API_KEY;
  if (activeKey && activeKey.length > 6) {
    sanitized = sanitized.split(activeKey).join('[redacted]');
  }
  return sanitized;
}

function getGeminiErrorPayload(
  err: unknown,
  contextLabel: string,
  fallbackMessage: string
): { status: number; message: string } {
  const rawMessage = redactSensitiveKey(
    err instanceof Error ? err.message : String(err || fallbackMessage)
  );
  let parsedCode: number | undefined;
  let parsedMessage = rawMessage;

  const jsonStart = rawMessage.indexOf('{');
  if (jsonStart !== -1) {
    try {
      const parsed = JSON.parse(rawMessage.slice(jsonStart)) as {
        error?: { code?: number; message?: string; status?: string };
      };
      if (parsed?.error) {
        parsedCode = parsed.error.code;
        if (parsed.error.message) {
          parsedMessage = redactSensitiveKey(parsed.error.message);
        }
      }
    } catch {
      // Keep rawMessage when payload isn't JSON
    }
  }

  const lower = `${rawMessage} ${parsedMessage}`.toLowerCase();

  if (parsedCode === 402 || lower.includes('prepayment credits') || lower.includes('credits are depleted')) {
    console.warn(`${contextLabel}: Gemini API prepayment credits depleted (402).`);
    return {
      status: 402,
      message:
        'Your current Gemini API key is tied to a project with depleted prepayment credits. To use the Free Tier instead, generate a Free Tier key in Google AI Studio (without paid billing linked) and update GEMINI_API_KEY in Settings > Secrets.',
    };
  }

  if (parsedCode === 403 || lower.includes('api_key_invalid') || lower.includes('permission_denied')) {
    console.warn(`${contextLabel}: Gemini API key rejected (403).`);
    return {
      status: 403,
      message: 'Gemini API key issue detected. Please check your GEMINI_API_KEY in Settings > Secrets.',
    };
  }

  if (parsedCode === 429 || lower.includes('resource_exhausted')) {
    console.warn(`${contextLabel}: Gemini API quota/rate limit reached (429).`);
    return {
      status: 429,
      message:
        'Gemini API quota or rate limit reached. Please wait a moment and try again, or check billing in Settings > Secrets.',
    };
  }

  console.warn(`${contextLabel}: ${parsedMessage}`);
  return { status: 500, message: parsedMessage || fallbackMessage };
}

function sendGeminiRouteError(
  res: express.Response,
  err: unknown,
  contextLabel: string,
  fallbackMessage: string
) {
  const { status, message } = getGeminiErrorPayload(err, contextLabel, fallbackMessage);
  res.status(status).json({ error: message });
}

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  registerMultiplayerRoutes(app);

  app.get('/api/updates/check', async (req, res) => {
    try {
      const force = req.query.force === '1' || req.query.force === 'true';
      const result = await checkGitHubUpdates(force);
      res.json(result);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to check for GitHub updates.',
      });
    }
  });

  app.get('/api/updates/download-status', (_req, res) => {
    res.json(getUpdateDownloadState());
  });

  app.post('/api/updates/download', async (req, res) => {
    try {
      const { tag, assetName } = req.body as { tag?: string; assetName?: string };
      if (!tag || typeof tag !== 'string' || !tag.trim()) {
        res.status(400).json({ error: 'Release tag is required.' });
        return;
      }
      const state = await startReleaseAssetDownload(
        tag.trim(),
        typeof assetName === 'string' && assetName.trim() ? assetName.trim() : undefined
      );
      res.json(state);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to start update download.',
      });
    }
  });

  app.post('/api/updates/cancel', (_req, res) => {
    res.json(cancelUpdateDownload());
  });

  app.get('/api/desktop/ai-status', (_req, res) => {
    try {
      res.json(getDesktopAiStatus());
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to inspect desktop AI status.',
      });
    }
  });

  app.post('/api/desktop/models/download', async (req, res) => {
    try {
      const { modelId } = req.body as { modelId?: string };
      if (!modelId || typeof modelId !== 'string') {
        res.status(400).json({ error: 'modelId is required.' });
        return;
      }
      const state = await startHuggingFaceDownload(modelId);
      res.json(state);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to start Hugging Face model download.',
      });
    }
  });

  app.post('/api/desktop/models/cancel', (_req, res) => {
    res.json(cancelActiveDownload());
  });

  app.post('/api/desktop/models/select', async (req, res) => {
    try {
      const {
        activeEngine,
        selectedModelId,
        customModelPath,
        computeMode,
        cpuThreads,
        autoLearnFromMatches,
      } = req.body as {
          activeEngine?: AiEngineMode;
          selectedModelId?: string | null;
          customModelPath?: string | null;
          computeMode?: ComputeMode;
          cpuThreads?: number;
          autoLearnFromMatches?: boolean;
        };
      const status = await selectDesktopAiEngine({
        activeEngine,
        selectedModelId,
        customModelPath,
        computeMode,
        cpuThreads,
        autoLearnFromMatches,
      });
      res.json(status);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to update AI engine selection.',
      });
    }
  });

  app.delete('/api/desktop/models/:modelId', async (req, res) => {
    try {
      const status = await deleteInstalledModel(req.params.modelId);
      res.json(status);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to delete installed model.',
      });
    }
  });

  app.get('/api/desktop/bot-training', (_req, res) => {
    res.json(loadBotTrainingData());
  });

  app.delete('/api/desktop/bot-training', (_req, res) => {
    clearBotTrainingData();
    res.json(getDesktopAiStatus());
  });

  app.get('/api/desktop/storage', (_req, res) => {
    res.json(loadDesktopWorkspace());
  });

  app.post('/api/desktop/storage', (req, res) => {
    try {
      const { snapshots, botMemory } = req.body as {
        snapshots?: import('./src/types/deck.ts').DeckVersionSnapshot[];
        botMemory?: Record<string, import('./src/types/deck.ts').BotLearningProfile>;
      };
      const saved = saveDesktopWorkspace({ snapshots, botMemory });
      res.json({ ok: true, updatedAt: saved.updatedAt });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to persist desktop workspace.',
      });
    }
  });

  app.get('/api/cards/printings', async (req, res) => {
    try {
      const name = typeof req.query.name === 'string' ? req.query.name : '';
      if (!name.trim()) {
        res.status(400).json({ error: 'Card name query parameter is required.' });
        return;
      }
      const data = await getAllPrintingsForCard(name);
      res.json(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load card printings.';
      res.status(404).json({ error: message });
    }
  });

  app.get('/api/cards/search', async (req, res) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      if (!q.trim()) {
        res.json({ cards: [] });
        return;
      }
      const cards = await searchMtgDatabase(q);
      res.json({ cards });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to search MTG card database.';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/cards/resolve', async (req, res) => {
    try {
      const { names = [], format = 'commander' } = req.body as {
        names?: string[];
        format?: DeckFormat;
      };
      const cleanNames = Array.isArray(names)
        ? names.filter((n): n is string => typeof n === 'string' && n.trim().length > 0).slice(0, 200)
        : [];
      if (cleanNames.length === 0) {
        res.json({ cards: {} });
        return;
      }
      const resolvedFormat: Exclude<DeckFormat, 'auto'> =
        format === 'auto' ? 'commander' : format;
      const map = await resolveCardNamesWithScryfall(cleanNames, resolvedFormat, {
        skipMarketPrices: true,
      });
      res.json({ cards: Object.fromEntries(map.entries()) });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to resolve card names.';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/import-url', async (req, res) => {
    try {
      const { url } = req.body as { url?: string };
      if (!url || typeof url !== 'string') {
        res.status(400).json({ error: 'Please provide a deck URL.' });
        return;
      }
      const imported = await importDeckFromUrl(url);
      res.json(imported);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to import deck from URL.';
      res.status(400).json({ error: message });
    }
  });

  app.post('/api/parse', (req, res) => {
    try {
      const { deckText } = req.body as { deckText?: string };
      if (!deckText || typeof deckText !== 'string') {
        res.status(400).json({ error: 'Please paste a decklist.' });
        return;
      }
      const parsed = parseUniversalDecklist(deckText);
      res.json(parsed);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to parse decklist.';
      res.status(400).json({ error: message });
    }
  });

  app.post('/api/analyze', async (req, res) => {
    const wantsStream = req.body?.stream === true || req.query.stream === '1';
    const sendStreamEvent = (payload: Record<string, unknown>) => {
      if (!wantsStream || res.writableEnded) return;
      res.write(`${JSON.stringify(payload)}\n`);
    };

    try {
      const { deckText, deckName, format = 'auto', goal = 'bracket-3' } = req.body as {
        deckText?: string;
        deckName?: string;
        format?: DeckFormat;
        goal?: DeckGoal;
      };

      if (!deckText || typeof deckText !== 'string' || !deckText.trim()) {
        res.status(400).json({ error: 'Please provide a decklist to analyze.' });
        return;
      }

      const parsed = parseUniversalDecklist(deckText);
      if (parsed.cards.length === 0) {
        res.status(400).json({
          error:
            'No valid Magic cards were recognized in that input. Check that each line has a card name (e.g., "4 Lightning Bolt" or "1x Sol Ring").',
        });
        return;
      }

      if (wantsStream) {
        res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();
      }

      const resolvedFormat = detectFormat(parsed.cards, format);
      const cardNames = parsed.cards.map((c) => c.name);
      sendStreamEvent({
        type: 'progress',
        percent: 16,
        stage: 'Resolving cards & prices with Scryfall...',
        detail: `${cardNames.length} decklist entries (${resolvedFormat})`,
      });

      const resolvedMap = await resolveCardNamesWithScryfall(cardNames, resolvedFormat);
      sendStreamEvent({
        type: 'progress',
        percent: 38,
        stage: 'Calculating mana sources, pips & curve...',
      });

      const { resolvedCards, metrics } = computeDeckMetrics(parsed.cards, resolvedMap, resolvedFormat);

      const analysis = await analyzeDeckWithGemini({
        deckText,
        deckName: deckName?.trim() || parsed.deckName,
        sourceFormat: parsed.sourceFormat,
        goal,
        resolvedCards,
        metrics,
        onProgress: (percent, stage, detail) => {
          sendStreamEvent({ type: 'progress', percent, stage, detail });
        },
      });

      if (wantsStream) {
        sendStreamEvent({ type: 'progress', percent: 100, stage: 'Deck analysis complete.' });
        sendStreamEvent({ type: 'result', data: analysis });
        res.end();
      } else {
        res.json(analysis);
      }
    } catch (err) {
      if (wantsStream && res.headersSent) {
        const { message } = getGeminiErrorPayload(err, 'Deck analysis', 'Unexpected error analyzing deck.');
        sendStreamEvent({ type: 'error', error: message });
        res.end();
      } else {
        sendGeminiRouteError(res, err, 'Deck analysis', 'Unexpected error analyzing deck.');
      }
    }
  });

  app.post('/api/playtest', async (req, res) => {
    const wantsStream = req.body?.stream === true || req.query.stream === '1';
    const sendStreamEvent = (payload: Record<string, unknown>) => {
      if (!wantsStream || res.writableEnded) return;
      res.write(`${JSON.stringify(payload)}\n`);
    };

    try {
      const {
        deckName = 'Your Deck',
        format = 'commander',
        resolvedCards = [],
        overrideDeckText,
        testedListLabel = 'Uploaded Decklist',
        mode = '1v1',
        opponents = [],
        botMemoryProfiles = [],
        autoLearnFromMatches,
      } = req.body as {
        deckName?: string;
        format?: Exclude<DeckFormat, 'auto'>;
        resolvedCards?: ResolvedDeckCard[];
        overrideDeckText?: string;
        testedListLabel?: string;
        mode?: PlaytestMode;
        opponents?: BotOpponentConfig[];
        botMemoryProfiles?: import('./src/types/deck.ts').BotLearningProfile[];
        autoLearnFromMatches?: boolean;
      };

      if (resolvedCards.length === 0 && !overrideDeckText?.trim()) {
        res.status(400).json({ error: 'Analyze a deck first before running a bot match.' });
        return;
      }

      if (wantsStream) {
        res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();
      }

      const result = await runBotPlaytest({
        deckName,
        format,
        resolvedCards,
        overrideDeckText,
        testedListLabel,
        mode,
        opponents,
        botMemoryProfiles,
        autoLearnFromMatches,
        onProgress: (percent, stage, detail) => {
          sendStreamEvent({ type: 'progress', percent, stage, detail });
        },
      });

      if (wantsStream) {
        sendStreamEvent({ type: 'progress', percent: 100, stage: 'Match simulation complete.' });
        sendStreamEvent({ type: 'result', data: result });
        res.end();
      } else {
        res.json(result);
      }
    } catch (err) {
      if (wantsStream && res.headersSent) {
        const { message } = getGeminiErrorPayload(err, 'Playtest simulation', 'Failed to run bot playtest.');
        sendStreamEvent({ type: 'error', error: message });
        res.end();
      } else {
        sendGeminiRouteError(res, err, 'Playtest simulation', 'Failed to run bot playtest.');
      }
    }
  });

  app.post('/api/live-bot/plan', async (req, res) => {
    try {
      const body = req.body as Partial<LiveBotPlanRequest> | undefined;
      if (!body || !Array.isArray(body.opponents) || !body.playerDeck) {
        res.status(400).json({ error: 'opponents and playerDeck are required.' });
        return;
      }
      const result = await planLiveBotMatch({
        format: typeof body.format === 'string' ? body.format : 'commander',
        mode: body.mode === '1v1' || body.mode === '1v2' || body.mode === '1v3' ? body.mode : '1v3',
        playerDeck: body.playerDeck,
        opponents: body.opponents,
        botMemoryProfiles: Array.isArray(body.botMemoryProfiles) ? body.botMemoryProfiles : [],
      });
      res.json(result);
    } catch (err) {
      console.warn('[LiveBotAi] /api/live-bot/plan error:', err);
      res.json({
        engineUsed: 'deterministic',
        modelLabel: 'Deterministic MTG Rules',
        directivesByBot: {},
      });
    }
  });

  app.post('/api/live-bot/turn', async (req, res) => {
    try {
      const body = req.body as Partial<LiveBotTurnRequest> | undefined;
      if (!body || !body.activeBot || !body.playerBoard) {
        res.status(400).json({ error: 'activeBot and playerBoard are required.' });
        return;
      }
      const decision = await decideLiveBotTurn({
        turnNumber: typeof body.turnNumber === 'number' ? body.turnNumber : 1,
        format: typeof body.format === 'string' ? body.format : 'commander',
        mode: body.mode === '1v1' || body.mode === '1v2' || body.mode === '1v3' ? body.mode : '1v3',
        activeBot: body.activeBot,
        playerBoard: body.playerBoard,
        rivalBots: Array.isArray(body.rivalBots) ? body.rivalBots : [],
      });
      res.json(decision);
    } catch (err) {
      console.warn('[LiveBotAi] /api/live-bot/turn error:', err);
      res.json({
        engineUsed: 'deterministic',
        modelLabel: 'Deterministic MTG Rules',
        fallback: true,
      });
    }
  });

  app.post('/api/live-bot/learn', async (req, res) => {
    try {
      const body = req.body as Partial<LiveBotLearnRequest> | undefined;
      if (!body || !Array.isArray(body.bots)) {
        res.status(400).json({ error: 'bots array is required.' });
        return;
      }
      const result = await synthesizeLiveBotLearnings({
        format: typeof body.format === 'string' ? body.format : 'commander',
        mode: body.mode === '1v1' || body.mode === '1v2' || body.mode === '1v3' ? body.mode : '1v3',
        outcome:
          body.outcome === 'victory' || body.outcome === 'defeat' || body.outcome === 'unfinished'
            ? body.outcome
            : 'unfinished',
        turnsPlayed: typeof body.turnsPlayed === 'number' ? body.turnsPlayed : 1,
        endingPlayerLife: typeof body.endingPlayerLife === 'number' ? body.endingPlayerLife : 40,
        playerDeckLabel: typeof body.playerDeckLabel === 'string' ? body.playerDeckLabel : 'Your Deck',
        playerArchetype: typeof body.playerArchetype === 'string' ? body.playerArchetype : 'Midrange',
        playerCommanders: Array.isArray(body.playerCommanders) ? body.playerCommanders : [],
        bots: body.bots,
        opponents: Array.isArray(body.opponents) ? body.opponents : [],
      });
      res.json(result);
    } catch (err) {
      console.warn('[LiveBotAi] /api/live-bot/learn error:', err);
      res.json({
        engineUsed: 'deterministic',
        modelLabel: 'Deterministic MTG Rules',
        autoLearnEnabled: true,
        trainingRecorded: false,
        botLearnings: [],
      });
    }
  });

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const appUrl = process.env.APP_URL ? new URL(process.env.APP_URL) : null;
    const clientPort =
      appUrl?.protocol === 'https:'
        ? 443
        : appUrl?.port
        ? Number(appUrl.port)
        : undefined;

    const disableHmr = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        ...(disableHmr
          ? {
              ws: false,
              hmr: false,
              watch: null,
            }
          : {
              ws: {
                server: httpServer,
                clientPort,
              },
              hmr: {
                server: httpServer,
                clientPort,
              },
            }),
      },
      appType: 'spa',
    });
    if (disableHmr) {
      app.get('/@vite/client', async (_req, res, next) => {
        try {
          const result = await vite.transformRequest('/@vite/client');
          if (!result) return next();

          const noopTransport =
            'normalizeModuleRunnerTransport({ connect() {}, disconnect() {}, send() {} })';
          const sanitizedCode = result.code.replace(
            /const transport = normalizeModuleRunnerTransport\(\(\(\) => \{[\s\S]*?\}\)\(\)\);/,
            `const transport = ${noopTransport};`
          );

          res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache');
          res.send(sanitizedCode);
        } catch (err) {
          next(err);
        }
      });
    }

    app.use(vite.middlewares);
  } else {
    const distCandidates = [
      process.env.UMBRAS_DIST_DIR,
      path.join(__dirname, '..', 'dist'),
      path.join(__dirname, 'dist'),
      path.join(process.cwd(), 'dist'),
    ].filter((p): p is string => Boolean(p));
    const distPath =
      distCandidates.find((candidate) => fs.existsSync(path.join(candidate, 'index.html'))) ||
      path.join(__dirname, '..', 'dist');
    const assetsDir = path.join(distPath, 'assets');
    if (fs.existsSync(assetsDir)) {
      app.use(
        '/assets',
        express.static(assetsDir, {
          maxAge: '7d',
          immutable: true,
        })
      );
    }
    app.use(
      express.static(distPath, {
        index: false,
        maxAge: '1h',
      })
    );
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  httpServer.listen(port, host, () => {
    console.log(`Umbras Pass server running on http://${host}:${port}`);
  });

  const shutdown = async () => {
    await disposeCachedRuntime();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
