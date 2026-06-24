/**
 * Aiden Brain — the synthesis layer.
 *
 * Turns raw signals (emails, sent mail, contacts, commitments, Slack) into
 * *decisions*: what needs attention and why, what opportunities exist, what to
 * prep for. Every item carries CONTEXT (why it matters) and a RECOMMENDATION
 * (what to do) — the difference between an inbox and a chief of staff.
 */

import { Commitment, isOverdue, dueLabel, resolveDueDate } from '@/lib/commitments';
import { relativeTime } from '@/components/aiden/primitives';
import { parseSender, isAutomatedSender, isSelf } from '@/lib/senders';
import type { Contact } from '@/stores/crmStore';
import type { UnifiedMessage } from '@/stores/channelStore';

export interface ActionSuggestion {
  label: string;
  action: string; // 'reply' | 'open' | 'bump' | 'mark_done' | 'compose' | 'ask' | 'open_slack' | ...
  payload?: Record<string, unknown>;
}

export interface AttentionItem {
  id: string;
  kind: 'commitment_overdue' | 'awaiting_reply' | 'urgent_email' | 'needs_reply' | 'slack';
  /** the person or source */
  title: string;
  /** outcome-framed header: "Unblock Sarah's timeline" not "Respond to Sarah" */
  outcomeTitle: string;
  /** the ask / subject line */
  detail: string;
  /** situation: what's actually happening */
  situation?: string;
  /** why it matters: the impact/consequence */
  whyItMatters?: string;
  /** the chief-of-staff recommendation: what to do */
  recommendation?: string;
  meta?: string;
  person?: { name: string; email?: string };
  emailId?: string;
  threadId?: string;
  channel?: 'email' | 'slack';
  severity: number;
  suggestions: ActionSuggestion[];
}

export interface Opportunity {
  id: string;
  title: string;
  /** outcome-framed header for Today's Focus card */
  outcomeTitle: string;
  detail: string;
  /** timing: why now */
  whyNow?: string;
  /** unique value you bring */
  yourAdvantage?: string;
  recommendation?: string;
  person?: { name: string; email?: string };
  emailId?: string;
  suggestions: ActionSuggestion[];
}

interface BrainInput {
  emails: any[];
  sentEmails: any[];
  contacts: Contact[];
  commitments: Commitment[];
  slack: UnifiedMessage[];
  userEmail?: string;
}

function truncate(str: string, limit: number): string {
  if (str.length <= limit) return str;
  const cut = str.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut) + '…';
}

function findContact(contacts: Contact[], email?: string): Contact | undefined {
  if (!email) return undefined;
  return contacts.find((c) => c.email_address.toLowerCase() === email.toLowerCase());
}

/** Short relationship descriptor: "Key client · last spoke 9d ago". */
function relContext(contact?: Contact): string {
  if (!contact) return '';
  let label = contact.category && contact.category !== 'Other' ? contact.category : 'Contact';
  if (contact.relationship_score >= 75) label = `Key ${label.toLowerCase()}`;
  const parts = [label];
  if (contact.last_contacted) parts.push(`last spoke ${relativeTime(contact.last_contacted)}`);
  return parts.join(' · ');
}

/* ------------------------------------------------------------------ */
/* Outcome-title generators (heuristic, no AI required)               */
/* ------------------------------------------------------------------ */

function buildAttentionOutcome(
  kind: AttentionItem['kind'],
  name: string,
  detail: string,
): string {
  const first = name.split(' ')[0];
  const d = (detail || '').toLowerCase();
  switch (kind) {
    case 'commitment_overdue':
      if (/\b(send|forward|share|email)\b/.test(d)) return `Send ${first} what you promised`;
      if (/\b(schedul|set up|book|arrange)\b/.test(d)) return `Schedule with ${first}`;
      if (/\b(review|look into|check)\b/.test(d)) return `Review and respond to ${first}`;
      return `Close open loop with ${first}`;
    case 'awaiting_reply':
      return `Follow up with ${first}`;
    case 'urgent_email':
    case 'needs_reply':
      if (/\b(plan|schedul|timeline|decision|availab|meeting|calendar)\b/.test(d))
        return `Unblock ${first}'s decision`;
      if (/\b(review|feedback|input|comment|opinion|thoughts)\b/.test(d))
        return `Provide feedback to ${first}`;
      if (/\b(contract|agreement|sign|approv|confirm)\b/.test(d))
        return `Approve ${first}'s request`;
      if (/\b(introduc|connect|refer)\b/.test(d))
        return `Facilitate introduction for ${first}`;
      return `Reply to ${first}'s message`;
    case 'slack':
      return `Respond to ${first} on Slack`;
  }
}

function buildOppOutcome(title: string, name: string): string {
  const first = name.split(' ')[0];
  const t = title.toLowerCase();
  if (/\b(hir|job|role|recruit)\b/.test(t)) return `Leverage ${first}'s hiring signal`;
  if (/\b(funding|round|raised|series)\b/.test(t)) return `Congratulate ${first} on the raise`;
  if (/\b(intro|introduc|connect)\b/.test(t)) return `Facilitate the introduction`;
  if (/\b(reconnect|quiet|cool|partner|lean|momentum)\b/.test(t)) return `Capture opportunity with ${first}`;
  return `Strengthen relationship with ${first}`;
}

/* ------------------------------------------------------------------ */
/* Needs your attention                                                */
/* ------------------------------------------------------------------ */

export function deriveAttention(input: BrainInput): AttentionItem[] {
  const { emails, sentEmails, contacts, commitments, slack, userEmail } = input;
  const now = new Date();
  const items: AttentionItem[] = [];
  // Track which threads we've already surfaced so a thread + its Re: don't
  // both appear, and so attention/opportunity don't double-count a person.
  const usedThreads = new Set<string>();
  const usedPeople = new Set<string>();

  // 1. Overdue / due commitments you owe — dropped balls, highest priority.
  for (const c of commitments) {
    if (c.direction !== 'you_owe' || c.status !== 'open') continue;
    if (isSelf(c.counterpartyEmail, userEmail) || !c.counterpartyEmail) continue;
    const overdue = isOverdue(c, now);
    // Only surface overdue or imminent (due within ~1 day) commitments in Focus —
    // everything else lives in the dedicated "Open loops" section, so we don't
    // double-surface the same commitment in two places.
    const daysToDue = c.dueDate ? Math.round((new Date(c.dueDate).getTime() - now.getTime()) / 86400000) : Infinity;
    if (!overdue && daysToDue > 1) continue;
    const contact = findContact(contacts, c.counterpartyEmail);
    const days = c.dueDate ? Math.round((now.getTime() - new Date(c.dueDate).getTime()) / 86400000) : 0;
    items.push({
      id: `att-cmt-${c.id}`,
      kind: 'commitment_overdue',
      title: c.counterpartyName,
      outcomeTitle: buildAttentionOutcome('commitment_overdue', c.counterpartyName, c.text),
      detail: c.text,
      situation: overdue
        ? `Overdue by ${days}d: "${truncate(c.text, 50)}"`
        : `Commitment due: "${truncate(c.text, 50)}"`,
      whyItMatters: `Your credibility compounds. ${overdue ? 'This is urgent.' : 'Handle it before it slips.'}`,
      recommendation: overdue
        ? `Reply now — ${days}d overdue, and a partial answer beats continued silence.`
        : `Send it before the deadline — easier to deliver now than explain why you didn't.`,
      meta: dueLabel(c, now),
      person: { name: c.counterpartyName, email: c.counterpartyEmail },
      emailId: c.emailId,
      threadId: c.threadId,
      channel: 'email',
      severity: overdue ? 100 : 82,
      suggestions: [
        { label: 'Reply now', action: 'reply', payload: { emailId: c.emailId } },
        { label: 'Mark done', action: 'mark_done', payload: { commitmentId: c.id } },
      ],
    });
    if (c.threadId) usedThreads.add(c.threadId);
    if (c.counterpartyEmail) usedPeople.add(c.counterpartyEmail.toLowerCase());
  }

  // 1b. Deadline-bearing emails — time-bounded actions (applications, submissions, RSVPs).
  // These surface regardless of category tag because the deadline is the signal.
  {
    const DEADLINE_RE = /\b(application deadline|apply by|deadline|due\s+(by|date)|closes?\s+(on|in)|submission deadline|rsvp\s+by|respond by|reply by|register by|sign ?up by|last day to|expires?\s+(on|in))\b/i;

    const deadlineCandidates = [...emails]
      .filter((e) => !['Archived', 'Saved', 'Deleted', 'Replied'].includes(e.status))
      .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

    for (const e of deadlineCandidates) {
      const text = `${e.subject || ''} ${e.body_text || e.snippet || ''}`;
      if (!DEADLINE_RE.test(text)) continue;
      // Social/logistical deadlines (party RSVPs, lunch polls) don't belong in Focus.
      if (SOCIAL_NOISE_RE.test(text)) continue;

      const thread = e.thread_id || e.id;
      if (usedThreads.has(thread)) continue;
      const { name, email } = parseSender(e.sender || '');
      if (isSelf(email, userEmail)) continue; // legitimate deadlines often come from no-reply@, so don't exclude automated senders

      // Resolve a CONCRETE future date — prefer the AI-extracted field, then the
      // shared resolver (handles "by Friday", "tomorrow", "EOD", ISO dates, etc.).
      // If no real date can be placed, do NOT fabricate urgency.
      let dueIso: string | undefined = (e.deadline as string) || undefined;
      if (!dueIso) dueIso = resolveDueDate(text, now).iso;
      if (!dueIso) continue;
      const dueDate = new Date(dueIso);
      if (isNaN(dueDate.getTime())) continue;
      const daysUntil = Math.round((dueDate.getTime() - now.getTime()) / 86400000);
      if (daysUntil < 0 || daysUntil > 14) continue; // past, or too far to be "today's" concern

      const severity = daysUntil <= 1 ? 96 : daysUntil <= 2 ? 92 : daysUntil <= 3 ? 88 : daysUntil <= 5 ? 84 : 78;
      const urgencyLabel = daysUntil <= 0 ? 'today' : daysUntil === 1 ? 'tomorrow' : `in ${daysUntil} days`;
      const displayName = name || (email ? email.split('@')[0].replace(/[._-]/g, ' ') : 'Deadline');
      const first = displayName.split(' ')[0];

      items.push({
        id: `att-deadline-${e.id}`,
        kind: 'urgent_email',
        title: displayName,
        outcomeTitle: name ? `Act on ${first}'s deadline — ${urgencyLabel}` : `Deadline ${urgencyLabel} — ${truncate(e.subject || 'action needed', 40)}`,
        detail: e.subject || '',
        situation: `Deadline ${urgencyLabel}: "${truncate(e.subject || '', 60)}"`,
        whyItMatters: `Hard deadline — missing it forfeits the opportunity entirely.`,
        recommendation: daysUntil <= 2
          ? `Do this ${urgencyLabel === 'today' ? 'today' : 'now'} — only ${daysUntil <= 0 ? 'hours' : daysUntil === 1 ? '1 day' : `${daysUntil} days`} left.`
          : `Block time this week — ${daysUntil} days sounds like enough but it isn't.`,
        meta: `Due ${urgencyLabel}`,
        person: { name: displayName, email },
        emailId: e.id,
        threadId: thread,
        channel: 'email',
        severity,
        suggestions: [
          { label: 'Reply', action: 'reply', payload: { emailId: e.id } },
          { label: 'Open', action: 'open', payload: { emailId: e.id } },
        ],
      });
      usedThreads.add(thread);
      if (email) usedPeople.add(email.toLowerCase());
    }
  }

  // 2. Sent mail awaiting a reply past its window — customer/investor risk.
  for (const e of sentEmails) {
    if (!e.waiting_on_reply_since || !e.needs_follow_up || e.status === 'Deleted') continue;
    const thread = e.thread_id || e.id;
    if (usedThreads.has(thread)) continue;
    const days = Math.floor((now.getTime() - new Date(e.waiting_on_reply_since).getTime()) / 86400000);
    if (days < 1) continue;
    const { name, email } = parseSender(e.recipients || '');
    if (isAutomatedSender(e.recipients || '') || isSelf(email, userEmail)) continue;
    const contact = findContact(contacts, email);
    const risk = days >= 5;
    items.push({
      id: `att-wait-${e.id}`,
      kind: 'awaiting_reply',
      title: name,
      outcomeTitle: buildAttentionOutcome('awaiting_reply', name, e.subject || ''),
      detail: e.subject ? `Re: ${e.subject}` : 'Your message',
      situation: risk
        ? `Thread going cold (${days}d since you sent: "${truncate(e.subject || '', 50)}")`
        : `Awaiting reply (${days}d): "${truncate(e.subject || '', 50)}"`,
      whyItMatters: risk
        ? `${days}d of silence risks going cold. A nudge now could save the conversation.`
        : `No reply in ${days}d — they may have missed it or need a gentle reminder.`,
      recommendation: risk
        ? `Send a short nudge — ${days} days of silence risks the thread going cold.`
        : `Send a gentle follow-up — they may have missed it, and ${days}d is long enough to check in.`,
      meta: `Sent ${days}d ago`,
      person: { name, email },
      emailId: e.id,
      threadId: thread,
      channel: 'email',
      severity: risk ? 76 : 56,
      suggestions: [
        { label: 'Send a nudge', action: 'bump', payload: { emailId: e.id } },
        { label: 'Open thread', action: 'open', payload: { emailId: e.id } },
      ],
    });
    usedThreads.add(thread);
    if (email) usedPeople.add(email.toLowerCase());
  }

  // 3. Urgent / important unhandled emails that want a reply.
  // Sort newest-first so the surviving thread item is the latest message.
  const candidates = [...emails]
    .filter((e) => !['Archived', 'Saved', 'Deleted', 'Replied'].includes(e.status))
    .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

  for (const e of candidates) {
    const isUrgent = e.category === 'Urgent';
    const needsReply = e.requires_reply === true || e.category === 'Important';
    if (!isUrgent && !needsReply) continue;
    const bodyText = `${e.subject || ''} ${e.body_text || e.snippet || ''}`;
    const { name, email } = parseSender(e.sender || '');
    const contact = findContact(contacts, email);
    // Keep social/logistical noise out of Today's Focus — these belong in the inbox
    if (!isUrgent && SOCIAL_NOISE_RE.test(bodyText)) continue;
    // Keep cold sales/outbound pitches out of Focus unless they're from a known contact.
    if (!isUrgent && !contact && SALES_NOISE_RE.test(bodyText)) continue;
    const thread = e.thread_id || e.id;
    if (usedThreads.has(thread)) continue;
    if (isSelf(email, userEmail)) continue;
    const automated = isAutomatedSender(e.sender || '');

    let situation: string;
    let whyItMatters: string;
    let recommendation: string | undefined;

    // Use the AI-generated summary when the email pipeline has produced one.
    const aiSummary: string | null = (typeof e.summary === 'string' && e.summary.trim()) ? e.summary.trim() : null;

    if (automated) {
      situation = isUrgent
        ? `Time-sensitive automated request`
        : `Action requested from automated system`;
      whyItMatters = isUrgent ? 'Time-sensitive — automated requests can expire.' : 'Quick action clears this.';
      recommendation = isUrgent ? `Handle today — automated requests often have expiry windows.` : undefined;
    } else {
      const firstName = name.split(' ')[0];

      // Use AI summary if available, otherwise fallback to basic description
      if (aiSummary) {
        situation = aiSummary;
      } else {
        // Fallback: describe what the email is about
        const subject = e.subject || 'No subject';
        const hasMeeting = /meeting|sync|call|discuss|zoom|gather/i.test(e.subject || '') || /meeting|sync|call|discuss|zoom|gather/i.test(e.body_text || '');
        const hasDeadline = /by\s+(monday|tuesday|wednesday|thursday|friday|today|tomorrow|end of day|eod|eow)|deadline|due\s+by|need\s+by/i.test(e.body_text || '');
        const hasQuestion = /\?|please|can you|could you|help|need|require/i.test(e.body_text || '');

        if (hasMeeting) {
          situation = `Meeting request: ${subject}`;
        } else if (hasDeadline) {
          situation = `Request with deadline: ${subject}`;
        } else if (hasQuestion) {
          situation = `Question needs response: ${subject}`;
        } else {
          situation = `Awaiting response: ${subject}`;
        }
      }

      if (contact && contact.relationship_score >= 70) {
        whyItMatters = `Key relationship — silence erodes trust faster than you think.`;
        recommendation = isUrgent
          ? `Reply today — they flagged it urgent and this is a key relationship.`
          : undefined;
      } else {
        whyItMatters = contact ? `Growing relationship — timely replies build trust.` : 'First contact — the first reply sets the tone.';
        recommendation = undefined;
      }
    }

    const emailKind: AttentionItem['kind'] = isUrgent ? 'urgent_email' : 'needs_reply';
    items.push({
      id: `att-email-${e.id}`,
      kind: emailKind,
      title: name,
      outcomeTitle: buildAttentionOutcome(emailKind, name, e.subject || e.snippet || ''),
      detail: e.subject || e.snippet || '',
      situation,
      whyItMatters,
      recommendation,
      meta: relativeTime(e.date),
      person: automated ? undefined : { name, email },
      emailId: e.id,
      threadId: thread,
      channel: 'email',
      severity: isUrgent ? (automated ? 50 : 70) : automated ? 30 : contact && contact.relationship_score >= 70 ? 52 : 42,
      suggestions: [
        { label: 'Reply', action: 'reply', payload: { emailId: e.id } },
        { label: 'Open', action: 'open', payload: { emailId: e.id } },
      ],
    });
    usedThreads.add(thread);
    if (email && !automated) usedPeople.add(email.toLowerCase());
  }

  // 4. High-priority unread Slack.
  for (const m of slack) {
    if (!m.unread || m.priority !== 'high') continue;
    const firstName = m.authorName.split(' ')[0];
    items.push({
      id: `att-slack-${m.id}`,
      kind: 'slack',
      title: m.authorName,
      outcomeTitle: buildAttentionOutcome('slack', m.authorName, m.preview),
      detail: m.preview,
      situation: `${firstName} messaged in ${m.title}: "${truncate(m.preview, 80)}"`,
      whyItMatters: `Slack is real-time — they expect a quicker response than email.`,
      recommendation: undefined, // Generic - all Slack messages expect fast responses
      meta: relativeTime(m.timestamp),
      person: { name: m.authorName },
      channel: 'slack',
      severity: 64,
      suggestions: [{ label: 'Open Slack', action: 'open_slack', payload: { id: m.id } }],
    });
  }

  return items.sort((a, b) => b.severity - a.severity).slice(0, 8);
}

/** Emails surfaced by deriveAttention, so opportunities don't double-count them. */
export function peopleInAttention(items: AttentionItem[]): Set<string> {
  const set = new Set<string>();
  for (const i of items) if (i.person?.email) set.add(i.person.email.toLowerCase());
  return set;
}

/* ------------------------------------------------------------------ */
/* Opportunities — relationship leverage, real people only             */
/* ------------------------------------------------------------------ */

const SOCIAL_NOISE_RE = /\b(lunch|dinner|breakfast|pizza|burger|taco|salad|food|restaurant|eat|coffee|drinks|happy hour|team lunch|team dinner|office lunch|splitting the (check|bill)|who's (coming|in)|can you make it|vote|poll|preference|rsvp|celebrating|celebration|birthday|party|welcome|farewell|goodbye|congrats|congrats to|shout.?out)\b/i;

// Cold sales / outbound marketing — kept out of Focus when the sender isn't a known contact.
const SALES_NOISE_RE = /\b(quick call|hop on a call|book a demo|schedule a demo|free trial|save \d+%|cut your|exclusive offer|limited time|special offer|act now|don't miss|unsubscribe|sales pitch|our solution|our platform can|increase your|boost your|grow your revenue|pricing options)\b/i;

const OPP_SIGNALS: Array<{
  re: RegExp;
  build: (
    name: string,
    daysAgo?: number,
  ) => { title: string; detail: string; recommendation: string; draftPrompt: string; subject: string };
}> = [
  {
    re: /\b(hiring|looking to hire|need a|searching for|recruit|vp of|head of|open role|job opening|join (our|the) team)\b/i,
    build: (name, daysAgo = 0) => ({
      title: `${name} is hiring`,
      detail: `Hiring signal detected${daysAgo > 0 ? ` ${daysAgo}d ago` : ''}`,
      recommendation: `Make an intro${daysAgo > 0 ? ` — signal is ${daysAgo}d old so timing is still warm` : ' — the signal is fresh'}. You may know someone who fits.`,
      draftPrompt: `Write a short, warm note to ${name} responding to their hiring news. Offer to help — mention I may know strong candidates and would be happy to make an introduction. Keep it genuine and low-pressure.`,
      subject: `Happy to help with your search`,
    }),
  },
  {
    re: /\b(raised|funding|series [abc]\b|closed our round|new funding|just closed|term sheet)\b/i,
    build: (name, daysAgo = 0) => ({
      title: `${name} shared fundraising news`,
      detail: `Funding milestone detected${daysAgo > 0 ? ` ${daysAgo}d ago` : ''}`,
      recommendation: `Send a quick congratulations — a timely, specific note keeps you top of mind for their next phase${daysAgo > 5 ? ', though the window is narrowing' : ''}.`,
      draftPrompt: `Write a brief, warm congratulations to ${name} on their recent funding news. Make it feel genuine and personal, not a form note. Two or three sentences, no ask.`,
      subject: `Congrats!`,
    }),
  },
  {
    re: /\b(introduce|intro to|connect you|put you in touch|happy to connect|should meet)\b/i,
    build: (name, daysAgo = 0) => ({
      title: `Intro opportunity via ${name}`,
      detail: `Introduction offer${daysAgo > 0 ? ` ${daysAgo}d ago` : ''}`,
      recommendation: `Reply to lock the intro — warm intros convert far better than cold outreach${daysAgo > 3 ? ', but the offer won\'t stay open' : ''}.`,
      draftPrompt: `Write a brief, appreciative reply to ${name} taking them up on the introduction they offered. Express enthusiasm and suggest an easy next step (e.g. happy to send a short blurb they can forward).`,
      subject: `Thanks — would love the intro`,
    }),
  },
  {
    re: /\b(explore a partnership|partner with us|partner with you|partnership opportunity|work together on|collaborat\w* on|run a pilot|pilot program|interested in working with)\b/i,
    build: (name, daysAgo = 0) => ({
      title: `${name} is leaning in`,
      detail: `Partnership signal${daysAgo > 0 ? ` ${daysAgo}d ago` : ''}`,
      recommendation: `Propose a concrete next step — they've signalled interest and momentum stalls fast if you don't move first.`,
      draftPrompt: `Write a concise, confident note to ${name} building on their interest in working together. Propose one concrete next step — a short call or a specific deliverable — and offer a couple of times. Keep momentum.`,
      subject: `Next steps`,
    }),
  },
  {
    re: /\b(launch(ed|ing)?|shipped|we just released|big news|exciting update|milestone)\b/i,
    build: (name, daysAgo = 0) => ({
      title: `${name} has momentum`,
      detail: `Launch or milestone${daysAgo > 0 ? ` ${daysAgo}d ago` : ''}`,
      recommendation: `Send a short note now — congratulations during momentum feel genuine; the same message a month later feels opportunistic.`,
      draftPrompt: `Write a short, genuine congratulations to ${name} on their recent launch/milestone. Mention something specific if you can and keep it warm and brief.`,
      subject: `Congrats on the launch`,
    }),
  },
  {
    re: /\b(fellowship|scholarship|residency|cohort|accelerator|nominat\w+|apply (for|to)|application (deadline|is open|portal)|i'd love for you to apply|you'd be a great fit)\b/i,
    build: (name, daysAgo = 0) => ({
      title: `${name} shared an opportunity`,
      detail: `Application or program opportunity${daysAgo > 0 ? ` (${daysAgo}d ago)` : ''}`,
      recommendation: `Review the details and decide quickly — opportunities like this close fast and a timely response signals genuine interest.`,
      draftPrompt: `Write a brief, enthusiastic reply to ${name} expressing genuine interest in the opportunity they shared, thanking them for thinking of me, and asking about the next step or deadline.`,
      subject: `Thanks for thinking of me`,
    }),
  },
];

export function deriveOpportunities(input: BrainInput, excludeEmails: Set<string> = new Set()): Opportunity[] {
  const { emails, contacts, userEmail } = input;
  const now = new Date();
  const opps: Opportunity[] = [];
  const seen = new Set<string>();
  const usedPeople = excludeEmails;

  // newest first
  const sorted = [...emails]
    .filter((e) => e.status !== 'Deleted')
    .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

  for (const e of sorted) {
    if (opps.length >= 5) break;
    const { name, email } = parseSender(e.sender || '');
    // real people only — no robots, no self, not already in attention
    if (isAutomatedSender(e.sender || '') || isSelf(email, userEmail)) continue;
    if (email && usedPeople.has(email.toLowerCase())) continue;
    if (email && seen.has(email.toLowerCase())) continue;

    const text = `${e.subject || ''} ${e.body_text || e.snippet || ''}`;
    if (SOCIAL_NOISE_RE.test(text)) continue;
    const contact = findContact(contacts, email);

    for (const sig of OPP_SIGNALS) {
      if (sig.re.test(text)) {
        const daysAgo = e.date ? Math.round((now.getTime() - new Date(e.date).getTime()) / 86400000) : 0;
        const built = sig.build(name, daysAgo);
        opps.push({
          id: `opp-${e.id}`,
          title: built.title,
          outcomeTitle: buildOppOutcome(built.title, name),
          detail: built.detail,
          recommendation: built.recommendation,
          person: { name, email },
          emailId: e.id,
          suggestions: [
            { label: 'Draft a note', action: 'compose', payload: { to: email, prompt: built.draftPrompt, subject: built.subject } },
            { label: 'Open email', action: 'open', payload: { emailId: e.id } },
          ],
        });
        if (email) seen.add(email.toLowerCase());
        break;
      }
    }
  }

  // Fill with relationship-nurture leverage if signals were thin.
  if (opps.length < 4) {
    const cooling = contacts
      .filter(
        (c) =>
          c.relationship_score >= 55 &&
          (c.days_since_contact ?? 0) >= 21 &&
          (c.days_since_contact ?? 0) < 120 &&
          !usedPeople.has(c.email_address.toLowerCase()) &&
          !seen.has(c.email_address.toLowerCase()),
      )
      .sort((a, b) => b.relationship_score - a.relationship_score)
      .slice(0, 4 - opps.length);
    for (const c of cooling) {
      const nurtureName = c.name || c.email_address.split('@')[0];
      opps.push({
        id: `opp-nurture-${c.id}`,
        title: `Reconnect with ${nurtureName}`,
        outcomeTitle: `Reconnect with ${nurtureName.split(' ')[0]}`,
        detail: `A strong ${c.category.toLowerCase()} relationship that's gone quiet ${c.days_since_contact}d.`,
        recommendation: `Send a short no-ask check-in — ${c.days_since_contact}d of silence can erode even strong relationships.`,
        person: { name: nurtureName, email: c.email_address },
        suggestions: [
          {
            label: 'Reach out',
            action: 'compose',
            payload: {
              to: c.email_address,
              subject: 'Been thinking of you',
              prompt: `Write a short, warm, no-ask check-in to ${nurtureName} to reconnect after a while out of touch. Make it personal and genuine — ask how they're doing, not for anything. Two or three sentences.`,
            },
          },
        ],
      });
      seen.add(c.email_address.toLowerCase());
    }
  }

  return opps.slice(0, 5);
}

/* ------------------------------------------------------------------ */
/* Meeting prep helpers (per contact)                                  */
/* ------------------------------------------------------------------ */

/** Pull "important context" bullets about a person from their email history. */
export function deriveContextBullets(emails: any[], sentEmails: any[], email?: string): string[] {
  if (!email) return [];
  const lower = email.toLowerCase();
  const related = [...emails, ...sentEmails].filter(
    (e) => (e.sender || '').toLowerCase().includes(lower) || (e.recipients || '').toLowerCase().includes(lower),
  );
  const bullets: string[] = [];
  const patterns: Array<{ re: RegExp; label: (m: string) => string }> = [
    { re: /\b(budget|pricing|cost|expensive|cheaper)\b[^.!?]*/i, label: (m) => `Sensitive on cost: "${truncate(m.trim(), 80)}"` },
    { re: /\b(deadline|timeline|by (next )?(week|month|friday|monday|q[1-4]))\b[^.!?]*/i, label: (m) => `Timeline: "${truncate(m.trim(), 80)}"` },
    { re: /\b(implementation|onboarding|integration|rollout|speed|fast)\b[^.!?]*/i, label: (m) => `Cares about: "${truncate(m.trim(), 80)}"` },
    { re: /\b(team|committee|stakeholder|my boss|decision)\b[^.!?]*/i, label: (m) => `Buying process: "${truncate(m.trim(), 80)}"` },
  ];
  for (const e of related.slice(0, 12)) {
    const text = e.body_text || e.snippet || '';
    for (const p of patterns) {
      const match = text.match(p.re);
      if (match && bullets.length < 4) {
        const bullet = p.label(match[0]);
        if (!bullets.includes(bullet)) bullets.push(bullet);
      }
    }
  }
  return bullets;
}

export function recentSubjectsWith(emails: any[], sentEmails: any[], email?: string, limit = 5): string[] {
  if (!email) return [];
  const lower = email.toLowerCase();
  return [...emails, ...sentEmails]
    .filter((e) => (e.sender || '').toLowerCase().includes(lower) || (e.recipients || '').toLowerCase().includes(lower))
    .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
    .map((e) => e.subject)
    .filter((s, i, arr) => s && arr.indexOf(s) === i)
    .slice(0, limit);
}
