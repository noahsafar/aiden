import React, { useState, useEffect } from 'react';
import { Calendar, Clock, Users, Check, Loader } from 'lucide-react';

interface MeetingRequest {
  is_meeting: boolean;
  proposed_times?: string[];
  duration_minutes?: number;
  attendees?: string[];
  subject?: string;
}

interface FreeSlot {
  start: string;
  end: string;
  date: string;
  time: string;
}

interface MeetingSuggestionsProps {
  meetingRequest: MeetingRequest;
  emailSubject: string;
  senderEmail: string;
  onCreated?: () => void;
}

export function MeetingSuggestions({ meetingRequest, emailSubject, senderEmail, onCreated }: MeetingSuggestionsProps) {
  const [freeSlots, setFreeSlots] = useState<FreeSlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  useEffect(() => {
    if (meetingRequest.is_meeting) {
      fetchFreeSlots();
    }
  }, [meetingRequest]);

  const fetchFreeSlots = async () => {
    setLoading(true);
    try {
      const response = await fetch('http://localhost:8081/calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'find_free_slots',
          duration_minutes: meetingRequest.duration_minutes || 60,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setFreeSlots(data.free_slots || []);
        }
      }
    } catch (e) {
      console.error('Failed to fetch free slots:', e);
    } finally {
      setLoading(false);
    }
  };

  const createEvent = async (slot: FreeSlot) => {
    setCreating(slot.start);
    try {
      const response = await fetch('http://localhost:8081/calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_event',
          summary: meetingRequest.subject || emailSubject.replace('Re: ', '').replace('RE: ', ''),
          start_datetime: slot.start,
          end_datetime: slot.end,
          attendees: [senderEmail],
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setCreated(slot.start);
          onCreated?.();
        }
      }
    } catch (e) {
      console.error('Failed to create event:', e);
    } finally {
      setCreating(null);
    }
  };

  if (!meetingRequest.is_meeting) {
    return null;
  }

  return (
    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-xl p-4 mb-4 border border-blue-200 dark:border-blue-700">
      <div className="flex items-start gap-3">
        <div className="p-2 bg-blue-100 dark:bg-blue-800 rounded-lg">
          <Calendar className="w-5 h-5 text-blue-600 dark:text-blue-400" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-1">
            Meeting Request Detected
          </h3>
          <p className="text-sm text-blue-700 dark:text-blue-300 mb-3">
            Aiden can help you schedule this meeting based on your Google Calendar
          </p>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400">
              <Loader className="w-4 h-4 animate-spin" />
              Finding available time slots...
            </div>
          ) : freeSlots.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-medium text-blue-800 dark:text-blue-200 uppercase tracking-wide">
                Suggested Time Slots
              </p>
              {freeSlots.map((slot, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-3 bg-white dark:bg-gray-800 rounded-lg border border-blue-200 dark:border-blue-700 hover:shadow-sm transition-shadow"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-1.5 bg-blue-100 dark:bg-blue-800 rounded">
                      <Clock className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{slot.date}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{slot.time}</p>
                    </div>
                  </div>
                  {created === slot.start ? (
                    <div className="flex items-center gap-1 text-sm text-green-600 dark:text-green-400 font-medium">
                      <Check className="w-4 h-4" />
                      Created
                    </div>
                  ) : (
                    <button
                      onClick={() => createEvent(slot)}
                      disabled={creating !== null}
                      className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
                    >
                      {creating === slot.start ? 'Creating...' : 'Create Event'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-blue-600 dark:text-blue-400">
              No available time slots found. Check your calendar for conflicts.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
