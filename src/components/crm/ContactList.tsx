import React from 'react';
import { Contact } from '@/stores/crmStore';
import { Star, Mail, Clock, TrendingUp, Briefcase, User, Building2, Tag } from 'lucide-react';

interface ContactListProps {
  contacts: Contact[];
  onContactClick: (contact: Contact) => void;
  showRank?: boolean;
}

const categoryIcons = {
  Colleague: Briefcase,
  Client: Building2,
  Vendor: Tag,
  Friend: User,
  Family: User,
  Other: User,
};

const categoryColors = {
  Colleague: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  Client: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  Vendor: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  Friend: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300',
  Family: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  Other: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
};

function getRelationshipScoreColor(score: number): string {
  if (score >= 80) return 'text-green-600';
  if (score >= 60) return 'text-yellow-600';
  if (score >= 40) return 'text-orange-600';
  return 'text-gray-500';
}

function getRelationshipScoreLabel(score: number): string {
  if (score >= 80) return 'Strong';
  if (score >= 60) return 'Good';
  if (score >= 40) return 'Moderate';
  return 'Weak';
}

function formatDaysSinceContact(days?: number): string {
  if (days === undefined) return 'Unknown';
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}

export const ContactList: React.FC<ContactListProps> = ({ contacts, onContactClick, showRank = false }) => {
  if (contacts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-12 text-center">
        <Mail className="h-12 w-12 text-gray-400 mb-4" />
        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No contacts found</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Try adjusting your search or check back later.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6">
      {!showRank && (
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">All Contacts</h2>
          <span className="text-sm text-gray-500">{contacts.length} contacts</span>
        </div>
      )}

      <div className="space-y-2">
        {contacts.map((contact, index) => {
          const CategoryIcon = categoryIcons[contact.category];
          const scoreColor = getRelationshipScoreColor(contact.relationship_score);

          return (
            <button
              key={contact.id}
              onClick={() => onContactClick(contact)}
              className="w-full flex items-center gap-4 p-4 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-colors text-left"
            >
              {/* Rank or Avatar */}
              <div className="flex-shrink-0">
                {showRank ? (
                  <div className="w-10 h-10 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                    <span className="text-sm font-bold text-purple-700 dark:text-purple-300">
                      #{index + 1}
                    </span>
                  </div>
                ) : (
                  <div className="w-10 h-10 rounded-full bg-gray-400 flex items-center justify-center text-white font-semibold">
                    {contact.name?.charAt(0).toUpperCase() || contact.email_address.charAt(0).toUpperCase()}
                  </div>
                )}
              </div>

              {/* Contact Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900 dark:text-white truncate">
                    {contact.name || contact.email_address.split('@')[0]}
                  </span>
                  {contact.is_vip && (
                    <Star className="h-4 w-4 text-yellow-500 fill-yellow-500 flex-shrink-0" />
                  )}
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                  <Mail className="h-3 w-3" />
                  <span className="truncate">{contact.email_address}</span>
                </div>
                <div className="flex items-center gap-3 mt-1">
                  <span className={`text-xs px-2 py-0.5 rounded-full flex items-center gap-1 ${categoryColors[contact.category]}`}>
                    <CategoryIcon className="h-3 w-3" />
                    {contact.category}
                  </span>
                  <span className="text-xs text-gray-500 flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatDaysSinceContact(contact.days_since_contact)}
                  </span>
                </div>
              </div>

              {/* Stats */}
              <div className="flex-shrink-0 flex items-center gap-4">
                <div className="text-right">
                  <div className={`text-lg font-bold ${scoreColor}`}>
                    {Math.round(contact.relationship_score)}
                  </div>
                  <div className="text-xs text-gray-500">{getRelationshipScoreLabel(contact.relationship_score)}</div>
                </div>
                <div className="text-right text-sm text-gray-500">
                  <div>{contact.total_emails_sent + contact.total_emails_received} emails</div>
                  <TrendingUp className="h-4 w-4 inline ml-1" />
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
