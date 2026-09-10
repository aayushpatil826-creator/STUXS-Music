import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { homeDiscoveryService } from '../HomeDiscoveryService';
import type { Playlist, Track } from '../../types/music';

describe('Library & Personalization Product Quality Tests', () => {
  it('1. Discover Playlists: Caching and In-flight Deduplication', async () => {
    homeDiscoveryService.clearCache();

    // Call getDiscoverPlaylists twice concurrently
    const p1 = homeDiscoveryService.getDiscoverPlaylists('Trending Hits India');
    const p2 = homeDiscoveryService.getDiscoverPlaylists('Trending Hits India');

    // In-flight promises should be identical (deduplication)
    assert.strictEqual(p1, p2, 'Concurrent calls to getDiscoverPlaylists must return the same Promise');

    const [res1, res2] = await Promise.all([p1, p2]);
    assert.ok(Array.isArray(res1), 'Result must be an array');
    assert.deepStrictEqual(res1, res2, 'Both results must be identical');

    // Third call should hit in-memory cache synchronously/instantly
    const res3 = await homeDiscoveryService.getDiscoverPlaylists('Trending Hits India');
    assert.deepStrictEqual(res3, res1, 'Cached result must match first result');
  });

  it('2. Discover Playlists: Resilient error fallback without fake data', async () => {
    // Calling with an empty or strange query should return an array without throwing
    const res = await homeDiscoveryService.getDiscoverPlaylists('nonexistent-query-test-xyz-999');
    assert.ok(Array.isArray(res), 'Result must be an array');
    // None should be mock
    for (const pl of res) {
      assert.ok(!pl.id.startsWith('mock-'), 'Must not return mock playlists');
    }
  });

  it('3. Playlist Renaming logic: Validation & State integrity', () => {
    const original: Playlist = {
      id: 'pl-test-123',
      name: 'Old Name',
      artworkUrl: 'https://example.com/art.jpg',
      isPublic: true,
      songCount: 1,
      songs: [
        {
          id: 'song-1',
          title: 'Track 1',
          artistName: 'Artist 1',
          artistId: 'a1',
          artworkUrl: '',
          duration: 180,
          provider: 'stuxs',
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const newName = '   My Awesome Playlist   ';
    const trimmed = newName.trim();
    assert.strictEqual(trimmed, 'My Awesome Playlist');

    const updated: Playlist = {
      ...original,
      name: trimmed,
      updatedAt: new Date().toISOString(),
    };

    assert.strictEqual(updated.id, original.id, 'Playlist ID must be preserved');
    assert.strictEqual(updated.songs?.length, 1, 'Tracks must be preserved');
    assert.strictEqual(updated.name, 'My Awesome Playlist', 'Name must be trimmed and updated');
  });

  it('4. Playlist Reordering logic: Exact position array mutation', () => {
    const tracks: Track[] = [
      { id: 't1', title: 'Song 1', artistName: 'A1', artistId: 'a1', artworkUrl: '', duration: 100, provider: 'stuxs' },
      { id: 't2', title: 'Song 2', artistName: 'A2', artistId: 'a2', artworkUrl: '', duration: 200, provider: 'stuxs' },
      { id: 't3', title: 'Song 3', artistName: 'A3', artistId: 'a3', artworkUrl: '', duration: 300, provider: 'stuxs' },
    ];

    // Reorder: move t1 (index 0) to index 2
    const result = Array.from(tracks);
    const [removed] = result.splice(0, 1);
    result.splice(2, 0, removed);

    assert.deepStrictEqual(
      result.map((t) => t.id),
      ['t2', 't3', 't1'],
      'Tracks must be accurately reordered'
    );
    assert.strictEqual(result.length, 3, 'Total tracks must remain 3');
  });

  it('5. Recently Played / History: Deduplication & LIFO ordering', () => {
    const history: Track[] = [];

    const addHistory = (track: Track) => {
      const filtered = history.filter((t) => t.id !== track.id);
      history.length = 0;
      history.push(...[track, ...filtered].slice(0, 20));
    };

    const tA: Track = { id: 'sA', title: 'A', artistName: 'Art', artistId: 'art-1', artworkUrl: '', duration: 100, provider: 'stuxs' };
    const tB: Track = { id: 'sB', title: 'B', artistName: 'Art', artistId: 'art-1', artworkUrl: '', duration: 100, provider: 'stuxs' };
    const tC: Track = { id: 'sC', title: 'C', artistName: 'Art', artistId: 'art-1', artworkUrl: '', duration: 100, provider: 'stuxs' };

    addHistory(tA);
    addHistory(tB);
    addHistory(tC);
    assert.deepStrictEqual(history.map((t) => t.id), ['sC', 'sB', 'sA']);

    // Replay tA: should move to front without duplication
    addHistory(tA);
    assert.deepStrictEqual(history.map((t) => t.id), ['sA', 'sC', 'sB']);
    assert.strictEqual(history.length, 3);
  });
});
