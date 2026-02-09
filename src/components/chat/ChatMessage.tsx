import React from 'react';
import { ChatMessage as ChatMessageType } from '@/api/chatbot';
import { UserIcon, SparklesIcon } from '@heroicons/react/24/outline';

interface ChatMessageProps {
  message: ChatMessageType;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex items-start gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
        isUser
          ? 'bg-gray-200 dark:bg-gray-700'
          : 'bg-gradient-to-br from-purple-500 to-blue-500'
      }`}>
        {isUser ? (
          <UserIcon className="h-3.5 w-3.5 text-gray-600 dark:text-gray-400" />
        ) : (
          <span className="text-white text-xs font-semibold">AI</span>
        )}
      </div>

      {/* Message bubble */}
      <div className={`flex-1 ${isUser ? 'flex justify-end' : ''}`}>
        <div className={`max-w-[85%] rounded-lg px-3 py-2 ${
          isUser
            ? 'bg-purple-600 text-white'
            : 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'
        }`}>
          <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>
        </div>
      </div>
    </div>
  );
}
