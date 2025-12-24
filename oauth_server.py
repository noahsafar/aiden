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

# AI API Keys
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')

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
                    # Get full message details
                    msg = service.users().messages().get(
                        userId='me',
                        id=message['id'],
                        format='metadata',
                        metadataHeaders=['From', 'To', 'Subject', 'Date', 'Snippet']
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

                    email_data = {
                        'id': msg['id'],
                        'threadId': msg.get('threadId', ''),
                        'snippet': msg.get('snippet', ''),
                        'from': headers.get('From', ''),
                        'to': headers.get('To', ''),
                        'subject': headers.get('Subject', '(No Subject)'),
                        'date': date_str,
                        'timestamp': timestamp,
                        'isRead': not msg.get('labelIds', []) or 'UNREAD' not in msg.get('labelIds', []),
                        'labels': msg.get('labelIds', []),
                        'sizeEstimate': msg.get('sizeEstimate', 0)
                    }
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

            print(f"Generating reply for: sender={sender[:30]}, subject={subject[:30]}")

            # Call OpenAI API
            import requests
            api_key = OPENAI_API_KEY.strip()

            prompt = f"""Generate a short, professional reply to this email:

From: {sender}
Subject: {subject}

Email body:
{body_text[:1000]}

Write a concise reply (under 100 words). Be professional and helpful. Do not include any preamble - just provide the reply email text directly."""

            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}"
            }

            body = {
                "model": "gpt-4o-mini",
                "messages": [
                    {"role": "user", "content": prompt}
                ],
                "max_tokens": 300,
                "temperature": 0.7
            }

            response = requests.post(
                "https://api.openai.com/v1/chat/completions",
                headers=headers,
                json=body,
                timeout=15
            )

            if response.status_code == 200:
                result = response.json()
                reply = result['choices'][0]['message']['content'].strip()
                print(f"AI reply generated successfully!")
                self.end_headers()
                resp = {'success': True, 'reply': reply}
                self.wfile.write(json.dumps(resp).encode())
            else:
                print(f"OpenAI API error {response.status_code}: {response.text[:200]}")
                self.end_headers()
                resp = {'success': False, 'error': f'API error: {response.text[:200]}'}
                self.wfile.write(json.dumps(resp).encode())

        except Exception as e:
            print(f"Error generating reply: {e}")
            import traceback
            traceback.print_exc()
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            response = {'success': False, 'error': f'Failed to generate reply: {str(e)}'}
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