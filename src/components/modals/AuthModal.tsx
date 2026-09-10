import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Lock, ShieldCheck, Check } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { UserAvatar } from '../common/UserAvatar';
import { backButtonManager } from '../../services/backButtonManager';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenUpload?: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, onOpenUpload }) => {
  const { user, profile, isDeveloper, updateProfile, signOut } = useAuth();
  const [displayName, setDisplayName] = useState(profile?.display_name || '');
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [active, setActive] = useState(false);

  const handleAnimatedClose = useCallback(() => {
    setActive(false);
    setTimeout(() => {
      onClose();
    }, 240);
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        setActive(true);
      }, 20);
      const unregister = backButtonManager.register('auth-modal', handleAnimatedClose, 30);
      return () => {
        clearTimeout(timer);
        unregister();
      };
    } else {
      setActive(false);
    }
  }, [isOpen, handleAnimatedClose]);

  if (!isOpen) return null;

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) return;
    setIsSaving(true);
    const { error } = await updateProfile({ display_name: displayName.trim() });
    setIsSaving(false);
    if (!error) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  const name = profile?.display_name || user?.user_metadata?.display_name || 'STUXS Listener';

  return createPortal(
    <>
      {/* Dim Scrim Backdrop */}
      <div
        onClick={handleAnimatedClose}
        className={`fixed inset-0 z-[999] bg-black/50 transition-opacity duration-240 ${
          active ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden="true"
      />

      {/* Bottom Sheet Container: slides upward from bottom */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={`fixed inset-x-0 bottom-0 z-[1000] w-full max-w-sm mx-auto bg-stuxs-surface border-t sm:border border-stuxs-border rounded-t-[32px] sm:rounded-3xl p-6 shadow-2xl transition-all select-none will-change-transform text-left ${
          active ? 'duration-300' : 'duration-240'
        }`}
        style={{
          transform: active ? 'translate3d(0, 0, 0)' : 'translate3d(0, 100%, 0)',
          opacity: active ? 1 : 0,
          transitionTimingFunction: active ? 'cubic-bezier(0.16, 1, 0.3, 1)' : 'cubic-bezier(0.3, 0, 0.8, 0.15)',
          paddingBottom: 'max(env(safe-area-inset-bottom, 16px), var(--safe-area-inset-bottom, 16px), 16px)',
        }}
      >
        {/* Top Drag Handle for mobile */}
        <div className="sm:hidden flex justify-center -mt-2 pb-3">
          <div className="w-9 h-1 rounded-full bg-stuxs-text-muted/30" />
        </div>
        <div className="flex items-center justify-between pb-3 border-b border-stuxs-border/60">
          <div className="flex items-center space-x-2">
            <Lock className="w-5 h-5 text-stuxs-accent" />
            <h3 className="text-base font-bold text-stuxs-text">Account Profile</h3>
          </div>
          <button
            onClick={handleAnimatedClose}
            className="p-1 rounded-full text-stuxs-text-muted hover:text-stuxs-text cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="pt-4 space-y-4 text-xs">
          <div className="flex items-center space-x-3.5 p-3.5 rounded-2xl bg-stuxs-surface-secondary border border-stuxs-border shadow-xs">
            <UserAvatar
              name={name}
              email={user?.email}
              avatarUrl={profile?.avatar_url}
              size="lg"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center space-x-1.5">
                <h4 className="text-sm font-bold text-stuxs-text truncate">
                  {name}
                </h4>
                {isDeveloper && (
                  <span className="px-1.5 py-0.2 rounded text-[9px] font-extrabold uppercase bg-purple-500/20 text-purple-300 border border-purple-500/30">
                    Dev
                  </span>
                )}
              </div>
              <p className="text-xs text-stuxs-text-secondary truncate mt-0.5">
                {user?.email || 'Authenticated User'}
              </p>
            </div>
          </div>

          {/* Developer Control Panel in Profile */}
          {isDeveloper && onOpenUpload && (
            <div className="p-3.5 rounded-2xl bg-purple-500/10 border border-purple-500/25 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-purple-300 uppercase tracking-wider">
                  Developer Controls
                </span>
                <span className="text-[10px] font-semibold text-purple-300/80">
                  Direct Catalog
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenUpload();
                }}
                className="w-full py-2.5 rounded-xl bg-stuxs-accent hover:opacity-90 text-white font-bold text-xs shadow-stuxs-glow transition-all active:scale-95 cursor-pointer flex items-center justify-center space-x-1.5"
              >
                <span>Upload Song / Manage Catalog</span>
              </button>
            </div>
          )}

          <form onSubmit={handleSaveProfile} className="space-y-2">
            <label className="block text-[11px] font-semibold text-stuxs-text-secondary uppercase">
              Display Name
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your Name"
                className="flex-1 px-3.5 py-2.5 rounded-xl bg-stuxs-surface-secondary border border-stuxs-border text-xs text-stuxs-text placeholder-stuxs-text-muted focus:outline-none focus:border-stuxs-accent transition-colors"
              />
              <button
                type="submit"
                disabled={isSaving}
                className="px-3.5 py-2.5 rounded-xl bg-stuxs-accent hover:opacity-90 text-white font-semibold text-xs transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50 shadow-xs"
              >
                {saved ? <Check className="w-3.5 h-3.5" /> : isSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>

          <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 flex items-center space-x-2 font-medium">
            <ShieldCheck className="w-4 h-4 flex-shrink-0" />
            <span>Supabase Session Active & Protected by RLS</span>
          </div>

          <button
            onClick={async () => {
              await signOut();
              onClose();
            }}
            className="w-full py-2.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-600 dark:text-rose-300 font-semibold transition-colors border border-rose-500/30 cursor-pointer text-xs"
          >
            Sign Out
          </button>
        </div>
      </div>
    </>,
    document.body
  );
};

export default AuthModal;


