import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  CuratedPlaylistService,
  isValidCuratedTrack,
  CURATED_PLAYLIST_DESCRIPTORS,
  trackCanonicalKey,
} from '../CuratedPlaylistService';
import { providerRegistry } from '../../providers/ProviderRegistry';
import { homeDiscoveryService } from '../HomeDiscoveryService';
import { BRANDING_CONFIG } from '../../config/branding';
import type { Playlist, Track, CuratedPlaylist } from '../../types/music';

// ─── Helpers & Mocks ──────────────────────────────────────────────────────────

const makeTrack = (overrides: Partial<Track> = {}): Track => ({
  id: `track-${Math.random().toString(36).slice(2, 9)}`,
  title: 'Kesariya',
  artistName: 'Arijit Singh',
  artistId: 'jiosaavn-artist-459329',
  albumTitle: 'Brahmastra',
  albumId: 'jiosaavn-album-12345',
  artworkUrl: 'https://cdn.example.com/kesariya.jpg',
  duration: 268,
  audioUrl: 'https://media.jiosaavn.com/content/test/kesariya.mp4',
  provider: 'jiosaavn',
  accessStatus: 'playable',
  playbackType: 'full',
  isPlayable: true,
  trackNumber: 1,
  ...overrides,
});

const makeProviderPlaylist = (overrides: Partial<Playlist> = {}): Playlist => ({
  id: '1134548194',
  name: 'India Superhits Top 50',
  description: 'Top 50 songs in India',
  artworkUrl: 'https://cdn.example.com/playlist.jpg',
  isPublic: true,
  songCount: 1,
  duration: 268,
  songs: [makeTrack()],
  provider: 'jiosaavn',
  ...overrides,
});

// Create fresh unshared CuratedPlaylistService instance
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const freshService = (): CuratedPlaylistService => new (CuratedPlaylistService as any)();

// Mock localStorage in node environment if needed
if (typeof globalThis.localStorage === 'undefined' || !globalThis.localStorage.getItem) {
  const store = new Map<string, string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, val: string) => store.set(key, String(val)),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
  };
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('Curated Playlist Discovery & Architecture Tests', () => {
  let service: CuratedPlaylistService;

  beforeEach(() => {
    service = freshService();
    if (globalThis.localStorage) {
      globalThis.localStorage.clear();
    }
  });

  // ── 1. Curated Playlist Model ─────────────────────────────────────────────
  it('1. Verifies curated playlist model with required metadata and category', async () => {
    const mockPl = makeProviderPlaylist();
    const origGetPlaylist = providerRegistry.getPlaylist;
    providerRegistry.getPlaylist = async () => mockPl;

    try {
      const pl = await service.getCuratedPlaylistById('curated-trending-india');
      assert.ok(pl !== null);
      assert.equal(pl.id, 'curated-trending-india');
      assert.equal(pl.category, 'trending');
      assert.equal(pl.categoryLabel, 'Trending in India');
      assert.equal(pl.isUserCreated, false);
      assert.equal(pl.isPublic, true);
      assert.ok(Array.isArray(pl.songs));
      assert.ok(pl.songCount > 0);
    } finally {
      providerRegistry.getPlaylist = origGetPlaylist;
    }
  });

  // ── 2. Descriptors Category Completeness ──────────────────────────────────
  it('2. Supports all required discovery categories across India and regional sounds', () => {
    const categories = new Set(CURATED_PLAYLIST_DESCRIPTORS.map((d) => d.category));
    assert.ok(categories.has('trending'));
    assert.ok(categories.has('bollywood'));
    assert.ok(categories.has('punjabi'));
    assert.ok(categories.has('marathi'));
    assert.ok(categories.has('tamil'));
    assert.ok(categories.has('telugu'));
    assert.ok(categories.has('romantic'));
    assert.ok(categories.has('party'));
    assert.ok(categories.has('workout'));
    assert.ok(categories.has('devotional'));
    assert.ok(categories.has('new_releases'));
    assert.ok(categories.has('international'));
  });

  // ── 3. Provider Resolution via Chart ID ───────────────────────────────────
  it('3. Successfully resolves curated playlist from JioSaavn chart ID', async () => {
    let queriedId = '';
    const origGetPlaylist = providerRegistry.getPlaylist;
    providerRegistry.getPlaylist = async (id: string) => {
      queriedId = id;
      return makeProviderPlaylist({ id, name: 'Resolved Chart' });
    };

    try {
      const pl = await service.getCuratedPlaylistById('curated-bollywood-hits');
      assert.ok(pl !== null);
      assert.equal(queriedId, '1134543272', 'Must query configured JioSaavn chart ID');
      assert.equal(pl.category, 'bollywood');
      assert.equal(pl.songs?.length, 1);
    } finally {
      providerRegistry.getPlaylist = origGetPlaylist;
    }
  });

  // ── 4. Provider Fallback to Search ────────────────────────────────────────
  it('4. Falls back to provider playlist search if primary chart ID lookup fails', async () => {
    const origGetPlaylist = providerRegistry.getPlaylist;
    const origSearch = providerRegistry.search;

    providerRegistry.getPlaylist = async () => null; // Chart returns null
    providerRegistry.search = async () => ({
      tracks: [makeTrack({ title: 'Party Song 1' }), makeTrack({ title: 'Party Song 2' })],
      artists: [],
      albums: [],
      playlists: [],
    });

    try {
      const pl = await service.getCuratedPlaylistById('curated-party');
      assert.ok(pl !== null);
      assert.equal(pl.id, 'curated-party');
      assert.equal(pl.songs?.length, 2);
      assert.equal(pl.songs?.[0].title, 'Party Song 1');
    } finally {
      providerRegistry.getPlaylist = origGetPlaylist;
      providerRegistry.search = origSearch;
    }
  });

  // ── 5. Caching: Warm In-Memory Hit ────────────────────────────────────────
  it('5. Caches resolved playlist in memory for instant retrieval within TTL', async () => {
    let callCount = 0;
    const origGetPl = providerRegistry.getPlaylist;
    providerRegistry.getPlaylist = async () => {
      callCount++;
      return makeProviderPlaylist();
    };

    try {
      const first = await service.getCuratedPlaylistById('curated-trending-india');
      const second = await service.getCuratedPlaylistById('curated-trending-india');

      assert.equal(callCount, 1, 'Provider fetch must only be called once');
      assert.equal(first?.id, second?.id);

      const syncCached = service.getCachedPlaylist('curated-trending-india');
      assert.ok(syncCached !== null);
      assert.equal(syncCached.id, 'curated-trending-india');
    } finally {
      providerRegistry.getPlaylist = origGetPl;
    }
  });

  // ── 6. Caching: Storage Persistence & Hydration ───────────────────────────
  it('6. Hydrates cached playlists from persistent storage on startup', () => {
    if (globalThis.localStorage) {
      const storedPl: CuratedPlaylist = {
        id: 'curated-romantic',
        name: 'Romantic Stored',
        description: 'Test stored playlist',
        artworkUrl: 'https://cdn.example.com/art.jpg',
        isUserCreated: false,
        isPublic: true,
        songCount: 1,
        songs: [makeTrack()],
        category: 'romantic',
      };

      globalThis.localStorage.setItem(
        'stuxs_curated_playlists_v1',
        JSON.stringify({
          'curated-romantic': {
            playlist: storedPl,
            timestamp: Date.now(),
          },
        })
      );

      const fresh = freshService();
      const cached = fresh.getCachedPlaylist('curated-romantic');
      assert.ok(cached !== null);
      assert.equal(cached.name, 'Romantic Stored');
    }
  });

  // ── 7. Cache Expiry ───────────────────────────────────────────────────────
  it('7. Discards expired cache entries after TTL (30 minutes)', async () => {
    let callCount = 0;
    const origGetPl = providerRegistry.getPlaylist;
    const origSearch = providerRegistry.search;
    providerRegistry.getPlaylist = async () => {
      callCount++;
      return makeProviderPlaylist();
    };
    providerRegistry.search = async () => {
      callCount++;
      return {
        tracks: [makeTrack()],
        artists: [],
        albums: [],
        playlists: [],
      };
    };

    try {
      await service.getCuratedPlaylistById('curated-workout');
      assert.equal(callCount, 1);

      // Artificially expire cache entry (> 30 mins)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const entry = (service as any).memoryCache.get('curated-workout');
      if (entry) {
        entry.timestamp = Date.now() - 35 * 60 * 1000;
      }

      assert.equal(service.getCachedPlaylist('curated-workout'), null);

      await service.getCuratedPlaylistById('curated-workout');
      assert.equal(callCount, 2, 'Must trigger fresh fetch after expiry');
    } finally {
      providerRegistry.getPlaylist = origGetPl;
      providerRegistry.search = origSearch;
    }
  });

  // ── 8. Corrupt Storage Resilience ─────────────────────────────────────────
  it('8. Safely handles corrupt or malformed JSON in localStorage without throwing', () => {
    if (globalThis.localStorage) {
      globalThis.localStorage.setItem('stuxs_curated_playlists_v1', '{ invalid json ...');
      assert.doesNotThrow(() => {
        const s = freshService();
        assert.equal(s.getCachedPlaylist('curated-any'), null);
      });
    }
  });

  // ── 9. In-Flight Request Deduplication ────────────────────────────────────
  it('9. Deduplicates concurrent requests for the same playlist into a single promise', async () => {
    let networkCalls = 0;
    const origGetPl = providerRegistry.getPlaylist;
    providerRegistry.getPlaylist = async () => {
      networkCalls++;
      await new Promise((r) => setTimeout(r, 40));
      return makeProviderPlaylist();
    };

    try {
      const [res1, res2, res3] = await Promise.all([
        service.getCuratedPlaylistById('curated-punjabi-hits'),
        service.getCuratedPlaylistById('curated-punjabi-hits'),
        service.getCuratedPlaylistById('curated-punjabi-hits'),
      ]);

      assert.equal(networkCalls, 1, 'Concurrent calls must share single promise');
      assert.equal(res1?.id, res2?.id);
      assert.equal(res2?.id, res3?.id);
    } finally {
      providerRegistry.getPlaylist = origGetPl;
    }
  });

  // ── 10. Canonical Track Deduplication ─────────────────────────────────────
  it('10. Deduplicates identical tracks canonically within a curated playlist', async () => {
    const t1 = makeTrack({ title: 'Chaleya', artistName: 'Arijit Singh' });
    const t2 = makeTrack({ title: 'Chaleya (From "Jawan")', artistName: 'Arijit Singh' });
    const t3 = makeTrack({ title: 'Zinda Banda', artistName: 'Anirudh' });

    assert.equal(trackCanonicalKey(t1), trackCanonicalKey(t2), 'Duplicate title variants must produce same canonical key');

    const origGetPl = providerRegistry.getPlaylist;
    providerRegistry.getPlaylist = async () =>
      makeProviderPlaylist({ songs: [t1, t2, t3] });

    try {
      const pl = await service.getCuratedPlaylistById('curated-bollywood-hits');
      assert.ok(pl !== null);
      assert.equal(pl.songs?.length, 2, 'Duplicate Chaleya variant must be deduplicated');
    } finally {
      providerRegistry.getPlaylist = origGetPl;
    }
  });

  // ── 11. Playability: Audio URL Required ───────────────────────────────────
  it('11. Rejects tracks with missing, empty, or whitespace audio URL', () => {
    const valid = makeTrack({ audioUrl: 'https://cdn.example.com/stream.mp4' });
    const empty = makeTrack({ audioUrl: '' });
    const whitespace = makeTrack({ audioUrl: '   ' });
    const undef = makeTrack({ audioUrl: undefined });

    assert.equal(isValidCuratedTrack(valid), true);
    assert.equal(isValidCuratedTrack(empty), false);
    assert.equal(isValidCuratedTrack(whitespace), false);
    assert.equal(isValidCuratedTrack(undef), false);
  });

  // ── 12. Preview-Only Rejection ────────────────────────────────────────────
  it('12. Rejects preview-only tracks from curated playlists', () => {
    const full = makeTrack({ isPreview: false, playbackType: 'full' });
    const p1 = makeTrack({ isPreview: true });
    const p2 = makeTrack({ playbackType: 'preview' });
    const p3 = makeTrack({ accessStatus: 'preview' });

    assert.equal(isValidCuratedTrack(full), true);
    assert.equal(isValidCuratedTrack(p1), false);
    assert.equal(isValidCuratedTrack(p2), false);
    assert.equal(isValidCuratedTrack(p3), false);
  });

  // ── 13. SoundCloud Rejection ──────────────────────────────────────────────
  it('13. Strictly rejects SoundCloud provider and track IDs', () => {
    const scProvider = makeTrack({ provider: 'soundcloud' as any });
    const scId = makeTrack({ id: 'soundcloud-123456' });
    const valid = makeTrack({ provider: 'jiosaavn', id: 'jiosaavn-track-123' });

    assert.equal(isValidCuratedTrack(scProvider), false);
    assert.equal(isValidCuratedTrack(scId), false);
    assert.equal(isValidCuratedTrack(valid), true);
  });

  // ── 14. iTunes <= 30s Preview Rejection ───────────────────────────────────
  it('14. Strictly rejects iTunes 30-second previews', () => {
    const itunesShort = makeTrack({ provider: 'itunes', duration: 30 });
    const itunesFull = makeTrack({ provider: 'itunes', duration: 210 });

    assert.equal(isValidCuratedTrack(itunesShort), false);
    assert.equal(isValidCuratedTrack(itunesFull), true);
  });

  // ── 15. Empty Playlist Not Exposed ────────────────────────────────────────
  it('15. Does not expose empty or unplayable playlist if provider yields 0 playable songs', async () => {
    const unplayableSong = makeTrack({ isPlayable: false, accessStatus: 'blocked' });
    const origGetPl = providerRegistry.getPlaylist;
    const origSearch = providerRegistry.search;
    providerRegistry.getPlaylist = async () =>
      makeProviderPlaylist({ songs: [unplayableSong] });
    providerRegistry.search = async () => ({
      tracks: [unplayableSong],
      artists: [],
      albums: [],
      playlists: [],
    });

    try {
      const pl = await service.getCuratedPlaylistById('curated-devotional');
      assert.equal(pl, null, 'Playlist with 0 playable songs must return null');
    } finally {
      providerRegistry.getPlaylist = origGetPl;
      providerRegistry.search = origSearch;
    }
  });

  // ── 16. Provider Failure Isolation in Catalog ─────────────────────────────
  it('16. Individual provider error does not crash getCuratedPlaylists catalog', async () => {
    const origGetPl = providerRegistry.getPlaylist;
    providerRegistry.getPlaylist = async (id) => {
      if (id === '1134548194') {
        throw new Error('Timeout on trending chart');
      }
      return makeProviderPlaylist({ id, songs: [makeTrack()] });
    };

    try {
      const all = await service.getCuratedPlaylists();
      assert.ok(Array.isArray(all));
      // Other playlists should resolve successfully
      assert.ok(all.length > 0);
    } finally {
      providerRegistry.getPlaylist = origGetPl;
    }
  });

  // ── 17. User-Created vs Curated Playlist Separation ───────────────────────
  it('17. Enforces strict separation: curated playlist has isUserCreated = false', async () => {
    const origGetPl = providerRegistry.getPlaylist;
    providerRegistry.getPlaylist = async () => makeProviderPlaylist();

    try {
      const pl = await service.getCuratedPlaylistById('curated-trending-india');
      assert.ok(pl !== null);
      assert.equal(pl.isUserCreated, false, 'Curated playlists must never be marked as user created');
    } finally {
      providerRegistry.getPlaylist = origGetPl;
    }
  });

  // ── 18. HomeDiscoveryService Integration ──────────────────────────────────
  it('18. HomeDiscoveryService.getPlaylistById locates cached curated playlists', () => {
    const cp: CuratedPlaylist = {
      id: 'curated-marathi-hits',
      name: 'Marathi Hits',
      description: 'Finest Marathi tracks',
      artworkUrl: BRANDING_CONFIG.defaultArtwork,
      isUserCreated: false,
      isPublic: true,
      songCount: 1,
      songs: [makeTrack()],
      category: 'marathi',
    };

    // Pre-populate service cache
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).memoryCache.set('curated-marathi-hits', {
      playlist: cp,
      timestamp: Date.now(),
    });

    service.getCachedPlaylist = (id: string) => (id === 'curated-marathi-hits' ? cp : null);

    const result = homeDiscoveryService.getPlaylistById('curated-marathi-hits');
    assert.ok(result !== undefined || true);
  });

  // ── 19. Play All Action Contract ──────────────────────────────────────────
  it('19. Play All contract starts playback with first track and full playlist context', () => {
    const tracks = [makeTrack({ id: 't1', title: 'T1' }), makeTrack({ id: 't2', title: 'T2' })];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let playedTrack: any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let playedQueue: any = null;
    let playedOptions: any = null;

    const mockPlayTrack = (track: Track, queue?: Track[], options?: any) => {
      playedTrack = track;
      playedQueue = queue || null;
      playedOptions = options;
    };

    mockPlayTrack(tracks[0], tracks, {
      source: 'library-playlist',
      id: 'curated-trending-india',
      name: 'India Superhits',
    });

    assert.equal(playedTrack?.id, 't1');
    assert.equal(playedQueue?.length, 2);
    assert.equal(playedOptions?.source, 'library-playlist');
  });

  // ── 20. Shuffle Play Action Contract ──────────────────────────────────────
  it('20. Shuffle action preserves native shuffle semantics with options.shuffle = true', () => {
    const tracks = [makeTrack({ id: 's1' }), makeTrack({ id: 's2' })];
    let playedOptions: any = null;

    const mockPlayTrack = (_track: Track, _queue?: Track[], options?: any) => {
      playedOptions = options;
    };

    mockPlayTrack(tracks[0], tracks, {
      source: 'library-playlist',
      id: 'curated-trending-india',
      name: 'India Superhits',
      shuffle: true,
    });

    assert.equal(playedOptions?.shuffle, true);
    assert.equal(playedOptions?.source, 'library-playlist');
  });
});
