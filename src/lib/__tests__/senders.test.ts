import { describe, it, expect } from 'vitest';
import { parseSender, isAutomatedSender, isSelf } from '@/lib/senders';

describe('parseSender', () => {
  it('splits "Name <addr>"', () => {
    expect(parseSender('Sarah Chen <sarah@acme.com>')).toEqual({
      name: 'Sarah Chen',
      email: 'sarah@acme.com',
    });
  });

  it('handles a bare address', () => {
    expect(parseSender('bob@gmail.com').email).toBe('bob@gmail.com');
  });

  it('lowercases the address', () => {
    expect(parseSender('X <Sarah@Acme.com>').email).toBe('sarah@acme.com');
  });
});

describe('isAutomatedSender', () => {
  it('flags no-reply / newsletter / list / ESP addresses', () => {
    expect(isAutomatedSender('noreply@stripe.com')).toBe(true);
    expect(isAutomatedSender('Yale <newsletter@yale.edu>')).toBe(true);
    expect(isAutomatedSender('news@e.company.com')).toBe(true);
    expect(isAutomatedSender('Constant Contact <x@ccsend.com>')).toBe(true);
    expect(isAutomatedSender('x@substack.com')).toBe(true);
  });

  it('flags automated display names even with a neutral address', () => {
    expect(isAutomatedSender('Shipping Updates <x@store.example>')).toBe(true);
  });

  it('does NOT flag real people', () => {
    expect(isAutomatedSender('Sarah Chen <sarah@acme.com>')).toBe(false);
    expect(isAutomatedSender('bob@gmail.com')).toBe(false);
  });
});

describe('isSelf', () => {
  it('matches me/you tokens and the user address', () => {
    expect(isSelf('me')).toBe(true);
    expect(isSelf('you')).toBe(true);
    expect(isSelf('noah@yale.edu', 'noah@yale.edu')).toBe(true);
  });

  it('does not match other people', () => {
    expect(isSelf('sarah@acme.com', 'noah@yale.edu')).toBe(false);
    expect(isSelf(undefined)).toBe(false);
  });
});
