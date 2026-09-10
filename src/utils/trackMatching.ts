import type { Track } from '../types/music';
import { cleanText, fuzzySimilarity } from './searchIntelligence';

export interface TrackMatchResult {
  isValid: boolean;
  confidence: number;
  titleScore: number;
  artistScore: number;
  durationScore: number;
  reason?: string;
}

const VERSION_TERMS = [
  'remix',
  'live',
  'acoustic',
  'cover',
  'slowed',
  'reverb',
  'instrumental',
  'karaoke',
  'unplugged',
  'sped up',
  'mashup',
  'reprise',
];

/**
 * Cleans titles by removing movie soundtracks, video notes, and formatting noise.
 * E.g. 'Kesariya (From "Brahmastra")' -> 'kesariya'
 * E.g. 'Pal Pal (Official Video)' -> 'pal pal'
 */
export function extractCoreTitle(title: string): string {
  if (!title) return '';
  return cleanText(title)
    .replace(/\(from\s+[^)]+\)/gi, '')
    .replace(/\[from\s+[^\]]+\]/gi, '')
    .replace(/\(original motion picture soundtrack\)/gi, '')
    .replace(/\[original motion picture soundtrack\]/gi, '')
    .replace(/\(soundtrack\)/gi, '')
    .replace(/\[soundtrack\]/gi, '')
    .replace(/\(ost\)/gi, '')
    .replace(/\[ost\]/gi, '')
    .replace(/\(movie version\)/gi, '')
    .replace(/\(film version\)/gi, '')
    .replace(/\(feat\.[^)]+\)/gi, '')
    .replace(/\[feat\.[^\]]+\]/gi, '')
    .replace(/\(ft\.[^)]+\)/gi, '')
    .replace(/\[ft\.[^\]]+\]/gi, '')
    .replace(/\(with\s+[^)]+\)/gi, '')
    .replace(/\[with\s+[^\]]+\]/gi, '')
    .replace(/\b(official|video|audio|lyrics|hd|4k|original|song|lyric video|music video|full song|audio song|video song)\b/gi, '')
    .replace(/\(.*\)/g, '')
    .replace(/\[.*\]/g, '')
    .trim();
}

/**
 * Extracts a normalized list of artist names from multi-artist strings.
 * Supports: ',', '&', 'feat.', 'ft.', 'and', '+', '/', 'with'.
 * E.g. 'Arijit Singh, Pritam & Badshah' -> ['arijit singh', 'pritam', 'badshah']
 */
export function extractArtistList(artistStr: string): string[] {
  if (!artistStr) return [];
  const normalized = artistStr
    .toLowerCase()
    .replace(/\b(feat\.|ft\.|featuring|and|with)\b/gi, ',')
    .replace(/[&+/|]/g, ',');

  return normalized
    .split(',')
    .map((a) => cleanText(a).trim())
    .filter((a) => a.length >= 2);
}

function extractVersionTags(title: string): Set<string> {
  const lower = title.toLowerCase();
  const tags = new Set<string>();
  for (const term of VERSION_TERMS) {
    if (lower.includes(term)) {
      tags.add(term);
    }
  }
  return tags;
}

function tokenize(text: string): string[] {
  return cleanText(text).split(/\s+/).filter((t) => t.length >= 2);
}

/**
 * Calculates a resilient multi-factor match confidence for cross-provider fallbacks.
 *
 * Rules:
 * 1. Title matches core title similarity (supports soundtracks, parentheses cleaning).
 * 2. Artist matches multi-artist token overlap (supports 'Pritam, Arijit' vs 'Arijit, Pritam', 'feat.', '&').
 * 3. Duration serves as a secondary sanity check to reject short 30s preview clips.
 */
export function calculateTrackMatchConfidence(target: Track, candidate: Track): TrackMatchResult {
  const tTitle = extractCoreTitle(target.title);
  const cTitle = extractCoreTitle(candidate.title);

  // --- 1. Title Similarity (Weight 45%) ---
  let titleScore = 0;
  const rawTitleSim = fuzzySimilarity(tTitle, cTitle);

  if (tTitle === cTitle || (tTitle.length >= 3 && cTitle.length >= 3 && (cTitle.includes(tTitle) || tTitle.includes(cTitle)))) {
    titleScore = 1.0;
  } else if (rawTitleSim >= 0.65) {
    titleScore = rawTitleSim;
  } else {
    // Check individual word token overlap
    const tTokens = tokenize(tTitle);
    const cTokens = tokenize(cTitle);
    const common = tTokens.filter((t) => cTokens.includes(t));
    if (common.length > 0 && common.length >= Math.min(tTokens.length, cTokens.length) * 0.4) {
      titleScore = 0.85;
    } else {
      titleScore = rawTitleSim * 0.8;
    }
  }

  // Version consistency check (e.g. Remix vs Acoustic)
  const tVersions = extractVersionTags(target.title);
  const cVersions = extractVersionTags(candidate.title);
  let versionMismatch = false;
  for (const tag of cVersions) {
    if (!tVersions.has(tag)) {
      versionMismatch = true;
      break;
    }
  }
  if (versionMismatch) {
    titleScore *= 0.6;
  }

  // --- 2. Multi-Artist Similarity (Weight 40%) ---
  let artistScore = 0;
  const tArtists = extractArtistList(target.artistName);
  const cArtists = extractArtistList(candidate.artistName);

  const tFullArtist = cleanText(target.artistName);
  const cFullArtist = cleanText(candidate.artistName);

  if (tFullArtist === cFullArtist) {
    artistScore = 1.0;
  } else if (fuzzySimilarity(tFullArtist, cFullArtist) >= 0.60) {
    artistScore = 0.90;
  } else {
    // Check multi-artist list overlap
    let matchFound = false;
    for (const ta of tArtists) {
      for (const ca of cArtists) {
        if (ta === ca || ta.includes(ca) || ca.includes(ta) || fuzzySimilarity(ta, ca) >= 0.60) {
          matchFound = true;
          break;
        }
      }
      if (matchFound) break;
    }

    if (matchFound) {
      artistScore = 0.90;
    } else {
      // Check if target artist token is in candidate title, album, or full artist string
      const tTokens = tokenize(target.artistName);
      const candAllText = `${candidate.artistName} ${candidate.title} ${candidate.albumTitle || ''}`.toLowerCase();
      if (tTokens.some((tok) => candAllText.includes(tok))) {
        artistScore = 0.80;
      } else {
        artistScore = fuzzySimilarity(tFullArtist, cFullArtist) * 0.6;
      }
    }
  }

  const isGenericArtist = !tFullArtist || tFullArtist === 'unknown artist' || tFullArtist === 'various artists';

  // --- 3. Duration Sanity & Exact Recording Verification (Weight 20%) ---
  let durationScore = 1.0;
  const tDur = target.duration || 0;
  const cDur = candidate.duration || 0;

  if (tDur > 30 && cDur > 0) {
    if (cDur < 30 || (tDur >= 60 && cDur < tDur * 0.50)) {
      // Reject obvious short preview clips (e.g. 30s clip for full song)
      durationScore = 0.0;
    } else {
      const diff = Math.abs(tDur - cDur);
      if (diff <= 6) {
        durationScore = 1.0; // Virtually identical recording cut
      } else if (diff <= 15) {
        durationScore = 0.80; // Acceptable intro/outro silence variation
      } else {
        // More than 15s difference indicates a DIFFERENT recording, remix, extended version, or different song
        durationScore = 0.0;
      }
    }
  }

  if (durationScore === 0.0) {
    return {
      isValid: false,
      confidence: 0,
      titleScore,
      artistScore,
      durationScore,
      reason: `Duration mismatch: expected ${tDur}s vs candidate ${cDur}s (diff: ${Math.abs(tDur - cDur)}s > 15s)`,
    };
  }

  // Total Confidence Calculation
  const confidence = titleScore * 0.45 + artistScore * 0.35 + durationScore * 0.20;
  const isValid = (titleScore >= 0.70 || (tTitle.length >= 3 && cTitle === tTitle)) &&
                  (isGenericArtist || artistScore >= 0.65) &&
                  durationScore > 0 &&
                  confidence >= 0.75;

  return {
    isValid,
    confidence,
    titleScore,
    artistScore,
    durationScore,
    reason: isValid ? undefined : `Low overall match confidence (${(confidence * 100).toFixed(0)}%)`,
  };
}
