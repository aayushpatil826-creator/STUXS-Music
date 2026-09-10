import React, { useState, useEffect } from 'react';

interface UserAvatarProps {
  name?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  className?: string;
}

export function getInitials(name?: string | null, email?: string | null): string {
  const cleanName = (name || '').trim();
  if (cleanName) {
    const parts = cleanName.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return cleanName.slice(0, 2).toUpperCase();
  }
  const cleanEmail = (email || '').trim();
  if (cleanEmail) {
    return cleanEmail.slice(0, 2).toUpperCase();
  }
  return 'S';
}

export function getAvatarColor(seed?: string | null): string {
  const str = seed || 'stuxs';
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const gradients = [
    'from-purple-600 via-indigo-600 to-purple-800 text-white',
    'from-violet-600 via-fuchsia-600 to-purple-700 text-white',
    'from-indigo-600 via-purple-600 to-pink-600 text-white',
    'from-purple-700 via-violet-700 to-indigo-800 text-white',
    'from-fuchsia-600 via-purple-600 to-violet-800 text-white',
    'from-cyan-600 via-blue-600 to-indigo-700 text-white',
  ];
  const index = Math.abs(hash) % gradients.length;
  return gradients[index];
}

const SIZE_MAP = {
  xs: 'w-6 h-6 text-[10px]',
  sm: 'w-8 h-8 text-xs font-semibold',
  md: 'w-10 h-10 text-sm font-bold',
  lg: 'w-12 h-12 text-base font-bold',
  xl: 'w-20 h-20 text-2xl font-extrabold',
  '2xl': 'w-28 h-28 text-3xl font-extrabold',
};

export const UserAvatar: React.FC<UserAvatarProps> = ({
  name,
  email,
  avatarUrl,
  size = 'md',
  className = '',
}) => {
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    setImageError(false);
  }, [avatarUrl]);

  const initials = getInitials(name, email);
  const gradient = getAvatarColor(name || email || 'stuxs');
  const sizeClasses = SIZE_MAP[size] || SIZE_MAP.md;

  const hasValidImage = Boolean(avatarUrl && !imageError);

  return (
    <div
      className={`relative inline-flex items-center justify-center rounded-full flex-shrink-0 select-none overflow-hidden border border-white/10 shadow-md ${sizeClasses} ${className}`}
    >
      {hasValidImage ? (
        <img
          src={avatarUrl!}
          alt={name || 'User Avatar'}
          onError={() => setImageError(true)}
          className="w-full h-full object-cover rounded-full"
        />
      ) : (
        <div
          className={`w-full h-full flex items-center justify-center bg-gradient-to-br ${gradient} tracking-wider rounded-full shadow-inner`}
        >
          <span className="drop-shadow-sm leading-none">{initials}</span>
        </div>
      )}
    </div>
  );
};
