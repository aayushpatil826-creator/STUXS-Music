import React from 'react';
import { BadgeCheck } from 'lucide-react';
import type { Artist } from '../../types/music';
import { BRANDING_CONFIG } from '../../config/branding';

interface ArtistCardProps {
  artist: Artist;
  onSelect: (artistId: string) => void;
}

const ArtistCardComponent: React.FC<ArtistCardProps> = ({ artist, onSelect }) => {
  const formatListeners = (num?: number) => {
    if (!num) return '';
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M listeners`;
    if (num >= 1000) return `${(num / 1000).toFixed(0)}K listeners`;
    return `${num} listeners`;
  };

  return (
    <div
      onClick={() => onSelect(artist.id)}
      className="group flex flex-col items-center flex-shrink-0 w-32 cursor-pointer card-press"
    >
      <div className="relative w-28 h-28 rounded-full overflow-hidden bg-stuxs-surface-secondary shadow-md mb-2.5 transition-transform duration-200 group-hover:scale-105">
        <img
          src={artist.artworkUrl || BRANDING_CONFIG.appLogo}
          alt={artist.name}
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
        <div className="absolute inset-0 ring-1 ring-inset ring-white/10 rounded-full" />
      </div>

      <div className="flex items-center space-x-1 text-center max-w-full">
        <h4 className="text-xs font-semibold text-stuxs-text truncate group-hover:text-stuxs-accent transition-colors">
          {artist.name}
        </h4>
        {artist.isVerified && (
          <BadgeCheck className="w-3.5 h-3.5 text-stuxs-accent flex-shrink-0" />
        )}
      </div>

      {artist.monthlyListeners && (
        <p className="text-[10px] text-stuxs-text-muted mt-0.5">
          {formatListeners(artist.monthlyListeners)}
        </p>
      )}
    </div>
  );
};

export const ArtistCard = React.memo(ArtistCardComponent);
