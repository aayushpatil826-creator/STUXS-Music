import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { nativePlaybackController } from '../nativePlaybackController';
import { nativePlaybackBridge } from '../nativePlaybackBridge';
import { downloadService } from '../DownloadService';
import type { Track } from '../../types/music';

function createTrack(id: string, title: string, overrides: Partial<Track> = {}): Track {
  return {
    id,
    title,
    artistName: 'STUXS Artist',
    artistId: 'artist-1',
    albumTitle: 'STUXS Album',
    artworkUrl: 'https://example.com/art.jpg',
    duration: 200,
    provider: 'jiosaavn',
    isPlayable: true,
    accessStatus: 'playable',
    audioUrl: `https://example.com/audio/${id}.mp3`,
    ...overrides,
  };
}

describe('Build 9 — Previous Button & Downloaded Playback Test Suite', () => {
  let skipToPrevCalls = 0;
  let seekCalls: number[] = [];

  beforeEach(() => {
    skipToPrevCalls = 0;
    seekCalls = [];

    nativePlaybackBridge.isAvailable = () => true;
    nativePlaybackController.setEnabled(true);
    (nativePlaybackController as any)._isNativeEngineActive = true;

    nativePlaybackBridge.skipToPrevious = async () => {
      skipToPrevCalls++;
      return true;
    };

    nativePlaybackBridge.seekTo = async (posMs: number) => {
      seekCalls.push(posMs);
      return true;
    };
  });

  describe('1. Authoritative Previous Navigation via Controller', () => {
    it('calls nativePlaybackBridge.skipToPrevious when native is enabled', async () => {
      nativePlaybackController.setEnabled(true);
      const res = await nativePlaybackController.skipToPrevious();
      assert.equal(res, true);
      assert.equal(skipToPrevCalls, 1);
    });

    it('returns false when native is disabled', async () => {
      nativePlaybackBridge.isAvailable = () => false;
      const res = await nativePlaybackController.skipToPrevious();
      assert.equal(res, false);
      assert.equal(skipToPrevCalls, 0);
    });

    it('emits seek when seek() is called on controller', async () => {
      nativePlaybackController.setEnabled(true);
      await nativePlaybackController.seek(0);
      assert.equal(seekCalls.length, 1);
      assert.equal(seekCalls[0], 0);
    });
  });

  describe('2. Navigation Logic Simulation (Mirroring StuxsExoPlayerEngine & Fallback)', () => {
    const PREVIOUS_RESTART_THRESHOLD_SEC = 3;

    function simulatePrevious(
      positionSec: number,
      queue: Track[],
      currentIndex: number,
      repeatMode: 'off' | 'one' | 'all'
    ): { action: 'restart' | 'prev_track' | 'wrap_around'; newIndex: number; newPos: number } {
      if (positionSec > PREVIOUS_RESTART_THRESHOLD_SEC) {
        return { action: 'restart', newIndex: currentIndex, newPos: 0 };
      }
      if (repeatMode === 'one') {
        return { action: 'restart', newIndex: currentIndex, newPos: 0 };
      }
      if (currentIndex > 0) {
        return { action: 'prev_track', newIndex: currentIndex - 1, newPos: 0 };
      }
      if (repeatMode === 'all' && queue.length > 1) {
        return { action: 'wrap_around', newIndex: queue.length - 1, newPos: 0 };
      }
      return { action: 'restart', newIndex: 0, newPos: 0 };
    }

    it('restarts current track if position > 3 seconds', () => {
      const queue = [createTrack('1', 'Song 1'), createTrack('2', 'Song 2')];
      const res = simulatePrevious(4.5, queue, 1, 'off');
      assert.equal(res.action, 'restart');
      assert.equal(res.newIndex, 1);
      assert.equal(res.newPos, 0);
    });

    it('navigates to previous track if position <= 3 seconds and index > 0', () => {
      const queue = [createTrack('1', 'Song 1'), createTrack('2', 'Song 2')];
      const res = simulatePrevious(2.0, queue, 1, 'off');
      assert.equal(res.action, 'prev_track');
      assert.equal(res.newIndex, 0);
      assert.equal(res.newPos, 0);
    });

    it('restarts track in repeat ONE mode even if position <= 3 seconds', () => {
      const queue = [createTrack('1', 'Song 1'), createTrack('2', 'Song 2')];
      const res = simulatePrevious(1.0, queue, 1, 'one');
      assert.equal(res.action, 'restart');
      assert.equal(res.newIndex, 1);
      assert.equal(res.newPos, 0);
    });

    it('wraps around to end of queue in repeat ALL mode at index 0', () => {
      const queue = [createTrack('1', 'Song 1'), createTrack('2', 'Song 2'), createTrack('3', 'Song 3')];
      const res = simulatePrevious(1.5, queue, 0, 'all');
      assert.equal(res.action, 'wrap_around');
      assert.equal(res.newIndex, 2);
      assert.equal(res.newPos, 0);
    });

    it('safely restarts at index 0 in repeat OFF mode at index 0 without negative index', () => {
      const queue = [createTrack('1', 'Song 1'), createTrack('2', 'Song 2')];
      const res = simulatePrevious(1.2, queue, 0, 'off');
      assert.equal(res.action, 'restart');
      assert.equal(res.newIndex, 0);
      assert.equal(res.newPos, 0);
    });

    it('single track queue always restarts from 0 in all modes', () => {
      const queue = [createTrack('1', 'Solo')];
      for (const mode of ['off', 'one', 'all'] as const) {
        const res = simulatePrevious(2.0, queue, 0, mode);
        assert.equal(res.action, 'restart');
        assert.equal(res.newIndex, 0);
      }
    });
  });

  describe('3. Downloaded Track Offline Resolution & Canonical Matching', () => {
    it('resolves track with exact ID match from native storage', async () => {
      const testTrack = createTrack('jiosaavn-12345', 'Tum Hi Ho', {
        artistName: 'Arijit Singh',
      });

      nativePlaybackBridge.getNativeDownloadedTracks = async () => [
        {
          id: 'jiosaavn-12345',
          title: 'Tum Hi Ho',
          artist: 'Arijit Singh',
          album: 'Aashiqui 2',
          localFilePath: '/data/user/0/com.stuxs.music/files/downloads/tum_hi_ho.m4a',
          fileSize: 4500000,
          durationMs: 262000,
          provider: 'jiosaavn',
        } as any,
      ];

      const resolved = await downloadService.resolvePlayableDownloadedTrack(testTrack);
      assert.ok(resolved);
      assert.equal(resolved?.id, 'jiosaavn-12345');
      assert.equal(resolved?.isDownloaded, true);
      assert.equal(resolved?.audioUrl, 'file:///data/user/0/com.stuxs.music/files/downloads/tum_hi_ho.m4a');
      assert.equal(resolved?.localPath, '/data/user/0/com.stuxs.music/files/downloads/tum_hi_ho.m4a');
    });

    it('resolves track with alternative catalog ID through canonical matching', async () => {
      const catalogTrack = createTrack('stuxs-catalog-999', 'Kesariya', {
        artistName: 'Arijit Singh',
        duration: 268,
      });

      nativePlaybackBridge.getNativeDownloadedTracks = async () => [
        {
          id: 'jiosaavn-track-kesariya-1',
          title: 'Kesariya (From "Brahmastra")',
          artist: 'Arijit Singh, Pritam',
          album: 'Brahmastra',
          localFilePath: '/data/user/0/com.stuxs.music/files/downloads/kesariya.m4a',
          fileSize: 5200000,
          durationMs: 268000,
          provider: 'jiosaavn',
        } as any,
      ];

      const resolved = await downloadService.resolvePlayableDownloadedTrack(catalogTrack);
      assert.ok(resolved);
      assert.equal(resolved?.title, 'Kesariya (From "Brahmastra")');
      assert.equal(resolved?.isDownloaded, true);
      assert.equal(resolved?.localPath, '/data/user/0/com.stuxs.music/files/downloads/kesariya.m4a');
    });

    it('getPlayableTrack accepts Track object and matches canonically', () => {
      const storedTrack = createTrack('downloaded-id-1', 'Channa Mereya', {
        artistName: 'Arijit Singh',
        duration: 289,
        audioUrl: 'file:///path/to/channa.m4a',
        isDownloaded: true,
      });

      (downloadService as any).indexTrack(storedTrack);

      const queryTrack = createTrack('different-id-2', 'Channa Mereya', {
        artistName: 'Arijit Singh',
        duration: 289,
      });

      const found = downloadService.getPlayableTrack(queryTrack);
      assert.ok(found);
      assert.equal(found?.id, 'downloaded-id-1');
      assert.equal(found?.audioUrl, 'file:///path/to/channa.m4a');
    });
  });

  describe('4. Audio Magic Byte Validation Policy', () => {
    function validateAudioBytes(header: Uint8Array): { isValid: boolean; ext: string; mime: string } {
      if (header.length < 8) return { isValid: false, ext: 'mp3', mime: 'audio/mpeg' };

      const sample = new TextDecoder('ascii').decode(header.slice(0, 32)).trim().toLowerCase();
      if (sample.startsWith('<!doctype') || sample.startsWith('<html') || sample.startsWith('<?xml')) {
        return { isValid: false, ext: 'mp3', mime: 'audio/mpeg' };
      }
      if (sample.startsWith('{') && (sample.includes('error') || sample.includes('message') || sample.includes('code'))) {
        return { isValid: false, ext: 'mp3', mime: 'audio/mpeg' };
      }

      if (
        header[4] === 0x66 &&
        header[5] === 0x74 &&
        header[6] === 0x79 &&
        header[7] === 0x70
      ) {
        return { isValid: true, ext: 'm4a', mime: 'audio/mp4' };
      }

      if (header[0] === 0x49 && header[1] === 0x44 && header[2] === 0x33) {
        return { isValid: true, ext: 'mp3', mime: 'audio/mpeg' };
      }

      if (header[0] === 0xFF && (header[1] & 0xE0) === 0xE0) {
        return { isValid: true, ext: 'mp3', mime: 'audio/mpeg' };
      }

      if (header[0] === 0x66 && header[1] === 0x4C && header[2] === 0x61 && header[3] === 0x43) {
        return { isValid: true, ext: 'flac', mime: 'audio/flac' };
      }

      return { isValid: true, ext: 'mp3', mime: 'audio/mpeg' };
    }

    it('rejects HTML 403 / 404 response pages', () => {
      const htmlBytes = new TextEncoder().encode('<!DOCTYPE html><html><body>403 Forbidden</body></html>');
      const res = validateAudioBytes(htmlBytes);
      assert.equal(res.isValid, false);
    });

    it('rejects JSON error payloads', () => {
      const jsonBytes = new TextEncoder().encode('{"error":"Token expired","code":401,"status":"unauthorized"}');
      const res = validateAudioBytes(jsonBytes);
      assert.equal(res.isValid, false);
    });

    it('accurately identifies MP4/M4A container with ftyp box', () => {
      const m4aHeader = new Uint8Array([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4D, 0x34, 0x41, 0x20]);
      const res = validateAudioBytes(m4aHeader);
      assert.equal(res.isValid, true);
      assert.equal(res.ext, 'm4a');
      assert.equal(res.mime, 'audio/mp4');
    });

    it('accurately identifies MP3 container with ID3 tag', () => {
      const mp3Header = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x0F, 0x7F]);
      const res = validateAudioBytes(mp3Header);
      assert.equal(res.isValid, true);
      assert.equal(res.ext, 'mp3');
      assert.equal(res.mime, 'audio/mpeg');
    });

    it('accurately identifies FLAC container', () => {
      const flacHeader = new Uint8Array([0x66, 0x4C, 0x61, 0x43, 0x00, 0x00, 0x00, 0x22]);
      const res = validateAudioBytes(flacHeader);
      assert.equal(res.isValid, true);
      assert.equal(res.ext, 'flac');
      assert.equal(res.mime, 'audio/flac');
    });
  });
});
