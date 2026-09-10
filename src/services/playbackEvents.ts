// High-performance isolated playback progress subscription system
// Decouples high-frequency playback time updates and smooth local interpolation
// from broad React Context trees. Only subscribed scrubber/timer components re-render.

import { useState, useEffect } from 'react';

type ProgressListener = (currentTime: number, duration: number) => void;

class PlaybackProgressEmitter {
  private listeners = new Set<ProgressListener>();
  private currentProgress = 0;
  private currentDuration = 0;

  /**
   * Emits authoritative playback position from player engine without polling or timers.
   */
  public anchor(currentTime: number, duration: number, _isPlaying?: boolean): void {
    this.currentProgress = Math.max(0, currentTime);
    if (duration > 0) {
      this.currentDuration = duration;
    }
    this.notifySubscribers();
  }

  public emit(currentTime: number, duration: number): void {
    this.anchor(currentTime, duration);
  }

  public setIsPlaying(_playing: boolean): void {
    // No-op for timers: CSS transitions provide smooth client-side interpolation
  }

  private notifySubscribers(): void {
    for (const listener of this.listeners) {
      listener(this.currentProgress, this.currentDuration);
    }
  }

  public subscribe(listener: ProgressListener): () => void {
    this.listeners.add(listener);
    listener(this.currentProgress, this.currentDuration);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getProgress(): number {
    return this.currentProgress;
  }

  public getDuration(): number {
    return this.currentDuration;
  }

  public reset(): void {
    this.currentProgress = 0;
    this.currentDuration = 0;
    this.notifySubscribers();
  }
}

export const playbackProgressEmitter = new PlaybackProgressEmitter();

/**
 * Lightweight hook that ONLY re-renders the specific component consuming it
 * (e.g. seek bars, timestamp displays, lyrics sync), leaving AppLayout, BottomNav,
 * HomeFeed, and Library lists completely unaffected.
 */
export function usePlaybackProgress() {
  const [progressState, setProgressState] = useState(() => ({
    progress: playbackProgressEmitter.getProgress(),
    duration: playbackProgressEmitter.getDuration(),
  }));

  useEffect(() => {
    return playbackProgressEmitter.subscribe((progress, duration) => {
      setProgressState({ progress, duration });
    });
  }, []);

  return progressState;
}
