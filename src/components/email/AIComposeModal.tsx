import { useState, useRef, useEffect } from 'react';
import {
  X as XMarkIcon,
  Send as PaperAirplaneIcon,
  Sparkles as SparklesIcon,
  User as UserIcon,
  Clock as ClockIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useEmailStore } from '@/stores/emailStore';
import { useAuthStore } from '@/stores/authStore';
import { useCrmStore, Contact } from '@/stores/crmStore';
import { editReply, getConversationContext, getRecipientWritingStyle } from '@/api/claude';

interface AIComposeModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTo?: string;
  initialSubject?: string;
  initialBody?: string;
  /** When set, the modal pre-fills the AI instruction and auto-drafts the email. */
  initialPrompt?: string;
}

const TONE_OPTIONS = [
  { id: 'professional', name: 'Professional', description: 'Formal and business-like' },
  { id: 'friendly', name: 'Friendly', description: 'Warm and approachable' },
  { id: 'casual', name: 'Casual', description: 'Relaxed and informal' },
  { id: 'concise', name: 'Concise', description: 'Brief and to the point' },
];

export function AIComposeModal({ isOpen, onClose, initialTo, initialSubject, initialBody, initialPrompt }: AIComposeModalProps) {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [selectedTone, setSelectedTone] = useState('professional');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [showAIPanel, setShowAIPanel] = useState(true);
  const [regenerateInstruction, setRegenerateInstruction] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const { sendEmail, emails } = useEmailStore();
  const { user } = useAuthStore();
  const userName = user?.name || 'Your Name';
  const { contacts } = useCrmStore();

  // Compute suggested recipients: top contacts by total_emails_sent
  const suggestedRecipients = contacts
    .filter(c => c.total_emails_sent > 0)
    .sort((a, b) => b.total_emails_sent - a.total_emails_sent)
    .slice(0, 5);

  // Filter contacts based on input
  const filteredContacts = contacts.filter(contact => {
    const search = to.toLowerCase();
    return (
      contact.email_address.toLowerCase().includes(search) ||
      contact.name?.toLowerCase().includes(search)
    );
  }).slice(0, 8);

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Reset form when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      // Reset after close animation
      setTimeout(() => {
        setTo('');
        setSubject('');
        setBody('');
        setAiPrompt('');
        setSelectedTone('professional');
        setShowAIPanel(true);
        setRegenerateInstruction('');
        setShowSuggestions(false);
        setHighlightedIndex(-1);
      }, 200);
    }
  }, [isOpen]);

  // Handle initial values from chat (when composeData is set)
  useEffect(() => {
    if (isOpen && (initialTo || initialSubject || initialBody)) {
      if (initialTo) setTo(initialTo);
      if (initialSubject) setSubject(initialSubject);
      if (initialBody) {
        setBody(initialBody);
        setShowAIPanel(false); // Skip AI panel if we have pre-filled content
      }
    }
  }, [isOpen, initialTo, initialSubject, initialBody]);

  // When Aiden hands us an instruction (e.g. "congratulate Sarah on her raise"),
  // pre-fill it and draft immediately so the user lands on a ready-to-edit email.
  const autoDraftedRef = useRef(false);
  useEffect(() => {
    if (!isOpen) {
      autoDraftedRef.current = false;
      return;
    }
    if (initialPrompt && !initialBody && !autoDraftedRef.current) {
      autoDraftedRef.current = true;
      setAiPrompt(initialPrompt);
      setShowAIPanel(true);
      handleGenerateEmail(initialPrompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialPrompt, initialBody]);

  const handleSelectContact = (contact: Contact) => {
    setTo(contact.email_address);
    setShowSuggestions(false);
    setHighlightedIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      // Cmd/Ctrl + Enter to send
      handleSend();
    }
  };

  const handleToKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex(prev =>
        prev < filteredContacts.length - 1 ? prev + 1 : prev
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex(prev => (prev > 0 ? prev - 1 : -1));
    } else if (e.key === 'Enter' && highlightedIndex >= 0) {
      e.preventDefault();
      handleSelectContact(filteredContacts[highlightedIndex]);
    }
  };

  const handleGenerateEmail = async (promptOverride?: string) => {
    const instruction = (promptOverride ?? aiPrompt).trim();
    if (!instruction) return;

    setIsGenerating(true);
    try {
      // Build the full prompt for AI
      const toneInstruction = TONE_OPTIONS.find(t => t.id === selectedTone)?.description || 'professional';

      // Parity with replies: ground the draft in prior conversation history with
      // this recipient and any learned per-recipient writing style. Best-effort —
      // a new contact (no history/style) just composes without these blocks.
      const recipientEmail = (to || initialTo || '').trim();
      let historyBlock = '';
      let styleBlock = '';
      if (recipientEmail.includes('@')) {
        try {
          const convo = await getConversationContext(recipientEmail, emails, undefined, 5);
          if (convo?.previous_emails?.length) {
            const lines = convo.previous_emails
              .map(e => `${e.is_from_user ? 'Me' : (e.sender || 'Them')}: "${e.subject || '(no subject)'}" — ${(e.body || '').replace(/\s+/g, ' ').slice(0, 200)}`)
              .join('\n');
            historyBlock = `\nRecent conversation history with this recipient (most recent first):\n${lines}\nUse this to match the relationship's context and continuity.\n`;
          }
        } catch { /* no history — compose without it */ }
        try {
          const style = await getRecipientWritingStyle(recipientEmail);
          if (style) {
            styleBlock = `\nMatch how I usually write to this person:\n- Tone: ${style.tone_description}\n- Greeting: ${style.greeting_style}\n- Sign-off: ${style.sign_off_style}${style.common_phrases?.length ? `\n- Phrases I use: ${style.common_phrases.slice(0, 5).join(', ')}` : ''}\n`;
          }
        } catch { /* no learned style — use the selected tone */ }
      }

      const fullPrompt = `Write a new email with the following details:

${instruction}

Tone: ${toneInstruction}
Recipient: ${recipientEmail || 'not specified'}
My name is ${userName} - sign off with "${userName}", not "[Your Name]" or a placeholder
${historyBlock}${styleBlock}
Please write a complete email with an appropriate subject line. Format your response as JSON:
{
  "subject": "your subject line here",
  "body": "email body here..."
}`;

      const generated = await editReply('', fullPrompt);

      // Try to parse JSON from the response
      try {
        const jsonMatch = generated.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsedResult = JSON.parse(jsonMatch[0]);
          if (parsedResult.subject) setSubject(parsedResult.subject);
          if (parsedResult.body) {
            setBody(parsedResult.body);
          } else {
            setBody(generated);
          }
        } else {
          // Fallback: try to parse subject/body from text
          const subjectMatch = generated.match(/Subject:\s*(.+?)(?:\n|$)/i);
          const extractedSubject = subjectMatch ? subjectMatch[1].trim() : '';
          const extractedBody = generated.replace(/Subject:\s*.+?\n+/i, '').trim();

          if (extractedSubject) setSubject(extractedSubject);
          setBody(extractedBody || generated);
        }
      } catch {
        // If parsing fails, use the whole response as body
        setBody(generated);
      }

      setShowAIPanel(false);
    } catch (error) {
      console.error('Failed to generate email:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRegenerate = async () => {
    if (!body) return;

    setIsGenerating(true);
    try {
      const instruction = regenerateInstruction.trim() ||
        `Please rewrite this email with a ${TONE_OPTIONS.find(t => t.id === selectedTone)?.description || 'professional'} tone. Use my actual name "${userName}" for the sign-off, not a placeholder.`;

      const edited = await editReply(body, instruction);
      setBody(edited);
    } catch (error) {
      console.error('Failed to regenerate email:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSend = async () => {
    if (!to || !subject || !body) return;

    setIsSending(true);
    try {
      await sendEmail(to, subject, body);
      // Clear form and close
      setTo('');
      setSubject('');
      setBody('');
      setAiPrompt('');
      onClose();
    } catch (error) {
      console.error('Failed to send email:', error);
    } finally {
      setIsSending(false);
    }
  };

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [body]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div
        className="bg-surface rounded-2xl shadow-elevated-lg border border-gray-200/70 dark:border-white/[0.08] w-full max-w-4xl max-h-[90vh] flex overflow-hidden animate-scale-in"
        onKeyDown={handleKeyDown}
      >
        {/* Left Panel - AI Assistant */}
        {showAIPanel && (
          <div className="w-80 border-r border-gray-200/70 dark:border-white/[0.08] flex flex-col bg-background">
            {/* Header */}
            <div className="px-4 py-3 border-b border-gray-200/70 dark:border-white/[0.08]">
              <div>
                <h3 className="font-semibold text-foreground text-sm">AI Assistant</h3>
                <p className="text-xs text-muted">Describe your email</p>
              </div>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {/* Prompt Input */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  What do you want to say?
                </label>
                <textarea
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="Describe your email..."
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-200/80 dark:border-white/[0.08] rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-violet-400 bg-surface text-foreground resize-none text-sm transition-colors placeholder:text-muted"
                />
              </div>

              {/* Tone — compact pills */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Tone
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {TONE_OPTIONS.map((tone) => (
                    <button
                      key={tone.id}
                      onClick={() => setSelectedTone(tone.id)}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        selectedTone === tone.id
                          ? 'bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300 border border-violet-300 dark:border-violet-500/30'
                          : 'bg-surface text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/[0.06] border border-gray-200/80 dark:border-white/[0.08]'
                      }`}
                    >
                      {tone.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Generate Button */}
            <div className="p-4 border-t border-gray-200/70 dark:border-white/[0.08]">
              <Button
                variant="primary"
                onClick={() => handleGenerateEmail()}
                disabled={!aiPrompt.trim() || isGenerating}
                className="w-full"
              >
                {isGenerating ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                    Generating...
                  </>
                ) : (
                  <>
                    <SparklesIcon className="h-4 w-4 mr-2" />
                    Generate Email
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Right Panel - Email Editor */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-200/70 dark:border-white/[0.08]">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-foreground">
                {showAIPanel ? 'New Message' : 'Review & Edit'}
              </h2>
              {!showAIPanel && body && (
                <span className="text-xs text-violet-600 dark:text-violet-400 flex items-center gap-1">
                  <SparklesIcon className="h-3 w-3" />
                  AI generated
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {!showAIPanel && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAIPanel(true)}
                  className="text-sm"
                >
                  <SparklesIcon className="h-4 w-4 mr-1" />
                  AI Assistant
                </Button>
              )}
              <Button variant="ghost" size="icon" onClick={onClose}>
                <XMarkIcon className="h-5 w-5" />
              </Button>
            </div>
          </div>

          {/* Form */}
          <div className="flex-1 overflow-y-auto p-4">
            <div className="space-y-4">
              {/* To Field */}
              <div className="relative">
                <label htmlFor="to" className="block text-sm font-medium text-foreground mb-1.5">
                  To
                </label>
                <input
                  id="to"
                  type="email"
                  value={to}
                  onChange={(e) => {
                    setTo(e.target.value);
                    setShowSuggestions(true);
                    setHighlightedIndex(-1);
                  }}
                  onFocus={() => {
                    if (to || suggestedRecipients.length > 0) {
                      setShowSuggestions(true);
                    }
                  }}
                  onKeyDown={handleToKeyDown}
                  placeholder="recipient@example.com"
                  className="w-full px-3 py-2 border border-gray-200/80 dark:border-white/[0.08] rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-violet-400 bg-surface text-foreground transition-colors placeholder:text-muted"
                  autoComplete="off"
                />

                {/* Suggestions Dropdown */}
                {showSuggestions && (filteredContacts.length > 0 || suggestedRecipients.length > 0) && (
                  <div
                    ref={suggestionsRef}
                    className="absolute z-10 w-full mt-1 bg-surface border border-gray-200/80 dark:border-white/[0.08] rounded-lg shadow-elevated-md max-h-60 overflow-y-auto"
                  >
                    {to === '' && suggestedRecipients.length > 0 && (
                      <>
                        <div className="px-3 py-1.5 text-xs font-semibold text-muted bg-gray-50 dark:bg-white/[0.03]">
                          Suggested
                        </div>
                        {suggestedRecipients.map((contact, idx) => (
                          <button
                            key={contact.id}
                            type="button"
                            onClick={() => handleSelectContact(contact)}
                            className={`w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-white/[0.04] transition-colors ${
                              idx === highlightedIndex ? 'bg-gray-100 dark:bg-white/[0.06]' : ''
                            }`}
                          >
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center text-white font-semibold text-xs flex-shrink-0">
                              {contact.name?.charAt(0).toUpperCase() || contact.email_address.charAt(0).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm text-foreground truncate">
                                {contact.name || contact.email_address.split('@')[0]}
                              </div>
                              <div className="text-xs text-muted truncate">
                                {contact.email_address}
                              </div>
                            </div>
                            <div className="text-xs text-muted/70 flex-shrink-0">
                              {contact.total_emails_sent} sent
                            </div>
                          </button>
                        ))}
                      </>
                    )}

                    {to !== '' && filteredContacts.length > 0 && (
                      filteredContacts.map((contact, idx) => (
                        <button
                          key={contact.id}
                          type="button"
                          onClick={() => handleSelectContact(contact)}
                          className={`w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-white/[0.04] transition-colors ${
                            idx === highlightedIndex ? 'bg-gray-100 dark:bg-white/[0.06]' : ''
                          }`}
                        >
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center text-white font-semibold text-xs flex-shrink-0">
                            {contact.name?.charAt(0).toUpperCase() || contact.email_address.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm text-foreground truncate">
                              {contact.name || contact.email_address.split('@')[0]}
                            </div>
                            <div className="text-xs text-muted truncate">
                              {contact.email_address}
                            </div>
                          </div>
                          <div className="text-xs text-muted/70 flex-shrink-0">
                            {contact.category}
                          </div>
                        </button>
                      ))
                    )}

                    {to !== '' && filteredContacts.length === 0 && (
                      <div className="px-3 py-4 text-sm text-muted text-center">
                        No contacts found
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Subject Field */}
              <div>
                <label htmlFor="subject" className="block text-sm font-medium text-foreground mb-1.5">
                  Subject
                </label>
                <input
                  id="subject"
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Email subject"
                  className="w-full px-3 py-2 border border-gray-200/80 dark:border-white/[0.08] rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-violet-400 bg-surface text-foreground transition-colors placeholder:text-muted"
                />
              </div>

              {/* Body Field */}
              <div>
                <label htmlFor="body" className="block text-sm font-medium text-foreground mb-1.5">
                  Message
                </label>
                <textarea
                  ref={textareaRef}
                  id="body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Type your message here or use the AI assistant to generate one..."
                  rows={12}
                  className="w-full px-3 py-2 border border-gray-200/80 dark:border-white/[0.08] rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-violet-400 bg-surface text-foreground transition-colors placeholder:text-muted"
                />
              </div>

              {/* AI Quick Actions (shown when body exists) */}
              {body && !showAIPanel && (
                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <input
                    type="text"
                    value={regenerateInstruction}
                    onChange={(e) => setRegenerateInstruction(e.target.value)}
                    placeholder="Instructions for regeneration (e.g., 'make it shorter', 'add more details')..."
                    className="flex-1 min-w-0 px-3 py-1.5 text-sm border border-gray-200/80 dark:border-white/[0.08] rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-violet-400 bg-surface text-foreground transition-colors placeholder:text-muted"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && regenerateInstruction.trim()) {
                        e.preventDefault();
                        handleRegenerate();
                      }
                    }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRegenerate}
                    disabled={isGenerating}
                  >
                    <SparklesIcon className="h-4 w-4 mr-1" />
                    Regenerate
                  </Button>
                  <span className="text-xs text-muted flex items-center">
                    Cmd+Enter to send
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between p-4 border-t border-gray-200/70 dark:border-white/[0.08] bg-background">
            <div className="text-sm text-muted">
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
    </div>
  );
}
