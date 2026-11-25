import { useEffect } from 'react';
import { createPersistedStore } from '../progress/persist';

export type ThemeMode = 'light' | 'dark';

interface ThemeState {
  theme: ThemeMode;
  setTheme: (t: ThemeMode) => void;
  toggle: () => void;
}

/** Persisted at `lp:app:theme` (index.html reads it before first paint). */
export const useTheme = createPersistedStore<ThemeState>('app', 'theme', (set, get) => ({
  theme: 'light',
  setTheme: (theme) => set({ theme }),
  toggle: () => set({ theme: get().theme === 'dark' ? 'light' : 'dark' }),
}));

/** Mount once at the app root: syncs the `dark` class on <html>. */
export function useApplyTheme(): void {
  const theme = useTheme((s) => s.theme);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);
}
