import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { getDesktopDataDir, isDesktopEnvironment } from './desktopStorage.ts';

const __updaterFilename = fileURLToPath(import.meta.url);
const __updaterDirname = path.dirname(__updaterFilename);

export const GITHUB_REPO_OWNER = 'bssman89';
export const GITHUB_REPO_NAME = 'umbras-pass';
export const GITHUB_REPO_URL = `https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}`;
const GITHUB_RELEASES_API_URL = `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases?per_page=25`;
const CACHE_TTL_MS = 5 * 60 * 1000;

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

let cachedReleases: { fetchedAt: number; releases: RawNormalizedRelease[] } | null = null;
let activeAbortController: AbortController | null = null;
let activeDownloadState: UpdateDownloadState = {
  status: 'idle',
  tag: null,
  fileName: null,
  localFilePath: null,
  downloadedBytes: 0,
  totalBytes: 0,
  speedBytesPerSec: 0,
  progressPct: 0,
};

interface RawNormalizedRelease {
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
}

export function getUpdatesDirectory(): string {
  const dir = path.join(getDesktopDataDir(), 'updates');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getCurrentAppVersion(): string {
  const fromEnv = process.env.UMBRAS_APP_VERSION?.trim();
  if (fromEnv) return normalizeVersion(fromEnv);

  const candidates = [
    path.resolve(__updaterDirname, '..', 'package.json'),
    path.resolve(process.cwd(), 'package.json'),
  ];
  for (const pkgPath of candidates) {
    try {
      if (fs.existsSync(pkgPath)) {
        const parsed = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
        if (parsed?.version && typeof parsed.version === 'string') {
          return normalizeVersion(parsed.version);
        }
      }
    } catch {
      // Try next candidate
    }
  }
  return '1.0.0';
}

export function normalizeVersion(raw: string): string {
  const trimmed = String(raw || '').trim();
  const semverMatch = trimmed.match(/(\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?)/);
  if (semverMatch && semverMatch[1]) {
    const [core, pre] = semverMatch[1].split('-', 2);
    const nums = core.split('.');
    if (nums.length === 2) {
      return `${nums[0]}.${nums[1]}.0${pre ? `-${pre}` : ''}`;
    }
    return semverMatch[1];
  }
  const cleaned = trimmed.replace(/^v/i, '');
  return cleaned || '0.0.0';
}

export function compareSemver(aRaw: string, bRaw: string): number {
  const parse = (input: string) => {
    const clean = normalizeVersion(input);
    const [core, pre = ''] = clean.split('-', 2);
    const parts = core.split('.').map((n) => {
      const parsed = Number.parseInt(n, 10);
      return Number.isFinite(parsed) ? parsed : 0;
    });
    return {
      major: parts[0] || 0,
      minor: parts[1] || 0,
      patch: parts[2] || 0,
      pre,
    };
  };

  const a = parse(aRaw);
  const b = parse(bRaw);

  if (a.major !== b.major) return a.major > b.major ? 1 : -1;
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;

  if (!a.pre && b.pre) return 1;
  if (a.pre && !b.pre) return -1;
  if (a.pre === b.pre) return 0;
  return a.pre > b.pre ? 1 : -1;
}

function sanitizeSegment(raw: string): string {
  const base = path.basename(String(raw || '').trim());
  const safe = base.replace(/[^A-Za-z0-9._-]/g, '_');
  if (!safe || safe === '.' || safe === '..') {
    throw new Error('Invalid release identifier or file name.');
  }
  return safe;
}

function isTrustedGitHubUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (host === 'github.com') {
      return parsed.pathname
        .toLowerCase()
        .startsWith(`/${GITHUB_REPO_OWNER.toLowerCase()}/${GITHUB_REPO_NAME.toLowerCase()}/`);
    }
    if (host === 'api.github.com') {
      return parsed.pathname
        .toLowerCase()
        .startsWith(`/repos/${GITHUB_REPO_OWNER.toLowerCase()}/${GITHUB_REPO_NAME.toLowerCase()}/`);
    }
    if (host === 'objects.githubusercontent.com' || host === 'release-assets.githubusercontent.com') {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function resolveConfinedUpdatePath(tag: string, fileName: string): string {
  const baseDir = path.resolve(getUpdatesDirectory());
  const safeTag = sanitizeSegment(tag);
  const safeFile = sanitizeSegment(fileName);
  const tagDir = path.resolve(baseDir, safeTag);
  if (!tagDir.startsWith(baseDir + path.sep)) {
    throw new Error('Invalid update directory path.');
  }
  const targetPath = path.resolve(tagDir, safeFile);
  if (!targetPath.startsWith(tagDir + path.sep)) {
    throw new Error('Invalid update file path.');
  }
  return targetPath;
}

function findLocalCachedInstaller(tag: string): { filePath: string; fileName: string } | null {
  try {
    const baseDir = path.resolve(getUpdatesDirectory());
    const safeTag = sanitizeSegment(tag);
    const tagDir = path.resolve(baseDir, safeTag);
    if (!tagDir.startsWith(baseDir + path.sep) || !fs.existsSync(tagDir)) {
      return null;
    }
    const files = fs
      .readdirSync(tagDir)
      .filter((f) => f.toLowerCase().endsWith('.exe') && !f.endsWith('.partial'));
    if (files.length === 0) return null;

    // Prefer Setup installer over Portable if both exist
    const preferred =
      files.find((f) => /setup/i.test(f)) ||
      files.find((f) => /portable/i.test(f)) ||
      files[0];

    const fullPath = path.resolve(tagDir, preferred);
    if (!fullPath.startsWith(tagDir + path.sep)) return null;
    return { filePath: fullPath, fileName: preferred };
  } catch {
    return null;
  }
}

function pickPrimaryAsset(assets: ReleaseAssetInfo[]): ReleaseAssetInfo | null {
  if (assets.length === 0) return null;
  return (
    assets.find((a) => a.isInstaller) ||
    assets.find((a) => a.isPortable) ||
    assets.find((a) => a.name.toLowerCase().endsWith('.exe')) ||
    assets[0]
  );
}

async function loadRawGitHubReleases(forceRefresh = false): Promise<{
  releases: RawNormalizedRelease[];
  error?: string;
}> {
  const now = Date.now();
  if (!forceRefresh && cachedReleases && now - cachedReleases.fetchedAt < CACHE_TTL_MS) {
    return { releases: cachedReleases.releases };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const res = await fetch(GITHUB_RELEASES_API_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Umbras-Pass-Updater/1.0',
      },
      signal: controller.signal,
    });

    if (res.status === 404) {
      cachedReleases = { fetchedAt: now, releases: [] };
      return { releases: [] };
    }

    if (!res.ok) {
      const rateRemaining = res.headers.get('x-ratelimit-remaining');
      const hint =
        res.status === 403 && rateRemaining === '0'
          ? 'GitHub API rate limit reached. Please try again in a few minutes or open GitHub Releases directly.'
          : `GitHub Releases returned HTTP ${res.status}.`;
      return {
        releases: cachedReleases?.releases || [],
        error: hint,
      };
    }

    const rawList = (await res.json()) as Array<{
      id?: number;
      tag_name?: string;
      name?: string;
      body?: string;
      published_at?: string;
      created_at?: string;
      draft?: boolean;
      prerelease?: boolean;
      html_url?: string;
      zipball_url?: string;
      assets?: Array<{
        name?: string;
        size?: number;
        browser_download_url?: string;
      }>;
    }>;

    if (!Array.isArray(rawList)) {
      return { releases: cachedReleases?.releases || [], error: 'Unexpected GitHub response format.' };
    }

    const normalized: RawNormalizedRelease[] = [];
    for (const item of rawList) {
      if (!item || item.draft || !item.tag_name) continue;
      const htmlUrl =
        item.html_url && isTrustedGitHubUrl(item.html_url)
          ? item.html_url
          : `${GITHUB_REPO_URL}/releases/tag/${encodeURIComponent(item.tag_name)}`;
      const zipballUrl =
        item.zipball_url && isTrustedGitHubUrl(item.zipball_url)
          ? item.zipball_url
          : `${GITHUB_REPO_URL}/archive/refs/tags/${encodeURIComponent(item.tag_name)}.zip`;

      const assets: ReleaseAssetInfo[] = [];
      for (const asset of item.assets || []) {
        if (!asset?.name || !asset?.browser_download_url) continue;
        if (!isTrustedGitHubUrl(asset.browser_download_url)) continue;
        const lower = asset.name.toLowerCase();
        assets.push({
          name: asset.name,
          sizeBytes: Number.isFinite(asset.size) ? Number(asset.size) : 0,
          downloadUrl: asset.browser_download_url,
          isInstaller: lower.endsWith('.exe') && /setup|install/i.test(lower),
          isPortable: lower.endsWith('.exe') && /portable/i.test(lower),
        });
      }

      normalized.push({
        id: Number(item.id) || normalized.length + 1,
        tag: item.tag_name,
        version: normalizeVersion(item.tag_name),
        name: (item.name || item.tag_name).trim(),
        body: typeof item.body === 'string' ? item.body.slice(0, 6000) : '',
        publishedAt: item.published_at || item.created_at || '',
        prerelease: Boolean(item.prerelease),
        htmlUrl,
        zipballUrl,
        primaryAsset: pickPrimaryAsset(assets),
        assets,
      });
    }

    // Sort newest semantic version first
    normalized.sort((a, b) => compareSemver(b.version, a.version));
    cachedReleases = { fetchedAt: now, releases: normalized };
    return { releases: normalized };
  } catch (err) {
    const message =
      err instanceof Error && err.name === 'AbortError'
        ? 'Timed out connecting to GitHub Releases.'
        : 'Could not reach GitHub Releases. Check your internet connection.';
    return {
      releases: cachedReleases?.releases || [],
      error: message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkGitHubUpdates(forceRefresh = false): Promise<UpdateCheckResponse> {
  const currentVersion = getCurrentAppVersion();
  const { releases: rawReleases, error } = await loadRawGitHubReleases(forceRefresh);

  const releases: GitHubReleaseEntry[] = rawReleases.map((rel) => {
    const cmp = compareSemver(rel.version, currentVersion);
    const relation: 'newer' | 'current' | 'older' =
      cmp > 0 ? 'newer' : cmp < 0 ? 'older' : 'current';
    const local = findLocalCachedInstaller(rel.tag);

    return {
      ...rel,
      relation,
      isDownloadedLocally: Boolean(local),
      localFilePath: local?.filePath || null,
      localFileName: local?.fileName || null,
    };
  });

  const latestStable = releases.find((r) => !r.prerelease) || releases[0] || null;
  const updateAvailable = Boolean(latestStable && latestStable.relation === 'newer');

  return {
    currentVersion,
    isDesktop: isDesktopEnvironment(),
    repoUrl: GITHUB_REPO_URL,
    updatesDir: getUpdatesDirectory(),
    checkedAt: new Date().toISOString(),
    updateAvailable,
    latestRelease: latestStable,
    releases,
    activeDownload: { ...activeDownloadState },
    ...(error ? { error } : {}),
  };
}

export function getUpdateDownloadState(): UpdateDownloadState {
  return { ...activeDownloadState };
}

export function cancelUpdateDownload(): UpdateDownloadState {
  if (activeAbortController) {
    activeAbortController.abort();
    activeAbortController = null;
  }
  if (activeDownloadState.status === 'downloading') {
    activeDownloadState = {
      ...activeDownloadState,
      status: 'cancelled',
      speedBytesPerSec: 0,
    };
  }
  return { ...activeDownloadState };
}

export async function startReleaseAssetDownload(
  tag: string,
  requestedAssetName?: string
): Promise<UpdateDownloadState> {
  if (activeDownloadState.status === 'downloading') {
    throw new Error('Another release download is already in progress.');
  }

  const { releases } = await loadRawGitHubReleases(false);
  const release = releases.find((r) => r.tag === tag);
  if (!release) {
    throw new Error(`Release "${tag}" was not found on GitHub.`);
  }

  const asset = requestedAssetName
    ? release.assets.find((a) => a.name === requestedAssetName) || release.primaryAsset
    : release.primaryAsset;

  if (!asset) {
    throw new Error(`Release "${tag}" does not have a downloadable installer file attached yet.`);
  }

  const lowerAssetName = asset.name.toLowerCase();
  if (!lowerAssetName.endsWith('.exe') && !lowerAssetName.endsWith('.zip')) {
    throw new Error('Only verified .exe or .zip release packages can be downloaded.');
  }

  if (!isTrustedGitHubUrl(asset.downloadUrl)) {
    throw new Error('Refused download from untrusted host.');
  }

  const finalPath = resolveConfinedUpdatePath(release.tag, asset.name);
  const partialPath = `${finalPath}.partial`;
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });

  // Reuse already cached installer if full file exists
  if (fs.existsSync(finalPath)) {
    const stat = fs.statSync(finalPath);
    if (stat.size > 0 && (asset.sizeBytes === 0 || stat.size === asset.sizeBytes)) {
      activeDownloadState = {
        status: 'completed',
        tag: release.tag,
        fileName: asset.name,
        localFilePath: finalPath,
        downloadedBytes: stat.size,
        totalBytes: stat.size,
        speedBytesPerSec: 0,
        progressPct: 100,
      };
      return { ...activeDownloadState };
    }
  }

  const controller = new AbortController();
  activeAbortController = controller;
  activeDownloadState = {
    status: 'downloading',
    tag: release.tag,
    fileName: asset.name,
    localFilePath: null,
    downloadedBytes: 0,
    totalBytes: asset.sizeBytes || 0,
    speedBytesPerSec: 0,
    progressPct: 0,
  };

  void (async () => {
    const startedAt = Date.now();
    try {
      const response = await fetch(asset.downloadUrl, {
        headers: { 'User-Agent': 'Umbras-Pass-Updater/1.0' },
        redirect: 'follow',
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`GitHub download failed with HTTP ${response.status}.`);
      }

      if (response.url && !isTrustedGitHubUrl(response.url)) {
        throw new Error('Download redirected to an untrusted domain.');
      }

      const contentLength = Number(response.headers.get('content-length') || asset.sizeBytes || 0);
      activeDownloadState.totalBytes = Number.isFinite(contentLength) ? contentLength : 0;

      const writeStream = fs.createWriteStream(partialPath);
      const nodeReadable = Readable.fromWeb(response.body as unknown as import('node:stream/web').ReadableStream);

      nodeReadable.on('data', (chunk: Buffer) => {
        activeDownloadState.downloadedBytes += chunk.length;
        const elapsedSec = Math.max(0.25, (Date.now() - startedAt) / 1000);
        activeDownloadState.speedBytesPerSec = Math.round(
          activeDownloadState.downloadedBytes / elapsedSec
        );
        if (activeDownloadState.totalBytes > 0) {
          activeDownloadState.progressPct = Math.min(
            99,
            (activeDownloadState.downloadedBytes / activeDownloadState.totalBytes) * 100
          );
        }
      });

      await pipeline(nodeReadable, writeStream);

      fs.renameSync(partialPath, finalPath);
      activeDownloadState = {
        status: 'completed',
        tag: release.tag,
        fileName: asset.name,
        localFilePath: finalPath,
        downloadedBytes: activeDownloadState.downloadedBytes,
        totalBytes: activeDownloadState.totalBytes || activeDownloadState.downloadedBytes,
        speedBytesPerSec: 0,
        progressPct: 100,
      };
    } catch (err) {
      try {
        if (fs.existsSync(partialPath)) fs.unlinkSync(partialPath);
      } catch {
        // Ignore cleanup errors
      }
      if (controller.signal.aborted) {
        activeDownloadState = {
          ...activeDownloadState,
          status: 'cancelled',
          speedBytesPerSec: 0,
        };
      } else {
        activeDownloadState = {
          ...activeDownloadState,
          status: 'error',
          speedBytesPerSec: 0,
          error: err instanceof Error ? err.message : 'Download failed.',
        };
      }
    } finally {
      if (activeAbortController === controller) {
        activeAbortController = null;
      }
    }
  })();

  return { ...activeDownloadState };
}
