import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Home,
  Users,
  CalendarDays,
  CheckCircle2,
  Inbox as InboxIcon,
  Sparkles,
  Search,
  PenSquare,
  CornerDownLeft,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCrmStore } from '@/stores/crmStore';
import { useAidenActions } from '@/components/aiden/useAidenActions';
import { PersonAvatar } from '@/components/aiden/primitives';

/**
 * ⌘K command palette — the one keystroke that reaches everything: jump to a
 * surface, jump to a person, compose, or ask Aiden. This is also the app's
 * global search, which the per-surface search boxes never added up to.
 */

type Item =
  | { kind: 'route'; id: string; label: string; hint: string; icon: React.ComponentType<{ className?: string }>; run: () => void }
  | { kind: 'person'; id: string; label: string; hint: string; email: string; run: () => void }
  | { kind: 'action'; id: string; label: string; hint: string; icon: React.ComponentType<{ className?: string }>; run: () => void };

export const CommandPalette: React.FC = () => {
  const navigate = useNavigate();
  const act = useAidenActions();
  const contacts = useCrmStore((s) => s.contacts);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global ⌘K / Ctrl+K toggle, plus Esc to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    const onOpenEvent = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('aiden:command-palette', onOpenEvent);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('aiden:command-palette', onOpenEvent);
    };
  }, []);

  // Reset + focus on open.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      // focus after paint
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  const close = () => setOpen(false);

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const go = (to: string) => () => { navigate(to); close(); };

    const routes: Item[] = [
      { kind: 'route' as const, id:'r-today', label: 'Today', hint: 'Your day at a glance', icon: Home, run: go('/today') },
      { kind: 'route' as const, id:'r-rel', label: 'Relationships', hint: 'People & trajectories', icon: Users, run: go('/relationships') },
      { kind: 'route' as const, id:'r-sched', label: 'Schedule', hint: 'Calendar & prep', icon: CalendarDays, run: go('/schedule') },
      { kind: 'route' as const, id:'r-cmt', label: 'Commitments', hint: 'Open loops', icon: CheckCircle2, run: go('/commitments') },
      { kind: 'route' as const, id:'r-inbox', label: 'Inbox', hint: 'Everything that needs you', icon: InboxIcon, run: go('/inbox') },
      { kind: 'route' as const, id:'r-ask', label: 'Ask', hint: 'Ask Aiden anything', icon: Sparkles, run: go('/ask') },
    ].filter((r) => !q || r.label.toLowerCase().includes(q));

    const people: Item[] = q
      ? contacts
          .filter((c) => (c.name || '').toLowerCase().includes(q) || c.email_address.toLowerCase().includes(q))
          .slice(0, 5)
          .map((c) => ({
            kind: 'person' as const,
            id: `p-${c.id}`,
            label: c.name || c.email_address,
            hint: c.email_address,
            email: c.email_address,
            run: () => { act({ action: 'person', payload: { email: c.email_address } }); close(); },
          }))
      : [];

    const actions: Item[] = q
      ? [
          {
            kind: 'action' as const,
            id: 'a-ask',
            label: `Ask Aiden: "${query.trim()}"`,
            hint: 'Answer from your inbox, people & commitments',
            icon: Sparkles,
            run: () => { act({ action: 'ask', payload: { q: query.trim(), run: true } }); close(); },
          },
          {
            kind: 'action' as const,
            id: 'a-compose',
            label: 'Compose a new email',
            hint: 'Open the composer',
            icon: PenSquare,
            run: () => { act({ action: 'compose', payload: {} }); close(); },
          },
        ]
      : [];

    return [...routes, ...people, ...actions];
  }, [query, contacts, navigate, act]);

  // Keep the active index in range as the list changes.
  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, items.length - 1)));
  }, [items.length]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      items[active]?.run();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/30 px-4 pt-[14vh] backdrop-blur-sm"
      onClick={close}
      role="presentation"
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-surface shadow-elevated-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        {/* Search */}
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="h-4 w-4 flex-shrink-0 text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search people, jump to a surface, or ask Aiden…"
            className="flex-1 bg-transparent py-3.5 text-[15px] text-foreground outline-none placeholder:text-muted"
            aria-label="Command palette search"
          />
        </div>

        {/* Results */}
        <div className="max-h-[50vh] overflow-y-auto py-2">
          {items.length === 0 ? (
            <div className="px-4 py-8 text-center text-[13px] text-muted">No matches</div>
          ) : (
            items.map((item, i) => {
              const isActive = i === active;
              return (
                <button
                  key={item.id}
                  onClick={item.run}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
                    isActive ? 'bg-gray-100/80 dark:bg-white/[0.06]' : 'hover:bg-gray-50 dark:hover:bg-white/[0.03]',
                  )}
                >
                  {item.kind === 'person' ? (
                    <PersonAvatar name={item.label} email={item.email} size={26} />
                  ) : (
                    <span className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-muted dark:bg-white/[0.06]">
                      <item.icon className="h-4 w-4" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-foreground">{item.label}</span>
                    <span className="block truncate text-[12px] text-muted">{item.hint}</span>
                  </span>
                  {isActive && <CornerDownLeft className="h-3.5 w-3.5 flex-shrink-0 text-muted/50" />}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;
