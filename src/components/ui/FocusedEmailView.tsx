import React, { useEffect, useState } from 'react';
import { X, ArrowLeft } from 'lucide-react';
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
  attachments?: Array<{ id: string; name: string; size: string; type: string; mimeType?: string; size_bytes?: number }>;
}

interface FocusedEmailViewProps {
  email: Email;
  onClose: () => void;
  onAction?: (id: string, action: string) => void;
  animationPhase: 'idle' | 'slideLeft' | 'expand';
}

export const FocusedEmailView: React.FC<FocusedEmailViewProps> = ({
  email,
  onClose,
  onAction = () => {},
  animationPhase,
}) => {
  const { emails } = useEmailStore();

  // Get the full email data from the store
  const fullEmail = emails.find(e => e.id === email.id) || email;

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

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="absolute inset-0 top-14 left-0 right-0 bottom-0 bg-white dark:bg-gray-900 z-20 pointer-events-none">
      {/* Header - appears after slide left phase */}
      <div
        className={`absolute top-0 left-0 right-0 h-14 bg-surface border-b border-border flex items-center justify-between px-4 z-30 pointer-events-auto transition-all duration-500 ease-in-out ${
          animationPhase === 'idle' ? 'opacity-0 -translate-y-full' :
          animationPhase === 'slideLeft' ? 'opacity-0 -translate-y-full' :
          'opacity-100 translate-y-0'
        }`}
        style={{ transitionDelay: animationPhase === 'expand' ? '200ms' : '0ms' }}
      >
        <button
          onClick={onClose}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-600 dark:text-gray-400 flex-shrink-0"
          title="Go back (Esc)"
        >
          <ArrowLeft className="w-5 h-5" />
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
        <button
          onClick={onClose}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-600 dark:text-gray-400 flex-shrink-0"
          title="Close (Esc)"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Split Content Area */}
      <div className="absolute inset-0 top-14 bottom-0 flex pointer-events-auto">
        {/* Left Panel - Email Analysis */}
        <div
          className={`bg-gray-50 dark:bg-gray-900/50 overflow-y-auto border-r border-gray-200 dark:border-gray-700 transition-all duration-500 ease-in-out ${
            animationPhase === 'idle' ? 'w-2/5 h-full max-h-[50%] translate-y-0' :
            animationPhase === 'slideLeft' ? 'w-2/5 h-full max-h-[50%] translate-y-0' :
            'w-2/5 h-full translate-y-0'
          }`}
        >
          <EmailView
            email={email}
            onReply={() => {}}
            onForward={() => {}}
            onDelete={() => {}}
            onAction={onAction}
            focusedView={true}
          />
        </div>

        {/* Right Panel - Email Content */}
        <div
          className={`bg-white dark:bg-gray-800 overflow-hidden transition-all duration-500 ease-in-out ${
            animationPhase === 'idle' ? 'flex-1 h-1/2 mt-auto translate-y-full opacity-0' :
            animationPhase === 'slideLeft' ? 'flex-1 h-1/2 mt-auto translate-y-full opacity-0' :
            'flex-1 h-full translate-y-0 opacity-100'
          }`}
          style={{ transitionDelay: animationPhase === 'expand' ? '100ms' : '0ms' }}
        >
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
    </div>
  );
};
