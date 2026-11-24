import type {
  MultiplayerBotSeatConfig,
  MultiplayerConnectionMode,
  MultiplayerDeckSummary,
  MultiplayerGameActionPayload,
  MultiplayerRoomClientView,
  NetworkDiagnosticsReport,
} from '../types/multiplayer';
import { normalizeMultiplayerHostUrl } from './multiplayerInvite';

export function normalizeHostBaseUrl(rawUrl?: string): string {
  return normalizeMultiplayerHostUrl(rawUrl);
}

async function fetchMultiplayerJson<T>(
  baseUrl: string,
  path: string,
  options: RequestInit = {},
  bearerToken?: string
): Promise<T> {
  const cleanBase = normalizeHostBaseUrl(baseUrl);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (bearerToken) {
    headers.Authorization = `Bearer ${bearerToken}`;
  }

  const res = await fetch(`${cleanBase}${path}`, {
    ...options,
    headers,
  });

  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Multiplayer request failed (${res.status}).`);
  }
  return data;
}

export async function fetchNetworkDiagnostics(
  baseUrl = ''
): Promise<NetworkDiagnosticsReport> {
  return fetchMultiplayerJson<NetworkDiagnosticsReport>(
    baseUrl,
    '/api/multiplayer/network-info',
    { method: 'GET' }
  );
}

export async function fetchHostPublicIp(
  force = false,
  baseUrl = ''
): Promise<{
  publicIpv4: string;
  publicHostUrl: string;
  listeningPort: number;
}> {
  return fetchMultiplayerJson(
    baseUrl,
    `/api/multiplayer/host-public-ip${force ? '?force=1' : ''}`,
    { method: 'GET' }
  );
}

export async function runPortReachabilityTest(
  externalHost?: string,
  baseUrl = ''
): Promise<{
  listeningPort: number;
  loopbackReachable: boolean;
  lanReachable: boolean;
  externalHostInput: string;
  externalPortReachable: boolean | null;
  externalHttpHealthOk?: boolean | null;
  externalCheckDetail: string;
}> {
  return fetchMultiplayerJson(baseUrl, '/api/multiplayer/port-check', {
    method: 'POST',
    body: JSON.stringify({ externalHost: externalHost || '' }),
  });
}

export async function lookupRoomOnHost(params: {
  baseUrl?: string;
  roomCode: string;
}): Promise<{
  exists: boolean;
  roomCode: string;
  format: string;
  connectionMode: MultiplayerConnectionMode;
  requireHostApproval: boolean;
}> {
  const code = encodeURIComponent(params.roomCode.trim().toUpperCase());
  return fetchMultiplayerJson(
    params.baseUrl || '',
    `/api/multiplayer/rooms/${code}/lookup`,
    { method: 'GET' }
  );
}

export interface DiscoveredLanRoomSummary {
  roomCode: string;
  roomName: string;
  connectionMode: MultiplayerConnectionMode;
  format: string;
  maxSeats: 1 | 2 | 3 | 4;
  occupiedSeats: number;
  status: string;
  createdAt: string;
}

export async function fetchDiscoveredLanRooms(
  baseUrl = ''
): Promise<DiscoveredLanRoomSummary[]> {
  const res = await fetchMultiplayerJson<{ rooms: DiscoveredLanRoomSummary[] }>(
    baseUrl,
    '/api/multiplayer/lan-rooms',
    { method: 'GET' }
  );
  return Array.isArray(res.rooms) ? res.rooms : [];
}

export async function createMultiplayerRoom(params: {
  baseUrl?: string;
  roomName: string;
  connectionMode: MultiplayerConnectionMode;
  format: string;
  maxSeats: 1 | 2 | 3 | 4;
  requireHostApproval?: boolean;
  hostName: string;
  passcode: string;
  hostDeck: MultiplayerDeckSummary;
  botSeats?: Array<{
    seatIndex: number;
    kind: 'open' | 'bot';
    botConfig?: MultiplayerBotSeatConfig;
  }>;
}): Promise<{ sessionToken: string; room: MultiplayerRoomClientView }> {
  return fetchMultiplayerJson(
    params.baseUrl || '',
    '/api/multiplayer/rooms',
    {
      method: 'POST',
      body: JSON.stringify(params),
    }
  );
}

export async function submitGuestJoinRequest(params: {
  baseUrl?: string;
  roomCode: string;
  playerName: string;
  passcode: string;
  deckSummary: MultiplayerDeckSummary;
}): Promise<{
  requestId: string;
  requestToken: string;
  status: 'pending' | 'approved' | 'denied';
  roomName: string;
  roomCode: string;
  seatIndex?: number;
  sessionToken?: string;
  room?: MultiplayerRoomClientView;
}> {
  const code = encodeURIComponent(params.roomCode.trim().toUpperCase());
  return fetchMultiplayerJson(
    params.baseUrl || '',
    `/api/multiplayer/rooms/${code}/join-request`,
    {
      method: 'POST',
      body: JSON.stringify({
        playerName: params.playerName,
        passcode: params.passcode,
        deckSummary: params.deckSummary,
      }),
    }
  );
}

export async function checkGuestJoinApprovalStatus(params: {
  baseUrl?: string;
  roomCode: string;
  requestToken: string;
}): Promise<{
  status: 'pending' | 'approved' | 'denied';
  seatIndex?: number;
  sessionToken?: string;
  room?: MultiplayerRoomClientView;
  roomName?: string;
}> {
  const code = encodeURIComponent(params.roomCode.trim().toUpperCase());
  return fetchMultiplayerJson(
    params.baseUrl || '',
    `/api/multiplayer/rooms/${code}/join-status`,
    { method: 'GET' },
    params.requestToken
  );
}

export async function respondToJoinRequest(params: {
  baseUrl?: string;
  roomCode: string;
  hostToken: string;
  requestId: string;
  approve: boolean;
  targetSeatIndex?: number;
}): Promise<{ room: MultiplayerRoomClientView }> {
  const code = encodeURIComponent(params.roomCode.trim().toUpperCase());
  return fetchMultiplayerJson(
    params.baseUrl || '',
    `/api/multiplayer/rooms/${code}/approve-request`,
    {
      method: 'POST',
      body: JSON.stringify({
        requestId: params.requestId,
        approve: params.approve,
        targetSeatIndex: params.targetSeatIndex,
      }),
    },
    params.hostToken
  );
}

export async function configureRoomSeat(params: {
  baseUrl?: string;
  roomCode: string;
  hostToken: string;
  seatIndex: number;
  kind: 'open' | 'bot';
  botConfig?: MultiplayerBotSeatConfig;
}): Promise<{ room: MultiplayerRoomClientView }> {
  const code = encodeURIComponent(params.roomCode.trim().toUpperCase());
  return fetchMultiplayerJson(
    params.baseUrl || '',
    `/api/multiplayer/rooms/${code}/configure-seat`,
    {
      method: 'POST',
      body: JSON.stringify({
        seatIndex: params.seatIndex,
        kind: params.kind,
        botConfig: params.botConfig,
      }),
    },
    params.hostToken
  );
}

export async function updateMultiplayerLobbySettings(params: {
  baseUrl?: string;
  roomCode: string;
  hostToken: string;
  maxSeats?: 1 | 2 | 3 | 4;
  newPasscode?: string;
  requireHostApproval?: boolean;
  roomName?: string;
  tabletopThemeId?: string;
  tabletopArtworkPresetId?: string;
  tabletopCustomImageUrl?: string;
}): Promise<{ room: MultiplayerRoomClientView }> {
  const code = encodeURIComponent(params.roomCode.trim().toUpperCase());
  return fetchMultiplayerJson(
    params.baseUrl || '',
    `/api/multiplayer/rooms/${code}/lobby-settings`,
    {
      method: 'POST',
      body: JSON.stringify({
        maxSeats: params.maxSeats,
        newPasscode: params.newPasscode,
        requireHostApproval: params.requireHostApproval,
        roomName: params.roomName,
        tabletopThemeId: params.tabletopThemeId,
        tabletopArtworkPresetId: params.tabletopArtworkPresetId,
        tabletopCustomImageUrl: params.tabletopCustomImageUrl,
      }),
    },
    params.hostToken
  );
}

export async function updateSeatReadyOrDeck(params: {
  baseUrl?: string;
  roomCode: string;
  sessionToken: string;
  ready?: boolean;
  deckSummary?: MultiplayerDeckSummary;
  playmatThemeId?: string;
  playmatArtworkPresetId?: string;
  playmatCustomImageUrl?: string;
}): Promise<{ room: MultiplayerRoomClientView }> {
  const code = encodeURIComponent(params.roomCode.trim().toUpperCase());
  return fetchMultiplayerJson(
    params.baseUrl || '',
    `/api/multiplayer/rooms/${code}/ready`,
    {
      method: 'POST',
      body: JSON.stringify({
        ready: params.ready,
        deckSummary: params.deckSummary,
        playmatThemeId: params.playmatThemeId,
        playmatArtworkPresetId: params.playmatArtworkPresetId,
        playmatCustomImageUrl: params.playmatCustomImageUrl,
      }),
    },
    params.sessionToken
  );
}

export async function updateLobbySeatLife(params: {
  baseUrl?: string;
  roomCode: string;
  sessionToken: string;
  seatIndex?: number;
  delta?: number;
  lifeTotal?: number;
  resetAll?: boolean;
}): Promise<{ room: MultiplayerRoomClientView }> {
  const code = encodeURIComponent(params.roomCode.trim().toUpperCase());
  return fetchMultiplayerJson(
    params.baseUrl || '',
    `/api/multiplayer/rooms/${code}/seat-life`,
    {
      method: 'POST',
      body: JSON.stringify({
        seatIndex: params.seatIndex,
        delta: params.delta,
        lifeTotal: params.lifeTotal,
        resetAll: params.resetAll,
      }),
    },
    params.sessionToken
  );
}

export async function startMultiplayerMatch(params: {
  baseUrl?: string;
  roomCode: string;
  hostToken: string;
  firstSeatIndex?: number;
  diceSummary?: string;
}): Promise<{ room: MultiplayerRoomClientView }> {
  const code = encodeURIComponent(params.roomCode.trim().toUpperCase());
  return fetchMultiplayerJson(
    params.baseUrl || '',
    `/api/multiplayer/rooms/${code}/start`,
    {
      method: 'POST',
      body: JSON.stringify({
        firstSeatIndex: params.firstSeatIndex,
        diceSummary: params.diceSummary,
      }),
    },
    params.hostToken
  );
}

export async function fetchMultiplayerRoomState(params: {
  baseUrl?: string;
  roomCode: string;
  sessionToken: string;
}): Promise<{ room: MultiplayerRoomClientView }> {
  const code = encodeURIComponent(params.roomCode.trim().toUpperCase());
  return fetchMultiplayerJson(
    params.baseUrl || '',
    `/api/multiplayer/rooms/${code}/state`,
    { method: 'GET' },
    params.sessionToken
  );
}

export async function sendMultiplayerChatMessage(params: {
  baseUrl?: string;
  roomCode: string;
  sessionToken: string;
  text: string;
}): Promise<{ room: MultiplayerRoomClientView }> {
  const code = encodeURIComponent(params.roomCode.trim().toUpperCase());
  return fetchMultiplayerJson(
    params.baseUrl || '',
    `/api/multiplayer/rooms/${code}/chat`,
    {
      method: 'POST',
      body: JSON.stringify({ text: params.text }),
    },
    params.sessionToken
  );
}

export async function sendMultiplayerGameAction(params: {
  baseUrl?: string;
  roomCode: string;
  sessionToken: string;
  action: MultiplayerGameActionPayload;
}): Promise<{ room: MultiplayerRoomClientView }> {
  const code = encodeURIComponent(params.roomCode.trim().toUpperCase());
  return fetchMultiplayerJson(
    params.baseUrl || '',
    `/api/multiplayer/rooms/${code}/action`,
    {
      method: 'POST',
      body: JSON.stringify(params.action),
    },
    params.sessionToken
  );
}

export async function requestSseTicket(params: {
  baseUrl?: string;
  roomCode: string;
  sessionToken: string;
}): Promise<string> {
  const code = encodeURIComponent(params.roomCode.trim().toUpperCase());
  const res = await fetchMultiplayerJson<{ ticket: string; expiresInSeconds: number }>(
    params.baseUrl || '',
    `/api/multiplayer/rooms/${code}/sse-ticket`,
    { method: 'POST', body: JSON.stringify({}) },
    params.sessionToken
  );
  return res.ticket;
}

export function subscribeToMultiplayerRoomEvents(params: {
  baseUrl?: string;
  roomCode: string;
  sessionToken: string;
  onUpdate: (room: MultiplayerRoomClientView) => void;
  onConnectionChange?: (connected: boolean) => void;
}): () => void {
  const cleanBase = normalizeHostBaseUrl(params.baseUrl);
  const code = encodeURIComponent(params.roomCode.trim().toUpperCase());

  let disposed = false;
  let es: EventSource | null = null;
  let reconnectTimer: number | null = null;

  const connectStream = async () => {
    if (disposed) return;
    try {
      const ticket = await requestSseTicket({
        baseUrl: params.baseUrl,
        roomCode: params.roomCode,
        sessionToken: params.sessionToken,
      });
      if (disposed || !ticket) return;

      const streamUrl = `${cleanBase}/api/multiplayer/rooms/${code}/events?ticket=${encodeURIComponent(
        ticket
      )}`;
      if (es) {
        es.close();
        es = null;
      }

      es = new EventSource(streamUrl);
      es.onopen = () => {
        if (!disposed) params.onConnectionChange?.(true);
      };
      es.onmessage = (evt) => {
        if (disposed || !evt.data) return;
        try {
          const parsed = JSON.parse(evt.data) as MultiplayerRoomClientView;
          if (parsed && parsed.roomCode) {
            params.onUpdate(parsed);
          }
        } catch {
          // Ignore non-JSON frames
        }
      };
      es.onerror = () => {
        if (disposed) return;
        params.onConnectionChange?.(false);
        es?.close();
        es = null;
        if (reconnectTimer === null) {
          reconnectTimer = window.setTimeout(() => {
            reconnectTimer = null;
            void connectStream();
          }, 3000);
        }
      };
    } catch {
      if (!disposed) {
        params.onConnectionChange?.(false);
      }
    }
  };

  void connectStream();

  // Fallback polling reconciliation every 2.5s so state stays synced across strict network proxies
  const pollTimer = window.setInterval(() => {
    if (disposed) return;
    void fetchMultiplayerRoomState({
      baseUrl: params.baseUrl,
      roomCode: params.roomCode,
      sessionToken: params.sessionToken,
    })
      .then((res) => {
        if (!disposed && res.room) {
          params.onConnectionChange?.(true);
          params.onUpdate(res.room);
        }
      })
      .catch(() => {
        if (!disposed) params.onConnectionChange?.(false);
      });
  }, 2500);

  return () => {
    disposed = true;
    window.clearInterval(pollTimer);
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (es) {
      es.close();
      es = null;
    }
  };
}
