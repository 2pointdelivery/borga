'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Clock,
  LogIn,
  LogOut,
  Download,
  Play,
  Square,
  Timer,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { fmtNum, type TimeEntry } from '@/lib/borga/data';
import { useBorga } from '@/lib/borga/store';
import { AgentAvatar, SectionTitle } from '../bits';
import { cn } from '@/lib/utils';

function durationLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function minutesBetween(aIso: string, bIso?: string): number | null {
  if (!bIso) return null;
  return Math.max(0, Math.round((new Date(bIso).getTime() - new Date(aIso).getTime()) / 60000));
}

/** Live ticking minutes for an open entry. */
function LiveDuration({ since }: { since: string }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);
  return <span>{durationLabel(minutesBetween(since, new Date().toISOString()) ?? 0)}</span>;
}

export function TimeClockTab() {
  const { employees, timeEntries, clockIn, clockOut, addTimeEntry, updateTimeEntry, deleteTimeEntry, log, userName, finance } = useBorga();
  const [query, setQuery] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [manualForm, setManualForm] = useState({ employeeId: '', date: new Date().toISOString().slice(0, 10), inTime: '09:00', outTime: '17:00', note: '' });

  const activeByEmployee = useMemo(() => {
    const map = new Map<string, TimeEntry>();
    timeEntries.forEach((t) => {
      if (!t.clockOutIso && !map.has(t.employeeId)) map.set(t.employeeId, t);
    });
    return map;
  }, [timeEntries]);

  const filteredEntries = useMemo(
    () =>
      timeEntries
        .filter((t) => !query || `${t.employeeName} ${t.clockInLabel} ${t.note ?? ''}`.toLowerCase().includes(query.toLowerCase()))
        .sort((a, b) => (a.clockInIso < b.clockInIso ? 1 : -1)),
    [timeEntries, query],
  );

  // This week's totals (Mon—Sun of the current week).
  const weekTotals = useMemo(() => {
    const now = new Date();
    const day = (now.getUTCDay() + 6) % 7; // Mon=0
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day));
    const map = new Map<string, number>();
    timeEntries.forEach((t) => {
      const start = new Date(t.clockInIso);
      if (start < monday) return;
      const min = t.durationMin ?? minutesBetween(t.clockInIso, t.clockOutIso ?? new Date().toISOString()) ?? 0;
      map.set(t.employeeId, (map.get(t.employeeId) ?? 0) + min);
    });
    return map;
  }, [timeEntries]);

  // ── Payroll reconciliation — which months have hours but no posted payroll? ──
  const payrollCoverage = useMemo(() => {
    const byMonth = new Map<string, { minutes: number; employees: Set<string> }>();
    timeEntries.forEach((t) => {
      if (!t.clockOutIso) return; // still clocked in
      const key = t.clockInIso.slice(0, 7);
      const rec = byMonth.get(key) ?? { minutes: 0, employees: new Set<string>() };
      rec.minutes += t.durationMin ?? Math.round((new Date(t.clockOutIso).getTime() - new Date(t.clockInIso).getTime()) / 60000);
      rec.employees.add(t.employeeId);
      byMonth.set(key, rec);
    });
    // Posted payroll runs, keyed by the month they were executed.
    const paidMonths = new Set(
      finance.filter((f) => f.label.startsWith('Payroll — ') && !f.voidedAt && f.createdAt).map((f) => f.createdAt!.slice(0, 7)),
    );
    const monthlySalary = employees.filter((e) => e.status === 'active').reduce((s, e) => s + e.salary / 12, 0);
    return [...byMonth.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .slice(0, 6)
      .map(([month, r]) => {
        const hours = Math.round((r.minutes / 60) * 10) / 10;
        // Prorate the salary base against a nominal 160h per covered employee.
        const capacity = Math.max(1, r.employees.size) * 160;
        const estCost = Math.round(monthlySalary * Math.min(1, hours / capacity));
        return { month, hours, headcount: r.employees.size, reconciled: paidMonths.has(month), estCost };
      });
  }, [timeEntries, finance, employees]);

  const submitManual = () => {
    const emp = employees.find((e) => e.id === manualForm.employeeId);
    if (!emp || !manualForm.date || !manualForm.inTime || !manualForm.outTime) return;
    const inIso = new Date(`${manualForm.date}T${manualForm.inTime}:00`).toISOString();
    const outIso = new Date(`${manualForm.date}T${manualForm.outTime}:00`).toISOString();
    if (outIso <= inIso) return;
    const durationMin = Math.round((new Date(outIso).getTime() - new Date(inIso).getTime()) / 60000);
    if (editing) {
      updateTimeEntry(editing.id, {
        clockInIso: inIso,
        clockInLabel: new Date(inIso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        clockOutIso: outIso,
        clockOutLabel: new Date(outIso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        durationMin,
        note: manualForm.note.trim() || undefined,
      });
      log({ agentId: 'a-people', agentName: 'Rigby', actor: 'user', kind: 'task', message: `Timesheet entry corrected for ${emp.name} (${durationLabel(durationMin)}).` });
    } else {
      addTimeEntry({
        id: `te-${Date.now().toString(36)}`,
        employeeId: emp.id,
        employeeName: emp.name,
        clockInIso: inIso,
        clockInLabel: new Date(inIso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        clockOutIso: outIso,
        clockOutLabel: new Date(outIso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        durationMin,
        note: manualForm.note.trim() || undefined,
        editedBy: 'user',
      });
      log({ agentId: 'a-people', agentName: 'Rigby', actor: 'user', kind: 'task', message: `Manual timesheet entry added for ${emp.name} (${durationLabel(durationMin)}).` });
    }
    setManualOpen(false);
    setEditing(null);
  };

  const exportCsv = () => {
    const rows = [
      ['employee', 'clock_in', 'clock_out', 'duration_minutes', 'note'],
      ...filteredEntries.map((t) => [
        t.employeeName,
        t.clockInIso,
        t.clockOutIso ?? '',
        String(t.durationMin ?? minutesBetween(t.clockInIso, t.clockOutIso ?? new Date().toISOString()) ?? ''),
        t.note ?? '',
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `timesheet-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    log({ agentId: 'a-people', agentName: 'Rigby', actor: 'user', kind: 'sync', message: 'Timesheet exported as CSV.' });
  };

  return (
    <div className="borga-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle title="Time clock" sub={`${activeByEmployee.size} team member${activeByEmployee.size === 1 ? '' : 's'} currently clocked in`} />
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCsv}>
            <Download className="h-4 w-4" /> Export timesheet
          </Button>
          <Button onClick={() => { setEditing(null); setManualForm({ employeeId: employees[0]?.id ?? '', date: new Date().toISOString().slice(0, 10), inTime: '09:00', outTime: '17:00', note: '' }); setManualOpen(true); }}>
            <Timer className="h-4 w-4" /> Add entry
          </Button>
        </div>
      </div>

      {/* Payroll reconciliation — hours worked vs posted payroll runs */}
      {payrollCoverage.length > 0 && (
        <Card className="p-4">
          <p className="text-sm font-semibold">Payroll reconciliation</p>
          <p className="text-[11px] text-muted-foreground">Months with recorded hours vs posted payroll runs — run payroll from the HR directory to reconcile.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {payrollCoverage.map((m) => (
              <div key={m.month} className="flex items-center justify-between rounded-lg border px-3 py-2">
                <div>
                  <p className="text-xs font-medium">{new Date(`${m.month}-01T00:00:00`).toLocaleDateString([], { month: 'long', year: 'numeric' })}</p>
                  <p className="text-[10px] text-muted-foreground">{m.hours}h across {m.headcount} people{m.reconciled ? '' : ` · est. $${fmtNum(m.estCost)} unpaid`}</p>
                </div>
                <span className={cn(
                  'rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase ring-1',
                  m.reconciled ? 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/30' : 'bg-amber-500/10 text-amber-600 ring-amber-500/30',
                )}>
                  {m.reconciled ? 'paid' : 'unpaid'}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Clock cards */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {employees.filter((e) => e.status !== 'offboarded').map((e) => {
          const active = activeByEmployee.get(e.id);
          const weekMin = weekTotals.get(e.id) ?? 0;
          return (
            <Card key={e.id} className={cn('p-4', active && 'ring-1 ring-emerald-500/40')}>
              <div className="flex items-center gap-3">
                <AgentAvatar name={e.name} color="#6366f1" size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{e.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{e.role}</p>
                </div>
                {active ? (
                  <Badge className="gap-1 bg-emerald-500/10 text-emerald-600 text-[10px]">
                    <Play className="h-2.5 w-2.5" /> on shift
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-[10px]">off</Badge>
                )}
              </div>
              <div className="mt-3 flex items-center justify-between">
                <div className="text-xs text-muted-foreground">
                  This week <span className="font-mono font-semibold text-foreground">{durationLabel(weekMin)}</span>
                  {active && (
                    <span className="ml-2 inline-flex items-center gap-1 text-emerald-600">
                      <Clock className="h-3 w-3" /> <LiveDuration since={active.clockInIso} /> since {active.clockInLabel}
                    </span>
                  )}
                </div>
                {active ? (
                  <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => { clockOut(active.id); log({ agentId: 'a-people', agentName: 'Rigby', actor: 'user', kind: 'task', message: `${e.name} clocked out at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` }); }}>
                    <Square className="h-3 w-3" /> Clock out
                  </Button>
                ) : (
                  <Button size="sm" className="h-7 gap-1" onClick={() => { clockIn(e.id, e.name); log({ agentId: 'a-people', agentName: 'Rigby', actor: 'user', kind: 'task', message: `${e.name} clocked in at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` }); }}>
                    <LogIn className="h-3 w-3" /> Clock in
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {/* Timesheet */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b bg-muted/40 px-4 py-2.5">
          <div>
            <p className="text-sm font-semibold">Timesheet</p>
            <p className="text-[11px] text-muted-foreground">{filteredEntries.length} entries — open shifts tick live</p>
          </div>
          <div className="w-48">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search entries…" className="h-8 text-xs" />
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Employee</th>
              <th className="hidden px-4 py-2 font-medium sm:table-cell">Date</th>
              <th className="px-4 py-2 font-medium">In</th>
              <th className="px-4 py-2 font-medium">Out</th>
              <th className="px-4 py-2 text-right font-medium">Duration</th>
              <th className="hidden px-4 py-2 font-medium lg:table-cell">Note</th>
              <th className="w-16 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {filteredEntries.slice(0, 100).map((t) => {
              const min = t.durationMin ?? minutesBetween(t.clockInIso, t.clockOutIso ?? undefined);
              const day = new Date(t.clockInIso).toLocaleDateString([], { month: 'short', day: 'numeric' });
              return (
                <tr key={t.id} className="border-b last:border-0 hover:bg-muted/20">
                  <td className="px-4 py-2.5 font-medium">{t.employeeName}</td>
                  <td className="hidden px-4 py-2.5 text-muted-foreground sm:table-cell">{day}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{t.clockInLabel}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">
                    {t.clockOutLabel ?? (
                      <span className="inline-flex items-center gap-1 text-emerald-600"><LogIn className="h-3 w-3" /> open</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs">
                    {t.clockOutIso ? durationLabel(min ?? 0) : <LiveDuration since={t.clockInIso} />}
                  </td>
                  <td className="hidden max-w-[180px] truncate px-4 py-2.5 text-xs text-muted-foreground lg:table-cell">
                    {t.note ?? ''}{t.editedBy === 'user' ? ' (edited)' : ''}
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="flex justify-end gap-0.5">
                      <button
                        onClick={() => {
                          setEditing(t);
                          const inD = new Date(t.clockInIso);
                          const outD = t.clockOutIso ? new Date(t.clockOutIso) : new Date();
                          setManualForm({
                            employeeId: t.employeeId,
                            date: inD.toISOString().slice(0, 10),
                            inTime: inD.toTimeString().slice(0, 5),
                            outTime: outD.toTimeString().slice(0, 5),
                            note: t.note ?? '',
                          });
                          setManualOpen(true);
                        }}
                        className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary"
                        title="Correct entry"
                      >
                        <Timer className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => { deleteTimeEntry(t.id); log({ agentId: 'a-people', agentName: 'Rigby', actor: 'user', kind: 'system', message: `Timesheet entry removed for ${t.employeeName}.` }); }}
                        className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        title="Delete entry"
                      >
                        <LogOut className="h-3 w-3" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filteredEntries.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-xs text-muted-foreground">No time entries yet — clock in to start tracking.</td></tr>
            )}
          </tbody>
        </table>
      </Card>

      {/* Manual / correction dialog */}
      <Dialog open={manualOpen} onOpenChange={(o) => { setManualOpen(o); if (!o) setEditing(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Correct timesheet entry' : 'Add manual entry'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Team member *</label>
                <Select value={manualForm.employeeId} onValueChange={(v) => setManualForm({ ...manualForm, employeeId: v })} disabled={!!editing}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Choose…" /></SelectTrigger>
                  <SelectContent>
                    {employees.map((e) => (
                      <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Date</label>
                <Input type="date" value={manualForm.date} onChange={(e) => setManualForm({ ...manualForm, date: e.target.value })} className="mt-1" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Clock in *</label>
                <Input type="time" value={manualForm.inTime} onChange={(e) => setManualForm({ ...manualForm, inTime: e.target.value })} className="mt-1" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Clock out *</label>
                <Input type="time" value={manualForm.outTime} onChange={(e) => setManualForm({ ...manualForm, outTime: e.target.value })} className="mt-1" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Note</label>
              <Input value={manualForm.note} onChange={(e) => setManualForm({ ...manualForm, note: e.target.value })} placeholder="Field dispatch shift" className="mt-1" />
            </div>
            <p className="text-[11px] text-muted-foreground">Filed by {userName} — corrections are marked in the audit trail.</p>
          </div>
          <DialogFooter>
            <Button onClick={submitManual} disabled={!manualForm.employeeId}>
              {editing ? 'Save correction' : 'Add entry'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
