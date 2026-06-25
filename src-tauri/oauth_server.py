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

from ab_testing import ab_test_assign, ab_test_log, event_logger
import genai_approaches
import elo_ranking
import uuid

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

# Calendar event cache (5-minute TTL)
_calendar_cache = {
    'events': [],
    'time_min': None,
    'time_max': None,
    'fetched_at': 0,
    'ttl': 300,  # 5 minutes
}

def get_cached_calendar_events(calendar_service, time_min_iso, time_max_iso):
    """Fetch calendar events with 5-minute TTL caching."""
    import time as _time
    from dateutil import parser as date_parser
    now = _time.time()
    cache = _calendar_cache

    # Check if cache covers the requested range and is fresh
    if (cache['fetched_at'] > 0
        and (now - cache['fetched_at']) < cache['ttl']
        and cache['time_min'] and cache['time_max']):
        cached_min = date_parser.parse(cache['time_min'])
        cached_max = date_parser.parse(cache['time_max'])
        req_min = date_parser.parse(time_min_iso)
        req_max = date_parser.parse(time_max_iso)
        if req_min >= cached_min and req_max <= cached_max:
            return [ev for ev in cache['events']
                    if (ev.get('start', {}).get('dateTime') or ev.get('start', {}).get('date', ''))
                    and req_min <= date_parser.parse(ev.get('start', {}).get('dateTime') or ev.get('start', {}).get('date')) <= req_max]

    # Cache miss - fetch wide range (30 days)
    from datetime import timedelta
    req_min_dt = date_parser.parse(time_min_iso)
    req_max_dt = date_parser.parse(time_max_iso)
    wide_max = max(req_max_dt, req_min_dt + timedelta(days=30))

    result = calendar_service.events().list(
        calendarId='primary', timeMin=time_min_iso, timeMax=wide_max.isoformat(),
        singleEvents=True, orderBy='startTime', maxResults=250
    ).execute()
    all_events = result.get('items', [])

    cache['events'] = all_events
    cache['time_min'] = time_min_iso
    cache['time_max'] = wide_max.isoformat()
    cache['fetched_at'] = now
    return [ev for ev in all_events
            if (ev.get('start', {}).get('dateTime') or ev.get('start', {}).get('date', ''))
            and req_min_dt <= date_parser.parse(ev.get('start', {}).get('dateTime') or ev.get('start', {}).get('date')) <= req_max_dt]

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

# ---------------------------------------------------------------------------
# Slack integration (DMs + mentions). Two ways to connect:
#   (A) Simplest for your own account — paste your User OAuth Token (xoxp-...)
#       as SLACK_USER_TOKEN. No OAuth flow / Connect button needed.
#   (B) Full OAuth — set SLACK_CLIENT_ID / SLACK_CLIENT_SECRET and use the
#       Connect button (redirect URL http://localhost:8080/slack/callback).
# Either way the token needs the scopes in SLACK_SCOPES.
# ---------------------------------------------------------------------------
SLACK_USER_TOKEN = os.getenv('SLACK_USER_TOKEN')  # xoxp-... (direct, optional)
SLACK_CLIENT_ID = os.getenv('SLACK_CLIENT_ID')
SLACK_CLIENT_SECRET = os.getenv('SLACK_CLIENT_SECRET')
SLACK_TOKEN_FILE = TOKEN_DIR / 'slack_token.json'
SLACK_REDIRECT_URI = 'http://localhost:8080/slack/callback'
SLACK_SCOPES = 'channels:history,groups:history,im:history,mpim:history,channels:read,users:read,chat:write'


def _slack_load_token():
    try:
        if SLACK_TOKEN_FILE.exists():
            with open(SLACK_TOKEN_FILE) as f:
                return json.load(f)
    except Exception as e:
        print(f"[slack] load token error: {e}")
    return None


def _slack_save_token(data):
    TOKEN_DIR.mkdir(parents=True, exist_ok=True)
    with open(SLACK_TOKEN_FILE, 'w') as f:
        json.dump(data, f)


def _slack_user_token():
    """The user-scoped access token.

    Prefers SLACK_USER_TOKEN (pasted directly), else the token persisted from the
    OAuth flow (oauth.v2.access returns it under authed_user).
    """
    if SLACK_USER_TOKEN:
        return SLACK_USER_TOKEN
    tok = _slack_load_token()
    if not tok:
        return None
    return (tok.get('authed_user') or {}).get('access_token') or tok.get('access_token')


def _slack_ts_to_iso(ts):
    try:
        from datetime import datetime, timezone
        return datetime.fromtimestamp(float(ts), tz=timezone.utc).isoformat()
    except Exception:
        return None


def fetch_slack_messages(token, channel_limit=30, history_limit=15):
    """Fetch the user's DMs and @-mentions, normalized for the unified inbox.

    Bounded on purpose (channel_limit / history_limit) to stay well under Slack's
    rate limits on a personal workspace. Returns a list of dicts the frontend maps
    to UnifiedMessage via slackToUnified().
    """
    import requests

    def api(method, params=None):
        r = requests.get(
            f'https://slack.com/api/{method}',
            headers={'Authorization': f'Bearer {token}'},
            params=params or {},
            timeout=15,
        )
        data = r.json()
        if not data.get('ok'):
            raise Exception(f"slack {method}: {data.get('error', 'unknown')}")
        return data

    # Who am I — to detect mentions and skip my own messages.
    me = api('auth.test')
    my_id = me.get('user_id')

    # Resolve user id -> display name (one bulk call, cached locally).
    users = {}
    try:
        cursor = None
        for _ in range(5):  # cap pagination
            page = api('users.list', {'limit': 200, **({'cursor': cursor} if cursor else {})})
            for u in page.get('members', []):
                prof = u.get('profile') or {}
                users[u.get('id')] = prof.get('display_name') or prof.get('real_name') or u.get('name') or u.get('id')
            cursor = (page.get('response_metadata') or {}).get('next_cursor')
            if not cursor:
                break
    except Exception as e:
        print(f"[slack] users.list error: {e}")

    def name_of(uid):
        return users.get(uid, uid or 'Unknown')

    def humanize(text):
        # Replace <@U123> mention tokens with @display-name.
        import re
        return re.sub(r'<@(\w+)>', lambda m: '@' + name_of(m.group(1)), text or '')

    results = []
    seen = set()

    # 1. Direct messages (im) + group DMs (mpim).
    try:
        convos = api('conversations.list', {'types': 'im,mpim', 'limit': 50}).get('channels', [])
        for c in convos[:channel_limit]:
            cid = c.get('id')
            hist = api('conversations.history', {'channel': cid, 'limit': history_limit}).get('messages', [])
            for m in hist:
                if m.get('subtype') or not m.get('ts'):
                    continue
                if m.get('user') == my_id:
                    continue
                key = f"{cid}-{m['ts']}"
                if key in seen:
                    continue
                seen.add(key)
                results.append({
                    'id': key,
                    'thread_id': cid,
                    'author_id': m.get('user'),
                    'author_name': name_of(m.get('user')),
                    'title': 'Direct message',
                    'text': humanize(m.get('text')),
                    'ts': _slack_ts_to_iso(m['ts']),
                    'is_dm': True,
                    'is_mention': False,
                })
    except Exception as e:
        print(f"[slack] DM fetch error: {e}")

    # 2. @-mentions in channels the user belongs to.
    try:
        mention_tok = f'<@{my_id}>'
        chans = api('conversations.list', {
            'types': 'public_channel,private_channel',
            'exclude_archived': True,
            'limit': 200,
        }).get('channels', [])
        member_chans = [c for c in chans if c.get('is_member')][:channel_limit]
        for c in member_chans:
            cid = c.get('id')
            try:
                hist = api('conversations.history', {'channel': cid, 'limit': history_limit}).get('messages', [])
            except Exception:
                continue
            for m in hist:
                if m.get('subtype') or not m.get('ts'):
                    continue
                if m.get('user') == my_id:
                    continue
                if mention_tok not in (m.get('text') or ''):
                    continue
                key = f"{cid}-{m['ts']}"
                if key in seen:
                    continue
                seen.add(key)
                results.append({
                    'id': key,
                    'thread_id': cid,
                    'author_id': m.get('user'),
                    'author_name': name_of(m.get('user')),
                    'title': '#' + (c.get('name') or 'channel'),
                    'text': humanize(m.get('text')),
                    'ts': _slack_ts_to_iso(m['ts']),
                    'is_dm': False,
                    'is_mention': True,
                })
    except Exception as e:
        print(f"[slack] mention fetch error: {e}")

    # Newest first.
    results.sort(key=lambda x: x.get('ts') or '', reverse=True)
    return results


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
# Reduced to 0.5 seconds since using z.ai API which handles concurrency well
rate_limiter = RateLimiter(min_delay=0.5)


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


def call_openai_with_retry(messages, max_tokens=300, temperature=0.7, timeout=5, use_ollama_fallback=True):
    """Call OpenAI API with exponential backoff retry on rate limit (429) errors.
    Falls back to Ollama if OpenAI fails and use_ollama_fallback is True."""
    import requests

    if not OPENAI_API_KEY:
        return None, "OPENAI_API_KEY not configured"

    # No rate limiting needed anymore - using z.ai API

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


def call_anthropic_with_retry(messages, max_tokens=300, temperature=0.7, timeout=30):
    """Call Anthropic-compatible API (z.ai) with retry logic."""
    import requests

    api_key = os.getenv('ANTHROPIC_API_KEY')
    if not api_key:
        return None, "ANTHROPIC_API_KEY not configured"

    # Build request for Anthropic-compatible API
    headers = {
        "Content-Type": "application/json",
        "x-api-key": api_key.strip(),
        "anthropic-version": "2023-06-01"
    }

    # Convert messages to Anthropic format
    content = ""
    system_msg = None
    for msg in messages:
        if msg['role'] == 'system':
            system_msg = msg['content']
        elif msg['role'] == 'user':
            content += msg['content'] + "\n\n"
        elif msg['role'] == 'assistant':
            content += f"Assistant: {msg['content']}\n\n"
        elif msg['role'] == 'function':
            continue  # Skip function results

    # Build the request
    body = {
        "model": "claude-sonnet-4-20250514",
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": content.strip()}]
    }

    if system_msg:
        body["system"] = system_msg

    try:
        response = requests.post(
            "https://api.z.ai/api/anthropic/v1/messages",
            headers=headers,
            json=body,
            timeout=timeout
        )

        if response.status_code == 200:
            result = response.json()
            return result['content'][0]['text'], None
        else:
            return None, f"API error {response.status_code}: {response.text[:200]}"
    except requests.exceptions.Timeout:
        return None, f"Request timed out after {timeout}s"
    except Exception as e:
        return None, f"Request error: {str(e)}"


def decode_html_entities(text):
    """Decode HTML entities like &#39; to actual characters"""
    if not text:
        return text
    return html.unescape(text)


def extract_email_body(message):
    """Extract plain text body from Gmail message"""
    text, _ = extract_email_bodies(message)
    return text


def extract_email_bodies(message, service=None):
    """Extract both plain text and HTML body from Gmail message in a single pass.
    Returns (text_body, html_body) tuple."""
    try:
        import base64
        payload = message.get('payload', {})
        text_body = None
        html_body = None

        def find_bodies(part):
            nonlocal text_body, html_body
            mime = part.get('mimeType', '')
            data = part.get('body', {}).get('data', '')
            if mime == 'text/plain' and not text_body and data:
                text_body = decode_html_entities(base64.urlsafe_b64decode(data).decode('utf-8', errors='ignore'))
            elif mime == 'text/html' and not html_body and data:
                html_body = base64.urlsafe_b64decode(data).decode('utf-8', errors='ignore')
            for subpart in part.get('parts', []):
                find_bodies(subpart)

        # Check main body first (single-part messages)
        body_data = payload.get('body', {}).get('data', '')
        if body_data:
            mime = payload.get('mimeType', '')
            decoded = base64.urlsafe_b64decode(body_data).decode('utf-8', errors='ignore')
            if mime == 'text/html':
                html_body = decoded
            else:
                text_body = decode_html_entities(decoded)

        # Check parts (multipart messages)
        if not text_body or not html_body:
            for part in payload.get('parts', []):
                find_bodies(part)

        # Inline image replacement for HTML (reuse existing logic)
        if html_body and service:
            html_body = _replace_inline_images(html_body, message, service)

        return (text_body, html_body)
    except Exception as e:
        print(f"Error extracting bodies: {e}")
        return (None, None)


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


def _replace_inline_images(html_content, message, service):
    """Replace cid: references in HTML with base64 data URLs."""
    import base64
    import re

    payload = message.get('payload', {})
    message_id = message.get('id')
    inline_images = {}
    attachments_to_fetch = []

    def collect_images(part):
        headers = part.get('headers', [])
        content_id = None
        for header in headers:
            if header['name'].lower() == 'content-id':
                content_id = header['value'].strip('<>')
                break
        if content_id:
            body_data = part.get('body', {}).get('data', '')
            attachment_id = part.get('body', {}).get('attachmentId')
            mime_type = part.get('mimeType', 'image/png')
            if body_data:
                try:
                    decoded = base64.urlsafe_b64decode(body_data)
                    inline_images[content_id] = f"data:{mime_type};base64,{base64.b64encode(decoded).decode('ascii')}"
                except Exception:
                    pass
            elif attachment_id:
                attachments_to_fetch.append((content_id, attachment_id, mime_type))
        for subpart in part.get('parts', []):
            collect_images(subpart)

    collect_images(payload)

    if service and message_id and attachments_to_fetch:
        for content_id, attachment_id, mime_type in attachments_to_fetch:
            try:
                att = service.users().messages().attachments().get(
                    userId='me', messageId=message_id, id=attachment_id).execute()
                data = att.get('data', '')
                if data:
                    decoded = base64.urlsafe_b64decode(data)
                    inline_images[content_id] = f"data:{mime_type};base64,{base64.b64encode(decoded).decode('ascii')}"
            except Exception:
                pass

    if not inline_images:
        return html_content

    def replace_cid(match):
        cid = match.group(1)
        return inline_images.get(cid, inline_images.get(f"<{cid}>", match.group(0)))

    html_content = re.sub(r'src=["\']cid:([^"\']+)["\']', lambda m: f'src="{replace_cid(m)}"' if replace_cid(m) != m.group(0) else m.group(0), html_content)
    html_content = re.sub(r'src=cid:([^\s>]+)', lambda m: f'src="{replace_cid(m)}"' if replace_cid(m) != m.group(0) else m.group(0), html_content)
    html_content = re.sub(r'cid:([^"\s>]+)', replace_cid, html_content)
    return html_content


def extract_email_body_html(message, service=None):
    """Extract HTML body from Gmail message and convert inline images to base64"""
    _, html = extract_email_bodies(message, service)
    return html


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
    """Generate a concise summary of an email with key points and action items"""
    try:
        # Use snippet if body is too short, otherwise use body
        content = body_text if body_text else snippet

        # Extract sender's first name for more natural summary
        sender_name = extract_name_from_email(sender) or "Sender"

        prompt = f"""Analyze this email and provide:

1. SUMMARY: ONE concise sentence starting with the sender's name
2. KEY POINTS: 2-4 bullet points of important information (what they're asking for, main topics, decisions needed)
3. ACTION ITEMS: Specific tasks requested or "None"

Format exactly like this:
SUMMARY: [one sentence]
KEY POINTS:
• [point 1]
• [point 2]
ACTION ITEMS:
✓ [action 1]
✓ [action 2]

From: {sender}
Subject: {subject}

Email:
{content[:2000]}

Respond ONLY in the format above, no other text."""

        messages = [{"role": "user", "content": prompt}]
        result, error = call_anthropic_with_retry(messages, max_tokens=500, temperature=0.3, timeout=30)

        if result:
            # Parse the structured response
            lines = result.split('\n')
            summary = ""
            key_points = []
            action_items = []
            current_section = None

            for line in lines:
                line_stripped = line.strip()
                if not line_stripped:
                    continue

                if line_stripped.upper().startswith('SUMMARY:'):
                    summary = line_stripped.split(':', 1)[1].strip() if ':' in line_stripped else ''
                elif line_stripped.upper().startswith('KEY POINTS') or line_stripped.upper().startswith('KEYPOINTS'):
                    current_section = 'key_points'
                elif line_stripped.upper().startswith('ACTION ITEMS') or line_stripped.upper().startswith('ACTIONITEMS'):
                    current_section = 'action_items'
                elif current_section == 'key_points':
                    # Match various bullet styles
                    for prefix in ['•', '-', '*', '∙']:
                        if line_stripped.startswith(prefix):
                            key_points.append(line_stripped[len(prefix):].strip())
                            break
                elif current_section == 'action_items':
                    # Match checkmarks and bullets
                    for prefix in ['✓', '☐', '-', '*']:
                        if line_stripped.startswith(prefix):
                            action_item = line_stripped[len(prefix):].strip()
                            if action_item.lower() != 'none':
                                action_items.append(action_item)
                            break

            # Clean up summary
            if summary:
                summary = clean_summary(summary)
            else:
                # Fallback: use first line as summary
                for line in lines:
                    if line and not line.startswith('SUMMARY') and not line.startswith('KEY') and not line.startswith('ACTION'):
                        summary = clean_summary(line.strip())
                        break

            print(f"Email summary generated: {summary[:50] if summary else 'No summary'}... (key_points: {len(key_points)}, action_items: {len(action_items)})")
            return {
                'summary': summary,
                'key_points': key_points,
                'action_items': action_items
            }
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

def get_user_timezone():
    """Get the user's local timezone as a pytz timezone object"""
    import pytz
    import os

    # Method 1: Try reading from /etc/localtime on Unix (most reliable)
    try:
        if os.path.exists('/etc/localtime'):
            tz_path = os.path.realpath('/etc/localtime')
            print(f"[TIMEZONE] /etc/localtime points to: {tz_path}")
            if 'zoneinfo' in tz_path:
                tz_name = tz_path.split('zoneinfo/')[-1]
                print(f"[TIMEZONE] Detected timezone: {tz_name}")
                tz = pytz.timezone(tz_name)
                # Test the timezone
                from datetime import datetime, timezone
                test_time = datetime.now(timezone.utc)
                local_time = test_time.astimezone(tz)
                print(f"[TIMEZONE] Test: UTC {test_time} -> {tz_name} {local_time}")
                return tz
    except Exception as e:
        print(f"[TIMEZONE] Error reading /etc/localtime: {e}")

    # Fallback to Eastern Time
    print("[TIMEZONE] Using fallback: America/New_York")
    return pytz.timezone('America/New_York')

def parse_natural_time(time_str: str, reference_time, user_timezone):
    """Parse natural language time expressions like 'tomorrow at 2pm', 'Wednesday at 3pm'"""
    import re
    from datetime import timedelta, datetime, timezone
    import pytz

    time_str = time_str.lower().strip()
    pacific = pytz.timezone(user_timezone)

    # Extract time if present (e.g., "2pm", "2:30pm", "2 pm")
    time_match = re.search(r'(\d{1,2})(?::(\d{2}))?\s*(am|pm)', time_str)
    hour = None
    minute = 0

    if time_match:
        hour = int(time_match.group(1))
        if time_match.group(2):
            minute = int(time_match.group(2))
        ampm = time_match.group(3)
        if ampm == 'pm' and hour != 12:
            hour += 12
        elif ampm == 'am' and hour == 12:
            hour = 0

    # Parse day
    day_offset = 0

    if 'tomorrow' in time_str:
        day_offset = 1
    elif 'today' in time_str:
        day_offset = 0
    else:
        # Check for day names
        days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
        current_weekday = reference_time.weekday()
        for i, day in enumerate(days):
            if day in time_str:
                days_until = (i - current_weekday) % 7
                if days_until == 0:
                    # If same day, check if we've passed the time
                    if hour is not None and reference_time.hour > hour:
                        days_until = 7
                day_offset = days_until
                break

    # Build the datetime
    result_date = reference_time + timedelta(days=day_offset)

    if hour is not None:
        result_date = result_date.replace(hour=hour, minute=minute, second=0, microsecond=0)
    else:
        # No specific time, default to 2pm
        result_date = result_date.replace(hour=14, minute=0, second=0, microsecond=0)

    return result_date

class OAuthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        # Add CORS headers to all responses
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')

        # A/B testing middleware: assign variations and log exposure
        ab_test_assign(self)
        ab_test_log(self)

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
        elif self.path.startswith('/get-attachment'):
            self.handle_get_attachment()
        elif self.path == '/':
            # Root endpoint with simple status
            self.end_headers()
            self.wfile.write(b'OAuth server is running')
        elif self.path.startswith('/genai-rankings'):
            self.handle_genai_rankings()
        elif self.path.startswith('/genai-approaches'):
            self.handle_genai_approaches()
        elif self.path.startswith('/book/'):
            # Public booking page
            self.handle_booking_page()
        elif self.path.startswith('/slack/auth'):
            self.handle_slack_auth()
        elif self.path.startswith('/slack/callback'):
            self.handle_slack_callback()
        elif self.path.startswith('/slack/status'):
            self.handle_slack_status()
        elif self.path.startswith('/slack/messages'):
            self.handle_slack_messages()
        else:
            self.send_error(404)

    def do_POST(self):
        # Add CORS headers to all responses
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')

        # A/B testing middleware: assign variations and log exposure
        ab_test_assign(self)
        ab_test_log(self)

        if self.path.startswith('/log-event'):
            self.handle_log_event()
        elif self.path.startswith('/send-email'):
            self.handle_send_email()
        elif self.path.startswith('/analyze-email'):
            self.handle_analyze_email()
        elif self.path.startswith('/genai-preference'):
            self.handle_genai_preference()
        elif self.path.startswith('/generate-reply'):
            self.handle_generate_reply()
        elif self.path.startswith('/edit-reply'):
            self.handle_edit_reply()
        elif self.path.startswith('/summarize'):
            self.handle_summarize()
        elif self.path.startswith('/summarize-attachment'):
            self.handle_summarize_attachment()
        elif self.path.startswith('/search-attachments'):
            self.handle_search_attachments()
        elif self.path.startswith('/calendar'):
            self.handle_calendar()
        elif self.path.startswith('/execute-command'):
            self.handle_execute_command()
        elif self.path.startswith('/scheduling'):
            self.handle_scheduling()
        elif self.path.startswith('/batch-mark-read'):
            self.handle_batch_mark_read()
        elif self.path.startswith('/batch-mark-unread'):
            self.handle_batch_mark_unread()
        elif self.path.startswith('/mark-unread'):
            self.handle_mark_unread()
        elif self.path.startswith('/mark-read'):
            self.handle_mark_read()
        elif self.path.startswith('/chat'):
            self.handle_chat()
        else:
            self.send_error(404)

    def handle_log_event(self):
        """Handle frontend event logging for A/B tests.

        Expects a JSON body with:
          - event: str   (the event name, e.g. "reply_button_click")
          - metadata: dict (optional extra data)
        """
        try:
            self.send_header('Content-type', 'application/json')
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body) if body else {}

            event_name = data.get('event', 'unknown')
            metadata = data.get('metadata', {})

            event_logger(self, event_name=event_name, metadata=metadata)

            self.end_headers()
            self.wfile.write(json.dumps({
                'success': True,
                'event': event_name,
                'ab_assignments': getattr(self, 'ab_assignments', {}),
            }).encode())
        except Exception as e:
            self.end_headers()
            self.wfile.write(json.dumps({
                'success': False,
                'error': str(e),
            }).encode())

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

    # ------------------------------------------------------------------
    # Slack (DMs + mentions)
    # ------------------------------------------------------------------
    def handle_slack_auth(self):
        """Return the Slack authorize URL for the frontend to open in a browser."""
        self.send_header('Content-type', 'application/json')
        self.end_headers()
        if not SLACK_CLIENT_ID:
            self.wfile.write(json.dumps({'error': 'SLACK_CLIENT_ID is not set on the server'}).encode())
            return
        from urllib.parse import urlencode
        params = urlencode({
            'client_id': SLACK_CLIENT_ID,
            'user_scope': SLACK_SCOPES,
            'redirect_uri': SLACK_REDIRECT_URI,
            'state': uuid.uuid4().hex,
        })
        url = f'https://slack.com/oauth/v2/authorize?{params}'
        self.wfile.write(json.dumps({'url': url}).encode())

    def handle_slack_callback(self):
        """Exchange the OAuth code for a token, persist it, show a close-me page."""
        self.send_header('Content-type', 'text/html')
        self.end_headers()
        qs = parse_qs(urlparse(self.path).query)
        code = (qs.get('code') or [None])[0]
        page_ok = (
            '<html><body style="font-family:-apple-system,sans-serif;text-align:center;padding-top:80px">'
            '<h2>✅ Slack connected</h2><p>You can close this window and return to Aiden.</p></body></html>'
        )
        if not code:
            self.wfile.write(b'<html><body><h2>Slack connection failed</h2><p>No authorization code.</p></body></html>')
            return
        try:
            import requests
            resp = requests.post('https://slack.com/api/oauth.v2.access', data={
                'client_id': SLACK_CLIENT_ID,
                'client_secret': SLACK_CLIENT_SECRET,
                'code': code,
                'redirect_uri': SLACK_REDIRECT_URI,
            }, timeout=15)
            data = resp.json()
            if not data.get('ok'):
                raise Exception(data.get('error', 'unknown'))
            _slack_save_token(data)
            self.wfile.write(page_ok.encode())
        except Exception as e:
            print(f"[slack] callback error: {e}")
            self.wfile.write(
                f'<html><body style="font-family:sans-serif;text-align:center;padding-top:80px">'
                f'<h2>Slack connection failed</h2><p>{html.escape(str(e))}</p></body></html>'.encode()
            )

    def handle_slack_status(self):
        """Report whether Slack is configured and connected."""
        self.send_header('Content-type', 'application/json')
        self.end_headers()
        tok = _slack_load_token() or {}
        team = (tok.get('team') or {}).get('name')
        self.wfile.write(json.dumps({
            'connected': bool(_slack_user_token()),
            'configured': bool(SLACK_USER_TOKEN or (SLACK_CLIENT_ID and SLACK_CLIENT_SECRET)),
            'team': team,
        }).encode())

    def handle_slack_messages(self):
        """Return the user's DMs + mentions, normalized for the unified inbox."""
        self.send_header('Content-type', 'application/json')
        self.end_headers()
        token = _slack_user_token()
        if not token:
            self.wfile.write(json.dumps({'success': False, 'error': 'not_connected', 'messages': []}).encode())
            return
        try:
            messages = fetch_slack_messages(token)
            self.wfile.write(json.dumps({'success': True, 'messages': messages}).encode())
        except Exception as e:
            print(f"[slack] messages error: {e}")
            self.wfile.write(json.dumps({'success': False, 'error': str(e), 'messages': []}).encode())

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

            # Get known IDs from query params to skip re-fetching
            known_ids = set()
            if 'knownIds' in query_params:
                known_ids = set(query_params['knownIds'][0].split(','))

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
                    # Skip full fetch for emails we already have
                    if message['id'] in known_ids:
                        continue

                    # Get full message to extract body content
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

                    # Extract both text and HTML body in a single pass
                    body_text, body_html = extract_email_bodies(msg, service)
                    body_text = body_text or ''
                    body_html = body_html or ''
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

    def handle_mark_read(self):
        """Handle marking an email as read in Gmail"""
        try:
            self.send_header('Content-type', 'application/json')

            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body) if body else {}
            message_id = data.get('messageId')

            if not message_id:
                self.end_headers()
                self.wfile.write(json.dumps({'success': False, 'error': 'messageId is required'}).encode())
                return

            creds = get_stored_credentials()
            if not creds:
                self.end_headers()
                self.wfile.write(json.dumps({'success': False, 'error': 'Not authenticated'}).encode())
                return

            service = build('gmail', 'v1', credentials=creds)
            service.users().messages().modify(
                userId='me',
                id=message_id,
                body={'removeLabelIds': ['UNREAD']}
            ).execute()

            self.end_headers()
            self.wfile.write(json.dumps({'success': True}).encode())
        except Exception as e:
            print(f"Error marking email as read: {e}")
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'success': False, 'error': str(e)}).encode())

    def handle_mark_unread(self):
        """Handle marking an email as unread in Gmail"""
        try:
            self.send_header('Content-type', 'application/json')

            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body) if body else {}
            message_id = data.get('messageId')

            if not message_id:
                self.end_headers()
                self.wfile.write(json.dumps({'success': False, 'error': 'messageId is required'}).encode())
                return

            creds = get_stored_credentials()
            if not creds:
                self.end_headers()
                self.wfile.write(json.dumps({'success': False, 'error': 'Not authenticated'}).encode())
                return

            service = build('gmail', 'v1', credentials=creds)
            service.users().messages().modify(
                userId='me',
                id=message_id,
                body={'addLabelIds': ['UNREAD']}
            ).execute()

            self.end_headers()
            self.wfile.write(json.dumps({'success': True}).encode())
        except Exception as e:
            print(f"Error marking email as unread: {e}")
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'success': False, 'error': str(e)}).encode())

    def handle_batch_mark_read(self):
        """Batch mark multiple emails as read using Gmail batchModify"""
        try:
            self.send_header('Content-type', 'application/json')
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body) if body else {}
            message_ids = data.get('messageIds', [])
            if not message_ids:
                self.end_headers()
                self.wfile.write(json.dumps({'success': False, 'error': 'messageIds is required'}).encode())
                return
            creds = get_stored_credentials()
            if not creds:
                self.end_headers()
                self.wfile.write(json.dumps({'success': False, 'error': 'Not authenticated'}).encode())
                return
            service = build('gmail', 'v1', credentials=creds)
            # batchModify handles up to 1000 IDs per call
            for i in range(0, len(message_ids), 1000):
                batch = message_ids[i:i+1000]
                service.users().messages().batchModify(
                    userId='me',
                    body={'ids': batch, 'removeLabelIds': ['UNREAD']}
                ).execute()
            self.end_headers()
            self.wfile.write(json.dumps({'success': True, 'count': len(message_ids)}).encode())
        except Exception as e:
            print(f"Error batch marking as read: {e}")
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'success': False, 'error': str(e)}).encode())

    def handle_batch_mark_unread(self):
        """Batch mark multiple emails as unread using Gmail batchModify"""
        try:
            self.send_header('Content-type', 'application/json')
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body) if body else {}
            message_ids = data.get('messageIds', [])
            if not message_ids:
                self.end_headers()
                self.wfile.write(json.dumps({'success': False, 'error': 'messageIds is required'}).encode())
                return
            creds = get_stored_credentials()
            if not creds:
                self.end_headers()
                self.wfile.write(json.dumps({'success': False, 'error': 'Not authenticated'}).encode())
                return
            service = build('gmail', 'v1', credentials=creds)
            for i in range(0, len(message_ids), 1000):
                batch = message_ids[i:i+1000]
                service.users().messages().batchModify(
                    userId='me',
                    body={'ids': batch, 'addLabelIds': ['UNREAD']}
                ).execute()
            self.end_headers()
            self.wfile.write(json.dumps({'success': True, 'count': len(message_ids)}).encode())
        except Exception as e:
            print(f"Error batch marking as unread: {e}")
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'success': False, 'error': str(e)}).encode())

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
            attachments = data.get('attachments', [])  # List of {path, base64, name}

            print(f"[DEBUG] send-email received: to={to}, subject={subject}, in_reply_to={in_reply_to}")
            print(f"[DEBUG] attachments count: {len(attachments)}")
            for i, att in enumerate(attachments):
                print(f"[DEBUG] attachment {i}: name={att.get('name')}, base64_length={len(att.get('base64', ''))}")

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

            import email.message
            import email.mime.multipart
            import email.mime.text
            import email.mime.base
            import email.mime.application
            import base64

            # Create email message
            if attachments:
                # MIME multipart message with attachments
                message = email.mime.multipart.MIMEMultipart()
                message['To'] = to
                message['Subject'] = subject

                # Add email body
                mime_text = email.mime.text.MIMEText(body, 'plain')
                message.attach(mime_text)

                # Add attachments
                for attachment in attachments:
                    import os
                    filename = attachment.get('name', os.path.basename(attachment.get('path', 'attachment')))
                    base64_data = attachment.get('base64', '')
                    print(f"[DEBUG] Processing attachment: filename={filename}, base64_length={len(base64_data)}")

                    file_data = base64.b64decode(base64_data)
                    print(f"[DEBUG] Decoded data length: {len(file_data)} bytes")

                    # Detect MIME type from filename
                    content_type = self._get_mime_type(filename)
                    print(f"[DEBUG] MIME type: {content_type}")

                    if content_type.startswith('text/'):
                        # Text file
                        mime_attachment = email.mime.text.MIMEText(file_data.read() if hasattr(file_data, 'read') else file_data.decode('utf-8'), _subtype=content_type.split('/')[1])
                    else:
                        # Binary file
                        mime_attachment = email.mime.base.MIMEBase(*content_type.split('/', 1))
                        mime_attachment.set_payload(file_data)

                    # Set filename and encoding
                    mime_attachment.add_header('Content-Disposition', 'attachment', filename=filename)
                    email.encoders.encode_base64(mime_attachment)
                    message.attach(mime_attachment)
                    print(f"[DEBUG] Attached {filename} to message")

            else:
                # Simple email without attachments
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

    def _get_mime_type(self, filename):
        """Get MIME type based on file extension"""
        filename_lower = filename.lower()

        mime_types = {
            '.pdf': 'application/pdf',
            '.doc': 'application/msword',
            '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            '.xls': 'application/vnd.ms-excel',
            '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            '.ppt': 'application/vnd.ms-powerpoint',
            '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.svg': 'image/svg+xml',
            '.txt': 'text/plain',
            '.html': 'text/html',
            '.htm': 'text/html',
            '.zip': 'application/zip',
            '.rar': 'application/vnd.rar',
            '.7z': 'application/x-7z-compressed',
            '.mp3': 'audio/mpeg',
            '.mp4': 'video/mp4',
            '.mov': 'video/quicktime',
            '.avi': 'video/x-msvideo',
            '.webm': 'video/webm',
        }

        for ext, mime_type in mime_types.items():
            if filename_lower.endswith(ext):
                return mime_type

        return 'application/octet-stream'  # Default binary type

    def handle_analyze_email(self):
        """Analyze email to extract questions that need user input and suggest formality level"""
        try:
            print("[DEBUG] handle_analyze_email: Starting...")
            content_length = int(self.headers.get('Content-Length', 0))
            print(f"[DEBUG] Content-Length: {content_length}")
            post_data = self.rfile.read(content_length)
            print(f"[DEBUG] Read {len(post_data)} bytes")
            data = json.loads(post_data.decode('utf-8'))
            print(f"[DEBUG] Parsed data: sender={data.get('sender')}, subject={data.get('subject')[:50] if data.get('subject') else ''}")

            sender = data.get('sender', '')
            subject = data.get('subject', '')
            body_text = data.get('body_text', '') or ''

            # RULE-BASED MEETING DETECTION (runs before AI check)
            import re as regex_module
            text_lower = (subject + ' ' + body_text).lower()
            meeting_keywords = ['meet', 'meeting', 'call', 'schedule', 'available', 'free', 'zoom', 'teams', 'hangout']
            time_keywords = ['tomorrow', 'today', 'next week', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'am', 'pm', 'morning', 'afternoon', 'evening']
            question_indicators = ['?', 'can we', 'are you', 'would you', 'let me know']

            is_meeting_request = (
                any(kw in text_lower for kw in meeting_keywords) and
                any(kw in text_lower for kw in time_keywords) and
                (any(ind in text_lower for ind in question_indicators) or 'available' in text_lower or 'free' in text_lower)
            )

            # Exclude past meetings (notes, minutes, etc.)
            past_meeting_indicators = ['meeting notes', 'minutes', 'recording', 'agenda for', 'follow-up to', 'summary of']
            is_meeting_request = is_meeting_request and not any(ind in text_lower for ind in past_meeting_indicators)

            # Extract proposed times
            proposed_times = []
            time_patterns = [
                r'(tomorrow|today|monday|tuesday|wednesday|thursday|friday)\s+(at\s+)?(\d{1,2})(:(\d{2}))?\s*(am|pm)',
                r'next\s+(monday|tuesday|wednesday|thursday|friday)',
            ]
            for pattern in time_patterns:
                matches = regex_module.findall(pattern, text_lower)
                for match in matches:
                    if isinstance(match, tuple):
                        proposed_times.append(' '.join(m for m in match if m).strip())
                    else:
                        proposed_times.append(match.strip())

            print(f"DEBUG: meeting_keywords found: {any(kw in text_lower for kw in meeting_keywords)}, time_keywords found: {any(kw in text_lower for kw in time_keywords)}, question_indicators found: {any(ind in text_lower for ind in question_indicators)}")
            print(f"DEBUG: is_meeting_request: {is_meeting_request}, proposed_times: {proposed_times}")

            # RULE-BASED ATTACHMENT DETECTION
            # Check if the email mentions attachments but has none
            has_attachments = data.get('has_attachments', False)
            attachment_keywords = [
                'attached', 'attachment', 'enclosed', 'see attached', 'find attached',
                'please find', 'see the attached', 'attached file', 'attached document',
                'attached resume', 'attached cv', 'attached is', 'i have attached',
                'i\'ve attached', 'i am attaching', 'attachment is', 'attachments are'
            ]
            mentions_attachment = any(kw in text_lower for kw in attachment_keywords)

            # Also check for file extension mentions
            file_extensions = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt', '.png', '.jpg', '.jpeg']
            mentions_file_extension = any(ext in text_lower for ext in file_extensions)

            # Detect if sender says they attached something but we don't see any
            missing_attachment_warning = None
            if (mentions_attachment or mentions_file_extension) and not has_attachments:
                missing_attachment_warning = "They mentioned an attachment but none found in the email"
                print(f"ATTACHMENT WARNING: {missing_attachment_warning}")

            # Extract potential document types mentioned (for attachment suggestions)
            mentioned_document_types = []
            document_type_keywords = {
                'resume': ['resume', 'cv', 'curriculum vitae', 'cv attached'],
                'cover_letter': ['cover letter', 'cover letter attached'],
                'portfolio': ['portfolio', 'work samples'],
                'transcript': ['transcript', 'academic transcript', 'grades'],
                'report': ['report', 'project report', 'status report'],
                'proposal': ['proposal', 'project proposal'],
                'invoice': ['invoice', 'billing', 'receipt'],
                'contract': ['contract', 'agreement', 'nda'],
            }
            for doc_type, keywords in document_type_keywords.items():
                if any(kw in text_lower for kw in keywords):
                    mentioned_document_types.append(doc_type)

            # RULE-BASED: If meeting detected, return immediately without calling OpenAI
            # This is faster and more reliable than waiting for OpenAI API
            if is_meeting_request:
                meeting_request = {
                    'is_meeting': True,
                    'proposed_times': proposed_times[:5] if proposed_times else [],
                    'duration_minutes': 60,
                    'subject': subject
                }
                print(f"RULE-BASED: Meeting request detected, returning immediately: {meeting_request}")
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                resp = {
                    'success': True,
                    'questions': [],
                    'suggested_formality_score': 50,
                    'requires_reply': True,
                    'reply_reasoning': 'Meeting request detected',
                    'meeting_request': meeting_request,
                    'missing_attachment_warning': missing_attachment_warning,
                    'mentioned_document_types': mentioned_document_types
                }
                self.wfile.write(json.dumps(resp).encode())
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

            # Create rule_based_meeting from the detection done earlier
            rule_based_meeting = None
            if is_meeting_request:
                rule_based_meeting = {
                    'is_meeting': True,
                    'proposed_times': proposed_times[:5] if proposed_times else [],
                    'duration_minutes': 60,
                    'subject': subject
                }
                print(f"RULE-BASED: Detected meeting request with proposed_times: {proposed_times[:5] if proposed_times else []}")

            prompt = f"""You are analyzing an email to identify ONLY the essential questions the AI cannot answer on its own.

Email from: {sender}
Subject: {subject}

Email body:
{body_text[:1500]}
{past_context}

**IMPORTANT**: Your job is to find ONLY questions that REQUIRE human input. The AI should NEVER guess or make assumptions.

**DO NOT extract questions about:**
- Meeting scheduling (handled by calendar integration)
- Timing availability (handled separately)
- Facts the AI could reasonably infer from context
- Information that's optional or "nice to have"

**ONLY extract questions that MUST be answered:**
- Specific choices the user must make (lunch option, yes/no commitments)
- Personal preferences the AI cannot know (opinions, tastes, decisions)
- Information unique to the user that isn't mentioned in the email
- Confirmations/decisions that only the user can make

**Question types:**
- "choice" - for questions with 2-6 specific options provided in the email, or yes/no questions
- "text" - for open-ended questions requiring specific user input (not opinions unless critical)

**Examples of QUESTIONS TO EXTRACT:**
- "Pizza or burgers for lunch?" → choice: ["Pizza", "Burgers"]
- "Can you attend the meeting?" → choice: ["Yes", "No"]
- "Should I use Python or JavaScript?" → choice: ["Python", "JavaScript"]
- "What's your zip code?" → text (specific info AI can't know)
- "Which address should we ship to?" → choice (if options given) or text

**Examples of questions to SKIP (AI can handle or not required):**
- "When are you free for a meeting?" → SKIP (calendar handles this)
- "Are you available next week?" → SKIP (meeting detection handles this)
- "What time works for you?" → SKIP (calendar integration)
- "How was your weekend?" → SKIP (optional, AI can give generic response)
- "Any updates on the project?" → SKIP (AI can describe what it knows, ask for clarification if needed)
- "Do you have any questions?" → SKIP (AI can determine this itself)
- General "How are you?" → SKIP (AI can give generic friendly response)

**Return JSON format:**
{{
  "questions": [
    {{"type": "choice", "question": "What would you like for lunch?", "options": ["Pizza", "Burgers", "Salad"]}},
    {{"type": "text", "question": "What's your preferred meeting method?", "options": []}}
  ],
  "requires_reply": true/false,
  "reply_reasoning": "brief explanation of why reply is/isn't needed (max 15 words)",
  "suggested_formality_score": 0-100 number,
  "meeting_request": {{"is_meeting": false}} // ALWAYS false - meeting detection handled separately
}}

**Formality scoring (0-100):**
- CASUAL (0-30): slang, emojis, all lowercase, "hey", "hi", abbreviations
- NEUTRAL (31-70): standard business communication
- FORMAL (71-100): "Dear", "Sincerely", proper salutations, "would you kindly"

If NO essential questions require user input, return: {{"questions": [], "requires_reply": false, "reply_reasoning": "No user input needed", "suggested_formality_score": 50, "meeting_request": {{"is_meeting": false}}}}

Return ONLY valid JSON."""

            messages = [{"role": "user", "content": prompt}]
            result, error = call_anthropic_with_retry(messages, max_tokens=500, temperature=0.3, timeout=10)

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

                        # Get meeting_request data first
                        meeting_request = result_data.get('meeting_request', {'is_meeting': False})
                        if not isinstance(meeting_request, dict) or not meeting_request:
                            meeting_request = {'is_meeting': False}
                        # Ensure meeting_request has required fields
                        if 'is_meeting' not in meeting_request:
                            meeting_request['is_meeting'] = False
                        if 'proposed_times' not in meeting_request:
                            meeting_request['proposed_times'] = []
                        if 'duration_minutes' not in meeting_request:
                            meeting_request['duration_minutes'] = 60
                        if 'subject' not in meeting_request:
                            meeting_request['subject'] = subject

                        # Filter out availability questions when meeting is detected
                        # The meeting UI will handle scheduling, so don't duplicate with Yes/No questions
                        if meeting_request.get('is_meeting'):
                            availability_keywords = ['free', 'available', 'work', 'good time', 'schedule']
                            filtered_questions = []
                            for q in questions:
                                q_text = q.get('question', '').lower()
                                # Keep questions that aren't just about availability for the proposed times
                                is_availability_question = any(kw in q_text for kw in availability_keywords)
                                # Also check if options are just Yes/No (typical for availability)
                                is_yes_no = set(q.get('options', [])) == {'Yes', 'No'} or set(q.get('options', [])) == {'yes', 'no'}

                                if not (is_availability_question and is_yes_no):
                                    filtered_questions.append(q)
                                else:
                                    print(f"Filtering out availability question (handled by meeting UI): {q.get('question')}")
                            questions = filtered_questions

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

                        # FALLBACK: If AI didn't detect meeting but rule-based did, use rule-based
                        if not meeting_request.get('is_meeting') and rule_based_meeting:
                            print(f"AI didn't detect meeting, using rule-based fallback: {rule_based_meeting}")
                            meeting_request = rule_based_meeting
                            requires_reply = True
                            reply_reasoning = "Meeting request detected"

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
                        # Use rule-based meeting detection if AI failed completely
                        meeting_request = rule_based_meeting if rule_based_meeting else {'is_meeting': False, 'proposed_times': [], 'duration_minutes': 60, 'subject': subject}

                    print(f"Email analysis found {len(questions)} questions, requires_reply: {requires_reply}, suggested formality score: {suggested_formality_score}, is_meeting: {meeting_request.get('is_meeting', False)}")
                    resp = {
                        'success': True,
                        'questions': questions,
                        'suggested_formality_score': suggested_formality_score,
                        'requires_reply': requires_reply,
                        'reply_reasoning': reply_reasoning,
                        'meeting_request': meeting_request,
                        'missing_attachment_warning': missing_attachment_warning,
                        'mentioned_document_types': mentioned_document_types
                    }
                    self.wfile.write(json.dumps(resp).encode())
                except json.JSONDecodeError as e:
                    print(f"Failed to parse AI response as JSON: {e}, result was: {result[:500]}")
                    # Use rule-based questions as fallback
                    meeting_request_fb = rule_based_meeting if rule_based_meeting else {'is_meeting': False, 'proposed_times': [], 'duration_minutes': 60, 'subject': subject}
                    if rule_based_questions:
                        print(f"Using rule-based questions after parse error: {rule_based_questions}")
                        resp = {
                            'success': True,
                            'questions': rule_based_questions,
                            'suggested_formality_score': 50,
                            'requires_reply': True,
                            'reply_reasoning': 'Questions found in email',
                            'meeting_request': meeting_request_fb,
                            'missing_attachment_warning': missing_attachment_warning,
                            'mentioned_document_types': mentioned_document_types
                        }
                    else:
                        resp = {
                            'success': True,
                            'questions': [],
                            'suggested_formality_score': 50,
                            'requires_reply': rule_based_meeting is not None,
                            'reply_reasoning': 'Meeting request' if rule_based_meeting else '',
                            'meeting_request': meeting_request_fb,
                            'missing_attachment_warning': missing_attachment_warning,
                            'mentioned_document_types': mentioned_document_types
                        }
                    self.wfile.write(json.dumps(resp).encode())
            else:
                print(f"Failed to analyze email: {error}")
                meeting_request_fb = rule_based_meeting if rule_based_meeting else {'is_meeting': False, 'proposed_times': [], 'duration_minutes': 60, 'subject': subject}
                resp = {
                    'success': True,
                    'questions': [],
                    'suggested_formality_score': 50,
                    'requires_reply': rule_based_meeting is not None,
                    'reply_reasoning': 'Meeting request' if rule_based_meeting else '',
                    'meeting_request': meeting_request_fb,
                    'missing_attachment_warning': missing_attachment_warning,
                    'mentioned_document_types': mentioned_document_types
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
        """Generate email reply using Anthropic API"""
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

            # GenAI evaluation parameters (Milestone 6)
            requested_approach = data.get('approach')  # If unspecified, dispatcher picks the default
            compare_mode = bool(data.get('compare'))   # When true, return two responses from different approaches

            if not os.getenv('ANTHROPIC_API_KEY'):
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                response = {'success': False, 'error': 'ANTHROPIC_API_KEY not configured'}
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

            # Build sender tone section if available
            sender_tone = data.get('sender_tone', None)
            sender_tone_section = ""
            if sender_tone:
                sender_tone_section = f"\n\nSENDER'S TONE: {sender_tone} — Adapt your reply tone accordingly. For example, if frustrated/angry, be empathetic and solution-oriented. If excited, match their enthusiasm. If formal, stay formal.\n"

            # Determine style instruction based on user's chosen formality level
            if formality_level == 'formal':
                style_instruction = "Use a formal, respectful tone appropriate for academic or professional contexts. Use proper salutations (e.g., 'Dear [Name]') and sign-offs (e.g., 'Best regards' or 'Sincerely')."
            elif formality_level == 'casual':
                style_instruction = "Use a friendly, casual tone - be relaxed and informal. Use casual greetings (e.g., 'Hi' or 'Hey') and casual sign-offs (e.g., 'Best' or just your name)."
            else:  # neutral
                style_instruction = "Use a professional but approachable tone. Balance friendliness with professionalism."

            # Build the shared context dict consumed by every approach in
            # genai_approaches.APPROACHES. Each approach picks the keys it
            # needs - the dict is a superset.
            approach_context = {
                "user_name": user_name,
                "sender": sender,
                "subject": subject,
                "body_text": body_text,
                "recipient_first_name": recipient_first_name,
                "recipient_emails": recipient_emails,
                "user_answers": user_answers,
                "user_answers_context": user_answers_context,
                "additional_context": additional_context,
                "additional_context_section": additional_context_section,
                "sender_tone_section": sender_tone_section,
                "style_instruction": style_instruction,
            }

            # Send response headers before writing body
            self.send_header('Content-type', 'application/json')
            self.end_headers()

            if compare_mode:
                # Pick two distinct approaches and run them sequentially.
                # (Sequential keeps the rate-limiter happy; parallel would
                # require care to keep ordering deterministic.)
                approach_a, approach_b = genai_approaches.pick_random_pair()
                reply_a, err_a, _ = genai_approaches.generate(
                    approach_a, approach_context, call_anthropic_with_retry
                )
                reply_b, err_b, _ = genai_approaches.generate(
                    approach_b, approach_context, call_anthropic_with_retry
                )

                if reply_a:
                    reply_a = clean_reply(reply_a)
                if reply_b:
                    reply_b = clean_reply(reply_b)

                if not reply_a or not reply_b:
                    resp = {
                        'success': False,
                        'error': f'Comparison failed: A={err_a or "ok"}, B={err_b or "ok"}',
                    }
                    self.wfile.write(json.dumps(resp).encode())
                    return

                comparison_id = str(uuid.uuid4())
                # Track that both approaches were shown to the user
                elo_ranking.record_exposure([approach_a, approach_b])

                event_logger(self, event_name="reply_compare_shown",
                             metadata={"subject": subject[:50],
                                       "comparison_id": comparison_id,
                                       "approach_a": approach_a,
                                       "approach_b": approach_b})

                resp = {
                    'success': True,
                    'comparison': True,
                    'comparison_id': comparison_id,
                    'responses': [
                        {'approach_id': approach_a, 'reply': reply_a},
                        {'approach_id': approach_b, 'reply': reply_b},
                    ],
                }
                self.wfile.write(json.dumps(resp).encode())
            else:
                # Single-approach mode (default behavior). If the caller
                # didn't specify an approach, the dispatcher uses
                # DEFAULT_APPROACH ("few_shot") - this preserves the
                # current production UX.
                reply, error, approach_used = genai_approaches.generate(
                    requested_approach, approach_context, call_anthropic_with_retry
                )

                if reply:
                    reply = clean_reply(reply)
                    print(f"AI reply generated successfully via approach={approach_used}!")

                    elo_ranking.record_exposure([approach_used])

                    # A/B test: log that a reply was generated (target event)
                    event_logger(self, event_name="reply_button_click",
                                 metadata={"subject": subject[:50],
                                           "approach": approach_used})

                    resp = {'success': True, 'reply': reply, 'approach': approach_used}
                    self.wfile.write(json.dumps(resp).encode())
                else:
                    print(f"Failed to generate reply ({approach_used}): {error}")
                    resp = {'success': False, 'error': f'Failed to generate reply: {error}',
                            'approach': approach_used}
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

    # ------------------------------------------------------------------
    # Milestone 6: GenAI evaluation endpoints
    # ------------------------------------------------------------------

    def handle_genai_preference(self):
        """Record a user preference between two approach outputs and update ELO.

        Request body:
            {
              "approach_a": "<id>",
              "approach_b": "<id>",
              "preferred":  "<id> | 'tie'",
              "comparison_id": "<uuid from /generate-reply compare response>",
              "metadata": { ... }   # optional
            }
        """
        try:
            self.send_header('Content-type', 'application/json')
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body) if body else {}

            approach_a = data.get('approach_a')
            approach_b = data.get('approach_b')
            preferred = data.get('preferred')

            if not approach_a or not approach_b or not preferred:
                self.end_headers()
                self.wfile.write(json.dumps({
                    'success': False,
                    'error': 'approach_a, approach_b, and preferred are required',
                }).encode())
                return

            user_id = None
            if USER_INFO_FILE.exists():
                try:
                    with open(USER_INFO_FILE, 'r') as f:
                        user_id = json.load(f).get('email')
                except Exception:
                    pass

            metadata = data.get('metadata', {}) or {}
            if data.get('comparison_id'):
                metadata['comparison_id'] = data['comparison_id']

            result = elo_ranking.record_preference(
                approach_a=approach_a,
                approach_b=approach_b,
                preferred=preferred,
                user_id=user_id,
                metadata=metadata,
            )

            event_logger(self, event_name="genai_preference",
                         metadata={'approach_a': approach_a,
                                   'approach_b': approach_b,
                                   'preferred': preferred,
                                   'comparison_id': data.get('comparison_id')})

            self.end_headers()
            self.wfile.write(json.dumps({'success': True, **result}).encode())
        except ValueError as e:
            self.end_headers()
            self.wfile.write(json.dumps({'success': False, 'error': str(e)}).encode())
        except Exception as e:
            print(f"Error recording GenAI preference: {e}")
            import traceback
            traceback.print_exc()
            self.end_headers()
            self.wfile.write(json.dumps({'success': False, 'error': str(e)}).encode())

    def handle_genai_rankings(self):
        """Return the current ELO ranking of approaches (sorted desc)."""
        self.send_header('Content-type', 'application/json')
        self.end_headers()
        try:
            ratings = elo_ranking.get_ratings()
            self.wfile.write(json.dumps({
                'success': True,
                'rankings': ratings,
                'k_factor': elo_ranking.K_FACTOR,
                'initial_rating': elo_ranking.INITIAL_RATING,
            }).encode())
        except Exception as e:
            self.wfile.write(json.dumps({'success': False, 'error': str(e)}).encode())

    def handle_genai_approaches(self):
        """Return the registered set of GenAI approaches and their metadata."""
        self.send_header('Content-type', 'application/json')
        self.end_headers()
        try:
            self.wfile.write(json.dumps({
                'success': True,
                'default': genai_approaches.DEFAULT_APPROACH,
                'approaches': genai_approaches.list_approaches(),
            }).encode())
        except Exception as e:
            self.wfile.write(json.dumps({'success': False, 'error': str(e)}).encode())

    def handle_edit_reply(self):
        """Edit an email reply using AI based on user's edit prompt"""
        try:
            # Get request body FIRST before sending any response
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8'))

            current_reply = data.get('current_reply', '')
            edit_prompt = data.get('edit_prompt', '')

            if not os.getenv('ANTHROPIC_API_KEY'):
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                response = {'success': False, 'error': 'ANTHROPIC_API_KEY not configured'}
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
            edited_reply, error = call_anthropic_with_retry(messages, max_tokens=500, temperature=0.7, timeout=10)

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
            summary_result = summarize_email(subject, sender, body_text, snippet)

            # Now send response headers (note: send_response already called in do_POST)
            self.send_header('Content-type', 'application/json')
            self.end_headers()

            if summary_result and summary_result.get('summary'):
                resp = {
                    'success': True,
                    'summary': summary_result.get('summary'),
                    'key_points': summary_result.get('key_points', []),
                    'action_items': summary_result.get('action_items', [])
                }
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

    def handle_get_attachment(self):
        """Fetch attachment data from Gmail"""
        try:
            # Get query parameters
            parsed_url = urlparse(self.path)
            query_params = parse_qs(parsed_url.query)

            message_id = query_params.get('messageId', [''])[0]
            attachment_id = query_params.get('attachmentId', [''])[0]

            if not message_id or not attachment_id:
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                response = {'success': False, 'error': 'Missing messageId or attachmentId'}
                self.wfile.write(json.dumps(response).encode())
                return

            # Get stored credentials
            creds = get_stored_credentials()

            if not creds:
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                response = {'success': False, 'error': 'Not authenticated'}
                self.wfile.write(json.dumps(response).encode())
                return

            # Build Gmail service
            service = build('gmail', 'v1', credentials=creds)

            # Fetch the attachment
            attachment = service.users().messages().attachments().get(
                userId='me',
                messageId=message_id,
                id=attachment_id
            ).execute()

            # Get the attachment data
            import base64
            data = attachment.get('data', '')
            size = attachment.get('size', 0)

            if data:
                # Decode the base64url data
                decoded_data = base64.urlsafe_b64decode(data)

                self.send_header('Content-type', 'application/json')
                self.end_headers()
                response = {
                    'success': True,
                    'data': base64.b64encode(decoded_data).decode('ascii'),  # Regular base64 for JSON
                    'size': size
                }
                self.wfile.write(json.dumps(response).encode())
            else:
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                response = {'success': False, 'error': 'No attachment data found'}
                self.wfile.write(json.dumps(response).encode())

        except Exception as e:
            print(f"Error fetching attachment: {e}")
            import traceback
            traceback.print_exc()
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            response = {'success': False, 'error': f'Failed to fetch attachment: {str(e)}'}
            self.wfile.write(json.dumps(response).encode())

    def handle_summarize_attachment(self):
        """Summarize an attachment (PDF, doc, etc.) using AI"""
        try:
            import base64
            import io

            # Get request body
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8'))

            filename = data.get('filename', '')
            attachment_data = data.get('data', '')  # base64 encoded
            mime_type = data.get('mimeType', '')

            if not attachment_data:
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                response = {'success': False, 'error': 'No attachment data provided'}
                self.wfile.write(json.dumps(response).encode())
                return

            print(f"Summarizing attachment: {filename} ({mime_type})")

            # Decode the base64 data
            file_data = base64.b64decode(attachment_data)

            # Extract text based on file type
            extracted_text = ""

            if mime_type == 'application/pdf':
                # Try to extract text from PDF
                try:
                    import PyPDF2
                    pdf_file = io.BytesIO(file_data)
                    pdf_reader = PyPDF2.PdfReader(pdf_file)
                    extracted_text = ""
                    for page in pdf_reader.pages:
                        extracted_text += page.extract_text() + "\n"
                    print(f"Extracted {len(extracted_text)} characters from PDF")
                except ImportError:
                    print("PyPDF2 not installed, trying pdfplumber...")
                    try:
                        import pdfplumber
                        with pdfplumber.open(io.BytesIO(file_data)) as pdf:
                            for page in pdf.pages:
                                extracted_text += page.extract_text() + "\n"
                            print(f"Extracted {len(extracted_text)} characters from PDF")
                    except ImportError:
                        response = {'success': False, 'error': 'PDF parsing library not installed. Install with: pip install PyPDF2'}
                        self.send_header('Content-type', 'application/json')
                        self.end_headers()
                        self.wfile.write(json.dumps(response).encode())
                        return
                except Exception as e:
                    print(f"Error extracting PDF text: {e}")

            elif mime_type in ['application/msword',
                               'application/vnd.openxmlformats-officedocument.wordprocessingml.document']:
                # Try to extract text from Word documents
                try:
                    import docx
                    doc_file = io.BytesIO(file_data)
                    doc = docx.Document(doc_file)
                    extracted_text = "\n".join([para.text for para in doc.paragraphs])
                    print(f"Extracted {len(extracted_text)} characters from Word doc")
                except ImportError:
                    response = {'success': False, 'error': 'Word document parsing library not installed. Install with: pip install python-docx'}
                    self.send_header('Content-type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps(response).encode())
                    return
                except Exception as e:
                    print(f"Error extracting Word doc text: {e}")

            elif mime_type.startswith('text/'):
                # Plain text file
                extracted_text = file_data.decode('utf-8', errors='ignore')
                print(f"Extracted {len(extracted_text)} characters from text file")

            elif mime_type in ['application/vnd.ms-powerpoint',
                               'application/vnd.openxmlformats-officedocument.presentationml.presentation']:
                # PowerPoint - limited text extraction
                try:
                    import zipfile
                    with zipfile.ZipFile(io.BytesIO(file_data)) as zip_ref:
                        # Extract text from slide XML files
                        for file_name in zip_ref.namelist():
                            if file_name.startswith('ppt/slides/slide') and file_name.endswith('.xml'):
                                xml_content = zip_ref.read(file_name).decode('utf-8', errors='ignore')
                                # Simple text extraction - remove XML tags
                                import re
                                text_matches = re.findall(r'<a:t>([^<]+)</a:t>', xml_content)
                                extracted_text += " ".join(text_matches) + "\n"
                        print(f"Extracted {len(extracted_text)} characters from PowerPoint")
                except Exception as e:
                    print(f"Error extracting PowerPoint text: {e}")

            else:
                # For unsupported types, try to extract any readable text
                try:
                    extracted_text = file_data.decode('utf-8', errors='ignore')[:5000]
                except:
                    extracted_text = f"[Unsupported file type: {mime_type}. Cannot extract text for summarization.]"

            if not extracted_text or len(extracted_text.strip()) < 10:
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                response = {'success': False, 'error': 'Could not extract meaningful text from the file'}
                self.wfile.write(json.dumps(response).encode())
                return

            # Limit text for API - take first 8000 characters
            text_for_summary = extracted_text[:8000] if len(extracted_text) > 8000 else extracted_text

            # Generate summary using AI
            prompt = f"""Summarize the content of this document (filename: {filename}) in 2-3 sentences.
Focus on the key points, main topics, and any action items or important information.

Document content:
{text_for_summary}

Provide only the summary, no preamble."""

            messages = [{"role": "user", "content": prompt}]
            summary, error = call_anthropic_with_retry(messages, max_tokens=300, temperature=0.3, timeout=30)

            self.send_header('Content-type', 'application/json')
            self.end_headers()

            if summary:
                resp = {
                    'success': True,
                    'summary': summary,
                    'extracted_text_length': len(extracted_text)
                }
                self.wfile.write(json.dumps(resp).encode())
            else:
                # Return the extracted text even if summarization failed
                resp = {
                    'success': True,
                    'summary': extracted_text[:500] + "..." if len(extracted_text) > 500 else extracted_text,
                    'extracted_text_length': len(extracted_text),
                    'note': 'AI summarization failed, showing raw text excerpt'
                }
                self.wfile.write(json.dumps(resp).encode())

        except Exception as e:
            print(f"Error summarizing attachment: {e}")
            import traceback
            traceback.print_exc()
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            response = {'success': False, 'error': f'Failed to summarize attachment: {str(e)}'}
            self.wfile.write(json.dumps(response).encode())

    def handle_search_attachments(self):
        """Search recent emails for attachments that might be relevant to the current conversation"""
        try:
            # Get request body
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8'))

            search_keywords = data.get('keywords', [])
            sender_email = data.get('sender_email', '')
            max_results = data.get('max_results', 10)

            print(f"Searching attachments with keywords: {search_keywords}, sender: {sender_email}")

            # Get stored credentials
            creds = get_stored_credentials()

            if not creds:
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                response = {'success': False, 'error': 'Not authenticated'}
                self.wfile.write(json.dumps(response).encode())
                return

            # Build Gmail service
            service = build('gmail', 'v1', credentials=creds)

            # Build search query - look for emails with attachments
            query_parts = ['has:attachment']

            # Add keywords if provided
            if search_keywords:
                keyword_query = ' OR '.join([f'filename:{kw}' for kw in search_keywords[:3]])
                query_parts.append(f'({keyword_query})')

            # Search in sent folder for attachments the user has sent
            query_parts.append('in:sent')

            query = ' '.join(query_parts)

            # Search for messages
            results = service.users().messages().list(
                userId='me',
                maxResults=max_results,
                q=query
            ).execute()

            messages = results.get('messages', [])
            found_attachments = []

            for message in messages[:max_results]:
                try:
                    msg = service.users().messages().get(
                        userId='me',
                        id=message['id'],
                        format='full'
                    ).execute()

                    # Extract headers
                    headers = {h['name']: h['value'] for h in msg.get('payload', {}).get('headers', [])}
                    to_header = headers.get('To', '')
                    subject = headers.get('Subject', '')

                    # Extract attachments
                    attachments = extract_attachments(msg)

                    # Filter attachments by keyword relevance
                    for att in attachments:
                        att_filename_lower = att['filename'].lower()

                        # Check if filename matches any keywords
                        relevance_score = 0
                        for keyword in search_keywords:
                            if keyword.lower() in att_filename_lower:
                                relevance_score += 1

                        # Also check if sent to this sender before (contextual relevance)
                        if sender_email and sender_email.lower() in to_header.lower():
                            relevance_score += 0.5

                        if relevance_score > 0 or not search_keywords:
                            # Get the message details for this attachment
                            found_attachments.append({
                                'filename': att['filename'],
                                'mimeType': att['mimeType'],
                                'size': att['size'],
                                'attachmentId': att['id'],
                                'messageId': msg['id'],
                                'subject': subject,
                                'to': to_header,
                                'date': headers.get('Date', ''),
                                'relevanceScore': relevance_score
                            })

                except Exception as e:
                    print(f"Error parsing message {message.get('id', 'unknown')}: {e}")
                    continue

            # Sort by relevance score
            found_attachments.sort(key=lambda x: x['relevanceScore'], reverse=True)

            self.send_header('Content-type', 'application/json')
            self.end_headers()

            response = {
                'success': True,
                'attachments': found_attachments[:max_results],
                'total': len(found_attachments)
            }
            self.wfile.write(json.dumps(response).encode())

        except Exception as e:
            print(f"Error searching attachments: {e}")
            import traceback
            traceback.print_exc()
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            response = {'success': False, 'error': f'Failed to search attachments: {str(e)}'}
            self.wfile.write(json.dumps(response).encode())

    def handle_execute_command(self):
        """Execute a shell command to open a file (for attachment preview)"""
        import subprocess
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8'))

            command = data.get('command', '')
            print(f"[execute-command] Executing: {command}")

            # Execute the command
            result = subprocess.run(command, shell=True, capture_output=True, text=True)

            if result.returncode == 0:
                response = {'success': True, 'message': 'Command executed successfully'}
            else:
                print(f"[execute-command] Command failed: {result.stderr}")
                response = {'success': False, 'error': result.stderr}

            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(response).encode())

        except Exception as e:
            print(f"Error executing command: {e}")
            import traceback
            traceback.print_exc()
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            response = {'success': False, 'error': f'Failed to execute command: {str(e)}'}
            self.wfile.write(json.dumps(response).encode())

    def handle_calendar(self):
        """Handle calendar operations - find free slots or create events"""
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8'))

            action = data.get('action', '')
            # Get timezone from request, default to Eastern Time
            user_timezone = data.get('timezone', 'America/New_York')
            creds = get_stored_credentials()

            if not creds:
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                response = {'success': False, 'error': 'Not authenticated. Please sign in first.'}
                self.wfile.write(json.dumps(response).encode())
                return

            # Build Calendar service
            try:
                calendar_service = build('calendar', 'v3', credentials=creds)
            except Exception as e:
                print(f"Error building calendar service: {e}")
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                response = {'success': False, 'error': f'Calendar service error: {str(e)}'}
                self.wfile.write(json.dumps(response).encode())
                return

            if action == 'check_conflict':
                # Check if proposed times have conflicts in calendar
                proposed_times = data.get('proposed_times', [])
                duration_minutes = data.get('duration_minutes', 60)
                print(f"[DEBUG check_conflict] proposed_times={proposed_times}, duration={duration_minutes}")

                from datetime import datetime, timedelta, timezone
                from dateutil import parser as date_parser
                import pytz

                pacific = pytz.timezone(user_timezone)
                utc_now = datetime.now(timezone.utc)
                now_pacific = utc_now.astimezone(pacific)

                conflict_results = []

                # Pre-fetch all events for the relevant range (uses cache)
                all_parsed = []
                for time_str in proposed_times:
                    parsed_dt = parse_natural_time(time_str, now_pacific, user_timezone)
                    all_parsed.append((time_str, parsed_dt))

                # Determine the full range needed
                valid_times = [dt for _, dt in all_parsed if dt]
                if valid_times:
                    range_start = min(valid_times) - timedelta(hours=1)
                    range_end = max(valid_times) + timedelta(hours=2)
                    all_events = get_cached_calendar_events(calendar_service, range_start.isoformat(), range_end.isoformat())
                else:
                    all_events = []

                for time_str, parsed_dt in all_parsed:
                    try:
                        if parsed_dt:
                            # Filter cached events for this time window
                            window_start = parsed_dt - timedelta(minutes=30)
                            window_end = parsed_dt + timedelta(minutes=90)

                            events = [ev for ev in all_events
                                      if (ev.get('start', {}).get('dateTime') and
                                          window_start <= date_parser.parse(ev['start']['dateTime']).astimezone(pacific) <= window_end)]

                            # Check if any events overlap with the proposed time slot
                            slot_end = parsed_dt + timedelta(minutes=duration_minutes)
                            has_conflict = False
                            conflicting_events = []

                            for event in events:
                                event_start_str = event.get('start', {}).get('dateTime')
                                if event_start_str:
                                    event_start = date_parser.parse(event_start_str)
                                    # Convert to Pacific if naive
                                    if event_start.tzinfo is None:
                                        event_start = pacific.localize(event_start)
                                    else:
                                        event_start = event_start.astimezone(pacific)

                                    event_end_str = event.get('end', {}).get('dateTime')
                                    if event_end_str:
                                        event_end = date_parser.parse(event_end_str)
                                        if event_end.tzinfo is None:
                                            event_end = pacific.localize(event_end)
                                        else:
                                            event_end = event_end.astimezone(pacific)

                                        # Check for overlap
                                        if not (event_end <= parsed_dt or event_start >= slot_end):
                                            has_conflict = True
                                            conflicting_events.append({
                                                'summary': event.get('summary', 'Busy'),
                                                'start': event_start.strftime('%I:%M %p').lstrip('0'),
                                                'end': event_end.strftime('%I:%M %p').lstrip('0')
                                            })

                            # Format the proposed time for display
                            display_date = parsed_dt.strftime('%A, %B %d')
                            display_time = parsed_dt.strftime('%I:%M %p').lstrip('0')

                            conflict_results.append({
                                'original_time': time_str,
                                'date': display_date,
                                'time': display_time,
                                'start': parsed_dt.isoformat(),
                                'end': slot_end.isoformat(),
                                'has_conflict': has_conflict,
                                'conflicting_events': conflicting_events
                            })
                        else:
                            # Couldn't parse, keep original
                            conflict_results.append({
                                'original_time': time_str,
                                'date': 'Unknown date',
                                'time': time_str,
                                'has_conflict': None,  # Unknown
                                'conflicting_events': []
                            })
                    except Exception as e:
                        import traceback
                        print(f"Error checking conflict for '{time_str}': {e}")
                        traceback.print_exc()
                        conflict_results.append({
                            'original_time': time_str,
                            'date': 'Error checking',
                            'time': time_str,
                            'has_conflict': None,
                            'conflicting_events': []
                        })

                self.send_header('Content-type', 'application/json')
                self.end_headers()
                response = {
                    'success': True,
                    'conflicts': conflict_results
                }
                self.wfile.write(json.dumps(response).encode())

            elif action == 'find_free_slots':
                # Find free time slots for a meeting
                duration_minutes = data.get('duration_minutes', 60)

                from datetime import datetime, timedelta, timezone
                import pytz

                pacific = pytz.timezone(user_timezone)
                utc_now = datetime.now(timezone.utc)
                now_pacific = utc_now.astimezone(pacific)

                # Look for slots starting from tomorrow 9am
                start_date = now_pacific + timedelta(days=1)
                start_date = start_date.replace(hour=9, minute=0, second=0, microsecond=0)

                # Look for the next 7 business days
                free_slots = []
                current_date = start_date

                for day_offset in range(14):  # Check up to 14 days
                    # Skip weekends
                    if current_date.weekday() >= 5:  # 5=Saturday, 6=Sunday
                        current_date += timedelta(days=1)
                        continue

                    # Business hours: 9am to 5pm
                    slot_start = current_date.replace(hour=9, minute=0)
                    slot_end = slot_start + timedelta(hours=8)  # 9am-5pm

                    # Suggest a few time slots per day
                    suggested_times = [
                        (slot_start + timedelta(hours=0)),  # 9am
                        (slot_start + timedelta(hours=2)),  # 11am
                        (slot_start + timedelta(hours=4)),  # 1pm
                        (slot_start + timedelta(hours=6)),  # 3pm
                    ]

                    for slot_time in suggested_times[:3]:  # Max 3 per day
                        slot_end_time = slot_time + timedelta(minutes=duration_minutes)

                        # Check if slot ends before 5pm
                        if slot_end_time.hour < 17:
                            date_str = slot_time.strftime('%A, %B %d')
                            time_str = slot_time.strftime('%I:%M %p').lstrip('0')

                            free_slots.append({
                                'date': date_str,
                                'time': time_str,
                                'start': slot_time.isoformat(),
                                'end': slot_end_time.isoformat()
                            })

                            if len(free_slots) >= 6:  # Max 6 slots total
                                break

                    current_date += timedelta(days=1)
                    if len(free_slots) >= 6:
                        break

                self.send_header('Content-type', 'application/json')
                self.end_headers()
                response = {
                    'success': True,
                    'free_slots': free_slots
                }
                self.wfile.write(json.dumps(response).encode())

            elif action == 'create_event':
                # Create a calendar event
                summary = data.get('summary', 'Meeting')
                start_datetime = data.get('start_datetime')
                end_datetime = data.get('end_datetime')
                attendees = data.get('attendees', [])
                location = data.get('location')

                if not start_datetime or not end_datetime:
                    self.send_header('Content-type', 'application/json')
                    self.end_headers()
                    response = {'success': False, 'error': 'Missing start or end time'}
                    self.wfile.write(json.dumps(response).encode())
                    return

                # Create event body - don't specify timeZone so Google uses the timezone from the ISO string
                event_body = {
                    'summary': summary,
                    'start': {
                        'dateTime': start_datetime,
                    },
                    'end': {
                        'dateTime': end_datetime,
                    },
                }

                # Add location if provided
                if location:
                    event_body['location'] = location

                # Add attendees if provided
                if attendees:
                    event_body['attendees'] = [{'email': email} for email in attendees]

                # Create the event
                created_event = calendar_service.events().insert(
                    calendarId='primary',
                    body=event_body,
                    sendUpdates='all'  # Send invitations to attendees
                ).execute()

                print(f"Created calendar event: {created_event.get('htmlLink')}")

                self.send_header('Content-type', 'application/json')
                self.end_headers()
                response = {
                    'success': True,
                    'event_id': created_event.get('id'),
                    'html_link': created_event.get('htmlLink')
                }
                self.wfile.write(json.dumps(response).encode())

            elif action == 'fetch_events':
                # Fetch calendar events for a date range
                from datetime import datetime, timedelta, timezone
                import pytz

                print("[CALENDAR] fetch_events called")
                print(f"[CALENDAR] Request data: {data}")
                # Extract the nested data object
                request_data = data.get('data', {})
                start_date = request_data.get('start_date')  # ISO date string or 'today'
                end_date = request_data.get('end_date')  # ISO date string or date range end

                # Get timezone from settings or use default
                user_timezone = data.get('timezone', 'America/New_York')
                print(f"[CALENDAR] Received timezone from request: {user_timezone}")
                user_tz = pytz.timezone(user_timezone)
                print(f"[CALENDAR] Using pytz timezone: {user_tz.zone}")

                # Debug: print current time in UTC and in user timezone
                utc_now = datetime.now(timezone.utc)
                print(f"[CALENDAR] Current UTC time: {utc_now}")
                now_user = utc_now.astimezone(user_tz)
                print(f"[CALENDAR] Current time in {user_tz.zone}: {now_user}")

                if start_date == 'today' or not start_date:
                    start_datetime = now_user.replace(hour=0, minute=0, second=0, microsecond=0)
                else:
                    from dateutil import parser as date_parser
                    start_datetime = date_parser.parse(start_date)
                    if start_datetime.tzinfo is None:
                        start_datetime = user_tz.localize(start_datetime)

                if end_date:
                    from dateutil import parser as date_parser
                    end_datetime = date_parser.parse(end_date)
                    if end_datetime.tzinfo is None:
                        end_datetime = user_tz.localize(end_datetime)
                    # End at end of day
                    end_datetime = end_datetime.replace(hour=23, minute=59, second=59)
                else:
                    # Default to 30 days from start
                    end_datetime = start_datetime + timedelta(days=30)

                # Fetch events (uses cache)
                events = get_cached_calendar_events(
                    calendar_service,
                    start_datetime.isoformat(),
                    end_datetime.isoformat()
                )

                # Format events for frontend
                import re as _re
                def _extract_meeting_link(event):
                    non_google_pattern = r'https?://[^\s<>"\']*(?:zoom\.us|teams\.microsoft\.com|webex\.com|gotomeeting\.com)[^\s<>"\']*'
                    for ep in (event.get('conferenceData') or {}).get('entryPoints', []):
                        uri = ep.get('uri', '')
                        if ep.get('entryPointType') == 'video' and uri and 'google.com' not in uri:
                            return uri
                    loc = event.get('location', '') or ''
                    m = _re.search(non_google_pattern, loc)
                    if m:
                        return m.group(0)
                    desc = event.get('description', '') or ''
                    m = _re.search(non_google_pattern, desc)
                    if m:
                        return m.group(0)
                    if event.get('hangoutLink'):
                        return event['hangoutLink']
                    for ep in (event.get('conferenceData') or {}).get('entryPoints', []):
                        if ep.get('entryPointType') == 'video' and ep.get('uri'):
                            return ep['uri']
                    return ''

                formatted_events = []
                for event in events:
                    summary = event.get('summary', 'No title')
                    start_data = event.get('start', {})
                    end_data = event.get('end', {})
                    location = event.get('location', '') or ''
                    description = event.get('description', '') or ''
                    meeting_link = _extract_meeting_link(event)
                    attendees = [a['email'] for a in event.get('attendees', []) if a.get('email')]

                    # Check if this is an all-day event (has 'date' field) or timed event (has 'dateTime' field)
                    if 'date' in start_data:
                        # All-day event
                        from dateutil import parser as date_parser
                        date_str = start_data.get('date')
                        start_dt = date_parser.parse(date_str)
                        if start_dt.tzinfo is None:
                            start_dt = user_tz.localize(start_dt)

                        end_str = end_data.get('date', date_str)
                        end_dt = date_parser.parse(end_str)
                        if end_dt.tzinfo is None:
                            end_dt = user_tz.localize(end_dt)

                        formatted_events.append({
                            'id': event.get('id'),
                            'summary': summary,
                            'start': start_dt.isoformat(),
                            'end': end_dt.isoformat(),
                            'date': start_dt.strftime('%Y-%m-%d'),
                            'time': 'All day',
                            'end_time': '',
                            'all_day': True,
                            'location': location,
                            'description': description,
                            'meeting_link': meeting_link,
                            'attendees': attendees,
                        })
                    elif 'dateTime' in start_data:
                        # Timed event
                        from dateutil import parser as date_parser
                        start_str = start_data.get('dateTime')
                        end_str = end_data.get('dateTime')

                        if not start_str:
                            continue

                        start_dt = date_parser.parse(start_str)

                        # Convert to user's timezone
                        # First get to UTC, then to user timezone
                        if start_dt.tzinfo is None:
                            # No timezone info - assume it's already in user's timezone
                            start_dt = user_tz.localize(start_dt)
                        else:
                            # Has timezone info - convert from that timezone to user's timezone
                            # Force conversion through UTC first
                            from datetime import timezone as dt_timezone
                            utc_dt = start_dt.astimezone(dt_timezone.utc)
                            start_dt = utc_dt.astimezone(user_tz)

                        print(f"[CALENDAR] {summary}: Raw={start_str} -> Converted to {user_tz.zone}={start_dt.strftime('%I:%M %p').lstrip('0')}")

                        # Some events might not have end time, use start + 1 hour as default
                        if end_str:
                            end_dt = date_parser.parse(end_str)
                        else:
                            end_dt = start_dt + timedelta(hours=1)

                        if end_dt.tzinfo is None:
                            end_dt = user_tz.localize(end_dt)
                        else:
                            end_dt = end_dt.astimezone(user_tz)

                        formatted_events.append({
                            'id': event.get('id'),
                            'summary': summary,
                            'start': start_dt.isoformat(),
                            'end': end_dt.isoformat(),
                            'date': start_dt.strftime('%Y-%m-%d'),
                            'time': start_dt.strftime('%I:%M %p').lstrip('0'),
                            'end_time': end_dt.strftime('%I:%M %p').lstrip('0'),
                            'all_day': False,
                            'location': location,
                            'description': description,
                            'meeting_link': meeting_link,
                            'attendees': attendees,
                        })

                # DEBUG: Print the final response
                print(f"[CALENDAR] SENDING {len(formatted_events)} EVENTS TO FRONTEND:")
                for fe in formatted_events[:5]:  # First 5 events
                    print(f"  {fe['summary']}: {fe['time']} (date: {fe['date']})")

                self.send_header('Content-type', 'application/json')
                self.end_headers()
                response = {
                    'success': True,
                    'events': formatted_events
                }
                self.wfile.write(json.dumps(response).encode())

            elif action == 'fetch_url':
                url = data.get('url', '')
                text = ''
                try:
                    import requests as _req
                    import re as _re2
                    from html.parser import HTMLParser as _HTMLParser

                    gdoc_m = _re2.search(r'docs\.google\.com/document/d/([^/?#]+)', url)
                    gslides_m = _re2.search(r'docs\.google\.com/presentation/d/([^/?#]+)', url)
                    gsheet_m = _re2.search(r'docs\.google\.com/spreadsheets/d/([^/?#]+)', url)

                    if gdoc_m or gslides_m or gsheet_m:
                        if gdoc_m:
                            export_url = f'https://docs.google.com/document/d/{gdoc_m.group(1)}/export?format=txt'
                        elif gslides_m:
                            export_url = f'https://docs.google.com/presentation/d/{gslides_m.group(1)}/export?format=txt'
                        else:
                            export_url = f'https://docs.google.com/spreadsheets/d/{gsheet_m.group(1)}/export?format=csv'
                        from google.auth.transport.requests import AuthorizedSession as _AuthSession
                        session = _AuthSession(creds)
                        resp = session.get(export_url, timeout=12)
                        text = resp.text[:6000] if resp.ok else ''
                    else:
                        resp = _req.get(url, timeout=8, headers={'User-Agent': 'Mozilla/5.0'})
                        if resp.ok:
                            class _TE(_HTMLParser):
                                def __init__(self):
                                    super().__init__()
                                    self.chunks = []
                                    self._skip = False
                                def handle_starttag(self, tag, attrs):
                                    if tag in ('script', 'style', 'nav', 'footer', 'head'):
                                        self._skip = True
                                def handle_endtag(self, tag):
                                    if tag in ('script', 'style', 'nav', 'footer', 'head'):
                                        self._skip = False
                                def handle_data(self, d):
                                    if not self._skip and d.strip():
                                        self.chunks.append(d.strip())
                            p = _TE()
                            p.feed(resp.text)
                            text = ' '.join(p.chunks)[:6000]
                except Exception as fe:
                    print(f'[CALENDAR] fetch_url error for {url}: {fe}')

                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'success': True, 'text': text}).encode())

            else:
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                response = {'success': False, 'error': f'Unknown action: {action}'}
                self.wfile.write(json.dumps(response).encode())

        except Exception as e:
            print(f"Error in calendar handler: {e}")
            import traceback
            traceback.print_exc()
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            response = {'success': False, 'error': f'Calendar error: {str(e)}'}
            self.wfile.write(json.dumps(response).encode())

    def handle_scheduling(self):
        """Handle scheduling link operations - create, list, get, availability, book"""
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8'))

            action = data.get('action', '')
            creds = get_stored_credentials()

            if not creds:
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                response = {'success': False, 'error': 'Not authenticated. Please sign in first.'}
                self.wfile.write(json.dumps(response).encode())
                return

            # Build Calendar service
            try:
                calendar_service = build('calendar', 'v3', credentials=creds)
            except Exception as e:
                print(f"Error building calendar service: {e}")
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                response = {'success': False, 'error': f'Calendar service error: {str(e)}'}
                self.wfile.write(json.dumps(response).encode())
                return

            # Import required modules
            import uuid
            from datetime import datetime, timedelta, timezone
            import pytz

            if action == 'create_link':
                # Create a new scheduling link
                title = data.get('title', 'Meeting')
                duration = data.get('duration', 30)
                description = data.get('description', '')
                availability_config = data.get('availability', {})
                user_timezone = data.get('timezone', 'America/New_York')

                # Generate unique link ID
                link_id = str(uuid.uuid4())[:8]

                # Store scheduling link as a special calendar event
                link_config = {
                    'title': title,
                    'duration': duration,
                    'description': description,
                    'timezone': user_timezone,
                    'availability': availability_config,
                    'created_at': datetime.now(timezone.utc).isoformat()
                }

                event_body = {
                    'summary': f'SCHEDULING_LINK: {title}',
                    'description': json.dumps(link_config),
                    'start': {'date': '2999-01-01'},
                    'end': {'date': '2999-01-02'},
                    'transparency': 'transparent',
                    'extendedProperties': {
                        'private': {
                            'link_id': link_id,
                            'is_scheduling_link': 'true',
                            'created_at': datetime.now(timezone.utc).isoformat()
                        }
                    }
                }

                created_event = calendar_service.events().insert(
                    calendarId='primary',
                    body=event_body
                ).execute()

                self.send_header('Content-type', 'application/json')
                self.end_headers()
                response = {
                    'success': True,
                    'link_id': link_id,
                    'event_id': created_event.get('id'),
                    'public_url': f'/book/{link_id}'
                }
                self.wfile.write(json.dumps(response).encode())

            elif action == 'list_links':
                # List all scheduling links for the user
                # Search for events with SCHEDULING_LINK prefix
                events_result = calendar_service.events().list(
                    calendarId='primary',
                    q='SCHEDULING_LINK:',
                    singleEvents=True,
                    orderBy='startTime'
                ).execute()

                events = events_result.get('items', [])
                links = []

                for event in events:
                    summary = event.get('summary', '')
                    if summary.startswith('SCHEDULING_LINK:'):
                        try:
                            config_json = event.get('description', '{}')
                            config = json.loads(config_json)
                            extended_props = event.get('extendedProperties', {})
                            private_props = extended_props.get('private', {})
                            link_id = private_props.get('link_id', '')

                            links.append({
                                'id': link_id,
                                'event_id': event.get('id'),
                                'title': config.get('title', 'Meeting'),
                                'duration': config.get('duration', 30),
                                'description': config.get('description', ''),
                                'timezone': config.get('timezone', 'America/New_York'),
                                'availability': config.get('availability', {}),
                                'created_at': config.get('created_at', ''),
                                'public_url': f'/book/{link_id}'
                            })
                        except json.JSONDecodeError:
                            continue

                self.send_header('Content-type', 'application/json')
                self.end_headers()
                response = {
                    'success': True,
                    'links': links
                }
                self.wfile.write(json.dumps(response).encode())

            elif action == 'get_link':
                # Get scheduling link details by link_id
                link_id = data.get('link_id')

                if not link_id:
                    self.send_header('Content-type', 'application/json')
                    self.end_headers()
                    response = {'success': False, 'error': 'Missing link_id'}
                    self.wfile.write(json.dumps(response).encode())
                    return

                # Search for the scheduling link event
                events_result = calendar_service.events().list(
                    calendarId='primary',
                    q='SCHEDULING_LINK:',
                    singleEvents=True,
                    orderBy='startTime'
                ).execute()

                events = events_result.get('items', [])
                link_data = None

                for event in events:
                    extended_props = event.get('extendedProperties', {})
                    private_props = extended_props.get('private', {})
                    if private_props.get('link_id') == link_id:
                        try:
                            config_json = event.get('description', '{}')
                            config = json.loads(config_json)
                            link_data = {
                                'id': link_id,
                                'event_id': event.get('id'),
                                'title': config.get('title', 'Meeting'),
                                'duration': config.get('duration', 30),
                                'description': config.get('description', ''),
                                'timezone': config.get('timezone', 'America/New_York'),
                                'availability': config.get('availability', {}),
                                'created_at': config.get('created_at', ''),
                                'public_url': f'/book/{link_id}'
                            }
                            break
                        except json.JSONDecodeError:
                            continue

                if link_data:
                    self.send_header('Content-type', 'application/json')
                    self.end_headers()
                    response = {'success': True, 'link': link_data}
                    self.wfile.write(json.dumps(response).encode())
                else:
                    self.send_header('Content-type', 'application/json')
                    self.end_headers()
                    response = {'success': False, 'error': 'Scheduling link not found'}
                    self.wfile.write(json.dumps(response).encode())

            elif action == 'get_availability':
                # Get available time slots for a scheduling link
                link_id = data.get('link_id')

                if not link_id:
                    self.send_header('Content-type', 'application/json')
                    self.end_headers()
                    response = {'success': False, 'error': 'Missing link_id'}
                    self.wfile.write(json.dumps(response).encode())
                    return

                # First, get the link configuration
                events_result = calendar_service.events().list(
                    calendarId='primary',
                    q='SCHEDULING_LINK:',
                    singleEvents=True,
                    orderBy='startTime'
                ).execute()

                events = events_result.get('items', [])
                link_config = None

                for event in events:
                    extended_props = event.get('extendedProperties', {})
                    private_props = extended_props.get('private', {})
                    if private_props.get('link_id') == link_id:
                        try:
                            config_json = event.get('description', '{}')
                            link_config = json.loads(config_json)
                            break
                        except json.JSONDecodeError:
                            continue

                if not link_config:
                    self.send_header('Content-type', 'application/json')
                    self.end_headers()
                    response = {'success': False, 'error': 'Scheduling link not found'}
                    self.wfile.write(json.dumps(response).encode())
                    return

                # Get availability settings
                availability = link_config.get('availability', {})
                duration = link_config.get('duration', 30)
                user_timezone = link_config.get('timezone', 'America/New_York')

                days = availability.get('days', ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'])
                start_hour = availability.get('start_hour', 9)
                end_hour = availability.get('end_hour', 17)

                # Day name to weekday mapping (0=Monday, 6=Sunday)
                day_map = {
                    'monday': 0, 'tuesday': 1, 'wednesday': 2, 'thursday': 3,
                    'friday': 4, 'saturday': 5, 'sunday': 6
                }
                allowed_weekdays = [day_map.get(d.lower(), 0) for d in days]

                user_tz = pytz.timezone(user_timezone)
                utc_now = datetime.now(timezone.utc)
                now_user = utc_now.astimezone(user_tz)

                # Look for slots starting from tomorrow
                start_date = now_user + timedelta(days=1)
                start_date = start_date.replace(hour=0, minute=0, second=0, microsecond=0)

                # Look for the next 14 days
                free_slots = []
                current_date = start_date
                search_end = start_date + timedelta(days=14)

                # Get existing events to check for conflicts
                existing_events_result = calendar_service.events().list(
                    calendarId='primary',
                    timeMin=start_date.isoformat(),
                    timeMax=search_end.isoformat(),
                    singleEvents=True,
                    orderBy='startTime'
                ).execute()

                existing_events = existing_events_result.get('items', [])

                while current_date < search_end:
                    # Check if this day is allowed
                    if current_date.weekday() not in allowed_weekdays:
                        current_date += timedelta(days=1)
                        continue

                    # Generate time slots for this day
                    slot_start = current_date.replace(hour=start_hour, minute=0)
                    day_end = current_date.replace(hour=end_hour, minute=0)

                    while slot_start + timedelta(minutes=duration) <= day_end:
                        slot_end = slot_start + timedelta(minutes=duration)

                        # Check for conflicts with existing events
                        has_conflict = False
                        for event in existing_events:
                            event_start_str = event.get('start', {}).get('dateTime')
                            event_end_str = event.get('end', {}).get('dateTime')

                            if event_start_str and event_end_str:
                                from dateutil import parser as date_parser
                                event_start = date_parser.parse(event_start_str)
                                event_end = date_parser.parse(event_end_str)

                                if event_start.tzinfo is None:
                                    event_start = user_tz.localize(event_start)
                                else:
                                    event_start = event_start.astimezone(user_tz)

                                if event_end.tzinfo is None:
                                    event_end = user_tz.localize(event_end)
                                else:
                                    event_end = event_end.astimezone(user_tz)

                                # Check for overlap
                                if not (event_end <= slot_start or event_start >= slot_end):
                                    has_conflict = True
                                    break

                        if not has_conflict:
                            free_slots.append({
                                'date': slot_start.strftime('%Y-%m-%d'),
                                'date_display': slot_start.strftime('%A, %B %d'),
                                'time': slot_start.strftime('%I:%M %p').lstrip('0'),
                                'start': slot_start.isoformat(),
                                'end': slot_end.isoformat()
                            })

                        # Move to next slot (30-minute intervals)
                        slot_start += timedelta(minutes=30)

                    current_date += timedelta(days=1)

                self.send_header('Content-type', 'application/json')
                self.end_headers()
                response = {
                    'success': True,
                    'link_config': {
                        'title': link_config.get('title', 'Meeting'),
                        'duration': duration,
                        'description': link_config.get('description', ''),
                        'timezone': user_timezone
                    },
                    'available_slots': free_slots[:20]  # Limit to 20 slots
                }
                self.wfile.write(json.dumps(response).encode())

            elif action == 'book_slot':
                # Book a time slot
                link_id = data.get('link_id')
                name = data.get('name', '')
                email = data.get('email', '')
                message = data.get('message', '')
                selected_slot = data.get('selected_slot')  # ISO datetime string

                if not all([link_id, name, email, selected_slot]):
                    self.send_header('Content-type', 'application/json')
                    self.end_headers()
                    response = {'success': False, 'error': 'Missing required fields'}
                    self.wfile.write(json.dumps(response).encode())
                    return

                # Get the link configuration
                events_result = calendar_service.events().list(
                    calendarId='primary',
                    q='SCHEDULING_LINK:',
                    singleEvents=True,
                    orderBy='startTime'
                ).execute()

                events = events_result.get('items', [])
                link_config = None

                for event in events:
                    extended_props = event.get('extendedProperties', {})
                    private_props = extended_props.get('private', {})
                    if private_props.get('link_id') == link_id:
                        try:
                            config_json = event.get('description', '{}')
                            link_config = json.loads(config_json)
                            break
                        except json.JSONDecodeError:
                            continue

                if not link_config:
                    self.send_header('Content-type', 'application/json')
                    self.end_headers()
                    response = {'success': False, 'error': 'Scheduling link not found'}
                    self.wfile.write(json.dumps(response).encode())
                    return

                # Parse the selected slot time
                from dateutil import parser as date_parser
                slot_start = date_parser.parse(selected_slot)
                duration = link_config.get('duration', 30)
                slot_end = slot_start + timedelta(minutes=duration)

                # Get user info for the owner
                owner_email = None
                try:
                    userinfo_service = build('oauth2', 'v2', credentials=creds)
                    user_info = userinfo_service.userinfo().get().execute()
                    owner_email = user_info.get('email')
                    owner_name = user_info.get('name', '')
                except:
                    owner_email = 'me'
                    owner_name = ''

                # Create the calendar event
                title = link_config.get('title', 'Meeting')
                event_summary = f"{title} with {name}"

                # Build description
                event_description = f"Booked via Aiden Scheduling\n\n"
                event_description += f"Attendee: {name} ({email})\n"
                if message:
                    event_description += f"\nMessage:\n{message}\n"

                event_body = {
                    'summary': event_summary,
                    'description': event_description,
                    'start': {
                        'dateTime': slot_start.isoformat(),
                    },
                    'end': {
                        'dateTime': slot_end.isoformat(),
                    },
                    'attendees': [
                        {'email': email, 'displayName': name}
                    ],
                    'extendedProperties': {
                        'private': {
                            'booked_via_link': link_id,
                            'booked_by_name': name,
                            'booked_by_email': email
                        }
                    }
                }

                created_event = calendar_service.events().insert(
                    calendarId='primary',
                    body=event_body,
                    sendUpdates='all'
                ).execute()

                # Send confirmation emails
                try:
                    self.send_booking_confirmation_emails(
                        name, email, owner_email, owner_name,
                        title, slot_start, slot_end, link_config.get('timezone', 'America/New_York'),
                        message, created_event.get('htmlLink')
                    )
                except Exception as e:
                    print(f"Error sending booking confirmation emails: {e}")

                self.send_header('Content-type', 'application/json')
                self.end_headers()
                response = {
                    'success': True,
                    'event_id': created_event.get('id'),
                    'html_link': created_event.get('htmlLink')
                }
                self.wfile.write(json.dumps(response).encode())

            elif action == 'delete_link':
                # Delete a scheduling link
                link_id = data.get('link_id')
                event_id = data.get('event_id')

                if not link_id or not event_id:
                    self.send_header('Content-type', 'application/json')
                    self.end_headers()
                    response = {'success': False, 'error': 'Missing link_id or event_id'}
                    self.wfile.write(json.dumps(response).encode())
                    return

                # Delete the scheduling link event
                calendar_service.events().delete(
                    calendarId='primary',
                    eventId=event_id
                ).execute()

                self.send_header('Content-type', 'application/json')
                self.end_headers()
                response = {'success': True}
                self.wfile.write(json.dumps(response).encode())

            else:
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                response = {'success': False, 'error': f'Unknown action: {action}'}
                self.wfile.write(json.dumps(response).encode())

        except Exception as e:
            print(f"Error in scheduling handler: {e}")
            import traceback
            traceback.print_exc()
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            response = {'success': False, 'error': f'Scheduling error: {str(e)}'}
            self.wfile.write(json.dumps(response).encode())

    def send_booking_confirmation_emails(self, attendee_name, attendee_email, owner_email, owner_name,
                                         meeting_title, slot_start, slot_end, timezone, message, event_link):
        """Send booking confirmation emails to both attendee and owner"""
        import pytz
        from datetime import datetime, timezone as dt_timezone

        user_tz = pytz.timezone(timezone)

        # Format times for display
        date_display = slot_start.strftime('%A, %B %d, %Y')
        time_display = slot_start.strftime('%I:%M %p').lstrip('0') + ' - ' + slot_end.strftime('%I:%M %p').lstrip('0')

        # Email to attendee
        attendee_subject = f"Confirmed: {meeting_title} on {date_display}"
        attendee_body = f"""Hi {attendee_name},

Your meeting has been scheduled!

Meeting: {meeting_title}
Date: {date_display}
Time: {time_display} ({timezone})

"""

        if owner_name:
            attendee_body += f"with {owner_name}\n\n"

        if message:
            attendee_body += f"Your message: {message}\n\n"

        attendee_body += f"""You can view the event details here:
{event_link}

If you need to reschedule or cancel, please reply to this email.

See you soon!"""

        # Email to owner
        owner_subject = f"New Booking: {meeting_title} with {attendee_name}"
        owner_body = f"""You have a new booking!

Meeting: {meeting_title}
Date: {date_display}
Time: {time_display} ({timezone})
Attendee: {attendee_name} ({attendee_email})
"""

        if message:
            owner_body += f"\nMessage from attendee:\n{message}\n"

        owner_body += f"""
View event details:
{event_link}"""

        # Send emails using Gmail API
        try:
            creds = get_stored_credentials()
            if creds:
                gmail_service = build('gmail', 'v1', credentials=creds)

                # Send to attendee
                import base64
                from email.message import EmailMessage

                attendee_msg = EmailMessage()
                attendee_msg.set_content(attendee_body)
                attendee_msg.set_to(attendee_email)
                attendee_msg.set_subject(attendee_subject)
                attendee_msg.set_from(owner_email)

                raw_attendee = base64.urlsafe_b64encode(attendee_msg.as_bytes()).decode()
                gmail_service.users().messages().send(
                    userId='me',
                    body={'raw': raw_attendee}
                ).execute()

                # Send to owner
                owner_msg = EmailMessage()
                owner_msg.set_content(owner_body)
                owner_msg.set_to(owner_email)
                owner_msg.set_subject(owner_subject)
                owner_msg.set_from(owner_email)

                raw_owner = base64.urlsafe_b64encode(owner_msg.as_bytes()).decode()
                gmail_service.users().messages().send(
                    userId='me',
                    body={'raw': raw_owner}
                ).execute()

                print(f"Sent booking confirmation emails to {attendee_email} and {owner_email}")
        except Exception as e:
            print(f"Error sending booking confirmation emails: {e}")
            raise

    def handle_booking_page(self):
        """Serve the public booking page"""
        try:
            # Extract link_id from path
            parts = self.path.split('/')
            if len(parts) < 3:
                self.send_error(404)
                return

            link_id = parts[2]

            # Read the booking page template
            template_path = Path(__file__).parent / 'templates' / 'booking_page.html'

            if not template_path.exists():
                # Create templates directory if it doesn't exist
                template_path.parent.mkdir(exist_ok=True)

                # Create a basic booking page template
                template_content = self.generate_booking_page_template()

                with open(template_path, 'w') as f:
                    f.write(template_content)

            with open(template_path, 'r') as f:
                template = f.read()

            # Replace placeholders
            template = template.replace('{{LINK_ID}}', link_id)

            # Get the server URL for API calls
            import socket
            server_host = self.server.server_address[0]
            server_port = self.server.server_address[1]
            api_base = f'http://{server_host}:{server_port}'

            template = template.replace('{{API_BASE}}', api_base)

            # Serve the page
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.end_headers()
            self.wfile.write(template.encode('utf-8'))

        except Exception as e:
            print(f"Error serving booking page: {e}")
            import traceback
            traceback.print_exc()
            self.send_error(500)

    def generate_booking_page_template(self):
        """Generate the booking page HTML template"""
        return '''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Book a Meeting</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }

        .container {
            background: white;
            border-radius: 16px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            max-width: 500px;
            width: 100%;
            padding: 40px;
        }

        .header {
            text-align: center;
            margin-bottom: 30px;
        }

        .header h1 {
            font-size: 24px;
            color: #1a1a1a;
            margin-bottom: 8px;
        }

        .header p {
            color: #666;
            font-size: 14px;
        }

        .loading {
            text-align: center;
            padding: 40px;
            color: #666;
        }

        .spinner {
            border: 3px solid #f3f3f3;
            border-top: 3px solid #667eea;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 0 auto 20px;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        .form-group {
            margin-bottom: 20px;
        }

        label {
            display: block;
            font-size: 14px;
            font-weight: 500;
            color: #333;
            margin-bottom: 8px;
        }

        input[type="text"],
        input[type="email"],
        textarea {
            width: 100%;
            padding: 12px;
            border: 1px solid #ddd;
            border-radius: 8px;
            font-size: 14px;
            transition: border-color 0.2s;
        }

        input[type="text"]:focus,
        input[type="email"]:focus,
        textarea:focus {
            outline: none;
            border-color: #667eea;
        }

        textarea {
            resize: vertical;
            min-height: 80px;
        }

        .slots-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
            gap: 10px;
            margin-bottom: 20px;
            max-height: 300px;
            overflow-y: auto;
            padding: 10px;
            background: #f8f9fa;
            border-radius: 8px;
        }

        .time-slot {
            padding: 12px;
            background: white;
            border: 1px solid #ddd;
            border-radius: 8px;
            cursor: pointer;
            text-align: center;
            transition: all 0.2s;
            font-size: 13px;
        }

        .time-slot:hover {
            border-color: #667eea;
            background: #f8f9ff;
        }

        .time-slot.selected {
            background: #667eea;
            color: white;
            border-color: #667eea;
        }

        .time-slot.disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .date-header {
            font-size: 12px;
            font-weight: 600;
            color: #666;
            padding: 8px 0;
            grid-column: 1 / -1;
        }

        .button {
            width: 100%;
            padding: 14px;
            background: #667eea;
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 500;
            cursor: pointer;
            transition: background 0.2s;
        }

        .button:hover {
            background: #5568d3;
        }

        .button:disabled {
            background: #ccc;
            cursor: not-allowed;
        }

        .error {
            background: #fee;
            color: #c33;
            padding: 12px;
            border-radius: 8px;
            margin-bottom: 20px;
            font-size: 14px;
        }

        .success {
            background: #efe;
            color: #3c3;
            padding: 20px;
            border-radius: 8px;
            text-align: center;
        }

        .success h2 {
            margin-bottom: 10px;
            color: #3c3;
        }

        .hidden {
            display: none;
        }

        .details {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 20px;
        }

        .detail-row {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid #eee;
        }

        .detail-row:last-child {
            border-bottom: none;
        }

        .detail-label {
            color: #666;
            font-size: 13px;
        }

        .detail-value {
            font-weight: 500;
            font-size: 13px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div id="loading" class="loading">
            <div class="spinner"></div>
            <p>Loading available times...</p>
        </div>

        <div id="error" class="error hidden"></div>

        <div id="booking-form" class="hidden">
            <div class="header">
                <h1 id="meeting-title">Book a Meeting</h1>
                <p id="meeting-description"></p>
            </div>

            <div class="details">
                <div class="detail-row">
                    <span class="detail-label">Duration</span>
                    <span class="detail-value" id="duration-display">30 min</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Timezone</span>
                    <span class="detail-value" id="timezone-display">America/New_York</span>
                </div>
            </div>

            <div class="form-group">
                <label>Select a time slot</label>
                <div id="slots-container" class="slots-grid"></div>
            </div>

            <div class="form-group">
                <label for="name">Name *</label>
                <input type="text" id="name" required placeholder="Your name">
            </div>

            <div class="form-group">
                <label for="email">Email *</label>
                <input type="email" id="email" required placeholder="your@email.com">
            </div>

            <div class="form-group">
                <label for="message">Message (optional)</label>
                <textarea id="message" placeholder="Any details for the meeting..."></textarea>
            </div>

            <button class="button" id="book-button" disabled>Book Meeting</button>
        </div>

        <div id="success" class="success hidden">
            <h2>&#10003; Booking Confirmed!</h2>
            <p>Your meeting has been scheduled.</p>
            <p style="margin-top: 10px; font-size: 14px; color: #666;">
                A calendar invitation has been sent to your email.
            </p>
        </div>
    </div>

    <script>
        const LINK_ID = '{{LINK_ID}}';
        const API_BASE = '{{API_BASE}}';
        let selectedSlot = null;
        let linkConfig = null;

        async function loadAvailability() {
            try {
                const response = await fetch(`${API_BASE}/scheduling`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'get_availability',
                        link_id: LINK_ID
                    })
                });

                const data = await response.json();

                if (!data.success) {
                    showError(data.error || 'Failed to load availability');
                    return;
                }

                linkConfig = data.link_config;
                document.getElementById('meeting-title').textContent = linkConfig.title;
                document.getElementById('meeting-description').textContent = linkConfig.description || '';
                document.getElementById('duration-display').textContent = `${linkConfig.duration} min`;
                document.getElementById('timezone-display').textContent = linkConfig.timezone;

                renderSlots(data.available_slots);

                document.getElementById('loading').classList.add('hidden');
                document.getElementById('booking-form').classList.remove('hidden');

            } catch (error) {
                showError('Failed to load availability. Please try again.');
                console.error(error);
            }
        }

        function renderSlots(slots) {
            const container = document.getElementById('slots-container');
            container.innerHTML = '';

            let currentDate = '';

            slots.forEach((slot, index) => {
                if (slot.date !== currentDate) {
                    currentDate = slot.date;
                    const dateHeader = document.createElement('div');
                    dateHeader.className = 'date-header';
                    dateHeader.textContent = slot.date_display;
                    container.appendChild(dateHeader);
                }

                const slotEl = document.createElement('div');
                slotEl.className = 'time-slot';
                slotEl.textContent = slot.time;
                slotEl.dataset.index = index;
                slotEl.dataset.slot = JSON.stringify(slot);

                slotEl.addEventListener('click', () => selectSlot(slotEl, slot));

                container.appendChild(slotEl);
            });
        }

        function selectSlot(element, slot) {
            document.querySelectorAll('.time-slot').forEach(el => el.classList.remove('selected'));
            element.classList.add('selected');
            selectedSlot = slot;
            document.getElementById('book-button').disabled = false;
        }

        function showError(message) {
            document.getElementById('loading').classList.add('hidden');
            document.getElementById('error').textContent = message;
            document.getElementById('error').classList.remove('hidden');
        }

        async function bookMeeting() {
            const name = document.getElementById('name').value.trim();
            const email = document.getElementById('email').value.trim();
            const message = document.getElementById('message').value.trim();

            if (!name || !email || !selectedSlot) {
                alert('Please fill in all required fields');
                return;
            }

            const button = document.getElementById('book-button');
            button.disabled = true;
            button.textContent = 'Booking...';

            try {
                const response = await fetch(`${API_BASE}/scheduling`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'book_slot',
                        link_id: LINK_ID,
                        name,
                        email,
                        message,
                        selected_slot: selectedSlot.start
                    })
                });

                const data = await response.json();

                if (data.success) {
                    document.getElementById('booking-form').classList.add('hidden');
                    document.getElementById('success').classList.remove('hidden');
                } else {
                    showError(data.error || 'Failed to book meeting');
                    button.disabled = false;
                    button.textContent = 'Book Meeting';
                }
            } catch (error) {
                showError('Failed to book meeting. Please try again.');
                button.disabled = false;
                button.textContent = 'Book Meeting';
                console.error(error);
            }
        }

        document.getElementById('book-button').addEventListener('click', bookMeeting);

        // Load availability on page load
        loadAvailability();
    </script>
</body>
</html>'''

    def handle_chat(self):
        """Generic prompt → Claude reply, used by Aiden AI features."""
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8'))
            prompt = data.get('message') or data.get('prompt', '')
            if not prompt:
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'No prompt provided'}).encode())
                return
            result, error = call_anthropic_with_retry(
                [{'role': 'user', 'content': prompt}],
                max_tokens=1500,
                temperature=0.4,
                timeout=30,
            )
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            if result:
                self.wfile.write(json.dumps({'reply': result}).encode())
            else:
                self.wfile.write(json.dumps({'error': error or 'AI call failed'}).encode())
        except Exception as e:
            print(f'[CHAT] Error: {e}')
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())

    def log_message(self, format_str, *args):
        """Suppress server log messages"""
        pass

_token_lock = threading.Lock()

def get_stored_credentials():
    """Get stored credentials if they exist and are valid.

    Uses a lock to prevent concurrent token refresh race conditions
    when multiple threads find the token expired simultaneously.
    """
    with _token_lock:
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