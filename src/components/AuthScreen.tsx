import { SparklesIcon, EnvelopeIcon } from '@heroicons/react/24/outline';
import { useAuthStore } from '@/stores/authStore';

export function AuthScreen() {
  const { signIn, signOut, isLoading, error } = useAuthStore();

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-gray-900">
      <div className="w-full max-w-md space-y-8">
        {/* Header */}
        <div className="text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary-600">
            <SparklesIcon className="h-10 w-10 text-white" />
          </div>
          <h2 className="mt-6 text-3xl font-bold text-gray-900 dark:text-white">
            Welcome to Aiden
          </h2>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            Your AI-powered email assistant
          </p>
        </div>

        {/* Sign In Card */}
        <div className="rounded-lg bg-white p-8 shadow-sm dark:bg-gray-800">
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                Connect your Gmail account
              </h3>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                Aiden needs access to your Gmail to help you manage emails efficiently.
              </p>
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
                {error}
                <button
                  onClick={signOut}
                  className="ml-2 text-xs underline hover:no-underline"
                >
                  Reset Authentication
                </button>
              </div>
            )}

            <div className="space-y-3">
              <button
              onClick={signIn}
              disabled={isLoading}
              className="flex w-full items-center justify-center space-x-3 rounded-lg bg-primary-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <EnvelopeIcon className="h-5 w-5" />
              )}
              <span>Sign in with Google</span>
            </button>
            </div>
          </div>
        </div>

        {/* Features */}
        <div className="mt-8 text-center">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Aiden will help you:
          </p>
          <ul className="mt-2 space-y-1 text-sm text-gray-500 dark:text-gray-500">
            <li>• Automatically prioritize important emails</li>
            <li>• Generate smart replies in your style</li>
            <li>• Save hours of email management time</li>
          </ul>
        </div>
      </div>
    </div>
  );
}