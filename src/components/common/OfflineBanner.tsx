import React, { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { networkStateService, type NetworkState } from '../../services/NetworkStateService';

interface OfflineBannerProps {
  className?: string;
}

export const OfflineBanner: React.FC<OfflineBannerProps> = ({ className = '' }) => {
  const [networkState, setNetworkState] = useState<NetworkState>(() =>
    networkStateService.getState()
  );

  useEffect(() => {
    return networkStateService.subscribe((state) => {
      setNetworkState(state);
    });
  }, []);

  if (networkState !== 'OFFLINE') {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center justify-center gap-2 px-3 py-1.5 bg-stuxs-surface-secondary/95 border border-stuxs-border/80 text-stuxs-text-secondary text-xs rounded-full shadow-sm backdrop-blur-md transition-all duration-300 pointer-events-none select-none ${className}`}
    >
      <WifiOff className="w-3.5 h-3.5 text-stuxs-accent animate-pulse" />
      <span className="font-medium tracking-tight">Offline — showing saved content</span>
    </div>
  );
};
