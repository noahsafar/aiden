#!/usr/bin/env python3
"""
Python OAuth Server for Tauri Aiden App
Uses the same working OAuth flow as the original aiden-ai implementation
"""
import json
import os
import pickle
import webbrowser
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import threading
import time

from dotenv import load_dotenv
load_dotenv()

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

# OAuth Scopes for Gmail access (matching working aiden-ai implementation)
SCOPES = [
    'openid',  # Add at beginning - Google adds this automatically
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile'
]

# OAuth Configuration
# IMPORTANT: Use your DESKTOP APP credentials from Google Cloud Console
# These should be from a "Desktop app" OAuth 2.0 Client ID, not "Web application"
CLIENT_ID = os.getenv('GOOGLE_CLIENT_ID')
CLIENT_SECRET = os.getenv('GOOGLE_CLIENT_SECRET')

# Validate required environment variables
if not CLIENT_ID or not CLIENT_SECRET:
    raise ValueError(
        "Missing required OAuth credentials. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET "
        "in your .env file. See .env.example for the required format."
    )

# Token storage paths
TOKEN_DIR = Path.home() / '.aiden'
TOKEN_FILE = TOKEN_DIR / 'token.pickle'
CREDENTIALS_FILE = TOKEN_DIR / 'credentials.json'
USER_INFO_FILE = TOKEN_DIR / 'user_info.json'
SENT_EMAILS_CACHE_FILE = TOKEN_DIR / 'sent_emails_cache.json'

# AI API Keys
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')

# Rate limiting retry configuration
MAX_RETRIES = 5
INITIAL_RETRY_DELAY = 5  # seconds


def call_openai_with_retry(messages, max_tokens=300, temperature=0.7, timeout=15):
    """Call OpenAI API with exponential backoff retry on rate limit (429) errors"""
    import requests

    if not OPENAI_API_KEY:
        return None, "OPENAI_API_KEY not configured"

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {OPENAI_API_KEY.strip()}"
    }

    body = {
        "model": "gpt-4o-mini",
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature
    }

    retry_count = 0
    delay = INITIAL_RETRY_DELAY

    while retry_count <= MAX_RETRIES:
        response = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers=headers,
            json=body,
            timeout=timeout
        )

        if response.status_code == 200:
            result = response.json()
            return result['choices'][0]['message']['content'].strip(), None
        elif response.status_code == 429:
            retry_count += 1
            if retry_count > MAX_RETRIES:
                error_msg = response.text
                # Extract retry-after from error if available
                try:
                    error_json = response.json()
                    if 'retry_after' in error_json.get('error', {}):
                        delay = int(error_json['error']['retry_after'])
                except:
                    pass
                return None, f"Rate limit exceeded after {MAX_RETRIES} retries"

            # Extract suggested retry time if available
            try:
                error_json = response.json()
                error_text = error_json.get('error', {}).get('message', '')
                print(f"OpenAI rate limit hit (attempt {retry_count}/{MAX_RETRIES}): {error_text[:100]}")
                # Try to extract retry time from message like "Please try again in 20s"
                import re
                retry_match = re.search(r'try again in (\d+)s', error_text.lower())
                if retry_match:
                    delay = int(retry_match.group(1)) + 1
            except:
                pass

            print(f"Retrying in {delay} seconds...")
            time.sleep(delay)
            delay *= 2  # Exponential backoff
        else:
            return None, f"API error {response.status_code}: {response.text[:200]}"

    return None, "Max retries exceeded"


def extract_email_body(message):
    """Extract plain text body from Gmail message"""
    try:
        payload = message.get('payload', {})

        def find_text(part):
            if part.get('mimeType') == 'text/plain':
                data = part.get('body', {}).get('data', '')
                if data:
                    import base64
                    return base64.urlsafe_b64decode(data).decode('utf-8', errors='ignore')
            for subpart in part.get('parts', []):
                result = find_text(subpart)
                if result:
                    return result
            return None

        # Check main body first
        body_data = payload.get('body', {}).get('data', '')
        if body_data:
            import base64
            return base64.urlsafe_b64decode(body_data).decode('utf-8', errors='ignore')

        # Check parts
        parts = payload.get('parts', [])
        for part in parts:
            result = find_text(part)
            if result:
                return result

        return None
    except Exception as e:
        print(f"Error extracting body: {e}")
        return None


def fetch_and_cache_sent_emails(creds, count=10):
    """Fetch recent sent emails and cache them for writing style analysis"""
    try:
        service = build('gmail', 'v1', credentials=creds)

        # Fetch sent emails
        results = service.users().messages().list(
            userId='me',
            maxResults=count,
            q='in:sent'
        ).execute()

        messages = results.get('messages', [])
        sent_samples = []

        for message in messages[:count]:
            try:
                msg = service.users().messages().get(
                    userId='me',
                    id=message['id'],
                    format='full'
                ).execute()

                # Extract email body
                body = extract_email_body(msg)
                if body and len(body.strip()) > 30:  # Only substantial emails
                    sent_samples.append(body.strip())
            except Exception as e:
                print(f"Error parsing sent message: {e}")
                continue

        # Save to cache
        if sent_samples:
            with open(SENT_EMAILS_CACHE_FILE, 'w') as f:
                json.dump({'samples': sent_samples}, f, indent=2)
            print(f"Cached {len(sent_samples)} sent email samples for writing style")
        else:
            print("No sent emails found to cache")

        return sent_samples
    except Exception as e:
        print(f"Error fetching sent emails: {e}")
        return []


def load_cached_sent_emails():
    """Load cached sent emails for writing style analysis"""
    if SENT_EMAILS_CACHE_FILE.exists():
        try:
            with open(SENT_EMAILS_CACHE_FILE, 'r') as f:
                data = json.load(f)
                return data.get('samples', [])
        except Exception as e:
            print(f"Error loading sent emails cache: {e}")
    return []


def summarize_email(subject, sender, body_text, snippet=""):
    """Generate a concise summary of an email using OpenAI"""
    if not OPENAI_API_KEY:
        return None

    try:
        # Use snippet if body is too short, otherwise use body
        content = body_text if body_text else snippet

        # Extract sender's first name for more natural summary
        sender_name = extract_name_from_email(sender) or "Sender"

        prompt = f"""Summarize this email in ONE concise sentence. Start with the sender's name and describe what they're saying or asking for.

From: {sender}
Subject: {subject}

Email:
{content[:2000]}

Examples of good summaries:
- "John is asking to meet later today"
- "Sarah wants to reschedule tomorrow's meeting to 3pm"
- "Mike is requesting the quarterly report by Friday"

Summary:"""

        messages = [{"role": "user", "content": prompt}]
        summary, error = call_openai_with_retry(messages, max_tokens=100, temperature=0.3, timeout=10)

        if summary:
            print(f"Email summary generated: {summary[:50]}...")
            return summary
        else:
            print(f"Failed to generate summary: {error}")
            return None

    except Exception as e:
        print(f"Error summarizing email: {e}")
        return None


def get_emails_with_recipient(creds, recipient_email, count=5):
    """Fetch past emails sent to a specific recipient for context-aware style"""
    try:
        service = build('gmail', 'v1', credentials=creds)

        # Search for emails to this recipient
        results = service.users().messages().list(
            userId='me',
            maxResults=count,
            q=f'to:{recipient_email} in:sent'
        ).execute()

        messages = results.get('messages', [])
        recipient_emails = []

        for message in messages[:count]:
            try:
                msg = service.users().messages().get(
                    userId='me',
                    id=message['id'],
                    format='full'
                ).execute()

                # Extract email body
                body = extract_email_body(msg)
                if body and len(body.strip()) > 20:
                    recipient_emails.append(body.strip())
            except Exception as e:
                print(f"Error parsing message: {e}")
                continue

        return recipient_emails
    except Exception as e:
        print(f"Error fetching recipient emails: {e}")
        return []


def extract_name_from_email(sender_string):
    """Extract name from email sender string (e.g., 'John Smith <john@email.com>' -> 'John')"""
    import re
    # Match name in quotes or before angle bracket
    if '<' in sender_string:
        name_part = sender_string.split('<')[0].strip()
        # Remove quotes if present
        name_part = name_part.strip('"').strip("'")
        if name_part:
            # Get first name for casual addressing
            parts = name_part.split()
            if parts:
                return parts[0]  # Return first name
    # Try to extract from email (first.part of email)
    email_match = re.search(r'[\w.]+@', sender_string)
    if email_match:
        email_local = email_match.group(0).rstrip('@')
        # If it's first.last format, get first name
        if '.' in email_local:
            return email_local.split('.')[0].capitalize()
    return None


def detect_relationship_type(sender_string, past_emails):
    """Detect if relationship is formal (professor, business) or casual (friend)"""
    # Check sender name/email for formal indicators
    sender_lower = sender_string.lower()

    # Formal indicators
    formal_titles = ['prof', 'dr.', 'doctor', 'professor', 'mr.', 'mrs.', 'ms.', 'dean', 'president', 'ceo', 'hr', 'recruiter']
    if any(title in sender_lower for title in formal_titles):
        return 'formal'

    # Check email domain for formal organizations
    if any(x in sender_lower for x in ['@yale.edu', '@harvard.edu', '@stanford.edu', '@mit.edu']):
        # Could still be casual, but lean formal for academic
        if 'prof' in sender_lower or 'dean' in sender_lower:
            return 'formal'

    # Check past email patterns
    if past_emails:
        # Look for formal patterns in past emails
        formal_signoffs = ['sincerely', 'respectfully', 'best regards', 'yours truly']
        casual_signoffs = ['best,', 'thanks', 'cheers', 'talk soon', 'see you']

        formal_count = sum(1 for email in past_emails if any(word in email.lower() for word in formal_signoffs))
        casual_count = sum(1 for email in past_emails if any(word in email.lower() for word in casual_signoffs))

        if formal_count > casual_count:
            return 'formal'
        elif casual_count > formal_count:
            return 'casual'

    return 'neutral'

class OAuthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        # Add CORS headers to all responses
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')

        if self.path.startswith('/auth'):
            self.handle_auth()
        elif self.path.startswith('/callback'):
            self.handle_callback()
        elif self.path.startswith('/emails'):
            self.handle_emails()
        elif self.path == '/':
            # Root endpoint with simple status
            self.end_headers()
            self.wfile.write(b'OAuth server is running')
        else:
            self.send_error(404)

    def do_POST(self):
        # Add CORS headers to all responses
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')

        if self.path.startswith('/send-email'):
            self.handle_send_email()
        elif self.path.startswith('/generate-reply'):
            self.handle_generate_reply()
        elif self.path.startswith('/edit-reply'):
            self.handle_edit_reply()
        elif self.path.startswith('/summarize'):
            self.handle_summarize()
        else:
            self.send_error(404)

    def do_OPTIONS(self):
        # Handle preflight requests
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.end_headers()

    def handle_auth(self):
        """Start OAuth flow"""
        try:
            # Don't set headers here since they're set in do_GET
            self.send_header('Content-type', 'application/json')

            # This validation is handled at module import time, but double-check here for safety
            # If we reach this point, credentials should already be validated

            # Create client configuration
            client_config = {
                "installed": {
                    "client_id": CLIENT_ID,
                    "client_secret": CLIENT_SECRET,
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                    "redirect_uris": ["http://localhost:8080/callback"]
                }
            }

            # Save credentials file
            TOKEN_DIR.mkdir(exist_ok=True)
            with open(CREDENTIALS_FILE, 'w') as f:
                json.dump(client_config, f, indent=2)

            # Create OAuth flow
            flow = InstalledAppFlow.from_client_secrets_file(
                CREDENTIALS_FILE, SCOPES
            )

            # Run local server for OAuth callback (using port=0 like in working implementation)
            creds = flow.run_local_server(
                port=0,  # Automatically select available port
                redirect_uri_trailing_slash=False,
                access_type='offline',
                prompt='consent'
            )

            # Save credentials
            with open(TOKEN_FILE, 'wb') as token:
                pickle.dump(creds, token)

            # Get user info
            user_info = self.get_user_info(creds)

            # Save user info for later use (email signature)
            if user_info:
                with open(USER_INFO_FILE, 'w') as f:
                    json.dump(user_info, f, indent=2)

            # Fetch and cache sent emails for writing style
            print("Fetching sent emails to learn your writing style...")
            fetch_and_cache_sent_emails(creds)

            # Return success response
            self.end_headers()
            response = {
                'success': True,
                'credentials': {
                    'access_token': creds.token,
                    'refresh_token': creds.refresh_token,
                    'client_id': creds.client_id,
                    'client_secret': creds.client_secret
                },
                'user': user_info
            }
            self.wfile.write(json.dumps(response).encode())

        except Exception as e:
            print(f"OAuth error: {e}")
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            response = {'success': False, 'error': str(e)}
            self.wfile.write(json.dumps(response).encode())

    def handle_callback(self):
        """Handle OAuth callback"""
        # This is handled by the Google OAuth library
        pass

    def get_user_info(self, creds):
        """Get user information from Google API"""
        try:
            import requests
            response = requests.get(
                'https://www.googleapis.com/oauth2/v2/userinfo',
                headers={'Authorization': f'Bearer {creds.token}'}
            )
            if response.status_code == 200:
                return response.json()
        except Exception as e:
            print(f"Error getting user info: {e}")
        return None

    def handle_emails(self):
        """Handle fetching emails from Gmail"""
        try:
            # Don't set headers here since they're set in do_GET
            self.send_header('Content-type', 'application/json')

            # Get stored credentials
            creds = get_stored_credentials()

            if not creds:
                self.end_headers()
                response = {
                    'success': False,
                    'error': 'Not authenticated. Please sign in first.'
                }
                self.wfile.write(json.dumps(response).encode())
                return

            # Build Gmail service
            service = build('gmail', 'v1', credentials=creds)

            # Get query parameters
            parsed_url = urlparse(self.path)
            query_params = parse_qs(parsed_url.query)

            # Set default values
            max_results = 10  # Limit to 10 recent emails
            query = 'in:inbox'  # Only inbox emails
            include_summaries = query_params.get('includeSummaries', ['false'])[0].lower() == 'true'

            # Override with query params if provided
            if 'maxResults' in query_params:
                max_results = int(query_params['maxResults'][0])
            if 'q' in query_params:
                query = query_params['q'][0]

            # Fetch messages
            results = service.users().messages().list(
                userId='me',
                maxResults=max_results,
                q=query
            ).execute()

            messages = results.get('messages', [])

            emails = []
            for message in messages:
                try:
                    # Get full message details with body if summaries are requested
                    msg_format = 'full' if include_summaries else 'metadata'
                    metadata_headers = ['From', 'To', 'Subject', 'Date', 'Snippet']

                    msg = service.users().messages().get(
                        userId='me',
                        id=message['id'],
                        format=msg_format,
                        metadataHeaders=metadata_headers
                    ).execute()

                    # Extract headers
                    headers = {h['name']: h['value'] for h in msg.get('payload', {}).get('headers', [])}

                    # Parse date
                    date_str = headers.get('Date', '')
                    try:
                        from email.utils import parsedate_to_datetime
                        date_obj = parsedate_to_datetime(date_str)
                        timestamp = int(date_obj.timestamp() * 1000)
                    except:
                        timestamp = int(msg.get('internalDate', 0))

                    sender = headers.get('From', '')
                    subject = headers.get('Subject', '(No Subject)')
                    snippet = msg.get('snippet', '')

                    email_data = {
                        'id': msg['id'],
                        'threadId': msg.get('threadId', ''),
                        'snippet': snippet,
                        'from': sender,
                        'to': headers.get('To', ''),
                        'subject': subject,
                        'date': date_str,
                        'timestamp': timestamp,
                        'isRead': not msg.get('labelIds', []) or 'UNREAD' not in msg.get('labelIds', []),
                        'labels': msg.get('labelIds', []),
                        'sizeEstimate': msg.get('sizeEstimate', 0)
                    }

                    # Generate summary if requested
                    if include_summaries:
                        body_text = extract_email_body(msg) or ''
                        summary = summarize_email(subject, sender, body_text, snippet)
                        email_data['summary'] = summary

                    emails.append(email_data)

                except Exception as e:
                    print(f"Error parsing message {message.get('id', 'unknown')}: {e}")
                    continue

            # Sort by timestamp (most recent first)
            emails.sort(key=lambda x: x['timestamp'], reverse=True)

            self.end_headers()
            response = {
                'success': True,
                'emails': emails,
                'total': len(emails),
                'query': query,
                'maxResults': max_results
            }
            self.wfile.write(json.dumps(response).encode())

        except Exception as e:
            print(f"Error fetching emails: {e}")
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            response = {
                'success': False,
                'error': f'Failed to fetch emails: {str(e)}'
            }
            self.wfile.write(json.dumps(response).encode())

    def handle_send_email(self):
        """Handle sending email via Gmail API"""
        try:
            self.send_header('Content-type', 'application/json')

            # Get stored credentials
            creds = get_stored_credentials()

            if not creds:
                self.end_headers()
                response = {
                    'success': False,
                    'error': 'Not authenticated. Please sign in first.'
                }
                self.wfile.write(json.dumps(response).encode())
                return

            # Get request body
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8'))

            to = data.get('to')
            subject = data.get('subject')
            body = data.get('body')

            if not all([to, subject, body]):
                self.end_headers()
                response = {
                    'success': False,
                    'error': 'Missing required fields: to, subject, body'
                }
                self.wfile.write(json.dumps(response).encode())
                return

            # Build Gmail service
            service = build('gmail', 'v1', credentials=creds)

            # Create RFC 2822 formatted email
            import email.message
            message = email.message.EmailMessage()
            message.set_content(body)
            message['To'] = to
            message['Subject'] = subject

            # Send message
            import base64
            raw_message = base64.urlsafe_b64encode(message.as_bytes()).decode()
            sent_message = service.users().messages().send(
                userId='me',
                body={'raw': raw_message}
            ).execute()

            self.end_headers()
            response = {
                'success': True,
                'message': 'Email sent successfully',
                'id': sent_message['id']
            }
            self.wfile.write(json.dumps(response).encode())

        except Exception as e:
            print(f"Error sending email: {e}")
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            response = {
                'success': False,
                'error': f'Failed to send email: {str(e)}'
            }
            self.wfile.write(json.dumps(response).encode())

    def handle_generate_reply(self):
        """Generate email reply using OpenAI API"""
        try:
            self.send_header('Content-type', 'application/json')

            if not OPENAI_API_KEY:
                self.end_headers()
                response = {'success': False, 'error': 'OPENAI_API_KEY not configured'}
                self.wfile.write(json.dumps(response).encode())
                return

            # Get request body
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8'))

            sender = data.get('sender', '')
            subject = data.get('subject', '')
            body_text = data.get('body_text', '') or ''

            # Load user's name from saved user info
            user_name = None
            if USER_INFO_FILE.exists():
                try:
                    with open(USER_INFO_FILE, 'r') as f:
                        user_info = json.load(f)
                        user_name = user_info.get('name') or user_info.get('given_name')
                except Exception as e:
                    print(f"Error loading user info: {e}")

            # Extract recipient's first name for personalized salutation
            recipient_first_name = extract_name_from_email(sender)

            # Get credentials for fetching recipient-specific emails
            creds = get_stored_credentials()

            # Try to get past emails with this specific recipient first
            recipient_emails = []
            relationship_type = 'neutral'

            if creds:
                # Extract email address from sender string
                import re
                email_match = re.search(r'[\w.+-]+@[\w.-]+\.[a-z]+', sender.lower())
                if email_match:
                    recipient_email = email_match.group(0)
                    recipient_emails = get_emails_with_recipient(creds, recipient_email, count=5)
                    if recipient_emails:
                        print(f"Found {len(recipient_emails)} past emails with {recipient_email}")

                # Detect relationship type
                relationship_type = detect_relationship_type(sender, recipient_emails)

            # Fall back to general sent emails if no recipient-specific ones
            if not recipient_emails:
                recipient_emails = load_cached_sent_emails()

            print(f"Generating reply for: sender={sender[:30]}, subject={subject[:30]}, relationship={relationship_type}")

            # Build context-aware prompt
            if recipient_emails:
                # Use recipient-specific emails as primary examples
                examples = "\n\n---\n\n".join(recipient_emails[:4])

                # Customize instructions based on relationship
                if relationship_type == 'formal':
                    style_instruction = "Use a formal, respectful tone appropriate for academic or professional contexts."
                elif relationship_type == 'casual':
                    style_instruction = "Use a friendly, casual tone - be relaxed and informal."
                else:
                    style_instruction = "Use a professional but approachable tone."

                recipient_name_note = f"\n- Address them as '{recipient_first_name}' or by their preferred name" if recipient_first_name else ""

                prompt = f"""You are {user_name} writing an email reply. STUDY the examples below which are YOUR past emails to THIS SAME PERSON.

CRITICAL: You are {user_name}. The email is FROM them, TO you. Sign with YOUR name ({user_name}), NOT theirs.

INCOMING EMAIL (from them to you):
From: {sender}
Subject: {subject}

{body_text[:1500]}

YOUR PAST EMAILS TO THIS PERSON (your writing style - study tone and format):
{examples}

INSTRUCTIONS:
1. You are {user_name} - sign the email with YOUR NAME, never the recipient's name
2. {style_instruction}
3. Match the writing style from your past emails, but ALWAYS sign as "{user_name}"
4. {f'Address them as "{recipient_first_name}"' if recipient_first_name else 'Use the same salutation style'}
5. NEVER use placeholders like [Your Name], [Your Position], etc.
6. Keep it under 100 words
7. Output ONLY the email reply - no preamble

Now write the reply as {user_name}:"""
            elif user_name:
                prompt = f"""Generate a short, professional reply to this email. Your name is {user_name} - sign the email with this name.

From: {sender}
Subject: {subject}

Email body:
{body_text[:1000]}

Write a concise reply (under 100 words). Be professional and helpful. Sign off with "{user_name}". Do not include any preamble - just provide the reply email text directly."""
            else:
                prompt = f"""Generate a short, professional reply to this email:

From: {sender}
Subject: {subject}

Email body:
{body_text[:1000]}

Write a concise reply (under 100 words). Be professional and helpful. Do not include any preamble - just provide the reply email text directly."""

            messages = [{"role": "user", "content": prompt}]
            reply, error = call_openai_with_retry(messages, max_tokens=300, temperature=0.7, timeout=15)

            if reply:
                print(f"AI reply generated successfully!")
                self.end_headers()
                resp = {'success': True, 'reply': reply}
                self.wfile.write(json.dumps(resp).encode())
            else:
                print(f"Failed to generate reply: {error}")
                self.end_headers()
                resp = {'success': False, 'error': f'Failed to generate reply: {error}'}
                self.wfile.write(json.dumps(resp).encode())

        except Exception as e:
            print(f"Error generating reply: {e}")
            import traceback
            traceback.print_exc()
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            response = {'success': False, 'error': f'Failed to generate reply: {str(e)}'}
            self.wfile.write(json.dumps(response).encode())

    def handle_edit_reply(self):
        """Edit an email reply using AI based on user's edit prompt"""
        try:
            self.send_header('Content-type', 'application/json')

            if not OPENAI_API_KEY:
                self.end_headers()
                response = {'success': False, 'error': 'OPENAI_API_KEY not configured'}
                self.wfile.write(json.dumps(response).encode())
                return

            # Get request body
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8'))

            current_reply = data.get('current_reply', '')
            edit_prompt = data.get('edit_prompt', '')

            if not current_reply or not edit_prompt:
                self.end_headers()
                response = {'success': False, 'error': 'Missing current_reply or edit_prompt'}
                self.wfile.write(json.dumps(response).encode())
                return

            print(f"AI editing reply with prompt: {edit_prompt[:50]}...")

            prompt = f"""You are editing an email draft based on the user's instructions.

CURRENT EMAIL DRAFT:
{current_reply}

USER'S EDIT INSTRUCTIONS:
{edit_prompt}

Edit the email draft according to the user's instructions. Keep the same general meaning but apply the requested changes. Output ONLY the edited email text - no preamble, no explanations."""

            messages = [{"role": "user", "content": prompt}]
            edited_reply, error = call_openai_with_retry(messages, max_tokens=500, temperature=0.7, timeout=15)

            if edited_reply:
                print(f"AI edit completed successfully!")
                self.end_headers()
                resp = {'success': True, 'edited_reply': edited_reply}
                self.wfile.write(json.dumps(resp).encode())
            else:
                print(f"Failed to edit reply: {error}")
                self.end_headers()
                resp = {'success': False, 'error': f'Failed to edit reply: {error}'}
                self.wfile.write(json.dumps(resp).encode())

        except Exception as e:
            print(f"Error editing reply: {e}")
            import traceback
            traceback.print_exc()
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            response = {'success': False, 'error': f'Failed to edit reply: {str(e)}'}
            self.wfile.write(json.dumps(response).encode())

    def handle_summarize(self):
        """Generate email summary using OpenAI API"""
        try:
            self.send_header('Content-type', 'application/json')

            if not OPENAI_API_KEY:
                self.end_headers()
                response = {'success': False, 'error': 'OPENAI_API_KEY not configured'}
                self.wfile.write(json.dumps(response).encode())
                return

            # Get request body
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8'))

            sender = data.get('sender', '')
            subject = data.get('subject', '')
            body_text = data.get('body_text', '')
            snippet = data.get('snippet', '')

            print(f"Generating summary for email from {sender[:30]}...")

            # Generate summary
            summary = summarize_email(subject, sender, body_text, snippet)

            if summary:
                self.end_headers()
                resp = {'success': True, 'summary': summary}
                self.wfile.write(json.dumps(resp).encode())
            else:
                self.end_headers()
                resp = {'success': False, 'error': 'Failed to generate summary'}
                self.wfile.write(json.dumps(resp).encode())

        except Exception as e:
            print(f"Error generating summary: {e}")
            import traceback
            traceback.print_exc()
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            response = {'success': False, 'error': f'Failed to generate summary: {str(e)}'}
            self.wfile.write(json.dumps(response).encode())

    def log_message(self, format_str, *args):
        """Suppress server log messages"""
        pass

def get_stored_credentials():
    """Get stored credentials if they exist and are valid"""
    if TOKEN_FILE.exists():
        with open(TOKEN_FILE, 'rb') as token:
            creds = pickle.load(token)
            if creds.valid and not creds.expired:
                return creds
            elif creds.expired and creds.refresh_token:
                try:
                    creds.refresh(Request())
                    with open(TOKEN_FILE, 'wb') as token_file:
                        pickle.dump(creds, token_file)
                    return creds
                except Exception as e:
                    print(f"Error refreshing token: {e}")
    return None

def start_oauth_server():
    """Start the OAuth server in a separate thread"""
    # Find available port starting from 8081
    import socket
    port = 8081
    while port < 8090:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(('localhost', port))
                break
        except OSError:
            port += 1

    server = HTTPServer(('localhost', port), OAuthHandler)
    print(f"OAuth server started on http://localhost:{port}")
    return server, port

if __name__ == '__main__':
    server, port = start_oauth_server()
    try:
        print(f"OAuth server running on http://localhost:{port}")
        print("Press Ctrl+C to stop the server")
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nOAuth server stopped")
    finally:
        server.server_close()