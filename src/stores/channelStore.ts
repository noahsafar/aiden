import { create } from 'zustand';

/**
 * Channel abstraction for the unified Inbox.
 *
 * Aiden's Inbox is designed to be the single place where *everything* lands —
 * email today, Slack/Teams/etc. tomorrow. Rather than special-casing each
 * integration in the UI, every source implements the same `UnifiedMessage`
 * shape and registers as a `Channel`. The Inbox renders channels generically.
 *
 * - Email is wired live (sourced from emailStore — see `selectEmailMessages`).
 * - Slack ships as a *mock* channel so the unified experience is complete in
 *   demos. Wiring real Slack is a drop-in: implement the OAuth exchange
 *   (mirroring the Gmail flow in the Python OAuth server), fetch messages, map
 *   them to `UnifiedMessage`, and flip `connected: true`. See SLACK_SETUP below.
 */

export type ChannelId = 'email' | 'slack';

export interface UnifiedMessage {
  id: string;
  channel: ChannelId;
  /** thread/conversation grouping key */
  threadId: string;
  authorName: string;
  authorHandle?: string; // email address or @handle
  /** title for email (subject); channel name for slack ("#growth") */
  title: string;
  preview: string;
  timestamp: string; // ISO
  unread: boolean;
  /** whether this came from the user (outgoing) */
  outgoing: boolean;
  priority?: 'high' | 'medium' | 'low';
  /** original source object for click-through */
  raw?: unknown;
}

export interface Channel {
  id: ChannelId;
  label: string;
  /** lucide icon name handled by the consumer; we keep it data-only here */
  connected: boolean;
  /** false for mock/preview integrations */
  live: boolean;
  accent: string; // tailwind text color class
}

interface ChannelState {
  channels: Channel[];
  slackMessages: UnifiedMessage[];
  activeChannel: ChannelId | 'all';
  setActiveChannel: (c: ChannelId | 'all') => void;
  connectChannel: (id: ChannelId) => void;
  /** returns slack mock messages (email is read live from emailStore by the consumer) */
  getSlackMessages: () => UnifiedMessage[];
  markSlackRead: (id: string) => void;
}

/* ------------------------------------------------------------------ */
/* Mock Slack data — realistic, derived from the same fictional world  */
/* as the sample emails (Acme, investors, hiring, etc.)                */
/* ------------------------------------------------------------------ */

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3600 * 1000).toISOString();
}

const MOCK_SLACK: UnifiedMessage[] = [
  {
    id: 'slack-1',
    channel: 'slack',
    threadId: 'slack-growth',
    authorName: 'Priya Nair',
    authorHandle: '@priya',
    title: '#growth',
    preview: 'Hey — can you review the Q2 pipeline deck before the investor call? Left comments on slide 7.',
    timestamp: hoursAgo(1.5),
    unread: true,
    outgoing: false,
    priority: 'high',
  },
  {
    id: 'slack-2',
    channel: 'slack',
    threadId: 'slack-dm-marcus',
    authorName: 'Marcus Lee',
    authorHandle: '@marcus',
    title: 'Direct message',
    preview: 'Are we still on for the 1:1 tomorrow? Wanted to talk through the VP Sales shortlist.',
    timestamp: hoursAgo(3),
    unread: true,
    outgoing: false,
    priority: 'medium',
  },
  {
    id: 'slack-3',
    channel: 'slack',
    threadId: 'slack-eng',
    authorName: 'Dana Whitfield',
    authorHandle: '@dana',
    title: '#engineering',
    preview: 'Shipped the onboarding speedup — p95 down 40%. Acme will be happy 🎉',
    timestamp: hoursAgo(6),
    unread: false,
    outgoing: false,
    priority: 'low',
  },
  {
    id: 'slack-4',
    channel: 'slack',
    threadId: 'slack-dm-sarah',
    authorName: 'Sarah Chen',
    authorHandle: '@sarahchen',
    title: 'Direct message',
    preview: 'Thanks for the call! Looking forward to the deck whenever it’s ready.',
    timestamp: hoursAgo(20),
    unread: false,
    outgoing: false,
    priority: 'medium',
  },
  {
    id: 'slack-5',
    channel: 'slack',
    threadId: 'slack-random',
    authorName: 'Tom Alvarez',
    authorHandle: '@tom',
    title: '#random',
    preview: 'Lunch spot recs near the new office? 🍜',
    timestamp: hoursAgo(28),
    unread: false,
    outgoing: false,
    priority: 'low',
  },
];

export const useChannelStore = create<ChannelState>((set, get) => ({
  channels: [
    { id: 'email', label: 'Email', connected: true, live: true, accent: 'text-sky-500' },
    { id: 'slack', label: 'Slack', connected: true, live: false, accent: 'text-violet-500' },
  ],
  slackMessages: MOCK_SLACK,
  activeChannel: 'all',

  setActiveChannel: (c) => set({ activeChannel: c }),

  connectChannel: (id) =>
    set((state) => ({
      channels: state.channels.map((ch) => (ch.id === id ? { ...ch, connected: true } : ch)),
    })),

  getSlackMessages: () => get().slackMessages,

  markSlackRead: (id) =>
    set((state) => ({
      slackMessages: state.slackMessages.map((m) => (m.id === id ? { ...m, unread: false } : m)),
    })),
}));

/* ------------------------------------------------------------------ */
/* Email → UnifiedMessage adapter (consumed by the Inbox/Today)        */
/* ------------------------------------------------------------------ */

export function emailToUnified(email: any, outgoing = false): UnifiedMessage {
  const senderRaw: string = email.sender || email.recipients || '';
  const nameMatch = senderRaw.match(/^(.+?)\s*</);
  const emailMatch = senderRaw.match(/<([^>]+)>/);
  const authorName = (nameMatch?.[1] || senderRaw.split('@')[0] || 'Unknown').replace(/["']/g, '').trim();
  const authorHandle = emailMatch?.[1] || (senderRaw.includes('@') ? senderRaw.trim() : undefined);
  const priority: UnifiedMessage['priority'] =
    email.category === 'Urgent' ? 'high' : email.category === 'Important' ? 'medium' : 'low';
  return {
    id: email.id,
    channel: 'email',
    threadId: email.thread_id || email.id,
    authorName: outgoing ? 'You' : authorName,
    authorHandle,
    title: email.subject || '(no subject)',
    preview: (email.body_text || email.snippet || '').slice(0, 140),
    timestamp: email.date || email.created_at || new Date().toISOString(),
    unread: !email.is_read && !outgoing,
    outgoing,
    priority,
    raw: email,
  };
}

/**
 * SLACK_SETUP (for wiring real Slack later):
 *
 * 1. Create a Slack app at api.slack.com/apps. Add OAuth scopes:
 *    `channels:history`, `channels:read`, `groups:history`, `im:history`,
 *    `users:read`, and `chat:write` (to reply from Aiden).
 * 2. Add the redirect URL pointing at the local OAuth server
 *    (e.g. http://localhost:8081/slack/callback), mirroring the Gmail flow.
 * 3. In the Python OAuth server, add a `/slack/auth` + `/slack/callback` pair
 *    that exchanges the code for a token and persists it next to the Gmail token.
 * 4. Add `fetchSlackMessages(token)` in a new `src/api/slack.ts`, map results
 *    through a `slackToUnified()` adapter (same shape as `emailToUnified`).
 * 5. Replace MOCK_SLACK with the live fetch and set the channel `live: true`.
 *
 * The entire UI layer already speaks `UnifiedMessage`, so no screen changes are
 * required when the real integration lands.
 */
