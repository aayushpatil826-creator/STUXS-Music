import CryptoJS from 'crypto-js';
import type { MusicProvider } from '../../types/provider';
import type { Album, Artist, Playlist, SearchResults, Track, AudioQuality } from '../../types/music';
import { isDevEnvironment } from '../../utils/platform';

const JIOSAAVN_DES_KEY = CryptoJS.enc.Utf8.parse('38346591');

function decryptJioSaavnMediaUrl(encryptedMediaUrl: string): string | null {
  try {
    if (!encryptedMediaUrl || typeof encryptedMediaUrl !== 'string') return null;
    const decrypted = CryptoJS.DES.decrypt(
      encryptedMediaUrl.trim(),
      JIOSAAVN_DES_KEY,
      {
        mode: CryptoJS.mode.ECB,
        padding: CryptoJS.pad.Pkcs7,
      }
    ).toString(CryptoJS.enc.Utf8);
    return decrypted && decrypted.startsWith('http') ? decrypted : null;
  } catch (err) {
    console.warn('[JioSaavnProvider] DES decryption error:', err);
    return null;
  }
}

interface RawJioSaavnSong {
  id: string;
  song: string;
  album: string;
  albumid?: string;
  primary_artists: string;
  primary_artists_id?: string;
  singers?: string;
  image: string;
  language?: string;
  duration: string | number;
  encrypted_media_url?: string;
  media_preview_url?: string;
  has_lyrics?: string | boolean;
  explicit_content?: string | number;
}

export class JioSaavnProvider implements MusicProvider {
  id = 'jiosaavn' as const;
  name = 'JioSaavn';
  isAvailable = true;
  isConnected = true;

  private baseUrl: string;

  constructor() {
    const isDev = isDevEnvironment();

    const envProc = (globalThis as unknown as { process?: { env?: Record<string, string> } }).process;
    const configuredApiUrl =
      (typeof import.meta !== 'undefined' && import.meta.env?.VITE_JIOSAAVN_API_URL) ||
      envProc?.env?.VITE_JIOSAAVN_API_URL ||
      '';

    if (configuredApiUrl) {
      this.baseUrl = configuredApiUrl;
    } else if (isDev) {
      this.baseUrl = '/api/jiosaavn/api.php';
    } else {
      this.baseUrl = 'https://www.jiosaavn.com/api.php';
    }
  }

  private cleanHtml(text: string): string {
    if (!text) return '';
    return text
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&#039;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }

  private getHighResImage(imageUrl: string): string {
    if (!imageUrl) return 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80';
    return imageUrl.replace('150x150', '500x500').replace('50x50', '500x500');
  }

  public resolveAudioStreamUrl(
    encryptedUrl?: string,
    previewUrl?: string,
    preferredQuality?: AudioQuality
  ): { url?: string; bitrate: string; format: string } {
    let quality = preferredQuality;
    if (!quality) {
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          const raw = window.localStorage.getItem('stuxs_playback_settings');
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && parsed.audioQuality) quality = parsed.audioQuality;
          }
        }
      } catch {}
    }
    if (!quality) quality = 'very_high';

    if (encryptedUrl) {
      const decrypted = decryptJioSaavnMediaUrl(encryptedUrl);
      if (decrypted) {
        let suffix = '_320.mp4';
        let bitrate = '320 kbps AAC';
        if (quality === 'high') {
          suffix = '_160.mp4';
          bitrate = '160 kbps AAC';
        } else if (quality === 'normal') {
          suffix = '_96.mp4';
          bitrate = '96 kbps AAC';
        } else if (quality === 'saver') {
          suffix = '_48.mp4';
          bitrate = '48 kbps AAC';
        }

        let url = decrypted;
        if (url.includes('.mp4')) {
          url = url.replace(/_(96|160|320|48)\.mp4$/, '').replace(/\.mp4$/, '') + suffix;
        }
        if (url.startsWith('http://')) {
          url = url.replace('http://', 'https://');
        }
        return { url, bitrate, format: 'AAC / MP4' };
      }
    }

    if (previewUrl) {
      const securePreview = previewUrl.startsWith('http://') ? previewUrl.replace('http://', 'https://') : previewUrl;
      return { url: securePreview, bitrate: '128 kbps AAC (Preview)', format: 'AAC' };
    }

    return { url: undefined, bitrate: 'Unavailable', format: 'None' };
  }

  public resolveTrackQuality(track: Track, quality: AudioQuality): Track {
    if (!track.rawEncryptedUrl && !track.rawPreviewUrl) return track;
    const stream = this.resolveAudioStreamUrl(track.rawEncryptedUrl, track.rawPreviewUrl, quality);
    return {
      ...track,
      audioUrl: stream.url || track.audioUrl,
      actualBitrate: stream.bitrate,
      audioFormat: stream.format,
    };
  }

  private mapSongToTrack(song: any): Track {
    const more = song.more_info || {};
    const encryptedMediaUrl = more.encrypted_media_url || song.encrypted_media_url;
    const mediaPreviewUrl = more.media_preview_url || song.media_preview_url || more.vlink || song.vlink;
    const stream = this.resolveAudioStreamUrl(encryptedMediaUrl, mediaPreviewUrl);
    const isPlayable = Boolean(stream.url);

    // Extract primary artists list
    let artistName = '';
    let artistId = '';
    if (more.artistMap?.primary_artists?.length > 0) {
      artistName = more.artistMap.primary_artists.map((a: any) => a.name).join(', ');
      artistId = more.artistMap.primary_artists[0].id;
    } else if (song.artistMap?.primary_artists?.length > 0) {
      artistName = song.artistMap.primary_artists.map((a: any) => a.name).join(', ');
      artistId = song.artistMap.primary_artists[0].id;
    } else if (song.primary_artists) {
      artistName = song.primary_artists;
      artistId = song.primary_artists_id || '0';
    } else if (song.subtitle) {
      const parts = song.subtitle.split('-');
      artistName = parts[0].trim();
    } else if (song.singers) {
      artistName = song.singers;
    } else {
      artistName = 'JioSaavn Artist';
    }

    const title = song.song || song.title || 'Unknown Track';
    const albumTitle = more.album || song.album;
    const albumId = more.album_id || song.albumid;
    const duration = parseInt(String(more.duration || song.duration || 0), 10) || 180;
    const image = song.image || more.image || '';

    const label = this.cleanHtml(more.label || song.label || '');
    const copyrightText = this.cleanHtml(more.copyright_text || song.copyright_text || '');
    const singers = this.cleanHtml(more.singers || song.singers || '');
    const musicDirector = this.cleanHtml(more.music || song.music || '');
    const playCount = parseInt(String(more.play_count || song.play_count || 0), 10) || undefined;

    // Collect genuine provider-supported aliases/metadata for search discovery
    const searchAliases: string[] = [];
    if (label && label !== 'Universal Music' && label !== 'Sony Music') {
      searchAliases.push(label);
    }
    if (copyrightText && copyrightText.length > 5) {
      const cleanedCr = copyrightText.replace(/^©\s*\d{4}\s*/, '').trim();
      if (cleanedCr && !searchAliases.includes(cleanedCr)) {
        searchAliases.push(cleanedCr);
      }
    }
    if (singers && !searchAliases.includes(singers)) {
      searchAliases.push(singers);
    }
    if (musicDirector && !searchAliases.includes(musicDirector)) {
      searchAliases.push(musicDirector);
    }
    if (song.subtitle && typeof song.subtitle === 'string') {
      const sub = this.cleanHtml(song.subtitle).trim();
      if (sub && !searchAliases.includes(sub)) {
        searchAliases.push(sub);
      }
    }

    const trackNumber = parseInt(String(more.track_number || song.track_number || song.track || 0), 10) || undefined;
    const discNumber = parseInt(String(more.disc_number || song.disc_number || song.disc || 0), 10) || undefined;

    return {
      id: `jiosaavn-track-${song.id}`,
      title: this.cleanHtml(title),
      artistId: `jiosaavn-artist-${artistId || '0'}`,
      artistName: this.cleanHtml(artistName),
      albumId: albumId ? `jiosaavn-album-${albumId}` : undefined,
      albumTitle: albumTitle ? this.cleanHtml(albumTitle) : undefined,
      artworkUrl: this.getHighResImage(image),
      audioUrl: stream.url,
      rawEncryptedUrl: encryptedMediaUrl,
      rawPreviewUrl: mediaPreviewUrl,
      actualBitrate: stream.bitrate,
      audioFormat: stream.format,
      duration,
      provider: 'jiosaavn',
      providerId: song.id,
      isExplicit: song.explicit_content === '1' || song.explicit_content === 1 || more.explicit_content === '1',
      isPlayable,
      accessStatus: isPlayable ? 'playable' : 'blocked',
      language: song.language || more.language || undefined,
      trackNumber,
      discNumber,
      label: label || undefined,
      copyrightText: copyrightText || undefined,
      singers: singers || undefined,
      musicDirector: musicDirector || undefined,
      playCount,
      searchAliases: searchAliases.length > 0 ? searchAliases : undefined,
    };
  }

  async search(query: string): Promise<SearchResults> {
    const q = query.trim();
    if (!q) {
      return { tracks: [], artists: [], albums: [], playlists: [] };
    }

    try {
      const fetchUrl = `${this.baseUrl}?__call=search.getResults&_format=json&_marker=0&cc=in&p=1&n=20&q=${encodeURIComponent(q)}`;
      const playlistUrl = `${this.baseUrl}?__call=search.getPlaylistResults&_format=json&cc=in&p=1&n=8&q=${encodeURIComponent(q)}`;
      const albumUrl = `${this.baseUrl}?__call=search.getAlbumResults&_format=json&cc=in&p=1&n=8&q=${encodeURIComponent(q)}`;

      const [res, playlistRes, albumRes] = await Promise.all([
        fetch(fetchUrl).catch(() => null),
        fetch(playlistUrl).catch(() => null),
        fetch(albumUrl).catch(() => null),
      ]);

      if (!res || !res.ok) {
        return { tracks: [], artists: [], albums: [], playlists: [] };
      }

      const data = await res.json();
      const rawSongs: RawJioSaavnSong[] = data.results || [];
      const tracks: Track[] = rawSongs.map((s) => this.mapSongToTrack(s));

      // Extract unique Artists and Albums
      const seenArtistIds = new Set<string>();
      const artists: Artist[] = [];
      const seenAlbumIds = new Set<string>();
      const albums: Album[] = [];

      for (const s of rawSongs) {
        if (s.primary_artists && !seenArtistIds.has(s.primary_artists)) {
          seenArtistIds.add(s.primary_artists);
          artists.push({
            id: `jiosaavn-artist-${s.primary_artists_id || encodeURIComponent(s.primary_artists)}`,
            name: this.cleanHtml(s.primary_artists),
            artworkUrl: this.getHighResImage(s.image),
            isVerified: true,
            genres: [s.language || 'Indian'].filter(Boolean),
          });
        }

        if (s.albumid && !seenAlbumIds.has(s.albumid)) {
          seenAlbumIds.add(s.albumid);
          albums.push({
            id: `jiosaavn-album-${s.albumid}`,
            title: this.cleanHtml(s.album),
            artistId: `jiosaavn-artist-${s.primary_artists_id || '0'}`,
            artistName: this.cleanHtml(s.primary_artists || 'Artist'),
            artworkUrl: this.getHighResImage(s.image),
            releaseDate: '',
            genre: s.language || 'Indian Music',
            trackCount: 1,
            provider: 'jiosaavn',
            providerId: s.albumid,
          });
        }
      }

      // Merge albums discovered through search.getAlbumResults
      if (albumRes && albumRes.ok) {
        try {
          const albData = await albumRes.json();
          for (const a of albData.results || []) {
            const albId = String(a.id || a.albumid || '');
            if (albId && !seenAlbumIds.has(albId)) {
              seenAlbumIds.add(albId);
              albums.push({
                id: `jiosaavn-album-${albId}`,
                title: this.cleanHtml(a.title || a.name || a.album || 'Album'),
                artistId: `jiosaavn-artist-${a.primary_artists_id || a.more_info?.primary_artists_id || '0'}`,
                artistName: this.cleanHtml(a.primary_artists || a.more_info?.primary_artists || a.artist || 'Artist'),
                artworkUrl: this.getHighResImage(a.image || a.more_info?.image),
                releaseDate: a.year || a.more_info?.year || '',
                genre: a.language || a.more_info?.language || 'Indian Music',
                trackCount: parseInt(String(a.song_count || a.more_info?.song_count || 1), 10) || 1,
                provider: 'jiosaavn',
                providerId: albId,
              });
            }
          }
        } catch {}
      }

      // Extract real live Playlists
      let playlists: Playlist[] = [];
      if (playlistRes && playlistRes.ok) {
        try {
          const plData = await playlistRes.json();
          const rawPlaylists = plData.results || [];
          playlists = rawPlaylists.map((p: any) => ({
            id: `jiosaavn-playlist-${p.id || p.listid}`,
            name: this.cleanHtml(p.title || p.name || 'Playlist'),
            description: this.cleanHtml(p.subtitle || `${p.more_info?.song_count || p.song_count || '10'} songs`),
            artworkUrl: this.getHighResImage(p.image),
            isPublic: true,
            songCount: parseInt(String(p.more_info?.song_count || p.song_count || '0'), 10) || 0,
            provider: 'jiosaavn' as const,
            providerId: p.id || p.listid,
          }));
        } catch {
          // ignore playlist error
        }
      }

      return {
        tracks,
        artists,
        albums,
        playlists,
      };
    } catch (err) {
      console.warn('[JioSaavnProvider] Search error:', err);
      return { tracks: [], artists: [], albums: [], playlists: [] };
    }
  }

  async getTrack(id: string): Promise<Track | null> {
    const cleanId = id.replace('jiosaavn-track-', '');
    try {
      const res = await fetch(`${this.baseUrl}?__call=song.getDetails&cc=in&_marker=0&_format=json&pids=${cleanId}`);
      if (!res.ok) return null;
      const data = await res.json();
      const song = data[cleanId] || (data.songs && data.songs[0]);
      if (!song) return null;
      return this.mapSongToTrack(song);
    } catch {
      return null;
    }
  }

  async getArtist(idOrName: string): Promise<Artist | null> {
    try {
      let artistId = idOrName.replace('jiosaavn-artist-', '');

      // If artistId is not purely numeric (e.g. was generated from an artist name string), search for the real artist entity
      if (!/^\d+$/.test(artistId)) {
        const searchUrl = `${this.baseUrl}?__call=search.getArtistResults&_format=json&cc=in&p=1&n=5&q=${encodeURIComponent(decodeURIComponent(artistId))}`;
        const searchRes = await fetch(searchUrl);
        if (searchRes.ok) {
          const searchData = await searchRes.json();
          const topArtist = searchData.results?.[0];
          if (topArtist?.id) {
            artistId = topArtist.id;
          }
        }
      }

      if (!/^\d+$/.test(artistId)) {
        return null;
      }

      const detailsUrl = `${this.baseUrl}?__call=artist.getArtistPageDetails&_format=json&cc=in&artistId=${artistId}&n_song=20&n_album=15`;
      const res = await fetch(detailsUrl);
      if (!res.ok) return null;

      const data = await res.json();
      if (!data || (!data.name && !data.artistId)) return null;

      // Extract real biography if present
      let parsedBio = '';
      if (typeof data.bio === 'string' && data.bio.trim()) {
        try {
          const bioObj = JSON.parse(data.bio);
          if (Array.isArray(bioObj)) {
            parsedBio = bioObj.map((b: any) => b.text || b.bio || '').filter(Boolean).join('\n\n');
          } else if (typeof bioObj === 'object' && bioObj !== null) {
            parsedBio = bioObj.text || bioObj.bio || '';
          }
        } catch {
          parsedBio = data.bio;
        }
      } else if (Array.isArray(data.bio)) {
        parsedBio = data.bio.map((b: any) => b.text || b.bio || '').filter(Boolean).join('\n\n');
      }

      if (!parsedBio && data.subtitle && data.subtitle !== 'Artist') {
        parsedBio = data.subtitle;
      }

      // Map real popular songs
      const rawSongs = Array.isArray(data.topSongs)
        ? data.topSongs
        : (data.topSongs?.songs || data.topSongs?.list || []);
      const songs: Track[] = rawSongs.map((s: RawJioSaavnSong) => this.mapSongToTrack(s));

      // Map real albums
      const rawAlbums = Array.isArray(data.topAlbums)
        ? data.topAlbums
        : (data.topAlbums?.albums || data.topAlbums?.list || []);
      const albums: Album[] = rawAlbums.map((a: any) => ({
        id: `jiosaavn-album-${a.albumid || a.id}`,
        title: this.cleanHtml(a.album || a.name || a.title || 'Album'),
        artistId: `jiosaavn-artist-${artistId}`,
        artistName: this.cleanHtml(a.primaryArtists || a.artist || data.name),
        artworkUrl: this.getHighResImage(a.imageUrl || a.image),
        releaseDate: a.year || '',
        genre: a.language || data.dominantLanguage || 'Music',
        trackCount: parseInt(String(a.numSongs || a.song_count || 1), 10) || 1,
        provider: 'jiosaavn' as const,
        providerId: a.albumid || a.id,
      }));

      const followers = parseInt(String(data.follower_count || data.fan_count || '0').replace(/[^\d]/g, ''), 10);
      const genres: string[] = [data.dominantLanguage, data.dominantType]
        .filter(Boolean)
        .map((g: string) => g.charAt(0).toUpperCase() + g.slice(1));

      return {
        id: `jiosaavn-artist-${artistId}`,
        name: this.cleanHtml(data.name || idOrName),
        artworkUrl: this.getHighResImage(data.image),
        bio: parsedBio || undefined,
        monthlyListeners: followers > 0 ? followers : undefined,
        isVerified: data.isVerified ?? false,
        genres: genres.length > 0 ? genres : undefined,
        provider: 'jiosaavn',
        providerArtistId: artistId,
        songs,
        albums,
      };
    } catch (err) {
      console.warn('[JioSaavnProvider] getArtist error:', err);
      return null;
    }
  }

  async getAlbum(id: string): Promise<Album | null> {
    const cleanId = id.replace('jiosaavn-album-', '');
    try {
      const res = await fetch(`${this.baseUrl}?__call=content.getAlbumDetails&_format=json&cc=in&albumid=${cleanId}`);
      if (!res.ok) return null;
      const data = await res.json();
      const rawSongs = data.songs || data.list || [];
      const songs: Track[] = rawSongs.map((s: RawJioSaavnSong) => this.mapSongToTrack(s));

      return {
        id: `jiosaavn-album-${cleanId}`,
        title: this.cleanHtml(data.name || data.title || 'Album'),
        artistId: `jiosaavn-artist-${data.primary_artists_id || '0'}`,
        artistName: this.cleanHtml(data.primary_artists || 'Artist'),
        artworkUrl: this.getHighResImage(data.image),
        releaseDate: data.release_date || '',
        genre: data.language || 'Music',
        trackCount: songs.length,
        label: this.cleanHtml(data.header_desc || data.label || '') || undefined,
        copyrightText: this.cleanHtml(data.copyright_text || '') || undefined,
        provider: 'jiosaavn',
        providerId: cleanId,
        songs,
      };
    } catch {
      return null;
    }
  }

  async getPlaylist(id: string): Promise<Playlist | null> {
    const cleanId = id.replace('jiosaavn-playlist-', '');
    try {
      const res = await fetch(`${this.baseUrl}?__call=playlist.getDetails&_format=json&cc=in&listid=${cleanId}`);
      if (!res.ok) return null;
      const data = await res.json();
      const rawSongs = data.list || data.songs || [];
      const songs: Track[] = rawSongs.map((s: RawJioSaavnSong) => this.mapSongToTrack(s));

      return {
        id: `jiosaavn-playlist-${cleanId}`,
        name: this.cleanHtml(data.title || data.name || 'Playlist'),
        description: this.cleanHtml(data.description || data.header_desc || `${songs.length} tracks`),
        artworkUrl: this.getHighResImage(data.image),
        isPublic: true,
        songCount: songs.length,
        duration: songs.reduce((sum, t) => sum + (t.duration || 180), 0),
        provider: 'jiosaavn',
        providerId: cleanId,
        songs,
      };
    } catch (err) {
      console.warn('[JioSaavnProvider] getPlaylist error:', err);
      return null;
    }
  }

  async getStreamUrl(trackId: string): Promise<string | undefined> {
    const track = await this.getTrack(trackId);
    return track?.audioUrl;
  }

  async connect(): Promise<boolean> {
    this.isConnected = true;
    return true;
  }

  async disconnect(): Promise<void> {
    this.isConnected = false;
  }
}
