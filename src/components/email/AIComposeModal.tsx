import { useState, useRef, useEffect } from 'react';
import {
  XMarkIcon,
  PaperAirplaneIcon,
  SparklesIcon,
  UserIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';
import { Button } from '@/components/ui/Button';
import { useEmailStore } from '@/stores/emailStore';
import { useAuthStore } from '@/stores/authStore';
import { useCrmStore, Contact } from '@/stores/crmStore';
import { editReply } from '@/api/claude';

interface AIComposeModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTo?: string;
  initialSubject?: string;
  initialBody?: string;
}

interface EmailTemplate {
  id: string;
  name: string;
  description: string;
  prompt: string;
}

const EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    id: 'professional',
    name: 'Professional Email',
    description: 'Formal business communication',
    prompt: 'Write a professional email regarding:',
  },
  {
    id: 'follow-up',
    name: 'Follow Up',
    description: 'Follow up on a previous conversation',
    prompt: 'Write a follow-up email to check in about:',
  },
  {
    id: 'request',
    name: 'Request/Ask',
    description: 'Make a request or ask for something',
    prompt: 'Write a polite email requesting:',
  },
  {
    id: 'thank-you',
    name: 'Thank You',
    description: 'Express gratitude',
    prompt: 'Write a thank you email for:',
  },
  {
    id: 'apology',
    name: 'Apology',
    description: 'Apologize for an issue or mistake',
    prompt: 'Write a sincere apology email for:',
  },
  {
    id: 'meeting',
    name: 'Meeting Request',
    description: 'Request a meeting or call',
    prompt: 'Write a meeting request email for:',
  },
];

const TONE_OPTIONS = [
  { id: 'professional', name: 'Professional', description: 'Formal and business-like' },
  { id: 'friendly', name: 'Friendly', description: 'Warm and approachable' },
  { id: 'casual', name: 'Casual', description: 'Relaxed and informal' },
  { id: 'concise', name: 'Concise', description: 'Brief and to the point' },
];

export function AIComposeModal({ isOpen, onClose, initialTo, initialSubject, initialBody }: AIComposeModalProps) {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [selectedTone, setSelectedTone] = useState('professional');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [showAIPanel, setShowAIPanel] = useState(true);
  const [regenerateInstruction, setRegenerateInstruction] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const { sendEmail } = useEmailStore();
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
        setSelectedTemplate(null);
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

  const handleGenerateEmail = async () => {
    if (!aiPrompt.trim()) return;

    setIsGenerating(true);
    try {
      // Build the full prompt for AI
      const toneInstruction = TONE_OPTIONS.find(t => t.id === selectedTone)?.description || 'professional';
      const templatePrompt = selectedTemplate ? EMAIL_TEMPLATES.find(t => t.id === selectedTemplate)?.prompt : '';

      const fullPrompt = `Write a new email with the following details:

${templatePrompt}
${aiPrompt}

Tone: ${toneInstruction}
Recipient: ${to || 'not specified'}
My name is ${userName} - sign off with "${userName}", not "[Your Name]" or a placeholder

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
      setSelectedTemplate(null);
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div
        className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex overflow-hidden"
        onKeyDown={handleKeyDown}
      >
        {/* Left Panel - AI Assistant */}
        {showAIPanel && (
          <div className="w-80 border-r border-gray-200 dark:border-gray-700 flex flex-col bg-gray-50 dark:bg-gray-900">
            {/* Header */}
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-white text-sm">AI Assistant</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">Describe your email</p>
              </div>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {/* Prompt Input */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  What do you want to say?
                </label>
                <textarea
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="Describe your email..."
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white resize-none text-sm"
                />
              </div>

              {/* Templates */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Quick Templates
                </label>
                <div className="space-y-1">
                  {EMAIL_TEMPLATES.map((template) => (
                    <button
                      key={template.id}
                      onClick={() => {
                        setSelectedTemplate(template.id);
                        setAiPrompt(template.prompt + ' ');
                      }}
                      className={`w-full text-left px-3 py-1.5 rounded-lg text-sm transition-colors ${
                        selectedTemplate === template.id
                          ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-700'
                          : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-600'
                      }`}
                    >
                      <div className="font-medium text-xs">{template.name}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{template.description.split(' ').slice(0, 3).join(' ')}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Tone Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Tone
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {TONE_OPTIONS.map((tone) => (
                    <button
                      key={tone.id}
                      onClick={() => setSelectedTone(tone.id)}
                      className={`px-3 py-1.5 rounded-lg text-sm transition-colors text-left ${
                        selectedTone === tone.id
                          ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-700'
                          : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-600'
                      }`}
                    >
                      <div className="font-medium text-xs">{tone.name}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{tone.description.split(' ')[0]}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Generate Button */}
            <div className="p-4 border-t border-gray-200 dark:border-gray-700">
              <Button
                variant="primary"
                onClick={handleGenerateEmail}
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
          <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {showAIPanel ? 'New Message' : 'Review & Edit'}
              </h2>
              {!showAIPanel && body && (
                <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
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
                <label htmlFor="to" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
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
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  autoComplete="off"
                />

                {/* Suggestions Dropdown */}
                {showSuggestions && (filteredContacts.length > 0 || suggestedRecipients.length > 0) && (
                  <div
                    ref={suggestionsRef}
                    className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-60 overflow-y-auto"
                  >
                    {to === '' && suggestedRecipients.length > 0 && (
                      <>
                        <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/50">
                          Suggested
                        </div>
                        {suggestedRecipients.map((contact, idx) => (
                          <button
                            key={contact.id}
                            type="button"
                            onClick={() => handleSelectContact(contact)}
                            className={`w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${
                              idx === highlightedIndex ? 'bg-gray-100 dark:bg-gray-700' : ''
                            }`}
                          >
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white font-semibold text-xs flex-shrink-0">
                              {contact.name?.charAt(0).toUpperCase() || contact.email_address.charAt(0).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm text-gray-900 dark:text-white truncate">
                                {contact.name || contact.email_address.split('@')[0]}
                              </div>
                              <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                {contact.email_address}
                              </div>
                            </div>
                            <div className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
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
                          className={`w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${
                            idx === highlightedIndex ? 'bg-gray-100 dark:bg-gray-700' : ''
                          }`}
                        >
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white font-semibold text-xs flex-shrink-0">
                            {contact.name?.charAt(0).toUpperCase() || contact.email_address.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm text-gray-900 dark:text-white truncate">
                              {contact.name || contact.email_address.split('@')[0]}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                              {contact.email_address}
                            </div>
                          </div>
                          <div className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
                            {contact.category}
                          </div>
                        </button>
                      ))
                    )}

                    {to !== '' && filteredContacts.length === 0 && (
                      <div className="px-3 py-4 text-sm text-gray-500 dark:text-gray-400 text-center">
                        No contacts found
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Subject Field */}
              <div>
                <label htmlFor="subject" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Subject
                </label>
                <input
                  id="subject"
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Email subject"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                />
              </div>

              {/* Body Field */}
              <div>
                <label htmlFor="body" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Message
                </label>
                <textarea
                  ref={textareaRef}
                  id="body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Type your message here or use the AI assistant to generate one..."
                  rows={12}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
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
                    className="flex-1 min-w-0 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400"
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
                  <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center">
                    Cmd+Enter to send
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
            <div className="text-sm text-gray-500 dark:text-gray-400">
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
