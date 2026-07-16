import { create } from 'zustand';
import { fetchGmailEmails, convertGmailEmailToApp } from '@/api/gmail';
import { useAuthStore } from '@/stores/authStore';
import { serverURL } from '@/api/emails';
import { analyzeEmail as analyzeEmailClaude, summarizeEmail as summarizeEmailClaude, generateReply as generateReplyClaude, classifyEmail as classifyEmailApi, getRecipientWritingStyle, analyzeAndSaveWritingStyle, type RecipientWritingStyle } from '@/api/claude';
import { classifyEmailViaChat } from '@/api/aiden';
import { useFeedbackStore } from './feedbackStore';
import { useContactMemoryStore } from './contactMemoryStore';
import { isAutomatedSender } from '@/lib/senders';

// Check if running in Tauri
const isTauri = typeof window !== 'undefined' && window.__TAURI_INTERNALS__;

// Helper function to get store state (will be initialized after store creation)
let getStoreState: () => any;

// Helper function to fetch with timeout (Ollama can take 20+ seconds on first load)
export async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 90000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // If a signal is already provided in options, we need to chain them
  // Abort when either the timeout expires or the provided signal aborts
  if (options.signal) {
    options.signal.addEventListener('abort', () => controller.abort());
    // Use the original signal for the fetch
    const signal = options.signal;
    try {
      const response = await fetch(url, {
        ...options,
        signal,
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      if ((error as Error).name === 'AbortError') {
        // Re-throw with original AbortError name (not "Request timeout")
        throw error;
      }
      throw error;
    }
  }

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if ((error as Error).name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  }
}

// Lazy load notification API only in Tauri
let sendTauriNotification: any = null;
async function sendNotification(title: string, body?: string): Promise<void> {
  if (!isTauri) return;
  try {
    if (!sendTauriNotification) {
      const plugin = await import('@tauri-apps/plugin-notification');
      sendTauriNotification = plugin.sendNotification;
    }
    const settings = await getSettings();
    // If preview is disabled, only send the title
    const notificationBody = (settings.show_notification_preview !== false) ? (body || '') : '';
    await sendTauriNotification({ title, body: notificationBody, icon: '/icons/icon.png' });
  } catch (e) {
    console.error('Notification error:', e);
  }
}

// Smart notification check - consults backend settings before notifying
interface NotificationCheckResult {
  should_notify: boolean;
  should_batch: boolean;
  reason: string;
}

let cachedSettings: any = null;
let settingsCacheTime = 0;
const SETTINGS_CACHE_TTL = 60000; // Cache settings for 1 minute

async function getSettings() {
  const now = Date.now();
  if (cachedSettings && (now - settingsCacheTime) < SETTINGS_CACHE_TTL) {
    return cachedSettings;
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    cachedSettings = await invoke('get_settings');
    settingsCacheTime = now;
    return cachedSettings;
  } catch (e) {
    console.error('Failed to get settings:', e);
    // Return default settings if fetch fails
    return {
      enable_notifications: true,
      notification_mode: 'smart',
      batch_notifications_enabled: true,
      quiet_hours_enabled: false,
      vip_senders: [],
      emergency_keywords: ['emergency', '911', 'urgent', 'critical', 'immediate', 'asap', 'fire'],
    };
  }
}

// Check if we should send a notification based on smart settings
async function shouldSendNotification(sender: string, subject: string, category: string): Promise<NotificationCheckResult> {
  try {
    const settings = await getSettings();

    // Update batch interval from settings
    currentBatchIntervalMs = (settings.batch_interval_minutes || 15) * 60 * 1000;

    if (!settings.enable_notifications) {
      return { should_notify: false, should_batch: false, reason: 'Notifications disabled' };
    }

    // Check for emergency keywords that bypass everything
    const subjectLower = subject.toLowerCase();
    const senderLower = sender.toLowerCase();
    for (const keyword of (settings.emergency_keywords || [])) {
      if (subjectLower.includes(keyword.toLowerCase()) || senderLower.includes(keyword.toLowerCase())) {
        console.log(`[Smart Notifications] Emergency keyword detected: ${keyword}`);
        return { should_notify: true, should_batch: false, reason: `Emergency: ${keyword}` };
      }
    }

    // Check quiet hours
    if (settings.quiet_hours_enabled) {
      const now = new Date();
      const currentTime = now.getHours() + now.getMinutes() / 60;
      const [startHour, startMin] = settings.quiet_hours_start.split(':').map(Number);
      const [endHour, endMin] = settings.quiet_hours_end.split(':').map(Number);
      const startTime = startHour + startMin / 60;
      const endTime = endHour + endMin / 60;

      // Handle overnight quiet hours (e.g., 22:00 to 08:00)
      const inQuietHours = startTime > endTime
        ? (currentTime >= startTime || currentTime < endTime)
        : (currentTime >= startTime && currentTime < endTime);

      if (inQuietHours) {
        // VIPs and urgent emails bypass quiet hours
        const isVip = (settings.vip_senders || []).some((vip: string) =>
          senderLower.includes(vip.toLowerCase())
        );
        const isUrgent = category.toLowerCase() === 'urgent';

        if (isVip) {
          return { should_notify: true, should_batch: false, reason: 'VIP during quiet hours' };
        } else if (isUrgent) {
          return { should_notify: true, should_batch: false, reason: 'Urgent during quiet hours' };
        } else {
          return { should_notify: false, should_batch: true, reason: 'Quiet hours' };
        }
      }
    }

    // Apply notification mode logic
    const categoryLower = category.toLowerCase();
    const isImportantSender = (settings.important_senders || []).some((imp: string) =>
      senderLower.includes(imp.toLowerCase())
    );

    switch (settings.notification_mode) {
      case 'all':
        return {
          should_notify: true,
          should_batch: settings.batch_notifications_enabled,
          reason: 'All mode'
        };
      case 'smart':
        if (categoryLower === 'urgent' || categoryLower === 'important' || isImportantSender) {
          return { should_notify: true, should_batch: false, reason: 'Smart: high priority' };
        }
        if (categoryLower === 'normal' || categoryLower === 'low') {
          return { should_notify: false, should_batch: true, reason: 'Smart: batch normal/low' };
        }
        return {
          should_notify: true,
          should_batch: settings.batch_notifications_enabled,
          reason: 'Smart: default'
        };
      case 'vip_only':
        if (categoryLower === 'urgent' || categoryLower === 'important' || isImportantSender) {
          return { should_notify: true, should_batch: false, reason: 'VIP mode: high priority' };
        }
        return { should_notify: false, should_batch: true, reason: 'VIP mode: not priority' };
      default:
        return {
          should_notify: true,
          should_batch: settings.batch_notifications_enabled,
          reason: 'Default'
        };
    }
  } catch (e) {
    console.error('[Smart Notifications] Check failed, allowing notification:', e);
    return { should_notify: true, should_batch: false, reason: 'Error - default allow' };
  }
}

// Batch notification queue
interface QueuedNotification {
  emailId: string;
  sender: string;
  subject: string;
  summary: string;
  timestamp: number;
}

const notificationQueue: QueuedNotification[] = [];
let batchTimeout: ReturnType<typeof setTimeout> | null = null;
let currentBatchIntervalMs = 15 * 60 * 1000; // Will be loaded from settings

// Load batch interval from settings and update it
async function updateBatchInterval() {
  try {
    const settings = await getSettings();
    currentBatchIntervalMs = (settings.batch_interval_minutes || 15) * 60 * 1000;
  } catch (e) {
    console.error('[emailStore] Failed to load batch interval from settings:', e);
    currentBatchIntervalMs = 15 * 60 * 1000; // fallback to 15 minutes
  }
}

function processBatchedNotifications() {
  if (notificationQueue.length === 0) return;

  const batch = notificationQueue.splice(0, notificationQueue.length);
  const count = batch.length;

  if (count === 1) {
    const notif = batch[0];
    sendNotification(`New email from ${notif.sender.split('<')[0].trim()}`, notif.summary);
  } else {
    // Send a batch notification
    sendNotification(
      `You have ${count} new emails`,
      batch.map(n => n.sender.split('<')[0].trim()).slice(0, 3).join(', ') +
      (count > 3 ? ` and ${count - 3} more` : '')
    );
  }
}

function queueNotification(emailId: string, sender: string, subject: string, summary: string) {
  notificationQueue.push({
    emailId,
    sender,
    subject,
    summary,
    timestamp: Date.now()
  });

  // Clear existing timeout and set a new one
  if (batchTimeout) clearTimeout(batchTimeout);

  batchTimeout = setTimeout(() => {
    processBatchedNotifications();
  }, currentBatchIntervalMs);
}

// Export for testing
export function getNotificationQueueSize() {
  return notificationQueue.length;
}

export interface Email {
  id: string;
  gmail_id: string;
  thread_id: string;
  subject: string;
  sender: string;
  recipients: string;
  date: string;
  body_text: string;
  body_html?: string;
  snippet: string;
  is_read: boolean;
  is_starred: boolean;
  has_attachments: boolean;
  attachments?: EmailAttachment[];
  status: 'Unhandled' | 'Saved' | 'Replied' | 'Archived' | 'Deleted';
  category: 'Urgent' | 'Important' | 'Normal' | 'Low';
  summary?: string;
  key_points?: string[];
  action_items?: string[];
  requires_reply: boolean;
  deadline?: string;  // Extracted deadline (e.g. "2026-02-20", "next Friday")
  sender_tone?: string;  // Detected tone of sender (e.g. "frustrated", "friendly")
  ai_generated_reply?: string;
  meeting_request?: {
    is_meeting: boolean;
    proposed_times?: string[];
    duration_minutes?: number;
    attendees?: string[];
    subject?: string;
  };
  // For sent emails: reference to the original email being replied to
  inReplyTo?: string;  // original email ID
  originalEmail?: Email;  // full original email data (populated when viewing sent emails)

  // Auto-reminder / Sequencing tracking
  waiting_on_reply_since?: string;  // ISO timestamp when we started waiting for reply
  reminder_due_date?: string;  // ISO timestamp for when reminder should trigger
  reminder_triggered?: boolean;  // Whether reminder has been shown
  reminder_count?: number;  // Number of reminders sent
  reminder_snoozed_until?: string;  // ISO timestamp if reminder was snoozed
  needs_follow_up?: boolean;  // Whether this email actually needs a follow-up (AI determined)
  attention_dismissed?: boolean;  // Whether the user dismissed the attention banner
  deleted_at?: string;  // ISO timestamp when email was moved to trash
}

export interface EmailAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  // Base64-encoded attachment data (stored for sent emails so we can analyze without re-downloading)
  base64Data?: string;
  // Store AI analysis results for this attachment
  aiSummary?: string;
  aiKeyPoints?: string[];
  aiActionItems?: string[];
}

export interface EmailState {
  emails: Email[];
  sentEmails: Email[];  // Track emails sent through Aiden
  selectedEmail: Email | null;
  isLoading: boolean;
  error: string | null;
  currentFilter: 'all' | 'inbox' | 'unhandled' | 'saved' | 'sent' | 'archived' | 'deleted' | 'urgent' | 'important' | 'normal' | 'low' | 'focus' | 'triage';
  searchQuery: string;
  notifiedEmailIds: Set<string>;  // Track which emails we've sent notifications for
  initialEmailIds: Set<string>;   // Track emails that existed at app startup
  hasInitialized: boolean;        // Whether emails are available (from cache or fetch)
  hasFetchedFromGmail: boolean;   // Whether we've done at least one Gmail API fetch
  generatingReplies: Set<string>; // Track which emails are currently having replies generated
  generatingSummaries: Set<string>; // Track which emails are currently having summaries generated
  /** Live AI-processing progress (summaries + classification) for a global indicator. */
  aiProcessing: { active: number; queued: number };
  sentReplyEmailIds: Set<string>; // Track which emails we've sent replies to
  appStartTime: number; // Track when the app started to know which emails are "new"

  // Bulk selection state
  selectedEmailIds: Set<string>;  // Track which emails are selected for bulk actions
  isSelectMode: boolean;          // Whether bulk select mode is active

  // Thread view state
  viewMode: 'individual' | 'threaded';  // How to display emails
  expandedThreads: Set<string>;         // Thread IDs that are expanded

  // Sort state
  sortMode: 'date' | 'importance';      // How to sort emails

  // Read filter state (UI-only, resets on reload)
  readFilter: 'unread' | 'all';

  // Auto-reminder state
  pendingReminders: Set<string>;        // Email IDs needing reminder check
  reminderCheckInterval: ReturnType<typeof setInterval> | null;  // Interval for reminder checks

  // Actions
  loadFromDisk: () => Promise<void>;
  fetchEmails: () => Promise<void>;
  selectEmail: (email: Email | null) => void;
  markAsRead: (emailId: string) => Promise<void>;
  markAsUnread: (emailId: string) => Promise<void>;
  markAsStarred: (emailId: string, starred: boolean) => Promise<void>;
  updateEmailStatus: (emailId: string, status: Email['status']) => Promise<void>;
  updateAttachmentAnalysis: (emailId: string, attachmentId: string, analysis: { summary: string; key_points: string[]; action_items: string[] }) => void;
  dismissAttention: (emailId: string) => void;
  classifyEmail: (emailId: string) => Promise<void>;
  generateReply: (emailId: string) => Promise<void>;
  summarizeEmail: (emailId: string) => Promise<string | null>;
  sendEmail: (to: string, subject: string, body: string, inReplyTo?: string, originalEmailData?: Email, attachments?: Array<{ path: string; base64: string; name: string }>) => Promise<void>;
  saveEmail: (emailId: string) => void;
  unsaveEmail: (emailId: string) => void;
  saveGeneratedReply: (emailId: string, reply: string) => void;
  sendEmailNotification: (emailId: string, summary: string, reply: string) => void;
  setSearchQuery: (query: string) => void;
  setCurrentFilter: (filter: EmailState['currentFilter']) => void;
  setSortMode: (sort: EmailState['sortMode']) => void;
  setReadFilter: (filter: EmailState['readFilter']) => void;
  refreshEmails: () => Promise<void>;
  getFilteredEmails: () => Email[];
  isGeneratingReply: (emailId: string) => boolean;
  isGeneratingSummary: (emailId: string) => boolean;
  triggerAIProcessing: (emailId: string) => void;
  hasSentReply: (emailId: string) => boolean;

  // Bulk action methods
  toggleEmailSelection: (emailId: string) => void;
  selectMultipleEmails: (emailIds: string[]) => void;
  deselectMultipleEmails: (emailIds: string[]) => void;
  clearSelection: () => void;
  selectAllVisible: () => void;
  bulkArchive: (emailIds?: string[]) => Promise<void>;
  bulkDelete: (emailIds?: string[]) => Promise<void>;
  bulkMarkAsRead: (emailIds?: string[]) => Promise<void>;
  bulkSave: (emailIds?: string[]) => void;
  isEmailSelected: (emailId: string) => boolean;
  getSelectedCount: () => number;
  purgeOldTrash: () => void;

  // Threading methods
  setEmails: (emails: Email[]) => void;
  setViewMode: (mode: 'individual' | 'threaded') => void;
  toggleThreadExpanded: (threadId: string) => void;
  expandAllThreads: () => void;
  collapseAllThreads: () => void;
  getThreadEmails: (threadId: string) => Email[];
  getThreadRepresentative: (threadId: string) => Email | null;
  groupEmailsByThread: (emails: Email[]) => Map<string, Email[]>;
  getFilteredThreads: () => Map<string, Email[]>;
  isInThread: (emailId: string) => boolean;
  getThreadPosition: (emailId: string) => { current: number; total: number } | null;

  // Auto-reminder methods
  scheduleReplyReminder: (sentEmailId: string, originalEmailId: string, delayDays?: number) => void;
  checkPendingReminders: () => void;
  getThreadsWaitingOnReply: () => Email[];
  cancelReminder: (emailId: string) => void;
  snoozeReminder: (emailId: string, days: number) => void;
  initializeReminderChecker: () => void;
  cleanupReminderChecker: () => void;
  loadMockWaitingEmails: () => void;
}

// Guard against overlapping fetchEmails calls
let isFetchingEmails = false;
// Throttled re-fetch of recent mail so read/starred state stays in sync with
// Gmail — the incremental sync only pulls NEW mail, so without this, emails read
// or starred directly in Gmail never update inside Aiden.
let lastReadStateRefresh = 0;
const READ_STATE_REFRESH_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Persisted last-sync anchor.
//
// The incremental Gmail query is anchored to the last time we successfully
// synced — persisted across sessions in localStorage (the Tauri webview keeps
// it between launches). This way nothing slips through the gap between the
// time the app is closed and the next launch. The very first sync (no anchor
// yet) instead pulls a 14-day history window so connecting an account lands
// you on a meaningful inbox rather than a cold start.
// ---------------------------------------------------------------------------
const LAST_SYNC_KEY = 'aiden_last_sync_time';
/** Number of days of history to backfill on the very first sync. */
const INITIAL_BACKFILL_DAYS = 14;
/** Cap for the one-time initial backfill (bounds first-load time). */
const INITIAL_BACKFILL_MAX = 200;

function getLastSyncTime(): number | null {
  try {
    const v = localStorage.getItem(LAST_SYNC_KEY);
    const n = v ? parseInt(v, 10) : NaN;
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function setLastSyncTime(ts: number): void {
  try {
    localStorage.setItem(LAST_SYNC_KEY, String(ts));
  } catch {
    /* localStorage unavailable — incremental sync falls back to a 14d window */
  }
}

// Track which emails are being processed (for both summary and reply)
let processingEmails = new Set<string>();
// Process a few emails concurrently. Capped low so a first-run backfill of ~200
// emails moves quickly without hammering the AI backend — it previously ran
// strictly one-at-a-time, which made the initial sync feel stuck for minutes.
const MAX_CONCURRENT_AI_OPERATIONS = 3;
let activeAIOperations = 0;
let aiOperationQueue: Array<() => void> = [];

// Publish queue depth so the shell can show a calm "Analyzing N messages…" hint.
function updateAiProgress() {
  useEmailStore.setState({
    aiProcessing: { active: activeAIOperations, queued: aiOperationQueue.length },
  });
}

// Cap the queue so a slow/unavailable AI backend can't accumulate unbounded
// work (each entry holds email data in its closure). Only hit during a large
// first-run backfill; steady-state never fills it.
const MAX_AI_QUEUE = 60;
// Queue an AI operation to limit concurrency
function queueAIOperation(operation: () => Promise<void>) {
  if (aiOperationQueue.length >= MAX_AI_QUEUE) return;
  aiOperationQueue.push(operation);
  updateAiProgress();
  processAIQueueHelper();
}

// Process the AI operation queue, filling every open concurrency slot.
function processAIQueueHelper() {
  while (activeAIOperations < MAX_CONCURRENT_AI_OPERATIONS && aiOperationQueue.length > 0) {
    const operation = aiOperationQueue.shift();
    if (!operation) break;
    activeAIOperations++;
    updateAiProgress();
    // Don't await — let it run in the background; refill slots as each finishes.
    Promise.resolve(operation()).finally(() => {
      activeAIOperations--;
      updateAiProgress();
      processAIQueueHelper();
    });
  }
}

// Generate summary for a single email via Tauri/Claude (bypasses Python server)
const MAX_SUMMARY_RETRIES = 2;

/*
 * Lightweight, self-contained email AI processing.
 *
 * The original heavy pipeline (summary + questions + reply + priority +
 * notifications) was disabled during store-init debugging. These restored
 * versions are intentionally minimal and defensive: they NEVER throw, they
 * skip work that's already done, and they run through the throttled
 * `queueAIOperation` so they can't hammer the backend. If the backend is
 * unreachable (e.g. demo mode) they fail silently — the UI keeps working on
 * whatever data is already present.
 */
function generateSummaryForEmail(emailId: string): void {
  const key = `${emailId}-summary`;
  if (processingEmails.has(key)) return;
  const email = useEmailStore.getState().emails.find((e) => e.id === emailId);
  if (!email || email.summary) return; // nothing to do — already summarized
  processingEmails.add(key);

  // Track that we're generating a summary for this email
  useEmailStore.setState((state) => ({
    generatingSummaries: new Set(state.generatingSummaries).add(emailId),
  }));

  queueAIOperation(async () => {
    try {
      console.log(`[AI Processing] Starting summary for email: ${emailId}`);
      const content = `From: ${email.sender}\nSubject: ${email.subject}\n\n${email.body_text || email.snippet || ''}`;
      console.log(`[AI Processing] Email content length: ${content.length} chars`);
      const result = await summarizeEmailClaude(content);
      console.log(`[AI Processing] Result received:`, result ? 'SUCCESS' : 'NULL');
      if (result?.summary) {
        console.log(`[AI Processing] Summary generated: ${result.summary.substring(0, 100)}...`);
        useEmailStore.setState((state) => ({
          emails: state.emails.map((e) =>
            e.id === emailId ? { ...e, summary: result.summary, key_points: result.key_points || [] } : e,
          ),
        }));
        persistEmailsToDisk();
        console.log(`[AI Processing] ✅ Summary saved and persisted`);
      } else {
        console.warn(`[AI Processing] No summary generated from API response`);
      }
    } catch (e) {
      console.error('[AI Processing] ❌ Summary generation failed:', e);
    } finally {
      processingEmails.delete(key);
      // Remove from generating set when done
      useEmailStore.setState((state) => {
        const newSet = new Set(state.generatingSummaries);
        newSet.delete(emailId);
        return { generatingSummaries: newSet };
      });
    }
  });
}

function processEmailImmediately(emailId: string): void {
  generateSummaryForEmail(emailId);
}

function processMultipleEmails(emailIds: string[]): void {
  for (const id of emailIds) generateSummaryForEmail(id);
}

// Question backfill belonged to the removed pipeline; question data is now
// supplied via window.emailQuestionData / on-demand in the email view.
function backfillQuestionData(_emailIds: string[]): void {
  /* no-op: retained as a safe stub for existing call sites */
}

// Classify an email's priority via the real AI classifier (GenAI gateway → Tauri
// fallback), persisting category + requires_reply. Fails silently if the backend is
// unreachable (e.g. demo mode), leaving the email at its current category.
async function classifyEmailPriority(emailId: string): Promise<void> {
  const key = `${emailId}-classify`;
  if (processingEmails.has(key)) return;
  const email = useEmailStore.getState().emails.find((e) => e.id === emailId);
  if (!email) return;
  processingEmails.add(key);
  try {
    const res = await classifyEmailApi({
      sender: email.sender,
      subject: email.subject,
      content: email.body_text || email.snippet || '',
    });
    const CATEGORY_MAP: Record<string, Email['category']> = {
      urgent: 'Urgent', important: 'Important', normal: 'Normal', low: 'Low',
      // Richer server-side taxonomy collapses to the 4 client buckets: all bulk/
      // automated classes are low-priority (and feed aidenBrain's "Low" newsletter filter).
      newsletter: 'Low', promotional: 'Low', transactional: 'Low', social: 'Low',
    };
    const category = CATEGORY_MAP[(res.category || '').toLowerCase()] ?? 'Normal';
    const requires_reply =
      typeof res.requires_reply === 'boolean' ? res.requires_reply : email.requires_reply;
    useEmailStore.setState((state) => ({
      emails: state.emails.map((e) =>
        e.id === emailId ? { ...e, category, requires_reply } : e,
      ),
      selectedEmail: state.selectedEmail?.id === emailId
        ? { ...state.selectedEmail, category, requires_reply }
        : state.selectedEmail,
    }));
    persistEmailsToDisk();
    // A successful classification is the clearest signal the AI pipeline is up.
    import('@/stores/systemStatusStore').then(({ systemStatus }) => systemStatus.ok('ai'));
  } catch (e) {
    // Primary path (gateway -> Tauri) failed. Fall back to the oauth_server /chat
    // path, which has a working key even when the gateway isn't running.
    let recovered = false;
    try {
      const fb = await classifyEmailViaChat(email);
      if (fb) {
        const CATEGORY_MAP: Record<string, Email['category']> = {
          urgent: 'Urgent', important: 'Important', normal: 'Normal', low: 'Low',
          newsletter: 'Low', promotional: 'Low', transactional: 'Low', social: 'Low',
        };
        const category = CATEGORY_MAP[(fb.category || '').toLowerCase()] ?? 'Normal';
        useEmailStore.setState((state) => ({
          emails: state.emails.map((em) =>
            em.id === emailId ? { ...em, category, requires_reply: fb.requires_reply } : em,
          ),
          selectedEmail: state.selectedEmail?.id === emailId
            ? { ...state.selectedEmail, category, requires_reply: fb.requires_reply }
            : state.selectedEmail,
        }));
        persistEmailsToDisk();
        import('@/stores/systemStatusStore').then(({ systemStatus }) => systemStatus.ok('ai'));
        recovered = true;
      }
    } catch {
      /* double failure — fall through to the banner */
    }
    if (!recovered) {
      console.warn(`[AI Processing] Classification failed for ${emailId}:`, e);
      import('@/stores/systemStatusStore').then(({ systemStatus }) =>
        systemStatus.fail('ai', 'AI processing unavailable — organizing without summaries'),
      );
    }
  } finally {
    processingEmails.delete(key);
  }
}

// Drop per-email AI analysis for emails no longer in the store, so the global
// window.emailQuestionData Map can't grow unboundedly over time.
function evictStaleQuestionData() {
  if (typeof window === 'undefined') return;
  const qd = (window as any).emailQuestionData as Map<string, unknown> | undefined;
  if (!qd || qd.size === 0) return;
  const st = getStoreState();
  const ids = new Set<string>([...st.emails, ...st.sentEmails].map((e) => e.id));
  for (const id of [...qd.keys()]) {
    if (!ids.has(id)) qd.delete(id);
  }
}

// --- Memory bounding -------------------------------------------------------
// The heaviest per-email fields are body_html and attachment base64Data, and
// both are only needed to render a rich view of an email you're actively
// looking at. Old, already-read mail is reduced to its lightweight form
// (body_text + metadata), which is all AI context, search, and the text-fallback
// render need. Combined with hard caps, this keeps long-running memory bounded.
const SLIM_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_INBOX_EMAILS = 8000;
const MAX_SENT_EMAILS = 3000;

function slimEmail(e: Email): Email {
  const attHasData = !!e.attachments?.some((a) => a.base64Data);
  if (!e.body_html && !attHasData) return e;
  return {
    ...e,
    body_html: undefined,
    attachments: attHasData
      ? e.attachments!.map((a) => ({ ...a, base64Data: undefined }))
      : e.attachments,
  };
}

function pruneEmailStore() {
  const now = Date.now();
  const { emails, sentEmails, selectedEmail } = getStoreState();
  const selId = selectedEmail?.id;
  const isStale = (e: Email): boolean =>
    e.id !== selId &&
    !!e.is_read &&
    !e.is_starred &&
    e.status !== 'Saved' &&
    now - new Date(e.date).getTime() > SLIM_AGE_MS;

  let changed = false;
  const slimAll = (arr: Email[]): Email[] =>
    arr.map((e) => {
      if (!isStale(e)) return e;
      const s = slimEmail(e);
      if (s !== e) changed = true;
      return s;
    });
  let nextEmails = slimAll(emails);
  let nextSent = slimAll(sentEmails);

  // Hard cap (backstop): beyond the cap, drop the oldest read mail first —
  // never unread, starred, or Saved items.
  const cap = (arr: Email[], max: number): Email[] => {
    if (arr.length <= max) return arr;
    const sorted = [...arr].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
    const kept = sorted.filter(
      (e, i) => i < max || !e.is_read || e.is_starred || e.status === 'Saved',
    );
    if (kept.length < arr.length) changed = true;
    return kept;
  };
  nextEmails = cap(nextEmails, MAX_INBOX_EMAILS);
  nextSent = cap(nextSent, MAX_SENT_EMAILS);

  if (changed) useEmailStore.setState({ emails: nextEmails, sentEmails: nextSent });
}

// Persist emails to disk (fire-and-forget, non-blocking)
async function persistEmailsToDisk() {
  try {
    // Don't persist empty state — would overwrite good cached data
    const pre = getStoreState();
    if (pre.emails.length === 0 && pre.sentEmails.length === 0) return;

    // Bound memory + disk: slim old/read emails, cap arrays, drop orphan AI analysis.
    pruneEmailStore();
    evictStaleQuestionData();

    const state = getStoreState();
    const { invoke } = await import('@tauri-apps/api/core');
    const promises: Promise<void>[] = [];
    if (state.emails.length > 0) {
      promises.push(invoke('persist_emails', { emails: state.emails }));
    }
    // Only persist sent emails if we have some — never overwrite disk with empty
    if (state.sentEmails.length > 0) {
      promises.push(invoke('persist_sent_emails', { emails: state.sentEmails }));
    }
    await Promise.all(promises);
    console.log(`[EmailStore] Persisted ${state.emails.length} emails and ${state.sentEmails.length} sent emails to disk`);
  } catch (e) {
    console.error('[EmailStore] Failed to persist emails:', e);
  }
}

// Commitment tracking: re-scan the inbox + sent mail whenever messages change so
// promises ("I'll send X tomorrow") and requests become tracked commitments
// automatically — on every email received or sent. Debounced to coalesce bursts.
let commitmentRescanTimer: ReturnType<typeof setTimeout> | undefined;
function rescanCommitments() {
  clearTimeout(commitmentRescanTimer);
  commitmentRescanTimer = setTimeout(() => {
    import('./commitmentStore')
      .then(({ useCommitmentStore }) => useCommitmentStore.getState().extract())
      .catch(() => {});
  }, 400);
}

// First, create the store with minimal state
export const useEmailStore = create<EmailState>((set, get) => ({
  emails: [],
  sentEmails: [],
  selectedEmail: null,
  isLoading: false,
  error: null,
  currentFilter: 'inbox',
  searchQuery: '',
  notifiedEmailIds: new Set<string>(),
  initialEmailIds: new Set<string>(),
  hasInitialized: false,
  hasFetchedFromGmail: false,
  generatingReplies: new Set<string>(),
  generatingSummaries: new Set<string>(),
  aiProcessing: { active: 0, queued: 0 },
  sentReplyEmailIds: new Set<string>(),
  appStartTime: Date.now(), // Track when the app started to know which emails are "new"

  // Bulk selection state
  selectedEmailIds: new Set<string>(),
  isSelectMode: false,

  // Thread view state
  viewMode: 'individual',
  expandedThreads: new Set<string>(),

  // Sort state
  sortMode: 'date',

  // Read filter state
  readFilter: 'unread',

  // Auto-reminder state
  pendingReminders: new Set<string>(),
  reminderCheckInterval: null,

  loadFromDisk: async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const [persisted, persistedSent] = await Promise.all([
        invoke<any[]>('load_persisted_emails'),
        invoke<any[]>('load_persisted_sent_emails'),
      ]);

      const state = get();

      // Always restore sent emails from disk if we don't have any in memory
      // (fetchEmails only populates inbox emails, never sent)
      if (state.sentEmails.length === 0 && persistedSent.length > 0) {
        set({ sentEmails: persistedSent as Email[] });
        console.log(`[EmailStore] Restored ${persistedSent.length} sent emails from disk`);
      }

      // Only load inbox emails from disk if we haven't fetched from Gmail yet
      if (!state.hasInitialized && (persisted.length > 0 || persistedSent.length > 0)) {
        set({
          emails: persisted as Email[],
          sentEmails: persistedSent as Email[],
          hasInitialized: true,
          isLoading: false,
        });
        console.log(`[EmailStore] Loaded ${persisted.length} emails and ${persistedSent.length} sent emails from disk`);
      }
    } catch (e) {
      console.error('[EmailStore] Failed to load persisted emails:', e);
    }
  },

  fetchEmails: async () => {
    // Prevent overlapping fetch calls (polling + focus events can overlap)
    if (isFetchingEmails) {
      console.log('[fetchEmails] Skipping - already in flight');
      return;
    }
    isFetchingEmails = true;
    try {
      const state = get();
      const isFirstGmailFetch = !state.hasFetchedFromGmail;
      // Anchor for incremental sync (persisted across sessions). Captured at the
      // START of the fetch so any mail that arrives mid-fetch is caught next time
      // (a 1s overlap is fine — dedup by id handles it). Null = never synced yet.
      const lastSync = getLastSyncTime();
      const fetchStartedAt = Date.now();
      // Set isLoading only when we have no emails at all (shows loading screen)
      const showLoading = !state.hasInitialized;
      set({ error: null, ...(showLoading ? { isLoading: true } : {}) });

      // Get access token from auth store or localStorage
      const authStore = useAuthStore.getState();
      const accessToken = authStore.token?.access_token || localStorage.getItem('aiden_access_token');

      if (!accessToken || accessToken === 'mock_access_token_dev') {
        // Don't try to fetch emails with mock token
        set({
          emails: [],
          isLoading: false,
          error: accessToken === 'mock_access_token_dev'
            ? 'Cannot fetch emails with mock credentials. Please sign in with a real Google account.'
            : 'Not authenticated. Please sign in again.'
        });
        return;
      }

      // Use Python OAuth server to fetch emails
      try {
        const baseURL = await serverURL();
        // First sync ever (no persisted anchor): pull a 14-day history window.
        // Every later sync: only mail newer than our last successful sync.
        const query = lastSync
          ? `in:inbox after:${Math.floor(lastSync / 1000)}`
          : `in:inbox newer_than:${INITIAL_BACKFILL_DAYS}d`;
        const maxResults = lastSync ? 50 : INITIAL_BACKFILL_MAX;
        // Send known email IDs so server can skip re-fetching them
        const knownIds = get().emails.map(e => e.id).join(',');
        const knownParam = knownIds ? `&knownIds=${encodeURIComponent(knownIds)}` : '';
        const response = await fetch(`${baseURL}/emails?q=${encodeURIComponent(query)}&maxResults=${maxResults}${knownParam}`, {
          method: 'GET',
          mode: 'cors',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json',
          }
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        if (!data.success) {
          throw new Error(data.error || 'Failed to fetch emails');
        }

        // Convert Python server emails to app format
        const newEmails = data.emails.map((email: any) => ({
          id: email.id,
          gmail_id: email.id,
          thread_id: email.threadId || email.id,
          subject: email.subject || '(No Subject)',
          sender: email.from || 'Unknown Sender',
          recipients: email.to || '',
          date: email.date || new Date().toISOString(),
          body_text: email.bodyText || email.body_text || email.snippet || email.content || '',
          body_html: email.bodyHtml || email.body_html || undefined,
          snippet: email.snippet || email.content?.substring(0, 100) || '',
          is_read: email.isRead !== false,
          is_starred: email.labels?.includes('STARRED') || false,
          has_attachments: email.hasAttachments || email.labels?.includes('ATTACHMENT') || false,
          attachments: email.attachments || [],
          status: 'Unhandled' as const,
          category: 'Normal' as const,
          // Default unread → needs reply, but never auto-flag automated/transactional
          // senders (receipts, tickets, no-reply). The AI classifier refines this.
          requires_reply: !email.isRead && !email.from?.toLowerCase().includes('me') && !isAutomatedSender(email.from || email.sender || ''),
          summary: email.summary || undefined,
        }));

        // Merge with existing emails: preserve cached/existing data, add new ones
        const existingEmails = get().emails;
        const existingById = new Map(existingEmails.map(e => [e.id, e]));

        // Update or add fetched emails
        for (const newEmail of newEmails) {
          const existing = existingById.get(newEmail.id);
          if (existing) {
            // Preserve AI-generated and user-action fields from existing email
            existingById.set(newEmail.id, {
              ...newEmail,
              status: existing.status,
              category: existing.category !== 'Normal' ? existing.category : newEmail.category,
              summary: existing.summary || newEmail.summary,
              key_points: existing.key_points || newEmail.key_points,
              action_items: existing.action_items || newEmail.action_items,
              ai_generated_reply: existing.ai_generated_reply,
              requires_reply: existing.requires_reply,
              deadline: existing.deadline || newEmail.deadline,
              sender_tone: existing.sender_tone || newEmail.sender_tone,
              attention_dismissed: existing.attention_dismissed,
              meeting_request: existing.meeting_request,
              waiting_on_reply_since: existing.waiting_on_reply_since,
              reminder_due_date: existing.reminder_due_date,
              reminder_triggered: existing.reminder_triggered,
              reminder_count: existing.reminder_count,
              reminder_snoozed_until: existing.reminder_snoozed_until,
              needs_follow_up: existing.needs_follow_up,
              inReplyTo: existing.inReplyTo,
              // originalEmail: existing.originalEmail,  // TEMPORARILY REMOVED
            });
          } else {
            existingById.set(newEmail.id, newEmail);
          }
        }

        const emails = [...existingById.values()];
        set({ emails, isLoading: false });
        rescanCommitments();

        // Persist to disk in background
        persistEmailsToDisk();

        // Mark as initialized and fetched; advance the persisted sync anchor.
        set({ hasInitialized: true, hasFetchedFromGmail: true });
        setLastSyncTime(fetchStartedAt);

        // Best-effort read/starred refresh: re-fetch a recent window WITHOUT the
        // knownIds skip so emails read or starred directly in Gmail sync into Aiden.
        // (The incremental query + knownIds above never re-fetches known mail.)
        if (!isFirstGmailFetch && Date.now() - lastReadStateRefresh > READ_STATE_REFRESH_MS) {
          lastReadStateRefresh = Date.now();
          try {
            const rResp = await fetch(
              `${baseURL}/emails?q=${encodeURIComponent('in:inbox newer_than:7d')}&maxResults=120`,
              { headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' } },
            );
            if (rResp.ok) {
              const rData = await rResp.json();
              const byId = new Map<string, { is_read: boolean; is_starred: boolean }>();
              for (const e of rData.emails || []) {
                byId.set(e.id, {
                  is_read: e.isRead !== false,
                  is_starred: e.labels?.includes('STARRED') || false,
                });
              }
              if (byId.size) {
                set((state) => ({
                  emails: state.emails.map((e) => {
                    const r = byId.get(e.id);
                    return r ? { ...e, is_read: r.is_read, is_starred: r.is_starred } : e;
                  }),
                }));
              }
            }
          } catch {
            /* non-fatal — read-state sync is best-effort */
          }
        }

        // Python server delivered — the backbone is healthy (clears any stale "down").
        import('@/stores/systemStatusStore').then(({ systemStatus }) => systemStatus.ok('server'));

        // Classify any emails that haven't been classified yet (separate from summary pipeline)
        const unclassifiedEmails = emails.filter(e => e.category === 'Normal');
        if (unclassifiedEmails.length > 0) {
          console.log(`[AI Processing] Classifying ${unclassifiedEmails.length} unclassified emails`);
          // Run classification in background, staggered to not overload API
          const classifyBatch = async (batch: Email[]) => {
            for (const email of batch) {
              await classifyEmailPriority(email.id);
            }
          };
          setTimeout(() => classifyBatch(unclassifiedEmails.slice(0, 5)), 3000);
          if (unclassifiedEmails.length > 5) {
            setTimeout(() => classifyBatch(unclassifiedEmails.slice(5, 10)), 20000);
          }
          if (unclassifiedEmails.length > 10) {
            setTimeout(() => classifyBatch(unclassifiedEmails.slice(10)), 40000);
          }
        }

        // Handle initial vs subsequent fetches for AI processing
        if (isFirstGmailFetch) {
          // First Gmail fetch - track existing emails and process ALL unread emails without summaries
          const initialIds = new Set(emails.map((e: Email) => e.id));
          set({ initialEmailIds: initialIds });
          console.log(`[AI Processing] Initial fetch, found ${emails.length} emails`);

          // Queue all emails that need summaries - the AI queue processes one at a time
          const emailsNeedingProcessing = emails.filter(e => !e.summary);
          console.log(`[AI Processing] Emails needing processing: ${emailsNeedingProcessing.length} of ${emails.length} total`);
          if (emailsNeedingProcessing.length > 0) {
            // Process first 3 quickly, then stagger the rest to keep UI responsive
            const firstBatch = emailsNeedingProcessing.slice(0, 3);
            const remaining = emailsNeedingProcessing.slice(3);
            setTimeout(() => {
              processMultipleEmails(firstBatch.map(e => e.id));
            }, 2000);
            if (remaining.length > 0) {
              // Queue the rest after a longer delay to let first batch finish
              setTimeout(() => {
                processMultipleEmails(remaining.map(e => e.id));
              }, 15000);
            }
          }

          // Backfill: re-run question analysis for emails that were never analyzed (deadline === undefined)
          // or Urgent/Important emails where old prompt missed the deadline (deadline === undefined, not null)
          const emailsNeedingBackfill = emails.filter(e => e.summary && (
            (e.deadline === undefined && e.sender_tone === undefined) ||
            (e.deadline === undefined && (e.category === 'Urgent' || e.category === 'Important'))
          ));
          if (emailsNeedingBackfill.length > 0) {
            console.log(`[AI Processing] Backfilling ${emailsNeedingBackfill.length} emails missing question data`);
            const delay = emailsNeedingProcessing.length > 0 ? 30000 : 5000;
            setTimeout(() => {
              backfillQuestionData(emailsNeedingBackfill.map(e => e.id));
            }, delay);
          }

          // Fast backfill: bridge existing email deadlines to life store without re-running AI
          // Also do full re-analysis for emails that have no life data at all
          const alreadyQueuedIds = new Set([
            ...emailsNeedingProcessing.map(e => e.id),
            ...emailsNeedingBackfill.map(e => e.id),
          ]);
          import('@/stores/lifeStore').then(async ({ useLifeStore }) => {
            // Ensure lifeStore is loaded from disk before backfilling
            await useLifeStore.getState().loadFromDisk();
            const lifeState = useLifeStore.getState();

            // Fast path: emails with deadlines already extracted — create life items directly
            const emailsWithDeadlines = emails.filter(
              (e) => e.deadline && !lifeState.processedEmailIds.has(e.id)
            );
            if (emailsWithDeadlines.length > 0) {
              console.log(`[Life Intel] Fast backfilling ${emailsWithDeadlines.length} emails with existing deadlines`);
              for (const email of emailsWithDeadlines) {
                useLifeStore.getState().addItemsFromEmail(email.id, [{
                  data_type: 'deadline',
                  title: email.subject,
                  date: email.deadline!,
                  details: null,
                }]);
              }
            }

            // Slow path: full re-analysis for remaining emails without life data
            const emailsNeedingLifeBackfill = emails.filter(
              e => e.summary && !lifeState.processedEmailIds.has(e.id)
                && !alreadyQueuedIds.has(e.id)
                && !emailsWithDeadlines.some(d => d.id === e.id)
            );
            if (emailsNeedingLifeBackfill.length > 0) {
              console.log(`[AI Processing] Backfilling life data for ${emailsNeedingLifeBackfill.length} emails`);
              const lifeDelay = emailsNeedingProcessing.length > 0 || emailsNeedingBackfill.length > 0 ? 45000 : 5000;
              setTimeout(() => {
                backfillQuestionData(emailsNeedingLifeBackfill.map(e => e.id));
              }, lifeDelay);
            }
          }).catch(() => {});
        } else {
          // Subsequent fetches - process truly NEW emails
          const state = get();
          const currentIds = new Set(emails.map((e: Email) => e.id));
          const newEmailIds = [...currentIds].filter(id => !state.initialEmailIds.has(id));

          console.log(`[AI Processing] Polling - new emails: ${newEmailIds.length}`);

          // Also add these new emails to initialEmailIds so we don't process them again
          const updatedInitialIds = new Set([...state.initialEmailIds, ...newEmailIds]);
          set({ initialEmailIds: updatedInitialIds });

          // Process new emails — stagger to keep UI responsive
          const emailsNeedingProcessing = emails
            .filter(e => newEmailIds.includes(e.id) && !e.summary);
          console.log(`[AI Processing] New emails to process: ${emailsNeedingProcessing.length}`);
          if (emailsNeedingProcessing.length > 0) {
            const firstBatch = emailsNeedingProcessing.slice(0, 3);
            const remaining = emailsNeedingProcessing.slice(3);
            setTimeout(() => {
              processMultipleEmails(firstBatch.map(e => e.id));
            }, 1000);
            if (remaining.length > 0) {
              setTimeout(() => {
                processMultipleEmails(remaining.map(e => e.id));
              }, 15000);
            }
          }
        }
      } catch (pythonError) {
        console.error('Python OAuth server error:', pythonError);
        // Reset cached server URL so next fetch re-discovers
        import('@/api/emails').then(({ resetServerURL }) => resetServerURL());

        // Fall back to frontend Gmail API
        if (!window.gapi) {
          throw new Error('Neither Python OAuth server nor Gmail API is available. Please ensure the OAuth server is running.');
        }

        console.warn('Falling back to frontend Gmail API...');
        // Mail still flows via the Gmail API, but calendar/Slack/AI proxying
        // ride on the Python server — say so instead of failing silently.
        import('@/stores/systemStatusStore').then(({ systemStatus }) =>
          systemStatus.fail('server', 'Email server unreachable — using direct Gmail fallback'),
        );

        // Fetch emails directly from Gmail API (same 14d-first / incremental logic)
        const fallbackQuery = lastSync
          ? `in:inbox after:${Math.floor(lastSync / 1000)}`
          : `in:inbox newer_than:${INITIAL_BACKFILL_DAYS}d`;
        const fallbackMax = lastSync ? 50 : INITIAL_BACKFILL_MAX;
        const emailResponse = await fetchGmailEmails(accessToken, fallbackMax, fallbackQuery);

        if (!emailResponse.success) {
          throw new Error(emailResponse.error || 'Failed to fetch emails');
        }

        // Convert Gmail emails to app format and merge with existing. Typed as
        // Email[] so the merge below can reference optional AI fields.
        const newEmails: Email[] = emailResponse.emails.map(convertGmailEmailToApp);
        const existingEmails = get().emails;
        const existingById = new Map(existingEmails.map(e => [e.id, e]));

        for (const newEmail of newEmails) {
          const existing = existingById.get(newEmail.id);
          if (existing) {
            existingById.set(newEmail.id, {
              ...newEmail,
              status: existing.status,
              category: existing.category !== 'Normal' ? existing.category : newEmail.category,
              summary: existing.summary || newEmail.summary,
              key_points: existing.key_points || newEmail.key_points,
              action_items: existing.action_items || newEmail.action_items,
              ai_generated_reply: existing.ai_generated_reply,
              requires_reply: existing.requires_reply,
              deadline: existing.deadline || newEmail.deadline,
              sender_tone: existing.sender_tone || newEmail.sender_tone,
              attention_dismissed: existing.attention_dismissed,
            });
          } else {
            existingById.set(newEmail.id, newEmail);
          }
        }

        const emails = [...existingById.values()];
        set({ emails, isLoading: false });
        rescanCommitments();

        // Persist to disk in background
        persistEmailsToDisk();

        // Mark as initialized and fetched; advance the persisted sync anchor.
        set({ hasInitialized: true, hasFetchedFromGmail: true });
        setLastSyncTime(fetchStartedAt);

        // Classify unclassified emails in background
        const unclassifiedEmails = emails.filter(e => e.category === 'Normal');
        if (unclassifiedEmails.length > 0) {
          console.log(`[AI Processing] Gmail API - Classifying ${unclassifiedEmails.length} unclassified emails`);
          const classifyBatch = async (batch: Email[]) => {
            for (const email of batch) {
              await classifyEmailPriority(email.id);
            }
          };
          setTimeout(() => classifyBatch(unclassifiedEmails.slice(0, 5)), 3000);
          if (unclassifiedEmails.length > 5) {
            setTimeout(() => classifyBatch(unclassifiedEmails.slice(5, 10)), 20000);
          }
          if (unclassifiedEmails.length > 10) {
            setTimeout(() => classifyBatch(unclassifiedEmails.slice(10)), 40000);
          }
        }

        // Handle initial vs subsequent fetches (same logic as Python path)
        if (isFirstGmailFetch) {
          const initialIds = new Set(emails.map((e: Email) => e.id));
          set({ initialEmailIds: initialIds });

          // Queue all emails that need summaries
          const emailsNeedingProcessing = emails.filter(e => !e.summary);
          console.log(`[AI Processing] Gmail API - Emails needing processing: ${emailsNeedingProcessing.length} of ${emails.length} total`);
          if (emailsNeedingProcessing.length > 0) {
            const firstBatch = emailsNeedingProcessing.slice(0, 3);
            const remaining = emailsNeedingProcessing.slice(3);
            setTimeout(() => {
              processMultipleEmails(firstBatch.map(e => e.id));
            }, 2000);
            if (remaining.length > 0) {
              setTimeout(() => {
                processMultipleEmails(remaining.map(e => e.id));
              }, 15000);
            }
          }
        } else {
          const state = get();
          const currentIds = new Set(emails.map((e: Email) => e.id));
          const newEmailIds = [...currentIds].filter(id => !state.initialEmailIds.has(id));
          const updatedInitialIds = new Set([...state.initialEmailIds, ...newEmailIds]);
          set({ initialEmailIds: updatedInitialIds });

          // Process new emails — stagger to keep UI responsive
          const emailsNeedingProcessing = emails
            .filter(e => newEmailIds.includes(e.id) && !e.summary);
          console.log(`[AI Processing] Gmail API - New emails to process: ${emailsNeedingProcessing.length}`);
          if (emailsNeedingProcessing.length > 0) {
            const firstBatch = emailsNeedingProcessing.slice(0, 3);
            const remaining = emailsNeedingProcessing.slice(3);
            setTimeout(() => {
              processMultipleEmails(firstBatch.map(e => e.id));
            }, 1000);
            if (remaining.length > 0) {
              setTimeout(() => {
                processMultipleEmails(remaining.map(e => e.id));
              }, 15000);
            }
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch emails:', error);
      // Surface it — the UI keeps running on cached mail, but the user should
      // know they're looking at cache, not live data.
      import('@/stores/systemStatusStore').then(({ systemStatus }) =>
        systemStatus.fail('server', 'Email server unreachable — showing cached mail'),
      );
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch emails',
        isLoading: false
      });
    } finally {
      isFetchingEmails = false;
    }
  },

  selectEmail: (email) => {
    set({ selectedEmail: email });
    // Note: opening an email no longer auto-marks it read — it stays in the inbox.
    // (Use the right-click menu to mark read/unread explicitly.)
    // Trigger AI processing when user selects an email
    if (email && email.id) {
      const fullEmail = get().emails.find(e => e.id === email.id);
      if (fullEmail && (!fullEmail.summary || !fullEmail.ai_generated_reply)) {
        processEmailImmediately(email.id);
      }
    }
  },

  markAsRead: async (emailId) => {
    try {
      const state = get();
      const email = state.emails.find(e => e.id === emailId);

      if (!email) {
        console.warn('Email not found:', emailId);
        return;
      }

      // Mark as read in Gmail via Python OAuth server (handles token refresh)
      try {
        const baseURL = await serverURL();
        await fetch(`${baseURL}/mark-read`, {
          method: 'POST',
          mode: 'cors',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageId: email.gmail_id }),
        });
      } catch (error) {
        console.error('Failed to mark as read via Gmail API:', error);
      }

      // Update local state
      set((state) => ({
        emails: state.emails.map(email =>
          email.id === emailId ? { ...email, is_read: true } : email
        ),
        selectedEmail: state.selectedEmail?.id === emailId
          ? { ...state.selectedEmail, is_read: true }
          : state.selectedEmail,
      }));
      persistEmailsToDisk();
    } catch (error) {
      console.error('Failed to mark email as read:', error);
    }
  },

  markAsUnread: async (emailId) => {
    try {
      const state = get();
      const email = state.emails.find(e => e.id === emailId);

      if (!email) {
        console.warn('Email not found:', emailId);
        return;
      }

      // Mark as unread in Gmail via Python OAuth server
      try {
        const baseURL = await serverURL();
        await fetch(`${baseURL}/mark-unread`, {
          method: 'POST',
          mode: 'cors',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageId: email.gmail_id }),
        });
      } catch (error) {
        console.error('Failed to mark as unread via Gmail API:', error);
      }

      // Update local state
      set((state) => ({
        emails: state.emails.map(email =>
          email.id === emailId ? { ...email, is_read: false } : email
        ),
        selectedEmail: state.selectedEmail?.id === emailId
          ? { ...state.selectedEmail, is_read: false }
          : state.selectedEmail,
      }));
      persistEmailsToDisk();
    } catch (error) {
      console.error('Failed to mark email as unread:', error);
    }
  },

  markAsStarred: async (emailId, starred) => {
    try {
      // Update local state
      set((state) => ({
        emails: state.emails.map(email =>
          email.id === emailId ? { ...email, is_starred: starred } : email
        ),
        selectedEmail: state.selectedEmail?.id === emailId
          ? { ...state.selectedEmail, is_starred: starred }
          : state.selectedEmail,
      }));
      persistEmailsToDisk();
    } catch (error) {
      console.error('Failed to mark email as starred:', error);
    }
  },

  updateEmailStatus: async (emailId, status) => {
    try {
      // For now, just update local state
      // TODO: Implement backend update via OAuth server if needed
      console.log(`Updating email ${emailId} status to ${status}`);

      // Learn from "archive" as a deprioritization signal for this sender.
      if (status === 'Archived') {
        const sender = get().emails.find(e => e.id === emailId)?.sender
          || get().sentEmails.find(e => e.id === emailId)?.sender;
        useFeedbackStore.getState().record(sender, 'archive');
      }

      // Update local state - both emails and sentEmails
      const deleted_at = status === 'Deleted' ? new Date().toISOString() : undefined;
      set((state) => ({
        emails: state.emails.map(email =>
          email.id === emailId ? { ...email, status, ...(status === 'Deleted' ? { deleted_at } : {}) } : email
        ),
        sentEmails: state.sentEmails.map(email =>
          email.id === emailId ? { ...email, status, ...(status === 'Deleted' ? { deleted_at } : {}) } : email
        ),
        selectedEmail: state.selectedEmail?.id === emailId
          ? { ...state.selectedEmail, status, ...(status === 'Deleted' ? { deleted_at } : {}) }
          : state.selectedEmail,
      }));
      // Handling an email (archive/delete/reply) also marks it read, so "dealt
      // with" always means it leaves the active inbox view (read <-> handled).
      if (status === 'Archived' || status === 'Deleted' || status === 'Replied') {
        void get().markAsRead(emailId);
      }
      persistEmailsToDisk();
    } catch (error) {
      console.error('Failed to update email status:', error);
    }
  },

  updateAttachmentAnalysis: (emailId, attachmentId, analysis) => {
    set((state) => {
      const updateEmail = (email: Email) => {
        if (email.id !== emailId) return email;

        const updatedAttachments = email.attachments?.map(attachment =>
          attachment.id === attachmentId
            ? {
                ...attachment,
                aiSummary: analysis.summary,
                aiKeyPoints: analysis.key_points,
                aiActionItems: analysis.action_items,
              }
            : attachment
        ) ?? email.attachments;

        return { ...email, attachments: updatedAttachments };
      };

      return {
        emails: state.emails.map(updateEmail),
        sentEmails: state.sentEmails.map(updateEmail),
        selectedEmail: state.selectedEmail?.id === emailId
          ? updateEmail(state.selectedEmail)
          : state.selectedEmail,
      };
    });
    persistEmailsToDisk();
  },

  dismissAttention: (emailId) => {
    // Learn from a dismiss as a deprioritization signal for this sender.
    useFeedbackStore.getState().record(get().emails.find(e => e.id === emailId)?.sender, 'dismiss');
    set((state) => ({
      emails: state.emails.map(e => {
        if (e.id !== emailId) return e;
        // Downgrade Urgent → Normal so it moves down in importance sort
        const category = e.category === 'Urgent' ? 'Normal' as const : e.category;
        return { ...e, attention_dismissed: true, category };
      }),
    }));
    // Dismissing = handled -> mark read so it leaves the active inbox view.
    void get().markAsRead(emailId);
    persistEmailsToDisk();
  },

  classifyEmail: async (emailId) => {
    // Delegate to the real AI classifier (GenAI gateway → Tauri fallback), which
    // persists category + requires_reply. Replaces the old brittle keyword heuristic
    // (which also crashed on email.from — a field that doesn't exist on Email).
    await classifyEmailPriority(emailId);
  },

  generateReply: async (emailId) => {
    try {
      const email = get().emails.find(e => e.id === emailId);
      if (!email) return;

      // Get user's name for sign-off
      const authStore = useAuthStore.getState();
      const userName = authStore.user?.name || undefined;

      // Match the user's learned voice with this recipient, if we've learned one.
      const recipientAddr = (email.sender.match(/<([^>]+)>/)?.[1] || email.sender).trim();
      const memoryNotes = useContactMemoryStore.getState().getNotes(recipientAddr);
      let learnedStyle: RecipientWritingStyle | null = null;
      try { learnedStyle = await getRecipientWritingStyle(recipientAddr); } catch { /* no style learned yet */ }

      // Real AI draft via GenAI gateway → Tauri fallback. If the backend is
      // unreachable, fall back to a short acknowledgement so the flow still works.
      let generatedReply: string;
      try {
        const res = await generateReplyClaude({
          sender: email.sender,
          subject: email.subject,
          body_text: email.body_text || email.snippet || '',
          user_answers: [],
          formality_level: 'neutral',
          user_name: userName,
          sender_tone: email.sender_tone,
          learned_writing_style: learnedStyle ?? undefined,
          additional_context: memoryNotes.length ? `Context on the recipient: ${memoryNotes.join('; ')}.` : undefined,
        });
        generatedReply = res.reply;
      } catch (err) {
        console.warn('[AI Processing] Reply generation failed, using fallback:', err);
        const senderName = email.sender.split('<')[0].trim() || 'there';
        generatedReply = `Hi ${senderName},\n\nThanks for your email — I’ve received it and will follow up shortly.\n\nBest,\n${userName || ''}`.trim();
      }

      // Update local state
      set((state) => ({
        emails: state.emails.map(e =>
          e.id === emailId
            ? { ...e, ai_generated_reply: generatedReply }
            : e
        ),
        selectedEmail: state.selectedEmail?.id === emailId
          ? { ...state.selectedEmail, ai_generated_reply: generatedReply }
          : state.selectedEmail,
      }));
    } catch (error) {
      console.error('Failed to generate reply:', error);
    }
  },

  summarizeEmail: async (emailId) => {
    // Just trigger background processing and return what we have
    const email = get().emails.find(e => e.id === emailId);
    if (!email) return null;

    // If no summary, trigger background generation
    if (!email.summary) {
      generateSummaryForEmail(emailId);
    }
    return email.summary || null;
  },

  sendEmail: async (to, subject, body, inReplyTo, originalEmailData, attachments = []) => {
    try {
      console.log('Sending email via OAuth server...', attachments.length > 0 ? `with ${attachments.length} attachment(s)` : '');

      // Get auth token from store
      const authStore = useAuthStore.getState();
      const accessToken = authStore.token?.access_token || localStorage.getItem('aiden_access_token');
      const userInfo = authStore.user;

      if (!accessToken) {
        throw new Error('Not authenticated');
      }

      // Use Python OAuth server to send email
      const baseURL = await serverURL();
      const response = await fetch(`${baseURL}/send-email`, {
        method: 'POST',
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ to, subject, body, inReplyTo, attachments })
      });

      if (!response.ok) {
        throw new Error(`Failed to send email: ${response.statusText}`);
      }

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || 'Failed to send email');
      }

      console.log('Email sent successfully');

      // Find the original email to get its thread_id (check both inbox and sent)
      const state = get();
      const originalEmail = inReplyTo
        ? state.emails.find(e => e.id === inReplyTo) || state.sentEmails.find(e => e.id === inReplyTo)
        : null;
      const originalThreadId = originalEmail?.thread_id || originalEmail?.id || inReplyTo;

      // Add to sent emails with reference to original email
      const sentEmail: Email = {
        id: result.id || `sent-${Date.now()}`,
        gmail_id: result.id || `sent-${Date.now()}`,
        thread_id: originalThreadId || result.id || `sent-${Date.now()}`, // Use original thread_id
        subject,
        sender: userInfo?.email || 'me',
        recipients: to,
        date: new Date().toISOString(),
        body_text: body,
        snippet: body.substring(0, 100),
        is_read: true,
        is_starred: false,
        has_attachments: attachments.length > 0,
        attachments: attachments.map(att => ({
          id: `att-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          filename: att.name,
          mimeType: 'application/pdf', // Default to PDF, ideally should detect from file
          size: att.base64.length * 3 / 4, // Approximate size from base64
          base64Data: att.base64, // Store data so we can analyze without re-downloading from Gmail
        })),
        status: 'Replied',
        category: 'Normal',
        requires_reply: false,
        inReplyTo: inReplyTo,
        originalEmail: originalEmailData,
      };

      console.log('[sendEmail] Thread mapping:', { inReplyTo, originalThreadId, sentThreadId: sentEmail.thread_id, originalEmailId: originalEmail?.id });

      set((state) => ({
        sentEmails: [sentEmail, ...state.sentEmails],
        // Track that we sent a reply to this email
        sentReplyEmailIds: new Set(state.sentReplyEmailIds).add(inReplyTo || ''),
        // Mark the original inbound email handled so it drops out of "Needs you"
        // (consistent with how a replied channel message leaves the inbox).
        emails: inReplyTo
          ? state.emails.map((e) =>
              e.id === inReplyTo ? { ...e, status: 'Replied' as const, requires_reply: false, is_read: true } : e,
            )
          : state.emails,
      }));
      // Replying = handled -> mark the original read (Gmail + local) so it leaves the active view.
      if (inReplyTo) void get().markAsRead(inReplyTo);
      persistEmailsToDisk();

      // Commitment tracking: (1) clear any promise you owed this person in this
      // thread now that you've responded (unless this reply defers again), then
      // (2) re-scan so any new promise in this message becomes a tracked commitment.
      {
        const recipientEmail = (to.match(/<([^>]+)>/)?.[1] || to).trim().toLowerCase();
        import('./commitmentStore')
          .then(({ useCommitmentStore }) =>
            useCommitmentStore.getState().reconcileSentEmail({
              counterpartyEmail: recipientEmail,
              threadId: originalThreadId || undefined,
              body,
            }),
          )
          .catch(() => {});
      }
      rescanCommitments();

      // Bump the recipient's relationship stats (sent count + recency) so the
      // Relationships view reflects the reply immediately — contacts are derived
      // once at startup, so a new send wouldn't otherwise show up.
      import('./crmStore')
        .then(({ useCrmStore }) => useCrmStore.getState().recordSentEmail(to))
        .catch(() => {});

      // Learn the user's writing voice with this recipient from their sent history,
      // so future drafts match how they actually write. Centralizes the style loop
      // (previously only attempted — unreliably — from the email view) so every send
      // contributes. Fire-and-forget; needs ≥2 samples to be meaningful.
      {
        const recipientEmail = (to.match(/<([^>]+)>/)?.[1] || to).trim().toLowerCase();
        const bodies = get().sentEmails
          .filter((e) => (e.recipients || '').toLowerCase().includes(recipientEmail))
          .map((e) => e.body_text)
          .filter((b): b is string => !!b && b.trim().length > 0)
          .slice(0, 20);
        if (bodies.length >= 2) {
          analyzeAndSaveWritingStyle(recipientEmail, bodies).catch(() => {});
        }
      }

      // Schedule a reminder if this is a reply (has inReplyTo)
      if (inReplyTo) {
        get().scheduleReplyReminder(sentEmail.id, inReplyTo, 3); // 3 days default
        // Learn that the user engages with this person (boosts their future priority).
        useFeedbackStore.getState().record(to, 'reply');
      }
    } catch (error) {
      console.error('Failed to send email:', error);
      throw error;
    }
  },

  setSearchQuery: (query) => {
    set({ searchQuery: query });
  },

  setCurrentFilter: (filter) => {
    set({ currentFilter: filter });
  },

  setSortMode: (sort) => {
    set({ sortMode: sort });
  },

  setReadFilter: (filter) => {
    set({ readFilter: filter });
  },

  refreshEmails: async () => {
    await get().fetchEmails();
  },

  saveEmail: (emailId) => {
    set((state) => ({
      emails: state.emails.map(e =>
        e.id === emailId ? { ...e, status: 'Saved' } : e
      ),
      selectedEmail: state.selectedEmail?.id === emailId
        ? { ...state.selectedEmail, status: 'Saved' }
        : state.selectedEmail,
    }));
    persistEmailsToDisk();
  },

  unsaveEmail: (emailId) => {
    set((state) => ({
      emails: state.emails.map(e =>
        e.id === emailId ? { ...e, status: 'Unhandled' } : e
      ),
      selectedEmail: state.selectedEmail?.id === emailId
        ? { ...state.selectedEmail, status: 'Unhandled' }
        : state.selectedEmail,
    }));
    persistEmailsToDisk();
  },

  saveGeneratedReply: (emailId, reply) => {
    set((state) => ({
      emails: state.emails.map(e =>
        e.id === emailId ? { ...e, ai_generated_reply: reply } : e
      ),
      selectedEmail: state.selectedEmail?.id === emailId
        ? { ...state.selectedEmail, ai_generated_reply: reply }
        : state.selectedEmail,
    }));
    persistEmailsToDisk();
  },

  sendEmailNotification: async (emailId, summary, reply) => {
    const state = get();
    if (state.notifiedEmailIds.has(emailId)) return; // Already notified

    const email = state.emails.find(e => e.id === emailId);
    if (!email) return;

    const senderName = email.sender.split('<')[0].trim() || email.sender;

    // Check smart notification settings
    const notifCheck = await shouldSendNotification(
      email.sender,
      email.subject,
      email.category || 'Normal'
    );

    console.log(`[Smart Notifications] Manual notification check:`, notifCheck);

    if (notifCheck.should_notify) {
      sendNotification(`Email from ${senderName}`, summary);
      set((state) => ({
        notifiedEmailIds: new Set(state.notifiedEmailIds).add(emailId),
      }));
    } else if (notifCheck.should_batch) {
      queueNotification(emailId, senderName, email.subject, summary);
    }
  },

  getFilteredEmails: () => {
    const state = get();
    const { emails, sentEmails, currentFilter, searchQuery } = state;

    let filtered: Email[] = [];

    switch (currentFilter) {
      case 'inbox':
        // Inbox shows unhandled emails PLUS waiting-on-reply emails at the top
        const waitingEmails = sentEmails.filter(e => e.waiting_on_reply_since);
        const regularInbox = emails.filter(e => e.status === 'Unhandled');
        // Put waiting emails first, then regular inbox
        filtered = [...waitingEmails, ...regularInbox];
        break;
      case 'unhandled':
        filtered = emails.filter(e => e.status === 'Unhandled');
        break;
      case 'saved':
        filtered = emails.filter(e => e.status === 'Saved');
        break;
      case 'sent':
        filtered = sentEmails;
        break;
      case 'urgent':
        filtered = emails.filter(e => e.category === 'Urgent');
        break;
      case 'important':
        filtered = emails.filter(e => e.category === 'Important');
        break;
      case 'normal':
        filtered = emails.filter(e => e.category === 'Normal');
        break;
      case 'low':
        filtered = emails.filter(e => e.category === 'Low');
        break;
      case 'focus':
        // Focus Mode: Only show emails that require action (exclude FYI)
        filtered = emails.filter(e => {
          // Exclude archived and saved
          if (e.status === 'Archived' || e.status === 'Saved') return false;

          // Check AI analysis for more precise filtering
          let requiresReply: boolean | null = null;
          if (typeof window !== 'undefined' && (window as any).emailQuestionData) {
            const data = (window as any).emailQuestionData.get(e.id);
            if (data?.loaded) {
              requiresReply = data.requiresReply === true;
            }
          }

          // Show if AI has determined it requires reply
          if (requiresReply === true) return true;
          // Explicitly exclude if AI says no reply needed (FYI)
          if (requiresReply === false) return false;

          // Before AI analysis completes, include based on category
          // Always show Urgent and Important categories
          if (e.category === 'Urgent' || e.category === 'Important') return true;

          // Exclude Normal and Low categories when AI hasn't analyzed yet
          // (they'll appear if AI later determines they require action)
          return false;
        });
        break;
      case 'all':
        // All mail: everything except trashed (archived included, like Gmail's All Mail)
        filtered = emails.filter(e => e.status !== 'Deleted');
        break;
      case 'archived':
        filtered = emails.filter(e => e.status === 'Archived');
        break;
      case 'deleted':
        filtered = emails.filter(e => e.status === 'Deleted');
        break;
      default:
        // Unknown filter (e.g. 'triage'): show the active inbox — never leak Trash/Archive
        filtered = emails.filter(e => e.status !== 'Deleted' && e.status !== 'Archived');
    }

    // Apply search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(e =>
        e.subject.toLowerCase().includes(query) ||
        e.sender.toLowerCase().includes(query) ||
        e.snippet.toLowerCase().includes(query)
      );
    }

    return filtered;
  },

  isGeneratingReply: (emailId: string) => {
    return get().generatingReplies.has(emailId);
  },

  isGeneratingSummary: (emailId: string) => {
    return get().generatingSummaries.has(emailId);
  },

  triggerAIProcessing: (emailId: string) => {
    processEmailImmediately(emailId);
  },

  hasSentReply: (emailId: string) => {
    return get().sentReplyEmailIds.has(emailId);
  },

  // Bulk action implementations
  toggleEmailSelection: (emailId: string) => {
    const state = get();
    const newSelection = new Set(state.selectedEmailIds);
    if (newSelection.has(emailId)) {
      newSelection.delete(emailId);
    } else {
      newSelection.add(emailId);
    }
    set({
      selectedEmailIds: newSelection,
      isSelectMode: newSelection.size > 0,
    });
  },

  selectMultipleEmails: (emailIds: string[]) => {
    const state = get();
    const newSelection = new Set(state.selectedEmailIds);
    emailIds.forEach(id => newSelection.add(id));
    set({
      selectedEmailIds: newSelection,
      isSelectMode: true,
    });
  },

  deselectMultipleEmails: (emailIds: string[]) => {
    const state = get();
    const newSelection = new Set(state.selectedEmailIds);
    console.log('[deselectMultipleEmails] input emailIds:', emailIds);
    console.log('[deselectMultipleEmails] current selectedEmailIds:', Array.from(state.selectedEmailIds));
    emailIds.forEach(id => newSelection.delete(id));
    console.log('[deselectMultipleEmails] newSelection after delete:', Array.from(newSelection));
    set({
      selectedEmailIds: newSelection,
      isSelectMode: newSelection.size > 0,
    });
  },

  clearSelection: () => {
    set({
      selectedEmailIds: new Set<string>(),
      isSelectMode: false,
    });
  },

  selectAllVisible: () => {
    const visibleEmails = get().getFilteredEmails();
    set({
      selectedEmailIds: new Set(visibleEmails.map(e => e.id)),
      isSelectMode: true,
    });
  },

  isEmailSelected: (emailId: string) => {
    return get().selectedEmailIds.has(emailId);
  },

  getSelectedCount: () => {
    return get().selectedEmailIds.size;
  },

  bulkArchive: async (emailIds?: string[]) => {
    const state = get();
    const idsToArchive = emailIds || Array.from(state.selectedEmailIds);
    if (idsToArchive.length === 0) return;

    // Archive each email by updating its status
    for (const emailId of idsToArchive) {
      await get().updateEmailStatus(emailId, 'Archived');
    }

    // Clear selection after bulk action
    get().clearSelection();
  },

  bulkDelete: async (emailIds?: string[]) => {
    const state = get();
    const idsToDelete = emailIds || Array.from(state.selectedEmailIds);
    if (idsToDelete.length === 0) return;

    // Delete each email by updating its status to 'Deleted'
    for (const emailId of idsToDelete) {
      await get().updateEmailStatus(emailId, 'Deleted');
    }

    // Clear selection after bulk action
    get().clearSelection();
  },

  bulkMarkAsRead: async (emailIds?: string[]) => {
    const state = get();
    const idsToMark = emailIds || Array.from(state.selectedEmailIds);
    if (idsToMark.length === 0) return;

    // Update local state immediately
    set((state) => ({
      emails: state.emails.map(email =>
        idsToMark.includes(email.id) ? { ...email, is_read: true } : email
      ),
    }));
    persistEmailsToDisk();

    // Batch mark in Gmail via single API call
    try {
      const baseURL = await serverURL();
      await fetch(`${baseURL}/batch-mark-read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageIds: idsToMark }),
      });
    } catch (e) {
      console.warn('Failed to batch mark as read in Gmail:', e);
    }
  },

  bulkSave: (emailIds?: string[]) => {
    const state = get();
    const idsToSave = emailIds || Array.from(state.selectedEmailIds);
    if (idsToSave.length === 0) return;

    // Save/unsave each email by toggling its status in both arrays
    set((state) => ({
      emails: state.emails.map(email =>
        idsToSave.includes(email.id)
          ? { ...email, status: email.status === 'Saved' ? 'Unhandled' : 'Saved' }
          : email
      ),
      sentEmails: state.sentEmails.map(email =>
        idsToSave.includes(email.id)
          ? { ...email, status: email.status === 'Saved' ? 'Unhandled' : 'Saved' }
          : email
      ),
    }));

    persistEmailsToDisk();

    // Clear selection after bulk action
    get().clearSelection();
  },

  purgeOldTrash: () => {
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - THIRTY_DAYS_MS;
    const state = get();
    const beforeCount = state.emails.length + state.sentEmails.length;
    const emails = state.emails.filter(e => {
      if (e.status !== 'Deleted') return true;
      if (!e.deleted_at) return true; // keep if no timestamp (legacy)
      return new Date(e.deleted_at).getTime() > cutoff;
    });
    const sentEmails = state.sentEmails.filter(e => {
      if (e.status !== 'Deleted') return true;
      if (!e.deleted_at) return true;
      return new Date(e.deleted_at).getTime() > cutoff;
    });
    const purged = beforeCount - emails.length - sentEmails.length;
    if (purged > 0) {
      set({ emails, sentEmails });
      persistEmailsToDisk();
      console.log(`[EmailStore] Purged ${purged} emails from trash (older than 30 days)`);
    }
  },

  // ===== Threading Methods =====

  setEmails: (emails: Email[]) => {
    set({ emails });
    rescanCommitments();
  },

  setViewMode: (mode: 'individual' | 'threaded') => {
    set({ viewMode: mode });
    // When switching to threaded view, expand all threads by default
    if (mode === 'threaded') {
      get().expandAllThreads();
    }
  },

  toggleThreadExpanded: (threadId: string) => {
    set((state) => {
      const newExpanded = new Set(state.expandedThreads);
      if (newExpanded.has(threadId)) {
        newExpanded.delete(threadId);
      } else {
        newExpanded.add(threadId);
      }
      return { expandedThreads: newExpanded };
    });
  },

  expandAllThreads: () => {
    const state = get();
    const filteredEmails = state.getFilteredEmails();
    const threadIds = new Set(filteredEmails.map(e => e.thread_id).filter(Boolean));
    set({ expandedThreads: threadIds });
  },

  collapseAllThreads: () => {
    set({ expandedThreads: new Set() });
  },

  getThreadEmails: (threadId: string) => {
    const state = get();
    // Include both received emails and sent emails in the thread
    const allThreadEmails = [
      ...state.emails.filter(e => e.thread_id === threadId || e.id === threadId),
      ...state.sentEmails.filter(e => e.thread_id === threadId || e.id === threadId)
    ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return allThreadEmails;
  },

  getThreadRepresentative: (threadId: string) => {
    const threadEmails = get().getThreadEmails(threadId);
    if (threadEmails.length === 0) return null;
    // Return the most recent email as the representative
    return threadEmails[threadEmails.length - 1];
  },

  groupEmailsByThread: (emails: Email[]) => {
    const threadMap = new Map<string, Email[]>();
    emails.forEach(email => {
      const threadId = email.thread_id || email.id;
      if (!threadMap.has(threadId)) {
        threadMap.set(threadId, []);
      }
      threadMap.get(threadId)!.push(email);
    });
    // Sort emails within each thread by date
    threadMap.forEach(threadEmails => {
      threadEmails.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    });
    // Debug logging
    console.log('[groupEmailsByThread] Thread groups created:', Array.from(threadMap.entries()).map(([tid, emails]) => ({
      threadId: tid,
      count: emails.length,
      emailIds: emails.map(e => ({ id: e.id, subject: e.subject?.substring(0, 30), thread_id: e.thread_id }))
    })));
    return threadMap;
  },

  getFilteredThreads: () => {
    const state = get();
    const filteredEmails = state.getFilteredEmails();
    return state.groupEmailsByThread(filteredEmails);
  },

  isInThread: (emailId: string) => {
    const state = get();
    const email = state.emails.find(e => e.id === emailId);
    if (!email || !email.thread_id) return false;
    const threadEmails = state.emails.filter(e => e.thread_id === email.thread_id);
    return threadEmails.length > 1;
  },

  getThreadPosition: (emailId: string) => {
    const state = get();
    const email = state.emails.find(e => e.id === emailId);
    if (!email || !email.thread_id) return null;
    const threadEmails = state.getThreadEmails(email.thread_id);
    const index = threadEmails.findIndex(e => e.id === emailId);
    if (index === -1) return null;
    return { current: index + 1, total: threadEmails.length };
  },

  // Auto-reminder implementations
  scheduleReplyReminder: (sentEmailId: string, originalEmailId: string, delayDays: number = 3) => {
    const state = get();
    const now = new Date();

    // Find the original email to determine if follow-up is needed
    const originalEmail = state.emails.find(e => e.id === originalEmailId);

    // AI determines: only set needs_follow_up if the original email required a response
    // Urgency determines delay days (Urgent=2, Important=3, Normal/Low=5)
    let needsFollowUp = false;
    let reminderDelay = delayDays;

    if (originalEmail) {
      // Check if original email required a reply (from AI analysis or category)
      const originalRequiredReply = originalEmail.requires_reply;
      const originalCategory = originalEmail.category;

      // Set needs_follow_up based on whether the original email needed a response
      needsFollowUp = originalRequiredReply === true;

      // AI determines urgency based on category
      if (originalCategory === 'Urgent') {
        reminderDelay = 2; // 2 days for urgent
      } else if (originalCategory === 'Important') {
        reminderDelay = 3; // 3 days for important
      } else {
        reminderDelay = 5; // 5 days for normal/low priority
      }

      console.log('[scheduleReplyReminder] Original email analysis:', {
        subject: originalEmail.subject,
        requiredReply: originalRequiredReply,
        category: originalCategory,
        needsFollowUp,
        reminderDelay
      });
    }

    const reminderDue = new Date(now.getTime() + reminderDelay * 24 * 60 * 60 * 1000);

    // Update the sent email with reminder tracking (only if follow-up is needed)
    const sentEmail = state.sentEmails.find(e => e.id === sentEmailId);
    if (sentEmail) {
      const updatedSentEmails = state.sentEmails.map(e =>
        e.id === sentEmailId
          ? {
              ...e,
              ...(needsFollowUp ? {
                waiting_on_reply_since: now.toISOString(),
                reminder_due_date: reminderDue.toISOString(),
                reminder_triggered: false,
                reminder_count: 0,
              } : {}),
              needs_follow_up: needsFollowUp,
            }
          : e
      );
      set({ sentEmails: updatedSentEmails });

      // Only add to pending reminders if follow-up is needed
      if (needsFollowUp) {
        const pendingReminders = new Set(state.pendingReminders);
        pendingReminders.add(sentEmailId);
        set({ pendingReminders });
      }

      console.log('[scheduleReplyReminder] Sent email updated:', {
        sentEmailId,
        needsFollowUp,
        reminderDue: reminderDue.toISOString()
      });
    }

    // Also update the original email to track that we've sent a reply
    if (originalEmail) {
      const updatedEmails = state.emails.map(e =>
        e.id === originalEmailId
          ? { ...e, status: 'Replied' as const }
          : e
      );
      set({ emails: updatedEmails });

      // Auto-dismiss attention flag on the original email (persisted)
      get().dismissAttention(originalEmailId);

      // Track that we've replied to this email
      const sentReplyEmailIds = new Set(state.sentReplyEmailIds);
      sentReplyEmailIds.add(originalEmailId);
      set({ sentReplyEmailIds });
    }
    persistEmailsToDisk();
  },

  checkPendingReminders: () => {
    const state = get();
    const now = new Date().toISOString();
    const dueReminders: string[] = [];

    // Check each pending reminder
    state.pendingReminders.forEach(emailId => {
      const sentEmail = state.sentEmails.find(e => e.id === emailId);
      if (!sentEmail) return;

      // Check if snoozed
      if (sentEmail.reminder_snoozed_until) {
        if (new Date(now) >= new Date(sentEmail.reminder_snoozed_until)) {
          // Clear snooze
          const updatedSentEmails = state.sentEmails.map(e =>
            e.id === emailId
              ? { ...e, reminder_snoozed_until: undefined }
              : e
          );
          set({ sentEmails: updatedSentEmails });
        } else {
          // Still snoozed, skip
          return;
        }
      }

      // Check if reminder is due
      if (sentEmail.reminder_due_date && new Date(now) >= new Date(sentEmail.reminder_due_date) && !sentEmail.reminder_triggered) {
        dueReminders.push(emailId);

        // Mark as triggered
        const updatedSentEmails = state.sentEmails.map(e =>
          e.id === emailId
            ? {
                ...e,
                reminder_triggered: true,
                reminder_count: (e.reminder_count || 0) + 1,
              }
            : e
        );
        set({ sentEmails: updatedSentEmails });
      }
    });

    if (dueReminders.length > 0) {
      persistEmailsToDisk();
    }

    // Send notifications for due reminders
    if (dueReminders.length > 0 && typeof window !== 'undefined' && 'Notification' in window) {
      dueReminders.forEach(emailId => {
        const sentEmail = state.sentEmails.find(e => e.id === emailId);
        if (sentEmail && Notification.permission === 'granted') {
          new Notification('Aiden - Follow-up Reminder', {
            body: `No reply to "${sentEmail.subject}" in 3 days. Want to bump this?`,
            icon: '/icon.png',
            tag: emailId,
          });
        }
      });
    }

    return dueReminders;
  },

  getThreadsWaitingOnReply: () => {
    const state = get();
    const now = new Date().toISOString();

    // Get sent emails that are waiting for reply
    return state.sentEmails
      .filter(e => e.waiting_on_reply_since && !e.reminder_triggered)
      .map(sentEmail => {
        const waitingSince = new Date(sentEmail.waiting_on_reply_since!);
        const daysWaiting = Math.floor((new Date(now).getTime() - waitingSince.getTime()) / (1000 * 60 * 60 * 24));
        const reminderDue = sentEmail.reminder_due_date
          ? new Date(sentEmail.reminder_due_date)
          : new Date(waitingSince.getTime() + 3 * 24 * 60 * 60 * 1000);
        const daysUntilReminder = Math.ceil((reminderDue.getTime() - new Date(now).getTime()) / (1000 * 60 * 60 * 24));

        return {
          ...sentEmail,
          daysWaiting,
          daysUntilReminder: daysUntilReminder > 0 ? daysUntilReminder : 0,
        };
      })
      .sort((a, b) => a.daysUntilReminder - b.daysUntilReminder);
  },

  cancelReminder: (emailId: string) => {
    const state = get();
    const pendingReminders = new Set(state.pendingReminders);
    pendingReminders.delete(emailId);

    // Clear reminder data from the email
    const updatedSentEmails = state.sentEmails.map(e =>
      e.id === emailId
        ? {
            ...e,
            reminder_due_date: undefined,
            reminder_triggered: undefined,
            reminder_count: undefined,
            reminder_snoozed_until: undefined,
            waiting_on_reply_since: undefined,
            needs_follow_up: false,
          }
        : e
    );

    set({
      pendingReminders,
      sentEmails: updatedSentEmails,
    });

    persistEmailsToDisk();
    console.log('[cancelReminder] Reminder cancelled for', emailId);
  },

  snoozeReminder: (emailId: string, days: number) => {
    const state = get();
    const now = new Date();
    const snoozeUntil = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    const updatedSentEmails = state.sentEmails.map(e =>
      e.id === emailId
        ? {
            ...e,
            reminder_snoozed_until: snoozeUntil.toISOString(),
            reminder_due_date: snoozeUntil.toISOString(),
            reminder_triggered: false,
          }
        : e
    );

    // Remove from pending reminders until snooze expires
    const pendingReminders = new Set(state.pendingReminders);
    pendingReminders.delete(emailId);

    set({
      sentEmails: updatedSentEmails,
      pendingReminders,
    });

    persistEmailsToDisk();
    console.log('[snoozeReminder] Reminder snoozed for', emailId, 'until', snoozeUntil.toISOString());
  },

  initializeReminderChecker: () => {
    const state = get();

    // Clear existing interval if any
    if (state.reminderCheckInterval) {
      clearInterval(state.reminderCheckInterval);
    }

    // Check every hour
    const interval = setInterval(() => {
      get().checkPendingReminders();
    }, 60 * 60 * 1000); // 1 hour

    set({ reminderCheckInterval: interval });

    // Also check immediately on initialization
    state.checkPendingReminders();
  },

  cleanupReminderChecker: () => {
    const state = get();
    if (state.reminderCheckInterval) {
      clearInterval(state.reminderCheckInterval);
      set({ reminderCheckInterval: null });
    }
  },

  // Add mock waiting-on-reply emails for testing
  loadMockWaitingEmails: () => {
    // DISABLED: Using single test email approach
    console.log('[Mock Data] loadMockWaitingEmails() is disabled - using single test email');
  },
}));

// ===== SAMPLE DATA FOR TESTING =====
// Load sample emails automatically when there are no real emails
if (typeof window !== 'undefined') {
  (window as any).loadSampleEmails = () => {
    // Use a base time that's AFTER the app's start time to ensure emails appear in inbox
    // The app uses appStartTime to filter emails, so we need emails newer than that
    const baseTime = Date.now() + 1000; // 1 second in the future to be safe
    const baseThreadId = 'sample-thread-';

    const sampleEmails: Email[] = [
      // Single test email - work deadline request
      {
        id: `test-1`,
        gmail_id: `test-1`,
        thread_id: `test-thread-1`,
        subject: 'Project deadline extension request',
        sender: 'Sarah Chen <schen@company.com>',
        recipients: 'me@company.com',
        date: new Date(baseTime - 1000 * 60 * 5).toISOString(), // 5 minutes ago
        body_text: `Hi team,

I need to request an extension for the Q4 report deadline. Due to some unexpected delays in data collection and team availability challenges, I won't be able to submit the final report by this Friday (Nov 15th).

Could we push the deadline to next Wednesday (Nov 20th)? This would give me enough time to ensure the report is comprehensive and accurate.

Key reasons for the extension:
- Data collection took 3 extra days due to API integration issues
- Two team members were out sick last week
- Quality assurance needs more thorough testing

I understand this may impact the review schedule, and I'm happy to discuss alternative timelines if next Wednesday doesn't work for the team.

Thanks for considering this request.

Best regards,
Sarah`,
        snippet: 'I need to request an extension for the Q4 report deadline...',
        is_read: false,
        is_starred: false,
        has_attachments: false,
        status: 'Unhandled',
        category: 'Normal',
        summary: undefined, // Will be AI-generated
        key_points: undefined, // Will be AI-generated
        action_items: undefined, // Will be AI-generated
        requires_reply: true,
      },

      /* ----------------------------------------------------------------
       * Ten scenarios spanning every way Aiden should triage a message.
       * Each carries an explicit category + summary so the demo is
       * deterministic, and an EXPECTATION note describing the intended
       * handling (category · whether it lands on Today, and which section).
       * ---------------------------------------------------------------- */

      // EXPECTATION: Urgent · Today → "Needs your attention" (top of Focus, urgent_email)
      // Key customer + active outage → highest severity, reply immediately.
      {
        id: 'test-2', gmail_id: 'test-2', thread_id: 'test-thread-2',
        subject: 'URGENT: Acme dashboard is down for all our users',
        sender: 'Elena Rossi <elena@acme.com>',
        recipients: 'me@company.com',
        date: new Date(baseTime - 1000 * 60 * 3).toISOString(),
        body_text: `Hi — our entire team is locked out of the analytics dashboard since about 30 minutes ago. Every user gets a 500 error on login. This is blocking our morning reporting and the board update we have at noon.\n\nCan someone look into this right away and let me know an ETA? Happy to hop on a call immediately.\n\nElena`,
        snippet: 'Our entire team is locked out of the analytics dashboard since about 30 minutes ago...',
        is_read: false, is_starred: false, has_attachments: false,
        status: 'Unhandled', category: 'Urgent', requires_reply: true,
        summary: 'Acme (key customer) reports a full dashboard outage — all users get a 500 on login, blocking their noon board update. Elena wants an immediate ETA and is ready to jump on a call.',
      },

      // EXPECTATION: Important · Today → "Needs your attention" (deadline-bearing)
      // Hard deadline ~3 days out. Surfaces even though it's automated / needs no reply.
      {
        id: 'test-3', gmail_id: 'test-3', thread_id: 'test-thread-3',
        subject: 'Reminder: Summer Research Fellowship application closes Friday',
        sender: 'Yale Fellowships <noreply@grants.yale.edu>',
        recipients: 'me@company.com',
        date: new Date(baseTime - 1000 * 60 * 60 * 2).toISOString(),
        body_text: `This is a reminder that the application deadline for the Summer Research Fellowship is this Friday at 11:59 PM. Submit your proposal, CV, and reference letter through the portal before the deadline. Late submissions cannot be accepted.`,
        snippet: 'The application deadline for the Summer Research Fellowship is this Friday at 11:59 PM...',
        is_read: false, is_starred: false, has_attachments: false,
        status: 'Unhandled', category: 'Important', requires_reply: false,
        deadline: new Date(baseTime + 1000 * 60 * 60 * 24 * 3).toISOString(),
        summary: 'The Summer Research Fellowship application closes this Friday (~3 days). Proposal, CV, and a reference letter must be submitted via the portal before the deadline; no late entries.',
      },

      // EXPECTATION: Important · Today → "Needs your attention" (needs reply, meeting)
      // A scheduling decision from a close colleague — wants a time this week.
      {
        id: 'test-4', gmail_id: 'test-4', thread_id: 'test-thread-4',
        subject: 'Can we sync on the VP Sales shortlist this week?',
        sender: 'Marcus Lee <marcus@company.com>',
        recipients: 'me@company.com',
        date: new Date(baseTime - 1000 * 60 * 60 * 4).toISOString(),
        body_text: `Hey — I've narrowed the VP Sales candidates down to three and I'd love your read before we move to final rounds. Do you have 30 minutes Thursday or Friday? I can work around your calendar.`,
        snippet: "I've narrowed the VP Sales candidates down to three and I'd love your read...",
        is_read: false, is_starred: false, has_attachments: false,
        status: 'Unhandled', category: 'Important', requires_reply: true,
        summary: 'Marcus has a VP Sales shortlist of three and wants your input before final rounds. He’s asking for 30 minutes Thursday or Friday — needs a time from you.',
      },

      // EXPECTATION: Important · Today → "Needs your attention" (needs reply)
      // High-value investor re-engaging — reply promptly while interest is warm.
      {
        id: 'test-5', gmail_id: 'test-5', thread_id: 'test-thread-5',
        subject: 'Re: our chat — would love to dig in further',
        sender: 'Raj Patel <raj@northstar.vc>',
        recipients: 'me@company.com',
        date: new Date(baseTime - 1000 * 60 * 60 * 6).toISOString(),
        body_text: `Great catching up yesterday. The traction you showed is compelling and I'd like to take this to my partners. Could you send over the data room link and a few customer references? Also keen to find a slot for a partner meeting in the next couple of weeks.`,
        snippet: 'The traction you showed is compelling and I’d like to take this to my partners...',
        is_read: false, is_starred: false, has_attachments: false,
        status: 'Unhandled', category: 'Important', requires_reply: true,
        summary: 'Raj (Northstar VC) wants to advance the conversation to his partners — requesting the data room link, customer references, and a partner meeting in the next couple of weeks.',
      },

      // EXPECTATION: Normal · Today → "Needs your attention" (needs reply, low severity)
      // A simple colleague question — quick reply, not a fire.
      {
        id: 'test-6', gmail_id: 'test-6', thread_id: 'test-thread-6',
        subject: 'Quick q on the Q2 pipeline numbers',
        sender: 'Priya Nair <priya@company.com>',
        recipients: 'me@company.com',
        date: new Date(baseTime - 1000 * 60 * 60 * 9).toISOString(),
        body_text: `Hey, are the Q2 pipeline figures in the deck net-new only, or do they include renewals? Want to make sure I frame slide 7 correctly before the investor call. Thanks!`,
        snippet: 'Are the Q2 pipeline figures in the deck net-new only, or do they include renewals?',
        is_read: false, is_starred: false, has_attachments: false,
        status: 'Unhandled', category: 'Normal', requires_reply: true,
        summary: 'Priya needs a quick clarification: are the Q2 pipeline numbers net-new only or do they include renewals? She wants to frame slide 7 correctly before the investor call.',
      },

      // EXPECTATION: Low · Today → NOT shown · newsletter content.
      // Lives in Inbox "All" only — never "Needs you".
      {
        id: 'test-7', gmail_id: 'test-7', thread_id: 'test-thread-7',
        subject: '📈 This week in growth: 7 tactics that actually work',
        sender: "Lenny's Newsletter <hello@lennysnewsletter.com>",
        recipients: 'me@company.com',
        date: new Date(baseTime - 1000 * 60 * 60 * 12).toISOString(),
        body_text: `This week: how three startups cracked activation, a teardown of a great onboarding flow, and the metrics that predict retention. Read the full issue on the web. To stop receiving these, unsubscribe at the bottom.`,
        snippet: 'This week: how three startups cracked activation, a teardown of a great onboarding flow...',
        is_read: false, is_starred: false, has_attachments: false,
        status: 'Unhandled', category: 'Low', requires_reply: false,
        summary: 'Weekly growth newsletter — startup activation case studies, an onboarding teardown, and retention metrics. Informational, no action needed.',
      },

      // EXPECTATION: Normal · Today → "Opportunities" (congratulate on the raise)
      // Funding news from a contact → warm, no-ask note; not a Focus item.
      {
        id: 'test-8', gmail_id: 'test-8', thread_id: 'test-thread-8',
        subject: "We just closed our Series A!",
        sender: 'Tomás Rivera <tomas@brightloop.io>',
        recipients: 'me@company.com',
        date: new Date(baseTime - 1000 * 60 * 60 * 20).toISOString(),
        body_text: `Wanted you to hear it from me first — we raised a $12M Series A led by Vertex! Couldn't have gotten here without the early advice you gave us. Hope you're doing well, would love to catch up soon.`,
        snippet: 'We raised a $12M Series A led by Vertex! Couldn’t have gotten here without your early advice...',
        is_read: false, is_starred: false, has_attachments: false,
        status: 'Unhandled', category: 'Normal', requires_reply: false,
        summary: "Tomás shares that BrightLoop just raised a $12M Series A and credits your early advice. Good news worth a warm, specific congratulations — no ask attached.",
      },

      // EXPECTATION: Low · Today → NOT shown · transactional receipt.
      // Inbox "All" only.
      {
        id: 'test-9', gmail_id: 'test-9', thread_id: 'test-thread-9',
        subject: 'Your order has shipped 📦',
        sender: 'Amazon <auto-confirm@amazon.com>',
        recipients: 'me@company.com',
        date: new Date(baseTime - 1000 * 60 * 60 * 26).toISOString(),
        body_text: `Good news! Your order #112-4455667 has shipped and is expected to arrive Thursday. Track your package using the link in your account. No action is needed.`,
        snippet: 'Your order #112-4455667 has shipped and is expected to arrive Thursday...',
        is_read: false, is_starred: false, has_attachments: false,
        status: 'Unhandled', category: 'Low', requires_reply: false,
        summary: 'Shipping confirmation for an order arriving Thursday. Purely transactional — no action needed.',
      },

      // EXPECTATION: Low · Today → NOT shown (cold-outbound filter keeps it out of Focus).
      // Unknown sender, sales pitch → stays in Inbox, never "Needs you".
      {
        id: 'test-10', gmail_id: 'test-10', thread_id: 'test-thread-10',
        subject: 'Quick question — boost your team’s pipeline 3x',
        sender: 'Tyler Brooks <tyler@pipelineboost.io>',
        recipients: 'me@company.com',
        date: new Date(baseTime - 1000 * 60 * 60 * 30).toISOString(),
        body_text: `Hi there, I’ll keep this short. Our platform can boost your revenue and grow your pipeline fast. Do you have 15 minutes to hop on a call this week for a quick demo? Happy to share an exclusive offer.`,
        snippet: 'Our platform can boost your revenue and grow your pipeline fast. Do you have 15 minutes...',
        is_read: false, is_starred: false, has_attachments: false,
        status: 'Unhandled', category: 'Low', requires_reply: false,
        summary: 'Cold sales outreach from an unknown sender pitching a demo of their pipeline tool. Low value — not from a known contact.',
      },

      // EXPECTATION: Normal · Today → NOT shown (social-noise filter keeps it out of Focus).
      // Team lunch RSVP → Inbox "All" only.
      {
        id: 'test-11', gmail_id: 'test-11', thread_id: 'test-thread-11',
        subject: 'Team lunch Friday — who’s in? 🍕',
        sender: 'Sarah Chen <schen@company.com>',
        recipients: 'me@company.com',
        date: new Date(baseTime - 1000 * 60 * 60 * 34).toISOString(),
        body_text: `Thinking we grab lunch as a team this Friday around 12:30 — maybe that new pizza place down the block? Reply with a 👍 if you can make it so I can book a table.`,
        snippet: 'Thinking we grab lunch as a team this Friday around 12:30 — maybe that new pizza place...',
        is_read: false, is_starred: false, has_attachments: false,
        status: 'Unhandled', category: 'Normal', requires_reply: false,
        summary: 'Sarah is organizing an optional team lunch this Friday at 12:30 and asking who can make it. Social/logistical — no real action needed.',
      },
    ];

    // Set the sample emails in the store
    getStoreState().setEmails(sampleEmails);

    // Trigger AI processing for the test email immediately
    setTimeout(() => {
      sampleEmails.forEach(email => {
        if (!email.summary) {
          console.log(`[Test Email] Triggering AI processing for: ${email.subject}`);
          processEmailImmediately(email.id);
        }
      });
    }, 500);

    // Set up the question data for the sample emails
    if (!(window as any).emailQuestionData) {
      (window as any).emailQuestionData = new Map();
    }
    const questionData = (window as any).emailQuestionData;

    sampleEmails.forEach(email => {
      // For test emails, set up minimal question data - let AI generate most of it
      let questions = [];

      questionData.set(email.id, {
        questions,
        suggestedFormalityScore: 50,
        suggested_formality_score: 50,
        requiresReply: email.requires_reply || false,
        requires_reply: email.requires_reply || false,
        reply_reasoning: email.requires_reply ? 'This email requires a response' : 'FYI only',
        loaded: false, // Will be loaded by AI processing
        meetingRequest: { is_meeting: false },
        attachment_requests: [],
        deadline: null,
      });
    });

    console.log(`✅ Loaded ${sampleEmails.length} test email for testing!`);
    console.log('Test email: "Project deadline extension request" from Sarah Chen');
    console.log('');
    console.log('How Aiden should handle this email:');
    console.log('  1. AUTO-GENERATE SUMMARY: Extract key points (extension request, reasons, timeline)');
    console.log('  2. CLASSIFY: Determine urgency (Normal/Important based on deadline proximity)');
    console.log('  3. EXTRACT DEADLINE: Identify "next Wednesday (Nov 20th)" as deadline');
    console.log('  4. GENERATE ACTION ITEMS: "Respond to extension request", "Review timeline impact"');
    console.log('  5. DETERMINE REPLY NEEDED: Yes - Sarah is asking for a decision/approval');
    console.log('  6. SUGGEST REPLY DRAFT: Professional response (approve/deny/counter-propose)');
    console.log('  7. CREATE LIFE INTEL: Add deadline to Commitments/Today if time-sensitive');
    console.log('');
    console.log('Try these views:');
    console.log('  - Click "Inbox" in sidebar for normal inbox view');
    console.log('  - Click "Focus Mode" for action-required emails only');
    console.log('  - Click "Today" to see if deadline appears in commitments');
    console.log('');
    console.log('🔍 Watch for AI processing in the console logs!');

    return sampleEmails.length;
  };

  (window as any).clearSampleEmails = () => {
    getStoreState().setEmails([]);
    console.log('✅ Cleared all emails');
  };

  // Debug function to check current email count
  (window as any).debugEmails = () => {
    const state = getStoreState();
    console.log('📧 Current Email State:');
    console.log(`  Inbox emails: ${state.emails.length}`);
    console.log(`  Sent emails: ${state.sentEmails.length}`);
    console.log(`  Total visible in inbox: ${state.emails.filter(e => e.status === 'Unhandled' || e.status === 'Saved').length}`);
    console.log('\n📩 Inbox Emails:');
    state.emails.forEach((e, i) => {
      console.log(`  ${i + 1}. "${e.subject}" from ${e.sender.split('<')[0].trim()} (${e.status})`);
    });
    console.log('\n📤 Sent Emails:');
    state.sentEmails.forEach((e, i) => {
      console.log(`  ${i + 1}. "${e.subject}" to ${e.recipients} (${e.status})`);
    });
  };

  // Email source is explicit and LIVE by default — real Gmail is the source of truth,
  // gated behind OAuth (see App.tsx auth routing). Demo emails are opt-in via
  // VITE_DEMO_EMAILS=true (loads the sample set for offline demos/screenshots);
  // window.loadSampleEmails() also remains available for manual console testing.
  if (import.meta.env.VITE_DEMO_EMAILS === 'true') {
    setTimeout(() => { (window as any).loadSampleEmails(); }, 100);
  }
}

// Initialize getStoreState function for use in helper functions
getStoreState = () => useEmailStore.getState();
// DISABLED - Not needed since helper functions are disabled
// getStore = () => useEmailStore.getState();
// setStore = (fn: (state: any) => any) => useEmailStore.setState(fn);