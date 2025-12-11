export function Saved() {
  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-700 dark:bg-gray-800">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
          Saved Emails
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Important emails you've saved for later
        </p>
      </header>
      <div className="flex-1 p-6">
        <div className="flex h-full items-center justify-center text-gray-500 dark:text-gray-400">
          <p>No saved emails</p>
        </div>
      </div>
    </div>
  );
}