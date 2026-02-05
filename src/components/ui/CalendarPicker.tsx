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
  isModal?: boolean;
}

export function CalendarPicker({
  durationMinutes = 60,
  timezone = 'America/New_York',
  onTimeSelect,
  onClose,
  selectedSlot,
  isModal = false
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

  // Group slots by day
  const slotsByDay = useMemo(() => {
    const grouped: Record<string, TimeSlot[]> = {};
    for (const slot of generateTimeSlots) {
      // Use both date and dayName as key to avoid grouping different dates with same weekday
      const key = `${slot.date}|${slot.dayName}`;
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(slot);
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
    <div className="flex flex-col h-full overflow-hidden">
      {/* Compact Header with Nav */}
      <div className={`flex items-center justify-between border-b border-gray-200 dark:border-gray-700 gap-2 ${isModal ? 'px-6 py-4' : 'px-3 py-2'}`}>
        <button
          onClick={() => navigateWeek('prev')}
          className={`rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 flex-shrink-0 ${isModal ? 'p-2' : 'p-1'}`}
        >
          <ChevronLeft className={`${isModal ? 'w-5 h-5' : 'w-4 h-4'}`} />
        </button>
        <span className={`font-medium text-gray-700 dark:text-gray-300 text-center flex-1 truncate ${isModal ? 'text-sm' : 'text-xs'}`}>{getDateRangeText()}</span>
        <button
          onClick={() => navigateWeek('next')}
          className={`rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 flex-shrink-0 ${isModal ? 'p-2' : 'p-1'}`}
        >
          <ChevronRight className={`${isModal ? 'w-5 h-5' : 'w-4 h-4'}`} />
        </button>
        <button
          onClick={onClose}
          className={`rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 flex-shrink-0 ${isModal ? 'p-2' : 'p-1'}`}
        >
          <X className={`${isModal ? 'w-5 h-5' : 'w-4 h-4'}`} />
        </button>
      </div>

      {/* Compact Legend */}
      <div className={`flex items-center gap-3 border-b border-gray-200 dark:border-gray-700 ${isModal ? 'px-6 py-3 text-xs' : 'px-3 py-1.5 text-[10px]'}`}>
        <div className="flex items-center gap-1.5">
          <div className={`${isModal ? 'w-3 h-3' : 'w-2 h-2'} rounded bg-blue-500`} />
          <span className="text-gray-500 dark:text-gray-400">Avail</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={`${isModal ? 'w-3 h-3' : 'w-2 h-2'} rounded bg-green-500`} />
          <span className="text-gray-500 dark:text-gray-400">Best</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={`${isModal ? 'w-3 h-3' : 'w-2 h-2'} rounded bg-gray-300 dark:bg-gray-600`} />
          <span className="text-gray-500 dark:text-gray-400">Busy</span>
        </div>
      </div>

      {/* Time Slots Grid */}
      <div className={`flex-1 overflow-y-auto min-h-0 ${isModal ? 'p-6' : 'p-3'}`}>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader className={`${isModal ? 'w-6 h-6' : 'w-5 h-5'} text-blue-600 dark:text-blue-400 animate-spin`} />
          </div>
        ) : (
          <div className={`space-y-${isModal ? '4' : '3'}`}>
            {Object.entries(slotsByDay).map(([key, slots]) => {
              const dayName = key.split('|')[1];
              return (
                <div key={key}>
                  <p className={`${isModal ? 'text-sm font-semibold' : 'text-[10px] font-semibold'} text-gray-400 dark:text-gray-500 uppercase tracking-wide ${isModal ? 'mb-2' : 'mb-1.5'}`}>
                    {dayName}
                  </p>
                  <div className={`grid gap-${isModal ? '2' : '1.5'} ${isModal ? 'grid-cols-4' : 'grid-cols-5'}`}>
                  {slots.map((slot, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSlotClick(slot)}
                      disabled={slot.hasConflict}
                      className={`
                        relative rounded font-medium transition-all
                        ${isModal
                          ? 'px-3 py-3 text-sm'
                          : 'px-1.5 py-1.5 text-[10px]'
                        }
                        ${slot.hasConflict
                          ? 'bg-gray-100 dark:bg-gray-800 text-gray-350 dark:text-gray-600 cursor-not-allowed opacity-50'
                          : slot.isRecommended
                            ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/60 border border-green-300 dark:border-green-700'
                            : 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/60 border border-blue-300 dark:border-blue-700'
                        }
                        ${selectedSlot?.start === slot.start
                          ? 'ring-1.5 ring-green-500'
                          : ''
                        }
                      `}
                    >
                      <div className="flex flex-col items-center gap-0.5">
                        <span>{slot.time}</span>
                      </div>
                      {selectedSlot?.start === slot.start && (
                        <div className={`absolute bg-green-500 rounded-full flex items-center justify-center ${isModal ? '-top-1 -right-1 w-4 h-4' : '-top-0.5 -right-0.5 w-3 h-3'}`}>
                          <Check className={`${isModal ? 'w-2.5 h-2.5' : 'w-2 h-2'} text-white`} />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            );
            })}
          </div>
        )}
      </div>

      {/* Compact Selected Time Display */}
      {selectedSlot && (
        <div className={`${isModal ? 'px-6 py-4' : 'px-3 py-2'} bg-blue-50 dark:bg-blue-900/20 border-t border-blue-200 dark:border-blue-800`}>
          <div className="flex items-center justify-between">
            <div>
              <p className={`${isModal ? 'text-sm' : 'text-xs'} font-medium text-blue-900 dark:text-blue-100`}>
                {selectedSlot.dayName} at {selectedSlot.time}
              </p>
            </div>
            <button
              onClick={() => onTimeSelect(selectedSlot)}
              className={`${isModal ? 'px-4 py-2 text-sm' : 'px-3 py-1.5 text-xs'} bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors`}
            >
              Confirm
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
