import { serverURL } from '@/api/emails';
import type { UnifiedMessage } from '@/stores/channelStore';

/**
 * Slack integration client. The Python OAuth server owns the OAuth dance + token
 * and exposes /slack/{auth,callback,status,messages}; this just talks to it and
 * maps results into the unified-inbox shape.
 */

export interface SlackStatus {
  connected: boolean;
  configured: boolean; // server has SLACK_CLIENT_ID/SECRET set
  team?: string;
}

export interface SlackRawMessage {
  id: string;
  thread_id: string;
  author_id?: string;
  author_name: string;
  title: string; // "Direct message" or "#channel"
  text: string;
  ts?: string; // ISO
  is_dm: boolean;
  is_mention: boolean;
}

export async function getSlackStatus(): Promise<SlackStatus> {
  try {
    const base = await serverURL();
    const r = await fetch(`${base}/slack/status`);
    return await r.json();
  } catch {
    return { connected: false, configured: false };
  }
}

/** Open Slack's authorize page in the system browser to start the OAuth flow. */
export async function connectSlack(): Promise<boolean> {
  try {
    const base = await serverURL();
    const r = await fetch(`${base}/slack/auth`);
    const d = await r.json();
    if (!d.url) return false;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('open_file', { path: d.url });
    } catch {
      window.open(d.url, '_blank');
    }
    return true;
  } catch {
    return false;
  }
}

export async function fetchSlackMessages(): Promise<UnifiedMessage[]> {
  try {
    const base = await serverURL();
    const r = await fetch(`${base}/slack/messages`);
    const d = await r.json();
    if (!d.success || !Array.isArray(d.messages)) return [];
    return (d.messages as SlackRawMessage[]).map(slackToUnified);
  } catch {
    return [];
  }
}

/**
 * Send a reply to a Slack DM / channel. `threadId` is the channel id carried on
 * the unified message; `threadTs` optionally threads it under a specific message.
 * Returns false (rather than throwing) if Slack isn't connected or the call fails.
 */
export async function sendSlackMessage(threadId: string, text: string, threadTs?: string): Promise<boolean> {
  try {
    const base = await serverURL();
    const r = await fetch(`${base}/slack/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: threadId, text, thread_ts: threadTs }),
    });
    const d = await r.json();
    return !!d.success;
  } catch {
    return false;
  }
}

export function slackToUnified(m: SlackRawMessage): UnifiedMessage {
  return {
    id: m.id,
    channel: 'slack',
    threadId: m.thread_id,
    authorName: m.author_name,
    authorHandle: m.author_id,
    title: m.title,
    preview: m.text,
    timestamp: m.ts || new Date().toISOString(),
    unread: true,
    outgoing: false,
    // DMs expect a quicker response than a passing mention.
    priority: m.is_dm ? 'high' : 'medium',
  };
}
