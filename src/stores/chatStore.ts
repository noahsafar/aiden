import { create } from 'zustand';
import {
  processChatMessage,
  saveReminder,
  getReminders as fetchReminders,
  ChatContext,
  ChatMessage,
  ChatAction,
  Reminder,
  webSearch,
  discoverCompanies,
  WebSearchResponse,
  CompanyContact,
} from '@/api/chatbot';
// Move store imports inside functions to avoid circular dependency
import { fetchEmails as apiFetchEmails } from '@/api/emails';
import { invoke } from '@tauri-apps/api/core';
import {
  fuzzyMatchContacts,
  needsClarification,
  formatClarificationMessage,
} from '@/utils/contactMatching';

interface ComposeData {
  to: string;
  subject: string;
  body: string;
  /** Optional AI instruction — when present the compose modal auto-drafts from it. */
  prompt?: string;
}

interface ChatState {
  // Chat state
  messages: ChatMessage[];
  isOpen: boolean;
  isProcessing: boolean;
  composeData: ComposeData | null;
  searchResults: any[] | null;

  // Contact clarification state
  pendingClarification: boolean;
  clarificationContacts: any[];
  clarificationOriginalAction: ChatAction | null;

  // Actions
  openChat: () => void;
  closeChat: () => void;
  sendMessage: (text: string, source?: 'voice' | 'typed') => Promise<void>;
  executeAction: (action: ChatAction) => Promise<void>;
  openCompose: (data: Partial<ComposeData>) => void;
  clearComposeData: () => void;
  clearSearchResults: () => void;
  handleClarificationResponse: (response: string) => Promise<void>;
  clearClarification: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  // Initial state
  messages: [],
  isOpen: false,
  isProcessing: false,
  composeData: null,
  searchResults: null,

  // Clarification state
  pendingClarification: false,
  clarificationContacts: [],
  clarificationOriginalAction: null,

  openChat: () => set({ isOpen: true }),

  closeChat: () => set({ isOpen: false }),

  sendMessage: async (text: string, source?: 'voice' | 'typed') => {
    if (!text.trim()) return;

    // Check if we're in clarification mode
    const { pendingClarification } = get();
    if (pendingClarification) {
      // Handle clarification response
      const userMessage: ChatMessage = { role: 'user', content: text, source };
      set(state => ({
        messages: [...state.messages, userMessage],
      }));
      await get().handleClarificationResponse(text);
      return;
    }

    // Add user message
    const userMessage: ChatMessage = { role: 'user', content: text, source };
    set(state => ({
      messages: [...state.messages, userMessage],
      isProcessing: true,
    }));

    try {
      // Build context from other stores (dynamic imports to avoid circular dependency)
      const { useEmailStore } = await import('./emailStore');
      const { useCrmStore } = await import('./crmStore');
      const { useAuthStore } = await import('./authStore');

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
        status: email.status,
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
          const { useEmailStore } = await import('./emailStore');
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
              const { useAuthStore } = await import('./authStore');
              const authStore = useAuthStore.getState();
              if (authStore.token?.access_token) {
                // Signature is (accessToken, maxResults, query) — this call had the
                // query in the maxResults slot, so searches silently misfired.
                const gmailData = await fetchGmailEmails(authStore.token.access_token, 50, query);
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
        const recipient = data.to || '';
        // Check if recipient needs clarification
        const { useCrmStore } = await import('./crmStore');
        const crmStore = useCrmStore.getState();
        const matches = fuzzyMatchContacts(recipient, crmStore.contacts);

        if (needsClarification(matches)) {
          // Set up clarification state
          set({
            pendingClarification: true,
            clarificationContacts: matches.map(m => m.contact),
            clarificationOriginalAction: action,
          });

          // Add clarification message to chat
          const clarificationMessage: ChatMessage = {
            role: 'assistant',
            content: formatClarificationMessage(matches),
          };
          set(state => ({
            messages: [...state.messages, clarificationMessage],
          }));
        } else {
          // Set compose data and open modal
          set({
            composeData: {
              to: data.to || '',
              subject: data.subject || '',
              body: data.body || '',
            },
          });
        }
        break;
      }

      case 'reply': {
        // Reply to a specific email
        const emailId = data.email_id;
        if (emailId) {
          const { useEmailStore } = await import('./emailStore');
          const emailStore = useEmailStore.getState();
          // Find the email in the store
          const allEmails = [...emailStore.emails, ...emailStore.sentEmails];
          const email = allEmails.find(e => e.id === emailId);
          if (email) {
            // Select the email first
            emailStore.selectEmail(email);
            // If AI-generated reply body is provided, set it as compose data with reply formatting
            if (data.body) {
              const replySubject = email.subject?.startsWith('Re:')
                ? email.subject
                : `Re: ${email.subject}`;
              set({
                composeData: {
                  to: email.sender || '',
                  subject: replySubject,
                  body: data.body || '',
                },
              });
            } else {
              // Otherwise generate a reply using AI
              await emailStore.generateReply(emailId);
            }
          }
        }
        break;
      }

      case 'archive': {
        // Archive specified emails
        const emailIds = data.email_ids || [];
        const { useEmailStore } = await import('./emailStore');
        const emailStore = useEmailStore.getState();
        for (const id of emailIds) {
          await emailStore.updateEmailStatus(id, 'Archived');
        }
        break;
      }

      case 'delete': {
        const emailIds = data.email_ids || [];
        const { useEmailStore } = await import('./emailStore');
        const emailStore = useEmailStore.getState();
        for (const id of emailIds) {
          await emailStore.updateEmailStatus(id, 'Deleted');
        }
        break;
      }

      case 'save': {
        const emailIds = data.email_ids || [];
        const { useEmailStore } = await import('./emailStore');
        const emailStore = useEmailStore.getState();
        for (const id of emailIds) {
          emailStore.saveEmail(id);
        }
        break;
      }

      case 'mark_read': {
        const emailIds = data.email_ids || [];
        const { useEmailStore } = await import('./emailStore');
        const emailStore = useEmailStore.getState();
        for (const id of emailIds) {
          await emailStore.markAsRead(id);
        }
        break;
      }

      case 'mark_unread': {
        const emailIds = data.email_ids || [];
        const { useEmailStore } = await import('./emailStore');
        const emailStore = useEmailStore.getState();
        for (const id of emailIds) {
          await emailStore.markAsUnread(id);
        }
        break;
      }

      case 'navigate': {
        // Navigate to specific email
        const emailId = data.email_id;
        if (emailId) {
          const { useEmailStore } = await import('./emailStore');
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

      case 'web_search': {
        // Perform web search
        const query = data.query || '';
        try {
          const results: WebSearchResponse = await webSearch({
            query,
            max_results: 10,
          });

          // Store search results in state
          set({ searchResults: results.results.slice(0, 10) });

          // Add results message to chat
          const resultsMessage: ChatMessage = {
            role: 'assistant',
            content: `Found ${results.results.length} web results for "${query}":\n\n${results.results
              .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.content.substring(0, 150)}...`)
              .join('\n\n')}`,
          };
          set(state => ({
            messages: [...state.messages, resultsMessage],
          }));
        } catch (error) {
          console.error('Web search failed:', error);
          const errorMessage: ChatMessage = {
            role: 'assistant',
            content: 'Sorry, I encountered an error performing the web search. Please try again.',
          };
          set(state => ({
            messages: [...state.messages, errorMessage],
          }));
        }
        break;
      }

      case 'discover_companies': {
        // Discover companies matching criteria
        const query = data.query || '';
        const count = data.count || 10;

        try {
          const companies: CompanyContact[] = await discoverCompanies(query, Math.min(count, 50));

          if (companies.length > 0) {
            // Store companies in search results for bulk email
            set({ searchResults: companies });

            // Format company list for chat
            const companyList = companies
              .map((c, i) => `${i + 1}. ${c.company_name} (${c.domain})\n   ${c.description.substring(0, 100)}...`)
              .join('\n\n');

            const resultsMessage: ChatMessage = {
              role: 'assistant',
              content: `Found ${companies.length} companies matching "${query}":\n\n${companyList}\n\nWould you like me to prepare emails for these companies?`,
            };
            set(state => ({
              messages: [...state.messages, resultsMessage],
            }));
          } else {
            const noResultsMessage: ChatMessage = {
              role: 'assistant',
              content: `I couldn't find any companies matching "${query}". Try a different search term.`,
            };
            set(state => ({
              messages: [...state.messages, noResultsMessage],
            }));
          }
        } catch (error) {
          console.error('Company discovery failed:', error);
          const errorMessage: ChatMessage = {
            role: 'assistant',
            content: 'Sorry, I encountered an error discovering companies. Please try again.',
          };
          set(state => ({
            messages: [...state.messages, errorMessage],
          }));
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

  openCompose: (data) =>
    set({ composeData: { to: data.to || '', subject: data.subject || '', body: data.body || '', prompt: data.prompt } }),

  clearComposeData: () => set({ composeData: null }),

  clearSearchResults: () => set({ searchResults: null }),

  clearClarification: () => set({
    pendingClarification: false,
    clarificationContacts: [],
    clarificationOriginalAction: null,
  }),

  handleClarificationResponse: async (response: string) => {
    const { clarificationContacts, clarificationOriginalAction } = get();
    if (!clarificationContacts.length || !clarificationOriginalAction) return;

    // Parse response - could be a number (1, 2, 3) or name
    const selectedIndex = parseInt(response.trim());
    let selectedContact;

    if (!isNaN(selectedIndex) && selectedIndex > 0 && selectedIndex <= clarificationContacts.length) {
      // User selected by number
      selectedContact = clarificationContacts[selectedIndex - 1];
    } else {
      // User selected by name - fuzzy match the response
      const lowerResponse = response.toLowerCase().trim();
      selectedContact = clarificationContacts.find((c: any) =>
        c.name?.toLowerCase().includes(lowerResponse) ||
        c.email_address?.toLowerCase().includes(lowerResponse)
      );
    }

    if (selectedContact) {
      // Update the original action with the selected contact
      const updatedAction: ChatAction = {
        ...clarificationOriginalAction,
        data: {
          ...clarificationOriginalAction.data,
          to: selectedContact.email_address,
        },
      };

      // Clear clarification state
      get().clearClarification();

      // Execute the updated action
      await get().executeAction(updatedAction);

      // Add confirmation message
      const confirmationMessage: ChatMessage = {
        role: 'assistant',
        content: `Great! I'll use ${selectedContact.name || selectedContact.email_address}.`,
      };
      set(state => ({
        messages: [...state.messages, confirmationMessage],
      }));
    } else {
      // Couldn't parse selection, ask again
      const errorMessage: ChatMessage = {
        role: 'assistant',
        content: "I couldn't understand your selection. Please choose by number (1, 2, 3) or full name.",
      };
      set(state => ({
        messages: [...state.messages, errorMessage],
      }));
    }
  },
}));
