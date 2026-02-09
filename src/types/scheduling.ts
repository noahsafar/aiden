// Types for scheduling/booking functionality

export interface SchedulingLinkConfig {
  title: string;
  duration: number; // in minutes
  description: string;
  timezone: string;
  availability: AvailabilityConfig;
}

export interface AvailabilityConfig {
  days: DayOfWeek[];
  start_hour: number; // 0-23
  end_hour: number; // 0-23
  buffer_minutes?: number;
}

export type DayOfWeek = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

export interface SchedulingLink {
  id: string;
  event_id: string;
  title: string;
  duration: number;
  description: string;
  timezone: string;
  availability: AvailabilityConfig;
  created_at: string;
  public_url: string;
}

export interface TimeSlot {
  date: string; // YYYY-MM-DD
  date_display: string; // e.g., "Monday, January 15"
  time: string; // e.g., "9:00 AM"
  start: string; // ISO datetime
  end: string; // ISO datetime
}

export interface CreateSchedulingLinkRequest {
  title: string;
  duration: number;
  description: string;
  timezone: string;
  availability: AvailabilityConfig;
}

export interface CreateSchedulingLinkResponse {
  success: boolean;
  link_id?: string;
  event_id?: string;
  public_url?: string;
  error?: string;
}

export interface GetSchedulingLinksResponse {
  success: boolean;
  links?: SchedulingLink[];
  error?: string;
}

export interface GetAvailabilityResponse {
  success: boolean;
  link_config?: {
    title: string;
    duration: number;
    description: string;
    timezone: string;
  };
  available_slots?: TimeSlot[];
  error?: string;
}

export interface BookSlotRequest {
  link_id: string;
  name: string;
  email: string;
  message?: string;
  selected_slot: string; // ISO datetime
}

export interface BookSlotResponse {
  success: boolean;
  event_id?: string;
  html_link?: string;
  error?: string;
}

export interface DeleteSchedulingLinkResponse {
  success: boolean;
  error?: string;
}
