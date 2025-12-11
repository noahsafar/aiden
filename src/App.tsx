import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Sidebar } from '@/components/ui/Sidebar';
import { EmailList } from '@/components/ui/EmailList';
import { EmailView } from '@/components/ui/EmailView';
import { FloatingAction } from '@/components/ui/FloatingAction';
import { Login } from '@/components/Login';
import { OAuthHandler } from '@/components/OAuthHandler';
import { TestPage } from '@/components/TestPage';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useAuthStore } from '@/stores/authStore';
import { Link, useNavigate } from 'react-router-dom';
import {
  Search,
  Bell,
  Settings,
  Moon,
  Sun,
  Mail,
  Sparkles,
  LogOut
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
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>('1');
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [emails, setEmails] = useState<Email[]>([]);
  const { signOut, isAuthenticated, isLoading, initialize, setState, user } = useAuthStore();

  // Mock emails data
  const mockEmails: Email[] = [
    {
      id: '1',
      from: {
        name: 'Sarah Chen',
        email: 'sarah.chen@acme.com',
        status: 'online'
      },
      to: [{ name: 'You', email: 'you@company.com' }],
      subject: 'Q4 Revenue Projections - Review Request',
      preview: 'Hi team, I\'ve attached the Q4 revenue projections for your review. The AI analysis suggests...',
      content: `Hi team,

I've attached the Q4 revenue projections for your review. The AI analysis suggests we're on track to exceed our targets by 12-15%, driven primarily by the success of our new AI-powered email management features.

Key highlights:
• Subscription revenue up 25% from Q3
• Enterprise adoption exceeding expectations
• Customer retention rate at 94%
• New AI features driving 40% of new signups

The model suggests we should consider scaling our marketing spend in Q1 to capitalize on this momentum.

Would love to get your thoughts on these projections before our board presentation next week.

Best regards,
Sarah`,
      timestamp: '2:34 PM',
      isRead: false,
      isStarred: true,
      hasAttachments: true,
      labels: [
        { id: '1', name: 'Important', color: 'error' },
        { id: '2', name: 'Finance', color: 'primary' }
      ],
      isAIProcessed: true,
      aiCategory: 'Financial Analysis',
      aiSummary: 'Q4 revenue projections show 12-15% growth above targets, driven by AI features success with 25% subscription revenue increase.',
      aiActionItems: [
        'Review projections before board presentation',
        'Consider scaling marketing spend for Q1'
      ],
      aiPriority: 'high',
      attachments: [
        { id: '1', name: 'Q4_Revenue_Projections.pdf', size: '2.4 MB', type: 'application/pdf' }
      ]
    },
    {
      id: '2',
      from: {
        name: 'Marcus Johnson',
        email: 'marcus@design.co',
        status: 'away'
      },
      to: [{ name: 'You', email: 'you@company.com' }],
      subject: 'New UI Mockups Ready',
      preview: 'The latest mockups are ready for review. I\'ve incorporated the Apple-inspired design...',
      content: 'The Apple-inspired design system has been implemented with premium components...',
      timestamp: '11:22 AM',
      isRead: true,
      isStarred: false,
      hasAttachments: false,
      labels: [
        { id: '3', name: 'Design', color: 'ai' }
      ],
      isAIProcessed: true,
      aiCategory: 'Design Review',
      aiPriority: 'medium'
    },
    {
      id: '3',
      from: {
        name: 'Emily Rodriguez',
        email: 'emily.r@techcorp.io',
        status: 'offline'
      },
      to: [{ name: 'You', email: 'you@company.com' }],
      subject: 'AI Model Performance Update',
      preview: 'Our latest AI model training shows 94% accuracy in email categorization...',
      content: 'AI model performance metrics and improvements...',
      timestamp: 'Yesterday',
      isRead: false,
      isStarred: false,
      hasAttachments: true,
      labels: [
        { id: '4', name: 'AI/ML', color: 'ai' },
        { id: '5', name: 'Reports', color: 'success' }
      ],
      isAIProcessed: true,
      aiCategory: 'Performance Metrics',
      aiPriority: 'high'
    },
    {
      id: '4',
      from: {
        name: 'David Kim',
        email: 'david.kim@startup.com',
        status: 'online'
      },
      to: [{ name: 'You', email: 'you@company.com' }],
      subject: 'Partnership Opportunity',
      preview: 'I came across your AI email manager and believe we could create synergies...',
      content: 'Potential partnership discussion...',
      timestamp: 'Yesterday',
      isRead: true,
      isStarred: true,
      hasAttachments: false,
      labels: [
        { id: '6', name: 'Business', color: 'primary' }
      ],
      isAIProcessed: true,
      aiCategory: 'Business Development',
      aiPriority: 'medium'
    },
    {
      id: '5',
      from: {
        name: 'Lisa Thompson',
        email: 'lisa.t@enterprise.com',
        status: 'online'
      },
      to: [{ name: 'You', email: 'you@company.com' }],
      subject: 'Team Meeting Notes - Action Items',
      preview: 'Here are the key takeaways from today\'s team meeting. AI has automatically extracted...',
      content: 'Meeting summary and action items...',
      timestamp: '2 days ago',
      isRead: false,
      isStarred: false,
      hasAttachments: false,
      labels: [
        { id: '7', name: 'Internal', color: 'secondary' }
      ],
      isAIProcessed: true,
      aiCategory: 'Meeting Summary',
      aiPriority: 'low'
    }
  ];

  useEffect(() => {
    // Initialize authentication state on app load
    const initAuth = async () => {
      await initialize();
      setEmails(mockEmails);
    };

    initAuth();
  }, [initialize]);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  const selectedEmail = emails.find(email => email.id === selectedEmailId);

  const handleEmailAction = (emailId: string, action: string) => {
    console.log(`Email ${emailId}: ${action}`);
    // Handle email actions (star, archive, delete, etc.)
  };

  const handleThemeToggle = () => {
    setIsDarkMode(!isDarkMode);
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
            <div className="h-screen bg-background overflow-hidden">
              {/* Top Navigation Bar */}
              <div className="h-14 bg-surface border-b border-border flex items-center justify-between pl-2 pr-4 z-10">
                <div className="flex items-center gap-0">
                  <img
                    src={logo}
                    alt="Aiden Logo"
                    className="h-8 w-8"
                  />
                  <h1 className="text-xl font-bold text-gray-900 dark:text-white">Aiden</h1>
                  <span className="ml-4 text-sm text-gray-500">
                    {user ? `${user.email}` : 'Not logged in'}
                  </span>
                </div>

                <div className="flex-1 max-w-xl mx-8">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search emails..."
                      className="w-full pl-10 pr-4 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all duration-200"
                    />
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <Button variant="ghost" size="icon" className="h-8 w-8 relative">
                    <Bell className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                    <span className="absolute top-1 right-1 h-2 w-2 bg-error-500 rounded-full"></span>
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleThemeToggle}>
                    {isDarkMode ? (
                      <Sun className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                    ) : (
                      <Moon className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                    )}
                  </Button>
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

              {/* Main Content Area */}
              <div className="flex h-[calc(100vh-3.5rem)]">
                {/* Sidebar */}
                <Sidebar
                  isDarkMode={isDarkMode}
                  onThemeToggle={handleThemeToggle}
                />

                {/* Email List */}
                <div className="w-96 border-r border-gray-200/60 dark:border-gray-700/60">
                  <EmailList
                    emails={emails}
                    selectedEmailId={selectedEmailId}
                    onEmailSelect={setSelectedEmailId}
                    onEmailAction={handleEmailAction}
                  />
                </div>

                {/* Email Content */}
                <div className="flex-1">
                  <EmailView
                    email={selectedEmail}
                    onReply={() => console.log('Reply to email')}
                    onForward={() => console.log('Forward email')}
                    onDelete={() => console.log('Delete email')}
                    onAction={handleEmailAction}
                  />
                </div>
              </div>

              {/* Floating Action Button */}
              <FloatingAction
                onCompose={handleCompose}
                onAICompose={handleAICompose}
                onQuickSearch={handleQuickSearch}
                onVoiceCompose={handleVoiceCompose}
              />
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
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleThemeToggle}>
                    {isDarkMode ? (
                      <Sun className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                    ) : (
                      <Moon className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                    )}
                  </Button>
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