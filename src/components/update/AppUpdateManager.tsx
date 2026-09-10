import React, { useEffect, useState } from 'react';
import {
  appUpdateService,
  type AppUpdateState,
} from '../../services/AppUpdateService';
import { UpdateBottomSheet } from './UpdateBottomSheet';
import { UPDATE_CONFIG } from '../../config/updateConfig';

export const AppUpdateManager: React.FC = () => {
  const [updateState, setUpdateState] = useState<AppUpdateState>(() =>
    appUpdateService.getState()
  );

  useEffect(() => {
    // 1. Subscribe to update service state changes
    const unsubscribe = appUpdateService.subscribe((state) => {
      setUpdateState(state);
    });

    // 2. Delayed background check after app startup
    // Never blocks initial UI render, splash dismiss, or user interaction
    const startupTimer = setTimeout(() => {
      appUpdateService.checkForUpdates(false).catch((err) => {
        console.debug('[AppUpdateManager] Background check skipped/failed:', err?.message || err);
      });
    }, UPDATE_CONFIG.startupCheckDelayMs);

    // 3. Resume / Foreground check (cooldown enforced internally)
    const handleResume = () => {
      if (document.visibilityState === 'visible') {
        appUpdateService.checkForUpdates(false).catch(() => {});
      }
    };

    document.addEventListener('visibilitychange', handleResume);

    return () => {
      clearTimeout(startupTimer);
      document.removeEventListener('visibilitychange', handleResume);
      unsubscribe();
    };
  }, []);

  const shouldShowSheet =
    updateState.status === 'UPDATE_AVAILABLE' ||
    updateState.status === 'DOWNLOADING' ||
    updateState.status === 'VERIFYING' ||
    updateState.status === 'READY_TO_INSTALL' ||
    updateState.status === 'INSTALLING';

  if (!shouldShowSheet || !updateState.manifest) {
    return null;
  }

  return (
    <UpdateBottomSheet
      updateState={updateState}
      onClose={() => appUpdateService.dismissUpdate()}
    />
  );
};
