import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, MessageSquare, Sparkles, Check, CornerUpLeft, Send, Loader2 } from 'lucide-react';
import {
  SurfaceHeader,
  SoftButton,
  PersonAvatar,
  EmptyState,
  relativeTime,
} from '@/components/aiden/primitives';
import { useEmailStore } from '@/stores/emailStore';
import { useChannelStore, emailToUnified, UnifiedMessage, ChannelId } from '@/stores/channelStore';
import { answerFromContext } from '@/api/aiden';
import { cn } from '@/lib/utils';

/* Does this message need a response from the user? */
function isActionable(m: UnifiedMessage): boolean {
  if (m.channel === 'email') {
    const r = m.raw as any;
    return r?.requires_reply === true || r?.category === 'Urgent' || r?.category === 'Important';
  }
  // Slack: unread DMs + high-priority mentions need you.
  return m.unread && (m.priority === 'high' || m.title === 'Direct message');
}

const CHANNELS: { id: ChannelId | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'email', label: 'Email' },
  { id: 'slack', label: 'Slack' },
];

export const Inbox: React.FC = () => {
  const navigate = useNavigate();
  const emails = useEmailStore((s) => s.emails);
  const updateEmailStatus = useEmailStore((s) => s.updateEmailStatus);
  const slackMessages = useChannelStore((s) => s.slackMessages);
  const markSlackRead = useChannelStore((s) => s.markSlackRead);

  const [view, setView] = useState<'needs' | 'all'>('needs');
  const [channel, setChannel] = useState<ChannelId | 'all'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const all = useMemo<UnifiedMessage[]>(() => {
    const emailMsgs = emails
      .filter((e) => !['Deleted', 'Archived', 'Saved'].includes(e.status))
      .map((e) => emailToUnified(e));
    return [...emailMsgs, ...slackMessages].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  }, [emails, slackMessages]);

  const needsCount = useMemo(() => all.filter(isActionable).length, [all]);

  const list = useMemo(() => {
    let arr = all; // `all` is already newest-first
    if (channel !== 'all') arr = arr.filter((m) => m.channel === channel);
    if (view === 'needs') {
      // Triage order: most urgent first (unread breaks ties), then recency.
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

  const onDone = (m: UnifiedMessage) => {
    if (m.channel === 'email') updateEmailStatus(m.id, 'Archived');
    else markSlackRead(m.id);
    setExpandedId(null);
  };

  const onOpen = (m: UnifiedMessage) => {
    if (m.channel === 'email') {
      navigate(`/today/email/${m.id}`, { state: { returnPath: '/inbox' } });
    } else {
      setExpandedId((id) => (id === m.id ? null : m.id));
    }
  };

  const onReply = (m: UnifiedMessage) => {
    if (m.channel === 'email') {
      navigate(`/today/email/${m.id}`, { state: { returnPath: '/inbox', autoReply: true } });
    } else {
      setExpandedId(m.id);
    }
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col px-8 py-8">
      <SurfaceHeader
        title="Inbox"
        subtitle="Everything that needs you — across email and Slack. Read, reply, and clear it here."
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
                <span
                  className={cn(
                    'rounded-full px-1.5 text-[10px] font-semibold',
                    view === v ? 'bg-violet-500/15 text-violet-600 dark:text-violet-400' : 'bg-gray-200 text-gray-600 dark:bg-white/10',
                  )}
                >
                  {needsCount}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {CHANNELS.map((c) => (
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
              {c.id === 'email' && <Mail className="h-3 w-3" />}
              {c.id === 'slack' && <MessageSquare className="h-3 w-3" />}
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stream */}
      <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
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
            {list.map((m) => (
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
  const aiSummary = isEmail ? (m.raw as any)?.summary : null;
  const subtitle = isEmail ? m.title : m.title; // email subject / slack channel
  const body = aiSummary || m.preview;

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
              isEmail ? 'bg-sky-500' : 'bg-violet-500',
            )}
          >
            {isEmail ? <Mail className="h-2.5 w-2.5 text-white" /> : <MessageSquare className="h-2.5 w-2.5 text-white" />}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {m.unread && <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-violet-500" />}
            <span className={cn('truncate text-[14px] text-foreground', m.unread ? 'font-semibold' : 'font-medium')}>
              {m.authorName}
            </span>
            {!isEmail && <span className="truncate text-[12px] text-muted/60">{m.title}</span>}
            {m.priority === 'high' && (
              <span className="rounded-full bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600 dark:text-rose-400">
                Urgent
              </span>
            )}
            <span className="ml-auto flex-shrink-0 text-[11px] text-muted/50">{relativeTime(m.timestamp)}</span>
          </div>
          {isEmail && <div className="mt-0.5 truncate text-[13px] font-medium text-foreground/80">{subtitle}</div>}
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
              Reply
            </SoftButton>
            <button
              onClick={onDone}
              title="Mark handled"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted/40 transition-colors hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-400"
            >
              <Check className="h-4 w-4" />
            </button>
          </div>

          {/* Slack inline reply (read + respond from here) */}
          {expanded && !isEmail && (
            <div onClick={(e) => e.stopPropagation()}>
              <SlackReply message={m} onSent={onDone} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Slack inline reply with AI draft (mock send until real integration) */
/* ------------------------------------------------------------------ */
const SlackReply: React.FC<{ message: UnifiedMessage; onSent: () => void }> = ({ message, onSent }) => {
  const [text, setText] = useState('');
  const [drafting, setDrafting] = useState(false);

  const draft = async () => {
    setDrafting(true);
    try {
      const intent = text.trim();
      const instruction = intent
        ? `Write a brief, friendly Slack reply to ${message.authorName}'s message, following this instruction from me: "${intent}". Reply with only the message text, no preamble.`
        : `Write a brief, friendly Slack reply to ${message.authorName}'s message. Reply with only the message text, no preamble.`;
      const reply = await answerFromContext(instruction, `${message.authorName}: ${message.preview}`);
      if (reply) setText(reply);
    } finally {
      setDrafting(false);
    }
  };

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
        <SoftButton
          variant="primary"
          icon={<Send className="h-3.5 w-3.5" />}
          onClick={() => text.trim() && onSent()}
        >
          Send
        </SoftButton>
      </div>
    </div>
  );
};

export default Inbox;
