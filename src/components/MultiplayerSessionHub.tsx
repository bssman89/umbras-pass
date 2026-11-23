import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Crown,
  Globe,
  Layers,
  LayoutGrid,
  Loader2,
  Lock,
  MessageSquare,
  Move,
  Network,
  Palette,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Server,
  ShieldCheck,
  Shuffle,
  Sparkles,
  Swords,
  Terminal,
  UserCheck,
  UserPlus,
  Users,
  Wand2,
  Wifi,
  X,
  Zap,
} from 'lucide-react';
import type { CardMetadata, DeckAnalysisResult, ResolvedDeckCard } from '../types/deck';
import type {
  MultiplayerBotSeatConfig,
  MultiplayerCardInstance,
  MultiplayerConnectionMode,
  MultiplayerDeckSummary,
  MultiplayerGameActionPayload,
  MultiplayerRoomClientView,
  NetworkDiagnosticsReport,
} from '../types/multiplayer';
import {
  checkGuestJoinApprovalStatus,
  configureRoomSeat,
  createMultiplayerRoom,
  fetchDiscoveredLanRooms,
  fetchNetworkDiagnostics,
  respondToJoinRequest,
  runPortReachabilityTest,
  sendMultiplayerChatMessage,
  sendMultiplayerGameAction,
  startMultiplayerMatch,
  submitGuestJoinRequest,
  subscribeToMultiplayerRoomEvents,
  updateLobbySeatLife,
  updateMultiplayerLobbySettings,
  updateSeatReadyOrDeck,
  type DiscoveredLanRoomSummary,
} from '../utils/multiplayerClient';
import { MultiplayerLobby } from './MultiplayerLobby';
import { NetworkSetupPanel } from './NetworkSetupPanel';
import {
  loadTabletopPlaymatPreferences,
  PLAYMAT_THEME_UPDATED_EVENT,
  resolveSeatPlaymatSurface,
  resolveTabletopSurface,
  type PlaymatArtworkPresetId,
  type TabletopPlaymatPreferences,
  type TabletopThemeId,
} from '../utils/tabletopPlaymatThemes';
import {
  PlaymatSurfaceBackdrop,
  TabletopPlaymatCustomizerModal,
} from './TabletopPlaymatCustomizerModal';
import {
  applyUserProxiesToMultiplayerDeck,
  CUSTOM_CARDS_TOKENS_UPDATED_EVENT,
  loadCustomCardTokenPreferences,
  resolveCardWithCustomProxy,
  resolveCustomTokenVisual,
  type CustomCardProxyEntry,
  type CustomCardTokenPreferences,
} from '../utils/customCardProxiesAndTokens';
import {
  CustomCardProxyTokenModal,
  getCustomFrameBorderClass,
} from './CustomCardProxyTokenModal';
import {
  clampPlaymatX,
  clampPlaymatY,
  computeOpenBotPlaymatSpot,
  computeOpenPlayerPlaymatSpot,
  isBacklinePlaymatCard,
  type PlaymatDropPoint,
} from '../utils/playmatPositioning';

const BOT_ARCHETYPES = [
  'Mono-Red Aggro / Burn',
  'Azorius Control & Countermagic',
  'Simic Landfall & Ramp',
  'Golgari Graveyard Value',
];

function generateRandomPasscode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function convertUserDeckToMultiplayerSummary(
  analysis: DeckAnalysisResult,
  effectiveUserCards: ResolvedDeckCard[],
  commanders: ResolvedDeckCard[]
): MultiplayerDeckSummary {
  const cmdNames = commanders.map((c) => c.name);
  const serialized = effectiveUserCards.map((c) => ({
    name: c.name,
    quantity: c.quantity,
    isCommander: cmdNames.includes(c.name),
    typeLine: c.card?.typeLine || '',
    manaCost: c.card?.manaCost || '',
    cmc: c.card?.cmc || 0,
    oracleText: c.card?.oracleText || '',
    imageUri: c.card?.imageUri,
    power: c.card?.power,
    toughness: c.card?.toughness,
  }));

  const totalCount = serialized.reduce((acc, c) => acc + (Number(c.quantity) || 1), 0);

  return {
    deckName: analysis.deckName || 'Analyzed Deck',
    format: analysis.metrics?.detectedFormat || 'commander',
    cardCount: totalCount,
    commanders: cmdNames,
    cards: serialized,
  };
}

type MultiplayerActionInput =
  MultiplayerGameActionPayload extends infer U
    ? U extends { actionId: string }
      ? Omit<U, 'actionId'>
      : never
    : never;

interface MultiplayerSessionHubProps {
  isOpen: boolean;
  onClose: () => void;
  analysis: DeckAnalysisResult;
  effectiveUserCards: ResolvedDeckCard[];
  userCommanders: ResolvedDeckCard[];
  findMeta: (name: string) => CardMetadata | null | undefined;
  onInspectCard: (name: string, meta?: CardMetadata | null) => void;
}

export const MultiplayerSessionHub: React.FC<MultiplayerSessionHubProps> = ({
  isOpen,
  onClose,
  analysis,
  effectiveUserCards,
  userCommanders,
  findMeta,
  onInspectCard,
}) => {
  const [setupTab, setSetupTab] = useState<'host' | 'join'>('host');
  const [connectionMode, setConnectionMode] = useState<MultiplayerConnectionMode>('lan');
  const [maxSeats, setMaxSeats] = useState<1 | 2 | 3 | 4>(4);
  const [roomName, setRoomName] = useState<string>(
    () => `${analysis.deckName || 'Commander'} Tabletop Pod`
  );
  const [playerName, setPlayerName] = useState<string>('Player 1');
  const [passcode, setPasscode] = useState<string>(() => generateRandomPasscode());
  const [initialSeatModes, setInitialSeatModes] = useState<
    Record<number, { kind: 'open' | 'bot'; archetype: string }>
  >({
    1: { kind: 'open', archetype: 'Mono-Red Aggro / Burn' },
    2: { kind: 'bot', archetype: 'Azorius Control & Countermagic' },
    3: { kind: 'bot', archetype: 'Simic Landfall & Ramp' },
  });

  // Network & Port-Forwarding Diagnostics state
  const [netInfo, setNetInfo] = useState<NetworkDiagnosticsReport | null>(null);
  const [loadingNetInfo, setLoadingNetInfo] = useState(false);
  const [externalHostInput, setExternalHostInput] = useState('');
  const [testingPort, setTestingPort] = useState(false);
  const [portTestMessage, setPortTestMessage] = useState<string | null>(null);
  const [portTestOk, setPortTestOk] = useState<boolean | null>(null);

  // Guest Join state
  const [joinHostUrl, setJoinHostUrl] = useState<string>('');
  const [joinRoomCode, setJoinRoomCode] = useState<string>('');
  const [joinPasscode, setJoinPasscode] = useState<string>('');
  const [discoveredRooms, setDiscoveredRooms] = useState<DiscoveredLanRoomSummary[]>([]);
  const [loadingDiscovered, setLoadingDiscovered] = useState(false);
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const [pendingRequestToken, setPendingRequestToken] = useState<string | null>(null);
  const [pendingRequestStatus, setPendingRequestStatus] = useState<
    'pending' | 'approved' | 'denied' | null
  >(null);

  // Active Room & In-Memory Session Token (never stored in localStorage)
  const [activeHostBaseUrl, setActiveHostBaseUrl] = useState<string>('');
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [room, setRoom] = useState<MultiplayerRoomClientView | null>(null);
  const [streamConnected, setStreamConnected] = useState<boolean>(false);
  const [busyAction, setBusyAction] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Live Tabletop UI local state
  const [selectedAttackerUids, setSelectedAttackerUids] = useState<string[]>([]);
  const [attackTargetSeatIdx, setAttackTargetSeatIdx] = useState<number>(1);
  const [triggerPermUid, setTriggerPermUid] = useState<string>('');
  const [triggerKind, setTriggerKind] = useState<
    'etb' | 'landfall' | 'upkeep' | 'attack' | 'dies' | 'activated'
  >('etb');
  const [chatInput, setChatInput] = useState<string>('');
  const [showChatDrawer, setShowChatDrawer] = useState<boolean>(true);
  const [showResolvedHistory, setShowResolvedHistory] = useState<boolean>(false);
  const [showPlaymatGuides, setShowPlaymatGuides] = useState<boolean>(true);
  const [optimisticCoords, setOptimisticCoords] = useState<
    Record<string, { x: number; y: number }>
  >({});
  const [mpHandDrag, setMpHandDrag] = useState<{
    zone: 'hand' | 'command';
    uid: string;
    name: string;
    isLand: boolean;
  } | null>(null);
  const [mpPointerDrag, setMpPointerDrag] = useState<{
    kind: 'self' | 'bot';
    seatIndex: number;
    uid: string;
    name: string;
    x: number;
    y: number;
  } | null>(null);

  const actionSeqRef = useRef<number>(1);
  const selfPlaymatRef = useRef<HTMLDivElement | null>(null);
  const botPlaymatRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const suppressCardClickRef = useRef<boolean>(false);
  const mpPointerCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      mpPointerCleanupRef.current?.();
    };
  }, []);

  const [customCardPrefs, setCustomCardPrefs] =
    useState<CustomCardTokenPreferences>(() => loadCustomCardTokenPreferences());
  const [showCustomCardsModal, setShowCustomCardsModal] = useState(false);
  const [customCardsInitialTab, setCustomCardsInitialTab] = useState<
    'card-art' | 'playtest-proxies' | 'custom-tokens'
  >('card-art');

  useEffect(() => {
    const handleCustomCardsSync = () => {
      setCustomCardPrefs(loadCustomCardTokenPreferences());
    };
    window.addEventListener(
      CUSTOM_CARDS_TOKENS_UPDATED_EVENT,
      handleCustomCardsSync
    );
    return () =>
      window.removeEventListener(
        CUSTOM_CARDS_TOKENS_UPDATED_EVENT,
        handleCustomCardsSync
      );
  }, []);

  const userDeckSummary = useMemo(() => {
    const base = convertUserDeckToMultiplayerSummary(
      analysis,
      effectiveUserCards,
      userCommanders
    );
    return applyUserProxiesToMultiplayerDeck(base, customCardPrefs);
  }, [analysis, effectiveUserCards, userCommanders, customCardPrefs]);

  const resolveMultiplayerCardInstance = (
    inst: MultiplayerCardInstance,
    useLocalUserOverrides = true
  ) => {
    const baseMeta = findMeta(inst.name) || null;
    const localResolved = useLocalUserOverrides
      ? resolveCardWithCustomProxy(inst.name, baseMeta, customCardPrefs)
      : {
          meta: baseMeta,
          proxyEntry: null,
          displayTitle: inst.name,
          badgeLabel: undefined,
          frameStyle: 'standard' as const,
        };

    const tokenVisual = inst.isToken
      ? resolveCustomTokenVisual(inst.name, customCardPrefs)
      : null;

    const effectiveImageUri =
      inst.imageUri ||
      localResolved.meta?.imageUri ||
      tokenVisual?.customImageUrl ||
      baseMeta?.imageUri;

    const displayTitle =
      inst.displayTitle || localResolved.displayTitle || inst.name;

    const badgeLabel =
      inst.proxyBadgeLabel ||
      (inst.isToken ? 'TOKEN' : inst.isProxy ? 'PROXY' : localResolved.badgeLabel);

    const frameStyle =
      inst.frameStyle ||
      tokenVisual?.frameStyle ||
      localResolved.frameStyle ||
      'standard';

    const inspectMeta: CardMetadata = {
      name: displayTitle,
      manaCost: inst.manaCost || localResolved.meta?.manaCost || '',
      cmc: inst.cmc ?? localResolved.meta?.cmc ?? 0,
      typeLine: inst.typeLine || localResolved.meta?.typeLine || 'Card',
      oracleText: inst.oracleText || localResolved.meta?.oracleText || '',
      colors: localResolved.meta?.colors || [],
      colorIdentity: localResolved.meta?.colorIdentity || [],
      producedMana: localResolved.meta?.producedMana || [],
      isLand: (inst.typeLine || '').toLowerCase().includes('land'),
      isMdfcLand: localResolved.meta?.isMdfcLand || false,
      entersTappedLikely: localResolved.meta?.entersTappedLikely || false,
      isRamp: localResolved.meta?.isRamp || false,
      isDraw: localResolved.meta?.isDraw || false,
      isRemoval: localResolved.meta?.isRemoval || false,
      isBoardWipe: localResolved.meta?.isBoardWipe || false,
      isProtection: localResolved.meta?.isProtection || false,
      imageUri: effectiveImageUri || '',
      power: inst.power || localResolved.meta?.power,
      toughness: inst.toughness || localResolved.meta?.toughness,
      priceUsd: localResolved.meta?.priceUsd ?? null,
      scryfallUri: localResolved.meta?.scryfallUri || '',
      legalInFormat: localResolved.meta?.legalInFormat ?? true,
      rarity: localResolved.meta?.rarity || 'common',
    };

    return {
      effectiveImageUri,
      displayTitle,
      badgeLabel,
      frameStyle,
      inspectMeta,
    };
  };

  // Load network & LAN interface diagnostics when modal opens
  const refreshNetworkDiagnostics = async () => {
    setLoadingNetInfo(true);
    try {
      const report = await fetchNetworkDiagnostics('');
      setNetInfo(report);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Unable to load network diagnostics.'
      );
    } finally {
      setLoadingNetInfo(false);
    }
  };

  const refreshDiscoveredRooms = async (targetBaseUrl = joinHostUrl) => {
    setLoadingDiscovered(true);
    try {
      const list = await fetchDiscoveredLanRooms(targetBaseUrl);
      setDiscoveredRooms(list);
    } catch {
      setDiscoveredRooms([]);
    } finally {
      setLoadingDiscovered(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    void refreshNetworkDiagnostics();
    void refreshDiscoveredRooms('');
  }, [isOpen]);

  // Poll guest join approval status while waiting in the Host Approval Gate
  useEffect(() => {
    if (
      !pendingRequestToken ||
      !joinRoomCode.trim() ||
      pendingRequestStatus !== 'pending'
    ) {
      return;
    }

    const timer = window.setInterval(() => {
      void checkGuestJoinApprovalStatus({
        baseUrl: joinHostUrl,
        roomCode: joinRoomCode,
        requestToken: pendingRequestToken,
      })
        .then((res) => {
          if (res.status === 'approved' && res.sessionToken && res.room) {
            setPendingRequestStatus('approved');
            setActiveHostBaseUrl(joinHostUrl);
            setSessionToken(res.sessionToken);
            setRoom(res.room);
            setPendingRequestToken(null);
          } else if (res.status === 'denied') {
            setPendingRequestStatus('denied');
            setErrorMsg('The host declined your request to join the session.');
          }
        })
        .catch(() => {
          // Keep polling quietly
        });
    }, 1500);

    return () => window.clearInterval(timer);
  }, [pendingRequestToken, pendingRequestStatus, joinRoomCode, joinHostUrl]);

  // Subscribe to real-time SSE + fallback reconciliation once inside a room
  useEffect(() => {
    if (!room?.roomCode || !sessionToken) return;
    const unsubscribe = subscribeToMultiplayerRoomEvents({
      baseUrl: activeHostBaseUrl,
      roomCode: room.roomCode,
      sessionToken,
      onUpdate: (nextRoom) => {
        setRoom(nextRoom);
      },
      onConnectionChange: (ok) => {
        setStreamConnected(ok);
      },
    });
    return unsubscribe;
  }, [room?.roomCode, sessionToken, activeHostBaseUrl]);

  const handleRunPortCheck = async () => {
    setTestingPort(true);
    setPortTestMessage(null);
    setPortTestOk(null);
    try {
      const res = await runPortReachabilityTest(externalHostInput, '');
      const hasExternal = Boolean(externalHostInput.trim());
      if (hasExternal) {
        setPortTestOk(Boolean(res.externalPortReachable));
        setPortTestMessage(res.externalCheckDetail);
      } else {
        setPortTestOk(res.lanReachable && res.loopbackReachable);
        setPortTestMessage(
          res.lanReachable
            ? `Local & LAN TCP Port ${res.listeningPort} verified reachable. Friends on your LAN can connect now.`
            : `Local loopback active on port ${res.listeningPort}, but LAN interface probe timed out. Check Windows Firewall.`
        );
      }
    } catch (err) {
      setPortTestOk(false);
      setPortTestMessage(
        err instanceof Error ? err.message : 'Port reachability check failed.'
      );
    } finally {
      setTestingPort(false);
    }
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setBusyAction(true);
    try {
      const botSeatsPayload = [1, 2, 3].map((idx) => {
        const cfg = initialSeatModes[idx] || {
          kind: 'open',
          archetype: 'Mono-Red Aggro / Burn',
        };
        return {
          seatIndex: idx,
          kind: cfg.kind,
          botConfig:
            cfg.kind === 'bot'
              ? {
                  name: `AI Bot ${idx} (${cfg.archetype.split(' ')[0]})`,
                  archetype: cfg.archetype,
                  indignance: 'measured',
                  intelligence: 'tactical',
                }
              : undefined,
        };
      });

      const created = await createMultiplayerRoom({
        baseUrl: '',
        roomName: roomName.trim() || `${playerName}'s Tabletop Pod`,
        connectionMode,
        format: analysis.metrics?.detectedFormat || 'commander',
        maxSeats,
        hostName: playerName.trim() || 'Host Player',
        passcode,
        hostDeck: userDeckSummary,
        botSeats: botSeatsPayload,
      });

      setActiveHostBaseUrl('');
      setSessionToken(created.sessionToken);
      setRoom(created.room);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Failed to create multiplayer room.'
      );
    } finally {
      setBusyAction(false);
    }
  };

  const handleRequestJoinRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setBusyAction(true);
    try {
      const res = await submitGuestJoinRequest({
        baseUrl: joinHostUrl,
        roomCode: joinRoomCode,
        playerName: playerName.trim() || 'Guest Player',
        passcode: joinPasscode,
        deckSummary: userDeckSummary,
      });
      if (res.status === 'approved' && res.sessionToken && res.room) {
        setPendingRequestStatus('approved');
        setActiveHostBaseUrl(joinHostUrl);
        setSessionToken(res.sessionToken);
        setRoom(res.room);
        setPendingRequestToken(null);
      } else {
        setPendingRequestId(res.requestId);
        setPendingRequestToken(res.requestToken);
        setPendingRequestStatus('pending');
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Failed to submit join request.'
      );
    } finally {
      setBusyAction(false);
    }
  };

  const handleApproveOrDenyRequest = async (
    requestId: string,
    approve: boolean,
    targetSeatIndex?: number
  ) => {
    if (!room || !sessionToken) return;
    setErrorMsg(null);
    try {
      const res = await respondToJoinRequest({
        baseUrl: activeHostBaseUrl,
        roomCode: room.roomCode,
        hostToken: sessionToken,
        requestId,
        approve,
        targetSeatIndex,
      });
      setRoom(res.room);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Failed to process join request.'
      );
    }
  };

  const handleConfigureSeat = async (
    seatIndex: number,
    kind: 'open' | 'bot',
    botConfig?: MultiplayerBotSeatConfig
  ) => {
    if (!room || !sessionToken) return;
    setErrorMsg(null);
    try {
      const fallbackArchetype =
        botConfig?.archetype || 'Mono-Red Aggro / Burn';
      const res = await configureRoomSeat({
        baseUrl: activeHostBaseUrl,
        roomCode: room.roomCode,
        hostToken: sessionToken,
        seatIndex,
        kind,
        botConfig:
          kind === 'bot'
            ? {
                name:
                  botConfig?.name ||
                  `AI Bot ${seatIndex} (${fallbackArchetype.split(' ')[0]})`,
                archetype: fallbackArchetype,
                indignance: botConfig?.indignance || 'measured',
                intelligence: botConfig?.intelligence || 'tactical',
              }
            : undefined,
      });
      setRoom(res.room);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Failed to configure seat.'
      );
    }
  };

  const handleUpdateLobbySettings = async (params: {
    maxSeats?: 1 | 2 | 3 | 4;
    newPasscode?: string;
    requireHostApproval?: boolean;
  }) => {
    if (!room || !sessionToken) return;
    setErrorMsg(null);
    try {
      const res = await updateMultiplayerLobbySettings({
        baseUrl: activeHostBaseUrl,
        roomCode: room.roomCode,
        hostToken: sessionToken,
        maxSeats: params.maxSeats,
        newPasscode: params.newPasscode,
        requireHostApproval: params.requireHostApproval,
      });
      if (params.newPasscode) {
        setPasscode(params.newPasscode);
      }
      if (params.maxSeats) {
        setMaxSeats(params.maxSeats);
      }
      setRoom(res.room);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Failed to update multiplayer lobby settings.'
      );
    }
  };

  const handleToggleReady = async (nextReady: boolean) => {
    if (!room || !sessionToken) return;
    try {
      const res = await updateSeatReadyOrDeck({
        baseUrl: activeHostBaseUrl,
        roomCode: room.roomCode,
        sessionToken,
        ready: nextReady,
        deckSummary: userDeckSummary,
      });
      setRoom(res.room);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to update ready state.');
    }
  };

  const handleUpdateSeatLife = async (params: {
    seatIndex?: number;
    delta?: number;
    lifeTotal?: number;
    resetAll?: boolean;
  }) => {
    if (!room || !sessionToken) return;
    setErrorMsg(null);
    try {
      const res = await updateLobbySeatLife({
        baseUrl: activeHostBaseUrl,
        roomCode: room.roomCode,
        sessionToken,
        seatIndex: params.seatIndex,
        delta: params.delta,
        lifeTotal: params.lifeTotal,
        resetAll: params.resetAll,
      });
      setRoom(res.room);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Failed to update seat life total.'
      );
    }
  };

  const handleStartMatch = async () => {
    if (!room || !sessionToken) return;
    setBusyAction(true);
    setErrorMsg(null);
    try {
      const res = await startMultiplayerMatch({
        baseUrl: activeHostBaseUrl,
        roomCode: room.roomCode,
        hostToken: sessionToken,
      });
      setRoom(res.room);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Failed to start multiplayer match.'
      );
    } finally {
      setBusyAction(false);
    }
  };

  const dispatchGameAction = async (payload: MultiplayerActionInput) => {
    if (!room || !sessionToken) return;
    const actionId = `act_${Date.now()}_${actionSeqRef.current++}`;
    try {
      const res = await sendMultiplayerGameAction({
        baseUrl: activeHostBaseUrl,
        roomCode: room.roomCode,
        sessionToken,
        action: { ...payload, actionId } as MultiplayerGameActionPayload,
      });
      setRoom(res.room);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Failed to send tabletop action.'
      );
    }
  };

  const handleSendChatText = async (text: string) => {
    if (!room || !sessionToken || !text.trim()) return;
    try {
      const res = await sendMultiplayerChatMessage({
        baseUrl: activeHostBaseUrl,
        roomCode: room.roomCode,
        sessionToken,
        text: text.trim(),
      });
      setRoom(res.room);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to send chat message.');
    }
  };

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    const text = chatInput.trim();
    setChatInput('');
    await handleSendChatText(text);
  };

  const handleLeaveSession = () => {
    setRoom(null);
    setSessionToken(null);
    setPendingRequestId(null);
    setPendingRequestToken(null);
    setPendingRequestStatus(null);
    setSelectedAttackerUids([]);
    setOptimisticCoords({});
    setErrorMsg(null);
  };

  const startMpPointerDrag = (
    e: React.PointerEvent<HTMLDivElement>,
    params: {
      kind: 'self' | 'bot';
      seatIndex: number;
      uid: string;
      name: string;
      initialX: number;
      initialY: number;
    }
  ) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const container =
      params.kind === 'self'
        ? selfPlaymatRef.current
        : botPlaymatRefs.current[params.seatIndex];
    if (!container) return;

    mpPointerCleanupRef.current?.();
    const rect = container.getBoundingClientRect();
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    let hasMoved = false;
    let currentX = params.initialX;
    let currentY = params.initialY;

    const handleMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startClientX;
      const dy = ev.clientY - startClientY;
      if (!hasMoved) {
        if (Math.hypot(dx, dy) < 5) return;
        hasMoved = true;
        suppressCardClickRef.current = true;
      }
      const deltaXPct = (dx / Math.max(1, rect.width)) * 100;
      const deltaYPct = (dy / Math.max(1, rect.height)) * 100;
      currentX = clampPlaymatX(
        params.initialX + deltaXPct,
        params.kind === 'bot' ? 10 : 8,
        params.kind === 'bot' ? 90 : 92
      );
      currentY = clampPlaymatY(
        params.initialY + deltaYPct,
        params.kind === 'bot' ? 16 : 13,
        params.kind === 'bot' ? 84 : 87
      );
      setMpPointerDrag({
        kind: params.kind,
        seatIndex: params.seatIndex,
        uid: params.uid,
        name: params.name,
        x: currentX,
        y: currentY,
      });
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
      mpPointerCleanupRef.current = null;
    };

    const handleUp = () => {
      cleanup();
      setMpPointerDrag(null);
      if (!hasMoved) return;

      window.setTimeout(() => {
        suppressCardClickRef.current = false;
      }, 90);

      const coordKey = `${params.seatIndex}:${params.uid}`;
      setOptimisticCoords((prev) => ({
        ...prev,
        [coordKey]: { x: currentX, y: currentY },
      }));

      void dispatchGameAction({
        type: 'move-playmat-card',
        cardUid: params.uid,
        targetSeatIndex: params.seatIndex,
        x: currentX,
        y: currentY,
      }).finally(() => {
        setOptimisticCoords((prev) => {
          const next = { ...prev };
          delete next[coordKey];
          return next;
        });
      });
    };

    mpPointerCleanupRef.current = cleanup;
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
  };

  const handleDropOnSelfPlaymat = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const dragItem = mpHandDrag;
    setMpHandDrag(null);
    if (!dragItem || !tabletop) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const dropPos: PlaymatDropPoint = {
      x: clampPlaymatX(((e.clientX - rect.left) / Math.max(1, rect.width)) * 100),
      y: clampPlaymatY(((e.clientY - rect.top) / Math.max(1, rect.height)) * 100),
    };

    if (dragItem.zone === 'hand') {
      if (dragItem.isLand) {
        void dispatchGameAction({
          type: 'play-land',
          cardUid: dragItem.uid,
          dropPos,
        });
      } else {
        void dispatchGameAction({
          type: 'cast-spell',
          cardUid: dragItem.uid,
          targetStackId:
            tabletop.stack.length > 0
              ? tabletop.stack[tabletop.stack.length - 1].id
              : undefined,
          dropPos,
        });
      }
    } else if (dragItem.zone === 'command') {
      void dispatchGameAction({
        type: 'cast-commander',
        cardUid: dragItem.uid,
        dropPos,
      });
    }
  };

  const callerSeatIdx = room?.callerSeatIndex ?? 0;
  const tabletop = room?.tabletop || null;
  const mySeatGame = tabletop?.seats[callerSeatIdx] || null;
  const opponentSeats = useMemo(
    () =>
      tabletop
        ? tabletop.seats.filter((s) => s.seatIndex !== callerSeatIdx)
        : [],
    [tabletop, callerSeatIdx]
  );

  const reversedStack = useMemo(() => {
    if (!tabletop) return [];
    return [...tabletop.stack].reverse().map((item, idx) => ({
      item,
      resolutionRank: idx + 1,
    }));
  }, [tabletop]);

  const [playmatPrefs, setPlaymatPrefs] = useState<TabletopPlaymatPreferences>(() =>
    loadTabletopPlaymatPreferences()
  );
  const [showPlaymatCustomizer, setShowPlaymatCustomizer] = useState(false);

  useEffect(() => {
    const handleSync = () => {
      setPlaymatPrefs(loadTabletopPlaymatPreferences());
    };
    window.addEventListener(PLAYMAT_THEME_UPDATED_EVENT, handleSync);
    return () => window.removeEventListener(PLAYMAT_THEME_UPDATED_EVENT, handleSync);
  }, []);

  const handleSyncPlaymatToRoom = (payload: {
    seatPlaymatThemeId?: TabletopThemeId;
    seatPlaymatArtworkPresetId?: PlaymatArtworkPresetId;
    seatPlaymatCustomImageUrl?: string;
    tabletopThemeId?: TabletopThemeId;
    tabletopArtworkPresetId?: PlaymatArtworkPresetId;
    tabletopCustomImageUrl?: string;
  }) => {
    if (!room || !sessionToken) return;
    void updateSeatReadyOrDeck({
      baseUrl: activeHostBaseUrl,
      roomCode: room.roomCode,
      sessionToken,
      playmatThemeId: payload.seatPlaymatThemeId,
      playmatArtworkPresetId: payload.seatPlaymatArtworkPresetId,
      playmatCustomImageUrl: payload.seatPlaymatCustomImageUrl,
    })
      .then((res) => setRoom(res.room))
      .catch(() => {});

    if (room.isHost && payload.tabletopThemeId) {
      void updateMultiplayerLobbySettings({
        baseUrl: activeHostBaseUrl,
        roomCode: room.roomCode,
        hostToken: sessionToken,
        tabletopThemeId: payload.tabletopThemeId,
        tabletopArtworkPresetId: payload.tabletopArtworkPresetId,
        tabletopCustomImageUrl: payload.tabletopCustomImageUrl,
      })
        .then((res) => setRoom(res.room))
        .catch(() => {});
    }
  };

  const remoteTabletopOverride = useMemo(
    () =>
      room
        ? {
            tabletopThemeId: room.tabletopThemeId,
            tabletopArtworkPresetId: room.tabletopArtworkPresetId,
            tabletopCustomImageUrl: room.tabletopCustomImageUrl,
          }
        : undefined,
    [room]
  );

  const mpTabletopSurface = useMemo(
    () => resolveTabletopSurface(playmatPrefs, remoteTabletopOverride),
    [playmatPrefs, remoteTabletopOverride]
  );

  const shareEndpointUrl = useMemo(() => {
    if (connectionMode === 'online' && externalHostInput.trim()) {
      const raw = externalHostInput.trim();
      const port = netInfo?.listeningPort || 3000;
      if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
      return raw.includes(':') ? `http://${raw}` : `http://${raw}:${port}`;
    }
    return netInfo?.primaryLanUrl || window.location.origin;
  }, [connectionMode, externalHostInput, netInfo]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Multiplayer Tabletop Session Hub"
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/70 p-3 sm:p-6 backdrop-blur-xs overflow-y-auto"
    >
      <div className="my-auto flex max-h-[94vh] w-full max-w-[1380px] flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white text-zinc-900 shadow-2xl">
        {/* Top Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 bg-zinc-50 px-5 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-700 text-white shrink-0">
              <Users className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-sm sm:text-base font-bold text-zinc-900 truncate">
                  Multiplayer Tabletop · LAN &amp; Self-Hosted Online
                </h2>
                {room && (
                  <span className="font-mono text-xs font-bold tabular-nums text-sky-800">
                    · Room {room.roomCode} · {room.maxSeats}-Seat Pod ·{' '}
                    {streamConnected ? 'Synced' : 'Reconnecting'}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-zinc-500 truncate">
                1–4 player hybrid pods with friends and AI bots over local LAN or port-forwarded host.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setCustomCardsInitialTab('card-art');
                setShowCustomCardsModal(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 cursor-pointer whitespace-nowrap"
            >
              <Wand2 className="h-3.5 w-3.5 text-violet-700" />
              <span>Art &amp; Proxies</span>
            </button>
            <button
              type="button"
              onClick={() => setShowPlaymatCustomizer(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 cursor-pointer whitespace-nowrap"
            >
              <Palette className="h-3.5 w-3.5 text-emerald-700" />
              <span>Playmats</span>
            </button>
            {room && (
              <button
                type="button"
                onClick={handleLeaveSession}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 cursor-pointer whitespace-nowrap"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Leave</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Multiplayer Hub"
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 cursor-pointer whitespace-nowrap"
            >
              <X className="h-3.5 w-3.5" />
              <span>Close</span>
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="flex items-center justify-between gap-3 border-b border-red-200 bg-red-50 px-5 py-2.5 text-xs font-medium text-red-800">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorMsg(null)}
              className="text-red-700 hover:text-red-900 cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Main Content Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">
          {!room ? (
            /* ============================================================================
               VIEW 1: CLEAN SETUP & CONNECTION HUB (HOST SESSION vs JOIN FRIEND'S SESSION)
               ============================================================================ */
            <div className="space-y-4">
              {/* Top Control Row: Host/Join Segmented Toggle + Active Deck Summary */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-3.5">
                <div className="inline-flex items-center gap-1 rounded-lg bg-zinc-100 p-1">
                  <button
                    type="button"
                    onClick={() => {
                      setSetupTab('host');
                      setErrorMsg(null);
                    }}
                    className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      setupTab === 'host'
                        ? 'bg-white text-zinc-900 shadow-xs'
                        : 'text-zinc-600 hover:text-zinc-900'
                    }`}
                  >
                    <Server className="h-3.5 w-3.5 text-sky-700" />
                    <span>Host Session</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSetupTab('join');
                      setErrorMsg(null);
                      void refreshDiscoveredRooms(joinHostUrl);
                    }}
                    className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      setupTab === 'join'
                        ? 'bg-white text-zinc-900 shadow-xs'
                        : 'text-zinc-600 hover:text-zinc-900'
                    }`}
                  >
                    <UserPlus className="h-3.5 w-3.5 text-sky-700" />
                    <span>Join Session</span>
                  </button>
                </div>

                <div className="text-xs text-zinc-600 truncate">
                  <span className="font-semibold text-zinc-900">{userDeckSummary.deckName}</span>
                  <span className="mx-1.5 text-zinc-300" aria-hidden="true">·</span>
                  <span className="capitalize">{userDeckSummary.format}</span>
                  <span className="mx-1.5 text-zinc-300" aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums font-medium text-zinc-800">
                    {userDeckSummary.cardCount} cards
                  </span>
                  {userDeckSummary.commanders.length > 0 && (
                    <>
                      <span className="mx-1.5 text-zinc-300" aria-hidden="true">·</span>
                      <span className="text-sky-800 font-medium">
                        {userDeckSummary.commanders.join(' & ')}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {setupTab === 'host' ? (
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 items-start">
                  {/* Left Column (7 cols): Streamlined Room & Seat Configuration */}
                  <form
                    onSubmit={handleCreateRoom}
                    className="lg:col-span-7 rounded-xl border border-zinc-200 bg-white p-4 sm:p-5 space-y-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-bold text-zinc-900">
                          Room &amp; Pod Setup
                        </h3>
                        <p className="text-[11px] text-zinc-500">
                          Protected by Room Code, passcode, and Host Approval.
                        </p>
                      </div>

                      {/* Compact Mode Segmented Switch */}
                      <div className="inline-flex items-center rounded-lg bg-zinc-100 p-1 text-xs">
                        <button
                          type="button"
                          onClick={() => setConnectionMode('lan')}
                          className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                            connectionMode === 'lan'
                              ? 'bg-white text-zinc-900 shadow-xs'
                              : 'text-zinc-600 hover:text-zinc-900'
                          }`}
                        >
                          <Wifi className="h-3.5 w-3.5 text-sky-700" />
                          <span>Offline LAN</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setConnectionMode('online')}
                          className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                            connectionMode === 'online'
                              ? 'bg-white text-zinc-900 shadow-xs'
                              : 'text-zinc-600 hover:text-zinc-900'
                          }`}
                        >
                          <Globe className="h-3.5 w-3.5 text-sky-700" />
                          <span>Self-Hosted Online</span>
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label
                          htmlFor="mp-host-name"
                          className="block text-[11px] font-semibold text-zinc-700 mb-1"
                        >
                          Host Display Name
                        </label>
                        <input
                          id="mp-host-name"
                          type="text"
                          required
                          maxLength={32}
                          value={playerName}
                          onChange={(e) => setPlayerName(e.target.value)}
                          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs text-zinc-900 focus:border-sky-600 focus:outline-none"
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="mp-room-name"
                          className="block text-[11px] font-semibold text-zinc-700 mb-1"
                        >
                          Room Name
                        </label>
                        <input
                          id="mp-room-name"
                          type="text"
                          required
                          maxLength={48}
                          value={roomName}
                          onChange={(e) => setRoomName(e.target.value)}
                          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs text-zinc-900 focus:border-sky-600 focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-zinc-700 mb-1">
                          Pod Size
                        </label>
                        <div className="inline-flex w-full items-center gap-1 rounded-lg bg-zinc-100 p-1">
                          {([1, 2, 3, 4] as const).map((cnt) => (
                            <button
                              key={cnt}
                              type="button"
                              onClick={() => setMaxSeats(cnt)}
                              className={`flex-1 rounded-md px-2 py-1 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                                maxSeats === cnt
                                  ? 'bg-white text-zinc-900 shadow-xs'
                                  : 'text-zinc-600 hover:text-zinc-900'
                              }`}
                            >
                              {cnt === 1 ? '1P' : cnt === 2 ? '2P' : cnt === 3 ? '3P' : '4P'}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <label
                          htmlFor="mp-session-passcode"
                          className="block text-[11px] font-semibold text-zinc-700 mb-1"
                        >
                          Session Passcode
                        </label>
                        <div className="flex items-center gap-1.5">
                          <input
                            id="mp-session-passcode"
                            type="text"
                            required
                            minLength={4}
                            maxLength={24}
                            value={passcode}
                            onChange={(e) => setPasscode(e.target.value)}
                            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 font-mono text-xs font-bold tracking-wider text-zinc-900 focus:border-sky-600 focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => setPasscode(generateRandomPasscode())}
                            title="Generate a fresh random passcode"
                            className="rounded-lg border border-zinc-300 bg-zinc-50 px-2.5 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 cursor-pointer whitespace-nowrap"
                          >
                            New
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Seat Assignment List (only shown when > 1 seat) */}
                    {maxSeats > 1 && (
                      <div className="space-y-2 border-t border-zinc-100 pt-3">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-semibold text-zinc-800">
                            Seats 2–{maxSeats}
                          </span>
                          <span className="text-zinc-500">
                            Editable anytime in the Lobby
                          </span>
                        </div>

                        <div className="space-y-1.5">
                          {[1, 2, 3]
                            .filter((idx) => idx < maxSeats)
                            .map((seatIdx) => {
                              const cfg = initialSeatModes[seatIdx] || {
                                kind: 'open',
                                archetype: 'Mono-Red Aggro / Burn',
                              };
                              return (
                                <div
                                  key={seatIdx}
                                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-zinc-50/70 px-3 py-1.5 text-xs"
                                >
                                  <span className="font-semibold text-zinc-800">
                                    Seat #{seatIdx + 1}
                                  </span>

                                  <div className="flex flex-wrap items-center gap-2">
                                    <select
                                      aria-label={`Seat ${seatIdx + 1} controller type`}
                                      value={cfg.kind}
                                      onChange={(e) =>
                                        setInitialSeatModes((prev) => ({
                                          ...prev,
                                          [seatIdx]: {
                                            ...cfg,
                                            kind: e.target.value as 'open' | 'bot',
                                          },
                                        }))
                                      }
                                      className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-800"
                                    >
                                      <option value="open">Open for Friend</option>
                                      <option value="bot">AI Bot</option>
                                    </select>

                                    {cfg.kind === 'bot' && (
                                      <select
                                        aria-label={`Seat ${seatIdx + 1} AI Bot archetype`}
                                        value={cfg.archetype}
                                        onChange={(e) =>
                                          setInitialSeatModes((prev) => ({
                                            ...prev,
                                            [seatIdx]: {
                                              ...cfg,
                                              archetype: e.target.value,
                                            },
                                          }))
                                        }
                                        className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-800"
                                      >
                                        {BOT_ARCHETYPES.map((arch) => (
                                          <option key={arch} value={arch}>
                                            {arch}
                                          </option>
                                        ))}
                                      </select>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-3 border-t border-zinc-100 pt-3">
                      <span className="text-[11px] text-zinc-500">
                        {connectionMode === 'lan'
                          ? 'Same-Wi-Fi LAN mode · no router setup needed'
                          : 'Remote WAN mode · forward TCP port on right'}
                      </span>
                      <button
                        type="submit"
                        disabled={busyAction}
                        className="inline-flex items-center gap-2 rounded-lg bg-sky-700 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-800 disabled:opacity-50 cursor-pointer whitespace-nowrap"
                      >
                        {busyAction ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            <span>Creating...</span>
                          </>
                        ) : (
                          <>
                            <ShieldCheck className="h-3.5 w-3.5" />
                            <span>Create Multiplayer Room</span>
                          </>
                        )}
                      </button>
                    </div>
                  </form>

                  {/* Right Column (5 cols): Local IP, Port Check & Port-Forwarding Helper */}
                  <div className="lg:col-span-5">
                    <NetworkSetupPanel
                      netInfo={netInfo}
                      loadingNetInfo={loadingNetInfo}
                      onRefreshDiagnostics={() => void refreshNetworkDiagnostics()}
                      externalHostInput={externalHostInput}
                      onExternalHostInputChange={setExternalHostInput}
                      testingPort={testingPort}
                      portTestOk={portTestOk}
                      portTestMessage={portTestMessage}
                      onRunPortCheck={() => void handleRunPortCheck()}
                      connectionMode={connectionMode}
                    />
                  </div>
                </div>
              ) : (
                /* ============================================================================
                   JOIN SESSION TAB (GUEST FLOW + LAN DISCOVERY + APPROVAL GATE WAIT)
                   ============================================================================ */
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 items-start">
                  <form
                    onSubmit={handleRequestJoinRoom}
                    className="lg:col-span-7 rounded-xl border border-zinc-200 bg-white p-4 sm:p-5 space-y-4"
                  >
                    <div>
                      <h3 className="text-sm font-bold text-zinc-900">
                        Join a Friend&apos;s Table
                      </h3>
                      <p className="text-[11px] text-zinc-500">
                        Leave Host URL blank if you opened your friend&apos;s shared browser link directly.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label
                          htmlFor="mp-join-host-url"
                          className="block text-[11px] font-semibold text-zinc-700 mb-1"
                        >
                          Host Server URL (Optional)
                        </label>
                        <input
                          id="mp-join-host-url"
                          type="text"
                          value={joinHostUrl}
                          onChange={(e) => setJoinHostUrl(e.target.value)}
                          placeholder="http://192.168.1.42:3000"
                          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 font-mono text-xs text-zinc-900 focus:border-sky-600 focus:outline-none"
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="mp-join-player-name"
                          className="block text-[11px] font-semibold text-zinc-700 mb-1"
                        >
                          Your Display Name
                        </label>
                        <input
                          id="mp-join-player-name"
                          type="text"
                          required
                          maxLength={32}
                          value={playerName}
                          onChange={(e) => setPlayerName(e.target.value)}
                          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs text-zinc-900 focus:border-sky-600 focus:outline-none"
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="mp-join-room-code"
                          className="block text-[11px] font-semibold text-zinc-700 mb-1"
                        >
                          Room Code
                        </label>
                        <input
                          id="mp-join-room-code"
                          type="text"
                          required
                          maxLength={12}
                          value={joinRoomCode}
                          onChange={(e) => setJoinRoomCode(e.target.value.toUpperCase())}
                          placeholder="UP-XXXX"
                          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 font-mono text-xs font-bold uppercase tracking-wider text-zinc-900 focus:border-sky-600 focus:outline-none"
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="mp-join-passcode"
                          className="block text-[11px] font-semibold text-zinc-700 mb-1"
                        >
                          Session Passcode
                        </label>
                        <input
                          id="mp-join-passcode"
                          type="password"
                          required
                          maxLength={32}
                          value={joinPasscode}
                          onChange={(e) => setJoinPasscode(e.target.value)}
                          placeholder="Enter host passcode"
                          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 font-mono text-xs text-zinc-900 focus:border-sky-600 focus:outline-none"
                        />
                      </div>
                    </div>

                    {pendingRequestStatus === 'pending' && (
                      <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
                        <div className="flex items-center gap-2.5">
                          <Loader2 className="h-4 w-4 animate-spin text-amber-700 shrink-0" />
                          <div>
                            <div className="font-bold">
                              Waiting for Host Approval...
                            </div>
                            <div className="text-[11px] text-amber-800">
                              Request ID <span className="font-mono">{pendingRequestId}</span> verified. Host can now approve your seat.
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setPendingRequestStatus(null);
                            setPendingRequestToken(null);
                          }}
                          className="rounded border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-zinc-800 hover:bg-zinc-50 cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    )}

                    <div className="flex items-center justify-end border-t border-zinc-100 pt-3">
                      <button
                        type="submit"
                        disabled={busyAction || pendingRequestStatus === 'pending'}
                        className="inline-flex items-center gap-2 rounded-lg bg-sky-700 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-800 disabled:opacity-50 cursor-pointer whitespace-nowrap"
                      >
                        <Lock className="h-3.5 w-3.5" />
                        <span>Request to Join</span>
                      </button>
                    </div>
                  </form>

                  {/* Discovered Active Rooms on Target Host */}
                  <div className="lg:col-span-5 rounded-xl border border-zinc-200 bg-zinc-50/70 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <h3 className="text-xs font-bold uppercase tracking-wide text-zinc-900">
                          Active Host Rooms
                        </h3>
                        <p className="text-[11px] text-zinc-500">
                          Click a session to fill its Room Code.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void refreshDiscoveredRooms(joinHostUrl)}
                        disabled={loadingDiscovered}
                        className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-100 cursor-pointer"
                      >
                        <RefreshCw
                          className={`h-3 w-3 ${loadingDiscovered ? 'animate-spin' : ''}`}
                        />
                        <span>Scan</span>
                      </button>
                    </div>

                    {discoveredRooms.length === 0 ? (
                      <div className="rounded-lg border border-zinc-200 bg-white p-3.5 text-xs text-zinc-500">
                        No open rooms detected yet. Enter the host&apos;s Room Code directly or click Scan after the host creates a session.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {discoveredRooms.map((r) => (
                          <button
                            key={r.roomCode}
                            type="button"
                            onClick={() => setJoinRoomCode(r.roomCode)}
                            className={`flex w-full items-center justify-between gap-3 rounded-lg border p-2.5 text-left text-xs transition-colors cursor-pointer ${
                              joinRoomCode === r.roomCode
                                ? 'border-sky-600 bg-sky-50'
                                : 'border-zinc-200 bg-white hover:bg-zinc-50'
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="font-bold text-zinc-900 truncate">
                                {r.roomName}
                              </div>
                              <div className="text-[11px] text-zinc-600">
                                <span className="font-mono font-bold text-sky-800">
                                  {r.roomCode}
                                </span>
                                <span className="mx-1.5 text-zinc-300">·</span>
                                <span className="capitalize">{r.format}</span>
                                <span className="mx-1.5 text-zinc-300">·</span>
                                <span className="font-mono tabular-nums">
                                  {r.occupiedSeats}/{r.maxSeats} seats
                                </span>
                              </div>
                            </div>
                            <span className="font-semibold text-sky-700 shrink-0">
                              Select
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : room.status === 'lobby' || !tabletop ? (
            /* ============================================================================
               VIEW 2: MULTIPLAYER POD LOBBY & HOST APPROVAL GATE (1–4 HYBRID SEATS)
               ============================================================================ */
            <MultiplayerLobby
              room={room}
              callerSeatIdx={callerSeatIdx}
              passcode={passcode}
              onPasscodeRotated={setPasscode}
              shareEndpointUrl={shareEndpointUrl}
              busyAction={busyAction}
              onUpdateLobbySettings={handleUpdateLobbySettings}
              onConfigureSeat={handleConfigureSeat}
              onApproveOrDenyRequest={handleApproveOrDenyRequest}
              onToggleReady={handleToggleReady}
              onStartMatch={handleStartMatch}
              onSendChat={handleSendChatText}
              onUpdateSeatLife={handleUpdateSeatLife}
              onOpenPlaymatCustomizer={() => setShowPlaymatCustomizer(true)}
              onOpenCustomCardsModal={() => {
                setCustomCardsInitialTab('card-art');
                setShowCustomCardsModal(true);
              }}
            />
          ) : (
            /* ============================================================================
               VIEW 3: LIVE SYNCHRONIZED MULTIPLAYER TABLETOP ARENA (1–4 PLAYERS + AI BOTS)
               ============================================================================ */
            <div
              className={`relative overflow-hidden rounded-xl border-2 p-4 text-zinc-100 space-y-4 transition-colors ${mpTabletopSurface.outerClass}`}
            >
              <PlaymatSurfaceBackdrop surface={mpTabletopSurface} variant="table" />
              {/* Top Multiplayer Match HUD Bar */}
              <div
                className={`relative z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-2.5 text-xs ${mpTabletopSurface.hudClass}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-bold text-amber-300 tabular-nums">
                    TURN {tabletop.turnNumber}
                  </span>
                  <span className="text-sky-400/50">·</span>
                  <span className="font-bold text-white uppercase">
                    Phase: {tabletop.phase}
                  </span>
                  <span className="text-sky-400/50">·</span>
                  <span className="font-semibold text-emerald-300">
                    Active Turn:{' '}
                    {tabletop.seats[tabletop.activeSeatIndex]?.playerName || 'Seat 1'}
                    {tabletop.activeSeatIndex === callerSeatIdx ? ' (YOUR TURN)' : ''}
                  </span>
                  <span className="text-sky-400/50">·</span>
                  <span className="font-mono text-[11px] tabular-nums text-sky-200">
                    Room {room.roomCode}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void dispatchGameAction({ type: 'next-phase' })}
                    className="inline-flex items-center gap-1 rounded-md border border-sky-400/50 bg-sky-500/20 px-2.5 py-1 text-xs font-semibold text-sky-100 hover:bg-sky-500/30 cursor-pointer"
                  >
                    <span>Next Phase</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => void dispatchGameAction({ type: 'pass-turn' })}
                    className="inline-flex items-center gap-1 rounded-md bg-amber-400 px-3 py-1 text-xs font-bold text-zinc-950 hover:bg-amber-300 cursor-pointer"
                  >
                    <span>Pass Turn</span>
                  </button>

                  {tabletop.seats[tabletop.activeSeatIndex]?.kind === 'bot' && (
                    <button
                      type="button"
                      onClick={() => void dispatchGameAction({ type: 'run-bot-step' })}
                      className="inline-flex items-center gap-1 rounded-md border border-violet-400/60 bg-violet-500/25 px-2.5 py-1 text-xs font-semibold text-violet-100 hover:bg-violet-500/40 cursor-pointer"
                    >
                      <Bot className="h-3.5 w-3.5" />
                      <span>Step Bot Turn</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setCustomCardsInitialTab('card-art');
                      setShowCustomCardsModal(true);
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-violet-400/50 bg-violet-950/60 px-2.5 py-1 text-xs font-semibold text-violet-100 hover:bg-violet-900/70 cursor-pointer"
                  >
                    <Wand2 className="h-3.5 w-3.5 text-violet-300" />
                    <span>Proxies &amp; Tokens</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowPlaymatCustomizer(true)}
                    className="inline-flex items-center gap-1 rounded-md border border-emerald-400/50 bg-emerald-950/60 px-2.5 py-1 text-xs font-semibold text-emerald-100 hover:bg-emerald-900/70 cursor-pointer"
                  >
                    <Palette className="h-3.5 w-3.5 text-emerald-300" />
                    <span>Playmats &amp; Theme</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowChatDrawer((v) => !v)}
                    className="inline-flex items-center gap-1 rounded-md border border-sky-400/40 bg-[#0D233A] px-2.5 py-1 text-xs font-semibold text-sky-200 hover:bg-[#132E4B] cursor-pointer"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    <span>Table Chat ({room.chatMessages.length})</span>
                  </button>

                  {room.isHost && (
                    <button
                      type="button"
                      onClick={() => void dispatchGameAction({ type: 'reset-match' })}
                      className="inline-flex items-center gap-1 rounded-md border border-red-400/40 bg-red-950/50 px-2.5 py-1 text-xs font-semibold text-red-200 hover:bg-red-900/60 cursor-pointer"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>Rematch</span>
                    </button>
                  )}
                </div>
              </div>

              {tabletop.winReason && (
                <div className="relative z-10 rounded-lg border border-amber-400 bg-amber-500/20 px-4 py-3 text-center text-sm font-bold text-amber-200">
                  {tabletop.winReason}
                </div>
              )}

              {/* Opponent / Pod Seats Row */}
              <div
                className={`relative z-10 grid grid-cols-1 gap-3 ${
                  opponentSeats.length === 1
                    ? 'lg:grid-cols-1'
                    : opponentSeats.length === 2
                    ? 'lg:grid-cols-2'
                    : 'lg:grid-cols-3'
                }`}
              >
                {opponentSeats.map((oppSeat) => {
                  const isTurn = tabletop.activeSeatIndex === oppSeat.seatIndex;
                  const seatNum = Math.min(4, Math.max(1, oppSeat.seatIndex + 1)) as
                    | 1
                    | 2
                    | 3
                    | 4;
                  const roomSeatMeta = room.seats[oppSeat.seatIndex];
                  const oppSeatSurface = resolveSeatPlaymatSurface(
                    playmatPrefs,
                    seatNum,
                    {
                      isYourSeat: false,
                      remoteSeatOverride: roomSeatMeta
                        ? {
                            playmatThemeId: roomSeatMeta.playmatThemeId,
                            playmatArtworkPresetId: roomSeatMeta.playmatArtworkPresetId,
                            playmatCustomImageUrl: roomSeatMeta.playmatCustomImageUrl,
                          }
                        : undefined,
                      remoteTabletopOverride,
                    }
                  );
                  return (
                    <div
                      key={oppSeat.seatIndex}
                      className={`relative overflow-hidden rounded-lg border p-3 space-y-2.5 transition-colors ${
                        isTurn
                          ? oppSeatSurface.seatActiveClass
                          : oppSeatSurface.seatClass
                      }`}
                    >
                      <PlaymatSurfaceBackdrop surface={oppSeatSurface} variant="seat" />
                      <div className="relative z-10 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-sky-300">
                            #{oppSeat.seatIndex + 1}
                          </span>
                          <span className="text-xs font-bold text-white">
                            {oppSeat.playerName}
                          </span>
                          <span className="text-[11px] text-sky-200/80">
                            · {oppSeat.kind === 'bot' ? 'AI Bot' : 'Human'}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 font-mono text-xs tabular-nums">
                          <span className="font-bold text-emerald-300">
                            {oppSeat.life} Life
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              void dispatchGameAction({
                                type: 'adjust-life',
                                targetSeatIndex: oppSeat.seatIndex,
                                delta: -1,
                              })
                            }
                            className="rounded border border-sky-500/40 bg-[#0D2137] px-1.5 py-0.5 text-[10px] text-sky-200 hover:bg-sky-800/50 cursor-pointer"
                          >
                            -1
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void dispatchGameAction({
                                type: 'adjust-life',
                                targetSeatIndex: oppSeat.seatIndex,
                                delta: 1,
                              })
                            }
                            className="rounded border border-sky-500/40 bg-[#0D2137] px-1.5 py-0.5 text-[10px] text-sky-200 hover:bg-sky-800/50 cursor-pointer"
                          >
                            +1
                          </button>
                          <span className="text-sky-300/70">·</span>
                          <span className="text-violet-300">
                            {oppSeat.poison} Poison
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono tabular-nums text-sky-200/80">
                        <span>Hand: {oppSeat.handCount} (Hidden)</span>
                        <span>·</span>
                        <span>Library: {oppSeat.libraryCount}</span>
                        <span>·</span>
                        <span>Graveyard: {oppSeat.graveyard.length}</span>
                        {oppSeat.commandZone.length > 0 && (
                          <>
                            <span>·</span>
                            <span className="text-amber-300">
                              Cmdr: {oppSeat.commandZone.map((c) => c.name).join(', ')} (+{'{'}
                              {oppSeat.commanderTax}
                              {'}'})
                            </span>
                          </>
                        )}
                      </div>

                      {/* Opponent / Bot Free-Form Playmat Canvas */}
                      <div
                        ref={(el) => {
                          botPlaymatRefs.current[oppSeat.seatIndex] = el;
                        }}
                        className="relative z-10 min-h-[185px] overflow-hidden rounded-lg border border-sky-500/25 bg-[#07111E]/90 p-2 select-none"
                      >
                        <div className="flex items-center justify-between gap-2 pb-1">
                          <span className="font-mono text-[9px] uppercase tracking-wider text-sky-200/55 inline-flex items-center gap-1">
                            <Move className="h-2.5 w-2.5" />
                            <span>
                              {oppSeat.kind === 'bot'
                                ? 'Bot Playmat · Drag cards anywhere'
                                : 'Opponent Playmat'}
                            </span>
                          </span>
                          {oppSeat.kind === 'bot' && oppSeat.battlefield.length > 0 && (
                            <button
                              type="button"
                              onClick={() =>
                                void dispatchGameAction({
                                  type: 'auto-arrange-playmat',
                                  targetSeatIndex: oppSeat.seatIndex,
                                })
                              }
                              className="inline-flex items-center gap-1 rounded border border-sky-400/35 bg-[#0D2137] px-1.5 py-0.5 text-[9px] font-semibold text-sky-200 hover:bg-sky-900/60 cursor-pointer"
                            >
                              <LayoutGrid className="h-2.5 w-2.5" />
                              <span>Tidy</span>
                            </button>
                          )}
                        </div>

                        {showPlaymatGuides && (
                          <div className="pointer-events-none absolute inset-x-2.5 top-[48%] border-t border-dashed border-sky-400/20" />
                        )}

                        {oppSeat.battlefield.length === 0 ? (
                          <div className="flex h-[135px] items-center justify-center text-[11px] text-sky-200/50">
                            No permanents on battlefield
                          </div>
                        ) : (
                          <div className="relative h-[150px] w-full">
                            {oppSeat.battlefield.map((perm, pIdx) => {
                              const vis = resolveMultiplayerCardInstance(perm, false);
                              const coordKey = `${oppSeat.seatIndex}:${perm.uid}`;
                              const isDraggingThis =
                                mpPointerDrag?.kind === 'bot' &&
                                mpPointerDrag.seatIndex === oppSeat.seatIndex &&
                                mpPointerDrag.uid === perm.uid;
                              const optCoord = optimisticCoords[coordKey];
                              const fallbackSpot = computeOpenBotPlaymatSpot(
                                oppSeat.battlefield.slice(0, pIdx),
                                {
                                  preferFront: !isBacklinePlaymatCard(perm),
                                }
                              );
                              const posX = isDraggingThis
                                ? mpPointerDrag.x
                                : optCoord
                                ? optCoord.x
                                : typeof perm.playmatX === 'number'
                                ? perm.playmatX
                                : fallbackSpot.x;
                              const posY = isDraggingThis
                                ? mpPointerDrag.y
                                : optCoord
                                ? optCoord.y
                                : typeof perm.playmatY === 'number'
                                ? perm.playmatY
                                : isBacklinePlaymatCard(perm)
                                ? 24
                                : Math.max(54, fallbackSpot.y);
                              const posZ = isDraggingThis ? 60 : perm.playmatZ ?? pIdx + 2;

                              return (
                                <div
                                  key={perm.uid}
                                  style={{
                                    left: `${posX}%`,
                                    top: `${posY}%`,
                                    zIndex: posZ,
                                    transform: 'translate(-50%, -50%)',
                                  }}
                                  onPointerDown={(ev) => {
                                    if (oppSeat.kind !== 'bot') return;
                                    startMpPointerDrag(ev, {
                                      kind: 'bot',
                                      seatIndex: oppSeat.seatIndex,
                                      uid: perm.uid,
                                      name: vis.displayTitle,
                                      initialX: posX,
                                      initialY: posY,
                                    });
                                  }}
                                  className={`absolute w-[144px] touch-none ${
                                    isDraggingThis
                                      ? 'transition-none ring-2 ring-amber-300 shadow-2xl scale-[1.04]'
                                      : 'transition-[left,top] duration-200 ease-out'
                                  } ${
                                    oppSeat.kind === 'bot'
                                      ? 'cursor-grab active:cursor-grabbing'
                                      : ''
                                  }`}
                                >
                                  <button
                                    type="button"
                                    onClick={(ev) => {
                                      if (suppressCardClickRef.current) {
                                        ev.preventDefault();
                                        return;
                                      }
                                      onInspectCard(vis.displayTitle, vis.inspectMeta);
                                    }}
                                    className={`flex w-full items-center gap-1.5 rounded border px-1.5 py-1 text-left text-[10px] transition-transform cursor-pointer ${
                                      perm.tapped
                                        ? 'rotate-3 border-amber-400/50 bg-amber-950/75 text-amber-200'
                                        : 'border-sky-400/45 bg-[#10263F]/95 text-white hover:border-sky-300'
                                    } ${getCustomFrameBorderClass(vis.frameStyle)}`}
                                  >
                                    {vis.effectiveImageUri && (
                                      <img
                                        src={vis.effectiveImageUri}
                                        alt={vis.displayTitle}
                                        draggable={false}
                                        className="h-7 w-9 rounded object-cover border border-white/15 shrink-0"
                                      />
                                    )}
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-1">
                                        <span className="font-semibold truncate">
                                          {vis.displayTitle}
                                        </span>
                                        {vis.badgeLabel && (
                                          <span className="rounded bg-amber-400 px-1 font-mono text-[7px] font-bold text-zinc-950 shrink-0">
                                            {vis.badgeLabel}
                                          </span>
                                        )}
                                      </div>
                                      <div className="font-mono text-[9px] text-sky-300 truncate">
                                        {perm.power && perm.toughness
                                          ? `${perm.power}/${perm.toughness}`
                                          : perm.typeLine.split('—')[0].trim()}
                                        {perm.tapped ? ' · Tapped' : ''}
                                      </div>
                                    </div>
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Shared LIFO Visual Stack & Trigger Resolution Queue */}
              <div className="rounded-lg border border-sky-400/40 bg-[#0B1C2E] p-3.5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs">
                    <Layers className="h-4 w-4 text-amber-300" />
                    <span className="font-bold text-white uppercase tracking-wide">
                      Shared LIFO Stack &amp; Trigger Queue (CR 405)
                    </span>
                    <span className="font-mono text-amber-300 tabular-nums font-bold">
                      · {tabletop.stack.length}{' '}
                      {tabletop.stack.length === 1 ? 'Item' : 'Items'}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {tabletop.stack.length > 0 && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            void dispatchGameAction({ type: 'resolve-top' })
                          }
                          className="inline-flex items-center gap-1 rounded-md bg-amber-400 px-3 py-1 text-xs font-bold text-zinc-950 hover:bg-amber-300 cursor-pointer"
                        >
                          <Check className="h-3.5 w-3.5" />
                          <span>Resolve Top (#1)</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void dispatchGameAction({ type: 'pass-priority' })
                          }
                          className="inline-flex items-center gap-1 rounded-md border border-emerald-400/60 bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/35 cursor-pointer"
                        >
                          <span>Pass Priority (Resolve All)</span>
                        </button>
                      </>
                    )}
                    {tabletop.resolvedHistory.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowResolvedHistory((v) => !v)}
                        className="rounded border border-sky-400/40 bg-[#0F243C] px-2.5 py-1 text-[11px] font-semibold text-sky-200 hover:bg-[#153152] cursor-pointer"
                      >
                        {showResolvedHistory
                          ? 'Hide Resolved History'
                          : `Resolved History (${tabletop.resolvedHistory.length})`}
                      </button>
                    )}
                  </div>
                </div>

                {reversedStack.length === 0 ? (
                  <div className="text-xs text-sky-200/70">
                    Stack is empty. Cast a spell or push a triggered ability below to place it on top of the LIFO resolution queue.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {reversedStack.map(({ item, resolutionRank }, idx) => (
                      <React.Fragment key={item.id}>
                        <div className="animate-stack-item-slide flex items-start justify-between gap-3 rounded-lg border border-amber-400/60 bg-[#132942] p-2.5 text-xs">
                          <div className="flex items-start gap-2.5 min-w-0">
                            <span className="rounded bg-amber-400 px-2 py-0.5 font-mono text-[11px] font-bold text-zinc-950 shrink-0">
                              #{resolutionRank} {idx === 0 ? 'NEXT UP' : ''}
                            </span>
                            <div className="min-w-0 space-y-0.5">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-bold text-white">
                                  {item.cardName}
                                </span>
                                <span className="text-[11px] font-semibold text-sky-300 uppercase">
                                  · {item.kind.replace('-', ' ')}
                                </span>
                                <span className="text-[11px] text-emerald-300">
                                  · Controller: {item.seatName}
                                </span>
                              </div>
                              <div className="text-[11px] text-sky-100/90">
                                {item.effectSummary}
                              </div>
                            </div>
                          </div>
                        </div>
                        {idx < reversedStack.length - 1 && (
                          <div className="animate-stack-flow-slide flex items-center gap-1.5 pl-4 font-mono text-[10px] text-sky-300/80">
                            <ArrowDown className="h-3 w-3 text-amber-300" />
                            <span>
                              Then resolves #{resolutionRank + 1} (
                              {reversedStack[idx + 1].item.cardName})
                            </span>
                          </div>
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                )}

                {showResolvedHistory && tabletop.resolvedHistory.length > 0 && (
                  <div className="border-t border-sky-500/30 pt-2.5 space-y-1 text-[11px] text-sky-200/80">
                    {tabletop.resolvedHistory.slice(0, 8).map((h) => (
                      <div key={h.id} className="flex items-center justify-between gap-2">
                        <span>
                          <strong className="text-white">T{h.turnNumber}</strong> ·{' '}
                          {h.seatName} · <strong className="text-amber-200">{h.cardName}</strong>:{' '}
                          {h.summary}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Your Seat Interactive Battlefield, Command Zone, Private Hand & Table Chat */}
              {mySeatGame && (() => {
                const mySeatNum = Math.min(4, Math.max(1, mySeatGame.seatIndex + 1)) as
                  | 1
                  | 2
                  | 3
                  | 4;
                const myRoomSeatMeta = room.seats[mySeatGame.seatIndex];
                const mySeatSurface = resolveSeatPlaymatSurface(
                  playmatPrefs,
                  mySeatNum,
                  {
                    isYourSeat: true,
                    remoteSeatOverride: myRoomSeatMeta
                      ? {
                          playmatThemeId: myRoomSeatMeta.playmatThemeId,
                          playmatArtworkPresetId: myRoomSeatMeta.playmatArtworkPresetId,
                          playmatCustomImageUrl: myRoomSeatMeta.playmatCustomImageUrl,
                        }
                      : undefined,
                    remoteTabletopOverride,
                  }
                );
                return (
                <div className="relative z-10 grid grid-cols-1 gap-4 lg:grid-cols-12">
                  <div
                    className={`${
                      showChatDrawer ? 'lg:col-span-8' : 'lg:col-span-12'
                    } relative overflow-hidden rounded-lg border p-4 space-y-4 transition-colors ${mySeatSurface.seatClass}`}
                  >
                    <PlaymatSurfaceBackdrop surface={mySeatSurface} variant="seat" />
                    {/* Your Seat Status & Controls */}
                    <div
                      className={`relative z-10 flex flex-wrap items-center justify-between gap-3 border-b pb-3 ${mySeatSurface.dividerBorderClass}`}
                    >
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-bold text-emerald-300">
                          YOU · Seat #{mySeatGame.seatIndex + 1} ({mySeatGame.playerName})
                        </span>
                        <span className="text-sky-400/40">·</span>
                        <span className="font-mono font-bold tabular-nums text-white">
                          {mySeatGame.life} Life
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            void dispatchGameAction({
                              type: 'adjust-life',
                              targetSeatIndex: mySeatGame.seatIndex,
                              delta: -1,
                            })
                          }
                          className="rounded border border-sky-400/40 bg-[#10263F] px-2 py-0.5 font-mono text-[11px] text-sky-100 hover:bg-sky-800/50 cursor-pointer"
                        >
                          -1
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void dispatchGameAction({
                              type: 'adjust-life',
                              targetSeatIndex: mySeatGame.seatIndex,
                              delta: 1,
                            })
                          }
                          className="rounded border border-sky-400/40 bg-[#10263F] px-2 py-0.5 font-mono text-[11px] text-sky-100 hover:bg-sky-800/50 cursor-pointer"
                        >
                          +1
                        </button>
                        <span className="text-sky-400/40">·</span>
                        <span className="font-mono tabular-nums text-violet-300">
                          {mySeatGame.poison} Poison
                        </span>
                        <span className="text-sky-400/40">·</span>
                        <span className="font-mono tabular-nums text-amber-300">
                          Mana Pool: {mySeatGame.manaPool}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            void dispatchGameAction({ type: 'add-mana', delta: 1 })
                          }
                          className="rounded border border-amber-400/50 bg-amber-500/20 px-2 py-0.5 font-mono text-[11px] text-amber-200 hover:bg-amber-500/30 cursor-pointer"
                        >
                          +1 Mana
                        </button>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setCustomCardsInitialTab('custom-tokens');
                            setShowCustomCardsModal(true);
                          }}
                          className="inline-flex items-center gap-1 rounded-md border border-amber-400/60 bg-amber-500/20 px-2.5 py-1 text-xs font-semibold text-amber-200 hover:bg-amber-500/35 cursor-pointer"
                        >
                          <Sparkles className="h-3.5 w-3.5 text-amber-300" />
                          <span>+ Token</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setCustomCardsInitialTab('playtest-proxies');
                            setShowCustomCardsModal(true);
                          }}
                          className="inline-flex items-center gap-1 rounded-md border border-violet-400/60 bg-violet-500/20 px-2.5 py-1 text-xs font-semibold text-violet-200 hover:bg-violet-500/35 cursor-pointer"
                        >
                          <Wand2 className="h-3.5 w-3.5 text-violet-300" />
                          <span>+ Proxy</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void dispatchGameAction({ type: 'draw-card' })
                          }
                          className="inline-flex items-center gap-1 rounded-md border border-sky-400/50 bg-sky-500/20 px-2.5 py-1 text-xs font-semibold text-sky-100 hover:bg-sky-500/35 cursor-pointer"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          <span>Draw Card ({mySeatGame.libraryCount})</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void dispatchGameAction({ type: 'mulligan' })
                          }
                          className="inline-flex items-center gap-1 rounded-md border border-sky-400/40 bg-[#10263F] px-2.5 py-1 text-xs font-semibold text-sky-200 hover:bg-[#163456] cursor-pointer"
                        >
                          <Shuffle className="h-3.5 w-3.5" />
                          <span>London Mulligan</span>
                        </button>
                      </div>
                    </div>

                    {/* Command Zone & Manual Trigger Builder */}
                    <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-amber-300">
                          Command Zone (+{'{'}
                          {mySeatGame.commanderTax}
                          {'}'} tax):
                        </span>
                        {mySeatGame.commandZone.length === 0 ? (
                          <span className="text-sky-200/60">Empty</span>
                        ) : (
                          mySeatGame.commandZone.map((cmd) => (
                            <button
                              key={cmd.uid}
                              type="button"
                              onClick={() =>
                                void dispatchGameAction({
                                  type: 'cast-commander',
                                  cardUid: cmd.uid,
                                })
                              }
                              className="inline-flex items-center gap-1.5 rounded-md border border-amber-400/70 bg-amber-500/20 px-2.5 py-1 text-xs font-bold text-amber-200 hover:bg-amber-500/35 cursor-pointer"
                            >
                              <Crown className="h-3.5 w-3.5" />
                              <span>Cast {cmd.name} to Stack</span>
                            </button>
                          ))
                        )}
                      </div>

                      {mySeatGame.battlefield.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <select
                            aria-label="Select permanent for triggered ability"
                            value={
                              triggerPermUid || mySeatGame.battlefield[0]?.uid || ''
                            }
                            onChange={(e) => setTriggerPermUid(e.target.value)}
                            className="rounded border border-violet-400/50 bg-[#0D1F33] px-2 py-1 text-[11px] text-white"
                          >
                            {mySeatGame.battlefield.map((p) => (
                              <option key={p.uid} value={p.uid}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                          <select
                            aria-label="Select trigger kind"
                            value={triggerKind}
                            onChange={(e) =>
                              setTriggerKind(
                                e.target.value as
                                  | 'etb'
                                  | 'landfall'
                                  | 'upkeep'
                                  | 'attack'
                                  | 'dies'
                                  | 'activated'
                              )
                            }
                            className="rounded border border-violet-400/50 bg-[#0D1F33] px-2 py-1 text-[11px] text-white"
                          >
                            <option value="etb">ETB Trigger</option>
                            <option value="landfall">Landfall Trigger</option>
                            <option value="upkeep">Upkeep Trigger</option>
                            <option value="attack">Attack Trigger</option>
                            <option value="dies">Dies Trigger</option>
                            <option value="activated">Activated Ability</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => {
                              const sourceUid =
                                triggerPermUid || mySeatGame.battlefield[0]?.uid;
                              if (!sourceUid) return;
                              void dispatchGameAction({
                                type: 'push-trigger',
                                sourceUid,
                                triggerKind,
                              });
                            }}
                            className="inline-flex items-center gap-1 rounded bg-violet-500 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-violet-400 cursor-pointer"
                          >
                            <Zap className="h-3 w-3" />
                            <span>Push Trigger</span>
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Your Free-Form Playmat Battlefield + Combat Attack Controls */}
                    <div className="relative z-10 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-sky-200">
                            Your Playmat ({mySeatGame.battlefield.length})
                          </span>
                          <span className="hidden sm:inline-flex items-center gap-1 text-[10px] text-sky-200/70">
                            <Move className="h-3 w-3 text-sky-300" />
                            <span>Drag cards anywhere on playmat · Drop from hand to play</span>
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setShowPlaymatGuides((v) => !v)}
                            className={`rounded border px-2 py-0.5 text-[10px] font-semibold cursor-pointer ${
                              showPlaymatGuides
                                ? 'border-sky-400/60 bg-sky-500/20 text-sky-100'
                                : 'border-sky-500/35 bg-[#0B1C2E] text-sky-300 hover:text-white'
                            }`}
                          >
                            Guides: {showPlaymatGuides ? 'On' : 'Off'}
                          </button>

                          {mySeatGame.battlefield.length > 0 && (
                            <button
                              type="button"
                              onClick={() =>
                                void dispatchGameAction({
                                  type: 'auto-arrange-playmat',
                                  targetSeatIndex: mySeatGame.seatIndex,
                                })
                              }
                              className="inline-flex items-center gap-1 rounded border border-sky-500/40 bg-[#0B1C2E] px-2 py-0.5 text-[10px] font-semibold text-sky-200 hover:bg-[#14304E] cursor-pointer"
                            >
                              <LayoutGrid className="h-3 w-3" />
                              <span>Tidy Board</span>
                            </button>
                          )}

                          {selectedAttackerUids.length > 0 && opponentSeats.length > 0 && (
                            <div className="flex items-center gap-1.5 ml-1">
                              <select
                                aria-label="Select defending player seat"
                                value={attackTargetSeatIdx}
                                onChange={(e) =>
                                  setAttackTargetSeatIdx(Number(e.target.value))
                                }
                                className="rounded border border-amber-400/60 bg-[#0F243C] px-2 py-0.5 text-[11px] text-white"
                              >
                                {opponentSeats.map((opp) => (
                                  <option key={opp.seatIndex} value={opp.seatIndex}>
                                    Attack {opp.playerName} ({opp.life})
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                onClick={() => {
                                  const targetIdx = opponentSeats.some(
                                    (o) => o.seatIndex === attackTargetSeatIdx
                                  )
                                    ? attackTargetSeatIdx
                                    : opponentSeats[0].seatIndex;
                                  void dispatchGameAction({
                                    type: 'declare-attack',
                                    attackerUids: selectedAttackerUids,
                                    targetSeatIndex: targetIdx,
                                  });
                                  setSelectedAttackerUids([]);
                                }}
                                className="inline-flex items-center gap-1 rounded bg-red-600 px-2.5 py-0.5 text-[11px] font-bold text-white hover:bg-red-500 cursor-pointer"
                              >
                                <Swords className="h-3 w-3" />
                                <span>
                                  Attack ({selectedAttackerUids.length})
                                </span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      <div
                        ref={selfPlaymatRef}
                        onDragOver={(e) => {
                          if (mpHandDrag) e.preventDefault();
                        }}
                        onDrop={handleDropOnSelfPlaymat}
                        className={`relative min-h-[340px] sm:min-h-[370px] overflow-hidden rounded-xl border p-3 transition-colors select-none ${
                          mpHandDrag
                            ? 'border-amber-400 ring-2 ring-amber-400/70 bg-[#091829]/95'
                            : 'border-sky-500/30 bg-[#071220]/90'
                        }`}
                      >
                        {showPlaymatGuides && (
                          <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3">
                            <div className="border-b border-dashed border-red-400/20 pb-1 flex items-center justify-between">
                              <span className="font-mono text-[9px] uppercase tracking-wider text-red-200/45">
                                Frontline · Creatures &amp; Attackers
                              </span>
                              <span className="font-mono text-[9px] text-sky-200/40">
                                Free-Form Playmat
                              </span>
                            </div>
                            <div className="border-t border-dashed border-emerald-400/25 pt-1 flex items-center justify-between">
                              <span className="font-mono text-[9px] uppercase tracking-wider text-emerald-200/45">
                                Backline · Lands &amp; Mana Artifacts
                              </span>
                            </div>
                          </div>
                        )}

                        {mySeatGame.battlefield.length === 0 ? (
                          <div className="relative z-10 flex h-[310px] items-center justify-center text-center text-xs text-sky-200/60 px-6">
                            Your playmat is open. Drag any card from your hand onto this surface to play/cast it at that exact spot.
                          </div>
                        ) : (
                          mySeatGame.battlefield.map((perm, pIdx) => {
                            const isCreature = (perm.typeLine || '')
                              .toLowerCase()
                              .includes('creature');
                            const isSelectedAttacker = selectedAttackerUids.includes(perm.uid);
                            const vis = resolveMultiplayerCardInstance(perm, true);
                            const coordKey = `${mySeatGame.seatIndex}:${perm.uid}`;
                            const isDraggingThis =
                              mpPointerDrag?.kind === 'self' &&
                              mpPointerDrag.seatIndex === mySeatGame.seatIndex &&
                              mpPointerDrag.uid === perm.uid;
                            const optCoord = optimisticCoords[coordKey];
                            const fallbackSpot = computeOpenPlayerPlaymatSpot(
                              mySeatGame.battlefield.slice(0, pIdx),
                              isBacklinePlaymatCard(perm)
                            );
                            const posX = isDraggingThis
                              ? mpPointerDrag.x
                              : optCoord
                              ? optCoord.x
                              : typeof perm.playmatX === 'number'
                              ? perm.playmatX
                              : fallbackSpot.x;
                            const posY = isDraggingThis
                              ? mpPointerDrag.y
                              : optCoord
                              ? optCoord.y
                              : typeof perm.playmatY === 'number'
                              ? perm.playmatY
                              : fallbackSpot.y;
                            const posZ = isDraggingThis ? 60 : perm.playmatZ ?? pIdx + 2;

                            return (
                              <div
                                key={perm.uid}
                                style={{
                                  left: `${posX}%`,
                                  top: `${posY}%`,
                                  zIndex: posZ,
                                  transform: 'translate(-50%, -50%)',
                                }}
                                onPointerDown={(ev) => {
                                  const targetEl = ev.target as HTMLElement | null;
                                  if (targetEl?.closest('button[data-card-action="true"]')) return;
                                  startMpPointerDrag(ev, {
                                    kind: 'self',
                                    seatIndex: mySeatGame.seatIndex,
                                    uid: perm.uid,
                                    name: vis.displayTitle,
                                    initialX: posX,
                                    initialY: posY,
                                  });
                                }}
                                className={`absolute w-[148px] rounded-lg border p-1.5 text-xs space-y-1 cursor-grab active:cursor-grabbing touch-none ${
                                  isDraggingThis
                                    ? 'transition-none border-amber-300 ring-2 ring-amber-300 shadow-2xl scale-[1.05]'
                                    : 'transition-[left,top,transform] duration-150 ease-out hover:z-30'
                                } ${
                                  perm.tapped
                                    ? 'rotate-2 border-amber-400/60 bg-amber-950/85'
                                    : isSelectedAttacker
                                    ? 'border-red-400 bg-red-950/85'
                                    : 'border-sky-400/50 bg-[#10263F]/95'
                                } ${getCustomFrameBorderClass(vis.frameStyle)}`}
                              >
                                {vis.effectiveImageUri && (
                                  <div className="relative h-14 w-full overflow-hidden rounded border border-white/10 bg-zinc-950">
                                    <img
                                      src={vis.effectiveImageUri}
                                      alt={vis.displayTitle}
                                      draggable={false}
                                      className="h-full w-full object-cover"
                                    />
                                    {vis.badgeLabel && (
                                      <span className="absolute top-1 left-1 rounded bg-amber-400 px-1 py-0.2 font-mono text-[8px] font-bold text-zinc-950">
                                        {vis.badgeLabel}
                                      </span>
                                    )}
                                  </div>
                                )}

                                <div className="flex items-center justify-between gap-1.5">
                                  <button
                                    type="button"
                                    onClick={(ev) => {
                                      if (suppressCardClickRef.current) {
                                        ev.preventDefault();
                                        return;
                                      }
                                      onInspectCard(vis.displayTitle, vis.inspectMeta);
                                    }}
                                    className="font-bold text-[11px] text-white hover:underline cursor-pointer truncate max-w-[105px] text-left"
                                  >
                                    {vis.displayTitle}
                                  </button>
                                  {perm.power && perm.toughness && (
                                    <span className="font-mono text-[10px] font-bold text-amber-300 tabular-nums shrink-0">
                                      {perm.power}/{perm.toughness}
                                    </span>
                                  )}
                                </div>

                                <div className="flex flex-wrap items-center gap-1">
                                  <button
                                    type="button"
                                    data-card-action="true"
                                    onClick={() =>
                                      void dispatchGameAction({
                                        type: 'toggle-tap',
                                        cardUid: perm.uid,
                                      })
                                    }
                                    className="rounded border border-sky-400/40 bg-[#0A1828] px-1.5 py-0.5 text-[9px] font-semibold text-sky-200 hover:bg-sky-800/50 cursor-pointer"
                                  >
                                    {perm.tapped ? 'Untap' : 'Tap'}
                                  </button>

                                  {isCreature && !perm.tapped && (
                                    <button
                                      type="button"
                                      data-card-action="true"
                                      onClick={() =>
                                        setSelectedAttackerUids((prev) =>
                                          prev.includes(perm.uid)
                                            ? prev.filter((id) => id !== perm.uid)
                                            : [...prev, perm.uid]
                                        )
                                      }
                                      className={`rounded border px-1.5 py-0.5 text-[9px] font-semibold cursor-pointer ${
                                        isSelectedAttacker
                                          ? 'border-red-400 bg-red-600 text-white'
                                          : 'border-red-400/50 bg-red-950/40 text-red-200'
                                      }`}
                                    >
                                      {isSelectedAttacker ? 'ATK' : 'Attack'}
                                    </button>
                                  )}

                                  <button
                                    type="button"
                                    data-card-action="true"
                                    onClick={() =>
                                      void dispatchGameAction({
                                        type: 'move-zone',
                                        cardUid: perm.uid,
                                        fromZone: 'battlefield',
                                        toZone: 'graveyard',
                                      })
                                    }
                                    className="rounded border border-zinc-600 bg-zinc-900 px-1.5 py-0.5 text-[9px] text-zinc-300 hover:bg-zinc-800 cursor-pointer"
                                  >
                                    GY
                                  </button>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>

                    {/* Your Private Hand (Redacted from All Other Players) */}
                    <div className="relative z-10 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-white">
                          Your Private Hand ({mySeatGame.hand.length} cards · Drag onto playmat or click action)
                        </span>
                        <span className="font-mono text-[11px] text-sky-300 tabular-nums">
                          Graveyard: {mySeatGame.graveyard.length} · Exile:{' '}
                          {mySeatGame.exile.length}
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {mySeatGame.hand.map((card: MultiplayerCardInstance) => {
                          const isLand = (card.typeLine || '')
                            .toLowerCase()
                            .includes('land');
                          const vis = resolveMultiplayerCardInstance(card, true);
                          return (
                            <div
                              key={card.uid}
                              draggable
                              onDragStart={(e) => {
                                setMpHandDrag({
                                  zone: 'hand',
                                  uid: card.uid,
                                  name: vis.displayTitle,
                                  isLand,
                                });
                                try {
                                  e.dataTransfer.effectAllowed = 'move';
                                  e.dataTransfer.setData('text/plain', `hand:${card.uid}`);
                                } catch {
                                  // Ignore
                                }
                              }}
                              onDragEnd={() => setMpHandDrag(null)}
                              className={`w-44 rounded-lg border border-sky-400/40 bg-[#0F243C] p-2.5 text-xs flex flex-col justify-between gap-2 cursor-grab active:cursor-grabbing ${getCustomFrameBorderClass(
                                vis.frameStyle
                              )}`}
                            >
                              <div className="space-y-1.5">
                                {vis.effectiveImageUri && (
                                  <div className="relative h-24 w-full overflow-hidden rounded border border-white/10 bg-zinc-950">
                                    <img
                                      src={vis.effectiveImageUri}
                                      alt={vis.displayTitle}
                                      draggable={false}
                                      className="h-full w-full object-cover"
                                    />
                                    {vis.badgeLabel && (
                                      <span className="absolute top-1 left-1 rounded bg-amber-400 px-1.5 py-0.5 font-mono text-[8px] font-bold text-zinc-950">
                                        {vis.badgeLabel}
                                      </span>
                                    )}
                                  </div>
                                )}
                                <div>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onInspectCard(vis.displayTitle, vis.inspectMeta)
                                    }
                                    className="font-bold text-white hover:underline text-left cursor-pointer line-clamp-1"
                                  >
                                    {vis.displayTitle}
                                  </button>
                                  <div className="text-[10px] text-sky-300 truncate">
                                    {card.typeLine || (isLand ? 'Land' : 'Spell')}
                                    {!isLand ? ` · MV ${card.cmc}` : ''}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5">
                                {isLand ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void dispatchGameAction({
                                        type: 'play-land',
                                        cardUid: card.uid,
                                      })
                                    }
                                    className="w-full rounded bg-emerald-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-emerald-500 cursor-pointer"
                                  >
                                    Play Land
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void dispatchGameAction({
                                        type: 'cast-spell',
                                        cardUid: card.uid,
                                        targetStackId:
                                          tabletop.stack.length > 0
                                            ? tabletop.stack[tabletop.stack.length - 1].id
                                            : undefined,
                                      })
                                    }
                                    className="w-full rounded bg-sky-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-sky-500 cursor-pointer"
                                  >
                                    Cast to Stack
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Synchronized Table Chat & Action Log Feed */}
                  {showChatDrawer && (
                    <div className="lg:col-span-4 rounded-lg border border-sky-400/30 bg-[#0A1828] p-3.5 flex flex-col justify-between space-y-3">
                      <div className="space-y-2">
                        <div className="text-xs font-bold text-white">
                          Table Chat &amp; Live Action Log
                        </div>

                        <div className="max-h-44 overflow-y-auto space-y-1.5 rounded border border-sky-500/20 bg-[#07111E] p-2.5 text-[11px]">
                          {tabletop.actionLog
                            .slice(-14)
                            .reverse()
                            .map((entry) => (
                              <div key={entry.id} className="text-sky-200/90">
                                <span className="font-mono font-bold text-amber-300">
                                  [T{entry.turnNumber}]
                                </span>{' '}
                                {entry.message}
                              </div>
                            ))}
                        </div>

                        <div className="max-h-44 overflow-y-auto space-y-1.5 rounded border border-sky-500/20 bg-[#07111E] p-2.5 text-[11px]">
                          {room.chatMessages.slice(-20).map((msg) => (
                            <div key={msg.id}>
                              <span
                                className={`font-bold ${
                                  msg.isSystem
                                    ? 'text-amber-300'
                                    : 'text-emerald-300'
                                }`}
                              >
                                {msg.senderName}:
                              </span>{' '}
                              <span className="text-zinc-100">{msg.text}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <form onSubmit={handleSendChat} className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={chatInput}
                          onChange={(e) => setChatInput(e.target.value)}
                          placeholder="Send message to table..."
                          maxLength={240}
                          className="flex-1 rounded border border-sky-400/40 bg-[#0F243C] px-2.5 py-1.5 text-xs text-white placeholder:text-sky-300/50 focus:border-sky-300 focus:outline-none"
                        />
                        <button
                          type="submit"
                          className="inline-flex items-center gap-1 rounded bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-500 cursor-pointer"
                        >
                          <Send className="h-3 w-3" />
                          <span>Send</span>
                        </button>
                      </form>
                    </div>
                  )}
                </div>
                );
              })()}
            </div>
          )}
        </div>
      </div>
      <TabletopPlaymatCustomizerModal
        isOpen={showPlaymatCustomizer}
        onClose={() => setShowPlaymatCustomizer(false)}
        preferences={playmatPrefs}
        onChangePreferences={setPlaymatPrefs}
        seatLabels={[
          room?.seats[0]?.playerName
            ? `Seat 1 (${room.seats[0].playerName})`
            : 'Seat 1 (Host)',
          room?.seats[1]?.playerName
            ? `Seat 2 (${room.seats[1].playerName})`
            : 'Seat 2',
          room?.seats[2]?.playerName
            ? `Seat 3 (${room.seats[2].playerName})`
            : 'Seat 3',
          room?.seats[3]?.playerName
            ? `Seat 4 (${room.seats[3].playerName})`
            : 'Seat 4',
        ]}
        multiplayerContext={
          room
            ? {
                isHost: room.isHost,
                callerSeatIndex: room.callerSeatIndex,
                roomCode: room.roomCode,
                onSyncToRoom: handleSyncPlaymatToRoom,
              }
            : undefined
        }
      />
      <CustomCardProxyTokenModal
        isOpen={showCustomCardsModal}
        onClose={() => setShowCustomCardsModal(false)}
        preferences={customCardPrefs}
        onChangePreferences={setCustomCardPrefs}
        initialTab={customCardsInitialTab}
        deckCardNames={effectiveUserCards.map((c) => c.name)}
        onSpawnTokenOnBattlefield={
          room && tabletop
            ? (tok) => {
                void dispatchGameAction({
                  type: 'create-token',
                  token: tok,
                });
              }
            : undefined
        }
        onInjectProxyIntoMatch={
          room && tabletop
            ? (zone, proxy: CustomCardProxyEntry) => {
                void dispatchGameAction({
                  type: 'inject-proxy-card',
                  zone,
                  card: {
                    name: proxy.cardName,
                    displayTitle: proxy.displayTitle,
                    typeLine: proxy.typeLine || 'Spell',
                    manaCost: proxy.manaCost || '',
                    cmc: proxy.cmc ?? 0,
                    oracleText: proxy.oracleText || '',
                    power: proxy.power,
                    toughness: proxy.toughness,
                    imageUri: proxy.customImageUrl,
                    isCommander: zone === 'commandZone',
                    proxyBadgeLabel: proxy.proxyBadgeLabel,
                    frameStyle: proxy.frameStyle,
                  },
                });
              }
            : undefined
        }
        onSyncCardArtToMatch={(proxy: CustomCardProxyEntry) => {
          if (!room || !sessionToken) return;
          if (tabletop) {
            void dispatchGameAction({
              type: 'update-card-art',
              cardName: proxy.cardName,
              imageUri: proxy.customImageUrl,
              displayTitle: proxy.displayTitle,
              proxyBadgeLabel: proxy.proxyBadgeLabel,
              frameStyle: proxy.frameStyle,
              typeLine: proxy.isFullProxy ? proxy.typeLine : undefined,
              manaCost: proxy.isFullProxy ? proxy.manaCost : undefined,
              cmc: proxy.isFullProxy ? proxy.cmc : undefined,
              oracleText: proxy.isFullProxy ? proxy.oracleText : undefined,
              power: proxy.isFullProxy ? proxy.power : undefined,
              toughness: proxy.isFullProxy ? proxy.toughness : undefined,
            });
          }
          // Also keep lobby deckSummary synced with latest proxies
          const nextSummary = applyUserProxiesToMultiplayerDeck(
            convertUserDeckToMultiplayerSummary(
              analysis,
              effectiveUserCards,
              userCommanders
            ),
            loadCustomCardTokenPreferences()
          );
          void updateSeatReadyOrDeck({
            baseUrl: activeHostBaseUrl,
            roomCode: room.roomCode,
            sessionToken,
            deckSummary: nextSummary,
          })
            .then((res) => setRoom(res.room))
            .catch(() => {});
        }}
      />
    </div>
  );
};
