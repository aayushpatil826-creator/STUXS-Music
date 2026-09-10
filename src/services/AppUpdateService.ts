/**
 * AppUpdateService — Production-Grade Self-Hosted In-App Update Engine for STUXS Music.
 *
 * Responsibilities:
 * - Centralized HTTPS update manifest fetch with strict <= 5s timeout.
 * - Rigorous manifest validation (schema, HTTPS, trusted hosts, SHA-256 hex, APK size bounds).
 * - VersionCode comparison (never downgrades).
 * - Non-blocking background checks with 6-hour cooldown.
 * - Integration with Offline-First architecture (skips checks when offline).
 * - User-initiated APK download (NEVER auto-downloads in the background).
 * - On-the-fly streaming SHA-256 verification and Android FileProvider installation.
 * - Automatic cleanup of corrupted, mismatched, or cancelled downloads.
 */

import { registerPlugin } from '@capacitor/core';
import { networkStateService } from './NetworkStateService';
import {
  UPDATE_CONFIG,
  getUpdateManifestUrl,
  type UpdateConfig,
} from '../config/updateConfig';

export type AppUpdateStatus =
  | 'IDLE'
  | 'CHECKING'
  | 'UP_TO_DATE'
  | 'UPDATE_AVAILABLE'
  | 'DOWNLOADING'
  | 'VERIFYING'
  | 'READY_TO_INSTALL'
  | 'INSTALLING'
  | 'FAILED';

export interface UpdateManifest {
  latestVersion: string;
  latestVersionCode: number;
  minimumSupportedVersionCode: number;
  releaseDate: string;
  apkUrl: string;
  apkSize: number;
  sha256: string;
  mandatory: boolean;
  title: string;
  releaseNotes: string[];
}

export interface AppVersionInfo {
  versionName: string;
  versionCode: number;
  packageName: string;
}

export interface DownloadProgress {
  percent: number;
  bytesDownloaded: number;
  totalBytes: number;
}

export interface AppUpdateState {
  status: AppUpdateStatus;
  installedVersion: AppVersionInfo;
  manifest: UpdateManifest | null;
  isMandatory: boolean;
  progress: DownloadProgress | null;
  error: string | null;
  verifiedApkPath: string | null;
  lastCheckTimestamp: number | null;
}

export type UpdateStateListener = (state: AppUpdateState) => void;

interface StuxsAppUpdatePluginInterface {
  getAppVersionInfo(): Promise<AppVersionInfo>;
  checkInstallPermission(): Promise<{ canInstall: boolean }>;
  openInstallPermissionSettings(): Promise<{ opened: boolean }>;
  downloadApk(options: { apkUrl: string; sha256: string; apkSize?: number }): Promise<{
    success: boolean;
    filePath: string;
    sha256: string;
    sizeBytes: number;
  }>;
  cancelDownload(): Promise<{ cancelled: boolean }>;
  installApk(options?: { filePath?: string; sha256?: string }): Promise<{ started: boolean; uri?: string }>;
  cleanupApk(): Promise<{ cleaned: boolean }>;
  addListener(
    eventName: 'downloadProgress',
    listenerFunc: (progress: DownloadProgress) => void
  ): Promise<{ remove: () => void }>;
}

const StuxsAppUpdate = registerPlugin<StuxsAppUpdatePluginInterface>('StuxsAppUpdate', {
  web: {
    async getAppVersionInfo() {
      return { versionName: '2.0', versionCode: 4, packageName: 'com.stuxs.music' };
    },
    async checkInstallPermission() {
      return { canInstall: true };
    },
    async openInstallPermissionSettings() {
      return { opened: false };
    },
    async downloadApk() {
      return { success: true, filePath: '/virtual/cache/stuxs_update.apk', sha256: '', sizeBytes: 1000 };
    },
    async cancelDownload() {
      return { cancelled: true };
    },
    async installApk() {
      return { started: true };
    },
    async cleanupApk() {
      return { cleaned: true };
    },
    async addListener() {
      return { remove: () => {} };
    },
  },
});

const LAST_CHECK_STORAGE_KEY = 'stuxs_update_last_check_time_v1';
const DISMISSED_VERSION_STORAGE_KEY = 'stuxs_update_dismissed_version_v1';

export class AppUpdateService {
  private static instance: AppUpdateService;
  private listeners = new Set<UpdateStateListener>();
  private inFlightCheck: Promise<AppUpdateState> | null = null;
  private config: UpdateConfig = { ...UPDATE_CONFIG };
  private state: AppUpdateState = {
    status: 'IDLE',
    installedVersion: {
      versionName: '2.0',
      versionCode: 4,
      packageName: 'com.stuxs.music',
    },
    manifest: null,
    isMandatory: false,
    progress: null,
    error: null,
    verifiedApkPath: null,
    lastCheckTimestamp: null,
  };

  public static getInstance(): AppUpdateService {
    if (!AppUpdateService.instance) {
      AppUpdateService.instance = new AppUpdateService();
    }
    return AppUpdateService.instance;
  }

  private constructor() {
    this.hydrateInitialState();
  }

  private async hydrateInitialState() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const lastCheck = window.localStorage.getItem(LAST_CHECK_STORAGE_KEY);
        if (lastCheck) {
          this.state.lastCheckTimestamp = parseInt(lastCheck, 10) || null;
        }
      }

      // Fetch authoritative installed version from native package manager
      const versionInfo = await StuxsAppUpdate.getAppVersionInfo().catch(() => null);
      if (versionInfo && versionInfo.versionCode > 0) {
        this.state.installedVersion = versionInfo;
      }
    } catch {
      // Fallback defaults preserved
    }
  }

  public getState(): AppUpdateState {
    return { ...this.state };
  }

  public subscribe(listener: UpdateStateListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private updateState(partial: Partial<AppUpdateState>) {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) {
      try {
        listener(this.getState());
      } catch (err) {
        console.warn('[AppUpdateService] Error in listener callback:', err);
      }
    }
  }

  /**
   * Set custom configuration (used for tests or dynamic runtime adjustments).
   */
  public setConfig(customConfig: Partial<UpdateConfig>) {
    this.config = { ...this.config, ...customConfig };
  }

  /**
   * Reset configuration to defaults.
   */
  public resetConfig() {
    this.config = { ...UPDATE_CONFIG };
  }

  /**
   * Validates raw manifest JSON against security rules and schema.
   */
  public validateManifest(raw: any): { valid: boolean; error?: string; manifest?: UpdateManifest } {
    if (!raw || typeof raw !== 'object') {
      return { valid: false, error: 'Manifest must be a non-null JSON object' };
    }

    const {
      latestVersion,
      latestVersionCode,
      minimumSupportedVersionCode,
      releaseDate,
      apkUrl,
      apkSize,
      sha256,
      mandatory,
      title,
      releaseNotes,
    } = raw;

    // 1. Version string validation
    if (typeof latestVersion !== 'string' || !latestVersion.trim()) {
      return { valid: false, error: 'latestVersion must be a non-empty string' };
    }

    // 2. VersionCode validation (must be positive integer)
    if (
      typeof latestVersionCode !== 'number' ||
      !Number.isInteger(latestVersionCode) ||
      latestVersionCode <= 0
    ) {
      return { valid: false, error: 'latestVersionCode must be a positive integer' };
    }

    const minCode =
      typeof minimumSupportedVersionCode === 'number' && Number.isInteger(minimumSupportedVersionCode)
        ? minimumSupportedVersionCode
        : 1;

    // 3. APK URL validation (HTTPS ONLY, no HTTP or file://)
    if (typeof apkUrl !== 'string' || !apkUrl.startsWith('https://')) {
      return { valid: false, error: 'apkUrl must use secure HTTPS protocol' };
    }

    try {
      const parsedUrl = new URL(apkUrl);
      if (parsedUrl.protocol !== 'https:') {
        return { valid: false, error: 'apkUrl protocol must be https:' };
      }

      // 4. Host validation against trusted update hosts
      const host = parsedUrl.hostname.toLowerCase();
      const isAllowedHost = this.config.allowedHosts.some(
        (allowed) => host === allowed.toLowerCase() || host.endsWith('.' + allowed.toLowerCase())
      );
      if (!isAllowedHost) {
        return { valid: false, error: `Unauthorized update APK host: ${host}` };
      }
    } catch {
      return { valid: false, error: 'apkUrl is a malformed URL' };
    }

    // 5. APK size bounds (0 < size <= 150MB)
    if (
      typeof apkSize !== 'number' ||
      apkSize <= 0 ||
      apkSize > this.config.maxApkSizeBytes
    ) {
      return {
        valid: false,
        error: `apkSize must be a positive number under ${this.config.maxApkSizeBytes / (1024 * 1024)}MB`,
      };
    }

    // 6. SHA-256 validation (exact 64-character lowercase hex string)
    if (
      typeof sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(sha256.trim())
    ) {
      return { valid: false, error: 'sha256 must be a 64-character hexadecimal checksum' };
    }

    // 7. Sanitized releaseNotes array
    const cleanNotes = Array.isArray(releaseNotes)
      ? releaseNotes
          .filter((n) => typeof n === 'string' && n.trim().length > 0)
          .slice(0, 15)
          .map((n) => n.trim().slice(0, 200))
      : [];

    const validated: UpdateManifest = {
      latestVersion: latestVersion.trim(),
      latestVersionCode,
      minimumSupportedVersionCode: minCode,
      releaseDate: typeof releaseDate === 'string' ? releaseDate : new Date().toISOString().split('T')[0],
      apkUrl: apkUrl.trim(),
      apkSize,
      sha256: sha256.trim().toLowerCase(),
      mandatory: Boolean(mandatory),
      title: typeof title === 'string' && title.trim() ? title.trim() : `STUXS Music ${latestVersion}`,
      releaseNotes: cleanNotes,
    };

    return { valid: true, manifest: validated };
  }

  private getLastCheckTimestampFromStorage(): number | null {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const raw = window.localStorage.getItem(LAST_CHECK_STORAGE_KEY);
        if (raw) return parseInt(raw, 10) || null;
      } catch {}
    }
    return null;
  }

  /**
   * Check for updates from the remote HTTPS manifest.
   *
   * @param force If true (e.g. manual Settings click), bypasses the 6-hour cooldown.
   */
  public checkForUpdates(force = false): Promise<AppUpdateState> {
    // 1. If an update check is already in progress, deduplicate by returning existing promise
    if (this.inFlightCheck) {
      return this.inFlightCheck;
    }

    // 2. Offline check — Respect Offline-First architecture
    if (networkStateService.isOffline()) {
      if (force) {
        this.updateState({
          status: 'FAILED',
          error: 'Offline — check your internet connection and try again',
        });
      }
      return Promise.resolve(this.getState());
    }

    // 3. Enforce 6-hour background check cooldown unless manually forced
    const now = Date.now();
    const lastCheck = this.state.lastCheckTimestamp || this.getLastCheckTimestampFromStorage();
    if (!force && lastCheck) {
      const elapsed = now - lastCheck;
      if (elapsed < this.config.backgroundCheckCooldownMs) {
        return Promise.resolve(this.getState());
      }
    }

    this.updateState({ status: 'CHECKING', error: null });

    this.inFlightCheck = this.executeCheckInternal(now, force)
      .finally(() => {
        this.inFlightCheck = null;
      });

    return this.inFlightCheck;
  }

  private async executeCheckInternal(timestamp: number, force: boolean): Promise<AppUpdateState> {
    const manifestUrl = getUpdateManifestUrl();

    // 1. Verify manifest URL protocol (HTTPS strictly required)
    if (!manifestUrl.startsWith('https://')) {
      this.updateState({
        status: 'FAILED',
        error: 'Update manifest endpoint must use secure HTTPS protocol',
      });
      return this.getState();
    }

    // 2. Reject unconfigured template placeholders gracefully
    if (manifestUrl.includes('<') || manifestUrl.includes('>')) {
      this.updateState({
        status: 'FAILED',
        error: 'Update manifest endpoint is not configured (contains placeholders)',
      });
      return this.getState();
    }

    // 3. Validate manifest host against allowedHosts
    try {
      const parsedManifestUrl = new URL(manifestUrl);
      const manifestHost = parsedManifestUrl.hostname.toLowerCase();
      const isAllowedHost = this.config.allowedHosts.some(
        (allowed) => manifestHost === allowed.toLowerCase() || manifestHost.endsWith('.' + allowed.toLowerCase())
      );
      if (!isAllowedHost) {
        this.updateState({
          status: 'FAILED',
          error: `Unauthorized update manifest host: ${manifestHost}`,
        });
        return this.getState();
      }
    } catch {
      this.updateState({
        status: 'FAILED',
        error: 'Update manifest URL is malformed',
      });
      return this.getState();
    }

    // Bounded <= 5-second fetch timeout using AbortController
    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => {
      controller.abort();
    }, this.config.manifestTimeoutMs);

    try {
      const res = await fetch(manifestUrl, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'Cache-Control': 'no-cache',
        },
      });

      clearTimeout(timeoutTimer);

      if (!res.ok) {
        throw new Error(`Server returned HTTP ${res.status}`);
      }

      const rawJson = await res.json();
      const validation = this.validateManifest(rawJson);

      if (!validation.valid || !validation.manifest) {
        throw new Error(validation.error || 'Invalid update manifest schema');
      }

      const manifest = validation.manifest;

      // Update last checked timestamp in memory and localStorage
      this.state.lastCheckTimestamp = timestamp;
      if (typeof window !== 'undefined' && window.localStorage) {
        try {
          window.localStorage.setItem(LAST_CHECK_STORAGE_KEY, timestamp.toString());
        } catch {}
      }

      // Refresh installed version information from native package
      const versionInfo = await StuxsAppUpdate.getAppVersionInfo().catch(() => this.state.installedVersion);
      if (versionInfo && versionInfo.versionCode > 0) {
        this.state.installedVersion = versionInfo;
      }

      const installedCode = this.state.installedVersion.versionCode;
      const latestCode = manifest.latestVersionCode;

      // Check whether installed version was explicitly dismissed by user (for optional updates)
      let isDismissed = false;
      if (!force && typeof window !== 'undefined' && window.localStorage) {
        try {
          const dismissed = window.localStorage.getItem(DISMISSED_VERSION_STORAGE_KEY);
          if (dismissed === manifest.latestVersion) {
            isDismissed = true;
          }
        } catch {}
      }

      // VersionCode Comparison:
      // - latestCode > installedCode: Update available
      // - latestCode <= installedCode: Up to date (DO NOT DOWNGRADE)
      if (latestCode > installedCode) {
        const isMandatory =
          manifest.mandatory || installedCode < manifest.minimumSupportedVersionCode;

        if (isDismissed && !isMandatory && !force) {
          this.updateState({
            status: 'IDLE',
            manifest,
            isMandatory: false,
            error: null,
          });
          return this.getState();
        }

        this.updateState({
          status: 'UPDATE_AVAILABLE',
          manifest,
          isMandatory,
          error: null,
        });
        return this.getState();
      } else {
        this.updateState({
          status: 'UP_TO_DATE',
          manifest,
          isMandatory: false,
          error: null,
        });
        return this.getState();
      }
    } catch (err: any) {
      clearTimeout(timeoutTimer);
      const isTimeout = err?.name === 'AbortError' || err?.message?.includes('aborted');
      const errMsg = isTimeout
        ? 'Update check timed out (server unreachable)'
        : (err?.message || 'Failed to check for updates');

      // Keep previous valid state if background check failed
      this.updateState({
        status: force ? 'FAILED' : (this.state.status === 'UPDATE_AVAILABLE' ? 'UPDATE_AVAILABLE' : 'IDLE'),
        error: force ? errMsg : null,
      });

      return this.getState();
    }
  }

  /**
   * User explicitly initiates APK download.
   * NEVER runs automatically in the background.
   */
  public async downloadUpdate(): Promise<void> {
    if (!this.state.manifest) {
      throw new Error('No update manifest available to download');
    }
    if (this.state.status === 'DOWNLOADING') {
      return;
    }

    this.updateState({
      status: 'DOWNLOADING',
      progress: { percent: 0, bytesDownloaded: 0, totalBytes: this.state.manifest.apkSize },
      error: null,
    });

    let progressSub: { remove: () => void } | null = null;

    try {
      progressSub = await StuxsAppUpdate.addListener('downloadProgress', (prog: DownloadProgress) => {
        this.updateState({
          status: 'DOWNLOADING',
          progress: prog,
        });
      });

      this.updateState({ status: 'DOWNLOADING' });

      const downloadResult = await StuxsAppUpdate.downloadApk({
        apkUrl: this.state.manifest.apkUrl,
        sha256: this.state.manifest.sha256,
        apkSize: this.state.manifest.apkSize,
      });

      this.updateState({ status: 'VERIFYING' });

      // Verify returned SHA-256 against manifest checksum
      if (
        !downloadResult.sha256 ||
        downloadResult.sha256.toLowerCase() !== this.state.manifest.sha256.toLowerCase()
      ) {
        await StuxsAppUpdate.cleanupApk().catch(() => {});
        throw new Error('Downloaded APK SHA-256 checksum mismatch!');
      }

      this.updateState({
        status: 'READY_TO_INSTALL',
        verifiedApkPath: downloadResult.filePath,
        error: null,
      });
    } catch (err: any) {
      await StuxsAppUpdate.cleanupApk().catch(() => {});
      this.updateState({
        status: 'FAILED',
        error: err?.message || 'APK download or checksum verification failed',
      });
    } finally {
      if (progressSub) {
        progressSub.remove();
      }
    }
  }

  /**
   * Cancel an ongoing APK download.
   */
  public async cancelDownload(): Promise<void> {
    if (this.state.status !== 'DOWNLOADING') return;

    try {
      await StuxsAppUpdate.cancelDownload();
      await StuxsAppUpdate.cleanupApk();
    } catch {}

    this.updateState({
      status: this.state.manifest ? 'UPDATE_AVAILABLE' : 'IDLE',
      progress: null,
      error: null,
    });
  }

  /**
   * Requests Android PackageInstaller to install the verified APK.
   */
  public async installUpdate(): Promise<{ started: boolean; requiresPermission?: boolean }> {
    if (this.state.status !== 'READY_TO_INSTALL' || !this.state.verifiedApkPath) {
      throw new Error('No verified APK is ready to install');
    }

    // 1. Check unknown app install permission
    const permission = await StuxsAppUpdate.checkInstallPermission().catch(() => ({ canInstall: true }));
    if (!permission.canInstall) {
      await StuxsAppUpdate.openInstallPermissionSettings().catch(() => {});
      return { started: false, requiresPermission: true };
    }

    // 2. Launch Android PackageInstaller via FileProvider
    this.updateState({ status: 'INSTALLING' });
    try {
      const res = await StuxsAppUpdate.installApk({
        filePath: this.state.verifiedApkPath,
        sha256: this.state.manifest?.sha256,
      });
      return { started: res.started };
    } catch (err: any) {
      this.updateState({
        status: 'READY_TO_INSTALL',
        error: 'Failed to launch installer: ' + (err?.message || err),
      });
      return { started: false };
    }
  }

  /**
   * Dismiss the update sheet for non-mandatory updates.
   */
  public dismissUpdate(): void {
    if (this.state.isMandatory) {
      return; // Mandatory update cannot be dismissed
    }

    if (this.state.manifest && typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(DISMISSED_VERSION_STORAGE_KEY, this.state.manifest.latestVersion);
      } catch {}
    }

    this.updateState({
      status: 'IDLE',
    });
  }

  /**
   * Reset update service state (useful for tests).
   */
  public resetForTesting(): void {
    this.state = {
      status: 'IDLE',
      installedVersion: {
        versionName: '2.0',
        versionCode: 4,
        packageName: 'com.stuxs.music',
      },
      manifest: null,
      isMandatory: false,
      progress: null,
      error: null,
      verifiedApkPath: null,
      lastCheckTimestamp: null,
    };
    this.inFlightCheck = null;
    this.resetConfig();
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.removeItem(LAST_CHECK_STORAGE_KEY);
        window.localStorage.removeItem(DISMISSED_VERSION_STORAGE_KEY);
      } catch {}
    }
  }
}

export const appUpdateService = AppUpdateService.getInstance();
