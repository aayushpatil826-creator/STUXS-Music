import React, { useState } from 'react';
import type { Playlist } from '../../types/music';

interface PlaylistCoverProps {
  playlist: Playlist;
  className?: string;
  imageClassName?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
}

const GRADIENT_PALETTES = [
  'from-purple-900 via-indigo-950 to-neutral-950 text-purple-200 border-purple-500/20',
  'from-cyan-900 via-slate-950 to-neutral-950 text-cyan-200 border-cyan-500/20',
  'from-rose-900 via-pink-950 to-neutral-950 text-rose-200 border-rose-500/20',
  'from-emerald-900 via-teal-950 to-neutral-950 text-emerald-200 border-emerald-500/20',
  'from-amber-900 via-stone-950 to-neutral-950 text-amber-200 border-amber-500/20',
  'from-violet-900 via-fuchsia-950 to-neutral-950 text-fuchsia-200 border-fuchsia-500/20',
  'from-blue-900 via-slate-950 to-neutral-950 text-blue-200 border-blue-500/20',
];

/**
 * Extracts clean initials/short-form text from a playlist name.
 * e.g. "STUXS Select" -> "SS", "Late Night Tokyo" -> "LNT", "Workout" -> "WO"
 */
export const getPlaylistInitials = (name: string): string => {
  if (!name || !name.trim()) return 'PL';
  const clean = name.replace(/[^a-zA-Z0-9\s]/g, '').trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'PL';
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return words.slice(0, 3).map((w) => w[0].toUpperCase()).join('');
};

/**
 * Generates a deterministic gradient palette index based on playlist name/ID.
 */
export const getPlaylistPaletteIndex = (seed: string): number => {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % GRADIENT_PALETTES.length;
};

/**
 * Determines the effective cover artwork URL for a playlist following the priority:
 * 1. Custom cover (customArtworkUrl)
 * 2. First song's artwork
 * 3. Existing non-default artworkUrl
 * 4. Empty string (triggers fallback initials)
 */
export const resolvePlaylistCoverUrl = (playlist: Playlist): string => {
  if (playlist.customArtworkUrl) {
    return playlist.customArtworkUrl;
  }
  if (playlist.songs && playlist.songs.length > 0 && playlist.songs[0].artworkUrl) {
    return playlist.songs[0].artworkUrl;
  }
  if (
    playlist.artworkUrl &&
    !playlist.artworkUrl.includes('placeholder') &&
    !playlist.artworkUrl.includes('unsplash.com/photo-1514525253161')
  ) {
    return playlist.artworkUrl;
  }
  return '';
};

export const PlaylistCover: React.FC<PlaylistCoverProps> = ({
  playlist,
  className = '',
  imageClassName = '',
}) => {
  const [imageError, setImageError] = useState(false);
  const coverUrl = resolvePlaylistCoverUrl(playlist);
  const initials = getPlaylistInitials(playlist.name);
  const palette = GRADIENT_PALETTES[getPlaylistPaletteIndex(playlist.id || playlist.name)];

  if (coverUrl && !imageError) {
    return (
      <img
        src={coverUrl}
        alt={playlist.name}
        onError={() => setImageError(true)}
        className={`w-full h-full object-cover pointer-events-none ${imageClassName}`}
        loading="lazy"
      />
    );
  }

  // Deterministic STUXS initials gradient fallback
  return (
    <div
      className={`w-full h-full flex flex-col items-center justify-center bg-gradient-to-br ${palette} select-none relative overflow-hidden border ${className}`}
    >
      <div className="absolute inset-0 bg-radial-vignette opacity-50 pointer-events-none" />
      <span className="relative z-10 font-extrabold tracking-wider text-xl sm:text-2xl drop-shadow-md">
        {initials}
      </span>
      <div className="absolute bottom-2 left-0 right-0 text-center px-2">
        <span className="text-[9px] font-bold uppercase tracking-widest text-white/40 truncate block">
          Playlist
        </span>
      </div>
    </div>
  );
};
