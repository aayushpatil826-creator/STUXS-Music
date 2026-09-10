import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ChevronLeft,
  Play,
  Shuffle,
  Share2,
  Clock,
  Disc,
} from 'lucide-react';
import { albumService, type ResolvedAlbumData } from '../services/AlbumService';
import { TrackRow } from '../components/common/TrackRow';
import { usePlayerActions } from '../context/PlayerContext';
import { AlbumScreenSkeleton } from '../components/common/SkeletonLoader';
import { ErrorState } from '../components/common/ErrorState';
import { EmptyState } from '../components/common/EmptyState';
import { BRANDING_CONFIG } from '../config/branding';

interface AlbumScreenProps {
  albumId: string;
  onBack: () => void;
  onSelectArtist: (artistId: string) => void;
}

export const AlbumScreen: React.FC<AlbumScreenProps> = ({
  albumId,
  onBack,
  onSelectArtist,
}) => {
  const { playTrack } = usePlayerActions();
  const [data, setData] = useState<ResolvedAlbumData | null>(() => albumService.getCached(albumId));
  const [isLoading, setIsLoading] = useState(() => !albumService.getCached(albumId));
  const [showStickyHeader, setShowStickyHeader] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  const loadAlbum = useCallback(async () => {
    setIsLoading(true);
    try {
      const resolved = await albumService.getAlbumData(albumId);
      setData(resolved);
    } catch (err) {
      console.warn('[AlbumScreen] Failed to load album data:', err);
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [albumId]);

  useEffect(() => {
    let isMounted = true;
    const cached = albumService.getCached(albumId);
    if (cached) {
      setData(cached);
      setIsLoading(false);
    } else {
      setIsLoading(true);
      albumService.getAlbumData(albumId).then((resolved) => {
        if (isMounted) {
          setData(resolved);
          setIsLoading(false);
        }
      });
    }

    return () => {
      isMounted = false;
    };
  }, [albumId]);

  // Lightweight scroll listener to toggle sticky mini-header (boolean state only, zero RAF)
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const scrollTop = e.currentTarget.scrollTop;
    const shouldShow = scrollTop > 220;
    setShowStickyHeader((prev) => (prev !== shouldShow ? shouldShow : prev));
  };

  const handlePlayAll = () => {
    if (data && data.tracks.length > 0) {
      playTrack(data.tracks[0], data.tracks, {
        source: 'album',
        id: data.album.id,
        name: data.album.title,
      });
    }
  };

  const handleShufflePlay = () => {
    if (data && data.tracks.length > 0) {
      playTrack(data.tracks[0], data.tracks, {
        source: 'album',
        id: data.album.id,
        name: data.album.title,
        shuffle: true,
      });
    }
  };

  const handleShare = async () => {
    if (!data?.album?.title) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({
          title: data.album.title,
          text: `Listen to ${data.album.title} by ${data.album.artistName} on STUXS Music`,
          url: window.location.href,
        });
      }
    } catch {
      // Ignored or dismissed share
    }
  };

  const formatTotalTime = (seconds?: number) => {
    if (!seconds || seconds <= 0) return '';
    const mins = Math.floor(seconds / 60);
    if (mins < 60) return `${mins} min`;
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return remMins > 0 ? `${hrs} hr ${remMins} min` : `${hrs} hr`;
  };

  if (isLoading && !data) {
    return <AlbumScreenSkeleton />;
  }

  if (!data || !data.album) {
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
          title="Album Unavailable"
          message="Could not load information for this album. Please check your connection and try again."
          onRetry={loadAlbum}
        />
      </div>
    );
  }

  const { album, tracks, discs, totalDuration } = data;
  const releaseYear = album.releaseDate ? String(album.releaseDate).slice(0, 4) : '';

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
            className="w-8 h-8 rounded-full bg-stuxs-surface-secondary text-stuxs-text flex items-center justify-center active:scale-95 transition-transform cursor-pointer shrink-0"
            aria-label="Back"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="truncate">
            <span className="font-bold text-sm text-stuxs-text truncate block">{album.title}</span>
            <span className="text-xs text-stuxs-text-muted truncate block">{album.artistName}</span>
          </div>
        </div>

        {tracks.length > 0 && (
          <button
            onClick={handlePlayAll}
            className="w-8 h-8 rounded-full bg-purple-600 text-white flex items-center justify-center shadow-sm active:scale-95 transition-transform cursor-pointer shrink-0"
            aria-label={`Play ${album.title}`}
          >
            <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
          </button>
        )}
      </div>

      {/* Top Floating Navigation */}
      <div className="sticky top-0 z-30 px-5 safe-top-header pb-3 bg-stuxs-bg/98 border-b border-stuxs-border/40 flex items-center justify-between">
        <button
          onClick={onBack}
          className="w-9 h-9 rounded-full bg-stuxs-surface-secondary text-stuxs-text flex items-center justify-center active:scale-95 transition-all shadow-xs cursor-pointer"
          aria-label="Back"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <span className="text-xs font-bold uppercase tracking-wider text-stuxs-text-muted">
          {album.albumType ? album.albumType.toUpperCase() : 'ALBUM'}
        </span>
        <button
          onClick={handleShare}
          className="w-9 h-9 rounded-full bg-stuxs-surface-secondary text-stuxs-text flex items-center justify-center active:scale-95 transition-all shadow-xs cursor-pointer"
          aria-label="Share Album"
        >
          <Share2 className="w-4 h-4" />
        </button>
      </div>

      {/* Album Hero Info */}
      <div className="flex flex-col items-center text-center px-6 pt-4 pb-6">
        {/* Large Album Artwork */}
        <div className="w-52 h-52 sm:w-60 sm:h-60 rounded-[28px] overflow-hidden shadow-2xl mb-5 ring-1 ring-black/5 dark:ring-white/10 aspect-square bg-stuxs-surface-secondary">
          <img
            src={album.artworkUrl || BRANDING_CONFIG.defaultArtwork}
            alt={album.title}
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
        </div>

        <h1 className="text-2xl sm:text-3xl font-black text-stuxs-text tracking-tight max-w-sm drop-shadow-xs">
          {album.title}
        </h1>

        <button
          onClick={() => onSelectArtist(album.artistId)}
          className="text-sm font-semibold text-purple-600 dark:text-purple-400 mt-1 hover:underline cursor-pointer transition-colors"
          aria-label={`View artist ${album.artistName}`}
        >
          {album.artistName}
        </button>

        {/* Metadata Line */}
        <p className="text-xs font-medium text-stuxs-text-muted mt-1.5 flex items-center justify-center flex-wrap gap-1.5">
          {album.genre && <span>{album.genre}</span>}
          {releaseYear && <span>• {releaseYear}</span>}
          <span>• {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}</span>
          {totalDuration > 0 && <span>• {formatTotalTime(totalDuration)}</span>}
        </p>

        {/* Action Controls: Play & Shuffle */}
        <div className="flex items-center space-x-3.5 mt-5">
          <button
            onClick={handlePlayAll}
            disabled={tracks.length === 0}
            className="flex items-center space-x-2 px-6 py-3 rounded-full bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs shadow-md hover:scale-105 active:scale-95 transition-all disabled:opacity-40 cursor-pointer"
            aria-label={`Play album ${album.title}`}
          >
            <Play className="w-4 h-4 fill-current ml-0.5" />
            <span>Play</span>
          </button>

          <button
            onClick={handleShufflePlay}
            disabled={tracks.length === 0}
            className="w-11 h-11 rounded-full bg-stuxs-surface-secondary text-stuxs-text hover:bg-stuxs-surface active:scale-95 transition-all flex items-center justify-center shadow-xs disabled:opacity-40 cursor-pointer"
            aria-label="Shuffle Album"
          >
            <Shuffle className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Track List Sheet */}
      <div className="rounded-t-[32px] sm:rounded-t-[36px] bg-[#FAF8F5] dark:bg-[#121218] min-h-[50vh] px-4 sm:px-5 pt-5 pb-36 shadow-xl transition-colors space-y-4">
        <div className="pb-2 flex items-center justify-between text-xs font-semibold text-stuxs-text-muted border-b border-stuxs-border/30">
          <span># TITLE</span>
          <Clock className="w-3.5 h-3.5 mr-6" />
        </div>

        {tracks.length === 0 ? (
          <EmptyState
            title="No Playable Tracks"
            description="No playable tracks currently available for this album."
          />
        ) : discs && discs.length >= 2 ? (
          // Multi-disc rendering
          <div className="space-y-6">
            {discs.map((disc) => (
              <div key={`disc-${disc.discNumber}`} className="space-y-2">
                <div className="flex items-center space-x-2 text-xs font-bold text-stuxs-text-muted uppercase tracking-wider py-1 px-1">
                  <Disc className="w-3.5 h-3.5 text-purple-500" />
                  <span>Disc {disc.discNumber}</span>
                </div>
                <div className="space-y-1">
                  {disc.tracks.map((track, idx) => (
                    <TrackRow
                      key={track.id}
                      track={track}
                      index={idx}
                      showIndex={true}
                      showArtwork={false}
                      context="album"
                      playlistContext={tracks}
                      onSelectArtist={onSelectArtist}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          // Single disc rendering
          <div className="space-y-1">
            {tracks.map((track, idx) => (
              <TrackRow
                key={track.id}
                track={track}
                index={idx}
                showIndex={true}
                showArtwork={false}
                context="album"
                playlistContext={tracks}
                onSelectArtist={onSelectArtist}
              />
            ))}
          </div>
        )}

        {/* Album Label / Copyright metadata if genuinely present */}
        {(album.label || album.copyrightText) && (
          <div className="pt-6 pb-2 text-[11px] text-stuxs-text-muted space-y-1 border-t border-stuxs-border/20 mt-6 px-1">
            {album.releaseDate && (
              <p>{album.releaseDate}</p>
            )}
            {album.copyrightText && (
              <p>{album.copyrightText}</p>
            )}
            {album.label && !album.copyrightText?.includes(album.label) && (
              <p>© {album.label}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default AlbumScreen;
