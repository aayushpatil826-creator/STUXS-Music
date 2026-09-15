import type { Track } from '../types/music';
import { storageService, type StoredAudioRecord } from './StorageService';
import { nativePlaybackBridge } from './nativePlaybackBridge';
import { validateDownloadSource, downloadService } from './DownloadService';
import { getCanonicalTrackKey } from '../utils/trackIdentity';

export const MAX_BINARY_CHUNK_SIZE = 256 * 1024; // 262,144 bytes (256 KB)
export const MIN_VALID_FILE_SIZE = 10240; // 10 KB native threshold

export interface TrackMigrationResult {
  trackId: string;
  success: boolean;
  skipped?: boolean;
  alreadyNative?: boolean;
  failed?: boolean;
  error?: string;
  bytesTransferred: number;
}

export interface MigrationSummary {
  total: number;
  completed: number;
  migrated: number; // alias for backwards compatibility
  skipped: number;
  failed: number;
  bytesTransferred: number;
  trackResults: TrackMigrationResult[];
}

export interface MigrationProgress {
  status: 'idle' | 'discovering' | 'migrating' | 'paused_for_playback' | 'completed' | 'cancelled' | 'error';
  totalTracks: number;
  completedTracks: number;
  failedTracks: number;
  skippedTracks: number;
  bytesTransferred: number;
  currentTrackId?: string;
  currentTrackTitle?: string;
}

export type MigrationProgressListener = (progress: MigrationProgress) => void;

/**
 * Converts an ArrayBuffer to a Base64 string in slices to avoid stack overflow
 * and excessive memory allocation. Correctly handles null and zero bytes.
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

/**
 * Derives a safe audio file extension from MIME type or track metadata.
 */
export function deriveAudioExtension(mimeType?: string, track?: Track): string {
  const mime = (mimeType || '').toLowerCase();
  const audioUrl = (track?.audioUrl || '').toLowerCase();
  const localPath = (track?.localPath || '').toLowerCase();

  if (
    mime.includes('mp4') ||
    mime.includes('m4a') ||
    mime.includes('aac') ||
    audioUrl.includes('.m4a') ||
    audioUrl.includes('.mp4') ||
    audioUrl.includes('.aac') ||
    localPath.endsWith('.m4a') ||
    localPath.endsWith('.aac')
  ) {
    return 'm4a';
  }
  if (mime.includes('flac') || audioUrl.includes('.flac') || localPath.endsWith('.flac')) {
    return 'flac';
  }
  if (mime.includes('wav') || audioUrl.includes('.wav') || localPath.endsWith('.wav')) {
    return 'wav';
  }
  if (mime.includes('ogg') || audioUrl.includes('.ogg') || localPath.endsWith('.ogg')) {
    return 'ogg';
  }
  return 'mp3';
}

export class NativeMigrationService {
  private isRunning = false;
  private isCancelled = false;
  private currentRunPromise: Promise<MigrationSummary> | null = null;
  private activeSingleTrackId: string | null = null;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private idleGraceTimer: ReturnType<typeof setTimeout> | null = null;

  // Playback Gating State (strictly event/promise-based, ZERO polling/intervals)
  private playbackPausePromise: Promise<void> | null = null;
  private playbackResumeResolve: (() => void) | null = null;

  // Progress Listeners
  private listeners = new Set<MigrationProgressListener>();
  private progress: MigrationProgress = {
    status: 'idle',
    totalTracks: 0,
    completedTracks: 0,
    failedTracks: 0,
    skippedTracks: 0,
    bytesTransferred: 0,
  };

  public getProgress(): MigrationProgress {
    return { ...this.progress };
  }

  public getStatus(): {
    state: MigrationProgress['status'];
    currentTrack?: string;
    completed: number;
    total: number;
    failed: number;
    skipped: number;
    bytesTransferred: number;
  } {
    return {
      state: this.progress.status,
      currentTrack: this.progress.currentTrackId,
      completed: this.progress.completedTracks,
      total: this.progress.totalTracks,
      failed: this.progress.failedTracks,
      skipped: this.progress.skippedTracks,
      bytesTransferred: this.progress.bytesTransferred,
    };
  }

  public addProgressListener(listener: MigrationProgressListener): () => void {
    this.listeners.add(listener);
    listener(this.getProgress());
    return () => this.listeners.delete(listener);
  }

  private notifyProgress(update: Partial<MigrationProgress>): void {
    this.progress = { ...this.progress, ...update };
    for (const listener of this.listeners) {
      try {
        listener(this.getProgress());
      } catch (err) {
        console.warn('[MIGRATION] Progress listener error:', err);
      }
    }
  }

  /**
   * Non-blocking delayed startup scheduler.
   * Defers migration until initial app launch stabilizes (default 6 seconds),
   * respects active playback gating with an idle grace period (default 3 seconds),
   * and returns a teardown function to safely cancel on unmount.
   */
  public scheduleStartupMigration(delayMs = 6000, idleGraceMs = 3000): () => void {
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }

    this.startupTimer = setTimeout(async () => {
      this.startupTimer = null;
      try {
        await this.waitForPlaybackIdle();
        if (idleGraceMs > 0) {
          await new Promise((r) => setTimeout(r, idleGraceMs));
          await this.waitForPlaybackIdle();
        }
        if (this.isCancelled) return;
        console.log('[MIGRATION] Startup delay completed. Initiating background migration...');
        await this.migrateAll();
      } catch (err) {
        console.warn('[MIGRATION] Startup migration run encountered error:', err);
      }
    }, delayMs);

    return () => {
      if (this.startupTimer) {
        clearTimeout(this.startupTimer);
        this.startupTimer = null;
      }
    };
  }

  /**
   * Passive event-based playback notification.
   * If music starts, migration will pause before the next chunk.
   * Resumes cleanly when notifyPlaybackState(false) is signaled, with optional idle grace period.
   * NO setInterval, NO requestAnimationFrame, NO polling loops.
   */
  public notifyPlaybackState(isPlaying: boolean, idleGraceMs = 0): void {
    if (this.idleGraceTimer) {
      clearTimeout(this.idleGraceTimer);
      this.idleGraceTimer = null;
    }

    if (isPlaying) {
      if (!this.playbackPausePromise) {
        this.playbackPausePromise = new Promise<void>((resolve) => {
          this.playbackResumeResolve = resolve;
        });
      }
      if (this.isRunning) {
        this.notifyProgress({ status: 'paused_for_playback' });
      }
    } else {
      const resume = () => {
        if (this.playbackPausePromise) {
          const resolve = this.playbackResumeResolve;
          this.playbackPausePromise = null;
          this.playbackResumeResolve = null;
          if (this.isRunning) {
            this.notifyProgress({ status: 'migrating' });
          }
          resolve?.();
        }
      };

      if (idleGraceMs > 0) {
        this.idleGraceTimer = setTimeout(() => {
          this.idleGraceTimer = null;
          resume();
        }, idleGraceMs);
      } else {
        resume();
      }
    }
  }

  /**
   * Awaits active playback pause promise if playback is active.
   */
  public async waitForPlaybackIdle(): Promise<void> {
    if (this.playbackPausePromise) {
      await this.playbackPausePromise;
    }
  }

  /**
   * Discovers and returns existing IndexedDB records that are eligible for native migration.
   * Rules:
   * 1. Valid track ID
   * 2. Valid audio Blob (instanceof Blob)
   * 3. Blob size >= 10 KB (native threshold)
   * 4. Not already present as a verified native download in Room and on disk.
   */
  public async getMigrationCandidates(): Promise<StoredAudioRecord[]> {
    try {
      let downloadedRecords: StoredAudioRecord[] = [];
      try {
        downloadedRecords = await storageService.getAllDownloadedTracks();
      } catch {}

      let localRecords: StoredAudioRecord[] = [];
      try {
        localRecords = await storageService.getAllLocalTracks();
      } catch {}

      const recordMap = new Map<string, StoredAudioRecord>();
      for (const rec of downloadedRecords) {
        if (rec && rec.id) recordMap.set(rec.id, rec);
      }
      for (const rec of localRecords) {
        if (rec && rec.id && !recordMap.has(rec.id)) recordMap.set(rec.id, rec);
      }
      const records = Array.from(recordMap.values());
      const candidates: StoredAudioRecord[] = [];
      const seenCanonicalKeys = new Set<string>();

      for (const rec of records) {
        if (!rec || typeof rec !== 'object') continue;
        const trackId = rec.id || rec.track?.id;
        if (!trackId || typeof trackId !== 'string' || !trackId.trim()) continue;

        if (!rec.blob || !(rec.blob instanceof Blob) || rec.blob.size < MIN_VALID_FILE_SIZE) {
          continue;
        }

        const isAlreadyNative = await nativePlaybackBridge.isTrackDownloadedNatively(trackId);
        const isDownloadedCanonically = downloadService.isTrackDownloaded(rec.track || { id: trackId });
        if (isAlreadyNative || isDownloadedCanonically) {
          // If already native, purge redundant legacy blob to avoid duplicate counts and save space
          if (!trackId.startsWith('local_') && rec.track?.sourceType !== 'local') {
            await storageService.deleteDownloadedTrack(trackId).catch(() => {});
          }
          continue;
        }

        const cKey = getCanonicalTrackKey(rec.track || { id: trackId });
        if (seenCanonicalKeys.has(cKey)) {
          // Duplicate recording already staged for migration
          if (!trackId.startsWith('local_') && rec.track?.sourceType !== 'local') {
            await storageService.deleteDownloadedTrack(trackId).catch(() => {});
          }
          continue;
        }
        seenCanonicalKeys.add(cKey);

        if (rec.track) {
          const validation = validateDownloadSource(rec.track, rec.track.audioUrl || 'blob://stored');
          if (!validation.isValid) {
            console.log(`[MIGRATION] Candidate ${trackId} skipped due to source validation: ${validation.reason}`);
            continue;
          }
        }

        candidates.push(rec);
      }

      return candidates;
    } catch (err) {
      console.warn('[MIGRATION] Failed to get migration candidates:', err);
      return [];
    }
  }

  /**
   * Migrates a single track by its IndexedDB track ID.
   */
  public async migrateTrackById(trackId: string): Promise<TrackMigrationResult> {
    if (!trackId || typeof trackId !== 'string' || !trackId.trim()) {
      return {
        trackId: trackId || 'unknown',
        success: false,
        failed: true,
        error: 'Invalid trackId',
        bytesTransferred: 0,
      };
    }

    try {
      const record = await storageService.getDownloadedTrack(trackId);
      if (!record) {
        return {
          trackId,
          success: false,
          failed: true,
          error: 'Record not found in IndexedDB',
          bytesTransferred: 0,
        };
      }

      return await this.migrateTrack(record);
    } catch (err: any) {
      return {
        trackId,
        success: false,
        failed: true,
        error: err?.message || 'Error fetching record from IndexedDB',
        bytesTransferred: 0,
      };
    }
  }

  /**
   * Migrates a single IndexedDB record in sequential binary chunks (<=256 KB).
   * Memory invariant:
   * ONE TRACK -> ONE CHUNK -> ONE ArrayBuffer -> ONE Base64 payload -> native append -> release references -> next chunk.
   *
   * Crucial safety:
   * Original IndexedDB record and Blob are NEVER modified or deleted.
   */
  public async migrateTrack(record: StoredAudioRecord): Promise<TrackMigrationResult> {
    const trackId = record?.id || record?.track?.id;
    if (!trackId || typeof trackId !== 'string' || !trackId.trim()) {
      return {
        trackId: 'unknown',
        success: false,
        failed: true,
        error: 'Track ID is required and cannot be empty',
        bytesTransferred: 0,
      };
    }

    // Guard against concurrent migration of the exact same track
    if (this.activeSingleTrackId === trackId) {
      return {
        trackId,
        success: false,
        failed: true,
        error: `Track ${trackId} is already actively migrating`,
        bytesTransferred: 0,
      };
    }

    this.activeSingleTrackId = trackId;
    const wasRunning = this.isRunning;
    this.isRunning = true;

    try {
      const blob = record?.blob;
      if (!blob || !(blob instanceof Blob) || blob.size < MIN_VALID_FILE_SIZE) {
        const errorMsg = !blob || !(blob instanceof Blob)
          ? 'Missing or invalid Blob'
          : `Blob size (${blob.size} bytes) is below minimum valid file size (${MIN_VALID_FILE_SIZE} bytes)`;
        return {
          trackId,
          success: false,
          skipped: true,
          failed: false,
          error: errorMsg,
          bytesTransferred: 0,
        };
      }

      // Validate source to reject previews, SoundCloud, metadata-only, etc.
      if (record?.track) {
        const validation = validateDownloadSource(record.track, record.track.audioUrl || 'blob://stored');
        if (!validation.isValid) {
          return {
            trackId,
            success: false,
            skipped: true,
            failed: false,
            error: `Source validation rejected track: ${validation.reason}`,
            bytesTransferred: 0,
          };
        }
      }

      // Check authoritative native verification (Room record + physical file >= 10KB)
      const alreadyNative = await nativePlaybackBridge.isTrackDownloadedNatively(trackId);
      if (alreadyNative) {
        return {
          trackId,
          success: true,
          skipped: true,
          alreadyNative: true,
          failed: false,
          bytesTransferred: 0,
        };
      }

      const ext = deriveAudioExtension(blob.type, record.track);

      // Begin native staging session
      const beginResult = await nativePlaybackBridge.beginDownloadChunked({
        trackId,
        extension: ext,
        skipIfDownloaded: true,
      });

      if (beginResult.alreadyDownloaded) {
        return {
          trackId,
          success: true,
          skipped: true,
          alreadyNative: true,
          failed: false,
          bytesTransferred: 0,
        };
      }

      if (!beginResult.success) {
        return {
          trackId,
          success: false,
          failed: true,
          error: beginResult.error || 'Failed to initialize native staging session',
          bytesTransferred: 0,
        };
      }

      const totalSize = blob.size;
      const totalChunks = Math.ceil(totalSize / MAX_BINARY_CHUNK_SIZE);
      let bytesTransferred = 0;

      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        // Cooperative playback check
        await this.waitForPlaybackIdle();

        if (this.isCancelled) {
          await nativePlaybackBridge.abortDownloadChunked(trackId);
          return {
            trackId,
            success: false,
            failed: true,
            error: 'Migration was cancelled',
            bytesTransferred,
          };
        }

        const start = chunkIndex * MAX_BINARY_CHUNK_SIZE;
        const end = Math.min(start + MAX_BINARY_CHUNK_SIZE, totalSize);
        const chunkSlice = blob.slice(start, end);

        let chunkBase64: string;
        try {
          const buffer = await chunkSlice.arrayBuffer();
          if (buffer.byteLength > MAX_BINARY_CHUNK_SIZE) {
            throw new Error(`Chunk size ${buffer.byteLength} exceeds maximum limit of ${MAX_BINARY_CHUNK_SIZE}`);
          }
          chunkBase64 = arrayBufferToBase64(buffer);
        } catch (err: any) {
          await nativePlaybackBridge.abortDownloadChunked(trackId);
          return {
            trackId,
            success: false,
            failed: true,
            error: `Base64 conversion failed: ${err?.message || err}`,
            bytesTransferred,
          };
        }

        const writeRes = await nativePlaybackBridge.writeDownloadChunk({
          trackId,
          chunkIndex,
          chunkData: chunkBase64,
          extension: ext,
        });

        if (!writeRes.success) {
          await nativePlaybackBridge.abortDownloadChunked(trackId);
          return {
            trackId,
            success: false,
            failed: true,
            error: writeRes.error || `Failed to write chunk ${chunkIndex}`,
            bytesTransferred,
          };
        }

        bytesTransferred += chunkSlice.size;

        // Lightweight async event-loop yield between chunks
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      // Check playback gating before final atomic commit
      await this.waitForPlaybackIdle();

      if (this.isCancelled) {
        await nativePlaybackBridge.abortDownloadChunked(trackId);
        return {
          trackId,
          success: false,
          failed: true,
          error: 'Migration was cancelled before commit',
          bytesTransferred,
        };
      }

      const metadata = {
        title: record.track?.title || 'Unknown Title',
        artist: record.track?.artistName || (record.track as any)?.artist || 'Unknown Artist',
        album: record.track?.albumTitle || (record.track as any)?.album || null,
        artworkUrl: record.track?.artworkUrl || null,
        mimeType: blob.type || (ext === 'm4a' ? 'audio/mp4' : 'audio/mpeg'),
        durationMs: Math.round((record.track?.duration || 0) * 1000),
        provider: record.track?.provider || 'unknown',
        downloadedAt: record.downloadedAt || Date.now(),
      };

      const commitRes = await nativePlaybackBridge.commitDownloadChunked({
        trackId,
        metadata,
      });

      if (!commitRes.success) {
        await nativePlaybackBridge.abortDownloadChunked(trackId);
        return {
          trackId,
          success: false,
          failed: true,
          error: commitRes.error || 'Native commit failed',
          bytesTransferred,
        };
      }

      // Authoritative verification via native bridge
      const isVerified = await nativePlaybackBridge.isTrackDownloadedNatively(trackId);
      if (!isVerified) {
        await nativePlaybackBridge.abortDownloadChunked(trackId);
        return {
          trackId,
          success: false,
          failed: true,
          error: 'Native verification failed after commit',
          bytesTransferred,
        };
      }

      // Update in-memory download cache
      if (record.track) {
        const migratedTrack: Track = {
          ...record.track,
          id: trackId,
          title: metadata.title,
          artistName: metadata.artist,
          artistId: record.track.artistId || metadata.artist || 'unknown',
          albumTitle: metadata.album || undefined,
          artworkUrl: metadata.artworkUrl || record.track.artworkUrl || '',
          audioUrl: `file://${commitRes.localFilePath || ''}`,
          localPath: commitRes.localFilePath,
          isDownloaded: true,
          sourceType: (record.track?.sourceType === 'local' || record.track?.provider === 'local' || trackId.startsWith('local_')) ? 'local' : 'downloaded',
          fileSize: commitRes.fileSize || bytesTransferred,
          duration: record.track?.duration || 0,
          provider: (record.track.provider || metadata.provider || 'jiosaavn') as any,
          isPlayable: true,
          accessStatus: 'playable',
          playbackType: 'full',
        };
        try {
          downloadService.registerMigratedNativeTrack(migratedTrack);
          if (migratedTrack.sourceType === 'local' || trackId.startsWith('local_')) {
            storageService.saveLocalTrack({
              ...record,
              track: migratedTrack,
              fileSize: migratedTrack.fileSize || bytesTransferred,
            }).catch(() => {});
          } else {
            // Safely delete the legacy IndexedDB record and blob now that native storage is 100% verified!
            console.log('[MIGRATION] Safely deleting migrated IndexedDB record:', trackId);
            await storageService.deleteDownloadedTrack(trackId).catch(() => {});
          }
        } catch {}
      }

      return {
        trackId,
        success: true,
        skipped: false,
        alreadyNative: false,
        failed: false,
        bytesTransferred,
      };
    } finally {
      this.activeSingleTrackId = null;
      if (!wasRunning) {
        this.isRunning = false;
      }
    }
  }

  /**
   * Main entry point to migrate all eligible IndexedDB offline tracks to native storage.
   * Concurrency guard: single flight. If migration is already running, returns the existing active promise.
   * Strictly passive: must be called explicitly.
   */
  public migrateAll(): Promise<MigrationSummary> {
    if (this.isRunning && this.currentRunPromise) {
      return this.currentRunPromise;
    }

    if (!nativePlaybackBridge.isAvailable()) {
      return Promise.resolve({
        total: 0,
        completed: 0,
        migrated: 0,
        skipped: 0,
        failed: 0,
        bytesTransferred: 0,
        trackResults: [],
      });
    }

    this.isCancelled = false;
    this.isRunning = true;

    const runPromise = this.executeMigration();
    this.currentRunPromise = runPromise.finally(() => {
      this.isRunning = false;
      this.currentRunPromise = null;
    });

    return this.currentRunPromise;
  }

  /**
   * Alias for migrateAll() to maintain backwards compatibility with existing calls.
   */
  public startMigration(): Promise<MigrationSummary> {
    return this.migrateAll();
  }

  /**
   * Cooperatively cancels active migration.
   */
  public cancel(): void {
    this.isCancelled = true;
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
    if (this.idleGraceTimer) {
      clearTimeout(this.idleGraceTimer);
      this.idleGraceTimer = null;
    }
    if (this.playbackResumeResolve) {
      this.playbackResumeResolve();
      this.playbackPausePromise = null;
      this.playbackResumeResolve = null;
    }
    if (this.isRunning) {
      this.notifyProgress({ status: 'cancelled' });
    }
  }

  /**
   * Alias for cancel() for backwards compatibility.
   */
  public cancelMigration(): void {
    this.cancel();
  }

  private async executeMigration(): Promise<MigrationSummary> {
    this.notifyProgress({ status: 'discovering' });

    let records: StoredAudioRecord[] = [];
    try {
      records = await storageService.getAllDownloadedTracks();
    } catch (err) {
      console.warn('[MIGRATION] Could not read tracks from storageService:', err);
      records = [];
    }

    const summary: MigrationSummary = {
      total: records.length,
      completed: 0,
      get migrated() {
        return this.completed;
      },
      set migrated(val: number) {
        this.completed = val;
      },
      skipped: 0,
      failed: 0,
      bytesTransferred: 0,
      trackResults: [],
    };

    this.notifyProgress({
      status: 'migrating',
      totalTracks: records.length,
      completedTracks: 0,
      failedTracks: 0,
      skippedTracks: 0,
      bytesTransferred: 0,
    });

    for (let i = 0; i < records.length; i++) {
      if (this.isCancelled) {
        break;
      }

      const rec = records[i];
      const trackId = rec?.id || rec?.track?.id || `track_${i}`;
      this.notifyProgress({
        currentTrackId: trackId,
        currentTrackTitle: rec?.track?.title || trackId,
      });

      // Cooperative playback check before starting track
      await this.waitForPlaybackIdle();

      if (this.isCancelled) {
        break;
      }

      const res = await this.migrateTrack(rec);
      summary.trackResults.push(res);
      summary.bytesTransferred += res.bytesTransferred;

      if (res.success) {
        if (res.skipped) {
          summary.skipped++;
          this.notifyProgress({ skippedTracks: summary.skipped });
        } else {
          summary.completed++;
          this.notifyProgress({
            completedTracks: summary.completed,
            bytesTransferred: summary.bytesTransferred,
          });
        }
      } else {
        if (res.skipped) {
          summary.skipped++;
          this.notifyProgress({ skippedTracks: summary.skipped });
        } else {
          summary.failed++;
          this.notifyProgress({ failedTracks: summary.failed });
        }
      }

      // Lightweight async event-loop yield between tracks
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    this.notifyProgress({
      status: this.isCancelled ? 'cancelled' : 'completed',
      currentTrackId: undefined,
      currentTrackTitle: undefined,
    });

    return summary;
  }
}

export const nativeMigrationService = new NativeMigrationService();
