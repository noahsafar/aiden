#!/usr/bin/env python3
"""
Simple OAuth server based on the working aiden-ai implementation
"""
import os
import pickle
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
import json
from urllib.parse import urlparse, parse_qs

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
import requests

# OAuth Scopes - Gmail access plus userinfo for getting user details
SCOPES = [
    'openid',  # Add at beginning - Google adds this automatically
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile'
]

# Credentials file
CREDENTIALS_FILE = "gmail_credentials.json"
TOKEN_FILE = Path.home() / '.aiden' / 'gmail_token.pickle'

class SimpleOAuthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        # Add CORS headers
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

        if self.path == '/auth':
            self.handle_auth()
        else:
            self.end_headers()
            self.wfile.write(b'OAuth server running')

    def do_OPTIONS(self):
        # Handle preflight requests
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def handle_auth(self):
        """Handle OAuth authentication"""
        try:
            self.send_header('Content-type', 'application/json')

            # Check if we have stored credentials
            creds = None
            if TOKEN_FILE.exists():
                with open(TOKEN_FILE, 'rb') as token:
                    creds = pickle.load(token)

            # If credentials are invalid or don't exist, authenticate
            if not creds or not creds.valid:
                if creds and creds.expired and creds.refresh_token:
                    creds.refresh(Request())
                else:
                    if not os.path.exists(CREDENTIALS_FILE):
                        self.end_headers()
                        response = {
                            'success': False,
                            'error': f'Credentials file not found: {CREDENTIALS_FILE}'
                        }
                        self.wfile.write(json.dumps(response).encode())
                        return

                    flow = InstalledAppFlow.from_client_secrets_file(
                        CREDENTIALS_FILE, SCOPES
                    )
                    creds = flow.run_local_server(port=0)

                # Save credentials for future use
                TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
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

    def get_user_info(self, creds):
        """Get user information from Google API"""
        try:
            response = requests.get(
                'https://www.googleapis.com/oauth2/v2/userinfo',
                headers={'Authorization': f'Bearer {creds.token}'}
            )
            print(f"User info response status: {response.status_code}")
            if response.status_code == 200:
                user_data = response.json()
                print(f"User info retrieved: {user_data}")
                return user_data
            else:
                print(f"Failed to get user info: {response.text}")
        except Exception as e:
            print(f"Error getting user info: {e}")
        return None

    def log_message(self, format_str, *args):
        """Suppress server log messages"""
        pass

def start_oauth_server():
    """Start the OAuth server"""
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

    server = HTTPServer(('localhost', port), SimpleOAuthHandler)
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
        server.server_close()