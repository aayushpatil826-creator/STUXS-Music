/**
 * CuratedPlaylistService — dedicated service for ready-made, curated music discovery.
 *
 * Responsibilities:
 * - Curated playlist catalog with distinct categories (Trending, Bollywood, Punjabi,
 *   Marathi, Tamil, Telugu, Romantic, Party, Workout, Devotional, New Releases, International)
 * - Provider-backed real discovery (STUXS first-party, JioSaavn primary, Gaana fallback)
 * - Strict playability validation:
 *   - Rejects SoundCloud
 *   - Rejects preview-only tracks
 *   - Rejects iTunes 30-second previews
 *   - Rejects blocked / unplayable tracks
 *   - Rejects missing audio URLs
 * - Canonical track deduplication
 * - 30-minute in-memory + bounded localStorage TTL cache (with corrupt entry discard)
 * - In-flight request deduplication
 * - Provider failure isolation
 * - Strict user-playlist separation (isUserCreated is explicitly false)
 */

import type { CuratedPlaylist, CuratedCategory, Track } from '../types/music';
import { providerRegistry } from '../providers/ProviderRegistry';
import { cleanText, normalizeTransliteration } from '../utils/searchIntelligence';
import { BRANDING_CONFIG } from '../config/branding';

const CACHE_KEY = 'stuxs_curated_playlists_v1';
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const PROVIDER_TIMEOUT_MS = 5000;

interface CuratedDescriptor {
  id: string;
  name: string;
  description: string;
  category: CuratedCategory;
  categoryLabel: string;
  region?: string;
  order: number;
  featured: boolean;
  providerListId?: string; // JioSaavn verified chart ID
  searchQuery: string;     // provider fallback search query
  defaultArtwork: string;
}

export const CURATED_PLAYLIST_DESCRIPTORS: CuratedDescriptor[] = [
  {
    id: 'curated-trending-india',
    name: 'India Superhits Top 50',
    description: 'The definitive sound of India — most streamed tracks and viral chartbusters.',
    category: 'trending',
    categoryLabel: 'Trending in India',
    region: 'India',
    order: 1,
    featured: true,
    providerListId: '1134548194',
    searchQuery: 'India Superhits Top 50',
    defaultArtwork: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600',
  },
  {
    id: 'curated-bollywood-hits',
    name: 'Bollywood Superhits',
    description: 'Blockbuster tracks and timeless hits straight from the heart of Hindi cinema.',
    category: 'bollywood',
    categoryLabel: 'Bollywood Hits',
    region: 'India',
    order: 2,
    featured: true,
    providerListId: '1134543272',
    searchQuery: 'Bollywood Top 50',
    defaultArtwork: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=600',
  },
  {
    id: 'curated-punjabi-hits',
    name: 'Punjabi Fire Beats',
    description: 'High-energy bhangra grooves, bass-heavy urban pop, and Punjabi hip-hop anthems.',
    category: 'punjabi',
    categoryLabel: 'Punjabi Hits',
    region: 'Punjab',
    order: 3,
    featured: true,
    providerListId: '1134543511',
    searchQuery: 'Punjabi Top Hits',
    defaultArtwork: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=600',
  },
  {
    id: 'curated-romantic',
    name: 'Bollywood Romance & Soul',
    description: 'Heartfelt melodies, acoustic ballads, and timeless romantic classics for the soul.',
    category: 'romantic',
    categoryLabel: 'Romantic',
    region: 'India',
    order: 4,
    featured: true,
    searchQuery: 'Romantic Hindi Hits',
    defaultArtwork: 'https://images.unsplash.com/photo-1518495973542-4542c06a5843?w=600',
  },
  {
    id: 'curated-marathi-hits',
    name: 'Marathi Chartbusters',
    description: 'Finest contemporary Marathi cinema soundtracks and popular cultural melodies.',
    category: 'marathi',
    categoryLabel: 'Marathi Hits',
    region: 'Maharashtra',
    order: 5,
    featured: false,
    providerListId: '1134710071',
    searchQuery: 'Marathi Top Hits',
    defaultArtwork: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=600',
  },
  {
    id: 'curated-tamil-hits',
    name: 'Tamil Top Hits',
    description: 'Sensational Kollywood chartbusters, melodic vibes, and high-tempo beats.',
    category: 'tamil',
    categoryLabel: 'Tamil Hits',
    region: 'Tamil Nadu',
    order: 6,
    featured: false,
    providerListId: '1134651042',
    searchQuery: 'Tamil Top Hits',
    defaultArtwork: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=600',
  },
  {
    id: 'curated-telugu-hits',
    name: 'Telugu Mass Beats',
    description: 'Electrifying Tollywood chart-toppers, folk rhythms, and power-packed anthems.',
    category: 'telugu',
    categoryLabel: 'Telugu Hits',
    region: 'Andhra / Telangana',
    order: 7,
    featured: false,
    providerListId: '1134643225',
    searchQuery: 'Telugu Top Hits',
    defaultArtwork: 'https://images.unsplash.com/photo-1465847899084-d164df4dedc6?w=600',
  },
  {
    id: 'curated-party',
    name: 'Club & Dance Party',
    description: 'Non-stop high-energy dancefloor heaters and club anthems to turn up any celebration.',
    category: 'party',
    categoryLabel: 'Party',
    order: 8,
    featured: false,
    searchQuery: 'Bollywood Dance Party',
    defaultArtwork: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=600',
  },
  {
    id: 'curated-workout',
    name: 'High Power Workout',
    description: 'Uptempo beats and intense rhythms designed for maximum training focus and motivation.',
    category: 'workout',
    categoryLabel: 'Workout',
    order: 9,
    featured: false,
    searchQuery: 'Workout Gym Motivation Bollywood',
    defaultArtwork: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=600',
  },
  {
    id: 'curated-devotional',
    name: 'Sacred Chants & Aarti',
    description: 'Peaceful morning prayers, Ganesh aartis, and spiritual bhajans for inner serenity.',
    category: 'devotional',
    categoryLabel: 'Devotional',
    region: 'India',
    order: 10,
    featured: false,
    searchQuery: 'Ganesh Aarti Bhakti Marathi Hindi',
    defaultArtwork: 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=600',
  },
  {
    id: 'curated-new-releases',
    name: 'Fresh Music Weekly',
    description: 'Brand new arrivals, single drops, and fresh releases from leading artists.',
    category: 'new_releases',
    categoryLabel: 'New Releases',
    order: 11,
    featured: false,
    searchQuery: 'New Releases India Hindi Punjabi',
    defaultArtwork: 'https://images.unsplash.com/photo-1511379938547-c1f69419868d?w=600',
  },
  {
    id: 'curated-international',
    name: 'Global Pop Anthems',
    description: 'Worldwide chart-topping pop, dance, and viral hits loved across the globe.',
    category: 'international',
    categoryLabel: 'International Hits',
    order: 12,
    featured: false,
    providerListId: '1134595537',
    searchQuery: 'Global Top Hits Pop',
    defaultArtwork: 'https://images.unsplash.com/photo-1429962714451-bb934ecdc4ec?w=600',
  },
];

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/** Canonical key for track deduplication within a curated playlist */
export function trackCanonicalKey(track: Track): string {
  const title = normalizeTransliteration(
    cleanText(
      (track.title || '')
        .toLowerCase()
        .replace(/\(.*?\)/g, '')
        .replace(/\[.*?\]/g, '')
        .replace(/- (original|remastered|version|from .*)$/i, '')
        .trim()
    )
  );
  const artist = normalizeTransliteration(
    cleanText((track.artistName || '').split(',')[0].split('&')[0].toLowerCase().trim())
  );
  return `${title}:::${artist}`;
}

/** Strict full-length playability validation for curated playlist tracks */
export function isValidCuratedTrack(track: Track): boolean {
  if (!track || !track.id) return false;
  // Reject SoundCloud unconditionally
  if ((track.provider as string) === 'soundcloud' || track.id.startsWith('soundcloud-')) return false;
  // Reject preview-only flags
  if (track.isPreview === true || track.playbackType === 'preview' || track.accessStatus === 'preview') return false;
  // Reject blocked / inaccessible
  if (track.isPlayable === false || track.accessStatus === 'blocked') return false;
  // Reject missing or whitespace audioUrl
  if (!track.audioUrl || typeof track.audioUrl !== 'string' || !track.audioUrl.trim()) return false;
  // Reject iTunes <=30s previews
  if (track.provider === 'itunes' && track.duration && track.duration <= 30) return false;
  return true;
}

function getLocalStorage(): Storage | null {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
      return globalThis.localStorage;
    }
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
    return null;
  } catch {
    return null;
  }
}

interface CachedPlaylistEntry {
  playlist: CuratedPlaylist;
  timestamp: number;
}

export class CuratedPlaylistService {
  private static instance: CuratedPlaylistService;

  private memoryCache = new Map<string, CachedPlaylistEntry>();
  private inFlightMap = new Map<string, Promise<CuratedPlaylist | null>>();
  private inFlightCatalogPromise: Promise<CuratedPlaylist[]> | null = null;

  public static getInstance(): CuratedPlaylistService {
    if (!CuratedPlaylistService.instance) {
      CuratedPlaylistService.instance = new CuratedPlaylistService();
    }
    return CuratedPlaylistService.instance;
  }

  private constructor() {
    this.hydrateFromStorage();
  }

  // ─── Storage Helpers ───────────────────────────────────────────────────────

  private hydrateFromStorage(): void {
    try {
      const storage = getLocalStorage();
      if (!storage) return;
      const raw = storage.getItem(CACHE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;

      const now = Date.now();
      for (const [k, v] of Object.entries(parsed)) {
        const entry = v as CachedPlaylistEntry;
        if (
          entry &&
          typeof entry.timestamp === 'number' &&
          now - entry.timestamp < CACHE_TTL &&
          entry.playlist &&
          entry.playlist.id &&
          Array.isArray(entry.playlist.songs)
        ) {
          this.memoryCache.set(k, entry);
        }
      }
    } catch {
      // Ignore corrupt storage on startup
    }
  }

  private writeStorage(): void {
    try {
      const storage = getLocalStorage();
      if (!storage) return;
      const store: Record<string, CachedPlaylistEntry> = {};
      const now = Date.now();
      for (const [k, v] of this.memoryCache.entries()) {
        if (now - v.timestamp < CACHE_TTL) {
          store[k] = v;
        }
      }
      storage.setItem(CACHE_KEY, JSON.stringify(store));
    } catch {
      // Silent quota / SSR handling
    }
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  public getCachedPlaylist(id: string): CuratedPlaylist | null {
    const entry = this.memoryCache.get(id);
    if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
      return entry.playlist;
    }
    return null;
  }

  public getCachedPlaylists(): CuratedPlaylist[] | null {
    const playlists: CuratedPlaylist[] = [];
    const now = Date.now();
    for (const entry of this.memoryCache.values()) {
      if (now - entry.timestamp < CACHE_TTL && entry.playlist.songs && entry.playlist.songs.length > 0) {
        playlists.push(entry.playlist);
      }
    }
    if (playlists.length >= 3) {
      return playlists.sort((a, b) => (a.order || 99) - (b.order || 99));
    }
    return null;
  }

  public clearCache(id?: string): void {
    if (id) {
      this.memoryCache.delete(id);
    } else {
      this.memoryCache.clear();
    }
    this.writeStorage();
  }

  /**
   * Retrieves all available ready-made curated playlists (optionally filtered by category).
   * Deduplicates concurrent calls and ensures provider failure isolation.
   */
  public async getCuratedPlaylists(category?: string): Promise<CuratedPlaylist[]> {
    // Check warm cache first
    const cached = this.getCachedPlaylists();
    if (cached) {
      if (category) {
        return cached.filter((p) => p.category === category);
      }
      return cached;
    }

    // Deduplicate in-flight catalog fetch
    if (this.inFlightCatalogPromise) {
      const all = await this.inFlightCatalogPromise;
      return category ? all.filter((p) => p.category === category) : all;
    }

    this.inFlightCatalogPromise = (async () => {
      const fetchPromises = CURATED_PLAYLIST_DESCRIPTORS.map((descriptor) =>
        this.getCuratedPlaylistById(descriptor.id).catch(() => null)
      );

      const results = await Promise.all(fetchPromises);
      const validPlaylists = results.filter(
        (p): p is CuratedPlaylist => p !== null && Array.isArray(p.songs) && p.songs.length > 0
      );

      validPlaylists.sort((a, b) => (a.order || 99) - (b.order || 99));
      return validPlaylists;
    })().finally(() => {
      this.inFlightCatalogPromise = null;
    });

    const resolved = await this.inFlightCatalogPromise;
    return category ? resolved.filter((p) => p.category === category) : resolved;
  }

  /**
   * Resolves a single curated playlist by its curated ID.
   * Handles in-flight deduplication, provider fetching, validation, and caching.
   */
  public async getCuratedPlaylistById(id: string): Promise<CuratedPlaylist | null> {
    const cached = this.getCachedPlaylist(id);
    if (cached) return cached;

    // Check in-flight map
    const inFlight = this.inFlightMap.get(id);
    if (inFlight) return inFlight;

    const descriptor = CURATED_PLAYLIST_DESCRIPTORS.find((d) => d.id === id);
    if (!descriptor) return null;

    const fetchPromise = this.resolveDescriptor(descriptor)
      .catch((err) => {
        console.warn(`[CuratedPlaylistService] Failed to resolve ${id}:`, err);
        return null;
      })
      .finally(() => {
        this.inFlightMap.delete(id);
      });

    this.inFlightMap.set(id, fetchPromise);
    return fetchPromise;
  }

  // ─── Core Descriptor Resolution ───────────────────────────────────────────

  private async resolveDescriptor(descriptor: CuratedDescriptor): Promise<CuratedPlaylist | null> {
    let candidateTracks: Track[] = [];
    let artworkUrl = descriptor.defaultArtwork;

    // 1. Try JioSaavn chart ID if configured
    if (descriptor.providerListId) {
      try {
        const pl = await withTimeout(
          providerRegistry.getPlaylist(descriptor.providerListId, 'jiosaavn'),
          PROVIDER_TIMEOUT_MS,
          null
        );
        if (pl && Array.isArray(pl.songs) && pl.songs.length > 0) {
          candidateTracks = pl.songs;
          if (pl.artworkUrl && !pl.artworkUrl.includes('undefined')) {
            artworkUrl = pl.artworkUrl;
          }
        }
      } catch {
        // Continue to search fallback
      }
    }

    // 2. Fallback to provider playlist/track search if listId failed or returned no tracks
    if (candidateTracks.length === 0) {
      try {
        const searchRes = await withTimeout(
          providerRegistry.search(descriptor.searchQuery, 'jiosaavn'),
          PROVIDER_TIMEOUT_MS,
          { tracks: [], artists: [], albums: [], playlists: [] }
        );

        // Check if a relevant provider playlist was found
        if (searchRes.playlists && searchRes.playlists.length > 0) {
          const topPl = searchRes.playlists[0];
          const fullPl = await withTimeout(
            providerRegistry.getPlaylist(topPl.id),
            PROVIDER_TIMEOUT_MS,
            null
          );
          if (fullPl && Array.isArray(fullPl.songs) && fullPl.songs.length > 0) {
            candidateTracks = fullPl.songs;
            if (fullPl.artworkUrl) artworkUrl = fullPl.artworkUrl;
          }
        }

        // If no playlist songs, use top searched tracks directly
        if (candidateTracks.length === 0 && searchRes.tracks && searchRes.tracks.length > 0) {
          candidateTracks = searchRes.tracks.slice(0, 25);
        }
      } catch {
        // Isolated search failure
      }
    }

    // 3. Fallback to STUXS first-party catalog if available
    if (candidateTracks.length === 0) {
      try {
        const stuxs = providerRegistry.getProvider('stuxs');
        if (stuxs && 'getPublishedCatalogTracks' in stuxs && typeof (stuxs as any).getPublishedCatalogTracks === 'function') {
          const stuxsTracks = await withTimeout(
            (stuxs as any).getPublishedCatalogTracks(15),
            PROVIDER_TIMEOUT_MS,
            []
          );
          if (Array.isArray(stuxsTracks) && stuxsTracks.length > 0) {
            candidateTracks = stuxsTracks;
          }
        }
      } catch {}
    }

    // 4. Validate and deduplicate tracks canonically
    const seenTrackKeys = new Set<string>();
    const validTracks: Track[] = [];

    for (const track of candidateTracks) {
      if (!isValidCuratedTrack(track)) continue;
      const key = trackCanonicalKey(track);
      if (seenTrackKeys.has(key)) continue;
      seenTrackKeys.add(key);

      validTracks.push({
        ...track,
        artworkUrl: track.artworkUrl || artworkUrl || BRANDING_CONFIG.defaultArtwork,
      });
    }

    // Strictly require playable tracks to expose the playlist
    if (validTracks.length === 0) {
      return null;
    }

    // If playlist artwork was not customized, inherit from first track
    if ((!artworkUrl || artworkUrl === descriptor.defaultArtwork) && validTracks[0]?.artworkUrl) {
      artworkUrl = validTracks[0].artworkUrl;
    }

    const duration = validTracks.reduce((sum, t) => sum + (t.duration || 180), 0);

    const curatedPlaylist: CuratedPlaylist = {
      id: descriptor.id,
      name: descriptor.name,
      description: descriptor.description,
      artworkUrl,
      isUserCreated: false, // CRITICAL: strictly distinguish from user playlists
      isPublic: true,
      songCount: validTracks.length,
      duration,
      songs: validTracks,
      provider: 'jiosaavn',
      category: descriptor.category,
      categoryLabel: descriptor.categoryLabel,
      region: descriptor.region,
      order: descriptor.order,
      featured: descriptor.featured,
      createdAt: new Date().toISOString(),
    };

    // Cache entry in memory and localStorage
    const entry: CachedPlaylistEntry = {
      playlist: curatedPlaylist,
      timestamp: Date.now(),
    };
    this.memoryCache.set(descriptor.id, entry);
    this.writeStorage();

    return curatedPlaylist;
  }
}

export const curatedPlaylistService = CuratedPlaylistService.getInstance();
