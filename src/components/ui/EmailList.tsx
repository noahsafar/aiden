import React, { useEffect, useState } from 'react';

interface EmailQuestionData {
  questions: string[];
  suggestedFormalityScore: number;
  requiresReply?: boolean;
  replyReasoning?: string;
  loaded: boolean;
}

interface EmailListProps {
  emails?: any[];
  selectedEmailId?: string | null;
  onEmailSelect?: (id: string) => void;
  onEmailAction?: (id: string, action: string) => void;
}

// Helper function to get reply requirement data for an email
function getEmailReplyData(emailId: string): EmailQuestionData | undefined {
  if (typeof window !== 'undefined' && (window as any).emailQuestionData) {
    return (window as any).emailQuestionData.get(emailId);
  }
  return undefined;
}

export const EmailList: React.FC<EmailListProps> = ({
  emails = [],
  selectedEmailId = null,
  onEmailSelect = () => {},
  onEmailAction = () => {}
}) => {
  const [replyData, setReplyData] = useState<Map<string, EmailQuestionData>>(new Map());

  // Trigger re-render when reply data changes - poll for updates
  useEffect(() => {
    const checkForUpdates = () => {
      if (typeof window !== 'undefined' && (window as any).emailQuestionData) {
        const newData = new Map((window as any).emailQuestionData);
        // Only update if actually changed
        if (newData.size !== replyData.size) {
          setReplyData(newData);
        }
      }
    };

    // Check immediately and then poll
    checkForUpdates();
    const interval = setInterval(checkForUpdates, 500);
    return () => clearInterval(interval);
  }, [emails, replyData.size]);

  // Component for the action badge
  const ActionBadge = ({ emailId }: { emailId: string }) => {
    const data = getEmailReplyData(emailId);

    // Debug logging
    console.log('[ActionBadge] Email ID:', emailId, 'Data:', data);

    if (!data?.loaded) {
      return null;
    }

    const requiresReply = data.requiresReply;

    if (requiresReply) {
      return (
        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700 border border-amber-200">
          Action Required
        </span>
      );
    }

    return (
      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-500 border border-gray-200">
        FYI
      </span>
    );
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-4 space-y-2">
        {emails.map((email: any) => {
          const replyData = getEmailReplyData(email.id);
          const isFyi = replyData?.loaded && replyData.requiresReply === false;

          return (
            <div
              key={email.id}
              className={`p-4 bg-surface dark:bg-gray-800 border rounded-lg hover:shadow-md transition-shadow cursor-pointer ${
                selectedEmailId === email.id ? 'border-blue-500 dark:border-blue-400' : 'border-border'
              } ${isFyi ? 'opacity-60' : ''}`}
              onClick={() => onEmailSelect(email.id)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs text-muted truncate">{email.from?.name || email.from?.email || 'Unknown'}</span>
                    <ActionBadge emailId={email.id} />
                  </div>
                  <h3 className={`font-semibold text-foreground ${!email.isRead ? 'text-blue-600 dark:text-blue-400' : ''}`}>{email.subject}</h3>
                  <p className="text-sm text-muted mt-1 line-clamp-2">{email.preview}</p>
                </div>
                <span className="text-xs text-muted flex-shrink-0">{email.timestamp}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
