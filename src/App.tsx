import React, { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SettingsProvider } from './context/SettingsContext';
import { LibraryProvider } from './context/LibraryContext';
import { PlayerProvider } from './context/PlayerContext';
import { SearchProvider } from './context/SearchContext';
import { ToastProvider } from './context/ToastContext';
import { AppLayout } from './components/layout/AppLayout';
import type { TabType } from './components/layout/BottomNav';
import { HomeScreen } from './screens/HomeScreen';
import { SearchScreen } from './screens/SearchScreen';
import { LibraryScreen } from './screens/LibraryScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { ArtistScreen } from './screens/ArtistScreen';
import { AlbumScreen } from './screens/AlbumScreen';
import { PlaylistScreen } from './screens/PlaylistScreen';
import { AuthScreen } from './screens/AuthScreen';
import { SplashScreen } from './components/common/SplashScreen';
import { backButtonManager } from './services/backButtonManager';
import { nativeMigrationService } from './services/NativeMigrationService';
import { homeDiscoveryService } from './services/HomeDiscoveryService';
import { localCacheService } from './services/LocalCacheService';
import { AppUpdateManager } from './components/update/AppUpdateManager';

const AuthModal = React.lazy(() => import('./components/modals/AuthModal'));
const DeveloperUploadModal = React.lazy(() => import('./components/modals/DeveloperUploadModal'));


type ActiveDetailView =
  | { type: 'artist'; id: string }
  | { type: 'album'; id: string }
  | { type: 'playlist'; id: string }
  | null;

const TAB_INDICES: Record<TabType, number> = {
  home: 0,
  search: 1,
  library: 2,
  settings: 3,
};

export const AppContent: React.FC = () => {
  const { user, isDeveloper, isLoading, isPasswordRecovery } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>('home');
  const [previousTab, setPreviousTab] = useState<TabType | null>(null);
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward');
  const [detailView, setDetailView] = useState<ActiveDetailView>(null);
  const [isClosingDetail, setIsClosingDetail] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isDeveloperUploadOpen, setIsDeveloperUploadOpen] = useState(false);
  const tabTransitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (tabTransitionTimerRef.current) {
        clearTimeout(tabTransitionTimerRef.current);
      }
    };
  }, []);

  // Phase 6 Step 6: Delayed startup background migration of legacy IndexedDB downloads
  useEffect(() => {
    const cancelSchedule = nativeMigrationService.scheduleStartupMigration(6000, 3000);
    return () => {
      cancelSchedule();
    };
  }, []);

  // Revalidate stale caches and prune on app resume / foreground without blocking UI
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        localCacheService.prune();
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', handleVisibilityChange);
    }
    return () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', handleVisibilityChange);
      }
    };
  }, []);

  // Android hardware back button handler with centralized priority stack
  useEffect(() => {
    let removeListener: (() => void) | undefined;

    import('@capacitor/app')
      .then(({ App: CapApp }) => {
        const listenerPromise = CapApp.addListener('backButton', () => {
          // 1. If software keyboard is open → dismiss it first, don't navigate
          if (
            document.activeElement instanceof HTMLElement &&
            (document.activeElement.tagName === 'INPUT' ||
              document.activeElement.tagName === 'TEXTAREA' ||
              document.activeElement.contentEditable === 'true')
          ) {
            document.activeElement.blur();
            return;
          }

          // 2. Delegate to active modal/sheet animated dismiss handlers
          const handled = backButtonManager.handleBack();
          if (handled) return;

          // 3. Fallback screen navigation hierarchy
          if (detailView) {
            handleBack();
          } else if (activeTab !== 'home') {
            handleTabChange('home');
          } else {
            CapApp.exitApp();
          }
        });
        removeListener = () => {
          listenerPromise.then((handle) => handle.remove());
        };
      })
      .catch(() => {
        // Fallback for non-Capacitor environments
      });

    return () => {
      removeListener?.();
    };
  }, [detailView, activeTab]);

  const handleTabChange = useCallback((nextTab: TabType) => {
    setActiveTab((curTab) => {
      if (nextTab === curTab) return curTab;
      if (tabTransitionTimerRef.current) {
        clearTimeout(tabTransitionTimerRef.current);
      }
      const isForward = TAB_INDICES[nextTab] >= TAB_INDICES[curTab];
      setDirection(isForward ? 'forward' : 'backward');
      setPreviousTab(curTab);
      setDetailView(null);
      setIsClosingDetail(false);

      tabTransitionTimerRef.current = setTimeout(() => {
        setPreviousTab(null);
        tabTransitionTimerRef.current = null;
      }, 220);
      return nextTab;
    });
  }, []);

  const savedScrollPosRef = useRef(0);

  const handleSelectArtist = useCallback((artistId: string) => {
    savedScrollPosRef.current = window.scrollY || 0;
    setIsClosingDetail(false);
    setDetailView({ type: 'artist', id: artistId });
    window.scrollTo(0, 0);
  }, []);

  const handleSelectAlbum = useCallback((albumId?: string) => {
    if (albumId) {
      savedScrollPosRef.current = window.scrollY || 0;
      setIsClosingDetail(false);
      setDetailView({ type: 'album', id: albumId });
      window.scrollTo(0, 0);
    }
  }, []);

  const handleSelectPlaylist = useCallback((playlistId: string) => {
    savedScrollPosRef.current = window.scrollY || 0;
    setIsClosingDetail(false);
    setDetailView({ type: 'playlist', id: playlistId });
    window.scrollTo(0, 0);
  }, []);

  const handleBack = useCallback(() => {
    setIsClosingDetail((closing) => {
      if (closing) return closing;
      setTimeout(() => {
        setDetailView(null);
        setIsClosingDetail(false);
        requestAnimationFrame(() => {
          window.scrollTo(0, savedScrollPosRef.current);
        });
      }, 200);
      return true;
    });
  }, []);

  const handleOpenAuth = useCallback(() => {
    setIsAuthModalOpen(true);
  }, []);

  const handleOpenUpload = useCallback(() => {
    setIsDeveloperUploadOpen(true);
  }, []);

  const handleNavigateToSearch = useCallback(() => {
    handleTabChange('search');
  }, [handleTabChange]);

  const handleNavigateToLibrary = useCallback(() => {
    handleTabChange('library');
  }, [handleTabChange]);

  const getTabContainerClass = (tab: TabType) => {
    // Hide active tabs when detail view (artist, album, playlist) is open
    if (detailView) return 'hidden';
    if (tab === activeTab) {
      const animClass = previousTab
        ? direction === 'forward'
          ? 'animate-tab-forward-enter'
          : 'animate-tab-backward-enter'
        : '';
      return `relative z-10 flex-1 w-full h-full flex flex-col min-h-0 bg-stuxs-bg overflow-hidden will-change-transform ${animClass}`;
    }
    if (tab === previousTab) {
      const exitClass =
        direction === 'forward' ? 'animate-tab-exit-left' : 'animate-tab-exit-right';
      return `absolute inset-0 z-0 pointer-events-none flex-1 w-full h-full flex flex-col min-h-0 bg-stuxs-bg overflow-hidden will-change-transform ${exitClass}`;
    }
    return 'hidden';
  };

  const renderContent = () => {
    return (
      <div className="relative w-full h-full flex-1 flex flex-col min-h-0">
        {/* Persistent Tab Containers with directional dual-screen physical transitions */}
        <div className={getTabContainerClass('home')}>
          <HomeScreen
            onSelectArtist={handleSelectArtist}
            onSelectAlbum={handleSelectAlbum}
            onSelectPlaylist={handleSelectPlaylist}
            onOpenAuth={handleOpenAuth}
            onOpenUpload={handleOpenUpload}
            onNavigateToSearch={handleNavigateToSearch}
            onNavigateToLibrary={handleNavigateToLibrary}
          />
        </div>

        <div className={getTabContainerClass('search')}>
          <SearchScreen
            onSelectArtist={handleSelectArtist}
            onSelectAlbum={handleSelectAlbum}
            onSelectPlaylist={handleSelectPlaylist}
          />
        </div>

        <div className={getTabContainerClass('library')}>
          <LibraryScreen
            onSelectArtist={handleSelectArtist}
            onSelectAlbum={handleSelectAlbum}
            onSelectPlaylist={handleSelectPlaylist}
          />
        </div>

        <div className={getTabContainerClass('settings')}>
          <SettingsScreen onOpenAuth={handleOpenAuth} />
        </div>

        {/* Artist / Album: full-screen horizontal slide-in (tabs hidden via getTabContainerClass) */}
        {detailView && detailView.type !== 'playlist' && (
          <div className={`flex-1 w-full flex flex-col min-h-0 ${isClosingDetail ? 'animate-detail-exit' : 'animate-detail-enter'}`}>
            {detailView.type === 'artist' && (
              <ArtistScreen
                artistId={detailView.id}
                onBack={handleBack}
                onSelectAlbum={handleSelectAlbum}
                onSelectArtist={handleSelectArtist}
              />
            )}
            {detailView.type === 'album' && (
              <AlbumScreen
                albumId={detailView.id}
                onBack={handleBack}
                onSelectArtist={handleSelectArtist}
              />
            )}
          </div>
        )}

        {/* Playlist: bottom-up sheet view in document flow with native hardware scrolling */}
        {detailView && detailView.type === 'playlist' && (
          <div
            className={`flex-1 w-full flex flex-col min-h-0 ${
              isClosingDetail ? 'animate-playlist-sheet-exit' : 'animate-playlist-sheet-enter'
            }`}
          >
            <PlaylistScreen
              playlistId={detailView.id}
              onBack={handleBack}
              onSelectArtist={handleSelectArtist}
            />
          </div>
        )}

      </div>
    );
  };

  const [showSplash, setShowSplash] = useState(() => isLoading);

  useEffect(() => {
    if (!isLoading) {
      const timer = setTimeout(() => {
        setShowSplash(false);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isLoading]);

  // 1. Unauthenticated Gate or Password Recovery Screen
  if (!user || isPasswordRecovery) {
    return (
      <>
        {showSplash && <SplashScreen isFadingOut={!isLoading} />}
        <AuthScreen />
      </>
    );
  }

  // 2. Authenticated Application with Smooth Splash Fade
  return (
    <>
      {showSplash && <SplashScreen isFadingOut={!isLoading} />}
      <AppLayout
        activeTab={activeTab}
        onTabChange={handleTabChange}
        onSelectArtist={handleSelectArtist}
        onSelectAlbum={handleSelectAlbum}
      >
        {renderContent()}

        {isAuthModalOpen && (
          <Suspense fallback={null}>
            <AuthModal
              isOpen={isAuthModalOpen}
              onClose={() => setIsAuthModalOpen(false)}
              onOpenUpload={() => setIsDeveloperUploadOpen(true)}
            />
          </Suspense>
        )}

        {isDeveloper && isDeveloperUploadOpen && (
          <Suspense fallback={null}>
            <DeveloperUploadModal
              isOpen={isDeveloperUploadOpen}
              onClose={() => setIsDeveloperUploadOpen(false)}
              onTrackPublished={() => homeDiscoveryService.clearCache()}
            />
          </Suspense>
        )}

        <AppUpdateManager />
      </AppLayout>
    </>
  );
};

export const App: React.FC = () => {
  return (
    <ToastProvider>
      <AuthProvider>
        <SettingsProvider>
          <LibraryProvider>
            <PlayerProvider>
              <SearchProvider>
                <AppContent />
              </SearchProvider>
            </PlayerProvider>
          </LibraryProvider>
        </SettingsProvider>
      </AuthProvider>
    </ToastProvider>
  );
};

export default App;
