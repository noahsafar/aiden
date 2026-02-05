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

interface AIComposeModalProps {
  isOpen: boolean;
  onClose: () => void;
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

export function AIComposeModal({ isOpen, onClose }: AIComposeModalProps) {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [selectedTone, setSelectedTone] = useState('professional');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [showAIPanel, setShowAIPanel] = useState(true);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { sendEmail } = useEmailStore();

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
      }, 200);
    }
  }, [isOpen]);

  const handleGenerateEmail = async () => {
    if (!aiPrompt.trim()) return;

    setIsGenerating(true);
    try {
      // Build the full prompt for AI
      const toneInstruction = TONE_OPTIONS.find(t => t.id === selectedTone)?.description || 'professional';
      const fullPrompt = `${selectedTemplate ? EMAIL_TEMPLATES.find(t => t.id === selectedTemplate)?.prompt : ''} ${aiPrompt}

Tone: ${toneInstruction}
Recipient: ${to || 'not specified'}

Please write a complete email with an appropriate subject line. Format your response as:
Subject: [your subject line]

[email body]`;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': import.meta.env.VITE_ANTHROPIC_API_KEY || '',
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2000,
          messages: [
            {
              role: 'user',
              content: fullPrompt,
            },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate email');
      }

      const data = await response.json();
      const generatedText = data.content[0].text;

      // Parse subject and body
      const subjectMatch = generatedText.match(/Subject:\s*(.+?)(?:\n|$)/i);
      const extractedSubject = subjectMatch ? subjectMatch[1].trim() : '';
      const extractedBody = generatedText.replace(/Subject:\s*.+?\n+/i, '').trim();

      if (extractedSubject) {
        setSubject(extractedSubject);
      }
      setBody(extractedBody);
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
      const toneInstruction = TONE_OPTIONS.find(t => t.id === selectedTone)?.description || 'professional';
      const fullPrompt = `Please rewrite this email with a ${toneInstruction} tone:\n\n${body}`;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': import.meta.env.VITE_ANTHROPIC_API_KEY || '',
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2000,
          messages: [
            {
              role: 'user',
              content: fullPrompt,
            },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to regenerate email');
      }

      const data = await response.json();
      setBody(data.content[0].text);
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      // Cmd/Ctrl + Enter to send
      handleSend();
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
            <div className="p-4 border-b border-gray-200 dark:border-gray-700">
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-white">AI Assistant</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">Describe your email</p>
              </div>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Prompt Input */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  What do you want to say?
                </label>
                <textarea
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="Describe your email..."
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white resize-none text-sm"
                />
              </div>

              {/* Templates */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Quick Templates
                </label>
                <div className="space-y-1">
                  {EMAIL_TEMPLATES.map((template) => (
                    <button
                      key={template.id}
                      onClick={() => {
                        setSelectedTemplate(template.id);
                        setAiPrompt(prev => prev + template.prompt + ' ');
                      }}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                        selectedTemplate === template.id
                          ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-700'
                          : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-600'
                      }`}
                    >
                      <div className="font-medium">{template.name}</div>
                      <div className="text-xs opacity-70">{template.description}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Tone Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Tone
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {TONE_OPTIONS.map((tone) => (
                    <button
                      key={tone.id}
                      onClick={() => setSelectedTone(tone.id)}
                      className={`px-3 py-2 rounded-lg text-sm transition-colors text-left ${
                        selectedTone === tone.id
                          ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-700'
                          : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-600'
                      }`}
                    >
                      <div className="font-medium">{tone.name}</div>
                      <div className="text-xs opacity-70">{tone.description}</div>
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
              <div>
                <label htmlFor="to" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  To
                </label>
                <input
                  id="to"
                  type="email"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="recipient@example.com"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                />
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
                <div className="flex flex-wrap gap-2 pt-2">
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
                    Press Cmd+Enter to send
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
