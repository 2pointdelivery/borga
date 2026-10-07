'use client';

import { useState } from 'react';
import {
  Plus, Trash2, GripVertical, CalendarDays, LayoutGrid, CalendarRange, Pencil,
  ListChecks, ArrowUp, ArrowDown, Play, Wand2, ExternalLink,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBorga } from '@/lib/borga/store';
import { sortTasks } from '@/lib/borga/store';
import { PRIORITY_LABEL, PRIORITY_COLOR, type Bucket, type Priority, type Task } from '@/lib/borga/data';
import { planFromGoal } from '@/lib/borga/plan-from-goal';
import { TOOL_NAMES } from '@/lib/borga/tool-names';
import { toast } from '@/lib/toast-bus';
import { AgentAvatar, SectionTitle } from '../bits';
import { TaskEditDialog } from './TaskEditDialog';
import { cn } from '@/lib/utils';

const BUCKETS: { id: Bucket; label: string; icon: string }[] = [
  { id: 'today', label: 'Today', icon: '☀️' },
  { id: 'week', label: 'This week', icon: '📅' },
  { id: 'month', label: 'This month', icon: '🌙' },
];

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Default due label per bucket, so a task is schedulable the moment it is created
// (the old dialog wrote "…" — tasks that never appeared in the calendar view).
const BUCKET_DUE: Record<Bucket, string> = {
  today: 'Today',
  week: 'This week',
  month: 'This month',
};

// Map a task's due string to a weekday column (Mon..Sun), or null when unscheduled.
// Bucket fallbacks ("this week", "this month") land on today's column so every
// task is visible on the calendar instead of vanishing.
function dueDay(due: string): string | null {
  const lower = due.toLowerCase();
  const todayCol = WEEK[(new Date().getDay() + 6) % 7];
  if (lower.includes('today')) return todayCol;
  const hit = WEEK.find((d) => lower.startsWith(d.toLowerCase()) || lower.includes(` ${d.toLowerCase()}`));
  if (hit) return hit;
  if (lower.includes('this week') || lower.includes('this month')) return todayCol;
  return null;
}

interface PlanDraftStep {
  thought: string;
  toolName: string;
  paramsJson: string;
}

/** Plan a goal: preview the structured plan, edit every step, then enqueue it — as a normal agentic run or executed exactly as edited. */
function PlanBuilder() {
  const { agents, activeWorkspaceId, activeWorkspace, log } = useBorga();
  const [goal, setGoal] = useState('');
  const [agentId, setAgentId] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [steps, setSteps] = useState<PlanDraftStep[] | null>(null);
  const [busy, setBusy] = useState<'goal' | 'plan' | null>(null);
  const effectiveAgentId = agentId || agents[0]?.id || 'a-borga';

  const preview = () => {
    if (!goal.trim()) return;
    setSteps(planFromGoal(goal).map((s) => ({ thought: s.thought, toolName: s.toolName, paramsJson: JSON.stringify(s.params, null, 2) })));
  };

  const patch = (i: number, p: Partial<PlanDraftStep>) => {
    setSteps((cur) => (cur ? cur.map((s, idx) => (idx === i ? { ...s, ...p } : s)) : cur));
  };
  const removeStep = (i: number) => setSteps((cur) => (cur ? cur.filter((_, idx) => idx !== i) : cur));
  const move = (i: number, dir: -1 | 1) => {
    setSteps((cur) => {
      if (!cur) return cur;
      const j = i + dir;
      if (j < 0 || j >= cur.length) return cur;
      const next = [...cur];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };
  const addStep = () => setSteps((cur) => [...(cur ?? []), { thought: '', toolName: 'log_activity', paramsJson: '{\n  "message": ""\n}' }]);

  /** Parse + sanity-check the edited steps; returns null (with a toast) when invalid. */
  const buildPlannedSteps = (): { thought: string; toolName: string; params: Record<string, unknown> }[] | null => {
    if (!steps) return null;
    const out: { thought: string; toolName: string; params: Record<string, unknown> }[] = [];
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (!s.thought.trim()) {
        toast({ title: `Step ${i + 1} needs a thought.`, variant: 'error' });
        return null;
      }
      if (!TOOL_NAMES.includes(s.toolName)) {
        toast({ title: `Step ${i + 1}: unknown tool "${s.toolName}".`, variant: 'error' });
        return null;
      }
      try {
        const params = JSON.parse(s.paramsJson || '{}');
        if (typeof params !== 'object' || Array.isArray(params) || params === null) throw new Error('not an object');
        out.push({ thought: s.thought.trim(), toolName: s.toolName, params });
      } catch {
        toast({ title: `Step ${i + 1}: params must be a JSON object.`, variant: 'error' });
        return null;
      }
    }
    return out;
  };

  const enqueue = async (mode: 'goal' | 'plan') => {
    if (!goal.trim() || busy) return;
    const plannedSteps = mode === 'plan' ? buildPlannedSteps() : undefined;
    if (mode === 'plan' && !plannedSteps) return;
    setBusy(mode);
    try {
      const r = await fetch('/api/borga/agent/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
        body: JSON.stringify({
          action: 'enqueue',
          agentId: effectiveAgentId,
          goal: goal.trim(),
          ws: activeWorkspaceId,
          companyName: activeWorkspace()?.name,
          plannedSteps,
          urgent,
        }),
      });
      const d = await r.json() as { ok?: boolean; error?: string };
      if (d.ok) {
        log({ agentId: effectiveAgentId, agentName: agents.find((a) => a.id === effectiveAgentId)?.name ?? effectiveAgentId, actor: 'user', kind: 'system', message: mode === 'plan' ? `Queued a ${plannedSteps?.length}-step plan for: "${goal.slice(0, 80)}"` : `Queued goal run: "${goal.slice(0, 80)}"` });
        toast({ title: mode === 'plan' ? 'Plan queued' : 'Goal queued', description: 'A worker will pick it up.', variant: 'success' });
      } else {
        toast({ title: d.error ?? 'Could not queue the run', variant: 'error' });
      }
    } finally {
      setBusy(null);
    }
  };

  const viewQueue = () => window.dispatchEvent(new CustomEvent('borga:nav', { detail: { page: 'ai', tab: 'runs' } }));

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Wand2 className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Plan a goal</h3>
        </div>
        <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs text-muted-foreground" onClick={viewQueue}>
          View queue <ExternalLink className="h-3 w-3" />
        </Button>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Preview the structured plan for a goal, edit every step (tool, params, order), then run it — either as a normal agentic run, or executed exactly as edited.
      </p>
      <div className="space-y-3">
        <div className="flex gap-3">
          <div className="w-48 shrink-0">
            <Select value={effectiveAgentId} onValueChange={setAgentId}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Agent" /></SelectTrigger>
              <SelectContent>
                {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Textarea
            placeholder="Describe the goal — e.g. Review the lead pipeline and flag stale deals…"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            className="min-h-[64px] flex-1 resize-none text-sm"
          />
        </div>
        <label className="flex w-fit cursor-pointer items-center gap-1.5 text-xs text-muted-foreground" title="Urgent runs jump near the front of the queue">
          <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} className="h-3.5 w-3.5 accent-current" />
          Urgent — run near the front of the queue
        </label>
        {!steps && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={preview} disabled={!goal.trim()}>
            <ListChecks className="h-3.5 w-3.5" /> Preview plan
          </Button>
        )}
        {steps && (
          <>
            <div className="space-y-2">
              {steps.map((s, i) => (
                <div key={i} className="rounded-lg border p-2.5">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                      <GripVertical className="h-3.5 w-3.5" /> Step {i + 1}
                    </span>
                    <div className="flex items-center gap-0.5">
                      <Button size="icon" variant="ghost" className="h-6 w-6" title="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-3 w-3" /></Button>
                      <Button size="icon" variant="ghost" className="h-6 w-6" title="Move down" disabled={i === steps.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-3 w-3" /></Button>
                      <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-rose-500" title="Remove step" onClick={() => removeStep(i)}><Trash2 className="h-3 w-3" /></Button>
                    </div>
                  </div>
                  <div className="grid gap-2 md:grid-cols-[1fr_200px]">
                    <Input
                      value={s.thought}
                      onChange={(e) => patch(i, { thought: e.target.value })}
                      placeholder="What this step does"
                      className="h-8 text-xs"
                    />
                    <Select value={s.toolName} onValueChange={(v) => patch(i, { toolName: v })}>
                      <SelectTrigger className="h-8 font-mono text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent className="max-h-72">
                        {TOOL_NAMES.map((t) => <SelectItem key={t} value={t} className="font-mono text-xs">{t}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <Textarea
                    value={s.paramsJson}
                    onChange={(e) => patch(i, { paramsJson: e.target.value })}
                    className="mt-2 min-h-[56px] font-mono text-[11px]"
                    placeholder="Tool params (JSON)"
                  />
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button size="sm" variant="ghost" className="gap-1 text-xs text-muted-foreground" onClick={addStep}>
                <Plus className="h-3.5 w-3.5" /> Add step
              </Button>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="ghost" onClick={preview} disabled={!goal.trim()} title="Regenerate from the goal — discards edits">
                  Regenerate
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => enqueue('goal')} disabled={!!busy || !goal.trim()}>
                  <Play className="h-3.5 w-3.5" /> {busy === 'goal' ? 'Queuing…' : 'Run goal'}
                </Button>
                <Button size="sm" className="gap-1.5" onClick={() => enqueue('plan')} disabled={!!busy || !goal.trim() || steps.length === 0}>
                  <ListChecks className="h-3.5 w-3.5" /> {busy === 'plan' ? 'Queuing…' : 'Execute plan as-is'}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

export function PlannerTab() {
  const { tasks, addTask, updateTask, deleteTask, moveTaskBucket, agents, log } = useBorga();
  const [open, setOpen] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverDay, setDragOverDay] = useState<string | null>(null);
  const [view, setView] = useState<'board' | 'calendar' | 'plan'>('board');
  const [priorityFilter, setPriorityFilter] = useState<'all' | Priority>('all');
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [form, setForm] = useState({ title: '', detail: '', priority: 'P1' as Priority, assignee: '', bucket: 'today' as Bucket, due: 'Today' });

  const filtered = tasks.filter((t) => priorityFilter === 'all' || t.priority === priorityFilter);

  const submit = () => {
    if (!form.title.trim()) return;
    const id = `t-${Date.now()}`;
    addTask({
      id,
      title: form.title.trim(),
      detail: form.detail.trim(),
      priority: form.priority,
      status: 'todo',
      bucket: form.bucket,
      assignee: form.assignee || 'Borga',
      tags: [],
      due: form.due.trim() || BUCKET_DUE[form.bucket],
      progress: 0,
    });
    log({ agentId: 'a-borga', agentName: 'Borga', actor: 'user', kind: 'task', message: `Task created: ${form.title.trim()}` });
    setForm({ title: '', detail: '', priority: 'P1', assignee: '', bucket: 'today', due: 'Today' });
    setOpen(false);
  };

  const onDrop = (bucket: Bucket) => {
    if (dragId) {
      moveTaskBucket(dragId, bucket);
      log({ agentId: 'a-borga', agentName: 'Borga', actor: 'agent', kind: 'task', message: `Task moved to ${bucket} bucket.` });
    }
    setDragId(null);
  };

  const onDropDay = (day: string) => {
    if (dragId) {
      updateTask(dragId, { due: day });
      log({ agentId: 'a-borga', agentName: 'Borga', actor: 'user', kind: 'task', message: `Task rescheduled to ${day}.` });
    }
    setDragId(null);
    setDragOverDay(null);
  };

  return (
    <div className="borga-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle title="Planner" sub="Plan goals into runs, or work the task board — filter by priority and reprioritise" />
        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> New task
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-muted-foreground">Priority</span>
          {(['all', 'P0', 'P1', 'P2', 'P3'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPriorityFilter(p)}
              className={cn(
                'flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                priorityFilter === p ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground hover:border-primary hover:text-primary',
              )}
            >
              {p === 'all' ? 'All' : p}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 rounded-lg border p-0.5">
          <button
            onClick={() => setView('board')}
            className={cn('flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors', view === 'board' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground')}
          >
            <LayoutGrid className="h-3.5 w-3.5" /> Board
          </button>
          <button
            onClick={() => setView('calendar')}
            className={cn('flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors', view === 'calendar' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground')}
          >
            <CalendarRange className="h-3.5 w-3.5" /> Calendar
          </button>
          <button
            onClick={() => setView('plan')}
            className={cn('flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors', view === 'plan' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground')}
          >
            <Wand2 className="h-3.5 w-3.5" /> Plan a goal
          </button>
        </div>
      </div>

      {view === 'plan' ? (
        <PlanBuilder />
      ) : view === 'calendar' ? (
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <SectionTitle title="Week calendar" sub="Tasks placed by their due day — drag to reschedule" />
            <Badge variant="secondary">{filtered.length} shown</Badge>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-7">
            {WEEK.map((day) => {
              const list = filtered.filter((t) => dueDay(t.due) === day);
              return (
                <div
                  key={day}
                  onDragOver={(e) => { e.preventDefault(); setDragOverDay(day); }}
                  onDragLeave={() => setDragOverDay((d) => (d === day ? null : d))}
                  onDrop={() => onDropDay(day)}
                  className={cn(
                    'min-h-[180px] rounded-xl border bg-muted/20 p-2.5 transition-colors',
                    dragOverDay === day && 'border-dashed border-primary bg-primary/5',
                  )}
                >
                  <div className="mb-2 flex items-center justify-between px-1">
                    <span className="text-xs font-semibold">{day}</span>
                    <Badge variant="secondary">{list.length}</Badge>
                  </div>
                  <div className="flex flex-col gap-2">
                    {list.map((t) => {
                      const agent = agents.find((a) => a.name === t.assignee);
                      return (
                        <div
                          key={t.id}
                          draggable
                          onDragStart={() => setDragId(t.id)}
                          onDragEnd={() => { setDragId(null); setDragOverDay(null); }}
                          className={cn('cursor-grab rounded-lg border bg-background p-2 active:cursor-grabbing', dragId === t.id && 'opacity-50')}
                        >
                          <div className="flex items-center justify-between gap-1.5">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <span className={cn('rounded px-1 py-px text-[9px] font-semibold ring-1', PRIORITY_COLOR[t.priority])}>{t.priority}</span>
                              <span className={cn('truncate text-[10px]', t.status === 'done' ? 'text-emerald-600' : 'text-muted-foreground')}>{t.status}</span>
                            </div>
                            <div className="flex shrink-0 items-center gap-0.5">
                              <Button size="icon" variant="ghost" className="h-5 w-5" title="Edit" onClick={() => setEditTask(t)}>
                                <Pencil className="h-2.5 w-2.5" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-5 w-5 text-muted-foreground hover:text-rose-500" title="Delete" onClick={() => deleteTask(t.id)}>
                                <Trash2 className="h-2.5 w-2.5" />
                              </Button>
                            </div>
                          </div>
                          <p className="mt-1 text-xs font-medium leading-snug">{t.title}</p>
                          <p className="mt-1 text-[10px] text-muted-foreground">{agent ? agent.name : t.assignee} — {t.due}</p>
                        </div>
                      );
                    })}
                    {list.length === 0 && (
                      <div className="flex h-14 items-center justify-center rounded-lg border border-dashed text-[11px] text-muted-foreground">—</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {BUCKETS.map((b) => {
            const list = sortTasks(filtered.filter((t) => t.bucket === b.id));
            return (
              <div
                key={b.id}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDrop(b.id)}
                className={cn(
                  'flex min-h-[260px] flex-col rounded-2xl border bg-muted/20 p-3 transition-colors',
                  dragId && 'border-dashed border-primary bg-primary/5',
                )}
              >
                <div className="mb-3 flex items-center justify-between px-1">
                  <span className="text-sm font-semibold">
                    {b.icon} {b.label}
                  </span>
                  <Badge variant="secondary">{list.length}</Badge>
                </div>
                <div className="flex flex-col gap-2.5">
                  {list.map((t) => {
                    const agent = agents.find((a) => a.name === t.assignee);
                    return (
                      <Card
                        key={t.id}
                        draggable
                        onDragStart={() => setDragId(t.id)}
                        onDragEnd={() => setDragId(null)}
                        className={cn('cursor-grab p-3 active:cursor-grabbing', dragId === t.id && 'opacity-50')}
                      >
                        <div className="flex items-start gap-2">
                          <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <Select
                                value={t.priority}
                                onValueChange={(v) => updateTask(t.id, { priority: v as Priority })}
                              >
                                <SelectTrigger className="h-6 w-[92px] gap-1 border-0 bg-muted/50 p-0 text-[11px] shadow-none">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => (
                                    <SelectItem key={p} value={p}>
                                      {p} — {PRIORITY_LABEL[p]}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <p className="mt-1.5 text-sm font-medium leading-snug">{t.title}</p>
                            {t.detail && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{t.detail}</p>}
                            <p className="mt-1 text-[10px] text-muted-foreground">{t.due}</p>
                            <div className="mt-2 flex items-center justify-between">
                              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                {agent ? <AgentAvatar name={agent.name} color={agent.avatarColor} size={18} /> : null}
                                {t.assignee}
                              </div>
                              <div className="flex items-center gap-1">
                                <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground" title="Edit" onClick={() => setEditTask(t)}>
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                {t.status !== 'done' ? (
                                  <Button size="icon" variant="ghost" className="h-6 w-6" title="Mark done" onClick={() => updateTask(t.id, { status: 'done', progress: 100 })}>
                                    <CalendarDays className="h-3.5 w-3.5" />
                                  </Button>
                                ) : (
                                  <Badge className="bg-emerald-500/10 text-emerald-600">Done</Badge>
                                )}
                                <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-destructive" title="Delete" onClick={() => deleteTask(t.id)}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                  {list.length === 0 && (
                    <div className="flex h-20 items-center justify-center rounded-xl border border-dashed text-xs text-muted-foreground">
                      Drop tasks here
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create a new task</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Task title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <Textarea placeholder="Details (optional)" rows={2} value={form.detail} onChange={(e) => setForm({ ...form, detail: e.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Priority</label>
                <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v as Priority })}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => (
                      <SelectItem key={p} value={p}>
                        {p} — {PRIORITY_LABEL[p]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Bucket</label>
                <Select value={form.bucket} onValueChange={(v) => setForm({ ...form, bucket: v as Bucket, due: BUCKET_DUE[v as Bucket] })}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="today">Today</SelectItem>
                    <SelectItem value="week">This week</SelectItem>
                    <SelectItem value="month">This month</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Due (places it on the calendar)</label>
                <Input className="mt-1" placeholder="e.g. Today, Tue, This week" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Assign to agent</label>
                <Select value={form.assignee} onValueChange={(v) => setForm({ ...form, assignee: v })}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Assign…" />
                  </SelectTrigger>
                  <SelectContent>
                    {agents.map((a) => (
                      <SelectItem key={a.id} value={a.name}>
                        {a.name} — {a.department}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button className="w-full" onClick={submit}>
              <Plus className="h-4 w-4" /> Create task
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <TaskEditDialog task={editTask} open={!!editTask} onOpenChange={(o) => { if (!o) setEditTask(null); }} />
    </div>
  );
}
