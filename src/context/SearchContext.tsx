import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { SearchResults, Track } from '../types/music';
import { providerRegistry } from '../providers/ProviderRegistry';
import { useLibrary } from './LibraryContext';
import { localCacheService } from '../services/LocalCacheService';
import { networkStateService } from '../services/NetworkStateService';

export type SearchFilterType = 'all' | 'songs' | 'artists' | 'albums' | 'playlists';

interface SearchContextType {
  query: string;
  setQuery: (q: string) => void;
  results: SearchResults | null;
  isLoading: boolean;
  error: string | null;
  activeFilter: SearchFilterType;
  setActiveFilter: (filter: SearchFilterType) => void;
  clearSearch: () => void;
  retrySearch: () => void;
  recentSearches: string[];
  addRecentSearch: (q: string) => void;
  removeRecentSearch: (q: string) => void;
  clearRecentSearches: () => void;
}

import { normalizeSearchQuery, scoreTrack, deduplicateTracks } from '../utils/searchIntelligence';

const SearchContext = createContext<SearchContextType | undefined>(undefined);

function matchLocalTracks(query: string, localTracks: Track[]): Track[] {
  if (!query || localTracks.length === 0) return [];
  const nq = normalizeSearchQuery(query);
  if (!nq.clean) return [];

  const scored = localTracks
    .filter((track) => {
      const title = (track.title || '').toLowerCase();
      const artist = (track.artistName || '').toLowerCase();
      const album = (track.albumTitle || '').toLowerCase();
      const q = nq.clean;
      return (
        title.includes(q) ||
        artist.includes(q) ||
        album.includes(q) ||
        nq.meaningfulTokens.some((tok) => title.includes(tok) || artist.includes(tok) || album.includes(tok))
      );
    })
    .map((track) => ({
      track,
      score: scoreTrack(track, nq),
    }))
    .filter((item) => item.score > 120);

  scored.sort((a, b) => b.score - a.score);
  return scored.map((item) => item.track);
}


const MAX_RECENT_SEARCHES = 5;

export const SearchProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { localTracks, downloadedTracks } = useLibrary();
  const [query, setQueryState] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<SearchFilterType>('all');
  const [searchTrigger, setSearchTrigger] = useState(0);
  const currentResultsRef = useRef<SearchResults | null>(null);
  currentResultsRef.current = results;

  const retrySearch = useCallback(() => {
    setError(null);
    setSearchTrigger((prev) => prev + 1);
  }, []);

  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('stuxs_recent_searches');
      return saved ? JSON.parse(saved).slice(0, MAX_RECENT_SEARCHES) : [];
    } catch { return []; }
  });

  const activeRequestIdRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  // Stable ref — avoids addRecentSearch being an effect dep
  const addRecentSearchRef = useRef<(q: string) => void>(() => {});

  const addRecentSearch = useCallback((rawQuery: string) => {
    const clean = rawQuery.trim();
    if (!clean || clean.length < 2) return;
    setRecentSearches((prev) => {
      const lower = clean.toLowerCase();
      const filtered = prev.filter((item) => item.toLowerCase() !== lower);
      const updated = [clean, ...filtered].slice(0, MAX_RECENT_SEARCHES);
      try { localStorage.setItem('stuxs_recent_searches', JSON.stringify(updated)); } catch {}
      return updated;
    });
  }, []);
  addRecentSearchRef.current = addRecentSearch;

  const removeRecentSearch = useCallback((target: string) => {
    setRecentSearches((prev) => {
      const lower = target.toLowerCase();
      const updated = prev.filter((item) => item.toLowerCase() !== lower);
      try { localStorage.setItem('stuxs_recent_searches', JSON.stringify(updated)); } catch {}
      return updated;
    });
  }, []);

  const clearRecentSearches = useCallback(() => {
    setRecentSearches([]);
    try { localStorage.removeItem('stuxs_recent_searches'); } catch {}
  }, []);

  const setQuery = useCallback((q: string) => { setQueryState(q); }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    const nq = normalizeSearchQuery(trimmed);
    const allOffline = [...localTracks, ...downloadedTracks];
    const matchedOffline = matchLocalTracks(trimmed, allOffline);

    const mergeAndRankTracks = (onlineTracks: Track[]): Track[] => {
      const pool = [...matchedOffline, ...onlineTracks];
      const scored = pool.map((t) => ({ track: t, score: scoreTrack(t, nq) }));
      scored.sort((a, b) => b.score - a.score);
      return deduplicateTracks(scored.map((s) => s.track), nq);
    };

    const cachedEntry =
      providerRegistry.getCachedSearchResults(trimmed) ||
      localCacheService.getDataSync<SearchResults>('search_' + trimmed.toLowerCase());

    if (networkStateService.isOffline()) {
      const offlineTracks = cachedEntry ? mergeAndRankTracks(cachedEntry.tracks) : matchedOffline;
      setResults({
        tracks: offlineTracks,
        artists: cachedEntry?.artists || [],
        albums: cachedEntry?.albums || [],
        playlists: cachedEntry?.playlists || [],
      });
      setIsLoading(false);
      return;
    }

    if (cachedEntry) {
      setResults({
        ...cachedEntry,
        tracks: mergeAndRankTracks(cachedEntry.tracks),
      });
      setIsLoading(false);
    } else {
      setIsLoading(true);
    }

    setError(null);
    const requestId = ++activeRequestIdRef.current;

    // Cancel previous in-flight request when new query commits
    if (abortControllerRef.current) abortControllerRef.current.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const timer = setTimeout(async () => {
      if (controller.signal.aborted) return;
      let progressiveReceived = false;
      try {
        // Bounded 10-second timeout for progressive search
        const timeoutPromise = new Promise<void>((_, reject) => {
          setTimeout(() => reject(new Error('Search request timed out')), 10000);
        });

        const searchExecution = providerRegistry.searchProgressive(trimmed, (progressiveResults, isFinal) => {
          if (requestId !== activeRequestIdRef.current || controller.signal.aborted) return;

          const combinedTracks = mergeAndRankTracks(progressiveResults.tracks);
          const mergedResults: SearchResults = { ...progressiveResults, tracks: combinedTracks };
          const hasItems =
            mergedResults.tracks.length > 0 || mergedResults.artists.length > 0 ||
            mergedResults.albums.length > 0 || mergedResults.playlists.length > 0;

          if (hasItems) {
            progressiveReceived = true;
            setResults(mergedResults);
            addRecentSearchRef.current(trimmed);
          }
          if (isFinal) {
            setResults(mergedResults);
            setIsLoading(false);
            localCacheService.set('search_' + trimmed.toLowerCase(), mergedResults, 15 * 60 * 1000);
          }
        });

        await Promise.race([searchExecution, timeoutPromise]);
      } catch (err: any) {
        if (requestId === activeRequestIdRef.current && !controller.signal.aborted) {
          console.warn('[SearchContext] Search failed or timed out:', err?.message || err);
          // If we had progressive, local, or cached results, keep them instead of displaying an error
          if (progressiveReceived || matchedOffline.length > 0 || cachedEntry || currentResultsRef.current) {
            setIsLoading(false);
          } else {
            setError('Search is taking longer than usual. Please check your connection.');
            setIsLoading(false);
          }
        }
      }
    }, 0);

    return () => { clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, localTracks, downloadedTracks, searchTrigger]);

  // Auto-retry search when device reconnects to network
  useEffect(() => {
    let initialCall = true;
    const unsub = networkStateService.subscribe((status) => {
      if (initialCall) {
        initialCall = false;
        return;
      }
      if (status !== 'OFFLINE' && query.trim()) {
        retrySearch();
      }
    });
    return unsub;
  }, [query, retrySearch]);

  const clearSearch = useCallback(() => {
    setQueryState('');
    setResults(null);
    setIsLoading(false);
    setError(null);
    setActiveFilter('all');
  }, []);

  const contextValue = useMemo(
    () => ({
      query,
      setQuery,
      results,
      isLoading,
      error,
      activeFilter,
      setActiveFilter,
      clearSearch,
      retrySearch,
      recentSearches,
      addRecentSearch,
      removeRecentSearch,
      clearRecentSearches,
    }),
    [
      query,
      setQuery,
      results,
      isLoading,
      error,
      activeFilter,
      setActiveFilter,
      clearSearch,
      retrySearch,
      recentSearches,
      addRecentSearch,
      removeRecentSearch,
      clearRecentSearches,
    ]
  );

  return (
    <SearchContext.Provider value={contextValue}>
      {children}
    </SearchContext.Provider>
  );
};

export const useSearch = (): SearchContextType => {
  const context = useContext(SearchContext);
  if (!context) throw new Error('useSearch must be used within a SearchProvider');
  return context;
};
