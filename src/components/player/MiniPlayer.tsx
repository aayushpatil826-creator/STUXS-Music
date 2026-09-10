import React, { useState, useRef } from 'react';
import { Play, Pause, SkipForward, Heart, ListMusic, Loader2 } from 'lucide-react';
import { usePlayer } from '../../context/PlayerContext';
import { useLibrary } from '../../context/LibraryContext';
import { usePlaybackProgress } from '../../services/playbackEvents';
import { BRANDING_CONFIG } from '../../config/branding';

interface MiniProgressRowProps {
  onSeek: (position: number) => void;
}

const MiniProgressRow: React.FC<MiniProgressRowProps> = React.memo(({ onSeek }) => {
  const { progress, duration } = usePlaybackProgress();
  const progressBarRef = useRef<HTMLDivElement>(null);

  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (progress / duration) * 100)) : 0;

  const remainingSeconds = Math.max(0, duration - progress);
  const remainingMins = Math.floor(remainingSeconds / 60);
  const remainingSecs = Math.floor(remainingSeconds % 60);
  const formattedRemaining = `-${remainingMins}:${remainingSecs.toString().padStart(2, '0')}`;

  const handleSeek = (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!progressBarRef.current || duration <= 0) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clickX = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const seekRatio = clickX / rect.width;
    onSeek(seekRatio * duration);
  };

  return (
    <div className="flex items-center pt-2.5 px-0.5 w-full">
      {/* Progress Track */}
      <div
        ref={progressBarRef}
        onClick={handleSeek}
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={duration}
        className="relative flex-1 h-1.5 bg-[#EAEFF7] dark:bg-white/15 rounded-full cursor-pointer touch-none"
      >
        {/* Purple Active Progress Line */}
        <div
          className="h-full bg-stuxs-accent rounded-full"
          style={{ width: `${progressPercent}%` }}
        />

        {/* Thumb circle */}
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 bg-white border-2 border-black dark:border-white rounded-full shadow-sm pointer-events-none"
          style={{ left: `${progressPercent}%` }}
        />
      </div>

      {/* Remaining Time */}
      <span className="text-[11px] font-medium text-gray-400 dark:text-white/50 ml-3 flex-shrink-0 tabular-nums select-none">
        {duration > 0 ? formattedRemaining : '-0:00'}
      </span>
    </div>
  );
});

const MiniPlayerComponent: React.FC = () => {
  const {
    currentTrack,
    isPlaying,
    isLoadingTrack,
    smartQueueEnabled,
    playbackSource,
    activeLibraryPlaylist,
    togglePlay,
    nextTrack,
    seek,
    isNowPlayingOpen,
    setIsNowPlayingOpen,
  } = usePlayer();
  const { isFavorite, toggleFavorite } = useLibrary();
  const [heartAnimated, setHeartAnimated] = useState(false);
  const touchStartY = useRef<number>(0);
  const touchStartTime = useRef<number>(0);

  if (!currentTrack) return null;

  const favorite = isFavorite(currentTrack.id);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
    touchStartTime.current = performance.now();
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const deltaY = e.changedTouches[0].clientY - touchStartY.current;
    const elapsed = Math.max(1, performance.now() - touchStartTime.current);
    const velocityY = deltaY / elapsed;

    // Upward swipe or flick to open Now Playing
    if (deltaY < -20 || velocityY < -0.3) {
      setIsNowPlayingOpen(true);
    }
  };

  const handleOpenNowPlaying = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsNowPlayingOpen(true);
  };

  const handleFavoriteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setHeartAnimated(true);
    setTimeout(() => setHeartAnimated(false), 260);
    toggleFavorite(currentTrack);
  };

  return (
    <div
      id="stuxs-mini-player-wrapper"
      className="px-3 pb-2 pt-1 w-full select-none"
      style={{
        pointerEvents: isNowPlayingOpen ? 'none' : 'auto',
      }}
    >
      <div
        id="stuxs-mini-player-card"
        onClick={handleOpenNowPlaying}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        role="button"
        tabIndex={0}
        aria-label={`Open Now Playing for ${currentTrack.title} by ${currentTrack.artistName}`}
        className="relative overflow-hidden rounded-2xl p-2.5 bg-[#FFFDF9] dark:bg-[#16161E] text-[#0F172A] dark:text-white shadow-[0_4px_20px_rgba(0,0,0,0.06)] dark:shadow-[0_4px_20px_rgba(0,0,0,0.4)] border border-black/[0.06] dark:border-white/10 transition-transform duration-150 active:scale-[0.98] cursor-pointer"
      >
        {/* Top Row: [ Album Artwork ] [ Song Title / Artist ] [ Like ] [ Play/Pause ] [ Next ] */}
        <div className="flex items-center justify-between space-x-2.5 min-w-0">
          {/* Left: Square Album Artwork */}
          <div
            id="stuxs-mini-player-artwork"
            className="relative w-11 h-11 rounded-xl overflow-hidden bg-gray-100 dark:bg-white/10 flex-shrink-0 shadow-sm ring-1 ring-black/5 dark:ring-white/10"
          >
            <img
              key={currentTrack.id}
              src={currentTrack.artworkUrl || BRANDING_CONFIG.appLogo}
              alt={currentTrack.title}
              className="w-full h-full object-cover animate-artwork-crossfade"
              loading="lazy"
              onError={(e) => {
                const target = e.currentTarget;
                if (!target.dataset.fallbackApplied) {
                  target.dataset.fallbackApplied = 'true';
                  target.src = BRANDING_CONFIG.appLogo;
                }
              }}
            />
          </div>

          {/* Center: Song Title & Artist */}
          <div className="min-w-0 flex-1 pr-1">
            <div className="flex items-center space-x-1 min-w-0">
              <h4
                key={`title-${currentTrack.id}`}
                className="text-[13px] font-bold text-gray-900 dark:text-white truncate leading-tight tracking-tight"
              >
                {currentTrack.title}
              </h4>
              {smartQueueEnabled && playbackSource === 'library-playlist' && activeLibraryPlaylist !== null && (
                <span title="Smart Queue Active">
                  <ListMusic className="w-3 h-3 text-purple-600 dark:text-purple-400 flex-shrink-0" />
                </span>
              )}
            </div>
            <p
              key={`artist-${currentTrack.id}`}
              className="text-[11px] font-normal text-gray-400 dark:text-white/50 truncate mt-0.5 leading-tight"
            >
              {currentTrack.artistName}
            </p>
          </div>

          {/* Right Controls: [ Like ] [ Play/Pause ] [ Next ] */}
          <div className="flex items-center space-x-2 flex-shrink-0 z-10">
            {/* Like / Favorite Button */}
            <button
              onClick={handleFavoriteClick}
              className={`p-1.5 text-gray-400 dark:text-white/60 hover:text-rose-500 active:scale-90 transition-transform ${
                heartAnimated ? 'animate-heart-pop' : ''
              }`}
              aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
            >
              <Heart
                className={`w-4 h-4 transition-colors duration-200 ${
                  favorite ? 'text-rose-500 fill-rose-500' : 'text-gray-400 dark:text-white/60'
                }`}
              />
            </button>

            {/* Play / Pause Circular Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                togglePlay();
              }}
              className="w-8 h-8 rounded-full bg-black dark:bg-white text-white dark:text-black flex items-center justify-center shadow-sm active:scale-90 transition-transform"
              aria-label={isLoadingTrack ? 'Loading' : isPlaying ? 'Pause' : 'Play'}
            >
              {isLoadingTrack ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-white dark:text-black" />
              ) : isPlaying ? (
                <Pause className="w-3.5 h-3.5 fill-current" />
              ) : (
                <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
              )}
            </button>

            {/* Next Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                nextTrack();
              }}
              className="p-1.5 text-black dark:text-white hover:opacity-75 active:scale-90 transition-transform"
              aria-label="Next track"
            >
              <SkipForward className="w-4 h-4 fill-current" />
            </button>
          </div>
        </div>

        {/* Bottom Row: [ Purple Progress Bar ------------------O ] [ -1:40 ] */}
        <MiniProgressRow onSeek={seek} />
      </div>
    </div>
  );
};

export const MiniPlayer = React.memo(MiniPlayerComponent);

