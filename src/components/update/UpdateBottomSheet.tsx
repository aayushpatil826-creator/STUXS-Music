import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Sparkles,
  Download,
  AlertCircle,
  CheckCircle2,
  X,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import {
  appUpdateService,
  type AppUpdateState,
} from '../../services/AppUpdateService';
import { backButtonManager } from '../../services/backButtonManager';

interface UpdateBottomSheetProps {
  updateState: AppUpdateState;
  onClose: () => void;
}

export const UpdateBottomSheet: React.FC<UpdateBottomSheetProps> = ({
  updateState,
  onClose,
}) => {
  const { status, manifest, isMandatory, progress, error } = updateState;

  // Dismiss via Android hardware back button if dismissible
  useEffect(() => {
    if (!isMandatory && status !== 'DOWNLOADING' && status !== 'INSTALLING') {
      const unregister = backButtonManager.register('update-bottom-sheet', onClose, 100);
      return () => unregister();
    }
  }, [isMandatory, status, onClose]);

  if (!manifest) return null;

  const formatSizeMb = (bytes: number): string => {
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const handleUpdateClick = () => {
    appUpdateService.downloadUpdate();
  };

  const handleCancelClick = () => {
    appUpdateService.cancelDownload();
  };

  const handleInstallClick = () => {
    appUpdateService.installUpdate();
  };

  const handleRetryClick = () => {
    appUpdateService.downloadUpdate();
  };

  return createPortal(
    <div className="fixed inset-0 z-[1050] pointer-events-auto">
      {/* Universal Dimmed Scrim Backdrop (fixed top-level modal layer) */}
      <div
        className="fixed inset-0 z-[1050] bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={!isMandatory && status !== 'DOWNLOADING' && status !== 'INSTALLING' ? onClose : undefined}
        aria-hidden="true"
      />

      {/* Top-level Sheet Positioning Container — Strictly above mini-player and bottom nav */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-title"
        className="fixed inset-0 z-[1060] flex items-end sm:items-center justify-center p-0 sm:p-4 pointer-events-none"
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="pointer-events-auto w-full max-w-md bg-[#FAF8F5] dark:bg-[#16161E] rounded-t-[32px] sm:rounded-3xl border border-stuxs-border shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in slide-in-from-bottom duration-300 relative"
        >
          {/* Header decoration bar */}
          <div className="flex justify-center pt-3 pb-1 sm:hidden">
            <div className="w-12 h-1 rounded-full bg-stuxs-text-muted/30" />
          </div>

          {/* Top Header */}
          <div className="p-5 pb-3 flex items-start justify-between">
            <div className="flex items-center space-x-3">
              <div
                className={`w-11 h-11 rounded-2xl flex items-center justify-center shadow-sm ${
                  isMandatory
                    ? 'bg-amber-500/15 text-amber-500 border border-amber-500/30'
                    : 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/30'
                }`}
              >
                <Sparkles className="w-5 h-5 animate-pulse" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-stuxs-surface-secondary border border-stuxs-border text-stuxs-text-secondary">
                    {isMandatory ? 'Required Update' : 'New Version Available'}
                  </span>
                </div>
                <h3 id="update-title" className="text-lg font-bold text-stuxs-text mt-0.5">
                  {manifest.title || `STUXS Music ${manifest.latestVersion}`}
                </h3>
              </div>
            </div>

            {!isMandatory && status !== 'DOWNLOADING' && status !== 'INSTALLING' && (
              <button
                onClick={onClose}
                className="p-1.5 rounded-full text-stuxs-text-muted hover:text-stuxs-text hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>

          {/* Body Content — Smoothly scrollable for long release notes */}
          <div className="px-5 py-2 overflow-y-auto space-y-4 flex-1 overscroll-contain">
            {/* Release Notes */}
            {manifest.releaseNotes && manifest.releaseNotes.length > 0 && (
              <div className="p-3.5 rounded-2xl bg-stuxs-surface-secondary/50 border border-stuxs-border/60">
                <h4 className="text-xs font-bold uppercase tracking-wider text-stuxs-text-secondary mb-2">
                  What's New in {manifest.latestVersion}
                </h4>
                <ul className="space-y-1.5 text-xs text-stuxs-text-secondary leading-relaxed">
                  {manifest.releaseNotes.map((note, index) => (
                    <li key={index} className="flex items-start space-x-2">
                      <span className="text-purple-500 font-bold">•</span>
                      <span>{note}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Size and Security Info */}
            <div className="flex items-center justify-between text-xs text-stuxs-text-secondary px-1">
              <div className="flex items-center space-x-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
                <span>Verified & Signed Package</span>
              </div>
              <span className="font-semibold text-stuxs-text">
                {formatSizeMb(manifest.apkSize)}
              </span>
            </div>

            {/* Downloading Progress Bar */}
            {status === 'DOWNLOADING' && progress && (
              <div className="p-4 rounded-2xl bg-purple-500/10 border border-purple-500/20 space-y-2.5 animate-in fade-in">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="text-purple-600 dark:text-purple-300">
                    Downloading update...
                  </span>
                  <span className="text-stuxs-text font-bold">
                    {progress.percent}%
                  </span>
                </div>
                <div className="w-full h-2 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 transition-all duration-200 rounded-full"
                    style={{ width: `${Math.max(4, progress.percent)}%` }}
                  />
                </div>
                <div className="flex justify-between text-[11px] text-stuxs-text-secondary">
                  <span>{formatSizeMb(progress.bytesDownloaded)}</span>
                  <span>{formatSizeMb(progress.totalBytes)}</span>
                </div>
              </div>
            )}

            {/* Verifying Spinner */}
            {status === 'VERIFYING' && (
              <div className="p-4 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center space-x-3 text-xs font-medium text-purple-600 dark:text-purple-300">
                <RefreshCw className="w-4 h-4 animate-spin text-purple-500" />
                <span>Verifying SHA-256 integrity checksum...</span>
              </div>
            )}

            {/* Ready To Install Banner */}
            {status === 'READY_TO_INSTALL' && (
              <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center space-x-2.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>Package verified successfully. Ready to install!</span>
              </div>
            )}

            {/* Error Banner */}
            {status === 'FAILED' && error && (
              <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-start space-x-2.5 text-xs text-rose-600 dark:text-rose-400">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <span className="font-semibold block">Update Error</span>
                  <span className="leading-tight block opacity-90">{error}</span>
                </div>
              </div>
            )}
          </div>

          {/* Footer Actions — with device safe area bottom padding */}
          <div
            className="p-5 pt-3 border-t border-stuxs-border/60 bg-[#FAF8F5]/80 dark:bg-[#16161E]/80 backdrop-blur-md"
            style={{
              paddingBottom: 'max(env(safe-area-inset-bottom, 20px), var(--safe-area-inset-bottom, 20px), 20px)',
            }}
          >
            {status === 'UPDATE_AVAILABLE' && (
              <div className="flex items-center space-x-3">
                {!isMandatory && (
                  <button
                    onClick={onClose}
                    className="flex-1 py-3 px-4 rounded-2xl border border-stuxs-border text-xs font-semibold text-stuxs-text hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer active:scale-98"
                  >
                    Later
                  </button>
                )}
                <button
                  onClick={handleUpdateClick}
                  className="flex-1 py-3 px-4 rounded-2xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold shadow-md shadow-purple-500/25 flex items-center justify-center space-x-2 transition-all cursor-pointer active:scale-98"
                >
                  <Download className="w-4 h-4" />
                  <span>Update Now</span>
                </button>
              </div>
            )}

            {status === 'DOWNLOADING' && (
              <button
                onClick={handleCancelClick}
                className="w-full py-3 px-4 rounded-2xl border border-rose-500/30 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer active:scale-98"
              >
                Cancel Download
              </button>
            )}

            {status === 'VERIFYING' && (
              <button
                disabled
                className="w-full py-3 px-4 rounded-2xl bg-stuxs-surface-secondary text-xs font-semibold text-stuxs-text-muted cursor-not-allowed opacity-75"
              >
                Verifying...
              </button>
            )}

            {status === 'READY_TO_INSTALL' && (
              <button
                onClick={handleInstallClick}
                className="w-full py-3 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-md shadow-emerald-500/25 flex items-center justify-center space-x-2 transition-all cursor-pointer active:scale-98"
              >
                <Download className="w-4 h-4" />
                <span>Install Update</span>
              </button>
            )}

            {status === 'INSTALLING' && (
              <button
                disabled
                className="w-full py-3 px-4 rounded-2xl bg-stuxs-surface-secondary text-xs font-semibold text-stuxs-text-muted cursor-not-allowed opacity-75 flex items-center justify-center space-x-2"
              >
                <RefreshCw className="w-4 h-4 animate-spin text-stuxs-accent" />
                <span>Launching Installer...</span>
              </button>
            )}

            {status === 'FAILED' && (
              <div className="flex items-center space-x-3">
                {!isMandatory && (
                  <button
                    onClick={onClose}
                    className="flex-1 py-3 px-4 rounded-2xl border border-stuxs-border text-xs font-semibold text-stuxs-text hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer active:scale-98"
                  >
                    Dismiss
                  </button>
                )}
                <button
                  onClick={handleRetryClick}
                  className="flex-1 py-3 px-4 rounded-2xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold shadow-md shadow-purple-500/25 flex items-center justify-center space-x-2 transition-all cursor-pointer active:scale-98"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Try Again</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
