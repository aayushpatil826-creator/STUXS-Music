import type { Track } from '../types/music';
import { cleanText } from '../utils/searchIntelligence';
import { smartQueueService } from './SmartQueueService';

export interface ScoringWeights {
  sameArtist: number; // +50 pts
  sameAlbum: number; // +40 pts
  sameGenre: number; // +35 pts
  sameLanguage: number; // +35 pts
  similarArtistStyle: number; // +30 pts
  similarProviderMetadata: number; // +25 pts
  userListeningHistory: number; // +25 pts
  userLikedSongs: number; // +20 pts
  moodEnergyAlignment: number; // +15 pts
  repeatedlySkippedPenalty: number; // -60 pts
  recentlyPlayedPenalty: number; // -70 pts
  duplicateVersionPenalty: number; // -300 pts
  unrelatedLanguageGenrePenalty: number; // -50 pts
}

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  sameArtist: 50,
  sameAlbum: 40,
  sameGenre: 35,
  sameLanguage: 35,
  similarArtistStyle: 30,
  similarProviderMetadata: 25,
  userListeningHistory: 25,
  userLikedSongs: 20,
  moodEnergyAlignment: 15,
  repeatedlySkippedPenalty: 60,
  recentlyPlayedPenalty: 70,
  duplicateVersionPenalty: 300,
  unrelatedLanguageGenrePenalty: 50,
};

export class LocalRecommendationEngine {
  private weights: ScoringWeights = { ...DEFAULT_SCORING_WEIGHTS };

  /**
   * Scores a single candidate track against the currently playing seed track.
   */
  public scoreCandidate(
    seedTrack: Track,
    candidate: Track,
    recentlyPlayedIds: Set<string> = new Set(),
    lastPlayedArtist?: string,
    userContext?: {
      likedTrackIds?: Set<string>;
      frequentTrackIds?: Set<string>;
      skippedTrackIds?: Set<string>;
    }
  ): number {
    if (!candidate || !candidate.id) return -Infinity;
    if (candidate.id === seedTrack.id) return -Infinity;
    if (candidate.isPreview || candidate.accessStatus === 'preview' || candidate.accessStatus === 'blocked') {
      return -Infinity;
    }

    let score = 50; // Baseline score

    const seedArtistClean = cleanText(seedTrack.artistName || '').toLowerCase();
    const candArtistClean = cleanText(candidate.artistName || '').toLowerCase();
    const seedTitleClean = cleanText(seedTrack.title || '').toLowerCase();
    const candTitleClean = cleanText(candidate.title || '').toLowerCase();

    const seedAlbum = cleanText(seedTrack.albumTitle || '').toLowerCase();
    const candAlbum = cleanText(candidate.albumTitle || '').toLowerCase();

    const seedGenre = cleanText(seedTrack.genre || '').toLowerCase();
    const candGenre = cleanText(candidate.genre || '').toLowerCase();

    // 0. Deduplicate exact duplicate versions of current song (-300)
    if (candTitleClean === seedTitleClean && candArtistClean === seedArtistClean) {
      return -this.weights.duplicateVersionPenalty;
    }

    // 1. Same Artist Match (+50 pts)
    const isSameArtist =
      candArtistClean.includes(seedArtistClean) || seedArtistClean.includes(candArtistClean);
    if (isSameArtist) {
      score += this.weights.sameArtist;
    } else if (seedArtistClean.split(' ')[0] === candArtistClean.split(' ')[0]) {
      score += this.weights.similarArtistStyle;
    }

    // 2. Same Album Match (+40 pts)
    if (seedAlbum && candAlbum && (candAlbum === seedAlbum || candAlbum.includes(seedAlbum))) {
      score += this.weights.sameAlbum;
    }

    // 3. Same Genre (+35 pts) vs Unrelated Genre (-50 pts)
    if (seedGenre && candGenre) {
      if (candGenre.includes(seedGenre) || seedGenre.includes(candGenre)) {
        score += this.weights.sameGenre;
      } else {
        score -= this.weights.unrelatedLanguageGenrePenalty / 2;
      }
    }

    // 4. Same Language (+35 pts) vs Unrelated Language (-50 pts)
    if (seedTrack.language && candidate.language) {
      if (seedTrack.language.toLowerCase() === candidate.language.toLowerCase()) {
        score += this.weights.sameLanguage;
      } else {
        score -= this.weights.unrelatedLanguageGenrePenalty;
      }
    }

    // 5. Similar Provider Metadata (+25 pts)
    if (candidate.provider && seedTrack.provider && candidate.provider === seedTrack.provider) {
      score += this.weights.similarProviderMetadata;
    }

    // 6. User History & Liked Songs Signals
    if (userContext) {
      if (userContext.likedTrackIds?.has(candidate.id)) {
        score += this.weights.userLikedSongs; // +20
      }
      if (userContext.frequentTrackIds?.has(candidate.id)) {
        score += this.weights.userListeningHistory; // +25
      }
      if (userContext.skippedTrackIds?.has(candidate.id)) {
        score -= this.weights.repeatedlySkippedPenalty; // -60
      }
    }

    // 7. Mood & Energy Alignment (+15 pts)
    const seedProfile = smartQueueService.analyzeMoodProfile(seedTrack);
    const candProfile = smartQueueService.analyzeMoodProfile(candidate);

    if (seedProfile.primaryMood === candProfile.primaryMood) {
      score += this.weights.moodEnergyAlignment;
    }

    const energyDelta = Math.abs(seedProfile.energy - candProfile.energy);
    if (energyDelta <= 20) {
      score += Math.round(this.weights.moodEnergyAlignment * (1 - energyDelta / 20));
    } else if (energyDelta > 45) {
      score -= 30; // Abrupt jarring energy jump penalty
    }

    // 8. Recently Played Penalty (-70 pts)
    if (recentlyPlayedIds.has(candidate.id)) {
      score -= this.weights.recentlyPlayedPenalty;
    }

    // 9. Avoid repeating same artist immediately consecutively
    if (lastPlayedArtist) {
      const cleanLast = cleanText(lastPlayedArtist).toLowerCase();
      if (candArtistClean === cleanLast && isSameArtist) {
        score -= 25;
      }
    }

    return score;
  }

  /**
   * Ranks an in-memory candidate list from the current Library playlist.
   */
  public rankPlaylistCandidates(
    seedTrack: Track,
    candidates: Track[],
    recentlyPlayedIds: Set<string> = new Set(),
    lastPlayedArtist?: string
  ): Track[] {
    if (!candidates || candidates.length === 0) return [];
    if (candidates.length === 1) return candidates;

    // Filter out seed track, preview clips, and invalid IDs
    const eligible = candidates.filter(
      (c) => c && c.id && c.id !== seedTrack.id && !c.isPreview && c.accessStatus !== 'preview'
    );

    const scored = eligible.map((candidate) => ({
      track: candidate,
      score: this.scoreCandidate(seedTrack, candidate, recentlyPlayedIds, lastPlayedArtist),
    }));

    // Sort descending by score
    scored.sort((a, b) => b.score - a.score);

    return scored.map((s) => s.track);
  }

  /**
   * Selects the next track from the Library playlist:
   * - If isShuffle is FALSE: picks the #1 top-ranked candidate.
   * - If isShuffle is TRUE: uses controlled weighted probability among top candidates (decaying weights).
   */
  public selectNextTrack(
    seedTrack: Track,
    candidates: Track[],
    recentlyPlayedIds: Set<string> = new Set(),
    isShuffle = false,
    lastPlayedArtist?: string
  ): Track | null {
    const ranked = this.rankPlaylistCandidates(
      seedTrack,
      candidates,
      recentlyPlayedIds,
      lastPlayedArtist
    );

    if (ranked.length === 0) return null;
    if (!isShuffle || ranked.length === 1) return ranked[0];

    // Controlled Randomness among top compatible candidates for Smart Shuffle mode
    const topPool = ranked.slice(0, Math.min(4, ranked.length));
    const weights = [0.5, 0.3, 0.15, 0.05].slice(0, topPool.length);
    const sumWeights = weights.reduce((a, b) => a + b, 0);

    const randomVal = Math.random() * sumWeights;
    let running = 0;
    for (let i = 0; i < topPool.length; i++) {
      running += weights[i];
      if (randomVal <= running) {
        return topPool[i];
      }
    }

    return topPool[0];
  }
}

export class RecommendationEngine extends LocalRecommendationEngine {}

export const localRecommendationEngine = new LocalRecommendationEngine();
export const recommendationEngine = localRecommendationEngine;
