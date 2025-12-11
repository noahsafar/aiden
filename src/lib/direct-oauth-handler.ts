import { invoke } from '@/lib/tauri-api';
import { AuthToken } from '@/types/models';

export async function handleOAuthCallback() {
  try {
    console.log('🔗 Handling OAuth callback directly...');

    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const error = urlParams.get('error');
    const state = urlParams.get('state');

    console.log('📝 Callback parameters:', { code: code ? '***' : null, error, state });

    if (error) {
      console.error('❌ OAuth error:', error);
      setTimeout(() => {
        window.location.href = '/login?error=' + encodeURIComponent(error);
      }, 2000);
      return;
    }

    if (!code) {
      console.error('❌ No authorization code received');
      setTimeout(() => {
        window.location.href = '/login?error=no_code';
      }, 2000);
      return;
    }

    // Get PKCE verifier from localStorage
    const pkceVerifier = localStorage.getItem('pkce_verifier');
    if (pkceVerifier) {
      localStorage.removeItem('pkce_verifier'); // Clean up
    }

    console.log('🔄 Exchanging authorization code for tokens...');

    // Exchange code for token
    const token = await invoke<AuthToken>('exchange_code_for_token', {
      code,
      redirectUri: `${window.location.origin}/callback`,
      codeVerifier: pkceVerifier,
    });

    console.log('✅ Token exchange successful');

    // Get user info
    const userInfo = await invoke<any>('get_user_info', { token: token.access_token });

    console.log('👤 User info retrieved:', userInfo.email);

    // Store token in localStorage for authStore to find
    localStorage.setItem('aiden_auth_token', JSON.stringify(token));
    localStorage.setItem('aiden_user_info', JSON.stringify(userInfo));

    // Clear URL parameters and redirect to dashboard
    window.history.replaceState({}, document.title, window.location.pathname);

    console.log('🎉 OAuth flow complete, redirecting to dashboard...');
    window.location.href = '/dashboard';

  } catch (error) {
    console.error('❌ OAuth callback failed:', error);

    setTimeout(() => {
      window.location.href = '/login?error=' + encodeURIComponent('OAuth callback failed');
    }, 3000);
  }
}