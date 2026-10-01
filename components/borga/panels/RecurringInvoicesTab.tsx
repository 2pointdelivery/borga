'use client';

import { useMemo, useState } from 'react';
import { Plus, Pause, Play, Trash2, Pencil, RefreshCw, Repeat } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CURRENCY_SYMBOL, PAYMENT_METHOD_LABEL, fmtNum, type InvoiceLine, type PaymentMethod } from '@/lib/borga/data';
import { FREQUENCY_LABEL, isFinished, nextRunIso, type RecurringFrequency, type RecurringInvoice } from '@/lib/borga/recurring';
import { useBorga } from '@/lib/borga/store';
import { toast } from '@/lib/toast-bus';
import { SectionTitle } from '../bits';
import { AccountSelect, DateInput, Field, ProjectSelect, TaxProfilesMultiSelect } from '../form-widgets';

const NONE = '__none__';
type EndMode = 'never' | 'date' | 'count';

interface Form {
  name: string;
  client: string;
  customerId?: string;
  frequency: RecurringFrequency;
  every: number;
  startDateIso: string;
  endMode: EndMode;
  endDateIso: string;
  maxOccurrences: number;
  dueDays: number;
  taxProfileIds: string[];
  paymentMethod: PaymentMethod;
  notes: string;
  description: string;
  lines: InvoiceLine[];
  projectId?: string;
  accountId?: string;
}

let seq = 0;
const lineId = () => `rl-${Date.now().toString(36)}-${++seq}`;
const today = () => new Date().toISOString().slice(0, 10);
const UNIT: Record<RecurringFrequency, string> = { weekly: 'week', monthly: 'month', quarterly: 'quarter', yearly: 'year' };
const cadence = (r: Pick<RecurringInvoice, 'frequency' | 'every'>) => (r.every > 1 ? `every ${r.every} ${UNIT[r.frequency]}s` : FREQUENCY_LABEL[r.frequency].toLowerCase());

const emptyForm = (taxId?: string): Form => ({
  name: '', client: '', frequency: 'monthly', every: 1, startDateIso: today(), endMode: 'never', endDateIso: '', maxOccurrences: 12, dueDays: 30,
  taxProfileIds: taxId ? [taxId] : [], paymentMethod: 'bank-transfer', notes: '', description: '', lines: [{ id: lineId(), description: '', qty: 1, unitPrice: 0 }],
});

export function RecurringInvoicesTab() {
  const { recurringInvoices, addRecurringInvoice, updateRecurringInvoice, deleteRecurringInvoice, runRecurringInvoices, invoices, customers, taxProfiles, defaultTaxProfileId, activeWorkspace, log } = useBorga();
  const currency = activeWorkspace()?.currency ?? 'USD';
  const money = (n: number) => `${CURRENCY_SYMBOL[currency]}${fmtNum(n)}`;

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(() => emptyForm(defaultTaxProfileId));
  const [confirmDelete, setConfirmDelete] = useState<RecurringInvoice | null>(null);

  const taxRate = taxProfiles.filter((t) => form.taxProfileIds.includes(t.id)).reduce((s, t) => s + t.rate, 0);
  const subtotal = form.lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0);
  const total = subtotal + (subtotal * taxRate) / 100;

  const rows = useMemo(
    () => recurringInvoices.map((r) => {
      const generated = invoices.filter((i) => i.externalRef?.startsWith(`rec:${r.id}:`));
      const rate = taxProfiles.filter((t) => r.taxProfileIds.includes(t.id)).reduce((s, t) => s + t.rate, 0);
      const sub = r.lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0);
      return { r, generated, amount: sub + (sub * rate) / 100 };
    }),
    [recurringInvoices, invoices, taxProfiles],
  );

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm(defaultTaxProfileId));
    setOpen(true);
  };

  const openEdit = (r: RecurringInvoice) => {
    setEditingId(r.id);
    setForm({
      name: r.name, client: r.client, customerId: r.customerId, frequency: r.frequency, every: r.every, startDateIso: r.startDateIso,
      endMode: r.maxOccurrences !== undefined ? 'count' : r.endDateIso ? 'date' : 'never', endDateIso: r.endDateIso ?? '', maxOccurrences: r.maxOccurrences ?? 12,
      dueDays: r.dueDays, taxProfileIds: r.taxProfileIds, paymentMethod: r.paymentMethod, notes: r.notes ?? '', description: r.description ?? '',
      lines: r.lines.map((l) => ({ ...l })), projectId: r.projectId, accountId: r.accountId,
    });
    setOpen(true);
  };

  const copyFrom = (invoiceId: string) => {
    const inv = invoices.find((i) => i.id === invoiceId);
    if (!inv) return;
    setForm((f) => ({
      ...f,
      name: f.name || `${inv.client} — recurring`,
      client: inv.client,
      customerId: inv.customerId,
      lines: (inv.lines?.length ? inv.lines : [{ id: lineId(), description: inv.description || 'Services rendered', qty: 1, unitPrice: inv.amount }]).map((l) => ({ ...l, id: lineId() })),
      taxProfileIds: inv.taxProfileIds ?? (inv.taxProfileId ? [inv.taxProfileId] : f.taxProfileIds),
      paymentMethod: inv.paymentMethod ?? f.paymentMethod,
      notes: inv.notes ?? '',
      description: inv.description ?? '',
      projectId: inv.projectId,
      accountId: inv.accountId,
    }));
  };

  const valid = form.name.trim() && form.client.trim() && form.lines.some((l) => l.description.trim() && Number(l.unitPrice) > 0) && form.every >= 1 && form.startDateIso
    && (form.endMode !== 'date' || (form.endDateIso && form.endDateIso >= form.startDateIso)) && (form.endMode !== 'count' || form.maxOccurrences >= 1);

  const save = () => {
    if (!valid) return;
    const fields = {
      name: form.name.trim(), client: form.client.trim(), customerId: form.customerId, projectId: form.projectId, accountId: form.accountId,
      lines: form.lines.filter((l) => l.description.trim() || Number(l.unitPrice)), taxProfileIds: form.taxProfileIds, paymentMethod: form.paymentMethod,
      notes: form.notes.trim() || undefined, description: form.description.trim() || undefined, frequency: form.frequency, every: Math.round(form.every),
      startDateIso: form.startDateIso, endDateIso: form.endMode === 'date' ? form.endDateIso : undefined,
      maxOccurrences: form.endMode === 'count' ? Math.round(form.maxOccurrences) : undefined, dueDays: Math.max(0, Math.round(form.dueDays)),
    };
    if (editingId) {
      updateRecurringInvoice(editingId, fields);
      // Editing an ended schedule so that it can run again re-activates it.
      const cur = recurringInvoices.find((r) => r.id === editingId);
      if (cur && cur.status === 'ended' && !isFinished({ ...cur, ...fields })) updateRecurringInvoice(editingId, { status: 'active' });
    } else {
      addRecurringInvoice({ ...fields, id: `rec-${Date.now().toString(36)}`, status: 'active', generatedCount: 0, createdAt: new Date().toISOString() });
    }
    log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'task', message: `Recurring invoice "${fields.name}" ${editingId ? 'updated' : 'created'}: ${cadence(fields)} from ${fields.startDateIso}.` });
    setOpen(false);
    // A schedule starting today (or in the past) should bill right away, not on the next page load.
    const r = runRecurringInvoices();
    if (r.created) toast({ title: `${r.created} draft invoice${r.created === 1 ? '' : 's'} created`, description: r.invoices.join(', '), variant: 'success' });
  };

  const runNow = () => {
    const r = runRecurringInvoices();
    toast(r.created ? { title: `${r.created} draft invoice${r.created === 1 ? '' : 's'} created`, description: `${r.invoices.join(', ')}. Review and send them under Invoicing.`, variant: 'success' } : { title: 'Nothing is due', description: 'Every active schedule is up to date.', variant: 'info' });
  };

  const setLine = (id: string, patch: Partial<InvoiceLine>) => setForm((f) => ({ ...f, lines: f.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionTitle title="Recurring invoices" sub="Schedules that create a draft invoice each period. Nothing is emailed automatically: you review and send each draft." />
        <div className="flex gap-2">
          <Button variant="outline" className="gap-1.5" onClick={runNow} title="Create any invoices that are due now"><RefreshCw className="h-4 w-4" /> Run due now</Button>
          <Button className="gap-1.5" onClick={openCreate}><Plus className="h-4 w-4" /> New schedule</Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          <Repeat className="mx-auto mb-2 h-6 w-6 text-primary" />
          No recurring invoices yet. Create a schedule (or copy one from an existing invoice) and Borga drafts the invoice every period, catching up any that were missed.
        </Card>
      ) : (
        <div className="grid gap-3">
          {rows.map(({ r, generated, amount }) => {
            const next = nextRunIso(r);
            return (
              <Card key={r.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-semibold">
                      {r.name}
                      <Badge variant={r.status === 'active' ? 'secondary' : 'outline'} className="capitalize">{r.status}</Badge>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {r.client} · {money(amount)} {cadence(r)} · due {r.dueDays} days after issue
                    </p>
                    <p className="mt-1 text-xs">
                      {r.status === 'ended' ? 'Schedule finished.' : r.status === 'paused' ? 'Paused: nothing is generated until you resume.' : next ? `Next invoice ${next}.` : 'No further invoices.'}
                      {' '}Generated so far: <strong>{r.generatedCount}</strong>{r.maxOccurrences ? ` of ${r.maxOccurrences}` : ''}{r.lastGeneratedIso ? ` · last ${r.lastGeneratedIso}` : ''}.
                    </p>
                  </div>
                  <div className="flex gap-1">
                    {r.status !== 'ended' && (
                      <Button size="sm" variant="outline" className="gap-1" onClick={() => updateRecurringInvoice(r.id, { status: r.status === 'active' ? 'paused' : 'active' })}>
                        {r.status === 'active' ? <><Pause className="h-3.5 w-3.5" /> Pause</> : <><Play className="h-3.5 w-3.5" /> Resume</>}
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => openEdit(r)} title="Edit"><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => setConfirmDelete(r)} title="Delete schedule"><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
                {generated.length > 0 && (
                  <details className="mt-3 text-xs">
                    <summary className="cursor-pointer font-medium">Generated invoices ({generated.length})</summary>
                    <ul className="mt-2 divide-y rounded-lg border">
                      {generated.slice(0, 20).map((i) => (
                        <li key={i.id} className="flex items-center justify-between px-3 py-1.5">
                          <span>{i.number} · issued {i.issued}</span>
                          <span className="text-muted-foreground">{money(i.amount)} · {i.voidedAt ? 'void' : i.status}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>{editingId ? 'Edit recurring invoice' : 'New recurring invoice'}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            {!editingId && invoices.length > 0 && (
              <Field label="Copy from an existing invoice (optional)">
                <Select value={NONE} onValueChange={(v) => v !== NONE && copyFrom(v)}>
                  <SelectTrigger><SelectValue placeholder="Choose an invoice to copy client, lines and tax" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Start blank</SelectItem>
                    {invoices.filter((i) => !i.voidedAt).slice(0, 50).map((i) => <SelectItem key={i.id} value={i.id}>{i.number} · {i.client} · {money(i.amount)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Schedule name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Monthly hosting — Acme" /></Field>
              <Field label="Client">
                <Select value={form.customerId ?? NONE} onValueChange={(v) => { const c = customers.find((x) => x.id === v); setForm({ ...form, customerId: c?.id, client: c?.name ?? form.client }); }}>
                  <SelectTrigger><SelectValue placeholder="Pick a customer or type below" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Type a name…</SelectItem>
                    {customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input className="mt-1.5" value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value, customerId: undefined })} placeholder="Client name on the invoice" />
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Repeat">
                <Select value={form.frequency} onValueChange={(v) => setForm({ ...form, frequency: v as RecurringFrequency })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{(Object.keys(FREQUENCY_LABEL) as RecurringFrequency[]).map((f) => <SelectItem key={f} value={f}>{FREQUENCY_LABEL[f]}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Every N periods"><Input type="number" min={1} max={24} value={form.every} onChange={(e) => setForm({ ...form, every: Number(e.target.value) || 1 })} /></Field>
              <Field label="First invoice date" hint="Later invoices keep this day of the month"><DateInput value={form.startDateIso} onChange={(v) => setForm({ ...form, startDateIso: v })} /></Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Ends">
                <Select value={form.endMode} onValueChange={(v) => setForm({ ...form, endMode: v as EndMode })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="never">Never</SelectItem>
                    <SelectItem value="date">On a date</SelectItem>
                    <SelectItem value="count">After N invoices</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {form.endMode === 'date' && <Field label="Last date"><DateInput value={form.endDateIso} onChange={(v) => setForm({ ...form, endDateIso: v })} /></Field>}
              {form.endMode === 'count' && <Field label="Number of invoices"><Input type="number" min={1} value={form.maxOccurrences} onChange={(e) => setForm({ ...form, maxOccurrences: Number(e.target.value) || 1 })} /></Field>}
              <Field label="Payment terms (days)"><Input type="number" min={0} value={form.dueDays} onChange={(e) => setForm({ ...form, dueDays: Number(e.target.value) || 0 })} /></Field>
            </div>

            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Lines <span className="font-normal">(use <code>{'{period}'}</code> for the month, e.g. &quot;Hosting for {'{period}'}&quot;)</span></p>
              <div className="space-y-1.5">
                {form.lines.map((l) => (
                  <div key={l.id} className="grid grid-cols-[1fr_70px_100px_auto] gap-2">
                    <Input value={l.description} onChange={(e) => setLine(l.id, { description: e.target.value })} placeholder="Description" />
                    <Input type="number" min={0} value={l.qty} onChange={(e) => setLine(l.id, { qty: Number(e.target.value) })} />
                    <Input type="number" min={0} value={l.unitPrice} onChange={(e) => setLine(l.id, { unitPrice: Number(e.target.value) })} />
                    <Button variant="ghost" size="icon" disabled={form.lines.length === 1} onClick={() => setForm({ ...form, lines: form.lines.filter((x) => x.id !== l.id) })}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                ))}
              </div>
              <Button variant="outline" size="sm" className="mt-2 gap-1" onClick={() => setForm({ ...form, lines: [...form.lines, { id: lineId(), description: '', qty: 1, unitPrice: 0 }] })}><Plus className="h-3.5 w-3.5" /> Add line</Button>
            </div>

            <Field label="Taxes"><TaxProfilesMultiSelect taxProfiles={taxProfiles} selectedIds={form.taxProfileIds} onChange={(ids) => setForm({ ...form, taxProfileIds: ids })} /></Field>
            <p className="text-right text-sm">Each invoice: <strong>{money(Math.round(total * 100) / 100)}</strong> <span className="text-xs text-muted-foreground">({money(subtotal)} + {taxRate}% tax)</span></p>

            <div className="grid grid-cols-3 gap-3">
              <Field label="Settlement">
                <Select value={form.paymentMethod} onValueChange={(v) => setForm({ ...form, paymentMethod: v as PaymentMethod })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{(Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[]).map((m) => <SelectItem key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Project"><ProjectSelect value={form.projectId} onChange={(v) => setForm({ ...form, projectId: v })} /></Field>
              <Field label="Revenue account"><AccountSelect value={form.accountId} onChange={(v) => setForm({ ...form, accountId: v })} types={['revenue']} /></Field>
            </div>
            <Field label="Notes on each invoice"><Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={!valid}>{editingId ? 'Save changes' : 'Create schedule'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete schedule?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">&quot;{confirmDelete?.name}&quot; stops generating invoices. Invoices it already created are kept.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => { if (confirmDelete) deleteRecurringInvoice(confirmDelete.id); setConfirmDelete(null); }}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

