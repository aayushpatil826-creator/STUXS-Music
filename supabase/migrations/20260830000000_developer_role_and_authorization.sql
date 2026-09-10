-- ===========================================================================
-- STUXS Music — Role-Based Authorization & Developer Security Foundation
-- Migration: 20260830000000_developer_role_and_authorization.sql
-- ===========================================================================

-- 1. Add role column to profiles table with strict check constraint
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';

ALTER TABLE public.profiles 
DROP CONSTRAINT IF EXISTS chk_profiles_role;

ALTER TABLE public.profiles 
ADD CONSTRAINT chk_profiles_role 
CHECK (role IN ('user', 'developer'));

-- Create index for fast role lookups
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);

-- 2. Secure helper function to verify if a user ID has the developer role
-- Uses SECURITY DEFINER with explicit search_path to prevent search-path injection
CREATE OR REPLACE FUNCTION public.is_developer(user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF user_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1 
    FROM public.profiles 
    WHERE id = user_id 
      AND role = 'developer'
  );
END;
$$;

-- Restrict function execution permissions (authenticated & service_role only)
REVOKE ALL ON FUNCTION public.is_developer(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_developer(UUID) TO authenticated, service_role;

-- 3. Privilege Escalation Guard Trigger
-- Normal authenticated users CANNOT escalate themselves or any other user to 'developer'
CREATE OR REPLACE FUNCTION public.prevent_role_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- If role is being changed:
  IF (OLD.role IS DISTINCT FROM NEW.role) THEN
    -- Allow change ONLY if the calling session is authenticated as a developer or executed via service_role / direct SQL editor (auth.uid() IS NULL)
    IF auth.uid() IS NOT NULL AND NOT public.is_developer(auth.uid()) THEN
      RAISE EXCEPTION 'Access Denied: You do not have permission to modify user roles.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_prevent_role_escalation ON public.profiles;
CREATE TRIGGER tr_prevent_role_escalation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW 
  EXECUTE FUNCTION public.prevent_role_escalation();

-- 4. Secure Profile Creation on Auth Sign-up
-- Ensures every new user registered ALWAYS defaults to role = 'user'
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.profiles (id, username, display_name, avatar_url, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url',
    'user' -- Hardcoded server-side default; client metadata cannot override
  )
  ON CONFLICT (id) DO UPDATE SET
    username = EXCLUDED.username,
    display_name = EXCLUDED.display_name,
    avatar_url = EXCLUDED.avatar_url;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW 
  EXECUTE FUNCTION public.handle_new_user();

-- 5. Row Level Security Policies for Songs Catalog
ALTER TABLE public.songs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Songs are viewable by everyone" ON public.songs;
DROP POLICY IF EXISTS "Developers can insert songs" ON public.songs;
DROP POLICY IF EXISTS "Developers can update songs" ON public.songs;
DROP POLICY IF EXISTS "Developers can delete songs" ON public.songs;

-- Public can read published catalog
CREATE POLICY "Songs are viewable by everyone"
  ON public.songs 
  FOR SELECT 
  USING (true);

-- Only verified developers can insert songs
CREATE POLICY "Developers can insert songs"
  ON public.songs 
  FOR INSERT 
  TO authenticated 
  WITH CHECK (public.is_developer(auth.uid()));

-- Only verified developers can update songs
CREATE POLICY "Developers can update songs"
  ON public.songs 
  FOR UPDATE 
  TO authenticated 
  USING (public.is_developer(auth.uid()))
  WITH CHECK (public.is_developer(auth.uid()));

-- Only verified developers can delete songs
CREATE POLICY "Developers can delete songs"
  ON public.songs 
  FOR DELETE 
  TO authenticated 
  USING (public.is_developer(auth.uid()));

-- 6. Row Level Security Policies for Albums Catalog
ALTER TABLE public.albums ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Albums are viewable by everyone" ON public.albums;
DROP POLICY IF EXISTS "Developers can insert albums" ON public.albums;
DROP POLICY IF EXISTS "Developers can update albums" ON public.albums;
DROP POLICY IF EXISTS "Developers can delete albums" ON public.albums;

CREATE POLICY "Albums are viewable by everyone"
  ON public.albums 
  FOR SELECT 
  USING (true);

CREATE POLICY "Developers can insert albums"
  ON public.albums 
  FOR INSERT 
  TO authenticated 
  WITH CHECK (public.is_developer(auth.uid()));

CREATE POLICY "Developers can update albums"
  ON public.albums 
  FOR UPDATE 
  TO authenticated 
  USING (public.is_developer(auth.uid()))
  WITH CHECK (public.is_developer(auth.uid()));

CREATE POLICY "Developers can delete albums"
  ON public.albums 
  FOR DELETE 
  TO authenticated 
  USING (public.is_developer(auth.uid()));

-- 7. Row Level Security Policies for Artists Catalog
ALTER TABLE public.artists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Artists are viewable by everyone" ON public.artists;
DROP POLICY IF EXISTS "Developers can insert artists" ON public.artists;
DROP POLICY IF EXISTS "Developers can update artists" ON public.artists;
DROP POLICY IF EXISTS "Developers can delete artists" ON public.artists;

CREATE POLICY "Artists are viewable by everyone"
  ON public.artists 
  FOR SELECT 
  USING (true);

CREATE POLICY "Developers can insert artists"
  ON public.artists 
  FOR INSERT 
  TO authenticated 
  WITH CHECK (public.is_developer(auth.uid()));

CREATE POLICY "Developers can update artists"
  ON public.artists 
  FOR UPDATE 
  TO authenticated 
  USING (public.is_developer(auth.uid()))
  WITH CHECK (public.is_developer(auth.uid()));

CREATE POLICY "Developers can delete artists"
  ON public.artists 
  FOR DELETE 
  TO authenticated 
  USING (public.is_developer(auth.uid()));
