import { create } from 'zustand';
import { fetchGmailEmails, convertGmailEmailToApp } from '@/api/gmail';
import { useAuthStore } from '@/stores/authStore';
import { serverURL } from '@/api/emails';
import { analyzeEmail as analyzeEmailClaude, summarizeEmail as summarizeEmailClaude } from '@/api/claude';

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
let batchTimeout: NodeJS.Timeout | null = null;
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
  reminderCheckInterval: NodeJS.Timeout | null;  // Interval for reminder checks

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

// Track which emails are being processed (for both summary and reply)
let processingEmails = new Set<string>();
// Process only one email at a time for better control
const MAX_CONCURRENT_AI_OPERATIONS = 1;
let activeAIOperations = 0;
let aiOperationQueue: Array<() => void> = [];

// Queue an AI operation to limit concurrency
function queueAIOperation(operation: () => Promise<void>) {
  aiOperationQueue.push(operation);
  processAIQueueHelper();
}

// Process the AI operation queue
async function processAIQueueHelper() {
  if (activeAIOperations >= MAX_CONCURRENT_AI_OPERATIONS || aiOperationQueue.length === 0) {
    return;
  }

  const operation = aiOperationQueue.shift();
  if (operation) {
    activeAIOperations++;
    // Don't await - let it run in the background
    operation().finally(() => {
      activeAIOperations--;
      processAIQueueHelper();
    });
  }
}

// Generate summary for a single email via Tauri/Claude (bypasses Python server)
const MAX_SUMMARY_RETRIES = 2;

// TEMPORARILY DISABLED TO TEST STORE INITIALIZATION
// async function generateSummaryForEmail(emailId: string, attempt = 0): Promise<void> { ... }

// TEMPORARILY DISABLED TO TEST STORE INITIALIZATION
// async function generateQuestionsForEmail(emailId: string): Promise<void> { ... }

// TEMPORARILY DISABLED TO TEST STORE INITIALIZATION
// async function generateReplyForEmail(emailId: string): Promise<void> { ... }

// TEMPORARILY DISABLED TO TEST STORE INITIALIZATION
// async function classifyEmailPriority(emailId: string): Promise<void> { ... }

// TEMPORARILY DISABLED TO TEST STORE INITIALIZATION
// async function processEmailCore(emailId: string) { ... }

// TEMPORARILY DISABLED TO TEST STORE INITIALIZATION
// function processEmail(emailId: string) { ... }

// TEMPORARILY DISABLED TO TEST STORE INITIALIZATION
// function processEmailImmediately(emailId: string) { ... }

// TEMPORARILY DISABLED TO TEST STORE INITIALIZATION
// function backfillQuestionData(emailIds: string[]) { ... }

// TEMPORARILY DISABLED TO TEST STORE INITIALIZATION
// function processMultipleEmails(emailIds: string[]) { ... }

// Persist emails to disk (fire-and-forget, non-blocking)
async function persistEmailsToDisk() {
  try {
    const state = getStoreState();
    // Don't persist empty state — would overwrite good cached data
    if (state.emails.length === 0 && state.sentEmails.length === 0) return;

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
        // First Gmail fetch: get all recent inbox emails (including read). Subsequent: only new since app opened
        const query = isFirstGmailFetch
          ? 'in:inbox'
          : `in:inbox after:${Math.floor(get().appStartTime / 1000)}`;
        // Send known email IDs so server can skip re-fetching them
        const knownIds = get().emails.map(e => e.id).join(',');
        const knownParam = knownIds ? `&knownIds=${encodeURIComponent(knownIds)}` : '';
        const response = await fetch(`${baseURL}/emails?q=${encodeURIComponent(query)}&maxResults=50${knownParam}`, {
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
          requires_reply: !email.isRead && !email.from?.toLowerCase().includes('me'),
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

        // Persist to disk in background
        persistEmailsToDisk();

        // Mark as initialized and fetched
        set({ hasInitialized: true, hasFetchedFromGmail: true });

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

        // Fetch emails directly from Gmail API
        const fallbackQuery = isFirstGmailFetch
          ? 'in:inbox'
          : `in:inbox after:${Math.floor(get().appStartTime / 1000)}`;
        const emailResponse = await fetchGmailEmails(accessToken, 50, fallbackQuery);

        if (!emailResponse.success) {
          throw new Error(emailResponse.error || 'Failed to fetch emails');
        }

        // Convert Gmail emails to app format and merge with existing
        const newEmails = emailResponse.emails.map(convertGmailEmailToApp);
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

        // Persist to disk in background
        persistEmailsToDisk();

        // Mark as initialized and fetched
        set({ hasInitialized: true, hasFetchedFromGmail: true });

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
    if (email && !email.is_read) {
      get().markAsRead(email.id);
    }
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
    set((state) => ({
      emails: state.emails.map(e => {
        if (e.id !== emailId) return e;
        // Downgrade Urgent → Normal so it moves down in importance sort
        const category = e.category === 'Urgent' ? 'Normal' as const : e.category;
        return { ...e, attention_dismissed: true, category };
      }),
    }));
    persistEmailsToDisk();
  },

  classifyEmail: async (emailId) => {
    try {
      const email = get().emails.find(e => e.id === emailId);
      if (!email) return;

      // Simple classification logic for now
      // TODO: Implement AI classification via backend
      const subject = email.subject.toLowerCase();
      const body = email.body_text.toLowerCase();

      let category: Email['category'] = 'Normal';
      let requires_reply = false;

      // Simple classification rules
      if (subject.includes('urgent') || body.includes('urgent')) {
        category = 'Urgent';
        requires_reply = true;
      } else if (subject.includes('important') || email.from.includes('boss') || email.from.includes('manager')) {
        category = 'Important';
        requires_reply = true;
      } else if (subject.includes('newsletter') || subject.includes('promotion')) {
        category = 'Low';
      }

      // Update local state
      set((state) => ({
        emails: state.emails.map(e =>
          e.id === emailId
            ? {
                ...e,
                category,
                requires_reply,
              }
            : e
        ),
        selectedEmail: state.selectedEmail?.id === emailId
          ? {
              ...state.selectedEmail,
              category,
              requires_reply,
            }
          : state.selectedEmail,
      }));
    } catch (error) {
      console.error('Failed to classify email:', error);
    }
  },

  generateReply: async (emailId) => {
    try {
      const email = get().emails.find(e => e.id === emailId);
      if (!email) return;

      // Get user's name for sign-off
      const authStore = useAuthStore.getState();
      const userName = authStore.user?.name || 'Your Name';

      // Simple reply generation for now
      // TODO: Implement AI reply generation via backend
      const senderName = email.sender.split('<')[0].trim() || 'there';
      const generatedReply = `Dear ${senderName},\n\nThank you for your email. I have received your message and will respond as soon as possible.\n\nBest regards,\n${userName}`;

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
      }));
      persistEmailsToDisk();

      // Schedule a reminder if this is a reply (has inReplyTo)
      if (inReplyTo) {
        get().scheduleReplyReminder(sentEmail.id, inReplyTo, 3); // 3 days default
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
      default:
        filtered = emails;
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
    const now = new Date();
    const fourDaysAgo = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);

    const mockWaitingEmails: Email[] = [
      {
        id: 'waiting-sent-1',
        gmail_id: 'waiting-sent-1',
        thread_id: 'thread-waiting-1',
        subject: 'Re: Project Proposal - Next Steps',
        sender: 'me@example.com',
        recipients: 'john@company.com',
        date: fourDaysAgo.toISOString(),
        body_text: 'Hi John,\n\nThanks for the call earlier. Per our discussion, I\'ll send over the revised proposal by end of week.\n\nBest,\nNoah',
        snippet: 'Thanks for the call earlier. Per our discussion...',
        is_read: true,
        is_starred: false,
        has_attachments: false,
        status: 'Replied',
        category: 'Normal',
        requires_reply: false,
        inReplyTo: 'original-1',
        // Reminder fields - this one is OVERDUE (4 days ago, 3 day reminder)
        waiting_on_reply_since: fourDaysAgo.toISOString(),
        reminder_due_date: new Date(fourDaysAgo.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        reminder_triggered: false,
        reminder_count: 0,
        // Mark if this needs follow-up (based on original email requiring reply)
        needs_follow_up: true,
        originalEmail: {
          id: 'original-1',
          gmail_id: 'original-1',
          thread_id: 'thread-waiting-1',
          subject: 'Project Proposal - Next Steps',
          sender: 'john@company.com',
          recipients: 'me@example.com',
          date: fourDaysAgo.toISOString(),
          body_text: 'Hi Noah,\n\nGreat chatting with you! Looking forward to seeing the revised proposal.\n\nBest,\nJohn',
          snippet: 'Great chatting with you! Looking forward...',
          is_read: true,
          is_starred: false,
          has_attachments: false,
          status: 'Replied',
          category: 'Normal',
          requires_reply: true,
        } as Email,
      },
      {
        id: 'waiting-sent-2',
        gmail_id: 'waiting-sent-2',
        thread_id: 'thread-waiting-2',
        subject: 'Re: Invoice #INV-2024-089',
        sender: 'me@example.com',
        recipients: 'billing@vendor.com',
        date: twoDaysAgo.toISOString(),
        body_text: 'Hi,\n\nPlease find attached the payment details for Invoice #INV-2024-089. Let me know if you need anything else.\n\nThanks,\nNoah',
        snippet: 'Please find attached the payment details...',
        is_read: true,
        is_starred: false,
        has_attachments: true,
        attachments: [
          {
            id: 'att-inv-2024-089',
            filename: 'INV-2024-089_Payment_Details.pdf',
            mimeType: 'application/pdf',
            size: 245760, // ~240KB
          }
        ],
        status: 'Replied',
        category: 'Normal',
        requires_reply: false,
        inReplyTo: 'original-2',
        // Reminder fields - this one is NOT due yet (2 days ago, 3 day reminder)
        waiting_on_reply_since: twoDaysAgo.toISOString(),
        reminder_due_date: new Date(twoDaysAgo.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        reminder_triggered: false,
        reminder_count: 0,
        needs_follow_up: true,
        originalEmail: {
          id: 'original-2',
          gmail_id: 'original-2',
          thread_id: 'thread-waiting-2',
          subject: 'Invoice #INV-2024-089',
          sender: 'billing@vendor.com',
          recipients: 'me@example.com',
          date: twoDaysAgo.toISOString(),
          body_text: 'Dear Noah,\n\nPlease find attached Invoice #INV-2024-089 for $2,500. Payment is due within 30 days.\n\nBest regards,\nBilling Department',
          snippet: 'Please find attached Invoice #INV-2024-089...',
          is_read: true,
          is_starred: false,
          has_attachments: true,
          attachments: [
            {
              id: 'att-inv-2024-089-original',
              filename: 'INV-2024-089.pdf',
              mimeType: 'application/pdf',
              size: 125829, // ~123KB
            }
          ],
          status: 'Replied',
          category: 'Important',
          requires_reply: true,
        } as Email,
      },
      {
        id: 'waiting-sent-3',
        gmail_id: 'waiting-sent-3',
        thread_id: 'thread-waiting-3',
        subject: 'Re: Conference Sponsorship Opportunity',
        sender: 'me@example.com',
        recipients: 'events@techconf.com',
        date: oneDayAgo.toISOString(),
        body_text: 'Hi Sarah,\n\nYes, we\'re interested in the Gold sponsorship package. Please send over the contract.\n\nBest regards,\nNoah',
        snippet: 'Yes, we\'re interested in the Gold sponsorship...',
        is_read: true,
        is_starred: false,
        has_attachments: false,
        status: 'Replied',
        category: 'Normal',
        requires_reply: false,
        inReplyTo: 'original-3',
        // Reminder fields - this one was just sent yesterday (1 day ago, 3 day reminder)
        waiting_on_reply_since: oneDayAgo.toISOString(),
        reminder_due_date: new Date(oneDayAgo.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        reminder_triggered: false,
        reminder_count: 0,
        needs_follow_up: true,
        originalEmail: {
          id: 'original-3',
          gmail_id: 'original-3',
          thread_id: 'thread-waiting-3',
          subject: 'Conference Sponsorship Opportunity',
          sender: 'events@techconf.com',
          recipients: 'me@example.com',
          date: oneDayAgo.toISOString(),
          body_text: 'Hi Noah,\n\nI hope this email finds you well. We\'d love to have your company as a sponsor for our upcoming TechConf 2024.\n\nWould you be interested in discussing sponsorship opportunities?\n\nBest,\nSarah\nEvents Coordinator',
          snippet: 'I hope this email finds you well...',
          is_read: true,
          is_starred: false,
          has_attachments: false,
          status: 'Replied',
          category: 'Important',
          requires_reply: true,
        } as Email,
      },
    ];

    // Add to pending reminders for the overdue one
    const pendingReminders = new Set(get().pendingReminders);
    pendingReminders.add('waiting-sent-1'); // This one is overdue

    set({
      sentEmails: [...get().sentEmails, ...mockWaitingEmails],
      pendingReminders,
    });

    console.log('[Mock Data] Added', mockWaitingEmails.length, 'waiting-on-reply emails');
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
      // Thread 1: Meeting Request (3 emails back and forth)
      {
        id: `sample-1`,
        gmail_id: `sample-1`,
        thread_id: `${baseThreadId}1`,
        subject: 'Q4 Planning Meeting - Tuesday 3pm',
        sender: 'Sarah Chen <schen@company.com>',
        recipients: 'me@company.com, team@company.com',
        date: new Date(baseTime - 1000 * 60 * 2).toISOString(), // 2 minutes ago
        body_text: 'Hi team, let\'s sync on Q4 planning this Tuesday at 3pm. Please bring your roadmap updates.',
        snippet: 'Hi team, let\'s sync on Q4 planning this Tuesday at 3pm...',
        is_read: false,
        is_starred: false,
        has_attachments: true,
        status: 'Unhandled',
        category: 'Urgent',
        summary: 'Sarah is proposing a Q4 planning meeting for Tuesday at 3pm',
        key_points: ['Meeting proposed for Tuesday 3pm', 'Bring roadmap updates'],
        action_items: ['RSVP to meeting', 'Prepare roadmap updates'],
        requires_reply: true,
        attachments: [{ id: 'att1', filename: 'Q4_Roadmap_Draft.pdf', mimeType: 'application/pdf', size: 2400000 }],
      },
      {
        id: `sample-2`,
        gmail_id: `sample-2`,
        thread_id: `${baseThreadId}1`,
        subject: 'Re: Q4 Planning Meeting - Tuesday 3pm',
        sender: 'Me <me@company.com>',
        recipients: 'schen@company.com, team@company.com',
        date: new Date(baseTime - 1000 * 60 * 1.5).toISOString(), // 90 seconds ago
        body_text: 'Sounds good! I\'ll have the product roadmap ready.',
        snippet: 'Sounds good! I\'ll have the product roadmap ready.',
        is_read: true,
        is_starred: false,
        has_attachments: false,
        status: 'Replied',
        category: 'Normal',
        summary: 'You confirmed attendance',
        key_points: ['Confirmed attendance', 'Will bring product roadmap'],
        action_items: [],
        requires_reply: false,
      },
      {
        id: `sample-3`,
        gmail_id: `sample-3`,
        thread_id: `${baseThreadId}1`,
        subject: 'Re: Q4 Planning Meeting - Tuesday 3pm',
        sender: 'Sarah Chen <schen@company.com>',
        recipients: 'me@company.com, team@company.com',
        date: new Date(baseTime - 1000 * 60 * 1).toISOString(), // 1 minute ago
        body_text: 'Great! I\'ve sent a calendar invite. See you there.',
        snippet: 'Great! I\'ve sent a calendar invite. See you there.',
        is_read: false,
        is_starred: false,
        has_attachments: false,
        status: 'Unhandled',
        category: 'Normal',
        summary: 'Sarah sent a calendar invite',
        key_points: ['Calendar invite sent'],
        action_items: ['Accept calendar invite'],
        requires_reply: false,
      },

      // Thread 2: Shipping Updates (2 emails)
      {
        id: `sample-4`,
        gmail_id: `sample-4`,
        thread_id: `${baseThreadId}2`,
        subject: 'Your order has shipped! 📦',
        sender: 'Amazon Shipping <ship-confirm@amazon.com>',
        recipients: 'me@gmail.com',
        date: new Date(baseTime - 1000 * 50).toISOString(), // 50 seconds ago
        body_text: 'Your Amazon order is on its way! Track your package for delivery estimated tomorrow.',
        snippet: 'Your Amazon order is on its way! Track your package...',
        is_read: false,
        is_starred: false,
        has_attachments: false,
        status: 'Unhandled',
        category: 'Low',
        summary: 'Amazon shipping notification for package delivery',
        key_points: ['Package shipped', 'Delivery expected tomorrow'],
        action_items: [],
        requires_reply: false,
      },
      {
        id: `sample-5`,
        gmail_id: `sample-5`,
        thread_id: `${baseThreadId}2`,
        subject: 'Re: Your order has shipped! 📦',
        sender: 'Amazon Shipping <ship-confirm@amazon.com>',
        recipients: 'me@gmail.com',
        date: new Date(baseTime - 1000 * 30).toISOString(), // 30 seconds ago
        body_text: 'Your package is out for delivery and will arrive by 8pm today.',
        snippet: 'Your package is out for delivery and will arrive by 8pm today.',
        is_read: false,
        is_starred: false,
        has_attachments: false,
        status: 'Unhandled',
        category: 'Low',
        summary: 'Package is out for delivery today by 8pm',
        key_points: ['Out for delivery', 'Expected by 8pm'],
        action_items: [],
        requires_reply: false,
      },

      // Thread 3: Newsletter
      {
        id: `sample-6`,
        gmail_id: `sample-6`,
        thread_id: `${baseThreadId}3`,
        subject: 'Weekly Tech Digest: AI Breakthroughs This Week',
        sender: 'Tech Newsletter <digest@technewsletter.com>',
        recipients: 'me@gmail.com',
        date: new Date(baseTime - 1000 * 25).toISOString(), // 25 seconds ago
        body_text: 'This week in AI: New models, exciting research, and industry news. Unsubscribe to stop receiving these emails.',
        snippet: 'This week in AI: New models, exciting research...',
        is_read: true,
        is_starred: false,
        has_attachments: false,
        status: 'Unhandled',
        category: 'Low',
        summary: 'Weekly tech newsletter about AI developments',
        key_points: ['AI model updates', 'Industry news roundup'],
        action_items: [],
        requires_reply: false,
      },

      // Thread 4: Finance/Invoice (4 emails in thread)
      {
        id: `sample-7`,
        gmail_id: `sample-7`,
        thread_id: `${baseThreadId}4`,
        subject: 'Invoice #12345 - October Services',
        sender: 'Billing <billing@saas-tool.com>',
        recipients: 'me@company.com',
        date: new Date(baseTime - 1000 * 60 * 3).toISOString(), // 3 minutes ago
        body_text: 'Please find attached invoice for October services. Amount: $299.00',
        snippet: 'Please find attached invoice for October services. Amount: $299.00',
        is_read: false,
        is_starred: false,
        has_attachments: true,
        status: 'Unhandled',
        category: 'Important',
        summary: 'Invoice for October services - $299',
        key_points: ['Invoice #12345', 'Amount: $299', 'October services'],
        action_items: ['Review invoice', 'Process payment'],
        requires_reply: false,
        attachments: [{ id: 'att2', filename: 'Invoice_12345.pdf', mimeType: 'application/pdf', size: 159744 }],
      },
      {
        id: `sample-8`,
        gmail_id: `sample-8`,
        thread_id: `${baseThreadId}4`,
        subject: 'Re: Invoice #12345 - October Services',
        sender: 'Me <me@company.com>',
        recipients: 'billing@saas-tool.com',
        date: new Date(baseTime - 1000 * 60 * 2.5).toISOString(), // 2.5 minutes ago
        body_text: 'Thanks, can you clarify line item 3?',
        snippet: 'Thanks, can you clarify line item 3?',
        is_read: true,
        is_starred: false,
        has_attachments: false,
        status: 'Replied',
        category: 'Normal',
        summary: 'You asked for clarification on line item 3',
        key_points: ['Question about line item 3'],
        action_items: [],
        requires_reply: false,
      },
      {
        id: `sample-9`,
        gmail_id: `sample-9`,
        thread_id: `${baseThreadId}4`,
        subject: 'Re: Invoice #12345 - October Services',
        sender: 'Billing <billing@saas-tool.com>',
        recipients: 'me@company.com',
        date: new Date(baseTime - 1000 * 60 * 2).toISOString(), // 2 minutes ago
        body_text: 'Line item 3 is for the additional storage add-on you requested.',
        snippet: 'Line item 3 is for the additional storage add-on you requested.',
        is_read: true,
        is_starred: false,
        has_attachments: false,
        status: 'Unhandled',
        category: 'Normal',
        summary: 'Billing clarified line item 3 is for storage add-on',
        key_points: ['Line item 3 = storage add-on'],
        action_items: [],
        requires_reply: false,
      },
      {
        id: `sample-10`,
        gmail_id: `sample-10`,
        thread_id: `${baseThreadId}4`,
        subject: 'Re: Invoice #12345 - October Services',
        sender: 'Me <me@company.com>',
        recipients: 'billing@saas-tool.com',
        date: new Date(baseTime - 1000 * 60 * 1.5).toISOString(), // 90 seconds ago
        body_text: 'Got it, thanks for the clarification. Payment scheduled.',
        snippet: 'Got it, thanks for the clarification. Payment scheduled.',
        is_read: true,
        is_starred: false,
        has_attachments: false,
        status: 'Replied',
        category: 'Normal',
        summary: 'You acknowledged and scheduled payment',
        key_points: ['Payment scheduled'],
        action_items: [],
        requires_reply: false,
      },

      // Thread 5: Meeting invite from Zoom
      {
        id: `sample-11`,
        gmail_id: `sample-11`,
        thread_id: `${baseThreadId}5`,
        subject: 'Invitation: Product Review with Alex',
        sender: 'Zoom <noreply@zoom.us>',
        recipients: 'me@company.com',
        date: new Date(baseTime - 1000 * 15).toISOString(), // 15 seconds ago
        body_text: 'You are invited to a Zoom meeting: Product Review with Alex. Thursday, Nov 7, 2024 2:00 PM',
        snippet: 'You are invited to a Zoom meeting: Product Review with Alex...',
        is_read: false,
        is_starred: true,
        has_attachments: true,
        status: 'Unhandled',
        category: 'Urgent',
        summary: 'Zoom meeting invite for Product Review with Alex on Thursday',
        key_points: ['Thursday Nov 7 at 2pm', 'Product Review', 'With Alex'],
        action_items: ['Accept meeting invitation'],
        requires_reply: true,
        attachments: [{ id: 'att3', filename: 'meeting.ics', mimeType: 'text/calendar', size: 2048 }],
      },

      // Thread 6: Social media updates
      {
        id: `sample-12`,
        gmail_id: `sample-12`,
        thread_id: `${baseThreadId}6`,
        subject: 'You have 5 new followers on LinkedIn!',
        sender: 'LinkedIn <notifications-noreply@linkedin.com>',
        recipients: 'me@gmail.com',
        date: new Date(baseTime - 1000 * 10).toISOString(), // 10 seconds ago
        body_text: 'See who\'s viewing your profile and connect with new people in your industry.',
        snippet: 'See who\'s viewing your profile and connect with new people...',
        is_read: true,
        is_starred: false,
        has_attachments: false,
        status: 'Unhandled',
        category: 'Low',
        summary: 'LinkedIn notification about new followers',
        key_points: ['5 new followers'],
        action_items: [],
        requires_reply: false,
      },

      // Thread 7: Work discussion (3 emails)
      {
        id: `sample-13`,
        gmail_id: `sample-13`,
        thread_id: `${baseThreadId}7`,
        subject: 'API Integration Question',
        sender: 'Mike Johnson <mjohnson@partner.com>',
        recipients: 'me@company.com',
        date: new Date(baseTime - 1000 * 60 * 1.2).toISOString(), // 72 seconds ago
        body_text: 'Hey, we\'re having trouble with the API integration. The auth token seems to expire after 1 hour.',
        snippet: 'Hey, we\'re having trouble with the API integration...',
        is_read: false,
        is_starred: false,
        has_attachments: false,
        status: 'Unhandled',
        category: 'Important',
        summary: 'Mike is reporting an API integration issue with auth tokens',
        key_points: ['Auth token expires after 1 hour', 'API integration problem'],
        action_items: ['Investigate auth token expiry', 'Respond to Mike'],
        requires_reply: true,
      },
      {
        id: `sample-14`,
        gmail_id: `sample-14`,
        thread_id: `${baseThreadId}7`,
        subject: 'Re: API Integration Question',
        sender: 'Me <me@company.com>',
        recipients: 'mjohnson@partner.com',
        date: new Date(baseTime - 1000 * 50).toISOString(), // 50 seconds ago
        body_text: 'Sorry to hear that. Can you share your request headers? We\'ll look into it.',
        snippet: 'Sorry to hear that. Can you share your request headers?...',
        is_read: true,
        is_starred: false,
        has_attachments: false,
        status: 'Replied',
        category: 'Normal',
        summary: 'You asked for request headers to debug',
        key_points: ['Asked for request headers'],
        action_items: [],
        requires_reply: false,
      },
      {
        id: `sample-15`,
        gmail_id: `sample-15`,
        thread_id: `${baseThreadId}7`,
        subject: 'Re: API Integration Question',
        sender: 'Mike Johnson <mjohnson@partner.com>',
        recipients: 'me@company.com',
        date: new Date(baseTime - 1000 * 25).toISOString(), // 25 seconds ago
        body_text: 'Here are the headers. Let me know if you need anything else!',
        snippet: 'Here are the headers. Let me know if you need anything else!',
        is_read: false,
        is_starred: false,
        has_attachments: false,
        status: 'Unhandled',
        category: 'Important',
        summary: 'Mike shared the request headers',
        key_points: ['Headers shared', 'Waiting for fix'],
        action_items: ['Debug with provided headers'],
        requires_reply: true,
      },

      // Thread 8: Another shipping update
      {
        id: `sample-16`,
        gmail_id: `sample-16`,
        thread_id: `${baseThreadId}8`,
        subject: 'Delivery Update: Your package from Etsy',
        sender: 'Etsy Shipping <shipping@etsy.com>',
        recipients: 'me@gmail.com',
        date: new Date(baseTime - 1000 * 5).toISOString(), // 5 seconds ago
        body_text: 'Good news! Your handmade item has been shipped and will arrive in 3-5 business days.',
        snippet: 'Good news! Your handmade item has been shipped...',
        is_read: false,
        is_starred: false,
        has_attachments: false,
        status: 'Unhandled',
        category: 'Low',
        summary: 'Etsy shipping notification - 3-5 business days',
        key_points: ['Handmade item shipped', '3-5 business days delivery'],
        action_items: [],
        requires_reply: false,
      },

      // Thread 9: Test email for improved question generation - choices without meeting
      {
        id: `sample-17`,
        gmail_id: `sample-17`,
        thread_id: `${baseThreadId}9`,
        subject: 'Team lunch this Friday - pick your spot!',
        sender: 'Jamie <jamie@company.com>',
        recipients: 'me@company.com, team@company.com',
        date: new Date(baseTime - 1000 * 60 * 0.5).toISOString(), // 30 seconds ago
        body_text: `Hey team! We're doing team lunch this Friday to celebrate the launch.

We're deciding between:
- Pizza from Joe's (classic choice)
- Burgers from Shake Shack
- Tacos from the new place downtown
- Salads from Sweetgreen

Can you make it? And what's your preference? Let me know by end of day!

Also, are you cool with splitting the check evenly?`,
        snippet: 'Hey team! Team lunch this Friday - choosing between pizza, burgers...',
        is_read: false,
        is_starred: false,
        has_attachments: false,
        status: 'Unhandled',
        category: 'Important',
        summary: 'Jamie is organizing a team lunch for Friday and needs your preference',
        key_points: ['Team lunch Friday to celebrate launch', 'Choosing restaurant: pizza, burgers, tacos, or salads', 'RSVP and food preference needed by EOD'],
        action_items: ['Confirm attendance', 'Choose restaurant preference'],
        requires_reply: true,
      },

      // Thread 10: Test email - text input question (specific info AI can't know)
      {
        id: `sample-18`,
        gmail_id: `sample-18`,
        thread_id: `${baseThreadId}10`,
        subject: 'Shipping address for your gift',
        sender: 'HR <hr@company.com>',
        recipients: 'me@company.com',
        date: new Date(baseTime - 1000 * 20).toISOString(), // 20 seconds ago
        body_text: `Hi! As part of our employee appreciation program, we're sending you a gift card.

Please confirm which address you'd like us to ship it to:
- Home address
- Office address

If home, please reply with your current shipping address.

Thanks!
HR Team`,
        snippet: 'Employee appreciation gift - please confirm shipping address...',
        is_read: false,
        is_starred: false,
        has_attachments: false,
        status: 'Unhandled',
        category: 'Normal',
        summary: 'HR is sending a gift card and needs your shipping address preference',
        key_points: ['Employee appreciation gift', 'Need to choose home or office address', 'Home address requires specific details'],
        action_items: ['Choose shipping location', 'Provide address if home'],
        requires_reply: true,
      },

      // Thread 11: Test email - AI should SKIP (optional/casual question)
      {
        id: `sample-19`,
        gmail_id: `sample-19`,
        thread_id: `${baseThreadId}11`,
        subject: 'Hope you had a great weekend!',
        sender: 'Alex <alex@company.com>',
        recipients: 'me@company.com',
        date: new Date(baseTime - 1000 * 18).toISOString(), // 18 seconds ago
        body_text: `Hey!

Just wanted to say hi and see how you're doing. How was your weekend? Do anything fun?

Let's catch up soon!

Alex`,
        snippet: 'Just wanted to say hi and see how you\'re doing...',
        is_read: false,
        is_starred: false,
        has_attachments: false,
        status: 'Unhandled',
        category: 'Normal',
        summary: 'Casual check-in from Alex',
        key_points: ['Saying hi', 'Asking about weekend'],
        action_items: [],
        requires_reply: false,
      },

      // Thread 12: Test email - AI should SKIP meeting timing (handled by calendar)
      {
        id: `sample-20`,
        gmail_id: `sample-20`,
        thread_id: `${baseThreadId}12`,
        subject: 'Quick sync needed - when are you free?',
        sender: 'Taylor <taylor@company.com>',
        recipients: 'me@company.com',
        date: new Date(baseTime - 1000 * 12).toISOString(), // 12 seconds ago
        body_text: `Hey!

Need to sync with you on the project roadmap. When are you free this week?

I'm flexible Monday afternoon, Tuesday morning, or Wednesday after 2pm. Let me know what works!

Taylor`,
        snippet: 'Need to sync on project roadmap - when are you free this week?',
        is_read: false,
        is_starred: false,
        has_attachments: false,
        status: 'Unhandled',
        category: 'Important',
        summary: 'Taylor wants to sync on the project roadmap and has proposed some times',
        key_points: ['Project roadmap sync needed', 'Proposed: Mon afternoon, Tue morning, Wed after 2pm'],
        action_items: [],
        requires_reply: true,
        meeting_request: {
          is_meeting: true,
          proposed_times: ['Monday afternoon', 'Tuesday morning', 'Wednesday after 2pm'],
          duration_minutes: 30,
          subject: 'Project roadmap sync',
        },
      },

      // Thread 13: Test email - attachment request (resume, transcript, portfolio)
      {
        id: `sample-21`,
        gmail_id: `sample-21`,
        thread_id: `${baseThreadId}13`,
        subject: 'Application for Software Engineer Position',
        sender: 'Recruiting <recruiting@techcorp.com>',
        recipients: 'me@company.com',
        date: new Date(baseTime - 1000 * 8).toISOString(), // 8 seconds ago
        body_text: `Hi,

Thank you for applying for the Software Engineer position at TechCorp.

We've reviewed your application and are interested in moving forward. Could you please send us the following documents:

1. Your resume (PDF format preferred)
2. Your academic transcript (unofficial is fine to start)
3. Your portfolio or GitHub profile link

Also, please let us know your availability for an initial technical interview this week or next.

Best regards,
Sarah Thompson
Technical Recruiter
TechCorp`,
        snippet: 'Application for Software Engineer position at TechCorp...',
        is_read: false,
        is_starred: false,
        has_attachments: false,
        status: 'Unhandled',
        category: 'Important',
        summary: 'Sarah from TechCorp recruiting is interested in your application and requests your resume, transcript, and portfolio for the next steps',
        key_points: ['TechCorp is interested in your application', 'Requesting: resume (PDF)', 'Requesting: academic transcript', 'Requesting: portfolio or GitHub', 'Availability needed for technical interview this week or next'],
        action_items: ['Send resume (PDF)', 'Send academic transcript', 'Send portfolio or GitHub link', 'Provide availability for interview'],
        requires_reply: true,
      },
      // Deadline email - application with upcoming deadline
      {
        id: `sample-22`,
        gmail_id: `sample-22`,
        thread_id: `${baseThreadId}14`,
        subject: 'Summer Research Fellowship - Application Deadline Approaching',
        sender: 'Dr. Emily Chen <emily.chen@stanford.edu>',
        recipients: 'me@company.com',
        date: new Date(baseTime - 1000 * 60 * 60 * 24 * 2).toISOString(), // 2 days ago
        body_text: `Hi,

I wanted to follow up on our conversation about the Summer Research Fellowship in AI/ML at Stanford. The application portal is now open and I'd love for you to apply.

Here are the key details:
- Application deadline: ${new Date(Date.now() + 1000 * 60 * 60 * 24 * 4).toISOString().split('T')[0]} (4 days from now)
- Duration: 10 weeks (June - August)
- Stipend: $8,000 + housing
- You'll need to submit a research proposal (2 pages max) and your CV

I think you'd be a great fit given your background in machine learning. Let me know if you have any questions about the program or need a recommendation letter.

Best,
Dr. Emily Chen
Associate Professor, Computer Science
Stanford University`,
        snippet: 'Summer Research Fellowship application deadline approaching...',
        is_read: false,
        is_starred: false,
        has_attachments: false,
        status: 'Unhandled',
        category: 'Important',
        summary: 'Dr. Chen is inviting you to apply for a Summer Research Fellowship at Stanford with a deadline in 4 days',
        key_points: ['Summer Research Fellowship in AI/ML at Stanford', 'Application deadline in 4 days', 'Stipend: $8,000 + housing', 'Need research proposal (2 pages) and CV'],
        action_items: ['Submit application before deadline', 'Prepare 2-page research proposal', 'Update CV', 'Consider asking for recommendation letter'],
        requires_reply: true,
      },
    ];

    // Set the sample emails in the store
    getStoreState().setEmails(sampleEmails);

    // Set up the question data for the sample emails
    if (!(window as any).emailQuestionData) {
      (window as any).emailQuestionData = new Map();
    }
    const questionData = (window as any).emailQuestionData;

    sampleEmails.forEach(email => {
      // For test emails, set up specific question data to test the improved prompt
      let questions = [];
      if (email.id === 'sample-17') {
        // Team lunch - should have choice questions
        questions = [
          { type: 'choice', question: 'Can you make it to team lunch?', options: ['Yes', 'No'] },
          { type: 'choice', question: 'What\'s your restaurant preference?', options: ['Pizza from Joe\'s', 'Burgers from Shake Shack', 'Tacos from new place', 'Salads from Sweetgreen'] },
          { type: 'choice', question: 'Are you cool with splitting the check evenly?', options: ['Yes', 'No'] },
        ];
      } else if (email.id === 'sample-18') {
        // Gift card - should have choice + text question
        questions = [
          { type: 'choice', question: 'Which address should we ship to?', options: ['Home address', 'Office address'] },
          { type: 'text', question: 'What is your shipping address?', options: [] },
        ];
      } else if (email.id === 'sample-19') {
        // Casual weekend - should have NO questions (AI can handle)
        questions = [];
      } else if (email.id === 'sample-20') {
        // Meeting sync - should have NO questions (timing handled by calendar, but meeting_request is set)
        questions = [];
      } else if (email.id === 'sample-21') {
        // Attachment request - should trigger attachment suggestions
        questions = [
          { type: 'choice', question: 'Do you have your resume ready to send?', options: ['Yes, I\'ll attach it', 'I need to update it first', 'I\'ll send it separately'] },
          { type: 'choice', question: 'Should we also include your transcript and portfolio?', options: ['Yes, all documents', 'Resume and transcript only', 'I\'ll send portfolio separately'] },
          { type: 'text', question: 'What is your availability for an interview this week or next?', options: [] },
        ];
      } else if (email.id === 'sample-22') {
        // Deadline email - research fellowship
        questions = [
          { type: 'choice', question: 'Are you interested in applying for this fellowship?', options: ['Yes, I\'ll apply', 'Maybe, need more info', 'Not this time'] },
          { type: 'choice', question: 'Do you need a recommendation letter from Dr. Chen?', options: ['Yes please', 'No, I have one already', 'I\'ll ask someone else'] },
        ];
      } else {
        // Legacy emails - use action_items
        questions = email.action_items.map(a => ({ question: a, options: [], type: 'text' })) || [];
      }

      questionData.set(email.id, {
        questions,
        suggestedFormalityScore: 50,
        suggested_formality_score: 50,
        requiresReply: email.requires_reply || false,
        requires_reply: email.requires_reply || false,
        reply_reasoning: email.requires_reply ? 'This email requires a response' : 'FYI only',
        loaded: true,
        meetingRequest: email.meeting_request || (email.subject.includes('Meeting') || email.subject.includes('Invitation')
          ? { is_meeting: true, proposed_times: [] }
          : { is_meeting: false }),
        // Add attachment_requests for sample-21 (attachment request test email)
        attachment_requests: email.id === 'sample-21' ? [
          { keyword: 'resume', file_type: 'pdf', description: 'Please attach your resume (PDF format preferred)' },
          { keyword: 'transcript', file_type: 'pdf', description: 'Please attach your academic transcript' },
          { keyword: 'portfolio', file_type: null, description: 'Please attach your portfolio or provide GitHub link' },
        ] : [],
        // Add deadline for sample-22 (deadline test email)
        deadline: email.id === 'sample-22'
          ? new Date(Date.now() + 1000 * 60 * 60 * 24 * 4).toISOString().split('T')[0]
          : null,
      });
    });

    console.log(`✅ Loaded ${sampleEmails.length} sample emails for testing!`);
    console.log('Sample data includes:');
    console.log('  - Threaded conversations (try thread view!)');
    console.log('  - Meeting requests');
    console.log('  - Shipping updates');
    console.log('  - Newsletters');
    console.log('  - Finance/invoices');
    console.log('  - Social notifications');
    console.log('  - Attachment request emails (resume, transcript, portfolio)');
    console.log('  - Deadline email (Stanford research fellowship, due in 4 days)');
    console.log('  - QUESTION GENERATION TEST EMAILS:');
    console.log('    • "Team lunch this Friday" - Choice questions (4 restaurant options + yes/no)');
    console.log('    • "Shipping address for your gift" - Choice + text input questions');
    console.log('    • "Hope you had a great weekend!" - Should show NO questions (AI can handle)');
    console.log('    • "Quick sync needed" - Meeting request, no timing questions (calendar handles it)');
    console.log('    • "Application for Software Engineer" - Attachment suggestions (resume, transcript, portfolio)');
    console.log('');
    console.log('Try these views:');
    console.log('  - Click "Inbox" in sidebar for normal inbox view');
    console.log('  - Click "Threads" in sidebar for threaded view');
    console.log('  - Click "Smart Triage" for grouped batch actions');
    console.log('  - Click "Focus Mode" for action-required emails only');

    return sampleEmails.length;
  };

  (window as any).clearSampleEmails = () => {
    getStoreState().setEmails([]);
    console.log('✅ Cleared sample emails');
  };

  // Auto-load sample emails immediately (DEV MODE)
  setTimeout(() => {
    console.log('DEV MODE: Loading sample data for testing...');
    (window as any).loadSampleEmails();
  }, 100);

  // Also make the sample emails available to the global window object for easier debugging
  // and to ensure they populate the inbox properly
  // DISABLED: Using real data now
  // (window as any).ensureSampleEmailsInInbox = () => {
  //   const currentEmails = useEmailStore.getState().emails;
  //   if (currentEmails.length === 0) {
  //     console.log('No emails found, loading sample emails...');
  //     (window as any).loadSampleEmails();
  //   } else {
  //     console.log(`Already have ${currentEmails.length} emails in store`);
  //   }
  // };
}

// Initialize getStoreState function for use in helper functions
getStoreState = () => useEmailStore.getState();
// DISABLED - Not needed since helper functions are disabled
// getStore = () => useEmailStore.getState();
// setStore = (fn: (state: any) => any) => useEmailStore.setState(fn);