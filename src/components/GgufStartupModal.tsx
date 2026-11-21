import React, { useCallback, useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Cpu,
  Download,
  ExternalLink,
  FileCode2,
  Loader2,
  Settings,
  Square,
  Terminal,
  X,
} from 'lucide-react';
import { copyTextToClipboard } from '../utils/clipboard';

const STARTUP_SEEN_KEY = 'umbras_gguf_onboarding_seen_v1';

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
  onOpenAiSettings: () => void;
}

export function hasSeenGgufStartupGuide(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(STARTUP_SEEN_KEY) === '1';
  } catch {
    return true;
  }
}

export function markGgufStartupGuideSeen(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STARTUP_SEEN_KEY, '1');
  } catch {
    // Ignore storage errors
  }
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
  onOpenAiSettings,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [aiStatus, setAiStatus] = useState<StartupAiStatus | null>(null);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [downloadedScriptNotice, setDownloadedScriptNotice] = useState(false);

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

  // One-time startup check for brand-new users (skips automatically if seen or a .gguf is already installed)
  useEffect(() => {
    if (hasSeenGgufStartupGuide()) return;
    let cancelled = false;

    void fetchStatus().then((status) => {
      if (cancelled) return;
      const alreadyHasModel =
        Boolean(status?.activeModelPath) ||
        Boolean(status?.catalog?.some((m) => m.isInstalled));
      if (alreadyHasModel) {
        markGgufStartupGuideSeen();
        return;
      }
      setIsOpen(true);
    });

    return () => {
      cancelled = true;
    };
  }, [fetchStatus]);

  // Poll progress while downloading inside the startup screen
  useEffect(() => {
    if (!isOpen) return;
    if (aiStatus?.activeDownload?.status !== 'downloading') return;
    const timer = window.setInterval(() => {
      void fetchStatus();
    }, 800);
    return () => window.clearInterval(timer);
  }, [isOpen, aiStatus?.activeDownload?.status, fetchStatus]);

  const handleDismissForever = useCallback(() => {
    markGgufStartupGuideSeen();
    setIsOpen(false);
  }, []);

  // Keyboard Escape dismiss
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleDismissForever();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, handleDismissForever]);

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
          : 'Auto-download could not connect to the local backend. Use the automated script below instead.'
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleDismissForever();
      }}
    >
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-6 py-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-semibold text-sky-700">
              <Cpu className="h-3.5 w-3.5 shrink-0" />
              <span>One-Time First-Launch Setup</span>
              <span className="text-zinc-300" aria-hidden="true">·</span>
              <span className="text-zinc-500 font-normal">Local GGUF AI Engine</span>
            </div>
            <h2
              id="gguf-startup-title"
              className="font-display text-lg font-bold text-zinc-900"
            >
              Welcome to Umbras Pass — Download Your Local `.gguf` AI Model
            </h2>
          </div>
          <button
            type="button"
            onClick={handleDismissForever}
            aria-label="Close first-time setup guide"
            className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 text-sm text-zinc-700">
          <p className="leading-relaxed text-zinc-600">
            Umbras Pass runs AI deck analysis and adaptive bot playtesting <strong className="text-zinc-900">100% locally</strong> using a free Hugging Face <code className="font-mono text-xs text-sky-700">.gguf</code> model file—no cloud API key or subscription required. You only need to download it once.
          </p>

          {/* Option 1: Built-in 1-Click Automated Downloader */}
          <div className="rounded-xl border border-sky-200 bg-sky-50/50 p-4 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs font-bold text-zinc-900">
                  <Download className="h-4 w-4 text-sky-700 shrink-0" />
                  <span>Option 1: One-Click In-App Auto-Download (Easiest)</span>
                </div>
                <p className="text-xs text-zinc-600">
                  Recommended for your system:{' '}
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
                  className="inline-flex items-center gap-1.5 rounded-lg bg-sky-700 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-800 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                >
                  {downloadBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                  Auto-Download .gguf Now
                </button>
              )}
            </div>

            {isDownloading && aiStatus?.activeDownload && (
              <div className="space-y-2 border-t border-sky-200/70 pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-mono font-semibold text-zinc-900 truncate">
                    Downloading {aiStatus.activeDownload.fileName}...
                  </span>
                  <div className="flex items-center gap-2.5 font-mono text-[11px] tabular-nums text-zinc-600">
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
                      className="inline-flex items-center gap-1 rounded border border-red-300 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700 hover:bg-red-100 cursor-pointer"
                    >
                      <Square className="h-2.5 w-2.5" />
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

            {isInstalledNow && (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
                <Check className="h-4 w-4 shrink-0" />
                <span>Local .gguf model installed and ready! You can start analyzing decks now.</span>
              </div>
            )}

            {downloadError && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {downloadError}
              </div>
            )}
          </div>

          {/* Option 2: Automated Setup Script */}
          <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-4 space-y-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-bold text-zinc-900">
                <Terminal className="h-4 w-4 text-sky-700 shrink-0" />
                <span>Option 2: Automated Setup Script (Handles Everything)</span>
              </div>
              <p className="text-xs leading-relaxed text-zinc-600">
                Our automated setup script installs npm &amp; Vite dependencies (if running from source), creates the <code className="font-mono text-zinc-800">models/</code> folder, and downloads <code className="font-mono text-zinc-800">Qwen3-4B-Q4_K_M.gguf</code> automatically.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2">
              <code className="font-mono text-xs text-sky-700">npm run setup:gguf</code>
              <button
                type="button"
                onClick={() => void handleCopyCommand()}
                className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-50 cursor-pointer whitespace-nowrap shrink-0"
              >
                {copiedCmd ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-700" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    Copy Command
                  </>
                )}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={handleDownloadWindowsScript}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 cursor-pointer whitespace-nowrap shrink-0"
              >
                <FileCode2 className="h-3.5 w-3.5 text-sky-700 shrink-0" />
                Download Windows Auto-Setup Script (setup-gguf.bat)
              </button>

              <a
                href="https://huggingface.co/unsloth/Qwen3-4B-GGUF"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:underline whitespace-nowrap"
              >
                Direct Hugging Face Download
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>

            {downloadedScriptNotice && (
              <p className="text-[11px] font-medium text-emerald-700">
                Saved <code>setup-gguf.bat</code> — place it in your Umbras Pass folder and double-click to run.
              </p>
            )}
          </div>

          <div className="text-xs text-zinc-500">
            Already have a <code className="font-mono text-zinc-700">.gguf</code> file on your PC, or want a smaller/larger model tier (<code className="font-mono">1.7B</code>, <code className="font-mono">8B</code>, <code className="font-mono">27B</code>)? Click <strong className="text-zinc-800">Open AI Model Settings</strong> below anytime.
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 bg-zinc-50 px-6 py-3.5">
          <button
            type="button"
            onClick={() => {
              markGgufStartupGuideSeen();
              setIsOpen(false);
              onOpenAiSettings();
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3.5 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Settings className="h-3.5 w-3.5 text-sky-700 shrink-0" />
            Open AI Model Settings
          </button>

          <button
            type="button"
            onClick={handleDismissForever}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-700 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-800 cursor-pointer whitespace-nowrap shrink-0"
          >
            {isInstalledNow ? 'Start Using Umbras Pass' : "Skip for Now (Don't Show Again)"}
          </button>
        </div>
      </div>
    </div>
  );
};
