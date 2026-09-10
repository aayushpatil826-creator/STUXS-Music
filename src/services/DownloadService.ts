import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { Track } from '../types/music';
import { storageService, type StoredAudioRecord } from './StorageService';
import { providerRegistry } from '../providers/ProviderRegistry';
import { mapJioSaavnUrlToQuality } from '../utils/audioQuality';
import { nativePlaybackController } from './nativePlaybackController';
import { nativePlaybackBridge, arrayBufferToBase64 } from './nativePlaybackBridge';

export type DownloadStatus = 'not_downloaded' | 'downloading' | 'downloaded' | 'removing' | 'failed';

export interface DownloadProgress {
  trackId: string;
  status: DownloadStatus;
  percent: number;
  error?: string;
}

type ProgressListener = (progress: DownloadProgress) => void;

/**
 * Validates audio source to reject previews, SoundCloud, metadata-only, and invalid URLs.
 * Reuses the existing NativeSourceValidator rules.
 */
export function validateDownloadSource(track: Track, audioUrl?: string): { isValid: boolean; reason?: string } {
  // 1. Permanent block against SoundCloud
  if (track.provider?.toLowerCase() === 'soundcloud' || track.id.startsWith('soundcloud-')) {
    return { isValid: false, reason: 'SoundCloud provider is permanently removed' };
  }

  // 2. Audio URL check
  const url = audioUrl?.trim() || track.audioUrl?.trim();
  if (!url) {
    return { isValid: false, reason: 'Track has no playable audio URL (metadata-only)' };
  }

  // 3. Protocol validation
  if (
    !url.startsWith('http://') &&
    !url.startsWith('https://') &&
    !url.startsWith('file://') &&
    !url.startsWith('content://') &&
    !url.startsWith('blob:')
  ) {
    return { isValid: false, reason: `Unsupported URL scheme: ${url}` };
  }

  // 4. Explicit iTunes / Apple Preview rejection
  if (
    track.provider?.toLowerCase() === 'itunes' ||
    url.includes('audio-ssl.itunes.apple.com') ||
    url.includes('/preview.m4a') ||
    url.includes('/preview.mp3')
  ) {
    return { isValid: false, reason: 'Preview-only audio stream (~30s) cannot be played as full song' };
  }

  // 5. Explicit short preview term in URL or title with short duration safeguard
  const durationSec = track.duration || 0;
  const isExplicitPreview =
    url.toLowerCase().includes('preview') ||
    track.title.toLowerCase().includes('(preview)') ||
    track.title.toLowerCase().includes('[preview]');

  if (isExplicitPreview && durationSec > 0 && durationSec <= 35) {
    return { isValid: false, reason: `Explicit short preview sample (~${Math.round(durationSec)}s) rejected` };
  }

  return { isValid: true };
}

class DownloadService {
  private activeDownloads = new Map<string, DownloadProgress>();
  private activeDownloadPromises = new Map<string, Promise<void>>();
  private downloadedTracksMap = new Map<string, Track>();
  private blobUrlMap = new Map<string, string>(); // trackId -> objectUrl
  private listeners = new Set<ProgressListener>();
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;
  private cancelDownloadFlags = new Set<string>();

  constructor() {
    this.initPromise = this.init();
  }

  /**
   * Initializes and self-heals download records on app startup.
   * File state is the single source of truth.
   */
  public async init(): Promise<void> {
    try {
      const records = await storageService.getAllDownloadedTracks();
      console.log('[DOWNLOAD SERVICE] Initializing & validating offline records, count:', records.length);
      
      const verifiedMap = new Map<string, Track>();

      for (const rec of records) {
        // Validate real Blob existence & valid size (>10KB)
        if (!rec.blob || !(rec.blob instanceof Blob) || rec.blob.size < 10240) {
          console.warn('[DOWNLOAD SERVICE] Self-healing: removing corrupt or empty record:', rec.id, 'size:', rec.blob?.size);
          await storageService.deleteDownloadedTrack(rec.id).catch(() => {});
          continue;
        }

        // Revoke any previous URL if re-initializing
        if (this.blobUrlMap.has(rec.id)) {
          try {
            if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
              URL.revokeObjectURL(this.blobUrlMap.get(rec.id)!);
            }
          } catch {}
        }

        const objectUrl = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(rec.blob) : `blob:${rec.id}`;
        this.blobUrlMap.set(rec.id, objectUrl);

        const verifiedTrack: Track = {
          ...rec.track,
          audioUrl: objectUrl,
          isDownloaded: true,
          sourceType: 'downloaded',
          fileSize: rec.fileSize || rec.blob.size,
          isPlayable: true,
          accessStatus: 'playable',
          playbackType: 'full',
        };

        verifiedMap.set(rec.id, verifiedTrack);
      }

      // Sync native offline records if native is available
      if (nativePlaybackBridge.isAvailable()) {
        try {
          const nativeTracks = await nativePlaybackBridge.getNativeDownloadedTracks();
          for (const nt of nativeTracks) {
            if (!nt || !nt.id || !nt.localFilePath) continue;
            // Native download ALWAYS takes precedence over IndexedDB blob for offline playback
            const verifiedTrack: Track = {
              id: nt.id,
              title: nt.title,
              artistName: nt.artist,
              artistId: nt.artistId || nt.artist || 'unknown',
              albumTitle: nt.album,
              artworkUrl: nt.artworkUrl,
              audioUrl: `file://${nt.localFilePath}`,
              localPath: nt.localFilePath,
              isDownloaded: true,
              sourceType: 'downloaded',
              fileSize: nt.fileSize,
              duration: Math.round((nt.durationMs || 0) / 1000),
              provider: nt.provider || 'unknown',
              isPlayable: true,
              accessStatus: 'playable',
              playbackType: 'full',
            };
            verifiedMap.set(nt.id, verifiedTrack);
          }
        } catch (err) {
          console.warn('[DOWNLOAD SERVICE] Failed to sync native downloaded tracks on init:', err);
        }
      }

      this.downloadedTracksMap = verifiedMap;
      this.isInitialized = true;
      console.log('[DOWNLOAD SERVICE] Successfully initialized verified offline downloads:', this.downloadedTracksMap.size);
      this.notifyAll();
    } catch (err) {
      console.warn('[DOWNLOAD SERVICE] Failed to initialize offline tracks:', err);
      this.isInitialized = true;
    }
  }

  public async ensureInitialized(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initPromise) await this.initPromise;
  }

  /**
   * Central Download Status Resolver
   * Single source of truth: verifies in-memory map + native record + database record + actual Blob existence.
   */
  public async getActualDownloadStatus(trackId: string): Promise<DownloadStatus> {
    await this.ensureInitialized();

    const active = this.activeDownloads.get(trackId);
    if (active && (active.status === 'downloading' || active.status === 'removing')) {
      return active.status;
    }

    // 1. Check native storage
    if (nativePlaybackBridge.isAvailable()) {
      try {
        const isNative = await nativePlaybackBridge.isTrackDownloadedNatively(trackId);
        if (isNative) {
          return 'downloaded';
        }
      } catch {}
    }

    // 2. Check IndexedDB
    try {
      const record = await storageService.getDownloadedTrack(trackId);
      if (!record) {
        this.cleanupMemoryTrack(trackId);
        return 'not_downloaded';
      }

      if (!record.blob || !(record.blob instanceof Blob) || record.blob.size < 10240) {
        console.warn('[DOWNLOAD SERVICE] Record missing valid audio file. Cleaning up:', trackId);
        await storageService.deleteDownloadedTrack(trackId).catch(() => {});
        this.cleanupMemoryTrack(trackId);
        return 'not_downloaded';
      }

      // Ensure track exists in memory map
      if (!this.downloadedTracksMap.has(trackId)) {
        const objectUrl = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(record.blob) : `blob:${trackId}`;
        this.blobUrlMap.set(trackId, objectUrl);
        this.downloadedTracksMap.set(trackId, {
          ...record.track,
          audioUrl: objectUrl,
          isDownloaded: true,
          sourceType: 'downloaded',
          fileSize: record.fileSize || record.blob.size,
          isPlayable: true,
          accessStatus: 'playable',
          playbackType: 'full',
        });
      }

      return 'downloaded';
    } catch (err) {
      console.warn('[DOWNLOAD SERVICE] Error resolving download status:', err);
      return this.downloadedTracksMap.has(trackId) ? 'downloaded' : 'not_downloaded';
    }
  }

  public async getNativeDownloadStatus(trackId: string) {
    if (nativePlaybackBridge.isAvailable()) {
      return await nativePlaybackBridge.getNativeDownloadStatus(trackId);
    }
    return null;
  }


  public subscribe(listener: ProgressListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(progress: DownloadProgress): void {
    this.activeDownloads.set(progress.trackId, progress);
    for (const listener of this.listeners) {
      try {
        listener(progress);
      } catch {}
    }
  }

  private notifyAll(): void {
    for (const [trackId] of this.downloadedTracksMap) {
      this.notify({
        trackId,
        status: 'downloaded',
        percent: 100,
      });
    }
  }

  public getStatus(trackId: string): DownloadStatus {
    const active = this.activeDownloads.get(trackId);
    if (active) return active.status;
    return this.downloadedTracksMap.has(trackId) ? 'downloaded' : 'not_downloaded';
  }

  public getProgress(trackId: string): number {
    const active = this.activeDownloads.get(trackId);
    return active ? active.percent : (this.downloadedTracksMap.has(trackId) ? 100 : 0);
  }

  public isTrackDownloaded(trackId: string): boolean {
    return this.downloadedTracksMap.has(trackId);
  }

  public getDownloadedTracks(): Track[] {
    return Array.from(this.downloadedTracksMap.values());
  }

  public getPlayableTrack(trackId: string): Track | undefined {
    return this.downloadedTracksMap.get(trackId);
  }

  /**
   * Guaranteed offline resolver: Checks in-memory cache, ensures DB is initialized,
   * and falls back directly to IndexedDB query if needed.
   */
  public async resolvePlayableDownloadedTrack(trackId: string): Promise<Track | undefined> {
    await this.ensureInitialized();
    // 1. If native playback bridge is available, prioritize verified native file storage
    if (nativePlaybackBridge.isAvailable()) {
      try {
        const isNative = await nativePlaybackBridge.isTrackDownloadedNatively(trackId);
        if (isNative) {
          const nativeTracks = await nativePlaybackBridge.getNativeDownloadedTracks();
          const nt = nativeTracks.find((t: any) => t.id === trackId);
          if (nt && nt.localFilePath) {
            const verifiedTrack: Track = {
              id: nt.id,
              title: nt.title,
              artistName: nt.artist,
              artistId: nt.artistId || nt.artist || 'unknown',
              albumTitle: nt.album,
              artworkUrl: nt.artworkUrl,
              audioUrl: `file://${nt.localFilePath}`,
              localPath: nt.localFilePath,
              isDownloaded: true,
              sourceType: 'downloaded',
              fileSize: nt.fileSize,
              duration: Math.round((nt.durationMs || 0) / 1000),
              provider: nt.provider || 'unknown',
              isPlayable: true,
              accessStatus: 'playable',
              playbackType: 'full',
            };
            this.downloadedTracksMap.set(trackId, verifiedTrack);
            return verifiedTrack;
          }
        }
      } catch (err) {
        console.warn('[DOWNLOAD SERVICE] Error resolving native offline track:', err);
      }
    }

    // 2. Check in-memory cached track
    const cached = this.downloadedTracksMap.get(trackId);
    if (cached && cached.audioUrl) return cached;

    // 3. Fallback: Check persistent IndexedDB storage
    try {
      const record = await storageService.getDownloadedTrack(trackId);
      if (record && record.blob && record.blob.size >= 10240) {
        let objectUrl = this.blobUrlMap.get(trackId);
        if (!objectUrl) {
          objectUrl = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(record.blob) : `blob:${trackId}`;
          this.blobUrlMap.set(trackId, objectUrl);
        }
        const verifiedTrack: Track = {
          ...record.track,
          audioUrl: objectUrl,
          isDownloaded: true,
          sourceType: 'downloaded',
          fileSize: record.fileSize || record.blob.size,
          isPlayable: true,
          accessStatus: 'playable',
          playbackType: 'full',
        };
        this.downloadedTracksMap.set(trackId, verifiedTrack);
        return verifiedTrack;
      }
    } catch (err) {
      console.warn('[DOWNLOAD SERVICE] Error resolving offline track from storage:', err);
    }

    return undefined;
  }

  /**
   * Registers a newly migrated native track into the in-memory cache and notifies UI listeners.
   */
  public registerMigratedNativeTrack(track: Track): void {
    if (!track || !track.id) return;
    this.downloadedTracksMap.set(track.id, track);
    this.notify({
      trackId: track.id,
      status: 'downloaded',
      percent: 100,
    });
  }

  /**
   * Background verification & self-healing for Downloads Screen.
   */
  public async refreshAndSelfHeal(): Promise<Track[]> {
    await this.init();
    return this.getDownloadedTracks();
  }

  /**
   * Cooperatively cancels an active download.
   */
  public cancelDownload(trackId: string): void {
    this.cancelDownloadFlags.add(trackId);
    console.log('[DOWNLOAD SERVICE] Cancelled download for trackId:', trackId);
  }

  /**
   * Downloads an audio stream with full resolution, real progress, and persistent storage.
   * Uses native storage when native playback is enabled and bridge is available;
   * otherwise falls back to persistent IndexedDB storage.
   */
  public async downloadTrack(track: Track): Promise<void> {
    const existingPromise = this.activeDownloadPromises.get(track.id);
    if (existingPromise) {
      console.log('[DOWNLOAD] Track is already downloading (reusing active promise):', track.id);
      return existingPromise;
    }

    const promise = this.executeDownloadTrack(track);
    this.activeDownloadPromises.set(track.id, promise);
    try {
      await promise;
    } finally {
      this.activeDownloadPromises.delete(track.id);
    }
  }

  private async executeDownloadTrack(track: Track): Promise<void> {
    const active = this.activeDownloads.get(track.id);
    if (active && active.status === 'downloading') {
      console.log('[DOWNLOAD] Track is already downloading:', track.id);
      return;
    }

    if (this.isTrackDownloaded(track.id)) {
      console.log('[DOWNLOAD] Track is already downloaded:', track.id);
      return;
    }

    if (nativePlaybackBridge.isAvailable()) {
      try {
        const isAlreadyNative = await nativePlaybackBridge.isTrackDownloadedNatively(track.id);
        if (isAlreadyNative) {
          console.log('[DOWNLOAD] Track already verified natively:', track.id);
          this.downloadedTracksMap.set(track.id, {
            ...track,
            isDownloaded: true,
            sourceType: 'downloaded',
            isPlayable: true,
            accessStatus: 'playable',
            playbackType: 'full',
          });
          this.notify({
            trackId: track.id,
            status: 'downloaded',
            percent: 100,
          });
          return;
        }
      } catch {}
    }

    this.notify({
      trackId: track.id,
      status: 'downloading',
      percent: 5,
    });

    console.log('[DOWNLOAD] Starting download pipeline for:', {
      trackId: track.id,
      title: track.title,
      artist: track.artistName,
    });

    try {
      // Check if this is an already imported local file in storage
      if (track.id.startsWith('local_') || (track.sourceType === 'local' && !track.audioUrl?.startsWith('http'))) {
        const localRec = await storageService.getLocalTrack(track.id);
        if (localRec && localRec.blob && localRec.blob.size >= 10240) {
          const objectUrl = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(localRec.blob) : `blob:${track.id}`;
          this.blobUrlMap.set(track.id, objectUrl);

          const downloadedTrack: Track = {
            ...track,
            audioUrl: objectUrl,
            isDownloaded: true,
            sourceType: 'downloaded',
            fileSize: localRec.blob.size,
            playbackType: 'full',
            isPlayable: true,
            accessStatus: 'playable',
          };

          const record: StoredAudioRecord = {
            id: track.id,
            track: downloadedTrack,
            blob: localRec.blob,
            downloadedAt: Date.now(),
            fileSize: localRec.blob.size,
          };

          await storageService.saveDownloadedTrack(record);
          this.downloadedTracksMap.set(track.id, downloadedTrack);

          this.notify({
            trackId: track.id,
            status: 'downloaded',
            percent: 100,
          });
          return;
        }
      }

      // 1. Resolve playable stream if missing or unverified
      let resolvedTrack = track;
      if (!track.audioUrl || track.id.startsWith('itunes-') || track.accessStatus === 'blocked') {
        resolvedTrack = await providerRegistry.resolvePlayableTrack(track);
      }

      if (!resolvedTrack.audioUrl || resolvedTrack.isPlayable === false) {
        throw new Error(`Unable to find playable audio stream for "${track.title}"`);
      }

      // 2. Resolve highest available quality for offline download
      let sourceUrl = resolvedTrack.audioUrl;
      if (sourceUrl.includes('.mp4') || sourceUrl.includes('jiosaavn') || sourceUrl.includes('saavn')) {
        const mapped = mapJioSaavnUrlToQuality(sourceUrl, 'very_high');
        sourceUrl = mapped.newUrl;
      }

      // Only upgrade JioSaavn CDNs where HTTPS is verified. Never force HTTPS on arbitrary HTTP streams.
      if (sourceUrl.startsWith('http://') && (sourceUrl.includes('saavncdn.com') || sourceUrl.includes('jiosaavn.com'))) {
        sourceUrl = sourceUrl.replace('http://', 'https://');
      }

      // 3. Source validation (reusing NativeSourceValidator rules)
      const validation = validateDownloadSource(resolvedTrack, sourceUrl);
      if (!validation.isValid) {
        throw new Error(`Source validation failed: ${validation.reason}`);
      }

      // 4. Native-first when enabled & available
      const useNative = nativePlaybackController.isEnabled() && nativePlaybackBridge.isAvailable();
      if (useNative) {
        await this.downloadTrackNative(track, resolvedTrack, sourceUrl);
      } else {
        await this.downloadTrackIndexedDB(track, resolvedTrack, sourceUrl);
      }
    } catch (err: any) {
      console.error('[DOWNLOAD ERROR]', err);
      this.cleanupMemoryTrack(track.id);
      this.notify({
        trackId: track.id,
        status: 'failed',
        percent: 0,
        error: err.message || 'Download failed',
      });
      throw err;
    }
  }

  /**
   * Native chunked download path: streams bounded <=256KB chunks directly to native storage.
   */
  private async downloadTrackNative(track: Track, resolvedTrack: Track, sourceUrl: string): Promise<void> {
    const ext = sourceUrl.includes('.m4a') || sourceUrl.includes('aac') ? 'm4a' : 'mp3';

    // CASE A: Attempt native initialization
    let beginResult;
    try {
      beginResult = await nativePlaybackBridge.beginDownloadChunked({
        trackId: track.id,
        extension: ext,
        skipIfDownloaded: true,
      });
    } catch (initErr) {
      console.warn('[DOWNLOAD] Native initialization threw error, falling back to IndexedDB:', initErr);
      return await this.downloadTrackIndexedDB(track, resolvedTrack, sourceUrl);
    }

    if (beginResult.alreadyDownloaded) {
      console.log('[DOWNLOAD] Track already downloaded natively (reported by bridge):', track.id);
      const downloadedTrack: Track = {
        ...resolvedTrack,
        isDownloaded: true,
        sourceType: 'downloaded',
        isPlayable: true,
        accessStatus: 'playable',
        playbackType: 'full',
      };
      this.downloadedTracksMap.set(track.id, downloadedTrack);
      this.notify({
        trackId: track.id,
        status: 'downloaded',
        percent: 100,
      });
      return;
    }

    if (!beginResult.success) {
      console.warn('[DOWNLOAD] Native initialization failed:', beginResult.error, 'falling back to IndexedDB');
      return await this.downloadTrackIndexedDB(track, resolvedTrack, sourceUrl);
    }

    // CASE B: Native staging is now active! Any failure from here must ABORT native staging and NOT fall back to IndexedDB.
    try {
      console.log('[DOWNLOAD] Native streaming from:', sourceUrl);
      const response = await fetch(sourceUrl);
      if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status} when downloading audio`);
      }

      const contentType = response.headers.get('content-type') || (ext === 'm4a' ? 'audio/mp4' : 'audio/mpeg');
      const contentLength = response.headers.get('content-length');
      const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Response body has no readable stream reader');
      }

      const MAX_CHUNK = 256 * 1024; // 256 KB strictly enforced
      let chunkIndex = 0;
      let receivedBytes = 0;
      let buffer: Uint8Array = new Uint8Array(0);

      const appendToBuffer = (existing: Uint8Array, incoming: Uint8Array): Uint8Array => {
        const next = new Uint8Array(existing.length + incoming.length);
        next.set(existing, 0);
        next.set(incoming, existing.length);
        return next;
      };

      while (true) {
        if (this.cancelDownloadFlags.has(track.id)) {
          throw new Error('Download was cancelled');
        }

        const { done, value } = await reader.read();
        if (done) break;

        if (value && value.length > 0) {
          receivedBytes += value.length;
          buffer = appendToBuffer(buffer, value);

          // Drain all full 256 KB chunks from the buffer
          while (buffer.length >= MAX_CHUNK) {
            if (this.cancelDownloadFlags.has(track.id)) {
              throw new Error('Download was cancelled');
            }

            const chunkSlice = buffer.slice(0, MAX_CHUNK);
            buffer = buffer.slice(MAX_CHUNK);

            const base64 = arrayBufferToBase64(chunkSlice.buffer as ArrayBuffer);

            const writeRes = await nativePlaybackBridge.writeDownloadChunk({
              trackId: track.id,
              chunkIndex,
              chunkData: base64,
              extension: ext,
            });

            if (!writeRes.success) {
              throw new Error(writeRes.error || `Failed to write chunk ${chunkIndex}`);
            }

            chunkIndex++;
            await new Promise((resolve) => setTimeout(resolve, 0));
          }

          if (totalBytes > 0) {
            const percent = Math.min(95, Math.max(5, Math.round((receivedBytes / totalBytes) * 100)));
            this.notify({
              trackId: track.id,
              status: 'downloading',
              percent,
            });
          }
        }
      }

      // Drain any remaining bytes in the buffer as the final chunk
      if (buffer.length > 0) {
        if (this.cancelDownloadFlags.has(track.id)) {
          throw new Error('Download was cancelled');
        }

        const base64 = arrayBufferToBase64(buffer.buffer as ArrayBuffer);

        const writeRes = await nativePlaybackBridge.writeDownloadChunk({
          trackId: track.id,
          chunkIndex,
          chunkData: base64,
          extension: ext,
        });

        if (!writeRes.success) {
          throw new Error(writeRes.error || `Failed to write final chunk ${chunkIndex}`);
        }

        chunkIndex++;
        buffer = new Uint8Array(0);
      }

      if (receivedBytes < 10240) {
        throw new Error(`Downloaded audio file is invalid or too small (${receivedBytes} bytes)`);
      }

      const metadata = {
        title: resolvedTrack.title || 'Unknown Title',
        artist: resolvedTrack.artistName || (resolvedTrack as any).artist || 'Unknown Artist',
        album: resolvedTrack.albumTitle || (resolvedTrack as any).album || null,
        artworkUrl: resolvedTrack.artworkUrl || null,
        mimeType: contentType,
        durationMs: Math.round((resolvedTrack.duration || 0) * 1000),
        provider: resolvedTrack.provider || 'unknown',
        downloadedAt: Date.now(),
      };

      const commitRes = await nativePlaybackBridge.commitDownloadChunked({
        trackId: track.id,
        metadata,
      });

      if (!commitRes.success) {
        throw new Error(commitRes.error || 'Failed to commit native download');
      }

      // Authoritative verification via native bridge
      const isVerified = await nativePlaybackBridge.isTrackDownloadedNatively(track.id);
      if (!isVerified) {
        throw new Error('Native download verification failed after commit');
      }

      const downloadedTrack: Track = {
        ...resolvedTrack,
        audioUrl: `file://${commitRes.localFilePath || ''}`,
        isDownloaded: true,
        sourceType: 'downloaded',
        fileSize: commitRes.fileSize || receivedBytes,
        playbackType: 'full',
        isPlayable: true,
        accessStatus: 'playable',
      };

      this.downloadedTracksMap.set(track.id, downloadedTrack);
      this.notify({
        trackId: track.id,
        status: 'downloaded',
        percent: 100,
      });

      console.log('[DOWNLOAD] Native download completed & verified for:', track.title);
    } catch (err: any) {
      console.error('[DOWNLOAD] Native download error after staging started. Aborting native transaction:', err);
      await nativePlaybackBridge.abortDownloadChunked(track.id).catch(() => {});
      throw err;
    } finally {
      this.cancelDownloadFlags.delete(track.id);
    }
  }

  /**
   * Existing IndexedDB download path: fetches audio and stores Blob in IndexedDB.
   */
  private async downloadTrackIndexedDB(track: Track, resolvedTrack: Track, sourceUrl: string): Promise<void> {
    console.log('[DOWNLOAD] Fetching audio bytes for IndexedDB from:', sourceUrl);

    let blob: Blob;
    try {
      const response = await fetch(sourceUrl);
      console.log('[DOWNLOAD] Response received HTTP', response.status);

      if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status} when downloading audio`);
      }

      const contentType = response.headers.get('content-type') || 'audio/mpeg';
      const contentLength = response.headers.get('content-length');
      const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

      const reader = response.body?.getReader();

      if (!reader) {
        blob = await response.blob();
      } else {
        let receivedBytes = 0;
        const chunks: Uint8Array[] = [];

        while (true) {
          if (this.cancelDownloadFlags.has(track.id)) {
            throw new Error('Download was cancelled');
          }

          const { done, value } = await reader.read();
          if (done) break;

          if (value) {
            chunks.push(value);
            receivedBytes += value.length;
            if (totalBytes > 0) {
              const percent = Math.min(95, Math.max(5, Math.round((receivedBytes / totalBytes) * 100)));
              this.notify({
                trackId: track.id,
                status: 'downloading',
                percent,
              });
            }
          }
        }
        blob = new Blob(chunks as BlobPart[], { type: contentType });
      }
    } catch (fetchErr: any) {
      if (this.cancelDownloadFlags.has(track.id)) {
        throw fetchErr;
      }
      // Native fallback: If running on Android Capacitor and fetch was blocked by CORS or network security
      if (Capacitor.isNativePlatform()) {
        console.log('[DOWNLOAD] Fetch failed, falling back to CapacitorHttp for:', sourceUrl);
        const capRes = await CapacitorHttp.get({
          url: sourceUrl,
          responseType: 'blob',
        });
        if (capRes.data) {
          if (capRes.data instanceof Blob) {
            blob = capRes.data;
          } else if (typeof capRes.data === 'string') {
            const binaryStr = atob(capRes.data);
            const len = binaryStr.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
              bytes[i] = binaryStr.charCodeAt(i);
            }
            blob = new Blob([bytes], { type: 'audio/mpeg' });
          } else {
            throw fetchErr;
          }
        } else {
          throw fetchErr;
        }
      } else {
        throw fetchErr;
      }
    } finally {
      this.cancelDownloadFlags.delete(track.id);
    }

    if (!blob || !(blob instanceof Blob) || blob.size < 10240) {
      throw new Error(`Downloaded audio file is invalid or too small (${blob?.size || 0} bytes)`);
    }

    // Save permanently in IndexedDB
    const objectUrl = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : `blob:${track.id}`;
    this.blobUrlMap.set(track.id, objectUrl);

    const downloadedTrack: Track = {
      ...resolvedTrack,
      audioUrl: objectUrl,
      isDownloaded: true,
      sourceType: 'downloaded',
      fileSize: blob.size,
      playbackType: 'full',
      isPlayable: true,
      accessStatus: 'playable',
    };

    const record: StoredAudioRecord = {
      id: track.id,
      track: downloadedTrack,
      blob,
      downloadedAt: Date.now(),
      fileSize: blob.size,
    };

    await storageService.saveDownloadedTrack(record);
    this.downloadedTracksMap.set(track.id, downloadedTrack);

    this.notify({
      trackId: track.id,
      status: 'downloaded',
      percent: 100,
    });

    console.log('[DOWNLOAD] IndexedDB download completed & verified for:', track.title);
  }

  /**
   * Atomic removal of a downloaded track across native storage and IndexedDB.
   */
  public async removeDownload(trackId: string): Promise<void> {
    console.log('[DOWNLOAD SERVICE] Removing download for trackId:', trackId);

    // 1. Optimistic UI update: Mark as removing
    this.notify({
      trackId,
      status: 'removing',
      percent: 0,
    });

    try {
      // 2. If native download exists, delete it natively
      if (nativePlaybackBridge.isAvailable()) {
        const isNative = await nativePlaybackBridge.isTrackDownloadedNatively(trackId);
        if (isNative) {
          const removeRes = await nativePlaybackBridge.removeNativeDownload(trackId);
          if (!removeRes.success) {
            throw new Error(`Failed to remove native download: ${removeRes.error || trackId}`);
          }
        }
      }

      // 3. Delete from persistent IndexedDB store
      await storageService.deleteDownloadedTrack(trackId);

      // Verify that the file is gone from storage
      const remaining = await storageService.getDownloadedTrack(trackId);
      if (remaining) {
        await storageService.deleteDownloadedTrack(trackId);
      }

      // 4. Clean up object URL and memory state
      this.cleanupMemoryTrack(trackId);

      // 5. Update status across all subscribers
      this.notify({
        trackId,
        status: 'not_downloaded',
        percent: 0,
      });

      console.log('[DOWNLOAD SERVICE] Download removed successfully for trackId:', trackId);
    } catch (err: any) {
      console.warn('[DOWNLOAD SERVICE] Error during download removal:', err);
      this.notify({
        trackId,
        status: 'failed',
        percent: 0,
        error: err?.message || 'Download removal failed',
      });
      throw err;
    }
  }

  private isPlaylistDownloadingMap = new Map<string, boolean>();
  private cancelPlaylistFlags = new Set<string>();
  private maxConcurrency = 3;

  public isPlaylistDownloading(playlistId: string): boolean {
    return this.isPlaylistDownloadingMap.get(playlistId) === true;
  }

  public cancelPlaylistDownload(playlistId?: string): void {
    if (playlistId) {
      this.cancelPlaylistFlags.add(playlistId);
      this.isPlaylistDownloadingMap.set(playlistId, false);
      console.log('[DOWNLOAD SERVICE] Cancelled playlist download for playlistId:', playlistId);
    } else {
      this.isPlaylistDownloadingMap.clear();
      this.cancelPlaylistFlags.clear();
      console.log('[DOWNLOAD SERVICE] Cancelled all playlist downloads');
    }
  }

  public async downloadPlaylist(
    tracks: Track[],
    playlistId?: string,
    onSummaryProgress?: (completed: number, total: number, failed: number) => void
  ): Promise<{ total: number; skipped: number; downloaded: number; failed: number }> {
    await this.ensureInitialized();
    const pid = playlistId || 'default_playlist';
    this.cancelPlaylistFlags.delete(pid);
    this.isPlaylistDownloadingMap.set(pid, true);

    const neededTracks = tracks.filter((t) => !this.isTrackDownloaded(t.id));
    const skipped = tracks.length - neededTracks.length;

    console.log('[DOWNLOAD SERVICE] Starting playlist download:', {
      playlistId: pid,
      totalTracks: tracks.length,
      alreadyDownloaded: skipped,
      toDownload: neededTracks.length,
    });

    if (neededTracks.length === 0) {
      this.isPlaylistDownloadingMap.set(pid, false);
      if (onSummaryProgress) onSummaryProgress(tracks.length, tracks.length, 0);
      return { total: tracks.length, skipped, downloaded: 0, failed: 0 };
    }

    let downloadedCount = 0;
    let failedCount = 0;
    let index = 0;

    const worker = async () => {
      while (index < neededTracks.length) {
        if (this.cancelPlaylistFlags.has(pid)) {
          console.log('[DOWNLOAD SERVICE] Playlist worker exiting due to cancellation:', pid);
          break;
        }
        const currentIdx = index++;
        const track = neededTracks[currentIdx];
        try {
          await this.downloadTrack(track);
          downloadedCount++;
        } catch (err) {
          console.warn('[DOWNLOAD PLAYLIST] Track download failed for:', track.title, err);
          failedCount++;
        }
        if (onSummaryProgress) {
          onSummaryProgress(skipped + downloadedCount + failedCount, tracks.length, failedCount);
        }
      }
    };

    const workers: Promise<void>[] = [];
    const concurrency = Math.min(this.maxConcurrency, neededTracks.length);
    for (let w = 0; w < concurrency; w++) {
      workers.push(worker());
    }

    await Promise.all(workers);
    this.isPlaylistDownloadingMap.set(pid, false);

    console.log('[DOWNLOAD SERVICE] Playlist download finished:', {
      playlistId: pid,
      total: tracks.length,
      skipped,
      downloaded: downloadedCount,
      failed: failedCount,
    });

    return {
      total: tracks.length,
      skipped,
      downloaded: downloadedCount,
      failed: failedCount,
    };
  }

  private cleanupMemoryTrack(trackId: string): void {
    if (this.blobUrlMap.has(trackId)) {
      try {
        if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
          URL.revokeObjectURL(this.blobUrlMap.get(trackId)!);
        }
      } catch {}
      this.blobUrlMap.delete(trackId);
    }
    this.downloadedTracksMap.delete(trackId);
    this.activeDownloads.delete(trackId);
  }
}

export const downloadService = new DownloadService();
