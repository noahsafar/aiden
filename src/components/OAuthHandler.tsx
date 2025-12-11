import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { invoke } from '@/lib/tauri-api';
import { AuthToken } from '@/types/models';

interface OAuthHandlerProps {
  children: React.ReactNode;
}

export const OAuthHandler: React.FC<OAuthHandlerProps> = ({ children }) => {
  const navigate = useNavigate();
  const { setState, setUser } = useAuthStore();

  useEffect(() => {
    const handleOAuthCallback = async () => {
      const urlParams = new URLSearchParams(window.location.search);
      const code = urlParams.get('code');
      const error = urlParams.get('error');
      const state = urlParams.get('state');

      // If no OAuth parameters, return early
      if (!code && !error) {
        return;
      }

      console.log('OAuth callback detected:', {
        code: code ? 'RECEIVED' : 'MISSING',
        error: error || 'NONE',
        state: state || 'NONE',
        url: window.location.search
      });

      if (error) {
        console.error('OAuth Error:', error);
        setState({
          error: `Authentication failed: ${error}`,
          isLoading: false
        });
        navigate('/login');
        return;
      }

      if (!code) {
        console.error('No authorization code received');
        setState({
          error: 'No authorization code received',
          isLoading: false
        });
        navigate('/login');
        return;
      }

      // Verify state parameter for security
      const savedState = localStorage.getItem('oauth_state');
      if (!state || state !== savedState) {
        console.error('Invalid state parameter');
        setState({
          error: 'Invalid state parameter - possible CSRF attack',
          isLoading: false
        });
        navigate('/login');
        return;
      }

      // Clear state
      localStorage.removeItem('oauth_state');

      try {
        // Show processing state
        setState({ isLoading: true });

        // Exchange authorization code for tokens
        const token = await invoke<AuthToken>('exchange_code_for_token', { code });

        if (!token) {
          throw new Error('Failed to exchange authorization code for token');
        }

        // Get user info from Google using the access token
        const userInfo = await fetchGoogleUserInfo(token.access_token);

        if (!userInfo) {
          throw new Error('Failed to get user information');
        }

        // Store tokens and user data
        localStorage.setItem('aiden_access_token', token.access_token);
        localStorage.setItem('aiden_refresh_token', token.refresh_token);
        localStorage.setItem('aiden_user', JSON.stringify(userInfo));

        // Update auth state
        setState({
          isAuthenticated: true,
          token: {
            access_token: token.access_token,
            refresh_token: token.refresh_token,
            expires_in: 3600, // Default, will be updated from token.expires_at if needed
          },
          user: userInfo,
          isLoading: false,
          error: null,
        });

        // Clear URL parameters and redirect to dashboard
        window.history.replaceState({}, document.title, window.location.pathname);
        navigate('/dashboard');

      } catch (error) {
        console.error('OAuth callback error:', error);
        setState({
          isAuthenticated: false,
          token: null,
          user: null,
          isLoading: false,
          error: error instanceof Error ? error.message : 'Authentication failed',
        });
        navigate('/login');
      }
    };

    handleOAuthCallback();
  }, [navigate, setState, setUser]);

  // Fetch user info from Google
  const fetchGoogleUserInfo = async (accessToken: string): Promise<{ email: string; name: string; picture: string } | null> => {
    try {
      const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      if (response.ok) {
        const userInfo = await response.json();
        return {
          email: userInfo.email,
          name: userInfo.name,
          picture: userInfo.picture,
        };
      } else {
        console.error('Failed to fetch user info:', await response.text());
        return null;
      }
    } catch (error) {
      console.error('Error fetching user info:', error);
      return null;
    }
  };

  return <>{children}</>;
};