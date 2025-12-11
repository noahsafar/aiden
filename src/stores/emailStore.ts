import { create } from 'zustand';
import { fetchGmailEmails, convertGmailEmailToApp } from '@/api/gmail';
import '@/types/gmail-api';

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
}

export interface EmailState {
  emails: Email[];
  selectedEmail: Email | null;
  isLoading: boolean;
  error: string | null;
  currentFilter: 'all' | 'unhandled' | 'urgent' | 'important' | 'normal' | 'low';
  searchQuery: string;

  // Actions
  fetchEmails: () => Promise<void>;
  selectEmail: (email: Email | null) => void;
  markAsRead: (emailId: string) => Promise<void>;
  markAsStarred: (emailId: string, starred: boolean) => Promise<void>;
  updateEmailStatus: (emailId: string, status: Email['status']) => Promise<void>;
  classifyEmail: (emailId: string) => Promise<void>;
  generateReply: (emailId: string) => Promise<void>;
  sendEmail: (to: string, subject: string, body: string) => Promise<void>;
  setSearchQuery: (query: string) => void;
  setCurrentFilter: (filter: EmailState['currentFilter']) => void;
  refreshEmails: () => Promise<void>;
}

export const useEmailStore = create<EmailState>((set, get) => ({
  emails: [],
  selectedEmail: null,
  isLoading: false,
  error: null,
  currentFilter: 'all',
  searchQuery: '',

  fetchEmails: async () => {
    try {
      set({ isLoading: true, error: null });

      // Check if Google API is loaded
      if (!window.gapi) {
        throw new Error('Google API not loaded. Please refresh the page.');
      }

      // Fetch emails directly from Gmail API
      const emailResponse = await fetchGmailEmails('', 10, 'in:inbox');

      if (!emailResponse.success) {
        throw new Error(emailResponse.error || 'Failed to fetch emails');
      }

      // Convert Gmail emails to app format
      const emails = emailResponse.emails.map(convertGmailEmailToApp);

      set({ emails, isLoading: false });
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
      const token = await invoke<string>('get_stored_token');
      if (!token) {
        throw new Error('No authentication token found');
      }

      await invoke('update_email_status', {
        accessToken: token,
        emailId,
        status
      });

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
      const token = await invoke<string>('get_stored_token');
      if (!token) {
        throw new Error('No authentication token found');
      }

      const email = get().emails.find(e => e.id === emailId);
      if (!email) return;

      const classification = await invoke<{
        category: Email['category'];
        confidence: number;
        requires_reply: boolean;
      }>('classify_email', {
        accessToken: token,
        emailContent: email.body_text,
        sender: email.sender,
        subject: email.subject,
      });

      // Update local state
      set((state) => ({
        emails: state.emails.map(e =>
          e.id === emailId
            ? {
                ...e,
                category: classification.category,
                requires_reply: classification.requires_reply,
              }
            : e
        ),
        selectedEmail: state.selectedEmail?.id === emailId
          ? {
              ...state.selectedEmail,
              category: classification.category,
              requires_reply: classification.requires_reply,
            }
          : state.selectedEmail,
      }));
    } catch (error) {
      console.error('Failed to classify email:', error);
    }
  },

  generateReply: async (emailId) => {
    try {
      const token = await invoke<string>('get_stored_token');
      if (!token) {
        throw new Error('No authentication token found');
      }

      const email = get().emails.find(e => e.id === emailId);
      if (!email) return;

      // Get user's writing style (placeholder for now)
      const userStyle = {
        tone: 'professional',
        formality: 0.7,
        common_phrases: ['Thank you for reaching out', 'Best regards', 'Looking forward to hearing from you'],
        avg_sentence_length: 15.0,
      };

      const reply = await invoke<{
        reply: string;
        tone: string;
        confidence: number;
      }>('generate_reply', {
        accessToken: token,
        originalEmail: email.body_text,
        userStyle,
        replyType: 'professional',
      });

      // Update local state
      set((state) => ({
        emails: state.emails.map(e =>
          e.id === emailId
            ? { ...e, ai_generated_reply: reply.reply }
            : e
        ),
        selectedEmail: state.selectedEmail?.id === emailId
          ? { ...state.selectedEmail, ai_generated_reply: reply.reply }
          : state.selectedEmail,
      }));
    } catch (error) {
      console.error('Failed to generate reply:', error);
    }
  },

  sendEmail: async (to, subject, body) => {
    try {
      const token = await invoke<string>('get_stored_token');
      if (!token) {
        throw new Error('No authentication token found');
      }

      await invoke('send_email', {
        accessToken: token,
        to,
        subject,
        body,
      });
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
}));