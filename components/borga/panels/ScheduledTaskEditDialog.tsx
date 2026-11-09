'use client';

import { useState } from 'react';
import { Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBorga } from '@/lib/borga/store';
import { toast } from '@/lib/toast-bus';
import type { Agent, ScheduledTask, ScheduleInterval } from '@/lib/borga/data';

const INTERVAL_LABEL: Record<ScheduleInterval, string> = {
  hourly: 'Every hour',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

/** Edit a scheduled task — name, agent, goal, cadence, urgency, enabled. Persists through the scheduler API's `update` action. */
export function ScheduledTaskEditDialog({ task, agents, open, onOpenChange, onSaved }: {
  task: ScheduledTask | null;
  agents: Agent[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: (task: ScheduledTask) => void;
}) {
  const { activeWorkspaceId, log } = useBorga();
  const [form, setForm] = useState<ScheduledTask | null>(null);
  const [saving, setSaving] = useState(false);
  const editing = form ?? task;
  const patch = (p: Partial<ScheduledTask>) => setForm((f) => (task ? { ...(f ?? task), ...p } : f));

  const save = async () => {
    if (!editing || !editing.name.trim() || !editing.goal.trim() || saving) return;
    setSaving(true);
    try {
      const r = await fetch('/api/borga/scheduler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
        body: JSON.stringify({
          action: 'update', id: editing.id, name: editing.name, goal: editing.goal,
          agentId: editing.agentId, interval: editing.interval, urgent: editing.urgent === true,
          enabled: editing.enabled, ws: activeWorkspaceId,
        }),
      });
      const d = await r.json() as { ok?: boolean; task?: ScheduledTask; error?: string };
      if (d.ok && d.task) {
        onSaved(d.task);
        log({ agentId: d.task.agentId, agentName: 'Borga', actor: 'user', kind: 'system', message: `Scheduled task updated: "${d.task.name}".` });
        toast({ title: 'Task updated', variant: 'success' });
        setForm(null);
        onOpenChange(false);
      } else {
        toast({ title: d.error ?? 'Update failed', variant: 'error' });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setForm(null); }}>
      <DialogContent className="sm:max-w-lg" key={editing?.id ?? 'none'}>
        {editing && (
          <>
            <DialogHeader>
              <DialogTitle>Edit scheduled task</DialogTitle>
              <DialogDescription>Update the goal, the agent that runs it, the cadence and urgency.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <Input value={editing.name} onChange={(e) => patch({ name: e.target.value })} placeholder="Task name" />
              <Textarea rows={3} value={editing.goal} onChange={(e) => patch({ goal: e.target.value })} placeholder="Goal — what should the agent do when this task fires?" />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Agent</label>
                  <Select value={editing.agentId} onValueChange={(v) => patch({ agentId: v })}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name} — {a.department}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Cadence</label>
                  <Select value={editing.interval} onValueChange={(v) => patch({ interval: v as ScheduleInterval })}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.entries(INTERVAL_LABEL) as [ScheduleInterval, string][]).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <Switch checked={editing.urgent === true} onCheckedChange={(v) => patch({ urgent: v })} id="edit-urgent" />
                  <div>
                    <label htmlFor="edit-urgent" className="text-sm font-medium">Urgent</label>
                    <p className="text-[11px] text-muted-foreground">May fire during quiet hours; always near the front of the run queue.</p>
                  </div>
                  {editing.urgent && <Badge variant="outline" className="border-rose-500/30 text-[10px] text-rose-600">urgent</Badge>}
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={editing.enabled} onCheckedChange={(v) => patch({ enabled: v })} id="edit-enabled" />
                  <label htmlFor="edit-enabled" className="text-sm font-medium">{editing.enabled ? 'Enabled' : 'Disabled'}</label>
                </div>
              </div>
              <Button className="w-full gap-1.5" onClick={save} disabled={saving || !editing.name.trim() || !editing.goal.trim()}>
                <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
