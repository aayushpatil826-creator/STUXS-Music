import { isNativePlatform } from '../utils/platform';
import {
  getNativePlaybackDiagnostics,
  openNativeBatteryOptimizationSettings,
  openNativeNotificationSettings,
  type NativePlaybackDiagnostics,
} from '../utils/nativeMediaSession';

export type OEMType =
  | 'vivo-iqoo'
  | 'oppo-oneplus-realme'
  | 'xiaomi-hyperos'
  | 'samsung-oneui'
  | 'nothing-os'
  | 'pixel-standard'
  | 'generic-android'
  | 'web';

export interface OEMCapabilityInfo {
  oemType: OEMType;
  displayName: string;
  capsuleFeatureName: string;
  isCapsuleSupported: boolean;
  notes: string;
  recommendedSettingsHint: string;
}

class LiveActivityManagerService {
  public detectOEM(manufacturer: string = ''): OEMCapabilityInfo {
    if (!isNativePlatform()) {
      return {
        oemType: 'web',
        displayName: 'Web Browser',
        capsuleFeatureName: 'Standard Web MediaSession',
        isCapsuleSupported: false,
        notes: 'Desktop/Browser MediaSession active in OS media panel',
        recommendedSettingsHint: '',
      };
    }

    const mfr = manufacturer.toLowerCase();

    if (mfr.includes('vivo') || mfr.includes('iqoo')) {
      return {
        oemType: 'vivo-iqoo',
        displayName: 'vivo / iQOO (OriginOS / Funtouch OS)',
        capsuleFeatureName: 'Super Island / Live Capsule',
        isCapsuleSupported: true,
        notes: 'Requires active MediaSessionCompat, MediaStyle notification, and background execution permission.',
        recommendedSettingsHint: 'Enable "Status bar live alerts / Capsule" in Settings > Notifications, and allow background activity.',
      };
    }

    if (mfr.includes('oppo') || mfr.includes('oneplus') || mfr.includes('realme')) {
      return {
        oemType: 'oppo-oneplus-realme',
        displayName: 'OPPO / OnePlus / realme (ColorOS / OxygenOS)',
        capsuleFeatureName: 'Fluid Cloud / Live Alert',
        isCapsuleSupported: true,
        notes: 'Driven by Android MediaSessionCompat and active MediaStyle foreground notification.',
        recommendedSettingsHint: 'Enable "Fluid Cloud" in Settings > Notifications & Status bar.',
      };
    }

    if (mfr.includes('xiaomi') || mfr.includes('redmi') || mfr.includes('poco')) {
      return {
        oemType: 'xiaomi-hyperos',
        displayName: 'Xiaomi / Redmi / POCO (HyperOS / MIUI)',
        capsuleFeatureName: 'Focus Notification / Dynamic Island',
        isCapsuleSupported: true,
        notes: 'Driven by SystemUI MediaDataManager and MediaSessionCompat.',
        recommendedSettingsHint: 'Set Battery Saver to "No restrictions" and enable Lock screen notifications.',
      };
    }

    if (mfr.includes('samsung')) {
      return {
        oemType: 'samsung-oneui',
        displayName: 'Samsung (One UI)',
        capsuleFeatureName: 'Live Notification / Lock Screen Widget',
        isCapsuleSupported: true,
        notes: 'Standard Android MediaSession and NotificationCompat.MediaStyle support.',
        recommendedSettingsHint: 'Ensure Music widget is enabled on Lock Screen.',
      };
    }

    if (mfr.includes('nothing')) {
      return {
        oemType: 'nothing-os',
        displayName: 'Nothing OS',
        capsuleFeatureName: 'Glyph / Status Bar Media Indicator',
        isCapsuleSupported: true,
        notes: 'Vanilla Android 13+ SystemUI Media Player support.',
        recommendedSettingsHint: 'No special permissions required.',
      };
    }

    return {
      oemType: 'generic-android',
      displayName: manufacturer ? `${manufacturer.toUpperCase()} Android` : 'Android Device',
      capsuleFeatureName: 'Android System Media Player',
      isCapsuleSupported: true,
      notes: 'Standard Android 11+ SystemUI Media Control Panel.',
      recommendedSettingsHint: 'Ensure Notifications are permitted for STUXS Music.',
    };
  }

  public async getDiagnostics(): Promise<NativePlaybackDiagnostics | null> {
    return await getNativePlaybackDiagnostics();
  }

  public async openBatterySettings(): Promise<void> {
    await openNativeBatteryOptimizationSettings();
  }

  public async openNotificationSettings(): Promise<void> {
    await openNativeNotificationSettings();
  }
}

export const liveActivityManager = new LiveActivityManagerService();
