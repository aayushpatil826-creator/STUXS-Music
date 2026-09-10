import type { ProviderType, Track } from '../types/music';

// --- Provider Trust Weights (Official Studio Master vs Indie/User-Generated) ---
export const PROVIDER_TRUST_WEIGHTS: Record<ProviderType, number> = {
  jiosaavn: 120,   // Official studio master catalog (verified 320kbps)
  gaana: 120,      // Official studio master catalog
  stuxs: 120,      // First-party verified STUXS studio catalog
  local: 110,      // User's own library/M3U files
  spotify: 80,     // Official Spotify metadata
  amazon: 80,      // Official Amazon metadata
  itunes: 40,      // iTunes 30-second preview catalog
};

// --- Derivative & Non-Original Version Indicators ---
export const DERIVATIVE_TERMS = [
  'cover',
  'remix',
  'mashup',
  '8d audio',
  '8d',
  'slowed',
  'reverb',
  'lo-fi',
  'lofi',
  'tribute',
  'karaoke',
  'instrumental',
  'unofficial',
  'fan made',
  'fan-made',
  'bootleg',
  'edit',
  'tiktok',
  'acoustic',
  'live',
] as const;

// Common query filler words in music searches
const FILLER_WORDS = new Set([
  'song',
  'songs',
  'music',
  'audio',
  'track',
  'tracks',
  'official',
  'video',
  'full',
  'the',
  'by',
  'feat',
  'ft',
  'in',
  'of',
  'a',
  'an',
]);

/**
 * Strips diacritics, special symbols, and converts to lower case.
 */
export function cleanText(text: string): string {
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
 * Normalizes Indian and global phonetics / transliteration equivalences
 * (e.g. aa <-> a, ee <-> i, oo <-> u, bh <-> b, dh <-> d, jh <-> j, sh <-> s, w <-> v).
 */
export function normalizeTransliteration(text: string): string {
  if (!text) return '';
  return cleanText(text)
    .replace(/aa+/g, 'a')
    .replace(/ee+/g, 'i')
    .replace(/oo+/g, 'u')
    .replace(/ii+/g, 'i')
    .replace(/uu+/g, 'u')
    .replace(/bh/g, 'b')
    .replace(/dh/g, 'd')
    .replace(/jh/g, 'j')
    .replace(/th/g, 't')
    .replace(/kh/g, 'k')
    .replace(/gh/g, 'g')
    .replace(/ph/g, 'f')
    .replace(/sh/g, 's')
    .replace(/ch/g, 'c')
    .replace(/rh/g, 'r')
    .replace(/wh/g, 'w')
    .replace(/zh/g, 'z')
    .replace(/w/g, 'v')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extracts consonant-only skeleton for robust phonetic matching of transliterated names.
 */
export function getConsonantSkeleton(text: string): string {
  return normalizeTransliteration(text).replace(/[aeiou\s]/g, '');
}

/**
 * Tokenizes text into individual clean words.
 */
export function tokenizeText(text: string): string[] {
  const cleaned = cleanText(text);
  if (!cleaned) return [];
  return cleaned.split(' ').filter(Boolean);
}

export interface NormalizedQuery {
  raw: string;
  clean: string;
  transliterated: string;
  consonantSkeleton: string;
  tokens: string[];
  meaningfulTokens: string[];
  intentTerms: Set<string>;
}

/**
 * Normalizes user search input and extracts phonetic representations and intent.
 */
export function normalizeSearchQuery(query: string): NormalizedQuery {
  const raw = query || '';
  const clean = cleanText(raw);
  const transliterated = normalizeTransliteration(raw);
  const consonantSkeleton = getConsonantSkeleton(raw);
  const tokens = tokenizeText(clean);

  const intentTerms = new Set<string>();
  for (const term of DERIVATIVE_TERMS) {
    if (clean.includes(term)) {
      intentTerms.add(term);
    }
  }

  const meaningful = tokens.filter((t) => !FILLER_WORDS.has(t) || tokens.length <= 2);
  const meaningfulTokens = meaningful.length > 0 ? meaningful : tokens;

  return {
    raw,
    clean,
    transliterated,
    consonantSkeleton,
    tokens,
    meaningfulTokens,
    intentTerms,
  };
}

/**
 * Fast Levenshtein distance between two strings.
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const row = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    let prev = i;
    for (let j = 1; j <= b.length; j++) {
      const val = a[i - 1] === b[j - 1] ? row[j - 1] : Math.min(row[j - 1], prev, row[j]) + 1;
      row[j - 1] = prev;
      prev = val;
    }
    row[b.length] = prev;
  }

  return row[b.length];
}

/**
 * Jaro-Winkler typo-tolerant similarity metric (0.0 to 1.0).
 */
export function jaroWinkler(s1: string, s2: string): number {
  if (s1 === s2) return 1.0;
  if (!s1.length || !s2.length) return 0.0;

  const matchDistance = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
  const s1Matches = new Array(s1.length).fill(false);
  const s2Matches = new Array(s2.length).fill(false);

  let matches = 0;
  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, s2.length);

    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0.0;

  let k = 0;
  let transpositions = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  const jaro =
    (matches / s1.length + matches / s2.length + (matches - transpositions / 2) / matches) / 3.0;

  // Winkler prefix boost (up to 4 matching initial chars)
  let prefix = 0;
  for (let i = 0; i < Math.min(4, Math.min(s1.length, s2.length)); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }

  return jaro + prefix * 0.1 * (1.0 - jaro);
}

/**
 * Fast Damerau-Levenshtein distance (handles insertions, deletions, substitutions, and adjacent transpositions).
 */
export function damerauLevenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const la = a.length;
  const lb = b.length;
  const d: number[][] = [];

  for (let i = 0; i <= la; i++) {
    d[i] = [];
    d[i][0] = i;
  }
  for (let j = 0; j <= lb; j++) {
    d[0][j] = j;
  }

  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,      // deletion
        d[i][j - 1] + 1,      // insertion
        d[i - 1][j - 1] + cost // substitution
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1); // transposition
      }
    }
  }

  return d[la][lb];
}

/**
 * Bigram Dice similarity metric (0.0 to 1.0) for token & character similarity.
 */
export function bigramDiceSimilarity(s1: string, s2: string): number {
  if (s1 === s2) return 1.0;
  if (s1.length < 2 || s2.length < 2) return s1 === s2 ? 1.0 : 0.0;

  const bigrams1 = new Map<string, number>();
  for (let i = 0; i < s1.length - 1; i++) {
    const bigram = s1.substring(i, i + 2);
    bigrams1.set(bigram, (bigrams1.get(bigram) || 0) + 1);
  }

  let intersection = 0;
  for (let i = 0; i < s2.length - 1; i++) {
    const bigram = s2.substring(i, i + 2);
    const count = bigrams1.get(bigram) || 0;
    if (count > 0) {
      bigrams1.set(bigram, count - 1);
      intersection++;
    }
  }

  return (2.0 * intersection) / (s1.length - 1 + s2.length - 1);
}

/**
 * Comprehensive fuzzy similarity combining Damerau-Levenshtein, Jaro-Winkler, Bigram Dice, and Phonetics.
 */
export function fuzzySimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const cleanA = cleanText(a);
  const cleanB = cleanText(b);
  if (cleanA === cleanB) return 1;

  const maxLen = Math.max(cleanA.length, cleanB.length);
  if (maxLen === 0) return 1;

  const damDist = damerauLevenshtein(cleanA, cleanB);
  const damSim = Math.max(0, 1 - damDist / maxLen);
  const jwSim = jaroWinkler(cleanA, cleanB);
  const diceSim = bigramDiceSimilarity(cleanA, cleanB);

  // Transliteration / Phonetic match
  const aTrans = normalizeTransliteration(cleanA);
  const bTrans = normalizeTransliteration(cleanB);
  const transDist = damerauLevenshtein(aTrans, bTrans);
  const transSim = Math.max(0, 1 - transDist / Math.max(aTrans.length, bTrans.length, 1));

  // Consonant skeleton match - only valid when consonant skeletons have similar length and edit distance <= 1
  const aSkel = getConsonantSkeleton(cleanA);
  const bSkel = getConsonantSkeleton(cleanB);
  let skelSim = 0;
  if (aSkel.length >= 3 && bSkel.length >= 3 && Math.abs(aSkel.length - bSkel.length) <= 1) {
    const skelDist = damerauLevenshtein(aSkel, bSkel);
    if (skelDist <= 1) {
      skelSim = Math.max(0, 1 - skelDist / Math.max(aSkel.length, bSkel.length, 1));
    }
  }

  return Math.max(damSim, jwSim, diceSim, transSim, skelSim);
}

/**
 * Checks if query token is an approximate/fuzzy match for candidate token.
 */
export function isFuzzyMatch(queryToken: string, candidateToken: string): boolean {
  if (queryToken === candidateToken) return true;
  if (candidateToken.startsWith(queryToken)) return true;

  const lenDiff = Math.abs(queryToken.length - candidateToken.length);
  if (lenDiff >= 3) return false;

  const maxLen = Math.max(queryToken.length, candidateToken.length);
  if (maxLen <= 2) return false;

  const damDist = damerauLevenshtein(queryToken, candidateToken);
  const maxAllowedDist = maxLen <= 5 ? 1 : 2;
  if (damDist <= maxAllowedDist) return true;

  const sim = fuzzySimilarity(queryToken, candidateToken);
  return sim >= 0.80 && damDist <= 2;
}

// Common typo lookup dictionary for fast music searches
const COMMON_TYPO_MAP: Record<string, string> = {
  'beliver': 'believer',
  'lighs': 'lights',
  'ligths': 'lights',
  'blnding': 'blinding',
  'blind lights': 'blinding lights',
  'blinding ligths': 'blinding lights',
  'blnding lights': 'blinding lights',
  'yu': 'you',
  'youu': 'you',
  'shape you': 'shape of you',
  'shape of youu': 'shape of you',
  'kesriya': 'kesariya',
  'kesariyaa': 'kesariya',
  'arjit': 'arijit',
  'arjit sing': 'arijit singh',
  'arjit singh': 'arijit singh',
  'arijit sing': 'arijit singh',
  'tumhi ho': 'tum hi ho',
  'tumhiho': 'tum hi ho',
  'tumhi': 'tum hi',
  'apna bana le': 'apna bana le',
  'apnabanale': 'apna bana le',
  'imagine dragon': 'imagine dragons',
  'the weekend': 'the weeknd',
  'weeknd': 'the weeknd',
  'weekend': 'the weeknd',
  'ed sheran': 'ed sheeran',
  'shearan': 'sheeran',
  'taylr swift': 'taylor swift',
  'taylor swif': 'taylor swift',
  'dua lip': 'dua lipa',
  'samja': 'samjhawan',
  'samjawa': 'samjhawan',
  'samjawan': 'samjhawan',
  'samjavan': 'samjhawan',
  'samjhawa': 'samjhawan',
  'samjhawan': 'samjhawan',
  'channa mereya': 'channa mereya',
  'chana mereya': 'channa mereya',
  'raatan lambiyan': 'raataan lambiyan',
  'raataan lambiyaan': 'raataan lambiyan',
  'shubharambh': 'shubhaarambh',
  'shubh arambh': 'shubhaarambh',
  'shubhaaramb': 'shubhaarambh',
  'pasuri': 'pasoori',
  'kahani sunoo': 'kahani suno',
  'o mahi': 'o maahi',
};

/**
 * Generates safe, high-confidence query variants for Indian and global transliterations,
 * typos, vowel insertions/omissions, prefix roots, and character transpositions.
 */
export function generateQueryVariants(query: string): string[] {
  const clean = cleanText(query);
  if (!clean || clean.length < 2) return [];

  const variants = new Set<string>();

  // 0. Direct dictionary mapping
  if (COMMON_TYPO_MAP[clean]) {
    variants.add(COMMON_TYPO_MAP[clean]);
  }

  const tokens = clean.split(' ').filter(Boolean);

  // Map individual token typos (e.g. "blinding lighs" -> "blinding lights", "shape of yu" -> "shape of you")
  const correctedTokens = tokens.map((t) => COMMON_TYPO_MAP[t] || t);
  const correctedPhrase = correctedTokens.join(' ');
  if (correctedPhrase !== clean) {
    variants.add(correctedPhrase);
  }

  // 1. Core query without filler words (e.g. "dagduseth song" -> "dagduseth", "samjhawan songs" -> "samjhawan")
  const nonFillerTokens = tokens.filter((t) => !FILLER_WORDS.has(t));
  if (nonFillerTokens.length > 0 && nonFillerTokens.length < tokens.length) {
    const corePhrase = nonFillerTokens.join(' ');
    if (corePhrase.length >= 2) {
      variants.add(corePhrase);
    }
  }

  // 1b. Indic vowel syncope / transliteration alternations (e.g. ganapati <-> ganpati)
  if (clean.includes('ganapati')) {
    variants.add(clean.replace(/ganapati/g, 'ganpati'));
  } else if (clean.includes('ganpati')) {
    variants.add(clean.replace(/ganpati/g, 'ganapati'));
  }

  // 2. Spacing / concatenation variants (e.g. "dagdu sheth" <-> "dagdusheth", "tum hi ho" <-> "tumhiho")
  if (tokens.length === 2) {
    variants.add(tokens.join(''));
  } else if (!clean.includes(' ') && clean.length >= 6) {
    const splitPoints = ['sheth', 'seth', 'kumar', 'singh', 'devi', 'nath', 'bappa', 'ganpati'];
    for (const sp of splitPoints) {
      if (clean.endsWith(sp) && clean.length > sp.length + 2) {
        variants.add(`${clean.slice(0, clean.length - sp.length)} ${sp}`);
      }
    }
  }

  // 3. Indian s <-> sh phonetic transliteration equivalence (e.g. dagduseth <-> dagdusheth)
  if (clean.includes('sh')) {
    variants.add(clean.replace(/sh/g, 's'));
  } else if (clean.includes('s')) {
    variants.add(clean.replace(/s/g, 'sh'));
  }

  // 4. Indian compound root vowel variations (e.g. dagadusheth <-> dagdusheth)
  if (clean.includes('dusheth')) {
    variants.add(clean.replace('dusheth', 'adusheth'));
  } else if (clean.includes('adusheth')) {
    variants.add(clean.replace('adusheth', 'dusheth'));
  }
  if (clean.includes('duseth')) {
    variants.add(clean.replace('duseth', 'aduseth'));
  } else if (clean.includes('aduseth')) {
    variants.add(clean.replace('aduseth', 'duseth'));
  }

  // 5. Vowel insertion / expansion (e.g. beliv -> believ, kesr -> kesar, arji -> ariji, jikde <-> jikade)
  const expandedTokens = tokens.map((tok) => {
    if (tok === 'beliver') return 'believer';
    if (tok === 'lighs' || tok === 'ligths') return 'lights';
    if (tok === 'kesriya' || tok === 'kesariyaa') return 'kesariya';
    if (tok === 'arjit') return 'arijit';
    if (tok === 'yu' || tok === 'youu') return 'you';
    if (tok === 'samjawan' || tok === 'samjavan' || tok === 'samjawa') return 'samjhawan';
    if (tok === 'dagduseth' || tok === 'dagdu' || tok === 'dagdusheth') return 'dagdusheth';
    if (tok.length >= 4 && !tok.includes('a') && tok.includes('k')) {
      return tok.replace(/k/g, 'ka');
    }
    if (tok.length >= 4 && tok.includes('kd')) {
      return tok.replace(/kd/g, 'kad');
    }
    return tok;
  });
  const expandedPhrase = expandedTokens.join(' ');
  if (expandedPhrase !== clean) variants.add(expandedPhrase);

  // 6. Prefix roots for tokens with length >= 4 (allows matching "Believer" from "beliv", "Lights" from "ligh")
  for (const t of tokens) {
    if (t.length >= 4) {
      variants.add(t.slice(0, t.length - 1));
      variants.add(t.slice(0, 4));
    }
  }

  // 7. Indian ending variants: 'am' <-> 'ambh' / 'aambh'
  if (clean.endsWith('am')) {
    variants.add(clean.slice(0, -2) + 'ambh');
    variants.add(clean.slice(0, -2) + 'aambh');
  } else if (clean.endsWith('ambh')) {
    variants.add(clean.slice(0, -4) + 'am');
  }

  // 8. Vowel elongation / reduction
  const withAa = clean.replace(/a/g, 'aa');
  if (withAa !== clean && withAa.length <= clean.length + 3) variants.add(withAa);

  const reducedVowels = clean
    .replace(/aa+/g, 'a')
    .replace(/ee+/g, 'i')
    .replace(/oo+/g, 'u');
  if (reducedVowels !== clean) variants.add(reducedVowels);

  // 9. Aspiration / Deaspiration
  const deaspirated = clean
    .replace(/bh/g, 'b')
    .replace(/dh/g, 'd')
    .replace(/th/g, 't')
    .replace(/kh/g, 'k')
    .replace(/gh/g, 'g')
    .replace(/jh/g, 'j');
  if (deaspirated !== clean) variants.add(deaspirated);

  // 10. Indian phonetic 'w' <-> 'v' interchange (e.g. samjhawan <-> samjhavan, hawa <-> hava)
  if (clean.includes('w')) {
    variants.add(clean.replace(/w/g, 'v'));
  } else if (clean.includes('v')) {
    variants.add(clean.replace(/v/g, 'w'));
  }

  variants.delete(clean);
  return Array.from(variants).filter((v) => v && v.length >= 2).slice(0, 10);
}

/**
 * Extracts version classification (original, remix, lofi, cover, etc.)
 */
export function getVersionType(title: string): string {
  const clean = cleanText(title);
  for (const term of DERIVATIVE_TERMS) {
    if (clean.includes(term)) {
      return term;
    }
  }
  return 'original';
}

/**
 * Intelligent Relevance Scoring Engine for Tracks (STUXS Search 2.0).
 * Ranking Priority:
 * A. Exact title match (+400)
 * B. Exact title prefix match (+280)
 * C. Title contains query (+200)
 * D. Fuzzy title match (+180 * similarity)
 * E. Exact artist match (+200)
 * F. Artist prefix / contains match (+140 / +100)
 * G. Fuzzy artist match (+90 * similarity)
 * H. Cross-Field Synergy Bonus (+220 when tokens span Title AND Artist)
 * I. Canonical Original Version Boost (+120)
 * J. Album & Genre match (+70 / +35)
 * K. Safe Popularity signal boost (up to +40)
 * L. Unsolicited derivative penalty (-150)
 */
export function scoreTrack(track: Track, queryContext: NormalizedQuery | string): number {
  const nq = typeof queryContext === 'string' ? normalizeSearchQuery(queryContext) : queryContext;
  if (!nq.clean) return 0;

  const cleanTitle = cleanText(track.title);
  const cleanArtist = cleanText(track.artistName);
  const cleanAlbum = cleanText(track.albumTitle || '');
  const cleanGenre = cleanText(track.genre || '');
  const cleanLanguage = cleanText(track.language || '');
  const cleanLabel = cleanText(track.label || '');
  const cleanSingers = cleanText(track.singers || '');
  const cleanMusicDirector = cleanText(track.musicDirector || '');
  const searchAliases = (track.searchAliases || []).map((a) => cleanText(a)).filter(Boolean);

  const transTitle = normalizeTransliteration(cleanTitle);
  const transArtist = normalizeTransliteration(cleanArtist);
  const transAlbum = normalizeTransliteration(cleanAlbum);
  const transLabel = normalizeTransliteration(cleanLabel);

  const titleTokens = tokenizeText(cleanTitle);
  const artistTokens = tokenizeText(cleanArtist);
  const albumTokens = tokenizeText(cleanAlbum);
  const labelTokens = tokenizeText(cleanLabel);

  // 1. Base Score by Provider Trust
  let score = PROVIDER_TRUST_WEIGHTS[track.provider] ?? 50;

  // 2. Strict Title Relevance Hierarchy
  const titleFuzzySim = fuzzySimilarity(cleanTitle, nq.clean);
  const transTitleSim = fuzzySimilarity(transTitle, nq.transliterated);
  const bestTitleSim = Math.max(titleFuzzySim, transTitleSim);

  if (cleanTitle === nq.clean || transTitle === nq.transliterated) {
    score += 400; // Rank A: Exact title match
  } else if (cleanTitle.startsWith(nq.clean) || transTitle.startsWith(nq.transliterated)) {
    score += 280; // Rank B: Exact title prefix match
  } else if (cleanTitle.includes(nq.clean) || transTitle.includes(nq.transliterated)) {
    score += 200; // Rank C: Title contains query
  } else if (bestTitleSim >= 0.75) {
    score += Math.round(180 * bestTitleSim); // Rank D: Strong fuzzy title match
  } else if (bestTitleSim >= 0.60) {
    score += Math.round(130 * bestTitleSim); // Rank D2: Moderate typo/fuzzy title match
  }

  // 3. Artist Relevance (Rank E, F, G)
  const artistFuzzySim = fuzzySimilarity(cleanArtist, nq.clean);
  if (cleanArtist === nq.clean || transArtist === nq.transliterated) {
    score += 200; // Rank E: Exact artist match
  } else if (cleanArtist.startsWith(nq.clean) || transArtist.startsWith(nq.transliterated)) {
    score += 140; // Rank F: Artist prefix
  } else if (cleanArtist.includes(nq.clean) || transArtist.includes(nq.transliterated)) {
    score += 100; // Rank F2: Artist contains
  } else if (artistFuzzySim >= 0.70) {
    score += Math.round(90 * artistFuzzySim); // Rank G: Fuzzy artist match
  }

  // 4. Album Match (Rank H)
  if (cleanAlbum && nq.clean.length >= 3) {
    if (cleanAlbum === nq.clean || transAlbum === nq.transliterated) {
      score += 70;
    } else if (cleanAlbum.includes(nq.clean) || transAlbum.includes(nq.transliterated)) {
      score += 50;
    }
  }

  // 4b. Provider-Supported Related Metadata Matching (Record Label, Trust, Publisher, Search Aliases)
  let metadataMatched = false;
  if (cleanLabel && nq.clean.length >= 3) {
    for (const lTok of labelTokens) {
      if (lTok === nq.clean || normalizeTransliteration(lTok) === nq.transliterated) {
        score += 280; // Exact provider metadata relationship (e.g. Trust / Record Label match)
        metadataMatched = true;
        break;
      } else if (getConsonantSkeleton(lTok) === nq.consonantSkeleton && nq.consonantSkeleton.length >= 3) {
        score += 280; // Exact phonetic consonant skeleton match (e.g. dagadusheth <-> dagduseth)
        metadataMatched = true;
        break;
      } else if (isFuzzyMatch(nq.clean, lTok)) {
        score += 200;
        metadataMatched = true;
        break;
      }
    }
    if (!metadataMatched && (cleanLabel.includes(nq.clean) || transLabel.includes(nq.transliterated))) {
      score += 240;
      metadataMatched = true;
    }
  }

  for (const alias of searchAliases) {
    if (alias === nq.clean || normalizeTransliteration(alias) === nq.transliterated) {
      score += 260;
      metadataMatched = true;
      break;
    } else if (alias.includes(nq.clean) || normalizeTransliteration(alias).includes(nq.transliterated)) {
      score += 200;
      metadataMatched = true;
      break;
    }
  }

  if (cleanSingers && (cleanSingers.includes(nq.clean) || normalizeTransliteration(cleanSingers).includes(nq.transliterated))) {
    score += 160;
  }
  if (cleanMusicDirector && (cleanMusicDirector.includes(nq.clean) || normalizeTransliteration(cleanMusicDirector).includes(nq.transliterated))) {
    score += 140;
  }

  // 5. Genre / Language Metadata Match (Rank I)
  if (cleanGenre && cleanGenre.includes(nq.clean)) {
    score += 35;
  }
  if (cleanLanguage && cleanLanguage.includes(nq.clean)) {
    score += 35;
  }

  // 6. Multi-Token & Cross-Field Matching (Title + Artist + Album + Label)
  let matchedTokensCount = 0;
  let titleTokensMatched = 0;
  let artistTokensMatched = 0;
  let albumTokensMatched = 0;
  let labelTokensMatched = 0;

  for (const qToken of nq.meaningfulTokens) {
    let tokenMatchedInTrack = false;
    const qTrans = normalizeTransliteration(qToken);
    const qSkel = getConsonantSkeleton(qToken);

    // Check Title
    if (titleTokens.includes(qToken) || titleTokens.some((t) => normalizeTransliteration(t) === qTrans)) {
      score += 60;
      titleTokensMatched++;
      tokenMatchedInTrack = true;
    } else if (titleTokens.some((t) => t.startsWith(qToken) || normalizeTransliteration(t).startsWith(qTrans))) {
      score += 40;
      titleTokensMatched++;
      tokenMatchedInTrack = true;
    } else if (titleTokens.some((t) => isFuzzyMatch(qToken, t))) {
      score += 32;
      titleTokensMatched++;
      tokenMatchedInTrack = true;
    }

    // Check Artist
    if (artistTokens.includes(qToken) || artistTokens.some((t) => normalizeTransliteration(t) === qTrans)) {
      score += 60;
      artistTokensMatched++;
      tokenMatchedInTrack = true;
    } else if (artistTokens.some((t) => t.startsWith(qToken) || normalizeTransliteration(t).startsWith(qTrans))) {
      score += 40;
      artistTokensMatched++;
      tokenMatchedInTrack = true;
    } else if (artistTokens.some((t) => isFuzzyMatch(qToken, t))) {
      score += 32;
      artistTokensMatched++;
      tokenMatchedInTrack = true;
    }

    // Check Album
    if (albumTokens.includes(qToken)) {
      score += 25;
      albumTokensMatched++;
      tokenMatchedInTrack = true;
    } else if (albumTokens.some((t) => isFuzzyMatch(qToken, t))) {
      score += 18;
      albumTokensMatched++;
      tokenMatchedInTrack = true;
    }

    // Check Label / Provider Search Aliases
    if (
      labelTokens.includes(qToken) ||
      labelTokens.some((t) => normalizeTransliteration(t) === qTrans || (qSkel.length >= 3 && getConsonantSkeleton(t) === qSkel))
    ) {
      score += 60;
      labelTokensMatched++;
      tokenMatchedInTrack = true;
    } else if (labelTokens.some((t) => isFuzzyMatch(qToken, t))) {
      score += 32;
      labelTokensMatched++;
      tokenMatchedInTrack = true;
    }

    if (tokenMatchedInTrack) {
      matchedTokensCount++;
    }
  }

  // Cross-Field Synergy Bonus: When query tokens span Title/Album/Label AND Artist
  // E.g. "weeknd blinding", "shape ed sheeran", "ganpati sonu nigam", "bappa morya sonu", "dagduseth sonu nigam"
  if ((titleTokensMatched > 0 || albumTokensMatched > 0 || labelTokensMatched > 0) && artistTokensMatched > 0) {
    score += 240;
  }

  // Pure Solo Artist Match Bonus
  if (artistTokensMatched >= 2 && artistTokens.length === artistTokensMatched) {
    score += 70;
  }

  // Full coverage bonus if ALL query tokens are found
  if (nq.meaningfulTokens.length > 1 && matchedTokensCount === nq.meaningfulTokens.length) {
    score += 100;
  }

  // 7. Canonical / Original Song Priority & Derivative Penalty
  const isDerivativeTrack = DERIVATIVE_TERMS.some((term) => {
    const regex = new RegExp(`\\b${term}\\b|[\\(\\[\\-_]${term}[\\)\\]\\-_]?`, 'i');
    return regex.test(track.title);
  });

  if (!isDerivativeTrack) {
    // Canonical / Original song boost
    score += 120;
    if (!cleanTitle.includes('with') && !cleanTitle.includes('feat') && !cleanTitle.includes('duet')) {
      score += 25;
    }
  } else {
    // Derivative track (remix, acoustic, live, cover, sped up, slowed)
    let matchedIntent = false;
    for (const intent of nq.intentTerms) {
      if (cleanTitle.includes(intent) || cleanArtist.includes(intent)) {
        score += 160; // Requested Intent Boost!
        matchedIntent = true;
      }
    }
    if (!matchedIntent) {
      score -= 150; // Unsolicited derivative penalty
    }
  }

  // 9. Safe Popularity Signal Boost (Up to +50, relevance remains dominant)
  const playCount = (track as any).play_count || (track as any).playCount || 0;
  const favCount = (track as any).favorite_count || (track as any).likesCount || 0;
  const totalPopularity = playCount + favCount * 2;
  if (totalPopularity > 0) {
    score += Math.min(50, Math.round(Math.log10(totalPopularity + 1) * 10));
  }

  // 10. Stream Availability Priority
  if (track.accessStatus === 'blocked' || track.isPlayable === false) {
    score -= 180; // Penalty for unavailable tracks
  } else {
    score += 60;  // Boost for playable audio stream
  }

  return score;
}

/**
 * Deduplicates search results to prevent duplicate entries of the exact same track
 * within a provider from flooding results, while strictly preserving distinct provider
 * recordings and different recording edits (different durations/albums).
 */
export function deduplicateTracks(tracks: Track[], nq: NormalizedQuery): Track[] {
  const seenSignatures = new Map<string, Track>();
  const output: Track[] = [];

  for (const track of tracks) {
    const titleWithoutParens = (track.title || '')
      .replace(/\s*[\(\[].*?[\)\]]/g, '')
      .trim();
    const cTitle = cleanText(titleWithoutParens || track.title);

    // Primary artist (first artist in list)
    const cArtist = cleanText(track.artistName).split(',')[0].trim();
    const version = getVersionType(track.title);

    // Canonical track signature across all providers: Title + Artist + Version
    const signature = `${cTitle}::${cArtist}::${version}`;

    if (!seenSignatures.has(signature)) {
      seenSignatures.set(signature, track);
      output.push(track);
    } else {
      const existing = seenSignatures.get(signature)!;
      const isExistingBlocked = existing.accessStatus === 'blocked' || existing.isPlayable === false;
      const isCurrentBlocked = track.accessStatus === 'blocked' || track.isPlayable === false;

      // RULE 1: Playable stream ALWAYS supersedes an unavailable track
      if (isExistingBlocked && !isCurrentBlocked) {
        const index = output.indexOf(existing);
        if (index !== -1) {
          output[index] = track;
          seenSignatures.set(signature, track);
        }
        continue;
      }

      // RULE 2: Unavailable track never overwrites an existing playable stream
      if (!isExistingBlocked && isCurrentBlocked) {
        continue;
      }

      // Preserve downloaded/offline flag if either version is downloaded
      if (track.isDownloaded || track.sourceType === 'downloaded') {
        existing.isDownloaded = true;
        existing.sourceType = 'downloaded';
      }

      const existingScore = scoreTrack(existing, nq);
      const currentScore = scoreTrack(track, nq);

      // If current track is higher quality/score, replace the duplicate entry
      if (currentScore > existingScore) {
        const index = output.indexOf(existing);
        if (index !== -1) {
          if (existing.isDownloaded) {
            track.isDownloaded = true;
            track.sourceType = 'downloaded';
          }
          output[index] = track;
          seenSignatures.set(signature, track);
        }
      }
    }
  }

  return output;
}
