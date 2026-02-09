import React from 'react';
import { useChatStore } from '@/stores/chatStore';

interface ChatEmailCardProps {
  email: {
    id: string;
    subject: string;
    sender: string;
    date: string;
    snippet: string;
  };
}

export function ChatEmailCard({ email }: ChatEmailCardProps) {
  const { executeAction } = useChatStore();

  const handleClick = () => {
    executeAction({
      type: 'navigate',
      data: { email_id: email.id },
    });
  };

  return (
    <button
      onClick={handleClick}
      className="w-full text-left p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-750 hover:border-purple-300 dark:hover:border-purple-600 transition-all"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
            {email.subject || 'No subject'}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
            From: {email.sender}
          </p>
        </div>
        <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
          {new Date(email.date).toLocaleDateString()}
        </span>
      </div>
      <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">
        {email.snippet}
      </p>
    </button>
  );
}
