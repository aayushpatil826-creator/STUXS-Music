import { registerPlugin } from '@capacitor/core';
import type { Track } from '../types/music';
import { isNativePlatform } from './platform';
import { nativePlaybackController } from '../services/nativePlaybackController';

export interface NativePlaybackDiagnostics {
  deviceManufacturer: string;
  deviceBrand: string;
  deviceModel: string;
  androidVersion: string;
  sdkInt: number;
  isServiceBound: boolean;
  isForegroundRunning: boolean;
  isMediaSessionActive: boolean;
  playbackState: string;
  currentTitle: string;
  currentArtist: string;
  hasArtworkBitmap: boolean;
  hasNotificationPermission: boolean;
  isIgnoringBatteryOptimizations: boolean;
  oemLiveCapsuleCapability: boolean;
}

interface NativeMediaSessionPlugin {
  setMetadata(options: {
    title: string;
    artist: string;
    album: string;
    artworkUrl: string;
    duration: number;
    isPlaying: boolean;
    position: number;
  }): Promise<void>;

  setPlaybackState(options: {
    isPlaying: boolean;
    position: number;
    duration: number;
  }): Promise<void>;

  stop(): Promise<void>;

  checkNotificationPermission(): Promise<{ granted: boolean }>;
  requestNotificationPermission(): Promise<{ requested: boolean }>;
  getDiagnostics(): Promise<NativePlaybackDiagnostics>;
  openBatteryOptimizationSettings(): Promise<void>;
  openNotificationSettings(): Promise<void>;

  addListener(
    eventName: 'mediaAction',
    listenerFunc: (data: { action: string; position?: number }) => void
  ): Promise<{ remove: () => Promise<void> }>;
}

const NativeMediaSession = registerPlugin<NativeMediaSessionPlugin>('NativeMediaSession');

let actionListenerHandle: { remove: () => Promise<void> } | null = null;

export async function checkNativeNotificationPermission(): Promise<boolean> {
  if (!isNativePlatform()) return true;
  try {
    const res = await NativeMediaSession.checkNotificationPermission();
    return res.granted;
  } catch {
    return false;
  }
}

export async function requestNativeNotificationPermission(): Promise<void> {
  if (!isNativePlatform()) return;
  try {
    await NativeMediaSession.requestNotificationPermission();
  } catch {}
}

export async function getNativePlaybackDiagnostics(): Promise<NativePlaybackDiagnostics | null> {
  if (!isNativePlatform()) return null;
  try {
    return await NativeMediaSession.getDiagnostics();
  } catch (err) {
    console.debug('[NativeMediaSession] Failed to get diagnostics:', err);
    return null;
  }
}

export async function openNativeBatteryOptimizationSettings(): Promise<void> {
  if (!isNativePlatform()) return;
  try {
    await NativeMediaSession.openBatteryOptimizationSettings();
  } catch (err) {
    console.debug('[NativeMediaSession] Failed to open battery settings:', err);
  }
}

export async function openNativeNotificationSettings(): Promise<void> {
  if (!isNativePlatform()) return;
  try {
    await NativeMediaSession.openNotificationSettings();
  } catch (err) {
    console.debug('[NativeMediaSession] Failed to open notification settings:', err);
  }
}

export async function updateNativeMediaMetadata(
  track: Track | null,
  isPlaying: boolean,
  position = 0
): Promise<void> {
  if (!isNativePlatform() || !track) return;
  // When Native Media3 mode is active, native StuxsMedia3PlaybackService owns metadata and notification
  if (nativePlaybackController.isEnabled()) return;

  const validPos = typeof position === 'number' && !isNaN(position) ? Math.max(0, Math.round(position)) : 0;
  const validDur = typeof track.duration === 'number' && !isNaN(track.duration) ? Math.max(0, Math.round(track.duration)) : 0;

  try {
    await NativeMediaSession.setMetadata({
      title: track.title || 'STUXS Music',
      artist: track.artistName || 'STUXS Artist',
      album: track.albumTitle || 'STUXS Music',
      artworkUrl: track.artworkUrl || '',
      duration: validDur,
      isPlaying,
      position: validPos,
    });
  } catch (err) {
    console.debug('[NativeMediaSession] Failed to update metadata:', err);
  }
}

export async function updateNativePlaybackState(
  isPlaying: boolean,
  position = 0,
  duration = 0
): Promise<void> {
  if (!isNativePlatform()) return;
  // When Native Media3 mode is active, native StuxsMedia3PlaybackService owns playback state
  if (nativePlaybackController.isEnabled()) return;

  const validPos = typeof position === 'number' && !isNaN(position) ? Math.max(0, Math.round(position)) : 0;
  const validDur = typeof duration === 'number' && !isNaN(duration) ? Math.max(0, Math.round(duration)) : 0;

  try {
    await NativeMediaSession.setPlaybackState({
      isPlaying,
      position: validPos,
      duration: validDur,
    });
  } catch (err) {
    console.debug('[NativeMediaSession] Failed to update playback state:', err);
  }
}

export async function stopNativeMediaSession(): Promise<void> {
  if (!isNativePlatform()) return;

  try {
    await NativeMediaSession.stop();
  } catch (err) {
    console.debug('[NativeMediaSession] Failed to stop session:', err);
  }
}

export async function initNativeMediaActionListener(
  onAction: (action: string, position?: number) => void
): Promise<() => void> {
  if (!isNativePlatform()) return () => {};

  try {
    if (actionListenerHandle) {
      await actionListenerHandle.remove();
      actionListenerHandle = null;
    }

    actionListenerHandle = await NativeMediaSession.addListener('mediaAction', (data) => {
      onAction(data.action, data.position);
    });

    return () => {
      actionListenerHandle?.remove();
      actionListenerHandle = null;
    };
  } catch (err) {
    console.debug('[NativeMediaSession] Failed to init action listener:', err);
    return () => {};
  }
}