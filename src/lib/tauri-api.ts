// Tauri API compatibility layer for web development
import { AuthToken } from '@/types/models';

// Check if we're running in Tauri
const isTauri = typeof window !== 'undefined' && window.__TAURI_INTERNALS__;

// Mock implementation for web development
const mockTauriAPI = {
  invoke: async (command: string, args?: any) => {
    console.log(`[Mock] Tauri invoke: ${command}`, args);

    // Handle different commands with mock responses
    switch (command) {
      case 'get_stored_token':
        // Return null for web (no stored token)
        return null;

      case 'get_auth_url': {
        // Generate real Google OAuth URL
        const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || import.meta.env.GOOGLE_CLIENT_ID;
        const redirectUri = encodeURIComponent('http://localhost:1420');
        const scope = encodeURIComponent('https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile');
        const responseType = 'code';
        const state = Math.random().toString(36).substring(7);
        const pkceVerifier = Math.random().toString(36).substring(7) + Math.random().toString(36).substring(7);

        // Build OAuth URL
        const authUrl = clientId
          ? `https://accounts.google.com/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scope}&response_type=${responseType}&state=${state}&access_type=offline&prompt=consent`
          : `https://accounts.google.com/oauth/authorize?mock=true&error=missing_client_id`;

        return [authUrl, state, pkceVerifier];
      }

      case 'exchange_code_for_token': {
        // For development with real Google OAuth, exchange the code
        const tokenClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || import.meta.env.GOOGLE_CLIENT_ID;
        const tokenClientSecret = import.meta.env.VITE_GOOGLE_CLIENT_SECRET || import.meta.env.GOOGLE_CLIENT_SECRET;
        const tokenRedirectUri = 'http://localhost:1420';

        if (tokenClientId && tokenClientSecret && args?.code) {
          try {
            // Exchange authorization code for tokens
            const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: new URLSearchParams({
                client_id: tokenClientId,
                client_secret: tokenClientSecret,
                code: args.code,
                grant_type: 'authorization_code',
                redirect_uri: tokenRedirectUri,
              }),
            });

            if (tokenResponse.ok) {
              const tokenData = await tokenResponse.json();
              console.log('Token exchange successful');
              return {
                access_token: tokenData.access_token,
                refresh_token: tokenData.refresh_token || '',
                expires_at: Date.now() + (tokenData.expires_in * 1000),
              };
            } else {
              console.error('Token exchange failed:', await tokenResponse.text());
              throw new Error('Token exchange failed');
            }
          } catch (error) {
            console.error('Error during token exchange:', error);
            throw new Error('Failed to exchange authorization code for token');
          }
        } else {
          throw new Error('Missing client credentials or authorization code');
        }
      }

      case 'refresh_token': {
        // For demo purposes, always return mock refresh without making Google API calls
        console.log('[Mock] Returning mock refresh token for demo purposes');
        return {
          access_token: 'mock_refreshed_access_token_' + Date.now(),
          refresh_token: 'mock_refresh_token',
          expires_at: Date.now() + 3600000
        };
      }

      case 'sign_out':
        // Mock sign out - just return success
        return;

      default:
        console.warn(`[Mock] Unhandled Tauri command: ${command}`);
        return null;
    }
  },

  // Mock plugin system
  plugins: {
    opener: {
      open: async (args: { path: string }) => {
        console.log(`[Mock] Opening URL: ${args.path}`);
        // In web, we can open a new window
        window.open(args.path, '_blank');
      }
    }
  }
};

// Export the appropriate API based on environment
export const invoke = isTauri
  ? (window as any).__TAURI_INTERNALS__.invoke
  : mockTauriAPI.invoke;

export const open = isTauri
  ? (window as any).__TAURI_PLUGINS__?.opener?.open
  : mockTauriAPI.plugins.opener.open;

// Re-export types from @tauri-apps/api/core if available, otherwise define mock types
export type { AuthToken };

// Helper to check if we're in Tauri
export const isInTauri = () => isTauri;