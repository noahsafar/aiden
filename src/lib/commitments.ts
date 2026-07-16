/**
 * Commitment detection — the engine behind Aiden's killer "never drop a ball"
 * feature. Every conversation quietly creates commitments:
 *   "I'll send that over tomorrow"  → you owe: Send that over (due tomorrow)
 *   "Can you send the contract?"     → they owe: Send the contract
 *
 * This module is deterministic (regex/heuristics) so it works fully offline in
 * dev mode. `api/aiden.ts` layers an optional AI pass on top when a backend is
 * available, but the heuristics alone produce a believable, useful result.
 */

export type CommitmentDirection = 'you_owe' | 'they_owe';
export type CommitmentStatus = 'open' | 'done' | 'snoozed' | 'dismissed';

export interface Commitment {
  id: string;
  direction: CommitmentDirection;
  /** the action, cleaned up: "Send the Q4 roadmap" */
  text: string;
  /** the original sentence it was extracted from */
  excerpt: string;
  counterpartyName: string;
  counterpartyEmail?: string;
  emailId: string;
  threadId: string;
  subject?: string;
  /** ISO date if we could resolve one, else undefined */
  dueDate?: string;
  /** original phrasing of the deadline: "tomorrow", "by Friday" */
  dueText?: string;
  status: CommitmentStatus;
  createdAt: string;
  /** when snoozed, until when */
  snoozedUntil?: string;
  confidence: number; // 0..1
  source: 'heuristic' | 'ai';
}

/* ------------------------------------------------------------------ */
/* Deadline parsing                                                    */
/* ------------------------------------------------------------------ */

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Is this a *plausible* due date relative to when a message was written?
 * Guards against hallucinated / misparsed deadlines turning into false "overdue"
 * alerts: a date well before the message existed, or one absurdly far in the
 * future, is almost always a parsing artifact rather than a real, trackable
 * deadline. Trust in an assistant evaporates the first time it cries wolf.
 */
export function isPlausibleDueDate(iso: string | undefined, reference: Date = new Date()): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  const ref = reference.getTime();
  const DAY = 86400000;
  if (t < ref - DAY) return false; // before the message existed (with a day of slack)
  if (t > ref + 540 * DAY) return false; // > ~18 months out — not a real email deadline
  return true;
}

/** Resolve a natural-language deadline to an ISO date (best effort). */
export function resolveDueDate(text: string, from: Date = new Date()): { iso?: string; label?: string } {
  const t = text.toLowerCase();
  const base = new Date(from);
  base.setHours(17, 0, 0, 0); // default deadlines to 5pm

  // Only ever hand back a plausible date — never a stale or far-future misparse.
  const set = (d: Date, label: string): { iso?: string; label?: string } =>
    isPlausibleDueDate(d.toISOString(), from) ? { iso: d.toISOString(), label } : {};

  if (/\btonight\b/.test(t)) {
    const d = new Date(base);
    d.setHours(21, 0, 0, 0);
    return set(d, 'tonight');
  }
  if (/\b(today|eod|end of day|cob)\b/.test(t)) return set(base, 'today');
  if (/\btomorrow\b/.test(t)) {
    const d = new Date(base);
    d.setDate(d.getDate() + 1);
    return set(d, 'tomorrow');
  }
  if (/\bend of (the )?week\b|\beow\b/.test(t)) {
    const d = new Date(base);
    const add = (5 - d.getDay() + 7) % 7 || 5; // next Friday-ish
    d.setDate(d.getDate() + add);
    return set(d, 'end of week');
  }
  if (/\bnext week\b/.test(t)) {
    const d = new Date(base);
    d.setDate(d.getDate() + 7);
    return set(d, 'next week');
  }
  // Explicit calendar dates ("July 2", "March 3") are the most reliable signal,
  // so resolve them BEFORE weekday names — e.g. "this Thursday, July 2nd" should
  // anchor on July 2, not a weekday token that might appear elsewhere in the text.
  const monthMatch = t.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})\b/,
  );
  if (monthMatch) {
    const parsed = new Date(`${monthMatch[0]} ${base.getFullYear()}`);
    if (!Number.isNaN(parsed.getTime())) {
      parsed.setHours(17, 0, 0, 0);
      if (parsed.getTime() < from.getTime() - 86400000) parsed.setFullYear(parsed.getFullYear() + 1);
      return set(parsed, monthMatch[0]);
    }
  }
  // "by Friday", "on Monday", "this Thursday" — require a deadline cue (by/on/this/
  // next/before) before the weekday. A bare weekday is usually a greeting or sign-off
  // ("Happy Monday", "Have a great Monday"), NOT a deadline; matching it produced
  // wildly wrong due dates (e.g. the greeting weekday instead of the real deadline).
  const dayMatch = t.match(/\b(by|on|this|next|before)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (dayMatch) {
    const target = DAYS.indexOf(dayMatch[2]);
    const d = new Date(base);
    let add = (target - d.getDay() + 7) % 7;
    if (add === 0) add = 7; // upcoming, not today
    if (/next/.test(dayMatch[0])) add += 7;
    d.setDate(d.getDate() + add);
    return set(d, dayMatch[2].charAt(0).toUpperCase() + dayMatch[2].slice(1));
  }
  // "in 3 days"
  const inDays = t.match(/\bin (\d+) days?\b/);
  if (inDays) {
    const d = new Date(base);
    d.setDate(d.getDate() + parseInt(inDays[1], 10));
    return set(d, `in ${inDays[1]} days`);
  }
  return {};
}

/* ------------------------------------------------------------------ */
/* Sentence splitting + cleanup                                        */
/* ------------------------------------------------------------------ */

function splitSentences(text: string): string[] {
  return text
    .replace(/\r/g, '')
    .split(/(?<=[.!?\n])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length < 300);
}

function cleanAction(sentence: string): string {
  let s = sentence
    .replace(/^(hi|hey|hello|thanks|thank you|btw|also|just|so|and|ok|okay)[,!\s]+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  // capitalize, trim trailing punctuation
  s = s.replace(/[.,;:!?]+$/, '');
  if (s.length > 120) s = s.slice(0, 117).trimEnd() + '…';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ------------------------------------------------------------------ */
/* Heuristic extraction                                                */
/* ------------------------------------------------------------------ */

// Phrases where the *author* is promising something (1st person commitments).
const YOU_OWE_PATTERNS = [
  /\bi(?:'| wi)?ll\s+(send|get|share|forward|put together|draft|prepare|prep|follow up|circle back|get back|come back|revert|set up|schedule|review|respond|reply|answer|confirm|provide|check|look (into|over|at)|loop|update|finalize|finish|complete|deliver|ping|email|call|reach out|let you know|sort|handle|take care of|write up|pull together)\b/i,
  /\bi['’]?m going to\s+\w+/i,
  /\bi['’]?ll\s+\w+[^.!?]*\b(by\s|tomorrow|today|tonight|this (afternoon|morning|evening|week)|next (week|monday|tuesday|wednesday|thursday|friday)|end of (the )?(day|week)|eod|eow|by (monday|tuesday|wednesday|thursday|friday))\b/i,
  /\blet me\s+(send|get|share|check|look|put together|draft|follow up|circle back|set up|pull|confirm|review)\b/i,
  /\bi can\s+(send|get|share|have|put together|draft|set up|schedule|provide|review)\b.*\b(by|tomorrow|today|tonight|this week|next week|monday|tuesday|wednesday|thursday|friday)\b/i,
  /\bi['’]?ll have\b/i,
  /\bwill\s+(send|share|forward|deliver|circle back|follow up|respond|reply|get back|confirm|provide|let you know)\b/i,
];

// Phrases that imply the *counterparty* owes the user something.
const THEY_OWE_PATTERNS = [
  /\b(can|could|would)\s+you\s+(please\s+)?(send|share|forward|get|review|sign|confirm|approve|set up|schedule|let me know)\b/i,
  /\bplease\s+(send|share|forward|review|sign|confirm|approve|provide|let me know)\b/i,
  /\bwaiting (on|for)\b/i,
  /\bwhen (can|will) you\b/i,
  /\blet me know (if|when|whether|your)\b/i,
  /\bcould you (also )?\b/i,
];

const NEGATIVE = /\b(no longer|don['’]t|won['’]t|can['’]t|cannot|unable to|not able)\b/i;

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

export interface ExtractInput {
  id: string;
  threadId: string;
  subject?: string;
  body: string;
  counterpartyName: string;
  counterpartyEmail?: string;
  outgoing: boolean; // true if the user authored this message
  timestamp?: string;
}

/**
 * Extract commitments from a single message.
 * Direction depends on who wrote it:
 *  - Outgoing (user wrote it): 1st-person promises → you_owe; requests → they_owe.
 *  - Incoming (they wrote it): 1st-person promises → they_owe; requests → you_owe.
 */
export function extractCommitmentsHeuristic(input: ExtractInput): Commitment[] {
  const { body, outgoing, counterpartyName, counterpartyEmail, id, threadId, subject, timestamp } = input;
  if (!body) return [];
  const sentences = splitSentences(body);
  const results: Commitment[] = [];
  const seen = new Set<string>();

  const TRIVIAL_RE = /\blet me know if you (have any )?(questions?|concerns?|issues?|feedback|thoughts?|need anything|need help|see anything|anything'?s?\s+(missing|needed|wrong|unclear))\b/i;

  for (const sentence of sentences) {
    if (NEGATIVE.test(sentence)) continue;
    if (TRIVIAL_RE.test(sentence)) continue;

    const isPromise = YOU_OWE_PATTERNS.some((re) => re.test(sentence));
    const isRequest = THEY_OWE_PATTERNS.some((re) => re.test(sentence));
    if (!isPromise && !isRequest) continue;

    let direction: CommitmentDirection;
    if (isPromise) {
      direction = outgoing ? 'you_owe' : 'they_owe';
    } else {
      // a request
      direction = outgoing ? 'they_owe' : 'you_owe';
    }

    const action = cleanAction(sentence);
    const key = `${direction}:${slug(action)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const due = resolveDueDate(sentence, timestamp ? new Date(timestamp) : new Date());

    results.push({
      id: `cmt-${id}-${slug(action) || results.length}`,
      direction,
      text: action,
      excerpt: sentence.trim(),
      counterpartyName,
      counterpartyEmail,
      emailId: id,
      threadId,
      subject,
      dueDate: due.iso,
      dueText: due.label,
      status: 'open',
      createdAt: timestamp || new Date().toISOString(),
      confidence: isPromise ? 0.7 : 0.55,
      source: 'heuristic',
    });

    if (results.length >= 3) break; // cap per message to avoid noise
  }

  // Consolidate: when one message makes several promises in the same direction,
  // the one with a concrete deadline is the real deliverable — keep those and drop
  // the vaguer, deadline-less ones, so an email yields one clear commitment, not noise.
  const consolidate = (dir: CommitmentDirection): Commitment[] => {
    const group = results.filter((c) => c.direction === dir);
    if (group.length <= 1) return group;
    const withDue = group.filter((c) => c.dueDate);
    return withDue.length > 0 ? withDue : [group[0]];
  };

  return [...consolidate('you_owe'), ...consolidate('they_owe')];
}

/* ------------------------------------------------------------------ */
/* Helpers for the UI                                                  */
/* ------------------------------------------------------------------ */

export function isOverdue(c: Commitment, now: Date = new Date()): boolean {
  if (c.status !== 'open' || !c.dueDate) return false;
  return new Date(c.dueDate).getTime() < now.getTime();
}

export function isDueToday(c: Commitment, now: Date = new Date()): boolean {
  if (!c.dueDate) return false;
  const d = new Date(c.dueDate);
  return d.toDateString() === now.toDateString();
}

export function dueLabel(c: Commitment, now: Date = new Date()): string {
  if (!c.dueDate) return c.dueText ? c.dueText : 'No date';
  const d = new Date(c.dueDate);
  const days = Math.round((d.getTime() - now.getTime()) / 86400000);
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (d.toDateString() === now.toDateString()) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  if (days < 7) return `Due ${d.toLocaleDateString(undefined, { weekday: 'long' })}`;
  return `Due ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

/* ------------------------------------------------------------------ */
/* Closing the "waiting on them" loop automatically                    */
/* ------------------------------------------------------------------ */

export interface InboundMessage {
  threadId?: string;
  /** ISO timestamp the message arrived. */
  date?: string;
  body?: string;
  hasAttachments?: boolean;
}

// "Here's the deck", "please find attached", "as requested", "sending it over"…
const FULFILLMENT_RE =
  /\b(attached|please find|here'?s|here is|here you go|as requested|as promised|as discussed|sending (you|it|over)|i'?ve (sent|attached|shared)|sent (it )?over|sharing the|find (it )?(attached|below)|all set|completed)\b/i;

/**
 * Close the loop on the "waiting on them" side: when a later message in the same
 * thread delivers what was owed (an attachment, or a clear delivery phrase), the
 * matching `they_owe` commitment is auto-marked done. Deterministic and
 * idempotent — recomputed on each extraction, so it self-corrects as mail
 * changes. Callers should apply explicit user overrides AFTER this, so a manual
 * reopen always wins over the heuristic.
 */
export function resolveFulfilledCommitments(
  commitments: Commitment[],
  inbound: InboundMessage[],
): Commitment[] {
  if (!inbound.length) return commitments;
  return commitments.map((c) => {
    if (c.status !== 'open' || c.direction !== 'they_owe' || !c.threadId) return c;
    const created = new Date(c.createdAt).getTime();
    const delivered = inbound.some((m) => {
      if (m.threadId !== c.threadId) return false;
      const t = m.date ? new Date(m.date).getTime() : NaN;
      if (Number.isNaN(t) || t <= created + 60000) return false; // must arrive AFTER the ask
      return !!m.hasAttachments || (!!m.body && FULFILLMENT_RE.test(m.body));
    });
    return delivered ? { ...c, status: 'done' as const } : c;
  });
}
