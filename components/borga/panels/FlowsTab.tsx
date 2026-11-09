'use client';

import { useCallback, useEffect, useState } from 'react';
import { FlaskConical, History, Play, Plus, Trash2, Workflow as WorkflowIcon, X } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBorga } from '@/lib/borga/store';
import { toast } from '@/lib/toast-bus';
import { FLOW_EVENT_META, cronDensity, parseCron, type Flow, type FlowAction, type FlowCondition, type FlowEventId, type FlowRun } from '@/lib/borga/flows-core';
import { SectionTitle } from '../bits';
import { cn } from '@/lib/utils';

const HEADERS = { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' };

const OPS: Array<{ id: FlowCondition['op']; label: string }> = [
  { id: 'equals', label: 'is' },
  { id: 'not_equals', label: 'is not' },
  { id: 'contains', label: 'contains' },
  { id: 'greater_than', label: 'more than' },
  { id: 'less_than', label: 'less than' },
  { id: 'exists', label: 'is set' },
];

interface FlowsState {
  flows: Flow[];
  runs: FlowRun[];
  events: Array<{ id: string; label: string; detail: string; fields: string[] }>;
}

function triggerSummary(f: Flow): string {
  const t = f.trigger;
  if (t.kind === 'event') return FLOW_EVENT_META[t.event]?.label ?? t.event;
  if (t.kind === 'schedule') return { hourly: 'Every hour', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' }[t.schedule];
  return `Cron ${t.expr}`;
}

function blankFlow(): Flow {
  return {
    id: '', name: '', enabled: true,
    trigger: { kind: 'event', event: 'ticket.created' },
    conditions: [], actions: [{ kind: 'notify', severity: 'noteworthy', title: '', body: '' }],
    createdAt: '', updatedAt: '', lastRunAt: null, runCount: 0, day: '', runsToday: 0, nextRun: null,
  };
}

function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** User-built workflows: when something happens (or the clock says so), check the facts, then act. */
export function FlowsTab() {
  const { activeWorkspaceId: ws } = useBorga();
  const agents = useBorga((s) => s.agents);
  const [s, setS] = useState<FlowsState | null>(null);
  const [editing, setEditing] = useState<Flow | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testOut, setTestOut] = useState<{ matched: boolean; preview?: string[]; note?: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const url = `/api/borga/flows?ws=${encodeURIComponent(ws)}`;
  const load = useCallback(async () => {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      const j = (await r.json()) as FlowsState & { ok: boolean };
      if (j.ok) setS(j);
    } catch {
      /* panel stays empty */
    }
  }, [url]);

  useEffect(() => {
    void load();
  }, [load]);

  const post = async (b: Record<string, unknown>) =>
    (await (await fetch('/api/borga/flows', { method: 'POST', headers: HEADERS, body: JSON.stringify({ ...b, ws }) })).json()) as Record<string, unknown> & { ok: boolean };

  const save = async () => {
    if (!editing || saving) return;
    setSaving(true);
    setErrors([]);
    try {
      const r = (await post({ action: 'save', flow: editing })) as { ok: boolean; flow?: Flow; errors?: string[]; cronMinutes?: number | null };
      if (r.ok && r.flow) {
        if (typeof r.cronMinutes === 'number' && r.cronMinutes < 5) {
          toast({ title: 'Saved — but it fires very often', description: `Every ~${r.cronMinutes} min. The 20-runs-a-day cap still applies.`, variant: 'warning' });
        } else {
          toast({ title: 'Workflow saved', variant: 'success' });
        }
        setEditing(null);
        setTestOut(null);
        void load();
      } else {
        setErrors(r.errors ?? ['Could not save.']);
      }
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    if (!editing || testing) return;
    setTesting(true);
    setTestOut(null);
    try {
      const r = (await post({ action: 'test', flow: editing })) as { ok: boolean; matched?: boolean; preview?: string[]; note?: string; sample?: unknown };
      if (r.ok) setTestOut({ matched: r.matched ?? true, preview: r.preview, note: r.note });
    } finally {
      setTesting(false);
    }
  };

  const runNow = async (id: string) => {
    setBusyId(id);
    try {
      const r = await post({ action: 'run', id });
      if (r.ok) toast({ title: 'Workflow fired', variant: 'success' });
      else toast({ title: 'Run failed', variant: 'error' });
      void load();
    } finally {
      setBusyId(null);
    }
  };

  const toggle = async (f: Flow, enabled: boolean) => {
    const r = await post({ action: 'toggle', id: f.id, enabled });
    if (!r.ok) toast({ title: 'Could not switch', variant: 'error' });
    void load();
  };

  const remove = async (f: Flow) => {
    if (!window.confirm(`Delete "${f.name}"? Its history stays.`)) return;
    const r = await post({ action: 'delete', id: f.id });
    if (!r.ok) toast({ title: 'Could not delete', variant: 'error' });
    void load();
  };

  const patch = (p: Partial<Flow>) => setEditing((e) => (e ? { ...e, ...p } : e));
  const eventFields = editing?.trigger.kind === 'event' ? (FLOW_EVENT_META[editing.trigger.event]?.fields ?? []) : [];

  return (
    <div className="borga-fade-up space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionTitle
          title="Workflows"
          sub="You describe the rule — when this happens and these facts hold, do that. Schedules and crons run from the heartbeat; events fire live."
        />
        <Button size="sm" className="gap-1.5" onClick={() => { setEditing(blankFlow()); setErrors([]); setTestOut(null); }}><Plus className="h-4 w-4" /> New workflow</Button>
      </div>

      {!s && <p className="text-sm text-muted-foreground">Loading…</p>}
      {s && s.flows.length === 0 && (
        <Card className="p-8 text-center">
          <WorkflowIcon className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium">No workflows yet</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            Example: when an invoice goes overdue and the amount is more than 1000, tell the finance agent to chase it.
            Or every Monday at 8, have sales review the stale pipeline.
          </p>
        </Card>
      )}

      <div className="grid gap-3">
        {s?.flows.map((f) => (
          <Card key={f.id} className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-semibold">{f.name}</p>
                  {!f.enabled && <Badge variant="outline">Off</Badge>}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {triggerSummary(f)}
                  {f.conditions.length > 0 && ` · ${f.conditions.length} condition${f.conditions.length === 1 ? '' : 's'}`}
                  {` · ${f.actions.length} action${f.actions.length === 1 ? '' : 's'}`}
                  {f.runCount > 0 && ` · ran ${f.runCount}×${f.lastRunAt ? `, last ${ago(f.lastRunAt)}` : ''}`}
                  {f.nextRun && f.enabled && ` · next ${ago(f.nextRun).startsWith('just') ? 'soon' : ago(f.nextRun)}`}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <Switch checked={f.enabled} onCheckedChange={(v) => void toggle(f, v)} aria-label={`Turn ${f.name} on or off`} />
                <Button size="sm" variant="outline" onClick={() => { setEditing({ ...f }); setErrors([]); setTestOut(null); }}>Edit</Button>
                <Button size="sm" variant="outline" className="gap-1" disabled={busyId === f.id} onClick={() => void runNow(f.id)}>
                  <Play className="h-3.5 w-3.5" /> Run
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void remove(f)} aria-label={`Delete ${f.name}`}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {s && s.runs.length > 0 && (
        <Card className="p-4">
          <div className="flex items-center gap-2 text-sm font-semibold"><History className="h-4 w-4 text-primary" /> Recent runs</div>
          <ul className="mt-2 divide-y text-xs">
            {s.runs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="font-medium">{r.flowName}</span>
                  <span className="text-muted-foreground"> · {r.trigger} · {ago(r.at)}</span>
                  {r.test && <Badge variant="outline" className="ml-1.5">test</Badge>}
                  {r.error && <span className="text-rose-600"> · {r.error}</span>}
                </span>
                <span className="text-muted-foreground">
                  {r.matched ? r.actions.join(', ') || 'no actions' : 'conditions did not match'}
                  {r.runIds.length > 0 && ` · ${r.runIds.length} run${r.runIds.length === 1 ? '' : 's'}`}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) { setEditing(null); setTestOut(null); } }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing?.id ? 'Edit workflow' : 'New workflow'}</DialogTitle>
            <DialogDescription>Trigger first, then the facts that must hold (all of them), then what happens. Goals can use {'{{fields}}'} from the event.</DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <Input value={editing.name} onChange={(e) => patch({ name: e.target.value })} placeholder="Name — e.g. Chase big overdue invoices" maxLength={80} />

              <div className="space-y-2 rounded-lg border p-3">
                <p className="text-xs font-semibold text-muted-foreground">WHEN</p>
                <div className="flex flex-wrap gap-2">
                  {(['event', 'schedule', 'cron'] as const).map((k) => (
                    <Button key={k} size="sm" variant={editing.trigger.kind === k ? 'default' : 'outline'} onClick={() => patch({
                      trigger: k === 'event' ? { kind: 'event', event: 'ticket.created' } : k === 'schedule' ? { kind: 'schedule', schedule: 'daily' } : { kind: 'cron', expr: '0 8 * * mon' },
                      conditions: k === 'event' ? editing.conditions : [],
                    })}>
                      {k === 'event' ? 'Something happens' : k === 'schedule' ? 'On a schedule' : 'Cron expression'}
                    </Button>
                  ))}
                </div>
                {editing.trigger.kind === 'event' && (
                  <Select value={editing.trigger.event} onValueChange={(v) => patch({ trigger: { kind: 'event', event: v as FlowEventId }, conditions: [] })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(s?.events ?? []).map((e) => <SelectItem key={e.id} value={e.id}>{e.label} — {e.detail}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
                {editing.trigger.kind === 'schedule' && (
                  <Select value={editing.trigger.schedule} onValueChange={(v) => patch({ trigger: { kind: 'schedule', schedule: v as 'hourly' | 'daily' | 'weekly' | 'monthly' } })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hourly">Every hour</SelectItem>
                      <SelectItem value="daily">Daily (morning)</SelectItem>
                      <SelectItem value="weekly">Weekly (Monday morning)</SelectItem>
                      <SelectItem value="monthly">Monthly (1st, morning)</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                {editing.trigger.kind === 'cron' && (
                  <div>
                    <Input value={editing.trigger.expr} onChange={(e) => patch({ trigger: { kind: 'cron', expr: e.target.value } })} placeholder="0 8 * * mon" className="font-mono" />
                    <CronHint expr={editing.trigger.expr} />
                  </div>
                )}
              </div>

              {editing.trigger.kind === 'event' && (
                <div className="space-y-2 rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-muted-foreground">AND THESE FACTS HOLD</p>
                    <Button size="sm" variant="outline" onClick={() => patch({ conditions: [...editing.conditions, { field: eventFields[0] ?? '', op: 'equals', value: '' }] })}>Add condition</Button>
                  </div>
                  {editing.conditions.length === 0 && <p className="text-xs text-muted-foreground">No conditions — fires on every {FLOW_EVENT_META[editing.trigger.event]?.label.toLowerCase()}.</p>}
                  {editing.conditions.map((c, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2">
                      <Select value={c.field} onValueChange={(v) => patch({ conditions: editing.conditions.map((x, j) => (j === i ? { ...x, field: v } : x)) })}>
                        <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                        <SelectContent>{eventFields.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
                      </Select>
                      <Select value={c.op} onValueChange={(v) => patch({ conditions: editing.conditions.map((x, j) => (j === i ? { ...x, op: v as FlowCondition['op'] } : x)) })}>
                        <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                        <SelectContent>{OPS.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}</SelectContent>
                      </Select>
                      {c.op !== 'exists' && (
                        <Input value={c.value} onChange={(e) => patch({ conditions: editing.conditions.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} placeholder="value" className="min-w-32 flex-1" />
                      )}
                      <Button size="sm" variant="ghost" onClick={() => patch({ conditions: editing.conditions.filter((_, j) => j !== i) })} aria-label="Remove condition"><X className="h-4 w-4" /></Button>
                    </div>
                  ))}
                  {eventFields.length > 0 && <p className="text-[11px] text-muted-foreground">Available facts: {eventFields.join(', ')}</p>}
                </div>
              )}

              <div className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-muted-foreground">THEN DO</p>
                  <Button size="sm" variant="outline" onClick={() => patch({ actions: [...editing.actions, { kind: 'notify', severity: 'noteworthy', title: '', body: '' }] })}>Add action</Button>
                </div>
                {editing.actions.map((a, i) => (
                  <ActionRow
                    key={i}
                    action={a}
                    agents={agents.filter((x) => x.status !== 'offline').map((x) => ({ id: x.id, name: x.name }))}
                    onChange={(next) => patch({ actions: editing.actions.map((x, j) => (j === i ? next : x)) })}
                    onRemove={() => patch({ actions: editing.actions.filter((_, j) => j !== i) })}
                  />
                ))}
              </div>

              {errors.length > 0 && (
                <ul className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-4 py-2 text-xs text-rose-600">
                  {errors.map((e) => <li key={e}>· {e}</li>)}
                </ul>
              )}
              {testOut && (
                <div className={cn('rounded-lg border px-4 py-2 text-xs', testOut.matched ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5')}>
                  <p className="font-medium">{testOut.note ?? (testOut.matched ? 'Conditions match the sample event — these actions would run:' : 'Conditions do not match the sample event — nothing would run.')}</p>
                  {testOut.preview?.map((p) => <p key={p} className="mt-0.5 text-muted-foreground">→ {p}</p>)}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button className="flex-1" onClick={save} disabled={saving || !editing.name.trim()}>{saving ? 'Saving…' : 'Save workflow'}</Button>
                <Button variant="outline" className="gap-1.5" onClick={test} disabled={testing}><FlaskConical className="h-4 w-4" /> {testing ? 'Testing…' : 'Test on sample'}</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CronHint({ expr }: { expr: string }) {
  const parsed = parseCron(expr);
  if (!parsed) return <p className="mt-1 text-[11px] text-muted-foreground">Not a valid 5-field expression yet. Minute hour day month weekday, e.g. 0 8 * * mon.</p>;
  const d = cronDensity(expr) ?? 0;
  const every = d <= 1 ? 'minute' : d < 60 ? `${d} minutes` : d < 1440 ? `${Math.round(d / 60)} hours` : `${Math.round(d / 1440)} days`;
  return (
    <p className="mt-1 text-[11px] text-muted-foreground">
      Valid — about every {every} (UTC).
      {d < 5 && ' Very frequent — the 20-runs-a-day cap still applies.'}
    </p>
  );
}

function ActionRow({ action, agents, onChange, onRemove }: {
  action: FlowAction;
  agents: Array<{ id: string; name: string }>;
  onChange: (a: FlowAction) => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-2 rounded-lg bg-muted/30 p-2.5">
      <div className="flex items-center gap-2">
        <Select value={action.kind} onValueChange={(v) => {
          if (v === 'run_agent') onChange({ kind: 'run_agent', agentId: agents[0]?.id ?? '', goal: '', priority: 2 });
          else if (v === 'notify') onChange({ kind: 'notify', severity: 'noteworthy', title: '', body: '' });
          else onChange({ kind: 'email', event: 'agent_urgent' });
        }}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="run_agent">Run an agent</SelectItem>
            <SelectItem value="notify">Post a notice</SelectItem>
            <SelectItem value="email">Send workspace email</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onRemove} aria-label="Remove action"><X className="h-4 w-4" /></Button>
      </div>
      {action.kind === 'run_agent' && (
        <div className="space-y-2">
          <Select value={action.agentId} onValueChange={(v) => onChange({ ...action, agentId: v })}>
            <SelectTrigger><SelectValue placeholder="Pick an agent" /></SelectTrigger>
            <SelectContent>{agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
          </Select>
          <Textarea rows={3} value={action.goal} onChange={(e) => onChange({ ...action, goal: e.target.value })} placeholder={'Goal — use {{fields}} from the event, e.g. "Chase {{number}}: {{client}} owes {{amount}}."'} />
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <label>Priority</label>
            <Select value={String(action.priority ?? 2)} onValueChange={(v) => onChange({ ...action, priority: Number(v) as 0 | 1 | 2 | 3 })}>
              <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
              <SelectContent>{['0', '1', '2', '3'].map((p) => <SelectItem key={p} value={p}>P{p}</SelectItem>)}</SelectContent>
            </Select>
            <label className="ml-2 flex items-center gap-1.5"><Switch checked={action.urgent === true} onCheckedChange={(v) => onChange({ ...action, urgent: v })} /> Urgent</label>
          </div>
        </div>
      )}
      {action.kind === 'notify' && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Select value={action.severity} onValueChange={(v) => onChange({ ...action, severity: v as 'info' | 'noteworthy' | 'urgent' })}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="noteworthy">Noteworthy</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
              </SelectContent>
            </Select>
            <Input value={action.title} onChange={(e) => onChange({ ...action, title: e.target.value })} placeholder="Title — {{fields}} work here too" maxLength={120} />
          </div>
          <Textarea rows={2} value={action.body} onChange={(e) => onChange({ ...action, body: e.target.value })} placeholder="Body" />
        </div>
      )}
      {action.kind === 'email' && (
        <p className="text-xs text-muted-foreground">
          Raises a workspace email event (needs Email updates on + recipients).
          <Select value={action.event} onValueChange={(v) => onChange({ kind: 'email', event: v as Extract<FlowAction, { kind: 'email' }>['event'] })}>
            <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="agent_urgent">Urgent agent alert</SelectItem>
              <SelectItem value="approval_requested">Approval needed</SelectItem>
              <SelectItem value="ticket_new">New support ticket</SelectItem>
              <SelectItem value="sla_breach">SLA breached</SelectItem>
              <SelectItem value="recurring_invoices">Recurring invoices drafted</SelectItem>
              <SelectItem value="recurring_bills">Recurring bills recorded</SelectItem>
            </SelectContent>
          </Select>
        </p>
      )}
    </div>
  );
}
