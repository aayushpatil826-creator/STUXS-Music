import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Play,
  ListPlus,
  Download,
  Edit3,
  Trash2,
  CheckCircle2,
  Loader2,
  X,
  Plus,
} from 'lucide-react';
import type { Playlist, Track } from '../../types/music';
import { usePlayerActions } from '../../context/PlayerContext';
import { useLibrary } from '../../context/LibraryContext';
import { useToast } from '../../context/ToastContext';
import { PlaylistCover } from './PlaylistCover';
import { backButtonManager } from '../../services/backButtonManager';

export interface PlaylistActionMenuProps {
  playlist: Playlist;
  isOpen: boolean;
  onClose: () => void;
  onSelectPlaylist?: (playlistId: string) => void;
  onEditPlaylist?: (playlistId: string) => void;
}

export const PlaylistActionMenu: React.FC<PlaylistActionMenuProps> = ({
  playlist,
  isOpen,
  onClose,
  onSelectPlaylist,
  onEditPlaylist,
}) => {
  const { playTrack, playNext, addToQueue } = usePlayerActions();
  const {
    deletePlaylist,
    downloadPlaylist,
    cancelPlaylistDownload,
    isPlaylistDownloading,
    isDownloaded,
  } = useLibrary();
  const { showToast } = useToast();

  const [isClosing, setIsClosing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<{ completed: number; total: number; failed: number } | null>(null);

  const sheetRef = React.useRef<HTMLDivElement>(null);
  const touchStartY = React.useRef<number>(0);
  const touchDeltaY = React.useRef<number>(0);

  const handleAnimatedClose = React.useCallback((callbackOrEvent?: (() => void) | React.SyntheticEvent) => {
    if (isClosing) return;
    setIsClosing(true);
    const cb = typeof callbackOrEvent === 'function' ? callbackOrEvent : undefined;
    setTimeout(() => {
      setIsClosing(false);
      onClose();
      if (cb) cb();
    }, 180);
  }, [isClosing, onClose]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleAnimatedClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleAnimatedClose]);

  // Back button integration: smooth slide-down sheet dismissal on Android Back
  useEffect(() => {
    if (!isOpen) return;
    return backButtonManager.register(`playlist-action-menu-${playlist.id}`, handleAnimatedClose, 30);
  }, [isOpen, playlist.id, handleAnimatedClose]);

  if (!isOpen) return null;

  const songs: Track[] = playlist.songs || [];
  const totalSongs = songs.length;
  const downloadedCount = songs.filter((s) => isDownloaded(s.id)).length;
  const isAllDownloaded = totalSongs > 0 && downloadedCount === totalSongs;
  const isDownloading = isPlaylistDownloading(playlist.id) || (downloadProgress !== null && downloadProgress.completed < downloadProgress.total);

  const handlePlayAll = () => {
    handleAnimatedClose();
    if (songs.length > 0) {
      playTrack(songs[0], songs, {
        source: 'library-playlist',
        id: playlist.id,
        name: playlist.name,
      });
      showToast(`Playing "${playlist.name}"`, 'info');
    } else {
      showToast('Playlist is empty', 'warning');
    }
  };

  const handlePlayNext = () => {
    handleAnimatedClose();
    if (songs.length > 0) {
      // Add in reverse to preserve order when playing next
      for (let i = songs.length - 1; i >= 0; i--) {
        playNext(songs[i]);
      }
      showToast(`Added ${songs.length} songs to play next`, 'info');
    } else {
      showToast('Playlist is empty', 'warning');
    }
  };

  const handleAddToQueue = () => {
    handleAnimatedClose();
    if (songs.length > 0) {
      songs.forEach((s) => addToQueue(s));
      showToast(`Added ${songs.length} songs to queue`, 'info');
    } else {
      showToast('Playlist is empty', 'warning');
    }
  };

  const handleDownloadPlaylist = async () => {
    if (songs.length === 0) {
      showToast('No songs to download', 'warning');
      return;
    }
    if (isDownloading) return;

    const needed = songs.filter((s) => !isDownloaded(s.id));
    if (needed.length === 0) {
      showToast('All songs are already downloaded', 'info');
      return;
    }

    showToast(`Downloading ${needed.length} songs from "${playlist.name}"...`, 'info');
    setDownloadProgress({
      completed: totalSongs - needed.length,
      total: totalSongs,
      failed: 0,
    });

    try {
      const res = await downloadPlaylist(songs, playlist.id, (completed, total, failed) => {
        setDownloadProgress({ completed, total, failed });
      });

      if (res.failed === 0) {
        showToast(`Downloaded all ${res.downloaded} songs!`, 'success');
      } else if (res.downloaded > 0) {
        showToast(`Downloaded ${res.downloaded} songs (${res.failed} unavailable)`, 'info');
      } else {
        showToast('Failed to download songs. Check connection.', 'error');
      }
    } catch (err) {
      console.error('[PlaylistActionMenu] Download error:', err);
      showToast('Download error occurred.', 'error');
    } finally {
      setDownloadProgress(null);
    }
  };

  const handleCancelDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    cancelPlaylistDownload(playlist.id);
    setDownloadProgress(null);
    showToast('Cancelled playlist download', 'info');
  };

  const handleEditPlaylist = () => {
    handleAnimatedClose(() => {
      if (onEditPlaylist) {
        onEditPlaylist(playlist.id);
      } else if (onSelectPlaylist) {
        onSelectPlaylist(playlist.id);
      }
    });
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await deletePlaylist(playlist.id);
      showToast(`Deleted playlist "${playlist.name}"`, 'info');
      setShowDeleteConfirm(false);
      handleAnimatedClose();
    } catch (err) {
      showToast('Failed to delete playlist.', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  // Drag down on sheet to dismiss
  const handleSheetTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
    touchDeltaY.current = 0;
    if (sheetRef.current) {
      sheetRef.current.style.transition = 'none';
    }
  };

  const handleSheetTouchMove = (e: React.TouchEvent) => {
    const delta = e.touches[0].clientY - touchStartY.current;
    if (delta > 0) {
      touchDeltaY.current = delta;
      if (sheetRef.current) {
        sheetRef.current.style.transform = `translate3d(0, ${delta}px, 0)`;
      }
    }
  };

  const handleSheetTouchEnd = () => {
    if (touchDeltaY.current > 70) {
      handleAnimatedClose();
    } else {
      if (sheetRef.current) {
        sheetRef.current.style.transition = 'transform 240ms cubic-bezier(0.32, 0.72, 0, 1)';
        sheetRef.current.style.transform = 'translate3d(0, 0, 0)';
      }
    }
    touchDeltaY.current = 0;
  };

  return createPortal(
    <div className="fixed inset-0 z-[999] flex flex-col justify-end">
      {/* Background Backdrop Blur & Dim */}
      <div
        onClick={handleAnimatedClose}
        className={`fixed inset-0 bg-black/65 backdrop-blur-md transition-opacity duration-220 ease-out ${
          isClosing ? 'opacity-0' : 'animate-in fade-in duration-200'
        }`}
      />

      {/* Native Mobile Bottom Sheet */}
      <div
        ref={sheetRef}
        onTouchStart={handleSheetTouchStart}
        onTouchMove={handleSheetTouchMove}
        onTouchEnd={handleSheetTouchEnd}
        onClick={(e) => e.stopPropagation()}
        className={`relative z-10 w-full max-w-lg mx-auto bg-stuxs-surface border-t border-stuxs-border rounded-t-[28px] shadow-[0_-12px_40px_rgba(0,0,0,0.5)] overflow-hidden will-change-transform select-none text-left flex flex-col ${
          isClosing
            ? 'animate-menu-dismiss'
            : 'animate-menu-emerge'
        }`}
        style={{
          paddingBottom: 'max(env(safe-area-inset-bottom, 16px), var(--safe-area-inset-bottom, 16px), 16px)',
        }}
      >
        {/* Top Drag Handle */}
        <div className="pt-3 pb-1 flex justify-center cursor-grab active:cursor-grabbing">
          <div className="w-9 h-1 bg-stuxs-text-muted/30 hover:bg-stuxs-text-muted/50 rounded-full transition-colors" />
        </div>

        {/* Playlist Header Tile */}
        <div className="flex items-center space-x-3.5 px-4 py-2.5 border-b border-stuxs-border/60">
          <div className="w-12 h-12 rounded-xl overflow-hidden shadow-sm flex-shrink-0 bg-stuxs-surface-secondary ring-1 ring-stuxs-border">
            <PlaylistCover playlist={playlist} />
          </div>
          <div className="min-w-0 flex-1 pr-2">
            <h3 className="text-sm font-bold text-stuxs-text tracking-tight truncate">
              {playlist.name}
            </h3>
            <p className="text-[11px] text-stuxs-text-secondary truncate mt-0.5">
              {totalSongs} {totalSongs === 1 ? 'song' : 'songs'} {playlist.description ? `• ${playlist.description}` : ''}
            </p>
          </div>
          <button
            onClick={handleAnimatedClose}
            className="p-1.5 rounded-full text-stuxs-text-secondary hover:text-stuxs-text hover:bg-stuxs-surface-hover btn-press transition-all cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 6 Actions List (Zero Scrolling Required) */}
        <div className="p-3 space-y-0.5">
          {/* 1. Play All */}
          <button
            onClick={handlePlayAll}
            className="w-full flex items-center space-x-3.5 px-3.5 py-2.5 text-sm font-semibold text-stuxs-text hover:bg-stuxs-surface-hover active:bg-stuxs-surface-tertiary rounded-xl transition-all btn-press text-left cursor-pointer"
          >
            <div className="w-8 h-8 rounded-xl bg-stuxs-accent/15 flex items-center justify-center text-stuxs-accent shrink-0">
              <Play className="w-4 h-4 fill-current" />
            </div>
            <span>Play All</span>
          </button>

          {/* 2. Play Next */}
          <button
            onClick={handlePlayNext}
            className="w-full flex items-center space-x-3.5 px-3.5 py-2.5 text-sm font-semibold text-stuxs-text hover:bg-stuxs-surface-hover active:bg-stuxs-surface-tertiary rounded-xl transition-all btn-press text-left cursor-pointer"
          >
            <div className="w-8 h-8 rounded-xl bg-stuxs-accent/15 flex items-center justify-center text-stuxs-accent shrink-0">
              <Plus className="w-4 h-4" />
            </div>
            <span>Play Next</span>
          </button>

          {/* 3. Add to Queue */}
          <button
            onClick={handleAddToQueue}
            className="w-full flex items-center space-x-3.5 px-3.5 py-2.5 text-sm font-semibold text-stuxs-text hover:bg-stuxs-surface-hover active:bg-stuxs-surface-tertiary rounded-xl transition-all btn-press text-left cursor-pointer"
          >
            <div className="w-8 h-8 rounded-xl bg-stuxs-accent/15 flex items-center justify-center text-stuxs-accent shrink-0">
              <ListPlus className="w-4 h-4" />
            </div>
            <span>Add to Queue</span>
          </button>

          {/* 4. Download Playlist */}
          {isAllDownloaded ? (
            <div className="w-full flex items-center justify-between px-3.5 py-2.5 text-sm font-semibold text-emerald-500 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
              <div className="flex items-center space-x-3.5">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/20 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                </div>
                <span>All {totalSongs} Songs Downloaded</span>
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-300">
                Offline Ready
              </span>
            </div>
          ) : isDownloading ? (
            <div className="w-full p-3 rounded-xl bg-stuxs-surface-secondary border border-stuxs-accent/30 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2.5">
                  <Loader2 className="w-4 h-4 text-stuxs-accent animate-spin" />
                  <span className="text-xs font-bold text-stuxs-text">
                    Downloading ({downloadProgress?.completed ?? downloadedCount}/{totalSongs})
                  </span>
                </div>
                <button
                  onClick={handleCancelDownload}
                  className="p-1 rounded-full text-rose-500 hover:bg-rose-500/10 active:scale-95 cursor-pointer"
                  title="Cancel download"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="w-full h-1.5 rounded-full bg-stuxs-border overflow-hidden">
                <div
                  className="h-full bg-stuxs-accent transition-all duration-300 rounded-full"
                  style={{
                    width: `${Math.round(((downloadProgress?.completed ?? downloadedCount) / (totalSongs || 1)) * 100)}%`,
                  }}
                />
              </div>
            </div>
          ) : (
            <button
              onClick={handleDownloadPlaylist}
              className="w-full flex items-center justify-between px-3.5 py-2.5 text-sm font-semibold text-stuxs-text hover:bg-stuxs-surface-hover active:bg-stuxs-surface-tertiary rounded-xl transition-all btn-press text-left cursor-pointer"
            >
              <div className="flex items-center space-x-3.5">
                <div className="w-8 h-8 rounded-xl bg-stuxs-accent/15 flex items-center justify-center text-stuxs-accent shrink-0">
                  <Download className="w-4 h-4" />
                </div>
                <span>
                  {downloadedCount > 0
                    ? `Download Remaining (${totalSongs - downloadedCount})`
                    : 'Download Playlist'}
                </span>
              </div>
              {downloadedCount > 0 && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-stuxs-surface-secondary text-stuxs-text-secondary border border-stuxs-border">
                  {downloadedCount}/{totalSongs} Saved
                </span>
              )}
            </button>
          )}

          {/* 5. Edit Playlist */}
          <button
            onClick={handleEditPlaylist}
            className="w-full flex items-center space-x-3.5 px-3.5 py-2.5 text-sm font-semibold text-stuxs-text hover:bg-stuxs-surface-hover active:bg-stuxs-surface-tertiary rounded-xl transition-all btn-press text-left cursor-pointer"
          >
            <div className="w-8 h-8 rounded-xl bg-stuxs-surface-secondary flex items-center justify-center text-stuxs-text-secondary border border-stuxs-border shrink-0">
              <Edit3 className="w-4 h-4" />
            </div>
            <span>Edit Playlist</span>
          </button>

          {/* 6. Delete Playlist */}
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="w-full flex items-center space-x-3.5 px-3.5 py-2.5 text-sm font-semibold text-rose-500 hover:bg-rose-500/10 active:bg-rose-500/20 rounded-xl transition-all btn-press text-left cursor-pointer"
          >
            <div className="w-8 h-8 rounded-xl bg-rose-500/15 flex items-center justify-center text-rose-500 shrink-0">
              <Trash2 className="w-4 h-4" />
            </div>
            <span>Delete Playlist</span>
          </button>
        </div>

        {/* Delete Confirmation Sub-Dialog */}
        {showDeleteConfirm && (
          <div className="p-4 border-t border-rose-500/20 bg-rose-500/5 space-y-2.5 animate-in fade-in duration-150">
            <h4 className="text-sm font-bold text-stuxs-text">Delete "{playlist.name}"?</h4>
            <p className="text-xs text-stuxs-text-secondary">
              This will permanently delete this playlist from your library.
            </p>
            <div className="flex items-center space-x-2 pt-1">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 py-2.5 rounded-xl bg-stuxs-surface-secondary hover:bg-stuxs-surface-hover text-xs font-bold text-stuxs-text border border-stuxs-border btn-press cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-xs font-bold text-white btn-press disabled:opacity-60 flex items-center justify-center space-x-1.5 cursor-pointer shadow-md shadow-rose-600/30"
              >
                {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <span>Delete</span>}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};
