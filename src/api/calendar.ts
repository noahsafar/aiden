// API functions for fetching calendar events from OAuth server

export interface CalendarEvent {
  id: string;
  summary: string;
  start: string;  // ISO datetime
  end: string;    // ISO datetime
  date: string;   // YYYY-MM-DD
  time: string;   // formatted time like "2:00 PM"
  end_time: string; // formatted end time
  all_day: boolean;
}

export interface EventsResponse {
  success: boolean;
  events: CalendarEvent[];
  error?: string;
}

// Try to find the oauth server on ports 8081-8085
async function getOAuthServerURL(): Promise<string> {
  const ports = [8081, 8082, 8083, 8084, 8085];
  for (const port of ports) {
    try {
      const response = await fetch(`http://localhost:${port}/`, {
        method: 'GET',
        signal: AbortSignal.timeout(500)
      });
      if (response.ok) {
        console.log(`[serverURL] Found oauth server on port ${port}`);
        return `http://localhost:${port}`;
      }
    } catch {
      // Port not available, try next
    }
  }
  console.log(`[serverURL] No oauth server found, using default 8081`);
  return 'http://localhost:8081'; // fallback
}

let cachedServerURL: string | null = null;

async function serverURL(): Promise<string> {
  if (!cachedServerURL) {
    cachedServerURL = await getOAuthServerURL();
  }
  return cachedServerURL;
}

async function fetchEventsOnce(
  baseURL: string,
  startDate: string,
  endDate?: string,
  timezone?: string
): Promise<EventsResponse> {
  const userTimezone = timezone || 'America/New_York';

  const response = await fetch(`${baseURL}/calendar`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: 'fetch_events',
      timezone: userTimezone,
      data: {
        start_date: startDate,
        end_date: endDate,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data: EventsResponse = await response.json();

  if (!data.events || !Array.isArray(data.events)) {
    return {
      success: false,
      events: [],
      error: data.error || 'Invalid response from server'
    };
  }

  return data;
}

export async function fetchEvents(
  startDate: string = 'today',
  endDate?: string,
  timezone?: string
): Promise<EventsResponse> {
  const MAX_RETRIES = 2;
  const baseURL = await serverURL();

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fetchEventsOnce(baseURL, startDate, endDate, timezone);
    } catch (error) {
      const isLastAttempt = attempt === MAX_RETRIES;
      if (isLastAttempt) {
        console.error('Failed to fetch calendar events after retries:', error);
        return {
          success: false,
          events: [],
          error: error instanceof Error ? error.message : 'Failed to fetch events'
        };
      }
      // Wait briefly before retrying (500ms, then 1000ms)
      await new Promise(r => setTimeout(r, (attempt + 1) * 500));
    }
  }

  // Unreachable, but TypeScript needs it
  return { success: false, events: [], error: 'Unexpected error' };
}
