// Fuzzy matching utilities for AI test assertions

// ==================== DATE MATCHING ====================

/**
 * Parse a date string into a Date object. Handles ISO dates, natural language like
 * "next Friday", "March 1st", "2025-02-15", etc.
 * Returns null if unparseable.
 */
function parseFlexibleDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  const cleaned = dateStr.trim();
  if (!cleaned) return null;

  // Try ISO / standard date parse first
  const direct = new Date(cleaned);
  if (!isNaN(direct.getTime())) return direct;

  // Try extracting a date-like pattern from natural language
  // e.g. "February 15, 2025", "Feb 15", "2/15/2025"
  const monthDayYear = cleaned.match(
    /(\w+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?/i
  );
  if (monthDayYear) {
    const year = monthDayYear[3] || new Date().getFullYear().toString();
    const attempt = new Date(`${monthDayYear[1]} ${monthDayYear[2]}, ${year}`);
    if (!isNaN(attempt.getTime())) return attempt;
  }

  return null;
}

/**
 * Check if two date strings are within `toleranceDays` of each other.
 * Returns true if either date is unparseable (lenient matching).
 */
export function datesMatch(
  actual: string | null | undefined,
  expected: string | null | undefined,
  toleranceDays: number = 3
): boolean {
  if (!expected) return true; // No expected date = pass
  if (!actual && expected) return false; // Expected a date but got none

  const a = parseFlexibleDate(actual);
  const b = parseFlexibleDate(expected);

  // If we can't parse either, do a string containment check
  if (!a || !b) {
    if (actual && expected) {
      return actual.toLowerCase().includes(expected.toLowerCase()) ||
        expected.toLowerCase().includes(actual.toLowerCase());
    }
    return false;
  }

  const diffMs = Math.abs(a.getTime() - b.getTime());
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays <= toleranceDays;
}

// ==================== TONE MATCHING ====================

const TONE_SYNONYM_GROUPS: string[][] = [
  ['frustrated', 'annoyed', 'irritated', 'angry', 'upset', 'dissatisfied', 'displeased'],
  ['excited', 'enthusiastic', 'thrilled', 'eager', 'energetic', 'pumped'],
  ['apologetic', 'sorry', 'remorseful', 'regretful', 'contrite'],
  ['friendly', 'warm', 'kind', 'cordial', 'pleasant', 'welcoming', 'personable'],
  ['neutral', 'professional', 'businesslike', 'matter-of-fact', 'straightforward'],
  ['urgent', 'pressing', 'time-sensitive', 'critical', 'immediate'],
  ['formal', 'polite', 'respectful', 'courteous', 'professional'],
  ['casual', 'informal', 'relaxed', 'laid-back', 'conversational'],
  ['concerned', 'worried', 'anxious', 'uneasy', 'apprehensive'],
  ['grateful', 'thankful', 'appreciative'],
  ['demanding', 'insistent', 'forceful', 'assertive', 'pushy'],
];

/**
 * Check if the actual tone matches any of the acceptable tones,
 * using synonym groups for fuzzy matching.
 */
export function toneMatches(
  actual: string | null | undefined,
  acceptableTones: string[]
): boolean {
  if (!actual) return false;
  if (acceptableTones.length === 0) return true;

  const actualLower = actual.toLowerCase().trim();

  // Direct match
  if (acceptableTones.some(t => actualLower.includes(t.toLowerCase()))) return true;

  // Synonym group match
  for (const group of TONE_SYNONYM_GROUPS) {
    const actualInGroup = group.some(syn => actualLower.includes(syn));
    if (actualInGroup) {
      const expectedInGroup = acceptableTones.some(t =>
        group.some(syn => syn.includes(t.toLowerCase()) || t.toLowerCase().includes(syn))
      );
      if (expectedInGroup) return true;
    }
  }

  return false;
}

// ==================== CATEGORY MATCHING ====================

/**
 * Check if the actual category matches the expected category
 * or any of the acceptable alternatives.
 */
export function categoryMatches(
  actual: string | null | undefined,
  expected: string,
  acceptableAlternatives?: string[]
): boolean {
  if (!actual) return false;
  const actualLower = actual.toLowerCase().trim();
  if (actualLower === expected.toLowerCase()) return true;
  if (acceptableAlternatives) {
    return acceptableAlternatives.some(alt => actualLower === alt.toLowerCase());
  }
  return false;
}

// ==================== LIFE DATA MATCHING ====================

/**
 * Check if all expected life data types are present in the actual life data items.
 * Order-independent matching.
 */
export function lifeDataTypesMatch(
  actualItems: Array<{ data_type: string }>,
  expectedTypes: string[]
): boolean {
  if (expectedTypes.length === 0) return true;
  const actualTypes = new Set(actualItems.map(item => item.data_type.toLowerCase()));
  return expectedTypes.every(t => actualTypes.has(t.toLowerCase()));
}

// ==================== BOOLEAN / COUNT MATCHING ====================

/**
 * Check if a boolean matches expected value. Handles string "true"/"false" too.
 */
export function booleanMatches(
  actual: boolean | string | null | undefined,
  expected: boolean
): boolean {
  if (actual === null || actual === undefined) return !expected;
  if (typeof actual === 'string') {
    return (actual.toLowerCase() === 'true') === expected;
  }
  return actual === expected;
}

/**
 * Check if a count is within an expected range.
 */
export function countInRange(
  actual: number,
  min?: number,
  max?: number
): boolean {
  if (min !== undefined && actual < min) return false;
  if (max !== undefined && actual > max) return false;
  return true;
}

// ==================== KEYWORD MATCHING ====================

/**
 * Check if any of the expected keywords appear in the actual attachment-related fields.
 */
export function keywordsPresent(
  actualKeywords: string[],
  expectedKeywords: string[]
): boolean {
  if (expectedKeywords.length === 0) return true;
  const actualJoined = actualKeywords.map(k => k.toLowerCase()).join(' ');
  return expectedKeywords.some(kw => actualJoined.includes(kw.toLowerCase()));
}

// ==================== FORMALITY RANGE MATCHING ====================

/**
 * Check if a formality score falls within an expected range.
 * Range is inclusive: [min, max].
 */
export function formalityInRange(
  actual: number | null | undefined,
  expectedRange: [number, number]
): boolean {
  if (actual === null || actual === undefined) return false;
  return actual >= expectedRange[0] && actual <= expectedRange[1];
}

// ==================== DEADLINE DISPLAY MATCHING ====================

/**
 * Simulate the deadline display logic from EmailList.tsx getNeedsAttentionInfo.
 * Given a deadline date string (ISO format), returns the display text like
 * "Due today", "Due tomorrow", "Due in 7 days", "Overdue by 1 day", etc.
 */
export function simulateDeadlineDisplay(deadlineStr: string): string {
  const parts = deadlineStr.split('-');
  const deadlineDate = parts.length === 3
    ? new Date(+parts[0], +parts[1] - 1, +parts[2])
    : new Date(deadlineStr);

  if (isNaN(deadlineDate.getTime())) return `Unknown: ${deadlineStr}`;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const deadlineDay = new Date(deadlineDate.getFullYear(), deadlineDate.getMonth(), deadlineDate.getDate());
  const daysUntil = Math.round((deadlineDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (daysUntil < 0) {
    return daysUntil === -1 ? 'Overdue by 1 day' : `Overdue by ${-daysUntil} days`;
  }
  if (daysUntil === 0) return 'Due today';
  if (daysUntil === 1) return 'Due tomorrow';
  return `Due in ${daysUntil} days`;
}

/**
 * Check if the deadline display text matches expected.
 * Uses the simulation function to compute from the actual deadline date,
 * then compares against the expected display string.
 */
export function deadlineDisplayMatches(
  actualDeadlineDate: string | null | undefined,
  expectedDisplay: string
): boolean {
  if (!actualDeadlineDate) return false;
  const simulated = simulateDeadlineDisplay(actualDeadlineDate);
  return simulated.toLowerCase() === expectedDisplay.toLowerCase();
}

// ==================== CRM EXTRACTION SIMULATION ====================

export interface CRMExtraction {
  name: string | null;
  email: string;
  domain: string | null;
  isNoreply: boolean;
}

/**
 * Simulate CRM contact extraction from a sender string.
 * Mirrors crmStore.ts extractContacts logic for sender parsing.
 */
export function simulateCRMExtraction(sender: string): CRMExtraction {
  // Extract email address
  let email: string;
  const emailMatch = sender.match(/<([^>]+)>/);
  if (emailMatch) {
    email = emailMatch[1].toLowerCase().trim();
  } else if (sender.includes('@')) {
    email = sender.trim().toLowerCase();
  } else {
    email = sender.toLowerCase();
  }

  // Extract name
  let name: string | null = null;
  const nameMatch = sender.match(/^(.+?)\s*</);
  if (nameMatch) {
    const cleaned = nameMatch[1].trim().replace(/^["']|["']$/g, '');
    if (cleaned) name = cleaned;
  }

  // Extract domain
  let domain: string | null = null;
  const atIndex = email.indexOf('@');
  if (atIndex >= 0) domain = email.substring(atIndex + 1);

  // Check if noreply
  const lower = email.toLowerCase();
  const isNoreply = lower.includes('noreply') ||
    lower.includes('no-reply') ||
    lower.includes('mailer-daemon') ||
    lower.includes('postmaster@') ||
    lower.includes('notifications@') ||
    lower.includes('donotreply');

  return { name, email, domain, isNoreply };
}
