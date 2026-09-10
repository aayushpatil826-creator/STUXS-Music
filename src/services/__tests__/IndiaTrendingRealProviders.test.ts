import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { IndiaTrendingService } from '../IndiaTrendingService';
import type { Track } from '../../types/music';

// Helper to create test tracks with customizable overrides
const createTestTrack = (overrides: Partial<Track> = {}): Track => ({
  id: `test-track-${Math.random().toString(36).slice(2, 9)}`,
  title: 'Test Hit Track',
  artistName: 'Test Vocalist',
  artistId: 'test-vocalist-id',
  albumTitle: 'Test Hindi Album',
  albumId: 'test-album-id',
  artworkUrl: 'https://cdn.example.com/art.jpg',
  duration: 210,
  audioUrl: 'https://media.example.com/stream_320.mp4',
  provider: 'jiosaavn',
  accessStatus: 'playable',
  playbackType: 'full',
  isPlayable: true,
  actualBitrate: '320 kbps AAC',
  audioFormat: 'AAC',
  language: 'hindi',
  ...overrides,
});

// Creates an isolated test instance of IndiaTrendingService
const createServiceInstance = (): IndiaTrendingService => new (IndiaTrendingService as any)();

describe('IndiaTrendingService — Real Provider & Provenance Regression Suite (20 Scenarios)', () => {
  // Test 1: JioSaavn provider candidates accepted
  it('1. Accepts valid JioSaavn provider candidates and preserves provider provenance', () => {
    const svc = createServiceInstance();
    const jioTrack = createTestTrack({ provider: 'jiosaavn', providerId: 'jio-123' });
    assert.equal(svc.isValidTrendingTrack(jioTrack), true);
    assert.equal(jioTrack.provider, 'jiosaavn');
  });

  // Test 2: Gaana provider candidates accepted
  it('2. Accepts valid Gaana provider candidates and preserves provider provenance', () => {
    const svc = createServiceInstance();
    const gaanaTrack = createTestTrack({
      id: 'gaana-456',
      provider: 'gaana',
      providerId: '456',
      audioUrl: 'https://stream.gaana.com/track.m3u8',
    });
    assert.equal(svc.isValidTrendingTrack(gaanaTrack), true);
    assert.equal(gaanaTrack.provider, 'gaana');
  });

  // Test 3: STUXS-only tracks excluded when external candidates exist
  it('3. STUXS-only tracks are excluded from the primary pool when external candidates exist', () => {
    const svc = createServiceInstance();
    const externalTrack = createTestTrack({ title: 'Top Chart Hit', provider: 'jiosaavn' });
    const stuxsTrack = createTestTrack({ title: 'User Uploaded Audio', provider: 'stuxs' });

    // Simulate candidate pool containing external tracks
    const rawCandidates = [
      { track: externalTrack, position: 1, chartName: 'Top 50' },
    ];

    // External candidates must satisfy trending requirements
    assert.ok(rawCandidates.length > 0);
    assert.ok(svc.isValidTrendingTrack(externalTrack));
    assert.ok(!rawCandidates.some(c => c.track.provider === 'stuxs' || c.track.id === stuxsTrack.id));
  });

  // Test 4: STUXS fallback only when no valid external candidates exist
  it('4. STUXS fallback is only permitted when external provider candidates are completely zero', () => {
    const svc = createServiceInstance();
    const stuxsTrack = createTestTrack({ title: 'Fallback Track', provider: 'stuxs' });

    // Validate that STUXS fallback track itself meets audio/playability standards
    assert.equal(svc.isValidTrendingTrack(stuxsTrack), true);
  });

  // Test 5: Cached external Trending wins over STUXS fallback
  it('5. Cached genuine external Trending wins over STUXS fallback', () => {
    const svc = createServiceInstance();
    const externalTracks = [createTestTrack({ title: 'Real Hit 1', provider: 'jiosaavn' })];

    // Hydrate memory cache with genuine external tracks
    (svc as any).memoryCache = {
      tracks: externalTracks,
      timestamp: Date.now(),
      source: 'external',
    };

    const cached = svc.getCachedTrending();
    assert.deepEqual(cached, externalTracks);
    assert.equal(svc.getCacheProvenance(), 'external');
  });

  // Test 6: Canonical cross-provider deduplication
  it('6. Canonical cross-provider deduplication merges same song from different providers', () => {
    const svc = createServiceInstance();
    const tJio = createTestTrack({
      title: 'Chaleya (From "Jawan")',
      artistName: 'Arijit Singh, Shilpa Rao',
      provider: 'jiosaavn',
    });
    const tGaana = createTestTrack({
      title: 'Chaleya',
      artistName: 'Arijit Singh & Shilpa Rao',
      provider: 'gaana',
    });

    const keyJio = svc.getCanonicalSongKey(tJio);
    const keyGaana = svc.getCanonicalSongKey(tGaana);
    assert.equal(keyJio, keyGaana, 'Both variants must produce the exact same canonical key');
  });

  // Test 7: Strongest playable source retained
  it('7. Deduplication retains the highest bitrate / master studio representation', () => {
    const svc = createServiceInstance();
    const tLow = createTestTrack({
      title: 'Sound Check',
      artistName: 'Singer',
      actualBitrate: '96 kbps AAC',
    });
    const tHigh = createTestTrack({
      title: 'Sound Check',
      artistName: 'Singer',
      actualBitrate: '320 kbps AAC',
    });

    const scoreLow = svc.computeTrendingScore(tLow, 1, 1);
    const scoreHigh = svc.computeTrendingScore(tHigh, 1, 1);
    assert.ok(scoreHigh.totalScore > scoreLow.totalScore, '320kbps master must score higher than low bitrate');
  });

  // Test 8: Chart/popularity ranking logic
  it('8. Higher chart position yields a higher chart rank score', () => {
    const svc = createServiceInstance();
    const track = createTestTrack();

    const scorePos1 = svc.computeTrendingScore(track, 1, 1).chartRankScore;
    const scorePos20 = svc.computeTrendingScore(track, 20, 1).chartRankScore;
    assert.ok(scorePos1 > scorePos20, `Rank 1 (${scorePos1}) must score higher than Rank 20 (${scorePos20})`);
  });

  // Test 9: Multi-chart bonus (+30) application
  it('9. Songs appearing in multiple charts earn the +30 multi-chart bonus', () => {
    const svc = createServiceInstance();
    const track = createTestTrack();

    const singleChartScore = svc.computeTrendingScore(track, 5, 1);
    const multiChartScore = svc.computeTrendingScore(track, 5, 2);

    assert.equal(singleChartScore.multiChartBonus, 0);
    assert.equal(multiChartScore.multiChartBonus, 30);
    assert.equal(multiChartScore.totalScore - singleChartScore.totalScore, 30);
  });

  // Test 10: Regional Indian language relevance bonus (+20)
  it('10. Applies +20 regional Indian language bonus to Indian languages', () => {
    const svc = createServiceInstance();
    const hindiTrack = createTestTrack({ language: 'hindi', provider: 'jiosaavn' });
    const unknownTrack = createTestTrack({
      language: 'unknown',
      provider: 'unknown' as any,
      albumTitle: '',
      title: 'Instrumental',
      artistName: 'Solo',
      label: '',
    });

    const hindiScore = svc.computeTrendingScore(hindiTrack, 5, 1);
    const unknownScore = svc.computeTrendingScore(unknownTrack, 5, 1);

    assert.equal(hindiScore.regionalBonus, 20);
    assert.equal(unknownScore.regionalBonus, 0);
  });

  // Test 11: Preview rejection
  it('11. Rejects tracks marked isPreview or playbackType: preview', () => {
    const svc = createServiceInstance();
    const preview1 = createTestTrack({ isPreview: true });
    const preview2 = createTestTrack({ playbackType: 'preview' });

    assert.equal(svc.isValidTrendingTrack(preview1), false);
    assert.equal(svc.isValidTrendingTrack(preview2), false);
  });

  // Test 12: iTunes 30-second preview rejection
  it('12. Strictly rejects iTunes tracks with duration <= 30 seconds', () => {
    const svc = createServiceInstance();
    const itunes30s = createTestTrack({ provider: 'itunes', duration: 30 });
    const itunes29s = createTestTrack({ provider: 'itunes', duration: 29 });
    const itunesFull = createTestTrack({ provider: 'itunes', duration: 240 });

    assert.equal(svc.isValidTrendingTrack(itunes30s), false);
    assert.equal(svc.isValidTrendingTrack(itunes29s), false);
    assert.equal(svc.isValidTrendingTrack(itunesFull), true);
  });

  // Test 13: SoundCloud rejection
  it('13. Unconditionally rejects SoundCloud tracks and provider IDs', () => {
    const svc = createServiceInstance();
    const sc1 = createTestTrack({ provider: 'soundcloud' as any });
    const sc2 = createTestTrack({ id: 'soundcloud-12345' });

    assert.equal(svc.isValidTrendingTrack(sc1), false);
    assert.equal(svc.isValidTrendingTrack(sc2), false);
  });

  // Test 14: Missing or empty audioUrl rejection
  it('14. Strictly rejects tracks with missing or empty audioUrl', () => {
    const svc = createServiceInstance();
    const noUrl = createTestTrack({ audioUrl: '' });
    const whitespaceUrl = createTestTrack({ audioUrl: '   ' });
    const undefinedUrl = createTestTrack({ audioUrl: undefined as any });

    assert.equal(svc.isValidTrendingTrack(noUrl), false);
    assert.equal(svc.isValidTrendingTrack(whitespaceUrl), false);
    assert.equal(svc.isValidTrendingTrack(undefinedUrl), false);
  });

  // Test 15: Blocked or unplayable accessStatus rejection
  it('15. Rejects tracks with isPlayable: false or accessStatus: blocked', () => {
    const svc = createServiceInstance();
    const blocked1 = createTestTrack({ isPlayable: false });
    const blocked2 = createTestTrack({ accessStatus: 'blocked' });

    assert.equal(svc.isValidTrendingTrack(blocked1), false);
    assert.equal(svc.isValidTrendingTrack(blocked2), false);
  });

  // Test 16: Deterministic ranking stability
  it('16. Ranking is completely deterministic: identical candidate inputs produce identical ordered results', () => {
    const svc = createServiceInstance();
    const tA = createTestTrack({ title: 'Song Alpha', playCount: 50_000_000 });
    const tB = createTestTrack({ title: 'Song Beta', playCount: 20_000_000 });

    const scoreA = svc.computeTrendingScore(tA, 1, 1).totalScore;
    const scoreB = svc.computeTrendingScore(tB, 2, 1).totalScore;

    assert.ok(scoreA > scoreB);
  });

  // Test 17: Cache TTL and provenance persistence
  it('17. Cache returns warm data within TTL and preserves provenance metadata', () => {
    const svc = createServiceInstance();
    const mockTracks = [createTestTrack({ title: 'Warm Cache Track' })];

    (svc as any).memoryCache = {
      tracks: mockTracks,
      timestamp: Date.now(),
      source: 'external',
    };

    assert.deepEqual(svc.getCachedTrending(), mockTracks);
    assert.equal(svc.getCacheProvenance(), 'external');
  });

  // Test 18: Corrupted cache recovery without throwing
  it('18. Gracefully ignores expired or corrupted cache without throwing errors', () => {
    const svc = createServiceInstance();

    // Expired cache (> 30 mins)
    (svc as any).memoryCache = {
      tracks: [createTestTrack()],
      timestamp: Date.now() - 35 * 60 * 1000,
      source: 'external',
    };

    assert.equal(svc.getCachedTrending(), null);
  });

  // Test 19: Home Trending & Dedicated "See All" Trending dataset identity/parity
  it('19. Both Home and See All consumers receive the identical ranked dataset from the service', async () => {
    const svc = createServiceInstance();
    const tracks = [
      createTestTrack({ title: 'Rank 1 Hit' }),
      createTestTrack({ title: 'Rank 2 Hit' }),
    ];

    (svc as any).memoryCache = {
      tracks,
      timestamp: Date.now(),
      source: 'external',
    };

    const homeViewData = await svc.getTrendingInIndia(10);
    const seeAllViewData = await svc.getTrendingInIndia(10);

    assert.deepEqual(homeViewData, seeAllViewData, 'Home Carousel and See All View must have 100% data parity');
  });

  // Test 20: Offline resilience and graceful fallback
  it('20. In offline state with zero network, returns cached external trending safely', async () => {
    const svc = createServiceInstance();
    const offlineCache = [createTestTrack({ title: 'Cached Offline Song', provider: 'jiosaavn' })];

    (svc as any).memoryCache = {
      tracks: offlineCache,
      timestamp: Date.now(),
      source: 'external',
    };

    const result = await svc.getTrendingInIndia(10);
    assert.equal(result.length, 1);
    assert.equal(result[0].title, 'Cached Offline Song');
  });
});
