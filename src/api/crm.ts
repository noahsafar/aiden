// CRM API functions for contacts, threads, reminders, templates, and more
import { invoke } from '@/lib/tauri-api';

// ============================================
// TYPES
// ============================================

export interface Contact {
  id: string;
  email_address: string;
  display_name: string | null;
  first_seen_at: number;
  last_emailed_at: number | null;
  last_received_from_at: number | null;
  total_emails_sent: number;
  total_emails_received: number;
  total_threads: number;
  avg_response_time_minutes: number | null;
  response_rate: number | null;
  is_vip: boolean;
  notes: string | null;
  tags: string[];
  created_at: number;
  updated_at: number;
}

export interface Thread {
  id: string;
  gmail_thread_id: string;
  subject: string;
  participants: string[];
  last_email_date: number;
  last_email_id: string;
  status: string; // 'active', 'awaiting_reply', 'stale', 'archived', 'done'
  health_score: number; // 0-100
  total_emails: number;
  unread_count: number;
  my_last_action: string | null;
  my_last_action_at: number | null;
  their_last_action_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface FollowUpReminder {
  id: string;
  thread_id: string;
  email_id: string;
  contact_email: string;
  reminder_type: string; // 'no_reply', 'check_in', 'deadline'
  scheduled_for: number;
  is_completed: boolean;
  completed_at: number | null;
  sent_notification: boolean;
  message_suggestion: string | null;
  created_at: number;
}

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string | null;
  body: string;
  category: string | null; // 'follow_up', 'check_in', 'thank_you', 'meeting', 'custom'
  tags: string[];
  use_count: number;
  is_ai_personalized: boolean;
  created_at: number;
  updated_at: number;
}

export interface SuggestedAction {
  id: string;
  email_id: string | null;
  thread_id: string | null;
  action_type: string; // 'archive', 'follow_up', 'reply', 'label', 'reminder'
  suggestion: string;
  priority: number; // 0-100
  is_dismissed: boolean;
  is_completed: boolean;
  created_at: number;
  expires_at: number | null;
}

export interface ContactInsights {
  email_address: string;
  display_name: string | null;
  total_emails_sent: number;
  total_emails_received: number;
  email_ratio: number;
  avg_response_time_minutes: number | null;
  response_rate: number | null;
  best_day_to_contact: string | null;
  best_hour_to_contact: number | null;
  threads_awaiting_reply: number;
  is_vip: boolean;
  last_interaction: number | null;
  days_since_last_contact: number | null;
}

export interface ThreadHealthSummary {
  total_threads: number;
  active_threads: number;
  awaiting_reply_threads: number;
  stale_threads: number;
  unresponded_threads: number;
  avg_health_score: number;
  threads_by_health: ThreadHealthByContact[];
}

export interface ThreadHealthByContact {
  contact_email: string;
  contact_name: string | null;
  thread_count: number;
  awaiting_count: number;
  avg_health_score: number;
  last_action: string | null;
  days_since_last_contact: number | null;
}

export interface ReminderSuggestion {
  thread_id: string;
  contact_email: string;
  subject: string;
  days_since_last_contact: number;
  suggestion_type: string; // 'gentle_nudge', 'follow_up', 'deadline_passed'
  message: string;
  suggested_message: string;
}

// ============================================
// CONTACTS API
// ============================================

export async function fetchContacts(): Promise<Contact[]> {
  try {
    return await invoke<Contact[]>('get_contacts');
  } catch (error) {
    console.error('Failed to fetch contacts:', error);
    return [];
  }
}

export async function fetchContact(email: string): Promise<Contact | null> {
  try {
    return await invoke<Contact | null>('get_contact', { email });
  } catch (error) {
    console.error('Failed to fetch contact:', error);
    return null;
  }
}

export async function updateContact(
  email: string,
  data: {
    display_name?: string;
    is_vip?: boolean;
    notes?: string;
    tags?: string[];
  }
): Promise<Contact | null> {
  try {
    return await invoke<Contact>('update_contact', { email, ...data });
  } catch (error) {
    console.error('Failed to update contact:', error);
    return null;
  }
}

export async function fetchContactInsights(email: string): Promise<ContactInsights | null> {
  try {
    return await invoke<ContactInsights>('get_contact_insights', { email });
  } catch (error) {
    console.error('Failed to fetch contact insights:', error);
    return null;
  }
}

export async function fetchAllContactInsights(): Promise<ContactInsights[]> {
  try {
    return await invoke<ContactInsights[]>('get_all_contact_insights');
  } catch (error) {
    console.error('Failed to fetch all contact insights:', error);
    return [];
  }
}

// ============================================
// THREADS API
// ============================================

export async function fetchThreads(status?: string, limit?: number): Promise<Thread[]> {
  try {
    return await invoke<Thread[]>('get_threads', { status, limit });
  } catch (error) {
    console.error('Failed to fetch threads:', error);
    return [];
  }
}

export async function fetchThread(threadId: string): Promise<Thread | null> {
  try {
    return await invoke<Thread | null>('get_thread', { threadId });
  } catch (error) {
    console.error('Failed to fetch thread:', error);
    return null;
  }
}

export async function updateThreadStatus(threadId: string, status: string): Promise<Thread | null> {
  try {
    return await invoke<Thread>('update_thread_status', { threadId, status });
  } catch (error) {
    console.error('Failed to update thread status:', error);
    return null;
  }
}

export async function fetchThreadHealthSummary(): Promise<ThreadHealthSummary | null> {
  try {
    return await invoke<ThreadHealthSummary>('get_thread_health_summary');
  } catch (error) {
    console.error('Failed to fetch thread health summary:', error);
    return null;
  }
}

// ============================================
// FOLLOW-UP REMINDERS API
// ============================================

export async function fetchFollowUpReminders(): Promise<FollowUpReminder[]> {
  try {
    return await invoke<FollowUpReminder[]>('get_follow_up_reminders');
  } catch (error) {
    console.error('Failed to fetch follow-up reminders:', error);
    return [];
  }
}

export async function createFollowUpReminder(
  threadId: string,
  emailId: string,
  contactEmail: string,
  reminderType: string,
  daysFromNow: number,
  messageSuggestion?: string
): Promise<FollowUpReminder | null> {
  try {
    return await invoke<FollowUpReminder>('create_follow_up_reminder', {
      threadId,
      emailId,
      contactEmail,
      reminderType,
      daysFromNow,
      messageSuggestion,
    });
  } catch (error) {
    console.error('Failed to create follow-up reminder:', error);
    return null;
  }
}

export async function completeReminder(reminderId: string): Promise<boolean> {
  try {
    await invoke('complete_reminder', { reminderId });
    return true;
  } catch (error) {
    console.error('Failed to complete reminder:', error);
    return false;
  }
}

export async function snoozeReminder(reminderId: string, days: number): Promise<FollowUpReminder | null> {
  try {
    return await invoke<FollowUpReminder>('snooze_reminder', { reminderId, days });
  } catch (error) {
    console.error('Failed to snooze reminder:', error);
    return null;
  }
}

export async function fetchReminderSuggestions(): Promise<ReminderSuggestion[]> {
  try {
    return await invoke<ReminderSuggestion[]>('get_reminder_suggestions');
  } catch (error) {
    console.error('Failed to fetch reminder suggestions:', error);
    return [];
  }
}

// ============================================
// EMAIL TEMPLATES API
// ============================================

export async function fetchEmailTemplates(): Promise<EmailTemplate[]> {
  try {
    return await invoke<EmailTemplate[]>('get_email_templates');
  } catch (error) {
    console.error('Failed to fetch email templates:', error);
    return [];
  }
}

export async function fetchTemplate(templateId: string): Promise<EmailTemplate | null> {
  try {
    return await invoke<EmailTemplate | null>('get_template', { templateId });
  } catch (error) {
    console.error('Failed to fetch template:', error);
    return null;
  }
}

export async function createTemplate(
  name: string,
  subject: string | null,
  body: string,
  category?: string,
  tags?: string[]
): Promise<EmailTemplate | null> {
  try {
    return await invoke<EmailTemplate>('create_template', {
      name,
      subject,
      body,
      category,
      tags,
    });
  } catch (error) {
    console.error('Failed to create template:', error);
    return null;
  }
}

export async function updateTemplate(
  templateId: string,
  name?: string,
  subject?: string,
  body?: string,
  category?: string,
  tags?: string[]
): Promise<EmailTemplate | null> {
  try {
    return await invoke<EmailTemplate>('update_template', {
      templateId,
      name,
      subject,
      body,
      category,
      tags,
    });
  } catch (error) {
    console.error('Failed to update template:', error);
    return null;
  }
}

export async function deleteTemplate(templateId: string): Promise<boolean> {
  try {
    await invoke('delete_template', { templateId });
    return true;
  } catch (error) {
    console.error('Failed to delete template:', error);
    return false;
  }
}

// ============================================
// SUGGESTED ACTIONS API
// ============================================

export async function fetchSuggestedActions(): Promise<SuggestedAction[]> {
  try {
    return await invoke<SuggestedAction[]>('get_suggested_actions');
  } catch (error) {
    console.error('Failed to fetch suggested actions:', error);
    return [];
  }
}

export async function dismissSuggestedAction(actionId: string): Promise<boolean> {
  try {
    await invoke('dismiss_suggested_action', { actionId });
    return true;
  } catch (error) {
    console.error('Failed to dismiss suggested action:', error);
    return false;
  }
}

export async function completeSuggestedAction(actionId: string): Promise<boolean> {
  try {
    await invoke('complete_suggested_action', { actionId });
    return true;
  } catch (error) {
    console.error('Failed to complete suggested action:', error);
    return false;
  }
}

// ============================================
// SYNC API
// ============================================

export async function syncThreadFromEmail(email: any): Promise<Thread | null> {
  try {
    return await invoke<Thread>('sync_thread_from_email', { email });
  } catch (error) {
    console.error('Failed to sync thread from email:', error);
    return null;
  }
}

export async function syncContactFromEmail(email: any): Promise<Contact | null> {
  try {
    return await invoke<Contact>('sync_contact_from_email', { email });
  } catch (error) {
    console.error('Failed to sync contact from email:', error);
    return null;
  }
}

export async function fetchBestTimeToContact(contactEmail: string): Promise<ContactInsights | null> {
  try {
    return await invoke<ContactInsights>('get_best_time_to_contact', { contactEmail });
  } catch (error) {
    console.error('Failed to fetch best time to contact:', error);
    return null;
  }
}
