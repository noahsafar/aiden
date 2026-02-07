import React from 'react';
import { useEmailStore } from '@/stores/emailStore';
import { Clock, Bell, BellOff, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface ReminderSuggestionProps {
  sentEmailId?: string;
  onDismiss?: () => void;
  onSnooze?: (days: number) => void;
}

export const ReminderSuggestion: React.FC<ReminderSuggestionProps> = ({
  sentEmailId,
  onDismiss,
  onSnooze,
}) => {
  const { sentEmails, cancelReminder, scheduleReplyReminder } = useEmailStore();

  // Find the sent email
  const sentEmail = sentEmailId ? sentEmails.find(e => e.id === sentEmailId) : null;

  if (!sentEmail || !sentEmail.waiting_on_reply_since) {
    return null;
  }

  const now = new Date();
  const waitingSince = new Date(sentEmail.waiting_on_reply_since);
  const daysWaiting = Math.floor((now.getTime() - waitingSince.getTime()) / (1000 * 60 * 60 * 24));

  // Check if reminder is due
  const isReminderDue = sentEmail.reminder_due_date
    ? new Date(sentEmail.reminder_due_date) <= now
    : daysWaiting >= 3;

  // Check if reminder was already triggered
  const wasTriggered = sentEmail.reminder_triggered;

  if (!isReminderDue && !wasTriggered) {
    return null;
  }

  const handleDismiss = () => {
    if (sentEmail.id) {
      cancelReminder(sentEmail.id);
    }
    onDismiss?.();
  };

  const handleSnooze = (days: number) => {
    if (sentEmail.id && sentEmail.inReplyTo) {
      // Reschedule with new delay
      scheduleReplyReminder(sentEmail.id, sentEmail.inReplyTo, days);
    }
    onSnooze?.(days);
  };

  const snoozeOptions = [
    { label: '1 day', days: 1 },
    { label: '3 days', days: 3 },
    { label: '1 week', days: 7 },
  ];

  return (
    <div
      className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800 animate-in slide-in-from-top-2 duration-300"
      style={{ animation: 'slideInUp 0.3s ease-out' }}
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0">
          <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
            <Bell className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                No reply in {daysWaiting} {daysWaiting === 1 ? 'day' : 'days'}
              </p>
              <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                Want to bump this? It's been {daysWaiting} {daysWaiting === 1 ? 'day' : 'days'} since you sent "{sentEmail.subject}"
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              onClick={handleDismiss}
              className="text-xs text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              <BellOff className="w-3 h-3 mr-1" />
              Dismiss
            </Button>

            {snoozeOptions.map((option) => (
              <Button
                key={option.days}
                size="sm"
                variant="outline"
                onClick={() => handleSnooze(option.days)}
                className="text-xs text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/30"
              >
                <RefreshCw className="w-3 h-3 mr-1" />
                Remind in {option.label}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

interface WaitingOnReplyCardProps {
  sentEmail: ReturnType<typeof useEmailStore.getState>['sentEmails'][number] & {
    daysWaiting: number;
    daysUntilReminder: number;
  };
  onViewEmail?: (emailId: string) => void;
  onCancelReminder?: (emailId: string) => void;
  onReschedule?: (emailId: string, originalEmailId: string, days: number) => void;
}

export const WaitingOnReplyCard: React.FC<WaitingOnReplyCardProps> = ({
  sentEmail,
  onViewEmail,
  onCancelReminder,
  onReschedule,
}) => {
  const { cancelReminder, scheduleReplyReminder } = useEmailStore();

  const handleCancel = () => {
    cancelReminder(sentEmail.id);
    onCancelReminder?.(sentEmail.id);
  };

  const handleReschedule = (days: number) => {
    if (sentEmail.inReplyTo) {
      scheduleReplyReminder(sentEmail.id, sentEmail.inReplyTo, days);
      onReschedule?.(sentEmail.id, sentEmail.inReplyTo, days);
    }
  };

  const isOverdue = sentEmail.daysUntilReminder <= 0;

  return (
    <div className={`p-4 rounded-lg border transition-colors ${
      isOverdue
        ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
        : 'bg-gray-50 dark:bg-gray-900/30 border-gray-200 dark:border-gray-700'
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Clock className={`w-4 h-4 ${isOverdue ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400'}`} />
            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
              {sentEmail.subject}
            </p>
          </div>

          <div className="flex items-center gap-3 mt-1">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              To: {sentEmail.recipients}
            </p>
            <span className="text-gray-300 dark:text-gray-600">•</span>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {sentEmail.daysWaiting} {sentEmail.daysWaiting === 1 ? 'day' : 'days'} ago
            </p>
          </div>

          {isOverdue ? (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
              Reminder due now
            </p>
          ) : (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
              Reminder in {sentEmail.daysUntilReminder} {sentEmail.daysUntilReminder === 1 ? 'day' : 'days'}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1">
          {sentEmail.originalEmail && onViewEmail && (
            <button
              onClick={() => onViewEmail(sentEmail.originalEmail?.id || '')}
              className="p-2 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 text-blue-600 dark:text-blue-400 transition-colors"
              title="View original email"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            </button>
          )}
          <button
            onClick={handleCancel}
            className="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 transition-colors"
            title="Cancel reminder"
          >
            <BellOff className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Quick reschedule */}
      {isOverdue && (
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-amber-200 dark:border-amber-800">
          <span className="text-xs text-gray-500 dark:text-gray-400">Reschedule:</span>
          {[1, 3, 7].map((days) => (
            <button
              key={days}
              onClick={() => handleReschedule(days)}
              className="text-xs px-2 py-1 rounded bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              {days}d
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

interface WaitingOnReplyListProps {
  onViewEmail?: (emailId: string) => void;
}

export const WaitingOnReplyList: React.FC<WaitingOnReplyListProps> = ({
  onViewEmail,
}) => {
  const { getThreadsWaitingOnReply } = useEmailStore();
  const waitingEmails = getThreadsWaitingOnReply();

  if (waitingEmails.length === 0) {
    return (
      <div className="p-8 text-center">
        <Clock className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No threads waiting for reply
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
          When you send a reply, Aiden will track if you get a response
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600 dark:text-gray-400 px-2">
        {waitingEmails.length} {waitingEmails.length === 1 ? 'thread' : 'threads'} waiting for reply
      </p>
      {waitingEmails.map((email) => (
        <WaitingOnReplyCard
          key={email.id}
          sentEmail={email as any}
          onViewEmail={onViewEmail}
        />
      ))}
    </div>
  );
};
