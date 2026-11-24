import React, { useEffect, useRef, useState } from 'react';
import { Crown, Dices, FastForward, RefreshCw, Sparkles } from 'lucide-react';
import { playTabletopSound } from './LiveTabletopArena';

export interface D20SeatDescriptor {
  seatIdx: number;
  name: string;
  roleLabel?: string;
}

export interface D20SeatRoll {
  seatIdx: number;
  name: string;
  roleLabel?: string;
  initialRoll: number;
  finalRoll: number;
  hadTieBreak: boolean;
  isWinner: boolean;
}

export interface D20RollOffResult {
  winnerSeatIdx: number;
  seats: D20SeatRoll[];
  hadTieBreak: boolean;
  tiedValue: number | null;
  summary: string;
}

export function computeD20RollOff(seats: D20SeatDescriptor[]): D20RollOffResult {
  const safeSeats =
    seats.length > 0 ? seats : [{ seatIdx: 0, name: 'Seat 1', roleLabel: 'You' }];

  const initialRolls = safeSeats.map((s) => ({
    ...s,
    initialRoll: Math.floor(Math.random() * 20) + 1,
    finalRoll: 1,
    hadTieBreak: false,
  }));
  initialRolls.forEach((entry) => {
    entry.finalRoll = entry.initialRoll;
  });

  let maxRoll = Math.max(...initialRolls.map((r) => r.finalRoll));
  let leaders = initialRolls.filter((r) => r.finalRoll === maxRoll);
  const hadTieBreak = leaders.length > 1;
  const tiedValue = hadTieBreak ? maxRoll : null;

  let safety = 0;
  while (leaders.length > 1 && safety < 24) {
    safety += 1;
    leaders.forEach((leader) => {
      leader.hadTieBreak = true;
      leader.finalRoll = Math.floor(Math.random() * 20) + 1;
    });
    maxRoll = Math.max(...leaders.map((r) => r.finalRoll));
    leaders = leaders.filter((r) => r.finalRoll === maxRoll);
  }

  // Fallback deterministic tie resolution if 24 consecutive ties ever occurred
  const winnerSeatIdx = leaders[0]?.seatIdx ?? safeSeats[0].seatIdx;

  const finalSeats: D20SeatRoll[] = initialRolls.map((entry) => ({
    seatIdx: entry.seatIdx,
    name: entry.name,
    roleLabel: entry.roleLabel,
    initialRoll: entry.initialRoll,
    finalRoll: entry.finalRoll,
    hadTieBreak: entry.hadTieBreak,
    isWinner: entry.seatIdx === winnerSeatIdx,
  }));

  const winnerSeat = finalSeats.find((s) => s.isWinner) || finalSeats[0];
  const summary = `d20 Roll: ${finalSeats
    .map((r) =>
      r.hadTieBreak ? `${r.name} (${r.initialRoll}→${r.finalRoll})` : `${r.name} (${r.finalRoll})`
    )
    .join(' · ')} — ${winnerSeat.name} goes first!`;

  return {
    winnerSeatIdx,
    seats: finalSeats,
    hadTieBreak,
    tiedValue,
    summary,
  };
}

export interface D20DieIconProps {
  value: number;
  state: 'idle' | 'rolling' | 'settled' | 'tie' | 'winner';
  size?: 'sm' | 'md' | 'lg';
}

export const D20DieIcon: React.FC<D20DieIconProps> = ({
  value,
  state,
  size = 'md',
}) => {
  const dimClass =
    size === 'sm'
      ? 'h-12 w-12'
      : size === 'lg'
      ? 'h-20 w-20'
      : 'h-16 w-16';
  const numTextClass =
    size === 'sm'
      ? 'text-base'
      : size === 'lg'
      ? 'text-2xl'
      : 'text-xl';

  const isNat20 = state !== 'rolling' && value === 20;
  const isNat1 = state !== 'rolling' && value === 1;

  const palette =
    state === 'winner'
      ? {
          outerFill: '#0d3b2e',
          topFacet: '#10b981',
          sideFacet: '#047857',
          bottomFacet: '#064e3b',
          centerFacet: '#065f46',
          stroke: isNat20 ? '#fbbf24' : '#34d399',
          text: '#ffffff',
          glow: isNat20
            ? 'drop-shadow(0 0 12px rgba(251,191,36,0.55))'
            : 'drop-shadow(0 0 10px rgba(52,211,153,0.45))',
        }
      : state === 'tie'
      ? {
          outerFill: '#451a03',
          topFacet: '#f59e0b',
          sideFacet: '#b45309',
          bottomFacet: '#78350f',
          centerFacet: '#92400e',
          stroke: '#fbbf24',
          text: '#fef3c7',
          glow: 'drop-shadow(0 0 10px rgba(245,158,11,0.45))',
        }
      : state === 'rolling'
      ? {
          outerFill: '#0c273b',
          topFacet: '#38bdf8',
          sideFacet: '#0284c7',
          bottomFacet: '#075985',
          centerFacet: '#0369a1',
          stroke: '#7ad3f6',
          text: '#ffffff',
          glow: 'drop-shadow(0 0 10px rgba(41,171,226,0.5))',
        }
      : {
          outerFill: '#182232',
          topFacet: '#2d3f59',
          sideFacet: '#1f2b3d',
          bottomFacet: '#121a26',
          centerFacet: '#253449',
          stroke: isNat20 ? '#fbbf24' : isNat1 ? '#f87171' : '#38bdf8',
          text: isNat20 ? '#fde68a' : isNat1 ? '#fca5a5' : '#f8fafc',
          glow: isNat20
            ? 'drop-shadow(0 0 8px rgba(251,191,36,0.35))'
            : 'drop-shadow(0 2px 4px rgba(0,0,0,0.45))',
        };

  return (
    <div className={`relative inline-flex items-center justify-center ${dimClass} select-none`}>
      {state === 'winner' && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-full border-2 border-emerald-400/75 animate-d20-halo"
        />
      )}
      <div
        className={`relative flex items-center justify-center w-full h-full ${
          state === 'rolling'
            ? 'animate-d20-tumble'
            : state === 'winner'
            ? 'animate-d20-winner-pop'
            : ''
        }`}
        style={{ filter: palette.glow }}
      >
        <svg
          viewBox="0 0 100 100"
          className="w-full h-full overflow-visible"
          aria-hidden="true"
        >
          {/* Outer icosahedron hexagon */}
          <polygon
            points="50,4 91,27 91,73 50,96 9,73 9,27"
            fill={palette.outerFill}
            stroke={palette.stroke}
            strokeWidth="2.6"
            strokeLinejoin="round"
          />
          {/* Top bright bevel facet */}
          <polygon
            points="50,4 78,34 22,34"
            fill={palette.topFacet}
            fillOpacity="0.48"
            stroke={palette.stroke}
            strokeOpacity="0.45"
            strokeWidth="1.2"
          />
          {/* Upper left & right side facets */}
          <polygon
            points="50,4 22,34 9,27"
            fill={palette.sideFacet}
            fillOpacity="0.55"
            stroke={palette.stroke}
            strokeOpacity="0.35"
            strokeWidth="1.1"
          />
          <polygon
            points="50,4 91,27 78,34"
            fill={palette.sideFacet}
            fillOpacity="0.42"
            stroke={palette.stroke}
            strokeOpacity="0.35"
            strokeWidth="1.1"
          />
          {/* Left & right lower flank facets */}
          <polygon
            points="9,27 22,34 28,72 9,73"
            fill={palette.bottomFacet}
            fillOpacity="0.72"
            stroke={palette.stroke}
            strokeOpacity="0.35"
            strokeWidth="1.1"
          />
          <polygon
            points="91,27 91,73 72,72 78,34"
            fill={palette.bottomFacet}
            fillOpacity="0.64"
            stroke={palette.stroke}
            strokeOpacity="0.35"
            strokeWidth="1.1"
          />
          {/* Bottom tip bevel */}
          <polygon
            points="28,72 72,72 50,96"
            fill={palette.bottomFacet}
            fillOpacity="0.88"
            stroke={palette.stroke}
            strokeOpacity="0.45"
            strokeWidth="1.2"
          />
          {/* Center main triangle face */}
          <polygon
            points="50,18 78,72 22,72"
            fill={palette.centerFacet}
            fillOpacity="0.92"
            stroke={palette.stroke}
            strokeWidth="1.9"
            strokeLinejoin="round"
          />
          {/* Specular facet edge lines */}
          <line
            x1="22"
            y1="34"
            x2="22"
            y2="72"
            stroke={palette.stroke}
            strokeOpacity="0.4"
            strokeWidth="1"
          />
          <line
            x1="78"
            y1="34"
            x2="78"
            y2="72"
            stroke={palette.stroke}
            strokeOpacity="0.4"
            strokeWidth="1"
          />
        </svg>
        <span
          className={`absolute inset-0 flex items-center justify-center pt-2 font-mono font-extrabold tabular-nums tracking-tight ${numTextClass}`}
          style={{ color: palette.text, textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}
        >
          {value}
        </span>
      </div>
    </div>
  );
};

export interface D20RollOffStageProps {
  rollResult: D20RollOffResult | null;
  rollNonce: number;
  soundEnabled?: boolean;
  onSettled?: (result: D20RollOffResult) => void;
  onReroll?: () => void;
  onSkipAndProceed?: () => void;
  title?: string;
  compact?: boolean;
  autoLaunchCountdownLabel?: string;
}

export const D20RollOffStage: React.FC<D20RollOffStageProps> = ({
  rollResult,
  rollNonce,
  soundEnabled = false,
  onSettled,
  onReroll,
  onSkipAndProceed,
  title = 'd20 High-Roll Turn Order',
  compact = false,
  autoLaunchCountdownLabel,
}) => {
  const [seatDisplayValues, setSeatDisplayValues] = useState<Record<number, number>>({});
  const [seatStates, setSeatStates] = useState<
    Record<number, 'idle' | 'rolling' | 'settled' | 'tie' | 'winner'>
  >({});
  const [phaseLabel, setPhaseLabel] = useState<string>('Ready to roll');
  const [isAnimating, setIsAnimating] = useState<boolean>(false);

  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;

  useEffect(() => {
    if (!rollResult || rollNonce === 0) {
      setIsAnimating(false);
      setPhaseLabel('Click Roll d20 to determine who goes first');
      return;
    }

    let cancelled = false;
    const timers: number[] = [];
    const intervals: number[] = [];

    const initialDisplay: Record<number, number> = {};
    const initialStates: Record<number, 'idle' | 'rolling' | 'settled' | 'tie' | 'winner'> = {};
    rollResult.seats.forEach((s) => {
      initialDisplay[s.seatIdx] = Math.floor(Math.random() * 20) + 1;
      initialStates[s.seatIdx] = 'rolling';
    });

    setSeatDisplayValues(initialDisplay);
    setSeatStates(initialStates);
    setIsAnimating(true);
    setPhaseLabel('Rolling d20s across the pod...');
    playTabletopSound(soundEnabled, 'dice');

    // Track which seats are actively cycling numbers
    const rollingSeats = new Set<number>(rollResult.seats.map((s) => s.seatIdx));

    const cycleInterval = window.setInterval(() => {
      if (cancelled) return;
      setSeatDisplayValues((prev) => {
        const next = { ...prev };
        rollingSeats.forEach((seatIdx) => {
          next[seatIdx] = ((prev[seatIdx] || 1) + Math.floor(Math.random() * 17) + 1) % 20 + 1;
        });
        return next;
      });
    }, 65);
    intervals.push(cycleInterval);

    // Stagger seat lock-ins cleanly so dice settle left-to-right
    const baseLockMs = 500;
    const stepMs = 140;
    rollResult.seats.forEach((seat, idx) => {
      const lockAt = baseLockMs + idx * stepMs;
      const t = window.setTimeout(() => {
        if (cancelled) return;
        rollingSeats.delete(seat.seatIdx);
        setSeatDisplayValues((prev) => ({
          ...prev,
          [seat.seatIdx]: seat.initialRoll,
        }));
        setSeatStates((prev) => ({
          ...prev,
          [seat.seatIdx]: seat.hadTieBreak ? 'tie' : 'settled',
        }));
      }, lockAt);
      timers.push(t);
    });

    const allLockedAt = baseLockMs + rollResult.seats.length * stepMs + 80;

    if (rollResult.hadTieBreak) {
      const tieStartAt = allLockedAt + 260;
      const tieEndAt = tieStartAt + 560;

      timers.push(
        window.setTimeout(() => {
          if (cancelled) return;
          setPhaseLabel(
            `Tie at ${rollResult.tiedValue ?? ''}! Re-rolling tied high seats...`
          );
          playTabletopSound(soundEnabled, 'dice');
          rollResult.seats.forEach((seat) => {
            if (seat.hadTieBreak) {
              rollingSeats.add(seat.seatIdx);
              setSeatStates((prev) => ({ ...prev, [seat.seatIdx]: 'rolling' }));
            }
          });
        }, tieStartAt)
      );

      timers.push(
        window.setTimeout(() => {
          if (cancelled) return;
          rollResult.seats.forEach((seat) => {
            rollingSeats.delete(seat.seatIdx);
          });
          const finalNums: Record<number, number> = {};
          const finalStates: Record<number, 'idle' | 'rolling' | 'settled' | 'tie' | 'winner'> =
            {};
          rollResult.seats.forEach((seat) => {
            finalNums[seat.seatIdx] = seat.finalRoll;
            finalStates[seat.seatIdx] = seat.isWinner ? 'winner' : 'settled';
          });
          setSeatDisplayValues(finalNums);
          setSeatStates(finalStates);
          setIsAnimating(false);
          const winner = rollResult.seats.find((s) => s.isWinner);
          setPhaseLabel(`${winner?.name || 'Winner'} wins the roll-off and goes first!`);
          playTabletopSound(soundEnabled, 'turn');
          onSettledRef.current?.(rollResult);
        }, tieEndAt)
      );
    } else {
      timers.push(
        window.setTimeout(() => {
          if (cancelled) return;
          const finalNums: Record<number, number> = {};
          const finalStates: Record<number, 'idle' | 'rolling' | 'settled' | 'tie' | 'winner'> =
            {};
          rollResult.seats.forEach((seat) => {
            finalNums[seat.seatIdx] = seat.finalRoll;
            finalStates[seat.seatIdx] = seat.isWinner ? 'winner' : 'settled';
          });
          setSeatDisplayValues(finalNums);
          setSeatStates(finalStates);
          setIsAnimating(false);
          const winner = rollResult.seats.find((s) => s.isWinner);
          setPhaseLabel(`${winner?.name || 'Winner'} wins the roll-off and goes first!`);
          playTabletopSound(soundEnabled, 'turn');
          onSettledRef.current?.(rollResult);
        }, allLockedAt)
      );
    }

    return () => {
      cancelled = true;
      timers.forEach((id) => window.clearTimeout(id));
      intervals.forEach((id) => window.clearInterval(id));
    };
  }, [rollResult, rollNonce, soundEnabled]);

  if (!rollResult) return null;

  const gridCols =
    rollResult.seats.length <= 2
      ? 'grid-cols-2'
      : rollResult.seats.length === 3
      ? 'grid-cols-3'
      : 'grid-cols-2 sm:grid-cols-4';

  return (
    <div
      className={`rounded-xl border border-sky-300/70 bg-sky-50/40 ${
        compact ? 'p-3 space-y-3' : 'p-4 space-y-3.5'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs sm:text-sm font-bold text-zinc-900">
          <Dices
            className={`h-4 w-4 text-sky-700 shrink-0 ${
              isAnimating ? 'animate-spin' : ''
            }`}
          />
          <span>{title}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onReroll && (
            <button
              type="button"
              onClick={onReroll}
              className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-sky-300 bg-white px-3 py-1.5 text-xs font-semibold text-sky-800 hover:bg-sky-50 cursor-pointer whitespace-nowrap"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isAnimating ? 'animate-spin' : ''}`} />
              <span>Re-roll d20</span>
            </button>
          )}
          {onSkipAndProceed && (
            <button
              type="button"
              onClick={onSkipAndProceed}
              className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg bg-sky-700 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-sky-800 cursor-pointer whitespace-nowrap"
            >
              <FastForward className="h-3.5 w-3.5" />
              <span>{autoLaunchCountdownLabel || 'Start Now'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Animated Dice Grid */}
      <div className={`grid gap-2.5 ${gridCols}`}>
        {rollResult.seats.map((seat) => {
          const displayNum = seatDisplayValues[seat.seatIdx] ?? seat.finalRoll;
          const dieState = seatStates[seat.seatIdx] ?? (seat.isWinner ? 'winner' : 'settled');
          const isWinnerCard = dieState === 'winner';
          const isTieCard = dieState === 'tie';
          const isNat20 = dieState !== 'rolling' && displayNum === 20;

          return (
            <div
              key={seat.seatIdx}
              className={`relative flex flex-col items-center justify-between gap-2 rounded-xl border px-2.5 py-3 text-center transition-all ${
                isWinnerCard
                  ? 'border-emerald-400 bg-emerald-50 ring-1 ring-emerald-400/50 shadow-sm'
                  : isTieCard
                  ? 'border-amber-400 bg-amber-50'
                  : 'border-zinc-200 bg-white'
              }`}
            >
              <div className="w-full min-w-0">
                <div className="flex items-center justify-center gap-1 text-xs font-bold text-zinc-900 truncate">
                  {isWinnerCard && (
                    <Crown className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                  )}
                  <span className="truncate">{seat.name}</span>
                </div>
                {seat.roleLabel && (
                  <div className="text-[11px] font-medium text-zinc-500 truncate">
                    {seat.roleLabel}
                  </div>
                )}
              </div>

              <D20DieIcon
                value={displayNum}
                state={dieState}
                size={compact ? 'sm' : 'md'}
              />

              <div className="min-h-[22px] flex items-center justify-center">
                {dieState === 'rolling' ? (
                  <span className="text-[11px] font-semibold text-sky-700 animate-pulse">
                    Rolling...
                  </span>
                ) : isWinnerCard ? (
                  <span className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
                    {isNat20 && <Sparkles className="h-3 w-3 text-amber-500" />}
                    {isNat20 ? 'NAT 20 · 1st!' : 'Goes 1st!'}
                  </span>
                ) : isTieCard ? (
                  <span className="rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                    Tie ({seat.initialRoll})!
                  </span>
                ) : (
                  <span className="text-[11px] font-medium text-zinc-600 font-mono tabular-nums">
                    {seat.hadTieBreak
                      ? `Tie ${seat.initialRoll} → ${seat.finalRoll}`
                      : `Rolled ${seat.finalRoll}`}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Live Status Banner */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs">
        <span
          className={`font-semibold ${
            isAnimating ? 'text-sky-700' : 'text-emerald-800'
          }`}
        >
          {phaseLabel}
        </span>
        {!isAnimating && (
          <span className="font-mono text-[11px] text-zinc-500">
            Highest d20 leads Turn 1
          </span>
        )}
      </div>
    </div>
  );
};
