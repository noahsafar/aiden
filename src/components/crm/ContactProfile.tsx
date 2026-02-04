import React, { useEffect, useState } from 'react';
import { Contact, useCrmStore } from '@/stores/crmStore';
import {
  ArrowLeft,
  Mail,
  Clock,
  TrendingUp,
  Star,
  Edit2,
  Save,
  X,
  Briefcase,
  Building2,
  User as UserIcon,
  Tag,
  Calendar,
  MessageSquare,
  Send,
  Reply,
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from 'recharts';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/Button';

interface ContactProfileProps {
  contact: Contact;
  onBack: () => void;
}

const categoryIcons = {
  Colleague: Briefcase,
  Client: Building2,
  Vendor: Tag,
  Friend: UserIcon,
  Family: UserIcon,
  Other: UserIcon,
};

export const ContactProfile: React.FC<ContactProfileProps> = ({ contact, onBack }) => {
  const {
    analytics,
    fetchContactAnalytics,
    updateContactVIP,
    updateContactNotes,
  } = useCrmStore();

  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [notesText, setNotesText] = useState(contact.notes || '');

  useEffect(() => {
    fetchContactAnalytics(contact.id);
  }, [contact.id]);

  const handleToggleVIP = () => {
    updateContactVIP(contact.id, !contact.is_vip);
  };

  const handleSaveNotes = () => {
    updateContactNotes(contact.id, notesText);
    setIsEditingNotes(false);
  };

  const CategoryIcon = categoryIcons[contact.category];

  // Prepare chart data
  const chartData = analytics?.interaction_frequency
    ?.slice(0, 30)
    .reverse()
    .map(d => ({
      date: new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      sent: d.sent,
      received: d.received,
      total: d.count,
    })) || [];

  const responseTimeDistribution = analytics?.response_times.reduce((acc, time) => {
    const bucket = time < 60 ? '< 1h' :
                   time < 240 ? '< 4h' :
                   time < 1440 ? '< 1d' :
                   time < 2880 ? '< 2d' : '2d+';
    acc[bucket] = (acc[bucket] || 0) + 1;
    return acc;
  }, {} as Record<string, number>) || {};

  const responseTimeData = Object.entries(responseTimeDistribution).map(([bucket, count]) => ({
    bucket,
    count,
  }));

  const getScoreColor = (score: number) => {
    if (score >= 80) return '#10b981';
    if (score >= 60) return '#f59e0b';
    if (score >= 40) return '#f97316';
    return '#6b7280';
  };

  return (
    <div className="h-full overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 z-10">
        <div className="p-6">
          <div className="flex items-center gap-4 mb-4">
            <button
              onClick={onBack}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
            >
              <ArrowLeft className="h-5 w-5 text-gray-600 dark:text-gray-400" />
            </button>

            {/* Avatar */}
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center text-white text-2xl font-bold">
              {contact.name?.charAt(0).toUpperCase() || contact.email_address.charAt(0).toUpperCase()}
            </div>

            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                  {contact.name || contact.email_address.split('@')[0]}
                </h1>
                <button
                  onClick={handleToggleVIP}
                  className={`p-1 rounded transition-colors ${
                    contact.is_vip
                      ? 'text-yellow-500 hover:text-yellow-600'
                      : 'text-gray-400 hover:text-yellow-500'
                  }`}
                >
                  <Star className={`h-5 w-5 ${contact.is_vip ? 'fill-yellow-500' : ''}`} />
                </button>
              </div>
              <p className="text-gray-600 dark:text-gray-400">{contact.email_address}</p>
            </div>

            {/* Relationship Score */}
            <div className="text-center">
              <div
                className="text-3xl font-bold"
                style={{ color: getScoreColor(contact.relationship_score) }}
              >
                {Math.round(contact.relationship_score)}
              </div>
              <div className="text-xs text-gray-500">Relationship Score</div>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
              <CategoryIcon className="h-4 w-4" />
              <span>{contact.category}</span>
            </div>
            {contact.domain && (
              <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                <Building2 className="h-4 w-4" />
                <span>{contact.domain}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
              <Clock className="h-4 w-4" />
              <span>
                Last contact: {contact.last_contacted
                  ? formatDistanceToNow(new Date(contact.last_contacted), { addSuffix: true })
                  : 'Unknown'}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Email Statistics */}
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {contact.total_emails_sent + contact.total_emails_received}
            </div>
            <div className="text-sm text-gray-500">Total Emails</div>
          </div>
          <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
              {contact.total_emails_received}
            </div>
            <div className="text-sm text-gray-500 flex items-center justify-center gap-1">
              <Reply className="h-3 w-3" /> Received
            </div>
          </div>
          <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">
              {contact.total_emails_sent}
            </div>
            <div className="text-sm text-gray-500 flex items-center justify-center gap-1">
              <Send className="h-3 w-3" /> Sent
            </div>
          </div>
          <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 text-center">
            <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">
              {contact.avg_response_time_minutes
                ? `${Math.round(contact.avg_response_time_minutes)}m`
                : 'N/A'}
            </div>
            <div className="text-sm text-gray-500">Avg Response</div>
          </div>
        </div>

        {/* Notes Section */}
        <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-gray-900 dark:text-white">Notes</h3>
            {!isEditingNotes ? (
              <button
                onClick={() => setIsEditingNotes(true)}
                className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
              >
                <Edit2 className="h-4 w-4 text-gray-500" />
              </button>
            ) : (
              <div className="flex gap-1">
                <button
                  onClick={handleSaveNotes}
                  className="p-1 hover:bg-green-100 dark:hover:bg-green-900/30 rounded transition-colors"
                >
                  <Save className="h-4 w-4 text-green-600" />
                </button>
                <button
                  onClick={() => {
                    setIsEditingNotes(false);
                    setNotesText(contact.notes || '');
                  }}
                  className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-colors"
                >
                  <X className="h-4 w-4 text-red-600" />
                </button>
              </div>
            )}
          </div>
          {isEditingNotes ? (
            <textarea
              value={notesText}
              onChange={(e) => setNotesText(e.target.value)}
              placeholder="Add notes about this contact..."
              className="w-full h-24 p-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          ) : (
            <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">
              {contact.notes || 'No notes yet. Click the edit icon to add notes about this contact.'}
            </p>
          )}
        </div>

        {/* Email Frequency Chart */}
        {chartData.length > 0 && (
          <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Email Frequency (Last 30 Days)</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: '#9ca3af', fontSize: 12 }}
                  stroke="#4b5563"
                />
                <YAxis tick={{ fill: '#9ca3af', fontSize: 12 }} stroke="#4b5563" />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: '8px' }}
                  itemStyle={{ color: '#fff' }}
                />
                <Bar dataKey="received" stackId="a" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="sent" stackId="a" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="flex items-center justify-center gap-6 mt-2 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded bg-blue-500" />
                <span className="text-gray-600 dark:text-gray-400">Received</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded bg-green-500" />
                <span className="text-gray-600 dark:text-gray-400">Sent</span>
              </div>
            </div>
          </div>
        )}

        {/* Response Time Distribution */}
        {responseTimeData.length > 0 && (
          <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Response Time Distribution</h3>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={responseTimeData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis type="number" tick={{ fill: '#9ca3af', fontSize: 12 }} stroke="#4b5563" />
                <YAxis type="category" dataKey="bucket" tick={{ fill: '#9ca3af', fontSize: 12 }} stroke="#4b5563" width={40} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: '8px' }}
                  itemStyle={{ color: '#fff' }}
                />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {responseTimeData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={['#10b981', '#22c55e', '#eab308', '#f97316', '#ef4444'][index % 5]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Timeline Activity */}
        {chartData.length > 0 && (
          <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Communication Timeline</h3>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: '#9ca3af', fontSize: 10 }}
                  stroke="#4b5563"
                />
                <YAxis tick={{ fill: '#9ca3af', fontSize: 12 }} stroke="#4b5563" />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: '8px' }}
                  itemStyle={{ color: '#fff' }}
                />
                <Line type="monotone" dataKey="total" stroke="#8b5cf6" strokeWidth={2} dot={{ fill: '#8b5cf6' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
};
