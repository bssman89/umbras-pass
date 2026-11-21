import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BotLearningProfile, DeckVersionSnapshot } from '../src/types/deck.ts';

const __desktopStorageFilename = fileURLToPath(import.meta.url);
const __desktopStorageDirname = path.dirname(__desktopStorageFilename);

export type AiEngineMode = 'auto' | 'local-gguf' | 'deterministic' | 'cloud-gemini';
export type ComputeMode = 'cpu' | 'auto';

export interface InstalledModelRecord {
  id: string;
  label: string;
  repo: string;
  fileName: string;
  filePath: string;
  sizeBytes: number;
  downloadedAt: string;
}

export interface DesktopAiConfig {
  activeEngine: AiEngineMode;
  selectedModelId: string | null;
  customModelPath: string | null;
  computeMode: ComputeMode;
  cpuThreads: number;
  autoLearnFromMatches: boolean;
  installedModels: Record<string, InstalledModelRecord>;
}

export interface DesktopPersistentWorkspace {
  snapshots: DeckVersionSnapshot[];
  botMemory: Record<string, BotLearningProfile>;
  updatedAt: string;
}

export function isDesktopEnvironment(): boolean {
  return process.env.UMBRAS_DESKTOP === '1' || Boolean(process.env.UMBRAS_USER_DATA_DIR);
}

export function getDesktopDataDir(): string {
  if (process.env.UMBRAS_USER_DATA_DIR && process.env.UMBRAS_USER_DATA_DIR.trim()) {
    return process.env.UMBRAS_USER_DATA_DIR.trim();
  }
  if (process.env.UMBRAS_DESKTOP === '1') {
    return path.join(os.homedir(), '.umbras-pass');
  }
  return path.join(os.tmpdir(), 'umbras-pass-desktop');
}

export function getModelsDirectory(): string {
  const dir = path.join(getDesktopDataDir(), 'models');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getBundledModelsDirectory(): string | null {
  const candidates = [
    process.env.UMBRAS_BUNDLED_MODELS_DIR?.trim(),
    path.join(process.cwd(), 'models'),
    path.resolve(__desktopStorageDirname, '..', 'models'),
  ].filter((d): d is string => Boolean(d));

  for (const dir of candidates) {
    if (fs.existsSync(dir)) {
      return dir;
    }
  }
  return null;
}

function getConfigFilePath(): string {
  const dir = getDesktopDataDir();
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'desktop-config.json');
}

function getWorkspaceFilePath(): string {
  const dir = getDesktopDataDir();
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'decks-and-bots.json');
}

function getScryfallCacheFilePath(): string {
  const dir = getDesktopDataDir();
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'scryfall-cache.json');
}

const DEFAULT_CONFIG: DesktopAiConfig = {
  activeEngine: 'auto',
  selectedModelId: null,
  customModelPath: null,
  computeMode: 'cpu',
  cpuThreads: 0,
  autoLearnFromMatches: true,
  installedModels: {},
};

export function loadDesktopAiConfig(): DesktopAiConfig {
  try {
    const filePath = getConfigFilePath();
    if (!fs.existsSync(filePath)) {
      return { ...DEFAULT_CONFIG, installedModels: {} };
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<DesktopAiConfig>;
    const installed: Record<string, InstalledModelRecord> = {};
    if (parsed.installedModels && typeof parsed.installedModels === 'object') {
      for (const [id, rec] of Object.entries(parsed.installedModels)) {
        if (rec && typeof rec.filePath === 'string' && fs.existsSync(rec.filePath)) {
          installed[id] = rec;
        }
      }
    }
    return {
      activeEngine: parsed.activeEngine || 'auto',
      selectedModelId: parsed.selectedModelId || null,
      customModelPath:
        parsed.customModelPath && fs.existsSync(parsed.customModelPath)
          ? parsed.customModelPath
          : null,
      computeMode: parsed.computeMode === 'auto' ? 'auto' : 'cpu',
      cpuThreads:
        typeof parsed.cpuThreads === 'number' && parsed.cpuThreads >= 0
          ? Math.round(parsed.cpuThreads)
          : 0,
      autoLearnFromMatches: parsed.autoLearnFromMatches !== false,
      installedModels: installed,
    };
  } catch {
    return { ...DEFAULT_CONFIG, installedModels: {} };
  }
}

export function saveDesktopAiConfig(config: DesktopAiConfig): void {
  try {
    const filePath = getConfigFilePath();
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf8');
  } catch (err) {
    console.warn('[DesktopStorage] Failed to save desktop-config.json:', err);
  }
}

export function loadDesktopWorkspace(): DesktopPersistentWorkspace {
  try {
    const filePath = getWorkspaceFilePath();
    if (!fs.existsSync(filePath)) {
      return { snapshots: [], botMemory: {}, updatedAt: '' };
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<DesktopPersistentWorkspace>;
    return {
      snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots : [],
      botMemory:
        parsed.botMemory && typeof parsed.botMemory === 'object' ? parsed.botMemory : {},
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
    };
  } catch {
    return { snapshots: [], botMemory: {}, updatedAt: '' };
  }
}

export function saveDesktopWorkspace(payload: {
  snapshots?: DeckVersionSnapshot[];
  botMemory?: Record<string, BotLearningProfile>;
}): DesktopPersistentWorkspace {
  const existing = loadDesktopWorkspace();
  const next: DesktopPersistentWorkspace = {
    snapshots: Array.isArray(payload.snapshots)
      ? payload.snapshots.slice(0, 40)
      : existing.snapshots,
    botMemory:
      payload.botMemory && typeof payload.botMemory === 'object'
        ? payload.botMemory
        : existing.botMemory,
    updatedAt: new Date().toISOString(),
  };
  try {
    const filePath = getWorkspaceFilePath();
    fs.writeFileSync(filePath, JSON.stringify(next), 'utf8');
  } catch (err) {
    console.warn('[DesktopStorage] Failed to save decks-and-bots.json:', err);
  }
  return next;
}

export function loadPersistedScryfallCache(): Record<string, unknown> {
  if (!isDesktopEnvironment()) return {};
  try {
    const filePath = getScryfallCacheFilePath();
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

let scryfallFlushTimer: ReturnType<typeof setTimeout> | null = null;
export function scheduleSaveScryfallCache(entriesMap: Map<string, unknown>): void {
  if (!isDesktopEnvironment()) return;
  if (scryfallFlushTimer) clearTimeout(scryfallFlushTimer);
  scryfallFlushTimer = setTimeout(() => {
    try {
      const obj: Record<string, unknown> = {};
      let count = 0;
      for (const [k, v] of entriesMap.entries()) {
        obj[k] = v;
        count += 1;
        if (count >= 1500) break;
      }
      fs.writeFileSync(getScryfallCacheFilePath(), JSON.stringify(obj), 'utf8');
    } catch (err) {
      console.warn('[DesktopStorage] Failed to persist scryfall-cache.json:', err);
    }
  }, 1500);
}

export interface BotMoveOutcomeRecord {
  id: string;
  timestampIso: string;
  botKey: string;
  botName: string;
  archetype: string;
  format: string;
  mode: string;
  playerDeckName: string;
  roundNumber: number;
  action: string;
  targetParticipant: string;
  targetLifeDelta: number;
  targetPoisonDelta: number;
  targetCommanderDamage: number;
  targetMillAmount: number;
  boardWipeCast: boolean;
  creaturesRemoved: number;
  postureUsed?: string;
  manaPlanUsed?: string;
  appliedMemoryReason?: string;
  matchOutcomeForBot: 'win' | 'loss' | 'close';
  engineUsed: string;
}

export interface BotStrategyPostureStats {
  moves: number;
  wins: number;
  losses: number;
  totalDamage: number;
}

export interface BotStrategyAggregate {
  botKey: string;
  botName: string;
  archetype: string;
  movesRecorded: number;
  matchesRecorded: number;
  wins: number;
  losses: number;
  closes: number;
  postureStats: Record<string, BotStrategyPostureStats>;
  targetCounts: Record<string, number>;
  recentWinningMoves: string[];
  recentLosingMoves: string[];
  updatedAtIso: string;
}

export interface BotTrainingFileData {
  version: 1;
  updatedAt: string;
  totalMovesRecorded: number;
  strategies: Record<string, BotStrategyAggregate>;
  recentMoveOutcomes: BotMoveOutcomeRecord[];
}

const MAX_TRAINING_MOVE_OUTCOMES = 200;
const MAX_TRAINING_STRATEGIES = 40;

export function getBotTrainingFilePath(): string {
  const dir = getDesktopDataDir();
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'bot_training.json');
}

function createEmptyBotTrainingData(): BotTrainingFileData {
  return {
    version: 1,
    updatedAt: '',
    totalMovesRecorded: 0,
    strategies: {},
    recentMoveOutcomes: [],
  };
}

export function loadBotTrainingData(): BotTrainingFileData {
  try {
    const filePath = getBotTrainingFilePath();
    if (!fs.existsSync(filePath)) {
      return createEmptyBotTrainingData();
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<BotTrainingFileData>;
    if (!parsed || typeof parsed !== 'object') {
      return createEmptyBotTrainingData();
    }
    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
      totalMovesRecorded:
        typeof parsed.totalMovesRecorded === 'number' && Number.isFinite(parsed.totalMovesRecorded)
          ? parsed.totalMovesRecorded
          : 0,
      strategies:
        parsed.strategies && typeof parsed.strategies === 'object' ? parsed.strategies : {},
      recentMoveOutcomes: Array.isArray(parsed.recentMoveOutcomes)
        ? parsed.recentMoveOutcomes.slice(0, MAX_TRAINING_MOVE_OUTCOMES)
        : [],
    };
  } catch {
    return createEmptyBotTrainingData();
  }
}

export function clearBotTrainingData(): BotTrainingFileData {
  const empty = createEmptyBotTrainingData();
  try {
    fs.writeFileSync(getBotTrainingFilePath(), JSON.stringify(empty, null, 2), 'utf8');
  } catch (err) {
    console.warn('[DesktopStorage] Failed to clear bot_training.json:', err);
  }
  return empty;
}

export function recordBotTrainingMatchOutcomes(params: {
  moves: Array<Omit<BotMoveOutcomeRecord, 'id' | 'timestampIso'>>;
}): BotTrainingFileData {
  const { moves } = params;
  const current = loadBotTrainingData();
  if (!Array.isArray(moves) || moves.length === 0) {
    return current;
  }

  const nowIso = new Date().toISOString();
  const newRecords: BotMoveOutcomeRecord[] = [];
  const matchOutcomeByBotKey = new Map<string, 'win' | 'loss' | 'close'>();

  for (let i = 0; i < moves.length; i += 1) {
    const m = moves[i];
    const rec: BotMoveOutcomeRecord = {
      ...m,
      id: `mv_${Date.now().toString(36)}_${i}`,
      timestampIso: nowIso,
      action: (m.action || '').replace(/\s+/g, ' ').trim().slice(0, 220),
      playerDeckName: (m.playerDeckName || '').trim().slice(0, 80),
      appliedMemoryReason: m.appliedMemoryReason
        ? m.appliedMemoryReason.trim().slice(0, 140)
        : undefined,
    };
    newRecords.push(rec);

    const existingAgg: BotStrategyAggregate = current.strategies[rec.botKey] || {
      botKey: rec.botKey,
      botName: rec.botName,
      archetype: rec.archetype,
      movesRecorded: 0,
      matchesRecorded: 0,
      wins: 0,
      losses: 0,
      closes: 0,
      postureStats: {},
      targetCounts: {},
      recentWinningMoves: [],
      recentLosingMoves: [],
      updatedAtIso: nowIso,
    };

    existingAgg.botName = rec.botName;
    existingAgg.archetype = rec.archetype;
    existingAgg.movesRecorded += 1;
    existingAgg.updatedAtIso = nowIso;

    if (!matchOutcomeByBotKey.has(rec.botKey)) {
      matchOutcomeByBotKey.set(rec.botKey, rec.matchOutcomeForBot);
      existingAgg.matchesRecorded += 1;
      if (rec.matchOutcomeForBot === 'win') existingAgg.wins += 1;
      else if (rec.matchOutcomeForBot === 'loss') existingAgg.losses += 1;
      else existingAgg.closes += 1;
    }

    const postureKey = rec.postureUsed || 'balanced';
    const prevPosture = existingAgg.postureStats[postureKey] || {
      moves: 0,
      wins: 0,
      losses: 0,
      totalDamage: 0,
    };
    const damageImpact =
      (rec.targetLifeDelta < 0 ? Math.abs(rec.targetLifeDelta) : 0) +
      rec.targetPoisonDelta * 3 +
      rec.targetCommanderDamage +
      Math.round(rec.targetMillAmount / 2);

    existingAgg.postureStats[postureKey] = {
      moves: prevPosture.moves + 1,
      wins: prevPosture.wins + (rec.matchOutcomeForBot === 'win' ? 1 : 0),
      losses: prevPosture.losses + (rec.matchOutcomeForBot === 'loss' ? 1 : 0),
      totalDamage: prevPosture.totalDamage + damageImpact,
    };

    const targetKey = rec.targetParticipant || 'You';
    existingAgg.targetCounts[targetKey] = (existingAgg.targetCounts[targetKey] || 0) + 1;

    const conciseMove = `R${rec.roundNumber} [${postureKey}${rec.manaPlanUsed ? `/${rec.manaPlanUsed}` : ''}] -> ${targetKey}: ${rec.action.slice(0, 100)} (${rec.targetLifeDelta < 0 ? `${rec.targetLifeDelta}HP` : `${damageImpact} impact`})`;
    if (rec.matchOutcomeForBot === 'win') {
      if (!existingAgg.recentWinningMoves.includes(conciseMove)) {
        existingAgg.recentWinningMoves = [conciseMove, ...existingAgg.recentWinningMoves].slice(0, 8);
      }
    } else if (rec.matchOutcomeForBot === 'loss') {
      if (!existingAgg.recentLosingMoves.includes(conciseMove)) {
        existingAgg.recentLosingMoves = [conciseMove, ...existingAgg.recentLosingMoves].slice(0, 8);
      }
    }

    current.strategies[rec.botKey] = existingAgg;
  }

  // Keep strategies map bounded to most recently updated entries
  const strategyEntries = Object.entries(current.strategies);
  if (strategyEntries.length > MAX_TRAINING_STRATEGIES) {
    strategyEntries.sort((a, b) => b[1].updatedAtIso.localeCompare(a[1].updatedAtIso));
    current.strategies = Object.fromEntries(strategyEntries.slice(0, MAX_TRAINING_STRATEGIES));
  }

  const next: BotTrainingFileData = {
    version: 1,
    updatedAt: nowIso,
    totalMovesRecorded: current.totalMovesRecorded + newRecords.length,
    strategies: current.strategies,
    recentMoveOutcomes: [...newRecords, ...current.recentMoveOutcomes].slice(
      0,
      MAX_TRAINING_MOVE_OUTCOMES
    ),
  };

  try {
    fs.writeFileSync(getBotTrainingFilePath(), JSON.stringify(next, null, 2), 'utf8');
  } catch (err) {
    console.warn('[DesktopStorage] Failed to save bot_training.json:', err);
  }

  return next;
}

