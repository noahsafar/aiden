import React from 'react';
import { useEmailStore } from '@/stores/emailStore';
import { Clock } from 'lucide-react';
import {
  InboxIcon,
  PaperAirplaneIcon,
  BookmarkIcon,
  ArchiveBoxIcon,
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
  const { currentFilter, setCurrentFilter, emails, sentEmails } = useEmailStore();

  const filters = [
    { id: 'inbox', label: 'Inbox', icon: InboxIcon },
    { id: 'triage', label: 'Smart Triage', icon: SparklesIconHero },
    { id: 'saved', label: 'Saved', icon: BookmarkIcon },
    { id: 'sent', label: 'Sent', icon: PaperAirplaneIcon },
    { id: 'archived', label: 'Archive', icon: ArchiveBoxIcon },
  ] as const;

  const isDashboardActive = currentFilter === 'inbox' || currentFilter === 'triage' || currentFilter === 'saved' || currentFilter === 'sent' || currentFilter === 'archived';

  const getFilterCount = (filterId: string) => {
    switch (filterId) {
      case 'inbox':
        return inboxCount !== undefined ? inboxCount : emails.filter(e => e.status !== 'Archived' && e.status !== 'Saved').length;
      case 'saved':
        return emails.filter(e => e.status === 'Saved').length;
      case 'sent':
        return sentEmails.filter(e => e.status !== 'Deleted').length;
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
            const isCustomIcon = (filter as any).customIcon;

            return (
              <button
                key={filter.id}
                onClick={() => setCurrentFilter(filter.id as any)}
                className={`w-full flex items-center justify-between px-2 sm:px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                  (isActive && isDashboardActive)
                    ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
                title={filter.label}
              >
                <div className="flex items-center gap-2 sm:gap-3">
                  {isCustomIcon ? (
                    <Icon className="h-4 w-4 flex-shrink-0" />
                  ) : (
                    <Icon className="h-4 w-4 flex-shrink-0" />
                  )}
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
      </div>
      {children}
    </div>
  );
};