import React, { useMemo, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useEmailStore, fetchWithTimeout } from '@/stores/emailStore';
import { Button } from '@/components/ui/Button';
import { MeetingSuggestions } from '@/components/ui/MeetingSuggestions';
import { Bookmark, File, Image, FileText, Archive, Music, Video, Download, AlertCircle, Sparkles } from 'lucide-react';
import DOMPurify from 'dompurify';
import { serverURL, downloadAttachment, saveAttachmentToFile, summarizeAttachment } from '@/api/emails';

// Helper to decode HTML entities
function decodeHTMLEntities(text: string): string {
  if (!text) return text;
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  return textarea.value;
}

// Helper to get file icon based on mime type
function getFileIcon(mimeType: string): React.ReactNode {
  const type = mimeType.toLowerCase();
  if (type.startsWith('image/')) return <Image size={20} />;
  if (type.startsWith('video/')) return <Video size={20} />;
  if (type.startsWith('audio/')) return <Music size={20} />;
  if (type.includes('pdf')) return <FileText size={20} />;
  if (type.includes('zip') || type.includes('rar') || type.includes('tar') || type.includes('gzip')) return <Archive size={20} />;
  return <File size={20} />;
}

// Helper to format file size
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

// Component to render email HTML content properly
// Handles full HTML documents with <html>, <head>, <body> tags
function EmailHtmlContent({ html }: { html: string }) {
  const processedHtml = React.useMemo(() => {
    if (!html) return '';

    let cleanHtml = html;

    // If the HTML contains a full document, extract just the body content
    // or render the full document in an iframe-like way
    if (cleanHtml.includes('<html') || cleanHtml.includes('<body')) {
      // Extract content from body tags if present
      const bodyMatch = cleanHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      if (bodyMatch) {
        cleanHtml = bodyMatch[1];
      } else {
        // If no body tag but has html tag, extract everything after the head
        const headEndMatch = cleanHtml.match(/<\/head[^>]*>([\s\S]*?)$/i);
        if (headEndMatch) {
          cleanHtml = headEndMatch[1];
        }
      }
    }

    // Configure DOMPurify for email HTML - more permissive for rich email content
    // Allow all common email HTML tags and attributes
    DOMPurify.addHook('uponSanitizeAttribute', function (node, data) {
      // Allow data-* attributes
      if (data.attrName.startsWith('data-')) {
        data.keepAttr = true;
      }
      // Allow special email attributes
      if (['bgcolor', 'cellpadding', 'cellspacing', 'valign', 'align', 'nowrap', 'border',
           'colspan', 'rowspan', 'vspace', 'hspace', 'frameborder', 'scrolling', 'target',
           'xmlns', 'xmlns:v', 'xmlns:o', 'w', 'h', 'fill', 'stroke', 'shape', 'type',
           'coords', 'shape', 'usemap', 'name', 'id', 'xmlns:xlink', 'xlink:href',
           'xml:space', 'filter', 'opacity'].includes(data.attrName.toLowerCase())) {
        data.keepAttr = true;
      }
    });

    const sanitized = DOMPurify.sanitize(cleanHtml, {
      // Allow all standard HTML plus email-specific tags
      ALLOWED_TAGS: [
        // Basic HTML
        'p', 'br', 'strong', 'em', 'u', 's', 'a', 'ul', 'ol', 'li',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'code', 'pre',
        'div', 'span', 'img', 'hr', 'sup', 'sub', 'b', 'i', 'small', 'big',
        // Tables
        'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'col', 'colgroup',
        // Forms (sometimes in emails)
        'form', 'input', 'button', 'label', 'select', 'option', 'textarea',
        // Other email elements
        'font', 'center', 'map', 'area', 'object', 'param', 'embed', 'video', 'audio',
        'source', 'track', 'iframe', 'style', 'link', 'meta', 'title', 'head', 'body',
        'noscript', 'script', 'base', 'template', 'section', 'article', 'aside',
        'nav', 'main', 'header', 'footer', 'figure', 'figcaption', 'details', 'summary'
      ],
      ALLOWED_ATTR: [
        // Standard attributes
        'href', 'src', 'alt', 'title', 'class', 'style', 'width', 'height', 'target', 'rel',
        'id', 'name', 'type', 'value', 'placeholder', 'for', 'label',
        // Email/table attributes
        'bgcolor', 'background', 'cellpadding', 'cellspacing', 'valign', 'align',
        'border', 'colspan', 'rowspan', 'nowrap', 'frameborder', 'scrolling',
        'marginwidth', 'marginheight', 'hspace', 'vspace',
        // Image attributes
        'usemap', 'ismap', 'longdesc',
        // Link attributes
        'charset', 'hreflang', 'media', 'sizes', 'rev',
        // Meta/link attributes
        'http-equiv', 'content', 'scheme',
        // Script attributes
        'async', 'defer', 'crossorigin', 'integrity',
        // SVG attributes
        'fill', 'stroke', 'stroke-width', 'd', 'viewBox', 'preserveAspectRatio',
        'xmlns', 'xmlns:xlink', 'xlink:href', 'xlink:title', 'xlink:type',
        'version', 'baseProfile', 'xml:space',
        // Data attributes
        /^data-.*$/
      ],
      ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
      ALLOW_UNKNOWN_PROTOCOLS: false,
      // Allow comments (some emails use conditional comments)
      KEEP_CONTENT: true,
      // Don't strip empty tags (emails use them for spacing)
      WHOLE_DOCUMENT: false,
      // Return as a fragment
      RETURN_DOM_FRAGMENT: false,
      FORCE_BODY: false
    });

    return sanitized;
  }, [html]);

  return (
    <div
      className="email-html-content"
      dangerouslySetInnerHTML={{ __html: processedHtml }}
      style={{
        width: '100%',
        overflow: 'auto',
        // Ensure email content takes appropriate width
        maxWidth: '100%'
      }}
    />
  );
}

// ==================== ATTACHMENT COMPONENT ====================

interface AttachmentItemProps {
  attachment: {
    id: string;
    filename: string;
    mimeType: string;
    size: number;
  };
  messageId: string;
}

function AttachmentItem({ attachment, messageId }: AttachmentItemProps) {
  const [downloading, setDownloading] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [showSummary, setShowSummary] = useState(false);

  const isSummarizable = attachment.mimeType === 'application/pdf' ||
    attachment.mimeType.includes('word') ||
    attachment.mimeType.includes('document') ||
    attachment.mimeType.includes('text') ||
    attachment.mimeType.includes('powerpoint');

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const result = await downloadAttachment(messageId, attachment.id);
      if (result.success && result.data) {
        await saveAttachmentToFile(attachment.filename, result.data);
      } else {
        alert('Failed to download: ' + (result.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Download error:', error);
      alert('Failed to download attachment');
    } finally {
      setDownloading(false);
    }
  };

  const handleSummarize = async () => {
    setSummarizing(true);
    try {
      // First download the attachment
      const result = await downloadAttachment(messageId, attachment.id);
      if (result.success && result.data) {
        // Then summarize it
        const summaryResult = await summarizeAttachment(attachment.filename, result.data, attachment.mimeType);
        if (summaryResult.success && summaryResult.summary) {
          setSummary(summaryResult.summary);
          setShowSummary(true);
        } else {
          alert('Failed to summarize: ' + (summaryResult.error || 'Unknown error'));
        }
      } else {
        alert('Failed to download attachment for summarization');
      }
    } catch (error) {
      console.error('Summarize error:', error);
      alert('Failed to summarize attachment');
    } finally {
      setSummarizing(false);
    }
  };

  return (
    <div className="flex items-center justify-between p-3 bg-white dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="w-10 h-10 rounded bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 flex-shrink-0">
          {getFileIcon(attachment.mimeType)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{attachment.filename}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">{attachment.mimeType} • {formatFileSize(attachment.size)}</p>
          {showSummary && summary && (
            <div className="mt-2 p-2 bg-purple-50 dark:bg-purple-900/20 rounded border border-purple-200 dark:border-purple-800">
              <div className="flex items-center gap-1 mb-1">
                <Sparkles size={12} className="text-purple-600 dark:text-purple-400" />
                <p className="text-xs font-medium text-purple-700 dark:text-purple-300">AI Summary</p>
              </div>
              <p className="text-xs text-gray-700 dark:text-gray-300">{summary}</p>
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {isSummarizable && !showSummary && (
          <button
            onClick={handleSummarize}
            disabled={summarizing || downloading}
            className="p-2 rounded-lg hover:bg-purple-100 dark:hover:bg-purple-900/30 text-purple-600 dark:text-purple-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="Summarize with AI"
          >
            <Sparkles size={16} className={summarizing ? 'animate-spin' : ''} />
          </button>
        )}
        {showSummary && (
          <button
            onClick={() => setShowSummary(false)}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 transition-colors"
            title="Hide summary"
          >
            ×
          </button>
        )}
        <button
          onClick={handleDownload}
          disabled={downloading || summarizing}
          className="p-2 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 text-blue-600 dark:text-blue-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title="Download"
        >
          <Download size={16} className={downloading ? 'animate-bounce' : ''} />
        </button>
      </div>
    </div>
  );
}

// ==================== MISSING ATTACHMENT WARNING ====================

interface MissingAttachmentWarningProps {
  warning?: string | null;
}

function MissingAttachmentWarning({ warning }: MissingAttachmentWarningProps) {
  if (!warning) return null;

  return (
    <div className="mt-4 p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
      <div className="flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">Attachment Mentioned</p>
          <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">{warning}</p>
        </div>
      </div>
    </div>
  );
}

interface EmailViewProps {
  email?: any;
  onReply?: () => void;
  onForward?: () => void;
  onDelete?: () => void;
  onAction?: (id: string, action: string) => void;
  focusedView?: boolean; // If true, only show analysis panel (for split view)
}

type FormalityScore = number; // 0-100, where 0=casual, 50=neutral, 100=formal

export const EmailView: React.FC<EmailViewProps> = ({
  email = null,
  onReply = () => {},
  onForward = () => {},
  onDelete = () => {},
  onAction = () => {},
  focusedView = false,
}) => {
  const { sendEmail, updateEmailStatus, emails, sentEmails, saveEmail, unsaveEmail, isGeneratingSummary, hasSentReply, markAsRead } = useEmailStore();

  // Type definition for email state
  interface EmailState {
    pendingQuestions: any[];
    userAnswers: Record<number, string>;
    formalityScore: number;
    suggestedFormalityScore: number;
    questionsLoaded: boolean;
    summaryComplete: boolean;
    meetingRequest: any;
  }

  // Per-email state map to preserve state when switching between emails
  const emailStateMap = React.useRef(new Map<string, EmailState>());

  const [isEditing, setIsEditing] = React.useState(false);
  const [editedReply, setEditedReply] = React.useState('');
  const [aiEditPrompt, setAiEditPrompt] = React.useState('');
  const [isAiEditing, setIsAiEditing] = React.useState(false);
  const [hasEdited, setHasEdited] = React.useState(false);
  const [localAiReply, setLocalAiReply] = React.useState<string | null>(null); // Local state for immediate display
  const [lastError, setLastError] = React.useState<string>(''); // For debugging

  // Question/answer flow state - store answers as a map of question index -> answer
  const [pendingQuestions, setPendingQuestions] = React.useState<any[]>([]);
  const [userAnswers, setUserAnswers] = React.useState<Record<number, string>>({});
  const [analyzingQuestions, setAnalyzingQuestions] = React.useState(false);
  const [questionsLoaded, setQuestionsLoaded] = React.useState(false); // Track if we've gotten a response from backend
  const [generatingReply, setGeneratingReply] = React.useState(false);
  const [formalityScore, setFormalityScore] = React.useState<FormalityScore>(50); // 0-100
  const [suggestedFormalityScore, setSuggestedFormalityScore] = React.useState<FormalityScore>(50);
  const [summaryComplete, setSummaryComplete] = React.useState(false);

  // Meeting request state
  const [meetingRequest, setMeetingRequest] = React.useState<any>({ is_meeting: false });

  // Attachment warning state
  const [missingAttachmentWarning, setMissingAttachmentWarning] = React.useState<string | null>(null);

  // Unsend state
  const [isSending, setIsSending] = React.useState(false);
  const [sendCountdown, setSendCountdown] = React.useState(5);
  const sendTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const countdownIntervalRef = React.useRef<NodeJS.Timeout | null>(null);

  // Additional context/keyword for reply generation
  const [additionalContext, setAdditionalContext] = React.useState('');

  // Get or create email-specific state
  const getEmailState = (emailId: string) => {
    if (!emailStateMap.current.has(emailId)) {
      emailStateMap.current.set(emailId, {
        pendingQuestions: [],
        userAnswers: {},
        formalityScore: 50,
        suggestedFormalityScore: 50,
        questionsLoaded: false,
        summaryComplete: false,
        meetingRequest: { is_meeting: false },
      });
    }
    return emailStateMap.current.get(emailId)!;
  };

  // Save current state to map for this email
  const saveEmailState = () => {
    if (email?.id) {
      const state = getEmailState(email.id);
      state.pendingQuestions = pendingQuestions;
      state.userAnswers = userAnswers;
      state.formalityScore = formalityScore;
      state.suggestedFormalityScore = suggestedFormalityScore;
      state.questionsLoaded = questionsLoaded;
      state.summaryComplete = summaryComplete;
      state.meetingRequest = meetingRequest;
    }
  };

  // Load state from map for this email
  const loadEmailState = () => {
    if (email?.id && emailStateMap.current.has(email.id)) {
      const state = emailStateMap.current.get(email.id)!;
      setPendingQuestions([...state.pendingQuestions]);
      setUserAnswers({...state.userAnswers});
      setFormalityScore(state.suggestedFormalityScore); // Always start at suggested position
      setSuggestedFormalityScore(state.suggestedFormalityScore);
      setQuestionsLoaded(state.questionsLoaded);
      setSummaryComplete(state.summaryComplete);
      setMeetingRequest(state.meetingRequest || { is_meeting: false });
      return true;
    }
    // Also check for background-generated questions in window global
    if (email?.id) {
      const globalQuestionData = (window as any).emailQuestionData?.get(email.id);
      if (globalQuestionData && globalQuestionData.loaded) {
        console.log('[loadEmailState] Found pre-generated questions in global:', globalQuestionData.questions);
        setPendingQuestions(globalQuestionData.questions);
        // Convert old categorical format to score if needed
        const suggestedScore = typeof globalQuestionData.suggestedFormality === 'number'
          ? globalQuestionData.suggestedFormality
          : globalQuestionData.suggestedFormalityScore || 50;
        setSuggestedFormalityScore(suggestedScore);
        setFormalityScore(suggestedScore);
        setQuestionsLoaded(true);
        setSummaryComplete(true);
        setMeetingRequest(globalQuestionData.meetingRequest || { is_meeting: false });
        return true;
      }
    }
    return false;
  };

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

  // Cleanup timers on unmount
  React.useEffect(() => {
    return () => {
      if (sendTimeoutRef.current) clearTimeout(sendTimeoutRef.current);
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    };
  }, []);

  // Save state before email changes, then load new email's state
  const prevEmailIdRef = React.useRef<string | null>(null);
  const hasMarkedAsReadRef = React.useRef<Set<string>>(new Set());

  React.useEffect(() => {
    const currentEmailId = email?.id || null;

    // Mark email as read when viewed (if setting enabled and not already read)
    if (currentEmailId && !isSentEmail && fullEmail && !fullEmail.is_read) {
      invoke('get_settings').then((settings: any) => {
        if (settings.mark_as_read_on_view !== false && !hasMarkedAsReadRef.current.has(currentEmailId)) {
          markAsRead(currentEmailId);
          hasMarkedAsReadRef.current.add(currentEmailId);
        }
      }).catch(() => {
        // Default to marking as read if settings fail to load
        markAsRead(currentEmailId);
        hasMarkedAsReadRef.current.add(currentEmailId);
      });
    }

    // Save previous email's state before switching
    if (prevEmailIdRef.current && prevEmailIdRef.current !== currentEmailId) {
      // Save previous email state
      const prevState = emailStateMap.current.get(prevEmailIdRef.current);
      if (prevState) {
        prevState.pendingQuestions = pendingQuestions;
        prevState.userAnswers = userAnswers;
        prevState.formalityScore = formalityScore;
        prevState.suggestedFormalityScore = suggestedFormalityScore;
        prevState.questionsLoaded = questionsLoaded;
        prevState.summaryComplete = summaryComplete;
        prevState.meetingRequest = meetingRequest;
      }
    }

    // Reset for null/no email
    if (!currentEmailId || isSentEmail) {
      setEditedReply('');
      setIsEditing(false);
      setAiEditPrompt('');
      setHasEdited(false);
      setLocalAiReply(null);
      setLastError('');
      setPendingQuestions([]);
      setUserAnswers({});
      setFormalityScore(50);
      setSuggestedFormalityScore(50);
      setSummaryComplete(false);
      setQuestionsLoaded(false);
      setMeetingRequest({ is_meeting: false });
    } else if (prevEmailIdRef.current !== currentEmailId) {
      // New email - try to load saved state
      const loaded = loadEmailState();

      // Only initialize defaults if no saved state
      if (!loaded) {
        setPendingQuestions([]);
        setUserAnswers({});
        setFormalityScore(50);
        setSuggestedFormalityScore(50);
        setSummaryComplete(false);
        setQuestionsLoaded(false);
        setMeetingRequest({ is_meeting: false });
      }

      // Set edited reply from new email's AI reply
      if (displayAiReply) {
        setEditedReply(displayAiReply);
        setHasEdited(false);
      }
    }

    prevEmailIdRef.current = currentEmailId;
  }, [email?.id, isSentEmail, displayAiReply]);

  // When summary completes and we have no aiReply, load or generate questions
  useEffect(() => {
    if (summary && !displayAiReply && !isSentEmail && !hasSent && email?.id && !questionsLoaded) {
      const state = getEmailState(email.id);
      const globalQuestionData = (window as any).emailQuestionData?.get(email.id);

      // Check if we have pre-generated questions from background or already loaded in state
      if ((globalQuestionData && globalQuestionData.loaded) || (state.questionsLoaded && state.pendingQuestions)) {
        const dataSource = globalQuestionData?.loaded ? globalQuestionData : state;
        console.log('[useEffect] Loading saved/pre-generated questions:', dataSource.pendingQuestions);
        setPendingQuestions(dataSource.pendingQuestions || []);
        setUserAnswers(dataSource.userAnswers || {});
        setSuggestedFormalityScore(dataSource.suggestedFormalityScore || 50);
        setFormalityScore(dataSource.formalityScore || 50);
        setMeetingRequest(dataSource.meetingRequest || { is_meeting: false });
        setQuestionsLoaded(true);
        setSummaryComplete(dataSource.summaryComplete || true);
        // Update state if loading from global
        if (globalQuestionData?.loaded) {
          state.pendingQuestions = globalQuestionData.questions;
          state.suggestedFormalityScore = globalQuestionData.suggestedFormalityScore;
          state.formalityScore = globalQuestionData.formalityScore;
          state.questionsLoaded = true;
          state.summaryComplete = true;
          state.meetingRequest = globalQuestionData.meetingRequest || { is_meeting: false };
        }
      } else {
        // No pre-generated questions, trigger analysis
        console.log('[useEffect] No saved questions, triggering analysis');
        analyzeEmailForQuestions();
      }
    }
  }, [summary, displayAiReply, isSentEmail, hasSent, email?.id]);

  const handleAiEdit = async () => {
    if (!aiEditPrompt.trim() || !editedReply) return;

    setIsAiEditing(true);
    try {
      const baseURL = await serverURL();
      const response = await fetchWithTimeout(`${baseURL}/edit-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_reply: editedReply,
          edit_prompt: aiEditPrompt,
        }),
      }, 60000);

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

  // Analyze email to extract questions and detect suggested formality
  const analyzeEmailForQuestions = async () => {
    if (!fullEmail) return;

    // First check if questions were already generated in the background
    const globalQuestionData = (window as any).emailQuestionData?.get(email.id);
    if (globalQuestionData && globalQuestionData.loaded) {
      console.log('[analyzeEmail] Using pre-generated questions from background:', globalQuestionData.questions);
      setPendingQuestions(globalQuestionData.questions);
      // Convert old categorical format to score if needed
      const suggestedScore = typeof globalQuestionData.suggestedFormality === 'number'
        ? globalQuestionData.suggestedFormality
        : globalQuestionData.suggestedFormalityScore || 50;
      setSuggestedFormalityScore(suggestedScore);
      setFormalityScore(suggestedScore);
      setQuestionsLoaded(true);
      setAnalyzingQuestions(false);
      // Set meeting request
      if (globalQuestionData.meetingRequest) {
        setMeetingRequest(globalQuestionData.meetingRequest);
      }
      // Set missing attachment warning
      setMissingAttachmentWarning(globalQuestionData.missingAttachmentWarning || null);
      // Save to email state map
      if (email?.id) {
        const state = getEmailState(email.id);
        state.pendingQuestions = globalQuestionData.questions;
        state.suggestedFormalityScore = suggestedScore;
        state.formalityScore = suggestedScore;
        state.questionsLoaded = true;
      }
      return;
    }

    // No pre-generated questions, need to call API
    setAnalyzingQuestions(true);
    setQuestionsLoaded(false);

    try {
      const bodyText = fullEmail.snippet || fullEmail.body_text || email.content || '';

      console.log('[analyzeEmail] Sending for analysis:', {
        sender: fullEmail.sender,
        subject: email.subject,
        body_length: bodyText.length,
      });

      const baseURL = await serverURL();
      const response = await fetchWithTimeout(`${baseURL}/analyze-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender: fullEmail.sender,
          subject: email.subject,
          body_text: bodyText,
          has_attachments: email.hasAttachments || fullEmail?.has_attachments || false,
        }),
      }, 60000); // 60 second timeout

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const result = await response.json();
      console.log('[analyzeEmail] Backend response:', result);

      if (result.success && result.questions && result.questions.length > 0) {
        console.log('[analyzeEmail] Found questions:', result.questions);
        setPendingQuestions(result.questions);
        // Save questions to state map
        if (email?.id) {
          const state = getEmailState(email.id);
          state.pendingQuestions = result.questions;
        }
      } else {
        console.log('[analyzeEmail] No questions found');
        setPendingQuestions([]);
        // Save empty questions to state map
        if (email?.id) {
          const state = getEmailState(email.id);
          state.pendingQuestions = [];
        }
      }

      // Set suggested formality score - handle both old categorical and new score format
      let suggestedScore = 50; // default neutral
      if (result.suggested_formality_score !== undefined) {
        // New format: direct score
        suggestedScore = result.suggested_formality_score;
      } else if (result.suggested_formality) {
        // Old format: categorical - convert to score
        const categorical = result.suggested_formality;
        if (categorical === 'casual') suggestedScore = 20;
        else if (categorical === 'formal') suggestedScore = 80;
        else suggestedScore = 50; // neutral
      }
      setSuggestedFormalityScore(suggestedScore);
      setFormalityScore(suggestedScore);
      // Save formality to state map
      if (email?.id) {
        const state = getEmailState(email.id);
        state.suggestedFormalityScore = suggestedScore;
        state.formalityScore = suggestedScore;
      }

      // Set meeting request from API response
      if (result.meeting_request) {
        setMeetingRequest(result.meeting_request);
      }

      // Set missing attachment warning from API response
      if (result.missing_attachment_warning) {
        setMissingAttachmentWarning(result.missing_attachment_warning);
      } else {
        setMissingAttachmentWarning(null);
      }

      // Mark that we've successfully loaded questions (even if empty)
      setQuestionsLoaded(true);
      if (email?.id) {
        const state = getEmailState(email.id);
        state.questionsLoaded = true;
        state.meetingRequest = result.meeting_request || { is_meeting: false };
      }
    } catch (error) {
      console.error('[analyzeEmail] Failed to analyze email:', error);
      setPendingQuestions([]);
      setQuestionsLoaded(true); // Mark as loaded so we show the "no questions" message
      setLastError('Analysis failed: ' + String(error));
    } finally {
      setAnalyzingQuestions(false);
    }
  };

  // Handle user answering a specific question
  const handleAnswer = (questionIndex: number, answer: string) => {
    console.log(`[handleAnswer] Question ${questionIndex} answered:`, answer);
    setUserAnswers(prev => {
      const newAnswers = { ...prev, [questionIndex]: answer };
      // Save state to map after answering
      if (email?.id) {
        const state = getEmailState(email.id);
        state.userAnswers = newAnswers;
      }
      return newAnswers;
    });
  };

  // Generate reply with user's answers and formality score
  const generateReply = async () => {
    if (!fullEmail) return;

    // Convert score (0-100) to categorical for backend API
    let formalityLevel: 'casual' | 'neutral' | 'formal';
    if (formalityScore < 40) {
      formalityLevel = 'casual';
    } else if (formalityScore < 70) {
      formalityLevel = 'neutral';
    } else {
      formalityLevel = 'formal';
    }

    console.log('[generateReply] Starting generation with formality score:', formalityScore, '->', formalityLevel);
    setGeneratingReply(true);
    setLastError('');

    // Convert answers map to array format
    const answersArray = pendingQuestions.map((q, idx) => ({
      question: q.question,
      answer: userAnswers[idx] || ''
    }));

    const requestBody = {
      sender: fullEmail.sender,
      subject: email.subject,
      body_text: fullEmail.body_text || fullEmail.snippet || email.content || '',
      user_answers: answersArray,
      formality_level: formalityLevel,
      additional_context: additionalContext || undefined,
    };

    console.log('[generateReply] Request body:', JSON.stringify(requestBody, null, 2));

    try {
      console.log('[generateReply] Sending request to backend...');
      const baseURL = await serverURL();
      const response = await fetchWithTimeout(`${baseURL}/generate-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      }, 60000);

      console.log('[generateReply] Got response, status:', response.status);

      // Get raw text first to see what we're getting
      const rawText = await response.text();
      console.log('[generateReply] Raw response:', rawText.substring(0, 500));

      let result;
      try {
        result = JSON.parse(rawText);
      } catch (e) {
        console.error('[generateReply] Failed to parse JSON:', e);
        setLastError('Invalid JSON response: ' + rawText.substring(0, 200));
        setGeneratingReply(false);
        return;
      }

      console.log('[generateReply] Parsed result:', result);
      console.log('[generateReply] result.success:', result.success, 'result.reply:', result.reply);

      if (result.success && result.reply) {
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
        const errorMsg = result.error || 'Unknown error - no reply in response';
        setLastError('Error: ' + errorMsg);
        alert('Failed to generate reply. Please try again.\n\nError: ' + errorMsg);
      }
    } catch (error) {
      console.error('[generateReply] Failed to generate reply:', error);
      const errorMsg = String(error);
      setLastError('Network error: ' + errorMsg);

      // More helpful error message for common issues
      if (errorMsg.includes('Load failed') || errorMsg.includes('Failed to fetch') || errorMsg.includes('NetworkError')) {
        alert('Cannot connect to Aiden\'s backend server.\n\nPlease make sure the app is properly built and restart it.\n\nIf this persists, please run "npm run tauri dev" instead.');
      } else {
        alert('Failed to generate reply. Please check your connection.\n\nError: ' + errorMsg);
      }
    } finally {
      console.log('[generateReply] Done, generatingReply = false');
      setGeneratingReply(false);
    }
  };

  const handleSendReply = async () => {
    if (!email || !editedReply) return;

    // Start the sending countdown
    setIsSending(true);
    setSendCountdown(5);

    // Start countdown
    countdownIntervalRef.current = setInterval(() => {
      setSendCountdown(prev => {
        if (prev <= 1) {
          clearInterval(countdownIntervalRef.current!);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    // Set timeout to actually send after 5 seconds
    sendTimeoutRef.current = setTimeout(async () => {
      clearInterval(countdownIntervalRef.current!);
      setIsSending(false);
      setSendCountdown(5);

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
      } catch (error) {
        console.error('Failed to send reply:', error);
        alert('Failed to send reply');
      }
    }, 5000);
  };

  const handleUnsend = () => {
    // Clear the timeout and interval
    if (sendTimeoutRef.current) {
      clearTimeout(sendTimeoutRef.current);
      sendTimeoutRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setIsSending(false);
    setSendCountdown(5);
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
    <div className={`flex flex-col bg-white dark:bg-gray-900 h-full overflow-hidden ${focusedView ? 'flex-1' : 'flex-1'}`}>
      {/* Action Bar - scrollable when content is long, max 50% height in normal view, full height in focused view */}
      <div className={`${isSentEmail ? 'px-4 pb-4' : focusedView ? 'p-4' : 'border-b border-gray-200 dark:border-gray-700 p-4'} overflow-y-auto ${focusedView ? 'flex-1' : 'max-h-[50%]'} min-h-0 flex-shrink-0`}>

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

        {/* Meeting Suggestions - show when a meeting request is detected */}
        {!analyzingQuestions && questionsLoaded && meetingRequest?.is_meeting && (
          <>
            {console.log('[EmailView] Showing meeting suggestions', meetingRequest)}
            <MeetingSuggestions
              meetingRequest={meetingRequest}
              emailSubject={email.subject}
              senderEmail={fullEmail?.sender || email.sender || ''}
              onCreated={() => {
                // Optionally refresh the calendar or show a confirmation
              }}
            />
          </>
        )}
        {!analyzingQuestions && questionsLoaded && !meetingRequest?.is_meeting && console.log('[EmailView] Meeting NOT detected, meetingRequest:', meetingRequest)}

        {/* Missing Attachment Warning */}
        {!analyzingQuestions && questionsLoaded && (
          <MissingAttachmentWarning warning={missingAttachmentWarning} />
        )}

        {/* Questions Section - only show after analysis is complete and no ai reply yet */}
        {!analyzingQuestions && questionsLoaded && !displayAiReply && summary && (
          <div className="mt-4 space-y-4" data-reply-section>
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

            {/* Additional Context Input - Optional keywords/instructions for AI */}
            <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
                Additional context <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={additionalContext}
                onChange={(e) => setAdditionalContext(e.target.value)}
                placeholder="e.g., 'mention I'll be out of office next week', 'ask about the project timeline'..."
                className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 rounded-lg border border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-400 dark:placeholder-gray-500"
              />
            </div>

            {/* Formality Score Selector - Continuous Slider */}
            <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Tone
                </p>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {formalityScore < 40 ? 'Casual' : formalityScore < 70 ? 'Neutral' : 'Formal'}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-500 dark:text-gray-400">Casual</span>
                <div className="relative flex-1">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={formalityScore}
                    onChange={(e) => {
                      const newScore = parseInt(e.target.value);
                      setFormalityScore(newScore);
                      if (email?.id) {
                        const state = getEmailState(email.id);
                        state.formalityScore = newScore;
                      }
                    }}
                    className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                  />
                  {/* Suggested position - arrow below */}
                  <div className="absolute -bottom-5 flex flex-col items-center pointer-events-none -translate-x-1/2" style={{ left: `${suggestedFormalityScore}%` }}>
                    <svg className="w-3 h-3 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" />
                    </svg>
                    <span className="text-[9px] text-gray-500 dark:text-gray-400 font-medium -mt-1">
                      Suggested
                    </span>
                  </div>
                </div>
                <span className="text-xs text-gray-500 dark:text-gray-400">Formal</span>
              </div>
              {/* Extra padding for suggestion label */}
              <div className="h-4" />
            </div>

            {/* Generate Button - more subtle, hide when generating */}
            {!generatingReply && (
              <Button
                onClick={generateReply}
                variant="outline"
                className="w-full text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 py-2 text-sm"
              >
                Generate Reply
              </Button>
            )}
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
                <div className={`mb-3 pb-3 border-b ${hasSent ? 'border-green-200 dark:border-green-700' : 'border-blue-200 dark:border-blue-700'}`}>
                  <p className="text-sm text-gray-700 dark:text-gray-300">
                    <span className={`text-sm ${hasSent ? 'text-green-600 dark:text-green-400' : 'text-blue-600 dark:text-blue-400'}`}>Subject: </span>
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
                  {isSending ? (
                    <>
                      {/* Countdown indicator */}
                      <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
                        <span className="text-sm font-medium">Sending in {sendCountdown}s...</span>
                      </div>
                      {/* Unsend button */}
                      <Button size="sm" variant="outline" onClick={handleUnsend} className="border-red-300 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20">
                        Unsend
                      </Button>
                    </>
                  ) : (
                    <>
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
                    </>
                  )}
                </div>
              )}
            </div>

            {/* AI Edit Section - only show if not sent and not sending */}
            {isEditing && !hasSent && !isSending && (
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

      {/* Email Content - only show in normal view, not in focused view */}
      {!focusedView && (
      <div className="flex-1 p-6 overflow-y-auto min-h-0">
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

              <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:text-foreground prose-p:text-foreground prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-strong:text-foreground">
                {email.bodyHtml || email.body_html ? (
                  <EmailHtmlContent html={email.bodyHtml || email.body_html} />
                ) : (
                  <div className="whitespace-pre-wrap text-foreground">
                    {decodeHTMLEntities(email.content?.startsWith(email.subject)
                      ? email.content.substring(email.subject.length).trim()
                      : email.content)}
                  </div>
                )}
              </div>

              {email.hasAttachments && email.attachments && email.attachments.length > 0 && (
                <div className="mt-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                  <h3 className="text-sm font-semibold text-foreground mb-3">Attachments ({email.attachments.length})</h3>
                  <div className="space-y-2">
                    {email.attachments.map((att: any, index: number) => (
                      <AttachmentItem
                        key={index}
                        attachment={att}
                        messageId={email.id}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      )}
    </div>
  );
};
