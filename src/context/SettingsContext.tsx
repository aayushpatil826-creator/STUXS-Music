import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import type { AppearanceSettings, PlaybackSettings, ThemeMode } from '../types/music';
import { BRAND_ACCENTS, BRANDING_CONFIG } from '../config/branding';

interface SettingsContextType {
  playback: PlaybackSettings;
  appearance: AppearanceSettings;
  updatePlayback: (updates: Partial<PlaybackSettings>) => void;
  updateAppearance: (updates: Partial<AppearanceSettings>) => void;
  setThemeMode: (mode: ThemeMode) => void;
  setAccentColor: (colorHex: string) => void;
}

export const DEFAULT_PLAYBACK: PlaybackSettings = {
  audioQuality: 'lossless',
  crossfadeSeconds: 4,
  gaplessPlayback: true,
  normalizeVolume: true,
  autoplay: true,
  smartQueue: true,
  useNativeAudioEngine: true,
};

const DEFAULT_APPEARANCE: AppearanceSettings = {
  themeMode: 'system',
  theme: 'obsidian',
  accentColor: BRANDING_CONFIG.defaultAccent.color,
  dynamicArtworkBg: true,
  compactPlayer: false,
};

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [playback, setPlayback] = useState<PlaybackSettings>(() => {
    try {
      const saved = localStorage.getItem('stuxs_playback_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        // Automatically migrate legacy useNativeAudioEngine=false to true without resetting user's other preferences
        return { ...DEFAULT_PLAYBACK, ...parsed, useNativeAudioEngine: true };
      }
      return DEFAULT_PLAYBACK;
    } catch {
      return DEFAULT_PLAYBACK;
    }
  });

  const [appearance, setAppearance] = useState<AppearanceSettings>(() => {
    try {
      const saved = localStorage.getItem('stuxs_appearance_settings');
      return saved ? { ...DEFAULT_APPEARANCE, ...JSON.parse(saved) } : DEFAULT_APPEARANCE;
    } catch {
      return DEFAULT_APPEARANCE;
    }
  });

  // Apply Theme Mode (System / Light / Dark) & Accent Color to DOM
  useEffect(() => {
    const applyTheme = () => {
      const root = document.documentElement;
      let effectiveTheme: 'dark' | 'light' = 'dark';

      if (appearance.themeMode === 'system') {
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        effectiveTheme = prefersDark ? 'dark' : 'light';
      } else if (appearance.themeMode === 'light') {
        effectiveTheme = 'light';
      } else {
        effectiveTheme = 'dark';
      }

      root.setAttribute('data-theme', effectiveTheme);
      if (effectiveTheme === 'dark') {
        root.classList.add('dark');
        root.classList.remove('light');
      } else {
        root.classList.add('light');
        root.classList.remove('dark');
      }

      // Apply Accent Color
      root.style.setProperty('--stuxs-accent', appearance.accentColor);
      const accentObj = BRAND_ACCENTS.find((a) => a.color === appearance.accentColor);
      root.style.setProperty(
        '--stuxs-accent-glow',
        accentObj ? accentObj.glow : 'rgba(139, 92, 246, 0.35)'
      );
    };

    applyTheme();
    localStorage.setItem('stuxs_appearance_settings', JSON.stringify(appearance));

    // Listen to system theme changes if in 'system' mode
    if (appearance.themeMode === 'system' && window.matchMedia) {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const listener = () => applyTheme();
      mediaQuery.addEventListener('change', listener);
      return () => mediaQuery.removeEventListener('change', listener);
    }
  }, [appearance]);

  useEffect(() => {
    localStorage.setItem('stuxs_playback_settings', JSON.stringify(playback));
  }, [playback]);

  const updatePlayback = useCallback((updates: Partial<PlaybackSettings>) => {
    setPlayback((prev) => ({ ...prev, ...updates }));
  }, []);

  const updateAppearance = useCallback((updates: Partial<AppearanceSettings>) => {
    setAppearance((prev) => ({ ...prev, ...updates }));
  }, []);

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setAppearance((prev) => ({ ...prev, themeMode: mode }));
  }, []);

  const setAccentColor = useCallback((colorHex: string) => {
    setAppearance((prev) => ({ ...prev, accentColor: colorHex }));
  }, []);

  const contextValue = useMemo(
    () => ({
      playback,
      appearance,
      updatePlayback,
      updateAppearance,
      setThemeMode,
      setAccentColor,
    }),
    [playback, appearance, updatePlayback, updateAppearance, setThemeMode, setAccentColor]
  );

  return (
    <SettingsContext.Provider value={contextValue}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
};
