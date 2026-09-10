import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  title = 'Something went wrong',
  message = 'Unable to load catalog metadata. Please check your connection and try again.',
  onRetry,
}) => {
  return (
    <div className="flex flex-col items-center justify-center text-center p-8 my-6">
      <div className="w-16 h-16 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mb-4 text-rose-500">
        <AlertCircle className="w-8 h-8 stroke-[1.75]" />
      </div>
      <h3 className="text-base font-bold text-stuxs-text tracking-tight mb-1">
        {title}
      </h3>
      <p className="text-xs text-stuxs-text-secondary max-w-xs leading-relaxed mb-5">
        {message}
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center space-x-2 px-5 py-2.5 rounded-full bg-stuxs-surface-secondary hover:bg-stuxs-surface-hover text-stuxs-text font-semibold text-xs transition-colors border border-stuxs-border shadow-sm active:scale-95"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Retry</span>
        </button>
      )}
    </div>
  );
};
