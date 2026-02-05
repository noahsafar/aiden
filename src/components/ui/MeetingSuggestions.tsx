import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Clock, Check, Loader, AlertCircle, ChevronDown, Calendar as CalendarIcon, X } from 'lucide-react';
import { serverURL } from '@/api/emails';
import { CalendarPicker } from './CalendarPicker';

interface MeetingRequest {
  is_meeting: boolean;
  proposed_times?: string[];
  duration_minutes?: number;
  attendees?: string[];
  subject?: string;
}

interface TimeSlot {
  date: string;
  time: string;
  start: string;
  end: string;
  dayName: string;
  isRecommended?: boolean;
  hasConflict?: boolean;
}

interface ConflictResult {
  original_time: string;
  date: string;
  time: string;
  start: string;
  end: string;
  has_conflict: boolean | null;
  conflicting_events: Array<{ summary: string; start: string; end: string }>;
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
  onTimeSelected?: (slot: TimeSlot) => void;
  timezone?: string;
}

export function MeetingSuggestions({ meetingRequest, emailSubject, senderEmail, onCreated, onTimeSelected, timezone = 'America/New_York' }: MeetingSuggestionsProps) {
  const [conflicts, setConflicts] = useState<ConflictResult[]>([]);
  const [freeSlots, setFreeSlots] = useState<FreeSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [showingSlots, setShowingSlots] = useState(false);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [expandedConflicts, setExpandedConflicts] = useState<Set<number>>(new Set());
  const [showCalendarPicker, setShowCalendarPicker] = useState(false);
  const [selectedTime, setSelectedTime] = useState<TimeSlot | null>(null);

  // Compute hasProposedTimes inside useEffect to get fresh value
  const proposedTimes = meetingRequest.proposed_times || [];

  console.log('[MeetingSuggestions] meetingRequest:', meetingRequest);
  console.log('[MeetingSuggestions] proposedTimes:', proposedTimes);
  console.log('[MeetingSuggestions] proposedTimes.length:', proposedTimes.length);

  useEffect(() => {
    const hasProposedTimes = proposedTimes.length > 0;
    console.log('[MeetingSuggestions] useEffect triggered, is_meeting:', meetingRequest.is_meeting, 'hasProposedTimes:', hasProposedTimes);
    if (meetingRequest.is_meeting && hasProposedTimes) {
      console.log('[MeetingSuggestions] Calling checkConflicts');
      checkConflicts();
    } else if (meetingRequest.is_meeting) {
      console.log('[MeetingSuggestions] Meeting but no proposed times, showing button');
      setLoading(false); // No proposed times, just show the button
    }
  }, [meetingRequest, proposedTimes]);

  const checkConflicts = async () => {
    setLoading(true);
    try {
      const baseURL = await serverURL();
      console.log('[MeetingSuggestions] Checking conflicts for:', meetingRequest.proposed_times);
      const response = await fetch(`${baseURL}/calendar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'check_conflict',
          proposed_times: meetingRequest.proposed_times,
          duration_minutes: meetingRequest.duration_minutes || 60,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          console.log('[MeetingSuggestions] Conflict results:', data.conflicts);
          setConflicts(data.conflicts || []);
        }
      }
    } catch (e) {
      console.error('Failed to check conflicts:', e);
    } finally {
      setLoading(false);
    }
  };

  const showFreeSlots = async () => {
    setShowingSlots(true);
    setLoadingSlots(true);
    try {
      const baseURL = await serverURL();
      console.log('[MeetingSuggestions] Fetching free slots from', `${baseURL}/calendar`);
      const response = await fetch(`${baseURL}/calendar`, {
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
      setLoadingSlots(false);
    }
  };

  const createEvent = async (slot: FreeSlot | ConflictResult | TimeSlot) => {
    setCreating(slot.start);
    try {
      const baseURL = await serverURL();
      const response = await fetch(`${baseURL}/calendar`, {
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
          // Also update selected time and notify parent
          const timeSlot: TimeSlot = {
            date: slot.date,
            time: slot.time,
            start: slot.start,
            end: slot.end,
            dayName: 'dayName' in slot ? slot.dayName : getDayNameFromDate(slot.start),
            isRecommended: false,
            hasConflict: false,
          };
          setSelectedTime(timeSlot);
          onTimeSelected?.(timeSlot);
          onCreated?.();
        }
      }
    } catch (e) {
      console.error('Failed to create event:', e);
    } finally {
      setCreating(null);
    }
  };

  const getDayNameFromDate = (isoDate: string): string => {
    const date = new Date(isoDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const dateOnly = new Date(date);
    dateOnly.setHours(0, 0, 0, 0);

    if (dateOnly.getTime() === today.getTime()) return 'Today';
    if (dateOnly.getTime() === tomorrow.getTime()) return 'Tomorrow';
    return date.toLocaleDateString('en-US', { weekday: 'long' });
  };

  const handleTimeSelect = (slot: TimeSlot) => {
    setSelectedTime(slot);
    setShowCalendarPicker(false);
    // Notify parent component so it can update the reply draft
    onTimeSelected?.(slot);
  };

  const handleOpenCalendarPicker = () => {
    setShowCalendarPicker(true);
  };

  const handleCloseCalendarPicker = () => {
    setShowCalendarPicker(false);
  };

  const toggleConflict = (idx: number) => {
    setExpandedConflicts(prev => {
      const newSet = new Set(prev);
      if (newSet.has(idx)) {
        newSet.delete(idx);
      } else {
        newSet.add(idx);
      }
      return newSet;
    });
  };

  if (!meetingRequest.is_meeting) {
    return null;
  }

  const allClear = conflicts.length > 0 && conflicts.every(c => c.has_conflict === false);
  const hasConflict = conflicts.some(c => c.has_conflict === true);

  return (
    <div className="relative">
    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-xl p-4 mb-4 border border-blue-200 dark:border-blue-700">
      <div>
        <h3 className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-1">
          Meeting Request Detected
        </h3>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400">
            <Loader className="w-4 h-4 animate-spin" />
            Checking your calendar...
          </div>
        ) : showingSlots ? (
            <>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-medium text-blue-800 dark:text-blue-200 uppercase tracking-wide">
                  Available Time Slots
                </p>
                <button
                  onClick={() => setShowingSlots(false)}
                  className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              {loadingSlots ? (
                <div className="flex items-center justify-center py-8">
                  <Loader className="w-5 h-5 text-blue-600 dark:text-blue-400 animate-spin" />
                </div>
              ) : freeSlots.length > 0 ? (
                <div className="space-y-2">
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
                      {selectedTime?.start === slot.start ? (
                        <div className="flex items-center gap-1 text-sm text-green-600 dark:text-green-400 font-medium">
                          <Check className="w-4 h-4" />
                          Selected
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            const timeSlot: TimeSlot = {
                              date: slot.date,
                              time: slot.time,
                              start: slot.start,
                              end: slot.end,
                              dayName: getDayNameFromDate(slot.start),
                              isRecommended: false,
                              hasConflict: false,
                            };
                            setSelectedTime(timeSlot);
                            onTimeSelected?.(timeSlot);
                          }}
                          className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
                        >
                          Select
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-blue-600 dark:text-blue-400 text-center py-4">
                  No available time slots found.
                </p>
              )}
            </>
          ) : proposedTimes.length > 0 ? (
            <>
              {conflicts.length > 0 && (
                <div className="space-y-2 mb-3">
                  <p className="text-xs font-medium text-blue-800 dark:text-blue-200 uppercase tracking-wide">
                    Proposed Times
                  </p>
                  {conflicts.map((conflict, idx) => (
                    <div key={idx} className="bg-white dark:bg-gray-800 rounded-lg border border-blue-200 dark:border-blue-700 overflow-hidden">
                      <div
                        className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50"
                        onClick={() => conflict.has_conflict && toggleConflict(idx)}
                      >
                        <div className="flex items-center gap-3">
                          {conflict.has_conflict === null ? (
                            <div className="p-1.5 bg-gray-100 dark:bg-gray-700 rounded">
                              <Clock className="w-4 h-4 text-gray-500" />
                            </div>
                          ) : conflict.has_conflict ? (
                            <div className="p-1.5 bg-red-100 dark:bg-red-800 rounded">
                              <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
                            </div>
                          ) : (
                            <div className="p-1.5 bg-green-100 dark:bg-green-800 rounded">
                              <Check className="w-4 h-4 text-green-600 dark:text-green-400" />
                            </div>
                          )}
                          <div>
                            <p className="text-sm font-medium text-gray-900 dark:text-white">{conflict.date}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">{conflict.time}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {conflict.has_conflict === false && (
                            <button
                              onClick={(e) => { e.stopPropagation(); createEvent(conflict); }}
                              disabled={creating !== null}
                              className="px-3 py-1 text-xs bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
                            >
                              {creating === conflict.start ? 'Creating...' : 'Schedule'}
                            </button>
                          )}
                          {conflict.has_conflict === true && (
                            <span className="text-xs font-medium text-red-600 dark:text-red-400">
                              Conflict
                            </span>
                          )}
                          {conflict.has_conflict === true && conflict.conflicting_events.length > 0 && (
                            <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${expandedConflicts.has(idx) ? 'rotate-180' : ''}`} />
                          )}
                        </div>
                      </div>
                      {conflict.has_conflict === true && expandedConflicts.has(idx) && conflict.conflicting_events.length > 0 && (
                        <div className="px-3 pb-3 border-t border-gray-100 dark:border-gray-700">
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">Conflicting events:</p>
                          {conflict.conflicting_events.map((event, eIdx) => (
                            <div key={eIdx} className="text-sm text-gray-700 dark:text-gray-300 mt-1">
                              • {event.summary} ({event.start} - {event.end})
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {(hasConflict || conflicts.length === 0) && (
                <div className="flex gap-2">
                  <button
                    onClick={showFreeSlots}
                    disabled={loadingSlots}
                    className="flex-1 text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 py-2 text-sm rounded-lg font-medium transition-colors"
                  >
                    Find a Time That Works
                  </button>
                  <button
                    onClick={handleOpenCalendarPicker}
                    disabled={loadingSlots}
                    className="flex-1 text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 py-2 text-sm rounded-lg font-medium transition-colors"
                  >
                    Pick from Calendar
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-blue-700 dark:text-blue-300">
                No specific time was proposed. Would you like Aiden to find available time slots?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={showFreeSlots}
                  disabled={loadingSlots}
                  className="flex-1 text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 py-2 text-sm rounded-lg font-medium transition-colors"
                >
                  Find a Time That Works
                </button>
                <button
                  onClick={handleOpenCalendarPicker}
                  disabled={loadingSlots}
                  className="flex-1 text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 py-2 text-sm rounded-lg font-medium transition-colors"
                >
                  Pick from Calendar
                </button>
              </div>
            </div>
          )}

          {/* Selected Time Display */}
          {selectedTime && (
            <div className="mt-4 p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg border border-indigo-200 dark:border-indigo-800">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  <div>
                    <p className="text-sm font-medium text-indigo-900 dark:text-indigo-100">
                      {selectedTime.dayName} at {selectedTime.time}
                    </p>
                    <p className="text-xs text-indigo-600 dark:text-indigo-400">
                      Selected for your meeting
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => createEvent(selectedTime)}
                    disabled={creating !== null}
                    className="px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white rounded-lg font-medium transition-colors"
                  >
                    {creating === selectedTime.start ? 'Creating...' : 'Create Event'}
                  </button>
                  <button
                    onClick={() => setSelectedTime(null)}
                    className="p-1 rounded hover:bg-indigo-100 dark:hover:bg-indigo-900/40 text-indigo-500"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

    {/* Calendar Picker Modal */}
    {showCalendarPicker && createPortal(
      <div className="fixed inset-0 bg-black/50 dark:bg-black/70 z-[9999] flex items-center justify-center p-4 animate-in fade-in duration-200">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
          <CalendarPicker
            durationMinutes={meetingRequest.duration_minutes || 60}
            timezone={timezone}
            onTimeSelect={handleTimeSelect}
            onClose={handleCloseCalendarPicker}
            selectedSlot={selectedTime}
            isModal={true}
          />
        </div>
      </div>,
      document.body
    )}
    </div>
  );
}
