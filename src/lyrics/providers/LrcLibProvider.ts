import type { LyricsProvider, LyricsResult } from '../types';
import { parseLrc } from '../parser';

export class LrcLibLyricsProvider implements LyricsProvider {
  id = 'lrclib';
  name = 'LRCLIB (Synced & Plain Lyrics)';

  private cleanTitle(title: string): string {
    return title
      .replace(/\(.*\)/g, '')
      .replace(/\[.*\]/g, '')
      .replace(/feat\..*/i, '')
      .replace(/ft\..*/i, '')
      .trim();
  }

  private cleanArtist(artist: string): string {
    return artist.split(',')[0].split('&')[0].trim();
  }

  async getLyrics(track: {
    id: string;
    title: string;
    artistName: string;
    albumTitle?: string;
    duration?: number;
  }): Promise<LyricsResult | null> {
    const trackName = this.cleanTitle(track.title);
    const artistName = this.cleanArtist(track.artistName);

    if (!trackName) return null;

    try {
      // 1. Try direct exact match with duration
      const params = new URLSearchParams({
        track_name: trackName,
        artist_name: artistName,
      });

      if (track.albumTitle) {
        params.append('album_name', track.albumTitle);
      }
      if (track.duration && track.duration > 0) {
        params.append('duration', String(Math.round(track.duration)));
      }

      const directRes = await fetch(`https://lrclib.net/api/get?${params.toString()}`);
      if (directRes.ok) {
        const data = await directRes.json();
        if (data.syncedLyrics || data.plainLyrics) {
          const synced = data.syncedLyrics ? parseLrc(data.syncedLyrics) : undefined;
          return {
            trackId: track.id,
            title: data.trackName || track.title,
            artist: data.artistName || track.artistName,
            album: data.albumName,
            plainLyrics: data.plainLyrics,
            syncedLyrics: synced && synced.length > 0 ? synced : undefined,
            isSynced: Boolean(synced && synced.length > 0),
            source: 'LRCLIB',
          };
        }
      }

      // 2. Fallback to search endpoint with duration filtering tolerance
      const searchRes = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(`${trackName} ${artistName}`)}`);
      if (searchRes.ok) {
        const list = await searchRes.json();
        if (Array.isArray(list) && list.length > 0) {
          // Find best candidate within 5 seconds duration tolerance or first matching candidate
          let best = list[0];
          if (track.duration && track.duration > 0) {
            const matched = list.find((item) => Math.abs((item.duration || 0) - track.duration!) <= 5);
            if (matched) best = matched;
          }

          if (best && (best.syncedLyrics || best.plainLyrics)) {
            const synced = best.syncedLyrics ? parseLrc(best.syncedLyrics) : undefined;
            return {
              trackId: track.id,
              title: best.trackName || track.title,
              artist: best.artistName || track.artistName,
              album: best.albumName,
              plainLyrics: best.plainLyrics,
              syncedLyrics: synced && synced.length > 0 ? synced : undefined,
              isSynced: Boolean(synced && synced.length > 0),
              source: 'LRCLIB',
            };
          }
        }
      }
    } catch {
      // Graceful fallback
    }

    return null;
  }
}
