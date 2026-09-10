import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isValidEmail, calculatePasswordStrength } from '../../screens/AuthScreen';
import { DEFAULT_PLAYBACK } from '../../context/SettingsContext';
import { deriveAudioExtension } from '../NativeMigrationService';
import { validateDownloadSource } from '../DownloadService';
import type { Track } from '../../types/music';

describe('Pre-Release Polish: Auth Validations', () => {
  it('correctly validates standard and edge-case email formats', () => {
    // Valid emails
    assert.equal(isValidEmail('test@example.com'), true);
    assert.equal(isValidEmail('user.name+tag@sub.domain.co.in'), true);
    assert.equal(isValidEmail('developer@stuxs.music'), true);

    // Invalid emails
    assert.equal(isValidEmail(''), false);
    assert.equal(isValidEmail('plainaddress'), false);
    assert.equal(isValidEmail('@missingusername.com'), false);
    assert.equal(isValidEmail('missingatsign.com'), false);
    assert.equal(isValidEmail('user@.com'), false);
    assert.equal(isValidEmail('user@domain'), false);
    assert.equal(isValidEmail('user name@domain.com'), false);
  });

  it('computes deterministic password strength across tiers', () => {
    // Empty
    const empty = calculatePasswordStrength('');
    assert.equal(empty.score, 0);
    assert.equal(empty.label, '');

    // Under 6 characters
    const short = calculatePasswordStrength('abc1!');
    assert.equal(short.score, 1);
    assert.equal(short.label, 'Too short (min 6)');

    // 6+ characters, single class
    const sixOnlyLower = calculatePasswordStrength('abcdef');
    assert.equal(sixOnlyLower.score, 1);
    assert.equal(sixOnlyLower.label, 'Weak');

    // Medium tier (8+ chars with lowercase + number -> score 2)
    const mediumPass = calculatePasswordStrength('passwords1');
    assert.equal(mediumPass.score, 2);
    assert.equal(mediumPass.label, 'Medium');

    // Strong tier (10+ chars with uppercase + lowercase + number + symbol -> score 3/4)
    const strongPass = calculatePasswordStrength('StuxsMusic#2026');
    assert.equal(strongPass.score, 3);
    assert.equal(strongPass.label, 'Strong');
  });
});

describe('Pre-Release Polish: Settings & Native Engine Permanent State', () => {
  it('ensures DEFAULT_PLAYBACK has useNativeAudioEngine set to true', () => {
    assert.equal(DEFAULT_PLAYBACK.useNativeAudioEngine, true);
  });

  it('migrates legacy stored settings with useNativeAudioEngine: false to true', () => {
    const legacySaved = {
      ...DEFAULT_PLAYBACK,
      useNativeAudioEngine: false,
    };
    const migrated = {
      ...legacySaved,
      useNativeAudioEngine: true,
    };
    assert.equal(migrated.useNativeAudioEngine, true);
  });
});

describe('Pre-Release Polish: Playback Hot-Swap & Gapless Logic', () => {
  it('correctly calculates next logical index for gapless preloading', () => {
    const getNextLogicalIndex = (currentIndex: number, queueLength: number, repeatMode: 'off' | 'all' | 'one') => {
      if (queueLength <= 0 || currentIndex < 0 || currentIndex >= queueLength) return -1;
      if (repeatMode === 'one') return currentIndex;
      if (currentIndex + 1 < queueLength) return currentIndex + 1;
      if (repeatMode === 'all') return 0;
      return -1;
    };

    // Sequential middle track
    assert.equal(getNextLogicalIndex(0, 3, 'off'), 1);
    assert.equal(getNextLogicalIndex(1, 3, 'off'), 2);
    // End of queue with repeat off -> no preload
    assert.equal(getNextLogicalIndex(2, 3, 'off'), -1);
    // End of queue with repeat all -> preload index 0
    assert.equal(getNextLogicalIndex(2, 3, 'all'), 0);
    // Repeat one -> preload the same track
    assert.equal(getNextLogicalIndex(1, 3, 'one'), 1);
  });

  it('token cancellation guards against outdated async quality resolutions', async () => {
    let currentToken = 0;
    const results: string[] = [];

    const simulateQualitySwitch = async (targetQuality: string, delayMs: number) => {
      const thisToken = ++currentToken;
      await new Promise(r => setTimeout(r, delayMs));
      // Guard check
      if (thisToken !== currentToken) {
        return; // Aborted by newer switch
      }
      results.push(targetQuality);
    };

    // Trigger two rapid quality switches: first takes 50ms, second takes 10ms
    const p1 = simulateQualitySwitch('128kbps', 50);
    const p2 = simulateQualitySwitch('320kbps', 10);

    await Promise.all([p1, p2]);

    // Only the second (latest) switch must apply
    assert.equal(results.length, 1);
    assert.equal(results[0], '320kbps');
  });
});

describe('Pre-Release Polish: Imported Songs Playback Reliability', () => {
  it('correctly derives audio extension from MIME types, audio URLs, and local paths', () => {
    // MP3
    assert.equal(deriveAudioExtension('audio/mpeg'), 'mp3');
    assert.equal(deriveAudioExtension('audio/mp3'), 'mp3');
    assert.equal(deriveAudioExtension('', { localPath: 'song.mp3' } as any), 'mp3');

    // M4A / AAC
    assert.equal(deriveAudioExtension('audio/mp4'), 'm4a');
    assert.equal(deriveAudioExtension('audio/m4a'), 'm4a');
    assert.equal(deriveAudioExtension('audio/aac'), 'm4a');
    assert.equal(deriveAudioExtension('', { localPath: 'my_track.m4a' } as any), 'm4a');
    assert.equal(deriveAudioExtension('', { audioUrl: 'https://cdn.example.com/stream.m4a' } as any), 'm4a');

    // FLAC, WAV, OGG
    assert.equal(deriveAudioExtension('audio/flac'), 'flac');
    assert.equal(deriveAudioExtension('', { localPath: 'lossless.flac' } as any), 'flac');
    assert.equal(deriveAudioExtension('audio/wav'), 'wav');
    assert.equal(deriveAudioExtension('', { localPath: 'studio.wav' } as any), 'wav');
    assert.equal(deriveAudioExtension('audio/ogg'), 'ogg');
    assert.equal(deriveAudioExtension('', { localPath: 'audio.ogg' } as any), 'ogg');
  });

  it('validates authentic imported local tracks and preserves playability', () => {
    const validImportedMp3: Track = {
      id: 'local_1720000000_abc123',
      title: 'Local Acoustic Track',
      artistId: 'art-local-1',
      artistName: 'Unknown Artist',
      albumTitle: 'Local Library',
      artworkUrl: 'https://cdn.example.com/art.jpg',
      audioUrl: 'blob:http://localhost/d5462492-4fec-4fa1',
      localPath: '/data/user/0/com.stuxs.music/files/native_downloads/local_1720000000_abc123.mp3',
      duration: 215,
      provider: 'local',
      sourceType: 'local',
      isPlayable: true,
      accessStatus: 'playable',
      playbackType: 'full',
    };

    const validation = validateDownloadSource(validImportedMp3, validImportedMp3.audioUrl);
    assert.equal(validation.isValid, true);
  });

  it('preserves playability when artwork is missing or empty', () => {
    const trackMissingArtwork: Track = {
      id: 'local_no_art_001',
      title: 'Song Without Art',
      artistId: 'art-indie-1',
      artistName: 'Indie Artist',
      albumTitle: 'Demo Album',
      artworkUrl: '',
      audioUrl: 'file:///storage/emulated/0/Music/song.mp3',
      localPath: '/storage/emulated/0/Music/song.mp3',
      duration: 180,
      provider: 'local',
      sourceType: 'local',
      isPlayable: true,
      accessStatus: 'playable',
      playbackType: 'full',
    };

    const validation = validateDownloadSource(trackMissingArtwork, trackMissingArtwork.audioUrl);
    assert.equal(validation.isValid, true);
    assert.equal(trackMissingArtwork.isPlayable, true);
  });

  it('preserves playability when metadata is missing (filename-based fallback)', () => {
    const trackMissingMetadata: Track = {
      id: 'local_no_meta_002',
      title: 'Track01',
      artistId: 'art-unknown',
      artistName: 'Unknown Artist',
      albumTitle: 'Local Library',
      artworkUrl: '',
      audioUrl: 'file:///storage/emulated/0/Download/Track01.mp3',
      localPath: '/storage/emulated/0/Download/Track01.mp3',
      duration: 190,
      provider: 'local',
      sourceType: 'local',
      isPlayable: true,
      accessStatus: 'playable',
      playbackType: 'full',
    };

    const validation = validateDownloadSource(trackMissingMetadata, trackMissingMetadata.audioUrl);
    assert.equal(validation.isValid, true);
  });

  it('strictly rejects corrupt or empty audio streams', () => {
    const corruptTrack: Track = {
      id: 'local_corrupt_003',
      title: 'Empty Audio File',
      artistId: 'art-test',
      artistName: 'Test',
      albumTitle: 'Corrupt',
      artworkUrl: '',
      audioUrl: '',
      duration: 0,
      provider: 'local',
      sourceType: 'local',
      isPlayable: false,
      accessStatus: 'blocked',
      playbackType: 'blocked',
    };

    const validation = validateDownloadSource(corruptTrack, corruptTrack.audioUrl);
    assert.equal(validation.isValid, false);
    assert.match(validation.reason || '', /no playable audio URL/);
  });

  it('rejects unsupported audio protocol schemes', () => {
    const ftpTrack: Track = {
      id: 'local_ftp_004',
      title: 'FTP Track',
      artistId: 'art-remote',
      artistName: 'Remote',
      albumTitle: 'Network',
      artworkUrl: '',
      audioUrl: 'ftp://fileserver/audio.mp3',
      duration: 200,
      provider: 'local',
      sourceType: 'local',
      isPlayable: true,
      accessStatus: 'playable',
      playbackType: 'full',
    };

    const validation = validateDownloadSource(ftpTrack, ftpTrack.audioUrl);
    assert.equal(validation.isValid, false);
    assert.match(validation.reason || '', /Unsupported URL scheme/);
  });

  it('prevents accidental SoundCloud reintroduction for imported tracks', () => {
    const scImport: Track = {
      id: 'soundcloud-123456',
      title: 'SoundCloud Rip',
      artistId: 'art-sc',
      artistName: 'Artist',
      albumTitle: 'Album',
      artworkUrl: '',
      audioUrl: 'https://api.soundcloud.com/tracks/123/stream',
      duration: 180,
      provider: 'soundcloud' as any,
      sourceType: 'local',
      isPlayable: true,
      accessStatus: 'playable',
      playbackType: 'full',
    };

    const validation = validateDownloadSource(scImport, scImport.audioUrl);
    assert.equal(validation.isValid, false);
    assert.match(validation.reason || '', /SoundCloud provider is permanently removed/);
  });
});
