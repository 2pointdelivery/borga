'use client';

import { useMemo, useState } from 'react';
import { Plus, X, Layers } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CURRENCY_SYMBOL, type RevenueTrack } from '@/lib/borga/data';
import { makeServiceLines, monthLabels, parseServices, periodLabel, servicesFromKnowledge } from '@/lib/borga/services';
import { useBorga } from '@/lib/borga/store';

const newTrackId = () => 'rt-' + Date.now().toString(36);

/** The company's services: what onboarding captured, falling back to the knowledge-base sentence for older workspaces. */
export function useCompanyServices(): { services: string[]; fromProfile: boolean; save: (next: string[]) => void } {
  const { activeWorkspace, activeWorkspaceId, knowledge, updateWorkspace } = useBorga();
  const ws = activeWorkspace();
  return useMemo(() => {
    const own = ws?.services ?? [];
    const services = own.length ? own : servicesFromKnowledge(knowledge);
    return { services, fromProfile: own.length > 0, save: (next: string[]) => updateWorkspace(activeWorkspaceId, { services: next }) };
  }, [ws?.services, knowledge, updateWorkspace, activeWorkspaceId]);
}

/** Chips for the company's services with add/remove; the Revenue Tracker follows this list. */
export function ServicesCard({ services, onChange }: { services: string[]; onChange: (next: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const merged = parseServices([...services, ...parseServices(draft)].join(','));
    if (merged.length !== services.length) onChange(merged);
    setDraft('');
  };
  return (
    <Card className="space-y-2 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold"><Layers className="h-4 w-4 text-primary" /> Your services</div>
      <p className="text-xs text-muted-foreground">Captured at onboarding. The tracker keeps one revenue line per service, so changing this list changes your plan.</p>
      <div className="flex flex-wrap gap-1.5">
        {services.map((s) => (
          <span key={s} className="flex items-center gap-1 rounded-full border bg-muted/30 px-2.5 py-1 text-xs">
            {s}
            <button type="button" onClick={() => onChange(services.filter((x) => x !== s))} className="text-muted-foreground hover:text-rose-600" aria-label={`Remove ${s}`}><X className="h-3 w-3" /></button>
          </span>
        ))}
        {services.length === 0 && <span className="text-xs text-muted-foreground">No services yet. Add the products or services you sell.</span>}
      </div>
      <div className="flex gap-2">
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Add a service (or several, comma separated)" className="h-8" />
        <Button size="sm" variant="outline" className="gap-1" onClick={add} disabled={!draft.trim()}><Plus className="h-3.5 w-3.5" /> Add</Button>
      </div>
    </Card>
  );
}

/** Creates a revenue plan with one line per service. */
export function CreatePlanDialog({ open, onOpenChange, services, onCreate }: { open: boolean; onOpenChange: (v: boolean) => void; services: string[]; onCreate: (t: RevenueTrack) => void }) {
  const { activeWorkspace } = useBorga();
  const currency = activeWorkspace()?.currency ?? 'USD';
  const now = new Date();
  const [name, setName] = useState('Revenue plan');
  const [count, setCount] = useState(6);
  const [target, setTarget] = useState(0);
  const labels = monthLabels(now.getFullYear(), now.getMonth(), Math.min(24, Math.max(1, count)));

  const create = () => {
    onCreate({
      id: newTrackId(),
      name: name.trim() || 'Revenue plan',
      periodLabel: periodLabel(labels),
      months: labels,
      monthContexts: [],
      lines: makeServiceLines(services, labels.length, target),
      createdAt: new Date().toISOString(),
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New revenue plan from your services</DialogTitle>
          <DialogDescription>One line per service: {services.join(', ') || 'none yet'}. You can fine-tune each month afterwards.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div><label className="text-xs font-medium text-muted-foreground">Plan name</label><Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs font-medium text-muted-foreground">Months (from this month)</label><Input className="mt-1" type="number" min={1} max={24} value={count} onChange={(e) => setCount(Number(e.target.value) || 1)} /></div>
            <div><label className="text-xs font-medium text-muted-foreground">Monthly target per service ({CURRENCY_SYMBOL[currency]})</label><Input className="mt-1" type="number" min={0} value={target} onChange={(e) => setTarget(Number(e.target.value) || 0)} /></div>
          </div>
          <p className="text-xs text-muted-foreground">{periodLabel(labels)}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={create} disabled={services.length === 0}>Create plan</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
