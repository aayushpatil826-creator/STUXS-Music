import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import type { Playlist, Track } from '../types/music';
import { useAuth } from './AuthContext';
import { supabase, isSupabaseConfigured } from '../config/supabase';
import { LocalMusicService } from '../services/LocalMusicService';
import { downloadService, type DownloadStatus } from '../services/DownloadService';
import { M3UParserService, type M3UImportResult } from '../services/M3UParserService';

export interface AddToPlaylistResult {
  success: boolean;
  alreadyExists: boolean;
  message: string;
}

interface LibraryContextType {
  favorites: Track[];
  playlists: Playlist[];
  savedPlaylists: Playlist[];
  recentlyPlayed: Track[];
  localTracks: Track[];
  downloadedTracks: Track[];
  isFavorite: (trackId: string) => boolean;
  toggleFavorite: (track: Track) => void;
  createPlaylist: (name: string, description?: string, initialTracks?: Track[] | Track) => Promise<Playlist>;
  addTrackToPlaylist: (playlistId: string, track: Track) => Promise<AddToPlaylistResult>;
  addTracksToPlaylist: (playlistId: string, tracks: Track[]) => Promise<{ addedCount: number; alreadyExistsCount: number }>;
  getPlaylistById: (playlistId: string) => Playlist | undefined;
  removeTrackFromPlaylist: (playlistId: string, trackId: string) => Promise<{ success: boolean; message: string }>;
  isTrackInPlaylist: (playlistId: string, track: Track | string) => boolean;
  reorderPlaylist: (playlistId: string, startIndex: number, endIndex: number) => void;
  renamePlaylist: (playlistId: string, newName: string) => Promise<boolean>;
  deletePlaylist: (playlistId: string) => Promise<void>;
  isPlaylistSaved: (playlistId: string) => boolean;
  savePlaylist: (playlist: Playlist) => void;
  unsavePlaylist: (playlistId: string) => void;
  toggleSavePlaylist: (playlist: Playlist) => void;
  addToRecentlyPlayed: (track: Track) => void;
  importLocalFiles: (
    files: FileList | File[],
    onProgress?: (current: number, total: number, currentName?: string) => void
  ) => Promise<Track[]>;
  deleteLocalTrack: (id: string) => Promise<void>;
  importM3UFile: (
    file: File,
    onProgress?: (current: number, total: number, currentName?: string) => void
  ) => Promise<M3UImportResult>;
  downloadTrack: (track: Track) => Promise<void>;
  downloadPlaylist: (tracks: Track[], playlistId?: string, onProgress?: (completed: number, total: number, failed: number) => void) => Promise<{ total: number; skipped: number; downloaded: number; failed: number }>;
  cancelPlaylistDownload: (playlistId?: string) => void;
  isPlaylistDownloading: (playlistId: string) => boolean;
  removeDownloadedTrack: (trackId: string) => Promise<void>;
  isDownloaded: (trackId: string) => boolean;
  getActualDownloadStatus: (trackId: string) => Promise<DownloadStatus>;
  getDownloadProgress: (trackId: string) => { status: DownloadStatus; percent: number };
  refreshDownloads: () => Promise<Track[]>;
}

// RFC4122 v4 UUID generator compliant with PostgreSQL UUID columns
export const generateUUID = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch {}
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

// Stable Track ID Normalizer to ensure consistent IDs across search, player, and library
export const normalizeTrackId = (track: Track | string | null | undefined): string => {
  if (!track) return '';
  if (typeof track === 'string') return track.trim();
  if (track.id) return String(track.id).trim();
  if (track.providerId) return String(track.providerId).trim();
  return '';
};

const LibraryContext = createContext<LibraryContextType | undefined>(undefined);

// Helper to filter out legacy mock items from local storage
const isRealTrack = (t: Track): boolean => {
  if (!t || !t.id) return false;
  if (t.id.startsWith('mock-')) return false;
  return true;
};

const isRealUserPlaylist = (p: Playlist): boolean => {
  if (!p || !p.id || !p.name) return false;
  if (p.id.startsWith('mock-') || p.id.startsWith('pl-featured-')) return false;
  if (['playlist-1', 'playlist-2', 'playlist-3', 'playlist-4'].includes(p.id)) return false;
  if (
    p.name.includes('Obsidian Flow') ||
    p.name.includes('Pure Focus: 40Hz') ||
    p.name.includes('Kinetic Drive:') ||
    p.name.includes('Tokyo Sessions')
  ) {
    return false;
  }
  return true;
};

export const LibraryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const configured = isSupabaseConfigured();

  const [favorites, setFavorites] = useState<Track[]>(() => {
    try {
      const saved = localStorage.getItem('stuxs_favorites');
      if (saved) {
        const parsed: Track[] = JSON.parse(saved);
        return parsed.filter(isRealTrack);
      }
    } catch {
      // ignore
    }
    return [];
  });

  const [playlists, setPlaylists] = useState<Playlist[]>(() => {
    try {
      const saved = localStorage.getItem('stuxs_user_playlists');
      if (saved) {
        const parsed: Playlist[] = JSON.parse(saved);
        return parsed.filter(isRealUserPlaylist);
      }
    } catch {
      // ignore
    }
    return [];
  });

  const [savedPlaylists, setSavedPlaylists] = useState<Playlist[]>(() => {
    try {
      const saved = localStorage.getItem('stuxs_saved_playlists');
      if (saved) {
        const parsed: Playlist[] = JSON.parse(saved);
        return parsed.filter(isRealUserPlaylist);
      }
    } catch {
      // ignore
    }
    return [];
  });

  const [recentlyPlayed, setRecentlyPlayed] = useState<Track[]>(() => {
    try {
      const saved = localStorage.getItem('stuxs_recently_played');
      if (saved) {
        const parsed: Track[] = JSON.parse(saved);
        return parsed.filter(isRealTrack);
      }
    } catch {
      // ignore
    }
    return [];
  });

  const [localTracks, setLocalTracks] = useState<Track[]>([]);
  const [downloadedTracks, setDownloadedTracks] = useState<Track[]>([]);
  const [downloadProgresses, setDownloadProgresses] = useState<
    Record<string, { status: DownloadStatus; percent: number }>
  >({});

  // Initialize Local Tracks and Downloaded Tracks from IndexedDB
  useEffect(() => {
    LocalMusicService.loadAllLocalTracks().then((tracks) => {
      setLocalTracks(tracks);
    });

    downloadService.init().then(() => {
      setDownloadedTracks(downloadService.getDownloadedTracks());
    });

    const unsubscribe = downloadService.subscribe((progress) => {
      setDownloadProgresses((prev) => ({
        ...prev,
        [progress.trackId]: { status: progress.status, percent: progress.percent },
      }));
      if (progress.status === 'downloaded' || progress.status === 'not_downloaded') {
        setDownloadedTracks(downloadService.getDownloadedTracks());
      }
    });

    return () => unsubscribe();
  }, []);

  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem('stuxs_favorites', JSON.stringify(favorites));
  }, [favorites]);

  useEffect(() => {
    localStorage.setItem('stuxs_user_playlists', JSON.stringify(playlists));
  }, [playlists]);

  useEffect(() => {
    localStorage.setItem('stuxs_saved_playlists', JSON.stringify(savedPlaylists));
  }, [savedPlaylists]);

  useEffect(() => {
    localStorage.setItem('stuxs_recently_played', JSON.stringify(recentlyPlayed));
  }, [recentlyPlayed]);

  // Load playlists from Supabase when user logs in
  useEffect(() => {
    if (!configured || !user) return;

    const fetchSupabasePlaylists = async () => {
      try {
        // 1. Fetch user playlists (simple flat query — no joins needed)
        const { data: dbPlaylists, error: plError } = await supabase
          .from('playlists')
          .select('id, user_id, name, description, artwork_url, is_public, created_at, updated_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });

        if (plError) {
          console.warn('[STUXS] Playlists fetch error:', plError);
          return;
        }
        if (!dbPlaylists || dbPlaylists.length === 0) return;

        const playlistIds = dbPlaylists.map((p: any) => p.id);

        // 2. Fetch tracks from playlist_tracks table only
        const { data: ptData, error: ptError } = await (supabase.from('playlist_tracks') as any)
          .select('playlist_id, track_id, track_data, position')
          .in('playlist_id', playlistIds)
          .order('position', { ascending: true });

        if (ptError) {
          console.error('[STUXS] playlist_tracks fetch error — table may not exist:', {
            code: ptError.code,
            message: ptError.message,
            hint: ptError.hint,
          });
        }

        const rawTracks: any[] = ptData || [];

        // Group tracks by playlist_id
        const tracksByPlaylist = new Map<string, Track[]>();
        for (const row of rawTracks) {
          const plId = row.playlist_id;
          if (!tracksByPlaylist.has(plId)) tracksByPlaylist.set(plId, []);
          let trackObj: Track | null = null;
          if (row.track_data) {
            trackObj = typeof row.track_data === 'string'
              ? JSON.parse(row.track_data)
              : (row.track_data as Track);
          }
          if (!trackObj && row.track_id) {
            trackObj = {
              id: row.track_id,
              title: 'Track',
              artistId: 'unknown',
              artistName: 'Artist',
              artworkUrl: '',
              duration: 0,
              provider: 'stuxs',
            };
          }
          if (trackObj) tracksByPlaylist.get(plId)!.push(trackObj);
        }

        const loaded: Playlist[] = dbPlaylists.map((p: any) => {
          const songs = tracksByPlaylist.get(p.id) || [];
          return {
            id: p.id,
            userId: p.user_id,
            name: p.name,
            description: p.description || '',
            artworkUrl: p.artwork_url || songs[0]?.artworkUrl || 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800&auto=format&fit=crop&q=80',
            isPublic: p.is_public ?? false,
            isUserCreated: true,
            songCount: songs.length,
            songs,
            createdAt: p.created_at,
            updatedAt: p.updated_at,
          };
        });

        setPlaylists((prev) => {
          const prevMap = new Map(prev.map((p) => [p.id, p]));
          const merged: Playlist[] = loaded.map((remotePl) => {
            const localPl = prevMap.get(remotePl.id);
            // If remote has no songs or fewer songs but local has songs, PRESERVE local songs!
            if (localPl && localPl.songs && localPl.songs.length > 0 && (!remotePl.songs || remotePl.songs.length === 0)) {
              return {
                ...remotePl,
                songs: localPl.songs,
                songCount: localPl.songs.length,
                artworkUrl: localPl.artworkUrl || remotePl.artworkUrl,
              };
            }
            return remotePl;
          });
          const remoteIds = new Set(loaded.map((l) => l.id));
          const remaining = prev.filter((p) => !remoteIds.has(p.id));
          const finalPlaylists = [...merged, ...remaining];
          try {
            localStorage.setItem('stuxs_user_playlists', JSON.stringify(finalPlaylists));
          } catch {}
          return finalPlaylists;
        });
      } catch (err) {
        console.warn('[STUXS] Failed to load playlists from Supabase:', err);
      }
    };

    fetchSupabasePlaylists();
  }, [configured, user]);

  const isFavorite = useCallback(
    (trackId: string): boolean => {
      const norm = normalizeTrackId(trackId);
      return favorites.some((t) => normalizeTrackId(t.id) === norm);
    },
    [favorites]
  );

  const toggleFavorite = useCallback((track: Track) => {
    const norm = normalizeTrackId(track);
    setFavorites((prev) => {
      const exists = prev.some((t) => normalizeTrackId(t.id) === norm);
      if (exists) {
        return prev.filter((t) => normalizeTrackId(t.id) !== norm);
      } else {
        return [track, ...prev];
      }
    });
  }, []);

  const isTrackInPlaylist = useCallback(
    (playlistId: string, track: Track | string): boolean => {
      const target = playlists.find((p) => p.id === playlistId);
      if (!target || !target.songs) return false;

      const trackId = normalizeTrackId(track);
      const providerId = typeof track === 'object' ? track?.providerId : undefined;
      const provider = typeof track === 'object' ? track?.provider : undefined;

      return target.songs.some((s) => {
        const sNorm = normalizeTrackId(s.id);
        if (sNorm && trackId && sNorm === trackId) return true;
        if (provider && providerId && s.provider === provider && String(s.providerId) === String(providerId)) {
          return true;
        }
        return false;
      });
    },
    [playlists]
  );

  const getPlaylistById = useCallback(
    (playlistId: string): Playlist | undefined => {
      return playlists.find((p) => p.id === playlistId) || savedPlaylists.find((p) => p.id === playlistId);
    },
    [playlists, savedPlaylists]
  );

  const createPlaylist = async (
    name: string,
    description?: string,
    initialTracks?: Track[] | Track
  ): Promise<Playlist> => {
    const trimmedName = name.trim();
    const initialSongs: Track[] = Array.isArray(initialTracks)
      ? initialTracks
      : initialTracks
      ? [initialTracks]
      : [];

    const generatedId = generateUUID();

    const newPlaylist: Playlist = {
      id: generatedId,
      userId: user?.id,
      name: trimmedName,
      description: description?.trim() || '',
      artworkUrl: initialSongs[0]?.artworkUrl || 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800&auto=format&fit=crop&q=80',
      isUserCreated: true,
      isPublic: false,
      songCount: initialSongs.length,
      songs: initialSongs,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Functional atomic update & localStorage persistence
    setPlaylists((prev) => {
      const updated = [newPlaylist, ...prev.filter((p) => p.id !== newPlaylist.id)];
      try {
        localStorage.setItem('stuxs_user_playlists', JSON.stringify(updated));
      } catch {}
      return updated;
    });

    // Supabase persistence
    if (configured && user) {
      try {
        const { error: playlistError } = await (supabase.from('playlists') as any).upsert(
          {
            id: newPlaylist.id,
            user_id: user.id,
            name: newPlaylist.name,
            description: newPlaylist.description,
            artwork_url: newPlaylist.artworkUrl,
            is_public: newPlaylist.isPublic,
          },
          { onConflict: 'id' }
        );

        if (playlistError) {
          console.error('[PLAYLIST CREATE ERROR]', {
            code: playlistError.code,
            message: playlistError.message,
            details: playlistError.details,
            hint: playlistError.hint,
          });
        } else if (initialSongs.length > 0) {
          const rows = initialSongs.map((track, idx) => {
            const baseId = normalizeTrackId(track) || track.id || `track_${idx}`;
            return {
              playlist_id: newPlaylist.id,
              track_id: `${baseId}_${idx}`,
              track_data: track,
              position: idx,
            };
          });

          const { error: trackError } = await (supabase.from('playlist_tracks') as any).upsert(rows, { onConflict: 'playlist_id,track_id' });
          if (trackError) {
            console.error('[PLAYLIST TRACK INSERT ERROR]', {
              code: trackError.code,
              message: trackError.message,
              details: trackError.details,
              hint: trackError.hint,
            });
          }
        }
      } catch (err: any) {
        console.error('[PLAYLIST CREATE EXCEPTION]', err);
      }
    }

    return newPlaylist;
  };

  const addTracksToPlaylist = async (
    playlistId: string,
    tracksToAdd: Track[]
  ): Promise<{ addedCount: number; alreadyExistsCount: number }> => {
    if (!tracksToAdd || tracksToAdd.length === 0) {
      return { addedCount: 0, alreadyExistsCount: 0 };
    }

    let addedTracks: Track[] = [];
    let alreadyExistsCount = 0;

    setPlaylists((prev) => {
      const target = prev.find((p) => p.id === playlistId);
      if (!target) return prev;

      const current = target.songs || [];
      const existingIdSet = new Set(current.map((s) => normalizeTrackId(s)));

      const uniqueToAdd: Track[] = [];
      for (const t of tracksToAdd) {
        const norm = normalizeTrackId(t);
        if (norm && existingIdSet.has(norm)) {
          alreadyExistsCount++;
        } else {
          if (norm) existingIdSet.add(norm);
          uniqueToAdd.push(t);
        }
      }

      addedTracks = uniqueToAdd;
      if (uniqueToAdd.length === 0) return prev;

      const updatedSongs = [...current, ...uniqueToAdd];
      const updatedPlaylist: Playlist = {
        ...target,
        songs: updatedSongs,
        songCount: updatedSongs.length,
        artworkUrl: target.customArtworkUrl || updatedSongs[0]?.artworkUrl || target.artworkUrl,
        updatedAt: new Date().toISOString(),
      };

      const updatedList = prev.map((p) => (p.id === playlistId ? updatedPlaylist : p));
      try {
        localStorage.setItem('stuxs_user_playlists', JSON.stringify(updatedList));
      } catch {}
      return updatedList;
    });

    if (configured && user && addedTracks.length > 0) {
      try {
        const targetPl = playlists.find((p) => p.id === playlistId);
        const startPos = targetPl?.songs?.length || 0;
        const rows = addedTracks.map((track, idx) => {
          const baseId = normalizeTrackId(track) || track.id || `track_${startPos + idx}`;
          return {
            playlist_id: playlistId,
            track_id: `${baseId}_${startPos + idx}`,
            track_data: track,
            position: startPos + idx,
          };
        });
        const { error: insertError } = await (supabase.from('playlist_tracks') as any).upsert(rows, { onConflict: 'playlist_id,track_id' });
        if (insertError) {
          console.error('[PLAYLIST TRACK INSERT ERROR]', {
            code: insertError.code,
            message: insertError.message,
            details: insertError.details,
            hint: insertError.hint,
          });
        }
      } catch (err: any) {
        console.error('[PLAYLIST TRACK INSERT EXCEPTION]', err);
      }
    }

    return { addedCount: addedTracks.length, alreadyExistsCount };
  };

  const addTrackToPlaylist = async (
    playlistId: string,
    track: Track
  ): Promise<AddToPlaylistResult> => {
    const normTrackId = normalizeTrackId(track);
    if (!normTrackId) {
      return {
        success: false,
        alreadyExists: false,
        message: 'Invalid track ID',
      };
    }

    let isAlreadyIn = false;
    let targetName = 'Playlist';
    let targetFound = false;

    setPlaylists((prev) => {
      const targetPlaylist = prev.find((p) => p.id === playlistId);
      if (!targetPlaylist) {
        return prev;
      }
      targetFound = true;
      targetName = targetPlaylist.name;

      const currentSongs = targetPlaylist.songs || [];
      isAlreadyIn = currentSongs.some((s) => {
        const sId = normalizeTrackId(s);
        if (sId && sId === normTrackId) return true;
        if (track.providerId && s.provider === track.provider && String(s.providerId) === String(track.providerId)) {
          return true;
        }
        return false;
      });

      if (isAlreadyIn) {
        return prev;
      }

      const updatedSongs = [...currentSongs, track];
      const updatedPlaylist: Playlist = {
        ...targetPlaylist,
        songs: updatedSongs,
        songCount: updatedSongs.length,
        artworkUrl: targetPlaylist.customArtworkUrl || updatedSongs[0]?.artworkUrl || targetPlaylist.artworkUrl,
        updatedAt: new Date().toISOString(),
      };

      const updatedList = prev.map((p) => (p.id === playlistId ? updatedPlaylist : p));
      try {
        localStorage.setItem('stuxs_user_playlists', JSON.stringify(updatedList));
      } catch {}
      return updatedList;
    });

    if (!targetFound) {
      return {
        success: false,
        alreadyExists: false,
        message: 'Playlist not found',
      };
    }

    if (isAlreadyIn) {
      return {
        success: false,
        alreadyExists: true,
        message: `Already in ${targetName}`,
      };
    }

    // Supabase persistence
    if (configured && user) {
      try {
        const { error: insertError } = await (supabase.from('playlist_tracks') as any).insert({
          playlist_id: playlistId,
          track_id: normTrackId,
          track_data: track,
          position: 0,
        });

        if (insertError) {
          console.error('[STUXS] PLAYLIST TRACK INSERT ERROR:', insertError);
          if (insertError.code === '23505') {
            return {
              success: false,
              alreadyExists: true,
              message: `Already in ${targetName}`,
            };
          }
        }
      } catch (err: any) {
        console.error('[STUXS] PLAYLIST INSERT EXCEPTION:', err);
      }
    }

    return {
      success: true,
      alreadyExists: false,
      message: `Added to ${targetName}`,
    };
  };

  const removeTrackFromPlaylist = async (
    playlistId: string,
    trackId: string
  ): Promise<{ success: boolean; message: string }> => {
    const targetPlaylist = playlists.find((p) => p.id === playlistId);
    if (!targetPlaylist) {
      return { success: false, message: 'Playlist not found' };
    }

    const normTrackId = normalizeTrackId(trackId);
    const previousPlaylists = [...playlists];
    const updatedSongs = (targetPlaylist.songs || []).filter((s) => normalizeTrackId(s.id) !== normTrackId);

    // Optimistic update
    setPlaylists((prev) =>
      prev.map((p) => {
        if (p.id !== playlistId) return p;
        return {
          ...p,
          songs: updatedSongs,
          songCount: updatedSongs.length,
          artworkUrl: p.customArtworkUrl || updatedSongs[0]?.artworkUrl || '',
          updatedAt: new Date().toISOString(),
        };
      })
    );

    // Supabase persistence
    if (configured && user) {
      try {
        const { error } = await (supabase.from('playlist_tracks') as any)
          .delete()
          .match({ playlist_id: playlistId, track_id: normTrackId });

        if (error) {
          console.error('[STUXS] removeTrackFromPlaylist error:', {
            code: error.code,
            message: error.message,
            hint: error.hint,
          });
          setPlaylists(previousPlaylists);
          return { success: false, message: "Couldn't remove song. Try again." };
        }
      } catch (err) {
        console.error('[STUXS] removeTrackFromPlaylist exception:', err);
        setPlaylists(previousPlaylists);
        return { success: false, message: "Couldn't remove song. Try again." };
      }
    }

    return { success: true, message: `Removed from ${targetPlaylist.name}` };
  };

  const renamePlaylist = async (playlistId: string, newName: string): Promise<boolean> => {
    const trimmed = newName.trim();
    if (!trimmed) return false;

    setPlaylists((prev) => {
      const updated = prev.map((p) => {
        if (p.id === playlistId) {
          return {
            ...p,
            name: trimmed,
            updatedAt: new Date().toISOString(),
          };
        }
        return p;
      });
      try {
        localStorage.setItem('stuxs_user_playlists', JSON.stringify(updated));
      } catch {}
      return updated;
    });

    if (configured && user) {
      try {
        const { error } = await (supabase
          .from('playlists') as any)
          .update({ name: trimmed, updated_at: new Date().toISOString() })
          .eq('id', playlistId);
        if (error) {
          console.warn('[STUXS] renamePlaylist Supabase sync error:', error);
        }
      } catch (err) {
        console.warn('[STUXS] renamePlaylist Supabase exception:', err);
      }
    }
    return true;
  };

  const reorderPlaylist = (playlistId: string, startIndex: number, endIndex: number) => {
    let reorderedSongs: Track[] = [];

    setPlaylists((prev) => {
      const updated = prev.map((p) => {
        if (p.id !== playlistId || !p.songs) return p;
        const result = Array.from(p.songs);
        const [removed] = result.splice(startIndex, 1);
        result.splice(endIndex, 0, removed);
        reorderedSongs = result;
        return {
          ...p,
          songs: result,
          artworkUrl: p.customArtworkUrl || result[0]?.artworkUrl || '',
          updatedAt: new Date().toISOString(),
        };
      });
      try {
        localStorage.setItem('stuxs_user_playlists', JSON.stringify(updated));
      } catch {}
      return updated;
    });

    // Supabase position updates: correspond exactly to final local order
    if (configured && user && reorderedSongs.length > 0) {
      const rows = reorderedSongs.map((track, idx) => {
        const baseId = normalizeTrackId(track) || track.id || `track_${idx}`;
        return {
          playlist_id: playlistId,
          track_id: `${baseId}_${idx}`,
          track_data: track,
          position: idx,
        };
      });

      (supabase.from('playlist_tracks') as any)
        .upsert(rows, { onConflict: 'playlist_id,track_id' })
        .then(({ error }: any) => {
          if (error) {
            console.warn('[STUXS] reorderPlaylist Supabase sync warning:', error);
          }
        })
        .catch((err: any) => {
          console.warn('[STUXS] reorderPlaylist Supabase exception:', err);
        });
    }
  };

  const deletePlaylist = async (playlistId: string) => {
    const previous = [...playlists];
    setPlaylists((prev) => {
      const updated = prev.filter((p) => p.id !== playlistId);
      try {
        localStorage.setItem('stuxs_user_playlists', JSON.stringify(updated));
      } catch {}
      return updated;
    });

    if (configured && user) {
      try {
        // playlist_tracks has ON DELETE CASCADE from playlists, but delete explicitly anyway
        await (supabase.from('playlist_tracks') as any).delete().eq('playlist_id', playlistId);
        await supabase.from('playlists').delete().eq('id', playlistId);
      } catch (err) {
        console.error('[STUXS] deletePlaylist error:', err);
        setPlaylists(previous);
        try {
          localStorage.setItem('stuxs_user_playlists', JSON.stringify(previous));
        } catch {}
      }
    }
  };

  const isPlaylistSaved = useCallback(
    (playlistId: string): boolean => {
      return savedPlaylists.some((p) => p.id === playlistId);
    },
    [savedPlaylists]
  );

  const savePlaylist = useCallback((playlist: Playlist) => {
    setSavedPlaylists((prev) => {
      if (prev.some((p) => p.id === playlist.id)) return prev;
      return [{ ...playlist, isSaved: true }, ...prev];
    });
  }, []);

  const unsavePlaylist = useCallback((playlistId: string) => {
    setSavedPlaylists((prev) => prev.filter((p) => p.id !== playlistId));
  }, []);

  const toggleSavePlaylist = useCallback((playlist: Playlist) => {
    setSavedPlaylists((prev) => {
      const exists = prev.some((p) => p.id === playlist.id);
      if (exists) {
        return prev.filter((p) => p.id !== playlist.id);
      } else {
        return [{ ...playlist, isSaved: true }, ...prev];
      }
    });
  }, []);

  const addToRecentlyPlayed = (track: Track) => {
    setRecentlyPlayed((prev) => {
      const filtered = prev.filter((t) => t.id !== track.id);
      return [track, ...filtered].slice(0, 20);
    });
  };

  const importLocalFiles = useCallback(
    async (
      files: FileList | File[],
      onProgress?: (current: number, total: number, currentName?: string) => void
    ): Promise<Track[]> => {
      const fileArray = Array.from(files);
      const imported: Track[] = [];
      for (let i = 0; i < fileArray.length; i++) {
        const file = fileArray[i];
        if (onProgress) {
          onProgress(i + 1, fileArray.length, file.name);
        }
        try {
          const track = await LocalMusicService.importFile(file);
          imported.push(track);
        } catch (err) {
          console.error('Failed to import file:', file.name, err);
        }
      }
      if (imported.length > 0) {
        setLocalTracks((prev) => [...imported, ...prev]);
      }
      return imported;
    },
    []
  );

  const deleteLocalTrack = useCallback(async (id: string) => {
    await LocalMusicService.deleteLocalTrack(id);
    setLocalTracks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const importM3UFile = useCallback(
    async (
      file: File,
      onProgress?: (current: number, total: number, currentName?: string) => void
    ): Promise<M3UImportResult> => {
      const text = await file.text();
      const fileName = file.name.replace(/\.[^/.]+$/, '');
      const { playlistName, entries } = M3UParserService.parse(
        text,
        fileName || 'Imported Playlist'
      );
      const { matchedTracks, unresolvedEntries } = await M3UParserService.matchEntries(
        entries,
        localTracks,
        onProgress
      );

      console.log(
        `[M3U IMPORT]\nFile: ${file.name}\nParsed entries: ${entries.length}\nValid entries: ${entries.length}\nMatched tracks: ${matchedTracks.length}\nUnmatched tracks: ${unresolvedEntries.length}`
      );
      console.log(`[M3U]\nparsed = ${entries.length}`);
      console.log(`[M3U MATCH]\nmatched = ${matchedTracks.length}`);

      let createdPlaylistId = '';
      let attemptedCount = 0;
      let insertedCount = 0;
      let databaseCount = 0;
      let fetchedCountAfterImport = 0;

      // Create new playlist with all matched tracks atomically
      if (matchedTracks.length > 0) {
        attemptedCount = matchedTracks.length;
        const newPl = await createPlaylist(
          playlistName,
          `Imported from ${file.name} (${matchedTracks.length} tracks matched)`,
          matchedTracks
        );
        createdPlaylistId = newPl.id;
        insertedCount = newPl.songs?.length || 0;

        console.log(`[PLAYLIST CREATE]\nplaylistId = ${createdPlaylistId}`);
        console.log(`[PLAYLIST INSERT]\nattempting = ${attemptedCount}`);
        console.log(`[PLAYLIST INSERT]\ninserted = ${insertedCount}`);

        // Verify immediate local storage & state fetch
        databaseCount = insertedCount;
        if (configured && user) {
          try {
            const { count, error } = await (supabase.from('playlist_tracks') as any)
              .select('*', { count: 'exact', head: true })
              .eq('playlist_id', createdPlaylistId);
            if (!error && count !== null) {
              databaseCount = count;
            }
          } catch {}
        }
        console.log(`[PLAYLIST VERIFY]\ndatabase contains = ${databaseCount}`);

        const savedRaw = localStorage.getItem('stuxs_user_playlists');
        if (savedRaw) {
          try {
            const parsed = JSON.parse(savedRaw);
            const found = parsed.find((p: any) => p.id === createdPlaylistId);
            fetchedCountAfterImport = found?.songs?.length || 0;
          } catch {}
        }
        console.log(`[PLAYLIST FETCH]\nreturned = ${fetchedCountAfterImport}`);
        console.log(`[PLAYLIST UI]\nrendering = ${fetchedCountAfterImport}`);
      }

      return {
        playlistName,
        totalEntries: entries.length,
        matchedTracks,
        unresolvedEntries,
        matchedCount: insertedCount || matchedTracks.length,
        unresolvedCount: unresolvedEntries.length,
      };
    },
    [createPlaylist, localTracks, configured, user]
  );

  const downloadTrack = useCallback(async (track: Track) => {
    await downloadService.downloadTrack(track);
    setDownloadedTracks(downloadService.getDownloadedTracks());
  }, []);

  const downloadPlaylist = useCallback(
    async (
      tracks: Track[],
      playlistId?: string,
      onProgress?: (completed: number, total: number, failed: number) => void
    ) => {
      const res = await downloadService.downloadPlaylist(tracks, playlistId, onProgress);
      setDownloadedTracks(downloadService.getDownloadedTracks());
      return res;
    },
    []
  );

  const cancelPlaylistDownload = useCallback((playlistId?: string) => {
    downloadService.cancelPlaylistDownload(playlistId);
  }, []);

  const isPlaylistDownloading = useCallback((playlistId: string) => {
    return downloadService.isPlaylistDownloading(playlistId);
  }, []);

  const removeDownloadedTrack = useCallback(async (trackId: string) => {
    await downloadService.removeDownload(trackId);
    setDownloadedTracks(downloadService.getDownloadedTracks());
  }, []);

  const isDownloaded = useCallback((trackId: string) => {
    return downloadService.isTrackDownloaded(trackId);
  }, [downloadedTracks]);

  const getActualDownloadStatus = useCallback(async (trackId: string): Promise<DownloadStatus> => {
    return downloadService.getActualDownloadStatus(trackId);
  }, []);

  const refreshDownloads = useCallback(async (): Promise<Track[]> => {
    const tracks = await downloadService.refreshAndSelfHeal();
    setDownloadedTracks(tracks);
    return tracks;
  }, []);

  const getDownloadProgress = useCallback((trackId: string) => {
    return (
      downloadProgresses[trackId] || {
        status: downloadService.getStatus(trackId),
        percent: downloadService.getProgress(trackId),
      }
    );
  }, [downloadProgresses, downloadedTracks]);

  const contextValue = useMemo(
    () => ({
      favorites,
      playlists,
      savedPlaylists,
      recentlyPlayed,
      localTracks,
      downloadedTracks,
      isFavorite,
      toggleFavorite,
      createPlaylist,
      addTrackToPlaylist,
      addTracksToPlaylist,
      getPlaylistById,
      removeTrackFromPlaylist,
      isTrackInPlaylist,
      reorderPlaylist,
      renamePlaylist,
      deletePlaylist,
      isPlaylistSaved,
      savePlaylist,
      unsavePlaylist,
      toggleSavePlaylist,
      addToRecentlyPlayed,
      importLocalFiles,
      deleteLocalTrack,
      importM3UFile,
      downloadTrack,
      downloadPlaylist,
      cancelPlaylistDownload,
      isPlaylistDownloading,
      removeDownloadedTrack,
      isDownloaded,
      getActualDownloadStatus,
      getDownloadProgress,
      refreshDownloads,
    }),
    [
      favorites,
      playlists,
      savedPlaylists,
      recentlyPlayed,
      localTracks,
      downloadedTracks,
      isFavorite,
      toggleFavorite,
      createPlaylist,
      addTrackToPlaylist,
      addTracksToPlaylist,
      getPlaylistById,
      removeTrackFromPlaylist,
      isTrackInPlaylist,
      reorderPlaylist,
      renamePlaylist,
      deletePlaylist,
      isPlaylistSaved,
      savePlaylist,
      unsavePlaylist,
      toggleSavePlaylist,
      addToRecentlyPlayed,
      importLocalFiles,
      deleteLocalTrack,
      importM3UFile,
      downloadTrack,
      downloadPlaylist,
      cancelPlaylistDownload,
      isPlaylistDownloading,
      removeDownloadedTrack,
      isDownloaded,
      getActualDownloadStatus,
      getDownloadProgress,
      refreshDownloads,
    ]
  );

  return (
    <LibraryContext.Provider value={contextValue}>
      {children}
    </LibraryContext.Provider>
  );
};

export const useLibrary = () => {
  const context = useContext(LibraryContext);
  if (!context) {
    throw new Error('useLibrary must be used within a LibraryProvider');
  }
  return context;
};
