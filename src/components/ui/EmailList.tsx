import React, { useEffect, useState, useCallback, useRef } from 'react';

interface EmailQuestionData {
  questions: string[];
  suggestedFormalityScore: number;
  requiresReply?: boolean;
  replyReasoning?: string;
  loaded: boolean;
}

interface EmailListProps {
  emails?: any[];
  selectedEmailId?: string | null;
  onEmailSelect?: (id: string) => void;
  onEmailAction?: (id: string, action: string) => void;
  // New props for keyboard navigation
  focusedEmailId?: string | null;
  onFocusEmail?: (id: string) => void;
  onTriggerReply?: () => void;
  onTriggerArchive?: () => void;
  onOpenFocusedView?: () => void;  // Open email in focused/full-screen view
}

// Helper function to get reply requirement data for an email
function getEmailReplyData(emailId: string): EmailQuestionData | undefined {
  if (typeof window !== 'undefined' && (window as any).emailQuestionData) {
    return (window as any).emailQuestionData.get(emailId);
  }
  return undefined;
}

export const EmailList: React.FC<EmailListProps> = ({
  emails = [],
  selectedEmailId = null,
  onEmailSelect = () => {},
  onEmailAction = () => {},
  focusedEmailId = null,
  onFocusEmail = () => {},
  onTriggerReply = () => {},
  onTriggerArchive = () => {},
  onOpenFocusedView = () => {},
}) => {
  const [replyData, setReplyData] = useState<Map<string, EmailQuestionData>>(new Map());
  const listRef = useRef<HTMLDivElement>(null);

  // Get the index of the currently focused email
  const focusedIndex = emails.findIndex((email: any) => email.id === focusedEmailId);

  // Navigate to next/previous email
  const navigateEmail = useCallback((direction: 'next' | 'prev') => {
    if (emails.length === 0) return;

    const currentIndex = focusedEmailId
      ? emails.findIndex((e: any) => e.id === focusedEmailId)
      : -1;

    let nextIndex: number;
    if (direction === 'next') {
      nextIndex = currentIndex < emails.length - 1 ? currentIndex + 1 : 0;
    } else {
      nextIndex = currentIndex > 0 ? currentIndex - 1 : emails.length - 1;
    }

    const nextEmail = emails[nextIndex];
    if (nextEmail) {
      onFocusEmail(nextEmail.id);
      onEmailSelect(nextEmail.id);

      // Scroll the email into view
      setTimeout(() => {
        const element = document.getElementById(`email-item-${nextEmail.id}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }, 0);
    }
  }, [emails, focusedEmailId, onFocusEmail, onEmailSelect]);

  // Archive/unarchive focused email (toggle)
  const archiveEmail = useCallback(() => {
    if (focusedEmailId) {
      onEmailAction(focusedEmailId, 'archive');
    }
  }, [focusedEmailId, onEmailAction]);

  // Delete focused email
  const deleteEmail = useCallback(() => {
    if (focusedEmailId) {
      onEmailAction(focusedEmailId, 'delete');
      // Navigate to next email after deleting
      navigateEmail('next');
    }
  }, [focusedEmailId, onEmailAction, navigateEmail]);

  // Keyboard event handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input, textarea, or contenteditable
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          e.preventDefault();
          navigateEmail('next');
          break;
        case 'k':
        case 'ArrowUp':
          e.preventDefault();
          navigateEmail('prev');
          break;
        case 'Enter':
          e.preventDefault();
          // First select the email, then open focused view
          if (focusedEmailId) {
            onEmailSelect(focusedEmailId);
            onOpenFocusedView();
          }
          break;
        case 'r':
          e.preventDefault();
          onTriggerReply();
          break;
        case 'a':
          e.preventDefault();
          archiveEmail();
          break;
        case 's':
          e.preventDefault();
          onEmailAction(focusedEmailId, 'save');
          break;
        case 'd':
          e.preventDefault();
          deleteEmail();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigateEmail, focusedEmailId, onEmailSelect, onTriggerReply, archiveEmail, deleteEmail, onEmailAction, onOpenFocusedView]);

  // Trigger re-render when reply data changes - poll for updates
  useEffect(() => {
    const checkForUpdates = () => {
      if (typeof window !== 'undefined' && (window as any).emailQuestionData) {
        const newData = new Map((window as any).emailQuestionData);
        // Only update if actually changed
        if (newData.size !== replyData.size) {
          setReplyData(newData);
        }
      }
    };

    // Check immediately and then poll
    checkForUpdates();
    const interval = setInterval(checkForUpdates, 500);
    return () => clearInterval(interval);
  }, [emails, replyData.size]);

  // Component for the action badge
  const ActionBadge = ({ emailId }: { emailId: string }) => {
    const data = getEmailReplyData(emailId);

    // Debug logging
    console.log('[ActionBadge] Email ID:', emailId, 'Data:', data);

    if (!data?.loaded) {
      return null;
    }

    const requiresReply = data.requiresReply;

    if (requiresReply) {
      return (
        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700 border border-amber-200">
          Action Required
        </span>
      );
    }

    return (
      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-500 border border-gray-200">
        FYI
      </span>
    );
  };

  return (
    <div className="flex-1 overflow-y-auto" ref={listRef}>
      {/* Keyboard shortcuts hint */}
      <div className="px-4 py-3 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 space-y-1.5">
        <div className="font-medium text-gray-600 dark:text-gray-300">Keyboard shortcuts</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono">j</kbd> <kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono">k</kbd> navigate</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono">Enter</kbd> focused</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono">a</kbd> archive</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono">s</kbd> save</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono">d</kbd> delete</span>
        </div>
      </div>
      <div className="p-4 space-y-2">
        {emails.map((email: any) => {
          const replyData = getEmailReplyData(email.id);
          const isFyi = replyData?.loaded && replyData.requiresReply === false;
          const isFocused = focusedEmailId === email.id;

          return (
            <div
              key={email.id}
              id={`email-item-${email.id}`}
              className={`p-4 bg-surface dark:bg-gray-800 border rounded-lg hover:shadow-md transition-all cursor-pointer ${
                isFocused ? 'border-purple-400 dark:border-purple-500 ring-2 ring-purple-300 dark:ring-purple-700 bg-purple-50/50 dark:bg-purple-900/20' :
                selectedEmailId === email.id ? 'border-blue-500 dark:border-blue-400 ring-2 ring-blue-200 dark:ring-blue-900' : 'border-border'
              } ${isFyi ? 'opacity-60' : ''}`}
              onClick={() => onEmailSelect(email.id)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs text-muted truncate">{email.from?.name || email.from?.email || 'Unknown'}</span>
                    <ActionBadge emailId={email.id} />
                    {email.status === 'Saved' && <span className="text-blue-500" title="Saved">◆</span>}
                  </div>
                  <h3 className={`font-semibold text-foreground ${!email.isRead ? 'text-blue-600 dark:text-blue-400' : ''}`}>{email.subject}</h3>
                  <p className="text-sm text-muted mt-1 line-clamp-2">{email.preview}</p>
                </div>
                <span className="text-xs text-muted flex-shrink-0">{email.timestamp}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
