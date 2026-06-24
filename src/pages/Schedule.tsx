import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Plus, Sparkles, CalendarDays, Link2, RefreshCw, Clock, MapPin, Video } from 'lucide-react';
import {
  SurfaceHeader,
  Surface,
  SectionLabel,
  SoftButton,
  EmptyState,
} from '@/components/aiden/primitives';
import { fetchEvents, CalendarEvent } from '@/api/calendar';
import { CreateEventModal } from '@/components/calendar/CreateEventModal';
import { invoke } from '@tauri-apps/api/core';
import { cn } from '@/lib/utils';

function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const FALLBACK: CalendarEvent[] = (() => {
  const today = new Date();
  const tomorrow = new Date(Date.now() + 86400000);
  return [
    { id: 'f1', summary: 'Team sync', start: '', end: '', date: dateStr(today), time: '10:00 AM', end_time: '10:30 AM', all_day: false },
    { id: 'f2', summary: 'Investor meeting — Sarah Chen', start: '', end: '', date: dateStr(today), time: '2:00 PM', end_time: '2:45 PM', all_day: false },
    { id: 'f3', summary: '1:1 with Marcus Lee', start: '', end: '', date: dateStr(tomorrow), time: '11:00 AM', end_time: '11:30 AM', all_day: false },
    { id: 'f4', summary: 'Acme pricing review', start: '', end: '', date: dateStr(tomorrow), time: '3:30 PM', end_time: '4:15 PM', all_day: false },
  ];
})();

export const Schedule: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [prefillAttendee, setPrefillAttendee] = useState<string | undefined>(undefined);
  const [timezone, setTimezone] = useState('America/New_York');
  const [refreshKey, setRefreshKey] = useState(0);

  // Deep link from "Schedule time with X" → open the create modal pre-filled.
  useEffect(() => {
    const withWhom = (location.state as any)?.with as string | undefined;
    if (withWhom) {
      setPrefillAttendee(withWhom);
      setShowCreate(true);
      // clear so navigating back/refresh doesn't reopen
      window.history.replaceState({}, '');
    }
  }, [location.state]);

  useEffect(() => {
    invoke<{ timezone?: string }>('get_settings')
      .then((s) => s?.timezone && setTimezone(s.timezone))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const start = new Date();
    const end = new Date(Date.now() + 14 * 86400000);
    fetchEvents(dateStr(start), dateStr(end), timezone)
      .then((res) => {
        if (cancelled) return;
        setEvents(res.events?.length ? res.events : FALLBACK);
      })
      .catch(() => {
        if (!cancelled) setEvents(FALLBACK);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [timezone, refreshKey]);

  const grouped = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of [...events].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))) {
      const arr = map.get(e.date) || [];
      arr.push(e);
      map.set(e.date, arr);
    }
    return [...map.entries()];
  }, [events]);

  return (
    <div className="animate-fade-in space-y-8">
      <SurfaceHeader
        title="Schedule"
        subtitle="Your next two weeks, with prep ready before every meeting."
        actions={
          <>
            <SoftButton variant="ghost" icon={<RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />} onClick={() => setRefreshKey((k) => k + 1)}>
              Refresh
            </SoftButton>
            <SoftButton variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setShowCreate(true)}>
              New event
            </SoftButton>
          </>
        }
      />

      {loading ? (
        <Surface tone="subtle" className="px-6 py-10 text-center text-sm text-muted">
          Loading your schedule…
        </Surface>
      ) : grouped.length === 0 ? (
        <EmptyState icon={<CalendarDays className="h-5 w-5" />} title="Nothing scheduled" description="Your next two weeks are clear." >
          <SoftButton variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setShowCreate(true)}>
            Create an event
          </SoftButton>
        </EmptyState>
      ) : (
        <div className="space-y-7">
          {grouped.map(([date, evs]) => (
            <div key={date}>
              <SectionLabel dot="sky">{prettyDay(date)}</SectionLabel>
              <Surface className="divide-y divide-gray-100 dark:divide-white/[0.06]">
                {evs.map((ev) => (
                  <EventRow key={ev.id} event={ev} />
                ))}
              </Surface>
            </div>
          ))}
        </div>
      )}

      {/* Booking links */}
      <Surface tone="subtle" interactive className="flex items-center gap-4 px-5 py-4" onClick={() => navigate('/scheduling')}>
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-50 dark:bg-violet-500/10">
          <Link2 className="h-5 w-5 text-violet-500" />
        </div>
        <div className="flex-1">
          <h3 className="text-[15px] font-semibold text-foreground">Booking links</h3>
          <p className="text-[13px] text-muted">Share your availability and let others book time with you.</p>
        </div>
        <SoftButton variant="soft">Manage</SoftButton>
      </Surface>

      <CreateEventModal
        isOpen={showCreate}
        onClose={() => { setShowCreate(false); setPrefillAttendee(undefined); }}
        onEventCreated={() => setRefreshKey((k) => k + 1)}
        timezone={timezone}
        initialAttendees={prefillAttendee}
      />
    </div>
  );
};

const EventRow: React.FC<{ event: CalendarEvent }> = ({ event }) => {
  const navigate = useNavigate();
  const cleanDescription = (event.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  const openLink = async (url: string) => {
    try {
      const { invoke: inv } = await import('@tauri-apps/api/core');
      await inv('open_file', { path: url });
    } catch {
      window.open(url, '_blank');
    }
  };

  return (
    <div className="flex items-start gap-4 px-5 py-4">
      <div className="w-20 flex-shrink-0 pt-0.5">
        {event.all_day ? (
          <span className="text-[13px] font-medium text-muted">All day</span>
        ) : (
          <>
            <div className="flex items-center gap-1 text-[14px] font-semibold tabular-nums text-foreground">
              <Clock className="h-3 w-3 text-muted" />
              {event.time}
            </div>
            {event.end_time && <div className="ml-4 text-[12px] text-muted/60">{event.end_time}</div>}
          </>
        )}
      </div>
      <div className="mt-0.5 h-9 w-px flex-shrink-0 bg-gray-200 dark:bg-white/10" />
      <div className="min-w-0 flex-1">
        <h3 className="text-[15px] font-medium text-foreground">{event.summary}</h3>
        {(event.location || cleanDescription) && (
          <div className="mt-1 space-y-1">
            {event.location && (
              <div className="flex items-start gap-1.5">
                <MapPin className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-muted/40" />
                <span className="text-[12px] text-muted/70 leading-snug">{event.location}</span>
              </div>
            )}
            {cleanDescription && (
              <p className="line-clamp-2 text-[12px] leading-relaxed text-muted/60">{cleanDescription}</p>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-shrink-0 items-center gap-2">
        {event.meeting_link && (
          <SoftButton variant="soft" icon={<Video className="h-3.5 w-3.5" />} onClick={() => openLink(event.meeting_link!)}>
            Join
          </SoftButton>
        )}
        <SoftButton
          variant="primary"
          icon={<Sparkles className="h-3.5 w-3.5" />}
          onClick={() => navigate('/ask', { state: { event, run: true } })}
        >
          Prep me
        </SoftButton>
      </div>
    </div>
  );
};

function prettyDay(date: string): string {
  const d = new Date(date + 'T12:00:00');
  const today = new Date();
  const tomorrow = new Date(Date.now() + 86400000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

export default Schedule;
