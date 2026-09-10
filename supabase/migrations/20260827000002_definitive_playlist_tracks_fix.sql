-- ===========================================================================
-- STUXS Music — DEFINITIVE Playlist Fix
-- Run this ENTIRE script in your Supabase SQL Editor.
-- ===========================================================================

-- STEP 1: Drop old broken playlist_songs table (wrong column types)
DROP TABLE IF EXISTS public.playlist_songs CASCADE;

-- STEP 2: Create the correct playlist_tracks table
-- playlist_id is UUID to match playlists.id (which is UUID)
-- track_id is TEXT to support streaming IDs from any provider
CREATE TABLE IF NOT EXISTS public.playlist_tracks (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id  UUID        NOT NULL REFERENCES public.playlists(id) ON DELETE CASCADE,
  track_id     TEXT        NOT NULL,
  track_data   JSONB       NOT NULL DEFAULT '{}',
  position     INTEGER     NOT NULL DEFAULT 0,
  added_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_playlist_tracks UNIQUE (playlist_id, track_id)
);

CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist_id ON public.playlist_tracks(playlist_id);

-- STEP 3: Enable RLS and create policies
ALTER TABLE public.playlist_tracks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view tracks in viewable playlists"      ON public.playlist_tracks;
DROP POLICY IF EXISTS "Users can insert tracks in their own playlists"   ON public.playlist_tracks;
DROP POLICY IF EXISTS "Users can update tracks in their own playlists"   ON public.playlist_tracks;
DROP POLICY IF EXISTS "Users can delete tracks from their own playlists" ON public.playlist_tracks;

CREATE POLICY "Users can view tracks in viewable playlists"
  ON public.playlist_tracks FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.playlists p WHERE p.id = playlist_tracks.playlist_id AND (p.is_public = true OR p.user_id = auth.uid())));

CREATE POLICY "Users can insert tracks in their own playlists"
  ON public.playlist_tracks FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.playlists p WHERE p.id = playlist_tracks.playlist_id AND p.user_id = auth.uid()));

CREATE POLICY "Users can update tracks in their own playlists"
  ON public.playlist_tracks FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.playlists p WHERE p.id = playlist_tracks.playlist_id AND p.user_id = auth.uid()));

CREATE POLICY "Users can delete tracks from their own playlists"
  ON public.playlist_tracks FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.playlists p WHERE p.id = playlist_tracks.playlist_id AND p.user_id = auth.uid()));

-- STEP 4: Refresh playlists RLS
ALTER TABLE public.playlists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public playlists are viewable by everyone" ON public.playlists;
DROP POLICY IF EXISTS "Users can create their own playlists"      ON public.playlists;
DROP POLICY IF EXISTS "Users can update their own playlists"      ON public.playlists;
DROP POLICY IF EXISTS "Users can delete their own playlists"      ON public.playlists;

CREATE POLICY "Public playlists are viewable by everyone"
  ON public.playlists FOR SELECT USING (is_public = true OR auth.uid() = user_id);
CREATE POLICY "Users can create their own playlists"
  ON public.playlists FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own playlists"
  ON public.playlists FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own playlists"
  ON public.playlists FOR DELETE USING (auth.uid() = user_id);

-- STEP 5: Force PostgREST schema reload
NOTIFY pgrst, 'reload schema';

-- STEP 6: Verify table was created (should return 6 rows)
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'playlist_tracks'
ORDER BY ordinal_position;
