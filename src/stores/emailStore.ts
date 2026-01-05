import { create } from 'zustand';
import { fetchGmailEmails, convertGmailEmailToApp } from '@/api/gmail';
import { useAuthStore } from '@/stores/authStore';

// Check if running in Tauri
const isTauri = typeof window !== 'undefined' && window.__TAURI_INTERNALS__;

// Lazy load notification API only in Tauri
let sendTauriNotification: any = null;
async function sendNotification(title: string, body: string): Promise<void> {
  if (!isTauri) return;
  try {
    if (!sendTauriNotification) {
      const plugin = await import('@tauri-apps/plugin-notification');
      sendTauriNotification = plugin.sendNotification;
    }
    await sendTauriNotification({ title, body, icon: '/icons/icon.png' });
  } catch (e) {
    console.error('Notification error:', e);
  }
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
  status: 'Unhandled' | 'Saved' | 'Replied' | 'Archived';
  category: 'Urgent' | 'Important' | 'Normal' | 'Low';
  summary?: string;
  key_points?: string[];
  requires_reply: boolean;
  ai_generated_reply?: string;
  // For sent emails: reference to the original email being replied to
  inReplyTo?: string;  // original email ID
  originalEmail?: Email;  // full original email data (populated when viewing sent emails)
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
}

// Background processor for new emails - generates summary, reply, then notifies
// Defined outside store to access it via get() during async operations
let processingEmails = new Set<string>();
async function processNewEmail(emailId: string) {
  if (processingEmails.has(emailId)) return;
  processingEmails.add(emailId);

  try {
    // Wait a bit to let the email settle in the store
    await new Promise(resolve => setTimeout(resolve, 500));

    // Get the store instance
    const store = useEmailStore.getState();

    // Step 1: Generate summary
    let summary: string | null = null;
    try {
      summary = await store.summarizeEmail(emailId);
    } catch (e) {
      console.error('Failed to generate summary:', e);
    }

    // Step 2: Generate reply
    let reply: string | null = null;
    try {
      const email = store.emails.find(e => e.id === emailId);
      if (!email) return;

      const response = await fetch('http://localhost:8081/generate-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender: email.sender,
          subject: email.subject,
          body_text: email.body_text,
        }),
      });

      const result = await response.json();
      if (result.success) {
        reply = result.reply;
        store.saveGeneratedReply(emailId, reply);
      }
    } catch (e) {
      console.error('Failed to generate reply:', e);
    }

    // Step 3: Send notification if we have both
    if (summary && reply) {
      store.sendEmailNotification(emailId, summary, reply);
    }
  } finally {
    processingEmails.delete(emailId);
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
          body_text: email.bodyText || email.snippet || email.content || '',
          snippet: email.snippet || email.content?.substring(0, 100) || '',
          is_read: email.isRead !== false,
          is_starred: email.labels?.includes('STARRED') || false,
          has_attachments: email.labels?.includes('ATTACHMENT') || false,
          status: 'Unhandled' as const,
          category: 'Normal' as const,
          requires_reply: !email.isRead && !email.from?.toLowerCase().includes('me'),
          summary: email.summary || undefined,
        }));

        // Preserve status from existing emails
        const existingEmails = get().emails;
        const emails = newEmails.map((newEmail: Email) => {
          const existing = existingEmails.find(e => e.id === newEmail.id);
          if (existing) {
            // Preserve the status from existing email
            return { ...newEmail, status: existing.status, summary: existing.summary || newEmail.summary };
          }
          return newEmail;
        });

        set({ emails, isLoading: false });

        // Handle initial vs subsequent fetches
        const state = get();
        if (!state.hasInitialized) {
          // First fetch - just track existing emails, don't process them
          const initialIds = new Set(emails.map((e: Email) => e.id));
          set({ initialEmailIds: initialIds, hasInitialized: true });
        } else {
          // Subsequent fetches - only process truly NEW emails
          const currentIds = new Set(emails.map((e: Email) => e.id));
          const newEmailIds = [...currentIds].filter(id => !state.initialEmailIds.has(id));

          // Also add these new emails to initialEmailIds so we don't process them again
          const updatedInitialIds = new Set([...state.initialEmailIds, ...newEmailIds]);
          set({ initialEmailIds: updatedInitialIds });

          // Process only the new emails
          for (const emailId of newEmailIds) {
            if (!state.notifiedEmailIds.has(emailId)) {
              processNewEmail(emailId);
            }
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
        } else {
          const currentIds = new Set(emails.map((e: Email) => e.id));
          const newEmailIds = [...currentIds].filter(id => !state.initialEmailIds.has(id));
          const updatedInitialIds = new Set([...state.initialEmailIds, ...newEmailIds]);
          set({ initialEmailIds: updatedInitialIds });

          for (const emailId of newEmailIds) {
            if (!state.notifiedEmailIds.has(emailId)) {
              processNewEmail(emailId);
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
    }
  },

  selectEmail: (email) => {
    set({ selectedEmail: email });
    if (email && !email.is_read) {
      get().markAsRead(email.id);
    }
  },

  markAsRead: async (emailId) => {
    try {
      // Update local state
      set((state) => ({
        emails: state.emails.map(email =>
          email.id === emailId ? { ...email, is_read: true } : email
        ),
        selectedEmail: state.selectedEmail?.id === emailId
          ? { ...state.selectedEmail, is_read: true }
          : state.selectedEmail,
      }));

      // TODO: Call Gmail API to mark as read
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
    try {
      const email = get().emails.find(e => e.id === emailId);
      if (!email) return null;

      // Call OAuth server to generate summary
      const response = await fetch('http://localhost:8081/summarize', {
        method: 'POST',
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sender: email.sender,
          subject: email.subject,
          body_text: email.body_text,
          snippet: email.snippet,
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to summarize: ${response.statusText}`);
      }

      const result = await response.json();

      if (result.success && result.summary) {
        // Update local state with summary
        set((state) => ({
          emails: state.emails.map(e =>
            e.id === emailId
              ? { ...e, summary: result.summary }
              : e
          ),
          selectedEmail: state.selectedEmail?.id === emailId
            ? { ...state.selectedEmail, summary: result.summary }
            : state.selectedEmail,
        }));
        return result.summary;
      } else {
        throw new Error(result.error || 'Failed to generate summary');
      }
    } catch (error) {
      console.error('Failed to summarize email:', error);
      throw error;
    }
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
        body: JSON.stringify({ to, subject, body })
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

  sendEmailNotification: (emailId, summary, reply) => {
    const state = get();
    if (state.notifiedEmailIds.has(emailId)) return; // Already notified

    const email = state.emails.find(e => e.id === emailId);
    if (!email) return;

    const senderName = email.sender.split('<')[0].trim() || email.sender;
    const notificationBody = `${summary}\n\nSuggested: ${reply.substring(0, 100)}${reply.length > 100 ? '...' : ''}`;

    sendNotification(`Email from ${senderName}`, notificationBody);
    set((state) => ({
      notifiedEmailIds: new Set(state.notifiedEmailIds).add(emailId),
    }));
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
}));