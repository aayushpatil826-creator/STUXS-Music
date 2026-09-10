export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          username: string | null;
          display_name: string | null;
          avatar_url: string | null;
          role: 'user' | 'developer';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          username?: string | null;
          display_name?: string | null;
          avatar_url?: string | null;
          role?: 'user' | 'developer';
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          username?: string | null;
          display_name?: string | null;
          avatar_url?: string | null;
          role?: 'user' | 'developer';
          created_at?: string;
          updated_at?: string;
        };
      };
      artists: {
        Row: {
          id: string;
          name: string;
          artwork_url: string | null;
          bio: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          artwork_url?: string | null;
          bio?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          artwork_url?: string | null;
          bio?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      albums: {
        Row: {
          id: string;
          title: string;
          artist_id: string | null;
          artwork_url: string | null;
          release_date: string | null;
          genre: string | null;
          provider: string;
          provider_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          artist_id?: string | null;
          artwork_url?: string | null;
          release_date?: string | null;
          genre?: string | null;
          provider?: string;
          provider_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          title?: string;
          artist_id?: string | null;
          artwork_url?: string | null;
          release_date?: string | null;
          genre?: string | null;
          provider?: string;
          provider_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      songs: {
        Row: {
          id: string;
          title: string;
          artist_id: string | null;
          artist_name: string | null;
          album_id: string | null;
          album_title: string | null;
          artwork_url: string | null;
          duration: number;
          provider: string;
          provider_id: string | null;
          genre: string | null;
          language: string | null;
          release_year: number | null;
          audio_storage_path: string | null;
          audio_url: string | null;
          is_explicit: boolean;
          is_published: boolean;
          uploaded_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          artist_id?: string | null;
          artist_name?: string | null;
          album_id?: string | null;
          album_title?: string | null;
          artwork_url?: string | null;
          duration?: number;
          provider?: string;
          provider_id?: string | null;
          genre?: string | null;
          language?: string | null;
          release_year?: number | null;
          audio_storage_path?: string | null;
          audio_url?: string | null;
          is_explicit?: boolean;
          is_published?: boolean;
          uploaded_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          title?: string;
          artist_id?: string | null;
          artist_name?: string | null;
          album_id?: string | null;
          album_title?: string | null;
          artwork_url?: string | null;
          duration?: number;
          provider?: string;
          provider_id?: string | null;
          genre?: string | null;
          language?: string | null;
          release_year?: number | null;
          audio_storage_path?: string | null;
          audio_url?: string | null;
          is_explicit?: boolean;
          is_published?: boolean;
          uploaded_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      playlists: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          description: string | null;
          artwork_url: string | null;
          is_public: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          description?: string | null;
          artwork_url?: string | null;
          is_public?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          description?: string | null;
          artwork_url?: string | null;
          is_public?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      playlist_tracks: {
        Row: {
          id: string;
          playlist_id: string;
          track_id: string;
          track_data: Json;
          position: number;
          added_at: string;
        };
        Insert: {
          id?: string;
          playlist_id: string;
          track_id: string;
          track_data: Json;
          position?: number;
          added_at?: string;
        };
        Update: {
          id?: string;
          playlist_id?: string;
          track_id?: string;
          track_data?: Json;
          position?: number;
          added_at?: string;
        };
      };
      playlist_songs: {
        Row: {
          id?: string;
          playlist_id: string;
          track_id?: string;
          song_id?: string;
          track_data?: Json;
          position: number;
          added_at: string;
        };
        Insert: {
          id?: string;
          playlist_id: string;
          track_id?: string;
          song_id?: string;
          track_data?: Json;
          position?: number;
          added_at?: string;
        };
        Update: {
          id?: string;
          playlist_id?: string;
          track_id?: string;
          song_id?: string;
          track_data?: Json;
          position?: number;
          added_at?: string;
        };
      };
      favorites: {
        Row: {
          user_id: string;
          song_id: string;
          created_at: string;
        };
        Insert: {
          user_id: string;
          song_id: string;
          created_at?: string;
        };
        Update: {
          user_id?: string;
          song_id?: string;
          created_at?: string;
        };
      };
      recently_played: {
        Row: {
          id: string;
          user_id: string;
          song_id: string;
          played_at: string;
          position_seconds: number;
        };
        Insert: {
          id?: string;
          user_id: string;
          song_id: string;
          played_at?: string;
          position_seconds?: number;
        };
        Update: {
          id?: string;
          user_id?: string;
          song_id?: string;
          played_at?: string;
          position_seconds?: number;
        };
      };
      provider_accounts: {
        Row: {
          id: string;
          user_id: string;
          provider: string;
          provider_user_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          provider: string;
          provider_user_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          provider?: string;
          provider_user_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
    };
  };
}
