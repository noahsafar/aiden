import { describe, it, expect } from 'vitest';
import { resolveDueDate, isOverdue, dueLabel, type Commitment } from '@/lib/commitments';

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

describe('dueLabel', () => {
  it('labels overdue items', () => {
    const past = new Date(NOW.getTime() - 2 * 86400000).toISOString();
    expect(dueLabel(mk({ dueDate: past }), NOW)).toMatch(/overdue/i);
  });

  it('falls back to dueText when there is no date', () => {
    expect(dueLabel(mk({ dueDate: undefined, dueText: 'soon' }), NOW)).toBe('soon');
  });
});
