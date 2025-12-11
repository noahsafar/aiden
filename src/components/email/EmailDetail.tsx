import { useState } from 'react';
import {
  StarIcon,
  ArchiveBoxIcon,
  ArrowUTurnLeftIcon,
  ArrowUTurnRightIcon,
  PaperAirplaneIcon,
  EllipsisHorizontalIcon,
  ExclamationCircleIcon,
  CheckCircleIcon
} from '@heroicons/react/24/outline';
import { Button } from '@/components/ui/Button';
import { useEmailStore, Email } from '@/stores/emailStore';
import { formatDate, formatTime } from '@/lib/utils';

export function EmailDetail() {
  const [showReplyBox, setShowReplyBox] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [isClassifying, setIsClassifying] = useState(false);
  const [isGeneratingReply, setIsGeneratingReply] = useState(false);

  const { selectedEmail, markAsStarred, updateEmailStatus, classifyEmail, generateReply, sendEmail } = useEmailStore();

  if (!selectedEmail) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white">
        <div className="text-center text-gray-500">
          <div className="mb-4">
            <div className="w-16 h-16 bg-gray-200 rounded-full mx-auto mb-4 flex items-center justify-center">
              <StarIcon className="h-8 w-8 text-gray-400" />
            </div>
          </div>
          <p>Select an email to view its contents</p>
        </div>
      </div>
    );
  }

  const handleClassify = async () => {
    setIsClassifying(true);
    try {
      await classifyEmail(selectedEmail.id);
    } finally {
      setIsClassifying(false);
    }
  };

  const handleGenerateReply = async () => {
    setIsGeneratingReply(true);
    try {
      await generateReply(selectedEmail.id);
      setShowReplyBox(true);
    } finally {
      setIsGeneratingReply(false);
    }
  };

  const handleSendReply = async () => {
    if (!replyText.trim()) return;

    try {
      await sendEmail(selectedEmail.sender, `Re: ${selectedEmail.subject}`, replyText);
      setReplyText('');
      setShowReplyBox(false);
      updateEmailStatus(selectedEmail.id, 'Replied');
    } catch (error) {
      console.error('Failed to send reply:', error);
    }
  };

  const getCategoryBadge = (category: Email['category']) => {
    const styles = {
      Urgent: 'bg-red-100 text-red-800',
      Important: 'bg-orange-100 text-orange-800',
      Normal: 'bg-blue-100 text-blue-800',
      Low: 'bg-gray-100 text-gray-800',
    };

    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[category]}`}>
        {category}
      </span>
    );
  };

  return (
    <div className="flex-1 flex flex-col bg-white">
      {/* Email Header */}
      <div className="border-b border-gray-200 p-6">
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-900 flex-1 mr-4">
            {selectedEmail.subject || 'No Subject'}
          </h2>
          <div className="flex items-center space-x-2">
            {getCategoryBadge(selectedEmail.category)}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => markAsStarred(selectedEmail.id, !selectedEmail.is_starred)}
            >
              <StarIcon className={`h-5 w-5 ${selectedEmail.is_starred ? 'fill-current text-yellow-500' : ''}`} />
            </Button>
            <Button variant="ghost" size="icon">
              <ArchiveBoxIcon className="h-5 w-5" />
            </Button>
            <Button variant="ghost" size="icon">
              <EllipsisHorizontalIcon className="h-5 w-5" />
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-900">{selectedEmail.sender}</p>
            <p className="text-sm text-gray-500">To: {selectedEmail.recipients}</p>
          </div>
          <div className="text-sm text-gray-500">
            <p>{formatDate(selectedEmail.date)}</p>
            <p>{formatTime(selectedEmail.date)}</p>
          </div>
        </div>
      </div>

      {/* AI Actions Bar */}
      <div className="bg-gray-50 border-b border-gray-200 p-4">
        <div className="flex items-center space-x-4">
          <Button
            variant="outline"
            size="sm"
            onClick={handleClassify}
            disabled={isClassifying}
          >
            {isClassifying ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
            ) : (
              <ExclamationCircleIcon className="h-4 w-4 mr-2" />
            )}
            Classify Email
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleGenerateReply}
            disabled={isGeneratingReply}
          >
            {isGeneratingReply ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
            ) : (
              <ArrowUTurnLeftIcon className="h-4 w-4 mr-2" />
            )}
            Generate AI Reply
          </Button>
          <Button variant="outline" size="sm">
            <ArrowUTurnRightIcon className="h-4 w-4 mr-2" />
            Forward
          </Button>
        </div>

        {/* Email Status */}
        <div className="mt-3 flex items-center space-x-4 text-sm text-gray-600">
          <div className="flex items-center">
            <CheckCircleIcon className="h-4 w-4 mr-1 text-green-500" />
            Status: {selectedEmail.status}
          </div>
          {selectedEmail.requires_reply && (
            <div className="flex items-center">
              <ExclamationCircleIcon className="h-4 w-4 mr-1 text-yellow-500" />
              Requires Reply
            </div>
          )}
          {selectedEmail.has_attachments && (
            <div>📎 Has Attachments</div>
          )}
        </div>
      </div>

      {/* Email Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl">
          {/* AI Summary if available */}
          {selectedEmail.summary && (
            <div className="mb-6 p-4 bg-blue-50 rounded-lg">
              <h3 className="font-semibold text-blue-900 mb-2">AI Summary</h3>
              <p className="text-blue-800 mb-3">{selectedEmail.summary}</p>
              {selectedEmail.key_points && selectedEmail.key_points.length > 0 && (
                <div>
                  <h4 className="font-medium text-blue-900 mb-1">Key Points:</h4>
                  <ul className="list-disc list-inside text-blue-800 space-y-1">
                    {selectedEmail.key_points.map((point, index) => (
                      <li key={index}>{point}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Original Email */}
          <div className="prose max-w-none">
            <div className="whitespace-pre-wrap text-gray-800">
              {selectedEmail.body_text}
            </div>
          </div>
        </div>
      </div>

      {/* Reply Section */}
      {showReplyBox && (
        <div className="border-t border-gray-200 p-6">
          <div className="max-w-3xl">
            <h3 className="font-semibold mb-3">
              Reply to {selectedEmail.sender}
            </h3>

            {/* AI Generated Reply */}
            {selectedEmail.ai_generated_reply && (
              <div className="mb-4 p-4 bg-green-50 rounded-lg">
                <h4 className="font-medium text-green-900 mb-2">AI-Generated Reply</h4>
                <p className="text-green-800 whitespace-pre-wrap mb-3">
                  {selectedEmail.ai_generated_reply}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setReplyText(selectedEmail.ai_generated_reply || '')}
                >
                  Use This Reply
                </Button>
              </div>
            )}

            {/* Reply Editor */}
            <textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="Type your reply..."
              className="w-full h-32 p-3 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="mt-3 flex justify-end space-x-3">
              <Button
                variant="outline"
                onClick={() => setShowReplyBox(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSendReply}
                disabled={!replyText.trim()}
              >
                <PaperAirplaneIcon className="h-4 w-4 mr-2" />
                Send Reply
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}