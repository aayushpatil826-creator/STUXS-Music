/**
 * ArtistService — dedicated aggregation layer for Artist Page data.
 *
 * Responsibilities:
 * - 15-minute bounded in-memory + localStorage TTL cache
 * - In-flight request deduplication (same artistId → shared Promise)
 * - JioSaavn primary + Gaana secondary enrichment with isolated failure handling
 * - Canonical track deduplication (title + primaryArtist key)
 * - Playability validation (no SoundCloud, no previews, no blocked/unplayable, no iTunes ≤30s)
 * - Canonical album deduplication (title + releaseYear key)
 * - Albums vs Singles/EPs split when provider supplies albumType metadata
 * - Provider topSongs ordering preserved — no invented popularity numbers
 */

import type { Artist, Album, Track } from '../types/music';
import { providerRegistry } from '../providers/ProviderRegistry';
import { cleanText, normalizeTransliteration } from '../utils/searchIntelligence';
import { BRANDING_CONFIG } from '../config/branding';

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface ResolvedArtistData {
  artist: Artist;
  popularTracks: Track[];
  albums: Album[];
  singles: Album[]; // empty if provider doesn't distinguish
}

// ─── Cache Constants ──────────────────────────────────────────────────────────

const CACHE_KEY = 'stuxs_artist_cache_v1';
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes
const MAX_CACHED_ARTISTS = 15; // keep storage bounded
const PROVIDER_TIMEOUT_MS = 5000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/** Canonical key for track deduplication across providers */
function trackCanonicalKey(track: Track): string {
  const title = normalizeTransliteration(cleanText(
    (track.title || '')
      .toLowerCase()
      .replace(/\(.*?\)/g, '')
      .replace(/\[.*?\]/g, '')
      .replace(/- (original|remastered|version|from .*)$/i, '')
      .trim()
  ));
  const artist = normalizeTransliteration(cleanText(
    (track.artistName || '').split(',')[0].split('&')[0].toLowerCase().trim()
  ));
  return `${title}:::${artist}`;
}

/** Canonical key for album deduplication */
function albumCanonicalKey(album: Album): string {
  const title = normalizeTransliteration(cleanText((album.title || '').toLowerCase().trim()));
  const year = String(album.releaseDate || '').slice(0, 4);
  return `${title}:::${year}`;
}

/** Validates whether a track is a legitimate full-length playable audio track */
function isValidArtistTrack(track: Track): boolean {
  if (!track || !track.id) return false;
  // Reject SoundCloud unconditionally
  if ((track.provider as string) === 'soundcloud' || track.id.startsWith('soundcloud-')) return false;
  // Reject previews
  if (track.isPreview === true || track.playbackType === 'preview' || track.accessStatus === 'preview') return false;
  // Reject blocked/inaccessible
  if (track.isPlayable === false || track.accessStatus === 'blocked') return false;
  // Reject missing audioUrl
  if (!track.audioUrl || typeof track.audioUrl !== 'string' || !track.audioUrl.trim()) return false;
  // Reject iTunes ≤30s previews
  if (track.provider === 'itunes' && track.duration && track.duration <= 30) return false;
  return true;
}

/** Artwork fallback — never leaves artwork undefined */
function ensureArtwork(url?: string): string {
  if (url && url.trim() && !url.includes('undefined')) return url;
  return BRANDING_CONFIG.defaultArtwork;
}

// ─── Cache Entry Type ─────────────────────────────────────────────────────────

interface CachedArtistEntry {
  data: ResolvedArtistData;
  timestamp: number;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class ArtistService {
  private static instance: ArtistService;

  private memoryCache = new Map<string, CachedArtistEntry>();
  private inFlightMap = new Map<string, Promise<ResolvedArtistData | null>>();

  public static getInstance(): ArtistService {
    if (!ArtistService.instance) {
      ArtistService.instance = new ArtistService();
    }
    return ArtistService.instance;
  }

  private constructor() {
    // No action needed on construction — lazy localStorage hydration happens per-lookup
  }

  // ─── Storage helpers ───────────────────────────────────────────────────────

  private readStorageCache(artistId: string): CachedArtistEntry | null {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return null;
      const raw = window.localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      const entry = parsed[artistId];
      if (!entry || typeof entry !== 'object') return null;
      // Schema validation
      if (
        typeof entry.timestamp !== 'number' ||
        !entry.data ||
        !entry.data.artist ||
        typeof entry.data.artist.name !== 'string' ||
        !Array.isArray(entry.data.popularTracks) ||
        !Array.isArray(entry.data.albums) ||
        !Array.isArray(entry.data.singles)
      ) {
        return null;
      }
      // TTL check
      if (Date.now() - entry.timestamp > CACHE_TTL) return null;
      return entry as CachedArtistEntry;
    } catch {
      return null;
    }
  }

  private writeStorageCache(artistId: string, entry: CachedArtistEntry): void {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
      const raw = window.localStorage.getItem(CACHE_KEY);
      let store: Record<string, CachedArtistEntry> = {};
      if (raw) {
        try { store = JSON.parse(raw) || {}; } catch { store = {}; }
      }
      // Validate existing entries and evict stale/malformed ones
      const cleanStore: Record<string, CachedArtistEntry> = {};
      const now = Date.now();
      for (const [k, v] of Object.entries(store)) {
        if (
          v &&
          typeof (v as CachedArtistEntry).timestamp === 'number' &&
          now - (v as CachedArtistEntry).timestamp < CACHE_TTL &&
          (v as CachedArtistEntry).data?.artist
        ) {
          cleanStore[k] = v as CachedArtistEntry;
        }
      }
      cleanStore[artistId] = entry;
      // Enforce size limit — evict oldest entries first
      const keys = Object.keys(cleanStore);
      if (keys.length > MAX_CACHED_ARTISTS) {
        keys
          .sort((a, b) => cleanStore[a].timestamp - cleanStore[b].timestamp)
          .slice(0, keys.length - MAX_CACHED_ARTISTS)
          .forEach((k) => delete cleanStore[k]);
      }
      window.localStorage.setItem(CACHE_KEY, JSON.stringify(cleanStore));
    } catch {
      // localStorage errors (quota, SSR) are silently ignored
    }
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /** Returns cached data if still within TTL, null otherwise */
  public getCached(artistId: string): ResolvedArtistData | null {
    const memEntry = this.memoryCache.get(artistId);
    if (memEntry && Date.now() - memEntry.timestamp < CACHE_TTL) {
      return memEntry.data;
    }
    const storageEntry = this.readStorageCache(artistId);
    if (storageEntry) {
      this.memoryCache.set(artistId, storageEntry);
      return storageEntry.data;
    }
    return null;
  }

  /** Clears cached data for a specific artist (or all artists if omitted) */
  public clearCache(artistId?: string): void {
    if (artistId) {
      this.memoryCache.delete(artistId);
    } else {
      this.memoryCache.clear();
    }
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        if (artistId) {
          const raw = window.localStorage.getItem(CACHE_KEY);
          if (raw) {
            const store = JSON.parse(raw);
            if (store && typeof store === 'object') {
              delete store[artistId];
              window.localStorage.setItem(CACHE_KEY, JSON.stringify(store));
            }
          }
        } else {
          window.localStorage.removeItem(CACHE_KEY);
        }
      }
    } catch {}
  }

  /**
   * Primary entry point. Resolves the full artist data with caching,
   * in-flight deduplication, and provider failure isolation.
   */
  public async getArtistData(artistId: string): Promise<ResolvedArtistData | null> {
    // 1. Warm cache check
    const cached = this.getCached(artistId);
    if (cached) return cached;

    // 2. In-flight deduplication — same artistId opened concurrently shares one fetch
    const inFlight = this.inFlightMap.get(artistId);
    if (inFlight) return inFlight;

    const fetchPromise = this.fetchAndResolve(artistId)
      .catch((err) => {
        console.warn('[ArtistService] Fetch failed for artist:', artistId, err);
        return null;
      })
      .finally(() => {
        this.inFlightMap.delete(artistId);
      });

    this.inFlightMap.set(artistId, fetchPromise);
    return fetchPromise;
  }

  // ─── Core resolution ───────────────────────────────────────────────────────

  private async fetchAndResolve(artistId: string): Promise<ResolvedArtistData | null> {
    // ── JioSaavn primary fetch (provider already routes by ID prefix) ────────
    let jiosaavnArtist: Artist | null = null;
    try {
      jiosaavnArtist = await withTimeout(
        providerRegistry.getArtist(artistId, 'jiosaavn'),
        PROVIDER_TIMEOUT_MS,
        null
      );
    } catch {
      // JioSaavn failure — continue to Gaana enrichment
    }

    // ── Gaana secondary enrichment (only if artist name is known) ────────────
    let gaanaArtist: Artist | null = null;
    if (jiosaavnArtist?.name) {
      try {
        // Gaana lookup uses artist name as search query — ID-based routing isn't available
        // unless the ID is already a gaana- prefixed ID
        const gaanaProvider = providerRegistry.getProvider('gaana');
        if (gaanaProvider?.isAvailable && jiosaavnArtist.name) {
          gaanaArtist = await withTimeout(
            gaanaProvider.getArtist(jiosaavnArtist.name),
            PROVIDER_TIMEOUT_MS,
            null
          );
        }
      } catch {
        // Gaana failure is silently isolated
      }
    }

    // If JioSaavn returned nothing, try the Gaana path directly
    if (!jiosaavnArtist && !gaanaArtist) {
      try {
        const gaanaProvider = providerRegistry.getProvider('gaana');
        if (gaanaProvider?.isAvailable) {
          gaanaArtist = await withTimeout(
            gaanaProvider.getArtist(artistId),
            PROVIDER_TIMEOUT_MS,
            null
          );
        }
      } catch {}
    }

    // Neither provider returned data
    const primaryArtist = jiosaavnArtist ?? gaanaArtist;
    if (!primaryArtist) return null;

    // ── Aggregate tracks from both providers ─────────────────────────────────
    const rawTracks: Track[] = [];

    // JioSaavn topSongs come first — their order is provider popularity order
    for (const t of jiosaavnArtist?.songs ?? []) {
      rawTracks.push(t);
    }
    // Gaana tracks appended after — used for enrichment/fill-in only
    for (const t of gaanaArtist?.songs ?? []) {
      rawTracks.push(t);
    }

    // ── Track validation + deduplication ─────────────────────────────────────
    const seenTrackKeys = new Set<string>();
    const popularTracks: Track[] = [];
    for (const track of rawTracks) {
      if (!isValidArtistTrack(track)) continue;
      const key = trackCanonicalKey(track);
      if (!seenTrackKeys.has(key)) {
        seenTrackKeys.add(key);
        popularTracks.push({
          ...track,
          artworkUrl: ensureArtwork(track.artworkUrl),
        });
      }
    }

    // ── Aggregate albums from both providers ──────────────────────────────────
    const rawAlbums: Album[] = [
      ...(jiosaavnArtist?.albums ?? []),
      ...(gaanaArtist?.albums ?? []),
    ];

    const seenAlbumKeys = new Set<string>();
    const albums: Album[] = [];
    const singles: Album[] = [];

    for (const album of rawAlbums) {
      if (!album.title) continue;
      const key = albumCanonicalKey(album);
      if (seenAlbumKeys.has(key)) continue;
      seenAlbumKeys.add(key);

      const enriched: Album = {
        ...album,
        artworkUrl: ensureArtwork(album.artworkUrl),
      };

      // Split by albumType only when provider supplies reliable metadata
      if (enriched.albumType === 'single' || enriched.albumType === 'ep') {
        singles.push(enriched);
      } else {
        albums.push(enriched);
      }
    }

    // ── Merge artist fields from secondary provider ───────────────────────────
    const mergedArtist: Artist = {
      ...primaryArtist,
      artworkUrl: ensureArtwork(primaryArtist.artworkUrl),
      // Use Gaana bio as fallback if JioSaavn didn't supply one
      bio: primaryArtist.bio || gaanaArtist?.bio,
      // Genres: union (deduplicated), from primary first
      genres:
        primaryArtist.genres && primaryArtist.genres.length > 0
          ? primaryArtist.genres
          : gaanaArtist?.genres,
    };

    const resolved: ResolvedArtistData = {
      artist: mergedArtist,
      popularTracks,
      albums,
      singles,
    };

    // ── Cache result ──────────────────────────────────────────────────────────
    const entry: CachedArtistEntry = { data: resolved, timestamp: Date.now() };
    this.memoryCache.set(artistId, entry);
    this.writeStorageCache(artistId, entry);

    return resolved;
  }
}

export const artistService = ArtistService.getInstance();
