import type { MusicProvider } from '../../types/provider';
import type { Album, Artist, Playlist, SearchResults, Track } from '../../types/music';
import { MOCK_ARTISTS } from '../../data/mock/artists';
import { MOCK_ALBUMS } from '../../data/mock/albums';
import { MOCK_TRACKS } from '../../data/mock/tracks';
import { MOCK_PLAYLISTS } from '../../data/mock/playlists';
import { normalizeSearchQuery, isFuzzyMatch, tokenizeText } from '../../utils/searchIntelligence';

export class MockMusicProvider implements MusicProvider {
  id = 'stuxs' as const;
  name = 'STUXS Core Catalog';
  isAvailable = true;
  isConnected = true;

  async search(query: string): Promise<SearchResults> {
    const nq = normalizeSearchQuery(query);
    if (!nq.clean) {
      return { tracks: [], artists: [], albums: [], playlists: [] };
    }

    const matchesTokens = (targetText: string): boolean => {
      if (!targetText) return false;
      const targetTokens = tokenizeText(targetText);
      return nq.meaningfulTokens.some(
        (qToken) =>
          targetTokens.includes(qToken) ||
          targetTokens.some((t) => t.startsWith(qToken)) ||
          targetTokens.some((t) => isFuzzyMatch(qToken, t))
      );
    };

    const tracks = MOCK_TRACKS.filter((t) => {
      const combined = `${t.title} ${t.artistName} ${t.albumTitle || ''}`;
      return combined.toLowerCase().includes(nq.clean) || matchesTokens(combined);
    });

    const artists = MOCK_ARTISTS.filter((a) => {
      const combined = `${a.name} ${a.genres?.join(' ') || ''}`;
      return combined.toLowerCase().includes(nq.clean) || matchesTokens(combined);
    });

    const albums = MOCK_ALBUMS.filter((al) => {
      const combined = `${al.title} ${al.artistName} ${al.genre}`;
      return combined.toLowerCase().includes(nq.clean) || matchesTokens(combined);
    });

    const playlists = MOCK_PLAYLISTS.filter((p) => {
      const combined = `${p.name} ${p.description || ''}`;
      return combined.toLowerCase().includes(nq.clean) || matchesTokens(combined);
    });

    return { tracks, artists, albums, playlists };
  }

  async getTrack(id: string): Promise<Track | null> {
    const track = MOCK_TRACKS.find((t) => t.id === id);
    return track || null;
  }

  async getAlbum(id: string): Promise<Album | null> {
    const album = MOCK_ALBUMS.find((a) => a.id === id);
    if (!album) return null;
    const albumTracks = MOCK_TRACKS.filter((t) => t.albumId === id);
    return { ...album, songs: albumTracks };
  }

  async getArtist(id: string): Promise<Artist | null> {
    const artist = MOCK_ARTISTS.find((a) => a.id === id);
    return artist || null;
  }

  async getPlaylist(id: string): Promise<Playlist | null> {
    const playlist = MOCK_PLAYLISTS.find((p) => p.id === id);
    return playlist || null;
  }
}
