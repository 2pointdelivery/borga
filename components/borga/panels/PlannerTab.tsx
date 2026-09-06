'use client';

import { useState } from 'react';
import { Plus, Trash2, GripVertical, CalendarDays, LayoutGrid, CalendarRange, Pencil } from 'lucide-react';
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
import { AgentAvatar, SectionTitle } from '../bits';
import { TaskEditDialog } from './TaskEditDialog';
import { cn } from '@/lib/utils';

const BUCKETS: { id: Bucket; label: string; icon: string }[] = [
  { id: 'today', label: 'Today', icon: '☀️' },
  { id: 'week', label: 'This week', icon: '📅' },
  { id: 'month', label: 'This month', icon: '🌙' },
];

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Map a task's due string to a weekday column (Mon..Sun), or null when unscheduled.
function dueDay(due: string): string | null {
  const lower = due.toLowerCase();
  if (lower.includes('today')) return WEEK[(new Date().getDay() + 6) % 7];
  const hit = WEEK.find((d) => lower.startsWith(d.toLowerCase()) || lower.includes(` ${d.toLowerCase()}`));
  return hit ?? null;
}

export function PlannerTab() {
  const { tasks, addTask, updateTask, deleteTask, moveTaskBucket, agents, log } = useBorga();
  const [open, setOpen] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [view, setView] = useState<'board' | 'calendar'>('board');
  const [priorityFilter, setPriorityFilter] = useState<'all' | Priority>('all');
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [form, setForm] = useState({ title: '', detail: '', priority: 'P1' as Priority, assignee: '', bucket: 'today' as Bucket });

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
      due: '…',
      progress: 0,
    });
    log({ agentId: 'a1', agentName: 'Borga', actor: 'user', kind: 'task', message: `Task created: ${form.title.trim()}` });
    setForm({ title: '', detail: '', priority: 'P1', assignee: '', bucket: 'today' });
    setOpen(false);
  };

  const onDrop = (bucket: Bucket) => {
    if (dragId) {
      moveTaskBucket(dragId, bucket);
      log({ agentId: 'a1', agentName: 'Borga', actor: 'agent', kind: 'task', message: `Task moved to ${bucket} bucket.` });
    }
    setDragId(null);
  };

  return (
    <div className="borga-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle title="Planner" sub="Board or calendar — filter by priority and reprioritise" />
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
        </div>
      </div>

      {view === 'calendar' ? (
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <SectionTitle title="Week calendar" sub="Tasks placed by their due day" />
            <Badge variant="secondary">{filtered.length} shown</Badge>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-7">
            {WEEK.map((day) => {
              const list = filtered.filter((t) => dueDay(t.due) === day);
              return (
                <div key={day} className="min-h-[180px] rounded-xl border bg-muted/20 p-2.5">
                  <div className="mb-2 flex items-center justify-between px-1">
                    <span className="text-xs font-semibold">{day}</span>
                    <Badge variant="secondary">{list.length}</Badge>
                  </div>
                  <div className="flex flex-col gap-2">
                    {list.map((t) => {
                      const agent = agents.find((a) => a.name === t.assignee);
                      return (
                        <div key={t.id} className="rounded-lg border bg-background p-2">
                          <div className="flex items-center gap-1.5">
                            <span className={cn('rounded px-1 py-px text-[9px] font-semibold ring-1', PRIORITY_COLOR[t.priority])}>{t.priority}</span>
                            <span className={cn('text-[10px]', t.status === 'done' ? 'text-emerald-600' : 'text-muted-foreground')}>{t.status}</span>
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
                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${PRIORITY_COLOR[t.priority]}`}>
                              {t.priority}
                            </span>
                            <Select
                              value={t.priority}
                              onValueChange={(v) => updateTask(t.id, { priority: v as Priority })}
                            >
                              <SelectTrigger className="h-6 w-[92px] gap-1 border-0 p-0 text-[11px] shadow-none">
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
                <Select value={form.bucket} onValueChange={(v) => setForm({ ...form, bucket: v as Bucket })}>
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
