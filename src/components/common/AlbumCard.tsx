import React from 'react';
import { Play } from 'lucide-react';
import type { Album } from '../../types/music';
import { usePlayerActions } from '../../context/PlayerContext';
import { BRANDING_CONFIG } from '../../config/branding';

interface AlbumCardProps {
  album: Album;
  onSelect: (albumId: string) => void;
  size?: 'normal' | 'large' | 'compact' | 'fluid';
  className?: string;
}

const AlbumCardComponent: React.FC<AlbumCardProps> = ({
  album,
  onSelect,
  size = 'fluid',
  className = '',
}) => {
  const { playTrack } = usePlayerActions();

  const handlePlayDirect = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (album.songs && album.songs.length > 0) {
      playTrack(album.songs[0], album.songs);
    } else {
      onSelect(album.id);
    }
  };

  const sizeClasses = {
    compact: 'w-28 sm:w-32 flex-shrink-0',
    normal: 'w-32 sm:w-36 flex-shrink-0',
    large: 'w-44 sm:w-52 flex-shrink-0',
    fluid: 'w-full',
  };

  return (
    <div
      onClick={() => onSelect(album.id)}
      className={`group cursor-pointer flex flex-col card-press ${sizeClasses[size]} ${className}`}
    >
      <div className="relative w-full aspect-square rounded-[22px] overflow-hidden bg-stuxs-surface-secondary shadow-sm mb-1.5 transition-transform duration-200 group-hover:scale-[1.02] ring-1 ring-black/5 dark:ring-white/10 flex-shrink-0">
        <img
          src={album.artworkUrl || BRANDING_CONFIG.appLogo}
          alt={album.title}
          className="w-full h-full object-cover pointer-events-none"
          loading="lazy"
          onError={(e) => {
            const target = e.currentTarget;
            if (!target.dataset.fallbackApplied) {
              target.dataset.fallbackApplied = 'true';
              target.src = BRANDING_CONFIG.appLogo;
            }
          }}
        />

        {/* Play button overlay */}
        <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-all duration-200 transform translate-y-1 group-hover:translate-y-0">
          <button
            onClick={handlePlayDirect}
            className="w-8 h-8 rounded-full bg-purple-600 text-white flex items-center justify-center shadow-lg hover:scale-105 active:scale-95 transition-transform cursor-pointer"
            aria-label={`Play ${album.title}`}
          >
            <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
          </button>
        </div>
      </div>

      <h3 className="text-xs font-bold text-stuxs-text truncate group-hover:text-stuxs-accent transition-colors leading-tight">
        {album.title}
      </h3>
      <p className="text-[10px] text-stuxs-text-secondary truncate mt-0.5 leading-tight">
        {album.artistName}
      </p>
    </div>
  );
};

export const AlbumCard = React.memo(AlbumCardComponent);
