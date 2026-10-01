'use client';

import { create } from 'zustand';
import { FEATURES, resolveFeatures, type FeatureId } from './features';

interface FeatureState {
  ws: string | null;
  flags: Record<FeatureId, boolean>;
  locked: FeatureId[];
  loaded: boolean;
  load: (ws: string) => Promise<void>;
  toggle: (id: FeatureId, enabled: boolean) => Promise<string | null>;
}

const defaults = resolveFeatures(null);

/**
 * Client view of the workspace's feature flags. Until the first load resolves
 * every feature shows at its default, so navigation never flashes empty. The
 * server remains the authority — routes answer 404 for disabled features.
 */
export const useFeatures = create<FeatureState>((set, get) => ({
  ws: null,
  flags: defaults.flags,
  locked: [],
  loaded: false,
  load: async (ws) => {
    try {
      const res = await fetch(`/api/borga/features?ws=${encodeURIComponent(ws)}`, { cache: 'no-store' });
      if (!res.ok) return;
      const j = (await res.json()) as { flags: Record<FeatureId, boolean>; locked: FeatureId[] };
      set({ ws, flags: { ...defaults.flags, ...j.flags }, locked: j.locked ?? [], loaded: true });
    } catch {
      // keep defaults — feature flags must never block the dashboard
    }
  },
  toggle: async (id, enabled) => {
    const ws = get().ws;
    if (!ws) return 'Workspace not ready';
    const prev = get().flags;
    set({ flags: { ...prev, [id]: enabled } });
    try {
      const res = await fetch('/api/borga/features', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
        body: JSON.stringify({ ws, id, enabled }),
      });
      const j = (await res.json()) as { ok: boolean; error?: string; flags?: Record<FeatureId, boolean> };
      if (!res.ok || !j.ok) {
        set({ flags: prev });
        return j.error ?? 'Could not save';
      }
      if (j.flags) set({ flags: { ...defaults.flags, ...j.flags } });
      return null;
    } catch {
      set({ flags: prev });
      return 'Network error';
    }
  },
}));

export function useFeature(id: FeatureId): boolean {
  return useFeatures((s) => s.flags[id]);
}

export { FEATURES };
