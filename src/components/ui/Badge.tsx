import React, { forwardRef } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// Badge variants with Apple-style aesthetics
const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'bg-primary-100 text-primary-800 dark:bg-primary-800/30 dark:text-primary-200',
        secondary: 'bg-gray-100 text-gray-800 dark:bg-gray-800/30 dark:text-gray-200',
        success: 'bg-success-100 text-success-800 dark:bg-success-800/30 dark:text-success-200',
        warning: 'bg-warning-100 text-warning-800 dark:bg-warning-800/30 dark:text-warning-200',
        error: 'bg-error-100 text-error-800 dark:bg-error-800/30 dark:text-error-200',
        ai: 'bg-ai-100 text-ai-800 dark:bg-ai-800/30 dark:text-ai-200 animate-pulse-subtle',
        outline: 'border border-gray-200 text-gray-800 dark:border-gray-700 dark:text-gray-200',
      },
      size: {
        sm: 'px-2 py-0.5 text-xs',
        md: 'px-2.5 py-0.5 text-xs',
        lg: 'px-3 py-1 text-sm',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean;
}

const Badge = forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant, size, dot = false, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(badgeVariants({ variant, size }), className)}
        {...props}
      >
        {dot && (
          <span
            className={cn(
              'mr-1.5 h-2 w-2 rounded-full',
              {
                'bg-primary-600': variant === 'default',
                'bg-gray-600': variant === 'secondary',
                'bg-success-600': variant === 'success',
                'bg-warning-600': variant === 'warning',
                'bg-error-600': variant === 'error',
                'bg-ai-600': variant === 'ai',
              }
            )}
          />
        )}
        {children}
      </div>
    );
  }
);

Badge.displayName = 'Badge';

export { Badge, badgeVariants };