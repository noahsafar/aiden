import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Hide the default header (caller renders its own chrome). */
  hideHeader?: boolean;
  className?: string;
}

const SIZES: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
};

/**
 * Shared modal shell: portal to <body> (so the backdrop is viewport-relative),
 * click-outside + Esc to close, focus moved into the dialog, tokenized surface.
 * One place to get the chrome + a11y right, instead of each modal reinventing it.
 */
export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  size = 'lg',
  hideHeader = false,
  className = '',
}) => {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const t = setTimeout(() => panelRef.current?.focus(), 0);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(t);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className={cn(
          'flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-elevated-lg outline-none animate-scale-in',
          SIZES[size],
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {!hideHeader && (
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 className="text-lg font-semibold text-foreground">{title}</h2>
            <button
              onClick={onClose}
              aria-label="Close"
              className="rounded-lg p-1.5 text-muted transition-colors hover:bg-gray-100 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 dark:hover:bg-white/[0.06]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
};

export default Modal;
