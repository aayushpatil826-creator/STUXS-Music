import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  FileAudio,
  ListPlus,
  X,
  Check,
  AlertTriangle,
  Loader2,
  Upload,
  Sparkles,
} from 'lucide-react';
import { useLibrary } from '../../context/LibraryContext';
import type { M3UImportResult } from '../../services/M3UParserService';
import { backButtonManager } from '../../services/backButtonManager';

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export const ImportModal: React.FC<ImportModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const { importLocalFiles, importM3UFile } = useLibrary();
  const [active, setActive] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressState, setProgressState] = useState<{
    current: number;
    total: number;
    currentName?: string;
  } | null>(null);
  const [audioImportSummary, setAudioImportSummary] = useState<{
    total: number;
    successCount: number;
  } | null>(null);
  const [m3uResult, setM3uResult] = useState<M3UImportResult | null>(null);

  const audioFileInputRef = useRef<HTMLInputElement>(null);
  const m3uFileInputRef = useRef<HTMLInputElement>(null);

  const handleAnimatedClose = React.useCallback(() => {
    setActive(false);
    setTimeout(() => {
      onClose();
    }, 240);
  }, [onClose]);

  // Back button integration
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        setActive(true);
      }, 20);
      const unregister = backButtonManager.register('import-modal', handleAnimatedClose, 30);
      return () => {
        clearTimeout(timer);
        unregister();
      };
    } else {
      setActive(false);
    }
  }, [isOpen, handleAnimatedClose]);

  if (!isOpen) return null;

  const handleAudioFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsProcessing(true);
    setProgressState({ current: 0, total: files.length });

    try {
      const imported = await importLocalFiles(files, (current, total, currentName) => {
        setProgressState({ current, total, currentName });
      });

      setIsProcessing(false);
      setProgressState(null);
      setAudioImportSummary({
        total: files.length,
        successCount: imported.length,
      });
    } catch (err) {
      console.error(err);
      setIsProcessing(false);
      setProgressState(null);
    }
  };

  const handleM3USelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setProgressState({ current: 0, total: 1 });

    try {
      const result = await importM3UFile(file, (current, total, currentName) => {
        setProgressState({ current, total, currentName });
      });
      setIsProcessing(false);
      setProgressState(null);
      setM3uResult(result);
    } catch (err) {
      console.error(err);
      setIsProcessing(false);
      setProgressState(null);
    }
  };

  const handleFinish = () => {
    setM3uResult(null);
    setAudioImportSummary(null);
    if (onSuccess) onSuccess();
    onClose();
  };

  const percent = progressState && progressState.total > 0
    ? Math.round((progressState.current / progressState.total) * 100)
    : 0;

  return createPortal(
    <>
      {/* Dim Scrim Backdrop */}
      <div
        onClick={handleAnimatedClose}
        className={`fixed inset-0 z-[999] bg-black/50 transition-opacity duration-240 ${
          active ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden="true"
      />

      {/* Bottom Sheet Container: slides upward from bottom */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={`fixed inset-x-0 bottom-0 z-[1000] w-full max-w-sm mx-auto bg-stuxs-surface border-t sm:border border-stuxs-border rounded-t-[32px] sm:rounded-3xl p-6 shadow-2xl transition-all select-none will-change-transform text-left ${
          active ? 'duration-300' : 'duration-240'
        }`}
        style={{
          transform: active ? 'translate3d(0, 0, 0)' : 'translate3d(0, 100%, 0)',
          opacity: active ? 1 : 0,
          transitionTimingFunction: active ? 'cubic-bezier(0.16, 1, 0.3, 1)' : 'cubic-bezier(0.3, 0, 0.8, 0.15)',
          paddingBottom: 'max(env(safe-area-inset-bottom, 16px), var(--safe-area-inset-bottom, 16px), 16px)',
        }}
      >
        {/* Top Drag Handle for mobile */}
        <div className="sm:hidden flex justify-center -mt-2 pb-3">
          <div className="w-9 h-1 rounded-full bg-stuxs-text-muted/30" />
        </div>
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-stuxs-border/60">
          <div className="flex items-center space-x-2">
            <Upload className="w-5 h-5 text-stuxs-accent" />
            <h3 className="text-base font-bold text-stuxs-text">Import to Library</h3>
          </div>
          <button
            onClick={handleAnimatedClose}
            className="p-1 rounded-full text-stuxs-text-muted hover:text-stuxs-text active:scale-95 cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Hidden File Inputs */}
        <input
          type="file"
          ref={audioFileInputRef}
          onChange={handleAudioFilesSelected}
          multiple
          accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.flac"
          className="hidden"
        />
        <input
          type="file"
          ref={m3uFileInputRef}
          onChange={handleM3USelected}
          accept=".m3u,.m3u8"
          className="hidden"
        />

        {/* --- VIEW 1: Main Picker Options or Active Progress --- */}
        {!m3uResult && !audioImportSummary && (
          <div className="py-4 space-y-3">
            {isProcessing ? (
              <div className="py-6 flex flex-col items-center justify-center space-y-4 text-center">
                <div className="relative flex items-center justify-center">
                  <Loader2 className="w-10 h-10 text-stuxs-accent animate-spin" />
                  <Sparkles className="w-4 h-4 text-stuxs-accent absolute" />
                </div>
                <div className="w-full space-y-1.5">
                  <p className="text-sm font-bold text-stuxs-text">
                    {progressState
                      ? `Importing ${progressState.current}/${progressState.total} songs...`
                      : 'Resolving metadata & artwork...'}
                  </p>
                  {progressState?.currentName && (
                    <p className="text-xs text-stuxs-text-secondary truncate max-w-xs mx-auto px-2">
                      {progressState.currentName}
                    </p>
                  )}
                </div>

                {/* Progress bar */}
                {progressState && progressState.total > 0 && (
                  <div className="w-full bg-stuxs-surface-secondary h-2 rounded-full overflow-hidden border border-stuxs-border/40 mt-1">
                    <div
                      className="bg-stuxs-accent h-full transition-all duration-200 rounded-full"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                )}
                <p className="text-[11px] text-stuxs-text-muted">
                  Auto-matching titles, artists, and high-res offline artwork
                </p>
              </div>
            ) : (
              <>
                <button
                  onClick={() => audioFileInputRef.current?.click()}
                  className="w-full flex items-center space-x-4 p-4 rounded-2xl bg-stuxs-surface-secondary hover:bg-stuxs-surface-hover border border-stuxs-border transition-all active:scale-[0.98] text-left cursor-pointer shadow-xs"
                >
                  <div className="w-12 h-12 rounded-xl bg-stuxs-accent/15 text-stuxs-accent flex items-center justify-center flex-shrink-0">
                    <FileAudio className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-stuxs-text">Import Audio Files</h4>
                    <p className="text-xs text-stuxs-text-secondary mt-0.5">
                      Auto-detect tags & fetch offline album artwork
                    </p>
                  </div>
                </button>

                <button
                  onClick={() => m3uFileInputRef.current?.click()}
                  className="w-full flex items-center space-x-4 p-4 rounded-2xl bg-stuxs-surface-secondary hover:bg-stuxs-surface-hover border border-stuxs-border transition-all active:scale-[0.98] text-left cursor-pointer shadow-xs"
                >
                  <div className="w-12 h-12 rounded-xl bg-purple-500/15 text-purple-600 dark:text-purple-400 flex items-center justify-center flex-shrink-0">
                    <ListPlus className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-stuxs-text">Import M3U / M3U8 Playlist</h4>
                    <p className="text-xs text-stuxs-text-secondary mt-0.5">
                      Parse, match tracks & create a new Library playlist
                    </p>
                  </div>
                </button>
              </>
            )}
          </div>
        )}

        {/* --- VIEW 2: Audio File Import Summary --- */}
        {audioImportSummary && (
          <div className="py-4 space-y-4">
            <div>
              <h4 className="text-sm font-bold text-stuxs-text">Import Complete</h4>
              <p className="text-xs text-stuxs-text-secondary mt-0.5">
                {audioImportSummary.successCount} of {audioImportSummary.total} audio files imported
              </p>
            </div>

            <div className="space-y-2 rounded-2xl bg-stuxs-surface-secondary p-3.5 border border-stuxs-border text-xs">
              <div className="flex items-center space-x-2 text-emerald-600 dark:text-emerald-400 font-semibold">
                <Check className="w-4 h-4 flex-shrink-0" />
                <span>
                  {audioImportSummary.total} song{audioImportSummary.total > 1 ? 's' : ''} imported with auto-resolved metadata & album artwork
                </span>
              </div>
            </div>

            <button
              onClick={handleFinish}
              className="w-full py-3 rounded-2xl bg-stuxs-accent text-white font-bold text-sm shadow-stuxs-glow hover:opacity-90 active:scale-95 transition-all cursor-pointer"
            >
              Done
            </button>
          </div>
        )}

        {/* --- VIEW 3: M3U Import Summary --- */}
        {m3uResult && (
          <div className="py-4 space-y-4">
            <div>
              <h4 className="text-sm font-bold text-stuxs-text">
                Playlist Imported: <span className="text-stuxs-accent">{m3uResult.playlistName}</span>
              </h4>
              <p className="text-xs text-stuxs-text-secondary mt-0.5">
                Processed {m3uResult.totalEntries} entries
              </p>
            </div>

            <div className="space-y-2 rounded-2xl bg-stuxs-surface-secondary p-3.5 border border-stuxs-border text-xs">
              <div className="flex items-center space-x-2 text-emerald-600 dark:text-emerald-400 font-semibold">
                <Check className="w-4 h-4 flex-shrink-0" />
                <span>
                  {m3uResult.totalEntries} songs imported • {m3uResult.matchedCount} matched
                  {m3uResult.unresolvedCount > 0 ? ` • ${m3uResult.unresolvedCount} couldn't be identified` : ''}
                </span>
              </div>
              {m3uResult.unresolvedCount > 0 && (
                <div className="flex items-center space-x-2 text-amber-600 dark:text-amber-400 font-semibold">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span>{m3uResult.unresolvedCount} track{m3uResult.unresolvedCount > 1 ? 's' : ''} could not be identified</span>
                </div>
              )}
            </div>

            <button
              onClick={handleFinish}
              className="w-full py-3 rounded-2xl bg-stuxs-accent text-white font-bold text-sm shadow-stuxs-glow hover:opacity-90 active:scale-95 transition-all cursor-pointer"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </>,
    document.body
  );
};
