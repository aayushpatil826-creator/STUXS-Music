import React, { useState, useEffect, useMemo } from 'react';
import {
  Plus,
  Heart,
  DownloadCloud,
  ListMusic,
  Disc,
  Users,
  HardDrive,
  Upload,
  Play,
  Clock,
} from 'lucide-react';
import { useLibrary } from '../context/LibraryContext';
import { usePlayerActions } from '../context/PlayerContext';
import { TrackRow } from '../components/common/TrackRow';
import { PlaylistCard } from '../components/common/PlaylistCard';
import { PlaylistCover } from '../components/common/PlaylistCover';
import { AlbumCard } from '../components/common/AlbumCard';
import { ArtistCard } from '../components/common/ArtistCard';
import { SectionHeader } from '../components/common/SectionHeader';
import { CreatePlaylistModal } from '../components/modals/CreatePlaylistModal';
import { ImportModal } from '../components/modals/ImportModal';
import { EmptyState } from '../components/common/EmptyState';
import { homeDiscoveryService } from '../services/HomeDiscoveryService';
import type { Album, Artist, Playlist } from '../types/music';

type LibraryTab = 'all' | 'playlists' | 'songs' | 'history' | 'downloads' | 'local' | 'albums' | 'artists';

interface LibraryScreenProps {
  onSelectArtist: (artistId: string) => void;
  onSelectAlbum: (albumId?: string) => void;
  onSelectPlaylist: (playlistId: string) => void;
}

export const LibraryScreen: React.FC<LibraryScreenProps> = React.memo(({
  onSelectArtist,
  onSelectAlbum,
  onSelectPlaylist,
}) => {
  const {
    favorites,
    playlists,
    savedPlaylists,
    localTracks,
    downloadedTracks,
    recentlyPlayed,
    refreshDownloads,
  } = useLibrary();
  const { playTrack } = usePlayerActions();

  const [activeTab, setActiveTab] = useState<LibraryTab>('all');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [discoverPlaylists, setDiscoverPlaylists] = useState<Playlist[]>([]);

  // Self-heal & verify downloaded files when opening Downloads tab
  useEffect(() => {
    if (activeTab === 'downloads') {
      refreshDownloads().catch(() => {});
    }
  }, [activeTab, refreshDownloads]);

  // Fetch real live discover playlists from JioSaavn
  useEffect(() => {
    let isCancelled = false;
    const loadDiscover = async () => {
      try {
        const list = await homeDiscoveryService.getDiscoverPlaylists('Trending Hits India');
        if (!isCancelled && list.length > 0) {
          setDiscoverPlaylists(list);
        }
      } catch (err) {
        console.warn('[LibraryScreen] Error loading discover playlists:', err);
      }
    };
    loadDiscover();
    return () => {
      isCancelled = true;
    };
  }, []);

  const tabs: { id: LibraryTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'all', label: 'Overview', icon: ListMusic },
    { id: 'playlists', label: 'Playlists', icon: ListMusic },
    { id: 'songs', label: 'Liked Songs', icon: Heart },
    { id: 'history', label: 'History', icon: Clock },
    { id: 'downloads', label: 'Downloads', icon: DownloadCloud },
    { id: 'local', label: 'Local Music', icon: HardDrive },
    { id: 'artists', label: 'Artists', icon: Users },
    { id: 'albums', label: 'Albums', icon: Disc },
  ];

  // Derive unique saved albums from liked tracks & playlists
  const savedAlbums = useMemo(() => {
    const allTracks = [...favorites, ...localTracks, ...downloadedTracks];
    for (const p of playlists) {
      if (p.songs) allTracks.push(...p.songs);
    }
    for (const p of savedPlaylists) {
      if (p.songs) allTracks.push(...p.songs);
    }

    const seen = new Set<string>();
    const result: Album[] = [];

    for (const t of allTracks) {
      const albumKey = t.albumId || t.albumTitle;
      if (albumKey && !seen.has(albumKey)) {
        seen.add(albumKey);
        result.push({
          id: t.albumId || `album-${encodeURIComponent(t.albumTitle || 'album')}`,
          title: t.albumTitle || 'Album',
          artistId: t.artistId,
          artistName: t.artistName,
          artworkUrl: t.artworkUrl,
          releaseDate: '',
          genre: 'Music',
          trackCount: 1,
          provider: t.provider,
          providerId: t.albumId,
        });
      }
    }
    return result;
  }, [favorites, playlists, savedPlaylists, localTracks, downloadedTracks]);

  // Derive unique saved artists from liked tracks & playlists
  const savedArtists = useMemo(() => {
    const allTracks = [...favorites, ...localTracks, ...downloadedTracks];
    for (const p of playlists) {
      if (p.songs) allTracks.push(...p.songs);
    }
    for (const p of savedPlaylists) {
      if (p.songs) allTracks.push(...p.songs);
    }

    const seen = new Set<string>();
    const result: Artist[] = [];

    for (const t of allTracks) {
      if (t.artistName && !seen.has(t.artistName)) {
        seen.add(t.artistName);
        result.push({
          id: t.artistId || `artist-${encodeURIComponent(t.artistName)}`,
          name: t.artistName,
          artworkUrl: t.artworkUrl,
          provider: t.provider,
          providerArtistId: t.artistId,
        });
      }
    }
    return result;
  }, [favorites, playlists, savedPlaylists, localTracks, downloadedTracks]);

  const formatFileSize = (bytes?: number) => {
    if (!bytes || bytes <= 0) return '';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  const totalDownloadBytes = useMemo(() => {
    return downloadedTracks.reduce((acc, t) => acc + (t.fileSize || 0), 0);
  }, [downloadedTracks]);

  const totalLocalBytes = useMemo(() => {
    return localTracks.reduce((acc, t) => acc + (t.fileSize || 0), 0);
  }, [localTracks]);

  return (
    <div className="animate-in fade-in duration-200 min-h-screen bg-gradient-to-b from-[#7C3AED]/12 via-[#6366F1]/06 to-transparent dark:from-[#1E1138]/60 dark:via-[#140C24]/40 dark:to-transparent">
      {/* Top Header with STUXS Atmosphere */}
      <div className="px-5 safe-top-header pt-2 pb-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl sm:text-[26px] font-black tracking-tight text-stuxs-text">
              Your Library
            </h1>
            <p className="text-xs font-medium text-stuxs-text-secondary mt-0.5">
              Custom collections & saved music
            </p>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setIsImportModalOpen(true)}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-white dark:bg-white/10 text-slate-800 dark:text-white border border-black/5 dark:border-white/10 text-xs font-semibold active:scale-95 transition-all shadow-sm cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
              <span>Import</span>
            </button>
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="w-9 h-9 rounded-full bg-purple-600 hover:bg-purple-500 text-white flex items-center justify-center shadow-sm active:scale-95 transition-all cursor-pointer"
              aria-label="Create Playlist"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab Filter Pills (Strictly matching Home chip styling) */}
        <div
          className="flex items-center space-x-2 mt-3 overflow-x-auto overflow-y-hidden no-scrollbar scrollbar-none py-1 -mx-5 px-5"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'bg-white/80 dark:bg-white/10 text-stuxs-text-secondary hover:text-stuxs-text border border-black/5 dark:border-white/10'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Content Sheet: Rounded Warm Cream / Deep Dark Surface */}
      <div className="rounded-t-[36px] sm:rounded-t-[40px] bg-[#FAF8F5] dark:bg-[#121218] min-h-screen px-4 sm:px-5 pt-5 pb-36 shadow-xl transition-colors">
        {/* Overview (All) Tab */}
        {activeTab === 'all' && (
          <div className="space-y-6">
            {/* 1. YOUR PLAYLISTS (PROMINENT — EXACT HOME PLAYLIST TREATMENT) */}
            <section>
              <SectionHeader
                title="Your Playlists"
                subtitle="Custom collections curated by you"
                actionText="See All"
                onAction={playlists.length > 0 ? () => setActiveTab('playlists') : undefined}
              />

              {playlists.length > 0 ? (
                <div className="flex space-x-3.5 sm:space-x-4 overflow-x-auto pb-2 scrollbar-none">
                  {playlists.map((playlist) => (
                    <div
                      key={`lib-home-pl-${playlist.id}`}
                      onClick={() => onSelectPlaylist(playlist.id)}
                      className="w-36 sm:w-40 flex-shrink-0 cursor-pointer group card-press"
                    >
                      <div className="relative aspect-square rounded-[22px] overflow-hidden bg-stuxs-surface-secondary mb-2 shadow-sm group-hover:scale-[1.03] transition-transform ring-1 ring-black/5 dark:ring-white/10">
                        <PlaylistCover playlist={playlist} />
                        <div className="absolute bottom-2.5 right-2.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (playlist.songs && playlist.songs.length > 0) {
                                playTrack(playlist.songs[0], playlist.songs, {
                                  source: 'library-playlist',
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
                  <button
                    onClick={() => setIsCreateModalOpen(true)}
                    className="px-3.5 py-1.5 rounded-full bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold flex items-center space-x-1 active:scale-95 transition-transform cursor-pointer shadow-sm"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Create</span>
                  </button>
                </div>
              )}
            </section>

            {/* 2. USEFUL REAL COLLECTIONS (Liked Songs, Downloads, Local Music, Artists) */}
            <section>
              <SectionHeader
                title="Collections"
                subtitle="Your saved and offline libraries"
              />
              <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
                {/* Liked Songs */}
                <div
                  onClick={() => setActiveTab('songs')}
                  className="p-3.5 rounded-2xl bg-stuxs-surface-secondary/35 hover:bg-stuxs-surface-secondary/70 border border-stuxs-border/40 hover:border-purple-500/30 transition-all cursor-pointer card-press flex items-center space-x-3 shadow-xs"
                >
                  <div className="w-10 h-10 rounded-2xl bg-rose-500/10 flex items-center justify-center flex-shrink-0">
                    <Heart className="w-5 h-5 text-rose-500 fill-rose-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-xs sm:text-sm font-bold text-stuxs-text truncate leading-tight">Liked Songs</h3>
                    <p className="text-[10px] text-stuxs-text-secondary mt-0.5 font-medium truncate">
                      {favorites.length} {favorites.length === 1 ? 'song' : 'songs'}
                    </p>
                  </div>
                </div>

                {/* History */}
                <div
                  onClick={() => setActiveTab('history')}
                  className="p-3.5 rounded-2xl bg-stuxs-surface-secondary/35 hover:bg-stuxs-surface-secondary/70 border border-stuxs-border/40 hover:border-purple-500/30 transition-all cursor-pointer card-press flex items-center space-x-3 shadow-xs"
                >
                  <div className="w-10 h-10 rounded-2xl bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                    <Clock className="w-5 h-5 text-amber-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-xs sm:text-sm font-bold text-stuxs-text truncate leading-tight">History</h3>
                    <p className="text-[10px] text-stuxs-text-secondary mt-0.5 font-medium truncate">
                      {recentlyPlayed.length} {recentlyPlayed.length === 1 ? 'song' : 'songs'}
                    </p>
                  </div>
                </div>

                {/* Downloads */}
                <div
                  onClick={() => setActiveTab('downloads')}
                  className="p-3.5 rounded-2xl bg-stuxs-surface-secondary/35 hover:bg-stuxs-surface-secondary/70 border border-stuxs-border/40 hover:border-purple-500/30 transition-all cursor-pointer card-press flex items-center space-x-3 shadow-xs"
                >
                  <div className="w-10 h-10 rounded-2xl bg-purple-500/10 flex items-center justify-center flex-shrink-0">
                    <DownloadCloud className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-xs sm:text-sm font-bold text-stuxs-text truncate leading-tight">Downloads</h3>
                    <p className="text-[10px] text-stuxs-text-secondary mt-0.5 font-medium truncate">
                      {downloadedTracks.length} {downloadedTracks.length === 1 ? 'song' : 'songs'}
                    </p>
                  </div>
                </div>

                {/* Local Music */}
                <div
                  onClick={() => setActiveTab('local')}
                  className="p-3.5 rounded-2xl bg-stuxs-surface-secondary/35 hover:bg-stuxs-surface-secondary/70 border border-stuxs-border/40 hover:border-purple-500/30 transition-all cursor-pointer card-press flex items-center space-x-3 shadow-xs"
                >
                  <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                    <HardDrive className="w-5 h-5 text-emerald-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-xs sm:text-sm font-bold text-stuxs-text truncate leading-tight">Local Music</h3>
                    <p className="text-[10px] text-stuxs-text-secondary mt-0.5 font-medium truncate">
                      {localTracks.length} {localTracks.length === 1 ? 'song' : 'songs'}
                    </p>
                  </div>
                </div>

                {/* Artists */}
                <div
                  onClick={() => setActiveTab('artists')}
                  className="p-3.5 rounded-2xl bg-stuxs-surface-secondary/35 hover:bg-stuxs-surface-secondary/70 border border-stuxs-border/40 hover:border-purple-500/30 transition-all cursor-pointer card-press flex items-center space-x-3 shadow-xs"
                >
                  <div className="w-10 h-10 rounded-2xl bg-pink-500/10 flex items-center justify-center flex-shrink-0">
                    <Users className="w-5 h-5 text-pink-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-xs sm:text-sm font-bold text-stuxs-text truncate leading-tight">Artists</h3>
                    <p className="text-[10px] text-stuxs-text-secondary mt-0.5 font-medium truncate">
                      {savedArtists.length} {savedArtists.length === 1 ? 'artist' : 'artists'}
                    </p>
                  </div>
                </div>

                {/* Albums */}
                <div
                  onClick={() => setActiveTab('albums')}
                  className="p-3.5 rounded-2xl bg-stuxs-surface-secondary/35 hover:bg-stuxs-surface-secondary/70 border border-stuxs-border/40 hover:border-purple-500/30 transition-all cursor-pointer card-press flex items-center space-x-3 shadow-xs"
                >
                  <div className="w-10 h-10 rounded-2xl bg-indigo-500/10 flex items-center justify-center flex-shrink-0">
                    <Disc className="w-5 h-5 text-indigo-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-xs sm:text-sm font-bold text-stuxs-text truncate leading-tight">Albums</h3>
                    <p className="text-[10px] text-stuxs-text-secondary mt-0.5 font-medium truncate">
                      {savedAlbums.length} {savedAlbums.length === 1 ? 'album' : 'albums'}
                    </p>
                  </div>
                </div>
              </div>
            </section>

            {/* 3. RECENTLY PLAYED (Matching Home compact rows) */}
            {recentlyPlayed.length > 0 && (
              <section>
                <SectionHeader
                  title="Recently Played"
                  subtitle="Jump back into your recent rotation"
                  actionText="See All"
                  onAction={() => setActiveTab('history')}
                />

                <div className="space-y-2">
                  {recentlyPlayed.slice(0, 4).map((track) => (
                    <TrackRow
                      key={`lib-recent-${track.id}`}
                      track={track}
                      context="library"
                      playlistContext={recentlyPlayed}
                      onSelectArtist={onSelectArtist}
                      onSelectAlbum={onSelectAlbum}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* 4. DISCOVER / SAVED PLAYLISTS */}
            {discoverPlaylists.length > 0 && (
              <section>
                <SectionHeader
                  title="Discover Playlists"
                  subtitle="Trending collections from JioSaavn & curated channels"
                />
                <div className="grid grid-cols-3 gap-x-2.5 sm:gap-x-4 gap-y-5">
                  {discoverPlaylists.map((playlist) => (
                    <PlaylistCard
                      key={playlist.id}
                      playlist={playlist}
                      onSelect={onSelectPlaylist}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {/* Playlists Tab */}
        {activeTab === 'playlists' && (
          <div className="space-y-6">
            <div>
              <SectionHeader
                title="Your Playlists"
                subtitle="Custom collections created by you"
              />
              {playlists.length === 0 ? (
                <EmptyState
                  icon="library"
                  title="No playlists yet"
                  description="You haven't created any playlists yet. Organize your favorite songs into custom collections."
                  actionText="Create Playlist"
                  onAction={() => setIsCreateModalOpen(true)}
                />
              ) : (
                <div className="grid grid-cols-3 gap-x-2.5 sm:gap-x-4 gap-y-5">
                  {playlists.map((playlist) => (
                    <PlaylistCard
                      key={playlist.id}
                      playlist={playlist}
                      onSelect={onSelectPlaylist}
                    />
                  ))}
                </div>
              )}
            </div>

            {savedPlaylists.length > 0 && (
              <div>
                <SectionHeader
                  title="Saved Playlists"
                  subtitle="Live provider playlists saved to your library"
                />
                <div className="grid grid-cols-3 gap-x-2.5 sm:gap-x-4 gap-y-5">
                  {savedPlaylists.map((playlist) => (
                    <PlaylistCard
                      key={playlist.id}
                      playlist={playlist}
                      onSelect={onSelectPlaylist}
                    />
                  ))}
                </div>
              </div>
            )}

            {discoverPlaylists.length > 0 && (
              <div>
                <SectionHeader
                  title="Discover Playlists"
                  subtitle="Trending collections from JioSaavn & curated channels"
                />
                <div className="grid grid-cols-3 gap-x-2.5 sm:gap-x-4 gap-y-5">
                  {discoverPlaylists.map((playlist) => (
                    <PlaylistCard
                      key={playlist.id}
                      playlist={playlist}
                      onSelect={onSelectPlaylist}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Songs (Favorites) Tab */}
        {activeTab === 'songs' && (
          <div>
            {favorites.length === 0 ? (
              <EmptyState
                icon="music"
                title="No liked songs yet"
                description="Tap the heart icon on any song while listening to add it to your favorites."
                actionText="Explore Music"
                onAction={() => setActiveTab('all')}
              />
            ) : (
              <div className="space-y-4">
                <div className="p-4 rounded-2xl bg-stuxs-surface-secondary border border-stuxs-border flex items-center justify-between shadow-xs">
                  <div>
                    <h3 className="text-sm font-bold text-stuxs-text">Liked Songs</h3>
                    <p className="text-xs text-stuxs-text-secondary mt-0.5">
                      {favorites.length} {favorites.length === 1 ? 'track' : 'tracks'}
                    </p>
                  </div>
                  <button
                    onClick={() => playTrack(favorites[0], favorites, { source: 'library-playlist' })}
                    className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-full bg-stuxs-accent text-white text-xs font-bold shadow-stuxs-glow hover:opacity-90 active:scale-95 cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Play All</span>
                  </button>
                </div>

                <div className="space-y-1">
                  {favorites.map((track, idx) => (
                    <TrackRow
                      key={track.id}
                      track={track}
                      index={idx}
                      showIndex={true}
                      context="library"
                      playlistContext={favorites}
                      onSelectArtist={onSelectArtist}
                      onSelectAlbum={onSelectAlbum}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* History (Recently Played) Tab */}
        {activeTab === 'history' && (
          <div>
            {recentlyPlayed.length === 0 ? (
              <EmptyState
                icon="music"
                title="No listening history yet"
                description="Songs you play will appear here so you can easily jump back into your recent rotation."
                actionText="Explore Music"
                onAction={() => setActiveTab('all')}
              />
            ) : (
              <div className="space-y-4">
                <div className="p-4 rounded-2xl bg-stuxs-surface-secondary border border-stuxs-border flex items-center justify-between shadow-xs">
                  <div>
                    <h3 className="text-sm font-bold text-stuxs-text">Recently Played</h3>
                    <p className="text-xs text-stuxs-text-secondary mt-0.5">
                      {recentlyPlayed.length} {recentlyPlayed.length === 1 ? 'track' : 'tracks'} in your rotation
                    </p>
                  </div>
                  <button
                    onClick={() => playTrack(recentlyPlayed[0], recentlyPlayed, { source: 'individual' })}
                    className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-full bg-stuxs-accent text-white text-xs font-bold shadow-stuxs-glow hover:opacity-90 active:scale-95 cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Play All</span>
                  </button>
                </div>

                <div className="space-y-1">
                  {recentlyPlayed.map((track, idx) => (
                    <TrackRow
                      key={`hist-${track.id}-${idx}`}
                      track={track}
                      index={idx}
                      showIndex={true}
                      context="library"
                      playlistContext={recentlyPlayed}
                      onSelectArtist={onSelectArtist}
                      onSelectAlbum={onSelectAlbum}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Downloads Tab */}
        {activeTab === 'downloads' && (
          <div className="space-y-4">
            <div className="p-4 rounded-2xl bg-stuxs-surface-secondary border border-stuxs-border flex items-center justify-between shadow-xs">
              <div>
                <h3 className="text-sm font-bold text-stuxs-text">Offline Downloads</h3>
                <p className="text-xs text-stuxs-text-secondary mt-0.5">
                  {downloadedTracks.length} tracks • {formatFileSize(totalDownloadBytes) || '0 MB'} saved offline
                </p>
              </div>
              {downloadedTracks.length > 0 && (
                <button
                  onClick={() => playTrack(downloadedTracks[0], downloadedTracks, { source: 'individual' })}
                  className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-full bg-stuxs-accent text-white text-xs font-bold shadow-stuxs-glow hover:opacity-90 active:scale-95 cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Play All</span>
                </button>
              )}
            </div>

            {downloadedTracks.length === 0 ? (
              <EmptyState
                icon="music"
                title="No downloaded tracks yet"
                description="Tap the download icon on any song's action menu to store it for offline playback."
                actionText="Find Music"
                onAction={() => setActiveTab('all')}
              />
            ) : (
              <div className="space-y-1">
                {downloadedTracks.map((track, idx) => (
                  <TrackRow
                    key={track.id}
                    track={track}
                    index={idx}
                    showIndex={true}
                    context="library"
                    playlistContext={downloadedTracks}
                    onSelectArtist={onSelectArtist}
                    onSelectAlbum={onSelectAlbum}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Local Music Tab */}
        {activeTab === 'local' && (
          <div className="space-y-4">
            <div className="p-4 rounded-2xl bg-stuxs-surface-secondary border border-stuxs-border flex items-center justify-between shadow-xs">
              <div>
                <h3 className="text-sm font-bold text-stuxs-text">Imported Local Music</h3>
                <p className="text-xs text-stuxs-text-secondary mt-0.5">
                  {localTracks.length} tracks • {formatFileSize(totalLocalBytes) || '0 MB'} on this device
                </p>
              </div>
              <button
                onClick={() => setIsImportModalOpen(true)}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-stuxs-accent text-white text-xs font-bold shadow-stuxs-glow hover:opacity-90 active:scale-95 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Import Files</span>
              </button>
            </div>

            {localTracks.length === 0 ? (
              <div className="py-12 flex flex-col items-center justify-center text-center p-6 space-y-4 bg-stuxs-surface-secondary/40 rounded-3xl border border-stuxs-border/60">
                <div className="w-16 h-16 rounded-2xl bg-stuxs-surface flex items-center justify-center text-stuxs-accent shadow-inner">
                  <HardDrive className="w-8 h-8" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-stuxs-text">No Local Music Imported</h3>
                  <p className="text-xs text-stuxs-text-secondary max-w-xs mt-1">
                    Import audio files (MP3, M4A, WAV, FLAC) from your device to play offline anytime.
                  </p>
                </div>
                <button
                  onClick={() => setIsImportModalOpen(true)}
                  className="px-5 py-2.5 rounded-full bg-stuxs-accent text-white text-xs font-bold shadow-stuxs-glow hover:opacity-90 active:scale-95 cursor-pointer"
                >
                  Choose Audio Files
                </button>
              </div>
            ) : (
              <div className="space-y-1">
                {localTracks.map((track, idx) => (
                  <TrackRow
                    key={track.id}
                    track={track}
                    index={idx}
                    showIndex={true}
                    context="library"
                    playlistContext={localTracks}
                    onSelectArtist={onSelectArtist}
                    onSelectAlbum={onSelectAlbum}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Albums Tab */}
        {activeTab === 'albums' && (
          <div>
            {savedAlbums.length === 0 ? (
              <EmptyState
                icon="disc"
                title="No saved albums yet"
                description="Albums from your liked songs and playlists will appear here."
                actionText="Explore Music"
                onAction={() => setActiveTab('all')}
              />
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-x-2.5 sm:gap-x-3.5 gap-y-5">
                {savedAlbums.map((album) => (
                  <AlbumCard
                    key={album.id}
                    album={album}
                    onSelect={(id) => onSelectAlbum(id)}
                    size="fluid"
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Artists Tab */}
        {activeTab === 'artists' && (
          <div>
            {savedArtists.length === 0 ? (
              <EmptyState
                icon="search"
                title="No artists in library yet"
                description="Artists from your liked tracks and playlists will appear here."
                actionText="Explore Music"
                onAction={() => setActiveTab('all')}
              />
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-x-2.5 gap-y-5">
                {savedArtists.map((artist) => (
                  <ArtistCard
                    key={artist.id}
                    artist={artist}
                    onSelect={onSelectArtist}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Create Playlist Modal */}
      <CreatePlaylistModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onCreated={(id) => onSelectPlaylist(id)}
      />

      {/* Import Modal */}
      <ImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onSuccess={() => {}}
      />
    </div>
  );
});

LibraryScreen.displayName = 'LibraryScreen';

