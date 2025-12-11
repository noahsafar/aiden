export interface AuthToken {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export interface Email {
  id: string;
  thread_id: string;
  gmail_id: string;
  subject: string;
  sender: string;
  recipients: string[];
  date: string;
  body_text: string;
  body_html?: string;
  snippet: string;
  is_read: boolean;
  is_starred: boolean;
  has_attachments: boolean;
  status: EmailStatus;
  category: EmailCategory;
  summary?: string;
  key_points: string[];
  requires_reply: boolean;
  ai_generated_reply?: string;
  created_at: string;
  updated_at: string;
}

export type EmailStatus = 'Unhandled' | 'Reviewed' | 'Replied' | 'Archived' | 'Scheduled' | 'AutoHandled';

export type EmailCategory = 'Urgent' | 'Important' | 'Normal' | 'Low' | 'Spam' | 'Newsletter' | 'Notification';

export interface EmailSummary {
  summary: string;
  key_points: string[];
}

export interface EmailClassification {
  category: EmailCategory;
  confidence: number;
  requires_reply: boolean;
  can_auto_archive: boolean;
}

export interface GeneratedReply {
  reply: string;
  tone: string;
  confidence: number;
}

export interface WritingStyle {
  user_email: string;
  tone: string;
  formality_score: number;
  common_phrases: string[];
  avg_sentence_length: number;
  avg_response_time_minutes: number;
  last_updated: string;
}

export interface EmailStats {
  total_processed: number;
  auto_sent: number;
  time_saved_hours: number;
  top_senders: [string, number][];
}

export interface Settings {
  polling_interval: number;
  notification_enabled: boolean;
  auto_send_enabled: boolean;
  notification_sound: boolean;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
  ai_model: string;
  auto_archive_threshold: number;
  theme: 'light' | 'dark' | 'system';
}