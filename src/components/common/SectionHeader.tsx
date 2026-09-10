import React from 'react';
import { ChevronRight } from 'lucide-react';

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  actionText?: string;
  onAction?: () => void;
  className?: string;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({
  title,
  subtitle,
  actionText = 'See All',
  onAction,
  className = '',
}) => {
  return (
    <div className={`flex items-end justify-between px-1 pt-4 pb-2.5 ${className}`}>
      <div>
        <h2 className="text-lg sm:text-xl font-bold tracking-tight text-stuxs-text">{title}</h2>
        {subtitle && (
          <p className="text-xs font-medium text-stuxs-text-secondary mt-0.5">{subtitle}</p>
        )}
      </div>
      {onAction && (
        <button
          onClick={onAction}
          className="flex items-center text-xs font-semibold text-purple-600 dark:text-purple-400 hover:opacity-80 transition-opacity active:scale-95 cursor-pointer"
        >
          <span>{actionText}</span>
          <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
        </button>
      )}
    </div>
  );
};
