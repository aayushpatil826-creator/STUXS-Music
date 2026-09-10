import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Speaker, Smartphone, Headphones, Check, X, Info } from 'lucide-react';
import { usePlayer } from '../../context/PlayerContext';
import { backButtonManager } from '../../services/backButtonManager';

interface DetectedAudioDevice {
  id: string;
  name: string;
  type: string;
  icon: typeof Speaker;
}

export const DevicePickerModal: React.FC = () => {
  const { isDevicePickerOpen, setIsDevicePickerOpen, activeDevice, setActiveDevice } = usePlayer();
  const [realDevices, setRealDevices] = useState<DetectedAudioDevice[]>([]);
  const [active, setActive] = useState(false);
  const [dragY, setDragY] = useState(0);
  const touchStartY = useRef<number>(0);
  const isDragging = useRef<boolean>(false);

  const handleAnimatedClose = React.useCallback(() => {
    setActive(false);
    setTimeout(() => {
      setIsDevicePickerOpen(false);
      setDragY(0);
    }, 240);
  }, [setIsDevicePickerOpen]);

  useEffect(() => {
    if (isDevicePickerOpen) {
      setDragY(0);
      const timer = setTimeout(() => {
        setActive(true);
      }, 20);
      const unregister = backButtonManager.register('device-picker-modal', handleAnimatedClose, 25);
      return () => {
        clearTimeout(timer);
        unregister();
      };
    } else {
      setActive(false);
    }
  }, [isDevicePickerOpen, handleAnimatedClose]);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
    isDragging.current = true;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging.current) return;
    const currentY = e.touches[0].clientY;
    const deltaY = currentY - touchStartY.current;
    if (deltaY > 0) {
      setDragY(deltaY);
    }
  };

  const handleTouchEnd = () => {
    if (!isDragging.current) return;
    isDragging.current = false;
    if (dragY > 70) {
      handleAnimatedClose();
    } else {
      setDragY(0);
    }
  };

  useEffect(() => {
    if (!isDevicePickerOpen) return;

    const detectAudioOutputs = async () => {
      try {
        if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const outputs = devices.filter((d) => d.kind === 'audiooutput');

          if (outputs.length > 0 && outputs.some((d) => d.label)) {
            const mapped = outputs.map((d, index) => {
              const label = d.label || `Audio Output ${index + 1}`;
              const labelLower = label.toLowerCase();
              let icon = Speaker;
              let type = 'System Speaker';

              if (labelLower.includes('headphone') || labelLower.includes('headset') || labelLower.includes('airpods')) {
                icon = Headphones;
                type = 'Headphones / Headset';
              } else if (labelLower.includes('phone') || labelLower.includes('speakerphone')) {
                icon = Smartphone;
                type = 'Internal Speaker';
              } else if (labelLower.includes('bluetooth')) {
                icon = Headphones;
                type = 'Bluetooth Audio';
              }

              return {
                id: d.deviceId || `device-${index}`,
                name: label,
                type,
                icon,
              };
            });
            setRealDevices(mapped);
            return;
          }
        }
      } catch (err) {
        console.warn('[DevicePickerModal] Device enumeration failed:', err);
      }

      // Truthful default device representation
      setRealDevices([
        {
          id: 'default',
          name: 'Default System Output',
          type: 'Device Speakers / Connected Bluetooth',
          icon: Smartphone,
        },
      ]);
    };

    detectAudioOutputs();
  }, [isDevicePickerOpen]);

  if (!isDevicePickerOpen) return null;

  return createPortal(
    <>
      {/* Universal Scrim Backdrop matching LyricsSheet */}
      <div
        onClick={handleAnimatedClose}
        className={`fixed inset-0 z-[999] bg-black/50 transition-opacity duration-240 ${
          active ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden="true"
      />

      {/* Sheet Container with Universal Sheet Motion */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={`fixed inset-x-0 bottom-0 z-[1000] w-full max-w-sm mx-auto bg-stuxs-surface border-t sm:border border-stuxs-border rounded-t-[32px] sm:rounded-3xl p-6 shadow-2xl transition-transform will-change-transform select-none ${
          isDragging.current ? 'duration-0' : active ? 'duration-300' : 'duration-240'
        }`}
        style={{
          transform: active
            ? `translate3d(0, ${dragY}px, 0)`
            : 'translate3d(0, 100%, 0)',
          transitionTimingFunction: active ? 'cubic-bezier(0.16, 1, 0.3, 1)' : 'cubic-bezier(0.3, 0, 0.8, 0.15)',
          paddingBottom: 'max(env(safe-area-inset-bottom, 16px), var(--safe-area-inset-bottom, 16px), 16px)',
        }}
      >
        {/* Top Drag Handle */}
        <div
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          className="flex justify-center -mt-2 pb-3 cursor-grab active:cursor-grabbing flex-shrink-0"
        >
          <div className="w-10 h-1.5 rounded-full bg-stuxs-text-muted/30" />
        </div>

        <div className="flex items-center justify-between pb-4 border-b border-stuxs-border">
          <div className="flex items-center space-x-2">
            <Speaker className="w-5 h-5 text-stuxs-accent" />
            <h3 className="text-base font-bold text-stuxs-text">Audio Output</h3>
          </div>
          <button
            onClick={handleAnimatedClose}
            className="p-1 rounded-full text-stuxs-text-muted hover:text-stuxs-text active:scale-95 cursor-pointer"
            aria-label="Close output picker"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="py-3 space-y-2">
          {realDevices.map((device) => {
            const Icon = device.icon;
            const isSelected = activeDevice === device.name || (realDevices.length === 1 && activeDevice === 'Default System Output');
            return (
              <button
                key={device.id}
                onClick={() => {
                  setActiveDevice(device.name);
                  handleAnimatedClose();
                }}
                className={`w-full flex items-center justify-between p-3.5 rounded-2xl transition-colors text-left ${
                  isSelected
                    ? 'bg-stuxs-accent/15 border border-stuxs-accent/40'
                    : 'bg-stuxs-surface/50 hover:bg-stuxs-surface-hover border border-transparent'
                }`}
              >
                <div className="flex items-center space-x-3.5">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                      isSelected ? 'bg-stuxs-accent text-white' : 'bg-stuxs-surface-tertiary text-stuxs-text-secondary'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-stuxs-text">{device.name}</h4>
                    <p className="text-[11px] text-stuxs-text-secondary mt-0.5">{device.type}</p>
                  </div>
                </div>
                {isSelected && <Check className="w-5 h-5 text-stuxs-accent" />}
              </button>
            );
          })}
        </div>

        <div className="mt-2 pt-3 border-t border-stuxs-border flex items-start space-x-2 text-xs text-stuxs-text-muted">
          <Info className="w-4 h-4 text-stuxs-accent flex-shrink-0 mt-0.5" />
          <p className="text-[11px] leading-relaxed">
            Audio output routing is managed by your system OS (Bluetooth, Wired Headphones, or Device Speakers).
          </p>
        </div>
      </div>
    </>,
    document.body
  );
};
