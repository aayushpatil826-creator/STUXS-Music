/**
 * LocalCacheService — High-performance, bounded, persistent cache layer for STUXS Music.
 *
 * Responsibilities:
 * - Synchronous frame-0 cache retrieval for instant UI hydration.
 * - Stale-While-Revalidate metadata (timestamp, ttlMs, isStale).
 * - Multi-tiered: in-memory map + localStorage persistence.
 * - LRU bounded collections for searches, artists, and albums to prevent quota exhaustion.
 * - Strictly metadata/UI state only — AUDIO FILES ARE NEVER STORED HERE.
 */

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttlMs: number;
  signature?: string;
}

export interface CacheStats {
  memoryEntries: number;
  storageEntries: number;
  hits: number;
  misses: number;
}

const STORAGE_PREFIX = 'stuxs_cache_v2:';
const MAX_SEARCH_ITEMS = 25;
const MAX_ARTIST_ITEMS = 20;
const MAX_ALBUM_ITEMS = 20;

export class LocalCacheService {
  private static instance: LocalCacheService;
  private memoryCache = new Map<string, CacheEntry<any>>();
  private hits = 0;
  private misses = 0;

  public static getInstance(): LocalCacheService {
    if (!LocalCacheService.instance) {
      LocalCacheService.instance = new LocalCacheService();
    }
    return LocalCacheService.instance;
  }

  private constructor() {
    this.hydrateCriticalEntries();
  }

  /**
   * Pre-load critical keys from storage into memory cache on startup
   */
  private hydrateCriticalEntries(): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      const keysToPreload = [
        'home_discovery',
        'trending_india',
        'auth_session_snapshot',
        'curated_playlists',
      ];
      for (const k of keysToPreload) {
        const fullKey = STORAGE_PREFIX + k;
        const raw = window.localStorage.getItem(fullKey);
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed.timestamp === 'number') {
              this.memoryCache.set(k, parsed);
            }
          } catch {}
        }
      }
    } catch {}
  }

  /**
   * Retrieve cached data synchronously on frame 0.
   * Checks in-memory cache first, then localStorage.
   */
  public getSync<T>(key: string): CacheEntry<T> | null {
    // 1. Check memory cache (instant)
    const mem = this.memoryCache.get(key);
    if (mem) {
      this.hits++;
      return mem as CacheEntry<T>;
    }

    // 2. Check localStorage
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
        if (raw) {
          const entry = JSON.parse(raw) as CacheEntry<T>;
          if (entry && typeof entry.timestamp === 'number') {
            this.memoryCache.set(key, entry);
            this.hits++;
            return entry;
          }
        }
      } catch (err) {
        console.warn(`[LocalCacheService] Error reading key "${key}":`, err);
        try {
          window.localStorage.removeItem(STORAGE_PREFIX + key);
        } catch {}
      }
    }

    this.misses++;
    return null;
  }

  /**
   * Convenience helper to retrieve just the underlying data synchronously.
   */
  public getDataSync<T>(key: string): T | null {
    const entry = this.getSync<T>(key);
    return entry ? entry.data : null;
  }

  /**
   * Store data in cache with specified TTL.
   */
  public set<T>(key: string, data: T, ttlMs: number, signature?: string): void {
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttlMs,
      signature,
    };

    // Update in-memory tier
    this.memoryCache.set(key, entry);

    // Persist to localStorage
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const fullKey = STORAGE_PREFIX + key;
        window.localStorage.setItem(fullKey, JSON.stringify(entry));
        this.enforceLRUBounds(key);
      } catch (err: any) {
        // Handle QuotaExceededError gracefully by pruning oldest items
        if (err?.name === 'QuotaExceededError' || err?.code === 22) {
          this.pruneOldestEntries();
          try {
            window.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(entry));
          } catch {}
        } else {
          console.warn(`[LocalCacheService] Error persisting key "${key}":`, err);
        }
      }
    }
  }

  /**
   * Check whether a cache entry has exceeded its fresh TTL.
   * If stale, the caller may return cached data immediately and trigger background refresh.
   */
  public isStale<T>(entry: CacheEntry<T> | null): boolean {
    if (!entry) return true;
    return Date.now() - entry.timestamp > entry.ttlMs;
  }

  /**
   * Remove a specific key from cache.
   */
  public remove(key: string): void {
    this.memoryCache.delete(key);
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.removeItem(STORAGE_PREFIX + key);
      } catch {}
    }
  }

  /**
   * Clear all stuxs cache entries from storage.
   */
  public clearAll(): void {
    this.memoryCache.clear();
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const keysToRemove: string[] = [];
        for (let i = 0; i < window.localStorage.length; i++) {
          const k = window.localStorage.key(i);
          if (k && k.startsWith(STORAGE_PREFIX)) {
            keysToRemove.push(k);
          }
        }
        for (const k of keysToRemove) {
          window.localStorage.removeItem(k);
        }
      } catch {}
    }
  }

  public clear(): void {
    this.clearAll();
  }

  /**
   * Enforce LRU limits for high-volume dynamic keys (e.g. search, artist, album).
   */
  private enforceLRUBounds(newKey: string): void {
    if (!newKey.startsWith('search_') && !newKey.startsWith('artist_') && !newKey.startsWith('album_')) {
      return;
    }

    if (typeof window === 'undefined' || !window.localStorage) return;

    try {
      const searchKeys: { key: string; time: number }[] = [];
      const artistKeys: { key: string; time: number }[] = [];
      const albumKeys: { key: string; time: number }[] = [];

      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (!k || !k.startsWith(STORAGE_PREFIX)) continue;
        const subKey = k.substring(STORAGE_PREFIX.length);

        if (subKey.startsWith('search_')) {
          const item = this.getSync(subKey);
          if (item) searchKeys.push({ key: k, time: item.timestamp });
        } else if (subKey.startsWith('artist_')) {
          const item = this.getSync(subKey);
          if (item) artistKeys.push({ key: k, time: item.timestamp });
        } else if (subKey.startsWith('album_')) {
          const item = this.getSync(subKey);
          if (item) albumKeys.push({ key: k, time: item.timestamp });
        }
      }

      this.trimKeyList(searchKeys, MAX_SEARCH_ITEMS);
      this.trimKeyList(artistKeys, MAX_ARTIST_ITEMS);
      this.trimKeyList(albumKeys, MAX_ALBUM_ITEMS);
    } catch {}
  }

  private trimKeyList(list: { key: string; time: number }[], limit: number): void {
    if (list.length > limit) {
      list.sort((a, b) => a.time - b.time); // oldest first
      const toRemove = list.slice(0, list.length - limit);
      for (const item of toRemove) {
        window.localStorage.removeItem(item.key);
        const subKey = item.key.substring(STORAGE_PREFIX.length);
        this.memoryCache.delete(subKey);
      }
    }
  }

  private pruneOldestEntries(): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      const all: { key: string; time: number }[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(STORAGE_PREFIX)) {
          const subKey = k.substring(STORAGE_PREFIX.length);
          const item = this.getSync(subKey);
          if (item) all.push({ key: k, time: item.timestamp });
        }
      }
      all.sort((a, b) => a.time - b.time);
      // Remove oldest 30%
      const removeCount = Math.max(1, Math.floor(all.length * 0.3));
      for (let i = 0; i < removeCount; i++) {
        window.localStorage.removeItem(all[i].key);
        const subKey = all[i].key.substring(STORAGE_PREFIX.length);
        this.memoryCache.delete(subKey);
      }
    } catch {}
  }

  public getStats(): CacheStats {
    let storageEntries = 0;
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        for (let i = 0; i < window.localStorage.length; i++) {
          const k = window.localStorage.key(i);
          if (k && k.startsWith(STORAGE_PREFIX)) storageEntries++;
        }
      } catch {}
    }
    return {
      memoryEntries: this.memoryCache.size,
      storageEntries,
      hits: this.hits,
      misses: this.misses,
    };
  }

  public getEstimatedSizeBytes(): number {
    let bytes = 0;
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        for (let i = 0; i < window.localStorage.length; i++) {
          const k = window.localStorage.key(i);
          if (k && k.startsWith(STORAGE_PREFIX)) {
            const val = window.localStorage.getItem(k);
            bytes += (k.length + (val ? val.length : 0)) * 2;
          }
        }
      } catch {}
    }
    return bytes;
  }

  public prune(): void {
    this.pruneOldestEntries();
  }
}

export const localCacheService = LocalCacheService.getInstance();
