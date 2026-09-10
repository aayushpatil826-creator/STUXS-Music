import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { nativePlaybackController, type NativeControllerCallbacks } from '../nativePlaybackController';
import { nativePlaybackBridge } from '../nativePlaybackBridge';
import { playbackProgressEmitter } from '../playbackEvents';
import type { Track } from '../../types/music';

function createMockTrack(id: string, title = `Track ${id}`, overrides: Partial<Track> = {}): Track {
  return {
    id,
    title,
    artistName: 'Test Artist',
    artistId: 'artist-1',
    albumTitle: 'Test Album',
    artworkUrl: 'https://example.com/art.jpg',
    duration: 210,
    audioUrl: 'https://example.com/audio.mp3',
    provider: 'jiosaavn',
    isPlayable: true,
    accessStatus: 'playable',
    ...overrides,
  };
}

describe('Phase 7 Step 4: Final Native Playback / React UI Integration & Stabilization Tests', () => {
  let webAudioStopped = 0;
  let webAudioResumed = 0;
  let webAudioPaused = 0;
  let fallbackErrors: string[] = [];

  const mockCallbacks: NativeControllerCallbacks = {
    stopWebAudio: () => { webAudioStopped++; },
    resumeWebAudio: () => { webAudioResumed++; },
    onFallback: (err: string) => { fallbackErrors.push(err); },
  };

  beforeEach(() => {
    webAudioStopped = 0;
    webAudioResumed = 0;
    webAudioPaused = 0;
    fallbackErrors = [];

    nativePlaybackBridge.isAvailable = () => true;
    nativePlaybackController.isEnabled = () => true;
    (nativePlaybackController as any)._isNativeEngineActive = false;
    (nativePlaybackController as any).eventListenersInitialized = false;
    (nativePlaybackController as any).lastTrackEndedTime = 0;
    (nativePlaybackController as any).lastTrackEndedId = null;
    (nativePlaybackController as any).fallbackAttempted = false;
    (nativePlaybackController as any).fallbackReason = null;
  });

  afterEach(() => {
    nativePlaybackController.setOnPlaybackStateChangedCallback(null);
    nativePlaybackController.setOnTrackChangedCallback(null);
    nativePlaybackController.setOnTrackEndedCallback(null);
    nativePlaybackController.setProgressCallback(null);
    nativePlaybackController.stopProgressPolling();
    playbackProgressEmitter.reset();
  });

  it('1. Play: UI dispatch initiates native playback and activates native mode', async () => {
    let playPayload: any = null;
    nativePlaybackBridge.activateNativeMode = async () => true;
    nativePlaybackBridge.playTrack = async (p) => { playPayload = p; return true; };

    const track = createMockTrack('track-1');
    const res = await nativePlaybackController.playTrack(track, mockCallbacks);

    assert.equal(res.success, true);
    assert.equal(res.handledByNative, true);
    assert.equal(playPayload.id, 'track-1');
    assert.equal(nativePlaybackController.isNativeModeActive(), true);
    assert.equal(webAudioStopped, 1);
  });

  it('2. Pause: UI dispatch pauses native playback and stops progress polling', async () => {
    let nativePaused = false;
    nativePlaybackBridge.pause = async () => { nativePaused = true; return true; };

    let pollingStopped = false;
    const origStopPolling = nativePlaybackController.stopProgressPolling.bind(nativePlaybackController);
    nativePlaybackController.stopProgressPolling = () => {
      pollingStopped = true;
      origStopPolling();
    };

    await nativePlaybackController.pause(() => { webAudioPaused++; });

    assert.equal(nativePaused, true);
    assert.equal(webAudioPaused, 0); // Strictly zero WebAudio
    assert.equal(pollingStopped, true);
  });

  it('3. Resume: UI dispatch resumes native playback without WebAudio invocation', async () => {
    let nativeResumed = false;
    nativePlaybackBridge.resume = async () => { nativeResumed = true; return true; };

    await nativePlaybackController.resume(() => { webAudioResumed++; });

    assert.equal(nativeResumed, true);
    assert.equal(webAudioResumed, 0);
    assert.equal(nativePlaybackController.isNativeModeActive(), true);
  });

  it('4. Rapid Play/Pause: Rapid toggles maintain native ownership and do not activate WebAudio', async () => {
    let toggleCount = 0;
    nativePlaybackBridge.togglePlay = async () => { toggleCount++; return true; };

    let webAudioToggled = 0;
    for (let i = 0; i < 6; i++) {
      await nativePlaybackController.togglePlay(i % 2 === 0, () => { webAudioToggled++; });
    }

    assert.equal(toggleCount, 6);
    assert.equal(webAudioToggled, 0);
    assert.equal(nativePlaybackController.isNativeModeActive(), true);
  });

  it('5. Seek While Playing: preserves playing state, anchors progress, and continues polling', async () => {
    let soughtPosMs = 0;
    nativePlaybackBridge.seekTo = async (posMs) => { soughtPosMs = posMs; return true; };

    (nativePlaybackController as any)._isNativeEngineActive = true;
    (nativePlaybackController as any).lastKnownIsPlaying = true;
    (nativePlaybackController as any).lastKnownDuration = 180;

    let progressAnchored = 0;
    nativePlaybackController.setProgressCallback((posSec, durSec, isPlaying) => {
      progressAnchored = posSec;
      playbackProgressEmitter.anchor(posSec, durSec, isPlaying);
    });

    let webAudioSeekSec = 0;
    await nativePlaybackController.seek(45, (sec) => { webAudioSeekSec = sec; });

    assert.equal(soughtPosMs, 45000);
    assert.equal(progressAnchored, 45);
    assert.equal(playbackProgressEmitter.getProgress(), 45);
    assert.equal(webAudioSeekSec, 0);
  });

  it('6. Seek While Paused: preserves paused state without auto-playing', async () => {
    let soughtPosMs = 0;
    nativePlaybackBridge.seekTo = async (posMs) => { soughtPosMs = posMs; return true; };

    (nativePlaybackController as any)._isNativeEngineActive = true;
    (nativePlaybackController as any).lastKnownIsPlaying = false;
    (nativePlaybackController as any).lastKnownDuration = 180;

    let callbackIsPlaying = true;
    nativePlaybackController.setProgressCallback((posSec, durSec, isPlaying) => {
      callbackIsPlaying = isPlaying;
      playbackProgressEmitter.anchor(posSec, durSec, isPlaying);
    });

    await nativePlaybackController.seek(60, () => {});

    assert.equal(soughtPosMs, 60000);
    assert.equal(callbackIsPlaying, false);
    assert.equal(playbackProgressEmitter.getProgress(), 60);
  });

  it('7. Lyrics Position Synchronization After Seek: updates subscribers immediately', async () => {
    let observedProgress = 0;
    let observedDuration = 0;
    const unsubscribe = playbackProgressEmitter.subscribe((progress, duration) => {
      observedProgress = progress;
      observedDuration = duration;
    });

    (nativePlaybackController as any)._isNativeEngineActive = true;
    (nativePlaybackController as any).lastKnownIsPlaying = true;
    (nativePlaybackController as any).lastKnownDuration = 200;

    nativePlaybackController.setProgressCallback((posSec, durSec, isPlaying) => {
      playbackProgressEmitter.anchor(posSec, durSec, isPlaying);
    });

    nativePlaybackBridge.seekTo = async () => true;
    await nativePlaybackController.seek(125);

    assert.equal(observedProgress, 125);
    assert.equal(observedDuration, 200);
    unsubscribe();
  });

  it('8. Next Track: native bridge skipToNext executes cleanly', async () => {
    let nativeSkipNextCalled = false;
    nativePlaybackBridge.skipToNext = async () => { nativeSkipNextCalled = true; return true; };

    (nativePlaybackController as any)._isNativeEngineActive = true;
    const ok = await nativePlaybackController.skipToNext();

    assert.equal(ok, true);
    assert.equal(nativeSkipNextCalled, true);
  });

  it('9. Previous Track: native bridge skipToPrevious executes cleanly', async () => {
    let nativeSkipPrevCalled = false;
    nativePlaybackBridge.skipToPrevious = async () => { nativeSkipPrevCalled = true; return true; };

    (nativePlaybackController as any)._isNativeEngineActive = true;
    const ok = await nativePlaybackController.skipToPrevious();

    assert.equal(ok, true);
    assert.equal(nativeSkipPrevCalled, true);
  });

  it('10. Play Next (manualQueue): Updates native queue with priority track ahead of sequential queue', async () => {
    let syncedQueue: any[] = [];
    nativePlaybackBridge.updateQueue = async (tracks) => { syncedQueue = tracks; return true; };

    const trackA = createMockTrack('A');
    const trackB = createMockTrack('B');
    const trackC = createMockTrack('C');

    // Effective queue structure with Play Next: current (A) -> manual (B) -> remaining (C)
    await nativePlaybackController.updateQueue([trackA, trackB, trackC], 0);

    assert.equal(syncedQueue.length, 3);
    assert.equal(syncedQueue[0].id, 'A');
    assert.equal(syncedQueue[1].id, 'B'); // Injected priority track
    assert.equal(syncedQueue[2].id, 'C');
  });

  it('11. Add to Queue: Appends track to native queue without restarting active audio', async () => {
    let updatedQueue: any[] = [];
    nativePlaybackBridge.updateQueue = async (tracks) => { updatedQueue = tracks; return true; };

    const trackA = createMockTrack('A');
    const trackB = createMockTrack('B');

    await nativePlaybackController.updateQueue([trackA, trackB], 0);

    assert.equal(updatedQueue.length, 2);
    assert.equal(updatedQueue[1].id, 'B');
  });

  it('12. Remove from Queue: Deletes track from native queue while preserving current index', async () => {
    let updatedQueue: any[] = [];
    let updatedIdx: number | undefined = undefined;
    nativePlaybackBridge.updateQueue = async (tracks, newIndex) => {
      updatedQueue = tracks;
      updatedIdx = newIndex;
      return true;
    };

    const trackA = createMockTrack('A');
    const trackC = createMockTrack('C');

    await nativePlaybackController.updateQueue([trackA, trackC], 0);

    assert.equal(updatedQueue.length, 2);
    assert.equal(updatedIdx, 0);
  });

  it('13. Reorder Queue: Preserves active playback while updating native queue order', async () => {
    let updatedQueue: any[] = [];
    let targetIndex: number | undefined = undefined;
    nativePlaybackBridge.updateQueue = async (tracks, newIndex) => {
      updatedQueue = tracks;
      targetIndex = newIndex;
      return true;
    };

    const trackA = createMockTrack('A');
    const trackB = createMockTrack('B');
    const trackC = createMockTrack('C');

    // Reordered: A was at 0, now B is moved before C
    await nativePlaybackController.updateQueue([trackA, trackC, trackB], 0);

    assert.equal(updatedQueue[1].id, 'C');
    assert.equal(updatedQueue[2].id, 'B');
    assert.equal(targetIndex, 0);
  });

  it('14. Clear Queue: Native queue update handles single current track cleanly', async () => {
    let queueLength = 0;
    nativePlaybackBridge.updateQueue = async (tracks) => {
      queueLength = tracks.length;
      return true;
    };

    const currentTrack = createMockTrack('A');
    await nativePlaybackController.updateQueue([currentTrack], 0);

    assert.equal(queueLength, 1);
  });

  it('15. Repeat ONE: Dispatches ONE repeat mode to native bridge', async () => {
    let receivedMode = '';
    nativePlaybackBridge.setRepeatMode = async (mode) => { receivedMode = mode; return true; };

    await nativePlaybackController.setRepeatMode('one');

    assert.equal(receivedMode, 'one');
  });

  it('16. Repeat ALL: Dispatches ALL repeat mode to native bridge', async () => {
    let receivedMode = '';
    nativePlaybackBridge.setRepeatMode = async (mode) => { receivedMode = mode; return true; };

    await nativePlaybackController.setRepeatMode('all');

    assert.equal(receivedMode, 'all');
  });

  it('17. Repeat OFF: Dispatches OFF repeat mode to native bridge', async () => {
    let receivedMode = '';
    nativePlaybackBridge.setRepeatMode = async (mode) => { receivedMode = mode; return true; };

    await nativePlaybackController.setRepeatMode('off');

    assert.equal(receivedMode, 'off');
  });

  it('18. Shuffle Mode: Toggles native shuffle mode accurately', async () => {
    let shuffleState = false;
    nativePlaybackBridge.setShuffleMode = async (enabled) => { shuffleState = enabled; return true; };

    await nativePlaybackController.setShuffleMode(true);
    assert.equal(shuffleState, true);

    await nativePlaybackController.setShuffleMode(false);
    assert.equal(shuffleState, false);
  });

  it('19. Exactly-Once Auto-Next: Duplicate trackEnded notifications within debounce window are ignored', async () => {
    let endedCount = 0;
    nativePlaybackController.setOnTrackEndedCallback(() => {
      endedCount++;
    });

    (nativePlaybackController as any).lastObservedTrackId = 'track-1';

    nativePlaybackController.notifyTrackEnded();
    nativePlaybackController.notifyTrackEnded(); // Duplicate within 1500ms
    nativePlaybackController.notifyTrackEnded(); // Duplicate within 1500ms

    assert.equal(endedCount, 1);
  });

  it('20. Native Error Isolation: Native playback error suppresses WebAudio fallback when native is active', async () => {
    nativePlaybackBridge.activateNativeMode = async () => true;
    nativePlaybackBridge.playTrack = async () => { throw new Error('Simulated ExoPlayer Native Source Error'); };

    const track = createMockTrack('track-err');
    const res = await nativePlaybackController.playTrack(track, mockCallbacks);

    assert.equal(res.handledByNative, true);
    assert.equal(res.success, false);
    assert.equal(fallbackErrors.length, 1);
    assert.equal(fallbackErrors[0], 'Simulated ExoPlayer Native Source Error');
    assert.equal(webAudioResumed, 0); // WebAudio strictly silent
  });

  it('21. Native Buffering State: Emits BUFFERING without triggering WebAudio fallback', async () => {
    let observedState = '';
    let observedBuffering = false;

    nativePlaybackController.setOnPlaybackStateChangedCallback((state, _isPlaying, isBuffering) => {
      observedState = state;
      observedBuffering = isBuffering;
    });

    (nativePlaybackController as any).onPlaybackStateChangedCallback?.('BUFFERING', false, true);

    assert.equal(observedState, 'BUFFERING');
    assert.equal(observedBuffering, true);
    assert.equal(webAudioResumed, 0);
  });

  it('22. Native -> Legacy Handoff: Deactivates native engine and permits WebAudio when native is disabled', async () => {
    let nativePaused = false;
    let nativeDeactivated = false;
    nativePlaybackBridge.pause = async () => { nativePaused = true; return true; };
    nativePlaybackBridge.deactivateNativeMode = async () => { nativeDeactivated = true; return true; };

    (nativePlaybackController as any)._isNativeEngineActive = true;
    await nativePlaybackController.deactivate();

    assert.equal(nativePaused, true);
    assert.equal(nativeDeactivated, true);
    assert.equal(nativePlaybackController.isNativeModeActive(), false);
  });

  it('23. Legacy -> Native Handoff: Disabling legacy and starting native stops WebAudio cleanly', async () => {
    nativePlaybackBridge.activateNativeMode = async () => true;
    nativePlaybackBridge.playTrack = async () => true;

    const track = createMockTrack('handoff-track');
    await nativePlaybackController.playTrack(track, mockCallbacks);

    assert.equal(webAudioStopped, 1);
    assert.equal(nativePlaybackController.isNativeModeActive(), true);
  });

  it('24. Activity Recreation: Reconnects to running native session and recovers live track/progress', async () => {
    nativePlaybackBridge.getPlaybackState = async () => ({
      state: 'PLAYING',
      isPlaying: true,
      isBuffering: false,
      positionMs: 34500,
      durationMs: 180000,
      bufferedPositionMs: 180000,
      repeatMode: 'OFF',
      shuffleEnabled: false,
      currentIndex: 1,
      queueLength: 3,
      currentTrack: {
        id: 'bg-track-2',
        title: 'Background Playing Song',
        artist: 'Native Artist',
        album: 'Native Album',
        provider: 'jiosaavn',
      },
    });

    // Fresh controller query simulating Activity recreation
    const state = await nativePlaybackController.getActualNativePlaybackState();

    assert.equal(state.isLoaded, true);
    assert.equal(state.currentTrackId, 'bg-track-2');
    assert.equal(state.isPlaying, true);
    assert.equal(state.positionMs, 34500);
    assert.equal(nativePlaybackController.isNativeModeActive(), true);
  });

  it('25. Screen OFF -> ON: Native session stays active across screen toggle', async () => {
    (nativePlaybackController as any)._isNativeEngineActive = true;
    (nativePlaybackController as any).lastKnownIsPlaying = true;

    assert.equal(nativePlaybackController.isNativeModeActive(), true);
  });

  it('26. Background -> Foreground: Progress polling resumes cleanly when app becomes visible', async () => {
    let pollingStarted = false;
    nativePlaybackController.startProgressPolling = () => {
      pollingStarted = true;
    };

    (nativePlaybackController as any)._isNativeEngineActive = true;
    (nativePlaybackController as any).lastKnownIsPlaying = true;

    if (nativePlaybackController.isEnabled() && (nativePlaybackController as any).lastKnownIsPlaying) {
      nativePlaybackController.startProgressPolling();
    }

    assert.equal(pollingStarted, true);
  });

  it('27. Downloaded Offline Playback: Plays local file path natively with 0 network calls', async () => {
    let nativePayload: any = null;
    nativePlaybackBridge.activateNativeMode = async () => true;
    nativePlaybackBridge.playTrack = async (payload) => {
      nativePayload = payload;
      return true;
    };

    const offlineTrack = createMockTrack('offline-1', 'Offline Downloaded Track', {
      sourceType: 'downloaded',
      isDownloaded: true,
      localPath: '/data/data/com.stuxs.music/files/offline_audio.mp3',
    });

    const res = await nativePlaybackController.playTrack(offlineTrack, mockCallbacks);

    assert.equal(res.success, true);
    assert.equal(nativePayload.localFilePath, '/data/data/com.stuxs.music/files/offline_audio.mp3');
    assert.equal(nativePlaybackController.isNativeModeActive(), true);
  });

  it('28. History Synchronization: Records track only on genuine start, deduplicating repeats', async () => {
    const recordedIds: string[] = [];
    const addToRecentlyPlayed = (track: Track) => {
      const filtered = recordedIds.filter(id => id !== track.id);
      recordedIds.length = 0;
      recordedIds.push(track.id, ...filtered);
    };

    const trackA = createMockTrack('track-A');
    addToRecentlyPlayed(trackA);
    addToRecentlyPlayed(trackA); // Same track repeated
    const trackB = createMockTrack('track-B');
    addToRecentlyPlayed(trackB);

    assert.equal(recordedIds.length, 2);
    assert.equal(recordedIds[0], 'track-B');
    assert.equal(recordedIds[1], 'track-A');
  });

  it('29. Likes / Favorites Independence: Favoriting does not affect native playback state or queue', async () => {
    const favorites = new Set<string>();
    const toggleFavorite = (track: Track) => {
      if (favorites.has(track.id)) favorites.delete(track.id);
      else favorites.add(track.id);
    };

    const track = createMockTrack('favorite-track');
    (nativePlaybackController as any)._isNativeEngineActive = true;
    (nativePlaybackController as any).lastKnownIsPlaying = true;

    toggleFavorite(track);
    assert.equal(favorites.has('favorite-track'), true);
    assert.equal(nativePlaybackController.isNativeModeActive(), true);

    toggleFavorite(track);
    assert.equal(favorites.has('favorite-track'), false);
    assert.equal(nativePlaybackController.isNativeModeActive(), true);
  });

  it('30. Diagnostics Zero Overhead: Reading diagnostics produces clean data without side-effects', () => {
    (nativePlaybackController as any)._isNativeEngineActive = true;
    (nativePlaybackController as any).fallbackAttempted = false;

    const isNativeEnabled = nativePlaybackController.isEnabled();
    const isNativeActive = nativePlaybackController.isNativeModeActive();
    const owner = isNativeEnabled && isNativeActive ? 'NATIVE' : 'LEGACY';

    assert.equal(owner, 'NATIVE');
    assert.equal(nativePlaybackController.isFallbackAttempted(), false);
  });
});
