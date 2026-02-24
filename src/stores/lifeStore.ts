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
    if (state.processedEmailIds.has(emailId)) return;

    // Mark as processed even if no items — prevents re-analyzing on every startup
    if (items.length === 0) {
      set({ processedEmailIds: new Set([...state.processedEmailIds, emailId]) });
      invoke('save_life_processed_ids', { ids: [emailId] }).catch(() => {});
      return;
    }

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
    invoke('save_life_processed_ids', { ids: [emailId] }).catch(() => {});
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
    if (get().isLoaded) return;
    try {
      const [diskItems, processedIds] = await Promise.all([
        invoke<LifeIntelligenceItem[]>('load_life_items'),
        invoke<string[]>('load_life_processed_ids'),
      ]);
      // Merge disk items with any items already added in-memory (from backfill)
      const currentItems = get().items;
      const currentProcessedIds = get().processedEmailIds;
      const diskItemIds = new Set(diskItems.map((i) => i.id));
      const mergedItems = [
        ...diskItems,
        ...currentItems.filter((i) => !diskItemIds.has(i.id)),
      ];
      const processedEmailIds = new Set([
        ...mergedItems.map((i) => i.email_id),
        ...processedIds,
        ...currentProcessedIds,
      ]);
      set({ items: mergedItems, processedEmailIds, isLoaded: true });
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

