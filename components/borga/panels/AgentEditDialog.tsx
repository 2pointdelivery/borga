'use client';

import { useState } from 'react';
import { Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBorga } from '@/lib/borga/store';
import type { Agent } from '@/lib/borga/data';

const DEPARTMENTS = ['Command', 'Sales', 'Design', 'Engineering', 'Operations', 'Marketing', 'Customer Success', 'Fundraising', 'Custom'];

export function AgentEditDialog({ agent, open, onOpenChange }: { agent: Agent | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { updateAgent, deleteAgent, log, llmCatalog } = useBorga();
  // Model list is derived from the dynamic, per-workspace catalog (DB-backed).
  const MODELS = (llmCatalog ?? []).flatMap((p) => p.models.map((m) => m.id));
  const [form, setForm] = useState<Agent | null>(null);
  const editing = form ?? agent;

  const patch = (p: Partial<Agent>) => setForm((f) => (agent ? { ...(f ?? agent), ...p } : f));

  const save = () => {
    if (!editing || !editing.name.trim()) return;
    updateAgent(editing.id, {
      name: editing.name.trim(),
      role: editing.role,
      department: editing.department,
      description: editing.description,
      model: editing.model,
      skills: editing.skills,
      instructions: editing.instructions,
      status: editing.status,
    });
    log({ agentId: editing.id, agentName: editing.name.trim(), actor: 'user', kind: 'system', message: `Updated agent ${editing.name.trim()}.` });
    setForm(null);
    onOpenChange(false);
  };

  const remove = () => {
    if (!agent) return;
    deleteAgent(agent.id);
    log({ agentId: agent.id, agentName: agent.name, actor: 'user', kind: 'system', message: `Decommissioned agent ${agent.name}.` });
    setForm(null);
    onOpenChange(false);
  };

  const toggleSkill = (skill: string) => {
    if (!editing) return;
    const has = editing.skills.includes(skill);
    patch({ skills: has ? editing.skills.filter((s) => s !== skill) : [...editing.skills, skill] });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setForm(null); }}>
      <DialogContent className="sm:max-w-md" key={editing?.id ?? 'none'}>
        {editing && (
          <>
            <DialogHeader>
              <DialogTitle>Edit agent — {editing.name}</DialogTitle>
              <DialogDescription>Update role, model, skills and operating instructions.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Name</label>
                  <Input className="mt-1" value={editing.name} onChange={(e) => patch({ name: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Department</label>
                  <Select value={editing.department} onValueChange={(v) => patch({ department: v })}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Role</label>
                <Input className="mt-1" value={editing.role} onChange={(e) => patch({ role: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Model</label>
                <Select value={editing.model} onValueChange={(v) => patch({ model: v })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MODELS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Skills</label>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {editing.skills.map((s) => (
                    <button
                      key={s}
                      onClick={() => toggleSkill(s)}
                      className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary ring-1 ring-primary/30"
                    >
                      {s} ✕
                    </button>
                  ))}
                  <input
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const v = (e.target as HTMLInputElement).value.trim();
                        if (v && !editing.skills.includes(v)) patch({ skills: [...editing.skills, v] });
                        (e.target as HTMLInputElement).value = '';
                      }
                    }}
                    placeholder="+ add skill"
                    className="h-7 w-28 rounded-full border border-dashed bg-transparent px-2.5 text-[11px] outline-none placeholder:text-muted-foreground"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Description</label>
                <Textarea rows={2} className="mt-1" value={editing.description} onChange={(e) => patch({ description: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Operating instructions</label>
                <Textarea rows={3} className="mt-1" value={editing.instructions} onChange={(e) => patch({ instructions: e.target.value })} />
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Button variant="outline" size="icon" className="h-9 w-9" onClick={remove} title="Delete agent">
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
