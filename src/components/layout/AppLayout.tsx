import React from "react";
import { BottomNav } from "./BottomNav";
import type { TabType } from "./BottomNav";
import { MiniPlayer } from "../player/MiniPlayer";
import { NowPlayingModal } from "../player/NowPlayingModal";
import { usePlayer } from "../../context/PlayerContext";
import { useKeyboardVisible } from "../../utils/useKeyboardVisible";

interface AppLayoutProps {
  children: React.ReactNode;
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  onSelectArtist?: (artistId: string) => void;
  onSelectAlbum?: (albumId?: string) => void;
}

export const AppLayout: React.FC<AppLayoutProps> = ({
  children,
  activeTab,
  onTabChange,
  onSelectArtist,
  onSelectAlbum,
}) => {
  const { currentTrack } = usePlayer();
  const { isKeyboardVisible } = useKeyboardVisible();

  return (
    <div className="min-h-screen bg-stuxs-bg text-stuxs-text flex flex-col justify-between selection:bg-stuxs-accent selection:text-white font-sans antialiased">
      {/* Main Content Area */}
      <main
        className={`flex-1 w-full max-w-md mx-auto animate-app-launch ${currentTrack ? "pb-36" : "pb-20"}`}
      >
        {children}
      </main>

      {/* Floating MiniPlayer + Bottom Navigation Container — Slides off-screen when keyboard is open */}
      <div
        className="fixed bottom-0 left-0 right-0 z-40 max-w-md mx-auto pointer-events-none"
        style={{
          transform: isKeyboardVisible ? "translateY(100%)" : "translateY(0)",
          opacity: isKeyboardVisible ? 0 : 1,
          transition: isKeyboardVisible
            ? "transform 200ms cubic-bezier(0.4, 0, 1, 1), opacity 180ms ease-out"
            : "transform 220ms cubic-bezier(0.0, 0.0, 0.2, 1), opacity 220ms ease-in",
          willChange: "transform, opacity",
          pointerEvents: isKeyboardVisible ? "none" : "auto",
        }}
      >
        {/* MiniPlayer */}
        <div className="pointer-events-auto">
          <MiniPlayer />
        </div>

        {/* Bottom Navigation */}
        <div className="pointer-events-auto">
          <BottomNav activeTab={activeTab} onTabChange={onTabChange} />
        </div>
      </div>

      {/* Full-Screen Now Playing Modal */}
      <NowPlayingModal
        onSelectArtist={onSelectArtist}
        onSelectAlbum={onSelectAlbum}
      />
    </div>
  );
};
