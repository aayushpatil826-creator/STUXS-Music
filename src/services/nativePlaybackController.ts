import type { Track, RepeatMode } from '../types/music';
import { nativePlaybackBridge, type NativeTrackPayload } from './nativePlaybackBridge';

const SETTINGS_KEY = 'stuxs_playback_settings';

export interface NativeControllerCallbacks {
  stopWebAudio: () => void;
  resumeWebAudio: () => void;
  onFallback: (error: string) => void;
}

export type NativeProgressCallback = (positionSec: number, durationSec: number, isPlaying: boolean) => void;

class NativePlaybackController {
  private _isNativeEngineActive = false;
  private pollingInterval: any = null;
  private progressCallback: NativeProgressCallback | null = null;

  constructor() {
    // Media3 is the permanent authoritative production playback engine
    this.readSetting();
  }

  private readSetting(): boolean {
    try {
      if (typeof window === 'undefined') return true;
      const saved = localStorage.getItem(SETTINGS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.useNativeAudioEngine !== true) {
          parsed.useNativeAudioEngine = true;
          localStorage.setItem(SETTINGS_KEY, JSON.stringify(parsed));
        }
        return true;
      }
    } catch {
      // fallback safe
    }
    return true;
  }

  public isEnabled(): boolean {
    return nativePlaybackBridge.isAvailable();
  }

  public setEnabled(enabled: boolean): void {
    try {
      if (typeof window === 'undefined') return;
      const saved = localStorage.getItem(SETTINGS_KEY);
      const current = saved ? JSON.parse(saved) : {};
      current.useNativeAudioEngine = enabled;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(current));
    } catch {
      // fallback safe
    }
    if (!enabled) {
      this.deactivate();
    }
  }

  public isNativeModeActive(): boolean {
    return this._isNativeEngineActive;
  }

  /**
   * Queries authoritative native Media3/ExoPlayer state.
   * Distinguishes whether the native engine has actually loaded a media item,
   * regardless of whether React restored currentTrack from localStorage.
   */
  public async getActualNativePlaybackState(): Promise<{
    isLoaded: boolean;
    currentTrackId: string | null;
    currentTrack?: any;
    isPlaying: boolean;
    state: string;
    positionMs?: number;
    durationMs?: number;
    currentIndex?: number;
    queue?: any[];
  }> {
    if (!this.isEnabled()) {
      return { isLoaded: false, currentTrackId: null, isPlaying: false, state: 'DISABLED' };
    }
    try {
      const state = await nativePlaybackBridge.getPlaybackState();
      if (!state || !state.currentTrack || !state.currentTrack.id || state.state === 'IDLE' || state.state === 'ENDED') {
        return { isLoaded: false, currentTrackId: state?.currentTrack?.id || null, isPlaying: false, state: state?.state || 'IDLE' };
      }
      this._isNativeEngineActive = true;
      this.lastObservedTrackId = state.currentTrack.id;
      this.lastKnownIsPlaying = Boolean(state.isPlaying);
      if (typeof state.durationMs === 'number' && state.durationMs > 0) {
        this.lastKnownDuration = state.durationMs / 1000;
      }
      if (state.isPlaying) {
        this.startProgressPolling();
      }
      return {
        isLoaded: true,
        currentTrackId: state.currentTrack.id,
        currentTrack: state.currentTrack,
        isPlaying: Boolean(state.isPlaying),
        state: state.state,
        positionMs: state.positionMs,
        durationMs: state.durationMs,
        currentIndex: state.currentIndex,
        queue: state.queue,
      };
    } catch {
      return { isLoaded: false, currentTrackId: null, isPlaying: false, state: 'ERROR' };
    }
  }

  private onTrackEndedCallback: (() => void) | null = null;
  private onTrackChangedCallback: ((track: any, index?: number) => void) | null = null;
  private onPlaybackStateChangedCallback: ((state: string, isPlaying: boolean, isBuffering: boolean) => void) | null = null;
  private lastObservedTrackId: string | null = null;
  private lastKnownDuration = 0;
  private lastKnownIsPlaying = false;
  private eventListenersInitialized = false;
  private lastTrackEndedTime: number = 0;
  private lastTrackEndedId: string | null = null;
  private fallbackAttempted: boolean = false;
  private fallbackReason: string | null = null;

  public isFallbackAttempted(): boolean {
    return this.fallbackAttempted;
  }

  public getFallbackReason(): string | null {
    return this.fallbackReason;
  }

  public notifyTrackEnded(): void {
    const now = Date.now();
    const currentId = this.lastObservedTrackId;
    if (this.lastTrackEndedId === currentId && now - this.lastTrackEndedTime < 1500) {
      console.warn('[NativePlaybackController] Duplicate trackEnded event ignored for track:', currentId);
      return;
    }
    this.lastTrackEndedTime = now;
    this.lastTrackEndedId = currentId;
    this.onTrackEndedCallback?.();
  }

  public setProgressCallback(cb: NativeProgressCallback | null): void {
    this.progressCallback = cb;
  }

  public setOnTrackEndedCallback(cb: (() => void) | null): void {
    this.onTrackEndedCallback = cb;
  }

  public setOnTrackChangedCallback(cb: ((track: any, index?: number) => void) | null): void {
    this.onTrackChangedCallback = cb;
    this.initNativeEventListeners();
  }

  public setOnPlaybackStateChangedCallback(cb: ((state: string, isPlaying: boolean, isBuffering: boolean) => void) | null): void {
    this.onPlaybackStateChangedCallback = cb;
    this.initNativeEventListeners();
  }

  private initNativeEventListeners(): void {
    if (this.eventListenersInitialized) return;
    this.eventListenersInitialized = true;

    nativePlaybackBridge.addListener('trackChanged', (data) => {
      if (data && data.id) {
        if (this.lastObservedTrackId === data.id) return;
        this.lastObservedTrackId = data.id;
        this.lastKnownIsPlaying = true;
        const durSec = typeof data.durationMs === 'number' && data.durationMs > 0 ? data.durationMs / 1000 : 0;
        this.lastKnownDuration = durSec;
        if (this.progressCallback) {
          this.progressCallback(0, durSec, true);
        }
        this.onTrackChangedCallback?.(data, data.currentIndex);
      }
    });

    nativePlaybackBridge.addListener('playbackStateChanged', (data) => {
      if (!data) return;
      const isPlaying = typeof data.isPlaying === 'boolean'
        ? data.isPlaying
        : data.state === 'PLAYING';
      const isBuffering = typeof data.isBuffering === 'boolean'
        ? data.isBuffering
        : data.state === 'BUFFERING';

      this.lastKnownIsPlaying = isPlaying;
      if (this.onPlaybackStateChangedCallback) {
        this.onPlaybackStateChangedCallback(data.state || '', isPlaying, isBuffering);
      }
      if (isPlaying && this._isNativeEngineActive) {
        this.startProgressPolling();
      } else if (!isPlaying && !isBuffering) {
        this.stopProgressPolling();
      }
    });

    nativePlaybackBridge.addListener('playbackEnded', () => {
      this.stopProgressPolling();
      this.lastKnownIsPlaying = false;
      this.notifyTrackEnded();
    });
  }

  public startProgressPolling(): void {
    this.stopProgressPolling();
    this.initNativeEventListeners();
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return;
    }
    this.pollingInterval = setInterval(async () => {
      if (!this._isNativeEngineActive) {
        this.stopProgressPolling();
        return;
      }
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        this.stopProgressPolling();
        return;
      }
      try {
        const state = await nativePlaybackBridge.getPlaybackState();
        if (state) {
          if (state.currentTrack && state.currentTrack.id) {
            if (this.lastObservedTrackId !== state.currentTrack.id) {
              this.lastObservedTrackId = state.currentTrack.id;
              this.lastKnownIsPlaying = state.isPlaying;
              const durSec = state.durationMs > 0 ? state.durationMs / 1000 : 0;
              this.lastKnownDuration = durSec;
              if (this.progressCallback) {
                this.progressCallback(0, durSec, state.isPlaying);
              }
              this.onTrackChangedCallback?.(state.currentTrack, state.currentIndex);
            }
          }
          if (typeof state.positionMs === 'number') {
            const posSec = Math.max(0, state.positionMs / 1000);
            const durSec = state.durationMs > 0 ? state.durationMs / 1000 : this.lastKnownDuration;
            this.lastKnownDuration = durSec;
            this.lastKnownIsPlaying = state.isPlaying;
            if (this.progressCallback) {
              this.progressCallback(posSec, durSec, state.isPlaying);
            }
          }
          if (state.state === 'ENDED' && !state.isPlaying && this.onTrackEndedCallback) {
            this.stopProgressPolling();
            this.notifyTrackEnded();
          }
        }
      } catch (err) {
        // Safe swallow
      }
    }, 1000);
  }

  public stopProgressPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  public toNativePayload(track: Track): NativeTrackPayload {
    return {
      id: track.id,
      title: track.title,
      artist: track.artistName,
      album: track.albumTitle || '',
      artworkUrl: track.artworkUrl || '',
      audioUrl: track.audioUrl || track.previewUrl || '',
      localFilePath: track.localPath,
      durationMs: Math.round((track.duration || 0) * 1000),
      provider: track.provider,
      isM3U: track.id.startsWith('m3u-') || Boolean(track.audioUrl?.includes('.m3u8')),
      lyricsLrc: Array.isArray(track.lyrics) ? track.lyrics.join('\n') : undefined
    };
  }

  /**
   * Routes track playback to native Media3 when enabled.
   * Enforces mutual exclusion:
   * 1. Stops WebAudio.
   * 2. Activates native mode (suppresses legacy MusicService, starts Media3 foreground service).
   * 3. Plays track via StuxsExoPlayerEngine.
   * If native fails, restores WebAudio safely without corrupting queue state.
   */
  public async playTrack(
    track: Track,
    callbacks: NativeControllerCallbacks,
    options?: {
      queue?: Track[];
      startIndex?: number;
      repeatMode?: RepeatMode;
      isShuffled?: boolean;
    }
  ): Promise<{ handledByNative: boolean; success: boolean }> {
    if (!this.isEnabled()) {
      // Legacy path is authoritative
      this._isNativeEngineActive = false;
      this.stopProgressPolling();
      this.fallbackAttempted = false;
      this.fallbackReason = null;
      return { handledByNative: false, success: false };
    }

    const payload = this.toNativePayload(track);
    if (!payload.audioUrl && !payload.localFilePath) {
      console.warn('[NativePlaybackController] Track has no stream URL or local path, falling back to web audio');
      this._isNativeEngineActive = false;
      this.stopProgressPolling();
      this.fallbackAttempted = true;
      this.fallbackReason = 'Track has no stream URL or local path';
      return { handledByNative: false, success: false };
    }

    try {
      // Step 1: Enforce mutual exclusion - stop WebAudio first
      callbacks.stopWebAudio();

      // Step 2: Suppress legacy MusicService and activate native MediaSession
      await nativePlaybackBridge.activateNativeMode();

      // Step 3: Dispatch playback with full native queue to StuxsExoPlayerEngine
      const nativeQueue = options?.queue && options.queue.length > 0
        ? options.queue.map(t => this.toNativePayload(t))
        : undefined;

      const started = await nativePlaybackBridge.playTrack(payload, {
        queue: nativeQueue,
        startIndex: options?.startIndex,
        repeatMode: options?.repeatMode,
        shuffleEnabled: options?.isShuffled,
      });

      if (started) {
        this.fallbackAttempted = false;
        this.fallbackReason = null;
        this.lastObservedTrackId = track.id;
        this.lastKnownDuration = track.duration || 0;
        this.lastKnownIsPlaying = true;
        this._isNativeEngineActive = true;
        this.startProgressPolling();
        return { handledByNative: true, success: true };
      }

      // Step 4: Native stream error or rejected
      throw new Error('Native player engine failed to initiate playback');
    } catch (err: any) {
      console.error('[NativePlaybackController] Native playback error:', err);

      // Safe error reporting without falling back to WebAudio while native is enabled
      this.fallbackAttempted = true;
      this.fallbackReason = err?.message || 'Native playback failed';
      this.stopProgressPolling();
      callbacks.onFallback(err?.message || 'Native playback failed');

      return { handledByNative: true, success: false };
    }
  }

  public async togglePlay(
    _isPlaying: boolean,
    webAudioToggle: () => void
  ): Promise<void> {
    if (this.isEnabled()) {
      const ok = await nativePlaybackBridge.togglePlay();
      if (ok) {
        this._isNativeEngineActive = true;
      }
      return;
    }
    webAudioToggle();
  }

  public async pause(webAudioPause: () => void): Promise<void> {
    if (this.isEnabled()) {
      this.stopProgressPolling();
      await nativePlaybackBridge.pause();
      return;
    }
    webAudioPause();
  }

  public async stop(webAudioStop?: () => void): Promise<void> {
    this._isNativeEngineActive = false;
    this.stopProgressPolling();
    if (this.isEnabled()) {
      await nativePlaybackBridge.stop();
      return;
    }
    if (webAudioStop) {
      webAudioStop();
    }
  }

  public async resume(webAudioResume: () => void): Promise<void> {
    if (this.isEnabled()) {
      const ok = await nativePlaybackBridge.resume();
      if (ok) {
        this._isNativeEngineActive = true;
        this.startProgressPolling();
      }
      return;
    }
    webAudioResume();
  }

  public async seek(seconds: number, webAudioSeek?: (sec: number) => void): Promise<void> {
    if (this.isEnabled()) {
      this._isNativeEngineActive = true;
      const positionMs = Math.round(seconds * 1000);
      const wasPlaying = this.lastKnownIsPlaying;
      // Immediately notify UI of the scrubbed position while preserving current playing state
      if (this.progressCallback) {
        this.progressCallback(seconds, this.lastKnownDuration, wasPlaying);
      }
      try {
        await nativePlaybackBridge.seekTo(positionMs);
      } finally {
        if (wasPlaying && (this._isNativeEngineActive || this.isEnabled())) {
          this.startProgressPolling();
        }
      }
      return;
    }
    if (webAudioSeek) {
      webAudioSeek(seconds);
    }
  }

  public async reloadCurrentTrackSource(
    newAudioUrl: string,
    positionMs: number,
    playWhenReady: boolean,
    webAudioReload: () => void
  ): Promise<boolean> {
    if (this.isEnabled() && this._isNativeEngineActive) {
      try {
        const ok = await nativePlaybackBridge.reloadCurrentTrackSource({
          audioUrl: newAudioUrl,
          initialPositionMs: positionMs,
          playWhenReady,
        });
        if (ok) {
          if (playWhenReady) {
            this.startProgressPolling();
          } else {
            this.stopProgressPolling();
          }
          return true;
        }
      } catch (err) {
        console.warn('[NativePlaybackController] reloadCurrentTrackSource error:', err);
      }
    }
    webAudioReload();
    return false;
  }

  public async setRepeatMode(mode: RepeatMode, webAudioRepeat?: () => void): Promise<void> {
    if (this.isEnabled()) {
      await nativePlaybackBridge.setRepeatMode(mode);
    }
    if (webAudioRepeat) webAudioRepeat();
  }

  public async setShuffleMode(enabled: boolean, webAudioShuffle?: () => void): Promise<void> {
    if (this.isEnabled()) {
      await nativePlaybackBridge.setShuffleMode(enabled);
    }
    if (webAudioShuffle) webAudioShuffle();
  }

  public async syncQueue(queue: Track[], startIndex: number): Promise<void> {
    if (this.isEnabled()) {
      const nativeQueue = queue.map(t => this.toNativePayload(t));
      await nativePlaybackBridge.setQueue(nativeQueue, startIndex);
    }
  }

  public async updateQueue(queue: Track[], newIndex?: number): Promise<void> {
    if (this.isEnabled()) {
      const nativeQueue = queue.map(t => this.toNativePayload(t));
      await nativePlaybackBridge.updateQueue(nativeQueue, newIndex);
    }
  }

  public async skipToNext(): Promise<boolean> {
    if (this.isEnabled()) {
      return await nativePlaybackBridge.skipToNext();
    }
    return false;
  }

  public async skipToPrevious(): Promise<boolean> {
    if (this.isEnabled()) {
      return await nativePlaybackBridge.skipToPrevious();
    }
    return false;
  }

  public async deactivate(): Promise<void> {
    this._isNativeEngineActive = false;
    this.fallbackAttempted = false;
    this.fallbackReason = null;
    this.stopProgressPolling();
    await nativePlaybackBridge.pause();
    await nativePlaybackBridge.deactivateNativeMode();
  }
}

export const nativePlaybackController = new NativePlaybackController();
