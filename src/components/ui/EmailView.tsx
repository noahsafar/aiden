import React from 'react';
import { useEmailStore } from '@/stores/emailStore';
import { Button } from '@/components/ui/Button';

interface EmailViewProps {
  email?: any;
  onReply?: () => void;
  onForward?: () => void;
  onDelete?: () => void;
  onAction?: (id: string, action: string) => void;
}

export const EmailView: React.FC<EmailViewProps> = ({
  email = null,
  onReply = () => {},
  onForward = () => {},
  onDelete = () => {},
  onAction = () => {}
}) => {
  const { sendEmail, updateEmailStatus } = useEmailStore();

  const handleSendAIReply = async () => {
    if (!email) return;

    const senderEmail = email.from?.email || email.from?.name || email.sender;
    const aiReply = 'Test response';

    try {
      await sendEmail(senderEmail, `Re: ${email.subject}`, aiReply);
      updateEmailStatus(email.id, 'Replied');
      alert('Reply sent!');
    } catch (error) {
      console.error('Failed to send AI reply:', error);
      alert('Failed to send reply');
    }
  };

  if (!email) {
    return (
      <div className="flex-1 p-6 bg-white">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-foreground mb-4">Select an email</h2>
          <p className="text-muted">Choose an email from the list to view its content.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-white dark:bg-gray-900 overflow-hidden">
      {/* Action Bar */}
      <div className="border-b border-gray-200 dark:border-gray-700 p-4">
        <Button onClick={handleSendAIReply}>
          Send AI Reply
        </Button>
      </div>

      {/* Email Content */}
      <div className="flex-1 p-6 overflow-y-auto">
        <div className="max-w-4xl mx-auto">
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-foreground mb-2">{email.subject}</h2>
            <div className="flex items-center space-x-4 text-sm text-muted">
              <span>From: {email.from?.name} &lt;{email.from?.email}&gt;</span>
              <span>{email.timestamp}</span>
            </div>
          </div>

          <div className="prose max-w-none">
            <div className="whitespace-pre-wrap text-foreground">{email.content}</div>
          </div>

          {email.hasAttachments && (
            <div className="mt-6 p-4 bg-surface-variant rounded-lg">
              <h3 className="text-sm font-semibold text-foreground mb-2">Attachments</h3>
              {email.attachments?.map((att: any, index: number) => (
                <div key={index} className="flex items-center justify-between p-2 bg-surface rounded border">
                  <span className="text-sm text-foreground">{att.name}</span>
                  <span className="text-xs text-muted">{att.size}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};