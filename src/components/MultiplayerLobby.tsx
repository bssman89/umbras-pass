import React, { useState } from 'react';
import {
  Bot,
  Check,
  Copy,
  Crown,
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
import { LobbyLifeTracker } from './LobbyLifeTracker';

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
  onStartMatch: () => Promise<void>;
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
      <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-bold text-zinc-900 text-sm">
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

            <div className="text-[11px] text-zinc-600">
              Host Endpoint:{' '}
              <span className="font-mono font-semibold tabular-nums text-zinc-900">
                {shareEndpointUrl}
              </span>{' '}
              · Share the Room Invite Code (or a Seat Invite Code below) and Session Passcode with friends.
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                void handleCopy(
                  'room-invite-all',
                  `Umbra's Pass Multiplayer Invite\nHost URL: ${shareEndpointUrl}\nRoom Invite Code: ${room.roomCode}${
                    room.isHost ? `\nSession Passcode: ${passcode}` : ''
                  }`
                )
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-sky-300 bg-white px-3 py-1.5 text-xs font-semibold text-sky-900 hover:bg-sky-100 cursor-pointer whitespace-nowrap"
            >
              {copiedKey === 'room-invite-all' ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-700" />
                  <span>Room Invite Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5 text-sky-700" />
                  <span>Copy Room Invite</span>
                </>
              )}
            </button>

            {onOpenPlaymatCustomizer && (
              <button
                type="button"
                onClick={onOpenPlaymatCustomizer}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-900 hover:bg-emerald-100 cursor-pointer whitespace-nowrap"
              >
                <Palette className="h-3.5 w-3.5 text-emerald-700" />
                <span>Playmats &amp; Tabletop Theme</span>
              </button>
            )}

            {onOpenCustomCardsModal && (
              <button
                type="button"
                onClick={onOpenCustomCardsModal}
                className="inline-flex items-center gap-1.5 rounded-lg border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-900 hover:bg-violet-100 cursor-pointer whitespace-nowrap"
              >
                <Wand2 className="h-3.5 w-3.5 text-violet-700" />
                <span>Custom Art, Proxies &amp; Tokens</span>
              </button>
            )}

            {!room.isHost && (
              <button
                type="button"
                onClick={() =>
                  void onToggleReady(!room.seats[callerSeatIdx]?.ready)
                }
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold cursor-pointer whitespace-nowrap ${
                  room.seats[callerSeatIdx]?.ready
                    ? 'bg-emerald-700 text-white hover:bg-emerald-800'
                    : 'bg-zinc-900 text-white hover:bg-zinc-800'
                }`}
              >
                <Check className="h-3.5 w-3.5" />
                <span>
                  {room.seats[callerSeatIdx]?.ready ? 'Ready' : 'Mark Ready'}
                </span>
              </button>
            )}

            {room.isHost && (
              <button
                type="button"
                onClick={() => void onStartMatch()}
                disabled={busyAction}
                className="inline-flex items-center gap-1.5 rounded-lg bg-sky-700 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-800 disabled:opacity-50 cursor-pointer whitespace-nowrap"
              >
                <Play className="h-3.5 w-3.5" />
                <span>
                  Launch {room.maxSeats}-Seat Tabletop Match
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Host Live 1–4 Seat Count & Passcode Entry Bar */}
        {room.isHost && (
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-sky-200/80 pt-3 text-xs">
            {/* 1–4 Seat Count Selector */}
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="font-semibold text-zinc-800">
                Active Pod Seats (1–4):
              </span>
              <div className="inline-flex items-center gap-1 rounded-lg bg-white p-1 border border-sky-200">
                {([1, 2, 3, 4] as const).map((seatCount) => (
                  <button
                    key={seatCount}
                    type="button"
                    onClick={() =>
                      void onUpdateLobbySettings({ maxSeats: seatCount })
                    }
                    className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
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
              <div className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1">
                <KeyRound className="h-3.5 w-3.5 text-sky-700 shrink-0" />
                <span className="text-zinc-600 font-medium">Passcode:</span>
                {isEditingPasscode ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      value={draftPasscode}
                      onChange={(e) => setDraftPasscode(e.target.value)}
                      minLength={4}
                      maxLength={24}
                      aria-label="New session passcode"
                      className="w-24 rounded border border-sky-400 px-1.5 py-0.5 font-mono text-xs font-bold text-zinc-900 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => void handleRotateOrSavePasscode(draftPasscode)}
                      className="rounded bg-sky-700 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-sky-800 cursor-pointer"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDraftPasscode(passcode);
                        setIsEditingPasscode(false);
                      }}
                      className="text-zinc-500 hover:text-zinc-800 cursor-pointer"
                    >
                      <X className="h-3.5 w-3.5" />
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
                      className="text-zinc-500 hover:text-zinc-800 cursor-pointer"
                    >
                      {showPasscode ? (
                        <EyeOff className="h-3.5 w-3.5" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsEditingPasscode(true)}
                      className="text-[11px] font-semibold text-sky-700 hover:underline cursor-pointer ml-1"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void handleRotateOrSavePasscode(generateRandomPasscode())
                      }
                      title="Rotate to a new random session passcode"
                      className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-zinc-600 hover:text-zinc-900 cursor-pointer ml-1"
                    >
                      <RefreshCw className="h-3 w-3" />
                      <span>Rotate</span>
                    </button>
                  </>
                )}
              </div>

              {/* Entry Gate Mode Switcher: Passcode + Manual Host Approval vs Passcode Auto-Admit */}
              <button
                type="button"
                onClick={() =>
                  void onUpdateLobbySettings({
                    requireHostApproval: !room.requireHostApproval,
                  })
                }
                title="Toggle whether guests with a valid passcode wait for manual host approval or auto-join open Friend seats"
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold cursor-pointer transition-colors ${
                  room.requireHostApproval
                    ? 'border-amber-300 bg-amber-50 text-amber-950 hover:bg-amber-100'
                    : 'border-emerald-300 bg-emerald-50 text-emerald-950 hover:bg-emerald-100'
                }`}
              >
                <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                <span>
                  Entry Gate:{' '}
                  {room.requireHostApproval
                    ? 'Passcode + Host Approval Required'
                    : 'Passcode Verified Auto-Admit'}
                </span>
              </button>
            </div>
          </div>
        )}
      </div>

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
            <div className="flex items-center gap-2 text-xs font-bold text-zinc-900">
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
              <span className="font-normal text-zinc-600">
                Friends who verify the room passcode appear here for seat assignment.
              </span>
            </div>

            {processedRequests.length > 0 && (
              <span className="font-mono text-[11px] tabular-nums text-zinc-500">
                {processedRequests.filter((r) => r.status === 'approved').length}{' '}
                approved ·{' '}
                {processedRequests.filter((r) => r.status === 'denied').length}{' '}
                denied
              </span>
            )}
          </div>

          {pendingRequests.length === 0 ? (
            <div className="rounded-lg border border-zinc-200 bg-white px-3.5 py-2.5 text-xs text-zinc-600 flex flex-wrap items-center justify-between gap-2">
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
              <span className="font-mono text-[11px] text-emerald-700 font-semibold">
                <Lock className="inline h-3 w-3 mr-1" />
                scrypt Passcode Protection Active
              </span>
            </div>
          ) : (
            <div className="space-y-2">
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
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-white p-3 text-xs shadow-xs"
                  >
                    <div className="space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-zinc-900 text-sm">
                          {reqItem.playerName}
                        </span>
                        <span className="text-zinc-300" aria-hidden="true">
                          ·
                        </span>
                        <span className="font-semibold text-emerald-700">
                          Passcode Verified
                        </span>
                        {typeof reqItem.preferredSeatIndex === 'number' && (
                          <>
                            <span className="text-zinc-300" aria-hidden="true">
                              ·
                            </span>
                            <span className="font-mono font-semibold text-sky-800">
                              Requested Seat #{reqItem.preferredSeatIndex + 1}
                            </span>
                          </>
                        )}
                      </div>
                      <div className="text-zinc-600">
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

                    <div className="flex flex-wrap items-center gap-2">
                      {room.maxSeats > 1 && (
                        <div className="flex items-center gap-1.5">
                          <label
                            htmlFor={`assign-seat-${reqItem.requestId}`}
                            className="text-[11px] font-medium text-zinc-600"
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
                            className="rounded-md border border-zinc-300 bg-zinc-50 px-2 py-1 text-xs font-semibold text-zinc-900"
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
                        className="inline-flex items-center gap-1 rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 cursor-pointer"
                      >
                        <Check className="h-3.5 w-3.5" />
                        <span>Approve into Seat #{chosenSeatIdx + 1}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          void onApproveOrDenyRequest(reqItem.requestId, false)
                        }
                        className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 cursor-pointer"
                      >
                        <X className="h-3.5 w-3.5" />
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
        <div className="lg:col-span-8 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500">
              Configured Tabletop Seats (1–{room.maxSeats} Active)
            </h3>
            <span className="text-xs text-zinc-500">
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
                  className={`rounded-xl border p-4 flex flex-col justify-between space-y-4 ${
                    isMe
                      ? 'border-sky-600 bg-sky-50/35'
                      : isBotMode
                      ? 'border-zinc-200 bg-zinc-50/60'
                      : 'border-zinc-200 bg-white'
                  }`}
                >
                  <div className="space-y-3">
                    {/* Seat Header Row */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold tabular-nums text-zinc-900">
                          SEAT #{seat.seatIndex + 1}
                        </span>
                        {isMe && (
                          <span className="text-xs font-bold text-sky-700">
                            · YOU
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
                          className={`inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                            isFriendMode
                              ? 'bg-white text-zinc-900 shadow-xs'
                              : 'text-zinc-600 hover:text-zinc-900'
                          }`}
                        >
                          <UserPlus className="h-3.5 w-3.5 text-sky-700 shrink-0" />
                          <span>Friend (Invite Code)</span>
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
                          className={`inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                            isBotMode
                              ? 'bg-white text-zinc-900 shadow-xs'
                              : 'text-zinc-600 hover:text-zinc-900'
                          }`}
                        >
                          <Bot className="h-3.5 w-3.5 text-sky-700 shrink-0" />
                          <span>AI Bot</span>
                        </button>
                      </div>
                    )}

                    {/* Seat Body Details based on Player Type */}
                    {isHostSeat || seat.kind === 'human' ? (
                      <div className="rounded-lg border border-zinc-200 bg-white p-3 space-y-1.5 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-zinc-900 text-sm truncate">
                            {seat.playerName}
                          </span>
                          {isHostSeat && (
                            <Crown className="h-4 w-4 text-amber-600 shrink-0" />
                          )}
                        </div>
                        {seat.deckSummary ? (
                          <div className="space-y-0.5 text-zinc-600">
                            <div className="font-medium text-zinc-800 truncate">
                              Deck: {seat.deckSummary.deckName}
                            </div>
                            <div className="font-mono text-[11px] tabular-nums text-zinc-500">
                              {seat.deckSummary.cardCount} cards ·{' '}
                              <span className="capitalize">
                                {seat.deckSummary.format}
                              </span>
                            </div>
                            {seat.deckSummary.commanders.length > 0 && (
                              <div className="text-[11px] font-medium text-sky-800 truncate">
                                Commander:{' '}
                                {seat.deckSummary.commanders.join(' & ')}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="text-zinc-500">
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
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-700 hover:underline cursor-pointer"
                            >
                              <UserMinus className="h-3 w-3" />
                              <span>Remove Player &amp; Re-Open Seat</span>
                            </button>
                          </div>
                        )}
                      </div>
                    ) : seat.kind === 'open' ? (
                      /* FRIEND (INVITE CODE) SLOT */
                      <div className="rounded-lg border border-dashed border-sky-300 bg-sky-50/40 p-3 space-y-2.5 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-zinc-800">
                            Seat Invite Code:
                          </span>
                          <span className="font-mono text-xs font-bold tabular-nums text-sky-800">
                            {seatCode}
                          </span>
                        </div>

                        <p className="text-[11px] text-zinc-600 leading-relaxed">
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
                            className="inline-flex items-center gap-1.5 rounded-md border border-sky-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-sky-900 hover:bg-sky-100 cursor-pointer"
                          >
                            {copiedKey === `seat-invite-${seat.seatIndex}` ? (
                              <>
                                <Check className="h-3 w-3 text-emerald-700" />
                                <span>Seat Invite Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="h-3 w-3 text-sky-700" />
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
                              className="inline-flex items-center gap-1 rounded-md bg-emerald-700 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-800 cursor-pointer"
                            >
                              <Check className="h-3 w-3" />
                              <span>
                                Seat {pendingRequests[0].playerName} Here
                              </span>
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      /* AI BOT CONFIGURATION SLOT */
                      <div className="rounded-lg border border-zinc-200 bg-white p-3 space-y-2.5 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-zinc-900 truncate">
                            {seat.playerName}
                          </span>
                          <span className="text-[11px] font-medium text-sky-800">
                            Adaptive Bot
                          </span>
                        </div>

                        {room.isHost ? (
                          <div className="space-y-2">
                            <div>
                              <label
                                htmlFor={`lobby-bot-arch-${seat.seatIndex}`}
                                className="block text-[11px] font-medium text-zinc-600 mb-0.5"
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
                                className="w-full rounded-md border border-zinc-300 bg-zinc-50 px-2 py-1 text-xs font-medium text-zinc-900"
                              >
                                {BOT_ARCHETYPES.map((arch) => (
                                  <option key={arch} value={arch}>
                                    {arch}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label
                                  htmlFor={`lobby-bot-indig-${seat.seatIndex}`}
                                  className="block text-[10px] font-medium text-zinc-500 mb-0.5"
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
                                  className="w-full rounded border border-zinc-300 bg-zinc-50 px-1.5 py-1 text-[11px] text-zinc-800"
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
                                  className="block text-[10px] font-medium text-zinc-500 mb-0.5"
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
                                  className="w-full rounded border border-zinc-300 bg-zinc-50 px-1.5 py-1 text-[11px] text-zinc-800"
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
                          <div className="text-zinc-600 space-y-0.5">
                            <div>
                              Archetype:{' '}
                              <strong className="font-semibold text-zinc-900">
                                {seat.botConfig?.archetype ||
                                  'Mono-Red Aggro / Burn'}
                              </strong>
                            </div>
                            <div className="text-[11px] text-zinc-500 capitalize">
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
        <div className="lg:col-span-4 rounded-xl border border-zinc-200 bg-zinc-50/70 p-4 flex flex-col justify-between space-y-3">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-900">
                <MessageSquare className="h-3.5 w-3.5 text-sky-700" />
                <span>Lobby Chat &amp; Room Activity</span>
              </div>
              <span className="font-mono text-[11px] tabular-nums text-zinc-500">
                {
                  visibleSeats.filter(
                    (s) => s.kind === 'host' || s.kind === 'human' || s.kind === 'bot'
                  ).length
                }
                /{room.maxSeats} Ready
              </span>
            </div>

            <div className="h-64 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-3 space-y-2 text-xs">
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
              className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-sky-600 focus:outline-none"
            />
            <button
              type="submit"
              className="inline-flex items-center gap-1 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-zinc-800 cursor-pointer"
            >
              <Send className="h-3 w-3" />
              <span>Send</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
