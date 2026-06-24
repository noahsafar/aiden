import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  Sparkles,
  CheckCircle2,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  MapPin,
  Video,
  Check,
  Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Surface,
  SectionLabel,
  SoftButton,
  PersonAvatar,
  EmptyState,
  LinkRow,
  Pill,
} from '@/components/aiden/primitives';
import { useAidenActions } from '@/components/aiden/useAidenActions';
import { useEmailStore } from '@/stores/emailStore';
import { useCrmStore } from '@/stores/crmStore';
import { useCommitmentStore } from '@/stores/commitmentStore';
import { useChannelStore } from '@/stores/channelStore';
import { useAuthStore } from '@/stores/authStore';
import {
  deriveAttention,
  deriveOpportunities,
  deriveContextBullets,
  recentSubjectsWith,
  peopleInAttention,
  AttentionItem,
  Opportunity,
  ActionSuggestion,
} from '@/lib/aidenBrain';
import { synthesizeDayBrief } from '@/api/aiden';
import { fetchEvents, CalendarEvent } from '@/api/calendar';
import { Commitment, dueLabel, isOverdue } from '@/lib/commitments';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

const FALLBACK_EVENTS: CalendarEvent[] = [
  { id: 'demo-1', summary: 'Team sync', start: '', end: '', date: todayStr(), time: '10:00 AM', end_time: '10:30 AM', all_day: false },
  { id: 'demo-2', summary: 'JAPN Clinic', start: '', end: '', date: todayStr(), time: '2:00 PM', end_time: '2:30 PM', all_day: false },
  { id: 'demo-3', summary: 'Tsai CITY Check-in', start: '', end: '', date: todayStr(), time: '3:00 PM', end_time: '3:30 PM', all_day: false },
];

type FocusItem =
  | { type: 'attention'; item: AttentionItem }
  | { type: 'opportunity'; item: Opportunity };

/* ------------------------------------------------------------------ */
/* AidenBox — tinted rec / suggestion block                           */
/* ------------------------------------------------------------------ */

const AidenBox: React.FC<{
  label: string;
  children: React.ReactNode;
  tone?: 'violet' | 'emerald';
}> = ({ label, children, tone = 'violet' }) => (
  <div className={cn(
    'flex items-start gap-2.5 rounded-xl px-3.5 py-3 border',
    tone === 'violet'
      ? 'bg-violet-50/60 dark:bg-violet-500/[0.08] border-violet-100/80 dark:border-violet-500/20'
      : 'bg-emerald-50/60 dark:bg-emerald-500/[0.07] border-emerald-100/80 dark:border-emerald-500/20',
  )}>
    <div className={cn(
      'mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full',
      tone === 'violet' ? 'bg-violet-100 dark:bg-violet-500/25' : 'bg-emerald-100 dark:bg-emerald-500/25',
    )}>
      <Sparkles className={cn('h-3 w-3', tone === 'violet' ? 'text-violet-500' : 'text-emerald-600 dark:text-emerald-400')} />
    </div>
    <div className="min-w-0">
      <p className={cn(
        'text-[10px] font-bold uppercase tracking-wider mb-0.5',
        tone === 'violet' ? 'text-violet-500/70' : 'text-emerald-600/70 dark:text-emerald-400/70',
      )}>
        {label}
      </p>
      <p className="text-[13px] font-medium text-foreground/80 leading-snug">{children}</p>
    </div>
  </div>
);

/* ------------------------------------------------------------------ */
/* PrepChip — found-item chip inside meeting prep                     */
/* ------------------------------------------------------------------ */

const PrepChip: React.FC<{ children: React.ReactNode; urgent?: boolean }> = ({ children, urgent }) => (
  <span className={cn(
    'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold',
    urgent
      ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300'
      : 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  )}>
    <CheckCircle2 className="h-3 w-3" />
    {children}
  </span>
);

/* ------------------------------------------------------------------ */
/* Focus card — left accent bar, outcome-first                        */
/* ------------------------------------------------------------------ */

const FocusCard: React.FC<{
  focus: FocusItem;
  index: number;
  onAction: (s: ActionSuggestion) => void;
}> = ({ focus, index, onAction }) => {
  if (focus.type === 'attention') {
    const item = focus.item;
    const isRed = item.severity >= 70;

    return (
      <div
        className={cn(
          'rounded-2xl bg-white dark:bg-white/[0.04]',
          'border border-gray-200/70 dark:border-white/[0.07]',
          'shadow-elevated-sm cursor-pointer hover:shadow-elevated-md hover:-translate-y-px transition-all duration-300',
        )}
        onClick={() => onAction(item.suggestions[0])}
      >
        <div className="px-6 py-5">
          {/* Index + outcome title */}
          <div className="flex items-start gap-2.5 mb-3">
            <span className="mt-[3px] text-[11px] font-bold tabular-nums text-muted/25 w-3 flex-shrink-0 leading-none">
              {index}
            </span>
            <div className="min-w-0 flex-1">
              {/* Person + detail on one subtle line */}
              {item.person && (
                <div className="flex items-center gap-2 mb-1.5">
                  <PersonAvatar name={item.person.name} email={item.person.email} size={18} />
                  <span className="text-[12px] text-muted font-medium">{item.person.name}</span>
                  {item.detail && (
                    <span className="text-[12px] text-muted/50 truncate">· {item.detail}</span>
                  )}
                </div>
              )}
              {/* Outcome title */}
              <h3 className="text-[17px] font-semibold text-foreground leading-snug">
                {item.outcomeTitle}
              </h3>
            </div>
            {/* Priority dot */}
            <div className={cn(
              'mt-1.5 h-2 w-2 flex-shrink-0 rounded-full',
              isRed ? 'bg-rose-500' : 'bg-amber-400',
            )} />
          </div>

          {/* Situation / Context */}
          {item.situation && (
            <div className="ml-5 mb-3 pl-3 border-l-2 border-gray-100 dark:border-white/[0.07]">
              <p className="text-[13px] text-muted leading-relaxed">
                {item.situation}
              </p>
            </div>
          )}

          {/* AIDEN recommends */}
          {item.recommendation && (
            <div className="ml-5 mb-4">
              <AidenBox label="Aiden recommends" tone="violet">
                {item.recommendation}
              </AidenBox>
            </div>
          )}

          {/* Actions */}
          <div className="ml-5 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
            {item.suggestions.map((s, i) => (
              <SoftButton key={i} variant={i === 0 ? 'primary' : 'soft'} onClick={() => onAction(s)}>
                {s.label}
              </SoftButton>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Opportunity (🟢 → green accent bar)
  const opp = focus.item;
  return (
    <div
      className={cn(
        'rounded-2xl bg-white dark:bg-white/[0.04]',
        'border border-gray-200/70 dark:border-white/[0.07]',
        'shadow-elevated-sm cursor-pointer hover:shadow-elevated-md hover:-translate-y-px transition-all duration-300',
      )}
      onClick={() => onAction(opp.suggestions[0])}
    >
      <div className="px-6 py-5">
        <div className="flex items-start gap-2.5 mb-3">
          <span className="mt-[3px] text-[11px] font-bold tabular-nums text-muted/25 w-3 flex-shrink-0 leading-none">
            {index}
          </span>
          <div className="min-w-0 flex-1">
            {opp.person && (
              <div className="flex items-center gap-2 mb-1.5">
                <PersonAvatar name={opp.person.name} email={opp.person.email} size={18} />
                <span className="text-[12px] text-muted font-medium">{opp.person.name}</span>
              </div>
            )}
            <h3 className="text-[17px] font-semibold text-foreground leading-snug">
              {opp.outcomeTitle}
            </h3>
          </div>
          <div className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-emerald-500" />
        </div>

        {opp.detail && (
          <div className="ml-5 mb-3 pl-3 border-l-2 border-gray-100 dark:border-white/[0.07]">
            <p className="text-[13px] text-muted leading-relaxed">{opp.detail}</p>
          </div>
        )}

        {opp.recommendation && (
          <div className="ml-5 mb-4">
            <AidenBox label="Suggested" tone="emerald">
              {opp.recommendation}
            </AidenBox>
          </div>
        )}

        <div className="ml-5 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
          {opp.suggestions.map((s, i) => (
            <SoftButton key={i} variant={i === 0 ? 'primary' : 'ghost'} onClick={() => onAction(s)}>
              {s.label}
            </SoftButton>
          ))}
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Meeting brief card — time + mini briefing in one card              */
/* ------------------------------------------------------------------ */

const MeetingBriefCard: React.FC<{
  event: CalendarEvent;
  emails: any[];
  sentEmails: any[];
  contacts: any[];
  commitments: Commitment[];
}> = ({ event, emails, sentEmails, contacts, commitments }) => {
  const navigate = useNavigate();
  const matched = contacts.find((c: any) => {
    const name = (c.name || '').trim();
    if (!name) return false;
    return new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(event.summary);
  });

  const personMatch = event.summary.match(/(?:with|—|-|:|\|)\s*([A-Z][a-z]+(?: [A-Z][a-z]+)?)/);
  const personName = matched?.name || personMatch?.[1];

  const recentSubjects = matched
    ? recentSubjectsWith(emails, sentEmails, matched.email_address, 3)
    : [];
  const contextBullets = matched
    ? deriveContextBullets(emails, sentEmails, matched.email_address)
    : [];
  const openWith = matched
    ? commitments.filter(
        (c) =>
          c.status === 'open' &&
          c.counterpartyEmail?.toLowerCase() === matched.email_address?.toLowerCase(),
      )
    : [];

  const handlePrep = () => navigate('/ask', { state: { event, run: true } });

  const hasPrepContent = recentSubjects.length > 0 || contextBullets.length > 0 || openWith.length > 0;

  const openLink = async (url: string) => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('open_file', { path: url });
    } catch {
      window.open(url, '_blank');
    }
  };

  const hasDetails = !!(event.location || event.meeting_link || event.description);

  return (
    <Surface className="overflow-hidden">
      {/* ── Header row ── */}
      <div className="flex items-center gap-4 px-5 py-4">
        <div className="w-16 flex-shrink-0 text-right">
          <p className="text-[15px] font-bold tabular-nums text-sky-600 dark:text-sky-400 leading-tight">
            {event.all_day ? 'All day' : event.time}
          </p>
          {!event.all_day && event.end_time && (
            <p className="text-[11px] text-muted/50">{event.end_time}</p>
          )}
        </div>
        <div className="h-9 w-px bg-gray-100 dark:bg-white/[0.08] flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold text-foreground">{event.summary}</h3>
          {matched && (
            <p className="text-[12px] text-muted/60 mt-0.5">
              {matched.category && matched.category !== 'Other' ? matched.category : 'Contact'}
              {matched.relationship_score >= 75 ? ' · Key relationship' : ''}
              {openWith.length > 0
                ? ` · ${openWith.length} open loop${openWith.length > 1 ? 's' : ''}`
                : ''}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {event.meeting_link && (
            <SoftButton
              variant="soft"
              icon={<Video className="h-3.5 w-3.5" />}
              onClick={() => openLink(event.meeting_link!)}
            >
              Join
            </SoftButton>
          )}
          <SoftButton
            variant="primary"
            icon={<Sparkles className="h-3.5 w-3.5" />}
            onClick={handlePrep}
          >
            Prep me
          </SoftButton>
        </div>
      </div>

      {/* ── Extra details (location / description) ── */}
      {hasDetails && (
        <div className="border-t border-gray-100 dark:border-white/[0.06] px-5 py-3 space-y-1.5">
          {event.location && (
            <div className="flex items-start gap-2">
              <MapPin className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-muted/40" />
              <span className="text-[12px] text-muted/70 leading-snug">{event.location}</span>
            </div>
          )}
          {event.description && (
            <p className="text-[12px] text-muted/60 leading-relaxed line-clamp-2 pl-5">
              {event.description.replace(/<[^>]+>/g, '').trim()}
            </p>
          )}
        </div>
      )}
    </Surface>
  );
};

/* ------------------------------------------------------------------ */
/* Relationship opportunity card                                       */
/* ------------------------------------------------------------------ */

const RelationshipOpportunityCard: React.FC<{
  opp: Opportunity;
  onAction: (s: ActionSuggestion) => void;
}> = ({ opp, onAction }) => (
  <Surface interactive className="px-5 py-5" onClick={() => onAction(opp.suggestions[0])}>
    <div className="flex items-start gap-4">
      {opp.person ? (
        <PersonAvatar name={opp.person.name} email={opp.person.email} size={44} />
      ) : (
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-500/20">
          <TrendingUp className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <h3 className="text-[15px] font-semibold text-foreground mb-1">{opp.title}</h3>
        <p className="text-[13px] text-muted leading-relaxed mb-3">{opp.detail}</p>

        {opp.recommendation && (
          <div className="mb-4">
            <AidenBox label="Aiden recommends" tone="emerald">
              {opp.recommendation}
            </AidenBox>
          </div>
        )}

        <div className="flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
          {opp.suggestions.map((s, i) => (
            <SoftButton key={i} variant={i === 0 ? 'primary' : 'soft'} onClick={() => onAction(s)}>
              {s.label}
            </SoftButton>
          ))}
        </div>
      </div>
    </div>
  </Surface>
);

/* ------------------------------------------------------------------ */
/* Open loop card — compact, chip-based metadata                      */
/* ------------------------------------------------------------------ */

const OpenLoopCard: React.FC<{
  commitment: Commitment;
  onNavigate: () => void;
  onMarkDone: () => void;
  onReply: () => void;
}> = ({ commitment: c, onNavigate, onMarkDone, onReply }) => {
  const now = new Date();
  const overdueFlag = isOverdue(c, now);
  const ageDays = Math.round((now.getTime() - new Date(c.createdAt).getTime()) / 86400000);
  const isYouOwe = c.direction === 'you_owe';

  return (
    <Surface
      interactive
      accent={overdueFlag ? 'attention' : 'none'}
      className="px-5 py-4"
      onClick={onNavigate}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {/* Name + optional alert */}
          <div className="flex items-center gap-1.5 mb-1.5">
            {overdueFlag && (
              <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 text-rose-500" />
            )}
            <p className="text-[14px] font-semibold text-foreground">{c.counterpartyName}</p>
          </div>

          {/* Promise / waiting-for text */}
          <p className="text-[13px] text-muted leading-relaxed mb-2.5">{c.text}</p>

          {/* Inline metadata chips */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="inline-flex items-center rounded-full bg-gray-100 dark:bg-white/[0.07] px-2.5 py-0.5 text-[11px] font-medium text-muted/70">
              {isYouOwe ? 'On you' : 'On them'}
            </span>
            <span className="inline-flex items-center rounded-full bg-gray-100 dark:bg-white/[0.07] px-2.5 py-0.5 text-[11px] font-medium text-muted/70">
              {ageDays <= 0 ? 'Today' : `${ageDays}d old`}
            </span>
            {overdueFlag && (
              <span className="inline-flex items-center rounded-full bg-rose-50 dark:bg-rose-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                {dueLabel(c, now)}
              </span>
            )}
            {!overdueFlag && c.dueDate && (
              <span className="inline-flex items-center rounded-full bg-amber-50 dark:bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                {dueLabel(c, now)}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          <SoftButton variant="primary" onClick={onReply}>
            {c.emailId ? 'Reply' : 'Draft'}
          </SoftButton>
          <button
            onClick={onMarkDone}
            title="Mark as done"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted/40 hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-400 transition-colors"
          >
            <Check className="h-4 w-4" />
          </button>
        </div>
      </div>
    </Surface>
  );
};

/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/* Main surface                                                         */
/* ------------------------------------------------------------------ */

export const Today: React.FC = () => {
  const act = useAidenActions();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const emails = useEmailStore((s) => s.emails);
  const sentEmails = useEmailStore((s) => s.sentEmails);
  const { contacts, hasExtractedContacts, extractContacts } = useCrmStore();
  const { commitments, hasExtracted, extract, getOpen, markDone } = useCommitmentStore();
  const slack = useChannelStore((s) => s.slackMessages);

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [showLowPriority, setShowLowPriority] = useState(false);

  useEffect(() => {
    if (!hasExtractedContacts) extractContacts();
    if (!hasExtracted) extract();
  }, [hasExtractedContacts, hasExtracted, extractContacts, extract]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchEvents(todayStr(), todayStr());
        if (cancelled) return;
        const todays = (res.events || []).filter((e) => e.date === todayStr());
        setEvents(todays.length ? todays : FALLBACK_EVENTS);
      } catch {
        if (!cancelled) setEvents(FALLBACK_EVENTS);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const attention = useMemo<AttentionItem[]>(
    () => deriveAttention({ emails, sentEmails, contacts, commitments, slack, userEmail: user?.email }),
    [emails, sentEmails, contacts, commitments, slack, user?.email],
  );

  const opportunities = useMemo<Opportunity[]>(
    () =>
      deriveOpportunities(
        { emails, sentEmails, contacts, commitments, slack, userEmail: user?.email },
        peopleInAttention(attention),
      ),
    [emails, sentEmails, contacts, commitments, slack, user?.email, attention],
  );

  const openCommitments = useMemo(() => {
    const now = new Date();
    return getOpen()
      .filter((c) => c.direction === 'you_owe')
      .sort((a, b) => {
        const aOver = isOverdue(a, now) ? 1 : 0;
        const bOver = isOverdue(b, now) ? 1 : 0;
        if (aOver !== bOver) return bOver - aOver;
        if (a.dueDate && b.dueDate) return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
        if (a.dueDate) return -1;
        if (b.dueDate) return 1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
  }, [commitments]);

  // Balls in their court that have gone stale — a chief of staff tracks these too.
  const waitingOnThem = useMemo(() => {
    const now = Date.now();
    return getOpen()
      .filter((c) => {
        if (c.direction !== 'they_owe') return false;
        const ageDays = (now - new Date(c.createdAt).getTime()) / 86400000;
        return ageDays >= 3 || (c.dueDate ? new Date(c.dueDate).getTime() < now : false);
      })
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .slice(0, 3);
  }, [commitments]);

  // Focus: top real-person attention items, fill remainder with opportunities. Max 3.
  const focusItems = useMemo<FocusItem[]>(() => {
    const topAttention: FocusItem[] = attention
      .filter((i) => i.severity >= 40 && i.person !== undefined)
      .slice(0, 3)
      .map((item) => ({ type: 'attention', item }));
    const spots = Math.max(0, 3 - topAttention.length);
    const oppItems: FocusItem[] = opportunities
      .slice(0, spots)
      .map((item) => ({ type: 'opportunity', item }));
    return [...topAttention, ...oppItems].slice(0, 3);
  }, [attention, opportunities]);

  const focusAttentionIds = new Set(
    focusItems.filter((f) => f.type === 'attention').map((f) => (f.item as AttentionItem).id),
  );
  const lowPriorityItems = useMemo(
    () => attention.filter((i) => !focusAttentionIds.has(i.id) && i.person !== undefined),
    [attention, focusAttentionIds],
  );

  const focusOppIds = new Set(
    focusItems.filter((f) => f.type === 'opportunity').map((f) => (f.item as Opportunity).id),
  );
  const remainingOpps = useMemo(
    () => opportunities.filter((o) => !focusOppIds.has(o.id)),
    [opportunities, focusOppIds],
  );

  // Header outcome bullets — phrase as outcomes, colored by type
  const dayOutcomes = useMemo(() => {
    const bullets: Array<{ text: string; color: string }> = [];
    const first = focusItems[0];
    if (first?.type === 'attention') bullets.push({ text: first.item.outcomeTitle, color: first.item.severity >= 70 ? 'bg-rose-500' : 'bg-amber-400' });
    else if (first?.type === 'opportunity') bullets.push({ text: first.item.outcomeTitle, color: 'bg-emerald-500' });
    const owedCount = openCommitments.filter((c) => c.direction === 'you_owe').length;
    if (owedCount > 0) bullets.push({ text: `Closing ${owedCount} blocked conversation${owedCount > 1 ? 's' : ''}`, color: 'bg-amber-400' });
    if (remainingOpps.length > 0) bullets.push({ text: `Strengthening ${remainingOpps.length} key relationship${remainingOpps.length > 1 ? 's' : ''}`, color: 'bg-emerald-500' });
    return bullets.slice(0, 3);
  }, [focusItems, openCommitments, remainingOpps]);

  // AI "morning brief" — one sharp, specific sentence orienting the day.
  const [dayBrief, setDayBrief] = useState<string>('');
  const briefKey = `${attention.length}|${opportunities.length}|${events.length}|${openCommitments.length}|${
    focusItems[0] ? (focusItems[0].item as any).id : ''
  }`;
  useEffect(() => {
    const now = new Date();
    const top = focusItems[0];
    const topPriority = top ? top.item.outcomeTitle : undefined;
    const overdueC = openCommitments.find((c) => isOverdue(c, now));
    const mostOverdue = overdueC ? overdueC.text : undefined;
    // Only an UPCOMING meeting counts — never reference one that already happened.
    const nowMs = now.getTime();
    const upcoming = [...events]
      .filter((e) => !e.all_day && e.start && new Date(e.start).getTime() >= nowMs)
      .sort((a, b) => (a.start || '').localeCompare(b.start || ''))[0];
    const nextMeeting = upcoming ? `${upcoming.summary} at ${upcoming.time}` : undefined;
    let cancelled = false;
    synthesizeDayBrief({
      attentionCount: attention.length,
      opportunityCount: opportunities.length,
      meetingsToday: events.length,
      openCommitments: openCommitments.length,
      topPriority,
      mostOverdue,
      nextMeeting,
    }).then((s) => {
      if (!cancelled) setDayBrief(s);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [briefKey]);

  const aidenHandled = useMemo(
    () => emails.length + commitments.length + opportunities.length,
    [emails.length, commitments.length, opportunities.length],
  );

  // Chronological events + the soonest upcoming one (for the "Next up" banner).
  const sortedEvents = useMemo(
    () => [...events].sort((a, b) => (a.start || a.time || '').localeCompare(b.start || b.time || '')),
    [events],
  );
  const nextUp = useMemo(() => {
    const nowMs = Date.now();
    // Only a genuinely upcoming, timed meeting — never one that already started.
    const ev = sortedEvents.find((e) => {
      const t = e.start ? new Date(e.start).getTime() : NaN;
      return !e.all_day && !isNaN(t) && t >= nowMs;
    });
    if (!ev) return null;
    const t = new Date(ev.start).getTime();
    const mins = Math.round((t - nowMs) / 60000);
    const when = mins < 60 ? `in ${mins} min` : mins < 600 ? `in ${Math.round(mins / 60)}h` : (ev.time || '');
    return { ev, when };
  }, [sortedEvents]);

  const firstName = (user?.name || '').split(' ')[0] || 'there';
  const dateLabel = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="animate-fade-in space-y-8">

      {/* ── 1. HEADER ── */}
      <header>
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted/50 mb-3">
          {dateLabel}
        </p>
        <h1 className="text-[34px] font-semibold tracking-tight text-foreground leading-tight mb-4">
          {greeting()}, {firstName}.
        </h1>

        {dayBrief && (
          <div className="flex items-start gap-2.5 mb-5 max-w-2xl">
            <Sparkles className="mt-1 h-4 w-4 flex-shrink-0 text-violet-500" />
            <p className="text-[17px] text-foreground/80 leading-relaxed">{dayBrief}</p>
          </div>
        )}

        {dayOutcomes.length > 0 && (
          <div className="space-y-2.5 mb-5">
            {dayOutcomes.map((b, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className={cn('mt-[5px] h-1.5 w-1.5 flex-shrink-0 rounded-full', b.color)} />
                <p className="text-[15px] text-muted leading-snug">{b.text}</p>
              </div>
            ))}
          </div>
        )}

        {aidenHandled > 0 && (
          <div className="inline-flex items-center gap-1.5 rounded-full bg-gray-100/80 dark:bg-white/[0.06] px-3 py-1.5 text-[12px] text-muted/60">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500/70" />
            <span>
              Aiden grouped <span className="font-medium text-foreground/70">{emails.length}</span> message{emails.length !== 1 ? 's' : ''}
              {commitments.length > 0 && <>, detected <span className="font-medium text-foreground/70">{commitments.length}</span> commitment{commitments.length !== 1 ? 's' : ''}</>}
              {opportunities.length > 0 && <>, found <span className="font-medium text-foreground/70">{opportunities.length}</span> signal{opportunities.length !== 1 ? 's' : ''}</>}
              {events.length > 0 && <>, prepared <span className="font-medium text-foreground/70">{events.length}</span> briefing{events.length !== 1 ? 's' : ''}</>}
            </span>
          </div>
        )}
      </header>

      {/* ── 2. TODAY'S FOCUS ── */}
      <section>
        <SectionLabel dot="rose" count={focusItems.length}>
          Today's focus
        </SectionLabel>
        {focusItems.length === 0 ? (
          <Surface tone="subtle" className="px-6 py-8">
            <div className="flex items-center gap-3 text-muted">
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              <span className="text-[14px]">Nothing pressing. You're on top of things.</span>
            </div>
          </Surface>
        ) : (
          <div className="space-y-3">
            {focusItems.map((f, idx) => (
              <FocusCard
                key={f.type === 'attention' ? f.item.id : f.item.id}
                focus={f}
                index={idx + 1}
                onAction={act}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── 3. MEETINGS ── */}
      <section>
        <SectionLabel dot="sky" icon={<CalendarDays className="h-3.5 w-3.5" />} count={events.length}>
          Meetings today
        </SectionLabel>
        {events.length === 0 ? (
          <Surface>
            <EmptyState
              icon={<CalendarDays className="h-5 w-5" />}
              title="No meetings today"
              description="A clear calendar — a good day for deep work or reconnecting with someone."
            />
          </Surface>
        ) : (
          <div className="space-y-3">
            {nextUp && (
              <div className="flex items-center gap-2.5 rounded-xl bg-sky-50/70 px-4 py-2.5 dark:bg-sky-500/[0.08]">
                <Clock className="h-4 w-4 flex-shrink-0 text-sky-500" />
                <p className="text-[13px] text-foreground/80">
                  <span className="font-semibold text-sky-600 dark:text-sky-400">Next up</span>
                  {' · '}
                  {nextUp.ev.summary}
                  <span className="text-muted/70"> · {nextUp.when}</span>
                </p>
              </div>
            )}
            {sortedEvents.map((ev) => (
              <MeetingBriefCard
                key={ev.id}
                event={ev}
                emails={emails}
                sentEmails={sentEmails}
                contacts={contacts}
                commitments={commitments}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── 4. RELATIONSHIP OPPORTUNITIES ── */}
      {remainingOpps.length > 0 && (
        <section>
          <SectionLabel dot="emerald" count={remainingOpps.length}>
            Relationship opportunities
          </SectionLabel>
          <div className="space-y-3">
            {remainingOpps.map((opp) => (
              <RelationshipOpportunityCard key={opp.id} opp={opp} onAction={act} />
            ))}
          </div>
        </section>
      )}

      {/* ── 5. OPEN LOOPS ── */}
      {openCommitments.length > 0 && (
        <section>
          <SectionLabel
            dot="amber"
            count={openCommitments.length}
            action={<LinkRow onClick={() => navigate('/commitments')}>All loops</LinkRow>}
          >
            Open loops
          </SectionLabel>

          <div className="space-y-2">
            {openCommitments.slice(0, 4).map((c) => (
              <OpenLoopCard
                key={c.id}
                commitment={c}
                onNavigate={() => navigate('/commitments')}
                onMarkDone={() => markDone(c.id)}
                onReply={() => {
                  if (c.emailId) {
                    navigate(`/today/email/${c.emailId}`, { state: { returnPath: '/today', autoReply: true } });
                  } else if (c.counterpartyEmail) {
                    act({
                      action: 'compose',
                      payload: {
                        to: c.counterpartyEmail,
                        prompt: `Write a brief, warm note to ${c.counterpartyName} following through on what I owe them: "${c.text}". Be concrete about next steps.`,
                      },
                    });
                  } else {
                    act({ action: 'ask', payload: { q: `Help me follow up on: ${c.text}`, run: true } });
                  }
                }}
              />
            ))}
            {openCommitments.length > 4 && (
              <button
                className="w-full py-2 text-[13px] text-muted/40 hover:text-muted/70 transition-colors"
                onClick={() => navigate('/commitments')}
              >
                + {openCommitments.length - 4} more
              </button>
            )}
          </div>
        </section>
      )}

      {/* ── 5b. WAITING ON THEM ── */}
      {waitingOnThem.length > 0 && (
        <section>
          <SectionLabel dot="sky" count={waitingOnThem.length}>
            Waiting on them
          </SectionLabel>
          <div className="space-y-2">
            {waitingOnThem.map((c) => {
              const ageDays = Math.round((Date.now() - new Date(c.createdAt).getTime()) / 86400000);
              return (
                <Surface key={c.id} className="flex items-center gap-3 px-5 py-3.5">
                  <Clock className="h-4 w-4 flex-shrink-0 text-sky-500" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-medium text-foreground">{c.counterpartyName}</p>
                    <p className="truncate text-[13px] text-muted">{c.text}</p>
                  </div>
                  <span className="flex-shrink-0 text-[11px] text-muted/50">{ageDays}d</span>
                  <SoftButton
                    variant="soft"
                    className="flex-shrink-0"
                    onClick={() => {
                      if (c.counterpartyEmail) {
                        act({
                          action: 'compose',
                          payload: {
                            to: c.counterpartyEmail,
                            prompt: `Write a short, friendly nudge to ${c.counterpartyName} checking in on what I'm waiting for: "${c.text}". Keep it light and gracious.`,
                          },
                        });
                      } else {
                        navigate('/commitments');
                      }
                    }}
                  >
                    Nudge
                  </SoftButton>
                </Surface>
              );
            })}
          </div>
        </section>
      )}

      {/* ── 6. LOW PRIORITY ── */}
      {lowPriorityItems.length > 0 && (
        <section>
          <button
            className="flex w-full items-center justify-between mb-4 group"
            onClick={() => setShowLowPriority((v) => !v)}
          >
            <div className="flex items-center gap-2.5">
              <span className="h-1.5 w-1.5 rounded-full bg-gray-300 dark:bg-gray-600" />
              <h2 className="text-[12px] font-bold uppercase tracking-[0.1em] text-muted/35 group-hover:text-muted/60 transition-colors">
                Low priority
              </h2>
              <span className="text-[11px] text-muted/25">{lowPriorityItems.length} can wait</span>
            </div>
            {showLowPriority
              ? <ChevronUp className="h-3.5 w-3.5 text-muted/25" />
              : <ChevronDown className="h-3.5 w-3.5 text-muted/25" />
            }
          </button>

          {showLowPriority && (
            <div className="space-y-2">
              {lowPriorityItems.map((item) => (
                <Surface
                  key={item.id}
                  interactive
                  className="px-4 py-3"
                  onClick={() => act(item.suggestions[0])}
                >
                  <div className="flex items-center gap-3">
                    {item.person && (
                      <PersonAvatar name={item.person.name} email={item.person.email} size={30} />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-foreground truncate">{item.title}</p>
                      <p className="text-[12px] text-muted truncate">{item.detail}</p>
                    </div>
                    <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                      <SoftButton variant="soft" onClick={() => act(item.suggestions[0])}>
                        {item.suggestions[0]?.label}
                      </SoftButton>
                    </div>
                  </div>
                </Surface>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── 7. AIDEN ACTIVITY ── */}
    </div>
  );
};

export default Today;
