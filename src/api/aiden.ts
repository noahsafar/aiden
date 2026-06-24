// Aiden "second brain" AI layer.
//
// These functions try a live AI backend (GenAI gateway → Tauri invoke) and
// gracefully fall back to deterministic heuristics when no backend is reachable
// (e.g. dev mode on mock data). Every surface stays fully populated either way.

import { GENAI_SERVICE_URL } from './config';
import {
  Commitment,
  ExtractInput,
  extractCommitmentsHeuristic,
  resolveDueDate,
} from '@/lib/commitments';

/* ------------------------------------------------------------------ */
/* Generic prompt runner with fallback                                 */
/* ------------------------------------------------------------------ */

let backendAvailable: boolean | null = null;

async function runAidenPrompt(prompt: string, timeoutMs = 12000): Promise<string> {
  // short-circuit if we already learned the backend is down this session
  if (backendAvailable === false) throw new Error('aiden backend unavailable');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${GENAI_SERVICE_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: prompt }),
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`aiden /chat ${resp.status}`);
    const data = await resp.json();
    backendAvailable = true;
    return data.reply ?? data.message ?? data.text ?? '';
  } catch (httpErr) {
    // try Tauri invoke as a secondary path
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const out = await invoke<string>('chat_completion', { prompt });
      backendAvailable = true;
      return out;
    } catch {
      backendAvailable = false;
      throw httpErr;
    }
  } finally {
    clearTimeout(timer);
  }
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
    const prompt = `Extract concrete commitments (promises to do something, or requests asked of the reader) from this message. The user ${
      input.outgoing ? 'WROTE' : 'RECEIVED'
    } it. Counterparty: ${input.counterpartyName}.\n\nMessage:\n"""${input.body.slice(0, 2000)}"""\n\nReturn ONLY a JSON array. Each item: {"text": short action, "direction": "you_owe"|"they_owe", "due": natural-language deadline or null}. Empty array if none.`;
    const raw = await runAidenPrompt(prompt);
    const parsed = parseJsonLoose<Array<{ text: string; direction: string; due?: string | null }>>(raw);
    if (!parsed || !Array.isArray(parsed)) return heuristic;

    return parsed
      .filter((p) => p.text && (p.direction === 'you_owe' || p.direction === 'they_owe'))
      .slice(0, 4)
      .map((p, i) => {
        const due = p.due ? resolveDueDate(p.due, input.timestamp ? new Date(input.timestamp) : new Date()) : {};
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
          confidence: 0.9,
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
}

export async function synthesizeDayBrief(ctx: DayBriefContext): Promise<string> {
  try {
    const prompt = `Write one warm, concise sentence (max 22 words) summarizing the user's day as a calm chief-of-staff. Data: ${ctx.attentionCount} things need attention, ${ctx.opportunityCount} opportunities, ${ctx.meetingsToday} meetings today, ${ctx.openCommitments} open commitments. No greeting, no emoji.`;
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
    const prompt = `You are a chief of staff preparing the user for a meeting with ${input.personName}${
      input.role ? ` (${input.role})` : ''
    }. Recent threads: ${input.recentSubjects.join('; ') || 'none'}. Context: ${
      input.context.join('; ') || 'none'
    }. Open commitments: ${input.openCommitments.map((c) => c.text).join('; ') || 'none'}.

Return ONLY JSON: {"headline": one sentence, "objectives": [2-3 strings], "suggestedQuestions": [2-3 strings], "watchOuts": [1-2 strings]}.`;
    const raw = await runAidenPrompt(prompt);
    const parsed = parseJsonLoose<Omit<MeetingBrief, 'generatedByAi'>>(raw);
    if (parsed && parsed.objectives) return { ...parsed, generatedByAi: true };
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
    const prompt = `In one short, specific sentence, advise the user on their relationship with ${input.name} (${input.category}, strength ${input.relationshipScore}/100, ${
      input.daysSinceContact ?? '?'
    } days since contact, ${input.pendingFromYou} things you owe them). Sound like a sharp chief of staff.`;
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

export function isAidenBackendKnownDown(): boolean {
  return backendAvailable === false;
}
