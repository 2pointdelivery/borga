'use client';

import { useEffect, useState } from 'react';
import { Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ModelPicker } from './ModelPicker';
import { presetFor } from '@/lib/borga/model-catalog';
import { useBorga } from '@/lib/borga/store';
import type { Agent } from '@/lib/borga/data';

const DEPARTMENTS = ['Command', 'Sales', 'Design', 'Engineering', 'Operations', 'Marketing', 'Customer Success', 'Fundraising', 'Custom'];

export function AgentEditDialog({ agent, open, onOpenChange }: { agent: Agent | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { updateAgent, deleteAgent, log, llmCatalog, llm, activeWorkspaceId } = useBorga();
  // Models come from the per-workspace catalog, grouped by provider. Providers that cannot be called
  // (no key / local endpoint down) are flagged: an agent set to one of their models falls back to the default.
  const providers = (llmCatalog ?? []).filter((p) => p.models.length > 0);
  const [usable, setUsable] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (!open) return;
    fetch('/api/borga/probe?ws=' + encodeURIComponent(activeWorkspaceId))
      .then((r) => r.json())
      .then((d: { providers?: { id: string; configured: boolean }[] }) => setUsable(new Set((d.providers ?? []).filter((x) => x.configured).map((x) => x.id))))
      .catch(() => setUsable(null));
  }, [open, activeWorkspaceId]);
  const DEFAULT_VALUE = '__default__';
  const ownerOf = (model: string) => providers.find((p) => p.models.some((m) => m.id === model));
  const modelWarning = (model: string) => {
    if (!model || model === DEFAULT_VALUE) return null;
    const owner = ownerOf(model);
    if (!owner) return 'This model is not in the catalog, so the agent will use the default model.';
    if (usable && !usable.has(owner.id)) return owner.label + (presetFor(owner.id)?.local ? ' is not running right now' : ' has no usable key right now') + ', so this agent will use the default model.';
    return null;
  };
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
                <ModelPicker
                  className="mt-1 h-9"
                  aria-label="Agent model"
                  sections={providers.map((p) => ({ key: p.id, label: p.label + (usable && !usable.has(p.id) ? (presetFor(p.id)?.local ? ' (not running)' : ' (no key yet)') : ''), models: p.models }))}
                  value={editing.model || DEFAULT_VALUE}
                  leading={{ value: DEFAULT_VALUE, label: `Workspace default (${llm.model || 'default'})` }}
                  allowCustom={false}
                  onChange={(v) => patch({ model: v === DEFAULT_VALUE ? '' : v })}
                />
                {modelWarning(editing.model) && <p className="mt-1 text-[11px] text-amber-600">{modelWarning(editing.model)}</p>}
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
