'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from 'recharts';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useBorga } from '@/lib/borga/store';
import { ticketsApi, type ClientSettings } from '@/lib/borga/tickets-client';
import {
  STATUS_LABEL,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  TICKET_TYPES,
  fmtDuration,
  isDoneStatus,
  type TicketSummary,
} from '@/lib/borga/tickets';
import { SectionTitle } from '../bits';
import { slaFor } from '../ticket-bits';
import { cn } from '@/lib/utils';

const DAY = 86_400_000;
const WINDOW_DAYS = 14;
const MIN = 60_000;

const dayKey = (iso: string) => new Date(iso).toISOString().slice(0, 10);
const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

const tooltipStyle = { background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12 };

export function TicketAnalyticsTab() {
  const { activeWorkspaceId: ws } = useBorga();
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [settings, setSettings] = useState<ClientSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    const r = await ticketsApi.list(ws);
    if (r.ok) {
      setTickets(r.tickets);
      setSettings(r.settings);
      setError(null);
    } else {
      setError(r.error ?? 'Could not load tickets');
    }
    setLoading(false);
    setNowMs(Date.now());
  }, [ws]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  const stats = useMemo(() => {
    if (!settings) return null;
    const done = tickets.filter((t) => isDoneStatus(t.status));
    const active = tickets.filter((t) => !isDoneStatus(t.status));

    const firstResponses = tickets
      .filter((t) => t.firstResponseAt)
      .map((t) => (new Date(t.firstResponseAt as string).getTime() - new Date(t.createdAt).getTime()) / MIN)
      .filter((n) => Number.isFinite(n) && n >= 0);
    const resolutions = done
      .filter((t) => t.resolvedAt)
      .map((t) => (new Date((t.resolvedAt as string) ?? t.closedAt ?? t.updatedAt).getTime() - new Date(t.createdAt).getTime()) / MIN)
      .filter((n) => Number.isFinite(n) && n >= 0);

    const states = tickets.map((t) => slaFor(t, settings, nowMs).worst);
    const finishedStates = done.map((t) => slaFor(t, settings, nowMs).worst);
    const compliance = done.length
      ? Math.round((finishedStates.filter((s) => s === 'met' || s === 'running').length / done.length) * 100)
      : null;
    const reopened = tickets.filter((t) => t.reopenCount > 0).length;

    const byStatus = TICKET_STATUSES.map((s) => ({ name: STATUS_LABEL[s], value: tickets.filter((t) => t.status === s).length }));
    const byPriority = TICKET_PRIORITIES.map((p) => ({ name: p, value: tickets.filter((t) => t.priority === p).length }));
    const byType = TICKET_TYPES.map((t) => ({ name: t, value: tickets.filter((x) => x.type === t).length }));
    const byChannel = (['web', 'email', 'api'] as const).map((s) => ({ name: s, value: tickets.filter((t) => t.source === s).length }));

    const workloadMap = new Map<string, { name: string; active: number; resolved: number }>();
    for (const t of tickets) {
      const name = t.assignee || 'Unassigned';
      const row = workloadMap.get(name) ?? { name, active: 0, resolved: 0 };
      if (isDoneStatus(t.status)) row.resolved += 1;
      else row.active += 1;
      workloadMap.set(name, row);
    }
    const workload = [...workloadMap.values()].sort((a, b) => b.active - a.active || b.resolved - a.resolved).slice(0, 8);

    const days: string[] = [];
    for (let i = WINDOW_DAYS - 1; i >= 0; i--) days.push(new Date(nowMs - i * DAY).toISOString().slice(0, 10));
    const volume = days.map((d) => ({
      name: dayLabel(d),
      created: tickets.filter((t) => dayKey(t.createdAt) === d).length,
      resolved: tickets.filter((t) => t.resolvedAt && dayKey(t.resolvedAt) === d).length,
    }));
    const busiestDay = volume.reduce((m, d) => (d.created > m.created ? d : m), volume[0]);
    const backlogTop = (['open', 'in-progress', 'pending'] as const)
      .map((s) => ({ name: STATUS_LABEL[s], value: tickets.filter((t) => t.status === s).length }))
      .sort((a, b) => b.value - a.value)[0] ?? null;

    const avg = (xs: number[]) => (xs.length ? xs.reduce((s, n) => s + n, 0) / xs.length : null);

    return {
      total: tickets.length,
      active: active.length,
      resolutionRate: tickets.length ? Math.round((done.length / tickets.length) * 100) : null,
      avgFirstResponse: avg(firstResponses),
      firstResponseN: firstResponses.length,
      avgResolution: avg(resolutions),
      resolutionN: resolutions.length,
      compliance,
      reopened,
      reopenRate: done.length ? Math.round((reopened / done.length) * 100) : null,
      unassigned: active.filter((t) => !t.assignee).length,
      slaCounts: {
        met: states.filter((s) => s === 'met').length,
        metLate: states.filter((s) => s === 'met-late').length,
        breached: states.filter((s) => s === 'breached').length,
        atRisk: states.filter((s) => s === 'at-risk').length,
      },
      byStatus,
      byPriority,
      byType,
      byChannel,
      workload,
      volume,
      busiestDay: busiestDay.created > 0 ? busiestDay : null,
      backlogTop: backlogTop && backlogTop.value > 0 ? backlogTop : null,
    };
  }, [tickets, settings, nowMs]);

  if (loading && !settings) {
    return <div className="flex justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }
  if (!settings || !stats) {
    return (
      <Card className="p-6 text-sm">
        <p className="font-medium">Ticket analytics unavailable</p>
        <p className="mt-1 text-muted-foreground">{error ?? 'Unknown error'}.</p>
        <Button size="sm" variant="outline" className="mt-3" onClick={refresh}>Retry</Button>
      </Card>
    );
  }

  const kpis: Array<{ label: string; value: string; sub?: string; alert?: boolean }> = [
    { label: 'Total tickets', value: String(stats.total) },
    { label: 'Active now', value: String(stats.active) },
    { label: 'Resolution rate', value: stats.resolutionRate === null ? '—' : `${stats.resolutionRate}%` },
    { label: 'Avg first response', value: stats.avgFirstResponse === null ? '—' : fmtDuration(stats.avgFirstResponse), sub: `${stats.firstResponseN} measured` },
    { label: 'Avg resolution', value: stats.avgResolution === null ? '—' : fmtDuration(stats.avgResolution), sub: `${stats.resolutionN} measured` },
    { label: 'SLA compliance', value: stats.compliance === null ? '—' : `${stats.compliance}%`, alert: stats.compliance !== null && stats.compliance < 90 },
    { label: 'Reopened', value: String(stats.reopened), sub: stats.reopenRate === null ? undefined : `${stats.reopenRate}% of resolved tickets` },
    { label: 'Unassigned', value: String(stats.unassigned), alert: stats.unassigned > 0 },
  ];

  return (
    <div className="borga-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle title="Ticket analytics" sub={`Volume, responsiveness and SLA health across ${stats.total} ticket${stats.total === 1 ? '' : 's'}`} />
        <div className="flex items-center gap-2">
          {stats.slaCounts.breached > 0 && <Badge className="bg-rose-500/10 text-rose-600">{stats.slaCounts.breached} breached</Badge>}
          {stats.slaCounts.atRisk > 0 && <Badge className="bg-amber-500/10 text-amber-600">{stats.slaCounts.atRisk} at risk</Badge>}
          <Button variant="outline" size="icon" onClick={refresh} title="Refresh"><RefreshCw className="h-4 w-4" /></Button>
        </div>
      </div>

      {error && <p className="text-xs text-amber-600">Showing last loaded data — {error}</p>}

      {stats.total === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          No tickets yet. Create one on the Tickets tab and analytics will appear here.
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {kpis.map((k) => (
              <Card key={k.label} className="p-3">
                <p className="text-[11px] text-muted-foreground">{k.label}</p>
                <p className={cn('truncate text-xl font-semibold', k.alert && 'text-rose-600')}>{k.value}</p>
                {k.sub && <p className="truncate text-[10px] text-muted-foreground">{k.sub}</p>}
              </Card>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="p-5 lg:col-span-2">
              <SectionTitle title="Ticket volume" sub={`Created vs resolved per day, last ${WINDOW_DAYS} days`} />
              <div className="mt-4 h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.volume} margin={{ left: -18, right: 4, top: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} interval={2} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="created" name="Created" fill="var(--chart-1)" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="resolved" name="Resolved" fill="var(--chart-2)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="p-5">
              <SectionTitle title="SLA health" sub="Worst live clock per ticket" />
              <p className={cn('mt-3 text-3xl font-bold', stats.compliance === null ? '' : stats.compliance >= 90 ? 'text-emerald-600' : 'text-amber-600')}>
                {stats.compliance === null ? '—' : `${stats.compliance}%`}
              </p>
              <p className="text-[11px] text-muted-foreground">of resolved tickets met SLA</p>
              <div className="mt-4 space-y-2.5">
                {[
                  ['Met', stats.slaCounts.met, 'bg-emerald-500'],
                  ['Met late', stats.slaCounts.metLate, 'bg-orange-500'],
                  ['At risk', stats.slaCounts.atRisk, 'bg-amber-500'],
                  ['Breached', stats.slaCounts.breached, 'bg-rose-500'],
                ].map(([label, value, dot]) => (
                  <div key={label as string}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 font-medium"><span className={cn('inline-block h-2 w-2 rounded-full', dot as string)} />{label}</span>
                      <span className="text-muted-foreground">{value}</span>
                    </div>
                    <Progress value={stats.total ? (Number(value) / stats.total) * 100 : 0} className="h-1.5" />
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <SectionTitle title="Backlog by status" sub="Where the active queue sits" />
              <div className="mt-4 h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.byStatus} margin={{ left: -18, right: 4, top: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} interval={0} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="value" name="Tickets" radius={[6, 6, 0, 0]}>
                      {stats.byStatus.map((s, i) => (
                        <Cell key={s.name} fill={['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'][i % 5]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="p-5">
              <SectionTitle title="Workload by agent" sub="Active vs resolved per assignee, top 8" />
              <div className="mt-4 h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.workload} margin={{ left: -18, right: 4, top: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} interval={0} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="active" name="Active" fill="var(--chart-3)" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="resolved" name="Resolved" fill="var(--chart-2)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Breakdown title="By priority" rows={stats.byPriority} total={stats.total} />
            <Breakdown title="By type" rows={stats.byType} total={stats.total} />
            <Breakdown title="By channel" rows={stats.byChannel} total={stats.total} />
          </div>

          {/* Borga's read — plain-language summary, every clause backed by a number above */}
          <Card className="border-dashed p-4">
            <p className="text-xs font-semibold text-primary">Borga&apos;s read</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {stats.active} of {stats.total} tickets are still active
              {stats.backlogTop ? `, concentrated in ${stats.backlogTop.name} (${stats.backlogTop.value}).` : '.'}
              {' '}{stats.slaCounts.breached + stats.slaCounts.atRisk > 0
                ? `${stats.slaCounts.breached + stats.slaCounts.atRisk} need${stats.slaCounts.breached + stats.slaCounts.atRisk === 1 ? 's' : ''} SLA attention (${stats.slaCounts.breached} breached, ${stats.slaCounts.atRisk} at risk).`
                : 'No ticket is currently at SLA risk.'}
              {stats.unassigned > 0 ? ` ${stats.unassigned} active ticket${stats.unassigned === 1 ? ' is' : 's are'} unassigned — that is usually the fastest win.` : ''}
              {stats.busiestDay ? ` Busiest intake was ${stats.busiestDay.name} with ${stats.busiestDay.created} new ticket${stats.busiestDay.created === 1 ? '' : 's'}.` : ''}
              {stats.avgFirstResponse !== null ? ` First response averages ${fmtDuration(stats.avgFirstResponse)} across ${stats.firstResponseN} measured tickets.` : ''}
            </p>
          </Card>
        </>
      )}
    </div>
  );
}

function Breakdown({ title, rows, total }: { title: string; rows: Array<{ name: string; value: number }>; total: number }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <Card className="p-5">
      <SectionTitle title={title} sub={`${total} ticket${total === 1 ? '' : 's'} total`} />
      <div className="mt-4 space-y-2.5">
        {rows.map((r) => (
          <div key={r.name}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="font-medium capitalize">{r.name}</span>
              <span className="text-muted-foreground">{r.value}</span>
            </div>
            <Progress value={(r.value / max) * 100} className="h-1.5" />
          </div>
        ))}
      </div>
    </Card>
  );
}
