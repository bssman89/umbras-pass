import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Heart, Minus, Plus, RotateCcw } from 'lucide-react';
import type { MultiplayerRoomClientView } from '../types/multiplayer';

export const LOBBY_LIFE_DANGER_THRESHOLD = 10;

export type SeatLifeTuple = [number, number, number, number];

function getStorageKey(roomCode: string): string {
  return `umbras_pass_lobby_life_${roomCode.trim().toUpperCase()}`;
}

export function getDefaultStartingLifeForRoom(
  format: string,
  maxSeats: number
): number {
  const lower = (format || '').toLowerCase();
  return maxSeats > 2 || lower.includes('commander') || lower.includes('brawl')
    ? 40
    : 20;
}

function clampLifeValue(value: number): number {
  return Math.max(0, Math.min(999, Math.round(value)));
}

function readStoredSeatLifeTotals(roomCode: string): SeatLifeTuple | null {
  if (typeof window === 'undefined' || !roomCode) return null;
  try {
    const raw = window.localStorage.getItem(getStorageKey(roomCode));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 4) return null;
    const tuple = parsed.map((n) =>
      typeof n === 'number' && Number.isFinite(n) ? clampLifeValue(n) : 40
    );
    return [tuple[0], tuple[1], tuple[2], tuple[3]];
  } catch {
    return null;
  }
}

function writeStoredSeatLifeTotals(
  roomCode: string,
  totals: SeatLifeTuple
): void {
  if (typeof window === 'undefined' || !roomCode) return;
  try {
    window.localStorage.setItem(getStorageKey(roomCode), JSON.stringify(totals));
  } catch {
    // Ignore storage quota errors
  }
}

export interface LobbyLifeTrackerProps {
  room: MultiplayerRoomClientView;
  callerSeatIdx: number;
  onUpdateSeatLife: (params: {
    seatIndex?: number;
    delta?: number;
    lifeTotal?: number;
    resetAll?: boolean;
  }) => Promise<void>;
  dangerThreshold?: number;
}

export const LobbyLifeTracker: React.FC<LobbyLifeTrackerProps> = ({
  room,
  callerSeatIdx,
  onUpdateSeatLife,
  dangerThreshold = LOBBY_LIFE_DANGER_THRESHOLD,
}) => {
  const defaultStartingLife = useMemo(
    () => getDefaultStartingLifeForRoom(room.format, room.maxSeats),
    [room.format, room.maxSeats]
  );

  const serverLifeTotals = useMemo<SeatLifeTuple>(() => {
    const fromArray = room.seatLifeTotals;
    return [0, 1, 2, 3].map((idx) => {
      if (fromArray && typeof fromArray[idx] === 'number') {
        return clampLifeValue(fromArray[idx]);
      }
      const seatLife = room.seats[idx]?.lifeTotal;
      return typeof seatLife === 'number'
        ? clampLifeValue(seatLife)
        : defaultStartingLife;
    }) as SeatLifeTuple;
  }, [room.seatLifeTotals, room.seats, defaultStartingLife]);

  const [lifeTotals, setLifeTotals] = useState<SeatLifeTuple>(() => {
    const stored = readStoredSeatLifeTotals(room.roomCode);
    const serverUntouched = serverLifeTotals.every(
      (val) => val === defaultStartingLife
    );
    if (stored && serverUntouched) {
      return stored;
    }
    return serverLifeTotals;
  });

  const hydratedRoomRef = useRef<string | null>(null);
  const onUpdateSeatLifeRef = useRef(onUpdateSeatLife);
  onUpdateSeatLifeRef.current = onUpdateSeatLife;

  // Persist current life totals to localStorage whenever they change
  useEffect(() => {
    writeStoredSeatLifeTotals(room.roomCode, lifeTotals);
  }, [room.roomCode, lifeTotals]);

  // Synchronize live server SSE updates and hydrate persisted custom totals on initial room mount
  useEffect(() => {
    if (hydratedRoomRef.current !== room.roomCode) {
      hydratedRoomRef.current = room.roomCode;
      const stored = readStoredSeatLifeTotals(room.roomCode);
      const serverUntouched = serverLifeTotals.every(
        (val) => val === defaultStartingLife
      );
      if (
        stored &&
        serverUntouched &&
        stored.some((val) => val !== defaultStartingLife)
      ) {
        setLifeTotals(stored);
        stored.forEach((savedLife, idx) => {
          if (savedLife === defaultStartingLife) return;
          if (room.isHost || callerSeatIdx === idx) {
            void onUpdateSeatLifeRef.current({ seatIndex: idx, lifeTotal: savedLife });
          }
        });
        return;
      }
    }

    setLifeTotals(serverLifeTotals);
  }, [
    room.roomCode,
    room.isHost,
    callerSeatIdx,
    serverLifeTotals,
    defaultStartingLife,
  ]);

  const adjustSeatLife = (seatIndex: number, delta: number) => {
    const current = lifeTotals[seatIndex] ?? defaultStartingLife;
    const nextValue = clampLifeValue(current + delta);
    if (nextValue === current) return;

    setLifeTotals((prev) => {
      const next: SeatLifeTuple = [prev[0], prev[1], prev[2], prev[3]];
      next[seatIndex] = nextValue;
      return next;
    });

    void onUpdateSeatLife({ seatIndex, lifeTotal: nextValue });
  };

  const resetSeatLife = (seatIndex: number) => {
    const current = lifeTotals[seatIndex] ?? defaultStartingLife;
    if (current === defaultStartingLife) return;

    setLifeTotals((prev) => {
      const next: SeatLifeTuple = [prev[0], prev[1], prev[2], prev[3]];
      next[seatIndex] = defaultStartingLife;
      return next;
    });

    void onUpdateSeatLife({ seatIndex, lifeTotal: defaultStartingLife });
  };

  const handleResetAll = () => {
    const resetTuple: SeatLifeTuple = [
      defaultStartingLife,
      defaultStartingLife,
      defaultStartingLife,
      defaultStartingLife,
    ];
    setLifeTotals(resetTuple);
    void onUpdateSeatLife({ resetAll: true });
  };

  const dangerSeatCount = lifeTotals.filter(
    (life) => life < dangerThreshold
  ).length;

  const anySeatModified = lifeTotals.some(
    (life) => life !== defaultStartingLife
  );

  return (
    <section
      aria-label="Lobby Life Total Tracker"
      className="rounded-xl border border-zinc-200 bg-white p-4 sm:p-5 space-y-4"
    >
      {/* Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm">
          <div className="inline-flex items-center gap-2 font-bold text-zinc-900 text-sm">
            <Heart className="h-4 w-4 text-rose-600 shrink-0" />
            <span>Lobby Life Total Tracker (Seats 1–4)</span>
          </div>
          <span className="text-zinc-300" aria-hidden="true">
            ·
          </span>
          <span className="font-mono text-xs tabular-nums text-zinc-600">
            Default {defaultStartingLife} Life
          </span>
          <span className="text-zinc-300" aria-hidden="true">
            ·
          </span>
          <span className="text-xs text-zinc-600">
            Synced live &amp; carried into match start
          </span>
          {dangerSeatCount > 0 && (
            <>
              <span className="text-zinc-300" aria-hidden="true">
                ·
              </span>
              <span
                role="status"
                className="inline-flex items-center gap-1.5 text-xs font-bold text-red-700"
              >
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>
                  {dangerSeatCount}{' '}
                  {dangerSeatCount === 1 ? 'Seat' : 'Seats'} in Danger Zone (&lt;{' '}
                  {dangerThreshold} life)
                </span>
              </span>
            </>
          )}
        </div>

        {room.isHost && anySeatModified && (
          <button
            type="button"
            onClick={handleResetAll}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-100 cursor-pointer whitespace-nowrap shrink-0"
          >
            <RotateCcw className="h-3.5 w-3.5 text-zinc-600 shrink-0" />
            <span>Reset All ({defaultStartingLife})</span>
          </button>
        )}
      </div>

      {/* 4-Seat Tracker Grid */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((seatIdx) => {
          const seat = room.seats[seatIdx];
          const isSeatInPod = seatIdx < room.maxSeats;
          const isCallerSeat = seatIdx === callerSeatIdx;
          const canEdit = room.isHost || isCallerSeat;
          const life = lifeTotals[seatIdx] ?? defaultStartingLife;
          const isDangerZone = life < dangerThreshold;

          const seatTitle = seat
            ? seat.playerName
            : isSeatInPod
            ? `Friend Seat #${seatIdx + 1}`
            : `Standby Seat #${seatIdx + 1}`;

          const seatRoleLabel = !isSeatInPod
            ? `Standby (Pod ${room.maxSeats})`
            : seat?.kind === 'host'
            ? 'Host'
            : seat?.kind === 'bot'
            ? 'AI Bot'
            : seat?.kind === 'human'
            ? 'Player'
            : 'Open Slot';

          return (
            <div
              key={seatIdx}
              data-testid={`lobby-life-seat-${seatIdx + 1}`}
              data-danger-zone={isDangerZone ? 'true' : 'false'}
              className={`rounded-xl border p-3.5 space-y-3 transition-colors ${
                isDangerZone
                  ? 'border-red-400 bg-red-50/75'
                  : isCallerSeat
                  ? 'border-sky-400 bg-sky-50/30'
                  : !isSeatInPod
                  ? 'border-zinc-200 bg-zinc-50/75'
                  : 'border-zinc-200 bg-white'
              }`}
            >
              {/* Seat Label & Role */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs font-mono font-bold tabular-nums text-zinc-600">
                    <span>Seat #{seatIdx + 1}</span>
                    {isCallerSeat && (
                      <>
                        <span className="text-zinc-300" aria-hidden="true">
                          ·
                        </span>
                        <span className="font-sans text-sky-700">You</span>
                      </>
                    )}
                    <span className="text-zinc-300" aria-hidden="true">
                      ·
                    </span>
                    <span className="font-sans font-semibold text-zinc-600">
                      {seatRoleLabel}
                    </span>
                  </div>
                  <div
                    className={`mt-0.5 truncate text-sm font-bold ${
                      isSeatInPod ? 'text-zinc-900' : 'text-zinc-500'
                    }`}
                    title={seatTitle}
                  >
                    {seatTitle}
                  </div>
                </div>

                {canEdit && life !== defaultStartingLife && (
                  <button
                    type="button"
                    onClick={() => resetSeatLife(seatIdx)}
                    title={`Reset Seat #${seatIdx + 1} to ${defaultStartingLife} life`}
                    aria-label={`Reset Seat #${seatIdx + 1} to ${defaultStartingLife} life`}
                    className="inline-flex min-h-[32px] items-center gap-1 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <RotateCcw className="h-3.5 w-3.5 shrink-0" />
                    <span className="font-mono tabular-nums">
                      {defaultStartingLife}
                    </span>
                  </button>
                )}
              </div>

              {/* Life Total Readout + Non-Hue-Only Danger Zone Indicator */}
              <div className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200/80 bg-white px-3.5 py-2.5">
                <div className="flex items-baseline gap-1.5">
                  <span
                    className={`font-mono text-2xl sm:text-3xl font-extrabold tabular-nums leading-none ${
                      isDangerZone ? 'text-red-700' : 'text-zinc-900'
                    }`}
                  >
                    {life}
                  </span>
                  <span className="text-xs font-medium text-zinc-500">
                    life
                  </span>
                </div>

                {isDangerZone ? (
                  <div
                    role="status"
                    aria-label={`Seat ${seatIdx + 1} Danger Zone: ${life} life remaining`}
                    className="inline-flex items-center gap-1 text-xs font-bold text-red-700 whitespace-nowrap shrink-0"
                  >
                    <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
                    <span>Danger Zone</span>
                  </div>
                ) : (
                  <span className="text-xs font-medium text-zinc-500 whitespace-nowrap shrink-0">
                    Stable
                  </span>
                )}
              </div>

              {/* Quick Increment / Decrement Controls */}
              <div className="grid grid-cols-4 gap-2">
                <button
                  type="button"
                  disabled={!canEdit || life <= 0}
                  onClick={() => adjustSeatLife(seatIdx, -5)}
                  aria-label={`Decrease Seat #${seatIdx + 1} life by 5`}
                  className="inline-flex min-h-[38px] items-center justify-center rounded-lg border border-red-200 bg-white py-2 font-mono text-sm font-bold tabular-nums text-red-700 hover:bg-red-50 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
                >
                  -5
                </button>
                <button
                  type="button"
                  disabled={!canEdit || life <= 0}
                  onClick={() => adjustSeatLife(seatIdx, -1)}
                  aria-label={`Decrease Seat #${seatIdx + 1} life by 1`}
                  className="inline-flex min-h-[38px] items-center justify-center gap-0.5 rounded-lg border border-zinc-300 bg-white py-2 font-mono text-sm font-bold tabular-nums text-zinc-800 hover:bg-zinc-100 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Minus className="h-3.5 w-3.5 shrink-0" />
                  <span>1</span>
                </button>
                <button
                  type="button"
                  disabled={!canEdit || life >= 999}
                  onClick={() => adjustSeatLife(seatIdx, 1)}
                  aria-label={`Increase Seat #${seatIdx + 1} life by 1`}
                  className="inline-flex min-h-[38px] items-center justify-center gap-0.5 rounded-lg border border-zinc-300 bg-white py-2 font-mono text-sm font-bold tabular-nums text-zinc-800 hover:bg-zinc-100 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Plus className="h-3.5 w-3.5 shrink-0" />
                  <span>1</span>
                </button>
                <button
                  type="button"
                  disabled={!canEdit || life >= 999}
                  onClick={() => adjustSeatLife(seatIdx, 5)}
                  aria-label={`Increase Seat #${seatIdx + 1} life by 5`}
                  className="inline-flex min-h-[38px] items-center justify-center rounded-lg border border-emerald-200 bg-white py-2 font-mono text-sm font-bold tabular-nums text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
                >
                  +5
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
