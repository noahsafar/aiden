import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, Check, ExternalLink } from 'lucide-react';
import { createEvent, CreateEventParams } from '@/api/calendar';

interface CreateEventModalProps {
  isOpen: boolean;
  onClose: () => void;
  onEventCreated: () => void;
  timezone: string;
  /** Pre-fill the attendees field (e.g. when scheduling with a specific person). */
  initialAttendees?: string;
}

export function CreateEventModal({ isOpen, onClose, onEventCreated, timezone, initialAttendees }: CreateEventModalProps) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [attendees, setAttendees] = useState('');

  // Pre-fill attendees when opened for a specific person.
  useEffect(() => {
    if (isOpen && initialAttendees) setAttendees(initialAttendees);
  }, [isOpen, initialAttendees]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successLink, setSuccessLink] = useState<string | null>(null);

  const resetForm = () => {
    setTitle('');
    setDate(new Date().toISOString().split('T')[0]);
    setStartTime('09:00');
    setEndTime('10:00');
    setDescription('');
    setLocation('');
    setAttendees('');
    setError(null);
    setSuccessLink(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError('Title is required');
      return;
    }

    if (endTime <= startTime) {
      setError('End time must be after start time');
      return;
    }

    setIsSubmitting(true);

    try {
      // Build ISO datetimes with the user's timezone
      const startDatetime = `${date}T${startTime}:00`;
      const endDatetime = `${date}T${endTime}:00`;

      // Format with timezone offset for the backend
      const startISO = new Date(`${startDatetime}`).toLocaleString('sv-SE', { timeZone: timezone }).replace(' ', 'T');
      const endISO = new Date(`${endDatetime}`).toLocaleString('sv-SE', { timeZone: timezone }).replace(' ', 'T');

      // Parse attendees from comma-separated string
      const attendeeList = attendees
        .split(',')
        .map(email => email.trim())
        .filter(email => email.length > 0);

      const params: CreateEventParams = {
        summary: title.trim(),
        start_datetime: startISO,
        end_datetime: endISO,
      };

      if (description.trim()) params.description = description.trim();
      if (location.trim()) params.location = location.trim();
      if (attendeeList.length > 0) params.attendees = attendeeList;

      const result = await createEvent(params);

      if (result.success) {
        setSuccessLink(result.html_link || null);
        onEventCreated();
        // Auto-close after a brief delay to show success
        setTimeout(() => {
          handleClose();
        }, 1500);
      } else {
        setError(result.error || 'Failed to create event');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create event');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  // Portal to <body> so the fixed backdrop is viewport-relative — otherwise an
  // ancestor stacking/containing-block context (the page tree) offsets it and a
  // strip at the very top of the page never gets covered by the blur.
  return createPortal(
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50" onClick={handleClose}>
      <div
        className="bg-surface rounded-2xl shadow-elevated-lg border border-gray-200/70 dark:border-white/[0.08] w-full max-w-lg mx-4 max-h-[90vh] flex flex-col animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200/70 dark:border-white/[0.08]">
          <h2 className="text-lg font-semibold text-foreground">New Event</h2>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg text-muted hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Success state */}
        {successLink !== null && !error ? (
          <div className="p-8 text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-500/15 flex items-center justify-center mb-3">
              <Check className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
            </div>
            <p className="text-foreground font-medium mb-2">Event created!</p>
            {successLink && (
              <a
                href={successLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-violet-600 dark:text-violet-400 hover:underline"
              >
                View in Google Calendar <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        ) : (
          /* Form */
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5">
            <div className="space-y-4">
              {/* Title */}
              <div>
                <label htmlFor="event-title" className="block text-sm font-medium text-foreground mb-1.5">
                  Title <span className="text-rose-500">*</span>
                </label>
                <input
                  id="event-title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Meeting with team"
                  autoFocus
                  className="w-full px-3 py-2 border border-gray-200/80 dark:border-white/[0.08] rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-violet-400 text-sm transition-colors placeholder:text-muted"
                />
              </div>

              {/* Date */}
              <div>
                <label htmlFor="event-date" className="block text-sm font-medium text-foreground mb-1.5">
                  Date
                </label>
                <input
                  id="event-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200/80 dark:border-white/[0.08] rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-violet-400 text-sm transition-colors placeholder:text-muted"
                />
              </div>

              {/* Start / End Time */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="event-start" className="block text-sm font-medium text-foreground mb-1.5">
                    Start Time
                  </label>
                  <input
                    id="event-start"
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200/80 dark:border-white/[0.08] rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-violet-400 text-sm transition-colors placeholder:text-muted"
                  />
                </div>
                <div>
                  <label htmlFor="event-end" className="block text-sm font-medium text-foreground mb-1.5">
                    End Time
                  </label>
                  <input
                    id="event-end"
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200/80 dark:border-white/[0.08] rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-violet-400 text-sm transition-colors placeholder:text-muted"
                  />
                </div>
              </div>

              {/* Location */}
              <div>
                <label htmlFor="event-location" className="block text-sm font-medium text-foreground mb-1.5">
                  Location
                </label>
                <input
                  id="event-location"
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Conference room, Zoom link, etc."
                  className="w-full px-3 py-2 border border-gray-200/80 dark:border-white/[0.08] rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-violet-400 text-sm transition-colors placeholder:text-muted"
                />
              </div>

              {/* Description */}
              <div>
                <label htmlFor="event-description" className="block text-sm font-medium text-foreground mb-1.5">
                  Description
                </label>
                <textarea
                  id="event-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Add details about the event..."
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-200/80 dark:border-white/[0.08] rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-violet-400 text-sm resize-none transition-colors placeholder:text-muted"
                />
              </div>

              {/* Attendees */}
              <div>
                <label htmlFor="event-attendees" className="block text-sm font-medium text-foreground mb-1.5">
                  Attendees
                </label>
                <input
                  id="event-attendees"
                  type="text"
                  value={attendees}
                  onChange={(e) => setAttendees(e.target.value)}
                  placeholder="email1@example.com, email2@example.com"
                  className="w-full px-3 py-2 border border-gray-200/80 dark:border-white/[0.08] rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-violet-400 text-sm transition-colors placeholder:text-muted"
                />
                <p className="mt-1 text-xs text-muted">Comma-separated email addresses</p>
              </div>

              {/* Error */}
              {error && (
                <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20">
                  <p className="text-sm text-rose-700 dark:text-rose-300">{error}</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 mt-6">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-white/[0.07] rounded-lg hover:bg-gray-200 dark:hover:bg-white/[0.12] transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !title.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-violet-600 rounded-lg hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create Event'
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
