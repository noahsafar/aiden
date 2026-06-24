import React from 'react';
import { shallow } from 'zustand/shallow';
import { useChatStore } from '@/stores/chatStore';

/**
 * Thin bridge between the chat UI components and the Zustand `chatStore`.
 *
 * The chat components were written against a `useChatContext()` hook + a
 * `<ChatProvider>`; all of the actual state lives in `chatStore`. This provider
 * is a passthrough (no extra React context needed) and the hook simply selects
 * everything the components use from the store.
 */

export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => <>{children}</>;

export function useChatContext() {
  return useChatStore(
    (s) => ({
      messages: s.messages,
      isOpen: s.isOpen,
      isProcessing: s.isProcessing,
      searchResults: s.searchResults,
      composeData: s.composeData,
      openChat: s.openChat,
      closeChat: s.closeChat,
      sendMessage: s.sendMessage,
      executeAction: s.executeAction,
      clearComposeData: s.clearComposeData,
      clearSearchResults: s.clearSearchResults,
    }),
    shallow,
  );
}
