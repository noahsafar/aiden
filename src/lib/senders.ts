/**
 * Shared sender parsing + quality filtering.
 *
 * Aiden's surfaces should only ever treat *real people* as relationships,
 * commitments, and opportunities. Automated senders (shipping, billing robots,
 * no-reply, marketing) are noise in a chief-of-staff briefing. This mirrors the
 * filtering crmStore already does when extracting contacts.
 */

export interface ParsedSender {
  name: string;
  email?: string;
}

export function parseSender(raw = ''): ParsedSender {
  const nameMatch = raw.match(/^(.+?)\s*</);
  const emailMatch = raw.match(/<([^>]+)>/);
  const email = (emailMatch?.[1] || (raw.includes('@') ? raw.trim() : undefined))?.toLowerCase();
  const name = (nameMatch?.[1] || raw.split('@')[0] || 'Someone').replace(/["']/g, '').trim();
  return { name, email };
}

// Address fragments that indicate a robot / transactional sender.
const AUTOMATED_FRAGMENTS = [
  'noreply',
  'no-reply',
  'no_reply',
  'donotreply',
  'do-not-reply',
  'mailer-daemon',
  'postmaster@',
  'notifications@',
  'notification@',
  'updates@',
  'shipment',
  'shipping@',
  'orders@',
  'order@',
  'billing@',
  'invoice@',
  'receipts@',
  'support@',
  'help@',
  'info@',
  'hello@',
  'team@',
  'mail@',
  'news@',
  'newsletter@',
  'marketing@',
  'alerts@',
  'alert@',
  'auto-confirm',
  'bounce',
  'mailchimp',
  'sendgrid',
];

// Display-name signals for automated senders (when the address is generic).
const AUTOMATED_NAMES = /\b(shipping|shipment|delivery|billing|invoice|notification|no.?reply|newsletter|team|support|receipts?|orders?|alerts?|the .* team)\b/i;

export function isAutomatedSender(raw = ''): boolean {
  const { name, email } = parseSender(raw);
  const e = (email || raw).toLowerCase();
  if (AUTOMATED_FRAGMENTS.some((f) => e.includes(f))) return true;
  // "Amazon Shipping", "Etsy Shipping", "Billing", "HR", etc.
  if (AUTOMATED_NAMES.test(name)) return true;
  return false;
}

/** Is this address the user themselves? */
export function isSelf(email: string | undefined, userEmail?: string): boolean {
  if (!email) return false;
  const e = email.toLowerCase();
  if (e === 'me' || e === 'you') return true;
  if (userEmail && e === userEmail.toLowerCase()) return true;
  return false;
}
