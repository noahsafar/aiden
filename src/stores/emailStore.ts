import { create } from 'zustand';
import { fetchGmailEmails, convertGmailEmailToApp } from '@/api/gmail';
import { useAuthStore } from '@/stores/authStore';

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
  setSearchQuery: (query: string) => void;
  setCurrentFilter: (filter: EmailState['currentFilter']) => void;
  refreshEmails: () => Promise<void>;
  getFilteredEmails: () => Email[];
}

export const useEmailStore = create<EmailState>((set, get) => ({
  emails: [],
  sentEmails: [],
  selectedEmail: null,
  isLoading: false,
  error: null,
  currentFilter: 'inbox',
  searchQuery: '',

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
        const emails = data.emails.map((email: any) => ({
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
          ai_generated_reply: 'Test response',
          summary: email.summary || undefined,
        }));

        set({ emails, isLoading: false });
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