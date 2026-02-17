import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { LifeDataItem } from '@/api/claude';

export interface LifeIntelligenceItem extends LifeDataItem {
  id: string;
  email_id: string;
  created_at: string;
  dismissed: boolean;
}

interface LifeState {
  items: LifeIntelligenceItem[];
  processedEmailIds: Set<string>;
  isLoaded: boolean;

  addItemsFromEmail: (emailId: string, items: LifeDataItem[]) => void;
  dismissItem: (id: string) => void;
  deleteItem: (id: string) => void;
  loadFromDisk: () => Promise<void>;

  getSubscriptions: () => LifeIntelligenceItem[];
  getBills: () => LifeIntelligenceItem[];
  getTravel: () => LifeIntelligenceItem[];
  getPackages: () => LifeIntelligenceItem[];
  getDeadlines: () => LifeIntelligenceItem[];
  getMonthlySpend: () => number;
}

export const useLifeStore = create<LifeState>((set, get) => ({
  items: [],
  processedEmailIds: new Set(),
  isLoaded: false,

  addItemsFromEmail: (emailId: string, items: LifeDataItem[]) => {
    const state = get();
    if (state.processedEmailIds.has(emailId) || items.length === 0) return;

    const now = new Date().toISOString();
    const newItems: LifeIntelligenceItem[] = items.map((item) => ({
      ...item,
      id: `${emailId}-${item.data_type}-${item.title.toLowerCase().replace(/\s+/g, '-').slice(0, 40)}`,
      email_id: emailId,
      created_at: now,
      dismissed: false,
    }));

    // Dedup: skip items whose id already exists
    const existingIds = new Set(state.items.map((i) => i.id));
    // For subscriptions, also dedup by title (keep newest)
    const existingSubTitles = new Set(
      state.items
        .filter((i) => i.data_type === 'subscription' && !i.dismissed)
        .map((i) => i.title.toLowerCase())
    );

    const filtered = newItems.filter((item) => {
      if (existingIds.has(item.id)) return false;
      if (item.data_type === 'subscription' && existingSubTitles.has(item.title.toLowerCase())) {
        return false;
      }
      return true;
    });

    if (filtered.length === 0) return;

    const updatedItems = [...state.items, ...filtered];
    set({
      items: updatedItems,
      processedEmailIds: new Set([...state.processedEmailIds, emailId]),
    });

    // Persist to disk
    invoke('save_life_items', { items: filtered }).catch((e) =>
      console.error('[LifeStore] Failed to persist items:', e)
    );
  },

  dismissItem: (id: string) => {
    set((state) => ({
      items: state.items.map((i) => (i.id === id ? { ...i, dismissed: true } : i)),
    }));
    invoke('dismiss_life_item', { id }).catch((e) =>
      console.error('[LifeStore] Failed to dismiss item:', e)
    );
  },

  deleteItem: (id: string) => {
    set((state) => ({
      items: state.items.filter((i) => i.id !== id),
    }));
    invoke('delete_life_item', { id }).catch((e) =>
      console.error('[LifeStore] Failed to delete item:', e)
    );
  },

  loadFromDisk: async () => {
    // Skip if mock data is already loaded
    if (get().items.length > 0) { set({ isLoaded: true }); return; }
    try {
      const items = await invoke<LifeIntelligenceItem[]>('load_life_items');
      const processedEmailIds = new Set(items.map((i) => i.email_id));
      set({ items, processedEmailIds, isLoaded: true });
    } catch (e) {
      console.error('[LifeStore] Failed to load from disk:', e);
      set({ isLoaded: true });
    }
  },

  getSubscriptions: () => get().items.filter((i) => i.data_type === 'subscription' && !i.dismissed),
  getBills: () => get().items.filter((i) => i.data_type === 'bill' && !i.dismissed),
  getTravel: () => get().items.filter((i) => i.data_type === 'travel' && !i.dismissed),
  getPackages: () => get().items.filter((i) => i.data_type === 'package' && !i.dismissed),
  getDeadlines: () => get().items.filter((i) => i.data_type === 'deadline' && !i.dismissed),
  getMonthlySpend: () => {
    const items = get().items.filter((i) => !i.dismissed && i.amount);
    let total = 0;
    for (const item of items) {
      if (!item.amount) continue;
      if (item.frequency === 'monthly') total += item.amount;
      else if (item.frequency === 'yearly') total += item.amount / 12;
      else if (item.frequency === 'weekly') total += item.amount * 4.33;
      else if (item.data_type === 'bill' && item.frequency === 'one-time') total += item.amount;
    }
    return Math.round(total * 100) / 100;
  },
}));

// ==================== MOCK DATA (remove for production) ====================
const MOCK_LIFE_DATA: LifeIntelligenceItem[] = [
  { id: 'mock-sub-1', email_id: 'mock-1', data_type: 'subscription', title: 'Netflix Premium', amount: 22.99, currency: 'USD', date: '2026-03-15', end_date: null, frequency: 'monthly', details: null, tracking_number: null, carrier: null, created_at: '2026-02-10T10:00:00Z', dismissed: false },
  { id: 'mock-sub-2', email_id: 'mock-2', data_type: 'subscription', title: 'Spotify Family', amount: 16.99, currency: 'USD', date: '2026-03-01', end_date: null, frequency: 'monthly', details: null, tracking_number: null, carrier: null, created_at: '2026-02-08T10:00:00Z', dismissed: false },
  { id: 'mock-sub-3', email_id: 'mock-3', data_type: 'subscription', title: 'iCloud+ 200GB', amount: 2.99, currency: 'USD', date: '2026-02-28', end_date: null, frequency: 'monthly', details: null, tracking_number: null, carrier: null, created_at: '2026-02-01T10:00:00Z', dismissed: false },
  { id: 'mock-sub-4', email_id: 'mock-4', data_type: 'subscription', title: 'ChatGPT Plus', amount: 20.00, currency: 'USD', date: '2026-03-12', end_date: null, frequency: 'monthly', details: null, tracking_number: null, carrier: null, created_at: '2026-02-12T10:00:00Z', dismissed: false },
  { id: 'mock-bill-1', email_id: 'mock-5', data_type: 'bill', title: 'Electric Bill - ConEd', amount: 142.37, currency: 'USD', date: '2026-02-25', end_date: null, frequency: 'monthly', details: 'Account #4821', tracking_number: null, carrier: null, created_at: '2026-02-14T10:00:00Z', dismissed: false },
  { id: 'mock-bill-2', email_id: 'mock-6', data_type: 'bill', title: 'Car Insurance - Geico', amount: 189.00, currency: 'USD', date: '2026-02-15', end_date: null, frequency: 'monthly', details: 'Policy #GK-8291', tracking_number: null, carrier: null, created_at: '2026-02-10T10:00:00Z', dismissed: false },
  { id: 'mock-bill-3', email_id: 'mock-7', data_type: 'bill', title: 'Internet - Verizon Fios', amount: 79.99, currency: 'USD', date: '2026-03-03', end_date: null, frequency: 'monthly', details: null, tracking_number: null, carrier: null, created_at: '2026-02-16T10:00:00Z', dismissed: false },
  { id: 'mock-travel-1', email_id: 'mock-8', data_type: 'travel', title: 'NYC → San Francisco', amount: 387.00, currency: 'USD', date: '2026-03-20', end_date: '2026-03-25', frequency: null, details: 'XKJF82', tracking_number: null, carrier: 'United Airlines', created_at: '2026-02-15T10:00:00Z', dismissed: false },
  { id: 'mock-travel-2', email_id: 'mock-9', data_type: 'travel', title: 'Marriott Downtown SF', amount: 245.00, currency: 'USD', date: '2026-03-20', end_date: '2026-03-25', frequency: null, details: '92817364', tracking_number: null, carrier: 'Marriott', created_at: '2026-02-15T10:00:00Z', dismissed: false },
  { id: 'mock-pkg-1', email_id: 'mock-10', data_type: 'package', title: 'MacBook Pro Charger', amount: null, currency: null, date: '2026-02-19', end_date: null, frequency: null, details: null, tracking_number: '1Z999AA10123456784', carrier: 'UPS', created_at: '2026-02-16T10:00:00Z', dismissed: false },
  { id: 'mock-pkg-2', email_id: 'mock-11', data_type: 'package', title: 'Running Shoes - Nike', amount: null, currency: null, date: '2026-02-21', end_date: null, frequency: null, details: null, tracking_number: '9400111899223100', carrier: 'USPS', created_at: '2026-02-15T10:00:00Z', dismissed: false },
  { id: 'mock-deadline-1', email_id: 'mock-12', data_type: 'deadline', title: 'Tax Filing Deadline', amount: null, currency: null, date: '2026-04-15', end_date: null, frequency: null, details: 'Federal & state returns due', tracking_number: null, carrier: null, created_at: '2026-02-01T10:00:00Z', dismissed: false },
  { id: 'mock-deadline-2', email_id: 'mock-13', data_type: 'deadline', title: 'Lease Renewal Decision', amount: null, currency: null, date: '2026-02-28', end_date: null, frequency: null, details: 'Must notify landlord by this date', tracking_number: null, carrier: null, created_at: '2026-02-10T10:00:00Z', dismissed: false },
  { id: 'mock-deadline-3', email_id: 'mock-14', data_type: 'deadline', title: 'Passport Renewal', amount: null, currency: null, date: '2026-02-16', end_date: null, frequency: null, details: 'Expires — renew ASAP', tracking_number: null, carrier: null, created_at: '2026-02-05T10:00:00Z', dismissed: false },
];

// Load mock data on import
useLifeStore.setState({
  items: MOCK_LIFE_DATA,
  processedEmailIds: new Set(MOCK_LIFE_DATA.map(i => i.email_id)),
  isLoaded: true,
});
