import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';

interface ThemeState {
  pref: ThemePref;
  resolved: 'light' | 'dark';
  setPref: (p: ThemePref) => void;
  cycle: () => void;
}

const ThemeContext = createContext<ThemeState | undefined>(undefined);

const systemDark = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;

function resolve(pref: ThemePref): 'light' | 'dark' {
  return pref === 'system' ? (systemDark() ? 'dark' : 'light') : pref;
}

function apply(resolved: 'light' | 'dark') {
  const el = document.documentElement;
  el.classList.remove('light', 'dark');
  el.classList.add(resolved);
}

function readStored(): ThemePref {
  const v = (typeof localStorage !== 'undefined' && localStorage.getItem('theme')) || 'system';
  return v === 'light' || v === 'dark' ? v : 'system';
}

/**
 * Theme controller (SPEC §8, UX-01).
 *
 * localStorage stays the source of truth for FIRST PAINT — the boot script in
 * index.html reads it before React exists, which is what stops the page
 * flashing the wrong theme — and `useThemeSync` mirrors it to and from
 * `user_settings.theme` so the choice follows the account to another device.
 *
 * The local value deliberately wins on load: a server round trip cannot happen
 * before paint, and a theme that flickers on every cold start to save one
 * round trip is a bad trade.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(readStored);
  const [resolved, setResolved] = useState<'light' | 'dark'>(() => resolve(readStored()));

  useEffect(() => {
    const r = resolve(pref);
    setResolved(r);
    apply(r);
    localStorage.setItem('theme', pref);
  }, [pref]);

  // Follow the OS while on 'system'.
  useEffect(() => {
    if (pref !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const r = systemDark() ? 'dark' : 'light';
      setResolved(r);
      apply(r);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [pref]);

  const setPref = (p: ThemePref) => setPrefState(p);
  const cycle = () =>
    setPrefState((p) => (p === 'system' ? 'light' : p === 'light' ? 'dark' : 'system'));

  return (
    <ThemeContext.Provider value={{ pref, resolved, setPref, cycle }}>
      {children}
    </ThemeContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
