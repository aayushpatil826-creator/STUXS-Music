import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Mic2, ChevronDown } from 'lucide-react';
import type { Track } from '../../types/music';
import { LyricsView } from './LyricsView';
import { backButtonManager } from '../../services/backButtonManager';

interface LyricsSheetProps {
  isOpen: boolean;
  onClose: () => void;
  currentTrack: Track;
  onSeek: (seconds: number) => void;
  isDark: boolean;
}

export const LyricsSheet: React.FC<LyricsSheetProps> = ({
  isOpen,
  onClose,
  currentTrack,
  onSeek,
  isDark,
}) => {
  const [active, setActive] = useState(false);
  const [dragY, setDragY] = useState(0);
  const touchStartY = useRef<number>(0);
  const isDragging = useRef<boolean>(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const handleClose = useCallback(() => {
    setActive(false);
    setTimeout(() => {
      onCloseRef.current();
      setDragY(0);
    }, 240);
  }, []);

  // Back button integration: Priority 30 (higher than player modal priority 10)
  useEffect(() => {
    if (isOpen) {
      setDragY(0);
      const timer = setTimeout(() => {
        setActive(true);
      }, 20);
      const unregister = backButtonManager.register('lyrics-sheet', handleClose, 30);
      return () => {
        clearTimeout(timer);
        unregister();
      };
    } else {
      setActive(false);
    }
  }, [isOpen, handleClose]);

  // Touch drag-down to dismiss handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
    isDragging.current = true;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging.current) return;
    const currentY = e.touches[0].clientY;
    const deltaY = currentY - touchStartY.current;
    // Only allow dragging downward
    if (deltaY > 0) {
      setDragY(deltaY);
    }
  };

  const handleTouchEnd = () => {
    if (!isDragging.current) return;
    isDragging.current = false;
    if (dragY > 75) {
      handleClose();
    } else {
      setDragY(0);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Semi-transparent scrim backdrop allowing underlying player to remain visible */}
      <div
        onClick={handleClose}
        className={`fixed inset-0 z-[60] bg-black/50 transition-opacity duration-240 ${
          active ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden="true"
      />

        {/* Lyrics Bottom Sheet (covers roughly 66% of the screen height) */}
        <div
          ref={sheetRef}
          role="dialog"
          aria-modal="true"
          aria-label="Lyrics"
          className={`fixed inset-x-0 bottom-0 z-[70] max-w-md mx-auto h-[66vh] flex flex-col rounded-t-[36px] sm:rounded-t-[40px] shadow-2xl overflow-hidden will-change-transform select-none transition-transform ${
            isDragging.current ? 'duration-0' : active ? 'duration-300' : 'duration-240'
          } ${
            isDark
              ? 'bg-[#121218] border-t border-white/10 text-white'
              : 'bg-[#FAF8F5] border-t border-black/[0.08] text-[#0F172A]'
          }`}
          style={{
            transform: active
              ? `translate3d(0, ${dragY}px, 0)`
              : 'translate3d(0, 100%, 0)',
            transitionTimingFunction: active ? 'cubic-bezier(0.16, 1, 0.3, 1)' : 'cubic-bezier(0.3, 0, 0.8, 0.15)',
            paddingBottom: 'calc(8px + env(safe-area-inset-bottom, 16px))',
          }}
        >
          {/* Drag Handle Area */}
          <div
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            className="w-full pt-3.5 pb-1.5 flex justify-center cursor-grab active:cursor-grabbing flex-shrink-0"
          >
            <div
              className={`w-12 h-1.5 rounded-full ${
                isDark ? 'bg-white/20' : 'bg-black/15'
              }`}
            />
          </div>

        {/* Header: Lyrics icon + title on left, close/chevron-down on right */}
        <div
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          className={`w-full flex items-center justify-between px-6 py-2 border-b flex-shrink-0 ${
            isDark ? 'border-white/[0.07]' : 'border-black/[0.07]'
          }`}
        >
          <div className="flex items-center gap-2">
            <Mic2 className="w-4 h-4 text-purple-600 dark:text-purple-400" />
            <span
              className={`font-bold text-sm tracking-tight ${
                isDark ? 'text-white' : 'text-neutral-900'
              }`}
            >
              Lyrics
            </span>
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();
              handleClose();
            }}
            onTouchStart={(e) => e.stopPropagation()}
            onTouchEnd={(e) => {
              e.stopPropagation();
              handleClose();
            }}
            className={`w-10 h-10 -mr-2 rounded-full flex items-center justify-center active:scale-90 transition-all cursor-pointer ${
              isDark
                ? 'hover:bg-white/10 text-white/70 hover:text-white'
                : 'hover:bg-black/10 text-black/70 hover:text-black'
            }`}
            aria-label="Close Lyrics"
          >
            <ChevronDown className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Lyrics Container */}
        <div className="flex-1 min-h-0 relative overflow-hidden">
          <LyricsView currentTrack={currentTrack} onSeek={onSeek} />
        </div>
      </div>
    </>
  );
};
