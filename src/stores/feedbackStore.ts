import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { durableStorage } from '@/lib/persistentStore';

/**
 * Action-feedback signal.
 *
 * Learns from how the user actually acts on each sender so prioritization adapts
 * instead of relying purely on aidenBrain's static severity ladder. Dismissing or
 * archiving a sender repeatedly *without* replying pushes their items down; replying
 * nudges them up. The adjustment is bounded so it tunes ranking rather than dominating
 * it, and it's persisted across sessions.
 */
export type FeedbackAction = 'dismiss' | 'archive' | 'reply';

interface SenderSignal {
  dismiss: number;
  archive: number;
  reply: number;
}

interface FeedbackState {
  signals: Record<string, SenderSignal>;
  /** Record an action against a sender (accepts a raw "Name <addr>" or bare address). */
  record: (sender: string | undefined, action: FeedbackAction) => void;
  /** Severity adjustment for a sender's items: negative = deprioritize, positive = boost. */
  priorFor: (email: string | undefined) => number;
}

// Extract a normalized email address from a raw "Name <addr>" sender or bare address.
const norm = (raw?: string): string => {
  if (!raw) return '';
  const m = raw.match(/<([^>]+)>/);
  return (m ? m[1] : raw).trim().toLowerCase();
};

export const useFeedbackStore = create<FeedbackState>()(
  persist(
    (set, get) => ({
      signals: {},
      record: (sender, action) => {
        const key = norm(sender);
        if (!key) return;
        set((state) => {
          const cur = state.signals[key] || { dismiss: 0, archive: 0, reply: 0 };
          return { signals: { ...state.signals, [key]: { ...cur, [action]: cur[action] + 1 } } };
        });
      },
      priorFor: (email) => {
        const s = get().signals[norm(email)];
        if (!s) return 0;
        // Replies signal "this sender matters"; dismiss/archive signal "this is noise".
        // Weighted and clamped so feedback tunes the ranking without overriding it.
        const adjust = s.reply * 4 - (s.dismiss + s.archive) * 6;
        return Math.max(-25, Math.min(15, adjust));
      },
    }),
    { name: 'aiden-feedback', storage: createJSONStorage(() => durableStorage) },
  ),
);
