import type { MusicProvider } from '../../types/provider';
import type { Album, Artist, Playlist, SearchResults, Track } from '../../types/music';

export class SpotifyProvider implements MusicProvider {
  id = 'spotify' as const;
  name = 'Spotify';
  isAvailable = Boolean(typeof import.meta !== 'undefined' && import.meta.env?.VITE_SPOTIFY_CLIENT_ID);
  isConnected = false;

  async search(_query: string): Promise<SearchResults> {
    if (!this.isConnected || !this.isAvailable) {
      return { tracks: [], artists: [], albums: [], playlists: [] };
    }
    // Official Spotify Web API integration placeholder
    return { tracks: [], artists: [], albums: [], playlists: [] };
  }

  async getTrack(_id: string): Promise<Track | null> {
    return null;
  }

  async getAlbum(_id: string): Promise<Album | null> {
    return null;
  }

  async getArtist(_id: string): Promise<Artist | null> {
    return null;
  }

  async getPlaylist(_id: string): Promise<Playlist | null> {
    return null;
  }

  async connect(): Promise<boolean> {
    // Official OAuth flow placeholder - disabled until user provides verified Spotify developer credentials
    console.warn('[SpotifyProvider] Official credentials required before authentication.');
    return false;
  }

  async disconnect(): Promise<void> {
    this.isConnected = false;
  }
}
