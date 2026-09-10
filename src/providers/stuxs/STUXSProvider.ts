import type { MusicProvider } from '../../types/provider';
import type { SearchResults, Track, Album, Artist, Playlist } from '../../types/music';
import { supabase, isSupabaseConfigured } from '../../config/supabase';
import { BRANDING_CONFIG } from '../../config/branding';
import { generateQueryVariants, scoreTrack } from '../../utils/searchIntelligence';

export class STUXSProvider implements MusicProvider {
  public id = 'stuxs' as const;
  public name = 'STUXS Catalog';
  public isAvailable = true;
  public isConnected = true;

  /**
   * Search published STUXS catalog tracks across title, artist, album, genre, and language.
   * Dynamically aggregates matching artists and albums with typo & transliteration support.
   */
  public async search(query: string): Promise<SearchResults> {
    const emptyResults: SearchResults = { tracks: [], artists: [], albums: [], playlists: [] };
    if (!isSupabaseConfigured() || !query.trim()) return emptyResults;

    try {
      const cleanQ = query.trim().replace(/[,()]/g, ' ');
      const words = cleanQ.split(/\s+/).filter(Boolean);
      const variants = generateQueryVariants(cleanQ);
      
      const orConditions: string[] = [
        `title.ilike.%${cleanQ}%`,
        `artist_name.ilike.%${cleanQ}%`,
        `album_title.ilike.%${cleanQ}%`,
        `genre.ilike.%${cleanQ}%`,
        `language.ilike.%${cleanQ}%`,
      ];

      // Add individual token conditions for partial matching (e.g. "jikade", "tikade")
      for (const w of words) {
        if (w.length >= 2) {
          orConditions.push(`title.ilike.%${w}%`);
          orConditions.push(`artist_name.ilike.%${w}%`);
          orConditions.push(`album_title.ilike.%${w}%`);
        }
      }

      // Add typo & phonetic variant conditions (e.g. "jikde tikde" -> "jikade tikade")
      for (const v of variants) {
        if (v.length >= 2) {
          orConditions.push(`title.ilike.%${v}%`);
          orConditions.push(`artist_name.ilike.%${v}%`);
        }
      }

      const { data, error } = await supabase
        .from('songs')
        .select('*')
        .eq('is_published', true)
        .not('audio_storage_path', 'is', null)
        .or(orConditions.join(','))
        .limit(40);

      const rows = data as any[] | null;
      if (error || !rows || rows.length === 0) return emptyResults;

      // Strict Availability Filter: Exclude any record without a verified STUXS audio file or with a preview URL
      const tracks: Track[] = rows
        .filter((row) => {
          if (!row.audio_storage_path && !row.audio_url) return false;
          const url = String(row.audio_url || '');
          if (url.includes('itunes.apple.com') || url.includes('mzstatic.com') || url.includes('audio-ssl.itunes')) {
            return false;
          }
          return true;
        })
        .map((row) => this.mapSongToTrack(row));

      tracks.sort((a, b) => scoreTrack(b, cleanQ) - scoreTrack(a, cleanQ));

      if (tracks.length === 0) return emptyResults;

      // Aggregate dynamic albums from search results
      const albumsMap = new Map<string, Album>();
      const artistsMap = new Map<string, Artist>();

      for (const t of tracks) {
        if (t.albumTitle) {
          const albumKey = `${t.artistName}-${t.albumTitle}`.toLowerCase();
          if (!albumsMap.has(albumKey)) {
            albumsMap.set(albumKey, {
              id: t.albumId || `stuxs-album-${encodeURIComponent(t.albumTitle)}`,
              title: t.albumTitle,
              artistId: t.artistId,
              artistName: t.artistName,
              artworkUrl: t.artworkUrl,
              releaseDate: String(t.releaseYear || new Date().getFullYear()),
              genre: t.genre || 'Music',
              trackCount: 1,
              provider: 'stuxs',
              providerId: t.id,
              songs: [t],
            });
          } else {
            const existing = albumsMap.get(albumKey)!;
            existing.trackCount = (existing.trackCount || 1) + 1;
            if (existing.songs && !existing.songs.some((item) => item.id === t.id)) {
              existing.songs.push(t);
            }
          }
        }

        // Aggregate dynamic artists
        if (t.artistName) {
          const artistKey = t.artistName.toLowerCase();
          if (!artistsMap.has(artistKey)) {
            artistsMap.set(artistKey, {
              id: t.artistId,
              name: t.artistName,
              artworkUrl: t.artworkUrl,
              genres: t.genre ? [t.genre] : ['Music'],
              provider: 'stuxs',
              providerArtistId: t.artistId,
              songs: [t],
            });
          } else {
            const existing = artistsMap.get(artistKey)!;
            if (existing.songs && !existing.songs.some((item) => item.id === t.id)) {
              existing.songs.push(t);
            }
          }
        }
      }

      return {
        tracks,
        artists: Array.from(artistsMap.values()),
        albums: Array.from(albumsMap.values()),
        playlists: [],
      };
    } catch (err) {
      console.warn('[STUXSProvider] Search error:', err);
      return emptyResults;
    }
  }

  /**
   * Retrieves single song track by ID.
   */
  public async getTrack(id: string): Promise<Track | null> {
    if (!isSupabaseConfigured() || !id) return null;

    try {
      const cleanId = id.replace(/^stuxs-/, '');
      const { data, error } = await supabase
        .from('songs')
        .select('*')
        .or(`id.eq.${cleanId},provider_id.eq.${id},provider_id.eq.${cleanId}`)
        .maybeSingle();

      if (error || !data) {
        const direct = await supabase.from('songs').select('*').eq('id', id).maybeSingle();
        if (direct.data) return this.mapSongToTrack(direct.data);
        return null;
      }
      return this.mapSongToTrack(data);
    } catch (err) {
      console.warn('[STUXSProvider] getTrack error:', err);
      return null;
    }
  }

  /**
   * Standard getTrackDetails implementation.
   */
  public async getTrackDetails(trackId: string): Promise<Track | null> {
    return this.getTrack(trackId);
  }

  /**
   * Resolves the verified full audio URL for a STUXS catalog track.
   */
  public async getStreamUrl(trackId: string): Promise<string | null> {
    const track = await this.getTrack(trackId);
    return track?.audioUrl || null;
  }

  /**
   * Retrieves full album details and tracks from STUXS catalog.
   */
  public async getAlbum(id: string): Promise<Album | null> {
    if (!isSupabaseConfigured() || !id) return null;

    try {
      // Query songs matching album id or album title
      let queryBuilder = supabase
        .from('songs')
        .select('*')
        .eq('provider', 'stuxs')
        .eq('is_published', true);

      if (id.startsWith('stuxs-album-')) {
        const decodedTitle = decodeURIComponent(id.replace('stuxs-album-', ''));
        queryBuilder = queryBuilder.ilike('album_title', decodedTitle);
      } else {
        queryBuilder = queryBuilder.eq('id', id);
      }

      const { data, error } = await queryBuilder.limit(50);
      if (error || !data || data.length === 0) return null;

      const tracks = (data as any[]).map((r) => this.mapSongToTrack(r));
      const first = tracks[0];

      return {
        id,
        title: first.albumTitle || 'STUXS Album',
        artistId: first.artistId,
        artistName: first.artistName,
        artworkUrl: first.artworkUrl,
        releaseDate: String(first.releaseYear || new Date().getFullYear()),
        genre: first.genre || 'Music',
        trackCount: tracks.length,
        songs: tracks,
        provider: 'stuxs',
        providerId: id,
      };
    } catch (err) {
      console.warn('[STUXSProvider] getAlbum error:', err);
      return null;
    }
  }

  /**
   * Retrieves full artist details and top tracks from STUXS catalog.
   */
  public async getArtist(id: string): Promise<Artist | null> {
    if (!isSupabaseConfigured() || !id) return null;

    try {
      let queryBuilder = supabase
        .from('songs')
        .select('*')
        .eq('provider', 'stuxs')
        .eq('is_published', true);

      if (id.startsWith('stuxs-artist-')) {
        const decodedName = decodeURIComponent(id.replace('stuxs-artist-', ''));
        queryBuilder = queryBuilder.ilike('artist_name', decodedName);
      } else {
        queryBuilder = queryBuilder.eq('id', id);
      }

      const { data, error } = await queryBuilder.limit(50);
      if (error || !data || data.length === 0) return null;

      const tracks = (data as any[]).map((r) => this.mapSongToTrack(r));
      const first = tracks[0];

      return {
        id,
        name: first.artistName,
        artworkUrl: first.artworkUrl,
        genres: first.genre ? [first.genre] : [],
        songs: tracks,
        provider: 'stuxs',
        providerArtistId: first.artistId,
      };
    } catch (err) {
      console.warn('[STUXSProvider] getArtist error:', err);
      return null;
    }
  }

  public async getPlaylist(_id: string): Promise<Playlist | null> {
    return null;
  }

  /**
   * Retrieves latest published STUXS catalog tracks.
   */
  public async getPublishedCatalogTracks(limit = 10): Promise<Track[]> {
    if (!isSupabaseConfigured()) return [];
    try {
      const { data, error } = await supabase
        .from('songs')
        .select('*')
        .eq('is_published', true)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error || !data || data.length === 0) return [];
      return (data as any[])
        .filter((row) => Boolean(row.audio_storage_path || row.audio_url))
        .map((r) => this.mapSongToTrack(r));
    } catch {
      return [];
    }
  }

  private mapSongToTrack(row: any): Track {
    let audioUrl = row.audio_url || undefined;

    if (!audioUrl && row.audio_storage_path) {
      const { data } = supabase.storage.from('stuxs-audio').getPublicUrl(row.audio_storage_path);
      audioUrl = data?.publicUrl;
    }

    return {
      id: row.id,
      title: row.title || 'Untitled STUXS Track',
      artistId: row.artist_id || `stuxs-artist-${encodeURIComponent(row.artist_name || 'unknown')}`,
      artistName: row.artist_name || 'STUXS Artist',
      albumId: row.album_id || (row.album_title ? `stuxs-album-${encodeURIComponent(row.album_title)}` : undefined),
      albumTitle: row.album_title || 'STUXS Release',
      artworkUrl: row.artwork_url || BRANDING_CONFIG.appLogo,
      audioUrl,
      duration: row.duration || 180,
      provider: 'stuxs',
      providerId: row.id,
      isExplicit: Boolean(row.is_explicit),
      isPlayable: true,
      isPreview: false,
      accessStatus: 'playable',
      playbackType: 'full',
      genre: row.genre || undefined,
      language: row.language || undefined,
      releaseYear: row.release_year || undefined,
      sourceType: 'stuxs',
    };
  }
}
