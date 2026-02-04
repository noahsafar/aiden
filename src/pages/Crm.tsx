import React, { useEffect, useState } from 'react';
import { useCrmStore, Contact } from '@/stores/crmStore';
import {
  Users,
  Network,
  TrendingUp,
  Clock,
  Star,
  AlertCircle,
  RefreshCw,
  Search,
  Filter,
  ArrowLeft,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { ContactList } from '@/components/crm/ContactList';
import { ContactProfile } from '@/components/crm/ContactProfile';
import { EmailHeatmap } from '@/components/crm/EmailHeatmap';
import { ResponseTimeAnalytics } from '@/components/crm/ResponseTimeAnalytics';
import { NetworkGraph } from '@/components/crm/NetworkGraph';
import { StaleContacts } from '@/components/crm/StaleContacts';
import { Button } from '@/components/ui/Button';

type CrmView = 'all' | 'top' | 'stale' | 'heatmap' | 'response' | 'network' | 'profile';

export const Crm: React.FC = () => {
  const {
    contacts,
    selectedContact,
    isLoading,
    hasExtractedContacts,
    extractContacts,
    fetchContacts,
    fetchTopContacts,
    fetchStaleContacts,
    fetchNetworkData,
    setSelectedContact,
    refreshAll,
  } = useCrmStore();

  const [currentView, setCurrentView] = useState<CrmView>('all');
  const [previousView, setPreviousView] = useState<CrmView>('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!hasExtractedContacts) {
      extractContacts();
    } else {
      fetchContacts();
    }
  }, [hasExtractedContacts]);

  const handleRefresh = async () => {
    await refreshAll();
  };

  const handleContactClick = (contact: Contact) => {
    setPreviousView(currentView);
    setSelectedContact(contact);
    setCurrentView('profile');
  };

  const handleBack = () => {
    setCurrentView(previousView);
  };

  const filteredContacts = contacts.filter(contact => {
    const query = searchQuery.toLowerCase();
    return (
      contact.email_address.toLowerCase().includes(query) ||
      contact.name?.toLowerCase().includes(query) ||
      contact.domain?.toLowerCase().includes(query)
    );
  });

  const views = [
    { id: 'all' as const, label: 'All Contacts', icon: Users },
    { id: 'top' as const, label: 'Top Contacts', icon: Star },
    { id: 'stale' as const, label: 'Stale Contacts', icon: Clock },
    { id: 'heatmap' as const, label: 'Email Heatmap', icon: TrendingUp },
    { id: 'response' as const, label: 'Response Time', icon: Clock },
    { id: 'network' as const, label: 'Network Graph', icon: Network },
  ];

  return (
    <div className="h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="h-14 bg-surface border-b border-border flex items-center justify-between px-4 flex-shrink-0">
        <div className="flex items-center gap-4">
          <Link to="/dashboard">
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary-500" />
            <h1 className="text-lg font-bold text-gray-900 dark:text-white">Relationship Intelligence</h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={isLoading}
            className="h-8"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar - View Navigation */}
        <div className="w-56 bg-gray-50 dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex-shrink-0">
          <div className="p-3">
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search contacts..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>

            <nav className="space-y-1">
              {views.map((view) => {
                const Icon = view.icon;
                const isActive = currentView === view.id;

                return (
                  <button
                    key={view.id}
                    onClick={() => setCurrentView(view.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                      isActive
                        ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                  >
                    <Icon className="h-4 w-4 flex-shrink-0" />
                    <span>{view.label}</span>
                  </button>
                );
              })}
            </nav>

            {/* Quick Stats */}
            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">Quick Stats</h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">Total Contacts</span>
                  <span className="font-medium text-gray-900 dark:text-white">{contacts.length}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">VIP Contacts</span>
                  <span className="font-medium text-purple-600">
                    {contacts.filter(c => c.is_vip).length}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">Stale (&gt;30d)</span>
                  <span className="font-medium text-orange-600">
                    {contacts.filter(c => c.days_since_contact && c.days_since_contact > 30).length}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto bg-white dark:bg-gray-900">
          {currentView === 'all' && (
            <ContactList contacts={filteredContacts} onContactClick={handleContactClick} />
          )}

          {currentView === 'top' && (
            <>
              <div className="px-6 pt-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">Top Contacts</h2>
                  <span className="text-sm text-gray-500">{contacts.filter(c => c.relationship_score > 50).slice(0, 20).length} contacts</span>
                </div>
                <p className="text-gray-600 dark:text-gray-400 mb-6">
                  Your most important relationships based on email frequency, recency, and response patterns.
                </p>
              </div>
              <ContactList
                contacts={contacts.filter(c => c.relationship_score > 50).slice(0, 20)}
                onContactClick={handleContactClick}
                showRank
                hideHeader
              />
            </>
          )}

          {currentView === 'stale' && (
            <StaleContacts onContactClick={handleContactClick} />
          )}

          {currentView === 'heatmap' && (
            <EmailHeatmap />
          )}

          {currentView === 'response' && (
            <ResponseTimeAnalytics />
          )}

          {currentView === 'network' && (
            <NetworkGraph />
          )}

          {currentView === 'profile' && selectedContact && (
            <ContactProfile
              contact={selectedContact}
              onBack={handleBack}
            />
          )}
        </div>
      </div>
    </div>
  );
};
