import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Camera, Trash2, Check, User, Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { UserAvatar } from '../common/UserAvatar';
import { compressAndCropAvatar } from '../../utils/imageCompressor';
import { useToast } from '../../context/ToastContext';
import { backButtonManager } from '../../services/backButtonManager';

interface EditProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const EditProfileModal: React.FC<EditProfileModalProps> = ({ isOpen, onClose }) => {
  const { user, profile, updateProfile } = useAuth();
  const { showToast } = useToast();

  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [active, setActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      const unregister = backButtonManager.register('edit-profile-modal', handleAnimatedClose, 30);
      return () => {
        clearTimeout(timer);
        unregister();
      };
    } else {
      setActive(false);
    }
  }, [isOpen, handleAnimatedClose]);

  useEffect(() => {
    if (isOpen) {
      setDisplayName(profile?.display_name || user?.user_metadata?.display_name || 'STUXS Listener');
      setAvatarUrl(profile?.avatar_url || null);
    }
  }, [isOpen, profile, user]);

  if (!isOpen) return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showToast('Please select a valid image file.', 'error');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      showToast('Image size should be less than 10MB.', 'error');
      return;
    }

    try {
      setIsProcessing(true);
      const compressedDataUrl = await compressAndCropAvatar(file, 400, 0.85);
      setAvatarUrl(compressedDataUrl);
      showToast('Profile photo selected. Tap Save Changes to apply.', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to process image.', 'error');
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleRemovePhoto = () => {
    setAvatarUrl(null);
    showToast('Photo removed. Initials avatar will be used.', 'info');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = displayName.trim();
    if (!trimmed) {
      showToast('Please enter a valid display name.', 'error');
      return;
    }

    setIsSaving(true);
    try {
      const { error } = await updateProfile({
        display_name: trimmed,
        avatar_url: avatarUrl,
      });

      if (error) {
        showToast(error, 'error');
      } else {
        showToast('Profile updated successfully!', 'success');
        handleAnimatedClose();
      }
    } catch {
      showToast('An unexpected error occurred.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

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
        className={`fixed inset-x-0 bottom-0 z-[1000] w-full max-w-sm mx-auto rounded-t-[32px] sm:rounded-3xl bg-stuxs-surface border-t sm:border border-stuxs-border shadow-2xl overflow-y-auto max-h-[90vh] transition-all select-none will-change-transform text-left ${
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
        <div className="sm:hidden flex justify-center pt-3 pb-1">
          <div className="w-9 h-1 rounded-full bg-stuxs-text-muted/30" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-stuxs-border/60">
          <h3 className="text-base font-bold text-stuxs-text tracking-tight">Edit Profile</h3>
          <button
            onClick={handleAnimatedClose}
            className="p-1.5 rounded-full text-stuxs-text-muted hover:text-stuxs-text hover:bg-stuxs-surface-hover transition-colors active:scale-95 cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-6">
          {/* Avatar Section */}
          <div className="flex flex-col items-center space-y-4">
            <div className="relative group">
              <UserAvatar
                name={displayName}
                email={user?.email}
                avatarUrl={avatarUrl}
                size="2xl"
                className="ring-4 ring-stuxs-accent/20"
              />

              {/* Upload Overlay Button */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessing}
                className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 group-active:opacity-100 flex flex-col items-center justify-center text-white transition-opacity cursor-pointer backdrop-blur-[2px]"
                title="Change photo"
              >
                {isProcessing ? (
                  <Loader2 className="w-6 h-6 animate-spin" />
                ) : (
                  <>
                    <Camera className="w-6 h-6 mb-1" />
                    <span className="text-[10px] font-bold uppercase tracking-wider">Change</span>
                  </>
                )}
              </button>

              {/* Floating Camera Button Badge */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="absolute bottom-0 right-0 p-2.5 rounded-full bg-stuxs-accent text-white shadow-lg hover:scale-105 active:scale-95 transition-transform cursor-pointer"
                aria-label="Upload photo"
              >
                <Camera className="w-4 h-4" />
              </button>
            </div>

            {/* Hidden Native File Input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />

            {/* Photo Action Buttons */}
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-3.5 py-1.5 rounded-full bg-stuxs-surface-secondary hover:bg-stuxs-surface-hover active:scale-95 text-xs font-semibold text-stuxs-text transition-all border border-stuxs-border cursor-pointer shadow-xs"
              >
                Change Photo
              </button>

              {avatarUrl && (
                <button
                  type="button"
                  onClick={handleRemovePhoto}
                  className="px-3 py-1.5 rounded-full bg-rose-500/15 hover:bg-rose-500/25 active:scale-95 text-xs font-semibold text-rose-600 dark:text-rose-300 transition-all flex items-center space-x-1 cursor-pointer border border-rose-500/25 shadow-xs"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Remove</span>
                </button>
              )}
            </div>
          </div>

          {/* Display Name Input */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-stuxs-text-muted block">
              Display Name
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-stuxs-text-muted">
                <User className="w-4 h-4" />
              </div>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={40}
                placeholder="Enter your name"
                className="w-full pl-10 pr-4 py-3 rounded-2xl bg-stuxs-surface-secondary border border-stuxs-border text-sm font-medium text-stuxs-text placeholder-stuxs-text-muted focus:outline-none focus:border-stuxs-accent focus:ring-1 focus:ring-stuxs-accent transition-colors"
                required
              />
            </div>
            <p className="text-[11px] text-stuxs-text-muted">
              {user?.email ? `Associated with ${user.email}` : 'Personalize your STUXS profile'}
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center space-x-3 pt-2">
            <button
              type="button"
              onClick={handleAnimatedClose}
              className="flex-1 py-3 rounded-2xl bg-stuxs-surface-secondary hover:bg-stuxs-surface-hover active:scale-98 text-xs font-semibold text-stuxs-text-secondary transition-all cursor-pointer border border-stuxs-border"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving || isProcessing}
              className="flex-1 py-3 rounded-2xl bg-stuxs-accent hover:opacity-90 active:scale-98 text-xs font-bold text-white transition-all shadow-lg flex items-center justify-center space-x-1.5 disabled:opacity-50 cursor-pointer"
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  <span>Save Changes</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </>,
    document.body
  );
};
