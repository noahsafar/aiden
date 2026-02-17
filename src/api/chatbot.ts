// Chatbot API - Direct Tauri commands for AI chat assistant
import { invoke } from '@tauri-apps/api/core';

// ==================== TYPES ====================

export interface ChatEmailContext {
  id: string;
  subject: string;
  sender: string;
  date: string;
  snippet: string;
  status: string;
}

export interface ChatContactContext {
  email: string;
  name?: string;
  category?: string;
}

export interface ChatContext {
  current_date: string;
  user_name?: string;
  emails: ChatEmailContext[];
  contacts: ChatContactContext[];
  total_email_count: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatAction {
  type: 'search' | 'compose' | 'archive' | 'delete' | 'save' | 'mark_read' | 'mark_unread' | 'navigate' | 'summarize' | 'remind' | 'none';
  data: any;
}

export interface ChatResponse {
  reply_message: string;
  action?: ChatAction;
}

export interface ChatRequest {
  message: string;
  context: ChatContext;
  conversation_history: ChatMessage[];
}

export interface Reminder {
  id: string;
  message: string;
  due_date: string;  // ISO 8601 datetime
  created_at: string;
  is_triggered: boolean;
}

// ==================== FUNCTIONS ====================

/**
 * Process a chat message through the AI chatbot
 */
export async function processChatMessage(request: ChatRequest): Promise<ChatResponse> {
  try {
    const response = await invoke<ChatResponse>('process_chat_message', { request });
    return response;
  } catch (error) {
    console.error('Failed to process chat message:', error);
    throw error;
  }
}

/**
 * Save a reminder
 */
export async function saveReminder(reminder: Reminder): Promise<void> {
  try {
    await invoke('save_reminder', { reminder });
  } catch (error) {
    console.error('Failed to save reminder:', error);
    throw error;
  }
}

/**
 * Get all reminders
 */
export async function getReminders(): Promise<Reminder[]> {
  try {
    return await invoke<Reminder[]>('get_reminders');
  } catch (error) {
    console.error('Failed to get reminders:', error);
    return [];
  }
}

/**
 * Delete a reminder
 */
export async function deleteReminder(id: string): Promise<void> {
  try {
    await invoke('delete_reminder', { id });
  } catch (error) {
    console.error('Failed to delete reminder:', error);
    throw error;
  }
}

/**
 * Get due reminders (for notification check)
 */
export async function getDueReminders(): Promise<Reminder[]> {
  try {
    return await invoke<Reminder[]>('get_due_reminders');
  } catch (error) {
    console.error('Failed to get due reminders:', error);
    return [];
  }
}

/**
 * Mark a reminder as triggered
 */
export async function markReminderTriggered(id: string): Promise<void> {
  try {
    await invoke('mark_reminder_triggered', { id });
  } catch (error) {
    console.error('Failed to mark reminder as triggered:', error);
    throw error;
  }
}
