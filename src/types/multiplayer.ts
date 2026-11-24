export type MultiplayerConnectionMode = 'lan' | 'online';

export type MultiplayerSeatKind = 'host' | 'human' | 'bot' | 'open';

export type MultiplayerRoomStatus = 'lobby' | 'playing' | 'paused' | 'completed';

export type MultiplayerTabletopPhase =
  | 'beginning'
  | 'main1'
  | 'combat'
  | 'main2'
  | 'ending';

export interface MultiplayerSerializedCard {
  name: string;
  quantity: number;
  isCommander?: boolean;
  typeLine?: string;
  manaCost?: string;
  cmc?: number;
  oracleText?: string;
  imageUri?: string;
  power?: string;
  toughness?: string;
  displayTitle?: string;
  isProxy?: boolean;
  proxyBadgeLabel?: string;
  frameStyle?: 'standard' | 'full-art' | 'retro' | 'gold-foil';
}

export interface MultiplayerDeckSummary {
  deckName: string;
  format: string;
  cardCount: number;
  commanders: string[];
  cards: MultiplayerSerializedCard[];
}

export interface MultiplayerBotSeatConfig {
  name: string;
  archetype: string;
  indignance: string;
  intelligence: string;
}

export interface MultiplayerSeat {
  seatIndex: number;
  seatId: string;
  seatInviteCode?: string;
  kind: MultiplayerSeatKind;
  playerName: string;
  connected: boolean;
  ready: boolean;
  lastSeenAt: string;
  deckSummary: MultiplayerDeckSummary | null;
  botConfig: MultiplayerBotSeatConfig | null;
  playmatThemeId?: string;
  playmatArtworkPresetId?: string;
  playmatCustomImageUrl?: string;
  lifeTotal?: number;
}

export interface MultiplayerJoinRequest {
  requestId: string;
  playerName: string;
  deckSummary: MultiplayerDeckSummary;
  requestedAt: string;
  status: 'pending' | 'approved' | 'denied';
  assignedSeatIndex?: number;
  preferredSeatIndex?: number;
  passcodeVerified?: boolean;
}

export interface MultiplayerCardInstance {
  uid: string;
  name: string;
  typeLine: string;
  manaCost: string;
  cmc: number;
  oracleText: string;
  imageUri?: string;
  power?: string;
  toughness?: string;
  tapped: boolean;
  counters: number;
  summoningSick: boolean;
  isCommander: boolean;
  attackingSeatIndex: number | null;
  displayTitle?: string;
  isProxy?: boolean;
  isToken?: boolean;
  proxyBadgeLabel?: string;
  frameStyle?: 'standard' | 'full-art' | 'retro' | 'gold-foil';
  tokenAbility?: 'treasure' | 'food' | 'clue' | 'blood' | 'none';
  playmatX?: number;
  playmatY?: number;
  playmatZ?: number;
}

export interface MultiplayerStackEntry {
  id: string;
  seatIndex: number;
  seatName: string;
  cardName: string;
  kind: 'spell' | 'triggered-ability' | 'activated-ability';
  effectSummary: string;
  targetSummary?: string;
  triggerCondition?: string;
  imageUri?: string;
  cardPayload?: MultiplayerCardInstance;
  countered?: boolean;
  counteredBy?: string;
  createdAt: string;
}

export interface MultiplayerResolvedStackRecord {
  id: string;
  turnNumber: number;
  seatName: string;
  cardName: string;
  kind: 'spell' | 'triggered-ability' | 'activated-ability';
  summary: string;
  timestamp: string;
}

export interface MultiplayerActionLogEntry {
  id: string;
  turnNumber: number;
  phase: MultiplayerTabletopPhase;
  seatIndex: number;
  seatName: string;
  message: string;
  timestamp: string;
}

export interface MultiplayerSeatGameState {
  seatIndex: number;
  playerName: string;
  kind: MultiplayerSeatKind;
  life: number;
  poison: number;
  commanderTax: number;
  commanderCasts: number;
  commanderDamageBySeat: Record<number, number>;
  manaPool: number;
  landsPlayedThisTurn: number;
  mulliganCount: number;
  handCount: number;
  libraryCount: number;
  /** Populated only for the authenticated caller's own seat; redacted for opponents */
  hand: MultiplayerCardInstance[];
  battlefield: MultiplayerCardInstance[];
  commandZone: MultiplayerCardInstance[];
  graveyard: MultiplayerCardInstance[];
  exile: MultiplayerCardInstance[];
  isEliminated: boolean;
  eliminationReason?: string;
}

export interface MultiplayerTabletopState {
  matchId: string;
  turnNumber: number;
  activeSeatIndex: number;
  prioritySeatIndex: number;
  phase: MultiplayerTabletopPhase;
  startingLife: number;
  seats: MultiplayerSeatGameState[];
  stack: MultiplayerStackEntry[];
  resolvedHistory: MultiplayerResolvedStackRecord[];
  actionLog: MultiplayerActionLogEntry[];
  winnerSeatIndex: number | null;
  winReason: string | null;
}

export interface MultiplayerChatMessage {
  id: string;
  seatIndex: number | null;
  senderName: string;
  text: string;
  isSystem?: boolean;
  timestamp: string;
}

export interface MultiplayerRoomClientView {
  roomId: string;
  roomCode: string;
  roomName: string;
  connectionMode: MultiplayerConnectionMode;
  format: string;
  maxSeats: 1 | 2 | 3 | 4;
  requireHostApproval: boolean;
  status: MultiplayerRoomStatus;
  createdAt: string;
  callerSeatIndex: number | null;
  isHost: boolean;
  seats: MultiplayerSeat[];
  seatLifeTotals?: [number, number, number, number];
  pendingJoinRequests: MultiplayerJoinRequest[];
  tabletop: MultiplayerTabletopState | null;
  chatMessages: MultiplayerChatMessage[];
  stateVersion: number;
  tabletopThemeId?: string;
  tabletopArtworkPresetId?: string;
  tabletopCustomImageUrl?: string;
}

export interface NetworkLanInterface {
  name: string;
  address: string;
  family: string;
  lanUrl: string;
}

export interface NetworkDiagnosticsReport {
  listeningPort: number;
  hostBindAddress: string;
  lanInterfaces: NetworkLanInterface[];
  primaryLanUrl: string;
  publicIpv4?: string | null;
  publicHostUrl?: string | null;
  loopbackReachable: boolean;
  lanReachable: boolean;
  externalHostInput?: string;
  externalPortReachable?: boolean | null;
  externalHttpHealthOk?: boolean | null;
  externalCheckDetail?: string;
  firewallCommands: {
    windowsPowerShell: string;
    linuxUfw: string;
  };
  routerGuideSteps: Array<{
    step: number;
    title: string;
    detail: string;
  }>;
}

export type MultiplayerGameActionPayload =
  | { type: 'mulligan'; actionId: string }
  | { type: 'draw-card'; actionId: string }
  | {
      type: 'play-land';
      actionId: string;
      cardUid: string;
      dropPos?: { x: number; y: number };
    }
  | {
      type: 'cast-spell';
      actionId: string;
      cardUid: string;
      targetSeatIndex?: number;
      targetStackId?: string;
      dropPos?: { x: number; y: number };
    }
  | {
      type: 'cast-commander';
      actionId: string;
      cardUid: string;
      dropPos?: { x: number; y: number };
    }
  | {
      type: 'push-trigger';
      actionId: string;
      sourceUid: string;
      triggerKind: 'etb' | 'landfall' | 'upkeep' | 'attack' | 'dies' | 'activated';
    }
  | { type: 'resolve-top'; actionId: string }
  | { type: 'pass-priority'; actionId: string }
  | { type: 'toggle-tap'; actionId: string; cardUid: string }
  | {
      type: 'adjust-counter';
      actionId: string;
      cardUid: string;
      delta: number;
    }
  | {
      type: 'move-zone';
      actionId: string;
      cardUid: string;
      fromZone: 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'commandZone';
      toZone: 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'commandZone';
      dropPos?: { x: number; y: number };
    }
  | {
      type: 'move-playmat-card';
      actionId: string;
      cardUid: string;
      x: number;
      y: number;
      targetSeatIndex?: number;
    }
  | {
      type: 'auto-arrange-playmat';
      actionId: string;
      targetSeatIndex?: number;
    }
  | {
      type: 'declare-attack';
      actionId: string;
      attackerUids: string[];
      targetSeatIndex: number;
    }
  | {
      type: 'adjust-life';
      actionId: string;
      targetSeatIndex: number;
      delta: number;
    }
  | {
      type: 'adjust-poison';
      actionId: string;
      targetSeatIndex: number;
      delta: number;
    }
  | { type: 'add-mana'; actionId: string; delta: number }
  | {
      type: 'create-token';
      actionId: string;
      token: {
        name: string;
        kind: 'creature' | 'artifact' | 'enchantment';
        power: number;
        toughness: number;
        quantity: number;
        keywords: string[];
        imageUri?: string;
        tokenAbility?: 'treasure' | 'food' | 'clue' | 'blood' | 'none';
        frameStyle?: 'standard' | 'full-art' | 'retro' | 'gold-foil';
      };
    }
  | {
      type: 'inject-proxy-card';
      actionId: string;
      zone: 'hand' | 'battlefield' | 'commandZone';
      card: {
        name: string;
        displayTitle?: string;
        typeLine: string;
        manaCost: string;
        cmc: number;
        oracleText: string;
        power?: string;
        toughness?: string;
        imageUri?: string;
        isCommander?: boolean;
        proxyBadgeLabel?: string;
        frameStyle?: 'standard' | 'full-art' | 'retro' | 'gold-foil';
      };
    }
  | {
      type: 'update-card-art';
      actionId: string;
      cardName: string;
      imageUri: string;
      displayTitle?: string;
      proxyBadgeLabel?: string;
      frameStyle?: 'standard' | 'full-art' | 'retro' | 'gold-foil';
      typeLine?: string;
      manaCost?: string;
      cmc?: number;
      oracleText?: string;
      power?: string;
      toughness?: string;
    }
  | { type: 'next-phase'; actionId: string }
  | { type: 'pass-turn'; actionId: string }
  | { type: 'run-bot-step'; actionId: string }
  | { type: 'reset-match'; actionId: string };
