import React, { useEffect, useRef, useState } from 'react';
import {
  Bot,
  Check,
  Copy,
  Crown,
  Dices,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  MessageSquare,
  Palette,
  Play,
  RefreshCw,
  Send,
  ShieldCheck,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  Wand2,
  X,
} from 'lucide-react';
import type {
  MultiplayerBotSeatConfig,
  MultiplayerRoomClientView,
  MultiplayerSeat,
} from '../types/multiplayer';
import { copyTextToClipboard } from '../utils/clipboard';
import {
  buildDirectInviteUrl,
  formatPortableConnectCode,
} from '../utils/multiplayerInvite';
import { LobbyLifeTracker } from './LobbyLifeTracker';
import {
  D20RollOffStage,
  computeD20RollOff,
  type D20RollOffResult,
  type D20SeatDescriptor,
} from './D20RollAnimation';

const BOT_ARCHETYPES = [
  'Mono-Red Aggro / Burn',
  'Azorius Control & Countermagic',
  'Simic Landfall & Ramp',
  'Golgari Graveyard Value',
  'Dimir Midrange & Removal',
  'Orzhov Aristocrats & Drain',
  'Izzet Spellslinger Combo',
  'Gruul Stompy Aggro',
  'Golgari / Simic Toxic & Infect',
  'Dimir Mill & Library Denial',
  'Boros / Voltron Commander Damage',
];

const BOT_INDIGNANCE_LEVELS = [
  { id: 'forgiving', label: 'Forgiving (Casual)' },
  { id: 'measured', label: 'Measured (Balanced)' },
  { id: 'ruthless', label: 'Ruthless (Targeted)' },
];

const BOT_INTELLIGENCE_LEVELS = [
  { id: 'casual', label: 'Casual IQ' },
  { id: 'tactical', label: 'Tactical IQ' },
  { id: 'competitive', label: 'Competitive IQ' },
];

function generateRandomPasscode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export interface MultiplayerLobbyProps {
  room: MultiplayerRoomClientView;
  callerSeatIdx: number;
  shareEndpointUrl: string;
  passcode: string;
  onPasscodeRotated: (nextPasscode: string) => void;
  onUpdateLobbySettings: (params: {
    maxSeats?: 1 | 2 | 3 | 4;
    newPasscode?: string;
    requireHostApproval?: boolean;
    roomName?: string;
  }) => Promise<void>;
  onConfigureSeat: (
    seatIndex: number,
    kind: 'open' | 'bot',
    botConfig?: MultiplayerBotSeatConfig
  ) => Promise<void>;
  onApproveOrDenyRequest: (
    requestId: string,
    approve: boolean,
    targetSeatIndex?: number
  ) => Promise<void>;
  onToggleReady: (nextReady: boolean) => Promise<void>;
  onStartMatch: (options?: {
    firstSeatIndex?: number;
    diceSummary?: string;
  }) => Promise<void>;
  onSendChat: (text: string) => Promise<void>;
  onOpenPlaymatCustomizer?: () => void;
  onOpenCustomCardsModal?: () => void;
  onUpdateSeatLife?: (params: {
    seatIndex?: number;
    delta?: number;
    lifeTotal?: number;
    resetAll?: boolean;
  }) => Promise<void>;
  busyAction: boolean;
}

export const MultiplayerLobby: React.FC<MultiplayerLobbyProps> = ({
  room,
  callerSeatIdx,
  shareEndpointUrl,
  passcode,
  onPasscodeRotated,
  onUpdateLobbySettings,
  onConfigureSeat,
  onApproveOrDenyRequest,
  onToggleReady,
  onStartMatch,
  onSendChat,
  onOpenPlaymatCustomizer,
  onOpenCustomCardsModal,
  onUpdateSeatLife,
  busyAction,
}) => {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showPasscode, setShowPasscode] = useState<boolean>(true);
  const [isEditingPasscode, setIsEditingPasscode] = useState<boolean>(false);
  const [draftPasscode, setDraftPasscode] = useState<string>(passcode);
  const [selectedTargetSeatByRequestId, setSelectedTargetSeatByRequestId] =
    useState<Record<string, number>>({});
  const [lobbyChatInput, setLobbyChatInput] = useState<string>('');
  const [firstSeatMode, setFirstSeatMode] = useState<'host' | 'd20'>('host');
  const [d20RollResult, setD20RollResult] = useState<D20RollOffResult | null>(null);
  const [d20RollNonce, setD20RollNonce] = useState<number>(0);
  const [d20RollSettled, setD20RollSettled] = useState<boolean>(false);
  const [launchRollModalOpen, setLaunchRollModalOpen] = useState<boolean>(false);
  const autoLaunchTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (autoLaunchTimerRef.current) {
        window.clearTimeout(autoLaunchTimerRef.current);
      }
    };
  }, []);

  const handleCopy = async (key: string, text: string) => {
    await copyTextToClipboard(text);
    setCopiedKey(key);
    window.setTimeout(() => {
      setCopiedKey((prev) => (prev === key ? null : prev));
    }, 2000);
  };

  const pendingRequests = room.pendingJoinRequests.filter(
    (r) => r.status === 'pending'
  );
  const processedRequests = room.pendingJoinRequests.filter(
    (r) => r.status !== 'pending'
  );

  const visibleSeats = room.seats.slice(0, room.maxSeats);
  const availableSeatsForApproval = visibleSeats.filter(
    (s) => s.seatIndex > 0 && (s.kind === 'open' || s.kind === 'bot')
  );

  const buildSeatDescriptors = (): D20SeatDescriptor[] =>
    visibleSeats.map((s) => ({
      seatIdx: s.seatIndex,
      name: s.playerName || `Seat ${s.seatIndex + 1}`,
      roleLabel:
        s.seatIndex === 0
          ? 'Host · Seat 1'
          : s.kind === 'bot'
          ? `Seat ${s.seatIndex + 1} · AI Bot`
          : `Seat ${s.seatIndex + 1} · Friend`,
    }));

  const triggerMpD20Roll = () => {
    if (autoLaunchTimerRef.current) {
      window.clearTimeout(autoLaunchTimerRef.current);
      autoLaunchTimerRef.current = null;
    }
    const rolled = computeD20RollOff(buildSeatDescriptors());
    setD20RollResult(rolled);
    setD20RollSettled(false);
    setD20RollNonce((n) => n + 1);
    return rolled;
  };

  const handleHostLaunchMatch = () => {
    if (firstSeatMode === 'd20') {
      if (d20RollResult && d20RollSettled && d20RollResult.seats.length === visibleSeats.length) {
        void onStartMatch({
          firstSeatIndex: d20RollResult.winnerSeatIdx,
          diceSummary: d20RollResult.summary,
        });
        return;
      }
      triggerMpD20Roll();
      setLaunchRollModalOpen(true);
      return;
    }
    void onStartMatch({ firstSeatIndex: 0 });
  };

  const handleRotateOrSavePasscode = async (nextCode: string) => {
    const clean = nextCode.trim();
    if (clean.length < 4) return;
    await onUpdateLobbySettings({ newPasscode: clean });
    onPasscodeRotated(clean);
    setDraftPasscode(clean);
    setIsEditingPasscode(false);
  };

  const handleLobbyChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = lobbyChatInput.trim();
    if (!clean) return;
    setLobbyChatInput('');
    await onSendChat(clean);
  };

  return (
    <div className="space-y-6">
      {/* 1. Top Room Credentials, 1–4 Seat Pod Size Selector & Launch Toolbar */}
      <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm">
              <span className="font-bold text-zinc-900 text-base">
                {room.roomName}
              </span>
              <span className="text-zinc-400" aria-hidden="true">
                ·
              </span>
              <span className="font-semibold text-sky-900">
                {room.connectionMode === 'online'
                  ? 'Self-Hosted Online Session'
                  : 'Offline LAN Session'}
              </span>
              <span className="text-zinc-400" aria-hidden="true">
                ·
              </span>
              <span className="capitalize font-medium text-zinc-700">
                {room.format}
              </span>
              <span className="text-zinc-400" aria-hidden="true">
                ·
              </span>
              <span className="font-mono font-bold tabular-nums text-zinc-900">
                Room Invite Code: {room.roomCode}
              </span>
            </div>

            <div className="text-xs text-zinc-700 flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <span>
                Host Endpoint:{' '}
                <span className="font-mono font-semibold tabular-nums text-zinc-900">
                  {shareEndpointUrl}
                </span>
              </span>
              <span aria-hidden="true" className="text-zinc-300">
                ·
              </span>
              <span>
                Portable Code:{' '}
                <span className="font-mono font-semibold tabular-nums text-sky-900">
                  {formatPortableConnectCode(room.roomCode, shareEndpointUrl)}
                </span>
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() =>
                void handleCopy(
                  'room-direct-link',
                  buildDirectInviteUrl(shareEndpointUrl, room.roomCode)
                )
              }
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-sky-300 bg-white px-3.5 py-2 text-xs sm:text-sm font-semibold text-sky-900 hover:bg-sky-100 cursor-pointer whitespace-nowrap shrink-0"
            >
              {copiedKey === 'room-direct-link' ? (
                <>
                  <Check className="h-4 w-4 text-emerald-700" />
                  <span>Direct Link Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4 text-sky-700" />
                  <span>Copy Join Link</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() =>
                void handleCopy(
                  'portable-code',
                  formatPortableConnectCode(room.roomCode, shareEndpointUrl)
                )
              }
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3.5 py-2 text-xs sm:text-sm font-semibold text-zinc-800 hover:bg-zinc-100 cursor-pointer whitespace-nowrap shrink-0"
            >
              {copiedKey === 'portable-code' ? (
                <>
                  <Check className="h-4 w-4 text-emerald-700" />
                  <span>Code Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4 text-zinc-600" />
                  <span>Copy Portable Code</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() =>
                void handleCopy(
                  'room-invite-all',
                  `Umbra's Pass Multiplayer Invite\nDirect Join Link: ${buildDirectInviteUrl(
                    shareEndpointUrl,
                    room.roomCode
                  )}\nHost Endpoint: ${shareEndpointUrl}\nRoom Code: ${
                    room.roomCode
                  }\nPortable Code: ${formatPortableConnectCode(
                    room.roomCode,
                    shareEndpointUrl
                  )}${room.isHost ? `\nSession Passcode: ${passcode}` : ''}`
                )
              }
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-sky-300 bg-white px-3.5 py-2 text-xs sm:text-sm font-semibold text-sky-900 hover:bg-sky-100 cursor-pointer whitespace-nowrap shrink-0"
            >
              {copiedKey === 'room-invite-all' ? (
                <>
                  <Check className="h-4 w-4 text-emerald-700" />
                  <span>Full Invite Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4 text-sky-700" />
                  <span>Copy Invite</span>
                </>
              )}
            </button>

            {onOpenPlaymatCustomizer && (
              <button
                type="button"
                onClick={onOpenPlaymatCustomizer}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3.5 py-2 text-xs sm:text-sm font-semibold text-emerald-900 hover:bg-emerald-100 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Palette className="h-4 w-4 text-emerald-700" />
                <span>Playmats &amp; Theme</span>
              </button>
            )}

            {onOpenCustomCardsModal && (
              <button
                type="button"
                onClick={onOpenCustomCardsModal}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-violet-300 bg-violet-50 px-3.5 py-2 text-xs sm:text-sm font-semibold text-violet-900 hover:bg-violet-100 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Wand2 className="h-4 w-4 text-violet-700" />
                <span>Art, Proxies &amp; Tokens</span>
              </button>
            )}

            {!room.isHost && (
              <button
                type="button"
                onClick={() =>
                  void onToggleReady(!room.seats[callerSeatIdx]?.ready)
                }
                className={`inline-flex min-h-[44px] items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-bold cursor-pointer whitespace-nowrap shrink-0 ${
                  room.seats[callerSeatIdx]?.ready
                    ? 'bg-emerald-700 text-white hover:bg-emerald-800'
                    : 'bg-zinc-900 text-white hover:bg-zinc-800'
                }`}
              >
                <Check className="h-4 w-4" />
                <span>
                  {room.seats[callerSeatIdx]?.ready ? 'Ready' : 'Mark Ready'}
                </span>
              </button>
            )}

            {room.isHost && (
              <button
                type="button"
                onClick={handleHostLaunchMatch}
                disabled={busyAction}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-sky-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-sky-800 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Play className="h-4 w-4 fill-current" />
                <span>
                  Launch {room.maxSeats}-Seat Tabletop Match
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Host Live 1–4 Seat Count & Passcode Entry Bar */}
        {room.isHost && (
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-sky-200/80 pt-3.5 text-xs sm:text-sm">
            {/* 1–4 Seat Count Selector */}
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="font-semibold text-zinc-800">
                Active Pod Seats (1–4):
              </span>
              <div className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-white p-1 border border-sky-200">
                {([1, 2, 3, 4] as const).map((seatCount) => (
                  <button
                    key={seatCount}
                    type="button"
                    onClick={() =>
                      void onUpdateLobbySettings({ maxSeats: seatCount })
                    }
                    className={`min-h-[38px] rounded-md px-3.5 py-1.5 text-xs sm:text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      room.maxSeats === seatCount
                        ? 'bg-sky-700 text-white'
                        : 'text-zinc-700 hover:bg-zinc-100'
                    }`}
                  >
                    {seatCount === 1
                      ? '1 Seat (Solo)'
                      : seatCount === 2
                      ? '2 Seats (1v1)'
                      : seatCount === 3
                      ? '3 Seats'
                      : '4 Seats (Pod)'}
                  </button>
                ))}
              </div>
            </div>

            {/* Passcode Management & Approval Gate Controls */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex min-h-[40px] items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-1.5">
                <KeyRound className="h-4 w-4 text-sky-700 shrink-0" />
                <span className="text-zinc-700 font-medium">Passcode:</span>
                {isEditingPasscode ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={draftPasscode}
                      onChange={(e) => setDraftPasscode(e.target.value)}
                      minLength={4}
                      maxLength={24}
                      aria-label="New session passcode"
                      className="w-28 rounded border border-sky-400 px-2 py-1 font-mono text-sm font-bold text-zinc-900 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => void handleRotateOrSavePasscode(draftPasscode)}
                      className="min-h-[32px] rounded bg-sky-700 px-3 py-1 text-xs font-semibold text-white hover:bg-sky-800 cursor-pointer"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDraftPasscode(passcode);
                        setIsEditingPasscode(false);
                      }}
                      className="inline-flex h-8 w-8 items-center justify-center rounded text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 cursor-pointer"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <span className="font-mono font-bold tabular-nums text-emerald-800">
                      {showPasscode ? passcode : '••••••'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowPasscode((v) => !v)}
                      title={showPasscode ? 'Hide passcode' : 'Show passcode'}
                      className="inline-flex h-7 w-7 items-center justify-center rounded text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 cursor-pointer"
                    >
                      {showPasscode ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsEditingPasscode(true)}
                      className="min-h-[30px] rounded px-2 text-xs font-semibold text-sky-700 hover:bg-sky-50 hover:underline cursor-pointer"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void handleRotateOrSavePasscode(generateRandomPasscode())
                      }
                      title="Rotate to a new random session passcode"
                      className="inline-flex min-h-[30px] items-center gap-1 rounded px-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 cursor-pointer"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      <span>Rotate</span>
                    </button>
                  </>
                )}
              </div>

              {/* Entry Gate Mode Switcher: Passcode + Manual Host Approval (Locked ON for Online Security) */}
              <button
                type="button"
                disabled={room.connectionMode === 'online'}
                onClick={() => {
                  if (room.connectionMode === 'online') return;
                  void onUpdateLobbySettings({
                    requireHostApproval: !room.requireHostApproval,
                  });
                }}
                title={
                  room.connectionMode === 'online'
                    ? 'Online rooms always enforce Session Passcode + Host Lobby Approval before granting seats'
                    : 'Toggle whether guests with a valid passcode wait for manual host approval or auto-join open Friend seats'
                }
                className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border px-3.5 py-2 text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  room.connectionMode === 'online'
                    ? 'border-amber-300 bg-amber-50 text-amber-950 cursor-default'
                    : room.requireHostApproval
                    ? 'border-amber-300 bg-amber-50 text-amber-950 hover:bg-amber-100 cursor-pointer'
                    : 'border-emerald-300 bg-emerald-50 text-emerald-950 hover:bg-emerald-100 cursor-pointer'
                }`}
              >
                <ShieldCheck className="h-4 w-4 shrink-0" />
                <span>
                  {room.connectionMode === 'online'
                    ? 'Entry Gate: Passcode + Host Approval Locked'
                    : room.requireHostApproval
                    ? 'Entry Gate: Passcode + Host Approval Required'
                    : 'Entry Gate: Passcode Verified Auto-Admit'}
                </span>
              </button>
            </div>
          </div>
        )}

        {/* Host Turn Order & Animated d20 Roll-Off */}
        {room.isHost && (
          <div className="border-t border-sky-200/80 pt-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5 text-xs sm:text-sm">
                <span className="inline-flex items-center gap-1.5 font-semibold text-zinc-800">
                  <Dices className="h-4 w-4 text-sky-700" />
                  Who Goes First:
                </span>
                <div className="inline-flex items-center gap-1 rounded-lg border border-sky-200 bg-white p-1">
                  <button
                    type="button"
                    onClick={() => {
                      setFirstSeatMode('host');
                      setD20RollResult(null);
                      setD20RollSettled(false);
                    }}
                    className={`min-h-[36px] rounded-md px-3 py-1 text-xs sm:text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      firstSeatMode === 'host'
                        ? 'bg-sky-700 text-white'
                        : 'text-zinc-700 hover:bg-zinc-100'
                    }`}
                  >
                    Host (Seat 1)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFirstSeatMode('d20');
                      triggerMpD20Roll();
                    }}
                    className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-md px-3 py-1 text-xs sm:text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      firstSeatMode === 'd20'
                        ? 'bg-sky-700 text-white'
                        : 'text-zinc-700 hover:bg-zinc-100'
                    }`}
                  >
                    <Dices className="h-3.5 w-3.5" />
                    Roll d20
                  </button>
                </div>
              </div>

              {firstSeatMode === 'd20' && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={triggerMpD20Roll}
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-sky-300 bg-white px-3 py-1.5 text-xs font-semibold text-sky-800 hover:bg-sky-50 cursor-pointer whitespace-nowrap"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Re-roll d20
                  </button>
                  {d20RollResult && d20RollSettled && (
                    <button
                      type="button"
                      onClick={() => void onSendChat(`🎲 ${d20RollResult.summary}`)}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-900 hover:bg-emerald-100 cursor-pointer whitespace-nowrap"
                    >
                      Post Roll to Chat
                    </button>
                  )}
                </div>
              )}
            </div>

            {firstSeatMode === 'd20' && d20RollResult && (
              <D20RollOffStage
                rollResult={d20RollResult}
                rollNonce={d20RollNonce}
                compact
                title="Multiplayer Pod d20 Roll-Off"
                onReroll={triggerMpD20Roll}
                onSettled={() => setD20RollSettled(true)}
              />
            )}
          </div>
        )}
      </div>

      {/* Animated d20 Launch Modal for Multiplayer */}
      {launchRollModalOpen && d20RollResult && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Rolling d20 to see who goes first"
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/75 p-4 backdrop-blur-sm"
        >
          <div className="w-full max-w-2xl rounded-2xl border border-sky-400/50 bg-white p-5 shadow-2xl">
            <D20RollOffStage
              rollResult={d20RollResult}
              rollNonce={d20RollNonce}
              title="Rolling d20 to See Who Goes First..."
              autoLaunchCountdownLabel="Launch Match Now"
              onSkipAndProceed={() => {
                if (autoLaunchTimerRef.current) {
                  window.clearTimeout(autoLaunchTimerRef.current);
                  autoLaunchTimerRef.current = null;
                }
                setLaunchRollModalOpen(false);
                void onStartMatch({
                  firstSeatIndex: d20RollResult.winnerSeatIdx,
                  diceSummary: d20RollResult.summary,
                });
              }}
              onSettled={(settled) => {
                setD20RollSettled(true);
                autoLaunchTimerRef.current = window.setTimeout(() => {
                  setLaunchRollModalOpen(false);
                  void onStartMatch({
                    firstSeatIndex: settled.winnerSeatIdx,
                    diceSummary: settled.summary,
                  });
                }, 700);
              }}
            />
          </div>
        </div>
      )}

      {/* 2. Room Entry & Passcode Approval Management Queue (Host View) */}
      {room.isHost && (
        <div
          className={`rounded-xl border p-4 space-y-3 ${
            pendingRequests.length > 0
              ? 'border-amber-300 bg-amber-50/90'
              : 'border-zinc-200 bg-zinc-50/70'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-zinc-900">
              <UserCheck
                className={`h-4 w-4 ${
                  pendingRequests.length > 0 ? 'text-amber-700' : 'text-sky-700'
                }`}
              />
              <span>
                Room Entry &amp; Passcode Approval Queue ({pendingRequests.length}{' '}
                pending)
              </span>
              <span className="text-zinc-400 font-normal" aria-hidden="true">
                ·
              </span>
              <span className="text-xs sm:text-sm font-normal text-zinc-600">
                Friends who verify the room passcode appear here for seat assignment.
              </span>
            </div>

            {processedRequests.length > 0 && (
              <span className="font-mono text-xs tabular-nums text-zinc-500">
                {processedRequests.filter((r) => r.status === 'approved').length}{' '}
                approved ·{' '}
                {processedRequests.filter((r) => r.status === 'denied').length}{' '}
                denied
              </span>
            )}
          </div>

          {pendingRequests.length === 0 ? (
            <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 text-xs sm:text-sm text-zinc-600 flex flex-wrap items-center justify-between gap-2">
              <span>
                No pending join requests waiting right now. Share a{' '}
                <strong className="font-semibold text-zinc-900">
                  Friend Seat Invite Code
                </strong>{' '}
                and your{' '}
                <strong className="font-semibold text-zinc-900">
                  Session Passcode ({passcode})
                </strong>{' '}
                with friends to have them join.
              </span>
              <span className="font-mono text-xs text-emerald-700 font-semibold">
                <Lock className="inline h-3.5 w-3.5 mr-1" />
                scrypt Passcode Protection Active
              </span>
            </div>
          ) : (
            <div className="space-y-2.5">
              {pendingRequests.map((reqItem) => {
                const defaultSeatIdx =
                  typeof reqItem.preferredSeatIndex === 'number' &&
                  reqItem.preferredSeatIndex > 0 &&
                  reqItem.preferredSeatIndex < room.maxSeats
                    ? reqItem.preferredSeatIndex
                    : availableSeatsForApproval[0]?.seatIndex ?? 1;

                const chosenSeatIdx =
                  selectedTargetSeatByRequestId[reqItem.requestId] ??
                  defaultSeatIdx;

                return (
                  <div
                    key={reqItem.requestId}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-white p-3.5 text-sm shadow-xs"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-zinc-900 text-base">
                          {reqItem.playerName}
                        </span>
                        <span className="text-zinc-300" aria-hidden="true">
                          ·
                        </span>
                        <span className="text-xs font-semibold text-emerald-700">
                          Passcode Verified
                        </span>
                        {typeof reqItem.preferredSeatIndex === 'number' && (
                          <>
                            <span className="text-zinc-300" aria-hidden="true">
                              ·
                            </span>
                            <span className="font-mono text-xs font-semibold text-sky-800">
                              Requested Seat #{reqItem.preferredSeatIndex + 1}
                            </span>
                          </>
                        )}
                      </div>
                      <div className="text-xs text-zinc-600">
                        Deck:{' '}
                        <strong className="font-semibold text-zinc-900">
                          {reqItem.deckSummary.deckName}
                        </strong>{' '}
                        (
                        <span className="font-mono tabular-nums">
                          {reqItem.deckSummary.cardCount}
                        </span>{' '}
                        cards · {reqItem.deckSummary.format})
                        {reqItem.deckSummary.commanders.length > 0 && (
                          <span className="text-sky-800 font-medium">
                            {' '}
                            · Cmdr: {reqItem.deckSummary.commanders.join(' & ')}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2.5">
                      {room.maxSeats > 1 && (
                        <div className="flex items-center gap-2">
                          <label
                            htmlFor={`assign-seat-${reqItem.requestId}`}
                            className="text-xs font-semibold text-zinc-700"
                          >
                            Assign to:
                          </label>
                          <select
                            id={`assign-seat-${reqItem.requestId}`}
                            value={chosenSeatIdx}
                            onChange={(e) =>
                              setSelectedTargetSeatByRequestId((prev) => ({
                                ...prev,
                                [reqItem.requestId]: Number(e.target.value),
                              }))
                            }
                            className="min-h-[38px] rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-1.5 text-xs sm:text-sm font-semibold text-zinc-900"
                          >
                            {visibleSeats
                              .filter((s) => s.seatIndex > 0)
                              .map((s) => (
                                <option key={s.seatIndex} value={s.seatIndex}>
                                  Seat #{s.seatIndex + 1} (
                                  {s.kind === 'open'
                                    ? 'Friend Slot'
                                    : s.kind === 'bot'
                                    ? `Replaces ${s.playerName}`
                                    : `Occupied by ${s.playerName}`}
                                  )
                                </option>
                              ))}
                          </select>
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() =>
                          void onApproveOrDenyRequest(
                            reqItem.requestId,
                            true,
                            chosenSeatIdx
                          )
                        }
                        className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-2 text-xs sm:text-sm font-semibold text-white hover:bg-emerald-800 cursor-pointer whitespace-nowrap"
                      >
                        <Check className="h-4 w-4" />
                        <span>Approve into Seat #{chosenSeatIdx + 1}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          void onApproveOrDenyRequest(reqItem.requestId, false)
                        }
                        className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-red-300 bg-red-50 px-3.5 py-2 text-xs sm:text-sm font-semibold text-red-700 hover:bg-red-100 cursor-pointer whitespace-nowrap"
                      >
                        <X className="h-4 w-4" />
                        <span>Deny</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 2b. Persistent 4-Seat Lobby Life Total Tracker */}
      <LobbyLifeTracker
        room={room}
        callerSeatIdx={callerSeatIdx}
        onUpdateSeatLife={onUpdateSeatLife ?? (async () => {})}
      />

      {/* 3. 1–4 Seat Pod Configuration Cards (Toggle 'Friend (Invite Code)' vs 'AI Bot') + Lobby Chat */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-8 space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-zinc-900">
              Configured Tabletop Seats (1–{room.maxSeats} Active)
            </h3>
            <span className="text-xs sm:text-sm text-zinc-600">
              Toggle any non-host seat between{' '}
              <strong className="font-semibold text-zinc-800">
                Friend (Invite Code)
              </strong>{' '}
              and{' '}
              <strong className="font-semibold text-zinc-800">AI Bot</strong>
            </span>
          </div>

          <div
            className={`grid grid-cols-1 gap-4 ${
              room.maxSeats === 1
                ? 'sm:grid-cols-1'
                : 'sm:grid-cols-2'
            }`}
          >
            {visibleSeats.map((seat: MultiplayerSeat) => {
              const isMe = seat.seatIndex === callerSeatIdx;
              const isHostSeat = seat.seatIndex === 0;
              const isFriendMode =
                seat.kind === 'open' || seat.kind === 'human';
              const isBotMode = seat.kind === 'bot';
              const seatCode =
                seat.seatInviteCode || `${room.roomCode}-S${seat.seatIndex + 1}`;

              return (
                <div
                  key={seat.seatId}
                  className={`rounded-xl border p-4 sm:p-5 flex flex-col justify-between space-y-4 ${
                    isMe
                      ? 'border-sky-600 bg-sky-50/35'
                      : isBotMode
                      ? 'border-zinc-200 bg-zinc-50/60'
                      : 'border-zinc-200 bg-white'
                  }`}
                >
                  <div className="space-y-3.5">
                    {/* Seat Header Row */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-bold tabular-nums text-zinc-900">
                          Seat #{seat.seatIndex + 1}
                        </span>
                        {isMe && (
                          <span className="text-xs font-bold text-sky-700">
                            · You
                          </span>
                        )}
                      </div>

                      <span
                        className={`text-xs font-semibold ${
                          seat.kind === 'open'
                            ? 'text-amber-700'
                            : seat.ready
                            ? 'text-emerald-700'
                            : 'text-zinc-600'
                        }`}
                      >
                        {isHostSeat
                          ? 'Host · Ready'
                          : seat.kind === 'human'
                          ? seat.ready
                            ? 'Friend Connected · Ready'
                            : 'Friend Connected · Reviewing'
                          : seat.kind === 'bot'
                          ? 'AI Bot · Ready'
                          : 'Awaiting Friend (Invite Code)'}
                      </span>
                    </div>

                    {/* Host Segmented Toggle: 'Friend (Invite Code)' vs 'AI Bot' */}
                    {room.isHost && !isHostSeat && (
                      <div className="grid grid-cols-2 gap-1 rounded-lg bg-zinc-100 p-1">
                        <button
                          type="button"
                          onClick={() => {
                            if (!isFriendMode) {
                              void onConfigureSeat(seat.seatIndex, 'open');
                            }
                          }}
                          className={`inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs sm:text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                            isFriendMode
                              ? 'bg-white text-zinc-900 shadow-xs'
                              : 'text-zinc-600 hover:text-zinc-900'
                          }`}
                        >
                          <UserPlus className="h-4 w-4 text-sky-700 shrink-0" />
                          <span>Friend (Invite)</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            if (!isBotMode) {
                              const defaultArch =
                                BOT_ARCHETYPES[
                                  seat.seatIndex % BOT_ARCHETYPES.length
                                ];
                              void onConfigureSeat(seat.seatIndex, 'bot', {
                                name: `AI Bot ${seat.seatIndex} (${
                                  defaultArch.split(' ')[0]
                                })`,
                                archetype: defaultArch,
                                indignance: 'measured',
                                intelligence: 'tactical',
                              });
                            }
                          }}
                          className={`inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs sm:text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                            isBotMode
                              ? 'bg-white text-zinc-900 shadow-xs'
                              : 'text-zinc-600 hover:text-zinc-900'
                          }`}
                        >
                          <Bot className="h-4 w-4 text-sky-700 shrink-0" />
                          <span>AI Bot</span>
                        </button>
                      </div>
                    )}

                    {/* Seat Body Details based on Player Type */}
                    {isHostSeat || seat.kind === 'human' ? (
                      <div className="rounded-lg border border-zinc-200 bg-white p-3.5 space-y-2 text-xs sm:text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-zinc-900 text-base truncate">
                            {seat.playerName}
                          </span>
                          {isHostSeat && (
                            <Crown className="h-4 w-4 text-amber-600 shrink-0" />
                          )}
                        </div>
                        {seat.deckSummary ? (
                          <div className="space-y-1 text-zinc-600">
                            <div className="font-medium text-zinc-800 truncate">
                              Deck: {seat.deckSummary.deckName}
                            </div>
                            <div className="font-mono text-xs tabular-nums text-zinc-500">
                              {seat.deckSummary.cardCount} cards ·{' '}
                              <span className="capitalize">
                                {seat.deckSummary.format}
                              </span>
                            </div>
                            {seat.deckSummary.commanders.length > 0 && (
                              <div className="text-xs font-medium text-sky-800 truncate">
                                Commander:{' '}
                                {seat.deckSummary.commanders.join(' & ')}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="text-xs text-zinc-500">
                            Deck synced and ready.
                          </div>
                        )}

                        {room.isHost && !isHostSeat && seat.kind === 'human' && (
                          <div className="pt-2 border-t border-zinc-100 flex items-center justify-end">
                            <button
                              type="button"
                              onClick={() =>
                                void onConfigureSeat(seat.seatIndex, 'open')
                              }
                              className="inline-flex min-h-[32px] items-center gap-1.5 rounded px-2 text-xs font-semibold text-red-700 hover:bg-red-50 cursor-pointer"
                            >
                              <UserMinus className="h-3.5 w-3.5" />
                              <span>Remove Player &amp; Re-Open Seat</span>
                            </button>
                          </div>
                        )}
                      </div>
                    ) : seat.kind === 'open' ? (
                      /* FRIEND (INVITE CODE) SLOT */
                      <div className="rounded-lg border border-dashed border-sky-300 bg-sky-50/40 p-3.5 space-y-3 text-xs sm:text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-zinc-800">
                            Seat Invite Code:
                          </span>
                          <span className="font-mono text-sm font-bold tabular-nums text-sky-800">
                            {seatCode}
                          </span>
                        </div>

                        <p className="text-xs text-zinc-600 leading-relaxed">
                          Friends can enter <strong className="font-mono font-semibold text-zinc-900">{seatCode}</strong> (or room code <strong className="font-mono font-semibold text-zinc-900">{room.roomCode}</strong>) plus the Session Passcode to request this seat.
                        </p>

                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              void handleCopy(
                                `seat-invite-${seat.seatIndex}`,
                                `Join Seat #${seat.seatIndex + 1} in ${room.roomName}\nHost URL: ${shareEndpointUrl}\nSeat Invite Code: ${seatCode}${
                                  room.isHost ? `\nPasscode: ${passcode}` : ''
                                }`
                              )
                            }
                            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-sky-300 bg-white px-3 py-1.5 text-xs font-semibold text-sky-900 hover:bg-sky-100 cursor-pointer whitespace-nowrap"
                          >
                            {copiedKey === `seat-invite-${seat.seatIndex}` ? (
                              <>
                                <Check className="h-3.5 w-3.5 text-emerald-700" />
                                <span>Seat Invite Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="h-3.5 w-3.5 text-sky-700" />
                                <span>Copy Seat #{seat.seatIndex + 1} Invite</span>
                              </>
                            )}
                          </button>

                          {room.isHost && pendingRequests.length > 0 && (
                            <button
                              type="button"
                              onClick={() =>
                                void onApproveOrDenyRequest(
                                  pendingRequests[0].requestId,
                                  true,
                                  seat.seatIndex
                                )
                              }
                              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 cursor-pointer whitespace-nowrap"
                            >
                              <Check className="h-3.5 w-3.5" />
                              <span>
                                Seat {pendingRequests[0].playerName} Here
                              </span>
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      /* AI BOT CONFIGURATION SLOT */
                      <div className="rounded-lg border border-zinc-200 bg-white p-3.5 space-y-3 text-xs sm:text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-zinc-900 text-sm truncate">
                            {seat.playerName}
                          </span>
                          <span className="text-xs font-semibold text-sky-800 shrink-0">
                            Adaptive Bot
                          </span>
                        </div>

                        {room.isHost ? (
                          <div className="space-y-3">
                            <div>
                              <label
                                htmlFor={`lobby-bot-arch-${seat.seatIndex}`}
                                className="block text-xs font-semibold text-zinc-700 mb-1"
                              >
                                Bot Deck Archetype
                              </label>
                              <select
                                id={`lobby-bot-arch-${seat.seatIndex}`}
                                value={
                                  seat.botConfig?.archetype || BOT_ARCHETYPES[0]
                                }
                                onChange={(e) => {
                                  const nextArch = e.target.value;
                                  void onConfigureSeat(seat.seatIndex, 'bot', {
                                    name: `AI Bot ${seat.seatIndex} (${
                                      nextArch.split(' ')[0]
                                    })`,
                                    archetype: nextArch,
                                    indignance:
                                      seat.botConfig?.indignance || 'measured',
                                    intelligence:
                                      seat.botConfig?.intelligence || 'tactical',
                                  });
                                }}
                                className="min-h-[38px] w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm font-medium text-zinc-900 focus:border-sky-600 focus:bg-white focus:outline-none"
                              >
                                {BOT_ARCHETYPES.map((arch) => (
                                  <option key={arch} value={arch}>
                                    {arch}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div className="grid grid-cols-2 gap-2.5">
                              <div>
                                <label
                                  htmlFor={`lobby-bot-indig-${seat.seatIndex}`}
                                  className="block text-xs font-semibold text-zinc-700 mb-1"
                                >
                                  Target Focus
                                </label>
                                <select
                                  id={`lobby-bot-indig-${seat.seatIndex}`}
                                  value={
                                    seat.botConfig?.indignance || 'measured'
                                  }
                                  onChange={(e) => {
                                    const arch =
                                      seat.botConfig?.archetype ||
                                      BOT_ARCHETYPES[0];
                                    void onConfigureSeat(seat.seatIndex, 'bot', {
                                      name: seat.playerName,
                                      archetype: arch,
                                      indignance: e.target.value,
                                      intelligence:
                                        seat.botConfig?.intelligence ||
                                        'tactical',
                                    });
                                  }}
                                  className="min-h-[38px] w-full rounded-lg border border-zinc-300 bg-zinc-50 px-2.5 py-1.5 text-xs sm:text-sm font-medium text-zinc-900 focus:border-sky-600 focus:bg-white focus:outline-none"
                                >
                                  {BOT_INDIGNANCE_LEVELS.map((lvl) => (
                                    <option key={lvl.id} value={lvl.id}>
                                      {lvl.label}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              <div>
                                <label
                                  htmlFor={`lobby-bot-iq-${seat.seatIndex}`}
                                  className="block text-xs font-semibold text-zinc-700 mb-1"
                                >
                                  Bot IQ Tier
                                </label>
                                <select
                                  id={`lobby-bot-iq-${seat.seatIndex}`}
                                  value={
                                    seat.botConfig?.intelligence || 'tactical'
                                  }
                                  onChange={(e) => {
                                    const arch =
                                      seat.botConfig?.archetype ||
                                      BOT_ARCHETYPES[0];
                                    void onConfigureSeat(seat.seatIndex, 'bot', {
                                      name: seat.playerName,
                                      archetype: arch,
                                      indignance:
                                        seat.botConfig?.indignance || 'measured',
                                      intelligence: e.target.value,
                                    });
                                  }}
                                  className="min-h-[38px] w-full rounded-lg border border-zinc-300 bg-zinc-50 px-2.5 py-1.5 text-xs sm:text-sm font-medium text-zinc-900 focus:border-sky-600 focus:bg-white focus:outline-none"
                                >
                                  {BOT_INTELLIGENCE_LEVELS.map((iq) => (
                                    <option key={iq.id} value={iq.id}>
                                      {iq.label}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="text-zinc-600 space-y-1 text-xs sm:text-sm">
                            <div>
                              Archetype:{' '}
                              <strong className="font-semibold text-zinc-900">
                                {seat.botConfig?.archetype ||
                                  'Mono-Red Aggro / Burn'}
                              </strong>
                            </div>
                            <div className="text-xs text-zinc-500 capitalize">
                              {seat.botConfig?.indignance || 'measured'} ·{' '}
                              {seat.botConfig?.intelligence || 'tactical'} IQ
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column (4 cols): Lobby Chat & Entry Audit Log */}
        <div className="lg:col-span-4 rounded-xl border border-zinc-200 bg-zinc-50/70 p-4 sm:p-5 flex flex-col justify-between space-y-3.5">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold text-zinc-900">
                <MessageSquare className="h-4 w-4 text-sky-700" />
                <span>Lobby Chat &amp; Activity</span>
              </div>
              <span className="font-mono text-xs font-semibold tabular-nums text-zinc-600">
                {
                  visibleSeats.filter(
                    (s) => s.kind === 'host' || s.kind === 'human' || s.kind === 'bot'
                  ).length
                }
                /{room.maxSeats} Ready
              </span>
            </div>

            <div className="h-64 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-3.5 space-y-2.5 text-xs sm:text-sm">
              {room.chatMessages.length === 0 ? (
                <div className="text-zinc-400">
                  No messages yet. Coordinate deck choices and pod rules here before starting.
                </div>
              ) : (
                room.chatMessages.slice(-25).map((msg) => (
                  <div key={msg.id} className="leading-snug">
                    <span
                      className={`font-bold ${
                        msg.isSystem ? 'text-amber-700' : 'text-sky-800'
                      }`}
                    >
                      {msg.senderName}:
                    </span>{' '}
                    <span className="text-zinc-700">{msg.text}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          <form
            onSubmit={(e) => void handleLobbyChatSubmit(e)}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={lobbyChatInput}
              onChange={(e) => setLobbyChatInput(e.target.value)}
              placeholder="Message lobby players..."
              maxLength={240}
              className="min-h-[40px] flex-1 rounded-lg border border-zinc-300 bg-white px-3.5 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-sky-600 focus:outline-none"
            />
            <button
              type="submit"
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 cursor-pointer shrink-0"
            >
              <Send className="h-4 w-4" />
              <span>Send</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
