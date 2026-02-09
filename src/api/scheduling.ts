// API functions for scheduling links

import type {
  CreateSchedulingLinkRequest,
  CreateSchedulingLinkResponse,
  GetSchedulingLinksResponse,
  GetAvailabilityResponse,
  BookSlotRequest,
  BookSlotResponse,
  DeleteSchedulingLinkResponse,
} from '@/types/scheduling';

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
        console.log(`[scheduling API] Found oauth server on port ${port}`);
        return `http://localhost:${port}`;
      }
    } catch {
      // Port not available, try next
    }
  }
  console.log(`[scheduling API] No oauth server found, using default 8081`);
  return 'http://localhost:8081'; // fallback
}

let cachedServerURL: string | null = null;

async function serverURL(): Promise<string> {
  if (!cachedServerURL) {
    cachedServerURL = await getOAuthServerURL();
  }
  return cachedServerURL;
}

export async function createSchedulingLink(
  config: CreateSchedulingLinkRequest
): Promise<CreateSchedulingLinkResponse> {
  try {
    const baseURL = await serverURL();

    const response = await fetch(`${baseURL}/scheduling`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'create_link',
        ...config,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data: CreateSchedulingLinkResponse = await response.json();
    return data;
  } catch (error) {
    console.error('Failed to create scheduling link:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create scheduling link',
    };
  }
}

export async function getSchedulingLinks(): Promise<GetSchedulingLinksResponse> {
  try {
    const baseURL = await serverURL();

    const response = await fetch(`${baseURL}/scheduling`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'list_links',
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data: GetSchedulingLinksResponse = await response.json();
    return data;
  } catch (error) {
    console.error('Failed to fetch scheduling links:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch scheduling links',
    };
  }
}

export async function deleteSchedulingLink(
  linkId: string,
  eventId: string
): Promise<DeleteSchedulingLinkResponse> {
  try {
    const baseURL = await serverURL();

    const response = await fetch(`${baseURL}/scheduling`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'delete_link',
        link_id: linkId,
        event_id: eventId,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data: DeleteSchedulingLinkResponse = await response.json();
    return data;
  } catch (error) {
    console.error('Failed to delete scheduling link:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete scheduling link',
    };
  }
}

// Public API functions (can be called from booking page)
export async function getAvailabilityForLink(
  linkId: string
): Promise<GetAvailabilityResponse> {
  try {
    // For public booking page, use the current host
    const baseURL = window.location.origin;

    const response = await fetch(`${baseURL}/scheduling`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'get_availability',
        link_id: linkId,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data: GetAvailabilityResponse = await response.json();
    return data;
  } catch (error) {
    console.error('Failed to get availability:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get availability',
    };
  }
}

export async function bookTimeSlot(
  booking: BookSlotRequest
): Promise<BookSlotResponse> {
  try {
    // For public booking page, use the current host
    const baseURL = window.location.origin;

    const response = await fetch(`${baseURL}/scheduling`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'book_slot',
        ...booking,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data: BookSlotResponse = await response.json();
    return data;
  } catch (error) {
    console.error('Failed to book slot:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to book slot',
    };
  }
}
