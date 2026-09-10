import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronDown,
  MoreVertical,
  Sparkles,
  Heart,
  FolderPlus,
  ListPlus,
  ListMusic,
  Mic2,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import {
  PlayerShuffleIcon,
  PlayerPreviousIcon,
  PlayerPlayIcon,
  PlayerPauseIcon,
  PlayerNextIcon,
  PlayerRepeatIcon,
} from './PlayerIcons';
import { usePlayer } from '../../context/PlayerContext';
import { useLibrary } from '../../context/LibraryContext';
import { useSettings } from '../../context/SettingsContext';
import { useToast } from '../../context/ToastContext';
import type { Track } from '../../types/music';
import { resolveActiveStreamQuality } from '../../utils/audioQuality';
import { extractArtworkColor, DEFAULT_STUXS_COLOR } from '../../utils/artworkColor';
import { ProgressBar } from './ProgressBar';
import { QueueDrawer } from './QueueDrawer';
import { LyricsSheet } from './LyricsSheet';
import { AddToPlaylistSheet } from '../modals/AddToPlaylistSheet';
import { TrackActionMenu } from '../common/TrackActionMenu';
import { PlaybackDiagnosticsModal } from '../modals/PlaybackDiagnosticsModal';
import { backButtonManager } from '../../services/backButtonManager';
import { BRANDING_CONFIG } from '../../config/branding';

interface NowPlayingModalProps {
  onSelectArtist?: (artistId: string) => void;
  onSelectAlbum?: (albumId?: string) => void;
}


export const NowPlayingModal: React.FC<NowPlayingModalProps> = ({
  onSelectArtist,
}) => {
  const {
    currentTrack,
    isPlaying,
    isLoadingTrack,
    togglePlay,
    seek,
    nextTrack,
    prevTrack,
    queue,
    queueIndex,
    playTrack,
    isShuffled,
    toggleShuffle,
    repeatMode,
    cycleRepeatMode,
    smartQueueEnabled,
    toggleSmartQueue,
    isNowPlayingOpen,
    setIsNowPlayingOpen,
    setIsQueueOpen,
    addToQueue,
  } = usePlayer();

  const { isFavorite, toggleFavorite } = useLibrary();
  const { appearance } = useSettings();
  const { showToast } = useToast();

  const [isLyricsSheetOpen, setIsLyricsSheetOpen] = useState(false);
  const [heartAnimated, setHeartAnimated] = useState(false);
  const [isAddToPlaylistOpen, setIsAddToPlaylistOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);

  // Stable track fallback to keep modal mounted during track transitions
  const lastTrackRef = useRef<Track | null>(null);
  if (currentTrack) {
    lastTrackRef.current = currentTrack;
  }
  const displayTrack = currentTrack || lastTrackRef.current;

  // Artwork dynamic background color extraction
  const [artworkRgb, setArtworkRgb] = useState<[number, number, number]>(DEFAULT_STUXS_COLOR);

  useEffect(() => {
    let isMounted = true;
    if (displayTrack?.artworkUrl) {
      extractArtworkColor(displayTrack.artworkUrl, displayTrack.title).then((rgb) => {
        if (isMounted) setArtworkRgb(rgb);
      });
    } else {
      setArtworkRgb(DEFAULT_STUXS_COLOR);
    }
    return () => {
      isMounted = false;
    };
  }, [displayTrack?.artworkUrl, displayTrack?.title]);

  // Track previous artwork URL to prevent any white flash during track transitions
  const [previousArtwork, setPreviousArtwork] = useState<string | null>(null);
  const currentArtworkUrl = displayTrack?.artworkUrl;

  useEffect(() => {
    if (currentArtworkUrl) {
      const timer = setTimeout(() => {
        setPreviousArtwork(currentArtworkUrl);
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [currentArtworkUrl]);

  // Stable handler for closing lyrics sheet
  const handleCloseLyrics = useCallback(() => {
    setIsLyricsSheetOpen(false);
  }, []);

  // Theme detection
  const isDark = useMemo(() => {
    if (appearance.themeMode === 'system') {
      return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return appearance.themeMode !== 'light';
  }, [appearance.themeMode]);

  // Atmosphere behind upper artwork zone — synchronized with Home Screen header's soft lavender/periwinkle palette
  const backgroundStyle = useMemo<React.CSSProperties>(() => {
    const [r, g, b] = artworkRgb;

    if (isDark) {
      // Dark mode: Deep lavender/periwinkle atmosphere (matching Home dark header #1E1138 / #140C24)
      return {
        backgroundColor: '#130E20',
        backgroundImage: `radial-gradient(ellipse 130% 80% at 50% 28%, rgba(${r}, ${g}, ${b}, 0.28) 0%, rgba(30, 17, 56, 0.75) 48%, #130E20 100%)`,
      };
    }

    // Light mode: Soft pastel lavender/periwinkle tone (matching Home light header #EBE2F5 / #ECE6F5)
    // Artwork color radiates as a soft 20% tint at the core, seamlessly fading into the airy lavender/periwinkle background
    return {
      backgroundColor: '#EAE2F3',
      backgroundImage: `radial-gradient(ellipse 130% 80% at 50% 28%, rgba(${r}, ${g}, ${b}, 0.20) 0%, rgba(235, 226, 246, 0.85) 50%, #E8E0F2 100%)`,
    };
  }, [artworkRgb, isDark]);

  // Active stream quality
  const streamQuality = useMemo(() => resolveActiveStreamQuality(displayTrack), [displayTrack]);

  const modalRef = useRef<HTMLDivElement>(null);
  const atmosphereRef = useRef<HTMLDivElement>(null);
  const topBarRef = useRef<HTMLElement>(null);
  const mainBodyRef = useRef<HTMLDivElement>(null);
  const heroArtworkCardRef = useRef<HTMLDivElement>(null);
  const artworkGlowRef = useRef<HTMLDivElement>(null);
  const playerSurfaceRef = useRef<HTMLDivElement>(null);

  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isClosingRef = useRef<boolean>(false);
  const touchStartY = useRef<number>(0);
  const isDraggingRef = useRef<boolean>(false);
  const currentTranslationYRef = useRef<number>(0);
  const touchSamples = useRef<{ y: number; time: number }[]>([]);
  const prevOpenRef = useRef<boolean>(false);

  // Instantly purge modal sheet layers and reset geometry (e.g. on tab switch)
  const cancelAndDismissModalImmediately = useCallback(() => {
    if (transitionTimerRef.current) {
      clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }
    isClosingRef.current = false;
    prevOpenRef.current = false;

    const modal = modalRef.current;
    if (modal) {
      modal.style.transition = 'none';
      modal.style.display = 'none';
      modal.style.visibility = 'hidden';
      modal.style.transform = 'translate3d(0, 100%, 0)';
      modal.style.pointerEvents = 'none';
    }
    currentTranslationYRef.current = 0;
    setIsNowPlayingOpen(false);
    setIsLyricsSheetOpen(false);
  }, [setIsNowPlayingOpen]);

  // Full Player Vertical Sheet Transition (Opening: translateY(100%) -> translateY(0))
  const runOpeningTransition = useCallback(() => {
    if (transitionTimerRef.current) {
      clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }
    isClosingRef.current = false;

    const modal = modalRef.current;
    if (!modal) return;

    // Reset starting state off-screen at bottom
    modal.style.display = 'flex';
    modal.style.visibility = 'visible';
    modal.style.pointerEvents = 'auto';
    modal.style.transition = 'none';
    modal.style.transform = 'translate3d(0, 100%, 0)';

    // Force layout reflow before triggering transition
    void modal.offsetHeight;

    // Premium spring-like vertical rise (~340ms)
    modal.style.transition = 'transform 340ms cubic-bezier(0.16, 1, 0.3, 1)';
    modal.style.transform = 'translate3d(0, 0, 0)';

    transitionTimerRef.current = setTimeout(() => {
      if (modal) {
        modal.style.transition = '';
      }
      transitionTimerRef.current = null;
    }, 340);
  }, []);

  // Full Player Vertical Sheet Transition (Closing: translateY(0) -> translateY(100%))
  const runClosingTransition = useCallback((dragOffsetY: number = 0) => {
    if (isClosingRef.current) return;
    if (transitionTimerRef.current) {
      clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }
    isClosingRef.current = true;

    const modal = modalRef.current;
    if (!modal) {
      prevOpenRef.current = false;
      setIsNowPlayingOpen(false);
      setIsLyricsSheetOpen(false);
      isClosingRef.current = false;
      return;
    }

    modal.style.pointerEvents = 'none';

    // If dismissed via swipe drag, start seamlessly from released drag position; else start from resting (0)
    if (dragOffsetY > 0) {
      modal.style.transition = 'none';
      modal.style.transform = `translate3d(0, ${dragOffsetY}px, 0)`;
    } else {
      modal.style.transition = 'none';
      modal.style.transform = 'translate3d(0, 0, 0)';
    }

    void modal.offsetHeight;

    // Premium smooth slide down (~280ms)
    modal.style.transition = 'transform 280ms cubic-bezier(0.2, 0, 0, 1)';
    modal.style.transform = 'translate3d(0, 100%, 0)';

    transitionTimerRef.current = setTimeout(() => {
      if (modal) {
        modal.style.display = 'none';
        modal.style.visibility = 'hidden';
        modal.style.transition = '';
        modal.style.transform = 'translate3d(0, 100%, 0)';
      }
      currentTranslationYRef.current = 0;
      prevOpenRef.current = false;
      setIsNowPlayingOpen(false);
      setIsLyricsSheetOpen(false);
      isClosingRef.current = false;
      transitionTimerRef.current = null;
    }, 280);
  }, [setIsNowPlayingOpen]);

  const handleClose = useCallback(() => {
    runClosingTransition(0);
  }, [runClosingTransition]);

  // Synchronize opening/closing transitions when isNowPlayingOpen changes
  useEffect(() => {
    if (isNowPlayingOpen && !prevOpenRef.current) {
      runOpeningTransition();
    } else if (!isNowPlayingOpen && prevOpenRef.current && !isClosingRef.current) {
      runClosingTransition();
    }
    prevOpenRef.current = isNowPlayingOpen;
  }, [isNowPlayingOpen, runOpeningTransition, runClosingTransition]);

  // Back button integration: closes lyrics sheet or closes modal
  useEffect(() => {
    if (!isNowPlayingOpen) return;

    return backButtonManager.register(
      'now-playing-modal',
      () => {
        if (isLyricsSheetOpen) {
          setIsLyricsSheetOpen(false);
        } else {
          handleClose();
        }
      },
      10
    );
  }, [isNowPlayingOpen, isLyricsSheetOpen, handleClose]);

  // Tab click listener with capture: purge and dismiss modal immediately if bottom nav tab button is clicked
  useEffect(() => {
    const handleGlobalTabClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('.liquid-glass-bottom-nav button')) {
        if (isClosingRef.current || isNowPlayingOpen) {
          cancelAndDismissModalImmediately();
        }
      }
    };
    window.addEventListener('click', handleGlobalTabClick, { capture: true });
    return () => window.removeEventListener('click', handleGlobalTabClick, { capture: true });
  }, [isNowPlayingOpen, cancelAndDismissModalImmediately]);

  // Touch gesture tracking for downward drag to dismiss
  const handleTouchStart = (e: React.TouchEvent) => {
    if (isClosingRef.current) return;
    const target = e.target as HTMLElement;
    const isTopBar = Boolean(target.closest('.now-playing-top-bar'));

    if (
      !isTopBar ||
      target.closest('button') ||
      target.closest('input') ||
      target.closest('a')
    ) {
      return;
    }

    if (transitionTimerRef.current) {
      clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }

    let currentY = currentTranslationYRef.current || 0;
    if (modalRef.current) {
      modalRef.current.style.transition = 'none';
    }

    const clientY = e.touches[0].clientY;
    touchStartY.current = clientY - currentY;
    currentTranslationYRef.current = currentY;
    isDraggingRef.current = true;
    touchSamples.current = [{ y: clientY, time: performance.now() }];
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDraggingRef.current) return;

    const clientY = e.touches[0].clientY;
    const now = performance.now();

    touchSamples.current.push({ y: clientY, time: now });
    if (touchSamples.current.length > 8) {
      touchSamples.current = touchSamples.current.filter((s) => now - s.time <= 120);
    }

    const rawDelta = clientY - touchStartY.current;
    // Clamp upward movement at 0
    const deltaY = Math.max(0, rawDelta);
    currentTranslationYRef.current = deltaY;

    if (modalRef.current && isDraggingRef.current) {
      modalRef.current.style.transform = `translate3d(0, ${deltaY}px, 0)`;
    }
  };

  const handleTouchEnd = () => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;

    const deltaY = currentTranslationYRef.current;
    const samples = touchSamples.current;
    let velocityY = 0;

    if (samples.length >= 2) {
      const first = samples[0];
      const last = samples[samples.length - 1];
      const dt = last.time - first.time;
      if (dt > 8) {
        velocityY = (last.y - first.y) / dt;
      }
    }

    const screenH = window.innerHeight;
    const projectedY = deltaY + velocityY * 160;
    const shouldDismiss = projectedY > screenH * 0.22 || (deltaY > 50 && velocityY > 0.3);

    if (modalRef.current) {
      if (shouldDismiss) {
        // Continue seamlessly from current dragged position directly into downward dismissal
        runClosingTransition(deltaY);
      } else {
        // Cancelled dismissal: spring the whole sheet back to translateY(0)
        modalRef.current.style.transition = 'transform 260ms cubic-bezier(0.16, 1, 0.3, 1)';
        modalRef.current.style.transform = 'translate3d(0, 0, 0)';
        currentTranslationYRef.current = 0;
      }
    }
  };

  const handleFavoriteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!displayTrack) return;
    setHeartAnimated(true);
    setTimeout(() => setHeartAnimated(false), 260);
    toggleFavorite(displayTrack);
  };

  const handleAddToPlaylist = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsAddToPlaylistOpen(true);
  };

  const handleAddToQueue = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!displayTrack) return;
    addToQueue(displayTrack);
    showToast('Added to queue', 'success');
  };

  const handleArtistClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentTrack || !onSelectArtist) return;
    const artistId = currentTrack.artistId || `artist-${encodeURIComponent(currentTrack.artistName)}`;
    if (artistId) {
      handleClose();
      onSelectArtist(artistId);
    }
  };

  if (!displayTrack) return null;

  const favorite = isFavorite(displayTrack.id);
  const nextQueuedTrack = queue && queueIndex + 1 < queue.length ? queue[queueIndex + 1] : null;

  return createPortal(
    <div
      ref={modalRef}
      id="stuxs-now-playing-modal"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className={`fixed inset-0 z-50 flex flex-col justify-start overflow-hidden select-none will-change-transform ${
        isDark ? 'text-white' : 'text-neutral-900'
      }`}
      style={{
        display: isNowPlayingOpen || isClosingRef.current ? 'flex' : 'none',
        visibility: isNowPlayingOpen || isClosingRef.current ? 'visible' : 'hidden',
        pointerEvents: isNowPlayingOpen && !isClosingRef.current ? 'auto' : 'none',
        transform: isNowPlayingOpen && !isClosingRef.current ? 'translate3d(0, 0, 0)' : 'translate3d(0, 100%, 0)',
        WebkitOverflowScrolling: 'touch',
        backfaceVisibility: 'hidden',
      }}
    >
      {/* Background Atmosphere Layer */}
      <div
        ref={atmosphereRef}
        className="absolute inset-0 z-0 pointer-events-none"
        style={backgroundStyle}
      />

      {/* Top Bar / Safe Area Header */}
      <header
        ref={topBarRef}
        className="now-playing-top-bar relative z-20 flex flex-col px-4 pb-1 flex-shrink-0 select-none will-change-transform"
        style={{ paddingTop: 'calc(max(env(safe-area-inset-top, 28px), 28px) + 0.25rem)' }}
      >
        {/* Swipe Pill Handle */}
        <div className={`w-10 h-1 rounded-full mx-auto mb-2 pointer-events-none ${isDark ? 'bg-white/30' : 'bg-black/20'}`} />

        <div className="flex items-center justify-between">
          <button
            onClick={handleClose}
            className={`w-10 h-10 rounded-full flex items-center justify-center active:scale-95 transition-all cursor-pointer ${
              isDark
                ? 'bg-black/25 hover:bg-black/35 text-white border border-white/15 backdrop-blur-md'
                : 'bg-white/80 hover:bg-white text-slate-800 border border-black/5 shadow-sm backdrop-blur-md'
            }`}
            aria-label="Collapse Now Playing"
          >
            <ChevronDown className={`w-5 h-5 ${isDark ? 'text-white' : 'text-slate-800'}`} />
          </button>

          {/* Empty center: NO text in middle to strictly match reference */}
          <div className="flex-1" />

          {/* More Options */}
          <div className="relative flex items-center">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsMenuOpen((prev) => !prev);
              }}
              className={`w-10 h-10 rounded-full flex items-center justify-center active:scale-95 transition-all cursor-pointer ${
                isDark
                  ? 'bg-black text-white hover:bg-neutral-900 border border-white/15 shadow-sm'
                  : 'bg-white/80 hover:bg-white text-slate-800 border border-black/5 shadow-sm'
              }`}
              aria-label="More Options"
            >
              <MoreVertical className={`w-5 h-5 ${isDark ? 'text-white' : 'text-slate-800'}`} />
            </button>

            <TrackActionMenu
              track={displayTrack}
              context="now-playing"
              isOpen={isMenuOpen}
              onClose={() => setIsMenuOpen(false)}
            />
          </div>
        </div>
      </header>

      {/* Main Scrollable Body */}
      <div
        ref={mainBodyRef}
        className="relative z-10 flex-1 overflow-y-auto scrollbar-none w-full flex flex-col justify-between"
      >
        {/* TOP ZONE: 1. Large Hero Album Artwork with Atmospheric Aura - Elevated to z-30 */}
        <div className="relative z-30 w-full flex flex-col items-center px-4 pt-1 pb-3 flex-shrink-0">
          {/* Ambient Artwork Glow Aura (softly radiating outward from edges into the lavender atmosphere) */}
          <div
            ref={artworkGlowRef}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[98%] max-w-[420px] aspect-square rounded-[38px] blur-2xl pointer-events-none transition-opacity duration-300 ease-out"
            style={{
              backgroundColor: `rgb(${artworkRgb[0]}, ${artworkRgb[1]}, ${artworkRgb[2]})`,
              opacity: isDark ? 0.35 : 0.20,
            }}
          />

          <div
            ref={heroArtworkCardRef}
            className="relative z-30 w-full max-w-[420px] aspect-square rounded-[28px] sm:rounded-[34px] overflow-hidden bg-black/10 shadow-2xl ring-1 ring-white/20 will-change-transform"
          >
            {/* Outgoing Artwork Underlay during crossfade to prevent any white flash */}
            {previousArtwork && previousArtwork !== displayTrack.artworkUrl && (
              <img
                src={previousArtwork}
                alt=""
                className="absolute inset-0 w-full h-full object-cover select-none pointer-events-none opacity-60"
              />
            )}
            <img
              key={displayTrack.id}
              src={displayTrack.artworkUrl || BRANDING_CONFIG.appLogo}
              alt={displayTrack.title}
              className="relative z-10 w-full h-full object-cover select-none animate-artwork-crossfade"
              loading="eager"
              onError={(e) => {
                const target = e.currentTarget;
                if (!target.dataset.fallbackApplied) {
                  target.dataset.fallbackApplied = 'true';
                  target.src = BRANDING_CONFIG.appLogo;
                }
              }}
            />
          </div>
        </div>

        {/* BOTTOM ZONE: 2. Large Rounded Cream/Light Player Surface - z-10 below Hero Artwork */}
        <div
          ref={playerSurfaceRef}
          className={`relative z-10 w-full flex-1 rounded-t-[36px] sm:rounded-t-[40px] px-5 pt-4 pb-6 flex flex-col justify-between transition-colors duration-300 will-change-transform ${
            isDark
              ? 'bg-[#121218] text-white shadow-[0_-12px_36px_rgba(0,0,0,0.5)] border-t border-white/10'
              : 'bg-[#FAF8F5] text-neutral-900 shadow-[0_-12px_36px_rgba(0,0,0,0.14)]'
          }`}
          style={{
            paddingBottom: 'calc(18px + env(safe-area-inset-bottom, 16px))',
          }}
        >
          {/* Quality Badge */}
          <div className="w-full flex justify-center mb-3 flex-shrink-0">
            <div
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold select-none truncate ${
                isDark
                  ? 'bg-white/[0.08] border border-white/10 text-white/80'
                  : 'bg-black/[0.05] border border-black/10 text-black/80'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 flex-shrink-0" />
              <span className="truncate uppercase tracking-wider">{streamQuality.label}</span>
            </div>
          </div>

          {/* Song Title + Artist & Action Icons Row */}
          <div className="w-full flex items-center justify-between gap-3 mb-2">
            <div className="min-w-0 flex-1">
              <h2
                key={`title-${displayTrack.id}`}
                className={`text-2xl font-extrabold tracking-tight truncate leading-tight ${
                  isDark ? 'text-white' : 'text-neutral-900'
                }`}
              >
                {displayTrack.title}
              </h2>
              <p
                key={`artist-${displayTrack.id}`}
                onClick={handleArtistClick}
                className={`text-sm font-medium truncate mt-0.5 cursor-pointer active:scale-95 transition-all ${
                  isDark
                    ? 'text-white/60 hover:text-white'
                    : 'text-black/60 hover:text-black'
                }`}
              >
                {displayTrack.artistName}
              </p>
            </div>

            {/* Action Icons: Like, Add to Playlist, Add to Queue */}
            <div
              className={`flex items-center gap-1.5 flex-shrink-0 ${
                isDark ? 'text-white/80' : 'text-neutral-800'
              }`}
            >
              {/* Heart / Favorite */}
              <button
                onClick={handleFavoriteClick}
                className={`p-2 rounded-full active:scale-90 transition-transform cursor-pointer ${
                  isDark ? 'hover:bg-white/10' : 'hover:bg-black/10'
                } ${heartAnimated ? 'animate-heart-pop' : ''}`}
                aria-label="Toggle Favorite"
              >
                <Heart
                  className={`w-5 h-5 transition-colors duration-200 ${
                    favorite
                      ? 'text-rose-500 fill-rose-500'
                      : isDark
                      ? 'hover:text-white'
                      : 'hover:text-black'
                  }`}
                />
              </button>

              {/* Add to Playlist */}
              <button
                onClick={handleAddToPlaylist}
                className={`p-2 rounded-full active:scale-90 transition-transform cursor-pointer ${
                  isDark
                    ? 'hover:bg-white/10 hover:text-white'
                    : 'hover:bg-black/10 hover:text-black'
                }`}
                aria-label="Add to Playlist"
              >
                <FolderPlus className="w-5 h-5" />
              </button>

              {/* Add to Queue */}
              <button
                onClick={handleAddToQueue}
                className={`p-2 rounded-full active:scale-90 transition-transform cursor-pointer ${
                  isDark
                    ? 'hover:bg-white/10 hover:text-white'
                    : 'hover:bg-black/10 hover:text-black'
                }`}
                aria-label="Add to Queue"
              >
                <ListPlus className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Progress Bar (Remaining Time on Top-Right) */}
          <div className="w-full mb-2">
            <ProgressBar
              onSeek={seek}
              showTimes={true}
              timePosition="top-right"
              alwaysShowThumb={true}
              timeDisplayMode="remaining"
              size="normal"
            />
          </div>

          {/* Playback Controls Row: Shuffle / Previous / Play-Pause / Next / Repeat */}
          <div className="w-full flex items-center justify-between px-2 mb-3">
            <button
              onClick={toggleShuffle}
              className={`p-2.5 rounded-full active:scale-90 transition-transform cursor-pointer ${
                isShuffled
                  ? 'text-purple-600 dark:text-purple-400'
                  : isDark
                  ? 'text-white/60 hover:text-white'
                  : 'text-black/60 hover:text-black'
              }`}
              aria-label="Shuffle"
            >
              <PlayerShuffleIcon className="w-5 h-5" />
            </button>

            <button
              onClick={prevTrack}
              className={`p-2.5 active:scale-90 transition-transform cursor-pointer ${
                isDark
                  ? 'text-white hover:text-white/80'
                  : 'text-neutral-900 hover:text-neutral-700'
              }`}
              aria-label="Previous Track"
            >
              <PlayerPreviousIcon className="w-6 h-6" />
            </button>

            {/* Play/Pause Button: Large solid black circle with white icon */}
            <button
              onClick={togglePlay}
              className="w-16 h-16 rounded-full bg-black text-white flex items-center justify-center shadow-xl active:scale-95 transition-transform cursor-pointer flex-shrink-0"
              aria-label={isLoadingTrack ? 'Loading' : isPlaying ? 'Pause' : 'Play'}
            >
              <div
                key={isLoadingTrack ? 'loading' : isPlaying ? 'pause' : 'play'}
                className="animate-icon-pop flex items-center justify-center"
              >
                {isLoadingTrack ? (
                  <Loader2 className="w-7 h-7 animate-spin text-white" />
                ) : isPlaying ? (
                  <PlayerPauseIcon className="w-7 h-7" />
                ) : (
                  <PlayerPlayIcon className="w-7 h-7" />
                )}
              </div>
            </button>

            <button
              onClick={nextTrack}
              className={`p-2.5 active:scale-90 transition-transform cursor-pointer ${
                isDark
                  ? 'text-white hover:text-white/80'
                  : 'text-neutral-900 hover:text-neutral-700'
              }`}
              aria-label="Next Track"
            >
              <PlayerNextIcon className="w-6 h-6" />
            </button>

            <button
              onClick={cycleRepeatMode}
              className={`p-2.5 rounded-full active:scale-90 transition-transform cursor-pointer ${
                repeatMode !== 'off'
                  ? 'text-purple-600 dark:text-purple-400'
                  : isDark
                  ? 'text-white/60 hover:text-white'
                  : 'text-black/60 hover:text-black'
              }`}
              aria-label="Repeat Mode"
            >
              <PlayerRepeatIcon mode={repeatMode} className="w-5 h-5" />
            </button>
          </div>

          {/* Lyrics + SmartQueue Row */}
          <div className="w-full flex items-center gap-3 mb-3">
            {/* Lyrics Bottom Sheet Toggle */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsLyricsSheetOpen(true);
              }}
              className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-2xl text-xs font-bold active:scale-95 transition-all cursor-pointer select-none ${
                isDark
                  ? 'bg-white/[0.07] hover:bg-white/[0.12] border border-white/10 text-white'
                  : 'bg-black/[0.05] hover:bg-black/[0.09] border border-black/10 text-neutral-900'
              }`}
            >
              <Mic2 className="w-4 h-4 opacity-80 flex-shrink-0" />
              <span>Lyrics</span>
            </button>

            {/* SmartQueue Toggle with icon and proper separation */}
            <button
              onClick={toggleSmartQueue}
              className={`flex-1 flex items-center justify-between py-3 px-4 rounded-2xl text-xs font-bold active:scale-95 transition-all cursor-pointer select-none ${
                isDark
                  ? 'bg-white/[0.07] hover:bg-white/[0.12] border border-white/10 text-white'
                  : 'bg-black/[0.05] hover:bg-black/[0.09] border border-black/10 text-neutral-900'
              }`}
              aria-label={`Toggle SmartQueue, currently ${smartQueueEnabled ? 'on' : 'off'}`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <ListMusic className="w-4 h-4 opacity-80 flex-shrink-0" />
                <span className="truncate font-bold text-xs tracking-tight">SmartQueue</span>
              </div>
              <div
                className={`w-8 h-4.5 rounded-full p-0.5 transition-colors duration-200 flex items-center flex-shrink-0 ml-2 ${
                  smartQueueEnabled
                    ? 'bg-purple-600'
                    : isDark
                    ? 'bg-white/25'
                    : 'bg-black/20'
                }`}
              >
                <div
                  className={`w-3.5 h-3.5 rounded-full bg-white shadow-xs transition-transform duration-200 ease-out ${
                    smartQueueEnabled ? 'translate-x-3.5' : 'translate-x-0'
                  }`}
                />
              </div>
            </button>
          </div>

          {/* Up Next Section */}
          <div className="w-full">
            <div className="flex items-center justify-between mb-1.5 px-0.5">
              <span
                className={`text-[11px] font-bold uppercase tracking-wider ${
                  isDark ? 'text-white/50' : 'text-black/50'
                }`}
              >
                UP NEXT
              </span>
              <button
                onClick={() => setIsQueueOpen(true)}
                className="text-xs font-semibold text-purple-600 dark:text-purple-400 hover:opacity-80 flex items-center gap-0.5 active:scale-95 transition-all cursor-pointer"
              >
                <span>Queue</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {nextQueuedTrack ? (
              <div
                onClick={() => playTrack(nextQueuedTrack, queue)}
                className={`flex items-center gap-3 p-2.5 rounded-2xl active:scale-[0.99] transition-all cursor-pointer ${
                  isDark
                    ? 'bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.06]'
                    : 'bg-black/[0.04] hover:bg-black/[0.07] border border-black/[0.06]'
                }`}
              >
                <div className="w-11 h-11 rounded-xl overflow-hidden bg-black/10 dark:bg-white/10 flex-shrink-0">
                  <img
                    src={nextQueuedTrack.artworkUrl}
                    alt={nextQueuedTrack.title}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <h4
                    className={`text-xs font-bold truncate leading-tight ${
                      isDark ? 'text-white' : 'text-neutral-900'
                    }`}
                  >
                    {nextQueuedTrack.title}
                  </h4>
                  <p
                    className={`text-[11px] truncate mt-0.5 leading-tight ${
                      isDark ? 'text-white/50' : 'text-black/50'
                    }`}
                  >
                    {nextQueuedTrack.artistName}
                  </p>
                </div>
              </div>
            ) : (
              <div
                className={`px-3 py-2.5 rounded-2xl text-center ${
                  isDark
                    ? 'bg-white/[0.03] border border-white/[0.05] text-white/40'
                    : 'bg-black/[0.03] border border-black/0.05 text-black/40'
                }`}
              >
                <p className="text-[11px] font-medium">End of playback queue</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Embedded Modals & Drawers */}
      <LyricsSheet
        isOpen={isLyricsSheetOpen}
        onClose={handleCloseLyrics}
        currentTrack={displayTrack}
        onSeek={seek}
        isDark={isDark}
      />
      <QueueDrawer />
      <AddToPlaylistSheet
        track={displayTrack}
        isOpen={isAddToPlaylistOpen}
        onClose={() => setIsAddToPlaylistOpen(false)}
      />
      <PlaybackDiagnosticsModal
        isOpen={isDiagnosticsOpen}
        onClose={() => setIsDiagnosticsOpen(false)}
      />
    </div>,
    document.body
  );
};
