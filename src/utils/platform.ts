import { Capacitor } from '@capacitor/core';

/**
 * Returns true if running inside a native mobile container (Capacitor Android / iOS).
 */
export const isNativePlatform = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    return Capacitor.isNativePlatform() || Capacitor.getPlatform() === 'android' || Capacitor.getPlatform() === 'ios';
  } catch {
    return false;
  }
};

/**
 * Returns true if running in local web browser development (Vite dev server).
 */
export const isDevEnvironment = (): boolean => {
  if (typeof window === 'undefined') return false;
  if (isNativePlatform()) return false;
  return (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.port === '5173' ||
    window.location.protocol === 'http:'
  );
};
