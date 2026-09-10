import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ChevronLeft,
  Play,
  Shuffle,
  BadgeCheck,
  Share2,
  Users,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { artistService, type ResolvedArtistData } from '../services/ArtistService';
import { TrackRow } from '../components/common/TrackRow';
import { AlbumCard } from '../components/common/AlbumCard';
import { usePlayerActions } from '../context/PlayerContext';
import { ArtistScreenSkeleton } from '../components/common/SkeletonLoader';
import { ErrorState } from '../components/common/ErrorState';
import { EmptyState } from '../components/common/EmptyState';
import { BRANDING_CONFIG } from '../config/branding';

interface ArtistScreenProps {
  artistId: string;
  onBack: () => void;
  onSelectAlbum: (albumId?: string) => void;
  onSelectArtist: (artistId: string) => void;
}

const INITIAL_TRACK_LIMIT = 5;

export const ArtistScreen: React.FC<ArtistScreenProps> = ({
  artistId,
  onBack,
  onSelectAlbum,
}) => {
  const { playTrack } = usePlayerActions();
  const [data, setData] = useState<ResolvedArtistData | null>(() => artistService.getCached(artistId));
  const [isLoading, setIsLoading] = useState(() => !artistService.getCached(artistId));
  const [isFollowing, setIsFollowing] = useState(false);
  const [showAllTracks, setShowAllTracks] = useState(false);
  const [isBioExpanded, setIsBioExpanded] = useState(false);
  const [showStickyHeader, setShowStickyHeader] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  const loadArtist = useCallback(async () => {
    setIsLoading(true);
    try {
      const resolved = await artistService.getArtistData(artistId);
      setData(resolved);
    } catch (err) {
      console.warn('[ArtistScreen] Failed to load artist data:', err);
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [artistId]);

  useEffect(() => {
    let isMounted = true;
    const cached = artistService.getCached(artistId);
    if (cached) {
      setData(cached);
      setIsLoading(false);
    } else {
      setIsLoading(true);
      artistService.getArtistData(artistId).then((resolved) => {
        if (isMounted) {
          setData(resolved);
          setIsLoading(false);
        }
      });
    }

    return () => {
      isMounted = false;
    };
  }, [artistId]);

  // Lightweight scroll listener to toggle sticky mini-header (boolean only, zero RAF)
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const scrollTop = e.currentTarget.scrollTop;
    const shouldShow = scrollTop > 240;
    setShowStickyHeader((prev) => (prev !== shouldShow ? shouldShow : prev));
  };

  const handlePlayAll = () => {
    if (data && data.popularTracks.length > 0) {
      playTrack(data.popularTracks[0], data.popularTracks, {
        source: 'artist',
        id: data.artist.id,
        name: data.artist.name,
      });
    }
  };

  const handleShuffle = () => {
    if (data && data.popularTracks.length > 0) {
      playTrack(data.popularTracks[0], data.popularTracks, {
        source: 'artist',
        id: data.artist.id,
        name: data.artist.name,
        shuffle: true,
      });
    }
  };

  const handleShare = async () => {
    if (!data?.artist?.name) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({
          title: data.artist.name,
          text: `Listen to ${data.artist.name} on STUXS Music`,
          url: window.location.href,
        });
      }
    } catch {
      // Ignored or dismissed share
    }
  };

  const formatListeners = (num?: number) => {
    if (!num || num <= 0) return null;
    if (num >= 10000000) return `${(num / 10000000).toFixed(1)} Cr Listeners`;
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M Listeners`;
    if (num >= 1000) return `${(num / 1000).toFixed(0)}K Listeners`;
    return `${num.toLocaleString()} Listeners`;
  };

  if (isLoading && !data) {
    return <ArtistScreenSkeleton />;
  }

  if (!data || !data.artist) {
    return (
      <div className="p-5 pt-12 min-h-screen bg-stuxs-bg">
        <button
          onClick={onBack}
          className="p-2 rounded-full bg-stuxs-surface mb-4 text-stuxs-text hover:bg-stuxs-surface-secondary active:scale-95 transition-all cursor-pointer"
          aria-label="Back"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <ErrorState
          title="Artist Unavailable"
          message="Could not load information for this artist. Please check your connection and try again."
          onRetry={loadArtist}
        />
      </div>
    );
  }

  const { artist, popularTracks, albums, singles } = data;
  const displayedTracks = showAllTracks ? popularTracks : popularTracks.slice(0, INITIAL_TRACK_LIMIT);

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="relative min-h-screen h-full overflow-y-auto bg-stuxs-bg animate-in fade-in duration-200"
    >
      {/* Lightweight Sticky Mini-Header on Scroll */}
      <div
        className={`fixed top-0 left-0 right-0 z-40 safe-top-header px-4 py-2.5 bg-stuxs-bg/98 border-b border-stuxs-border/40 transition-all duration-200 flex items-center justify-between ${
          showStickyHeader ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 -translate-y-2 pointer-events-none'
        }`}
      >
        <div className="flex items-center space-x-3 min-w-0">
          <button
            onClick={onBack}
            className="w-8 h-8 rounded-full bg-stuxs-surface-secondary text-stuxs-text flex items-center justify-center active:scale-95 transition-transform cursor-pointer"
            aria-label="Back"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center space-x-1.5 truncate">
            <span className="font-bold text-sm text-stuxs-text truncate">{artist.name}</span>
            {artist.isVerified === true && (
              <BadgeCheck className="w-4 h-4 text-purple-500 shrink-0" />
            )}
          </div>
        </div>

        {popularTracks.length > 0 && (
          <button
            onClick={handlePlayAll}
            className="w-8 h-8 rounded-full bg-purple-600 text-white flex items-center justify-center shadow-sm active:scale-95 transition-transform cursor-pointer shrink-0"
            aria-label={`Play ${artist.name}`}
          >
            <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
          </button>
        )}
      </div>

      {/* Hero Header Banner */}
      <div className="relative h-72 sm:h-80 w-full overflow-hidden bg-stuxs-surface-secondary">
        <img
          src={artist.artworkUrl || BRANDING_CONFIG.defaultArtwork}
          alt={artist.name}
          className="w-full h-full object-cover"
          loading="lazy"
          onError={(e) => {
            const target = e.currentTarget;
            if (!target.dataset.fallbackApplied) {
              target.dataset.fallbackApplied = 'true';
              target.src = BRANDING_CONFIG.defaultArtwork;
            }
          }}
        />
        {/* Subtle gradient vignette for text legibility */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-black/40" />

        {/* Floating Back & Share Controls */}
        <div className="absolute safe-top-floating left-5 right-5 z-20 flex items-center justify-between">
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-full bg-black/45 hover:bg-black/65 text-white flex items-center justify-center active:scale-95 transition-all shadow-sm cursor-pointer"
            aria-label="Back"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            onClick={handleShare}
            className="w-9 h-9 rounded-full bg-black/45 hover:bg-black/65 text-white flex items-center justify-center active:scale-95 transition-all shadow-sm cursor-pointer"
            aria-label="Share Artist"
          >
            <Share2 className="w-4 h-4" />
          </button>
        </div>

        {/* Hero Metadata */}
        <div className="absolute bottom-10 left-5 right-5 z-20 space-y-1">
          {artist.isVerified === true && (
            <div className="inline-flex items-center space-x-1 text-[11px] font-bold text-purple-200 bg-purple-900/60 px-2.5 py-0.5 rounded-full border border-purple-400/30">
              <BadgeCheck className="w-3.5 h-3.5 text-purple-300" />
              <span>Verified Artist</span>
            </div>
          )}
          <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight drop-shadow-md truncate">
            {artist.name}
          </h1>
          {artist.monthlyListeners ? (
            <div className="flex items-center space-x-1.5 text-xs font-semibold text-white/85">
              <Users className="w-3.5 h-3.5 opacity-80" />
              <span>{formatListeners(artist.monthlyListeners)}</span>
            </div>
          ) : null}
        </div>
      </div>

      {/* Main Content Sheet */}
      <div className="rounded-t-[32px] sm:rounded-t-[36px] -mt-6 relative z-10 bg-stuxs-bg min-h-[60vh] px-4 sm:px-5 pt-5 pb-32 shadow-xl space-y-6">
        {/* Action Bar (Play All, Shuffle, Follow, Genres) */}
        <div className="flex items-center justify-between pb-3 border-b border-stuxs-border/30">
          <div className="flex items-center space-x-2.5 sm:space-x-3">
            {/* Play All Button */}
            <button
              onClick={handlePlayAll}
              disabled={popularTracks.length === 0}
              className="w-12 h-12 rounded-full bg-purple-600 hover:bg-purple-500 text-white flex items-center justify-center shadow-md hover:scale-105 active:scale-95 transition-transform disabled:opacity-40 cursor-pointer"
              aria-label={`Play popular tracks by ${artist.name}`}
            >
              <Play className="w-5 h-5 fill-current ml-0.5" />
            </button>

            {/* Shuffle Button */}
            <button
              onClick={handleShuffle}
              disabled={popularTracks.length === 0}
              className="w-10 h-10 rounded-full bg-stuxs-surface-secondary text-stuxs-text hover:bg-stuxs-surface flex items-center justify-center active:scale-95 transition-all disabled:opacity-40 cursor-pointer"
              aria-label="Shuffle artist tracks"
            >
              <Shuffle className="w-4 h-4" />
            </button>

            {/* Follow Button */}
            <button
              onClick={() => setIsFollowing(!isFollowing)}
              className={`px-4 py-2 rounded-full text-xs font-bold transition-all active:scale-95 cursor-pointer shadow-xs ${
                isFollowing
                  ? 'bg-stuxs-surface-secondary text-stuxs-text border border-stuxs-border/40'
                  : 'bg-purple-600 text-white hover:bg-purple-500 shadow-sm'
              }`}
              aria-label={isFollowing ? `Unfollow ${artist.name}` : `Follow ${artist.name}`}
            >
              {isFollowing ? 'Following' : 'Follow'}
            </button>
          </div>

          {/* Real Genres if present */}
          {artist.genres && artist.genres.length > 0 && (
            <span className="text-[11px] font-semibold text-purple-600 dark:text-purple-400 max-w-[140px] truncate text-right">
              {artist.genres.slice(0, 2).join(' • ')}
            </span>
          )}
        </div>

        {/* Popular Tracks Section */}
        <div>
          <div className="pb-2.5 flex items-center justify-between">
            <h2 className="text-lg font-bold text-stuxs-text tracking-tight">Popular Tracks</h2>
            {popularTracks.length > INITIAL_TRACK_LIMIT && (
              <button
                onClick={() => setShowAllTracks(!showAllTracks)}
                className="text-xs font-semibold text-purple-600 dark:text-purple-400 hover:underline cursor-pointer flex items-center space-x-0.5"
              >
                <span>{showAllTracks ? 'Show Less' : `See All (${popularTracks.length})`}</span>
                {showAllTracks ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            )}
          </div>

          {popularTracks.length === 0 ? (
            <EmptyState
              title="No Tracks Available"
              description="No playable tracks currently listed for this artist."
            />
          ) : (
            <div className="space-y-1">
              {displayedTracks.map((track, idx) => (
                <TrackRow
                  key={track.id}
                  track={track}
                  index={idx}
                  showIndex={true}
                  context="artist"
                  playlistContext={popularTracks}
                  onSelectAlbum={onSelectAlbum}
                />
              ))}
            </div>
          )}
        </div>

        {/* Albums Section */}
        {albums.length > 0 && (
          <div>
            <div className="pb-3">
              <h2 className="text-lg font-bold text-stuxs-text tracking-tight">Albums</h2>
            </div>
            <div className="flex space-x-3.5 overflow-x-auto pb-2 scrollbar-none">
              {albums.map((album) => (
                <AlbumCard
                  key={album.id}
                  album={album}
                  size="normal"
                  onSelect={(id) => onSelectAlbum(id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Singles & EPs Section (Only rendered if legitimate provider albumType metadata exists) */}
        {singles.length > 0 && (
          <div>
            <div className="pb-3">
              <h2 className="text-lg font-bold text-stuxs-text tracking-tight">Singles & EPs</h2>
            </div>
            <div className="flex space-x-3.5 overflow-x-auto pb-2 scrollbar-none">
              {singles.map((single) => (
                <AlbumCard
                  key={single.id}
                  album={single}
                  size="normal"
                  onSelect={(id) => onSelectAlbum(id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Biography / About Section (Only rendered if genuine bio metadata exists) */}
        {artist.bio && artist.bio.trim().length > 0 && (
          <div className="pb-4">
            <h2 className="text-lg font-bold text-stuxs-text tracking-tight mb-2">About</h2>
            <div className="p-4 rounded-2xl bg-stuxs-surface-secondary/40 border border-stuxs-border/40 shadow-xs">
              <p
                className={`text-xs text-stuxs-text-secondary leading-relaxed whitespace-pre-line ${
                  !isBioExpanded ? 'line-clamp-4' : ''
                }`}
              >
                {artist.bio}
              </p>
              {artist.bio.length > 200 && (
                <button
                  onClick={() => setIsBioExpanded(!isBioExpanded)}
                  className="mt-2 text-xs font-semibold text-purple-600 dark:text-purple-400 hover:underline cursor-pointer"
                >
                  {isBioExpanded ? 'Read Less' : 'Read More'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ArtistScreen;
