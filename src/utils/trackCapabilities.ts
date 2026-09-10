import type { Track, PlaybackType } from '../types/music';

/**
 * Determines the genuine playback capability of a track.
 * STUXS supports only full-length audio playback (JioSaavn, Gaana, STUXS Catalog, Local, Downloaded).
 * If no full-length stream is available, the track is marked 'blocked' (unavailable).
 */
export function getTrackPlaybackType(track: Track | null | undefined): PlaybackType {
  if (!track) return 'blocked';
  if (track.accessStatus === 'blocked' || track.isPlayable === false) return 'blocked';

  if (track.playbackType) {
    return track.playbackType;
  }

  return 'full';
}

/**
 * Returns formatted track duration for UI display: "3:45".
 */
export function formatTrackDuration(track: Track | null | undefined): string {
  if (!track) return '0:00';
  const seconds = track.duration || 0;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}
