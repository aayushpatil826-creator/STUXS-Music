import React from 'react';
import { Upload, Search } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { UserAvatar } from '../common/UserAvatar';

interface HeaderProps {
  title?: string;
  subtitle?: string;
  onOpenAuth: () => void;
  onOpenUpload?: () => void;
  onNavigateToSearch?: () => void;
  showGreeting?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  title,
  subtitle,
  onOpenAuth,
  onOpenUpload,
  onNavigateToSearch,
  showGreeting = false,
}) => {
  const { user, profile, isDeveloper } = useAuth();

  const rawName = profile?.display_name || user?.user_metadata?.display_name || user?.email?.split('@')[0];
  const firstName = rawName ? rawName.trim().split(' ')[0] : '';
  const greetingTitle = firstName ? `Hey ${firstName}! 👋` : 'Hey there 👋';

  return (
    <header className="px-5 safe-top-header pt-2 pb-3 transition-colors">
      {showGreeting ? (
        <>
          {/* Top Row: STUXS MUSIC Wordmark (Left) and Action Buttons (Right) */}
          <div className="flex items-center justify-between">
            <div className="flex items-baseline gap-1.5 select-none cursor-default">
              <span className="font-extrabold text-[15px] tracking-wider text-stuxs-text dark:text-violet-200 uppercase font-sans">
                STU<span className="text-purple-600 dark:text-violet-400 font-black">X</span>S
              </span>
              <span className="text-[10px] font-bold tracking-[0.24em] text-stuxs-text-secondary dark:text-violet-300/75 uppercase font-sans">
                MUSIC
              </span>
            </div>

            <div className="flex items-center space-x-2">
              {onNavigateToSearch && (
                <button
                  onClick={onNavigateToSearch}
                  className="w-9 h-9 rounded-full bg-white dark:bg-white/10 text-slate-800 dark:text-white flex items-center justify-center shadow-sm hover:shadow active:scale-90 transition-all border border-black/5 dark:border-white/10 cursor-pointer"
                  aria-label="Search"
                  title="Search music"
                >
                  <Search className="w-4 h-4 text-slate-700 dark:text-purple-200" />
                </button>
              )}

              {isDeveloper && onOpenUpload && (
                <button
                  onClick={onOpenUpload}
                  className="px-2.5 py-1 rounded-full bg-stuxs-accent/15 hover:bg-stuxs-accent/25 border border-stuxs-accent/30 text-stuxs-accent text-xs font-bold flex items-center space-x-1.5 transition-all active:scale-95 cursor-pointer"
                  title="Upload STUXS Song"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Upload</span>
                </button>
              )}

              <button
                onClick={onOpenAuth}
                className="relative p-0.5 rounded-full hover:ring-2 hover:ring-stuxs-accent/40 active:scale-95 transition-all shadow-sm flex items-center justify-center cursor-pointer"
                aria-label="Account profile"
              >
                <UserAvatar
                  name={rawName || 'STUXS Listener'}
                  email={user?.email}
                  avatarUrl={profile?.avatar_url}
                  size="sm"
                />
              </button>
            </div>
          </div>

          {/* Prominent Personalized Greeting & Friendly Subtitle */}
          <div className="mt-2.5">
            <h1 className="text-2xl sm:text-[26px] font-black tracking-tight text-stuxs-text">
              {greetingTitle}
            </h1>
            <p className="text-xs font-medium text-stuxs-text-secondary mt-0.5">
              Listen to your favorite music
            </p>
          </div>
        </>
      ) : (
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-stuxs-text">
              {title || 'STUXS MUSIC'}
            </h1>
            {subtitle && (
              <p className="text-xs font-medium text-stuxs-text-secondary mt-0.5">
                {subtitle}
              </p>
            )}
          </div>

          <div className="flex items-center space-x-2">
            {isDeveloper && onOpenUpload && (
              <button
                onClick={onOpenUpload}
                className="px-2.5 py-1 rounded-full bg-stuxs-accent/15 hover:bg-stuxs-accent/25 border border-stuxs-accent/30 text-stuxs-accent text-xs font-bold flex items-center space-x-1.5 transition-all active:scale-95 cursor-pointer"
                title="Upload STUXS Song"
              >
                <Upload className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Upload</span>
              </button>
            )}

            <button
              onClick={onOpenAuth}
              className="relative p-0.5 rounded-full hover:ring-2 hover:ring-stuxs-accent/40 active:scale-95 transition-all shadow-sm flex items-center justify-center cursor-pointer"
              aria-label="Account profile"
            >
              <UserAvatar
                name={rawName || 'STUXS Listener'}
                email={user?.email}
                avatarUrl={profile?.avatar_url}
                size="sm"
              />
            </button>
          </div>
        </div>
      )}
    </header>
  );
};
