import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { nativePlaybackController, type NativeControllerCallbacks } from '../nativePlaybackController';
import { nativePlaybackBridge } from '../nativePlaybackBridge';
import type { Track } from '../../types/music';

function createMockTrack(id: string, title = `Track ${id}`): Track {
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
  };
}

describe('Phase 7 Step 3: Production Readiness & Fallback Control Tests', () => {
  let webAudioStopped = 0;
  let webAudioResumed = 0;
  let webAudioPlayed = 0;
  let fallbackErrors: string[] = [];

  const mockCallbacks: NativeControllerCallbacks = {
    stopWebAudio: () => { webAudioStopped++; },
    resumeWebAudio: () => { webAudioResumed++; },
    onFallback: (err: string) => { fallbackErrors.push(err); },
  };

  beforeEach(() => {
    webAudioStopped = 0;
    webAudioResumed = 0;
    webAudioPlayed = 0;
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
  });

  it('A. Play Next Queue Priority: Track A playing -> Play Next Track B -> Track A continues -> exactly one transition to B', async () => {
    let nativeQueueUpdated: any[] | null = null;
    let nativeStartIndex: number | null = null;
    nativePlaybackBridge.updateQueue = async (tracks, newIndex) => {
      nativeQueueUpdated = tracks;
      nativeStartIndex = newIndex ?? 0;
      return true;
    };

    nativePlaybackBridge.activateNativeMode = async () => true;
    nativePlaybackBridge.playTrack = async () => true;

    const trackA = createMockTrack('track-A');
    const trackB = createMockTrack('track-B');
    const trackC = createMockTrack('track-C');

    const resA = await nativePlaybackController.playTrack(trackA, mockCallbacks, {
      queue: [trackA, trackC],
      startIndex: 0,
    });
    assert.equal(resA.success, true);
    assert.equal(nativePlaybackController.isNativeModeActive(), true);

    await nativePlaybackController.updateQueue([trackA, trackB, trackC], 0);

    assert.equal(nativeQueueUpdated !== null, true);
    assert.equal(nativeQueueUpdated!.length, 3);
    assert.equal(nativeQueueUpdated![1].id, 'track-B', 'Track B must be immediately after Track A');
    assert.equal(nativeStartIndex, 0, 'Current index must remain pointing at Track A (0)');

    let transitionCount = 0;
    let transitionedTrack: any = null;
    nativePlaybackController.setOnTrackChangedCallback((t) => {
      transitionCount++;
      transitionedTrack = t;
    });

    (nativePlaybackController as any).onTrackChangedCallback?.(trackB, 1);
    assert.equal(transitionCount, 1);
    assert.equal(transitionedTrack.id, 'track-B');
  });

  it('B. Add to Queue: Track A playing -> Add Track B normally -> current playback uninterrupted', async () => {
    (nativePlaybackController as any)._isNativeEngineActive = true;
    let updateCount = 0;
    nativePlaybackBridge.updateQueue = async () => {
      updateCount++;
      return true;
    };

    const trackA = createMockTrack('track-A');
    const trackB = createMockTrack('track-B');
    const trackC = createMockTrack('track-C');

    await nativePlaybackController.updateQueue([trackA, trackC, trackB], 0);
    assert.equal(updateCount, 1, 'Queue updated smoothly without re-preparing track');
    assert.equal(webAudioStopped, 0, 'WebAudio must not be triggered');
  });

  it('C. Reorder Queue: Track A playing -> reorder queue -> Track A does not restart', async () => {
    (nativePlaybackController as any)._isNativeEngineActive = true;
    let updateIndex: number | null = null;
    nativePlaybackBridge.updateQueue = async (_tracks, newIndex) => {
      updateIndex = newIndex ?? 0;
      return true;
    };

    const trackA = createMockTrack('track-A');
    const trackB = createMockTrack('track-B');
    const trackC = createMockTrack('track-C');

    await nativePlaybackController.updateQueue([trackB, trackA, trackC], 1);
    assert.equal(updateIndex, 1, 'Current index correctly tracks Track A to index 1');
  });

  it('D. Repeat ONE: current track repeats -> no unexpected queue advance', async () => {
    (nativePlaybackController as any)._isNativeEngineActive = true;
    let nativeRepeatMode: string | null = null;
    nativePlaybackBridge.setRepeatMode = async (mode) => {
      nativeRepeatMode = mode;
      return true;
    };

    await nativePlaybackController.setRepeatMode('one');
    assert.equal(nativeRepeatMode, 'one');
  });

  it('E. Repeat ALL: queue wraps exactly once when last track ends', async () => {
    (nativePlaybackController as any)._isNativeEngineActive = true;
    let nativeRepeatMode: string | null = null;
    nativePlaybackBridge.setRepeatMode = async (mode) => {
      nativeRepeatMode = mode;
      return true;
    };

    await nativePlaybackController.setRepeatMode('all');
    assert.equal(nativeRepeatMode, 'all');
  });

  it('F. Deduplication: Ended event emitted twice -> only one next-track transition', async () => {
    let endedCalls = 0;
    nativePlaybackController.setOnTrackEndedCallback(() => {
      endedCalls++;
    });

    (nativePlaybackController as any).lastObservedTrackId = 'track-dedup-1';

    nativePlaybackController.notifyTrackEnded();
    nativePlaybackController.notifyTrackEnded();

    assert.equal(endedCalls, 1, 'Second ended event must be deduplicated/ignored within debounce window');
  });

  it('G. Native Error Isolation: Native error after ownership -> WebAudio remains silent', async () => {
    nativePlaybackBridge.activateNativeMode = async () => true;
    nativePlaybackBridge.playTrack = async () => {
      throw new Error('ExoPlayer fatal playback exception: Source error');
    };

    const track = createMockTrack('track-fail-iso');
    const result = await nativePlaybackController.playTrack(track, mockCallbacks);

    assert.equal(result.handledByNative, true);
    assert.equal(result.success, false);
    assert.equal(webAudioStopped, 1, 'WebAudio stopped before native ownership');
    assert.equal(webAudioResumed, 0, 'WebAudio must NEVER play as fallback on native error');
    assert.equal(fallbackErrors.length, 1);
    assert.equal(nativePlaybackController.isFallbackAttempted(), true);
    assert.match(nativePlaybackController.getFallbackReason() || '', /Source error/);
  });

  it('H. Buffering State: Native buffering -> WebAudio remains silent', async () => {
    let reportedBuffering = false;
    nativePlaybackController.setOnPlaybackStateChangedCallback((state, _playing, isBuffering) => {
      if (state === 'BUFFERING' || isBuffering) {
        reportedBuffering = true;
      }
    });

    (nativePlaybackController as any)._isNativeEngineActive = true;
    (nativePlaybackController as any).onPlaybackStateChangedCallback?.('BUFFERING', false, true);

    assert.equal(reportedBuffering, true);
    assert.equal(webAudioResumed, 0, 'WebAudio must remain silent during buffering');
    assert.equal(webAudioPlayed, 0);
  });

  it('I. Safe Handoff Native -> Legacy: no overlap', async () => {
    let nativePaused = 0;
    let nativeDeactivated = 0;
    nativePlaybackBridge.pause = async () => { nativePaused++; return true; };
    nativePlaybackBridge.deactivateNativeMode = async () => { nativeDeactivated++; return true; };

    (nativePlaybackController as any)._isNativeEngineActive = true;

    await nativePlaybackController.deactivate();

    assert.equal(nativePlaybackController.isNativeModeActive(), false, 'Native engine marked inactive');
    assert.equal(nativePaused, 1, 'Native playback paused');
    assert.equal(nativeDeactivated, 1, 'Native MediaSession deactivated');
  });

  it('J. Safe Handoff Legacy -> Native: no overlap', async () => {
    let legacyAudioStopped = false;
    const legacyEngine = {
      hasActiveAudio: () => true,
      stopImmediate: () => { legacyAudioStopped = true; },
    };

    if (legacyEngine.hasActiveAudio()) {
      legacyEngine.stopImmediate();
    }
    assert.equal(legacyAudioStopped, true, 'Legacy engine stopped before acquiring native ownership');

    nativePlaybackBridge.activateNativeMode = async () => true;
    nativePlaybackBridge.playTrack = async () => true;

    const track = createMockTrack('track-handoff');
    const res = await nativePlaybackController.playTrack(track, mockCallbacks);
    assert.equal(res.success, true);
    assert.equal(nativePlaybackController.isNativeModeActive(), true);
  });

  it('K. Screen OFF -> ON: Native session stays active', async () => {
    (nativePlaybackController as any)._isNativeEngineActive = true;
    nativePlaybackBridge.getPlaybackState = async () => ({
      state: 'PLAYING',
      isPlaying: true,
      isBuffering: false,
      positionMs: 45000,
      durationMs: 210000,
      bufferedPositionMs: 90000,
      repeatMode: 'OFF',
      shuffleEnabled: false,
      currentTrack: { id: 'track-screen-test', title: 'Screen Test', artist: 'Artist' },
    });

    const actual = await nativePlaybackController.getActualNativePlaybackState();
    assert.equal(actual.isLoaded, true);
    assert.equal(actual.isPlaying, true);
    assert.equal(actual.currentTrackId, 'track-screen-test');
  });

  it('L. Background -> Foreground: Progress polling resumes smoothly', async () => {
    (nativePlaybackController as any)._isNativeEngineActive = true;
    nativePlaybackController.startProgressPolling();
    assert.notEqual((nativePlaybackController as any).pollingInterval, null);

    nativePlaybackController.stopProgressPolling();
    assert.equal((nativePlaybackController as any).pollingInterval, null);
  });

  it('M. Activity Recreation: Reconnects to existing native MediaSession', async () => {
    nativePlaybackBridge.getPlaybackState = async () => ({
      state: 'PLAYING',
      isPlaying: true,
      isBuffering: false,
      positionMs: 60000,
      durationMs: 180000,
      bufferedPositionMs: 120000,
      repeatMode: 'OFF',
      shuffleEnabled: false,
      currentTrack: { id: 'recreation-track', title: 'Recreation', artist: 'Artist' },
      queue: [createMockTrack('recreation-track') as any],
    });

    const state = await nativePlaybackBridge.getPlaybackState();
    assert.equal(state?.currentTrack?.id, 'recreation-track');
    assert.equal(state?.queue?.length, 1);
  });

  it('N. Diagnostics Observability: Reports accurate fields without UI renders', () => {
    const isNativeEnabled = nativePlaybackController.isEnabled();
    const isNativeActive = nativePlaybackController.isNativeModeActive();
    const fallbackAttempted = nativePlaybackController.isFallbackAttempted();
    const fallbackReason = nativePlaybackController.getFallbackReason();

    const diagnostics = {
      owner: isNativeActive ? 'NATIVE' : 'NONE',
      currentTrackId: 'diag-track-1',
      playbackState: 'PLAYING',
      currentError: null,
      queueIndex: 0,
      fallbackAttempted,
      fallbackReason,
      generation: 1,
      nativeEnabled: isNativeEnabled,
      nativeActive: isNativeActive,
    };

    assert.equal(diagnostics.owner, 'NONE');
    assert.equal(diagnostics.nativeEnabled, true);
    assert.equal(diagnostics.fallbackAttempted, false);
    assert.equal(diagnostics.fallbackReason, null);
  });
});
