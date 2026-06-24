import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock, RefreshCw, Quote, Check, Bell, X, Inbox } from 'lucide-react';
import {
  SurfaceHeader,
  Surface,
  SectionLabel,
  Pill,
  SoftButton,
  PersonAvatar,
  EmptyState,
  relativeTime,
} from '@/components/aiden/primitives';
import { useAidenActions } from '@/components/aiden/useAidenActions';
import { useCommitmentStore } from '@/stores/commitmentStore';
import { Commitment, dueLabel, isOverdue } from '@/lib/commitments';
import { cn } from '@/lib/utils';

type Filter = 'all' | 'you_owe' | 'they_owe' | 'done';

export const Commitments: React.FC = () => {
  const act = useAidenActions();
  const { commitments, hasExtracted, isExtracting, extract, markDone, snooze, dismiss, reopen } =
    useCommitmentStore();
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    if (!hasExtracted) extract();
  }, [hasExtracted, extract]);

  const open = commitments.filter((c) => c.status === 'open');
  const overdue = open.filter((c) => isOverdue(c));
  const youOwe = open.filter((c) => c.direction === 'you_owe');
  const theyOwe = open.filter((c) => c.direction === 'they_owe');
  const done = commitments.filter((c) => c.status === 'done');

  const visible = useMemo(() => {
    let list: Commitment[];
    if (filter === 'all') list = open;
    else if (filter === 'done') list = done;
    else list = open.filter((c) => c.direction === filter);
    // overdue first, then by due date, then by created
    return [...list].sort((a, b) => {
      const ao = isOverdue(a) ? 0 : 1;
      const bo = isOverdue(b) ? 0 : 1;
      if (ao !== bo) return ao - bo;
      const ad = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
      const bd = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
      return ad - bd;
    });
  }, [filter, open, done]);

  const stats = [
    { label: 'Overdue', value: overdue.length, tone: 'rose' as const },
    { label: 'You owe', value: youOwe.length, tone: 'amber' as const },
    { label: 'Waiting on others', value: theyOwe.length, tone: 'sky' as const },
    { label: 'Completed', value: done.length, tone: 'emerald' as const },
  ];

  const filters: { id: Filter; label: string; count: number }[] = [
    { id: 'all', label: 'All open', count: open.length },
    { id: 'you_owe', label: 'You owe', count: youOwe.length },
    { id: 'they_owe', label: 'Waiting on others', count: theyOwe.length },
    { id: 'done', label: 'Completed', count: done.length },
  ];

  return (
    <div className="animate-fade-in space-y-8">
      <SurfaceHeader
        title="Commitments"
        subtitle="Every promise made in your conversations, tracked. Nothing slips through."
        actions={
          <SoftButton
            variant="soft"
            icon={<RefreshCw className={cn('h-3.5 w-3.5', isExtracting && 'animate-spin')} />}
            onClick={() => extract()}
            disabled={isExtracting}
          >
            {isExtracting ? 'Scanning…' : 'Rescan'}
          </SoftButton>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <Surface key={s.label} tone="subtle" className="px-5 py-4">
            <div
              className={cn(
                'text-3xl font-semibold tabular-nums',
                s.tone === 'rose' && s.value > 0 ? 'text-rose-500' : 'text-foreground',
              )}
            >
              {s.value}
            </div>
            <div className="mt-1 text-[13px] text-muted">{s.label}</div>
          </Surface>
        ))}
      </div>

      {/* Filter segments */}
      <div className="flex flex-wrap gap-1.5">
        {filters.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              'rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors',
              filter === f.id
                ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                : 'bg-gray-100 text-muted hover:text-foreground dark:bg-white/[0.06]',
            )}
          >
            {f.label}
            <span className="ml-1.5 opacity-60 tabular-nums">{f.count}</span>
          </button>
        ))}
      </div>

      {/* List */}
      {!hasExtracted || isExtracting ? (
        <Surface tone="subtle" className="px-6 py-10 text-center text-sm text-muted">
          Scanning your conversations for commitments…
        </Surface>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={filter === 'done' ? <CheckCircle2 className="h-5 w-5" /> : <Inbox className="h-5 w-5" />}
          title={filter === 'done' ? 'Nothing completed yet' : 'No open commitments'}
          description={
            filter === 'done'
              ? 'Commitments you mark done will appear here.'
              : 'When you or someone you email promises something, Aiden will surface it here.'
          }
        />
      ) : (
        <div className="space-y-3">
          {visible.map((c) => (
            <CommitmentCard
              key={c.id}
              c={c}
              onDone={() => markDone(c.id)}
              onSnooze={() => snooze(c.id, 2)}
              onDismiss={() => dismiss(c.id)}
              onReopen={() => reopen(c.id)}
              onOpen={() => act({ action: 'open', payload: { emailId: c.emailId } })}
              onReply={() => {
                // With a real thread → open it in reply mode. Without one (heuristic /
                // manual commitments), draft a fresh message to the counterparty so the
                // button always does something useful.
                if (c.emailId) {
                  act({ action: 'reply', payload: { emailId: c.emailId } });
                } else if (c.counterpartyEmail) {
                  const youOwe = c.direction === 'you_owe';
                  act({
                    action: 'compose',
                    payload: {
                      to: c.counterpartyEmail,
                      prompt: youOwe
                        ? `Write a brief, warm note to ${c.counterpartyName} following through on what I owe them: "${c.text}". Be concrete about next steps.`
                        : `Write a friendly, low-pressure nudge to ${c.counterpartyName} about: "${c.text}". Keep it short and gracious.`,
                    },
                  });
                } else {
                  act({ action: 'ask', payload: { q: `Help me follow up on: ${c.text}`, run: true } });
                }
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const CommitmentCard: React.FC<{
  c: Commitment;
  onDone: () => void;
  onSnooze: () => void;
  onDismiss: () => void;
  onReopen: () => void;
  onOpen: () => void;
  onReply: () => void;
}> = ({ c, onDone, onSnooze, onDismiss, onReopen, onOpen, onReply }) => {
  const overdue = isOverdue(c);
  const isDone = c.status === 'done';
  const youOwe = c.direction === 'you_owe';

  return (
    <Surface
      tone="raised"
      accent={overdue ? 'attention' : 'none'}
      className={cn('px-5 py-4', isDone && 'opacity-60')}
    >
      <div className="flex items-start gap-4">
        <PersonAvatar name={c.counterpartyName} email={c.counterpartyEmail} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={youOwe ? 'amber' : 'sky'}>{youOwe ? 'You owe' : 'Waiting on them'}</Pill>
            {c.dueDate || c.dueText ? (
              <Pill tone={overdue ? 'rose' : 'neutral'} icon={<Clock className="h-3 w-3" />}>
                {dueLabel(c)}
              </Pill>
            ) : null}
            {c.source === 'ai' && <Pill tone="violet">AI</Pill>}
          </div>

          <h3 className={cn('mt-2 text-[15px] font-semibold text-foreground', isDone && 'line-through')}>
            {c.text}
          </h3>
          <p className="mt-0.5 text-[13px] text-muted">
            {youOwe ? 'You → ' : 'From '}
            <span className="font-medium text-foreground/80">{c.counterpartyName}</span>
            {c.subject && <span> · {c.subject}</span>}
            <span className="text-muted/60"> · {relativeTime(c.createdAt)}</span>
          </p>

          {/* the detected sentence */}
          <div className="mt-2.5 flex items-start gap-2 rounded-xl bg-gray-50 px-3 py-2 dark:bg-white/[0.03]">
            <Quote className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-muted/50" />
            <p className="text-[13px] italic leading-relaxed text-muted">{c.excerpt}</p>
          </div>

          {/* actions */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {isDone ? (
              <SoftButton variant="ghost" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={onReopen}>
                Reopen
              </SoftButton>
            ) : (
              <>
                {youOwe ? (
                  <SoftButton variant="primary" onClick={onReply}>
                    {c.emailId ? 'Reply now' : 'Take action'}
                  </SoftButton>
                ) : (
                  <SoftButton variant="primary" onClick={onReply}>
                    Send a nudge
                  </SoftButton>
                )}
                <SoftButton variant="soft" icon={<Check className="h-3.5 w-3.5" />} onClick={onDone}>
                  Mark done
                </SoftButton>
                <SoftButton variant="ghost" icon={<Bell className="h-3.5 w-3.5" />} onClick={onSnooze}>
                  Snooze
                </SoftButton>
                {c.emailId && (
                  <SoftButton variant="ghost" onClick={onOpen}>
                    Open thread
                  </SoftButton>
                )}
                <button
                  onClick={onDismiss}
                  title="Dismiss"
                  className="ml-auto rounded-lg p-1.5 text-muted/50 transition-colors hover:bg-gray-100 hover:text-muted dark:hover:bg-white/[0.06]"
                >
                  <X className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </Surface>
  );
};

export default Commitments;
