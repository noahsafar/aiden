import React, { useEffect, useState } from 'react';
import { useCrmStore, Contact } from '@/stores/crmStore';
import {
  Clock,
  AlertCircle,
  Mail,
  Calendar,
  Send,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface StaleContactsProps {
  onContactClick: (contact: Contact) => void;
}

export const StaleContacts: React.FC<StaleContactsProps> = ({ onContactClick }) => {
  const { staleContacts, fetchStaleContacts, contacts } = useCrmStore();
  const [daysThreshold, setDaysThreshold] = useState(30);

  useEffect(() => {
    fetchStaleContacts(daysThreshold);
  }, [daysThreshold]);

  // Filter contacts by threshold locally
  const filteredStaleContacts = contacts.filter(
    c => c.days_since_contact && c.days_since_contact > daysThreshold
  ).sort((a, b) => (b.days_since_contact || 0) - (a.days_since_contact || 0));

  const getUrgencyLevel = (days?: number) => {
    if (!days) return { level: 'none', color: 'text-gray-600', bg: 'bg-gray-100 dark:bg-gray-900/30' };
    if (days > 90) return { level: 'critical', color: 'text-red-600', bg: 'bg-red-100 dark:bg-red-900/30' };
    if (days > 60) return { level: 'high', color: 'text-orange-600', bg: 'bg-orange-100 dark:bg-orange-900/30' };
    if (days > 30) return { level: 'medium', color: 'text-yellow-600', bg: 'bg-yellow-100 dark:bg-yellow-900/30' };
    return { level: 'low', color: 'text-blue-600', bg: 'bg-blue-100 dark:bg-blue-900/30' };
  };

  const getUrgencyMessage = (days?: number, name?: string) => {
    if (!days) return 'No recent contact';
    if (days > 365) return `You haven't talked to ${name || 'them'} in over a year!`;
    if (days > 180) return `Over 6 months since last contact with ${name || 'them'}.`;
    if (days > 90) return `It's been ${Math.round(days / 30)} months since you last heard from ${name || 'them'}.`;
    if (days > 30) return `${name || 'They'} might appreciate a check-in.`;
    return '';
  };

  const getFollowUpSuggestions = (contact: Contact) => {
    const suggestions = [];

    if (contact.category === 'Client') {
      suggestions.push('Ask about their latest projects', 'Share relevant industry updates', 'Schedule a quarterly check-in');
    } else if (contact.category === 'Colleague') {
      suggestions.push('Share an interesting article', 'Ask about their current work', 'Suggest a coffee chat');
    } else if (contact.category === 'Friend') {
      suggestions.push('Share a personal update', 'Ask about their family', 'Plan a get-together');
    } else {
      suggestions.push('Send a friendly hello', 'Share something relevant', 'Ask how they\'re doing');
    }

    return suggestions;
  };

  const categories = ['Colleague', 'Client', 'Vendor', 'Friend', 'Family'] as const;

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Stale Contacts</h2>
        <p className="text-gray-600 dark:text-gray-400">
          Reconnect with contacts you haven't emailed in a while. Nurturing relationships is key to maintaining a strong network.
        </p>
      </div>

      {/* Threshold Filter */}
      <div className="mb-6 flex items-center gap-4">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Show contacts not contacted in:
        </label>
        <div className="flex gap-2">
          {[30, 60, 90, 180].map(days => (
            <button
              key={days}
              onClick={() => setDaysThreshold(days)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                daysThreshold === days
                  ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                  : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              {days < 60 ? `${days} days` : `${Math.round(days / 30)} months`}
            </button>
          ))}
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {categories.map(category => {
          const categoryStale = filteredStaleContacts.filter(c => c.category === category);
          return (
            <div key={category} className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {categoryStale.length}
              </div>
              <div className="text-sm text-gray-500">{category}s</div>
            </div>
          );
        })}
      </div>

      {/* Stale Contacts List */}
      {filteredStaleContacts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Clock className="h-12 w-12 text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No stale contacts</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            You've been good at staying in touch! Try increasing the threshold.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredStaleContacts.map(contact => {
            const urgency = getUrgencyLevel(contact.days_since_contact);
            const followUpSuggestions = getFollowUpSuggestions(contact);

            return (
              <div
                key={contact.id}
                onClick={() => onContactClick(contact)}
                className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors cursor-pointer"
              >
                <div className="flex items-start gap-4">
                  {/* Avatar */}
                  <div className="w-12 h-12 rounded-full bg-gray-400 flex items-center justify-center text-white font-bold flex-shrink-0">
                    {contact.name?.charAt(0).toUpperCase() || contact.email_address.charAt(0).toUpperCase()}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-gray-900 dark:text-white">
                        {contact.name || contact.email_address.split('@')[0]}
                      </h3>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${urgency.bg} ${urgency.color}`}>
                        {urgency.level === 'critical' && 'Critical'}
                        {urgency.level === 'high' && 'High Priority'}
                        {urgency.level === 'medium' && 'Medium'}
                        {urgency.level === 'low' && 'Low'}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">{contact.email_address}</p>

                    {/* Last contact info */}
                    <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400 mb-3">
                      <div className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {contact.last_contacted
                          ? formatDistanceToNow(new Date(contact.last_contacted), { addSuffix: true })
                          : 'Unknown'}
                      </div>
                      <div className="flex items-center gap-1">
                        <Mail className="h-3 w-3" />
                        {contact.total_emails_sent + contact.total_emails_received} emails total
                      </div>
                    </div>

                    {/* Message */}
                    {contact.days_since_contact && contact.days_since_contact > 30 && (
                      <div className="flex items-start gap-2 p-2 bg-orange-50 dark:bg-orange-900/20 rounded-lg mb-3">
                        <AlertCircle className="h-4 w-4 text-orange-600 mt-0.5 flex-shrink-0" />
                        <p className="text-sm text-orange-800 dark:text-orange-300">
                          {getUrgencyMessage(contact.days_since_contact, contact.name)}
                        </p>
                      </div>
                    )}

                    {/* Follow-up suggestions */}
                    <div className="mb-3">
                      <p className="text-xs text-gray-500 mb-1">Follow-up ideas:</p>
                      <div className="flex flex-wrap gap-1">
                        {followUpSuggestions.map((suggestion, i) => (
                          <span
                            key={i}
                            className="px-2 py-0.5 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded text-xs"
                          >
                            {suggestion}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => e.stopPropagation()}
                        className="px-3 py-1.5 bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors flex items-center gap-1"
                      >
                        <Send className="h-3 w-3" />
                        Compose Email
                      </button>
                    </div>
                  </div>

                  {/* Days indicator */}
                  <div className="text-center flex-shrink-0">
                    <div className={`text-3xl font-bold ${urgency.color}`}>
                      {Math.round(contact.days_since_contact || 0)}
                    </div>
                    <div className="text-xs text-gray-500">days</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
