import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { ChevronLeft, ChevronRight, X, Check, Loader } from 'lucide-react';
import { fetchEvents, CalendarEvent } from '@/api/calendar';

interface TimeSlot {
  date: string;
  time: string;
  start: string;
  end: string;
  dayName: string;
}

interface CalendarPickerProps {
  durationMinutes?: number;
  timezone?: string;
  onTimeSelect: (slot: TimeSlot) => void;
  onClose: () => void;
  selectedSlot?: TimeSlot | null;
  isModal?: boolean;
}

interface DragState {
  isDragging: boolean;
  startDate: Date | null;
  startHour: number | null;
  currentHour: number | null;
}

const HOURS = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23
];

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
  const [viewStartDate, setViewStartDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  });
  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    startDate: null,
    startHour: null,
    currentHour: null,
  });
  const [hoverDate, setHoverDate] = useState<Date | null>(null);
  const [hoverHour, setHoverHour] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load calendar events for the visible date range
  useEffect(() => {
    loadEvents();
  }, [viewStartDate, timezone]);

  const loadEvents = async () => {
    setLoading(true);
    try {
      const startDate = new Date(viewStartDate);
      const endDate = new Date(viewStartDate);
      endDate.setDate(endDate.getDate() + 14);

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

  // Get 7 days to display starting from viewStartDate
  const weekDays = useMemo(() => {
    const days: Date[] = [];
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    for (let i = 0; i < 7; i++) {
      const date = new Date(viewStartDate);
      date.setDate(date.getDate() + i);
      date.setHours(0, 0, 0, 0);

      // Only show future dates or today
      if (date >= now) {
        days.push(date);
      }
    }
    return days;
  }, [viewStartDate]);

  // Check if a time slot has conflicts
  const hasConflictAt = useCallback((date: Date, hour: number): boolean => {
    const dateStr = date.toISOString().split('T')[0];
    const dayEvents = events.filter(e => e.date === dateStr);

    const slotStart = new Date(date);
    slotStart.setHours(hour, 0, 0, 0);

    const slotEnd = new Date(slotStart);
    slotEnd.setHours(hour + 1, 0, 0, 0);

    for (const event of dayEvents) {
      const eventStart = new Date(event.start);
      const eventEnd = new Date(event.end);

      if (slotStart < eventEnd && slotEnd > eventStart) {
        return true;
      }
    }
    return false;
  }, [events]);

  // Check if a specific time range has conflicts
  const hasRangeConflict = useCallback((start: Date, end: Date): boolean => {
    const startDateStr = start.toISOString().split('T')[0];
    const endDateStr = end.toISOString().split('T')[0];

    for (const event of events) {
      const eventStart = new Date(event.start);
      const eventEnd = new Date(event.end);

      if (start < eventEnd && end > eventStart) {
        return true;
      }
    }
    return false;
  }, [events]);

  // Get current selection info
  const selectionInfo = useMemo(() => {
    if (!dragState.startDate || dragState.startHour === null) return null;

    const start = new Date(dragState.startDate);
    start.setHours(dragState.startHour, 0, 0, 0);

    let end: Date;
    if (dragState.isDragging && dragState.currentHour !== null) {
      end = new Date(dragState.startDate);
      const endHour = dragState.currentHour > dragState.startHour ? dragState.currentHour + 1 : dragState.startHour + 1;
      end.setHours(endHour, 0, 0, 0);
    } else {
      end = new Date(start);
      end.setHours(dragState.startHour + 1, 0, 0, 0);
    }

    const duration = Math.round((end.getTime() - start.getTime()) / (1000 * 60));
    const hasConflict = hasRangeConflict(start, end);

    return { start, end, duration, hasConflict };
  }, [dragState, hasRangeConflict]);

  // Navigate weeks
  const navigateWeek = (direction: 'prev' | 'next') => {
    const newDate = new Date(viewStartDate);
    newDate.setDate(newDate.getDate() + (direction === 'next' ? 7 : -7));

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    if (newDate >= now) {
      setViewStartDate(newDate);
    }
  };

  // Handle mouse down on a cell
  const handleCellMouseDown = (date: Date, hour: number) => {
    const now = new Date();
    const cellDate = new Date(date);
    cellDate.setHours(hour, 0, 0, 0);

    if (cellDate < now) return;

    setDragState({
      isDragging: true,
      startDate: date,
      startHour: hour,
      currentHour: hour,
    });
  };

  // Handle mouse enter on a cell while dragging
  const handleCellMouseEnter = (date: Date, hour: number) => {
    setHoverDate(date);
    setHoverHour(hour);

    if (dragState.isDragging && dragState.startDate) {
      // Only allow dragging on the same day for now
      if (date.toDateString() === dragState.startDate.toDateString()) {
        setDragState(prev => ({ ...prev, currentHour: hour }));
      }
    }
  };

  // Handle mouse up to end dragging
  const handleMouseUp = () => {
    if (dragState.isDragging && selectionInfo && !selectionInfo.hasConflict) {
      const { start, end } = selectionInfo;

      const slot: TimeSlot = {
        date: start.toISOString().split('T')[0],
        time: start.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        }),
        start: start.toISOString(),
        end: end.toISOString(),
        dayName: getDayName(start),
      };

      onTimeSelect(slot);
    }

    setDragState({
      isDragging: false,
      startDate: null,
      startHour: null,
      currentHour: null,
    });
  };

  // Add global mouse up listener
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (dragState.isDragging) {
        handleMouseUp();
      }
    };

    document.addEventListener('mouseup', handleGlobalMouseUp);
    return () => document.removeEventListener('mouseup', handleGlobalMouseUp);
  }, [dragState, selectionInfo]);

  const getDayName = (date: Date): string => {
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

  // Check if a cell is selected
  const isCellSelected = (date: Date, hour: number): boolean => {
    if (!dragState.startDate || dragState.startHour === null) return false;

    const sameDay = date.toDateString() === dragState.startDate.toDateString();
    if (!sameDay) return false;

    const startH = Math.min(dragState.startHour, dragState.currentHour ?? dragState.startHour);
    const endH = Math.max(dragState.startHour, dragState.currentHour ?? dragState.startHour);

    return hour >= startH && hour <= endH;
  };

  // Check if a cell is hovered
  const isCellHovered = (date: Date, hour: number): boolean => {
    if (!hoverDate || hoverHour === null || !dragState.isDragging) return false;
    if (!dragState.startDate || dragState.startHour === null) return false;

    const sameDay = date.toDateString() === dragState.startDate.toDateString();
    if (!sameDay || date.toDateString() !== hoverDate.toDateString()) return false;

    const startH = Math.min(dragState.startHour, hoverHour);
    const endH = Math.max(dragState.startHour, hoverHour);

    return hour >= startH && hour <= endH;
  };

  // Check if cell is in past
  const isPast = (date: Date, hour: number): boolean => {
    const now = new Date();
    const cellTime = new Date(date);
    cellTime.setHours(hour, 0, 0, 0);
    return cellTime < now;
  };

  // Check if selected slot matches a cell
  const isSelectedSlot = (date: Date, hour: number): boolean => {
    if (!selectedSlot) return false;

    const selectedStart = new Date(selectedSlot.start);
    const selectedEnd = new Date(selectedSlot.end);

    const cellStart = new Date(date);
    cellStart.setHours(hour, 0, 0, 0);

    const cellEnd = new Date(cellStart);
    cellEnd.setHours(hour + 1, 0, 0, 0);

    return cellStart < selectedEnd && cellEnd > selectedStart;
  };

  const getDateRangeText = () => {
    const end = new Date(viewStartDate);
    end.setDate(end.getDate() + 6);
    return `${viewStartDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  };

  const canNavigatePrev = () => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const prevWeek = new Date(viewStartDate);
    prevWeek.setDate(prevWeek.getDate() - 7);
    return prevWeek >= now;
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className={`flex items-center justify-between border-b border-gray-200 dark:border-gray-700 gap-2 ${isModal ? 'px-6 py-4' : 'px-3 py-2'}`}>
        <button
          onClick={() => navigateWeek('prev')}
          disabled={!canNavigatePrev()}
          className={`rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 flex-shrink-0 ${isModal ? 'p-2' : 'p-1'} ${!canNavigatePrev() ? 'opacity-30 cursor-not-allowed' : ''}`}
        >
          <ChevronLeft className={`${isModal ? 'w-5 h-5' : 'w-4 h-4'}`} />
        </button>
        <span className={`font-medium text-gray-700 dark:text-gray-300 text-center flex-1 truncate ${isModal ? 'text-sm' : 'text-xs'}`}>
          {getDateRangeText()}
        </span>
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

      {/* Instructions */}
      <div className={`text-center ${isModal ? 'py-2 px-6 text-xs' : 'py-1 px-3 text-[10px]'} text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700`}>
        Click and drag to select a time range
      </div>

      {/* Calendar Grid */}
      <div
        ref={containerRef}
        className={`flex-1 overflow-y-auto min-h-0 ${isModal ? 'p-6' : 'p-3'}`}
        onMouseLeave={() => {
          setHoverDate(null);
          setHoverHour(null);
        }}
      >
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader className={`${isModal ? 'w-6 h-6' : 'w-5 h-5'} text-blue-600 dark:text-blue-400 animate-spin`} />
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {/* Time labels column + day columns */}
            <div className="flex">
              {/* Time labels */}
              <div className={`flex flex-col ${isModal ? 'w-12' : 'w-10'} flex-shrink-0`}>
                <div className={`${isModal ? 'h-8' : 'h-6'}`} />
                {HOURS.map(hour => (
                  <div
                    key={hour}
                    className={`${isModal ? 'h-7 text-[10px]' : 'h-5 text-[9px]'} text-gray-400 dark:text-gray-500 text-right pr-1.5 flex items-center justify-end`}
                  >
                    {hour === 0 ? '12a' : hour < 12 ? `${hour}a` : hour === 12 ? '12p' : `${hour - 12}p`}
                  </div>
                ))}
              </div>

              {/* Day columns */}
              <div className="flex-1 grid grid-cols-7 gap-1">
                {weekDays.map((date) => {
                  const dateStr = date.toISOString().split('T')[0];
                  const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
                  const dayNum = date.getDate();
                  const isToday = date.toDateString() === new Date().toDateString();

                  return (
                    <div key={dateStr} className="flex flex-col">
                      {/* Day header */}
                      <div className={`${isModal ? 'h-8' : 'h-6'} flex flex-col items-center justify-center ${isToday ? 'bg-blue-50 dark:bg-blue-900/30 rounded-t-lg' : ''}`}>
                        <span className={`${isModal ? 'text-[10px]' : 'text-[9px]'} font-medium text-gray-600 dark:text-gray-400`}>
                          {dayName}
                        </span>
                        <span className={`${isModal ? 'text-xs font-bold' : 'text-[10px] font-bold'} ${isToday ? 'text-blue-600 dark:text-blue-400' : 'text-gray-800 dark:text-gray-200'}`}>
                          {dayNum}
                        </span>
                      </div>

                      {/* Hour cells */}
                      {HOURS.map(hour => {
                        const hasConflict = hasConflictAt(date, hour);
                        const selected = isCellSelected(date, hour);
                        const hovered = isCellHovered(date, hour);
                        const past = isPast(date, hour);
                        const existingSelected = isSelectedSlot(date, hour);

                        return (
                          <div
                            key={hour}
                            onMouseDown={() => handleCellMouseDown(date, hour)}
                            onMouseEnter={() => handleCellMouseEnter(date, hour)}
                            className={`
                              ${isModal ? 'h-7' : 'h-5'} rounded border transition-colors cursor-pointer
                              ${past
                                ? 'bg-gray-50 dark:bg-gray-900 border-transparent opacity-30 cursor-not-allowed'
                                : hasConflict
                                  ? 'bg-gray-200 dark:bg-gray-700 border-gray-300 dark:border-gray-600 cursor-not-allowed'
                                  : selected || existingSelected
                                    ? 'bg-green-500 dark:bg-green-600 border-green-600 dark:border-green-700'
                                    : hovered
                                      ? 'bg-green-200 dark:bg-green-900/50 border-green-300 dark:border-green-700'
                                      : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-green-400 dark:hover:border-green-500 hover:bg-green-50 dark:hover:bg-green-900/20'
                              }
                            `}
                          />
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Existing events display */}
            {events.length > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                <p className={`${isModal ? 'text-xs' : 'text-[10px]'} font-medium text-gray-500 dark:text-gray-400 mb-2`}>
                  Existing events this week:
                </p>
                <div className="space-y-1">
                  {events.slice(0, 5).map((event, idx) => {
                    const start = new Date(event.start);
                    const end = new Date(event.end);
                    return (
                      <div key={idx} className={`${isModal ? 'text-xs' : 'text-[10px]'} text-gray-600 dark:text-gray-400`}>
                        <span className="font-medium">{event.summary}</span>
                        <span className="ml-2">
                          {start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} at {start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                        </span>
                      </div>
                    );
                  })}
                  {events.length > 5 && (
                    <p className={`${isModal ? 'text-xs' : 'text-[10px]'} text-gray-400`}>
                      +{events.length - 5} more events
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Selection Info */}
      {selectionInfo && dragState.isDragging && (
        <div className={`${isModal ? 'px-6 py-4' : 'px-3 py-2'} bg-green-50 dark:bg-green-900/20 border-t border-green-200 dark:border-green-800`}>
          <div className="flex items-center justify-between">
            <div>
              <p className={`${isModal ? 'text-sm' : 'text-xs'} font-medium text-green-900 dark:text-green-100`}>
                {selectionInfo.duration} minutes
              </p>
              <p className={`${isModal ? 'text-xs' : 'text-[10px]'} text-green-600 dark:text-green-400`}>
                {selectionInfo.start.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                {' '}
                {selectionInfo.start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                {' - '}
                {selectionInfo.end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
              </p>
              {selectionInfo.hasConflict && (
                <p className={`${isModal ? 'text-xs' : 'text-[10px]'} text-red-600 dark:text-red-400 mt-1`}>
                  ⚠️ Conflicts with existing events
                </p>
              )}
            </div>
            <div className={`flex items-center gap-1.5 ${selectionInfo.hasConflict ? 'opacity-50' : ''}`}>
              <Check className={`${isModal ? 'w-4 h-4' : 'w-3 h-3'} text-green-600 dark:text-green-400`} />
            </div>
          </div>
        </div>
      )}

      {/* Selected Time Display (non-dragging) */}
      {selectedSlot && !dragState.isDragging && (
        <div className={`${isModal ? 'px-6 py-4' : 'px-3 py-2'} bg-blue-50 dark:bg-blue-900/20 border-t border-blue-200 dark:border-blue-800`}>
          <div className="flex items-center justify-between">
            <div>
              <p className={`${isModal ? 'text-sm' : 'text-xs'} font-medium text-blue-900 dark:text-blue-100`}>
                {selectedSlot.dayName} at {selectedSlot.time}
              </p>
              <p className={`${isModal ? 'text-xs' : 'text-[10px]'} text-blue-600 dark:text-blue-400`}>
                {Math.round((new Date(selectedSlot.end).getTime() - new Date(selectedSlot.start).getTime()) / (1000 * 60))} minutes
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
