import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { isNativePlatform } from './platform';

/**
 * Triggers a subtle, light, crisp native haptic feedback on tab selection.
 * Fails completely silently and instantaneously without blocking UI execution.
 */
export function triggerLightHaptic(): void {
  try {
    if (isNativePlatform()) {
      Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
    } else if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      // Subtle web vibration fallback
      navigator.vibrate(8);
    }
  } catch {
    // Fail silently
  }
}