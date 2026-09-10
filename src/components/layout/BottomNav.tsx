import React from 'react';
import { Home, Search, Library, Settings } from 'lucide-react';
import { triggerLightHaptic } from '../../utils/haptics';

export type TabType = 'home' | 'search' | 'library' | 'settings';

interface BottomNavProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({ activeTab, onTabChange }) => {
  const tabs: { id: TabType; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'search', label: 'Search', icon: Search },
    { id: 'library', label: 'Library', icon: Library },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  const activeIndex = tabs.findIndex((t) => t.id === activeTab);

  const handleTabClick = (tabId: TabType) => {
    if (activeTab !== tabId) {
      triggerLightHaptic();
      onTabChange(tabId);
    }
  };

  return (
    <nav className="w-full liquid-glass-bottom-nav bg-stuxs-surface/95 backdrop-blur-xl border-t border-stuxs-border rounded-t-2xl pb-safe-bottom overflow-hidden select-none shadow-[0_-6px_24px_rgba(0,0,0,0.1)] dark:shadow-[0_-6px_24px_rgba(0,0,0,0.6)]">
      <div className="relative flex items-center justify-around h-16 max-w-md mx-auto px-2">
        {/* Floating Bubble Animated Sliding Background Pill */}
        {activeIndex !== -1 && (
          <div
            className="absolute top-2 bottom-2 left-2 rounded-xl bg-stuxs-text/5 dark:bg-white/[0.09] border border-stuxs-border shadow-sm pointer-events-none transition-transform duration-220 will-change-transform"
            style={{
              width: `calc((100% - 1rem) / ${tabs.length})`,
              transform: `translate3d(calc(${activeIndex * 100}%), 0, 0)`,
              transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          >
            {/* Top Specular Shimmer / Bubble Glint */}
            <div className="absolute top-0 inset-x-2 h-1/2 bg-gradient-to-b from-stuxs-text/10 dark:from-white/20 to-transparent rounded-t-xl pointer-events-none" />
          </div>
        )}

        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              onClick={(e) => {
                e.stopPropagation();
                handleTabClick(tab.id);
              }}
              className={`relative z-10 flex flex-col items-center justify-center flex-1 h-full py-1 transition-colors duration-180 active:scale-95 touch-manipulation ${
                isActive ? 'text-stuxs-accent' : 'text-stuxs-text-muted hover:text-stuxs-text'
              }`}
            >
              <div className="relative flex items-center justify-center">
                <Icon
                  className={`w-5 h-5 transition-transform duration-200 ease-out ${
                    isActive ? 'scale-110 text-stuxs-accent' : 'scale-100 text-stuxs-text-muted'
                  }`}
                />
                {isActive && (
                  <span
                    className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-stuxs-accent shadow-stuxs-glow animate-in fade-in zoom-in-75 duration-150"
                  />
                )}
              </div>
              <span
                className={`text-[10px] font-semibold mt-1 tracking-tight transition-all duration-180 ${
                  isActive ? 'text-stuxs-accent font-bold opacity-100' : 'text-stuxs-text-muted opacity-80'
                }`}
              >
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
