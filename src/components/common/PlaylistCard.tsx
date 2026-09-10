import React, { useState } from 'react';
import { Play, MoreVertical } from 'lucide-react';
import type { Playlist } from '../../types/music';
import { usePlayerActions } from '../../context/PlayerContext';
import { PlaylistCover } from './PlaylistCover';
import { PlaylistActionMenu } from './PlaylistActionMenu';

interface PlaylistCardProps {
  playlist: Playlist;
  onSelect: (playlistId: string) => void;
  className?: string;
}

export const PlaylistCard: React.FC<PlaylistCardProps> = ({ playlist, onSelect, className = '' }) => {
  const { playTrack } = usePlayerActions();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const handlePlayDirect = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (playlist.songs && playlist.songs.length > 0) {
      playTrack(playlist.songs[0], playlist.songs);
    } else {
      onSelect(playlist.id);
    }
  };

  const handleMenuClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsMenuOpen(true);
  };

  return (
    <>
      <div
        onClick={() => onSelect(playlist.id)}
        className={`group w-full cursor-pointer flex flex-col ${className}`}
      >
        {/* 1:1 Square Artwork Container */}
        <div className="relative w-full aspect-square rounded-[22px] overflow-hidden bg-stuxs-surface-secondary shadow-sm mb-1.5 transition-transform duration-200 group-hover:scale-[1.02] ring-1 ring-black/5 dark:ring-white/10 flex-shrink-0">
          <PlaylistCover playlist={playlist} />

          {/* Three-Dot Menu Button in Top-Right Corner */}
          <div className="absolute top-2 right-2 z-20">
            <button
              onClick={handleMenuClick}
              className="w-7 h-7 rounded-full bg-black/50 hover:bg-black/80 backdrop-blur-md text-white/80 hover:text-white flex items-center justify-center border border-white/10 active:scale-90 transition-all cursor-pointer shadow-md"
              aria-label={`Options for ${playlist.name}`}
            >
              <MoreVertical className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Play button overlay on hover/focus */}
          <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-all duration-200 transform translate-y-1 group-hover:translate-y-0 z-10">
            <button
              onClick={handlePlayDirect}
              className="w-8 h-8 rounded-full bg-purple-600 text-white flex items-center justify-center shadow-lg hover:scale-105 active:scale-95 transition-transform cursor-pointer"
              aria-label={`Play ${playlist.name}`}
            >
              <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
            </button>
          </div>
        </div>

        {/* Playlist Title (Max 1 Line with Ellipsis) */}
        <h3 className="text-xs font-bold text-stuxs-text truncate group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors leading-tight">
          {playlist.name}
        </h3>

        {/* Description / Song Count (Max 1 Line with Ellipsis) */}
        <p className="text-[10px] font-medium text-stuxs-text-secondary truncate mt-0.5 leading-tight">
          {playlist.description || `${playlist.songCount || playlist.songs?.length || 0} songs`}
        </p>
      </div>

      {/* Playlist Context / Action Menu Sheet */}
      <PlaylistActionMenu
        playlist={playlist}
        isOpen={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        onSelectPlaylist={onSelect}
      />
    </>
  );
};
