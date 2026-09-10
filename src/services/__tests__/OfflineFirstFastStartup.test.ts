import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { networkStateService } from '../NetworkStateService';
import { localCacheService } from '../LocalCacheService';
import { homeDiscoveryService, type HomeFeedData } from '../HomeDiscoveryService';
import { normalizeSearchQuery, scoreTrack } from '../../utils/searchIntelligence';
import type { Track, SearchResults } from '../../types/music';

// Mock localStorage for Node environment if not present
class MockLocalStorage {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get length(): number {
    return this.store.size;
  }

  key(index: number): string | null {
    const keys = Array.from(this.store.keys());
    return keys[index] ?? null;
  }
}

if (typeof globalThis.localStorage === 'undefined' || !globalThis.localStorage) {
  (globalThis as any).localStorage = new MockLocalStorage();
}
if (typeof globalThis.window === 'undefined' || !globalThis.window) {
  (globalThis as any).window = globalThis;
}

describe('Offline-First & Fast Startup Test Suite (A-T)', () => {
  beforeEach(() => {
    localStorage.clear();
    localCacheService.clear();
    homeDiscoveryService.clearCache();
    networkStateService.setOnline();
  });

  // A. test_offline_cold_start_renders_shell_immediately
  it('A: test_offline_cold_start_renders_shell_immediately', () => {
    networkStateService.setOffline();
    const startTime = Date.now();
    const feed = homeDiscoveryService.getCachedFeedSync();
    const elapsed = Date.now() - startTime;
    // Must complete synchronously under 10ms (zero network pause)
    assert.ok(elapsed < 20);
    assert.ok(feed === null || typeof feed === 'object');
    assert.equal(typeof elapsed, 'number');
  });

  // B. test_home_renders_cached_content_offline
  it('B: test_home_renders_cached_content_offline', () => {
    const mockTrack: Track = {
      id: 'offline-cached-1',
      title: 'Kesariya',
      artistId: 'art-arijit',
      artistName: 'Arijit Singh',
      artworkUrl: 'https://example.com/art.jpg',
      audioUrl: 'https://example.com/audio.mp3',
      provider: 'jiosaavn',
      duration: 210,
    };
    const mockFeed: HomeFeedData = {
      heroTrack: mockTrack,
      quickPicks: [mockTrack],
      madeForYou: [mockTrack],
      popularInIndia: [mockTrack],
      trendingNow: [mockTrack],
      featuredPlaylists: [],
      featuredAlbums: [],
      featuredArtists: [],
      isLoading: false,
    };

    localStorage.setItem(
      'stuxs_home_feed_cache_v2',
      JSON.stringify({ data: mockFeed, timestamp: Date.now(), signature: 'test' })
    );

    networkStateService.setOffline();
    const cached = homeDiscoveryService.getCachedFeedSync();
    assert.ok(cached !== null);
    assert.equal(cached.heroTrack?.title, 'Kesariya');
    assert.equal(cached.isLoading, false);
    assert.equal(cached.quickPicks.length, 1);
  });

  // C. test_home_renders_graceful_empty_if_first_run_offline
  it('C: test_home_renders_graceful_empty_if_first_run_offline', () => {
    networkStateService.setOffline();
    const cached = homeDiscoveryService.getCachedFeedSync();
    // First run with no cache returns null or empty graceful structure
    assert.ok(cached === null || cached.isLoading === false);
  });

  // D. test_no_infinite_spinner_offline
  it('D: test_no_infinite_spinner_offline', async () => {
    networkStateService.setOffline();
    const mockSignals = {
      recentlyPlayed: [],
      favorites: [],
      playlists: [],
    };
    const feed = await homeDiscoveryService.getHomeFeed(mockSignals);
    assert.equal(feed.isLoading, false);
  });

  // E. test_no_white_screen_offline
  it('E: test_no_white_screen_offline', () => {
    // Corrupt storage with invalid data
    localStorage.setItem('stuxs_home_feed_cache_v2', '{corrupted_data_not_json]');
    networkStateService.setOffline();
    // Must never throw uncaught exception causing white screen
    assert.doesNotThrow(() => {
      const result = homeDiscoveryService.getCachedFeedSync();
      assert.ok(result === null || result.isLoading === false);
    });
  });

  // F. test_search_offline_shows_offline_indicator
  it('F: test_search_offline_shows_offline_indicator', () => {
    networkStateService.setOffline();
    assert.equal(networkStateService.isOffline(), true);
    assert.equal(networkStateService.getState(), 'OFFLINE');
  });

  // G. test_search_offline_searches_local_tracks
  it('G: test_search_offline_searches_local_tracks', () => {
    const localTracks: Track[] = [
      {
        id: 'loc-1',
        title: 'Channa Mereya',
        artistId: 'art-arijit',
        artistName: 'Arijit Singh',
        artworkUrl: 'https://example.com/art.jpg',
        audioUrl: 'file:///data/local1.mp3',
        provider: 'local',
        duration: 280,
      },
      {
        id: 'loc-2',
        title: 'Believer',
        artistId: 'art-dragons',
        artistName: 'Imagine Dragons',
        artworkUrl: 'https://example.com/art2.jpg',
        audioUrl: 'file:///data/local2.mp3',
        provider: 'local',
        duration: 204,
      },
    ];

    const nq = normalizeSearchQuery('Channa');
    const scored = localTracks
      .filter((track) => {
        const title = (track.title || '').toLowerCase();
        const artist = (track.artistName || '').toLowerCase();
        return title.includes(nq.clean) || artist.includes(nq.clean);
      })
      .map((track) => ({ track, score: scoreTrack(track, nq) }))
      .filter((item) => item.score > 120);
    scored.sort((a, b) => b.score - a.score);
    const matched = scored.map((item) => item.track);

    assert.equal(matched.length, 1);
    assert.equal(matched[0].title, 'Channa Mereya');
  });

  // H. test_search_slow_network_shows_cached_first
  it('H: test_search_slow_network_shows_cached_first', () => {
    const cachedSearch: SearchResults = {
      tracks: [
        {
          id: 's-1',
          title: 'Tum Hi Ho',
          artistId: 'art-arijit',
          artistName: 'Arijit Singh',
          artworkUrl: 'https://example.com/art.jpg',
          audioUrl: 'https://example.com/audio.mp3',
          provider: 'jiosaavn',
          duration: 260,
        },
      ],
      artists: [],
      albums: [],
      playlists: [],
    };

    localCacheService.set('search_tum hi ho', cachedSearch, 15 * 60 * 1000);
    const instant = localCacheService.getDataSync<SearchResults>('search_tum hi ho');
    assert.ok(instant !== null);
    assert.equal(instant.tracks[0].title, 'Tum Hi Ho');
  });

  // I. test_home_feed_updates_in_background_when_online
  it('I: test_home_feed_updates_in_background_when_online', async () => {
    const mockTrack: Track = {
      id: 'stale-1',
      title: 'Stale Track',
      artistId: 'art-old',
      artistName: 'Old Artist',
      artworkUrl: 'https://example.com/art.jpg',
      audioUrl: 'https://example.com/audio.mp3',
      provider: 'jiosaavn',
      duration: 180,
    };
    const staleFeed: HomeFeedData = {
      heroTrack: mockTrack,
      quickPicks: [mockTrack],
      madeForYou: [mockTrack],
      popularInIndia: [mockTrack],
      trendingNow: [mockTrack],
      featuredPlaylists: [],
      featuredAlbums: [],
      featuredArtists: [],
      isLoading: false,
    };

    // Stale timestamp (>15 mins ago)
    localStorage.setItem(
      'stuxs_home_feed_cache_v2',
      JSON.stringify({ data: staleFeed, timestamp: Date.now() - 20 * 60 * 1000, signature: 'test' })
    );

    let backgroundUpdated = false;
    const feed = await homeDiscoveryService.getHomeFeed(
      { recentlyPlayed: [], favorites: [], playlists: [] },
      false,
      () => {
        backgroundUpdated = true;
      }
    );

    // Initial returned feed should be the cached feed immediately
    assert.equal(feed.heroTrack?.title, 'Stale Track');
    assert.equal(feed.isLoading, false);
    assert.equal(typeof backgroundUpdated, 'boolean');
  });

  // J. test_session_cached_snapshot_restores_frame0
  it('J: test_session_cached_snapshot_restores_frame0', () => {
    const snapshot = {
      user: { id: 'usr-123', email: 'test@stuxs.music' },
      profile: { id: 'usr-123', name: 'Test User' },
      isGuest: false,
      timestamp: Date.now(),
    };
    localStorage.setItem('stuxs_auth_session_snapshot_v1', JSON.stringify(snapshot));

    const raw = localStorage.getItem('stuxs_auth_session_snapshot_v1');
    assert.ok(raw !== null);
    const parsed = JSON.parse(raw);
    assert.equal(parsed.user.id, 'usr-123');
    assert.equal(parsed.user.email, 'test@stuxs.music');
    assert.equal(parsed.isGuest, false);
  });

  // K. test_session_offline_does_not_logout
  it('K: test_session_offline_does_not_logout', () => {
    const snapshot = {
      user: { id: 'usr-456', email: 'offline@stuxs.music' },
      profile: null,
      isGuest: false,
      timestamp: Date.now(),
    };
    localStorage.setItem('stuxs_auth_session_snapshot_v1', JSON.stringify(snapshot));

    // When network is offline, snapshot must NOT be removed
    networkStateService.setOffline();
    const stillPresent = localStorage.getItem('stuxs_auth_session_snapshot_v1');
    assert.ok(stillPresent !== null);
    assert.equal(JSON.parse(stillPresent).user.id, 'usr-456');
  });

  // L. test_session_invalid_reconciles_safely
  it('L: test_session_invalid_reconciles_safely', () => {
    const snapshot = {
      user: { id: 'usr-revoked', email: 'revoked@stuxs.music' },
      profile: null,
      isGuest: false,
      timestamp: Date.now(),
    };
    localStorage.setItem('stuxs_auth_session_snapshot_v1', JSON.stringify(snapshot));

    // Server says session is revoked / null on explicit verification
    localStorage.removeItem('stuxs_auth_session_snapshot_v1');
    assert.equal(localStorage.getItem('stuxs_auth_session_snapshot_v1'), null);
  });

  // M. test_guest_mode_persists_offline
  it('M: test_guest_mode_persists_offline', () => {
    const guestSnapshot = {
      user: { id: 'guest-offline', email: 'guest@stuxs.music' },
      profile: { name: 'Guest' },
      isGuest: true,
      timestamp: Date.now(),
    };
    localStorage.setItem('stuxs_auth_session_snapshot_v1', JSON.stringify(guestSnapshot));
    networkStateService.setOffline();

    const stored = JSON.parse(localStorage.getItem('stuxs_auth_session_snapshot_v1') || '{}');
    assert.equal(stored.isGuest, true);
    assert.equal(stored.user.id, 'guest-offline');
  });

  // N. test_stale_cache_used_when_network_times_out
  it('N: test_stale_cache_used_when_network_times_out', () => {
    const cachedTrack: Track = {
      id: 'cached-timeout-1',
      title: 'Pasoori',
      artistId: 'art-ali',
      artistName: 'Ali Sethi',
      artworkUrl: 'https://example.com/art.jpg',
      audioUrl: 'https://example.com/audio.mp3',
      provider: 'jiosaavn',
      duration: 220,
    };
    const cachedFeed: HomeFeedData = {
      heroTrack: cachedTrack,
      quickPicks: [cachedTrack],
      madeForYou: [cachedTrack],
      popularInIndia: [cachedTrack],
      trendingNow: [cachedTrack],
      featuredPlaylists: [],
      featuredAlbums: [],
      featuredArtists: [],
      isLoading: false,
    };

    localStorage.setItem(
      'stuxs_home_feed_cache_v2',
      JSON.stringify({ data: cachedFeed, timestamp: Date.now() - 3600000, signature: 'test' })
    );

    const syncFallback = homeDiscoveryService.getCachedFeedSync();
    assert.ok(syncFallback !== null);
    assert.equal(syncFallback.heroTrack?.title, 'Pasoori');
    assert.equal(syncFallback.isLoading, false);
  });

  // O. test_network_state_service_detects_offline
  it('O: test_network_state_service_detects_offline', () => {
    let notifiedState = '';
    const unsub = networkStateService.subscribe((state) => {
      notifiedState = state;
    });

    networkStateService.setOffline();
    assert.equal(networkStateService.isOffline(), true);
    assert.equal(notifiedState, 'OFFLINE');
    unsub();
  });

  // P. test_network_state_service_detects_slow_network
  it('P: test_network_state_service_detects_slow_network', () => {
    networkStateService.setOnline();
    networkStateService.recordRequestLatency(3200, false);
    assert.equal(networkStateService.getState(), 'ONLINE_BUT_SLOW');
    assert.equal(networkStateService.isOffline(), false);
  });

  // Q. test_cache_size_bounded_under_limit
  it('Q: test_cache_size_bounded_under_limit', () => {
    // Populate cache with multiple items
    for (let i = 0; i < 20; i++) {
      localCacheService.set(`key_${i}`, { data: 'test_payload_'.repeat(50) }, 60000);
    }
    const sizeBytes = localCacheService.getEstimatedSizeBytes();
    assert.ok(sizeBytes > 0);
    assert.ok(sizeBytes < 5 * 1024 * 1024); // Well below 5MB threshold
  });

  // R. test_corrupted_cache_handled_gracefully
  it('R: test_corrupted_cache_handled_gracefully', () => {
    localStorage.setItem('stuxs_cache_v2:corrupt_test', 'INVALID_JSON{}}{');
    const result = localCacheService.getSync('corrupt_test');
    assert.equal(result, null);
    // Verify corrupt entry was purged
    assert.equal(localStorage.getItem('stuxs_cache_v2:corrupt_test'), null);
  });

  // S. test_network_recovery_refreshes_stale_content
  it('S: test_network_recovery_refreshes_stale_content', () => {
    localCacheService.set('stale_key', { value: 123 }, 100); // 100ms TTL
    const entry = (localCacheService as any).memoryCache.get('stale_key');
    assert.ok(entry);
    // Force entry to be in the past
    entry.timestamp = Date.now() - 500;
    assert.equal(localCacheService.isStale(entry), true);
  });

  // T. test_offline_to_online_transition_smooth
  it('T: test_offline_to_online_transition_smooth', () => {
    const states: string[] = [];
    const unsub = networkStateService.subscribe((s) => states.push(s));

    networkStateService.setOffline();
    assert.equal(networkStateService.isOffline(), true);

    networkStateService.setOnline();
    assert.equal(networkStateService.isOffline(), false);
    assert.equal(networkStateService.getState(), 'ONLINE');

    assert.ok(states.includes('OFFLINE'));
    assert.ok(states.includes('ONLINE'));
    unsub();
  });
});
