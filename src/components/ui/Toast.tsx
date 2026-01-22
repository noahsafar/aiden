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
      className="relative bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 min-w-[300px] max-w-md"
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
          className="text-sm font-semibold text-blue-400 hover:text-blue-300 dark:text-blue-600 dark:hover:text-blue-500"
        >
          Undo
        </button>
      )}
      <button
        onClick={() => onDismiss(toast.id)}
        className="text-gray-400 hover:text-gray-300 dark:text-gray-600 dark:hover:text-gray-500"
      >
        ×
      </button>
      {/* Progress bar */}
      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gray-700 dark:bg-gray-300 rounded-b-lg overflow-hidden">
        <div
          className="h-full bg-blue-500 dark:bg-blue-600 transition-all duration-100 ease-linear"
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
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
};
