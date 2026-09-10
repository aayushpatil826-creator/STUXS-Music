/**
 * Centralized Update Configuration for STUXS Music.
 *
 * All update endpoints, timeouts, and security policies are defined here.
 * When the official STUXS website is launched, update `DEFAULT_UPDATE_MANIFEST_URL`
 * or configure it dynamically without altering the update engine.
 */

export interface UpdateConfig {
  manifestUrl: string;
  allowedHosts: string[];
  manifestTimeoutMs: number;
  downloadConnectTimeoutMs: number;
  downloadReadTimeoutMs: number;
  maxApkSizeBytes: number;
  backgroundCheckCooldownMs: number;
  startupCheckDelayMs: number;
}

export const DEFAULT_UPDATE_MANIFEST_URL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_UPDATE_MANIFEST_URL) ||
  'https://aayushpatil826-creator.github.io/STUXS-Music/update.json';

const STORAGE_OVERRIDE_KEY = 'stuxs_update_manifest_url_override';

export const UPDATE_CONFIG: UpdateConfig = {
  manifestUrl: DEFAULT_UPDATE_MANIFEST_URL,
  allowedHosts: [
    'aayushpatil826-creator.github.io',
    'github.com',
    'YOUR_UPDATE_HOST', // Retained for backwards compatibility with test fixtures
  ],
  manifestTimeoutMs: 5000,          // Bounded <= 5s timeout for manifest fetch
  downloadConnectTimeoutMs: 15000,  // Connection establishment timeout
  downloadReadTimeoutMs: 15000,     // Inactivity read timeout (no arbitrary total limit)
  maxApkSizeBytes: 150 * 1024 * 1024, // 150 MB safety bound
  backgroundCheckCooldownMs: 6 * 60 * 60 * 1000, // 6 hours cooldown
  startupCheckDelayMs: 8000,        // 8 seconds post-startup delay (never blocks startup)
};

/**
 * Returns the active update manifest URL, respecting safe runtime or developer overrides.
 */
export function getUpdateManifestUrl(): string {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const override = window.localStorage.getItem(STORAGE_OVERRIDE_KEY);
      if (override && override.startsWith('https://')) {
        return override;
      }
    } catch {}
  }
  return UPDATE_CONFIG.manifestUrl;
}

/**
 * Set an override manifest URL (useful for testing or future website redirection).
 */
export function setUpdateManifestUrlOverride(url: string | null): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      if (url) {
        window.localStorage.setItem(STORAGE_OVERRIDE_KEY, url);
      } else {
        window.localStorage.removeItem(STORAGE_OVERRIDE_KEY);
      }
    } catch {}
  }
}
