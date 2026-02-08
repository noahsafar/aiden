import React, { useEffect, useCallback, useRef, useState } from 'react';
import { useEmailStore } from '@/stores/emailStore';
import { Clock, BellOff, Send, ChevronDown } from 'lucide-react';

interface EmailQuestionData {
  questions: string[];
  suggestedFormalityScore: number;
  requiresReply?: boolean;
  replyReasoning?: string;
  loaded: boolean;
  meetingRequest?: { is_meeting: boolean };
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
  onBulkDelete?: (emailIds?: string[]) => void;  // Bulk delete with undo toast
  onBump?: (emailId: string) => void;  // Trigger AI bump for a sent email
}

// Helper function to get reply requirement data for an email
function getEmailReplyData(emailId: string): EmailQuestionData | undefined {
  if (typeof window !== 'undefined' && (window as any).emailQuestionData) {
    return (window as any).emailQuestionData.get(emailId);
  }
  return undefined;
}

// Helper function to get summary for an email from store
function getEmailSummary(emailId: string, emailStore: any): string | undefined {
  const email = emailStore.emails.find((e: any) => e.id === emailId);
  return email?.summary;
}

// Helper function to get attachment count
function getAttachmentCount(email: any): number {
  if (email.attachments && Array.isArray(email.attachments)) {
    return email.attachments.length;
  }
  return email.hasAttachments ? 1 : 0;
}

// Helper function to check if email is a reply (thread indicator)
function isReplyEmail(email: any, allEmails: any[]): boolean {
  const subject = email.subject || '';
  const subjectLower = subject.toLowerCase();

  // Check for common reply/forward prefixes
  if (subjectLower.startsWith('re:') || subjectLower.startsWith('fwd:') || subjectLower.startsWith('fw:')) {
    return true;
  }

  // Only show thread indicator if there are multiple emails with the same thread ID
  if (email.threadId) {
    const threadCount = allEmails.filter((e: any) => e.threadId === email.threadId).length;
    return threadCount > 1;
  }

  return false;
}

// Helper function to get thread count (how many emails in this thread)
function getThreadCount(emailId: string, emails: any[]): number {
  const email = emails.find((e: any) => e.id === emailId);
  if (!email?.threadId) return 1;
  const count = emails.filter((e: any) => e.threadId === email.threadId).length;
  return count > 1 ? count : 1;
}

// Helper function to get waiting email info
function getWaitingEmailInfo(email: any, sentEmails: any[]): { daysWaiting: number; isOverdue: boolean } | null {
  const sentEmail = sentEmails.find((e: any) => e.id === email.id);
  console.log('[EmailList] getWaitingEmailInfo for', email.id, ': found?', !!sentEmail, 'has waiting field?', !!sentEmail?.waiting_on_reply_since);

  if (!sentEmail?.waiting_on_reply_since) return null;

  const now = new Date();
  const waitingSince = new Date(sentEmail.waiting_on_reply_since);
  const daysWaiting = Math.floor((now.getTime() - waitingSince.getTime()) / (1000 * 60 * 60 * 24));

  const reminderDue = sentEmail.reminder_due_date
    ? new Date(sentEmail.reminder_due_date)
    : new Date(waitingSince.getTime() + 3 * 24 * 60 * 60 * 1000);
  const isOverdue = new Date(now) >= reminderDue;

  return { daysWaiting, isOverdue };
}

// Component for the action badge - memoized for performance (defined outside to prevent re-creation)
const ActionBadge = React.memo(({ emailId }: { emailId: string }) => {
  const data = getEmailReplyData(emailId);

  // Meeting requests always require action
  const isMeetingRequest = data?.meetingRequest?.is_meeting;

  // If not loaded yet, show nothing (waiting for AI analysis)
  if (!data?.loaded) {
    return null;
  }

  // Meeting requests always show as Action Required
  if (isMeetingRequest) {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700 border border-blue-200">
        Meeting
      </span>
    );
  }

  // After analysis, show Action Required or FYI based on analysis
  if (data.requiresReply) {
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
  onBulkDelete,
  onBump,
}) => {
  const listRef = useRef<HTMLDivElement>(null);
  const [shortcutsCollapsed, setShortcutsCollapsed] = useState(true);
  const [snoozeDropdownOpen, setSnoozeDropdownOpen] = useState<string | null>(null);

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
    sentEmails,
    cancelReminder,
    snoozeReminder,
    currentFilter,
  } = useEmailStore();

  // Debug: log sentEmails with waiting field
  React.useEffect(() => {
    const waitingInStore = sentEmails.filter(e => e.waiting_on_reply_since);
    console.log('[EmailList] sentEmails with waiting_on_reply_since:', waitingInStore.length, waitingInStore.map(e => ({ id: e.id, subject: e.subject })));
    if (emails.length > 0) {
      const firstEmail = emails[0];
      console.log('[EmailList] FIRST EMAIL:', JSON.stringify({
        id: firstEmail.id,
        subject: firstEmail.subject,
        hasWaiting: !!firstEmail.waiting_on_reply_since,
        allKeys: Object.keys(firstEmail),
        from: firstEmail.from,
        to: firstEmail.to
      }));
    }
  }, [sentEmails, emails]);

  // Close snooze dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      setSnoozeDropdownOpen(null);
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

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
        if (onBulkDelete) {
          // Use custom bulk delete with undo toast
          const selectedIds = Array.from(selectedEmailIds);
          onBulkDelete(selectedIds);
        } else {
          // Fall back to regular bulk delete
          await bulkDelete();
        }
        break;
      case 'markRead':
        await bulkMarkAsRead();
        break;
      case 'save':
        bulkSave();
        break;
    }
  }, [bulkArchive, bulkDelete, bulkMarkAsRead, bulkSave, onBulkDelete, selectedEmailIds]);

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
    handleBulkAction,
    selectedEmailIds,
    currentFilter,
    emails,
    sentEmails,
    cancelReminder,
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
      handleBulkAction,
      selectedEmailIds,
      currentFilter,
      emails,
      sentEmails,
      cancelReminder,
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
      if (e.key === 'k' || e.key === 'ArrowDown') {
        e.preventDefault();
        cb.navigateEmail('next');
        return;
      }

      if (e.key === 'j' || e.key === 'ArrowUp') {
        e.preventDefault();
        cb.navigateEmail('prev');
        return;
      }

      // Bulk action shortcuts when emails are selected (a/s/d)
      // Archive is not allowed in sent view
      if (cb.isSelectMode && cb.selectedEmailIds.size > 0) {
        if (e.key === 'a' || e.key === 'A') {
          e.preventDefault();
          // Skip archiving in sent view
          if (cb.currentFilter === 'sent') {
            return;
          }
          cb.handleBulkAction('archive');
          cb.clearSelection();
          return;
        }
        if (e.key === 's' || e.key === 'S') {
          e.preventDefault();
          cb.handleBulkAction('save');
          cb.clearSelection();
          return;
        }
        if (e.key === 'd' || e.key === 'D') {
          e.preventDefault();
          cb.handleBulkAction('delete');
          cb.clearSelection();
          return;
        }
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
          // Skip archiving in sent view
          if (cb.currentFilter === 'sent') {
            return;
          }
          cb.archiveEmail();
          break;
        case 's':
          e.preventDefault();
          cb.onEmailAction(cb.focusedEmailId, 'save');
          break;
        case 'd':
          e.preventDefault();
          // Check if focused email is a waiting-on-reply email in INBOX - if so, dismiss instead of delete
          if (cb.focusedEmailId && cb.currentFilter !== 'sent') {
            const focusedEmail = cb.emails?.find((e: any) => e.id === cb.focusedEmailId);
            if (focusedEmail?.waiting_on_reply_since) {
              // This is a waiting-on-reply email in inbox, dismiss the reminder
              const sentEmail = cb.sentEmails?.find((se: any) =>
                se.subject === focusedEmail.subject &&
                Math.abs(new Date(se.date).getTime() - new Date(focusedEmail.date || 0).getTime()) < 1000
              );
              if (sentEmail?.id && cb.cancelReminder) {
                cb.cancelReminder(sentEmail.id);
              }
              break;
            }
          }
          // Regular email OR sent view - delete it
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
              {currentFilter !== 'sent' && (
                <button
                  onClick={() => handleBulkAction('archive')}
                  className="px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                  title="Archive"
                >
                  Archive
                </button>
              )}
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
      <div className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
        <button
          onClick={() => setShortcutsCollapsed(!shortcutsCollapsed)}
          className="w-full px-4 py-2 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <span className="font-medium text-gray-600 dark:text-gray-300">List View Shortcuts</span>
        </button>
        {!shortcutsCollapsed && (
          <div className="px-4 pb-3 space-y-1.5">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono">j</kbd> <kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono">k</kbd> navigate</span>
              <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono">Enter</kbd> focused view</span>
              <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono">Space</kbd> select</span>
              <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono text-xs">⌘</kbd><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono">A</kbd> select all</span>
              <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono">s</kbd> save</span>
              {currentFilter !== 'sent' && (
                <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono">a</kbd> archive</span>
              )}
              <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono">d</kbd> delete</span>
              <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono">Esc</kbd> clear</span>
            </div>
          </div>
        )}
      </div>
      <div className="p-4 space-y-2">
        {emails.map((email: any, index: number) => {
          const replyData = getEmailReplyData(email.id);
          const isFyi = replyData?.loaded && replyData.requiresReply === false;
          const isFocused = focusedEmailId === email.id;
          const isSelected = isEmailSelected(email.id);

          // Get additional info for enhanced preview
          const summary = getEmailSummary(email.id, useEmailStore.getState());
          const attachmentCount = getAttachmentCount(email);
          const isReply = isReplyEmail(email, emails);
          const threadCount = getThreadCount(email.id, emails);

          // Check if this is a waiting-on-reply sent email that needs follow-up (AI determined)
          const isWaitingEmail = !!email.waiting_on_reply_since && email.needs_follow_up === true;
          const isOverdue = email.waiting_on_reply_since ? (() => {
            const now = new Date();
            const waitingSince = new Date(email.waiting_on_reply_since);
            const daysWaiting = Math.floor((now.getTime() - waitingSince.getTime()) / (1000 * 60 * 60 * 24));
            const reminderDue = email.reminder_due_date
              ? new Date(email.reminder_due_date)
              : new Date(waitingSince.getTime() + 3 * 24 * 60 * 60 * 1000);
            return new Date(now) >= reminderDue ? { daysWaiting, isOverdue: true } : { daysWaiting, isOverdue: false };
          })() : null;

          // Handle dismiss action
          const handleDismiss = (e: React.MouseEvent) => {
            e.stopPropagation();
            // Find the email in sentEmails by matching subject and date
            const sentEmail = sentEmails.find((se: any) =>
              se.subject === email.subject &&
              Math.abs(new Date(se.date).getTime() - new Date(email.date || 0).getTime()) < 1000
            );
            if (sentEmail?.id) {
              cancelReminder(sentEmail.id);
            }
          };

          return (
            <div
              key={email.id || `email-${index}`}
              id={`email-item-${email.id || index}`}
              className={`relative p-4 bg-surface dark:bg-gray-800 border rounded-lg hover:shadow-md transition-all cursor-pointer ${
                isWaitingEmail
                  ? (selectedEmailId === email.id || isFocused
                      ? (isOverdue?.isOverdue
                          ? 'bg-amber-50 dark:bg-amber-900/20 border-blue-500 dark:border-blue-400'
                          : 'bg-blue-50 dark:bg-blue-900/20 border-blue-500 dark:border-blue-400')
                      : (isOverdue?.isOverdue
                          ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700 shadow-sm'
                          : 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700'))
                  : (isSelected
                      ? 'border-purple-500 dark:border-purple-400 ring-2 ring-purple-200 dark:ring-purple-900 bg-purple-50/50 dark:bg-purple-900/20'
                      : (isFocused
                          ? 'border-blue-500 dark:border-blue-400'
                          : (selectedEmailId === email.id
                              ? 'border-blue-500 dark:border-blue-400 ring-2 ring-blue-200 dark:ring-blue-900'
                              : 'bg-surface dark:bg-gray-800 border-border')))
              } ${isFyi && !isWaitingEmail ? 'opacity-60' : ''}`}
              onClick={() => handleEmailClick(email.id)}
            >
              {/* Selection sidebar strip */}
              <div
                className={`absolute left-0 top-0 bottom-0 w-1.5 rounded-l-lg transition-all cursor-pointer z-10 ${
                  isSelected ? 'bg-purple-500' : 'bg-transparent hover:bg-gray-400 dark:hover:bg-gray-600'
                }`}
                onClick={(e) => handleStripClick(email.id, e)}
                title={isSelected ? 'Click to deselect' : 'Click to select (Shift+click for range)'}
              />

              {/* Waiting indicator header */}
              {isWaitingEmail && (
                <div className={`py-2 mb-3 flex items-center justify-between -mx-4 -mt-4 rounded-t-xl ${
                  isOverdue?.isOverdue
                    ? 'bg-amber-100 dark:bg-amber-900/40 px-4'
                    : 'bg-blue-100 dark:bg-blue-900/40 px-4'
                }`}>
                  <div className="flex items-center gap-2">
                    <Clock className={`w-3.5 h-3.5 ${isOverdue?.isOverdue ? 'text-amber-600 dark:text-amber-400' : 'text-blue-600 dark:text-blue-400'}`} />
                    <span className={`text-xs font-medium ${isOverdue?.isOverdue ? 'text-amber-700 dark:text-amber-300' : 'text-blue-700 dark:text-blue-300'}`}>
                      {isOverdue?.isOverdue ? 'No reply!' : 'Waiting'}
                    </span>
                    <span className={`text-xs ${isOverdue?.isOverdue ? 'text-amber-600 dark:text-amber-400' : 'text-blue-600 dark:text-blue-400'}`}>
                      {isOverdue?.daysWaiting} {isOverdue?.daysWaiting === 1 ? 'day' : 'days'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {/* Show bump button for all sent emails (in sent view or waiting emails in inbox) */}
                    {isWaitingEmail || email.labels?.some((l: any) => l.name === 'Sent') ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onBump) {
                            onBump(email.id);
                          } else {
                            handleEmailClick(email.id);
                          }
                        }}
                        className={`p-1 bg-white dark:bg-gray-800 border rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                          isOverdue?.isOverdue
                            ? 'text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700 hover:bg-amber-50 dark:hover:bg-amber-900/30'
                            : 'text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-600'
                        }`}
                        title="Bump this thread"
                      >
                        <Send className="w-3.5 h-3.5" />
                      </button>
                    ) : null}
                    {/* Snooze and dismiss buttons - snooze only in inbox, dismiss in both */}
                    {isWaitingEmail && (
                      <>
                        {/* Show snooze button: always in inbox, only for overdue emails in sent */}
                        {currentFilter !== 'sent' || isOverdue?.isOverdue ? (
                        <div className="relative">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSnoozeDropdownOpen(snoozeDropdownOpen === email.id ? null : email.id);
                            }}
                            className="p-1 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                            title="Snooze reminder"
                          >
                            <Clock className="w-3.5 h-3.5" />
                          </button>
                          {snoozeDropdownOpen === email.id && (
                            <div className="absolute right-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 min-w-[100px]">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const sentEmail = sentEmails.find((se: any) => se.id === email.id);
                                  if (sentEmail?.id) {
                                    snoozeReminder(sentEmail.id, 1);
                                  }
                                  setSnoozeDropdownOpen(null);
                                }}
                                className="w-full px-2 py-1.5 text-left text-xs hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-between"
                              >
                                <span>Tomorrow</span>
                                <span className="text-gray-500">1d</span>
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const sentEmail = sentEmails.find((se: any) => se.id === email.id);
                                  if (sentEmail?.id) {
                                    snoozeReminder(sentEmail.id, 2);
                                  }
                                  setSnoozeDropdownOpen(null);
                                }}
                                className="w-full px-2 py-1.5 text-left text-xs hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-between"
                              >
                                <span>2 days</span>
                                <span className="text-gray-500">2d</span>
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const sentEmail = sentEmails.find((se: any) => se.id === email.id);
                                  if (sentEmail?.id) {
                                    snoozeReminder(sentEmail.id, 3);
                                  }
                                  setSnoozeDropdownOpen(null);
                                }}
                                className="w-full px-2 py-1.5 text-left text-xs hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-between"
                              >
                                <span>3 days</span>
                                <span className="text-gray-500">3d</span>
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const sentEmail = sentEmails.find((se: any) => se.id === email.id);
                                  if (sentEmail?.id) {
                                    snoozeReminder(sentEmail.id, 7);
                                  }
                                  setSnoozeDropdownOpen(null);
                                }}
                                className="w-full px-2 py-1.5 text-left text-xs hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-between"
                              >
                                <span>1 week</span>
                                <span className="text-gray-500">7d</span>
                              </button>
                            </div>
                          )}
                        </div>
                        ) : null}
                        <button
                          onClick={handleDismiss}
                          className="p-1 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                          title="Dismiss reminder"
                        >
                          <BellOff className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

              <div className="flex items-start justify-between gap-2 pl-2">
                <div className="flex-1 min-w-0">
                  {/* Top row: Sender, badges, indicators */}
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-xs text-muted truncate">
                      {isWaitingEmail ? `To: ${email.recipients || 'Unknown'}` : (email.from?.name || email.from?.email || 'Unknown')}
                    </span>
                    {!isWaitingEmail && <ActionBadge emailId={email.id} />}
                    {email.status === 'Saved' && !email.labels?.some((l: any) => l.name === 'Sent') && !email.waiting_on_reply_since && !email.recipients && <span className="text-blue-500" title="Saved">◆</span>}
                    {/* Thread indicator */}
                    {isReply && !isWaitingEmail && (
                      <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-0.5" title={`Thread (${threadCount} messages)`}>
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                        </svg>
                        {threadCount > 1 && <span>{threadCount}</span>}
                      </span>
                    )}
                    {/* Attachment indicator */}
                    {attachmentCount > 0 && (
                      <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-0.5" title={`${attachmentCount} attachment${attachmentCount > 1 ? 's' : ''}`}>
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                        </svg>
                        {attachmentCount > 1 && <span>{attachmentCount}</span>}
                      </span>
                    )}
                  </div>

                  {/* Subject */}
                  <h3 className={`font-semibold text-foreground text-sm ${!email.isRead && !isWaitingEmail ? 'text-blue-600 dark:text-blue-400' : ''}`}>
                    {email.subject}
                  </h3>

                  {/* Summary or preview - show summary if available, otherwise preview */}
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">
                    {summary ? (
                      <span className="text-purple-700 dark:text-purple-300 font-medium">{summary}</span>
                    ) : (
                      <span>{email.preview}</span>
                    )}
                  </p>
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
