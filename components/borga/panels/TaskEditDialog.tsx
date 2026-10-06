'use client';

import { useState } from 'react';
import { Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBorga } from '@/lib/borga/store';
import { PRIORITY_LABEL, type Bucket, type Priority, type Task } from '@/lib/borga/data';

export function TaskEditDialog({ task, open, onOpenChange }: { task: Task | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { updateTask, deleteTask, agents, log } = useBorga();
  const [form, setForm] = useState<Task | null>(null);
  const editing = form ?? task;
  const patch = (p: Partial<Task>) => setForm((f) => (task ? { ...(f ?? task), ...p } : f));

  const save = () => {
    if (!editing || !editing.title.trim()) return;
    updateTask(editing.id, {
      title: editing.title.trim(),
      detail: editing.detail,
      priority: editing.priority,
      status: editing.status,
      bucket: editing.bucket,
      assignee: editing.assignee,
      due: editing.due,
      progress: editing.progress,
    });
    log({ agentId: 'a-borga', agentName: 'Borga', actor: 'user', kind: 'task', message: `Updated task: ${editing.title.trim()}` });
    setForm(null);
    onOpenChange(false);
  };

  const remove = () => {
    if (!task) return;
    deleteTask(task.id);
    log({ agentId: 'a-borga', agentName: 'Borga', actor: 'user', kind: 'task', message: `Deleted task: ${task.title}` });
    setForm(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setForm(null); }}>
      <DialogContent className="sm:max-w-lg" key={editing?.id ?? 'none'}>
        {editing && (
          <>
            <DialogHeader>
              <DialogTitle>Edit task</DialogTitle>
              <DialogDescription>Update the details, priority, assignee and schedule.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <Input value={editing.title} onChange={(e) => patch({ title: e.target.value })} placeholder="Task title" />
              <Textarea rows={2} value={editing.detail} onChange={(e) => patch({ detail: e.target.value })} placeholder="Details" />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Priority</label>
                  <Select value={editing.priority} onValueChange={(v) => patch({ priority: v as Priority })}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => (
                        <SelectItem key={p} value={p}>{p} — {PRIORITY_LABEL[p]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Bucket</label>
                  <Select value={editing.bucket} onValueChange={(v) => patch({ bucket: v as Bucket })}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
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
                  <label className="text-xs font-medium text-muted-foreground">Assign to</label>
                  <Select value={editing.assignee} onValueChange={(v) => patch({ assignee: v })}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {agents.map((a) => <SelectItem key={a.id} value={a.name}>{a.name} — {a.department}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Status</label>
                  <Select value={editing.status} onValueChange={(v) => patch({ status: v as Task['status'] })}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todo">Todo</SelectItem>
                      <SelectItem value="in-progress">In progress</SelectItem>
                      <SelectItem value="done">Done</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Due</label>
                  <Input className="mt-1" value={editing.due} onChange={(e) => patch({ due: e.target.value })} placeholder="e.g. Today" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Progress ({editing.progress}%)</label>
                  <input
                    type="range" min={0} max={100} step={5}
                    value={editing.progress}
                    onChange={(e) => patch({ progress: Number(e.target.value) })}
                    className="mt-3 w-full"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Button variant="outline" size="icon" className="h-9 w-9" onClick={remove} title="Delete task">
                  <Trash2 className="h-4 w-4 text-rose-500" />
                </Button>
                <Button className="flex-1 gap-1.5" onClick={save}>
                  <Save className="h-4 w-4" /> Save changes
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
