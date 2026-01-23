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
}

export interface UserAnswer {
  question: string;
  answer: string;
}

export interface GenerateReplyRequest {
  sender: string;
  subject: string;
  body_text: string;
  user_answers: UserAnswer[];
  formality_level: 'casual' | 'neutral' | 'formal';
  additional_context?: string;
  selected_meeting_time?: string;
}

export interface GenerateReplyResponse {
  reply: string;
  subject: string;
}

// ==================== FUNCTIONS ====================

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
