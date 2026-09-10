import React, { useState, useEffect, useCallback } from 'react';
import { X, Activity, RefreshCw, Copy, Check, Volume2, Wifi, Smartphone, FileAudio, ShieldCheck } from 'lucide-react';
import { usePlayer } from '../../context/PlayerContext';
import { Capacitor } from '@capacitor/core';
import { isNativePlatform, isDevEnvironment } from '../../utils/platform';
import { backButtonManager } from '../../services/backButtonManager';

interface PlaybackDiagnosticsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PlaybackDiagnosticsModal: React.FC<PlaybackDiagnosticsModalProps> = ({ isOpen, onClose }) => {
  const { currentTrack, isPlaying, getEngineDiagnostics, togglePlay, audioQuality, activeQuality } = usePlayer();
  const [engineState, setEngineState] = useState<Record<string, unknown>>({});
  const [copied, setCopied] = useState(false);
  const [streamTestResult, setStreamTestResult] = useState<string | null>(null);
  const [isTestingStream, setIsTestingStream] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  const handleAnimatedClose = useCallback(() => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      onClose();
    }, 220);
  }, [isClosing, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    return backButtonManager.register('diagnostics-modal', handleAnimatedClose, 30);
  }, [isOpen, handleAnimatedClose]);

  const refreshDiagnostics = () => {
    try {
      setEngineState(getEngineDiagnostics());
    } catch (e: any) {
      setEngineState({ error: e.message });
    }
  };

  useEffect(() => {
    if (isOpen) {
      refreshDiagnostics();
      const interval = setInterval(refreshDiagnostics, 1000);
      return () => clearInterval(interval);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const testStreamFetch = async () => {
    if (!currentTrack?.audioUrl) {
      setStreamTestResult('No audio URL present on current track');
      return;
    }
    setIsTestingStream(true);
    setStreamTestResult('Testing direct HTTP stream reachability...');
    try {
      const startTime = performance.now();
      const res = await fetch(currentTrack.audioUrl, {
        method: 'GET',
        headers: { Range: 'bytes=0-1024' }
      });
      const elapsed = Math.round(performance.now() - startTime);
      const cType = res.headers.get('content-type') || 'unknown';
      const cLen = res.headers.get('content-length') || '0';
      const ranges = res.headers.get('accept-ranges') || 'none';
      const finalUrl = res.url || currentTrack.audioUrl;

      setStreamTestResult(
        `HTTP ${res.status} ${res.statusText} (${elapsed}ms)\n` +
        `Final URL: ${finalUrl}\n` +
        `Content-Type: ${cType}\n` +
        `Content-Length: ${cLen} bytes\n` +
        `Accept-Ranges: ${ranges}\n` +
        `Audio Byte Verified: ${res.status === 200 || res.status === 206 ? 'YES' : 'NO'}`
      );
    } catch (err: any) {
      setStreamTestResult(`Direct Fetch FAILED: ${err.message || String(err)}`);
    } finally {
      setIsTestingStream(false);
    }
  };

  const fullDiagnostics = {
    timestamp: new Date().toISOString(),
    platform: {
      isNative: isNativePlatform(),
      isDev: isDevEnvironment(),
      capacitorPlatform: Capacitor.getPlatform(),
      isCapacitorNative: Capacitor.isNativePlatform(),
      protocol: typeof window !== 'undefined' ? window.location.protocol : 'N/A',
      hostname: typeof window !== 'undefined' ? window.location.hostname : 'N/A',
      origin: typeof window !== 'undefined' ? window.location.origin : 'N/A',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'N/A',
      isOnline: typeof navigator !== 'undefined' ? navigator.onLine : 'N/A',
    },
    track: currentTrack ? {
      id: currentTrack.id,
      title: currentTrack.title,
      artist: currentTrack.artistName,
      provider: currentTrack.provider,
      providerId: currentTrack.providerId,
      sourceType: currentTrack.sourceType || 'remote',
      isDownloaded: Boolean(currentTrack.isDownloaded),
      selectedQuality: audioQuality,
      activeQualityBitrate: currentTrack.actualBitrate || activeQuality?.label || '320 kbps',
      audioFormat: currentTrack.audioFormat || 'AAC / MP4',
      duration: currentTrack.duration,
      isPlayable: currentTrack.isPlayable,
      accessStatus: currentTrack.accessStatus,
      audioUrl: currentTrack.audioUrl,
      hasRawEncrypted: Boolean(currentTrack.rawEncryptedUrl),
    } : null,
    audioEngine: engineState,
    uiPlaying: isPlaying,
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(JSON.stringify(fullDiagnostics, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const validation = (engineState.validation as Record<string, unknown>) || null;

  return (
    <div
      onClick={handleAnimatedClose}
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md transition-opacity duration-220 ease-out ${
        isClosing ? 'opacity-0' : 'animate-in fade-in duration-150'
      }`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`bg-stuxs-surface border border-stuxs-border rounded-2xl w-full max-w-lg max-h-[88vh] flex flex-col shadow-2xl overflow-hidden transition-all duration-220 cubic-bezier(0.32, 0.72, 0, 1) ${
          isClosing ? 'scale-95 opacity-0' : 'animate-in zoom-in-95 duration-150'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-stuxs-border bg-stuxs-surface-secondary">
          <div className="flex items-center space-x-2">
            <Activity className="w-5 h-5 text-stuxs-accent animate-pulse" />
            <h2 className="text-sm font-bold text-stuxs-text tracking-wide uppercase">
              Playback Diagnostics
            </h2>
          </div>
          <button
            onClick={handleAnimatedClose}
            className="p-1.5 text-stuxs-text-muted hover:text-stuxs-text rounded-lg hover:bg-stuxs-surface-hover transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
          {/* Device & Platform Info */}
          <div className="bg-stuxs-bg/60 border border-white/5 rounded-xl p-3.5 space-y-2">
            <div className="flex items-center space-x-2 text-stuxs-accent font-semibold">
              <Smartphone className="w-4 h-4" />
              <span>Device & Environment</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-stuxs-text-secondary">
              <div>Platform: <span className="text-white font-mono">{Capacitor.getPlatform()} ({isNativePlatform() ? 'Native' : 'Web'})</span></div>
              <div>Network: <span className={navigator.onLine ? "text-emerald-400 font-mono" : "text-rose-400 font-mono"}>{navigator.onLine ? 'Online' : 'Offline'}</span></div>
              <div className="col-span-2">Origin: <span className="text-white font-mono">{window.location.origin}</span></div>
            </div>
          </div>

          {/* Current Track State */}
          <div className="bg-stuxs-bg/60 border border-white/5 rounded-xl p-3.5 space-y-2">
            <div className="flex items-center space-x-2 text-stuxs-accent font-semibold">
              <FileAudio className="w-4 h-4" />
              <span>Track Identity & Stream Validation</span>
            </div>
            {currentTrack ? (
              <div className="space-y-1.5 text-stuxs-text-secondary">
                <div>Title: <span className="text-white font-bold">{currentTrack.title}</span></div>
                <div>Artist: <span className="text-white">{currentTrack.artistName}</span></div>
                <div className="grid grid-cols-2 gap-1 pt-1">
                  <div>Provider ID: <span className="text-white font-mono">{currentTrack.id}</span></div>
                  <div>Source: <span className={currentTrack.isDownloaded ? "text-amber-400 font-semibold" : "text-cyan-400 font-semibold"}>{currentTrack.isDownloaded ? "Offline Download" : "Remote CDN"}</span></div>
                  <div>Quality: <span className="text-white font-mono">{currentTrack.actualBitrate || '320 kbps'}</span></div>
                  <div>Format: <span className="text-white font-mono">{currentTrack.audioFormat || 'AAC'}</span></div>
                </div>
                <div>Stream Resolved: <span className={currentTrack.audioUrl ? "text-emerald-400 font-semibold" : "text-rose-400 font-semibold"}>{currentTrack.audioUrl ? "YES" : "NO"}</span></div>
                {currentTrack.audioUrl && (
                  <div className="break-all text-[10px] bg-black/40 p-2 rounded border border-white/5 font-mono text-zinc-400">
                    {currentTrack.audioUrl}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-stuxs-text-muted italic">No track currently loaded</div>
            )}
          </div>

          {/* Stream Pre-Validation Result */}
          {validation && (
            <div className="bg-stuxs-bg/60 border border-white/5 rounded-xl p-3.5 space-y-2">
              <div className="flex items-center space-x-2 text-emerald-400 font-semibold">
                <ShieldCheck className="w-4 h-4" />
                <span>Pre-Playback HTTP Validation</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-stuxs-text-secondary">
                <div>Valid: <span className={validation.valid ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"}>{validation.valid ? 'YES (Playable)' : 'NO (Failed)'}</span></div>
                <div>HTTP Status: <span className="text-white font-mono">{String(validation.status || 'N/A')}</span></div>
                <div>Content-Type: <span className="text-white font-mono">{String(validation.contentType || 'N/A')}</span></div>
                <div>Latency: <span className="text-white font-mono">{String(validation.durationMs || 0)}ms</span></div>
              </div>
            </div>
          )}

          {/* Audio Engine Media & Dual Deck State */}
          <div className="bg-stuxs-bg/60 border border-white/5 rounded-xl p-3.5 space-y-2">
            <div className="flex items-center space-x-2 text-stuxs-accent font-semibold">
              <Volume2 className="w-4 h-4" />
              <span>Audio Pipeline & Hardware Output</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-stuxs-text-secondary">
              <div>Player State: <span className={!engineState.paused ? "text-emerald-400 font-bold" : "text-amber-400 font-bold"}>{!engineState.paused ? 'PLAYING' : 'PAUSED'}</span></div>
              <div>Active Deck: <span className="text-white font-mono font-bold">Deck {String(engineState.activeDeck || 'A')}</span></div>
              <div>Muted: <span className={engineState.muted ? "text-rose-400 font-bold" : "text-emerald-400 font-bold"}>{engineState.muted ? 'YES (Muted)' : 'NO (Unmuted)'}</span></div>
              <div>Final Hardware Output: <span className="text-emerald-400 font-mono font-bold">{Math.round(Number(engineState.finalOutputGain || engineState.volume || 0.85) * 100)}%</span></div>
              <div>Ready State: <span className="text-white font-mono">{String(engineState.readyStateLabel || engineState.readyState)}</span></div>
              <div>Network State: <span className="text-white font-mono">{String(engineState.networkStateLabel || engineState.networkState)}</span></div>
              <div>Current Time: <span className="text-white font-mono">{Number(engineState.currentTime || 0).toFixed(1)}s</span></div>
              <div>Duration: <span className="text-white font-mono">{Number(engineState.duration || 0).toFixed(1)}s</span></div>
              {Boolean(engineState.errorCode) && (
                <div className="col-span-2 text-rose-400 font-semibold bg-rose-500/10 p-2 rounded border border-rose-500/20">
                  Error Code: {String(engineState.errorCode)} ({String(engineState.errorMessage)})
                </div>
              )}
            </div>
          </div>

          {/* Gapless, Crossfade & Normalization Architecture */}
          <div className="bg-stuxs-bg/60 border border-white/5 rounded-xl p-3.5 space-y-2.5">
            <div className="flex items-center space-x-2 text-purple-400 font-semibold">
              <Activity className="w-4 h-4" />
              <span>Volume Gain Layers & DSP Stages</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-stuxs-text-secondary">
              <div>Master Volume: <span className="text-white font-mono">{Math.round(Number(engineState.masterVolume || 0.85) * 100)}%</span></div>
              <div>Normalization: <span className="text-white font-mono">{Number(engineState.normalizationGain || 1).toFixed(2)}x ({engineState.normalizeVolumeEnabled ? 'ON' : 'OFF'})</span></div>
              <div>Crossfade Gain: <span className="text-white font-mono">{Number(engineState.crossfadeGain || 1).toFixed(2)}x</span></div>
              <div>Crossfading Now: <span className={engineState.isCrossfading ? "text-purple-400 font-bold animate-pulse" : "text-zinc-400"}>{engineState.isCrossfading ? 'YES' : 'NO'}</span></div>
              <div>Gapless Enabled: <span className={engineState.gaplessEnabled ? "text-emerald-400 font-bold" : "text-zinc-500 font-bold"}>{engineState.gaplessEnabled ? 'YES' : 'NO'}</span></div>
              <div>Next Preloaded: <span className={engineState.nextTrackPreloaded ? "text-emerald-400 font-bold" : "text-amber-400 font-bold"}>{engineState.nextTrackPreloaded ? 'YES' : 'NO'}</span></div>
              {Boolean(engineState.preloadedTrackTitle) && (
                <div className="col-span-2 truncate text-[11px]">
                  Preloaded Song: <span className="text-white font-semibold">{String(engineState.preloadedTrackTitle)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Stream Reachability Test */}
          <div className="bg-stuxs-bg/60 border border-white/5 rounded-xl p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 text-stuxs-accent font-semibold">
                <Wifi className="w-4 h-4" />
                <span>Stream Network Test</span>
              </div>
              <button
                onClick={testStreamFetch}
                disabled={isTestingStream || !currentTrack?.audioUrl}
                className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-stuxs-accent text-white hover:opacity-90 disabled:opacity-50"
              >
                {isTestingStream ? 'Testing...' : 'Test HTTP Stream'}
              </button>
            </div>
            {streamTestResult && (
              <pre className="text-[11px] font-mono p-2.5 rounded bg-black/40 border border-white/5 text-zinc-300 whitespace-pre-wrap break-all">
                {streamTestResult}
              </pre>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-white/10 bg-stuxs-surface-secondary">
          <button
            onClick={refreshDiagnostics}
            className="flex items-center space-x-1.5 text-xs text-stuxs-text-secondary hover:text-white px-3 py-1.5 rounded-lg border border-white/10"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>

          <div className="flex items-center space-x-2">
            <button
              onClick={togglePlay}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white/10 text-white hover:bg-white/20"
            >
              Toggle Play/Pause
            </button>
            <button
              onClick={handleCopy}
              className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-stuxs-accent text-white hover:opacity-90 shadow-stuxs-glow"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied!' : 'Copy Full Diagnostics'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};