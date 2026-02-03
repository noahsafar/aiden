import React from 'react';
import { useEmailStore } from '@/stores/emailStore';
import {
  InboxIcon,
  PaperAirplaneIcon,
  BookmarkIcon,
  ArchiveBoxIcon,
  BoltIcon,
  Squares2X2Icon,
  Bars3BottomLeftIcon,
  SparklesIcon as SparklesIconHero,
} from '@heroicons/react/24/outline';

interface SidebarProps {
  className?: string;
  children?: React.ReactNode;
  inboxCount?: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  className = '',
  children,
  inboxCount
}) => {
  const { currentFilter, setCurrentFilter, emails, sentEmails, viewMode, setViewMode } = useEmailStore();

  const filters = [
    { id: 'inbox', label: 'Inbox', icon: InboxIcon },
    { id: 'focus', label: 'Focus Mode', icon: BoltIcon },
    { id: 'triage', label: 'Smart Triage', icon: SparklesIconHero },
    { id: 'saved', label: 'Saved', icon: BookmarkIcon },
    { id: 'sent', label: 'Sent', icon: PaperAirplaneIcon },
    { id: 'archived', label: 'Archive', icon: ArchiveBoxIcon },
  ] as const;

  const getFilterCount = (filterId: string) => {
    switch (filterId) {
      case 'inbox':
        return inboxCount !== undefined ? inboxCount : emails.filter(e => e.status !== 'Archived' && e.status !== 'Saved').length;
      case 'focus':
        // Count emails that require action (Action Required based on AI analysis)
        return emails.filter(e => {
          if (typeof window !== 'undefined' && (window as any).emailQuestionData) {
            const data = (window as any).emailQuestionData.get(e.id);
            return data?.loaded && data.requiresReply && e.status !== 'Archived' && e.status !== 'Saved';
          }
          return e.category === 'Urgent' && e.status !== 'Archived' && e.status !== 'Saved';
        }).length;
      case 'saved':
        return emails.filter(e => e.status === 'Saved').length;
      case 'sent':
        return sentEmails.length;
      case 'archived':
        return emails.filter(e => e.status === 'Archived').length;
      default:
        return 0;
    }
  };

  return (
    <div className={`w-16 sm:w-56 md:w-64 h-full bg-gray-50 dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex-shrink-0 flex flex-col ${className}`}>
      <div className="p-2 sm:p-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 hidden sm:block">Mail</h2>
        <nav className="space-y-1">
          {filters.map((filter) => {
            const Icon = filter.icon;
            const isActive = currentFilter === filter.id;
            const count = getFilterCount(filter.id);

            return (
              <button
                key={filter.id}
                onClick={() => setCurrentFilter(filter.id as any)}
                className={`w-full flex items-center justify-between px-2 sm:px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                  isActive
                    ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
                title={filter.label}
              >
                <div className="flex items-center gap-2 sm:gap-3">
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  <span className="hidden sm:inline">{filter.label}</span>
                </div>
                {count > 0 && (
                  <span className={`text-xs px-1.5 sm:px-2 py-0.5 rounded-full ${
                    isActive
                      ? 'bg-purple-200 text-purple-800 dark:bg-purple-800 dark:text-purple-200'
                      : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* View Mode Toggle */}
        <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700 hidden sm:block">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2 px-2">View Mode</p>
          <div className="flex gap-1 px-2">
            <button
              onClick={() => setViewMode('individual')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md transition-colors ${
                viewMode === 'individual'
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
              title="Individual emails"
            >
              <Bars3BottomLeftIcon className="h-4 w-4" />
              <span>List</span>
            </button>
            <button
              onClick={() => setViewMode('threaded')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md transition-colors ${
                viewMode === 'threaded'
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
              title="Threaded conversations"
            >
              <Squares2X2Icon className="h-4 w-4" />
              <span>Threads</span>
            </button>
          </div>
        </div>
      </div>
      {children}
    </div>
  );
};