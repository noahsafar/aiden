import React, { useMemo, useCallback, useRef, useEffect } from 'react';
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
}) => {
  const listRef = useRef<HTMLDivElement>(null);

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
  } = useEmailStore();

  // Group emails by thread
  const threadGroups = useMemo(() => {
    const groups = groupEmailsByThread(emails);
    console.log('[threadGroups] groups:', Array.from(groups.entries()).map(([tid, emails]) => [tid, emails.map((e: any) => e.id)]));
    return groups;
  }, [emails, groupEmailsByThread]);

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
        const aCategory = a.mostRecent.aiCategory || a.mostRecent.category || 'Normal';
        const bCategory = b.mostRecent.aiCategory || b.mostRecent.category || 'Normal';
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

    if (allSelected) {
      // Thread is selected - deselect all emails in thread
      deselectMultipleEmails(threadEmails.map((e: any) => e.id));
      onEmailSelect(emailId);
      onFocusEmail(emailId);
    } else if (isThreadFocused || hasExistingSelection) {
      // Thread is focused OR there's already a selection - select all emails in thread
      selectMultipleEmails(threadEmails.map((e: any) => e.id));
      onEmailSelect(emailId);
      onFocusEmail(emailId);
    } else {
      // Not focused and no existing selection - just focus it (don't select)
      onEmailSelect(emailId);
      onFocusEmail(emailId);
    }
  }, [onEmailSelect, onFocusEmail, focusedEmailId, selectMultipleEmails, deselectMultipleEmails]);

  // Handle individual email click in expanded view - selects just that email
  const handleIndividualEmailClick = useCallback((emailId: string) => {
    if (isSelectMode) {
      toggleEmailSelection(emailId);
    } else if (focusedEmailId === emailId) {
      // If clicking on already focused email, toggle selection
      toggleEmailSelection(emailId);
    } else {
      onEmailSelect(emailId);
      onFocusEmail(emailId);
    }
  }, [isSelectMode, toggleEmailSelection, onEmailSelect, onFocusEmail, focusedEmailId]);

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
        await bulkDelete();
        break;
      case 'save':
        bulkSave();
        break;
    }
  }, [bulkArchive, bulkDelete, bulkSave]);

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
        // Find which thread the focused email belongs to and toggle entire thread
        for (const [threadId, threadEmails] of threadGroups.entries()) {
          if (threadEmails.some((e: any) => e.id === focusedEmailId)) {
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

      // e to expand/collapse thread
      if (e.key === 'e' && focusedEmailId) {
        e.preventDefault();
        // Find which thread the focused email belongs to
        for (const [threadId, threadEmails] of threadGroups.entries()) {
          if (threadEmails.some((e: any) => e.id === focusedEmailId)) {
            toggleThreadExpanded(threadId);
            break;
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

      if (e.key === 'a') {
        e.preventDefault();
        if (focusedEmailId) onEmailAction(focusedEmailId, 'archive');
      } else if (e.key === 's') {
        e.preventDefault();
        if (focusedEmailId) onEmailAction(focusedEmailId, 'save');
      } else if (e.key === 'd') {
        e.preventDefault();
        if (focusedEmailId) {
          onEmailAction(focusedEmailId, 'delete');
          navigateEmail('next');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSelectMode, focusedEmailId, clearSelection, selectAllVisible, toggleEmailSelection, navigateEmail, onEmailAction, toggleThreadExpanded, threadGroups, onEmailSelect, onOpenFocusedView, isEmailSelected, selectMultipleEmails, deselectMultipleEmails]);

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
        <div className="flex items-center justify-between">
          <span className="font-medium text-gray-600 dark:text-gray-300">Thread View</span>
          <span className="text-purple-600 dark:text-purple-400">{sortedThreads.length} conversations</span>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono">k</kbd> <kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono">j</kbd> navigate</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono">e</kbd> expand</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono">Space</kbd> select thread</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono">Enter</kbd> focused view</span>
          <span><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono text-xs">⌘</kbd><kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono">A</kbd> all visible</span>
        </div>
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
              className={`bg-surface dark:bg-gray-800 border rounded-lg overflow-hidden transition-all ${
                allSelected ? 'border-purple-400 dark:border-purple-500 ring-2 ring-purple-200 dark:ring-purple-900' :
                isSelected ? 'border-blue-500 dark:border-blue-400' : 'border-gray-200 dark:border-gray-700'
              }`}
              onClick={(e) => {
                console.log('[Thread container onClick] threadId:', threadId, 'allSelected:', allSelected, 'target:', e.target);
              }}
            >
              {/* Thread header - always visible */}
              <div
                className={`relative p-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${
                  hasUnread ? 'bg-blue-50/30 dark:bg-blue-900/10' : ''
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleThreadHeaderClick(mostRecent.id, threadId, threadEmails);
                }}
              >
                <div className="flex items-start gap-3">
                  {/* Expand/collapse button */}
                  <button
                    onClick={(e) => handleThreadToggle(threadId, e)}
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
                      <span className={`text-xs font-medium truncate ${
                        mostRecent.from?.name || mostRecent.sender
                      }`}>
                        {threadEmails.length > 1 && (
                          <span className="text-gray-500 dark:text-gray-400 mr-1">
                            {threadEmails.length === 2
                              ? `${threadEmails[0].from?.name || threadEmails[0].sender?.split('<')[0]?.trim() || 'Someone'} and you`
                              : `${threadEmails[0].from?.name || threadEmails[0].sender?.split('<')[0]?.trim() || 'Someone'} (${threadCount})`}
                          </span>
                        )}
                        {(mostRecent.from?.name || mostRecent.sender)}
                      </span>
                      <ActionBadge emailId={mostRecent.id} />
                      {mostRecent.status === 'Saved' && (
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

                  {/* Selection strip */}
                  <div
                    className={`absolute left-0 top-0 bottom-0 w-1.5 rounded-l-lg transition-all cursor-pointer ${
                      isEmailSelected(mostRecent.id) ? 'bg-purple-500' : 'bg-transparent hover:bg-gray-400 dark:hover:bg-gray-600'
                    }`}
                    onClick={(e) => handleThreadStripClick(threadId, threadEmails, e)}
                  />
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
                        className={`p-3 hover:bg-gray-50 dark:hover:bg-gray-700/30 cursor-pointer transition-colors border-l-2 ${
                          !email.is_read ? 'bg-blue-50/20 dark:bg-blue-900/5' : ''
                        } ${email.id === selectedEmailId ? 'bg-blue-50 dark:bg-blue-900/20' : ''} ${
                          isFocused ? 'bg-gray-100 dark:bg-gray-800/50' : ''
                        } ${
                          emailIsSelected ? 'border-purple-500 bg-purple-50/50 dark:bg-purple-900/20' : 'border-transparent'
                        }`}
                        onClick={() => handleIndividualEmailClick(email.id)}
                      >
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

                          {/* Selection strip for individual email in thread */}
                          <div
                            className={`w-1 rounded transition-all cursor-pointer ${
                              emailIsSelected ? 'bg-purple-500' : 'bg-transparent hover:bg-gray-400 dark:hover:bg-gray-600'
                            }`}
                            onClick={(e) => handleIndividualStripClick(email.id, e)}
                          />
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
