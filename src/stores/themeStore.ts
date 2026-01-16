import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

type ThemeMode = 'light' | 'dark' | 'auto';

interface ThemeSettings {
  theme: ThemeMode;
}

interface ThemeState {
  themeMode: ThemeMode;
  isDark: boolean;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  loadThemeFromSettings: () => Promise<void>;
}

// Helper to get system preference
function getSystemThemePreference(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

// Calculate if dark mode should be active
function calculateDarkMode(themeMode: ThemeMode): boolean {
  if (themeMode === 'dark') return true;
  if (themeMode === 'light') return false;
  return getSystemThemePreference(); // auto
}

// Apply theme to DOM
function applyTheme(isDark: boolean) {
  const root = document.documentElement;
  if (isDark) {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

// Set default font size to large (1.125rem)
function applyDefaultFontSize() {
  const root = document.documentElement;
  root.style.fontSize = '1.125rem';
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  themeMode: 'auto',
  isDark: calculateDarkMode('auto'),

  setTheme: (themeMode: ThemeMode) => {
    const isDark = calculateDarkMode(themeMode);
    set({ themeMode, isDark });
    applyTheme(isDark);

    // Save to settings
    invoke('save_settings', {
      settings: { theme: themeMode }
    }).catch(console.error);
  },

  toggleTheme: () => {
    const { themeMode, isDark } = get();
    let newMode: ThemeMode;

    if (themeMode === 'auto') {
      newMode = isDark ? 'light' : 'dark';
    } else {
      newMode = themeMode === 'dark' ? 'light' : 'dark';
    }

    get().setTheme(newMode);
  },

  loadThemeFromSettings: async () => {
    try {
      const settings = await invoke<ThemeSettings>('get_settings');
      const themeMode = settings?.theme || 'auto';
      const isDark = calculateDarkMode(themeMode);
      set({ themeMode, isDark });
      applyTheme(isDark);
      applyDefaultFontSize();
    } catch (e) {
      // Use defaults if settings fail to load
      const isDark = calculateDarkMode('auto');
      set({ themeMode: 'auto', isDark });
      applyTheme(isDark);
      applyDefaultFontSize();
    }
  },
}));

// Apply default font size on load
if (typeof window !== 'undefined') {
  applyDefaultFontSize();
}

// Listen for system theme changes when in auto mode
if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    const { themeMode } = useThemeStore.getState();
    if (themeMode === 'auto') {
      const isDark = e.matches;
      useThemeStore.getState().setTheme('auto');
    }
  });
}
