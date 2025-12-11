// Direct Gmail API integration for Aiden
// This version uses Gmail API directly from the frontend

// Your OAuth 2.0 client configuration from Google Cloud Console
const GOOGLE_CLIENT_ID = '371357217343-ihm24nevjs05qijuebtrc7vdv33cpuuj.apps.googleusercontent.com';
const GOOGLE_API_KEY = 'AIzaSyC0Y5nk1qa9n-nn-3TujYu5a_nXwO8Ir4c'; // You'll need to add this
const SCOPES = 'https://www.googleapis.com/auth/gmail.readonly';

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

// Initialize Gmail API client
export async function initGmailAPI(): Promise<gapi.client.gmail> {
  return new Promise((resolve, reject) => {
    gapi.load('client', async () => {
      try {
        await gapi.client.init({
          apiKey: GOOGLE_API_KEY,
          clientId: GOOGLE_CLIENT_ID,
          discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest'],
          scope: SCOPES,
        });

        const gmail = gapi.client.gmail;
        resolve(gmail);
      } catch (error) {
        reject(error);
      }
    });
  });
}

// Fetch emails from Gmail API
export async function fetchGmailEmails(
  accessToken: string,
  maxResults: number = 10,
  query: string = 'in:inbox'
): Promise<EmailResponse> {
  try {
    // First, initialize the Gmail API
    const gmail = await initGmailAPI();

    // List messages
    const response = await gmail.users.messages.list({
      userId: 'me',
      maxResults: maxResults,
      q: query,
    });

    const messages = response.result.messages || [];
    const emails: GmailEmail[] = [];

    // Fetch full details for each message
    for (const message of messages) {
      try {
        const fullMessage = await gmail.users.messages.get({
          userId: 'me',
          id: message.id!,
          format: 'metadata',
          metadataHeaders: ['From', 'To', 'Subject', 'Date', 'Snippet'],
        });

        const msg = fullMessage.result;
        if (!msg) continue;

        // Extract headers
        const headers: { [key: string]: string } = {};
        if (msg.payload?.headers) {
          for (const header of msg.payload.headers) {
            headers[header.name!] = header.value!;
          }
        }

        // Parse date
        const dateStr = headers['Date'] || '';
        let timestamp = Date.now();
        if (dateStr) {
          try {
            const dateObj = new Date(dateStr);
            timestamp = dateObj.getTime();
          } catch (e) {
            console.warn('Failed to parse date:', dateStr);
          }
        }

        const email: GmailEmail = {
          id: msg.id!,
          threadId: msg.threadId!,
          snippet: msg.snippet || '',
          from: headers['From'] || '',
          to: headers['To'] || '',
          subject: headers['Subject'] || '(No Subject)',
          date: dateStr,
          timestamp,
          isRead: !msg.labelIds?.includes('UNREAD'),
          labels: msg.labelIds || [],
          sizeEstimate: msg.sizeEstimate || 0,
        };

        emails.push(email);
      } catch (error) {
        console.error('Error fetching message details:', error);
        continue;
      }
    }

    // Sort by timestamp (most recent first)
    emails.sort((a, b) => b.timestamp - a.timestamp);

    return {
      success: true,
      emails,
      total: emails.length,
      query,
      maxResults,
    };
  } catch (error) {
    console.error('Failed to fetch Gmail emails:', error);
    return {
      success: false,
      emails: [],
      total: 0,
      query,
      maxResults,
      error: error instanceof Error ? error.message : 'Failed to fetch emails',
    };
  }
}

// Convert Gmail email to app's Email format
export function convertGmailEmailToApp(gmailEmail: GmailEmail) {
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
    requires_reply: !gmailEmail.isRead && !gmailEmail.from.toLowerCase().includes('me'),
  };
}

// Send email using Gmail API via Tauri backend
export async function sendGmailEmail(
  to: string,
  subject: string,
  body: string,
  accessToken: string = ''
): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    // Check if Tauri runtime is available
    // Use the same detection as in tauri-api.ts
    const isTauri = typeof window !== 'undefined' && (window.__TAURI__ || window.__TAURI_INTERNALS__);
    if (!isTauri) {
      throw new Error('Tauri runtime not available. This feature requires the desktop app.');
    }

    // Get the stored token if not provided
    if (!accessToken) {
      // Try to get token from localStorage first (from Python OAuth)
      accessToken = localStorage.getItem('aiden_access_token') || '';

      if (!accessToken) {
        // If not in localStorage, try getting from Rust backend
        try {
          const { invoke } = await import('@/lib/tauri-api');
          accessToken = await invoke<string>('get_stored_token');
          if (!accessToken) {
            throw new Error('Not authenticated. Please sign in to send emails.');
          }
        } catch (tokenError) {
          console.error('Error getting stored token:', tokenError);
          throw new Error('Not authenticated. Please sign in to send emails.');
        }
      }
    }

    // Send email via Tauri backend
    try {
      const { invoke } = await import('@/lib/tauri-api');
      await invoke('send_email', {
        accessToken,
        to,
        subject,
        body,
      });
    } catch (sendError) {
      console.error('Error sending email via backend:', sendError);
      throw new Error('Failed to send email through backend service.');
    }

    return {
      success: true,
      message: `Email sent successfully to ${to}!`,
    };
  } catch (error) {
    console.error('Error sending email:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send email',
    };
  }
}