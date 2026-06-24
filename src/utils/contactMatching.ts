import type { Contact } from '@/stores/crmStore';

/**
 * Fuzzy contact matching for the chat command system. When the user says
 * "email John", we match against known contacts and, if it's ambiguous,
 * ask them to clarify which person they meant.
 */

export interface ContactMatch {
  contact: Contact;
  score: number; // 0..1
}

function norm(s: string): string {
  return (s || '').toLowerCase().trim();
}

/** Score a single contact against a free-text query. */
function scoreContact(query: string, contact: Contact): number {
  const q = norm(query);
  if (!q) return 0;
  const name = norm(contact.name);
  const email = norm(contact.email_address);
  const first = name.split(/\s+/)[0] || '';

  // Direct email match is unambiguous.
  if (email === q) return 1;
  if (q.includes('@') && email.includes(q)) return 0.95;

  if (name === q) return 0.97;
  if (first === q) return 0.9;
  if (name.startsWith(q)) return 0.85;
  if (first.startsWith(q)) return 0.78;
  if (name.includes(q)) return 0.6;
  if (email.split('@')[0].includes(q)) return 0.5;
  return 0;
}

export function fuzzyMatchContacts(query: string, contacts: Contact[], limit = 5): ContactMatch[] {
  const q = norm(query);
  if (!q) return [];
  return contacts
    .map((contact) => ({ contact, score: scoreContact(q, contact) }))
    .filter((m) => m.score > 0.4)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Clarification is needed when the top match isn't clearly the winner —
 * either several comparably-scored candidates, or no confident match.
 */
export function needsClarification(matches: ContactMatch[]): boolean {
  if (matches.length <= 1) return false;
  const [first, second] = matches;
  // A near-perfect, distinct top match doesn't need clarification.
  if (first.score >= 0.95 && first.score - second.score >= 0.2) return false;
  // Otherwise, if the runner-up is close, ask.
  return second.score >= 0.55 && first.score - second.score < 0.2;
}

export function formatClarificationMessage(matches: ContactMatch[]): string {
  const lines = matches
    .slice(0, 5)
    .map((m, i) => {
      const name = m.contact.name || m.contact.email_address;
      return `${i + 1}. ${name}${m.contact.name ? ` (${m.contact.email_address})` : ''}`;
    })
    .join('\n');
  return `I found a few people who could match. Which one did you mean?\n\n${lines}\n\nReply with a number or a name.`;
}
