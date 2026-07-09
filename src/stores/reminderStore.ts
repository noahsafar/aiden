import { create } from 'zustand';
import { getReminders, saveReminder as saveReminderApi, deleteReminder as deleteReminderApi, getDueReminders, markReminderTriggered, Reminder } from '@/api/chatbot';

interface ReminderState {
  reminders: Reminder[];
  isLoading: boolean;
  error: string | null;
  checkInterval: number; // seconds

  // Actions
  loadReminders: () => Promise<void>;
  addReminder: (message: string, dueDate: string) => Promise<void>;
  removeReminder: (id: string) => Promise<void>;
  checkReminders: () => Promise<void>;
  startPeriodicCheck: () => void;
  stopPeriodicCheck: () => void;
}

let checkTimer: ReturnType<typeof setInterval> | null = null;

export const useReminderStore = create<ReminderState>((set, get) => ({
  // Initial state
  reminders: [],
  isLoading: false,
  error: null,
  checkInterval: 60, // Check every 60 seconds

  // Load all reminders
  loadReminders: async () => {
    set({ isLoading: true, error: null });
    try {
      const reminders = await getReminders();
      set({ reminders, isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to load reminders',
        isLoading: false,
      });
    }
  },

  // Add a new reminder
  addReminder: async (message: string, dueDate: string) => {
    const reminder: Reminder = {
      id: `reminder-${Date.now()}`,
      message,
      due_date: dueDate,
      created_at: new Date().toISOString(),
      is_triggered: false,
    };

    try {
      await saveReminderApi(reminder);
      set(state => ({ reminders: [...state.reminders, reminder] }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to save reminder',
      });
      throw error;
    }
  },

  // Remove a reminder
  removeReminder: async (id: string) => {
    try {
      await deleteReminderApi(id);
      set(state => ({
        reminders: state.reminders.filter(r => r.id !== id),
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to delete reminder',
      });
      throw error;
    }
  },

  // Check for due reminders and trigger notifications
  checkReminders: async () => {
    try {
      const dueReminders = await getDueReminders();

      for (const reminder of dueReminders) {
        // Show notification
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('Aiden Reminder', {
            body: reminder.message,
            icon: '/icons/icon.png',
          });
        }

        // Mark as triggered
        await markReminderTriggered(reminder.id);

        // Update local state
        set(state => ({
          reminders: state.reminders.map(r =>
            r.id === reminder.id ? { ...r, is_triggered: true } : r
          ),
        }));
      }
    } catch (error) {
      console.error('Failed to check reminders:', error);
    }
  },

  // Start periodic reminder checking
  startPeriodicCheck: () => {
    if (checkTimer) return;

    // Request notification permission
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    // Check immediately
    get().checkReminders();

    // Set up periodic check
    const interval = get().checkInterval * 1000;
    checkTimer = setInterval(() => {
      get().checkReminders();
    }, interval);
  },

  // Stop periodic reminder checking
  stopPeriodicCheck: () => {
    if (checkTimer) {
      clearInterval(checkTimer);
      checkTimer = null;
    }
  },
}));

// Initialize periodic checking on app load
if (typeof window !== 'undefined') {
  useReminderStore.getState().startPeriodicCheck();
}
