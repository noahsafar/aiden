import React, { useState, useEffect } from 'react';
import { useLifeStore, LifeIntelligenceItem } from '@/stores/lifeStore';
import { useEmailStore } from '@/stores/emailStore';
import { useAuthStore } from '@/stores/authStore';
import { useChatStore } from '@/stores/chatStore';
import { useNavigate } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import {
  DollarSign,
  CreditCard,
  Plane,
  Package,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  X,
  RefreshCw,
  TrendingUp,
  ArrowLeft,
  LogOut,
} from 'lucide-react';
import logo from '/aiden-logo.png';

const getColorClasses = (color: string, isBg: boolean = false) => {
  const colors: Record<string, string> = {
    emerald: isBg ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'text-emerald-600 dark:text-emerald-400',
    amber: isBg ? 'bg-amber-100 dark:bg-amber-900/30' : 'text-amber-600 dark:text-amber-400',
    blue: isBg ? 'bg-blue-100 dark:bg-blue-900/30' : 'text-blue-600 dark:text-blue-400',
    purple: isBg ? 'bg-purple-100 dark:bg-purple-900/30' : 'text-purple-600 dark:text-purple-400',
    red: isBg ? 'bg-red-100 dark:bg-red-900/30' : 'text-red-600 dark:text-red-400',
  };
  return colors[color] || colors.emerald;
};

function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  try {
    const target = new Date(dateStr);
    if (isNaN(target.getTime())) return null;
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    target.setHours(0, 0, 0, 0);
    return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  } catch {
    return null;
  }
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

function formatCurrency(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount == null) return '';
  const sym = currency === 'EUR' ? '\u20AC' : currency === 'GBP' ? '\u00A3' : '$';
  return `${sym}${amount.toFixed(2)}`;
}

interface SectionProps {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  items: LifeIntelligenceItem[];
  emptyText: string;
  renderItem: (item: LifeIntelligenceItem) => React.ReactNode;
  defaultExpanded?: boolean;
}

const Section: React.FC<SectionProps> = ({ title, icon: Icon, color, items, emptyText, renderItem, defaultExpanded = true }) => {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="mb-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full flex items-center justify-between px-4 py-2.5 rounded-lg ${getColorClasses(color, true)} transition-colors`}
      >
        <div className="flex items-center gap-2">
          <Icon className={`h-4 w-4 ${getColorClasses(color)}`} />
          <span className={`text-sm font-medium ${getColorClasses(color)}`}>{title}</span>
          <span className="text-xs text-gray-500 dark:text-gray-400">({items.length})</span>
        </div>
        {expanded ? <ChevronUp className="h-3.5 w-3.5 text-gray-400" /> : <ChevronDown className="h-3.5 w-3.5 text-gray-400" />}
      </button>
      {expanded && (
        <div className="mt-1.5 space-y-0.5">
          {items.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-gray-500 px-4 py-3">{emptyText}</p>
          ) : (
            items.map(renderItem)
          )}
        </div>
      )}
    </div>
  );
};

export const LifeIntel: React.FC = () => {
  const { signOut, user } = useAuthStore();
  const { isOpen: isChatOpen } = useChatStore();
  const { items, loadFromDisk, isLoaded, dismissItem, getSubscriptions, getBills, getTravel, getPackages, getDeadlines, getMonthlySpend } = useLifeStore();
  const emails = useEmailStore((s) => s.emails);
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoaded) loadFromDisk();
  }, [isLoaded, loadFromDisk]);

  // Also bridge email deadlines into life store on mount
  useEffect(() => {
    if (!isLoaded) return;
    const lifeState = useLifeStore.getState();
    const emailsWithDeadlines = emails.filter(
      (e) => e.deadline && !lifeState.processedEmailIds.has(e.id)
    );
    for (const email of emailsWithDeadlines) {
      lifeState.addItemsFromEmail(email.id, [{
        data_type: 'deadline',
        title: email.subject,
        date: email.deadline!,
        details: null,
      }]);
    }
  }, [isLoaded, emails]);

  const subscriptions = getSubscriptions();
  const bills = getBills();
  const travel = getTravel();
  const packages = getPackages();
  // Filter out deadlines that are more than 7 days past (stale/wrong dates)
  const allDeadlines = getDeadlines();
  const deadlines = allDeadlines.filter((d) => {
    const days = daysUntil(d.date);
    return days === null || days >= -7;
  });
  const monthlySpend = getMonthlySpend();
  const activeCount = items.filter((i) => !i.dismissed).length;

  const handleRowClick = (emailId: string) => {
    if (emailId && !emailId.startsWith('mock-')) {
      // Select the source email and switch to inbox
      import('@/stores/emailStore').then(({ useEmailStore }) => {
        useEmailStore.getState().setCurrentFilter('inbox');
        useEmailStore.getState().setSelectedEmail(emailId);
      });
    }
    navigate('/dashboard');
  };

  const handleDismiss = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    dismissItem(id);
  };

  const ItemRow: React.FC<{ item: LifeIntelligenceItem; children: React.ReactNode }> = ({ item, children }) => (
    <div
      onClick={() => handleRowClick(item.email_id)}
      className="flex items-center justify-between px-4 py-2.5 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer group transition-colors"
    >
      <div className="flex-1 min-w-0">{children}</div>
      <button
        onClick={(e) => handleDismiss(e, item.id)}
        className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-opacity"
        title="Dismiss"
      >
        <X className="h-3.5 w-3.5 text-gray-400" />
      </button>
    </div>
  );

  return (
    <div className="h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="h-14 bg-surface border-b border-border flex items-center justify-between px-4 flex-shrink-0">
        <div className="flex items-center gap-0">
          <Link to="/dashboard" className="p-2 rounded-lg hover:bg-muted transition-colors mr-2">
            <ArrowLeft className="h-4 w-4 text-muted-foreground" />
          </Link>
          <img src={logo} alt="Aiden" className="w-8 h-8" />
          <div className="flex items-center">
            <h1 className="text-lg font-semibold text-foreground leading-none">Aiden</h1>
            <span className="text-sm text-gray-500 leading-tight pt-0.5 ml-1.5">/ Life Intel</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500 hidden sm:block">
            {user ? user.email : 'Not logged in'}
          </span>
          <button
            onClick={() => signOut()}
            className="p-2 text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20 rounded-lg transition-colors"
            title="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className={`flex-1 overflow-y-auto transition-all duration-300 ease-in-out ${isChatOpen ? 'mr-[400px]' : ''}`}>
        {activeCount === 0 ? (
          <div className="h-full flex flex-col items-center justify-center p-8 text-center">
            <DollarSign className="h-12 w-12 text-gray-300 dark:text-gray-600 mb-4" />
            <h3 className="text-base font-medium text-gray-700 dark:text-gray-300 mb-1">No life data yet</h3>
            <p className="text-sm text-gray-400 dark:text-gray-500 max-w-xs">
              As Aiden processes your emails, subscriptions, bills, travel, and packages will appear here.
            </p>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto p-6">
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-1">Life Intelligence</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">Automatically extracted from your emails</p>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-4">
                <div className="flex items-center gap-1.5 mb-1">
                  <TrendingUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  <span className="text-xs text-emerald-700 dark:text-emerald-300">Monthly Spend</span>
                </div>
                <span className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">
                  {monthlySpend > 0 ? formatCurrency(monthlySpend, 'USD') : '--'}
                </span>
              </div>
              <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-4">
                <div className="flex items-center gap-1.5 mb-1">
                  <CreditCard className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  <span className="text-xs text-amber-700 dark:text-amber-300">Bills Due</span>
                </div>
                <span className="text-2xl font-bold text-amber-700 dark:text-amber-300">{bills.length}</span>
              </div>
              <div className="bg-purple-50 dark:bg-purple-900/20 rounded-xl p-4">
                <div className="flex items-center gap-1.5 mb-1">
                  <Package className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                  <span className="text-xs text-purple-700 dark:text-purple-300">Packages</span>
                </div>
                <span className="text-2xl font-bold text-purple-700 dark:text-purple-300">{packages.length}</span>
              </div>
              <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-4">
                <div className="flex items-center gap-1.5 mb-1">
                  <CalendarClock className="h-4 w-4 text-red-600 dark:text-red-400" />
                  <span className="text-xs text-red-700 dark:text-red-300">Deadlines</span>
                </div>
                <span className="text-2xl font-bold text-red-700 dark:text-red-300">{deadlines.length}</span>
              </div>
            </div>

            {/* Sections in two columns on wider screens */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6">
              <div>
                <Section
                  title="Subscriptions"
                  icon={RefreshCw}
                  color="emerald"
                  items={subscriptions}
                  emptyText="No active subscriptions detected"
                  renderItem={(item) => (
                    <ItemRow key={item.id} item={item}>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-900 dark:text-white truncate">{item.title}</span>
                        <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                          {item.amount != null && (
                            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                              {formatCurrency(item.amount, item.currency)}/{item.frequency === 'yearly' ? 'yr' : 'mo'}
                            </span>
                          )}
                        </div>
                      </div>
                      {item.date && (
                        <span className="text-xs text-gray-400">Renews {formatDate(item.date)}</span>
                      )}
                    </ItemRow>
                  )}
                />

                <Section
                  title="Bills"
                  icon={CreditCard}
                  color="amber"
                  items={[...bills].sort((a, b) => {
                    if (!a.date) return 1;
                    if (!b.date) return -1;
                    return new Date(a.date).getTime() - new Date(b.date).getTime();
                  })}
                  emptyText="No pending bills detected"
                  renderItem={(item) => {
                    const days = daysUntil(item.date);
                    const isOverdue = days !== null && days < 0;
                    return (
                      <ItemRow key={item.id} item={item}>
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-gray-900 dark:text-white truncate">{item.title}</span>
                          <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                            {isOverdue && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 font-medium">
                                Overdue
                              </span>
                            )}
                            {item.amount != null && (
                              <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                                {formatCurrency(item.amount, item.currency)}
                              </span>
                            )}
                          </div>
                        </div>
                        {item.date && (
                          <span className="text-xs text-gray-400">Due {formatDate(item.date)}</span>
                        )}
                      </ItemRow>
                    );
                  }}
                />

              </div>

              <div>
                <Section
                  title="Travel"
                  icon={Plane}
                  color="blue"
                  items={travel}
                  emptyText="No travel plans detected"
                  renderItem={(item) => (
                    <ItemRow key={item.id} item={item}>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-900 dark:text-white truncate">{item.title}</span>
                        {item.carrier && (
                          <span className="text-xs text-blue-600 dark:text-blue-400 ml-2 flex-shrink-0">{item.carrier}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {item.date && (
                          <span className="text-xs text-gray-400">
                            {formatDate(item.date)}{item.end_date ? ` - ${formatDate(item.end_date)}` : ''}
                          </span>
                        )}
                        {item.details && (
                          <span className="text-xs text-gray-400">#{item.details}</span>
                        )}
                      </div>
                    </ItemRow>
                  )}
                />

                <Section
                  title="Packages"
                  icon={Package}
                  color="purple"
                  items={packages}
                  emptyText="No packages being tracked"
                  renderItem={(item) => (
                    <ItemRow key={item.id} item={item}>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-900 dark:text-white truncate">{item.title}</span>
                        {item.carrier && (
                          <span className="text-xs text-purple-600 dark:text-purple-400 ml-2 flex-shrink-0">{item.carrier}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {item.date && <span className="text-xs text-gray-400">Delivery {formatDate(item.date)}</span>}
                        {item.tracking_number && (
                          <span className="text-xs text-gray-400 font-mono">{item.tracking_number}</span>
                        )}
                      </div>
                    </ItemRow>
                  )}
                />

                <Section
                  title="Deadlines"
                  icon={CalendarClock}
                  color="red"
                  items={[...deadlines].sort((a, b) => {
                    if (!a.date) return 1;
                    if (!b.date) return -1;
                    return new Date(a.date).getTime() - new Date(b.date).getTime();
                  })}
                  emptyText="No upcoming deadlines"
                  renderItem={(item) => {
                    const days = daysUntil(item.date);
                    const isOverdue = days !== null && days < 0;
                    const isSoon = days !== null && days >= 0 && days <= 3;
                    return (
                      <ItemRow key={item.id} item={item}>
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-gray-900 dark:text-white truncate">{item.title}</span>
                          <div className="ml-2 flex-shrink-0">
                            {days !== null && (
                              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                                isOverdue
                                  ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                                  : isSoon
                                  ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                              }`}>
                                {isOverdue ? `${Math.abs(days)}d overdue` : days === 0 ? 'Today' : `${days}d left`}
                              </span>
                            )}
                          </div>
                        </div>
                        {item.details && (
                          <span className="text-xs text-gray-400 truncate block">{item.details}</span>
                        )}
                      </ItemRow>
                    );
                  }}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
