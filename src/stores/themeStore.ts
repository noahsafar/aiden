import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

type ThemeMode = 'light' | 'dark' | 'auto';
type FontSize = 'small' | 'medium' | 'large';

interface ThemeSettings {
  theme: ThemeMode;
  font_size: FontSize;
}

interface ThemeState {
  themeMode: ThemeMode;
  isDark: boolean;
  fontSize: FontSize;
  setTheme: (theme: ThemeMode) => void;
  setFontSize: (size: FontSize) => void;
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

// Font size multipliers
const fontSizes = {
  small: 0.875,
  medium: 1,
  large: 1.125,
};

// Apply font size to DOM
function applyFontSize(fontSize: FontSize) {
  const root = document.documentElement;
  root.style.fontSize = `${fontSizes[fontSize]}rem`;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  themeMode: 'auto',
  isDark: calculateDarkMode('auto'),
  fontSize: 'medium',

  setTheme: (themeMode: ThemeMode) => {
    const isDark = calculateDarkMode(themeMode);
    set({ themeMode, isDark });
    applyTheme(isDark);

    // Save to settings
    invoke('save_settings', {
      settings: { ...get().themeMode, theme: themeMode }
    }).catch(console.error);
  },

  setFontSize: (fontSize: FontSize) => {
    set({ fontSize });
    applyFontSize(fontSize);

    // Save to settings
    invoke('save_settings', {
      settings: { ...get().fontSize, font_size: fontSize }
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
      const fontSize = settings?.font_size || 'medium';
      const isDark = calculateDarkMode(themeMode);
      set({ themeMode, isDark, fontSize });
      applyTheme(isDark);
      applyFontSize(fontSize);
    } catch (e) {
      // Use defaults if settings fail to load
      const isDark = calculateDarkMode('auto');
      set({ themeMode: 'auto', isDark, fontSize: 'medium' });
      applyTheme(isDark);
      applyFontSize('medium');
    }
  },
}));

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
