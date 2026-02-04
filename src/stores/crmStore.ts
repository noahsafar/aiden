import { create } from 'zustand';

// Use mock data for development
const USE_MOCK_DATA = true;

export interface Contact {
  id: string;
  email_address: string;
  name?: string;
  domain?: string;
  first_seen: number;
  last_contacted?: number;
  total_emails_received: number;
  total_emails_sent: number;
  total_threads: number;
  relationship_score: number;
  category: 'Colleague' | 'Client' | 'Vendor' | 'Friend' | 'Family' | 'Other';
  is_vip: boolean;
  avg_response_time_minutes?: number;
  last_response_time?: number;
  notes?: string;
  days_since_contact?: number;
}

export interface EmailInteraction {
  id: string;
  email_id: string;
  contact_id: string;
  direction: 'Incoming' | 'Outgoing';
  timestamp: number;
  response_time_minutes?: number;
  thread_depth?: number;
  was_initiator: boolean;
}

export interface ContactAnalytics {
  contact_id: string;
  email_address: string;
  name?: string;
  total_emails: number;
  emails_sent: number;
  emails_received: number;
  first_contact: number;
  last_contact: number;
  avg_response_time_minutes?: number;
  response_times: number[];
  interaction_frequency: InteractionFrequency[];
  relationship_score: number;
}

export interface InteractionFrequency {
  date: string;
  count: number;
  sent: number;
  received: number;
}

export interface NetworkNode {
  id: string;
  label: string;
  value: number;
  category: string;
  score: number;
}

export interface NetworkLink {
  source: string;
  target: string;
  value: number;
  strength: number;
}

export interface NetworkData {
  nodes: NetworkNode[];
  links: NetworkLink[];
}

interface HeatmapData {
  contactId: string;
  contactName: string;
  emailAddress: string;
  data: { day: string; hour: number; count: number }[];
}

export interface CrmState {
  // State
  contacts: Contact[];
  selectedContact: Contact | null;
  analytics: ContactAnalytics | null;
  networkData: NetworkData | null;
  staleContacts: Contact[];
  topContacts: Contact[];
  heatmapData: HeatmapData[];
  isLoading: boolean;
  error: string | null;
  hasExtractedContacts: boolean;

  // Actions
  extractContacts: () => Promise<void>;
  fetchContacts: (limit?: number, offset?: number) => Promise<void>;
  fetchContact: (contactId: string) => Promise<void>;
  setSelectedContact: (contact: Contact | null) => void;
  updateContactVIP: (contactId: string, isVIP: boolean) => Promise<void>;
  updateContactNotes: (contactId: string, notes: string) => Promise<void>;
  fetchContactAnalytics: (contactId: string) => Promise<void>;
  fetchNetworkData: (minEmails?: number, limit?: number) => Promise<void>;
  fetchStaleContacts: (daysThreshold?: number) => Promise<void>;
  fetchTopContacts: (limit?: number) => Promise<void>;
  generateHeatmapData: () => Promise<void>;
  refreshAll: () => Promise<void>;
}

export const useCrmStore = create<CrmState>((set, get) => ({
  // Initial state
  contacts: [],
  selectedContact: null,
  analytics: null,
  networkData: null,
  staleContacts: [],
  topContacts: [],
  heatmapData: [],
  isLoading: false,
  error: null,
  hasExtractedContacts: false,

  extractContacts: async () => {
    if (USE_MOCK_DATA) {
      // Use mock data for development
      set({
        contacts: mockContacts,
        hasExtractedContacts: true,
        isLoading: false
      });
      return;
    }

    try {
      set({ isLoading: true, error: null });
      const { invoke } = await import('@tauri-apps/api/core');
      const contacts = await invoke<Contact[]>('extract_contacts_from_emails');
      set({ contacts, hasExtractedContacts: true, isLoading: false });
    } catch (error) {
      console.error('Failed to extract contacts:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to extract contacts',
        isLoading: false
      });
    }
  },

  fetchContacts: async (limit = 100, offset = 0) => {
    if (USE_MOCK_DATA) {
      // Use mock data for development
      set({
        contacts: mockContacts.slice(offset, offset + limit),
        isLoading: false
      });
      return;
    }

    try {
      set({ isLoading: true, error: null });
      const { invoke } = await import('@tauri-apps/api/core');
      const contacts = await invoke<Contact[]>('get_contacts', { limit, offset });
      set({ contacts, isLoading: false });
    } catch (error) {
      console.error('Failed to fetch contacts:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch contacts',
        isLoading: false
      });
    }
  },

  fetchContact: async (contactId: string) => {
    if (USE_MOCK_DATA) {
      const contact = mockContacts.find(c => c.id === contactId) || null;
      set({ selectedContact: contact });
      return;
    }

    try {
      set({ isLoading: true, error: null });
      const { invoke } = await import('@tauri-apps/api/core');
      const contact = await invoke<Contact | null>('get_contact', { contactId });
      set({ selectedContact: contact, isLoading: false });
    } catch (error) {
      console.error('Failed to fetch contact:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch contact',
        isLoading: false
      });
    }
  },

  setSelectedContact: (contact: Contact | null) => {
    set({ selectedContact: contact });
  },

  updateContactVIP: async (contactId: string, isVIP: boolean) => {
    if (USE_MOCK_DATA) {
      // Update local state for mock data
      set((state) => ({
        contacts: state.contacts.map(c =>
          c.id === contactId ? { ...c, is_vip: isVIP } : c
        ),
        selectedContact: state.selectedContact?.id === contactId
          ? { ...state.selectedContact, is_vip: isVIP }
          : state.selectedContact
      }));
      return;
    }

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('update_contact_vip_status', { contactId, isVip: isVIP });
      set((state) => ({
        contacts: state.contacts.map(c =>
          c.id === contactId ? { ...c, is_vip: isVIP } : c
        ),
        selectedContact: state.selectedContact?.id === contactId
          ? { ...state.selectedContact, is_vip: isVIP }
          : state.selectedContact
      }));
    } catch (error) {
      console.error('Failed to update VIP status:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to update VIP status'
      });
    }
  },

  updateContactNotes: async (contactId: string, notes: string) => {
    if (USE_MOCK_DATA) {
      // Update local state for mock data
      set((state) => ({
        contacts: state.contacts.map(c =>
          c.id === contactId ? { ...c, notes } : c
        ),
        selectedContact: state.selectedContact?.id === contactId
          ? { ...state.selectedContact, notes }
          : state.selectedContact
      }));
      return;
    }

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('update_contact_notes', { contactId, notes });
      set((state) => ({
        contacts: state.contacts.map(c =>
          c.id === contactId ? { ...c, notes } : c
        ),
        selectedContact: state.selectedContact?.id === contactId
          ? { ...state.selectedContact, notes }
          : state.selectedContact
      }));
    } catch (error) {
      console.error('Failed to update notes:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to update notes'
      });
    }
  },

  fetchContactAnalytics: async (contactId: string) => {
    if (USE_MOCK_DATA) {
      // Use mock analytics
      const mockAnalytics: ContactAnalytics = {
        contact_id: contactId,
        email_address: mockContacts.find(c => c.id === contactId)?.email_address || '',
        name: mockContacts.find(c => c.id === contactId)?.name,
        total_emails: 45,
        emails_sent: 23,
        emails_received: 22,
        first_contact: Date.now() - 90 * 24 * 60 * 60 * 1000,
        last_contact: Date.now() - 2 * 24 * 60 * 60 * 1000,
        avg_response_time_minutes: 120,
        response_times: [15, 30, 45, 60, 120, 180, 240, 300, 480, 960],
        interaction_frequency: generateMockFrequencyData(),
        relationship_score: 75
      };
      set({ analytics: mockAnalytics });
      return;
    }

    try {
      set({ isLoading: true, error: null });
      const { invoke } = await import('@tauri-apps/api/core');
      const analytics = await invoke<ContactAnalytics>('get_contact_analytics', { contactId });
      set({ analytics, isLoading: false });
    } catch (error) {
      console.error('Failed to fetch contact analytics:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch analytics',
        isLoading: false
      });
    }
  },

  fetchNetworkData: async (minEmails = 3, limit = 50) => {
    if (USE_MOCK_DATA) {
      // Use mock network data
      set({ networkData: mockNetworkData });
      return;
    }

    try {
      set({ isLoading: true, error: null });
      const { invoke } = await import('@tauri-apps/api/core');
      const networkData = await invoke<NetworkData>('get_network_data', { minEmails, limit });
      set({ networkData, isLoading: false });
    } catch (error) {
      console.error('Failed to fetch network data:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch network data',
        isLoading: false
      });
    }
  },

  fetchStaleContacts: async (daysThreshold = 30) => {
    if (USE_MOCK_DATA) {
      // Use mock stale contacts
      const stale = mockContacts.filter(c =>
        c.days_since_contact && c.days_since_contact > daysThreshold
      );
      set({ staleContacts: stale });
      return;
    }

    try {
      set({ isLoading: true, error: null });
      const { invoke } = await import('@tauri-apps/api/core');
      const contacts = await invoke<Contact[]>('get_stale_contacts', { daysThreshold });
      set({ staleContacts: contacts, isLoading: false });
    } catch (error) {
      console.error('Failed to fetch stale contacts:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch stale contacts',
        isLoading: false
      });
    }
  },

  fetchTopContacts: async (limit = 10) => {
    if (USE_MOCK_DATA) {
      // Use mock top contacts
      const top = [...mockContacts]
        .sort((a, b) => b.relationship_score - a.relationship_score)
        .slice(0, limit);
      set({ topContacts: top });
      return;
    }

    try {
      set({ isLoading: true, error: null });
      const { invoke } = await import('@tauri-apps/api/core');
      const contacts = await invoke<Contact[]>('get_top_contacts', { limit });
      set({ topContacts: contacts, isLoading: false });
    } catch (error) {
      console.error('Failed to fetch top contacts:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch top contacts',
        isLoading: false
      });
    }
  },

  generateHeatmapData: async () => {
    // Generate heatmap data showing email frequency by day/hour for each contact
    const { contacts } = get();
    const heatmapData: HeatmapData[] = contacts.slice(0, 20).map(contact => {
      // Generate mock heatmap data
      const data: { day: string; hour: number; count: number }[] = [];
      const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

      for (let day = 0; day < 7; day++) {
        for (let hour = 0; hour < 24; hour++) {
          // Random but consistent based on contact
          const baseCount = (contact.total_emails_sent + contact.total_emails_received) / 100;
          const count = Math.random() < 0.7 ? 0 : Math.floor(Math.random() * baseCount * 3);
          if (count > 0) {
            data.push({ day: days[day], hour, count });
          }
        }
      }

      return {
        contactId: contact.id,
        contactName: contact.name || contact.email_address.split('@')[0],
        emailAddress: contact.email_address,
        data
      };
    });

    set({ heatmapData });
  },

  refreshAll: async () => {
    const { extractContacts, fetchTopContacts, fetchStaleContacts } = get();
    await extractContacts();
    await fetchTopContacts(10);
    await fetchStaleContacts(30);
  },
}));

// Mock data for development
const mockContacts: Contact[] = [
  {
    id: 'mock_1',
    email_address: 'sarah.chen@company.com',
    name: 'Sarah Chen',
    domain: 'company.com',
    first_seen: Date.now() - 180 * 24 * 60 * 60 * 1000,
    last_contacted: Date.now() - 1 * 24 * 60 * 60 * 1000,
    total_emails_received: 45,
    total_emails_sent: 42,
    total_threads: 15,
    relationship_score: 92,
    category: 'Colleague',
    is_vip: true,
    avg_response_time_minutes: 45,
    last_response_time: Date.now() - 1 * 24 * 60 * 60 * 1000,
    notes: 'Product lead - key stakeholder',
    days_since_contact: 1
  },
  {
    id: 'mock_2',
    email_address: 'mike.johnson@partner.com',
    name: 'Mike Johnson',
    domain: 'partner.com',
    first_seen: Date.now() - 120 * 24 * 60 * 60 * 1000,
    last_contacted: Date.now() - 3 * 24 * 60 * 60 * 1000,
    total_emails_received: 28,
    total_emails_sent: 25,
    total_threads: 8,
    relationship_score: 78,
    category: 'Client',
    is_vip: true,
    avg_response_time_minutes: 120,
    last_response_time: Date.now() - 3 * 24 * 60 * 60 * 1000,
    notes: 'API integration partner',
    days_since_contact: 3
  },
  {
    id: 'mock_3',
    email_address: 'billing@saas-tool.com',
    name: 'Billing Team',
    domain: 'saas-tool.com',
    first_seen: Date.now() - 90 * 24 * 60 * 60 * 1000,
    last_contacted: Date.now() - 45 * 24 * 60 * 60 * 1000,
    total_emails_received: 12,
    total_emails_sent: 8,
    total_threads: 4,
    relationship_score: 45,
    category: 'Vendor',
    is_vip: false,
    avg_response_time_minutes: 480,
    last_response_time: Date.now() - 45 * 24 * 60 * 60 * 1000,
    days_since_contact: 45
  },
  {
    id: 'mock_4',
    email_address: 'john.doe@company.com',
    name: 'John Doe',
    domain: 'company.com',
    first_seen: Date.now() - 200 * 24 * 60 * 60 * 1000,
    last_contacted: Date.now() - 7 * 24 * 60 * 60 * 1000,
    total_emails_received: 65,
    total_emails_sent: 58,
    total_threads: 22,
    relationship_score: 88,
    category: 'Colleague',
    is_vip: false,
    avg_response_time_minutes: 30,
    last_response_time: Date.now() - 7 * 24 * 60 * 60 * 1000,
    days_since_contact: 7
  },
  {
    id: 'mock_5',
    email_address: 'alex@startup.io',
    name: 'Alex Rivera',
    domain: 'startup.io',
    first_seen: Date.now() - 60 * 24 * 60 * 60 * 1000,
    last_contacted: Date.now() - 14 * 24 * 60 * 60 * 1000,
    total_emails_received: 18,
    total_emails_sent: 12,
    total_threads: 6,
    relationship_score: 65,
    category: 'Client',
    is_vip: false,
    avg_response_time_minutes: 180,
    last_response_time: Date.now() - 14 * 24 * 60 * 60 * 1000,
    days_since_contact: 14
  },
  {
    id: 'mock_6',
    email_address: 'emma.watson@gmail.com',
    name: 'Emma Watson',
    domain: 'gmail.com',
    first_seen: Date.now() - 365 * 24 * 60 * 60 * 1000,
    last_contacted: Date.now() - 60 * 24 * 60 * 60 * 1000,
    total_emails_received: 35,
    total_emails_sent: 28,
    total_threads: 12,
    relationship_score: 55,
    category: 'Friend',
    is_vip: false,
    avg_response_time_minutes: 960,
    last_response_time: Date.now() - 60 * 24 * 60 * 60 * 1000,
    days_since_contact: 60
  },
  {
    id: 'mock_7',
    email_address: 'newsletter@techdigest.com',
    name: 'Tech Digest',
    domain: 'techdigest.com',
    first_seen: Date.now() - 400 * 24 * 60 * 60 * 1000,
    last_contacted: Date.now() - 2 * 24 * 60 * 60 * 1000,
    total_emails_received: 150,
    total_emails_sent: 0,
    total_threads: 0,
    relationship_score: 15,
    category: 'Other',
    is_vip: false,
    avg_response_time_minutes: undefined,
    days_since_contact: 2
  },
  {
    id: 'mock_8',
    email_address: 'david.kim@company.com',
    name: 'David Kim',
    domain: 'company.com',
    first_seen: Date.now() - 150 * 24 * 60 * 60 * 1000,
    last_contacted: Date.now() - 5 * 24 * 60 * 60 * 1000,
    total_emails_received: 52,
    total_emails_sent: 48,
    total_threads: 18,
    relationship_score: 85,
    category: 'Colleague',
    is_vip: false,
    avg_response_time_minutes: 35,
    last_response_time: Date.now() - 5 * 24 * 60 * 60 * 1000,
    days_since_contact: 5
  }
];

function generateMockFrequencyData(): InteractionFrequency[] {
  const data: InteractionFrequency[] = [];
  const now = Date.now();
  for (let i = 89; i >= 0; i--) {
    const date = new Date(now - i * 24 * 60 * 60 * 1000);
    const dateStr = date.toISOString().split('T')[0];
    const count = Math.random() < 0.8 ? 0 : Math.floor(Math.random() * 5);
    const sent = count > 0 ? Math.floor(Math.random() * count) : 0;
    data.push({
      date: dateStr,
      count,
      sent,
      received: count - sent
    });
  }
  return data;
}

const mockNetworkData: NetworkData = {
  nodes: [
    { id: 'mock_1', label: 'Sarah Chen', value: 87, category: 'Colleague', score: 92 },
    { id: 'mock_2', label: 'Mike Johnson', value: 53, category: 'Client', score: 78 },
    { id: 'mock_3', label: 'Billing Team', value: 20, category: 'Vendor', score: 45 },
    { id: 'mock_4', label: 'John Doe', value: 123, category: 'Colleague', score: 88 },
    { id: 'mock_5', label: 'Alex Rivera', value: 30, category: 'Client', score: 65 },
    { id: 'mock_6', label: 'Emma Watson', value: 63, category: 'Friend', score: 55 },
    { id: 'mock_7', label: 'Tech Digest', value: 150, category: 'Other', score: 15 },
    { id: 'mock_8', label: 'David Kim', value: 100, category: 'Colleague', score: 85 },
  ],
  links: [
    { source: 'mock_1', target: 'mock_4', value: 12, strength: 10.8 },
    { source: 'mock_1', target: 'mock_8', value: 8, strength: 9.0 },
    { source: 'mock_4', target: 'mock_8', value: 15, strength: 11.8 },
    { source: 'mock_2', target: 'mock_5', value: 5, strength: 7.0 },
    { source: 'mock_1', target: 'mock_2', value: 3, strength: 4.8 },
    { source: 'mock_6', target: 'mock_4', value: 6, strength: 7.8 },
  ]
};
