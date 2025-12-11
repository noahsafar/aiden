// OAuth callback handler for Google OAuth
import { invoke } from './tauri-api';
import { AuthToken } from '@/types/models';

export class OAuthHandler {
  private static instance: OAuthHandler;
  private isListening = false;

  static getInstance(): OAuthHandler {
    if (!OAuthHandler.instance) {
      OAuthHandler.instance = new OAuthHandler();
    }
    return OAuthHandler.instance;
  }

  // Start listening for OAuth callback
  startListening() {
    if (this.isListening) return;
    this.isListening = true;

    // Check if we're on the callback route with OAuth parameters
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const error = urlParams.get('error');

    // Only handle OAuth callbacks on non-callback routes as fallback
    if ((code || error) && !window.location.pathname.includes('/callback')) {
      console.warn('OAuth callback detected on non-callback route. Redirecting to /callback');
      // Preserve all URL parameters and redirect to the callback route
      window.location.href = `/callback${window.location.search}`;
      return;
    }
  }

  // Handle OAuth callback (now delegated to OAuthCallback component)
  // This method can be used for programmatic callback handling if needed
  async handleCallbackProgrammatic(code: string, pkceVerifier: string): Promise<AuthToken | null> {
    try {
      console.log('Handling OAuth callback with code:', code);

      // Exchange code for token
      const token = await invoke<AuthToken>('exchange_code_for_token', {
        code,
        pkceVerifier,
      });

      console.log('Token received:', token ? 'success' : 'failed');
      return token;
    } catch (error) {
      console.error('Failed to handle OAuth callback:', error);
      return null;
    }
  }

  // Fetch user info from Google (disabled for demo)
  async fetchUserInfo(accessToken: string): Promise<{ email: string; name: string; picture: string } | null> {
    // For demo purposes, return mock user info
    console.log('Returning mock user info for demo purposes');
    return {
      email: 'user@gmail.com',
      name: 'Demo User',
      picture: 'https://ui-avatars.com/api/?name=Demo+User&background=random',
    };
  }

  // Clean up after OAuth flow
  cleanup() {
    localStorage.removeItem('pkce_verifier');
    this.isListening = false;
  }
}

// Initialize OAuth handler on app load
export const initOAuth = () => {
  OAuthHandler.getInstance().startListening();
};