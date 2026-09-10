import React, { useRef, useState } from 'react';
import { usePlaybackProgress } from '../../services/playbackEvents';

interface ProgressBarProps {
  progress?: number; // in seconds
  duration?: number; // in seconds
  onSeek: (position: number) => void;
  showTimes?: boolean;
  size?: 'normal' | 'thin';
  timeDisplayMode?: 'remaining' | 'duration';
  alwaysShowThumb?: boolean;
  showCurrentTime?: boolean;
  inlineTime?: boolean;
  timePosition?: 'top-right' | 'bottom' | 'inline';
}

const ProgressBarComponent: React.FC<ProgressBarProps> = ({
  progress: propProgress,
  duration: propDuration,
  onSeek,
  showTimes = true,
  size = 'normal',
  timeDisplayMode = 'remaining',
  alwaysShowThumb = false,
  showCurrentTime = true,
  inlineTime = false,
  timePosition = 'top-right',
}) => {
  const resolvedTimePosition = inlineTime ? 'inline' : timePosition;
  const liveProgress = usePlaybackProgress();
  const progress = propProgress !== undefined ? propProgress : liveProgress.progress;
  const duration = propDuration !== undefined ? propDuration : liveProgress.duration;

  const [isDragging, setIsDragging] = useState(false);
  const [hoverPosition, setHoverPosition] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const calculateSeekPosition = (clientX: number) => {
    if (!barRef.current || duration <= 0) return 0;
    const rect = barRef.current.getBoundingClientRect();
    const clickX = clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, clickX / rect.width));
    return percentage * duration;
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    setIsDragging(true);
    const newPos = calculateSeekPosition(e.clientX);
    setHoverPosition(newPos);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (isDragging) {
      const newPos = calculateSeekPosition(e.clientX);
      setHoverPosition(newPos);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isDragging) {
      const newPos = calculateSeekPosition(e.clientX);
      onSeek(newPos);
      setIsDragging(false);
      setHoverPosition(null);
      try {
        if ((e.target as HTMLElement).hasPointerCapture(e.pointerId)) {
          (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        }
      } catch {}
    }
  };

  const handlePointerCancel = (e: React.PointerEvent) => {
    if (isDragging) {
      setIsDragging(false);
      setHoverPosition(null);
      try {
        if ((e.target as HTMLElement).hasPointerCapture(e.pointerId)) {
          (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        }
      } catch {}
    }
  };

  const currentDisplayPosition = isDragging && hoverPosition !== null ? hoverPosition : progress;
  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (currentDisplayPosition / duration) * 100)) : 0;

  if (resolvedTimePosition === 'inline') {
    return (
      <div className="w-full flex items-center gap-3 select-none">
        <div
          ref={barRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onLostPointerCapture={handlePointerCancel}
          className={`group relative flex-1 cursor-pointer flex items-center py-2 touch-none ${
            size === 'thin' ? 'h-3' : 'h-6'
          }`}
        >
          {/* Track background */}
          <div
            className={`w-full bg-black/15 dark:bg-white/20 rounded-full overflow-hidden transition-[height] duration-150 ${
              size === 'thin' ? 'h-1 group-hover:h-1.5' : 'h-1.5 group-hover:h-2'
            }`}
          >
            {/* Filled progress */}
            <div
              className={`h-full bg-stuxs-accent rounded-full relative ${
                isDragging ? 'transition-none' : 'transition-[width] duration-200 ease-linear will-change-[width]'
              }`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          {/* Thumb handle on hover/drag */}
          <div
            className={`absolute w-3.5 h-3.5 bg-white rounded-full shadow-lg ring-2 ring-purple-600 transform -translate-x-1/2 will-change-transform ${
              isDragging
                ? 'scale-125 opacity-100 transition-none'
                : alwaysShowThumb
                ? 'opacity-100 scale-100 shadow-md'
                : 'opacity-0 group-hover:opacity-100 scale-100 transition-[opacity,transform] duration-150'
            }`}
            style={{ left: `${progressPercent}%` }}
          />
        </div>

        {showTimes && (
          <span className="text-xs font-semibold opacity-70 tabular-nums min-w-[38px] text-right select-none">
            {timeDisplayMode === 'duration'
              ? formatTime(duration)
              : `-${formatTime(Math.max(0, duration - currentDisplayPosition))}`}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="w-full select-none">
      {/* Top-right remaining time sitting directly above the right edge of the progress track */}
      {showTimes && resolvedTimePosition === 'top-right' && (
        <div className="flex items-center justify-end px-0.5 mb-1 select-none">
          <span className="text-[11px] font-semibold text-neutral-500 dark:text-white/60 tabular-nums select-none">
            {timeDisplayMode === 'duration'
              ? formatTime(duration)
              : `-${formatTime(Math.max(0, duration - currentDisplayPosition))}`}
          </span>
        </div>
      )}

      {/* Progress Track */}
      <div
        ref={barRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onLostPointerCapture={handlePointerCancel}
        className={`group relative w-full cursor-pointer flex items-center py-2 touch-none ${
          size === 'thin' ? 'h-3' : 'h-6'
        }`}
      >
        {/* Track background */}
        <div
          className={`w-full bg-black/15 dark:bg-white/20 rounded-full overflow-hidden transition-[height] duration-150 ${
            size === 'thin' ? 'h-1 group-hover:h-1.5' : 'h-1.5 group-hover:h-2'
          }`}
        >
          {/* Filled progress */}
          <div
            className={`h-full bg-stuxs-accent rounded-full relative ${
              isDragging ? 'transition-none' : 'transition-[width] duration-200 ease-linear will-change-[width]'
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Thumb handle on hover/drag */}
        <div
          className={`absolute w-3.5 h-3.5 bg-white rounded-full shadow-lg ring-2 ring-purple-600 transform -translate-x-1/2 will-change-transform ${
            isDragging
              ? 'scale-125 opacity-100 transition-none'
              : alwaysShowThumb
              ? 'opacity-100 scale-100 shadow-md'
              : 'opacity-0 group-hover:opacity-100 scale-100 transition-[opacity,transform] duration-150'
          }`}
          style={{ left: `${progressPercent}%` }}
        />
      </div>

      {/* Bottom times fallback (only when explicitly set to 'bottom') */}
      {showTimes && resolvedTimePosition === 'bottom' && (
        <div className={`flex items-center text-[11px] font-semibold text-stuxs-text-secondary px-0.5 mt-[-2px] tabular-nums select-none ${showCurrentTime ? 'justify-between' : 'justify-end'}`}>
          {showCurrentTime && <span>{formatTime(currentDisplayPosition)}</span>}
          <span>
            {timeDisplayMode === 'duration'
              ? formatTime(duration)
              : `-${formatTime(Math.max(0, duration - currentDisplayPosition))}`}
          </span>
        </div>
      )}
    </div>
  );
};

export const ProgressBar = React.memo(ProgressBarComponent);

