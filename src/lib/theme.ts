import { useCallback, useEffect, useState } from 'react';

/** Must agree with the inline script in index.html. */
const STORAGE_KEY = 'tmux-dispatch-theme';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const query = () => window.matchMedia('(prefers-color-scheme: dark)');

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

function resolve(preference: ThemePreference): ResolvedTheme {
  if (preference !== 'system') return preference;
  return query().matches ? 'dark' : 'light';
}

function apply(theme: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
}

/**
 * System, Light or Dark. Only an explicit choice is stored; System follows
 * the operating system and keeps following it while the page is open.
 */
export function useTheme() {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolve(readPreference()));

  useEffect(() => {
    const next = resolve(preference);
    setResolved(next);
    apply(next);
    if (preference !== 'system') return;
    const media = query();
    const onChange = () => {
      const theme = media.matches ? 'dark' : 'light';
      setResolved(theme);
      apply(theme);
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    try {
      if (next === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch { /* not persisted; still applied for this page */ }
    setPreferenceState(next);
  }, []);

  return { preference, resolved, setPreference };
}
