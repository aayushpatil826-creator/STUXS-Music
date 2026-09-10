import type { Track, AudioQuality } from '../types/music';

export interface ActiveStreamQuality {
  bitrate: number; // 320, 160, 96, 48, 128
  codec: string; // 'AAC', 'MP3'
  label: string; // e.g. '160 KBPS AAC • HIGH QUALITY'
  qualityName: string; // 'Very High', 'High', 'Normal', 'Saver'
}

/**
 * Resolves the genuine active stream quality from a track's audioUrl and metadata.
 */
export function resolveActiveStreamQuality(track: Track | null): ActiveStreamQuality {
  if (!track || !track.audioUrl) {
    return {
      bitrate: 0,
      codec: 'NONE',
      label: 'NO ACTIVE STREAM',
      qualityName: 'None',
    };
  }

  if (track.isPreview || track.accessStatus === 'preview') {
    return {
      bitrate: 128,
      codec: 'AAC',
      label: '128 KBPS AAC • 30S PREVIEW',
      qualityName: 'Preview',
    };
  }

  const url = track.audioUrl.toLowerCase();
  const bitrateMeta = (track.actualBitrate || '').toLowerCase();

  // 1. Check explicit JioSaavn MP4/AAC bitrates in URL suffix or metadata
  if (url.includes('_320.mp4') || bitrateMeta.includes('320')) {
    return {
      bitrate: 320,
      codec: 'AAC',
      label: '320 KBPS AAC • HIGH FIDELITY',
      qualityName: 'Very High',
    };
  }

  if (url.includes('_160.mp4') || bitrateMeta.includes('160')) {
    return {
      bitrate: 160,
      codec: 'AAC',
      label: '160 KBPS AAC • HIGH QUALITY',
      qualityName: 'High',
    };
  }

  if (url.includes('_96.mp4') || bitrateMeta.includes('96')) {
    return {
      bitrate: 96,
      codec: 'AAC',
      label: '96 KBPS AAC • NORMAL QUALITY',
      qualityName: 'Normal',
    };
  }

  if (url.includes('_48.mp4') || bitrateMeta.includes('48')) {
    return {
      bitrate: 48,
      codec: 'AAC',
      label: '48 KBPS AAC • DATA SAVER',
      qualityName: 'Data Saver',
    };
  }

  // 2. Apple Music / iTunes Store previews
  if (track.provider === 'itunes' || url.includes('apple.com') || url.includes('itunes')) {
    return {
      bitrate: 128,
      codec: 'AAC',
      label: '128 KBPS AAC • PREVIEW',
      qualityName: 'Preview',
    };
  }

  return {
    bitrate: 320,
    codec: 'AAC',
    label: '320 KBPS AAC • HIGH FIDELITY',
    qualityName: 'Very High',
  };
}

/**
 * Maps a JioSaavn audio URL to the requested AudioQuality suffix.
 */
export function mapJioSaavnUrlToQuality(url: string, quality: AudioQuality): { newUrl: string; bitrate: string } {
  let suffix = '_320.mp4';
  let bitrate = '320 kbps AAC';

  if (quality === 'high') {
    suffix = '_160.mp4';
    bitrate = '160 kbps AAC';
  } else if (quality === 'normal') {
    suffix = '_96.mp4';
    bitrate = '96 kbps AAC';
  } else if (quality === 'saver') {
    suffix = '_48.mp4';
    bitrate = '48 kbps AAC';
  } else {
    suffix = '_320.mp4';
    bitrate = '320 kbps AAC';
  }

  let secureUrl = url;
  if (secureUrl.startsWith('http://')) {
    secureUrl = secureUrl.replace('http://', 'https://');
  }

  if (secureUrl.includes('.mp4')) {
    const newUrl = secureUrl.replace(/_(96|160|320|48)\.mp4$/, '').replace(/\.mp4$/, '') + suffix;
    return {
      newUrl,
      bitrate,
    };
  }

  return { newUrl: secureUrl, bitrate };
}
