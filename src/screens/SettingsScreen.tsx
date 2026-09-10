import React, { useState, useMemo, Suspense } from 'react';
import {
  Sparkles,
  Check,
  AudioLines,
  Gauge,
  LogOut,
  Edit3,
  Heart,
  ListMusic,
  Users,
  Activity,
  RefreshCw,
  ArrowUpCircle,
} from 'lucide-react';
import { appUpdateService, type AppUpdateState } from '../services/AppUpdateService';
import { useSettings } from '../context/SettingsContext';
import { usePlayerActions } from '../context/PlayerContext';
import { useAuth } from '../context/AuthContext';
import { useLibrary } from '../context/LibraryContext';
import { BRAND_ACCENTS } from '../config/branding';
import { UserAvatar } from '../components/common/UserAvatar';
import { EditProfileModal } from '../components/modals/EditProfileModal';
import type { AudioQuality } from '../types/music';

const LivePlaybackDiagnosticsModal = React.lazy(
  () => import('../components/diagnostics/LivePlaybackDiagnosticsModal')
);


const QUALITY_DISPLAY_LABELS: Record<AudioQuality, string> = {
  very_high: 'Very High (320 kbps)',
  high: 'High (160 kbps)',
  normal: 'Normal (96 kbps)',
  saver: 'Saver (48 kbps)',
  lossless: 'Very High (320 kbps)',
};

interface SettingsScreenProps {
  onOpenAuth?: () => void;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = React.memo(({ onOpenAuth: _onOpenAuth }) => {
  const { playback, appearance, updatePlayback, setThemeMode, setAccentColor } = useSettings();
  const { setAudioQuality, resetPlayback } = usePlayerActions();
  const { user, profile, signOut, isDeveloper } = useAuth();
  const { favorites, playlists, savedPlaylists, localTracks, downloadedTracks } = useLibrary();

  const [isEditProfileOpen, setIsEditProfileOpen] = useState(false);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const [updateState, setUpdateState] = useState<AppUpdateState>(() =>
    appUpdateService.getState()
  );

  React.useEffect(() => {
    return appUpdateService.subscribe(setUpdateState);
  }, []);

  const handleLogout = async () => {
    resetPlayback();
    await signOut();
  };

  const displayName = profile?.display_name || user?.user_metadata?.display_name || 'STUXS Listener';
  // Only show real email — never show a fabricated fallback
  const email = user?.email || null;
  const avatarUrl = profile?.avatar_url || user?.user_metadata?.avatar_url || user?.user_metadata?.picture || null;
  // Only show real phone — never fabricate
  const phoneNumber = (profile as Record<string, any>)?.phone || (user as any)?.user_metadata?.phone || null;

  // Compute actual saved artists count
  const savedArtistsCount = useMemo(() => {
    const allTracks = [...favorites, ...localTracks, ...downloadedTracks];
    for (const p of playlists) {
      if (p.songs) allTracks.push(...p.songs);
    }
    for (const p of savedPlaylists) {
      if (p.songs) allTracks.push(...p.songs);
    }

    const seen = new Set<string>();
    for (const t of allTracks) {
      if (t.artistName) seen.add(t.artistName);
    }
    return seen.size;
  }, [favorites, playlists, savedPlaylists, localTracks, downloadedTracks]);

  const handleQualityChange = (quality: AudioQuality) => {
    updatePlayback({ audioQuality: quality });
    setAudioQuality(quality);
  };

  const qualityOptions: { id: AudioQuality; label: string; bitrate: string; desc: string }[] = [
    { id: 'very_high', label: 'Very High', bitrate: '320 kbps', desc: 'Highest fidelity AAC stream' },
    { id: 'high', label: 'High', bitrate: '160 kbps', desc: 'Standard high-quality stream' },
    { id: 'normal', label: 'Normal', bitrate: '96 kbps', desc: 'Balanced stream for data saving' },
    { id: 'saver', label: 'Saver', bitrate: '48 kbps', desc: 'Lowest bandwidth usage' },
  ];

  return (
    <div className="animate-in fade-in duration-200 min-h-screen bg-gradient-to-b from-[#7C3AED]/12 via-[#6366F1]/06 to-transparent dark:from-[#1E1138]/60 dark:via-[#140C24]/40 dark:to-transparent">
      {/* Top Header with STUXS Atmosphere */}
      <div className="px-5 safe-top-header pt-2 pb-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl sm:text-[26px] font-black tracking-tight text-stuxs-text">
              Profile & Settings
            </h1>
            <p className="text-xs font-medium text-stuxs-text-secondary mt-0.5">
              Account, preferences & playback
            </p>
          </div>
          <button
            onClick={() => setIsEditProfileOpen(true)}
            className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-full bg-white/80 dark:bg-white/10 hover:bg-white dark:hover:bg-white/15 border border-black/5 dark:border-white/10 text-xs font-semibold text-stuxs-text active:scale-95 transition-all cursor-pointer shadow-xs"
          >
            <Edit3 className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
            <span>Edit</span>
          </button>
        </div>
      </div>

      {/* Main Content Sheet: Rounded Warm Cream / Deep Dark Surface */}
      <div className="rounded-t-[36px] sm:rounded-t-[40px] bg-[#FAF8F5] dark:bg-[#121218] min-h-screen px-4 sm:px-5 pt-5 pb-36 shadow-xl transition-colors">
        <div className="space-y-6 max-w-xl mx-auto">
          {/* Profile Card */}
          <section className="flex flex-col items-center text-center space-y-3 pt-1">
            {/* Avatar */}
            <div
              className="relative cursor-pointer group"
              onClick={() => setIsEditProfileOpen(true)}
            >
              <UserAvatar
                name={displayName}
                email={user?.email}
                avatarUrl={avatarUrl}
                size="xl"
                className="ring-4 ring-purple-500/20 hover:ring-purple-500/40 transition-all hover:scale-105"
              />
            </div>

            {/* Name */}
            <h2 className="text-xl font-bold text-stuxs-text tracking-tight">
              {displayName}
            </h2>

            {/* Contact Details */}
            <div className="w-full space-y-2.5 pt-1 text-left">
              <div className="p-3.5 rounded-2xl bg-stuxs-surface-secondary/35 border border-stuxs-border/40">
                <span className="text-[11px] font-bold uppercase tracking-wider text-stuxs-text-muted block">
                  Email
                </span>
                <p className={`text-sm font-medium mt-0.5 truncate ${email ? 'text-stuxs-text select-all' : 'text-stuxs-text-muted'}`}>
                  {email ?? '—'}
                </p>
              </div>

              <div className="p-3.5 rounded-2xl bg-stuxs-surface-secondary/35 border border-stuxs-border/40">
                <span className="text-[11px] font-bold uppercase tracking-wider text-stuxs-text-muted block">
                  Phone Number
                </span>
                <p className={`text-sm font-medium mt-0.5 truncate ${phoneNumber ? 'text-stuxs-text select-all' : 'text-stuxs-text-muted'}`}>
                  {phoneNumber ?? '—'}
                </p>
              </div>
            </div>
          </section>

          {/* 3 Stats Cards in a row */}
          <section className="grid grid-cols-3 gap-2.5">
            {/* Card 1: Liked Songs */}
            <div className="p-3.5 rounded-2xl bg-stuxs-surface-secondary/35 border border-stuxs-border/40 text-center flex flex-col items-center justify-center space-y-1.5 shadow-xs">
              <div className="w-8 h-8 rounded-xl bg-rose-500/10 flex items-center justify-center">
                <Heart className="w-4 h-4 text-rose-500 fill-rose-500" />
              </div>
              <div>
                <span className="text-base font-black text-stuxs-text block leading-tight">
                  {favorites.length}
                </span>
                <span className="text-[10px] text-stuxs-text-secondary font-semibold block mt-0.5">
                  {favorites.length === 1 ? 'Song' : 'Songs'}
                </span>
              </div>
            </div>

            {/* Card 2: Playlists */}
            <div className="p-3.5 rounded-2xl bg-stuxs-surface-secondary/35 border border-stuxs-border/40 text-center flex flex-col items-center justify-center space-y-1.5 shadow-xs">
              <div className="w-8 h-8 rounded-xl bg-purple-500/10 flex items-center justify-center">
                <ListMusic className="w-4 h-4 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <span className="text-base font-black text-stuxs-text block leading-tight">
                  {playlists.length + savedPlaylists.length}
                </span>
                <span className="text-[10px] text-stuxs-text-secondary font-semibold block mt-0.5">
                  {playlists.length + savedPlaylists.length === 1 ? 'Playlist' : 'Playlists'}
                </span>
              </div>
            </div>

            {/* Card 3: Artists */}
            <div className="p-3.5 rounded-2xl bg-stuxs-surface-secondary/35 border border-stuxs-border/40 text-center flex flex-col items-center justify-center space-y-1.5 shadow-xs">
              <div className="w-8 h-8 rounded-xl bg-pink-500/10 flex items-center justify-center">
                <Users className="w-4 h-4 text-pink-500" />
              </div>
              <div>
                <span className="text-base font-black text-stuxs-text block leading-tight">
                  {savedArtistsCount}
                </span>
                <span className="text-[10px] text-stuxs-text-secondary font-semibold block mt-0.5">
                  {savedArtistsCount === 1 ? 'Artist' : 'Artists'}
                </span>
              </div>
            </div>
          </section>

          {/* Settings Header */}
          <div className="pt-2">
            <h2 className="text-xl font-bold tracking-tight text-stuxs-text">
              Settings
            </h2>
            <p className="text-xs text-stuxs-text-secondary mt-0.5">
              Playback preferences & app configuration
            </p>
          </div>

          {/* Section 1: Playback & Streaming Quality */}
          <section className="space-y-3">
            <div className="flex items-center space-x-2 text-xs font-bold uppercase tracking-wider text-stuxs-text-muted">
              <AudioLines className="w-4 h-4 text-purple-600 dark:text-purple-400" />
              <span>Playback</span>
            </div>

            <div className="rounded-2xl bg-stuxs-surface-secondary/35 border border-stuxs-border/40 divide-y divide-stuxs-border/30 overflow-hidden shadow-xs">
              {/* Audio Quality */}
              <div className="p-4">
                <div className="flex justify-between items-center mb-2.5">
                  <div className="flex items-center space-x-2">
                    <Gauge className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                    <div>
                      <h4 className="text-sm font-semibold text-stuxs-text">Streaming Quality</h4>
                      <p className="text-xs text-stuxs-text-secondary">
                        Select preferred stream bitrate
                      </p>
                    </div>
                  </div>
                  <span className="text-xs font-bold text-purple-600 dark:text-purple-400 px-2.5 py-0.5 rounded-full bg-purple-600/15">
                    {QUALITY_DISPLAY_LABELS[playback.audioQuality] || 'Very High'}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1.5">
                  {qualityOptions.map((q) => {
                    const isSelected =
                      playback.audioQuality === q.id ||
                      (q.id === 'very_high' && playback.audioQuality === 'lossless');
                    return (
                      <button
                        key={q.id}
                        onClick={() => handleQualityChange(q.id)}
                        className={`p-2.5 rounded-xl text-left transition-all border cursor-pointer ${
                          isSelected
                            ? 'bg-purple-600/15 border-purple-500 text-stuxs-text shadow-sm'
                            : 'bg-white/60 dark:bg-white/5 border-stuxs-border/50 text-stuxs-text-secondary hover:bg-white dark:hover:bg-white/10'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-stuxs-text">{q.label}</span>
                          {isSelected && <Check className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />}
                        </div>
                        <span className="text-[10px] text-purple-600 dark:text-purple-400 font-semibold block mt-0.5">{q.bitrate}</span>
                        <span className="text-[9px] text-stuxs-text-muted line-clamp-1 mt-0.5">{q.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Crossfade */}
              <div className="p-4 flex items-center justify-between">
                <div className="pr-3">
                  <div className="flex items-center space-x-2">
                    <h4 className="text-sm font-semibold text-stuxs-text">Crossfade</h4>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 font-bold uppercase tracking-wider">
                      Unavailable
                    </span>
                  </div>
                  <p className="text-xs text-stuxs-text-secondary mt-0.5">
                    Simultaneous crossfade requires dual-deck mixing. Gapless playback is active.
                  </p>
                </div>
                <span className="text-xs font-bold text-stuxs-text-muted px-2.5 py-1 rounded-lg bg-black/5 dark:bg-white/10 shrink-0">
                  {playback.crossfadeSeconds}s
                </span>
              </div>

              {/* Gapless Playback */}
              <div className="p-4 flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-semibold text-stuxs-text">Gapless Playback</h4>
                  <p className="text-xs text-stuxs-text-secondary">
                    Continuous playback without silent pauses
                  </p>
                </div>
                <button
                  onClick={() => updatePlayback({ gaplessPlayback: !playback.gaplessPlayback })}
                  className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
                    playback.gaplessPlayback ? 'bg-purple-600' : 'bg-stuxs-surface-tertiary'
                  }`}
                  aria-label="Toggle Gapless Playback"
                >
                  <div
                    className={`w-4 h-4 rounded-full bg-white transition-transform absolute top-1 ${
                      playback.gaplessPlayback ? 'right-1' : 'left-1'
                    }`}
                  />
                </button>
              </div>

              {/* Normalize Volume */}
              <div className="p-4 flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-semibold text-stuxs-text">Normalize Volume</h4>
                  <p className="text-xs text-stuxs-text-secondary">
                    Equalize loudness across all albums
                  </p>
                </div>
                <button
                  onClick={() => updatePlayback({ normalizeVolume: !playback.normalizeVolume })}
                  className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
                    playback.normalizeVolume ? 'bg-purple-600' : 'bg-stuxs-surface-tertiary'
                  }`}
                  aria-label="Toggle Normalize Volume"
                >
                  <div
                    className={`w-4 h-4 rounded-full bg-white transition-transform absolute top-1 ${
                      playback.normalizeVolume ? 'right-1' : 'left-1'
                    }`}
                  />
                </button>
              </div>
            </div>
          </section>

          {/* Section 2: Appearance & STUXS Theme */}
          <section className="space-y-3">
            <div className="flex items-center space-x-2 text-xs font-bold uppercase tracking-wider text-stuxs-text-muted">
              <Sparkles className="w-4 h-4 text-purple-600 dark:text-purple-400" />
              <span>Appearance & Theme</span>
            </div>

            <div className="rounded-2xl bg-stuxs-surface-secondary/35 border border-stuxs-border/40 divide-y divide-stuxs-border/30 overflow-hidden shadow-xs">
              {/* Theme Mode Selector (System, Light, Dark) */}
              <div className="p-4">
                <h4 className="text-sm font-semibold text-stuxs-text mb-1">Theme Mode</h4>
                <p className="text-xs text-stuxs-text-secondary mb-3">
                  Choose between system default, light, or dark mode
                </p>

                <div className="grid grid-cols-3 gap-2 bg-white/60 dark:bg-white/5 p-1 rounded-xl border border-stuxs-border/50">
                  {(['system', 'light', 'dark'] as const).map((mode) => {
                    const isSelected = appearance.themeMode === mode;
                    return (
                      <button
                        key={mode}
                        onClick={() => setThemeMode(mode)}
                        className={`py-2 px-3 rounded-lg text-xs font-bold capitalize transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-purple-600 text-white shadow-sm'
                            : 'text-stuxs-text-secondary hover:text-stuxs-text'
                        }`}
                      >
                        {mode}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Accent Color Palette */}
              <div className="p-4">
                <h4 className="text-sm font-semibold text-stuxs-text mb-1">Accent Color</h4>
                <p className="text-xs text-stuxs-text-secondary mb-3">
                  Customize the visual highlights throughout the app
                </p>

                <div className="grid grid-cols-4 sm:grid-cols-7 gap-2.5 pt-1">
                  {BRAND_ACCENTS.map((accent) => {
                    const isSelected = appearance.accentColor.toLowerCase() === accent.color.toLowerCase();
                    return (
                      <button
                        key={accent.id}
                        onClick={() => setAccentColor(accent.color)}
                        className="flex flex-col items-center space-y-1.5 group cursor-pointer"
                        title={accent.name}
                      >
                        <div
                          className="w-10 h-10 rounded-full flex items-center justify-center transition-transform group-hover:scale-110 shadow-sm"
                          style={{ backgroundColor: accent.color }}
                        >
                          {isSelected && <Check className="w-5 h-5 text-white drop-shadow" />}
                        </div>
                        <span className="text-[10px] text-stuxs-text-secondary group-hover:text-stuxs-text">
                          {accent.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>

          {/* Section 3: Diagnostics & System — Developer only */}
          {isDeveloper && (
            <section className="space-y-3">
              <div className="flex items-center space-x-2 text-xs font-bold uppercase tracking-wider text-stuxs-text-muted">
                <Activity className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                <span>System & Diagnostics</span>
              </div>

              <div className="p-4 rounded-2xl bg-stuxs-surface-secondary/35 border border-stuxs-border/40 flex items-center justify-between shadow-xs">
                <div>
                  <h4 className="text-sm font-semibold text-stuxs-text">Live Playback & OEM Diagnostics</h4>
                  <p className="text-xs text-stuxs-text-secondary mt-0.5">
                    Inspect live Media3/WebAudio engine state and device health
                  </p>
                </div>
                <button
                  onClick={() => setIsDiagnosticsOpen(true)}
                  className="px-3.5 py-1.5 rounded-full bg-white/80 dark:bg-white/10 hover:bg-white dark:hover:bg-white/15 border border-black/5 dark:border-white/10 text-xs font-bold text-purple-600 dark:text-purple-400 active:scale-95 transition-all cursor-pointer shadow-xs"
                >
                  Open
                </button>
              </div>
            </section>
          )}

          {/* Section 4: App Updates */}
          <section className="space-y-3">
            <div className="flex items-center space-x-2 text-xs font-bold uppercase tracking-wider text-stuxs-text-muted">
              <ArrowUpCircle className="w-4 h-4 text-purple-600 dark:text-purple-400" />
              <span>App Updates</span>
            </div>

            <div className="p-4 rounded-2xl bg-stuxs-surface-secondary/35 border border-stuxs-border/40 flex items-center justify-between shadow-xs">
              <div className="space-y-0.5">
                <div className="flex items-center space-x-2">
                  <h4 className="text-sm font-semibold text-stuxs-text">
                    STUXS Music v{updateState.installedVersion.versionName}
                  </h4>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-stuxs-surface-secondary border border-stuxs-border text-stuxs-text-secondary">
                    Build {updateState.installedVersion.versionCode}
                  </span>
                </div>
                <p className="text-xs text-stuxs-text-secondary">
                  {updateState.status === 'CHECKING' && 'Checking for updates...'}
                  {updateState.status === 'UP_TO_DATE' && "You're using the latest version."}
                  {updateState.status === 'UPDATE_AVAILABLE' && (
                    <span className="text-purple-600 dark:text-purple-400 font-semibold">
                      Version {updateState.manifest?.latestVersion} available
                    </span>
                  )}
                  {updateState.status === 'DOWNLOADING' && 'Downloading update in background...'}
                  {updateState.status === 'READY_TO_INSTALL' && 'Update verified and ready to install.'}
                  {updateState.status === 'FAILED' && (
                    <span className="text-rose-500">
                      {updateState.error || 'Check failed (tap to retry)'}
                    </span>
                  )}
                  {updateState.status === 'IDLE' && 'Direct self-hosted release updates'}
                </p>
              </div>

              <button
                onClick={() => appUpdateService.checkForUpdates(true)}
                disabled={updateState.status === 'CHECKING' || updateState.status === 'DOWNLOADING'}
                className="px-3.5 py-1.5 rounded-full bg-white/80 dark:bg-white/10 hover:bg-white dark:hover:bg-white/15 border border-black/5 dark:border-white/10 text-xs font-bold text-purple-600 dark:text-purple-400 active:scale-95 transition-all cursor-pointer shadow-xs disabled:opacity-50 flex items-center space-x-1.5"
              >
                {updateState.status === 'CHECKING' ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Checking...</span>
                  </>
                ) : updateState.status === 'UPDATE_AVAILABLE' ? (
                  <span>View Update</span>
                ) : (
                  <span>Check for Updates</span>
                )}
              </button>
            </div>
          </section>

          {/* Section 5: Sign Out */}
          <section className="pt-2">
            <button
              onClick={handleLogout}
              className="w-full py-3 px-4 rounded-2xl bg-rose-500/10 hover:bg-rose-500/20 active:scale-98 text-rose-600 dark:text-rose-400 font-bold text-xs transition-colors border border-rose-500/20 flex items-center justify-center space-x-2 cursor-pointer shadow-xs"
            >
              <LogOut className="w-4 h-4 text-rose-500" />
              <span>Sign Out from STUXS</span>
            </button>
          </section>
        </div>
      </div>

      {/* Edit Profile Modal */}
      <EditProfileModal
        isOpen={isEditProfileOpen}
        onClose={() => setIsEditProfileOpen(false)}
      />

      {/* Live Playback Diagnostics Modal */}
      {isDiagnosticsOpen && (
        <Suspense fallback={null}>
          <LivePlaybackDiagnosticsModal
            isOpen={isDiagnosticsOpen}
            onClose={() => setIsDiagnosticsOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
});

SettingsScreen.displayName = 'SettingsScreen';
