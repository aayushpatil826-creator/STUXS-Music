import type { MusicProvider } from '../../types/provider';
import type { Album, Artist, Playlist, SearchResults, Track } from '../../types/music';

export class ITunesProvider implements MusicProvider {
  id = 'itunes' as const;
  name = 'iTunes Store';
  isAvailable = true;
  isConnected = true;

  private baseUrl =
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_ITUNES_API_URL) ||
    'https://itunes.apple.com';

  private getHighResArtwork(url?: string): string {
    if (!url) return 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80';
    return url
      .replace('100x100bb', '600x600bb')
      .replace('60x60bb', '600x600bb')
      .replace('100x100', '600x600');
  }

  async search(query: string): Promise<SearchResults> {
    const q = query.trim();
    if (!q) {
      return { tracks: [], artists: [], albums: [], playlists: [] };
    }

    try {
      const response = await fetch(
        `${this.baseUrl}/search?term=${encodeURIComponent(q)}&media=music&limit=25`
      );

      if (!response.ok) {
        return { tracks: [], artists: [], albums: [], playlists: [] };
      }

      const data = await response.json();
      const results: SearchResults = {
        tracks: [],
        artists: [],
        albums: [],
        playlists: [],
      };

      const seenArtists = new Set<string>();
      const seenAlbums = new Set<string>();

      for (const item of data.results || []) {
        if (item.wrapperType === 'track' && item.kind === 'song') {
          results.tracks.push({
            id: `itunes-track-${item.trackId}`,
            title: item.trackName,
            artistId: `itunes-artist-${item.artistId}`,
            artistName: item.artistName,
            albumId: `itunes-album-${item.collectionId}`,
            albumTitle: item.collectionName,
            artworkUrl: this.getHighResArtwork(item.artworkUrl100),
            previewUrl: item.previewUrl || undefined,
            audioUrl: undefined,
            duration: Math.round((item.trackTimeMillis || 0) / 1000),
            provider: 'itunes',
            providerId: String(item.trackId),
            isExplicit: item.trackExplicitness === 'explicit',
            isPlayable: false,
            isPreview: true,
            accessStatus: 'preview',
            playbackType: 'preview',
            trackNumber: item.trackNumber,
          });

          if (item.artistName && !seenArtists.has(item.artistName)) {
            seenArtists.add(item.artistName);
            results.artists.push({
              id: `itunes-artist-${item.artistId}`,
              name: item.artistName,
              artworkUrl: this.getHighResArtwork(item.artworkUrl100),
              isVerified: true,
              genres: [item.primaryGenreName].filter(Boolean),
              provider: 'itunes',
              providerArtistId: String(item.artistId),
            });
          }

          if (item.collectionId && !seenAlbums.has(String(item.collectionId))) {
            seenAlbums.add(String(item.collectionId));
            results.albums.push({
              id: `itunes-album-${item.collectionId}`,
              title: item.collectionName,
              artistId: `itunes-artist-${item.artistId}`,
              artistName: item.artistName,
              artworkUrl: this.getHighResArtwork(item.artworkUrl100),
              releaseDate: item.releaseDate ? item.releaseDate.split('T')[0] : '',
              genre: item.primaryGenreName || 'Music',
              trackCount: item.trackCount || 1,
              provider: 'itunes',
              providerId: String(item.collectionId),
            });
          }
        }
      }

      return results;
    } catch {
      return { tracks: [], artists: [], albums: [], playlists: [] };
    }
  }

  async getTrack(id: string): Promise<Track | null> {
    try {
      const cleanId = id.replace('itunes-track-', '');
      const response = await fetch(`${this.baseUrl}/lookup?id=${cleanId}`);
      if (!response.ok) return null;
      const data = await response.json();
      const item = data.results?.[0];
      if (!item) return null;

      return {
        id: `itunes-track-${item.trackId}`,
        title: item.trackName,
        artistId: `itunes-artist-${item.artistId}`,
        artistName: item.artistName,
        albumId: `itunes-album-${item.collectionId}`,
        albumTitle: item.collectionName,
        artworkUrl: this.getHighResArtwork(item.artworkUrl100),
        previewUrl: item.previewUrl || undefined,
        audioUrl: item.previewUrl || undefined,
        duration: Math.round((item.trackTimeMillis || 0) / 1000),
        provider: 'itunes',
        providerId: String(item.trackId),
        isExplicit: item.trackExplicitness === 'explicit',
        isPlayable: true,
        isPreview: false,
        accessStatus: 'playable',
        playbackType: 'full',
      };
    } catch {
      return null;
    }
  }

  async getAlbum(id: string): Promise<Album | null> {
    try {
      const cleanId = id.replace('itunes-album-', '');
      const response = await fetch(`${this.baseUrl}/lookup?id=${cleanId}&entity=song`);
      if (!response.ok) return null;
      const data = await response.json();
      const albumData = data.results?.find((r: { wrapperType: string }) => r.wrapperType === 'collection');
      if (!albumData) return null;

      const trackItems = data.results.filter((r: { wrapperType: string }) => r.wrapperType === 'track');
      const songs: Track[] = trackItems.map((item: any) => ({
        id: `itunes-track-${item.trackId}`,
        title: item.trackName,
        artistId: `itunes-artist-${item.artistId}`,
        artistName: item.artistName,
        albumId: `itunes-album-${item.collectionId}`,
        albumTitle: item.collectionName,
        artworkUrl: this.getHighResArtwork(item.artworkUrl100),
        previewUrl: item.previewUrl || undefined,
        audioUrl: item.previewUrl || undefined,
        duration: Math.round((item.trackTimeMillis || 0) / 1000),
        provider: 'itunes',
        providerId: String(item.trackId),
        isExplicit: item.trackExplicitness === 'explicit',
        isPlayable: true,
        isPreview: false,
        accessStatus: 'playable',
        playbackType: 'full',
        trackNumber: item.trackNumber,
      }));

      return {
        id: `itunes-album-${albumData.collectionId}`,
        title: albumData.collectionName,
        artistId: `itunes-artist-${albumData.artistId}`,
        artistName: albumData.artistName,
        artworkUrl: this.getHighResArtwork(albumData.artworkUrl100),
        releaseDate: albumData.releaseDate ? albumData.releaseDate.split('T')[0] : '',
        genre: albumData.primaryGenreName || 'Music',
        trackCount: albumData.trackCount || songs.length,
        provider: 'itunes',
        providerId: String(albumData.collectionId),
        songs,
      };
    } catch {
      return null;
    }
  }

  async getArtist(idOrName: string): Promise<Artist | null> {
    try {
      let artistId = idOrName.replace('itunes-artist-', '');

      // Step 1: If artistId is not purely numeric (e.g. artist name string), resolve the real Apple Music artist ID
      if (!/^\d+$/.test(artistId)) {
        const searchRes = await fetch(
          `${this.baseUrl}/search?term=${encodeURIComponent(decodeURIComponent(artistId))}&entity=musicArtist&limit=5`
        );
        if (searchRes.ok) {
          const searchData = await searchRes.json();
          const topArtist = searchData.results?.[0];
          if (topArtist?.artistId) {
            artistId = String(topArtist.artistId);
          }
        }
      }

      if (!/^\d+$/.test(artistId)) {
        return null;
      }

      // Step 2: Query Apple/iTunes Catalog for Artist + Popular Songs & Albums in parallel
      const [songsRes, albumsRes] = await Promise.allSettled([
        fetch(`${this.baseUrl}/lookup?id=${artistId}&entity=song&limit=25`),
        fetch(`${this.baseUrl}/lookup?id=${artistId}&entity=album&limit=20`),
      ]);

      let artistItem: any = null;
      const songs: Track[] = [];
      const albums: Album[] = [];

      if (songsRes.status === 'fulfilled' && songsRes.value.ok) {
        const songsData = await songsRes.value.json();
        artistItem = songsData.results?.find((r: any) => r.wrapperType === 'artist') || artistItem;
        const rawTracks = songsData.results?.filter((r: any) => r.wrapperType === 'track' && r.kind === 'song') || [];

        for (const t of rawTracks) {
          songs.push({
            id: `itunes-track-${t.trackId}`,
            title: t.trackName,
            artistId: `itunes-artist-${t.artistId}`,
            artistName: t.artistName,
            albumId: `itunes-album-${t.collectionId}`,
            albumTitle: t.collectionName,
            artworkUrl: this.getHighResArtwork(t.artworkUrl100),
            previewUrl: t.previewUrl || undefined,
            audioUrl: t.previewUrl || undefined,
            duration: Math.round((t.trackTimeMillis || 0) / 1000),
            provider: 'itunes',
            providerId: String(t.trackId),
            isExplicit: t.trackExplicitness === 'explicit',
            isPlayable: true,
            isPreview: false,
            accessStatus: 'playable',
            playbackType: 'full',
          });
        }
      }

      if (albumsRes.status === 'fulfilled' && albumsRes.value.ok) {
        const albumsData = await albumsRes.value.json();
        artistItem = albumsData.results?.find((r: any) => r.wrapperType === 'artist') || artistItem;
        const rawAlbums = albumsData.results?.filter((r: any) => r.wrapperType === 'collection') || [];

        for (const a of rawAlbums) {
          albums.push({
            id: `itunes-album-${a.collectionId}`,
            title: a.collectionName,
            artistId: `itunes-artist-${a.artistId}`,
            artistName: a.artistName || artistItem?.artistName || 'Artist',
            artworkUrl: this.getHighResArtwork(a.artworkUrl100),
            releaseDate: a.releaseDate ? a.releaseDate.split('T')[0] : '',
            genre: a.primaryGenreName || 'Music',
            trackCount: a.trackCount || 1,
            provider: 'itunes',
            providerId: String(a.collectionId),
          });
        }
      }

      if (!artistItem && songs.length === 0 && albums.length === 0) {
        return null;
      }

      const artistName = artistItem?.artistName || songs[0]?.artistName || albums[0]?.artistName || idOrName;
      const artworkUrl =
        this.getHighResArtwork(songs[0]?.artworkUrl) ||
        this.getHighResArtwork(albums[0]?.artworkUrl) ||
        'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80';

      const genres: string[] = [artistItem?.primaryGenreName, songs[0]?.language]
        .filter(Boolean)
        .map((g: string) => g.charAt(0).toUpperCase() + g.slice(1));

      return {
        id: `itunes-artist-${artistId}`,
        name: artistName,
        artworkUrl,
        isVerified: true,
        genres: genres.length > 0 ? genres : undefined,
        provider: 'itunes',
        providerArtistId: artistId,
        songs,
        albums,
      };
    } catch (err) {
      console.warn('[ITunesProvider] getArtist error:', err);
      return null;
    }
  }

  async getPlaylist(_id: string): Promise<Playlist | null> {
    return null;
  }

  async connect(): Promise<boolean> {
    this.isConnected = true;
    return true;
  }

  async disconnect(): Promise<void> {
    this.isConnected = false;
  }
}
