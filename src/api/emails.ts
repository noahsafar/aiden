// API functions for fetching emails from OAuth server

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

const OAUTH_SERVER_URL = 'http://localhost:8081';

export async function fetchEmails(
  accessToken: string,
  maxResults: number = 10,
  query: string = 'in:inbox',
  includeSummaries: boolean = true
): Promise<EmailResponse> {
  try {
    const url = new URL(`${OAUTH_SERVER_URL}/emails`);
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

// Generate a summary for a single email
export async function summarizeEmail(
  sender: string,
  subject: string,
  bodyText: string,
  snippet: string
): Promise<SummarizeResponse> {
  try {
    const response = await fetch('http://localhost:8081/summarize', {
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