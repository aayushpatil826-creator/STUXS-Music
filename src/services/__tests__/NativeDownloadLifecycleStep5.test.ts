import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { downloadService } from '../DownloadService.ts';
import { storageService, type StoredAudioRecord } from '../StorageService.ts';
import { nativePlaybackController } from '../nativePlaybackController.ts';
import { nativePlaybackBridge } from '../nativePlaybackBridge.ts';
import type { Track } from '../../types/music.d.ts';

function createMockStream(chunks: Uint8Array[]) {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index++]);
      } else {
        controller.close();
      }
    },
  });
}

function createSampleTrack(id: string, overrides?: Partial<Track>): Track {
  return {
    id,
    title: `Track ${id}`,
    artistName: 'Test Artist',
    artistId: 'artist-1',
    albumTitle: 'Test Album',
    artworkUrl: 'https://example.com/art.jpg',
    audioUrl: 'https://example.com/song.mp3',
    duration: 210,
    provider: 'jiosaavn',
    isPlayable: true,
    accessStatus: 'playable',
    ...overrides,
  };
}

describe('Phase 6 Step 5: Native Download Lifecycle & Status Tests', () => {
  const originalFetch = globalThis.fetch;
  let inMemoryNativeTracks: Map<string, any>;
  let inMemoryStaging: Map<string, any>;

  beforeEach(() => {
    inMemoryNativeTracks = new Map();
    inMemoryStaging = new Map();

    storageService.getAllDownloadedTracks = async () => [];
    storageService.getDownloadedTrack = async (_id: string) => null;
    storageService.saveDownloadedTrack = async (_record: StoredAudioRecord) => {};
    storageService.deleteDownloadedTrack = async (_id: string) => {};
    storageService.getLocalTrack = async (_id: string) => null;

    nativePlaybackController.isEnabled = () => true;
    nativePlaybackBridge.isAvailable = () => true;

    nativePlaybackBridge.beginDownloadChunked = async (opts) => {
      if (opts.skipIfDownloaded && inMemoryNativeTracks.has(opts.trackId)) {
        return { success: true, trackId: opts.trackId, nextExpectedChunkIndex: -1, alreadyDownloaded: true };
      }
      inMemoryStaging.set(opts.trackId, { chunks: [], extension: opts.extension || 'mp3' });
      return { success: true, trackId: opts.trackId, nextExpectedChunkIndex: 0 };
    };

    nativePlaybackBridge.writeDownloadChunk = async (opts) => {
      const stage = inMemoryStaging.get(opts.trackId);
      if (!stage) return { success: false, error: 'Not staging', trackId: opts.trackId, acceptedChunkIndex: -1, nextExpectedChunkIndex: 0, bytesWritten: 0 };
      stage.chunks.push(opts.chunkData);
      return {
        success: true,
        trackId: opts.trackId,
        acceptedChunkIndex: opts.chunkIndex,
        nextExpectedChunkIndex: opts.chunkIndex + 1,
        bytesWritten: stage.chunks.length * 15000,
      };
    };

    nativePlaybackBridge.commitDownloadChunked = async (opts) => {
      const stage = inMemoryStaging.get(opts.trackId);
      if (!stage) return { success: false, trackId: opts.trackId, error: 'No staging file' };
      const entity = {
        id: opts.trackId,
        title: opts.metadata?.title || 'Unknown Title',
        artist: opts.metadata?.artist || 'Unknown Artist',
        album: opts.metadata?.album || null,
        artworkUrl: opts.metadata?.artworkUrl || null,
        localFilePath: `/data/user/0/com.stuxs.music/files/native_downloads/${opts.trackId}.${stage.extension}`,
        mimeType: opts.metadata?.mimeType || 'audio/mpeg',
        fileSize: 15000,
        durationMs: opts.metadata?.durationMs || 180000,
        provider: opts.metadata?.provider || 'jiosaavn',
        downloadedAt: Date.now(),
      };
      inMemoryNativeTracks.set(opts.trackId, entity);
      inMemoryStaging.delete(opts.trackId);
      return { success: true, trackId: opts.trackId, localFilePath: entity.localFilePath, fileSize: entity.fileSize };
    };

    nativePlaybackBridge.abortDownloadChunked = async (trackId: string) => {
      inMemoryStaging.delete(trackId);
      return { success: true, trackId };
    };

    nativePlaybackBridge.isTrackDownloadedNatively = async (trackId: string) => {
      return inMemoryNativeTracks.has(trackId);
    };

    nativePlaybackBridge.removeNativeDownload = async (trackId: string) => {
      const removed = inMemoryNativeTracks.delete(trackId);
      inMemoryStaging.delete(trackId);
      return { success: removed, trackId };
    };

    nativePlaybackBridge.getNativeDownloadedTracks = async () => {
      return Array.from(inMemoryNativeTracks.values());
    };

    nativePlaybackBridge.getNativeDownloadedTrackIds = async () => {
      return Array.from(inMemoryNativeTracks.keys());
    };

    nativePlaybackBridge.getNativeDownloadStatus = async (trackId: string) => {
      if (inMemoryNativeTracks.has(trackId)) {
        const entity = inMemoryNativeTracks.get(trackId);
        return {
          success: true,
          trackId,
          status: 'downloaded' as const,
          isVerified: true,
          expectedChunkIndex: 0,
          fileSize: entity.fileSize,
          localFilePath: entity.localFilePath,
        };
      }
      if (inMemoryStaging.has(trackId)) {
        return {
          success: true,
          trackId,
          status: 'downloading' as const,
          isVerified: false,
          expectedChunkIndex: 1,
        };
      }
      return {
        success: true,
        trackId,
        status: 'not_downloaded' as const,
        isVerified: false,
        expectedChunkIndex: 0,
      };
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('1. Completed native download detection and typed status query', async () => {
    const trackBytes = new Uint8Array(15000);
    globalThis.fetch = async () => new Response(createMockStream([trackBytes]), {
      status: 200,
      headers: { 'content-type': 'audio/mpeg', 'content-length': '15000' },
    });

    const track = createSampleTrack('step5-test-1');
    await downloadService.downloadTrack(track);

    assert.equal(downloadService.isTrackDownloaded(track.id), true);
    assert.equal(downloadService.getStatus(track.id), 'downloaded');

    const nativeStatus = await downloadService.getNativeDownloadStatus(track.id);
    assert.notEqual(nativeStatus, null);
    assert.equal(nativeStatus?.status, 'downloaded');
    assert.equal(nativeStatus?.isVerified, true);
    assert.equal(nativeStatus?.fileSize, 15000);
    assert.equal(nativeStatus?.localFilePath?.includes('step5-test-1'), true);
  });

  it('2. Interrupted download cleanup removes staging and emits failure without false records', async () => {
    globalThis.fetch = async () => {
      throw new Error('Network connection abruptly lost');
    };

    const track = createSampleTrack('step5-interrupt');
    await assert.rejects(
      async () => {
        await downloadService.downloadTrack(track);
      },
      /Network connection abruptly lost/
    );

    assert.equal(downloadService.isTrackDownloaded(track.id), false);
    assert.equal(inMemoryStaging.has(track.id), false);
    assert.equal(inMemoryNativeTracks.has(track.id), false);

    const nativeStatus = await downloadService.getNativeDownloadStatus(track.id);
    assert.equal(nativeStatus?.status, 'not_downloaded');
    assert.equal(nativeStatus?.isVerified, false);
  });

  it('3. Duplicate download protection preserves existing file and does not duplicate Room entry', async () => {
    const trackBytes = new Uint8Array(15000);
    globalThis.fetch = async () => new Response(createMockStream([trackBytes]), {
      status: 200,
      headers: { 'content-type': 'audio/mpeg', 'content-length': '15000' },
    });

    const track = createSampleTrack('step5-dup');
    await downloadService.downloadTrack(track);
    assert.equal(inMemoryNativeTracks.size, 1);

    // Second download call should not fetch or duplicate
    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      throw new Error('Should not fetch duplicate track');
    };

    await downloadService.downloadTrack(track);
    assert.equal(fetchCalled, false);
    assert.equal(inMemoryNativeTracks.size, 1);
  });

  it('4. Deletion removes native audio file, Room record, and revokes URLs', async () => {
    const trackBytes = new Uint8Array(15000);
    globalThis.fetch = async () => new Response(createMockStream([trackBytes]), {
      status: 200,
      headers: { 'content-type': 'audio/mpeg', 'content-length': '15000' },
    });

    const track = createSampleTrack('step5-del');
    await downloadService.downloadTrack(track);
    assert.equal(downloadService.isTrackDownloaded(track.id), true);

    await downloadService.removeDownload(track.id);

    assert.equal(downloadService.isTrackDownloaded(track.id), false);
    assert.equal(inMemoryNativeTracks.has(track.id), false);

    const nativeStatus = await downloadService.getNativeDownloadStatus(track.id);
    assert.equal(nativeStatus?.status, 'not_downloaded');
    assert.equal(nativeStatus?.isVerified, false);
  });

  it('5. Re-download cleanly creates a new verified native download after deletion', async () => {
    const trackBytes = new Uint8Array(15000);
    globalThis.fetch = async () => new Response(createMockStream([trackBytes]), {
      status: 200,
      headers: { 'content-type': 'audio/mpeg', 'content-length': '15000' },
    });

    const track = createSampleTrack('step5-redownload');
    // Pass 1: Download
    await downloadService.downloadTrack(track);
    assert.equal(downloadService.isTrackDownloaded(track.id), true);

    // Pass 2: Delete
    await downloadService.removeDownload(track.id);
    assert.equal(downloadService.isTrackDownloaded(track.id), false);

    // Pass 3: Re-download
    await downloadService.downloadTrack(track);
    assert.equal(downloadService.isTrackDownloaded(track.id), true);
    assert.equal(inMemoryNativeTracks.has(track.id), true);

    const nativeStatus = await downloadService.getNativeDownloadStatus(track.id);
    assert.equal(nativeStatus?.status, 'downloaded');
    assert.equal(nativeStatus?.isVerified, true);
  });

  it('6. Room and file consistency: deleted native file updates status correctly', async () => {
    const trackBytes = new Uint8Array(15000);
    globalThis.fetch = async () => new Response(createMockStream([trackBytes]), {
      status: 200,
      headers: { 'content-type': 'audio/mpeg', 'content-length': '15000' },
    });

    const track = createSampleTrack('step5-consistency');
    await downloadService.downloadTrack(track);
    assert.equal(downloadService.isTrackDownloaded(track.id), true);

    // Simulate external removal from native storage
    inMemoryNativeTracks.delete(track.id);

    const actualStatus = await downloadService.getActualDownloadStatus(track.id);
    assert.equal(actualStatus, 'not_downloaded');
  });

  it('7. Native inventory lookup successfully rebuilds track map on initialization', async () => {
    inMemoryNativeTracks.set('step5-inv-1', {
      id: 'step5-inv-1',
      title: 'Inventory Song 1',
      artist: 'Artist 1',
      album: 'Album 1',
      artworkUrl: 'https://example.com/art1.jpg',
      localFilePath: '/data/user/0/com.stuxs.music/files/native_downloads/step5-inv-1.mp3',
      mimeType: 'audio/mpeg',
      fileSize: 12000,
      durationMs: 180000,
      provider: 'jiosaavn',
      downloadedAt: Date.now(),
    });

    inMemoryNativeTracks.set('step5-inv-2', {
      id: 'step5-inv-2',
      title: 'Inventory Song 2',
      artist: 'Artist 2',
      album: 'Album 2',
      artworkUrl: 'https://example.com/art2.jpg',
      localFilePath: '/data/user/0/com.stuxs.music/files/native_downloads/step5-inv-2.mp3',
      mimeType: 'audio/mpeg',
      fileSize: 14000,
      durationMs: 200000,
      provider: 'jiosaavn',
      downloadedAt: Date.now(),
    });

    await downloadService.refreshAndSelfHeal();

    assert.equal(downloadService.isTrackDownloaded('step5-inv-1'), true);
    assert.equal(downloadService.isTrackDownloaded('step5-inv-2'), true);

    const t1 = downloadService.getPlayableTrack('step5-inv-1');
    assert.notEqual(t1, undefined);
    assert.equal(t1?.audioUrl, 'file:///data/user/0/com.stuxs.music/files/native_downloads/step5-inv-1.mp3');
  });
});
