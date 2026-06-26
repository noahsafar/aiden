import { describe, it, expect } from 'vitest';
import { deriveOpportunities } from '@/lib/aidenBrain';

const base = {
  sentEmails: [],
  contacts: [],
  commitments: [],
  slack: [],
  userEmail: 'noah@yale.edu',
} as any;

function email(partial: any) {
  return {
    id: 'e1',
    thread_id: 't1',
    subject: '',
    sender: '',
    body_text: '',
    snippet: '',
    date: new Date().toISOString(),
    status: 'Unhandled',
    category: 'Normal',
    ...partial,
  };
}

describe('deriveOpportunities — bulk mail is never a relationship opportunity', () => {
  it('skips a newsletter even when it contains opportunity keywords (the Yale bug)', () => {
    const emails = [
      email({
        sender: 'Yale Clean Energy <cbey@yale.edu>',
        subject: 'Spring digest — apply to our clean energy accelerator',
        body_text:
          'Applications are open. Apply by March 1.\n' +
          'Unsubscribe | View this email in your browser | Manage your preferences',
      }),
    ];
    expect(deriveOpportunities({ ...base, emails })).toHaveLength(0);
  });

  it('skips bulk mail the classifier flagged Low, even from a neutral sender', () => {
    const emails = [
      email({
        sender: 'Deals <deals@shop.example>',
        subject: 'launching our biggest sale',
        body_text: 'We just launched! Huge savings inside.',
        category: 'Low',
      }),
    ];
    expect(deriveOpportunities({ ...base, emails })).toHaveLength(0);
  });

  it('still surfaces a real hiring signal from a real person', () => {
    const emails = [
      email({
        sender: 'Sarah Chen <sarah@acme.com>',
        subject: 'we are hiring',
        body_text: "We're hiring a VP of Sales — know anyone great?",
      }),
    ];
    const opps = deriveOpportunities({ ...base, emails });
    expect(opps.length).toBeGreaterThanOrEqual(1);
    expect(opps[0].person?.email).toBe('sarah@acme.com');
  });
});
