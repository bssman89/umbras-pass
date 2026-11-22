import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  Bell,
  BellOff,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  History,
  Play,
  Power,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Terminal,
  X,
} from 'lucide-react';

export const UPDATE_NOTIFY_PREF_EVENT = 'umbras:update-notify-pref-changed';
const UPDATE_NOTIFY_STORAGE_KEY = 'umbras_github_updates_enabled_v1';
const UPDATE_DISMISSED_TAG_KEY = 'umbras_github_updates_dismissed_tag_v1';
const TRUSTED_REPO_PREFIX = 'https://github.com/bssman89/umbras-pass/';
const TRUSTED_REPO_URL = 'https://github.com/bssman89/umbras-pass';

export interface ReleaseAssetInfo {
  name: string;
  sizeBytes: number;
  downloadUrl: string;
  isInstaller: boolean;
  isPortable: boolean;
}

export interface GitHubReleaseEntry {
  id: number;
  tag: string;
  version: string;
  name: string;
  body: string;
  publishedAt: string;
  prerelease: boolean;
  htmlUrl: string;
  zipballUrl: string;
  primaryAsset: ReleaseAssetInfo | null;
  assets: ReleaseAssetInfo[];
  relation: 'newer' | 'current' | 'older';
  isDownloadedLocally: boolean;
  localFilePath: string | null;
  localFileName: string | null;
}

export interface UpdateDownloadState {
  status: 'idle' | 'downloading' | 'completed' | 'cancelled' | 'error';
  tag: string | null;
  fileName: string | null;
  localFilePath: string | null;
  downloadedBytes: number;
  totalBytes: number;
  speedBytesPerSec: number;
  progressPct: number;
  error?: string;
}

export interface UpdateCheckResponse {
  currentVersion: string;
  isDesktop: boolean;
  repoUrl: string;
  updatesDir: string;
  checkedAt: string;
  updateAvailable: boolean;
  latestRelease: GitHubReleaseEntry | null;
  releases: GitHubReleaseEntry[];
  activeDownload: UpdateDownloadState;
  error?: string;
}

export function isGitHubUpdateNotifyEnabled(): boolean {
  try {
    const raw = window.localStorage.getItem(UPDATE_NOTIFY_STORAGE_KEY);
    if (raw === null) return true;
    return raw !== 'false';
  } catch {
    return true;
  }
}

export function setGitHubUpdateNotifyEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(UPDATE_NOTIFY_STORAGE_KEY, enabled ? 'true' : 'false');
    window.dispatchEvent(new CustomEvent(UPDATE_NOTIFY_PREF_EVENT, { detail: { enabled } }));
  } catch {
    // Ignore storage unavailability
  }
}

export function getDismissedUpdateTag(): string | null {
  try {
    return window.localStorage.getItem(UPDATE_DISMISSED_TAG_KEY);
  } catch {
    return null;
  }
}

export function setDismissedUpdateTag(tag: string | null): void {
  try {
    if (tag) {
      window.localStorage.setItem(UPDATE_DISMISSED_TAG_KEY, tag);
    } else {
      window.localStorage.removeItem(UPDATE_DISMISSED_TAG_KEY);
    }
  } catch {
    // Ignore storage unavailability
  }
}

function isSafeGitHubRepoUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return url === TRUSTED_REPO_URL || url.startsWith(TRUSTED_REPO_PREFIX);
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 100 || unitIndex === 0 ? Math.round(value) : value.toFixed(1)} ${units[unitIndex]}`;
}

function formatReleaseDate(iso: string): string {
  if (!iso) return 'Unknown date';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

interface UpdateNotificationBannerProps {
  onOpenUpdatesModal: () => void;
  onUpdateAvailabilityChange?: (hasUpdate: boolean) => void;
}

export const UpdateNotificationBanner: React.FC<UpdateNotificationBannerProps> = ({
  onOpenUpdatesModal,
  onUpdateAvailabilityChange,
}) => {
  const [notifyEnabled, setNotifyEnabled] = useState<boolean>(() =>
    isGitHubUpdateNotifyEnabled()
  );
  const [dismissedTag, setDismissedTag] = useState<string | null>(() =>
    getDismissedUpdateTag()
  );
  const [updateInfo, setUpdateInfo] = useState<{
    currentVersion: string;
    latestRelease: GitHubReleaseEntry;
  } | null>(null);

  useEffect(() => {
    const syncPref = () => {
      setNotifyEnabled(isGitHubUpdateNotifyEnabled());
    };
    window.addEventListener(UPDATE_NOTIFY_PREF_EVENT, syncPref);
    window.addEventListener('storage', syncPref);
    return () => {
      window.removeEventListener(UPDATE_NOTIFY_PREF_EVENT, syncPref);
      window.removeEventListener('storage', syncPref);
    };
  }, []);

  useEffect(() => {
    if (!notifyEnabled) {
      onUpdateAvailabilityChange?.(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch('/api/updates/check');
          if (!res.ok || cancelled) return;
          const data = (await res.json()) as UpdateCheckResponse;
          if (cancelled) return;
          if (data.updateAvailable && data.latestRelease) {
            setUpdateInfo({
              currentVersion: data.currentVersion,
              latestRelease: data.latestRelease,
            });
            onUpdateAvailabilityChange?.(true);
          } else {
            setUpdateInfo(null);
            onUpdateAvailabilityChange?.(false);
          }
        } catch {
          // Stay silent if offline or backend is unavailable
        }
      })();
    }, 1200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [notifyEnabled, onUpdateAvailabilityChange]);

  if (
    !notifyEnabled ||
    !updateInfo ||
    dismissedTag === updateInfo.latestRelease.tag
  ) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="border-b border-sky-200 bg-sky-50/95 text-zinc-900"
    >
      <div className="mx-auto flex max-w-[1360px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 sm:px-6 py-2 text-xs">
        <div className="flex items-center gap-2.5 min-w-0">
          <ArrowDownToLine className="h-4 w-4 text-sky-700 shrink-0" />
          <p className="text-zinc-800 leading-snug">
            <span className="font-semibold text-zinc-900">
              Umbras Pass v{updateInfo.latestRelease.version} is available on GitHub
            </span>
            <span className="mx-1.5 text-zinc-400">·</span>
            <span className="text-zinc-600 tabular-nums">
              Installed v{updateInfo.currentVersion}
            </span>
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onOpenUpdatesModal}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-800 cursor-pointer whitespace-nowrap transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Download Update</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setGitHubUpdateNotifyEnabled(false);
              setNotifyEnabled(false);
            }}
            className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 cursor-pointer whitespace-nowrap transition-colors"
          >
            Turn Off Alerts
          </button>
          <button
            type="button"
            aria-label="Dismiss update notification for this version"
            onClick={() => {
              setDismissedUpdateTag(updateInfo.latestRelease.tag);
              setDismissedTag(updateInfo.latestRelease.tag);
            }}
            className="rounded-lg p-1 text-zinc-500 hover:bg-sky-100 hover:text-zinc-900 cursor-pointer transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

interface UpdatesRollbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRequestExitForInstall?: () => void;
}

export const UpdatesRollbackModal: React.FC<UpdatesRollbackModalProps> = ({
  isOpen,
  onClose,
  onRequestExitForInstall,
}) => {
  const [activeTab, setActiveTab] = useState<'latest' | 'history'>('latest');
  const [notifyEnabled, setNotifyEnabled] = useState<boolean>(() =>
    isGitHubUpdateNotifyEnabled()
  );
  const [data, setData] = useState<UpdateCheckResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [downloadState, setDownloadState] = useState<UpdateDownloadState | null>(null);
  const [expandedNotesTag, setExpandedNotesTag] = useState<string | null>(null);
  const [pendingRollbackTag, setPendingRollbackTag] = useState<string | null>(null);
  const [launchingPath, setLaunchingPath] = useState<string | null>(null);
  const [launcherFeedback, setLauncherFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
    launchedInstaller?: boolean;
  } | null>(null);
  const [copiedGitTag, setCopiedGitTag] = useState<string | null>(null);
  const pollTimerRef = useRef<number | null>(null);

  const isDesktopRuntime =
    (typeof window !== 'undefined' && Boolean(window.desktopApp?.isDesktop)) ||
    Boolean(data?.isDesktop);

  const loadUpdates = useCallback(async (forceRefresh = false) => {
    setIsLoading(true);
    setFetchError(null);
    try {
      const url = forceRefresh ? '/api/updates/check?force=1' : '/api/updates/check';
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Update check failed (HTTP ${res.status}).`);
      }
      const payload = (await res.json()) as UpdateCheckResponse;
      setData(payload);
      if (payload.activeDownload) {
        setDownloadState(payload.activeDownload);
      }
    } catch (err) {
      setFetchError(
        err instanceof Error
          ? err.message
          : 'Could not check GitHub Releases right now.'
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const syncPref = () => {
      setNotifyEnabled(isGitHubUpdateNotifyEnabled());
    };
    window.addEventListener(UPDATE_NOTIFY_PREF_EVENT, syncPref);
    window.addEventListener('storage', syncPref);
    return () => {
      window.removeEventListener(UPDATE_NOTIFY_PREF_EVENT, syncPref);
      window.removeEventListener('storage', syncPref);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setLauncherFeedback(null);
    setPendingRollbackTag(null);
    void loadUpdates(false);
  }, [isOpen, loadUpdates]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || downloadState?.status !== 'downloading') {
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }

    pollTimerRef.current = window.setInterval(() => {
      void (async () => {
        try {
          const res = await fetch('/api/updates/download-status');
          if (!res.ok) return;
          const nextState = (await res.json()) as UpdateDownloadState;
          setDownloadState(nextState);
          if (nextState.status !== 'downloading') {
            if (pollTimerRef.current !== null) {
              window.clearInterval(pollTimerRef.current);
              pollTimerRef.current = null;
            }
            if (nextState.status === 'completed') {
              void loadUpdates(false);
            }
          }
        } catch {
          // Ignore transient polling hiccups
        }
      })();
    }, 500);

    return () => {
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [isOpen, downloadState?.status, loadUpdates]);

  if (!isOpen) return null;

  const handleToggleNotify = () => {
    const next = !notifyEnabled;
    setGitHubUpdateNotifyEnabled(next);
    setNotifyEnabled(next);
    if (next) {
      setDismissedUpdateTag(null);
    }
  };

  const handleStartDesktopDownload = async (release: GitHubReleaseEntry) => {
    setLauncherFeedback(null);
    setPendingRollbackTag(null);
    try {
      const res = await fetch('/api/updates/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tag: release.tag,
          assetName: release.primaryAsset?.name,
        }),
      });
      const payload = (await res.json()) as UpdateDownloadState & { error?: string };
      if (!res.ok) {
        throw new Error(payload.error || 'Could not start release download.');
      }
      setDownloadState(payload);
      if (payload.status === 'completed') {
        void loadUpdates(false);
      }
    } catch (err) {
      setLauncherFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Download failed to start.',
      });
    }
  };

  const handleCancelDownload = async () => {
    try {
      const res = await fetch('/api/updates/cancel', { method: 'POST' });
      if (res.ok) {
        const nextState = (await res.json()) as UpdateDownloadState;
        setDownloadState(nextState);
      }
    } catch {
      // Ignore cancel errors
    }
  };

  const handleLaunchInstaller = async (localFilePath: string, versionLabel: string) => {
    if (!window.desktopApp?.launchUpdateInstaller) {
      setLauncherFeedback({
        type: 'error',
        message:
          'Direct installer launch is available inside the Windows desktop app. Open your downloads folder to run the installer manually.',
      });
      return;
    }

    setLaunchingPath(localFilePath);
    setLauncherFeedback(null);
    try {
      const result = await window.desktopApp.launchUpdateInstaller(localFilePath);
      if (result.ok) {
        setPendingRollbackTag(null);
        setLauncherFeedback({
          type: 'success',
          launchedInstaller: true,
          message: `Installer for v${versionLabel} launched. Close Umbras Pass so the setup wizard can update or restore the program files cleanly.`,
        });
      } else {
        setLauncherFeedback({
          type: 'error',
          message: result.error || 'Could not launch the installer file.',
        });
      }
    } catch {
      setLauncherFeedback({
        type: 'error',
        message: 'Could not launch the installer file.',
      });
    } finally {
      setLaunchingPath(null);
    }
  };

  const handleOpenUpdatesFolder = async () => {
    if (!window.desktopApp?.openUpdatesFolder) return;
    try {
      await window.desktopApp.openUpdatesFolder();
    } catch {
      // Ignore folder open errors
    }
  };

  const handleCopyGitCheckout = (tag: string) => {
    const safeTag = tag.replace(/[^A-Za-z0-9._-]/g, '');
    const command = `git fetch --tags && git checkout ${safeTag}`;
    try {
      void navigator.clipboard.writeText(command);
      setCopiedGitTag(tag);
      window.setTimeout(() => setCopiedGitTag(null), 2000);
    } catch {
      // Ignore clipboard unavailability
    }
  };

  const releases = data?.releases || [];
  const latestRelease = data?.latestRelease || null;
  const currentVersion = data?.currentVersion || '1.0.0';
  const olderReleasesCount = releases.filter((r) => r.relation === 'older').length;
  const repoReleasesUrl = `${TRUSTED_REPO_URL}/releases`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="updates-rollback-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-6 py-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-sky-200 bg-sky-50 text-sky-700">
              <History className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2
                id="updates-rollback-modal-title"
                className="font-display text-lg font-bold tracking-tight text-zinc-900"
              >
                Updates &amp; Version Rollback
              </h2>
              <p className="mt-0.5 text-xs text-zinc-600 tabular-nums">
                Installed version <strong className="font-semibold text-zinc-900">v{currentVersion}</strong>
                <span className="mx-1.5 text-zinc-300">·</span>
                <span>GitHub Releases (bssman89/umbras-pass)</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={isLoading}
              onClick={() => void loadUpdates(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 cursor-pointer whitespace-nowrap transition-colors"
            >
              <RefreshCw className={`h-3.5 w-3.5 text-sky-700 ${isLoading ? 'animate-spin' : ''}`} />
              <span>{isLoading ? 'Checking...' : 'Check Now'}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Updates and Version Rollback"
              className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 cursor-pointer transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Notification Toggle Strip */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 bg-zinc-50 px-6 py-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {notifyEnabled ? (
              <Bell className="h-4 w-4 text-sky-700 shrink-0" />
            ) : (
              <BellOff className="h-4 w-4 text-zinc-400 shrink-0" />
            )}
            <div className="min-w-0">
              <div className="text-xs font-semibold text-zinc-900">
                Notify me when a GitHub update is available
              </div>
              <div className="text-[11px] text-zinc-600">
                {notifyEnabled
                  ? 'Quietly checks GitHub Releases on launch and alerts you when a newer version is posted.'
                  : 'Automatic update alerts are off. You can still check manually or roll back versions anytime.'}
              </div>
            </div>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={notifyEnabled}
            aria-label="Toggle GitHub update notifications"
            onClick={handleToggleNotify}
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
              notifyEnabled ? 'bg-sky-700' : 'bg-zinc-300'
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                notifyEnabled ? 'translate-x-4.5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>

        {/* Clean Hairline Tabs */}
        <div className="flex items-center gap-6 border-b border-zinc-200 px-6 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setActiveTab('latest')}
            className={`inline-flex items-center gap-1.5 border-b-2 py-3 whitespace-nowrap cursor-pointer transition-colors ${
              activeTab === 'latest'
                ? 'border-sky-700 text-zinc-900'
                : 'border-transparent text-zinc-500 hover:text-zinc-800'
            }`}
          >
            <ArrowDownToLine className="h-3.5 w-3.5" />
            <span>Latest Update</span>
            {data?.updateAvailable && (
              <span className="ml-1 inline-block h-2 w-2 rounded-full bg-sky-600" aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`inline-flex items-center gap-1.5 border-b-2 py-3 whitespace-nowrap cursor-pointer transition-colors tabular-nums ${
              activeTab === 'history'
                ? 'border-sky-700 text-zinc-900'
                : 'border-transparent text-zinc-500 hover:text-zinc-800'
            }`}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Version History &amp; Rollback ({releases.length})</span>
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Active Download Progress / Completion Panel */}
          {downloadState && downloadState.status !== 'idle' && (
            <div
              className={`rounded-xl border p-4 space-y-3 ${
                downloadState.status === 'error'
                  ? 'border-red-200 bg-red-50'
                  : downloadState.status === 'completed'
                  ? 'border-emerald-200 bg-emerald-50'
                  : 'border-sky-200 bg-sky-50'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-zinc-900">
                    {downloadState.status === 'downloading' &&
                      `Downloading ${downloadState.fileName || downloadState.tag}...`}
                    {downloadState.status === 'completed' &&
                      `Downloaded ${downloadState.fileName || downloadState.tag} — ready to run`}
                    {downloadState.status === 'cancelled' &&
                      `Download cancelled (${downloadState.fileName || downloadState.tag})`}
                    {downloadState.status === 'error' && 'Download failed'}
                  </div>
                  <div className="mt-0.5 text-[11px] text-zinc-600 tabular-nums">
                    {downloadState.status === 'downloading' && (
                      <>
                        {formatBytes(downloadState.downloadedBytes)}
                        {downloadState.totalBytes > 0
                          ? ` / ${formatBytes(downloadState.totalBytes)}`
                          : ''}
                        {downloadState.speedBytesPerSec > 0
                          ? ` · ${formatBytes(downloadState.speedBytesPerSec)}/s`
                          : ''}
                      </>
                    )}
                    {downloadState.status === 'completed' && downloadState.localFilePath && (
                      <span>Saved locally for installation or future rollback</span>
                    )}
                    {downloadState.status === 'error' && (
                      <span className="text-red-700">{downloadState.error}</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {downloadState.status === 'downloading' && (
                    <button
                      type="button"
                      onClick={() => void handleCancelDownload()}
                      className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 cursor-pointer"
                    >
                      Cancel
                    </button>
                  )}
                  {downloadState.status === 'completed' &&
                    downloadState.localFilePath &&
                    isDesktopRuntime && (
                      <button
                        type="button"
                        disabled={launchingPath === downloadState.localFilePath}
                        onClick={() =>
                          void handleLaunchInstaller(
                            downloadState.localFilePath!,
                            (downloadState.tag || '').replace(/^v/i, '') || 'selected'
                          )
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50 cursor-pointer whitespace-nowrap"
                      >
                        <Play className="h-3.5 w-3.5" />
                        <span>
                          {launchingPath === downloadState.localFilePath
                            ? 'Launching...'
                            : 'Launch Installer'}
                        </span>
                      </button>
                    )}
                </div>
              </div>

              {downloadState.status === 'downloading' && (
                <div className="h-2 w-full overflow-hidden rounded-full bg-sky-200/80">
                  <div
                    className="h-full rounded-full bg-sky-700 transition-all duration-300"
                    style={{
                      width: `${Math.max(4, Math.min(100, Math.round(downloadState.progressPct)))}%`,
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Installer Launch Feedback */}
          {launcherFeedback && (
            <div
              className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 text-xs ${
                launcherFeedback.type === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  : 'border-red-200 bg-red-50 text-red-900'
              }`}
            >
              <div className="flex items-start gap-2.5 min-w-0 flex-1">
                {launcherFeedback.type === 'success' ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-700 mt-0.5 shrink-0" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-red-700 mt-0.5 shrink-0" />
                )}
                <p className="leading-relaxed">{launcherFeedback.message}</p>
              </div>
              {launcherFeedback.launchedInstaller && onRequestExitForInstall && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onRequestExitForInstall();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-zinc-800 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Power className="h-3.5 w-3.5" />
                  <span>Close App for Setup</span>
                </button>
              )}
            </div>
          )}

          {/* Error Banner */}
          {(fetchError || data?.error) && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
              <div className="flex items-start gap-2.5 min-w-0 flex-1">
                <AlertTriangle className="h-4 w-4 text-amber-700 mt-0.5 shrink-0" />
                <p className="leading-relaxed">{fetchError || data?.error}</p>
              </div>
              <a
                href={repoReleasesUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-semibold text-amber-900 hover:bg-amber-100 whitespace-nowrap shrink-0"
              >
                <span>Open GitHub Releases</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          )}

          {/* Tab 1: Latest Update */}
          {activeTab === 'latest' && (
            <div className="space-y-4">
              {isLoading && !data ? (
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-6 text-center text-xs text-zinc-600">
                  Checking GitHub Releases for Umbras Pass...
                </div>
              ) : !latestRelease ? (
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-6 space-y-3 text-center">
                  <div className="text-sm font-semibold text-zinc-900">
                    No GitHub Releases published yet
                  </div>
                  <p className="mx-auto max-w-md text-xs text-zinc-600 leading-relaxed">
                    You are running <strong className="font-semibold text-zinc-900 tabular-nums">v{currentVersion}</strong>.
                    As soon as releases are published on GitHub, they will appear here for one-click downloading and version rollback.
                  </p>
                  <div className="pt-1">
                    <a
                      href={repoReleasesUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3.5 py-2 text-xs font-semibold text-zinc-800 hover:border-sky-600 hover:text-sky-700 transition-colors"
                    >
                      <span>View Repository Releases</span>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
                  <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-100 p-5">
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        {data?.updateAvailable ? (
                          <span className="font-semibold text-sky-700">
                            New Update Available
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span>You are up to date</span>
                          </span>
                        )}
                        <span className="text-zinc-300">·</span>
                        <span className="text-zinc-500 tabular-nums">
                          Released {formatReleaseDate(latestRelease.publishedAt)}
                        </span>
                      </div>
                      <h3 className="text-base font-bold text-zinc-900 tabular-nums">
                        {latestRelease.name} ({latestRelease.tag})
                      </h3>
                      {latestRelease.primaryAsset && (
                        <p className="text-xs text-zinc-600 tabular-nums">
                          Installer: <span className="font-mono text-zinc-800">{latestRelease.primaryAsset.name}</span>{' '}
                          ({formatBytes(latestRelease.primaryAsset.sizeBytes)})
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {isDesktopRuntime ? (
                        latestRelease.isDownloadedLocally && latestRelease.localFilePath ? (
                          <>
                            <button
                              type="button"
                              disabled={launchingPath === latestRelease.localFilePath}
                              onClick={() =>
                                void handleLaunchInstaller(
                                  latestRelease.localFilePath!,
                                  latestRelease.version
                                )
                              }
                              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-700 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-800 disabled:opacity-50 cursor-pointer whitespace-nowrap transition-colors"
                            >
                              <Play className="h-3.5 w-3.5" />
                              <span>
                                {data?.updateAvailable ? 'Install Update' : 'Run Installer'}
                              </span>
                            </button>
                            {latestRelease.primaryAsset && (
                              <button
                                type="button"
                                disabled={downloadState?.status === 'downloading'}
                                onClick={() => void handleStartDesktopDownload(latestRelease)}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 cursor-pointer whitespace-nowrap"
                              >
                                <Download className="h-3.5 w-3.5" />
                                <span>Re-download</span>
                              </button>
                            )}
                          </>
                        ) : latestRelease.primaryAsset ? (
                          <button
                            type="button"
                            disabled={downloadState?.status === 'downloading'}
                            onClick={() => void handleStartDesktopDownload(latestRelease)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-700 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-800 disabled:opacity-50 cursor-pointer whitespace-nowrap transition-colors"
                          >
                            <Download className="h-3.5 w-3.5" />
                            <span>
                              {data?.updateAvailable
                                ? `Download v${latestRelease.version}`
                                : `Download Installer`}
                            </span>
                          </button>
                        ) : null
                      ) : latestRelease.primaryAsset &&
                        isSafeGitHubRepoUrl(latestRelease.primaryAsset.downloadUrl) ? (
                        <a
                          href={latestRelease.primaryAsset.downloadUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg bg-sky-700 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-800 whitespace-nowrap transition-colors"
                        >
                          <Download className="h-3.5 w-3.5" />
                          <span>
                            {data?.updateAvailable
                              ? `Download v${latestRelease.version}`
                              : `Download Installer`}
                          </span>
                        </a>
                      ) : null}

                      {isSafeGitHubRepoUrl(latestRelease.htmlUrl) && (
                        <a
                          href={latestRelease.htmlUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 whitespace-nowrap transition-colors"
                        >
                          <span>Release Notes</span>
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Plain-text release notes */}
                  <div className="bg-zinc-50/70 p-5">
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                      What&apos;s in {latestRelease.tag}
                    </div>
                    <div className="max-h-52 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-zinc-700 font-sans">
                      {latestRelease.body.trim() || 'No release notes were provided for this release.'}
                    </div>
                  </div>
                </div>
              )}

              {/* Rollback Callout */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                <div className="flex items-start gap-2.5 min-w-0 flex-1">
                  <ShieldCheck className="h-4 w-4 text-emerald-700 mt-0.5 shrink-0" />
                  <div className="text-xs text-zinc-700 leading-relaxed">
                    <strong className="font-semibold text-zinc-900">
                      Don&apos;t like an update after installing it?
                    </strong>{' '}
                    You can restore Umbras Pass to any previous GitHub version at any time. Your saved decks, bot memory, and downloaded <code className="font-mono text-[11px]">.gguf</code> models are stored separately and remain untouched.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('history')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-800 hover:border-sky-600 hover:text-sky-700 cursor-pointer whitespace-nowrap shrink-0 transition-colors"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>
                    Browse {olderReleasesCount > 0 ? `${olderReleasesCount} Previous` : 'All'} Versions
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* Tab 2: Version History & Rollback */}
          {activeTab === 'history' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                <div className="flex items-start gap-2.5 min-w-0 flex-1">
                  <ShieldCheck className="h-4 w-4 text-emerald-700 mt-0.5 shrink-0" />
                  <div className="text-xs text-zinc-700 leading-relaxed">
                    <strong className="font-semibold text-zinc-900">
                      Safe Rollback Guarantee:
                    </strong>{' '}
                    Pick any release below to download or re-run its installer. Your saved decks, adaptive bot profiles, and local AI models stay safe in your user data directory.
                  </div>
                </div>

                {isDesktopRuntime && (
                  <button
                    type="button"
                    onClick={() => void handleOpenUpdatesFolder()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-100 cursor-pointer whitespace-nowrap shrink-0 transition-colors"
                  >
                    <FolderOpen className="h-3.5 w-3.5 text-sky-700" />
                    <span>Open Saved Installers</span>
                  </button>
                )}
              </div>

              {releases.length === 0 ? (
                <div className="rounded-xl border border-zinc-200 bg-white p-6 text-center text-xs text-zinc-600">
                  No releases found on GitHub yet. Check{' '}
                  <a
                    href={repoReleasesUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-sky-700 hover:underline"
                  >
                    github.com/bssman89/umbras-pass/releases
                  </a>{' '}
                  or click <strong className="font-semibold text-zinc-900">Check Now</strong> after publishing a tag.
                </div>
              ) : (
                <div className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white overflow-hidden">
                  {releases.map((rel) => {
                    const isNotesOpen = expandedNotesTag === rel.tag;
                    const isConfirmingRollback = pendingRollbackTag === rel.tag;
                    const isThisDownloading =
                      downloadState?.status === 'downloading' && downloadState.tag === rel.tag;

                    return (
                      <div key={rel.id} className="p-4 space-y-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="font-mono font-bold text-zinc-900 tabular-nums">
                                {rel.tag}
                              </span>
                              {rel.relation === 'current' && (
                                <span className="font-semibold text-emerald-700">
                                  Current Version
                                </span>
                              )}
                              {rel.relation === 'newer' && (
                                <span className="font-semibold text-sky-700">
                                  Newer Update
                                </span>
                              )}
                              {rel.relation === 'older' && (
                                <span className="font-medium text-zinc-500">
                                  Previous Version
                                </span>
                              )}
                              {rel.isDownloadedLocally && (
                                <>
                                  <span className="text-zinc-300">·</span>
                                  <span className="font-medium text-emerald-700">
                                    Cached Locally
                                  </span>
                                </>
                              )}
                            </div>

                            <div className="text-sm font-semibold text-zinc-900">
                              {rel.name}
                            </div>

                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-zinc-500 tabular-nums">
                              <span>{formatReleaseDate(rel.publishedAt)}</span>
                              {rel.primaryAsset && (
                                <>
                                  <span className="text-zinc-300">·</span>
                                  <span className="font-mono text-zinc-600">
                                    {rel.primaryAsset.name}
                                  </span>
                                  <span>({formatBytes(rel.primaryAsset.sizeBytes)})</span>
                                </>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            {isDesktopRuntime ? (
                              rel.isDownloadedLocally && rel.localFilePath ? (
                                <button
                                  type="button"
                                  disabled={launchingPath === rel.localFilePath}
                                  onClick={() => {
                                    if (rel.relation === 'older') {
                                      setPendingRollbackTag(rel.tag);
                                    } else {
                                      void handleLaunchInstaller(
                                        rel.localFilePath!,
                                        rel.version
                                      );
                                    }
                                  }}
                                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors ${
                                    rel.relation === 'older'
                                      ? 'border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
                                      : rel.relation === 'newer'
                                      ? 'bg-sky-700 text-white hover:bg-sky-800'
                                      : 'border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50'
                                  }`}
                                >
                                  {rel.relation === 'older' ? (
                                    <RotateCcw className="h-3.5 w-3.5" />
                                  ) : (
                                    <Play className="h-3.5 w-3.5" />
                                  )}
                                  <span>
                                    {rel.relation === 'older'
                                      ? `Restore v${rel.version}`
                                      : rel.relation === 'newer'
                                      ? `Install v${rel.version}`
                                      : 'Reinstall'}
                                  </span>
                                </button>
                              ) : rel.primaryAsset ? (
                                <button
                                  type="button"
                                  disabled={downloadState?.status === 'downloading'}
                                  onClick={() => void handleStartDesktopDownload(rel)}
                                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50 cursor-pointer whitespace-nowrap transition-colors ${
                                    rel.relation === 'older'
                                      ? 'border border-zinc-300 bg-white text-zinc-800 hover:border-sky-600 hover:text-sky-700'
                                      : rel.relation === 'newer'
                                      ? 'bg-sky-700 text-white hover:bg-sky-800'
                                      : 'border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50'
                                  }`}
                                >
                                  {rel.relation === 'older' ? (
                                    <RotateCcw className="h-3.5 w-3.5" />
                                  ) : (
                                    <Download className="h-3.5 w-3.5" />
                                  )}
                                  <span>
                                    {isThisDownloading
                                      ? 'Downloading...'
                                      : rel.relation === 'older'
                                      ? `Download & Restore`
                                      : rel.relation === 'newer'
                                      ? `Download v${rel.version}`
                                      : 'Download Copy'}
                                  </span>
                                </button>
                              ) : null
                            ) : rel.primaryAsset &&
                              isSafeGitHubRepoUrl(rel.primaryAsset.downloadUrl) ? (
                              <a
                                href={rel.primaryAsset.downloadUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                                  rel.relation === 'older'
                                    ? 'border border-zinc-300 bg-white text-zinc-800 hover:border-sky-600 hover:text-sky-700'
                                    : rel.relation === 'newer'
                                    ? 'bg-sky-700 text-white hover:bg-sky-800'
                                    : 'border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50'
                                }`}
                              >
                                {rel.relation === 'older' ? (
                                  <RotateCcw className="h-3.5 w-3.5" />
                                ) : (
                                  <Download className="h-3.5 w-3.5" />
                                )}
                                <span>
                                  {rel.relation === 'older'
                                    ? `Download v${rel.version}`
                                    : rel.relation === 'newer'
                                    ? `Download Update`
                                    : 'Download Installer'}
                                </span>
                              </a>
                            ) : null}

                            <button
                              type="button"
                              onClick={() => handleCopyGitCheckout(rel.tag)}
                              title={`Copy git checkout command for ${rel.tag}`}
                              className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-100 cursor-pointer whitespace-nowrap"
                            >
                              {copiedGitTag === rel.tag ? (
                                <>
                                  <Check className="h-3 w-3 text-emerald-700" />
                                  <span>Copied git cmd</span>
                                </>
                              ) : (
                                <>
                                  <Terminal className="h-3 w-3 text-zinc-500" />
                                  <span>Git checkout</span>
                                </>
                              )}
                            </button>

                            {isSafeGitHubRepoUrl(rel.htmlUrl) && (
                              <a
                                href={rel.htmlUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={`View ${rel.tag} on GitHub`}
                                className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-zinc-700 hover:border-sky-600 hover:text-sky-700 whitespace-nowrap"
                              >
                                <span>GitHub</span>
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                        </div>

                        {/* Inline Rollback Confirmation */}
                        {isConfirmingRollback && rel.localFilePath && (
                          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
                            <div className="min-w-0 flex-1 leading-relaxed">
                              Launch the cached installer for{' '}
                              <strong className="font-semibold tabular-nums">v{rel.version}</strong>?
                              This replaces the installed app version while keeping your saved decks, bot memory, and <code className="font-mono text-[11px]">.gguf</code> models intact.
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                type="button"
                                onClick={() => setPendingRollbackTag(null)}
                                className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 cursor-pointer"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                disabled={launchingPath === rel.localFilePath}
                                onClick={() =>
                                  void handleLaunchInstaller(rel.localFilePath!, rel.version)
                                }
                                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-800 disabled:opacity-50 cursor-pointer whitespace-nowrap"
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                                <span>
                                  {launchingPath === rel.localFilePath
                                    ? 'Launching...'
                                    : `Restore v${rel.version}`}
                                </span>
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Release Notes Toggle */}
                        {rel.body.trim().length > 0 && (
                          <div>
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedNotesTag(isNotesOpen ? null : rel.tag)
                              }
                              className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-700 hover:text-sky-800 cursor-pointer"
                            >
                              {isNotesOpen ? (
                                <>
                                  <ChevronUp className="h-3.5 w-3.5" />
                                  <span>Hide release notes</span>
                                </>
                              ) : (
                                <>
                                  <ChevronDown className="h-3.5 w-3.5" />
                                  <span>Show release notes</span>
                                </>
                              )}
                            </button>
                            {isNotesOpen && (
                              <div className="mt-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 whitespace-pre-wrap text-xs leading-relaxed text-zinc-700">
                                {rel.body.trim()}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Source-build tip */}
              {!isDesktopRuntime && (
                <div className="flex items-start gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3.5 text-[11px] text-zinc-600 leading-relaxed">
                  <Copy className="h-3.5 w-3.5 text-zinc-500 mt-0.5 shrink-0" />
                  <span>
                    Running from source instead of the Windows installer? Use any release&apos;s{' '}
                    <strong className="font-semibold text-zinc-800">Git checkout</strong> button above, then run{' '}
                    <code className="font-mono text-zinc-800">npm install &amp;&amp; npm run build</code> to switch versions cleanly.
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 bg-zinc-50 px-6 py-3 text-[11px] text-zinc-500">
          <span className="tabular-nums">
            {data?.checkedAt
              ? `Last checked ${new Date(data.checkedAt).toLocaleTimeString()}`
              : 'Ready to check GitHub Releases'}
          </span>
          <a
            href={repoReleasesUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-semibold text-sky-700 hover:underline"
          >
            <span>github.com/bssman89/umbras-pass/releases</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    </div>
  );
};
