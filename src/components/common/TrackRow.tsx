import React, { useState } from 'react';
import { Play, Pause, Heart, MoreVertical, Lock, ArrowDownCircle, Loader2 } from 'lucide-react';
import type { Track } from '../../types/music';
import { usePlayer, usePlayerActions } from '../../context/PlayerContext';
import { useLibrary } from '../../context/LibraryContext';
import { TrackActionMenu, type TrackMenuContext } from './TrackActionMenu';
import { formatTrackDuration } from '../../utils/trackCapabilities';
import { BRANDING_CONFIG } from '../../config/branding';

interface TrackRowProps {
  track: Track;
  index?: number;
  playlistContext?: Track[];
  context?: TrackMenuContext;
  playlistId?: string; // If rendered inside a playlist screen
  showIndex?: boolean;
  showArtwork?: boolean;
  onSelectArtist?: (artistId: string) => void;
  onSelectAlbum?: (albumId?: string) => void;
}

const TrackRowComponent: React.FC<TrackRowProps> = ({
  track,
  index,
  playlistContext,
  context = 'search',
  playlistId,
  showIndex = false,
  showArtwork = true,
  onSelectArtist,
  onSelectAlbum,
}) => {
  const { currentTrack, isPlaying } = usePlayer();
  const { playTrack, togglePlay } = usePlayerActions();
  const { isFavorite, toggleFavorite, isDownloaded, getDownloadProgress } = useLibrary();
  const [showMenu, setShowMenu] = useState(false);
  const [unplayableNotice, setUnplayableNotice] = useState(false);
  const [heartAnimated, setHeartAnimated] = useState(false);

  const isCurrent = currentTrack?.id === track.id;
  const favorite = isFavorite(track.id);
  const isUnplayable = track.accessStatus === 'blocked';
  const downloaded = isDownloaded(track.id);
  const progress = getDownloadProgress(track.id);
  const isDownloading = progress.status === 'downloading';

  const handleRowClick = () => {
    if (isUnplayable) {
      setUnplayableNotice(true);
      setTimeout(() => setUnplayableNotice(false), 2500);
      return;
    }

    if (isCurrent) {
      togglePlay();
    } else {
      const source = context === 'playlist' ? 'library-playlist' : context === 'album' ? 'album' : context === 'artist' ? 'artist' : context === 'home' ? 'home' : 'search';
      playTrack(track, playlistContext, { source, id: playlistId });
    }
  };

  const handleFavoriteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setHeartAnimated(true);
    setTimeout(() => setHeartAnimated(false), 260);
    toggleFavorite(track);
  };

  return (
    <div className="relative group select-none">
      <div
        onClick={handleRowClick}
        className={`flex items-center justify-between p-2.5 rounded-2xl cursor-pointer row-press transition-colors duration-150 ${
          isCurrent
            ? 'bg-stuxs-surface-secondary/70 border border-purple-500/40 shadow-xs'
            : 'bg-stuxs-surface-secondary/35 hover:bg-stuxs-surface-secondary/70 border border-stuxs-border/40 hover:border-purple-500/30'
        } ${isUnplayable ? 'opacity-50' : ''}`}
      >
        {/* Left: [ # ] [ Artwork ] [ Song Info (Title & Artist) — Flexible ] */}
        <div className="flex items-center space-x-3 min-w-0 flex-1 mr-3">
          {showIndex && (
            <div className="w-6 text-center flex items-center justify-center flex-shrink-0 tabular-nums">
              {isCurrent && isPlaying ? (
                <div className="flex items-end justify-center space-x-0.5 h-3.5">
                  <span className="w-0.5 h-3 bg-purple-600 dark:bg-purple-400" />
                  <span className="w-0.5 h-2 bg-purple-600 dark:bg-purple-400" />
                  <span className="w-0.5 h-3.5 bg-purple-600 dark:bg-purple-400" />
                </div>
              ) : isUnplayable ? (
                <Lock className="w-3.5 h-3.5 text-stuxs-text-muted" />
              ) : (
                <span className={`text-xs font-semibold tabular-nums ${isCurrent ? 'text-purple-600 dark:text-purple-400' : 'text-stuxs-text-muted'}`}>
                  {typeof index === 'number' ? index + 1 : '•'}
                </span>
              )}
            </div>
          )}

          {/* Artwork */}
          {showArtwork && (
            <div className="relative w-12 h-12 sm:w-13 sm:h-13 rounded-2xl overflow-hidden flex-shrink-0 bg-stuxs-surface-secondary shadow-sm ring-1 ring-black/5 dark:ring-white/10">
              <img
                src={track.artworkUrl || BRANDING_CONFIG.appLogo}
                alt={track.title}
                width={48}
                height={48}
                className="w-full h-full object-cover"
                loading="lazy"
                decoding="async"
                onError={(e) => {
                  const target = e.currentTarget;
                  if (!target.dataset.fallbackApplied) {
                    target.dataset.fallbackApplied = 'true';
                    target.src = BRANDING_CONFIG.appLogo;
                  }
                }}
              />
              <div
                className={`absolute inset-0 bg-black/35 flex items-center justify-center transition-opacity duration-150 ${
                  isCurrent ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
              >
                {isUnplayable ? (
                  <Lock className="w-4 h-4 text-white/80" />
                ) : isCurrent && isPlaying ? (
                  <div className="animate-icon-pop">
                    <Pause className="w-4 h-4 text-white fill-current" />
                  </div>
                ) : (
                  <div className="animate-icon-pop">
                    <Play className="w-4 h-4 text-white fill-current ml-0.5" />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Song Info (Title & Artist) — Flexible (flex: 1, min-w: 0) */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center space-x-1.5 min-w-0">
              <h4
                className={`text-sm font-semibold truncate ${
                  isCurrent ? 'text-stuxs-accent' : 'text-stuxs-text'
                }`}
              >
                {track.title}
              </h4>
              {track.provider === 'gaana' && (
                <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-red-500/15 text-red-400 border border-red-500/25 flex-shrink-0">
                  Gaana
                </span>
              )}
              {track.language && (
                <span className="text-[8px] font-semibold px-1 py-0.2 rounded bg-stuxs-surface-tertiary text-stuxs-text-muted border border-stuxs-border flex-shrink-0 uppercase">
                  {track.language}
                </span>
              )}
              {isUnplayable && (
                <span className="text-[9px] font-medium px-1.5 py-0.2 rounded bg-rose-500/15 text-rose-300 border border-rose-500/25 flex-shrink-0">
                  Unavailable
                </span>
              )}
            </div>

            <div className="flex items-center space-x-1.5 mt-0.5 min-w-0">
              {track.isExplicit && (
                <span className="text-[9px] font-bold px-1 py-0.2 rounded bg-stuxs-surface-tertiary text-stuxs-text-muted border border-stuxs-border flex-shrink-0">
                  E
                </span>
              )}
              <span
                onClick={(e) => {
                  if (onSelectArtist) {
                    e.stopPropagation();
                    onSelectArtist(track.artistId);
                  }
                }}
                className="text-xs text-stuxs-text-secondary truncate hover:underline"
              >
                {track.artistName}
              </span>
            </div>
          </div>
        </div>

        {/* Right Actions: [Heart] [Download] [Time] [⋮] */}
        <div className="flex items-center space-x-2 sm:space-x-2.5 flex-shrink-0">
          {/* 1. Favorite Heart */}
          <button
            onClick={handleFavoriteClick}
            className={`p-1.5 text-stuxs-text-muted hover:text-rose-500 btn-press transition-colors ${
              heartAnimated ? 'animate-heart-pop' : ''
            }`}
            aria-label="Favorite"
          >
            <Heart
              className={`w-4 h-4 transition-colors duration-200 ${
                favorite ? 'text-rose-500 fill-rose-500' : 'text-stuxs-text-muted'
              }`}
            />
          </button>

          {/* 2. Download Icon (Only for downloaded / downloading songs, 16-18px) */}
          {downloaded ? (
            <div
              className="p-1 text-emerald-400 flex items-center justify-center flex-shrink-0"
              title="Downloaded offline"
              aria-label="Downloaded offline"
            >
              <ArrowDownCircle className="w-4 h-4 text-emerald-400 stroke-[2.5]" />
            </div>
          ) : isDownloading ? (
            <div
              className="p-1 text-stuxs-accent flex items-center justify-center flex-shrink-0"
              title={`Downloading ${progress.percent}%`}
              aria-label={`Downloading ${progress.percent}%`}
            >
              <Loader2 className="w-4 h-4 text-stuxs-accent animate-spin stroke-[2.5]" />
            </div>
          ) : null}

          {/* 3. Duration */}
          <span className="text-xs font-medium text-stuxs-text-muted text-right min-w-[32px]">
            {formatTrackDuration(track)}
          </span>

          {/* 4. Three-Dot Options Menu */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(!showMenu);
            }}
            className="p-1.5 text-stuxs-text-muted hover:text-stuxs-text btn-press"
            aria-label="Options"
          >
            <MoreVertical className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Unplayable notice toast */}
      {unplayableNotice && (
        <div className="absolute top-0 right-10 z-30 px-3 py-1.5 rounded-lg bg-rose-950/90 border border-rose-500/40 text-[11px] font-semibold text-rose-200 shadow-lg animate-in fade-in zoom-in-95">
          Full playback unavailable
        </div>
      )}

      {/* Shared Context-Aware Track Action Menu — mounted only when active to eliminate hundreds of idle hooks across lists */}
      {showMenu && (
        <TrackActionMenu
          track={track}
          context={context}
          playlistId={playlistId}
          playlistContext={playlistContext}
          isOpen={showMenu}
          onClose={() => setShowMenu(false)}
          onSelectArtist={onSelectArtist}
          onSelectAlbum={onSelectAlbum}
        />
      )}
    </div>
  );
};

export const TrackRow = React.memo(TrackRowComponent);
