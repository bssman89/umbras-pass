import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
  getBotTrainingFilePath,
  getBundledModelsDirectory,
  getModelsDirectory,
  isDesktopEnvironment,
  loadBotTrainingData,
  loadDesktopAiConfig,
  saveDesktopAiConfig,
  type AiEngineMode,
  type ComputeMode,
  type DesktopAiConfig,
  type InstalledModelRecord,
} from './desktopStorage.ts';

export interface RecommendedHuggingFaceModel {
  id: string;
  label: string;
  shortName: string;
  repo: string;
  defaultFileName: string;
  quant: string;
  estimatedGb: number;
  recommendedRamGb: number;
  tierLabel: string;
  description: string;
  recommended?: boolean;
}

export const RECOMMENDED_HF_MODELS: RecommendedHuggingFaceModel[] = [
  {
    id: 'qwen3.8-27b-q4',
    label: 'Qwen3.8-27B (Workstation Flagship)',
    shortName: 'Qwen3.8-27B',
    repo: 'unsloth/Qwen3.8-27B-GGUF',
    defaultFileName: 'Qwen3.8-27B-UD-Q4_K_M.gguf',
    quant: 'UD-Q4_K_M',
    estimatedGb: 16.6,
    recommendedRamGb: 24,
    tierLabel: '24 GB+ RAM / VRAM',
    description:
      'Deepest paper-format reasoning for nuanced deck critiques, synergy identification, and multiplayer Commander playtests.',
    recommended: true,
  },
  {
    id: 'qwen3-8b-q4',
    label: 'Qwen3-8B (Balanced Desktop)',
    shortName: 'Qwen3-8B',
    repo: 'unsloth/Qwen3-8B-GGUF',
    defaultFileName: 'Qwen3-8B-Q4_K_M.gguf',
    quant: 'Q4_K_M',
    estimatedGb: 5.0,
    recommendedRamGb: 16,
    tierLabel: '16 GB RAM / 8 GB VRAM',
    description:
      'Balanced speed and tactical card evaluation tailored for standard desktop gaming PCs.',
  },
  {
    id: 'qwen3-4b-q4',
    label: 'Qwen3-4B (Compact Laptop)',
    shortName: 'Qwen3-4B',
    repo: 'unsloth/Qwen3-4B-GGUF',
    defaultFileName: 'Qwen3-4B-Q4_K_M.gguf',
    quant: 'Q4_K_M',
    estimatedGb: 2.5,
    recommendedRamGb: 8,
    tierLabel: '8 GB RAM',
    description:
      'Compact local GGUF model that runs comfortably on everyday laptops and portable drives.',
  },
  {
    id: 'qwen3-1.7b-q4',
    label: 'Qwen3-1.7B (Ultra-Light PC / 4-8 GB RAM)',
    shortName: 'Qwen3-1.7B',
    repo: 'unsloth/Qwen3-1.7B-GGUF',
    defaultFileName: 'Qwen3-1.7B-Q4_K_M.gguf',
    quant: 'Q4_K_M',
    estimatedGb: 1.1,
    recommendedRamGb: 4,
    tierLabel: '4–8 GB RAM',
    description:
      'Lightweight GGUF model built for older PCs, dual/quad-core laptops, and tight memory budgets.',
  },
];

export interface ActiveDownloadState {
  modelId: string;
  fileName: string;
  downloadedBytes: number;
  totalBytes: number;
  speedBytesPerSec: number;
  progressPct: number;
  status: 'idle' | 'downloading' | 'completed' | 'cancelled' | 'error';
  error?: string;
}

let activeDownloadState: ActiveDownloadState = {
  modelId: '',
  fileName: '',
  downloadedBytes: 0,
  totalBytes: 0,
  speedBytesPerSec: 0,
  progressPct: 0,
  status: 'idle',
};

let downloadAbortController: AbortController | null = null;

interface LoadedGgufRuntime {
  modelPath: string;
  modelId: string;
  isCpuOnly: boolean;
  requestedIsCpuOnly: boolean;
  llama: {
    cpuMathCores?: number;
    getGrammarFor: (type: 'json') => Promise<unknown>;
    createGrammarForJsonSchema?: (schema: Record<string, unknown>) => Promise<unknown>;
  };
  model: {
    dispose: () => Promise<void>;
    trainContextSize?: number;
  };
  context: {
    dispose: () => Promise<void>;
    getSequence: () => unknown;
    contextSize: number;
  };
  schemaGrammarCache: Map<string, unknown>;
  LlamaChatSession: new (opts: {
    contextSequence: unknown;
    systemPrompt?: string;
  }) => {
    prompt: (
      text: string,
      opts?: {
        grammar?: unknown;
        maxTokens?: number;
        temperature?: number;
        topK?: number;
        topP?: number;
        trimWhitespaceSuffix?: boolean;
        signal?: AbortSignal;
        stopOnAbortSignal?: boolean;
        budgets?: {
          thoughtTokens?: number;
          commentTokens?: number;
        };
        onTextChunk?: (text: string) => void;
      }
    ) => Promise<string>;
  };
}

let cachedRuntime: LoadedGgufRuntime | null = null;
let runtimeLoadingPromise: Promise<LoadedGgufRuntime> | null = null;
let inferenceQueue: Promise<void> = Promise.resolve();
let idleUnloadTimer: ReturnType<typeof setTimeout> | null = null;

function getIdleUnloadTimeoutMs(): number {
  const totalRamGb = Math.max(1, Math.round(os.totalmem() / 1024 ** 3));
  return totalRamGb <= 8 ? 4 * 60 * 1000 : 6 * 60 * 1000;
}

export function getSystemHardwareInfo() {
  const totalRamGb = Math.max(1, Math.round(os.totalmem() / 1024 ** 3));
  const freeRamGb = Math.max(0, Number((os.freemem() / 1024 ** 3).toFixed(1)));
  const recommendedModelId =
    totalRamGb >= 22
      ? 'qwen3.8-27b-q4'
      : totalRamGb >= 12
      ? 'qwen3-8b-q4'
      : totalRamGb >= 7
      ? 'qwen3-4b-q4'
      : 'qwen3-1.7b-q4';

  return {
    totalRamGb,
    freeRamGb,
    cpuCount: os.cpus().length,
    platform: process.platform,
    recommendedModelId,
  };
}

export function computeAdaptiveRuntimeProfile(params: {
  totalRamGb: number;
  freeRamGb: number;
  logicalCores: number;
  mathCores?: number;
  configuredThreads: number;
  isCpuOnly: boolean;
  trainContextSize?: number;
}): {
  threads: number;
  contextSize: number;
  batchSize: number;
} {
  const logicalCores = Math.max(2, Math.round(params.logicalCores || 2));
  const mathCores =
    typeof params.mathCores === 'number' && params.mathCores > 0
      ? Math.round(params.mathCores)
      : Math.max(2, Math.floor(logicalCores / 2));

  // Leave 1 logical core available on mainstream PCs so CPU inference does not freeze Windows/desktop responsiveness.
  const autoThreads =
    logicalCores >= 3
      ? Math.max(2, Math.min(8, mathCores, logicalCores - 1))
      : logicalCores;
  const threads =
    params.configuredThreads > 0
      ? Math.max(1, Math.min(logicalCores, Math.round(params.configuredThreads)))
      : autoThreads;

  const isLowMemory = params.totalRamGb <= 8 || params.freeRamGb < 3.5;
  const isMidMemory = !isLowMemory && (params.totalRamGb < 16 || params.freeRamGb < 6);

  const maxContextCap = isLowMemory
    ? 2560
    : isMidMemory
    ? params.isCpuOnly
      ? 3584
      : 4096
    : params.isCpuOnly
    ? 4096
    : 6144;

  const contextSize = Math.min(maxContextCap, params.trainContextSize || maxContextCap);
  const batchSize = isLowMemory ? 192 : isMidMemory ? 256 : params.isCpuOnly ? 384 : 512;

  return { threads, contextSize, batchSize };
}

function matchCatalogIdFromFilename(fileName: string): string | null {
  const lower = fileName.toLowerCase();
  if (lower.includes('qwen3.8-27b') || lower.includes('qwen3.8_27b')) return 'qwen3.8-27b-q4';
  if (lower.includes('qwen3-8b') || lower.includes('qwen3_8b')) return 'qwen3-8b-q4';
  if (lower.includes('qwen3-4b') || lower.includes('qwen3_4b')) return 'qwen3-4b-q4';
  if (lower.includes('qwen3-1.7b') || lower.includes('qwen3_1.7b')) return 'qwen3-1.7b-q4';
  return null;
}

function scanDirectoryForGguf(dir: string | null, sourceLabel: string): Record<string, InstalledModelRecord> {
  if (!dir || !fs.existsSync(dir)) return {};
  const found: Record<string, InstalledModelRecord> = {};
  try {
    const entries = fs.readdirSync(dir);
    for (const fileName of entries) {
      if (!fileName.toLowerCase().endsWith('.gguf')) continue;
      const filePath = path.join(dir, fileName);
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;

      const matchedId = matchCatalogIdFromFilename(fileName) || `local-${fileName}`;
      const catalogItem = RECOMMENDED_HF_MODELS.find((m) => m.id === matchedId);
      found[matchedId] = {
        id: matchedId,
        label: catalogItem ? catalogItem.label : fileName.replace(/\.gguf$/i, ''),
        repo: catalogItem ? catalogItem.repo : sourceLabel,
        fileName,
        filePath,
        sizeBytes: stat.size,
        downloadedAt: stat.mtime.toISOString(),
      };
    }
  } catch {
    // Ignore unreadable folder
  }
  return found;
}

function getMergedInstalledModels(config: DesktopAiConfig): {
  bundledDir: string | null;
  bundledKeys: Set<string>;
  merged: Record<string, InstalledModelRecord>;
} {
  const bundledDir = getBundledModelsDirectory();
  const bundled = scanDirectoryForGguf(bundledDir, 'Side-by-side models folder');
  const userModelsDir = getModelsDirectory();
  const userDropped = scanDirectoryForGguf(userModelsDir, 'Local models folder');
  const bundledKeys = new Set(Object.keys(bundled));
  return {
    bundledDir,
    bundledKeys,
    merged: {
      ...userDropped,
      ...bundled,
      ...config.installedModels,
    },
  };
}

export function getActiveGgufPath(config: DesktopAiConfig): {
  modelId: string | null;
  filePath: string | null;
  isBundled: boolean;
} {
  const { bundledKeys, merged } = getMergedInstalledModels(config);

  if (config.selectedModelId === 'custom-file' && config.customModelPath) {
    if (fs.existsSync(config.customModelPath)) {
      return { modelId: 'custom-file', filePath: config.customModelPath, isBundled: false };
    }
  }
  if (config.selectedModelId && merged[config.selectedModelId]) {
    const rec = merged[config.selectedModelId];
    if (fs.existsSync(rec.filePath)) {
      return {
        modelId: config.selectedModelId,
        filePath: rec.filePath,
        isBundled: bundledKeys.has(config.selectedModelId) && !config.installedModels[config.selectedModelId],
      };
    }
  }
  // Auto-select side-by-side bundled model first (e.g. Qwen3-4B in models/), then any installed model
  const bundledFirst = Object.values(merged).find(
    (rec) => bundledKeys.has(rec.id) && fs.existsSync(rec.filePath)
  );
  if (bundledFirst) {
    return { modelId: bundledFirst.id, filePath: bundledFirst.filePath, isBundled: true };
  }
  const firstInstalled = Object.values(merged).find((rec) => fs.existsSync(rec.filePath));
  if (firstInstalled) {
    return { modelId: firstInstalled.id, filePath: firstInstalled.filePath, isBundled: false };
  }
  return { modelId: null, filePath: null, isBundled: false };
}

export function getDesktopAiStatus() {
  const config = loadDesktopAiConfig();
  const hardware = getSystemHardwareInfo();
  const geminiConfigured = Boolean(process.env.GEMINI_API_KEY?.trim());
  const modelsDir = getModelsDirectory();
  const { bundledDir, bundledKeys, merged } = getMergedInstalledModels(config);

  const catalog = RECOMMENDED_HF_MODELS.map((item) => {
    const installed = merged[item.id];
    const isInstalled = Boolean(installed && fs.existsSync(installed.filePath));
    const isBundled = Boolean(
      isInstalled && bundledKeys.has(item.id) && !config.installedModels[item.id]
    );
    return {
      ...item,
      isInstalled,
      isBundled,
      installedSizeBytes: isInstalled ? installed.sizeBytes : 0,
      installedPath: isInstalled ? installed.filePath : null,
      fitsHardware: hardware.totalRamGb >= item.recommendedRamGb - 2,
    };
  });

  const activePathInfo = getActiveGgufPath(config);
  const trainingData = loadBotTrainingData();
  const effectiveEngine: AiEngineMode = shouldUseLocalGguf()
    ? 'local-gguf'
    : shouldUseCloudGemini()
    ? 'cloud-gemini'
    : 'deterministic';
  const activeModelLabel =
    effectiveEngine === 'local-gguf'
      ? getActiveLocalModelLabel() || 'Local GGUF Model'
      : effectiveEngine === 'cloud-gemini'
      ? 'Cloud Gemini AI'
      : 'Deterministic MTG Rules';

  return {
    isDesktop: isDesktopEnvironment(),
    geminiConfigured,
    modelsDir,
    bundledModelsDir: bundledDir,
    botTrainingPath: getBotTrainingFilePath(),
    botTrainingMoveCount: trainingData.totalMovesRecorded,
    hardware,
    activeEngine: config.activeEngine,
    effectiveEngine,
    activeModelLabel,
    computeMode: config.computeMode,
    cpuThreads: config.cpuThreads,
    autoLearnFromMatches: config.autoLearnFromMatches !== false,
    selectedModelId: config.selectedModelId || activePathInfo.modelId,
    customModelPath: config.customModelPath,
    activeModelPath: activePathInfo.filePath,
    activeModelIsBundled: activePathInfo.isBundled,
    loadedModelId: cachedRuntime?.modelId || null,
    catalog,
    installedModels: merged,
    activeDownload: activeDownloadState,
  };
}

export function isAutoLearnFromMatchesEnabled(): boolean {
  const config = loadDesktopAiConfig();
  return config.autoLearnFromMatches !== false;
}

export function shouldUseLocalGguf(): boolean {
  const config = loadDesktopAiConfig();
  const activeGguf = getActiveGgufPath(config);
  if (!activeGguf.filePath) return false;
  if (config.activeEngine === 'deterministic' || config.activeEngine === 'cloud-gemini') {
    return false;
  }
  return true;
}

export function shouldUseCloudGemini(): boolean {
  const config = loadDesktopAiConfig();
  return config.activeEngine === 'cloud-gemini' && Boolean(process.env.GEMINI_API_KEY?.trim());
}

export function isLocalGgufForced(): boolean {
  const config = loadDesktopAiConfig();
  return config.activeEngine === 'local-gguf' || !shouldUseCloudGemini();
}

export function getActiveLocalModelInfo(): {
  modelId: string | null;
  filePath: string | null;
  isCpuOnly: boolean;
  tier: '1.7b' | '4b' | '8b' | '27b' | 'custom';
} {
  const config = loadDesktopAiConfig();
  const active = getActiveGgufPath(config);
  const idLower = `${active.modelId || ''} ${active.filePath || ''}`.toLowerCase();
  const tier: '1.7b' | '4b' | '8b' | '27b' | 'custom' =
    idLower.includes('27b')
      ? '27b'
      : idLower.includes('8b')
      ? '8b'
      : idLower.includes('4b')
      ? '4b'
      : idLower.includes('1.7b')
      ? '1.7b'
      : 'custom';
  return {
    modelId: active.modelId,
    filePath: active.filePath,
    isCpuOnly: cachedRuntime ? cachedRuntime.isCpuOnly : config.computeMode !== 'auto',
    tier,
  };
}

export function shouldUseDeterministicOnly(): boolean {
  const config = loadDesktopAiConfig();
  if (config.activeEngine === 'deterministic') return true;
  if (shouldUseLocalGguf()) return false;
  return !shouldUseCloudGemini();
}

export async function selectDesktopAiEngine(params: {
  activeEngine?: AiEngineMode;
  selectedModelId?: string | null;
  customModelPath?: string | null;
  computeMode?: ComputeMode;
  cpuThreads?: number;
  autoLearnFromMatches?: boolean;
}) {
  const config = loadDesktopAiConfig();
  let needsRuntimeReload = false;

  if (params.customModelPath !== undefined) {
    const cleanPath = params.customModelPath?.trim() || null;
    if (cleanPath && !fs.existsSync(cleanPath)) {
      throw new Error(`GGUF model file not found at: ${cleanPath}`);
    }
    config.customModelPath = cleanPath;
    if (cleanPath) {
      config.selectedModelId = 'custom-file';
    }
    needsRuntimeReload = true;
  }

  if (params.selectedModelId !== undefined) {
    config.selectedModelId = params.selectedModelId;
    needsRuntimeReload = true;
  }

  if (params.activeEngine) {
    config.activeEngine = params.activeEngine;
  }

  if (params.computeMode && params.computeMode !== config.computeMode) {
    config.computeMode = params.computeMode;
    needsRuntimeReload = true;
  }

  if (typeof params.cpuThreads === 'number' && params.cpuThreads >= 0 && params.cpuThreads !== config.cpuThreads) {
    config.cpuThreads = Math.round(params.cpuThreads);
    needsRuntimeReload = true;
  }

  if (typeof params.autoLearnFromMatches === 'boolean') {
    config.autoLearnFromMatches = params.autoLearnFromMatches;
  }

  saveDesktopAiConfig(config);

  const nextPath = getActiveGgufPath(config).filePath;
  if (
    cachedRuntime &&
    (needsRuntimeReload ||
      !nextPath ||
      cachedRuntime.modelPath !== nextPath ||
      config.activeEngine === 'deterministic')
  ) {
    await disposeCachedRuntime();
  }

  return getDesktopAiStatus();
}

export async function deleteInstalledModel(modelId: string) {
  const config = loadDesktopAiConfig();
  const rec = config.installedModels[modelId];
  if (rec) {
    if (cachedRuntime?.modelId === modelId) {
      await disposeCachedRuntime();
    }
    if (fs.existsSync(rec.filePath)) {
      try {
        fs.unlinkSync(rec.filePath);
      } catch (err) {
        console.warn('[LocalAI] Failed to delete model file:', err);
      }
    }
    delete config.installedModels[modelId];
    if (config.selectedModelId === modelId) {
      config.selectedModelId = null;
      if (config.activeEngine === 'local-gguf') {
        config.activeEngine = 'auto';
      }
    }
    saveDesktopAiConfig(config);
  }
  return getDesktopAiStatus();
}

export function cancelActiveDownload() {
  if (downloadAbortController) {
    downloadAbortController.abort();
    downloadAbortController = null;
  }
  if (activeDownloadState.status === 'downloading') {
    activeDownloadState = {
      ...activeDownloadState,
      status: 'cancelled',
      speedBytesPerSec: 0,
    };
  }
  return activeDownloadState;
}

async function resolveHuggingFaceFile(
  repo: string,
  preferredFileName: string
): Promise<{ fileName: string; downloadUrl: string; sizeBytes: number }> {
  try {
    const treeRes = await fetch(`https://huggingface.co/api/models/${repo}/tree/main`, {
      headers: { Accept: 'application/json', 'User-Agent': 'UmbrasPass-Desktop/1.0' },
    });
    if (treeRes.ok) {
      const files = (await treeRes.json()) as Array<{
        type?: string;
        path?: string;
        size?: number;
      }>;
      const ggufFiles = files.filter(
        (f) => f.type === 'file' && typeof f.path === 'string' && f.path.toLowerCase().endsWith('.gguf')
      );
      const exactMatch = ggufFiles.find(
        (f) => f.path?.toLowerCase() === preferredFileName.toLowerCase()
      );
      const udQ4Match = ggufFiles.find((f) => /ud-q4_k_m\.gguf$/i.test(f.path || ''));
      const q4Match = ggufFiles.find((f) => /q4_k_m\.gguf$/i.test(f.path || ''));
      const chosen = exactMatch || udQ4Match || q4Match || ggufFiles[0];
      if (chosen?.path) {
        return {
          fileName: path.basename(chosen.path),
          downloadUrl: `https://huggingface.co/${repo}/resolve/main/${chosen.path}?download=true`,
          sizeBytes: chosen.size || 0,
        };
      }
    }
  } catch (err) {
    console.warn('[LocalAI] HF tree lookup failed, using default filename:', err);
  }

  return {
    fileName: preferredFileName,
    downloadUrl: `https://huggingface.co/${repo}/resolve/main/${preferredFileName}?download=true`,
    sizeBytes: 0,
  };
}

export async function startHuggingFaceDownload(modelId: string): Promise<ActiveDownloadState> {
  const catalogItem = RECOMMENDED_HF_MODELS.find((m) => m.id === modelId);
  if (!catalogItem) {
    throw new Error(`Unknown model preset: ${modelId}`);
  }

  if (activeDownloadState.status === 'downloading') {
    throw new Error(`Already downloading ${activeDownloadState.fileName}. Cancel it first.`);
  }

  const resolved = await resolveHuggingFaceFile(catalogItem.repo, catalogItem.defaultFileName);
  const modelsDir = getModelsDirectory();
  const finalPath = path.join(modelsDir, resolved.fileName);
  const partialPath = `${finalPath}.partial`;

  if (fs.existsSync(finalPath)) {
    const stat = fs.statSync(finalPath);
    const config = loadDesktopAiConfig();
    config.installedModels[catalogItem.id] = {
      id: catalogItem.id,
      label: catalogItem.label,
      repo: catalogItem.repo,
      fileName: resolved.fileName,
      filePath: finalPath,
      sizeBytes: stat.size,
      downloadedAt: new Date().toISOString(),
    };
    config.selectedModelId = catalogItem.id;
    config.activeEngine = 'local-gguf';
    saveDesktopAiConfig(config);

    activeDownloadState = {
      modelId: catalogItem.id,
      fileName: resolved.fileName,
      downloadedBytes: stat.size,
      totalBytes: stat.size,
      speedBytesPerSec: 0,
      progressPct: 100,
      status: 'completed',
    };
    return activeDownloadState;
  }

  const controller = new AbortController();
  downloadAbortController = controller;

  activeDownloadState = {
    modelId: catalogItem.id,
    fileName: resolved.fileName,
    downloadedBytes: 0,
    totalBytes: resolved.sizeBytes || Math.round(catalogItem.estimatedGb * 1024 ** 3),
    speedBytesPerSec: 0,
    progressPct: 0,
    status: 'downloading',
  };

  void (async () => {
    let writeStream: fs.WriteStream | null = null;
    try {
      const response = await fetch(resolved.downloadUrl, {
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'User-Agent': 'UmbrasPass-Desktop/1.0' },
      });

      if (!response.ok || !response.body) {
        throw new Error(`Hugging Face returned HTTP ${response.status} ${response.statusText}`);
      }

      const contentLengthHeader = response.headers.get('content-length');
      const totalBytes =
        (contentLengthHeader ? Number(contentLengthHeader) : 0) ||
        resolved.sizeBytes ||
        Math.round(catalogItem.estimatedGb * 1024 ** 3);

      activeDownloadState.totalBytes = totalBytes;
      writeStream = fs.createWriteStream(partialPath);

      let downloadedBytes = 0;
      let lastTickTime = Date.now();
      let lastTickBytes = 0;

      const nodeStream = Readable.fromWeb(
        response.body as unknown as import('node:stream/web').ReadableStream<Uint8Array>
      );

      for await (const chunk of nodeStream) {
        if (controller.signal.aborted) {
          throw new Error('Download cancelled by user.');
        }
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (!writeStream.write(buf)) {
          await new Promise<void>((res) => writeStream?.once('drain', res));
        }
        downloadedBytes += buf.length;
        const now = Date.now();
        const elapsedSec = (now - lastTickTime) / 1000;
        let speed = activeDownloadState.speedBytesPerSec;
        if (elapsedSec >= 0.5) {
          speed = Math.round((downloadedBytes - lastTickBytes) / elapsedSec);
          lastTickTime = now;
          lastTickBytes = downloadedBytes;
        }
        const pct = totalBytes > 0 ? Math.min(99, Math.round((downloadedBytes / totalBytes) * 100)) : 0;
        activeDownloadState = {
          modelId: catalogItem.id,
          fileName: resolved.fileName,
          downloadedBytes,
          totalBytes,
          speedBytesPerSec: speed,
          progressPct: pct,
          status: 'downloading',
        };
      }

      await new Promise<void>((resolve, reject) => {
        if (!writeStream) return resolve();
        writeStream.end(() => resolve());
        writeStream.on('error', reject);
      });
      writeStream = null;

      fs.renameSync(partialPath, finalPath);
      const stat = fs.statSync(finalPath);

      const config = loadDesktopAiConfig();
      config.installedModels[catalogItem.id] = {
        id: catalogItem.id,
        label: catalogItem.label,
        repo: catalogItem.repo,
        fileName: resolved.fileName,
        filePath: finalPath,
        sizeBytes: stat.size,
        downloadedAt: new Date().toISOString(),
      };
      config.selectedModelId = catalogItem.id;
      config.activeEngine = 'local-gguf';
      saveDesktopAiConfig(config);

      activeDownloadState = {
        modelId: catalogItem.id,
        fileName: resolved.fileName,
        downloadedBytes: stat.size,
        totalBytes: stat.size,
        speedBytesPerSec: 0,
        progressPct: 100,
        status: 'completed',
      };
    } catch (err) {
      if (writeStream) {
        try {
          writeStream.destroy();
        } catch {
          // ignore
        }
      }
      if (fs.existsSync(partialPath)) {
        try {
          fs.unlinkSync(partialPath);
        } catch {
          // ignore
        }
      }
      const message = err instanceof Error ? err.message : String(err);
      const isCancelled = controller.signal.aborted || message.toLowerCase().includes('abort');
      activeDownloadState = {
        ...activeDownloadState,
        status: isCancelled ? 'cancelled' : 'error',
        speedBytesPerSec: 0,
        error: isCancelled ? undefined : message,
      };
    } finally {
      downloadAbortController = null;
    }
  })();

  return activeDownloadState;
}

function clearIdleUnloadTimer(): void {
  if (idleUnloadTimer) {
    clearTimeout(idleUnloadTimer);
    idleUnloadTimer = null;
  }
}

function scheduleIdleUnload(): void {
  clearIdleUnloadTimer();
  idleUnloadTimer = setTimeout(() => {
    void disposeCachedRuntime();
  }, getIdleUnloadTimeoutMs());
  if (typeof idleUnloadTimer.unref === 'function') {
    idleUnloadTimer.unref();
  }
}

export async function disposeCachedRuntime(): Promise<void> {
  clearIdleUnloadTimer();
  const runtime = cachedRuntime;
  cachedRuntime = null;
  if (!runtime) return;
  try {
    runtime.schemaGrammarCache.clear();
  } catch {
    // ignore
  }
  try {
    await runtime.context.dispose();
  } catch {
    // ignore
  }
  try {
    await runtime.model.dispose();
  } catch {
    // ignore
  }
}

async function getOrLoadRuntime(): Promise<LoadedGgufRuntime> {
  const config = loadDesktopAiConfig();
  const active = getActiveGgufPath(config);
  if (!active.filePath || !active.modelId) {
    throw new Error('No local GGUF model is currently installed or selected.');
  }

  const requestedIsCpuOnly = config.computeMode !== 'auto';
  if (
    cachedRuntime &&
    cachedRuntime.modelPath === active.filePath &&
    cachedRuntime.requestedIsCpuOnly === requestedIsCpuOnly
  ) {
    scheduleIdleUnload();
    return cachedRuntime;
  }

  if (runtimeLoadingPromise) {
    return runtimeLoadingPromise;
  }

  runtimeLoadingPromise = (async () => {
    await disposeCachedRuntime();
    const llamaModule = (await import('node-llama-cpp')) as unknown as {
      getLlama: (opts?: { gpu?: false | 'auto' }) => Promise<LoadedGgufRuntime['llama'] & {
        loadModel: (opts: {
          modelPath: string;
          defaultContextFlashAttention?: 'auto' | boolean;
        }) => Promise<
          LoadedGgufRuntime['model'] & {
            createContext: (opts?: {
              contextSize?: number;
              sequences?: number;
              threads?: number;
              batchSize?: number;
              flashAttention?: 'auto' | boolean;
            }) => Promise<LoadedGgufRuntime['context']>;
          }
        >;
      }>;
      LlamaChatSession: LoadedGgufRuntime['LlamaChatSession'];
    };

    const initializeWithMode = async (forceCpu: boolean): Promise<LoadedGgufRuntime> => {
      const llama = await llamaModule.getLlama(forceCpu ? { gpu: false } : undefined);
      let model:
        | (LoadedGgufRuntime['model'] & {
            createContext: (opts?: {
              contextSize?: number;
              sequences?: number;
              threads?: number;
              batchSize?: number;
              flashAttention?: 'auto' | boolean;
            }) => Promise<LoadedGgufRuntime['context']>;
          })
        | null = null;
      try {
        model = await llama.loadModel({
          modelPath: active.filePath!,
          defaultContextFlashAttention: 'auto',
        });

        const totalRamGb = Math.max(1, Math.round(os.totalmem() / 1024 ** 3));
        const freeRamGb = Math.max(0, Number((os.freemem() / 1024 ** 3).toFixed(1)));
        const profile = computeAdaptiveRuntimeProfile({
          totalRamGb,
          freeRamGb,
          logicalCores: os.cpus().length,
          mathCores: llama.cpuMathCores,
          configuredThreads: config.cpuThreads,
          isCpuOnly: forceCpu,
          trainContextSize: model.trainContextSize,
        });

        let context: LoadedGgufRuntime['context'];
        try {
          context = await model.createContext({
            contextSize: profile.contextSize,
            sequences: 1,
            threads: profile.threads,
            batchSize: profile.batchSize,
            flashAttention: 'auto',
          });
        } catch {
          context = await model.createContext({
            contextSize: Math.min(2048, model.trainContextSize || 2048),
            sequences: 1,
            threads: profile.threads,
            batchSize: 128,
          });
        }

        return {
          modelPath: active.filePath!,
          modelId: active.modelId!,
          isCpuOnly: forceCpu,
          requestedIsCpuOnly,
          llama,
          model,
          context,
          schemaGrammarCache: new Map<string, unknown>(),
          LlamaChatSession: llamaModule.LlamaChatSession,
        };
      } catch (err) {
        if (model) {
          try {
            await model.dispose();
          } catch {
            // ignore
          }
        }
        throw err;
      }
    };

    let runtime: LoadedGgufRuntime;
    try {
      runtime = await initializeWithMode(requestedIsCpuOnly);
    } catch (firstErr) {
      if (!requestedIsCpuOnly) {
        console.warn('[LocalAI] Auto GPU initialization failed, falling back to safe CPU mode:', firstErr);
        runtime = await initializeWithMode(true);
      } else {
        throw firstErr;
      }
    }

    cachedRuntime = runtime;
    scheduleIdleUnload();
    return runtime;
  })();

  try {
    return await runtimeLoadingPromise;
  } finally {
    runtimeLoadingPromise = null;
  }
}

function extractJsonObjectFromText(rawText: string | undefined | null): string {
  const safe = typeof rawText === 'string' ? rawText : '';
  const withoutThinking = safe
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```json\s*/gi, '')
    .replace(/```/g, '')
    .trim();
  const firstBrace = withoutThinking.indexOf('{');
  const lastBrace = withoutThinking.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return withoutThinking.slice(firstBrace, lastBrace + 1);
  }
  return withoutThinking;
}

export function getActiveLocalModelLabel(): string | null {
  const config = loadDesktopAiConfig();
  const active = getActiveGgufPath(config);
  if (!active.modelId && !active.filePath) return null;
  const catalog = active.modelId
    ? RECOMMENDED_HF_MODELS.find((m) => m.id === active.modelId)
    : undefined;
  const modeSuffix = config.computeMode === 'auto' ? 'Auto GPU/CPU' : 'CPU';
  if (catalog) return `${catalog.shortName} (${modeSuffix})`;
  if (active.modelId === 'custom-file' && active.filePath) {
    const customName = path.basename(active.filePath).replace(/\.gguf$/i, '').trim().slice(0, 40);
    return `${customName || 'Custom GGUF'} (${modeSuffix})`;
  }
  const rec = active.modelId ? config.installedModels?.[active.modelId] : undefined;
  if (rec?.label) return `${rec.label} (${modeSuffix})`;
  if (active.filePath) {
    const fileLabel = path.basename(active.filePath).replace(/\.gguf$/i, '').trim().slice(0, 40);
    return `${fileLabel || 'Local GGUF'} (${modeSuffix})`;
  }
  return `Local GGUF (${modeSuffix})`;
}

async function withSerializedInference<T>(task: () => Promise<T>): Promise<T> {
  const run = inferenceQueue.then(task, task);
  inferenceQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export function isLocalGgufRuntimeLoaded(): boolean {
  return Boolean(cachedRuntime);
}

export async function generateJsonWithLocalGguf<T>(params: {
  systemInstruction: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  jsonSchema?: Record<string, unknown>;
  schemaCacheKey?: string;
  disableThinking?: boolean;
  timeoutMs?: number;
  onProgress?: (info: {
    phase: 'loading' | 'generating';
    charsGenerated: number;
    estimatedMaxChars: number;
  }) => void;
}): Promise<T> {
  return withSerializedInference(async () => {
    const activeConfig = loadDesktopAiConfig();
    const activeInfo = getActiveGgufPath(activeConfig);
    const needsLoad =
      !cachedRuntime ||
      !activeInfo.filePath ||
      cachedRuntime.modelPath !== activeInfo.filePath ||
      cachedRuntime.requestedIsCpuOnly !== (activeConfig.computeMode !== 'auto');

    clearIdleUnloadTimer();
    if (needsLoad || runtimeLoadingPromise) {
      params.onProgress?.({
        phase: 'loading',
        charsGenerated: 0,
        estimatedMaxChars: (params.maxTokens ?? 1600) * 3.5,
      });
    }
    const runtime = await getOrLoadRuntime();
    const sequence = runtime.context.getSequence() as { dispose?: () => void };

    const abortController = params.timeoutMs ? new AbortController() : null;
    const timeoutTimer =
      abortController && params.timeoutMs
        ? setTimeout(() => abortController.abort(new Error('Local GGUF generation timed out.')), params.timeoutMs)
        : null;

    try {
      let grammar: unknown;
      if (params.jsonSchema && typeof runtime.llama.createGrammarForJsonSchema === 'function') {
        const cacheKey = params.schemaCacheKey || JSON.stringify(params.jsonSchema);
        const cached = runtime.schemaGrammarCache.get(cacheKey);
        if (cached) {
          grammar = cached;
        } else {
          try {
            grammar = await runtime.llama.createGrammarForJsonSchema(params.jsonSchema);
            runtime.schemaGrammarCache.set(cacheKey, grammar);
          } catch {
            grammar = await runtime.llama.getGrammarFor('json');
          }
        }
      } else {
        grammar = await runtime.llama.getGrammarFor('json');
      }

      const session = new runtime.LlamaChatSession({
        contextSequence: sequence,
        systemPrompt: params.systemInstruction,
      });

      const maxTokens = Math.min(
        params.maxTokens ?? 1600,
        Math.max(512, runtime.context.contextSize - 512)
      );
      const estimatedMaxChars = Math.max(600, maxTokens * 3);
      let charsGenerated = 0;
      let lastEmitAt = 0;

      params.onProgress?.({
        phase: 'generating',
        charsGenerated: 0,
        estimatedMaxChars,
      });

      const rawResponse = await session.prompt(params.prompt, {
        grammar,
        maxTokens,
        temperature: params.temperature ?? 0.25,
        topK: 40,
        topP: 0.9,
        trimWhitespaceSuffix: true,
        signal: abortController?.signal,
        stopOnAbortSignal: false,
        budgets:
          params.disableThinking !== false
            ? { thoughtTokens: 0, commentTokens: 0 }
            : undefined,
        onTextChunk: (chunk: string) => {
          charsGenerated += chunk.length;
          const now = Date.now();
          if (now - lastEmitAt >= 200) {
            lastEmitAt = now;
            params.onProgress?.({
              phase: 'generating',
              charsGenerated,
              estimatedMaxChars,
            });
          }
        },
      });

      const jsonText = extractJsonObjectFromText(rawResponse);
      return JSON.parse(jsonText) as T;
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (typeof sequence?.dispose === 'function') {
        try {
          sequence.dispose();
        } catch {
          // ignore
        }
      }
      scheduleIdleUnload();
    }
  });
}
