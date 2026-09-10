import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Trash2, ArrowUp, ArrowDown, Music2, ListMusic, Plus, Play } from 'lucide-react';
import { usePlayer } from '../../context/PlayerContext';
import { backButtonManager } from '../../services/backButtonManager';

export const QueueDrawer: React.FC = () => {
  const {
    isQueueOpen,
    setIsQueueOpen,
    currentTrack,
    queue,
    manualQueue,
    smartQueue,
    queueIndex,
    playbackSource,
    activeLibraryPlaylist,
    smartQueueEnabled,
    toggleSmartQueue,
    removeFromQueue,
    clearQueue,
    reorderQueue,
    playTrack,
    dismissSmartQueueTrack,
    addSmartQueueTrackToManual,
  } = usePlayer();

  const [active, setActive] = useState(false);
  const [dragY, setDragY] = useState(0);
  const isDragging = useRef<boolean>(false);
  const touchStartY = useRef<number>(0);

  const handleClose = React.useCallback(() => {
    setActive(false);
    setTimeout(() => {
      setIsQueueOpen(false);
      setDragY(0);
    }, 240);
  }, [setIsQueueOpen]);

  useEffect(() => {
    if (isQueueOpen) {
      setDragY(0);
      const timer = setTimeout(() => {
        setActive(true);
      }, 20);
      const unregister = backButtonManager.register('queue-drawer', handleClose, 25);
      return () => {
        clearTimeout(timer);
        unregister();
      };
    } else {
      setActive(false);
    }
  }, [isQueueOpen, handleClose]);

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
    if (dragY > 75) {
      handleClose();
    } else {
      setDragY(0);
    }
  };

  if (!isQueueOpen) return null;

  const upNextTracks = [...manualQueue, ...queue.slice(queueIndex + 1)];

  return createPortal(
    <>
      {/* Universal Scrim Backdrop matching LyricsSheet */}
      <div
        onClick={handleClose}
        className={`fixed inset-0 z-[999] bg-black/50 transition-opacity duration-240 ${
          active ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden="true"
      />

      {/* Floating Liquid Glass / Theme Surface Panel with Universal Sheet Motion */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={`fixed inset-x-0 bottom-0 z-[1000] w-full max-w-lg mx-auto h-[86vh] sm:h-[640px] bg-stuxs-surface border-t sm:border border-stuxs-border rounded-t-[32px] sm:rounded-[32px] flex flex-col overflow-hidden select-none shadow-2xl will-change-transform transition-transform ${
          isDragging.current ? 'duration-0' : active ? 'duration-300' : 'duration-240'
        }`}
        style={{
          transform: active
            ? `translate3d(0, ${dragY}px, 0)`
            : 'translate3d(0, 100%, 0)',
          transitionTimingFunction: active ? 'cubic-bezier(0.16, 1, 0.3, 1)' : 'cubic-bezier(0.3, 0, 0.8, 0.15)',
          paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom, 16px))',
        }}
      >
        {/* Top Drag Pill for Mobile Sheet UI */}
        <div
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          className="flex justify-center pt-3.5 pb-1.5 cursor-grab active:cursor-grabbing flex-shrink-0"
        >
          <div className="w-10 h-1.5 rounded-full bg-stuxs-text-muted/30" />
        </div>

        {/* Glass Header */}
        <header
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          className="relative z-10 flex items-center justify-between px-6 py-3 border-b border-stuxs-border/60 flex-shrink-0"
        >
          <div className="flex items-center space-x-2.5">
            <div className="p-1.5 rounded-xl bg-stuxs-accent/15 border border-stuxs-accent/30 text-stuxs-accent">
              <Music2 className="w-4 h-4" />
            </div>
            <h3 className="text-base font-bold tracking-tight text-stuxs-text">
              Playback Queue
            </h3>
            <span className="px-2 py-0.5 rounded-full bg-stuxs-surface-secondary border border-stuxs-border text-[11px] font-semibold text-stuxs-text-secondary">
              {queue.length + smartQueue.length}
            </span>
          </div>

          <div className="flex items-center space-x-2">
            {queue.length > 1 && (
              <button
                onClick={clearQueue}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-full text-xs font-semibold text-rose-500 hover:text-rose-600 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 btn-press transition-all cursor-pointer"
                title="Clear upcoming queue"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear</span>
              </button>
            )}

            <button
              onClick={handleClose}
              className="w-8 h-8 rounded-full bg-stuxs-surface-secondary hover:bg-stuxs-surface-hover border border-stuxs-border flex items-center justify-center text-stuxs-text-secondary hover:text-stuxs-text btn-press transition-all cursor-pointer"
              aria-label="Close Queue"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Scrollable Content */}
        <main className="relative z-10 flex-1 overflow-y-auto px-6 py-4 space-y-6 scrollbar-none">
          {/* Active Track — Floating Glass Tile */}
          {currentTrack && (
            <div>
              <div className="flex items-center space-x-1.5 mb-2.5">
                <Music2 className="w-3 h-3 text-stuxs-accent animate-pulse" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-stuxs-text-muted">
                  Now Playing
                </span>
              </div>

              <div className="bg-stuxs-surface-secondary border border-stuxs-border rounded-2xl p-3.5 flex items-center justify-between transition-all shadow-sm">
                <div className="flex items-center space-x-3.5 min-w-0 flex-1">
                  <div className="relative w-12 h-12 rounded-xl overflow-hidden shadow-md ring-1 ring-stuxs-border flex-shrink-0 bg-black/40">
                    <img
                      src={currentTrack.artworkUrl}
                      alt={currentTrack.title}
                      className="w-full h-full object-cover"
                    />
                  </div>

                  <div className="min-w-0 flex-1 pr-2">
                    <h4 className="text-sm font-bold text-stuxs-text truncate">
                      {currentTrack.title}
                    </h4>
                    <p className="text-xs font-medium text-stuxs-text-secondary truncate mt-0.5">
                      {currentTrack.artistName}
                    </p>
                  </div>
                </div>

                {/* Animated Equalizer Wave */}
                <div className="flex items-end justify-center space-x-0.5 h-4 px-2">
                  <span className="w-1 h-4 bg-stuxs-accent rounded-full animate-pulse" />
                  <span className="w-1 h-2.5 bg-stuxs-accent rounded-full animate-pulse delay-75" />
                  <span className="w-1 h-3.5 bg-stuxs-accent rounded-full animate-pulse delay-150" />
                </div>
              </div>
            </div>
          )}

          {/* Up Next List (Manual Queue) */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-stuxs-text-muted">
                Up Next ({upNextTracks.length})
              </span>
            </div>

            {upNextTracks.length === 0 ? (
              <div className="p-4 text-center rounded-2xl bg-stuxs-surface-secondary border border-stuxs-border">
                <p className="text-xs font-medium text-stuxs-text-secondary">
                  {smartQueue.length > 0
                    ? 'Manual queue empty. Smart Queue will continue playback automatically.'
                    : 'End of queue. Search or play an album to add more songs.'}
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                {upNextTracks.map((track, idx) => {
                  const actualQueueIndex = queueIndex + 1 + idx;
                  return (
                    <div
                      key={`${track.id}-${actualQueueIndex}`}
                      className="group flex items-center justify-between p-2 rounded-xl bg-transparent hover:bg-stuxs-surface-hover active:bg-stuxs-surface-tertiary active:scale-[0.99] border border-transparent hover:border-stuxs-border transition-all duration-150"
                    >
                      <div
                        onClick={() => playTrack(track, queue)}
                        className="flex items-center space-x-3 min-w-0 flex-1 cursor-pointer py-0.5"
                      >
                        <span className="text-xs font-semibold text-stuxs-text-muted w-4 text-center">
                          {idx + 1}
                        </span>
                        <div className="relative w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 ring-1 ring-stuxs-border bg-stuxs-surface-secondary">
                          <img
                            src={track.artworkUrl}
                            alt={track.title}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        </div>
                        <div className="min-w-0 flex-1 pr-2">
                          <h4 className="text-xs font-semibold text-stuxs-text truncate group-hover:text-stuxs-accent transition-colors">
                            {track.title}
                          </h4>
                          <p className="text-[11px] text-stuxs-text-secondary truncate mt-0.5">
                            {track.artistName}
                          </p>
                        </div>
                      </div>

                      {/* Reorder and Delete Controls */}
                      <div className="flex items-center space-x-1 flex-shrink-0 pl-1">
                        {idx > 0 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              reorderQueue(actualQueueIndex, actualQueueIndex - 1);
                            }}
                            className="p-1.5 rounded-lg text-stuxs-text-muted hover:text-stuxs-text hover:bg-stuxs-surface-secondary btn-press transition-all cursor-pointer"
                            title="Move Up"
                            aria-label="Move Up"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {idx < upNextTracks.length - 1 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              reorderQueue(actualQueueIndex, actualQueueIndex + 1);
                            }}
                            className="p-1.5 rounded-lg text-stuxs-text-muted hover:text-stuxs-text hover:bg-stuxs-surface-secondary btn-press transition-all cursor-pointer"
                            title="Move Down"
                            aria-label="Move Down"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeFromQueue(actualQueueIndex);
                          }}
                          className="p-1.5 rounded-lg text-stuxs-text-muted hover:text-rose-500 hover:bg-rose-500/15 btn-press transition-all cursor-pointer"
                          title="Remove from Queue"
                          aria-label="Remove from Queue"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Smart Queue Section (Exclusively for Active Library Playlist Sessions) */}
          {playbackSource === 'library-playlist' && activeLibraryPlaylist !== null && (
            <div className="pt-2 border-t border-stuxs-border/60">
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center space-x-2">
                  <ListMusic className={`w-3.5 h-3.5 ${smartQueueEnabled ? 'text-purple-400' : 'text-stuxs-text-muted'}`} />
                  <span className="text-[11px] font-bold uppercase tracking-wider text-purple-600 dark:text-purple-300">
                    Smart Queue (From Playlist)
                  </span>
                  <button
                    onClick={toggleSmartQueue}
                    className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wider transition-all btn-press cursor-pointer ${
                      smartQueueEnabled
                        ? 'bg-purple-500/30 text-purple-700 dark:text-purple-200 border border-purple-500/40'
                        : 'bg-stuxs-surface-secondary text-stuxs-text-muted border border-stuxs-border hover:text-stuxs-text'
                    }`}
                    aria-label={`Toggle Smart Queue. Currently ${smartQueueEnabled ? 'ON' : 'OFF'}`}
                  >
                    {smartQueueEnabled ? 'ON' : 'OFF'}
                  </button>
                </div>
                {smartQueueEnabled && smartQueue.length > 0 && (
                  <span className="text-[10px] font-medium text-stuxs-text-muted">
                    {smartQueue.length} in playlist
                  </span>
                )}
              </div>

              {!smartQueueEnabled ? (
                <div className="p-3 text-center rounded-2xl bg-stuxs-surface-secondary border border-stuxs-border">
                  <p className="text-xs font-medium text-stuxs-text-secondary">
                    Smart Queue is OFF. Turn ON to intelligently choose the best next song from this playlist.
                  </p>
                </div>
              ) : smartQueue.length === 0 ? (
                <div className="p-3 text-center rounded-2xl bg-stuxs-surface-secondary border border-stuxs-border">
                  <p className="text-xs font-medium text-stuxs-text-secondary">
                    All playlist tracks have been queued or played.
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  {smartQueue.map((track, idx) => (
                    <div
                      key={`sq-${track.id}-${idx}`}
                      className="group flex items-center justify-between p-2 rounded-xl bg-purple-500/[0.04] hover:bg-purple-500/[0.09] border border-purple-500/10 hover:border-purple-500/25 transition-all duration-150"
                    >
                      <div
                        onClick={() => playTrack(track, activeLibraryPlaylist?.tracks, { source: 'library-playlist', id: activeLibraryPlaylist?.id, name: activeLibraryPlaylist?.name })}
                        className="flex items-center space-x-3 min-w-0 flex-1 cursor-pointer py-0.5"
                      >
                        <div className="relative w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 ring-1 ring-purple-400/20 bg-stuxs-surface-secondary">
                          <img
                            src={track.artworkUrl}
                            alt={track.title}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                            <Play className="w-3.5 h-3.5 text-white fill-white ml-0.5" />
                          </div>
                        </div>
                        <div className="min-w-0 flex-1 pr-2">
                          <h4 className="text-xs font-semibold text-stuxs-text truncate group-hover:text-purple-500 dark:group-hover:text-purple-300 transition-colors">
                            {track.title}
                          </h4>
                          <p className="text-[11px] text-stuxs-text-secondary truncate mt-0.5">
                            {track.artistName}
                          </p>
                        </div>
                      </div>

                      {/* Add to manual queue or dismiss */}
                      <div className="flex items-center space-x-1 flex-shrink-0 pl-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            addSmartQueueTrackToManual(track);
                          }}
                          className="p-1.5 rounded-lg text-purple-600 dark:text-purple-300 hover:text-purple-700 hover:bg-purple-500/20 btn-press transition-all cursor-pointer"
                          title="Add to Manual Queue"
                          aria-label="Add to Manual Queue"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            dismissSmartQueueTrack(track.id);
                          }}
                          className="p-1.5 rounded-lg text-stuxs-text-muted hover:text-stuxs-text hover:bg-stuxs-surface-secondary btn-press transition-all cursor-pointer"
                          title="Dismiss Recommendation"
                          aria-label="Dismiss Recommendation"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </>,
    document.body
  );
};
