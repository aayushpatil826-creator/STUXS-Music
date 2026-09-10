import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ArtistService } from '../ArtistService';
import { providerRegistry } from '../../providers/ProviderRegistry';
import { BRANDING_CONFIG } from '../../config/branding';
import type { Artist, Album, Track } from '../../types/music';

// ─── Helpers & Mocks ──────────────────────────────────────────────────────────

const makeTrack = (overrides: Partial<Track> = {}): Track => ({
  id: `track-${Math.random().toString(36).slice(2, 9)}`,
  title: 'Tum Hi Ho',
  artistName: 'Arijit Singh',
  artistId: 'jiosaavn-artist-459329',
  albumTitle: 'Aashiqui 2',
  albumId: 'jiosaavn-album-12345',
  artworkUrl: 'https://cdn.example.com/art.jpg',
  duration: 262,
  audioUrl: 'https://media.jiosaavn.com/content/test/tum-hi-ho.mp4',
  provider: 'jiosaavn',
  accessStatus: 'playable',
  playbackType: 'full',
  isPlayable: true,
  ...overrides,
});

const makeAlbum = (overrides: Partial<Album> = {}): Album => ({
  id: `album-${Math.random().toString(36).slice(2, 9)}`,
  title: 'Aashiqui 2',
  artistName: 'Arijit Singh',
  artistId: 'jiosaavn-artist-459329',
  artworkUrl: 'https://cdn.example.com/album.jpg',
  releaseDate: '2013',
  genre: 'Hindi',
  trackCount: 11,
  provider: 'jiosaavn',
  ...overrides,
});

const makeArtist = (overrides: Partial<Artist> = {}): Artist => ({
  id: 'jiosaavn-artist-459329',
  name: 'Arijit Singh',
  artworkUrl: 'https://cdn.example.com/arijit.jpg',
  isVerified: true,
  monthlyListeners: 35000000,
  genres: ['Hindi', 'Bollywood'],
  bio: 'Arijit Singh is an Indian playback singer.',
  provider: 'jiosaavn',
  songs: [makeTrack()],
  albums: [makeAlbum()],
  ...overrides,
});

// Create fresh unshared ArtistService instance
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const freshService = (): ArtistService => new (ArtistService as any)();

// Mock localStorage in node environment if not present
if (typeof globalThis.localStorage === 'undefined' || !globalThis.localStorage.getItem) {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, val: string) => store.set(key, String(val)),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
  };
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('Artist Page & ArtistService Comprehensive Tests', () => {
  let service: ArtistService;

  beforeEach(() => {
    service = freshService();
    if (globalThis.localStorage) {
      globalThis.localStorage.clear();
    }
  });

  // ── 1. Artist Resolution ──────────────────────────────────────────────────
  it('1. Resolves artist successfully and returns formatted artist data', async () => {
    const mockArtist = makeArtist();
    const originalGetArtist = providerRegistry.getArtist;
    providerRegistry.getArtist = async () => mockArtist;

    try {
      const data = await service.getArtistData('jiosaavn-artist-459329');
      assert.ok(data !== null, 'Data should not be null');
      assert.equal(data.artist.name, 'Arijit Singh');
      assert.equal(data.artist.id, 'jiosaavn-artist-459329');
      assert.equal(data.popularTracks.length, 1);
      assert.equal(data.albums.length, 1);
    } finally {
      providerRegistry.getArtist = originalGetArtist;
    }
  });

  // ── 2. Provider Aggregation ───────────────────────────────────────────────
  it('2. Aggregates tracks and albums from both primary and secondary providers', async () => {
    const jioArtist = makeArtist({
      name: 'Sonu Nigam',
      songs: [makeTrack({ title: 'Kal Ho Naa Ho', artistName: 'Sonu Nigam', provider: 'jiosaavn' })],
      albums: [makeAlbum({ title: 'Kal Ho Naa Ho', releaseDate: '2003', provider: 'jiosaavn' })],
    });

    const gaanaArtist = makeArtist({
      name: 'Sonu Nigam',
      songs: [makeTrack({ title: 'Abhi Mujh Mein Kahin', artistName: 'Sonu Nigam', provider: 'gaana' })],
      albums: [makeAlbum({ title: 'Agneepath', releaseDate: '2012', provider: 'gaana' })],
      bio: 'Legendary Indian playback singer and live performer.',
    });

    const origGetArtist = providerRegistry.getArtist;
    const origGetProvider = providerRegistry.getProvider;

    providerRegistry.getArtist = async () => jioArtist;
    providerRegistry.getProvider = (id: string) => {
      if (id === 'gaana') {
        return {
          id: 'gaana',
          name: 'Gaana',
          isAvailable: true,
          getArtist: async () => gaanaArtist,
        } as any;
      }
      return origGetProvider.call(providerRegistry, id as any);
    };

    try {
      const data = await service.getArtistData('jiosaavn-artist-sonu');
      assert.ok(data !== null);
      assert.equal(data.popularTracks.length, 2, 'Should aggregate tracks from both providers');
      assert.equal(data.albums.length, 2, 'Should aggregate albums from both providers');
    } finally {
      providerRegistry.getArtist = origGetArtist;
      providerRegistry.getProvider = origGetProvider;
    }
  });

  // ── 3. Provider Failure Isolation ─────────────────────────────────────────
  it('3. Secondary provider failure is isolated and does not break resolution', async () => {
    const jioArtist = makeArtist({ name: 'Shreya Ghoshal' });

    const origGetArtist = providerRegistry.getArtist;
    const origGetProvider = providerRegistry.getProvider;

    providerRegistry.getArtist = async () => jioArtist;
    providerRegistry.getProvider = (id: string) => {
      if (id === 'gaana') {
        return {
          id: 'gaana',
          name: 'Gaana',
          isAvailable: true,
          getArtist: async () => {
            throw new Error('Gaana API timeout or network failure');
          },
        } as any;
      }
      return origGetProvider.call(providerRegistry, id as any);
    };

    try {
      const data = await service.getArtistData('jiosaavn-artist-shreya');
      assert.ok(data !== null, 'Should return data even if secondary provider fails');
      assert.equal(data.artist.name, 'Shreya Ghoshal');
      assert.equal(data.popularTracks.length, 1);
    } finally {
      providerRegistry.getArtist = origGetArtist;
      providerRegistry.getProvider = origGetProvider;
    }
  });

  // ── 4. Canonical Artist Matching ──────────────────────────────────────────
  it('4. Uses exact provider identity and does not falsely merge contradictory artists', async () => {
    const artistA = makeArtist({ id: 'jiosaavn-artist-100', name: 'Dev' });
    const origGetArtist = providerRegistry.getArtist;
    providerRegistry.getArtist = async (id) => (id === 'jiosaavn-artist-100' ? artistA : null);

    try {
      const dataA = await service.getArtistData('jiosaavn-artist-100');
      const dataB = await service.getArtistData('jiosaavn-artist-999');

      assert.ok(dataA !== null);
      assert.equal(dataA.artist.id, 'jiosaavn-artist-100');
      assert.equal(dataB, null, 'Different artist ID with no match must return null');
    } finally {
      providerRegistry.getArtist = origGetArtist;
    }
  });

  // ── 5. Duplicate Track Removal ────────────────────────────────────────────
  it('5. Deduplicates identical tracks across providers into a single canonical entry', async () => {
    const jioArtist = makeArtist({
      songs: [
        makeTrack({ title: 'Kesariya', artistName: 'Arijit Singh', provider: 'jiosaavn' }),
        makeTrack({ title: 'Kesariya (From "Brahmastra")', artistName: 'Arijit Singh', provider: 'jiosaavn' }),
      ],
    });

    const gaanaArtist = makeArtist({
      songs: [
        makeTrack({ title: 'Kesariya', artistName: 'Arijit Singh', provider: 'gaana' }),
        makeTrack({ title: 'Apna Bana Le', artistName: 'Arijit Singh', provider: 'gaana' }),
      ],
    });

    const origGetArtist = providerRegistry.getArtist;
    const origGetProvider = providerRegistry.getProvider;

    providerRegistry.getArtist = async () => jioArtist;
    providerRegistry.getProvider = (id: string) => {
      if (id === 'gaana') {
        return {
          id: 'gaana',
          name: 'Gaana',
          isAvailable: true,
          getArtist: async () => gaanaArtist,
        } as any;
      }
      return origGetProvider.call(providerRegistry, id as any);
    };

    try {
      const data = await service.getArtistData('jiosaavn-artist-arijit');
      assert.ok(data !== null);
      // 'Kesariya' and 'Kesariya (From "Brahmastra")' canonicalize to 'kesariya:::arijit singh'
      // plus 'Apna Bana Le'
      assert.equal(data.popularTracks.length, 2, 'Duplicate variants of Kesariya should be deduplicated');
      const titles = data.popularTracks.map((t) => t.title);
      assert.ok(titles.includes('Kesariya'));
      assert.ok(titles.includes('Apna Bana Le'));
    } finally {
      providerRegistry.getArtist = origGetArtist;
      providerRegistry.getProvider = origGetProvider;
    }
  });

  // ── 6. Duplicate Album Removal ────────────────────────────────────────────
  it('6. Deduplicates identical albums across providers based on title and release year', async () => {
    const jioArtist = makeArtist({
      albums: [
        makeAlbum({ title: 'Brahmastra', releaseDate: '2022', provider: 'jiosaavn' }),
      ],
    });

    const gaanaArtist = makeArtist({
      albums: [
        makeAlbum({ title: 'Brahmastra', releaseDate: '2022', provider: 'gaana' }),
        makeAlbum({ title: 'Aashiqui 2', releaseDate: '2013', provider: 'gaana' }),
      ],
    });

    const origGetArtist = providerRegistry.getArtist;
    const origGetProvider = providerRegistry.getProvider;

    providerRegistry.getArtist = async () => jioArtist;
    providerRegistry.getProvider = (id: string) => {
      if (id === 'gaana') {
        return {
          id: 'gaana',
          name: 'Gaana',
          isAvailable: true,
          getArtist: async () => gaanaArtist,
        } as any;
      }
      return origGetProvider.call(providerRegistry, id as any);
    };

    try {
      const data = await service.getArtistData('jiosaavn-artist-test');
      assert.ok(data !== null);
      assert.equal(data.albums.length, 2, 'Brahmastra should be deduplicated to 1 entry');
    } finally {
      providerRegistry.getArtist = origGetArtist;
      providerRegistry.getProvider = origGetProvider;
    }
  });

  // ── 7. Popular Track Ordering ─────────────────────────────────────────────
  it('7. Preserves legitimate provider topSongs ordering without fabricating popularity numbers', async () => {
    const track1 = makeTrack({ title: 'Channa Mereya', artistName: 'Arijit Singh' });
    const track2 = makeTrack({ title: 'Tum Hi Ho', artistName: 'Arijit Singh' });
    const track3 = makeTrack({ title: 'Raabta', artistName: 'Arijit Singh' });

    const artist = makeArtist({
      songs: [track1, track2, track3],
    });

    const origGetArtist = providerRegistry.getArtist;
    providerRegistry.getArtist = async () => artist;

    try {
      const data = await service.getArtistData('jiosaavn-artist-ordered');
      assert.ok(data !== null);
      assert.equal(data.popularTracks[0].title, 'Channa Mereya');
      assert.equal(data.popularTracks[1].title, 'Tum Hi Ho');
      assert.equal(data.popularTracks[2].title, 'Raabta');
    } finally {
      providerRegistry.getArtist = origGetArtist;
    }
  });

  // ── 8. Playability Validation ─────────────────────────────────────────────
  it('8. Only includes tracks with valid full-length playable audio stream', async () => {
    const playableTrack = makeTrack({ title: 'Playable Song', audioUrl: 'https://media.stuxs.audio/song.mp4' });
    const missingAudioTrack = makeTrack({ title: 'Missing Audio', audioUrl: '' });
    const blockedTrack = makeTrack({ title: 'Blocked Song', accessStatus: 'blocked', isPlayable: false });

    const artist = makeArtist({
      songs: [playableTrack, missingAudioTrack, blockedTrack],
    });

    const origGetArtist = providerRegistry.getArtist;
    providerRegistry.getArtist = async () => artist;

    try {
      const data = await service.getArtistData('jiosaavn-artist-playability');
      assert.ok(data !== null);
      assert.equal(data.popularTracks.length, 1);
      assert.equal(data.popularTracks[0].title, 'Playable Song');
    } finally {
      providerRegistry.getArtist = origGetArtist;
    }
  });

  // ── 9. Preview-Only Rejection ─────────────────────────────────────────────
  it('9. Rejects preview-only tracks', async () => {
    const previewTrack1 = makeTrack({ title: 'Preview Track 1', isPreview: true });
    const previewTrack2 = makeTrack({ title: 'Preview Track 2', playbackType: 'preview' });
    const fullTrack = makeTrack({ title: 'Full Track', isPreview: false, playbackType: 'full' });

    const artist = makeArtist({
      songs: [previewTrack1, previewTrack2, fullTrack],
    });

    const origGetArtist = providerRegistry.getArtist;
    providerRegistry.getArtist = async () => artist;

    try {
      const data = await service.getArtistData('jiosaavn-artist-preview');
      assert.ok(data !== null);
      assert.equal(data.popularTracks.length, 1);
      assert.equal(data.popularTracks[0].title, 'Full Track');
    } finally {
      providerRegistry.getArtist = origGetArtist;
    }
  });

  // ── 10. iTunes <= 30s Preview Rejection ───────────────────────────────────
  it('10. Strictly rejects iTunes preview tracks with duration <= 30 seconds', async () => {
    const itunesPreview = makeTrack({
      title: 'iTunes Preview',
      provider: 'itunes',
      duration: 30,
    });
    const itunesFull = makeTrack({
      title: 'iTunes Full Master',
      provider: 'itunes',
      duration: 210,
    });

    const artist = makeArtist({
      songs: [itunesPreview, itunesFull],
    });

    const origGetArtist = providerRegistry.getArtist;
    providerRegistry.getArtist = async () => artist;

    try {
      const data = await service.getArtistData('itunes-artist-duration');
      assert.ok(data !== null);
      assert.equal(data.popularTracks.length, 1);
      assert.equal(data.popularTracks[0].title, 'iTunes Full Master');
    } finally {
      providerRegistry.getArtist = origGetArtist;
    }
  });

  // ── 11. SoundCloud Rejection ──────────────────────────────────────────────
  it('11. Unconditionally rejects SoundCloud tracks and provider sources', async () => {
    const scTrack1 = makeTrack({ title: 'SC 1', provider: 'soundcloud' as any });
    const scTrack2 = makeTrack({ title: 'SC 2', id: 'soundcloud-98765' });
    const validTrack = makeTrack({ title: 'Valid Master' });

    const artist = makeArtist({
      songs: [scTrack1, scTrack2, validTrack],
    });

    const origGetArtist = providerRegistry.getArtist;
    providerRegistry.getArtist = async () => artist;

    try {
      const data = await service.getArtistData('artist-sc-rejection');
      assert.ok(data !== null);
      assert.equal(data.popularTracks.length, 1);
      assert.equal(data.popularTracks[0].title, 'Valid Master');
    } finally {
      providerRegistry.getArtist = origGetArtist;
    }
  });

  // ── 12. Album Type Split (Albums vs Singles) ──────────────────────────────
  it('12. Splits albums and singles/EPs when provider exposes reliable albumType metadata', async () => {
    const regularAlbum = makeAlbum({ title: 'Full Album', albumType: 'album' });
    const single = makeAlbum({ title: 'Single Release', albumType: 'single' });
    const ep = makeAlbum({ title: 'EP Release', albumType: 'ep' });

    const artist = makeArtist({
      albums: [regularAlbum, single, ep],
    });

    const origGetArtist = providerRegistry.getArtist;
    providerRegistry.getArtist = async () => artist;

    try {
      const data = await service.getArtistData('artist-album-split');
      assert.ok(data !== null);
      assert.equal(data.albums.length, 1);
      assert.equal(data.albums[0].title, 'Full Album');
      assert.equal(data.singles.length, 2);
      const singleTitles = data.singles.map((s) => s.title);
      assert.ok(singleTitles.includes('Single Release'));
      assert.ok(singleTitles.includes('EP Release'));
    } finally {
      providerRegistry.getArtist = origGetArtist;
    }
  });

  // ── 13. Empty Artist State ────────────────────────────────────────────────
  it('13. Handles artist with no songs or no albums gracefully', async () => {
    const emptyArtist = makeArtist({
      songs: [],
      albums: [],
    });

    const origGetArtist = providerRegistry.getArtist;
    providerRegistry.getArtist = async () => emptyArtist;

    try {
      const data = await service.getArtistData('artist-empty');
      assert.ok(data !== null);
      assert.equal(data.popularTracks.length, 0);
      assert.equal(data.albums.length, 0);
      assert.equal(data.singles.length, 0);
    } finally {
      providerRegistry.getArtist = origGetArtist;
    }
  });

  // ── 14. Artwork Fallback ──────────────────────────────────────────────────
  it('14. Applies universal artwork fallback when artworkUrl is missing or undefined', async () => {
    const artist = makeArtist({
      artworkUrl: '',
      songs: [makeTrack({ artworkUrl: '' })],
      albums: [makeAlbum({ artworkUrl: '' })],
    });

    const origGetArtist = providerRegistry.getArtist;
    providerRegistry.getArtist = async () => artist;

    try {
      const data = await service.getArtistData('artist-no-artwork');
      assert.ok(data !== null);
      assert.equal(data.artist.artworkUrl, BRANDING_CONFIG.defaultArtwork);
      assert.equal(data.popularTracks[0].artworkUrl, BRANDING_CONFIG.defaultArtwork);
      assert.equal(data.albums[0].artworkUrl, BRANDING_CONFIG.defaultArtwork);
    } finally {
      providerRegistry.getArtist = origGetArtist;
    }
  });

  // ── 15. In-Memory and Storage Cache TTL Behavior ──────────────────────────
  it('15. Cache returns warm data instantly and expires after TTL', async () => {
    let callCount = 0;
    const origGetArtist = providerRegistry.getArtist;
    providerRegistry.getArtist = async () => {
      callCount++;
      return makeArtist({ name: `Artist Call ${callCount}` });
    };

    try {
      // First call (cold fetch)
      const data1 = await service.getArtistData('artist-cache-test');
      assert.equal(callCount, 1);
      assert.equal(data1?.artist.name, 'Artist Call 1');

      // Second call within TTL (instant hit from memory)
      const data2 = await service.getArtistData('artist-cache-test');
      assert.equal(callCount, 1, 'Should not trigger network call on warm cache');
      assert.equal(data2?.artist.name, 'Artist Call 1');

      // Synchronous getCached check
      const cached = service.getCached('artist-cache-test');
      assert.ok(cached !== null);
      assert.equal(cached.artist.name, 'Artist Call 1');

      // Simulate expired cache by artificially manipulating timestamp
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const entry = (service as any).memoryCache.get('artist-cache-test');
      if (entry) {
        entry.timestamp = Date.now() - 20 * 60 * 1000; // 20 mins ago (exceeds 15m TTL)
      }

      // Should return null after expiration
      const expired = service.getCached('artist-cache-test');
      assert.equal(expired, null, 'Expired cache must return null');
    } finally {
      providerRegistry.getArtist = origGetArtist;
    }
  });

  // ── 16. In-Flight Request Deduplication ───────────────────────────────────
  it('16. Concurrent requests for same artist share a single in-flight network call', async () => {
    let networkCalls = 0;
    const origGetArtist = providerRegistry.getArtist;
    providerRegistry.getArtist = async () => {
      networkCalls++;
      // Simulate network latency
      await new Promise((r) => setTimeout(r, 40));
      return makeArtist();
    };

    try {
      const [res1, res2, res3] = await Promise.all([
        service.getArtistData('artist-concurrent'),
        service.getArtistData('artist-concurrent'),
        service.getArtistData('artist-concurrent'),
      ]);

      assert.equal(networkCalls, 1, 'Concurrent requests must share one in-flight promise');
      assert.equal(res1?.artist.name, res2?.artist.name);
      assert.equal(res2?.artist.name, res3?.artist.name);
    } finally {
      providerRegistry.getArtist = origGetArtist;
    }
  });

  // ── 17. Malformed Persistent Storage Resilience ───────────────────────────
  it('17. Safely discards corrupt or malformed entries in persistent storage without crashing', async () => {
    if (globalThis.localStorage) {
      // Seed corrupt JSON in localStorage
      globalThis.localStorage.setItem('stuxs_artist_cache_v1', '{ invalid json ...');
      assert.doesNotThrow(() => {
        service.getCached('artist-any');
      });

      // Seed valid JSON but malformed schema
      globalThis.localStorage.setItem(
        'stuxs_artist_cache_v1',
        JSON.stringify({
          'artist-malformed': {
            timestamp: Date.now(),
            data: { invalidField: true }, // missing artist, popularTracks, albums
          },
        })
      );
      const result = service.getCached('artist-malformed');
      assert.equal(result, null, 'Malformed schema in storage must return null');
    }
  });

  // ── 18. Verified Badge Correctness ────────────────────────────────────────
  it('18. Preserves isVerified only when provider explicitly returns true', async () => {
    const verifiedArtist = makeArtist({ isVerified: true });
    const unverifiedArtist = makeArtist({ id: 'artist-unverified', isVerified: false });

    const origGetArtist = providerRegistry.getArtist;
    providerRegistry.getArtist = async (id) => (id === 'artist-unverified' ? unverifiedArtist : verifiedArtist);

    try {
      const dataV = await service.getArtistData('artist-verified');
      const dataU = await service.getArtistData('artist-unverified');

      assert.equal(dataV?.artist.isVerified, true);
      assert.equal(dataU?.artist.isVerified, false);
    } finally {
      providerRegistry.getArtist = origGetArtist;
    }
  });
});
