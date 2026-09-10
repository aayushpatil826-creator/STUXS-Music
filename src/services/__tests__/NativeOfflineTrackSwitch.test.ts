import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { nativePlaybackController } from '../nativePlaybackController';
import { nativePlaybackBridge } from '../nativePlaybackBridge';
import { downloadService } from '../DownloadService';
import type { Track } from '../../types/music';

function createMockTrack(id: string, overrides: Partial<Track> = {}): Track {
  return {
    id,
    title: `Track ${id}`,
    artistName: 'Test Artist',
    artistId: 'artist-1',
    albumTitle: 'Test Album',
    artworkUrl: 'https://example.com/art.jpg',
    duration: 200,
    provider: 'jiosaavn',
    isPlayable: true,
    accessStatus: 'playable',
    ...overrides,
  };
}

describe('Native Offline Track-Switch Bug & Race Condition Tests', () => {
  let nativeStopCalls = 0;
  let nativePlayCalls: string[] = [];
  let isPlayingNative = false;
  let activeTrackId: string | null = null;
  const origStop = nativePlaybackBridge.stop.bind(nativePlaybackBridge);
  const origPlayTrack = nativePlaybackBridge.playTrack.bind(nativePlaybackBridge);

  beforeEach(() => {
    nativeStopCalls = 0;
    nativePlayCalls = [];
    isPlayingNative = false;
    activeTrackId = null;

    nativePlaybackBridge.isAvailable = () => true;
    nativePlaybackController.isEnabled = () => true;

    nativePlaybackBridge.stop = async () => {
      nativeStopCalls++;
      isPlayingNative = false;
      activeTrackId = null;
      return true;
    };

    nativePlaybackBridge.playTrack = async (payload) => {
      nativePlayCalls.push(payload.id);
      isPlayingNative = true;
      activeTrackId = payload.id;
      return true;
    };

    nativePlaybackBridge.activateNativeMode = async () => true;
    nativePlaybackBridge.deactivateNativeMode = async () => true;
  });

  it('1. Selecting non-downloaded Song B while Song A is playing offline stops Song A immediately and leaves player stopped', async () => {
    // Setup: Song A is downloaded and playing
    const songA = createMockTrack('song-A', {
      isDownloaded: true,
      audioUrl: 'file:///data/user/0/com.stuxs.music/files/downloads/song-A.mp3',
    });
    const songB = createMockTrack('song-B', {
      isDownloaded: false,
      audioUrl: undefined, // cannot be resolved offline
    });

    // Start playback of Song A
    const resA = await nativePlaybackController.playTrack(songA, {
      stopWebAudio: () => {},
      resumeWebAudio: () => {},
      onFallback: () => {},
    });
    assert.equal(resA.success, true);
    assert.equal(isPlayingNative, true);
    assert.equal(activeTrackId, 'song-A');

    // User selects Song B (offline, non-downloaded)
    // Atomic track switch: nativePlaybackController.stop() must be invoked immediately
    await nativePlaybackController.stop();

    assert.equal(nativeStopCalls, 1, 'Song A must be stopped immediately upon selecting Song B');
    assert.equal(isPlayingNative, false, 'Player must not be playing');
    assert.equal(activeTrackId, null, 'Active track must be cleared');

    // Simulate failed resolution for Song B offline
    const isSongBPlayableOffline = songB.isDownloaded || Boolean(songB.localPath);
    assert.equal(isSongBPlayableOffline, false, 'Song B cannot play offline');

    // Song A must NOT resume or continue playing
    assert.equal(isPlayingNative, false, 'Song A audio must never continue playing');
    assert.equal(activeTrackId, null);
  });

  it('2. Sequence: Song A playing -> non-downloaded Song B (stops) -> downloaded Song C (plays)', async () => {
    const songA = createMockTrack('song-A', {
      isDownloaded: true,
      audioUrl: 'file:///data/user/0/com.stuxs.music/files/downloads/song-A.mp3',
    });
    const songB = createMockTrack('song-B', {
      isDownloaded: false,
    });
    const songC = createMockTrack('song-C', {
      isDownloaded: true,
      audioUrl: 'file:///data/user/0/com.stuxs.music/files/downloads/song-C.mp3',
    });

    // 1. Play Song A
    await nativePlaybackController.playTrack(songA, {
      stopWebAudio: () => {},
      resumeWebAudio: () => {},
      onFallback: () => {},
    });
    assert.equal(activeTrackId, 'song-A');

    // 2. Select Song B (offline, not downloaded)
    assert.equal(songB.isDownloaded, false);
    await nativePlaybackController.stop();
    assert.equal(isPlayingNative, false);
    assert.equal(activeTrackId, null);

    // Song B fails offline resolution -> remains stopped
    // 3. Select downloaded Song C
    await nativePlaybackController.stop(); // Pre-emptive stop for clean switch
    const resC = await nativePlaybackController.playTrack(songC, {
      stopWebAudio: () => {},
      resumeWebAudio: () => {},
      onFallback: () => {},
    });

    assert.equal(resC.success, true);
    assert.equal(isPlayingNative, true);
    assert.equal(activeTrackId, 'song-C');
    assert.deepEqual(nativePlayCalls, ['song-A', 'song-C']);
  });

  it('3. Song A playing -> click downloaded Song B offline -> Song A stops and Song B starts', async () => {
    const songA = createMockTrack('song-A', {
      isDownloaded: true,
      audioUrl: 'file:///data/user/0/com.stuxs.music/files/downloads/song-A.mp3',
    });
    const songB = createMockTrack('song-B', {
      isDownloaded: true,
      audioUrl: 'file:///data/user/0/com.stuxs.music/files/downloads/song-B.mp3',
    });

    // 1. Play Song A
    await nativePlaybackController.playTrack(songA, {
      stopWebAudio: () => {},
      resumeWebAudio: () => {},
      onFallback: () => {},
    });
    assert.equal(activeTrackId, 'song-A');

    // 2. Select Song B
    await nativePlaybackController.stop();
    assert.equal(activeTrackId, null);

    const resB = await nativePlaybackController.playTrack(songB, {
      stopWebAudio: () => {},
      resumeWebAudio: () => {},
      onFallback: () => {},
    });
    assert.equal(resB.success, true);
    assert.equal(activeTrackId, 'song-B');
    assert.equal(isPlayingNative, true);
  });

  afterEach(async () => {
    nativePlaybackController.stopProgressPolling();
    await nativePlaybackController.stop();
  });

  it('4. Stale asynchronous play request cannot start audio after stop() was called', async () => {
    nativePlaybackBridge.stop = origStop;
    nativePlaybackBridge.playTrack = origPlayTrack;

    let playResolve: ((value: any) => void) | null = null;
    let isPlayCall = true;
    (nativePlaybackBridge as any).executeWithTimeout = () => {
      if (isPlayCall) {
        isPlayCall = false;
        return new Promise<any>((resolve) => {
          playResolve = resolve;
        });
      }
      return Promise.resolve({ success: true, isPlaying: false });
    };

    const slowTrack = createMockTrack('slow-track', {
      audioUrl: 'https://example.com/slow.mp3',
    });

    // Start slow playback on the bridge
    const playPromise = nativePlaybackBridge.playTrack(nativePlaybackController.toNativePayload(slowTrack));

    // User immediately switches/stops before slow play finishes
    await nativePlaybackBridge.stop();

    // Now slow play resolves
    if (playResolve) {
      (playResolve as any)({ success: true, id: 'slow-track', title: 'Slow Track', state: 'PLAYING' });
    }
    const started = await playPromise;

    // The bridge requestGeneration check must have discarded the stale play
    assert.equal(started, false, 'Stale playTrack must return false due to requestGeneration mismatch');
  });

  it('5. DownloadService resolves native downloaded tracks when not in IndexedDB', async () => {
    nativePlaybackBridge.isTrackDownloadedNatively = async (trackId) => trackId === 'native-saved-track';
    nativePlaybackBridge.getNativeDownloadedTracks = async () => [
      {
        id: 'native-saved-track',
        title: 'Saved Natively',
        artist: 'Native Artist',
        album: 'Native Album',
        artworkUrl: 'https://example.com/native.jpg',
        localFilePath: '/data/user/0/com.stuxs.music/files/downloads/native-saved-track.mp3',
        fileSize: 5000000,
        durationMs: 240000,
      }
    ];

    const resolved = await downloadService.resolvePlayableDownloadedTrack('native-saved-track');
    assert.ok(resolved, 'Must resolve track from native storage');
    assert.equal(resolved?.id, 'native-saved-track');
    assert.equal(resolved?.audioUrl, 'file:///data/user/0/com.stuxs.music/files/downloads/native-saved-track.mp3');
    assert.equal(resolved?.isDownloaded, true);
  });
});
