import { create } from 'zustand';
import { fetchGmailEmails, convertGmailEmailToApp } from '@/api/gmail';
import { useAuthStore } from '@/stores/authStore';
import { serverURL } from '@/api/emails';
import { analyzeEmail as analyzeEmailClaude } from '@/api/claude';

// Check if running in Tauri
const isTauri = typeof window !== 'undefined' && window.__TAURI_INTERNALS__;

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
}

export interface EmailAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
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
  hasInitialized: boolean;        // Whether initial fetch has completed
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

  // Actions
  fetchEmails: () => Promise<void>;
  selectEmail: (email: Email | null) => void;
  markAsRead: (emailId: string) => Promise<void>;
  markAsStarred: (emailId: string, starred: boolean) => Promise<void>;
  updateEmailStatus: (emailId: string, status: Email['status']) => Promise<void>;
  updateAttachmentAnalysis: (emailId: string, attachmentId: string, analysis: { summary: string; key_points: string[]; action_items: string[] }) => void;
  classifyEmail: (emailId: string) => Promise<void>;
  generateReply: (emailId: string) => Promise<void>;
  summarizeEmail: (emailId: string) => Promise<string | null>;
  sendEmail: (to: string, subject: string, body: string, inReplyTo?: string, originalEmailData?: Email) => Promise<void>;
  saveEmail: (emailId: string) => void;
  unsaveEmail: (emailId: string) => void;
  saveGeneratedReply: (emailId: string, reply: string) => void;
  sendEmailNotification: (emailId: string, summary: string, reply: string) => void;
  setSearchQuery: (query: string) => void;
  setCurrentFilter: (filter: EmailState['currentFilter']) => void;
  setSortMode: (sort: EmailState['sortMode']) => void;
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
}

// Track which emails are being processed (for both summary and reply)
let processingEmails = new Set<string>();
// Process only one email at a time for better control
const MAX_CONCURRENT_AI_OPERATIONS = 1;
let activeAIOperations = 0;
let aiOperationQueue: Array<() => void> = [];

// Queue an AI operation to limit concurrency
function queueAIOperation(operation: () => Promise<void>) {
  aiOperationQueue.push(operation);
  processAIQueue();
}

// Process the AI operation queue
async function processAIQueue() {
  if (activeAIOperations >= MAX_CONCURRENT_AI_OPERATIONS || aiOperationQueue.length === 0) {
    return;
  }

  const operation = aiOperationQueue.shift();
  if (operation) {
    activeAIOperations++;
    // Don't await - let it run in the background
    operation().finally(() => {
      activeAIOperations--;
      processAIQueue();
    });
  }
}

// Generate summary for a single email (fire and forget - updates store directly)
async function generateSummaryForEmail(emailId: string): Promise<void> {
  if (processingEmails.has(`${emailId}-summary`)) {
    return;
  }
  processingEmails.add(`${emailId}-summary`);

  try {
    const store = useEmailStore.getState();
    const email = store.emails.find(e => e.id === emailId);
    if (!email) {
      return;
    }
    if (email.summary) {
      return;
    }

    const baseURL = await serverURL();
    const response = await fetchWithTimeout(`${baseURL}/summarize`, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: email.sender,
        subject: email.subject,
        body_text: email.body_text,
        snippet: email.snippet,
      })
    }, 90000);

    if (response.ok) {
      const result = await response.json();
      if (result.success && result.summary) {
        // Update store with summary, key_points, and action_items
        useEmailStore.setState((state) => ({
          emails: state.emails.map(e =>
            e.id === emailId ? {
              ...e,
              summary: result.summary,
              key_points: result.key_points || [],
              action_items: result.action_items || []
            } : e
          ),
        }));

        // Send notification for new emails with summary
        // Only notify if we haven't notified before AND the email is recent (arrived after app start)
        const store = useEmailStore.getState();
        const emailTime = new Date(email.date).getTime();
        const shouldNotify = !store.notifiedEmailIds.has(emailId) &&
          (emailTime >= store.appStartTime);

        if (shouldNotify) {
          const senderName = email.sender.split('<')[0].trim() || email.sender;
          // Truncate summary if too long for notification
          const summaryText = result.summary.length > 150
            ? result.summary.substring(0, 147) + '...'
            : result.summary;

          // Check smart notification settings
          const notifCheck = await shouldSendNotification(
            email.sender,
            email.subject,
            email.category || 'Normal'
          );

          console.log(`[Smart Notifications] Check result:`, notifCheck);

          if (notifCheck.should_notify) {
            sendNotification(`New email from ${senderName}`, summaryText);
            useEmailStore.setState((state) => ({
              notifiedEmailIds: new Set(state.notifiedEmailIds).add(emailId),
            }));
          } else if (notifCheck.should_batch) {
            // Queue for batch notification
            queueNotification(emailId, senderName, email.subject, summaryText);
            console.log(`[Smart Notifications] Queued for batching: ${emailId}`);
          } else {
            console.log(`[Smart Notifications] Notification suppressed: ${notifCheck.reason}`);
          }
        }
      } else {
        console.log(`[AI Processing] Summary API returned no summary for ${emailId}:`, result);
      }
    } else {
      console.log(`[AI Processing] Summary API failed for ${emailId}:`, response.status);
    }
  } catch (e) {
    console.error('[AI Processing] Failed to generate summary:', e);
  } finally {
    processingEmails.delete(`${emailId}-summary`);
    // Remove from generatingSummaries set
    useEmailStore.setState((state) => {
      const newSet = new Set(state.generatingSummaries);
      newSet.delete(emailId);
      return { generatingSummaries: newSet };
    });
  }
}

// Generate questions for a single email (fire and forget - stores in emailStateMap via EmailView)
// This is called after summary generation completes
async function generateQuestionsForEmail(emailId: string): Promise<void> {
  if (processingEmails.has(`${emailId}-questions`)) {
    console.log(`[AI Processing] Questions already in progress for ${emailId}`);
    return;
  }
  processingEmails.add(`${emailId}-questions`);
  console.log(`[AI Processing] Starting question generation for ${emailId}`);

  try {
    const store = useEmailStore.getState();
    const email = store.emails.find(e => e.id === emailId);
    if (!email) {
      console.log(`[AI Processing] Email ${emailId} not found in store`);
      return;
    }

    // Try Claude API first (through Tauri), fall back to Python server
    let result: any;
    try {
      console.log(`[AI Processing] Trying Claude API for ${emailId}...`);
      const claudeResponse = await analyzeEmailClaude({
        sender: email.sender,
        subject: email.subject,
        body_text: email.body_text,
        has_attachments: email.has_attachments || false,
      });

      result = {
        success: true,
        questions: claudeResponse.questions,
        suggested_formality_score: claudeResponse.suggested_formality_score,
        meeting_request: claudeResponse.meeting_request,
        missing_attachment_warning: claudeResponse.missing_attachment_warning,
      };
      console.log(`[AI Processing] Claude API response for ${emailId}`);
    } catch (claudeError) {
      console.log(`[AI Processing] Claude API failed for ${emailId}, falling back to Python server:`, claudeError);
      // Fall back to Python server
      const baseURL = await serverURL();
      const response = await fetchWithTimeout(`${baseURL}/analyze-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender: email.sender,
          subject: email.subject,
          body_text: email.body_text,
        })
      }, 90000);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      result = await response.json();
    }

    if (result.success) {
      console.log(`[AI Processing] Questions generated for ${emailId}:`, result.questions);
      // Store questions in the email state map (accessed by EmailView)
      // We use a window global to share this data with EmailView component
      if (!(window as any).emailQuestionData) {
        (window as any).emailQuestionData = new Map();
      }
      // Handle both old categorical format and new score format
      let suggestedScore = 50; // default neutral
      if (result.suggested_formality_score !== undefined) {
        suggestedScore = result.suggested_formality_score;
      } else if (result.suggested_formality) {
        const categorical = result.suggested_formality;
        if (categorical === 'casual') suggestedScore = 20;
        else if (categorical === 'formal') suggestedScore = 80;
        else suggestedScore = 50;
      }
      (window as any).emailQuestionData.set(emailId, {
        questions: result.questions || [],
        suggestedFormalityScore: suggestedScore,
        requiresReply: result.requires_reply,
        replyReasoning: result.reply_reasoning,
        meetingRequest: result.meeting_request || { is_meeting: false },
        loaded: true,
      });
    } else {
      console.log(`[AI Processing] Question API returned no data for ${emailId}:`, result);
    }
  } catch (e) {
    console.error('[AI Processing] Failed to generate questions:', e);
  } finally {
    processingEmails.delete(`${emailId}-questions`);
  }
}

// Generate reply for a single email (fire and forget - updates store directly)
async function generateReplyForEmail(emailId: string): Promise<void> {
  if (processingEmails.has(`${emailId}-reply`)) {
    console.log(`[AI Processing] Reply already in progress for ${emailId}`);
    return;
  }
  processingEmails.add(`${emailId}-reply`);
  console.log(`[AI Processing] Starting reply generation for ${emailId}`);

  try {
    const store = useEmailStore.getState();
    const email = store.emails.find(e => e.id === emailId);
    if (!email) {
      console.log(`[AI Processing] Email ${emailId} not found in store`);
      return;
    }
    if (email.ai_generated_reply) {
      console.log(`[AI Processing] Email ${emailId} already has reply`);
      return;
    }

    console.log(`[AI Processing] Calling reply API for ${emailId}`);
    const baseURL = await serverURL();
    const response = await fetchWithTimeout(`${baseURL}/generate-reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: email.sender,
        subject: email.subject,
        body_text: email.body_text,
      }),
    }, 90000);

    if (response.ok) {
      const result = await response.json();
      if (result.success && result.reply) {
        console.log(`[AI Processing] Reply generated for ${emailId}`);

        // Strip unwanted prefixes like "Subject: Re:" from the reply
        let cleanedReply = result.reply;
        const unwantedPrefixes = ['Subject: Re:', 'Subject: RE:', 'Subject: Re', 'Subject: RE'];
        for (const prefix of unwantedPrefixes) {
          if (cleanedReply.startsWith(prefix)) {
            cleanedReply = cleanedReply.substring(prefix.length).trim();
            break;
          }
        }

        // Update store with reply
        useEmailStore.setState((state) => ({
          emails: state.emails.map(e =>
            e.id === emailId ? { ...e, ai_generated_reply: cleanedReply } : e
          ),
        }));
      } else {
        console.log(`[AI Processing] Reply API returned no reply for ${emailId}:`, result);
      }
    } else {
      console.log(`[AI Processing] Reply API failed for ${emailId}:`, response.status);
    }
  } catch (e) {
    console.error('[AI Processing] Failed to generate reply:', e);
  } finally {
    processingEmails.delete(`${emailId}-reply`);
    // Remove from generatingReplies set
    useEmailStore.setState((state) => {
      const newSet = new Set(state.generatingReplies);
      newSet.delete(emailId);
      return { generatingReplies: newSet };
    });
  }
}

// Process an email completely (summary + questions) - does the actual work, should be queued
async function processEmailCore(emailId: string) {
  // Generate summary first, then questions after summary completes
  useEmailStore.setState((state) => ({
    generatingSummaries: new Set(state.generatingSummaries).add(emailId)
  }));

  await generateSummaryForEmail(emailId);
  // After summary completes, process questions
  await generateQuestionsForEmail(emailId);

  // Remove from generating summaries
  useEmailStore.setState((state) => {
    const newSet = new Set(state.generatingSummaries);
    newSet.delete(emailId);
    return { generatingSummaries: newSet };
  });
}

// Process an email with queuing (for immediate processing)
function processEmail(emailId: string) {
  queueAIOperation(() => processEmailCore(emailId));
}

// Process a single email immediately (for when user clicks on an email)
function processEmailImmediately(emailId: string) {
  // Only process if not already being processed
  if (!processingEmails.has(`${emailId}-summary`)) {
    queueAIOperation(() => processEmailCore(emailId));
  }
}

// Process multiple emails - adds them to the queue for sequential processing
function processMultipleEmails(emailIds: string[]) {
  console.log('[AI Processing] Queuing emails for sequential processing:', emailIds);
  // Add all emails to the queue - they will be processed one at a time
  emailIds.forEach((emailId) => {
    queueAIOperation(() => processEmailCore(emailId));
  });
}

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

  fetchEmails: async () => {
    try {
      // Don't set isLoading for background refreshes - keeps UI stable
      set({ error: null });

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
        const response = await fetch(`${baseURL}/emails`, {
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

        // Preserve status, summary, key_points, action_items, and ai_generated_reply from existing emails
        const existingEmails = get().emails;
        const emails = newEmails.map((newEmail: Email) => {
          const existing = existingEmails.find(e => e.id === newEmail.id);
          if (existing) {
            // Preserve the status, summary, key_points, action_items, and ai_generated_reply from existing email
            return {
              ...newEmail,
              status: existing.status,
              summary: existing.summary || newEmail.summary,
              key_points: existing.key_points || newEmail.key_points,
              action_items: existing.action_items || newEmail.action_items,
              ai_generated_reply: existing.ai_generated_reply
            };
          }
          return newEmail;
        });

        set({ emails, isLoading: false });

        // Handle initial vs subsequent fetches
        const state = get();
        if (!state.hasInitialized) {
          // First fetch - track existing emails and process only RECENT ones without replies
          const initialIds = new Set(emails.map((e: Email) => e.id));
          set({ initialEmailIds: initialIds, hasInitialized: true });
          console.log(`[AI Processing] Initial fetch, found ${emails.length} emails`);

          // Only process emails received after app started (recent emails)
          const recentEmails = emails.filter(e => {
            const emailTime = new Date(e.date).getTime();
            return emailTime >= state.appStartTime;
          });

          // Process only recent emails that don't have summaries or replies yet
          // Limit to 5 most recent to reduce load
          const emailsNeedingProcessing = recentEmails
            .filter(e => !e.summary || !e.ai_generated_reply)
            .slice(0, 10); // Increased to 10 - using z.ai API
          console.log(`[AI Processing] Recent emails needing processing: ${emailsNeedingProcessing.length} (skipping ${emails.length - recentEmails.length} older emails)`);
          if (emailsNeedingProcessing.length > 0) {
            // Minimal delay - process quickly with API
            setTimeout(() => {
              processMultipleEmails(emailsNeedingProcessing.map(e => e.id));
            }, 1000); // 1 second delay before starting
          }
        } else {
          // Subsequent fetches - process truly NEW emails
          const currentIds = new Set(emails.map((e: Email) => e.id));
          const newEmailIds = [...currentIds].filter(id => !state.initialEmailIds.has(id));

          console.log(`[AI Processing] Polling - new emails: ${newEmailIds.length}`);

          // Also add these new emails to initialEmailIds so we don't process them again
          const updatedInitialIds = new Set([...state.initialEmailIds, ...newEmailIds]);
          set({ initialEmailIds: updatedInitialIds });

          // Process only new emails (not all emails without replies)
          // Increased limit - using z.ai API
          const emailsNeedingProcessing = emails
            .filter(e => newEmailIds.includes(e.id))
            .slice(0, 10); // Increased to 10 - using z.ai API
          console.log(`[AI Processing] New emails to process: ${emailsNeedingProcessing.length}`);
          if (emailsNeedingProcessing.length > 0) {
            // Small delay to avoid blocking UI
            setTimeout(() => {
              processMultipleEmails(emailsNeedingProcessing.map(e => e.id));
            }, 500); // 500ms delay - much faster with API
          }
        }
      } catch (pythonError) {
        console.error('Python OAuth server error:', pythonError);

        // Fall back to frontend Gmail API
        if (!window.gapi) {
          throw new Error('Neither Python OAuth server nor Gmail API is available. Please ensure the OAuth server is running.');
        }

        console.warn('Falling back to frontend Gmail API...');

        // Fetch emails directly from Gmail API
        const emailResponse = await fetchGmailEmails(accessToken, 10, 'in:inbox');

        if (!emailResponse.success) {
          throw new Error(emailResponse.error || 'Failed to fetch emails');
        }

        // Convert Gmail emails to app format
        const emails = emailResponse.emails.map(convertGmailEmailToApp);

        set({ emails, isLoading: false });

        // Handle initial vs subsequent fetches (same logic as Python path)
        const state = get();
        if (!state.hasInitialized) {
          const initialIds = new Set(emails.map((e: Email) => e.id));
          set({ initialEmailIds: initialIds, hasInitialized: true });

          // Only process emails received after app started
          const recentEmails = emails.filter(e => {
            const emailTime = new Date(e.date).getTime();
            return emailTime >= state.appStartTime;
          });

          // Limit to 5 most recent to reduce load
          const emailsNeedingProcessing = recentEmails
            .filter(e => !e.summary || !e.ai_generated_reply)
            .slice(0, 2); // Limit to 2 most recent (reduced from 5 for performance)
          console.log(`[AI Processing] Gmail API - Recent emails needing processing: ${emailsNeedingProcessing.length}`);
          if (emailsNeedingProcessing.length > 0) {
            // Minimal delay - process quickly with API
            setTimeout(() => {
              processMultipleEmails(emailsNeedingProcessing.map(e => e.id));
            }, 1000); // 1 second delay before starting
          }
        } else {
          const currentIds = new Set(emails.map((e: Email) => e.id));
          const newEmailIds = [...currentIds].filter(id => !state.initialEmailIds.has(id));
          const updatedInitialIds = new Set([...state.initialEmailIds, ...newEmailIds]);
          set({ initialEmailIds: updatedInitialIds });

          // Process only new emails
          // Limit to 5 most recent to reduce load
          const emailsNeedingProcessing = emails
            .filter(e => newEmailIds.includes(e.id))
            .slice(0, 2); // Limit to 2 most recent (reduced from 5 for performance)
          console.log(`[AI Processing] Gmail API - New emails to process: ${emailsNeedingProcessing.length}`);
          if (emailsNeedingProcessing.length > 0) {
            // Small delay to avoid blocking UI
            setTimeout(() => {
              processMultipleEmails(emailsNeedingProcessing.map(e => e.id));
            }, 500); // 500ms delay - much faster with API
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch emails:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch emails',
        isLoading: false
      });
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

      // Get access token
      const authStore = useAuthStore.getState();
      const accessToken = authStore.token?.access_token || localStorage.getItem('aiden_access_token');

      if (isTauri && accessToken && accessToken !== 'mock_access_token_dev') {
        // Call Tauri command to mark as read in Gmail
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('mark_email_as_read', { accessToken, messageId: email.gmail_id });
        } catch (error) {
          console.error('Failed to mark as read via Gmail API:', error);
        }
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
    } catch (error) {
      console.error('Failed to mark email as read:', error);
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

      // TODO: Call Gmail API to mark as starred
    } catch (error) {
      console.error('Failed to mark email as starred:', error);
    }
  },

  updateEmailStatus: async (emailId, status) => {
    try {
      // For now, just update local state
      // TODO: Implement backend update via OAuth server if needed
      console.log(`Updating email ${emailId} status to ${status}`);

      // Update local state
      set((state) => ({
        emails: state.emails.map(email =>
          email.id === emailId ? { ...email, status } : email
        ),
        selectedEmail: state.selectedEmail?.id === emailId
          ? { ...state.selectedEmail, status }
          : state.selectedEmail,
      }));
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

      // Simple reply generation for now
      // TODO: Implement AI reply generation via backend
      const senderName = email.sender.split('<')[0].trim() || 'there';
      const generatedReply = `Dear ${senderName},\n\nThank you for your email. I have received your message and will respond as soon as possible.\n\nBest regards,\n[Your name]`;

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

  sendEmail: async (to, subject, body, inReplyTo, originalEmailData) => {
    try {
      console.log('Sending email via OAuth server...');

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
        body: JSON.stringify({ to, subject, body, inReplyTo })
      });

      if (!response.ok) {
        throw new Error(`Failed to send email: ${response.statusText}`);
      }

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || 'Failed to send email');
      }

      console.log('Email sent successfully');

      // Add to sent emails with reference to original email
      const sentEmail: Email = {
        id: result.id || `sent-${Date.now()}`,
        gmail_id: result.id || `sent-${Date.now()}`,
        thread_id: result.id || `sent-${Date.now()}`,
        subject,
        sender: userInfo?.email || 'me',
        recipients: to,
        date: new Date().toISOString(),
        body_text: body,
        snippet: body.substring(0, 100),
        is_read: true,
        is_starred: false,
        has_attachments: false,
        status: 'Replied',
        category: 'Normal',
        requires_reply: false,
        inReplyTo: inReplyTo,
        originalEmail: originalEmailData,
      };

      set((state) => ({
        sentEmails: [sentEmail, ...state.sentEmails],
        // Track that we sent a reply to this email
        sentReplyEmailIds: new Set(state.sentReplyEmailIds).add(inReplyTo || ''),
      }));
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
        filtered = emails.filter(e => e.status !== 'Archived' && e.status !== 'Saved');
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
        // Focus Mode: Only show emails that require action (Action Required)
        filtered = emails.filter(e => {
          // Exclude archived and saved
          if (e.status === 'Archived' || e.status === 'Saved') return false;
          // Check AI analysis for requires_reply
          if (typeof window !== 'undefined' && (window as any).emailQuestionData) {
            const data = (window as any).emailQuestionData.get(e.id);
            return data?.loaded && data.requiresReply;
          }
          // Fallback to category if AI analysis not available
          return e.category === 'Urgent' || e.category === 'Important';
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

    // Mark each email as read
    for (const emailId of idsToMark) {
      await get().markAsRead(emailId);
    }

    // Update local state for selected emails
    set((state) => ({
      emails: state.emails.map(email =>
        idsToMark.includes(email.id) ? { ...email, is_read: true } : email
      ),
    }));
  },

  bulkSave: (emailIds?: string[]) => {
    const state = get();
    const idsToSave = emailIds || Array.from(state.selectedEmailIds);
    if (idsToSave.length === 0) return;

    // Save each email by updating its status
    set((state) => ({
      emails: state.emails.map(email =>
        idsToSave.includes(email.id) ? { ...email, status: 'Saved' } : email
      ),
    }));

    // Clear selection after bulk action
    get().clearSelection();
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
    return state.emails.filter(e => e.thread_id === threadId)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
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
    ];

    // Set the sample emails in the store
    useEmailStore.getState().setEmails(sampleEmails);

    // Set up the question data for the sample emails
    if (!(window as any).emailQuestionData) {
      (window as any).emailQuestionData = new Map();
    }
    const questionData = (window as any).emailQuestionData;

    sampleEmails.forEach(email => {
      questionData.set(email.id, {
        questions: email.action_items.map(a => ({ question: a, options: [] })) || [],
        suggestedFormalityScore: 50,
        requires_reply: email.requires_reply || false,
        reply_reasoning: email.requires_reply ? 'This email requires a response' : 'FYI only',
        loaded: true,
        meetingRequest: email.subject.includes('Meeting') || email.subject.includes('Invitation')
          ? { is_meeting: true, proposed_times: [] }
          : { is_meeting: false },
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
    console.log('');
    console.log('Try these views:');
    console.log('  - Click "Inbox" in sidebar for normal inbox view');
    console.log('  - Click "Threads" in sidebar for threaded view');
    console.log('  - Click "Smart Triage" for grouped batch actions');
    console.log('  - Click "Focus Mode" for action-required emails only');

    return sampleEmails.length;
  };

  (window as any).clearSampleEmails = () => {
    useEmailStore.getState().setEmails([]);
    console.log('✅ Cleared sample emails');
  };

  // Auto-load sample emails immediately (DEV MODE - always load for now)
  setTimeout(() => {
    console.log('DEV MODE: Loading sample data for testing...');
    (window as any).loadSampleEmails();
  }, 100);

  // Also make the sample emails available to the global window object for easier debugging
  // and to ensure they populate the inbox properly
  (window as any).ensureSampleEmailsInInbox = () => {
    const currentEmails = useEmailStore.getState().emails;
    if (currentEmails.length === 0) {
      console.log('No emails found, loading sample emails...');
      (window as any).loadSampleEmails();
    } else {
      console.log(`Already have ${currentEmails.length} emails in store`);
    }
  };
}