import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Hash, Users, MessageCircle, Layers, Github, Sparkles, Check, CornerUpLeft, Send, Loader2, ChevronRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { SurfaceHeader, SoftButton, PersonAvatar, EmptyState, relativeTime } from '@/components/aiden/primitives';
import { useEmailStore } from '@/stores/emailStore';
import { useChannelStore, emailToUnified, UnifiedMessage, ChannelId } from '@/stores/channelStore';
import { isAutomatedSender } from '@/lib/senders';
import { answerFromContext } from '@/api/aiden';
import { cn } from '@/lib/utils';

/* Per-channel visual identity (icon + badge color + label). */
const CHANNEL_META: Record<ChannelId, { icon: LucideIcon; badge: string; label: string }> = {
  email: { icon: Mail, badge: 'bg-sky-500', label: 'Email' },
  slack: { icon: Hash, badge: 'bg-violet-500', label: 'Slack' },
  teams: { icon: Users, badge: 'bg-indigo-500', label: 'Teams' },
  whatsapp: { icon: MessageCircle, badge: 'bg-emerald-500', label: 'WhatsApp' },
  linear: { icon: Layers, badge: 'bg-indigo-400', label: 'Linear' },
  github: { icon: Github, badge: 'bg-gray-700 dark:bg-gray-500', label: 'GitHub' },
};

/* Does this message need a response from the user? */
function isActionable(m: UnifiedMessage): boolean {
  if (m.outgoing) return false; // your own sent messages never need a response
  if (m.channel === 'email') {
    const r = m.raw as any;
    // Once you've replied or dismissed/handled it, it's no longer in "Needs you" —
    // even if it was Urgent/Important (matches how a handled channel message drops out).
    if (r?.status === 'Replied' || r?.status === 'Archived' || r?.attention_dismissed) return false;
    // Read = seen/handled -> no longer "needs you" (read <-> handled <-> out of view).
    if (r?.is_read) return false;
    // Transactional/automated/bulk mail (receipts, tickets, no-reply) is never a
    // "needs you" reply task — even if an early heuristic flagged requires_reply.
    if (isAutomatedSender(r?.sender || '')) return false;
    return r?.requires_reply === true || r?.category === 'Urgent' || r?.category === 'Important';
  }
  // Any other channel: unread + not low-priority (DMs, mentions, assignments, reviews).
  return m.unread && m.priority !== 'low';
}

/* An email you've already acted on — replied to, or dismissed from Today's Focus.
 * Still worth browsing ("did I reply to that?"), so in "All" these collapse into a
 * de-emphasized "Done" group rather than cluttering the active stream. (Only emails:
 * channel messages don't carry a handled state here.) */
function isHandledEmail(m: UnifiedMessage): boolean {
  if (m.channel !== 'email') return false;
  const r = m.raw as any;
  return r?.status === 'Replied' || r?.attention_dismissed === true;
}

/* An email you've already read — out of the active stream (read <-> handled),
 * corralled into the "Done" group so the inbox stays clean while it's still
 * browsable and retained in the store for AI context. */
function isReadEmail(m: UnifiedMessage): boolean {
  return m.channel === 'email' && (m.raw as any)?.is_read === true;
}

export const Inbox: React.FC = () => {
  const navigate = useNavigate();
  const emails = useEmailStore((s) => s.emails);
  const updateEmailStatus = useEmailStore((s) => s.updateEmailStatus);
  const channelMessages = useChannelStore((s) => s.channelMessages);
  const channels = useChannelStore((s) => s.channels);
  const markRead = useChannelStore((s) => s.markRead);

  const [view, setView] = useState<'needs' | 'all'>('needs');
  const [channel, setChannel] = useState<ChannelId | 'all'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  const preExpandScroll = useRef(0);
  const mounted = useRef(false);

  const toggleDone = () => {
    // Remember where we are before revealing the group, so closing can return here
    // rather than leaving the scroll stranded in the gap the collapsed rows left.
    if (!showDone) preExpandScroll.current = scrollRef.current?.scrollTop ?? 0;
    setShowDone((s) => !s);
  };

  // Open → bring the Done group into view (it sits below the active stream, often off
  // screen). Close → scroll back to the pre-expand spot so no empty space is left.
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    const el = scrollRef.current;
    if (!el) return;
    if (showDone) doneRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else el.scrollTo({ top: preExpandScroll.current, behavior: 'smooth' });
  }, [showDone]);

  const all = useMemo<UnifiedMessage[]>(() => {
    const emailMsgs = emails
      .filter((e) => !['Deleted', 'Archived', 'Saved'].includes(e.status) && !e.is_read)
      .map((e) => emailToUnified(e));
    // The Inbox lists what others sent you. Your own replies are recorded in the
    // thread (and feed draft context + relationship history) but aren't listed as
    // standalone rows — you review them in context, not as inbox items.
    const incoming = channelMessages.filter((m) => !m.outgoing);
    return [...emailMsgs, ...incoming].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  }, [emails, channelMessages]);

  const needsCount = useMemo(() => all.filter(isActionable).length, [all]);

  const list = useMemo(() => {
    let arr = all; // `all` is already newest-first
    if (channel !== 'all') arr = arr.filter((m) => m.channel === channel);
    if (view === 'needs') {
      const rank = (p?: string) => (p === 'high' ? 3 : p === 'medium' ? 2 : 1);
      arr = arr.filter(isActionable).sort((a, b) => {
        const r = rank(b.priority) - rank(a.priority);
        if (r !== 0) return r;
        if (a.unread !== b.unread) return a.unread ? -1 : 1;
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      });
    }
    return arr;
  }, [all, view, channel]);

  // In "All", keep the active stream clean by corralling already-handled mail into a
  // collapsible "Done" group. ("Needs you" never contains handled items, so `done`
  // is empty there and the group simply doesn't render.)
  const active = useMemo(() => list.filter((m) => !isHandledEmail(m) && !isReadEmail(m)), [list]);
  const done = useMemo(() => list.filter((m) => isHandledEmail(m) || isReadEmail(m)), [list]);

  const channelTabs: { id: ChannelId | 'all'; label: string; soon?: boolean }[] = [
    { id: 'all', label: 'All' },
    ...channels.map((c) => ({ id: c.id, label: c.label, soon: !c.connected })),
  ];

  const onDone = (m: UnifiedMessage) => {
    if (m.channel === 'email') updateEmailStatus(m.id, 'Archived');
    else markRead(m.id);
    setExpandedId(null);
  };

  const onOpen = (m: UnifiedMessage) => {
    if (m.channel === 'email') navigate(`/today/email/${m.id}`, { state: { returnPath: '/inbox' } });
    else if (!m.outgoing) setExpandedId((id) => (id === m.id ? null : m.id));
  };

  const onReply = (m: UnifiedMessage) => {
    if (m.channel === 'email') navigate(`/today/email/${m.id}`, { state: { returnPath: '/inbox', autoReply: true } });
    else setExpandedId(m.id);
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col px-8 py-8">
      <SurfaceHeader
        title="Inbox"
        subtitle="Everything that needs you — across email, Slack, Teams, and more. Read, reply, and clear it here."
      />

      {/* Controls: action-first toggle + channel filter */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="flex items-center rounded-xl bg-gray-100 p-0.5 dark:bg-white/[0.06]">
          {(['needs', 'all'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors',
                view === v ? 'bg-white text-foreground shadow-sm dark:bg-white/[0.1]' : 'text-muted hover:text-foreground',
              )}
            >
              {v === 'needs' ? 'Needs you' : 'All'}
              {v === 'needs' && needsCount > 0 && (
                <span className="rounded-full bg-violet-500/15 px-1.5 text-[10px] font-semibold text-violet-600 dark:text-violet-400">
                  {needsCount}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {channelTabs.map((c) => {
            const Icon = c.id === 'all' ? null : CHANNEL_META[c.id as ChannelId].icon;
            return (
              <button
                key={c.id}
                onClick={() => setChannel(c.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors',
                  channel === c.id
                    ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                    : 'bg-gray-100 text-muted hover:text-foreground dark:bg-white/[0.06]',
                )}
              >
                {Icon && <Icon className="h-3 w-3" />}
                {c.label}
                {c.soon && (
                  <span className="rounded-full bg-gray-200/70 px-1 text-[9px] font-semibold uppercase tracking-wide text-muted/70 dark:bg-white/[0.08]">
                    soon
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Stream */}
      <div ref={scrollRef} className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
        {list.length === 0 ? (
          <div className="pt-10">
            <EmptyState
              icon={<Check className="h-5 w-5" />}
              title={view === 'needs' ? "You're all caught up" : 'Nothing here'}
              description={
                view === 'needs'
                  ? 'Nothing needs a response right now. Switch to “All” to browse everything.'
                  : 'No messages in this view.'
              }
            />
          </div>
        ) : (
          <div className="space-y-1">
            {active.map((m) => (
              <MessageRow
                key={`${m.channel}-${m.id}`}
                message={m}
                expanded={expandedId === m.id}
                onOpen={() => onOpen(m)}
                onReply={() => onReply(m)}
                onDone={() => onDone(m)}
              />
            ))}

            {/* Everything you've already handled — collapsed by default so it never
                crowds the active stream, but one click away when you need it. */}
            {done.length > 0 && (
              <div ref={doneRef} className="pt-2">
                {active.length === 0 && (
                  <p className="px-4 pb-1 text-[13px] text-muted">Nothing active here — everything below is done.</p>
                )}
                <button
                  onClick={toggleDone}
                  className="flex w-full items-center gap-1.5 rounded-lg px-4 py-2 text-[12px] font-semibold uppercase tracking-wide text-muted/70 transition-colors hover:text-foreground"
                >
                  <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', showDone && 'rotate-90')} />
                  Done
                  <span className="rounded-full bg-gray-100 px-1.5 text-[11px] font-semibold normal-case text-muted dark:bg-white/[0.08]">
                    {done.length}
                  </span>
                </button>
                {showDone && (
                  <div className="mt-1 space-y-1 opacity-60 transition-opacity hover:opacity-100">
                    {done.map((m) => (
                      <MessageRow
                        key={`${m.channel}-${m.id}`}
                        message={m}
                        expanded={expandedId === m.id}
                        onOpen={() => onOpen(m)}
                        onReply={() => onReply(m)}
                        onDone={() => onDone(m)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Row                                                                 */
/* ------------------------------------------------------------------ */
const MessageRow: React.FC<{
  message: UnifiedMessage;
  expanded: boolean;
  onOpen: () => void;
  onReply: () => void;
  onDone: () => void;
}> = ({ message: m, expanded, onOpen, onReply, onDone }) => {
  const isEmail = m.channel === 'email';
  const meta = CHANNEL_META[m.channel];
  const ChannelIcon = meta.icon;
  const aiSummary = isEmail ? (m.raw as any)?.summary : null;
  const body = aiSummary || m.preview;
  // An inbound email you've already handled — replied to, or dismissed from Today.
  // Still browseable in "All" with a tag, just out of "Needs you".
  const replied = isEmail && (m.raw as any)?.status === 'Replied';
  const dismissed = isEmail && !replied && (m.raw as any)?.attention_dismissed === true;
  const handled = replied || dismissed;

  return (
    <div
      onClick={onOpen}
      className={cn(
        'group cursor-pointer rounded-xl px-4 py-3 transition-colors',
        expanded ? 'bg-gray-50 dark:bg-white/[0.04]' : 'hover:bg-gray-50 dark:hover:bg-white/[0.03]',
      )}
    >
      <div className="flex items-start gap-3">
        {/* avatar + channel badge */}
        <div className="relative flex-shrink-0">
          <PersonAvatar name={m.authorName} email={m.authorHandle} size={38} />
          <span
            className={cn(
              'absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full ring-2 ring-white dark:ring-[#0c0e14]',
              meta.badge,
            )}
          >
            <ChannelIcon className="h-2.5 w-2.5 text-white" />
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {m.unread && <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-violet-500" />}
            <span className={cn('truncate text-[14px] text-foreground', m.unread ? 'font-semibold' : 'font-medium')}>
              {m.authorName}
            </span>
            {!isEmail && <span className="truncate text-[12px] text-muted/60">{m.title}</span>}
            {m.priority === 'high' && !handled && (
              <span className="rounded-full bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600 dark:text-rose-400">
                Urgent
              </span>
            )}
            {handled && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
                {replied ? <CornerUpLeft className="h-2.5 w-2.5" /> : <Check className="h-2.5 w-2.5" />}
                {replied ? 'Replied' : 'Handled'}
              </span>
            )}
            <span className="ml-auto flex-shrink-0 text-[11px] text-muted/50">{relativeTime(m.timestamp)}</span>
          </div>
          {isEmail && <div className="mt-0.5 truncate text-[13px] font-medium text-foreground/80">{m.title}</div>}
          <div className="mt-0.5 flex items-start gap-1.5">
            {aiSummary && <Sparkles className="mt-0.5 h-3 w-3 flex-shrink-0 text-violet-400" />}
            <p
              className={cn(
                'text-[13px] leading-snug text-muted',
                expanded ? 'max-h-56 overflow-y-auto whitespace-pre-wrap' : 'line-clamp-2',
              )}
            >
              {body}
            </p>
          </div>

          {/* actions — revealed on hover (space reserved, so no layout shift) */}
          <div
            className={cn(
              'mt-2 flex items-center gap-2 transition-opacity',
              expanded ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <SoftButton variant="soft" icon={<CornerUpLeft className="h-3.5 w-3.5" />} onClick={onReply}>
              {replied ? 'Reply again' : 'Reply'}
            </SoftButton>
            {!handled && (
              <button
                onClick={onDone}
                title="Mark handled"
                className="flex h-7 w-7 items-center justify-center rounded-lg text-muted/40 transition-colors hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-400"
              >
                <Check className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Inline reply for chat-style channels (read + respond from here) */}
          {expanded && !isEmail && (
            <div onClick={(e) => e.stopPropagation()}>
              <ChannelReply message={m} channelLabel={meta.label} onSent={onDone} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Inline reply with AI draft. Slack sends for real (chat.postMessage); other  */
/* not-yet-connected channels update optimistically until their send lands.    */
/* ------------------------------------------------------------------ */
const ChannelReply: React.FC<{ message: UnifiedMessage; channelLabel: string; onSent: () => void }> = ({
  message,
  channelLabel,
  onSent,
}) => {
  const channelMessages = useChannelStore((s) => s.channelMessages);
  const sendMessage = useChannelStore((s) => s.sendMessage);
  const [text, setText] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSend = () => {
    const body = text.trim();
    if (!body) return;
    sendMessage({ threadId: message.threadId, channel: message.channel, text: body, replyToId: message.id });
    setSent(true);
    // Brief confirmation, then collapse the row (now marked handled).
    setTimeout(onSent, 900);
  };

  const draft = async () => {
    setDrafting(true);
    try {
      const intent = text.trim();
      // Build the thread so the draft has continuity, not just the latest line.
      const thread = channelMessages
        .filter((m) => m.threadId === message.threadId)
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
        .map((m) => `${m.outgoing ? 'Me' : m.authorName}: ${m.preview}`)
        .join('\n');
      // Chat channels are casual — short, no greeting/sign-off, no email formality.
      const voice = `Write in a casual chat voice for ${channelLabel}: short, direct, warm, no greeting or sign-off, no email formality. Output ONLY the message text — no surrounding quotation marks, no preamble.`;
      const instruction = intent
        ? `Reply to ${message.authorName} following this instruction from me: "${intent}". ${voice}`
        : `Reply to ${message.authorName}'s latest message. ${voice}`;
      const reply = await answerFromContext(instruction, thread || `${message.authorName}: ${message.preview}`);
      if (reply) setText(reply.trim().replace(/^["'“”]+|["'“”]+$/g, '').trim());
    } finally {
      setDrafting(false);
    }
  };

  if (sent) {
    return (
      <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-200/70 bg-emerald-50/60 px-3 py-2.5 text-[13px] font-medium text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/[0.08] dark:text-emerald-300">
        <Check className="h-3.5 w-3.5" />
        Sent to {message.authorName}
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-gray-200/70 bg-white p-2.5 dark:border-white/[0.08] dark:bg-white/[0.04]">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder={`Reply to ${message.authorName}, or jot what to say and let Aiden draft it…`}
        className="w-full resize-none bg-transparent px-1 py-1 text-[13px] text-foreground outline-none placeholder:text-muted"
      />
      <div className="mt-1.5 flex items-center gap-2">
        <SoftButton
          variant="soft"
          icon={drafting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          onClick={draft}
        >
          {drafting ? 'Drafting…' : 'Draft with Aiden'}
        </SoftButton>
        <SoftButton variant="primary" icon={<Send className="h-3.5 w-3.5" />} onClick={handleSend}>
          Send
        </SoftButton>
      </div>
    </div>
  );
};

export default Inbox;
