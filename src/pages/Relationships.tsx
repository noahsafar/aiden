import React, { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Search,
  Mail,
  CalendarDays,
  CheckCircle2,
  Sparkles,
  Network,
  List as ListIcon,
  Star,
  Send,
  Inbox,
  X,
} from 'lucide-react';
import {
  SurfaceHeader,
  Surface,
  SectionLabel,
  StrengthBar,
  Pill,
  SoftButton,
  AiSuggestion,
  PersonAvatar,
  EmptyState,
  relativeTime,
} from '@/components/aiden/primitives';
import { useAidenActions } from '@/components/aiden/useAidenActions';
import { useCrmStore, Contact } from '@/stores/crmStore';
import { useEmailStore } from '@/stores/emailStore';
import { useCommitmentStore } from '@/stores/commitmentStore';
import { deriveContextBullets, recentSubjectsWith } from '@/lib/aidenBrain';
import { relationshipInsight } from '@/api/aiden';
import { NetworkGraph } from '@/components/crm/NetworkGraph';
import { cn } from '@/lib/utils';

const categoryTone: Record<string, 'violet' | 'sky' | 'emerald' | 'amber' | 'rose' | 'neutral'> = {
  Colleague: 'violet',
  Client: 'emerald',
  Vendor: 'amber',
  Friend: 'sky',
  Family: 'rose',
  Other: 'neutral',
};

const GRAPH_CATEGORIES = ['Colleague', 'Client', 'Vendor', 'Friend', 'Family', 'Other'];
const SEGMENTS = [
  { id: 'all', label: 'All' },
  { id: 'vip', label: 'VIPs' },
  { id: 'attention', label: 'Needs attention' },
  { id: 'strong', label: 'Strong' },
] as const;
type Segment = (typeof SEGMENTS)[number]['id'];
type SortBy = 'strength' | 'recent' | 'emails' | 'cooling';

export const Relationships: React.FC = () => {
  const location = useLocation();
  const { contacts, hasExtractedContacts, extractContacts, fetchNetworkData, networkData } = useCrmStore();
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'list' | 'graph'>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [segment, setSegment] = useState<Segment>('all');
  const [sortBy, setSortBy] = useState<SortBy>('strength');
  const [graphCats, setGraphCats] = useState<Set<string>>(new Set(GRAPH_CATEGORIES));

  useEffect(() => {
    if (!hasExtractedContacts) extractContacts();
  }, [hasExtractedContacts, extractContacts]);

  useEffect(() => {
    if (view === 'graph' && !networkData) fetchNetworkData();
  }, [view, networkData, fetchNetworkData]);

  // deep link from other surfaces (e.g. "open person")
  useEffect(() => {
    const focusEmail = (location.state as any)?.focusEmail;
    if (focusEmail) {
      const c = contacts.find((x) => x.email_address.toLowerCase() === String(focusEmail).toLowerCase());
      if (c) setSelectedId(c.id);
    }
  }, [location.state, contacts]);

  const isCooling = (c: Contact) => c.relationship_score >= 60 && (c.days_since_contact ?? 0) > 30;
  const attentionCount = useMemo(() => contacts.filter(isCooling).length, [contacts]);

  const filtered = useMemo(() => {
    let arr = [...contacts];
    if (segment === 'vip') arr = arr.filter((c) => c.is_vip);
    else if (segment === 'attention') arr = arr.filter(isCooling);
    else if (segment === 'strong') arr = arr.filter((c) => c.relationship_score >= 75);

    if (query.trim()) {
      const q = query.toLowerCase();
      arr = arr.filter(
        (c) =>
          (c.name || '').toLowerCase().includes(q) ||
          c.email_address.toLowerCase().includes(q) ||
          (c.domain || '').toLowerCase().includes(q),
      );
    }

    arr.sort((a, b) => {
      switch (sortBy) {
        case 'recent':
          return (b.last_contacted || 0) - (a.last_contacted || 0);
        case 'emails':
          return (b.total_emails_sent + b.total_emails_received) - (a.total_emails_sent + a.total_emails_received);
        case 'cooling':
          return (b.days_since_contact ?? 0) - (a.days_since_contact ?? 0);
        default:
          return b.relationship_score - a.relationship_score;
      }
    });
    return arr;
  }, [contacts, segment, sortBy, query]);

  const selected = contacts.find((c) => c.id === selectedId) || filtered[0] || null;
  const graphSelected = contacts.find((c) => c.id === selectedId) || null;

  const toggleGraphCat = (cat: string) => {
    setGraphCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) {
        if (next.size > 1) next.delete(cat);
      } else next.add(cat);
      return next;
    });
  };

  return (
    <div className="animate-fade-in space-y-6">
      <SurfaceHeader
        title="Relationships"
        subtitle="Your network brain — every meaningful relationship, with the context that matters."
        actions={
          <div className="flex items-center rounded-xl bg-gray-100 p-0.5 dark:bg-white/[0.06]">
            {(['list', 'graph'] as const).map((v) => (
              <button
                key={v}
                onClick={() => { setView(v); setSelectedId(null); }}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors',
                  view === v ? 'bg-white text-foreground shadow-sm dark:bg-white/[0.1]' : 'text-muted hover:text-foreground',
                )}
              >
                {v === 'list' ? <ListIcon className="h-3.5 w-3.5" /> : <Network className="h-3.5 w-3.5" />}
                {v === 'list' ? 'List' : 'Graph'}
              </button>
            ))}
          </div>
        }
      />

      {view === 'graph' ? (
        <div className="space-y-3">
          {/* Category legend */}
          <div className="flex flex-wrap items-center gap-1.5">
            {GRAPH_CATEGORIES.map((cat) => {
              const on = graphCats.has(cat);
              return (
                <button
                  key={cat}
                  onClick={() => toggleGraphCat(cat)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-all',
                    on
                      ? 'border-gray-200/70 bg-white text-foreground dark:border-white/[0.08] dark:bg-white/[0.06]'
                      : 'border-transparent text-muted/50 opacity-60',
                  )}
                >
                  <span className={cn('h-2 w-2 rounded-full', CATEGORY_DOT[cat])} />
                  {cat}
                </button>
              );
            })}
          </div>

          <Surface tone="raised" className="relative h-[640px] overflow-hidden p-0">
            <NetworkGraph
              selectedCategories={graphCats}
              selectedContactId={selectedId}
              onSelectContact={(id) => setSelectedId(id || null)}
            />
            {/* Slide-in detail panel */}
            {graphSelected && (
              <div className="absolute inset-y-0 right-0 z-10 w-[420px] max-w-[90%] animate-fade-in overflow-y-auto border-l border-gray-200/70 bg-background/95 backdrop-blur-xl dark:border-white/[0.08]">
                <button
                  onClick={() => setSelectedId(null)}
                  className="absolute right-3 top-3 z-10 rounded-lg p-1.5 text-muted transition-colors hover:bg-gray-100 hover:text-foreground dark:hover:bg-white/[0.06]"
                >
                  <X className="h-4 w-4" />
                </button>
                <div className="p-2">
                  <PersonDetail key={graphSelected.id} contact={graphSelected} bare />
                </div>
              </div>
            )}
          </Surface>
        </div>
      ) : !hasExtractedContacts ? (
        <Surface tone="subtle" className="px-6 py-10 text-center text-sm text-muted">
          Building your relationship graph from your conversations…
        </Surface>
      ) : contacts.length === 0 ? (
        <EmptyState icon={<Inbox className="h-5 w-5" />} title="No relationships yet" description="As you exchange emails, people will appear here with full context." />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
          {/* Master list */}
          <div className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search people…"
                className="w-full rounded-xl border border-gray-200/70 bg-white py-2.5 pl-9 pr-3 text-sm text-foreground outline-none transition-colors focus:border-violet-400 dark:border-white/[0.07] dark:bg-white/[0.04]"
              />
            </div>

            {/* Segment filters */}
            <div className="flex flex-wrap gap-1.5">
              {SEGMENTS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSegment(s.id)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors',
                    segment === s.id
                      ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                      : 'bg-gray-100 text-muted hover:text-foreground dark:bg-white/[0.06]',
                  )}
                >
                  {s.label}
                  {s.id === 'attention' && attentionCount > 0 && (
                    <span className={cn('rounded-full px-1.5 text-[10px] font-semibold', segment === s.id ? 'bg-white/20' : 'bg-amber-500/15 text-amber-600 dark:text-amber-400')}>
                      {attentionCount}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Sort */}
            <div className="flex items-center gap-2 px-1">
              <span className="text-[11px] text-muted/60">Sort</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortBy)}
                className="bg-transparent text-[12px] font-medium text-muted outline-none hover:text-foreground"
              >
                <option value="strength">Strength</option>
                <option value="recent">Last contact</option>
                <option value="emails">Most emails</option>
                <option value="cooling">Cooling first</option>
              </select>
            </div>

            <div className="space-y-1.5">
              {filtered.map((c) => {
                const cooling = isCooling(c);
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors',
                      selected?.id === c.id
                        ? 'bg-white shadow-elevated-sm dark:bg-white/[0.07]'
                        : 'hover:bg-gray-100/70 dark:hover:bg-white/[0.04]',
                    )}
                  >
                    <PersonAvatar name={c.name} email={c.email_address} size={38} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[14px] font-medium text-foreground">
                          {c.name || c.email_address.split('@')[0]}
                        </span>
                        {c.is_vip && <Star className="h-3 w-3 flex-shrink-0 fill-amber-400 text-amber-400" />}
                        {c.last_contacted && (
                          <span className={cn('ml-auto flex-shrink-0 text-[11px]', cooling ? 'text-amber-500' : 'text-muted/50')}>
                            {relativeTime(c.last_contacted)}
                          </span>
                        )}
                      </div>
                      <div className="mt-1">
                        <StrengthBar value={c.relationship_score} />
                      </div>
                    </div>
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <p className="px-3 py-6 text-center text-[13px] text-muted/60">No one matches that filter.</p>
              )}
            </div>
          </div>

          {/* Detail */}
          <div>{selected ? <PersonDetail key={selected.id} contact={selected} /> : null}</div>
        </div>
      )}
    </div>
  );
};

const CATEGORY_DOT: Record<string, string> = {
  Colleague: 'bg-violet-500',
  Client: 'bg-emerald-500',
  Vendor: 'bg-amber-500',
  Friend: 'bg-sky-500',
  Family: 'bg-rose-500',
  Other: 'bg-slate-400',
};

const PersonDetail: React.FC<{ contact: Contact; bare?: boolean }> = ({ contact, bare = false }) => {
  const act = useAidenActions();
  const emails = useEmailStore((s) => s.emails);
  const sentEmails = useEmailStore((s) => s.sentEmails);
  const commitments = useCommitmentStore((s) => s.commitments);
  const [insight, setInsight] = useState<string>('');

  const context = useMemo(
    () => deriveContextBullets(emails, sentEmails, contact.email_address),
    [emails, sentEmails, contact.email_address],
  );
  const subjects = useMemo(
    () => recentSubjectsWith(emails, sentEmails, contact.email_address),
    [emails, sentEmails, contact.email_address],
  );
  const personCommitments = useMemo(
    () =>
      commitments.filter(
        (c) =>
          c.status === 'open' &&
          c.counterpartyEmail?.toLowerCase() === contact.email_address.toLowerCase(),
      ),
    [commitments, contact.email_address],
  );

  useEffect(() => {
    let cancelled = false;
    relationshipInsight({
      name: contact.name || contact.email_address.split('@')[0],
      daysSinceContact: contact.days_since_contact,
      relationshipScore: contact.relationship_score,
      category: contact.category,
      pendingFromYou: personCommitments.filter((c) => c.direction === 'you_owe').length,
    }).then((i) => {
      if (!cancelled) setInsight(i);
    });
    return () => {
      cancelled = true;
    };
  }, [contact, personCommitments]);

  const name = contact.name || contact.email_address.split('@')[0];
  const role = contact.domain ? `${contact.category} · ${contact.domain}` : contact.category;

  const history = [
    { icon: Mail, label: 'emails', value: (contact.total_emails_received || 0) + (contact.total_emails_sent || 0) },
    { icon: Send, label: 'sent', value: contact.total_emails_sent || 0 },
    { icon: Inbox, label: 'received', value: contact.total_emails_received || 0 },
    { icon: CalendarDays, label: 'threads', value: contact.total_threads || 0 },
  ];

  return (
    <DetailShell bare={bare}>
      {/* Header */}
      <div className="flex items-start gap-4">
        <PersonAvatar name={name} email={contact.email_address} size={56} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold text-foreground">{name}</h2>
            {contact.is_vip && <Star className="h-4 w-4 fill-amber-400 text-amber-400" />}
          </div>
          <p className="text-[14px] text-muted">{role}</p>
          <p className="text-[13px] text-muted/70">{contact.email_address}</p>
        </div>
        <SoftButton
          variant="primary"
          icon={<Sparkles className="h-3.5 w-3.5" />}
          onClick={() => act({ action: 'ask', payload: { q: `Prepare me for my meeting with ${name}`, run: true } })}
        >
          Prep me
        </SoftButton>
      </div>

      {/* Strength */}
      <div className="mt-5 flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3 dark:bg-white/[0.03]">
        <div>
          <div className="text-[12px] font-medium uppercase tracking-wide text-muted">Relationship strength</div>
          <div className="mt-1.5">
            <StrengthBar value={contact.relationship_score} showLabel />
          </div>
        </div>
        <div className="text-right">
          <div className="text-[12px] text-muted">Last contact</div>
          <div className="text-[14px] font-medium text-foreground">
            {contact.last_contacted ? relativeTime(contact.last_contacted) : '—'}
          </div>
        </div>
      </div>

      {/* Aiden suggestion */}
      {insight && <AiSuggestion className="mt-4">{insight}</AiSuggestion>}

      {/* Important context */}
      {context.length > 0 && (
        <div className="mt-6">
          <SectionLabel className="mb-3">Important context</SectionLabel>
          <ul className="space-y-2">
            {context.map((b, i) => (
              <li key={i} className="flex items-start gap-2.5 text-[14px] text-foreground/90">
                <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-violet-400" />
                {b}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Open commitments with this person */}
      {personCommitments.length > 0 && (
        <div className="mt-6">
          <SectionLabel className="mb-3" count={personCommitments.length}>
            Open commitments
          </SectionLabel>
          <div className="space-y-2">
            {personCommitments.map((c) => (
              <div key={c.id} className="flex items-center gap-3 rounded-xl bg-gray-50 px-3.5 py-2.5 dark:bg-white/[0.03]">
                <CheckCircle2 className={cn('h-4 w-4 flex-shrink-0', c.direction === 'you_owe' ? 'text-amber-500' : 'text-sky-500')} />
                <span className="flex-1 text-[13px] text-foreground">{c.text}</span>
                <Pill tone={c.direction === 'you_owe' ? 'amber' : 'sky'}>{c.direction === 'you_owe' ? 'You owe' : 'Waiting'}</Pill>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* History */}
      <div className="mt-6 grid grid-cols-4 gap-3">
        {history.map((h) => (
          <div key={h.label} className="rounded-xl bg-gray-50 px-3 py-3 text-center dark:bg-white/[0.03]">
            <h.icon className="mx-auto h-4 w-4 text-muted" />
            <div className="mt-1.5 text-lg font-semibold tabular-nums text-foreground">{h.value}</div>
            <div className="text-[11px] text-muted">{h.label}</div>
          </div>
        ))}
      </div>

      {/* Recent threads */}
      {subjects.length > 0 && (
        <div className="mt-6">
          <SectionLabel className="mb-3">Recent threads</SectionLabel>
          <div className="space-y-1">
            {subjects.map((s, i) => (
              <div key={i} className="truncate rounded-lg px-2 py-1.5 text-[13px] text-muted hover:bg-gray-50 dark:hover:bg-white/[0.03]">
                {s}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer actions */}
      <div className="mt-6 flex gap-2 border-t border-gray-100 pt-5 dark:border-white/[0.06]">
        <SoftButton variant="soft" icon={<Mail className="h-3.5 w-3.5" />} onClick={() => act({ action: 'compose', payload: { to: contact.email_address } })}>
          Email {name.split(' ')[0]}
        </SoftButton>
        <SoftButton variant="ghost" icon={<CalendarDays className="h-3.5 w-3.5" />} onClick={() => act({ action: 'schedule', payload: { to: contact.email_address } })}>
          Schedule time
        </SoftButton>
      </div>
    </DetailShell>
  );
};

const DetailShell: React.FC<{ bare?: boolean; children: React.ReactNode }> = ({ bare, children }) =>
  bare ? <div className="p-5">{children}</div> : <Surface className="p-6">{children}</Surface>;

export default Relationships;
