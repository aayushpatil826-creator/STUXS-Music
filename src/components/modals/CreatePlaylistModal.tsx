import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, FolderPlus } from 'lucide-react';
import { useLibrary } from '../../context/LibraryContext';
import { backButtonManager } from '../../services/backButtonManager';

interface CreatePlaylistModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (playlistId: string) => void;
}

export const CreatePlaylistModal: React.FC<CreatePlaylistModalProps> = ({
  isOpen,
  onClose,
  onCreated,
}) => {
  const { createPlaylist } = useLibrary();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [active, setActive] = useState(false);

  const handleAnimatedClose = useCallback(() => {
    setActive(false);
    setTimeout(() => {
      setName('');
      setDescription('');
      onClose();
    }, 240);
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        setActive(true);
      }, 20);
      const unregister = backButtonManager.register('create-playlist-modal', handleAnimatedClose, 30);
      return () => {
        clearTimeout(timer);
        unregister();
      };
    } else {
      setActive(false);
    }
  }, [isOpen, handleAnimatedClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const playlist = await createPlaylist(name.trim(), description.trim());
    handleAnimatedClose();
    if (onCreated) {
      onCreated(playlist.id);
    }
  };

  return createPortal(
    <>
      {/* Dim Scrim Backdrop */}
      <div
        onClick={handleAnimatedClose}
        className={`fixed inset-0 z-[999] bg-black/50 transition-opacity duration-240 ${
          active ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden="true"
      />

      {/* Bottom Sheet Container: slides upward from bottom */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={`fixed inset-x-0 bottom-0 z-[1000] w-full max-w-sm mx-auto bg-stuxs-surface border-t sm:border border-stuxs-border rounded-t-[32px] sm:rounded-3xl p-6 shadow-2xl transition-all select-none will-change-transform text-left ${
          active ? 'duration-300' : 'duration-240'
        }`}
        style={{
          transform: active ? 'translate3d(0, 0, 0)' : 'translate3d(0, 100%, 0)',
          opacity: active ? 1 : 0,
          transitionTimingFunction: active ? 'cubic-bezier(0.16, 1, 0.3, 1)' : 'cubic-bezier(0.3, 0, 0.8, 0.15)',
          paddingBottom: 'max(env(safe-area-inset-bottom, 16px), var(--safe-area-inset-bottom, 16px), 16px)',
        }}
      >
        {/* Top Drag Handle for mobile */}
        <div className="sm:hidden flex justify-center -mt-2 pb-3">
          <div className="w-9 h-1 rounded-full bg-stuxs-text-muted/30" />
        </div>
        <div className="flex items-center justify-between pb-3 border-b border-stuxs-border/60">
          <div className="flex items-center space-x-2">
            <FolderPlus className="w-5 h-5 text-stuxs-accent" />
            <h3 className="text-base font-bold text-stuxs-text">New Playlist</h3>
          </div>
          <button
            onClick={handleAnimatedClose}
            className="p-1 rounded-full text-stuxs-text-muted hover:text-stuxs-text cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 pt-4">
          <div>
            <label className="block text-xs font-semibold text-stuxs-text-secondary uppercase mb-1.5">
              Playlist Name
            </label>
            <input
              type="text"
              required
              placeholder="e.g., Midnight Synth Odyssey"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-stuxs-surface-secondary border border-stuxs-border text-sm text-stuxs-text placeholder:text-stuxs-text-muted focus:outline-none focus:border-stuxs-accent"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-stuxs-text-secondary uppercase mb-1.5">
              Description (Optional)
            </label>
            <textarea
              rows={2}
              placeholder="Give your playlist a vibe or mood..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-stuxs-surface-secondary border border-stuxs-border text-sm text-stuxs-text placeholder:text-stuxs-text-muted focus:outline-none focus:border-stuxs-accent resize-none"
            />
          </div>

          <div className="flex items-center justify-end space-x-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl text-xs font-semibold text-stuxs-text-secondary hover:bg-stuxs-surface-secondary transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="px-5 py-2.5 rounded-xl bg-stuxs-accent hover:opacity-90 disabled:opacity-50 text-xs font-bold text-white shadow-stuxs-glow transition-all active:scale-95 cursor-pointer shadow-xs"
            >
              Create Playlist
            </button>
          </div>
        </form>
      </div>
    </>,
    document.body
  );
};
