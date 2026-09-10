import React from 'react';
import { Music, FolderPlus, Search, Disc } from 'lucide-react';

interface EmptyStateProps {
  icon?: 'music' | 'search' | 'library' | 'disc';
  title: string;
  description: string;
  actionText?: string;
  onAction?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon = 'music',
  title,
  description,
  actionText,
  onAction,
}) => {
  const getIcon = () => {
    switch (icon) {
      case 'search':
        return <Search className="w-10 h-10 text-stuxs-text-muted stroke-[1.5]" />;
      case 'library':
        return <FolderPlus className="w-10 h-10 text-stuxs-text-muted stroke-[1.5]" />;
      case 'disc':
        return <Disc className="w-10 h-10 text-stuxs-text-muted stroke-[1.5]" />;
      default:
        return <Music className="w-10 h-10 text-stuxs-text-muted stroke-[1.5]" />;
    }
  };

  return (
    <div className="flex flex-col items-center justify-center text-center p-8 my-6">
      <div className="w-20 h-20 rounded-2xl bg-stuxs-surface-secondary border border-stuxs-border flex items-center justify-center mb-4 shadow-sm">
        {getIcon()}
      </div>
      <h3 className="text-base font-bold text-stuxs-text tracking-tight mb-1">
        {title}
      </h3>
      <p className="text-xs text-stuxs-text-secondary max-w-xs leading-relaxed mb-5">
        {description}
      </p>
      {actionText && onAction && (
        <button
          onClick={onAction}
          className="px-5 py-2.5 rounded-full bg-stuxs-surface-tertiary hover:bg-stuxs-accent text-stuxs-text font-semibold text-xs transition-colors shadow-sm active:scale-95 border border-stuxs-border"
        >
          {actionText}
        </button>
      )}
    </div>
  );
};
