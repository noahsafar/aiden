import React, { useState } from 'react';
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
  const { sendEmail, updateEmailStatus, emails } = useEmailStore();
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedReply, setGeneratedReply] = useState<string | null>(null);

  // Get the full email data from store (includes body_text)
  const fullEmail = email ? emails.find(e => e.id === email.id) : null;

  const handleGenerateReply = async () => {
    // Use email prop if fullEmail is not available
    const emailData = fullEmail || {
      sender: email?.from?.email || email?.from?.name || email?.sender || '',
      subject: email?.subject || '',
      body_text: email?.content || '',
      id: email?.id || ''
    };

    setIsGenerating(true);
    try {
      const response = await fetch('http://localhost:8081/generate-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender: emailData.sender,
          subject: emailData.subject,
          body_text: emailData.body_text,
        }),
      });

      const result = await response.json();
      if (result.success) {
        setGeneratedReply(result.reply);
      } else {
        alert('Failed to generate reply: ' + result.error);
      }
    } catch (error) {
      console.error('Failed to generate AI reply:', error);
      alert('Failed to generate reply');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSendReply = async () => {
    if (!email || !generatedReply) return;

    const senderEmail = email.from?.email || email.from?.name || email.sender;

    try {
      await sendEmail(senderEmail, `Re: ${email.subject}`, generatedReply);
      updateEmailStatus(email.id, 'Replied');
      setGeneratedReply(null);
      alert('Reply sent!');
    } catch (error) {
      console.error('Failed to send reply:', error);
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
        <div className="flex items-center gap-3">
          {!generatedReply ? (
            <Button onClick={handleGenerateReply} disabled={isGenerating}>
              {isGenerating ? 'Generating...' : 'Generate AI Reply'}
            </Button>
          ) : (
            <>
              <Button onClick={handleSendReply}>
                Send AI Reply
              </Button>
              <Button variant="outline" onClick={() => setGeneratedReply(null)}>
                Discard
              </Button>
            </>
          )}
        </div>

        {generatedReply && (
          <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
            <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{generatedReply}</p>
          </div>
        )}
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
