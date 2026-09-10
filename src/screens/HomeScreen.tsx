import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, BadgeCheck, Play, Plus } from 'lucide-react';
import { SectionHeader } from '../components/common/SectionHeader';
import { AlbumCard } from '../components/common/AlbumCard';
import { TrackRow } from '../components/common/TrackRow';
import { PlaylistCover } from '../components/common/PlaylistCover';
import { PlaylistCard } from '../components/common/PlaylistCard';
import { OfflineBanner } from '../components/common/OfflineBanner';
import { TrendingCarousel3D } from '../components/home/TrendingCarousel3D';
import { homeDiscoveryService, type HomeFeedData } from '../services/HomeDiscoveryService';
import { usePlayerActions } from '../context/PlayerContext';
import { useLibrary } from '../context/LibraryContext';
import { Header } from '../components/layout/Header';
import { TrendingView } from '../components/home/TrendingView';
import { BRANDING_CONFIG } from '../config/branding';

interface HomeScreenProps {
  onSelectArtist: (artistId: string) => void;
  onSelectAlbum: (albumId?: string) => void;
  onSelectPlaylist: (playlistId: string) => void;
  onOpenAuth: () => void;
  onOpenUpload?: () => void;
  onNavigateToSearch?: () => void;
  onNavigateToLibrary?: () => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = React.memo(({
  onSelectArtist,
  onSelectAlbum,
  onSelectPlaylist,
  onOpenAuth,
  onOpenUpload,
  onNavigateToSearch,
  onNavigateToLibrary,
}) => {
  const { playTrack } = usePlayerActions();
  const { recentlyPlayed, favorites, playlists } = useLibrary();

  const [showAllTrending, setShowAllTrending] = useState(false);
  const [showAllArtists, setShowAllArtists] = useState(false);

  // Instant hydration from local / persisted cache (Zero Skeleton Delay)
  const [feed, setFeed] = useState<HomeFeedData>(() => {
    const cached = homeDiscoveryService.getCachedFeedSync({
      recentlyPlayed,
      favorites,
      playlists,
    });
    if (cached) {
      return { ...cached, isLoading: false };
    }
    return {
      heroTrack: null,
      quickPicks: [],
      madeForYou: [],
      popularInIndia: [],
      trendingNow: [],
      featuredPlaylists: [],
      featuredAlbums: [],
      featuredArtists: [],
      isLoading: true,
    };
  });

  const recentlyPlayedRef = useRef(recentlyPlayed);
  recentlyPlayedRef.current = recentlyPlayed;
  const favoritesRef = useRef(favorites);
  favoritesRef.current = favorites;
  const playlistsRef = useRef(playlists);
  playlistsRef.current = playlists;

  // Stale-While-Revalidate background feed hydration
  const loadFeed = useCallback(async (force = false) => {
    try {
      const data = await homeDiscoveryService.getHomeFeed(
        {
          recentlyPlayed: recentlyPlayedRef.current,
          favorites: favoritesRef.current,
          playlists: playlistsRef.current,
        },
        force,
        (freshData) => {
          setFeed(freshData);
        }
      );
      setFeed(data);
    } catch (err) {
      console.warn('[HomeScreen] Error fetching fresh home feed:', err);
      setFeed((prev) => ({ ...prev, isLoading: false }));
    }
  }, []);

  useEffect(() => {
    loadFeed(false);
  }, [loadFeed]);

  const {
    heroTrack,
    quickPicks,
    madeForYou,
    trendingNow,
    becauseYouPlayed,
    featuredPlaylists,
    featuredAlbums,
    featuredArtists,
    isLoading,
  } = feed;

  // Real trending tracks pool: use trendingNow, or fall back to quickPicks / heroTrack so it is NEVER empty
  const displayTrending = trendingNow.length > 0
    ? trendingNow
    : (heroTrack ? [heroTrack, ...quickPicks] : quickPicks);

  // Real Made for You pool: use madeForYou or quickPicks
  const displayMadeForYou = madeForYou.length > 0 ? madeForYou : quickPicks;

  const savedHomeScrollRef = useRef(0);

  const handleOpenTrending = useCallback(() => {
    savedHomeScrollRef.current = window.scrollY || document.documentElement.scrollTop || 0;
    setShowAllTrending(true);
    window.scrollTo(0, 0);
  }, []);

  const handleCloseTrending = useCallback(() => {
    setShowAllTrending(false);
    requestAnimationFrame(() => {
      window.scrollTo(0, savedHomeScrollRef.current);
    });
  }, []);

  if (showAllTrending) {
    return (
      <TrendingView
        tracks={displayTrending}
        onBack={handleCloseTrending}
        onSelectArtist={onSelectArtist}
        onSelectAlbum={onSelectAlbum}
      />
    );
  }

  return (
    <div className="animate-in fade-in duration-200 min-h-screen bg-gradient-to-b from-[#7C3AED]/12 via-[#6366F1]/06 to-transparent dark:from-[#1E1138]/60 dark:via-[#140C24]/40 dark:to-transparent">
      {/* ========================================================================= */}
      {/* HEADER / GREETING (Soft STUXS Atmosphere, Dynamic Name, Search Button) */}
      {/* ========================================================================= */}
      <Header
        showGreeting={true}
        onOpenAuth={onOpenAuth}
        onOpenUpload={onOpenUpload}
        onNavigateToSearch={onNavigateToSearch}
      />

      {/* ========================================================================= */}
      {/* MAIN CONTENT SHEET: Rounded Warm Cream / Deep Dark Surface */}
      {/* ========================================================================= */}
      <div className="rounded-t-[36px] sm:rounded-t-[40px] bg-[#FAF8F5] dark:bg-[#121218] min-h-screen px-4 sm:px-5 pt-5 pb-36 shadow-xl transition-colors">
        {/* Offline Status Indicator */}
        <div className="flex justify-center mb-3">
          <OfflineBanner />
        </div>

        {/* ========================================================================= */}
        {/* 1. TRENDING (Large Landscape Rounded Cards, Smooth Center Scaling) */}
        {/* ========================================================================= */}
        {(displayTrending.length > 0 || isLoading) && (
          <section className="mt-1">
            <SectionHeader
              title="Trending"
              subtitle="Most streamed viral tracks right now"
              actionText="See All"
              onAction={displayTrending.length > 0 ? handleOpenTrending : undefined}
            />
            {displayTrending.length > 0 ? (
              <TrendingCarousel3D
                tracks={displayTrending.slice(0, 10)}
                onPlayTrack={(track) => playTrack(track, displayTrending, { source: 'home' })}
              />
            ) : (
              /* High-fidelity Skeletons while loading initial network data */
              <div className="flex space-x-3.5 overflow-x-auto px-1 pb-2 scrollbar-none">
                {[1, 2, 3].map((i) => (
                  <div key={`trend-skel-${i}`} className="w-[270px] h-[165px] flex-shrink-0 rounded-[26px] bg-stuxs-surface-secondary/70 animate-pulse border border-stuxs-border/40" />
                ))}
              </div>
            )}
          </section>
        )}

        {/* ========================================================================= */}
        {/* 2. YOUR PLAYLISTS (IMMEDIATELY AFTER TRENDING — QUICK ACCESS PRIORITY) */}
        {/* ========================================================================= */}
        <section className="mt-5">
          <SectionHeader
            title="Your Playlists"
            subtitle="Custom collections curated by you"
            actionText="See All"
            onAction={playlists.length > 0 && onNavigateToLibrary ? onNavigateToLibrary : undefined}
          />

          {playlists.length > 0 ? (
            <div className="flex space-x-3.5 sm:space-x-4 overflow-x-auto pb-2 scrollbar-none">
              {playlists.map((playlist) => (
                <div
                  key={`home-pl-${playlist.id}`}
                  onClick={() => onSelectPlaylist(playlist.id)}
                  className="w-36 sm:w-40 flex-shrink-0 cursor-pointer group card-press"
                >
                  <div className="relative aspect-square rounded-[22px] overflow-hidden bg-stuxs-surface-secondary mb-2 shadow-sm group-hover:scale-[1.03] transition-transform ring-1 ring-black/5 dark:ring-white/10">
                    <PlaylistCover playlist={playlist} />
                    {/* Hover play affordance */}
                    <div className="absolute bottom-2.5 right-2.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (playlist.songs && playlist.songs.length > 0) {
                            playTrack(playlist.songs[0], playlist.songs, {
                              source: 'home',
                              id: playlist.id,
                              name: playlist.name,
                            });
                          } else {
                            onSelectPlaylist(playlist.id);
                          }
                        }}
                        className="w-8 h-8 rounded-full bg-purple-600 text-white flex items-center justify-center shadow-lg active:scale-90 transition-transform cursor-pointer"
                        aria-label={`Play ${playlist.name}`}
                      >
                        <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                      </button>
                    </div>
                  </div>
                  <h4 className="text-xs font-bold text-stuxs-text truncate leading-tight group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">
                    {playlist.name}
                  </h4>
                  <p className="text-[10px] font-medium text-stuxs-text-secondary truncate mt-0.5 leading-tight">
                    {playlist.songCount || playlist.songs?.length || 0} songs
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-4 rounded-2xl bg-stuxs-surface-secondary/40 border border-stuxs-border/50 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-stuxs-text">Create your first playlist</p>
                <p className="text-[10px] text-stuxs-text-secondary mt-0.5">Quickly organize your favorite songs</p>
              </div>
              {onNavigateToLibrary && (
                <button
                  onClick={onNavigateToLibrary}
                  className="px-3.5 py-1.5 rounded-full bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold flex items-center space-x-1 active:scale-95 transition-transform cursor-pointer shadow-sm"
                >
                  <Plus className="w-3 h-3" />
                  <span>Create</span>
                </button>
              )}
            </div>
          )}
        </section>

        {/* ========================================================================= */}
        {/* 3. RECENTLY PLAYED (Compact Vertical Rows, STUXS Purple Play Affordance) */}
        {/* ========================================================================= */}
        {recentlyPlayed.length > 0 && (
          <section className="mt-5">
            <SectionHeader
              title="Recently Played"
              subtitle="Jump back into your recent rotation"
              actionText="See All"
              onAction={recentlyPlayed.length > 3 && onNavigateToLibrary ? onNavigateToLibrary : undefined}
            />
            <div className="space-y-2">
              {recentlyPlayed.slice(0, 3).map((track) => (
                <div
                  key={`recent-row-${track.id}`}
                  onClick={() => playTrack(track, recentlyPlayed, { source: 'home' })}
                  className="flex items-center justify-between p-2.5 rounded-2xl bg-stuxs-surface-secondary/35 hover:bg-stuxs-surface-secondary/70 border border-stuxs-border/40 hover:border-purple-500/30 transition-all cursor-pointer group active:scale-[0.99]"
                >
                  <div className="flex items-center space-x-3 min-w-0 flex-1 mr-3">
                    <div className="w-13 h-13 sm:w-14 sm:h-14 rounded-2xl overflow-hidden bg-stuxs-surface-secondary flex-shrink-0 shadow-sm ring-1 ring-black/5 dark:ring-white/10">
                      <img
                        src={track.artworkUrl || BRANDING_CONFIG.appLogo}
                        alt={track.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                        loading="lazy"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = BRANDING_CONFIG.appLogo;
                        }}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="text-sm font-bold text-stuxs-text truncate leading-tight group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">
                        {track.title}
                      </h4>
                      <p className="text-xs text-stuxs-text-secondary truncate mt-0.5 leading-tight">
                        {track.artistName}
                      </p>
                      {track.duration ? (
                        <span className="text-[10px] text-stuxs-text-muted mt-0.5 inline-block">
                          {Math.floor(track.duration / 60)}:{(track.duration % 60).toString().padStart(2, '0')}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      playTrack(track, recentlyPlayed, { source: 'home' });
                    }}
                    className="w-10 h-10 rounded-full border-2 border-purple-500/70 text-purple-600 dark:text-purple-400 hover:bg-purple-600 hover:text-white flex items-center justify-center flex-shrink-0 active:scale-90 transition-all cursor-pointer shadow-xs"
                    aria-label={`Play ${track.title}`}
                  >
                    <Play className="w-4 h-4 fill-current ml-0.5" />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ========================================================================= */}
        {/* 4. MADE FOR YOU / RECOMMENDED (Large Rounded Cards, Smooth Spacing) */}
        {/* ========================================================================= */}
        {displayMadeForYou.length > 0 && (
          <section className="mt-5">
            <SectionHeader
              title="Made for You"
              subtitle="Curated based on your listening style"
            />
            <div className="flex space-x-3.5 overflow-x-auto pb-2 scrollbar-none">
              {displayMadeForYou.map((track, idx) => (
                <div
                  key={`made-${track.id}`}
                  onClick={() => playTrack(track, displayMadeForYou, { source: 'home' })}
                  className="w-36 sm:w-40 flex-shrink-0 cursor-pointer group card-press"
                >
                  <div className="relative aspect-square rounded-[22px] overflow-hidden bg-stuxs-surface-secondary mb-2 shadow-sm group-hover:scale-[1.03] transition-transform ring-1 ring-black/5 dark:ring-white/10">
                    <img
                      src={track.artworkUrl || BRANDING_CONFIG.appLogo}
                      alt={track.title}
                      className="w-full h-full object-cover"
                      loading={idx < 4 ? 'eager' : 'lazy'}
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = BRANDING_CONFIG.appLogo;
                      }}
                    />
                    {/* Hover play affordance */}
                    <div className="absolute bottom-2.5 right-2.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          playTrack(track, displayMadeForYou, { source: 'home' });
                        }}
                        className="w-8 h-8 rounded-full bg-purple-600 text-white flex items-center justify-center shadow-lg active:scale-90 transition-transform cursor-pointer"
                        aria-label={`Play ${track.title}`}
                      >
                        <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                      </button>
                    </div>
                  </div>
                  <h4 className="text-xs font-bold text-stuxs-text truncate group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors leading-tight">
                    {track.title}
                  </h4>
                  <p className="text-[10px] text-stuxs-text-secondary truncate mt-0.5 leading-tight">
                    {track.artistName}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ========================================================================= */}
        {/* 5. POPULAR SINGERS (Circular Artist Cards) */}
        {/* ========================================================================= */}
        {featuredArtists.length > 0 && (
          <section className="mt-5">
            <SectionHeader
              title="Popular Singers"
              subtitle="Chart-topping vocalists & featured artists"
              actionText="See All"
              onAction={() => setShowAllArtists(true)}
            />
            <div className="flex space-x-4 overflow-x-auto pb-2 scrollbar-none">
              {featuredArtists.map((artist) => (
                <div
                  key={`singer-${artist.id}`}
                  onClick={() => onSelectArtist(artist.id)}
                  className="w-24 sm:w-28 flex-shrink-0 cursor-pointer group flex flex-col items-center card-press"
                >
                  <div className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-full overflow-hidden bg-stuxs-surface-secondary mb-2 ring-2 ring-stuxs-border/60 group-hover:ring-purple-500/60 group-hover:scale-105 transition-all shadow-sm">
                    <img
                      src={artist.artworkUrl || BRANDING_CONFIG.appLogo}
                      alt={artist.name}
                      className="w-full h-full object-cover"
                      loading="lazy"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = BRANDING_CONFIG.appLogo;
                      }}
                    />
                  </div>
                  <div className="flex items-center space-x-1 max-w-full px-1">
                    <h4 className="text-xs font-bold text-stuxs-text truncate text-center group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">
                      {artist.name}
                    </h4>
                    {artist.isVerified && (
                      <BadgeCheck className="w-3 h-3 text-purple-600 dark:text-purple-400 flex-shrink-0" />
                    )}
                  </div>
                  <p className="text-[10px] text-stuxs-text-muted mt-0.5">Singer</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ========================================================================= */}
        {/* 6. BECAUSE YOU PLAYED [Song] (Contextual Discovery) */}
        {/* ========================================================================= */}
        {becauseYouPlayed && becauseYouPlayed.tracks.length > 0 && (
          <section className="mt-5">
            <SectionHeader
              title={`Because you played ${becauseYouPlayed.seedTrack.title}`}
              subtitle={`More music inspired by ${becauseYouPlayed.seedTrack.artistName}`}
            />
            <div className="space-y-1">
              {becauseYouPlayed.tracks.map((track, idx) => (
                <TrackRow
                  key={`byp-${track.id}`}
                  track={track}
                  index={idx}
                  showIndex={false}
                  context="home"
                  playlistContext={becauseYouPlayed.tracks}
                  onSelectArtist={onSelectArtist}
                  onSelectAlbum={onSelectAlbum}
                />
              ))}
            </div>
          </section>
        )}

        {/* ========================================================================= */}
        {/* 7. POPULAR ALBUMS (Studio Productions) */}
        {/* ========================================================================= */}
        {featuredAlbums.length > 0 && (
          <section className="mt-5">
            <SectionHeader
              title="Popular Albums"
              subtitle="Full length studio productions"
            />
            <div className="flex space-x-4 overflow-x-auto pb-2 scrollbar-none">
              {featuredAlbums.map((album) => (
                <AlbumCard
                  key={`alb-${album.id}`}
                  album={album}
                  onSelect={(id) => onSelectAlbum(id)}
                  size="normal"
                />
              ))}
            </div>
          </section>
        )}

        {/* ========================================================================= */}
        {/* 8. FEATURED PLAYLISTS (Curated Discovery) */}
        {/* ========================================================================= */}
        {featuredPlaylists && featuredPlaylists.length > 0 && (
          <section className="mt-5">
            <SectionHeader
              title="Explore Playlists"
              subtitle="Curated mixes and chartbusters"
            />
            <div className="flex space-x-4 overflow-x-auto pb-2 scrollbar-none">
              {featuredPlaylists.map((pl) => (
                <div key={`pl-${pl.id}`} className="w-36 sm:w-40 flex-shrink-0">
                  <PlaylistCard
                    playlist={pl}
                    onSelect={(id) => onSelectPlaylist(id)}
                  />
                </div>
              ))}
            </div>
          </section>
        )}

      </div>


      {/* ========================================================================= */}
      {/* MODAL: See All Popular Singers */}
      {/* ========================================================================= */}
      {showAllArtists && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex flex-col animate-dialog-in">
          <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-stuxs-border">
            <div>
              <h2 className="text-lg font-bold text-stuxs-text">Popular Singers</h2>
              <p className="text-xs text-stuxs-text-secondary">Featured vocalists and chart leaders</p>
            </div>
            <button
              onClick={() => setShowAllArtists(false)}
              className="p-2 rounded-full bg-stuxs-surface-secondary text-stuxs-text-secondary hover:text-stuxs-text active:scale-90 transition-transform"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-5 grid grid-cols-3 sm:grid-cols-4 gap-4">
            {featuredArtists.map((artist) => (
              <div
                key={`all-singer-${artist.id}`}
                onClick={() => {
                  setShowAllArtists(false);
                  onSelectArtist(artist.id);
                }}
                className="flex flex-col items-center cursor-pointer group card-press"
              >
                <div className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-full overflow-hidden bg-stuxs-surface-secondary mb-2 ring-2 ring-stuxs-border/60 group-hover:ring-stuxs-accent/60 group-hover:scale-105 transition-all shadow-sm">
                  <img
                    src={artist.artworkUrl || BRANDING_CONFIG.appLogo}
                    alt={artist.name}
                    className="w-full h-full object-cover"
                    loading="lazy"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = BRANDING_CONFIG.appLogo;
                    }}
                  />
                </div>
                <h4 className="text-xs font-semibold text-stuxs-text truncate max-w-full text-center group-hover:text-stuxs-accent transition-colors">
                  {artist.name}
                </h4>
                <p className="text-[10px] text-stuxs-text-muted mt-0.5">Singer</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

HomeScreen.displayName = 'HomeScreen';

