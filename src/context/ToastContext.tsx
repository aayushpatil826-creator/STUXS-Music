import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastMessage {
  id: string;
  title: string;
  description?: string;
  type: ToastType;
  action?: ToastAction;
  duration?: number;
}

interface ToastContextType {
  showToast: (
    title: string,
    type?: ToastType,
    description?: string,
    action?: ToastAction
  ) => void;
  hideToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const hideToast = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (
      title: string,
      type: ToastType = 'success',
      description?: string,
      action?: ToastAction
    ) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      // Coalescing: calculate appropriate duration based on importance and length
      const baseDuration =
        type === 'error' ? 4200 : type === 'warning' ? 3400 : type === 'info' ? 2600 : 2200;
      const duration = description ? baseDuration + 800 : baseDuration;

      const newToast: ToastMessage = { id, title, description, type, action, duration };

      // Coalescing: Max 2 visible to prevent screen obstruction
      setToasts((prev) => [...prev.slice(-1), newToast]);

      const timer = setTimeout(() => {
        hideToast(id);
      }, duration);

      timersRef.current.set(id, timer);
    },
    [hideToast]
  );

  return (
    <ToastContext.Provider value={{ showToast, hideToast }}>
      {children}
      {/* Toast In-App Notification Overlay — Safe Area & Cutout Compliant */}
      <aside
        aria-label="Notifications"
        className="fixed left-1/2 -translate-x-1/2 z-[9999] w-full max-w-sm px-4 pointer-events-none space-y-2 select-none"
        style={{
          top: 'calc(max(var(--safe-area-inset-top, 0px), env(safe-area-inset-top, 0px), 44px) + 12px)',
          paddingLeft: 'max(env(safe-area-inset-left, 16px), 16px)',
          paddingRight: 'max(env(safe-area-inset-right, 16px), 16px)',
        }}
      >
        {toasts.map((toast) => {
          const isError = toast.type === 'error';
          const isWarning = toast.type === 'warning';
          const isSuccess = toast.type === 'success';

          return (
            <div
              key={toast.id}
              role={isError ? 'alert' : 'status'}
              aria-live={isError ? 'assertive' : 'polite'}
              className={`pointer-events-auto flex items-center justify-between p-3.5 rounded-2xl shadow-2xl backdrop-blur-2xl border transition-all animate-dialog-in ${
                isError
                  ? 'bg-rose-950/90 dark:bg-rose-950/90 bg-rose-50 border-rose-500/40 text-rose-900 dark:text-rose-100 shadow-rose-950/30'
                  : isWarning
                  ? 'bg-amber-950/90 dark:bg-amber-950/90 bg-amber-50 border-amber-500/40 text-amber-900 dark:text-amber-100 shadow-amber-950/30'
                  : 'bg-stuxs-surface/95 border-stuxs-border text-stuxs-text shadow-xl'
              }`}
            >
              <div className="flex items-center space-x-3 min-w-0 pr-2 flex-1">
                {isSuccess && (
                  <div className="w-8 h-8 rounded-full bg-stuxs-accent/15 border border-stuxs-accent/30 flex items-center justify-center flex-shrink-0 text-stuxs-accent">
                    <CheckCircle2 className="w-4 h-4" />
                  </div>
                )}
                {isError && (
                  <div className="w-8 h-8 rounded-full bg-rose-500/15 border border-rose-500/30 flex items-center justify-center flex-shrink-0 text-rose-500">
                    <AlertCircle className="w-4 h-4" />
                  </div>
                )}
                {isWarning && (
                  <div className="w-8 h-8 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center flex-shrink-0 text-amber-500">
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                )}
                {!isSuccess && !isError && !isWarning && (
                  <div className="w-8 h-8 rounded-full bg-stuxs-surface-secondary border border-stuxs-border flex items-center justify-center flex-shrink-0 text-stuxs-text-secondary">
                    <Info className="w-4 h-4" />
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold tracking-tight truncate text-stuxs-text">{toast.title}</p>
                  {toast.description && (
                    <p className="text-[11px] text-stuxs-text-secondary truncate mt-0.5 leading-snug">
                      {toast.description}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center space-x-1.5 flex-shrink-0">
                {toast.action && (
                  <button
                    onClick={() => {
                      toast.action?.onClick();
                      hideToast(toast.id);
                    }}
                    className="px-2.5 py-1 text-xs font-bold text-stuxs-accent hover:bg-stuxs-accent/15 rounded-lg transition-colors btn-press cursor-pointer"
                  >
                    {toast.action.label}
                  </button>
                )}
                <button
                  onClick={() => hideToast(toast.id)}
                  className="p-1 rounded-full text-stuxs-text-muted hover:text-stuxs-text hover:bg-stuxs-surface-hover btn-press transition-colors cursor-pointer"
                  aria-label="Dismiss notification"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </aside>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};
