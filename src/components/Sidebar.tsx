import { NavLink, useLocation } from 'react-router-dom';
import { cn } from '@/utils/cn';
import { useAuthStore } from '@/stores/authStore';
import {
  EnvelopeIcon,
  BookmarkIcon,
  ArchiveBoxIcon,
  ClockIcon,
  Cog6ToothIcon,
  ArrowRightOnRectangleIcon,
  SparklesIcon,
  ArrowLeftOnRectangleIcon,
  SparklesIcon as Bot,
} from '@heroicons/react/24/outline';

const navigation = [
  { name: 'Unhandled', href: '/unhandled', icon: EnvelopeIcon, count: 0 },
  { name: 'Saved', href: '/saved', icon: BookmarkIcon, count: 0 },
  { name: 'Low Priority', href: '/low-priority', icon: ArchiveBoxIcon, count: 0 },
  { name: 'History', href: '/history', icon: ClockIcon, count: 0 },
  { name: 'Settings', href: '/settings', icon: Cog6ToothIcon, count: 0 },
];

export function Sidebar() {
  const location = useLocation();
  const { signOut, user } = useAuthStore();

  return (
    <div className="flex h-full w-64 flex-col bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700">
      {/* Logo */}
      <div className="flex h-16 items-center px-6 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center space-x-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-600">
            <Bot className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Aiden</h1>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-4">
        {navigation.map((item) => {
          const isActive = location.pathname === item.href;
          return (
            <NavLink
              key={item.name}
              to={item.href}
              className={({ isActive }) =>
                cn(
                  'flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/20 dark:text-primary-300'
                    : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
                )
              }
            >
              <div className="flex items-center space-x-3">
                <item.icon className="h-5 w-5" />
                <span>{item.name}</span>
              </div>
              {item.count > 0 && (
                <span className="flex h-6 min-w-[24px] items-center justify-center rounded-full bg-gray-100 px-2 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-400">
                  {item.count}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* User Section */}
      <div className="border-t border-gray-200 dark:border-gray-700 p-3">
        <div className="flex items-center justify-between rounded-lg px-3 py-2">
          <div className="flex items-center space-x-3">
            <div className="h-8 w-8 rounded-full bg-gray-300 dark:bg-gray-600" />
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">
                {user?.email || 'user@example.com'}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Active</p>
            </div>
          </div>
        </div>
        <button
          onClick={signOut}
          className="mt-2 flex w-full items-center space-x-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          <ArrowLeftOnRectangleIcon className="h-5 w-5" />
          <span>Sign out</span>
        </button>
      </div>
    </div>
  );
}