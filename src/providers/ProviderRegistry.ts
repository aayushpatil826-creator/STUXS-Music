import type { MusicProvider } from '../types/provider';
import type { ProviderType, SearchResults, Track, Album, Artist, Playlist } from '../types/music';
import { SpotifyProvider } from './spotify/SpotifyProvider';
import { ITunesProvider } from './itunes/ITunesProvider';
import { AmazonMusicProvider } from './amazon/AmazonMusicProvider';
import { JioSaavnProvider } from './jiosaavn/JioSaavnProvider';
import { GaanaProvider } from './gaana/GaanaProvider';
import { STUXSProvider } from './stuxs/STUXSProvider';
import {
  normalizeSearchQuery,
  scoreTrack,
  deduplicateTracks,
  fuzzySimilarity,
  cleanText,
  generateQueryVariants,
  PROVIDER_TRUST_WEIGHTS,
  type NormalizedQuery,
} from '../utils/searchIntelligence';
import {
  calculateTrackMatchConfidence,
  extractCoreTitle,
  extractArtistList,
} from '../utils/trackMatching';
import { validateAudioStreamUrl } from '../utils/streamValidator';

export { scoreTrack } from '../utils/searchIntelligence';

export class ProviderRegistry {
  private static instance: ProviderRegistry;
  private providers: Map<ProviderType, MusicProvider> = new Map();
  private activeProviderId: ProviderType = 'jiosaavn';

  // Fast In-Memory Search & Artist Cache with TTL and Persistent Offline Resilience
  private searchCache = new Map<string, { results: SearchResults; timestamp: number }>();
  private artistCache = new Map<string, Artist>();
  private readonly MAX_CACHE_ENTRIES = 120;
  private readonly MAX_ARTIST_CACHE_ENTRIES = 80;
  private readonly SEARCH_CACHE_TTL = 15 * 60 * 1000; // 15 minutes
  private readonly PERSISTENT_CACHE_KEY = 'stuxs_search_cache_v1';
  private readonly PERSISTENT_CACHE_MAX = 20;

  // In-flight searches deduplication map to prevent redundant concurrent provider calls
  private inFlightSearches = new Map<string, Promise<SearchResults>>();

  private constructor() {
    this.register(new STUXSProvider());
    this.register(new JioSaavnProvider());
    this.register(new GaanaProvider());
    this.register(new ITunesProvider());
    this.register(new SpotifyProvider());
    this.register(new AmazonMusicProvider());
  }

  public static getInstance(): ProviderRegistry {
    if (!ProviderRegistry.instance) {
      ProviderRegistry.instance = new ProviderRegistry();
    }
    return ProviderRegistry.instance;
  }

  public register(provider: MusicProvider): void {
    this.providers.set(provider.id, provider);
  }

  public getProvider(id: ProviderType): MusicProvider | undefined {
    return this.providers.get(id);
  }

  public getActiveProvider(): MusicProvider {
    return this.providers.get(this.activeProviderId) || this.providers.get('jiosaavn')!;
  }

  public setActiveProvider(id: ProviderType): void {
    if (this.providers.has(id)) {
      this.activeProviderId = id;
    }
  }

  public getAllProviders(): MusicProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Retrieves persistent search cache from localStorage with schema validation and TTL check.
   */
  private getPersistentSearchCache(cleanKey: string): SearchResults | null {
    try {
      if (typeof localStorage === 'undefined') return null;
      const raw = localStorage.getItem(this.PERSISTENT_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      const entry = parsed[cleanKey];
      if (!entry || typeof entry !== 'object' || !entry.results || typeof entry.timestamp !== 'number') {
        return null;
      }
      if (Date.now() - entry.timestamp > this.SEARCH_CACHE_TTL) {
        return null;
      }
      const { results } = entry;
      if (
        !Array.isArray(results.tracks) ||
        !Array.isArray(results.artists) ||
        !Array.isArray(results.albums) ||
        !Array.isArray(results.playlists)
      ) {
        return null;
      }
      // Warm in-memory cache
      this.searchCache.set(cleanKey, { results, timestamp: entry.timestamp });
      return results;
    } catch {
      return null;
    }
  }

  /**
   * Saves valid search results to persistent localStorage cache with FIFO eviction.
   */
  private setPersistentSearchCache(cleanKey: string, results: SearchResults, timestamp: number): void {
    try {
      if (typeof localStorage === 'undefined') return;
      const raw = localStorage.getItem(this.PERSISTENT_CACHE_KEY);
      let parsed: Record<string, { results: SearchResults; timestamp: number }> = {};
      if (raw) {
        try { parsed = JSON.parse(raw) || {}; } catch {}
      }
      parsed[cleanKey] = { results, timestamp };
      const keys = Object.keys(parsed);
      if (keys.length > this.PERSISTENT_CACHE_MAX) {
        keys.sort((a, b) => (parsed[a]?.timestamp || 0) - (parsed[b]?.timestamp || 0));
        while (keys.length > this.PERSISTENT_CACHE_MAX) {
          const oldest = keys.shift();
          if (oldest) delete parsed[oldest];
        }
      }
      localStorage.setItem(this.PERSISTENT_CACHE_KEY, JSON.stringify(parsed));
    } catch {}
  }

  /**
   * Retrieves cached search results if available and unexpired for instant UI rendering.
   */
  public getCachedSearchResults(query: string): SearchResults | null {
    const nq = normalizeSearchQuery(query);
    if (!nq.clean) return null;
    const entry = this.searchCache.get(nq.clean);
    if (entry) {
      if (Date.now() - entry.timestamp > this.SEARCH_CACHE_TTL) {
        this.searchCache.delete(nq.clean);
      } else {
        return entry.results;
      }
    }
    return this.getPersistentSearchCache(nq.clean);
  }

  private setCacheEntry(cleanKey: string, results: SearchResults): void {
    const now = Date.now();
    if (this.searchCache.size >= this.MAX_CACHE_ENTRIES) {
      const firstKey = this.searchCache.keys().next().value;
      if (firstKey) this.searchCache.delete(firstKey);
    }
    this.searchCache.set(cleanKey, { results, timestamp: now });
    this.setPersistentSearchCache(cleanKey, results, now);
  }

  /**
   * Merges, deduplicates, and ranks raw provider results against normalized query.
   */
  private processSearchResults(
    providerOutputs: { providerId: ProviderType; data: SearchResults }[],
    nq: NormalizedQuery
  ): SearchResults {
    const rawMergedTracks: Track[] = [];
    const mergedArtists: Artist[] = [];
    const mergedAlbums: Album[] = [];
    const mergedPlaylists: Playlist[] = [];

    const seenTrackKeys = new Set<string>();
    const seenArtistKeys = new Set<string>();
    const seenAlbumKeys = new Set<string>();
    const seenPlaylistKeys = new Set<string>();

    for (const { providerId, data } of providerOutputs) {
      // Merge Tracks
      for (const track of data.tracks || []) {
        // STRICT CATALOG RULE: NO SOUNDCLOUD, NO PREVIEWS, NO METADATA-ONLY
        if (
          (track.provider as string) === 'soundcloud' ||
          track.id?.startsWith('soundcloud-') ||
          track.isPreview ||
          track.playbackType === 'preview' ||
          track.accessStatus === 'preview' ||
          track.accessStatus === 'blocked' ||
          !track.audioUrl ||
          track.audioUrl.includes('itunes.apple.com') ||
          track.audioUrl.includes('mzstatic.com') ||
          track.audioUrl.includes('audio-ssl.itunes')
        ) {
          continue;
        }

        const key = `${track.provider || providerId}:${track.id}`;
        if (!seenTrackKeys.has(key)) {
          seenTrackKeys.add(key);
          rawMergedTracks.push({
            ...track,
            provider: track.provider || providerId,
          });
        }
      }

      // Merge Artists
      for (const artist of data.artists || []) {
        const key = `${artist.id}`;
        if (!seenArtistKeys.has(key)) {
          seenArtistKeys.add(key);
          mergedArtists.push(artist);
        }
      }

      // Merge Albums
      for (const album of data.albums || []) {
        const key = `${album.provider || providerId}:${album.id}`;
        if (!seenAlbumKeys.has(key)) {
          seenAlbumKeys.add(key);
          mergedAlbums.push({
            ...album,
            provider: album.provider || providerId,
          });
        }
      }

      // Merge Playlists
      for (const playlist of data.playlists || []) {
        const key = `${playlist.id}`;
        if (!seenPlaylistKeys.has(key)) {
          seenPlaylistKeys.add(key);
          mergedPlaylists.push(playlist);
        }
      }
    }

    // Authenticity-first scoring
    const scoredTracks = rawMergedTracks.map((track) => ({
      track,
      score: scoreTrack(track, nq),
    }));

    // Sort descending by score
    scoredTracks.sort((a, b) => b.score - a.score);

    // Cross-provider deduplication
    const deduplicatedTracks = deduplicateTracks(
      scoredTracks.map((item) => item.track),
      nq
    );

    // Sort Artists by fuzzy match relevance
    mergedArtists.sort((a, b) => {
      const simA = fuzzySimilarity(cleanText(a.name), nq.clean);
      const simB = fuzzySimilarity(cleanText(b.name), nq.clean);
      return simB - simA;
    });

    // Sort Albums by fuzzy match relevance
    mergedAlbums.sort((a, b) => {
      const scoreA = (PROVIDER_TRUST_WEIGHTS[a.provider] || 50) + fuzzySimilarity(cleanText(a.title), nq.clean) * 50;
      const scoreB = (PROVIDER_TRUST_WEIGHTS[b.provider] || 50) + fuzzySimilarity(cleanText(b.title), nq.clean) * 50;
      return scoreB - scoreA;
    });

    return {
      tracks: deduplicatedTracks,
      artists: mergedArtists,
      albums: mergedAlbums,
      playlists: mergedPlaylists,
    };
  }

  /**
   * Progressive parallel search across active music providers with full audio.
   */
  public async searchProgressive(
    query: string,
    onProgress: (results: SearchResults, isFinal: boolean) => void,
    specificProviderId?: ProviderType
  ): Promise<SearchResults> {
    const nq = normalizeSearchQuery(query);
    if (!nq.clean) {
      const empty: SearchResults = { tracks: [], artists: [], albums: [], playlists: [] };
      onProgress(empty, true);
      return empty;
    }

    // Check fast cache first (in-memory or persistent localStorage) for instant response
    const cached = this.getCachedSearchResults(query);
    if (cached) {
      onProgress(cached, true);
      return cached;
    }

    if (specificProviderId && this.providers.has(specificProviderId)) {
      try {
        const res = await this.providers.get(specificProviderId)!.search(query);
        onProgress(res, true);
        return res;
      } catch (err) {
        console.warn(`[ProviderRegistry] Search failed on provider ${specificProviderId}:`, err);
        const empty: SearchResults = { tracks: [], artists: [], albums: [], playlists: [] };
        onProgress(empty, true);
        return empty;
      }
    }

    // If an identical search is already in flight, reuse the promise to prevent duplicate provider traffic
    const inFlight = this.inFlightSearches.get(nq.clean);
    if (inFlight) {
      try {
        const sharedResults = await inFlight;
        onProgress(sharedResults, true);
        return sharedResults;
      } catch {
        // If in-flight search failed, continue to fallback below
      }
    }

    const executeSearch = async (): Promise<SearchResults> => {
      // Real active music providers with full audio only (zero 30s preview providers)
      const activeProviders: MusicProvider[] = [];
      const stuxs = this.providers.get('stuxs');
      const jiosaavn = this.providers.get('jiosaavn');
      const gaana = this.providers.get('gaana');

      if (stuxs && stuxs.isAvailable) activeProviders.push(stuxs);
      if (jiosaavn && jiosaavn.isAvailable) activeProviders.push(jiosaavn);
      if (gaana && gaana.isAvailable) activeProviders.push(gaana);
      const completedOutputs: { providerId: ProviderType; data: SearchResults }[] = [];

      // Safe bounded timeout helper to ensure no slow provider blocks search
      const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> => {
        return Promise.race([
          p,
          new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Provider timeout')), ms)),
        ]);
      };

      // Execute searches in parallel; dispatch progressive updates as each resolves
      const variants = generateQueryVariants(query);
      const queryList: string[] = [query.trim()];
      if (nq.clean && nq.clean !== query.trim().toLowerCase()) {
        queryList.push(nq.clean);
      }
      for (const v of variants.slice(0, 2)) {
        if (!queryList.includes(v)) {
          queryList.push(v);
        }
      }

      const searchPromises = activeProviders.flatMap((provider) =>
        queryList.map(async (qStr) => {
          try {
            const res = await withTimeout(provider.search(qStr), 4000);
            if (res.tracks.length > 0 || res.artists.length > 0 || res.albums.length > 0) {
              completedOutputs.push({ providerId: provider.id, data: res });
              const currentProcessed = this.processSearchResults(completedOutputs, nq);
              const hasAnyResults =
                currentProcessed.tracks.length > 0 ||
                currentProcessed.artists.length > 0 ||
                currentProcessed.albums.length > 0 ||
                currentProcessed.playlists.length > 0;

              if (hasAnyResults) {
                onProgress(currentProcessed, false);
              }
            }
          } catch (err) {
            console.warn(`[ProviderRegistry] Provider ${provider.id} search error:`, err);
          }
        })
      );

      await Promise.allSettled(searchPromises);

      // --- ALBUM RELATIONSHIP DISCOVERY ENRICHMENT ---
      // When providers return relevant albums or tracks from prominent albums,
      // discover canonical tracks from up to 6 associated albums with a strict bounded timeout.
      const candidateAlbumIds = new Set<string>();
      for (const { data } of completedOutputs) {
        for (const trk of (data.tracks || []).slice(0, 4)) {
          if (trk.albumId) candidateAlbumIds.add(trk.albumId);
        }
      }
      for (const { data } of completedOutputs) {
        for (const alb of (data.albums || []).slice(0, 4)) {
          if (alb.id) candidateAlbumIds.add(alb.id);
        }
      }

      if (candidateAlbumIds.size > 0 && jiosaavn && jiosaavn.isAvailable) {
        const albumFetchPromises = Array.from(candidateAlbumIds).slice(0, 6).map(async (albId) => {
          try {
            const alb = await withTimeout(jiosaavn.getAlbum(albId), 2500);
            if (alb && Array.isArray(alb.songs) && alb.songs.length > 0) {
              completedOutputs.push({
                providerId: 'jiosaavn',
                data: { tracks: alb.songs, artists: [], albums: [], playlists: [] },
              });
            }
          } catch {}
        });
        await Promise.allSettled(albumFetchPromises);
      }

      let finalResults = this.processSearchResults(completedOutputs, nq);

      // --- STAGE 2: SECONDARY QUERY EXPANSION (If top score is low) ---
      const topScore = finalResults.tracks.length > 0 ? scoreTrack(finalResults.tracks[0], nq) : 0;
      if (finalResults.tracks.length === 0 || topScore < 200) {
        if (variants.length > 2) {
          const expansionPromises = variants.slice(2, 5).flatMap((variant) =>
            activeProviders.map(async (provider) => {
              try {
                const res = await withTimeout(provider.search(variant), 3000);
                if (res.tracks.length > 0 || res.artists.length > 0) {
                  completedOutputs.push({ providerId: provider.id, data: res });
                }
              } catch {}
            })
          );

          if (expansionPromises.length > 0) {
            await Promise.allSettled(expansionPromises);
            finalResults = this.processSearchResults(completedOutputs, nq);
          }
        }
      }

      this.setCacheEntry(nq.clean, finalResults);
      onProgress(finalResults, true);
      return finalResults;
    };

    const searchPromise = executeSearch();
    this.inFlightSearches.set(nq.clean, searchPromise);
    try {
      return await searchPromise;
    } finally {
      this.inFlightSearches.delete(nq.clean);
    }
  }

  /**
   * Standard batch parallel search across all providers.
   */
  public async search(query: string, specificProviderId?: ProviderType): Promise<SearchResults> {
    const nq = normalizeSearchQuery(query);
    if (!nq.clean) {
      return { tracks: [], artists: [], albums: [], playlists: [] };
    }

    const cached = this.getCachedSearchResults(query);
    if (cached) return cached;

    if (this.inFlightSearches.has(nq.clean)) {
      return await this.inFlightSearches.get(nq.clean)!;
    }

    let finalResults: SearchResults = { tracks: [], artists: [], albums: [], playlists: [] };
    await this.searchProgressive(
      query,
      (r) => {
        finalResults = r;
      },
      specificProviderId
    );

    return finalResults;
  }

  public async getTrack(id: string, providerId: ProviderType = 'jiosaavn'): Promise<Track | null> {
    if (id.startsWith('soundcloud-') || (providerId as string) === 'soundcloud') {
      return null;
    }
    if (id.startsWith('stuxs-') || providerId === 'stuxs') {
      const stuxs = this.providers.get('stuxs');
      if (stuxs) return stuxs.getTrack(id);
    }
    if (id.startsWith('jiosaavn-')) {
      const jiosaavn = this.providers.get('jiosaavn');
      if (jiosaavn) return jiosaavn.getTrack(id);
    }
    if (id.startsWith('gaana-')) {
      const gaana = this.providers.get('gaana');
      if (gaana) return gaana.getTrack(id);
    }
    if (id.startsWith('itunes-')) {
      const itunes = this.providers.get('itunes');
      if (itunes) return itunes.getTrack(id);
    }
    const provider = this.providers.get(providerId) || this.getActiveProvider();
    return provider ? provider.getTrack(id) : null;
  }

  /**
   * Resolves a full-length playable audio stream for a track.
   * If a track originates from a preview-only catalog (e.g. iTunes preview),
   * attempts to find a full-length 320kbps audio stream from JioSaavn or Gaana
   * using multi-field matching (title, artist, album).
   */
  /**
   * Validates whether a candidate track is a legitimate full-length audio stream
   * matching the requested track (title, artist, and duration sanity check).
   */
  private isValidFullTrackCandidate(candidate: Track, target: Track): boolean {
    if (!candidate.audioUrl || candidate.isPreview || candidate.accessStatus === 'preview') {
      return false;
    }

    const match = calculateTrackMatchConfidence(target, candidate);
    if (!match.isValid) {
      return false;
    }

    // Reject suspicious snippet keywords in candidate title
    const lowerCandTitle = candidate.title.toLowerCase();
    const suspiciousKeywords = ['snippet', 'preview', 'teaser', 'ringtone', 'status', '30s', 'reel', 'tiktok'];
    if (suspiciousKeywords.some((w) => lowerCandTitle.includes(w)) && !target.title.toLowerCase().includes('snippet')) {
      return false;
    }

    return true;
  }

  private resolvedStreamCache = new Map<string, { track: Track; expiry: number }>();

  /**
   * Invalidates cached stream URLs for a specific track or all tracks.
   */
  public invalidateStreamCache(trackId?: string): void {
    if (!trackId) {
      this.resolvedStreamCache.clear();
      return;
    }
    for (const key of this.resolvedStreamCache.keys()) {
      if (key.includes(trackId)) {
        this.resolvedStreamCache.delete(key);
      }
    }
  }

  /**
   * Invalidates cached search results in memory and persistent storage.
   */
  public clearSearchCache(): void {
    this.searchCache.clear();
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(this.PERSISTENT_CACHE_KEY);
      }
    } catch {}
  }

  /**
   * Pre-resolves audio stream for a track in the background.
   */
  public async preloadTrack(track: Track): Promise<void> {
    if (!track || (track.audioUrl && !track.isPreview)) return;
    try {
      await this.resolvePlayableTrack(track);
    } catch {
      // silent background resolution
    }
  }

  /**
   * Resolves a playable audio stream for a track using multi-strategy fallback.
   * Performs HTTP pre-validation so dead/404 CDN links are automatically healed
   * by resolving working alternate release candidates.
   */
  public async resolvePlayableTrack(
    track: Track,
    forceFresh = false,
    options?: { bypassPreValidation?: boolean }
  ): Promise<Track> {
    const cacheKey = `${track.provider || 'unknown'}:${track.id}`;

    if (!forceFresh) {
      const cached = this.resolvedStreamCache.get(cacheKey);
      if (cached && cached.expiry > Date.now() && cached.track.audioUrl) {
        return cached.track;
      }
    }

    try {
      // 0. STUXS First-Party Catalog: Always use full uploaded audio stream directly
      if (
        track.provider === 'stuxs' ||
        track.sourceType === 'stuxs' ||
        track.id.startsWith('stuxs-') ||
        (track.audioUrl && track.audioUrl.includes('stuxs-audio'))
      ) {
        const stuxsTrack = track.audioUrl ? track : await this.getTrack(track.id, 'stuxs');
        const finalUrl = stuxsTrack?.audioUrl || track.audioUrl;
        const directResolved: Track = {
          ...track,
          ...stuxsTrack,
          audioUrl: finalUrl,
          provider: 'stuxs',
          sourceType: 'stuxs',
          playbackType: 'full',
          isPreview: false,
          isPlayable: true,
          accessStatus: 'playable',
        };
        this.resolvedStreamCache.set(cacheKey, {
          track: directResolved,
          expiry: Date.now() + 60 * 60 * 1000,
        });
        return directResolved;
      }

      // 1. Direct Playable Track Check: If track already has direct audioUrl (e.g. JioSaavn / Gaana / STUXS direct)
      if (track.audioUrl && track.accessStatus !== 'blocked') {
        if (options?.bypassPreValidation) {
          const directResolved: Track = {
            ...track,
            playbackType: 'full',
            isPlayable: true,
            accessStatus: 'playable',
          };
          this.resolvedStreamCache.set(cacheKey, {
            track: directResolved,
            expiry: Date.now() + 15 * 60 * 1000,
          });
          return directResolved;
        }

        const directValidation = await validateAudioStreamUrl(track.audioUrl);
        if (directValidation.valid) {
          const directResolved: Track = {
            ...track,
            playbackType: 'full',
            isPlayable: true,
            accessStatus: 'playable',
          };
          this.resolvedStreamCache.set(cacheKey, {
            track: directResolved,
            expiry: Date.now() + 15 * 60 * 1000,
          });
          return directResolved;
        } else {
          console.warn('[ProviderRegistry] Direct audioUrl failed validation (status:', directValidation.status, '), resolving fresh alternate release candidate...');
        }
      }

      // 2. Direct ID lookup if track originated from a specific provider
      if (track.id) {
        const directTrack = await this.getTrack(track.id, track.provider);
        if (directTrack?.audioUrl && !directTrack.isPreview) {
          if (options?.bypassPreValidation) {
            const directResolved: Track = {
              ...track,
              audioUrl: directTrack.audioUrl,
              rawEncryptedUrl: directTrack.rawEncryptedUrl,
              duration: directTrack.duration || track.duration,
              actualBitrate: directTrack.actualBitrate,
              audioFormat: directTrack.audioFormat,
              isPreview: false,
              isPlayable: true,
              accessStatus: 'playable',
              playbackType: 'full',
            };
            this.resolvedStreamCache.set(cacheKey, {
              track: directResolved,
              expiry: Date.now() + 15 * 60 * 1000,
            });
            return directResolved;
          }

          const idValidation = await validateAudioStreamUrl(directTrack.audioUrl);
          if (idValidation.valid) {
            const directResolved: Track = {
              ...track,
              audioUrl: directTrack.audioUrl,
              rawEncryptedUrl: directTrack.rawEncryptedUrl,
              duration: directTrack.duration || track.duration,
              actualBitrate: directTrack.actualBitrate,
              audioFormat: directTrack.audioFormat,
              isPreview: false,
              isPlayable: true,
              accessStatus: 'playable',
              playbackType: 'full',
            };
            this.resolvedStreamCache.set(cacheKey, {
              track: directResolved,
              expiry: Date.now() + 15 * 60 * 1000,
            });
            return directResolved;
          } else {
            console.warn('[ProviderRegistry] Provider track ID stream returned HTTP', idValidation.status, ', searching alternate releases...');
          }
        }
      }

      // 3. Build Progressive Multi-Strategy Queries
      const cleanT = extractCoreTitle(track.title);
      const artists = extractArtistList(track.artistName);
      const cleanA = artists[0] || cleanText(track.artistName);

      const queryStrategies: string[] = [];
      if (cleanA && cleanT) queryStrategies.push(`${cleanT} ${cleanA}`.trim());
      if (cleanT) queryStrategies.push(cleanT);
      if (track.title && track.title !== cleanT) queryStrategies.push(track.title.trim());

      // 4. JioSaavn Multi-Query Resolution with Stream Validation
      const jiosaavn = this.providers.get('jiosaavn') as JioSaavnProvider | undefined;
      if (jiosaavn) {
        for (const query of queryStrategies) {
          try {
            const results = await jiosaavn.search(query);
            for (const candidate of results.tracks) {
              if (this.isValidFullTrackCandidate(candidate, track) && candidate.audioUrl) {
                // Test candidate stream URL with fallback qualities (320 -> 160 -> 96)
                const candidateQualities = ['very_high', 'high', 'normal'] as const;
                for (const q of candidateQualities) {
                  const resolvedCandidate = jiosaavn.resolveTrackQuality(candidate, q);
                  if (resolvedCandidate.audioUrl) {
                    if (options?.bypassPreValidation) {
                      console.log('[ProviderRegistry] (Native) Successfully resolved stream for:', track.title, 'via candidate ID:', candidate.id, 'at', resolvedCandidate.actualBitrate);
                      const jioResolved: Track = {
                        ...track,
                        audioUrl: resolvedCandidate.audioUrl,
                        rawEncryptedUrl: resolvedCandidate.rawEncryptedUrl || candidate.rawEncryptedUrl,
                        duration: candidate.duration || track.duration,
                        actualBitrate: resolvedCandidate.actualBitrate,
                        audioFormat: resolvedCandidate.audioFormat,
                        isPreview: false,
                        isPlayable: true,
                        accessStatus: 'playable',
                        playbackType: 'full',
                      };
                      this.resolvedStreamCache.set(cacheKey, {
                        track: jioResolved,
                        expiry: Date.now() + 15 * 60 * 1000,
                      });
                      return jioResolved;
                    }

                    const validation = await validateAudioStreamUrl(resolvedCandidate.audioUrl);
                    if (validation.valid) {
                      console.log('[ProviderRegistry] Successfully resolved verified stream for:', track.title, 'via candidate ID:', candidate.id, 'at', resolvedCandidate.actualBitrate);
                      const jioResolved: Track = {
                        ...track,
                        audioUrl: resolvedCandidate.audioUrl,
                        rawEncryptedUrl: resolvedCandidate.rawEncryptedUrl || candidate.rawEncryptedUrl,
                        duration: candidate.duration || track.duration,
                        actualBitrate: resolvedCandidate.actualBitrate,
                        audioFormat: resolvedCandidate.audioFormat,
                        isPreview: false,
                        isPlayable: true,
                        accessStatus: 'playable',
                        playbackType: 'full',
                      };
                      this.resolvedStreamCache.set(cacheKey, {
                        track: jioResolved,
                        expiry: Date.now() + 15 * 60 * 1000,
                      });
                      return jioResolved;
                    }
                  }
                }
              }
            }
          } catch {
            // continue to next query strategy
          }
        }
      }

      // 4b. Gaana Multi-Query Resolution
      const gaana = this.providers.get('gaana');
      if (gaana) {
        for (const query of queryStrategies) {
          try {
            const gaanaResults = await gaana.search(query);
            for (const candidate of gaanaResults.tracks) {
              if (this.isValidFullTrackCandidate(candidate, track)) {
                const resolvedCand = candidate.audioUrl ? candidate : await gaana.getTrack(candidate.id);
                if (resolvedCand?.audioUrl) {
                  if (options?.bypassPreValidation) {
                    console.log('[ProviderRegistry] (Native) Successfully resolved stream for:', track.title, 'via Gaana candidate ID:', candidate.id);
                    const gaanaResolved: Track = {
                      ...track,
                      audioUrl: resolvedCand.audioUrl,
                      duration: candidate.duration || track.duration,
                      actualBitrate: resolvedCand.actualBitrate || '320 kbps (HLS)',
                      audioFormat: resolvedCand.audioFormat || 'HLS / AAC',
                      isPreview: false,
                      isPlayable: true,
                      accessStatus: 'playable',
                      playbackType: 'full',
                    };
                    this.resolvedStreamCache.set(cacheKey, {
                      track: gaanaResolved,
                      expiry: Date.now() + 15 * 60 * 1000,
                    });
                    return gaanaResolved;
                  }

                  const validation = await validateAudioStreamUrl(resolvedCand.audioUrl);
                  if (validation.valid) {
                    console.log('[ProviderRegistry] Successfully resolved stream for:', track.title, 'via Gaana candidate ID:', candidate.id);
                    const gaanaResolved: Track = {
                      ...track,
                      audioUrl: resolvedCand.audioUrl,
                      duration: candidate.duration || track.duration,
                      actualBitrate: resolvedCand.actualBitrate || '320 kbps (HLS)',
                      audioFormat: resolvedCand.audioFormat || 'HLS / AAC',
                      isPreview: false,
                      isPlayable: true,
                      accessStatus: 'playable',
                      playbackType: 'full',
                    };
                    this.resolvedStreamCache.set(cacheKey, {
                      track: gaanaResolved,
                      expiry: Date.now() + 15 * 60 * 1000,
                    });
                    return gaanaResolved;
                  }
                }
              }
            }
          } catch {
            // continue to next query
          }
        }
      }
    } catch (err) {
      console.warn('[ProviderRegistry] resolvePlayableTrack error:', err);
    }

    // No legitimate full-length stream found -> Mark track as unavailable
    return {
      ...track,
      audioUrl: undefined,
      isPlayable: false,
      accessStatus: 'blocked',
      playbackType: 'blocked',
    };
  }

  public async getAlbum(id: string, providerId: ProviderType = 'jiosaavn'): Promise<Album | null> {
    if (id.startsWith('stuxs-') || providerId === 'stuxs') {
      const stuxs = this.providers.get('stuxs');
      if (stuxs) return stuxs.getAlbum(id);
    }
    if (id.startsWith('jiosaavn-')) {
      const jiosaavn = this.providers.get('jiosaavn');
      if (jiosaavn) return jiosaavn.getAlbum(id);
    }
    if (id.startsWith('gaana-')) {
      const gaana = this.providers.get('gaana');
      if (gaana) return gaana.getAlbum(id);
    }
    if (id.startsWith('itunes-')) {
      const itunes = this.providers.get('itunes');
      if (itunes) return itunes.getAlbum(id);
    }
    const provider = this.providers.get(providerId) || this.getActiveProvider();
    return provider ? provider.getAlbum(id) : null;
  }

  public async getArtist(id: string, providerId: ProviderType = 'jiosaavn'): Promise<Artist | null> {
    const cacheKey = `${providerId}:${id}`;
    if (this.artistCache.has(cacheKey)) {
      return this.artistCache.get(cacheKey)!;
    }
    if (this.artistCache.has(id)) {
      return this.artistCache.get(id)!;
    }

    let resolvedArtist: Artist | null = null;

    // 1. If explicitly an iTunes artist or requested with iTunes provider
    if (id.startsWith('itunes-') || providerId === 'itunes') {
      const itunes = this.providers.get('itunes');
      if (itunes) {
        resolvedArtist = await itunes.getArtist(id);
      }
    }

    // 2. If explicitly a JioSaavn artist
    if (!resolvedArtist && (id.startsWith('jiosaavn-') || providerId === 'jiosaavn')) {
      const jiosaavn = this.providers.get('jiosaavn');
      if (jiosaavn) {
        resolvedArtist = await jiosaavn.getArtist(id);
      }
    }

    // 3. If explicitly a Gaana artist
    if (!resolvedArtist && (id.startsWith('gaana-') || providerId === 'gaana')) {
      const gaana = this.providers.get('gaana');
      if (gaana) {
        resolvedArtist = await gaana.getArtist(id);
      }
    }

    // 4. Fallback: Try iTunes Apple Music catalog
    if (!resolvedArtist) {
      const itunes = this.providers.get('itunes');
      if (itunes) {
        resolvedArtist = await itunes.getArtist(id);
      }
    }

    // 5. Fallback: Try JioSaavn
    if (!resolvedArtist) {
      const jiosaavn = this.providers.get('jiosaavn');
      if (jiosaavn) {
        resolvedArtist = await jiosaavn.getArtist(id);
      }
    }

    // 6. Fallback: Try Gaana
    if (!resolvedArtist) {
      const gaana = this.providers.get('gaana');
      if (gaana) {
        resolvedArtist = await gaana.getArtist(id);
      }
    }

    if (resolvedArtist) {
      if (this.artistCache.size >= this.MAX_ARTIST_CACHE_ENTRIES) {
        const firstKey = this.artistCache.keys().next().value;
        if (firstKey) this.artistCache.delete(firstKey);
      }
      this.artistCache.set(cacheKey, resolvedArtist);
      this.artistCache.set(id, resolvedArtist);
    }

    return resolvedArtist;
  }

  public async getPlaylist(id: string, providerId: ProviderType = 'jiosaavn'): Promise<Playlist | null> {
    if (id.startsWith('jiosaavn-')) {
      const jiosaavn = this.providers.get('jiosaavn');
      if (jiosaavn) return jiosaavn.getPlaylist(id);
    }
    if (id.startsWith('gaana-')) {
      const gaana = this.providers.get('gaana');
      if (gaana) return gaana.getPlaylist(id);
    }
    const provider = this.providers.get(providerId) || this.getActiveProvider();
    return provider ? provider.getPlaylist(id) : null;
  }
}

export const providerRegistry = ProviderRegistry.getInstance();
