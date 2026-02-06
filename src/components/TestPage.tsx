import React, { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { sendGmailEmail } from '@/api/gmail';
import { Mail, Send, CheckCircle, AlertCircle, Paperclip } from 'lucide-react';

export function TestPage() {
  const [isSending, setIsSending] = useState(false);
  const [status, setStatus] = useState<{ type: 'idle' | 'success' | 'error'; message: string }>({
    type: 'idle',
    message: ''
  });

  const handleSendTestEmail = async () => {
    setIsSending(true);
    setStatus({ type: 'idle', message: '' });

    const result = await sendGmailEmail(
      'noahsafar12345@gmail.com',
      'Test Email from Aiden AI',
      `Hello! This is a test email sent from Aiden AI to verify that the Gmail API integration is working properly.\n\nTimestamp: ${new Date().toLocaleString()}\n\nBest regards,\nAiden AI Email Manager`
    );

    if (result.success) {
      setStatus({ type: 'success', message: result.message || 'Email sent successfully!' });
    } else {
      setStatus({ type: 'error', message: result.error || 'Failed to send email' });
    }

    setIsSending(false);

    // Clear status after 5 seconds
    setTimeout(() => {
      setStatus({ type: 'idle', message: '' });
    }, 5000);
  };

  const handleSendAttachmentTestEmail = async () => {
    setIsSending(true);
    setStatus({ type: 'idle', message: '' });

    const result = await sendGmailEmail(
      'noahsafar12345@gmail.com',
      'Application for Software Engineer Position',
      `Hi,

Thank you for considering my application for the Software Engineer position at your company.

I have attached my resume, transcript, and portfolio for your review. Please let me know if you need any additional information or if you would like to schedule an interview.

Best regards,
Noah

---
This is a test email from Aiden AI to verify attachment suggestions are working properly.`
    );

    if (result.success) {
      setStatus({ type: 'success', message: result.message || 'Email sent successfully!' });
    } else {
      setStatus({ type: 'error', message: result.error || 'Failed to send email' });
    }

    setIsSending(false);

    // Clear status after 5 seconds
    setTimeout(() => {
      setStatus({ type: 'idle', message: '' });
    }, 5000);
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-8">
        <div className="flex items-center mb-6">
          <Mail className="h-8 w-8 text-primary-500 mr-3" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Gmail API Test
          </h1>
        </div>

        <div className="space-y-4">
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <p className="text-sm text-blue-800 dark:text-blue-200">
              <strong>Test Information:</strong>
            </p>
            <ul className="mt-2 space-y-1 text-sm text-blue-700 dark:text-blue-300">
              <li>• This will send test emails to: <strong>noahsafar12345@gmail.com</strong></li>
              <li>• Emails are sent using your authenticated Gmail account</li>
              <li>• <strong>Send Test Email</strong> - Basic Gmail API test</li>
              <li>• <strong>Send Attachment Test Email</strong> - Tests attachment suggestions (requests resume, transcript, portfolio)</li>
            </ul>
          </div>

          <div className="flex flex-col items-center space-y-4">
            <Button
              onClick={handleSendTestEmail}
              disabled={isSending}
              className="w-full max-w-xs"
              size="lg"
            >
              {isSending ? (
                <>
                  <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Send Test Email
                </>
              )}
            </Button>

            <Button
              onClick={handleSendAttachmentTestEmail}
              disabled={isSending}
              className="w-full max-w-xs"
              size="lg"
              variant="outline"
            >
              {isSending ? (
                <>
                  <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
                  Sending...
                </>
              ) : (
                <>
                  <Paperclip className="h-4 w-4 mr-2" />
                  Send Attachment Test Email
                </>
              )}
            </Button>

            {status.type !== 'idle' && (
              <div
                className={`flex items-center p-4 rounded-lg w-full max-w-xs ${
                  status.type === 'success'
                    ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200 border border-green-200 dark:border-green-800'
                    : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-800'
                }`}
              >
                {status.type === 'success' ? (
                  <CheckCircle className="h-5 w-5 mr-2 flex-shrink-0" />
                ) : (
                  <AlertCircle className="h-5 w-5 mr-2 flex-shrink-0" />
                )}
                <span className="text-sm font-medium">{status.message}</span>
              </div>
            )}
          </div>

          <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
              Status Information
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex items-center">
                <span className="font-medium text-gray-700 dark:text-gray-300 w-32">Tauri Runtime:</span>
                <span className={`px-2 py-1 rounded text-xs ${
                  window.__TAURI__ ? 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200' : 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200'
                }`}>
                  {window.__TAURI__ ? 'Available' : 'Not Available'}
                </span>
              </div>
              <div className="flex items-center">
                <span className="font-medium text-gray-700 dark:text-gray-300 w-32">Email Service:</span>
                <span className="px-2 py-1 rounded text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200">
                  Backend Ready
                </span>
              </div>
              <div className="flex items-center">
                <span className="font-medium text-gray-700 dark:text-gray-300 w-32">Auth Method:</span>
                <span className="px-2 py-1 rounded text-xs bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-200">
                  OAuth via Tauri
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}