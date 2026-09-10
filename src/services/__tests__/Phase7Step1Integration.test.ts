import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { nativePlaybackController } from '../nativePlaybackController';
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
    provider: 'jiosaavn',
    isPlayable: true,
    accessStatus: 'playable',
  };
}

describe('Phase 7 Step 1: Native Playback & UI Integration Tests', () => {
  let listeners: Record<string, ((data: any) => void)[]> = {};
  let updatedQueues: { queue: any[]; startIndex?: number }[] = [];
  let skipNextCalled = 0;
  let skipPrevCalled = 0;
  let deactivateCalled = 0;
  let pauseCalled = 0;

  beforeEach(() => {
    listeners = {};
    updatedQueues = [];
    skipNextCalled = 0;
    skipPrevCalled = 0;
    deactivateCalled = 0;
    pauseCalled = 0;

    nativePlaybackBridge.isAvailable = () => true;
    nativePlaybackController.isEnabled = () => true;
    (nativePlaybackController as any)._isNativeEngineActive = true;
    (nativePlaybackController as any).eventListenersInitialized = false;

    nativePlaybackBridge.addListener = ((eventName: string, handler: (data: any) => void) => {
      if (!listeners[eventName]) {
        listeners[eventName] = [];
      }
      listeners[eventName].push(handler);
      return Promise.resolve({ remove: () => {} });
    }) as any;

    nativePlaybackBridge.updateQueue = async (queue: any[], startIndex?: number) => {
      updatedQueues.push({ queue, startIndex });
      return true;
    };

    nativePlaybackBridge.skipToNext = async () => {
      skipNextCalled++;
      return true;
    };

    nativePlaybackBridge.skipToPrevious = async () => {
      skipPrevCalled++;
      return true;
    };

    nativePlaybackBridge.pause = async () => {
      pauseCalled++;
      return true;
    };

    nativePlaybackBridge.deactivateNativeMode = async () => {
      deactivateCalled++;
      return true;
    };
  });

  afterEach(() => {
    nativePlaybackController.setOnPlaybackStateChangedCallback(null);
    nativePlaybackController.setOnTrackChangedCallback(null);
    nativePlaybackController.setOnTrackEndedCallback(null);
    nativePlaybackController.setProgressCallback(null);
    nativePlaybackController.stopProgressPolling();
  });

  it('1. playbackStateChanged event propagates isPlaying and isBuffering correctly to observer', async () => {
    let capturedState = '';
    let capturedIsPlaying = false;
    let capturedIsBuffering = false;
    let callbackCount = 0;

    nativePlaybackController.setOnPlaybackStateChangedCallback((state, isPlaying, isBuffering) => {
      capturedState = state;
      capturedIsPlaying = isPlaying;
      capturedIsBuffering = isBuffering;
      callbackCount++;
    });

    const stateListeners = listeners['playbackStateChanged'] || [];
    assert.ok(stateListeners.length > 0, 'playbackStateChanged listener must be registered');

    stateListeners[0]({
      state: 'BUFFERING',
      isPlaying: false,
      isBuffering: true,
    });

    assert.equal(capturedState, 'BUFFERING');
    assert.equal(capturedIsPlaying, false);
    assert.equal(capturedIsBuffering, true);
    assert.equal(callbackCount, 1);

    stateListeners[0]({
      state: 'PLAYING',
      isPlaying: true,
      isBuffering: false,
    });

    assert.equal(capturedState, 'PLAYING');
    assert.equal(capturedIsPlaying, true);
    assert.equal(capturedIsBuffering, false);
    assert.equal(callbackCount, 2);
  });

  it('2. skipToNext and skipToPrevious return boolean confirmation from bridge', async () => {
    let nextRes = await nativePlaybackController.skipToNext();
    assert.equal(nextRes, true);
    assert.equal(skipNextCalled, 1);

    let prevRes = await nativePlaybackController.skipToPrevious();
    assert.equal(prevRes, true);
    assert.equal(skipPrevCalled, 1);

    nativePlaybackBridge.skipToNext = async () => false;
    nextRes = await nativePlaybackController.skipToNext();
    assert.equal(nextRes, false);
  });

  it('3. updateQueue correctly synchronizes native queue and active index', async () => {
    const track1 = createMockTrack('track-1');
    const track2 = createMockTrack('track-2');
    const track3 = createMockTrack('track-3');

    await nativePlaybackController.updateQueue([track1, track2, track3], 1);

    assert.equal(updatedQueues.length, 1);
    assert.equal(updatedQueues[0].queue.length, 3);
    assert.equal(updatedQueues[0].queue[0].id, 'track-1');
    assert.equal(updatedQueues[0].startIndex, 1);
  });

  it('4. trackChanged event notifies listener with track and index', async () => {
    let receivedTrack: any = null;
    let receivedIndex: number | undefined = undefined;

    nativePlaybackController.setOnTrackChangedCallback((track, index) => {
      receivedTrack = track;
      receivedIndex = index;
    });

    const trackListeners = listeners['trackChanged'] || [];
    assert.ok(trackListeners.length > 0, 'trackChanged listener must be registered');

    trackListeners[0]({
      id: 'song-auto-next',
      title: 'Auto Next Song',
      artist: 'Artist',
      currentIndex: 2,
      durationMs: 180000,
    });

    assert.ok(receivedTrack);
    assert.equal(receivedTrack.id, 'song-auto-next');
    assert.equal(receivedIndex, 2);
  });

  it('5. playbackEnded event triggers onTrackEndedCallback and stops polling', async () => {
    let endedCalled = false;
    nativePlaybackController.setOnTrackEndedCallback(() => {
      endedCalled = true;
    });
    nativePlaybackController.setOnPlaybackStateChangedCallback(() => {});

    const endedListeners = listeners['playbackEnded'] || [];
    assert.ok(endedListeners.length > 0, 'playbackEnded listener must be registered');

    endedListeners[0]({});
    assert.equal(endedCalled, true);
  });

  it('6. deactivate() ensures Media3 is stopped cleanly for mutual exclusion', async () => {
    await nativePlaybackController.deactivate();
    assert.equal(deactivateCalled, 1);
    assert.equal(pauseCalled, 1);
    assert.equal(nativePlaybackController.isNativeModeActive(), false);
  });

  it('7. Native playback state discriminates cold-start vs loaded media item', async () => {
    nativePlaybackBridge.getPlaybackState = async () => ({
      state: 'IDLE',
      isPlaying: false,
      isBuffering: false,
      positionMs: 0,
      durationMs: 0,
      bufferedPositionMs: 0,
      currentIndex: -1,
      repeatMode: 'off',
      shuffleEnabled: false,
    } as any);

    const coldState = await nativePlaybackController.getActualNativePlaybackState();
    assert.equal(coldState.isLoaded, false);
    assert.equal(coldState.isPlaying, false);

    nativePlaybackBridge.getPlaybackState = async () => ({
      state: 'PLAYING',
      isPlaying: true,
      isBuffering: false,
      positionMs: 15000,
      durationMs: 180000,
      bufferedPositionMs: 30000,
      currentIndex: 0,
      currentTrack: { id: 'song-123', title: 'Playing Song' } as any,
      repeatMode: 'off',
      shuffleEnabled: false,
    } as any);

    const activeState = await nativePlaybackController.getActualNativePlaybackState();
    assert.equal(activeState.isLoaded, true);
    assert.equal(activeState.currentTrackId, 'song-123');
    assert.equal(activeState.isPlaying, true);
    assert.equal(activeState.state, 'PLAYING');
  });
});
