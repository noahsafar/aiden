import { create } from 'zustand';
import {
  Commitment,
  CommitmentStatus,
  extractCommitmentsHeuristic,
  isOverdue,
  isDueToday,
} from '@/lib/commitments';
import { extractCommitments as extractCommitmentsAI } from '@/api/aiden';
import { isAutomatedSender, isSelf } from '@/lib/senders';

/**
 * Commitment tracking store.
 *
 * Commitments are *derived* from messages (so they stay in sync with the inbox)
 * but their lifecycle state (done / snoozed / dismissed) is owned by the user
 * and persisted to localStorage, surviving re-extraction.
 */

const OVERRIDES_KEY = 'aiden.commitment.overrides';

interface CommitmentOverride {
  status: CommitmentStatus;
  snoozedUntil?: string;
}

function loadOverrides(): Record<string, CommitmentOverride> {
  try {
    return JSON.parse(localStorage.getItem(OVERRIDES_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveOverrides(o: Record<string, CommitmentOverride>) {
  try {
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify(o));
  } catch {
    /* ignore quota errors */
  }
}

function parseSender(raw: string): { name: string; email?: string } {
  const nameMatch = raw.match(/^(.+?)\s*</);
  const emailMatch = raw.match(/<([^>]+)>/);
  const email = emailMatch?.[1] || (raw.includes('@') ? raw.trim() : undefined);
  const name = (nameMatch?.[1] || raw.split('@')[0] || 'Unknown').replace(/["']/g, '').trim();
  return { name, email };
}

interface CommitmentState {
  commitments: Commitment[];
  isExtracting: boolean;
  lastExtracted: number | null;
  hasExtracted: boolean;

  extract: (useAi?: boolean) => Promise<void>;
  setStatus: (id: string, status: CommitmentStatus, snoozedUntil?: string) => void;
  markDone: (id: string) => void;
  /** When you reply to someone, clear the open promises you owed them in that
   *  thread — unless the reply itself makes a new promise (a deferral). */
  reconcileSentEmail: (opts: { counterpartyEmail?: string; threadId?: string; body: string }) => void;
  snooze: (id: string, days: number) => void;
  dismiss: (id: string) => void;
  reopen: (id: string) => void;
  addManual: (c: Omit<Commitment, 'id' | 'createdAt' | 'status' | 'confidence' | 'source'>) => void;

  getOpen: () => Commitment[];
  getYouOwe: () => Commitment[];
  getTheyOwe: () => Commitment[];
  getOverdue: () => Commitment[];
  getDueToday: () => Commitment[];
}

function applyOverrides(commitments: Commitment[]): Commitment[] {
  const overrides = loadOverrides();
  const now = Date.now();
  return commitments.map((c) => {
    const o = overrides[c.id];
    if (!o) return c;
    // a snooze that has elapsed reverts to open
    if (o.status === 'snoozed' && o.snoozedUntil && new Date(o.snoozedUntil).getTime() < now) {
      return { ...c, status: 'open' };
    }
    return { ...c, status: o.status, snoozedUntil: o.snoozedUntil };
  });
}

export const useCommitmentStore = create<CommitmentState>((set, get) => ({
  commitments: [],
  isExtracting: false,
  lastExtracted: null,
  hasExtracted: false,

  extract: async (useAi = false) => {
    set({ isExtracting: true });
    try {
      const { useEmailStore } = await import('./emailStore');
      const emailStore = useEmailStore.getState();
      const userEmail = (await import('./authStore')).useAuthStore.getState().user?.email;

      // Build extraction inputs from received + sent emails.
      const received = (emailStore.emails || [])
        .filter((e: any) => e.status !== 'Deleted')
        .slice(0, 60)
        .map((e: any) => {
          const { name, email } = parseSender(e.sender || '');
          return {
            id: e.id,
            threadId: e.thread_id || e.id,
            subject: e.subject,
            body: e.body_text || e.snippet || '',
            counterpartyName: name,
            counterpartyEmail: email,
            outgoing: false,
            timestamp: e.date,
          };
        });

      const sent = (emailStore.sentEmails || [])
        .filter((e: any) => e.status !== 'Deleted')
        .slice(0, 40)
        .map((e: any) => {
          const { name, email } = parseSender(e.recipients || '');
          return {
            id: e.id,
            threadId: e.thread_id || e.id,
            subject: e.subject,
            body: e.body_text || e.snippet || '',
            counterpartyName: name || 'Recipient',
            counterpartyEmail: email,
            outgoing: true,
            timestamp: e.date,
          };
        });

      const inputs = [...received, ...sent].filter((i) => {
        if (!i.body) return false;
        // Real people only — no robots, no self, no "Me"/"You" placeholders.
        if (isAutomatedSender(i.counterpartyEmail || i.counterpartyName || '')) return false;
        if (isSelf(i.counterpartyEmail, userEmail)) return false;
        if (/^(me|you|unknown|recipient)$/i.test((i.counterpartyName || '').trim())) return false;
        return true;
      });

      let all: Commitment[] = [];
      if (useAi) {
        // bounded concurrency to avoid hammering the backend
        const chunks: typeof inputs[] = [];
        for (let i = 0; i < inputs.length; i += 4) chunks.push(inputs.slice(i, i + 4));
        for (const chunk of chunks) {
          const res = await Promise.all(chunk.map((i) => extractCommitmentsAI(i)));
          all.push(...res.flat());
        }
      } else {
        all = inputs.flatMap((i) => extractCommitmentsHeuristic(i));
      }

      // de-dupe by id, keep highest confidence
      const byId = new Map<string, Commitment>();
      for (const c of all) {
        const existing = byId.get(c.id);
        if (!existing || c.confidence > existing.confidence) byId.set(c.id, c);
      }

      const withOverrides = applyOverrides([...byId.values()]);
      set({
        commitments: withOverrides,
        isExtracting: false,
        lastExtracted: Date.now(),
        hasExtracted: true,
      });
    } catch (e) {
      console.error('Commitment extraction failed:', e);
      set({ isExtracting: false, hasExtracted: true });
    }
  },

  setStatus: (id, status, snoozedUntil) => {
    const overrides = loadOverrides();
    overrides[id] = { status, snoozedUntil };
    saveOverrides(overrides);
    set((state) => ({
      commitments: state.commitments.map((c) => (c.id === id ? { ...c, status, snoozedUntil } : c)),
    }));
  },

  markDone: (id) => get().setStatus(id, 'done'),

  reconcileSentEmail: ({ counterpartyEmail, threadId, body }) => {
    if (!counterpartyEmail && !threadId) return;
    // If this message itself makes a fresh promise, it's a deferral — keep the loop open.
    const makesNewPromise = extractCommitmentsHeuristic({
      id: 'reconcile',
      threadId: threadId || 'reconcile',
      body,
      counterpartyName: '',
      outgoing: true,
    }).some((c) => c.direction === 'you_owe');
    if (makesNewPromise) return;
    const cp = counterpartyEmail?.toLowerCase();
    const { commitments, markDone } = get();
    commitments
      .filter(
        (c) =>
          c.status === 'open' &&
          c.direction === 'you_owe' &&
          ((threadId && c.threadId === threadId) ||
            (cp && c.counterpartyEmail?.toLowerCase() === cp)),
      )
      .forEach((c) => markDone(c.id));
  },
  dismiss: (id) => get().setStatus(id, 'dismissed'),
  reopen: (id) => get().setStatus(id, 'open'),
  snooze: (id, days) => {
    const until = new Date();
    until.setDate(until.getDate() + days);
    get().setStatus(id, 'snoozed', until.toISOString());
  },

  addManual: (c) => {
    const commitment: Commitment = {
      ...c,
      id: `cmt-manual-${Date.now()}`,
      createdAt: new Date().toISOString(),
      status: 'open',
      confidence: 1,
      source: 'heuristic',
    };
    set((state) => ({ commitments: [commitment, ...state.commitments] }));
  },

  getOpen: () => get().commitments.filter((c) => c.status === 'open'),
  getYouOwe: () => get().commitments.filter((c) => c.status === 'open' && c.direction === 'you_owe'),
  getTheyOwe: () => get().commitments.filter((c) => c.status === 'open' && c.direction === 'they_owe'),
  getOverdue: () => get().commitments.filter((c) => isOverdue(c)),
  getDueToday: () => get().commitments.filter((c) => c.status === 'open' && isDueToday(c)),
}));
