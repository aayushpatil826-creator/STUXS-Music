import type { Track } from '../types/music';
import { storageService } from './StorageService';
import { BRANDING_CONFIG } from '../config/branding';
import { MetadataResolverService } from './MetadataResolverService';
import { nativePlaybackBridge } from './nativePlaybackBridge';
import { arrayBufferToBase64, deriveAudioExtension } from './NativeMigrationService';

export class LocalMusicService {
  private static blobUrlCache = new Map<string, string>();
  private static localTracksMemoryMap = new Map<string, Track>();

  /**
   * Persists an imported audio file to native Android app storage and commits to Room database.
   */
  public static async persistFileToNativeStorage(
    trackId: string,
    file: File | Blob,
    track: Track
  ): Promise<string | null> {
    if (!nativePlaybackBridge.isAvailable()) return null;

    try {
      const ext = deriveAudioExtension(file.type, track);
      const beginRes = await nativePlaybackBridge.beginDownloadChunked({
        trackId,
        extension: ext,
        skipIfDownloaded: false,
      });

      if (!beginRes.success && !beginRes.alreadyDownloaded) {
        console.warn('[LocalMusicService] Native beginDownload failed:', beginRes.error);
        return null;
      }

      if (!beginRes.alreadyDownloaded) {
        const MAX_CHUNK = 256 * 1024; // 256 KB strictly enforced
        let offset = 0;
        let chunkIndex = 0;

        while (offset < file.size) {
          const slice = file.slice(offset, Math.min(offset + MAX_CHUNK, file.size));
          const buffer = await slice.arrayBuffer();
          const base64 = arrayBufferToBase64(buffer);

          const writeRes = await nativePlaybackBridge.writeDownloadChunk({
            trackId,
            chunkIndex,
            chunkData: base64,
            extension: ext,
          });

          if (!writeRes.success) {
            await nativePlaybackBridge.abortDownloadChunked(trackId);
            console.warn(`[LocalMusicService] Failed to write native chunk ${chunkIndex}:`, writeRes.error);
            return null;
          }

          offset += slice.size;
          chunkIndex++;
        }

        const metadata = {
          title: track.title || 'Unknown Title',
          artist: track.artistName || 'Unknown Artist',
          album: track.albumTitle || 'Local Library',
          artworkUrl: track.artworkUrl || null,
          mimeType: file.type || (ext === 'm4a' ? 'audio/mp4' : 'audio/mpeg'),
          durationMs: Math.round((track.duration || 0) * 1000),
          provider: 'local',
          downloadedAt: Date.now(),
        };

        const commitRes = await nativePlaybackBridge.commitDownloadChunked({
          trackId,
          metadata,
        });

        if (!commitRes.success) {
          await nativePlaybackBridge.abortDownloadChunked(trackId);
          console.warn('[LocalMusicService] Failed to commit native local file:', commitRes.error);
          return null;
        }

        return commitRes.localFilePath || null;
      }
      return null;
    } catch (err) {
      console.warn('[LocalMusicService] Error persisting file to native storage:', err);
      return null;
    }
  }

  /**
   * Helper to detect audio track duration via HTMLAudioElement.
   */
  private static async getAudioDuration(url: string): Promise<number> {
    return new Promise((resolve) => {
      const audio = new Audio();
      const onLoaded = () => {
        const dur = Math.round(audio.duration || 0);
        audio.removeEventListener('loadedmetadata', onLoaded);
        audio.src = '';
        resolve(dur > 0 ? dur : 180);
      };
      const onError = () => {
        audio.removeEventListener('error', onError);
        audio.src = '';
        resolve(180);
      };

      audio.addEventListener('loadedmetadata', onLoaded, { once: true });
      audio.addEventListener('error', onError, { once: true });
      audio.src = url;
    });
  }

  /**
   * Fast sync retrieval for instant (<5ms) audio URL resolution.
   */
  public static getCachedAudioUrl(trackId: string): string | undefined {
    return this.blobUrlCache.get(trackId);
  }

  /**
   * Resolves a local track into an immediately playable track with an active Blob URL.
   */
  public static async getPlayableTrack(track: Track): Promise<Track> {
    // 1. In-memory URL cache hit
    const cachedUrl = this.blobUrlCache.get(track.id);
    if (cachedUrl) {
      return {
        ...track,
        audioUrl: cachedUrl,
        sourceType: 'local',
        provider: 'local',
        isPlayable: true,
        accessStatus: 'playable',
        playbackType: 'full',
      };
    }

    // 2. Track already has an active blob URL
    if (track.audioUrl && track.audioUrl.startsWith('blob:')) {
      this.blobUrlCache.set(track.id, track.audioUrl);
      return {
        ...track,
        sourceType: 'local',
        provider: 'local',
        isPlayable: true,
        accessStatus: 'playable',
        playbackType: 'full',
      };
    }

    // 3. Fast IndexedDB record lookup (<10ms)
    try {
      const record = await storageService.getLocalTrack(track.id);
      if (record && record.blob) {
        let objectUrl = this.blobUrlCache.get(track.id);
        if (!objectUrl) {
          objectUrl = URL.createObjectURL(record.blob);
          this.blobUrlCache.set(track.id, objectUrl);
        }
        return {
          ...track,
          ...record.track,
          audioUrl: objectUrl,
          sourceType: 'local',
          provider: 'local',
          isPlayable: true,
          accessStatus: 'playable',
          playbackType: 'full',
          fileSize: record.fileSize,
          localPath: record.track?.localPath || track.localPath,
          isDownloaded: record.track?.isDownloaded ?? track.isDownloaded ?? Boolean(record.track?.localPath?.startsWith('/')),
        };
      }
    } catch (err) {
      console.warn('[LocalMusicService] Error loading local track blob:', err);
    }

    return {
      ...track,
      sourceType: 'local',
      provider: 'local',
      isPlayable: true,
      accessStatus: 'playable',
      playbackType: 'full',
    };
  }

  /**
   * Imports a single local audio File, extracts & auto-resolves metadata and artwork, saves to IndexedDB, and returns a Track.
   */
  public static async importFile(
    file: File,
    onProgressStatus?: (status: string) => void
  ): Promise<Track> {
    if (onProgressStatus) {
      onProgressStatus(`Reading ${file.name}...`);
    }

    const trackId = `local_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const objectUrl = URL.createObjectURL(file);
    this.blobUrlCache.set(trackId, objectUrl);

    // 1. Resolve metadata & artwork with strict confidence scoring
    const resolved = await MetadataResolverService.resolveTrack(
      file,
      file.name,
      BRANDING_CONFIG.defaultArtwork
    );

    const duration = await this.getAudioDuration(objectUrl);

    const track: Track = {
      id: trackId,
      title: resolved.title,
      artistId: `artist_${encodeURIComponent(
        resolved.artist.toLowerCase().replace(/\s+/g, '_')
      )}`,
      artistName: resolved.artist,
      albumTitle: resolved.album || 'Local Library',
      artworkUrl: resolved.artworkUrl || BRANDING_CONFIG.defaultArtwork,
      audioUrl: objectUrl,
      duration,
      provider: 'local',
      sourceType: 'local',
      isPlayable: true,
      isPreview: false,
      accessStatus: 'playable',
      fileSize: file.size,
      localPath: file.name,
      audioFormat: file.type.replace('audio/', '').toUpperCase() || 'AUDIO',
      trackNumber: resolved.trackNumber,
    };

    // 2. Persist to native storage if native bridge is available
    if (nativePlaybackBridge.isAvailable() && file.size >= 10240) {
      try {
        const nativePath = await this.persistFileToNativeStorage(trackId, file, track);
        if (nativePath) {
          track.localPath = nativePath;
          track.isDownloaded = true;
        }
      } catch (nativeErr) {
        console.warn('[LocalMusicService] Failed to persist file to native storage:', nativeErr);
      }
    }

    this.localTracksMemoryMap.set(trackId, track);

    // 3. Persist in IndexedDB for offline access
    await storageService.saveLocalTrack({
      id: trackId,
      track,
      blob: file,
      addedAt: Date.now(),
      fileSize: file.size,
    });

    return track;
  }

  /**
   * Rehydrates all local tracks from IndexedDB on application boot.
   */
  public static async loadAllLocalTracks(): Promise<Track[]> {
    try {
      const records = await storageService.getAllLocalTracks();
      return records.map((rec) => {
        let objectUrl = this.blobUrlCache.get(rec.id);
        if (!objectUrl) {
          objectUrl = URL.createObjectURL(rec.blob);
          this.blobUrlCache.set(rec.id, objectUrl);
        }
        const isNativeDownloaded = rec.track?.isDownloaded || Boolean(rec.track?.localPath && rec.track.localPath.startsWith('/'));
        const fullTrack: Track = {
          ...rec.track,
          audioUrl: objectUrl,
          sourceType: 'local',
          provider: 'local',
          fileSize: rec.fileSize,
          isPlayable: true,
          accessStatus: 'playable',
          playbackType: 'full',
          localPath: rec.track?.localPath || rec.track?.title,
          isDownloaded: isNativeDownloaded,
        };
        this.localTracksMemoryMap.set(rec.id, fullTrack);
        return fullTrack;
      });
    } catch (err) {
      console.warn('[LocalMusicService] Failed to load local tracks:', err);
      return [];
    }
  }

  /**
   * Deletes a local track from IndexedDB and revokes cached object URL.
   */
  public static async deleteLocalTrack(id: string): Promise<void> {
    const cached = this.blobUrlCache.get(id);
    if (cached) {
      try {
        URL.revokeObjectURL(cached);
      } catch {}
      this.blobUrlCache.delete(id);
    }
    this.localTracksMemoryMap.delete(id);
    await storageService.deleteLocalTrack(id);
  }
}
