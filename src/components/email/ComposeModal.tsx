import { useState } from 'react';
import { XMarkIcon, PaperAirplaneIcon, PaperClipIcon } from '@heroicons/react/24/outline';
import { Button } from '@/components/ui/Button';
import { useEmailStore } from '@/stores/emailStore';

interface ComposeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ComposeModal({ isOpen, onClose }: ComposeModalProps) {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [isSending, setIsSending] = useState(false);

  const { sendEmail } = useEmailStore();

  const handleSend = async () => {
    if (!to || !subject || !body) return;

    setIsSending(true);
    try {
      await sendEmail(to, subject, body);
      // Clear form and close
      setTo('');
      setSubject('');
      setBody('');
      onClose();
    } catch (error) {
      console.error('Failed to send email:', error);
      // TODO: Show error to user
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col"
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold">New Message</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <XMarkIcon className="h-5 w-5" />
          </Button>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="space-y-4">
            {/* To Field */}
            <div>
              <label htmlFor="to" className="block text-sm font-medium text-gray-700 mb-1">
                To
              </label>
              <input
                id="to"
                type="email"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="recipient@example.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Subject Field */}
            <div>
              <label htmlFor="subject" className="block text-sm font-medium text-gray-700 mb-1">
                Subject
              </label>
              <input
                id="subject"
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Email subject"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Body Field */}
            <div>
              <label htmlFor="body" className="block text-sm font-medium text-gray-700 mb-1">
                Message
              </label>
              <textarea
                id="body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Type your message here..."
                rows={12}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Attachments */}
            <div className="flex items-center space-x-2 text-sm text-gray-600">
              <Button variant="outline" size="sm">
                <PaperClipIcon className="h-4 w-4 mr-2" />
                Attach Files
              </Button>
              <span>Coming soon</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-gray-200">
          <div className="text-sm text-gray-500">
            {body.length} characters
          </div>
          <div className="flex items-center space-x-3">
            <Button variant="outline" onClick={onClose}>
              Discard
            </Button>
            <Button
              onClick={handleSend}
              disabled={!to || !subject || !body || isSending}
            >
              {isSending ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
              ) : (
                <PaperAirplaneIcon className="h-4 w-4 mr-2" />
              )}
              Send
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}