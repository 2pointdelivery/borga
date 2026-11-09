'use client';

import { fmtMoney } from '@/lib/borga/currencies';
import { useMemo, useState } from 'react';
import { Plus, Trash2, TrendingUp, Target, Gauge, CalendarRange, Pencil } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import {
      type RevenueTrack,
  type RevenueLine,
} from '@/lib/borga/data';
import { useBorga } from '@/lib/borga/store';
import { ledgerActualsByService, makeServiceLines, parseMonthLabel, reconcileServiceLines } from '@/lib/borga/services';
import { CreatePlanDialog, ServicesCard, useCompanyServices } from './RevenueServices';
import { SearchSelect } from '../SearchSelect';
import { ConfirmDialog } from '../ConfirmDialog';
import { toast } from '@/lib/toast-bus';
import { cn } from '@/lib/utils';

const pctOf = (a: number, t: number) => (t > 0 ? Math.min(100, Math.round((a / t) * 100)) : 0);

export function RevenueTrackerTab() {
  const {
    revenueTracks,
    addRevenueTrack,
    updateRevenueTrack,
    deleteRevenueTrack,
    setRevenueActual,
    setRevenueActualTotal,
    activeWorkspace,
    finance,
  } = useBorga();
  const { services, save: saveServices } = useCompanyServices();
  const [planOpen, setPlanOpen] = useState(false);
  const currency = activeWorkspace()?.currency ?? 'USD';
  const money = (n: number) => fmtMoney(n, currency);

  const [trackId, setTrackId] = useState<string | null>(null);
  const track = revenueTracks.find((t) => t.id === trackId) ?? revenueTracks[0];
  const [view, setView] = useState<string>('all');
  const [addTrackOpen, setAddTrackOpen] = useState(false);
  const [addLineOpen, setAddLineOpen] = useState(false);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [editingLineName, setEditingLineName] = useState('');
  const [confirmDeleteLine, setConfirmDeleteLine] = useState<RevenueLine | null>(null);
  const [confirmDeleteTrack, setConfirmDeleteTrack] = useState(false);

  const commitLineRename = () => {
    if (!track || !editingLineId) return;
    const name = editingLineName.trim();
    if (name) {
      updateRevenueTrack(track.id, { lines: track.lines.map((x) => (x.id === editingLineId ? { ...x, name } : x)) });
    }
    setEditingLineId(null);
  };
  const [editTargets, setEditTargets] = useState(false);

  const months = useMemo(() => track?.months ?? [], [track]);
  const lines = useMemo(() => track?.lines ?? [], [track]);
  const viewLines = useMemo(
    () => (view === 'all' ? lines : lines.filter((l) => l.id === view)),
    [view, lines],
  );

  const viewTotals = useMemo(() => {
    const targets = months.map((_, m) => viewLines.reduce((s, l) => s + (l.targets[m] ?? 0), 0));
    const actuals = months.map((_, m) => viewLines.reduce((s, l) => s + (l.actuals[m] ?? 0), 0));
    return { targets, actuals };
  }, [months, viewLines]);
  const totalTarget = (m: number) => viewTotals.targets[m] ?? 0;
  const totalActual = (m: number) => viewTotals.actuals[m] ?? 0;

  const summary = useMemo(() => {
    if (!track) return null;
    const tgt = viewTotals.targets.reduce((s, v) => s + v, 0);
    const act = viewTotals.actuals.reduce((s, v) => s + v, 0);
    const lastMonthIdx = months.length - 1;
    const mTgt = totalTarget(lastMonthIdx);
    const mAct = totalActual(lastMonthIdx);
    const entered = viewTotals.actuals.filter((v) => v > 0);
    const runRate = entered.length ? entered[entered.length - 1] * 12 : 0;
    return { tgt, act, pct: pctOf(act, tgt), mTgt, mAct, mPct: pctOf(mAct, mTgt), runRate };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, months, viewTotals]);

  const chartData = useMemo(
    () =>
      months.map((m, i) => ({
        month: m,
        Target: viewTotals.targets[i] ?? 0,
        Actual: viewTotals.actuals[i] ?? 0,
      })),
    [months, viewTotals],
  );

  const mixData = useMemo(
    () =>
      months.map((m, i) => {
        const row: Record<string, number | string> = { month: m };
        for (const l of lines) row[l.name] = l.targets[i] ?? 0;
        return row;
      }),
    [months, lines],
  );

  // Keep the plan in step with the company's services.
  const recon = useMemo(() => reconcileServiceLines(lines, services), [lines, services]);

  function addMissingServiceLines() {
    if (!track || !recon.missing.length) return;
    updateRevenueTrack(track.id, { lines: [...track.lines, ...makeServiceLines(recon.missing, months.length, 0, track.lines.length)] });
    toast({ title: 'Plan updated', description: recon.missing.length + ' new service line(s) added.', variant: 'success' });
  }

  /** Fills months that have no actual yet with ledger revenue attributed to each line's service. */
  function fillActualsFromLedger() {
    if (!track) return;
    const keys = months.map(parseMonthLabel);
    if (keys.every((k) => k === null)) {
      toast({ title: 'Cannot read the month labels', description: 'Use labels like "Oct \'26" to import from the ledger.', variant: 'warning' });
      return;
    }
    const names = track.lines.map((l) => l.service ?? l.name);
    const byService = ledgerActualsByService(finance, names, keys);
    let filled = 0;
    track.lines.forEach((l, li) => {
      byService[names[li]].forEach((amt, mi) => {
        if (amt > 0 && !(l.actuals[mi] > 0)) {
          setRevenueActual(track.id, l.id, mi, Math.round(amt * 100) / 100);
          filled++;
        }
      });
    });
    toast(filled
      ? { title: filled + ' month(s) filled from the ledger', description: 'Only empty months were filled. Entries are matched to a service by category or by naming it in the description.', variant: 'success' }
      : { title: 'Nothing to import', description: 'No ledger revenue matched your services in the empty months. Matching uses the entry category or its description.', variant: 'info' });
  }

  function addTrack(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const label = String(fd.get('months') ?? '');
    const monthsList = label.split(',').map((m) => m.trim()).filter(Boolean);
    if (!monthsList.length) return;
    const t: RevenueTrack = {
      id: `rt-${Date.now()}`,
      name: String(fd.get('name') ?? 'Revenue plan'),
      periodLabel: String(fd.get('period') ?? ''),
      months: monthsList,
      monthContexts: [],
      lines: [],
      createdAt: new Date().toISOString(),
    };
    addRevenueTrack(t);
    setTrackId(t.id);
    setAddTrackOpen(false);
  }

  const [lineName, setLineName] = useState('');
  const [lineColor, setLineColor] = useState('#2a78d6');
  const [lineTargets, setLineTargets] = useState<string[]>([]);

  function openAddLine() {
    setLineName('');
    setLineColor('#2a78d6');
    setLineTargets(months.map(() => ''));
    setAddLineOpen(true);
  }

  function addLine() {
    if (!track) return;
    const name = lineName.trim();
    if (!name) return;
    const targets = months.map((_, i) => Number(lineTargets[i]) || 0);
    const line: RevenueLine = {
      id: `rl-${Date.now()}`,
      name,
      color: lineColor || '#2a78d6',
      targets,
      actuals: months.map(() => 0),
    };
    updateRevenueTrack(track.id, { lines: [...track.lines, line] });
    setAddLineOpen(false);
  }

  if (!track) {
    return (
      <div className="space-y-4">
        <ServicesCard services={services} onChange={saveServices} />
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center">
          <TrendingUp className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {services.length
              ? 'No revenue plan yet. Build one with a line for each of your ' + services.length + ' service' + (services.length === 1 ? '' : 's') + ', then compare targets with actuals.'
              : 'Add the services you sell above and the tracker builds a revenue line for each.'}
          </p>
          <Button onClick={() => setPlanOpen(true)} disabled={services.length === 0}>
            <Plus className="mr-2 h-4 w-4" /> Create plan from my services
          </Button>
          <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setAddTrackOpen(true)}>or build a custom tracker</button>
        </div>
        <CreatePlanDialog open={planOpen} onOpenChange={setPlanOpen} services={services} onCreate={(t) => { addRevenueTrack(t); setTrackId(t.id); }} />
        <AddTrackDialog open={addTrackOpen} onOpenChange={setAddTrackOpen} onSubmit={addTrack} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{track.name}</h3>
          <p className="text-xs text-muted-foreground">{track.periodLabel} · actual vs target · all service lines</p>
        </div>
        <div className="flex items-center gap-2">
          {revenueTracks.length > 1 && (
            <SearchSelect
              options={revenueTracks.map((t) => ({ value: t.id, label: t.name, detail: t.periodLabel }))}
              value={track.id}
              onChange={(v) => { if (v) { setTrackId(v); setView('all'); } }}
              placeholder="Select tracker"
              searchPlaceholder="Search trackers"
              clearable={false}
              className="h-8 text-xs"
            />
          )}
          <Button size="sm" variant="outline" onClick={openAddLine}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add line
          </Button>
          <Button size="sm" variant="outline" onClick={() => setAddTrackOpen(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" /> New tracker
          </Button>
          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" title="Delete tracker" onClick={() => setConfirmDeleteTrack(true)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <ServicesCard services={services} onChange={saveServices} />

      {(recon.missing.length > 0 || recon.orphaned.length > 0) && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-amber-500/30 bg-amber-500/5 p-3 text-xs">
          <div>
            {recon.missing.length > 0 && <p><strong>{recon.missing.length}</strong> service{recon.missing.length === 1 ? '' : 's'} not in this plan: {recon.missing.join(', ')}.</p>}
            {recon.orphaned.length > 0 && <p className="text-muted-foreground">{recon.orphaned.map((l) => l.name).join(', ')} {recon.orphaned.length === 1 ? 'is' : 'are'} no longer in your services. {recon.orphaned.length === 1 ? 'It is' : 'They are'} kept so recorded actuals are not lost; delete {recon.orphaned.length === 1 ? 'it' : 'them'} if not needed.</p>}
          </div>
          {recon.missing.length > 0 && <Button size="sm" onClick={addMissingServiceLines}>Add {recon.missing.length === 1 ? 'it' : 'them'} to the plan</Button>}
        </Card>
      )}

      {/* Summary metrics */}
      {summary && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          <MetricCard icon={<Target className="h-3.5 w-3.5" />} label={`${months.length}-month target`} value={money(summary.tgt)} sub="net revenue" tone="info" />
          <MetricCard icon={<TrendingUp className="h-3.5 w-3.5" />} label="Actual to date" value={money(summary.act)} sub={`${summary.pct}% of target`} tone={summary.pct >= 80 ? 'ok' : summary.pct >= 50 ? 'warn' : 'info'} />
          <MetricCard icon={<CalendarRange className="h-3.5 w-3.5" />} label={`${months[months.length - 1]} target`} value={money(summary.mTgt)} sub="peak month" tone="info" />
          <MetricCard icon={<CalendarRange className="h-3.5 w-3.5" />} label={`${months[months.length - 1]} actual`} value={money(summary.mAct)} sub={`${summary.mPct}% of target`} tone={summary.mPct >= 80 ? 'ok' : summary.mPct >= 50 ? 'warn' : 'info'} />
          <MetricCard icon={<Gauge className="h-3.5 w-3.5" />} label="Annualised run rate" value={summary.runRate ? money(summary.runRate) : '—'} sub={summary.runRate ? 'based on latest month' : 'no actuals yet'} tone="info" />
          {track.takeRates?.length ? <MetricCard icon={<Gauge className="h-3.5 w-3.5" />} label="Take rate target" value={`${track.takeRates[track.takeRates.length - 1]}%`} sub={months[months.length - 1] ?? ''} tone="info" /> : null}
        </div>
      )}

      {/* View filter pills */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted-foreground">View</span>
        <Pill active={view === 'all'} onClick={() => setView('all')}>All lines</Pill>
        {lines.map((l) => (
          <Pill key={l.id} active={view === l.id} onClick={() => setView(l.id)} color={l.color}>
            {l.name}
          </Pill>
        ))}
      </div>

      {/* Target vs actual chart */}
      <Card className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-sm font-medium">
            Net revenue — {view === 'all' ? 'all service lines' : lines.find((l) => l.id === view)?.name}
          </h4>
        </div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ left: -12, right: 4, top: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
              <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v))} />
              <Tooltip
                contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12 }}
                formatter={(v) => money(Number(v))}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Target" fill="#2a78d6" fillOpacity={0.3} stroke="#2a78d6" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Actual" fill="#1baf7a" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Revenue mix (targets) */}
      {view === 'all' && lines.length > 0 && (
        <Card className="p-4">
          <h4 className="mb-2 text-sm font-medium">Revenue mix — target by service line</h4>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={mixData} margin={{ left: -12, right: 4, top: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v))} />
                <Tooltip
                  contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12 }}
                  formatter={(v) => money(Number(v))}
                />
                {lines.map((l) => (
                  <Bar key={l.id} dataKey={l.name} stackId="mix" fill={l.color} radius={0} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Monthly targets vs actuals */}
      <Card className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-sm font-medium">Monthly targets vs actuals</h4>
          <div className="flex items-center gap-3">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={fillActualsFromLedger}>Fill empty months from ledger</Button>
            <p className="text-xs text-muted-foreground">Enter actuals inline — saved automatically</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Month</th>
                {track.monthContexts?.some(Boolean) && <th className="py-2 pr-3 font-medium">Context</th>}
                <th className="py-2 pr-3 font-medium">Target (net)</th>
                <th className="py-2 pr-3 font-medium">Actual</th>
                <th className="py-2 pr-3 font-medium">Progress</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                {track.takeRates?.length ? <th className="py-2 font-medium">Take rate</th> : null}
              </tr>
            </thead>
            <tbody>
              {months.map((m, i) => {
                const tgt = totalTarget(i);
                const act = totalActual(i);
                const p = pctOf(act, tgt);
                return (
                  <tr key={m} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="py-2 pr-3 font-medium">{m}</td>
                    {track.monthContexts?.some(Boolean) && (
                      <td className="py-2 pr-3 text-muted-foreground">{track.monthContexts?.[i] ?? ''}</td>
                    )}
                    <td className="py-2 pr-3">{money(tgt)}</td>
                    <td className="py-2 pr-3">
                      <Input
                        key={`${track.id}-${view}-${i}-${act}`}
                        type="number"
                        min={0}
                        className="h-7 w-24 text-right text-xs"
                        defaultValue={act || ''}
                        placeholder="0"
                        onBlur={(e) => {
                          const n = Number(e.target.value) || 0;
                          if (n === act) return;
                          if (view === 'all') setRevenueActualTotal(track.id, i, n);
                          else setRevenueActual(track.id, view, i, n);
                        }}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn('h-full rounded-full', p >= 95 ? 'bg-emerald-500' : p >= 70 ? 'bg-amber-500' : 'bg-rose-500')}
                            style={{ width: `${p}%` }}
                          />
                        </div>
                        <span className="w-8 text-right text-[11px] font-medium">{p}%</span>
                      </div>
                    </td>
                    <td className="py-2 pr-3"><StatusBadge actual={act} target={tgt} /></td>
                    {track.takeRates?.length ? (
                      <td className="py-2 text-muted-foreground">{track.takeRates[i] != null ? `${track.takeRates[i]}%` : ''}</td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Service-line breakdown */}
      <Card className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-sm font-medium">
            {view === 'all' ? 'Service line breakdown' : `${lines.find((l) => l.id === view)?.name} — monthly detail`}
          </h4>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditTargets((v) => !v)}>
            <Pencil className="mr-1 h-3 w-3" /> {editTargets ? 'Done' : 'Edit targets'}
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Service line</th>
                {months.map((m) => <th key={m} className="py-2 pr-3 font-medium">{m}</th>)}
                <th className="py-2 pr-3 font-medium">Total target</th>
                <th className="py-2 font-medium">Total actual</th>
              </tr>
            </thead>
            <tbody>
              {viewLines.map((l) => {
                const tT = l.targets.reduce((s, v) => s + v, 0);
                const tA = l.actuals.reduce((s, v) => s + v, 0);
                return (
                  <tr key={l.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="py-2 pr-3 font-medium">
                      <div className="group flex items-center gap-1.5">
                        <span className="mr-0.5 inline-block h-2 w-2 shrink-0 rounded-sm" style={{ background: l.color }} />
                        <span className="min-w-0 truncate">{l.name}</span>
                        {editingLineId === l.id ? (
                          <Input
                            autoFocus
                            value={editingLineName}
                            onChange={(e) => setEditingLineName(e.target.value)}
                            onBlur={commitLineRename}
                            onKeyDown={(e) => { if (e.key === 'Enter') commitLineRename(); if (e.key === 'Escape') setEditingLineId(null); }}
                            className="h-6 w-32 text-xs"
                          />
                        ) : (
                          <>
                            <button
                              onClick={() => { setEditingLineId(l.id); setEditingLineName(l.name); }}
                              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-primary/10 hover:text-primary group-hover:opacity-100"
                              title="Rename line"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button
                              onClick={() => setConfirmDeleteLine(l)}
                              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                              title="Delete line — zeroes its targets but recorded actuals are kept on the other lines"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                    {months.map((_, i) => {
                      const t = l.targets[i] ?? 0;
                      const a = l.actuals[i] ?? 0;
                      const p = pctOf(a, t);
                      return (
                        <td key={i} className="py-2 pr-3">
                          {editTargets ? (
                            <Input
                              key={`${l.id}-${i}-${t}`}
                              type="number"
                              min={0}
                              className="h-7 w-20 text-right text-xs"
                              defaultValue={t || ''}
                              placeholder="0"
                              onBlur={(e) => {
                                const n = Number(e.target.value) || 0;
                                if (n === t || !track) return;
                                updateRevenueTrack(track.id, {
                                  lines: track.lines.map((x) =>
                                    x.id === l.id ? { ...x, targets: x.targets.map((tv, ti) => (ti === i ? n : tv)) } : x,
                                  ),
                                });
                              }}
                            />
                          ) : (
                            <>
                              <div>{money(t)}</div>
                              <div className={cn('text-[10px]', p >= 95 ? 'text-emerald-600' : p >= 70 ? 'text-amber-600' : a > 0 ? 'text-rose-600' : 'text-muted-foreground')}>
                                {a > 0 ? `${money(a)} (${p}%)` : '—'}
                              </div>
                            </>
                          )}
                        </td>
                      );
                    })}
                    <td className="py-2 pr-3 font-medium">{money(tT)}</td>
                    <td className={cn('py-2 font-medium', tA > 0 ? 'text-emerald-600' : 'text-muted-foreground')}>{tA > 0 ? money(tA) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <AddTrackDialog open={addTrackOpen} onOpenChange={setAddTrackOpen} onSubmit={addTrack} />

      <Dialog open={addLineOpen} onOpenChange={setAddLineOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add service line</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="rl-name">Name</Label>
              <Input id="rl-name" value={lineName} onChange={(e) => setLineName(e.target.value)} placeholder="e.g. Same-Day Delivery" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rl-color">Color</Label>
              <Input id="rl-color" type="color" value={lineColor} onChange={(e) => setLineColor(e.target.value)} className="h-9 w-20 p-1" />
            </div>
            <div className="space-y-1">
              <Label>Monthly targets — one per month ({months.length} months)</Label>
              <div className="grid grid-cols-4 gap-2">
                {months.map((m, i) => (
                  <div key={m} className="flex items-center gap-1">
                    <span className="w-8 shrink-0 text-[10px] text-muted-foreground">{m}</span>
                    <Input
                      type="number" min={0}
                      value={lineTargets[i] ?? ''}
                      onChange={(e) => setLineTargets((cur) => { const next = [...cur]; next[i] = e.target.value; return next; })}
                      placeholder="0"
                      className="h-7 text-right text-xs"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddLineOpen(false)}>Cancel</Button>
            <Button onClick={addLine} disabled={!lineName.trim()}>Add line</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirmDeleteLine}
        onOpenChange={(o) => { if (!o) setConfirmDeleteLine(null); }}
        title={`Delete line "${confirmDeleteLine?.name ?? ''}"?`}
        description="Its targets are removed. This does not touch actuals recorded on other lines."
        confirmLabel="Delete line"
        onConfirm={() => {
          if (!track || !confirmDeleteLine) return;
          updateRevenueTrack(track.id, { lines: track.lines.filter((x) => x.id !== confirmDeleteLine.id) });
          setConfirmDeleteLine(null);
        }}
      />

      <ConfirmDialog
        open={confirmDeleteTrack}
        onOpenChange={setConfirmDeleteTrack}
        title={`Delete tracker "${track?.name ?? ''}"?`}
        description="The whole plan — every line, target and recorded actual — is removed permanently."
        confirmLabel="Delete tracker"
        onConfirm={() => {
          if (!track) return;
          deleteRevenueTrack(track.id);
          setConfirmDeleteTrack(false);
        }}
      />
    </div>
  );
}

function MetricCard({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: string; sub: string; tone: 'ok' | 'warn' | 'info' }) {
  return (
    <Card className="p-3">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">{icon}{label}</div>
      <div className={cn('text-lg font-semibold', tone === 'ok' && 'text-emerald-600', tone === 'warn' && 'text-amber-600')}>{value}</div>
      <div className="text-[11px] text-muted-foreground">{sub}</div>
    </Card>
  );
}

function Pill({ active, onClick, color, children }: { active: boolean; onClick: () => void; color?: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-[11px] transition-colors',
        active ? 'border-transparent bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
      )}
      style={!active && color ? { borderColor: color } : undefined}
    >
      {children}
    </button>
  );
}

function StatusBadge({ actual, target }: { actual: number; target: number }) {
  if (actual === 0) return <Badge variant="secondary" className="text-[10px]">{target === 0 ? '—' : 'Not entered'}</Badge>;
  const p = pctOf(actual, target);
  if (p >= 95) return <Badge className="bg-emerald-500/10 text-[10px] text-emerald-600 hover:bg-emerald-500/10">On track</Badge>;
  if (p >= 70) return <Badge className="bg-amber-500/10 text-[10px] text-amber-600 hover:bg-amber-500/10">Behind</Badge>;
  return <Badge className="bg-rose-500/10 text-[10px] text-rose-600 hover:bg-rose-500/10">At risk</Badge>;
}

function AddTrackDialog({ open, onOpenChange, onSubmit }: { open: boolean; onOpenChange: (v: boolean) => void; onSubmit: (e: React.FormEvent<HTMLFormElement>) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>New revenue tracker</DialogTitle></DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="rt-name">Name</Label>
            <Input id="rt-name" name="name" placeholder="e.g. FY27 Revenue Plan" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="rt-period">Period label</Label>
            <Input id="rt-period" name="period" placeholder="e.g. Jan 2027 → Jun 2027" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="rt-months">Months (comma separated)</Label>
            <Input id="rt-months" name="months" placeholder="Jan '27, Feb '27, Mar '27" required />
          </div>
          <DialogFooter>
            <Button type="submit">Create tracker</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
