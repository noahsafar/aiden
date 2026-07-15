import React, { useMemo } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Home,
  Users,
  CalendarDays,
  CheckCircle2,
  Inbox as InboxIcon,
  Sparkles,
  Settings as SettingsIcon,
  LogOut,
  Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import { useEmailStore } from '@/stores/emailStore';
import { useCommitmentStore } from '@/stores/commitmentStore';
import { useChannelStore } from '@/stores/channelStore';
import { PersonAvatar } from '@/components/aiden/primitives';
import { CommandPalette } from '@/components/aiden/CommandPalette';
import { StatusBanner } from '@/components/aiden/StatusBanner';
import { useMorningBrief } from '@/components/aiden/useMorningBrief';
// Aiden wordmark is rendered inline (theme-aware) in the rail — no raster asset.

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
  badgeTone?: 'neutral' | 'rose';
}

/**
 * AidenShell — the global frame for the second-brain experience.
 * A single, calm left rail with six surfaces. Everything else (settings, life
 * intel) lives behind the profile control so the primary navigation stays
 * uncluttered, the way Linear / Notion keep their chrome quiet.
 */
export const AidenShell: React.FC<{ children: React.ReactNode; bleed?: boolean }> = ({
  children,
  bleed = false,
}) => {
  const navigate = useNavigate();
  const { user, signOut } = useAuthStore();
  const emails = useEmailStore((s) => s.emails);
  const channelMessages = useChannelStore((s) => s.channelMessages);
  const commitments = useCommitmentStore((s) => s.commitments);
  const aiProcessing = useEmailStore((s) => s.aiProcessing);
  const aiBusy = aiProcessing.active + aiProcessing.queued;

  // Once-a-day proactive desktop brief (reaches out instead of waiting to be opened).
  useMorningBrief();

  // Mirror the Inbox "Needs you" count exactly — what actually needs a response
  // across every channel, not just unread email. (Same logic as Inbox.isActionable.)
  const inboxUnread = useMemo(() => {
    const emailNeeds = emails.filter(
      (e: any) =>
        !['Deleted', 'Archived', 'Saved', 'Replied'].includes(e.status) &&
        !e.attention_dismissed &&
        (e.requires_reply === true || e.category === 'Urgent' || e.category === 'Important'),
    ).length;
    const channelNeeds = channelMessages.filter((m) => !m.outgoing && m.unread && m.priority !== 'low').length;
    return emailNeeds + channelNeeds;
  }, [emails, channelMessages]);

  // Open promises you owe — shown as a count next to Commitments (red if any overdue).
  const openCommitmentCount = useMemo(
    () => commitments.filter((c) => c.status === 'open' && c.direction === 'you_owe').length,
    [commitments],
  );
  const hasOverdue = useMemo(
    () =>
      commitments.some(
        (c) => c.status === 'open' && c.direction === 'you_owe' && c.dueDate && new Date(c.dueDate).getTime() < Date.now(),
      ),
    [commitments],
  );

  const navItems: NavItem[] = [
    { to: '/today', label: 'Today', icon: Home },
    { to: '/relationships', label: 'Relationships', icon: Users },
    { to: '/schedule', label: 'Schedule', icon: CalendarDays },
    { to: '/commitments', label: 'Commitments', icon: CheckCircle2, badge: openCommitmentCount, badgeTone: hasOverdue ? 'rose' : 'neutral' },
    { to: '/inbox', label: 'Inbox', icon: InboxIcon, badge: inboxUnread, badgeTone: 'neutral' },
    { to: '/ask', label: 'Ask', icon: Sparkles },
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {/* ---- Left rail ---- */}
      {/* Below lg (~1024px, e.g. a narrow window or split-screen) the rail
          collapses to an icon-only strip so content keeps its width. */}
      <nav className="flex w-[68px] flex-shrink-0 flex-col border-r border-gray-200/70 bg-gray-50/60 backdrop-blur-xl transition-[width] duration-200 lg:w-[236px] dark:border-white/[0.06] dark:bg-[#0c0e14]/80">
        {/* Brand — the wordmark is drawn for light backgrounds ("den" is near-black),
            so in dark mode invert lightness while keeping hue, or it disappears.
            Collapsed rail shows a compact mark instead of the wide wordmark. */}
        <div className="flex items-center justify-center px-3 py-4 lg:justify-start lg:px-5">
          <span className="hidden items-center text-foreground lg:flex" aria-label="Aiden">
            <svg viewBox="0 0 480 140" className="h-7 w-auto" role="img" aria-hidden="true">
              <defs>
                <linearGradient id="aidenWordmarkAi" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#38BDF8" />
                  <stop offset="100%" stopColor="#6366F1" />
                </linearGradient>
              </defs>
              <text
                x="0"
                y="105"
                fontFamily="Inter, 'SF Pro Display', system-ui, -apple-system, sans-serif"
                fontSize="120"
                fontWeight="800"
                letterSpacing="-4"
              >
                <tspan fill="url(#aidenWordmarkAi)">Ai</tspan>
                <tspan fill="currentColor">den</tspan>
              </text>
            </svg>
          </span>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-indigo-500 lg:hidden" aria-hidden="true">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
        </div>

        {/* Global search — opens the ⌘K palette */}
        <button
          onClick={() => window.dispatchEvent(new Event('aiden:command-palette'))}
          aria-label="Open command palette"
          title="Search (⌘K)"
          className="mx-3 flex items-center justify-center gap-2 rounded-xl border border-gray-200/70 bg-white/50 px-3 py-2 text-[13px] text-muted transition-colors hover:text-foreground lg:justify-start dark:border-white/[0.07] dark:bg-white/[0.03]"
        >
          <Search className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="hidden flex-1 text-left lg:block">Search…</span>
          <kbd className="hidden rounded bg-gray-200/70 px-1.5 py-0.5 text-[10px] font-semibold text-muted lg:inline dark:bg-white/10">⌘K</kbd>
        </button>

        {/* Nav */}
        <div className="mt-3 flex-1 space-y-0.5 px-3">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              title={item.label}
              className={({ isActive }) =>
                cn(
                  'group relative flex items-center justify-center gap-3 rounded-xl px-3 py-2.5 text-[14px] font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 lg:justify-start',
                  isActive
                    ? 'bg-white text-foreground shadow-elevated-sm dark:bg-white/[0.08]'
                    : 'text-muted hover:bg-gray-100/80 hover:text-foreground dark:hover:bg-white/[0.04]',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon
                    className={cn(
                      'h-[18px] w-[18px] flex-shrink-0 transition-colors',
                      isActive ? 'text-violet-500 dark:text-violet-400' : 'text-muted group-hover:text-foreground',
                    )}
                  />
                  <span className="hidden flex-1 lg:block">{item.label}</span>
                  {item.badge !== undefined && item.badge > 0 && (
                    <>
                      {/* Full pill when expanded; a corner dot when collapsed. */}
                      <span
                        className={cn(
                          'hidden min-w-[20px] rounded-full px-1.5 py-0.5 text-center text-[11px] font-semibold tabular-nums lg:block',
                          item.badgeTone === 'rose'
                            ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                            : 'bg-gray-200 text-gray-600 dark:bg-white/10 dark:text-gray-300',
                        )}
                      >
                        {item.badge}
                      </span>
                      <span
                        className={cn(
                          'absolute right-1.5 top-1.5 h-2 w-2 rounded-full lg:hidden',
                          item.badgeTone === 'rose' ? 'bg-rose-500' : 'bg-gray-400 dark:bg-gray-500',
                        )}
                      />
                    </>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </div>

        {/* AI activity — a quiet, honest signal that Aiden is working through new
            mail. Hidden on the collapsed rail (the text needs room); the ⌘K
            palette / Today still surface progress there. */}
        {aiBusy > 0 && (
          <div className="mx-3 mb-2 hidden items-center gap-2 rounded-xl bg-violet-50/70 px-3 py-2 lg:flex dark:bg-violet-500/[0.08]">
            <Sparkles className="h-3.5 w-3.5 flex-shrink-0 animate-pulse text-violet-500" />
            <span className="truncate text-[12px] text-muted">
              Analyzing {aiBusy} message{aiBusy !== 1 ? 's' : ''}…
            </span>
          </div>
        )}

        {/* Profile / settings — fixed height so its divider aligns with the Ask
            composer. Collapses to avatar + gear (sign-out lives in Settings too). */}
        <div className="flex min-h-[72px] items-center border-t border-gray-200/70 px-3 py-2 dark:border-white/[0.06]">
          <div className="flex w-full flex-col items-center gap-2 rounded-xl px-0 py-1 lg:flex-row lg:gap-2.5 lg:px-2 lg:py-2">
            <PersonAvatar name={user?.name} email={user?.email} size={32} />
            <div className="hidden min-w-0 flex-1 lg:block">
              <div className="truncate text-[13px] font-medium text-foreground">{user?.name || 'You'}</div>
              <div className="truncate text-[11px] text-muted">{user?.email || ''}</div>
            </div>
            <button
              onClick={() => navigate('/settings')}
              title="Settings"
              aria-label="Settings"
              className="rounded-lg p-1.5 text-muted transition-colors hover:bg-gray-100 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 dark:hover:bg-white/[0.06]"
            >
              <SettingsIcon className="h-4 w-4" />
            </button>
            <button
              onClick={signOut}
              title="Sign out"
              aria-label="Sign out"
              className="hidden rounded-lg p-1.5 text-muted transition-colors hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 lg:block dark:hover:bg-rose-500/10 dark:hover:text-rose-400"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </nav>

      {/* ---- Content ---- */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* Honest system-health bar — silent unless a subsystem is down */}
        <StatusBanner />

        <div className="min-h-0 flex-1">
          {bleed ? (
            <div className="h-full overflow-hidden">{children}</div>
          ) : (
            // scrollbar-gutter: stable reserves the scrollbar's space even when the
            // page doesn't overflow, so switching filters doesn't shift content sideways.
            <div className="h-full overflow-y-auto [scrollbar-gutter:stable]">
              <div className="mx-auto max-w-5xl px-8 py-10">{children}</div>
            </div>
          )}
        </div>
      </main>

      {/* Global ⌘K command palette — search, jump, compose, or ask from anywhere */}
      <CommandPalette />
    </div>
  );
};
