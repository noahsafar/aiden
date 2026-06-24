import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Sidebar } from '@/components/ui/Sidebar';
import { EmailList } from '@/components/ui/EmailList';
import { ThreadedEmailList } from '@/components/ui/ThreadedEmailList';
import { EmailView } from '@/components/ui/EmailView';
import { SmartTriage } from '@/components/ui/SmartTriage';
import { LifeIntel } from '@/pages/LifeIntel';
import { Inbox } from '@/pages/Inbox';
import { AttachmentItem, getFileIcon, formatFileSize, EmailHtmlContent } from '@/components/ui/EmailView';
import { Login } from '@/components/Login';
import { OAuthHandler } from '@/components/OAuthHandler';
import { TestPage } from '@/components/TestPage';
import { Settings as SettingsPage } from '@/pages/Settings';
import { Calendar } from '@/pages/Calendar';
import { Crm } from '@/pages/Crm';
import { Scheduling } from '@/pages/Scheduling';
import { AidenShell } from '@/components/aiden/AidenShell';
import { EmptyState } from '@/components/aiden/primitives';
import { Today } from '@/pages/Today';
import { Relationships } from '@/pages/Relationships';
import { Commitments } from '@/pages/Commitments';
import { Ask } from '@/pages/Ask';
import { Schedule } from '@/pages/Schedule';
import { EmailViewPage } from '@/pages/EmailViewPage';
import { AIComposeModal } from '@/components/email/AIComposeModal';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { ChatTrigger } from '@/components/chat/ChatTrigger';
import { ChatProvider } from '@/contexts/ChatContext';
import { editReply } from '@/api/claude';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ToastContainer, ToastData } from '@/components/ui/Toast';
import { useAuthStore } from '@/stores/authStore';
import { useEmailStore } from '@/stores/emailStore';
import { useThemeStore } from '@/stores/themeStore';
import { useChatStore } from '@/stores/chatStore';
import { Link, useNavigate } from 'react-router-dom';
import {
  Search,
  Mail,
  Users,
  Sparkles,
  LogOut,
  Settings as SettingsIcon,
  Calendar as CalendarIcon,
  Clock,
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
  Lightbulb,
  Mic,
  ChevronDown,
} from 'lucide-react';
import logo from '/aiden-logo.png';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { VoiceOverlay } from '@/components/ui/VoiceOverlay';

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
  deadline?: string;
  requires_reply?: boolean;
  attention_dismissed?: boolean;
  status?: string;
  category?: string;
}

// Reads navigation state ({ focusEmailId }) to open a specific email in the
// inbox. Rendered inside <Routes>, so useLocation() always has Router context.
function InboxDeepLink({ onFocus }: { onFocus: (id: string) => void }) {
  const location = useLocation();
  useEffect(() => {
    const focusEmailId = (location.state as any)?.focusEmailId;
    if (focusEmailId) onFocus(focusEmailId);
  }, [location.state, onFocus]);
  return null;
}

function App() {
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [focusedEmailId, setFocusedEmailId] = useState<string | null>(null);
  const [isComposeModalOpen, setIsComposeModalOpen] = useState(false);
  const composeData = useChatStore((s) => s.composeData);
  const clearComposeData = useChatStore((s) => s.clearComposeData);
  const { signOut, isAuthenticated, isLoading, initialize, user } = useAuthStore();
  const { emails, fetchEmails, loadFromDisk, isLoading: emailsLoading, hasInitialized: emailsInitialized, sentEmails, currentFilter, setCurrentFilter, markAsStarred, updateEmailStatus, viewMode, sortMode, setSortMode, setViewMode, searchQuery, setSearchQuery, getFilteredEmails, readFilter, setReadFilter } = useEmailStore();
  const { loadThemeFromSettings } = useThemeStore();

  // Animation + focus-mode state declared before handleInboxDeepLink so the
  // useCallback dependency array doesn't reference uninitialized variables.
  const [isAnimatingToFocused, setIsAnimatingToFocused] = useState(false);
  const [animationPhase, setAnimationPhase] = useState<'idle' | 'slideLeft' | 'expand'>('idle');
  const [isClosingAnimation, setIsClosingAnimation] = useState(false);
  const [isFocusMode, setIsFocusMode] = useState(false);

  const [showTriage, setShowTriage] = useState(false);

  const handleInboxDeepLink = React.useCallback((focusEmailId: string) => {
    setSelectedEmailId(focusEmailId);
    setFocusedEmailId(focusEmailId);
    setIsFocusMode(true);
  }, []);

  // Reset triage view when leaving inbox
  useEffect(() => {
    if (currentFilter !== 'inbox') setShowTriage(false);
  }, [currentFilter]);
  const [analysisPanelHeight, setAnalysisPanelHeight] = useState(0);
  const [emailPanelTopPosition, setEmailPanelTopPosition] = useState<number | null>(null);
  const [toasts, setToasts] = useState<ToastData[]>([]);

  // Voice command support
  const { isListening, isSupported: voiceSupported, transcript, toggleListening, stopListening } = useSpeechRecognition({
    onResult: (text) => {
      // Voice result handled by chat components
      setToasts(prev => [...prev, {
        id: `voice-${Date.now()}`,
        message: `Voice command: "${text}"`,
        duration: 3000,
      }]);
    },
    onError: (error) => {
      setToasts(prev => [...prev, {
        id: `voice-error-${Date.now()}`,
        message: error,
        duration: 4000,
      }]);
    },
  });

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
      aiPriority: email.category === 'Urgent' ? 'high' : email.category === 'Important' ? 'medium' : 'low' as const,
      deadline: email.deadline,
      requires_reply: email.requires_reply,
      attention_dismissed: email.attention_dismissed,
      status: email.status,
      category: email.category,
      recipients: email.recipients,
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
    };


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
        // Apply read filter (only in inbox, only to regular emails)
        .filter(email => readFilter === 'all' || !email.is_read || email.id === selectedEmailId)
        .map(convertToUIEmail);

      // Put overdue emails FIRST, then regular inbox
      result = [...overdueEmails, ...regularInbox];
    } else {
      // All other filters
      result = emails
        .filter(email => {
          // For Trash view, show ONLY deleted emails
          if (currentFilter === 'deleted') {
            return email.status === 'Deleted';
          }
          // Always exclude deleted emails from all other views
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
        result = [...result, ...savedSentEmails];
      }
      // For Trash filter, also include deleted sent emails
      if (currentFilter === 'deleted') {
        const deletedSentEmails = sentEmails
          .filter(e => e.status === 'Deleted')
          .map(convertSentEmailToUI);
        result = [...result, ...deletedSentEmails];
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

    // Helper: sort waiting-on-reply emails (used by both modes)
    const sortWaiting = (a: any, b: any): number | null => {
      const aIsWaiting = isWaitingAndReady(a);
      const bIsWaiting = isWaitingAndReady(b);
      if (aIsWaiting !== bIsWaiting) return aIsWaiting ? -1 : 1;
      if (aIsWaiting && bIsWaiting) {
        const aTime = a.waiting_on_reply_since ? new Date(a.waiting_on_reply_since).getTime() : 0;
        const bTime = b.waiting_on_reply_since ? new Date(b.waiting_on_reply_since).getTime() : 0;
        return aTime - bTime; // Oldest first (waiting longest)
      }
      return null; // Neither is waiting, let caller decide
    };

    const byDateDesc = (a: any, b: any) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime();

    // Sort by selected mode
    if (sortMode === 'importance') {
      const categoryOrder: Record<string, number> = { 'Urgent': 0, 'Important': 1, 'Normal': 2, 'Low': 3 };
      return result.sort((a, b) => {
        // Waiting-on-reply emails stay at top
        const waitResult = sortWaiting(a, b);
        if (waitResult !== null) return waitResult;

        // Sort by category: Urgent > Important > Normal > Low
        const aOrder = categoryOrder[a.aiCategory || 'Normal'] ?? 2;
        const bOrder = categoryOrder[b.aiCategory || 'Normal'] ?? 2;
        if (aOrder !== bOrder) return aOrder - bOrder;

        // Within same category, newest first
        return byDateDesc(a, b);
      });
    } else {
      return result.sort((a, b) => {
        // Waiting-on-reply emails stay at top
        const waitResult = sortWaiting(a, b);
        if (waitResult !== null) return waitResult;

        // Sort by date: newest first
        return byDateDesc(a, b);
      });
    }
  }, [currentFilter, sentEmails, emails, convertToUIEmail, convertSentEmailToUI, sortMode, isFocusMode, searchQuery, readFilter, selectedEmailId]
  );

  // Calculate actual inbox count (emails not archived/saved/deleted)
  // Use useMemo to avoid recalculating on every render
  const inboxCount = React.useMemo(() => {
    return emails
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
      .filter(email => readFilter === 'all' || !email.is_read)
      .length;
  }, [emails, isFocusMode, readFilter]);

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
        // TEMPORARILY DISABLED TO TEST
        // const { initializeReminderChecker } = useEmailStore.getState();
        // initializeReminderChecker();

        // DEV MODE: skip real Gmail fetch, sample emails loaded from emailStore
        // Load cached emails from disk first (instant display)
        // await loadFromDisk();
        // Purge trash older than 30 days
        // useEmailStore.getState().purgeOldTrash();
        // Load life intelligence data from disk
        // import('@/stores/lifeStore').then(({ useLifeStore }) => {
        //   useLifeStore.getState().loadFromDisk();
        // });
        // Then fetch fresh emails from Gmail (silently if cache was loaded)
        // fetchEmails();
      }
    };

    initAuth();
  }, [initialize, isAuthenticated, loadThemeFromSettings, loadFromDisk, fetchEmails]);

  // DEV MODE: ensure sample emails are loaded against the LIVE store. The
  // module-init auto-loader can miss (HMR / store re-creation), leaving the
  // inbox empty even though the loader "ran". This guarantees population.
  useEffect(() => {
    if (!isAuthenticated) return;
    if (emails.length === 0 && typeof (window as any).loadSampleEmails === 'function') {
      (window as any).loadSampleEmails();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  // Set up polling for new emails - only poll when window is focused to reduce load
  // DEV MODE: polling disabled, using mock emails
  useEffect(() => {
    if (!isAuthenticated) return;
    return; // DEV MODE: skip polling

    let interval: NodeJS.Timeout | null = null;
    let lastFetchTime = 0;
    const MIN_FETCH_INTERVAL = 30000; // Don't fetch more often than every 30s

    const doFetch = () => {
      const now = Date.now();
      if (now - lastFetchTime < MIN_FETCH_INTERVAL) return;
      lastFetchTime = now;
      fetchEmails();
    };

    const startPolling = () => {
      if (interval) clearInterval(interval);
      interval = setInterval(doFetch, 60000); // Poll every 60 seconds
    };

    const stopPolling = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };

    // Handle window focus/blur
    const handleFocus = () => {
      doFetch(); // Fetch on focus, but only if enough time has passed
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

  const handleVoiceCompose = React.useCallback(() => {
    if (!voiceSupported) {
      setToasts(prev => [...prev, {
        id: `voice-unsupported-${Date.now()}`,
        message: 'Voice commands not supported in this browser',
        duration: 4000,
      }]);
      return;
    }
    toggleListening();
  }, [voiceSupported, toggleListening]);

  // Keyboard shortcuts (Cmd+I for chat, r for respond)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+I or Ctrl+I to toggle chat
      if ((e.metaKey || e.ctrlKey) && e.key === 'i') {
        e.preventDefault();
        // Chat toggle handled by chat components
        return;
      }

      // Cmd+Shift+V to toggle voice input
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'v') {
        e.preventDefault();
        handleVoiceCompose();
        return;
      }

      // r to trigger Respond button (inbox only, not sent)
      if (e.key === 'r' && selectedEmail && !showResponseOptions && currentFilter !== 'sent') {
        // Only trigger when not typing in an input field
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
          return;
        }

        // Check if this is a sent email (can't respond to sent emails)
        const isSentEmail = sentEmails.find(e => e.id === selectedEmailId);
        if (isSentEmail) {
          return;
        }

        e.preventDefault();
        // Find and click the Respond button
        const respondButton = document.querySelector('[data-respond-button]') as HTMLButtonElement;
        if (respondButton) {
          respondButton.click();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedEmail, selectedEmailId, sentEmails, currentFilter, showResponseOptions, voiceSupported, toggleListening, handleVoiceCompose]);

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
      <ChatProvider>
        <Routes>
        {/* Root path redirect */}
        <Route path="/" element={<Navigate to="/today" replace />} />

      {/* ---- New Aiden surfaces (Chief of Staff experience) ---- */}
      <Route
        path="/today"
        element={isAuthenticated ? (<AidenShell><Today /></AidenShell>) : <Navigate to="/login" replace />}
      />
      <Route
        path="/relationships"
        element={isAuthenticated ? (<AidenShell bleed><Relationships /></AidenShell>) : <Navigate to="/login" replace />}
      />
      <Route
        path="/commitments"
        element={isAuthenticated ? (<AidenShell><Commitments /></AidenShell>) : <Navigate to="/login" replace />}
      />
      <Route
        path="/schedule"
        element={isAuthenticated ? (<AidenShell><Schedule /></AidenShell>) : <Navigate to="/login" replace />}
      />
      <Route
        path="/ask"
        element={isAuthenticated ? (<AidenShell bleed><Ask /></AidenShell>) : <Navigate to="/login" replace />}
      />

      {/* Email view page - focused view without navigation */}
      <Route
        path="/today/email/:id"
        element={isAuthenticated ? (<AidenShell bleed><EmailViewPage /></AidenShell>) : <Navigate to="/login" replace />}
      />

      {/* /dashboard kept as an alias to the inbox surface */}
      <Route path="/dashboard" element={<Navigate to="/inbox" replace />} />

      {/* Login route */}
      <Route
        path="/login"
        element={
          isAuthenticated ? <Navigate to="/today" replace /> : <Login />
        }
      />

      {/* Inbox surface — unified email + Slack stream */}
      <Route
        path="/inbox"
        element={isAuthenticated ? (<AidenShell bleed><Inbox /></AidenShell>) : <Navigate to="/login" replace />}
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
            <AidenShell><SettingsPage /></AidenShell>
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

      {/* Life Intel route - protected */}
      <Route
        path="/life"
        element={
          isAuthenticated ? (
            <LifeIntel />
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

      {/* Scheduling route - protected */}
      <Route
        path="/scheduling"
        element={
          isAuthenticated ? (
            <Scheduling />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />

      {/* Catch-all route - redirect to login if not authenticated, dashboard if authenticated */}
      <Route
        path="*"
        element={
          <Navigate to={isAuthenticated ? "/today" : "/login"} replace />
        }
      />
      </Routes>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      <VoiceOverlay
        isListening={isListening}
        transcript={transcript}
        onStop={stopListening}
        isProcessing={isListening}
      />
      <AIComposeModal
        isOpen={isComposeModalOpen || !!composeData}
        initialTo={composeData?.to}
        initialSubject={composeData?.subject}
        initialBody={composeData?.body}
        initialPrompt={composeData?.prompt}
        onClose={() => {
          setIsComposeModalOpen(false);
          clearComposeData();
        }}
      />
      <ChatTrigger />
      <ChatPanel />
      </ChatProvider>
    </OAuthHandler>
  );
}

export default App;
