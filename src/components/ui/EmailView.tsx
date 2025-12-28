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
  const [isEditing, setIsEditing] = useState(false);
  const [generatedReply, setGeneratedReply] = useState<string | null>(null);
  const [editedReply, setEditedReply] = useState<string>('');
  const [aiEditPrompt, setAiEditPrompt] = useState<string>('');
  const [isAiEditing, setIsAiEditing] = useState(false);

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
        setEditedReply(result.reply);
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

  const handleAiEdit = async () => {
    if (!aiEditPrompt.trim() || !editedReply) return;

    setIsAiEditing(true);
    try {
      const response = await fetch('http://localhost:8081/edit-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_reply: editedReply,
          edit_prompt: aiEditPrompt,
        }),
      });

      const result = await response.json();
      if (result.success) {
        setEditedReply(result.edited_reply);
        setAiEditPrompt('');
      } else {
        alert('Failed to edit reply: ' + result.error);
      }
    } catch (error) {
      console.error('Failed to AI edit reply:', error);
      alert('Failed to edit reply');
    } finally {
      setIsAiEditing(false);
    }
  };

  const handleSendReply = async () => {
    if (!email || !editedReply) return;

    const senderEmail = email.from?.email || email.from?.name || email.sender;

    try {
      await sendEmail(senderEmail, `Re: ${email.subject}`, editedReply);
      updateEmailStatus(email.id, 'Replied');
      setGeneratedReply(null);
      setEditedReply('');
      setIsEditing(false);
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
                Send Reply
              </Button>
              <Button variant="outline" onClick={() => { setGeneratedReply(null); setEditedReply(''); setIsEditing(false); setAiEditPrompt(''); }}>
                Discard
              </Button>
              <Button variant="outline" onClick={() => setIsEditing(!isEditing)}>
                {isEditing ? 'Done Editing' : 'Edit'}
              </Button>
            </>
          )}
        </div>

        {generatedReply && (
          <div className="mt-4 space-y-3">
            {/* Reply Display/Edit Area */}
            <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              {isEditing ? (
                <textarea
                  value={editedReply}
                  onChange={(e) => setEditedReply(e.target.value)}
                  className="w-full min-h-[120px] p-2 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 rounded border border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                  placeholder="Edit your reply..."
                />
              ) : (
                <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{editedReply}</p>
              )}
            </div>

            {/* AI Edit Section */}
            {isEditing && (
              <div className="p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
                <label className="text-xs font-medium text-purple-700 dark:text-purple-300 mb-2 block">
                  ✨ AI Edit - describe how to change the email:
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={aiEditPrompt}
                    onChange={(e) => setAiEditPrompt(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAiEdit()}
                    placeholder='e.g., "make it shorter", "more formal", "add more details"...'
                    className="flex-1 px-3 py-2 text-sm bg-white dark:bg-gray-800 rounded border border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                  <Button
                    onClick={handleAiEdit}
                    disabled={isAiEditing || !aiEditPrompt.trim()}
                    size="sm"
                  >
                    {isAiEditing ? 'Editing...' : 'AI Edit'}
                  </Button>
                </div>
                <div className="flex gap-2 mt-2 flex-wrap">
                  {['Make it shorter', 'More formal', 'More casual', 'Add details'].map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => setAiEditPrompt(suggestion)}
                      className="text-xs px-2 py-1 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded hover:bg-purple-200 dark:hover:bg-purple-900/50 transition-colors"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}
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
