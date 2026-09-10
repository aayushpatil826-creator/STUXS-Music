export interface SyncedLyricLine {
  timeMs: number;
  text: string;
}

export interface LyricsResult {
  trackId?: string;
  title?: string;
  artist?: string;
  album?: string;
  plainLyrics?: string;
  syncedLyrics?: SyncedLyricLine[];
  source?: string;
  isSynced?: boolean;
}

export interface LyricsProvider {
  id: string;
  name: string;
  getLyrics(track: {
    id: string;
    title: string;
    artistName: string;
    albumTitle?: string;
    duration?: number;
    provider?: string;
    providerId?: string;
  }): Promise<LyricsResult | null>;
}
