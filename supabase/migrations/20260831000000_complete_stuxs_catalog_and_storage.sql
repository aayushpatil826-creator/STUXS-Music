-- ===========================================================================
-- STUXS Music — Canonical Storage Buckets & Catalog Schema Migration
-- Migration: 20260831000000_complete_stuxs_catalog_and_storage.sql
-- ===========================================================================

-- 1. Ensure UUID extension is available
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Ensure Storage Buckets Exist for STUXS Audio and Artwork
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES 
  (
    'stuxs-audio', 
    'stuxs-audio', 
    true, 
    104857600, -- 100 MB max audio file
    ARRAY['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/flac', 'audio/ogg', 'audio/wav']
  ),
  (
    'stuxs-artwork', 
    'stuxs-artwork', 
    true, 
    10485760, -- 10 MB max cover image
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/avif']
  )
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 3. Storage Row Level Security Policies
-- Anyone can stream/view public audio and artwork files
DROP POLICY IF EXISTS "Public can view STUXS audio" ON storage.objects;
DROP POLICY IF EXISTS "Public can view STUXS media" ON storage.objects;
CREATE POLICY "Public can view STUXS media"
  ON storage.objects FOR SELECT
  USING (bucket_id IN ('stuxs-audio', 'stuxs-artwork'));

-- Only verified developers can upload media files
DROP POLICY IF EXISTS "Developers can upload STUXS audio" ON storage.objects;
DROP POLICY IF EXISTS "Developers can upload STUXS media" ON storage.objects;
CREATE POLICY "Developers can upload STUXS media"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id IN ('stuxs-audio', 'stuxs-artwork') 
    AND public.is_developer(auth.uid())
  );

-- Only verified developers can update media files
DROP POLICY IF EXISTS "Developers can update STUXS audio" ON storage.objects;
DROP POLICY IF EXISTS "Developers can update STUXS media" ON storage.objects;
CREATE POLICY "Developers can update STUXS media"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id IN ('stuxs-audio', 'stuxs-artwork') 
    AND public.is_developer(auth.uid())
  )
  WITH CHECK (
    bucket_id IN ('stuxs-audio', 'stuxs-artwork') 
    AND public.is_developer(auth.uid())
  );

-- Only verified developers can delete media files
DROP POLICY IF EXISTS "Developers can delete STUXS audio" ON storage.objects;
DROP POLICY IF EXISTS "Developers can delete STUXS media" ON storage.objects;
CREATE POLICY "Developers can delete STUXS media"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id IN ('stuxs-audio', 'stuxs-artwork') 
    AND public.is_developer(auth.uid())
  );

-- 4. Create / Ensure Artists Table
CREATE TABLE IF NOT EXISTS public.artists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  artwork_url TEXT,
  bio TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.artists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Artists are viewable by everyone" ON public.artists;
CREATE POLICY "Artists are viewable by everyone"
  ON public.artists FOR SELECT USING (true);

DROP POLICY IF EXISTS "Developers can insert artists" ON public.artists;
CREATE POLICY "Developers can insert artists"
  ON public.artists FOR INSERT TO authenticated
  WITH CHECK (public.is_developer(auth.uid()));

DROP POLICY IF EXISTS "Developers can update artists" ON public.artists;
CREATE POLICY "Developers can update artists"
  ON public.artists FOR UPDATE TO authenticated
  USING (public.is_developer(auth.uid()))
  WITH CHECK (public.is_developer(auth.uid()));

DROP POLICY IF EXISTS "Developers can delete artists" ON public.artists;
CREATE POLICY "Developers can delete artists"
  ON public.artists FOR DELETE TO authenticated
  USING (public.is_developer(auth.uid()));

-- 5. Create / Ensure Albums Table
CREATE TABLE IF NOT EXISTS public.albums (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  artist_id UUID REFERENCES public.artists(id) ON DELETE SET NULL,
  artwork_url TEXT,
  release_date DATE,
  genre TEXT,
  provider TEXT NOT NULL DEFAULT 'stuxs',
  provider_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.albums ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Albums are viewable by everyone" ON public.albums;
CREATE POLICY "Albums are viewable by everyone"
  ON public.albums FOR SELECT USING (true);

DROP POLICY IF EXISTS "Developers can insert albums" ON public.albums;
CREATE POLICY "Developers can insert albums"
  ON public.albums FOR INSERT TO authenticated
  WITH CHECK (public.is_developer(auth.uid()));

DROP POLICY IF EXISTS "Developers can update albums" ON public.albums;
CREATE POLICY "Developers can update albums"
  ON public.albums FOR UPDATE TO authenticated
  USING (public.is_developer(auth.uid()))
  WITH CHECK (public.is_developer(auth.uid()));

DROP POLICY IF EXISTS "Developers can delete albums" ON public.albums;
CREATE POLICY "Developers can delete albums"
  ON public.albums FOR DELETE TO authenticated
  USING (public.is_developer(auth.uid()));

-- 6. Create / Ensure Songs Table
CREATE TABLE IF NOT EXISTS public.songs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  artist_id UUID REFERENCES public.artists(id) ON DELETE SET NULL,
  artist_name TEXT,
  album_id UUID REFERENCES public.albums(id) ON DELETE SET NULL,
  album_title TEXT,
  genre TEXT,
  language TEXT,
  release_year INTEGER,
  duration INTEGER NOT NULL DEFAULT 0,
  provider TEXT NOT NULL DEFAULT 'stuxs',
  provider_id TEXT,
  artwork_url TEXT,
  audio_url TEXT,
  audio_storage_path TEXT,
  is_published BOOLEAN NOT NULL DEFAULT false,
  is_explicit BOOLEAN NOT NULL DEFAULT false,
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Ensure all columns exist if table already pre-existed
ALTER TABLE public.songs
  ADD COLUMN IF NOT EXISTS artist_name TEXT,
  ADD COLUMN IF NOT EXISTS album_title TEXT,
  ADD COLUMN IF NOT EXISTS genre TEXT,
  ADD COLUMN IF NOT EXISTS language TEXT,
  ADD COLUMN IF NOT EXISTS release_year INTEGER,
  ADD COLUMN IF NOT EXISTS duration INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'stuxs',
  ADD COLUMN IF NOT EXISTS provider_id TEXT,
  ADD COLUMN IF NOT EXISTS artwork_url TEXT,
  ADD COLUMN IF NOT EXISTS audio_url TEXT,
  ADD COLUMN IF NOT EXISTS audio_storage_path TEXT,
  ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_explicit BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Indexes for lightning fast catalog search & discovery
CREATE INDEX IF NOT EXISTS idx_songs_title ON public.songs USING gin(to_tsvector('simple', title));
CREATE INDEX IF NOT EXISTS idx_songs_artist_name ON public.songs USING gin(to_tsvector('simple', COALESCE(artist_name, '')));
CREATE INDEX IF NOT EXISTS idx_songs_album_title ON public.songs USING gin(to_tsvector('simple', COALESCE(album_title, '')));
CREATE INDEX IF NOT EXISTS idx_songs_is_published ON public.songs(is_published);
CREATE INDEX IF NOT EXISTS idx_songs_provider ON public.songs(provider);
CREATE INDEX IF NOT EXISTS idx_songs_language ON public.songs(language);
CREATE INDEX IF NOT EXISTS idx_songs_genre ON public.songs(genre);
CREATE INDEX IF NOT EXISTS idx_songs_uploaded_by ON public.songs(uploaded_by);

-- 7. Songs Table Row Level Security
ALTER TABLE public.songs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Songs are viewable by everyone" ON public.songs;
DROP POLICY IF EXISTS "Published songs viewable by everyone, drafts by developers" ON public.songs;
DROP POLICY IF EXISTS "Developers can insert songs" ON public.songs;
DROP POLICY IF EXISTS "Developers can update songs" ON public.songs;
DROP POLICY IF EXISTS "Developers can delete songs" ON public.songs;

-- Read: Normal users only see published tracks; developers see both published & drafts
CREATE POLICY "Published songs viewable by everyone, drafts by developers"
  ON public.songs 
  FOR SELECT 
  USING (is_published = true OR public.is_developer(auth.uid()));

-- Insert: Developer only
CREATE POLICY "Developers can insert songs"
  ON public.songs 
  FOR INSERT 
  TO authenticated 
  WITH CHECK (public.is_developer(auth.uid()));

-- Update: Developer only
CREATE POLICY "Developers can update songs"
  ON public.songs 
  FOR UPDATE 
  TO authenticated 
  USING (public.is_developer(auth.uid()))
  WITH CHECK (public.is_developer(auth.uid()));

-- Delete: Developer only
CREATE POLICY "Developers can delete songs"
  ON public.songs 
  FOR DELETE 
  TO authenticated 
  USING (public.is_developer(auth.uid()));
