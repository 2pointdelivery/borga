'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Loader2, Mail, Plus, Trash2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBorga } from '@/lib/borga/store';
import { toast } from '@/lib/toast-bus';
import type { ReportSchedule } from '@/lib/borga/report-schedules-core';
import { cn } from '@/lib/utils';

const HEADERS = { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' };
const CADENCE_LABEL: Record<ReportSchedule['cadence'], string> = { daily: 'Daily', weekly: 'Weekly (Mon)', monthly: 'Monthly (1st)' };

/**
 * P&L email schedules: when this statement lands in the team's inbox.
 * Delivery rides Email updates (recipients, rate cap, unsubscribe); cron fires
 * the due ones, Send now is an explicit send with the numbers it carried.
 */
export function ReportScheduleCard({ visible }: { visible: boolean }) {
  const ws = useBorga((s) => s.activeWorkspaceId);
  const [schedules, setSchedules] = useState<ReportSchedule[] | null>(null);
  const [name, setName] = useState('');
  const [cadence, setCadence] = useState<ReportSchedule['cadence']>('weekly');
  const [hour, setHour] = useState('8');
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const url = `/api/borga/report-schedules?ws=${encodeURIComponent(ws)}`;
  const load = useCallback(async () => {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      const j = (await r.json()) as { ok: boolean; schedules?: ReportSchedule[] };
      if (j.ok) setSchedules(j.schedules ?? []);
    } catch {
      /* card keeps its state */
    }
  }, [url]);

  useEffect(() => {
    setSchedules(null);
    if (visible) void load();
  }, [load, visible]);

  const post = async (b: Record<string, unknown>) =>
    (await (await fetch('/api/borga/report-schedules', { method: 'POST', headers: HEADERS, body: JSON.stringify({ ...b, ws }) })).json()) as Record<string, unknown> & { ok: boolean; errors?: string[]; error?: string };

  const create = async () => {
    setBusy('create');
    setErrors([]);
    try {
      const r = await post({ action: 'save', schedule: { name: name.trim() || `${CADENCE_LABEL[cadence]} P&L`, cadence, hour: Number(hour) } });
      if (r.ok) {
        toast({ title: 'Schedule saved', description: `The P&L lands in the team inbox ${CADENCE_LABEL[cadence].toLowerCase()} from ${String(hour).padStart(2, '0')}:00 (company-local). Recipients come from Email updates.`, variant: 'success' });
        setName('');
        void load();
      } else setErrors(r.errors ?? [r.error ?? 'Could not save.']);
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (s: ReportSchedule, enabled: boolean) => {
    await post({ action: 'toggle', id: s.id, enabled });
    void load();
  };

  const remove = async (s: ReportSchedule) => {
    if (!window.confirm(`Delete the "${s.name}" schedule?`)) return;
    await post({ action: 'delete', id: s.id });
    void load();
  };

  const sendNow = async (s: ReportSchedule) => {
    setBusy(s.id);
    setMsg(null);
    try {
      const r = (await post({ action: 'sendNow', id: s.id })) as { ok: boolean; sent?: number; skipped?: string; pl?: { netIncome: number; label: string }; error?: string };
      if (r.ok) {
        toast({ title: `P&L emailed to ${r.sent}`, description: r.pl ? `Net income ${r.pl.netIncome} for ${r.pl.label}.` : undefined, variant: 'success' });
      } else {
        setMsg(r.skipped === 'no-smtp'
          ? 'Nothing sent: no mail server is configured (Postmark or SMTP — Settings → Email updates explains). The schedule still fires when mail is set up.'
          : `Not sent: ${r.skipped ?? r.error ?? 'unknown error'}.`);
      }
      void load();
    } finally {
      setBusy(null);
    }
  };

  if (!visible) return null;

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <CalendarClock className="h-4 w-4 text-primary" /> Email this report
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        The P&L lands in the team inbox on the cadence you pick. Recipients, rate cap and unsubscribe all come from Email updates; cron sends the due ones even with the dashboard closed.
      </p>
      {schedules !== null && schedules.length > 0 && (
        <ul className="mt-3 divide-y rounded-lg border text-xs">
          {schedules.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="min-w-0">
                <span className="font-medium">{s.name}</span>
                <span className="text-muted-foreground">
                  {' '}· {CADENCE_LABEL[s.cadence]} at {String(s.hour).padStart(2, '0')}:00
                  {s.lastSentAt ? ` · last sent ${new Date(s.lastSentAt).toLocaleDateString()}` : ''}
                  {s.lastResult ? ` · ${s.lastResult}` : ''}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <Switch checked={s.enabled} onCheckedChange={(v) => void toggle(s, v)} aria-label={`Toggle ${s.name}`} />
                <Button size="sm" variant="outline" className="h-6 gap-1 text-[11px]" disabled={busy !== null} onClick={() => void sendNow(s)}>
                  {busy === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mail className="h-3 w-3" />} Send now
                </Button>
                <button onClick={() => void remove(s)} className="text-muted-foreground hover:text-destructive" aria-label={`Delete ${s.name}`}><Trash2 className="h-3 w-3" /></button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="min-w-40 flex-1">
          <label className="text-[11px] text-muted-foreground">Name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={`${CADENCE_LABEL[cadence]} P&L`} className="mt-0.5 h-8" />
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground">Cadence</label>
          <Select value={cadence} onValueChange={(v) => setCadence(v as ReportSchedule['cadence'])}>
            <SelectTrigger className="mt-0.5 h-8 w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="weekly">Weekly (Mon)</SelectItem>
              <SelectItem value="monthly">Monthly (1st)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground">Hour</label>
          <Select value={hour} onValueChange={setHour}>
            <SelectTrigger className="mt-0.5 h-8 w-24"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Array.from({ length: 24 }, (_, h) => <SelectItem key={h} value={String(h)}>{String(h).padStart(2, '0')}:00</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" className="h-8 gap-1" disabled={busy !== null} onClick={() => void create()}>
          {busy === 'create' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Schedule
        </Button>
      </div>
      {errors.length > 0 && <ul className="mt-2 text-[11px] text-rose-600">{errors.map((e) => <li key={e}>· {e}</li>)}</ul>}
      {msg && <p className={cn('mt-2 rounded-lg border px-3 py-2 text-[11px]', msg.includes('Nothing sent') ? 'border-amber-500/30 bg-amber-500/5 text-amber-700' : 'border-rose-500/30 text-rose-600')}>{msg}</p>}
      {schedules !== null && schedules.length === 0 && <p className="mt-2 text-[11px] text-muted-foreground">No schedules yet — the weekly P&L is the usual choice.</p>}
    </Card>
  );
}
