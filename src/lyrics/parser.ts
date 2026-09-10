import type { SyncedLyricLine } from './types';

/**
 * Parses raw LRC string into sorted SyncedLyricLine array.
 * Example LRC input:
 * [00:12.34] First line text
 * [00:15.50] Second line text
 */
export function parseLrc(lrcText: string): SyncedLyricLine[] {
  if (!lrcText) return [];

  const lines = lrcText.split('\n');
  const result: SyncedLyricLine[] = [];
  const timeRegex = /\[(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?\]/g;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    timeRegex.lastIndex = 0;
    const matches: { timeMs: number }[] = [];
    let match: RegExpExecArray | null;

    while ((match = timeRegex.exec(trimmed)) !== null) {
      const minutes = parseInt(match[1], 10) || 0;
      const seconds = parseInt(match[2], 10) || 0;
      let ms = 0;
      if (match[3]) {
        ms = parseInt(match[3].padEnd(3, '0').slice(0, 3), 10) || 0;
      }
      const totalMs = minutes * 60 * 1000 + seconds * 1000 + ms;
      matches.push({ timeMs: totalMs });
    }

    if (matches.length > 0) {
      const text = trimmed.replace(/\[\d{1,2}:\d{1,2}(?:\.\d{1,3})?\]/g, '').trim();
      for (const m of matches) {
        result.push({
          timeMs: m.timeMs,
          text,
        });
      }
    }
  }

  // Sort chronologically by timeMs
  result.sort((a, b) => a.timeMs - b.timeMs);
  return result;
}

/**
 * Binary search to find the active lyric line index for the current playback position in milliseconds.
 * Returns -1 if before the first line.
 */
export function findActiveLyricIndex(syncedLyrics: SyncedLyricLine[], currentTimeMs: number): number {
  if (!syncedLyrics || syncedLyrics.length === 0) return -1;
  if (currentTimeMs < syncedLyrics[0].timeMs) return -1;

  let low = 0;
  let high = syncedLyrics.length - 1;
  let activeIndex = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (syncedLyrics[mid].timeMs <= currentTimeMs) {
      activeIndex = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return activeIndex;
}
