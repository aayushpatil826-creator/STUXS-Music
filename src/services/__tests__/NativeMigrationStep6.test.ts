import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  NativeMigrationService,
  MAX_BINARY_CHUNK_SIZE,
} from '../NativeMigrationService.ts';
import { storageService, type StoredAudioRecord } from '../StorageService.ts';
import { nativePlaybackBridge } from '../nativePlaybackBridge.ts';
import { downloadService } from '../DownloadService.ts';

describe('Phase 6 Step 6: IndexedDB -> Native Storage Migration (Scenarios A - O)', () => {
  let migrationService: NativeMigrationService;

  beforeEach(() => {
    migrationService = new NativeMigrationService();
    nativePlaybackBridge.isAvailable = () => true;
  });

  // Scenario A: Startup discovery finds valid IndexedDB tracks
  it('Scenario A: Startup discovery finds valid IndexedDB tracks', async () => {
    const validTrack: StoredAudioRecord = {
      id: 'step6-track-a',
      track: { id: 'step6-track-a', title: 'Song A', artistName: 'Artist A', duration: 200, provider: 'jiosaavn' } as any,
      blob: new Blob([new Uint8Array(25000)], { type: 'audio/mpeg' }),
      fileSize: 25000,
    };

    storageService.getAllDownloadedTracks = async () => [validTrack];
    nativePlaybackBridge.isTrackDownloadedNatively = async () => false;

    const candidates = await migrationService.getMigrationCandidates();
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].id, 'step6-track-a');
  });

  // Scenario B: Non-destructive migration leaves original IndexedDB record intact
  it('Scenario B: Non-destructive migration leaves original IndexedDB record intact', async () => {
    const rawBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, ...new Array(15000).fill(42)]);
    const testBlob = new Blob([rawBytes], { type: 'audio/mpeg' });
    const originalRecord: StoredAudioRecord = {
      id: 'step6-track-b',
      track: { id: 'step6-track-b', title: 'Song B', duration: 180, provider: 'jiosaavn' } as any,
      blob: testBlob,
      fileSize: rawBytes.length,
    };

    let deleteCalled = false;
    storageService.deleteDownloadedTrack = async () => {
      deleteCalled = true;
    };

    let beginCalled = false;
    let commitCalled = false;
    nativePlaybackBridge.beginDownloadChunked = async () => {
      beginCalled = true;
      return { success: true, trackId: 'step6-track-b', nextExpectedChunkIndex: 0 };
    };
    let isNativelyDone = false;
    nativePlaybackBridge.isTrackDownloadedNatively = async () => isNativelyDone;
    nativePlaybackBridge.writeDownloadChunk = (async () => ({ success: true, chunkIndex: 0, bytesWritten: rawBytes.length })) as any;
    nativePlaybackBridge.commitDownloadChunked = async () => {
      commitCalled = true;
      isNativelyDone = true;
      return { success: true, trackId: 'step6-track-b', fileSize: rawBytes.length, localFilePath: '/data/user/0/com.stuxs.music/files/native_downloads/step6-track-b.mp3' };
    };

    const res = await migrationService.migrateTrack(originalRecord);
    assert.equal(res.success, true);
    assert.equal(beginCalled, true);
    assert.equal(commitCalled, true);
    assert.equal(deleteCalled, false, 'IndexedDB record must NEVER be deleted during migration');
    assert.equal(originalRecord.blob.size, rawBytes.length, 'Original IndexedDB Blob must remain intact');
  });

  // Scenario C: Native copy verified in Room + disk before considering migrated
  it('Scenario C: Native copy verified in Room + disk before considering migrated', async () => {
    const record: StoredAudioRecord = {
      id: 'step6-track-c',
      track: { id: 'step6-track-c', title: 'Song C', duration: 120, provider: 'jiosaavn' } as any,
      blob: new Blob([new Uint8Array(15000)], { type: 'audio/mpeg' }),
      fileSize: 15000,
    };

    let abortCalled = false;

    nativePlaybackBridge.beginDownloadChunked = async () => ({ success: true, trackId: 'step6-track-c', nextExpectedChunkIndex: 0 });
    nativePlaybackBridge.writeDownloadChunk = (async () => ({ success: true, chunkIndex: 0, bytesWritten: 15000 })) as any;
    nativePlaybackBridge.commitDownloadChunked = async () => ({ success: true, trackId: 'step6-track-c', fileSize: 15000, localFilePath: '/path/to/c.mp3' });
    nativePlaybackBridge.abortDownloadChunked = (async () => {
      abortCalled = true;
      return { success: true, trackId: 'step6-track-c' };
    }) as any;
    nativePlaybackBridge.isTrackDownloadedNatively = async () => {
      // Return false on verification check to simulate disk/Room verification failure
      return false;
    };

    const res = await migrationService.migrateTrack(record);
    assert.equal(res.success, false);
    assert.equal(res.failed, true);
    assert.equal(abortCalled, true, 'Must abort if native verification fails');
    assert.match(res.error || '', /verification failed/i);
  });

  // Scenario D: Bounded chunk streaming (<= 256 KB)
  it('Scenario D: Bounded chunk streaming (<= 256 KB)', async () => {
    const largeSize = MAX_BINARY_CHUNK_SIZE * 2 + 10000;
    const record: StoredAudioRecord = {
      id: 'step6-track-d',
      track: { id: 'step6-track-d', title: 'Large Song', duration: 300, provider: 'jiosaavn' } as any,
      blob: new Blob([new Uint8Array(largeSize)], { type: 'audio/mpeg' }),
      fileSize: largeSize,
    };

    let isDone = false;
    nativePlaybackBridge.isTrackDownloadedNatively = async () => isDone;
    nativePlaybackBridge.commitDownloadChunked = async () => {
      isDone = true;
      return { success: true, trackId: 'step6-track-d', fileSize: largeSize, localFilePath: '/path/d.mp3' };
    };

    const chunkSizes: number[] = [];
    nativePlaybackBridge.beginDownloadChunked = async () => ({ success: true, trackId: 'step6-track-d', nextExpectedChunkIndex: 0 });
    nativePlaybackBridge.writeDownloadChunk = (async (opts: any) => {
      // Decode Base64 chunk length to ensure it never exceeds MAX_BINARY_CHUNK_SIZE
      const byteLen = atob(opts.chunkData).length;
      chunkSizes.push(byteLen);
      assert.ok(byteLen <= MAX_BINARY_CHUNK_SIZE, `Chunk size ${byteLen} exceeded MAX_BINARY_CHUNK_SIZE`);
      return { success: true, chunkIndex: opts.chunkIndex, bytesWritten: byteLen };
    }) as any;

    const res = await migrationService.migrateTrack(record);
    assert.equal(res.success, true);
    assert.equal(chunkSizes.length, 3, 'Expected exactly 3 chunks for ~522 KB');
    assert.equal(chunkSizes[0], MAX_BINARY_CHUNK_SIZE);
    assert.equal(chunkSizes[1], MAX_BINARY_CHUNK_SIZE);
    assert.equal(chunkSizes[2], 10000);
    assert.equal(res.bytesTransferred, largeSize);
  });

  // Scenario E: Migration skips already natively migrated tracks (idempotency)
  it('Scenario E: Migration skips already natively migrated tracks (idempotency)', async () => {
    const record: StoredAudioRecord = {
      id: 'step6-track-e',
      track: { id: 'step6-track-e', title: 'Already Migrated', duration: 180, provider: 'jiosaavn' } as any,
      blob: new Blob([new Uint8Array(20000)], { type: 'audio/mpeg' }),
      fileSize: 20000,
    };

    let chunkWrites = 0;
    nativePlaybackBridge.isTrackDownloadedNatively = async () => true;
    nativePlaybackBridge.writeDownloadChunk = (async () => {
      chunkWrites++;
      return { success: true, chunkIndex: 0, bytesWritten: 0 };
    }) as any;

    const res = await migrationService.migrateTrack(record);
    assert.equal(res.success, true);
    assert.equal(res.skipped, true);
    assert.equal(res.alreadyNative, true);
    assert.equal(chunkWrites, 0, 'No chunks should be written for already-native tracks');
  });

  // Scenario F: Corrupted/zero-byte or <10 KB IndexedDB records are safely skipped
  it('Scenario F: Corrupted/zero-byte or <10 KB IndexedDB records are safely skipped', async () => {
    const smallRecord: StoredAudioRecord = {
      id: 'step6-track-f',
      track: { id: 'step6-track-f', title: 'Small Corrupted', duration: 50, provider: 'jiosaavn' } as any,
      blob: new Blob([new Uint8Array(500)], { type: 'audio/mpeg' }), // 500 bytes < 10 KB
      fileSize: 500,
    };

    let sessionStarted = false;
    nativePlaybackBridge.beginDownloadChunked = async () => {
      sessionStarted = true;
      return { success: true, trackId: 'step6-track-f', nextExpectedChunkIndex: 0 };
    };

    const res = await migrationService.migrateTrack(smallRecord);
    assert.equal(res.success, false);
    assert.equal(res.skipped, true);
    assert.equal(res.failed, false);
    assert.equal(sessionStarted, false, 'Should not start native session for <10KB record');
  });

  // Scenario G: Playback gating pauses migration immediately when playback starts
  it('Scenario G: Playback gating pauses migration immediately when playback starts', async () => {
    const record: StoredAudioRecord = {
      id: 'step6-track-g',
      track: { id: 'step6-track-g', title: 'Gated Track', duration: 200, provider: 'jiosaavn' } as any,
      blob: new Blob([new Uint8Array(MAX_BINARY_CHUNK_SIZE * 2)], { type: 'audio/mpeg' }),
      fileSize: MAX_BINARY_CHUNK_SIZE * 2,
    };

    let pausedStateObserved = false;
    let isDone = false;
    nativePlaybackBridge.isTrackDownloadedNatively = async () => isDone;
    nativePlaybackBridge.beginDownloadChunked = async () => ({ success: true, trackId: 'step6-track-g', nextExpectedChunkIndex: 0 });
    nativePlaybackBridge.commitDownloadChunked = async () => {
      isDone = true;
      return { success: true, trackId: 'step6-track-g', fileSize: MAX_BINARY_CHUNK_SIZE * 2, localFilePath: '/path/g.mp3' };
    };

    nativePlaybackBridge.writeDownloadChunk = (async (opts: any) => {
      if (opts.chunkIndex === 0) {
        // Playback starts mid-migration!
        migrationService.notifyPlaybackState(true);
        if (migrationService.getStatus().state === 'paused_for_playback') {
          pausedStateObserved = true;
        }
        // Resume playback after short delay
        setTimeout(() => {
          migrationService.notifyPlaybackState(false);
        }, 30);
      }
      return { success: true, chunkIndex: opts.chunkIndex, bytesWritten: MAX_BINARY_CHUNK_SIZE };
    }) as any;

    const res = await migrationService.migrateTrack(record);
    assert.equal(res.success, true);
    assert.equal(pausedStateObserved, true, 'Migration must transition to paused_for_playback when isPlaying=true');
  });

  // Scenario H: Idle grace period before resuming migration after playback stops
  it('Scenario H: Idle grace period before resuming migration after playback stops', async () => {
    migrationService.notifyPlaybackState(true);
    assert.equal(migrationService.getStatus().state, 'idle'); // Not actively running batch yet

    let resumedAfterGrace = false;

    // Start idle grace of 50ms
    migrationService.notifyPlaybackState(false, 50);

    // Immediate check: still waiting in grace window
    const idleWaitPromise = migrationService.waitForPlaybackIdle().then(() => {
      resumedAfterGrace = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(resumedAfterGrace, false, 'Should not resume before grace period expires');

    await new Promise((resolve) => setTimeout(resolve, 40));
    await idleWaitPromise;
    assert.equal(resumedAfterGrace, true, 'Resumes cleanly once grace period expires');
  });

  // Scenario I: Cancellation cleans up staging transaction
  it('Scenario I: Cancellation cleans up staging transaction and leaves state consistent', async () => {
    const record: StoredAudioRecord = {
      id: 'step6-track-i',
      track: { id: 'step6-track-i', title: 'Cancelled Track', duration: 150, provider: 'jiosaavn' } as any,
      blob: new Blob([new Uint8Array(MAX_BINARY_CHUNK_SIZE * 3)], { type: 'audio/mpeg' }),
      fileSize: MAX_BINARY_CHUNK_SIZE * 3,
    };

    let abortCalled = false;
    nativePlaybackBridge.beginDownloadChunked = async () => ({ success: true, trackId: 'step6-track-i', nextExpectedChunkIndex: 0 });
    nativePlaybackBridge.writeDownloadChunk = (async () => {
      migrationService.cancel();
      return { success: true, chunkIndex: 0, bytesWritten: MAX_BINARY_CHUNK_SIZE };
    }) as any;
    nativePlaybackBridge.abortDownloadChunked = (async () => {
      abortCalled = true;
      return { success: true, trackId: 'step6-track-i' };
    }) as any;
    nativePlaybackBridge.isTrackDownloadedNatively = async () => false;

    const res = await migrationService.migrateTrack(record);
    assert.equal(res.success, false);
    assert.equal(res.failed, true);
    assert.equal(abortCalled, true, 'Must call abortDownloadChunked when cancelled mid-stream');
  });

  // Scenario J: Source validation rejects SoundCloud, preview-only, and metadata-only candidates
  it('Scenario J: Source validation rejects SoundCloud, preview-only, and metadata-only candidates', async () => {
    const soundcloudTrack: StoredAudioRecord = {
      id: 'soundcloud-123',
      track: { id: 'soundcloud-123', title: 'SC Track', duration: 180, provider: 'soundcloud', audioUrl: 'blob://sc' } as any,
      blob: new Blob([new Uint8Array(20000)], { type: 'audio/mpeg' }),
      fileSize: 20000,
    };
    const previewTrack: StoredAudioRecord = {
      id: 'preview-itunes-123',
      track: { id: 'preview-itunes-123', title: 'Preview Song', duration: 30, provider: 'itunes', audioUrl: 'https://audio-ssl.itunes.apple.com/preview.m4a' } as any,
      blob: new Blob([new Uint8Array(20000)], { type: 'audio/mp4' }),
      fileSize: 20000,
    };

    storageService.getAllDownloadedTracks = async () => [soundcloudTrack, previewTrack];
    nativePlaybackBridge.isTrackDownloadedNatively = async () => false;

    const candidates = await migrationService.getMigrationCandidates();
    assert.equal(candidates.length, 0, 'SoundCloud and iTunes preview tracks must be excluded from candidates');

    const scResult = await migrationService.migrateTrack(soundcloudTrack);
    assert.equal(scResult.success, false);
    assert.equal(scResult.skipped, true);
    assert.match(scResult.error || '', /SoundCloud/i);

    const prevResult = await migrationService.migrateTrack(previewTrack);
    assert.equal(prevResult.success, false);
    assert.equal(prevResult.skipped, true);
    assert.match(prevResult.error || '', /preview/i);
  });

  // Scenario K: Single-flight concurrency guard prevents duplicate migration runs
  it('Scenario K: Single-flight concurrency guard prevents duplicate migration runs', async () => {
    storageService.getAllDownloadedTracks = async () => [];
    nativePlaybackBridge.isAvailable = () => true;

    const p1 = migrationService.migrateAll();
    const p2 = migrationService.migrateAll();
    const p3 = migrationService.startMigration();

    assert.equal(p1, p2, 'Concurrent migrateAll() calls must return the identical promise');
    assert.equal(p1, p3, 'startMigration() must return the same active promise');
    await p1;
  });

  // Scenario L: DownloadService prioritizes verified native file copy over IndexedDB blob
  it('Scenario L: DownloadService prioritizes verified native file copy over IndexedDB blob', async () => {
    const trackId = 'step6-track-l';
    const localNativePath = '/data/user/0/com.stuxs.music/files/native_downloads/step6-track-l.mp3';

    // Mock native bridge reporting track is native
    nativePlaybackBridge.isTrackDownloadedNatively = async (id) => id === trackId;
    nativePlaybackBridge.getNativeDownloadedTracks = async () => [
      {
        id: trackId,
        title: 'Native Priority Song',
        artist: 'Native Artist',
        localFilePath: localNativePath,
        fileSize: 45000,
        durationMs: 180000,
        provider: 'jiosaavn',
      },
    ];

    // Mock storageService having the old IndexedDB blob
    storageService.getDownloadedTrack = async () => ({
      id: trackId,
      track: { id: trackId, title: 'Old IndexedDB Song', audioUrl: 'blob:indexeddb-url' } as any,
      blob: new Blob([new Uint8Array(45000)], { type: 'audio/mpeg' }),
      fileSize: 45000,
    });

    const resolved = await downloadService.resolvePlayableDownloadedTrack(trackId);
    assert.ok(resolved, 'Track must resolve');
    assert.equal(resolved?.audioUrl, `file://${localNativePath}`, 'Must prioritize native file:// URI over blob: URL');
  });

  // Scenario M: Offline resolution falls back to IndexedDB blob if native copy is absent
  it('Scenario M: Offline resolution falls back to IndexedDB blob if native copy is absent', async () => {
    const trackId = 'step6-track-m';

    // Native bridge reports track is NOT natively downloaded
    nativePlaybackBridge.isTrackDownloadedNatively = async () => false;
    nativePlaybackBridge.getNativeDownloadedTracks = async () => [];

    // Storage service has valid IndexedDB blob
    storageService.getDownloadedTrack = async () => ({
      id: trackId,
      track: { id: trackId, title: 'Fallback IDB Song', artistName: 'IDB Artist' } as any,
      blob: new Blob([new Uint8Array(20000)], { type: 'audio/mpeg' }),
      fileSize: 20000,
    });

    const resolved = await downloadService.resolvePlayableDownloadedTrack(trackId);
    assert.ok(resolved, 'Must resolve from IndexedDB fallback');
    assert.ok(resolved?.audioUrl?.startsWith('blob:'), 'Must return valid blob: URL from fallback');
  });

  // Scenario N: Re-running migration produces 0 changes when all tracks already migrated
  it('Scenario N: Re-running migration produces 0 changes when all tracks already migrated', async () => {
    const alreadyMigrated: StoredAudioRecord = {
      id: 'step6-track-n',
      track: { id: 'step6-track-n', title: 'Done Song', duration: 150, provider: 'jiosaavn' } as any,
      blob: new Blob([new Uint8Array(20000)], { type: 'audio/mpeg' }),
      fileSize: 20000,
    };

    storageService.getAllDownloadedTracks = async () => [alreadyMigrated];
    nativePlaybackBridge.isTrackDownloadedNatively = async () => true;

    const summary = await migrationService.migrateAll();
    assert.equal(summary.total, 1);
    assert.equal(summary.completed, 0, 'No tracks should be re-migrated');
    assert.equal(summary.skipped, 1, 'Already migrated track is counted as skipped');
    assert.equal(summary.bytesTransferred, 0, '0 bytes transferred on re-run');
  });

  // Scenario O: Status query reporting accurate state, current track, and counts
  it('Scenario O: Status query reporting accurate state, current track, and counts', () => {
    const status = migrationService.getStatus();
    assert.equal(status.state, 'idle');
    assert.equal(status.completed, 0);
    assert.equal(status.total, 0);
    assert.equal(status.failed, 0);
    assert.equal(status.skipped, 0);
    assert.equal(status.bytesTransferred, 0);
  });
});
