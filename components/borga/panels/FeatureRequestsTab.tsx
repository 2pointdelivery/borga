'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Loader2, Lightbulb } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/lib/toast-bus';
import type { FeatureRequest } from '@/lib/borga/data';
import { SectionTitle } from '../bits';
import { ConfirmDialog } from '../ConfirmDialog';
import { cn } from '@/lib/utils';

const STATUS_STYLE: Record<FeatureRequest['status'], string> = {
  received: 'bg-sky-500/10 text-sky-600 ring-sky-500/30',
  planned: 'bg-violet-500/10 text-violet-600 ring-violet-500/30',
  shipped: 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/30',
  declined: 'bg-muted text-muted-foreground ring-border',
};

export function FeatureRequestsTab() {
  const [requests, setRequests] = useState<FeatureRequest[]>([]);
  const [areas, setAreas] = useState<string[]>(['Other']);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', details: '', area: 'Other' });
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<FeatureRequest | null>(null);

  const refresh = useCallback(async () => {
    const r = await fetch('/api/borga/feature-requests', { cache: 'no-store' });
    const j = (await r.json().catch(() => null)) as { ok?: boolean; requests?: FeatureRequest[]; areas?: string[] } | null;
    if (j?.ok) {
      setRequests(j.requests ?? []);
      if (j.areas?.length) setAreas(j.areas);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submit = async () => {
    if (form.title.trim().length < 4) return;
    setSaving(true);
    const r = await fetch('/api/borga/feature-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
      body: JSON.stringify({ action: 'create', title: form.title.trim(), details: form.details.trim(), area: form.area }),
    });
    const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    setSaving(false);
    if (!j?.ok) {
      toast({ title: 'Could not send request', description: j?.error ?? 'Try again.', variant: 'error' });
      return;
    }
    setForm({ title: '', details: '', area: 'Other' });
    setOpen(false);
    toast({ title: 'Request received', description: 'Thanks — it is on the product list.', variant: 'success' });
    await refresh();
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    await fetch('/api/borga/feature-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
      body: JSON.stringify({ action: 'remove', id: confirmDelete.id }),
    }).catch(() => null);
    setConfirmDelete(null);
    await refresh();
  };

  return (
    <div className="borga-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle title="Feature requests" sub="Tell us what Borga should do next — we read every one" />
        <Button onClick={() => setOpen(true)} className="gap-1.5"><Plus className="h-4 w-4" /> Request a feature</Button>
      </div>

      {loading ? (
        <div className="flex justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : requests.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          Nothing requested yet. Be the first — good requests name the job, not just the button.
        </Card>
      ) : (
        <div className="grid gap-3">
          {requests.map((r) => (
            <Card key={r.id} className="flex items-start gap-3 p-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Lightbulb className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{r.title}</p>
                  <Badge variant="outline" className={cn('text-[10px] capitalize ring-1', STATUS_STYLE[r.status])}>{r.status}</Badge>
                  <span className="text-[11px] text-muted-foreground">{r.area} · {new Date(r.createdAt).toLocaleDateString()}</span>
                </div>
                {r.details && <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{r.details}</p>}
              </div>
              <button onClick={() => setConfirmDelete(r)} className="shrink-0 rounded p-1.5 text-muted-foreground hover:text-destructive" title="Withdraw request">
                <Trash2 className="h-4 w-4" />
              </button>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Request a feature</DialogTitle>
            <DialogDescription>What should Borga do that it cannot do today?</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Title</label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Recurring tasks every Monday" className="mt-1" autoFocus />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Area</label>
              <Select value={form.area} onValueChange={(v) => setForm({ ...form, area: v })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {areas.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Details</label>
              <Textarea rows={4} value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} placeholder="The job you are trying to do, and what happens today instead…" className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={saving || form.title.trim().length < 4}>
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Send request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(o) => { if (!o) setConfirmDelete(null); }}
        title="Withdraw this request?"
        description="It is removed from the product list."
        confirmLabel="Withdraw"
        onConfirm={doDelete}
      />
    </div>
  );
}
