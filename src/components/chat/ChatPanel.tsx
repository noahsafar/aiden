import React, { useEffect, useRef } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useChatContext } from '@/contexts/ChatContext';
import { ChatMessage as ChatMessageComponent } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { ChatEmailCard } from './ChatEmailCard';

export function ChatPanel() {
  const { messages, isOpen, closeChat, isProcessing, searchResults } = useChatContext();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (!isOpen) return null;

  return (
    <>
      {/* Overlay for mobile */}
      <div
        className="fixed inset-0 bg-black/20 z-40 lg:hidden"
        onClick={closeChat}
      />

      {/* Chat Panel - slides in from right */}
      <div className="fixed inset-y-0 right-0 w-[400px] bg-white dark:bg-gray-800 shadow-2xl z-50 flex flex-col border-l border-gray-200 dark:border-gray-700 transform transition-transform duration-300 ease-in-out translate-x-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 h-14 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
              <span className="text-white text-sm font-semibold">AI</span>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Aiden Assistant</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">Ask me anything about your emails</p>
            </div>
          </div>
          <button
            onClick={closeChat}
            className="p-1 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-gray-500 dark:text-gray-400"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-8">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center mx-auto mb-3">
                <span className="text-white text-lg font-semibold">AI</span>
              </div>
              <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-1">
                Welcome to Aiden Assistant
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 max-w-[250px] mx-auto">
                I can help you search, compose, archive, and manage emails. Just ask!
              </p>
              <div className="mt-4 space-y-2 text-left max-w-[280px] mx-auto">
                <p className="text-xs text-gray-600 dark:text-gray-400 font-medium">Try saying:</p>
                <ul className="text-xs text-gray-500 dark:text-gray-500 space-y-1">
                  <li className="cursor-pointer hover:text-purple-600 dark:hover:text-purple-400 transition-colors">
                    "Find emails from John"
                  </li>
                  <li className="cursor-pointer hover:text-purple-600 dark:hover:text-purple-400 transition-colors">
                    "Send an email to Sarah about lunch"
                  </li>
                  <li className="cursor-pointer hover:text-purple-600 dark:hover:text-purple-400 transition-colors">
                    "Archive all unread emails"
                  </li>
                  <li className="cursor-pointer hover:text-purple-600 dark:hover:text-purple-400 transition-colors">
                    "Remind me about this in 2 days"
                  </li>
                </ul>
              </div>
            </div>
          )}

          {messages.map((message, index) => (
            <ChatMessageComponent key={index} message={message} />
          ))}

          {isProcessing && (
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center flex-shrink-0">
                <span className="text-white text-xs font-semibold">AI</span>
              </div>
              <div className="flex-1">
                <div className="bg-gray-100 dark:bg-gray-700 rounded-lg px-3 py-2">
                  <div className="flex space-x-2">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {searchResults && searchResults.length > 0 && (
            <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Search results:</p>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {searchResults.map((email: any) => (
                  <ChatEmailCard key={email.id} email={email} />
                ))}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <ChatInput />
      </div>
    </>
  );
}
