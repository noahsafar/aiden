import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams, useLocation } from 'react-router-dom';
import {
  Sparkles,
  ArrowUp,
  Target,
  Users,
  Mail,
  CalendarDays,
  CheckCircle2,
  AlertCircle,
  Lightbulb,
  Ban,
  HelpCircle,
} from 'lucide-react';
import {
  Surface,
  SectionLabel,
  Pill,
  SoftButton,
  PersonAvatar,
  AiSuggestion,
} from '@/components/aiden/primitives';
import { useAidenActions } from '@/components/aiden/useAidenActions';
import { useEmailStore } from '@/stores/emailStore';
import { useCrmStore, Contact } from '@/stores/crmStore';
import { useCommitmentStore } from '@/stores/commitmentStore';
import { useChannelStore } from '@/stores/channelStore';
import { useChatStore } from '@/stores/chatStore';
import { useAuthStore } from '@/stores/authStore';
import {
  deriveAttention,
  deriveContextBullets,
  recentSubjectsWith,
  AttentionItem,
} from '@/lib/aidenBrain';
import { generateMeetingBrief, generateEventBrief, answerFromContext, MeetingBrief } from '@/api/aiden';
import { fetchUrlContent, CalendarEvent } from '@/api/calendar';
import { parseSender } from '@/lib/senders';
import { Commitment } from '@/lib/commitments';
import { cn } from '@/lib/utils';

type AskResult =
  | { kind: 'brief'; brief: MeetingBrief; person: string; context: string[]; subjects: string[] }
  | { kind: 'attention'; items: AttentionItem[] }
  | { kind: 'people'; contacts: Contact[]; topic: string }
  | { kind: 'commitments'; items: Commitment[] }
  | { kind: 'text'; text: string };

interface Turn {
  prompt: string;
  loading: boolean;
  status?: string;
  result?: AskResult;
}

const SUGGESTIONS = [
  { icon: Target, text: 'What needs my attention today?' },
  { icon: Sparkles, text: 'Prepare me for my meeting with Sarah Chen' },
  { icon: Users, text: 'Who can help with fundraising?' },
  { icon: CheckCircle2, text: 'What did I commit to this week?' },
];

export const Ask: React.FC = () => {
  const act = useAidenActions();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const emails = useEmailStore((s) => s.emails);
  const sentEmails = useEmailStore((s) => s.sentEmails);
  const { contacts, hasExtractedContacts, extractContacts } = useCrmStore();
  const { commitments, hasExtracted, extract } = useCommitmentStore();
  const slack = useChannelStore((s) => s.slackMessages);

  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoRunFired = useRef(false);

  useEffect(() => {
    if (!hasExtractedContacts) extractContacts();
    if (!hasExtracted) extract();
  }, [hasExtractedContacts, hasExtracted, extractContacts, extract]);

  // Deep link: /ask?q=...&run=1, or event state from Today "Prep me"
  useEffect(() => {
    if (autoRunFired.current) return;
    autoRunFired.current = true;
    const ev = (location.state as any)?.event as CalendarEvent | undefined;
    if (ev && (location.state as any)?.run) {
      setInput(`Prepare me for ${ev.summary}`);
      runEventPrep(ev);
      // Clear router state so a remount (route away + back) doesn't re-run the brief.
      window.history.replaceState({}, '');
      return;
    }
    const q = params.get('q');
    if (q) {
      setInput(q);
      if (params.get('run') === '1') {
        run(q);
      }
      setParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns]);

  // Search the inbox for the most relevant emails and answer the question from them.
  async function answerFromInbox(question: string): Promise<AskResult> {
    const STOP = new Set([
      'what', 'who', 'when', 'where', 'why', 'how', 'which', 'whose', 'about', 'the', 'this',
      'that', 'is', 'are', 'was', 'were', 'do', 'does', 'did', 'i', 'my', 'me', 'of', 'on', 'in',
      'for', 'to', 'a', 'an', 'with', 'any', 'there', 'tell', 'give', 'show', 'meeting', 'email',
      'latest', 'update', 'status', 'happening', 'anything',
    ]);
    const terms = question.toLowerCase().split(/\W+/).filter((w) => w.length >= 3 && !STOP.has(w));
    const all = [...emails, ...sentEmails];
    const scored = all
      .map((e) => {
        const hay = `${e.subject || ''} ${e.body_text || e.snippet || ''}`.toLowerCase();
        const score = terms.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0);
        return { e, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);

    if (scored.length === 0) {
      return { kind: 'text', text: `I searched your inbox but couldn't find anything about that.` };
    }
    const context = scored
      .map(({ e }) => {
        const from = parseSender(e.sender || '').name || e.sender || 'unknown';
        const when = e.date ? ` (${new Date(e.date).toLocaleDateString()})` : '';
        return `From ${from}${when}: "${e.subject || '(no subject)'}"\n${(e.body_text || e.snippet || '').slice(0, 500)}`;
      })
      .join('\n\n---\n\n');
    const answer = await answerFromContext(question, context);
    if (answer) return { kind: 'text', text: answer };
    return { kind: 'text', text: `Here's what I found in your inbox:\n${scored.map(({ e }) => `• ${e.subject || '(no subject)'}`).join('\n')}` };
  }

  async function resolve(prompt: string): Promise<AskResult> {
    const p = prompt.toLowerCase();

    // Meeting brief
    const briefMatch = p.match(/(?:prep(?:are)?|brief|ready)\b.*?\b(?:with|for|meeting with)\s+(.+)$/);
    if (/\b(prep|prepare|brief)\b/.test(p) && briefMatch) {
      const personQuery = briefMatch[1].replace(/[?.!]$/, '').trim();
      const contact = bestContactMatch(contacts, personQuery);
      const name = contact?.name || personQuery;
      const email = contact?.email_address;
      const context = deriveContextBullets(emails, sentEmails, email);
      const subjects = recentSubjectsWith(emails, sentEmails, email);
      const personCommitments = commitments.filter(
        (c) => c.status === 'open' && email && c.counterpartyEmail?.toLowerCase() === email.toLowerCase(),
      );
      const brief = await generateMeetingBrief({
        personName: name,
        personEmail: email,
        role: contact ? `${contact.category}${contact.domain ? ` · ${contact.domain}` : ''}` : undefined,
        lastContact: contact?.last_contacted ? new Date(contact.last_contacted).toLocaleDateString() : undefined,
        relationshipScore: contact?.relationship_score,
        recentSubjects: subjects,
        context,
        openCommitments: personCommitments,
      });
      return { kind: 'brief', brief, person: name, context, subjects };
    }

    // Compose / send an email to someone — draft it (never answer it as a question).
    const COMPOSE_VERB = /^(send|write|draft|compose|shoot|fire off|email|message|ask|tell|reach out to|reach out|follow up with|follow up|ping)\b/i;
    if (COMPOSE_VERB.test(prompt.trim())) {
      const nameMatch = prompt.match(
        /\b(?:to|email|ask|tell|message|ping|with)\s+([A-Za-z][\w'’.-]*(?:\s+[A-Z][a-z]+)?)/i,
      );
      const rawName = nameMatch?.[1]?.trim();
      const contact = rawName ? bestContactMatch(contacts, rawName) : undefined;
      if (contact) {
        const who = contact.name || rawName!;
        // Is there actual content beyond "email <name>"? If so, auto-draft from it.
        const residual = prompt
          .replace(COMPOSE_VERB, ' ')
          .replace(/\b(an?|the|to|email|message|note)\b/gi, ' ')
          .replace(new RegExp(`\\b${rawName!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'), ' ')
          .trim();
        const hasContent = residual.split(/\s+/).filter(Boolean).length >= 2;
        act({
          action: 'compose',
          payload: { to: contact.email_address, prompt: hasContent ? prompt : undefined },
        });
        return {
          kind: 'text',
          text: hasContent
            ? `Drafting your email to ${who} now — review and send when it looks right.`
            : `Opening a draft to ${who} — tell me what you'd like to say.`,
        };
      }
    }

    // Attention
    if (/\b(attention|focus|matter|important|priorit|what should i|catch me up|today)\b/.test(p)) {
      const items = deriveAttention({ emails, sentEmails, contacts, commitments, slack, userEmail: user?.email });
      return { kind: 'attention', items };
    }

    // Commitments
    if (/\b(commit|promise|owe|dropped|follow.?up|task)\b/.test(p)) {
      return { kind: 'commitments', items: commitments.filter((c) => c.status === 'open') };
    }

    // Who can help / who knows
    const whoMatch = p.match(/who\s+(?:can help with|knows about|do i know (?:in|for|about)|works on|could help with)\s+(.+)$/);
    if (whoMatch) {
      const topic = whoMatch[1].replace(/[?.!]$/, '').trim();
      return { kind: 'people', contacts: findPeopleFor(topic, contacts, emails, sentEmails), topic };
    }

    // General question → answer it directly from the inbox, no prompting.
    const isActionCommand = /\b(reply|respond to|draft|compose|write|send|forward|archive|delete|mark|snooze|schedule|unsubscribe|create|add)\b/.test(p);
    const looksLikeQuestion =
      prompt.trim().endsWith('?') ||
      /\b(what|who|when|where|why|how|which|whose|is|are|was|were|do i|did|tell me|summar|status|update on|about|latest on|happening with|anything (on|about))\b/.test(p);
    if (!isActionCommand && looksLikeQuestion) {
      return await answerFromInbox(prompt);
    }

    // Fallback: route through the existing chat command system (search/compose/etc.)
    try {
      const chat = useChatStore.getState();
      const before = chat.messages.length;
      await chat.sendMessage(prompt, 'typed');
      const after = useChatStore.getState().messages;
      const reply = after.slice(before).reverse().find((m) => m.role === 'assistant');
      return { kind: 'text', text: reply?.content || "I've handled that." };
    } catch {
      return { kind: 'text', text: "I couldn't reach the assistant just now, but your other surfaces are up to date." };
    }
  }

  async function run(prompt: string) {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    setInput('');
    const index = turns.length;
    setTurns((t) => [...t, { prompt: trimmed, loading: true }]);
    const result = await resolve(trimmed);
    setTurns((t) => t.map((turn, i) => (i === index ? { ...turn, loading: false, result } : turn)));
  }

  async function runEventPrep(ev: CalendarEvent) {
    const label = `Prepare me for ${ev.summary}`;
    setInput('');
    const index = turns.length;
    setTurns((t) => [...t, { prompt: label, loading: true, status: 'Searching related emails…' }]);
    const setStatus = (status: string) =>
      setTurns((t) => t.map((turn, i) => (i === index ? { ...turn, status } : turn)));

    // 1. Find genuinely related emails — high precision so one meeting's brief never
    //    pulls in an unrelated thread. Two signals:
    //    (a) the email involves an actual attendee of this meeting, or
    //    (b) the email subject shares a DISTINCTIVE keyword from the meeting title.
    //    Generic meeting words (meeting, sync, planning, review, weekly, …) are
    //    excluded so they can't cross-match unrelated meetings.
    const STOP = new Set([
      'meeting', 'meet', 'sync', 'call', 'planning', 'plan', 'review', 'update', 'updates',
      'weekly', 'monthly', 'daily', 'standup', 'catchup', 'catch', 'check', 'checkin', 'chat',
      'discussion', 'discuss', 'team', 'session', 'quick', 'touch', 'base', 'intro', 'prep',
      'hold', 'calendar', 'invite', 'time', 'agenda', 'notes', 'follow', 'followup',
      'morning', 'afternoon', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday',
      'this', 'next', 'with', 'and', 'the', 'for',
    ]);
    const keywords = ev.summary
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length >= 4 && !STOP.has(w));
    const attendeesLower = (ev.attendees || []).map((a) => a.toLowerCase()).filter(Boolean);
    const allEmails = [...emails, ...sentEmails];
    const relatedEmails = allEmails
      .filter((e) => {
        const people = `${e.sender || ''} ${e.recipients || ''}`.toLowerCase();
        const involvesAttendee = attendeesLower.some((a) => people.includes(a));
        if (involvesAttendee) return true;
        if (keywords.length === 0) return false;
        const sub = (e.subject || '').toLowerCase();
        return keywords.some((k) => sub.includes(k));
      })
      .slice(0, 6)
      .map((e) => ({
        subject: e.subject || '',
        from: parseSender(e.sender || '').name || e.sender || '',
        snippet: (e.body_text || e.snippet || '').slice(0, 250),
      }));

    // 2. Fetch linked doc content from description
    const docContents: string[] = [];
    if (ev.description) {
      const urlMatches = ev.description.match(/https?:\/\/[^\s<>"']+/g) || [];
      const docUrls = urlMatches.filter((u) =>
        /docs\.google\.com|drive\.google\.com|notion\.so|confluence/.test(u),
      );
      if (docUrls.length > 0) {
        setStatus('Reading linked documents…');
        for (const url of docUrls.slice(0, 2)) {
          const text = await fetchUrlContent(url);
          if (text.trim()) docContents.push(text);
        }
      }
    }

    // 3. Open commitments with attendees
    const openCommitmentTexts = commitments
      .filter(
        (c) =>
          c.status === 'open' &&
          (ev.attendees || []).some(
            (a) => c.counterpartyEmail?.toLowerCase() === a.toLowerCase(),
          ),
      )
      .map((c) => c.text);

    setStatus('Generating brief…');
    const brief = await generateEventBrief({
      summary: ev.summary,
      time: ev.time,
      endTime: ev.end_time,
      location: ev.location,
      description: ev.description,
      attendees: ev.attendees,
      relatedEmails,
      docContents,
      openCommitmentTexts,
    });

    const result: AskResult = { kind: 'brief', brief, person: ev.summary, context: [], subjects: [] };
    setTurns((t) => t.map((turn, i) => (i === index ? { ...turn, loading: false, result } : turn)));
  }

  const hasTurns = turns.length > 0;

  return (
    <div className="flex h-full flex-col">
      {/* Scrollable transcript */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-8 py-10">
          {!hasTurns ? (
            <div className="flex min-h-[55vh] flex-col items-center justify-center text-center animate-fade-in">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-500 shadow-elevated-md">
                <Sparkles className="h-7 w-7 text-white" />
              </div>
              <h1 className="mt-5 text-[28px] font-semibold tracking-tight text-foreground">Ask Aiden</h1>
              <p className="mt-2 max-w-md text-[15px] text-muted">
                Your chief of staff. Ask for a meeting brief, what needs attention, or who can help —
                Aiden knows your relationships and commitments.
              </p>
              <div className="mt-8 grid w-full max-w-xl gap-2.5 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.text}
                    onClick={() => run(s.text)}
                    className="group flex items-center gap-3 rounded-xl border border-gray-200/70 bg-white px-4 py-3 text-left text-[14px] text-foreground transition-all hover:border-violet-300 hover:shadow-elevated-sm dark:border-white/[0.07] dark:bg-white/[0.04] dark:hover:border-violet-500/40"
                  >
                    <s.icon className="h-4 w-4 flex-shrink-0 text-violet-500" />
                    <span className="flex-1">{s.text}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-8">
              {turns.map((turn, i) => (
                <div key={i} className="space-y-4 animate-fade-in">
                  {/* prompt */}
                  <div className="flex items-start gap-3">
                    <PersonAvatar name={user?.name} email={user?.email} size={28} />
                    <p className="pt-1 text-[16px] font-medium text-foreground">{turn.prompt}</p>
                  </div>
                  {/* response */}
                  <div className="flex items-start gap-3">
                    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-500">
                      <Sparkles className="h-3.5 w-3.5 text-white" />
                    </div>
                    <div className="min-w-0 flex-1">
                      {turn.loading ? (
                        <div className="flex items-center gap-2 pt-2">
                          <span className="h-2 w-2 animate-bounce rounded-full bg-muted [animation-delay:-0.3s]" />
                          <span className="h-2 w-2 animate-bounce rounded-full bg-muted [animation-delay:-0.15s]" />
                          <span className="h-2 w-2 animate-bounce rounded-full bg-muted" />
                          {turn.status && (
                            <span className="text-[13px] text-muted/60 animate-fade-in">{turn.status}</span>
                          )}
                        </div>
                      ) : (
                        turn.result && <ResultView result={turn.result} act={act} />
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Composer — fixed 72px footer so its divider aligns exactly with the
          sidebar profile footer (p-3 + 32px avatar = 72px). */}
      <div className="flex min-h-[72px] items-center border-t border-gray-200/70 bg-background/80 px-8 backdrop-blur-xl dark:border-white/[0.06]">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(input);
          }}
          className="mx-auto flex w-full max-w-3xl items-end gap-2 rounded-2xl border border-gray-200/80 bg-white px-4 py-2 shadow-elevated-sm focus-within:border-violet-400 dark:border-white/[0.08] dark:bg-white/[0.04]"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                run(input);
              }
            }}
            rows={1}
            placeholder="Ask Aiden anything…"
            className="max-h-32 flex-1 resize-none bg-transparent py-1.5 text-[15px] text-foreground outline-none placeholder:text-muted"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gray-900 text-white transition-all hover:bg-gray-800 disabled:opacity-40 dark:bg-white dark:text-gray-900"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Result renderers                                                    */
/* ------------------------------------------------------------------ */

const ResultView: React.FC<{ result: AskResult; act: ReturnType<typeof useAidenActions> }> = ({ result, act }) => {
  if (result.kind === 'brief') {
    const { brief, person, context, subjects } = result;
    return (
      <Surface className="overflow-hidden">
        <div className="border-b border-gray-100 bg-gradient-to-br from-violet-50/60 to-transparent px-6 py-5 dark:border-white/[0.06] dark:from-violet-500/[0.06]">
          <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-violet-500">
            <Sparkles className="h-3.5 w-3.5" /> Meeting brief
          </div>
          <h3 className="mt-1.5 text-xl font-semibold text-foreground">{person}</h3>
          {brief.headline.startsWith('Could not') ? (
            <p className="mt-1 text-[12px] text-rose-500/80">{brief.headline}</p>
          ) : brief.headline && !brief.headline.toLowerCase().startsWith(person.toLowerCase()) ? (
            <p className="mt-1 text-[14px] text-muted">{brief.headline}</p>
          ) : null}
        </div>
        {brief.generatedByAi && brief.objectives.length === 0 && brief.suggestedQuestions.length === 0 && brief.watchOuts.length === 0 && context.length === 0 && subjects.length === 0 && (
          <div className="px-6 py-4">
            <p className="text-[13px] text-muted/60">No emails or calendar details found for this meeting — nothing to brief on.</p>
          </div>
        )}
        {(brief.objectives.length > 0 || brief.suggestedQuestions.length > 0 || brief.watchOuts.length > 0 || context.length > 0 || subjects.length > 0) && (
        <div className="space-y-5 px-6 py-5">
          {brief.objectives.length > 0 && (
            <BriefBlock icon={<Target className="h-4 w-4 text-sky-500" />} title="Objectives" items={brief.objectives} />
          )}
          {brief.suggestedQuestions.length > 0 && (
            <BriefBlock
              icon={<HelpCircle className="h-4 w-4 text-emerald-500" />}
              title="Suggested questions"
              items={brief.suggestedQuestions}
              quote
            />
          )}
          {context.length > 0 && (
            <BriefBlock icon={<Lightbulb className="h-4 w-4 text-amber-500" />} title="What they care about" items={context} />
          )}
          {brief.watchOuts.length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-foreground">
                <Ban className="h-4 w-4 text-rose-500" /> Tread carefully
              </div>
              <ul className="space-y-1.5">
                {brief.watchOuts.map((w, i) => (
                  <li key={i} className="rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {subjects.length > 0 && (
            <div className="border-t border-gray-100 pt-4 dark:border-white/[0.06]">
              <div className="mb-2 text-[12px] font-medium uppercase tracking-wide text-muted">Recent threads</div>
              <div className="flex flex-wrap gap-1.5">
                {subjects.slice(0, 4).map((s, i) => (
                  <Pill key={i} tone="neutral">
                    {s.length > 32 ? s.slice(0, 30) + '…' : s}
                  </Pill>
                ))}
              </div>
            </div>
          )}
        </div>
        )}
      </Surface>
    );
  }

  if (result.kind === 'attention') {
    if (result.items.length === 0)
      return <p className="pt-1.5 text-[15px] text-muted">You're all caught up — nothing needs your attention right now.</p>;
    return (
      <div className="space-y-2">
        <p className="pt-1.5 text-[15px] text-foreground">Here's what needs you, in order:</p>
        {result.items.map((item) => (
          <Surface key={item.id} interactive className="px-4 py-3" onClick={() => act(item.suggestions[0])}>
            <div className="flex items-center gap-3">
              <AlertCircle className="h-4 w-4 flex-shrink-0 text-rose-500" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-medium text-foreground">{item.title}</div>
                <div className="truncate text-[13px] text-muted">{item.detail}</div>
              </div>
              {item.meta && <span className="flex-shrink-0 text-[12px] text-muted/70">{item.meta}</span>}
            </div>
          </Surface>
        ))}
      </div>
    );
  }

  if (result.kind === 'commitments') {
    if (result.items.length === 0)
      return <p className="pt-1.5 text-[15px] text-muted">No open commitments — clean slate.</p>;
    return (
      <div className="space-y-2">
        <p className="pt-1.5 text-[15px] text-foreground">You have {result.items.length} open commitment{result.items.length > 1 ? 's' : ''}:</p>
        {result.items.map((c) => (
          <Surface key={c.id} className="px-4 py-3">
            <div className="flex items-center gap-3">
              <CheckCircle2 className={cn('h-4 w-4', c.direction === 'you_owe' ? 'text-amber-500' : 'text-sky-500')} />
              <span className="flex-1 text-[14px] text-foreground">{c.text}</span>
              <Pill tone={c.direction === 'you_owe' ? 'amber' : 'sky'}>{c.counterpartyName}</Pill>
            </div>
          </Surface>
        ))}
      </div>
    );
  }

  if (result.kind === 'people') {
    if (result.contacts.length === 0)
      return <p className="pt-1.5 text-[15px] text-muted">I couldn't find anyone in your network clearly connected to "{result.topic}".</p>;
    return (
      <div className="space-y-2">
        <p className="pt-1.5 text-[15px] text-foreground">
          People in your network who could help with <span className="font-medium">{result.topic}</span>:
        </p>
        {result.contacts.map((c) => (
          <Surface key={c.id} interactive className="px-4 py-3" onClick={() => act({ action: 'compose', payload: { to: c.email_address } })}>
            <div className="flex items-center gap-3">
              <PersonAvatar name={c.name} email={c.email_address} size={34} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-medium text-foreground">{c.name || c.email_address}</div>
                <div className="text-[12px] text-muted">{c.category}{c.domain ? ` · ${c.domain}` : ''}</div>
              </div>
              <Pill tone="emerald">{c.relationship_score}</Pill>
            </div>
          </Surface>
        ))}
      </div>
    );
  }

  // text
  return <p className="whitespace-pre-wrap pt-1.5 text-[15px] leading-relaxed text-foreground">{result.text}</p>;
};

const BriefBlock: React.FC<{ icon: React.ReactNode; title: string; items: string[]; quote?: boolean }> = ({
  icon,
  title,
  items,
  quote,
}) => (
  <div>
    <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-foreground">
      {icon} {title}
    </div>
    <ul className="space-y-1.5">
      {items.map((it, i) => (
        <li key={i} className="flex items-start gap-2.5 text-[14px] leading-relaxed text-foreground/90">
          <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gray-300 dark:bg-white/20" />
          <span>{quote ? `"${it}"` : it}</span>
        </li>
      ))}
    </ul>
  </div>
);

/* ------------------------------------------------------------------ */
/* Matching helpers                                                    */
/* ------------------------------------------------------------------ */

function bestContactMatch(contacts: Contact[], query: string): Contact | undefined {
  const q = query.toLowerCase().trim();
  if (!q) return undefined;
  // exact name, then startsWith, then includes, then first-name
  return (
    contacts.find((c) => (c.name || '').toLowerCase() === q) ||
    contacts.find((c) => (c.name || '').toLowerCase().startsWith(q)) ||
    contacts.find((c) => (c.name || '').toLowerCase().includes(q)) ||
    contacts.find((c) => c.email_address.toLowerCase().includes(q)) ||
    contacts.find((c) => (c.name || '').toLowerCase().split(' ')[0] === q.split(' ')[0])
  );
}

function findPeopleFor(topic: string, contacts: Contact[], emails: any[], sentEmails: any[]): Contact[] {
  const t = topic.toLowerCase();
  const scored = new Map<string, number>();
  const all = [...emails, ...sentEmails];
  for (const e of all) {
    const text = `${e.subject || ''} ${e.body_text || e.snippet || ''}`.toLowerCase();
    if (text.includes(t)) {
      const senderEmail = (e.sender || e.recipients || '').match(/<([^>]+)>/)?.[1]?.toLowerCase();
      if (senderEmail) scored.set(senderEmail, (scored.get(senderEmail) || 0) + 1);
    }
  }
  const ranked = contacts
    .map((c) => ({
      c,
      score: (scored.get(c.email_address.toLowerCase()) || 0) * 100 + c.relationship_score,
      topical: scored.has(c.email_address.toLowerCase()),
    }))
    .filter((x) => x.topical || x.c.relationship_score >= 60)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((x) => x.c);
  return ranked;
}

export default Ask;
