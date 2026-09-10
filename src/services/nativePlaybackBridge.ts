import { registerPlugin, Capacitor } from '@capacitor/core';

export interface NativeTrackPayload {
  id: string;
  title: string;
  artist: string;
  album?: string;
  artworkUrl?: string;
  audioUrl?: string;
  localFilePath?: string;
  durationMs?: number;
  provider?: string;
  isM3U?: boolean;
  lyricsLrc?: string;
}

export interface NativePlayerState {
  state: string;
  isPlaying: boolean;
  isBuffering: boolean;
  positionMs: number;
  durationMs: number;
  bufferedPositionMs: number;
  repeatMode: string;
  shuffleEnabled: boolean;
  currentIndex?: number;
  queueLength?: number;
  queue?: NativeTrackPayload[];
  currentTrack?: {
    id: string;
    title: string;
    artist: string;
    album?: string;
    artworkUrl?: string;
    provider?: string;
  };
  errorMessage?: string;
}

export interface NativePlaybackBridgePluginInterface {
  activateNativeMode(): Promise<{ success: boolean; nativeModeActive: boolean }>;
  deactivateNativeMode(): Promise<{ success: boolean; nativeModeActive: boolean }>;
  playTrack(options: NativeTrackPayload & {
    queue?: NativeTrackPayload[];
    startIndex?: number;
    initialPositionMs?: number;
    repeatMode?: 'OFF' | 'ALL' | 'ONE';
    shuffleEnabled?: boolean;
  }): Promise<{ success: boolean; id: string; title: string; state: string }>;
  togglePlay(): Promise<{ success: boolean; isPlaying: boolean }>;
  pause(): Promise<{ success: boolean; isPlaying: boolean }>;
  stop(): Promise<{ success: boolean; isPlaying: boolean }>;
  resume(): Promise<{ success: boolean; isPlaying: boolean }>;
  seekTo(options: { positionMs: number }): Promise<{ success: boolean; positionMs: number; isPlaying?: boolean; state?: string }>;
  reloadCurrentTrackSource(options: { audioUrl: string; initialPositionMs: number; playWhenReady: boolean }): Promise<{ success: boolean }>;
  skipToNext(): Promise<{ success: boolean }>;
  skipToPrevious(): Promise<{ success: boolean }>;
  setQueue(options: { tracks: NativeTrackPayload[]; startIndex?: number; initialPositionMs?: number }): Promise<{ success: boolean; queueLength: number }>;
  updateQueue(options: { tracks: NativeTrackPayload[]; newIndex?: number }): Promise<{ success: boolean; queueLength: number }>;
  setRepeatMode(options: { mode: 'OFF' | 'ALL' | 'ONE' }): Promise<{ success: boolean; repeatMode: string }>;
  setShuffleMode(options: { enabled: boolean }): Promise<{ success: boolean; shuffleEnabled: boolean }>;
  getPlaybackState(): Promise<NativePlayerState>;
  beginDownloadChunked(options: {
    trackId: string;
    extension?: string;
    metadata?: any;
    skipIfDownloaded?: boolean;
  }): Promise<{
    success: boolean;
    trackId: string;
    nextExpectedChunkIndex: number;
    alreadyDownloaded?: boolean;
    error?: string;
  }>;
  nativeDownloadBegin?(options: {
    trackId: string;
    extension?: string;
    metadata?: any;
    skipIfDownloaded?: boolean;
  }): Promise<{
    success: boolean;
    trackId: string;
    nextExpectedChunkIndex: number;
    alreadyDownloaded?: boolean;
    error?: string;
  }>;
  nativeDownloadAppendChunk?(options: any): Promise<any>;
  nativeDownloadCommit?(options: any): Promise<any>;
  nativeDownloadAbort?(options: any): Promise<any>;
  writeDownloadChunk(options: {
    trackId: string;
    chunkIndex: number;
    chunkData: string;
    extension?: string;
    isLast?: boolean;
    metadata?: any;
  }): Promise<{
    success: boolean;
    trackId: string;
    acceptedChunkIndex: number;
    nextExpectedChunkIndex: number;
    bytesWritten: number;
    committed?: boolean;
    localFilePath?: string;
    fileSize?: number;
    commitError?: string;
    error?: string;
  }>;
  commitDownloadChunked(options: {
    trackId: string;
    metadata?: any;
  }): Promise<{
    success: boolean;
    trackId: string;
    localFilePath?: string;
    fileSize?: number;
    error?: string;
  }>;
  abortDownloadChunked(options: { trackId: string }): Promise<{
    success: boolean;
    trackId: string;
    error?: string;
  }>;
  getNativeDownloadedTrackIds(): Promise<{ success: boolean; trackIds: string[] }>;
  isTrackDownloadedNatively(options: { trackId: string }): Promise<{
    success: boolean;
    trackId: string;
    isDownloaded: boolean;
  }>;
  removeNativeDownload(options: { trackId: string }): Promise<{
    success: boolean;
    trackId: string;
    error?: string;
  }>;
  getNativeDownloadedTracks(): Promise<{
    success: boolean;
    tracks: any[];
  }>;
  getNativeDownloadStatus(options: { trackId: string }): Promise<{
    success: boolean;
    trackId: string;
    status: 'downloaded' | 'downloading' | 'not_downloaded';
    isVerified: boolean;
    expectedChunkIndex: number;
    fileSize?: number;
    localFilePath?: string;
    error?: string;
  }>;
  addListener(eventName: 'trackChanged', listenerFunc: (data: any) => void): Promise<any>;
  addListener(eventName: 'playbackEnded', listenerFunc: () => void): Promise<any>;
  addListener(eventName: 'playbackStateChanged', listenerFunc: (data: { state: string }) => void): Promise<any>;
}

const NativePlugin = registerPlugin<NativePlaybackBridgePluginInterface>('NativePlaybackBridge');

class NativePlaybackBridge {
  private requestGeneration = 0;
  private isActivated = false;

  public isAvailable(): boolean {
    return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('NativePlaybackBridge');
  }

  public isNativeModeActive(): boolean {
    return this.isActivated;
  }

  private async executeWithTimeout<T>(operation: () => Promise<T>, timeoutMs = 5000): Promise<T> {
    let timer: any;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Native bridge operation timed out after ${timeoutMs}ms`)), timeoutMs);
    });

    try {
      const result = await Promise.race([operation(), timeoutPromise]);
      return result;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  public async activateNativeMode(): Promise<boolean> {
    if (!this.isAvailable()) return false;
    try {
      const res = await this.executeWithTimeout(() => NativePlugin.activateNativeMode());
      this.isActivated = res.success && res.nativeModeActive;
      return this.isActivated;
    } catch (err) {
      console.warn('[NativePlaybackBridge] activateNativeMode failed:', err);
      this.isActivated = false;
      return false;
    }
  }

  public async deactivateNativeMode(): Promise<boolean> {
    if (!this.isAvailable()) {
      this.isActivated = false;
      return true;
    }
    try {
      const res = await this.executeWithTimeout(() => NativePlugin.deactivateNativeMode());
      this.isActivated = false;
      return res.success;
    } catch (err) {
      console.warn('[NativePlaybackBridge] deactivateNativeMode failed:', err);
      this.isActivated = false;
      return false;
    }
  }

  public async playTrack(
    payload: NativeTrackPayload,
    options?: {
      queue?: NativeTrackPayload[];
      startIndex?: number;
      repeatMode?: 'off' | 'all' | 'one';
      shuffleEnabled?: boolean;
    }
  ): Promise<boolean> {
    if (!this.isAvailable()) return false;
    const currentGen = ++this.requestGeneration;

    const nativeRepeat = options?.repeatMode === 'all' ? 'ALL' : options?.repeatMode === 'one' ? 'ONE' : options?.repeatMode ? 'OFF' : undefined;

    try {
      const res = await this.executeWithTimeout(() => NativePlugin.playTrack({
        ...payload,
        queue: options?.queue,
        startIndex: options?.startIndex,
        repeatMode: nativeRepeat,
        shuffleEnabled: options?.shuffleEnabled,
      }), 6000);
      if (currentGen !== this.requestGeneration) return false;
      this.isActivated = true;
      return res.success;
    } catch (err) {
      console.error('[NativePlaybackBridge] playTrack failed:', err);
      return false;
    }
  }

  public async togglePlay(): Promise<boolean> {
    if (!this.isAvailable()) return false;
    try {
      const res = await this.executeWithTimeout(() => NativePlugin.togglePlay());
      return res.success;
    } catch (err) {
      console.warn('[NativePlaybackBridge] togglePlay failed:', err);
      return false;
    }
  }

  public async pause(): Promise<boolean> {
    if (!this.isAvailable()) return false;
    try {
      const res = await this.executeWithTimeout(() => NativePlugin.pause());
      return res.success;
    } catch (err) {
      console.warn('[NativePlaybackBridge] pause failed:', err);
      return false;
    }
  }

  public async stop(): Promise<boolean> {
    this.requestGeneration++;
    if (!this.isAvailable()) return false;
    try {
      const res = await this.executeWithTimeout(() => NativePlugin.stop());
      return res.success;
    } catch (err) {
      console.warn('[NativePlaybackBridge] stop failed:', err);
      return false;
    }
  }

  public async resume(): Promise<boolean> {
    if (!this.isAvailable()) return false;
    try {
      const res = await this.executeWithTimeout(() => NativePlugin.resume());
      return res.success;
    } catch (err) {
      console.warn('[NativePlaybackBridge] resume failed:', err);
      return false;
    }
  }

  public async seekTo(positionMs: number): Promise<boolean> {
    if (!this.isAvailable()) return false;
    try {
      const res = await this.executeWithTimeout(() => NativePlugin.seekTo({ positionMs }));
      return res.success;
    } catch (err) {
      console.warn('[NativePlaybackBridge] seekTo failed:', err);
      return false;
    }
  }

  public async reloadCurrentTrackSource(options: {
    audioUrl: string;
    initialPositionMs: number;
    playWhenReady: boolean;
  }): Promise<boolean> {
    if (!this.isAvailable()) return false;
    try {
      const res = await this.executeWithTimeout(() => NativePlugin.reloadCurrentTrackSource(options));
      return Boolean(res?.success);
    } catch (err) {
      console.warn('[NativePlaybackBridge] reloadCurrentTrackSource failed:', err);
      return false;
    }
  }

  public async skipToNext(): Promise<boolean> {
    if (!this.isAvailable()) return false;
    try {
      const res = await this.executeWithTimeout(() => NativePlugin.skipToNext());
      return Boolean(res && res.success && (res as any).skipped !== false);
    } catch (err) {
      console.warn('[NativePlaybackBridge] skipToNext failed:', err);
      return false;
    }
  }

  public async skipToPrevious(): Promise<boolean> {
    if (!this.isAvailable()) return false;
    try {
      const res = await this.executeWithTimeout(() => NativePlugin.skipToPrevious());
      return Boolean(res && res.success && (res as any).skipped !== false);
    } catch (err) {
      console.warn('[NativePlaybackBridge] skipToPrevious failed:', err);
      return false;
    }
  }

  public async setQueue(tracks: NativeTrackPayload[], startIndex = 0): Promise<boolean> {
    if (!this.isAvailable()) return false;
    try {
      const res = await this.executeWithTimeout(() => NativePlugin.setQueue({ tracks, startIndex }));
      return res.success;
    } catch (err) {
      console.warn('[NativePlaybackBridge] setQueue failed:', err);
      return false;
    }
  }

  public async updateQueue(tracks: NativeTrackPayload[], newIndex?: number): Promise<boolean> {
    if (!this.isAvailable()) return false;
    try {
      const res = await this.executeWithTimeout(() => NativePlugin.updateQueue({ tracks, newIndex }));
      return res.success;
    } catch (err) {
      console.warn('[NativePlaybackBridge] updateQueue failed:', err);
      return false;
    }
  }

  public async addListener(eventName: string, listener: (data: any) => void): Promise<any> {
    if (!this.isAvailable()) return { remove: () => {} };
    try {
      return await (NativePlugin as any).addListener(eventName, listener);
    } catch (err) {
      console.warn(`[NativePlaybackBridge] addListener failed for ${eventName}:`, err);
      return { remove: () => {} };
    }
  }

  public async setRepeatMode(mode: 'off' | 'all' | 'one'): Promise<boolean> {
    if (!this.isAvailable()) return false;
    const nativeMode = mode === 'all' ? 'ALL' : mode === 'one' ? 'ONE' : 'OFF';
    try {
      const res = await this.executeWithTimeout(() => NativePlugin.setRepeatMode({ mode: nativeMode }));
      return res.success;
    } catch (err) {
      console.warn('[NativePlaybackBridge] setRepeatMode failed:', err);
      return false;
    }
  }

  public async setShuffleMode(enabled: boolean): Promise<boolean> {
    if (!this.isAvailable()) return false;
    try {
      const res = await this.executeWithTimeout(() => NativePlugin.setShuffleMode({ enabled }));
      return res.success;
    } catch (err) {
      console.warn('[NativePlaybackBridge] setShuffleMode failed:', err);
      return false;
    }
  }

  public async getPlaybackState(): Promise<NativePlayerState | null> {
    if (!this.isAvailable()) return null;
    try {
      return await this.executeWithTimeout(() => NativePlugin.getPlaybackState(), 3000);
    } catch (err) {
      return null;
    }
  }

  public async beginDownloadChunked(options: {
    trackId: string;
    extension?: string;
    metadata?: any;
    skipIfDownloaded?: boolean;
  }): Promise<{
    success: boolean;
    trackId: string;
    nextExpectedChunkIndex: number;
    alreadyDownloaded?: boolean;
    error?: string;
  }> {
    if (!this.isAvailable()) {
      return {
        success: false,
        trackId: options.trackId,
        nextExpectedChunkIndex: 0,
        error: 'Native playback bridge not available',
      };
    }
    try {
      return await this.executeWithTimeout(() => NativePlugin.beginDownloadChunked(options), 8000);
    } catch (err: any) {
      return {
        success: false,
        trackId: options.trackId,
        nextExpectedChunkIndex: 0,
        error: err?.message || 'beginDownloadChunked failed',
      };
    }
  }

  // Conceptual aliases for Phase 6 Step 2
  public async nativeDownloadBegin(options: {
    trackId: string;
    extension?: string;
    metadata?: any;
    skipIfDownloaded?: boolean;
  }) {
    return this.beginDownloadChunked(options);
  }

  public async nativeDownloadAppendChunk(options: {
    trackId: string;
    chunkIndex: number;
    chunkData: string;
    extension?: string;
    isLast?: boolean;
    metadata?: any;
  }) {
    return this.writeDownloadChunk(options);
  }

  public async nativeDownloadCommit(options: {
    trackId: string;
    metadata?: any;
  }) {
    return this.commitDownloadChunked(options);
  }

  public async nativeDownloadAbort(trackId: string) {
    return this.abortDownloadChunked(trackId);
  }

  public async writeDownloadChunk(options: {
    trackId: string;
    chunkIndex: number;
    chunkData: string;
    extension?: string;
    isLast?: boolean;
    metadata?: any;
  }): Promise<{
    success: boolean;
    trackId: string;
    acceptedChunkIndex: number;
    nextExpectedChunkIndex: number;
    bytesWritten: number;
    committed?: boolean;
    localFilePath?: string;
    fileSize?: number;
    commitError?: string;
    error?: string;
  }> {
    if (!this.isAvailable()) {
      return {
        success: false,
        trackId: options.trackId,
        acceptedChunkIndex: -1,
        nextExpectedChunkIndex: 0,
        bytesWritten: 0,
        error: 'Native playback bridge not available',
      };
    }
    try {
      return await this.executeWithTimeout(() => NativePlugin.writeDownloadChunk(options), 10000);
    } catch (err: any) {
      return {
        success: false,
        trackId: options.trackId,
        acceptedChunkIndex: -1,
        nextExpectedChunkIndex: options.chunkIndex,
        bytesWritten: 0,
        error: err?.message || 'writeDownloadChunk failed',
      };
    }
  }

  public async commitDownloadChunked(options: {
    trackId: string;
    metadata?: any;
  }): Promise<{
    success: boolean;
    trackId: string;
    localFilePath?: string;
    fileSize?: number;
    error?: string;
  }> {
    if (!this.isAvailable()) {
      return { success: false, trackId: options.trackId, error: 'Native bridge not available' };
    }
    try {
      return await this.executeWithTimeout(() => NativePlugin.commitDownloadChunked(options), 15000);
    } catch (err: any) {
      return { success: false, trackId: options.trackId, error: err?.message || 'commitDownloadChunked failed' };
    }
  }

  public async abortDownloadChunked(trackId: string): Promise<{
    success: boolean;
    trackId: string;
    error?: string;
  }> {
    if (!this.isAvailable()) {
      return { success: false, trackId, error: 'Native bridge not available' };
    }
    try {
      return await this.executeWithTimeout(() => NativePlugin.abortDownloadChunked({ trackId }), 5000);
    } catch (err: any) {
      return { success: false, trackId, error: err?.message || 'abortDownloadChunked failed' };
    }
  }

  public async getNativeDownloadedTrackIds(): Promise<string[]> {
    if (!this.isAvailable()) return [];
    try {
      const res = await this.executeWithTimeout(() => NativePlugin.getNativeDownloadedTrackIds(), 5000);
      return res?.trackIds || [];
    } catch {
      return [];
    }
  }

  public async isTrackDownloadedNatively(trackId: string): Promise<boolean> {
    if (!this.isAvailable()) return false;
    try {
      const res = await this.executeWithTimeout(() => NativePlugin.isTrackDownloadedNatively({ trackId }), 5000);
      return Boolean(res?.isDownloaded);
    } catch {
      return false;
    }
  }

  public async removeNativeDownload(trackId: string): Promise<{
    success: boolean;
    trackId: string;
    error?: string;
  }> {
    if (!this.isAvailable()) {
      return { success: false, trackId, error: 'Native bridge not available' };
    }
    try {
      return await this.executeWithTimeout(() => NativePlugin.removeNativeDownload({ trackId }), 5000);
    } catch (err: any) {
      return { success: false, trackId, error: err?.message || 'removeNativeDownload failed' };
    }
  }

  public async getNativeDownloadedTracks(): Promise<any[]> {
    if (!this.isAvailable()) return [];
    try {
      const res = await this.executeWithTimeout(() => NativePlugin.getNativeDownloadedTracks(), 5000);
      return res?.tracks || [];
    } catch {
      return [];
    }
  }

  public async getNativeDownloadStatus(trackId: string): Promise<{
    success: boolean;
    trackId: string;
    status: 'downloaded' | 'downloading' | 'not_downloaded';
    isVerified: boolean;
    expectedChunkIndex: number;
    fileSize?: number;
    localFilePath?: string;
    error?: string;
  }> {
    if (!this.isAvailable()) {
      return {
        success: false,
        trackId,
        status: 'not_downloaded',
        isVerified: false,
        expectedChunkIndex: 0,
        error: 'Native bridge not available',
      };
    }
    try {
      return await this.executeWithTimeout(() => NativePlugin.getNativeDownloadStatus({ trackId }), 5000);
    } catch (err: any) {
      return {
        success: false,
        trackId,
        status: 'not_downloaded',
        isVerified: false,
        expectedChunkIndex: 0,
        error: err?.message || 'getNativeDownloadStatus failed',
      };
    }
  }
}

export const nativePlaybackBridge = new NativePlaybackBridge();

/**
 * Converts an ArrayBuffer to a Base64 string in slices to avoid stack overflow
 * and excessive memory allocation.
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  let binary = '';
  const sliceSize = 8192;
  for (let i = 0; i < len; i += sliceSize) {
    const slice = bytes.subarray(i, Math.min(i + sliceSize, len));
    binary += String.fromCharCode.apply(null, slice as unknown as number[]);
  }
  return btoa(binary);
}
