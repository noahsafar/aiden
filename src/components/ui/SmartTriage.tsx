import React, { useMemo, useState } from 'react';
import { useEmailStore } from '@/stores/emailStore';
import {
  CheckCircle2,
  XCircle,
  Archive,
  Trash2,
  Sparkles,
  Calendar,
  Package,
  Receipt,
  Users,
  Mail,
  ChevronDown,
  ChevronUp,
  Check,
} from 'lucide-react';

// Email categories for smart triage
type EmailGroup =
  | 'meeting_requests'
  | 'shipping_updates'
  | 'newsletters'
  | 'notifications'
  | 'finance'
  | 'social'
  | 'work'
  | 'other';

interface EmailGroupInfo {
  id: EmailGroup;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
  color: string;
  // Keywords to categorize emails
  keywords: string[];
  // Suggested action
  suggestedAction: 'archive' | 'delete' | 'save' | 'none';
}

const EMAIL_GROUPS: EmailGroupInfo[] = [
  {
    id: 'meeting_requests',
    label: 'Meeting Requests',
    icon: Calendar,
    description: 'Calendar invites and meeting scheduling',
    color: 'blue',
    keywords: ['meeting', 'invite', 'calendar', 'schedule', 'zoom', 'teams', 'google meet', 'call'],
    suggestedAction: 'none',
  },
  {
    id: 'shipping_updates',
    label: 'Shipping Updates',
    icon: Package,
    description: 'Package delivery notifications',
    color: 'green',
    keywords: ['shipped', 'delivery', 'out for delivery', 'delivered', 'tracking', 'package', 'order'],
    suggestedAction: 'archive',
  },
  {
    id: 'newsletters',
    label: 'Newsletters',
    icon: Mail,
    description: 'Marketing emails and newsletters',
    color: 'purple',
    keywords: ['unsubscribe', 'newsletter', 'digest', 'weekly', 'update', 'promo', 'deal', 'offer'],
    suggestedAction: 'archive',
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: Sparkles,
    description: 'App notifications and alerts',
    color: 'amber',
    keywords: ['notification', 'alert', 'reminder', 'ping', 'mention'],
    suggestedAction: 'archive',
  },
  {
    id: 'finance',
    label: 'Finance',
    icon: Receipt,
    description: 'Bills, invoices, and financial statements',
    color: 'emerald',
    keywords: ['invoice', 'receipt', 'payment', 'bill', 'statement', 'transaction', 'refund'],
    suggestedAction: 'save',
  },
  {
    id: 'social',
    label: 'Social',
    icon: Users,
    description: 'Social media updates',
    color: 'pink',
    keywords: ['facebook', 'twitter', 'linkedin', 'instagram', 'social', 'follow', 'like'],
    suggestedAction: 'archive',
  },
  {
    id: 'work',
    label: 'Work',
    icon: Mail,
    description: 'Work-related emails and discussions',
    color: 'slate',
    keywords: ['question', 'api', 'integration', 'project', 'deadline', 'review', 'feedback', 'proposal', 'report', 'request', 'urgent', 'important', 'asap', 'help', 'issue', 'bug', 'fix', 'deploy', 'release'],
    suggestedAction: 'none',
  },
  {
    id: 'other',
    label: 'Other',
    icon: Mail,
    description: 'Emails that don\'t fit into other categories',
    color: 'gray',
    keywords: [], // No keywords - this catches everything else
    suggestedAction: 'none',
  },
];

const getColorClasses = (color: string, isBg: boolean = false) => {
  const colors = {
    blue: isBg ? 'bg-blue-100 dark:bg-blue-900/30' : 'text-blue-600 dark:text-blue-400',
    green: isBg ? 'bg-green-100 dark:bg-green-900/30' : 'text-green-600 dark:text-green-400',
    purple: isBg ? 'bg-purple-100 dark:bg-purple-900/30' : 'text-purple-600 dark:text-purple-400',
    amber: isBg ? 'bg-amber-100 dark:bg-amber-900/30' : 'text-amber-600 dark:text-amber-400',
    emerald: isBg ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'text-emerald-600 dark:text-emerald-400',
    pink: isBg ? 'bg-pink-100 dark:bg-pink-900/30' : 'text-pink-600 dark:text-pink-400',
    red: isBg ? 'bg-red-100 dark:bg-red-900/30' : 'text-red-600 dark:text-red-400',
    gray: isBg ? 'bg-gray-100 dark:bg-gray-800' : 'text-gray-600 dark:text-gray-400',
    slate: isBg ? 'bg-slate-100 dark:bg-slate-900/30' : 'text-slate-600 dark:text-slate-400',
  };
  return colors[color as keyof typeof colors] || colors.gray;
};

// Categorize an email based on subject and sender
function categorizeEmail(email: { subject: string; sender: string; snippet?: string }): EmailGroup {
  const text = `${email.subject} ${email.sender} ${email.snippet || ''}`.toLowerCase();

  for (const group of EMAIL_GROUPS) {
    // Skip 'other' group for keyword matching
    if (group.id === 'other') continue;
    if (group.keywords.some(keyword => text.includes(keyword))) {
      return group.id;
    }
  }

  // Default to 'other' if no match found
  return 'other';
}

interface SmartTriageProps {
  onAction?: (action: string, emailIds: string[]) => void;
  onEmailSelect?: (emailId: string) => void;
}

export const SmartTriage: React.FC<SmartTriageProps> = ({ onAction, onEmailSelect }) => {
  const {
    emails,
    bulkArchive,
    bulkDelete,
    bulkSave,
    selectedEmailIds,
    selectMultipleEmails,
    clearSelection,
    selectEmail,
  } = useEmailStore();

  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<'archive' | 'save' | 'delete' | null>(null);
  const [excludedEmails, setExcludedEmails] = useState<Set<string>>(new Set());

  const toggleExcludeEmail = (emailId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExcludedEmails(prev => {
      const newSet = new Set(prev);
      if (newSet.has(emailId)) {
        newSet.delete(emailId);
      } else {
        newSet.add(emailId);
      }
      return newSet;
    });
  };

  const handleGroupClick = (groupId: string) => {
    if (expandedGroupId === groupId) {
      setExpandedGroupId(null);
      setPendingAction(null);
      setExcludedEmails(new Set());
    } else {
      setExpandedGroupId(groupId);
      setPendingAction(null);
      setExcludedEmails(new Set());
    }
  };

  const handleGroupActionClick = (groupId: string, action: 'archive' | 'save' | 'delete', e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedGroupId(groupId);
    setPendingAction(action);
    setExcludedEmails(new Set());
  };

  const executeGroupAction = async (groupEmails: typeof emails, action: 'archive' | 'delete' | 'save') => {
    const emailIds = groupEmails.filter(e => !excludedEmails.has(e.id)).map(e => e.id);

    if (emailIds.length === 0) {
      setExpandedGroupId(null);
      setPendingAction(null);
      setExcludedEmails(new Set());
      return;
    }

    // Select all emails in the group (except excluded)
    selectMultipleEmails(emailIds);

    // Perform the action
    switch (action) {
      case 'archive':
        await bulkArchive(emailIds);
        break;
      case 'delete':
        await bulkDelete(emailIds);
        break;
      case 'save':
        bulkSave(emailIds);
        break;
    }

    clearSelection();
    setExpandedGroupId(null);
    setPendingAction(null);
    setExcludedEmails(new Set());
  };

  const cancelGroupAction = () => {
    setExpandedGroupId(null);
    setPendingAction(null);
    setExcludedEmails(new Set());
  };

  const handleEmailClick = (emailId: string, e: React.MouseEvent) => {
    // Only select the email if not in pending action mode (when clicking checkboxes)
    if (pendingAction) {
      e.stopPropagation();
      return;
    }

    // Stop the click from bubbling up to the group container
    e.stopPropagation();

    // Find the email and select it
    const email = emails.find(e => e.id === emailId);
    if (email) {
      selectEmail(email);
      // Notify parent component to update selected email ID
      if (onEmailSelect) {
        onEmailSelect(emailId);
      }
    }
  };
  const groupedEmails = useMemo(() => {
    const groups = new Map<EmailGroup, typeof emails>();

    emails.forEach(email => {
      // Exclude archived, deleted, and saved emails from smart triage
      if (email.status === 'Archived' || email.status === 'Deleted' || email.status === 'Saved') return;

      const category = categorizeEmail(email);
      if (!groups.has(category)) {
        groups.set(category, []);
      }
      groups.get(category)!.push(email);
    });

    return groups;
  }, [emails]);

  // Sort groups by email count (descending)
  const sortedGroups = useMemo(() => {
    return Array.from(groupedEmails.entries())
      .map(([groupId, groupEmails]) => ({
        group: EMAIL_GROUPS.find(g => g.id === groupId)!,
        emails: groupEmails,
        count: groupEmails.length,
      }))
      .filter(item => item.group && item.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [groupedEmails]);

  const totalGroupedEmails = sortedGroups.reduce((sum, g) => sum + g.count, 0);

  if (sortedGroups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <Sparkles className="w-12 h-12 text-gray-400 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
          No groups found
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Smart triage groups similar emails together for batch processing.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="pb-4 border-b border-gray-200 dark:border-gray-700">
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Quick actions for all {totalGroupedEmails} grouped emails:
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => {
              const allIds = Array.from(groupedEmails.values()).flat().map(e => e.id);
              selectMultipleEmails(allIds);
              bulkArchive(allIds);
              clearSelection();
            }}
            className="flex-1 px-3 py-2 text-sm font-medium text-green-700 bg-green-100 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-300 rounded-lg transition-colors"
          >
            Archive ({totalGroupedEmails})
          </button>
          <button
            onClick={() => {
              const allIds = Array.from(groupedEmails.values()).flat().map(e => e.id);
              selectMultipleEmails(allIds);
              bulkSave(allIds);
              clearSelection();
            }}
            className="flex-1 px-3 py-2 text-sm font-medium text-blue-700 bg-blue-100 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-300 rounded-lg transition-colors"
          >
            Save ({totalGroupedEmails})
          </button>
          <button
            onClick={() => {
              const allIds = Array.from(groupedEmails.values()).flat().map(e => e.id);
              selectMultipleEmails(allIds);
              bulkDelete(allIds);
              clearSelection();
            }}
            className="flex-1 px-3 py-2 text-sm font-medium text-red-700 bg-red-100 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-300 rounded-lg transition-colors"
          >
            Delete ({totalGroupedEmails})
          </button>
        </div>
      </div>

      {/* Groups */}
      <div className="space-y-3">
        {sortedGroups.map(({ group, emails: groupEmails, count }) => {
          const Icon = group.icon;
          const colorClasses = getColorClasses(group.color);
          const bgClasses = getColorClasses(group.color, true);
          const isExpanded = expandedGroupId === group.id;
          const includedCount = groupEmails.filter(e => !excludedEmails.has(e.id)).length;

          return (
            <div
              key={group.id}
              className={`rounded-lg border ${isExpanded ? 'border-purple-300 dark:border-purple-700' : 'border-gray-200 dark:border-gray-700'} hover:shadow-md transition-all cursor-pointer`}
              onClick={() => handleGroupClick(group.id)}
            >
              {/* Group Header - always visible */}
              <div className={`p-4 ${isExpanded ? 'pb-2' : ''}`}>
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${bgClasses}`}>
                      <Icon className={`w-5 h-5 ${colorClasses}`} />
                    </div>
                    <div>
                      <h3 className="font-medium text-gray-900 dark:text-white">
                        {group.label}
                      </h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {group.description}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`text-lg font-semibold ${colorClasses}`}>
                      {isExpanded && pendingAction ? `${includedCount}/${count}` : count}
                    </div>
                    {isExpanded && !pendingAction && (
                      <ChevronUp className="w-5 h-5 text-gray-400" />
                    )}
                    {!isExpanded && (
                      <ChevronDown className="w-5 h-5 text-gray-400" />
                    )}
                  </div>
                </div>

                {!isExpanded ? (
                  <>
                    {/* Email Previews (first 3) - collapsed state */}
                    <div className="mb-3 space-y-2">
                      {groupEmails.slice(0, 3).map((email, idx) => (
                        <div
                          key={email.id}
                          className="text-xs text-gray-600 dark:text-gray-400 truncate"
                        >
                          <span className="font-medium">{email.sender.split('<')[0]?.trim() || email.sender}</span>
                          <span className="mx-1">•</span>
                          <span className="truncate">{email.subject}</span>
                        </div>
                      ))}
                      {count > 3 && (
                        <div className="text-xs text-gray-400 dark:text-gray-500">
                          +{count - 3} more...
                        </div>
                      )}
                    </div>

                    {/* Action Buttons - collapsed state */}
                    <div className="flex w-full items-center justify-center gap-3">
                      <button
                        onClick={(e) => handleGroupActionClick(group.id, 'archive', e)}
                        className={`w-8 h-8 rounded-lg transition-colors flex items-center justify-center ${
                          group.suggestedAction === 'archive'
                            ? 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-300'
                            : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                        }`}
                        title="Archive all"
                      >
                        <Archive className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => handleGroupActionClick(group.id, 'save', e)}
                        className={`w-8 h-8 rounded-lg transition-colors flex items-center justify-center ${
                          group.suggestedAction === 'save'
                            ? 'bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-300'
                            : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                        }`}
                        title="Save all"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => handleGroupActionClick(group.id, 'delete', e)}
                        className={`w-8 h-8 rounded-lg transition-colors flex items-center justify-center ${
                          group.suggestedAction === 'delete'
                            ? 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-300'
                            : 'text-gray-500 dark:text-gray-400 hover:bg-red-50 dark:hover:bg-red-900/20'
                        }`}
                        title="Delete all"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    {pendingAction ? (
                      <>
                        {/* Action Selected - show checkboxes */}
                        <div className="space-y-2 mb-3">
                          {groupEmails.map((email) => {
                            const isExcluded = excludedEmails.has(email.id);
                            return (
                              <div
                                key={email.id}
                                onClick={(e) => toggleExcludeEmail(email.id, e)}
                                className={`flex items-start gap-2 p-2 rounded-lg cursor-pointer transition-colors ${
                                  isExcluded
                                    ? 'bg-gray-100 dark:bg-gray-800 opacity-50'
                                    : 'bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800'
                                }`}
                              >
                                <div className={`flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center mt-0.5 ${
                                  isExcluded
                                    ? 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700'
                                    : `border-${pendingAction === 'archive' ? 'green' : pendingAction === 'save' ? 'blue' : 'red'}-500 bg-${
                                        pendingAction === 'archive' ? 'green' : pendingAction === 'save' ? 'blue' : 'red'
                                      }-100 dark:bg-${
                                        pendingAction === 'archive' ? 'green' : pendingAction === 'save' ? 'blue' : 'red'
                                      }-900/30`
                                }`}>
                                  {!isExcluded && <Check className={`w-3 h-3 text-${
                                    pendingAction === 'archive' ? 'green' : pendingAction === 'save' ? 'blue' : 'red'
                                  }-600 dark:text-${
                                    pendingAction === 'archive' ? 'green' : pendingAction === 'save' ? 'blue' : 'red'
                                  }-400`} />}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs font-medium text-gray-900 dark:text-white truncate">
                                    {email.sender.split('<')[0]?.trim() || email.sender}
                                  </div>
                                  <div className="text-xs text-gray-600 dark:text-gray-400 truncate">
                                    {email.subject}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Confirm/Cancel Buttons */}
                        <div className="flex items-center gap-2">
                          <button
                            onClick={(e) => { e.stopPropagation(); executeGroupAction(groupEmails, pendingAction!); }}
                            className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                              pendingAction === 'archive'
                                ? 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-300'
                                : pendingAction === 'save'
                                ? 'bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-300'
                                : 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-300'
                            }`}
                          >
                            Confirm {includedCount} {pendingAction}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); cancelGroupAction(); }}
                            className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        {/* Just expanded - show email list with action buttons */}
                        <div className="space-y-2 mb-3">
                          {groupEmails.map((email) => (
                            <div
                              key={email.id}
                              onClick={(e) => handleEmailClick(email.id, e)}
                              className="flex items-start gap-2 p-2 rounded-lg bg-gray-50 dark:bg-gray-800/50 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                            >
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-medium text-gray-900 dark:text-white truncate">
                                  {email.sender.split('<')[0]?.trim() || email.sender}
                                </div>
                                <div className="text-xs text-gray-600 dark:text-gray-400 truncate">
                                  {email.subject}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Action Buttons */}
                        <div className="flex w-full items-center justify-center gap-3">
                          <button
                            onClick={(e) => handleGroupActionClick(group.id, 'archive', e)}
                            className={`w-8 h-8 rounded-lg transition-colors flex items-center justify-center ${
                              group.suggestedAction === 'archive'
                                ? 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-300'
                                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                            }`}
                            title="Archive all"
                          >
                            <Archive className="w-4 h-4" />
                          </button>
                          <button
                            onClick={(e) => handleGroupActionClick(group.id, 'save', e)}
                            className={`w-8 h-8 rounded-lg transition-colors flex items-center justify-center ${
                              group.suggestedAction === 'save'
                                ? 'bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-300'
                                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                            }`}
                            title="Save all"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={(e) => handleGroupActionClick(group.id, 'delete', e)}
                            className={`w-8 h-8 rounded-lg transition-colors flex items-center justify-center ${
                              group.suggestedAction === 'delete'
                                ? 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-300'
                                : 'text-gray-500 dark:text-gray-400 hover:bg-red-50 dark:hover:bg-red-900/20'
                            }`}
                            title="Delete all"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
