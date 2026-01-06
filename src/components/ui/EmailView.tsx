import React, { useMemo, useEffect } from 'react';
import { useEmailStore } from '@/stores/emailStore';
import { Button } from '@/components/ui/Button';
import { Bookmark } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

// Helper to decode HTML entities
function decodeHTMLEntities(text: string): string {
  if (!text) return text;
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  return textarea.value;
}

interface EmailViewProps {
  email?: any;
  onReply?: () => void;
  onForward?: () => void;
  onDelete?: () => void;
  onAction?: (id: string, action: string) => void;
}

type FormalityLevel = 'casual' | 'neutral' | 'formal';

export const EmailView: React.FC<EmailViewProps> = ({
  email = null,
  onReply = () => {},
  onForward = () => {},
  onDelete = () => {},
  onAction = () => {}
}) => {
  const { sendEmail, updateEmailStatus, emails, sentEmails, saveEmail, unsaveEmail, isGeneratingSummary, hasSentReply } = useEmailStore();

  const [isEditing, setIsEditing] = React.useState(false);
  const [editedReply, setEditedReply] = React.useState('');
  const [aiEditPrompt, setAiEditPrompt] = React.useState('');
  const [isAiEditing, setIsAiEditing] = React.useState(false);
  const [hasEdited, setHasEdited] = React.useState(false);
  const [localAiReply, setLocalAiReply] = React.useState<string | null>(null); // Local state for immediate display
  const [lastError, setLastError] = React.useState<string>(''); // For debugging
  const [serverRunning, setServerRunning] = React.useState<boolean | null>(null); // Server health status

  // Question/answer flow state - store answers as a map of question index -> answer
  const [pendingQuestions, setPendingQuestions] = React.useState<any[]>([]);
  const [userAnswers, setUserAnswers] = React.useState<Record<number, string>>({});
  const [analyzingQuestions, setAnalyzingQuestions] = React.useState(false);
  const [questionsLoaded, setQuestionsLoaded] = React.useState(false); // Track if we've gotten a response from backend
  const [generatingReply, setGeneratingReply] = React.useState(false);
  const [formalityLevel, setFormalityLevel] = React.useState<FormalityLevel>('neutral');
  const [suggestedFormality, setSuggestedFormality] = React.useState<FormalityLevel>('neutral');
  const [summaryComplete, setSummaryComplete] = React.useState(false);
  const analyzedEmailIds = React.useRef(new Set<string>());

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

  // Use local AI reply if set, otherwise fall back to store
  const displayAiReply = localAiReply || aiReply;

  // Check if summary is being generated
  const isSummaryGenerating = email?.id ? isGeneratingSummary(email.id) : false;

  // Check if we've already sent a reply to this email
  const hasSent = email?.id ? hasSentReply(email.id) : false;

  // Initialize edited reply when AI reply becomes available (only if not already edited)
  React.useEffect(() => {
    if (displayAiReply && !isEditing && !hasEdited) {
      setEditedReply(displayAiReply);
    }
  }, [displayAiReply, isEditing, hasEdited]);

  // Clear state when email changes
  React.useEffect(() => {
    if (!email?.id || isSentEmail) {
      setEditedReply('');
      setIsEditing(false);
      setAiEditPrompt('');
      setHasEdited(false);
      setLocalAiReply(null);
      setLastError('');
      // Clear the analyzed flag when switching emails
      analyzedEmailIds.current.clear();
      setPendingQuestions([]);
      setUserAnswers({});
      setFormalityLevel('neutral');
      setSuggestedFormality('neutral');
      setSummaryComplete(false);
      setQuestionsLoaded(false);
    } else if (displayAiReply) {
      setEditedReply(displayAiReply);
      setHasEdited(false);
    }
  }, [email?.id, isSentEmail, displayAiReply]);

  // When summary completes and we have no aiReply, start question analysis
  useEffect(() => {
    if (summary && !summaryComplete && !displayAiReply && !isSentEmail && !hasSent && !analyzedEmailIds.current.has(email?.id + '_questions')) {
      setSummaryComplete(true);
      // Start question analysis after summary is done
      analyzeEmailForQuestions();
    }
  }, [summary, aiReply, isSentEmail, hasSent, email?.id]);

  // Also handle case where summary already exists on mount
  useEffect(() => {
    if (summary && !displayAiReply && !isSentEmail && !hasSent && !analyzedEmailIds.current.has(email?.id + '_questions')) {
      analyzedEmailIds.current.add(email?.id + '_questions');
      setSummaryComplete(true);
      analyzeEmailForQuestions();
    }
  }, []);

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
        setHasEdited(true);
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

  // Check if the OAuth server is running
  const checkServerHealth = async (): Promise<boolean> => {
    try {
      const isRunning = await invoke<boolean>('check_server_health');
      setServerRunning(isRunning);
      return isRunning;
    } catch (error) {
      console.log('[checkServerHealth] Server not responding:', error);
      setServerRunning(false);
      return false;
    }
  };

  // Analyze email to extract questions and detect suggested formality
  const analyzeEmailForQuestions = async () => {
    if (!fullEmail) return;

    setAnalyzingQuestions(true);
    setQuestionsLoaded(false);

    try {
      const bodyText = fullEmail.snippet || fullEmail.body_text || email.content || '';

      console.log('[analyzeEmail] Sending for analysis via Tauri command:', {
        sender: fullEmail.sender,
        subject: email.subject,
        body_length: bodyText.length,
      });

      // Use Tauri command instead of direct fetch
      const result = await invoke<any>('proxy_analyze_email', {
        sender: fullEmail.sender,
        subject: email.subject,
        bodyText: bodyText,
      });

      console.log('[analyzeEmail] Backend response:', result);

      if (result.success && result.questions && result.questions.length > 0) {
        console.log('[analyzeEmail] Found questions:', result.questions);
        setPendingQuestions(result.questions);
      } else {
        console.log('[analyzeEmail] No questions found');
        setPendingQuestions([]);
      }

      // Set suggested formality if provided
      if (result.suggested_formality) {
        setSuggestedFormality(result.suggested_formality);
        setFormalityLevel(result.suggested_formality);
      }

      // Mark that we've successfully loaded questions (even if empty)
      setQuestionsLoaded(true);
      setServerRunning(true);
    } catch (error) {
      console.error('[analyzeEmail] Failed to analyze email:', error);
      setPendingQuestions([]);
      setQuestionsLoaded(true); // Mark as loaded so we show the "no questions" message
      setServerRunning(false);
      setLastError('Analysis failed: ' + String(error));
    } finally {
      setAnalyzingQuestions(false);
    }
  };

  // Handle user answering a specific question
  const handleAnswer = (questionIndex: number, answer: string) => {
    console.log(`[handleAnswer] Question ${questionIndex} answered:`, answer);
    setUserAnswers(prev => ({ ...prev, [questionIndex]: answer }));
  };

  // Generate reply with user's answers and formality level
  const generateReply = async () => {
    if (!fullEmail) return;

    console.log('[generateReply] Starting generation with formality:', formalityLevel);
    setGeneratingReply(true);
    setLastError('');

    // Convert answers map to array format
    const answersArray = pendingQuestions.map((q, idx) => ({
      question: q.question,
      answer: userAnswers[idx] || ''
    }));

    const request = {
      sender: fullEmail.sender,
      subject: email.subject,
      body_text: fullEmail.body_text || fullEmail.snippet || email.content || '',
      user_answers: answersArray,
      formality_level: formalityLevel,
    };

    console.log('[generateReply] Request body via Tauri proxy:', JSON.stringify(request, null, 2));

    try {
      console.log('[generateReply] Sending request via Tauri proxy command...');

      // Use Tauri proxy command instead of direct fetch - this bypasses webview security
      const result = await invoke<{ reply: string; suggested_formality?: string }>('proxy_generate_reply', { request });

      console.log('[generateReply] Got response from proxy:', result);

      if (result.reply) {
        console.log('[generateReply] Reply generated successfully:', result.reply);
        // Set local state immediately for display
        setLocalAiReply(result.reply);
        setEditedReply(result.reply);
        setHasEdited(false);
        // Update store with the generated reply
        useEmailStore.setState((state) => ({
          emails: state.emails.map(e =>
            e.id === email.id ? { ...e, ai_generated_reply: result.reply } : e
          ),
        }));
      } else {
        console.error('[generateReply] Backend returned no reply:', result);
        const errorMsg = 'No reply in response';
        setLastError('Error: ' + errorMsg);
        alert('Failed to generate reply. Please try again.\n\nError: ' + errorMsg);
      }
    } catch (error) {
      console.error('[generateReply] Failed to generate reply:', error);
      const errorMsg = String(error);
      setLastError('Network error: ' + errorMsg);

      // More helpful error message
      alert('Failed to generate reply. Please check your connection.\n\nError: ' + errorMsg);
    } finally {
      console.log('[generateReply] Done, generatingReply = false');
      setGeneratingReply(false);
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
          <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-purple-500 border-t-transparent" />
              </div>
              <div>
                <p className="text-sm font-medium text-purple-700 dark:text-purple-300">Aiden is summarizing the email...</p>
                <p className="text-xs text-purple-600 dark:text-purple-400">This will just take a moment</p>
              </div>
            </div>
          </div>
        )}

        {/* Summary Display */}
        {summary && (
          <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
            <div className="flex items-center gap-2 mb-2">
              <div className="h-5 w-5 rounded-full bg-purple-500 flex items-center justify-center">
                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-sm font-medium text-purple-700 dark:text-purple-300">Summary</p>
            </div>
            <p className="text-sm text-gray-700 dark:text-gray-300 pl-7">{summary}</p>
          </div>
        )}

        {/* Analyzing questions indicator */}
        {analyzingQuestions && !displayAiReply && summary && (
          <div className="mt-4 p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
            <div className="flex items-center gap-3">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
              <div>
                <p className="text-sm font-medium text-amber-700 dark:text-amber-300">Aiden is analyzing the email...</p>
                <p className="text-xs text-amber-600 dark:text-amber-400">Looking for questions and decisions</p>
              </div>
            </div>
          </div>
        )}

        {/* Questions Section - only show after analysis is complete and no ai reply yet */}
        {!analyzingQuestions && questionsLoaded && !displayAiReply && summary && (
          <div className="mt-4 space-y-4">
            {/* Server not running warning */}
            {serverRunning === false && (
              <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-red-700 dark:text-red-300">Backend server not running</p>
                    <p className="text-xs text-red-600 dark:text-red-400">Please restart the app or run with <code>npm run tauri dev</code></p>
                  </div>
                </div>
              </div>
            )}

            {/* Questions list */}
            {pendingQuestions.length > 0 ? (
              <div className="space-y-3">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Questions to answer:</p>
                {pendingQuestions.map((question, idx) => (
                  <div
                    key={idx}
                    className={`p-4 rounded-lg border transition-colors ${
                      userAnswers[idx]
                        ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                        : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Numbered badge */}
                      <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${
                        userAnswers[idx]
                          ? 'bg-green-500 text-white'
                          : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                      }`}>
                        {idx + 1}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                          {question.question}
                        </p>
                        {question.type === 'choice' && (
                          <div className="flex flex-wrap gap-2">
                            {question.options?.map((option: string) => (
                              <button
                                key={option}
                                onClick={() => handleAnswer(idx, option)}
                                className={`px-4 py-2 text-sm rounded-full border transition-colors ${
                                  userAnswers[idx] === option
                                    ? 'bg-amber-500 text-white border-amber-500'
                                    : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                                }`}
                              >
                                {option}
                              </button>
                            ))}
                          </div>
                        )}
                        {question.type === 'text' && (
                          <div className="flex gap-2">
                            <input
                              type="text"
                              placeholder="Type your answer..."
                              defaultValue={userAnswers[idx] || ''}
                              onChange={(e) => handleAnswer(idx, e.target.value)}
                              className="flex-1 px-3 py-2 text-sm bg-white dark:bg-gray-800 rounded border border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-amber-500"
                            />
                          </div>
                        )}
                        {userAnswers[idx] && (
                          <p className="text-xs text-green-600 dark:text-green-400 mt-2 flex items-center gap-1">
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                            Answered: {userAnswers[idx]}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              /* No questions found - show a message */
              <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    No questions or decisions needed. You can generate a reply directly.
                  </p>
                </div>
              </div>
            )}

            {/* Formality Level Selector */}
            <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-medium text-blue-700 dark:text-blue-300">
                  Tone
                </p>
                {suggestedFormality !== 'neutral' && (
                  <span className="text-xs text-blue-600 dark:text-blue-400">
                    Suggested: {suggestedFormality === 'casual' ? 'Casual' : suggestedFormality === 'formal' ? 'Formal' : 'Neutral'}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                {[
                  { value: 'casual' as const, label: 'Casual' },
                  { value: 'neutral' as const, label: 'Neutral' },
                  { value: 'formal' as const, label: 'Formal' },
                ].map((level) => (
                  <button
                    key={level.value}
                    onClick={() => setFormalityLevel(level.value)}
                    className={`flex-1 px-4 py-2 text-sm rounded-md transition-colors ${
                      formalityLevel === level.value
                        ? 'bg-blue-500 text-white'
                        : 'bg-white dark:bg-gray-800 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-700 hover:bg-blue-100 dark:hover:bg-blue-900/30'
                    }`}
                  >
                    {level.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Generate Button */}
            <Button
              onClick={generateReply}
              disabled={generatingReply}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 text-base"
            >
              {generatingReply ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="h-5 w-5 animate-spin rounded-full border border-white border-t-transparent" />
                  Generating...
                </span>
              ) : (
                'Generate Reply'
              )}
            </Button>
          </div>
        )}

        {/* Generating reply indicator */}
        {generatingReply && !displayAiReply && (
          <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
            <div className="flex items-center gap-3">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
              <div>
                <p className="text-sm font-medium text-blue-700 dark:text-blue-300">Aiden is writing your reply...</p>
                <p className="text-xs text-blue-600 dark:text-blue-400">Almost done</p>
              </div>
            </div>
          </div>
        )}

        {/* Debug: Show state when not generating and no reply */}
        {!generatingReply && !displayAiReply && summary && (
          <div className="mt-4 p-2 bg-red-50 dark:bg-red-900/20 rounded border border-red-200 dark:border-red-800">
            <p className="text-xs text-red-700 dark:text-red-300">DEBUG: generatingReply={String(generatingReply)}, displayAiReply={String(displayAiReply)}, localAiReply={String(localAiReply)}, storeAiReply={String(aiReply)}</p>
            <p className="text-xs text-red-600 dark:text-red-400 mt-1">Last response: {lastError || 'None'}</p>
          </div>
        )}

        {/* AI Reply Display/Edit */}
        {displayAiReply && (
          <div className="mt-4 space-y-3">
            <div className={`p-4 rounded-lg border ${hasSent ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'}`}>
              <div className="flex items-center justify-between mb-3">
                <p className={`text-sm font-medium ${hasSent ? 'text-green-700 dark:text-green-300' : 'text-blue-700 dark:text-blue-300'}`}>
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

              {/* Show subject line */}
              {!isEditing && email?.subject && (
                <div className="mb-3 pb-3 border-b border-blue-200 dark:border-blue-700">
                  <p className="text-sm text-gray-700 dark:text-gray-300">
                    <span className="text-sm text-blue-600 dark:text-blue-400">Subject: </span>
                    Re: {email.subject}
                  </p>
                </div>
              )}

              {isEditing ? (
                <textarea
                  value={editedReply}
                  onChange={(e) => { setEditedReply(e.target.value); setHasEdited(true); }}
                  className="w-full min-h-[120px] p-3 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 rounded-lg border border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                  placeholder="Edit your reply..."
                />
              ) : (
                <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{hasEdited ? editedReply : (displayAiReply || '')}</p>
              )}
              {!hasSent && (
                <div className="flex items-center gap-2 mt-4">
                  <Button size="sm" onClick={handleSendReply}>
                    Send
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { if (isEditing) setIsEditing(false); else setIsEditing(true); }}>
                    {isEditing ? 'Done' : 'Edit'}
                  </Button>
                  {hasEdited && (
                    <Button size="sm" variant="outline" onClick={() => { setEditedReply(displayAiReply || ''); setIsEditing(false); setAiEditPrompt(''); setHasEdited(false); }}>
                      Undo
                    </Button>
                  )}
                </div>
              )}
            </div>

            {/* AI Edit Section - only show if not sent */}
            {isEditing && !hasSent && (
              <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
                <label className="text-sm font-medium text-purple-700 dark:text-purple-300 mb-2 block">
                  AI Edit - describe how to change the email:
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={aiEditPrompt}
                    onChange={(e) => setAiEditPrompt(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAiEdit()}
                    placeholder='e.g., "make it shorter", "more formal", "add more details"...'
                    className="flex-1 px-3 py-2 text-sm bg-white dark:bg-gray-800 rounded-lg border border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                  <Button
                    onClick={handleAiEdit}
                    disabled={isAiEditing || !aiEditPrompt.trim()}
                    size="sm"
                  >
                    {isAiEditing ? 'Editing...' : 'Apply'}
                  </Button>
                </div>
                <div className="flex gap-2 mt-3 flex-wrap">
                  {['Make it shorter', 'More formal', 'More casual', 'Add details'].map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => setAiEditPrompt(suggestion)}
                      className="text-xs px-3 py-1.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-full hover:bg-purple-200 dark:hover:bg-purple-900/50 transition-colors"
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
                  {decodeHTMLEntities(originalEmail.body_text || originalEmail.snippet || 'No content available')}
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
                  {decodeHTMLEntities(sentEmail!.body_text || sentEmail!.snippet || 'No content available')}
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
                <div className="whitespace-pre-wrap text-foreground">
                  {decodeHTMLEntities(email.content?.startsWith(email.subject)
                    ? email.content.substring(email.subject.length).trim()
                    : email.content)}
                </div>
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
