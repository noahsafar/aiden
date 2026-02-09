import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Sidebar } from '@/components/ui/Sidebar';
import { EmailList } from '@/components/ui/EmailList';
import { ThreadedEmailList } from '@/components/ui/ThreadedEmailList';
import { EmailView } from '@/components/ui/EmailView';
import { SmartTriage } from '@/components/ui/SmartTriage';
import { AttachmentItem, getFileIcon, formatFileSize } from '@/components/ui/EmailView';
import { Login } from '@/components/Login';
import { OAuthHandler } from '@/components/OAuthHandler';
import { TestPage } from '@/components/TestPage';
import { Settings as SettingsPage } from '@/pages/Settings';
import { Calendar } from '@/pages/Calendar';
import { Crm } from '@/pages/Crm';
import { AIComposeModal } from '@/components/email/AIComposeModal';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { useChatStore } from '@/stores/chatStore';
import { editReply } from '@/api/claude';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ToastContainer, ToastData } from '@/components/ui/Toast';
import { useAuthStore } from '@/stores/authStore';
import { useEmailStore } from '@/stores/emailStore';
import { useThemeStore } from '@/stores/themeStore';
import { Link, useNavigate } from 'react-router-dom';
import {
  Search,
  Mail,
  Users,
  Sparkles,
  LogOut,
  Settings as SettingsIcon,
  Calendar as CalendarIcon,
  Bookmark,
  File,
  Image,
  FileText,
  Archive,
  Music,
  Video,
  Download,
  Eye,
  X,
  ArrowDownAZ,
  Signal,
  MessageSquare,
  Target,
  PenSquare,
  Paperclip,
  Send,
} from 'lucide-react';
import logo from '/aiden-logo.png';

interface Email {
  id: string;
  thread_id?: string;
  sender?: string;
  date?: string;
  recipients?: string;  // For sent emails - who received it
  from: {
    name: string;
    email: string;
    status?: 'online' | 'offline' | 'away';
  };
  to: Array<{ name: string; email: string; }>;
  subject: string;
  preview: string;
  content: string;
  bodyHtml?: string;
  body_html?: string;
  timestamp: string;
  isRead: boolean;
  isStarred: boolean;
  hasAttachments: boolean;
  labels: Array<{
    id: string;
    name: string;
    color: 'primary' | 'success' | 'warning' | 'error' | 'ai';
  }>;
  isAIProcessed?: boolean;
  aiCategory?: string;
  aiSummary?: string;
  aiActionItems?: string[];
  aiPriority?: 'high' | 'medium' | 'low';
  key_points?: string[];
  action_items?: string[];
  attachments?: Array<{
    id: string;
    name: string;
    size: string;
    type: string;
  }>;
  // Waiting-on-reply fields
  waiting_on_reply_since?: string;
  reminder_due_date?: string;
  reminder_triggered?: boolean;
  reminder_count?: number;
  needs_follow_up?: boolean;
}

function App() {
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [focusedEmailId, setFocusedEmailId] = useState<string | null>(null);
  const [isComposeModalOpen, setIsComposeModalOpen] = useState(false);
  const { signOut, isAuthenticated, isLoading, initialize, user } = useAuthStore();
  const { emails, fetchEmails, isLoading: emailsLoading, sentEmails, currentFilter, setCurrentFilter, markAsStarred, updateEmailStatus, viewMode, sortMode, setSortMode, setViewMode, searchQuery, setSearchQuery, getFilteredEmails, setSelectedEmail } = useEmailStore();
  const { loadThemeFromSettings } = useThemeStore();
  const { isOpen: isChatOpen, openChat: openChatPanel, closeChat: closeChatPanel, composeData: chatComposeData, clearComposeData } = useChatStore();

  // Animation state for focused view
  const [isAnimatingToFocused, setIsAnimatingToFocused] = useState(false);
  const [animationPhase, setAnimationPhase] = useState<'idle' | 'slideLeft' | 'expand'>('idle');
  const [isClosingAnimation, setIsClosingAnimation] = useState(false);
  // Focus mode toggle - separate from currentFilter so inbox stays highlighted
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [analysisPanelHeight, setAnalysisPanelHeight] = useState(0);
  const [emailPanelTopPosition, setEmailPanelTopPosition] = useState<number | null>(null);
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const [showResponseOptions, setShowResponseOptions] = useState(false);
  const [bumpGenerating, setBumpGenerating] = useState<string | null>(null);
  const [bumpDraft, setBumpDraft] = useState<{ emailId: string; threadId: string; recipient: string; subject: string; body: string } | null>(null);
  const [bumpInstruction, setBumpInstruction] = useState('');
  const analysisPanelRef = React.useRef<HTMLDivElement>(null);

  // Convert email store format to UI format - use useCallback to avoid recreating on every render
  const convertToUIEmail = React.useCallback((email: any): Email => {
    const fromMatch = email.sender.match(/^(?:\"?([^\"]*)\"?\\s)?(?:<?([^>]+)>?)$/);
    const fromName = fromMatch?.[1] || email.sender.split('<')[0].trim() || 'Unknown';
    const fromEmail = fromMatch?.[2] || email.sender.split('<')[1]?.replace('>', '').trim() || email.sender;

    // Convert recipients
    const toRecipients = email.recipients.split(',').map((r: string) => {
      const match = r.trim().match(/^(?:\"?([^\"]*)\"?\\s)?(?:<?([^>]+)>?)$/);
      const name = match?.[1] || r.trim().split('<')[0].trim() || 'Unknown';
      const emailAddr = match?.[2] || r.trim().split('<')[1]?.replace('>', '').trim() || r.trim();
      return { name, email: emailAddr };
    });

    return {
      id: email.id,
      thread_id: email.thread_id,
      sender: email.sender,
      date: email.date,
      from: {
        name: fromName,
        email: fromEmail,
        status: 'offline' as const
      },
      to: toRecipients,
      subject: email.subject,
      preview: email.snippet,
      content: email.body_text || email.snippet,
      bodyHtml: email.body_html,  // Include HTML version
      timestamp: new Date(email.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isRead: email.is_read,
      isStarred: email.is_starred,
      hasAttachments: email.has_attachments,
      attachments: email.attachments || [],
      labels: [
        { id: '1', name: email.status, color: email.category === 'Urgent' ? 'error' : email.category === 'Important' ? 'warning' : 'primary' as const }
      ],
      isAIProcessed: true,
      aiCategory: email.category,
      aiSummary: email.summary,
      aiActionItems: email.key_points || [],
      key_points: email.key_points || [],
      action_items: email.action_items || [],
      aiPriority: email.category === 'Urgent' ? 'high' : email.category === 'Important' ? 'medium' : 'low' as const
    };
  }, []);

  // Convert sent email to UI format - use useCallback to avoid recreating on every render
  const convertSentEmailToUI = React.useCallback((email: any): Email => {
    const toRecipients = email.recipients ? email.recipients.split(',').map((r: string) => {
      const match = r.trim().match(/^(?:\"?([^\"]*)\"?\\s)?(?:<?([^>]+)>?)$/);
      const name = match?.[1] || r.trim().split('<')[0].trim() || 'Unknown';
      const emailAddr = match?.[2] || r.trim().split('<')[1]?.replace('>', '').trim() || r.trim();
      return { name, email: emailAddr };
    }) : [{ name: 'Unknown', email: email.recipients || '' }];

    const converted = {
      id: email.id,
      thread_id: email.thread_id,
      sender: email.sender,
      date: email.date,
      status: email.status,
      from: {
        name: 'You',
        email: email.sender || 'me',
        status: 'offline' as const
      },
      to: toRecipients,
      recipients: email.recipients, // Keep raw recipients string for display
      subject: email.subject,
      preview: email.snippet,
      content: email.body_text || email.snippet,
      bodyHtml: email.body_html,
      body_html: email.body_html,
      timestamp: new Date(email.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isRead: email.is_read,
      isStarred: email.is_starred,
      hasAttachments: email.has_attachments,
      attachments: email.attachments || [],
      labels: [
        { id: '1', name: 'Sent', color: 'primary' as const }
      ],
      isAIProcessed: true,
      aiCategory: email.category,
      aiSummary: email.summary,
      aiActionItems: email.key_points || [],
      aiPriority: 'low' as const,
      // Preserve waiting-on-reply fields
      waiting_on_reply_since: email.waiting_on_reply_since,
      reminder_due_date: email.reminder_due_date,
      reminder_triggered: email.reminder_triggered,
      reminder_count: email.reminder_count,
      needs_follow_up: email.needs_follow_up,
      recipients: email.recipients,
    };

    console.log('[App] convertSentEmailToUI:', { originalId: email.id, convertedId: converted.id, hasWaiting: !!converted.waiting_on_reply_since, needsFollowUp: converted.needs_follow_up });

    return converted;
  }, []);

  // Filter emails based on current filter - use useMemo to avoid recalculating on every render
  const filteredEmails = React.useMemo(() => {
    let result: Email[] = [];

    if (currentFilter === 'sent') {
      result = sentEmails
        .filter(e => e.status !== 'Deleted' && e.status !== 'Saved')
        .map(convertSentEmailToUI);
    } else if (currentFilter === 'inbox') {
      // For inbox: show ONLY OVERDUE waiting-on-reply emails at top, then regular unhandled emails
      const now = new Date();
      const overdueEmails = sentEmails
        .filter(e => {
          if (!e.waiting_on_reply_since || !e.needs_follow_up) return false;
          // Exclude saved emails from inbox
          if (e.status === 'Saved') return false;
          // Only show if reminder is due/overdue
          if (!e.reminder_due_date) return false;
          return new Date(e.reminder_due_date) <= now;
        })
        .map(convertSentEmailToUI);
      const regularInbox = emails
        .filter(email => {
          // Always exclude deleted emails
          if (email.status === 'Deleted') return false;
          // For Focus mode, show only important/action-required emails (exclude FYI)
          if (isFocusMode) {
            // Exclude archived and saved
            if (email.status === 'Archived' || email.status === 'Saved') return false;

            // Check AI analysis for more precise filtering
            let requiresReply: boolean | null = null;
            if (typeof window !== 'undefined' && (window as any).emailQuestionData) {
              const data = (window as any).emailQuestionData.get(email.id);
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
            if (email.category === 'Urgent' || email.category === 'Important') return true;

            // Exclude Normal and Low categories when AI hasn't analyzed yet
            return false;
          }
          // Regular inbox: exclude saved/archived
          return email.status !== 'Archived' && email.status !== 'Saved';
        })
        .map(convertToUIEmail);

      // Put overdue emails FIRST, then regular inbox
      result = [...overdueEmails, ...regularInbox];

      // Debug logging
      console.log('[App] Inbox filter:', { overdueEmails: overdueEmails.length, regularInbox: regularInbox.length, total: result.length });
      console.log('[App] OverdueEmails:', overdueEmails.map(e => ({ id: e.id, subject: e.subject, hasWaiting: !!e.waiting_on_reply_since })));
      console.log('[App] Sent emails with waiting_on_reply_since:', sentEmails.filter(e => e.waiting_on_reply_since).map(e => ({ id: e.id, subject: e.subject, waiting: e.waiting_on_reply_since })));
    } else {
      // All other filters
      result = emails
        .filter(email => {
          // Always exclude deleted emails from all views
          if (email.status === 'Deleted') return false;

          // For Saved category, show saved emails from both emails and sentEmails
          if (currentFilter === 'saved') {
            return email.status === 'Saved';
          }
          // For Archived category, show archived emails
          if (currentFilter === 'archived') {
            return email.status === 'Archived';
          }
          return true;
        })
        .map(convertToUIEmail);

      // For Saved filter, also include saved sent emails
      if (currentFilter === 'saved') {
        const savedSentEmails = sentEmails
          .filter(e => e.status === 'Saved')
          .map(convertSentEmailToUI);
        // Debug logging
        console.log('[App] Saved filter - savedSentEmails:', savedSentEmails.map(e => ({ id: e.id, subject: e.subject, status: (sentEmails as any).find((se: any) => se.id === e.id)?.status })));
        console.log('[App] Saved filter - All sentEmails with their statuses:', sentEmails.map((e: any) => ({ id: e.id, subject: e.subject, status: e.status })));
        result = [...result, ...savedSentEmails];
      }
    }

    // Apply search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(email =>
        email.subject?.toLowerCase().includes(query) ||
        email.from?.name?.toLowerCase().includes(query) ||
        email.from?.email?.toLowerCase().includes(query) ||
        email.preview?.toLowerCase().includes(query) ||
        email.content?.toLowerCase().includes(query)
      );
    }

    // Shared helpers for sorting
    const isWaitingAndReady = (e: any) => !!e.waiting_on_reply_since && e.needs_follow_up === true &&
      Math.floor((Date.now() - new Date(e.waiting_on_reply_since).getTime()) / (1000 * 60 * 60 * 24)) >= 1;

    const getNeedsAttentionScore = (email: any): number => {
      if ((window as any).dismissedAttentionEmails?.has(email.id)) return 0;
      if (email.waiting_on_reply_since) return 0; // handled separately
      if (email.status === 'Replied' || email.status === 'Archived' || email.status === 'Saved') return 0;
      if (email.labels?.some((l: any) => l.name === 'Sent')) return 0;
      const sentReplyIds = useEmailStore.getState().sentReplyEmailIds;
      if (sentReplyIds.has(email.id)) return 0;

      const questionData = (window as any).emailQuestionData?.get(email.id);
      const requiresReply = questionData?.loaded ? questionData.requiresReply : email.requires_reply;
      const now = new Date();
      const daysOld = Math.floor((now.getTime() - new Date(email.date || 0).getTime()) / (1000 * 60 * 60 * 24));

      // Follow-up from sender
      if (email.thread_id) {
        const threadEmails = result.filter(e => e.thread_id === email.thread_id && e.id !== email.id);
        const senderEmail = email.from?.email || '';
        const fromSameSender = threadEmails.filter((e: any) => (e.from?.email || '') === senderEmail);
        if (fromSameSender.length >= 2) {
          const hasSentReplyInThread = sentEmails.some((se: any) => se.thread_id === email.thread_id || se.inReplyTo === email.id);
          if (!hasSentReplyInThread) return 3; // highest priority
        }
      }
      // Upcoming deadline
      if (questionData?.deadline) {
        const deadlineDate = new Date(questionData.deadline);
        if (!isNaN(deadlineDate.getTime())) {
          const daysUntil = Math.ceil((now.getTime() - deadlineDate.getTime()) / (1000 * 60 * 60 * 24) * -1);
          if (daysUntil <= 2) return 3;
          if (daysUntil <= 7) return 2;
        } else {
          return 2; // non-ISO deadline, treat as important
        }
      }
      if (email.aiCategory === 'Urgent' || email.category === 'Urgent') return 2;
      if (requiresReply && daysOld >= 2) return daysOld > 4 ? 2 : 1;
      return 0;
    };

    // Sort by selected mode
    if (sortMode === 'importance') {
      // Sort by category priority: Urgent > Important > Normal > Low
      // BUT keep waiting emails at the top regardless (except for sent page)
      const categoryOrder = { 'Urgent': 0, 'Important': 1, 'Normal': 2, 'Low': 3 };
      return result.sort((a, b) => {
        // For sent page: sort by how long waiting (oldest first = most important)
        if (currentFilter === 'sent') {
          const aIsWaiting = isWaitingAndReady(a);
          const bIsWaiting = isWaitingAndReady(b);

          // Waiting emails come first, sorted by how long they've been waiting
          if (aIsWaiting && bIsWaiting) {
            const aDays = a.waiting_on_reply_since ? new Date(a.waiting_on_reply_since).getTime() : 0;
            const bDays = b.waiting_on_reply_since ? new Date(b.waiting_on_reply_since).getTime() : 0;
            return aDays - bDays; // Oldest first (waiting longest)
          }
          if (aIsWaiting !== bIsWaiting) {
            return aIsWaiting ? -1 : 1;
          }
          // Non-waiting emails: sort by date (newest first)
          return new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime();
        }

        // For other pages (inbox, etc.): keep waiting emails at top
        const aIsWaiting = isWaitingAndReady(a);
        const bIsWaiting = isWaitingAndReady(b);
        if (aIsWaiting !== bIsWaiting) {
          return aIsWaiting ? -1 : 1;
        }

        // Within waiting emails, sort by days waiting (oldest first = most urgent)
        if (aIsWaiting && bIsWaiting) {
          const aDays = a.waiting_on_reply_since ? new Date(a.waiting_on_reply_since).getTime() : 0;
          const bDays = b.waiting_on_reply_since ? new Date(b.waiting_on_reply_since).getTime() : 0;
          return aDays - bDays; // Oldest first (most overdue)
        }

        // Needs-attention emails come next (same logic as date sort)
        const aAttentionImp = getNeedsAttentionScore(a);
        const bAttentionImp = getNeedsAttentionScore(b);
        if (aAttentionImp !== bAttentionImp) {
          return bAttentionImp - aAttentionImp;
        }

        // For regular emails, sort by category (Urgent naturally rises)
        const aCategory = a.aiCategory || 'Normal';
        const bCategory = b.aiCategory || 'Normal';
        const aOrder = categoryOrder[aCategory as keyof typeof categoryOrder] ?? 2;
        const bOrder = categoryOrder[bCategory as keyof typeof categoryOrder] ?? 2;
        if (aOrder !== bOrder) {
          return aOrder - bOrder;
        }
        // Within same category, sort by date (newest first)
        return new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime();
      });
    } else {
      // Sort by date (newest first)
      // For sent page: simple date sort (no special waiting handling)
      if (currentFilter === 'sent') {
        return result.sort((a, b) => {
          return new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime();
        });
      }

      // For other pages: keep waiting emails at top, then needs-attention, then regular
      return result.sort((a, b) => {
        // Waiting emails come first
        const aIsWaiting = isWaitingAndReady(a);
        const bIsWaiting = isWaitingAndReady(b);
        if (aIsWaiting !== bIsWaiting) {
          return aIsWaiting ? -1 : 1;
        }

        // Within waiting emails, sort by days waiting (oldest first = most urgent)
        if (aIsWaiting && bIsWaiting) {
          const aDays = a.waiting_on_reply_since ? new Date(a.waiting_on_reply_since).getTime() : 0;
          const bDays = b.waiting_on_reply_since ? new Date(b.waiting_on_reply_since).getTime() : 0;
          return aDays - bDays; // Oldest first (most overdue)
        }

        // Needs-attention emails come next
        const aAttention = getNeedsAttentionScore(a);
        const bAttention = getNeedsAttentionScore(b);
        if (aAttention !== bAttention) {
          return bAttention - aAttention; // Higher score first
        }

        // For regular emails, sort by date (newest first)
        return new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime();
      });
    }
  }, [currentFilter, sentEmails, emails, convertToUIEmail, convertSentEmailToUI, sortMode, isFocusMode, searchQuery]
  );

  // Calculate actual inbox count (emails not archived/saved/deleted)
  // Use useMemo to avoid recalculating on every render
  const inboxCount = React.useMemo(() => {
    // When in inbox view, count only regular inbox emails (exclude follow-up suggested emails)
    if (currentFilter === 'inbox') {
      const now = new Date();
      // Count regular inbox emails (not the overdue sent emails)
      const regularInboxCount = emails
        .filter(email => {
          if (email.status === 'Deleted') return false;
          if (isFocusMode) {
            if (email.status === 'Archived' || email.status === 'Saved') return false;
            let requiresReply: boolean | null = null;
            if (typeof window !== 'undefined' && (window as any).emailQuestionData) {
              const data = (window as any).emailQuestionData.get(email.id);
              if (data?.loaded) {
                requiresReply = data.requiresReply === true;
              }
            }
            if (requiresReply === true) return true;
            if (requiresReply === false) return false;
            if (email.category === 'Urgent' || email.category === 'Important') return true;
            return false;
          }
          return email.status !== 'Archived' && email.status !== 'Saved';
        })
        .length;
      return regularInboxCount;
    }
    // Otherwise, count all non-archived/non-saved emails
    return emails.filter(email => {
      return email.status !== 'Archived' && email.status !== 'Saved' && email.status !== 'Deleted';
    }).length;
  }, [emails, filteredEmails, currentFilter, isFocusMode]);

  useEffect(() => {
    // Initialize authentication state on app load
    const initAuth = async () => {
      // Load theme from settings first
      await loadThemeFromSettings();

      // Start OAuth server automatically (Tauri only)
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const { isTauri } = await import('@tauri-apps/api/core');
        // Check if we're running in Tauri by attempting to invoke
        const started = await invoke<boolean>('start_oauth_server');
        console.log('OAuth server auto-start:', started ? 'started' : 'already running or not available');
      } catch (e) {
        // Not in Tauri environment or command failed
        console.log('OAuth server auto-start skipped (not in Tauri):', (e as Error).message);
      }

      await initialize();
      // After auth is initialized, start fetching emails
      // DEV MODE: disabled to use mock data instead
      // if (isAuthenticated) {
      //   fetchEmails();
      // }

      // Initialize the reminder checker for auto-reminders
      if (isAuthenticated) {
        const { initializeReminderChecker, loadMockWaitingEmails } = useEmailStore.getState();
        initializeReminderChecker();

        // Load mock waiting-on-reply emails for testing
        console.log('[App] Loading mock waiting emails...');
        loadMockWaitingEmails();
      }
    };

    initAuth();
  }, [initialize, isAuthenticated, loadThemeFromSettings]);

  // Set up polling for new emails - only poll when window is focused to reduce load
  // DEV MODE: disabled to use mock data
  /*
  useEffect(() => {
    if (!isAuthenticated) return;

    let interval: NodeJS.Timeout | null = null;

    const startPolling = () => {
      if (interval) clearInterval(interval);
      interval = setInterval(() => {
        fetchEmails();
      }, 30000); // Poll every 30 seconds
    };

    const stopPolling = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };

    // Handle window focus/blur
    const handleFocus = () => {
      fetchEmails(); // Fetch immediately when window gains focus
      startPolling();
    };

    const handleBlur = () => {
      stopPolling();
    };

    // Start polling initially
    startPolling();

    // Listen for focus/blur events
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', handleFocus);
      window.addEventListener('blur', handleBlur);
    }

    return () => {
      stopPolling();
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', handleFocus);
        window.removeEventListener('blur', handleBlur);
      }
    };
  }, [isAuthenticated, fetchEmails]);
  */

  // Cleanup reminder checker on unmount
  useEffect(() => {
    return () => {
      const { cleanupReminderChecker } = useEmailStore.getState();
      cleanupReminderChecker();
    };
  }, []);

  // Set up notification click handler to focus window
  useEffect(() => {
    const setupNotificationListener = async () => {
      if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__) {
        try {
          const { getCurrentWindow } = await import('@tauri-apps/api/window');
          const { listen } = await import('@tauri-apps/api/event');
          const { isPermissionGranted, requestPermission } = await import('@tauri-apps/plugin-notification');

          // Request notification permission
          const permitted = await isPermissionGranted();
          if (!permitted) {
            await requestPermission();
          }

          // Listen for notification clicks
          const unlisten = await listen('notification-clicked', () => {
            getCurrentWindow().setFocus(true);
            getCurrentWindow().unminimize();
          });

          return () => {
            unlisten.then(fn => fn());
          };
        } catch (e) {
          console.error('Failed to set up notification listener:', e);
        }
      }
    };

    const cleanupPromise = setupNotificationListener();
    return () => {
      cleanupPromise.then(cleanup => cleanup?.());
    };
  }, []);

  // Find selected email - first in filtered emails, then fall back to all emails and sent emails
  // This allows viewing thread emails that aren't in the current filter (e.g., sent replies in a thread)
  const selectedEmail = filteredEmails.find(email => email.id === selectedEmailId) ||
    (() => {
      // Try to find in regular emails
      const emailFromStore = emails.find(email => email.id === selectedEmailId && email.status !== 'Deleted');
      if (emailFromStore) return convertToUIEmail(emailFromStore);

      // Try to find in sent emails
      const sentEmail = sentEmails.find(email => email.id === selectedEmailId);
      if (sentEmail) return convertSentEmailToUI(sentEmail);

      return undefined;
    })();

  // Reset response options when email changes
  useEffect(() => {
    setShowResponseOptions(false);
  }, [selectedEmailId]);

  // Measure analysis panel height to position email panel correctly
  // Use ResizeObserver to detect size changes (e.g., when meeting suggestions expand)
  useEffect(() => {
    if (!analysisPanelRef.current || !selectedEmail) return;

    const updateHeight = () => {
      if (analysisPanelRef.current) {
        const rect = analysisPanelRef.current.getBoundingClientRect();
        const height = rect.height || analysisPanelRef.current.offsetHeight;
        console.log('Analysis panel height:', height);
        setAnalysisPanelHeight(height);
      }
    };

    // Initial measurement
    updateHeight();

    // Set up ResizeObserver to detect size changes
    const resizeObserver = new ResizeObserver(() => {
      updateHeight();
    });

    resizeObserver.observe(analysisPanelRef.current);

    // Cleanup
    return () => {
      resizeObserver.disconnect();
    };
  }, [selectedEmail, animationPhase]);

  // Chat keyboard shortcut (Cmd+J)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+J or Ctrl+J to toggle chat
      if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
        e.preventDefault();
        if (isChatOpen) {
          closeChatPanel();
        } else {
          openChatPanel();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isChatOpen, openChatPanel, closeChatPanel]);

  // Handle chat compose data to open AIComposeModal with pre-filled data
  useEffect(() => {
    if (chatComposeData) {
      setIsComposeModalOpen(true);
    }
  }, [chatComposeData]);

  const handleEmailAction = (emailId: string, action: string) => {
    console.log(`Email ${emailId}: ${action}`);
    // Find email in both emails and sentEmails arrays
    const email = emails.find(e => e.id === emailId) || sentEmails.find(e => e.id === emailId);

    switch (action) {
      case 'save': {
        // Toggle save status
        if (email) {
          const newStatus = email.status === 'Saved' ? 'Unhandled' : 'Saved';
          console.log('[handleEmailAction] Saving email:', { emailId, currentStatus: email.status, newStatus, subject: email.subject });
          updateEmailStatus(emailId, newStatus);
        }
        break;
      }
      case 'archive': {
        // Toggle archive status
        if (email) {
          const newStatus = email.status === 'Archived' ? 'Unhandled' : 'Archived';
          updateEmailStatus(emailId, newStatus);
        }
        break;
      }
      case 'delete': {
        // For waiting-on-reply emails in inbox: dismiss (cancel reminder)
        // For waiting-on-reply emails in sent view: delete normally
        // For regular emails: delete
        if (email) {
          if (email.waiting_on_reply_since && currentFilter === 'inbox') {
            // This is a waiting-on-reply email in inbox - dismiss the reminder
            const { cancelReminder } = useEmailStore.getState();
            cancelReminder(emailId);

            // Show toast
            const toastId = `dismiss-${emailId}-${Date.now()}`;
            setToasts(prev => [...prev, {
              id: toastId,
              message: 'Undo',
              duration: 3000,
            }]);
          } else {
            // Regular email OR waiting email in sent view - delete with undo
            const previousStatus = email.status;
            // Immediately mark as Deleted so it disappears from the list
            updateEmailStatus(emailId, 'Deleted');

            // Check if this email is part of a thread
            const threadId = email.thread_id || email.id;
            // Count how many emails are in this thread
            const allEmailsInThread = [...emails, ...sentEmails].filter(e =>
              (e.thread_id || e.id) === threadId
            );
            const isThreadDeletion = allEmailsInThread.length > 1;

            // Show toast with undo option
            const toastId = `delete-${emailId}-${Date.now()}`;
            const message = 'Undo';

            setToasts(prev => [...prev, {
              id: toastId,
              message,
              duration: 5000,
              undo: () => {
                // Restore previous status
                updateEmailStatus(emailId, previousStatus as 'Unhandled' | 'Saved' | 'Replied' | 'Archived' | 'Deleted');
              },
            }]);
          }
        }
        break;
      }
    }
  };

  // Bulk action handlers with undo toast
  const handleBulkDeleteWithUndo = async (emailIds: string[]) => {
    const idsToDelete = emailIds.length > 0 ? emailIds : Array.from(useEmailStore.getState().selectedEmailIds);
    if (idsToDelete.length === 0) return;

    // Separate waiting-on-reply emails in inbox (to be dismissed) from emails to be deleted
    const waitingEmailIdsToDismiss: string[] = [];
    const regularEmailIds: string[] = [];

    for (const emailId of idsToDelete) {
      const email = emails.find(e => e.id === emailId) || sentEmails.find(e => e.id === emailId);
      // Only dismiss waiting emails in inbox, not in sent view
      if (email?.waiting_on_reply_since && currentFilter === 'inbox') {
        waitingEmailIdsToDismiss.push(emailId);
      } else {
        regularEmailIds.push(emailId);
      }
    }

    // Store previous statuses for undo (only for emails being deleted)
    const previousStatuses = new Map<string, string>();
    const threadIds = new Set<string>();

    for (const emailId of regularEmailIds) {
      const email = emails.find(e => e.id === emailId) || sentEmails.find(e => e.id === emailId);
      if (email) {
        previousStatuses.set(emailId, email.status);
        if (email.thread_id) {
          threadIds.add(email.thread_id);
        }
      }
    }

    // Cancel reminders for waiting-on-reply emails in inbox (dismiss, don't delete)
    const { cancelReminder } = useEmailStore.getState();
    for (const emailId of waitingEmailIdsToDismiss) {
      cancelReminder(emailId);
    }

    // Mark regular emails (and waiting emails in sent view) as deleted
    for (const emailId of regularEmailIds) {
      await updateEmailStatus(emailId, 'Deleted');
    }

    // Clear selection
    useEmailStore.getState().clearSelection();

    // Determine if we're deleting threads or individual emails
    const threadCount = threadIds.size;
    const isThreadDeletion = threadCount > 0;

    // Show toast with undo option
    const toastId = `bulk-delete-${Date.now()}`;
    const message = 'Undo';

    setToasts(prev => [...prev, {
      id: toastId,
      message,
      duration: 5000,
      undo: () => {
        // Restore previous statuses for deleted regular emails (undo dismiss for waiting emails is not supported)
        for (const [emailId, previousStatus] of previousStatuses) {
          updateEmailStatus(emailId, previousStatus as 'Unhandled' | 'Saved' | 'Replied' | 'Archived' | 'Deleted');
        }
      },
    }]);

  };

  const dismissToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const handleCompose = () => {
    setIsComposeModalOpen(true);
  };

  const handleAICompose = () => {
    console.log('Open AI compose modal');
    // Open AI-powered compose modal
  };

  const handleQuickSearch = () => {
    console.log('Open quick search');
    // Open quick search modal
  };

  const handleVoiceCompose = () => {
    console.log('Start voice compose');
    // Start voice recognition for composing
  };

  const handleBump = async (emailData: any, allThreadEmails: any[], threadEmail: any, instruction?: string) => {
    const emailId = emailData.id;
    setBumpGenerating(emailId);
    try {
      // Build thread context for AI
      const threadContext = allThreadEmails.map((te: any) => {
        const isSent = sentEmails.find(e => e.id === te.id);
        const data = isSent ? convertSentEmailToUI(te) : convertToUIEmail(te);
        return `${isSent ? 'You' : data.from?.name || 'Them'} (${new Date(te.date || 0).toLocaleDateString()}):\n${te.body_text || te.content || data.content || '(no content)'}`;
      }).join('\n\n---\n\n');

      const recipient = emailData.recipients || threadEmail.recipients || '';
      const subject = emailData.subject || threadEmail.subject || '';

      const prompt = `You are writing a short, friendly follow-up email. The user sent an email and hasn't received a response yet. Based on the thread below, write a brief follow-up that politely bumps the conversation.

Thread context:
${threadContext}

Subject: ${subject}
Recipient: ${recipient}

Rules:
- Keep it short (2-4 sentences)
- Be polite and professional but not overly formal
- Reference the original email naturally
- Don't be pushy
- Return ONLY the email body text, no subject line or greeting/sign-off headers
${instruction ? `\nAdditional instructions from user: ${instruction}` : ''}`;

      const generated = await editReply('', prompt);
      setBumpDraft({
        emailId,
        threadId: threadEmail.thread_id || threadEmail.id,
        recipient,
        subject: subject.startsWith('Re: ') ? subject : `Re: ${subject}`,
        body: generated,
      });
    } catch (error) {
      console.error('Failed to generate bump:', error);
      alert('Failed to generate follow-up. Please try again.');
    } finally {
      setBumpGenerating(null);
    }
  };

  const handleOpenFocusedView = () => {
    if (focusedEmailId || selectedEmailId) {
      // Clear any locked position when opening
      setEmailPanelTopPosition(null);
      setIsAnimatingToFocused(true);
      setAnimationPhase('slideLeft');

      // After slide completes, extend analysis panel down
      setTimeout(() => {
        setAnimationPhase('expand');
      }, 500);
    }
  };

  const handleCloseFocusedView = () => {
    if (animationPhase === 'expand') {
      // Lock to the actual analysis panel height so email panel ends up in the right place
      setEmailPanelTopPosition(analysisPanelHeight);

      // First reverse the expansion - email panel slides down to analysis panel height
      setAnimationPhase('slideLeft');
      setTimeout(() => {
        // Then analysis panel slides back to right (email panel stays at same position)
        setIsClosingAnimation(true);
        setAnimationPhase('idle');
        // Clear the closing flag and locked position after animation completes
        setTimeout(() => {
          setIsClosingAnimation(false);
          setEmailPanelTopPosition(null);
        }, 500);
      }, 200);
    } else if (animationPhase === 'slideLeft') {
      // Already in slideLeft - lock to analysis panel height
      setEmailPanelTopPosition(analysisPanelHeight);

      setIsClosingAnimation(true);
      setAnimationPhase('idle');
      setTimeout(() => {
        setIsClosingAnimation(false);
        setEmailPanelTopPosition(null);
      }, 500);
    }
  };

  // Close on Escape key or Enter when in focused view
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (animationPhase === 'slideLeft' || animationPhase === 'expand') {
        if (e.key === 'Escape' || e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          handleCloseFocusedView();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown, true); // Use capture phase
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [animationPhase]);

  // Show loading screen while checking authentication
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="flex items-center justify-center mb-6">
            <img
              src={logo}
              alt="Aiden Logo"
              className="h-16 w-16 animate-pulse"
            />
          </div>
          <div className="w-10 h-10 border-3 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted text-base">Loading Aiden...</p>
        </div>
      </div>
    );
  }

  return (
    <OAuthHandler>
      <Routes>
        {/* Root path redirect */}
        <Route path="/" element={<Navigate to="/dashboard" replace />} />

      {/* Login route */}
      <Route
        path="/login"
        element={
          isAuthenticated ? <Navigate to="/dashboard" replace /> : <Login />
        }
      />

      {/* Dashboard and main app routes - protected */}
      <Route
        path="/dashboard"
        element={
          isAuthenticated ? (
            <>
              <div className="h-screen bg-background overflow-hidden flex flex-col min-w-0">
              {/* Top Navigation Bar */}
              <div className="h-14 bg-surface border-b border-border flex items-center justify-between pl-2 pr-4 z-10 flex-shrink-0 min-w-0">
                <div className="flex items-center gap-0 min-w-0">
                  {/* Back button - shows during focused view */}
                  {(animationPhase === 'slideLeft' || animationPhase === 'expand') && (
                    <button
                      onClick={handleCloseFocusedView}
                      className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-600 dark:text-gray-400 mr-2"
                      title="Go back (Esc)"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                  )}
                  <img
                    src={logo}
                    alt="Aiden Logo"
                    className="h-8 w-8 flex-shrink-0"
                  />
                  <h1 className="text-lg font-bold text-gray-900 dark:text-white truncate">Aiden</h1>
                  <span className="ml-2 text-sm text-gray-500 hidden sm:block truncate">
                    {user ? user.email : 'Not logged in'}
                  </span>
                </div>

                <div className="flex-1 max-w-xl mx-4 hidden md:flex items-center gap-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search emails..."
                      className="w-full pl-10 pr-4 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all duration-200"
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery('')}
                        className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCompose}
                    className="flex-shrink-0 hover:bg-white dark:hover:bg-white/10"
                  >
                    <PenSquare className="h-4 w-4 mr-1.5" />
                    Compose
                  </Button>
                </div>

                <div className="flex items-center space-x-1 flex-shrink-0">
                  <Link to="/crm">
                    <Button variant="ghost" size="icon" className="h-8 w-8" title="Relationship Intelligence">
                      <Users className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                    </Button>
                  </Link>
                  <Link to="/calendar">
                    <Button variant="ghost" size="icon" className="h-8 w-8" title="Calendar">
                      <CalendarIcon className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                    </Button>
                  </Link>
                  <Link to="/settings">
                    <Button variant="ghost" size="icon" className="h-8 w-8" title="Settings">
                      <SettingsIcon className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                    </Button>
                  </Link>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 sm:px-3 text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                    onClick={signOut}
                  >
                    <LogOut className="h-4 w-4 sm:mr-1" />
                    <span className="text-sm hidden sm:inline">Sign Out</span>
                  </Button>
                </div>
              </div>

              {/* Main Content Area */}
              <div className={`flex h-[calc(100vh-3.5rem)] overflow-hidden relative transition-all duration-300 ease-in-out ${isChatOpen ? 'mr-[400px]' : ''}`} id="main-content-area">
                {/* Sidebar */}
                <div className={`h-full flex-shrink-0 transition-all duration-500 ease-in-out overflow-hidden ${
                  animationPhase === 'idle' ? '' :
                  '-translate-x-full'
                }`}>
                  <Sidebar inboxCount={inboxCount} />
                </div>

                {/* Email List */}
                <div className={`h-full overflow-hidden flex-shrink-0 w-80 min-w-60 max-w-96 border-r border-gray-200/60 dark:border-gray-700/60 transition-all duration-500 ease-in-out ${
                  animationPhase === 'idle' ? '' :
                  '-translate-x-[20rem]'
                }`}>
                  {/* Smart Triage View */}
                  {currentFilter === 'triage' ? (
                    <div className="h-full overflow-y-auto">
                      <SmartTriage
                        onAction={handleEmailAction}
                        onEmailSelect={(emailId) => setSelectedEmailId(emailId)}
                      />
                    </div>
                  ) : filteredEmails.length === 0 && !emailsLoading ? (
                    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
                      <Mail className="h-12 w-12 text-gray-400 mb-4" />
                      <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                        {currentFilter === 'sent' ? 'No sent emails yet' :
                         currentFilter === 'saved' ? 'No saved emails yet' :
                         currentFilter === 'archived' ? 'No archived emails yet' :
                         isFocusMode && currentFilter === 'inbox' ? 'No action-required emails' :
                         'No new emails yet'}
                      </h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {currentFilter === 'sent'
                          ? 'Emails you send will appear here.'
                          : currentFilter === 'saved'
                          ? 'Emails you bookmark will appear here.'
                          : currentFilter === 'archived'
                          ? 'Emails you archive will appear here.'
                          : isFocusMode && currentFilter === 'inbox'
                          ? 'Emails requiring action will appear here.'
                          : 'Emails that arrive will appear here.'}
                      </p>
                    </div>
                  ) : (
                    <div className="h-full flex flex-col">
                      {/* Sort and view mode toggle - only show for non-triage views */}
                      {currentFilter !== 'triage' && (
                        <div className="px-2 py-2 border-b border-gray-200 dark:border-gray-700">
                          <div className="flex items-center justify-center gap-1 flex-wrap">
                            {/* Sort options */}
                            <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
                              <button
                                onClick={() => setSortMode('date')}
                                className={`px-2 py-1 text-xs rounded flex items-center gap-1 transition-colors ${
                                  sortMode === 'date'
                                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                                }`}
                                title="Sort by date"
                              >
                                <ArrowDownAZ className="w-3 h-3" />
                                <span className="hidden sm:inline">Date</span>
                              </button>
                              <button
                                onClick={() => setSortMode('importance')}
                                className={`px-2 py-1 text-xs rounded flex items-center gap-1 transition-colors ${
                                  sortMode === 'importance'
                                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                                }`}
                                title="Sort by importance"
                              >
                                <Signal className="w-3 h-3" />
                                <span className="hidden sm:inline">Importance</span>
                              </button>
                            </div>
                            {/* View options */}
                            <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
                              <button
                                onClick={() => setViewMode('individual')}
                                className={`px-2 py-1 text-xs rounded flex items-center gap-1 transition-colors ${
                                  viewMode === 'individual'
                                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                                }`}
                                title="List view"
                              >
                                <Mail className="w-3 h-3" />
                                <span className="hidden sm:inline">List</span>
                              </button>
                              <button
                                onClick={() => setViewMode('threaded')}
                                className={`px-2 py-1 text-xs rounded flex items-center gap-1 transition-colors ${
                                  viewMode === 'threaded'
                                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                                }`}
                                title="Threaded view"
                              >
                                <MessageSquare className="w-3 h-3" />
                                <span className="hidden sm:inline">Thread</span>
                              </button>
                            </div>
                            {/* Focus Mode button - only show in inbox */}
                            {currentFilter === 'inbox' && (
                              <button
                                onClick={() => setIsFocusMode(!isFocusMode)}
                                className={`p-1 text-xs rounded flex items-center justify-center transition-colors cursor-pointer ${
                                  isFocusMode
                                    ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                                    : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                                }`}
                                title="Focus Mode - only important emails"
                              >
                                <Target className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                      {viewMode === 'threaded' ? (
                        <ThreadedEmailList
                          emails={filteredEmails}
                          selectedEmailId={selectedEmailId}
                          onEmailSelect={(id) => {
                            setSelectedEmailId(id);
                            setFocusedEmailId(id);
                          }}
                          onEmailAction={handleEmailAction}
                          focusedEmailId={focusedEmailId}
                          onFocusEmail={setFocusedEmailId}
                          onOpenFocusedView={handleOpenFocusedView}
                          sortMode={sortMode}
                          onBulkDelete={handleBulkDeleteWithUndo}
                          currentFilter={currentFilter}
                        />
                      ) : (
                        <EmailList
                          emails={filteredEmails}
                          selectedEmailId={selectedEmailId}
                          onEmailSelect={(id) => {
                            setSelectedEmailId(id);
                            setFocusedEmailId(id);
                          }}
                          onEmailAction={handleEmailAction}
                          focusedEmailId={focusedEmailId}
                          onFocusEmail={setFocusedEmailId}
                          onBulkDelete={handleBulkDeleteWithUndo}
                          onTriggerReply={() => {
                            // Select the email first if not selected
                            if (focusedEmailId && focusedEmailId !== selectedEmailId) {
                              setSelectedEmailId(focusedEmailId);
                            }
                            // Scroll to the reply section
                            setTimeout(() => {
                              const replySection = document.querySelector('[data-reply-section]') as HTMLElement;
                              if (replySection) {
                                replySection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                              }
                            }, 100);
                          }}
                          onOpenFocusedView={handleOpenFocusedView}
                          onBump={(emailId) => {
                            // Select the email and trigger bump
                            setSelectedEmailId(emailId);
                            setFocusedEmailId(emailId);
                            // Find the sent email and its thread to trigger bump
                            const sentEmail = sentEmails.find(e => e.id === emailId);
                            if (!sentEmail) return;
                            const threadId = sentEmail.thread_id || sentEmail.id;
                            const allThreadEmails = [
                              ...emails.filter(e => e.thread_id === threadId || e.id === threadId),
                              ...sentEmails.filter(e => e.thread_id === threadId || e.id === threadId)
                            ].sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime());
                            const emailData = convertSentEmailToUI(sentEmail);
                            handleBump(emailData, allThreadEmails, sentEmail);
                          }}
                        />
                      )}
                    </div>
                  )}
                </div>

                {/* Email Content Area - always render the same structure to avoid unmounting/remounting */}
                <div className={`flex-1 min-w-0 flex flex-col relative`}>
                  {selectedEmail ? (
                    <>
                      {/* Email Content Display - always visible */}
                      <div
                        className="p-6 overflow-y-auto bg-white dark:bg-gray-800"
                        style={
                          (() => {
                            const isClosing = animationPhase === 'slideLeft' && !isAnimatingToFocused;

                            // Use locked position during closing animation, otherwise use measured height
                            const topPosition = emailPanelTopPosition !== null
                              ? `${emailPanelTopPosition}px`
                              : analysisPanelHeight
                                ? `${analysisPanelHeight}px`
                                : '50%';

                            if (animationPhase === 'idle') {
                              // No transition in idle to avoid animation when switching emails
                              return { position: 'absolute', left: '0', right: '0', top: topPosition, bottom: '0', transition: 'none' };
                            } else if (animationPhase === 'slideLeft') {
                              return { position: 'absolute', left: '0', right: '0', top: topPosition, bottom: '0', transition: isClosing ? 'none' : 'top 0.2s ease-out' };
                            } else {
                              // expand phase - email panel fills the whole height
                              return { position: 'absolute', left: '0', right: '0', top: '0', bottom: '0', transition: 'top 0.2s ease-out' };
                            }
                          })()
                        }
                      >
                          <div className="max-w-4xl mx-auto">
                            {/* Check if this is a sent email - show full thread */}
                            {sentEmails.find(e => e.id === selectedEmail.id) ? (
                              <>
                                {/* Thread view for sent emails */}
                                {(() => {
                                  const threadId = selectedEmail.thread_id;
                                  console.log('[Sent Thread View] selectedEmail:', { id: selectedEmail.id, thread_id: threadId, subject: selectedEmail.subject });
                                  if (!threadId) return null;

                                  // Get all emails in this thread (both received and sent)
                                  const allThreadEmails = [
                                    ...emails.filter(e => e.thread_id === threadId || e.id === threadId),
                                    ...sentEmails.filter(e => e.thread_id === threadId || e.id === threadId)
                                  ].sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime());

                                  console.log('[Sent Thread View] Thread emails found:', allThreadEmails.map(e => ({ id: e.id, thread_id: e.thread_id, subject: e.subject, date: e.date, isSent: !!sentEmails.find(se => se.id === e.id) })));

                                  return (
                                    <div className="space-y-6">
                                      {allThreadEmails.map((threadEmail, idx) => {
                                        const isSent = sentEmails.find(e => e.id === threadEmail.id);
                                        const emailData = isSent ? convertSentEmailToUI(threadEmail) : convertToUIEmail(threadEmail);

                                        return (
                                          <div key={threadEmail.id} className={`border-l-4 ${isSent ? 'border-blue-400 bg-blue-50/30 dark:bg-blue-900/20' : 'border-gray-200 dark:border-gray-700'} pl-4 py-2`}>
                                            <div className="mb-2">
                                              <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2 text-sm">
                                                  <span className={`font-medium ${isSent ? 'text-blue-700 dark:text-blue-300' : 'text-gray-900 dark:text-white'}`}>
                                                    {isSent ? `To: ${emailData.recipients || threadEmail.recipients}` : `${emailData.from?.name || 'Unknown'} <${emailData.from?.email || ''}>`}
                                                  </span>
                                                  <span className="text-gray-500">•</span>
                                                  <span className="text-gray-500">{new Date(threadEmail.date || 0).toLocaleString()}</span>
                                                  {isSent && (
                                                    <span className="text-xs px-2 py-0.5 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded">Sent</span>
                                                  )}
                                                </div>
                                                {isSent && (
                                                  <div className="ml-4 pr-4">
                                                    <Button
                                                      variant="outline"
                                                      size="sm"
                                                      disabled={bumpGenerating === emailData.id}
                                                      onClick={() => handleBump(emailData, allThreadEmails, threadEmail)}
                                                      className="hover:bg-white dark:hover:bg-white/10 text-xs py-1 h-7"
                                                    >
                                                      {bumpGenerating === emailData.id ? (
                                                        <>
                                                          <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-current mr-1" />
                                                          Generating...
                                                        </>
                                                      ) : (
                                                        <>
                                                          <Send className="h-3 w-3 mr-1" />
                                                          Bump
                                                        </>
                                                      )}
                                                    </Button>
                                                  </div>
                                                )}
                                              </div>
                                            </div>
                                            <div className="prose prose-sm max-w-none dark:prose-invert">
                                              {emailData.bodyHtml || emailData.body_html ? (
                                                <div className="email-html-content" dangerouslySetInnerHTML={{ __html: emailData.bodyHtml || emailData.body_html || '' }} />
                                              ) : (
                                                <div className="whitespace-pre-wrap text-foreground">
                                                  {(emailData.content || '').startsWith(emailData.subject)
                                                    ? emailData.content.substring(emailData.subject.length).trim()
                                                    : (emailData.content || '')}
                                                </div>
                                              )}
                                            </div>
                                            {/* Show attachments for this email in thread */}
                                            {emailData.attachments && emailData.attachments.length > 0 && (
                                              <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                                                <div className="flex items-center gap-2 mb-2">
                                                  <Paperclip className="w-4 h-4 text-gray-500" />
                                                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                                                    {emailData.attachments.length} attachment{emailData.attachments.length > 1 ? 's' : ''}
                                                  </span>
                                                </div>
                                                {emailData.attachments.map((attachment: any) => (
                                                  <AttachmentItem
                                                    key={attachment.id}
                                                    attachment={attachment}
                                                    messageId={emailData.id}
                                                    emailSubject={emailData.subject}
                                                    emailSender={`${emailData.from?.name || ''} <${emailData.from?.email || ''}>`.trim()}
                                                    emailBody={emailData.body || emailData.content || emailData.snippet}
                                                    emailSummary={emails.find(e => e.id === emailData.id)?.summary}
                                                  />
                                                ))}
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  );
                                })()}
                                {/* Bump draft review */}
                                {bumpDraft && sentEmails.find(e => e.id === selectedEmail.id) && (
                                  <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                                    <div className="flex items-center justify-between mb-3">
                                      <span className="text-sm font-medium text-blue-700 dark:text-blue-300">AI Follow-Up Draft</span>
                                      <button
                                        onClick={() => setBumpDraft(null)}
                                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                                      >
                                        <X className="h-4 w-4" />
                                      </button>
                                    </div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                                      To: {bumpDraft.recipient} &middot; {bumpDraft.subject}
                                    </div>
                                    <textarea
                                      value={bumpDraft.body}
                                      onChange={(e) => setBumpDraft({ ...bumpDraft, body: e.target.value })}
                                      className="w-full min-h-[100px] p-3 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800/50 rounded-lg border border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y mb-3"
                                    />
                                    <div className="flex items-center gap-2">
                                      <Button
                                        size="sm"
                                        onClick={async () => {
                                          try {
                                            await useEmailStore.getState().sendEmail(
                                              bumpDraft.recipient,
                                              bumpDraft.subject,
                                              bumpDraft.body,
                                              bumpDraft.emailId,
                                            );
                                            setBumpDraft(null);
                                          } catch (error) {
                                            console.error('Failed to send bump:', error);
                                            alert('Failed to send follow-up.');
                                          }
                                        }}
                                      >
                                        <Send className="h-3 w-3 mr-1" />
                                        Send
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => setBumpDraft(null)}
                                      >
                                        Cancel
                                      </Button>
                                      <input
                                        type="text"
                                        value={bumpInstruction}
                                        onChange={(e) => setBumpInstruction(e.target.value)}
                                        placeholder="Instructions for regeneration..."
                                        className="flex-1 min-w-0 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400"
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter' && !bumpGenerating) {
                                            const threadId = selectedEmail.thread_id;
                                            if (!threadId) return;
                                            const te = [
                                              ...emails.filter(em => em.thread_id === threadId || em.id === threadId),
                                              ...sentEmails.filter(em => em.thread_id === threadId || em.id === threadId)
                                            ].sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime());
                                            const lastSent = [...te].reverse().find(em => sentEmails.find(se => se.id === em.id));
                                            if (lastSent) {
                                              handleBump(convertSentEmailToUI(lastSent), te, lastSent, bumpInstruction || undefined);
                                              setBumpInstruction('');
                                            }
                                          }
                                        }}
                                      />
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={bumpGenerating !== null}
                                        onClick={() => {
                                          const threadId = selectedEmail.thread_id;
                                          if (!threadId) return;
                                          const te = [
                                            ...emails.filter(em => em.thread_id === threadId || em.id === threadId),
                                            ...sentEmails.filter(em => em.thread_id === threadId || em.id === threadId)
                                          ].sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime());
                                          const lastSent = [...te].reverse().find(em => sentEmails.find(se => se.id === em.id));
                                          if (lastSent) {
                                            handleBump(convertSentEmailToUI(lastSent), te, lastSent, bumpInstruction || undefined);
                                            setBumpInstruction('');
                                          }
                                        }}
                                      >
                                        {bumpGenerating ? (
                                          <>
                                            <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-current mr-1" />
                                            Regenerating...
                                          </>
                                        ) : (
                                          <>
                                            <Sparkles className="h-3 w-3 mr-1" />
                                            Regenerate
                                          </>
                                        )}
                                      </Button>
                                    </div>
                                  </div>
                                )}
                              </>
                            ) : (
                              <>
                                {/* Single email view for regular inbox emails */}
                                <div className="mb-6">
                                  <div className="flex items-start justify-between">
                                    <h2 className="text-2xl font-bold text-foreground mb-2">{selectedEmail.subject}</h2>
                                    <div className="flex items-center gap-2">
                                      {/* Respond button - only show when viewing inbox emails, not sent */}
                                      {selectedEmailId && !sentEmails.find(e => e.id === selectedEmailId) && !showResponseOptions && (
                                        <button
                                          onClick={() => setShowResponseOptions(true)}
                                          className="flex-shrink-0"
                                          title="Respond to this email"
                                        >
                                          <MessageSquare className="w-5 h-5 text-gray-400 hover:text-gray-600 transition-colors" />
                                        </button>
                                      )}
                                      {/* Archive button */}
                                      <button
                                        onClick={() => {
                                          const fullEmail = emails.find(e => e.id === selectedEmail.id);
                                          if (fullEmail?.status === 'Archived') {
                                            updateEmailStatus(selectedEmail.id, 'Unhandled');
                                          } else {
                                            updateEmailStatus(selectedEmail.id, 'Archived');
                                          }
                                        }}
                                        className="flex-shrink-0"
                                        title="Archive email"
                                      >
                                        <Archive
                                          className={`w-5 h-5 ${emails.find(e => e.id === selectedEmail.id)?.status === 'Archived' ? 'text-purple-500 fill-purple-500' : 'text-gray-400 hover:text-gray-600'} transition-colors`}
                                        />
                                      </button>
                                      {/* Save button */}
                                      <button
                                        onClick={() => {
                                          const fullEmail = emails.find(e => e.id === selectedEmail.id);
                                          if (fullEmail?.status === 'Saved') {
                                            updateEmailStatus(selectedEmail.id, 'Unhandled');
                                          } else {
                                            updateEmailStatus(selectedEmail.id, 'Saved');
                                          }
                                        }}
                                        className="flex-shrink-0"
                                        title="Save email"
                                      >
                                        <Bookmark
                                          className={`w-5 h-5 ${emails.find(e => e.id === selectedEmail.id)?.status === 'Saved' ? 'fill-purple-500 text-purple-500' : 'text-gray-400 hover:text-gray-600'} transition-colors`}
                                        />
                                      </button>
                                      {/* Bump button - show for all sent emails */}
                                      {selectedEmail.labels?.some((l: any) => l.name === 'Sent') && (
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() => {
                                            // Bump the thread by opening reply with "Bump" context
                                            setShowResponseOptions(true);
                                            setTimeout(() => {
                                              const replyBox = document.querySelector('[data-reply-section] textarea') as HTMLTextAreaElement;
                                              if (replyBox) {
                                                replyBox.value = 'Bump';
                                                replyBox.focus();
                                              }
                                            }, 100);
                                          }}
                                          className="hover:bg-white dark:hover:bg-white/10 text-xs py-1 h-7"
                                        >
                                          <Send className="h-3 w-3 mr-1" />
                                          Bump
                                        </Button>
                                      )}
                                    </div>
                                  </div>
                                  <div className="flex items-center space-x-4 text-sm text-muted">
                                    <span>From: {selectedEmail.from?.name} &lt;{selectedEmail.from?.email}&gt;</span>
                                    <span>{selectedEmail.timestamp}</span>
                                  </div>
                                </div>

                                <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:text-foreground prose-p:text-foreground prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-strong:text-foreground">
                                  {selectedEmail.bodyHtml || selectedEmail.body_html ? (
                                    <div className="email-html-content" dangerouslySetInnerHTML={{ __html: selectedEmail.bodyHtml || selectedEmail.body_html || '' }} />
                                  ) : (
                                    <div className="whitespace-pre-wrap text-foreground">
                                      {(selectedEmail.content || '').startsWith(selectedEmail.subject)
                                        ? selectedEmail.content.substring(selectedEmail.subject.length).trim()
                                        : (selectedEmail.content || '')}
                                    </div>
                                  )}
                                </div>

                                {/* Attachments Section */}
                                {selectedEmail.attachments && selectedEmail.attachments.length > 0 && (
                                  <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
                                    <div className="flex items-center gap-2 mb-4">
                                      <svg className="w-5 h-5 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                                      </svg>
                                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                                        Attachments ({selectedEmail.attachments?.length || 0})
                                      </p>
                                    </div>
                                    <div className="space-y-2">
                                      {selectedEmail.attachments?.map((attachment: any) => {
                                        // Get the full email from store to include AI analysis data
                                        const fullEmail = emails.find(e => e.id === selectedEmail.id);
                                        const fullAttachment = fullEmail?.attachments?.find((a: any) => a.id === attachment.id) || attachment;

                                        return (
                                          <AttachmentItem
                                            key={attachment.id}
                                            attachment={fullAttachment}
                                            messageId={selectedEmail.id}
                                            emailSubject={selectedEmail.subject}
                                            emailSender={`${selectedEmail.from?.name || ''} <${selectedEmail.from?.email || ''}>`.trim()}
                                            emailBody={selectedEmail.body || selectedEmail.content || selectedEmail.snippet}
                                            emailSummary={fullEmail?.summary}
                                          />
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                    </>
                  ) : (
                    // No email selected - show centered message
                    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
                      <Mail className="h-12 w-12 text-gray-400 mb-4" />
                      <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                        Select an email to read
                      </h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        Choose an email from the list to view its contents.
                      </p>
                    </div>
                  )}
                </div>

                {/* Analysis Panel - single instance, always rendered but positioned differently */}
                {selectedEmail && (() => {
                  const isClosing = animationPhase === 'slideLeft' && !isAnimatingToFocused;
                  const shouldTransitionToIdle = isClosingAnimation && animationPhase === 'idle';

                  return (
                    <div
                      ref={analysisPanelRef}
                      id="analysis-panel"
                      className="bg-white dark:bg-gray-800 overflow-y-auto border-b border-gray-200/50 dark:border-gray-700/50"
                      style={
                        animationPhase === 'idle'
                          ? {
                              position: 'absolute',
                              left: '36rem',
                              width: 'calc(100% - 36rem)',
                              top: '0',
                              height: 'auto',
                              maxHeight: '50%',
                              transition: shouldTransitionToIdle ? 'left 0.5s ease-in-out, width 0.5s ease-in-out' : 'none',
                              zIndex: 1
                            }
                          : animationPhase === 'slideLeft'
                          ? {
                              position: 'absolute',
                              left: '0',
                              width: '36rem',
                              top: '0',
                              height: analysisPanelHeight ? `${analysisPanelHeight}px` : 'auto',
                              transition: isClosing ? 'left 0.5s ease-in-out, width 0.5s ease-in-out' : 'left 0.5s ease-in-out, width 0.5s ease-in-out',
                              zIndex: 10
                            }
                          : {
                              position: 'absolute',
                              left: '0',
                              width: '36rem',
                              top: '0',
                              height: '100%',
                              borderBottom: 'none',
                              transition: 'height 0.2s ease-out',
                              zIndex: 10
                            }
                      }
                    >
                    <div className="p-2">
                      <EmailView
                        email={selectedEmail}
                        onReply={() => console.log('Reply to email')}
                        onForward={() => console.log('Forward email')}
                        onDelete={() => console.log('Delete email')}
                        onAction={handleEmailAction}
                        onEmailSelect={(emailId) => setSelectedEmailId(emailId)}
                        focusedView={false}
                        animationPhase={animationPhase}
                        showResponseOptions={showResponseOptions}
                        onShowResponseOptionsChange={setShowResponseOptions}
                      />
                    </div>
                  </div>
                    );
                })()}
              </div>
            </div>
          </>
        ) : (
          <Navigate to="/login" replace />
        )
        }
      />

      {/* Test page route - protected */}
      <Route
        path="/test"
        element={
          isAuthenticated ? (
            <div className="h-screen bg-background overflow-hidden">
              {/* Top Navigation Bar */}
              <div className="h-14 bg-surface border-b border-border flex items-center justify-between px-4 z-10">
                <div className="flex items-center space-x-4">
                  <div className="flex items-center space-x-2">
                    <div className="relative">
                      <Mail className="h-6 w-6 text-primary-500" />
                      <Sparkles className="h-3 w-3 text-ai-500 absolute -top-1 -right-1" />
                    </div>
                    <h1 className="text-xl font-bold text-gray-900 dark:text-white">Aiden - Gmail API Test</h1>
                    <span className="ml-4 text-sm text-gray-500">
                      {user ? `${user.email}` : 'Not logged in'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <Link to="/dashboard">
                    <Button variant="ghost" size="sm" className="h-8">
                      Back to Dashboard
                    </Button>
                  </Link>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-3 text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                    onClick={signOut}
                  >
                    <LogOut className="h-4 w-4 mr-1" />
                    <span className="text-sm">Sign Out</span>
                  </Button>
                </div>
              </div>

              {/* Test Page Content */}
              <div className="h-[calc(100vh-3.5rem)] overflow-auto">
                <TestPage />
              </div>
            </div>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />

      {/* Settings route - protected */}
      <Route
        path="/settings"
        element={
          isAuthenticated ? (
            <SettingsPage />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />

      {/* Calendar route - protected */}
      <Route
        path="/calendar"
        element={
          isAuthenticated ? (
            <Calendar />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />

      {/* CRM route - protected */}
      <Route
        path="/crm"
        element={
          isAuthenticated ? (
            <Crm />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />

      {/* Catch-all route - redirect to login if not authenticated, dashboard if authenticated */}
      <Route
        path="*"
        element={
          <Navigate to={isAuthenticated ? "/dashboard" : "/login"} replace />
        }
      />
      </Routes>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      <AIComposeModal
        isOpen={isComposeModalOpen}
        onClose={() => {
          setIsComposeModalOpen(false);
          clearComposeData();
        }}
        initialTo={chatComposeData?.to}
        initialSubject={chatComposeData?.subject}
        initialBody={chatComposeData?.body}
      />
      <ChatPanel />
    </OAuthHandler>
  );
}

export default App;
