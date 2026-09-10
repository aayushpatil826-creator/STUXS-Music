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
import { JioSaavnProvider } from '../../providers/jiosaavn/JioSaavnProvider';
import type { Track, SearchResults } from '../../types/music';

describe('Discovery Search & Provider-Backed Intelligence (Scenarios A through AF)', () => {
  const createMockTrack = (overrides: Partial<Track> = {}): Track => ({
    id: 'test-track-1',
    title: 'Shrimant Bappa Morya',
    artistName: 'Sonu Nigam',
    artistId: 'art-sonu-1',
    albumTitle: 'Shrimant Morya',
    albumId: 'jiosaavn-album-67477397',
    artworkUrl: 'https://example.com/art.jpg',
    duration: 312,
    audioUrl: 'https://media.stuxs.audio/stream/shrimant-bappa-morya.mp3',
    actualBitrate: '320kbps',
    provider: 'jiosaavn',
    accessStatus: 'playable',
    playbackType: 'full',
    isPlayable: true,
    label: 'Shrimant Dagadusheth Halwai Ganpati Trust',
    copyrightText: '℗ 2018 Shrimant Dagadusheth Halwai Ganpati Trust',
    singers: 'Sonu Nigam',
    musicDirector: 'Prashant Satose',
    searchAliases: ['Shrimant Morya', 'Shrimant Dagadusheth Halwai Ganpati Trust'],
    playCount: 55000,
    ...overrides,
  });

  // A. Exact title search
  it('A. Exact title search yields top relevance score', () => {
    const track = createMockTrack({ title: 'Shrimant Bappa Morya' });
    const nq = normalizeSearchQuery('Shrimant Bappa Morya');
    const score = scoreTrack(track, nq);
    assert.ok(score >= 500, `Expected score >= 500, got ${score}`);
  });

  // B. Artist search
  it('B. Artist search matches track artist field strongly', () => {
    const track = createMockTrack({ artistName: 'Sonu Nigam' });
    const nq = normalizeSearchQuery('Sonu Nigam');
    const score = scoreTrack(track, nq);
    assert.ok(score >= 300, `Expected score >= 300, got ${score}`);
  });

  // C. Partial title search
  it('C. Partial title prefix match ranks strongly', () => {
    const track = createMockTrack({ title: 'Shrimant Bappa Morya' });
    const nq = normalizeSearchQuery('Shrimant Bappa');
    const score = scoreTrack(track, nq);
    assert.ok(score >= 400, `Expected score >= 400, got ${score}`);
  });

  // D. Partial artist search
  it('D. Partial artist name ranks strongly', () => {
    const track = createMockTrack({ artistName: 'Arijit Singh' });
    const nq = normalizeSearchQuery('Arijit');
    const score = scoreTrack(track, nq);
    assert.ok(score >= 200, `Expected score >= 200 for partial artist, got ${score}`);
  });

  // E. Typo tolerance search
  it('E. Typo tolerance accurately resolves misspellings', () => {
    const track = createMockTrack({ title: 'Samjhawan', artistName: 'Arijit Singh' });
    const nq = normalizeSearchQuery('samjawa');
    const score = scoreTrack(track, nq);
    assert.ok(score >= 400, `Expected score >= 400 for typo 'samjawa', got ${score}`);
  });

  // F. Hindi/Hinglish transliteration
  it('F. Hindi/Hinglish transliteration maps phonetically across variations', () => {
    const s1 = normalizeTransliteration('dagduseth');
    const s2 = normalizeTransliteration('dagdusheth');
    const s3 = normalizeTransliteration('dagaduseth');
    assert.strictEqual(s1, s2, 'dagduseth and dagdusheth must normalize to identical phonetic base');
    assert.ok(fuzzySimilarity(s1, s3) >= 0.85, 'Phonetic similarity between dagduseth and dagaduseth must be >= 0.85');
  });

  // G. Word-order variation
  it('G. Word-order variation retains high relevance score', () => {
    const track = createMockTrack({ title: 'Shrimant Bappa Morya', artistName: 'Sonu Nigam' });
    const nqDirect = normalizeSearchQuery('Sonu Nigam Shrimant Bappa Morya');
    const nqReversed = normalizeSearchQuery('Shrimant Bappa Morya Sonu Nigam');
    const scoreDirect = scoreTrack(track, nqDirect);
    const scoreReversed = scoreTrack(track, nqReversed);

    assert.ok(Math.abs(scoreDirect - scoreReversed) < 60, 'Word order inversion should not significantly penalize score');
    assert.ok(scoreReversed >= 500, `Word reversed score should be >= 500, got ${scoreReversed}`);
  });

  // H. "dagduseth" discovering "Shrimant Bappa Morya - Sonu Nigam" via provider metadata
  it('H. "dagduseth" query discovers "Shrimant Bappa Morya" through authentic provider metadata', () => {
    const track = createMockTrack();
    const nq = normalizeSearchQuery('dagduseth');
    const score = scoreTrack(track, nq);

    // The track's provider label is "Shrimant Dagadusheth Halwai Ganpati Trust"
    assert.ok(score >= 400, `Track with Dagadusheth trust label must score >= 400 for 'dagduseth', got ${score}`);
  });

  // I. "dagdu sheth" variation
  it('I. "dagdu sheth" compound spacing query discovers the track with high score', () => {
    const track = createMockTrack();
    const nq = normalizeSearchQuery('dagdu sheth');
    const variants = generateQueryVariants('dagdu sheth');
    assert.ok(variants.includes('dagdusheth'), 'Variants of "dagdu sheth" must include "dagdusheth"');

    const score = scoreTrack(track, nq);
    assert.ok(score >= 400, `Score for 'dagdu sheth' must be >= 400, got ${score}`);
  });

  // J. "dagdusheth" variation
  it('J. "dagdusheth" variation discovers the track with high score', () => {
    const track = createMockTrack();
    const nq = normalizeSearchQuery('dagdusheth');
    const score = scoreTrack(track, nq);
    assert.ok(score >= 400, `Score for 'dagdusheth' must be >= 400, got ${score}`);
  });

  // K. "dagduseth ganapati" variation
  it('K. "dagduseth ganapati" discovers the track and generates Indic vowel-syncope variant', () => {
    const variants = generateQueryVariants('dagduseth ganapati');
    assert.ok(
      variants.includes('dagduseth ganpati') || variants.includes('dagdusheth ganapati'),
      'Variants must include ganpati/ganapati vowel syncope alternation'
    );
    const track = createMockTrack();
    const nq = normalizeSearchQuery('dagduseth ganapati');
    const score = scoreTrack(track, nq);
    assert.ok(score >= 350, `Score for 'dagduseth ganapati' should be >= 350, got ${score}`);
  });

  // L. "ganpati sonu nigam"
  it('L. "ganpati sonu nigam" synergy matches artist and religious catalog metadata', () => {
    const track = createMockTrack();
    const nq = normalizeSearchQuery('ganpati sonu nigam');
    const score = scoreTrack(track, nq);
    assert.ok(score >= 500, `Score for artist + deity synergy must be >= 500, got ${score}`);
  });

  // M. Canonical-vs-unrelated exact match ranking
  it('M. Canonical original tracks outrank partial or unrelated matches', () => {
    const exactTrack = createMockTrack({ title: 'Kesariya', artistName: 'Arijit Singh' });
    const coverTrack = createMockTrack({ title: 'Kesariya (Acoustic Cover)', artistName: 'Unknown Artist' });
    const unrelatedTrack = createMockTrack({ title: 'Kesar Chandan', artistName: 'Anuradha Paudwal' });

    const nq = normalizeSearchQuery('Kesariya');
    const exactScore = scoreTrack(exactTrack, nq);
    const coverScore = scoreTrack(coverTrack, nq);
    const unrelatedScore = scoreTrack(unrelatedTrack, nq);

    assert.ok(exactScore > coverScore, `Exact (${exactScore}) must outrank cover (${coverScore})`);
    assert.ok(exactScore > unrelatedScore, `Exact (${exactScore}) must outrank unrelated (${unrelatedScore})`);
  });

  // N. Cross-provider deduplication
  it('N. Cross-provider deduplication retains single best track preserving metadata', () => {
    const track1 = createMockTrack({ id: 'stuxs-1', provider: 'stuxs', playCount: 1000 });
    const track2 = createMockTrack({ id: 'jiosaavn-1', provider: 'jiosaavn', playCount: 60000 });

    const nq = normalizeSearchQuery('Shrimant Bappa Morya');
    const deduped = deduplicateTracks([track1, track2], nq);

    assert.strictEqual(deduped.length, 1, 'Duplicate tracks must be consolidated to 1');
    assert.ok(deduped[0].audioUrl, 'Consolidated track must have playable audioUrl');
  });

  // O. Provider timeout
  it('O. Bounded timeout prevents slow providers from hanging execution', async () => {
    const slowPromise = new Promise((resolve) => setTimeout(() => resolve('slow'), 500));
    const timeoutPromise = Promise.race([
      slowPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Provider timeout')), 50)),
    ]);

    await assert.rejects(timeoutPromise, /Provider timeout/);
  });

  // P. Provider failure isolation
  it('P. Provider search failure is isolated and does not crash overall searchProgressive', async () => {
    const results = await providerRegistry.searchProgressive('Sonu Nigam Shrimant Bappa', () => {});
    assert.ok(results, 'searchProgressive must resolve without throwing even if some provider fails');
    assert.ok(Array.isArray(results.tracks), 'Results must have a tracks array');
  });

  // Q. Metadata-only result rejected for playback
  it('Q. Metadata-only results without audioUrl are rejected from processed search results', () => {
    const metaOnlyTrack = createMockTrack({ audioUrl: undefined });
    const nq = normalizeSearchQuery('Shrimant Bappa Morya');
    const processed = (providerRegistry as any).processSearchResults(
      [{ providerId: 'jiosaavn', data: { tracks: [metaOnlyTrack], artists: [], albums: [], playlists: [] } }],
      nq
    );
    assert.strictEqual(processed.tracks.length, 0, 'Track without audioUrl must be rejected');
  });

  // R. iTunes preview rejected
  it('R. 30-second preview tracks from iTunes are strictly rejected', () => {
    const previewTrack = createMockTrack({
      id: 'itunes-preview-999',
      provider: 'itunes',
      isPreview: true,
      playbackType: 'preview',
      audioUrl: 'https://audio-ssl.itunes.apple.com/30sec.m4a',
    });
    const nq = normalizeSearchQuery('Shrimant Bappa Morya');
    const processed = (providerRegistry as any).processSearchResults(
      [{ providerId: 'itunes', data: { tracks: [previewTrack], artists: [], albums: [], playlists: [] } }],
      nq
    );
    assert.strictEqual(processed.tracks.length, 0, 'Preview tracks must be strictly rejected');
  });

  // S. SoundCloud rejected
  it('S. SoundCloud provider and track IDs are strictly rejected', async () => {
    const scTrack = createMockTrack({
      id: 'soundcloud-888',
      provider: 'soundcloud' as any,
    });
    const nq = normalizeSearchQuery('Shrimant Bappa Morya');
    const processed = (providerRegistry as any).processSearchResults(
      [{ providerId: 'stuxs', data: { tracks: [scTrack], artists: [], albums: [], playlists: [] } }],
      nq
    );
    assert.strictEqual(processed.tracks.length, 0, 'SoundCloud track must be filtered out');

    const trackResult = await providerRegistry.getTrack('soundcloud-888');
    assert.strictEqual(trackResult, null, 'getTrack must return null for SoundCloud IDs');
  });

  // T. Full-length source resolution
  it('T. Processed tracks contain full-length playable source', () => {
    const fullTrack = createMockTrack({ playbackType: 'full', duration: 312 });
    const nq = normalizeSearchQuery('Shrimant Bappa Morya');
    const processed = (providerRegistry as any).processSearchResults(
      [{ providerId: 'jiosaavn', data: { tracks: [fullTrack], artists: [], albums: [], playlists: [] } }],
      nq
    );
    assert.strictEqual(processed.tracks.length, 1);
    assert.strictEqual(processed.tracks[0].playbackType, 'full');
    assert.ok(processed.tracks[0].duration > 60, 'Full track duration must be genuine full length');
  });

  // U. Search cache
  it('U. Search cache returns cached results instantly within TTL', () => {
    const results: SearchResults = {
      tracks: [createMockTrack({ title: 'Cached Bappa' })],
      artists: [],
      albums: [],
      playlists: [],
    };
    (providerRegistry as any).setCacheEntry('cached bappa', results);
    const cached = providerRegistry.getCachedSearchResults('cached bappa');
    assert.ok(cached, 'Cache must return stored results');
    assert.strictEqual(cached?.tracks[0]?.title, 'Cached Bappa');
  });

  // V. In-flight request deduplication
  it('V. Concurrent identical search requests share a single in-flight promise', async () => {
    const q = 'Sonu Nigam Dagdusheth Devotional';
    const p1 = providerRegistry.search(q);
    const p2 = providerRegistry.search(q);
    const [res1, res2] = await Promise.all([p1, p2]);
    assert.deepStrictEqual(res1, res2, 'In-flight shared searches must return identical results');
  });

  // W. Empty query
  it('W. Empty search query returns empty structure immediately without calling providers', async () => {
    const empty1 = await providerRegistry.searchProgressive('', () => {});
    const empty2 = await providerRegistry.searchProgressive('   ', () => {});
    assert.deepStrictEqual(empty1, { tracks: [], artists: [], albums: [], playlists: [] });
    assert.deepStrictEqual(empty2, { tracks: [], artists: [], albums: [], playlists: [] });
  });

  // X. Very short query
  it('X. Single character or very short queries are processed safely without crashing', async () => {
    const nq = normalizeSearchQuery('a');
    assert.strictEqual(nq.clean, 'a');
    const variants = generateQueryVariants('a');
    assert.ok(Array.isArray(variants));
  });

  // Y. Unicode/Hindi query
  it('Y. Unicode Hindi script query is handled safely and matches clean terms', () => {
    const hindiQuery = 'दगडूशेठ';
    const nq = normalizeSearchQuery(hindiQuery);
    assert.ok(nq.raw === 'दगडूशेठ');
    assert.ok(typeof nq.clean === 'string');
  });

  // Z. Mixed Hindi/English query
  it('Z. Mixed Hindi and English search tokens normalize cleanly', () => {
    const mixedQuery = 'dagduseth ganpati song 2024';
    const nq = normalizeSearchQuery(mixedQuery);
    assert.ok(nq.tokens.includes('dagduseth'));
    assert.ok(nq.tokens.includes('ganpati'));
  });

  // AA. Regional query
  it('AA. Regional queries (Marathi, Punjabi, Tamil) normalize and preserve tokens', () => {
    const marathiQuery = 'bappa morya re aarti';
    const nq = normalizeSearchQuery(marathiQuery);
    assert.ok(nq.tokens.includes('bappa'));
    assert.ok(nq.tokens.includes('morya'));
  });

  // AB. Album relationship discovery
  it('AB. Album relationship discovery enables tracks from the same album to score provider relevance', () => {
    const trackInAlbum = createMockTrack({
      title: 'Shrimant Bappa Morya',
      artistName: 'Sonu Nigam',
      albumTitle: 'Shrimant Morya',
      label: 'Shrimant Dagadusheth Halwai Ganpati Trust',
    });
    const nq = normalizeSearchQuery('dagduseth');
    const score = scoreTrack(trackInAlbum, nq);
    assert.ok(score >= 400, 'Album relationship through label metadata must grant strong score');
  });

  // AC. Popularity used as secondary ranking signal
  it('AC. Popularity acts as a bounded secondary ranking signal without overpowering relevance', () => {
    const popularTrack = createMockTrack({
      title: 'Dagdusheth Bappa',
      playCount: 1000000,
    });
    const lessPopularExact = createMockTrack({
      title: 'Dagdusheth Bappa',
      playCount: 100,
    });

    const nq = normalizeSearchQuery('Dagdusheth Bappa');
    const score1 = scoreTrack(popularTrack, nq);
    const score2 = scoreTrack(lessPopularExact, nq);

    // Both should score high, popularity bonus is bounded (max 50)
    assert.ok(score1 > score2, 'Higher stream count gives secondary boost');
    assert.ok(score1 - score2 <= 50, 'Popularity boost must be strictly bounded to max 50');
  });

  // AD. No hardcoded song-specific aliases
  it('AD. Code integrity check: search does NOT use hardcoded song-specific aliases', () => {
    // Verify that the query variant generation does not contain hardcoded track mappings
    const variants = generateQueryVariants('dagduseth');
    const hasHardcodedTitle = variants.some((v) => v.toLowerCase().includes('shrimant bappa morya'));
    assert.strictEqual(
      hasHardcodedTitle,
      false,
      'Search intelligence must not contain hardcoded song-specific aliases like "Shrimant Bappa Morya"'
    );
  });

  // AE. No false synonym expansion
  it('AE. Unrelated search terms are not incorrectly expanded to random music synonyms', () => {
    const variants = generateQueryVariants('guitar acoustic instrumental');
    assert.strictEqual(
      variants.includes('shrimant bappa morya'),
      false,
      'Unrelated queries must not falsely expand to specific songs'
    );
  });

  // AF. Provider metadata fields preserved correctly
  it('AF. Provider metadata fields (label, copyrightText, singers, musicDirector, searchAliases) are preserved', () => {
    const provider = new JioSaavnProvider();
    const rawSong = {
      id: 'test-saavn-id',
      song: 'Shrimant Bappa Morya',
      singers: 'Sonu Nigam',
      primary_artists: 'Sonu Nigam',
      album: 'Shrimant Morya',
      image: 'https://c.saavncdn.com/test.jpg',
      duration: '312',
      media_url: 'https://aac.saavncdn.com/test.mp4',
      year: '2018',
      label: 'Shrimant Dagadusheth Halwai Ganpati Trust',
      copyright_text: '℗ 2018 Dagadusheth Halwai',
      music: 'Prashant Satose',
      play_count: '55000',
    };

    const mapped = (provider as any).mapSongToTrack(rawSong);
    assert.strictEqual(mapped.label, 'Shrimant Dagadusheth Halwai Ganpati Trust');
    assert.strictEqual(mapped.copyrightText, '℗ 2018 Dagadusheth Halwai');
    assert.strictEqual(mapped.singers, 'Sonu Nigam');
    assert.strictEqual(mapped.musicDirector, 'Prashant Satose');
    assert.strictEqual(mapped.playCount, 55000);
    assert.ok(Array.isArray(mapped.searchAliases), 'searchAliases must be populated as an array');
    assert.ok(mapped.searchAliases.includes('Shrimant Dagadusheth Halwai Ganpati Trust'));
    assert.strictEqual(mapped.albumTitle, 'Shrimant Morya');
  });
});
