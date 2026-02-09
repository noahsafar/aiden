import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Plus,
  Calendar as CalendarIcon,
  Clock,
  Link2,
  Trash2,
  Copy,
  Loader2,
  Check,
  X,
  Calendar,
  Mail,
  MessageSquare,
  Info,
  ArrowLeft,
  LogOut,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useChatStore } from '@/stores/chatStore';
import { invoke } from '@tauri-apps/api/core';
import { createSchedulingLink, getSchedulingLinks, deleteSchedulingLink } from '@/api/scheduling';
import type { SchedulingLink, AvailabilityConfig, DayOfWeek } from '@/types/scheduling';
import { Button } from '@/components/ui/Button';
import logo from '/aiden-logo.png';

const DAYS_OF_WEEK: { value: DayOfWeek; label: string }[] = [
  { value: 'monday', label: 'Monday' },
  { value: 'tuesday', label: 'Tuesday' },
  { value: 'wednesday', label: 'Wednesday' },
  { value: 'thursday', label: 'Thursday' },
  { value: 'friday', label: 'Friday' },
  { value: 'saturday', label: 'Saturday' },
  { value: 'sunday', label: 'Sunday' },
];

const DURATION_OPTIONS = [15, 30, 45, 60, 90];

interface AppSettings {
  timezone?: string;
}

export function Scheduling() {
  const navigate = useNavigate();
  const { signOut, user } = useAuthStore();
  const { isOpen: isChatOpen } = useChatStore();
  const [links, setLinks] = useState<SchedulingLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);
  const [timezone, setTimezone] = useState<string>('America/New_York');

  // Form state
  const [formData, setFormData] = useState({
    title: '30min Meeting',
    duration: 30,
    description: '',
    availability: {
      days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as DayOfWeek[],
      start_hour: 9,
      end_hour: 17,
      buffer_minutes: 15,
    } as AvailabilityConfig,
  });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load settings to get timezone
  useEffect(() => {
    invoke<AppSettings>('get_settings').then(settings => {
      if (settings?.timezone) {
        setTimezone(settings.timezone);
      }
    }).catch(() => {
      // Use default timezone
    });
  }, []);

  const loadLinks = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getSchedulingLinks();
      if (response.success) {
        setLinks(response.links || []);
      } else {
        setError(response.error || 'Failed to load scheduling links');
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Failed to load scheduling links';
      setError(errMsg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLinks();
  }, []);

  const handleCreateLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await createSchedulingLink({
        title: formData.title,
        duration: formData.duration,
        description: formData.description,
        timezone,
        availability: formData.availability,
      });

      if (response.success) {
        setShowCreateForm(false);
        // Reset form
        setFormData({
          title: '30min Meeting',
          duration: 30,
          description: '',
          availability: {
            days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
            start_hour: 9,
            end_hour: 17,
            buffer_minutes: 15,
          },
        });
        await loadLinks();
      } else {
        setError(response.error || 'Failed to create scheduling link');
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Failed to create scheduling link';
      setError(errMsg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteLink = async (link: SchedulingLink) => {
    if (!confirm(`Delete scheduling link "${link.title}"?`)) {
      return;
    }

    try {
      const response = await deleteSchedulingLink(link.id, link.event_id);
      if (response.success) {
        await loadLinks();
      } else {
        setError(response.error || 'Failed to delete scheduling link');
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Failed to delete scheduling link';
      setError(errMsg);
    }
  };

  const handleCopyLink = async (link: SchedulingLink) => {
    // Get the base URL from window.location
    const baseUrl = window.location.origin;
    const fullUrl = `${baseUrl}${link.public_url}`;

    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopiedLinkId(link.id);
      setTimeout(() => setCopiedLinkId(null), 2000);
    } catch (err) {
      console.error('Failed to copy link:', err);
    }
  };

  const toggleDay = (day: DayOfWeek) => {
    const days = formData.availability.days.includes(day)
      ? formData.availability.days.filter(d => d !== day)
      : [...formData.availability.days, day];

    setFormData({
      ...formData,
      availability: {
        ...formData.availability,
        days,
      },
    });
  };

  return (
    <div className="h-screen bg-background overflow-hidden flex flex-col min-w-0">
      {/* Top Navigation Bar */}
      <div className="h-14 bg-surface border-b border-border flex items-center justify-between px-4 z-10">
        <div className="flex items-center gap-0">
          <Link to="/dashboard" className="p-2 rounded-lg hover:bg-muted transition-colors mr-2">
            <ArrowLeft className="h-4 w-4 text-muted-foreground" />
          </Link>
          <img src={logo} alt="Aiden" className="w-8 h-8" />
          <div className="flex items-center">
            <h1 className="text-lg font-semibold text-foreground leading-none">Aiden</h1>
            <span className="text-sm text-gray-500 leading-tight pt-0.5 ml-1.5">/ Scheduling</span>
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
      <div className={`flex-1 overflow-auto p-6 transition-all duration-300 ease-in-out ${isChatOpen ? 'mr-[400px]' : ''}`}>
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-2xl font-bold text-foreground mb-2">Scheduling Links</h2>
                <p className="text-muted-foreground">
                  Create shareable links for others to book time with you
                </p>
              </div>
              <Button
                onClick={() => setShowCreateForm(true)}
                className="gap-2"
              >
                <Plus className="w-4 h-4" />
                New Link
              </Button>
            </div>

            {error && (
              <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}
          </div>

          {/* Create Form Modal */}
          {showCreateForm && (
            <div className="mb-8 p-6 bg-surface border border-border rounded-lg shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-foreground">Create Scheduling Link</h3>
                <button
                  onClick={() => setShowCreateForm(false)}
                  className="p-1 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleCreateLink} className="space-y-6">
                {/* Title */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Meeting Title
                  </label>
                  <input
                    type="text"
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    className="w-full px-4 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary-500"
                    placeholder="e.g., 30min Meeting, Coffee Chat"
                    required
                  />
                </div>

                {/* Duration */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Duration
                  </label>
                  <div className="flex gap-2 flex-wrap">
                    {DURATION_OPTIONS.map((duration) => (
                      <button
                        key={duration}
                        type="button"
                        onClick={() => setFormData({ ...formData, duration })}
                        className={`px-4 py-2 rounded-lg border transition-colors ${
                          formData.duration === duration
                            ? 'bg-primary-600 text-white border-primary-600'
                            : 'bg-background text-foreground border-border hover:border-primary-500'
                        }`}
                      >
                        {duration} min
                      </button>
                    ))}
                  </div>
                </div>

                {/* Description */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Description (optional)
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full px-4 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                    placeholder="What should people know before booking?"
                    rows={3}
                  />
                </div>

                {/* Availability */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-3">
                    Available Days
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {DAYS_OF_WEEK.map((day) => (
                      <button
                        key={day.value}
                        type="button"
                        onClick={() => toggleDay(day.value)}
                        className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                          formData.availability.days.includes(day.value)
                            ? 'bg-primary-600 text-white border-primary-600'
                            : 'bg-background text-foreground border-border hover:border-primary-500'
                        }`}
                      >
                        {day.label.slice(0, 3)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Hours */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">
                      Start Hour
                    </label>
                    <select
                      value={formData.availability.start_hour}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          availability: {
                            ...formData.availability,
                            start_hour: parseInt(e.target.value),
                          },
                        })
                      }
                      className="w-full px-4 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      {Array.from({ length: 12 }, (_, i) => i + 8).map((hour) => (
                        <option key={hour} value={hour}>
                          {hour > 12 ? hour - 12 : hour}:00 {hour >= 12 ? 'PM' : 'AM'}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">
                      End Hour
                    </label>
                    <select
                      value={formData.availability.end_hour}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          availability: {
                            ...formData.availability,
                            end_hour: parseInt(e.target.value),
                          },
                        })
                      }
                      className="w-full px-4 py-2 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      {Array.from({ length: 12 }, (_, i) => i + 9).map((hour) => (
                        <option key={hour} value={hour}>
                          {hour > 12 ? hour - 12 : hour}:00 {hour >= 12 ? 'PM' : 'AM'}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-3 justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowCreateForm(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={submitting}>
                    {submitting ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      'Create Link'
                    )}
                  </Button>
                </div>
              </form>
            </div>
          )}

          {/* Links List */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
            </div>
          ) : links.length === 0 ? (
            <div className="text-center py-16 bg-surface border border-border rounded-lg">
              <Calendar className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-semibold text-foreground mb-2">No scheduling links yet</h3>
            </div>
          ) : (
            <div className="space-y-4">
              {links.map((link) => (
                <div
                  key={link.id}
                  className="p-6 bg-surface border border-border rounded-lg hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg font-semibold text-foreground">{link.title}</h3>
                        <span className="px-2 py-0.5 text-xs font-medium bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 rounded">
                          {link.duration} min
                        </span>
                      </div>
                      {link.description && (
                        <p className="text-sm text-muted-foreground mb-3">{link.description}</p>
                      )}
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Clock className="w-4 h-4" />
                          <span>
                            {link.availability.days.map((d) => d.slice(0, 3)).join(', ')}
                          </span>
                        </div>
                        <span>
                          {link.availability.start_hour > 12
                            ? link.availability.start_hour - 12
                            : link.availability.start_hour}
                          :00{' '}
                          {link.availability.start_hour >= 12 ? 'PM' : 'AM'} -{' '}
                          {link.availability.end_hour > 12
                            ? link.availability.end_hour - 12
                            : link.availability.end_hour}
                          :00{' '}
                          {link.availability.end_hour >= 12 ? 'PM' : 'AM'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 ml-4">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleCopyLink(link)}
                        className="gap-2"
                      >
                        {copiedLinkId === link.id ? (
                          <>
                            <Check className="w-4 h-4" />
                            Copied!
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4" />
                            Copy Link
                          </>
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDeleteLink(link)}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
