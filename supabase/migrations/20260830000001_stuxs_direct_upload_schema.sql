-- ===========================================================================
-- STUXS Music — Direct Upload Schema & Storage Policies
-- Migration: 20260830000001_stuxs_direct_upload_schema.sql
-- ===========================================================================

-- 1. Extend public.songs table with full STUXS direct upload columns
ALTER TABLE public.songs
ADD COLUMN IF NOT EXISTS artist_name TEXT,
ADD COLUMN IF NOT EXISTS album_title TEXT,
ADD COLUMN IF NOT EXISTS genre TEXT,
ADD COLUMN IF NOT EXISTS language TEXT,
ADD COLUMN IF NOT EXISTS release_year INTEGER,
ADD COLUMN IF NOT EXISTS audio_storage_path TEXT,
ADD COLUMN IF NOT EXISTS audio_url TEXT,
ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_songs_is_published ON public.songs(is_published);
CREATE INDEX IF NOT EXISTS idx_songs_provider ON public.songs(provider);
CREATE INDEX IF NOT EXISTS idx_songs_uploaded_by ON public.songs(uploaded_by);

-- 2. Update Row Level Security on public.songs
ALTER TABLE public.songs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Songs are viewable by everyone" ON public.songs;
DROP POLICY IF EXISTS "Published songs viewable by everyone, drafts by developers" ON public.songs;
DROP POLICY IF EXISTS "Developers can insert songs" ON public.songs;
DROP POLICY IF EXISTS "Developers can update songs" ON public.songs;
DROP POLICY IF EXISTS "Developers can delete songs" ON public.songs;

-- Read policy: Normal users see published songs; developers see both published & drafts
CREATE POLICY "Published songs viewable by everyone, drafts by developers"
  ON public.songs 
  FOR SELECT 
  USING (is_published = true OR public.is_developer(auth.uid()));

-- Write policies: Strictly developer-only
CREATE POLICY "Developers can insert songs"
  ON public.songs 
  FOR INSERT 
  TO authenticated 
  WITH CHECK (public.is_developer(auth.uid()));

CREATE POLICY "Developers can update songs"
  ON public.songs 
  FOR UPDATE 
  TO authenticated 
  USING (public.is_developer(auth.uid()))
  WITH CHECK (public.is_developer(auth.uid()));

CREATE POLICY "Developers can delete songs"
  ON public.songs 
  FOR DELETE 
  TO authenticated 
  USING (public.is_developer(auth.uid()));

-- 3. Create Supabase Storage Buckets for STUXS Audio & Artwork
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES 
  ('stuxs-audio', 'stuxs-audio', true, 104857600, ARRAY['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/flac', 'audio/ogg', 'audio/wav']),
  ('stuxs-artwork', 'stuxs-artwork', true, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 4. Storage Row Level Security Policies
-- Anyone can read public audio and artwork files
DROP POLICY IF EXISTS "Public can view STUXS audio" ON storage.objects;
CREATE POLICY "Public can view STUXS audio"
  ON storage.objects FOR SELECT
  USING (bucket_id IN ('stuxs-audio', 'stuxs-artwork'));

-- Only verified developers can upload/modify/delete storage objects
DROP POLICY IF EXISTS "Developers can upload STUXS audio" ON storage.objects;
CREATE POLICY "Developers can upload STUXS audio"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id IN ('stuxs-audio', 'stuxs-artwork') AND public.is_developer(auth.uid()));

DROP POLICY IF EXISTS "Developers can update STUXS audio" ON storage.objects;
CREATE POLICY "Developers can update STUXS audio"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id IN ('stuxs-audio', 'stuxs-artwork') AND public.is_developer(auth.uid()))
  WITH CHECK (bucket_id IN ('stuxs-audio', 'stuxs-artwork') AND public.is_developer(auth.uid()));

DROP POLICY IF EXISTS "Developers can delete STUXS audio" ON storage.objects;
CREATE POLICY "Developers can delete STUXS audio"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id IN ('stuxs-audio', 'stuxs-artwork') AND public.is_developer(auth.uid()));
