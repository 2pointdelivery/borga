'use client';

import { useEffect, useMemo, useState } from 'react';
import { useBorga } from '@/lib/borga/store';
import { applyLiveKpis, deriveLiveKpis } from '@/lib/borga/kpi-live';
import { ticketsApi, type ClientSettings } from '@/lib/borga/tickets-client';
import type { TicketSummary } from '@/lib/borga/tickets';

/**
 * Keeps the saved KPI set equal to what the company's records say. The numbers are written into the saved set (not just painted on
 * the KPI page), so the health score, the advisor, reports and the agents all read the same live values. Waits until the company's
 * own data has loaded, so it never measures the starter data. Saves only when something actually changed.
 */
export function useLiveKpis(dataReady: boolean) {
  const ws = useBorga((s) => s.activeWorkspaceId);
  const { finance, leads, employees, knowledge, tasks, ads, bankAccounts, goals, customers, kpiGroups, activeWorkspace, setKpiGroups } = useBorga();
  const [desk, setDesk] = useState<{ tickets: TicketSummary[]; settings: ClientSettings | null }>({ tickets: [], settings: null });

  // the support desk lives on the server: read it now and then (a company without it simply has no ticket KPIs)
  useEffect(() => {
    if (!dataReady || !ws) return;
    let off = false;
    const load = () => void ticketsApi.list(ws).then((r) => { if (!off && r.ok) setDesk({ tickets: r.tickets, settings: r.settings }); }).catch(() => {});
    load();
    const t = setInterval(load, 5 * 60_000);
    return () => { off = true; clearInterval(t); };
  }, [dataReady, ws]);

  const revenueTarget = kpiGroups.find((g) => g.id === 'finance')?.kpis.find((k) => k.label === 'Revenue')?.target ?? 0;
  const company = activeWorkspace();
  const next = useMemo(() => {
    if (!dataReady) return null;
    const overrides = deriveLiveKpis({
      finance, leads, employees, knowledge, ws: company, tasks, ads, bankAccounts, goals, customers,
      tickets: desk.tickets, ticketSettings: desk.settings, revenueTarget,
    });
    return applyLiveKpis(kpiGroups, overrides);
  }, [dataReady, finance, leads, employees, knowledge, company, tasks, ads, bankAccounts, goals, customers, desk, revenueTarget, kpiGroups]);

  useEffect(() => {
    if (next?.changed) setKpiGroups(next.groups);
  }, [next, setKpiGroups]);
}
