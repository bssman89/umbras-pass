import React, { useCallback, useEffect, useState } from 'react';
import {
  Brain,
  Cpu,
  Download,
  FolderOpen,
  HardDrive,
  Play,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import {
  loadAutoLearnFromMatchesSetting,
  saveAutoLearnFromMatchesSetting,
} from '../utils/botLearning';

type EngineMode = 'auto' | 'local-gguf' | 'deterministic' | 'cloud-gemini';
type ComputeMode = 'cpu' | 'auto';

interface RecommendedModelStatus {
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
  isInstalled: boolean;
  isBundled?: boolean;
  installedSizeBytes: number;
  installedPath: string | null;
  fitsHardware: boolean;
}

interface ActiveDownloadState {
  modelId: string;
  fileName: string;
  downloadedBytes: number;
  totalBytes: number;
  speedBytesPerSec: number;
  progressPct: number;
  status: 'idle' | 'downloading' | 'completed' | 'cancelled' | 'error';
  error?: string;
}

interface DesktopAiStatusPayload {
  isDesktop: boolean;
  geminiConfigured: boolean;
  modelsDir: string;
  bundledModelsDir?: string | null;
  botTrainingPath?: string;
  botTrainingMoveCount?: number;
  hardware: {
    totalRamGb: number;
    freeRamGb: number;
    cpuCount: number;
    platform: string;
    recommendedModelId: string;
  };
  activeEngine: EngineMode;
  computeMode: ComputeMode;
  cpuThreads: number;
  autoLearnFromMatches?: boolean;
  selectedModelId: string | null;
  customModelPath: string | null;
  activeModelPath: string | null;
  activeModelIsBundled?: boolean;
  loadedModelId: string | null;
  catalog: RecommendedModelStatus[];
  activeDownload: ActiveDownloadState;
}

interface DesktopAppModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  const mb = bytes / 1024 ** 2;
  return `${mb.toFixed(1)} MB`;
}

export const DesktopAppModal: React.FC<DesktopAppModalProps> = ({ isOpen, onClose }) => {
  const isElectronDesktop =
    typeof window !== 'undefined' && Boolean(window.desktopApp?.isDesktop);

  const [aiStatus, setAiStatus] = useState<DesktopAiStatusPayload | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [customPathInput, setCustomPathInput] = useState('');
  const [autoLearnEnabled, setAutoLearnEnabled] = useState<boolean>(() =>
    loadAutoLearnFromMatchesSetting()
  );

  const fetchAiStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/desktop/ai-status');
      if (!res.ok) return;
      const data = (await res.json()) as DesktopAiStatusPayload;
      setAiStatus(data);
      if (typeof data.autoLearnFromMatches === 'boolean') {
        setAutoLearnEnabled(data.autoLearnFromMatches);
        saveAutoLearnFromMatchesSetting(data.autoLearnFromMatches);
      }
      if (data.customModelPath && !customPathInput) {
        setCustomPathInput(data.customModelPath);
      }
    } catch {
      // Ignore transient poll errors
    }
  }, [customPathInput]);

  useEffect(() => {
    if (!isOpen) return;
    setLoadingStatus(true);
    setStatusError(null);
    void fetchAiStatus().finally(() => setLoadingStatus(false));
  }, [isOpen, fetchAiStatus]);

  useEffect(() => {
    if (!isOpen) return;
    const isDownloading = aiStatus?.activeDownload?.status === 'downloading';
    if (!isDownloading) return;
    const timer = window.setInterval(() => {
      void fetchAiStatus();
    }, 750);
    return () => window.clearInterval(timer);
  }, [isOpen, aiStatus?.activeDownload?.status, fetchAiStatus]);

  if (!isOpen) return null;

  const handleSelectEngine = async (params: {
    activeEngine?: EngineMode;
    selectedModelId?: string | null;
    customModelPath?: string | null;
    computeMode?: ComputeMode;
    cpuThreads?: number;
    autoLearnFromMatches?: boolean;
  }) => {
    if (typeof params.autoLearnFromMatches === 'boolean') {
      setAutoLearnEnabled(params.autoLearnFromMatches);
      saveAutoLearnFromMatchesSetting(params.autoLearnFromMatches);
    }
    setActionBusy(true);
    setStatusError(null);
    try {
      const res = await fetch('/api/desktop/models/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      const payload = (await res.json()) as DesktopAiStatusPayload & { error?: string };
      if (!res.ok) {
        throw new Error(payload.error || 'Failed to update AI engine settings.');
      }
      setAiStatus(payload);
      if (typeof payload.autoLearnFromMatches === 'boolean') {
        setAutoLearnEnabled(payload.autoLearnFromMatches);
        saveAutoLearnFromMatchesSetting(payload.autoLearnFromMatches);
      }
      window.dispatchEvent(new Event('umbras:ai-status-updated'));
    } catch (err) {
      const isOnlyAutoLearnToggle =
        typeof params.autoLearnFromMatches === 'boolean' &&
        params.activeEngine === undefined &&
        params.selectedModelId === undefined &&
        params.customModelPath === undefined &&
        params.computeMode === undefined &&
        params.cpuThreads === undefined;
      if (isOnlyAutoLearnToggle) {
        window.dispatchEvent(new Event('umbras:ai-status-updated'));
      } else {
        setStatusError(err instanceof Error ? err.message : 'Could not switch AI engine.');
      }
    } finally {
      setActionBusy(false);
    }
  };

  const handleStartDownload = async (modelId: string) => {
    setActionBusy(true);
    setStatusError(null);
    try {
      const res = await fetch('/api/desktop/models/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId }),
      });
      const payload = (await res.json()) as ActiveDownloadState & { error?: string };
      if (!res.ok) {
        throw new Error(payload.error || 'Could not start Hugging Face download.');
      }
      await fetchAiStatus();
      window.dispatchEvent(new Event('umbras:ai-status-updated'));
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Download failed to start.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleCancelDownload = async () => {
    setActionBusy(true);
    try {
      await fetch('/api/desktop/models/cancel', { method: 'POST' });
      await fetchAiStatus();
    } finally {
      setActionBusy(false);
    }
  };

  const handleDeleteModel = async (modelId: string) => {
    setActionBusy(true);
    setStatusError(null);
    try {
      const res = await fetch(`/api/desktop/models/${encodeURIComponent(modelId)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        const data = (await res.json()) as DesktopAiStatusPayload;
        setAiStatus(data);
        window.dispatchEvent(new Event('umbras:ai-status-updated'));
      }
    } finally {
      setActionBusy(false);
    }
  };

  const handleResetBotTraining = async () => {
    setActionBusy(true);
    setStatusError(null);
    try {
      const res = await fetch('/api/desktop/bot-training', {
        method: 'DELETE',
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || 'Could not reset bot_training.json.');
      }
      await fetchAiStatus();
      window.dispatchEvent(new Event('umbras:ai-status-updated'));
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Failed to reset bot_training.json.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleBrowseLocalGguf = async () => {
    if (window.desktopApp?.selectGgufFile) {
      const chosen = await window.desktopApp.selectGgufFile();
      if (chosen) {
        setCustomPathInput(chosen);
        await handleSelectEngine({
          activeEngine: 'local-gguf',
          selectedModelId: 'custom-file',
          customModelPath: chosen,
        });
      }
    }
  };

  const activeDownload = aiStatus?.activeDownload;
  const isDownloading = activeDownload?.status === 'downloading';

  const activeEngineSummary = (() => {
    if (!aiStatus) return 'Loading engine telemetry...';
    if (aiStatus.activeEngine === 'deterministic') {
      return 'Built-in Deterministic Engine (Zero Download)';
    }
    const computeLabel = aiStatus.computeMode === 'auto' ? 'Auto GPU/CPU' : 'CPU Only';
    if (aiStatus.activeEngine === 'local-gguf' && aiStatus.activeModelPath) {
      const matched = aiStatus.catalog.find((c) => c.id === aiStatus.selectedModelId);
      return `Local GGUF · ${matched ? matched.shortName : 'Custom Model'} · ${computeLabel}`;
    }
    if (aiStatus.activeModelPath) {
      const matched = aiStatus.catalog.find((c) => c.id === aiStatus.selectedModelId);
      return `Auto · Local ${matched ? matched.shortName : 'GGUF'} (${computeLabel})`;
    }
    return 'Auto · Deterministic Offline Engine (No .gguf loaded)';
  })();

  const threadOptions = [0, 2, 4, 6, 8, 12, 16];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="relative w-full max-w-3xl bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/60">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400 shrink-0">
              <Cpu className="w-4.5 h-4.5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">
                AI Engine &amp; Local Models
              </h2>
              <p className="text-xs text-zinc-400">
                Embedded llama.cpp runtime · Local Qwen GGUF models · Offline deterministic engine
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close AI engine settings modal"
            className="p-2 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-5 text-sm text-zinc-300">
          <div className="space-y-4">
              {/* Hardware & Engine Status Summary Bar */}
              <div className="p-4 rounded-lg bg-zinc-950 border border-zinc-800 flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-white">
                    Active Engine: {activeEngineSummary}
                  </div>
                  <div className="text-xs text-zinc-400 font-mono tabular-nums">
                    {loadingStatus || !aiStatus
                      ? 'Detecting system hardware...'
                      : `${aiStatus.hardware.totalRamGb} GB RAM (${aiStatus.hardware.freeRamGb} GB free) · ${aiStatus.hardware.cpuCount} CPU threads · ${aiStatus.hardware.platform}`}
                  </div>
                </div>

                {isElectronDesktop && window.desktopApp?.openModelsFolder && (
                  <button
                    type="button"
                    onClick={() => void window.desktopApp?.openModelsFolder?.()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-xs font-medium text-zinc-200 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-sky-400" />
                    Open Models Folder
                  </button>
                )}
              </div>

              {statusError && (
                <div className="p-3 rounded-lg border border-red-300 bg-red-50 text-xs text-red-700">
                  {statusError}
                </div>
              )}

              {/* Engine Mode Switcher */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={() => void handleSelectEngine({ activeEngine: 'auto' })}
                  className={`p-3 rounded-lg border text-left transition cursor-pointer ${
                    aiStatus?.activeEngine === 'auto'
                      ? 'border-sky-500 bg-sky-50'
                      : 'border-zinc-800 bg-zinc-950 hover:border-zinc-700'
                  }`}
                >
                  <div className="text-xs font-semibold text-white">Auto (Recommended)</div>
                  <div className="text-[11px] text-zinc-400 mt-0.5">
                    Uses local Qwen GGUF when available, falling back to deterministic engine offline.
                  </div>
                </button>

                <button
                  type="button"
                  disabled={actionBusy || !aiStatus?.activeModelPath}
                  onClick={() => void handleSelectEngine({ activeEngine: 'local-gguf' })}
                  className={`p-3 rounded-lg border text-left transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                    aiStatus?.activeEngine === 'local-gguf'
                      ? 'border-sky-500 bg-sky-50'
                      : 'border-zinc-800 bg-zinc-950 hover:border-zinc-700'
                  }`}
                >
                  <div className="text-xs font-semibold text-white">Local Qwen GGUF</div>
                  <div className="text-[11px] text-zinc-400 mt-0.5">
                    {aiStatus?.activeModelPath
                      ? 'Runs 100% locally via compiled llama.cpp runtime.'
                      : 'Place a .gguf in models/ or download below to enable.'}
                  </div>
                </button>

                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={() => void handleSelectEngine({ activeEngine: 'deterministic' })}
                  className={`p-3 rounded-lg border text-left transition cursor-pointer ${
                    aiStatus?.activeEngine === 'deterministic'
                      ? 'border-sky-500 bg-sky-50'
                      : 'border-zinc-800 bg-zinc-950 hover:border-zinc-700'
                  }`}
                >
                  <div className="text-xs font-semibold text-white">Deterministic Offline</div>
                  <div className="text-[11px] text-zinc-400 mt-0.5">
                    Instant rule-accurate analysis &amp; tactical playtests with zero download.
                  </div>
                </button>
              </div>

              {/* CPU Compute Mode & Thread Tuning */}
              <div className="p-3.5 rounded-lg border border-zinc-800 bg-zinc-950 flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="text-xs font-semibold text-white">
                    Compute Acceleration &amp; CPU Threads
                  </div>
                  <div className="text-[11px] text-zinc-400">
                    CPU Only disables GPU probing and caps context at 4096 tokens for 8 GB+ RAM desktops.
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={actionBusy}
                    onClick={() => void handleSelectEngine({ computeMode: 'cpu' })}
                    className={`px-2.5 py-1 rounded border text-xs font-semibold whitespace-nowrap cursor-pointer ${
                      (aiStatus?.computeMode ?? 'cpu') === 'cpu'
                        ? 'border-sky-500 bg-sky-50 text-sky-300'
                        : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-600'
                    }`}
                  >
                    CPU Only (No GPU)
                  </button>
                  <button
                    type="button"
                    disabled={actionBusy}
                    onClick={() => void handleSelectEngine({ computeMode: 'auto' })}
                    className={`px-2.5 py-1 rounded border text-xs font-semibold whitespace-nowrap cursor-pointer ${
                      aiStatus?.computeMode === 'auto'
                        ? 'border-sky-500 bg-sky-50 text-sky-300'
                        : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-600'
                    }`}
                  >
                    Auto GPU / CPU
                  </button>

                  <select
                    aria-label="CPU Thread Count"
                    disabled={actionBusy}
                    value={aiStatus?.cpuThreads ?? 0}
                    onChange={(e) =>
                      void handleSelectEngine({ cpuThreads: Number(e.target.value) })
                    }
                    className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs font-mono tabular-nums text-zinc-200 cursor-pointer"
                  >
                    {threadOptions.map((t) => (
                      <option key={t} value={t}>
                        {t === 0 ? 'Threads: Auto' : `${t} Threads`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Enable Auto-Learning Toggle */}
              <div className="p-3.5 rounded-lg border border-zinc-800 bg-zinc-950 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label
                    htmlFor="enable-auto-learning-toggle"
                    className="space-y-0.5 flex-1 min-w-[240px] cursor-pointer"
                  >
                    <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                      <Brain className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                      <span>Enable Auto-Learning</span>
                    </div>
                    <div className="text-[11px] text-zinc-400">
                      {autoLearnEnabled
                        ? 'Enabled — saves bot move outcomes to local bot_training.json in the user data folder so the GGUF bot iteratively improves its strategy over time without requiring user feedback.'
                        : 'Disabled — simulated matches will not write to bot_training.json or auto-update bot memory; bots only learn from manual coaching feedback.'}
                    </div>
                  </label>

                  <div className="flex items-center gap-2.5 shrink-0">
                    <button
                      id="enable-auto-learning-toggle"
                      type="button"
                      role="switch"
                      aria-checked={autoLearnEnabled}
                      aria-label="Enable Auto-Learning"
                      disabled={actionBusy}
                      onClick={() =>
                        void handleSelectEngine({ autoLearnFromMatches: !autoLearnEnabled })
                      }
                      className={`relative inline-flex h-6 w-11 items-center rounded-full border transition-colors cursor-pointer disabled:opacity-50 ${
                        autoLearnEnabled
                          ? 'border-sky-500 bg-sky-700'
                          : 'border-zinc-700 bg-zinc-800'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          autoLearnEnabled ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                    <span className="text-xs font-semibold tabular-nums text-zinc-200 min-w-[28px]">
                      {autoLearnEnabled ? 'On' : 'Off'}
                    </span>
                  </div>
                </div>

                {(aiStatus?.botTrainingPath || (aiStatus?.botTrainingMoveCount ?? 0) > 0) && (
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800 pt-2 text-[11px] text-zinc-400">
                    <span className="font-mono truncate" title={aiStatus?.botTrainingPath}>
                      Training log: bot_training.json · {aiStatus?.botTrainingMoveCount ?? 0} moves recorded
                    </span>
                    {(aiStatus?.botTrainingMoveCount ?? 0) > 0 && (
                      <button
                        type="button"
                        disabled={actionBusy}
                        onClick={() => void handleResetBotTraining()}
                        className="text-[11px] font-medium text-red-400 hover:text-red-300 cursor-pointer shrink-0"
                      >
                        Reset bot_training.json
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Active Download Banner */}
              {activeDownload && activeDownload.status !== 'idle' && (
                <div className="p-3.5 rounded-lg border border-zinc-800 bg-zinc-950 space-y-2">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-white truncate">
                      {activeDownload.status === 'downloading'
                        ? `Downloading ${activeDownload.fileName} from huggingface.co`
                        : activeDownload.status === 'completed'
                        ? `Ready: ${activeDownload.fileName}`
                        : activeDownload.status === 'cancelled'
                        ? `Cancelled download of ${activeDownload.fileName}`
                        : `Download error: ${activeDownload.error || 'Failed'}`}
                    </span>
                    <span className="font-mono tabular-nums text-sky-400 whitespace-nowrap">
                      {formatBytes(activeDownload.downloadedBytes)} /{' '}
                      {formatBytes(activeDownload.totalBytes)} ({activeDownload.progressPct}%)
                    </span>
                  </div>

                  {isDownloading && (
                    <>
                      <div className="w-full h-2 rounded bg-zinc-800 overflow-hidden">
                        <div
                          className="h-full bg-sky-500 transition-all duration-300"
                          style={{ width: `${activeDownload.progressPct}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-zinc-400 font-mono tabular-nums">
                        <span>Speed: {formatBytes(activeDownload.speedBytesPerSec)}/s</span>
                        <button
                          type="button"
                          onClick={() => void handleCancelDownload()}
                          className="inline-flex items-center gap-1 text-red-400 hover:text-red-300 font-sans font-semibold cursor-pointer"
                        >
                          <Square className="w-3 h-3" />
                          Cancel
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Recommended Hugging Face Qwen Catalog */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Recommended Hugging Face GGUF Models
                  </h3>
                  <span className="text-[11px] text-zinc-500">
                    Auto-loads from local models directory
                  </span>
                </div>

                {(aiStatus?.catalog || []).map((model) => {
                  const isActiveSelected =
                    aiStatus?.selectedModelId === model.id &&
                    aiStatus?.activeEngine !== 'deterministic';
                  const isRecommendedForPc =
                    aiStatus?.hardware.recommendedModelId === model.id;

                  return (
                    <div
                      key={model.id}
                      className={`p-3.5 rounded-lg border transition ${
                        isActiveSelected
                          ? 'border-sky-500 bg-sky-50'
                          : 'border-zinc-800 bg-zinc-950'
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1 flex-1 min-w-[240px]">
                          <div className="text-sm font-semibold text-white">
                            {model.label}
                          </div>
                          <div className="text-xs text-zinc-400 font-mono tabular-nums">
                            {model.repo} · {model.quant} · ~{model.estimatedGb} GB ·{' '}
                            {model.tierLabel}
                            {isRecommendedForPc ? ' · Best fit for your PC' : ''}
                            {!model.fitsHardware ? ' · Exceeds detected RAM' : ''}
                          </div>
                          <p className="text-xs text-zinc-400">{model.description}</p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {model.isInstalled ? (
                            <>
                              <button
                                type="button"
                                disabled={actionBusy || isActiveSelected}
                                onClick={() =>
                                  void handleSelectEngine({
                                    activeEngine: 'local-gguf',
                                    selectedModelId: model.id,
                                  })
                                }
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-700 hover:bg-sky-800 disabled:opacity-60 text-xs font-semibold whitespace-nowrap cursor-pointer"
                              >
                                <Play className="w-3 h-3" />
                                {isActiveSelected ? 'Active' : 'Activate'}
                              </button>
                              {!model.isBundled && (
                                <button
                                  type="button"
                                  disabled={actionBusy}
                                  onClick={() => void handleDeleteModel(model.id)}
                                  title="Delete downloaded GGUF file"
                                  className="p-1.5 rounded-lg border border-zinc-700 text-zinc-400 hover:text-red-400 hover:border-red-400/50 cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </>
                          ) : (
                            <button
                              type="button"
                              disabled={actionBusy || isDownloading}
                              onClick={() => void handleStartDownload(model.id)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-sky-500/60 bg-sky-500/10 hover:bg-sky-500/20 disabled:opacity-50 text-xs font-semibold text-sky-300 whitespace-nowrap cursor-pointer"
                            >
                              <Download className="w-3.5 h-3.5" />
                              Download GGUF
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Load Custom Local .gguf File */}
              <div className="p-3.5 rounded-lg border border-zinc-800 bg-zinc-950 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                    <HardDrive className="w-3.5 h-3.5 text-sky-400" />
                    Load Existing Local `.gguf` File
                  </div>
                  {isElectronDesktop && window.desktopApp?.selectGgufFile && (
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => void handleBrowseLocalGguf()}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border border-zinc-700 hover:bg-zinc-800 text-xs font-semibold text-zinc-200 whitespace-nowrap cursor-pointer"
                    >
                      <FolderOpen className="w-3.5 h-3.5 text-sky-400" />
                      Browse .gguf File
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={customPathInput}
                    onChange={(e) => setCustomPathInput(e.target.value)}
                    placeholder="C:\UmbrasPass\models\Qwen3-4B-Q4_K_M.gguf"
                    className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-mono text-zinc-200"
                  />
                  <button
                    type="button"
                    disabled={actionBusy || !customPathInput.trim()}
                    onClick={() =>
                      void handleSelectEngine({
                        activeEngine: 'local-gguf',
                        selectedModelId: 'custom-file',
                        customModelPath: customPathInput.trim(),
                      })
                    }
                    className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-xs font-semibold text-white whitespace-nowrap cursor-pointer"
                  >
                    Use File
                  </button>
                </div>
              </div>
            </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-zinc-800 bg-zinc-950/60 flex items-center justify-between gap-4">
          <span className="text-xs text-zinc-500 truncate">
            {aiStatus ? 'Local AI runtime configured' : 'Detecting local runtime...'}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-semibold transition whitespace-nowrap cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
