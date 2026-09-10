export type ProviderType = 'stuxs' | 'spotify' | 'itunes' | 'amazon' | 'jiosaavn' | 'gaana' | 'local';
export type TrackSourceType = 'stuxs' | 'jiosaavn' | 'gaana' | 'itunes' | 'local' | 'remote' | 'downloaded';

export interface Artist {
  id: string;
  name: string;
  artworkUrl: string;
  bio?: string;
  monthlyListeners?: number;
  isVerified?: boolean;
  genres?: string[];
  provider?: ProviderType;
  providerArtistId?: string;
  songs?: Track[];
  albums?: Album[];
}

export interface Album {
  id: string;
  title: string;
  artistId: string;
  artistName: string;
  artworkUrl: string;
  releaseDate: string;
  genre: string;
  trackCount: number;
  duration?: number; // total duration in seconds
  provider: ProviderType;
  providerId?: string;
  albumType?: 'album' | 'single' | 'ep' | 'compilation'; // provider-supplied album type
  label?: string; // Record label / publisher
  copyrightText?: string;
  songs?: Track[];
}

export type TrackAccessStatus = 'playable' | 'preview' | 'blocked';
export type PlaybackType = 'full' | 'preview' | 'blocked';

export interface Track {
  id: string;
  title: string;
  artistId: string;
  artistName: string;
  albumId?: string;
  albumTitle?: string;
  artworkUrl: string;
  audioUrl?: string; // Full-length playback stream URL
  previewUrl?: string; // 30-second preview stream URL
  duration: number; // in seconds
  provider: ProviderType;
  providerId?: string;
  isExplicit?: boolean;
  isPlayable?: boolean;
  isPreview?: boolean; // True only if genuinely limited to preview stream
  accessStatus?: TrackAccessStatus;
  playbackType?: PlaybackType;
  lyrics?: string[];
  trackNumber?: number;
  discNumber?: number;
  playCount?: number;
  language?: string; // e.g. 'hindi', 'tamil', 'punjabi', 'english', 'bengali', 'marathi'
  genre?: string;
  year?: string | number;
  releaseYear?: string | number;
  rawEncryptedUrl?: string;
  rawPreviewUrl?: string;
  actualBitrate?: string;
  audioFormat?: string;
  sourceType?: TrackSourceType;
  fileSize?: number; // bytes
  isDownloaded?: boolean;
  localPath?: string;
  label?: string; // Record label / trust / publisher
  copyrightText?: string;
  singers?: string;
  musicDirector?: string;
  searchAliases?: string[]; // Provider-supported search keywords, alternate titles, or related tags
}

export interface Playlist {
  id: string;
  userId?: string;
  name: string;
  description?: string;
  artworkUrl: string;
  customArtworkUrl?: string;
  isUserCreated?: boolean;
  isSaved?: boolean;
  isPublic: boolean;
  songCount: number;
  duration?: number;
  songs?: Track[];
  provider?: ProviderType;
  providerId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type CuratedCategory =
  | 'trending'
  | 'bollywood'
  | 'hindi'
  | 'punjabi'
  | 'marathi'
  | 'tamil'
  | 'telugu'
  | 'new_releases'
  | 'romantic'
  | 'party'
  | 'workout'
  | 'devotional'
  | 'international';

export interface CuratedPlaylist extends Playlist {
  category: CuratedCategory | string;
  categoryLabel?: string;
  region?: string;
  order?: number;
  featured?: boolean;
}

export interface SearchResults {
  tracks: Track[];
  artists: Artist[];
  albums: Album[];
  playlists: Playlist[];
}

export interface BrowseCategory {
  id: string;
  title: string;
  color: string;
  iconName: string;
  artworkUrl?: string;
}

export type AudioQuality = 'very_high' | 'high' | 'normal' | 'saver' | 'lossless';

export type RepeatMode = 'off' | 'all' | 'one';

export interface PlaybackSettings {
  audioQuality: AudioQuality;
  crossfadeSeconds: number;
  gaplessPlayback: boolean;
  normalizeVolume: boolean;
  autoplay: boolean;
  smartQueue: boolean; // Auto-play related music when queue ends
  useNativeAudioEngine?: boolean; // Phase 5 Shadow Mode: Native Media3/ExoPlayer (strictly defaults to false)
}

export type ThemeMode = 'system' | 'light' | 'dark';

export interface AppearanceSettings {
  themeMode: ThemeMode;
  theme?: string;
  accentColor: string;
  dynamicArtworkBg: boolean;
  compactPlayer: boolean;
}
