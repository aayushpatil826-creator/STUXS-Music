import React, { createContext, useContext, useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { Track, RepeatMode, AudioQuality } from '../types/music';
import { WebAudioPlaybackEngine } from '../providers/playback/WebAudioPlaybackEngine';
import { providerRegistry } from '../providers/ProviderRegistry';
import { JioSaavnProvider } from '../providers/jiosaavn/JioSaavnProvider';
import {
  resolveActiveStreamQuality,
  mapJioSaavnUrlToQuality,
  type ActiveStreamQuality,
} from '../utils/audioQuality';
import { smartQueueService } from '../services/SmartQueueService';
import { localRecommendationEngine } from '../services/recommendationEngine';
import { useLibrary } from './LibraryContext';
import { useToast } from './ToastContext';
import { updateNativeMediaMetadata, updateNativePlaybackState, stopNativeMediaSession, initNativeMediaActionListener } from '../utils/nativeMediaSession';
import { playbackProgressEmitter } from '../services/playbackEvents';
import { downloadService } from '../services/DownloadService';
import { LocalMusicService } from '../services/LocalMusicService';
import { nativePlaybackController } from '../services/nativePlaybackController';
import { nativePlaybackBridge } from '../services/nativePlaybackBridge';
import { nativeMigrationService } from '../services/NativeMigrationService';

export type PlaybackSource =
  | 'library-playlist'
  | 'search'
  | 'home'
  | 'album'
  | 'artist'
  | 'individual'
  | null;

export interface ActiveLibraryPlaylistInfo {
  id: string;
  name: string;
  tracks: Track[];
}

export interface PlayTrackOptions {
  source?: PlaybackSource;
  id?: string;
  name?: string;
  shuffle?: boolean;
  reason?: 'home' | 'search' | 'playlist' | 'next' | 'previous' | 'auto-next' | 'notification' | 'recovery' | 'direct' | string;
  autoplay?: boolean;
  initialPosition?: number;
}

export interface PlayerContextType {
  // Playback state
  currentTrack: Track | null;
  isPlaying: boolean;
  isLoadingTrack: boolean;
  progress: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  queue: Track[];
  manualQueue: Track[];
  smartQueue: Track[];
  queueIndex: number;
  isShuffled: boolean;
  repeatMode: RepeatMode;
  audioQuality: AudioQuality;
  activeQuality: ActiveStreamQuality;
  smartQueueEnabled: boolean;
  playbackSource: PlaybackSource;
  activeLibraryPlaylist: ActiveLibraryPlaylistInfo | null;

  // Modals & Drawers state
  isNowPlayingOpen: boolean;
  isQueueOpen: boolean;
  isLyricsOpen: boolean;
  isDevicePickerOpen: boolean;
  activeDevice: string;

  // Actions
  playTrack: (track: Track, newQueue?: Track[], options?: PlayTrackOptions) => void;
  togglePlay: () => void;
  pause: () => void;
  resume: () => void;
  seek: (position: number) => void;
  setVolume: (vol: number) => void;
  toggleMute: () => void;
  nextTrack: () => void;
  prevTrack: () => void;
  toggleShuffle: () => void;
  toggleSmartQueue: () => void;
  setSmartQueueEnabled: (enabled: boolean) => void;
  setAudioQuality: (quality: AudioQuality) => void;
  cycleRepeatMode: () => void;
  addToQueue: (track: Track) => void;
  playNext: (track: Track) => void;
  removeFromQueue: (index: number) => void;
  clearQueue: () => void;
  reorderQueue: (startIndex: number, endIndex: number) => void;
  startSongRadio: (track: Track) => Promise<void>;
  dismissSmartQueueTrack: (trackId: string) => void;
  addSmartQueueTrackToManual: (track: Track) => void;
  setIsNowPlayingOpen: (open: boolean) => void;
  setIsQueueOpen: (open: boolean) => void;
  setIsLyricsOpen: (open: boolean) => void;
  setIsDevicePickerOpen: (open: boolean) => void;
  setActiveDevice: (device: string) => void;
  getEngineDiagnostics: () => Record<string, unknown>;
  resetPlayback: () => void;
  isNativeEngineActive: boolean;
  toggleNativeEngine: () => void;
  playbackState: string;
  hasNext: boolean;
  hasPrevious: boolean;
}

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);

export const PlayerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { addToRecentlyPlayed } = useLibrary();
  const { showToast } = useToast();

  // Playback state
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(0.85);
  const [isMuted, setIsMuted] = useState(false);
  const [isLoadingTrack, setIsLoadingTrack] = useState(false);
  const [isNativeEngineActive, setIsNativeEngineActive] = useState<boolean>(() => nativePlaybackController.isNativeModeActive());
  const [playbackState, setPlaybackState] = useState<string>('IDLE');

  // Manual & Context queues
  const [queue, setQueue] = useState<Track[]>([]);
  const [manualQueue, setManualQueue] = useState<Track[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [isShuffled, setIsShuffled] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('off');

  // Real Audio Quality Setting
  const [audioQuality, setAudioQualityState] = useState<AudioQuality>(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = window.localStorage.getItem('stuxs_playback_settings');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.audioQuality) return parsed.audioQuality;
        }
      }
    } catch {}
    return 'very_high';
  });

  // Reliable Playback Origin & Active Library Playlist Session State
  const [playbackSource, setPlaybackSource] = useState<PlaybackSource>(null);
  const [activeLibraryPlaylist, setActiveLibraryPlaylist] = useState<ActiveLibraryPlaylistInfo | null>(null);

  // Smart Queue State (ONLY enabled when playing a Library playlist and explicitly activated by user)
  const [smartQueueEnabled, setSmartQueueEnabledState] = useState<boolean>(false);

  // Smart Queue recommendations state
  const [smartQueue, setSmartQueue] = useState<Track[]>([]);

  // UI Modals state
  const [isNowPlayingOpen, setIsNowPlayingOpen] = useState(false);
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [isLyricsOpen, setIsLyricsOpen] = useState(false);
  const [isDevicePickerOpen, setIsDevicePickerOpen] = useState(false);
  const [activeDevice, setActiveDevice] = useState('Android Hi-Res Output');

  // Single persistent playback engine instance
  const engineRef = useRef<WebAudioPlaybackEngine>(new WebAudioPlaybackEngine());
  const originalQueueRef = useRef<Track[]>([]);
  const recentlyPlayedIdsRef = useRef<Set<string>>(new Set());

  // Synchronized state references to prevent stale closures
  const progressRef = useRef<number>(progress);
  progressRef.current = progress;

  const durationRef = useRef<number>(duration);
  durationRef.current = duration;

  const queueRef = useRef<Track[]>(queue);
  queueRef.current = queue;

  const manualQueueRef = useRef<Track[]>(manualQueue);
  manualQueueRef.current = manualQueue;

  const smartQueueRef = useRef<Track[]>(smartQueue);
  smartQueueRef.current = smartQueue;

  const queueIndexRef = useRef<number>(queueIndex);
  queueIndexRef.current = queueIndex;

  const currentTrackRef = useRef<Track | null>(currentTrack);
  currentTrackRef.current = currentTrack;

  const isPlayingRef = useRef<boolean>(isPlaying);
  isPlayingRef.current = isPlaying;

  // Phase 6 Step 6: Cooperative playback gating for background migration (with 3s idle grace period)
  useEffect(() => {
    nativeMigrationService.notifyPlaybackState(isPlaying || isLoadingTrack, 3000);
  }, [isPlaying, isLoadingTrack]);

  const isShuffledRef = useRef<boolean>(isShuffled);
  isShuffledRef.current = isShuffled;

  const repeatModeRef = useRef<RepeatMode>(repeatMode);
  repeatModeRef.current = repeatMode;

  const smartQueueEnabledRef = useRef<boolean>(smartQueueEnabled);
  smartQueueEnabledRef.current = smartQueueEnabled;

  const playbackSourceRef = useRef<PlaybackSource>(playbackSource);
  playbackSourceRef.current = playbackSource;

  const activeLibraryPlaylistRef = useRef<ActiveLibraryPlaylistInfo | null>(activeLibraryPlaylist);
  activeLibraryPlaylistRef.current = activeLibraryPlaylist;

  const playbackStateRef = useRef<string>(playbackState);
  playbackStateRef.current = playbackState;

  const currentErrorRef = useRef<string | null>(null);
  const lastSyncedQueueIdsRef = useRef<string>('');
  const playbackGenerationRef = useRef<number>(0);
  const qualitySwitchTokenRef = useRef<number>(0);
  const activeAbortControllerRef = useRef<AbortController | null>(null);
  const isTransitioningRef = useRef<boolean>(false);

  const onTrackEndedRef = useRef<() => void>(() => {});
  const nextTrackRef = useRef<() => void>(() => {});
  const prevTrackRef = useRef<() => void>(() => {});
  const resumeRef = useRef<() => void>(() => {});
  const pauseRef = useRef<() => void>(() => {});
  const seekRef = useRef<(position: number) => void>(() => {});
  const playTrackRef = useRef<(track: Track, newQueue?: Track[], options?: PlayTrackOptions) => void>(() => {});
  const resolveNextTrackRef = useRef<() => { nextSong: Track; isSmartQueue: boolean } | null>(() => null);

  /**
   * Synchronizes the effective linear playback queue with the native Media3 engine safely.
   * Linear order: [past tracks in main queue, current track, manual priority queue, future tracks in main queue].
   * Avoids redundant updates if the signature has not changed.
   */
  const syncEffectiveQueueToNative = useCallback((
    current: Track | null,
    manualQ: Track[],
    mainQ: Track[],
    idx: number
  ) => {
    if (!nativePlaybackController.isNativeModeActive() && !nativePlaybackController.isEnabled()) {
      return;
    }
    if (!current) return;

    const safeIdx = Math.max(0, idx);
    const past = mainQ.slice(0, safeIdx);
    const future = mainQ.slice(safeIdx + 1);
    const effectiveQueue = [...past, current, ...manualQ, ...future];
    const newCurrentIndex = past.length;

    const queueSignature = effectiveQueue.map((t) => t.id).join(',') + `::idx=${newCurrentIndex}`;
    if (queueSignature === lastSyncedQueueIdsRef.current) {
      return;
    }
    lastSyncedQueueIdsRef.current = queueSignature;

    console.log('[PlayerContext] Syncing effective queue to native Media3 (length:', effectiveQueue.length, 'currentIndex:', newCurrentIndex, ')');
    nativePlaybackController.updateQueue(effectiveQueue, newCurrentIndex);
  }, []);

  /**
   * Lightweight playback diagnostics getter for physical verification and troubleshooting.
   * Zero React re-renders, zero progress-tick overhead.
   */
  const getPlaybackDiagnostics = useCallback(() => {
    const isNativeEnabled = nativePlaybackController.isEnabled();
    const isNativeActive = nativePlaybackController.isNativeModeActive();
    let owner: 'NATIVE' | 'LEGACY' | 'NONE' = 'NONE';
    if (isNativeActive) {
      owner = 'NATIVE';
    } else if (engineRef.current.hasActiveAudio()) {
      owner = 'LEGACY';
    } else if (isNativeEnabled) {
      owner = 'NATIVE';
    }

    return {
      owner,
      currentTrackId: currentTrackRef.current?.id || null,
      playbackState: playbackStateRef.current,
      currentError: currentErrorRef.current,
      queueIndex: queueIndexRef.current,
      fallbackAttempted: nativePlaybackController.isFallbackAttempted(),
      fallbackReason: nativePlaybackController.getFallbackReason(),
      generation: playbackGenerationRef.current,
      nativeEnabled: isNativeEnabled,
      nativeActive: isNativeActive,
    };
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__stuxsPlaybackDiagnostics = getPlaybackDiagnostics;
      try {
        Object.defineProperty(window, '__stuxsPlaybackDiagnostics', {
          get: getPlaybackDiagnostics,
          configurable: true,
        });
      } catch {}
    }
    return () => {
      if (typeof window !== 'undefined') {
        delete (window as any).__stuxsPlaybackDiagnostics;
      }
    };
  }, [getPlaybackDiagnostics]);

  /**
   * Intelligently calculates Smart Queue look-ahead recommendations across all contexts
   * (STUXS songs, Library playlists, provider songs, albums, search, home).
   */
  const replenishSmartQueue = useCallback(async (seedTrack: Track) => {
    if (!smartQueueEnabledRef.current || !seedTrack) {
      setSmartQueue([]);
      smartQueueRef.current = [];
      return;
    }

    const libraryPlaylist = activeLibraryPlaylistRef.current;
    const isLibraryPlaylistSession =
      playbackSourceRef.current === 'library-playlist' &&
      libraryPlaylist !== null &&
      libraryPlaylist.tracks.length > 0;

    const playedIds = new Set<string>([
      ...recentlyPlayedIdsRef.current,
    ]);
    if (currentTrackRef.current) playedIds.add(currentTrackRef.current.id);

    // Context 1: In a Library Playlist session, rank remaining playlist tracks
    if (isLibraryPlaylistSession && libraryPlaylist) {
      const playlistTracks = libraryPlaylist.tracks;
      const unplayedCandidates = playlistTracks.filter((t) => !playedIds.has(t.id));

      if (unplayedCandidates.length > 0) {
        const localRanked = localRecommendationEngine.rankPlaylistCandidates(
          seedTrack,
          unplayedCandidates,
          playedIds,
          seedTrack.artistName
        );
        setSmartQueue(localRanked.slice(0, 8));
        smartQueueRef.current = localRanked.slice(0, 8);
        return;
      }
    }

    // Context 2: Dynamic Smart Queue recommendations across STUXS catalog & providers
    try {
      const related = await smartQueueService.getRelatedTracks(seedTrack, {
        excludeIds: playedIds,
        limit: 8,
      });

      setSmartQueue(related);
      smartQueueRef.current = related;
    } catch (err) {
      console.warn('[PlayerContext] SmartQueue replenishment warning:', err);
    }
  }, []);

  // Set Smart Queue Enabled toggle
  const setSmartQueueEnabled = (enabled: boolean) => {
    setSmartQueueEnabledState(enabled);
    smartQueueEnabledRef.current = enabled;

    if (enabled) {
      if (currentTrackRef.current) {
        replenishSmartQueue(currentTrackRef.current);
      }
    } else {
      setSmartQueue([]);
      smartQueueRef.current = [];
    }
  };

  const toggleSmartQueue = () => {
    setSmartQueueEnabled(!smartQueueEnabled);
  };

  const setAudioQuality = (quality: AudioQuality) => {
    setAudioQualityState(quality);
    try {
      const raw = localStorage.getItem('stuxs_playback_settings');
      const settings = raw ? JSON.parse(raw) : {};
      settings.audioQuality = quality;
      localStorage.setItem('stuxs_playback_settings', JSON.stringify(settings));
    } catch {}

    const track = currentTrackRef.current;
    if (
      !track ||
      !track.audioUrl ||
      track.sourceType === 'downloaded' ||
      track.sourceType === 'local' ||
      track.audioUrl.startsWith('blob:')
    ) {
      return;
    }

    // Step 1: Capture live playback state
    const currentToken = ++qualitySwitchTokenRef.current;
    const currentPosSec = progressRef.current || engineRef.current.getCurrentPosition() || 0;
    const currentPosMs = Math.round(currentPosSec * 1000);
    const wasPlaying = isPlayingRef.current;

    // Step 2 & 3: Re-resolve CURRENT track using new quality
    let newUrl = track.audioUrl;
    let newBitrate = track.actualBitrate;

    try {
      const jiosaavn = providerRegistry.getProvider('jiosaavn') as JioSaavnProvider | undefined;
      if (track.rawEncryptedUrl && jiosaavn) {
        const resolved = jiosaavn.resolveTrackQuality(track, quality);
        newUrl = resolved.audioUrl || newUrl;
        newBitrate = resolved.actualBitrate || newBitrate;
      } else {
        const mapped = mapJioSaavnUrlToQuality(track.audioUrl, quality);
        newUrl = mapped.newUrl;
        newBitrate = mapped.bitrate;
      }
    } catch (err) {
      console.warn('[PlayerContext] Quality re-resolution error, retaining current source:', err);
      return;
    }

    // Protect against race conditions: latest requested quality token wins
    if (currentToken !== qualitySwitchTokenRef.current) {
      return;
    }

    // If stream URL changed to a valid new URL, hot-swap the source while preserving exact position and state
    if (newUrl && newUrl !== track.audioUrl) {
      const updatedTrack: Track = {
        ...track,
        audioUrl: newUrl,
        actualBitrate: newBitrate,
      };
      setCurrentTrack(updatedTrack);
      currentTrackRef.current = updatedTrack;

      // Dispatch source reload to native controller (with webAudio reload fallback)
      nativePlaybackController.reloadCurrentTrackSource(
        newUrl,
        currentPosMs,
        wasPlaying,
        () => {
          engineRef.current.reloadStream(newUrl, currentPosSec, wasPlaying);
        }
      );
    }
  };

  /**
   * Pure Peek: inspects the next track without mutating the queue or consuming manual queue items.
   */
  const peekNextTrack = useCallback((): { nextSong: Track; isSmartQueue: boolean } | null => {
    const current = currentTrackRef.current;
    const q = queueRef.current;
    const idx = queueIndexRef.current;
    const mode = repeatModeRef.current;
    const shuffled = isShuffledRef.current;
    const isSmartQueueOn = smartQueueEnabledRef.current;
    const source = playbackSourceRef.current;
    const libraryPlaylist = activeLibraryPlaylistRef.current;
    const origQueue = originalQueueRef.current;
    const manualQ = manualQueueRef.current;

    // 1. Manual User Queue Takes Absolute Priority
    if (manualQ.length > 0) {
      return { nextSong: manualQ[0], isSmartQueue: false };
    }

    // 2. Smart Queue: ONLY active when currently in an active Library Playlist session
    const isLibraryPlaylistSession =
      source === 'library-playlist' &&
      libraryPlaylist !== null &&
      libraryPlaylist.tracks.length > 0;

    if (isSmartQueueOn && isLibraryPlaylistSession && current) {
      const playedIds = new Set<string>([
        ...recentlyPlayedIdsRef.current,
        current.id,
      ]);
      const unplayedCandidates = libraryPlaylist.tracks.filter((t) => !playedIds.has(t.id));

      if (unplayedCandidates.length > 0) {
        const nextRecommended = localRecommendationEngine.selectNextTrack(
          current,
          unplayedCandidates,
          playedIds,
          shuffled,
          current.artistName
        );
        if (nextRecommended) {
          return { nextSong: nextRecommended, isSmartQueue: true };
        }
      }
    }

    // 3. Shuffle fallback
    if (shuffled && origQueue.length > 1) {
      const playedIds = new Set<string>([
        ...recentlyPlayedIdsRef.current,
        ...(current ? [current.id] : []),
      ]);
      const unplayedCandidates = origQueue.filter((t) => !playedIds.has(t.id));
      if (unplayedCandidates.length > 0) {
        return { nextSong: unplayedCandidates[0], isSmartQueue: false };
      }
    }

    // 4. Default Sequential Queue Fallback
    if (idx < q.length - 1) {
      const nextIdx = idx + 1;
      return { nextSong: q[nextIdx], isSmartQueue: false };
    }

    // 5. Repeat ALL loop-back
    if (mode === 'all') {
      if (origQueue.length > 0) {
        return { nextSong: origQueue[0], isSmartQueue: false };
      } else if (q.length > 0) {
        return { nextSong: q[0], isSmartQueue: false };
      }
    }

    return null;
  }, []);

  /**
   * Deterministic Next-Track Resolution Pipeline:
   * 1. Manual user priority queue ("Play Next" / User-added items).
   * 2. Library Playlist + Smart Queue ON:
   *    -> Intelligently scores and selects the next eligible track ONLY from that active Library playlist.
   * 3. Standard Queue / Shuffle / Repeat behavior for all other playback sources.
   */
  const resolveNextTrack = useCallback((): { nextSong: Track; isSmartQueue: boolean } | null => {
    const current = currentTrackRef.current;
    const q = queueRef.current;
    const idx = queueIndexRef.current;
    const mode = repeatModeRef.current;
    const shuffled = isShuffledRef.current;
    const isSmartQueueOn = smartQueueEnabledRef.current;
    const source = playbackSourceRef.current;
    const libraryPlaylist = activeLibraryPlaylistRef.current;
    const origQueue = originalQueueRef.current;
    const manualQ = manualQueueRef.current;

    // 1. Manual User Queue Takes Absolute Priority ("Play Next" / Priority Queue)
    if (manualQ.length > 0) {
      const nextManual = manualQ[0];
      setManualQueue((prev) => prev.slice(1));
      manualQueueRef.current = manualQueueRef.current.slice(1);
      return { nextSong: nextManual, isSmartQueue: false };
    }

    // 2. Smart Queue: ONLY active when currently in an active Library Playlist session
    const isLibraryPlaylistSession =
      source === 'library-playlist' &&
      libraryPlaylist !== null &&
      libraryPlaylist.tracks.length > 0;

    if (isSmartQueueOn && isLibraryPlaylistSession && current) {
      const playedIds = new Set<string>([
        ...recentlyPlayedIdsRef.current,
        current.id,
      ]);
      const unplayedCandidates = libraryPlaylist.tracks.filter((t) => !playedIds.has(t.id));

      if (unplayedCandidates.length > 0) {
        const nextRecommended = localRecommendationEngine.selectNextTrack(
          current,
          unplayedCandidates,
          playedIds,
          shuffled,
          current.artistName
        );
        if (nextRecommended) {
          return { nextSong: nextRecommended, isSmartQueue: true };
        }
      }
      // If all playlist tracks are played, fall through to Repeat ALL or Stop
    }

    // 3. Shuffle fallback (if isShuffle is ON and Smart Queue is OFF or non-playlist)
    if (shuffled && origQueue.length > 1) {
      const playedIds = new Set<string>([
        ...recentlyPlayedIdsRef.current,
        ...(current ? [current.id] : []),
      ]);
      const unplayedCandidates = origQueue.filter((t) => !playedIds.has(t.id));
      if (unplayedCandidates.length > 0) {
        const randomIdx = Math.floor(Math.random() * unplayedCandidates.length);
        return { nextSong: unplayedCandidates[randomIdx], isSmartQueue: false };
      }
    }

    // 4. Default Sequential Queue Fallback (Search results, Albums, Artist songs, or Playlist with Smart Queue OFF)
    if (idx < q.length - 1) {
      const nextIdx = idx + 1;
      return { nextSong: q[nextIdx], isSmartQueue: false };
    }

    // 5. Repeat ALL loop-back
    if (mode === 'all') {
      if (origQueue.length > 0) {
        if (shuffled) {
          const freshShuffled = smartQueueService.generateSmartShuffledQueue(
            origQueue[Math.floor(Math.random() * origQueue.length)],
            origQueue,
            origQueue
          );
          return { nextSong: freshShuffled[0], isSmartQueue: false };
        }
        return { nextSong: origQueue[0], isSmartQueue: false };
      } else if (q.length > 0) {
        return { nextSong: q[0], isSmartQueue: false };
      }
    }

    return null;
  }, []);

  /**
   * Central Audio Source Resolver
   * Priority:
   * 1. Offline Downloaded Track (Local IndexedDB Blob) - works 100% offline
   * 2. Local File / Device Music
   * 3. Online Streaming (JioSaavn / Gaana / STUXS / iTunes / Spotify)
   */
  const resolvePlayableSource = useCallback(
    async (track: Track): Promise<Track> => {
      // 1. Guaranteed Offline Download Check (Memory Map + Persistent IndexedDB Check)
      let downloaded = downloadService.getPlayableTrack(track.id);
      if (!downloaded || !downloaded.audioUrl) {
        downloaded = await downloadService.resolvePlayableDownloadedTrack(track.id);
      }
      if (downloaded && downloaded.audioUrl) {
        console.log('[PLAYER] Using verified offline download for:', {
          id: track.id,
          title: track.title,
          size: downloaded.fileSize,
        });
        return {
          ...track,
          ...downloaded,
          audioUrl: downloaded.audioUrl,
          isDownloaded: true,
          sourceType: 'downloaded',
          isPlayable: true,
          accessStatus: 'playable',
          playbackType: 'full',
        };
      }

      // 2. Local Device Music (Real audio files imported from device storage)
      if (
        track.id.startsWith('local_') ||
        (track.sourceType === 'local' && (!track.audioUrl || track.audioUrl.startsWith('blob:') || !track.audioUrl.startsWith('http')))
      ) {
        const localPlayable = await LocalMusicService.getPlayableTrack(track);
        if (localPlayable && (localPlayable.audioUrl || localPlayable.localPath)) {
          return {
            ...track,
            ...localPlayable,
            isPlayable: true,
            accessStatus: 'playable',
            playbackType: 'full',
          };
        }
      }

      // Check Offline status: Non-downloaded, non-local audio CANNOT play when offline
      const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
      if (isOffline) {
        console.warn('[PLAYER] Offline mode: track is not downloaded locally:', track.title);
        return {
          ...track,
          isPlayable: false,
          accessStatus: 'blocked',
          playbackType: 'blocked',
        };
      }

      // 3. Fast Path: ONLY for offline downloaded, local device files, or verified persistent M3U streams.
      // Online catalog streams (JioSaavn, Gaana, etc.) stored in recentlyPlayed or history MUST ALWAYS
      // undergo fresh source resolution via providerRegistry to avoid expired CDN tokens / 403 Forbidden errors!
      const isPersistentStream =
        track.sourceType === 'downloaded' ||
        track.isDownloaded === true ||
        track.sourceType === 'local' ||
        track.provider === 'local' ||
        track.id.startsWith('local_') ||
        track.id.startsWith('m3u-');

      if (
        isPersistentStream &&
        ((track.audioUrl && track.audioUrl.trim().length > 0) || (track.localPath && track.localPath.trim().length > 0)) &&
        track.isPlayable !== false &&
        track.accessStatus !== 'blocked' &&
        !track.isPreview &&
        !track.audioUrl?.includes('itunes.apple.com') &&
        !track.audioUrl?.includes('mzstatic.com') &&
        !track.audioUrl?.includes('audio-ssl.itunes')
      ) {
        return {
          ...track,
          isPlayable: true,
          accessStatus: 'playable',
          playbackType: 'full',
        };
      }

      // 4. Online streaming resolution: always resolve fresh stream URL for catalog providers
      let playableTrack = track;
      if (
        !isPersistentStream ||
        !track.audioUrl ||
        track.accessStatus === 'blocked' ||
        track.audioUrl.includes('itunes.apple.com') ||
        track.audioUrl.includes('mzstatic.com')
      ) {
        playableTrack = await providerRegistry.resolvePlayableTrack(track, false, {
          bypassPreValidation: nativePlaybackController.isEnabled(),
        });
      }

      // Defensive Track Identity & Recording Duration Sanity Check
      if (
        track.duration &&
        playableTrack.duration &&
        Math.abs(playableTrack.duration - track.duration) > 20 &&
        track.provider !== playableTrack.provider
      ) {
        console.warn('[Playback Identity Mismatch]', {
          requested: {
            source: track.provider,
            trackId: track.id,
            title: track.title,
            artist: track.artistName,
            duration: track.duration,
          },
          resolved: {
            source: playableTrack.provider,
            trackId: playableTrack.id,
            title: playableTrack.title,
            artist: playableTrack.artistName,
            duration: playableTrack.duration,
          },
        });

        // Reject foreign recording mismatch or preview rather than playing wrong/truncated song
        return {
          ...track,
          isPlayable: false,
          accessStatus: 'blocked',
          playbackType: 'blocked',
        };
      }

      // Strict check: Disallow any 30s preview stream from playing
      if (
        !playableTrack.audioUrl ||
        playableTrack.isPreview ||
        playableTrack.playbackType === 'preview' ||
        playableTrack.audioUrl.includes('itunes.apple.com') ||
        playableTrack.audioUrl.includes('mzstatic.com') ||
        playableTrack.audioUrl.includes('audio-ssl.itunes')
      ) {
        return {
          ...track,
          isPlayable: false,
          accessStatus: 'blocked',
          playbackType: 'blocked',
        };
      }

      if (!playableTrack.audioUrl || playableTrack.isPlayable === false) {
        return {
          ...track,
          audioUrl: undefined,
          isPlayable: false,
          accessStatus: 'blocked',
        };
      }

      // Apply active audio quality
      const jiosaavn = providerRegistry.getProvider('jiosaavn') as JioSaavnProvider | undefined;
      if (playableTrack.rawEncryptedUrl && jiosaavn) {
        playableTrack = jiosaavn.resolveTrackQuality(playableTrack, audioQuality);
      } else if (playableTrack.provider === 'jiosaavn' && playableTrack.audioUrl) {
        const mapped = mapJioSaavnUrlToQuality(playableTrack.audioUrl, audioQuality);
        playableTrack = {
          ...playableTrack,
          audioUrl: mapped.newUrl,
          actualBitrate: mapped.bitrate,
        };
      }

      return {
        ...track,
        audioUrl: playableTrack.audioUrl,
        rawEncryptedUrl: playableTrack.rawEncryptedUrl,
        actualBitrate: playableTrack.actualBitrate,
        audioFormat: playableTrack.audioFormat,
        duration: track.duration || playableTrack.duration,
        isPlayable: true,
        accessStatus: 'playable',
        playbackType: 'full',
      };
    },
    [audioQuality]
  );

  /**
   * Core Track Execution with Generation Guards:
   * 1. Validates generation before AND after async resolution
   * 2. Aborts obsolete requests if user tapped Next/Prev again
   * 3. Prevents old or intermediate songs from ever starting audio
   */
  /**
   * Core Track Execution with Generation Guards & Auto-Recovery:
   * 1. Validates generation before AND after async resolution
   * 2. Aborts obsolete requests if user tapped Next/Prev again
   * 3. Prevents old or intermediate songs from ever starting audio
   * 4. Automatically invalidates cache and retries fresh if stream resolution fails
   */
  const startTrackPlayback = useCallback(
    async (targetTrack: Track, generation: number, initialPosition?: number) => {
      // If user has already selected another song, discard immediately
      if (generation !== playbackGenerationRef.current) return;

      try {
        let resolved = await resolvePlayableSource(targetTrack);

        // Auto-Recovery: Invalidate stale cache and retry once if stream is unplayable
        if (!resolved.audioUrl || resolved.isPlayable === false || resolved.accessStatus === 'blocked') {
          const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
          if (isOffline) {
            setIsLoadingTrack(false);
            setIsPlaying(false);
            isPlayingRef.current = false;
            if (nativePlaybackController.isEnabled()) {
              await nativePlaybackController.stop();
            }
            showToast(`Offline: "${targetTrack.title}" is not downloaded`, 'error');
            return;
          }
          console.warn('[PlayerContext] Initial resolution failed for:', targetTrack.title, 'retrying fresh stream resolution...');
          providerRegistry.invalidateStreamCache(targetTrack.id);
          try {
            const fresh = await providerRegistry.resolvePlayableTrack(targetTrack, true, {
              bypassPreValidation: nativePlaybackController.isEnabled(),
            });
            if (fresh.audioUrl && fresh.isPlayable !== false) {
              resolved = {
                ...targetTrack,
                audioUrl: fresh.audioUrl,
                rawEncryptedUrl: fresh.rawEncryptedUrl,
                duration: fresh.duration || targetTrack.duration,
                actualBitrate: fresh.actualBitrate,
                audioFormat: fresh.audioFormat,
                isPlayable: true,
                accessStatus: 'playable',
                playbackType: 'full',
              };
            }
          } catch (retryErr) {
            console.warn('[PlayerContext] Fresh retry resolution error:', retryErr);
          }
        }

        // Guard against stale async resolution responses (user tapped another song meanwhile)
        if (generation !== playbackGenerationRef.current) {
          console.log('[PlayerContext] Discarding obsolete track resolution for:', targetTrack.title);
          return;
        }

        if (!resolved.audioUrl || resolved.isPlayable === false || resolved.accessStatus === 'blocked') {
          setIsLoadingTrack(false);
          setIsPlaying(false);
          isPlayingRef.current = false;
          if (nativePlaybackController.isEnabled()) {
            await nativePlaybackController.stop();
          }
          const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
          if (isOffline) {
            showToast(`Offline: "${targetTrack.title}" is not downloaded`, 'error');
          } else {
            console.warn('[PlayerContext] Full playback unavailable for:', targetTrack.title);
            showToast(`Full playback unavailable for "${targetTrack.title}"`, 'error');
          }
          return;
        }

        setIsLoadingTrack(false);
        setCurrentTrack(resolved);
        currentTrackRef.current = resolved;
        setDuration(resolved.duration || 180);
        setIsPlaying(true);
        updateNativeMediaMetadata(resolved, true, 0);

        try {
          localStorage.setItem('stuxs_last_played_track', JSON.stringify({
            track: resolved,
            position: 0,
            duration: resolved.duration || 180,
          }));
        } catch {}

        console.log(`[AUDIO SOURCE] track = ${resolved.title}`);
        currentErrorRef.current = null;
        let playedViaNative = false;
        if (nativePlaybackController.isEnabled()) {
          const res = await nativePlaybackController.playTrack(resolved, {
            stopWebAudio: () => engineRef.current.stopImmediate(),
            resumeWebAudio: () => {
              console.log('[PlayerContext] Safe Fallback: Resuming playback via WebAudioPlaybackEngine');
              setIsNativeEngineActive(false);
              engineRef.current.play(resolved);
            },
            onFallback: (errMsg) => {
              console.warn('[PlayerContext] Native playback failed, safely falling back to WebAudio:', errMsg);
              currentErrorRef.current = errMsg;
              setIsNativeEngineActive(false);
              updateNativeMediaMetadata(resolved, true, 0);
            }
          }, {
            queue: queueRef.current,
            startIndex: queueIndexRef.current,
            repeatMode: repeatModeRef.current,
            isShuffled: isShuffledRef.current,
          });
          playedViaNative = res.handledByNative && res.success;
          setIsNativeEngineActive(playedViaNative);
          if (playedViaNative) {
            syncEffectiveQueueToNative(resolved, manualQueueRef.current, queueRef.current, queueIndexRef.current);
          }
        }

        if (!nativePlaybackController.isEnabled()) {
          setIsNativeEngineActive(false);
          await engineRef.current.play(resolved);
        } else {
          setIsNativeEngineActive(playedViaNative);
          if (!playedViaNative) {
            console.warn('[PlayerContext] Native playback failed and native mode is enabled. Strictly suppressing WebAudio.');
            currentErrorRef.current = currentErrorRef.current || 'Native playback failed';
            setIsPlaying(false);
            isPlayingRef.current = false;
            setIsLoadingTrack(false);
            setPlaybackState('ERROR');
            return;
          }
        }

        if (initialPosition && initialPosition > 0) {
          if (playedViaNative) {
            nativePlaybackController.seek(initialPosition);
          } else {
            await engineRef.current.seek(initialPosition);
          }
          progressRef.current = initialPosition;
          setProgress(initialPosition);
          playbackProgressEmitter.anchor(initialPosition, durationRef.current, true);
        }

        // Final generation guard: If user tapped Next/Prev while audio was loading/buffering
        if (generation !== playbackGenerationRef.current) {
          console.log('[PlayerContext] Stopping audio from obsolete generation for:', resolved.title);
          engineRef.current.stopImmediate();
          if (nativePlaybackController.isEnabled()) {
            await nativePlaybackController.stop();
          }
          return;
        }

        console.log(`[AUDIO PLAYING] track = ${resolved.title}`);
        addToRecentlyPlayed(resolved);
        recentlyPlayedIdsRef.current.add(resolved.id);

        if (smartQueueEnabledRef.current && playbackSourceRef.current === 'library-playlist') {
          replenishSmartQueue(resolved);
        }
      } catch (err: any) {
        if (generation !== playbackGenerationRef.current) return;
        setIsLoadingTrack(false);
        setIsPlaying(false);
        isPlayingRef.current = false;
        if (nativePlaybackController.isEnabled()) {
          await nativePlaybackController.stop();
        }
        console.warn('[PlayerContext] Playback start error:', err);
      }
    },
    [addToRecentlyPlayed, replenishSmartQueue, resolvePlayableSource, showToast]
  );

  /**
   * Central Master Play Track Function:
   * EVERY playback trigger in the entire application routes through this single pipeline.
   */
  const playTrack = useCallback(
    async (
      track: Track,
      newQueue?: Track[],
      options?: PlayTrackOptions
    ) => {
      const reason = options?.reason || 'direct';
      console.log(`[TRACK TRANSITION] reason=${reason} currentTrack = ${track.title}`);
      console.log(`[UI STATE] currentTrack = ${track.title}`);
      console.log(`[MEDIA SESSION] metadata = ${track.title}`);

      // Same-Track State Discrimination based on authoritative native engine state
      if (nativePlaybackController.isEnabled()) {
        const nativeStatus = await nativePlaybackController.getActualNativePlaybackState();
        console.log('[PLAY_TRACK] Authoritative native state query:', {
          requestedTrackId: track.id,
          requestedTitle: track.title,
          nativeLoaded: nativeStatus.isLoaded,
          nativeCurrentTrackId: nativeStatus.currentTrackId,
          nativeIsPlaying: nativeStatus.isPlaying,
          nativeState: nativeStatus.state,
        });

        // Case 1: Same track + native player has that media item + playing -> no-op
        if (nativeStatus.isLoaded && nativeStatus.currentTrackId === track.id && nativeStatus.isPlaying) {
          console.log('[PLAY_TRACK] Branch selected: CASE 1 (Same track + native playing -> NO-OP)');
          setIsPlaying(true);
          isPlayingRef.current = true;
          return;
        }

        // Case 2: Same track + native player has that media item + paused -> native resume()
        if (nativeStatus.isLoaded && nativeStatus.currentTrackId === track.id && !nativeStatus.isPlaying) {
          console.log('[PLAY_TRACK] Branch selected: CASE 2 (Same track + native paused -> native resume())');
          await nativePlaybackController.resume(() => engineRef.current.resume());
          setIsPlaying(true);
          isPlayingRef.current = true;
          return;
        }

        // Case 3 & 4: Native player has NO media item (cold start) or a DIFFERENT track -> full native resolve -> setMediaItem -> prepare -> play()
        console.log('[PLAY_TRACK] Branch selected: CASE 3/4 (Native player has NO media item or different track -> full load into ExoPlayer)');
      } else {
        if (currentTrackRef.current?.id === track.id) {
          if (isPlayingRef.current) {
            console.log('[PLAY_TRACK] Legacy Case 1: Same track already playing in WebAudio -> NO-OP');
            return;
          } else if (engineRef.current.hasActiveAudio()) {
            console.log('[PLAY_TRACK] Legacy Case 2: Same track paused in WebAudio -> resume()');
            engineRef.current.resume();
            updateNativePlaybackState(true, progressRef.current, durationRef.current);
            setIsPlaying(true);
            isPlayingRef.current = true;
            return;
          }
        }
      }

      // 1. Prime the mobile audio engine synchronously on the direct user gesture
      engineRef.current.primeUserGesture();

      const generation = ++playbackGenerationRef.current;
      activeAbortControllerRef.current?.abort();
      activeAbortControllerRef.current = new AbortController();

      // 2. STOP old audio IMMEDIATELY (< 10ms)
      engineRef.current.stopImmediate();
      if (nativePlaybackController.isEnabled()) {
        await nativePlaybackController.stop();
      }

      // 3. Instant Optimistic UI & Native MediaSession Update (< 16ms)
      setCurrentTrack(track);
      currentTrackRef.current = track;
      const isLocalOrCached =
        track.sourceType === 'local' ||
        track.provider === 'local' ||
        track.sourceType === 'downloaded' ||
        track.isDownloaded ||
        track.id.startsWith('local_') ||
        track.id.startsWith('m3u-');
      setIsLoadingTrack(!isLocalOrCached);
      setProgress(0);
      progressRef.current = 0;
      setDuration(track.duration || 180);
      durationRef.current = track.duration || 180;
      setIsPlaying(true);
      isPlayingRef.current = true;
      playbackProgressEmitter.reset();
      playbackProgressEmitter.emit(0, track.duration || 180);
      updateNativeMediaMetadata(track, true, 0);

      // 4. Update Playback Source Context
      if (options?.source) {
        setPlaybackSource(options.source);
        playbackSourceRef.current = options.source;
      } else if (options?.id && newQueue) {
        setPlaybackSource('library-playlist');
        playbackSourceRef.current = 'library-playlist';
      }

      if (options?.id && newQueue && newQueue.length > 0) {
        const playlistSession: ActiveLibraryPlaylistInfo = {
          id: options.id,
          name: options.name || 'Library Playlist',
          tracks: newQueue,
        };
        setActiveLibraryPlaylist(playlistSession);
        activeLibraryPlaylistRef.current = playlistSession;
      } else if (options?.source && options.source !== 'library-playlist') {
        setActiveLibraryPlaylist(null);
        activeLibraryPlaylistRef.current = null;
        setSmartQueueEnabledState(false);
        smartQueueEnabledRef.current = false;
        setSmartQueue([]);
        smartQueueRef.current = [];
      }

      // 5. Update Queue Context
      const shouldShuffle = options?.shuffle ?? isShuffledRef.current;
      if (options?.shuffle !== undefined) {
        setIsShuffled(options.shuffle);
        isShuffledRef.current = options.shuffle;
      }

      if (newQueue && newQueue.length > 0) {
        originalQueueRef.current = newQueue;
        if (shouldShuffle) {
          const smartShuffled = smartQueueService.generateSmartShuffledQueue(
            track,
            newQueue,
            newQueue
          );
          setQueue(smartShuffled);
          queueRef.current = smartShuffled;
          setQueueIndex(0);
          queueIndexRef.current = 0;
        } else {
          setQueue(newQueue);
          queueRef.current = newQueue;
          const idx = newQueue.findIndex((t) => t.id === track.id);
          const validIdx = idx !== -1 ? idx : 0;
          setQueueIndex(validIdx);
          queueIndexRef.current = validIdx;
        }
      } else {
        const currentQ = queueRef.current;
        const existingIdx = currentQ.findIndex((t) => t.id === track.id);
        if (existingIdx !== -1) {
          setQueueIndex(existingIdx);
          queueIndexRef.current = existingIdx;
        } else {
          const updated = [track, ...currentQ];
          setQueue(updated);
          queueRef.current = updated;
          originalQueueRef.current = updated;
          setQueueIndex(0);
          queueIndexRef.current = 0;
        }
      }

      // 6. Execute Playback asynchronously with strict generation guards & auto-recovery
      await startTrackPlayback(track, generation, options?.initialPosition);
    },
    [startTrackPlayback]
  );

  // --- End-of-Track Event Handler ---
  const handleTrackEnded = useCallback(async () => {
    if (isTransitioningRef.current) {
      console.log('[AUTO NEXT] Transition already in flight, ignoring duplicate event');
      return;
    }
    isTransitioningRef.current = true;

    try {
      const current = currentTrackRef.current;
      const mode = repeatModeRef.current;

      console.log(`[AUDIO ENDED] track = ${current?.title || 'Unknown'}`);

      if (!current) {
        setIsPlaying(false);
        isPlayingRef.current = false;
        setProgress(0);
        progressRef.current = 0;
        engineRef.current.stopImmediate();
        return;
      }

      // Safety Check: If the track was only a 30s preview, NEVER auto-restart or loop it
      if (current?.isPreview || current?.accessStatus === 'preview') {
        setIsPlaying(false);
        isPlayingRef.current = false;
        setProgress(0);
        progressRef.current = 0;
        engineRef.current.stopImmediate();
        return;
      }

      // 1. Repeat ONE: Restart the exact same track from beginning through central playTrack
      if (mode === 'one') {
        console.log(`[AUTO NEXT] nextTrack = ${current.title} (repeat one)`);
        return await playTrack(current, undefined, {
          reason: 'auto-next',
          autoplay: true,
        });
      }

      // 2. Resolve Next Track via Priority Hierarchy through central playTrack
      const res = resolveNextTrack();
      if (res && res.nextSong) {
        console.log(`[AUTO NEXT] nextTrack = ${res.nextSong.title}`);
        return await playTrack(res.nextSong, undefined, {
          reason: 'auto-next',
          autoplay: true,
        });
      } else {
        // End of playback -> Stop cleanly
        setIsPlaying(false);
        isPlayingRef.current = false;
        setProgress(0);
        progressRef.current = 0;
        engineRef.current.stopImmediate();
        updateNativePlaybackState(false, 0, 0);
      }
    } finally {
      setTimeout(() => {
        isTransitioningRef.current = false;
      }, 500);
    }
  }, [playTrack, resolveNextTrack]);

  playTrackRef.current = playTrack;
  resolveNextTrackRef.current = resolveNextTrack;
  onTrackEndedRef.current = handleTrackEnded;

  // Synchronize Settings with WebAudioPlaybackEngine
  const syncPlaybackSettings = useCallback(() => {
    try {
      const raw = localStorage.getItem('stuxs_playback_settings');
      if (raw) {
        const parsed = JSON.parse(raw);
        engineRef.current.configureSettings({
          gapless: parsed.gaplessPlayback ?? true,
          crossfadeSeconds: parsed.crossfadeSeconds ?? 4,
          normalizeVolume: parsed.normalizeVolume ?? true,
        });
      }
    } catch {}
  }, []);

  // Preload & Crossfade lookahead reference to avoid re-resolving repeatedly
  const preloadedNextTrackIdRef = useRef<string | null>(null);
  const isCrossfadeTriggeredRef = useRef<boolean>(false);
  const lastNativeSyncTimeRef = useRef<number>(0);
  const lastStorageSaveTimeRef = useRef<number>(0);

  // Initialize listeners ONCE on mount
  useEffect(() => {
    syncPlaybackSettings();
    window.addEventListener('storage', syncPlaybackSettings);

    // 1. Restore last played track metadata and state on startup (works 100% offline & online)
    try {
      const rawTrack = localStorage.getItem('stuxs_last_played_track');
      if (rawTrack) {
        const parsed = JSON.parse(rawTrack);
        if (parsed && parsed.track && parsed.track.id) {
          const savedTrack: Track = parsed.track;
          const savedPos = typeof parsed.position === 'number' ? parsed.position : 0;
          const savedDur = typeof parsed.duration === 'number' ? parsed.duration : (savedTrack.duration || 180);

          // Check if this saved track is an offline downloaded track with verified local blob
          const downloaded = downloadService.getPlayableTrack(savedTrack.id);
          const playableTrack: Track = downloaded && downloaded.audioUrl
            ? { ...savedTrack, ...downloaded, audioUrl: downloaded.audioUrl, isDownloaded: true, sourceType: 'downloaded' }
            : savedTrack;

          setCurrentTrack(playableTrack);
          currentTrackRef.current = playableTrack;
          setProgress(savedPos);
          progressRef.current = savedPos;
          setDuration(savedDur);
          durationRef.current = savedDur;

          // Synchronize with native MediaSession and Android media notification immediately on startup!
          updateNativeMediaMetadata(playableTrack, false, savedPos);
          updateNativePlaybackState(false, savedPos, savedDur);
        }
      }
    } catch (restoreErr) {
      console.warn('[PlayerContext] Failed to restore saved track on startup:', restoreErr);
    }

    // Immediately query authoritative native ExoPlayer state on startup / Activity reconnection
    if (nativePlaybackController.isEnabled()) {
      nativePlaybackController.getActualNativePlaybackState().then((state) => {
        console.log('[STARTUP_SYNC] Authoritative native ExoPlayer state query:', state);
        if (state.isLoaded && (state.currentTrack || state.currentTrackId)) {
          console.log('[STARTUP_SYNC] Native Media3 has active track loaded:', state.currentTrackId, 'isPlaying:', state.isPlaying);
          setIsNativeEngineActive(true);
          setIsPlaying(state.isPlaying);
          isPlayingRef.current = state.isPlaying;
          if (state.isPlaying) {
            setIsLoadingTrack(false);
          }

          const nativeTrack = state.currentTrack;
          if (nativeTrack && nativeTrack.id) {
            const matched = queueRef.current.find((t) => t.id === nativeTrack.id);
            const targetTrack: Track = matched || {
              id: nativeTrack.id,
              title: nativeTrack.title || 'STUXS Track',
              artistName: nativeTrack.artist || 'Unknown Artist',
              artistId: 'native_artist',
              albumTitle: nativeTrack.album,
              artworkUrl: nativeTrack.artworkUrl || '',
              duration: typeof state.durationMs === 'number' && state.durationMs > 0 ? Math.round(state.durationMs / 1000) : 180,
              provider: (nativeTrack.provider as any) || 'jiosaavn',
              isPlayable: true,
            };
            setCurrentTrack(targetTrack);
            currentTrackRef.current = targetTrack;
          }

          if (typeof state.currentIndex === 'number' && state.currentIndex >= 0) {
            setQueueIndex(state.currentIndex);
            queueIndexRef.current = state.currentIndex;
          }

          if (typeof state.positionMs === 'number') {
            const posSec = Math.max(0, state.positionMs / 1000);
            const durSec = typeof state.durationMs === 'number' && state.durationMs > 0 ? Math.round(state.durationMs / 1000) : (currentTrackRef.current?.duration || 180);
            setProgress(posSec);
            progressRef.current = posSec;
            setDuration(durSec);
            durationRef.current = durSec;
            playbackProgressEmitter.anchor(posSec, durSec, state.isPlaying);
          }
        } else {
          console.log('[STARTUP_SYNC] Native ExoPlayer has NO media item loaded on startup (waiting for user play gesture)');
        }
      }).catch((e) => console.warn('[STARTUP_SYNC] Native query failed on startup:', e));
    }

    // 2. Connect Real Native Media3 Progress Observer, State Observer, Track Transition & Queue End Handlers
    nativePlaybackController.setOnPlaybackStateChangedCallback((state, isPlayingNative, isBuffering) => {
      setPlaybackState(state);
      if (isPlayingRef.current !== isPlayingNative) {
        isPlayingRef.current = isPlayingNative;
        setIsPlaying(isPlayingNative);
      }
      if (isBuffering || state === 'BUFFERING') {
        setIsLoadingTrack(true);
      } else if (state === 'PLAYING' || state === 'READY' || state === 'PAUSED' || state === 'ENDED' || state === 'IDLE') {
        setIsLoadingTrack(false);
      }
    });

    nativePlaybackController.setProgressCallback((posSec, durSec, isPlayingNative) => {
      progressRef.current = posSec;
      if (durSec > 0) {
        durationRef.current = durSec;
      }
      playbackProgressEmitter.anchor(posSec, durationRef.current, isPlayingNative);
      if (isPlayingRef.current !== isPlayingNative) {
        isPlayingRef.current = isPlayingNative;
        setIsPlaying(isPlayingNative);
      }
    });

    nativePlaybackController.setOnTrackChangedCallback((nativeTrack, nativeIndex) => {
      if (!nativeTrack || !nativeTrack.id) return;
      // Guard against duplicate trackChanged notifications for the same track
      if (currentTrackRef.current?.id === nativeTrack.id && queueIndexRef.current === nativeIndex) {
        return;
      }
      console.log('[PlayerContext] Native Media3 transitioned track to:', nativeTrack.title, 'index:', nativeIndex);

      // If the track transitioned to matches manualQueue[0], remove it from manualQueue exactly once
      if (manualQueueRef.current.length > 0 && manualQueueRef.current[0].id === nativeTrack.id) {
        console.log('[PlayerContext] Consuming manualQueue track via native trackChanged:', nativeTrack.title);
        setManualQueue((prev) => prev.slice(1));
        manualQueueRef.current = manualQueueRef.current.slice(1);
      }

      const existingQueue = queueRef.current;
      const matched = typeof nativeIndex === 'number' && nativeIndex in existingQueue
        ? existingQueue[nativeIndex]
        : existingQueue.find((t) => t.id === nativeTrack.id);

      const targetTrack: Track = matched || {
        id: nativeTrack.id,
        title: nativeTrack.title,
        artistName: nativeTrack.artist || 'Unknown Artist',
        artistId: 'native_artist',
        albumTitle: nativeTrack.album,
        artworkUrl: nativeTrack.artworkUrl || '',
        duration: nativeTrack.durationMs > 0 ? Math.round(nativeTrack.durationMs / 1000) : 180,
        provider: (nativeTrack.provider as any) || 'jiosaavn',
        isPlayable: true,
      };

      setCurrentTrack(targetTrack);
      currentTrackRef.current = targetTrack;
      if (typeof nativeIndex === 'number' && nativeIndex >= 0) {
        setQueueIndex(nativeIndex);
        queueIndexRef.current = nativeIndex;
      }
      const durSec = nativeTrack.durationMs > 0 ? Math.round(nativeTrack.durationMs / 1000) : (targetTrack.duration || 180);
      setDuration(durSec);
      durationRef.current = durSec;
      progressRef.current = 0;
      setIsPlaying(true);
      isPlayingRef.current = true;
      playbackProgressEmitter.anchor(0, durSec, true);
      addToRecentlyPlayed(targetTrack);
    });

    nativePlaybackController.setOnTrackEndedCallback(() => {
      console.log('[PlayerContext] Native Media3 track ended, routing to authoritative handleTrackEnded');
      onTrackEndedRef.current?.();
    });

    // 3. Reconnect to running native session on startup or return to foreground
    const syncWithRunningNativeSession = async () => {
      if (!nativePlaybackController.isEnabled()) return;
      try {
        const nativeState = await nativePlaybackBridge.getPlaybackState();
        if (nativeState && nativeState.currentTrack && nativeState.currentTrack.id) {
          console.log('[PlayerContext] Reconnecting to existing native playback session:', nativeState.currentTrack.title);
          const restoredTrack: Track = {
            id: nativeState.currentTrack.id,
            title: nativeState.currentTrack.title,
            artistName: nativeState.currentTrack.artist,
            artistId: 'native_artist',
            albumTitle: nativeState.currentTrack.album,
            artworkUrl: nativeState.currentTrack.artworkUrl || '',
            duration: nativeState.durationMs > 0 ? Math.round(nativeState.durationMs / 1000) : 180,
            provider: (nativeState.currentTrack.provider as any) || 'jiosaavn',
            isPlayable: true,
          };
          setCurrentTrack(restoredTrack);
          currentTrackRef.current = restoredTrack;
          if (typeof nativeState.currentIndex === 'number' && nativeState.currentIndex >= 0) {
            setQueueIndex(nativeState.currentIndex);
            queueIndexRef.current = nativeState.currentIndex;
          }

          // Restore and reconcile queue if React queue was lost (e.g. Activity recreation)
          if (queueRef.current.length === 0 && Array.isArray(nativeState.queue) && nativeState.queue.length > 0) {
            console.log('[PlayerContext] Restoring React queue from native session (' + nativeState.queue.length + ' tracks)');
            const restoredQueue: Track[] = nativeState.queue.map((t) => ({
              id: t.id,
              title: t.title,
              artistName: t.artist || 'Unknown Artist',
              artistId: 'native_artist',
              albumTitle: t.album,
              artworkUrl: t.artworkUrl || '',
              duration: t.durationMs ? Math.round(t.durationMs / 1000) : 180,
              provider: (t.provider as any) || 'jiosaavn',
              audioUrl: t.audioUrl,
              localPath: t.localFilePath,
              isDownloaded: Boolean(t.localFilePath),
              isPlayable: true,
            }));
            setQueue(restoredQueue);
            queueRef.current = restoredQueue;
            originalQueueRef.current = restoredQueue;
          }

          // Reconcile playback state and loading indicator
          if (nativeState.state) {
            setPlaybackState(nativeState.state);
            if (nativeState.state === 'BUFFERING' || nativeState.isBuffering) {
              setIsLoadingTrack(true);
            } else {
              setIsLoadingTrack(false);
            }
          }

          // Reconcile repeat and shuffle modes
          if (nativeState.repeatMode) {
            const mappedRepeat: RepeatMode = nativeState.repeatMode.toLowerCase() === 'all'
              ? 'all'
              : nativeState.repeatMode.toLowerCase() === 'one'
              ? 'one'
              : 'off';
            setRepeatMode(mappedRepeat);
            repeatModeRef.current = mappedRepeat;
          }
          if (typeof nativeState.shuffleEnabled === 'boolean') {
            setIsShuffled(nativeState.shuffleEnabled);
            isShuffledRef.current = nativeState.shuffleEnabled;
          }

          const posSec = Math.max(0, nativeState.positionMs / 1000);
          const durSec = nativeState.durationMs > 0 ? nativeState.durationMs / 1000 : (restoredTrack.duration || 180);
          setProgress(posSec);
          progressRef.current = posSec;
          setDuration(durSec);
          durationRef.current = durSec;
          setIsPlaying(nativeState.isPlaying);
          isPlayingRef.current = nativeState.isPlaying;
          setIsNativeEngineActive(true);
          playbackProgressEmitter.anchor(posSec, durSec, nativeState.isPlaying);

          if (typeof document === 'undefined' || document.visibilityState === 'visible') {
            nativePlaybackController.startProgressPolling();
          }
        }
      } catch (err) {
        console.warn('[PlayerContext] Failed to query native playback state on sync:', err);
      }
    };

    if (nativePlaybackController.isEnabled()) {
      syncWithRunningNativeSession();
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && nativePlaybackController.isEnabled()) {
        syncWithRunningNativeSession();
      } else if (document.visibilityState === 'hidden' && nativePlaybackController.isEnabled()) {
        nativePlaybackController.stopProgressPolling();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const engine = engineRef.current;
    engine.setListeners({
      onTimeUpdate: (current, dur) => {
        progressRef.current = current;
        if (dur && !isNaN(dur) && dur > 0) {
          durationRef.current = dur;
        }
        playbackProgressEmitter.anchor(current, durationRef.current, isPlayingRef.current);

        const now = performance.now();
        // Keep Android notification / lock-screen seek state periodically synced
        if (now - lastNativeSyncTimeRef.current > 4000) {
          lastNativeSyncTimeRef.current = now;
          updateNativePlaybackState(isPlayingRef.current, current, durationRef.current);
        }

        // Periodically persist progress to localStorage for seamless offline startup restoration
        if (now - lastStorageSaveTimeRef.current > 4000 && currentTrackRef.current) {
          lastStorageSaveTimeRef.current = now;
          try {
            localStorage.setItem('stuxs_last_played_track', JSON.stringify({
              track: currentTrackRef.current,
              position: current,
              duration: durationRef.current,
            }));
          } catch {}
        }

        // Gapless Lookahead Preload Logic
        const remaining = dur - current;
        if (dur > 15 && remaining <= 14 && remaining > 0) {
          // Pre-resolve next track if not already preloaded (use non-destructive peekNextTrack)
          const nextCandidate = peekNextTrack();
          if (nextCandidate && nextCandidate.nextSong) {
            const song = nextCandidate.nextSong;
            if (preloadedNextTrackIdRef.current !== song.id) {
              preloadedNextTrackIdRef.current = song.id;
              resolvePlayableSource(song).then((resolvedNext) => {
                if (resolvedNext.audioUrl && resolvedNext.isPlayable !== false) {
                  engine.preloadNextTrack(resolvedNext);
                }
              }).catch(() => {});
            }
          }
        }
      },
      onStateChange: (playing) => {
        setIsPlaying(playing);
        updateNativePlaybackState(playing, progressRef.current, durationRef.current);
      },
      onTrackEnded: () => {
        isCrossfadeTriggeredRef.current = false;
        preloadedNextTrackIdRef.current = null;
        onTrackEndedRef.current();
      },
      onTrackTransition: (newTrack: Track) => {
        console.log('[PlayerContext] Seamless track transition completed to:', newTrack.title);
        isCrossfadeTriggeredRef.current = false;
        preloadedNextTrackIdRef.current = null;
        setCurrentTrack(newTrack);
        currentTrackRef.current = newTrack;
        setProgress(0);
        setDuration(newTrack.duration || 180);
        setIsPlaying(true);
        updateNativeMediaMetadata(newTrack, true, 0);

        try {
          localStorage.setItem('stuxs_last_played_track', JSON.stringify({
            track: newTrack,
            position: 0,
            duration: newTrack.duration || 180,
          }));
        } catch {}

        addToRecentlyPlayed(newTrack);
        recentlyPlayedIdsRef.current.add(newTrack.id);

        if (smartQueueEnabledRef.current && playbackSourceRef.current === 'library-playlist') {
          replenishSmartQueue(newTrack);
        }
      },
      onNext: () => {
        isCrossfadeTriggeredRef.current = false;
        preloadedNextTrackIdRef.current = null;
        nextTrackRef.current();
      },
      onPrevious: () => {
        isCrossfadeTriggeredRef.current = false;
        preloadedNextTrackIdRef.current = null;
        prevTrackRef.current();
      },
      onRecoverSource: async (track, currentPos) => {
        console.log('[PlayerContext] Auto-recovering fresh validated stream for:', track.title, 'at position:', currentPos);
        try {
          const freshResolved = await providerRegistry.resolvePlayableTrack(track, true, {
            bypassPreValidation: nativePlaybackController.isEnabled(),
          });
          if (freshResolved.audioUrl && freshResolved.isPlayable) {
            setCurrentTrack(freshResolved);
            currentTrackRef.current = freshResolved;
            await engineRef.current.play(freshResolved);
            if (currentPos > 0) {
              await engineRef.current.seek(currentPos);
            }
            return true;
          }
        } catch (recoverErr) {
          console.warn('[PlayerContext] Stream recovery failed:', recoverErr);
        }
        return false;
      },
      onError: (err, diagnostics) => {
        console.warn('[PlayerContext] Playback engine error:', err.message, diagnostics);
      },
    });

    let cleanupActionListener: (() => void) | undefined;
    initNativeMediaActionListener((action, pos) => {
      switch (action) {
        case 'play':
          resumeRef.current();
          break;
        case 'pause':
          pauseRef.current();
          break;
        case 'next':
          nextTrackRef.current();
          break;
        case 'previous':
          prevTrackRef.current();
          break;
        case 'seekTo':
          if (typeof pos === 'number' && !isNaN(pos)) {
            // pos is provided in seconds directly by native bridge or web media session
            const targetSec = Math.max(0, pos);
            console.log('[PlayerContext] Native MediaSession seekTo received:', { pos, targetSec, duration: durationRef.current });
            seekRef.current(targetSec);
          }
          break;
        case 'stop':
          pauseRef.current();
          engineRef.current.stop();
          if (nativePlaybackController.isEnabled()) {
            nativePlaybackController.stop();
          }
          setIsPlaying(false);
          playbackProgressEmitter.reset();
          stopNativeMediaSession();
          break;
      }
    }).then((cleanup) => {
      cleanupActionListener = cleanup;
    });

    const handleAuthSignout = () => {
      console.log('[PlayerContext] Auth signout event detected, resetting player completely');
      resetPlaybackInternal();
    };
    window.addEventListener('stuxs:auth-signout', handleAuthSignout);

    return () => {
      engine.stop();
      cleanupActionListener?.();
      nativePlaybackController.setProgressCallback(null);
      nativePlaybackController.setOnPlaybackStateChangedCallback(null);
      nativePlaybackController.setOnTrackChangedCallback(null);
      nativePlaybackController.setOnTrackEndedCallback(null);
      nativePlaybackController.stopProgressPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('stuxs:auth-signout', handleAuthSignout);
      window.removeEventListener('storage', syncPlaybackSettings);
    };
  }, []);

  const resetPlaybackInternal = useCallback(() => {
    if (nativePlaybackController.isEnabled()) {
      nativePlaybackController.stop();
    }
    engineRef.current.stop();
    setIsPlaying(false);
    setCurrentTrack(null);
    currentTrackRef.current = null;
    setProgress(0);
    setDuration(0);
    setQueue([]);
    queueRef.current = [];
    setManualQueue([]);
    manualQueueRef.current = [];
    setSmartQueue([]);
    smartQueueRef.current = [];
    setQueueIndex(0);
    queueIndexRef.current = 0;
    setPlaybackSource(null);
    playbackSourceRef.current = null;
    setActiveLibraryPlaylist(null);
    activeLibraryPlaylistRef.current = null;
    setIsNowPlayingOpen(false);
    setIsQueueOpen(false);
    setIsLyricsOpen(false);
    stopNativeMediaSession();
  }, []);

  const resetPlayback = resetPlaybackInternal;

  const togglePlay = () => {
    if (!currentTrack) return;
    if (isPlaying) {
      pause();
    } else {
      resume();
    }
  };

  const pause = () => {
    setIsPlaying(false);
    isPlayingRef.current = false;
    if (nativePlaybackController.isNativeModeActive() || nativePlaybackController.isEnabled()) {
      nativePlaybackController.pause(() => engineRef.current.pause());
    } else {
      engineRef.current.pause();
      updateNativePlaybackState(false, progressRef.current, durationRef.current);
    }
  };

  const resume = async () => {
    if (!currentTrack) {
      console.warn('[MINIPLAYER_ACTION] resume() called with no currentTrack');
      return;
    }

    console.log('[MINIPLAYER_ACTION] resume() initiated:', {
      currentReactTrackId: currentTrack.id,
      title: currentTrack.title,
      isPlayingReact: isPlayingRef.current,
      nativeEnabled: nativePlaybackController.isEnabled(),
    });

    if (nativePlaybackController.isEnabled()) {
      const nativeStatus = await nativePlaybackController.getActualNativePlaybackState();
      console.log('[MINIPLAYER_ACTION] Native ExoPlayer status query:', {
        currentReactTrackId: currentTrack.id,
        nativeLoaded: nativeStatus.isLoaded,
        nativeCurrentTrackId: nativeStatus.currentTrackId,
        nativeIsPlaying: nativeStatus.isPlaying,
        nativeState: nativeStatus.state,
      });

      // Case 1 & 2: Native player actually has this track loaded
      if (nativeStatus.isLoaded && nativeStatus.currentTrackId === currentTrack.id) {
        if (!nativeStatus.isPlaying) {
          console.log('[MINIPLAYER_ACTION] Branch selected: CASE 2 (Same track + native player has media item + paused -> native resume())');
          setIsPlaying(true);
          isPlayingRef.current = true;
          await nativePlaybackController.resume(() => engineRef.current.resume());
        } else {
          console.log('[MINIPLAYER_ACTION] Branch selected: CASE 1 (Same track + native player has media item + playing -> NO-OP)');
        }
        return;
      }

      // Case 3: Same track in React but native player has NO media item (e.g. app restart, cold start)
      console.log('[MINIPLAYER_ACTION] Branch selected: CASE 3 (React has metadata but native player has NO media item -> full native resolve & play)');
      await playTrack(currentTrack, queueRef.current, { reason: 'resume-restored' });
      return;
    }

    // Legacy fallback
    if (engineRef.current.hasActiveAudio()) {
      console.log('[MINIPLAYER_ACTION] Branch selected: Legacy WebAudio active audio resume');
      setIsPlaying(true);
      isPlayingRef.current = true;
      engineRef.current.resume();
      updateNativePlaybackState(true, progressRef.current, durationRef.current);
    } else {
      console.log('[MINIPLAYER_ACTION] Branch selected: Legacy WebAudio uninitialized -> full playTrack()');
      await playTrack(currentTrack, queueRef.current, { reason: 'resume-legacy' });
    }
  };

  const seek = (position: number) => {
    progressRef.current = position;
    setProgress(position);
    playbackProgressEmitter.anchor(position, durationRef.current, isPlayingRef.current);
    if (nativePlaybackController.isNativeModeActive() || nativePlaybackController.isEnabled()) {
      nativePlaybackController.seek(position);
    } else {
      engineRef.current.seek(position);
      updateNativePlaybackState(isPlayingRef.current, position, durationRef.current);
    }
  };

  const setVolume = (vol: number) => {
    setVolumeState(vol);
    setIsMuted(vol === 0);
    engineRef.current.setVolume(vol);
  };

  const toggleMute = () => {
    if (isMuted) {
      const targetVol = volume || 0.85;
      setVolume(targetVol);
      setIsMuted(false);
    } else {
      engineRef.current.setVolume(0);
      setIsMuted(true);
    }
  };

  // Manual Next Button Click: Routes to single authoritative resolveNextTrack & playTrack
  const nextTrack = useCallback(async () => {
    // Single authoritative resolution pipeline:
    // manualQueue (Play Next) -> smartQueue -> shuffle -> sequential queue -> repeat all -> stop
    const res = resolveNextTrack();
    if (!res || !res.nextSong) return;

    return playTrack(res.nextSong, undefined, {
      reason: 'next',
      autoplay: true,
    });
  }, [playTrack, resolveNextTrack]);

  // Manual Previous Button Click: Routes to single authoritative resolver & central playTrack
  const prevTrack = useCallback(async () => {
    if (progressRef.current > 3) {
      seek(0);
      return;
    }

    const q = queueRef.current;
    const idx = queueIndexRef.current;
    const mode = repeatModeRef.current;

    let targetSong: Track | null = null;
    if (idx > 0) {
      targetSong = q[idx - 1];
    } else if (mode === 'all' && q.length > 1) {
      targetSong = q[q.length - 1];
    } else {
      seek(0);
      return;
    }

    if (targetSong) {
      return playTrack(targetSong, undefined, {
        reason: 'previous',
        autoplay: true,
      });
    }
  }, [playTrack, seek]);

  nextTrackRef.current = nextTrack;
  prevTrackRef.current = prevTrack;
  pauseRef.current = pause;
  resumeRef.current = resume;
  seekRef.current = seek;

  /**
   * Intelligently toggles Smart Shuffle without modifying the persistent playlist.
   */
  const toggleShuffle = () => {
    if (!isShuffled) {
      if (currentTrack) {
        const basePool = originalQueueRef.current.length > 0
          ? originalQueueRef.current
          : queue;

        const smartShuffled = smartQueueService.generateSmartShuffledQueue(
          currentTrack,
          basePool,
          originalQueueRef.current
        );
        setQueue(smartShuffled);
        setQueueIndex(0);
        if (nativePlaybackController.isNativeModeActive()) {
          nativePlaybackController.updateQueue(smartShuffled, 0);
        }
      }
      setIsShuffled(true);
      if (nativePlaybackController.isEnabled()) {
        nativePlaybackController.setShuffleMode(true);
      }
    } else {
      // Revert back to original user playlist order without modifying database
      if (originalQueueRef.current.length > 0) {
        setQueue(originalQueueRef.current);
        if (currentTrack) {
          const originalIdx = originalQueueRef.current.findIndex((t) => t.id === currentTrack.id);
          const validIdx = originalIdx !== -1 ? originalIdx : 0;
          setQueueIndex(validIdx);
          if (nativePlaybackController.isNativeModeActive()) {
            nativePlaybackController.updateQueue(originalQueueRef.current, validIdx);
          }
        }
      }
      setIsShuffled(false);
      if (nativePlaybackController.isEnabled()) {
        nativePlaybackController.setShuffleMode(false);
      }
    }
  };

  // State cycle: OFF -> ALL -> ONE -> OFF
  const cycleRepeatMode = () => {
    setRepeatMode((prev) => {
      const next = prev === 'off' ? 'all' : prev === 'all' ? 'one' : 'off';
      if (nativePlaybackController.isEnabled()) {
        nativePlaybackController.setRepeatMode(next);
      }
      return next;
    });
  };

  const addToQueue = async (track: Track) => {
    const playable = await providerRegistry.resolvePlayableTrack(track, false, {
      bypassPreValidation: nativePlaybackController.isEnabled(),
    });
    if (playable.isPreview) return;
    const updated = [...manualQueueRef.current, playable];
    setManualQueue(updated);
    manualQueueRef.current = updated;
    syncEffectiveQueueToNative(currentTrackRef.current, updated, queueRef.current, queueIndexRef.current);
  };

  const playNext = async (track: Track) => {
    const playable = await providerRegistry.resolvePlayableTrack(track, false, {
      bypassPreValidation: nativePlaybackController.isEnabled(),
    });
    if (playable.isPreview) return;
    const updated = [playable, ...manualQueueRef.current];
    setManualQueue(updated);
    manualQueueRef.current = updated;
    syncEffectiveQueueToNative(currentTrackRef.current, updated, queueRef.current, queueIndexRef.current);
  };

  const removeFromQueue = (index: number) => {
    if (index === queueIndex) return;
    setQueue((prev) => {
      const updated = prev.filter((_, i) => i !== index);
      queueRef.current = updated;
      const newIdx = index < queueIndex ? queueIndex - 1 : queueIndex;
      syncEffectiveQueueToNative(currentTrackRef.current, manualQueueRef.current, updated, newIdx);
      return updated;
    });
    if (index < queueIndex) {
      setQueueIndex((prev) => prev - 1);
      queueIndexRef.current = queueIndexRef.current - 1;
    }
  };

  const clearQueue = () => {
    if (currentTrack) {
      setQueue([currentTrack]);
      queueRef.current = [currentTrack];
      setQueueIndex(0);
      queueIndexRef.current = 0;
      syncEffectiveQueueToNative(currentTrack, [], [currentTrack], 0);
    } else {
      setQueue([]);
      queueRef.current = [];
      setQueueIndex(0);
      queueIndexRef.current = 0;
      if (nativePlaybackController.isNativeModeActive()) {
        nativePlaybackController.updateQueue([], 0);
      }
    }
    setManualQueue([]);
    manualQueueRef.current = [];
    setSmartQueue([]);
    smartQueueRef.current = [];
  };

  const reorderQueue = (startIndex: number, endIndex: number) => {
    setQueue((prev) => {
      const result = Array.from(prev);
      const [removed] = result.splice(startIndex, 1);
      result.splice(endIndex, 0, removed);
      queueRef.current = result;
      let newIdx = queueIndexRef.current;
      if (queueIndexRef.current === startIndex) {
        newIdx = endIndex;
      } else if (startIndex < queueIndexRef.current && endIndex >= queueIndexRef.current) {
        newIdx = queueIndexRef.current - 1;
      } else if (startIndex > queueIndexRef.current && endIndex <= queueIndexRef.current) {
        newIdx = queueIndexRef.current + 1;
      }
      setQueueIndex(newIdx);
      queueIndexRef.current = newIdx;
      syncEffectiveQueueToNative(currentTrackRef.current, manualQueueRef.current, result, newIdx);
      return result;
    });
  };

  const startSongRadio = async (track: Track) => {
    const playable = await providerRegistry.resolvePlayableTrack(track, false, {
      bypassPreValidation: nativePlaybackController.isEnabled(),
    });
    // Explicitly set source as 'individual' to ensure Smart Queue is disabled
    setPlaybackSource('individual');
    playbackSourceRef.current = 'individual';
    setActiveLibraryPlaylist(null);
    activeLibraryPlaylistRef.current = null;
    setSmartQueueEnabledState(false);
    smartQueueEnabledRef.current = false;
    setQueue([playable]);
    originalQueueRef.current = [playable];
    setQueueIndex(0);
    setCurrentTrack(playable);
    currentTrackRef.current = playable;
    setProgress(0);
    setDuration(playable.duration || 180);
    setIsPlaying(true);
    engineRef.current.play(playable);
    addToRecentlyPlayed(playable);
    setSmartQueue([]);
    smartQueueRef.current = [];
  };

  const dismissSmartQueueTrack = (trackId: string) => {
    setSmartQueue((prev) => {
      const updated = prev.filter((t) => t.id !== trackId);
      smartQueueRef.current = updated;
      return updated;
    });
  };

  const addSmartQueueTrackToManual = (track: Track) => {
    addToQueue(track);
    dismissSmartQueueTrack(track.id);
  };

  const toggleNativeEngine = useCallback(async () => {
    const currentlyEnabled = nativePlaybackController.isEnabled();
    const targetNative = !currentlyEnabled;
    console.log('[PlayerContext] Toggling native audio engine to:', targetNative);
    playbackGenerationRef.current++; // Invalidate stale async playback operations

    nativePlaybackController.setEnabled(targetNative);
    setIsNativeEngineActive(targetNative);

    const activeTrack = currentTrackRef.current;
    const wasPlaying = isPlayingRef.current;
    const currentPos = progressRef.current;

    if (!targetNative) {
      // Transitioning: Native -> Legacy WebAudio
      // 1. Deactivate native mode completely and ensure ExoPlayer is silenced
      if (nativePlaybackController.isNativeModeActive()) {
        await nativePlaybackController.deactivate();
      }
      setIsNativeEngineActive(false);

      // 2. Start Legacy WebAudio only after native is confirmed inactive
      if (activeTrack && wasPlaying) {
        console.log('[PlayerContext] Handoff from Native to WebAudio at pos:', currentPos);
        await engineRef.current.play(activeTrack);
        if (currentPos > 0) {
          await engineRef.current.seek(currentPos);
        }
        setIsPlaying(true);
        isPlayingRef.current = true;
      }
    } else {
      // Transitioning: Legacy WebAudio -> Native
      // 1. Stop WebAudio immediately
      if (engineRef.current.hasActiveAudio()) {
        engineRef.current.stopImmediate();
      }

      // 2. Start Native Media3 only after WebAudio is silenced
      if (activeTrack && wasPlaying) {
        console.log('[PlayerContext] Handoff from WebAudio to Native at pos:', currentPos);
        await playTrack(activeTrack, queueRef.current, {
          reason: 'mode-toggle',
          initialPosition: currentPos,
          autoplay: true,
        });
      }
    }
  }, [playTrack]);

  const hasNext = Boolean(
    manualQueue.length > 0 ||
    smartQueue.length > 0 ||
    (repeatMode === 'all' && queue.length > 0) ||
    repeatMode === 'one' ||
    queueIndex < queue.length - 1
  );

  const hasPrevious = Boolean(
    queueIndex > 0 ||
    (repeatMode === 'all' && queue.length > 0) ||
    (currentTrack && progress > 3)
  );

  const playerActions = useMemo(
    () => ({
      playTrack,
      togglePlay,
      pause,
      resume,
      playNext,
      addToQueue,
      toggleSmartQueue,
      smartQueueEnabled,
      setAudioQuality,
      resetPlayback,
      startSongRadio,
    }),
    [playTrack, togglePlay, pause, resume, playNext, addToQueue, toggleSmartQueue, smartQueueEnabled, setAudioQuality, resetPlayback, startSongRadio]
  );

  const activeQuality = useMemo(() => resolveActiveStreamQuality(currentTrack), [currentTrack]);
  const getEngineDiagnostics = useCallback(() => engineRef.current.getDiagnostics(), []);

  const playerContextValue = useMemo(
    () => ({
      currentTrack,
      isPlaying,
      isLoadingTrack,
      progress,
      duration,
      volume,
      isMuted,
      queue,
      manualQueue,
      smartQueue,
      queueIndex,
      isShuffled,
      repeatMode,
      audioQuality,
      activeQuality,
      smartQueueEnabled,
      playbackSource,
      activeLibraryPlaylist,
      isNowPlayingOpen,
      isQueueOpen,
      isLyricsOpen,
      isDevicePickerOpen,
      activeDevice,
      playTrack,
      togglePlay,
      pause,
      resume,
      seek,
      setVolume,
      toggleMute,
      nextTrack,
      prevTrack,
      toggleShuffle,
      toggleSmartQueue,
      setSmartQueueEnabled,
      setAudioQuality,
      cycleRepeatMode,
      addToQueue,
      playNext,
      removeFromQueue,
      clearQueue,
      reorderQueue,
      startSongRadio,
      dismissSmartQueueTrack,
      addSmartQueueTrackToManual,
      setIsNowPlayingOpen,
      setIsQueueOpen,
      setIsLyricsOpen,
      setIsDevicePickerOpen,
      setActiveDevice,
      getEngineDiagnostics,
      resetPlayback,
      isNativeEngineActive,
      toggleNativeEngine,
      playbackState,
      hasNext,
      hasPrevious,
    }),
    [
      currentTrack,
      isPlaying,
      isLoadingTrack,
      progress,
      duration,
      volume,
      isMuted,
      queue,
      manualQueue,
      smartQueue,
      queueIndex,
      isShuffled,
      repeatMode,
      audioQuality,
      activeQuality,
      smartQueueEnabled,
      playbackSource,
      activeLibraryPlaylist,
      isNowPlayingOpen,
      isQueueOpen,
      isLyricsOpen,
      isDevicePickerOpen,
      activeDevice,
      playTrack,
      togglePlay,
      pause,
      resume,
      seek,
      setVolume,
      toggleMute,
      nextTrack,
      prevTrack,
      toggleShuffle,
      toggleSmartQueue,
      setSmartQueueEnabled,
      setAudioQuality,
      cycleRepeatMode,
      addToQueue,
      playNext,
      removeFromQueue,
      clearQueue,
      reorderQueue,
      startSongRadio,
      dismissSmartQueueTrack,
      addSmartQueueTrackToManual,
      setIsNowPlayingOpen,
      setIsQueueOpen,
      setIsLyricsOpen,
      setIsDevicePickerOpen,
      setActiveDevice,
      getEngineDiagnostics,
      resetPlayback,
      isNativeEngineActive,
      toggleNativeEngine,
      playbackState,
      hasNext,
      hasPrevious,
    ]
  );

  return (
    <PlayerActionsContext.Provider value={playerActions}>
      <PlayerContext.Provider value={playerContextValue}>
        {children}
      </PlayerContext.Provider>
    </PlayerActionsContext.Provider>
  );
};

export interface PlayerActionsContextType {
  playTrack: (track: Track, newQueue?: Track[], options?: PlayTrackOptions) => void;
  togglePlay: () => void;
  pause: () => void;
  resume: () => void;
  playNext: (track: Track) => void;
  addToQueue: (track: Track) => void;
  toggleSmartQueue: () => void;
  smartQueueEnabled: boolean;
  setAudioQuality: (quality: AudioQuality) => void;
  resetPlayback: () => void;
  startSongRadio: (track: Track) => Promise<void>;
}

export const PlayerActionsContext = createContext<PlayerActionsContextType | null>(null);

export const usePlayerActions = (): PlayerActionsContextType => {
  const actions = useContext(PlayerActionsContext);
  if (actions) return actions;
  const player = useContext(PlayerContext);
  if (!player) {
    throw new Error('usePlayerActions must be used within a PlayerProvider');
  }
  return {
    playTrack: player.playTrack,
    togglePlay: player.togglePlay,
    pause: player.pause,
    resume: player.resume,
    playNext: player.playNext,
    addToQueue: player.addToQueue,
    toggleSmartQueue: player.toggleSmartQueue,
    smartQueueEnabled: player.smartQueueEnabled,
    setAudioQuality: player.setAudioQuality,
    resetPlayback: player.resetPlayback,
    startSongRadio: player.startSongRadio,
  };
};

export const usePlayer = () => {
  const context = useContext(PlayerContext);
  if (!context) {
    throw new Error('usePlayer must be used within a PlayerProvider');
  }
  return context;
};

