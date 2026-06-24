import React, { useMemo, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useEmailStore, fetchWithTimeout, type EmailAttachment } from '@/stores/emailStore';
import { Button } from '@/components/ui/Button';
import { MeetingSuggestions } from '@/components/ui/MeetingSuggestions';
import { AttachmentSuggestions } from '@/components/ui/AttachmentSuggestions';
import { ReminderSuggestion } from '@/components/ui/ReminderSuggestion';
import { Bookmark, File, Image, FileText, Archive, Music, Video, Download, AlertCircle, Sparkles, Eye, X, Clock, ChevronUp, ChevronDown, MessageSquare, Paperclip } from 'lucide-react';
import DOMPurify from 'dompurify';
import { serverURL, downloadAttachment, saveAttachmentToFile } from '@/api/emails';
import { analyzeEmail, generateReply as claudeGenerateReply, editReply, analyzeAttachment, type AnalyzeEmailRequest, type GenerateReplyRequest, getConversationContext, getRecipientWritingStyle, analyzeAndSaveWritingStyle, type ConversationContext, type RecipientWritingStyle } from '@/api/claude';
import { useAuthStore } from '@/stores/authStore';

// Helper to decode HTML entities
function decodeHTMLEntities(text: string): string {
  if (!text) return text;
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  return textarea.value;
}

// Helper to get file icon based on mime type
export function getFileIcon(mimeType: string): React.ReactNode {
  const type = mimeType.toLowerCase();
  if (type.startsWith('image/')) return <Image size={20} />;
  if (type.startsWith('video/')) return <Video size={20} />;
  if (type.startsWith('audio/')) return <Music size={20} />;
  if (type.includes('pdf')) return <FileText size={20} />;
  if (type.includes('zip') || type.includes('rar') || type.includes('tar') || type.includes('gzip')) return <Archive size={20} />;
  return <File size={20} />;
}

// Helper to format file size
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

// Configure DOMPurify hooks once at module level
// This prevents accumulating duplicate hooks on every render
let purifyHooksConfigured = false;
function configureDOMPurifyHooks() {
  if (purifyHooksConfigured) return;
  purifyHooksConfigured = true;

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
}

// Component to render email HTML content properly
// Uses Shadow DOM to fully encapsulate email styles and prevent CSS leakage
export function EmailHtmlContent({ html }: { html: string }) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const shadowRootRef = React.useRef<ShadowRoot | null>(null);

  const processedHtml = React.useMemo(() => {
    if (!html) return '';

    // Configure hooks once (first time we render an email)
    configureDOMPurifyHooks();

    let cleanHtml = html;

    // If the HTML contains a full document, extract just the body content
    if (cleanHtml.includes('<html') || cleanHtml.includes('<body')) {
      const bodyMatch = cleanHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      if (bodyMatch) {
        cleanHtml = bodyMatch[1];
      } else {
        const headEndMatch = cleanHtml.match(/<\/head[^>]*>([\s\S]*?)$/i);
        if (headEndMatch) {
          cleanHtml = headEndMatch[1];
        }
      }
    }

    // Remove link tags that load external stylesheets (tracking/resource concern)
    cleanHtml = cleanHtml.replace(/<link[^>]*rel=['"]?stylesheet['"]?[^>]*>/gi, '');

    const sanitized = DOMPurify.sanitize(cleanHtml, {
      ALLOWED_TAGS: [
        // Basic HTML
        'p', 'br', 'strong', 'em', 'u', 's', 'a', 'ul', 'ol', 'li',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'code', 'pre',
        'div', 'span', 'img', 'hr', 'sup', 'sub', 'b', 'i', 'small', 'big',
        // Tables
        'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'col', 'colgroup',
        // Forms (sometimes in emails)
        'form', 'input', 'button', 'label', 'select', 'option', 'textarea',
        // Email elements - style tags are safe inside Shadow DOM
        'style', 'font', 'center', 'map', 'area', 'section', 'article', 'aside',
        'nav', 'main', 'header', 'footer', 'figure', 'figcaption', 'details', 'summary'
      ],
      ALLOWED_ATTR: [
        // Standard attributes
        'href', 'src', 'alt', 'title', 'class', 'style', 'width', 'height', 'target', 'rel',
        'id', 'name', 'type', 'value', 'placeholder', 'for', 'label',
        // Email/table attributes
        'bgcolor', 'background', 'cellpadding', 'cellspacing', 'valign', 'align',
        'border', 'colspan', 'rowspan', 'nowrap',
        'marginwidth', 'marginheight', 'hspace', 'vspace',
        // Image attributes
        'usemap', 'ismap', 'longdesc',
        // Link attributes
        'charset', 'hreflang', 'media', 'sizes', 'rev',
        // Data attributes
        /^data-.*$/
      ],
      ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
      ALLOW_UNKNOWN_PROTOCOLS: false,
      KEEP_CONTENT: true,
      WHOLE_DOCUMENT: false,
      RETURN_DOM_FRAGMENT: false,
      FORCE_BODY: false
    });

    return sanitized;
  }, [html]);

  // Render sanitized HTML inside Shadow DOM for full style encapsulation
  React.useEffect(() => {
    if (!containerRef.current) return;

    // Attach shadow root once
    if (!shadowRootRef.current) {
      shadowRootRef.current = containerRef.current.attachShadow({ mode: 'open' });
    }

    // Base styles inside shadow DOM - these won't leak out
    shadowRootRef.current.innerHTML = `
      <style>
        :host {
          display: block;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          font-size: 14px;
          line-height: 1.5;
          color: inherit;
          word-wrap: break-word;
          overflow-wrap: break-word;
        }
        img { max-width: 100%; height: auto; }
        a { color: #3b82f6; text-decoration: underline; }
        a:hover { color: #2563eb; }
        table { max-width: 100%; border-collapse: collapse; }
        pre { white-space: pre-wrap; overflow-x: auto; }
        blockquote { border-left: 3px solid #d1d5db; margin: 0.5em 0; padding-left: 1em; color: #6b7280; }
      </style>
      ${processedHtml}
    `;
  }, [processedHtml]);

  return (
    <div
      ref={containerRef}
      className="email-html-content"
      style={{
        width: '100%',
        overflow: 'auto',
        maxWidth: '100%',
      }}
    />
  );
}

// ==================== ATTACHMENT COMPONENT ====================

interface AttachmentItemProps {
  attachment: EmailAttachment;
  messageId: string;
  // Email context for better attachment analysis
  emailSubject?: string;
  emailSender?: string;
  emailBody?: string;
  emailSummary?: string;
}

export function AttachmentItem({
  attachment,
  messageId,
  emailSubject,
  emailSender,
  emailBody,
  emailSummary
}: AttachmentItemProps) {
  const [downloading, setDownloading] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [showSummary, setShowSummary] = useState(!!attachment.aiSummary); // Show summary if already saved
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const updateAttachmentAnalysis = useEmailStore(state => state.updateAttachmentAnalysis);

  // All attachment types can now be analyzed with Claude (including images)
  const isSummarizable = true;

  // Load saved analysis when attachment changes
  useEffect(() => {
    if (attachment.aiSummary) {
      // Build summary from saved data
      let summaryText = attachment.aiSummary;
      if (attachment.aiKeyPoints && attachment.aiKeyPoints.length > 0) {
        summaryText += '\n\nKey Points:\n' + attachment.aiKeyPoints.map((p, i) => `${i + 1}. ${p}`).join('\n');
      }
      if (attachment.aiActionItems && attachment.aiActionItems.length > 0) {
        summaryText += '\n\nAction Items:\n' + attachment.aiActionItems.map((a, i) => `${i + 1}. ${a}`).join('\n');
      }
      setSummary(summaryText);
      setShowSummary(true);
    } else {
      setSummary(null);
      setShowSummary(false);
    }
  }, [attachment.id, attachment.aiSummary, attachment.aiKeyPoints, attachment.aiActionItems]);

  const isPreviewable = attachment.mimeType === 'application/pdf' ||
    attachment.mimeType.startsWith('image/') ||
    attachment.mimeType.includes('text');

  const handleDownload = async () => {
    setDownloading(true);
    try {
      let data: string | undefined;
      if (attachment.base64Data) {
        data = attachment.base64Data;
      } else {
        const result = await downloadAttachment(messageId, attachment.id);
        if (result.success && result.data) {
          data = result.data;
        } else {
          alert('Failed to download: ' + (result.error || 'Unknown error'));
          return;
        }
      }
      await saveAttachmentToFile(attachment.filename, data);
    } catch (error) {
      console.error('Download error:', error);
      alert('Failed to download attachment');
    } finally {
      setDownloading(false);
    }
  };

  const handlePreview = async () => {
    setPreviewLoading(true);
    try {
      let data: string | undefined;

      if (attachment.base64Data) {
        data = attachment.base64Data;
      } else {
        console.log('[Attachment Preview] Fetching attachment:', attachment.id, 'from message:', messageId);
        const result = await downloadAttachment(messageId, attachment.id);
        console.log('[Attachment Preview] Download result:', result);
        if (result.success && result.data) {
          data = result.data;
        } else {
          console.error('[Attachment Preview] Download failed:', result);
          alert('Failed to load preview: ' + (result.error || 'Unknown error'));
          setPreviewLoading(false);
          return;
        }
      }

      // Convert base64 to bytes and save to downloads
      try {
        const { invoke } = await import('@tauri-apps/api/core');

        // Convert base64 to bytes
        const binaryString = atob(data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        // Save to downloads folder
        const downloadsPath = await invoke<string>('get_downloads_path', {});
        const filePath = `${downloadsPath}/${attachment.filename}`;

        await invoke('write_file', {
          path: filePath,
          contents: Array.from(bytes)
        });

        console.log('[Attachment Preview] Saved to:', filePath);

        // Open the file with the default application
        await invoke('open_file', { path: filePath });

        console.log('[Attachment Preview] Opened file');
      } catch (tauriError) {
        console.error('[Attachment Preview] Tauri method failed:', tauriError);
        alert('Preview saved to Downloads folder. Please open it manually.');
      }
      setPreviewLoading(false);
    } catch (error) {
      console.error('[Attachment Preview] Error:', error);
      alert('Failed to preview attachment: ' + String(error));
      setPreviewLoading(false);
    }
  };

  const handleSummarize = async () => {
    setSummarizing(true);
    try {
      let attachmentData: string | undefined;

      // Use stored base64 data if available (sent email attachments), otherwise download from Gmail
      if (attachment.base64Data) {
        attachmentData = attachment.base64Data;
      } else {
        const result = await downloadAttachment(messageId, attachment.id);
        if (result.success && result.data) {
          attachmentData = result.data;
        } else {
          alert('Failed to download attachment for analysis: ' + (result.error || 'Unknown error'));
          return;
        }
      }

      // Use Claude API for analysis (supports images and documents)
      const analysisResult = await analyzeAttachment({
        filename: attachment.filename,
        attachment_data: attachmentData,
        mime_type: attachment.mimeType,
        email_subject: emailSubject,
        email_sender: emailSender,
        email_body: emailBody,
        email_summary: emailSummary,
      });

      // Build a comprehensive summary from the analysis
      let summaryText = analysisResult.summary;

      if (analysisResult.key_points && analysisResult.key_points.length > 0) {
        summaryText += '\n\nKey Points:\n' + analysisResult.key_points.map((p, i) => `${i + 1}. ${p}`).join('\n');
      }

      if (analysisResult.action_items && analysisResult.action_items.length > 0) {
        summaryText += '\n\nAction Items:\n' + analysisResult.action_items.map((a, i) => `${i + 1}. ${a}`).join('\n');
      }

      setSummary(summaryText);
      setShowSummary(true);

      // Save the analysis to the email store
      updateAttachmentAnalysis(messageId, attachment.id, {
        summary: analysisResult.summary,
        key_points: analysisResult.key_points,
        action_items: analysisResult.action_items,
      });
    } catch (error) {
      console.error('Analysis error:', error);
      alert('Failed to analyze attachment: ' + String(error));
    } finally {
      setSummarizing(false);
    }
  };

  // Cleanup preview URL when component unmounts
  React.useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

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
        {isPreviewable && (
          <button
            onClick={handlePreview}
            disabled={previewLoading || downloading || summarizing}
            className="p-2 rounded-lg hover:bg-green-100 dark:hover:bg-green-900/30 text-green-600 dark:text-green-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="Preview (opens in new tab)"
          >
            <Eye size={16} className={previewLoading ? 'animate-pulse' : ''} />
          </button>
        )}
        {isSummarizable && !showSummary && (
          <button
            onClick={handleSummarize}
            disabled={summarizing || downloading || previewLoading}
            className="p-2 rounded-lg hover:bg-purple-100 dark:hover:bg-purple-900/30 text-purple-600 dark:text-purple-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="Analyze with AI (Claude)"
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
          disabled={downloading || summarizing || previewLoading}
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
  onEmailSelect?: (emailId: string) => void;
  focusedView?: boolean; // If true, only show analysis panel (for split view)
  animationPhase?: 'idle' | 'slideLeft' | 'expand'; // Animation phase for focused view transition
  showResponseOptions?: boolean; // Whether to show response options/questions
  onShowResponseOptionsChange?: (value: boolean) => void; // Callback when respond button is clicked
  hideThreadNavigation?: boolean; // If true, hide the thread navigation box
}

type FormalityScore = number; // 0-100, where 0=casual, 50=neutral, 100=formal

export const EmailView: React.FC<EmailViewProps> = ({
  email = null,
  onReply = () => {},
  onForward = () => {},
  onDelete = () => {},
  onAction = () => {},
  onEmailSelect,
  focusedView = false,
  animationPhase = 'idle',
  showResponseOptions = false,
  onShowResponseOptionsChange,
  hideThreadNavigation = false,
}) => {
  const { sendEmail, updateEmailStatus, emails, sentEmails, saveEmail, unsaveEmail, isGeneratingSummary, hasSentReply, markAsRead, getThreadEmails, getThreadPosition, selectEmail, selectedEmail: storeSelectedEmail } = useEmailStore();
  const { user } = useAuthStore();
  const userName = user?.name || 'Your Name';

  // Type definition for email state
  interface EmailState {
    pendingQuestions: any[];
    userAnswers: Record<number, string>;
    formalityScore: number;
    suggestedFormalityScore: number;
    questionsLoaded: boolean;
    summaryComplete: boolean;
    meetingRequest: any;
    attachmentRequests: any[];
    isEditing: boolean;
    editedReply: string;
    hasEdited: boolean;
  }

  // Per-email state map to preserve state when switching between emails
  const emailStateMap = React.useRef(new Map<string, EmailState>());

  const [currentEmailId, setCurrentEmailId] = React.useState<string | null>(null); // Track current email for local reply
  const [isEditing, setIsEditing] = React.useState(false);
  const [editedReply, setEditedReply] = React.useState('');
  const [aiEditPrompt, setAiEditPrompt] = React.useState('');
  const [isAiEditing, setIsAiEditing] = React.useState(false);
  const [hasEdited, setHasEdited] = React.useState(false);
  const [localAiReply, setLocalAiReply] = React.useState<string | null>(null); // Local state for immediate display
  const [lastError, setLastError] = React.useState<string>(''); // For debugging

  // Question/answer flow state - store answers as a map of question index -> answer
  const [pendingQuestions, setPendingQuestions] = React.useState<any[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = React.useState(0); // Track which question is currently displayed
  const [userAnswers, setUserAnswers] = React.useState<Record<number, string>>({});
  const [analyzingQuestions, setAnalyzingQuestions] = React.useState(false);
  const [questionsLoaded, setQuestionsLoaded] = React.useState(false); // Track if we've gotten a response from backend
  const [generatingReply, setGeneratingReply] = React.useState(false);
  const [formalityScore, setFormalityScore] = React.useState<FormalityScore>(50); // 0-100
  const [suggestedFormalityScore, setSuggestedFormalityScore] = React.useState<FormalityScore>(50);
  const [summaryComplete, setSummaryComplete] = React.useState(false);

  // Meeting request state
  const [meetingRequest, setMeetingRequest] = React.useState<any>({ is_meeting: false });
  const [selectedMeetingTime, setSelectedMeetingTime] = React.useState<any>(null); // { date, time, start, end, dayName }
  const [userTimezone, setUserTimezone] = React.useState<string>('America/New_York');
  // Event calendar state (for event_type === "event")
  const [eventCalendarStatus, setEventCalendarStatus] = React.useState<'idle' | 'adding' | 'added' | 'dismissed'>('idle');

  // Attachment suggestions state
  const [attachmentRequests, setAttachmentRequests] = React.useState<any[]>([]);
  const [selectedAttachments, setSelectedAttachments] = React.useState<Array<{ path: string; base64: string; name: string }>>([]);

  // Load user timezone from settings
  React.useEffect(() => {
    invoke('get_settings').then((settings: any) => {
      if (settings?.timezone) {
        setUserTimezone(settings.timezone);
      }
    }).catch(() => {
      // Use default timezone
    });
  }, []);

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
        attachmentRequests: [],
        isEditing: false,
        editedReply: '',
        hasEdited: false,
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
      state.attachmentRequests = attachmentRequests;
      state.isEditing = isEditing;
      state.editedReply = editedReply;
      state.hasEdited = hasEdited;
    }
  };

  // Load state from map for this email
  const loadEmailState = () => {
    if (email?.id && emailStateMap.current.has(email.id)) {
      const state = emailStateMap.current.get(email.id)!;
      setPendingQuestions([...state.pendingQuestions]);
      setCurrentQuestionIndex(0); // Reset to first question when loading new questions
      setUserAnswers({...state.userAnswers});
      setFormalityScore(state.suggestedFormalityScore); // Always start at suggested position
      setSuggestedFormalityScore(state.suggestedFormalityScore);
      setQuestionsLoaded(state.questionsLoaded);
      setSummaryComplete(state.summaryComplete);
      setMeetingRequest(state.meetingRequest || { is_meeting: false });
      setAttachmentRequests(state.attachmentRequests || []);
      setIsEditing(state.isEditing || false);
      setEditedReply(state.editedReply || '');
      setHasEdited(state.hasEdited || false);
      return true;
    }
    // Also check for background-generated questions in window global
    if (email?.id) {
      const globalQuestionData = (window as any).emailQuestionData?.get(email.id);
      if (globalQuestionData && globalQuestionData.loaded) {
        console.log('[loadEmailState] Found pre-generated questions in global:', globalQuestionData.questions);
        setPendingQuestions(globalQuestionData.questions);
        setUserAnswers({}); // Clear answers when loading new questions
        // Convert old categorical format to score if needed
        const suggestedScore = typeof globalQuestionData.suggestedFormality === 'number'
          ? globalQuestionData.suggestedFormality
          : globalQuestionData.suggestedFormalityScore || 50;
        setSuggestedFormalityScore(suggestedScore);
        setFormalityScore(suggestedScore);
        setQuestionsLoaded(true);
        setSummaryComplete(true);
        setMeetingRequest(globalQuestionData.meetingRequest || { is_meeting: false });
        const attachmentReqs = globalQuestionData.attachment_requests || globalQuestionData.attachmentRequests || [];
        console.log('[loadEmailState] Loading attachment requests:', attachmentReqs);
        setAttachmentRequests(attachmentReqs);
        setIsEditing(false);
        setHasEdited(false);
        setEditedReply('');
        return true;
      }
    }
    return false;
  };

  // Check if this is a sent email
  const sentEmail = email ? sentEmails.find(e => e.id === email.id) : null;
  const isSentEmail = !!sentEmail;

  // Get the full email data from store - check both emails and sentEmails arrays
  const fullEmail = useMemo(() => {
    if (!email) return null;
    // First check if it's a sent email
    if (sentEmail) return sentEmail;
    // Otherwise check regular emails
    return emails.find(e => e.id === email.id) || null;
  }, [email?.id, emails, sentEmail]);

  // For sent emails, get the original email that was replied to
  const originalEmail = sentEmail?.originalEmail || (sentEmail?.inReplyTo ? emails.find(e => e.id === sentEmail.inReplyTo) : null);

  // Get summary from store (only for regular emails, not sent emails)
  const summary = !isSentEmail ? (fullEmail?.summary || '') : '';
  const keyPoints = !isSentEmail ? (fullEmail?.key_points || []) : [];
  const actionItems = !isSentEmail ? (fullEmail?.action_items || []) : [];

  // Get AI reply from store
  // For sent emails, the reply is the body of the sent email
  const aiReply = isSentEmail ? (sentEmail?.body || sentEmail?.ai_generated_reply || null) : (fullEmail?.ai_generated_reply || null);

  // Use local AI reply ONLY if it's from the current email, otherwise use store
  const displayAiReply = (currentEmailId === email?.id ? localAiReply : null) || aiReply;

  // Check if summary is being generated
  const isSummaryGenerating = email?.id ? isGeneratingSummary(email.id) : false;

  // Check if we've already sent a reply to this email
  const hasSent = email?.id ? hasSentReply(email.id) : false;

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
    const newEmailId = email?.id || null;

    // Mark email as read when viewed (if setting enabled and not already read)
    if (newEmailId && !isSentEmail && fullEmail && !fullEmail.is_read) {
      invoke('get_settings').then((settings: any) => {
        if (settings.mark_as_read_on_view !== false && !hasMarkedAsReadRef.current.has(newEmailId)) {
          markAsRead(newEmailId);
          hasMarkedAsReadRef.current.add(newEmailId);
        }
      }).catch(() => {
        // Default to marking as read if settings fail to load
        markAsRead(newEmailId);
        hasMarkedAsReadRef.current.add(newEmailId);
      });
    }

    // Save previous email's state before switching
    if (prevEmailIdRef.current && prevEmailIdRef.current !== newEmailId) {
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
        prevState.isEditing = isEditing;
        prevState.editedReply = editedReply;
        prevState.hasEdited = hasEdited;
      }
      // Clear local reply when switching emails
      setLocalAiReply(null);
      setCurrentEmailId(null);
    }

    // Reset for null/no email
    if (!newEmailId || isSentEmail) {
      setEditedReply('');
      setIsEditing(false);
      setAiEditPrompt('');
      setHasEdited(false);
      setLocalAiReply(null);
      setCurrentEmailId(null);
      setLastError('');
      setPendingQuestions([]);
      setUserAnswers({});
      setFormalityScore(50);
      setSuggestedFormalityScore(50);
      setSummaryComplete(false);
      setQuestionsLoaded(false);
      setMeetingRequest({ is_meeting: false });
      setEventCalendarStatus('idle');
      onShowResponseOptionsChange(false);
    } else if (prevEmailIdRef.current !== newEmailId) {
      // New email - try to load saved state
      const loaded = loadEmailState();
      setCurrentEmailId(newEmailId);

      // Only initialize defaults if no saved state
      if (!loaded) {
        setPendingQuestions([]);
        setUserAnswers({});
        setFormalityScore(50);
        setSuggestedFormalityScore(50);
        setSummaryComplete(false);
        setQuestionsLoaded(false);
        setMeetingRequest({ is_meeting: false });
        setEventCalendarStatus('idle');
        setIsEditing(false);
        setHasEdited(false);
        onShowResponseOptionsChange(false);
      }

      // Set edited reply from new email's AI reply (from store, not local state)
      // Only if not already loaded from state
      if (!loaded && aiReply) {
        setEditedReply(aiReply);
        setHasEdited(false);
      }
    }

    prevEmailIdRef.current = newEmailId;
  }, [email?.id, isSentEmail, aiReply]);

  // When summary completes and we have no aiReply, wait for user to click "Respond"
  useEffect(() => {
    if (summary && !displayAiReply && !isSentEmail && !hasSent && email?.id && !questionsLoaded) {
      // Only load questions automatically if showResponseOptions is true (user clicked Respond)
      if (showResponseOptions) {
        const state = getEmailState(email.id);
        const globalQuestionData = (window as any).emailQuestionData?.get(email.id);

        // Check if we have pre-generated questions from background or already loaded in state
        if ((globalQuestionData && globalQuestionData.loaded) || (state.questionsLoaded && state.pendingQuestions)) {
          const dataSource = globalQuestionData?.loaded ? globalQuestionData : state;
          console.log('[useEffect] Loading saved/pre-generated questions:', dataSource.pendingQuestions);
          setPendingQuestions(dataSource.pendingQuestions || []);
          // Clear answers when loading from global (new email), use saved answers when loading from state
          setUserAnswers(globalQuestionData?.loaded ? {} : (dataSource.userAnswers || {}));
          setSuggestedFormalityScore(dataSource.suggestedFormalityScore || 50);
          setFormalityScore(dataSource.formalityScore || 50);
          setMeetingRequest(dataSource.meetingRequest || { is_meeting: false });
          setAttachmentRequests(dataSource.attachmentRequests || []);
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
            state.userAnswers = {}; // Clear answers for new email from global
          }
        } else {
          // No pre-generated questions, trigger analysis
          console.log('[useEffect] No saved questions, triggering analysis');
          analyzeEmailForQuestions();
        }
      }
    }
  }, [summary, displayAiReply, isSentEmail, hasSent, email?.id, showResponseOptions]);

  const handleAiEdit = async () => {
    if (!aiEditPrompt.trim() || !editedReply) return;

    setIsAiEditing(true);
    try {
      // Try Claude API directly first (through Tauri)
      try {
        const result = await editReply(editedReply, aiEditPrompt);
        setEditedReply(result);
        setHasEdited(true);
        setAiEditPrompt('');
      } catch (claudeError) {
        console.log('[handleAiEdit] Claude API failed, falling back to Python server:', claudeError);
        // Fall back to Python server
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
      // Set attachment requests
      const attachmentReqs = globalQuestionData.attachment_requests || [];
      console.log('[analyzeEmail] Setting attachment requests:', attachmentReqs);
      setAttachmentRequests(attachmentReqs);
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

      // Try Claude API directly first (through Tauri)
      let result: any;
      try {
        console.log('[analyzeEmail] Trying Claude API through Tauri...');
        const claudeResponse = await analyzeEmail({
          sender: fullEmail.sender,
          subject: email.subject,
          body_text: bodyText,
          has_attachments: email.hasAttachments || fullEmail?.has_attachments || false,
        });

        result = {
          success: true,
          questions: claudeResponse.questions,
          suggested_formality_score: claudeResponse.suggested_formality_score,
          meeting_request: claudeResponse.meeting_request,
          missing_attachment_warning: claudeResponse.missing_attachment_warning,
        };
        console.log('[analyzeEmail] Claude API response:', result);
      } catch (claudeError) {
        console.log('[analyzeEmail] Claude API failed, falling back to Python server:', claudeError);
        // Fall back to Python server
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

        result = await response.json();
        console.log('[analyzeEmail] Python server response:', result);
      }

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

    // Fetch conversation context and learned writing style
    let conversationContext: ConversationContext | undefined;
    let learnedWritingStyle: RecipientWritingStyle | undefined;

    try {
      const senderEmail = email.from?.email || email.from?.name || email.sender;

      // Get conversation context (previous emails with this sender)
      conversationContext = await getConversationContext(
        senderEmail,
        emails,
        email.id, // Exclude current email from history
        5 // Get last 5 emails for context
      );
      console.log('[generateReply] Found conversation context:', conversationContext.total_conversation_count, 'emails');

      // Get learned writing style for this recipient
      learnedWritingStyle = await getRecipientWritingStyle(senderEmail);
      if (learnedWritingStyle) {
        console.log('[generateReply] Found learned writing style:', learnedWritingStyle.tone_description);
      }
    } catch (error) {
      console.warn('[generateReply] Failed to fetch context/style, continuing without it:', error);
    }

    // Build request
    const request: GenerateReplyRequest = {
      sender: fullEmail.sender,
      subject: email.subject,
      body_text: fullEmail.body_text || fullEmail.snippet || email.content || '',
      user_answers: answersArray,
      formality_level: formalityLevel,
      additional_context: additionalContext || undefined,
      selected_meeting_time: selectedMeetingTime ? `${selectedMeetingTime.dayName} at ${selectedMeetingTime.time}` : undefined,
      conversation_context: conversationContext,
      learned_writing_style: learnedWritingStyle,
      user_name: userName,
    };

    console.log('[generateReply] Request body:', JSON.stringify(request, null, 2));

    try {
      let replyText: string;

      // Try Claude API directly first (through Tauri)
      try {
        console.log('[generateReply] Trying Claude API through Tauri...');
        const claudeResponse = await claudeGenerateReply(request);
        replyText = claudeResponse.reply;
        console.log('[generateReply] Claude API response received');
      } catch (claudeError) {
        console.log('[generateReply] Claude API failed, falling back to Python server:', claudeError);
        // Fall back to Python server
        const baseURL = await serverURL();
        const response = await fetchWithTimeout(`${baseURL}/generate-reply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        }, 60000);

        if (!response.ok) {
          throw new Error(`Server returned ${response.status}`);
        }

        const rawText = await response.text();
        const result = JSON.parse(rawText);

        if (!result.success || !result.reply) {
          throw new Error(result.error || 'No reply in response');
        }

        replyText = result.reply;
      }

      console.log('[generateReply] Reply generated successfully:', replyText);
      // Set local state immediately for display - track which email this reply belongs to
      setCurrentEmailId(email.id);
      setLocalAiReply(replyText);
      setEditedReply(replyText);
      setHasEdited(false);
      // Update store with the generated reply
      useEmailStore.setState((state) => ({
        emails: state.emails.map(e =>
          e.id === email.id ? { ...e, ai_generated_reply: replyText } : e
        ),
      }));
    } catch (error) {
      console.error('[generateReply] Failed to generate reply:', error);
      const errorMsg = String(error);
      setLastError('Error: ' + errorMsg);
      alert('Failed to generate reply. Please try again.\n\nError: ' + errorMsg);
    } finally {
      console.log('[generateReply] Done, generatingReply = false');
      setGeneratingReply(false);
    }
  };

  const handleSendReply = async () => {
    if (!email || !editedReply) return;

    // Start the sending countdown
    setIsSending(true);
    setSendCountdown(3);

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

    // Set timeout to actually send after 3 seconds
    sendTimeoutRef.current = setTimeout(async () => {
      clearInterval(countdownIntervalRef.current!);
      setIsSending(false);
      setSendCountdown(3);

      // Debug: log email structure
      console.log('[handleSendReply] Email object:', {
        id: email.id,
        sender: email.sender,
        from: email.from,
        recipients: email.recipients,
        to: email.to,
      });

      // Get the recipient email (who we're replying to)
      let senderEmail = email.from?.email || email.sender;

      // For sample emails, the sender might be in format "Name <email>" (sometimes malformed)
      if (senderEmail && senderEmail.includes('<')) {
        // Extract email from "Name <email>" format
        // First try standard format with closing >
        const match = senderEmail.match(/<([^>]+)>/);
        if (match) {
          senderEmail = match[1];
        } else {
          // Handle malformed format like "Name <email" (no closing >)
          const parts = senderEmail.split('<');
          if (parts.length > 1) {
            senderEmail = parts[1].trim(); // Take everything after "<"
          }
        }
      }

      // Last resort: use a test email for sample emails
      if (!senderEmail || !senderEmail.includes('@')) {
        console.warn('[handleSendReply] No valid email found, using test address');
        senderEmail = 'test@example.com';
      }

      console.log('[handleSendReply] Final recipient email:', senderEmail);

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

      // Update UI immediately to show "Sent" before actually sending
      updateEmailStatus(email.id, 'Replied');

      // Immediately mark as sent in the store so hasSentReply returns true right away
      useEmailStore.setState((state) => ({
        sentReplyEmailIds: new Set(state.sentReplyEmailIds).add(email.id),
      }));

      setIsEditing(false);

      // Capture attachments before clearing state
      const attachmentsToSend = [...selectedAttachments];

      console.log('[handleSendReply] Sending email with attachments:', attachmentsToSend.length, 'files');
      console.log('[handleSendReply] Attachments:', attachmentsToSend.map(a => ({ name: a.name, base64_length: a.base64?.length })));

      // Send email in background (don't await - show Sent immediately)
      sendEmail(senderEmail, `Re: ${email.subject}`, editedReply, email.id, originalEmailData, attachmentsToSend)
        .then(() => {
          // Only clear attachments after successful send
          setSelectedAttachments([]);
        })
        .catch((error) => {
          console.error('Failed to send reply:', error);
          alert('Failed to send reply');
          // Restore attachments if send failed
          setSelectedAttachments(attachmentsToSend);
          // Revert status if send failed
          updateEmailStatus(email.id, 'Unhandled');
          // Also remove from sentReplyEmailIds
          useEmailStore.setState((state) => {
            const newSet = new Set(state.sentReplyEmailIds);
            newSet.delete(email.id);
            return { sentReplyEmailIds: newSet };
          });
        });

      // Analyze and save writing style for this recipient (do this in background, don't wait)
      ;(async () => {
        try {
          // Get all sent emails to this recipient to analyze writing style
          const sentEmailsToRecipient = sentEmails.filter((e: any) => {
            const recipient = e.to?.email || e.to?.name || e.recipients || '';
            return recipient.includes(senderEmail) || recipient.includes(email.from?.email || '');
          });

          // Get bodies of sent emails for analysis
          const sentEmailBodies = sentEmailsToRecipient
            .map((e: any) => e.body || e.ai_generated_reply || '')
            .filter(Boolean) as string[];

          // Include the current reply as well
          sentEmailBodies.unshift(editedReply);

          if (sentEmailBodies.length >= 2) {
            console.log('[handleSendReply] Analyzing writing style with', sentEmailBodies.length, 'emails');
            await analyzeAndSaveWritingStyle(senderEmail, sentEmailBodies);
            console.log('[handleSendReply] Writing style saved for', senderEmail);
          }
        } catch (error) {
          console.warn('[handleSendReply] Failed to analyze writing style:', error);
          // Don't alert user, this is a background task
        }
      })();
    }, 3000);
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

  // Thread navigation - get thread emails and position
  // Use the email prop first, then fall back to storeSelectedEmail
  const threadEmails = React.useMemo(() => {
    // Prioritize the email prop over storeSelectedEmail
    const currentEmail = email || storeSelectedEmail;
    if (!currentEmail?.thread_id) return [];
    // Filter emails by thread_id directly to ensure we get fresh data
    return emails
      .filter(e => e.thread_id === currentEmail.thread_id)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [email?.id, storeSelectedEmail?.id, emails]);

  const handleNavigateThread = React.useCallback((direction: 'prev' | 'next') => {
    // Prioritize the email prop over storeSelectedEmail
    const currentEmail = email || storeSelectedEmail;
    if (!currentEmail?.thread_id) return;

    // Compute thread emails directly to ensure fresh data
    const allThreadEmails = emails
      .filter(e => e.thread_id === currentEmail.thread_id)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    if (allThreadEmails.length <= 1) return;

    const currentIndex = allThreadEmails.findIndex(e => e.id === currentEmail.id);
    if (currentIndex === -1) return;

    let nextIndex: number;
    if (direction === 'next') {
      nextIndex = (currentIndex + 1) % allThreadEmails.length;
    } else {
      nextIndex = currentIndex - 1;
      if (nextIndex < 0) nextIndex = allThreadEmails.length - 1;
    }

    const nextEmail = allThreadEmails[nextIndex];
    if (nextEmail) {
      selectEmail(nextEmail);
      if (onEmailSelect) {
        onEmailSelect(nextEmail.id);
      }
    }
  }, [email?.id, storeSelectedEmail?.id, emails, selectEmail, onEmailSelect]);

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
    <div className={`flex flex-col bg-white dark:bg-gray-800 overflow-hidden ${focusedView ? 'h-full flex-1' : ''}`}>
      {/* Action Bar - scrollable when content is long */}
      <div className={`${isSentEmail ? 'px-4 pb-4' : focusedView ? 'p-4' : 'p-4'} overflow-y-auto ${focusedView ? 'flex-1' : 'max-h-[50%]'} min-h-0 flex-shrink-0`}>

        {/* Summary Display - slides in when ready */}
        {summary && (
          <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800" style={{ animation: 'slideInDown 0.3s ease-out' }}>
            <div className="flex items-center gap-2 mb-2">
              <div className="h-5 w-5 rounded-full bg-purple-500 flex items-center justify-center">
                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-sm font-medium text-purple-700 dark:text-purple-300">Summary</p>
            </div>
            <p className="text-sm text-gray-700 dark:text-gray-300 pl-7">{summary}</p>

            {/* Key Points */}
            {keyPoints && keyPoints.length > 0 && (
              <div className="mt-3 pl-7">
                <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5 flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  Key Points
                </p>
                <ul className="space-y-1">
                  {keyPoints.map((point, idx) => (
                    <li key={idx} className="text-xs text-gray-700 dark:text-gray-300 flex items-start gap-2">
                      <span className="text-purple-500 mt-0.5">•</span>
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Action Items */}
            {actionItems && actionItems.length > 0 && (
              <div className="mt-3 pl-7">
                <p className="text-xs font-medium text-amber-600 dark:text-amber-400 mb-1.5 flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Action Items
                </p>
                <ul className="space-y-1">
                  {actionItems.map((item, idx) => (
                    <li key={idx} className="text-xs text-gray-700 dark:text-gray-300 flex items-start gap-2">
                      <span className="text-amber-500 mt-0.5">✓</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Thread Navigation - show when in a thread with multiple emails */}
        {threadEmails.length > 1 && !isSentEmail && !hideThreadNavigation && (() => {
          const currentId = email?.id || storeSelectedEmail?.id;
          const currentIndex = threadEmails.findIndex(e => e.id === currentId);
          const current = currentIndex >= 0 ? currentIndex + 1 : 1;
          const total = threadEmails.length;
          return { current, total };
        })() && (
          <div className={`p-3 bg-gray-50 dark:bg-gray-900/30 rounded-lg border border-gray-200 dark:border-gray-700 ${summary ? 'mt-4' : ''}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                <span className="text-xs text-gray-600 dark:text-gray-400">
                  {(() => {
                    const currentId = email?.id || storeSelectedEmail?.id;
                    const currentIndex = threadEmails.findIndex(e => e.id === currentId);
                    const current = currentIndex >= 0 ? currentIndex + 1 : 1;
                    const total = threadEmails.length;
                    return `${current} of ${total} in conversation`;
                  })()}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleNavigateThread('prev')}
                  className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                  title="Previous in thread"
                >
                  <ChevronUp className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                </button>
                <button
                  onClick={() => handleNavigateThread('next')}
                  className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                  title="Next in thread"
                >
                  <ChevronDown className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                </button>
              </div>
            </div>
            {/* Thread participants preview */}
            <div className="flex items-center gap-1 mt-2 flex-wrap">
              {threadEmails.map((e, idx) => {
                const currentId = email?.id || storeSelectedEmail?.id;
                return (
                  <button
                    key={e.id}
                    onClick={() => {
                      selectEmail(e);
                      if (onEmailSelect) {
                        onEmailSelect(e.id);
                      }
                    }}
                    className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                      e.id === currentId
                        ? 'bg-blue-100 border-blue-300 text-blue-700 dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-300'
                        : 'bg-gray-100 border-gray-200 text-gray-600 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 cursor-pointer'
                    }`}
                    title={`Go to email ${idx + 1}`}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Event Card - for detected events (talks, seminars, workshops) */}
        {!isSentEmail && !hasSent && summary && meetingRequest?.is_meeting && meetingRequest?.event_type === 'event' && eventCalendarStatus !== 'dismissed' && (
          <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800" style={{ animation: 'slideInUp 0.3s ease-out' }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-blue-500 flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
                    {meetingRequest.subject || email.subject}
                  </p>
                  <p className="text-xs text-blue-600 dark:text-blue-400">
                    {(() => {
                      const time = meetingRequest.proposed_times?.[0];
                      if (!time) return 'Date TBD';
                      const parts = time.split('-');
                      // Parse as local to avoid timezone shift
                      const d = parts.length >= 3 ? new Date(time) : new Date(time);
                      if (isNaN(d.getTime())) return time;
                      return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) +
                        ' at ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
                    })()}
                    {meetingRequest.location && ` · ${meetingRequest.location}`}
                  </p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-3 pl-10">
              {eventCalendarStatus === 'added' ? (
                <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-xs font-medium">Added to calendar</span>
                </div>
              ) : (
                <>
                  <button
                    onClick={async () => {
                      setEventCalendarStatus('adding');
                      try {
                        const time = meetingRequest.proposed_times?.[0];
                        if (!time) return;
                        const startDate = new Date(time);
                        const endDate = new Date(startDate.getTime() + (meetingRequest.duration_minutes || 60) * 60000);
                        const baseURL = await serverURL();
                        const response = await fetch(`${baseURL}/calendar`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            action: 'create_event',
                            summary: meetingRequest.subject || email.subject,
                            start_datetime: startDate.toISOString(),
                            end_datetime: endDate.toISOString(),
                            location: meetingRequest.location || undefined,
                          }),
                        });
                        if (response.ok) {
                          const data = await response.json();
                          if (data.success) {
                            setEventCalendarStatus('added');
                          }
                        }
                      } catch (err) {
                        console.error('Failed to add event to calendar:', err);
                        setEventCalendarStatus('idle');
                      }
                    }}
                    disabled={eventCalendarStatus === 'adding'}
                    className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg font-medium transition-colors flex items-center gap-1.5"
                  >
                    {eventCalendarStatus === 'adding' ? (
                      <>
                        <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Adding...
                      </>
                    ) : (
                      <>
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Add to Calendar
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => setEventCalendarStatus('dismissed')}
                    className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 rounded-lg font-medium transition-colors"
                  >
                    Not interested
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Meeting Suggestions - for scheduling meetings (not events) */}
        {!displayAiReply && !isSentEmail && !hasSent && summary && meetingRequest?.is_meeting && meetingRequest?.event_type !== 'event' && (
          <div className="mt-4" style={{ animation: 'slideInUp 0.3s ease-out' }}>
            <MeetingSuggestions
              meetingRequest={meetingRequest}
              emailSubject={email.subject}
              senderEmail={fullEmail?.sender || email.sender || ''}
              timezone={userTimezone}
              onTimeSelected={(slot) => {
                setSelectedMeetingTime(slot);
                // Trigger reply generation with the selected time
                setAdditionalContext(`Meeting time: ${slot.dayName} at ${slot.time}`);
              }}
              onCreated={() => {
                // Optionally refresh the calendar or show a confirmation
              }}
            />
          </div>
        )}

        {/* Unified Email Processing Indicator - shows while summary is generating OR questions are being analyzed */}
        {(isSummaryGenerating || (analyzingQuestions && !displayAiReply)) && (
          <div
            className={`p-4 bg-gradient-to-r from-purple-50 to-amber-50 dark:from-purple-900/20 dark:to-amber-900/20 rounded-lg border border-purple-200 dark:border-purple-800 ${summary ? 'mt-4' : ''}`}
            style={{ animation: summary ? 'slideInDown 0.5s ease-out' : undefined }}
          >
            <div className="flex items-center gap-3">
              <div className="relative">
                {/* Spinner while processing */}
                {analyzingQuestions ? (
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
                ) : (
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-purple-500 border-t-transparent" />
                )}
                {/* Checkmark overlay when summary is done but questions are still processing */}
                {summary && analyzingQuestions && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {isSummaryGenerating ? 'Reading email...' : 'Analyzing for questions...'}
                </p>
                {/* Progress steps */}
                <div className="flex items-center gap-2 mt-2">
                  <div className={`flex items-center gap-1.5 text-xs ${summary ? 'text-green-600 dark:text-green-400' : 'text-purple-600 dark:text-purple-400'}`}>
                    <div className={`h-1.5 w-1.5 rounded-full ${summary ? 'bg-green-500' : 'bg-purple-500 animate-pulse'}`} />
                    <span>Summary</span>
                  </div>
                  <div className="h-px w-4 bg-gray-300 dark:bg-gray-600" />
                  <div className={`flex items-center gap-1.5 text-xs ${summary && analyzingQuestions ? 'text-amber-600 dark:text-amber-400 animate-pulse' : 'text-gray-400 dark:text-gray-500'}`}>
                    <div className={`h-1.5 w-1.5 rounded-full ${summary && analyzingQuestions ? 'bg-amber-500' : 'bg-gray-400 dark:bg-gray-600'}`} />
                    <span>Questions</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Questions Section - slides in when ready after summary and user clicked Respond */}
        {!analyzingQuestions && questionsLoaded && !displayAiReply && summary && showResponseOptions && (
          <div className="mt-4 space-y-4" style={{ animation: 'slideInUp 0.3s ease-out' }} data-reply-section>
            {/* Missing Attachment Warning */}
            <MissingAttachmentWarning warning={missingAttachmentWarning} />

            {/* Questions list */}
            {pendingQuestions.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Questions to answer:</p>
                  {/* Question navigation */}
                  <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                    <button
                      onClick={() => setCurrentQuestionIndex(Math.max(0, currentQuestionIndex - 1))}
                      disabled={currentQuestionIndex === 0}
                      className={`p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors ${
                        currentQuestionIndex === 0 ? 'opacity-30 cursor-not-allowed' : ''
                      }`}
                      title="Previous question"
                    >
                      <ChevronUp className="w-3 h-3" />
                    </button>
                    <span className="text-gray-600 dark:text-gray-300 whitespace-nowrap">
                      {currentQuestionIndex + 1} <span className="text-gray-400">out of</span> {pendingQuestions.length}
                    </span>
                    <button
                      onClick={() => setCurrentQuestionIndex(Math.min(pendingQuestions.length - 1, currentQuestionIndex + 1))}
                      disabled={currentQuestionIndex === pendingQuestions.length - 1}
                      className={`p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors ${
                        currentQuestionIndex === pendingQuestions.length - 1 ? 'opacity-30 cursor-not-allowed' : ''
                      }`}
                      title="Next question"
                    >
                      <ChevronDown className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                {pendingQuestions
                  .filter((_, idx) => idx === currentQuestionIndex)
                  .map((question, idx) => {
                    const actualIndex = currentQuestionIndex;
                    return (
                  <div
                    key={actualIndex}
                    className={`p-4 rounded-lg border transition-colors ${
                      userAnswers[actualIndex]
                        ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                        : 'bg-white dark:bg-gray-800/50 border-gray-200 dark:border-gray-700'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Numbered badge */}
                      <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${
                        userAnswers[actualIndex]
                          ? 'bg-green-500 text-white'
                          : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                      }`}>
                        {actualIndex + 1}
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
                                onClick={() => handleAnswer(actualIndex, option)}
                                className={`px-4 py-2 text-sm rounded-full border transition-colors ${
                                  userAnswers[actualIndex] === option
                                    ? 'bg-amber-500 text-white border-amber-500'
                                    : 'bg-white dark:bg-gray-800/50 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
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
                              defaultValue={userAnswers[actualIndex] || ''}
                              onChange={(e) => handleAnswer(actualIndex, e.target.value)}
                              className="flex-1 px-3 py-2 text-sm bg-white dark:bg-gray-800/50 rounded border border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-amber-500"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              </div>
            )}

            {/* Formality Score Selector - Continuous Slider */}
            {/* TEMPORARILY DISABLED - Auto-detecting tone from email instead */}
            {/*
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
              <div className="h-4" />
            </div>
            */}
          </div>
        )}

        {/* Attachment Suggestions Section - separate container, appears before generate button */}
        {!analyzingQuestions && questionsLoaded && !displayAiReply && summary && showResponseOptions && attachmentRequests.length > 0 && (
          <div className="mt-4 space-y-4" style={{ animation: 'slideInUp 0.3s ease-out' }}>
            <AttachmentSuggestions
              attachmentRequests={attachmentRequests}
              onAttachmentsSelected={(attachments) => {
                setSelectedAttachments(attachments);
              }}
            />
          </div>
        )}

        {/* Additional Context Input - Optional keywords/instructions for AI */}
        {!analyzingQuestions && questionsLoaded && !displayAiReply && summary && showResponseOptions && (
          <input
            type="text"
            value={additionalContext}
            onChange={(e) => setAdditionalContext(e.target.value)}
            placeholder="Additional context (optional)"
            className="mt-4 w-full px-3 py-2 text-sm bg-white dark:bg-gray-800/50 rounded-lg border border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-400 dark:placeholder-gray-500"
          />
        )}

        {/* Generate Button - more subtle, hide when generating */}
        {!analyzingQuestions && questionsLoaded && !displayAiReply && summary && showResponseOptions && !generatingReply && (
          <div className="mt-4">
            <Button
              onClick={generateReply}
              variant="outline"
              className="w-full text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 py-2 text-sm"
              data-generate-reply-button
            >
              Generate Reply
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

        {/* Original Email Display - shown when viewing sent email */}
        {displayAiReply && isSentEmail && originalEmail && (
          <>
            {/* Reminder Suggestion - show when viewing a sent email that's waiting for reply */}
            <ReminderSuggestion sentEmailId={email.id} />

            <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-900/20 rounded-lg border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-gray-300 dark:border-gray-600">
              <MessageSquare className="w-4 h-4 text-gray-500 dark:text-gray-400" />
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Original email you replied to:</p>
            </div>
            <div className="space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{originalEmail.sender || 'Unknown'}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{new Date(originalEmail.date || email.timestamp || Date.now()).toLocaleString()}</p>
                </div>
              </div>
              <p className="text-sm text-gray-700 dark:text-gray-300 font-medium">{originalEmail.subject || '(No subject)'}</p>
              <div className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap max-h-40 overflow-y-auto bg-white dark:bg-gray-800/50 p-3 rounded border border-gray-200 dark:border-gray-700">
                {originalEmail.body_text || originalEmail.snippet || email.content || '(No content)'}
              </div>
              {originalEmail.has_attachments && (originalEmail.attachments || []).length > 0 && (
                <div className="mt-3 space-y-2">
                  <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">Attachments:</p>
                  {(originalEmail.attachments || []).map((att: any, idx: number) => (
                    <div key={idx} className="flex items-center gap-2 p-2 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
                      {getFileIcon(att.mimeType || 'application/octet-stream')}
                      <span className="text-xs text-gray-700 dark:text-gray-300 truncate flex-1">{att.filename}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
        )}

        {/* AI Reply Display/Edit */}
        {displayAiReply && (
          <div className="mt-4 space-y-3">
            <div className={`p-4 rounded-lg border ${hasSent || isSentEmail ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'}`}>
              <div className="flex items-center justify-between mb-3">
                <p className={`text-sm font-medium ${hasSent || isSentEmail ? 'text-green-700 dark:text-green-300' : 'text-blue-700 dark:text-blue-300'}`}>
                  AI Response {(hasSent || isSentEmail) && '(Sent)'}
                </p>
                {(hasSent || isSentEmail) && (
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
                <div className={`mb-3 pb-3 border-b ${hasSent || isSentEmail ? 'border-green-200 dark:border-green-700' : 'border-blue-200 dark:border-blue-700'}`}>
                  <p className="text-sm text-gray-700 dark:text-gray-300">
                    <span className={`text-sm ${hasSent || isSentEmail ? 'text-green-600 dark:text-green-400' : 'text-blue-600 dark:text-blue-400'}`}>Subject: </span>
                    Re: {email.subject}
                  </p>
                </div>
              )}

              {/* Show attachments indicator */}
              {!isEditing && ((selectedAttachments.length > 0 && !hasSent && !isSentEmail) || ((hasSent || isSentEmail) && fullEmail?.attachments?.length > 0)) && (
                <div className={`mb-3 p-2 rounded-lg ${hasSent || isSentEmail ? 'bg-green-100 dark:bg-green-900/30 border border-green-300 dark:border-green-700' : 'bg-blue-100 dark:bg-blue-900/30 border border-blue-300 dark:border-blue-700'}`}>
                  <div className="flex items-center gap-2">
                    <Paperclip className="w-4 h-4 text-gray-600 dark:text-gray-400 flex-shrink-0" />
                    <p className="text-xs text-gray-700 dark:text-gray-300">
                      <span className="font-medium">Attachments:</span> {(hasSent || isSentEmail) ? (fullEmail?.attachments || []).map(a => a.filename || a.name).join(', ') : selectedAttachments.map(a => a.name).join(', ')}
                    </p>
                  </div>
                </div>
              )}

              {isEditing ? (
                <textarea
                  value={editedReply}
                  onChange={(e) => { setEditedReply(e.target.value); setHasEdited(true); }}
                  className="w-full min-h-[120px] p-3 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800/50 rounded-lg border border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                  placeholder="Edit your reply..."
                />
              ) : (
                <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{hasEdited ? editedReply : (displayAiReply || '')}</p>
              )}
              {!hasSent && !isSentEmail && (
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
            {isEditing && !hasSent && !isSentEmail && !isSending && (
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
                    className="flex-1 px-3 py-2 text-sm bg-white dark:bg-gray-800/50 rounded-lg border border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500"
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
    </div>
  );
};
