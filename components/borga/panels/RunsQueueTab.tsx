'use client';

import { effectivePriority } from '@/lib/borga/run-queue-core';
import { useState, useRef, useEffect } from 'react';
import {
  Play, Pause, RefreshCw, Clock, CheckCircle2, XCircle, Zap, ChevronDown, ChevronRight,
  Trash2, Plus, ToggleLeft, ToggleRight, Bot, AlertCircle, Terminal, Pencil, Cpu,
  ListOrdered, Ban, RotateCcw, MinusCircle,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { useBorga } from '@/lib/borga/store';
import { SectionTitle } from '../bits';
import { InboundEndpoint } from '../InboundEndpoint';
import { ScheduledTaskEditDialog } from './ScheduledTaskEditDialog';
import type { AgentRun, AgentRunStep, RunJob, ScheduledTask, ScheduleInterval } from '@/lib/borga/data';

const INTERVAL_LABEL: Record<ScheduleInterval, string> = {
  hourly: 'Every hour',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

const STEP_ICON: Record<AgentRunStep['type'], React.FC<{ className?: string }>> = {
  thought: ({ className }) => <Bot className={className} />,
  tool_call: ({ className }) => <Terminal className={className} />,
  tool_result: ({ className }) => <CheckCircle2 className={className} />,
  summary: ({ className }) => <Zap className={className} />,
};

const STEP_COLOR: Record<AgentRunStep['type'], string> = {
  thought: 'text-violet-500',
  tool_call: 'text-amber-500',
  tool_result: 'text-emerald-500',
  summary: 'text-sky-500',
};

const JOB_ICON: Record<RunJob['status'], React.FC<{ className?: string }>> = {
  queued: ({ className }) => <Clock className={className} />,
  running: ({ className }) => <RefreshCw className={className} />,
  complete: ({ className }) => <CheckCircle2 className={className} />,
  error: ({ className }) => <XCircle className={className} />,
  cancelled: ({ className }) => <MinusCircle className={className} />,
};

const JOB_COLOR: Record<RunJob['status'], string> = {
  queued: 'text-muted-foreground',
  running: 'text-sky-500',
  complete: 'text-emerald-500',
  error: 'text-rose-500',
  cancelled: 'text-muted-foreground',
};

function elapsed(iso?: string | null): string {
  if (!iso) return '';
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function RunSteps({ steps }: { steps: AgentRunStep[] }) {
  return (
    <div className="space-y-1.5 pt-2">
      {steps.map((step, i) => {
        const Icon = STEP_ICON[step.type];
        return (
          <div key={i} className="flex gap-2 text-xs">
            <Icon className={cn('mt-0.5 h-3 w-3 shrink-0', STEP_COLOR[step.type])} />
            <div className="min-w-0">
              {step.tool && (
                <span className="mr-1 rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {step.tool}
                </span>
              )}
              <span className="text-muted-foreground">{step.content.slice(0, 200)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RunCard({ run, onRerun, onDelete }: { run: AgentRun; onRerun: (run: AgentRun) => void; onDelete: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const statusIcon = run.status === 'complete'
    ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
    : run.status === 'error' || run.status === 'stopped'
    ? <XCircle className="h-3.5 w-3.5 text-rose-500" />
    : <RefreshCw className="h-3.5 w-3.5 animate-spin text-sky-500" />;

  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          {statusIcon}
          <div className="min-w-0">
            <p className="text-xs font-medium">{run.agentName}</p>
            <p className="text-[11px] text-muted-foreground">{run.goal.slice(0, 80)}{run.goal.length > 80 ? '…' : ''}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="outline" className="text-[10px]">{run.triggeredBy}</Badge>
          <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-foreground" title="Run again" onClick={() => onRerun(run)}>
            <Play className="h-3 w-3" />
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-rose-500" title="Remove from history" onClick={() => onDelete(run.id)}>
            <Trash2 className="h-3 w-3" />
          </Button>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="rounded p-0.5 hover:bg-accent"
          >
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
      {run.summary && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">{run.summary.slice(0, 150)}</p>
      )}
      {expanded && run.steps.length > 0 && <RunSteps steps={run.steps} />}
    </div>
  );
}

function StreamingRun({ events, goal, agentName }: { events: string[]; goal: string; agentName: string }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [events]);

  return (
    <div className="max-h-72 overflow-y-auto rounded-lg border bg-background/50 p-3 font-mono text-xs">
      <p className="mb-2 text-muted-foreground">
        <Bot className="mr-1 inline h-3 w-3" />
        {agentName}: <span className="text-foreground">{goal.slice(0, 60)}{goal.length > 60 ? '…' : ''}</span>
      </p>
      {events.map((e, i) => (
        <div key={i} className="mb-1 leading-relaxed text-muted-foreground">
          {e}
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}

/**
 * Heartbeat controls: kill switch + quiet hours, both durable in settings
 * (config, not code). Pausing stops all proactive firing instantly; chat,
 * voice, and manual runs keep working.
 */
function HeartbeatCard() {
  const { activeWorkspaceId } = useBorga();
  const [paused, setPaused] = useState<boolean | null>(null);
  const [quiet, setQuiet] = useState({ start: '22:00', end: '07:00' });
  const [draft, setDraft] = useState({ start: '22:00', end: '07:00' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/borga/scheduler', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
      body: JSON.stringify({ action: 'heartbeat', ws: activeWorkspaceId }),
    }).then((r) => r.json()).then((d: { paused?: boolean; quietHours?: { start: string; end: string } }) => {
      setPaused(d.paused ?? false);
      if (d.quietHours) {
        setQuiet(d.quietHours);
        setDraft(d.quietHours);
      }
    }).catch(() => setPaused(false));
  }, [activeWorkspaceId]);

  const togglePause = async () => {
    const next = !(paused ?? false);
    setPaused(next);
    await fetch('/api/borga/scheduler', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
      body: JSON.stringify({ action: 'setHeartbeat', paused: next, ws: activeWorkspaceId }),
    }).catch(() => setPaused(!next));
  };

  const saveQuiet = async () => {
    setSaving(true);
    try {
      const r = await fetch('/api/borga/scheduler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
        body: JSON.stringify({ action: 'setQuietHours', start: draft.start, end: draft.end, ws: activeWorkspaceId }),
      });
      const d = await r.json() as { ok?: boolean; quietHours?: { start: string; end: string } };
      if (d.ok && d.quietHours) setQuiet(d.quietHours);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Heartbeat</h3>
          <Badge variant="outline" className={cn('text-[10px]', paused ? 'border-rose-500/30 text-rose-600' : 'border-emerald-500/30 text-emerald-600')}>
            {paused === null ? '…' : paused ? 'Paused — kill switch on' : 'Beating — quiet by default'}
          </Badge>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Quiet {quiet.start}–{quiet.end}</span>
          <Input value={draft.start} onChange={(e) => setDraft((s) => ({ ...s, start: e.target.value }))} className="h-7 w-16 font-mono text-xs" placeholder="22:00" />
          <Input value={draft.end} onChange={(e) => setDraft((s) => ({ ...s, end: e.target.value }))} className="h-7 w-16 font-mono text-xs" placeholder="07:00" />
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={saveQuiet} disabled={saving}>Save</Button>
          <Button size="sm" variant={paused ? 'default' : 'outline'} className="h-7 gap-1 text-xs" onClick={togglePause}>
            {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
            {paused ? 'Resume' : 'Pause all'}
          </Button>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Non-urgent checks wait out quiet hours and land here as held notices. Only urgent ones surface at night. Overlaps never stack.
      </p>
    </Card>
  );
}

/** Held inbox: catch-up-on-return, every item dismissible. */
function NoticesInbox({ notices, onDismiss, onClear }: { notices: { id: string; title: string; body: string; severity: string; createdAt: string }[]; onDismiss: (id: string) => void; onClear: () => void }) {
  if (!notices.length) return null;
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">While you were away <Badge variant="secondary" className="ml-1">{notices.length}</Badge></h3>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onClear}>Dismiss all</Button>
      </div>
      <div className="max-h-56 space-y-2 overflow-y-auto">
        {notices.slice(0, 20).map((n) => (
          <div key={n.id} className="flex items-start gap-2 rounded-lg border bg-muted/20 p-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium">{n.title}</p>
              <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{n.body}</p>
            </div>
            <Button size="sm" variant="ghost" className="h-6 shrink-0 px-2 text-[11px]" onClick={() => onDismiss(n.id)}>Dismiss</Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

interface WorkerState { id: string; busyJobId: string | null; busyGoal: string | null; startedAt: string | null }
interface QueueSnapshot { jobs: RunJob[]; workers: WorkerState[]; configured: number }

/** Edit a queued run before a worker claims it — goal, agent, urgency, step budget. */
function QueuedJobEditDialog({ job, agents, ws, open, onOpenChange }: {
  job: RunJob | null;
  agents: { id: string; name: string }[];
  ws: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [goal, setGoal] = useState('');
  const [agentId, setAgentId] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [maxSteps, setMaxSteps] = useState('8');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (job && open) {
      setGoal(job.goal);
      setAgentId(job.agentId);
      setUrgent(job.urgent === true);
      setMaxSteps(String(job.maxSteps ?? 8));
      setError(null);
    }
  }, [job, open]);

  const save = async () => {
    if (!job || !goal.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch('/api/borga/agent/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
        body: JSON.stringify({
          action: 'update', id: job.id, ws,
          goal: goal.trim(), agentId,
          agentName: agents.find((a) => a.id === agentId)?.name ?? job.agentName,
          urgent, maxSteps: Math.max(1, Math.min(8, Number(maxSteps) || 8)),
        }),
      });
      const d = await r.json() as { ok?: boolean; error?: string };
      if (d.ok) {
        onOpenChange(false);
      } else {
        setError(d.error ?? 'Update failed');
      }
    } catch {
      setError('Update failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" key={job?.id ?? 'none'}>
        {job && (
          <>
            <DialogHeader>
              <DialogTitle>Edit queued run</DialogTitle>
              <DialogDescription>Change the goal, agent, urgency or step budget before a worker picks it up.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <Textarea rows={3} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Goal — what should the agent do?" />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Agent</label>
                  <Select value={agentId} onValueChange={setAgentId}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Max steps (1–8)</label>
                  <Select value={maxSteps} onValueChange={setMaxSteps}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                        <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">Urgent</p>
                  <p className="text-[11px] text-muted-foreground">Jumps near the front of the queue.</p>
                </div>
                <Switch checked={urgent} onCheckedChange={setUrgent} />
              </div>
              {error && <p className="text-xs text-rose-600">{error}</p>}
              <Button className="w-full" onClick={save} disabled={saving || !goal.trim()}>
                {saving ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The live queue: what is waiting, which worker is busy, live progress of
 * running jobs — polled from /api/borga/agent/queue. Jobs that finish and
 * belong to a scheduled task sync its stats back into the store.
 */
function QueueCard() {
  const { activeWorkspaceId, scheduledTasks, updateScheduledTask, log, agents } = useBorga();
  const [snap, setSnap] = useState<QueueSnapshot | null>(null);
  const [, setClock] = useState(0);
  const finishedSchedTasksRef = useRef<Set<string>>(new Set());
  const [editJob, setEditJob] = useState<RunJob | null>(null);

  useEffect(() => {
    const tickClock = setInterval(() => setClock((c) => c + 1), 1000);
    return () => clearInterval(tickClock);
  }, []);

  useEffect(() => {
    let stop = false;
    const poll = async () => {
      try {
        const r = await fetch(`/api/borga/agent/queue?ws=${encodeURIComponent(activeWorkspaceId)}`, {
          headers: { 'X-Borga-Client': 'borga-dashboard' },
        });
        const d = await r.json() as QueueSnapshot & { ok: boolean };
        if (!stop && d.ok) {
          setSnap({ jobs: d.jobs, workers: d.workers, configured: d.configured });

          // A scheduled job just landed → refresh its task row (runCount, lastResult…).
          const finished = d.jobs.filter((j) => j.schedTaskId && (j.status === 'complete' || j.status === 'error' || j.status === 'cancelled') && !finishedSchedTasksRef.current.has(j.id));
          for (const j of finished) finishedSchedTasksRef.current.add(j.id);
          if (finished.length) {
            const tr = await fetch(`/api/borga/scheduler?ws=${encodeURIComponent(activeWorkspaceId)}`);
            const td = await tr.json() as { ok: boolean; tasks?: ScheduledTask[] };
            if (td.ok && td.tasks) {
              for (const t of td.tasks) {
                const local = scheduledTasks.find((x) => x.id === t.id);
                if (local && (local.runCount !== t.runCount || local.lastResult !== t.lastResult || local.lastRun !== t.lastRun)) {
                  updateScheduledTask(t.id, { runCount: t.runCount, lastResult: t.lastResult, lastRun: t.lastRun, runningSince: t.runningSince, nextRun: t.nextRun });
                }
              }
            }
          }
        }
      } catch {
        // Best-effort poll
      }
    };
    void poll();
    const interval = setInterval(poll, 2000);
    return () => { stop = true; clearInterval(interval); };
  }, [activeWorkspaceId, scheduledTasks, updateScheduledTask]);

  const act = async (action: string, id?: string, extra?: Record<string, unknown>) => {
    try {
      await fetch('/api/borga/agent/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
        body: JSON.stringify({ action, id, ws: activeWorkspaceId, ...extra }),
      });
      // Refresh immediately so edits/cancels land without waiting for the poll.
      try {
        const r = await fetch(`/api/borga/agent/queue?ws=${encodeURIComponent(activeWorkspaceId)}`, {
          headers: { 'X-Borga-Client': 'borga-dashboard' },
        });
        const d = await r.json() as QueueSnapshot & { ok: boolean };
        if (d.ok) setSnap({ jobs: d.jobs, workers: d.workers, configured: d.configured });
      } catch {
        // Poll will catch up
      }
    } catch {
      // Best-effort
    }
  };

  const setWorkers = async (n: string) => {
    await act('setWorkers', undefined, { count: Number(n) });
    log({ agentId: 'a-borga', agentName: 'Borga', actor: 'user', kind: 'system', message: `Run queue set to ${n} worker(s).` });
  };

  if (!snap) {
    return (
      <Card className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <RefreshCw className="h-4 w-4 animate-spin" /> Loading the run queue…
      </Card>
    );
  }

  const running = snap.jobs.filter((j) => j.status === 'running');
  const queued = snap.jobs.filter((j) => j.status === 'queued');
  const failed = snap.jobs.filter((j) => j.status === 'error');
  const terminal = snap.jobs.filter((j) => j.status === 'complete' || j.status === 'cancelled').slice(0, 5);

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ListOrdered className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Run Queue</h3>
          <Badge variant="secondary">{queued.length} queued</Badge>
          {running.length > 0 && <Badge className="border-sky-500/30 text-[10px] text-sky-600">{running.length} running</Badge>}
          {failed.length > 0 && <Badge className="border-rose-500/30 text-[10px] text-rose-600">{failed.length} failed</Badge>}
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Workers</span>
          <div className="w-20">
            <Select value={String(snap.configured)} onValueChange={setWorkers}>
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Worker strip */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {snap.workers.map((w) => (
          <span
            key={w.id}
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]',
              w.busyJobId ? 'border-sky-500/30 bg-sky-500/5 text-sky-600' : 'text-muted-foreground',
            )}
            title={w.busyGoal ? `Running: ${w.busyGoal.slice(0, 120)}` : 'Idle'}
          >
            <Cpu className="h-3 w-3" />
            <span className="font-mono">{w.id}</span>
            {w.busyJobId
              ? <span className="max-w-[220px] truncate">{w.busyGoal} · {elapsed(w.startedAt)}</span>
              : 'idle'}
          </span>
        ))}
        {snap.workers.length === 0 && (
          <span className="text-[11px] text-muted-foreground">Workers start with the next queued job.</span>
        )}
      </div>

      {/* Running */}
      {running.map((job) => {
        const Icon = JOB_ICON.running;
        const lastStep = job.steps?.[job.steps.length - 1];
        return (
          <div key={job.id} className="mb-2 rounded-lg border border-sky-500/20 bg-sky-500/5 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2 text-xs">
                <Icon className="h-3.5 w-3.5 shrink-0 animate-spin text-sky-500" />
                <span className="font-medium">{job.agentName}</span>
                <span className="truncate text-muted-foreground">{job.goal.slice(0, 80)}{job.goal.length > 80 ? '…' : ''}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="font-mono text-[10px] text-muted-foreground">{job.workerId} · {elapsed(job.startedAt)}</span>
                <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-[11px]" onClick={() => act('cancel', job.id)}>
                  <Ban className="h-3 w-3" /> Stop
                </Button>
              </div>
            </div>
            {lastStep && (
              <p className="mt-1 truncate text-[11px] text-muted-foreground">
                {lastStep.tool ? `${lastStep.tool} — ` : ''}{lastStep.content.slice(0, 120)}
              </p>
            )}
          </div>
        );
      })}

      {/* Queued */}
      {queued.map((job, i) => {
        const Icon = JOB_ICON.queued;
        return (
          <div key={job.id} className="mb-1.5 flex items-center justify-between gap-2 rounded-lg border p-2.5">
            <div className="flex min-w-0 items-center gap-2 text-xs">
              <Icon className={cn('h-3.5 w-3.5 shrink-0', JOB_COLOR.queued)} />
              <Badge variant="outline" className="shrink-0 text-[10px]">#{i + 1}</Badge>
              <span className="font-medium">{job.agentName}</span>
              <span className="truncate text-muted-foreground">{job.goal.slice(0, 70)}{job.goal.length > 70 ? '…' : ''}</span>
              {job.urgent && <Badge variant="outline" className="shrink-0 border-rose-500/30 text-[10px] text-rose-600">urgent</Badge>}
              {job.plannedSteps?.length ? <Badge variant="outline" className="shrink-0 text-[10px]">plan · {job.plannedSteps.length} steps</Badge> : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge variant="secondary" className="text-[10px]">{job.triggeredBy}</Badge>
              {job.status === 'queued' && <Badge variant="outline" className="text-[10px]" title="Priority: the queue starts P0 first">P{effectivePriority(job)}</Badge>}
              {job.maxSteps ? <Badge variant="outline" className="text-[10px]">{job.maxSteps} steps</Badge> : null}
              <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setEditJob(job)} title="Edit queued run">
                <Pencil className="h-3 w-3" />
              </Button>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px] text-muted-foreground hover:text-rose-500" onClick={() => act('cancel', job.id)}>
                Cancel
              </Button>
            </div>
          </div>
        );
      })}

      {/* Failed */}
      {failed.slice(0, 5).map((job) => {
        const Icon = JOB_ICON.error;
        return (
          <div key={job.id} className="mb-1.5 flex items-center justify-between gap-2 rounded-lg border border-rose-500/20 bg-rose-500/5 p-2.5">
            <div className="flex min-w-0 items-center gap-2 text-xs">
              <Icon className={cn('h-3.5 w-3.5 shrink-0', JOB_COLOR.error)} />
              <span className="font-medium">{job.agentName}</span>
              <span className="truncate text-muted-foreground" title={job.error ?? ''}>{(job.error ?? 'Failed').slice(0, 90)}</span>
            </div>
            <Button size="sm" variant="outline" className="h-6 shrink-0 gap-1 px-2 text-[11px]" onClick={() => act('retry', job.id)}>
              <RotateCcw className="h-3 w-3" /> Retry
            </Button>
          </div>
        );
      })}

      {/* Recently finished */}
      {terminal.map((job) => {
        const Icon = JOB_ICON[job.status];
        return (
          <div key={job.id} className="mb-1.5 flex items-center justify-between gap-2 rounded-lg border p-2 text-[11px] text-muted-foreground">
            <div className="flex min-w-0 items-center gap-2">
              <Icon className={cn('h-3 w-3 shrink-0', JOB_COLOR[job.status])} />
              <span className="truncate">{job.agentName}: {job.goal.slice(0, 70)}{job.goal.length > 70 ? '…' : ''}</span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span>{elapsed(job.completedAt)} ago</span>
              <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-[11px]" onClick={() => act('rerun', job.id)} title="Enqueue again">
                <Play className="h-3 w-3" /> Again
              </Button>
            </div>
          </div>
        );
      })}

      {snap.jobs.length === 0 && (
        <p className="rounded-lg border border-dashed p-3 text-center text-[11px] text-muted-foreground">
          The queue is empty. Run an agent, trigger a scheduled task, or send an inbound event — every run lands here.
        </p>
      )}
      <QueuedJobEditDialog
        job={editJob}
        agents={agents}
        ws={activeWorkspaceId}
        open={!!editJob}
        onOpenChange={(o) => { if (!o) setEditJob(null); }}
      />
    </Card>
  );
}

export function RunsQueueTab() {
  const {
    agents, scheduledTasks, addScheduledTask, updateScheduledTask, deleteScheduledTask,
    toggleScheduledTask, agentRuns, addAgentRun, deleteAgentRun, log, activeWorkspaceId,
    activeWorkspace, llm, llmCatalog, notices, dismissNotice, clearNotices,
  } = useBorga();

  // Run form — every field is editable: agent, goal, step budget, urgency.
  const [selectedAgentId, setSelectedAgentId] = useState('a-borga');
  const [goal, setGoal] = useState('');
  const [maxSteps, setMaxSteps] = useState('8');
  const [urgent, setUrgent] = useState(false);
  const [running, setRunning] = useState(false);
  const [streamEvents, setStreamEvents] = useState<string[]>([]);
  const [lastRunAgent, setLastRunAgent] = useState('Borga');

  // Scheduled task editing
  const [editTask, setEditTask] = useState<ScheduledTask | null>(null);

  // New scheduled task form
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAgentId, setNewAgentId] = useState('a-borga');
  const [newGoal, setNewGoal] = useState('');
  const [newInterval, setNewInterval] = useState<ScheduleInterval>('daily');
  const [creating, setCreating] = useState(false);

  // Scheduler tick on mount + every 60s
  const lastTickRef = useRef(0);
  useEffect(() => {
    const tick = async () => {
      const now = Date.now();
      if (now - lastTickRef.current < 55000) return;
      lastTickRef.current = now;
      try {
        const r = await fetch('/api/borga/scheduler', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
          body: JSON.stringify({ action: 'tick', ws: activeWorkspaceId }),
        });
        const d = await r.json() as { triggered?: string[] };
        if (d.triggered && d.triggered.length > 0) {
          log({ agentId: 'a-borga', agentName: 'Borga', actor: 'system', kind: 'system', message: `Scheduler queued ${d.triggered.length} task(s) on the run queue.` });
        }
      } catch {
        // Tick is best-effort
      }
    };
    tick();
    const interval = setInterval(tick, 60000);
    return () => clearInterval(interval);
  }, [log, activeWorkspaceId]);

  async function runAgent() {
    if (!goal.trim() || running) return;
    setRunning(true);
    setStreamEvents([]);
    const agent = agents.find((a) => a.id === selectedAgentId);
    setLastRunAgent(agent?.name ?? 'Agent');

    try {
      const res = await fetch('/api/borga/agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
        body: JSON.stringify({
          agentId: selectedAgentId, goal: goal.trim(), stream: true,
          ws: activeWorkspaceId, companyName: activeWorkspace()?.name,
          maxSteps: Math.max(1, Math.min(8, Number(maxSteps) || 8)),
          urgent,
        }),
      });
      if (!res.ok || !res.body) {
        setStreamEvents(['Connection failed. Check server logs.']);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const collectedSteps: AgentRunStep[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith(': ')) continue; // SSE keepalive comment
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6)) as Record<string, unknown>;
            const type = evt.type as string;

            if (type === 'thought') {
              setStreamEvents((p) => [...p, `Thought: ${String(evt.content ?? '').slice(0, 120)}`]);
              collectedSteps.push({ type: 'thought', content: String(evt.content ?? ''), at: new Date().toISOString() });
            } else if (type === 'tool_call') {
              setStreamEvents((p) => [...p, `Tool ${String(evt.tool)}: ${JSON.stringify(evt.params ?? {}).slice(0, 80)}`]);
              collectedSteps.push({ type: 'tool_call', content: `Calling ${evt.tool}`, tool: String(evt.tool), params: evt.params as Record<string, unknown>, at: new Date().toISOString() });
            } else if (type === 'tool_result') {
              const ok = evt.ok as boolean;
              setStreamEvents((p) => [...p, `${ok ? 'OK' : 'FAIL'} ${String(evt.tool)} -> ${JSON.stringify(evt.data ?? '').slice(0, 100)}`]);
              collectedSteps.push({ type: 'tool_result', content: String(evt.data ?? ''), tool: String(evt.tool), result: evt.data, at: new Date().toISOString() });
            } else if (type === 'summary') {
              setStreamEvents((p) => [...p, `Summary: ${String(evt.content ?? '').slice(0, 200)}`]);
              collectedSteps.push({ type: 'summary', content: String(evt.content ?? ''), at: new Date().toISOString() });
            } else if (type === 'complete') {
              const status: AgentRun['status'] = evt.status === 'cancelled' ? 'stopped' : 'complete';
              setStreamEvents((p) => [...p, status === 'stopped' ? 'Stopped.' : `Done — ${evt.steps ?? 0} step(s) completed`]);
              const newRun: AgentRun = {
                id: String(evt.runId ?? `run-${Date.now()}`),
                agentId: selectedAgentId,
                agentName: agent?.name ?? 'Agent',
                goal: goal.trim(),
                status,
                steps: collectedSteps,
                startedAt: new Date().toISOString(),
                completedAt: new Date().toISOString(),
                summary: String(evt.summary ?? ''),
                triggeredBy: 'user',
              };
              addAgentRun(newRun);
            } else if (type === 'error') {
              setStreamEvents((p) => [...p, `Error: ${String(evt.error ?? '')}`]);
            }
          } catch {
            // Malformed SSE line
          }
        }
      }
    } finally {
      setRunning(false);
    }
  }

  async function enqueueFromHistory(run: AgentRun) {
    try {
      const r = await fetch('/api/borga/agent/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
        body: JSON.stringify({ action: 'enqueue', agentId: run.agentId, goal: run.goal, ws: activeWorkspaceId }),
      });
      const d = await r.json() as { ok?: boolean };
      if (d.ok) log({ agentId: run.agentId, agentName: run.agentName, actor: 'user', kind: 'system', message: `Re-queued run: "${run.goal.slice(0, 80)}"` });
    } catch {
      // Best-effort
    }
  }

  async function triggerScheduled(id: string) {
    const t = scheduledTasks.find((x) => x.id === id);
    if (!t) return;
    log({ agentId: t.agentId, agentName: t.agentId, actor: 'user', kind: 'task', message: `Manually triggered scheduled task: "${t.name}"` });
    try {
      const r = await fetch('/api/borga/scheduler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
        body: JSON.stringify({ action: 'trigger', id, ws: activeWorkspaceId }),
      });
      const d = await r.json() as { ok?: boolean; jobId?: string; error?: string };
      if (d.ok) {
        updateScheduledTask(id, { lastRun: new Date().toISOString(), lastResult: 'Queued — a worker will pick it up.', runningSince: new Date().toISOString() });
      } else if (d.error) {
        log({ agentId: t.agentId, agentName: t.agentId, actor: 'user', kind: 'task', message: `Trigger refused: ${d.error}` });
      }
    } catch {
      // Best-effort
    }
  }

  async function createScheduledTask() {
    if (!newName.trim() || !newGoal.trim() || creating) return;
    setCreating(true);
    try {
      const r = await fetch('/api/borga/scheduler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
        body: JSON.stringify({ action: 'create', name: newName, agentId: newAgentId, goal: newGoal, interval: newInterval, ws: activeWorkspaceId }),
      });
      const d = await r.json() as { ok?: boolean; task?: ScheduledTask };
      if (d.ok && d.task) {
        addScheduledTask(d.task);
        setNewName(''); setNewGoal(''); setNewInterval('daily');
        setShowCreate(false);
      }
    } finally {
      setCreating(false);
    }
  }

  async function deleteTask(id: string) {
    deleteScheduledTask(id);
    fetch('/api/borga/scheduler', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
      body: JSON.stringify({ action: 'delete', id, ws: activeWorkspaceId }),
    }).catch(() => null);
  }

  const agentOptions = agents;

  // Real readout of what will actually power the run — mirrors the exact
  // resolution order the server uses (per-agent model override, else the
  // global selection), so there's no surprise between what's shown and what runs.
  const selectedAgent = agents.find((a) => a.id === selectedAgentId);
  const effectiveModelId = selectedAgent?.model || llm.model;
  const effectiveProvider = (llmCatalog ?? []).find((p) => p.models.some((m) => m.id === effectiveModelId));
  const effectiveModelLabel = effectiveProvider?.models.find((m) => m.id === effectiveModelId)?.label ?? effectiveModelId;
  const isDemoModel = effectiveModelId === 'demo';

  return (
    <div className="space-y-8">
      <SectionTitle
        title="Runs & Queue"
        sub="Every run — manual, scheduled, webhook or plan — goes through one worker queue you can watch, edit and stop."
      />

      <HeartbeatCard />
      <NoticesInbox notices={notices} onDismiss={dismissNotice} onClear={clearNotices} />

      {/* Manual Run */}
      <Card className="p-5">
        <div className="mb-4 flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <h3 className="font-semibold">Run an Agent</h3>
        </div>
        <div className="space-y-3">
          <div className="flex gap-3">
            <div className="w-48 shrink-0">
              <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Agent" />
                </SelectTrigger>
                <SelectContent>
                  {agentOptions.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Textarea
              placeholder="Enter a goal — the agent will plan, reason, and take real actions to complete it…"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              className="min-h-[72px] flex-1 resize-none text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runAgent();
              }}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>Steps</span>
              <div className="w-16">
                <Select value={maxSteps} onValueChange={setMaxSteps}>
                  <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                      <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground" title="Urgent runs jump near the front of the queue">
              <Switch checked={urgent} onCheckedChange={setUrgent} className="scale-75" />
              Urgent
            </label>
            {urgent && <Badge variant="outline" className="border-rose-500/30 text-[10px] text-rose-600">urgent</Badge>}
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Queued on the run queue, streamed live. Agent reads your KB, tasks, leads, and memories — then executes real actions. Ctrl+Enter to run.
            </p>
            <Badge
              variant="outline"
              className={cn('shrink-0 gap-1 font-mono text-[10px]', isDemoModel && 'border-amber-500/30 text-amber-600')}
              title={isDemoModel ? 'No LLM connected — runs on the deterministic structured planner instead of a model' : `Runs on ${effectiveProvider?.label ?? effectiveProvider?.id ?? effectiveModelId}`}
            >
              <Bot className="h-3 w-3" /> {isDemoModel ? 'No model — structured planner' : effectiveModelLabel}
            </Badge>
            <Button size="sm" onClick={runAgent} disabled={running || !goal.trim()} className="gap-1.5">
              {running ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              {running ? 'Running…' : 'Run Agent'}
            </Button>
          </div>
        </div>
        {(running || streamEvents.length > 0) && (
          <div className="mt-4">
            <StreamingRun events={streamEvents} goal={goal} agentName={lastRunAgent} />
          </div>
        )}
      </Card>

      {/* Live queue */}
      <QueueCard />

      {/* Scheduled Tasks */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">Scheduled Tasks</h3>
            <Badge variant="secondary">{scheduledTasks.filter((t) => t.enabled).length} active</Badge>
          </div>
          <Button size="sm" variant="outline" onClick={() => setShowCreate((v) => !v)} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> New
          </Button>
        </div>

        {showCreate && (
          <Card className="mb-3 p-4">
            <div className="space-y-3">
              <div className="flex gap-3">
                <Input
                  placeholder="Task name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="h-8 flex-1 text-sm"
                />
                <div className="w-36 shrink-0">
                  <Select value={newAgentId} onValueChange={setNewAgentId}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="Agent" />
                    </SelectTrigger>
                    <SelectContent>
                      {agentOptions.map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-28 shrink-0">
                  <Select value={newInterval} onValueChange={(v) => setNewInterval(v as ScheduleInterval)}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.entries(INTERVAL_LABEL) as [ScheduleInterval, string][]).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Textarea
                placeholder="Goal — what should the agent do when this task fires?"
                value={newGoal}
                onChange={(e) => setNewGoal(e.target.value)}
                className="min-h-[60px] resize-none text-sm"
              />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
                <Button size="sm" onClick={createScheduledTask} disabled={creating || !newName.trim() || !newGoal.trim()}>
                  {creating ? <RefreshCw className="mr-1.5 h-3 w-3 animate-spin" /> : null}
                  Save Task
                </Button>
              </div>
            </div>
          </Card>
        )}

        <div className="space-y-2">
          {scheduledTasks.map((task) => {
            const agent = agents.find((a) => a.id === task.agentId);
            const busy = !!task.runningSince && Date.now() - new Date(task.runningSince).getTime() < 15 * 60 * 1000;
            return (
              <div key={task.id} className="flex items-start gap-3 rounded-lg border bg-card p-3">
                <button
                  onClick={() => toggleScheduledTask(task.id)}
                  className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
                  title={task.enabled ? 'Disable' : 'Enable'}
                >
                  {task.enabled
                    ? <ToggleRight className="h-5 w-5 text-emerald-500" />
                    : <ToggleLeft className="h-5 w-5" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{task.name}</p>
                    <Badge variant="outline" className="text-[10px]">{INTERVAL_LABEL[task.interval]}</Badge>
                    {task.urgent && <Badge variant="outline" className="border-rose-500/30 text-[10px] text-rose-600">urgent</Badge>}
                    {agent && (
                      <span className="text-[10px] text-muted-foreground">→ {agent.name}</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{task.goal.slice(0, 100)}{task.goal.length > 100 ? '…' : ''}</p>
                  <div className="mt-1 flex items-center gap-3 text-[10px] text-muted-foreground">
                    {task.lastRun && <span>Last run: {new Date(task.lastRun).toLocaleString()}</span>}
                    {task.runCount > 0 && <span>{task.runCount} run{task.runCount !== 1 ? 's' : ''}</span>}
                    {task.lastResult && <span className="truncate max-w-[240px]">{busy ? <RefreshCw className="mr-1 inline h-3 w-3 animate-spin" /> : null}{task.lastResult}</span>}
                    {task.nextRun && task.enabled && <span>Next: {new Date(task.nextRun).toLocaleString()}</span>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => setEditTask(task)}
                    title="Edit"
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => triggerScheduled(task.id)}
                    title="Trigger now"
                  >
                    <Play className="h-3 w-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs text-muted-foreground hover:text-rose-500"
                    onClick={() => deleteTask(task.id)}
                    title="Delete"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            );
          })}
          {scheduledTasks.length === 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              <AlertCircle className="h-4 w-4" />
              No scheduled tasks yet. Click New to create one.
            </div>
          )}
        </div>
      </div>

      {/* Recent Runs */}
      {agentRuns.length > 0 && (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">Recent Runs</h3>
            <Badge variant="secondary">{agentRuns.length}</Badge>
          </div>
          <div className="space-y-2">
            {agentRuns.slice(0, 15).map((run) => (
              <RunCard key={run.id} run={run} onRerun={enqueueFromHistory} onDelete={deleteAgentRun} />
            ))}
          </div>
        </div>
      )}

      {/* Inbound Webhooks */}
      <Card className="p-4">
        <div className="mb-2 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Inbound Webhook Endpoint</h3>
        </div>
        <p className="mb-2 text-xs text-muted-foreground">
          External services can trigger agents by POSTing to this endpoint. The agent is selected automatically based on the event type — events enqueue like every other run.
        </p>
        <InboundEndpoint />
        <p className="mt-2 text-xs text-muted-foreground">
          Supported sources: github, stripe, hubspot, booking events. Add a secret for HMAC-SHA256 signature verification.
        </p>
      </Card>

      <ScheduledTaskEditDialog
        task={editTask}
        agents={agents}
        open={!!editTask}
        onOpenChange={(o) => { if (!o) setEditTask(null); }}
        onSaved={(t) => updateScheduledTask(t.id, t)}
      />
    </div>
  );
}
