import React, { useMemo, useCallback, useRef, useEffect, useState } from 'react';
import { useEmailStore } from '@/stores/emailStore';
import {
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Users,
  Clock,
  Star,
  Bookmark,
  Archive,
  Mail,
  ChevronUp,
} from 'lucide-react';

interface EmailQuestionData {
  questions: string[];
  suggestedFormalityScore: number;
  requiresReply?: boolean;
  replyReasoning?: string;
  loaded: boolean;
  meetingRequest?: { is_meeting: boolean };
}

// Helper function to get reply requirement data for an email
function getEmailReplyData(emailId: string): EmailQuestionData | undefined {
  if (typeof window !== 'undefined' && (window as any).emailQuestionData) {
    return (window as any).emailQuestionData.get(emailId);
  }
  return undefined;
}

// Component for the action badge
const ActionBadge = React.memo(({ emailId }: { emailId: string }) => {
  const data = getEmailReplyData(emailId);
  const isMeetingRequest = data?.meetingRequest?.is_meeting;

  if (!data?.loaded) {
    return null;
  }

  if (isMeetingRequest) {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700 border border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800">
        Meeting
      </span>
    );
  }

  if (data.requiresReply) {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800">
        Action Required
      </span>
    );
  }

  return (
    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-500 border border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700">
      FYI
    </span>
  );
});

ActionBadge.displayName = 'ActionBadge';

interface ThreadedEmailListProps {
  emails: any[];
  selectedEmailId: string | null;
  onEmailSelect: (id: string) => void;
  onEmailAction: (id: string, action: string) => void;
  focusedEmailId: string | null;
  onFocusEmail: (id: string) => void;
  onOpenFocusedView?: () => void;
  sortMode?: 'date' | 'importance';
  onBulkDelete?: (emailIds?: string[]) => void;
  currentFilter?: string;
}

export const ThreadedEmailList: React.FC<ThreadedEmailListProps> = ({
  emails,
  selectedEmailId,
  onEmailSelect,
  onEmailAction,
  focusedEmailId,
  onFocusEmail,
  onOpenFocusedView,
  sortMode = 'date',
  onBulkDelete,
  currentFilter = 'inbox',
}) => {
  const listRef = useRef<HTMLDivElement>(null);
  const [shortcutsCollapsed, setShortcutsCollapsed] = useState(true);

  const {
    expandedThreads,
    toggleThreadExpanded,
    groupEmailsByThread,
    isEmailSelected,
    toggleEmailSelection,
    selectMultipleEmails,
    isSelectMode,
    bulkArchive,
    bulkDelete,
    bulkSave,
    clearSelection,
    selectedEmailIds,
    selectAllVisible,
    deselectMultipleEmails,
    expandAllThreads,
    collapseAllThreads,
    sentEmails,
    emails: allStoreEmails, // All received emails from the store
  } = useEmailStore();

  // Group emails by thread - include both received emails and sent emails for complete threads
  const threadGroups = useMemo(() => {
    // Check if current view is already showing sent emails (to avoid duplicates)
    // We check if ALL (or most) emails have the 'Sent' label, which indicates sent view
    // In inbox view, emails would be received emails without the 'Sent' label
    const emailsWithSentLabel = emails.filter((e: any) => e.labels?.some((l: any) => l.name === 'Sent'));
    const alreadyIncludesSent = emails.length > 0 && emailsWithSentLabel.length > emails.length / 2;

    // Combine received and sent emails for complete thread view
    let allEmails: any[];
    if (alreadyIncludesSent) {
      // In sent view: combine sent emails with received emails from the same threads
      // Get thread_ids from the sent emails
      const sentThreadIds = new Set(emails.map((e: any) => e.thread_id || e.id));
      // Find all received emails that belong to these threads
      const receivedEmailsInThreads = allStoreEmails.filter((e: any) => {
        const threadId = e.thread_id || e.id;
        return sentThreadIds.has(threadId);
      });
      // Combine: sent emails + received emails from the same threads
      allEmails = [...emails, ...receivedEmailsInThreads];
    } else if (currentFilter === 'saved' || currentFilter === 'archived') {
      // In saved/archived view: don't add sent emails - saved/archived sent emails are already included in emails array
      allEmails = [...emails];
    } else {
      // In inbox view: add sent emails to received emails
      // BUT avoid duplicates - sent emails might already be in emails array (e.g., overdue sent emails shown in inbox)
      const emailIds = new Set(emails.map((e: any) => e.id));
      const uniqueSentEmails = sentEmails.filter((e: any) => !emailIds.has(e.id));
      allEmails = [...emails, ...uniqueSentEmails];
    }

    const groups = groupEmailsByThread(allEmails);
    console.log('[threadGroups] groups:', Array.from(groups.entries()).map(([tid, emails]) => [
      tid,
      emails.map((e: any) => ({ id: e.id, subject: e.subject?.substring(0, 30), isSent: !!sentEmails.find(se => se.id === e.id), status: (emails.find((em: any) => em.id === e.id) as any)?.status }))
    ]));
    console.log('[threadGroups] alreadyIncludesSent:', alreadyIncludesSent, 'emails:', emails.length, 'emailsWithSentLabel:', emailsWithSentLabel.length, 'sentEmails:', sentEmails.length, 'allEmails:', allEmails.length);
    return groups;
  }, [emails, groupEmailsByThread, sentEmails, allStoreEmails]);

  // Convert to array and sort by most recent email in each thread
  const sortedThreads = useMemo(() => {
    const threads = Array.from(threadGroups.entries())
      .map(([threadId, threadEmails]) => {
        const mostRecent = threadEmails[threadEmails.length - 1];
        return { threadId, emails: threadEmails, mostRecent };
      });

    // Sort by selected mode
    if (sortMode === 'importance') {
      // Sort by category priority: Urgent > Important > Normal > Low
      const categoryOrder = { 'Urgent': 0, 'Important': 1, 'Normal': 2, 'Low': 3 };
      return threads.sort((a, b) => {
        const aCategory = a.mostRecent.category || 'Normal';
        const bCategory = b.mostRecent.category || 'Normal';
        const aOrder = categoryOrder[aCategory as keyof typeof categoryOrder] ?? 2;
        const bOrder = categoryOrder[bCategory as keyof typeof categoryOrder] ?? 2;
        if (aOrder !== bOrder) {
          return aOrder - bOrder;
        }
        // Within same category, sort by date (newest first)
        const aTime = new Date(a.mostRecent.date).getTime();
        const bTime = new Date(b.mostRecent.date).getTime();
        return bTime - aTime;
      });
    } else {
      // Sort by date (newest first)
      return threads.sort((a, b) => {
        const aTime = new Date(a.mostRecent.date).getTime();
        const bTime = new Date(b.mostRecent.date).getTime();
        return bTime - aTime;
      });
    }
  }, [threadGroups, sortMode]);

  // Handle thread expansion toggle
  const handleThreadToggle = useCallback((threadId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    toggleThreadExpanded(threadId);
  }, [toggleThreadExpanded]);

  // Handle thread header click
  const handleThreadHeaderClick = useCallback((emailId: string, threadId: string, threadEmails: any[]) => {
    // Check if all emails in this thread are selected
    const currentSelection = useEmailStore.getState().selectedEmailIds;
    const allSelected = threadEmails.every((email: any) => currentSelection.has(email.id));
    const isThreadFocused = threadEmails.some((e: any) => e.id === focusedEmailId);
    const hasExistingSelection = currentSelection.size > 0;

    console.log('[handleThreadHeaderClick] Thread clicked:', {
      threadId,
      emailId,
      allSelected,
      isThreadFocused,
      hasExistingSelection,
      threadEmailCount: threadEmails.length,
      threadEmailIds: threadEmails.map((e: any) => ({ id: e.id, subject: e.subject?.substring(0, 30) }))
    });

    if (allSelected) {
      // Thread is selected - deselect all emails in thread
      console.log('[handleThreadHeaderClick] Deselecting all in thread');
      deselectMultipleEmails(threadEmails.map((e: any) => e.id));
      onEmailSelect(emailId);
      onFocusEmail(emailId);
    } else if (isThreadFocused || hasExistingSelection) {
      // Thread is focused OR there's already a selection - select all emails in thread
      console.log('[handleThreadHeaderClick] Selecting all in thread');
      selectMultipleEmails(threadEmails.map((e: any) => e.id));
      onEmailSelect(emailId);
      onFocusEmail(emailId);
    } else {
      // Not focused and no existing selection - just focus it (don't select)
      console.log('[handleThreadHeaderClick] Just focusing (no selection)');
      onEmailSelect(emailId);
      onFocusEmail(emailId);
    }
  }, [onEmailSelect, onFocusEmail, focusedEmailId, selectMultipleEmails, deselectMultipleEmails]);

  // Handle individual email click in expanded view - selects just that email
  const handleIndividualEmailClick = useCallback((emailId: string) => {
    const currentSelection = useEmailStore.getState().selectedEmailIds;
    const emailIsSelected = currentSelection.has(emailId);
    const isFocused = focusedEmailId === emailId;
    const hasExistingSelection = currentSelection.size > 0;

    console.log('[handleIndividualEmailClick] emailId:', emailId, 'emailIsSelected:', emailIsSelected, 'hasExistingSelection:', hasExistingSelection, 'currentSelection:', Array.from(currentSelection));

    if (emailIsSelected) {
      // Email is selected - deselect it
      toggleEmailSelection(emailId);
    } else if (isFocused || hasExistingSelection) {
      // Email is focused OR there's existing selection - select it
      toggleEmailSelection(emailId);
    }
    // Always focus the clicked email
    onEmailSelect(emailId);
    onFocusEmail(emailId);
  }, [focusedEmailId, onEmailSelect, onFocusEmail, toggleEmailSelection]);

  // Handle thread strip click - toggles selection of all emails in the thread
  const handleThreadStripClick = useCallback((threadId: string, threadEmails: any[], e: React.MouseEvent) => {
    e.stopPropagation();
    const currentSelection = useEmailStore.getState().selectedEmailIds;
    const allSelected = threadEmails.every((email: any) => currentSelection.has(email.id));

    if (allSelected) {
      deselectMultipleEmails(threadEmails.map((e: any) => e.id));
    } else {
      selectMultipleEmails(threadEmails.map((e: any) => e.id));
    }
  }, [selectMultipleEmails, deselectMultipleEmails]);

  // Handle individual email strip click - toggles selection of just that email
  const handleIndividualStripClick = useCallback((emailId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    toggleEmailSelection(emailId);
  }, [toggleEmailSelection]);

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
      case 'save':
        bulkSave();
        break;
    }
  }, [bulkArchive, bulkDelete, bulkSave, onBulkDelete, selectedEmailIds]);

  // Navigate to next/previous email (navigates through threads)
  const navigateEmail = useCallback((direction: 'next' | 'prev') => {
    if (sortedThreads.length === 0) return;

    // Find current thread and email position
    let currentThreadIndex = -1;
    let currentEmailIndexInThread = -1;

    for (let i = 0; i < sortedThreads.length; i++) {
      const thread = sortedThreads[i];
      const emailIdx = thread.emails.findIndex((e: any) => e.id === focusedEmailId);
      if (emailIdx !== -1) {
        currentThreadIndex = i;
        currentEmailIndexInThread = emailIdx;
        break;
      }
    }

    // If no focused email, start with first thread's most recent email
    if (currentThreadIndex === -1) {
      const firstThread = sortedThreads[0];
      const emailToSelect = firstThread.mostRecent;
      if (emailToSelect) {
        onFocusEmail(emailToSelect.id);
        onEmailSelect(emailToSelect.id);
      }
      return;
    }

    let nextEmail: any = null;

    if (direction === 'next') {
      // Try to move to next email in current thread
      if (currentEmailIndexInThread < sortedThreads[currentThreadIndex].emails.length - 1) {
        nextEmail = sortedThreads[currentThreadIndex].emails[currentEmailIndexInThread + 1];
      } else {
        // Move to first email of next thread
        const nextThreadIndex = (currentThreadIndex + 1) % sortedThreads.length;
        nextEmail = sortedThreads[nextThreadIndex].emails[0];
      }
    } else {
      // Try to move to previous email in current thread
      if (currentEmailIndexInThread > 0) {
        nextEmail = sortedThreads[currentThreadIndex].emails[currentEmailIndexInThread - 1];
      } else {
        // Move to last email of previous thread
        const prevThreadIndex = currentThreadIndex > 0 ? currentThreadIndex - 1 : sortedThreads.length - 1;
        const prevThread = sortedThreads[prevThreadIndex];
        nextEmail = prevThread.emails[prevThread.emails.length - 1];
      }
    }

    if (nextEmail) {
      onFocusEmail(nextEmail.id);
      onEmailSelect(nextEmail.id);

      setTimeout(() => {
        const element = document.getElementById(`threaded-email-item-${nextEmail.id}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }, 0);
    }
  }, [sortedThreads, focusedEmailId, onFocusEmail, onEmailSelect]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      if (e.key === 'Escape' && isSelectMode) {
        e.preventDefault();
        clearSelection();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault();
        selectAllVisible();
        return;
      }

      if (e.key === ' ' && focusedEmailId) {
        e.preventDefault();
        // Find which thread the focused email belongs to
        for (const [threadId, threadEmails] of threadGroups.entries()) {
          if (threadEmails.some((e: any) => e.id === focusedEmailId)) {
            const isExpanded = expandedThreads.has(threadId);
            if (isExpanded) {
              // In expanded view, only toggle the focused email
              toggleEmailSelection(focusedEmailId);
            } else {
              // In collapsed view, toggle entire thread
              const allSelected = threadEmails.every((email: any) => isEmailSelected(email.id));
              if (allSelected) {
                // Deselect all in thread
                const threadIds = threadEmails.map((e: any) => e.id);
                deselectMultipleEmails(threadIds);
              } else {
                // Select all in thread
                const threadIds = threadEmails.map((e: any) => e.id);
                selectMultipleEmails(threadIds);
              }
            }
            break;
          }
        }
        return;
      }

      if (e.key === 'k' || e.key === 'ArrowDown') {
        e.preventDefault();
        navigateEmail('next');
        return;
      }

      if (e.key === 'j' || e.key === 'ArrowUp') {
        e.preventDefault();
        navigateEmail('prev');
        return;
      }

      // e to expand/collapse thread, E to expand/collapse all threads
      if (e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        if (e.shiftKey) {
          // Shift+E: expand/collapse all threads
          if (expandedThreads.size === threadGroups.size) {
            // All are expanded, collapse all
            collapseAllThreads();
          } else {
            // Not all are expanded, expand all
            expandAllThreads();
          }
        } else if (focusedEmailId) {
          // e: toggle focused thread
          for (const [threadId, threadEmails] of threadGroups.entries()) {
            if (threadEmails.some((email: any) => email.id === focusedEmailId)) {
              toggleThreadExpanded(threadId);
              break;
            }
          }
        }
        return;
      }

      // Archive (a) - works on selected emails or focused email, but NOT for sent emails
      if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        // Skip archiving in sent view
        if (currentFilter === 'sent') {
          return;
        }
        if (isSelectMode && selectedEmailIds.size > 0) {
          // Archive all selected emails using bulk action
          handleBulkAction('archive');
        } else if (focusedEmailId) {
          if (e.shiftKey) {
            // Archive entire thread
            for (const [threadId, threadEmails] of threadGroups.entries()) {
              if (threadEmails.some((email: any) => email.id === focusedEmailId)) {
                threadEmails.forEach((email: any) => onEmailAction(email.id, 'archive'));
                break;
              }
            }
          } else {
            // Archive just focused email
            onEmailAction(focusedEmailId, 'archive');
          }
        }
        return;
      }

      // Save (s) - works on selected emails or focused email
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        if (isSelectMode && selectedEmailIds.size > 0) {
          // Save all selected emails using bulk action
          console.log('[ThreadedEmailList] Saving selected emails:', Array.from(selectedEmailIds));
          handleBulkAction('save');
        } else if (focusedEmailId) {
          if (e.shiftKey) {
            // Save entire thread
            for (const [threadId, threadEmails] of threadGroups.entries()) {
              if (threadEmails.some((email: any) => email.id === focusedEmailId)) {
                console.log('[ThreadedEmailList] Saving entire thread:', { threadId, emailCount: threadEmails.length, emailIds: threadEmails.map((e: any) => e.id) });
                threadEmails.forEach((email: any) => onEmailAction(email.id, 'save'));
                break;
              }
            }
          } else {
            // Save just focused email
            console.log('[ThreadedEmailList] Saving focused email:', focusedEmailId);
            onEmailAction(focusedEmailId, 'save');
          }
        }
        return;
      }

      // Delete (d) - works on selected emails or focused email
      if (e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        if (isSelectMode && selectedEmailIds.size > 0) {
          // Delete all selected emails using bulk action with undo toast
          handleBulkAction('delete');
        } else if (focusedEmailId) {
          if (e.shiftKey) {
            // Delete entire thread
            for (const [threadId, threadEmails] of threadGroups.entries()) {
              if (threadEmails.some((email: any) => email.id === focusedEmailId)) {
                threadEmails.forEach((email: any) => onEmailAction(email.id, 'delete'));
                break;
              }
            }
          } else {
            // Delete just focused email
            onEmailAction(focusedEmailId, 'delete');
            navigateEmail('next');
          }
        }
        return;
      }

      if (isSelectMode) return;

      // Enter to open focused view
      if (e.key === 'Enter' && focusedEmailId) {
        e.preventDefault();
        onEmailSelect(focusedEmailId);
        if (onOpenFocusedView) {
          onOpenFocusedView();
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSelectMode, selectedEmailIds, focusedEmailId, clearSelection, selectAllVisible, toggleEmailSelection, navigateEmail, onEmailAction, toggleThreadExpanded, threadGroups, onEmailSelect, onOpenFocusedView, isEmailSelected, selectMultipleEmails, deselectMultipleEmails, bulkArchive, bulkSave, bulkDelete]);

  // Helper to format date
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  };

  return (
    <div className="flex-1 overflow-y-auto" ref={listRef}>
      {/* Bulk action toolbar */}
      {isSelectMode && (
        <div className="px-4 py-3 bg-purple-50 dark:bg-purple-900/30 border-b border-purple-200 dark:border-purple-700 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-purple-700 dark:text-purple-300">
              {selectedEmailIds.size} email{selectedEmailIds.size !== 1 ? 's' : ''} selected
            </span>
            <div className="flex items-center gap-1">
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
          <span className="font-medium text-gray-600 dark:text-gray-300">Thread View Shortcuts</span>
          <span className="text-purple-600 dark:text-purple-400">{sortedThreads.length} conversations</span>
        </button>
        {!shortcutsCollapsed && (
          <div className="px-4 pb-3 space-y-1.5">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono">k</kbd> <kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono">j</kbd> navigate</span>
              <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono">Enter</kbd> focused view</span>
              <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono">Space</kbd> select</span>
              <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono text-xs">⌘</kbd><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono">I</kbd> AI chat</span>
              {currentFilter !== 'sent' && (
                <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono">r</kbd> respond</span>
              )}
              <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono">s</kbd> save email</span>
              <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono text-xs">⇧</kbd><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono">S</kbd> save thread</span>
              {currentFilter !== 'sent' && (
                <>
                  <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono">a</kbd> archive email</span>
                  <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono text-xs">⇧</kbd><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono">A</kbd> archive thread</span>
                </>
              )}
              <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono">d</kbd> delete email</span>
              <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono text-xs">⇧</kbd><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono">D</kbd> delete thread</span>
              <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono">e</kbd> expand thread</span>
              <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono text-xs">⇧</kbd><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono">E</kbd> expand all</span>
              <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono">Esc</kbd> clear selection</span>
            </div>
          </div>
        )}
      </div>

      {/* Thread list */}
      <div className="p-4 space-y-3">
        {sortedThreads.map(({ threadId, emails: threadEmails, mostRecent }) => {
          const isExpanded = expandedThreads.has(threadId);
          const threadCount = threadEmails.length;
          const hasUnread = threadEmails.some((e: any) => !e.is_read);
          const isSelected = selectedEmailId === mostRecent.id || threadEmails.some((e: any) => e.id === selectedEmailId);
          const allSelected = threadEmails.every((e: any) => isEmailSelected(e.id));
          const anySelected = threadEmails.some((e: any) => isEmailSelected(e.id));

          return (
            <div
              key={threadId}
              className={`bg-surface dark:bg-gray-800 border rounded-lg overflow-hidden transition-all relative ${
                allSelected ? 'border-purple-400 dark:border-purple-500 ring-2 ring-purple-200 dark:ring-purple-900' :
                isSelected ? 'border-blue-500 dark:border-blue-400' : 'border-gray-200 dark:border-gray-700'
              }`}
              onClick={(e) => {
                console.log('[Thread container onClick] threadId:', threadId, 'allSelected:', allSelected, 'target:', e.target);
              }}
            >
              {/* Full-height selection strip when all emails are selected */}
              {allSelected && (
                <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-purple-500 rounded-l-lg z-20" />
              )}
              {/* Thread header - always visible */}
              <div
                className={`relative p-3 cursor-pointer transition-colors ${
                  hasUnread && !allSelected ? 'bg-blue-50/30 dark:bg-blue-900/10' : ''
                } ${!allSelected ? 'hover:bg-gray-50 dark:hover:bg-gray-700/50' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  console.log('[Thread header click] threadId:', threadId, 'emailId:', mostRecent.id);
                  handleThreadHeaderClick(mostRecent.id, threadId, threadEmails);
                }}
              >
                <div className="flex items-start gap-3">
                  {/* Expand/collapse button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleThreadToggle(threadId, e);
                    }}
                    className="flex-shrink-0 mt-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4" />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                  </button>

                  {/* Thread icon */}
                  <div className="flex-shrink-0 mt-0.5">
                    {threadCount > 1 ? (
                      <div className="relative">
                        <MessageSquare className="w-4 h-4 text-gray-400" />
                        {threadCount > 2 && (
                          <div className="absolute -top-1 -right-1 w-3 h-3 bg-purple-500 rounded-full text-[8px] text-white flex items-center justify-center">
                            {threadCount}
                          </div>
                        )}
                      </div>
                    ) : (
                      <Mail className="w-4 h-4 text-gray-400" />
                    )}
                  </div>

                  {/* Thread content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      {/* (previously interpolated the sender into className — a bug) */}
                      <span className="text-xs font-medium truncate">
                        {threadEmails.length > 1 && (
                          <span className="text-gray-500 dark:text-gray-400 mr-1">
                            {threadEmails.length === 2
                              ? `${threadEmails[0].sender?.split('<')[0]?.trim() || 'Someone'} and you`
                              : `${threadEmails[0].sender?.split('<')[0]?.trim() || 'Someone'} (${threadCount})`}
                          </span>
                        )}
                        {mostRecent.sender?.split('<')[0]?.trim() || mostRecent.sender}
                      </span>
                      <ActionBadge emailId={mostRecent.id} />
                      {mostRecent.status === 'Saved' && !mostRecent.waiting_on_reply_since && !mostRecent.recipients && (
                        <Bookmark className="w-3 h-3 text-purple-500" />
                      )}
                      {mostRecent.is_starred && (
                        <Star className="w-3 h-3 text-yellow-500 fill-current" />
                      )}
                    </div>

                    <div className={`text-sm ${hasUnread ? 'font-semibold text-foreground' : 'text-gray-700 dark:text-gray-300'}`}>
                      {mostRecent.subject}
                    </div>

                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-muted flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDate(mostRecent.date)}
                      </span>
                      {hasUnread && (
                        <span className="w-2 h-2 bg-blue-500 rounded-full" />
                      )}
                      {threadEmails.some((e: any) => e.has_attachments) && (
                        <span className="text-xs text-gray-500">📎</span>
                      )}
                    </div>
                  </div>

                  {/* Selection strip - hide when all selected OR when expanded (individual emails show their own strips) */}
                  {!allSelected && !isExpanded && (
                    <div
                      className={`absolute left-0 top-0 bottom-0 w-1.5 rounded-l-lg transition-all cursor-pointer ${
                        anySelected ? 'bg-purple-500/50' : 'bg-transparent hover:bg-gray-400 dark:hover:bg-gray-600'
                      }`}
                      onClick={(e) => handleThreadStripClick(threadId, threadEmails, e)}
                    />
                  )}
                </div>
              </div>

              {/* Expanded thread emails */}
              {isExpanded && threadCount > 1 && (
                <div className="border-t border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700/50">
                  {threadEmails.map((email: any, index: number) => {
                    const isLast = index === threadEmails.length - 1;
                    const emailIsSelected = isEmailSelected(email.id);
                    const isFocused = focusedEmailId === email.id;

                    return (
                      <div
                        key={email.id}
                        id={`threaded-email-item-${email.id}`}
                        className={`relative p-3 ${allSelected ? '' : 'hover:bg-gray-50 dark:hover:bg-gray-700/30'} cursor-pointer transition-colors ${
                          !email.is_read ? 'bg-blue-50/20 dark:bg-blue-900/5' : ''
                        } ${email.id === selectedEmailId ? 'bg-blue-50 dark:bg-blue-900/20' : ''} ${
                          isFocused ? 'bg-gray-100 dark:bg-gray-800/50' : ''
                        }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleIndividualEmailClick(email.id);
                        }}
                      >
                        {/* Selection strip for individual email - absolute positioned like collapsed view */}
                        {!allSelected && (
                          <div
                            className={`absolute left-0 top-0 bottom-0 w-1.5 rounded-l-lg transition-all cursor-pointer z-10 ${
                              emailIsSelected ? 'bg-purple-500' : 'bg-transparent hover:bg-gray-400 dark:hover:bg-gray-600'
                            }`}
                            onClick={(e) => handleIndividualStripClick(email.id, e)}
                          />
                        )}
                        <div className="flex items-start gap-3">
                          {/* Connector line */}
                          <div className="flex-shrink-0 flex flex-col items-center">
                            {index < threadEmails.length - 1 && (
                              <div className="w-0.5 h-full bg-gray-200 dark:bg-gray-700" />
                            )}
                            <div className={`w-2 h-2 rounded-full mt-1 ${
                              isFocused
                                ? 'bg-purple-500 ring-2 ring-purple-200 dark:ring-purple-700'
                                : isLast
                                  ? 'bg-blue-500'
                                  : 'bg-gray-300 dark:bg-gray-600'
                            }`} />
                          </div>

                          {/* Email content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs text-gray-600 dark:text-gray-400">
                                {email.from?.name || email.sender?.split('<')[0]?.trim() || 'Someone'}
                              </span>
                              <span className="text-xs text-muted">
                                {formatDate(email.date)}
                              </span>
                            </div>

                            {/* Snippet */}
                            <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2">
                              {email.summary || email.snippet || email.preview}
                            </p>

                            {/* Action items for this email */}
                            {email.action_items && email.action_items.length > 0 && (
                              <div className="mt-1 flex items-center gap-1">
                                <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 rounded">
                                  {email.action_items.length} action{email.action_items.length > 1 ? 's' : ''}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {sortedThreads.length === 0 && (
        <div className="flex flex-col items-center justify-center p-8 text-center">
          <MessageSquare className="h-12 w-12 text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            No conversations
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Emails will appear grouped as conversations here.
          </p>
        </div>
      )}
    </div>
  );
};
