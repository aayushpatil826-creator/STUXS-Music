import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Play,
  Plus,
  ListPlus,
  Heart,
  FolderPlus,
  Trash2,
  Radio,
  Disc,
  Share2,
  DownloadCloud,
  CheckCircle2,
  Loader2,
  Sparkles,
  X,
} from 'lucide-react';
import type { Track } from '../../types/music';
import type { DownloadStatus } from '../../services/DownloadService';
import { usePlayerActions } from '../../context/PlayerContext';
import { useLibrary } from '../../context/LibraryContext';
import { useToast } from '../../context/ToastContext';
import { AddToPlaylistSheet } from '../modals/AddToPlaylistSheet';
import { backButtonManager } from '../../services/backButtonManager';

export type TrackMenuContext =
  | 'search'
  | 'home'
  | 'album'
  | 'artist'
  | 'library'
  | 'playlist'
  | 'queue'
  | 'now-playing';

export interface TrackActionMenuProps {
  track: Track;
  context?: TrackMenuContext;
  playlistId?: string;
  isOpen: boolean;
  onClose: () => void;
  playlistContext?: Track[];
  onSelectArtist?: (artistId: string) => void;
  onSelectAlbum?: (albumId?: string) => void;
}

export const TrackActionMenu: React.FC<TrackActionMenuProps> = ({
  track,
  context = 'search',
  playlistId,
  isOpen,
  onClose,
  playlistContext,
  onSelectArtist,
  onSelectAlbum,
}) => {
  const { playTrack, playNext, addToQueue, startSongRadio } = usePlayerActions();
  const {
    isFavorite,
    toggleFavorite,
    removeTrackFromPlaylist,
    downloadTrack,
    removeDownloadedTrack,
    isDownloaded,
    getActualDownloadStatus,
    getDownloadProgress,
    deleteLocalTrack,
  } = useLibrary();
  const { showToast } = useToast();
  const [isAddToPlaylistOpen, setIsAddToPlaylistOpen] = useState(false);
  const [active, setActive] = useState(false);
  const [dragY, setDragY] = useState(0);
  const touchStartY = useRef<number>(0);
  const isDragging = useRef<boolean>(false);
  const [actualDownloadStatus, setActualDownloadStatus] = useState<DownloadStatus>(() =>
    isDownloaded(track.id) ? 'downloaded' : 'not_downloaded'
  );
  const sheetRef = useRef<HTMLDivElement>(null);

  const handleAnimatedClose = React.useCallback((callbackOrEvent?: (() => void) | React.SyntheticEvent) => {
    setActive(false);
    const cb = typeof callbackOrEvent === 'function' ? callbackOrEvent : undefined;
    setTimeout(() => {
      onClose();
      setDragY(0);
      if (cb) cb();
    }, 240);
  }, [onClose]);

  // Dynamically resolve actual file download status every time menu opens
  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    getActualDownloadStatus(track.id).then((status) => {
      if (isMounted) {
        setActualDownloadStatus(status);
      }
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleAnimatedClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      isMounted = false;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, track.id, getActualDownloadStatus, handleAnimatedClose]);

  // Back button integration: smooth slide-down sheet dismissal on Android Back matching LyricsSheet
  useEffect(() => {
    if (isOpen) {
      setDragY(0);
      const timer = setTimeout(() => {
        setActive(true);
      }, 20);
      const unregister = backButtonManager.register(`track-action-menu-${track.id}`, handleAnimatedClose, 30);
      return () => {
        clearTimeout(timer);
        unregister();
      };
    } else {
      setActive(false);
    }
  }, [isOpen, track.id, handleAnimatedClose]);

  const downloadProgress = getDownloadProgress(track.id);

  // Sync with live progress updates
  useEffect(() => {
    if (downloadProgress.status) {
      setActualDownloadStatus(downloadProgress.status);
    }
  }, [downloadProgress.status]);

  if (!isOpen && !isAddToPlaylistOpen) return null;

  const favorite = isFavorite(track.id);
  const isPlayable = track.accessStatus !== 'blocked';
  const showRemoveFromPlaylist = context === 'playlist' && Boolean(playlistId);
  const isDownloadedLocal = actualDownloadStatus === 'downloaded';
  // A song is an on-device local file ONLY IF it was imported from the device's file picker
  // and has a local record, and is NOT a remote HTTP URL.
  const isDeviceAudioFile =
    !isDownloadedLocal &&
    (track.id.startsWith('local_') ||
      (track.sourceType === 'local' && !track.audioUrl?.startsWith('http') && Boolean(track.localPath)));
  const isLocalTrack = isDeviceAudioFile;

  const handlePlayNow = (e: React.MouseEvent) => {
    e.stopPropagation();
    handleAnimatedClose();
    if (isPlayable) {
      const source =
        context === 'playlist'
          ? 'library-playlist'
          : context === 'album'
          ? 'album'
          : context === 'artist'
          ? 'artist'
          : context === 'home'
          ? 'home'
          : 'individual';
      playTrack(track, playlistContext, { source, id: playlistId });
    }
  };

  const handlePlayNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    handleAnimatedClose();
    playNext(track);
    showToast(`"${track.title}" playing next`, 'info');
  };

  const handleAddToQueue = (e: React.MouseEvent) => {
    e.stopPropagation();
    handleAnimatedClose();
    addToQueue(track);
    showToast(`Added "${track.title}" to queue`, 'info');
  };

  const handleStartSongRadio = (e: React.MouseEvent) => {
    e.stopPropagation();
    handleAnimatedClose();
    startSongRadio(track);
    showToast(`Started Song Radio for "${track.title}"`, 'info');
  };

  const handleToggleFavorite = (e: React.MouseEvent) => {
    e.stopPropagation();
    handleAnimatedClose();
    toggleFavorite(track);
    if (!favorite) {
      showToast('Added to Liked Songs', 'success');
    } else {
      showToast('Removed from Liked Songs', 'info');
    }
  };

  const handleToggleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDeviceAudioFile) {
      handleAnimatedClose();
      showToast('Local music is already stored on this device', 'info');
      return;
    }

    if (actualDownloadStatus === 'removing' || actualDownloadStatus === 'downloading') {
      return;
    }

    if (isDownloadedLocal) {
      // 1. Optimistic transition: immediately mark as removing
      setActualDownloadStatus('removing');
      handleAnimatedClose();
      try {
        await removeDownloadedTrack(track.id);
        setActualDownloadStatus('not_downloaded');
        showToast('Removed from Offline Downloads', 'info');
      } catch (err: any) {
        setActualDownloadStatus('downloaded');
        showToast(err?.message || 'Failed to remove download', 'error');
      }
    } else {
      setActualDownloadStatus('downloading');
      handleAnimatedClose();
      try {
        showToast(`Downloading "${track.title}"...`, 'info');
        await downloadTrack(track);
        setActualDownloadStatus('downloaded');
        showToast(`Downloaded "${track.title}" for offline playback`, 'success');
      } catch (err: any) {
        setActualDownloadStatus('not_downloaded');
        showToast(err?.message || 'Download failed', 'error');
      }
    }
  };

  const handleDeleteLocal = async (e: React.MouseEvent) => {
    e.stopPropagation();
    handleAnimatedClose();
    if (isLocalTrack) {
      await deleteLocalTrack(track.id);
      showToast(`Removed "${track.title}" from local library`, 'info');
    }
  };

  const handleRemoveFromPlaylist = async (e: React.MouseEvent) => {
    e.stopPropagation();
    handleAnimatedClose();
    if (!playlistId) return;

    const res = await removeTrackFromPlaylist(playlistId, track.id);
    if (res?.success) {
      showToast(res.message, 'success');
    } else if (res?.message) {
      showToast(res.message, 'error');
    }
  };

  const handleOpenAddToPlaylist = (e: React.MouseEvent) => {
    e.stopPropagation();
    handleAnimatedClose(() => {
      setIsAddToPlaylistOpen(true);
    });
  };

  const handleShare = (e: React.MouseEvent) => {
    e.stopPropagation();
    handleAnimatedClose();
    if (navigator.share) {
      navigator.share({
        title: track.title,
        text: `Listen to ${track.title} by ${track.artistName} on STUXS Music`,
        url: window.location.href,
      }).catch(() => {});
    } else {
      navigator.clipboard?.writeText?.(`${track.title} - ${track.artistName}`);
      showToast('Track link copied to clipboard', 'info');
    }
  };

  // Drag down on sheet to dismiss
  const handleSheetTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
    isDragging.current = true;
  };

  const handleSheetTouchMove = (e: React.TouchEvent) => {
    if (!isDragging.current) return;
    const currentY = e.touches[0].clientY;
    const deltaY = currentY - touchStartY.current;
    if (deltaY > 0) {
      setDragY(deltaY);
    }
  };

  const handleSheetTouchEnd = () => {
    if (!isDragging.current) return;
    isDragging.current = false;
    if (dragY > 70) {
      handleAnimatedClose();
    } else {
      setDragY(0);
    }
  };

  return (
    <>
      {isOpen &&
        createPortal(
          <div className="fixed inset-0 z-[999] flex flex-col justify-end">
            {/* Backdrop Tap Area matching LyricsSheet */}
            <div
              className={`fixed inset-0 bg-black/50 transition-opacity duration-240 ${
                active ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleAnimatedClose();
              }}
            />

            {/* Native Android Bottom Action Sheet Container with Universal Sheet Motion */}
            <div
              ref={sheetRef}
              onTouchStart={handleSheetTouchStart}
              onTouchMove={handleSheetTouchMove}
              onTouchEnd={handleSheetTouchEnd}
              onClick={(e) => e.stopPropagation()}
              className={`relative z-10 w-full max-w-lg mx-auto bg-stuxs-surface border-t border-stuxs-border rounded-t-[32px] shadow-2xl overflow-hidden flex flex-col max-h-[82vh] will-change-transform select-none transition-transform ${
                isDragging.current ? 'duration-0' : active ? 'duration-300' : 'duration-240'
              }`}
              style={{
                transform: active
                  ? `translate3d(0, ${dragY}px, 0)`
                  : 'translate3d(0, 100%, 0)',
                transitionTimingFunction: active ? 'cubic-bezier(0.16, 1, 0.3, 1)' : 'cubic-bezier(0.3, 0, 0.8, 0.15)',
                paddingBottom: 'max(env(safe-area-inset-bottom, 16px), var(--safe-area-inset-bottom, 16px), 16px)',
              }}
            >
              {/* Top Drag Handle */}
              <div className="pt-3 pb-1 flex justify-center flex-shrink-0 cursor-grab active:cursor-grabbing">
                <div className="w-9 h-1 bg-stuxs-text-muted/30 hover:bg-stuxs-text-muted/50 rounded-full transition-colors" />
              </div>

              {/* Song Header Info Row */}
              <div className="flex items-center space-x-3.5 px-4 py-2.5 border-b border-stuxs-border/60 flex-shrink-0">
                <img
                  src={track.artworkUrl}
                  alt={track.title}
                  className="w-12 h-12 rounded-xl object-cover ring-1 ring-stuxs-border shadow-sm flex-shrink-0 bg-stuxs-surface-secondary"
                />
                <div className="min-w-0 flex-1 pr-2">
                  <h4 className="text-sm font-bold text-stuxs-text truncate">{track.title}</h4>
                  <p className="text-xs text-stuxs-text-secondary truncate mt-0.5">{track.artistName}</p>
                </div>
                <button
                  onClick={handleAnimatedClose}
                  className="p-1.5 rounded-full text-stuxs-text-secondary hover:text-stuxs-text hover:bg-stuxs-surface-hover btn-press transition-all cursor-pointer"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Action Item Rows */}
              <div className="overflow-y-auto p-2.5 space-y-0.5 scrollbar-thin">
                {/* Play Now */}
                {isPlayable && (
                  <button
                    onClick={handlePlayNow}
                    className="w-full flex items-center space-x-3 px-3.5 py-2.5 text-sm font-semibold text-stuxs-text hover:bg-stuxs-surface-hover active:bg-stuxs-surface-tertiary rounded-xl transition-all btn-press text-left cursor-pointer"
                  >
                    <div className="w-8 h-8 rounded-xl bg-stuxs-accent/15 flex items-center justify-center text-stuxs-accent shrink-0">
                      <Play className="w-4 h-4 fill-current" />
                    </div>
                    <span>Play Now</span>
                  </button>
                )}

                {/* Play Next */}
                {isPlayable && (
                  <button
                    onClick={handlePlayNext}
                    className="w-full flex items-center space-x-3 px-3.5 py-2.5 text-sm font-semibold text-stuxs-text hover:bg-stuxs-surface-hover active:bg-stuxs-surface-tertiary rounded-xl transition-all btn-press text-left cursor-pointer"
                  >
                    <div className="w-8 h-8 rounded-xl bg-stuxs-accent/15 flex items-center justify-center text-stuxs-accent shrink-0">
                      <Plus className="w-4 h-4" />
                    </div>
                    <span>Play Next</span>
                  </button>
                )}

                {/* Add to Queue */}
                {isPlayable && (
                  <button
                    onClick={handleAddToQueue}
                    className="w-full flex items-center space-x-3 px-3.5 py-2.5 text-sm font-semibold text-stuxs-text hover:bg-stuxs-surface-hover active:bg-stuxs-surface-tertiary rounded-xl transition-all btn-press text-left cursor-pointer"
                  >
                    <div className="w-8 h-8 rounded-xl bg-stuxs-surface-secondary border border-stuxs-border flex items-center justify-center text-stuxs-text-secondary shrink-0">
                      <ListPlus className="w-4 h-4" />
                    </div>
                    <span>Add to Queue</span>
                  </button>
                )}

                {/* Add to Playlist */}
                <button
                  onClick={handleOpenAddToPlaylist}
                  className="w-full flex items-center space-x-3 px-3.5 py-2.5 text-sm font-semibold text-stuxs-text hover:bg-stuxs-surface-hover active:bg-stuxs-surface-tertiary rounded-xl transition-all btn-press text-left cursor-pointer"
                >
                  <div className="w-8 h-8 rounded-xl bg-stuxs-accent/15 flex items-center justify-center text-stuxs-accent shrink-0">
                    <FolderPlus className="w-4 h-4" />
                  </div>
                  <span>Add to Playlist</span>
                </button>

                {/* Download / Offline Toggle */}
                {!isLocalTrack && (
                  <button
                    onClick={handleToggleDownload}
                    disabled={actualDownloadStatus === 'downloading' || actualDownloadStatus === 'removing'}
                    className="w-full flex items-center justify-between px-3.5 py-2.5 text-sm font-semibold text-stuxs-text hover:bg-stuxs-surface-hover active:bg-stuxs-surface-tertiary rounded-xl transition-all btn-press disabled:opacity-60 text-left cursor-pointer"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 rounded-xl bg-stuxs-accent/15 flex items-center justify-center text-stuxs-accent shrink-0">
                        {actualDownloadStatus === 'downloading' || actualDownloadStatus === 'removing' ? (
                          <Loader2 className="w-4 h-4 text-stuxs-accent animate-spin" />
                        ) : isDownloadedLocal ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                        ) : (
                          <DownloadCloud className="w-4 h-4 text-stuxs-accent" />
                        )}
                      </div>
                      <span>
                        {actualDownloadStatus === 'removing'
                          ? 'Removing...'
                          : actualDownloadStatus === 'downloading'
                          ? `Downloading ${downloadProgress.percent || 0}%`
                          : isDownloadedLocal
                          ? 'Remove from Downloads'
                          : 'Download for Offline'}
                      </span>
                    </div>
                    {isDownloadedLocal && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-300">
                        Saved
                      </span>
                    )}
                  </button>
                )}

                {/* Favorite / Liked */}
                <button
                  onClick={handleToggleFavorite}
                  className="w-full flex items-center space-x-3 px-3.5 py-2.5 text-sm font-semibold text-stuxs-text hover:bg-stuxs-surface-hover active:bg-stuxs-surface-tertiary rounded-xl transition-all btn-press text-left cursor-pointer"
                >
                  <div className="w-8 h-8 rounded-xl bg-rose-500/15 flex items-center justify-center text-rose-500 shrink-0">
                    <Heart
                      className={`w-4 h-4 ${
                        favorite ? 'text-rose-500 fill-rose-500' : 'text-rose-500'
                      }`}
                    />
                  </div>
                  <span>{favorite ? 'Remove from Liked Songs' : 'Add to Liked Songs'}</span>
                </button>

                {/* Start Song Radio */}
                {!isLocalTrack && (
                  <button
                    onClick={handleStartSongRadio}
                    className="w-full flex items-center space-x-3 px-3.5 py-2.5 text-sm font-semibold text-stuxs-text hover:bg-stuxs-surface-hover active:bg-stuxs-surface-tertiary rounded-xl transition-all btn-press text-left cursor-pointer"
                  >
                    <div className="w-8 h-8 rounded-xl bg-purple-500/15 flex items-center justify-center text-purple-500 shrink-0">
                      <Radio className="w-4 h-4 text-purple-400" />
                    </div>
                    <span>Start Song Radio</span>
                  </button>
                )}

                {/* View Artist */}
                {onSelectArtist && !isLocalTrack && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onClose();
                      onSelectArtist(track.artistId);
                    }}
                    className="w-full flex items-center space-x-3 px-3.5 py-2.5 text-sm font-semibold text-stuxs-text hover:bg-stuxs-surface-hover active:bg-stuxs-surface-tertiary rounded-xl transition-all btn-press text-left cursor-pointer"
                  >
                    <div className="w-8 h-8 rounded-xl bg-stuxs-surface-secondary border border-stuxs-border flex items-center justify-center text-stuxs-text-secondary shrink-0">
                      <Sparkles className="w-4 h-4" />
                    </div>
                    <span>View Artist</span>
                  </button>
                )}

                {/* View Album */}
                {onSelectAlbum && track.albumId && !isLocalTrack && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onClose();
                      onSelectAlbum(track.albumId);
                    }}
                    className="w-full flex items-center space-x-3 px-3.5 py-2.5 text-sm font-semibold text-stuxs-text hover:bg-stuxs-surface-hover active:bg-stuxs-surface-tertiary rounded-xl transition-all btn-press text-left cursor-pointer"
                  >
                    <div className="w-8 h-8 rounded-xl bg-stuxs-surface-secondary border border-stuxs-border flex items-center justify-center text-stuxs-text-secondary shrink-0">
                      <Disc className="w-4 h-4" />
                    </div>
                    <span>View Album</span>
                  </button>
                )}

                {/* Remove from Playlist (Context-Aware: Only when inside a playlist) */}
                {showRemoveFromPlaylist && (
                  <button
                    onClick={handleRemoveFromPlaylist}
                    className="w-full flex items-center space-x-3 px-3.5 py-2.5 text-sm font-semibold text-rose-500 hover:bg-rose-500/10 active:bg-rose-500/20 rounded-xl transition-all btn-press text-left cursor-pointer"
                  >
                    <div className="w-8 h-8 rounded-xl bg-rose-500/15 flex items-center justify-center text-rose-500 shrink-0">
                      <Trash2 className="w-4 h-4" />
                    </div>
                    <span>Remove from Playlist</span>
                  </button>
                )}

                {/* Delete Local File (Context-Aware for Local tracks) */}
                {isLocalTrack && (
                  <button
                    onClick={handleDeleteLocal}
                    className="w-full flex items-center space-x-3 px-3.5 py-2.5 text-sm font-semibold text-rose-500 hover:bg-rose-500/10 active:bg-rose-500/20 rounded-xl transition-all btn-press text-left cursor-pointer"
                  >
                    <div className="w-8 h-8 rounded-xl bg-rose-500/15 flex items-center justify-center text-rose-500 shrink-0">
                      <Trash2 className="w-4 h-4" />
                    </div>
                    <span>Delete Local Track</span>
                  </button>
                )}

                {/* Share */}
                <button
                  onClick={handleShare}
                  className="w-full flex items-center space-x-3 px-3.5 py-2.5 text-sm font-semibold text-stuxs-text hover:bg-stuxs-surface-hover active:bg-stuxs-surface-tertiary rounded-xl transition-all btn-press text-left cursor-pointer"
                >
                  <div className="w-8 h-8 rounded-xl bg-stuxs-surface-secondary border border-stuxs-border flex items-center justify-center text-stuxs-text-secondary shrink-0">
                    <Share2 className="w-4 h-4" />
                  </div>
                  <span>Share</span>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Embedded Add to Playlist Bottom Sheet */}
      <AddToPlaylistSheet
        track={track}
        isOpen={isAddToPlaylistOpen}
        onClose={() => setIsAddToPlaylistOpen(false)}
      />
    </>
  );
};
