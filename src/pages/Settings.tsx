export function Settings() {
  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-700 dark:bg-gray-800">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
          Settings
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Configure Aiden to your preferences
        </p>
      </header>
      <div className="flex-1 p-6">
        <div className="max-w-4xl space-y-6">
          <div className="rounded-lg bg-white p-6 shadow-sm dark:bg-gray-800">
            <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
              Email Processing
            </h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">
                    Enable notifications
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Get notified about new important emails
                  </p>
                </div>
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  defaultChecked={true}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">
                    Auto-send replies
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Automatically send AI-generated replies
                  </p>
                </div>
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
              </div>
            </div>
          </div>

          <div className="rounded-lg bg-white p-6 shadow-sm dark:bg-gray-800">
            <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
              Gmail Integration
            </h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">
                    Connected account
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    user@example.com
                  </p>
                </div>
                <button className="text-sm text-primary-600 hover:text-primary-700 dark:text-primary-400">
                  Disconnect
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-lg bg-white p-6 shadow-sm dark:bg-gray-800">
            <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
              AI Settings
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-900 dark:text-white mb-1">
                  AI Model
                </label>
                <select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white">
                  <option>Claude 3.5 Sonnet</option>
                  <option>Claude 3 Haiku</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-900 dark:text-white mb-1">
                  Polling Interval
                </label>
                <select className="w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white">
                  <option>Every minute</option>
                  <option>Every 5 minutes</option>
                  <option>Every 10 minutes</option>
                  <option>Every 30 minutes</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}