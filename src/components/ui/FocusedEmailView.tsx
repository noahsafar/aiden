import React, { useEffect, useState, useRef } from 'react';
import { X } from 'lucide-react';
import { EmailView } from './EmailView';
import { useEmailStore } from '@/stores/emailStore';

interface Email {
  id: string;
  from: { name: string; email: string; status?: string };
  to: Array<{ name: string; email: string }>;
  cc?: Array<{ name: string; email: string }>;
  subject: string;
  preview: string;
  content: string;
  bodyHtml?: string;
  body_html?: string;
  timestamp: string;
  date?: string;
  sender?: string;
  recipients?: string;
  snippet?: string;
  body_text?: string;
  isRead: boolean;
  isStarred: boolean;
  hasAttachments: boolean;
  labels: Array<{ id: string; name: string; color: string }>;
  status?: string;
  isAIProcessed?: boolean;
  aiCategory?: string;
  aiSummary?: string;
  aiActionItems?: string[];
  aiPriority?: 'high' | 'medium' | 'low';
  summary?: string;
  key_points?: string[];
  category?: string;
  attachments?: Array<{ id: string; name: string; size: string; type: string; mimeType?: string; size_bytes?: number }>;
}

interface FocusedEmailViewProps {
  email: Email;
  onClose: () => void;
  onAction?: (id: string, action: string) => void;
}

export const FocusedEmailView: React.FC<FocusedEmailViewProps> = ({
  email,
  onClose,
  onAction = () => {},
}) => {
  const { emails } = useEmailStore();
  const [isAnimatingOut, setIsAnimatingOut] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Get the full email data from the store
  const fullEmail = emails.find(e => e.id === email.id) || email;

  const handleClose = () => {
    setIsAnimatingOut(true);
    // Wait for animation to complete before actually closing
    setTimeout(() => {
      onClose();
    }, 250);
  };

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Helper to extract name from email string
  const extractName = (emailStr: string | undefined) => {
    if (!emailStr) return { name: 'Unknown', email: '' };
    const match = emailStr.match(/^(?:\"?([^\"]*)\"?\s)?(?:<?([^>]+)>?)$/);
    return {
      name: match?.[1] || emailStr.split('<')[0].trim() || 'Unknown',
      email: match?.[2] || emailStr.split('<')[1]?.replace('>', '').trim() || emailStr
    };
  };

  const senderInfo = fullEmail.sender ? extractName(fullEmail.sender) : { name: email.from?.name, email: email.from?.email };
  const recipientsList = fullEmail.recipients
    ? fullEmail.recipients.split(',').map(r => extractName(r.trim()))
    : email.to || [];

  return (
    <div
      className={`fixed inset-0 z-50 bg-white dark:bg-gray-900 transition-all duration-300 ease-out ${
        isAnimatingOut ? 'opacity-0 scale-95' : 'opacity-100 scale-100'
      }`}
    >
      {/* Header */}
      <div
        className={`h-14 bg-surface border-b border-border flex items-center justify-between px-4 transition-transform duration-300 ease-out ${
          isAnimatingOut ? '-translate-y-2 opacity-0' : 'translate-y-0 opacity-100'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          {/* Back button */}
          <button
            onClick={handleClose}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-600 dark:text-gray-400 flex-shrink-0"
            title="Go back (Esc)"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
              {fullEmail.subject}
            </span>
            <span className="text-gray-400 hidden sm:inline">•</span>
            <span className="text-sm text-gray-600 dark:text-gray-400 truncate hidden sm:block">
              {senderInfo.name}
            </span>
          </div>
        </div>
        <button
          onClick={handleClose}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-600 dark:text-gray-400 flex-shrink-0"
          title="Close (Esc)"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Split Content Area */}
      <div
        ref={contentRef}
        className={`flex h-[calc(100vh-3.5rem)] overflow-hidden transition-all duration-300 ease-out ${
          isAnimatingOut ? 'opacity-50 scale-[0.98]' : 'opacity-100 scale-100'
        }`}
      >
        {/* Left Panel - Email Analysis (40% on large screens) */}
        <div className="w-full lg:w-2/5 lg:max-w-md border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 overflow-y-auto">
          <EmailView
            email={email}
            onReply={() => {}}
            onForward={() => {}}
            onDelete={() => {}}
            onAction={onAction}
            focusedView={true}
          />
        </div>

        {/* Right Panel - Email Content (60% on large screens) */}
        <div className="hidden lg:flex flex-1 flex-col bg-white dark:bg-gray-800 overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6">
            {/* Email Header */}
            <div className="mb-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white font-medium text-lg">
                  {(senderInfo.name || 'U').charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="font-medium text-gray-900 dark:text-white">
                    {senderInfo.name}
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    {senderInfo.email}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400 mb-4">
                <span>{email.timestamp}</span>
                <span>•</span>
                <span>
                  <span className="font-medium">To:</span>{' '}
                  {recipientsList.map((t: any) => t.name || t.email).join(', ') || 'Unknown'}
                </span>
              </div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                {fullEmail.subject}
              </h1>
            </div>

            {/* Email Body */}
            <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:text-gray-900 dark:prose-headings:text-white prose-p:text-gray-800 dark:prose-p:text-gray-200 prose-a:text-blue-600 dark:prose-a:text-blue-400">
              {email.bodyHtml || email.body_html || fullEmail.body_html ? (
                <div dangerouslySetInnerHTML={{ __html: email.bodyHtml || email.body_html || fullEmail.body_html || '' }} />
              ) : (
                <div className="whitespace-pre-wrap text-gray-800 dark:text-gray-200">
                  {(fullEmail.body_text || fullEmail.snippet || email.content)?.startsWith(fullEmail.subject || email.subject)
                    ? (fullEmail.body_text || fullEmail.snippet || email.content || '').substring((fullEmail.subject || email.subject).length).trim()
                    : (fullEmail.body_text || fullEmail.snippet || email.content)}
                </div>
              )}
            </div>

            {/* Attachments */}
            {fullEmail.hasAttachments && fullEmail.attachments && fullEmail.attachments.length > 0 && (
              <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                  Attachments ({fullEmail.attachments.length})
                </h3>
                <div className="space-y-2">
                  {fullEmail.attachments.map((att) => (
                    <div
                      key={att.id}
                      className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                    >
                      <div className="p-2 bg-white dark:bg-gray-800 rounded text-gray-600 dark:text-gray-400">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
                          {att.name}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {att.size} • {att.type || att.mimeType || 'Unknown'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile hint - show analysis panel only on small screens */}
      <div className="lg:hidden fixed bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-gray-900/80 text-white text-xs rounded-full backdrop-blur-sm pointer-events-none">
        Email content below ↑
      </div>
    </div>
  );
};
