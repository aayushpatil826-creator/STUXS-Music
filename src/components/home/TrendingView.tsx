import React, { useEffect } from 'react';
import { ChevronLeft, Flame, Play, Shuffle } from 'lucide-react';
import type { Track } from '../../types/music';
import { TrackRow } from '../common/TrackRow';
import { usePlayerActions } from '../../context/PlayerContext';
import { backButtonManager } from '../../services/backButtonManager';

interface TrendingViewProps {
  tracks: Track[];
  onBack: () => void;
  onSelectArtist: (artistId: string) => void;
  onSelectAlbum: (albumId?: string) => void;
}

export const TrendingView: React.FC<TrendingViewProps> = ({
  tracks,
  onBack,
  onSelectArtist,
  onSelectAlbum,
}) => {
  const { playTrack } = usePlayerActions();

  // Register with BackButtonManager for Android hardware/gesture back support
  useEffect(() => {
    const unregister = backButtonManager.register('trending-page', onBack, 20);
    return () => {
      unregister();
    };
  }, [onBack]);

  const handlePlayAll = () => {
    if (tracks.length > 0) {
      playTrack(tracks[0], tracks, { source: 'home' });
    }
  };

  const handleShuffle = () => {
    if (tracks.length > 0) {
      playTrack(tracks[0], tracks, { source: 'home', shuffle: true });
    }
  };

  return (
    <div className="animate-in fade-in duration-200 bg-gradient-to-b from-[#7C3AED]/12 via-[#6366F1]/06 to-transparent dark:from-[#1E1138]/60 dark:via-[#140C24]/40 dark:to-transparent">
      {/* Sticky Top Navigation Bar */}
      <div className="sticky top-0 z-20 px-4 sm:px-5 safe-top-header pb-3 bg-stuxs-bg/95 backdrop-blur-md border-b border-stuxs-border/40 flex items-center justify-between">
        <button
          onClick={onBack}
          className="w-9 h-9 rounded-full bg-white/80 dark:bg-white/10 hover:bg-white dark:hover:bg-white/15 border border-black/5 dark:border-white/10 text-stuxs-text flex items-center justify-center active:scale-95 transition-all shadow-xs cursor-pointer"
          aria-label="Back to Home"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        <div className="flex items-center space-x-1.5">
          <Flame className="w-4 h-4 text-purple-600 dark:text-purple-400 fill-current" />
          <span className="text-xs font-bold uppercase tracking-wider text-stuxs-text">
            Trending Chart
          </span>
        </div>

        <span className="px-2.5 py-0.5 rounded-full bg-purple-600/15 text-purple-600 dark:text-purple-400 text-[11px] font-bold border border-purple-500/25 tabular-nums">
          Top {tracks.length}
        </span>
      </div>

      {/* Discovery Title & Quick Action Banner */}
      <div className="px-4 sm:px-5 pt-4 pb-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black text-stuxs-text tracking-tight flex items-center space-x-2">
              <span>Top Trending</span>
            </h1>
            <p className="text-xs text-stuxs-text-secondary mt-0.5">
              Most streamed viral tracks right now • India
            </p>
          </div>
        </div>

        {/* Quick Action Controls: Play All & Shuffle */}
        <div className="flex items-center space-x-3 mt-3.5">
          <button
            onClick={handlePlayAll}
            className="flex-1 flex items-center justify-center space-x-2 py-2.5 rounded-full bg-purple-600 hover:bg-purple-500 active:scale-95 text-white font-bold text-xs shadow-md transition-all cursor-pointer"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>Play All</span>
          </button>
          <button
            onClick={handleShuffle}
            className="w-10 h-10 rounded-full bg-white/80 dark:bg-white/10 hover:bg-white dark:hover:bg-white/15 border border-black/5 dark:border-white/10 text-stuxs-text active:scale-95 transition-all flex items-center justify-center shadow-xs cursor-pointer"
            aria-label="Shuffle Trending"
          >
            <Shuffle className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Natural, Single Vertical Track List (Ends naturally after last song with clearance above MiniPlayer) */}
      <div className="px-3 sm:px-4 space-y-1 pt-1 pb-20">
        {tracks.map((track, idx) => (
          <TrackRow
            key={`trending-row-${track.id}`}
            track={track}
            index={idx}
            showIndex={true}
            context="home"
            playlistContext={tracks}
            onSelectArtist={onSelectArtist}
            onSelectAlbum={onSelectAlbum}
          />
        ))}
      </div>
    </div>
  );
};
