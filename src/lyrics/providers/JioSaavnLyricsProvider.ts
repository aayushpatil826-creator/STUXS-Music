import type { LyricsProvider, LyricsResult } from '../types';
import { isDevEnvironment } from '../../utils/platform';

export class JioSaavnLyricsProvider implements LyricsProvider {
  id = 'jiosaavn';
  name = 'JioSaavn Official Lyrics';

  async getLyrics(track: {
    id: string;
    title: string;
    artistName: string;
    provider?: string;
    providerId?: string;
  }): Promise<LyricsResult | null> {
    const isDev = isDevEnvironment();

    const envProc = (globalThis as unknown as { process?: { env?: Record<string, string> } }).process;
    const configuredApiUrl =
      (typeof import.meta !== 'undefined' && import.meta.env?.VITE_JIOSAAVN_API_URL) ||
      envProc?.env?.VITE_JIOSAAVN_API_URL ||
      '';

    const baseUrl = configuredApiUrl
      ? configuredApiUrl
      : isDev
      ? '/api/jiosaavn/api.php'
      : 'https://www.jiosaavn.com/api.php';

    const rawId = track.providerId || track.id.replace('jiosaavn-track-', '');

    try {
      // Fetch lyrics directly via JioSaavn lyrics.getLyrics endpoint
      const lyricsUrl = `${baseUrl}?__call=lyrics.getLyrics&_format=json&cc=in&lyrics_id=${encodeURIComponent(rawId)}`;
      const res = await fetch(lyricsUrl);
      if (res.ok) {
        const data = await res.json();
        if (data.lyrics) {
          const plainLyrics = data.lyrics
            .replace(/<br\s*[\/]?>/gi, '\n')
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&#039;/g, "'")
            .trim();

          if (plainLyrics) {
            return {
              trackId: track.id,
              title: track.title,
              artist: track.artistName,
              plainLyrics,
              source: 'JioSaavn',
              isSynced: false,
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
