// API functions for fetching emails from OAuth server
// LLM endpoints redirect to GenAI service; Gmail/Calendar endpoints stay on Email service

import { GENAI_SERVICE_URL } from './config';

export interface GmailEmail {
  id: string;
  threadId: string;
  snippet: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  timestamp: number;
  isRead: boolean;
  labels: string[];
  sizeEstimate: number;
  summary?: string;
}

export interface EmailResponse {
  success: boolean;
  emails: GmailEmail[];
  total: number;
  query: string;
  maxResults: number;
  error?: string;
}

export interface SummarizeResponse {
  success: boolean;
  summary?: string;
  error?: string;
}

// Try to find the oauth server on ports 8081-8085, with retries for startup race
async function getOAuthServerURL(retries = 3): Promise<string> {
  const ports = [8081, 8082, 8083, 8084, 8085];
  for (let attempt = 0; attempt < retries; attempt++) {
    for (const port of ports) {
      try {
        const response = await fetch(`http://localhost:${port}/`, {
          method: 'GET',
          signal: AbortSignal.timeout(500)
        });
        if (response.ok) {
          console.log(`[serverURL] Found oauth server on port ${port}`);
          return `http://localhost:${port}`;
        }
      } catch {
        // Port not available, try next
      }
    }
    // Server might still be starting — wait before retrying
    if (attempt < retries - 1) {
      console.log(`[serverURL] Server not found, retrying in 2s (attempt ${attempt + 1}/${retries})`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  console.log(`[serverURL] No oauth server found, using default 8082`);
  return 'http://localhost:8082'; // fallback to most common port
}

let cachedServerURL: string | null = null;

async function serverURL(): Promise<string> {
  if (!cachedServerURL) {
    cachedServerURL = await getOAuthServerURL();
  }
  return cachedServerURL;
}

// Reset cached URL on fetch failure so next call re-discovers
export function resetServerURL() {
  cachedServerURL = null;
}

export async function fetchEmails(
  accessToken: string,
  maxResults: number = 10,
  query: string = 'in:inbox',
  includeSummaries: boolean = true
): Promise<EmailResponse> {
  try {
    const baseURL = await serverURL();
    const url = new URL(`${baseURL}/emails`);
    url.searchParams.append('maxResults', maxResults.toString());
    url.searchParams.append('q', query);
    url.searchParams.append('includeSummaries', includeSummaries.toString());

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data: EmailResponse = await response.json();
    return data;
  } catch (error) {
    console.error('Failed to fetch emails:', error);
    return {
      success: false,
      emails: [],
      total: 0,
      query,
      maxResults,
      error: error instanceof Error ? error.message : 'Failed to fetch emails'
    };
  }
}

// Generate a summary for a single email — tries GenAI Gateway, falls back to Email service
export async function summarizeEmail(
  sender: string,
  subject: string,
  bodyText: string,
  snippet: string
): Promise<SummarizeResponse> {
  // Try GenAI Gateway first
  try {
    const emailContent = `From: ${sender}\nSubject: ${subject}\n\n${bodyText || snippet}`;
    const resp = await fetch(`${GENAI_SERVICE_URL}/api/v1/summarize-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email_content: emailContent }),
    });
    if (resp.ok) {
      const data = await resp.json();
      return { success: true, summary: data.summary };
    }
  } catch {
    // GenAI not available, fall back
  }

  // Fall back to Email service /summarize endpoint
  try {
    const baseURL = await serverURL();
    const response = await fetch(`${baseURL}/summarize`, {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender,
        subject,
        body_text: bodyText,
        snippet,
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data: SummarizeResponse = await response.json();
    return data;
  } catch (error) {
    console.error('Failed to summarize email:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate summary'
    };
  }
}

// Export serverURL for other files to use
export { serverURL };

// ==================== ATTACHMENT API TYPES ====================

export interface EmailAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface AttachmentDownloadResponse {
  success: boolean;
  data?: string;  // base64 encoded
  size?: number;
  error?: string;
}

export interface AttachmentSummarizeResponse {
  success: boolean;
  summary?: string;
  extracted_text_length?: number;
  note?: string;
  error?: string;
}

export interface SearchedAttachment {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string;
  messageId: string;
  subject: string;
  to: string;
  date: string;
  relevanceScore: number;
}

export interface SearchAttachmentsResponse {
  success: boolean;
  attachments?: SearchedAttachment[];
  total?: number;
  error?: string;
}

export interface AnalyzeEmailResponse {
  success: boolean;
  questions?: Array<{
    type: 'choice' | 'text';
    question: string;
    options?: string[];
  }>;
  suggested_formality_score?: number;
  requires_reply?: boolean;
  reply_reasoning?: string;
  meeting_request?: {
    is_meeting: boolean;
    proposed_times: string[];
    duration_minutes: number;
    subject: string;
  };
  missing_attachment_warning?: string | null;
  mentioned_document_types?: string[];
  error?: string;
}

// ==================== ATTACHMENT API FUNCTIONS ====================

/**
 * Download an attachment from Gmail
 */
export async function downloadAttachment(
  messageId: string,
  attachmentId: string
): Promise<AttachmentDownloadResponse> {
  try {
    const baseURL = await serverURL();
    const url = new URL(`${baseURL}/get-attachment`);
    url.searchParams.append('messageId', messageId);
    url.searchParams.append('attachmentId', attachmentId);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data: AttachmentDownloadResponse = await response.json();
    return data;
  } catch (error) {
    console.error('Failed to download attachment:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to download attachment'
    };
  }
}

/**
 * Summarize an attachment — tries GenAI Gateway, falls back to Email service
 */
export async function summarizeAttachment(
  filename: string,
  attachmentData: string,  // base64 encoded
  mimeType: string
): Promise<AttachmentSummarizeResponse> {
  // Try GenAI Gateway first
  try {
    const resp = await fetch(`${GENAI_SERVICE_URL}/api/v1/summarize-attachment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, data: attachmentData, mime_type: mimeType }),
    });
    if (resp.ok) {
      return await resp.json();
    }
  } catch {
    // GenAI not available, fall back
  }

  // Fall back to Email service
  try {
    const baseURL = await serverURL();
    const response = await fetch(`${baseURL}/summarize-attachment`, {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filename,
        data: attachmentData,
        mimeType,
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data: AttachmentSummarizeResponse = await response.json();
    return data;
  } catch (error) {
    console.error('Failed to summarize attachment:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to summarize attachment'
    };
  }
}

/**
 * Search for attachments in sent emails that might be relevant
 */
export async function searchAttachments(
  keywords: string[],
  senderEmail?: string,
  maxResults: number = 10
): Promise<SearchAttachmentsResponse> {
  try {
    const baseURL = await serverURL();
    const response = await fetch(`${baseURL}/search-attachments`, {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        keywords,
        sender_email: senderEmail,
        max_results: maxResults,
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data: SearchAttachmentsResponse = await response.json();
    return data;
  } catch (error) {
    console.error('Failed to search attachments:', error);
    return {
      success: false,
      attachments: [],
      total: 0,
      error: error instanceof Error ? error.message : 'Failed to search attachments'
    };
  }
}

/**
 * Download a base64 attachment to the user's Downloads folder using Tauri
 */
export async function saveAttachmentToFile(
  filename: string,
  base64Data: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');

    // Convert base64 to Uint8Array
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Try to use the Tauri dialog plugin for save dialog
    let filePath: string | null = null;
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      filePath = await save({
        defaultPath: filename,
        filters: [
          {
            name: 'All Files',
            extensions: ['*']
          }
        ]
      });
    } catch (e) {
      // Dialog plugin not available, use default Downloads path
      console.log('Dialog plugin not available, using default path');
      const downloadsPath = await invoke<string>('get_downloads_path', {}).catch(() => {
        // Fallback to a default path if the command doesn't exist
        return `${filename}`;
      });
      filePath = `${downloadsPath}/${filename}`.replace('//', '/');
    }

    if (!filePath) {
      return { success: false, error: 'Save dialog cancelled' };
    }

    // Use Tauri to write the file
    await invoke('write_file', {
      path: filePath,
      contents: Array.from(bytes)
    });

    return { success: true };
  } catch (error) {
    console.error('Failed to save attachment:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save attachment'
    };
  }
}

// Helper function to convert Gmail email format to app's Email format
export function convertGmailEmail(gmailEmail: GmailEmail): any {
  return {
    id: gmailEmail.id,
    gmail_id: gmailEmail.id,
    thread_id: gmailEmail.threadId,
    subject: gmailEmail.subject,
    sender: gmailEmail.from,
    recipients: gmailEmail.to,
    date: gmailEmail.date,
    body_text: gmailEmail.snippet, // For now, use snippet as body text
    snippet: gmailEmail.snippet,
    is_read: gmailEmail.isRead,
    is_starred: gmailEmail.labels.includes('STARRED'),
    has_attachments: gmailEmail.labels.includes('ATTACHMENT'),
    status: 'Unhandled' as const,
    category: 'Normal' as const, // Default category
    requires_reply: !gmailEmail.isRead && !gmailEmail.from.includes('me'),
    summary: gmailEmail.summary,
  };
}