'use client';

import { useEffect, useMemo } from 'react';
import { Command } from 'cmdk';
import {
  Sun,
  Moon,
  Mic,
  CornerDownRight,
} from 'lucide-react';
import { useVisibleNav } from './use-visible-nav';
import { useBorga } from '@/lib/borga/store';
import { useTheme } from './theme-provider';
import { cn } from '@/lib/utils';

export function CommandPalette({
  onOpenVoice,
}: {
  onOpenVoice: () => void;
}) {
  const navPages = useVisibleNav();
  const { paletteOpen, setPaletteOpen, setActiveAgentId } = useBorga();
  const { mode, setMode } = useTheme();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(!paletteOpen);
      }
      if (e.key === 'Escape') setPaletteOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [paletteOpen, setPaletteOpen]);

  useEffect(() => {
    if (paletteOpen) setActiveAgentId('');
  }, [paletteOpen, setActiveAgentId]);

  const navigate = (page: string, tab?: string) => {
    window.dispatchEvent(new CustomEvent('borga:nav', { detail: tab ? { page, tab } : page }));
    setActiveAgentId('');
    setPaletteOpen(false);
  };

  const themeActions = useMemo(
    () => [
      { label: 'Toggle light / dark', run: () => setMode(mode === 'dark' || mode === 'system' ? 'light' : 'dark') },
      { label: 'Theme — Midnight', run: () => setMode('midnight') },
      { label: 'Theme — Sunset', run: () => setMode('sunset') },
      { label: 'Theme — Forest', run: () => setMode('forest') },
      { label: 'Theme — System', run: () => setMode('system') },
    ],
    [mode, setMode],
  );

  return (
    <Command.Dialog
      open={paletteOpen}
      onOpenChange={setPaletteOpen}
      label="Borga command palette"
      className="fixed left-1/2 top-[18%] z-[100] w-[min(560px,calc(100%-2rem))] -translate-x-1/2 overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-2xl"
    >
      <Command.Input
        placeholder="Ask Borga or jump to a section— (try —voice—, —customers—, —banking—)"
        className="border-b bg-transparent px-4 py-3.5 text-sm outline-none placeholder:text-muted-foreground"
      />
      <Command.List className="max-h-[360px] overflow-y-auto p-2">
        <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">
          No result. Try a section name or an action.
        </Command.Empty>

        <Command.Group heading="Go to">
          {navPages.map((p) => (
            <Command.Item
              key={p.id}
              value={p.label}
              onSelect={() => navigate(p.id)}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
            >
              <p.icon className="h-4 w-4 text-muted-foreground" />
              {p.label}
            </Command.Item>
          ))}
        </Command.Group>

        <Command.Group heading="Pages">
          {navPages.filter((p) => p.tabs).flatMap((p) =>
            (p.tabs ?? []).map((t) => (
              <Command.Item
                key={`${p.id}-${t.id}`}
                value={`${t.label} ${p.label} ${t.id}`}
                onSelect={() => navigate(p.id, t.id)}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
              >
                <CornerDownRight className="h-4 w-4 text-muted-foreground" />
                {p.label} — {t.label}
              </Command.Item>
            )),
          )}
        </Command.Group>

        <Command.Group heading="Actions">
          <Command.Item
            value="voice open voice assistant talk mic"
            onSelect={() => {
              setPaletteOpen(false);
              onOpenVoice();
            }}
            className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
          >
            <Mic className="h-4 w-4 text-muted-foreground" />
            Open voice assistant
          </Command.Item>
          {themeActions.map((a) => (
            <Command.Item
              key={a.label}
              value={a.label}
              onSelect={() => {
                a.run();
                setPaletteOpen(false);
              }}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
            >
              {a.label.includes('dark') ? (
                <Moon className="h-4 w-4 text-muted-foreground" />
              ) : (
                <Sun className="h-4 w-4 text-muted-foreground" />
              )}
              {a.label}
            </Command.Item>
          ))}
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}

export function Kbd({ className }: { className?: string }) {
  return (
    <kbd className={cn('rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground', className)}>
      ⌘K
    </kbd>
  );
}
