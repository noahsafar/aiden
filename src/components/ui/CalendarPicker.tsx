import React, { useState, useEffect, useMemo } from 'react';
import { Calendar, Clock, ChevronLeft, ChevronRight, X, Check, Loader } from 'lucide-react';
import { fetchEvents, CalendarEvent } from '@/api/calendar';
import { serverURL } from '@/api/emails';

interface TimeSlot {
  date: string;        // YYYY-MM-DD
  time: string;        // formatted like "2:00 PM"
  start: string;       // ISO datetime
  end: string;         // ISO datetime
  dayName: string;     // "Monday", "Tuesday", etc.
  isRecommended: boolean;
  hasConflict: boolean;
}

interface CalendarPickerProps {
  durationMinutes?: number;
  timezone?: string;
  onTimeSelect: (slot: TimeSlot) => void;
  onClose: () => void;
  selectedSlot?: TimeSlot | null;
}

export function CalendarPicker({
  durationMinutes = 60,
  timezone = 'America/New_York',
  onTimeSelect,
  onClose,
  selectedSlot
}: CalendarPickerProps) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewStartDate, setViewStartDate] = useState(new Date());
  const [hoveredSlot, setHoveredSlot] = useState<TimeSlot | null>(null);

  // Load calendar events for the visible date range
  useEffect(() => {
    loadEvents();
  }, [viewStartDate, timezone]);

  const loadEvents = async () => {
    setLoading(true);
    try {
      const startDate = new Date(viewStartDate);
      const endDate = new Date(viewStartDate);
      endDate.setDate(endDate.getDate() + 14); // Load 2 weeks of data

      const startStr = startDate.toISOString().split('T')[0];
      const endStr = endDate.toISOString().split('T')[0];

      const response = await fetchEvents(startStr, endStr, timezone);
      if (response.success) {
        setEvents(response.events);
      }
    } catch (error) {
      console.error('Failed to load calendar events:', error);
    } finally {
      setLoading(false);
    }
  };

  // Generate time slots for each day
  const generateTimeSlots = useMemo(() => {
    const slots: TimeSlot[] = [];
    const now = new Date();
    const startOfDay = 8; // 8 AM
    const endOfDay = 18;   // 6 PM
    const slotInterval = 30; // 30-minute increments

    // Generate slots for the next 14 days
    for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
      const date = new Date(viewStartDate);
      date.setDate(date.getDate() + dayOffset);
      date.setHours(0, 0, 0, 0);

      // Skip past dates
      if (date < now && dayOffset > 0) continue;

      const dateStr = date.toISOString().split('T')[0];
      const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
      const isToday = date.toDateString() === now.toDateString();
      const isWeekend = date.getDay() === 0 || date.getDay() === 6;

      // Skip weekends (optional - can be configurable)
      // if (isWeekend) continue;

      // Get events for this day
      const dayEvents = events.filter(e => e.date === dateStr);

      // Generate hourly slots
      for (let hour = startOfDay; hour < endOfDay; hour++) {
        for (let minute = 0; minute < 60; minute += slotInterval) {
          const slotStart = new Date(date);
          slotStart.setHours(hour, minute, 0, 0);

          // Skip past times for today
          if (isToday && slotStart < now) continue;

          const slotEnd = new Date(slotStart);
          slotEnd.setMinutes(slotEnd.getMinutes() + durationMinutes);

          // Check for conflicts
          const hasConflict = checkConflict(slotStart, slotEnd, dayEvents);

          // Check if this is a recommended time (weekday, mid-morning or mid-afternoon, no conflict)
          const isRecommended = !hasConflict && !isWeekend &&
            ((hour >= 9 && hour <= 11) || (hour >= 14 && hour <= 16));

          slots.push({
            date: dateStr,
            time: slotStart.toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true
            }),
            start: slotStart.toISOString(),
            end: slotEnd.toISOString(),
            dayName: isToday ? 'Today' : isTomorrow(date) ? 'Tomorrow' : dayName,
            isRecommended,
            hasConflict
          });
        }
      }
    }

    return slots;
  }, [events, viewStartDate, durationMinutes]);

  // Check if a time slot conflicts with existing events
  const checkConflict = (start: Date, end: Date, dayEvents: CalendarEvent[]): boolean => {
    for (const event of dayEvents) {
      const eventStart = new Date(event.start);
      const eventEnd = new Date(event.end);

      // Check for overlap
      if (start < eventEnd && end > eventStart) {
        return true;
      }
    }
    return false;
  };

  const isTomorrow = (date: Date): boolean => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return date.toDateString() === tomorrow.toDateString();
  };

  // Group slots by day
  const slotsByDay = useMemo(() => {
    const grouped: Record<string, TimeSlot[]> = {};
    for (const slot of generateTimeSlots) {
      if (!grouped[slot.dayName]) {
        grouped[slot.dayName] = [];
      }
      grouped[slot.dayName].push(slot);
    }
    return grouped;
  }, [generateTimeSlots]);

  // Navigate weeks
  const navigateWeek = (direction: 'prev' | 'next') => {
    const newDate = new Date(viewStartDate);
    newDate.setDate(newDate.getDate() + (direction === 'next' ? 7 : -7));
    setViewStartDate(newDate);
  };

  const handleSlotClick = (slot: TimeSlot) => {
    if (!slot.hasConflict) {
      onTimeSelect(slot);
    }
  };

  const getDateRangeText = () => {
    const end = new Date(viewStartDate);
    end.setDate(end.getDate() + 13);
    return `${viewStartDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <Calendar className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          <h3 className="font-semibold text-gray-900 dark:text-white">Pick a Time</h3>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Week Navigation */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
        <button
          onClick={() => navigateWeek('prev')}
          className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{getDateRangeText()}</span>
        <button
          onClick={() => navigateWeek('next')}
          className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-gray-200 dark:border-gray-700 text-xs">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-green-500" />
          <span className="text-gray-600 dark:text-gray-400">Available</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-blue-500" />
          <span className="text-gray-600 dark:text-gray-400">Recommended</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-gray-300 dark:bg-gray-600" />
          <span className="text-gray-600 dark:text-gray-400">Unavailable</span>
        </div>
      </div>

      {/* Time Slots Grid */}
      <div className="max-h-80 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader className="w-6 h-6 text-blue-600 dark:text-blue-400 animate-spin" />
          </div>
        ) : (
          <div className="space-y-4">
            {Object.entries(slotsByDay).map(([dayName, slots]) => (
              <div key={dayName}>
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                  {dayName}
                </p>
                <div className="grid grid-cols-4 gap-2">
                  {slots.map((slot, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSlotClick(slot)}
                      onMouseEnter={() => setHoveredSlot(slot)}
                      onMouseLeave={() => setHoveredSlot(null)}
                      disabled={slot.hasConflict}
                      className={`
                        relative px-2 py-2 rounded-lg text-xs font-medium transition-all
                        ${slot.hasConflict
                          ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-not-allowed opacity-60'
                          : slot.isRecommended
                            ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/60 border border-blue-300 dark:border-blue-700'
                            : 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/60 border border-green-300 dark:border-green-700'
                        }
                        ${selectedSlot?.start === slot.start
                          ? 'ring-2 ring-blue-500 ring-offset-1'
                          : ''
                        }
                      `}
                    >
                      <div className="flex flex-col items-center gap-0.5">
                        <Clock className={`w-3 h-3 ${slot.hasConflict ? 'opacity-50' : ''}`} />
                        <span>{slot.time}</span>
                        {slot.isRecommended && !slot.hasConflict && (
                          <span className="text-[10px] opacity-75">★</span>
                        )}
                      </div>
                      {selectedSlot?.start === slot.start && (
                        <div className="absolute -top-1 -right-1 w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center">
                          <Check className="w-2.5 h-2.5 text-white" />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Selected Time Display */}
      {selectedSlot && (
        <div className="px-4 py-3 bg-blue-50 dark:bg-blue-900/20 border-t border-blue-200 dark:border-blue-800">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
                {selectedSlot.dayName} at {selectedSlot.time}
              </p>
              <p className="text-xs text-blue-600 dark:text-blue-400">
                {durationMinutes} minutes
              </p>
            </div>
            <button
              onClick={() => onTimeSelect(selectedSlot)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Confirm
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
