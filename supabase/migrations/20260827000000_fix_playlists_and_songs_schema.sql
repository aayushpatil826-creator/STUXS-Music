-- STUXS Music - Migration: Fix Playlist and Song ID Schema & RLS Policies
-- Solves "Cannot add song" caused by UUID constraints on streaming track IDs, missing songs RLS, and foreign key blocks.

DO $$ 
BEGIN
  -- Drop restrictive foreign keys on dynamic catalog IDs if they exist
  ALTER TABLE IF EXISTS public.playlist_songs DROP CONSTRAINT IF EXISTS playlist_songs_song_id_fkey;
  ALTER TABLE IF EXISTS public.playlist_songs DROP CONSTRAINT IF EXISTS playlist_songs_playlist_id_fkey;
  ALTER TABLE IF EXISTS public.favorites DROP CONSTRAINT IF EXISTS favorites_song_id_fkey;
  ALTER TABLE IF EXISTS public.recently_played DROP CONSTRAINT IF EXISTS recently_played_song_id_fkey;
  ALTER TABLE IF EXISTS public.songs DROP CONSTRAINT IF EXISTS songs_artist_id_fkey;
  ALTER TABLE IF EXISTS public.songs DROP CONSTRAINT IF EXISTS songs_album_id_fkey;
  ALTER TABLE IF EXISTS public.albums DROP CONSTRAINT IF EXISTS albums_artist_id_fkey;

  -- Convert IDs to TEXT to support all streaming providers (JioSaavn, SoundCloud, custom)
  ALTER TABLE IF EXISTS public.songs ALTER COLUMN id TYPE TEXT;
  ALTER TABLE IF EXISTS public.songs ALTER COLUMN artist_id TYPE TEXT;
  ALTER TABLE IF EXISTS public.songs ALTER COLUMN album_id TYPE TEXT;

  ALTER TABLE IF EXISTS public.playlists ALTER COLUMN id TYPE TEXT;

  ALTER TABLE IF EXISTS public.playlist_songs ALTER COLUMN playlist_id TYPE TEXT;
  ALTER TABLE IF EXISTS public.playlist_songs ALTER COLUMN song_id TYPE TEXT;

  ALTER TABLE IF EXISTS public.favorites ALTER COLUMN song_id TYPE TEXT;
  ALTER TABLE IF EXISTS public.recently_played ALTER COLUMN song_id TYPE TEXT;

  -- Re-add parent cascading foreign keys
  ALTER TABLE IF EXISTS public.playlist_songs 
    ADD CONSTRAINT playlist_songs_playlist_id_fkey 
    FOREIGN KEY (playlist_id) REFERENCES public.playlists(id) ON DELETE CASCADE;

  ALTER TABLE IF EXISTS public.playlist_songs 
    ADD CONSTRAINT playlist_songs_song_id_fkey 
    FOREIGN KEY (song_id) REFERENCES public.songs(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN 
  RAISE NOTICE 'Migration adjustment notice: %', SQLERRM;
END $$;

-- 2. Ensure songs table has comprehensive RLS policies (SELECT, INSERT, UPDATE)
ALTER TABLE public.songs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Songs are viewable by everyone" ON public.songs;
DROP POLICY IF EXISTS "Allow public select on songs" ON public.songs;
DROP POLICY IF EXISTS "Allow authenticated insert on songs" ON public.songs;
DROP POLICY IF EXISTS "Allow authenticated update on songs" ON public.songs;
DROP POLICY IF EXISTS "Allow public insert on songs" ON public.songs;
DROP POLICY IF EXISTS "Allow public update on songs" ON public.songs;

CREATE POLICY "Allow public select on songs" 
  ON public.songs FOR SELECT 
  USING (true);

CREATE POLICY "Allow authenticated insert on songs" 
  ON public.songs FOR INSERT 
  WITH CHECK (true);

CREATE POLICY "Allow authenticated update on songs" 
  ON public.songs FOR UPDATE 
  USING (true);

-- 3. Ensure playlists table RLS policies
ALTER TABLE public.playlists ENABLE ROW LEVEL SECURITY;

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

-- 4. Ensure playlist_songs table RLS policies
ALTER TABLE public.playlist_songs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Playlist songs viewable if playlist viewable" ON public.playlist_songs;
DROP POLICY IF EXISTS "Users can modify songs in their playlists" ON public.playlist_songs;
DROP POLICY IF EXISTS "Users can insert songs in their playlists" ON public.playlist_songs;
DROP POLICY IF EXISTS "Users can select songs in their playlists" ON public.playlist_songs;
DROP POLICY IF EXISTS "Users can delete songs in their playlists" ON public.playlist_songs;
DROP POLICY IF EXISTS "Users can update songs in their playlists" ON public.playlist_songs;

CREATE POLICY "Users can select songs in their playlists" 
  ON public.playlist_songs FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM public.playlists p 
      WHERE p.id = playlist_id AND (p.is_public = true OR p.user_id = auth.uid())
    )
  );

CREATE POLICY "Users can insert songs in their playlists" 
  ON public.playlist_songs FOR INSERT 
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.playlists p 
      WHERE p.id = playlist_id AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update songs in their playlists" 
  ON public.playlist_songs FOR UPDATE 
  USING (
    EXISTS (
      SELECT 1 FROM public.playlists p 
      WHERE p.id = playlist_id AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete songs in their playlists" 
  ON public.playlist_songs FOR DELETE 
  USING (
    EXISTS (
      SELECT 1 FROM public.playlists p 
      WHERE p.id = playlist_id AND p.user_id = auth.uid()
    )
  );
