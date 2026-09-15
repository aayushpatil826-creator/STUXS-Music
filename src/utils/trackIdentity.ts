import type { Track, ProviderType } from '../types/music';

/**
 * Strips diacritics, special symbols, and converts to lower case.
 */
export function cleanIdentityText(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacritics
    .replace(/[^\w\s]/g, ' ')       // replace punctuation with spaces
    .replace(/\s+/g, ' ')          // collapse whitespace
    .trim();
}

/**
 * Extracts primary artist name (first artist from comma, '&', 'feat.', 'ft.' separated list).
 */
export function extractPrimaryArtist(artistText: string | null | undefined): string {
  if (!artistText) return '';
  const first = artistText
    .split(/[,&/|]|\bfeat\.?\b|\bft\.?\b|\bwith\b/i)[0]
    .trim();
  return cleanIdentityText(first);
}

/**
 * Cosmetic video/audio wrapper tags that do NOT alter the recording itself.
 * These are safe to remove when comparing identities.
 */
const COSMETIC_WRAPPER_REGEX = /\s*[\(\[]\s*(?:official\s*(?:audio|video|music\s*video|lyric\s*video)?|audio|video|music\s*video|lyric\s*video|lyrics|visualizer|full\s*(?:song|audio|video|track|audio\s*song)?|(?:4k|hd|hq|ultra\s*hd|uhd|\d{3,4}p)(?:\s+(?:4k|hd|hq|ultra\s*hd|uhd|\d{3,4}p))*|remastered(?:\s+\d{4})?|remaster(?:\s+\d{4})?|from\s+["'].*?["']|from\s+[^)\]]+)\s*[\)\]]/gi;

const FROM_MOVIE_DASH_REGEX = /\s*-\s*from\s+["'].*?["']/gi;

/**
 * Semantic version identifiers that MUST be preserved because they indicate genuinely
 * distinct musical recordings (remix, acoustic, live, reprise, etc.).
 */
export const SEMANTIC_RECORDING_TAGS = [
  'remix',
  'acoustic',
  'live',
  'unplugged',
  'reprise',
  'slowed',
  'reverb',
  'lo-fi',
  'lofi',
  'instrumental',
  'karaoke',
  'cover',
  'mashup',
  'extended',
  'club mix',
  'radio edit',
  'female version',
  'male version',
  'duet version',
  'sad version',
  'stripped',
  'orchestral',
  'symphonic',
] as const;

/**
 * Cleans cosmetic tags from a title while strictly preserving semantic recording differences.
 */
export function cleanCoreTitle(title: string | null | undefined): string {
  if (!title) return '';
  let cleaned = title
    .replace(COSMETIC_WRAPPER_REGEX, ' ')
    .replace(FROM_MOVIE_DASH_REGEX, ' ');
  return cleanIdentityText(cleaned);
}

/**
 * Detects whether a title contains a specific semantic recording variant.
 */
export function detectSemanticTags(title: string | null | undefined): string[] {
  if (!title) return [];
  const lower = title.toLowerCase();
  const matched: string[] = [];
  for (const tag of SEMANTIC_RECORDING_TAGS) {
    if (lower.includes(tag)) {
      matched.push(tag);
    }
  }
  return matched.sort();
}

export interface ProviderIdentity {
  provider: ProviderType | string;
  rawId: string;
}

/**
 * Parses provider and raw ID from various ID patterns (e.g. jiosaavn-track-12345 vs jiosaavn-12345).
 */
export function extractProviderIdentity(track: Partial<Track>): ProviderIdentity | null {
  if (!track) return null;

  const rawTrackId = String(track.id || '').trim();
  const explicitProvider = (track.provider || '').toLowerCase().trim();
  const providerId = track.providerId ? String(track.providerId).trim() : '';

  // 1. Explicit STUXS Catalog ID
  if (explicitProvider === 'stuxs' || rawTrackId.startsWith('stuxs-') || track.sourceType === 'stuxs') {
    const rawId = providerId || rawTrackId.replace(/^stuxs-/, '');
    return { provider: 'stuxs', rawId };
  }

  // 2. JioSaavn: Normalizes both "jiosaavn-track-12345" and "jiosaavn-12345" to rawId "12345"
  if (explicitProvider === 'jiosaavn' || rawTrackId.startsWith('jiosaavn-')) {
    const rawId = providerId || rawTrackId.replace(/^jiosaavn-(track-)?/, '');
    if (rawId) return { provider: 'jiosaavn', rawId };
  }

  // 3. Gaana: Normalizes both "gaana-track-12345" and "gaana-12345"
  if (explicitProvider === 'gaana' || rawTrackId.startsWith('gaana-')) {
    const rawId = providerId || rawTrackId.replace(/^gaana-(track-)?/, '');
    if (rawId) return { provider: 'gaana', rawId };
  }

  // 4. iTunes
  if (explicitProvider === 'itunes' || rawTrackId.startsWith('itunes-')) {
    const rawId = providerId || rawTrackId.replace(/^itunes-(track-)?/, '');
    if (rawId) return { provider: 'itunes', rawId };
  }

  // 5. Local Device Music
  if (explicitProvider === 'local' || rawTrackId.startsWith('local_') || rawTrackId.startsWith('local-')) {
    const rawId = providerId || rawTrackId.replace(/^local[_-]/, '');
    if (rawId) return { provider: 'local', rawId };
  }

  // 6. M3U Streams
  if (explicitProvider === 'local-m3u' || rawTrackId.startsWith('m3u-')) {
    const rawId = providerId || rawTrackId.replace(/^m3u-/, '');
    if (rawId) return { provider: 'local-m3u', rawId };
  }

  // If track has an explicit provider and providerId
  if (explicitProvider && providerId) {
    return { provider: explicitProvider, rawId: providerId };
  }

  return null;
}

/**
 * Returns a canonical key for the track following priority hierarchy:
 * Priority A: First-party STUXS catalog identity: "stuxs:<rawId>"
 * Priority B: Authoritative provider identity: "<provider>:<rawId>"
 * Priority C: Multi-signal recording fingerprint: "fp:<coreTitle>::<primaryArtist>::<semanticTags>::<durationBucket>"
 */
export function getCanonicalTrackKey(track: Partial<Track>): string {
  if (!track) return 'unknown';

  // Priority A & B: Authoritative provider identity
  const provId = extractProviderIdentity(track);
  if (provId && provId.rawId && provId.rawId !== '0' && provId.rawId !== 'unknown') {
    return `${provId.provider}:${provId.rawId}`;
  }

  // Priority C: Cross-provider recording fingerprint
  return getCrossProviderFingerprint(track);
}

/**
 * Computes a cross-provider recording fingerprint for matching identical tracks
 * originating from different sources (e.g. iTunes preview resolved via JioSaavn,
 * or search result vs playlist entry).
 */
export function getCrossProviderFingerprint(track: Partial<Track>): string {
  const coreTitle = cleanCoreTitle(track.title);
  const primaryArtist = extractPrimaryArtist(track.artistName || (track as any)?.artist);
  const semanticTags = detectSemanticTags(track.title).join('+');
  
  // Duration bucket: round to 10-second increments so slight stream encoding differences align
  const durSec = typeof track.duration === 'number' && track.duration > 0
    ? track.duration
    : (typeof (track as any)?.durationMs === 'number' && (track as any).durationMs > 0 ? Math.round((track as any).durationMs / 1000) : 0);
  const durBucket = durSec > 0 ? Math.round(durSec / 10) * 10 : 0;

  return `fp:${coreTitle}::${primaryArtist}::${semanticTags || 'std'}::${durBucket}`;
}

/**
 * Comprehensive equality check determining whether two track representations refer to
 * the exact same physical/logical recording.
 *
 * Enforces:
 * 1. Exact track ID match
 * 2. Exact provider namespace + raw ID match (e.g. jiosaavn-track-12345 == jiosaavn-12345)
 * 3. Exact first-party STUXS match
 * 4. Cross-provider match ONLY when:
 *    - Core titles match
 *    - Primary artists match
 *    - Semantic recording tags are identical (Remix != Original, Live != Studio)
 *    - Duration tolerance $\le 8$ seconds (if both durations are available)
 */
export function isSameRecording(a: Partial<Track> | null | undefined, b: Partial<Track> | null | undefined): boolean {
  if (!a || !b) return false;

  // 1. Direct ID match
  if (a.id && b.id && a.id === b.id) return true;

  // 2. Provider identity match (e.g. jiosaavn-track-12345 vs jiosaavn-12345)
  const provA = extractProviderIdentity(a);
  const provB = extractProviderIdentity(b);
  if (provA && provB && provA.provider === provB.provider && provA.rawId && provB.rawId && provA.rawId === provB.rawId) {
    return true;
  }

  // 3. Local file path match
  const localA = a.localPath || (a.audioUrl?.startsWith('file://') ? a.audioUrl : null);
  const localB = b.localPath || (b.audioUrl?.startsWith('file://') ? b.audioUrl : null);
  if (localA && localB && localA === localB) return true;

  // 4. Cross-provider multi-signal recording comparison
  const titleA = cleanCoreTitle(a.title);
  const titleB = cleanCoreTitle(b.title);
  if (!titleA || !titleB || titleA !== titleB) return false;

  const artistA = extractPrimaryArtist(a.artistName || (a as any)?.artist);
  const artistB = extractPrimaryArtist(b.artistName || (b as any)?.artist);
  if (!artistA || !artistB || artistA !== artistB) return false;

  // Semantic tag check: If one is a remix/acoustic/live and the other is not, NEVER merge!
  const tagsA = detectSemanticTags(a.title).join(',');
  const tagsB = detectSemanticTags(b.title).join(',');
  if (tagsA !== tagsB) return false;

  // Duration tolerance check (must be within 8 seconds if both have valid durations > 10s)
  const durA = typeof a.duration === 'number' && a.duration > 10
    ? a.duration
    : (typeof (a as any)?.durationMs === 'number' && (a as any).durationMs > 10000 ? Math.round((a as any).durationMs / 1000) : 0);
  const durB = typeof b.duration === 'number' && b.duration > 10
    ? b.duration
    : (typeof (b as any)?.durationMs === 'number' && (b as any).durationMs > 10000 ? Math.round((b as any).durationMs / 1000) : 0);

  if (durA > 0 && durB > 0) {
    if (Math.abs(durA - durB) > 8) {
      return false; // Genuinely different recordings/edits
    }
  }

  return true;
}
