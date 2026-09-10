import type { Track, Album, Artist, Playlist } from '../types/music';
import { providerRegistry } from '../providers/ProviderRegistry';
import { cleanText } from '../utils/searchIntelligence';
import { indiaTrendingService } from './IndiaTrendingService';
import { curatedPlaylistService } from './CuratedPlaylistService';
import { localCacheService } from './LocalCacheService';
import { networkStateService } from './NetworkStateService';

export interface BecauseYouPlayedSection {
  seedTrack: Track;
  tracks: Track[];
}

export interface HomeFeedData {
  heroTrack: Track | null;
  quickPicks: Track[];
  madeForYou: Track[];
  popularInIndia: Track[];
  trendingNow: Track[];
  becauseYouPlayed?: BecauseYouPlayedSection;
  featuredPlaylists: Playlist[];
  featuredAlbums: Album[];
  featuredArtists: Artist[];
  isLoading: boolean;
}

export interface UserSignals {
  recentlyPlayed: Track[];
  favorites: Track[];
  playlists: Playlist[];
}

// Helper to filter out mock, invalid, or preview-only tracks
export const isValidHomeTrack = (t: Track | null | undefined): boolean => {
  if (!t || !t.id || !t.title || !t.artistName) return false;
  if (t.id.startsWith('mock-')) return false;
  if (t.isPreview || t.accessStatus === 'preview' || t.accessStatus === 'blocked') return false;

  const titleLower = t.title.toLowerCase();
  // Filter out multi-song YouTube video compilations and playlists
  if (
    titleLower.includes('full album') ||
    titleLower.includes('jukebox') ||
    titleLower.includes('top 10') ||
    titleLower.includes('top 50') ||
    titleLower.includes('all songs') ||
    titleLower.includes('audio jukebox') ||
    titleLower.includes('video jukebox') ||
    titleLower.includes('mashup non stop')
  ) {
    return false;
  }

  // Duration sanity check (between 50s and 660s)
  if (t.duration && (t.duration < 50 || t.duration > 660)) {
    return false;
  }

  return true;
};

type CulturalDomain =
  | 'marathi_devotional'
  | 'punjabi'
  | 'bollywood_hindi'
  | 'south_indian'
  | 'western_rock_pop'
  | 'general';

function detectTrackDomain(track: Track): { domain: CulturalDomain; isDevotional: boolean; queryKeywords: string[] } {
  const text = `${track.title || ''} ${track.artistName || ''} ${track.albumTitle || ''} ${track.genre || ''} ${track.language || ''}`.toLowerCase();

  const isMarathiDevotional =
    text.includes('lalbaug') ||
    text.includes('ganpati') ||
    text.includes('ganesh') ||
    text.includes('bappa') ||
    text.includes('moraya') ||
    text.includes('aarti') ||
    text.includes('marathi') ||
    text.includes('sukhkarta') ||
    text.includes('dukhharta') ||
    text.includes('ashtavinayak') ||
    text.includes('vighnaharta') ||
    text.includes('bhajan') ||
    text.includes('pandurang') ||
    text.includes('vitthal') ||
    text.includes('abhang');

  if (isMarathiDevotional) {
    return {
      domain: 'marathi_devotional',
      isDevotional: true,
      queryKeywords: ['Ganpati Aarti Marathi', 'Lalbaugcha Raja Songs', 'Ganesh Devotional Marathi'],
    };
  }

  const isPunjabi =
    text.includes('punjabi') ||
    text.includes('bhangra') ||
    text.includes('sidhu') ||
    text.includes('dhillon') ||
    text.includes('diljit') ||
    text.includes('karan aujla') ||
    text.includes('shubh') ||
    text.includes('jatt') ||
    text.includes('patiala');

  if (isPunjabi) {
    return {
      domain: 'punjabi',
      isDevotional: false,
      queryKeywords: ['Top Punjabi Hits', 'Punjabi Pop Beats'],
    };
  }

  const isSouthIndian =
    text.includes('tamil') ||
    text.includes('telugu') ||
    text.includes('malayalam') ||
    text.includes('kannada') ||
    text.includes('anirudh') ||
    text.includes('ilayaraja') ||
    text.includes('ar rahman') ||
    text.includes('sid sriram');

  if (isSouthIndian) {
    return {
      domain: 'south_indian',
      isDevotional: false,
      queryKeywords: ['Top Tamil Hits', 'Top Telugu Songs'],
    };
  }

  const isWestern =
    text.includes('arctic monkeys') ||
    text.includes('coldplay') ||
    text.includes('weeknd') ||
    text.includes('drake') ||
    text.includes('eminem') ||
    text.includes('taylor swift') ||
    text.includes('linkin park') ||
    text.includes('radiohead') ||
    text.includes('queen') ||
    text.includes('rock') ||
    text.includes('indie rock') ||
    text.includes('metal');

  if (isWestern) {
    return {
      domain: 'western_rock_pop',
      isDevotional: false,
      queryKeywords: ['Alternative Rock Hits', 'Indie Rock Essentials'],
    };
  }

  return {
    domain: 'bollywood_hindi',
    isDevotional: false,
    queryKeywords: ['Bollywood Top Hits', 'Hindi Romance Hits'],
  };
}

function scoreRecommendationCandidate(seedTrack: Track, candidate: Track, seedDomain: CulturalDomain): number {
  if (!candidate || !candidate.id || candidate.id === seedTrack.id) return -Infinity;
  if (!isValidHomeTrack(candidate)) return -Infinity;

  const candidateDomain = detectTrackDomain(candidate).domain;

  // STRICT RELEVANCE GUARD:
  // If seed is Marathi/Devotional and candidate is Western (or vice versa), apply disqualifying penalty
  if (
    (seedDomain === 'marathi_devotional' && candidateDomain === 'western_rock_pop') ||
    (seedDomain === 'western_rock_pop' && (candidateDomain === 'marathi_devotional' || candidateDomain === 'punjabi'))
  ) {
    return -999;
  }

  let score = 0;

  const seedArtistClean = cleanText(seedTrack.artistName || '').toLowerCase();
  const candArtistClean = cleanText(candidate.artistName || '').toLowerCase();
  const seedTitleClean = cleanText(seedTrack.title || '').toLowerCase();
  const candTitleClean = cleanText(candidate.title || '').toLowerCase();

  // 1. Primary Artist Match (+70 pts)
  if (
    candArtistClean === seedArtistClean ||
    (seedArtistClean.length > 3 && candArtistClean.includes(seedArtistClean)) ||
    (candArtistClean.length > 3 && seedArtistClean.includes(candArtistClean))
  ) {
    score += 70;
  }

  // 2. Cultural / Linguistic Domain Match (+50 pts)
  if (seedDomain === candidateDomain) {
    score += 50;
  } else if (seedDomain === 'marathi_devotional' && candidateDomain === 'bollywood_hindi') {
    // Some Bollywood Ganesh songs (e.g. Deva Shree Ganesha, Mourya Re) are relevant
    const isDevotionalHindi =
      candTitleClean.includes('ganpati') ||
      candTitleClean.includes('ganesh') ||
      candTitleClean.includes('deva') ||
      candTitleClean.includes('mourya') ||
      candTitleClean.includes('aarti');
    if (isDevotionalHindi) {
      score += 45;
    } else {
      score -= 30; // Generic Hindi pop penalty when seed is Marathi Devotional
    }
  }

  // 3. Keyword / Thematic Overlap (+30 pts)
  const seedTokens = seedTitleClean.split(/\s+/).filter((w) => w.length > 3);
  for (const token of seedTokens) {
    if (candTitleClean.includes(token)) {
      score += 30;
      break;
    }
  }

  return score;
}

class HomeDiscoveryService {
  private cache: { data: HomeFeedData; timestamp: number; signature: string } | null = null;
  private readonly CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes cache TTL
  private readonly STORAGE_KEY = 'stuxs_home_feed_cache_v2';
  private featuredPlaylistsMap = new Map<string, Playlist>();
  private inFlightPromise: Promise<HomeFeedData> | null = null;
  private discoverPlaylistsCache = new Map<string, { data: Playlist[]; timestamp: number }>();
  private discoverPlaylistsInFlight = new Map<string, Promise<Playlist[]>>();
  private readonly DISCOVER_PLAYLISTS_STORAGE_KEY = 'stuxs_discover_playlists_cache_v1';

  /**
   * Synchronously retrieves the cached feed from memory or localStorage.
   * If not cached yet, creates an immediate baseline from user signals so the UI is NEVER blocked.
   */
  public getCachedFeedSync(signals?: UserSignals): HomeFeedData | null {
    // 1. Check memory cache first
    if (this.cache && this.cache.data) {
      return this.cache.data;
    }

    // 2. Check localStorage cache
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = window.localStorage.getItem(this.STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.data) {
            this.cache = parsed;
            // Restore featured playlists into memory map
            if (parsed.data.featuredPlaylists) {
              parsed.data.featuredPlaylists.forEach((p: Playlist) => {
                if (p && p.id) this.featuredPlaylistsMap.set(p.id, p);
              });
            }
            return { ...parsed.data, isLoading: false };
          }
        }
      }
    } catch {
      // Ignore localStorage errors
    }

    // 3. Fast immediate fallback from local signals (0 network delay)
    if (signals) {
      const recent = signals.recentlyPlayed || [];
      const favs = signals.favorites || [];
      const pls = signals.playlists || [];

      if (recent.length > 0 || favs.length > 0 || pls.length > 0) {
        const heroTrack = recent[0] || favs[0] || null;
        const quickPicks = [...recent.slice(1, 7), ...favs.slice(0, 6)].slice(0, 6);
        const seenArt = new Set<string>();
        const fallbackArtists: Artist[] = [];
        for (const t of [...recent, ...favs]) {
          if (t && t.artistName && !seenArt.has(t.artistName.toLowerCase()) && t.artworkUrl) {
            seenArt.add(t.artistName.toLowerCase());
            fallbackArtists.push({
              id: t.artistId || `art-${t.artistName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
              name: t.artistName,
              artworkUrl: t.artworkUrl,
              isVerified: true,
            });
            if (fallbackArtists.length >= 8) break;
          }
        }

        return {
          heroTrack,
          quickPicks,
          madeForYou: quickPicks,
          popularInIndia: [],
          trendingNow: [],
          featuredPlaylists: pls,
          featuredAlbums: [],
          featuredArtists: fallbackArtists,
          isLoading: false,
        };
      }
    }

    return null;
  }

  /**
   * Generates a signature representing the user's current signals.
   */
  private getSignalsSignature(signals: UserSignals): string {
    const recentIds = signals.recentlyPlayed.slice(0, 3).map((t) => t.id).join(',');
    const favIds = signals.favorites.slice(0, 3).map((t) => t.id).join(',');
    const plIds = signals.playlists.map((p) => p.id).join(',');
    return `${recentIds}|${favIds}|${plIds}`;
  }

  /**
   * Extracts user's affinity profile (top artists, preferred languages, genres).
   */
  private analyzeUserProfile(signals: UserSignals) {
    const artistScores = new Map<string, { artistName: string; score: number }>();
    const languageScores = new Map<string, number>();
    const genreScores = new Map<string, number>();

    const recordTrack = (track: Track, weight: number) => {
      if (!isValidHomeTrack(track)) return;

      const artistClean = cleanText(track.artistName).toLowerCase();
      if (artistClean) {
        const existing = artistScores.get(artistClean);
        artistScores.set(artistClean, {
          artistName: track.artistName,
          score: (existing ? existing.score : 0) + weight,
        });
      }

      if (track.language) {
        const lang = track.language.toLowerCase();
        languageScores.set(lang, (languageScores.get(lang) || 0) + weight);
      }

      const genre = (track.genre || track.albumTitle || '').toLowerCase();
      if (genre) {
        genreScores.set(genre, (genreScores.get(genre) || 0) + weight);
      }
    };

    // Recently played has highest weight
    signals.recentlyPlayed.forEach((t, i) => {
      const recencyWeight = Math.max(1, 10 - i);
      recordTrack(t, recencyWeight * 3);
    });

    // Favorites have strong weight
    signals.favorites.forEach((t) => {
      recordTrack(t, 6);
    });

    // Playlist songs have moderate weight
    signals.playlists.forEach((p) => {
      (p.songs || []).forEach((t) => {
        recordTrack(t, 2);
      });
    });

    // Top sorted affinities
    const sortedArtists = Array.from(artistScores.values())
      .sort((a, b) => b.score - a.score)
      .map((a) => a.artistName);

    const sortedLanguages = Array.from(languageScores.entries())
      .sort((a, b) => b[1] - a[1])
      .map((e) => e[0]);

    return {
      topArtists: sortedArtists.slice(0, 5),
      preferredLanguages: sortedLanguages.slice(0, 3),
      hasUserHistory: sortedArtists.length > 0 || signals.recentlyPlayed.length > 0,
    };
  }

  /**
   * Main Home Feed generator with personalized discovery and cross-section deduplication.
  /**
   * Main Home Feed generator with personalized discovery and cross-section deduplication.
   * Uses Stale-While-Revalidate: returns cached feed immediately and refreshes in the background.
   */
  public async getHomeFeed(
    signals: UserSignals,
    forceRefresh = false,
    onBackgroundUpdate?: (fresh: HomeFeedData) => void
  ): Promise<HomeFeedData> {
    const signature = this.getSignalsSignature(signals);
    const now = Date.now();

    // 1. Ensure memory cache is populated from storage if present
    if (!this.cache) {
      this.getCachedFeedSync(signals);
    }

    // 2. If cached feed exists and not forced
    if (!forceRefresh && this.cache && this.cache.data) {
      const isFresh = now - this.cache.timestamp < this.CACHE_TTL_MS;
      if (isFresh) {
        return this.cache.data;
      }

      // Cache is STALE: return cached data immediately and trigger background refresh
      if (!this.inFlightPromise) {
        this.inFlightPromise = this.buildHomeFeedInternal(signals, signature, now)
          .then((freshData) => {
            if (onBackgroundUpdate) {
              onBackgroundUpdate(freshData);
            }
            return freshData;
          })
          .catch((err) => {
            console.warn('[HomeDiscoveryService] Stale refresh failed, keeping cached data:', err);
            return this.cache!.data;
          })
          .finally(() => {
            this.inFlightPromise = null;
          });
      }

      return this.cache.data;
    }

    // 3. Return in-flight promise if a request is already running
    if (this.inFlightPromise && !forceRefresh) {
      return this.inFlightPromise;
    }

    // 4. Fast offline fallback if device is currently offline
    if (networkStateService.isOffline()) {
      const fallback = this.getCachedFeedSync(signals);
      if (fallback) return fallback;
    }

    this.inFlightPromise = this.buildHomeFeedInternal(signals, signature, now)
      .catch((err) => {
        console.warn('[HomeDiscoveryService] Error building home feed:', err);
        if (this.cache?.data) return this.cache.data;
        const fallback = this.getCachedFeedSync(signals);
        return (
          fallback || {
            heroTrack: null,
            quickPicks: [],
            madeForYou: [],
            popularInIndia: [],
            trendingNow: [],
            featuredPlaylists: [],
            featuredAlbums: [],
            featuredArtists: [],
            isLoading: false,
          }
        );
      })
      .finally(() => {
        this.inFlightPromise = null;
      });

    return this.inFlightPromise;
  }

  private async buildHomeFeedInternal(
    signals: UserSignals,
    signature: string,
    now: number
  ): Promise<HomeFeedData> {
    const { topArtists, hasUserHistory } = this.analyzeUserProfile(signals);
    const globalSeenIds = new Set<string>();

    // Mark recently played IDs as seen so we don't duplicate them in other sections
    signals.recentlyPlayed.forEach((t) => {
      if (t && t.id) globalSeenIds.add(t.id);
    });

    try {
      // 1. Fetch Parallel Provider Discovery Batches with Deduplication
      const queriesToFetch: string[] = ['Trending Hits India'];

      if (topArtists.length > 0) {
        queriesToFetch.push(`${topArtists[0]} Songs`);
      } else {
        queriesToFetch.push('Arijit Singh Pritam Hits');
      }

      if (topArtists.length > 1) {
        queriesToFetch.push(`${topArtists[1]} Songs`);
      } else {
        queriesToFetch.push('Punjabi Top Hits');
      }

      // Deduplicate queries
      const uniqueQueries = Array.from(new Set(queriesToFetch.map((q) => q.trim()).filter(Boolean)));

      // Fetch STUXS catalog tracks in parallel with external search
      const stuxs = providerRegistry.getProvider('stuxs') as any;
      const stuxsPromise: Promise<Track[]> =
        stuxs && typeof stuxs.getPublishedCatalogTracks === 'function'
          ? stuxs.getPublishedCatalogTracks(10).catch(() => [])
          : Promise.resolve([]);

      const boundedSearch = async (q: string) => {
        const startMs = Date.now();
        try {
          const timeoutPromise = new Promise<{
            tracks: Track[];
            albums: Album[];
            artists: Artist[];
            playlists: Playlist[];
          }>((resolve) => {
            setTimeout(() => {
              networkStateService.recordRequestLatency(3500, true);
              console.warn(`[HomeDiscoveryService] Search timed out (3.5s) for "${q}"`);
              resolve({ tracks: [], albums: [], artists: [], playlists: [] });
            }, 3500);
          });

          const result = await Promise.race([providerRegistry.search(q), timeoutPromise]);
          networkStateService.recordRequestLatency(Date.now() - startMs, false);
          return result;
        } catch (err) {
          console.warn(`[HomeDiscoveryService] Search failed for "${q}":`, err);
          return { tracks: [], albums: [], artists: [], playlists: [] };
        }
      };

      const indiaTrendingPromise = Promise.race([
        indiaTrendingService.getTrendingInIndia(15),
        new Promise<Track[]>((resolve) => setTimeout(() => resolve([]), 3500)),
      ]).catch((err) => {
        console.warn('[HomeDiscoveryService] India trending fetch error, using fallback:', err);
        return [];
      });

      // Execute search queries in parallel with error resilience & bounded 3.5s timeouts
      const [searchResults, stuxsCatalogTracks, indiaTrendingTracks] = await Promise.all([
        Promise.all(uniqueQueries.map(boundedSearch)),
        Promise.race([
          stuxsPromise,
          new Promise<Track[]>((resolve) => setTimeout(() => resolve([]), 3500)),
        ]).catch(() => []),
        indiaTrendingPromise,
      ]);

      const trendingBatch = [...stuxsCatalogTracks, ...(searchResults[0]?.tracks || [])];
      const userAffinityBatch1 = searchResults[1]?.tracks || [];
      const userAffinityBatch2 = searchResults[2]?.tracks || [];
      const indianHitsBatch = searchResults[0]?.tracks || [];

      // Extract Albums and Artists
      const rawAlbums: Album[] = [];
      const rawArtists: Artist[] = [];
      searchResults.forEach((r) => {
        if (r.albums) rawAlbums.push(...r.albums);
        if (r.artists) rawArtists.push(...r.artists);
      });

      // --- SECTION 1: HERO TRACK ---
      let heroTrack: Track | null = null;
      const allEligibleHero = [...indiaTrendingTracks, ...trendingBatch, ...indianHitsBatch, ...userAffinityBatch1].filter(isValidHomeTrack);
      for (const cand of allEligibleHero) {
        if (!globalSeenIds.has(cand.id) && cand.artworkUrl) {
          heroTrack = cand;
          globalSeenIds.add(cand.id);
          break;
        }
      }
      if (!heroTrack && allEligibleHero.length > 0) {
        heroTrack = allEligibleHero[0];
        globalSeenIds.add(heroTrack.id);
      }

      // --- SECTION 2: QUICK PICKS / MADE FOR YOU ---
      const quickPicks: Track[] = [];
      const madeForYouPool = hasUserHistory
        ? [...userAffinityBatch1, ...userAffinityBatch2, ...trendingBatch]
        : [...trendingBatch, ...indianHitsBatch, ...userAffinityBatch1];

      const artistCountInPicks = new Map<string, number>();

      for (const track of madeForYouPool) {
        if (!isValidHomeTrack(track)) continue;
        if (globalSeenIds.has(track.id)) continue;

        const cleanArtist = cleanText(track.artistName).toLowerCase();
        const artistCount = artistCountInPicks.get(cleanArtist) || 0;
        if (artistCount >= 2) continue; // Max 2 songs per artist for diversity

        quickPicks.push(track);
        globalSeenIds.add(track.id);
        artistCountInPicks.set(cleanArtist, artistCount + 1);

        if (quickPicks.length >= 6) break;
      }

      // --- SECTION 3: BECAUSE YOU PLAYED [SONG] ---
      let becauseYouPlayedSection: BecauseYouPlayedSection | undefined;
      if (hasUserHistory && signals.recentlyPlayed.length > 0) {
        const seedTrack = signals.recentlyPlayed[0];
        const seedInfo = detectTrackDomain(seedTrack);

        // Perform dedicated targeted seed queries directly to the provider (skip queries already fetched)
        const rawSeedQueries: string[] = [
          `${seedTrack.artistName} Songs`,
          `${seedTrack.title} ${seedTrack.artistName}`,
          ...seedInfo.queryKeywords,
        ].filter(Boolean);

        const seedQueries = rawSeedQueries.filter(
          (sq) => !uniqueQueries.some((uq) => uq.toLowerCase() === sq.toLowerCase())
        );

        const seedSearchBatches = await Promise.all(
          seedQueries.slice(0, 2).map(async (sq) => {
            try {
              return await providerRegistry.search(sq);
            } catch {
              return { tracks: [], albums: [], artists: [], playlists: [] };
            }
          })
        );

        const candidatePool: Track[] = [];
        seedSearchBatches.forEach((batch) => {
          if (batch.tracks) candidatePool.push(...batch.tracks);
        });

        // Also add candidate tracks from user affinity batches
        candidatePool.push(...userAffinityBatch1, ...userAffinityBatch2, ...indianHitsBatch);

        const scoredCandidates: { track: Track; score: number }[] = [];
        const seenCandidateIds = new Set<string>();

        for (const track of candidatePool) {
          if (!isValidHomeTrack(track)) continue;
          if (track.id === seedTrack.id) continue;
          if (globalSeenIds.has(track.id)) continue;
          if (seenCandidateIds.has(track.id)) continue;
          seenCandidateIds.add(track.id);

          const score = scoreRecommendationCandidate(seedTrack, track, seedInfo.domain);

          // STRICT RELEVANCE GUARD: Must pass minimum threshold of +35 points!
          if (score >= 35) {
            scoredCandidates.push({ track, score });
          }
        }

        // Sort descending by relevance score
        scoredCandidates.sort((a, b) => b.score - a.score);

        const highQualityTracks = scoredCandidates.slice(0, 5).map((sc) => sc.track);

        if (highQualityTracks.length >= 2) {
          highQualityTracks.forEach((t) => globalSeenIds.add(t.id));
          becauseYouPlayedSection = {
            seedTrack,
            tracks: highQualityTracks,
          };
        }
      }

      // --- SECTION 4: POPULAR IN INDIA ---
      const popularInIndia: Track[] = [];
      const indianArtistCount = new Map<string, number>();

      for (const track of indianHitsBatch) {
        if (!isValidHomeTrack(track)) continue;
        if (globalSeenIds.has(track.id)) continue;

        const cleanArtist = cleanText(track.artistName).toLowerCase();
        const artistCount = indianArtistCount.get(cleanArtist) || 0;
        if (artistCount >= 2) continue;

        popularInIndia.push(track);
        globalSeenIds.add(track.id);
        indianArtistCount.set(cleanArtist, artistCount + 1);

        if (popularInIndia.length >= 8) break;
      }

      // --- SECTION 5: TRENDING NOW / INDIA DISCOVERY ---
      // Strictly consumes the exact same ranked dataset from IndiaTrendingService without first-party STUXS pollution
      const trendingNow: Track[] = [];
      const primaryTrendingSource =
        indiaTrendingTracks.length > 0
          ? indiaTrendingTracks
          : (searchResults[0]?.tracks || []).filter((t) => t.provider !== 'stuxs');

      for (const track of primaryTrendingSource) {
        if (!isValidHomeTrack(track)) continue;
        if (globalSeenIds.has(track.id)) continue;

        trendingNow.push(track);
        globalSeenIds.add(track.id);

        if (trendingNow.length >= 10) break;
      }

      // Fallback: If deduplication made a list too short, fill gracefully from valid external pool
      if (trendingNow.length < 4) {
        for (const track of [...indiaTrendingTracks, ...(searchResults[0]?.tracks || [])]) {
          if (track.provider === 'stuxs') continue;
          if (isValidHomeTrack(track) && !trendingNow.some((t) => t.id === track.id)) {
            trendingNow.push(track);
            if (trendingNow.length >= 6) break;
          }
        }
      }

      // --- SECTION 6: FEATURED ALBUMS ---
      const seenAlbumIds = new Set<string>();
      const featuredAlbums: Album[] = [];
      for (const alb of rawAlbums) {
        if (alb && alb.id && !seenAlbumIds.has(alb.id) && alb.artworkUrl) {
          seenAlbumIds.add(alb.id);
          featuredAlbums.push(alb);
          if (featuredAlbums.length >= 6) break;
        }
      }

      // --- SECTION 7: FEATURED ARTISTS ---
      const seenArtistIds = new Set<string>();
      const featuredArtists: Artist[] = [];
      for (const art of rawArtists) {
        if (art && art.id && !seenArtistIds.has(art.id) && art.name && art.artworkUrl) {
          seenArtistIds.add(art.id);
          featuredArtists.push(art);
          if (featuredArtists.length >= 8) break;
        }
      }

      // Fallback: If search yielded fewer than 8 artists, harvest from trending and popular tracks
      if (featuredArtists.length < 8) {
        for (const track of [...trendingBatch, ...indianHitsBatch, ...userAffinityBatch1]) {
          if (!track || !track.artistName) continue;
          const cleanName = cleanText(track.artistName);
          const artistKey = cleanName.toLowerCase().trim();
          if (!seenArtistIds.has(artistKey) && track.artworkUrl) {
            seenArtistIds.add(artistKey);
            featuredArtists.push({
              id: track.artistId || `art-${artistKey.replace(/[^a-z0-9]/g, '-')}`,
              name: cleanName,
              artworkUrl: track.artworkUrl,
              isVerified: true,
            });
            if (featuredArtists.length >= 10) break;
          }
        }
      }

      // --- SECTION 8: FEATURED PLAYLISTS (For 3D Coverflow) ---
      const featuredPlaylists: Playlist[] = [];

      // 1. User playlists first
      signals.playlists.forEach((p) => {
        if (p && p.id && p.artworkUrl && (p.songs?.length || p.songCount)) {
          featuredPlaylists.push(p);
          this.featuredPlaylistsMap.set(p.id, p);
        }
      });

      // 1b. Ready-made curated discovery playlists
      const cachedCurated = curatedPlaylistService.getCachedPlaylists();
      if (cachedCurated && cachedCurated.length > 0) {
        cachedCurated.forEach((cp) => {
          if (!this.featuredPlaylistsMap.has(cp.id)) {
            featuredPlaylists.push(cp);
            this.featuredPlaylistsMap.set(cp.id, cp);
          }
        });
      } else {
        // Hydrate in background without blocking
        curatedPlaylistService.getCuratedPlaylists().catch(() => {});
      }

      // 2. Real curated mixes using genuine discovery songs
      if (trendingBatch.length >= 3) {
        const p: Playlist = {
          id: 'pl-featured-india-top-50',
          name: 'Top Hits: India',
          description: 'The definitive sound of India — most streamed tracks and viral chartbusters.',
          artworkUrl: trendingBatch[0]?.artworkUrl || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600',
          isPublic: true,
          songCount: trendingBatch.length,
          duration: trendingBatch.reduce((sum, t) => sum + (t.duration || 180), 0),
          songs: trendingBatch,
          createdAt: new Date().toISOString(),
        };
        featuredPlaylists.push(p);
        this.featuredPlaylistsMap.set(p.id, p);
      }

      if (indianHitsBatch.length >= 3) {
        const p: Playlist = {
          id: 'pl-featured-bollywood-romance',
          name: 'Bollywood Romance & Soul',
          description: 'Heartfelt melodies, acoustic ballads, and timeless romantic classics.',
          artworkUrl: indianHitsBatch[0]?.artworkUrl || 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=600',
          isPublic: true,
          songCount: indianHitsBatch.length,
          duration: indianHitsBatch.reduce((sum, t) => sum + (t.duration || 180), 0),
          songs: indianHitsBatch,
          createdAt: new Date().toISOString(),
        };
        featuredPlaylists.push(p);
        this.featuredPlaylistsMap.set(p.id, p);
      }

      if (userAffinityBatch2.length >= 3) {
        const p: Playlist = {
          id: 'pl-featured-punjabi-pop',
          name: 'Punjabi Pop & Urban Beats',
          description: 'High energy Punjabi beats, modern desi hip-hop, and bass-heavy anthems.',
          artworkUrl: userAffinityBatch2[0]?.artworkUrl || 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=600',
          isPublic: true,
          songCount: userAffinityBatch2.length,
          duration: userAffinityBatch2.reduce((sum, t) => sum + (t.duration || 180), 0),
          songs: userAffinityBatch2,
          createdAt: new Date().toISOString(),
        };
        featuredPlaylists.push(p);
        this.featuredPlaylistsMap.set(p.id, p);
      }

      if (userAffinityBatch1.length >= 3) {
        const p: Playlist = {
          id: 'pl-featured-late-night-chill',
          name: 'Late Night Acoustic Sessions',
          description: 'Slow rhythms, velvety vocals, and soothing acoustic melodies for midnight focus.',
          artworkUrl: userAffinityBatch1[0]?.artworkUrl || 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=600',
          isPublic: true,
          songCount: userAffinityBatch1.length,
          duration: userAffinityBatch1.reduce((sum, t) => sum + (t.duration || 180), 0),
          songs: userAffinityBatch1,
          createdAt: new Date().toISOString(),
        };
        featuredPlaylists.push(p);
        this.featuredPlaylistsMap.set(p.id, p);
      }

      const feedData: HomeFeedData = {
        heroTrack,
        quickPicks,
        madeForYou: quickPicks,
        popularInIndia,
        trendingNow,
        becauseYouPlayed: becauseYouPlayedSection,
        featuredPlaylists,
        featuredAlbums,
        featuredArtists,
        isLoading: false,
      };

      // If we got zero external results (e.g. offline or network timeout) and we already have a populated cache,
      // preserve the existing cached data rather than overwriting it with an empty feed!
      const totalTracksFound = (heroTrack ? 1 : 0) + quickPicks.length + popularInIndia.length + trendingNow.length;
      if (totalTracksFound === 0 && this.cache?.data && ((this.cache.data.quickPicks?.length || 0) > 0 || (this.cache.data.trendingNow?.length || 0) > 0)) {
        return { ...this.cache.data, isLoading: false };
      }

      // Save to memory cache and storage
      this.cache = {
        data: feedData,
        timestamp: now,
        signature,
      };

      try {
        localCacheService.set('home_discovery', feedData, this.CACHE_TTL_MS, signature);
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(
            this.STORAGE_KEY,
            JSON.stringify({ data: feedData, timestamp: now, signature })
          );
        }
      } catch {
        // Ignore localStorage errors
      }

      return feedData;
    } catch (err) {
      console.error('[HomeDiscoveryService] Fatal error building home feed:', err);
      // Stale-While-Revalidate: Return existing cache if available so UI does not blank out
      if (this.cache && this.cache.data) {
        return { ...this.cache.data, isLoading: false };
      }
      return {
        heroTrack: null,
        quickPicks: [],
        madeForYou: [],
        popularInIndia: [],
        trendingNow: [],
        featuredPlaylists: [],
        featuredAlbums: [],
        featuredArtists: [],
        isLoading: false,
      };
    }
  }

  public getPlaylistById(id: string): Playlist | undefined {
    return this.featuredPlaylistsMap.get(id) || curatedPlaylistService.getCachedPlaylist(id) || undefined;
  }

  public getDiscoverPlaylists(query = 'Trending Hits India'): Promise<Playlist[]> {
    const trimmedQuery = query.trim() || 'Trending Hits India';

    // 1. In-flight request deduplication
    const existingInFlight = this.discoverPlaylistsInFlight.get(trimmedQuery);
    if (existingInFlight) {
      return existingInFlight;
    }

    // 2. Check in-memory cache
    const memoryHit = this.discoverPlaylistsCache.get(trimmedQuery);
    const now = Date.now();
    if (memoryHit && now - memoryHit.timestamp < this.CACHE_TTL_MS && memoryHit.data.length > 0) {
      return Promise.resolve(memoryHit.data);
    }

    // 3. Check persistent localStorage cache if in-memory is empty
    if (!memoryHit && typeof window !== 'undefined' && window.localStorage) {
      try {
        const raw = window.localStorage.getItem(this.DISCOVER_PLAYLISTS_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          const cachedEntry = parsed && parsed[trimmedQuery];
          if (
            cachedEntry &&
            Array.isArray(cachedEntry.data) &&
            cachedEntry.data.length > 0 &&
            now - (cachedEntry.timestamp || 0) < this.CACHE_TTL_MS
          ) {
            // Validate cached data (must have valid id and not be mock)
            const valid = cachedEntry.data.filter(
              (p: any) => p && typeof p.id === 'string' && !p.id.startsWith('mock-') && p.name
            );
            if (valid.length > 0) {
              this.discoverPlaylistsCache.set(trimmedQuery, { data: valid, timestamp: cachedEntry.timestamp });
              valid.forEach((p: Playlist) => this.featuredPlaylistsMap.set(p.id, p));
              return Promise.resolve(valid);
            }
          }
        }
      } catch (e) {
        // Malformed cache treated as clean cache miss
      }
    }

    // 4. Fetch fresh results with in-flight deduplication & bounded 3.5s timeout
    const fetchPromise = (async () => {
      try {
        const timeoutPromise = new Promise<{ playlists: Playlist[] }>((resolve) => {
          setTimeout(() => resolve({ playlists: [] }), 3500);
        });
        const res = await Promise.race([providerRegistry.search(trimmedQuery), timeoutPromise]);
        const list = (res.playlists || []).filter(
          (p) => p && typeof p.id === 'string' && !p.id.startsWith('mock-') && p.name
        );

        if (list.length > 0) {
          list.forEach((p) => {
            this.featuredPlaylistsMap.set(p.id, p);
          });
          this.discoverPlaylistsCache.set(trimmedQuery, { data: list, timestamp: Date.now() });

          try {
            if (typeof window !== 'undefined' && window.localStorage) {
              const existingStorage = window.localStorage.getItem(this.DISCOVER_PLAYLISTS_STORAGE_KEY);
              let storageObj: Record<string, any> = {};
              if (existingStorage) {
                try {
                  storageObj = JSON.parse(existingStorage) || {};
                } catch {}
              }
              storageObj[trimmedQuery] = { data: list, timestamp: Date.now() };
              window.localStorage.setItem(this.DISCOVER_PLAYLISTS_STORAGE_KEY, JSON.stringify(storageObj));
            }
          } catch {}

          return list;
        }

        // If fetch returned empty, fall back to any stale cache before returning empty
        const fallback = this.discoverPlaylistsCache.get(trimmedQuery);
        if (fallback && fallback.data.length > 0) {
          return fallback.data;
        }

        return [];
      } catch (err) {
        console.warn('[HomeDiscoveryService] getDiscoverPlaylists fetch error:', err);
        // Resilient fallback to cached entry on network/provider error
        const fallback = this.discoverPlaylistsCache.get(trimmedQuery);
        if (fallback && fallback.data.length > 0) {
          return fallback.data;
        }
        return [];
      } finally {
        this.discoverPlaylistsInFlight.delete(trimmedQuery);
      }
    })();

    this.discoverPlaylistsInFlight.set(trimmedQuery, fetchPromise);
    return fetchPromise;
  }

  /**
   * Clears the cache.
   */
  public clearCache() {
    this.cache = null;
    this.featuredPlaylistsMap.clear();
    this.discoverPlaylistsCache.clear();
    this.discoverPlaylistsInFlight.clear();
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(this.STORAGE_KEY);
        window.localStorage.removeItem(this.DISCOVER_PLAYLISTS_STORAGE_KEY);
      }
    } catch {
      // Ignore error
    }
  }
}

export const homeDiscoveryService = new HomeDiscoveryService();
