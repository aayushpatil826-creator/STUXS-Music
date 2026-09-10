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

describe('Phase 7 Step 2: Lifecycle Hardening & Single Audio Authority Tests', () => {
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
  });

  afterEach(() => {
    nativePlaybackController.setOnPlaybackStateChangedCallback(null);
    nativePlaybackController.setOnTrackChangedCallback(null);
    nativePlaybackController.setOnTrackEndedCallback(null);
    nativePlaybackController.setProgressCallback(null);
    nativePlaybackController.stopProgressPolling();
  });

  it('1. Strict Single Audio Authority: Native play failure MUST NOT resume WebAudio when native is enabled', async () => {
    nativePlaybackBridge.activateNativeMode = async () => true;
    nativePlaybackBridge.playTrack = async () => {
      throw new Error('Decoder failed or network offline');
    };

    const track = createMockTrack('track-err-1');
    const result = await nativePlaybackController.playTrack(track, mockCallbacks);

    assert.equal(result.handledByNative, true, 'Must be handled by native');
    assert.equal(result.success, false, 'Must report failure');
    assert.equal(webAudioStopped, 1, 'WebAudio must be stopped before native play');
    assert.equal(webAudioResumed, 0, 'WebAudio MUST NEVER be resumed on native failure');
    assert.equal(fallbackErrors.length, 1, 'Error must be reported to fallback callback');
    assert.match(fallbackErrors[0], /Decoder failed or network offline/);
  });

  it('2. Single Audio Authority: Native pause MUST NOT invoke webAudioPause callback', async () => {
    let nativePauseCalled = 0;
    nativePlaybackBridge.pause = async () => {
      nativePauseCalled++;
      return true;
    };

    (nativePlaybackController as any)._isNativeEngineActive = true;
    await nativePlaybackController.pause(() => {
      webAudioPaused++;
    });

    assert.equal(nativePauseCalled, 1, 'Native bridge pause must be called');
    assert.equal(webAudioPaused, 0, 'WebAudio pause callback MUST NOT be called when native is enabled');
  });

  it('3. Single Audio Authority: Native resume MUST NOT invoke webAudioResume callback', async () => {
    let nativeResumeCalled = 0;
    nativePlaybackBridge.resume = async () => {
      nativeResumeCalled++;
      return true;
    };

    await nativePlaybackController.resume(() => {
      webAudioResumed++;
    });

    assert.equal(nativeResumeCalled, 1, 'Native bridge resume must be called');
    assert.equal(webAudioResumed, 0, 'WebAudio resume callback MUST NOT be called when native is enabled');
  });

  it('4. Reconnection vs Restart: getActualNativePlaybackState detects active playback without re-preparing track', async () => {
    nativePlaybackBridge.getPlaybackState = async () => ({
      state: 'PLAYING',
      isPlaying: true,
      isBuffering: false,
      positionMs: 45000,
      durationMs: 210000,
      bufferedPositionMs: 90000,
      repeatMode: 'OFF',
      shuffleEnabled: false,
      currentIndex: 0,
      queueLength: 1,
      currentTrack: {
        id: 'track-reconnect-1',
        title: 'Playing Song',
        artist: 'Authoritative Artist',
      },
    });

    const state = await nativePlaybackController.getActualNativePlaybackState();
    assert.equal(state.isLoaded, true, 'Engine must report isLoaded = true');
    assert.equal(state.currentTrackId, 'track-reconnect-1', 'Must match current native track ID');
    assert.equal(state.isPlaying, true, 'Must report isPlaying = true');
    assert.equal(state.state, 'PLAYING');
  });

  it('5. Queue Restoration: getPlaybackState returns serialized queue for Activity recreation recovery', async () => {
    nativePlaybackBridge.getPlaybackState = async () => ({
      state: 'PLAYING',
      isPlaying: true,
      isBuffering: false,
      positionMs: 12000,
      durationMs: 180000,
      bufferedPositionMs: 50000,
      repeatMode: 'ALL',
      shuffleEnabled: true,
      currentIndex: 1,
      queueLength: 3,
      queue: [
        { id: 'q-1', title: 'Song 1', artist: 'Artist 1', durationMs: 180000, provider: 'jiosaavn' },
        { id: 'q-2', title: 'Song 2', artist: 'Artist 2', durationMs: 200000, provider: 'jiosaavn' },
        { id: 'q-3', title: 'Song 3', artist: 'Artist 3', durationMs: 220000, provider: 'jiosaavn' },
      ],
      currentTrack: {
        id: 'q-2',
        title: 'Song 2',
        artist: 'Artist 2',
      },
    });

    const state = await nativePlaybackBridge.getPlaybackState();
    assert.ok(state && Array.isArray(state.queue), 'Queue must be an array');
    assert.equal(state?.queue?.length, 3, 'Must contain 3 tracks');
    assert.equal(state?.queue?.[1].id, 'q-2');
    assert.equal(state?.currentIndex, 1);
    assert.equal(state?.repeatMode, 'ALL');
    assert.equal(state?.shuffleEnabled, true);
  });
});
