/**
 * AlbumService — dedicated aggregation and resolution layer for Album Page data.
 *
 * Responsibilities:
 * - 15-minute bounded in-memory + localStorage TTL cache
 * - In-flight request deduplication (same albumId → shared Promise)
 * - JioSaavn primary + Gaana secondary enrichment + STUXS first-party support
 * - Provider failure isolation with bounded timeouts
 * - Canonical track deduplication
 * - Full-length playability validation:
 *   - Strictly rejects SoundCloud
 *   - Strictly rejects preview-only tracks
 *   - Strictly rejects blocked or unplayable tracks
 *   - Strictly rejects missing or whitespace audio URLs
 *   - Strictly rejects iTunes previews <=30 seconds
 * - Disc and track ordering preservation:
 *   - Sorts by disc number then track number when available
 *   - Preserves legitimate provider order when track numbers are absent
 * - Multi-disc grouping (Disc 1, Disc 2, etc.) when multiple discs exist
 */

import type { Album, Track } from '../types/music';
import { providerRegistry } from '../providers/ProviderRegistry';
import { cleanText, normalizeTransliteration } from '../utils/searchIntelligence';
import { BRANDING_CONFIG } from '../config/branding';

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface AlbumDiscGroup {
  discNumber: number;
  tracks: Track[];
}

export interface ResolvedAlbumData {
  album: Album;
  tracks: Track[];
  discs?: AlbumDiscGroup[]; // defined only when multi-disc metadata is legitimately present
  totalDuration: number; // total duration in seconds
}

// ─── Cache Constants ──────────────────────────────────────────────────────────

const CACHE_KEY = 'stuxs_album_cache_v1';
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes
const MAX_CACHED_ALBUMS = 25; // keep persistent storage bounded
const PROVIDER_TIMEOUT_MS = 5000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/** Canonical key for track deduplication within an album */
function trackCanonicalKey(track: Track): string {
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

/** Validates whether a track is a legitimate full-length playable audio track */
export function isValidAlbumTrack(track: Track): boolean {
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

/** Artwork fallback — never leaves artwork empty or undefined */
function ensureArtwork(url?: string): string {
  if (url && url.trim() && !url.includes('undefined')) return url;
  return BRANDING_CONFIG.defaultArtwork;
}

// ─── Cache Entry Type ─────────────────────────────────────────────────────────

interface CachedAlbumEntry {
  data: ResolvedAlbumData;
  timestamp: number;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class AlbumService {
  private static instance: AlbumService;

  private memoryCache = new Map<string, CachedAlbumEntry>();
  private inFlightMap = new Map<string, Promise<ResolvedAlbumData | null>>();

  public static getInstance(): AlbumService {
    if (!AlbumService.instance) {
      AlbumService.instance = new AlbumService();
    }
    return AlbumService.instance;
  }

  private constructor() {
    // Lazy per-lookup localStorage read
  }

  // ─── Persistent Storage Helpers ───────────────────────────────────────────

  private readStorageCache(albumId: string): CachedAlbumEntry | null {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return null;
      const raw = window.localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      const entry = parsed[albumId];
      if (!entry || typeof entry !== 'object') return null;

      // Schema validation
      if (
        typeof entry.timestamp !== 'number' ||
        !entry.data ||
        !entry.data.album ||
        typeof entry.data.album.title !== 'string' ||
        !Array.isArray(entry.data.tracks) ||
        typeof entry.data.totalDuration !== 'number'
      ) {
        return null;
      }

      // TTL check
      if (Date.now() - entry.timestamp > CACHE_TTL) return null;
      return entry as CachedAlbumEntry;
    } catch {
      return null;
    }
  }

  private writeStorageCache(albumId: string, entry: CachedAlbumEntry): void {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
      const raw = window.localStorage.getItem(CACHE_KEY);
      let store: Record<string, CachedAlbumEntry> = {};
      if (raw) {
        try { store = JSON.parse(raw) || {}; } catch { store = {}; }
      }

      const cleanStore: Record<string, CachedAlbumEntry> = {};
      const now = Date.now();
      for (const [k, v] of Object.entries(store)) {
        if (
          v &&
          typeof (v as CachedAlbumEntry).timestamp === 'number' &&
          now - (v as CachedAlbumEntry).timestamp < CACHE_TTL &&
          (v as CachedAlbumEntry).data?.album
        ) {
          cleanStore[k] = v as CachedAlbumEntry;
        }
      }

      cleanStore[albumId] = entry;

      // Enforce size limit
      const keys = Object.keys(cleanStore);
      if (keys.length > MAX_CACHED_ALBUMS) {
        keys
          .sort((a, b) => cleanStore[a].timestamp - cleanStore[b].timestamp)
          .slice(0, keys.length - MAX_CACHED_ALBUMS)
          .forEach((k) => delete cleanStore[k]);
      }

      window.localStorage.setItem(CACHE_KEY, JSON.stringify(cleanStore));
    } catch {
      // Ignore quota/SSR errors silently
    }
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /** Returns cached data if within TTL, null otherwise */
  public getCached(albumId: string): ResolvedAlbumData | null {
    const memEntry = this.memoryCache.get(albumId);
    if (memEntry && Date.now() - memEntry.timestamp < CACHE_TTL) {
      return memEntry.data;
    }
    const storageEntry = this.readStorageCache(albumId);
    if (storageEntry) {
      this.memoryCache.set(albumId, storageEntry);
      return storageEntry.data;
    }
    return null;
  }

  /** Clears cache for a specific album or all albums if omitted */
  public clearCache(albumId?: string): void {
    if (albumId) {
      this.memoryCache.delete(albumId);
    } else {
      this.memoryCache.clear();
    }
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        if (albumId) {
          const raw = window.localStorage.getItem(CACHE_KEY);
          if (raw) {
            const store = JSON.parse(raw);
            if (store && typeof store === 'object') {
              delete store[albumId];
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
   * Primary entry point. Resolves album data with caching,
   * in-flight deduplication, provider failure isolation, track ordering, and playability validation.
   */
  public async getAlbumData(albumId: string): Promise<ResolvedAlbumData | null> {
    // 1. Check warm cache
    const cached = this.getCached(albumId);
    if (cached) return cached;

    // 2. In-flight request deduplication
    const inFlight = this.inFlightMap.get(albumId);
    if (inFlight) return inFlight;

    const fetchPromise = this.fetchAndResolve(albumId)
      .catch((err) => {
        console.warn('[AlbumService] Fetch failed for album:', albumId, err);
        return null;
      })
      .finally(() => {
        this.inFlightMap.delete(albumId);
      });

    this.inFlightMap.set(albumId, fetchPromise);
    return fetchPromise;
  }

  // ─── Core Resolution ───────────────────────────────────────────────────────

  private async fetchAndResolve(albumId: string): Promise<ResolvedAlbumData | null> {
    let primaryAlbum: Album | null = null;

    // 1. Primary provider resolution (JioSaavn or STUXS catalog based on ID prefix)
    try {
      primaryAlbum = await withTimeout(
        providerRegistry.getAlbum(albumId),
        PROVIDER_TIMEOUT_MS,
        null
      );
    } catch {
      // Primary provider failed — continue to fallback
    }

    // 2. Secondary provider fallback (Gaana) if primary was unable to locate album
    let gaanaAlbum: Album | null = null;
    if (!primaryAlbum) {
      try {
        const gaanaProvider = providerRegistry.getProvider('gaana');
        if (gaanaProvider?.isAvailable) {
          gaanaAlbum = await withTimeout(
            gaanaProvider.getAlbum(albumId),
            PROVIDER_TIMEOUT_MS,
            null
          );
        }
      } catch {
        // Gaana fallback failed
      }
    }

    const resolvedRawAlbum = primaryAlbum ?? gaanaAlbum;
    if (!resolvedRawAlbum) return null;

    // 3. Aggregate raw tracks
    const rawTracks: Track[] = [...(resolvedRawAlbum.songs || [])];

    // 4. Validate playability and deduplicate canonically
    const seenTrackKeys = new Set<string>();
    const validTracks: Track[] = [];

    for (const track of rawTracks) {
      if (!isValidAlbumTrack(track)) continue;

      const key = trackCanonicalKey(track);
      if (seenTrackKeys.has(key)) continue;
      seenTrackKeys.add(key);

      validTracks.push({
        ...track,
        artworkUrl: ensureArtwork(track.artworkUrl || resolvedRawAlbum.artworkUrl),
      });
    }

    // 5. Disc and Track Ordering
    // Check if tracks have disc/track numbers
    const hasTrackNumbers = validTracks.some((t) => typeof t.trackNumber === 'number' && t.trackNumber > 0);
    const hasDiscNumbers = validTracks.some((t) => typeof t.discNumber === 'number' && t.discNumber > 0);

    const orderedTracks = [...validTracks];
    if (hasDiscNumbers && hasTrackNumbers) {
      // Deterministic sort by disc first, then track number
      orderedTracks.sort((a, b) => {
        const discA = a.discNumber || 1;
        const discB = b.discNumber || 1;
        if (discA !== discB) return discA - discB;
        return (a.trackNumber || 0) - (b.trackNumber || 0);
      });
    } else if (hasTrackNumbers) {
      // Sort by track number if disc numbers are not provided
      orderedTracks.sort((a, b) => (a.trackNumber || 0) - (b.trackNumber || 0));
    }
    // If no track numbers exist, provider's original returned order is preserved as-is.

    // 6. Multi-disc grouping (only if 2 or more distinct positive disc numbers exist)
    const distinctDiscs = new Set<number>();
    for (const t of orderedTracks) {
      if (typeof t.discNumber === 'number' && t.discNumber > 0) {
        distinctDiscs.add(t.discNumber);
      }
    }

    let discs: AlbumDiscGroup[] | undefined;
    if (distinctDiscs.size >= 2) {
      const sortedDiscNums = Array.from(distinctDiscs).sort((a, b) => a - b);
      discs = sortedDiscNums.map((discNum) => ({
        discNumber: discNum,
        tracks: orderedTracks.filter((t) => (t.discNumber || 1) === discNum),
      }));
    }

    // 7. Calculate total duration
    const totalDuration = orderedTracks.reduce((acc, t) => acc + (t.duration || 0), 0);

    // 8. Enforce clean album artwork fallback
    const enrichedAlbum: Album = {
      ...resolvedRawAlbum,
      artworkUrl: ensureArtwork(resolvedRawAlbum.artworkUrl),
      trackCount: orderedTracks.length,
      duration: totalDuration > 0 ? totalDuration : resolvedRawAlbum.duration,
      songs: orderedTracks,
    };

    const resolved: ResolvedAlbumData = {
      album: enrichedAlbum,
      tracks: orderedTracks,
      discs,
      totalDuration,
    };

    // 9. Cache result
    const entry: CachedAlbumEntry = { data: resolved, timestamp: Date.now() };
    this.memoryCache.set(albumId, entry);
    this.writeStorageCache(albumId, entry);

    return resolved;
  }
}

export const albumService = AlbumService.getInstance();
