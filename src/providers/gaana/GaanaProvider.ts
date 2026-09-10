import type { MusicProvider } from '../../types/provider';
import type { Album, Artist, Playlist, SearchResults, Track, AudioQuality } from '../../types/music';
import { isDevEnvironment } from '../../utils/platform';

interface RawGaanaTrack {
  track_id?: string | number;
  id?: string | number;
  entity_id?: string | number;
  track_title?: string;
  title?: string;
  name?: string;
  album_title?: string;
  album_name?: string;
  album?: string;
  album_id?: string | number;
  artwork?: string;
  album_artwork?: string;
  artwork_large?: string;
  image?: string;
  duration?: string | number;
  language?: string;
  track_language?: string;
  release_year?: string | number;
  year?: string | number;
  release_date?: string;
  artist_name?: string;
  primary_artists?: string;
  singers?: string;
  artists?: Array<{ id?: string | number; name?: string }>;
  stream_url?: string;
  hls_url?: string;
  is_explicit?: boolean | number;
}

export class GaanaProvider implements MusicProvider {
  id = 'gaana' as const;
  name = 'Gaana';
  isAvailable = true;
  isConnected = true;

  private baseUrl: string;

  constructor() {
    const isDev = isDevEnvironment();
    const envProc = (globalThis as unknown as { process?: { env?: Record<string, string> } }).process;
    const configuredApiUrl =
      (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GAANA_API_URL) ||
      envProc?.env?.VITE_GAANA_API_URL ||
      '';

    if (configuredApiUrl) {
      this.baseUrl = configuredApiUrl.replace(/\/$/, '');
    } else if (isDev) {
      this.baseUrl = '/api/gaana';
    } else {
      // Self-hosted wrapper in Mumbai region (ap-south-1) for geo-restriction compliance
      this.baseUrl = 'https://gaana-api-mumbai.stuxs.internal';
    }
  }

  private cleanHtml(text: string): string {
    if (!text) return '';
    return text
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&#039;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim();
  }

  private getHighResImage(imageUrl?: string): string {
    if (!imageUrl) {
      return 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80';
    }
    return imageUrl
      .replace('150x150', '500x500')
      .replace('50x50', '500x500')
      .replace('175x175', '500x500');
  }

  private cleanTrackId(id: string): string {
    return id.replace(/^gaana-/, '');
  }

  public mapTrack(raw: RawGaanaTrack): Track {
    const rawId = String(raw.track_id || raw.id || raw.entity_id || '0');
    const id = rawId.startsWith('gaana-') ? rawId : `gaana-${rawId}`;

    let artistName = '';
    let artistId = '0';
    if (Array.isArray(raw.artists) && raw.artists.length > 0) {
      artistName = raw.artists.map((a) => a.name || '').filter(Boolean).join(', ');
      artistId = String(raw.artists[0].id || '0');
    } else if (raw.primary_artists) {
      artistName = raw.primary_artists;
    } else if (raw.artist_name) {
      artistName = raw.artist_name;
    } else if (raw.singers) {
      artistName = raw.singers;
    } else {
      artistName = 'Gaana Artist';
    }

    const title = this.cleanHtml(raw.track_title || raw.title || raw.name || 'Unknown Track');
    const albumTitle = this.cleanHtml(raw.album_title || raw.album_name || raw.album || title);
    const albumId = String(raw.album_id || '');
    const artworkUrl = this.getHighResImage(raw.artwork || raw.album_artwork || raw.artwork_large || raw.image);
    const duration = parseInt(String(raw.duration || 0), 10) || 180;
    const language = (raw.language || raw.track_language || '').trim();
    const releaseYear = raw.release_year || raw.year || (raw.release_date ? raw.release_date.substring(0, 4) : undefined);

    const streamUrl = raw.stream_url || raw.hls_url;

    return {
      id,
      title,
      artistId,
      artistName: this.cleanHtml(artistName),
      albumId,
      albumTitle,
      artworkUrl,
      audioUrl: streamUrl,
      duration,
      provider: 'gaana',
      providerId: rawId,
      isExplicit: Boolean(raw.is_explicit),
      isPlayable: true,
      isPreview: false,
      accessStatus: 'playable',
      playbackType: 'full',
      language: language || undefined,
      year: releaseYear,
      releaseYear,
      sourceType: 'gaana',
      actualBitrate: '320 kbps (HLS)',
      audioFormat: streamUrl?.includes('.m3u8') ? 'HLS / AAC' : 'AAC / MP3',
    };
  }

  public async search(query: string): Promise<SearchResults> {
    if (!this.isAvailable || !query || !query.trim()) {
      return { tracks: [], artists: [], albums: [], playlists: [] };
    }

    try {
      const url = `${this.baseUrl}/api/search?q=${encodeURIComponent(query.trim())}&limit=25`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        return { tracks: [], artists: [], albums: [], playlists: [] };
      }

      const data = await res.json();
      const rawTracks: RawGaanaTrack[] = data.tracks || data.songs || data.data?.tracks || [];
      const tracks: Track[] = rawTracks.map((t) => this.mapTrack(t));

      const rawArtists = data.artists || data.data?.artists || [];
      const artists: Artist[] = rawArtists.map((a: any) => ({
        id: `gaana-artist-${a.artist_id || a.id || a.entity_id}`,
        name: this.cleanHtml(a.name || a.artist_name || 'Gaana Artist'),
        artworkUrl: this.getHighResImage(a.artwork || a.image),
        provider: 'gaana' as const,
        providerArtistId: String(a.artist_id || a.id || '0'),
      }));

      const rawAlbums = data.albums || data.data?.albums || [];
      const albums: Album[] = rawAlbums.map((al: any) => ({
        id: `gaana-album-${al.album_id || al.id || al.entity_id}`,
        title: this.cleanHtml(al.title || al.album_name || al.name || 'Gaana Album'),
        artistId: String(al.artist_id || '0'),
        artistName: this.cleanHtml(al.artist_name || al.primary_artists || 'Gaana Artist'),
        artworkUrl: this.getHighResImage(al.artwork || al.album_artwork || al.image),
        releaseDate: al.release_date || al.year || '',
        genre: al.genre || al.language || 'Music',
        trackCount: parseInt(String(al.track_count || al.tracks_count || 1), 10),
        provider: 'gaana' as const,
        providerId: String(al.album_id || al.id || '0'),
      }));

      const rawPlaylists = data.playlists || data.data?.playlists || [];
      const playlists: Playlist[] = rawPlaylists.map((p: any) => ({
        id: `gaana-playlist-${p.playlist_id || p.id || p.entity_id}`,
        name: this.cleanHtml(p.name || p.title || 'Gaana Playlist'),
        description: p.description || '',
        artworkUrl: this.getHighResImage(p.artwork || p.image),
        songCount: parseInt(String(p.song_count || p.track_count || 0), 10),
        isPublic: true,
        provider: 'gaana' as const,
        providerId: String(p.playlist_id || p.id || '0'),
      }));

      return { tracks, artists, albums, playlists };
    } catch (err: any) {
      console.warn('[GaanaProvider] Search failed gracefully:', err?.message || err);
      if (this.baseUrl.includes('.internal') || String(err).includes('fetch failed') || String(err).includes('ENOTFOUND')) {
        this.isAvailable = false;
        this.isConnected = false;
      }
      return { tracks: [], artists: [], albums: [], playlists: [] };
    }
  }

  public async getTrack(id: string): Promise<Track | null> {
    const cleanId = this.cleanTrackId(id);
    try {
      const url = `${this.baseUrl}/api/song?id=${encodeURIComponent(cleanId)}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) return null;
      const data = await res.json();
      const raw = data.song || data.track || data.data || data;
      if (!raw || (!raw.title && !raw.track_title && !raw.name)) return null;

      const track = this.mapTrack(raw);

      // If stream URL is not present in details, resolve it
      if (!track.audioUrl) {
        const stream = await this.resolveAudioStreamUrl(cleanId);
        if (stream.url) {
          track.audioUrl = stream.url;
          track.actualBitrate = stream.bitrate;
          track.audioFormat = stream.format;
        }
      }

      return track;
    } catch (err) {
      console.warn('[GaanaProvider] getTrack failed gracefully for id:', id, err);
      return null;
    }
  }

  public async resolveAudioStreamUrl(
    trackId: string,
    quality?: AudioQuality
  ): Promise<{ url?: string; bitrate: string; format: string }> {
    const cleanId = this.cleanTrackId(trackId);
    let qualityParam = 'high';
    if (quality === 'saver') qualityParam = 'low';
    else if (quality === 'normal') qualityParam = 'medium';

    try {
      const url = `${this.baseUrl}/api/stream?track_id=${encodeURIComponent(cleanId)}&quality=${qualityParam}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) return { url: undefined, bitrate: 'Unavailable', format: 'None' };
      const data = await res.json();
      const streamUrl = data.stream_url || data.hls_url || data.url || data.data?.stream_url;

      if (streamUrl) {
        const isHls = streamUrl.includes('.m3u8');
        return {
          url: streamUrl,
          bitrate: quality === 'saver' ? '96 kbps' : quality === 'normal' ? '160 kbps' : '320 kbps (HLS)',
          format: isHls ? 'HLS / AAC' : 'AAC / MP3',
        };
      }
    } catch (err) {
      console.warn('[GaanaProvider] resolveAudioStreamUrl failed for id:', trackId, err);
    }

    return { url: undefined, bitrate: 'Unavailable', format: 'None' };
  }

  public async getAlbum(id: string): Promise<Album | null> {
    const cleanId = id.replace(/^gaana-album-/, '').replace(/^gaana-/, '');
    try {
      const url = `${this.baseUrl}/api/album?id=${encodeURIComponent(cleanId)}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) return null;
      const data = await res.json();
      const al = data.album || data.data || data;
      if (!al) return null;

      const songs = (al.tracks || al.songs || []).map((t: any) => this.mapTrack(t));
      return {
        id: `gaana-album-${cleanId}`,
        title: this.cleanHtml(al.title || al.name || 'Gaana Album'),
        artistId: String(al.artist_id || '0'),
        artistName: this.cleanHtml(al.artist_name || al.primary_artists || 'Gaana Artist'),
        artworkUrl: this.getHighResImage(al.artwork || al.image),
        releaseDate: al.release_date || al.year || '',
        genre: al.genre || al.language || 'Music',
        trackCount: songs.length || parseInt(String(al.track_count || 1), 10),
        provider: 'gaana',
        providerId: cleanId,
        songs,
      };
    } catch {
      return null;
    }
  }

  public async getArtist(id: string): Promise<Artist | null> {
    const cleanId = id.replace(/^gaana-artist-/, '').replace(/^gaana-/, '');
    try {
      const url = `${this.baseUrl}/api/artist?id=${encodeURIComponent(cleanId)}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) return null;
      const data = await res.json();
      const ar = data.artist || data.data || data;
      if (!ar) return null;

      const songs = (ar.tracks || ar.top_songs || ar.songs || []).map((t: any) => this.mapTrack(t));
      return {
        id: `gaana-artist-${cleanId}`,
        name: this.cleanHtml(ar.name || ar.artist_name || 'Gaana Artist'),
        artworkUrl: this.getHighResImage(ar.artwork || ar.image),
        provider: 'gaana',
        providerArtistId: cleanId,
        songs,
      };
    } catch {
      return null;
    }
  }

  public async getPlaylist(id: string): Promise<Playlist | null> {
    const cleanId = id.replace(/^gaana-playlist-/, '').replace(/^gaana-/, '');
    try {
      const url = `${this.baseUrl}/api/playlist?id=${encodeURIComponent(cleanId)}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) return null;
      const data = await res.json();
      const pl = data.playlist || data.data || data;
      if (!pl) return null;

      const songs = (pl.tracks || pl.songs || []).map((t: any) => this.mapTrack(t));
      return {
        id: `gaana-playlist-${cleanId}`,
        name: this.cleanHtml(pl.name || pl.title || 'Gaana Playlist'),
        description: pl.description || '',
        artworkUrl: this.getHighResImage(pl.artwork || pl.image),
        songCount: songs.length || parseInt(String(pl.song_count || pl.track_count || 0), 10),
        isPublic: true,
        provider: 'gaana',
        providerId: cleanId,
        songs,
      };
    } catch {
      return null;
    }
  }
}
