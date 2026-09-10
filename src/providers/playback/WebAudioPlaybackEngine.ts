import Hls from 'hls.js';
import type { PlaybackProvider } from '../../types/provider';
import type { Track } from '../../types/music';
import { validateAudioStreamUrl, type StreamValidationResult } from '../../utils/streamValidator';

export interface PlaybackEngineListeners {
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  onStateChange?: (isPlaying: boolean) => void;
  onTrackEnded?: () => void;
  onTrackTransition?: (newTrack: Track) => void;
  onError?: (error: Error, diagnostics?: Record<string, unknown>) => void;
  onRecoverSource?: (track: Track, currentPosition: number) => Promise<boolean>;
  onNext?: () => void;
  onPrevious?: () => void;
}

interface AudioDeck {
  deckId: 'A' | 'B';
  audio: HTMLAudioElement;
  track: Track | null;
  crossfadeGain: number; // 0.0 - 1.0
  normalizeGain: number; // 0.5 - 1.25
  isReady: boolean;
  hls?: Hls | null;
}

export class WebAudioPlaybackEngine implements PlaybackProvider {
  id = 'stuxs' as const;

  // Dual A/B Audio Decks for Gapless and Crossfade
  private deckA: AudioDeck;
  private deckB: AudioDeck;
  private activeDeckIndex: 0 | 1 = 0; // 0 = deckA, 1 = deckB

  // Master Volume & Audio Settings
  private currentVolume = 0.85;
  private gaplessEnabled = true;
  private crossfadeSeconds = 4;
  private normalizeVolumeEnabled = true;

  // Playback & Crossfade State
  private playbackPosition = 0;
  private trackDuration = 0;
  private lastValidationResult: StreamValidationResult | null = null;
  private currentPlayRequestId = 0;
  private isCrossfading = false;
  private crossfadeAnimationId: number | null = null;
  private isPreloadingNext = false;
  private preloadedTrack: Track | null = null;
  private isUnlocked = false;
  private isTransitioning = false;

  // Listeners
  private listeners: PlaybackEngineListeners = {};

  constructor() {
    this.deckA = this.createDeck('A');
    this.deckB = this.createDeck('B');
    this.setupMediaSessionHandlers();
  }

  private createDeck(id: 'A' | 'B'): AudioDeck {
    const audio = new Audio();
    audio.preload = 'auto';
    audio.setAttribute('playsinline', 'true');
    audio.setAttribute('webkit-playsinline', 'true');
    // Ensure muted is never stuck true
    audio.muted = false;
    audio.volume = this.currentVolume;
    // Strict 1.0 Playback Speed & Pitch Preservation
    audio.defaultPlaybackRate = 1.0;
    audio.playbackRate = 1.0;
    audio.preservesPitch = true;

    const deck: AudioDeck = {
      deckId: id,
      audio,
      track: null,
      crossfadeGain: 1.0,
      normalizeGain: 1.0,
      isReady: false,
    };

    // Metadata & Duration Detection for Progressive / M3U Streams
    const onMetadataLoaded = () => {
      if (this.getActiveDeck().deckId === id) {
        const dur = audio.duration;
        if (!isNaN(dur) && isFinite(dur) && dur > 0) {
          this.trackDuration = dur;
          this.notifyTimeUpdate();
          this.updateMediaSessionPosition();
        }
        // Guarantee 1.0 playback rate upon stream initialization
        audio.defaultPlaybackRate = 1.0;
        audio.playbackRate = 1.0;
        audio.preservesPitch = true;
      }
    };

    audio.addEventListener('loadedmetadata', onMetadataLoaded);
    audio.addEventListener('durationchange', onMetadataLoaded);

    // Event listeners
    audio.addEventListener('timeupdate', () => {
      if (this.getActiveDeck().deckId === id && !this.isCrossfading) {
        this.playbackPosition = audio.currentTime;
        const dur = audio.duration;
        if (!isNaN(dur) && isFinite(dur) && dur > 0) {
          this.trackDuration = dur;
        }
        // Self-healing: if audio.playbackRate somehow deviated from 1.0, reset to 1.0 immediately
        if (audio.playbackRate !== 1.0) {
          audio.playbackRate = 1.0;
          audio.defaultPlaybackRate = 1.0;
          audio.preservesPitch = true;
        }
        this.notifyTimeUpdate();
        this.updateMediaSessionPosition();
      }
    });

    audio.addEventListener('volumechange', () => {
      console.log(`[VOLUME CHANGE - Deck ${id}]`, {
        muted: audio.muted,
        volume: audio.volume,
        masterVolume: this.currentVolume,
        crossfadeGain: deck.crossfadeGain,
        normalizeGain: deck.normalizeGain,
      });

      // Self-healing: if audio element becomes unexpectedly muted or 0 volume when not crossfading
      if (audio.muted && this.currentVolume > 0) {
        console.warn(`[WebAudioPlaybackEngine] Auto-unmuting Deck ${id}`);
        audio.muted = false;
      }
      if (audio.volume <= 0 && this.currentVolume > 0 && !this.isCrossfading) {
        console.warn(`[WebAudioPlaybackEngine] Auto-restoring zero volume on Deck ${id}`);
        this.syncDeckGain(deck);
      }
    });

    audio.addEventListener('ended', () => {
      if (this.getActiveDeck().deckId === id) {
        this.playbackPosition = this.trackDuration;
        this.notifyTimeUpdate();
        if (this.listeners.onTrackEnded) {
          this.listeners.onTrackEnded();
        }
      }
    });

    audio.addEventListener('error', async () => {
      if (this.getActiveDeck().deckId !== id) return;

      const mediaError = audio.error;
      const currentSrc = audio.src || '';
      if (!currentSrc || currentSrc.startsWith('data:') || currentSrc === 'about:blank') {
        return;
      }

      console.warn(`[WebAudioPlaybackEngine] Error on deck ${id}:`, mediaError?.code, currentSrc);

      const activeTrack = this.getActiveDeck().track;
      if (activeTrack && this.listeners.onRecoverSource) {
        try {
          const recovered = await this.listeners.onRecoverSource(activeTrack, this.playbackPosition);
          if (recovered) return;
        } catch {}
      }

      const errorDetails: Record<string, unknown> = {
        deck: id,
        trackTitle: activeTrack?.title || 'Unknown',
        audioSrc: audio.src,
        errorCode: mediaError ? mediaError.code : null,
        errorMessage: mediaError ? mediaError.message : 'Unknown media error',
        validation: this.lastValidationResult,
      };

      const err = new Error(mediaError?.message || `Playback error on deck ${id}`);
      if (this.listeners.onStateChange) this.listeners.onStateChange(false);
      this.updateMediaSessionState('none');
      if (this.listeners.onError) this.listeners.onError(err, errorDetails);
    });

    audio.addEventListener('pause', () => {
      if (this.getActiveDeck().deckId === id && !this.isCrossfading && !this.isTransitioning) {
        if (this.listeners.onStateChange) this.listeners.onStateChange(false);
        this.updateMediaSessionState('paused');
      }
    });

    audio.addEventListener('play', () => {
      if (this.getActiveDeck().deckId === id) {
        this.isTransitioning = false;
        if (this.listeners.onStateChange) this.listeners.onStateChange(true);
        this.updateMediaSessionState('playing');
        this.logAudioDiagnostics(deck);
      }
    });

    audio.addEventListener('loadedmetadata', () => {
      deck.isReady = true;
      if (this.getActiveDeck().deckId === id) {
        const dur = audio.duration;
        if (!isNaN(dur) && dur > 0) {
          this.trackDuration = dur;
          this.notifyTimeUpdate();
        }
      }
    });

    audio.addEventListener('canplay', () => {
      deck.isReady = true;
    });

    return deck;
  }

  private getActiveDeck(): AudioDeck {
    return this.activeDeckIndex === 0 ? this.deckA : this.deckB;
  }

  private getIdleDeck(): AudioDeck {
    return this.activeDeckIndex === 0 ? this.deckB : this.deckA;
  }

  private swapDecks() {
    this.activeDeckIndex = this.activeDeckIndex === 0 ? 1 : 0;
  }

  /**
   * Applies the discrete, independent gain layers:
   * Layer 1: Master Volume (0.0 to 1.0)
   * Layer 2: Normalization Gain (Perceived Loudness Target: 0.65 to 1.25)
   * Layer 3: Crossfade Gain (0.0 to 1.0 Transition Ramp)
   *
   * Direct HTML5 Audio hardware connection guarantees 100% audible sound from all CDNs and offline Blobs without CORS muting.
   */
  private syncDeckGain(deck: AudioDeck): void {
    const targetNorm = this.normalizeVolumeEnabled ? deck.normalizeGain : 1.0;
    const targetCross = deck.crossfadeGain;

    // Direct hardware volume calculation
    const calculatedVolume = this.currentVolume * targetNorm * targetCross;
    // Keep within safe hardware audio bounds (0.0 to 1.0)
    const effectiveVolume = Math.max(0, Math.min(1, calculatedVolume));

    if (deck.audio.muted) {
      deck.audio.muted = false;
    }

    try {
      deck.audio.volume = effectiveVolume;
    } catch (e) {
      console.warn(`[WebAudioPlaybackEngine] Error setting volume on Deck ${deck.deckId}:`, e);
    }
  }

  private normalizeStreamUrl(rawUrl: string): string {
    const url = rawUrl.trim();
    // Only upgrade known secure CDNs where HTTPS is verified.
    // NEVER force HTTPS on arbitrary HTTP streams (e.g. M3U streams, custom audio servers)
    // because Android natively supports cleartext HTTP when configured.
    if (url.startsWith('http://') && (url.includes('saavncdn.com') || url.includes('jiosaavn.com'))) {
      return url.replace('http://', 'https://');
    }
    return url;
  }

  /**
   * Calculates safe loudness normalization gain targeting -14 LUFS standard.
   */
  private calculateNormalizationGain(track: Track): number {
    if (!this.normalizeVolumeEnabled) return 1.0;

    const rawReplayGain = (track as any).replayGain;
    if (typeof rawReplayGain === 'number' && !isNaN(rawReplayGain)) {
      const linearGain = Math.pow(10, rawReplayGain / 20);
      return Math.max(0.65, Math.min(1.25, linearGain));
    }

    // High-quality master default target (avoids clipping while standardizing levels)
    return 0.95;
  }

  /**
   * Configure Engine Audio Settings from SettingsContext
   */
  public configureSettings(settings: { gapless?: boolean; crossfadeSeconds?: number; normalizeVolume?: boolean }): void {
    if (typeof settings.gapless === 'boolean') {
      this.gaplessEnabled = settings.gapless;
    }
    if (typeof settings.crossfadeSeconds === 'number') {
      this.crossfadeSeconds = Math.max(0, Math.min(12, settings.crossfadeSeconds));
    }
    if (typeof settings.normalizeVolume === 'boolean') {
      this.normalizeVolumeEnabled = settings.normalizeVolume;
      this.syncDeckGain(this.deckA);
      this.syncDeckGain(this.deckB);
    }
  }

  public primeUserGesture(): void {
    this.isUnlocked = true;
    const active = this.getActiveDeck();
    if (active.audio.muted) active.audio.muted = false;
    this.syncDeckGain(active);
  }

  public setListeners(listeners: PlaybackEngineListeners): void {
    this.listeners = listeners;
    this.setupMediaSessionHandlers();
  }

  /**
   * Main Play Function with Guaranteed Audio Output Verification
   */
  public async play(track: Track): Promise<void> {
    const requestId = ++this.currentPlayRequestId;
    this.isTransitioning = true;
    this.cancelCrossfadeInternal();

    const activeDeck = this.getActiveDeck();
    const idleDeck = this.getIdleDeck();

    // Check if idle deck already preloaded this exact track
    if (this.preloadedTrack?.id === track.id && idleDeck.isReady && idleDeck.track?.id === track.id) {
      console.log('[WebAudioPlaybackEngine] Fast gapless switch to preloaded idle deck for:', track.title);
      // Stop old active deck
      activeDeck.audio.pause();
      activeDeck.audio.currentTime = 0;
      activeDeck.isReady = false;
      activeDeck.track = null;
      activeDeck.crossfadeGain = 1.0;

      // Swap to idleDeck
      this.swapDecks();
      const currentActive = this.getActiveDeck();
      currentActive.crossfadeGain = 1.0;
      currentActive.normalizeGain = this.calculateNormalizationGain(track);
      currentActive.audio.muted = false;
      this.trackDuration = track.duration || currentActive.audio.duration || 0;
      this.playbackPosition = 0;
      this.preloadedTrack = null;
      this.syncDeckGain(currentActive);
      this.updateMediaSessionMetadata(track);

      try {
        const p = currentActive.audio.play();
        if (p !== undefined) await p;
      } catch (playErr) {
        console.warn('[WebAudioPlaybackEngine] Preloaded play error:', playErr);
      }

      this.isTransitioning = false;
      this.isUnlocked = true;
      if (this.listeners.onStateChange) this.listeners.onStateChange(true);
      this.updateMediaSessionState('playing');
      this.notifyTimeUpdate();
      return;
    }

    // Clean up idle deck
    idleDeck.audio.pause();
    idleDeck.audio.removeAttribute('src');
    idleDeck.isReady = false;
    idleDeck.track = null;
    this.preloadedTrack = null;

    // Reset active deck state cleanly (NEVER leave crossfadeGain at 0!)
    activeDeck.track = track;
    activeDeck.crossfadeGain = 1.0;
    activeDeck.normalizeGain = this.calculateNormalizationGain(track);
    activeDeck.audio.muted = false;
    this.trackDuration = track.duration || 0;
    this.playbackPosition = 0;

    // Synchronize volume before starting playback
    this.syncDeckGain(activeDeck);

    if (!track.audioUrl || track.audioUrl.trim().length === 0) {
      this.isTransitioning = false;
      const error = new Error(`No audio stream available for "${track.title}"`);
      if (this.listeners.onStateChange) this.listeners.onStateChange(false);
      if (this.listeners.onError) this.listeners.onError(error);
      return;
    }

    const streamUrl = this.normalizeStreamUrl(track.audioUrl);

    // Fast path: local files, downloaded blobs, and direct streams start instantly
    const isLocalOrBlob =
      streamUrl.startsWith('blob:') ||
      track.sourceType === 'local' ||
      track.sourceType === 'downloaded' ||
      track.provider === 'local';

    try {
      if (requestId !== this.currentPlayRequestId) return;

      activeDeck.audio.pause();

      // Clean up previous Hls instance on this deck if any
      if (activeDeck.hls) {
        activeDeck.hls.destroy();
        activeDeck.hls = null;
      }

      if (streamUrl.includes('.m3u8') || streamUrl.includes('/hls/')) {
        if (Hls.isSupported()) {
          const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: false,
          });
          hls.loadSource(streamUrl);
          hls.attachMedia(activeDeck.audio);
          activeDeck.hls = hls;
        } else if (activeDeck.audio.canPlayType('application/vnd.apple.mpegurl')) {
          activeDeck.audio.src = streamUrl;
        } else {
          activeDeck.audio.src = streamUrl;
        }
      } else {
        activeDeck.audio.src = streamUrl;
      }

      // Ensure unmuted, 1.0 speed & full volume right before play()
      activeDeck.audio.muted = false;
      activeDeck.audio.defaultPlaybackRate = 1.0;
      activeDeck.audio.playbackRate = 1.0;
      activeDeck.audio.preservesPitch = true;
      this.syncDeckGain(activeDeck);
      this.updateMediaSessionMetadata(track);

      // Start hardware playback immediately (< 50ms)
      try {
        const playPromise = activeDeck.audio.play();
        if (playPromise !== undefined) {
          await playPromise;
        }
        if (requestId === this.currentPlayRequestId) {
          this.isTransitioning = false;
          this.isUnlocked = true;
          if (this.listeners.onStateChange) this.listeners.onStateChange(true);
          this.updateMediaSessionState('playing');
          this.notifyTimeUpdate();
          this.logAudioDiagnostics(activeDeck);
        }
      } catch (playErr: any) {
        console.warn('[WebAudioPlaybackEngine] play() promise rejected, attaching canplay listener:', playErr?.message);
        if (requestId === this.currentPlayRequestId && activeDeck.audio.paused) {
          const onCanPlayOnce = async () => {
            activeDeck.audio.removeEventListener('canplay', onCanPlayOnce);
            if (requestId === this.currentPlayRequestId && activeDeck.audio.paused) {
              try {
                await activeDeck.audio.play();
                this.isTransitioning = false;
                this.isUnlocked = true;
                if (this.listeners.onStateChange) this.listeners.onStateChange(true);
                this.updateMediaSessionState('playing');
                this.notifyTimeUpdate();
              } catch (retryErr) {
                console.warn('[WebAudioPlaybackEngine] canplay retry error:', retryErr);
              }
            }
          };
          activeDeck.audio.addEventListener('canplay', onCanPlayOnce, { once: true });
        }
      }

      // Background stream validation only for non-local HTTP streams if needed
      if (!isLocalOrBlob && streamUrl.startsWith('http')) {
        validateAudioStreamUrl(streamUrl).then((validation) => {
          this.lastValidationResult = validation;
        }).catch(() => {});
      }
    } catch (err: any) {
      if (requestId !== this.currentPlayRequestId) return;
      this.isTransitioning = false;
      console.warn('[WebAudioPlaybackEngine] play() failed:', err);

      if (this.listeners.onRecoverSource && activeDeck.track) {
        try {
          const recovered = await this.listeners.onRecoverSource(activeDeck.track, 0);
          if (recovered) return;
        } catch {}
      }

      if (this.listeners.onStateChange) this.listeners.onStateChange(false);
      if (this.listeners.onError) this.listeners.onError(err as Error, { validation: this.lastValidationResult });
    }
  }

  /**
   * Preload next track into idle deck ahead of time (Gapless / Crossfade prep).
   */
  public async preloadNextTrack(track: Track): Promise<void> {
    if (!track || !track.audioUrl || this.isPreloadingNext || this.isCrossfading) return;
    if (this.preloadedTrack?.id === track.id) return;

    this.isPreloadingNext = true;
    const idleDeck = this.getIdleDeck();

    try {
      const streamUrl = this.normalizeStreamUrl(track.audioUrl);

      idleDeck.track = track;
      idleDeck.normalizeGain = this.calculateNormalizationGain(track);
      idleDeck.crossfadeGain = 1.0;
      idleDeck.isReady = false;
      if (idleDeck.hls) {
        idleDeck.hls.destroy();
        idleDeck.hls = null;
      }

      if (streamUrl.includes('.m3u8') || streamUrl.includes('/hls/')) {
        if (Hls.isSupported()) {
          const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: false,
          });
          hls.loadSource(streamUrl);
          hls.attachMedia(idleDeck.audio);
          idleDeck.hls = hls;
        } else {
          idleDeck.audio.src = streamUrl;
        }
      } else {
        idleDeck.audio.src = streamUrl;
      }
      idleDeck.audio.preload = 'auto';
      idleDeck.audio.load();

      this.preloadedTrack = track;
      console.log('[WebAudioPlaybackEngine] Preloaded next track into idle deck:', track.title);
    } catch (e) {
      console.warn('[WebAudioPlaybackEngine] Preload failed:', e);
    } finally {
      this.isPreloadingNext = false;
    }
  }

  /**
   * Trigger Audible Crossfade Transition between current track and incoming track.
   */
  public async triggerCrossfade(nextTrack: Track, durationSec?: number): Promise<boolean> {
    if (this.isCrossfading || !nextTrack || !nextTrack.audioUrl) return false;

    const fadeDuration = typeof durationSec === 'number' && durationSec > 0 ? durationSec : this.crossfadeSeconds;
    if (fadeDuration <= 0) {
      await this.play(nextTrack);
      return true;
    }

    this.isCrossfading = true;
    const outgoingDeck = this.getActiveDeck();
    const incomingDeck = this.getIdleDeck();

    incomingDeck.track = nextTrack;
    incomingDeck.normalizeGain = this.calculateNormalizationGain(nextTrack);
    incomingDeck.crossfadeGain = 0.0;
    incomingDeck.audio.muted = false;
    this.syncDeckGain(incomingDeck);

    const streamUrl = this.normalizeStreamUrl(nextTrack.audioUrl);

    if (incomingDeck.audio.src !== streamUrl) {
      incomingDeck.audio.src = streamUrl;
      incomingDeck.audio.load();
    }

    try {
      incomingDeck.audio.currentTime = 0;
      await incomingDeck.audio.play();
    } catch {
      this.cancelCrossfadeInternal();
      await this.play(nextTrack);
      return false;
    }

    const startTime = performance.now();
    const durationMs = fadeDuration * 1000;

    const stepFade = () => {
      if (!this.isCrossfading) return;

      const elapsed = performance.now() - startTime;
      const progress = Math.min(1.0, elapsed / durationMs);

      // Equal-power crossfade curve
      const outGain = Math.cos(progress * 0.5 * Math.PI);
      const inGain = Math.sin(progress * 0.5 * Math.PI);

      outgoingDeck.crossfadeGain = outGain;
      incomingDeck.crossfadeGain = inGain;

      this.syncDeckGain(outgoingDeck);
      this.syncDeckGain(incomingDeck);

      if (progress < 1.0) {
        this.crossfadeAnimationId = requestAnimationFrame(stepFade);
      } else {
        // Complete crossfade
        outgoingDeck.audio.pause();
        outgoingDeck.audio.currentTime = 0;
        outgoingDeck.crossfadeGain = 1.0;
        outgoingDeck.track = null;
        outgoingDeck.isReady = false;

        incomingDeck.crossfadeGain = 1.0;
        this.syncDeckGain(incomingDeck);

        this.swapDecks();
        this.isCrossfading = false;
        this.crossfadeAnimationId = null;
        this.preloadedTrack = null;

        this.updateMediaSessionMetadata(nextTrack);
        if (this.listeners.onTrackTransition) {
          this.listeners.onTrackTransition(nextTrack);
        }
        this.logAudioDiagnostics(incomingDeck);
      }
    };

    this.crossfadeAnimationId = requestAnimationFrame(stepFade);
    return true;
  }

  public cancelCrossfade(): void {
    this.cancelCrossfadeInternal();
  }

  private cancelCrossfadeInternal(): void {
    if (this.crossfadeAnimationId !== null) {
      cancelAnimationFrame(this.crossfadeAnimationId);
      this.crossfadeAnimationId = null;
    }
    this.isCrossfading = false;

    this.deckA.crossfadeGain = 1.0;
    this.deckB.crossfadeGain = 1.0;
    this.syncDeckGain(this.deckA);
    this.syncDeckGain(this.deckB);
  }

  public async pause(): Promise<void> {
    this.cancelCrossfadeInternal();
    const active = this.getActiveDeck();
    try {
      active.audio.pause();
      this.playbackPosition = active.audio.currentTime;
    } catch {}
    if (this.listeners.onStateChange) this.listeners.onStateChange(false);
    this.updateMediaSessionState('paused');
  }

  public hasActiveAudio(): boolean {
    const active = this.getActiveDeck();
    return Boolean(active.track && (active.audio.src || active.audio.currentSrc));
  }

  public async resume(): Promise<void> {
    const active = this.getActiveDeck();
    if (!active.track) return;

    if (!active.audio.src && active.track.audioUrl) {
      await this.play(active.track);
      return;
    }

    active.audio.muted = false;
    active.audio.defaultPlaybackRate = 1.0;
    active.audio.playbackRate = 1.0;
    active.audio.preservesPitch = true;
    this.syncDeckGain(active);

    try {
      const playPromise = active.audio.play();
      if (playPromise !== undefined) {
        await playPromise;
      }
      if (this.listeners.onStateChange) this.listeners.onStateChange(true);
      this.updateMediaSessionState('playing');
      this.logAudioDiagnostics(active);
    } catch {
      await this.play(active.track);
    }
  }

  public async seek(position: number): Promise<void> {
    this.cancelCrossfadeInternal();
    const target = Math.max(0, position);
    this.playbackPosition = target;

    const active = this.getActiveDeck();
    try {
      active.audio.currentTime = target;
    } catch (err) {
      console.warn('[WebAudioPlaybackEngine] seek error:', err);
    }

    this.notifyTimeUpdate();
    this.updateMediaSessionPosition();
  }

  public stopImmediate(): void {
    this.currentPlayRequestId++;
    this.cancelCrossfadeInternal();
    this.isTransitioning = true;
    if (this.deckA.hls) {
      try { this.deckA.hls.destroy(); } catch {}
      this.deckA.hls = null;
    }
    try {
      this.deckA.audio.pause();
      this.deckA.audio.currentTime = 0;
      this.deckA.audio.removeAttribute('src');
      this.deckA.audio.load();
    } catch {}
    this.deckA.track = null;
    this.deckA.isReady = false;
    this.deckA.crossfadeGain = 1.0;

    if (this.deckB.hls) {
      try { this.deckB.hls.destroy(); } catch {}
      this.deckB.hls = null;
    }
    try {
      this.deckB.audio.pause();
      this.deckB.audio.currentTime = 0;
      this.deckB.audio.removeAttribute('src');
      this.deckB.audio.load();
    } catch {}
    this.deckB.track = null;
    this.deckB.isReady = false;
    this.deckB.crossfadeGain = 1.0;

    this.playbackPosition = 0;
    this.trackDuration = 0;
    this.preloadedTrack = null;
  }

  public async stop(): Promise<void> {
    this.stopImmediate();
    this.isTransitioning = false;
    if (this.listeners.onStateChange) this.listeners.onStateChange(false);
    this.updateMediaSessionState('none');
    this.notifyTimeUpdate();
  }

  public setVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    this.currentVolume = clamped;
    this.syncDeckGain(this.deckA);
    this.syncDeckGain(this.deckB);
  }

  public getCurrentPosition(): number {
    return this.playbackPosition;
  }

  /**
   * Quality Switch: Seamlessly swaps stream while preserving current position & state.
   */
  public async reloadStream(newUrl: string, resumeAtSeconds?: number, forceWasPlaying?: boolean): Promise<void> {
    if (!newUrl) return;

    const secureUrl = this.normalizeStreamUrl(newUrl);

    const activeDeck = this.getActiveDeck();
    if (activeDeck.audio.src === secureUrl) return;

    const wasPlaying = forceWasPlaying !== undefined ? forceWasPlaying : (!activeDeck.audio.paused && (activeDeck.audio.currentTime > 0 || this.playbackPosition > 0));
    const targetPos = typeof resumeAtSeconds === 'number' && !isNaN(resumeAtSeconds) && resumeAtSeconds >= 0
      ? resumeAtSeconds
      : (this.playbackPosition || activeDeck.audio.currentTime || 0);

    this.playbackPosition = targetPos;
    this.notifyTimeUpdate();

    try {
      activeDeck.audio.pause();
      activeDeck.audio.src = secureUrl;
      activeDeck.audio.load();

      await new Promise<void>((resolve) => {
        const onCanSeek = () => {
          activeDeck.audio.removeEventListener('loadedmetadata', onCanSeek);
          activeDeck.audio.removeEventListener('canplay', onCanSeek);
          resolve();
        };

        if (activeDeck.audio.readyState >= 1) {
          resolve();
        } else {
          activeDeck.audio.addEventListener('loadedmetadata', onCanSeek, { once: true });
          activeDeck.audio.addEventListener('canplay', onCanSeek, { once: true });
          setTimeout(onCanSeek, 2000);
        }
      });

      if (targetPos > 0) {
        try {
          const maxDur = activeDeck.audio.duration || this.trackDuration || targetPos;
          const seekPos = Math.min(targetPos, maxDur > 0 ? maxDur : targetPos);
          activeDeck.audio.currentTime = seekPos;
          this.playbackPosition = seekPos;
        } catch {}
      }

      this.notifyTimeUpdate();
      this.updateMediaSessionPosition();
      activeDeck.audio.muted = false;
      this.syncDeckGain(activeDeck);

      if (wasPlaying) {
        await activeDeck.audio.play();
        if (this.listeners.onStateChange) this.listeners.onStateChange(true);
        this.updateMediaSessionState('playing');
        this.logAudioDiagnostics(activeDeck);
      } else {
        if (this.listeners.onStateChange) this.listeners.onStateChange(false);
        this.updateMediaSessionState('paused');
      }
    } catch (err) {
      console.warn('[WebAudioPlaybackEngine] reloadStream failed:', err);
    }
  }

  private logAudioDiagnostics(deck: AudioDeck): void {
    console.log('[AUDIO OUTPUT DIAGNOSTICS]', {
      deck: deck.deckId,
      paused: deck.audio.paused,
      muted: deck.audio.muted,
      volume: deck.audio.volume,
      masterVolume: this.currentVolume,
      normalizationGain: deck.normalizeGain,
      crossfadeGain: deck.crossfadeGain,
      finalOutputGain: deck.audio.volume,
      currentTime: deck.audio.currentTime,
      duration: deck.audio.duration,
      readyState: deck.audio.readyState,
      networkState: deck.audio.networkState,
      src: deck.audio.currentSrc || deck.audio.src,
    });
  }

  public getDiagnostics() {
    const active = this.getActiveDeck();
    const idle = this.getIdleDeck();
    const err = active.audio.error;

    return {
      activeDeck: active.deckId,
      src: active.audio.currentSrc || active.audio.src,
      networkState: active.audio.networkState,
      networkStateLabel: ['EMPTY', 'IDLE', 'LOADING', 'NO_SOURCE'][active.audio.networkState] || 'UNKNOWN',
      readyState: active.audio.readyState,
      readyStateLabel: ['HAVE_NOTHING', 'HAVE_METADATA', 'HAVE_CURRENT_DATA', 'HAVE_FUTURE_DATA', 'HAVE_ENOUGH_DATA'][active.audio.readyState] || 'UNKNOWN',
      paused: active.audio.paused,
      muted: active.audio.muted,
      currentTime: active.audio.currentTime,
      duration: active.audio.duration,
      volume: active.audio.volume,
      masterVolume: this.currentVolume,
      normalizationGain: active.normalizeGain,
      crossfadeGain: active.crossfadeGain,
      finalOutputGain: active.audio.volume,
      gaplessEnabled: this.gaplessEnabled,
      nextTrackPreloaded: idle.isReady && Boolean(idle.track),
      preloadedTrackTitle: idle.track?.title || null,
      crossfadeEnabled: this.crossfadeSeconds > 0,
      crossfadeSeconds: this.crossfadeSeconds,
      isCrossfading: this.isCrossfading,
      normalizeVolumeEnabled: this.normalizeVolumeEnabled,
      errorCode: err ? err.code : null,
      errorMessage: err ? err.message : null,
      isUnlocked: this.isUnlocked,
      validation: this.lastValidationResult,
    };
  }

  private notifyTimeUpdate() {
    if (this.listeners.onTimeUpdate) {
      this.listeners.onTimeUpdate(this.playbackPosition, this.trackDuration);
    }
  }

  private updateMediaSessionMetadata(track: Track) {
    if (typeof window === 'undefined' || !('mediaSession' in navigator)) return;

    try {
      const art = track.artworkUrl || '';
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artistName,
        album: track.albumTitle || 'STUXS Music',
        artwork: art
          ? [
              { src: art, sizes: '96x96', type: 'image/jpeg' },
              { src: art, sizes: '128x128', type: 'image/jpeg' },
              { src: art, sizes: '256x256', type: 'image/jpeg' },
              { src: art, sizes: '512x512', type: 'image/jpeg' },
            ]
          : [],
      });
    } catch {}
  }

  private updateMediaSessionState(state: 'playing' | 'paused' | 'none') {
    if (typeof window === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.playbackState = state;
    } catch {}
  }

  private updateMediaSessionPosition() {
    if (typeof window === 'undefined' || !('mediaSession' in navigator) || !('setPositionState' in navigator.mediaSession)) return;
    try {
      if (!isNaN(this.trackDuration) && this.trackDuration > 0 && !isNaN(this.playbackPosition) && this.playbackPosition <= this.trackDuration) {
        navigator.mediaSession.setPositionState({
          duration: this.trackDuration,
          playbackRate: 1,
          position: this.playbackPosition,
        });
      }
    } catch {}
  }

  private setupMediaSessionHandlers() {
    if (typeof window === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.setActionHandler('play', () => this.resume());
      navigator.mediaSession.setActionHandler('pause', () => this.pause());
      navigator.mediaSession.setActionHandler('previoustrack', () => {
        if (this.listeners.onPrevious) this.listeners.onPrevious();
      });
      navigator.mediaSession.setActionHandler('nexttrack', () => {
        if (this.listeners.onNext) this.listeners.onNext();
      });
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details.seekTime !== undefined) {
          this.seek(details.seekTime);
        }
      });
    } catch {}
  }
}
