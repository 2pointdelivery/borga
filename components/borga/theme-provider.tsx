'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { ThemeMode } from '@/lib/borga/store';

interface ThemeCtx {
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
  resolvedDark: boolean;
}

const Ctx = createContext<ThemeCtx>({ mode: 'system', setMode: () => {}, resolvedDark: false });

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined') return true;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

const isDarkTheme = (m: ThemeMode) =>
  m === 'dark' || m === 'midnight' || m === 'sunset' || m === 'forest' || m === 'system';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [resolvedDark, setResolvedDark] = useState(true);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('borga-theme') as ThemeMode | null;
      if (stored) setModeState(stored);
    } catch {}
  }, []);

  useEffect(() => {
    const dark = mode === 'system' ? systemPrefersDark() : isDarkTheme(mode);
    setResolvedDark(dark);
    const root = document.documentElement;
    root.classList.toggle('dark', dark);
    root.setAttribute('data-theme', mode);
    try {
      localStorage.setItem('borga-theme', mode);
    } catch {}
  }, [mode]);

  const setMode = useCallback((m: ThemeMode) => setModeState(m), []);

  return <Ctx.Provider value={{ mode, setMode, resolvedDark }}>{children}</Ctx.Provider>;
}

export function useTheme() {
  return useContext(Ctx);
}
