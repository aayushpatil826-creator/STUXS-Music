-- ==============================================================================
-- STUXS MUSIC SEARCH OPTIMIZATION MIGRATION
-- Enables pg_trgm and creates GIN indexes for fast fuzzy & typo-tolerant search
-- ==============================================================================

-- 1. Enable pg_trgm extension for trigram fuzzy matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Create GIN Trigram indexes on searchable text fields
CREATE INDEX IF NOT EXISTS idx_songs_title_trgm ON public.songs USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_songs_artist_trgm ON public.songs USING gin (artist_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_songs_album_trgm ON public.songs USING gin (album_title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_songs_genre_trgm ON public.songs USING gin (genre gin_trgm_ops);

-- 3. Composite Index for Published & Verified Audio filter
CREATE INDEX IF NOT EXISTS idx_songs_published_audio ON public.songs (is_published, audio_storage_path)
WHERE is_published = true AND audio_storage_path IS NOT NULL;

-- 4. Fast RPC search function for fuzzy scoring & ranking in PostgreSQL (hybrid DB + client)
CREATE OR REPLACE FUNCTION search_stuxs_songs(search_query TEXT, max_results INT DEFAULT 40)
RETURNS SETOF public.songs
LANGUAGE sql
STABLE
AS $$
  SELECT *
  FROM public.songs
  WHERE is_published = true
    AND audio_storage_path IS NOT NULL
    AND (
      title ILIKE '%' || search_query || '%'
      OR artist_name ILIKE '%' || search_query || '%'
      OR album_title ILIKE '%' || search_query || '%'
      OR genre ILIKE '%' || search_query || '%'
      OR similarity(title, search_query) > 0.3
      OR similarity(artist_name, search_query) > 0.3
    )
  ORDER BY
    similarity(title, search_query) DESC,
    play_count DESC NULLS LAST
  LIMIT max_results;
$$;
