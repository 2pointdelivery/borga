'use client';

import { useEffect, useState } from 'react';
import { Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBorga } from '@/lib/borga/store';
import { KPI_UNITS, type KpiEntry } from '@/lib/borga/data';
import { ConfirmDialog } from '../ConfirmDialog';

export function KpiEditDialog({ groupId, kpi, open, onOpenChange }: { groupId: string; kpi: KpiEntry | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { updateKpi, deleteKpi, kpiGroups, log } = useBorga();
  const [form, setForm] = useState<KpiEntry | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Initialise the form once each time a KPI is opened for editing.
  useEffect(() => {
    if (open) setForm(kpi ? { ...kpi } : null);
  }, [open, kpi]);

  const editing = form ?? kpi;
  const patch = (p: Partial<KpiEntry>) => setForm((f) => (kpi ? { ...(f ?? kpi), ...p } : f));

  const save = () => {
    if (!editing || !editing.label.trim()) return;
    // Key by the ORIGINAL label so renames still target the right KPI.
    updateKpi(groupId, kpi?.label ?? editing.label, {
      label: editing.label.trim(),
      value: editing.live ? kpi?.value ?? 0 : editing.value,
      target: editing.target,
      unit: editing.unit,
      delta: editing.delta,
      direction: editing.direction ?? 'higher',
      // Saving confirms the value (even an intentional 0), so the KPI starts counting.
      valueSet: true,
    });
    const g = kpiGroups.find((x) => x.id === groupId);
    log({ agentId: 'a-borga', agentName: 'Borga', actor: 'user', kind: 'task', message: `Updated KPI ${editing.label.trim()} (${g?.name ?? 'department'}).` });
    setForm(null);
    onOpenChange(false);
  };

  const remove = () => {
    if (!kpi) return;
    setConfirmDelete(true);
  };

  const doRemove = () => {
    if (!kpi) return;
    deleteKpi(groupId, kpi.label);
    const g = kpiGroups.find((x) => x.id === groupId);
    log({ agentId: 'a-borga', agentName: 'Borga', actor: 'user', kind: 'task', message: `Removed KPI ${kpi.label} from ${g?.name ?? 'department'}.` });
    setForm(null);
    setConfirmDelete(false);
    onOpenChange(false);
  };

  return (
    <>
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setForm(null); }}>
      <DialogContent className="sm:max-w-md">
        {editing && (
          <>
            <DialogHeader>
              <DialogTitle>Edit KPI</DialogTitle>
              <DialogDescription>
                {editing.live
                  ? 'This value is computed live from your data — edit the label and target, or delete it.'
                  : 'Update the value, target, unit and trend.'}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">KPI label</label>
                <Input className="mt-1" value={editing.label} onChange={(e) => patch({ label: e.target.value })} />
                {editing.benchmark && <p className="mt-1 text-[11px] text-muted-foreground">{editing.benchmark}</p>}
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Value{editing.live ? ' (live)' : ''}</label>
                  <Input type="number" className="mt-1" value={editing.value} disabled={editing.live} onChange={(e) => patch({ value: Number(e.target.value) || 0 })} />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Target</label>
                  <Input type="number" className="mt-1" value={editing.target} onChange={(e) => patch({ target: Number(e.target.value) || 0 })} />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Delta %</label>
                  <Input type="number" className="mt-1" value={editing.delta} onChange={(e) => patch({ delta: Number(e.target.value) || 0 })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Unit</label>
                  <Select value={editing.unit} onValueChange={(v) => patch({ unit: v })}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {KPI_UNITS.map((u) => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Direction</label>
                  <Select value={editing.direction ?? 'higher'} onValueChange={(v) => patch({ direction: v as 'higher' | 'lower' })}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="higher">Higher is better</SelectItem>
                      <SelectItem value="lower">Lower is better</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Button variant="outline" size="icon" className="h-9 w-9" onClick={remove} title="Delete KPI">
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
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete KPI "${kpi?.label ?? ''}"?`}
        description="The KPI is removed from its department permanently."
        confirmLabel="Delete KPI"
        onConfirm={doRemove}
      />
    </>
  );
}
