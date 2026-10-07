'use client';

import { useState } from 'react';
import { TrendingUp, TrendingDown, Plus, Target, Pencil, Radio } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
import { KPI_UNITS, kpiAttainment, kpiMeasured, type KpiEntry, type KpiDirection } from '@/lib/borga/data';
import { useBorga } from '@/lib/borga/store';
import { SectionTitle } from '../bits';
import { KpiEditDialog } from './KpiEditDialog';
import { LIVE_KPI_SOURCES } from '@/lib/borga/kpi-live';
import { cn } from '@/lib/utils';

/** A KPI is only scored once it has been measured and can be judged against a target. */
const scoreOf = (k: KpiEntry) => (kpiMeasured(k) ? kpiAttainment(k) : null);

function fmt(value: number, unit: string) {
  if (unit === '$') {
    return value >= 1000 ? `$${(value / 1000).toFixed(0)}K` : `$${value}`;
  }
  if (unit === '%') return `${value}%`;
  return value.toLocaleString();
}

export function KpisTab() {
  const { kpiGroups, addKpi, log } = useBorga();
  const [open, setOpen] = useState(false);
  const [editKpi, setEditKpi] = useState<{ groupId: string; kpi: KpiEntry } | null>(null);
  const [form, setForm] = useState({ group: kpiGroups[0]?.id ?? '', label: '', value: '', target: '', unit: '%', delta: '', direction: 'higher' as KpiDirection });

  // the live values are written into the saved set by useLiveKpis (see DashboardShell), so this page and every other reader agree
  const displayGroups = kpiGroups;

  const total = displayGroups.reduce((s, g) => s + g.kpis.length, 0);
  const liveCount = displayGroups.reduce((s, g) => s + g.kpis.filter((k) => k.live).length, 0);
  const measuredCount = displayGroups.reduce((s, g) => s + g.kpis.filter(kpiMeasured).length, 0);

  // Real composite score per department (target attainment), not a fabricated
  // time-series trend — this app doesn't persist historical KPI snapshots yet.
  // Lower-is-better metrics are scored accordingly, and unmeasured KPIs are
  // left out rather than counted as zero.
  const deptScores = displayGroups.map((g) => {
    const scored = g.kpis.map(scoreOf).filter((v): v is number => v != null);
    return {
      name: g.name,
      score: scored.length ? Math.round(scored.reduce((s, v) => s + v, 0) / scored.length) : 0,
      has: scored.length > 0,
    };
  });
  // Only departments with at least one measured, scorable KPI take part.
  const scoredDepts = deptScores.filter((d) => d.has);
  const overallScore = scoredDepts.length ? Math.round(scoredDepts.reduce((s, d) => s + d.score, 0) / scoredDepts.length) : null;

  const submit = () => {
    if (!form.label.trim()) return;
    const entry: KpiEntry = {
      label: form.label.trim(),
      value: Number(form.value) || 0,
      target: Number(form.target) || 0,
      unit: form.unit,
      delta: Number(form.delta) || 0,
      direction: form.direction,
      valueSet: form.value.trim() !== '',
    };
    addKpi(form.group, entry);
    const g = kpiGroups.find((x) => x.id === form.group);
    log({ agentId: 'a-borga', agentName: 'Borga', actor: 'user', kind: 'task', message: `KPI added to ${g?.name ?? 'department'}: ${entry.label}.` });
    setForm({ group: kpiGroups[0]?.id ?? '', label: '', value: '', target: '', unit: '%', delta: '', direction: 'higher' });
    setOpen(false);
  };

  return (
    <div className="borga-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle title="KPIs" sub={`${total} KPIs · ${liveCount} live from your data · ${measuredCount} measured`} />
        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> Add KPI
        </Button>
      </div>

      {/* Composite score by department — current snapshot, not a fabricated trend */}
      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Overall momentum</p>
            <p className="text-xs text-muted-foreground">Target attainment by department, right now</p>
          </div>
          <Badge className={cn('gap-1', overallScore == null ? 'bg-muted text-muted-foreground' : overallScore >= 70 ? 'bg-emerald-500/10 text-emerald-600' : overallScore >= 40 ? 'bg-amber-500/10 text-amber-600' : 'bg-red-500/10 text-red-600')}>
            {overallScore == null ? 'Waiting on your numbers' : <>{overallScore >= 70 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />} {overallScore}% overall</>}
          </Badge>
        </div>
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={deptScores} margin={{ left: -18, right: 4, top: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} />
              <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} domain={[0, 100]} />
              <Tooltip contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12 }} formatter={(v: number) => [`${v}%`, 'Target attainment']} />
              <Bar dataKey="score" radius={[6, 6, 0, 0]}>
                {deptScores.map((d) => (
                  <Cell key={d.name} fill={d.score >= 70 ? 'var(--chart-2)' : d.score >= 40 ? 'var(--chart-3)' : 'var(--chart-1)'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Per-department KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-2">
        {displayGroups.map((d) => {
          const scored = d.kpis.map(scoreOf).filter((v): v is number => v != null);
          const avg = scored.length ? Math.round(scored.reduce((s, v) => s + v, 0) / scored.length) : null;
          return (
            <Card key={d.id} className="p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-sm font-bold text-primary">
                    {d.name[0]}
                  </span>
                  <div>
                    <p className="font-semibold">{d.name}</p>
                    <p className="text-xs text-muted-foreground">{avg == null ? 'Waiting on your numbers' : `Target attainment ${avg}%`} — {d.kpis.length} KPIs</p>
                  </div>
                </div>
                <Progress value={avg ?? 0} className="h-1.5 w-24" />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3">
                {d.kpis.map((k) => {
                  const att = scoreOf(k);
                  const measured = kpiMeasured(k);
                  const lower = k.direction === 'lower';
                  return (
                    <div key={k.label} className="rounded-xl border bg-muted/20 p-3" title={k.benchmark}>
                      <div className="flex items-center justify-between gap-1">
                        <p className="truncate text-[11px] text-muted-foreground">
                          {k.label}
                          {lower && <span className="ml-1 text-[9px] uppercase tracking-wide text-muted-foreground/70">lower better</span>}
                        </p>
                        <div className="flex shrink-0 items-center gap-0.5">
                          {k.live && (
                            <span className="flex h-5 w-5 items-center justify-center rounded text-emerald-500" title="Computed live from your data">
                              <Radio className="h-3 w-3" />
                            </span>
                          )}
                          <button onClick={() => setEditKpi({ groupId: d.id, kpi: k })} className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-primary/10 hover:text-primary" title={k.live ? 'Edit target / delete KPI (value is computed live)' : 'Edit / delete KPI'}>
                            <Pencil className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                      <p className="mt-1 text-lg font-semibold">
                        {measured ? fmt(k.value, k.unit) : <span className="text-sm font-normal text-muted-foreground">{LIVE_KPI_SOURCES[d.id]?.[k.label] ? 'Waiting for data' : 'Enter a value'}</span>}
                        {measured && att != null && k.target > 0 && <span className="text-xs font-normal text-muted-foreground"> / {fmt(k.target, k.unit)}</span>}
                      </p>
                      <div className="mt-2 flex items-center gap-1">
                        {k.live ? (
                          <span className="text-[10px] font-medium text-emerald-600">live</span>
                        ) : !measured ? (
                          <span className="text-[10px] text-muted-foreground">{LIVE_KPI_SOURCES[d.id]?.[k.label] ? `Goes live once there are ${LIVE_KPI_SOURCES[d.id][k.label]}` : 'Entered by hand: use the pencil'}</span>
                        ) : k.delta >= 0 ? (
                          <TrendingUp className="h-3 w-3 text-emerald-500" />
                        ) : (
                          <TrendingDown className="h-3 w-3 text-rose-500" />
                        )}
                        {!k.live && measured && (
                          <span className={`text-[11px] font-medium ${k.delta >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {k.delta > 0 ? '+' : ''}{k.delta}%
                          </span>
                        )}
                        {att != null && <span className={cn('ml-auto text-[10px] font-medium', att >= 100 ? 'text-emerald-600' : att >= 70 ? 'text-amber-600' : 'text-rose-500')}>{att}%</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          );
        })}
      </div>

      {/* Add KPI dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add a KPI</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Department</label>
              <Select value={form.group} onValueChange={(v) => setForm((s) => ({ ...s, group: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {kpiGroups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">KPI label</label>
              <Input value={form.label} onChange={(e) => setForm((s) => ({ ...s, label: e.target.value }))} placeholder="e.g. Customer retention" className="mt-1" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Value</label>
                <Input type="number" value={form.value} onChange={(e) => setForm((s) => ({ ...s, value: e.target.value }))} className="mt-1" placeholder="e.g. 42" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Target</label>
                <Input type="number" value={form.target} onChange={(e) => setForm((s) => ({ ...s, target: e.target.value }))} className="mt-1" placeholder="Set later if unknown" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Delta %</label>
                <Input type="number" value={form.delta} onChange={(e) => setForm((s) => ({ ...s, delta: e.target.value }))} className="mt-1" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Unit</label>
                <Select value={form.unit} onValueChange={(v) => setForm((s) => ({ ...s, unit: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {KPI_UNITS.map((u) => (
                      <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Direction</label>
                <Select value={form.direction} onValueChange={(v) => setForm((s) => ({ ...s, direction: v as KpiDirection }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="higher">Higher is better</SelectItem>
                    <SelectItem value="lower">Lower is better</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button className="w-full gap-1.5" onClick={submit}>
              <Target className="h-4 w-4" /> Add KPI
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <KpiEditDialog
        groupId={editKpi?.groupId ?? ''}
        kpi={editKpi?.kpi ?? null}
        open={!!editKpi}
        onOpenChange={(o) => { if (!o) setEditKpi(null); }}
      />
    </div>
  );
}
