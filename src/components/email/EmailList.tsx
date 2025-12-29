import { useState, useEffect } from 'react';
import {
  MagnifyingGlassIcon,
  StarIcon,
  ArchiveBoxIcon,
  ArrowUTurnLeftIcon,
  ClockIcon,
  BookmarkIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';
import { Button } from '@/components/ui/Button';
import { useEmailStore, Email } from '@/stores/emailStore';
import { formatDateTime } from '@/lib/utils';

export function EmailList() {
  const [searchQuery, setSearchQuery] = useState('');
  const {
    emails,
    selectedEmail,
    isLoading,
    error,
    currentFilter,
    selectEmail,
    markAsStarred,
    updateEmailStatus,
    saveEmail,
    unsaveEmail,
    fetchEmails,
    setCurrentFilter,
    getFilteredEmails,
    setSearchQuery,
  } = useEmailStore();

  useEffect(() => {
    fetchEmails();
  }, [fetchEmails]);

  // Update store when local search query changes
  useEffect(() => {
    setSearchQuery(searchQuery);
  }, [searchQuery, setSearchQuery]);

  const filteredEmails = getFilteredEmails();

  const getCategoryColor = (category: Email['category']) => {
    switch (category) {
      case 'Urgent': return 'text-red-600 bg-red-50';
      case 'Important': return 'text-orange-600 bg-orange-50';
      case 'Normal': return 'text-blue-600 bg-blue-50';
      case 'Low': return 'text-gray-600 bg-gray-50';
      default: return 'text-gray-600 bg-gray-50';
    }
  };

  const getStatusIcon = (email: Email) => {
    if (email.status === 'Replied') return <ArrowUTurnLeftIcon className="h-3 w-3" />;
    if (email.status === 'Archived') return <ArchiveBoxIcon className="h-3 w-3" />;
    if (email.is_starred) return <StarIcon className="h-3 w-3 fill-current" />;
    return null;
  };

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center">
          <p className="text-red-600 mb-4">Failed to load emails: {error}</p>
          <Button onClick={() => fetchEmails()}>Retry</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-gray-50">
      {/* Search Bar */}
      <div className="p-4 border-b border-gray-200 bg-white">
        <div className="relative">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search emails..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Email List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center p-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : filteredEmails.length === 0 ? (
          <div className="flex items-center justify-center p-8 text-gray-500">
            {searchQuery ? 'No emails found matching your search.' : 'No emails to display.'}
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {filteredEmails.map((email) => (
              <div
                key={email.id}
                onClick={() => selectEmail(email)}
                className={`p-4 hover:bg-gray-50 cursor-pointer transition-colors ${
                  selectedEmail?.id === email.id ? 'bg-blue-50' : ''
                } ${!email.is_read ? 'bg-blue-50/30' : ''}`}
              >
                <div className="flex items-start justify-between mb-1">
                  <div className="flex items-center space-x-2">
                    <span className={`text-sm font-medium ${!email.is_read ? 'font-bold' : ''}`}>
                      {email.sender}
                    </span>
                    <span className={`text-xs px-2 py-1 rounded-full ${getCategoryColor(email.category)}`}>
                      {email.category}
                    </span>
                    {getStatusIcon(email) && (
                      <div className="text-gray-400">
                        {getStatusIcon(email)}
                      </div>
                    )}
                  </div>
                  <span className="text-xs text-gray-500 flex items-center">
                    <ClockIcon className="h-3 w-3 mr-1" />
                    {formatDateTime(email.date)}
                  </span>
                </div>

                <h3 className={`text-sm mb-1 ${!email.is_read ? 'font-semibold' : ''}`}>
                  {email.subject || 'No Subject'}
                </h3>

                {/* Show AI summary if available, otherwise show snippet */}
                {email.summary ? (
                  <div className="flex items-start gap-2">
                    <SparklesIcon className="h-3 w-3 text-purple-500 mt-0.5 flex-shrink-0" />
                    <p className="text-sm text-gray-700 line-clamp-2">
                      {email.summary}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-gray-600 truncate">
                    {email.snippet}
                  </p>
                )}

                <div className="flex items-center justify-between mt-2">
                  <div className="flex space-x-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={(e) => {
                        e.stopPropagation();
                        email.status === 'Saved' ? unsaveEmail(email.id) : saveEmail(email.id);
                      }}
                      title={email.status === 'Saved' ? 'Unsave' : 'Save for later'}
                    >
                      <BookmarkIcon className={`h-3 w-3 ${email.status === 'Saved' ? 'fill-current text-purple-500' : ''}`} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={(e) => {
                        e.stopPropagation();
                        markAsStarred(email.id, !email.is_starred);
                      }}
                    >
                      <StarIcon className={`h-3 w-3 ${email.is_starred ? 'fill-current text-yellow-500' : ''}`} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={(e) => {
                        e.stopPropagation();
                        updateEmailStatus(email.id, 'Archived');
                      }}
                    >
                      <ArchiveBoxIcon className="h-3 w-3" />
                    </Button>
                  </div>
                  {email.has_attachments && (
                    <span className="text-xs text-gray-500">📎</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Refresh Button */}
      <div className="p-4 border-t border-gray-200 bg-white">
        <Button
          variant="outline"
          className="w-full"
          onClick={() => fetchEmails()}
          disabled={isLoading}
        >
          {isLoading ? 'Refreshing...' : 'Refresh Emails'}
        </Button>
      </div>
    </div>
  );
}