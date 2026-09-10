import React, { useEffect, useState, useRef, useMemo } from 'react';
import { Mic2, Loader2, Sparkles } from 'lucide-react';
import type { Track } from '../../types/music';
import type { LyricsResult } from '../../lyrics/types';
import { lyricsService } from '../../lyrics/LyricsService';
import { findActiveLyricIndex } from '../../lyrics/parser';
import { usePlaybackProgress } from '../../services/playbackEvents';

interface LyricsViewProps {
  currentTrack: Track;
  progress?: number; // in seconds
  duration?: number; // in seconds
  onSeek: (seconds: number) => void;
}

export const LyricsView: React.FC<LyricsViewProps> = ({
  currentTrack,
  progress: propProgress,
  onSeek,
}) => {
  const liveProgress = usePlaybackProgress();
  const progress = propProgress !== undefined ? propProgress : liveProgress.progress;
  const [lyrics, setLyrics] = useState<LyricsResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const activeLineRef = useRef<HTMLParagraphElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Fetch lyrics on track change with cache check
  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    setLyrics(null);

    lyricsService
      .getLyrics(currentTrack)
      .then((res) => {
        if (isMounted) {
          setLyrics(res);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (isMounted) {
          setLyrics(null);
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [currentTrack.id, currentTrack.title, currentTrack.artistName]);

  // Current playback time in milliseconds
  const currentTimeMs = useMemo(() => progress * 1000, [progress]);

  // Find active line index using binary search
  const activeIndex = useMemo(() => {
    if (!lyrics?.syncedLyrics || lyrics.syncedLyrics.length === 0) return -1;
    return findActiveLyricIndex(lyrics.syncedLyrics, currentTimeMs);
  }, [lyrics?.syncedLyrics, currentTimeMs]);

  // Auto-scroll to active line smoothly ONLY within local lyrics container
  useEffect(() => {
    if (activeLineRef.current && containerRef.current) {
      const container = containerRef.current;
      const activeEl = activeLineRef.current;
      const targetTop = activeEl.offsetTop - container.clientHeight / 2 + activeEl.clientHeight / 2;
      container.scrollTo({
        top: Math.max(0, targetTop),
        behavior: 'smooth',
      });
    }
  }, [activeIndex]);

  const handleLineClick = (timeMs: number) => {
    onSeek(timeMs / 1000);
  };

  // Prevent scroll events from bubbling to parent player gesture handlers
  const stopGesturePropagation = (e: React.TouchEvent) => {
    e.stopPropagation();
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="lyrics-scroll-container w-full max-w-md h-full flex flex-col items-center justify-center space-y-4 py-8 text-neutral-400 dark:text-white/40">
        <Loader2 className="w-7 h-7 text-purple-600 dark:text-purple-400 animate-spin" />
        <p className="text-xs font-semibold tracking-wider uppercase">
          Loading lyrics...
        </p>
      </div>
    );
  }

  // Empty state: No lyrics found
  if (!lyrics || (!lyrics.syncedLyrics && !lyrics.plainLyrics)) {
    return (
      <div className="lyrics-scroll-container w-full max-w-md h-full flex flex-col items-center justify-center space-y-3 py-8 text-center animate-in fade-in duration-300">
        <div className="w-14 h-14 rounded-full bg-black/5 dark:bg-white/10 border border-black/5 dark:border-white/10 flex items-center justify-center shadow-xs">
          <Mic2 className="w-7 h-7 text-neutral-400 dark:text-white/40 stroke-[1.5]" />
        </div>
        <div>
          <h4 className="text-sm font-bold text-neutral-900 dark:text-white">No lyrics available</h4>
          <p className="text-xs text-neutral-500 dark:text-white/50 mt-0.5">Lyrics aren't available for this track</p>
        </div>
      </div>
    );
  }

  // Synced Lyrics rendering (Karaoke style)
  if (lyrics.isSynced && lyrics.syncedLyrics && lyrics.syncedLyrics.length > 0) {
    return (
      <div
        ref={containerRef}
        onTouchStart={stopGesturePropagation}
        onTouchMove={stopGesturePropagation}
        onTouchEnd={stopGesturePropagation}
        className="lyrics-scroll-container w-full max-w-md h-full flex flex-col overflow-y-auto px-4 py-16 space-y-5 text-center scrollbar-none select-none scroll-smooth touch-pan-y"
        style={{
          overscrollBehaviorY: 'contain',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {/* Synced badge */}
        <div className="inline-flex items-center justify-center space-x-1.5 px-3 py-1 rounded-full bg-black/5 dark:bg-white/10 border border-black/5 dark:border-white/10 text-[10px] font-bold uppercase tracking-widest text-purple-600 dark:text-purple-400 mx-auto mb-2 shadow-xs">
          <Sparkles className="w-3 h-3" />
          <span>Synced with Audio • Tap line to seek</span>
        </div>

        {lyrics.syncedLyrics.map((line, idx) => {
          const isActive = idx === activeIndex;
          const diff = idx - activeIndex;

          let lineStyle = '';
          if (isActive) {
            lineStyle =
              'text-neutral-950 dark:text-white font-extrabold text-xl sm:text-2xl scale-[1.02] filter drop-shadow-sm opacity-100 bg-black/5 dark:bg-white/10 rounded-2xl py-2 px-4';
          } else if (diff === 1) {
            lineStyle = 'text-neutral-700 dark:text-white/70 font-semibold text-base sm:text-lg';
          } else if (diff === 2) {
            lineStyle = 'text-neutral-500 dark:text-white/50 font-medium text-base sm:text-lg';
          } else if (diff === 3) {
            lineStyle = 'text-neutral-400 dark:text-white/35 font-normal text-base sm:text-lg';
          } else if (diff > 3) {
            lineStyle = 'text-neutral-300 dark:text-white/20 font-normal text-base sm:text-lg';
          } else {
            // Past lyrics (diff < 0)
            lineStyle = 'text-neutral-400 dark:text-white/35 font-normal text-base sm:text-lg';
          }

          return (
            <p
              key={`${line.timeMs}-${idx}`}
              ref={isActive ? activeLineRef : null}
              onClick={() => handleLineClick(line.timeMs)}
              className={`transition-all duration-200 ease-out will-change-[transform,opacity] cursor-pointer select-none px-4 py-1.5 ${lineStyle}`}
            >
              {line.text || '♪'}
            </p>
          );
        })}
      </div>
    );
  }

  // Plain Lyrics rendering
  return (
    <div
      onTouchStart={stopGesturePropagation}
      onTouchMove={stopGesturePropagation}
      onTouchEnd={stopGesturePropagation}
      className="lyrics-scroll-container w-full max-w-md h-full flex flex-col overflow-y-auto px-6 py-10 space-y-4 text-center scrollbar-none touch-pan-y"
      style={{
        overscrollBehaviorY: 'contain',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      {lyrics.plainLyrics?.split('\n').map((line, idx) => (
        <p
          key={idx}
          className="text-base sm:text-lg font-medium text-neutral-800 dark:text-white/85 leading-relaxed"
        >
          {line || ' '}
        </p>
      ))}
      {lyrics.source && (
        <p className="pt-6 text-[10px] font-bold text-neutral-400 dark:text-white/40 uppercase tracking-widest">
          Lyrics provided by {lyrics.source}
        </p>
      )}
    </div>
  );
};
