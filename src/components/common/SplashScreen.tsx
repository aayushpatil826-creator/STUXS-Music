import React from 'react';
import { BRANDING_CONFIG } from '../../config/branding';

interface SplashScreenProps {
  isFadingOut?: boolean;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({ isFadingOut = false }) => {
  return (
    <div
      className={`fixed inset-0 z-50 min-h-screen w-full bg-[#0B0B0F] flex items-center justify-center select-none overflow-hidden transition-all duration-300 ease-out ${
        isFadingOut ? 'opacity-0 pointer-events-none scale-105' : 'opacity-100 scale-100'
      }`}
    >
      {/* Subtle black-to-deep-purple ambient radial glow */}
      <div className="absolute w-[500px] h-[500px] bg-purple-950/20 rounded-full blur-3xl pointer-events-none -top-20 -left-20" />
      <div className="absolute w-[500px] h-[500px] bg-violet-950/25 rounded-full blur-3xl pointer-events-none -bottom-20 -right-20" />

      {/* Perfectly Centered Official STUXS MUSIC Logo matching native splash scale */}
      <div className="relative z-10 flex items-center justify-center p-6 w-[150px] sm:w-[180px] transition-transform duration-300">
        <img
          src={BRANDING_CONFIG.appLogo}
          alt="STUXS Music"
          className="w-full h-auto object-contain rounded-2xl shadow-2xl"
          loading="eager"
        />
      </div>
    </div>
  );
};
