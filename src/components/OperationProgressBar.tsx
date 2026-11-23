import React, { useEffect, useState } from 'react';
import { Loader2, XCircle } from 'lucide-react';
import type { OperationProgressUpdate } from '../utils/streamApi';

export type OperationProgressState = OperationProgressUpdate;

interface OperationProgressBarProps {
  title: string;
  progress: OperationProgressState;
  compact?: boolean;
  onCancel?: () => void;
  cancelLabel?: string;
}

function formatElapsed(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export const OperationProgressBar: React.FC<OperationProgressBarProps> = ({
  title,
  progress,
  compact = false,
  onCancel,
  cancelLabel = 'Cancel',
}) => {
  const clampedTarget = Math.max(0, Math.min(100, Number(progress.percent) || 0));
  const [displayedPercent, setDisplayedPercent] = useState<number>(clampedTarget);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);

  // Elapsed wall-clock timer while operation is active
  useEffect(() => {
    setElapsedSeconds(0);
    const timer = window.setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Snap forward whenever a higher checkpoint arrives from backend/fallback
  useEffect(() => {
    setDisplayedPercent((prev) => {
      if (clampedTarget >= 100) return 100;
      if (clampedTarget <= 5 && prev > clampedTarget + 20) return clampedTarget;
      return Math.max(prev, clampedTarget);
    });
  }, [clampedTarget]);

  // Subtle asymptotic crawl between server-sent checkpoints so remote LLM waits feel alive
  useEffect(() => {
    if (clampedTarget >= 100) return;
    const tick = window.setInterval(() => {
      setDisplayedPercent((prev) => {
        const softCap = Math.min(94, clampedTarget + 10);
        if (prev >= softCap) return prev;
        const remaining = softCap - prev;
        const step = Math.max(0.25, Math.min(1.1, remaining * 0.14));
        return Math.min(softCap, prev + step);
      });
    }, 450);
    return () => window.clearInterval(tick);
  }, [clampedTarget]);

  const roundedPercent = Math.round(displayedPercent);

  return (
    <div
      className={
        compact
          ? 'rounded-lg border border-sky-200 bg-sky-50/60 p-4 space-y-2.5'
          : 'space-y-3'
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Loader2 className="h-4 w-4 animate-spin text-sky-700 shrink-0" />
          <span
            className={`font-semibold text-zinc-900 truncate ${
              compact ? 'text-xs' : 'text-sm'
            }`}
          >
            {title}
          </span>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <span className="font-mono text-xs tabular-nums text-zinc-500">
            {formatElapsed(elapsedSeconds)}
          </span>
          <span className="font-mono text-sm font-bold tabular-nums text-sky-800">
            {roundedPercent}%
          </span>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 hover:border-red-400 cursor-pointer transition-colors"
            >
              <XCircle className="h-3.5 w-3.5 shrink-0" />
              <span>{cancelLabel}</span>
            </button>
          )}
        </div>
      </div>

      <div
        role="progressbar"
        aria-label={title}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={roundedPercent}
        className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-200"
      >
        <div
          className="h-full rounded-full bg-sky-600 transition-all duration-300 ease-out"
          style={{ width: `${Math.max(2, roundedPercent)}%` }}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
        <span className="font-medium text-zinc-700">{progress.stage}</span>
        {progress.detail && (
          <span className="font-mono text-[11px] text-zinc-500">
            {progress.detail}
          </span>
        )}
      </div>
    </div>
  );
};
