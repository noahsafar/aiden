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
}

export interface EmailResponse {
  success: boolean;
  emails: GmailEmail[];
  total: number;
  query: string;
  maxResults: number;
  error?: string;
}

const OAUTH_SERVER_URL = 'http://localhost:8082';

export async function fetchEmails(accessToken: string, maxResults: number = 10, query: string = 'in:inbox'): Promise<EmailResponse> {
  try {
    const url = new URL(`${OAUTH_SERVER_URL}/emails`);
    url.searchParams.append('maxResults', maxResults.toString());
    url.searchParams.append('q', query);

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
  };
}