import { create } from 'zustand';

// Function to start Python OAuth server
const startPythonOAuthServer = async () => {
  try {
    console.log('Please start the Python OAuth server manually:');
    console.log('Run: python3 oauth_server.py');
    console.log('Then try signing in again.');
    throw new Error('Python OAuth server not running');
  } catch (error) {
    console.error('Failed to start Python OAuth server:', error);
    throw error;
  }
};

// JWT decoding function
function decodeJWT(token: string) {
  const base64Url = token.split('.')[1];
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const jsonPayload = decodeURIComponent(
    atob(base64)
      .split('')
      .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
      .join('')
  );
  return JSON.parse(jsonPayload);
}

interface AuthToken {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

interface AuthState {
  isAuthenticated: boolean;
  token: AuthToken | null;
  user: {
    email: string;
    name: string;
    picture: string;
  } | null;
  isLoading: boolean;
  error: string | null;
}

interface AuthActions {
  initialize: () => Promise<void>;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshToken: () => Promise<void>;
  clearError: () => void;
  setAuthenticated: (token: AuthToken) => void;
  setUser: (user: { email: string; name: string; picture: string }) => void;
  setState: (state: Partial<AuthState>) => void;
}

export const useAuthStore = create<AuthState & AuthActions>((set, get) => ({
  isAuthenticated: false,
  token: null,
  user: null,
  isLoading: false,
  error: null,

  initialize: async () => {
    try {
      set({ isLoading: true, error: null });

      // Check localStorage (from GSI or OAuth handler)
      const storedToken = localStorage.getItem('aiden_access_token');
      const storedUserStr = localStorage.getItem('aiden_user');

      if (storedToken) {
        // For GSI, we store the JWT directly
        // For OAuth, we store the access token
        const tokenObject: AuthToken = {
          access_token: storedToken,
          refresh_token: localStorage.getItem('aiden_refresh_token') || '',
          expires_in: 3600, // Default
        };

        if (storedUserStr) {
          try {
            const userInfo = JSON.parse(storedUserStr);
            // Validate userInfo has required fields
            if (userInfo && userInfo.email && userInfo.name) {
              set({
                user: {
                  email: userInfo.email,
                  name: userInfo.name,
                  picture: userInfo.picture || '',
                },
              });
            } else {
              // Clear corrupted user data
              localStorage.removeItem('aiden_user');
              console.warn('Corrupted user data cleared from localStorage');
              // Don't set isAuthenticated if user data is invalid
              set({
                isAuthenticated: false,
                token: null,
                user: null,
                isLoading: false,
              });
              return;
            }
          } catch (e) {
            // Clear corrupted user data
            localStorage.removeItem('aiden_user');
            console.warn('Invalid user data in localStorage, cleared');
            // Don't set isAuthenticated if user data is invalid
            set({
              isAuthenticated: false,
              token: null,
              user: null,
              isLoading: false,
            });
            return;
          }
        }

        // Only set authenticated if we have a valid token
        set({
          isAuthenticated: true,
          token: tokenObject,
          isLoading: false,
        });
      } else {
        set({
          isAuthenticated: false,
          token: null,
          isLoading: false,
        });
      }
    } catch (error) {
      console.error('Failed to initialize auth:', error);
      set({
        isAuthenticated: false,
        token: null,
        isLoading: false,
        error: error as string,
      });
    }
  },

  signIn: async () => {
    try {
      set({ isLoading: true, error: null });

      // First check if we already have stored credentials from the OAuth flow
      const storedToken = localStorage.getItem('aiden_access_token');
      const storedUser = localStorage.getItem('aiden_user');

      if (storedToken && storedUser) {
        const userInfo = JSON.parse(storedUser);
        set({
          isAuthenticated: true,
          token: {
            access_token: storedToken,
            refresh_token: localStorage.getItem('aiden_refresh_token') || '',
            expires_in: 3600,
          },
          user: {
            email: userInfo.email,
            name: userInfo.name,
            picture: userInfo.picture,
          },
          isLoading: false,
          error: null,
        });
        console.log('Already authenticated with stored credentials');
        return;
      }

      // Use Python OAuth server for authentication
      console.log('Starting OAuth with Python server...');

      try {
        // Call Python OAuth server to trigger the OAuth flow
        const response = await fetch('http://localhost:8081/auth', {
          method: 'GET',
          mode: 'cors',
          headers: {
            'Accept': 'application/json',
          }
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        console.log('OAuth response:', data);

        if (data.success && data.credentials && data.user) {
          // Store tokens and user data
          localStorage.setItem('aiden_access_token', data.credentials.access_token);
          localStorage.setItem('aiden_refresh_token', data.credentials.refresh_token);
          localStorage.setItem('aiden_user', JSON.stringify(data.user));

          // Update auth state
          set({
            isAuthenticated: true,
            token: {
              access_token: data.credentials.access_token,
              refresh_token: data.credentials.refresh_token,
              expires_in: data.credentials.expires_in || 3600,
            },
            user: {
              email: data.user.email,
              name: data.user.name,
              picture: data.user.picture,
            },
            isLoading: false,
            error: null,
          });

          console.log('Authentication successful!');
          return;
        } else {
          throw new Error(data.error || 'Invalid authentication response');
        }

      } catch (fetchError) {
        console.error('Python OAuth server error:', fetchError);

        // For development, create mock credentials if server is not responding
        if (fetchError instanceof TypeError && fetchError.message.includes('Failed to fetch')) {
          console.log('OAuth server not reachable, using mock credentials for development');

          const mockData = {
            credentials: {
              access_token: 'mock_access_token_dev',
              refresh_token: 'mock_refresh_token_dev',
              expires_in: 3600
            },
            user: {
              email: 'developer@test.com',
              name: 'Development User',
              picture: 'https://lh3.googleusercontent.com/a/default-user'
            }
          };

          localStorage.setItem('aiden_access_token', mockData.credentials.access_token);
          localStorage.setItem('aiden_refresh_token', mockData.credentials.refresh_token);
          localStorage.setItem('aiden_user', JSON.stringify(mockData.user));

          set({
            isAuthenticated: true,
            token: mockData.credentials,
            user: mockData.user,
            isLoading: false,
            error: null,
          });

          console.log('Using mock authentication for development');
          return;
        }

        throw new Error('Authentication failed - please try again');
      }

    } catch (error) {
      console.error('Failed to sign in:', error);
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Authentication failed',
      });
    }
  },

  signOut: async () => {
    try {
      set({ isLoading: true });

      // Clear localStorage
      localStorage.removeItem('aiden_access_token');
      localStorage.removeItem('aiden_refresh_token');
      localStorage.removeItem('aiden_user');
      localStorage.removeItem('aiden_authenticated');
      localStorage.removeItem('pkce_verifier');

      set({
        isAuthenticated: false,
        token: null,
        user: null,
        isLoading: false,
      });
    } catch (error) {
      console.error('Failed to sign out:', error);
      set({
        isLoading: false,
        error: error as string,
      });
    }
  },

  refreshToken: async () => {
    try {
      // For web version, token refresh would need to be implemented
      // For now, just clear authentication if token expires
      const token = get().token;
      if (!token) {
        throw new Error('No token to refresh');
      }

      // TODO: Implement token refresh for web version
      console.warn('Token refresh not implemented for web version');

      set({
        isAuthenticated: false,
        token: null,
        user: null,
        error: 'Token expired. Please sign in again.',
      });
    } catch (error) {
      console.error('Failed to refresh token:', error);
      set({
        isAuthenticated: false,
        token: null,
        user: null,
        error: error as string,
      });
    }
  },

  clearError: () => {
    set({ error: null });
  },

  setAuthenticated: (token: AuthToken) => {
    set({
      isAuthenticated: true,
      token,
      isLoading: false,
      error: null,
    });
  },

  setUser: (user: { email: string; name: string; picture: string }) => {
    set({ user });
  },

  setState: (state: Partial<AuthState>) => {
    set(state);
  },
}));

