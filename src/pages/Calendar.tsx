import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Loader2, List, Calendar as CalendarView, Columns, LogOut, Plus } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { invoke } from '@tauri-apps/api/core';
import { fetchEvents, CalendarEvent } from '@/api/calendar';
import { useChatStore } from '@/stores/chatStore';
import { CreateEventModal } from '@/components/calendar/CreateEventModal';
import logo from '/aiden-logo.png';

type ViewMode = 'list' | 'month' | 'week';

interface GroupedEvents {
  [date: string]: CalendarEvent[];
}

interface AppSettings {
  timezone?: string;
}

export function Calendar() {
  const navigate = useNavigate();
  const { signOut, user } = useAuthStore();
  const { isOpen: isChatOpen } = useChatStore();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewDate, setViewDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [error, setError] = useState<string | null>(null);
  const [timezone, setTimezone] = useState<string>('America/New_York');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Load settings to get timezone
  useEffect(() => {
    invoke<AppSettings>('get_settings').then(settings => {
      console.log('[Calendar] Loaded settings:', settings);
      if (settings?.timezone) {
        console.log('[Calendar] Setting timezone from settings:', settings.timezone);
        setTimezone(settings.timezone);
      } else {
        console.log('[Calendar] No timezone in settings, using default: America/New_York');
      }
    }).catch((err) => {
      console.log('[Calendar] Error loading settings, using default timezone:', err);
      // Use default timezone
    });
  }, []);

  const loadEvents = async (startDate: Date, endDate: Date) => {
    setLoading(true);
    setError(null);
    try {
      const startStr = startDate.toISOString().split('T')[0];
      const endStr = endDate.toISOString().split('T')[0];

      console.log('[Calendar] Loading events with timezone:', timezone);
      const response = await fetchEvents(startStr, endStr, timezone);
      if (response.success) {
        setEvents(response.events);
      } else {
        setError(response.error || 'Failed to load events');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load events');
    } finally {
      setLoading(false);
    }
  };

  // Load events based on current view mode and date
  useEffect(() => {
    const start = new Date(viewDate);
    const end = new Date(viewDate);

    if (viewMode === 'month') {
      // Start from first day of the month
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      // End at last day of the month (next month - 1 day)
      end.setMonth(end.getMonth() + 1);
      end.setDate(0);
      end.setHours(23, 59, 59);
    } else if (viewMode === 'week') {
      // Start from Sunday of the current week
      const dayOfWeek = start.getDay();
      start.setDate(start.getDate() - dayOfWeek);
      start.setHours(0, 0, 0, 0);
      // End at Saturday of the same week
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59);
    } else {
      // List view: show 30 days from the current view date
      start.setHours(0, 0, 0, 0);
      end.setDate(end.getDate() + 30);
      end.setHours(23, 59, 59);
    }

    loadEvents(start, end);
  }, [viewDate, viewMode, timezone, refreshKey]);

  const navigateDate = (direction: 'prev' | 'next') => {
    const newDate = new Date(viewDate);
    if (viewMode === 'month') {
      newDate.setMonth(newDate.getMonth() + (direction === 'next' ? 1 : -1));
    } else if (viewMode === 'week') {
      newDate.setDate(newDate.getDate() + (direction === 'next' ? 7 : -7));
    } else {
      newDate.setDate(newDate.getDate() + (direction === 'next' ? 30 : -30));
    }
    setViewDate(newDate);
  };

  const goToToday = () => {
    setViewDate(new Date());
  };

  // Get date range display text
  const getDateRangeText = () => {
    const start = new Date(viewDate);
    const end = new Date(viewDate);

    if (viewMode === 'month') {
      return start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    } else if (viewMode === 'week') {
      const weekStart = new Date(start);
      weekStart.setDate(start.getDate() - start.getDay());
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);

      const sameMonth = weekStart.getMonth() === weekEnd.getMonth();
      const startFormat = sameMonth ? 'MMM d' : 'MMM d, yyyy';
      return `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    } else {
      end.setDate(end.getDate() + 30);
      const startStr = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const endStr = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      return `${startStr} - ${endStr}`;
    }
  };

  // Group events by date
  const groupedEvents = events.reduce((groups: GroupedEvents, event) => {
    if (!groups[event.date]) {
      groups[event.date] = [];
    }
    groups[event.date].push(event);
    groups[event.date].sort((a, b) => a.start.localeCompare(b.start));
    return groups;
  }, {});

  const sortedDates = Object.keys(groupedEvents).sort();

  // Format date for display
  const formatDateDisplay = (dateStr: string) => {
    const date = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const isToday = date.toDateString() === today.toDateString();
    const isTomorrow = date.toDateString() === tomorrow.toDateString();

    if (isToday) return 'Today';
    if (isTomorrow) return 'Tomorrow';

    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  };

  // Month view helpers
  const getMonthGrid = () => {
    const date = new Date(viewDate);
    const year = date.getFullYear();
    const month = date.getMonth();

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDay = firstDay.getDay();
    const daysInMonth = lastDay.getDate();

    const grid: (Date | null)[] = [];
    // Fill in days before the first day of month
    for (let i = 0; i < startDay; i++) {
      grid.push(null);
    }
    // Fill in days of the month
    for (let i = 1; i <= daysInMonth; i++) {
      grid.push(new Date(year, month, i));
    }
    return grid;
  };

  const getEventsForDate = (date: Date) => {
    const dateStr = date.toISOString().split('T')[0];
    return groupedEvents[dateStr] || [];
  };

  const isToday = (date: Date) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date.toDateString() === today.toDateString();
  };

  // Week view helpers
  const getWeekDays = () => {
    const start = new Date(viewDate);
    const dayOfWeek = start.getDay();
    start.setDate(start.getDate() - dayOfWeek);
    start.setHours(0, 0, 0, 0);

    const days: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(start);
      day.setDate(start.getDate() + i);
      days.push(day);
    }
    return days;
  };

  // Render List View
  const renderListView = () => {
    if (sortedDates.length === 0) {
      return (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-8 text-center">
          <CalendarIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No upcoming events</h3>
          <p className="text-gray-500 dark:text-gray-400">You don't have any events scheduled for this period.</p>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {sortedDates.map((dateStr) => (
          <div key={dateStr} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="px-4 py-2 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
              <h3 className="font-semibold text-gray-900 dark:text-white text-sm">
                {formatDateDisplay(dateStr)}
              </h3>
            </div>
            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {groupedEvents[dateStr].map((event) => (
                <div
                  key={event.id}
                  className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-16 text-sm">
                      {event.all_day ? (
                        <span className="text-gray-500 dark:text-gray-400">All day</span>
                      ) : (
                        <div className="text-gray-900 dark:text-white font-medium">
                          {event.time}
                          {event.end_time && (
                            <span className="text-gray-500 font-normal">
                              {' - '}{event.end_time}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-900 dark:text-white font-medium truncate">
                        {event.summary}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  };

  // Render Month View
  const renderMonthView = () => {
    const grid = getMonthGrid();
    const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-gray-200 dark:border-gray-700">
          {weekDays.map((day) => (
            <div key={day} className="px-1 py-1 text-center text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/50">
              {day}
            </div>
          ))}
        </div>
        {/* Calendar grid */}
        <div className="grid grid-cols-7 auto-rows-fr">
          {grid.map((date, index) => {
            const eventsForDay = date ? getEventsForDate(date) : [];
            return (
              <div
                key={index}
                className={`h-28 border-b border-r border-gray-200 dark:border-gray-700 p-0.5 ${
                  !date ? 'bg-gray-50/50 dark:bg-gray-900/30' : ''
                }`}
              >
                {date && (
                  <>
                    <div className={`text-xs font-medium mb-1 text-center rounded ${
                      isToday(date)
                        ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400'
                        : 'text-gray-900 dark:text-white'
                    }`}>
                      {date.getDate()}
                    </div>
                    <div className="space-y-0.5 overflow-y-auto max-h-20 pr-1 thin-scroll">
                      {eventsForDay.map((event) => (
                        <div
                          key={event.id}
                          className="text-[10px] px-1 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300 truncate cursor-pointer leading-tight"
                          title={`${event.all_day ? 'All day' : event.time}${event.end_time ? ` - ${event.end_time}` : ''}: ${event.summary}`}
                        >
                          {event.all_day ? event.summary : `${event.time} ${event.summary}`}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // Render Week View
  const renderWeekView = () => {
    const weekDays = getWeekDays();
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="grid grid-cols-7 border-b border-gray-200 dark:border-gray-700">
          {weekDays.map((date, index) => (
            <div key={index} className="text-center border-r border-gray-200 dark:border-gray-700 last:border-r-0">
              <div className="px-2 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/50">
                {dayNames[index]}
              </div>
              <div className={`py-2 text-sm font-medium ${
                isToday(date)
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-gray-900 dark:text-white'
              }`}>
                {date.getDate()}
              </div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 divide-x divide-gray-200 dark:divide-gray-700">
          {weekDays.map((date) => {
            const eventsForDay = getEventsForDate(date);
            const dateStr = date.toISOString().split('T')[0];
            return (
              <div key={dateStr} className="min-h-64 p-2">
                <div className="space-y-2">
                  {eventsForDay.map((event) => (
                    <div
                      key={event.id}
                      className="text-xs p-2 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300"
                      title={event.summary}
                    >
                      <div className="font-medium truncate">{event.summary}</div>
                      {!event.all_day && (
                        <div className="text-blue-600 dark:text-blue-400 mt-0.5">
                          {event.time}{event.end_time && ` - ${event.end_time}`}
                        </div>
                      )}
                    </div>
                  ))}
                  {eventsForDay.length === 0 && (
                    <div className="text-xs text-gray-400 dark:text-gray-600 text-center py-4">
                      No events
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="h-14 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4 z-10">
        <div className="flex items-center gap-0">
          <Link to="/dashboard" className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors mr-2">
            <ChevronLeft className="h-4 w-4 text-gray-600 dark:text-gray-400" />
          </Link>
          <img
            src={logo}
            alt="Aiden Logo"
            className="h-8 w-8"
          />
          <div className="flex items-center">
            <h1 className="text-lg font-semibold text-gray-900 dark:text-white leading-none">Aiden</h1>
            <span className="text-sm text-gray-500 leading-tight pt-0.5 ml-1.5">/ Calendar</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500 hidden sm:block">
            {user ? user.email : 'Not logged in'}
          </span>
          <button
            onClick={signOut}
            className="p-2 text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20 rounded-lg transition-colors"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Content */}
      <main className={`max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 transition-all duration-300 ease-in-out ${isChatOpen ? 'mr-[400px]' : ''}`}>
        {/* Header with title and navigation */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
              <CalendarIcon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Calendar</h2>
              <p className="text-gray-600 dark:text-gray-400 text-sm">{getDateRangeText()}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* New Event button */}
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="h-4 w-4" />
              New Event
            </button>

            {/* View mode selector */}
            <div className="flex items-center bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
              <button
                onClick={() => setViewMode('list')}
                className={`p-2 transition-colors ${viewMode === 'list' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                title="List view"
              >
                <List className="h-4 w-4" />
              </button>
              <button
                onClick={() => setViewMode('week')}
                className={`p-2 transition-colors ${viewMode === 'week' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                title="Week view"
              >
                <Columns className="h-4 w-4" />
              </button>
              <button
                onClick={() => setViewMode('month')}
                className={`p-2 transition-colors ${viewMode === 'month' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                title="Month view"
              >
                <CalendarView className="h-4 w-4" />
              </button>
            </div>

            {/* Date navigation */}
            <div className="flex items-center bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
              <button
                onClick={() => navigateDate('prev')}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                title="Previous"
              >
                <ChevronLeft className="h-4 w-4 text-gray-600 dark:text-gray-400" />
              </button>
              <button
                onClick={goToToday}
                className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors border-l border-r border-gray-300 dark:border-gray-600"
              >
                Today
              </button>
              <button
                onClick={() => navigateDate('next')}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                title="Next"
              >
                <ChevronRight className="h-4 w-4 text-gray-600 dark:text-gray-400" />
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="overflow-y-auto scrollbar-gutter-stable">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Loader2 className="h-8 w-8 text-blue-600 dark:text-blue-400 animate-spin mb-4" />
              <p className="text-gray-600 dark:text-gray-400">Loading events...</p>
            </div>
          ) : error ? (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-8 text-center">
              <p className="text-red-800 dark:text-red-300 mb-4">{error}</p>
              <button
                onClick={() => loadEvents(viewDate, new Date(viewDate.getTime() + 30 * 24 * 60 * 60 * 1000))}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium text-sm transition-colors"
              >
                Retry
              </button>
            </div>
          ) : (
            <>
              {viewMode === 'list' && renderListView()}
              {viewMode === 'month' && renderMonthView()}
              {viewMode === 'week' && renderWeekView()}
            </>
          )}
        </div>
      </main>

      <CreateEventModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onEventCreated={() => setRefreshKey(k => k + 1)}
        timezone={timezone}
      />
    </div>
  );
}
