// Aiden "second brain" AI layer.
//
// These functions try a live AI backend (GenAI gateway → Tauri invoke) and
// gracefully fall back to deterministic heuristics when no backend is reachable
// (e.g. dev mode on mock data). Every surface stays fully populated either way.

import { serverURL } from './calendar';
import {
  Commitment,
  ExtractInput,
  extractCommitmentsHeuristic,
  resolveDueDate,
} from '@/lib/commitments';

/* ------------------------------------------------------------------ */
/* Generic prompt runner with fallback                                 */
/* ------------------------------------------------------------------ */

async function runAidenPrompt(prompt: string, timeoutMs = 25000): Promise<string> {
  const base = await serverURL();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${base}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: prompt }),
      signal: controller.signal,
    });
    const text = await resp.text();
    if (!resp.ok) throw new Error(`/chat returned ${resp.status}: ${text.slice(0, 200)}`);
    let data: any;
    try { data = JSON.parse(text); } catch { throw new Error(`Bad JSON from /chat: ${text.slice(0, 200)}`); }
    if (data.error) throw new Error(data.error);
    // Accept all field names the backends serialize: oauth_server /chat -> {reply},
    // genai-gateway /chat -> {response}. Without `response`, every gateway-routed
    // AI call (brief, Ask, commitments, meeting-prep) silently returned ''.
    return data.reply ?? data.response ?? data.message ?? data.text ?? '';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Answer a free-form question grounded ONLY in the supplied context (e.g. the
 * user's matching emails). Returns '' on failure so callers can fall back.
 */
export async function answerFromContext(question: string, context: string): Promise<string> {
  if (!context.trim()) return '';
  const prompt = `You are the user's chief of staff. Answer their question concisely and specifically, using ONLY the information in the context below. If the context doesn't contain the answer, say so in one short sentence — do not guess or ask the user to search (you already have).

Question: ${question}

Context (the user's relevant emails):
${context.slice(0, 6000)}

Answer in 1–3 sentences, concrete and grounded. No preamble. Respond in PLAIN TEXT (no markdown — no **bold**, no headers, no bullet/numbered lists; write enumerations as prose). If the question has multiple parts, address each one. If it's about commitments or open tasks, cover BOTH what the user owes others AND what others owe the user; when nothing is owed in a direction, scope it to this context (e.g. "nothing in these emails"). If a decision or action has a deadline, restate it.`;
  try {
    const raw = await runAidenPrompt(prompt, 18000);
    return raw.trim();
  } catch {
    return '';
  }
}

/**
 * 2–4 short, sensible context notes about a relationship, grounded in recent
 * emails. Returns [] on failure or when there's nothing concrete (better than
 * brittle, mislabeled regex fragments).
 */
export async function relationshipContext(
  name: string,
  messages: { subject: string; snippet: string }[],
): Promise<string[]> {
  if (messages.length === 0) return [];
  const corpus = messages
    .map((m) => `- "${m.subject}": ${m.snippet}`)
    .join('\n')
    .slice(0, 3000);
  const prompt = `From these recent emails with ${name}, write 2–4 short context notes a chief of staff would want before talking to them — what they're working on, what they care about, open topics, or anything pending. Each note ≤ 14 words, specific and grounded in the emails. No generic filler, no category labels like "buying process". Return ONLY a JSON array of strings; [] if nothing concrete.

Emails:
${corpus}`;
  try {
    const raw = await runAidenPrompt(prompt, 12000);
    const parsed = parseJsonLoose<string[]>(raw);
    if (Array.isArray(parsed)) return parsed.filter((s) => typeof s === 'string' && s.trim()).slice(0, 4);
  } catch {
    /* fall through */
  }
  return [];
}

function parseJsonLoose<T>(raw: string): T | null {
  if (!raw) return null;
  const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || raw.match(/([\[{][\s\S]*[\]}])/);
  const candidate = match ? match[1] : raw;
  try {
    return JSON.parse(candidate) as T;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Commitment extraction (AI-enhanced, heuristic fallback)             */
/* ------------------------------------------------------------------ */

export async function extractCommitments(input: ExtractInput): Promise<Commitment[]> {
  const heuristic = extractCommitmentsHeuristic(input);
  try {
    const prompt = `You extract CONCRETE commitments from an email — a real promise to do a specific thing, or a specific request asked of the reader. The user ${
      input.outgoing ? 'WROTE' : 'RECEIVED'
    } this message. Counterparty: ${input.counterpartyName}.

Message:
"""${input.body.slice(0, 2000)}"""

RULES:
- Only real, actionable commitments. IGNORE pleasantries and filler like "let me know if you have questions", "thanks", "looking forward", "feel free to reach out", "hope you're well", "touch base", "catch up", "chat soon", "reconnect".
- IGNORE negated or declining statements ("I can't review", "won't be able to send", "no longer", "unable to") — these are NOT commitments.
- For a CONDITIONAL promise ("if the budget approves, I'll hire"), set confidence <= 0.4 so it is filtered out unless it is firm.
- "due" must be null UNLESS the message states an explicit time reference (a date, weekday, "by EOD", "next week", etc.). Never invent a deadline.
- "confidence" 0–1: how sure you are this is a genuine commitment (not a vague intention or social nicety).

Return ONLY a JSON array. Each item: {"text": short imperative action, "direction": "you_owe"|"they_owe", "due": string|null, "confidence": number}. Empty array if none.`;
    const raw = await runAidenPrompt(prompt);
    const parsed = parseJsonLoose<Array<{ text: string; direction: string; due?: string | null; confidence?: number }>>(raw);
    if (!parsed || !Array.isArray(parsed)) return heuristic;

    const NEGATIVE_RE = /\b(no longer|don['’]t|won['’]t|can['’]t|cannot|unable to|not able)\b/i;
    return parsed
      .filter((p) => p.text && (p.direction === 'you_owe' || p.direction === 'they_owe'))
      .filter((p) => !NEGATIVE_RE.test(p.text)) // ignore negated / declining statements
      .filter((p) => (typeof p.confidence === 'number' ? p.confidence >= 0.5 : true))
      .slice(0, 4)
      .map((p, i) => {
        const due = p.due ? resolveDueDate(p.due, input.timestamp ? new Date(input.timestamp) : new Date()) : {};
        // The model often returns a bare weekday ("Friday") as the deadline, but
        // resolveDueDate needs a cue word (by/on/this/next) — retry with one.
        if (p.due && !(due as any).iso) {
          const retry = resolveDueDate(`by ${p.due}`, input.timestamp ? new Date(input.timestamp) : new Date());
          if ((retry as any).iso) Object.assign(due, retry);
        }
        return {
          id: `cmt-ai-${input.id}-${i}`,
          direction: p.direction as Commitment['direction'],
          text: p.text.trim(),
          excerpt: p.text.trim(),
          counterpartyName: input.counterpartyName,
          counterpartyEmail: input.counterpartyEmail,
          emailId: input.id,
          threadId: input.threadId,
          subject: input.subject,
          dueDate: (due as any).iso,
          dueText: (due as any).label || (p.due ?? undefined),
          status: 'open' as const,
          createdAt: input.timestamp || new Date().toISOString(),
          confidence: typeof p.confidence === 'number' ? p.confidence : 0.75,
          source: 'ai' as const,
        };
      });
  } catch {
    return heuristic;
  }
}

/* ------------------------------------------------------------------ */
/* Daily synthesis narrative                                           */
/* ------------------------------------------------------------------ */

export interface DayBriefContext {
  userName?: string;
  attentionCount: number;
  opportunityCount: number;
  meetingsToday: number;
  openCommitments: number;
  /** The single most important thing to do (the top Focus item's outcome). */
  topPriority?: string;
  /** The most pressing overdue/imminent commitment, if any. */
  mostOverdue?: string;
  /** The next meeting on the calendar, e.g. "Team sync at 10:00 AM". */
  nextMeeting?: string;
}

export async function synthesizeDayBrief(ctx: DayBriefContext): Promise<string> {
  try {
    const specifics = [
      ctx.topPriority ? `Top priority: ${ctx.topPriority}.` : '',
      ctx.mostOverdue ? `Most pressing commitment: ${ctx.mostOverdue}.` : '',
      ctx.nextMeeting ? `Next meeting: ${ctx.nextMeeting}.` : '',
    ].filter(Boolean).join(' ');
    const prompt = `You are the user's calm, sharp chief of staff. Write ONE concise sentence (max 24 words) that orients the user to their day and names the single most important thing to do, specifically.
Rules:
- Lead with the single most important thing (from Specifics), named specifically — never as a raw count.
- Never quote counts, and never frame the day by what's absent (no "clear inbox", "nothing pending", "zero items"). If nothing specific is pressing, just say the day looks light — do not mention email or the inbox.
- Do not prescribe how to spend free time (no "deep work" suggestions). Only tie an action to a meeting if they are genuinely related.
- No greeting, no emoji.
Day load: ${ctx.attentionCount} attention, ${ctx.opportunityCount} opportunities, ${ctx.meetingsToday} meetings, ${ctx.openCommitments} open loops.
${specifics ? `Specifics: ${specifics}` : 'Nothing specific is pressing today.'}`;
    const raw = await runAidenPrompt(prompt, 8000);
    const line = raw.trim().split('\n')[0];
    if (line) return line.replace(/^["']|["']$/g, '');
  } catch {
    /* fall through to deterministic copy */
  }
  return deterministicDayBrief(ctx);
}

function deterministicDayBrief(ctx: DayBriefContext): string {
  const parts: string[] = [];
  if (ctx.attentionCount > 0)
    parts.push(`${ctx.attentionCount} thing${ctx.attentionCount > 1 ? 's' : ''} need your attention`);
  if (ctx.meetingsToday > 0) parts.push(`${ctx.meetingsToday} meeting${ctx.meetingsToday > 1 ? 's' : ''} today`);
  if (ctx.openCommitments > 0) parts.push(`${ctx.openCommitments} open commitment${ctx.openCommitments > 1 ? 's' : ''}`);
  if (ctx.opportunityCount > 0)
    parts.push(`${ctx.opportunityCount} opportunit${ctx.opportunityCount > 1 ? 'ies' : 'y'} worth a look`);
  if (parts.length === 0) return "You're all caught up. Nothing pressing right now.";
  if (parts.length === 1) return `${parts[0].charAt(0).toUpperCase()}${parts[0].slice(1)}.`;
  const last = parts.pop();
  return `${parts.join(', ')}, and ${last}.`.replace(/^./, (c) => c.toUpperCase());
}

/* ------------------------------------------------------------------ */
/* Event-based meeting prep (grounded on calendar + emails + docs)    */
/* ------------------------------------------------------------------ */

export interface EventBriefInput {
  summary: string;
  time: string;
  endTime?: string;
  location?: string;
  description?: string;
  attendees?: string[];
  relatedEmails: Array<{ subject: string; from: string; snippet: string }>;
  docContents: string[];
  openCommitmentTexts: string[];
}

export async function generateEventBrief(input: EventBriefInput): Promise<MeetingBrief> {
  const emailSection = input.relatedEmails.length > 0
    ? `Related emails:\n${input.relatedEmails.map(e => `- From ${e.from}: "${e.subject}" — ${e.snippet}`).join('\n')}`
    : '';

  const docSection = input.docContents.length > 0
    ? `Linked document content (already fetched — synthesize from this, do not tell the user to read it):\n${input.docContents.join('\n---\n').slice(0, 3000)}`
    : '';

  const descSection = input.description
    ? `Calendar description:\n${input.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1500)}`
    : '';

  const commitSection = input.openCommitmentTexts.length > 0
    ? `Open commitments with attendees:\n${input.openCommitmentTexts.map(t => `- ${t}`).join('\n')}`
    : '';

  const contextParts = [descSection, docSection, emailSection, commitSection].filter(Boolean);

  const hasRealContext = contextParts.length > 0;

  const prompt = `You are a chief of staff. Prepare a meeting brief for: "${input.summary}"

Meeting: ${input.time}${input.endTime ? ` – ${input.endTime}` : ''}${input.location ? ` · ${input.location}` : ''}
${hasRealContext ? contextParts.join('\n\n') : '(No emails, documents, or calendar description found for this meeting.)'}

CRITICAL RULES:
- Base EVERYTHING only on what is explicitly stated in the context above. Do not infer, assume, or hallucinate anything from the meeting title or your general knowledge.
- If the context is empty or contains no useful information, return empty arrays for objectives, suggestedQuestions, and watchOuts. Do not make things up.
- Synthesize document content directly — do NOT tell the user to "review", "read", or "check" any document or link.
- The headline should describe what this meeting is about based on context, or if there is no context just restate the meeting title without adding assumptions.
- watchOuts: only if the context reveals a real tension or risk — otherwise omit.

Return ONLY valid JSON:
{"headline": "...", "objectives": ["..."], "suggestedQuestions": ["..."], "watchOuts": ["..."]}`;

  try {
    const raw = await runAidenPrompt(prompt, 25000);
    const parsed = parseJsonLoose<Omit<MeetingBrief, 'generatedByAi'>>(raw);
    if (parsed) return { ...parsed, generatedByAi: true };
    throw new Error('Could not parse AI response');
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[generateEventBrief] failed:', msg);
    return {
      headline: `Could not generate brief: ${msg}`,
      objectives: [],
      suggestedQuestions: [],
      watchOuts: [],
      generatedByAi: false,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Meeting brief                                                       */
/* ------------------------------------------------------------------ */

export interface MeetingBriefInput {
  personName: string;
  personEmail?: string;
  role?: string;
  lastContact?: string;
  relationshipScore?: number;
  recentSubjects: string[];
  context: string[]; // important context bullets
  openCommitments: Commitment[];
}

export interface MeetingBrief {
  headline: string;
  objectives: string[];
  suggestedQuestions: string[];
  watchOuts: string[];
  generatedByAi: boolean;
}

export async function generateMeetingBrief(input: MeetingBriefInput): Promise<MeetingBrief> {
  try {
    const hasContext =
      input.recentSubjects.length > 0 || input.context.length > 0 || input.openCommitments.length > 0;
    const prompt = `You are a sharp chief of staff preparing the user for a meeting with ${input.personName}${
      input.role ? ` (${input.role})` : ''
    }${input.lastContact ? `, last in touch ${input.lastContact}` : ''}.

Context you have:
- Recent threads: ${input.recentSubjects.join('; ') || 'none'}
- What they care about: ${input.context.join('; ') || 'none'}
- Open commitments between you: ${input.openCommitments.map((c) => `${c.direction === 'you_owe' ? 'you owe' : 'they owe'}: ${c.text}`).join('; ') || 'none'}

RULES:
- Base everything ONLY on the context above. Do NOT invent specifics, numbers, or events that aren't stated.
- objectives and suggestedQuestions must be specific to this relationship — never generic filler like "understand their priorities" or "what's changed since we last spoke" unless the context points to it.
- If context is thin, return fewer items (even empty arrays) rather than padding.
- watchOuts only if the context reveals a real tension/risk.

Return ONLY JSON: {"headline": one concrete sentence, "objectives": [up to 3], "suggestedQuestions": [up to 3], "watchOuts": [up to 2]}.`;
    const raw = await runAidenPrompt(prompt);
    const parsed = parseJsonLoose<Omit<MeetingBrief, 'generatedByAi'>>(raw);
    if (parsed && parsed.objectives) return { ...parsed, generatedByAi: true };
    if (!hasContext) {
      // Nothing to ground a brief on — don't fall through to generic deterministic filler.
      return { headline: `${input.personName} — limited history to brief on.`, objectives: [], suggestedQuestions: [], watchOuts: [], generatedByAi: false };
    }
  } catch {
    /* fall through */
  }
  return deterministicMeetingBrief(input);
}

function deterministicMeetingBrief(input: MeetingBriefInput): MeetingBrief {
  const objectives: string[] = [];
  if (input.openCommitments.some((c) => c.direction === 'you_owe'))
    objectives.push('Close out what you owe them');
  if (input.recentSubjects[0]) objectives.push(`Move "${input.recentSubjects[0]}" forward`);
  objectives.push('Understand their current priorities and timeline');

  const suggestedQuestions = [
    'How are you measuring success on this right now?',
    "What would make this an easy yes on your side?",
    "What's changed since we last spoke?",
  ];

  const watchOuts: string[] = [];
  if (input.context.some((c) => /budget|pricing|cost/i.test(c)))
    watchOuts.push('Tread carefully on pricing — it surfaced as a concern before.');
  if (input.openCommitments.some((c) => c.direction === 'you_owe'))
    watchOuts.push("Don't promise new deliverables until existing ones are done.");

  return {
    headline: `${input.personName}${input.role ? `, ${input.role}` : ''} — ${
      input.lastContact ? `last spoke ${input.lastContact}` : 'reconnecting'
    }.`,
    objectives: objectives.slice(0, 3),
    suggestedQuestions: suggestedQuestions.slice(0, 3),
    watchOuts,
    generatedByAi: false,
  };
}

/* ------------------------------------------------------------------ */
/* Per-relationship suggestion                                         */
/* ------------------------------------------------------------------ */

export interface RelationshipInsightInput {
  name: string;
  daysSinceContact?: number;
  relationshipScore: number;
  category: string;
  pendingFromYou: number;
}

export async function relationshipInsight(input: RelationshipInsightInput): Promise<string> {
  try {
    const strength =
      input.relationshipScore >= 75 ? 'strong' : input.relationshipScore >= 50 ? 'solid' : input.relationshipScore >= 25 ? 'developing' : 'new/thin';
    const prompt = `You are a calm, honest chief of staff. In ONE short sentence (max 18 words), suggest the single most useful next move for the user's relationship with ${input.name}.

Use ONLY these facts. Do NOT invent numbers, percentages, leverage, deals, renewals, meetings, or any specifics not listed here:
- Category: ${input.category}
- Relationship strength: ${strength}
- Days since last contact: ${input.daysSinceContact ?? 'unknown'}
- Unfulfilled things the user owes them: ${input.pendingFromYou}

Stay practical and grounded (reconnect, follow through on what's owed, keep it warm, or note no action is needed). No fabricated context, no numbers in your answer.`;
    const raw = await runAidenPrompt(prompt, 8000);
    const line = raw.trim().split('\n')[0];
    if (line) return line.replace(/^["']|["']$/g, '');
  } catch {
    /* fall through */
  }
  return deterministicRelationshipInsight(input);
}

function deterministicRelationshipInsight(input: RelationshipInsightInput): string {
  if (input.pendingFromYou > 0)
    return `You owe ${input.name} ${input.pendingFromYou} thing${input.pendingFromYou > 1 ? 's' : ''} — clearing that will rebuild momentum.`;
  if ((input.daysSinceContact ?? 0) > 60)
    return `It's been a while. A short, no-ask check-in would keep this relationship warm.`;
  if (input.relationshipScore >= 75)
    return `One of your strongest relationships — worth protecting with a regular touchpoint.`;
  if ((input.daysSinceContact ?? 0) > 21)
    return `Cooling off. Reach out this week before it goes quiet.`;
  return `Healthy and active — no action needed right now.`;
}
