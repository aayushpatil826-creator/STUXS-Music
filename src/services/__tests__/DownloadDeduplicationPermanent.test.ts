import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Track } from '../../types/music';
import { downloadService } from '../DownloadService';
import { storageService, type StoredAudioRecord } from '../StorageService';
import { nativePlaybackBridge } from '../nativePlaybackBridge';
import { getCanonicalTrackKey, isSameRecording } from '../../utils/trackIdentity';

describe('Permanent Download Deduplication & Reconciliation Test Suite', () => {
  it('1. Simulates 33-song friend bug: reconciles 33 IndexedDB blobs + 33 Room native records into exactly 33 unique tracks', async () => {
    // Setup 33 IndexedDB records (using "jiosaavn-track-<id>" ID schema)
    const mockIndexedDbRecords: StoredAudioRecord[] = [];
    for (let i = 1; i <= 33; i++) {
      mockIndexedDbRecords.push({
        id: `jiosaavn-track-${i}`,
        track: {
          id: `jiosaavn-track-${i}`,
          title: `Hit Song ${i}`,
          artistName: `Artist ${i}`,
          duration: 200 + i,
          provider: 'jiosaavn' as any,
          audioUrl: `blob:mock-blob-${i}`,
        } as Track,
        blob: new Blob([new Uint8Array(20000)], { type: 'audio/mpeg' }),
        fileSize: 20000,
        downloadedAt: Date.now() - 10000,
      });
    }

    // Setup 33 native Room records (using "jiosaavn-<id>" ID schema - different string prefix!)
    const mockNativeRecords: any[] = [];
    for (let i = 1; i <= 33; i++) {
      mockNativeRecords.push({
        id: `jiosaavn-${i}`,
        title: `Hit Song ${i}`,
        artist: `Artist ${i}`,
        album: `Album ${i}`,
        artworkUrl: `https://art/${i}.jpg`,
        localFilePath: `/data/user/0/com.stuxs.music/files/native_downloads/jiosaavn_${i}.mp3`,
        fileSize: 20000,
        durationMs: (200 + i) * 1000,
        provider: 'jiosaavn',
      });
    }

    // Track deletions from IndexedDB
    const deletedIndexedDbIds: string[] = [];
    storageService.getAllDownloadedTracks = async () => [...mockIndexedDbRecords];
    storageService.deleteDownloadedTrack = async (id: string) => {
      deletedIndexedDbIds.push(id);
      const idx = mockIndexedDbRecords.findIndex((r) => r.id === id);
      if (idx !== -1) mockIndexedDbRecords.splice(idx, 1);
    };

    nativePlaybackBridge.isAvailable = () => true;
    nativePlaybackBridge.getNativeDownloadedTracks = async () => mockNativeRecords;
    nativePlaybackBridge.isTrackDownloadedNatively = async (id: string) => {
      return mockNativeRecords.some((r) => r.id === id || r.id === id.replace('-track-', '-'));
    };

    // Initialize download service
    await downloadService.init();

    // Verify deduplication:
    // Exactly 33 tracks must be returned, NOT 66!
    const downloaded = downloadService.getDownloadedTracks();
    assert.equal(downloaded.length, 33, `Expected exactly 33 downloaded tracks, but got ${downloaded.length}`);

    // Verify all 33 legacy IndexedDB records were safely purged
    assert.equal(deletedIndexedDbIds.length, 33, `Expected all 33 legacy blobs to be purged, but purged ${deletedIndexedDbIds.length}`);

    // Verify each track is playable via native file path
    for (const track of downloaded) {
      assert.ok(track.audioUrl?.startsWith('file://'), `Track ${track.id} should point to native file:// URL`);
    }
  });

  it('2. isTrackDownloaded matches across provider ID schema aliases (jiosaavn-track-* vs jiosaavn-*)', () => {
    const isDownloaded1 = downloadService.isTrackDownloaded('jiosaavn-track-1');
    const isDownloaded2 = downloadService.isTrackDownloaded('jiosaavn-1');
    const isDownloadedObj = downloadService.isTrackDownloaded({
      id: 'jiosaavn-track-1',
      title: 'Hit Song 1',
      artistName: 'Artist 1',
    });

    assert.equal(isDownloaded1, true);
    assert.equal(isDownloaded2, true);
    assert.equal(isDownloadedObj, true);
  });

  it('3. downloadPlaylist skips already downloaded tracks even if playlist contains different ID variants or cosmetic tags', async () => {
    const playlistTracks: Track[] = [
      {
        id: 'jiosaavn-track-1',
        title: 'Hit Song 1 (Official Audio)',
        artistName: 'Artist 1',
        duration: 201,
        provider: 'jiosaavn',
      } as Track,
      {
        id: 'jiosaavn-2',
        title: 'Hit Song 2',
        artistName: 'Artist 2',
        duration: 202,
        provider: 'jiosaavn',
      } as Track,
      {
        id: 'jiosaavn-999',
        title: 'Brand New Track',
        artistName: 'New Artist',
        duration: 180,
        provider: 'jiosaavn',
      } as Track,
    ];

    const origDownloadTrack = downloadService.downloadTrack.bind(downloadService);
    let downloadCount = 0;
    try {
      downloadService.downloadTrack = async (_t: Track) => {
        downloadCount++;
      };

      const summary = await downloadService.downloadPlaylist(playlistTracks, 'test-pl');
      assert.equal(summary.total, 3);
      assert.equal(summary.skipped, 2, '2 already-downloaded tracks must be skipped');
      assert.equal(summary.downloaded, 1, 'Only 1 new track should be downloaded');
    } finally {
      downloadService.downloadTrack = origDownloadTrack;
    }
  });

  it('4. Concurrent download calls with different ID aliases share the exact same promise', async () => {
    const trackA: Track = {
      id: 'jiosaavn-track-888',
      title: 'Obsidian Fire',
      artistName: 'STUXS',
      duration: 190,
      provider: 'jiosaavn',
    } as Track;

    const trackB: Track = {
      id: 'jiosaavn-888',
      title: 'Obsidian Fire',
      artistName: 'STUXS',
      duration: 190,
      provider: 'jiosaavn',
    } as Track;

    const origExecute = (downloadService as any).executeDownloadTrack.bind(downloadService);
    let executionCount = 0;
    (downloadService as any).executeDownloadTrack = async () => {
      executionCount++;
      await new Promise((r) => setTimeout(r, 50));
    };

    try {
      await Promise.all([
        downloadService.downloadTrack(trackA),
        downloadService.downloadTrack(trackB),
      ]);

      assert.equal(executionCount, 1, 'Both concurrent calls with ID aliases must share 1 execution');
    } finally {
      (downloadService as any).executeDownloadTrack = origExecute;
    }
  });

  it('5. Strictly preserves distinct artistic versions (Remix, Acoustic) as separate downloads', () => {
    const original: Partial<Track> = {
      id: 'jiosaavn-10',
      title: 'Tum Hi Ho',
      artistName: 'Arijit Singh',
      duration: 260,
    };
    const remix: Partial<Track> = {
      id: 'jiosaavn-10-remix',
      title: 'Tum Hi Ho (Remix)',
      artistName: 'Arijit Singh',
      duration: 240,
    };

    assert.equal(isSameRecording(original, remix), false);
    assert.notEqual(getCanonicalTrackKey(original), getCanonicalTrackKey(remix));
  });
});