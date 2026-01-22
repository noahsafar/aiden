import React, { useEffect, useCallback, useRef } from 'react';
import { useEmailStore } from '@/stores/emailStore';

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

// Component for the action badge - memoized for performance (defined outside to prevent re-creation)
const ActionBadge = React.memo(({ emailId }: { emailId: string }) => {
  const data = getEmailReplyData(emailId);

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
});

ActionBadge.displayName = 'ActionBadge';

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
  const listRef = useRef<HTMLDivElement>(null);

  // Bulk selection state from store
  const {
    isSelectMode,
    selectedEmailIds,
    toggleEmailSelection,
    clearSelection,
    selectAllVisible,
    bulkArchive,
    bulkDelete,
    bulkMarkAsRead,
    bulkSave,
    isEmailSelected,
  } = useEmailStore();

  // Track last clicked email for shift+click range selection
  const lastClickedEmailRef = useRef<string | null>(null);

  // Handle strip click with shift+click support for range selection
  const handleStripClick = useCallback((emailId: string, event: React.MouseEvent) => {
    event.stopPropagation();

    if (event.shiftKey && lastClickedEmailRef.current) {
      // Range selection: select all emails between last clicked and current
      const lastIdx = emails.findIndex((e: any) => e.id === lastClickedEmailRef.current);
      const currentIdx = emails.findIndex((e: any) => e.id === emailId);

      if (lastIdx !== -1 && currentIdx !== -1) {
        const start = Math.min(lastIdx, currentIdx);
        const end = Math.max(lastIdx, currentIdx);
        const rangeIds = emails.slice(start, end + 1).map((e: any) => e.id);

        // Add all in range to selection
        const { selectMultipleEmails, selectedEmailIds } = useEmailStore.getState();
        const newSelection = new Set(selectedEmailIds);
        rangeIds.forEach(id => newSelection.add(id));
        selectMultipleEmails(Array.from(newSelection));
      }
    } else {
      // Normal toggle
      toggleEmailSelection(emailId);
      lastClickedEmailRef.current = emailId;
    }
  }, [emails, toggleEmailSelection]);

  // Handle email click - select email, unless in select mode
  // Track the last selected email to detect double-clicks on the same email
  const lastSelectedEmailRef = useRef<string | null>(null);

  const handleEmailClick = useCallback((emailId: string) => {
    if (isSelectMode) {
      toggleEmailSelection(emailId);
    } else if (lastSelectedEmailRef.current === emailId) {
      // Clicking the same email again toggles selection mode
      toggleEmailSelection(emailId);
      lastSelectedEmailRef.current = null;
    } else {
      // First click on an email - select it for viewing
      onEmailSelect(emailId);
      lastSelectedEmailRef.current = emailId;
    }
  }, [isSelectMode, toggleEmailSelection, onEmailSelect]);

  // Reset the last selected email when isSelectMode changes
  useEffect(() => {
    if (!isSelectMode) {
      lastSelectedEmailRef.current = null;
    }
  }, [isSelectMode]);

  // Bulk action handlers
  const handleBulkAction = useCallback(async (action: string) => {
    switch (action) {
      case 'archive':
        await bulkArchive();
        break;
      case 'delete':
        await bulkDelete();
        break;
      case 'markRead':
        await bulkMarkAsRead();
        break;
      case 'save':
        bulkSave();
        break;
    }
  }, [bulkArchive, bulkDelete, bulkMarkAsRead, bulkSave]);

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

  // Use refs to store latest callback values to avoid recreating keyboard listener
  const callbacksRef = useRef({
    navigateEmail,
    focusedEmailId,
    onEmailSelect,
    onOpenFocusedView,
    onTriggerReply,
    archiveEmail,
    deleteEmail,
    onEmailAction,
    isSelectMode,
    clearSelection,
    selectAllVisible,
    toggleEmailSelection,
  });

  // Update refs when callbacks change
  useEffect(() => {
    callbacksRef.current = {
      navigateEmail,
      focusedEmailId,
      onEmailSelect,
      onOpenFocusedView,
      onTriggerReply,
      archiveEmail,
      deleteEmail,
      onEmailAction,
      isSelectMode,
      clearSelection,
      selectAllVisible,
      toggleEmailSelection,
    };
  });

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

      const cb = callbacksRef.current;

      // Escape: exit select mode
      if (e.key === 'Escape') {
        if (cb.isSelectMode) {
          e.preventDefault();
          cb.clearSelection();
          return;
        }
      }

      // Cmd/Ctrl+A: Select all visible emails
      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault();
        cb.selectAllVisible();
        return;
      }

      // Space: Toggle selection of focused email
      if (e.key === ' ' && cb.focusedEmailId) {
        e.preventDefault();
        cb.toggleEmailSelection(cb.focusedEmailId);
        return;
      }

      // Navigation shortcuts (j/k) - work even in select mode
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        cb.navigateEmail('next');
        return;
      }

      if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        cb.navigateEmail('prev');
        return;
      }

      // If in select mode, don't process other single-email actions
      if (cb.isSelectMode) {
        return;
      }

      switch (e.key) {
        case 'Enter':
          e.preventDefault();
          // First select the email, then open focused view
          if (cb.focusedEmailId) {
            cb.onEmailSelect(cb.focusedEmailId);
            cb.onOpenFocusedView();
          }
          break;
        case 'r':
          e.preventDefault();
          cb.onTriggerReply();
          break;
        case 'a':
          e.preventDefault();
          cb.archiveEmail();
          break;
        case 's':
          e.preventDefault();
          cb.onEmailAction(cb.focusedEmailId, 'save');
          break;
        case 'd':
          e.preventDefault();
          cb.deleteEmail();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []); // Empty deps - only creates listener once

  return (
    <div className="flex-1 overflow-y-auto" ref={listRef}>
      {/* Bulk action toolbar - shown when emails are selected */}
      {isSelectMode && (
        <div className="px-4 py-3 bg-purple-50 dark:bg-purple-900/30 border-b border-purple-200 dark:border-purple-700 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-purple-700 dark:text-purple-300">
              {selectedEmailIds.size} email{selectedEmailIds.size !== 1 ? 's' : ''} selected
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => handleBulkAction('markRead')}
                className="px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                title="Mark as read"
              >
                Mark read
              </button>
              <button
                onClick={() => handleBulkAction('archive')}
                className="px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                title="Archive"
              >
                Archive
              </button>
              <button
                onClick={() => handleBulkAction('save')}
                className="px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                title="Save"
              >
                Save
              </button>
              <button
                onClick={() => handleBulkAction('delete')}
                className="px-2 py-1 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 rounded"
                title="Delete"
              >
                Delete
              </button>
            </div>
          </div>
          <button
            onClick={clearSelection}
            className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            Clear
          </button>
        </div>
      )}

      {/* Keyboard shortcuts hint */}
      <div className="px-4 py-3 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 space-y-1.5">
        <div className="font-medium text-gray-600 dark:text-gray-300">Keyboard shortcuts</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono">j</kbd> <kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono">k</kbd> navigate</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono">Enter</kbd> focused</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono">Space</kbd> select</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono text-xs">⌘</kbd><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono">A</kbd> all</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono">a</kbd> archive</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono">s</kbd> save</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono">d</kbd> delete</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono">Esc</kbd> clear</span>
        </div>
      </div>
      <div className="p-4 space-y-2">
        {emails.map((email: any) => {
          const replyData = getEmailReplyData(email.id);
          const isFyi = replyData?.loaded && replyData.requiresReply === false;
          const isFocused = focusedEmailId === email.id;
          const isSelected = isEmailSelected(email.id);

          return (
            <div
              key={email.id}
              id={`email-item-${email.id}`}
              className={`relative p-4 bg-surface dark:bg-gray-800 border rounded-lg hover:shadow-md transition-all cursor-pointer ${
                isSelected ? 'border-purple-500 dark:border-purple-400 ring-2 ring-purple-200 dark:ring-purple-900 bg-purple-50/50 dark:bg-purple-900/20' :
                isFocused ? 'border-purple-400 dark:border-purple-500 ring-2 ring-purple-300 dark:ring-purple-700 bg-purple-50/50 dark:bg-purple-900/20' :
                selectedEmailId === email.id ? 'border-blue-500 dark:border-blue-400 ring-2 ring-blue-200 dark:ring-blue-900' : 'border-border'
              } ${isFyi ? 'opacity-60' : ''}`}
              onClick={() => handleEmailClick(email.id)}
            >
              {/* Selection sidebar strip */}
              <div
                className={`absolute left-0 top-0 bottom-0 w-1.5 rounded-l-lg transition-all cursor-pointer ${
                  isSelected ? 'bg-purple-500' : 'bg-transparent hover:bg-gray-400 dark:hover:bg-gray-600'
                }`}
                onClick={(e) => handleStripClick(email.id, e)}
                title={isSelected ? 'Click to deselect' : 'Click to select (Shift+click for range)'}
              />

              <div className="flex items-start justify-between gap-2 pl-2">
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
