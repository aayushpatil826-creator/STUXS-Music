import React, { useEffect, useRef, useCallback } from 'react';
import { Play, Flame } from 'lucide-react';
import type { Track } from '../../types/music';

interface TrendingCarousel3DProps {
  tracks: Track[];
  onPlayTrack: (track: Track) => void;
}

export const TrendingCarousel3D: React.FC<TrendingCarousel3DProps> = ({
  tracks,
  onPlayTrack,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Subtle scaling on scroll without React state overhead (Zero-Lag 120FPS)
  const updateCardTransforms = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const containerCenter = container.scrollLeft + container.clientWidth / 2;
    // Card width (270px) + gap (16px) = 286px step
    const cardStep = 286;

    cardRefs.current.forEach((cardEl) => {
      if (!cardEl) return;
      const cardCenter = cardEl.offsetLeft + cardEl.offsetWidth / 2;
      const dist = (cardCenter - containerCenter) / cardStep;
      const absDist = Math.abs(dist);

      // Center card: scale 1.0, opacity 1.0
      // Side cards: subtle scale ~0.92, opacity 0.78
      const scale = Math.max(0.92, 1 - absDist * 0.08);
      const opacity = Math.max(0.78, 1 - absDist * 0.22);
      const zIndex = Math.round(20 - Math.min(10, absDist * 5));

      cardEl.style.transform = `scale(${scale})`;
      cardEl.style.opacity = `${opacity}`;
      cardEl.style.zIndex = `${zIndex}`;
    });
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Passive listener: compositor thread scrolling without blocking UI or React
    container.addEventListener('scroll', updateCardTransforms, { passive: true });
    window.addEventListener('resize', updateCardTransforms, { passive: true });

    // Initial positioning
    updateCardTransforms();

    return () => {
      container.removeEventListener('scroll', updateCardTransforms);
      window.removeEventListener('resize', updateCardTransforms);
    };
  }, [tracks, updateCardTransforms]);

  const handleCardClick = (track: Track, idx: number) => {
    const container = containerRef.current;
    const cardEl = cardRefs.current[idx];
    if (!container || !cardEl) return;

    const containerCenter = container.scrollLeft + container.clientWidth / 2;
    const cardCenter = cardEl.offsetLeft + cardEl.offsetWidth / 2;
    const absDiff = Math.abs(cardCenter - containerCenter);

    // If card is already near center (< 40px), trigger play
    if (absDiff < 40) {
      onPlayTrack(track);
    } else {
      // If card is on side, smoothly glide it into center
      const targetScroll = cardEl.offsetLeft - (container.clientWidth - cardEl.offsetWidth) / 2;
      container.scrollTo({ left: targetScroll, behavior: 'smooth' });
    }
  };

  if (!tracks || tracks.length === 0) return null;

  return (
    <div className="-mx-4 sm:-mx-5 select-none py-1 overflow-hidden">
      {/* Horizontal Landscape Carousel Stage */}
      <div
        ref={containerRef}
        className="w-full overflow-x-auto scrollbar-none snap-x snap-mandatory flex items-center py-2"
        style={{
          WebkitOverflowScrolling: 'touch',
          paddingLeft: 'calc(50% - 135px)',
          paddingRight: 'calc(50% - 135px)',
          scrollPadding: '0 calc(50% - 135px)',
        }}
      >
        <div className="flex items-center space-x-4">
          {tracks.map((track, idx) => {
            return (
              <div
                key={`trend-card-${track.id}`}
                ref={(el) => {
                  cardRefs.current[idx] = el;
                }}
                className="snap-center flex-shrink-0 w-[270px] sm:w-[300px] h-[165px] sm:h-[180px] cursor-pointer will-change-transform transition-all duration-200 ease-out"
                onClick={() => handleCardClick(track, idx)}
              >
                <div className="relative w-full h-full rounded-[26px] sm:rounded-[28px] overflow-hidden bg-stuxs-surface-secondary shadow-lg ring-1 ring-black/10 dark:ring-white/10 group">
                  {/* Album Artwork */}
                  <img
                    src={track.artworkUrl}
                    alt={track.title}
                    className="w-full h-full object-cover pointer-events-none select-none group-hover:scale-105 transition-transform duration-300"
                    loading={idx < 3 ? 'eager' : 'lazy'}
                  />

                  {/* Dark Gradient Overlay for clean readability */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent pointer-events-none" />

                  {/* Top-Left Rank Pill */}
                  <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-md border border-white/15 flex items-center space-x-1 shadow-sm">
                    <Flame className="w-3 h-3 text-purple-400 fill-purple-400" />
                    <span className="text-[11px] font-black text-white tracking-wider">
                      #{idx + 1}
                    </span>
                  </div>

                  {/* Lossless Quality Badge */}
                  <div className="absolute top-3 right-3 px-2 py-0.5 rounded bg-black/60 backdrop-blur-md text-[9px] font-extrabold uppercase text-white/90 tracking-wider border border-white/10 shadow-xs">
                    LOSSLESS
                  </div>

                  {/* Bottom Left: Title & Artist */}
                  <div className="absolute bottom-3 left-3.5 right-14 text-left pointer-events-none">
                    <h3 className="text-sm sm:text-base font-extrabold text-white leading-tight truncate drop-shadow-sm">
                      {track.title}
                    </h3>
                    <p className="text-xs font-medium text-white/80 truncate mt-0.5 drop-shadow-xs">
                      {track.artistName}
                    </p>
                  </div>

                  {/* Bottom Right: Play Button with STUXS Purple Accent */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onPlayTrack(track);
                    }}
                    className="absolute bottom-3 right-3 w-9 h-9 rounded-full bg-purple-600 hover:bg-purple-500 text-white flex items-center justify-center shadow-lg active:scale-90 transition-transform cursor-pointer"
                    aria-label={`Play ${track.title}`}
                  >
                    <Play className="w-4 h-4 fill-current ml-0.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
