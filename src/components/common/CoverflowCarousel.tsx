import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import type { Playlist } from '../../types/music';
import { resolvePlaylistCoverUrl } from './PlaylistCover';

export interface CoverflowItem {
  id: string;
  title: string;
  subtitle?: string;
  artworkUrl: string;
  badge?: string;
  badgeIcon?: React.ReactNode;
  data?: any;
}

interface CoverflowCarouselProps {
  items?: CoverflowItem[];
  playlists?: Playlist[];
  onSelectItem?: (item: CoverflowItem) => void;
  onSelectPlaylist?: (playlistId: string) => void;
  onPlayItem?: (item: CoverflowItem) => void;
  onPlayPlaylist?: (playlist: Playlist) => void;
  badgeLabel?: string;
  ariaLabel?: string;
}

export const CoverflowCarousel: React.FC<CoverflowCarouselProps> = ({
  items,
  playlists,
  onSelectItem,
  onSelectPlaylist,
  onPlayItem,
  onPlayPlaylist,
  badgeLabel = 'Featured',
  ariaLabel = 'Coverflow Carousel',
}) => {
  // Normalize items to unified CoverflowItem format
  const normalizedItems: CoverflowItem[] = React.useMemo(() => {
    if (items && items.length > 0) return items;
    if (playlists && playlists.length > 0) {
      return playlists.map((p) => ({
        id: p.id,
        title: p.name,
        subtitle: `${p.songCount || p.songs?.length || 0} songs • ${p.description || 'Exclusive curated collection'}`,
        artworkUrl: resolvePlaylistCoverUrl(p) || p.artworkUrl,
        badge: 'Featured Mix',
        data: p,
      }));
    }
    return [];
  }, [items, playlists]);

  const count = normalizedItems.length;
  const [activeIndex, setActiveIndex] = useState(0);
  const [isReducedMotion, setIsReducedMotion] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);

  // Dragging & gesture animation refs
  const containerRef = useRef<HTMLDivElement>(null);
  const isPointerDownRef = useRef(false);
  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const currentDragOffsetRef = useRef(0);
  const dragDistanceRef = useRef(0);
  const activeIndexRef = useRef(0);
  activeIndexRef.current = activeIndex;

  const animFrameRef = useRef<number | null>(null);

  // Check prefers-reduced-motion
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    setIsReducedMotion(media.matches);

    const listener = (e: MediaQueryListEvent) => setIsReducedMotion(e.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);

  const goToIndex = useCallback(
    (newIndex: number) => {
      if (count === 0) return;
      const normalized = ((newIndex % count) + count) % count;
      setActiveIndex(normalized);
      setDragOffset(0);
      currentDragOffsetRef.current = 0;
      dragDistanceRef.current = 0;
    },
    [count]
  );

  const goNext = useCallback(() => {
    goToIndex(activeIndexRef.current + 1);
  }, [goToIndex]);

  const goPrev = useCallback(() => {
    goToIndex(activeIndexRef.current - 1);
  }, [goToIndex]);

  const handleTriggerSelect = useCallback(
    (item: CoverflowItem) => {
      if (onSelectItem) {
        onSelectItem(item);
      } else if (onSelectPlaylist) {
        onSelectPlaylist(item.id);
      }
    },
    [onSelectItem, onSelectPlaylist]
  );

  const handleTriggerPlay = useCallback(
    (item: CoverflowItem) => {
      if (onPlayItem) {
        onPlayItem(item);
      } else if (onPlayPlaylist && item.data) {
        onPlayPlaylist(item.data as Playlist);
      } else {
        handleTriggerSelect(item);
      }
    },
    [onPlayItem, onPlayPlaylist, handleTriggerSelect]
  );

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      goNext();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      goPrev();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const current = normalizedItems[activeIndex];
      if (current) handleTriggerSelect(current);
    }
  };

  // Pointer event handlers with clean click vs drag discrimination
  const handlePointerDown = (e: React.PointerEvent) => {
    if (count <= 1) return;
    isPointerDownRef.current = true;
    isDraggingRef.current = false;
    startXRef.current = e.clientX;
    startYRef.current = e.clientY;
    currentDragOffsetRef.current = 0;
    dragDistanceRef.current = 0;
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isPointerDownRef.current) return;

    const deltaX = e.clientX - startXRef.current;
    const deltaY = e.clientY - startYRef.current;
    const dist = Math.hypot(deltaX, deltaY);
    dragDistanceRef.current = dist;

    // Only initiate drag mode if pointer has moved past the click jitter threshold (8px)
    if (!isDraggingRef.current) {
      if (dist > 8) {
        if (Math.abs(deltaX) > Math.abs(deltaY)) {
          isDraggingRef.current = true;
        } else {
          isPointerDownRef.current = false;
          return;
        }
      } else {
        return;
      }
    }

    currentDragOffsetRef.current = deltaX;

    if (animFrameRef.current === null) {
      animFrameRef.current = requestAnimationFrame(() => {
        setDragOffset(currentDragOffsetRef.current);
        animFrameRef.current = null;
      });
    }
  };

  const handlePointerUp = () => {
    const wasDragging = isDraggingRef.current;
    const totalDist = dragDistanceRef.current;
    const offset = currentDragOffsetRef.current;

    isPointerDownRef.current = false;
    isDraggingRef.current = false;

    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    if (wasDragging && totalDist > 15) {
      const threshold = 40; // Drag distance to switch slides
      if (offset < -threshold) {
        goNext();
      } else if (offset > threshold) {
        goPrev();
      } else {
        setDragOffset(0);
      }
    } else {
      setDragOffset(0);
    }

    currentDragOffsetRef.current = 0;
    setTimeout(() => {
      dragDistanceRef.current = 0;
    }, 50);
  };

  const handlePointerCancel = () => {
    isPointerDownRef.current = false;
    isDraggingRef.current = false;
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    setDragOffset(0);
    currentDragOffsetRef.current = 0;
    dragDistanceRef.current = 0;
  };

  const handleCardClick = (item: CoverflowItem, index: number, e: React.MouseEvent) => {
    e.stopPropagation();

    if (dragDistanceRef.current > 10 || isDraggingRef.current) {
      return;
    }

    // Centered card: Open detail screen
    if (index === activeIndex) {
      handleTriggerSelect(item);
    } else {
      // Side card: Bring to center on first tap
      goToIndex(index);
    }
  };

  if (!normalizedItems || normalizedItems.length === 0) {
    return null;
  }

  const currentItem = normalizedItems[activeIndex] || normalizedItems[0];

  // Single Item Case: Render single clean centered card without 3D side artifacts
  if (count === 1) {
    const single = normalizedItems[0];
    return (
      <div className="w-full select-none py-2 flex flex-col items-center justify-center">
        <div
          onClick={() => handleTriggerSelect(single)}
          className="relative w-[190px] h-[190px] sm:w-[220px] sm:h-[220px] rounded-3xl cursor-pointer group shadow-2xl bg-stuxs-surface-secondary ring-1 ring-white/15 overflow-hidden transition-transform hover:scale-105 active:scale-95"
        >
          <img
            src={single.artworkUrl}
            alt={single.title}
            className="w-full h-full object-cover pointer-events-none"
            loading="lazy"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-white/10 pointer-events-none" />
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleTriggerPlay(single);
            }}
            className="absolute bottom-3 right-3 w-10 h-10 rounded-full bg-stuxs-accent text-white flex items-center justify-center shadow-stuxs-glow hover:scale-105 active:scale-95 transition-transform"
            aria-label={`Play ${single.title}`}
          >
            <Play className="w-5 h-5 fill-current ml-0.5" />
          </button>
        </div>

        {/* Info Banner */}
        <div
          onClick={() => handleTriggerSelect(single)}
          className="text-center px-6 pt-3 cursor-pointer group"
        >
          <div className="flex items-center justify-center space-x-1.5 text-[11px] font-bold uppercase tracking-wider text-stuxs-accent mb-1">
            <Sparkles className="w-3 h-3" />
            <span>{single.badge || badgeLabel}</span>
          </div>
          <h3 className="text-base font-bold text-stuxs-text tracking-tight truncate max-w-xs sm:max-w-md mx-auto group-hover:text-stuxs-accent transition-colors">
            {single.title}
          </h3>
          {single.subtitle && (
            <p className="text-xs text-stuxs-text-secondary line-clamp-1 max-w-xs sm:max-w-md mx-auto mt-0.5">
              {single.subtitle}
            </p>
          )}
        </div>
      </div>
    );
  }

  // Multiple Items: True 3D Coverflow
  return (
    <div
      className="w-full select-none py-2 outline-none focus-visible:ring-1 focus-visible:ring-stuxs-accent/50"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-label={ariaLabel}
      role="region"
    >
      {/* 3D Coverflow Stage */}
      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        className="relative w-full h-[250px] sm:h-[280px] flex items-center justify-center overflow-hidden cursor-grab active:cursor-grabbing touch-pan-y"
        style={{
          perspective: isReducedMotion ? 'none' : '900px',
          perspectiveOrigin: '50% 50%',
        }}
      >
        <div className="relative w-full h-full flex items-center justify-center pointer-events-none">
          {normalizedItems.map((item, idx) => {
            // Calculate circular wrapped distance
            let dist = idx - activeIndex;
            if (count > 2) {
              if (dist > count / 2) dist -= count;
              if (dist < -count / 2) dist += count;
            }

            // Continuous progress including active dragging
            const dragProgress = dragOffset / 190;
            const effectiveDist = dist - dragProgress;
            const absDist = Math.abs(effectiveDist);

            // Hide cards that are too far away for performance
            if (absDist > 2.5) return null;

            // Coverflow 3D Transform calculations
            const spacing = 135; // Horizontal offset per index
            const translateX = effectiveDist * spacing;
            const translateZ = isReducedMotion ? 0 : -Math.min(180, absDist * 85);
            const rotateY = isReducedMotion
              ? 0
              : effectiveDist === 0
              ? 0
              : effectiveDist > 0
              ? -Math.min(38, 22 + absDist * 7)
              : Math.min(38, 22 + absDist * 7);

            const scale = Math.max(0.76, 1 - absDist * 0.12);
            const opacity = Math.max(0.35, 1 - absDist * 0.28);
            const zIndex = Math.round(30 - absDist * 10);
            const isCenter = idx === activeIndex;

            return (
              <div
                key={item.id}
                onClick={(e) => handleCardClick(item, idx, e)}
                className={`absolute w-[190px] h-[190px] sm:w-[220px] sm:h-[220px] rounded-3xl cursor-pointer pointer-events-auto transition-transform ${
                  isDraggingRef.current ? 'duration-75' : 'duration-300 ease-out'
                }`}
                style={{
                  transform: `translate3d(${translateX}px, 0, ${translateZ}px) rotateY(${rotateY}deg) scale(${scale})`,
                  opacity,
                  zIndex,
                  transformStyle: 'preserve-3d',
                  willChange: 'transform, opacity',
                }}
              >
                {/* Artwork Card with Liquid Glass Edge Highlight */}
                <div className="relative w-full h-full rounded-3xl overflow-hidden shadow-2xl bg-stuxs-surface-secondary ring-1 ring-white/15">
                  <img
                    src={item.artworkUrl}
                    alt={item.title}
                    className="w-full h-full object-cover pointer-events-none"
                    loading="lazy"
                  />

                  {/* Top Ambient Highlight */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-white/10 pointer-events-none" />

                  {/* Play Button Overlay on Centered Slide */}
                  {isCenter && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTriggerPlay(item);
                      }}
                      className="absolute bottom-3 right-3 w-10 h-10 rounded-full bg-stuxs-accent text-white flex items-center justify-center shadow-stuxs-glow hover:scale-105 active:scale-95 transition-transform"
                      aria-label={`Play ${item.title}`}
                    >
                      <Play className="w-5 h-5 fill-current ml-0.5" />
                    </button>
                  )}
                </div>

                {/* Subtle Reflection Shadow underneath */}
                <div className="absolute -bottom-4 left-4 right-4 h-3 bg-black/50 blur-md rounded-full -z-10" />
              </div>
            );
          })}
        </div>

        {/* Carousel Prev/Next Arrow Buttons (Desktop & Tablet) */}
        {count > 1 && (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation();
                goPrev();
              }}
              className="absolute left-2 z-40 p-2 rounded-full liquid-glass-pill text-white/70 hover:text-white transition-all hidden sm:flex items-center justify-center btn-press"
              aria-label="Previous Item"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                goNext();
              }}
              className="absolute right-2 z-40 p-2 rounded-full liquid-glass-pill text-white/70 hover:text-white transition-all hidden sm:flex items-center justify-center btn-press"
              aria-label="Next Item"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </>
        )}
      </div>

      {/* Selected Item Info Banner Below Stage */}
      {currentItem && (
        <div
          onClick={() => handleTriggerSelect(currentItem)}
          className="text-center px-6 pt-1 pb-2 cursor-pointer group animate-artwork-fade"
          key={`info-${currentItem.id}`}
        >
          <div className="flex items-center justify-center space-x-1.5 text-[11px] font-bold uppercase tracking-wider text-stuxs-accent mb-1">
            <Sparkles className="w-3 h-3" />
            <span>{currentItem.badge || badgeLabel}</span>
          </div>
          <h3 className="text-base font-bold text-stuxs-text tracking-tight truncate max-w-xs sm:max-w-md mx-auto group-hover:text-stuxs-accent transition-colors">
            {currentItem.title}
          </h3>
          {currentItem.subtitle && (
            <p className="text-xs text-stuxs-text-secondary line-clamp-1 max-w-xs sm:max-w-md mx-auto mt-0.5">
              {currentItem.subtitle}
            </p>
          )}

          {/* Dots Indicator */}
          {count > 1 && (
            <div className="flex items-center justify-center space-x-1.5 mt-3">
              {normalizedItems.map((_, i) => (
                <button
                  key={`dot-${i}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    goToIndex(i);
                  }}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    i === activeIndex ? 'w-5 bg-stuxs-accent' : 'w-1.5 bg-white/20 hover:bg-white/40'
                  }`}
                  aria-label={`Go to slide ${i + 1}`}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
