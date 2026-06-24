import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { X, ArrowLeft, MessageSquare, Archive, Bookmark, ChevronUp, ChevronDown } from 'lucide-react';
import { EmailView, EmailHtmlContent } from '@/components/ui/EmailView';
import { useEmailStore } from '@/stores/emailStore';
import { AttachmentItem } from '@/components/ui/EmailView';
import { cn } from '@/lib/utils';

export const EmailViewPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { emails, sentEmails, updateEmailStatus } = useEmailStore();
  const returnPath = (location.state as any)?.returnPath || '/today';
  const autoReply = (location.state as any)?.autoReply || false;
  const [showResponseOptions, setShowResponseOptions] = useState(false);
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  // Get email ID from URL
  const emailId = location.pathname.split('/today/email/')[1];

  // Find the email in either emails or sentEmails
  const email = emails.find(e => e.id === emailId) || sentEmails.find(e => e.id === emailId);

  // Auto-expand response options after email is processed
  useEffect(() => {
    if (autoReply && email?.summary && !showResponseOptions) {
      console.log('[EmailViewPage] Auto-expanding response options - summary is ready');
      setShowResponseOptions(true);
    }
  }, [autoReply, email?.summary, showResponseOptions]);

  // Debug: log email data to see what we have
  useEffect(() => {
    if (email) {
      console.log('[EmailViewPage] Email loaded:', {
        id: email.id,
        subject: email.subject,
        hasSummary: !!email.summary,
        summary: email.summary,
        autoReply,
        showResponseOptions
      });
    }
  }, [email, autoReply, showResponseOptions]);

  // Close on Escape key, 'r' to respond
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        navigate(returnPath);
      }
      // r to trigger Respond button
      if (e.key === 'r' && !sentEmails.find(e => e.id === email.id)) {
        // Only trigger when not typing in an input field
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
          return;
        }
        e.preventDefault();
        setShowResponseOptions(!showResponseOptions);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate, returnPath, showResponseOptions, sentEmails, email]);

  // Auto-hide scrollbar after scrolling stops
  const handleScroll = () => {
    setIsScrolling(true);

    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }

    scrollTimeoutRef.current = setTimeout(() => {
      setIsScrolling(false);
    }, 1000); // Hide scrollbar after 1 second of no scrolling
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  if (!email) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted mb-4">Email not found</p>
          <button
            onClick={() => navigate(returnPath)}
            className="text-primary hover:underline"
          >
            Go back
          </button>
        </div>
      </div>
    );
  }

  // Helper to extract name from email string
  const extractName = (emailStr: string | undefined) => {
    if (!emailStr) return { name: 'Unknown', email: '' };
    const match = emailStr.match(/^(?:\"?([^\"]*)\"?\s)?(?:<?([^>]+)>?)$/);
    return {
      name: match?.[1] || emailStr.split('<')[0].trim() || 'Unknown',
      email: match?.[2] || emailStr.split('<')[1]?.replace('>', '').trim() || emailStr
    };
  };

  const senderInfo = email.sender ? extractName(email.sender) : { name: email.from?.name, email: email.from?.email };
  const recipientsList = email.recipients
    ? email.recipients.split(',').map(r => extractName(r.trim()))
    : email.to || [];

  const handleEmailAction = (emailId: string, action: string) => {
    console.log(`Email ${emailId}: ${action}`);
    // Handle email actions (save, archive, delete, etc.)
  };

  return (
    <div className="h-full flex flex-col">
      {/* Content area - matches inbox focused view layout */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Analysis Panel - matches inbox focused view */}
        <div
          className="bg-white dark:bg-gray-800 overflow-y-auto border-b border-gray-200/50 dark:border-gray-700/50"
          onScroll={handleScroll}
          style={{
            position: 'absolute',
            left: '0',
            width: '36rem',
            top: '0',
            height: '100%',
            zIndex: 10,
            scrollbarWidth: 'thin',
            scrollbarColor: isScrolling ? 'rgba(156 163 175 / 0.6) transparent' : 'rgba(156 163 175 / 0.1) transparent',
            transition: 'scrollbar-color 0.3s ease-in-out'
          }}
        >
          <div className="p-2">
            <EmailView
              email={email}
              onReply={() => console.log('Reply')}
              onForward={() => console.log('Forward')}
              onDelete={() => console.log('Delete')}
              onAction={handleEmailAction}
              focusedView={true}
              showResponseOptions={showResponseOptions}
              onShowResponseOptionsChange={setShowResponseOptions}
            />
          </div>
        </div>

        {/* Email Content Panel - matches inbox focused view */}
        <div
          className="p-6 overflow-y-auto bg-white dark:bg-gray-800"
          style={{
            position: 'absolute',
            left: '36rem',
            right: '0',
            top: '0',
            bottom: '0'
          }}
        >
          <div className="max-w-4xl mx-auto">
            {/* Email Header */}
            <div className="mb-6">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2 flex-wrap">
                    <h2 className="text-2xl font-bold text-foreground">{email.subject}</h2>
                    {/* Thread Navigation */}
                    {(() => {
                      if (!email.thread_id) return null;
                      const threadEmails = [...emails, ...sentEmails].filter(e =>
                        e.thread_id === email.thread_id || e.id === email.thread_id
                      );
                      if (threadEmails.length <= 1) return null;

                      const currentIndex = threadEmails.findIndex(e => e.id === email.id);
                      const current = currentIndex >= 0 ? currentIndex + 1 : 1;
                      const total = threadEmails.length;
                      const hasPrev = currentIndex > 0;
                      const hasNext = currentIndex < total - 1;

                      const handleNavigateThread = (direction: 'prev' | 'next') => {
                        const newIndex = direction === 'prev' ? currentIndex - 1 : currentIndex + 1;
                        if (newIndex >= 0 && newIndex < threadEmails.length) {
                          navigate(`/today/email/${threadEmails[newIndex].id}`, {
                            state: { returnPath: '/today' }
                          });
                        }
                      };

                      return (
                        <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                          <button
                            onClick={() => handleNavigateThread('prev')}
                            disabled={!hasPrev}
                            className={`p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors ${
                              !hasPrev ? 'opacity-30 cursor-not-allowed' : ''
                            }`}
                            title="Previous in thread"
                          >
                            <ChevronUp className="w-3 h-3" />
                          </button>
                          <span className="text-gray-600 dark:text-gray-300 whitespace-nowrap">
                            {current} <span className="text-gray-400">out of</span> {total}
                          </span>
                          <button
                            onClick={() => handleNavigateThread('next')}
                            disabled={!hasNext}
                            className={`p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors ${
                              !hasNext ? 'opacity-30 cursor-not-allowed' : ''
                            }`}
                            title="Next in thread"
                          >
                            <ChevronDown className="w-3 h-3" />
                          </button>
                        </div>
                      );
                    })()}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {/* Respond button - only show when viewing inbox emails, not sent */}
                  {!sentEmails.find(e => e.id === email.id) && (
                    <button
                      onClick={() => setShowResponseOptions(!showResponseOptions)}
                      className="flex-shrink-0"
                      title="Respond to this email"
                    >
                      <MessageSquare className="w-5 h-5 text-gray-400 hover:text-gray-600 transition-colors" />
                    </button>
                  )}
                  {/* Close button */}
                  <button
                    onClick={() => navigate(returnPath)}
                    className="flex-shrink-0 p-1.5 rounded bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                    title="Close (Esc)"
                  >
                    <X className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                  </button>
                </div>
              </div>
              <div className="flex items-center space-x-4 text-sm text-muted">
                <span>From: {senderInfo.name} &lt;{senderInfo.email}&gt;</span>
                <span>{new Date(email.date || email.timestamp || '').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            </div>

            <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:text-foreground prose-p:text-foreground prose-a:text-blue-600 dark:prose-a:text-blue-400">
              {email.bodyHtml || email.body_html ? (
                <EmailHtmlContent html={email.bodyHtml || email.body_html || ''} />
              ) : (
                <div className="whitespace-pre-wrap text-foreground">
                  {email.body_text || email.content || email.snippet || '(No content)'}
                </div>
              )}
            </div>

            {/* Attachments */}
            {email.hasAttachments && email.attachments && email.attachments.length > 0 && (
              <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
                <div className="flex items-center gap-2 mb-4">
                  <svg className="w-5 h-5 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                  <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                    Attachments ({email.attachments?.length || 0})
                  </p>
                </div>
                <div className="space-y-2">
                  {email.attachments?.map((attachment: any) => {
                    return (
                      <AttachmentItem
                        key={attachment.id}
                        attachment={attachment}
                        messageId={email.id}
                        emailSubject={email.subject}
                        emailSender={`${senderInfo.name} <${senderInfo.email}>`.trim()}
                        emailBody={email.body_text || email.content || email.snippet}
                        emailSummary={email.summary}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmailViewPage;
