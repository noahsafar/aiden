import React, { forwardRef } from 'react';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { cn } from '@/lib/utils';

// Root Avatar component with Apple-style defaults
const Avatar = forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Root
    ref={ref}
    className={cn(
      'relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full border-2 border-white/20 dark:border-gray-700/20',
      className
    )}
    {...props}
  />
));

Avatar.displayName = AvatarPrimitive.Root.displayName;

// Avatar image with smooth loading transitions
const AvatarImage = forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Image>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Image
    ref={ref}
    className={cn(
      'aspect-square h-full w-full object-cover transition-opacity duration-200',
      className
    )}
    {...props}
  />
));

AvatarImage.displayName = AvatarPrimitive.Image.displayName;

// Avatar fallback with Apple-style initials
const AvatarFallback = forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback> & {
    delayMs?: number;
  }
>(({ className, delayMs, ...props }, ref) => {
  const [showFallback, setShowFallback] = React.useState(delayMs === undefined);

  React.useEffect(() => {
    if (delayMs !== undefined) {
      const timer = setTimeout(() => setShowFallback(true), delayMs);
      return () => clearTimeout(timer);
    }
  }, [delayMs]);

  if (!showFallback) {
    return <div ref={ref} className={cn('h-full w-full', className)} />;
  }

  return (
    <AvatarPrimitive.Fallback
      ref={ref}
      className={cn(
        'flex h-full w-full items-center justify-center rounded-full bg-gradient-to-br from-gray-100 to-gray-200 text-gray-600 font-medium dark:from-gray-700 dark:to-gray-800 dark:text-gray-300',
        className
      )}
      {...props}
    />
  );
});

AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName;

// Status indicator for online/offline
const AvatarStatus = forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement> & {
    status?: 'online' | 'offline' | 'away' | 'busy';
  }
>(({ className, status = 'online', ...props }, ref) => {
  const statusColors = {
    online: 'bg-success-500 shadow-success-500/30',
    offline: 'bg-gray-400 shadow-gray-400/30',
    away: 'bg-warning-500 shadow-warning-500/30',
    busy: 'bg-error-500 shadow-error-500/30',
  };

  return (
    <span
      ref={ref}
      className={cn(
        'absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white dark:border-gray-900 shadow-lg',
        statusColors[status],
        className
      )}
      {...props}
    />
  );
});

AvatarStatus.displayName = 'AvatarStatus';

export { Avatar, AvatarImage, AvatarFallback, AvatarStatus };