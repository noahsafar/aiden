import { create } from 'zustand';
import { fetchGmailEmails, convertGmailEmailToApp } from '@/api/gmail';
import { useAuthStore } from '@/stores/authStore';

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
  status: 'Unhandled' | 'Saved' | 'Replied' | 'Archived';
  category: 'Urgent' | 'Important' | 'Normal' | 'Low';
  summary?: string;
  key_points?: string[];
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
}

export interface EmailState {
  emails: Email[];
  sentEmails: Email[];  // Track emails sent through Aiden
  selectedEmail: Email | null;
  isLoading: boolean;
  error: string | null;
  currentFilter: 'all' | 'inbox' | 'unhandled' | 'saved' | 'sent' | 'urgent' | 'important' | 'normal' | 'low';
  searchQuery: string;
  notifiedEmailIds: Set<string>;  // Track which emails we've sent notifications for
  initialEmailIds: Set<string>;   // Track emails that existed at app startup
  hasInitialized: boolean;        // Whether initial fetch has completed
  generatingReplies: Set<string>; // Track which emails are currently having replies generated
  generatingSummaries: Set<string>; // Track which emails are currently having summaries generated
  sentReplyEmailIds: Set<string>; // Track which emails we've sent replies to
  appStartTime: number; // Track when the app started to know which emails are "new"

  // Actions
  fetchEmails: () => Promise<void>;
  selectEmail: (email: Email | null) => void;
  markAsRead: (emailId: string) => Promise<void>;
  markAsStarred: (emailId: string, starred: boolean) => Promise<void>;
  updateEmailStatus: (emailId: string, status: Email['status']) => Promise<void>;
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
  refreshEmails: () => Promise<void>;
  getFilteredEmails: () => Email[];
  isGeneratingReply: (emailId: string) => boolean;
  isGeneratingSummary: (emailId: string) => boolean;
  triggerAIProcessing: (emailId: string) => void;
  hasSentReply: (emailId: string) => boolean;
}

// Track which emails are being processed (for both summary and reply)
let processingEmails = new Set<string>();
// Limit concurrent AI operations to avoid overwhelming the system
const MAX_CONCURRENT_AI_OPERATIONS = 3;
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
    console.log(`[AI Processing] Summary already in progress for ${emailId}`);
    return;
  }
  processingEmails.add(`${emailId}-summary`);
  console.log(`[AI Processing] Starting summary generation for ${emailId}`);

  try {
    const store = useEmailStore.getState();
    const email = store.emails.find(e => e.id === emailId);
    if (!email) {
      console.log(`[AI Processing] Email ${emailId} not found in store`);
      return;
    }
    if (email.summary) {
      console.log(`[AI Processing] Email ${emailId} already has summary`);
      return;
    }

    console.log(`[AI Processing] Calling summarize API for ${emailId}`);
    const response = await fetchWithTimeout('http://localhost:8081/summarize', {
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
        console.log(`[AI Processing] Summary generated for ${emailId}:`, result.summary);
        // Update store with summary
        useEmailStore.setState((state) => ({
          emails: state.emails.map(e =>
            e.id === emailId ? { ...e, summary: result.summary } : e
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

    console.log(`[AI Processing] Calling analyze-email API for ${emailId}`);
    const response = await fetchWithTimeout('http://localhost:8081/analyze-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: email.sender,
        subject: email.subject,
        body_text: email.body_text,
      })
    }, 90000);

    if (response.ok) {
      const result = await response.json();
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
    } else {
      console.log(`[AI Processing] Question API failed for ${emailId}:`, response.status);
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
    const response = await fetchWithTimeout('http://localhost:8081/generate-reply', {
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

// Process an email completely (summary + questions)
async function processEmail(emailId: string) {
  // Generate summary first, then questions after summary completes
  useEmailStore.setState((state) => ({
    generatingSummaries: new Set(state.generatingSummaries).add(emailId)
  }));

  // Queue summary generation, which will then trigger questions
  queueAIOperation(async () => {
    await generateSummaryForEmail(emailId);
    // After summary completes, queue question generation
    // We queue it separately so it goes through the queue system
    setTimeout(() => {
      queueAIOperation(() => generateQuestionsForEmail(emailId));
    }, 100);
  });
}

// Process a single email immediately (for when user clicks on an email)
function processEmailImmediately(emailId: string) {
  // Only process if not already being processed
  if (!processingEmails.has(`${emailId}-summary`)) {
    processEmail(emailId);
  }
}

// Process multiple emails in parallel (fire and forget)
function processMultipleEmails(emailIds: string[]) {
  console.log('[AI Processing] Processing emails:', emailIds);
  for (const emailId of emailIds) {
    processEmail(emailId); // Fire and forget - all run in parallel
  }
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
        const response = await fetch('http://localhost:8081/emails', {
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

        // Preserve status, summary, and ai_generated_reply from existing emails
        const existingEmails = get().emails;
        const emails = newEmails.map((newEmail: Email) => {
          const existing = existingEmails.find(e => e.id === newEmail.id);
          if (existing) {
            // Preserve the status, summary, and ai_generated_reply from existing email
            return {
              ...newEmail,
              status: existing.status,
              summary: existing.summary || newEmail.summary,
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
          const emailsNeedingProcessing = recentEmails.filter(e => !e.summary || !e.ai_generated_reply);
          console.log(`[AI Processing] Recent emails needing processing: ${emailsNeedingProcessing.length} (skipping ${emails.length - recentEmails.length} older emails)`);
          if (emailsNeedingProcessing.length > 0) {
            setTimeout(() => {
              processMultipleEmails(emailsNeedingProcessing.map(e => e.id));
            }, 100); // Small delay to not block UI
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
          const emailsNeedingProcessing = emails.filter(e => newEmailIds.includes(e.id));
          console.log(`[AI Processing] New emails to process: ${emailsNeedingProcessing.length}`);
          if (emailsNeedingProcessing.length > 0) {
            processMultipleEmails(emailsNeedingProcessing.map(e => e.id));
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

          const emailsNeedingProcessing = recentEmails.filter(e => !e.summary || !e.ai_generated_reply);
          console.log(`[AI Processing] Gmail API - Recent emails needing processing: ${emailsNeedingProcessing.length}`);
          if (emailsNeedingProcessing.length > 0) {
            setTimeout(() => {
              processMultipleEmails(emailsNeedingProcessing.map(e => e.id));
            }, 100);
          }
        } else {
          const currentIds = new Set(emails.map((e: Email) => e.id));
          const newEmailIds = [...currentIds].filter(id => !state.initialEmailIds.has(id));
          const updatedInitialIds = new Set([...state.initialEmailIds, ...newEmailIds]);
          set({ initialEmailIds: updatedInitialIds });

          // Process only new emails
          const emailsNeedingProcessing = emails.filter(e => newEmailIds.includes(e.id));
          console.log(`[AI Processing] Gmail API - New emails to process: ${emailsNeedingProcessing.length}`);
          if (emailsNeedingProcessing.length > 0) {
            processMultipleEmails(emailsNeedingProcessing.map(e => e.id));
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
      const response = await fetch('http://localhost:8081/send-email', {
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
}));