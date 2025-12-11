import { useState } from 'react';
import {
  EnvelopeIcon,
  PaperAirplaneIcon,
  ArchiveBoxIcon,
  StarIcon,
  Cog6ToothIcon,
  Bars3Icon,
  XMarkIcon,
  InboxIcon,
  ExclamationCircleIcon
} from '@heroicons/react/24/outline';
import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/stores/authStore';
import { useEmailStore } from '@/stores/emailStore';

interface SidebarProps {
  onCompose: () => void;
}

export function Sidebar({ onCompose }: SidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { user, signOut } = useAuthStore();
  const { currentFilter, setCurrentFilter, emails } = useEmailStore();

  // Debug: Print user info to console
  console.log('=== DEBUG: Auth User State ===');
  console.log('User:', user);
  console.log('Is Authenticated:', !!user);
  console.log('User Email:', user?.email);
  console.log('User Name:', user?.name);
  console.log('============================');

  const getUnreadCount = (filter: string) => {
    if (!emails) return 0;
    return emails.filter(email => {
      if (email.is_read) return false;
      if (filter === 'unhandled') return email.status === 'Unhandled';
      if (filter === 'urgent') return email.category === 'Urgent';
      if (filter === 'important') return email.category === 'Important';
      if (filter === 'normal') return email.category === 'Normal';
      if (filter === 'low') return email.category === 'Low';
      return false;
    }).length;
  };

  const navigationItems = [
    { id: 'all', label: 'All Mail', icon: EnvelopeIcon },
    { id: 'unhandled', label: 'Unhandled', icon: InboxIcon },
    { id: 'urgent', label: 'Urgent', icon: ExclamationCircleIcon },
    { id: 'important', label: 'Important', icon: StarIcon },
    { id: 'normal', label: 'Normal', icon: EnvelopeIcon },
    { id: 'low', label: 'Low Priority', icon: ArchiveBoxIcon },
  ];

  return (
    <div className={`flex flex-col bg-white border-r border-gray-200 transition-all duration-300 ${
      isCollapsed ? 'w-16' : 'w-64'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        {!isCollapsed && (
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Aiden</h1>
            {user && (
              <p className="text-sm text-gray-500">{user.email}</p>
            )}
          </div>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsCollapsed(!isCollapsed)}
        >
          {isCollapsed ? <Bars3Icon className="h-4 w-4" /> : <XMarkIcon className="h-4 w-4" />}
        </Button>
      </div>

      {/* Compose Button */}
      <div className="p-4">
        <Button
          onClick={onCompose}
          className="w-full"
          disabled={!user}
        >
          {isCollapsed ? (
            <PaperAirplaneIcon className="h-4 w-4" />
          ) : (
            <>
              <PaperAirplaneIcon className="h-4 w-4 mr-2" />
              Compose
            </>
          )}
        </Button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2">
        {navigationItems.map((item) => {
          const Icon = item.icon;
          const unreadCount = getUnreadCount(item.id);

          return (
            <button
              key={item.id}
              onClick={() => setCurrentFilter(item.id as any)}
              className={`w-full flex items-center px-3 py-2 mb-1 rounded-md text-sm transition-colors ${
                currentFilter === item.id
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <Icon className="h-4 w-4" />
              {!isCollapsed && (
                <>
                  <span className="ml-3 flex-1 text-left">{item.label}</span>
                  {unreadCount > 0 && (
                    <span className="bg-blue-100 text-blue-700 text-xs px-2 py-1 rounded-full">
                      {unreadCount}
                    </span>
                  )}
                </>
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-gray-200">
        <Button
          variant="ghost"
          className="w-full justify-start"
          onClick={() => signOut()}
        >
          <Cog6ToothIcon className="h-4 w-4" />
          {!isCollapsed && <span className="ml-3">Sign Out</span>}
        </Button>
      </div>
    </div>
  );
}