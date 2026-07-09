import { useEffect } from 'react';
import { useEmailStore } from '@/stores/emailStore';
import { useCommitmentStore } from '@/stores/commitmentStore';
import { isOverdue } from '@/lib/commitments';

/**
 * Proactive morning brief — turns Aiden from a tool you open into an assistant
 * that reaches out. Once a day, at a user-set time, it fires a desktop
 * notification summarizing what needs you: messages, open loops, overdue items.
 *
 * Config lives in localStorage (a Settings toggle can write these):
 *   aiden_brief_enabled  "true" | "false"   (default on)
 *   aiden_brief_time     "HH:MM" local      (default 08:00)
 *   aiden_brief_last     "YYYY-MM-DD"        (guard: once per day)
 */

const ENABLED_KEY = 'aiden_brief_enabled';
const TIME_KEY = 'aiden_brief_time';
const LAST_KEY = 'aiden_brief_last';
// If the app first opens long after the scheduled time, skip today rather than
// firing a "morning" brief in the evening.
const STALE_WINDOW_MS = 8 * 60 * 60 * 1000;

function localDateStr(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function composeBrief(): { title: string; body: string } {
  const emails = useEmailStore.getState().emails || [];
  const commitments = useCommitmentStore.getState().commitments || [];

  const needs = emails.filter(
    (e: any) =>
      !['Deleted', 'Archived', 'Saved', 'Replied'].includes(e.status) &&
      !e.attention_dismissed &&
      (e.requires_reply === true || e.category === 'Urgent' || e.category === 'Important'),
  ).length;

  const owe = commitments.filter((c) => c.status === 'open' && c.direction === 'you_owe');
  const overdue = owe.filter((c) => isOverdue(c)).length;

  const parts: string[] = [];
  if (needs > 0) parts.push(`${needs} message${needs === 1 ? '' : 's'} need${needs === 1 ? 's' : ''} you`);
  if (owe.length > 0) parts.push(`${owe.length} open loop${owe.length === 1 ? '' : 's'}`);
  if (overdue > 0) parts.push(`${overdue} overdue`);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const body = parts.length ? parts.join(' · ') : "You're all clear — nothing pressing.";
  return { title: `${greeting} — here's your day`, body };
}

async function fireBrief(title: string, body: string): Promise<void> {
  try {
    const plugin = await import('@tauri-apps/plugin-notification');
    let granted = await plugin.isPermissionGranted();
    if (!granted) granted = (await plugin.requestPermission()) === 'granted';
    if (granted) await plugin.sendNotification({ title, body, icon: '/icons/icon.png' });
  } catch {
    /* not in Tauri / permission denied — silently skip */
  }
}

export function useMorningBrief(): void {
  useEffect(() => {
    const check = () => {
      if (localStorage.getItem(ENABLED_KEY) === 'false') return;
      const today = localDateStr();
      if (localStorage.getItem(LAST_KEY) === today) return; // already handled today

      const [h, m] = (localStorage.getItem(TIME_KEY) || '08:00').split(':').map((n) => parseInt(n, 10));
      const now = new Date();
      const due = new Date(now);
      due.setHours(Number.isFinite(h) ? h : 8, Number.isFinite(m) ? m : 0, 0, 0);

      if (now.getTime() < due.getTime()) return; // not yet today

      // Mark today handled either way so we fire at most once per day.
      localStorage.setItem(LAST_KEY, today);
      if (now.getTime() - due.getTime() > STALE_WINDOW_MS) return; // opened too late — skip, don't nag

      const { title, body } = composeBrief();
      fireBrief(title, body);
    };

    check();
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
  }, []);
}
