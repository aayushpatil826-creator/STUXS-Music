import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  arrayBufferToBase64,
  deriveAudioExtension,
  NativeMigrationService,
  MAX_BINARY_CHUNK_SIZE,
  MIN_VALID_FILE_SIZE,
} from '../NativeMigrationService.ts';
import { storageService, type StoredAudioRecord } from '../StorageService.ts';
import { nativePlaybackBridge } from '../nativePlaybackBridge.ts';

describe('NativeMigrationService Tests', () => {
  let migrationService: NativeMigrationService;

  beforeEach(() => {
    migrationService = new NativeMigrationService();
    nativePlaybackBridge.isAvailable = () => true;
  });

  describe('Helper Functions & Encoding', () => {
    it('correctly converts small buffer to Base64', () => {
      const data = new Uint8Array([104, 101, 108, 108, 111]); // "hello"
      const base64 = arrayBufferToBase64(data.buffer);
      assert.equal(base64, btoa('hello'));
    });

    it('correctly handles zero and null bytes without corruption', () => {
      const data = new Uint8Array([0, 0, 0, 0, 1, 2, 0]);
      const base64 = arrayBufferToBase64(data.buffer);
      const decoded = atob(base64);
      assert.equal(decoded.length, 7);
      assert.equal(decoded.charCodeAt(0), 0);
      assert.equal(decoded.charCodeAt(4), 1);
      assert.equal(decoded.charCodeAt(6), 0);
    });

    it('handles buffer of exactly 256 KB without stack overflow', () => {
      const data = new Uint8Array(MAX_BINARY_CHUNK_SIZE);
      for (let i = 0; i < data.length; i++) {
        data[i] = i % 256;
      }
      const base64 = arrayBufferToBase64(data.buffer);
      assert.ok(base64.length > 0);
      assert.equal(base64.length, Math.ceil(MAX_BINARY_CHUNK_SIZE / 3) * 4);
    });

    it('derives audio extension correctly', () => {
      assert.equal(deriveAudioExtension('audio/mp4'), 'm4a');
      assert.equal(deriveAudioExtension('audio/m4a'), 'm4a');
      assert.equal(deriveAudioExtension('audio/aac'), 'm4a');
      assert.equal(deriveAudioExtension('audio/mpeg'), 'mp3');
      assert.equal(deriveAudioExtension('unknown', { audioUrl: 'https://example.com/song.m4a' } as any), 'm4a');
      assert.equal(deriveAudioExtension('unknown', { audioUrl: 'https://example.com/song.mp3' } as any), 'mp3');
      assert.equal(deriveAudioExtension(), 'mp3');
    });
  });

  describe('Step 3 Mandatory 18 Scenarios', () => {
    // 1. No candidates -> clean result
    it('1. No candidates -> clean result', async () => {
      storageService.getAllDownloadedTracks = async () => [];
      nativePlaybackBridge.isTrackDownloadedNatively = async () => false;

      const candidates = await migrationService.getMigrationCandidates();
      assert.deepEqual(candidates, []);

      const summary = await migrationService.migrateAll();
      assert.equal(summary.total, 0);
      assert.equal(summary.completed, 0);
      assert.equal(summary.migrated, 0);
      assert.equal(summary.skipped, 0);
      assert.equal(summary.failed, 0);
      assert.equal(summary.bytesTransferred, 0);
      assert.deepEqual(summary.trackResults, []);
    });

    // 2. Finds valid IndexedDB candidate
    it('2. Finds valid IndexedDB candidate', async () => {
      const validRecord: StoredAudioRecord = {
        id: 'candidate-track-1',
        track: { id: 'candidate-track-1', title: 'Song 1', duration: 180 } as any,
        blob: new Blob([new Uint8Array(MIN_VALID_FILE_SIZE + 500)], { type: 'audio/mpeg' }),
        fileSize: MIN_VALID_FILE_SIZE + 500,
      };

      storageService.getAllDownloadedTracks = async () => [validRecord];
      nativePlaybackBridge.isTrackDownloadedNatively = async () => false;

      const candidates = await migrationService.getMigrationCandidates();
      assert.equal(candidates.length, 1);
      assert.equal(candidates[0].id, 'candidate-track-1');
    });

    // 3. Skips already-native track
    it('3. Skips already-native track', async () => {
      const nativeRecord: StoredAudioRecord = {
        id: 'already-native-track',
        track: { id: 'already-native-track', title: 'Native Song', duration: 200 } as any,
        blob: new Blob([new Uint8Array(20000)], { type: 'audio/mpeg' }),
        fileSize: 20000,
      };

      storageService.getAllDownloadedTracks = async () => [nativeRecord];
      nativePlaybackBridge.isTrackDownloadedNatively = async () => true;

      // Candidate filter skips it
      const candidates = await migrationService.getMigrationCandidates();
      assert.equal(candidates.length, 0);

      // Direct single track migration skips it cleanly
      let writeCalled = false;
      nativePlaybackBridge.writeDownloadChunk = async () => {
        writeCalled = true;
        return { success: true, trackId: 'already-native-track', acceptedChunkIndex: 0, nextExpectedChunkIndex: 1, bytesWritten: 0 };
      };

      const result = await migrationService.migrateTrack(nativeRecord);
      assert.equal(result.success, true);
      assert.equal(result.skipped, true);
      assert.equal(result.alreadyNative, true);
      assert.equal(writeCalled, false);
    });

    // 4. Skips malformed record
    it('4. Skips malformed record', async () => {
      const malformed1: any = { id: '', blob: new Blob([new Uint8Array(15000)]) };
      const malformed2: any = null;
      const malformed3: any = { track: {} };

      storageService.getAllDownloadedTracks = async () => [malformed1, malformed2, malformed3];
      nativePlaybackBridge.isTrackDownloadedNatively = async () => false;

      const candidates = await migrationService.getMigrationCandidates();
      assert.equal(candidates.length, 0);

      const res1 = await migrationService.migrateTrack(malformed1);
      assert.equal(res1.success, false);
      assert.equal(res1.failed, true);
    });

    // 5. Skips missing Blob
    it('5. Skips missing Blob', async () => {
      const missingBlobRecord: any = {
        id: 'missing-blob-track',
        track: { id: 'missing-blob-track', title: 'No Blob Song' },
        blob: null,
      };

      storageService.getAllDownloadedTracks = async () => [missingBlobRecord];
      nativePlaybackBridge.isTrackDownloadedNatively = async () => false;

      const candidates = await migrationService.getMigrationCandidates();
      assert.equal(candidates.length, 0);

      const res = await migrationService.migrateTrack(missingBlobRecord);
      assert.equal(res.success, false);
      assert.equal(res.skipped, true);
      assert.equal(res.failed, false);
    });

    // 6. Rejects invalid/empty Blob
    it('6. Rejects invalid/empty Blob', async () => {
      const emptyBlobRecord: StoredAudioRecord = {
        id: 'empty-blob-track',
        track: { id: 'empty-blob-track', title: 'Empty Blob Song' } as any,
        blob: new Blob([new Uint8Array(0)]),
        fileSize: 0,
      };

      const undersizedBlobRecord: StoredAudioRecord = {
        id: 'undersized-blob-track',
        track: { id: 'undersized-blob-track', title: 'Undersized Blob Song' } as any,
        blob: new Blob([new Uint8Array(500)]), // Less than 10 KB
        fileSize: 500,
      };

      storageService.getAllDownloadedTracks = async () => [emptyBlobRecord, undersizedBlobRecord];
      nativePlaybackBridge.isTrackDownloadedNatively = async () => false;

      const candidates = await migrationService.getMigrationCandidates();
      assert.equal(candidates.length, 0);

      const resEmpty = await migrationService.migrateTrack(emptyBlobRecord);
      assert.equal(resEmpty.success, false);
      assert.equal(resEmpty.skipped, true);

      const resUndersized = await migrationService.migrateTrack(undersizedBlobRecord);
      assert.equal(resUndersized.success, false);
      assert.equal(resUndersized.skipped, true);
    });

    // 7. Correctly splits Blob into chunks
    it('7. Correctly splits Blob into chunks', async () => {
      // 600 KB blob will yield:
      // chunk 0: 256 KB
      // chunk 1: 256 KB
      // chunk 2: 88 KB
      const blobSize = 600 * 1024;
      const record: StoredAudioRecord = {
        id: 'split-test-track',
        track: { id: 'split-test-track', title: 'Split Song' } as any,
        blob: new Blob([new Uint8Array(blobSize)], { type: 'audio/mpeg' }),
        fileSize: blobSize,
      };

      const chunkSizes: number[] = [];
      nativePlaybackBridge.isTrackDownloadedNatively = async () => true;
      nativePlaybackBridge.beginDownloadChunked = async () => ({
        success: true,
        trackId: record.id,
        nextExpectedChunkIndex: 0,
      });
      nativePlaybackBridge.writeDownloadChunk = async (opts) => {
        const decodedLength = atob(opts.chunkData).length;
        chunkSizes.push(decodedLength);
        return {
          success: true,
          trackId: opts.trackId,
          acceptedChunkIndex: opts.chunkIndex,
          nextExpectedChunkIndex: opts.chunkIndex + 1,
          bytesWritten: decodedLength,
        };
      };
      nativePlaybackBridge.commitDownloadChunked = async (opts) => ({
        success: true,
        trackId: opts.trackId,
      });

      // Override isTrackDownloadedNatively to false before migration, true after commit
      let isNativelyDone = false;
      nativePlaybackBridge.isTrackDownloadedNatively = async () => isNativelyDone;
      nativePlaybackBridge.commitDownloadChunked = async (opts) => {
        isNativelyDone = true;
        return { success: true, trackId: opts.trackId };
      };

      const result = await migrationService.migrateTrack(record);
      assert.equal(result.success, true);
      assert.equal(chunkSizes.length, 3);
      assert.equal(chunkSizes[0], MAX_BINARY_CHUNK_SIZE);
      assert.equal(chunkSizes[1], MAX_BINARY_CHUNK_SIZE);
      assert.equal(chunkSizes[2], blobSize - (2 * MAX_BINARY_CHUNK_SIZE));
    });

    // 8. Sends chunks in exact sequential order
    it('8. Sends chunks in exact sequential order', async () => {
      const blobSize = 700 * 1024;
      const record: StoredAudioRecord = {
        id: 'seq-order-track',
        track: { id: 'seq-order-track', title: 'Sequential Song' } as any,
        blob: new Blob([new Uint8Array(blobSize)], { type: 'audio/mpeg' }),
        fileSize: blobSize,
      };

      const receivedIndices: number[] = [];
      let isDone = false;

      nativePlaybackBridge.isTrackDownloadedNatively = async () => isDone;
      nativePlaybackBridge.beginDownloadChunked = async (opts) => ({
        success: true,
        trackId: opts.trackId,
        nextExpectedChunkIndex: 0,
      });
      nativePlaybackBridge.writeDownloadChunk = async (opts) => {
        receivedIndices.push(opts.chunkIndex);
        return {
          success: true,
          trackId: opts.trackId,
          acceptedChunkIndex: opts.chunkIndex,
          nextExpectedChunkIndex: opts.chunkIndex + 1,
          bytesWritten: 256 * 1024,
        };
      };
      nativePlaybackBridge.commitDownloadChunked = async (opts) => {
        isDone = true;
        return { success: true, trackId: opts.trackId };
      };

      const result = await migrationService.migrateTrack(record);
      assert.equal(result.success, true);
      assert.deepEqual(receivedIndices, [0, 1, 2]);
    });

    // 9. Successfully commits a multi-chunk track
    it('9. Successfully commits a multi-chunk track', async () => {
      const blobSize = 550 * 1024;
      const record: StoredAudioRecord = {
        id: 'multi-chunk-commit-track',
        track: { id: 'multi-chunk-commit-track', title: 'Commit Song', artistName: 'Artist A' } as any,
        blob: new Blob([new Uint8Array(blobSize)], { type: 'audio/mp4' }),
        fileSize: blobSize,
      };

      let commitCalledWith: any = null;
      let isVerified = false;

      nativePlaybackBridge.isTrackDownloadedNatively = async () => isVerified;
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
        bytesWritten: 100000,
      });
      nativePlaybackBridge.commitDownloadChunked = async (opts) => {
        commitCalledWith = opts;
        isVerified = true;
        return { success: true, trackId: opts.trackId };
      };

      const result = await migrationService.migrateTrack(record);
      assert.equal(result.success, true);
      assert.equal(result.failed, false);
      assert.ok(commitCalledWith);
      assert.equal(commitCalledWith.trackId, 'multi-chunk-commit-track');
      assert.equal(commitCalledWith.metadata.title, 'Commit Song');
      assert.equal(commitCalledWith.metadata.artist, 'Artist A');
    });

    // 10. Cancellation aborts native transaction
    it('10. Cancellation aborts native transaction', async () => {
      const blobSize = 600 * 1024;
      const record: StoredAudioRecord = {
        id: 'cancel-test-track',
        track: { id: 'cancel-test-track', title: 'Cancel Song' } as any,
        blob: new Blob([new Uint8Array(blobSize)], { type: 'audio/mpeg' }),
        fileSize: blobSize,
      };

      let abortCalled = false;
      let chunksWritten = 0;

      nativePlaybackBridge.isTrackDownloadedNatively = async () => false;
      nativePlaybackBridge.beginDownloadChunked = async (opts) => ({
        success: true,
        trackId: opts.trackId,
        nextExpectedChunkIndex: 0,
      });
      nativePlaybackBridge.writeDownloadChunk = async (opts) => {
        chunksWritten++;
        if (chunksWritten === 1) {
          migrationService.cancel();
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

      const result = await migrationService.migrateTrack(record);
      assert.equal(result.success, false);
      assert.equal(result.failed, true);
      assert.equal(abortCalled, true);
    });

    // 11. Failure aborts transaction
    it('11. Failure aborts transaction', async () => {
      const blobSize = 600 * 1024;
      const record: StoredAudioRecord = {
        id: 'failure-abort-track',
        track: { id: 'failure-abort-track', title: 'Failure Song' } as any,
        blob: new Blob([new Uint8Array(blobSize)], { type: 'audio/mpeg' }),
        fileSize: blobSize,
      };

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
            error: 'Simulated disk write failure',
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

      const result = await migrationService.migrateTrack(record);
      assert.equal(result.success, false);
      assert.equal(result.failed, true);
      assert.equal(abortCalled, true);
    });

    // 12. Legacy IndexedDB record safely purged after native verification succeeds
    it('12. Legacy IndexedDB record safely purged after native verification succeeds', async () => {
      const record: StoredAudioRecord = {
        id: 'persist-success-track',
        track: { id: 'persist-success-track', title: 'Persist Song' } as any,
        blob: new Blob([new Uint8Array(25000)], { type: 'audio/mpeg' }),
        fileSize: 25000,
      };

      let deleteTrackCalled = false;
      storageService.deleteDownloadedTrack = async () => {
        deleteTrackCalled = true;
      };

      let isDone = false;
      nativePlaybackBridge.isTrackDownloadedNatively = async () => isDone;
      nativePlaybackBridge.beginDownloadChunked = async () => ({
        success: true,
        trackId: record.id,
        nextExpectedChunkIndex: 0,
      });
      nativePlaybackBridge.writeDownloadChunk = async (opts) => ({
        success: true,
        trackId: opts.trackId,
        acceptedChunkIndex: 0,
        nextExpectedChunkIndex: 1,
        bytesWritten: 25000,
      });
      nativePlaybackBridge.commitDownloadChunked = async (opts) => {
        isDone = true;
        return { success: true, trackId: opts.trackId };
      };

      const result = await migrationService.migrateTrack(record);
      assert.equal(result.success, true);
      assert.equal(deleteTrackCalled, true, 'Legacy IndexedDB record is safely purged after verified native migration');
    });

    // 13. Original IndexedDB record remains after failure
    it('13. Original IndexedDB record remains after failure', async () => {
      const record: StoredAudioRecord = {
        id: 'persist-failure-track',
        track: { id: 'persist-failure-track', title: 'Persist Fail Song' } as any,
        blob: new Blob([new Uint8Array(25000)], { type: 'audio/mpeg' }),
        fileSize: 25000,
      };

      let deleteTrackCalled = false;
      storageService.deleteDownloadedTrack = async () => {
        deleteTrackCalled = true;
      };

      nativePlaybackBridge.isTrackDownloadedNatively = async () => false;
      nativePlaybackBridge.beginDownloadChunked = async () => ({
        success: true,
        trackId: record.id,
        nextExpectedChunkIndex: 0,
      });
      nativePlaybackBridge.writeDownloadChunk = async () => ({
        success: false,
        trackId: record.id,
        acceptedChunkIndex: -1,
        nextExpectedChunkIndex: 0,
        bytesWritten: 0,
        error: 'Simulated failure',
      });
      nativePlaybackBridge.abortDownloadChunked = async (trackId) => ({ success: true, trackId });

      const result = await migrationService.migrateTrack(record);
      assert.equal(result.success, false);
      assert.equal(deleteTrackCalled, false, 'IndexedDB record must NOT be deleted after failure');
    });

    // 14. Retry after failed transfer works
    it('14. Retry after failed transfer works', async () => {
      const record: StoredAudioRecord = {
        id: 'retry-track',
        track: { id: 'retry-track', title: 'Retry Song' } as any,
        blob: new Blob([new Uint8Array(30000)], { type: 'audio/mpeg' }),
        fileSize: 30000,
      };

      let attempt = 0;
      let isVerified = false;

      nativePlaybackBridge.isTrackDownloadedNatively = async () => isVerified;
      nativePlaybackBridge.beginDownloadChunked = async () => ({
        success: true,
        trackId: record.id,
        nextExpectedChunkIndex: 0,
      });
      nativePlaybackBridge.writeDownloadChunk = async (opts) => {
        if (attempt === 0) {
          return {
            success: false,
            trackId: opts.trackId,
            acceptedChunkIndex: -1,
            nextExpectedChunkIndex: 0,
            bytesWritten: 0,
            error: 'Temporary error on first try',
          };
        }
        return {
          success: true,
          trackId: opts.trackId,
          acceptedChunkIndex: 0,
          nextExpectedChunkIndex: 1,
          bytesWritten: 30000,
        };
      };
      nativePlaybackBridge.abortDownloadChunked = async (trackId) => ({ success: true, trackId });
      nativePlaybackBridge.commitDownloadChunked = async (opts) => {
        isVerified = true;
        return { success: true, trackId: opts.trackId };
      };

      // Attempt 1 fails
      const result1 = await migrationService.migrateTrack(record);
      assert.equal(result1.success, false);

      // Attempt 2 succeeds
      attempt = 1;
      const result2 = await migrationService.migrateTrack(record);
      assert.equal(result2.success, true);
    });

    // 15. Duplicate invocation does not overwrite existing native file
    it('15. Duplicate invocation does not overwrite existing native file', async () => {
      let isAlreadyNative = true;
      nativePlaybackBridge.isTrackDownloadedNatively = async () => isAlreadyNative;

      let writeCalled = false;
      nativePlaybackBridge.writeDownloadChunk = async () => {
        writeCalled = true;
        return { success: true, trackId: 'dup-track', acceptedChunkIndex: 0, nextExpectedChunkIndex: 1, bytesWritten: 0 };
      };

      const record: StoredAudioRecord = {
        id: 'dup-track',
        track: { id: 'dup-track', title: 'Dup Song' } as any,
        blob: new Blob([new Uint8Array(20000)], { type: 'audio/mpeg' }),
        fileSize: 20000,
      };

      const result = await migrationService.migrateTrack(record);
      assert.equal(result.success, true);
      assert.equal(result.skipped, true);
      assert.equal(result.alreadyNative, true);
      assert.equal(writeCalled, false, 'Should skip without writing chunks');
    });

    // 16. Multiple tracks are processed sequentially
    it('16. Multiple tracks are processed sequentially', async () => {
      const record1: StoredAudioRecord = {
        id: 'track-seq-1',
        track: { id: 'track-seq-1', title: 'Seq 1' } as any,
        blob: new Blob([new Uint8Array(20000)], { type: 'audio/mpeg' }),
        fileSize: 20000,
      };
      const record2: StoredAudioRecord = {
        id: 'track-seq-2',
        track: { id: 'track-seq-2', title: 'Seq 2' } as any,
        blob: new Blob([new Uint8Array(20000)], { type: 'audio/mpeg' }),
        fileSize: 20000,
      };

      const callOrder: string[] = [];
      const verifiedIds = new Set<string>();

      storageService.getAllDownloadedTracks = async () => [record1, record2];
      nativePlaybackBridge.isTrackDownloadedNatively = async (trackId) => verifiedIds.has(trackId);
      nativePlaybackBridge.beginDownloadChunked = async (opts) => {
        callOrder.push(`begin:${opts.trackId}`);
        return { success: true, trackId: opts.trackId, nextExpectedChunkIndex: 0 };
      };
      nativePlaybackBridge.writeDownloadChunk = async (opts) => {
        callOrder.push(`chunk:${opts.trackId}:${opts.chunkIndex}`);
        return {
          success: true,
          trackId: opts.trackId,
          acceptedChunkIndex: opts.chunkIndex,
          nextExpectedChunkIndex: opts.chunkIndex + 1,
          bytesWritten: 20000,
        };
      };
      nativePlaybackBridge.commitDownloadChunked = async (opts) => {
        callOrder.push(`commit:${opts.trackId}`);
        verifiedIds.add(opts.trackId);
        return { success: true, trackId: opts.trackId };
      };

      const summary = await migrationService.migrateAll();
      assert.equal(summary.total, 2);
      assert.equal(summary.completed, 2);
      assert.deepEqual(callOrder, [
        'begin:track-seq-1',
        'chunk:track-seq-1:0',
        'commit:track-seq-1',
        'begin:track-seq-2',
        'chunk:track-seq-2:0',
        'commit:track-seq-2',
      ]);
    });

    // 17. Large multi-chunk Blob does not get converted to one huge Base64 string
    it('17. Large multi-chunk Blob does not get converted to one huge Base64 string', async () => {
      // 800 KB blob (would be >1 MB as single Base64)
      const blobSize = 800 * 1024;
      const record: StoredAudioRecord = {
        id: 'stream-chunk-track',
        track: { id: 'stream-chunk-track', title: 'Stream Chunk Song' } as any,
        blob: new Blob([new Uint8Array(blobSize)], { type: 'audio/mpeg' }),
        fileSize: blobSize,
      };

      const maxBase64Expected = Math.ceil(MAX_BINARY_CHUNK_SIZE / 3) * 4 + 4;
      const observedBase64Lengths: number[] = [];

      let isDone = false;
      nativePlaybackBridge.isTrackDownloadedNatively = async () => isDone;
      nativePlaybackBridge.beginDownloadChunked = async (opts) => ({
        success: true,
        trackId: opts.trackId,
        nextExpectedChunkIndex: 0,
      });
      nativePlaybackBridge.writeDownloadChunk = async (opts) => {
        observedBase64Lengths.push(opts.chunkData.length);
        return {
          success: true,
          trackId: opts.trackId,
          acceptedChunkIndex: opts.chunkIndex,
          nextExpectedChunkIndex: opts.chunkIndex + 1,
          bytesWritten: 256 * 1024,
        };
      };
      nativePlaybackBridge.commitDownloadChunked = async (opts) => {
        isDone = true;
        return { success: true, trackId: opts.trackId };
      };

      const result = await migrationService.migrateTrack(record);
      assert.equal(result.success, true);
      assert.equal(observedBase64Lengths.length, 4); // 800 KB / 256 KB = 4 chunks
      for (const len of observedBase64Lengths) {
        assert.ok(len <= maxBase64Expected, `Base64 chunk length ${len} must be <= max chunk base64 ${maxBase64Expected}`);
      }
    });

    // 18. Exact transferred byte count matches Blob size (deterministic verification)
    it('18. Exact transferred byte count matches Blob size and reconstructs deterministic bytes', async () => {
      const blobSize = 700 * 1024; // 700 KB
      const originalBytes = new Uint8Array(blobSize);
      for (let i = 0; i < blobSize; i++) {
        originalBytes[i] = (i * 31 + 7) % 256;
      }

      const record: StoredAudioRecord = {
        id: 'deterministic-byte-track',
        track: { id: 'deterministic-byte-track', title: 'Deterministic Song' } as any,
        blob: new Blob([originalBytes], { type: 'audio/mpeg' }),
        fileSize: blobSize,
      };

      const reconstructedChunks: Uint8Array[] = [];
      let isDone = false;

      nativePlaybackBridge.isTrackDownloadedNatively = async () => isDone;
      nativePlaybackBridge.beginDownloadChunked = async (opts) => ({
        success: true,
        trackId: opts.trackId,
        nextExpectedChunkIndex: 0,
      });
      nativePlaybackBridge.writeDownloadChunk = async (opts) => {
        const binaryStr = atob(opts.chunkData);
        const chunkBytes = new Uint8Array(binaryStr.length);
        for (let j = 0; j < binaryStr.length; j++) {
          chunkBytes[j] = binaryStr.charCodeAt(j);
        }
        reconstructedChunks.push(chunkBytes);

        return {
          success: true,
          trackId: opts.trackId,
          acceptedChunkIndex: opts.chunkIndex,
          nextExpectedChunkIndex: opts.chunkIndex + 1,
          bytesWritten: chunkBytes.length,
        };
      };
      nativePlaybackBridge.commitDownloadChunked = async (opts) => {
        isDone = true;
        return { success: true, trackId: opts.trackId };
      };

      const result = await migrationService.migrateTrack(record);
      assert.equal(result.success, true);
      assert.equal(result.bytesTransferred, blobSize);

      // Concatenate reconstructed chunks and compare byte-for-byte
      const totalReconstructedLength = reconstructedChunks.reduce((acc, c) => acc + c.length, 0);
      assert.equal(totalReconstructedLength, blobSize);

      const reconstructedAll = new Uint8Array(totalReconstructedLength);
      let offset = 0;
      for (const c of reconstructedChunks) {
        reconstructedAll.set(c, offset);
        offset += c.length;
      }

      assert.deepEqual(reconstructedAll, originalBytes, 'Reconstructed bytes must match original byte-for-byte');
    });
  });

  describe('Playback Gating & Concurrency Safety', () => {
    it('pauses when playback starts and resumes when notifyPlaybackState(false) is called', async () => {
      migrationService.notifyPlaybackState(true);
      let waitFinished = false;

      const waitPromise = migrationService.waitForPlaybackIdle().then(() => {
        waitFinished = true;
      });

      await new Promise((r) => setTimeout(r, 20));
      assert.equal(waitFinished, false, 'Should remain suspended while playback is active');

      migrationService.notifyPlaybackState(false);
      await waitPromise;
      assert.equal(waitFinished, true, 'Should resume cleanly without polling');
    });

    it('duplicate migrateAll() returns the identical active promise', async () => {
      let getAllCalls = 0;
      storageService.getAllDownloadedTracks = async () => {
        getAllCalls++;
        await new Promise((r) => setTimeout(r, 50));
        return [];
      };

      const p1 = migrationService.migrateAll();
      const p2 = migrationService.migrateAll();

      assert.equal(p1, p2, 'Must return the same promise instance');
      await Promise.all([p1, p2]);
      assert.equal(getAllCalls, 1, 'getAllDownloadedTracks must only be called once');
    });
  });
});
