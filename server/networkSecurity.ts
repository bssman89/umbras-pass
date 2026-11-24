import net from 'node:net';
import type express from 'express';

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function normalizeRemoteIp(rawAddr: string | undefined): string {
  const cleaned = (rawAddr || '').trim();
  if (!cleaned) return '';
  if (cleaned.startsWith('::ffff:')) {
    return cleaned.slice(7);
  }
  return cleaned;
}

export function isLoopbackRemoteAddress(rawAddr: string | undefined): boolean {
  const cleaned = (rawAddr || '').trim().toLowerCase();
  if (!cleaned) return false;
  return LOOPBACK_ADDRESSES.has(cleaned);
}

export function isPrivateOrReservedIpv4(ip: string): boolean {
  const parts = ip.split('.').map((n) => Number(n));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a >= 224) return true;
  return false;
}

export function isPrivateOrLanRemoteAddress(rawAddr: string | undefined): boolean {
  if (isLoopbackRemoteAddress(rawAddr)) return true;
  const normalized = normalizeRemoteIp(rawAddr);
  if (!normalized) return false;

  if (net.isIPv4(normalized)) {
    return isPrivateOrReservedIpv4(normalized);
  }

  const lower = normalized.toLowerCase();
  return (
    lower.startsWith('fe80:') ||
    lower.startsWith('fc') ||
    lower.startsWith('fd')
  );
}

export function getClientSocketIp(req: express.Request): string {
  return normalizeRemoteIp(req.socket?.remoteAddress) || 'unknown';
}

/**
 * Verifies the caller originated strictly from localhost (127.0.0.1 / ::1).
 * Never trusts spoofable headers like X-Forwarded-For to elevate a remote caller.
 * In non-managed environments (local dev, self-hosted server, or Electron .exe),
 * forwarded headers pointing to a non-loopback origin also block localhost-only access.
 */
export function isLoopbackHostCaller(req: express.Request): boolean {
  const socketIp = req.socket?.remoteAddress;
  const isManagedCloudRun = Boolean(process.env.K_SERVICE);

  // Inside managed Cloud Run preview runtime, requests arrive from in-pod loopback/link-local proxy
  if (isManagedCloudRun) {
    if (isLoopbackRemoteAddress(socketIp)) {
      return true;
    }
    const norm = normalizeRemoteIp(socketIp);
    if (norm.startsWith('169.254.') || norm === '::1') {
      return true;
    }
    return false;
  }

  if (!isLoopbackRemoteAddress(socketIp)) {
    return false;
  }

  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const rawList = Array.isArray(forwarded) ? forwarded.join(',') : forwarded;
    const hops = rawList
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (hops.some((hop) => !isLoopbackRemoteAddress(hop))) {
      return false;
    }
  }

  return true;
}

export const requireLocalhostOnly: express.RequestHandler = (req, res, next) => {
  if (!isLoopbackHostCaller(req)) {
    res.status(403).json({
      error: 'Access denied: private host features and local data are restricted to localhost only.',
    });
    return;
  }
  next();
};

export function isPrivateOrLanCaller(req: express.Request): boolean {
  if (isLoopbackHostCaller(req)) return true;

  const socketIp = req.socket?.remoteAddress;
  if (!isPrivateOrLanRemoteAddress(socketIp)) {
    return false;
  }

  if (!process.env.K_SERVICE) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      const rawList = Array.isArray(forwarded) ? forwarded.join(',') : forwarded;
      const hops = rawList
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (hops.some((hop) => !isPrivateOrLanRemoteAddress(hop))) {
        return false;
      }
    }
  }

  return true;
}

export function applyMultiplayerCors(
  req: express.Request,
  res: express.Response
): boolean {
  const rawOrigin = req.headers.origin;
  if (typeof rawOrigin === 'string' && rawOrigin.trim()) {
    try {
      const parsed = new URL(rawOrigin.trim());
      if (
        (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
        !parsed.username &&
        !parsed.password
      ) {
        res.setHeader('Access-Control-Allow-Origin', parsed.origin);
        res.setHeader('Vary', 'Origin');
      }
    } catch {
      // Ignore malformed Origin headers
    }
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '600');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

export function sanitizeRemoteMessage(
  rawMessage: unknown,
  fallbackMessage: string
): string {
  const str = typeof rawMessage === 'string' ? rawMessage : '';
  if (!str.trim()) return fallbackMessage;

  // Strip Windows paths (C:\...), Unix paths (/Users/..., /home/..., /app/...), and internal stack traces
  const masked = str
    .replace(/[A-Za-z]:\\[^\s"'`<>|*?]+/g, '[host-path]')
    .replace(/\/(?:Users|home|app|var|etc|tmp|opt|srv|mnt)\/[^\s"'`<>|*?]+/g, '[host-path]')
    .split('\n')[0]
    .trim();

  return (masked || fallbackMessage).slice(0, 220);
}

export function isSafeCardOrPlaymatImageUrl(rawUrl: unknown): rawUrl is string {
  if (typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (!trimmed) return false;

  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
    try {
      const parsed = new URL(trimmed);
      return !parsed.username && !parsed.password;
    } catch {
      return false;
    }
  }

  return /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(
    trimmed
  );
}
