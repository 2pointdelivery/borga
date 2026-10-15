'use client';

import { useState } from 'react';
import { Plus, Trash2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBorga } from '@/lib/borga/store';
import { toast } from '@/lib/toast-bus';
import { ruleSummary } from '@/lib/borga/lead-assign';
import type { LeadAssignmentRule, LeadStage } from '@/lib/borga/data';

const STAGES: Array<LeadAssignmentRule['stage']> = ['any', 'new', 'qualified', 'proposal'];

const blank = (): LeadAssignmentRule => ({
  id: `rule-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
  name: '', stage: 'any', sourceContains: '', assignee: '', roundRobin: [],
});

/** Who owns a new lead: first matching rule wins, otherwise whoever captured it chose. */
export function LeadRulesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { settings, setSettings, applyAssignmentRules } = useBorga();
  const [applying, setApplying] = useState(false);
  const rules = settings.leadAssignmentRules ?? [];

  const set = (next: LeadAssignmentRule[]) => setSettings({ leadAssignmentRules: next });

  const apply = () => {
    setApplying(true);
    try {
      const r = applyAssignmentRules();
      toast(r.assigned
        ? { title: `${r.assigned} lead${r.assigned === 1 ? '' : 's'} routed`, variant: 'success' }
        : { title: 'Nothing to route', description: 'Every open lead already has a deliberate owner.', variant: 'info' });
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Assignment rules</DialogTitle>
          <DialogDescription>First matching rule owns the lead — on capture and when you apply below. Empty conditions match every lead, so put the catch-all last.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {rules.map((r, i) => (
            <div key={r.id} className="space-y-2 rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Input value={r.name} onChange={(e) => set(rules.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder={`Rule ${i + 1} — e.g. Big web leads`} className="flex-1" />
                <Button size="sm" variant="ghost" onClick={() => set(rules.filter((_, j) => j !== i))} aria-label="Delete rule"><Trash2 className="h-4 w-4" /></Button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[11px] text-muted-foreground">Stage</label>
                  <Select value={r.stage ?? 'any'} onValueChange={(v) => set(rules.map((x, j) => (j === i ? { ...x, stage: v as LeadStage | 'any' } : x)))}>
                    <SelectTrigger className="mt-0.5"><SelectValue /></SelectTrigger>
                    <SelectContent>{STAGES.map((s) => <SelectItem key={s} value={s ?? 'any'}>{s === 'any' ? 'Any stage' : s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">Source contains</label>
                  <Input value={r.sourceContains ?? ''} onChange={(e) => set(rules.map((x, j) => (j === i ? { ...x, sourceContains: e.target.value } : x)))} placeholder="e.g. referral" className="mt-0.5" />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">Min. value</label>
                  <Input type="number" value={r.minValue ?? ''} onChange={(e) => set(rules.map((x, j) => (j === i ? { ...x, minValue: e.target.value === '' ? undefined : Number(e.target.value) } : x)))} placeholder="0" className="mt-0.5" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] text-muted-foreground">Owner</label>
                  <Input value={r.assignee} onChange={(e) => set(rules.map((x, j) => (j === i ? { ...x, assignee: e.target.value } : x)))} placeholder="Person or agent" className="mt-0.5" />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">…or round-robin pool (comma names)</label>
                  <Input
                    value={(r.roundRobin ?? []).join(', ')}
                    onChange={(e) => set(rules.map((x, j) => (j === i ? { ...x, roundRobin: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) } : x)))}
                    placeholder="Ama, Kwame"
                    className="mt-0.5"
                  />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">{ruleSummary({ ...r, name: r.name || `Rule ${i + 1}` })}</p>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => set([...rules, blank()])}><Plus className="h-3.5 w-3.5" /> Add rule</Button>
            <Button variant="outline" size="sm" className="gap-1.5" disabled={applying || !rules.length} onClick={apply}>
              <Users className="h-3.5 w-3.5" /> {applying ? 'Routing…' : 'Apply to open leads'}
            </Button>
          </div>
          {!rules.length && <p className="text-xs text-muted-foreground">No rules — every captured lead keeps the owner it was given. Add one to route automatically.</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
