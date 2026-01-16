#!/usr/bin/env python3
"""
Python OAuth Server for Tauri Aiden App
Uses the same working OAuth flow as the original aiden-ai implementation
"""
import json
import os
import pickle
import webbrowser
import html
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
import threading
import time
import queue
import asyncio
from concurrent.futures import ThreadPoolExecutor

from dotenv import load_dotenv
load_dotenv()

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

# OAuth Scopes for Gmail and Calendar access
SCOPES = [
    'openid',  # Add at beginning - Google adds this automatically
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/calendar.events',
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
MAX_RETRIES = 0  # No retries - immediately fall back to Ollama on rate limit
INITIAL_RETRY_DELAY = 5  # seconds

# Request queue and rate limiter to prevent concurrent API calls
class RateLimiter:
    """Rate limiter for OpenAI API calls - ensures requests are spaced out"""
    def __init__(self, min_delay=3.0):
        self.min_delay = min_delay  # Minimum seconds between requests
        self.last_call_time = 0
        self.lock = threading.Lock()

    def wait_if_needed(self):
        """Wait if needed to respect rate limit"""
        with self.lock:
            current_time = time.time()
            time_since_last = current_time - self.last_call_time
            if time_since_last < self.min_delay:
                wait_time = self.min_delay - time_since_last
                print(f"Rate limiter: waiting {wait_time:.1f}s before API call")
                time.sleep(wait_time)
            self.last_call_time = time.time()

# Global rate limiter
# 5 seconds between calls = 12 calls/minute max, well under free tier limits
rate_limiter = RateLimiter(min_delay=5.0)


def call_ollama(messages, max_tokens=300, timeout=60):
    """Call local Ollama API as fallback"""
    import requests

    # Convert OpenAI message format to Ollama format
    prompt = ""
    for msg in messages:
        if msg['role'] == 'system':
            prompt += f"System: {msg['content']}\n"
        elif msg['role'] == 'user':
            prompt += f"User: {msg['content']}\n"
        elif msg['role'] == 'assistant':
            prompt += f"Assistant: {msg['content']}\n"

    prompt += "Assistant: "

    try:
        response = requests.post(
            "http://localhost:11434/api/generate",
            json={
                "model": "llama3.1",
                "prompt": prompt,
                "stream": False,
                "options": {
                    "num_predict": max_tokens,
                    "temperature": 0.7
                }
            },
            timeout=timeout
        )

        if response.status_code == 200:
            result = response.json()
            return result.get('response', '').strip(), None
        else:
            return None, f"Ollama error: {response.text[:200]}"
    except requests.exceptions.ConnectionError:
        return None, "Ollama not running. Install with: brew install ollama && ollama run llama3.1"
    except Exception as e:
        return None, f"Ollama error: {str(e)}"


def call_openai_with_retry(messages, max_tokens=300, temperature=0.7, timeout=15, use_ollama_fallback=True):
    """Call OpenAI API with exponential backoff retry on rate limit (429) errors.
    Falls back to Ollama if OpenAI fails and use_ollama_fallback is True."""
    import requests

    if not OPENAI_API_KEY:
        if use_ollama_fallback:
            print("OpenAI not configured, using Ollama fallback...")
            return call_ollama(messages, max_tokens=max_tokens, timeout=timeout)
        return None, "OPENAI_API_KEY not configured"

    # Wait before making the API call to respect rate limits
    rate_limiter.wait_if_needed()

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
        try:
            response = requests.post(
                "https://api.openai.com/v1/chat/completions",
                headers=headers,
                json=body,
                timeout=timeout
            )
        except requests.exceptions.Timeout:
            print(f"OpenAI request timed out after {timeout}s")
            # Fall back to Ollama on timeout
            if use_ollama_fallback:
                print("Falling back to Ollama...")
                return call_ollama(messages, max_tokens=max_tokens, timeout=60)
            return None, f"OpenAI request timed out after {timeout}s"
        except requests.exceptions.RequestException as e:
            print(f"OpenAI request error: {e}")
            # Fall back to Ollama on network errors
            if use_ollama_fallback:
                print("Falling back to Ollama...")
                return call_ollama(messages, max_tokens=max_tokens, timeout=60)
            return None, f"OpenAI request error: {str(e)}"

        if response.status_code == 200:
            result = response.json()
            return result['choices'][0]['message']['content'].strip(), None
        elif response.status_code == 429:
            retry_count += 1
            if retry_count > MAX_RETRIES:
                error_msg = response.text
                print(f"OpenAI rate limit exceeded after {MAX_RETRIES} retries")

                # Fall back to Ollama
                if use_ollama_fallback:
                    print("Falling back to Ollama...")
                    return call_ollama(messages, max_tokens=max_tokens, timeout=60)
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
            # Reset rate limiter after waiting for retry to avoid double-waiting
            rate_limiter.last_call_time = time.time()
            delay *= 2  # Exponential backoff
        else:
            # On other errors, try Ollama fallback
            if use_ollama_fallback:
                print(f"OpenAI API error {response.status_code}, falling back to Ollama...")
                return call_ollama(messages, max_tokens=max_tokens, timeout=60)
            return None, f"API error {response.status_code}: {response.text[:200]}"

    return None, "Max retries exceeded"


def decode_html_entities(text):
    """Decode HTML entities like &#39; to actual characters"""
    if not text:
        return text
    return html.unescape(text)


def extract_email_body(message):
    """Extract plain text body from Gmail message"""
    try:
        payload = message.get('payload', {})

        def find_text(part):
            if part.get('mimeType') == 'text/plain':
                data = part.get('body', {}).get('data', '')
                if data:
                    import base64
                    decoded = base64.urlsafe_b64decode(data).decode('utf-8', errors='ignore')
                    return decode_html_entities(decoded)
            for subpart in part.get('parts', []):
                result = find_text(subpart)
                if result:
                    return result
            return None

        # Check main body first
        body_data = payload.get('body', {}).get('data', '')
        if body_data:
            import base64
            return decode_html_entities(base64.urlsafe_b64decode(body_data).decode('utf-8', errors='ignore'))

        # Check parts
        parts = payload.get('parts', [])
        for part in parts:
            result = find_text(part)
            if result:
                return decode_html_entities(result)

        return None
    except Exception as e:
        print(f"Error extracting body: {e}")
        return None


def extract_attachments(message):
    """Extract attachment information from Gmail message"""
    try:
        attachments = []
        payload = message.get('payload', {})

        def extract_from_parts(parts):
            for part in parts:
                # Check if this part is an attachment (has filename or attachmentId)
                body = part.get('body', {})
                filename = part.get('filename', '')
                attachment_id = body.get('attachmentId')
                mime_type = part.get('mimeType', '')
                size = body.get('size', 0)

                # It's an attachment if it has a filename and is not inline (no Content-ID)
                headers = part.get('headers', [])
                has_content_id = any(
                    h['name'].lower() == 'content-id'
                    for h in headers
                )

                if filename and not has_content_id:
                    attachments.append({
                        'id': attachment_id or '',
                        'filename': filename,
                        'mimeType': mime_type,
                        'size': size
                    })

                # Recurse into nested parts
                if 'parts' in part:
                    extract_from_parts(part['parts'])

        # Start extraction from root payload
        if 'parts' in payload:
            extract_from_parts(payload['parts'])

        return attachments
    except Exception as e:
        print(f"Error extracting attachments: {e}")
        return []


def extract_email_body_html(message, service=None):
    """Extract HTML body from Gmail message and convert inline images to base64"""
    try:
        import base64
        import re

        payload = message.get('payload', {})
        message_id = message.get('id')

        # First, collect ALL inline images (attachments with Content-ID)
        inline_images = {}
        attachments_to_fetch = []  # Store (content_id, attachment_id, mime_type) tuples

        def collect_images(part, path=None):
            """Recursively collect all inline images"""
            if path is None:
                path = []

            # Check if this part has a Content-ID (inline image)
            headers = part.get('headers', [])
            content_id = None
            for header in headers:
                if header['name'].lower() == 'content-id':
                    content_id = header['value']
                    # Strip angle brackets if present
                    if content_id.startswith('<') and content_id.endswith('>'):
                        content_id = content_id[1:-1]
                    break

            if content_id:
                # This is an inline image
                body_data = part.get('body', {}).get('data', '')
                attachment_id = part.get('body', {}).get('attachmentId')
                mime_type = part.get('mimeType', 'image/png')

                if body_data:
                    try:
                        decoded = base64.urlsafe_b64decode(body_data)
                        inline_images[content_id] = f"data:{mime_type};base64,{base64.b64encode(decoded).decode('ascii')}"
                        print(f"Decoded inline image: {content_id}, size: {len(decoded)} bytes")
                    except Exception as e:
                        print(f"Error decoding inline image data: {e}")
                elif attachment_id:
                    # For large attachments, store for later retrieval
                    attachments_to_fetch.append((content_id, attachment_id, mime_type))

            # Recurse into subparts
            for subpart in part.get('parts', []):
                collect_images(subpart)

        collect_images(payload)

        print(f"Found {len(inline_images)} inline images, {len(attachments_to_fetch)} need fetching")

        # Fetch large attachments if we have a service and message_id
        if service and message_id and attachments_to_fetch:
            for content_id, attachment_id, mime_type in attachments_to_fetch:
                try:
                    attachment = service.users().messages().attachments().get(
                        userId='me',
                        messageId=message_id,
                        id=attachment_id
                    ).execute()
                    data = attachment.get('data', '')
                    if data:
                        decoded = base64.urlsafe_b64decode(data)
                        inline_images[content_id] = f"data:{mime_type};base64,{base64.b64encode(decoded).decode('ascii')}"
                        print(f"Fetched inline image: {content_id}, size: {len(decoded)} bytes")
                except Exception as e:
                    print(f"Error fetching attachment {attachment_id}: {e}")

        def find_html(part):
            if part.get('mimeType') == 'text/html':
                data = part.get('body', {}).get('data', '')
                if data:
                    decoded = base64.urlsafe_b64decode(data).decode('utf-8', errors='ignore')
                    return decoded
            for subpart in part.get('parts', []):
                result = find_html(subpart)
                if result:
                    return result
            return None

        # Check main body first
        body_data = payload.get('body', {}).get('data', '')
        html_content = None
        if body_data and payload.get('mimeType') == 'text/html':
            html_content = base64.urlsafe_b64decode(body_data).decode('utf-8', errors='ignore')
        else:
            # Check parts
            parts = payload.get('parts', [])
            for part in parts:
                result = find_html(part)
                if result:
                    html_content = result
                    break

        if not html_content:
            print("No HTML content found in email")
            return None

        print(f"Extracted HTML content, length: {len(html_content)}")

        # Replace cid: references with base64 data URLs
        def replace_cid(match):
            cid = match.group(1)
            if cid in inline_images:
                return inline_images[cid]
            # Try with angle brackets
            cid_bracketed = f"<{cid}>"
            if cid_bracketed in inline_images:
                return inline_images[cid_bracketed]
            return match.group(0)  # Return original if not found

        # Replace various cid: formats found in emails
        # Format 1: src="cid:..."
        html_content = re.sub(r'src=["\']cid:([^"\']+)["\']', lambda m: f'src="{replace_cid(m)}"' if replace_cid(m) != m.group(0) else m.group(0), html_content)
        # Format 2: src=cid:... (no quotes)
        html_content = re.sub(r'src=cid:([^\s>]+)', lambda m: f'src="{replace_cid(m)}"' if replace_cid(m) != m.group(0) else m.group(0), html_content)
        # Format 3: standalone cid:... references
        html_content = re.sub(r'cid:([^"\s>]+)', replace_cid, html_content)

        print(f"Replaced CID references, inline_images keys: {list(inline_images.keys())}")

        return html_content
    except Exception as e:
        print(f"Error extracting HTML body: {e}")
        import traceback
        traceback.print_exc()
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


def clean_reply(reply):
    """Remove subject lines and other unwanted patterns from AI-generated replies"""
    if not reply:
        return reply

    import re

    # Remove lines that look like subject lines at the beginning
    lines = reply.split('\n')
    while lines:
        first_line = lines[0].strip()

        # Patterns that indicate we should skip this line
        skip_patterns = [
            r'^subject:\s*',
            r'^re:\s*',
            r'^fw:\s*',
            r'^from:\s*',
            r'^to:\s*',
            r'^date:\s*',
            r'^cc:\s*',
            r'^bcc:\s*',
        ]

        should_skip = False
        for pattern in skip_patterns:
            if re.match(pattern, first_line, re.IGNORECASE):
                should_skip = True
                break

        # Also skip if it's just the subject repeated (e.g., "Re: Pizza")
        # and the next line looks like a proper salutation
        if not should_skip and len(lines) > 1:
            if (first_line.startswith('Re:') or first_line.startswith('FW:')) and \
               len(first_line) < 100 and \
               any(lines[1].strip().lower().startswith(s) for s in ['hi ', 'hey ', 'dear ', 'hello ', 'hello,']):
                should_skip = True

        if should_skip:
            lines.pop(0)
        else:
            break

    return '\n'.join(lines).strip()


def clean_summary(summary):
    """Remove common preamble phrases from AI-generated summaries"""
    if not summary:
        return summary

    # Common preamble patterns to remove - be very aggressive
    preamble_patterns = [
        r"^here['']?s?\s+(a\s+)?(concise\s+)?(brief\s+)?(one\s+)?sentence\s+summarizing[:\s]*",
        r"^here['']?s?\s+(a\s+)?(concise\s+)?(brief\s+)?summary[:\s]*",
        r"^here['']?s?\s+a\s+concise\s+sentence\s+summarizing",
        r"^summary[:\s]*",
        r"^the\s+email\s+(can\s+be\s+)?summarized\s+(as\s+follows)?[:\s]*",
        r"^in\s+(this\s+email|summary)[:\s]*",
        r"^this\s+email\s+(is\s+about|says|conveys)[:\s]*",
        r"^(the\s+)?(main\s+)?(point|gist|essence)(\s+of\s+the\s+email)?(\s+is)?[:\s]*",
        r"^quick\s+summary[:\s]*",
        r"^below\s+(is\s+)?(a\s+)?summary[:\s]*",
        r"^this\s+(email\s+)?can\s+be\s+summarized",
        r"^the\s+summary\s+(is|of)",
        r"^this\s+(email|message)\s+(can be )?summar",
        r"^to\s+summarize[:\s]*",
        r"^in\s+summary[:\s]*",
        r"^briefly[:\s]*",
        r"^summary\s+of\s+the\s+email",
    ]

    import re
    cleaned = summary
    for pattern in preamble_patterns:
        cleaned = re.sub(pattern, '', cleaned, flags=re.IGNORECASE)

    # Clean up any leading/trailing whitespace and capitalize first letter
    cleaned = cleaned.strip()
    if cleaned:
        cleaned = cleaned[0].upper() + cleaned[1:] if len(cleaned) > 1 else cleaned.upper()

    return cleaned


def summarize_email(subject, sender, body_text, snippet=""):
    """Generate a concise summary of an email using OpenAI or Ollama"""
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
            # Clean up any preamble phrases
            cleaned_summary = clean_summary(summary)
            print(f"Email summary generated: {cleaned_summary[:50]}...")
            return cleaned_summary
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

        if self.path == '/health' or self.path == '/health/':
            # Health check endpoint
            self.end_headers()
            self.wfile.write(json.dumps({'status': 'ok', 'service': 'oauth-server'}).encode())
        elif self.path.startswith('/auth'):
            self.handle_auth()
        elif self.path.startswith('/callback'):
            self.handle_callback()
        elif self.path.startswith('/emails'):
            self.handle_emails()
        elif self.path.startswith('/calendar'):
            self.handle_calendar()
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
        elif self.path.startswith('/analyze-email'):
            self.handle_analyze_email()
        elif self.path.startswith('/generate-reply'):
            self.handle_generate_reply()
        elif self.path.startswith('/edit-reply'):
            self.handle_edit_reply()
        elif self.path.startswith('/summarize'):
            self.handle_summarize()
        elif self.path.startswith('/calendar'):
            self.handle_calendar()
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

            # Fetch messages - always use 'full' format to get body content
            results = service.users().messages().list(
                userId='me',
                maxResults=max_results,
                q=query
            ).execute()

            messages = results.get('messages', [])

            emails = []
            for message in messages:
                try:
                    # Always get full message to extract body content
                    msg = service.users().messages().get(
                        userId='me',
                        id=message['id'],
                        format='full'
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
                    snippet = decode_html_entities(msg.get('snippet', ''))

                    # Extract attachments from the message
                    attachments = extract_attachments(msg)
                    has_attachments = len(attachments) > 0

                    email_data = {
                        'id': msg['id'],
                        'threadId': msg.get('threadId', ''),
                        'snippet': snippet,
                        'from': sender,
                        'to': headers.get('To', ''),
                        'subject': decode_html_entities(subject),
                        'date': date_str,
                        'timestamp': timestamp,
                        'isRead': not msg.get('labelIds', []) or 'UNREAD' not in msg.get('labelIds', []),
                        'labels': msg.get('labelIds', []),
                        'sizeEstimate': msg.get('sizeEstimate', 0),
                        'hasAttachments': has_attachments,
                        'attachments': attachments
                    }

                    # Always extract body content (both text and HTML)
                    body_text = extract_email_body(msg) or ''
                    body_html = extract_email_body_html(msg, service) or ''
                    email_data['bodyText'] = body_text
                    email_data['bodyHtml'] = body_html

                    # Generate summary if requested
                    if include_summaries:
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
            in_reply_to = data.get('inReplyTo')  # Gmail message ID we're replying to

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

            # Create RFC 2822 formatted email with threading headers
            import email.message
            message = email.message.EmailMessage()
            message.set_content(body)
            message['To'] = to
            message['Subject'] = subject

            # Add threading headers if replying to an existing email
            if in_reply_to:
                # Get the original message to fetch References header
                try:
                    original_msg = service.users().messages().get(
                        userId='me',
                        id=in_reply_to,
                        format='metadata',
                        metadataHeaders=['Message-ID', 'References', 'Subject']
                    ).execute()

                    # Set In-Reply-To header
                    msg_id_header = None
                    for header in original_msg.get('payload', {}).get('headers', []):
                        if header['name'] == 'Message-ID':
                            msg_id_header = header['value']
                            break

                    if msg_id_header:
                        message['In-Reply-To'] = msg_id_header

                    # Set References header for proper threading
                    references_header = None
                    for header in original_msg.get('payload', {}).get('headers', []):
                        if header['name'] == 'References':
                            references_header = header['value']
                            break

                    if references_header:
                        # Append the current message ID to References
                        message['References'] = references_header
                    else:
                        # If no References header, use the Message-ID
                        message['References'] = msg_id_header

                    print(f"Threading headers added: In-Reply-To={msg_id_header}, References={message['References']}")
                except Exception as e:
                    print(f"Warning: Could not fetch original message for threading: {e}")

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

    def handle_analyze_email(self):
        """Analyze email to extract questions that need user input and suggest formality level"""
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8'))

            sender = data.get('sender', '')
            subject = data.get('subject', '')
            body_text = data.get('body_text', '') or ''

            if not OPENAI_API_KEY:
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'success': False, 'error': 'OPENAI_API_KEY not configured'}).encode())
                return

            # Get past emails with this sender to determine relationship formality
            creds = get_stored_credentials()
            recipient_emails = []
            if creds:
                import re
                email_match = re.search(r'[\w.+-]+@[\w.-]+\.[a-z]+', sender.lower())
                if email_match:
                    recipient_email = email_match.group(0)
                    recipient_emails = get_emails_with_recipient(creds, recipient_email, count=3)

            # Build context from past emails for formality detection
            past_context = ""
            if recipient_emails:
                past_context = "\n\nPast emails with this person (for tone reference):\n" + "\n---\n".join(recipient_emails[:2])

            # Look for common question patterns in the text as a fallback
            text_lower = body_text[:1500].lower()
            has_question_mark = '?' in text_lower
            has_or = ' or ' in text_lower
            has_food_keywords = any(word in text_lower for word in ['lunch', 'dinner', 'food', 'order', 'pizza', 'burger', 'sandwich', 'sushi', 'coffee', 'tea'])

            # SIMPLE RULE-BASED EXTRACTION AS FALLBACK (works for common patterns)
            rule_based_questions = []
            import re as regex_module

            # Extract ALL "X or Y" patterns with question marks - more comprehensive
            # Pattern 1: "X or Y?" where X and Y are single words
            simple_or_pattern = regex_module.search(r'\b([a-z]+)\s+or\s+([a-z]+)\?', body_text, regex_module.IGNORECASE)
            if simple_or_pattern:
                option1 = simple_or_pattern.group(1).strip().capitalize()
                option2 = simple_or_pattern.group(2).strip().capitalize()
                # Generate a contextual question
                if has_food_keywords:
                    question_text = "What would you like?"
                else:
                    question_text = f"Which would you prefer: {option1} or {option2}?"
                rule_based_questions.append({
                    "type": "choice",
                    "question": question_text,
                    "options": [option1, option2]
                })

            # Pattern 2: "Do you want X or Y?"
            want_or_pattern = regex_module.search(r'(do you want|would you like|want|prefer|choose)\s+(.+) or (.+?)\?', body_text, regex_module.IGNORECASE)
            if want_or_pattern and not simple_or_pattern:
                option1 = want_or_pattern.group(2).strip().capitalize()
                option2 = want_or_pattern.group(3).strip().capitalize()
                rule_based_questions.append({
                    "type": "choice",
                    "question": f"What would you like?",
                    "options": [option1, option2]
                })

            # Pattern 3: Multiple items like "tea, coffee, or water?"
            list_or_pattern = regex_module.search(r'(.+?),\s*(.+?)\s+or\s+(.+?)\?', body_text, regex_module.IGNORECASE)
            if list_or_pattern and not rule_based_questions:
                option1 = list_or_pattern.group(1).strip().capitalize()
                option2 = list_or_pattern.group(2).strip().capitalize()
                option3 = list_or_pattern.group(3).strip().capitalize()
                rule_based_questions.append({
                    "type": "choice",
                    "question": "Which would you like?",
                    "options": [option1, option2, option3]
                })

            # Pattern 4: Yes/No questions - more comprehensive patterns
            yes_no_patterns = [
                r'(can you|could you|will you|would you|are you|is it|is this|do you)\s+(.+?)\?',
                r'(should i|shall i|shall we)\s+(.+?)\?',
            ]
            for pattern in yes_no_patterns:
                match = regex_module.search(pattern, body_text, regex_module.IGNORECASE)
                if match and not rule_based_questions:
                    question_text = match.group(0).strip()
                    # Only add if it's a real yes/no question, not open-ended
                    open_triggers = ['what', 'when', 'where', 'how', 'why', 'which', 'who', 'whose']
                    if not any(trigger in question_text.lower() for trigger in open_triggers):
                        rule_based_questions.append({
                            "type": "choice",
                            "question": question_text[:100] + "?" if len(question_text) > 100 else question_text,
                            "options": ["Yes", "No"]
                        })

            # Pattern 5: Time/day questions with "or" - "Monday or Tuesday?"
            day_time_pattern = regex_module.search(r'(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|morning|afternoon|evening)\s+or\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|morning|afternoon|evening)', body_text, regex_module.IGNORECASE)
            if day_time_pattern and not rule_based_questions:
                option1 = day_time_pattern.group(1).strip().capitalize()
                option2 = day_time_pattern.group(2).strip().capitalize()
                rule_based_questions.append({
                    "type": "choice",
                    "question": "Which works better for you?",
                    "options": [option1, option2]
                })

            # Pattern 6: Explicit "What X or Y?" without question mark but implied
            what_or_pattern = regex_module.search(r'what\s+(.+) or (.+)', body_text, regex_module.IGNORECASE)
            if what_or_pattern and not rule_based_questions:
                option1 = what_or_pattern.group(1).strip().capitalize()
                option2 = what_or_pattern.group(2).strip().capitalize()
                rule_based_questions.append({
                    "type": "choice",
                    "question": f"What do you {what_or_pattern.group(1)}?",
                    "options": [option1, option2]
                })

            # Pattern 7: "A or B" in food context (even without ?)
            if has_food_keywords and has_or and not rule_based_questions:
                food_options = regex_module.findall(r'\b(pizza|burger|sandwich|sushi|salad|pasta|tacos|chinese|indian|thai|coffee|tea)\b', body_text, regex_module.IGNORECASE)
                if len(food_options) >= 2:
                    # Get unique options preserving order
                    seen = set()
                    unique_options = []
                    for opt in food_options:
                        opt_lower = opt.lower()
                        if opt_lower not in seen:
                            seen.add(opt_lower)
                            unique_options.append(opt.capitalize())
                            if len(unique_options) >= 3:
                                break
                    if len(unique_options) >= 2:
                        rule_based_questions.append({
                            "type": "choice",
                            "question": "What would you like?",
                            "options": unique_options
                        })

            prompt = f"""You are analyzing an email to extract questions that need user input. Be VERY thorough and aggressive in finding questions.

Email from: {sender}
Subject: {subject}

Email body:
{body_text[:1500]}
{past_context}

CRITICAL - Find ANY question that requires the recipient to respond:
1. Questions ending with "?" - ALL of them are questions requiring input
2. "X or Y" patterns - ALWAYS extract both X and Y as options
3. "Do you want/like/prefer X or Y?" - choice question
4. "Can you/will you/are you X?" - yes/no question
5. "What/When/Where/How/Who/Why" questions - text input (unless they give options)

Return JSON with:
- "questions": array of questions. Each has:
  - type: "choice" if options are provided OR if yes/no question, "text" for open-ended
  - question: the exact question being asked
  - options: array of choices (ONLY if the email provides specific options)
- "requires_reply": true if the email needs a response, false if it's just informational/FYI
- "reply_reasoning": brief explanation (max 15 words) of why a reply is or isn't needed

DETAILED EXAMPLES (learn from these):

Choice questions (with 2+ options):
- "We're ordering pizza or burgers?" -> {{"type": "choice", "question": "What do you want for lunch?", "options": ["Pizza", "Burgers"]}}
- "Pizza or burgers for lunch?" -> {{"type": "choice", "question": "What would you like for lunch?", "options": ["Pizza", "Burgers"]}}
- "Do you want tea or coffee?" -> {{"type": "choice", "question": "What would you like to drink?", "options": ["Tea", "Coffee"]}}
- "Can you make it Monday or Tuesday?" -> {{"type": "choice", "question": "Which day works better?", "options": ["Monday", "Tuesday"]}}
- "Morning or afternoon?" -> {{"type": "choice", "question": "Which do you prefer?", "options": ["Morning", "Afternoon"]}}
- "Are you coming?" -> {{"type": "choice", "question": "Are you coming?", "options": ["Yes", "No"]}}
- "Can you make it?" -> {{"type": "choice", "question": "Can you make it?", "options": ["Yes", "No"]}}
- "Should I bring X or Y?" -> {{"type": "choice", "question": "Which would you prefer?", "options": ["X", "Y"]}}

Text input questions (no specific options given):
- "When are you free?" -> {{"type": "text", "question": "When are you free?", "options": []}}
- "What time works for you?" -> {{"type": "text", "question": "What time works for you?", "options": []}}
- "Where should we meet?" -> {{"type": "text", "question": "Where should we meet?", "options": []}}
- "What's your address?" -> {{"type": "text", "question": "What's your address?", "options": []}}
- "How many people?" -> {{"type": "text", "question": "How many people?", "options": []}}

IMPORTANT DISTINCTIONS:
- If email says "X or Y" -> it's a CHOICE question with those options
- If email asks "Can you X?" without options -> it's a CHOICE with Yes/No
- If email asks "When/Where/What/How" without specific options -> it's TEXT input
- "Do you want X or Y?" -> CHOICE with X and Y as options
- "Are you available?" -> CHOICE with Yes/No

**REPLY REQUIRED DETERMINATION:**

FIRST CHECK - Sender patterns (set requires_reply = false):
- Newsletter indicators in sender: "newsletter@", "news@", "digest@", "updates@", "notifications@"
- Newsletter indicators in subject: "[Newsletter]", "Digest", "Weekly Update", "Daily Briefing"
- Mailing list patterns: "googlegroups.com", "yahoogroups.com", "groups.google.com", "+owner@"
- No-reply addresses: "noreply@", "no-reply@", "donotreply@", "noreply@"
- Automated services: "support@", "bot@", "automation@", "notification@"
- Common newsletters: "Substack", "Medium Daily", "Hacker Newsletter", "The Information"

SECOND CHECK - Explicit "no reply needed" phrases (set requires_reply = false):
- "No need to respond", "No need to reply", "No reply needed"
- "Don't worry about replying", "No need to get back to me"
- "Just keeping you in the loop", "For your information", "FYI only"
- "Just wanted to say hi", "Just saying hi", "Just wanted to share"
- "Nothing to reply to", "No action required"
- "For your records", "Just a heads up", "You're receiving this because"

THIRD CHECK - Subject line patterns (set requires_reply = false):
- "Invitation to", "Calendar notification", "Booking confirmation"
- "Your order", "Receipt", "Purchase confirmation", "Payment received"
- "Shipping confirmation", "Delivery update", "Your package"
- "Password reset", "Verification code", "Your security code"
- "Welcome to", "Getting started", "Your account is ready"
- "[Automated]", "[Auto-reply]", "Out of Office", "OOO"

FOURTH CHECK - Content patterns (set requires_reply = false):
- Unsubscribe links at bottom ("unsubscribe", "manage preferences")
- "View in browser", "View this email in your browser"
- "You're receiving this email because you subscribed"
- "This email was sent to", "Sent on behalf of"
- Lots of HTML/links with minimal personal content
- Generic greetings with no personal questions ("Hi everyone", "Dear subscriber")

FIFTH CHECK - NOW set requires_reply = true if:
- Contains direct questions to recipient (What, When, Where, How, Can you, Will you)
- Requests a meeting/call with the recipient specifically
- Asks for confirmation, approval, or decision from recipient
- Asks for information, documents, or files from recipient
- "Looking forward to hearing from you", "Please let me know", "Keep me posted"
- Invites you specifically to something
- Personally addressed with specific action needed

Set requires_reply = false if:
- Pure informational updates with no questions asked
- Auto-generated confirmations, receipts, notifications
- Marketing emails, newsletters, digests
- "For your records" emails

Also detect formality as a score from 0 (very casual) to 100 (very formal):
Consider these indicators:
CASUAL (0-30): "hey", "hi", "haha", "lol", "omg", emojis like 😂👍, exclamation points!!!, short sentences, missing punctuation, all lowercase, slang like "gonna", "wanna", "kinda", abbreviations like "u", "ur", "thx"
NEUTRAL (31-70): normal punctuation, standard greetings, complete sentences but not overly formal, standard business language
FORMAL (71-100): "Dear", "Sincerely", "Regards", "Best regards", proper salutations, full proper sentences, indentations, numbered lists, "would you kindly", "I am writing to", "please note that"

ALSO consider past emails sent to this person - if you typically use a certain tone with them, recommend staying consistent. Match their energy!

Return "suggested_formality_score" as a number from 0 to 100.

MEETING REQUEST DETECTION:
Check if this email is requesting a meeting/call. Return a "meeting_request" object with:
- "is_meeting": true if this email requests a meeting, call, sync, or get-together
- "proposed_times": array of time mentions found (e.g., "Tuesday", "2pm", "next week")
- "duration_minutes": estimated duration if mentioned (default 60)
- "attendees": list of email addresses found in the email besides the recipient
- "subject": the meeting subject/topic

If there are genuinely NO questions requiring a response (pure informational email), return {{"questions": [], "requires_reply": false, "reply_reasoning": "Informational - no action needed", "suggested_formality_score": 50, "meeting_request": {{"is_meeting": false}}}}.

Return ONLY valid JSON, no other text or explanation."""

            messages = [{"role": "user", "content": prompt}]
            result, error = call_openai_with_retry(messages, max_tokens=500, temperature=0.3, timeout=10)

            print(f"[DEBUG] AI analysis result: {result[:200] if result else 'No result'}...")

            # do_POST already sent response and basic headers, just add Content-type and end
            self.send_header('Content-type', 'application/json')
            self.end_headers()

            if result:
                try:
                    # Parse the AI response as JSON
                    import re

                    # First, try to parse directly
                    result_data = None
                    try:
                        result_data = json.loads(result.strip())
                    except json.JSONDecodeError:
                        # If direct parsing fails, try to extract JSON from response
                        # Look for the outermost braces by counting nested braces
                        start_idx = result.find('{')
                        if start_idx != -1:
                            brace_count = 0
                            in_string = False
                            escape_next = False
                            for i, char in enumerate(result[start_idx:], start_idx):
                                if escape_next:
                                    escape_next = False
                                    continue
                                if char == '\\' and in_string:
                                    escape_next = True
                                    continue
                                if char == '"' and not escape_next:
                                    in_string = not in_string
                                if not in_string:
                                    if char == '{':
                                        brace_count += 1
                                    elif char == '}':
                                        brace_count -= 1
                                        if brace_count == 0:
                                            json_str = result[start_idx:i+1]
                                            result_data = json.loads(json_str)
                                            break

                    if result_data:
                        questions = result_data.get('questions', [])
                        # Get formality as a score (0-100), fallback to old categorical system
                        suggested_formality_score = result_data.get('suggested_formality_score', 50)
                        # If old categorical format returned, convert to score
                        if isinstance(suggested_formality_score, str):
                            if suggested_formality_score == 'casual':
                                suggested_formality_score = 20
                            elif suggested_formality_score == 'formal':
                                suggested_formality_score = 80
                            else:
                                suggested_formality_score = 50
                        # Ensure score is in valid range
                        suggested_formality_score = max(0, min(100, int(suggested_formality_score)))

                        # Get requires_reply and reply_reasoning
                        requires_reply = result_data.get('requires_reply', len(questions) > 0)
                        reply_reasoning = result_data.get('reply_reasoning', '')

                        # Get meeting_request if present
                        meeting_request = result_data.get('meeting_request', {'is_meeting': False})

                        # FALLBACK: If AI found no questions but rule-based found some, use rule-based
                        if not questions and rule_based_questions:
                            print(f"AI found no questions, using rule-based fallback: {rule_based_questions}")
                            questions = rule_based_questions
                            requires_reply = True
                            reply_reasoning = "Questions found in email"
                    else:
                        questions = []
                        suggested_formality_score = 50
                        requires_reply = False
                        reply_reasoning = ''
                        meeting_request = {'is_meeting': False}

                    print(f"Email analysis found {len(questions)} questions, requires_reply: {requires_reply}, suggested formality score: {suggested_formality_score}")
                    resp = {
                        'success': True,
                        'questions': questions,
                        'suggested_formality_score': suggested_formality_score,
                        'requires_reply': requires_reply,
                        'reply_reasoning': reply_reasoning,
                        'meeting_request': meeting_request
                    }
                    self.wfile.write(json.dumps(resp).encode())
                except json.JSONDecodeError as e:
                    print(f"Failed to parse AI response as JSON: {e}, result was: {result[:500]}")
                    # Use rule-based questions as fallback
                    if rule_based_questions:
                        print(f"Using rule-based questions after parse error: {rule_based_questions}")
                        resp = {
                            'success': True,
                            'questions': rule_based_questions,
                            'suggested_formality_score': 50,
                            'requires_reply': True,
                            'reply_reasoning': 'Questions found in email',
                            'meeting_request': {'is_meeting': False}
                        }
                    else:
                        resp = {
                            'success': True,
                            'questions': [],
                            'suggested_formality_score': 50,
                            'requires_reply': False,
                            'reply_reasoning': '',
                            'meeting_request': {'is_meeting': False}
                        }
                    self.wfile.write(json.dumps(resp).encode())
            else:
                print(f"Failed to analyze email: {error}")
                resp = {
                    'success': True,
                    'questions': [],
                    'suggested_formality_score': 50,
                    'requires_reply': False,
                    'reply_reasoning': '',
                    'meeting_request': {'is_meeting': False}
                }
                self.wfile.write(json.dumps(resp).encode())

        except Exception as e:
            print(f"Error analyzing email: {e}")
            import traceback
            traceback.print_exc()
            # do_POST already sent response, just add Content-type and end
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'success': False, 'error': f'Failed to analyze email: {str(e)}'}).encode())

    def handle_generate_reply(self):
        """Generate email reply using OpenAI API"""
        try:
            # Get request body FIRST before sending any response
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8'))

            sender = data.get('sender', '')
            subject = data.get('subject', '')
            body_text = data.get('body_text', '') or ''
            user_answers = data.get('user_answers', [])  # User's answers to questions
            formality_level = data.get('formality_level', 'neutral')  # User's chosen formality level: casual, neutral, or formal
            additional_context = data.get('additional_context', '')  # Additional context/instructions from user

            if not OPENAI_API_KEY:
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                response = {'success': False, 'error': 'OPENAI_API_KEY not configured'}
                self.wfile.write(json.dumps(response).encode())
                return

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

            if creds:
                # Extract email address from sender string
                import re
                email_match = re.search(r'[\w.+-]+@[\w.-]+\.[a-z]+', sender.lower())
                if email_match:
                    recipient_email = email_match.group(0)
                    recipient_emails = get_emails_with_recipient(creds, recipient_email, count=5)
                    if recipient_emails:
                        print(f"Found {len(recipient_emails)} past emails with {recipient_email}")

            # Fall back to general sent emails if no recipient-specific ones
            if not recipient_emails:
                recipient_emails = load_cached_sent_emails()

            print(f"Generating reply for: sender={sender[:30]}, subject={subject[:30]}, formality={formality_level}")

            # Build user answers context if provided
            user_answers_context = ""
            if user_answers:
                user_answers_context = "\n\nUSER'S CHOICES (incorporate these into your reply):\n"
                for answer in user_answers:
                    user_answers_context += f"- {answer.get('question', '')}: {answer.get('answer', '')}\n"

            # Build additional context if provided
            additional_context_section = ""
            if additional_context:
                additional_context_section = f"\n\nADDITIONAL CONTEXT/INSTRUCTIONS FROM USER:\n{additional_context}\n"

            # Determine style instruction based on user's chosen formality level
            if formality_level == 'formal':
                style_instruction = "Use a formal, respectful tone appropriate for academic or professional contexts. Use proper salutations (e.g., 'Dear [Name]') and sign-offs (e.g., 'Best regards' or 'Sincerely')."
            elif formality_level == 'casual':
                style_instruction = "Use a friendly, casual tone - be relaxed and informal. Use casual greetings (e.g., 'Hi' or 'Hey') and casual sign-offs (e.g., 'Best' or just your name)."
            else:  # neutral
                style_instruction = "Use a professional but approachable tone. Balance friendliness with professionalism."

            # Build context-aware prompt
            if recipient_emails:
                # Use recipient-specific emails as primary examples
                examples = "\n\n---\n\n".join(recipient_emails[:4])

                recipient_name_note = f"\n- Address them as '{recipient_first_name}' or by their preferred name" if recipient_first_name else ""

                prompt = f"""You are {user_name} writing an email reply. STUDY the examples below which are YOUR past emails to THIS SAME PERSON.

CRITICAL: You are {user_name}. The email is FROM them, TO you. Sign with YOUR name ({user_name}), NOT theirs.

INCOMING EMAIL:
{sender} wrote: {subject}

{body_text[:1500]}
{user_answers_context}{additional_context_section}
YOUR PAST EMAILS TO THIS PERSON (your writing style - study tone and format):
{examples}

CRITICAL RULES:
1. {"***If the user has provided choices above (in USER'S CHOICES), USE THEIR CHOICE and state it clearly in your reply.***" if user_answers else "If the email asks you to make a choice or preference and NO user choice was provided, DO NOT choose. Instead ask them to clarify or say you're flexible."}
2. {"***The user has already made their choice - use it! Say things like 'I would like [CHOICE]' or 'I'll go with [CHOICE]'.***" if user_answers else "NEVER decide on behalf of " + user_name + ". If asked 'A or B?' and no choice provided, respond asking what they prefer or say either works."}
3. You are {user_name} - sign the email with YOUR NAME, never the recipient's name
4. {style_instruction}
5. Match the writing style from your past emails, but ALWAYS sign as "{user_name}"
6. {f'Address them as "{recipient_first_name}"' if recipient_first_name else 'Use the same salutation style'}
7. NEVER use placeholders like [Your Name], [Your Position], etc.
8. Keep it under 100 words
9. Start with a salutation (Hi, Hey, Dear, etc.)
10. Output ONLY the email body - no subject line, no preamble
11. {"***IMPORTANT: Follow the ADDITIONAL CONTEXT/INSTRUCTIONS provided above.***" if additional_context else ""}

Now write the reply as {user_name}:"""
            elif user_name:
                prompt = f"""Generate a short, professional reply to this email. Your name is {user_name} - sign the email with this name.

Email from {sender}:
Subject: {subject}

{body_text[:1000]}
{user_answers_context}{additional_context_section}

CRITICAL: {"If user choices are provided above, USE THEM! State your choice clearly like 'I would like [choice]' or 'I'll go with [choice]'." if user_answers else "If the email asks you to make a choice or preference and NO user choice was provided, DO NOT choose. Ask them to clarify or say you're flexible."}
{"IMPORTANT: Follow the ADDITIONAL CONTEXT/INSTRUCTIONS provided above." if additional_context else ""}

Write a concise reply (under 100 words). Be professional and helpful. Sign off with "{user_name}". Start with a salutation. Do not include a subject line - just the email body."""
            else:
                prompt = f"""Generate a short, professional reply to this email:

Email from {sender}:
Subject: {subject}

{body_text[:1000]}
{user_answers_context}{additional_context_section}

CRITICAL: {"If user choices are provided above, USE THEM! State your choice clearly like 'I would like [choice]' or 'I'll go with [choice]'." if user_answers else "If the email asks you to make a choice or preference and NO user choice was provided, DO NOT choose. Ask them to clarify or say you're flexible."}
{"IMPORTANT: Follow the ADDITIONAL CONTEXT/INSTRUCTIONS provided above." if additional_context else ""}

Write a concise reply (under 100 words). Be professional and helpful. Start with a salutation. Do not include a subject line - just the email body."""

            messages = [{"role": "user", "content": prompt}]
            reply, error = call_openai_with_retry(messages, max_tokens=300, temperature=0.7, timeout=30)

            # Send response headers before writing body
            self.send_header('Content-type', 'application/json')
            self.end_headers()

            if reply:
                # Clean up the reply - remove any repeated subject line at the beginning
                reply = clean_reply(reply)
                print(f"AI reply generated successfully!")
                resp = {'success': True, 'reply': reply}
                self.wfile.write(json.dumps(resp).encode())
            else:
                print(f"Failed to generate reply: {error}")
                resp = {'success': False, 'error': f'Failed to generate reply: {error}'}
                self.wfile.write(json.dumps(resp).encode())

        except Exception as e:
            print(f"Error generating reply: {e}")
            import traceback
            traceback.print_exc()
            # For errors, headers may not have been sent yet
            try:
                self.send_header('Content-type', 'application/json')
                self.end_headers()
            except:
                pass  # Headers already sent
            response = {'success': False, 'error': f'Failed to generate reply: {str(e)}'}
            self.wfile.write(json.dumps(response).encode())

    def handle_edit_reply(self):
        """Edit an email reply using AI based on user's edit prompt"""
        try:
            # Get request body FIRST before sending any response
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8'))

            current_reply = data.get('current_reply', '')
            edit_prompt = data.get('edit_prompt', '')

            if not OPENAI_API_KEY:
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                response = {'success': False, 'error': 'OPENAI_API_KEY not configured'}
                self.wfile.write(json.dumps(response).encode())
                return

            if not current_reply or not edit_prompt:
                self.send_header('Content-type', 'application/json')
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
            edited_reply, error = call_openai_with_retry(messages, max_tokens=500, temperature=0.7, timeout=10)

            # Now send response headers (note: send_response already called in do_POST)
            self.send_header('Content-type', 'application/json')
            self.end_headers()

            if edited_reply:
                print(f"AI edit completed successfully!")
                resp = {'success': True, 'edited_reply': edited_reply}
                self.wfile.write(json.dumps(resp).encode())
            else:
                print(f"Failed to edit reply: {error}")
                resp = {'success': False, 'error': f'Failed to edit reply: {error}'}
                self.wfile.write(json.dumps(resp).encode())

        except Exception as e:
            print(f"Error editing reply: {e}")
            import traceback
            traceback.print_exc()
            # For errors, we need to send the full response since do_POST already sent 200
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            response = {'success': False, 'error': f'Failed to edit reply: {str(e)}'}
            self.wfile.write(json.dumps(response).encode())

    def handle_summarize(self):
        """Generate email summary using OpenAI API or Ollama"""
        try:
            # Get request body FIRST before sending any response
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

            # Now send response headers (note: send_response already called in do_POST)
            self.send_header('Content-type', 'application/json')
            self.end_headers()

            if summary:
                resp = {'success': True, 'summary': summary}
                self.wfile.write(json.dumps(resp).encode())
            else:
                resp = {'success': False, 'error': 'Failed to generate summary'}
                self.wfile.write(json.dumps(resp).encode())

        except Exception as e:
            print(f"Error generating summary: {e}")
            import traceback
            traceback.print_exc()
            # For errors, we need to send the full response since do_POST already sent 200
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            response = {'success': False, 'error': f'Failed to generate summary: {str(e)}'}
            self.wfile.write(json.dumps(response).encode())

    def log_message(self, format_str, *args):
        """Suppress server log messages"""
        pass

    def handle_calendar(self):
        """Handle calendar API requests"""
        try:
            # Get credentials
            creds = get_stored_credentials()
            if not creds:
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'success': False, 'error': 'Not authenticated'}).encode())
                return

            # Parse request body for POST
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length) if content_length > 0 else b'{}'
            request_data = json.loads(post_data.decode('utf-8')) if post_data else {}

            # Build calendar service
            service = build('calendar', 'v3', credentials=creds)

            action = request_data.get('action', 'list')

            if action == 'list':
                # Fetch calendar events
                time_min = request_data.get('time_min')
                time_max = request_data.get('time_max')
                max_results = request_data.get('max_results', 20)

                # Get current time if not specified
                if not time_min:
                    time_min = datetime.datetime.utcnow().isoformat() + 'Z'

                # Build request parameters
                params = {
                    'calendarId': 'primary',
                    'timeMin': time_min,
                    'maxResults': max_results,
                    'singleEvents': True,
                    'orderBy': 'startTime'
                }
                if time_max:
                    params['timeMax'] = time_max

                events_result = service.events().list(**params).execute()
                events = events_result.get('items', [])

                calendar_events = []
                for event in events:
                    start_data = event.get('start', {})
                    end_data = event.get('end', {})

                    calendar_events.append({
                        'id': event['id'],
                        'summary': event.get('summary', 'No Title'),
                        'description': event.get('description'),
                        'location': event.get('location'),
                        'start_datetime': start_data.get('dateTime', start_data.get('date')),
                        'end_datetime': end_data.get('dateTime', end_data.get('date')),
                        'status': event.get('status'),
                    })

                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    'success': True,
                    'events': calendar_events,
                    'total': len(calendar_events)
                }).encode())

            elif action == 'create_event':
                # Create a new calendar event
                summary = request_data.get('summary')
                start_datetime = request_data.get('start_datetime')
                end_datetime = request_data.get('end_datetime')
                description = request_data.get('description')
                location = request_data.get('location')
                attendees = request_data.get('attendees', [])

                if not summary or not start_datetime or not end_datetime:
                    self.send_header('Content-type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({'success': False, 'error': 'Missing required fields'}).encode())
                    return

                # Build event body
                event_body = {
                    'summary': summary,
                    'start': {
                        'dateTime': start_datetime,
                    },
                    'end': {
                        'dateTime': end_datetime,
                    },
                }

                if description:
                    event_body['description'] = description
                if location:
                    event_body['location'] = location
                if attendees:
                    event_body['attendees'] = [{'email': email} for email in attendees]

                # Create event
                created_event = service.events().insert(calendarId='primary', body=event_body).execute()

                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    'success': True,
                    'event': {
                        'id': created_event['id'],
                        'summary': created_event.get('summary'),
                        'html_link': created_event.get('htmlLink'),
                    }
                }).encode())

            elif action == 'find_free_slots':
                # Find free time slots for a meeting
                duration_minutes = request_data.get('duration_minutes', 60)
                start_date = request_data.get('start_date')
                end_date = request_data.get('end_date')
                working_hours_start = request_data.get('working_hours_start', '09:00')
                working_hours_end = request_data.get('working_hours_end', '17:00')

                if not start_date:
                    start_date = datetime.datetime.utcnow().date().isoformat()
                if not end_date:
                    # Default to 7 days from now
                    end_date = (datetime.datetime.utcnow() + datetime.timedelta(days=7)).date().isoformat()

                # Get events for the date range
                events_result = service.events().list(
                    calendarId='primary',
                    timeMin=f"{start_date}T00:00:00Z",
                    timeMax=f"{end_date}T23:59:59Z",
                    singleEvents=True,
                    orderBy='startTime'
                ).execute()

                existing_events = events_result.get('items', [])

                # Find free slots (simplified - looks for gaps between events)
                free_slots = []
                busy_times = []

                for event in existing_events:
                    start_str = event.get('start', {}).get('dateTime')
                    end_str = event.get('end', {}).get('dateTime')
                    if start_str and end_str:
                        try:
                            start = datetime.datetime.fromisoformat(start_str.replace('Z', '+00:00'))
                            end = datetime.datetime.fromisoformat(end_str.replace('Z', '+00:00'))
                            busy_times.append((start, end))
                        except:
                            pass

                # Generate potential slots (every 30 minutes during working hours)
                # This is a simplified implementation - a full one would be more sophisticated
                potential_slots = []
                current_date = datetime.datetime.fromisoformat(start_date)
                end_date_obj = datetime.datetime.fromisoformat(end_date)

                while current_date <= end_date_obj:
                    # Generate slots for this day
                    day_start = current_date.replace(hour=9, minute=0, second=0, microsecond=0)
                    day_end = current_date.replace(hour=17, minute=0, second=0, microsecond=0)

                    # Generate hourly slots
                    slot_time = day_start
                    while slot_time + datetime.timedelta(minutes=duration_minutes) <= day_end:
                        slot_end = slot_time + datetime.timedelta(minutes=duration_minutes)

                        # Check if this slot overlaps with any busy time
                        is_free = True
                        for busy_start, busy_end in busy_times:
                            if not (slot_end <= busy_start or slot_time >= busy_end):
                                is_free = False
                                break

                        if is_free:
                            potential_slots.append({
                                'start': slot_time.isoformat(),
                                'end': slot_end.isoformat(),
                                'date': slot_time.strftime('%A, %B %d'),
                                'time': slot_time.strftime('%I:%M %p'),
                            })

                        slot_time += datetime.timedelta(minutes=30)

                    current_date += datetime.timedelta(days=1)

                # Return top 5 suggestions
                suggested_slots = sorted(potential_slots, key=lambda x: x['start'])[:5]

                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    'success': True,
                    'free_slots': suggested_slots,
                    'total': len(suggested_slots)
                }).encode())

            else:
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'success': False, 'error': 'Unknown action'}).encode())

        except Exception as e:
            print(f"Error in handle_calendar: {e}")
            import traceback
            traceback.print_exc()
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'success': False, 'error': str(e)}).encode())

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

    server = ThreadingHTTPServer(('localhost', port), OAuthHandler)
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