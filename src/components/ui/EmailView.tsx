import React, { useState, useEffect, useRef } from 'react';
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
  const { sendEmail, updateEmailStatus, emails, summarizeEmail, sentEmails } = useEmailStore();
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summary, setSummary] = useState<string>('');
  const [isEditing, setIsEditing] = useState(false);
  const [generatedReply, setGeneratedReply] = useState<string | null>(null);
  const [editedReply, setEditedReply] = useState<string>('');
  const [aiEditPrompt, setAiEditPrompt] = useState<string>('');
  const [isAiEditing, setIsAiEditing] = useState(false);

  // Track which email we're currently summarizing/generating reply to avoid duplicates
  const summarizingEmailId = useRef<string | null>(null);
  const generatingReplyEmailId = useRef<string | null>(null);

  // Get the full email data from store (includes body_text)
  const fullEmail = email ? emails.find(e => e.id === email.id) : null;

  // Check if this is a sent email (from sentEmails list)
  const sentEmail = email ? sentEmails.find(e => e.id === email.id) : null;
  const isSentEmail = !!sentEmail;

  // For sent emails, get the original email that was replied to
  const originalEmail = sentEmail?.originalEmail || (sentEmail?.inReplyTo ? emails.find(e => e.id === sentEmail.inReplyTo) : null);

  const handleSummarize = async () => {
    if (!email?.id || summarizingEmailId.current === email.id) return;

    summarizingEmailId.current = email.id;
    setIsSummarizing(true);
    try {
      const summaryText = await summarizeEmail(email.id);
      if (summaryText) {
        setSummary(summaryText);
      }
      setIsSummarizing(false);
      summarizingEmailId.current = null;
    } catch (error) {
      console.error('Failed to summarize:', error);
      setIsSummarizing(false);
      summarizingEmailId.current = null;
    }
  };

  // Auto-generate summary when email changes
  useEffect(() => {
    if (email?.id && fullEmail?.summary) {
      // Already has summary, use it
      setSummary(fullEmail.summary);
    } else if (email?.id && !fullEmail?.summary && !isSummarizing && summarizingEmailId.current !== email.id) {
      // No summary yet, generate it
      setSummary('');
      handleSummarize();
    } else if (!email?.id) {
      // No email selected, clear summary
      setSummary('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email?.id]);

  // Auto-generate reply after summary is done
  useEffect(() => {
    if (!isSentEmail && email?.id && summary && !generatedReply && !isGenerating && generatingReplyEmailId.current !== email.id) {
      // Summary is ready, now generate reply
      handleGenerateReply();
    } else if (!email?.id || isSentEmail) {
      // No email selected or it's a sent email, clear reply
      setGeneratedReply(null);
      setEditedReply('');
      setIsEditing(false);
      setAiEditPrompt('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email?.id, summary, isSentEmail]);

  const handleGenerateReply = async () => {
    if (!email?.id || generatingReplyEmailId.current === email.id) return;

    generatingReplyEmailId.current = email.id;
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
      generatingReplyEmailId.current = null;
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
      <div className={isSentEmail ? 'px-4 pb-4' : 'border-b border-gray-200 dark:border-gray-700 p-4'}>

        {/* Summary Display - shown first above reply */}
        {isSummarizing ? (
          <div className="p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 animate-spin rounded-full border border-purple-500 border-t-transparent" />
              <p className="text-sm text-purple-700 dark:text-purple-300">Generating summary...</p>
            </div>
          </div>
        ) : summary && (
          <div className="p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
            <div>
              <p className="text-xs font-medium text-purple-700 dark:text-purple-300 mb-1">AI Summary</p>
              <p className="text-sm text-gray-700 dark:text-gray-300">{summary}</p>
            </div>
          </div>
        )}

        {/* Generating reply indicator */}
        {isGenerating && (
          <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
            <p className="text-xs font-medium text-blue-700 dark:text-blue-300 mb-1">AI Response</p>
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 animate-spin rounded-full border border-blue-500 border-t-transparent" />
              <p className="text-sm text-blue-700 dark:text-blue-300">Generating...</p>
            </div>
          </div>
        )}

        {generatedReply && (
          <div className="mt-4 space-y-3">
            {/* Reply Display/Edit Area */}
            <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <p className="text-xs font-medium text-blue-700 dark:text-blue-300 mb-2">AI Response</p>
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
              <div className="flex items-center gap-2 mt-5">
                <Button size="sm" onClick={handleSendReply}>
                  Send
                </Button>
                <Button size="sm" variant="outline" onClick={() => setIsEditing(!isEditing)}>
                  {isEditing ? 'Done' : 'Edit'}
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setGeneratedReply(null); setEditedReply(''); setIsEditing(false); setAiEditPrompt(''); }}>
                  Discard
                </Button>
              </div>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
};
