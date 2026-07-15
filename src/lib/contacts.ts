/* ------------------------------------------------------------------ */
/* Contact / address parsing                                           */
/*                                                                     */
/* Pure, deterministic helpers for turning raw email headers into the  */
/* people behind them. Kept separate from the store so they can be     */
/* unit-tested without the store's side effects.                       */
/* ------------------------------------------------------------------ */

/**
 * Pull a single valid email address out of a "Name <email>" / bare-email string.
 *
 * Returns '' when the string contains no real address — e.g. a stray "Mielke"
 * fragment left behind when a "Last, First <email>" header is split on its comma.
 * Callers can then skip it instead of minting a phantom contact keyed on a name.
 */
export function extractEmailAddress(raw: string): string {
  if (typeof raw !== 'string' || !raw) return '';
  const angle = raw.match(/<([^>]+)>/);
  const scope = angle ? angle[1] : raw;
  const m = scope.match(/[^\s<>,;"']+@[^\s<>,;"']+\.[^\s<>,;"']+/);
  return m ? m[0].toLowerCase().trim() : '';
}

/** Display name from "Name <email>", if one is present and isn't itself an address.
 *  Normalizes "Last, First" → "First Last" so the same person reads consistently. */
export function extractName(raw: string): string | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  const match = raw.match(/^(.+?)\s*</);
  let name = match ? match[1].trim() : raw.includes('@') ? '' : raw.trim();
  name = name.replace(/^["']|["']$/g, '').trim();
  if (!name || name.includes('@')) return undefined;
  // "Mielke, Paris" → "Paris Mielke" (single comma separating two name-ish parts).
  const comma = name.match(/^([^,]+),\s*([^,]+)$/);
  if (comma) {
    const [, last, first] = comma;
    if (last.trim() && first.trim()) name = `${first.trim()} ${last.trim()}`;
  }
  return name || undefined;
}

/** Pick the more complete / more human-looking display name between two candidates.
 *  Lets a later "Paris Mielke" upgrade an earlier bare "Paris" so contacts don't end
 *  up with last names on some and not others. */
export function betterName(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  const score = (n: string) => {
    const t = n.trim();
    let s = 0;
    if (t.split(/\s+/).length >= 2) s += 2; // has a first + last name
    if (/[A-Z]/.test(t)) s += 1; // properly capitalized
    if (t === t.toLowerCase()) s -= 1; // all-lowercase looks like a handle
    return s;
  };
  return score(b) > score(a) ? b : a;
}

/** Domain portion of an email address. */
export function extractDomain(email: string): string | undefined {
  const at = email.indexOf('@');
  return at >= 0 ? email.substring(at + 1) : undefined;
}

/**
 * Split a To/Cc value into individual recipient tokens.
 *
 * Accepts both a JSON array string and a raw comma-separated header. Crucially it
 * anchors on the address-bearing chunks rather than blindly splitting on commas,
 * so a "Last, First <email>" display name doesn't get torn into a phantom "Last"
 * recipient. Each returned token is still a "Name <email>" / bare-email string for
 * the caller to run through extractEmailAddress / extractName.
 */
export function parseRecipients(raw: string): string[] {
  if (typeof raw !== 'string' || !raw) return [];
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr)) return arr.map(String).map((s) => s.trim()).filter(Boolean);
    } catch {
      /* not valid JSON — fall through to header parsing */
    }
  }
  // Each match is either "<optional name> <email>" or a bare email token. The
  // name part stops at a comma or '<', so the leading "Last," of a "Last, First"
  // name is simply skipped instead of becoming its own recipient.
  const tokens = trimmed.match(/[^,<]*<[^>]+>|[^\s,<>]+@[^\s,<>]+/g);
  return tokens ? tokens.map((t) => t.trim()).filter(Boolean) : [];
}

/* ------------------------------------------------------------------ */
/* Automated / role-account filtering                                  */
/* ------------------------------------------------------------------ */

// Local-parts that denote a FUNCTION (support, billing, no-reply) rather than a
// person you have a relationship with. Matched against the exact local-part so we
// don't flag a real person at, say, support-systems.com.
const ROLE_LOCALPARTS = new Set([
  'noreply', 'no-reply', 'donotreply', 'do-not-reply', 'mailer-daemon', 'postmaster',
  'bounce', 'bounces', 'notification', 'notifications', 'alert', 'alerts', 'updates',
  'newsletter', 'news', 'mailer', 'mail', 'email',
  'customerservice', 'customer-service', 'customercare', 'customer-care',
  'support', 'helpdesk', 'service', 'services',
  'billing', 'invoice', 'invoices', 'payments', 'accounts', 'accounting',
  'info', 'hello', 'contact', 'inquiries', 'enquiries', 'admin',
  'sales', 'marketing', 'offers', 'deals', 'promotions', 'promo',
  'team', 'careers', 'jobs', 'recruiting', 'hr',
]);

// Bulk-mail subdomains used by marketing / notification infrastructure
// (email.amazon.com, e.amazonprime.com, news.yale.edu). Real people don't live here.
const BULK_SUBDOMAIN_RE =
  /^(?:e|em|email|mail|mailer|news|newsletter|marketing|mktg|reply|notify|notification|notifications|updates|alert|alerts|bounce|bounces|click|link|links|send|info)\./i;

// Email-service-provider / bulk-send domains: mail from here is a mass send.
const ESP_DOMAIN_RE =
  /(?:mailchimp|mcsv|rsgsv|list-manage|sendgrid|sparkpost(?:mail)?|amazonses|mailgun|constantcontact|sailthru|exacttarget|cmail\d*|createsend|mandrillapp|sendinblue|hubspot(?:email)?|marketo|pardot|icontact|campaign-?monitor|braze|customeriomail)\b/i;

// Display-name fragments that mark a brand / program / bulk / role sender rather
// than a person ("SCG Customer Service", "Yale Fellowship Programs", "Amazon Prime
// Day", "No Reply"). Curated to avoid colliding with common surnames.
const NONPERSON_NAME_RE =
  /\b(?:customer\s*(?:service|care|support|success)|no[\s-]?reply|do\s*not\s*reply|support\s*team|help\s*desk|notifications?|newsletter|digest|bulletin|announcements?|program(?:s|me)?|fellowship|scholarship|admissions?|alumni|webinar|listserv|mailing\s*list|recruit(?:ing|ment)?|payroll|prime\s*day|rewards?|membership|subscription|\bteam\b|department|office\s+of|billing\s*team|cooking|recipes|briefing|the\s+morning|weekly\s+\w+|daily\s+\w+)\b/i;

// Organization / brand / company display names — words that are essentially never
// a person's name ("Frontier Airlines", "Delta Air Lines", "Acme Hotels", "Foo
// Insurance", "Bar Inc"). Catches the long tail of brands without enumerating them.
const ORG_NAME_RE =
  /\b(?:air\s*lines?|airways|aviation|university|college|academy|institute|hospital|healthcare|clinic|pharmacy|insurance|mortgage|realty|realtors|motors|automotive|technologies|solutions|systems|logistics|ventures|holdings|enterprises|industries|manufacturing|telecom|wireless|utilities|networks|laborator(?:y|ies)|pharmaceuticals?|biotech|bancorp|savings|credit\s*union|supermarket|marketplace|outfitters|hotels?|resorts?|cruises?|vacations?|rentals?|leasing|brewing|distillery|winery|vineyards?|foods|beverages|fitness|wellness|dental|orthodontics|dermatology|veterinary|incorporated|corporation|company|inc|llc|ltd|corp|gmbh|plc)\b/i;

// Well-known brand / bulk senders that aren't people (the org-name regex misses
// single-word brands like "Fandango" or "Venmo").
const BRAND_NAME_RE =
  /\b(?:the\s+new\s+york\s+times|nyt|fandango|amtrak|coursera|venmo|cvs\s+photo|bank\s+of\s+america|google\s+cloud|substack|spotify|netflix|amazon|uber|lyft|doordash|instacart|delta\s+air)\b/i;

/**
 * Whether a sender/recipient should be kept OUT of the relationship graph because
 * it's an automated, transactional, bulk, or role mailbox rather than a real person.
 * Checks the address (local-part, subdomain, ESP) and the display name.
 */
export function shouldSkipContact(address: string, name?: string): boolean {
  const lower = (address || '').toLowerCase();
  // Automated infrastructure, regardless of how the local-part is shaped.
  if (/no.?reply|do.?not.?reply|donotreply|mailer-daemon|postmaster|notifications?/.test(lower)) {
    return true;
  }
  const local = lower.split('@')[0] || '';
  const domain = lower.split('@')[1] || '';
  // Strip plus-tags and trailing digits so "support+eu" / "info2024" still match.
  const normalized = local.replace(/\+.*$/, '').replace(/\d+$/, '');
  if (ROLE_LOCALPARTS.has(local) || ROLE_LOCALPARTS.has(normalized)) return true;
  // Bounce tokens / tracking ids: long digit runs or absurdly long local-parts.
  if (/\d{6,}/.test(local) || local.length > 32) return true;
  if (BULK_SUBDOMAIN_RE.test(domain) || ESP_DOMAIN_RE.test(domain)) return true;
  // Mailing-list infrastructure + envelope senders ('"Name" via List').
  if (/(?:^|\.)(elilists|listserv|listserver|mailman|elist)\./.test(domain)) return true;
  if (/^(?:emcom|ealerts|movies|learn|loyalty)\./.test(domain)) return true;
  if (name) {
    if (/\bvia\s+\S/i.test(name)) return true; // '"Araiya Casriel" via YUB Social'
    if (BRAND_NAME_RE.test(name)) return true;
    if (NONPERSON_NAME_RE.test(name) || ORG_NAME_RE.test(name)) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Relationship trajectory                                             */
/* ------------------------------------------------------------------ */

export type RelationshipTrend = 'new' | 'steady' | 'cooling' | 'overdue';

export interface TrajectoryInput {
  /** ms epoch of the first interaction with this person. */
  firstSeen?: number;
  /** ms epoch of the most recent interaction. */
  lastContacted?: number;
  /** total messages exchanged in either direction. */
  totalEmails: number;
}

export interface Trajectory {
  trend: RelationshipTrend;
  /** Typical days between touches for THIS relationship, when computable. */
  cadenceDays?: number;
  /** Days since the last interaction. */
  daysSince?: number;
}

const DAY_MS = 86400000;

/**
 * Classify where a relationship is heading, RELATIVE TO ITS OWN rhythm. A person
 * you normally talk to weekly going quiet for 45 days matters far more than a
 * quarterly contact at the same gap — a flat "30 days = cooling" rule misses
 * that. Pure + deterministic so it's unit-testable and works on day one (no
 * history to accumulate — the cadence is read straight from the mail corpus).
 */
export function computeTrajectory(input: TrajectoryInput, now: number = Date.now()): Trajectory {
  const { firstSeen, lastContacted, totalEmails } = input;
  const daysSince = lastContacted ? Math.floor((now - lastContacted) / DAY_MS) : undefined;
  const spanDays = firstSeen && lastContacted ? (lastContacted - firstSeen) / DAY_MS : 0;

  // Too little history to read a trend honestly.
  if (totalEmails < 2 || spanDays < 7 || daysSince === undefined) {
    return { trend: 'new', daysSince };
  }

  const cadenceDays = Math.max(1, spanDays / (totalEmails - 1));
  const ratio = daysSince / cadenceDays;
  const trend: RelationshipTrend = ratio >= 3 ? 'overdue' : ratio >= 1.6 ? 'cooling' : 'steady';
  return { trend, cadenceDays: Math.round(cadenceDays), daysSince };
}
