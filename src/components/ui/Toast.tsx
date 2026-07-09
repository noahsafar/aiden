import React, { useEffect, useState } from 'react';

export interface ToastData {
  id: string;
  message: string;
  undo?: () => void;
  duration?: number;
}

interface ToastProps {
  toast: ToastData;
  onDismiss: (id: string) => void;
}

export const Toast: React.FC<ToastProps> = ({ toast, onDismiss }) => {
  const [timeLeft, setTimeLeft] = useState(toast.duration || 5000);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    if (isPaused) return;

    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 100) {
          onDismiss(toast.id);
          return 0;
        }
        return prev - 100;
      });
    }, 100);

    return () => clearInterval(interval);
  }, [toast.id, onDismiss, isPaused]);

  const progressPercent = ((toast.duration || 5000) - timeLeft) / (toast.duration || 5000) * 100;

  return (
    <div
      role="status"
      className="relative bg-surface text-foreground border border-border px-4 py-3 rounded-lg shadow-elevated-lg flex items-center gap-3 min-w-[300px] max-w-md"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      <span className="flex-1 text-sm">{toast.message}</span>
      {toast.undo && (
        <button
          onClick={() => {
            toast.undo?.();
            onDismiss(toast.id);
          }}
          className="text-sm font-semibold text-primary-600 hover:text-primary-500 dark:text-primary-400"
        >
          Undo
        </button>
      )}
      <button
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className="rounded text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50"
      >
        ×
      </button>
      {/* Progress bar */}
      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-black/10 dark:bg-white/15 rounded-b-lg overflow-hidden">
        <div
          className="h-full bg-primary-500 transition-all duration-100 ease-linear"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
    </div>
  );
};

interface ToastContainerProps {
  toasts: ToastData[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
};
