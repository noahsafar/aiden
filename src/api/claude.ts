// Direct Claude API calls through Tauri commands
// Uses ANTHROPIC_API_KEY from environment

import { invoke } from '@tauri-apps/api/core';

// ==================== TYPES ====================

export interface Question {
  type: 'choice' | 'text';
  question: string;
  options?: string[];
}

export interface MeetingRequest {
  is_meeting: boolean;
  proposed_times: string[];
  duration_minutes: number;
  subject: string;
}

export interface AnalyzeEmailRequest {
  sender: string;
  subject: string;
  body_text: string;
  has_attachments: boolean;
}

export interface AnalyzeEmailResponse {
  questions: Question[];
  suggested_formality_score: number;
  requires_reply: boolean;
  reply_reasoning: string;
  meeting_request?: MeetingRequest | null;
  missing_attachment_warning?: string | null;
  mentioned_document_types: string[];
  // Separate attachment requests from questions (shown before Generate Reply)
  attachment_requests: AttachmentRequest[];
  // Deadline extracted from email (e.g. "2025-02-15", "next Friday", "March 1st")
  deadline?: string | null;
  // Detected tone of the sender (e.g. "frustrated", "friendly", "neutral")
  sender_tone?: string | null;
  // Life intelligence data extracted from email
  life_data: LifeDataItem[];
}

export interface AttachmentRequest {
  keyword: string;
  file_type: string | null;
  description: string;
}

export interface LifeDataItem {
  data_type: 'subscription' | 'bill' | 'travel' | 'package' | 'deadline';
  title: string;
  amount?: number | null;
  currency?: string | null;
  date?: string | null;
  end_date?: string | null;
  frequency?: string | null;
  details?: string | null;
  tracking_number?: string | null;
  carrier?: string | null;
}

// File search types
export interface IndexedFolder {
  path: string;
  name: string;
  enabled: boolean;
}

export interface FileMatch {
  path: string;
  name: string;
  file_type: string;
  size: number;
  modified: number;
  folder_name: string;
}

export interface UserAnswer {
  question: string;
  answer: string;
}

// Conversation context types
export interface ConversationEmail {
  subject: string;
  sender: string;
  body: string;
  date: string;
  is_from_user: boolean;
}

export interface ConversationContext {
  recipient_email: string;
  previous_emails: ConversationEmail[];
  total_conversation_count: number;
}

// Writing style types
export interface RecipientWritingStyle {
  recipient_email: string;
  tone_description: string;
  formality_score: number;
  common_phrases: string[];
  greeting_style: string;
  sign_off_style: string;
  sample_count: number;
  last_updated: string;
}

export interface GenerateReplyRequest {
  sender: string;
  subject: string;
  body_text: string;
  user_answers: UserAnswer[];
  formality_level: 'casual' | 'neutral' | 'formal';
  additional_context?: string;
  selected_meeting_time?: string;
  // New fields for context and learned tone
  conversation_context?: ConversationContext;
  learned_writing_style?: RecipientWritingStyle;
  // User's name for sign-off - prevents placeholder like "[Your Name]"
  user_name?: string;
  // Detected tone of the sender's email (from analysis) - used to adapt reply
  sender_tone?: string;
}

export interface GenerateReplyResponse {
  reply: string;
  subject: string;
}

// ==================== ATTACHMENT ANALYSIS ====================

export interface AnalyzeAttachmentRequest {
  filename: string;
  attachment_data: string; // base64 encoded
  mime_type: string;
  email_subject?: string;
  email_sender?: string;
  email_body?: string;
  email_summary?: string;
}

export interface AnalyzedAttachment {
  summary: string;
  key_points: string[];
  action_items: string[];
}

// ==================== FUNCTIONS ====================

/**
 * Summarize an email using Claude API (via Tauri)
 */
export async function summarizeEmail(emailContent: string): Promise<{ summary: string; key_points: string[] }> {
  const response = await invoke<{ summary: string; key_points: string[] }>('summarize_email', {
    emailContent,
    styleContext: null,
  });
  return response;
}

/**
 * Analyze an email using Claude API
 * Extracts questions, detects meeting requests, suggests formality
 */
export async function analyzeEmail(request: AnalyzeEmailRequest): Promise<AnalyzeEmailResponse> {
  try {
    const response = await invoke<AnalyzeEmailResponse>('analyze_email_claude', { request });
    return response;
  } catch (error) {
    console.error('Failed to analyze email with Claude:', error);
    throw error;
  }
}

/**
 * Generate a reply using Claude API
 */
export async function generateReply(request: GenerateReplyRequest): Promise<GenerateReplyResponse> {
  try {
    const response = await invoke<GenerateReplyResponse>('generate_reply_claude', { request });
    return response;
  } catch (error) {
    console.error('Failed to generate reply with Claude:', error);
    throw error;
  }
}

/**
 * Edit an existing reply using Claude API
 */
export async function editReply(currentReply: string, editPrompt: string): Promise<string> {
  try {
    const response = await invoke<string>('edit_reply_claude', {
      request: {
        current_reply: currentReply,
        edit_prompt: editPrompt,
      },
    });
    return response;
  } catch (error) {
    console.error('Failed to edit reply with Claude:', error);
    throw error;
  }
}

/**
 * Analyze an attachment using Claude API
 * Supports images via vision API and text-based documents
 */
export async function analyzeAttachment(request: AnalyzeAttachmentRequest): Promise<AnalyzedAttachment> {
  try {
    const response = await invoke<AnalyzedAttachment>('analyze_attachment_claude', { request });
    return response;
  } catch (error) {
    console.error('Failed to analyze attachment with Claude:', error);
    throw error;
  }
}

// ==================== CONVERSATION CONTEXT & WRITING STYLE ====================

/**
 * Get conversation context with a recipient
 * Returns previous emails to/from this recipient
 */
export async function getConversationContext(
  recipientEmail: string,
  allEmails: any[],
  currentEmailId?: string,
  limit?: number
): Promise<ConversationContext> {
  try {
    const response = await invoke<ConversationContext>('get_conversation_context_from_emails', {
      recipientEmail,
      allEmails,
      currentEmailId,
      limit,
    });
    return response;
  } catch (error) {
    console.error('Failed to get conversation context:', error);
    throw error;
  }
}

/**
 * Get saved writing style for a recipient
 */
export async function getRecipientWritingStyle(
  recipientEmail: string
): Promise<RecipientWritingStyle | null> {
  try {
    const response = await invoke<RecipientWritingStyle | null>('get_recipient_writing_style', {
      recipientEmail,
    });
    return response;
  } catch (error) {
    console.error('Failed to get recipient writing style:', error);
    return null;
  }
}

/**
 * Save writing style for a recipient
 */
export async function saveRecipientWritingStyle(
  style: RecipientWritingStyle
): Promise<void> {
  try {
    await invoke('save_recipient_writing_style', { style });
  } catch (error) {
    console.error('Failed to save recipient writing style:', error);
    throw error;
  }
}

/**
 * Analyze sent emails to learn writing style for a recipient
 */
export async function analyzeAndSaveWritingStyle(
  recipientEmail: string,
  sentEmailsBodies: string[]
): Promise<RecipientWritingStyle> {
  try {
    const response = await invoke<RecipientWritingStyle>('analyze_and_save_writing_style', {
      recipientEmail,
      sentEmailsBodies,
    });
    return response;
  } catch (error) {
    console.error('Failed to analyze and save writing style:', error);
    throw error;
  }
}

// ==================== FILE SEARCH ====================

/**
 * Get indexed folders configuration
 */
export async function getIndexedFolders(): Promise<IndexedFolder[]> {
  try {
    return await invoke<IndexedFolder[]>('get_indexed_folders');
  } catch (error) {
    console.error('Failed to get indexed folders:', error);
    return [];
  }
}

/**
 * Update indexed folders configuration
 */
export async function updateIndexedFolders(folders: IndexedFolder[]): Promise<void> {
  try {
    await invoke('update_indexed_folders', { folders });
  } catch (error) {
    console.error('Failed to update indexed folders:', error);
    throw error;
  }
}

/**
 * Search files by keywords and optionally by file type
 */
export async function searchFiles(
  keywords: string[],
  fileTypes?: string[],
  limit?: number
): Promise<FileMatch[]> {
  try {
    return await invoke<FileMatch[]>('search_files', {
      keywords,
      file_types: fileTypes,
      limit,
    });
  } catch (error) {
    console.error('Failed to search files:', error);
    return [];
  }
}

/**
 * Get file as base64 for attachment
 */
export async function getFileBase64(path: string): Promise<string> {
  try {
    return await invoke<string>('get_file_base64', { path });
  } catch (error) {
    console.error('Failed to get file base64:', error);
    throw error;
  }
}

/**
 * Get file info
 */
export async function getFileInfo(path: string): Promise<FileMatch> {
  try {
    return await invoke<FileMatch>('get_file_info', { path });
  } catch (error) {
    console.error('Failed to get file info:', error);
    throw error;
  }
}
