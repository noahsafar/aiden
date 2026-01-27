import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Users,
  MessageSquare,
  Clock,
  FileText,
  CheckCircle,
  XCircle,
  Bell,
  Star,
  TrendingUp,
  AlertCircle,
  Loader2,
  Plus,
  Search,
  Filter,
  ChevronRight,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import logo from '/aiden-logo.png';
import { LogOut } from 'lucide-react';
import {
  fetchContacts,
  fetchThreads,
  fetchFollowUpReminders,
  fetchReminderSuggestions,
  fetchEmailTemplates,
  fetchSuggestedActions,
  fetchThreadHealthSummary,
  fetchAllContactInsights,
  type Contact,
  type Thread,
  type FollowUpReminder,
  type EmailTemplate,
  type SuggestedAction,
  type ThreadHealthSummary,
  type ContactInsights,
  type ReminderSuggestion,
} from '@/api/crm';

type TabId = 'overview' | 'contacts' | 'threads' | 'reminders' | 'templates';

interface Tab {
  id: TabId;
  label: string;
  icon: React.ElementType;
}

const tabs: Tab[] = [
  { id: 'overview', label: 'Overview', icon: TrendingUp },
  { id: 'contacts', label: 'Contacts', icon: Users },
  { id: 'threads', label: 'Threads', icon: MessageSquare },
  { id: 'reminders', label: 'Reminders', icon: Bell },
  { id: 'templates', label: 'Templates', icon: FileText },
];

export function CRM() {
  const navigate = useNavigate();
  const { signOut, user } = useAuthStore();
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [loading, setLoading] = useState(true);

  // Overview data
  const [healthSummary, setHealthSummary] = useState<ThreadHealthSummary | null>(null);
  const [reminderSuggestions, setReminderSuggestions] = useState<ReminderSuggestion[]>([]);
  const [suggestedActions, setSuggestedActions] = useState<SuggestedAction[]>([]);

  // Contacts data
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactInsights, setContactInsights] = useState<ContactInsights[]>([]);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);

  // Threads data
  const [threads, setThreads] = useState<Thread[]>([]);
  const [threadFilter, setThreadFilter] = useState<string | null>(null);

  // Reminders data
  const [reminders, setReminders] = useState<FollowUpReminder[]>([]);

  // Templates data
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);

  useEffect(() => {
    loadAllData();
  }, []);

  const loadAllData = async () => {
    setLoading(true);
    try {
      const [health, suggestions, actions, insightsData] = await Promise.all([
        fetchThreadHealthSummary(),
        fetchReminderSuggestions(),
        fetchSuggestedActions(),
        fetchAllContactInsights(),
      ]);

      setHealthSummary(health);
      setReminderSuggestions(suggestions);
      setSuggestedActions(actions);
      setContactInsights(insightsData);
    } catch (error) {
      console.error('Failed to load CRM data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadContacts = async () => {
    const data = await fetchContacts();
    setContacts(data);
  };

  const loadThreads = async (status?: string) => {
    const data = await fetchThreads(status);
    setThreads(data);
  };

  const loadReminders = async () => {
    const data = await fetchFollowUpReminders();
    setReminders(data);
  };

  const loadTemplates = async () => {
    const data = await fetchEmailTemplates();
    setTemplates(data);
  };

  useEffect(() => {
    switch (activeTab) {
      case 'contacts':
        loadContacts();
        break;
      case 'threads':
        loadThreads(threadFilter || undefined);
        break;
      case 'reminders':
        loadReminders();
        break;
      case 'templates':
        loadTemplates();
        break;
    }
  }, [activeTab, threadFilter]);

  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  };

  const getHealthColor = (score: number) => {
    if (score >= 80) return 'text-green-600';
    if (score >= 50) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getHealthBgColor = (score: number) => {
    if (score >= 80) return 'bg-green-100 dark:bg-green-900/30';
    if (score >= 50) return 'bg-yellow-100 dark:bg-yellow-900/30';
    return 'bg-red-100 dark:bg-red-900/30';
  };

  const renderOverview = () => (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-surface border-border rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted">Total Threads</p>
              <p className="text-3xl font-bold text-foreground mt-1">
                {healthSummary?.total_threads || 0}
              </p>
            </div>
            <div className="h-12 w-12 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <MessageSquare className="h-6 w-6 text-blue-600" />
            </div>
          </div>
        </div>

        <div className="bg-surface border-border rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted">Awaiting Reply</p>
              <p className="text-3xl font-bold text-foreground mt-1">
                {healthSummary?.awaiting_reply_threads || 0}
              </p>
            </div>
            <div className="h-12 w-12 rounded-full bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center">
              <Clock className="h-6 w-6 text-yellow-600" />
            </div>
          </div>
        </div>

        <div className="bg-surface border-border rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted">Stale Threads</p>
              <p className="text-3xl font-bold text-foreground mt-1">
                {healthSummary?.stale_threads || 0}
              </p>
            </div>
            <div className="h-12 w-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <AlertCircle className="h-6 w-6 text-red-600" />
            </div>
          </div>
        </div>

        <div className="bg-surface border-border rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted">Avg Health Score</p>
              <p className="text-3xl font-bold text-foreground mt-1">
                {Math.round(healthSummary?.avg_health_score || 0)}
              </p>
            </div>
            <div className="h-12 w-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <TrendingUp className="h-6 w-6 text-green-600" />
            </div>
          </div>
        </div>
      </div>

      {/* Suggested Actions */}
      {suggestedActions.length > 0 && (
        <div className="bg-surface border-border rounded-xl p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground mb-4">Suggested Actions</h2>
          <div className="space-y-3">
            {suggestedActions.slice(0, 5).map((action) => (
              <div
                key={action.id}
                className="flex items-start justify-between p-4 bg-background rounded-lg border border-border"
              >
                <div className="flex-1">
                  <p className="text-foreground font-medium">{action.suggestion}</p>
                  <p className="text-sm text-muted mt-1">Priority: {action.priority}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {/* TODO: Implement action */}}
                    className="px-3 py-1.5 bg-primary text-white rounded-lg text-sm hover:bg-primary/90 transition-colors"
                  >
                    Do It
                  </button>
                  <button
                    onClick={() => {/* TODO: Dismiss action */}}
                    className="px-3 py-1.5 text-muted hover:text-foreground transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reminder Suggestions */}
      {reminderSuggestions.length > 0 && (
        <div className="bg-surface border-border rounded-xl p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground mb-4">Follow-Up Suggestions</h2>
          <div className="space-y-3">
            {reminderSuggestions.slice(0, 5).map((suggestion) => (
              <div
                key={suggestion.thread_id}
                className="flex items-start justify-between p-4 bg-background rounded-lg border border-border"
              >
                <div className="flex-1">
                  <p className="text-foreground font-medium">{suggestion.subject}</p>
                  <p className="text-sm text-muted mt-1">
                    No response for {suggestion.days_since_last_contact} days
                  </p>
                </div>
                <button className="text-primary hover:text-primary/80 text-sm font-medium transition-colors">
                  Send Reminder
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Threads by Health */}
      {healthSummary?.threads_by_health && healthSummary.threads_by_health.length > 0 && (
        <div className="bg-surface border-border rounded-xl p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground mb-4">Threads by Contact</h2>
          <div className="space-y-3">
            {healthSummary.threads_by_health.map((item) => (
              <div
                key={item.contact_email}
                className="flex items-center justify-between p-4 bg-background rounded-lg border border-border"
              >
                <div className="flex-1">
                  <p className="text-foreground font-medium">
                    {item.contact_name || item.contact_email}
                  </p>
                  <p className="text-sm text-muted mt-1">
                    {item.thread_count} threads • {item.awaiting_count} awaiting reply
                  </p>
                </div>
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${getHealthBgColor(item.avg_health_score)}`}>
                  <span className={`text-sm font-semibold ${getHealthColor(item.avg_health_score)}`}>
                    {item.avg_health_score}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const renderContacts = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-foreground">Contacts</h2>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted" />
            <input
              type="text"
              placeholder="Search contacts..."
              className="pl-10 pr-4 py-2 bg-background border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {contacts.map((contact) => (
          <div
            key={contact.id}
            className="bg-surface border-border rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
            onClick={() => setSelectedContact(contact)}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-foreground">
                    {contact.display_name || contact.email_address}
                  </h3>
                  {contact.is_vip && (
                    <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                  )}
                </div>
                <p className="text-sm text-muted mt-0.5">{contact.email_address}</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted">Emails Sent</p>
                <p className="font-medium text-foreground">{contact.total_emails_sent}</p>
              </div>
              <div>
                <p className="text-muted">Emails Received</p>
                <p className="font-medium text-foreground">{contact.total_emails_received}</p>
              </div>
              <div>
                <p className="text-muted">Response Rate</p>
                <p className="font-medium text-foreground">
                  {contact.response_rate ? `${Math.round(contact.response_rate * 100)}%` : 'N/A'}
                </p>
              </div>
              <div>
                <p className="text-muted">Avg Response</p>
                <p className="font-medium text-foreground">
                  {contact.avg_response_time_minutes
                    ? `${Math.round(contact.avg_response_time_minutes)}m`
                    : 'N/A'}
                </p>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <span className="text-xs text-muted">
                Last contact: {contact.last_received_from_at ? formatTimestamp(contact.last_received_from_at) : 'Never'}
              </span>
              <ChevronRight className="h-4 w-4 text-muted" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderThreads = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-foreground">Threads</h2>
        <div className="flex gap-2">
          {['all', 'active', 'awaiting_reply', 'stale'].map((filter) => (
            <button
              key={filter}
              onClick={() => setThreadFilter(filter === 'all' ? null : filter)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                threadFilter === filter || (filter === 'all' && threadFilter === null)
                  ? 'bg-primary text-white'
                  : 'bg-surface text-muted hover:text-foreground'
              }`}
            >
              {filter === 'all' ? 'All' : filter.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {threads.map((thread) => (
          <div
            key={thread.id}
            className="bg-surface border-border rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">{thread.subject}</h3>
                <p className="text-sm text-muted mt-1">
                  {thread.participants.slice(0, 3).join(', ')}
                  {thread.participants.length > 3 && ` +${thread.participants.length - 3} others`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className={`flex items-center gap-1 px-3 py-1.5 rounded-full ${getHealthBgColor(thread.health_score)}`}>
                  <span className={`text-sm font-semibold ${getHealthColor(thread.health_score)}`}>
                    {thread.health_score}
                  </span>
                </div>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <div className="flex items-center gap-4 text-sm text-muted">
                <span>{thread.total_emails} emails</span>
                <span className="capitalize">{thread.status.replace('_', ' ')}</span>
                <span>{formatTimestamp(thread.last_email_date)}</span>
              </div>
              <ChevronRight className="h-4 w-4 text-muted" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderReminders = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-foreground">Follow-Up Reminders</h2>
        <button className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
          <Plus className="h-4 w-4" />
          New Reminder
        </button>
      </div>

      <div className="space-y-3">
        {reminders.length === 0 ? (
          <div className="bg-surface border-border rounded-xl p-12 text-center">
            <Bell className="h-12 w-12 text-muted mx-auto mb-4" />
            <p className="text-muted">No pending reminders</p>
          </div>
        ) : (
          reminders.map((reminder) => (
            <div
              key={reminder.id}
              className="bg-surface border-border rounded-xl p-5 shadow-sm"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs font-medium rounded capitalize">
                      {reminder.reminder_type.replace('_', ' ')}
                    </span>
                    <span className="text-sm text-muted">
                      Due: {formatTimestamp(reminder.scheduled_for)}
                    </span>
                  </div>
                  <p className="text-foreground font-medium">{reminder.contact_email}</p>
                  {reminder.message_suggestion && (
                    <p className="text-sm text-muted mt-2 italic">
                      "{reminder.message_suggestion}"
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {/* TODO: Complete reminder */}}
                    className="p-2 text-green-600 hover:bg-green-100 dark:hover:bg-green-900/30 rounded-lg transition-colors"
                    title="Mark complete"
                  >
                    <CheckCircle className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => {/* TODO: Snooze */}}
                    className="p-2 text-yellow-600 hover:bg-yellow-100 dark:hover:bg-yellow-900/30 rounded-lg transition-colors"
                    title="Snooze"
                  >
                    <Clock className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => {/* TODO: Delete */}}
                    className="p-2 text-red-600 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                    title="Delete"
                  >
                    <XCircle className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );

  const renderTemplates = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-foreground">Email Templates</h2>
        <button className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
          <Plus className="h-4 w-4" />
          New Template
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {templates.map((template) => (
          <div
            key={template.id}
            className="bg-surface border-border rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">{template.name}</h3>
                {template.category && (
                  <span className="inline-block mt-1 px-2 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-xs rounded">
                    {template.category}
                  </span>
                )}
              </div>
              {template.is_ai_personalized && (
                <Star className="h-4 w-4 text-purple-500" />
              )}
            </div>
            <p className="text-sm text-muted mt-3 line-clamp-2">
              {template.body.substring(0, 100)}...
            </p>
            <div className="mt-4 flex items-center justify-between text-sm text-muted">
              <span>Used {template.use_count} times</span>
              <ChevronRight className="h-4 w-4" />
            </div>
          </div>
        ))}
      </div>

      {templates.length === 0 && (
        <div className="bg-surface border-border rounded-xl p-12 text-center">
          <FileText className="h-12 w-12 text-muted mx-auto mb-4" />
          <p className="text-muted mb-4">No templates yet</p>
          <button className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
            Create Your First Template
          </button>
        </div>
      )}
    </div>
  );

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 text-primary animate-spin" />
        </div>
      );
    }

    switch (activeTab) {
      case 'overview':
        return renderOverview();
      case 'contacts':
        return renderContacts();
      case 'threads':
        return renderThreads();
      case 'reminders':
        return renderReminders();
      case 'templates':
        return renderTemplates();
      default:
        return renderOverview();
    }
  };

  return (
    <div className="h-screen bg-background overflow-hidden flex flex-col">
      {/* Top Navigation Bar */}
      <div className="h-14 bg-surface border-b border-border flex items-center justify-between px-4 z-10 flex-shrink-0">
        <div className="flex items-center gap-4">
          <Link to="/dashboard">
            <button className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          </Link>
          <img src={logo} alt="Aiden Logo" className="h-8 w-8" />
          <h1 className="text-lg font-bold text-gray-900 dark:text-white">CRM</h1>
        </div>

        <div className="flex items-center gap-2">
          <Link to="/dashboard">
            <button className="px-4 py-2 text-sm text-muted hover:text-foreground transition-colors">
              Dashboard
            </button>
          </Link>
          <button
            onClick={signOut}
            className="px-4 py-2 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
          >
            Sign Out
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar Tabs */}
        <div className="w-56 bg-surface border-r border-border p-4">
          <nav className="space-y-1">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                    activeTab === tab.id
                      ? 'bg-primary text-white'
                      : 'text-muted hover:text-foreground hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6">
          {renderContent()}
        </div>
      </div>
    </div>
  );
}
