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

export type ChannelId = 'email' | 'slack' | 'teams' | 'whatsapp' | 'linear' | 'github';

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
  /** all non-email channel messages (slack, teams, whatsapp, …); email is read live from emailStore */
  channelMessages: UnifiedMessage[];
  activeChannel: ChannelId | 'all';
  setActiveChannel: (c: ChannelId | 'all') => void;
  connectChannel: (id: ChannelId) => void;
  markRead: (id: string) => void;
}

/* ------------------------------------------------------------------ */
/* Mock channel data — realistic, derived from the same fictional world */
/* as the sample emails (Acme, investors, hiring, etc.). One entry per   */
/* channel type so the unified Inbox shows the full multi-channel shape. */
/* ------------------------------------------------------------------ */

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3600 * 1000).toISOString();
}

const MOCK_MESSAGES: UnifiedMessage[] = [
  // Slack
  {
    id: 'slack-1', channel: 'slack', threadId: 'slack-growth',
    authorName: 'Priya Nair', authorHandle: '@priya', title: '#growth',
    preview: 'Hey — can you review the Q2 pipeline deck before the investor call? Left comments on slide 7.',
    timestamp: hoursAgo(1.5), unread: true, outgoing: false, priority: 'high',
  },
  {
    id: 'slack-2', channel: 'slack', threadId: 'slack-dm-marcus',
    authorName: 'Marcus Lee', authorHandle: '@marcus', title: 'Direct message',
    preview: 'Are we still on for the 1:1 tomorrow? Wanted to talk through the VP Sales shortlist.',
    timestamp: hoursAgo(3), unread: true, outgoing: false, priority: 'medium',
  },
  {
    id: 'slack-3', channel: 'slack', threadId: 'slack-eng',
    authorName: 'Dana Whitfield', authorHandle: '@dana', title: '#engineering',
    preview: 'Shipped the onboarding speedup — p95 down 40%. Acme will be happy 🎉',
    timestamp: hoursAgo(6), unread: false, outgoing: false, priority: 'low',
  },
  // Microsoft Teams
  {
    id: 'teams-1', channel: 'teams', threadId: 'teams-dm-elena',
    authorName: 'Elena Rossi', authorHandle: 'elena@acme.com', title: 'Chat',
    preview: 'Can you approve the updated SOW before EOD? Procurement needs it to start the contract.',
    timestamp: hoursAgo(2), unread: true, outgoing: false, priority: 'high',
  },
  {
    id: 'teams-2', channel: 'teams', threadId: 'teams-leadership',
    authorName: 'David Okafor', authorHandle: 'david@company.com', title: 'Leadership',
    preview: 'Board deck draft is in the channel — please add your numbers to the growth slide.',
    timestamp: hoursAgo(5), unread: true, outgoing: false, priority: 'medium',
  },
  // WhatsApp
  {
    id: 'wa-1', channel: 'whatsapp', threadId: 'wa-investor',
    authorName: 'Raj Patel', authorHandle: '+1 415 555 0142', title: 'WhatsApp',
    preview: 'Great meeting today. Send over the data room link when you get a chance 🙏',
    timestamp: hoursAgo(4), unread: true, outgoing: false, priority: 'medium',
  },
  // Linear
  {
    id: 'linear-1', channel: 'linear', threadId: 'linear-ENG-482',
    authorName: 'Linear', authorHandle: 'ENG-482', title: 'Assigned to you',
    preview: 'Dana assigned you "Fix onboarding race condition" (P1) and left a comment asking for an ETA.',
    timestamp: hoursAgo(7), unread: true, outgoing: false, priority: 'high',
  },
  // GitHub
  {
    id: 'gh-1', channel: 'github', threadId: 'gh-pr-1287',
    authorName: 'GitHub', authorHandle: 'aiden/web#1287', title: 'Review requested',
    preview: 'Marcus requested your review on PR #1287 "Unified inbox: multi-channel stream".',
    timestamp: hoursAgo(9), unread: true, outgoing: false, priority: 'high',
  },
];

export const useChannelStore = create<ChannelState>((set) => ({
  channels: [
    { id: 'email', label: 'Email', connected: true, live: true, accent: 'text-sky-500' },
    { id: 'slack', label: 'Slack', connected: true, live: false, accent: 'text-violet-500' },
    { id: 'teams', label: 'Teams', connected: true, live: false, accent: 'text-indigo-500' },
    { id: 'whatsapp', label: 'WhatsApp', connected: true, live: false, accent: 'text-emerald-500' },
    { id: 'linear', label: 'Linear', connected: true, live: false, accent: 'text-indigo-400' },
    { id: 'github', label: 'GitHub', connected: true, live: false, accent: 'text-gray-600 dark:text-gray-300' },
  ],
  channelMessages: MOCK_MESSAGES,
  activeChannel: 'all',

  setActiveChannel: (c) => set({ activeChannel: c }),

  connectChannel: (id) =>
    set((state) => ({
      channels: state.channels.map((ch) => (ch.id === id ? { ...ch, connected: true } : ch)),
    })),

  markRead: (id) =>
    set((state) => ({
      channelMessages: state.channelMessages.map((m) => (m.id === id ? { ...m, unread: false } : m)),
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
