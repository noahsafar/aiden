/**
 * Shared auth token shape.
 *
 * NOTE: The canonical Email model lives in `@/stores/emailStore` — the live store the
 * whole app actually uses. The duplicate Email/EmailStatus/EmailCategory/EmailSummary/
 * EmailClassification/GeneratedReply/WritingStyle/EmailStats/Settings types that used
 * to live here were dead (only `AuthToken` was ever imported from this file) and had
 * drifted from reality — e.g. EmailCategory declared 'Newsletter'/'Notification' values
 * the classifier never produced, which is exactly what mislabeled mail relied on. They
 * were removed to keep a single source of truth.
 */
export interface AuthToken {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}
