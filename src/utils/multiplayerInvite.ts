export interface ParsedMultiplayerJoinInput {
  roomCode: string;
  hostBaseUrl: string;
}

const ROOM_CODE_REGEX = /^(UP-[A-Z0-9]{4}(?:-S[1-4])?)$/i;

export function normalizeMultiplayerHostUrl(rawUrl?: string): string {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return '';
  try {
    const withProtocol =
      trimmed.startsWith('http://') || trimmed.startsWith('https://')
        ? trimmed
        : `http://${trimmed}`;
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Only HTTP or HTTPS host endpoints are allowed.');
    }
    if (parsed.username || parsed.password) {
      throw new Error('Credentials are not allowed in host URLs.');
    }
    return parsed.origin;
  } catch {
    throw new Error(
      'Invalid host server URL. Example: http://203.0.113.45:3000 or http://192.168.1.42:3000'
    );
  }
}

export function extractRoomCodeToken(raw: string): string {
  const cleaned = raw.trim().toUpperCase();
  const directMatch = cleaned.match(ROOM_CODE_REGEX);
  if (directMatch) return directMatch[1];
  const embeddedMatch = cleaned.match(/(UP-[A-Z0-9]{4}(?:-S[1-4])?)/i);
  return embeddedMatch ? embeddedMatch[1].toUpperCase() : cleaned;
}

/**
 * Supports three ergonomic guest join inputs:
 * 1) Standard Room Code ("UP-ABCD" or "UP-ABCD-S2") + separate Host URL
 * 2) Portable Room Connect Code ("UP-ABCD@203.0.113.45:3000" or "UP-ABCD@myhost.ddns.net:3000")
 * 3) Direct Share Link ("http://203.0.113.45:3000/?join=UP-ABCD")
 */
export function parseMultiplayerJoinInput(
  rawRoomInput: string,
  fallbackHostUrl = ''
): ParsedMultiplayerJoinInput {
  const trimmedRoom = (rawRoomInput || '').trim();
  const trimmedHost = (fallbackHostUrl || '').trim();

  // Case A: Full URL pasted into either Room Code or Host URL box (with ?join=UP-XXXX)
  const urlCandidate =
    trimmedRoom.startsWith('http://') || trimmedRoom.startsWith('https://')
      ? trimmedRoom
      : trimmedHost.includes('?join=') || trimmedHost.includes('&join=')
      ? trimmedHost
      : '';

  if (urlCandidate) {
    try {
      const parsed = new URL(urlCandidate);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        const joinParam = parsed.searchParams.get('join') || '';
        const hostParam = parsed.searchParams.get('host') || '';
        const code = extractRoomCodeToken(joinParam || trimmedRoom);
        const origin = hostParam
          ? normalizeMultiplayerHostUrl(hostParam)
          : parsed.origin;
        return {
          roomCode: code,
          hostBaseUrl: origin,
        };
      }
    } catch {
      // Fall through to standard parsing
    }
  }

  // Case B: Portable Room Connect Code ("UP-ABCD@203.0.113.45:3000")
  const atIndex = trimmedRoom.indexOf('@');
  if (atIndex > 0) {
    const leftPart = trimmedRoom.slice(0, atIndex).trim();
    const rightPart = trimmedRoom.slice(atIndex + 1).trim();
    const code = extractRoomCodeToken(leftPart);
    let resolvedHost = '';
    if (rightPart) {
      const hasExplicitPort =
        rightPart.includes(':') ||
        rightPart.startsWith('http://') ||
        rightPart.startsWith('https://');
      const hostWithPort = hasExplicitPort ? rightPart : `${rightPart}:3000`;
      resolvedHost = normalizeMultiplayerHostUrl(hostWithPort);
    }
    return {
      roomCode: code,
      hostBaseUrl: resolvedHost || (trimmedHost ? normalizeMultiplayerHostUrl(trimmedHost) : ''),
    };
  }

  // Case C: Plain Room Code + optional Host URL
  return {
    roomCode: extractRoomCodeToken(trimmedRoom),
    hostBaseUrl: trimmedHost ? normalizeMultiplayerHostUrl(trimmedHost) : '',
  };
}

export function formatPortableConnectCode(
  roomCode: string,
  endpointUrl: string
): string {
  const cleanCode = roomCode.trim().toUpperCase();
  if (!endpointUrl.trim()) return cleanCode;
  try {
    const normalized = normalizeMultiplayerHostUrl(endpointUrl);
    const parsed = new URL(normalized);
    return `${cleanCode}@${parsed.host}`;
  } catch {
    return cleanCode;
  }
}

export function buildDirectInviteUrl(
  endpointUrl: string,
  roomCode: string
): string {
  const cleanCode = roomCode.trim().toUpperCase();
  const base = endpointUrl.trim()
    ? normalizeMultiplayerHostUrl(endpointUrl)
    : typeof window !== 'undefined'
    ? window.location.origin
    : 'http://127.0.0.1:3000';
  return `${base}/?join=${encodeURIComponent(cleanCode)}`;
}

export function isHttpsToHttpMixedContent(targetHostUrl: string): boolean {
  if (typeof window === 'undefined') return false;
  if (window.location.protocol !== 'https:') return false;
  const trimmed = targetHostUrl.trim();
  if (!trimmed) return false;
  try {
    const normalized = normalizeMultiplayerHostUrl(trimmed);
    const parsed = new URL(normalized);
    return parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function isRemotePublicHostUrl(targetHostUrl: string): boolean {
  const trimmed = targetHostUrl.trim();
  if (!trimmed) return false;
  try {
    const normalized = normalizeMultiplayerHostUrl(trimmed);
    const hostname = new URL(normalized).hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname.endsWith('.local')
    ) {
      return false;
    }
    if (
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function readJoinParamsFromWindowLocation(): {
  joinCode: string;
  hostUrl: string;
} | null {
  if (typeof window === 'undefined') return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const rawJoin = (params.get('join') || params.get('room') || '').trim();
    const rawHost = (params.get('host') || '').trim();
    if (!rawJoin) return null;

    const parsed = parseMultiplayerJoinInput(rawJoin, rawHost);
    return {
      joinCode: parsed.roomCode,
      hostUrl: parsed.hostBaseUrl,
    };
  } catch {
    return null;
  }
}
