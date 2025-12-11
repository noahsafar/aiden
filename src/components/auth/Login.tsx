import { useState } from 'react';
import { EnvelopeIcon, EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';
import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/stores/authStore';

export default function Login() {
  const [showApiKey, setShowApiKey] = useState(false);
  const { signIn, isLoading, error } = useAuthStore();

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <div className="mx-auto h-16 w-16 flex items-center justify-center border-2 border-red-500">
            <img
              src="/aiden-logo.png"
              alt="Aiden Logo"
              className="h-16 w-16"
              onError={(e) => {
                console.error('Error loading logo:', e);
                e.currentTarget.style.display = 'none';
              }}
            />
          </div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Sign in to Aiden
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Your AI-powered email manager
          </p>
        </div>

        <div className="mt-8 space-y-6">
          {error && (
            <div className="rounded-md bg-red-50 p-4">
              <div className="text-sm text-red-800">{error}</div>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <p className="text-sm text-gray-700 mb-4">
                Click below to authenticate with your Google account and grant Aiden access to your Gmail.
              </p>
              <p className="text-xs text-gray-500">
                Aiden needs permission to read and send emails on your behalf to provide AI-powered email management.
              </p>
            </div>

            <Button
              onClick={signIn}
              disabled={isLoading}
              className="w-full"
            >
              {isLoading ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
              ) : (
                <>
                  <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="currentColor"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="currentColor"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    />
                    <path
                      fill="currentColor"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    />
                  </svg>
                  Continue with Google
                </>
              )}
            </Button>
          </div>

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-gray-50 text-gray-500">Or configure manually</span>
              </div>
            </div>

            <div className="mt-6 space-y-4">
              <div>
                <label htmlFor="googleClientId" className="sr-only">
                  Google Client ID
                </label>
                <input
                  id="googleClientId"
                  name="googleClientId"
                  type="text"
                  autoComplete="off"
                  placeholder="Google Client ID"
                  className="appearance-none rounded-md relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                />
              </div>
              <div>
                <label htmlFor="googleClientSecret" className="sr-only">
                  Google Client Secret
                </label>
                <div className="relative">
                  <input
                    id="googleClientSecret"
                    name="googleClientSecret"
                    type={showApiKey ? 'text' : 'password'}
                    autoComplete="off"
                    placeholder="Google Client Secret"
                    className="appearance-none rounded-md relative block w-full px-3 py-2 pr-10 border border-gray-300 placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-0 pr-3 flex items-center"
                    onClick={() => setShowApiKey(!showApiKey)}
                  >
                    {showApiKey ? (
                      <EyeSlashIcon className="h-4 w-4 text-gray-400" />
                    ) : (
                      <EyeIcon className="h-4 w-4 text-gray-400" />
                    )}
                  </button>
                </div>
              </div>
              <div>
                <label htmlFor="anthropicApiKey" className="sr-only">
                  Anthropic API Key
                </label>
                <div className="relative">
                  <input
                    id="anthropicApiKey"
                    name="anthropicApiKey"
                    type={showApiKey ? 'text' : 'password'}
                    autoComplete="off"
                    placeholder="Anthropic API Key (Claude)"
                    className="appearance-none rounded-md relative block w-full px-3 py-2 pr-10 border border-gray-300 placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                  />
                </div>
              </div>
              <Button variant="outline" className="w-full">
                Save Configuration
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}