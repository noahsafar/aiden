import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Sidebar } from '@/components/ui/Sidebar';
import { EmailList } from '@/components/ui/EmailList';
import { EmailView } from '@/components/ui/EmailView';
import { Login } from '@/components/Login';
import { OAuthHandler } from '@/components/OAuthHandler';
import { TestPage } from '@/components/TestPage';
import { Settings as SettingsPage } from '@/pages/Settings';
import { Calendar } from '@/pages/Calendar';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useAuthStore } from '@/stores/authStore';
import { useEmailStore } from '@/stores/emailStore';
import { useThemeStore } from '@/stores/themeStore';
import { Link, useNavigate } from 'react-router-dom';
import {
  Search,
  Bell,
  Mail,
  Sparkles,
  LogOut,
  Settings as SettingsIcon,
  Calendar as CalendarIcon
} from 'lucide-react';
import logo from '/aiden-logo.png';

interface Email {
  id: string;
  from: {
    name: string;
    email: string;
    status?: 'online' | 'offline' | 'away';
  };
  subject: string;
  preview: string;
  content: string;
  bodyHtml?: string;  // HTML version of email body
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
  to: Array<{ name: string; email: string; }>;
  cc?: Array<{ name: string; email: string; }>;
  attachments?: Array<{
    id: string;
    name: string;
    size: string;
    type: string;
  }>;
}

function App() {
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [appStartTime] = useState(Date.now());
  const { signOut, isAuthenticated, isLoading, initialize, user } = useAuthStore();
  const { emails, fetchEmails, isLoading: emailsLoading, sentEmails, currentFilter } = useEmailStore();
  const { loadThemeFromSettings } = useThemeStore();

  // Convert email store format to UI format - use useCallback to avoid recreating on every render
  const convertToUIEmail = React.useCallback((email: any): Email => {
    const fromMatch = email.sender.match(/^(?:"?([^"]*)"?\s)?(?:<?([^>]+)>?)$/);
    const fromName = fromMatch?.[1] || email.sender.split('<')[0].trim() || 'Unknown';
    const fromEmail = fromMatch?.[2] || email.sender.split('<')[1]?.replace('>', '').trim() || email.sender;

    // Convert recipients
    const toRecipients = email.recipients.split(',').map((r: string) => {
      const match = r.trim().match(/^(?:"?([^"]*)"?\s)?(?:<?([^>]+)>?)$/);
      const name = match?.[1] || r.trim().split('<')[0].trim() || 'Unknown';
      const emailAddr = match?.[2] || r.trim().split('<')[1]?.replace('>', '').trim() || r.trim();
      return { name, email: emailAddr };
    });

    return {
      id: email.id,
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
      labels: [
        { id: '1', name: email.status, color: email.category === 'Urgent' ? 'error' : email.category === 'Important' ? 'warning' : 'primary' as const }
      ],
      isAIProcessed: true,
      aiCategory: email.category,
      aiSummary: email.summary,
      aiActionItems: email.key_points || [],
      aiPriority: email.category === 'Urgent' ? 'high' : email.category === 'Important' ? 'medium' : 'low' as const
    };
  }, []);

  // Convert sent email to UI format - use useCallback to avoid recreating on every render
  const convertSentEmailToUI = React.useCallback((email: any): Email => {
    const toRecipients = email.recipients ? email.recipients.split(',').map((r: string) => {
      const match = r.trim().match(/^(?:"?([^"]*)"?\s)?(?:<?([^>]+)>?)$/);
      const name = match?.[1] || r.trim().split('<')[0].trim() || 'Unknown';
      const emailAddr = match?.[2] || r.trim().split('<')[1]?.replace('>', '').trim() || r.trim();
      return { name, email: emailAddr };
    }) : [{ name: 'Unknown', email: email.recipients || '' }];

    return {
      id: email.id,
      from: {
        name: 'You',
        email: email.sender || 'me',
        status: 'offline' as const
      },
      to: toRecipients,
      subject: email.subject,
      preview: email.snippet,
      content: email.body_text || email.snippet,
      bodyHtml: email.body_html,
      timestamp: new Date(email.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isRead: email.is_read,
      isStarred: email.is_starred,
      hasAttachments: email.has_attachments,
      labels: [
        { id: '1', name: 'Sent', color: 'primary' as const }
      ],
      isAIProcessed: true,
      aiCategory: email.category,
      aiSummary: email.summary,
      aiActionItems: email.key_points || [],
      aiPriority: 'low' as const
    };
  }, []);

  // Filter emails based on current filter - use useMemo to avoid recalculating on every render
  const filteredEmails = React.useMemo(() =>
    currentFilter === 'sent'
      ? sentEmails.map(convertSentEmailToUI)
      : emails
          .filter(email => {
            const emailTime = new Date(email.date).getTime();
            // For Saved category, only show saved emails. For inbox, exclude saved/archived.
            if (currentFilter === 'saved') {
              return emailTime >= appStartTime && email.status === 'Saved';
            }
            return emailTime >= appStartTime && email.status !== 'Archived' && email.status !== 'Saved';
          })
          .map(convertToUIEmail),
    [currentFilter, sentEmails, emails, appStartTime, convertToUIEmail, convertSentEmailToUI]
  );

  // Calculate actual inbox count (emails after app start, not archived/saved)
  // Use useMemo to avoid recalculating on every render
  const inboxCount = React.useMemo(() =>
    emails.filter(email => {
      const emailTime = new Date(email.date).getTime();
      return emailTime >= appStartTime && email.status !== 'Archived' && email.status !== 'Saved';
    }).length,
    [emails, appStartTime]
  );

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
      if (isAuthenticated) {
        fetchEmails();
      }
    };

    initAuth();
  }, [initialize, isAuthenticated, loadThemeFromSettings]);

  // Set up polling for new emails every 10 seconds
  useEffect(() => {
    if (!isAuthenticated) return;

    const interval = setInterval(() => {
      fetchEmails();
    }, 10000); // Poll every 10 seconds

    return () => clearInterval(interval);
  }, [isAuthenticated, fetchEmails]);

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

  const selectedEmail = filteredEmails.find(email => email.id === selectedEmailId);

  const handleEmailAction = (emailId: string, action: string) => {
    console.log(`Email ${emailId}: ${action}`);
    // Handle email actions (star, archive, delete, etc.)
  };

  const handleCompose = () => {
    console.log('Open compose modal');
    // Open compose modal
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
            <div className="h-screen bg-background overflow-hidden flex flex-col min-w-0">
              {/* Top Navigation Bar */}
              <div className="h-14 bg-surface border-b border-border flex items-center justify-between pl-2 pr-4 z-10 flex-shrink-0 min-w-0">
                <div className="flex items-center gap-0 min-w-0">
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

                <div className="flex-1 max-w-xl mx-4 hidden md:block">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search emails..."
                      className="w-full pl-10 pr-4 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all duration-200"
                    />
                  </div>
                </div>

                <div className="flex items-center space-x-1 flex-shrink-0">
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
                  <Button variant="ghost" size="icon" className="h-8 w-8 relative">
                    <Bell className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                    <span className="absolute top-1 right-1 h-2 w-2 bg-error-500 rounded-full"></span>
                  </Button>
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
              <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden">
                {/* Sidebar */}
                <Sidebar
                  inboxCount={inboxCount}
                />

                {/* Email List */}
                <div className="w-80 min-w-60 max-w-96 border-r border-gray-200/60 dark:border-gray-700/60 flex-shrink-0">
                  {filteredEmails.length === 0 && !emailsLoading ? (
                    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
                      <Mail className="h-12 w-12 text-gray-400 mb-4" />
                      <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                        {currentFilter === 'sent' ? 'No sent emails yet' : currentFilter === 'saved' ? 'No saved emails yet' : 'No new emails yet'}
                      </h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {currentFilter === 'sent'
                          ? 'Emails you send will appear here.'
                          : currentFilter === 'saved'
                          ? 'Emails you bookmark will appear here.'
                          : 'Emails that arrive will appear here.'}
                      </p>
                    </div>
                  ) : (
                    <EmailList
                      emails={filteredEmails}
                      selectedEmailId={selectedEmailId}
                      onEmailSelect={setSelectedEmailId}
                      onEmailAction={handleEmailAction}
                    />
                  )}
                </div>

                {/* Email Content */}
                <div className="flex-1 min-w-0 overflow-hidden">
                  {selectedEmail ? (
                    <EmailView
                      email={selectedEmail}
                      onReply={() => console.log('Reply to email')}
                      onForward={() => console.log('Forward email')}
                      onDelete={() => console.log('Delete email')}
                      onAction={handleEmailAction}
                    />
                  ) : (
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
              </div>
            </div>
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

      {/* Catch-all route - redirect to login if not authenticated, dashboard if authenticated */}
      <Route
        path="*"
        element={
          <Navigate to={isAuthenticated ? "/dashboard" : "/login"} replace />
        }
      />
      </Routes>
    </OAuthHandler>
  );
}

export default App;