import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../config/supabase';
import type { Database } from '../types/database.types';
import { localCacheService } from '../services/LocalCacheService';
import { networkStateService } from '../services/NetworkStateService';

export type Profile = Database['public']['Tables']['profiles']['Row'];

export interface AuthSessionSnapshot {
  user: User | null;
  profile: Profile | null;
  session: Session | null;
  isGuest: boolean;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  role: 'user' | 'developer';
  isDeveloper: boolean;
  isLoading: boolean;
  isConfigured: boolean;
  isPasswordRecovery: boolean;
  signInWithEmailPassword: (email: string, password: string) => Promise<{ error: string | null }>;
  signUpWithEmail: (email: string, password: string, displayName: string) => Promise<{ error: string | null; requiresEmailVerification?: boolean }>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  sendPasswordResetEmail: (email: string) => Promise<{ error: string | null }>;
  updatePassword: (newPassword: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  updateProfile: (updates: Partial<Profile>) => Promise<{ error: string | null }>;
  dismissPasswordRecovery: () => void;
  continueAsGuest: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function formatAuthError(error: any): string {
  if (!error) return 'An unknown error occurred';
  const msg = error.message || String(error);
  if (msg.includes('Email not confirmed')) {
    return 'Email not confirmed yet. Please check your inbox for the confirmation link, or disable "Confirm email" in Supabase Dashboard → Auth → Providers.';
  }
  if (msg.includes('Invalid login credentials')) {
    return 'Invalid email or password. If you are a new user, please click "Sign Up" first to create your account.';
  }
  if (msg.includes('User already registered') || msg.includes('already exists')) {
    return 'An account with this email already exists. Please switch to "Log In".';
  }
  if (msg.includes('Password should be at least')) {
    return 'Password must be at least 6 characters long.';
  }
  if (msg.includes('rate limit')) {
    return 'Too many attempts. Please wait a moment and try again.';
  }
  return msg;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Synchronous Frame-0 snapshot restoration for instant app rendering
  const [snapshot] = useState<AuthSessionSnapshot | null>(() => {
    try {
      return localCacheService.getSync<AuthSessionSnapshot>('auth_session_snapshot')?.data || null;
    } catch {
      return null;
    }
  });

  const [user, setUser] = useState<User | null>(() => snapshot?.user || null);
  const [session, setSession] = useState<Session | null>(() => snapshot?.session || null);
  const [profile, setProfile] = useState<Profile | null>(() => snapshot?.profile || null);
  // If snapshot exists (either real user or guest), isLoading is false immediately on frame 0!
  const [isLoading, setIsLoading] = useState<boolean>(() => !snapshot?.user && !snapshot?.isGuest);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const configured = isSupabaseConfigured();

  const saveSnapshot = (u: User | null, p: Profile | null, s: Session | null, isGuest: boolean) => {
    if (u || isGuest) {
      localCacheService.set(
        'auth_session_snapshot',
        { user: u, profile: p, session: s, isGuest },
        isGuest ? 30 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000
      );
    } else {
      localCacheService.remove('auth_session_snapshot');
    }
  };

  const fetchOrCreateProfile = async (u: User, customDisplayName?: string, activeSession?: Session | null) => {
    // Check local storage cached avatar and display_name
    let cachedAvatar: string | null = null;
    let cachedName: string | null = null;
    try {
      cachedAvatar = localStorage.getItem(`stuxs_avatar_${u.id}`);
      cachedName = localStorage.getItem(`stuxs_display_name_${u.id}`);
    } catch {}

    const fallbackProfile: Profile = {
      id: u.id,
      username: u.email?.split('@')[0] || `user_${u.id.slice(0, 6)}`,
      display_name: cachedName || customDisplayName || u.user_metadata?.display_name || u.user_metadata?.full_name || u.email?.split('@')[0] || 'STUXS Listener',
      avatar_url: cachedAvatar !== null ? (cachedAvatar || null) : (u.user_metadata?.avatar_url || u.user_metadata?.picture || null),
      role: (u.app_metadata?.role === 'developer' ? 'developer' : 'user') as 'user' | 'developer',
      created_at: u.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    try {
      const { data, error } = await (supabase
        .from('profiles') as any)
        .select('*')
        .eq('id', u.id)
        .maybeSingle();

      if (data) {
        const loadedProfile: Profile = {
          ...data,
          avatar_url: cachedAvatar !== null ? (cachedAvatar || null) : (data.avatar_url || null),
          display_name: cachedName || data.display_name || 'STUXS Listener',
          role: (data.role === 'developer' ? 'developer' : 'user') as 'user' | 'developer',
        };
        setProfile(loadedProfile);
        saveSnapshot(u, loadedProfile, activeSession ?? session, false);
        return;
      }

      if (!data && !error) {
        const { data: inserted } = await supabase
          .from('profiles')
          .insert(fallbackProfile as any)
          .select('*')
          .single();

        if (inserted) {
          setProfile(inserted);
          saveSnapshot(u, inserted, activeSession ?? session, false);
          return;
        }
      }
      setProfile(fallbackProfile);
      saveSnapshot(u, fallbackProfile, activeSession ?? session, false);
    } catch {
      setProfile(fallbackProfile);
      saveSnapshot(u, fallbackProfile, activeSession ?? session, false);
    }
  };

  useEffect(() => {
    // Check if recovery token is present in URL hash
    if (typeof window !== 'undefined' && window.location.hash.includes('type=recovery')) {
      setIsPasswordRecovery(true);
    }

    if (!configured) {
      // Local fallback mode when Supabase env vars are not set
      setIsLoading(false);
      return;
    }

    // 1. Asynchronous background session revalidation with bounded 2.5s timeout
    const startMs = Date.now();
    let sessionResolved = false;
    const timeoutTimer = setTimeout(() => {
      if (!sessionResolved) {
        networkStateService.recordRequestLatency(2500, true);
        console.warn('[AuthContext] getSession timed out (2.5s). Retaining cached session snapshot.');
        setIsLoading(false);
      }
    }, 2500);

    supabase.auth.getSession()
      .then(({ data: { session: realSession }, error }) => {
        sessionResolved = true;
        clearTimeout(timeoutTimer);
        const elapsed = Date.now() - startMs;
        networkStateService.recordRequestLatency(elapsed, false);

        if (error) {
          console.warn('[AuthContext] getSession error:', error);
          setIsLoading(false);
          return;
        }

        if (realSession?.user) {
          setSession(realSession);
          setUser(realSession.user);
          fetchOrCreateProfile(realSession.user, undefined, realSession);
        } else if (!snapshot?.isGuest) {
          // Server authoritatively reports no session and user is not in guest mode
          setUser(null);
          setSession(null);
          setProfile(null);
          saveSnapshot(null, null, null, false);
        }
        setIsLoading(false);
      })
      .catch((err) => {
        sessionResolved = true;
        clearTimeout(timeoutTimer);
        networkStateService.recordRequestLatency(2500, true);
        console.warn('[AuthContext] getSession network error:', err);
        // Preserve cached UI snapshot when offline/DNS delayed
        setIsLoading(false);
      });

    // 2. Real-time auth state listener
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);

      if (event === 'PASSWORD_RECOVERY') {
        setIsPasswordRecovery(true);
      }

      if (event === 'SIGNED_OUT') {
        saveSnapshot(null, null, null, false);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('stuxs:auth-signout'));
        }
      }

      if (newSession?.user) {
        await fetchOrCreateProfile(newSession.user, undefined, newSession);
      } else if (!snapshot?.isGuest) {
        setProfile(null);
        saveSnapshot(null, null, null, false);
      }
      setIsLoading(false);
    });

    return () => {
      clearTimeout(timeoutTimer);
      subscription.unsubscribe();
    };
  }, [configured]);

  const signInWithEmailPassword = async (email: string, password: string) => {
    if (!configured) {
      return { error: 'Supabase credentials not configured. Please add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.' };
    }
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) {
        return { error: formatAuthError(error) };
      }
      if (data.user) {
        await fetchOrCreateProfile(data.user);
      }
      return { error: null };
    } catch (err) {
      return { error: formatAuthError(err) };
    }
  };

  const signUpWithEmail = async (email: string, password: string, displayName: string) => {
    if (!configured) {
      return { error: 'Supabase credentials not configured. Please add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.' };
    }
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            display_name: displayName.trim(),
          },
        },
      });
      if (error) {
        return { error: formatAuthError(error) };
      }
      if (data.user) {
        await fetchOrCreateProfile(data.user, displayName.trim());
      }
      const requiresEmailVerification = !data.session && Boolean(data.user);
      return { error: null, requiresEmailVerification };
    } catch (err) {
      return { error: formatAuthError(err) };
    }
  };

  const signInWithGoogle = async () => {
    if (!configured) {
      return { error: 'Supabase credentials not configured. Please add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.' };
    }
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
        },
      });
      if (error) {
        return { error: formatAuthError(error) };
      }
      return { error: null };
    } catch (err) {
      return { error: formatAuthError(err) };
    }
  };

  const sendPasswordResetEmail = async (email: string) => {
    if (!configured) {
      return { error: 'Supabase credentials not configured.' };
    }
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/#type=recovery`,
      });
      if (error) {
        return { error: formatAuthError(error) };
      }
      return { error: null };
    } catch (err) {
      return { error: formatAuthError(err) };
    }
  };

  const updatePassword = async (newPassword: string) => {
    if (!configured) {
      return { error: 'Supabase credentials not configured.' };
    }
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (error) {
        return { error: formatAuthError(error) };
      }
      setIsPasswordRecovery(false);
      return { error: null };
    } catch (err) {
      return { error: formatAuthError(err) };
    }
  };

  const signOut = async () => {
    saveSnapshot(null, null, null, false);
    // 1. Instantly trigger global signout event to pause/stop playback & clear media session
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('stuxs:auth-signout'));
    }

    if (configured) {
      try {
        await supabase.auth.signOut();
      } catch (err) {
        console.warn('[AuthContext] signOut error:', err);
      }
    }
    setUser(null);
    setSession(null);
    setProfile(null);
  };

  const updateProfile = async (updates: Partial<Profile>) => {
    if (!user) {
      return { error: 'No authenticated user session found.' };
    }

    // Role cannot be modified by the client through normal profile updates
    const { role: _ignoredRole, ...safeUpdates } = updates;

    const updatedProfile: Profile = {
      ...(profile || {
        id: user.id,
        username: user.email?.split('@')[0] || `user_${user.id.slice(0, 6)}`,
        display_name: user.user_metadata?.display_name || user.email?.split('@')[0] || 'STUXS Listener',
        avatar_url: null,
        role: 'user',
        created_at: user.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
      ...safeUpdates,
      role: profile?.role || 'user',
      updated_at: new Date().toISOString(),
    };

    // Update local React state instantly
    setProfile(updatedProfile);
    saveSnapshot(user, updatedProfile, session, user.id === 'guest-user-uuid');

    // Save to localStorage for instant persistence across restarts
    try {
      if (updatedProfile.avatar_url !== undefined) {
        localStorage.setItem(`stuxs_avatar_${user.id}`, updatedProfile.avatar_url || '');
      }
      if (updatedProfile.display_name !== undefined) {
        localStorage.setItem(`stuxs_display_name_${user.id}`, updatedProfile.display_name || '');
      }
    } catch {}

    if (configured && user.id !== 'guest-user-uuid' && session) {
      try {
        const { error: authUpdateError } = await supabase.auth.updateUser({
          data: {
            display_name: updatedProfile.display_name,
            avatar_url: updatedProfile.avatar_url,
          },
        });

        const { error: profileUpdateError } = await (supabase.from('profiles') as any)
          .update({
            ...safeUpdates,
            updated_at: new Date().toISOString(),
          })
          .eq('id', user.id);

        if (authUpdateError || profileUpdateError) {
          console.warn('[AuthContext] updateProfile sync error:', authUpdateError || profileUpdateError);
          // Local state and localStorage are already updated optimistically.
          // Inform the caller so the UI can surface a non-blocking warning.
          return {
            error: 'Failed to save profile. Changes are saved locally and will sync when reconnected.',
          };
        }
      } catch (err) {
        console.warn('[AuthContext] updateProfile sync error:', err);
        return {
          error: 'Failed to save profile. Changes are saved locally and will sync when reconnected.',
        };
      }
    }
    return { error: null };
  };

  const dismissPasswordRecovery = () => {
    setIsPasswordRecovery(false);
    if (window.location.hash.includes('type=recovery')) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  };

  const continueAsGuest = () => {
    const guestUser = {
      id: 'guest-user-uuid',
      email: 'guest@stuxsmusic.app',
      app_metadata: {},
      user_metadata: { display_name: 'Guest Listener' },
      aud: 'authenticated',
      created_at: new Date().toISOString(),
    } as User;
    const guestProfile: Profile = {
      id: 'guest-user-uuid',
      username: 'guest_listener',
      display_name: 'Guest Listener',
      avatar_url: null,
      role: 'user',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    saveSnapshot(guestUser, guestProfile, null, true);
    setUser(guestUser);
    setProfile(guestProfile);
    setIsLoading(false);
  };

  const currentRole = profile?.role ?? 'user';
  const isDeveloper = currentRole === 'developer';

  const contextValue = useMemo(
    () => ({
      user,
      session,
      profile,
      role: currentRole,
      isDeveloper,
      isLoading,
      isConfigured: configured,
      isPasswordRecovery,
      signInWithEmailPassword,
      signUpWithEmail,
      signInWithGoogle,
      sendPasswordResetEmail,
      updatePassword,
      signOut,
      updateProfile,
      dismissPasswordRecovery,
      continueAsGuest,
    }),
    [
      user,
      session,
      profile,
      currentRole,
      isDeveloper,
      isLoading,
      configured,
      isPasswordRecovery,
      signInWithEmailPassword,
      signUpWithEmail,
      signInWithGoogle,
      sendPasswordResetEmail,
      updatePassword,
      signOut,
      updateProfile,
      dismissPasswordRecovery,
      continueAsGuest,
    ]
  );

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
