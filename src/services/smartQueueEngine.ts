import type { Track } from '../types/music';
import { cleanText } from '../utils/searchIntelligence';
import { smartQueueService } from './SmartQueueService';

export interface LocalScoringWeights {
  genreMatch: number; // +30 pts
  artistStyleMatch: number; // +20 pts
  moodEnergyAlignment: number; // +15 pts
  recentlyPlayedPenalty: number; // -40 pts
  consecutiveArtistPenalty: number; // -50 pts
}

export const DEFAULT_WEIGHTS: LocalScoringWeights = {
  genreMatch: 30,
  artistStyleMatch: 20,
  moodEnergyAlignment: 15,
  recentlyPlayedPenalty: 40,
  consecutiveArtistPenalty: 50,
};

export class SmartQueueEngine {
  private static instance: SmartQueueEngine;
  private weights: LocalScoringWeights = { ...DEFAULT_WEIGHTS };

  private constructor() {}

  public static getInstance(): SmartQueueEngine {
    if (!SmartQueueEngine.instance) {
      SmartQueueEngine.instance = new SmartQueueEngine();
    }
    return SmartQueueEngine.instance;
  }

  /**
   * Scores an individual candidate track against the currently playing seed track.
   * Pure in-memory calculation with zero network dependencies.
   */
  public scoreCandidate(
    seedTrack: Track,
    candidate: Track,
    recentlyPlayedIds: Set<string> = new Set(),
    lastPlayedArtist?: string
  ): number {
    if (!candidate || !candidate.id) return -Infinity;
    if (candidate.id === seedTrack.id) return -Infinity;

    let score = 50; // baseline score

    const seedArtistClean = cleanText(seedTrack.artistName).toLowerCase();
    const seedGenre = (seedTrack.genre || seedTrack.albumTitle || '').toLowerCase();

    const candArtistClean = cleanText(candidate.artistName).toLowerCase();
    const candGenre = (candidate.genre || candidate.albumTitle || '').toLowerCase();

    // 1. Matching Genre / Sub-genre (+30 pts)
    if (seedGenre && candGenre) {
      if (
        candGenre.includes(seedGenre) ||
        seedGenre.includes(candGenre) ||
        (seedTrack.language && candidate.language && seedTrack.language.toLowerCase() === candidate.language.toLowerCase())
      ) {
        score += this.weights.genreMatch;
      }
    }

    // 2. Matching Artist / Style (+20 pts)
    const sameArtist =
      candArtistClean.includes(seedArtistClean) || seedArtistClean.includes(candArtistClean);
    if (sameArtist) {
      score += this.weights.artistStyleMatch;
    }

    // 3. Mood & Energy Alignment (+15 pts)
    const seedProfile = smartQueueService.analyzeMoodProfile(seedTrack);
    const candProfile = smartQueueService.analyzeMoodProfile(candidate);

    if (seedProfile.primaryMood === candProfile.primaryMood) {
      score += this.weights.moodEnergyAlignment;
    }

    const energyDelta = Math.abs(seedProfile.energy - candProfile.energy);
    if (energyDelta <= 20) {
      score += Math.round(this.weights.moodEnergyAlignment * (1 - energyDelta / 20));
    } else if (energyDelta > 45) {
      score -= 25; // Jarring energy jump penalty
    }

    // 4. Penalty for tracks in recentlyPlayed / played in the current session (-40 pts)
    if (recentlyPlayedIds.has(candidate.id)) {
      score -= this.weights.recentlyPlayedPenalty;
    }

    // 5. Prevent immediate consecutive artist repetition (-50 pts unless no alternative exists)
    if (lastPlayedArtist) {
      const cleanLast = cleanText(lastPlayedArtist).toLowerCase();
      if (candArtistClean === cleanLast || candArtistClean.includes(cleanLast)) {
        score -= this.weights.consecutiveArtistPenalty;
      }
    }

    return score;
  }

  /**
   * Ranks an in-memory candidate list from best to worst next track.
   */
  public rankCandidates(
    seedTrack: Track,
    candidates: Track[],
    recentlyPlayedIds: Set<string> = new Set(),
    lastPlayedArtist?: string
  ): Track[] {
    if (!candidates || candidates.length === 0) return [];
    if (candidates.length === 1) return candidates;

    const scored = candidates
      .filter((c) => c && c.id && c.id !== seedTrack.id)
      .map((candidate) => ({
        track: candidate,
        score: this.scoreCandidate(seedTrack, candidate, recentlyPlayedIds, lastPlayedArtist),
      }));

    // Sort descending by score
    scored.sort((a, b) => b.score - a.score);

    return scored.map((s) => s.track);
  }

  /**
   * Picks the single best next candidate from an in-memory pool.
   */
  public pickNextTrack(
    seedTrack: Track,
    candidates: Track[],
    recentlyPlayedIds: Set<string> = new Set(),
    lastPlayedArtist?: string
  ): Track | null {
    const ranked = this.rankCandidates(seedTrack, candidates, recentlyPlayedIds, lastPlayedArtist);
    return ranked.length > 0 ? ranked[0] : null;
  }
}

export const smartQueueEngine = SmartQueueEngine.getInstance();
