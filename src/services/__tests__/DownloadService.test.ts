import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { downloadService, validateDownloadSource } from '../DownloadService.ts';
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

describe('DownloadService Native Integration Tests (Step 4)', () => {
  const originalFetch = globalThis.fetch;
  let inMemoryIndexedDB: Map<string, StoredAudioRecord>;

  beforeEach(() => {
    inMemoryIndexedDB = new Map();

    storageService.getAllDownloadedTracks = async () => Array.from(inMemoryIndexedDB.values());
    storageService.getDownloadedTrack = async (id: string) => inMemoryIndexedDB.get(id) || null;
    storageService.saveDownloadedTrack = async (record: StoredAudioRecord) => {
      inMemoryIndexedDB.set(record.id, record);
    };
    storageService.deleteDownloadedTrack = async (id: string) => {
      inMemoryIndexedDB.delete(id);
    };

    nativePlaybackBridge.isAvailable = () => true;
    nativePlaybackController.isEnabled = () => true;
    nativePlaybackBridge.isTrackDownloadedNatively = async () => false;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // 1. Native-enabled download uses native path
  it('1. Native-enabled download uses native path', async () => {
    nativePlaybackController.isEnabled = () => true;
    nativePlaybackBridge.isAvailable = () => true;

    let nativeBeginCalled = false;
    let nativeWriteCalled = false;
    let nativeCommitCalled = false;

    nativePlaybackBridge.isTrackDownloadedNatively = async () => false;
    nativePlaybackBridge.beginDownloadChunked = async (opts) => {
      nativeBeginCalled = true;
      return { success: true, trackId: opts.trackId, nextExpectedChunkIndex: 0 };
    };
    nativePlaybackBridge.writeDownloadChunk = async (opts) => {
      nativeWriteCalled = true;
      return { success: true, trackId: opts.trackId, acceptedChunkIndex: 0, nextExpectedChunkIndex: 1, bytesWritten: 15000 };
    };
    nativePlaybackBridge.commitDownloadChunked = async (opts) => {
      nativeCommitCalled = true;
      // Mark verified
      nativePlaybackBridge.isTrackDownloadedNatively = async (id) => id === opts.trackId;
      return { success: true, trackId: opts.trackId, localFilePath: '/data/song.mp3', fileSize: 15000 };
    };

    const trackBytes = new Uint8Array(15000);
    globalThis.fetch = async () => new Response(createMockStream([trackBytes]), {
      status: 200,
      headers: { 'content-type': 'audio/mpeg', 'content-length': '15000' },
    });

    const track = createSampleTrack('test-track-1');
    await downloadService.downloadTrack(track);

    assert.equal(nativeBeginCalled, true);
    assert.equal(nativeWriteCalled, true);
    assert.equal(nativeCommitCalled, true);
    assert.equal(inMemoryIndexedDB.has('test-track-1'), false, 'Should not write to IndexedDB on native success');
  });

  // 2. Native-disabled download uses existing IndexedDB path
  it('2. Native-disabled download uses existing IndexedDB path', async () => {
    nativePlaybackController.isEnabled = () => false;

    let nativeBeginCalled = false;
    nativePlaybackBridge.beginDownloadChunked = async () => {
      nativeBeginCalled = true;
      return { success: true, trackId: 'test-track-2', nextExpectedChunkIndex: 0 };
    };

    const trackBytes = new Uint8Array(16000);
    globalThis.fetch = async () => new Response(createMockStream([trackBytes]), {
      status: 200,
      headers: { 'content-type': 'audio/mpeg', 'content-length': '16000' },
    });

    const track = createSampleTrack('test-track-2');
    await downloadService.downloadTrack(track);

    assert.equal(nativeBeginCalled, false, 'Native path should not be called when native is disabled');
    assert.equal(inMemoryIndexedDB.has('test-track-2'), true, 'Should write to IndexedDB');
  });

  // 3. Native bridge unavailable uses existing fallback
  it('3. Native bridge unavailable uses existing fallback', async () => {
    nativePlaybackController.isEnabled = () => true;
    nativePlaybackBridge.isAvailable = () => false;

    const trackBytes = new Uint8Array(18000);
    globalThis.fetch = async () => new Response(createMockStream([trackBytes]), {
      status: 200,
      headers: { 'content-type': 'audio/mpeg', 'content-length': '18000' },
    });

    const track = createSampleTrack('test-track-3');
    await downloadService.downloadTrack(track);

    assert.equal(inMemoryIndexedDB.has('test-track-3'), true, 'Should fall back to IndexedDB when bridge unavailable');
  });

  // 4. Existing verified native download is skipped
  it('4. Existing verified native download is skipped', async () => {
    nativePlaybackBridge.isTrackDownloadedNatively = async () => true;

    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return new Response('audio');
    };

    const track = createSampleTrack('test-track-4');
    await downloadService.downloadTrack(track);

    assert.equal(fetchCalled, false, 'Should skip download when already verified natively');
    assert.equal(downloadService.getStatus('test-track-4'), 'downloaded');
  });

  // 5. Native transfer uses bounded chunks (<= 256 KB)
  it('5. Native transfer uses bounded chunks (<= 256 KB)', async () => {
    const chunkSizes: number[] = [];
    nativePlaybackBridge.isTrackDownloadedNatively = async () => false;
    nativePlaybackBridge.beginDownloadChunked = async (opts) => ({
      success: true,
      trackId: opts.trackId,
      nextExpectedChunkIndex: 0,
    });
    nativePlaybackBridge.writeDownloadChunk = async (opts) => {
      const decodedLen = atob(opts.chunkData).length;
      chunkSizes.push(decodedLen);
      return {
        success: true,
        trackId: opts.trackId,
        acceptedChunkIndex: opts.chunkIndex,
        nextExpectedChunkIndex: opts.chunkIndex + 1,
        bytesWritten: decodedLen,
      };
    };
    nativePlaybackBridge.commitDownloadChunked = async (opts) => {
      nativePlaybackBridge.isTrackDownloadedNatively = async () => true;
      return { success: true, trackId: opts.trackId };
    };

    // 600 KB total bytes
    const totalBytes = 600 * 1024;
    const bigBytes = new Uint8Array(totalBytes);
    globalThis.fetch = async () => new Response(createMockStream([bigBytes]), {
      status: 200,
      headers: { 'content-type': 'audio/mpeg', 'content-length': totalBytes.toString() },
    });

    const track = createSampleTrack('test-track-5');
    await downloadService.downloadTrack(track);

    assert.equal(chunkSizes.length, 3);
    for (const size of chunkSizes) {
      assert.ok(size <= 256 * 1024, `Chunk size ${size} must not exceed 256 KB`);
    }
  });

  // 6. Chunks are sequential (0, 1, 2, ...)
  it('6. Chunks are sequential', async () => {
    const indices: number[] = [];
    nativePlaybackBridge.isTrackDownloadedNatively = async () => false;
    nativePlaybackBridge.beginDownloadChunked = async (opts) => ({
      success: true,
      trackId: opts.trackId,
      nextExpectedChunkIndex: 0,
    });
    nativePlaybackBridge.writeDownloadChunk = async (opts) => {
      indices.push(opts.chunkIndex);
      return {
        success: true,
        trackId: opts.trackId,
        acceptedChunkIndex: opts.chunkIndex,
        nextExpectedChunkIndex: opts.chunkIndex + 1,
        bytesWritten: 1000,
      };
    };
    nativePlaybackBridge.commitDownloadChunked = async (opts) => {
      nativePlaybackBridge.isTrackDownloadedNatively = async () => true;
      return { success: true, trackId: opts.trackId };
    };

    const totalBytes = 600 * 1024;
    globalThis.fetch = async () => new Response(createMockStream([new Uint8Array(totalBytes)]), {
      status: 200,
      headers: { 'content-type': 'audio/mpeg', 'content-length': totalBytes.toString() },
    });

    const track = createSampleTrack('test-track-6');
    await downloadService.downloadTrack(track);

    assert.deepEqual(indices, [0, 1, 2]);
  });

  // 7. Native commit happens only after complete transfer
  it('7. Native commit happens only after complete transfer', async () => {
    const events: string[] = [];
    nativePlaybackBridge.isTrackDownloadedNatively = async () => false;
    nativePlaybackBridge.beginDownloadChunked = async () => {
      events.push('begin');
      return { success: true, trackId: 'test-track-7', nextExpectedChunkIndex: 0 };
    };
    nativePlaybackBridge.writeDownloadChunk = async (opts) => {
      events.push(`chunk:${opts.chunkIndex}`);
      return {
        success: true,
        trackId: opts.trackId,
        acceptedChunkIndex: opts.chunkIndex,
        nextExpectedChunkIndex: opts.chunkIndex + 1,
        bytesWritten: 10000,
      };
    };
    nativePlaybackBridge.commitDownloadChunked = async (opts) => {
      events.push('commit');
      nativePlaybackBridge.isTrackDownloadedNatively = async () => true;
      return { success: true, trackId: opts.trackId };
    };

    globalThis.fetch = async () => new Response(createMockStream([new Uint8Array(20000)]), {
      status: 200,
      headers: { 'content-type': 'audio/mpeg', 'content-length': '20000' },
    });

    const track = createSampleTrack('test-track-7');
    await downloadService.downloadTrack(track);

    assert.deepEqual(events, ['begin', 'chunk:0', 'commit']);
  });

  // 8. Native verification failure does not report success
  it('8. Native verification failure does not report success', async () => {
    nativePlaybackBridge.isTrackDownloadedNatively = async () => false;
    nativePlaybackBridge.beginDownloadChunked = async (opts) => ({
      success: true,
      trackId: opts.trackId,
      nextExpectedChunkIndex: 0,
    });
    nativePlaybackBridge.writeDownloadChunk = async (opts) => ({
      success: true,
      trackId: opts.trackId,
      acceptedChunkIndex: 0,
      nextExpectedChunkIndex: 1,
      bytesWritten: 15000,
    });
    nativePlaybackBridge.commitDownloadChunked = async (opts) => ({
      success: true,
      trackId: opts.trackId,
    });

    globalThis.fetch = async () => new Response(createMockStream([new Uint8Array(15000)]), {
      status: 200,
      headers: { 'content-type': 'audio/mpeg', 'content-length': '15000' },
    });

    const track = createSampleTrack('test-track-8');
    await assert.rejects(async () => {
      await downloadService.downloadTrack(track);
    }, /verification failed/i);

    assert.equal(downloadService.getStatus('test-track-8'), 'failed');
  });

  // 9. Mid-transfer failure aborts staging
  it('9. Mid-transfer failure aborts staging', async () => {
    let abortCalled = false;
    nativePlaybackBridge.isTrackDownloadedNatively = async () => false;
    nativePlaybackBridge.beginDownloadChunked = async (opts) => ({
      success: true,
      trackId: opts.trackId,
      nextExpectedChunkIndex: 0,
    });
    nativePlaybackBridge.writeDownloadChunk = async (opts) => {
      if (opts.chunkIndex === 1) {
        return {
          success: false,
          trackId: opts.trackId,
          acceptedChunkIndex: -1,
          nextExpectedChunkIndex: 1,
          bytesWritten: 0,
          error: 'Disk I/O error',
        };
      }
      return {
        success: true,
        trackId: opts.trackId,
        acceptedChunkIndex: opts.chunkIndex,
        nextExpectedChunkIndex: opts.chunkIndex + 1,
        bytesWritten: 256 * 1024,
      };
    };
    nativePlaybackBridge.abortDownloadChunked = async (trackId) => {
      abortCalled = true;
      return { success: true, trackId };
    };

    globalThis.fetch = async () => new Response(createMockStream([new Uint8Array(600 * 1024)]), {
      status: 200,
      headers: { 'content-type': 'audio/mpeg', 'content-length': (600 * 1024).toString() },
    });

    const track = createSampleTrack('test-track-9');
    await assert.rejects(async () => {
      await downloadService.downloadTrack(track);
    });

    assert.equal(abortCalled, true, 'Must call abort on mid-transfer failure');
  });

  // 10. Cancellation aborts staging
  it('10. Cancellation aborts staging', async () => {
    let abortCalled = false;
    nativePlaybackBridge.isTrackDownloadedNatively = async () => false;
    nativePlaybackBridge.beginDownloadChunked = async (opts) => ({
      success: true,
      trackId: opts.trackId,
      nextExpectedChunkIndex: 0,
    });
    nativePlaybackBridge.writeDownloadChunk = async (opts) => {
      downloadService.cancelDownload('test-track-10');
      return {
        success: true,
        trackId: opts.trackId,
        acceptedChunkIndex: opts.chunkIndex,
        nextExpectedChunkIndex: opts.chunkIndex + 1,
        bytesWritten: 256 * 1024,
      };
    };
    nativePlaybackBridge.abortDownloadChunked = async (trackId) => {
      abortCalled = true;
      return { success: true, trackId };
    };

    globalThis.fetch = async () => new Response(createMockStream([new Uint8Array(600 * 1024)]), {
      status: 200,
      headers: { 'content-type': 'audio/mpeg', 'content-length': (600 * 1024).toString() },
    });

    const track = createSampleTrack('test-track-10');
    await assert.rejects(async () => {
      await downloadService.downloadTrack(track);
    }, /cancelled/i);

    assert.equal(abortCalled, true);
  });

  // 11. Existing IndexedDB record is never deleted
  it('11. Existing IndexedDB record is never deleted', async () => {
    const existingRec: StoredAudioRecord = {
      id: 'existing-idb-track',
      track: createSampleTrack('existing-idb-track'),
      blob: new Blob([new Uint8Array(20000)]),
      fileSize: 20000,
    };
    inMemoryIndexedDB.set('existing-idb-track', existingRec);

    // Run native download on a different track
    nativePlaybackBridge.isTrackDownloadedNatively = async () => false;
    nativePlaybackBridge.beginDownloadChunked = async (opts) => ({
      success: true,
      trackId: opts.trackId,
      nextExpectedChunkIndex: 0,
    });
    nativePlaybackBridge.writeDownloadChunk = async (opts) => ({
      success: true,
      trackId: opts.trackId,
      acceptedChunkIndex: 0,
      nextExpectedChunkIndex: 1,
      bytesWritten: 15000,
    });
    nativePlaybackBridge.commitDownloadChunked = async (opts) => {
      nativePlaybackBridge.isTrackDownloadedNatively = async () => true;
      return { success: true, trackId: opts.trackId };
    };

    globalThis.fetch = async () => new Response(createMockStream([new Uint8Array(15000)]), {
      status: 200,
      headers: { 'content-type': 'audio/mpeg', 'content-length': '15000' },
    });

    await downloadService.downloadTrack(createSampleTrack('new-native-track'));
    assert.equal(inMemoryIndexedDB.has('existing-idb-track'), true, 'Existing IndexedDB record must remain intact');
  });

  // 12. Metadata is preserved
  it('12. Metadata is preserved', async () => {
    let committedMetadata: any = null;
    nativePlaybackBridge.isTrackDownloadedNatively = async () => false;
    nativePlaybackBridge.beginDownloadChunked = async (opts) => ({
      success: true,
      trackId: opts.trackId,
      nextExpectedChunkIndex: 0,
    });
    nativePlaybackBridge.writeDownloadChunk = async (opts) => ({
      success: true,
      trackId: opts.trackId,
      acceptedChunkIndex: 0,
      nextExpectedChunkIndex: 1,
      bytesWritten: 15000,
    });
    nativePlaybackBridge.commitDownloadChunked = async (opts) => {
      committedMetadata = opts.metadata;
      nativePlaybackBridge.isTrackDownloadedNatively = async () => true;
      return { success: true, trackId: opts.trackId, localFilePath: '/path/song.mp3', fileSize: 15000 };
    };

    globalThis.fetch = async () => new Response(createMockStream([new Uint8Array(15000)]), {
      status: 200,
      headers: { 'content-type': 'audio/mpeg', 'content-length': '15000' },
    });

    const track = createSampleTrack('test-track-12', {
      title: 'Preserved Title',
      artistName: 'Preserved Artist',
      albumTitle: 'Preserved Album',
      duration: 180,
    });

    await downloadService.downloadTrack(track);

    assert.ok(committedMetadata);
    assert.equal(committedMetadata.title, 'Preserved Title');
    assert.equal(committedMetadata.artist, 'Preserved Artist');
    assert.equal(committedMetadata.album, 'Preserved Album');
    assert.equal(committedMetadata.durationMs, 180000);
  });

  // 13. Duplicate native download does not overwrite existing file
  it('13. Duplicate native download does not overwrite existing file', async () => {
    let writeCalled = false;
    nativePlaybackBridge.isTrackDownloadedNatively = async () => true;
    nativePlaybackBridge.writeDownloadChunk = async () => {
      writeCalled = true;
      return { success: true, trackId: 'test-track-13', acceptedChunkIndex: 0, nextExpectedChunkIndex: 1, bytesWritten: 0 };
    };

    const track = createSampleTrack('test-track-13');
    await downloadService.downloadTrack(track);

    assert.equal(writeCalled, false, 'Should not write chunks for existing native download');
  });

  // 14. Full-length/preview validation is preserved
  it('14. Full-length/preview validation is preserved', () => {
    const itunesPreview = createSampleTrack('itunes-1', {
      provider: 'itunes',
      audioUrl: 'https://audio-ssl.itunes.apple.com/preview.m4a',
      duration: 30,
    });
    const res1 = validateDownloadSource(itunesPreview, itunesPreview.audioUrl);
    assert.equal(res1.isValid, false);

    const soundcloudTrack = createSampleTrack('sc-1', {
      provider: 'soundcloud' as any,
      audioUrl: 'https://api.soundcloud.com/stream',
    });
    const res2 = validateDownloadSource(soundcloudTrack, soundcloudTrack.audioUrl);
    assert.equal(res2.isValid, false);

    const legitimateShortTrack = createSampleTrack('short-interlude', {
      title: 'Interlude',
      audioUrl: 'https://c.saavncdn.com/stream.mp4',
      duration: 25, // 25s short song, not preview
    });
    const res3 = validateDownloadSource(legitimateShortTrack, legitimateShortTrack.audioUrl);
    assert.equal(res3.isValid, true, 'Legitimate short song without preview tag must be allowed');
  });

  // 15. Download progress does not create an uncontrolled render loop
  it('15. Download progress does not create an uncontrolled render loop', async () => {
    const progressUpdates: number[] = [];
    const unsubscribe = downloadService.subscribe((p) => {
      if (p.trackId === 'test-track-15') {
        progressUpdates.push(p.percent);
      }
    });

    nativePlaybackBridge.isTrackDownloadedNatively = async () => false;
    nativePlaybackBridge.beginDownloadChunked = async (opts) => ({
      success: true,
      trackId: opts.trackId,
      nextExpectedChunkIndex: 0,
    });
    nativePlaybackBridge.writeDownloadChunk = async (opts) => ({
      success: true,
      trackId: opts.trackId,
      acceptedChunkIndex: opts.chunkIndex,
      nextExpectedChunkIndex: opts.chunkIndex + 1,
      bytesWritten: 256 * 1024,
    });
    nativePlaybackBridge.commitDownloadChunked = async (opts) => {
      nativePlaybackBridge.isTrackDownloadedNatively = async () => true;
      return { success: true, trackId: opts.trackId };
    };

    globalThis.fetch = async () => new Response(createMockStream([new Uint8Array(600 * 1024)]), {
      status: 200,
      headers: { 'content-type': 'audio/mpeg', 'content-length': (600 * 1024).toString() },
    });

    const track = createSampleTrack('test-track-15');
    await downloadService.downloadTrack(track);
    unsubscribe();

    // Updates should be bounded (start, chunk updates, completion)
    assert.ok(progressUpdates.length <= 10, 'Progress updates must remain bounded');
    assert.equal(progressUpdates[progressUpdates.length - 1], 100);
  });

  // 16. Multiple downloads do not interleave native chunk transactions
  it('16. Multiple downloads do not interleave native chunk transactions', async () => {
    const events: string[] = [];
    nativePlaybackBridge.isTrackDownloadedNatively = async () => false;
    nativePlaybackBridge.beginDownloadChunked = async (opts) => {
      events.push(`begin:${opts.trackId}`);
      return { success: true, trackId: opts.trackId, nextExpectedChunkIndex: 0 };
    };
    nativePlaybackBridge.writeDownloadChunk = async (opts) => {
      events.push(`chunk:${opts.trackId}:${opts.chunkIndex}`);
      return {
        success: true,
        trackId: opts.trackId,
        acceptedChunkIndex: opts.chunkIndex,
        nextExpectedChunkIndex: opts.chunkIndex + 1,
        bytesWritten: 15000,
      };
    };
    nativePlaybackBridge.commitDownloadChunked = async (opts) => {
      events.push(`commit:${opts.trackId}`);
      nativePlaybackBridge.isTrackDownloadedNatively = async (id) => id === opts.trackId;
      return { success: true, trackId: opts.trackId };
    };

    globalThis.fetch = async () => new Response(createMockStream([new Uint8Array(15000)]), {
      status: 200,
      headers: { 'content-type': 'audio/mpeg', 'content-length': '15000' },
    });

    await downloadService.downloadTrack(createSampleTrack('track-A'));
    await downloadService.downloadTrack(createSampleTrack('track-B'));

    assert.deepEqual(events, [
      'begin:track-A',
      'chunk:track-A:0',
      'commit:track-A',
      'begin:track-B',
      'chunk:track-B:0',
      'commit:track-B',
    ]);
  });

  // 17. Native download completion is correctly reflected in existing download state
  it('17. Native download completion is correctly reflected in existing download state', async () => {
    nativePlaybackBridge.isTrackDownloadedNatively = async () => false;
    nativePlaybackBridge.beginDownloadChunked = async (opts) => ({
      success: true,
      trackId: opts.trackId,
      nextExpectedChunkIndex: 0,
    });
    nativePlaybackBridge.writeDownloadChunk = async (opts) => ({
      success: true,
      trackId: opts.trackId,
      acceptedChunkIndex: 0,
      nextExpectedChunkIndex: 1,
      bytesWritten: 20000,
    });
    nativePlaybackBridge.commitDownloadChunked = async (opts) => {
      nativePlaybackBridge.isTrackDownloadedNatively = async () => true;
      return { success: true, trackId: opts.trackId, localFilePath: '/data/song17.mp3' };
    };

    globalThis.fetch = async () => new Response(createMockStream([new Uint8Array(20000)]), {
      status: 200,
      headers: { 'content-type': 'audio/mpeg', 'content-length': '20000' },
    });

    const track = createSampleTrack('test-track-17');
    await downloadService.downloadTrack(track);

    assert.equal(downloadService.getStatus('test-track-17'), 'downloaded');
    assert.equal(downloadService.isTrackDownloaded('test-track-17'), true);
    assert.equal(downloadService.getProgress('test-track-17'), 100);
  });

  // 18. Native download remains discoverable through existing native-first resolution
  it('18. Native download remains discoverable through existing native-first resolution', async () => {
    nativePlaybackBridge.isTrackDownloadedNatively = async (id) => id === 'test-track-18';
    const status = await downloadService.getActualDownloadStatus('test-track-18');
    assert.equal(status, 'downloaded');
  });

  // 19. Native initialization failure falls back to IndexedDB
  it('19. Native initialization failure falls back to IndexedDB', async () => {
    nativePlaybackController.isEnabled = () => true;
    nativePlaybackBridge.isAvailable = () => true;

    // beginDownloadChunked fails before transfer begins
    nativePlaybackBridge.beginDownloadChunked = async () => {
      return { success: false, trackId: 'test-track-19', nextExpectedChunkIndex: 0, error: 'Staging init error' };
    };

    globalThis.fetch = async () => new Response(createMockStream([new Uint8Array(20000)]), {
      status: 200,
      headers: { 'content-type': 'audio/mpeg', 'content-length': '20000' },
    });

    const track = createSampleTrack('test-track-19');
    await downloadService.downloadTrack(track);

    assert.equal(inMemoryIndexedDB.has('test-track-19'), true, 'Should fall back to IndexedDB on Case A init failure');
  });

  // 20. Native mid-transfer failure NEVER silently falls back to IndexedDB
  it('20. Native mid-transfer failure NEVER silently falls back to IndexedDB', async () => {
    nativePlaybackController.isEnabled = () => true;
    nativePlaybackBridge.isAvailable = () => true;

    nativePlaybackBridge.beginDownloadChunked = async (opts) => ({
      success: true,
      trackId: opts.trackId,
      nextExpectedChunkIndex: 0,
    });
    nativePlaybackBridge.writeDownloadChunk = async () => {
      throw new Error('Mid-transfer write error');
    };
    nativePlaybackBridge.abortDownloadChunked = async (trackId) => ({ success: true, trackId });

    globalThis.fetch = async () => new Response(createMockStream([new Uint8Array(30000)]), {
      status: 200,
      headers: { 'content-type': 'audio/mpeg', 'content-length': '30000' },
    });

    const track = createSampleTrack('test-track-20');
    await assert.rejects(async () => {
      await downloadService.downloadTrack(track);
    });

    assert.equal(inMemoryIndexedDB.has('test-track-20'), false, 'Case B failure must NEVER fall back to IndexedDB');
  });

  // 21. Native commit failure aborts staging
  it('21. Native commit failure aborts staging', async () => {
    let abortCalled = false;
    nativePlaybackBridge.beginDownloadChunked = async (opts) => ({
      success: true,
      trackId: opts.trackId,
      nextExpectedChunkIndex: 0,
    });
    nativePlaybackBridge.writeDownloadChunk = async (opts) => ({
      success: true,
      trackId: opts.trackId,
      acceptedChunkIndex: 0,
      nextExpectedChunkIndex: 1,
      bytesWritten: 15000,
    });
    nativePlaybackBridge.commitDownloadChunked = async () => ({
      success: false,
      trackId: 'test-track-21',
      error: 'Room SQLite error',
    });
    nativePlaybackBridge.abortDownloadChunked = async (trackId) => {
      abortCalled = true;
      return { success: true, trackId };
    };

    globalThis.fetch = async () => new Response(createMockStream([new Uint8Array(15000)]), {
      status: 200,
      headers: { 'content-type': 'audio/mpeg', 'content-length': '15000' },
    });

    const track = createSampleTrack('test-track-21');
    await assert.rejects(async () => {
      await downloadService.downloadTrack(track);
    });

    assert.equal(abortCalled, true);
  });

  // 22. Native verification failure reports failure
  it('22. Native verification failure reports failure', async () => {
    nativePlaybackBridge.beginDownloadChunked = async (opts) => ({
      success: true,
      trackId: opts.trackId,
      nextExpectedChunkIndex: 0,
    });
    nativePlaybackBridge.writeDownloadChunk = async (opts) => ({
      success: true,
      trackId: opts.trackId,
      acceptedChunkIndex: 0,
      nextExpectedChunkIndex: 1,
      bytesWritten: 15000,
    });
    nativePlaybackBridge.commitDownloadChunked = async (opts) => ({
      success: true,
      trackId: opts.trackId,
    });
    nativePlaybackBridge.isTrackDownloadedNatively = async () => false;

    globalThis.fetch = async () => new Response(createMockStream([new Uint8Array(15000)]), {
      status: 200,
      headers: { 'content-type': 'audio/mpeg', 'content-length': '15000' },
    });

    const track = createSampleTrack('test-track-22');
    await assert.rejects(async () => {
      await downloadService.downloadTrack(track);
    });

    assert.equal(downloadService.getStatus('test-track-22'), 'failed');
  });

  // 23. Reader chunks larger than 256 KB are safely bounded before native append
  it('23. Reader chunks larger than 256 KB are safely bounded before native append', async () => {
    // Return a single giant chunk of 550 KB from reader
    const giantChunk = new Uint8Array(550 * 1024);
    const sentChunkSizes: number[] = [];

    nativePlaybackBridge.isTrackDownloadedNatively = async () => false;
    nativePlaybackBridge.beginDownloadChunked = async (opts) => ({
      success: true,
      trackId: opts.trackId,
      nextExpectedChunkIndex: 0,
    });
    nativePlaybackBridge.writeDownloadChunk = async (opts) => {
      const decodedSize = atob(opts.chunkData).length;
      sentChunkSizes.push(decodedSize);
      return {
        success: true,
        trackId: opts.trackId,
        acceptedChunkIndex: opts.chunkIndex,
        nextExpectedChunkIndex: opts.chunkIndex + 1,
        bytesWritten: decodedSize,
      };
    };
    nativePlaybackBridge.commitDownloadChunked = async (opts) => {
      nativePlaybackBridge.isTrackDownloadedNatively = async () => true;
      return { success: true, trackId: opts.trackId };
    };

    globalThis.fetch = async () => new Response(createMockStream([giantChunk]), {
      status: 200,
      headers: { 'content-type': 'audio/mpeg', 'content-length': (550 * 1024).toString() },
    });

    const track = createSampleTrack('test-track-23');
    await downloadService.downloadTrack(track);

    // Should be split into 256KB, 256KB, 38KB
    assert.equal(sentChunkSizes.length, 3);
    assert.equal(sentChunkSizes[0], 256 * 1024);
    assert.equal(sentChunkSizes[1], 256 * 1024);
    assert.equal(sentChunkSizes[2], 38 * 1024);
  });

  // 24. Concurrent same-track downloads cannot overlap
  it('24. Concurrent same-track downloads cannot overlap', async () => {
    let beginCalls = 0;
    nativePlaybackBridge.isTrackDownloadedNatively = async () => false;
    nativePlaybackBridge.beginDownloadChunked = async (opts) => {
      beginCalls++;
      await new Promise((r) => setTimeout(r, 40));
      return { success: true, trackId: opts.trackId, nextExpectedChunkIndex: 0 };
    };
    nativePlaybackBridge.writeDownloadChunk = async (opts) => ({
      success: true,
      trackId: opts.trackId,
      acceptedChunkIndex: 0,
      nextExpectedChunkIndex: 1,
      bytesWritten: 15000,
    });
    nativePlaybackBridge.commitDownloadChunked = async (opts) => {
      nativePlaybackBridge.isTrackDownloadedNatively = async () => true;
      return { success: true, trackId: opts.trackId };
    };

    globalThis.fetch = async () => new Response(createMockStream([new Uint8Array(15000)]), {
      status: 200,
      headers: { 'content-type': 'audio/mpeg', 'content-length': '15000' },
    });

    const track = createSampleTrack('test-track-24');
    const p1 = downloadService.downloadTrack(track);
    const p2 = downloadService.downloadTrack(track);

    await Promise.all([p1, p2]);
    assert.equal(beginCalls, 1, 'Concurrent same-track download should be deduplicated');
  });

  // 25. removeDownload does not falsely report success when native deletion fails
  it('25. removeDownload does not falsely report success when native deletion fails', async () => {
    nativePlaybackBridge.isTrackDownloadedNatively = async () => true;
    nativePlaybackBridge.removeNativeDownload = async () => ({
      success: false,
      trackId: 'test-track-25',
      error: 'Permission denied on disk file',
    });

    await assert.rejects(async () => {
      await downloadService.removeDownload('test-track-25');
    }, /Failed to remove native download/i);

    assert.equal(downloadService.getStatus('test-track-25'), 'failed');
  });

  // 26. Native deletion removes the native file and Room record
  it('26. Native deletion removes the native file and Room record', async () => {
    let removedTrackId = '';
    nativePlaybackBridge.isTrackDownloadedNatively = async () => true;
    nativePlaybackBridge.removeNativeDownload = async (trackId) => {
      removedTrackId = trackId;
      return { success: true, trackId };
    };

    await downloadService.removeDownload('test-track-26');
    assert.equal(removedTrackId, 'test-track-26');
    assert.equal(downloadService.getStatus('test-track-26'), 'not_downloaded');
  });

  // 27. Existing IndexedDB data remains untouched by native download
  it('27. Existing IndexedDB data remains untouched by native download', async () => {
    const idbRecord: StoredAudioRecord = {
      id: 'idb-saved-track',
      track: createSampleTrack('idb-saved-track'),
      blob: new Blob([new Uint8Array(25000)]),
      fileSize: 25000,
    };
    inMemoryIndexedDB.set('idb-saved-track', idbRecord);

    nativePlaybackBridge.isTrackDownloadedNatively = async () => false;
    nativePlaybackBridge.beginDownloadChunked = async (opts) => ({
      success: true,
      trackId: opts.trackId,
      nextExpectedChunkIndex: 0,
    });
    nativePlaybackBridge.writeDownloadChunk = async (opts) => ({
      success: true,
      trackId: opts.trackId,
      acceptedChunkIndex: 0,
      nextExpectedChunkIndex: 1,
      bytesWritten: 15000,
    });
    nativePlaybackBridge.commitDownloadChunked = async (opts) => {
      nativePlaybackBridge.isTrackDownloadedNatively = async () => true;
      return { success: true, trackId: opts.trackId };
    };

    globalThis.fetch = async () => new Response(createMockStream([new Uint8Array(15000)]), {
      status: 200,
      headers: { 'content-type': 'audio/mpeg', 'content-length': '15000' },
    });

    await downloadService.downloadTrack(createSampleTrack('native-track-27'));

    assert.equal(inMemoryIndexedDB.get('idb-saved-track')?.fileSize, 25000);
  });

  // 28. Native download completion only occurs after verification
  it('28. Native download completion only occurs after verification', async () => {
    let verifiedBeforeDone = false;
    nativePlaybackBridge.isTrackDownloadedNatively = async () => false;
    nativePlaybackBridge.beginDownloadChunked = async (opts) => ({
      success: true,
      trackId: opts.trackId,
      nextExpectedChunkIndex: 0,
    });
    nativePlaybackBridge.writeDownloadChunk = async (opts) => ({
      success: true,
      trackId: opts.trackId,
      acceptedChunkIndex: 0,
      nextExpectedChunkIndex: 1,
      bytesWritten: 15000,
    });
    nativePlaybackBridge.commitDownloadChunked = async (opts) => ({
      success: true,
      trackId: opts.trackId,
    });

    // Verification step
    let checkCount = 0;
    nativePlaybackBridge.isTrackDownloadedNatively = async (_trackId) => {
      checkCount++;
      if (checkCount > 1) {
        verifiedBeforeDone = true;
        return true;
      }
      return false;
    };

    globalThis.fetch = async () => new Response(createMockStream([new Uint8Array(15000)]), {
      status: 200,
      headers: { 'content-type': 'audio/mpeg', 'content-length': '15000' },
    });

    const track = createSampleTrack('test-track-28');
    await downloadService.downloadTrack(track);

    assert.equal(verifiedBeforeDone, true);
    assert.equal(downloadService.getStatus('test-track-28'), 'downloaded');
  });
});
