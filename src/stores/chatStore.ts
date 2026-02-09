import { create } from 'zustand';
import {
  processChatMessage,
  saveReminder,
  getReminders as fetchReminders,
  ChatContext,
  ChatMessage,
  ChatAction,
  Reminder
} from '@/api/chatbot';
import { useEmailStore } from './emailStore';
import { useCrmStore } from './crmStore';
import { useAuthStore } from './authStore';
import { fetchEmails as apiFetchEmails } from '@/api/emails';
import { invoke } from '@tauri-apps/api/core';

interface ComposeData {
  to: string;
  subject: string;
  body: string;
}

interface ChatState {
  // Chat state
  messages: ChatMessage[];
  isOpen: boolean;
  isProcessing: boolean;
  composeData: ComposeData | null;
  searchResults: any[] | null;

  // Actions
  openChat: () => void;
  closeChat: () => void;
  sendMessage: (text: string) => Promise<void>;
  executeAction: (action: ChatAction) => Promise<void>;
  clearComposeData: () => void;
  clearSearchResults: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  // Initial state
  messages: [],
  isOpen: false,
  isProcessing: false,
  composeData: null,
  searchResults: null,

  openChat: () => set({ isOpen: true }),

  closeChat: () => set({ isOpen: false }),

  sendMessage: async (text: string) => {
    if (!text.trim()) return;

    // Add user message
    const userMessage: ChatMessage = { role: 'user', content: text };
    set(state => ({
      messages: [...state.messages, userMessage],
      isProcessing: true,
    }));

    try {
      // Build context from other stores
      const emailStore = useEmailStore.getState();
      const crmStore = useCrmStore.getState();
      const authStore = useAuthStore.getState();

      // Get recent emails (limit to 50 for context)
      const allEmails = [...emailStore.emails, ...emailStore.sentEmails];
      const recentEmails = allEmails.slice(0, 50).map(email => ({
        id: email.id,
        subject: email.subject,
        sender: email.sender,
        date: email.date,
        snippet: (email.body_text || email.snippet || '').substring(0, 80),
      }));

      // Get top contacts
      const contacts = crmStore.contacts.slice(0, 20).map(contact => ({
        email: contact.email_address,
        name: contact.name,
        category: contact.category,
      }));

      // Build chat context
      const chatContext: ChatContext = {
        current_date: new Date().toISOString(),
        user_name: authStore.user?.name,
        emails: recentEmails,
        contacts,
        total_email_count: allEmails.length,
      };

      // Get conversation history
      const { messages } = get();
      const conversationHistory = [...messages];

      // Process the message
      const response = await processChatMessage({
        message: text,
        context: chatContext,
        conversation_history: conversationHistory,
      });

      // Add assistant message
      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: response.reply_message,
      };
      set(state => ({
        messages: [...state.messages, assistantMessage],
        isProcessing: false,
      }));

      // Execute action if present
      if (response.action && response.action.type !== 'none') {
        await get().executeAction(response.action);
      }
    } catch (error) {
      console.error('Failed to send chat message:', error);
      const errorMessage: ChatMessage = {
        role: 'assistant',
        content: 'Sorry, I encountered an error processing your request. Please try again.',
      };
      set(state => ({
        messages: [...state.messages, errorMessage],
        isProcessing: false,
      }));
    }
  },

  executeAction: async (action: ChatAction) => {
    const { type, data } = action;

    switch (type) {
      case 'search': {
        // Execute Gmail search query
        const query = data.query || '';
        try {
          const emailStore = useEmailStore.getState();
          // Set the search query - filtering is done client-side via getFilteredEmails()
          emailStore.setSearchQuery(query);
          // Navigate to inbox to show results
          emailStore.setCurrentFilter('inbox');
          // Get the filtered search results from current emails
          const results = emailStore.getFilteredEmails();
          // Store the actual email data, not a reference (so it doesn't disappear)
          set({ searchResults: JSON.parse(JSON.stringify(results.slice(0, 10))) });

          // Optionally fetch fresh search results from Gmail API in background
          (async () => {
            try {
              const { fetchGmailEmails } = await import('@/api/gmail');
              const authStore = useAuthStore.getState();
              if (authStore.token?.access_token) {
                const gmailData = await fetchGmailEmails(authStore.token.access_token, query, 50, true);
                if (gmailData.success && gmailData.emails.length > 0) {
                  // Convert and update the email store with fresh results
                  const converted = gmailData.emails.map((email: any) => ({
                    id: email.id,
                    gmail_id: email.id,
                    thread_id: email.threadId || email.id,
                    subject: email.subject || '(No Subject)',
                    sender: email.from || 'Unknown Sender',
                    recipients: email.to || '',
                    date: email.date || new Date().toISOString(),
                    snippet: email.snippet || '',
                    body_text: email.bodyText || email.snippet || '',
                    body_html: email.bodyHtml || '',
                    is_read: !email.unread,
                    is_starred: email.starred || false,
                    has_attachments: email.hasAttachments || false,
                    attachments: email.attachments || [],
                    labels: email.labels || [],
                    category: 'Unhandled',
                    status: 'Unhandled',
                  }));
                  // Update search results with the fresh data
                  set({ searchResults: JSON.parse(JSON.stringify(converted.slice(0, 10))) });
                }
              }
            } catch (err) {
              console.error('Background search fetch failed:', err);
            }
          })();
        } catch (error) {
          console.error('Search failed:', error);
        }
        break;
      }

      case 'compose': {
        // Set compose data and open modal
        set({
          composeData: {
            to: data.to || '',
            subject: data.subject || '',
            body: data.body || '',
          },
        });
        break;
      }

      case 'archive': {
        // Archive specified emails
        const emailIds = data.email_ids || [];
        const emailStore = useEmailStore.getState();
        for (const id of emailIds) {
          await emailStore.updateEmailStatus(id, 'archived');
        }
        break;
      }

      case 'navigate': {
        // Navigate to specific email
        const emailId = data.email_id;
        if (emailId) {
          const emailStore = useEmailStore.getState();
          // Find the email in the store
          const allEmails = [...emailStore.emails, ...emailStore.sentEmails];
          const email = allEmails.find(e => e.id === emailId);
          if (email) {
            emailStore.selectEmail(email);
          }
        }
        break;
      }

      case 'remind': {
        // Save reminder
        const reminder: Reminder = {
          id: `reminder-${Date.now()}`,
          message: data.message || '',
          due_date: data.due_date || new Date().toISOString(),
          created_at: new Date().toISOString(),
          is_triggered: false,
        };
        await saveReminder(reminder);
        break;
      }

      case 'summarize':
      case 'none':
      default:
        // No action needed, summary is in the reply message
        break;
    }
  },

  clearComposeData: () => set({ composeData: null }),

  clearSearchResults: () => set({ searchResults: null }),
}));
