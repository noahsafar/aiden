import React, { useState, KeyboardEvent } from 'react';
import { PaperAirplaneIcon } from '@heroicons/react/24/outline';
import { useChatStore } from '@/stores/chatStore';

export function ChatInput() {
  const [input, setInput] = useState('');
  const { sendMessage, isProcessing } = useChatStore();

  const handleSend = () => {
    if (input.trim() && !isProcessing) {
      sendMessage(input.trim(), 'typed');
      setInput('');
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
      <div className="flex items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask me anything about your emails..."
          rows={1}
          disabled={isProcessing}
          className="flex-1 px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm resize-none max-h-32 text-gray-900 dark:text-white placeholder-gray-400 disabled:opacity-50"
          style={{ minHeight: '40px', maxHeight: '128px' }}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || isProcessing}
          className="p-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white rounded-lg transition-colors flex-shrink-0 disabled:cursor-not-allowed"
        >
          <PaperAirplaneIcon className="h-5 w-5" />
        </button>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
        Press Enter to send, Shift+Enter for new line
      </p>
    </div>
  );
}
