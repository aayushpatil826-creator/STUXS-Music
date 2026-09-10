import React, {
  useState, useCallback, useMemo,
  useEffect, memo,
} from "react";
import { Search, X, Clock, Loader2 } from "lucide-react";
import { BROWSE_CATEGORIES } from "../data/mock/categories";
import { TrackRow } from "../components/common/TrackRow";
import { ArtistCard } from "../components/common/ArtistCard";
import { CoverflowCarousel } from "../components/common/CoverflowCarousel";
import { TrackRowSkeleton, CardSkeleton } from "../components/common/SkeletonLoader";
import { EmptyState } from "../components/common/EmptyState";
import { ErrorState } from "../components/common/ErrorState";
import { useSearch } from "../context/SearchContext";
import type { Track, Artist, Album, Playlist, SearchResults } from "../types/music";

interface SearchScreenProps {
  onSelectArtist: (artistId: string) => void;
  onSelectAlbum: (albumId?: string) => void;
  onSelectPlaylist: (playlistId: string) => void;
}

// ---------------------------------------------------------------------------
// Sub-components — each memoized with precise prop boundaries
// ---------------------------------------------------------------------------

interface SearchInputProps {
  inputValue: string;
  onChange: (v: string) => void;
  onClear: () => void;
}
const SearchInput = memo<SearchInputProps>(({ inputValue, onChange, onClear }) => (
  <div className="relative flex items-center">
    <Search className="absolute left-3.5 w-4 h-4 text-purple-600 dark:text-purple-400 pointer-events-none" />
    <input
      type="text"
      inputMode="search"
      enterKeyHint="search"
      placeholder="Songs, artists, albums, playlists..."
      value={inputValue}
      onChange={(e) => onChange(e.target.value)}
      className="w-full pl-10 pr-10 py-3 rounded-2xl bg-white/90 dark:bg-white/10 border border-black/5 dark:border-white/10 text-sm text-stuxs-text placeholder:text-stuxs-text-muted focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500 shadow-xs transition-all"
    />
    {inputValue && (
      <button
        onClick={onClear}
        className="absolute right-3 p-1 rounded-full text-stuxs-text-muted hover:text-stuxs-text active:scale-95 transition-all"
        aria-label="Clear search"
      >
        <X className="w-4 h-4" />
      </button>
    )}
  </div>
));
SearchInput.displayName = "SearchInput";

interface FilterPillsProps {
  activeFilter: string;
  onSetFilter: (f: string) => void;
}
const FILTERS = [
  { id: "all", label: "All" },
  { id: "songs", label: "Songs" },
  { id: "artists", label: "Artists" },
  { id: "albums", label: "Albums" },
  { id: "playlists", label: "Playlists" },
] as const;

const FilterPills = memo<FilterPillsProps>(({ activeFilter, onSetFilter }) => (
  <div className="flex space-x-2 overflow-x-auto pt-3 pb-1 scrollbar-none">
    {FILTERS.map((f) => (
      <button
        key={f.id}
        onClick={() => onSetFilter(f.id)}
        className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
          activeFilter === f.id
            ? "bg-purple-600 text-white shadow-sm"
            : "bg-white/80 dark:bg-white/10 text-stuxs-text-secondary hover:text-stuxs-text border border-black/5 dark:border-white/10"
        }`}
      >
        {f.label}
      </button>
    ))}
  </div>
));
FilterPills.displayName = "FilterPills";

interface SongsResultsProps {
  tracks: Track[];
  playlistContext: Track[];
  onSelectArtist: (id: string) => void;
  onSelectAlbum: (id?: string) => void;
}
const SongsResults = memo<SongsResultsProps>(({ tracks, playlistContext, onSelectArtist, onSelectAlbum }) => {
  // Limit visible songs to 25 to avoid rendering hundreds of DOM nodes
  const visible = tracks.length > 25 ? tracks.slice(0, 25) : tracks;
  return (
    <div>
      <h3 className="text-base font-bold text-stuxs-text mb-2">Songs</h3>
      <div className="space-y-1">
        {visible.map((track) => (
          <TrackRow
            key={`${track.provider}-${track.id}`}
            track={track}
            context="search"
            playlistContext={playlistContext}
            onSelectArtist={onSelectArtist}
            onSelectAlbum={onSelectAlbum}
          />
        ))}
        {tracks.length > 25 && (
          <p className="text-xs text-stuxs-text-muted text-center pt-2 pb-1">
            +{tracks.length - 25} more songs
          </p>
        )}
      </div>
    </div>
  );
});
SongsResults.displayName = "SongsResults";

interface ArtistsResultsProps {
  artists: Artist[];
  onSelectArtist: (id: string) => void;
}
const ArtistsResults = memo<ArtistsResultsProps>(({ artists, onSelectArtist }) => (
  <div>
    <h3 className="text-base font-bold text-stuxs-text mb-2">Artists</h3>
    <div className="flex space-x-4 overflow-x-auto scrollbar-none pb-1">
      {artists.map((artist) => (
        <ArtistCard key={artist.id} artist={artist} onSelect={onSelectArtist} />
      ))}
    </div>
  </div>
));
ArtistsResults.displayName = "ArtistsResults";

interface AlbumsResultsProps {
  albums: Album[];
  onSelectAlbum: (id?: string) => void;
}
const AlbumsResults = memo<AlbumsResultsProps>(({ albums, onSelectAlbum }) => (
  <div>
    <h3 className="text-base font-bold text-stuxs-text mb-1">Albums</h3>
    <CoverflowCarousel
      items={albums.map((album) => ({
        id: album.id,
        title: album.title,
        subtitle: `${album.artistName}${album.genre ? ` • ${album.genre}` : ""}`,
        artworkUrl: album.artworkUrl,
        badge: album.genre || "Album",
        data: album,
      }))}
      onSelectItem={(item) => onSelectAlbum(item.id)}
      badgeLabel="Album"
      ariaLabel="Search Albums Results"
    />
  </div>
));
AlbumsResults.displayName = "AlbumsResults";

interface PlaylistsResultsProps {
  playlists: Playlist[];
  onSelectPlaylist: (id: string) => void;
}
const PlaylistsResults = memo<PlaylistsResultsProps>(({ playlists, onSelectPlaylist }) => (
  <div>
    <h3 className="text-base font-bold text-stuxs-text mb-1">Playlists</h3>
    <CoverflowCarousel
      items={playlists.map((playlist) => ({
        id: playlist.id,
        title: playlist.name,
        subtitle: `${playlist.songCount || playlist.songs?.length || 0} songs`,
        artworkUrl: playlist.artworkUrl,
        badge: "Playlist",
        data: playlist,
      }))}
      onSelectItem={(item) => onSelectPlaylist(item.id)}
      badgeLabel="Playlist"
      ariaLabel="Search Playlists Results"
    />
  </div>
));
PlaylistsResults.displayName = "PlaylistsResults";

interface RecentSearchesProps {
  items: string[];
  onSelect: (q: string) => void;
  onRemove: (q: string) => void;
  onClearAll: () => void;
}
const RecentSearches = memo<RecentSearchesProps>(({ items, onSelect, onRemove, onClearAll }) => {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="flex items-center justify-between mb-2.5">
        <h2 className="text-sm font-bold text-stuxs-text tracking-tight">Recent Searches</h2>
        <button
          onClick={onClearAll}
          className="text-xs font-semibold text-purple-600 dark:text-purple-400 hover:opacity-80 active:opacity-75 transition-opacity cursor-pointer"
        >
          Clear All
        </button>
      </div>
      <div className="space-y-1 rounded-2xl bg-stuxs-surface-secondary/35 border border-stuxs-border/40 p-1 divide-y divide-black/5 dark:divide-white/5 overflow-hidden shadow-xs">
        {items.map((item) => (
          <div
            key={item}
            onClick={() => onSelect(item)}
            className="flex items-center justify-between px-3.5 py-3 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 active:scale-98 cursor-pointer transition-colors group"
          >
            <div className="flex items-center space-x-3 min-w-0 flex-1">
              <Clock className="w-4 h-4 text-stuxs-text-muted flex-shrink-0 group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors" />
              <span className="text-sm font-medium text-stuxs-text truncate">{item}</span>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); onRemove(item); }}
              className="p-1 rounded-full text-stuxs-text-muted hover:text-stuxs-text hover:bg-black/5 dark:hover:bg-white/10 active:scale-95 transition-all ml-2"
              aria-label={`Remove ${item} from search history`}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
});
RecentSearches.displayName = "RecentSearches";

interface BrowseCategoriesProps {
  onCategoryClick: (title: string) => void;
}
// Static — never changes after mount
const BrowseCategories = memo<BrowseCategoriesProps>(({ onCategoryClick }) => (
  <div>
    <h2 className="text-sm font-bold text-stuxs-text mb-3 tracking-tight">Browse Categories</h2>
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {BROWSE_CATEGORIES.map((category) => (
        <button
          key={category.id}
          onClick={() => onCategoryClick(category.title)}
          className="h-24 rounded-[22px] p-3.5 flex flex-col justify-between text-left transition-transform hover:scale-[1.02] active:scale-[0.98] btn-press relative overflow-hidden shadow-xs border border-stuxs-border/40 bg-stuxs-surface-secondary/35 cursor-pointer"
        >
          {/* Subtle gradient background accent */}
          <div className={`absolute inset-0 bg-gradient-to-br ${category.color} opacity-20 dark:opacity-40 pointer-events-none`} />
          <span className="relative z-10 font-bold text-stuxs-text text-sm tracking-tight leading-snug">
            {category.title}
          </span>
          <div className="relative z-10 self-end w-7 h-7 rounded-full bg-white/90 dark:bg-white/10 border border-black/5 dark:border-white/10 shadow-xs flex items-center justify-center text-purple-600 dark:text-purple-400">
            <Search className="w-3.5 h-3.5" />
          </div>
        </button>
      ))}
    </div>
  </div>
));
BrowseCategories.displayName = "BrowseCategories";

// ---------------------------------------------------------------------------
// SearchResultsBody — only re-renders when results/filter/loading changes
// ---------------------------------------------------------------------------
interface SearchResultsBodyProps {
  results: SearchResults | null;
  isLoading: boolean;
  error: string | null;
  query: string;
  activeFilter: string;
  stablePlaylistContext: Track[];
  onSelectArtist: (id: string) => void;
  onSelectAlbum: (id?: string) => void;
  onSelectPlaylist: (id: string) => void;
  onRetry: () => void;
  onClear: () => void;
}

const SearchResultsBody = memo<SearchResultsBodyProps>(({
  results, isLoading, error, query, activeFilter,
  stablePlaylistContext, onSelectArtist, onSelectAlbum, onSelectPlaylist,
  onRetry, onClear,
}) => {
  const hasResults =
    results &&
    (results.tracks.length > 0 || results.artists.length > 0 ||
     results.albums.length > 0 || results.playlists.length > 0);

  return (
    <>
      {/* Subtle top-bar loading indicator when we already have results */}
      {isLoading && hasResults && (
        <div className="flex items-center space-x-2 py-1.5 px-1 mb-2">
          <Loader2 className="w-3 h-3 text-stuxs-accent animate-spin flex-shrink-0" />
          <span className="text-xs text-stuxs-text-muted">Updating results…</span>
        </div>
      )}

      {/* Initial skeletons — only when no prior results */}
      {isLoading && !hasResults && (
        <div className="space-y-4">
          <TrackRowSkeleton />
          <TrackRowSkeleton />
          <TrackRowSkeleton />
          <div className="flex space-x-4 overflow-hidden pt-2">
            <CardSkeleton />
            <CardSkeleton />
          </div>
        </div>
      )}

      {/* Error - only displayed if no progressive, local, or cached results arrived */}
      {!isLoading && error && !hasResults && (
        <ErrorState title="Search Unavailable" message={error} onRetry={onRetry} />
      )}

      {/* No results */}
      {!isLoading && !error && query && !hasResults && (
        <EmptyState
          icon="search"
          title={`No results for "${query}"`}
          description="Check the spelling or try another artist, song, or genre."
          actionText="Clear Search"
          onAction={onClear}
        />
      )}

      {/* Results - always visible if present */}
      {hasResults && query && (
        <div className="space-y-6">
          {(activeFilter === "all" || activeFilter === "songs") && results!.tracks.length > 0 && (
            <SongsResults
              tracks={results!.tracks}
              playlistContext={stablePlaylistContext}
              onSelectArtist={onSelectArtist}
              onSelectAlbum={onSelectAlbum}
            />
          )}
          {(activeFilter === "all" || activeFilter === "artists") && results!.artists.length > 0 && (
            <ArtistsResults artists={results!.artists} onSelectArtist={onSelectArtist} />
          )}
          {(activeFilter === "all" || activeFilter === "albums") && results!.albums.length > 0 && (
            <AlbumsResults albums={results!.albums} onSelectAlbum={onSelectAlbum} />
          )}
          {(activeFilter === "all" || activeFilter === "playlists") && results!.playlists.length > 0 && (
            <PlaylistsResults playlists={results!.playlists} onSelectPlaylist={onSelectPlaylist} />
          )}
        </div>
      )}
    </>
  );
});
SearchResultsBody.displayName = "SearchResultsBody";

// ---------------------------------------------------------------------------
// Main SearchScreen
// ---------------------------------------------------------------------------

export const SearchScreen: React.FC<SearchScreenProps> = React.memo(({
  onSelectArtist,
  onSelectAlbum,
  onSelectPlaylist,
}) => {
  const {
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
    removeRecentSearch,
    clearRecentSearches,
  } = useSearch();

  // Local input value — instant, never touches context on keystroke
  const [inputValue, setInputValue] = useState(query);

  // Sync inputValue when query changes externally (e.g. recent search tap)
  useEffect(() => {
    setInputValue(query);
  }, [query]);

  // Debounce: commit inputValue -> context query after 250ms
  useEffect(() => {
    const trimmed = inputValue.trim();
    // If already matches committed query, skip
    if (trimmed === query.trim()) return;
    const timer = setTimeout(() => {
      setQuery(inputValue);
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputValue]);

  // Stable playlistContext — only updates when results.tracks actually changes
  const stablePlaylistContext = useMemo(
    () => results?.tracks ?? [],
    [results?.tracks]
  );


  const handleInputChange = useCallback((v: string) => {
    setInputValue(v);
  }, []);

  const handleClear = useCallback(() => {
    setInputValue("");
    clearSearch();
  }, [clearSearch]);

  const handleRecentSelect = useCallback((q: string) => {
    setInputValue(q);
    setQuery(q);
  }, [setQuery]);

  const handleCategoryClick = useCallback((title: string) => {
    const q = title.split(" ")[0];
    setInputValue(q);
    setQuery(q);
  }, [setQuery]);

  const handleRetry = useCallback(() => {
    if (inputValue.trim()) {
      setQuery(inputValue);
      retrySearch();
    }
  }, [inputValue, setQuery, retrySearch]);

  const handleSetFilter = useCallback((f: string) => {
    setActiveFilter(f as typeof activeFilter);
  }, [setActiveFilter]);

  const hasResults =
    results &&
    (results.tracks.length > 0 || results.artists.length > 0 ||
     results.albums.length > 0 || results.playlists.length > 0);

  return (
    <div className="animate-in fade-in duration-200 min-h-screen bg-gradient-to-b from-[#7C3AED]/12 via-[#6366F1]/06 to-transparent dark:from-[#1E1138]/60 dark:via-[#140C24]/40 dark:to-transparent">
      {/* Top Header with STUXS Atmosphere */}
      <div className="px-5 safe-top-header pt-2 pb-3">
        <div className="mb-3">
          <h1 className="text-2xl sm:text-[26px] font-black tracking-tight text-stuxs-text">
            Search
          </h1>
          <p className="text-xs font-medium text-stuxs-text-secondary mt-0.5">
            Explore songs, artists, albums & playlists
          </p>
        </div>
        <SearchInput
          inputValue={inputValue}
          onChange={handleInputChange}
          onClear={handleClear}
        />
        {query && hasResults && (
          <FilterPills activeFilter={activeFilter} onSetFilter={handleSetFilter} />
        )}
      </div>

      {/* Main Content Sheet: Rounded Warm Cream / Deep Dark Surface */}
      <div className="rounded-t-[36px] sm:rounded-t-[40px] bg-[#FAF8F5] dark:bg-[#121218] min-h-screen px-4 sm:px-5 pt-5 pb-36 shadow-xl transition-colors">
        {/* Default view when no query */}
        {!query && (
          <div className="space-y-6">
            <RecentSearches
              items={recentSearches}
              onSelect={handleRecentSelect}
              onRemove={removeRecentSearch}
              onClearAll={clearRecentSearches}
            />
            <BrowseCategories onCategoryClick={handleCategoryClick} />
          </div>
        )}

        {/* Results view when query exists */}
        {query && (
          <SearchResultsBody
            results={results}
            isLoading={isLoading}
            error={error}
            query={query}
            activeFilter={activeFilter}
            stablePlaylistContext={stablePlaylistContext}
            onSelectArtist={onSelectArtist}
            onSelectAlbum={onSelectAlbum}
            onSelectPlaylist={onSelectPlaylist}
            onRetry={handleRetry}
            onClear={handleClear}
          />
        )}
      </div>
    </div>
  );
});

SearchScreen.displayName = 'SearchScreen';

