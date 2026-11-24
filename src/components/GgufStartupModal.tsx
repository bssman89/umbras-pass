import React, { useCallback, useEffect, useState } from 'react';
import {
  BookOpen,
  Check,
  Copy,
  Cpu,
  Download,
  ExternalLink,
  FileCode2,
  FolderOpen,
  Loader2,
  Settings,
  Square,
  Terminal,
  X,
} from 'lucide-react';
import { copyTextToClipboard } from '../utils/clipboard';
import { readJoinParamsFromWindowLocation } from '../utils/multiplayerInvite';

const LEGACY_STARTUP_SEEN_KEY = 'umbras_gguf_onboarding_seen_v1';
const STARTUP_DISABLED_KEY = 'umbras_welcome_startup_disabled_v1';
export const WELCOME_PREF_CHANGED_EVENT = 'umbras:welcome-pref-changed';

interface CatalogModel {
  id: string;
  label: string;
  shortName: string;
  defaultFileName: string;
  estimatedGb: number;
  recommendedRamGb: number;
  tierLabel: string;
  description: string;
  recommended?: boolean;
  isInstalled: boolean;
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

interface StartupAiStatus {
  isDesktop: boolean;
  modelsDir: string;
  activeModelPath: string | null;
  selectedModelId: string | null;
  hardware?: {
    totalRamGb: number;
    recommendedModelId: string;
  };
  catalog: CatalogModel[];
  activeDownload: ActiveDownloadState;
}

interface GgufStartupModalProps {
  forceOpen?: boolean;
  onCloseForceOpen?: () => void;
  onOpenAiSettings: () => void;
}

const HUGGINGFACE_MODEL_GUIDE = [
  {
    name: 'Qwen3-1.7B (Q4_K_M)',
    size: '~1.1 GB',
    ram: '8 GB RAM',
    bestFor: 'Fastest / laptops & older PCs',
    fileName: 'Qwen3-1.7B-Q4_K_M.gguf',
    url: 'https://huggingface.co/unsloth/Qwen3-1.7B-GGUF',
  },
  {
    name: 'Qwen3-4B (Q4_K_M)',
    size: '~2.5 GB',
    ram: '12+ GB RAM',
    bestFor: 'Recommended balance (default)',
    fileName: 'Qwen3-4B-Q4_K_M.gguf',
    url: 'https://huggingface.co/unsloth/Qwen3-4B-GGUF',
    recommended: true,
  },
  {
    name: 'Qwen3-8B (Q4_K_M)',
    size: '~5.0 GB',
    ram: '16+ GB RAM',
    bestFor: 'Deeper deck synergy reasoning',
    fileName: 'Qwen3-8B-Q4_K_M.gguf',
    url: 'https://huggingface.co/unsloth/Qwen3-8B-GGUF',
  },
];

export function isStartupWelcomeDisabled(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const explicit = window.localStorage.getItem(STARTUP_DISABLED_KEY);
    if (explicit === '0') return false;
    if (explicit === '1') return true;
    return window.localStorage.getItem(LEGACY_STARTUP_SEEN_KEY) === '1';
  } catch {
    return true;
  }
}

export function setStartupWelcomeDisabled(disabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STARTUP_DISABLED_KEY, disabled ? '1' : '0');
    if (disabled) {
      window.localStorage.setItem(LEGACY_STARTUP_SEEN_KEY, '1');
    } else {
      window.localStorage.removeItem(LEGACY_STARTUP_SEEN_KEY);
    }
    window.dispatchEvent(new Event(WELCOME_PREF_CHANGED_EVENT));
  } catch {
    // Ignore storage errors
  }
}

export function hasSeenGgufStartupGuide(): boolean {
  return isStartupWelcomeDisabled();
}

export function markGgufStartupGuideSeen(): void {
  setStartupWelcomeDisabled(true);
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function buildWindowsAutoSetupBat(): string {
  return [
    '@echo off',
    'setlocal',
    'title Umbras Pass - Automated GGUF Model Setup',
    'echo ============================================================',
    'echo   Umbras Pass - Automated Local AI (.gguf) Downloader',
    'echo ============================================================',
    'echo.',
    'where node >nul 2>nul',
    'if %ERRORLEVEL% EQU 0 (',
    '  if exist "package.json" (',
    '    echo Running full project setup (npm dependencies + .gguf model)...',
    '    node scripts/setup-umbras-pass.mjs',
    '    pause',
    '    exit /b %ERRORLEVEL%',
    '  )',
    ')',
    'if not exist "models" mkdir "models"',
    'set "TARGET=models\\Qwen3-4B-Q4_K_M.gguf"',
    'set "URL=https://huggingface.co/unsloth/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf?download=true"',
    'if exist "%TARGET%" (',
    '  echo Model already exists at %TARGET%!',
    ') else (',
    '  echo Downloading Qwen3-4B-Q4_K_M.gguf (~2.5 GB) from Hugging Face...',
    '  curl.exe -L --progress-bar -o "%TARGET%.partial" "%URL%"',
    '  if %ERRORLEVEL% NEQ 0 (',
    '    if exist "%TARGET%.partial" del "%TARGET%.partial"',
    '    echo Download failed. Please check your internet connection.',
    '    pause',
    '    exit /b 1',
    '  )',
    '  move /Y "%TARGET%.partial" "%TARGET%" >nul',
    '  echo Saved %TARGET% successfully!',
    ')',
    'echo.',
    'echo Done! Place or run Umbras Pass in this folder and the .gguf model will load automatically.',
    'pause',
    'endlocal',
    '',
  ].join('\r\n');
}

export const GgufStartupModal: React.FC<GgufStartupModalProps> = ({
  forceOpen = false,
  onCloseForceOpen,
  onOpenAiSettings,
}) => {
  const [autoOpen, setAutoOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'auto' | 'manual'>('auto');
  const [dontShowOnStartup, setDontShowOnStartup] = useState<boolean>(() => {
    // Default checked for a clean one-time welcome screen, unless the user explicitly enabled startup display
    if (typeof window === 'undefined') return true;
    try {
      return window.localStorage.getItem(STARTUP_DISABLED_KEY) !== '0';
    } catch {
      return true;
    }
  });
  const [aiStatus, setAiStatus] = useState<StartupAiStatus | null>(null);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [copiedModelsPath, setCopiedModelsPath] = useState(false);
  const [downloadedScriptNotice, setDownloadedScriptNotice] = useState(false);

  const isOpen = autoOpen || forceOpen;

  const fetchStatus = useCallback(async (): Promise<StartupAiStatus | null> => {
    try {
      const res = await fetch('/api/desktop/ai-status');
      if (!res.ok) return null;
      const data = (await res.json()) as StartupAiStatus;
      setAiStatus(data);
      return data;
    } catch {
      return null;
    }
  }, []);

  // One-time startup check (respects user's enable/disable preference & skips on ?join= invite links)
  useEffect(() => {
    if (readJoinParamsFromWindowLocation() || isStartupWelcomeDisabled()) return;
    let cancelled = false;

    void fetchStatus().then(() => {
      if (cancelled) return;
      setAutoOpen(true);
    });

    return () => {
      cancelled = true;
    };
  }, [fetchStatus]);

  // Refresh AI status whenever manually re-opened from Settings
  useEffect(() => {
    if (!forceOpen) return;
    setDontShowOnStartup(isStartupWelcomeDisabled());
    void fetchStatus();
  }, [forceOpen, fetchStatus]);

  // Poll progress while downloading inside the startup screen
  useEffect(() => {
    if (!isOpen) return;
    if (aiStatus?.activeDownload?.status !== 'downloading') return;
    const timer = window.setInterval(() => {
      void fetchStatus();
    }, 800);
    return () => window.clearInterval(timer);
  }, [isOpen, aiStatus?.activeDownload?.status, fetchStatus]);

  const handleClose = useCallback(() => {
    setStartupWelcomeDisabled(dontShowOnStartup);
    setAutoOpen(false);
    onCloseForceOpen?.();
  }, [dontShowOnStartup, onCloseForceOpen]);

  // Keyboard Escape dismiss
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, handleClose]);

  if (!isOpen) return null;

  const recommendedModel =
    aiStatus?.catalog?.find((m) => m.id === aiStatus?.hardware?.recommendedModelId) ||
    aiStatus?.catalog?.find((m) => m.recommended) ||
    aiStatus?.catalog?.[0] ||
    null;

  const isDownloading = aiStatus?.activeDownload?.status === 'downloading';
  const isInstalledNow =
    Boolean(aiStatus?.activeModelPath) ||
    aiStatus?.activeDownload?.status === 'completed' ||
    Boolean(aiStatus?.catalog?.some((m) => m.isInstalled));

  const modelsFolderLabel = aiStatus?.modelsDir || './models/';

  const handleAutoDownloadInApp = async () => {
    const modelId = recommendedModel?.id || 'qwen3-4b';
    setDownloadBusy(true);
    setDownloadError(null);
    try {
      const res = await fetch('/api/desktop/models/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(payload.error || 'Could not start automatic .gguf download.');
      }
      await fetchStatus();
      window.dispatchEvent(new Event('umbras:ai-status-updated'));
    } catch (err) {
      setDownloadError(
        err instanceof Error
          ? err.message
          : 'Auto-download could not connect to the local backend. Use the manual Hugging Face guide or automated script instead.'
      );
    } finally {
      setDownloadBusy(false);
    }
  };

  const handleCancelDownload = async () => {
    setDownloadBusy(true);
    try {
      await fetch('/api/desktop/models/cancel', { method: 'POST' });
      await fetchStatus();
    } finally {
      setDownloadBusy(false);
    }
  };

  const handleCopyCommand = async () => {
    await copyTextToClipboard('npm run setup:gguf');
    setCopiedCmd(true);
    window.setTimeout(() => setCopiedCmd(false), 2000);
  };

  const handleCopyModelsPath = async () => {
    await copyTextToClipboard(modelsFolderLabel);
    setCopiedModelsPath(true);
    window.setTimeout(() => setCopiedModelsPath(false), 2000);
  };

  const handleDownloadWindowsScript = () => {
    const content = buildWindowsAutoSetupBat();
    const blob = new Blob([content], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'setup-gguf.bat';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setDownloadedScriptNotice(true);
    window.setTimeout(() => setDownloadedScriptNotice(false), 4000);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="gguf-startup-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-6 py-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              <span className="font-semibold text-sky-700">Welcome Guide</span>
              <span aria-hidden="true">·</span>
              <span>Optional One-Time Setup</span>
              <span aria-hidden="true">·</span>
              <span>Local Hugging Face AI Models</span>
            </div>
            <h2
              id="gguf-startup-title"
              className="font-display text-xl font-bold text-zinc-900"
            >
              Welcome to Umbras Pass
            </h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close welcome guide"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 cursor-pointer shrink-0"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 text-sm text-zinc-700">
          {/* Welcome overview */}
          <div className="space-y-2">
            <p className="leading-relaxed text-zinc-600">
              Analyze Magic: The Gathering decklists, optimize mana bases, and playtest live against adaptive bots—<strong className="text-zinc-900">100% free and local</strong>, with no cloud API key or account required.
            </p>
            <p className="text-xs leading-relaxed text-zinc-500">
              Installing an AI model is <strong className="text-zinc-700">completely optional</strong>: Umbras Pass works immediately using its built-in rules engine, and you can add or swap local <code className="font-mono text-zinc-700">.gguf</code> models from <strong className="text-zinc-700">huggingface.co</strong> anytime.
            </p>
          </div>

          {isInstalledNow && (
            <div className="flex items-center gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-semibold text-emerald-800">
              <Check className="h-4 w-4 shrink-0" />
              <span>
                Local AI model detected and ready{aiStatus?.activeModelPath ? ` (${aiStatus.activeModelPath.split(/[\\/]/).pop()})` : ''}. You can still browse or switch models anytime.
              </span>
            </div>
          )}

          {/* Mode Tabs */}
          <div
            role="tablist"
            aria-label="Local AI model installation methods"
            className="flex items-center gap-1.5 rounded-xl bg-zinc-100 p-1.5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'auto'}
              onClick={() => setActiveTab('auto')}
              className={`flex-1 inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg px-4 py-2 text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'auto'
                  ? 'bg-white text-zinc-900 shadow-sm'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              <Download className="h-4 w-4 text-sky-700 shrink-0" />
              <span>Quick Auto-Install</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'manual'}
              onClick={() => setActiveTab('manual')}
              className={`flex-1 inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg px-4 py-2 text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'manual'
                  ? 'bg-white text-zinc-900 shadow-sm'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              <BookOpen className="h-4 w-4 text-sky-700 shrink-0" />
              <span>How to Install from HuggingFace.co</span>
            </button>
          </div>

          {activeTab === 'auto' ? (
            <div className="space-y-5">
              {/* Option 1: Built-in 1-Click Automated Downloader */}
              <div className="space-y-3 border-b border-zinc-200 pb-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
                      <Cpu className="h-4 w-4 text-sky-700 shrink-0" />
                      <span>01. One-Click In-App Download from Hugging Face</span>
                    </div>
                    <p className="text-xs text-zinc-600">
                      Recommended for your PC:{' '}
                      <strong className="text-zinc-900">
                        {recommendedModel?.label || 'Qwen3-4B (Q4_K_M)'}
                      </strong>{' '}
                      <span className="font-mono tabular-nums text-zinc-500">
                        (~{recommendedModel?.estimatedGb ?? 2.5} GB)
                      </span>
                    </p>
                  </div>

                  {!isDownloading && !isInstalledNow && (
                    <button
                      type="button"
                      disabled={downloadBusy}
                      onClick={() => void handleAutoDownloadInApp()}
                      className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-sky-700 px-4 py-2 text-xs sm:text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      {downloadBusy ? (
                        <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                      ) : (
                        <Download className="h-4 w-4 shrink-0" />
                      )}
                      Auto-Download .gguf Now
                    </button>
                  )}
                </div>

                {isDownloading && aiStatus?.activeDownload && (
                  <div className="space-y-2 pt-1">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-mono font-semibold text-zinc-900 truncate">
                        Downloading {aiStatus.activeDownload.fileName}...
                      </span>
                      <div className="flex items-center gap-2.5 font-mono text-xs tabular-nums text-zinc-600">
                        <span>
                          {formatBytes(aiStatus.activeDownload.downloadedBytes)}
                          {aiStatus.activeDownload.totalBytes > 0
                            ? ` / ${formatBytes(aiStatus.activeDownload.totalBytes)}`
                            : ''}
                        </span>
                        <span className="font-bold text-sky-700">
                          {Math.round(aiStatus.activeDownload.progressPct)}%
                        </span>
                        <button
                          type="button"
                          disabled={downloadBusy}
                          onClick={() => void handleCancelDownload()}
                          className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-red-300 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-100 cursor-pointer whitespace-nowrap"
                        >
                          <Square className="h-3 w-3 shrink-0" />
                          Cancel
                        </button>
                      </div>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200">
                      <div
                        className="h-full bg-sky-700 transition-all duration-300"
                        style={{
                          width: `${Math.max(2, Math.min(100, aiStatus.activeDownload.progressPct))}%`,
                        }}
                      />
                    </div>
                  </div>
                )}

                {downloadError && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    {downloadError}
                  </div>
                )}
              </div>

              {/* Option 2: Automated Setup Script */}
              <div className="space-y-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
                    <Terminal className="h-4 w-4 text-sky-700 shrink-0" />
                    <span>02. Automated Setup Script (Windows / Source Builds)</span>
                  </div>
                  <p className="text-xs leading-relaxed text-zinc-600">
                    Creates the <code className="font-mono text-zinc-800">models/</code> folder, downloads <code className="font-mono text-zinc-800">Qwen3-4B-Q4_K_M.gguf</code> from <code className="font-mono text-zinc-800">huggingface.co</code>, and installs project dependencies automatically when running from source.
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3.5 py-2.5">
                  <code className="font-mono text-xs sm:text-sm text-sky-700">npm run setup:gguf</code>
                  <button
                    type="button"
                    onClick={() => void handleCopyCommand()}
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    {copiedCmd ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-700" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        Copy Command
                      </>
                    )}
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={handleDownloadWindowsScript}
                    className="inline-flex min-h-[38px] items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3.5 py-2 text-xs sm:text-sm font-semibold text-zinc-800 hover:bg-zinc-50 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <FileCode2 className="h-4 w-4 text-sky-700 shrink-0" />
                    Download Windows Script (setup-gguf.bat)
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('manual')}
                    className="inline-flex min-h-[38px] items-center rounded-lg px-2 py-1.5 text-xs sm:text-sm font-semibold text-sky-700 hover:underline cursor-pointer whitespace-nowrap"
                  >
                    Prefer manual download from HuggingFace.co? View steps →
                  </button>
                </div>

                {downloadedScriptNotice && (
                  <p className="text-xs font-medium text-emerald-700">
                    Saved <code>setup-gguf.bat</code> — place it in your Umbras Pass folder and double-click to run.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Step 1: Pick a model on HuggingFace.co */}
              <div className="space-y-2 border-b border-zinc-200 pb-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-zinc-900">
                    01. Pick a Model on HuggingFace.co
                  </h3>
                  <a
                    href="https://huggingface.co/models?library=gguf&sort=downloads"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:underline whitespace-nowrap"
                  >
                    Browse All GGUF Models
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                </div>
                <p className="text-xs text-zinc-600 leading-relaxed">
                  Umbras Pass supports any local <code className="font-mono text-zinc-800">.gguf</code> model compatible with <code className="font-mono text-zinc-800">llama.cpp</code>. Pick a size that fits your PC memory:
                </p>

                <div className="overflow-x-auto rounded-lg border border-zinc-200">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-zinc-200 bg-zinc-50 text-xs font-semibold text-zinc-600">
                      <tr>
                        <th className="px-3 py-2.5">Model</th>
                        <th className="px-3 py-2.5 font-mono">Size</th>
                        <th className="px-3 py-2.5 font-mono">RAM</th>
                        <th className="px-3 py-2.5 text-right">Hugging Face</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 bg-white">
                      {HUGGINGFACE_MODEL_GUIDE.map((model) => (
                        <tr key={model.name} className="hover:bg-zinc-50/80">
                          <td className="px-3 py-2.5">
                            <div className="font-semibold text-zinc-900">
                              {model.name}
                              {model.recommended && (
                                <span className="ml-1.5 text-xs font-medium text-sky-700">
                                  · Recommended
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-zinc-500">{model.bestFor}</div>
                          </td>
                          <td className="px-3 py-2 font-mono tabular-nums text-zinc-700 whitespace-nowrap">
                            {model.size}
                          </td>
                          <td className="px-3 py-2 font-mono tabular-nums text-zinc-700 whitespace-nowrap">
                            {model.ram}
                          </td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            <a
                              href={model.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 font-semibold text-sky-700 hover:underline"
                            >
                              Open Repo
                              <ExternalLink className="h-3 w-3 shrink-0" />
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Step 2: Files and versions */}
              <div className="space-y-1 border-b border-zinc-200 pb-4">
                <h3 className="text-sm font-semibold text-zinc-900">
                  02. Download a Quantized <code className="font-mono text-xs text-sky-700">.gguf</code> File
                </h3>
                <p className="text-xs text-zinc-600 leading-relaxed">
                  On the Hugging Face repository page, click the <strong className="text-zinc-900">Files and versions</strong> tab and click the download icon next to a <code className="font-mono text-zinc-800">Q4_K_M.gguf</code> file (for example, <code className="font-mono text-zinc-800">Qwen3-4B-Q4_K_M.gguf</code>). <code className="font-mono text-zinc-800">Q4_K_M</code> gives the best balance of speed, memory usage, and accuracy.
                </p>
              </div>

              {/* Step 3: Place in models/ or browse */}
              <div className="space-y-2 border-b border-zinc-200 pb-4">
                <h3 className="text-sm font-semibold text-zinc-900">
                  03. Place the File in Your <code className="font-mono text-xs text-sky-700">models/</code> Folder (or Browse)
                </h3>
                <p className="text-xs text-zinc-600 leading-relaxed">
                  Move the downloaded <code className="font-mono text-zinc-800">.gguf</code> file into your Umbras Pass <code className="font-mono text-zinc-800">models/</code> folder, or keep it anywhere on your drive and select it inside <strong className="text-zinc-900">Open AI Model Settings</strong>.
                </p>
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <FolderOpen className="h-3.5 w-3.5 text-sky-700 shrink-0" />
                    <code className="truncate font-mono text-xs text-zinc-800">
                      {modelsFolderLabel}
                    </code>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleCopyModelsPath()}
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    {copiedModelsPath ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-700" />
                        Copied Path
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        Copy Path
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Step 4: Activate */}
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-zinc-900">
                  04. Detect &amp; Activate Automatically
                </h3>
                <p className="text-xs text-zinc-600 leading-relaxed">
                  Umbras Pass scans your <code className="font-mono text-zinc-800">models/</code> folder automatically on launch, or you can click <strong className="text-zinc-900">Open AI Model Settings</strong> below to browse for any <code className="font-mono text-zinc-800">.gguf</code> file right away. You can re-open this welcome guide anytime from <strong className="text-zinc-900">Settings → Welcome &amp; Hugging Face Setup Guide</strong>.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 bg-zinc-50 px-6 py-4">
          <label className="inline-flex min-h-[36px] items-center gap-2.5 text-xs sm:text-sm text-zinc-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dontShowOnStartup}
              onChange={(e) => setDontShowOnStartup(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-300 text-sky-700 focus:ring-sky-600 cursor-pointer"
            />
            <span>Don&apos;t show this welcome screen at startup</span>
          </label>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                setStartupWelcomeDisabled(dontShowOnStartup);
                setAutoOpen(false);
                onCloseForceOpen?.();
                onOpenAiSettings();
              }}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 py-2 text-xs sm:text-sm font-semibold text-zinc-700 hover:bg-zinc-50 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Settings className="h-4 w-4 text-sky-700 shrink-0" />
              Open AI Model Settings
            </button>

            <button
              type="button"
              onClick={handleClose}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-sky-700 px-5 py-2 text-xs sm:text-sm font-semibold text-white hover:bg-sky-800 cursor-pointer whitespace-nowrap shrink-0"
            >
              {isInstalledNow ? 'Start Using Umbras Pass' : 'Continue to Umbras Pass'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
