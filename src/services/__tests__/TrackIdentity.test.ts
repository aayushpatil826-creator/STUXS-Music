import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanCoreTitle,
  detectSemanticTags,
  extractPrimaryArtist,
  extractProviderIdentity,
  getCanonicalTrackKey,
  getCrossProviderFingerprint,
  isSameRecording,
} from '../../utils/trackIdentity';
import type { Track } from '../../types/music';

describe('Canonical Track Identity & Recording Matcher', () => {
  it('1. Normalizes JioSaavn track ID variants to identical authoritative provider identity', () => {
    const trackWeb: Partial<Track> = {
      id: 'jiosaavn-track-934827',
      provider: 'jiosaavn',
      title: 'Kesariya',
      artistName: 'Arijit Singh',
    };
    const trackNative: Partial<Track> = {
      id: 'jiosaavn-934827',
      provider: 'jiosaavn',
      title: 'Kesariya',
      artistName: 'Arijit Singh',
    };

    const provWeb = extractProviderIdentity(trackWeb);
    const provNative = extractProviderIdentity(trackNative);

    assert.equal(provWeb?.provider, 'jiosaavn');
    assert.equal(provWeb?.rawId, '934827');
    assert.equal(provNative?.provider, 'jiosaavn');
    assert.equal(provNative?.rawId, '934827');
    assert.equal(getCanonicalTrackKey(trackWeb), 'jiosaavn:934827');
    assert.equal(getCanonicalTrackKey(trackNative), 'jiosaavn:934827');
    assert.equal(isSameRecording(trackWeb, trackNative), true);
  });

  it('2. Preserves STUXS first-party catalog identity with top priority', () => {
    const stuxsTrack: Partial<Track> = {
      id: 'stuxs-prod-402',
      provider: 'stuxs',
      title: 'Obsidian Pulse',
      artistName: 'STUXS Studio',
    };
    const key = getCanonicalTrackKey(stuxsTrack);
    assert.equal(key, 'stuxs:prod-402');
  });

  it('3. Strips purely cosmetic tags from track titles without altering recording identity', () => {
    assert.equal(cleanCoreTitle('Chaleya (Official Audio)'), 'chaleya');
    assert.equal(cleanCoreTitle('Chaleya [Official Music Video]'), 'chaleya');
    assert.equal(cleanCoreTitle('Chaleya (Full Song)'), 'chaleya');
    assert.equal(cleanCoreTitle('Chaleya (Lyric Video)'), 'chaleya');
    assert.equal(cleanCoreTitle('Chaleya [4K HD]'), 'chaleya');

    const t1: Partial<Track> = { title: 'Chaleya (Official Audio)', artistName: 'Arijit Singh', duration: 200 };
    const t2: Partial<Track> = { title: 'Chaleya [Official Video]', artistName: 'Arijit Singh', duration: 202 };
    assert.equal(isSameRecording(t1, t2), true);
  });

  it('4. STRICTLY PRESERVES genuine recording variations (Remix, Acoustic, Live, etc.)', () => {
    const original: Partial<Track> = {
      title: 'Tum Hi Ho',
      artistName: 'Arijit Singh',
      duration: 262,
    };
    const remix: Partial<Track> = {
      title: 'Tum Hi Ho (Remix)',
      artistName: 'Arijit Singh',
      duration: 240,
    };
    const acoustic: Partial<Track> = {
      title: 'Tum Hi Ho - Acoustic',
      artistName: 'Arijit Singh',
      duration: 250,
    };
    const live: Partial<Track> = {
      title: 'Tum Hi Ho (Live in Concert)',
      artistName: 'Arijit Singh',
      duration: 310,
    };

    assert.equal(isSameRecording(original, remix), false);
    assert.equal(isSameRecording(original, acoustic), false);
    assert.equal(isSameRecording(original, live), false);
    assert.equal(isSameRecording(remix, acoustic), false);

    assert.notEqual(getCrossProviderFingerprint(original), getCrossProviderFingerprint(remix));
    assert.notEqual(getCrossProviderFingerprint(original), getCrossProviderFingerprint(acoustic));
    assert.deepEqual(detectSemanticTags('Tum Hi Ho (Remix)'), ['remix']);
    assert.deepEqual(detectSemanticTags('Tum Hi Ho - Acoustic'), ['acoustic']);
  });

  it('5. Rejects merge of same title and artist if durations differ significantly (>8s)', () => {
    const recordingA: Partial<Track> = {
      title: 'Raabta',
      artistName: 'Arijit Singh',
      duration: 243, // 4m 03s
    };
    const recordingB: Partial<Track> = {
      title: 'Raabta',
      artistName: 'Arijit Singh',
      duration: 295, // 4m 55s (different arrangement / extended film version)
    };

    assert.equal(isSameRecording(recordingA, recordingB), false);
  });

  it('6. Matches same recording across providers within duration tolerance (<=8s)', () => {
    const itunesTrack: Partial<Track> = {
      id: 'itunes-145678',
      provider: 'itunes',
      title: 'Apna Bana Le (From "Bhediya")',
      artistName: 'Arijit Singh, Sachin-Jigar',
      duration: 261,
    };
    const saavnTrack: Partial<Track> = {
      id: 'jiosaavn-track-889900',
      provider: 'jiosaavn',
      title: 'Apna Bana Le',
      artistName: 'Arijit Singh',
      duration: 263,
    };

    assert.equal(isSameRecording(itunesTrack, saavnTrack), true);
  });

  it('7. Handles complex multi-artist credit extraction cleanly', () => {
    assert.equal(extractPrimaryArtist('Arijit Singh, Shreya Ghoshal'), 'arijit singh');
    assert.equal(extractPrimaryArtist('Sachin-Jigar feat. Arijit Singh'), 'sachin jigar');
    assert.equal(extractPrimaryArtist('Anirudh Ravichander & Jonita Gandhi'), 'anirudh ravichander');
  });
});
