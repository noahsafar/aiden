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
  startSlotIndex: number | null;
  currentSlotIndex: number | null;
}

interface PendingSelection {
  startDate: Date;
  startSlotIndex: number;
  endSlotIndex: number;
}

const SLOT_MINUTES = 15; // 15-minute intervals
const SLOTS_PER_HOUR = 60 / SLOT_MINUTES; // 4 slots per hour
const TOTAL_SLOTS = 24 * SLOTS_PER_HOUR; // 96 slots per day
const HOURS = Array.from({ length: 24 }, (_, i) => i);

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
    startSlotIndex: null,
    currentSlotIndex: null,
  });
  const [hoverDate, setHoverDate] = useState<Date | null>(null);
  const [hoverSlotIndex, setHoverSlotIndex] = useState<number | null>(null);
  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null);
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

  // Check if a specific 15-minute slot has conflicts
  const hasConflictAt = useCallback((date: Date, slotIndex: number): boolean => {
    const dateStr = date.toISOString().split('T')[0];
    const dayEvents = events.filter(e => e.date === dateStr);

    const slotStartMinutes = slotIndex * SLOT_MINUTES;
    const slotStart = new Date(date);
    slotStart.setHours(
      Math.floor(slotStartMinutes / 60),
      slotStartMinutes % 60,
      0, 0
    );

    const slotEnd = new Date(slotStart);
    slotEnd.setMinutes(slotEnd.getMinutes() + SLOT_MINUTES);

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
    if (!dragState.startDate || dragState.startSlotIndex === null) return null;

    const start = new Date(dragState.startDate);
    const startMinutes = dragState.startSlotIndex * SLOT_MINUTES;
    start.setHours(
      Math.floor(startMinutes / 60),
      startMinutes % 60,
      0, 0
    );

    let end: Date;
    if (dragState.isDragging && dragState.currentSlotIndex !== null) {
      end = new Date(dragState.startDate);
      const endSlotIndex = Math.max(dragState.currentSlotIndex, dragState.startSlotIndex) + 1;
      const endMinutes = endSlotIndex * SLOT_MINUTES;
      end.setHours(
        Math.floor(endMinutes / 60),
        endMinutes % 60,
        0, 0
      );
    } else {
      end = new Date(start);
      end.setMinutes(end.getMinutes() + SLOT_MINUTES);
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
  const handleCellMouseDown = (date: Date, slotIndex: number) => {
    const now = new Date();
    const cellDate = new Date(date);
    const cellMinutes = slotIndex * SLOT_MINUTES;
    cellDate.setHours(
      Math.floor(cellMinutes / 60),
      cellMinutes % 60,
      0, 0
    );

    if (cellDate < now) return;

    setDragState({
      isDragging: true,
      startDate: date,
      startSlotIndex: slotIndex,
      currentSlotIndex: slotIndex,
    });
  };

  // Handle mouse enter on a cell while dragging
  const handleCellMouseEnter = (date: Date, slotIndex: number) => {
    setHoverDate(date);
    setHoverSlotIndex(slotIndex);

    if (dragState.isDragging && dragState.startDate) {
      // Only allow dragging on the same day for now
      if (date.toDateString() === dragState.startDate.toDateString()) {
        setDragState(prev => ({ ...prev, currentSlotIndex: slotIndex }));
      }
    }
  };

  // Handle mouse up to end dragging
  const handleMouseUp = () => {
    if (dragState.isDragging && selectionInfo) {
      // Set pending selection even if there are conflicts
      setPendingSelection({
        startDate: dragState.startDate!,
        startSlotIndex: dragState.startSlotIndex!,
        endSlotIndex: dragState.currentSlotIndex!,
      });
    }

    setDragState({
      isDragging: false,
      startDate: null,
      startSlotIndex: null,
      currentSlotIndex: null,
    });
  };

  // Confirm the pending selection
  const handleConfirmPending = () => {
    if (!pendingSelection) return;

    const { startDate, startSlotIndex, endSlotIndex } = pendingSelection;
    const startIdx = Math.min(startSlotIndex, endSlotIndex);
    const endIdx = Math.max(startSlotIndex, endSlotIndex);

    const start = new Date(startDate);
    const startMinutes = startIdx * SLOT_MINUTES;
    start.setHours(
      Math.floor(startMinutes / 60),
      startMinutes % 60,
      0, 0
    );

    const end = new Date(startDate);
    const endMinutes = (endIdx + 1) * SLOT_MINUTES;
    end.setHours(
      Math.floor(endMinutes / 60),
      endMinutes % 60,
      0, 0
    );

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
    setPendingSelection(null);
  };

  // Cancel pending selection
  const handleCancelPending = () => {
    setPendingSelection(null);
  };

  // Get pending selection info for display
  const pendingSelectionInfo = useMemo(() => {
    if (!pendingSelection) return null;

    const { startDate, startSlotIndex, endSlotIndex } = pendingSelection;
    const startIdx = Math.min(startSlotIndex, endSlotIndex);
    const endIdx = Math.max(startSlotIndex, endSlotIndex);

    const start = new Date(startDate);
    const startMinutes = startIdx * SLOT_MINUTES;
    start.setHours(
      Math.floor(startMinutes / 60),
      startMinutes % 60,
      0, 0
    );

    const end = new Date(startDate);
    const endMinutes = (endIdx + 1) * SLOT_MINUTES;
    end.setHours(
      Math.floor(endMinutes / 60),
      endMinutes % 60,
      0, 0
    );

    const duration = Math.round((end.getTime() - start.getTime()) / (1000 * 60));
    const hasConflict = hasRangeConflict(start, end);

    return { start, end, duration, hasConflict };
  }, [pendingSelection, hasRangeConflict]);

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

  // Check if a cell is selected (during drag or pending)
  const isCellSelected = (date: Date, slotIndex: number): boolean => {
    // Check during active dragging
    if (dragState.isDragging && dragState.startDate && dragState.startSlotIndex !== null) {
      const sameDay = date.toDateString() === dragState.startDate.toDateString();
      if (sameDay) {
        const startIdx = Math.min(dragState.startSlotIndex, dragState.currentSlotIndex ?? dragState.startSlotIndex);
        const endIdx = Math.max(dragState.startSlotIndex, dragState.currentSlotIndex ?? dragState.startSlotIndex);
        return slotIndex >= startIdx && slotIndex <= endIdx;
      }
    }

    // Check pending selection
    if (pendingSelection) {
      const sameDay = date.toDateString() === pendingSelection.startDate.toDateString();
      if (sameDay) {
        const startIdx = Math.min(pendingSelection.startSlotIndex, pendingSelection.endSlotIndex);
        const endIdx = Math.max(pendingSelection.startSlotIndex, pendingSelection.endSlotIndex);
        return slotIndex >= startIdx && slotIndex <= endIdx;
      }
    }

    return false;
  };

  // Check if a cell is hovered
  const isCellHovered = (date: Date, slotIndex: number): boolean => {
    if (!hoverDate || hoverSlotIndex === null || !dragState.isDragging) return false;
    if (!dragState.startDate || dragState.startSlotIndex === null) return false;

    const sameDay = date.toDateString() === dragState.startDate.toDateString();
    if (!sameDay || date.toDateString() !== hoverDate.toDateString()) return false;

    const startIdx = Math.min(dragState.startSlotIndex, hoverSlotIndex);
    const endIdx = Math.max(dragState.startSlotIndex, hoverSlotIndex);

    return slotIndex >= startIdx && slotIndex <= endIdx;
  };

  // Check if cell is in past
  const isPast = (date: Date, slotIndex: number): boolean => {
    const now = new Date();
    const cellTime = new Date(date);
    const cellMinutes = slotIndex * SLOT_MINUTES;
    cellTime.setHours(
      Math.floor(cellMinutes / 60),
      cellMinutes % 60,
      0, 0
    );
    return cellTime < now;
  };

  // Check if selected slot matches a cell
  const isSelectedSlot = (date: Date, slotIndex: number): boolean => {
    if (!selectedSlot) return false;

    const selectedStart = new Date(selectedSlot.start);
    const selectedEnd = new Date(selectedSlot.end);

    const cellStart = new Date(date);
    const cellMinutes = slotIndex * SLOT_MINUTES;
    cellStart.setHours(
      Math.floor(cellMinutes / 60),
      cellMinutes % 60,
      0, 0
    );

    const cellEnd = new Date(cellStart);
    cellEnd.setMinutes(cellEnd.getMinutes() + SLOT_MINUTES);

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
        Click and drag to select a time range (15-minute intervals)
      </div>

      {/* Calendar Grid */}
      <div
        ref={containerRef}
        className={`flex-1 overflow-y-auto min-h-0 ${isModal ? 'p-6' : 'p-3'}`}
        onMouseLeave={() => {
          setHoverDate(null);
          setHoverSlotIndex(null);
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
              <div className={`flex flex-col ${isModal ? 'w-10' : 'w-9'} flex-shrink-0`}>
                <div className={`${isModal ? 'h-6' : 'h-5'}`} />
                {HOURS.map(hour => (
                  <div
                    key={hour}
                    className={`${isModal ? 'h-8' : 'h-6'} text-[8px] text-gray-400 dark:text-gray-500 text-right pr-1 flex items-start justify-end`}
                  >
                    {hour === 0 ? '12a' : hour < 12 ? `${hour}a` : hour === 12 ? '12p' : `${hour - 12}p`}
                  </div>
                ))}
              </div>

              {/* Day columns */}
              <div className="flex-1 grid grid-cols-7 gap-px bg-gray-200 dark:bg-gray-700">
                {weekDays.map((date) => {
                  const dateStr = date.toISOString().split('T')[0];
                  const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
                  const dayNum = date.getDate();
                  const isToday = date.toDateString() === new Date().toDateString();

                  return (
                    <div key={dateStr} className="flex flex-col bg-white dark:bg-gray-800">
                      {/* Day header */}
                      <div className={`${isModal ? 'h-6' : 'h-5'} flex flex-col items-center justify-center ${isToday ? 'bg-blue-50 dark:bg-blue-900/30' : ''} border-b border-gray-200 dark:border-gray-700`}>
                        <span className={`${isModal ? 'text-[9px]' : 'text-[8px]'} font-medium text-gray-600 dark:text-gray-400`}>
                          {dayName}
                        </span>
                        <span className={`${isModal ? 'text-[10px] font-bold' : 'text-[9px] font-bold'} ${isToday ? 'text-blue-600 dark:text-blue-400' : 'text-gray-800 dark:text-gray-200'}`}>
                          {dayNum}
                        </span>
                      </div>

                      {/* 15-minute slots - 4 per hour */}
                      <div className="flex-1 flex flex-col">
                        {Array.from({ length: 24 }).map((_, hourIdx) => (
                          <div key={hourIdx} className={`${isModal ? 'h-8' : 'h-6'} flex flex-col border-b border-gray-100 dark:border-gray-800`}>
                            {Array.from({ length: 4 }).map((_, quarterIdx) => {
                              const slotIndex = hourIdx * 4 + quarterIdx;
                              const minutes = slotIndex * SLOT_MINUTES;
                              const hasConflict = hasConflictAt(date, slotIndex);
                              const selected = isCellSelected(date, slotIndex);
                              const hovered = isCellHovered(date, slotIndex);
                              const past = isPast(date, slotIndex);
                              // Don't show old confirmed slot if we have a pending selection waiting to be confirmed
                              const existingSelected = !pendingSelection && isSelectedSlot(date, slotIndex);

                              return (
                                <div
                                  key={slotIndex}
                                  onMouseDown={() => handleCellMouseDown(date, slotIndex)}
                                  onMouseEnter={() => handleCellMouseEnter(date, slotIndex)}
                                  className={`flex-1 transition-colors
                                    ${past
                                      ? 'bg-gray-50 dark:bg-gray-900 opacity-30 cursor-not-allowed'
                                      : hasConflict
                                        ? 'bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50 cursor-pointer'
                                        : selected || existingSelected
                                          ? 'bg-green-500 dark:bg-green-600'
                                          : hovered
                                            ? 'bg-green-200 dark:bg-green-900/50'
                                            : 'bg-white dark:bg-gray-800 hover:bg-green-50 dark:hover:bg-green-900/20 cursor-pointer'
                                    }
                                  `}
                                />
                              );
                            })}
                          </div>
                        ))}
                      </div>
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

      {/* Selection Info (during drag) */}
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

      {/* Pending Selection Display */}
      {pendingSelectionInfo && !dragState.isDragging && (
        <div className={`${isModal ? 'px-6 py-4' : 'px-3 py-2'} bg-blue-50 dark:bg-blue-900/20 border-t border-blue-200 dark:border-blue-800`}>
          <div className="flex items-center justify-between">
            <div>
              <p className={`${isModal ? 'text-sm' : 'text-xs'} font-medium text-blue-900 dark:text-blue-100`}>
                {pendingSelectionInfo.duration} minutes
              </p>
              <p className={`${isModal ? 'text-xs' : 'text-[10px]'} text-blue-700 dark:text-blue-300`}>
                {pendingSelectionInfo.start.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                {' '}
                {pendingSelectionInfo.start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                {' - '}
                {pendingSelectionInfo.end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
              </p>
              {pendingSelectionInfo.hasConflict && (
                <p className={`${isModal ? 'text-xs' : 'text-[10px]'} text-red-600 dark:text-red-400 mt-1`}>
                  ⚠️ Conflicts with existing events
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCancelPending}
                className={`${isModal ? 'px-3 py-1.5 text-xs' : 'px-2 py-1 text-[10px]'} bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 font-medium rounded-lg transition-colors`}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmPending}
                className={`${isModal ? 'px-4 py-2 text-sm' : 'px-3 py-1.5 text-xs'} bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors`}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Selected Time Display (already confirmed) */}
      {selectedSlot && !dragState.isDragging && !pendingSelection && (
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
