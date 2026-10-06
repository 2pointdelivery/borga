'use client';

import { useEffect } from 'react';
import { useBorga } from '@/lib/borga/store';
import { busyFromJobs } from '@/lib/borga/agent-status';

const EVERY_MS = 15_000;

/** Keeps the store's "who has work" map current by reading the run queue, so agents show as idle when nothing is assigned to them. */
export function useAgentActivity(ready: boolean): void {
  const ws = useBorga((s) => s.activeWorkspaceId);
  const setAgentBusy = useBorga((s) => s.setAgentBusy);

  useEffect(() => {
    if (!ready || !ws) return;
    let alive = true;
    const load = () => {
      if (document.visibilityState !== 'visible') return;
      void fetch(`/api/borga/agent/queue?ws=${encodeURIComponent(ws)}`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((j: { ok?: boolean; jobs?: Array<{ agentId: string; status: string }> }) => { if (alive && j.ok) setAgentBusy(busyFromJobs(j.jobs ?? [])); })
        .catch(() => undefined);
    };
    load();
    const t = setInterval(load, EVERY_MS);
    document.addEventListener('visibilitychange', load);
    return () => { alive = false; clearInterval(t); document.removeEventListener('visibilitychange', load); };
  }, [ready, ws, setAgentBusy]);
}
