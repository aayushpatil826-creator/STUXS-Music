import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ChevronLeft,
  Play,
  Shuffle,
  Clock,
  Trash2,
  ArrowUp,
  ArrowDown,
  MoreVertical,
  Bookmark,
  BookmarkCheck,
  AlertTriangle,
  Loader2,
  Download,
  Check,
  ListMusic,
} from 'lucide-react';
import type { Playlist, Track } from '../types/music';
import { useLibrary } from '../context/LibraryContext';
import { usePlayerActions } from '../context/PlayerContext';
import { useToast } from '../context/ToastContext';
import { TrackRow } from '../components/common/TrackRow';
import { EmptyState } from '../components/common/EmptyState';
import { PlaylistCover } from '../components/common/PlaylistCover';
import { PlaylistActionMenu } from '../components/common/PlaylistActionMenu';
import { homeDiscoveryService } from '../services/HomeDiscoveryService';
import { curatedPlaylistService } from '../services/CuratedPlaylistService';
import { providerRegistry } from '../providers/ProviderRegistry';

interface PlaylistScreenProps {
  playlistId: string;
  onBack: () => void;
  onSelectArtist: (artistId: string) => void;
}

const PlaylistScreenComponent: React.FC<PlaylistScreenProps> = ({
  playlistId,
  onBack,
  onSelectArtist,
}) => {
  const {
    playlists,
    savedPlaylists,
    reorderPlaylist,
    renamePlaylist,
    removeTrackFromPlaylist,
    deletePlaylist,
    isPlaylistSaved,
    toggleSavePlaylist,
    downloadPlaylist,
    cancelPlaylistDownload,
    isPlaylistDownloading,
    isDownloaded,
  } = useLibrary();
  const { playTrack, smartQueueEnabled, toggleSmartQueue } = usePlayerActions();
  const { showToast } = useToast();
  const [playlist, setPlaylist] = useState<Playlist | null>(() => {
    // Synchronous lookup so frame-0 never shows "Playlist Not Found" for known playlists
    return (
      playlists.find((p) => p.id === playlistId) ??
      savedPlaylists.find((p) => p.id === playlistId) ??
      homeDiscoveryService.getPlaylistById(playlistId) ??
      curatedPlaylistService.getCachedPlaylist(playlistId) ??
      null
    );
  });
  const [isReorderMode, setIsReorderMode] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
  const [renameInput, setRenameInput] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const [trackToRemove, setTrackToRemove] = useState<Track | null>(null);
  const [isRemovingSong, setIsRemovingSong] = useState(false);
  const [playlistDownloadProgress, setPlaylistDownloadProgress] = useState<{
    completed: number;
    total: number;
    failed: number;
  } | null>(null);

  // Close modal on Escape key press
  useEffect(() => {
    if (!isDeleteModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isDeleting) {
        setIsDeleteModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDeleteModalOpen, isDeleting]);

  useEffect(() => {
    let isCancelled = false;
    const loadPlaylist = async () => {
      // 1. Check user library playlists
      const userFound = playlists.find((p) => p.id === playlistId);
      if (userFound) {
        setPlaylist(userFound);
        return;
      }

      // 2. Check saved provider playlists
      const savedFound = savedPlaylists.find((p) => p.id === playlistId);
      if (savedFound) {
        setPlaylist(savedFound);
        return;
      }

      // 3. Check HomeDiscoveryService featured playlists
      const featured = homeDiscoveryService.getPlaylistById(playlistId);
      if (featured) {
        setPlaylist(featured);
        return;
      }

      // 3b. Check CuratedPlaylistService
      try {
        const curated = await curatedPlaylistService.getCuratedPlaylistById(playlistId);
        if (!isCancelled && curated) {
          setPlaylist(curated);
          return;
        }
      } catch {}

      // 4. Check ProviderRegistry (live JioSaavn playlist)
      try {
        const live = await providerRegistry.getPlaylist(playlistId);
        if (!isCancelled && live) {
          setPlaylist(live);
        }
      } catch (err) {
        console.warn('[PlaylistScreen] Error loading playlist from provider:', err);
      }
    };

    loadPlaylist();
    return () => {
      isCancelled = true;
    };
  }, [playlistId, playlists, savedPlaylists]);

  if (!playlist) {
    return (
      <div className="p-5 pt-12">
        <button onClick={onBack} className="p-2 rounded-full bg-stuxs-surface mb-4">
          <ChevronLeft className="w-5 h-5 text-stuxs-text" />
        </button>
        <EmptyState title="Playlist Not Found" description="The requested playlist does not exist." />
      </div>
    );
  }

  const songs = playlist.songs || [];
  const isUserLibraryPlaylist = playlists.some((p) => p.id === playlist.id);
  const isSaved = isPlaylistSaved(playlist.id);

  const handlePlayAll = useCallback(() => {
    if (songs.length > 0 && playlist) {
      playTrack(songs[0], songs, {
        source: isUserLibraryPlaylist ? 'library-playlist' : 'home',
        id: playlist.id,
        name: playlist.name,
      });
    }
  }, [songs, playTrack, isUserLibraryPlaylist, playlist]);

  const handleShufflePlay = useCallback(() => {
    if (songs.length > 0 && playlist) {
      playTrack(songs[0], songs, {
        source: isUserLibraryPlaylist ? 'library-playlist' : 'home',
        id: playlist.id,
        name: playlist.name,
        shuffle: true,
      });
    }
  }, [songs, playTrack, isUserLibraryPlaylist, playlist]);

  const handleConfirmDelete = async () => {
    setIsDeleting(true);
    try {
      await deletePlaylist(playlist.id);
      showToast(`Deleted playlist "${playlist.name}"`, 'info');
      setIsDeleteModalOpen(false);
      onBack();
    } catch (err) {
      console.error('[PlaylistScreen] Error deleting playlist:', err);
      showToast('Failed to delete playlist. Please try again.', 'error');
      setIsDeleting(false);
    }
  };

  const handleConfirmRename = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!playlist) return;
    const trimmed = renameInput.trim();
    if (!trimmed || trimmed === playlist.name || isRenaming) {
      setIsRenameModalOpen(false);
      return;
    }
    setIsRenaming(true);
    try {
      await renamePlaylist(playlist.id, trimmed);
      setPlaylist((prev) => (prev ? { ...prev, name: trimmed } : null));
      showToast(`Renamed playlist to "${trimmed}"`, 'success');
      setIsRenameModalOpen(false);
    } catch (err) {
      console.error('[PlaylistScreen] Error renaming playlist:', err);
      showToast('Failed to rename playlist. Please try again.', 'error');
    } finally {
      setIsRenaming(false);
    }
  };

  const handleConfirmRemoveSong = async () => {
    if (!trackToRemove || isRemovingSong) return;
    setIsRemovingSong(true);
    try {
      const res = await removeTrackFromPlaylist(playlist.id, trackToRemove.id);
      if (res.success) {
        showToast(`Removed "${trackToRemove.title}" from playlist`, 'info');
        setTrackToRemove(null);
      } else {
        showToast(res.message || 'Failed to remove song. Please try again.', 'error');
      }
    } catch (err) {
      console.error('[PlaylistScreen] Error removing song from playlist:', err);
      showToast('Failed to remove song. Please try again.', 'error');
    } finally {
      setIsRemovingSong(false);
    }
  };

  const totalSongs = songs.length;
  const downloadedCount = useMemo(() => songs.filter((s) => isDownloaded(s.id)).length, [songs, isDownloaded]);
  const isAllDownloaded = totalSongs > 0 && downloadedCount === totalSongs;
  const isDownloading =
    isPlaylistDownloading(playlist.id) ||
    (playlistDownloadProgress !== null &&
      playlistDownloadProgress.completed < playlistDownloadProgress.total);

  const handleDownloadAll = useCallback(async () => {
    if (songs.length === 0 || isDownloading || !playlist) return;
    const needed = songs.filter((s) => !isDownloaded(s.id));
    if (needed.length === 0) {
      showToast('All songs in this playlist are already downloaded', 'info');
      return;
    }
    showToast(`Downloading ${needed.length} ${needed.length === 1 ? 'song' : 'songs'}...`, 'info');
    setPlaylistDownloadProgress({
      completed: totalSongs - needed.length,
      total: totalSongs,
      failed: 0,
    });

    try {
      const res = await downloadPlaylist(songs, playlist.id, (completed, total, failed) => {
        setPlaylistDownloadProgress({ completed, total, failed });
      });

      if (res.failed === 0) {
        showToast(`Successfully downloaded all ${res.downloaded} songs!`, 'success');
      } else if (res.downloaded > 0) {
        showToast(`Downloaded ${res.downloaded} songs (${res.failed} failed)`, 'info');
      } else {
        showToast('Failed to download songs. Please check your connection.', 'error');
      }
    } catch (err) {
      console.error('[PlaylistScreen] Error downloading playlist:', err);
      showToast('Failed to download playlist.', 'error');
    } finally {
      setPlaylistDownloadProgress(null);
    }
  }, [songs, isDownloading, playlist, isDownloaded, totalSongs, downloadPlaylist, showToast]);

  const handleCancelDownload = useCallback(() => {
    if (playlist) cancelPlaylistDownload(playlist.id);
    setPlaylistDownloadProgress(null);
    showToast('Cancelled playlist download', 'info');
  }, [cancelPlaylistDownload, playlist, showToast]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#7C3AED]/12 via-[#6366F1]/06 to-transparent dark:from-[#1E1138]/60 dark:via-[#140C24]/40 dark:to-transparent">
      {/* Top Floating Navigation */}
      <div className="sticky top-0 z-30 px-5 safe-top-header pb-3 bg-stuxs-bg/98 border-b border-stuxs-border/40 flex items-center justify-between">
        <button
          onClick={onBack}
          className="w-9 h-9 rounded-full bg-white/80 dark:bg-white/10 hover:bg-white dark:hover:bg-white/15 border border-black/5 dark:border-white/10 text-stuxs-text flex items-center justify-center active:scale-95 transition-all shadow-xs cursor-pointer"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        <span className="text-xs font-bold uppercase tracking-wider text-stuxs-text-muted">
          Playlist
        </span>

        <div className="flex items-center space-x-1.5">
          {isUserLibraryPlaylist ? (
            /* User-created Playlist Controls */
            <>
              <button
                onClick={() => setIsReorderMode(!isReorderMode)}
                className={`text-xs font-semibold px-3 py-1 rounded-full transition-colors cursor-pointer ${
                  isReorderMode ? 'bg-purple-600 text-white shadow-sm' : 'text-stuxs-text-secondary hover:text-stuxs-text'
                }`}
              >
                {isReorderMode ? 'Done' : 'Edit'}
              </button>

              <button
                onClick={() => setIsMenuOpen(true)}
                className="w-9 h-9 rounded-full text-stuxs-text-secondary hover:text-stuxs-text bg-white/80 dark:bg-white/10 border border-black/5 dark:border-white/10 active:scale-95 transition-all cursor-pointer flex items-center justify-center shadow-xs"
                aria-label="Playlist options"
              >
                <MoreVertical className="w-4 h-4" />
              </button>
            </>
          ) : (
            /* Provider / Discovered Playlist Controls */
            <button
              onClick={() => toggleSavePlaylist(playlist)}
              className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all active:scale-95 cursor-pointer shadow-xs ${
                isSaved
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'bg-white/80 dark:bg-white/10 text-stuxs-text hover:bg-white dark:hover:bg-white/15 border border-black/5 dark:border-white/10'
              }`}
            >
              {isSaved ? (
                <>
                  <BookmarkCheck className="w-3.5 h-3.5" />
                  <span>Saved</span>
                </>
              ) : (
                <>
                  <Bookmark className="w-3.5 h-3.5" />
                  <span>Save</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Playlist Hero Section */}
      <div className="p-5 pb-6">
        <div className="flex flex-col items-center text-center">
          {/* Automatic Playlist Cover */}
          <div className="w-48 h-48 sm:w-56 sm:h-56 rounded-[28px] overflow-hidden shadow-2xl mb-5 ring-1 ring-black/5 dark:ring-white/10">
            <PlaylistCover
              playlist={playlist}
              size="lg"
              className="w-full h-full"
            />
          </div>

          <h2 className="text-2xl sm:text-3xl font-black text-stuxs-text tracking-tight max-w-sm">
            {playlist.name}
          </h2>

          {playlist.description && (
            <p className="text-xs text-stuxs-text-secondary mt-1.5 max-w-xs line-clamp-2">
              {playlist.description}
            </p>
          )}

          <div className="flex items-center space-x-2 text-xs text-stuxs-text-muted mt-2 font-medium">
            <span>{songs.length} {songs.length === 1 ? 'song' : 'songs'}</span>
            <span>•</span>
            <span className="text-purple-600 dark:text-purple-400 font-semibold">{isUserLibraryPlaylist ? 'Custom Playlist' : 'Curated Playlist'}</span>
          </div>

          {/* Actions: Play All & Shuffle & Download Playlist */}
          {songs.length > 0 && (
            <div className="flex flex-col items-center space-y-3 mt-5 w-full max-w-xs">
              <div className="flex items-center space-x-3 w-full">
                <button
                  onClick={handlePlayAll}
                  className="flex-1 flex items-center justify-center space-x-2 py-3 rounded-full bg-purple-600 hover:bg-purple-500 active:scale-95 text-white font-bold text-xs shadow-md transition-all cursor-pointer"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>Play All</span>
                </button>

                <button
                  onClick={handleShufflePlay}
                  className="w-11 h-11 rounded-full bg-white/80 dark:bg-white/10 hover:bg-white dark:hover:bg-white/15 border border-black/5 dark:border-white/10 text-stuxs-text active:scale-95 transition-all flex items-center justify-center shadow-xs cursor-pointer"
                  aria-label="Shuffle Play"
                >
                  <Shuffle className="w-4 h-4" />
                </button>
              </div>

              {/* Intelligent Playlist Download Action */}
              <div className="w-full">
                {isAllDownloaded ? (
                  <div className="w-full flex items-center justify-center space-x-2 py-2.5 rounded-full bg-emerald-500/15 border border-emerald-500/25 text-emerald-600 dark:text-emerald-400 font-bold text-xs select-none shadow-xs">
                    <Check className="w-4 h-4" />
                    <span>All {totalSongs} Songs Downloaded</span>
                  </div>
                ) : isDownloading ? (
                  <button
                    onClick={handleCancelDownload}
                    className="w-full flex items-center justify-center space-x-2 py-2.5 rounded-full bg-purple-600/15 border border-purple-500/30 text-purple-600 dark:text-purple-400 font-bold text-xs active:scale-95 transition-all shadow-xs cursor-pointer"
                    title="Click to cancel playlist download"
                  >
                    <Loader2 className="w-4 h-4 animate-spin text-purple-600 dark:text-purple-400" />
                    <span>
                      Downloading ({playlistDownloadProgress?.completed ?? downloadedCount}/{totalSongs})
                    </span>
                    <span className="text-[10px] text-rose-500 dark:text-rose-400 ml-1 font-bold underline">
                      Cancel
                    </span>
                  </button>
                ) : downloadedCount > 0 ? (
                  <button
                    onClick={handleDownloadAll}
                    className="w-full flex items-center justify-center space-x-2 py-2.5 rounded-full bg-white/80 dark:bg-white/10 hover:bg-white dark:hover:bg-white/15 border border-black/5 dark:border-white/10 text-stuxs-text active:scale-95 transition-all text-xs font-bold shadow-xs cursor-pointer"
                  >
                    <Download className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                    <span>Download Remaining ({totalSongs - downloadedCount})</span>
                  </button>
                ) : (
                  <button
                    onClick={handleDownloadAll}
                    className="w-full flex items-center justify-center space-x-2 py-2.5 rounded-full bg-white/80 dark:bg-white/10 hover:bg-white dark:hover:bg-white/15 border border-black/5 dark:border-white/10 text-stuxs-text active:scale-95 transition-all text-xs font-bold shadow-xs cursor-pointer"
                  >
                    <Download className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                    <span>Download Playlist</span>
                  </button>
                )}
              </div>

              {/* Smart Queue Toggle Pill */}
              <div className="w-full">
                <button
                  onClick={toggleSmartQueue}
                  className={`w-full flex items-center justify-between px-4 py-2.5 rounded-full border transition-all btn-press text-xs font-bold shadow-xs cursor-pointer ${
                    smartQueueEnabled
                      ? 'bg-purple-600/15 border-purple-500/30 text-purple-600 dark:text-purple-400'
                      : 'bg-white/80 dark:bg-white/10 hover:bg-white dark:hover:bg-white/15 border-black/5 dark:border-white/10 text-stuxs-text-secondary'
                  }`}
                  aria-label={`Toggle Smart Queue: ${smartQueueEnabled ? 'ON' : 'OFF'}`}
                >
                  <div className="flex items-center space-x-2">
                    <ListMusic
                      className={`w-4 h-4 transition-colors ${
                        smartQueueEnabled ? 'text-purple-600 dark:text-purple-400' : 'text-stuxs-text-muted'
                      }`}
                    />
                    <span className={smartQueueEnabled ? 'text-stuxs-text font-bold' : 'text-stuxs-text-secondary'}>
                      Smart Queue
                    </span>
                  </div>
                  <span
                    className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded-full uppercase tracking-wider transition-all ${
                      smartQueueEnabled
                        ? 'bg-purple-600 text-white shadow-sm'
                        : 'bg-black/5 dark:bg-white/10 text-stuxs-text-muted border border-black/5 dark:border-white/5'
                    }`}
                  >
                    {smartQueueEnabled ? 'ON' : 'OFF'}
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main Content Sheet: Rounded Warm Cream / Deep Dark Surface */}
      <div className="rounded-t-[36px] sm:rounded-t-[40px] bg-[#FAF8F5] dark:bg-[#121218] min-h-[50vh] px-4 sm:px-5 pt-5 pb-36">
        {songs.length === 0 ? (
          <EmptyState
            icon="music"
            title="Playlist is empty"
            description="Search for tracks and add them using the track context menu."
          />
        ) : (
          <div>
            <div className="flex items-center justify-between py-2 border-b border-stuxs-border/40 text-xs font-semibold text-stuxs-text-muted mb-2">
              <span># TITLE</span>
              <div className="flex items-center space-x-1 pr-2">
                <Clock className="w-3.5 h-3.5" />
              </div>
            </div>

            {isReorderMode ? (
              /* Reorder Mode Track List */
              <div className="space-y-1">
                {songs.map((track, idx) => (
                  <div
                    key={`${track.id}-${idx}`}
                    className="flex items-center justify-between p-2.5 rounded-2xl bg-stuxs-surface-secondary/60 border border-stuxs-border/60"
                  >
                    <div className="flex items-center space-x-3 min-w-0 flex-1">
                      <span className="text-xs font-bold text-stuxs-text-muted w-4">
                        {idx + 1}
                      </span>
                      <img
                        src={track.artworkUrl}
                        alt={track.title}
                        className="w-10 h-10 rounded-xl object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <h4 className="text-xs font-bold text-stuxs-text truncate">
                          {track.title}
                        </h4>
                        <p className="text-[10px] text-stuxs-text-secondary truncate">
                          {track.artistName}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center space-x-1">
                      {/* Move Up */}
                      <button
                        onClick={() => reorderPlaylist(playlist.id, idx, Math.max(0, idx - 1))}
                        disabled={idx === 0}
                        className="p-1.5 rounded-lg text-stuxs-text-secondary hover:text-white disabled:opacity-30"
                      >
                        <ArrowUp className="w-4 h-4" />
                      </button>

                      {/* Move Down */}
                      <button
                        onClick={() => reorderPlaylist(playlist.id, idx, Math.min(songs.length - 1, idx + 1))}
                        disabled={idx === songs.length - 1}
                        className="p-1.5 rounded-lg text-stuxs-text-secondary hover:text-white disabled:opacity-30"
                      >
                        <ArrowDown className="w-4 h-4" />
                      </button>

                      {/* Remove with Confirmation */}
                      <button
                        onClick={() => setTrackToRemove(track)}
                        className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-500/10 ml-1"
                        aria-label="Remove from playlist"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              /* Regular Track List */
              <div className="space-y-0.5">
                {songs.map((track, idx) => (
                  <TrackRow
                    key={`${track.id}-${idx}`}
                    track={track}
                    index={idx}
                    showIndex={true}
                    playlistContext={songs}
                    context="playlist"
                    playlistId={playlist.id}
                    onSelectArtist={onSelectArtist}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Remove Song from Playlist Confirmation Modal */}
      {trackToRemove && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-150 select-none"
          onClick={() => !isRemovingSong && setTrackToRemove(null)}
        >
          <div
            className="w-full max-w-sm rounded-3xl liquid-glass-panel border border-white/15 p-6 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150 text-left"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-12 h-12 rounded-2xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400 mb-2">
              <Trash2 className="w-6 h-6" />
            </div>

            <div className="space-y-1.5">
              <h3 className="text-lg font-bold text-stuxs-text tracking-tight">
                Remove song?
              </h3>
              <p className="text-xs text-stuxs-text-secondary leading-relaxed">
                Are you sure you want to remove <span className="text-white font-semibold">"{trackToRemove.title}"</span> from this playlist?
              </p>
              <p className="text-[11px] text-stuxs-text-muted mt-1 leading-relaxed">
                This will only remove the song from this playlist. It will not delete the song from your library or device downloads.
              </p>
            </div>

            <div className="flex items-center space-x-3 pt-2">
              <button
                onClick={() => setTrackToRemove(null)}
                disabled={isRemovingSong}
                className="flex-1 py-2.5 rounded-xl bg-stuxs-surface hover:bg-stuxs-surface-hover border border-white/10 text-stuxs-text font-semibold text-xs transition-all active:scale-95 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmRemoveSong}
                disabled={isRemovingSong}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white font-bold text-xs shadow-lg shadow-rose-600/30 transition-all active:scale-95 flex items-center justify-center space-x-1.5 disabled:opacity-50"
              >
                {isRemovingSong ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Removing...</span>
                  </>
                ) : (
                  <span>Remove</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal (For user-created playlists only) */}
      {isDeleteModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-150 select-none"
          onClick={() => !isDeleting && setIsDeleteModalOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-3xl liquid-glass-panel border border-white/15 p-6 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150 text-left"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-12 h-12 rounded-2xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400 mb-2">
              <AlertTriangle className="w-6 h-6" />
            </div>

            <div className="space-y-1.5">
              <h3 className="text-lg font-bold text-stuxs-text tracking-tight">
                Delete playlist?
              </h3>
              <p className="text-xs text-stuxs-text-secondary leading-relaxed">
                <span className="text-white font-semibold">"{playlist.name}"</span> will be permanently deleted from your library.
              </p>
            </div>

            <div className="flex items-center space-x-3 pt-2">
              <button
                onClick={() => setIsDeleteModalOpen(false)}
                disabled={isDeleting}
                className="flex-1 py-2.5 rounded-xl bg-stuxs-surface hover:bg-stuxs-surface-hover border border-white/10 text-stuxs-text font-semibold text-xs transition-all active:scale-95"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white font-bold text-xs shadow-lg shadow-rose-600/30 transition-all active:scale-95 flex items-center justify-center space-x-1.5"
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <span>Delete</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Playlist Modal */}
      {isRenameModalOpen && playlist && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-150 select-none"
          onClick={() => !isRenaming && setIsRenameModalOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-3xl liquid-glass-panel border border-white/15 p-6 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150 text-left"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-1.5">
              <h3 className="text-lg font-bold text-stuxs-text tracking-tight">
                Rename Playlist
              </h3>
              <p className="text-xs text-stuxs-text-secondary leading-relaxed">
                Enter a new title for <span className="text-white font-semibold">"{playlist.name}"</span>.
              </p>
            </div>

            <form onSubmit={handleConfirmRename} className="space-y-4">
              <input
                type="text"
                value={renameInput}
                onChange={(e) => setRenameInput(e.target.value)}
                placeholder="Playlist name"
                maxLength={60}
                autoFocus
                disabled={isRenaming}
                className="w-full px-4 py-3 rounded-2xl bg-white/10 dark:bg-black/40 border border-black/10 dark:border-white/15 text-sm font-semibold text-stuxs-text placeholder-stuxs-text-muted focus:outline-none focus:ring-2 focus:ring-purple-500/50"
              />

              <div className="flex items-center space-x-3 pt-1">
                <button
                  type="button"
                  onClick={() => setIsRenameModalOpen(false)}
                  disabled={isRenaming}
                  className="flex-1 py-2.5 rounded-xl bg-stuxs-surface hover:bg-stuxs-surface-hover border border-white/10 text-stuxs-text font-semibold text-xs transition-all active:scale-95"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isRenaming || !renameInput.trim() || renameInput.trim() === playlist.name}
                  className="flex-1 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 active:bg-purple-700 text-white font-bold text-xs shadow-lg shadow-purple-600/30 transition-all active:scale-95 flex items-center justify-center space-x-1.5 disabled:opacity-50"
                >
                  {isRenaming ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <span>Save</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Playlist Action Menu Bottom Sheet */}
      {playlist && (
        <PlaylistActionMenu
          playlist={playlist}
          isOpen={isMenuOpen}
          onClose={() => setIsMenuOpen(false)}
          onEditPlaylist={() => {
            setRenameInput(playlist.name);
            setIsRenameModalOpen(true);
          }}
        />
      )}
    </div>
  );
};

export const PlaylistScreen = React.memo(PlaylistScreenComponent);
