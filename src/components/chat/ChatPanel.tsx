import React, { useEffect, useRef, useState } from 'react';
import { XMarkIcon, ChevronUpIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import { useChatStore } from '@/stores/chatStore';
import { ChatMessage as ChatMessageComponent } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { ChatEmailCard } from './ChatEmailCard';

export function ChatPanel() {
  const { messages, isOpen, openChat, closeChat, isProcessing, searchResults } = useChatStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isMinimized, setIsMinimized] = useState(false);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (!isMinimized) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isMinimized]);

  // Toggle panel open/close
  const toggleOpen = () => {
    if (isOpen) {
      closeChat();
    } else {
      openChat();
    }
  };

  // If not open at all, show just the bubble button
  if (!isOpen) {
    return (
      <button
        onClick={openChat}
        className="fixed bottom-6 right-6 z-50 group"
      >
        <div className="relative">
          {/* Pulse animation ring */}
          <div className="absolute inset-0 bg-gradient-to-r from-purple-500 to-blue-500 rounded-full animate-ping opacity-20 group-hover:opacity-40 transition-opacity"></div>
          <div className="absolute inset-0 bg-gradient-to-r from-purple-500 to-blue-500 rounded-full animate-pulse opacity-40 group-hover:opacity-60 transition-opacity"></div>

          {/* Main bubble */}
          <div className="relative w-14 h-14 bg-gradient-to-br from-purple-500 to-blue-500 rounded-full shadow-lg hover:shadow-xl transition-all duration-200 flex items-center justify-center transform hover:scale-105">
            <span className="text-white text-lg font-bold">AI</span>
          </div>

          {/* Tooltip */}
          <div className="absolute bottom-full right-0 mb-2 px-3 py-1.5 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
            Ask AI Assistant (Cmd+J)
            <div className="absolute top-full right-4 -mt-1 w-2 h-2 bg-gray-900 dark:bg-gray-700 rotate-45"></div>
          </div>
        </div>
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
      {/* Chat widget */}
      <div
        className={`bg-white dark:bg-gray-800 shadow-2xl border border-gray-200 dark:border-gray-700 rounded-2xl overflow-hidden transition-all duration-300 ${
          isMinimized ? 'w-80 h-14' : 'w-96 h-[500px] max-h-[70vh]'
        }`}
      >
        {/* Header - always visible */}
        <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-purple-500 to-blue-500 cursor-pointer"
              onClick={() => setIsMinimized(!isMinimized)}>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
              <span className="text-white text-sm font-semibold">AI</span>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Aiden Assistant</h2>
              {!isMinimized && <p className="text-xs text-white/80">Ask me anything about your emails</p>}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsMinimized(!isMinimized);
              }}
              className="p-1 rounded-lg hover:bg-white/10 transition-colors text-white"
            >
              {isMinimized ? (
                <ChevronUpIcon className="h-4 w-4" />
              ) : (
                <ChevronDownIcon className="h-4 w-4" />
              )}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeChat();
              }}
              className="p-1 rounded-lg hover:bg-white/10 transition-colors text-white"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Content - hidden when minimized */}
        {!isMinimized && (
          <>
            {/* Messages */}
            <div className="h-[380px] overflow-y-auto px-4 py-4 space-y-4">
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
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {searchResults.map(email => (
                      <ChatEmailCard key={email.id} email={email} />
                    ))}
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <ChatInput />
          </>
        )}
      </div>
    </div>
  );
}
