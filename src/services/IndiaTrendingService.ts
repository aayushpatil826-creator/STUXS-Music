import type { Track } from '../types/music';
import { providerRegistry } from '../providers/ProviderRegistry';
import { cleanText, normalizeTransliteration } from '../utils/searchIntelligence';

export interface TrendingScoreBreakdown {
  chartRankScore: number;
  playCountScore: number;
  multiChartBonus: number;
  regionalBonus: number;
  verifiedMasterBonus: number;
  totalScore: number;
}

export interface ScoredTrendingTrack {
  track: Track;
  score: TrendingScoreBreakdown;
}

export type TrendingCacheSource = 'external' | 'stuxs_fallback';

export interface TrendingCacheEntry {
  tracks: Track[];
  timestamp: number;
  source: TrendingCacheSource;
}

const CACHE_KEY = 'stuxs_india_trending_cache';
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// Legitimate regional Indian languages supported in India Trending
const INDIAN_LANGUAGES = new Set([
  'hindi',
  'punjabi',
  'marathi',
  'tamil',
  'telugu',
  'malayalam',
  'kannada',
  'bengali',
  'bhojpuri',
  'gujarati',
  'haryanvi',
  'rajasthani',
  'odia',
  'assamese',
  'urdu',
]);

export class IndiaTrendingService {
  private static instance: IndiaTrendingService;
  private memoryCache: TrendingCacheEntry | null = null;
  private inFlightPromise: Promise<Track[]> | null = null;

  public static getInstance(): IndiaTrendingService {
    if (!IndiaTrendingService.instance) {
      IndiaTrendingService.instance = new IndiaTrendingService();
    }
    return IndiaTrendingService.instance;
  }

  public constructor() {
    this.hydrateFromStorage();
  }

  private hydrateFromStorage(): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = window.localStorage.getItem(CACHE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.tracks) && typeof parsed.timestamp === 'number') {
            const source: TrendingCacheSource = parsed.source === 'stuxs_fallback' ? 'stuxs_fallback' : 'external';
            if (Date.now() - parsed.timestamp < CACHE_TTL) {
              this.memoryCache = { tracks: parsed.tracks, timestamp: parsed.timestamp, source };
            }
          }
        }
      }
    } catch {}
  }

  private persistToStorage(tracks: Track[], source: TrendingCacheSource): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        // If current stored cache is genuine external, do NOT overwrite with stuxs_fallback
        if (source === 'stuxs_fallback') {
          const existing = window.localStorage.getItem(CACHE_KEY);
          if (existing) {
            try {
              const p = JSON.parse(existing);
              if (p && p.source === 'external' && Array.isArray(p.tracks) && p.tracks.length > 0) {
                // Do not overwrite genuine external cache with fallback
                return;
              }
            } catch {}
          }
        }
        window.localStorage.setItem(
          CACHE_KEY,
          JSON.stringify({ tracks, timestamp: Date.now(), source })
        );
      }
    } catch {}
  }

  public getCachedTrending(): Track[] | null {
    if (this.memoryCache && Date.now() - this.memoryCache.timestamp < CACHE_TTL) {
      return this.memoryCache.tracks;
    }
    return null;
  }

  public getCacheProvenance(): TrendingCacheSource | null {
    if (this.memoryCache && Date.now() - this.memoryCache.timestamp < CACHE_TTL) {
      return this.memoryCache.source;
    }
    return null;
  }

  public clearCache(): void {
    this.memoryCache = null;
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(CACHE_KEY);
      }
    } catch {}
  }

  /**
   * Bounded timeout wrapper for provider calls.
   */
  private async withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
    ]);
  }

  /**
   * Validates whether a track is a legitimate full-length playable audio track.
   * Strictly filters out SoundCloud, previews, blocked or empty streams.
   */
  public isValidTrendingTrack(track: Track): boolean {
    if (!track || !track.id) return false;
    if ((track.provider as string) === 'soundcloud' || track.id.startsWith('soundcloud-')) {
      return false;
    }
    if (track.isPreview === true || track.playbackType === 'preview') {
      return false;
    }
    if (track.isPlayable === false || track.accessStatus === 'blocked') {
      return false;
    }
    if (!track.audioUrl || typeof track.audioUrl !== 'string' || !track.audioUrl.trim()) {
      return false;
    }
    // Previews on iTunes are strictly <= 30s
    if (track.provider === 'itunes' && track.duration && track.duration <= 30) {
      return false;
    }
    return true;
  }

  /**
   * Generates a normalized canonical key for cross-provider deduplication.
   */
  public getCanonicalSongKey(track: Track): string {
    const rawTitle = (track.title || '')
      .toLowerCase()
      .replace(/\(.*?\)/g, '')
      .replace(/\[.*?\]/g, '')
      .replace(/- (original|remastered|version|from.*)/g, '')
      .trim();

    const rawArtist = (track.artistName || '')
      .split(',')[0]
      .split('&')[0]
      .toLowerCase()
      .trim();

    const cleanT = cleanText(rawTitle);
    const cleanA = cleanText(rawArtist);

    return `${normalizeTransliteration(cleanT)}:::${normalizeTransliteration(cleanA)}`;
  }

  /**
   * Computes a deterministic, explainable normalized score for a candidate trending track.
   */
  public computeTrendingScore(
    track: Track,
    chartPosition: number,
    totalChartHits: number
  ): TrendingScoreBreakdown {
    // 1. Chart Rank Score: 100 max, linear decay based on chart position
    const chartRankScore = Math.max(10, Math.round(100 - chartPosition * 1.5));

    // 2. Play Count / Popularity Signal: Logarithmic scale up to 50 max
    const playCount = track.playCount || 0;
    let playCountScore = 0;
    if (playCount > 1000) {
      playCountScore = Math.min(50, Math.round(Math.log10(playCount) * 7.5));
    }

    // 3. Multi-Chart Bonus: +30 if validated across multiple official charts
    const multiChartBonus = totalChartHits > 1 ? 30 : 0;

    // 4. Regional Indian Language or Verified International in India Bonus: +20
    let regionalBonus = 0;
    const textToCheck = `${track.albumTitle || ''} ${track.label || ''} ${track.language || ''} ${track.title || ''} ${track.artistName || ''}`.toLowerCase();
    const isIndianLang =
      Array.from(INDIAN_LANGUAGES).some((l) => textToCheck.includes(l)) ||
      track.provider === 'jiosaavn' ||
      track.provider === 'gaana';

    if (isIndianLang) {
      regionalBonus = 20;
    }

    // 5. Studio Verified Master Bonus: +15 for 320kbps full stream
    let verifiedMasterBonus = 0;
    if (track.actualBitrate?.includes('320') || track.audioFormat?.includes('320')) {
      verifiedMasterBonus = 15;
    } else if (track.isPlayable) {
      verifiedMasterBonus = 5;
    }

    const totalScore = chartRankScore + playCountScore + multiChartBonus + regionalBonus + verifiedMasterBonus;

    return {
      chartRankScore,
      playCountScore,
      multiChartBonus,
      regionalBonus,
      verifiedMasterBonus,
      totalScore,
    };
  }

  /**
   * Main entrypoint: Retrieves genuine provider-backed "Trending in India" music.
   * Results are deduplicated, normalized, and cached.
   */
  public async getTrendingInIndia(limit = 20): Promise<Track[]> {
    // 1. Check warm in-memory cache — return immediately for Frame-0 display
    const cached = this.getCachedTrending();
    if (cached && cached.length > 0) {
      return cached.slice(0, limit);
    }

    // 2. Reuse in-flight fetch to prevent duplicate concurrent network calls
    if (this.inFlightPromise) {
      return this.inFlightPromise;
    }

    this.inFlightPromise = this.fetchAndRankTrending(limit)
      .catch((err) => {
        console.warn('[IndiaTrendingService] Fetch failed, falling back to cache/STUXS catalog:', err);
        if (this.memoryCache?.tracks && this.memoryCache.tracks.length > 0) {
          return this.memoryCache.tracks;
        }
        return [];
      })
      .finally(() => {
        this.inFlightPromise = null;
      });

    return this.inFlightPromise;
  }

  private async fetchAndRankTrending(limit: number): Promise<Track[]> {
    const rawCandidates: { track: Track; position: number; chartName: string }[] = [];
    const chartHitCount = new Map<string, number>();

    const jiosaavn = providerRegistry.getProvider('jiosaavn');
    const gaana = providerRegistry.getProvider('gaana');
    const stuxs = providerRegistry.getProvider('stuxs');

    // 1. Fetch Primary Source 1: JioSaavn official charts and popular data
    if (jiosaavn && jiosaavn.isAvailable) {
      let verifiedChartPlaylists: { id: string; title: string }[] = [];

      try {
        const chartsUrl = 'https://www.jiosaavn.com/api.php?__call=content.getCharts&_format=json&cc=in';
        const searchChartsUrl = 'https://www.jiosaavn.com/api.php?__call=search.getPlaylistResults&_format=json&cc=in&p=1&n=15&q=India+Superhits+Top+50';

        const [chartsRes, searchRes] = await Promise.all([
          this.withTimeout(fetch(chartsUrl), 3500, null),
          this.withTimeout(fetch(searchChartsUrl), 3500, null),
        ]);

        if (chartsRes && chartsRes.ok) {
          try {
            const data = await chartsRes.json();
            if (Array.isArray(data)) {
              for (const c of data) {
                const id = String(c.id || c.listid || '');
                const title = String(c.title || c.listname || '');
                if (id && title && (title.includes('Top 50') || title.includes('Trending') || title.includes('India'))) {
                  verifiedChartPlaylists.push({ id, title });
                }
              }
            }
          } catch {}
        }

        if (searchRes && searchRes.ok) {
          try {
            const searchData = await searchRes.json();
            for (const item of searchData.results || []) {
              const id = String(item.listid || item.id || '');
              const title = String(item.listname || item.title || '');
              if (id && title && !verifiedChartPlaylists.some((p) => p.id === id)) {
                verifiedChartPlaylists.push({ id, title });
              }
            }
          } catch {}
        }
      } catch (err) {
        console.warn('[IndiaTrendingService] Error verifying dynamic charts:', err);
      }

      // Verified stable chart playlist IDs (reused from existing JioSaavn chart catalog)
      if (verifiedChartPlaylists.length === 0) {
        verifiedChartPlaylists = [
          { id: '1134548194', title: 'India Superhits Top 50' },
          { id: '1134543272', title: 'Hindi: India Superhits Top 50' },
          { id: '110858205', title: 'Trending Today' },
          { id: '1134543511', title: 'Punjabi: India Superhits Top 50' },
          { id: '1134651042', title: 'Tamil: India Superhits Top 50' },
          { id: '1134643225', title: 'Telugu: India Superhits Top 50' },
          { id: '1134710071', title: 'Marathi: India Superhits Top 50' },
          { id: '1134705865', title: 'Malayalam: India Superhits Top 50' },
          { id: '1134595537', title: 'International : India Superhits Top 50' },
        ];
      }

      // Fetch top chart playlists in parallel with bounded timeouts
      const chartFetchPromises = verifiedChartPlaylists.slice(0, 6).map(async ({ id, title }) => {
        try {
          const playlist = await this.withTimeout(jiosaavn.getPlaylist(id), 4000, null);
          if (playlist && Array.isArray(playlist.songs)) {
            playlist.songs.forEach((song, idx) => {
              if (this.isValidTrendingTrack(song)) {
                rawCandidates.push({ track: song, position: idx + 1, chartName: title });
                const key = this.getCanonicalSongKey(song);
                chartHitCount.set(key, (chartHitCount.get(key) || 0) + 1);
              }
            });
          }
        } catch {}
      });

      await Promise.allSettled(chartFetchPromises);

      // Discovery fallback if chart playlists returned fewer than 10 songs
      if (rawCandidates.length < 10 && typeof jiosaavn.search === 'function') {
        try {
          const fallbackSearch = await this.withTimeout(
            jiosaavn.search('Trending Songs India'),
            3500,
            { tracks: [], artists: [], albums: [], playlists: [] }
          );
          if (fallbackSearch && Array.isArray(fallbackSearch.tracks)) {
            fallbackSearch.tracks.forEach((track, idx) => {
              if (this.isValidTrendingTrack(track)) {
                rawCandidates.push({ track, position: idx + 1, chartName: 'JioSaavn Trending Search' });
                const key = this.getCanonicalSongKey(track);
                chartHitCount.set(key, (chartHitCount.get(key) || 0) + 1);
              }
            });
          }
        } catch {}
      }
    }

    // 2. Fetch Primary Source 2: Gaana trending/popular tracks
    if (gaana && gaana.isAvailable && typeof gaana.search === 'function') {
      try {
        const gaanaSearchResults = await this.withTimeout(
          gaana.search('Trending India'),
          3500,
          { tracks: [], artists: [], albums: [], playlists: [] }
        );
        if (gaanaSearchResults && Array.isArray(gaanaSearchResults.tracks)) {
          gaanaSearchResults.tracks.forEach((track, idx) => {
            if (this.isValidTrendingTrack(track)) {
              rawCandidates.push({ track, position: idx + 1, chartName: 'Gaana Trending' });
              const key = this.getCanonicalSongKey(track);
              chartHitCount.set(key, (chartHitCount.get(key) || 0) + 1);
            }
          });
        }
      } catch {}
    }

    // 3. If external providers produced valid candidates: score, deduplicate, and persist
    if (rawCandidates.length > 0) {
      const deduplicatedMap = new Map<string, ScoredTrendingTrack>();

      for (const { track, position } of rawCandidates) {
        const key = this.getCanonicalSongKey(track);
        const hits = chartHitCount.get(key) || 1;
        const score = this.computeTrendingScore(track, position, hits);

        const existing = deduplicatedMap.get(key);
        if (!existing) {
          deduplicatedMap.set(key, { track, score });
        } else {
          // If duplicate canonical track exists across providers or charts:
          // Keep the higher score, and retain the highest bitrate / master audio quality
          const preferNewTrack =
            (track.actualBitrate?.includes('320') && !existing.track.actualBitrate?.includes('320')) ||
            score.totalScore > existing.score.totalScore;

          const highestScore = score.totalScore > existing.score.totalScore ? score : existing.score;
          const bestTrack = preferNewTrack ? track : existing.track;

          deduplicatedMap.set(key, { track: bestTrack, score: highestScore });
        }
      }

      // Sort deterministically descending by score
      const scoredList = Array.from(deduplicatedMap.values());
      scoredList.sort((a, b) => {
        if (b.score.totalScore !== a.score.totalScore) {
          return b.score.totalScore - a.score.totalScore;
        }
        // Deterministic tie-breaker
        const keyA = cleanText(a.track.title) + cleanText(a.track.artistName);
        const keyB = cleanText(b.track.title) + cleanText(b.track.artistName);
        return keyA.localeCompare(keyB);
      });

      const finalTracks = scoredList.map((item) => item.track);

      if (finalTracks.length > 0) {
        this.memoryCache = { tracks: finalTracks, timestamp: Date.now(), source: 'external' };
        this.persistToStorage(finalTracks, 'external');
        return finalTracks.slice(0, limit);
      }
    }

    // 4. If external providers produced ZERO candidates:
    // Check if we have cached genuine external trending (e.g. offline)
    if (this.memoryCache?.tracks && this.memoryCache.tracks.length > 0 && this.memoryCache.source === 'external') {
      return this.memoryCache.tracks.slice(0, limit);
    }

    // Check storage for genuine external cached trending
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = window.localStorage.getItem(CACHE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.tracks) && parsed.tracks.length > 0 && parsed.source === 'external') {
            this.memoryCache = { tracks: parsed.tracks, timestamp: parsed.timestamp || Date.now(), source: 'external' };
            return parsed.tracks.slice(0, limit);
          }
        }
      }
    } catch {}

    // 5. Final Graceful Fallback ONLY: STUXS first-party catalog (when external providers completely fail)
    if (stuxs && 'getPublishedCatalogTracks' in stuxs && typeof (stuxs as any).getPublishedCatalogTracks === 'function') {
      try {
        const stuxsTracks: Track[] = await (stuxs as any).getPublishedCatalogTracks(limit);
        if (Array.isArray(stuxsTracks)) {
          const validFallback = stuxsTracks.filter((t) => this.isValidTrendingTrack(t));
          if (validFallback.length > 0) {
            this.memoryCache = { tracks: validFallback, timestamp: Date.now(), source: 'stuxs_fallback' };
            // Note: do not persist fallback as genuine external trending in localStorage
            return validFallback.slice(0, limit);
          }
        }
      } catch {}
    }

    return [];
  }
}

export const indiaTrendingService = IndiaTrendingService.getInstance();
