import type { Track } from '../types/music';
import { providerRegistry } from '../providers/ProviderRegistry';
import {
  cleanText,
  fuzzySimilarity,
} from '../utils/searchIntelligence';

export type MoodType =
  | 'ROMANTIC'
  | 'LOVE'
  | 'EMOTIONAL'
  | 'SAD'
  | 'MELANCHOLIC'
  | 'CALM'
  | 'CHILL'
  | 'PEACEFUL'
  | 'HAPPY'
  | 'UPBEAT'
  | 'ENERGETIC'
  | 'PARTY'
  | 'DANCE'
  | 'DEVOTIONAL'
  | 'SPIRITUAL'
  | 'FESTIVE'
  | 'MOTIVATIONAL'
  | 'DREAMY'
  | 'NOSTALGIC'
  | 'DARK'
  | 'INTENSE'
  | 'FOCUS'
  | 'ACOUSTIC'
  | 'LOFI'
  | 'ROCK';

export interface MoodProfile {
  primaryMood: MoodType;
  secondaryMoods: MoodType[];
  energy: number; // 0 (calm/soft/acoustic) to 100 (high energy/party/rock/festive)
  valence: number; // 0 (melancholic/sad) to 100 (happy/celebratory)
  danceability: number; // 0 to 100
  acousticness: number; // 0 to 100
  tempoEstimate: number; // BPM estimate
  genre?: string[];
  language?: string;
}

export interface SmartQueueOptions {
  excludeIds?: Set<string>;
  limit?: number;
  forceRefresh?: boolean;
}

// Patterns that indicate compilation / playlist / category / multi-song spam results
const COMPILATION_TITLE_PATTERNS = [
  /\b(songs|song collection|best songs|top songs|latest songs|romantic songs|love songs)\b/i,
  /\b(playlist|mega mix|nonstop|non-stop|jukebox|audio jukebox|collection|greatest hits|full album)\b/i,
  /\b(album songs|all songs|music collection|compilation|video collection|mashup|dj mix|club mix collection)\b/i,
  /\b(top 50|top 10|top 20|top 100|vol\s*\d+|vol\.\s*\d+|disc\s*\d+|discography)\b/i,
  /\b(official playlist|latest bollywood songs|best of|all time hits|evergreen hits|superhit songs)\b/i,
  /\b(lyrical video|full video song|audio songs|video jukebox|audio track collection)\b/i,
  /\b(hit's mix|hits mix|dj\s+[a-z0-9]+|slowed\s*\+\s*reverb|8d audio|lo-fi mix|lofi mix)\b/i,
  /\|/, // Pipes '|' dividing multiple artists/songs
  /\barchives\b/i,
  /\bmoonbound\b/i,
];

// Suspicious / non-artist channels & accounts that upload compilations
const SUSPICIOUS_ARTIST_PATTERNS = [
  /^(latest songs|brand new songs|hits|music|various artists|various|official playlist|top songs|best songs)$/i,
  /^(compilation|bollywood songs|hindi songs|romantic songs|music series|songs|new songs)$/i,
  /^(dj remix|dj mix|remix hub|club records|chill tracks|lofi beats hub)$/i,
  /^(audio jukebox|music world|entertainment|records|official channel)$/i,
];

export class SmartQueueService {
  private static instance: SmartQueueService;
  private cache = new Map<string, Track[]>();
  private readonly MAX_CACHE_SIZE = 50;

  private constructor() {}

  public static getInstance(): SmartQueueService {
    if (!SmartQueueService.instance) {
      SmartQueueService.instance = new SmartQueueService();
    }
    return SmartQueueService.instance;
  }

  /**
   * Strictly validates whether a candidate track is an authentic, individual playable song.
   * Discards playlists, compilations, mixes, multi-song videos, preview clips, and fake artist channels.
   */
  public isValidSmartQueueTrack(track: Track): { valid: boolean; reason?: string } {
    if (!track || !track.id) {
      return { valid: false, reason: 'MISSING_ID_OR_DATA' };
    }

    const title = (track.title || '').trim();
    const artist = (track.artistName || '').trim();

    if (!title || title.length < 2) {
      return { valid: false, reason: 'EMPTY_TITLE' };
    }

    if (!artist || artist.length < 2) {
      return { valid: false, reason: 'EMPTY_ARTIST' };
    }

    // 1. Check title against compilation / multi-song patterns
    for (const pattern of COMPILATION_TITLE_PATTERNS) {
      if (pattern.test(title)) {
        return { valid: false, reason: `COMPILATION_TITLE_PATTERN: ${pattern}` };
      }
    }

    // 2. Reject excessively long titles (keyword spam)
    if (title.length > 70) {
      return { valid: false, reason: 'TITLE_TOO_LONG_SPAM' };
    }

    // 3. Reject suspicious compilation artist channels
    for (const pattern of SUSPICIOUS_ARTIST_PATTERNS) {
      if (pattern.test(artist)) {
        return { valid: false, reason: `SUSPICIOUS_ARTIST: ${artist}` };
      }
    }

    // 4. Stream playability validation
    if (track.isPreview || track.accessStatus === 'preview') {
      return { valid: false, reason: 'PREVIEW_ONLY_CLIP' };
    }

    if (track.accessStatus === 'blocked') {
      return { valid: false, reason: 'RIGHTS_BLOCKED' };
    }

    if (!track.audioUrl || track.audioUrl.trim().length === 0) {
      return { valid: false, reason: 'NO_PLAYABLE_AUDIO_STREAM' };
    }

    // 5. Duration sanity check
    // Real songs are typically 60s to 600s (10 min). Rejects 30s clips & 1-3 hour DJ mixes/jukeboxes.
    if (track.duration && (track.duration < 45 || track.duration > 660)) {
      return { valid: false, reason: `INVALID_DURATION: ${track.duration}s` };
    }

    return { valid: true };
  }

  /**
   * Deeply analyzes metadata to derive an internal structured MoodProfile.
   * Understands Devotional, Festival, Marathi, Bollywood, Punjabi, Pop, Rock, Chill, and Sad vibes.
   */
  public analyzeMoodProfile(track: Track): MoodProfile {
    const rawArtist = track.artistName || '';
    const rawTitle = track.title || '';
    const rawAlbum = track.albumTitle || '';
    const cleanT = cleanText(rawTitle).toLowerCase();
    const cleanA = cleanText(rawArtist).toLowerCase();
    const cleanAlb = cleanText(rawAlbum).toLowerCase();
    const fullText = `${cleanT} ${cleanA} ${cleanAlb}`;

    let language = track.language?.toLowerCase();
    if (!language) {
      if (
        fullText.includes('marathi') ||
        fullText.includes('bappa') ||
        fullText.includes('morya') ||
        fullText.includes('ganpati') ||
        fullText.includes('shrimant') ||
        fullText.includes('vitthal') ||
        fullText.includes('pandurang') ||
        fullText.includes('majha') ||
        fullText.includes('mumbaicha') ||
        fullText.includes('raja') ||
        fullText.includes('aala') ||
        fullText.includes('lalbaug') ||
        fullText.includes('chintamani')
      ) {
        language = 'marathi';
      } else if (
        fullText.includes('punjabi') ||
        fullText.includes('diljit') ||
        fullText.includes('sidhu') ||
        fullText.includes('karan aujla') ||
        fullText.includes('ap dhillon')
      ) {
        language = 'punjabi';
      } else if (
        fullText.includes('tamil') ||
        fullText.includes('telugu') ||
        fullText.includes('anirudh') ||
        fullText.includes('sid sriram')
      ) {
        language = 'south indian';
      } else if (
        fullText.includes('hindi') ||
        fullText.includes('arijit') ||
        fullText.includes('sonu nigam') ||
        fullText.includes('shreya') ||
        fullText.includes('pritam') ||
        fullText.includes('atif') ||
        fullText.includes('jubin') ||
        fullText.includes('bollywood')
      ) {
        language = 'hindi';
      } else {
        language = 'english';
      }
    }

    // 1. DEVOTIONAL / GANPATI / FESTIVE / BHAKTI
    if (
      fullText.includes('bhakti') ||
      fullText.includes('devotional') ||
      fullText.includes('ganpati') ||
      fullText.includes('bappa') ||
      fullText.includes('morya') ||
      fullText.includes('shrimant') ||
      fullText.includes('majha') ||
      fullText.includes('mumbaicha') ||
      fullText.includes('raja') ||
      fullText.includes('aala') ||
      fullText.includes('lalbaug') ||
      fullText.includes('chintamani') ||
      fullText.includes('girgaon') ||
      fullText.includes('dhol') ||
      fullText.includes('tasha') ||
      fullText.includes('pathak') ||
      fullText.includes('utsav') ||
      fullText.includes('visarjan') ||
      fullText.includes('mahadev') ||
      fullText.includes('krishna') ||
      fullText.includes('ram') ||
      fullText.includes('aarti') ||
      fullText.includes('chalisa') ||
      fullText.includes('bhajan') ||
      fullText.includes('stotram') ||
      fullText.includes('om') ||
      fullText.includes('shiv') ||
      fullText.includes('hanuman') ||
      fullText.includes('shankara') ||
      fullText.includes('deva') ||
      fullText.includes('pandurang') ||
      fullText.includes('vitthal') ||
      fullText.includes('sukhkarta') ||
      fullText.includes('sai') ||
      fullText.includes('durga') ||
      fullText.includes('mauli')
    ) {
      const isEnergeticFestival =
        fullText.includes('aala') ||
        fullText.includes('dhol') ||
        fullText.includes('tasha') ||
        fullText.includes('utsav') ||
        fullText.includes('visarjan') ||
        fullText.includes('raja') ||
        fullText.includes('mumbaicha');

      return {
        primaryMood: 'DEVOTIONAL',
        secondaryMoods: isEnergeticFestival
          ? ['FESTIVE', 'ENERGETIC', 'SPIRITUAL']
          : ['SPIRITUAL', 'PEACEFUL', 'EMOTIONAL'],
        energy: isEnergeticFestival ? 78 : 50,
        valence: 80,
        danceability: isEnergeticFestival ? 70 : 35,
        acousticness: 60,
        tempoEstimate: isEnergeticFestival ? 115 : 90,
        language,
        genre: ['Devotional', 'Marathi Bhakti', 'Festival'],
      };
    }

    // 2. SAD / MELANCHOLIC / HEARTBREAK
    if (
      fullText.includes('sad') ||
      fullText.includes('broken') ||
      fullText.includes('alone') ||
      fullText.includes('cry') ||
      fullText.includes('crying') ||
      fullText.includes('heartbreak') ||
      fullText.includes('judai') ||
      fullText.includes('judaai') ||
      fullText.includes('bewafa') ||
      fullText.includes('dard') ||
      fullText.includes('channa mereya') ||
      fullText.includes('agar tum saath ho') ||
      fullText.includes('tujhe bhula diya') ||
      fullText.includes('hamari adhuri kahani') ||
      fullText.includes('let her go') ||
      fullText.includes('someone like you') ||
      fullText.includes('drivers license') ||
      fullText.includes('glimpse of us') ||
      fullText.includes('tanhaai') ||
      fullText.includes('alvida') ||
      fullText.includes('phir le aya dil') ||
      fullText.includes('lo safar')
    ) {
      return {
        primaryMood: 'SAD',
        secondaryMoods: ['MELANCHOLIC', 'EMOTIONAL', 'CALM'],
        energy: 25,
        valence: 20,
        danceability: 25,
        acousticness: 75,
        tempoEstimate: 72,
        language,
        genre: ['Acoustic', 'Ballad', 'Sad'],
      };
    }

    // 3. PARTY / DANCE / HIGH ENERGY
    if (
      fullText.includes('party') ||
      fullText.includes('dance') ||
      fullText.includes('club') ||
      fullText.includes('dj') ||
      fullText.includes('disco') ||
      fullText.includes('bhangra') ||
      fullText.includes('nacho') ||
      fullText.includes('thumka') ||
      fullText.includes('daru') ||
      fullText.includes('hookah') ||
      fullText.includes('tauba tauba') ||
      fullText.includes('kurchi madathapetti') ||
      fullText.includes('illuminate') ||
      fullText.includes('24k magic') ||
      fullText.includes('uptown funk') ||
      fullText.includes('dynamite') ||
      fullText.includes('levitating') ||
      fullText.includes('blinding lights') ||
      fullText.includes('dont start now') ||
      fullText.includes('starboy') ||
      fullText.includes('despacito') ||
      fullText.includes('kala chashma') ||
      fullText.includes('kar gayi chull') ||
      fullText.includes('london thumakda') ||
      fullText.includes('aankh marey') ||
      fullText.includes('sauda khara khara') ||
      fullText.includes('makhna') ||
      fullText.includes('ghungroo')
    ) {
      return {
        primaryMood: 'PARTY',
        secondaryMoods: ['DANCE', 'UPBEAT', 'ENERGETIC'],
        energy: 88,
        valence: 85,
        danceability: 90,
        acousticness: 15,
        tempoEstimate: 125,
        language,
        genre: ['Dance', 'Party', 'EDM', 'Pop'],
      };
    }

    // 4. MOTIVATIONAL / ROCK / INTENSE
    if (
      fullText.includes('rock') ||
      fullText.includes('metal') ||
      fullText.includes('gym') ||
      fullText.includes('workout') ||
      fullText.includes('intense') ||
      fullText.includes('kar har maidan fateh') ||
      fullText.includes('zinda') ||
      fullText.includes('believer') ||
      fullText.includes('eye of the tiger') ||
      fullText.includes('hall of fame') ||
      fullText.includes('unstoppable') ||
      fullText.includes('radioactive') ||
      fullText.includes('chak de') ||
      fullText.includes('sultan') ||
      fullText.includes('dangal') ||
      fullText.includes('aarambh hai prachand')
    ) {
      return {
        primaryMood: 'MOTIVATIONAL',
        secondaryMoods: ['INTENSE', 'ROCK', 'ENERGETIC'],
        energy: 88,
        valence: 75,
        danceability: 60,
        acousticness: 10,
        tempoEstimate: 130,
        language,
        genre: ['Rock', 'Motivational', 'Soundtrack'],
      };
    }

    // 5. CALM / CHILL / LOFI / PEACEFUL
    if (
      fullText.includes('chill') ||
      fullText.includes('calm') ||
      fullText.includes('peaceful') ||
      fullText.includes('sleep') ||
      fullText.includes('relax') ||
      fullText.includes('lo-fi') ||
      fullText.includes('lofi') ||
      fullText.includes('meditation') ||
      fullText.includes('ambient') ||
      fullText.includes('study') ||
      fullText.includes('rain') ||
      fullText.includes('breeze') ||
      fullText.includes('coffee') ||
      fullText.includes('sunset') ||
      fullText.includes('slowed')
    ) {
      return {
        primaryMood: 'CALM',
        secondaryMoods: ['CHILL', 'PEACEFUL', 'DREAMY', 'LOFI'],
        energy: 20,
        valence: 50,
        danceability: 35,
        acousticness: 85,
        tempoEstimate: 75,
        language,
        genre: ['Lo-Fi', 'Ambient', 'Chill'],
      };
    }

    // 6. ROMANTIC / SOFT / EMOTIONAL / LOVE (Default for melodic love ballads & pop songs)
    return {
      primaryMood: 'ROMANTIC',
      secondaryMoods: ['LOVE', 'EMOTIONAL', 'CALM', 'ACOUSTIC'],
      energy: 35,
      valence: 60,
      danceability: 45,
      acousticness: 65,
      tempoEstimate: 82,
      language,
      genre: ['Romantic', 'Ballad', 'Pop', 'Acoustic'],
    };
  }

  /**
   * Calculates the Transition Compatibility Score between the currently playing song
   * and a candidate track.
   * Priority: MOOD + ENERGY + VIBE >> ARTIST
   */
  public calculateTransitionScore(
    seedTrack: Track,
    seedProfile: MoodProfile,
    candidate: Track,
    recentArtists: string[] = []
  ): number {
    let score = 0;

    const candProfile = this.analyzeMoodProfile(candidate);
    const candTitleClean = cleanText(candidate.title);
    const candArtistClean = cleanText(candidate.artistName);
    const seedTitleClean = cleanText(seedTrack.title);
    const seedArtistClean = cleanText(seedTrack.artistName);

    // 1. Same Artist Match (+50)
    const isSameArtist =
      candArtistClean.includes(seedArtistClean) || seedArtistClean.includes(candArtistClean);
    if (isSameArtist) {
      score += 50;
    } else if (seedArtistClean.split(' ')[0] === candArtistClean.split(' ')[0]) {
      score += 30; // Similar artist style
    }

    // 2. Same Album Match (+40)
    const candAlbumClean = cleanText(candidate.albumTitle || '');
    const seedAlbumClean = cleanText(seedTrack.albumTitle || '');
    if (seedAlbumClean && candAlbumClean && (candAlbumClean === seedAlbumClean || candAlbumClean.includes(seedAlbumClean))) {
      score += 40;
    }

    // 3. Same Genre (+35) vs Incompatible Genre (-50)
    const candGenreClean = cleanText(candidate.genre || '');
    const seedGenreClean = cleanText(seedTrack.genre || '');
    if (seedGenreClean && candGenreClean) {
      if (candGenreClean.includes(seedGenreClean) || seedGenreClean.includes(candGenreClean)) {
        score += 35;
      } else {
        score -= 25;
      }
    }

    // 4. Same Language (+35) vs Incompatible Language (-50)
    if (seedTrack.language && candidate.language) {
      if (seedTrack.language.toLowerCase() === candidate.language.toLowerCase()) {
        score += 35;
      } else {
        score -= 50;
      }
    } else if (seedProfile.language && candProfile.language === seedProfile.language) {
      score += 25;
    }

    // 5. Similar Provider Metadata (+25)
    if (candidate.provider && seedTrack.provider && candidate.provider === seedTrack.provider) {
      score += 25;
    }

    // 6. Mood & Energy Alignment (+15)
    if (candProfile.primaryMood === seedProfile.primaryMood) {
      score += 15;
    }

    const energyDelta = Math.abs(seedProfile.energy - candProfile.energy);
    if (energyDelta <= 20) {
      score += Math.round(15 * (1 - energyDelta / 20));
    } else if (energyDelta > 45) {
      score -= 30;
    }

    // 7. Full Stream Availability Boost (+30)
    if (candidate.audioUrl && !candidate.isPreview && candidate.accessStatus === 'playable') {
      score += 30;
    }

    // 8. Deduplicate Exact Same Song / Duplicate Version (-300)
    const titleSim = fuzzySimilarity(candTitleClean, seedTitleClean);
    if (titleSim >= 0.88 && isSameArtist) {
      score -= 300;
    }

    // 9. Heavy penalty for repeating the same artist consecutively (>2 tracks)
    const consecutiveCount = recentArtists.filter((a) => a === candArtistClean).length;
    if (consecutiveCount >= 2) {
      score -= 75;
    }

    return score;
  }

  /**
   * Generates targeted mood, vibe, and style candidate searches based on the seed track.
   */
  private generateMoodSearches(track: Track, profile: MoodProfile): string[] {
    const queries: string[] = [];
    const lang = profile.language || '';
    const cleanT = cleanText(track.title).replace(/\(.*\)/g, '').trim();
    const seedArtistClean = cleanText(track.artistName || '').trim();

    // 1. Same Artist query (High relevance)
    if (seedArtistClean) {
      queries.push(seedArtistClean);
      if (seedArtistClean.includes('&') || seedArtistClean.includes(',')) {
        queries.push(seedArtistClean.split(/[,&/]/)[0].trim());
      }
    }

    // 2. Same Album & Artist query
    if (track.albumTitle && seedArtistClean) {
      queries.push(`${track.albumTitle} ${seedArtistClean}`.trim());
    }

    // 3. Same Genre & Language query
    if (track.genre && track.language) {
      queries.push(`${track.genre} ${track.language}`.trim());
    } else if (track.genre) {
      queries.push(track.genre.trim());
    }

    // 4. Targeted Mood / Vibe searches
    if (profile.primaryMood === 'DEVOTIONAL') {
      if (lang === 'marathi') {
        queries.push('Marathi devotional bhakti geete');
        queries.push('Marathi Ganpati festival songs');
      } else {
        queries.push('devotional bhakti bhajan');
        queries.push('spiritual morning aarti bhakti');
      }
    } else if (profile.primaryMood === 'ROMANTIC') {
      if (lang === 'marathi') {
        queries.push('marathi romantic songs');
      } else if (lang === 'hindi') {
        queries.push('romantic hindi songs');
        queries.push('soft romantic bollywood');
      } else if (lang === 'punjabi') {
        queries.push('punjabi romantic songs');
      } else {
        queries.push('soft pop romantic ballads');
      }
    } else if (profile.primaryMood === 'SAD') {
      if (lang === 'hindi') {
        queries.push('sad emotional hindi songs');
      } else {
        queries.push('sad emotional acoustic ballads');
      }
    } else if (profile.primaryMood === 'PARTY') {
      if (lang === 'hindi') {
        queries.push('bollywood party dance hits');
      } else if (lang === 'punjabi') {
        queries.push('punjabi bhangra party hits');
      } else {
        queries.push('dance pop upbeat hits');
      }
    } else if (profile.primaryMood === 'CALM') {
      queries.push('chill calm acoustic songs');
    } else if (profile.primaryMood === 'MOTIVATIONAL') {
      queries.push('motivational workout songs');
    }

    // 5. Track Title query
    queries.push(cleanT);

    return queries;
  }

  /**
   * Intelligently generates related tracks focusing on MOOD, VIBE, and ENERGY.
   * Enforces strict individual track validation and compilation filtering.
   */
  public async getRelatedTracks(
    currentTrack: Track,
    options: SmartQueueOptions = {}
  ): Promise<Track[]> {
    const { excludeIds = new Set<string>(), limit = 8, forceRefresh = false } = options;
    const cacheKey = `sq:vibe:${currentTrack.id || currentTrack.title}`;

    if (!forceRefresh && this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey)!;
      const filtered = cached.filter((t) => !excludeIds.has(t.id));
      if (filtered.length >= limit) {
        return filtered.slice(0, limit);
      }
    }

    const profile = this.analyzeMoodProfile(currentTrack);
    const moodQueries = this.generateMoodSearches(currentTrack, profile);

    // Search across providers in parallel
    const searchPromises = moodQueries.slice(0, 4).map((q) => providerRegistry.search(q));
    const searchResults = await Promise.allSettled(searchPromises);

    const rawCandidates: Track[] = [];
    for (const res of searchResults) {
      if (res.status === 'fulfilled' && res.value?.tracks) {
        rawCandidates.push(...res.value.tracks);
      }
    }

    // Filter, Validate Individual Track Integrity, Deduplicate, and Verify Playability
    const seenSignatures = new Set<string>();
    const eligibleTracks: { track: Track; score: number; artist: string }[] = [];

    const seedTitleClean = cleanText(currentTrack.title).replace(/\(.*\)/g, '').trim();
    const seedArtistClean = cleanText(currentTrack.artistName).split(',')[0].trim();
    const seedSignature = `${seedTitleClean}::${seedArtistClean}`;
    seenSignatures.add(seedSignature);

    const recentArtists: string[] = [];

    for (const track of rawCandidates) {
      if (!track || !track.id) continue;
      if (excludeIds.has(track.id) || track.id === currentTrack.id) continue;

      // STEP 1: Strict Individual Track Validation
      const validation = this.isValidSmartQueueTrack(track);
      if (!validation.valid) {
        // Discard playlists, compilations, mixes, preview-only clips, and fake channels
        continue;
      }

      const cTitle = cleanText(track.title).replace(/\(.*\)/g, '').trim();
      const cArtist = cleanText(track.artistName).split(/[,&/]/)[0].trim();
      const signature = `${cTitle}::${cArtist}`;

      if (seenSignatures.has(signature)) continue;
      seenSignatures.add(signature);

      const score = this.calculateTransitionScore(currentTrack, profile, track, recentArtists);
      if (score > 0) {
        eligibleTracks.push({ track, score, artist: cArtist });
      }
    }

    // Sort by transition compatibility score descending
    eligibleTracks.sort((a, b) => b.score - a.score);

    // Apply Artist Diversity: Cap any single artist to maximum 2 tracks in recommendation queue
    const artistCounts = new Map<string, number>();
    const diverseRecommendations: Track[] = [];

    for (const item of eligibleTracks) {
      const count = artistCounts.get(item.artist) || 0;
      if (count < 2) {
        diverseRecommendations.push(item.track);
        artistCounts.set(item.artist, count + 1);
        if (diverseRecommendations.length >= Math.max(limit * 2, 16)) {
          break;
        }
      }
    }

    // Cache the curated recommendations
    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(cacheKey, diverseRecommendations);

    return diverseRecommendations.slice(0, limit);
  }

  /**
   * Aggregates the general mood, energy, and language profile across an entire playlist.
   */
  public getPlaylistAggregateMood(tracks: Track[]): MoodProfile {
    if (!tracks || tracks.length === 0) {
      return {
        primaryMood: 'ROMANTIC',
        secondaryMoods: ['LOVE', 'EMOTIONAL'],
        energy: 40,
        valence: 60,
        danceability: 45,
        acousticness: 60,
        tempoEstimate: 85,
      };
    }

    const moodCounts = new Map<MoodType, number>();
    let totalEnergy = 0;
    let totalValence = 0;
    let totalAcousticness = 0;
    const langCounts = new Map<string, number>();

    for (const t of tracks) {
      const p = this.analyzeMoodProfile(t);
      moodCounts.set(p.primaryMood, (moodCounts.get(p.primaryMood) || 0) + 1);
      totalEnergy += p.energy;
      totalValence += p.valence;
      totalAcousticness += p.acousticness;
      if (p.language) {
        langCounts.set(p.language, (langCounts.get(p.language) || 0) + 1);
      }
    }

    // Dominant mood
    let dominantMood: MoodType = 'ROMANTIC';
    let maxMoodCount = 0;
    for (const [mood, count] of moodCounts.entries()) {
      if (count > maxMoodCount) {
        maxMoodCount = count;
        dominantMood = mood;
      }
    }

    // Dominant language
    let dominantLang: string | undefined;
    let maxLangCount = 0;
    for (const [lang, count] of langCounts.entries()) {
      if (count > maxLangCount) {
        maxLangCount = count;
        dominantLang = lang;
      }
    }

    const avgEnergy = Math.round(totalEnergy / tracks.length);
    const avgValence = Math.round(totalValence / tracks.length);
    const avgAcoustic = Math.round(totalAcousticness / tracks.length);

    return {
      primaryMood: dominantMood,
      secondaryMoods: ['EMOTIONAL', 'CALM'],
      energy: avgEnergy,
      valence: avgValence,
      danceability: 50,
      acousticness: avgAcoustic,
      tempoEstimate: 90,
      language: dominantLang,
    };
  }

  /**
   * Intelligently selects the next best song from an unplayed shuffle candidate pool.
   * Balances musical transition compatibility with controlled probabilistic selection.
   */
  public selectSmartShuffleCandidate(
    currentTrack: Track,
    candidates: Track[],
    playlistTracks: Track[] = [],
    recentHistory: string[] = []
  ): Track | null {
    if (!candidates || candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    const currentProfile = this.analyzeMoodProfile(currentTrack);
    const playlistProfile = playlistTracks.length > 0
      ? this.getPlaylistAggregateMood(playlistTracks)
      : currentProfile;

    // Score all candidates
    const scoredCandidates: { track: Track; score: number }[] = [];

    for (const candidate of candidates) {
      // Base transition score from current playing song
      let score = this.calculateTransitionScore(currentTrack, currentProfile, candidate, recentHistory);

      // Playlist context harmony boost (+20 if candidate matches overall playlist mood)
      const candProfile = this.analyzeMoodProfile(candidate);
      if (candProfile.primaryMood === playlistProfile.primaryMood) {
        score += 20;
      }

      // Energy consistency with playlist average
      if (Math.abs(candProfile.energy - playlistProfile.energy) <= 20) {
        score += 15;
      }

      scoredCandidates.push({ track: candidate, score: Math.max(1, score) });
    }

    // Sort descending
    scoredCandidates.sort((a, b) => b.score - a.score);

    // Controlled Randomness among the Top Compatible Tier (top 3-4 candidates within 20% of best score)
    const bestScore = scoredCandidates[0].score;
    const topTier = scoredCandidates.filter(
      (c) => c.score >= bestScore * 0.80 || scoredCandidates.indexOf(c) < 3
    );

    // Probabilistic selection with decaying weights
    const weights = topTier.map((_, idx) => Math.pow(0.75, idx));
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    let rand = Math.random() * totalWeight;

    for (let i = 0; i < topTier.length; i++) {
      if (rand < weights[i]) {
        return topTier[i].track;
      }
      rand -= weights[i];
    }

    return topTier[0].track;
  }

  /**
   * Generates a complete Smart Shuffled sequence for a playlist or queue pool.
   * Starts with the currently playing track and sequences the rest smoothly.
   */
  public generateSmartShuffledQueue(
    currentTrack: Track,
    pool: Track[],
    playlistTracks: Track[] = []
  ): Track[] {
    const remaining = pool.filter((t) => t.id !== currentTrack.id);
    const result: Track[] = [currentTrack];
    const recentHistory: string[] = [cleanText(currentTrack.artistName)];

    let current = currentTrack;
    while (remaining.length > 0) {
      const next = this.selectSmartShuffleCandidate(current, remaining, playlistTracks, recentHistory);
      if (!next) break;

      result.push(next);
      recentHistory.push(cleanText(next.artistName));
      if (recentHistory.length > 5) recentHistory.shift();

      const idx = remaining.findIndex((t) => t.id === next.id);
      if (idx !== -1) remaining.splice(idx, 1);

      current = next;
    }

    return result;
  }

  /**
   * Ranks local candidates from a playlist/album/artist context according to musical transition
   * compatibility with the current song and overall playlist mood.
   * 100% local, instantaneous, and deterministic (Zero external API calls).
   */
  public rankContextCandidates(
    currentTrack: Track,
    candidates: Track[],
    playlistTracks: Track[] = []
  ): Track[] {
    if (!candidates || candidates.length === 0) return [];
    if (candidates.length === 1) return candidates;

    const currentProfile = this.analyzeMoodProfile(currentTrack);
    const playlistProfile = playlistTracks.length > 0
      ? this.getPlaylistAggregateMood(playlistTracks)
      : currentProfile;

    const scored: { track: Track; score: number }[] = [];

    for (const candidate of candidates) {
      let score = this.calculateTransitionScore(currentTrack, currentProfile, candidate);

      const candProfile = this.analyzeMoodProfile(candidate);
      if (candProfile.primaryMood === playlistProfile.primaryMood) {
        score += 25;
      }
      if (Math.abs(candProfile.energy - playlistProfile.energy) <= 20) {
        score += 15;
      }

      scored.push({ track: candidate, score });
    }

    scored.sort((a, b) => b.score - a.score);

    return scored.map((s) => s.track);
  }

  public clearCache(): void {
    this.cache.clear();
  }
}

export const smartQueueService = SmartQueueService.getInstance();
