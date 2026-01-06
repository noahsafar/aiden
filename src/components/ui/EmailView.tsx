import React, { useMemo } from 'react';
import { useEmailStore } from '@/stores/emailStore';
import { Button } from '@/components/ui/Button';
import { Bookmark } from 'lucide-react';

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
  const { sendEmail, updateEmailStatus, emails, sentEmails, saveEmail, unsaveEmail, isGeneratingReply, isGeneratingSummary, hasSentReply } = useEmailStore();

  const [isEditing, setIsEditing] = React.useState(false);
  const [editedReply, setEditedReply] = React.useState('');
  const [aiEditPrompt, setAiEditPrompt] = React.useState('');
  const [isAiEditing, setIsAiEditing] = React.useState(false);

  // Get the full email data from store - this updates when store updates
  const fullEmail = useMemo(() => {
    return email ? emails.find(e => e.id === email.id) : null;
  }, [email?.id, emails]);

  // Check if this is a sent email
  const sentEmail = email ? sentEmails.find(e => e.id === email.id) : null;
  const isSentEmail = !!sentEmail;

  // For sent emails, get the original email that was replied to
  const originalEmail = sentEmail?.originalEmail || (sentEmail?.inReplyTo ? emails.find(e => e.id === sentEmail.inReplyTo) : null);

  // Get summary from store
  const summary = fullEmail?.summary || '';

  // Get AI reply from store
  const aiReply = fullEmail?.ai_generated_reply || null;

  // Parse the AI reply to extract subject and body
  const parseAIReply = (reply: string) => {
    if (!reply) return { subject: null, body: '' };

    // The first line is the subject line (from the Python prompt)
    const lines = reply.split('\n');
    const firstLine = lines[0]?.trim() || '';

    // Check if first line looks like a subject (starts with common patterns or is short)
    const subjectPatterns = ['re:', 'fw:', 'subject:', 'regarding', 'about', 'update'];
    const looksLikeSubject = firstLine.length < 100 && (
      firstLine.match(/^[A-Z]/) || // Starts with capital
      subjectPatterns.some(p => firstLine.toLowerCase().startsWith(p))
    );

    if (looksLikeSubject && lines.length > 1) {
      return {
        subject: firstLine,
        body: lines.slice(1).join('\n').trim()
      };
    }

    return { subject: null, body: reply };
  };

  const parsedReply = parseAIReply(aiReply || '');

  // Check if reply is being generated
  const isGenerating = email?.id ? isGeneratingReply(email.id) : false;

  // Check if summary is being generated
  const isSummaryGenerating = email?.id ? isGeneratingSummary(email.id) : false;

  // Check if we've already sent a reply to this email
  const hasSent = email?.id ? hasSentReply(email.id) : false;

  // Initialize edited reply when AI reply becomes available
  React.useEffect(() => {
    if (aiReply && !isEditing) {
      setEditedReply(aiReply);
    }
  }, [aiReply, isEditing]);

  // Clear state when email changes
  React.useEffect(() => {
    if (!email?.id || isSentEmail) {
      setEditedReply('');
      setIsEditing(false);
      setAiEditPrompt('');
    } else if (aiReply) {
      setEditedReply(aiReply);
    }
  }, [email?.id, isSentEmail, aiReply]);

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

    // Get the full email data from store to pass as original email
    const originalEmailData = fullEmail || {
      id: email.id,
      sender: email.from?.email || email.from?.name || email.sender,
      subject: email.subject,
      body_text: email.content || '',
      recipients: email.to?.map((t: any) => t.email || t.name).join(', ') || '',
      date: email.timestamp || new Date().toISOString(),
      snippet: email.content?.substring(0, 100) || '',
      is_read: true,
      is_starred: false,
      has_attachments: false,
      status: 'Unhandled' as const,
      category: 'Normal' as const,
      requires_reply: false,
      gmail_id: email.id,
      thread_id: email.id,
    };

    try {
      await sendEmail(senderEmail, `Re: ${email.subject}`, editedReply, email.id, originalEmailData);
      updateEmailStatus(email.id, 'Replied');
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
      <div className={isSentEmail ? 'px-4 pb-4' : 'border-b border-gray-200 dark:border-gray-700 p-4'}>

        {/* Summary Loading Indicator */}
        {isSummaryGenerating && !summary && (
          <div className="p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
            <p className="text-xs font-medium text-purple-700 dark:text-purple-300 mb-1">AI Summary</p>
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 animate-spin rounded-full border border-purple-500 border-t-transparent" />
              <p className="text-sm text-purple-700 dark:text-purple-300">Generating...</p>
            </div>
          </div>
        )}

        {/* Summary Display */}
        {summary && (
          <div className="p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
            <div>
              <p className="text-xs font-medium text-purple-700 dark:text-purple-300 mb-1">AI Summary</p>
              <p className="text-sm text-gray-700 dark:text-gray-300">{summary}</p>
            </div>
          </div>
        )}

        {/* Generating reply indicator */}
        {isGenerating && (
          <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
            <p className="text-xs font-medium text-blue-700 dark:text-blue-300 mb-1">AI Response</p>
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 animate-spin rounded-full border border-blue-500 border-t-transparent" />
              <p className="text-sm text-blue-700 dark:text-blue-300">Generating...</p>
            </div>
          </div>
        )}

        {/* AI Reply Display/Edit */}
        {aiReply && (
          <div className="mt-4 space-y-3">
            <div className={`p-3 rounded-lg border ${hasSent ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'}`}>
              <div className="flex items-center justify-between mb-2">
                <p className={`text-xs font-medium ${hasSent ? 'text-green-700 dark:text-green-300' : 'text-blue-700 dark:text-blue-300'}`}>
                  AI Response {hasSent && '(Sent)'}
                </p>
                {hasSent && (
                  <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    Sent
                  </span>
                )}
              </div>

              {/* Show subject line separately if detected */}
              {parsedReply.subject && !isEditing && (
                <div className="mb-2 pb-2 border-b border-blue-200 dark:border-blue-700">
                  <p className="text-xs text-blue-600 dark:text-blue-400 font-medium">Subject:</p>
                  <p className="text-sm text-gray-800 dark:text-gray-200 font-semibold">{parsedReply.subject}</p>
                </div>
              )}

              {isEditing ? (
                <textarea
                  value={editedReply}
                  onChange={(e) => setEditedReply(e.target.value)}
                  className="w-full min-h-[120px] p-2 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 rounded border border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                  placeholder="Edit your reply..."
                />
              ) : (
                <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{parsedReply.body}</p>
              )}
              {!hasSent && (
                <div className="flex items-center gap-2 mt-5">
                  <Button size="sm" onClick={handleSendReply}>
                    Send
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setIsEditing(!isEditing)}>
                    {isEditing ? 'Done' : 'Edit'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { setEditedReply(aiReply); setIsEditing(false); setAiEditPrompt(''); }}>
                    Discard
                  </Button>
                </div>
              )}
            </div>

            {/* AI Edit Section - only show if not sent */}
            {isEditing && !hasSent && (
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
          {isSentEmail && originalEmail ? (
            // Conversation view for sent emails
            <div className="-mt-4 space-y-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-300">Conversation</h2>
                <span className="text-sm text-gray-500">{new Date(sentEmail!.date).toLocaleString()}</span>
              </div>

              {/* Original Email (Incoming) */}
              <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="w-8 h-8 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center text-sm font-medium text-gray-600 dark:text-gray-300">
                      {(originalEmail.sender || originalEmail.recipients)?.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        From: {originalEmail.sender || 'Unknown'}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">To: You</p>
                    </div>
                  </div>
                  <span className="text-xs text-gray-500">
                    {originalEmail.date ? new Date(originalEmail.date).toLocaleString() : ''}
                  </span>
                </div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                  {originalEmail.subject}
                </h3>
                <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                  {originalEmail.body_text || originalEmail.snippet || 'No content available'}
                </div>
              </div>

              {/* Arrow */}
              <div className="flex justify-center">
                <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                  <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  </svg>
                </div>
              </div>

              {/* Your Reply (Outgoing) */}
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-sm font-medium text-white">
                      You
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        To: {sentEmail!.recipients || 'Unknown'}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">From: You</p>
                    </div>
                  </div>
                  <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">Your Reply</span>
                </div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                  {sentEmail!.subject}
                </h3>
                <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                  {sentEmail!.body_text || sentEmail!.snippet || 'No content available'}
                </div>
              </div>
            </div>
          ) : (
            // Regular email view
            <>
              <div className="mb-6">
                <div className="flex items-start justify-between">
                  <h2 className="text-2xl font-bold text-foreground mb-2">{email.subject}</h2>
                  <button
                    onClick={() => {
                      if (fullEmail?.status === 'Saved') {
                        unsaveEmail(email.id);
                      } else {
                        saveEmail(email.id);
                      }
                    }}
                    className="flex-shrink-0"
                  >
                    <Bookmark
                      className={`w-5 h-5 ${fullEmail?.status === 'Saved' ? 'fill-purple-500 text-purple-500' : 'text-gray-400 hover:text-gray-600'} transition-colors`}
                    />
                  </button>
                </div>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
};
