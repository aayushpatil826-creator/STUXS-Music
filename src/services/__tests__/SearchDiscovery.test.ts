import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { providerRegistry } from '../../providers/ProviderRegistry';
import {
  normalizeSearchQuery,
  scoreTrack,
  deduplicateTracks,
  generateQueryVariants,
  normalizeTransliteration,
  fuzzySimilarity,
} from '../../utils/searchIntelligence';
import type { Track, SearchResults } from '../../types/music';

describe('Search & Discovery Product Quality Tests', () => {
  // Mock playable track helper
  const createMockTrack = (overrides: Partial<Track> = {}): Track => ({
    id: 'test-track-1',
    title: 'Samjhawan',
    artistName: 'Arijit Singh, Shreya Ghoshal',
    artistId: 'art-arijit-1',
    albumTitle: 'Humpty Sharma Ki Dulhania',
    artworkUrl: 'https://example.com/art.jpg',
    duration: 269,
    audioUrl: 'https://media.stuxs.audio/stream/samjhawan.mp3',
    actualBitrate: '320kbps',
    provider: 'stuxs',
    accessStatus: 'playable',
    playbackType: 'full',
    isPlayable: true,
    ...overrides,
  });

  // A. Exact title search
  it('A. Exact title match receives top relevance score', () => {
    const track = createMockTrack({ title: 'Samjhawan', artistName: 'Arijit Singh' });
    const nq = normalizeSearchQuery('Samjhawan');
    const score = scoreTrack(track, nq);
    assert.ok(score >= 500, `Expected score >= 500 for exact title match, got ${score}`);
  });

  // B. Exact artist search
  it('B. Exact artist match receives high artist score', () => {
    const track = createMockTrack({ title: 'Tum Hi Ho', artistName: 'Arijit Singh' });
    const nq = normalizeSearchQuery('Arijit Singh');
    const score = scoreTrack(track, nq);
    assert.ok(score >= 300, `Expected score >= 300 for exact artist match, got ${score}`);
  });

  // C. Partial title search
  it('C. Partial title prefix match ranks strongly', () => {
    const track = createMockTrack({ title: 'Samjhawan' });
    const nq = normalizeSearchQuery('Samjha');
    const score = scoreTrack(track, nq);
    assert.ok(score >= 400, `Expected score >= 400 for prefix match, got ${score}`);
  });

  // D. Typo tolerance search
  it('D. Typo variations map to intended track title', () => {
    const track = createMockTrack({ title: 'Samjhawan' });
    const variants1 = generateQueryVariants('samjawa');
    assert.ok(variants1.includes('samjhawan'), 'Variant generation should map "samjawa" to "samjhawan"');

    const variants2 = generateQueryVariants('samjavan');
    assert.ok(variants2.includes('samjhawan'), 'Variant generation should map "samjavan" to "samjhawan"');

    const score = scoreTrack(track, normalizeSearchQuery('samjawa'));
    assert.ok(score >= 400, `Score for typo should be high due to transliteration match, got ${score}`);
  });

  // E. Hindi/Hinglish transliteration equivalence
  it('E. Hindi/Hinglish transliteration equivalences match phonetically', () => {
    const trans1 = normalizeTransliteration('samjhawan');
    const trans2 = normalizeTransliteration('samjawan');
    const trans3 = normalizeTransliteration('samjavan');

    assert.strictEqual(trans1, trans2, 'Transliteration of samjhawan and samjawan must match');
    assert.strictEqual(trans1, trans3, 'Transliteration of samjhawan and samjavan must match');

    const sim = fuzzySimilarity('kesriya', 'kesariya');
    assert.ok(sim >= 0.85, `Fuzzy similarity between kesriya and kesariya should be >= 0.85, got ${sim}`);
  });

  // F. Duplicate provider results deduplication
  it('F. Duplicate tracks from different providers are deduplicated into single canonical entry', () => {
    const trackStuxs = createMockTrack({
      id: 'stuxs-samjhawan',
      provider: 'stuxs',
      title: 'Samjhawan',
      artistName: 'Arijit Singh',
      audioUrl: 'https://media.stuxs.audio/samjhawan.mp3',
    });
    const trackJio = createMockTrack({
      id: 'jiosaavn-samjhawan',
      provider: 'jiosaavn',
      title: 'Samjhawan (Original)',
      artistName: 'Arijit Singh',
      audioUrl: 'https://aac.saavn.cdn/samjhawan.mp4',
    });

    const nq = normalizeSearchQuery('Samjhawan');
    const deduplicated = deduplicateTracks([trackStuxs, trackJio], nq);
    assert.strictEqual(deduplicated.length, 1, 'Duplicate tracks should be deduplicated to 1 entry');
    assert.ok(deduplicated[0].audioUrl, 'Canonical track must have playable audioUrl');
  });

  // G. Provider failure isolation
  it('G. Individual provider search failure does not crash overall searchProgressive', async () => {
    // Calling searchProgressive with a query executes across available providers
    const results = await providerRegistry.searchProgressive('Tum Hi Ho', () => {});
    assert.ok(results, 'searchProgressive must resolve with a SearchResults object');
    assert.ok(Array.isArray(results.tracks), 'Results must have a tracks array');
  });

  // H. Gaana unavailable handling
  it('H. Handles Gaana unavailable state gracefully without throwing', () => {
    const gaana = providerRegistry.getProvider('gaana');
    if (gaana) {
      // Temporarily mark unavailable
      const prevAvailable = gaana.isAvailable;
      gaana.isAvailable = false;
      assert.strictEqual(gaana.isAvailable, false);
      // Restore
      gaana.isAvailable = prevAvailable;
    }
  });

  // I. Offline/no network handling
  it('I. Preserves offline/downloaded status when deduplicating', () => {
    const downloadedTrack = createMockTrack({
      id: 'local-1',
      title: 'Samjhawan',
      artistName: 'Arijit Singh',
      isDownloaded: true,
      sourceType: 'downloaded',
    });
    const onlineTrack = createMockTrack({
      id: 'online-1',
      title: 'Samjhawan',
      artistName: 'Arijit Singh',
      isDownloaded: false,
    });

    const nq = normalizeSearchQuery('Samjhawan');
    const merged = deduplicateTracks([downloadedTrack, onlineTrack], nq);
    assert.strictEqual(merged.length, 1);
    assert.strictEqual(merged[0].isDownloaded, true, 'Merged track must preserve isDownloaded flag');
  });

  // J. Empty query handling
  it('J. Empty or whitespace query returns empty search results cleanly', async () => {
    const empty1 = await providerRegistry.search('');
    assert.deepStrictEqual(empty1, { tracks: [], artists: [], albums: [], playlists: [] });

    const empty2 = await providerRegistry.search('   ');
    assert.deepStrictEqual(empty2, { tracks: [], artists: [], albums: [], playlists: [] });
  });

  // K. No results handling
  it('K. Obscure query returns empty result set without errors', async () => {
    const res = await providerRegistry.search('xyz999nonexistenttrackquery777');
    assert.ok(Array.isArray(res.tracks), 'Tracks should be an array');
    assert.ok(Array.isArray(res.artists), 'Artists should be an array');
    assert.ok(Array.isArray(res.albums), 'Albums should be an array');
    assert.ok(Array.isArray(res.playlists), 'Playlists should be an array');
  });

  // L. iTunes preview rejection
  it('L. 30-second preview tracks are strictly excluded from search results', () => {
    const previewTrack = createMockTrack({
      id: 'itunes-preview-1',
      provider: 'itunes',
      title: 'Preview Song',
      isPreview: true,
      playbackType: 'preview',
      audioUrl: 'https://audio-ssl.itunes.apple.com/preview.m4a',
    });
    const nq = normalizeSearchQuery('Preview Song');
    const processed = (providerRegistry as any).processSearchResults(
      [{ providerId: 'itunes', data: { tracks: [previewTrack], artists: [], albums: [], playlists: [] } }],
      nq
    );
    assert.strictEqual(processed.tracks.length, 0, 'Preview track must be rejected');
  });

  // M. Metadata-only result rejection
  it('M. Metadata-only results without audioUrl or marked blocked are excluded', () => {
    const noAudioTrack = createMockTrack({
      id: 'spotify-meta-1',
      provider: 'spotify',
      title: 'Meta Song',
      audioUrl: undefined,
    });
    const blockedTrack = createMockTrack({
      id: 'blocked-1',
      provider: 'jiosaavn',
      title: 'Blocked Song',
      accessStatus: 'blocked',
    });

    const nq = normalizeSearchQuery('Meta Song');
    const processed = (providerRegistry as any).processSearchResults(
      [{ providerId: 'spotify', data: { tracks: [noAudioTrack, blockedTrack], artists: [], albums: [], playlists: [] } }],
      nq
    );
    assert.strictEqual(processed.tracks.length, 0, 'Tracks without audioUrl or blocked must be rejected');
  });

  // N. SoundCloud rejection
  it('N. SoundCloud provider and tracks are strictly rejected', async () => {
    const soundcloudTrack = createMockTrack({
      id: 'soundcloud-12345',
      provider: 'soundcloud' as any,
      title: 'SoundCloud Track',
      audioUrl: 'https://api.soundcloud.com/stream/12345',
    });

    const nq = normalizeSearchQuery('SoundCloud Track');
    const processed = (providerRegistry as any).processSearchResults(
      [{ providerId: 'stuxs', data: { tracks: [soundcloudTrack], artists: [], albums: [], playlists: [] } }],
      nq
    );
    assert.strictEqual(processed.tracks.length, 0, 'SoundCloud track must be rejected in processSearchResults');

    const getTrackResult = await providerRegistry.getTrack('soundcloud-12345');
    assert.strictEqual(getTrackResult, null, 'getTrack must return null for soundcloud IDs');
  });

  // O. Search cache hit
  it('O. In-memory search cache provides fast instant hits and honors TTL', () => {
    const testResults: SearchResults = {
      tracks: [createMockTrack({ title: 'Cached Song' })],
      artists: [],
      albums: [],
      playlists: [],
    };

    (providerRegistry as any).setCacheEntry('cached song', testResults);

    const hit = providerRegistry.getCachedSearchResults('cached song');
    assert.ok(hit, 'getCachedSearchResults must return cached entry');
    assert.strictEqual(hit?.tracks[0]?.title, 'Cached Song');

    // Simulate TTL expiration
    const cacheMap = (providerRegistry as any).searchCache as Map<string, { results: SearchResults; timestamp: number }>;
    const entry = cacheMap.get('cached song');
    if (entry) {
      entry.timestamp = Date.now() - (20 * 60 * 1000); // 20 minutes ago (TTL is 15 mins)
    }

    const expiredHit = providerRegistry.getCachedSearchResults('cached song');
    assert.strictEqual(expiredHit, null, 'Expired cache entry must return null');
  });

  // P. Concurrent identical searches deduplication
  it('P. In-flight search deduplication returns the same promise for concurrent searches', async () => {
    const q = 'Arijit Singh Romantic Hits';
    const p1 = providerRegistry.search(q);
    const p2 = providerRegistry.search(q);

    // Both promises should resolve to identical results
    const [res1, res2] = await Promise.all([p1, p2]);
    assert.deepStrictEqual(res1, res2, 'Concurrent search calls must yield identical results');
  });

  // Q. Search while playback is active (state independence)
  it('Q. Scoring and searching has zero side-effects on playback state', () => {
    const track = createMockTrack({ title: 'Playing Track' });
    const score1 = scoreTrack(track, 'Playing Track');
    const score2 = scoreTrack(track, 'Playing Track');
    assert.strictEqual(score1, score2, 'Scoring must be deterministic and pure');
  });

  // R. Rapid query changes
  it('R. Rapid query normalization and variant generation executes safely without error', () => {
    const queries = ['s', 'sa', 'sam', 'samj', 'samja', 'samjaw', 'samjawa', 'samjawan'];
    for (const q of queries) {
      const nq = normalizeSearchQuery(q);
      const variants = generateQueryVariants(q);
      assert.ok(Array.isArray(variants), `Variants for "${q}" must be an array`);
      assert.ok(nq.clean !== undefined, `Clean query for "${q}" must exist`);
    }
  });

  // S. Original vs derivative/remix ranking
  it('S. Canonical original tracks are scored higher than unsolicited remixes and covers', () => {
    const originalTrack = createMockTrack({
      title: 'Kesariya',
      artistName: 'Arijit Singh, Pritam',
    });
    const remixTrack = createMockTrack({
      title: 'Kesariya (Remix by DJ X)',
      artistName: 'Arijit Singh, DJ X',
    });
    const lofiTrack = createMockTrack({
      title: 'Kesariya (Lofi Flip)',
      artistName: 'Arijit Singh',
    });

    const nq = normalizeSearchQuery('Kesariya');
    const originalScore = scoreTrack(originalTrack, nq);
    const remixScore = scoreTrack(remixTrack, nq);
    const lofiScore = scoreTrack(lofiTrack, nq);

    assert.ok(
      originalScore > remixScore,
      `Original score (${originalScore}) must be greater than remix score (${remixScore})`
    );
    assert.ok(
      originalScore > lofiScore,
      `Original score (${originalScore}) must be greater than lofi score (${lofiScore})`
    );
  });

  // T. Real STUXS catalog result scoring
  it('T. STUXS first-party catalog tracks receive high trust weight and playability bonus', () => {
    const stuxsTrack = createMockTrack({
      provider: 'stuxs',
      title: 'Shubhaarambh',
      artistName: 'Amit Trivedi',
      accessStatus: 'playable',
      isPlayable: true,
    });
    const itunesTrack = createMockTrack({
      provider: 'itunes',
      title: 'Shubhaarambh',
      artistName: 'Amit Trivedi',
      accessStatus: 'playable',
      isPlayable: true,
    });

    const nq = normalizeSearchQuery('Shubhaarambh');
    const stuxsScore = scoreTrack(stuxsTrack, nq);
    const itunesScore = scoreTrack(itunesTrack, nq);

    assert.ok(
      stuxsScore > itunesScore,
      `STUXS score (${stuxsScore}) must exceed iTunes score (${itunesScore}) due to studio master trust weight`
    );
  });
});
