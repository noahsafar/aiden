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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import { useEmailStore } from '@/stores/emailStore';
import { useCommitmentStore } from '@/stores/commitmentStore';
import { PersonAvatar } from '@/components/aiden/primitives';
import logo from '/aiden-logo.png';

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
  const commitments = useCommitmentStore((s) => s.commitments);

  // Count only what the Inbox list actually shows (unread emails) so the badge
  // matches the surface. Slack lives in its own channel, not this email count.
  const inboxUnread = useMemo(
    () =>
      emails.filter(
        (e: any) => !e.is_read && e.status !== 'Archived' && e.status !== 'Saved' && e.status !== 'Deleted',
      ).length,
    [emails],
  );

  const overdueCount = useMemo(
    () =>
      commitments.filter(
        (c) => c.status === 'open' && c.direction === 'you_owe' && c.dueDate && new Date(c.dueDate).getTime() < Date.now(),
      ).length,
    [commitments],
  );

  const navItems: NavItem[] = [
    { to: '/today', label: 'Today', icon: Home },
    { to: '/relationships', label: 'Relationships', icon: Users },
    { to: '/schedule', label: 'Schedule', icon: CalendarDays },
    { to: '/commitments', label: 'Commitments', icon: CheckCircle2, badge: overdueCount, badgeTone: 'rose' },
    { to: '/inbox', label: 'Inbox', icon: InboxIcon, badge: inboxUnread, badgeTone: 'neutral' },
    { to: '/ask', label: 'Ask', icon: Sparkles },
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {/* ---- Left rail ---- */}
      <nav className="flex w-[236px] flex-shrink-0 flex-col border-r border-gray-200/70 bg-gray-50/60 backdrop-blur-xl dark:border-white/[0.06] dark:bg-[#0c0e14]/80">
        {/* Brand */}
        <div className="flex items-center gap-2.5 px-5 py-4">
          <img src={logo} alt="Aiden" className="h-7 w-7" />
          <span className="text-[17px] font-semibold tracking-tight">Aiden</span>
        </div>

        {/* Nav */}
        <div className="mt-3 flex-1 space-y-0.5 px-3">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] font-medium transition-all duration-200',
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
                  <span className="flex-1">{item.label}</span>
                  {item.badge !== undefined && item.badge > 0 && (
                    <span
                      className={cn(
                        'min-w-[20px] rounded-full px-1.5 py-0.5 text-center text-[11px] font-semibold tabular-nums',
                        item.badgeTone === 'rose'
                          ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                          : 'bg-gray-200 text-gray-600 dark:bg-white/10 dark:text-gray-300',
                      )}
                    >
                      {item.badge}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </div>

        {/* Profile / settings — fixed height so its divider aligns with the Ask composer */}
        <div className="flex h-[72px] items-center border-t border-gray-200/70 px-3 dark:border-white/[0.06]">
          <div className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2">
            <PersonAvatar name={user?.name} email={user?.email} size={32} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-foreground">{user?.name || 'You'}</div>
              <div className="truncate text-[11px] text-muted">{user?.email || ''}</div>
            </div>
            <button
              onClick={() => navigate('/settings')}
              title="Settings"
              className="rounded-lg p-1.5 text-muted transition-colors hover:bg-gray-100 hover:text-foreground dark:hover:bg-white/[0.06]"
            >
              <SettingsIcon className="h-4 w-4" />
            </button>
            <button
              onClick={signOut}
              title="Sign out"
              className="rounded-lg p-1.5 text-muted transition-colors hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10 dark:hover:text-rose-400"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </nav>

      {/* ---- Content ---- */}
      <main className="flex-1 overflow-hidden">
        {bleed ? (
          <div className="h-full overflow-hidden">{children}</div>
        ) : (
          // scrollbar-gutter: stable reserves the scrollbar's space even when the
          // page doesn't overflow, so switching filters doesn't shift content sideways.
          <div className="h-full overflow-y-auto [scrollbar-gutter:stable]">
            <div className="mx-auto max-w-5xl px-8 py-10">{children}</div>
          </div>
        )}
      </main>
    </div>
  );
};
