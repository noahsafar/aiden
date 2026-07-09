import { describe, it, expect } from 'vitest';
import {
  resolveDueDate,
  isPlausibleDueDate,
  resolveFulfilledCommitments,
  isOverdue,
  dueLabel,
  type Commitment,
} from '@/lib/commitments';

// Deterministic "now" so date logic doesn't depend on the wall clock.
const NOW = new Date('2026-06-25T12:00:00Z');

function mk(partial: Partial<Commitment>): Commitment {
  return {
    id: 'c1',
    direction: 'you_owe',
    text: 'Send the deck',
    excerpt: '',
    counterpartyName: 'Sarah',
    emailId: 'e1',
    threadId: 't1',
    status: 'open',
    createdAt: NOW.toISOString(),
    confidence: 1,
    source: 'heuristic',
    ...partial,
  };
}

describe('resolveDueDate', () => {
  it('resolves "EOD" to the same calendar day', () => {
    const { iso } = resolveDueDate('please send by EOD', NOW);
    expect(iso).toBeDefined();
    expect(new Date(iso!).toDateString()).toBe(NOW.toDateString());
  });

  it('resolves "tomorrow" to the next day', () => {
    const { iso } = resolveDueDate('I will get it to you tomorrow', NOW);
    expect(iso).toBeDefined();
    const expected = new Date(NOW);
    expected.setDate(expected.getDate() + 1);
    expect(new Date(iso!).toDateString()).toBe(expected.toDateString());
  });

  it('returns no iso when there is no date', () => {
    expect(resolveDueDate('just checking in', NOW).iso).toBeUndefined();
  });

  it('anchors on an explicit calendar date, not a greeting weekday', () => {
    // Regression: "Happy Monday" greeting was parsed as the deadline instead of
    // the real "this Thursday, July 2nd". The explicit date must win.
    const text = 'Happy Monday, the deadline for donations is this Thursday, July 2nd.';
    const { iso } = resolveDueDate(text, new Date('2026-06-30T09:24:00'));
    expect(iso).toBeDefined();
    expect(new Date(iso!).toDateString()).toBe(new Date('2026-07-02T17:00:00').toDateString());
  });

  it('ignores a bare greeting weekday with no deadline cue', () => {
    expect(resolveDueDate('Have a great Monday!', NOW).iso).toBeUndefined();
  });

  it('still resolves a weekday with a deadline cue ("by Friday")', () => {
    const { iso } = resolveDueDate('please get it to me by Friday', NOW);
    expect(iso).toBeDefined();
  });
});

describe('isPlausibleDueDate', () => {
  const REF = new Date('2026-06-25T12:00:00Z');
  const at = (deltaDays: number) => new Date(REF.getTime() + deltaDays * 86400000).toISOString();

  it('accepts a near-future date', () => {
    expect(isPlausibleDueDate(at(3), REF)).toBe(true);
  });

  it('accepts a same-day deadline a few hours past', () => {
    expect(isPlausibleDueDate(new Date(REF.getTime() - 3 * 3600000).toISOString(), REF)).toBe(true);
  });

  it('rejects a date well before the message was written', () => {
    expect(isPlausibleDueDate(at(-10), REF)).toBe(false);
  });

  it('rejects an absurd far-future date', () => {
    expect(isPlausibleDueDate(at(1000), REF)).toBe(false);
  });

  it('rejects undefined or unparseable input', () => {
    expect(isPlausibleDueDate(undefined, REF)).toBe(false);
    expect(isPlausibleDueDate('not a date', REF)).toBe(false);
  });
});

describe('resolveDueDate plausibility clamp', () => {
  it('drops an absurd "in N days" horizon instead of returning a far date', () => {
    expect(resolveDueDate('I will send it in 9999 days', new Date('2026-06-25T12:00:00Z')).iso).toBeUndefined();
  });
});

describe('isOverdue', () => {
  const past = new Date(NOW.getTime() - 86400000).toISOString();
  const future = new Date(NOW.getTime() + 86400000).toISOString();

  it('is true for an open commitment past its due date', () => {
    expect(isOverdue(mk({ dueDate: past }), NOW)).toBe(true);
  });

  it('is false when done, undated, or in the future', () => {
    expect(isOverdue(mk({ dueDate: past, status: 'done' }), NOW)).toBe(false);
    expect(isOverdue(mk({ dueDate: undefined }), NOW)).toBe(false);
    expect(isOverdue(mk({ dueDate: future }), NOW)).toBe(false);
  });
});

describe('resolveFulfilledCommitments', () => {
  const theyOwe = mk({
    direction: 'they_owe',
    threadId: 't1',
    createdAt: '2026-06-20T10:00:00Z',
    status: 'open',
  });

  it('closes a they_owe loop when a later thread reply has an attachment', () => {
    const out = resolveFulfilledCommitments(
      [theyOwe],
      [{ threadId: 't1', date: '2026-06-21T09:00:00Z', body: 'np', hasAttachments: true }],
    );
    expect(out[0].status).toBe('done');
  });

  it('closes when a later reply uses a delivery phrase', () => {
    const out = resolveFulfilledCommitments(
      [theyOwe],
      [{ threadId: 't1', date: '2026-06-21T09:00:00Z', body: "Here's the deck you asked for." }],
    );
    expect(out[0].status).toBe('done');
  });

  it('stays open for an earlier reply or a different thread', () => {
    expect(
      resolveFulfilledCommitments([theyOwe], [
        { threadId: 't1', date: '2026-06-19T09:00:00Z', hasAttachments: true },
      ])[0].status,
    ).toBe('open');
    expect(
      resolveFulfilledCommitments([theyOwe], [
        { threadId: 't2', date: '2026-06-22T09:00:00Z', hasAttachments: true },
      ])[0].status,
    ).toBe('open');
  });

  it('ignores you_owe commitments (those close when you send)', () => {
    const youOwe = mk({ direction: 'you_owe', threadId: 't1', createdAt: '2026-06-20T10:00:00Z' });
    const out = resolveFulfilledCommitments(
      [youOwe],
      [{ threadId: 't1', date: '2026-06-21T09:00:00Z', hasAttachments: true }],
    );
    expect(out[0].status).toBe('open');
  });
});

describe('dueLabel', () => {
  it('labels overdue items', () => {
    const past = new Date(NOW.getTime() - 2 * 86400000).toISOString();
    expect(dueLabel(mk({ dueDate: past }), NOW)).toMatch(/overdue/i);
  });

  it('falls back to dueText when there is no date', () => {
    expect(dueLabel(mk({ dueDate: undefined, dueText: 'soon' }), NOW)).toBe('soon');
  });
});
