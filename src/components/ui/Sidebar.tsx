import React from 'react';
import { Link } from 'react-router-dom';

interface SidebarProps {
  className?: string;
  children?: React.ReactNode;
  isDarkMode?: boolean;
  onThemeToggle?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  className = '',
  children,
  isDarkMode = false,
  onThemeToggle = () => {}
}) => {
  return (
    <div className={`w-64 bg-gray-50 dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 ${className}`}>
      <div className="p-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Aiden Mail</h2>
        <nav className="space-y-2">
          <a href="#" className="block px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700">Inbox</a>
          <a href="#" className="block px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700">Sent</a>
          <a href="#" className="block px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700">Drafts</a>
          <a href="#" className="block px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700">Starred</a>
          <a href="#" className="block px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700">Archive</a>
          <a href="#" className="block px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700">Trash</a>

          <div className="pt-4 mt-4 border-t border-gray-200 dark:border-gray-700">
            <Link
              to="/test"
              className="block px-3 py-2 text-sm font-medium text-purple-600 dark:text-purple-400 rounded-md hover:bg-purple-50 dark:hover:bg-purple-900/20"
            >
              Gmail API Test
            </Link>
          </div>
        </nav>
      </div>
      {children}
    </div>
  );
};