import React, { useState, useEffect, useCallback } from 'react';
import { X, RefreshCw, Smartphone, ShieldCheck, BatteryCharging, Bell, Music, CheckCircle2, AlertTriangle, XCircle, ExternalLink } from 'lucide-react';
import { usePlayer } from '../../context/PlayerContext';
import { isNativePlatform } from '../../utils/platform';
import { liveActivityManager, type OEMCapabilityInfo } from '../../services/LiveActivityManager';
import type { NativePlaybackDiagnostics } from '../../utils/nativeMediaSession';
import { BUILD_INFO } from '../../config/branding';

interface LivePlaybackDiagnosticsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const LivePlaybackDiagnosticsModal: React.FC<LivePlaybackDiagnosticsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { currentTrack, isPlaying } = usePlayer();
  const [diagnostics, setDiagnostics] = useState<NativePlaybackDiagnostics | null>(null);
  const [oemInfo, setOemInfo] = useState<OEMCapabilityInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchDiagnostics = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await liveActivityManager.getDiagnostics();
      setDiagnostics(data);
      const oem = liveActivityManager.detectOEM(data?.deviceManufacturer || '');
      setOemInfo(oem);
    } catch (err) {
      console.warn('[Diagnostics] Failed to load data:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchDiagnostics();
      const interval = setInterval(fetchDiagnostics, 3000);
      return () => clearInterval(interval);
    }
  }, [isOpen, fetchDiagnostics]);

  if (!isOpen) return null;

  const isNative = isNativePlatform();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="bg-[#121218] border border-white/10 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-white/[0.02]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center border border-purple-500/30">
              <Smartphone size={20} />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Live Playback Diagnostics</h2>
              <p className="text-xs text-white/50">Native MediaSession & OEM Capsule Health</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchDiagnostics}
              disabled={isLoading}
              className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-colors"
              title="Refresh Diagnostics"
            >
              <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-5 text-sm">
          {/* Build Version & Deployment Verification Card */}
          <div className="bg-purple-500/10 border border-purple-500/25 rounded-xl p-4 space-y-2.5">
            <div className="text-xs font-semibold uppercase tracking-wider text-purple-300 flex items-center justify-between">
              <span className="flex items-center gap-1.5 font-bold">
                <ShieldCheck size={14} className="text-purple-400" /> Frontend Build Verification
              </span>
              <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-purple-500/25 text-purple-200 border border-purple-500/40">
                {isNative ? 'Native Android APK' : 'Web Browser'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-white/40 block">Build ID:</span>
                <span className="text-white font-mono font-medium">{BUILD_INFO.buildId}</span>
              </div>
              <div>
                <span className="text-white/40 block">Build Marker:</span>
                <span className="text-purple-200 font-mono font-bold">{BUILD_INFO.marker}</span>
              </div>
              <div>
                <span className="text-white/40 block">App Version:</span>
                <span className="text-white font-medium">v{BUILD_INFO.version}</span>
              </div>
              <div>
                <span className="text-white/40 block">Assets Location:</span>
                <span className="text-white/80 font-mono text-[11px]">{isNative ? 'Bundled in APK' : 'Live Web Host'}</span>
              </div>
            </div>
          </div>

          {/* Device & OEM info */}
          <div className="bg-white/[0.03] border border-white/5 rounded-xl p-4 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-purple-400 flex items-center gap-2">
              <Smartphone size={14} /> Device & OEM System
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-white/40 block">Manufacturer:</span>
                <span className="text-white font-medium">{diagnostics?.deviceManufacturer || (isNative ? 'Android' : 'Web Browser')}</span>
              </div>
              <div>
                <span className="text-white/40 block">Model / Brand:</span>
                <span className="text-white font-medium">{diagnostics?.deviceModel || diagnostics?.deviceBrand || 'Universal'}</span>
              </div>
              <div>
                <span className="text-white/40 block">Android OS:</span>
                <span className="text-white font-medium">{diagnostics?.androidVersion ? `Android ${diagnostics.androidVersion} (API ${diagnostics.sdkInt})` : 'Web Host'}</span>
              </div>
              <div>
                <span className="text-white/40 block">OEM Platform:</span>
                <span className="text-white font-medium">{oemInfo?.displayName || 'Standard'}</span>
              </div>
            </div>
          </div>

          {/* Core MediaSession & Service Health */}
          <div className="bg-white/[0.03] border border-white/5 rounded-xl p-4 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-blue-400 flex items-center gap-2">
              <Music size={14} /> Native Media Stack
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between py-1 border-b border-white/5">
                <span className="text-white/70">Audio Engine Playing</span>
                <span className={`flex items-center gap-1.5 font-medium ${isPlaying ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {isPlaying ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                  {isPlaying ? 'YES (Active)' : 'PAUSED'}
                </span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-white/5">
                <span className="text-white/70">Native Foreground Service</span>
                <span className={`flex items-center gap-1.5 font-medium ${diagnostics?.isForegroundRunning ? 'text-emerald-400' : (isPlaying ? 'text-amber-400' : 'text-white/50')}`}>
                  {diagnostics?.isForegroundRunning ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                  {diagnostics?.isForegroundRunning ? 'RUNNING' : (isNative ? 'STANDBY' : 'N/A (Web)')}
                </span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-white/5">
                <span className="text-white/70">MediaSessionCompat Active</span>
                <span className={`flex items-center gap-1.5 font-medium ${diagnostics?.isMediaSessionActive ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {diagnostics?.isMediaSessionActive ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                  {diagnostics?.isMediaSessionActive ? 'ACTIVE (TRUE)' : (isNative ? 'INACTIVE' : 'WEB SESSION')}
                </span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-white/5">
                <span className="text-white/70">PlaybackState State</span>
                <span className="font-mono text-xs px-2 py-0.5 rounded bg-white/10 text-purple-300">
                  {diagnostics?.playbackState || (isPlaying ? 'PLAYING' : 'PAUSED')}
                </span>
              </div>

              <div className="flex items-center justify-between py-1">
                <span className="text-white/70">Track Synced to Native</span>
                <span className="text-white font-medium text-right truncate max-w-[200px]" title={diagnostics?.currentTitle || currentTrack?.title || ''}>
                  {diagnostics?.currentTitle || currentTrack?.title || 'None'}
                </span>
              </div>
            </div>
          </div>

          {/* OEM Permissions & Background Execution */}
          <div className="bg-white/[0.03] border border-white/5 rounded-xl p-4 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-amber-400 flex items-center gap-2">
              <ShieldCheck size={14} /> OEM Permissions & Background Health
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between py-1 border-b border-white/5">
                <span className="text-white/70 flex items-center gap-2">
                  <Bell size={14} className="text-white/40" /> Notification Permission
                </span>
                <span className={`flex items-center gap-1.5 font-medium ${diagnostics?.hasNotificationPermission ? 'text-emerald-400' : 'text-red-400'}`}>
                  {diagnostics?.hasNotificationPermission ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                  {diagnostics?.hasNotificationPermission ? 'GRANTED' : 'RESTRICTED'}
                </span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-white/5">
                <span className="text-white/70 flex items-center gap-2">
                  <BatteryCharging size={14} className="text-white/40" /> Battery Optimization
                </span>
                <span className={`flex items-center gap-1.5 font-medium ${diagnostics?.isIgnoringBatteryOptimizations ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {diagnostics?.isIgnoringBatteryOptimizations ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                  {diagnostics?.isIgnoringBatteryOptimizations ? 'UNRESTRICTED' : 'OPTIMIZED (May Restrict)'}
                </span>
              </div>

              <div className="flex items-center justify-between py-1">
                <span className="text-white/70">OEM Capsule Support</span>
                <span className="text-emerald-400 font-medium">
                  {oemInfo?.capsuleFeatureName || 'Standard Media Player'}
                </span>
              </div>
            </div>

            {oemInfo?.recommendedSettingsHint && (
              <div className="mt-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs text-amber-200/90 leading-relaxed">
                <strong className="text-amber-300 block mb-1">OEM Recommendation:</strong>
                {oemInfo.recommendedSettingsHint}
              </div>
            )}
          </div>

          {/* Quick System Action Buttons */}
          {isNative && (
            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                onClick={() => liveActivityManager.openNotificationSettings()}
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-medium transition-colors"
              >
                <Bell size={14} /> Notification Settings
              </button>
              <button
                onClick={() => liveActivityManager.openBatterySettings()}
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium transition-colors"
              >
                <BatteryCharging size={14} /> Battery Permissions <ExternalLink size={12} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LivePlaybackDiagnosticsModal;



