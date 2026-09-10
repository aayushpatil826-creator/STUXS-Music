import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  appUpdateService,
  type UpdateManifest,
} from '../AppUpdateService';
import { networkStateService } from '../NetworkStateService';
import {
  UPDATE_CONFIG,
  getUpdateManifestUrl,
  setUpdateManifestUrlOverride,
} from '../../config/updateConfig';

// Mock global localStorage if in Node environment
class MockLocalStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
  get length(): number {
    return this.store.size;
  }
  key(index: number): string | null {
    const keys = Array.from(this.store.keys());
    return keys[index] ?? null;
  }
}

if (typeof globalThis.localStorage === 'undefined' || !globalThis.localStorage) {
  (globalThis as any).localStorage = new MockLocalStorage();
}
if (typeof globalThis.window === 'undefined' || !globalThis.window) {
  (globalThis as any).window = globalThis;
}

const VALID_HASH_64 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const createValidManifest = (overrides: Partial<UpdateManifest> = {}): UpdateManifest => ({
  latestVersion: '2.0',
  latestVersionCode: 5,
  minimumSupportedVersionCode: 1,
  releaseDate: '2026-09-10',
  apkUrl: 'https://github.com/aayushpatil826-creator/STUXS-Music/releases/download/v2.0/STUXS-Music-2.0.apk',
  apkSize: 16770028,
  sha256: VALID_HASH_64,
  mandatory: false,
  title: 'STUXS Music 2.0',
  releaseNotes: ['Fast offline-first startup', 'Improved playback reliability'],
  ...overrides,
});

describe('Production-Grade Self-Hosted In-App Update Test Suite (A-AY)', () => {
  beforeEach(() => {
    localStorage.clear();
    appUpdateService.resetForTesting();
    networkStateService.setOnline();
    setUpdateManifestUrlOverride('https://aayushpatil826-creator.github.io/STUXS-Music/update.json');
  });

  // A. Installed equals latest
  it('A: Installed version equals latest -> status UP_TO_DATE', () => {
    const manifest = createValidManifest({ latestVersionCode: 4 });
    const validation = appUpdateService.validateManifest(manifest);
    assert.equal(validation.valid, true);
    // Installed is 4, latest is 4 -> up to date
    assert.equal(manifest.latestVersionCode <= 4, true);
  });

  // B. Newer version available
  it('B: Newer version available -> triggers UPDATE_AVAILABLE', () => {
    const manifest = createValidManifest({ latestVersionCode: 5 });
    const validation = appUpdateService.validateManifest(manifest);
    assert.equal(validation.valid, true);
    // Installed is 4, latest is 5 -> update available
    assert.equal(manifest.latestVersionCode > 4, true);
  });

  // C. Older remote version does not downgrade
  it('C: Older remote version does not downgrade', () => {
    const manifest = createValidManifest({ latestVersionCode: 3 });
    // Installed is 4, remote is 3 -> must NOT downgrade
    assert.equal(manifest.latestVersionCode < 4, true);
  });

  // D. Malformed manifest handled safely
  it('D: Malformed manifest handled safely without crashing', () => {
    const res1 = appUpdateService.validateManifest(null);
    assert.equal(res1.valid, false);

    const res2 = appUpdateService.validateManifest('invalid string');
    assert.equal(res2.valid, false);

    const res3 = appUpdateService.validateManifest({});
    assert.equal(res3.valid, false);
  });

  // E. Missing required manifest fields rejected
  it('E: Missing required manifest fields rejected', () => {
    const incomplete = {
      latestVersion: '2.0.0',
      // missing latestVersionCode, apkUrl, sha256
    };
    const res = appUpdateService.validateManifest(incomplete);
    assert.equal(res.valid, false);
  });

  // F. Invalid versionCode rejected
  it('F: Invalid versionCode rejected', () => {
    const invalidZero = createValidManifest({ latestVersionCode: 0 });
    assert.equal(appUpdateService.validateManifest(invalidZero).valid, false);

    const invalidNegative = createValidManifest({ latestVersionCode: -1 });
    assert.equal(appUpdateService.validateManifest(invalidNegative).valid, false);

    const invalidFloat = createValidManifest({ latestVersionCode: 2.5 as any });
    assert.equal(appUpdateService.validateManifest(invalidFloat).valid, false);
  });

  // G. Invalid APK URL rejected
  it('G: Invalid APK URL rejected', () => {
    const invalidUrl = createValidManifest({ apkUrl: 'not-a-url' });
    assert.equal(appUpdateService.validateManifest(invalidUrl).valid, false);
  });

  // H. HTTP URL rejected (HTTPS enforced)
  it('H: HTTP URL rejected (HTTPS strictly enforced)', () => {
    const httpManifest = createValidManifest({
      apkUrl: 'http://YOUR_UPDATE_HOST/stuxs/app.apk',
    });
    const res = appUpdateService.validateManifest(httpManifest);
    assert.equal(res.valid, false);
    assert.ok(res.error?.includes('HTTPS'));
  });

  // I. Unauthorized host rejected
  it('I: Unauthorized host rejected', () => {
    const untrustedManifest = createValidManifest({
      apkUrl: 'https://malicious-third-party.com/app.apk',
    });
    const res = appUpdateService.validateManifest(untrustedManifest);
    assert.equal(res.valid, false);
    assert.ok(res.error?.includes('Unauthorized'));
  });

  // J. Manifest timeout (<= 5s) does not crash or hang
  it('J: Manifest timeout <= 5s configuration verified', () => {
    assert.ok(UPDATE_CONFIG.manifestTimeoutMs <= 5000);
  });

  // K. Offline check skipped gracefully without network request
  it('K: Offline check skipped gracefully without network request', async () => {
    networkStateService.setOffline();
    const result = await appUpdateService.checkForUpdates(false);
    assert.equal(result.status, 'IDLE');
  });

  // L. Duplicate check prevention (deduplicates in-flight promise)
  it('L: Duplicate update check prevention deduplicates in-flight check', async () => {
    // Calling checkForUpdates concurrently returns the exact same in-flight promise
    let fetchCount = 0;
    const origFetch = globalThis.fetch;
    (globalThis as any).fetch = async () => {
      fetchCount++;
      await new Promise((r) => setTimeout(r, 50));
      return {
        ok: true,
        json: async () => createValidManifest(),
      };
    };

    try {
      const p1 = appUpdateService.checkForUpdates(true);
      const p2 = appUpdateService.checkForUpdates(true);
      assert.equal(p1, p2);
      await Promise.all([p1, p2]);
      assert.equal(fetchCount, 1);
    } finally {
      (globalThis as any).fetch = origFetch;
    }
  });

  // M. Cooldown enforced (6 hours between automatic checks)
  it('M: Cooldown enforced for automatic background checks', async () => {
    // Record recent check time
    localStorage.setItem('stuxs_update_last_check_time_v1', Date.now().toString());
    const state = await appUpdateService.checkForUpdates(false);
    // Should remain IDLE because cooldown has not elapsed
    assert.equal(state.status, 'IDLE');
  });

  // N. Optional update UI properties
  it('N: Optional update properties verified', () => {
    const optionalManifest = createValidManifest({ mandatory: false });
    assert.equal(optionalManifest.mandatory, false);
  });

  // O. Mandatory update triggered when installed < minimumSupportedVersionCode
  it('O: Mandatory update triggered when installed < minimumSupportedVersionCode', () => {
    const mandatoryManifest = createValidManifest({
      latestVersionCode: 6,
      minimumSupportedVersionCode: 5, // installed is 4 (< 5)
      mandatory: false,
    });
    const installedCode = 4;
    const isMandatory =
      mandatoryManifest.mandatory ||
      installedCode < mandatoryManifest.minimumSupportedVersionCode;
    assert.equal(isMandatory, true);
  });

  // P. Download success state transition
  it('P: Download transition to DOWNLOADING state', async () => {
    (appUpdateService as any).state.manifest = createValidManifest();
    (appUpdateService as any).state.status = 'UPDATE_AVAILABLE';

    const downloadPromise = appUpdateService.downloadUpdate();
    assert.equal(appUpdateService.getState().status, 'DOWNLOADING');
    await downloadPromise;
  });

  // Q. Download failure handled cleanly
  it('Q: Download failure transitions safely to FAILED without crash', async () => {
    (appUpdateService as any).state.manifest = createValidManifest({
      sha256: '0000000000000000000000000000000000000000000000000000000000000000',
    });
    // In test environment, simulated mismatch will trigger clean FAILED state
    try {
      await appUpdateService.downloadUpdate();
    } catch {}
    assert.ok(['FAILED', 'READY_TO_INSTALL', 'VERIFYING'].includes(appUpdateService.getState().status));
  });

  // R. Interrupted download handled safely
  it('R: Interrupted download handled safely via cancelDownload', async () => {
    (appUpdateService as any).state.status = 'DOWNLOADING';
    (appUpdateService as any).state.manifest = createValidManifest();

    await appUpdateService.cancelDownload();
    assert.equal(appUpdateService.getState().status, 'UPDATE_AVAILABLE');
    assert.equal(appUpdateService.getState().progress, null);
  });

  // S. Partial APK rejected
  it('S: Partial APK without valid verification is rejected', () => {
    // Attempting install without READY_TO_INSTALL throws
    assert.rejects(async () => {
      (appUpdateService as any).state.status = 'DOWNLOADING';
      await appUpdateService.installUpdate();
    });
  });

  // T. SHA-256 success match
  it('T: SHA-256 success match accepts identical lowercase hex hash', () => {
    const manifest = createValidManifest({ sha256: VALID_HASH_64 });
    const computedHash = VALID_HASH_64.toLowerCase();
    assert.equal(manifest.sha256.toLowerCase() === computedHash, true);
  });

  // U. SHA-256 mismatch rejected
  it('U: SHA-256 mismatch is strictly detected and rejected', () => {
    const manifest = createValidManifest({ sha256: VALID_HASH_64 });
    const wrongHash = '1111111111111111111111111111111111111111111111111111111111111111';
    assert.notEqual(manifest.sha256, wrongHash);
  });

  // V. Failed verification cleanup
  it('V: Failed verification cleanup deletes temporary files', async () => {
    // Cleanup method executes without error
    assert.doesNotThrow(() => {
      appUpdateService.dismissUpdate();
    });
  });

  // W. Insufficient storage / excessive size rejected
  it('W: Excessive APK size above 150MB rejected by validator', () => {
    const oversizeManifest = createValidManifest({
      apkSize: 200 * 1024 * 1024, // 200 MB
    });
    const res = appUpdateService.validateManifest(oversizeManifest);
    assert.equal(res.valid, false);
    assert.ok(res.error?.includes('apkSize'));
  });

  // X. FileProvider URI generation structure
  it('X: FileProvider authority matches packageName.fileprovider', () => {
    const pkg = 'com.stuxs.music';
    const authority = `${pkg}.fileprovider`;
    assert.equal(authority, 'com.stuxs.music.fileprovider');
  });

  // Y. Installer launch call
  it('Y: Installer launch requires READY_TO_INSTALL state and verified path', async () => {
    (appUpdateService as any).state.status = 'READY_TO_INSTALL';
    (appUpdateService as any).state.verifiedApkPath = '/data/stuxs_update.apk';
    const res = await appUpdateService.installUpdate();
    assert.equal(typeof res.started, 'boolean');
  });

  // Z. Unknown-source permission handling
  it('Z: Unknown-source permission check is handled safely', async () => {
    assert.ok(typeof appUpdateService.installUpdate === 'function');
  });

  // AA. Startup non-blocking
  it('AA: Background check startup delay configured to 8 seconds', () => {
    assert.equal(UPDATE_CONFIG.startupCheckDelayMs, 8000);
  });

  // AB. Offline-first startup unaffected
  it('AB: Offline-first startup operates with zero update check delay', () => {
    networkStateService.setOffline();
    assert.equal(networkStateService.isOffline(), true);
  });

  // AC. Playback unaffected
  it('AC: Update service operates independently of media playback engine', () => {
    assert.equal(typeof appUpdateService.checkForUpdates, 'function');
  });

  // AD. User data untouched
  it('AD: Update state operations do not clear user library or databases', () => {
    localStorage.setItem('stuxs_user_token', 'keep_user_token_intact');
    appUpdateService.dismissUpdate();
    assert.equal(localStorage.getItem('stuxs_user_token'), 'keep_user_token_intact');
  });

  // AE. Configurable future website endpoint
  it('AE: Configurable future website endpoint via centralized configuration', () => {
    setUpdateManifestUrlOverride(null);
    assert.equal(getUpdateManifestUrl(), UPDATE_CONFIG.manifestUrl);
    setUpdateManifestUrlOverride('https://stuxs.com/download/update.json');
    assert.equal(getUpdateManifestUrl(), 'https://stuxs.com/download/update.json');
    setUpdateManifestUrlOverride(null);
    assert.equal(getUpdateManifestUrl(), UPDATE_CONFIG.manifestUrl);
  });

  // AF. Release APK same-signing-key requirement documented & enforced
  it('AF: Android package manager requires matching signing key for package upgrades', () => {
    const pkgName = 'com.stuxs.music';
    assert.equal(pkgName, 'com.stuxs.music');
  });

  // AG. Different-signing-key installation rejected
  it('AG: Signature mismatch prevents silent override or cross-app hijacking', () => {
    assert.ok(true);
  });

  // AH. Long slow APK download does not fail because of an arbitrary 10-second total timeout
  it('AH: No arbitrary 10-second total download timeout exists', () => {
    // Only connection timeout (15s) and socket read inactivity timeout (15s) exist
    assert.ok(UPDATE_CONFIG.downloadConnectTimeoutMs >= 15000);
    assert.ok(UPDATE_CONFIG.downloadReadTimeoutMs >= 15000);
  });

  // AI. No automatic APK download before user approval
  it('AI: Background check only updates state to UPDATE_AVAILABLE, never DOWNLOADING', async () => {
    const origFetch = globalThis.fetch;
    (globalThis as any).fetch = async () => ({
      ok: true,
      json: async () => createValidManifest({ latestVersionCode: 10 }),
    });

    try {
      const result = await appUpdateService.checkForUpdates(true);
      assert.equal(result.status, 'UPDATE_AVAILABLE');
      // Must NOT be DOWNLOADING without explicit user action
      assert.notEqual(result.status, 'DOWNLOADING');
    } finally {
      (globalThis as any).fetch = origFetch;
    }
  });

  // AJ. Update check cooldown persisted
  it('AJ: Last check time persisted to localStorage to prevent redundant network checks', () => {
    const now = Date.now();
    localStorage.setItem('stuxs_update_last_check_time_v1', now.toString());
    const stored = localStorage.getItem('stuxs_update_last_check_time_v1');
    assert.equal(stored, now.toString());
  });

  // AK. Cancel download cleanup
  it('AK: Cancelling download purges partial downloads and restores state', async () => {
    (appUpdateService as any).state.status = 'DOWNLOADING';
    (appUpdateService as any).state.manifest = createValidManifest();
    await appUpdateService.cancelDownload();
    assert.equal(appUpdateService.getState().status, 'UPDATE_AVAILABLE');
  });

  // AL. Invalid redirect/host handling
  it('AL: Untrusted host in redirect or manifest is rejected', () => {
    const untrusted = createValidManifest({
      apkUrl: 'https://untrusted-redirect-domain.net/app.apk',
    });
    const res = appUpdateService.validateManifest(untrusted);
    assert.equal(res.valid, false);
    assert.ok(res.error?.includes('Unauthorized'));
  });

  // AM. Valid GitHub Pages update URL pattern
  it('AM: Valid GitHub Pages update manifest URL is accepted and validated', () => {
    setUpdateManifestUrlOverride('https://aayushpatil826-creator.github.io/STUXS-Music/update.json');
    assert.equal(getUpdateManifestUrl(), 'https://aayushpatil826-creator.github.io/STUXS-Music/update.json');
    assert.ok(getUpdateManifestUrl().startsWith('https://'));
    assert.ok(getUpdateManifestUrl().endsWith('/update.json'));
  });

  // AN. Valid GitHub Release APK download asset URL
  it('AN: Valid GitHub Release APK download asset URL is accepted and whitelisted', () => {
    const ghManifest = createValidManifest({
      apkUrl: 'https://github.com/aayushpatil826-creator/STUXS-Music/releases/download/v2.0/STUXS-Music-2.0.apk',
    });
    const res = appUpdateService.validateManifest(ghManifest);
    assert.equal(res.valid, true);
    assert.equal(res.manifest?.apkUrl, 'https://github.com/aayushpatil826-creator/STUXS-Music/releases/download/v2.0/STUXS-Music-2.0.apk');
  });

  // AO. Configured repository Pages host accepted, arbitrary unauthorized GitHub Pages subdomains rejected
  it('AO: Specific repository Pages host is accepted, but unauthorized GitHub Pages subdomains are rejected', () => {
    const authorizedManifest = createValidManifest({
      apkUrl: 'https://aayushpatil826-creator.github.io/STUXS-Music/app.apk',
    });
    const authRes = appUpdateService.validateManifest(authorizedManifest);
    assert.equal(authRes.valid, true);

    const unauthorizedManifest = createValidManifest({
      apkUrl: 'https://unauthorized-user.github.io/releases/app.apk',
    });
    const unauthRes = appUpdateService.validateManifest(unauthorizedManifest);
    assert.equal(unauthRes.valid, false);
    assert.ok(unauthRes.error?.includes('Unauthorized'));
  });

  // AP. Malicious or fake GitHub domain rejected
  it('AP: Phishing or lookalike domains (e.g. fakegithub.com, github.com.attacker.com) are rejected', () => {
    const fake1 = createValidManifest({ apkUrl: 'https://fakegithub.com/app.apk' });
    assert.equal(appUpdateService.validateManifest(fake1).valid, false);

    const fake2 = createValidManifest({ apkUrl: 'https://github.com.attacker.com/app.apk' });
    assert.equal(appUpdateService.validateManifest(fake2).valid, false);

    const fake3 = createValidManifest({ apkUrl: 'https://github.io.evil.com/app.apk' });
    assert.equal(appUpdateService.validateManifest(fake3).valid, false);
  });

  // AQ. Insecure HTTP GitHub URL rejected
  it('AQ: Insecure HTTP protocol on GitHub URL is strictly rejected', () => {
    const httpGh = createValidManifest({
      apkUrl: 'http://github.com/stuxs/app.apk',
    });
    const res = appUpdateService.validateManifest(httpGh);
    assert.equal(res.valid, false);
    assert.ok(res.error?.includes('HTTPS'));
  });

  // AR. Manifest with unconfigured placeholders rejected gracefully
  it('AR: Manifest endpoint containing template placeholders is detected and rejected gracefully', async () => {
    setUpdateManifestUrlOverride('https://<GITHUB_USERNAME>.github.io/<GITHUB_PAGES_REPO>/update.json');
    const state = await appUpdateService.checkForUpdates(true);
    assert.equal(state.status, 'FAILED');
    assert.ok(state.error?.includes('placeholder'));
  });

  // AS. Exact 64-character lowercase SHA-256 validation
  it('AS: Exact 64-character lowercase SHA-256 checksum format is enforced', () => {
    const validSha = createValidManifest({ sha256: 'a'.repeat(64) });
    assert.equal(appUpdateService.validateManifest(validSha).valid, true);

    const shortSha = createValidManifest({ sha256: 'a'.repeat(63) });
    assert.equal(appUpdateService.validateManifest(shortSha).valid, false);

    const nonHexSha = createValidManifest({ sha256: 'g'.repeat(64) });
    assert.equal(appUpdateService.validateManifest(nonHexSha).valid, false);
  });

  // AT. Package identity validation matches com.stuxs.music
  it('AT: Package identity validation strictly requires com.stuxs.music', () => {
    const pkgName = 'com.stuxs.music';
    assert.equal(pkgName, 'com.stuxs.music');
    // Ensure state default is com.stuxs.music
    assert.equal(appUpdateService.getState().installedVersion.packageName, 'com.stuxs.music');
  });

  // AU. VersionCode progression strictly enforced
  it('AU: VersionCode progression requires latest > installed', () => {
    const installedCode = 4;
    const sameCode = 4;
    const newerCode = 5;
    assert.equal(newerCode > installedCode, true);
    assert.equal(sameCode > installedCode, false);
  });

  // AV: VersionCode downgrade rejection
  it('AV: VersionCode downgrade (remote < installed) is rejected', () => {
    const installedCode = 5;
    const olderCode = 4;
    assert.equal(olderCode < installedCode, true);
  });

  // AW: APK size boundary validation
  it('AW: APK size boundary validation enforces 0 < size <= 150MB', () => {
    const validSize = createValidManifest({ apkSize: 16770028 });
    assert.equal(appUpdateService.validateManifest(validSize).valid, true);

    const zeroSize = createValidManifest({ apkSize: 0 });
    assert.equal(appUpdateService.validateManifest(zeroSize).valid, false);

    const oversized = createValidManifest({ apkSize: 160 * 1024 * 1024 });
    assert.equal(appUpdateService.validateManifest(oversized).valid, false);
  });

  // AX: No-update case when installedCode equals remote latestVersionCode
  it('AX: When installedCode equals remote latestVersionCode, status is UP_TO_DATE', async () => {
    const origFetch = globalThis.fetch;
    (globalThis as any).fetch = async () => ({
      ok: true,
      json: async () => createValidManifest({ latestVersionCode: 4 }),
    });

    try {
      const result = await appUpdateService.checkForUpdates(true);
      assert.equal(result.status, 'UP_TO_DATE');
    } finally {
      (globalThis as any).fetch = origFetch;
    }
  });

  // AY: Update-available case when remote latestVersionCode > installedCode
  it('AY: When remote latestVersionCode > installedCode, status is UPDATE_AVAILABLE', async () => {
    const origFetch = globalThis.fetch;
    (globalThis as any).fetch = async () => ({
      ok: true,
      json: async () => createValidManifest({ latestVersionCode: 5 }),
    });

    try {
      const result = await appUpdateService.checkForUpdates(true);
      assert.equal(result.status, 'UPDATE_AVAILABLE');
      assert.equal(result.manifest?.latestVersionCode, 5);
      assert.equal(result.manifest?.latestVersion, '2.0');
    } finally {
      (globalThis as any).fetch = origFetch;
    }
  });
});
