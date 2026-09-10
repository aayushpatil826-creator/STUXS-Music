-- ============================================================================
-- STUXS Music: Definitive Playlist Schema & RLS Migration
-- Creates and ensures public.playlists, public.playlist_tracks, and public.playlist_songs
-- ============================================================================

-- 1. Ensure public.playlists table exists with TEXT ID support
CREATE TABLE IF NOT EXISTS public.playlists (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  artwork_url TEXT,
  is_public BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 2. Create public.playlist_tracks (Primary standard relationship table with JSON track_data)
CREATE TABLE IF NOT EXISTS public.playlist_tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id TEXT NOT NULL REFERENCES public.playlists(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL,
  track_data JSONB NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  added_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT uq_playlist_tracks_playlist_track UNIQUE (playlist_id, track_id)
);

-- 3. Create public.playlist_songs (Compatibility alias table with identical structure)
CREATE TABLE IF NOT EXISTS public.playlist_songs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id TEXT NOT NULL REFERENCES public.playlists(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL,
  track_data JSONB NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  added_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT uq_playlist_songs_playlist_track UNIQUE (playlist_id, track_id)
);

-- 4. Enable RLS on all playlist tables
ALTER TABLE public.playlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playlist_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playlist_songs ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------
-- 5. RLS Policies for public.playlists
-- ----------------------------------------------------
DROP POLICY IF EXISTS "Public playlists are viewable by everyone" ON public.playlists;
DROP POLICY IF EXISTS "Users can create their own playlists" ON public.playlists;
DROP POLICY IF EXISTS "Users can update their own playlists" ON public.playlists;
DROP POLICY IF EXISTS "Users can delete their own playlists" ON public.playlists;

CREATE POLICY "Public playlists are viewable by everyone" 
  ON public.playlists FOR SELECT 
  USING (is_public = true OR auth.uid() = user_id);

CREATE POLICY "Users can create their own playlists" 
  ON public.playlists FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own playlists" 
  ON public.playlists FOR UPDATE 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own playlists" 
  ON public.playlists FOR DELETE 
  USING (auth.uid() = user_id);

-- ----------------------------------------------------
-- 6. RLS Policies for public.playlist_tracks
-- ----------------------------------------------------
DROP POLICY IF EXISTS "Users can view tracks in viewable playlists" ON public.playlist_tracks;
DROP POLICY IF EXISTS "Users can insert tracks in their own playlists" ON public.playlist_tracks;
DROP POLICY IF EXISTS "Users can update tracks in their own playlists" ON public.playlist_tracks;
DROP POLICY IF EXISTS "Users can delete tracks from their own playlists" ON public.playlist_tracks;

CREATE POLICY "Users can view tracks in viewable playlists" 
  ON public.playlist_tracks FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM public.playlists p 
      WHERE p.id = playlist_tracks.playlist_id 
        AND (p.is_public = true OR p.user_id = auth.uid())
    )
  );

CREATE POLICY "Users can insert tracks in their own playlists" 
  ON public.playlist_tracks FOR INSERT 
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.playlists p 
      WHERE p.id = playlist_tracks.playlist_id 
        AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update tracks in their own playlists" 
  ON public.playlist_tracks FOR UPDATE 
  USING (
    EXISTS (
      SELECT 1 FROM public.playlists p 
      WHERE p.id = playlist_tracks.playlist_id 
        AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete tracks from their own playlists" 
  ON public.playlist_tracks FOR DELETE 
  USING (
    EXISTS (
      SELECT 1 FROM public.playlists p 
      WHERE p.id = playlist_tracks.playlist_id 
        AND p.user_id = auth.uid()
    )
  );

-- ----------------------------------------------------
-- 7. RLS Policies for public.playlist_songs (Compatibility)
-- ----------------------------------------------------
DROP POLICY IF EXISTS "Users can view songs in viewable playlists" ON public.playlist_songs;
DROP POLICY IF EXISTS "Users can insert songs in their own playlists" ON public.playlist_songs;
DROP POLICY IF EXISTS "Users can update songs in their own playlists" ON public.playlist_songs;
DROP POLICY IF EXISTS "Users can delete songs from their own playlists" ON public.playlist_songs;

CREATE POLICY "Users can view songs in viewable playlists" 
  ON public.playlist_songs FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM public.playlists p 
      WHERE p.id = playlist_songs.playlist_id 
        AND (p.is_public = true OR p.user_id = auth.uid())
    )
  );

CREATE POLICY "Users can insert songs in their own playlists" 
  ON public.playlist_songs FOR INSERT 
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.playlists p 
      WHERE p.id = playlist_songs.playlist_id 
        AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update songs in their own playlists" 
  ON public.playlist_songs FOR UPDATE 
  USING (
    EXISTS (
      SELECT 1 FROM public.playlists p 
      WHERE p.id = playlist_songs.playlist_id 
        AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete songs from their own playlists" 
  ON public.playlist_songs FOR DELETE 
  USING (
    EXISTS (
      SELECT 1 FROM public.playlists p 
      WHERE p.id = playlist_songs.playlist_id 
        AND p.user_id = auth.uid()
    )
  );
