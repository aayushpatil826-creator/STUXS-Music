import type { LyricsProvider, LyricsResult } from './types';
import { LrcLibLyricsProvider } from './providers/LrcLibProvider';
import { JioSaavnLyricsProvider } from './providers/JioSaavnLyricsProvider';
import type { Track } from '../types/music';

export class LyricsService {
  private static instance: LyricsService;
  private providers: LyricsProvider[] = [];
  private cache = new Map<string, LyricsResult | null>();
  private inFlightRequests = new Map<string, Promise<LyricsResult | null>>();

  private constructor() {
    this.providers.push(new LrcLibLyricsProvider());
    this.providers.push(new JioSaavnLyricsProvider());
  }

  public static getInstance(): LyricsService {
    if (!LyricsService.instance) {
      LyricsService.instance = new LyricsService();
    }
    return LyricsService.instance;
  }

  private getCacheKey(track: Track): string {
    const pKey = `${track.provider || 'unknown'}:${track.id}`;
    const tKey = `${track.title.toLowerCase().trim()}::${track.artistName.toLowerCase().trim()}`;
    return `${pKey}::${tKey}`;
  }

  /**
   * Retrieves lyrics for a track. Checks in-memory cache first, then executes
   * provider lookup chain with in-flight deduplication.
   */
  public async getLyrics(track: Track): Promise<LyricsResult | null> {
    if (!track || !track.title) return null;

    const cacheKey = this.getCacheKey(track);

    // 1. Return from in-memory cache immediately if present
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey) || null;
    }

    // 2. Return existing in-flight promise if already being fetched
    if (this.inFlightRequests.has(cacheKey)) {
      return this.inFlightRequests.get(cacheKey)!;
    }

    // 3. Execute lookup chain
    const fetchPromise = (async () => {
      // If track has embedded lyrics array (e.g. Mock/curated tracks)
      if (track.lyrics && track.lyrics.length > 0) {
        const result: LyricsResult = {
          trackId: track.id,
          title: track.title,
          artist: track.artistName,
          plainLyrics: track.lyrics.join('\n'),
          source: 'Embedded Catalog',
          isSynced: false,
        };
        this.cache.set(cacheKey, result);
        return result;
      }

      // Query external providers in order (LrcLib -> JioSaavn)
      for (const provider of this.providers) {
        try {
          const res = await provider.getLyrics({
            id: track.id,
            title: track.title,
            artistName: track.artistName,
            albumTitle: track.albumTitle,
            duration: track.duration,
            provider: track.provider,
            providerId: track.providerId,
          });

          if (res && (res.syncedLyrics || res.plainLyrics)) {
            this.cache.set(cacheKey, res);
            return res;
          }
        } catch {
          // Continue to next provider
        }
      }

      // No lyrics found
      this.cache.set(cacheKey, null);
      return null;
    })().finally(() => {
      this.inFlightRequests.delete(cacheKey);
    });

    this.inFlightRequests.set(cacheKey, fetchPromise);
    return fetchPromise;
  }

  /**
   * Prefetches lyrics in the background without blocking the UI.
   */
  public prefetchLyrics(track: Track): void {
    if (!track) return;
    const cacheKey = this.getCacheKey(track);
    if (!this.cache.has(cacheKey) && !this.inFlightRequests.has(cacheKey)) {
      this.getLyrics(track).catch(() => {});
    }
  }

  /**
   * Clears in-memory cache if needed.
   */
  public clearCache(): void {
    this.cache.clear();
    this.inFlightRequests.clear();
  }
}

export const lyricsService = LyricsService.getInstance();
