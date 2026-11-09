'use client';

import { useEffect, useMemo, useState } from 'react';
import { useBorga } from '@/lib/borga/store';
import { useFeatures } from '@/lib/borga/features-client';
import { ticketsApi } from '@/lib/borga/tickets-client';
import { computeHealth, type HealthResult, type HealthTicketCounts } from '@/lib/borga/health';
import { computeProjectActualSpend } from '@/lib/borga/data';
import { slaFor } from './ticket-bits';

/** Open and SLA-breached ticket counts for the health score. Null when the Support Desk is off or has not answered. */
function useTicketCounts(): HealthTicketCounts | null {
  const ws = useBorga((s) => s.activeWorkspaceId);
  const loaded = useBorga((s) => s.loadedWorkspaceId);
  const on = useFeatures((s) => s.flags.tickets);
  const [counts, setCounts] = useState<HealthTicketCounts | null>(null);
  useEffect(() => {
    if (!on || !ws || loaded !== ws) return;
    let alive = true;
    void ticketsApi.list(ws).then((r) => {
      if (!alive || !r.ok) return;
      const now = Date.now();
      const open = r.tickets.filter((t) => t.status !== 'resolved' && t.status !== 'closed');
      const breached = open.filter((t) => slaFor(t, r.settings, now).worst === 'breached').length;
      setCounts({ total: r.tickets.length, unresolved: open.length, breached });
    });
    return () => { alive = false; };
  }, [on, ws, loaded]);
  return on ? counts : null;
}

/** The company health score for the active company, from the same live data the rest of the dashboard shows. */
export function useHealth(): HealthResult {
  const { finance, invoices, bills, leads, tasks, projects, employees, ads, kpiGroups } = useBorga();
  const tickets = useTicketCounts();
  return useMemo(
    () => computeHealth({
      finance, invoices, bills, leads, tasks, employees, ads, kpiGroups, tickets,
      projects: projects.map((p) => ({ id: p.id, budgetAmount: p.budgetAmount, actualSpend: computeProjectActualSpend(finance, p.id) })),
    }),
    [finance, invoices, bills, leads, tasks, projects, employees, ads, kpiGroups, tickets],
  );
}
