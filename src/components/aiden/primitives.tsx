import React from 'react';
import { cn } from '@/lib/utils';
import { Sparkles, ArrowRight } from 'lucide-react';

/**
 * Aiden design primitives — the calm, premium building blocks shared by every
 * new surface (Today, Relationships, Commitments, Ask, Schedule).
 *
 * Design language: Apple Vision Pro / Linear / Notion. Lots of whitespace,
 * soft surfaces, subtle AI cues, dark-mode-first. Built on the existing
 * Tailwind tokens (bg-surface, text-muted, border-border, shadow-elevated-*).
 */

/* ------------------------------------------------------------------ */
/* Surface — the base card                                            */
/* ------------------------------------------------------------------ */

interface SurfaceProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  /** subtle = flat translucent; raised = elevated card; outline = bordered */
  tone?: 'subtle' | 'raised' | 'outline';
  interactive?: boolean;
  accent?: 'none' | 'attention' | 'opportunity' | 'ai';
}

export const Surface: React.FC<SurfaceProps> = ({
  children,
  tone = 'raised',
  interactive = false,
  accent = 'none',
  className = '',
  ...props
}) => {
  const tones: Record<string, string> = {
    subtle: 'bg-gray-50/70 dark:bg-white/[0.03] border border-gray-200/50 dark:border-white/[0.06]',
    raised: 'bg-white dark:bg-white/[0.04] border border-gray-200/70 dark:border-white/[0.07] shadow-elevated-sm',
    outline: 'bg-transparent border border-gray-200 dark:border-white/10',
  };
  const accents: Record<string, string> = {
    none: '',
    attention: 'ring-1 ring-rose-500/15 dark:ring-rose-400/15',
    opportunity: 'ring-1 ring-emerald-500/15 dark:ring-emerald-400/15',
    ai: 'ring-1 ring-violet-500/15 dark:ring-violet-400/15',
  };
  return (
    <div
      className={cn(
        'rounded-2xl transition-all duration-300',
        tones[tone],
        accents[accent],
        interactive && 'cursor-pointer hover:shadow-elevated-md hover:-translate-y-px hover:border-gray-300/80 dark:hover:border-white/15',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* SectionLabel — the quiet divider headers ("Needs your attention")  */
/* ------------------------------------------------------------------ */

interface SectionLabelProps {
  children: React.ReactNode;
  icon?: React.ReactNode;
  /** colored status dot */
  dot?: 'rose' | 'emerald' | 'amber' | 'violet' | 'sky' | 'none';
  count?: number;
  action?: React.ReactNode;
  /** tighter bottom margin (mb-3) for compact groupings */
  dense?: boolean;
  className?: string;
}

export const SectionLabel: React.FC<SectionLabelProps> = ({
  children,
  icon,
  dot = 'none',
  count,
  action,
  dense = false,
  className = '',
}) => {
  const dots: Record<string, string> = {
    rose: 'bg-rose-500',
    emerald: 'bg-emerald-500',
    amber: 'bg-amber-500',
    violet: 'bg-violet-500',
    sky: 'bg-sky-500',
    none: '',
  };
  return (
    <div className={cn('flex items-center justify-between', dense ? 'mb-3' : 'mb-4', className)}>
      <div className="flex items-center gap-2.5">
        {dot !== 'none' && <span className={cn('h-2 w-2 rounded-full', dots[dot])} />}
        {icon && <span className="text-muted">{icon}</span>}
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">
          {children}
        </h2>
        {typeof count === 'number' && count > 0 && (
          <span className="text-[11px] font-medium text-muted/70 tabular-nums">{count}</span>
        )}
      </div>
      {action}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* StrengthBar — relationship strength meter                          */
/* ------------------------------------------------------------------ */

export const StrengthBar: React.FC<{ value: number; className?: string; showLabel?: boolean }> = ({
  value,
  className = '',
  showLabel = false,
}) => {
  const pct = Math.max(0, Math.min(100, value));
  const segments = 10;
  const filled = Math.round((pct / 100) * segments);
  const color =
    pct >= 75 ? 'bg-emerald-500' : pct >= 50 ? 'bg-sky-500' : pct >= 30 ? 'bg-amber-500' : 'bg-gray-400 dark:bg-gray-600';
  const label = pct >= 75 ? 'Strong' : pct >= 50 ? 'Good' : pct >= 30 ? 'Moderate' : 'Weak';
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="flex gap-[3px]">
        {Array.from({ length: segments }).map((_, i) => (
          <span
            key={i}
            className={cn(
              'h-3.5 w-[5px] rounded-full transition-colors',
              i < filled ? color : 'bg-gray-200 dark:bg-white/10',
            )}
          />
        ))}
      </div>
      {showLabel && <span className="text-xs font-medium text-muted">{label}</span>}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Pill / Chip                                                        */
/* ------------------------------------------------------------------ */

interface PillProps {
  children: React.ReactNode;
  tone?: 'neutral' | 'rose' | 'emerald' | 'amber' | 'violet' | 'sky';
  className?: string;
  icon?: React.ReactNode;
}

export const Pill: React.FC<PillProps> = ({ children, tone = 'neutral', className = '', icon }) => {
  const tones: Record<string, string> = {
    neutral: 'bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-gray-300',
    rose: 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300',
    emerald: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
    violet: 'bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300',
    sky: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium',
        tones[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
};

/* ------------------------------------------------------------------ */
/* SoftButton — quiet action buttons used inside cards                */
/* ------------------------------------------------------------------ */

interface SoftButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  variant?: 'primary' | 'soft' | 'ghost';
  icon?: React.ReactNode;
}

export const SoftButton: React.FC<SoftButtonProps> = ({
  children,
  variant = 'soft',
  icon,
  className = '',
  ...props
}) => {
  const variants: Record<string, string> = {
    primary: 'bg-gray-900 text-white hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100',
    soft: 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-white/[0.07] dark:text-gray-200 dark:hover:bg-white/[0.12]',
    ghost: 'text-muted hover:text-foreground hover:bg-gray-100 dark:hover:bg-white/[0.06]',
  };
  return (
    <button
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-all duration-200 disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-gray-900',
        variants[variant],
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
};

/* ------------------------------------------------------------------ */
/* AiSuggestion — the subtle "AIDEN suggests" cue                     */
/* ------------------------------------------------------------------ */

export const AiSuggestion: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = '',
}) => (
  <div
    className={cn(
      'flex items-start gap-2.5 rounded-xl bg-violet-50/60 px-3.5 py-2.5 dark:bg-violet-500/[0.07]',
      className,
    )}
  >
    <Sparkles className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-violet-500 dark:text-violet-400" />
    <p className="text-[13px] leading-relaxed text-violet-900/80 dark:text-violet-200/90">{children}</p>
  </div>
);

/* ------------------------------------------------------------------ */
/* EmptyState                                                         */
/* ------------------------------------------------------------------ */

export const EmptyState: React.FC<{
  icon?: React.ReactNode;
  title: string;
  description?: string;
  className?: string;
  children?: React.ReactNode;
}> = ({ icon, title, description, className = '', children }) => (
  <div className={cn('flex flex-col items-center justify-center px-8 py-16 text-center', className)}>
    {icon && (
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-muted dark:bg-white/[0.05]">
        {icon}
      </div>
    )}
    <h3 className="text-base font-semibold text-foreground">{title}</h3>
    {description && <p className="mt-1.5 max-w-sm text-sm text-muted">{description}</p>}
    {children && <div className="mt-5">{children}</div>}
  </div>
);

/* ------------------------------------------------------------------ */
/* Skeleton — shimmer placeholders so loading feels instant, not stuck */
/* ------------------------------------------------------------------ */

export const Skeleton: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={cn('animate-pulse rounded-md bg-gray-200/70 dark:bg-white/[0.08]', className)} aria-hidden="true" />
);

/** A few stacked card skeletons that echo a list while its data loads. */
export const SkeletonRows: React.FC<{ rows?: number; className?: string }> = ({ rows = 3, className = '' }) => (
  <div className={cn('space-y-3', className)} role="status" aria-label="Loading">
    {Array.from({ length: rows }).map((_, i) => (
      <div
        key={i}
        className="rounded-2xl border border-gray-200/70 bg-white p-5 dark:border-white/[0.07] dark:bg-white/[0.04]"
      >
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      </div>
    ))}
    <span className="sr-only">Loading…</span>
  </div>
);

/* ------------------------------------------------------------------ */
/* SurfaceHeader — large page header used by each surface             */
/* ------------------------------------------------------------------ */

export const SurfaceHeader: React.FC<{
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}> = ({ title, subtitle, actions, className = '' }) => (
  <div className={cn('flex items-end justify-between gap-4', className)}>
    <div>
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">{title}</h1>
      {subtitle && <p className="mt-1.5 text-[15px] text-muted">{subtitle}</p>}
    </div>
    {actions && <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>}
  </div>
);

/* ------------------------------------------------------------------ */
/* PersonAvatar — initials avatar with optional gradient seed         */
/* ------------------------------------------------------------------ */

export const PersonAvatar: React.FC<{
  name?: string;
  email?: string;
  size?: number;
  className?: string;
}> = ({ name, email, size = 40, className = '' }) => {
  const display = (name || email || '?').trim();
  const initials = display
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('') || display[0]?.toUpperCase() || '?';

  // deterministic gradient from the seed string
  const seed = (email || name || '?').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const gradients = [
    'from-violet-500 to-indigo-500',
    'from-sky-500 to-blue-500',
    'from-emerald-500 to-teal-500',
    'from-amber-500 to-orange-500',
    'from-rose-500 to-pink-500',
    'from-fuchsia-500 to-purple-500',
  ];
  const grad = gradients[seed % gradients.length];

  return (
    <div
      className={cn(
        'flex flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-semibold text-white shadow-sm',
        grad,
        className,
      )}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* LinkRow — a quiet "see all" row                                    */
/* ------------------------------------------------------------------ */

export const LinkRow: React.FC<{ children: React.ReactNode; onClick?: () => void; className?: string }> = ({
  children,
  onClick,
  className = '',
}) => (
  <button
    onClick={onClick}
    className={cn(
      'group inline-flex items-center gap-1 text-[13px] font-medium text-muted transition-colors hover:text-foreground',
      className,
    )}
  >
    {children}
    <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
  </button>
);

/* small helper for relative time strings */
export function relativeTime(input?: string | number | null): string {
  if (!input) return '';
  const date = typeof input === 'number' ? new Date(input) : new Date(input);
  const ms = Date.now() - date.getTime();
  if (Number.isNaN(ms)) return '';
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

export function shortDate(input?: string | number | null): string {
  if (!input) return '';
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
