import React, { useState, useEffect } from 'react';
import { X, Send, Sparkles, Loader2, ChevronDown } from 'lucide-react';
import { Contact } from '@/stores/crmStore';
import { useEmailStore } from '@/stores/emailStore';
import { generateReply, editReply } from '@/api/claude';

interface ComposeModalProps {
  isOpen: boolean;
  onClose: () => void;
  contact: Contact;
}

const formalityLevels = [
  { value: 'casual', label: 'Casual' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'formal', label: 'Formal' },
] as const;

const aiPrompts = [
  'Say hello and check in',
  'Ask about their recent work',
  'Schedule a catch-up call',
  'Share an interesting article',
  'Thank them for something',
  'Ask for advice',
  'Propose a collaboration',
] as const;

export const ComposeModal: React.FC<ComposeModalProps> = ({ isOpen, onClose, contact }) => {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showAiPrompts, setShowAiPrompts] = useState(false);
  const [showFormality, setShowFormality] = useState(false);
  const [formality, setFormality] = useState<'casual' | 'neutral' | 'formal'>('neutral');
  const [customPrompt, setCustomPrompt] = useState('');

  const { sendEmail } = useEmailStore();

  // Reset form when modal opens with new contact
  useEffect(() => {
    if (isOpen && contact) {
      setSubject('');
      setBody('');
      setCustomPrompt('');
      setShowAiPrompts(false);
    }
  }, [isOpen, contact]);

  const handleSend = async () => {
    if (!contact.email_address || !subject || !body) return;

    setIsSending(true);
    try {
      await sendEmail(contact.email_address, subject, body);
      onClose();
    } catch (error) {
      console.error('Failed to send email:', error);
    } finally {
      setIsSending(false);
    }
  };

  const handleAiGenerate = async (prompt: string) => {
    if (!body.trim()) {
      // Generate from scratch
      setBody('');
      setIsGenerating(true);
      try {
        const contactName = contact.name || contact.email_address.split('@')[0];
        const daysSinceContact = contact.days_since_contact || 0;

        // Build a comprehensive prompt for new email generation
        const composePrompt = `Write a new ${formality} email to ${contactName} (${contact.email_address}).

Context:
- They are a ${contact.category.toLowerCase()}
- ${daysSinceContact > 30 ? `We haven't spoken in ${Math.round(daysSinceContact)} days` : 'Following up on recent conversations'}
- Goal: ${prompt}

Requirements:
- Generate an appropriate subject line (do NOT use "Re:" prefix - this is a new email)
- Write a ${formality} email body
- Be concise and natural
- Return ONLY a JSON object with "subject" and "body" fields

Format:
{
  "subject": "Appropriate subject line here",
  "body": "Email body here..."
}`;

        // Use editReply with an empty message to generate from scratch
        const generated = await editReply('', composePrompt);

        // Try to parse JSON from the response
        let parsedResult;
        try {
          // Look for JSON in the response
          const jsonMatch = generated.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            parsedResult = JSON.parse(jsonMatch[0]);
            setSubject(parsedResult.subject || '');
            setBody(parsedResult.body || generated);
          } else {
            // Fallback: put everything in body if no JSON found
            setBody(generated);
          }
        } catch {
          // If JSON parsing fails, put everything in body
          setBody(generated);
        }

        setShowAiPrompts(false);
      } catch (error) {
        console.error('Failed to generate email:', error);
      } finally {
        setIsGenerating(false);
      }
    } else {
      // Edit existing email
      setIsGenerating(true);
      try {
        const edited = await editReply(body, prompt);
        setBody(edited);
      } catch (error) {
        console.error('Failed to edit email:', error);
      } finally {
        setIsGenerating(false);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col mx-4"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gray-400 flex items-center justify-center text-white font-semibold">
              {contact.name?.charAt(0).toUpperCase() || contact.email_address.charAt(0).toUpperCase()}
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {contact.name || contact.email_address.split('@')[0]}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">{contact.email_address}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="space-y-4">
            {/* Subject Field */}
            <div>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Subject"
                className="w-full px-3 py-2 bg-transparent border-b border-gray-200 dark:border-gray-700 focus:outline-none focus:border-purple-500 text-gray-900 dark:text-white placeholder-gray-400"
              />
            </div>

            {/* Body Field */}
            <div>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Write your message..."
                rows={12}
                className="w-full px-3 py-2 bg-transparent border-none focus:outline-none resize-none text-gray-900 dark:text-white placeholder-gray-400"
              />
            </div>

            {/* AI Assistant */}
            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-purple-500" />
                  AI Assistant
                </span>
                <div className="flex items-center gap-2">
                  {/* Formality Selector */}
                  <div className="relative">
                    <button
                      onClick={() => setShowFormality(!showFormality)}
                      className="flex items-center gap-1 px-2 py-1 text-xs bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                    >
                      {formalityLevels.find(f => f.value === formality)?.label}
                      <ChevronDown className="h-3 w-3" />
                    </button>
                    {showFormality && (
                      <div className="absolute bottom-full left-0 mb-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden">
                        {formalityLevels.map((level) => (
                          <button
                            key={level.value}
                            onClick={() => {
                              setFormality(level.value);
                              setShowFormality(false);
                            }}
                            className="block w-full px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                          >
                            {level.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Quick AI Prompts */}
              <div className="flex flex-wrap gap-2 mb-3">
                {aiPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => handleAiGenerate(prompt)}
                    disabled={isGenerating}
                    className="px-2 py-1 text-xs bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 rounded-full hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors disabled:opacity-50"
                  >
                    {prompt}
                  </button>
                ))}
              </div>

              {/* Custom AI Prompt */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="Or describe what you want to say..."
                  className="flex-1 px-3 py-2 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-gray-900 dark:text-white placeholder-gray-400"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && customPrompt.trim()) {
                      e.preventDefault();
                      handleAiGenerate(customPrompt);
                    }
                  }}
                />
                <button
                  onClick={() => handleAiGenerate(customPrompt)}
                  disabled={isGenerating || !customPrompt.trim()}
                  className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {isGenerating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  Generate
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-4 border-t border-gray-200 dark:border-gray-700">
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {body.length} characters · Cmd+Enter to send
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
            >
              Discard
            </button>
            <button
              onClick={handleSend}
              disabled={!contact.email_address || !subject || !body || isSending}
              className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {isSending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
