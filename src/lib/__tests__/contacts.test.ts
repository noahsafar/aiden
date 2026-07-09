import { describe, it, expect } from 'vitest';
import {
  extractEmailAddress,
  extractName,
  extractDomain,
  parseRecipients,
  shouldSkipContact,
  betterName,
  computeTrajectory,
} from '@/lib/contacts';

describe('extractEmailAddress', () => {
  it('reads the address out of "Name <email>"', () => {
    expect(extractEmailAddress('Paris Mielke <paris@example.com>')).toBe('paris@example.com');
  });

  it('accepts a bare address', () => {
    expect(extractEmailAddress('PARIS@Example.com')).toBe('paris@example.com');
  });

  it('returns empty for a name-only fragment (no phantom contact)', () => {
    // This is the "Mielke" half of a split "Mielke, Paris <…>" header.
    expect(extractEmailAddress('Mielke')).toBe('');
    expect(extractEmailAddress('Paris Mielke')).toBe('');
  });
});

describe('extractName', () => {
  it('reads the display name', () => {
    expect(extractName('Paris Mielke <paris@example.com>')).toBe('Paris Mielke');
  });
  it('normalizes "Last, First" to "First Last"', () => {
    expect(extractName('"Mielke, Paris" <paris@example.com>')).toBe('Paris Mielke');
    expect(extractName('Mielke, Paris <paris@example.com>')).toBe('Paris Mielke');
  });
  it('returns undefined for a bare address', () => {
    expect(extractName('paris@example.com')).toBeUndefined();
  });
});

describe('betterName', () => {
  it('prefers the fuller name', () => {
    expect(betterName('Paris', 'Paris Mielke')).toBe('Paris Mielke');
    expect(betterName('Paris Mielke', 'Paris')).toBe('Paris Mielke');
  });
  it('prefers a capitalized name over a lowercase handle', () => {
    expect(betterName('paris', 'Paris')).toBe('Paris');
  });
  it('falls back to whichever exists', () => {
    expect(betterName(undefined, 'Paris')).toBe('Paris');
    expect(betterName('Paris', undefined)).toBe('Paris');
  });
});

describe('extractDomain', () => {
  it('returns the domain', () => {
    expect(extractDomain('paris@example.com')).toBe('example.com');
  });
});

describe('parseRecipients', () => {
  it('parses a JSON array', () => {
    expect(parseRecipients('["a@x.com","b@y.com"]')).toEqual(['a@x.com', 'b@y.com']);
  });

  it('parses a comma-separated header', () => {
    expect(parseRecipients('Alice <a@x.com>, Bob <b@y.com>')).toEqual([
      'Alice <a@x.com>',
      'Bob <b@y.com>',
    ]);
  });

  it('does NOT split inside a "Last, First <email>" display name', () => {
    // Regression: this used to produce a phantom "Mielke" recipient with no address.
    const tokens = parseRecipients('Mielke, Paris <paris@example.com>, Bob <bob@y.com>');
    const addrs = tokens.map(extractEmailAddress).filter(Boolean);
    expect(addrs).toEqual(['paris@example.com', 'bob@y.com']);
    // No token resolves to a bare last name.
    expect(addrs).not.toContain('mielke');
  });
});

describe('shouldSkipContact', () => {
  it('keeps real people', () => {
    expect(shouldSkipContact('paris@example.com', 'Paris Mielke')).toBe(false);
  });

  it('skips automated infrastructure', () => {
    expect(shouldSkipContact('no-reply@acme.com')).toBe(true);
    expect(shouldSkipContact('notifications@github.com')).toBe(true);
    expect(shouldSkipContact('mailer-daemon@x.com')).toBe(true);
  });

  it('skips role mailboxes by local-part', () => {
    expect(shouldSkipContact('customerservice@socalgas.com')).toBe(true);
    expect(shouldSkipContact('support@vendor.com')).toBe(true);
    expect(shouldSkipContact('billing@vendor.com')).toBe(true);
    expect(shouldSkipContact('support+eu@vendor.com')).toBe(true);
  });

  it('skips role senders by display name even with a personal-looking address', () => {
    // The reported case: "SCG Customer Service".
    expect(shouldSkipContact('scg-cs@socalgas.com', 'SCG Customer Service')).toBe(true);
  });

  it('skips brand / program / marketing senders by name', () => {
    expect(shouldSkipContact('fellowships@yale.edu', 'Yale Fellowship Programs')).toBe(true);
    expect(shouldSkipContact('store-news@amazon.com', 'Amazon Prime Day')).toBe(true);
  });

  it('skips newsletter senders by name', () => {
    expect(shouldSkipContact('cooking@nytimes.com', 'NYT Cooking')).toBe(true);
  });

  it('skips company / brand names (airlines, hotels, Inc, …)', () => {
    expect(shouldSkipContact('deals@flyfrontier.com', 'Frontier Airlines')).toBe(true);
    expect(shouldSkipContact('hi@delta.com', 'Delta Air Lines')).toBe(true);
    expect(shouldSkipContact('x@example.com', 'Marriott Hotels')).toBe(true);
    expect(shouldSkipContact('x@example.com', 'Geico Insurance')).toBe(true);
    expect(shouldSkipContact('x@example.com', 'Acme Corp')).toBe(true);
  });

  it('skips bulk-mail subdomains and ESP domains', () => {
    expect(shouldSkipContact('xyz@email.amazon.com', 'Amazon')).toBe(true);
    expect(shouldSkipContact('promo@e.amazonprime.com')).toBe(true);
    expect(shouldSkipContact('abc@news.yale.edu')).toBe(true);
    expect(shouldSkipContact('u123@mailchimp.com')).toBe(true);
  });

  it('skips bounce-token / tracking-id local-parts', () => {
    expect(shouldSkipContact('bounce-9382016@x.com')).toBe(true);
  });

  it('does not flag a real person whose domain merely contains a role word', () => {
    expect(shouldSkipContact('jane@support-systems.com', 'Jane Doe')).toBe(false);
  });

  it('keeps a real person on a normal university/company domain', () => {
    expect(shouldSkipContact('erin.macdonnell@yale.edu', 'Erin MacDonnell')).toBe(false);
    expect(shouldSkipContact('paris.mielke@gmail.com', 'Paris Mielke')).toBe(false);
  });
});

describe('computeTrajectory', () => {
  const NOW = new Date('2026-06-25T12:00:00Z').getTime();
  const days = (n: number) => n * 86400000;

  it('flags a normally-weekly contact gone quiet as overdue', () => {
    // ~7-day cadence over ~6 months, but silent for 45 days → well past rhythm.
    const t = computeTrajectory(
      { firstSeen: NOW - days(200), lastContacted: NOW - days(45), totalEmails: 24 },
      NOW,
    );
    expect(t.trend).toBe('overdue');
    expect(t.cadenceDays).toBeLessThanOrEqual(10);
    expect(t.daysSince).toBe(45);
  });

  it('treats a contact within their usual cadence as steady', () => {
    const t = computeTrajectory(
      { firstSeen: NOW - days(200), lastContacted: NOW - days(5), totalEmails: 24 },
      NOW,
    );
    expect(t.trend).toBe('steady');
  });

  it('marks a moderate gap (≈2× cadence) as cooling', () => {
    const t = computeTrajectory(
      { firstSeen: NOW - days(140), lastContacted: NOW - days(14), totalEmails: 19 },
      NOW,
    );
    expect(t.trend).toBe('cooling');
  });

  it('returns "new" without enough history', () => {
    expect(
      computeTrajectory({ firstSeen: NOW - days(3), lastContacted: NOW - days(1), totalEmails: 2 }, NOW).trend,
    ).toBe('new');
  });
});
