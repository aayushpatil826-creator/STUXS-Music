import type { Album, Artist, Playlist, SearchResults, Track, ProviderType } from './music';

export interface MusicProvider {
  id: ProviderType;
  name: string;
  isAvailable: boolean;
  isConnected: boolean;
  search(query: string): Promise<SearchResults>;
  getTrack(id: string): Promise<Track | null>;
  getAlbum(id: string): Promise<Album | null>;
  getArtist(id: string): Promise<Artist | null>;
  getPlaylist(id: string): Promise<Playlist | null>;
  connect?(): Promise<boolean>;
  disconnect?(): Promise<void>;
}

export interface PlaybackProvider {
  id: ProviderType;
  play(track: Track): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  seek(position: number): Promise<void>;
  stop(): Promise<void>;
  setVolume?(volume: number): void;
}

export interface ProviderAccount {
  id: string;
  provider: ProviderType;
  providerUserId?: string;
  isConnected: boolean;
  updatedAt?: string;
}
