import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Check, Music2, FolderPlus, Sparkles } from 'lucide-react';
import type { Track } from '../../types/music';
import { useLibrary } from '../../context/LibraryContext';
import { useToast } from '../../context/ToastContext';
import { backButtonManager } from '../../services/backButtonManager';

interface AddToPlaylistSheetProps {
  track: Track | null;
  isOpen: boolean;
  onClose: () => void;
}

export const AddToPlaylistSheet: React.FC<AddToPlaylistSheetProps> = ({
  track,
  isOpen,
  onClose,
}) => {
  const { playlists, addTrackToPlaylist, createPlaylist, isTrackInPlaylist } = useLibrary();
  const { showToast } = useToast();

  const [active, setActive] = useState(false);
  const [dragY, setDragY] = useState(0);
  const touchStartY = useRef<number>(0);
  const isDragging = useRef<boolean>(false);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const handleAnimatedClose = useCallback(() => {
    setActive(false);
    setTimeout(() => {
      setIsCreatingNew(false);
      setNewPlaylistName('');
      setDragY(0);
      onClose();
    }, 240);
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      setDragY(0);
      const timer = setTimeout(() => {
        setActive(true);
      }, 20);
      const unregister = backButtonManager.register('add-to-playlist-sheet', handleAnimatedClose, 30);
      return () => {
        clearTimeout(timer);
        unregister();
      };
    } else {
      setActive(false);
    }
  }, [isOpen, handleAnimatedClose]);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
    isDragging.current = true;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging.current) return;
    const currentY = e.touches[0].clientY;
    const deltaY = currentY - touchStartY.current;
    if (deltaY > 0) {
      setDragY(deltaY);
    }
  };

  const handleTouchEnd = () => {
    if (!isDragging.current) return;
    isDragging.current = false;
    if (dragY > 70) {
      handleAnimatedClose();
    } else {
      setDragY(0);
    }
  };

  if (!isOpen || !track) return null;

  const handleSelectPlaylist = async (playlistId: string) => {
    if (isProcessing) return;
    setIsProcessing(true);

    try {
      const result = await addTrackToPlaylist(playlistId, track);
      if (result.alreadyExists) {
        showToast(result.message, 'info');
      } else if (result.success) {
        showToast(result.message, 'success');
        handleAnimatedClose();
      } else {
        showToast(result.message || "Couldn't add song to playlist", 'error');
      }
    } catch (err) {
      showToast("Couldn't add song to playlist. Try again.", 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCreateAndAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newPlaylistName.trim();
    if (!name || isProcessing) return;

    setIsProcessing(true);
    try {
      const created = await createPlaylist(name, '', track);
      showToast(`Playlist created & added to "${created.name}"`, 'success');
      handleAnimatedClose();
    } catch (err) {
      showToast("Failed to create playlist. Try again.", 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[999] flex flex-col justify-end">
      {/* Universal Scrim Backdrop matching LyricsSheet */}
      <div
        className={`fixed inset-0 bg-black/50 transition-opacity duration-240 ${
          active ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={handleAnimatedClose}
      />

      {/* Sheet Content Card with Universal Sheet Motion */}
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={(e) => e.stopPropagation()}
        className={`relative z-10 w-full max-w-lg mx-auto bg-stuxs-surface border-t border-stuxs-border rounded-t-[32px] shadow-2xl overflow-hidden will-change-transform select-none flex flex-col max-h-[85vh] transition-transform ${
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
        {/* Top Handle / Header */}
        <div className="pt-3.5 px-6 pb-3 border-b border-stuxs-border/60 cursor-grab active:cursor-grabbing">
          <div className="w-10 h-1.5 bg-stuxs-text-muted/30 rounded-full mx-auto mb-3" />

          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-stuxs-text tracking-tight">
              Add to Playlist
            </h3>
            <button
              onClick={handleAnimatedClose}
              className="p-1.5 rounded-full text-stuxs-text-muted hover:text-stuxs-text hover:bg-stuxs-surface transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Selected Track Preview Mini-Card */}
          <div className="flex items-center space-x-3 mt-3 p-2.5 rounded-2xl bg-stuxs-surface/80 border border-stuxs-border/60">
            <img
              src={track.artworkUrl}
              alt={track.title}
              className="w-11 h-11 rounded-xl object-cover shadow-sm flex-shrink-0"
            />
            <div className="min-w-0 flex-1">
              <h4 className="text-xs font-bold text-stuxs-text truncate">{track.title}</h4>
              <p className="text-[11px] text-stuxs-text-secondary truncate mt-0.5">
                {track.artistName}
              </p>
            </div>
          </div>
        </div>

        {/* Body Section */}
        <div className="p-4 max-h-[55vh] overflow-y-auto space-y-2.5 scrollbar-thin">
          {/* Create New Playlist Button / Inline Form */}
          {isCreatingNew ? (
            <form
              onSubmit={handleCreateAndAdd}
              className="p-3.5 rounded-2xl bg-stuxs-surface border border-stuxs-accent/40 shadow-stuxs-glow space-y-3 animate-in fade-in zoom-in-95 duration-150"
            >
              <div className="flex items-center space-x-2 text-stuxs-accent">
                <Sparkles className="w-4 h-4" />
                <span className="text-xs font-bold uppercase tracking-wider">New Playlist</span>
              </div>
              <input
                type="text"
                required
                maxLength={60}
                placeholder="Playlist name (e.g. Ganpati Hits)"
                value={newPlaylistName}
                onChange={(e) => setNewPlaylistName(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-stuxs-surface-secondary border border-stuxs-border text-sm text-stuxs-text placeholder:text-stuxs-text-muted focus:outline-none focus:border-stuxs-accent"
                autoFocus
              />
              <div className="flex items-center justify-end space-x-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsCreatingNew(false)}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold text-stuxs-text-secondary hover:bg-stuxs-surface-secondary transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newPlaylistName.trim() || isProcessing}
                  className="px-4 py-1.5 rounded-xl bg-stuxs-accent hover:opacity-90 disabled:opacity-50 text-xs font-bold text-white shadow-stuxs-glow transition-all active:scale-95"
                >
                  Create & Add
                </button>
              </div>
            </form>
          ) : (
            <button
              onClick={() => setIsCreatingNew(true)}
              className="w-full flex items-center space-x-3.5 p-3 rounded-2xl bg-stuxs-surface/60 hover:bg-stuxs-surface border border-stuxs-border/70 text-stuxs-text transition-all hover:scale-[1.01] active:scale-[0.99] btn-press group"
            >
              <div className="w-10 h-10 rounded-xl bg-stuxs-accent/15 border border-stuxs-accent/30 text-stuxs-accent flex items-center justify-center group-hover:scale-105 transition-transform">
                <Plus className="w-5 h-5" />
              </div>
              <div className="text-left">
                <span className="text-xs font-bold text-stuxs-text block">
                  Create New Playlist
                </span>
                <span className="text-[10px] text-stuxs-text-muted">
                  Organize and collect your music
                </span>
              </div>
            </button>
          )}

          {/* User Playlists List */}
          <div className="pt-2">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-stuxs-text-muted px-2 mb-2">
              Your Playlists
            </h4>

            {playlists.length === 0 ? (
              <div className="text-center py-6 px-4 rounded-2xl bg-stuxs-surface/40 border border-stuxs-border/40">
                <FolderPlus className="w-8 h-8 text-stuxs-text-muted mx-auto mb-2 opacity-60" />
                <p className="text-xs font-bold text-stuxs-text">No playlists yet</p>
                <p className="text-[11px] text-stuxs-text-secondary mt-0.5">
                  Create your first playlist to organize your songs.
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {playlists.map((playlist) => {
                  const alreadyIn = isTrackInPlaylist(playlist.id, track);

                  return (
                    <button
                      key={playlist.id}
                      disabled={isProcessing}
                      onClick={() => handleSelectPlaylist(playlist.id)}
                      className={`w-full flex items-center justify-between p-2.5 rounded-2xl border transition-all active:scale-[0.99] btn-press ${
                        alreadyIn
                          ? 'bg-stuxs-accent/10 border-stuxs-accent/30 text-stuxs-text'
                          : 'bg-stuxs-surface/40 hover:bg-stuxs-surface border-stuxs-border/50 text-stuxs-text'
                      }`}
                    >
                      <div className="flex items-center space-x-3 min-w-0 pr-2">
                        <div className="w-10 h-10 rounded-xl overflow-hidden bg-stuxs-surface-secondary flex-shrink-0 shadow-sm">
                          {playlist.artworkUrl ? (
                            <img
                              src={playlist.artworkUrl}
                              alt={playlist.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-stuxs-text-muted">
                              <Music2 className="w-4 h-4" />
                            </div>
                          )}
                        </div>
                        <div className="text-left min-w-0">
                          <h5 className="text-xs font-bold truncate">{playlist.name}</h5>
                          <p className="text-[10px] text-stuxs-text-secondary mt-0.5">
                            {playlist.songCount || playlist.songs?.length || 0} songs
                          </p>
                        </div>
                      </div>

                      {alreadyIn ? (
                        <div className="flex items-center space-x-1 px-2.5 py-1 rounded-full bg-stuxs-accent/20 border border-stuxs-accent/40 text-stuxs-accent text-[10px] font-bold">
                          <Check className="w-3 h-3" />
                          <span>Added</span>
                        </div>
                      ) : (
                        <Plus className="w-4 h-4 text-stuxs-text-muted mr-1.5 group-hover:text-stuxs-accent transition-colors" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
