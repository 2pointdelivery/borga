'use client';

import { useMemo, useState } from 'react';
import { Plus, Pause, Play, Trash2, Pencil, RefreshCw, Repeat } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CURRENCY_SYMBOL, PAYMENT_METHOD_LABEL, fmtNum, type BillLine, type PaymentMethod } from '@/lib/borga/data';
import { FREQUENCY_LABEL, TERMS_DAYS, isFinished, nextRunIso, type RecurringBill, type RecurringFrequency } from '@/lib/borga/recurring';
import { useBorga } from '@/lib/borga/store';
import { toast } from '@/lib/toast-bus';
import { SectionTitle } from '../bits';
import { AccountSelect, DateInput, Field, ProjectSelect, TaxProfilesMultiSelect } from '../form-widgets';

type EndMode = 'never' | 'date' | 'count';
const UNIT: Record<RecurringFrequency, string> = { weekly: 'week', monthly: 'month', quarterly: 'quarter', yearly: 'year' };
const cadence = (r: Pick<RecurringBill, 'frequency' | 'every'>) => (r.every > 1 ? `every ${r.every} ${UNIT[r.frequency]}s` : FREQUENCY_LABEL[r.frequency].toLowerCase());

interface Form {
  name: string;
  vendorId: string;
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
  estimated: boolean;
  lines: BillLine[];
  projectId?: string;
  accountId?: string;
}

let seq = 0;
const lineId = () => `rbl-${Date.now().toString(36)}-${++seq}`;
const today = () => new Date().toISOString().slice(0, 10);
const emptyForm = (taxId?: string): Form => ({
  name: '', vendorId: '', frequency: 'monthly', every: 1, startDateIso: today(), endMode: 'never', endDateIso: '', maxOccurrences: 12, dueDays: 30,
  taxProfileIds: taxId ? [taxId] : [], paymentMethod: 'bank-transfer', notes: '', estimated: false, lines: [{ id: lineId(), description: '', qty: 1, unitPrice: 0 }],
});

export function RecurringBillsTab() {
  const { recurringBills, addRecurringBill, updateRecurringBill, deleteRecurringBill, runRecurringBills, bills, vendors, taxProfiles, defaultTaxProfileId, activeWorkspace, log } = useBorga();
  const currency = activeWorkspace()?.currency ?? 'USD';
  const money = (n: number) => `${CURRENCY_SYMBOL[currency]}${fmtNum(n)}`;

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(() => emptyForm(defaultTaxProfileId));
  const [confirmDelete, setConfirmDelete] = useState<RecurringBill | null>(null);

  const taxRate = taxProfiles.filter((t) => form.taxProfileIds.includes(t.id)).reduce((s, t) => s + t.rate, 0);
  const subtotal = form.lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0);
  const total = subtotal + (subtotal * taxRate) / 100;

  const rows = useMemo(
    () => recurringBills.map((r) => {
      const generated = bills.filter((b) => b.externalRef?.startsWith(`rec:${r.id}:`));
      const rate = taxProfiles.filter((t) => r.taxProfileIds.includes(t.id)).reduce((s, t) => s + t.rate, 0);
      const sub = r.lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0);
      return { r, generated, amount: sub + (sub * rate) / 100 };
    }),
    [recurringBills, bills, taxProfiles],
  );

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm(defaultTaxProfileId));
    setOpen(true);
  };

  const openEdit = (r: RecurringBill) => {
    setEditingId(r.id);
    setForm({
      name: r.name, vendorId: r.vendorId, frequency: r.frequency, every: r.every, startDateIso: r.startDateIso,
      endMode: r.maxOccurrences !== undefined ? 'count' : r.endDateIso ? 'date' : 'never', endDateIso: r.endDateIso ?? '', maxOccurrences: r.maxOccurrences ?? 12,
      dueDays: r.dueDays, taxProfileIds: r.taxProfileIds, paymentMethod: r.paymentMethod, notes: r.notes ?? '', estimated: r.estimated,
      lines: r.lines.map((l) => ({ ...l })), projectId: r.projectId, accountId: r.accountId,
    });
    setOpen(true);
  };

  const pickVendor = (id: string) => {
    const v = vendors.find((x) => x.id === id);
    setForm((f) => ({ ...f, vendorId: id, name: f.name || (v ? `${v.name} — recurring` : ''), dueDays: v ? TERMS_DAYS[v.terms] : f.dueDays }));
  };

  const valid = form.name.trim() && form.vendorId && form.lines.some((l) => l.description.trim() && Number(l.unitPrice) > 0) && form.every >= 1 && form.startDateIso
    && (form.endMode !== 'date' || (form.endDateIso && form.endDateIso >= form.startDateIso)) && (form.endMode !== 'count' || form.maxOccurrences >= 1);

  const save = () => {
    const vendor = vendors.find((v) => v.id === form.vendorId);
    if (!valid || !vendor) return;
    const fields = {
      name: form.name.trim(), vendorId: vendor.id, vendorName: vendor.name, projectId: form.projectId, accountId: form.accountId,
      lines: form.lines.filter((l) => l.description.trim() || Number(l.unitPrice)), taxProfileIds: form.taxProfileIds, paymentMethod: form.paymentMethod,
      notes: form.notes.trim() || undefined, estimated: form.estimated, frequency: form.frequency, every: Math.round(form.every),
      startDateIso: form.startDateIso, endDateIso: form.endMode === 'date' ? form.endDateIso : undefined,
      maxOccurrences: form.endMode === 'count' ? Math.round(form.maxOccurrences) : undefined, dueDays: Math.max(0, Math.round(form.dueDays)),
    };
    if (editingId) {
      updateRecurringBill(editingId, fields);
      const cur = recurringBills.find((r) => r.id === editingId);
      if (cur && cur.status === 'ended' && !isFinished({ ...cur, ...fields })) updateRecurringBill(editingId, { status: 'active' });
    } else {
      addRecurringBill({ ...fields, id: `rcb-${Date.now().toString(36)}`, status: 'active', generatedCount: 0, createdAt: new Date().toISOString() });
    }
    log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'task', message: `Recurring bill "${fields.name}" ${editingId ? 'updated' : 'created'}: ${cadence(fields)} from ${fields.startDateIso}.` });
    setOpen(false);
    const r = runRecurringBills();
    if (r.created) toast({ title: `${r.created} bill${r.created === 1 ? '' : 's'} recorded`, description: `${r.bills.join(', ')} (unpaid)`, variant: 'success' });
  };

  const runNow = () => {
    const r = runRecurringBills();
    toast(r.created ? { title: `${r.created} bill${r.created === 1 ? '' : 's'} recorded`, description: `${r.bills.join(', ')}. Nothing was paid; review them under Vendors & AP.`, variant: 'success' } : { title: 'Nothing is due', description: 'Every active schedule is up to date.', variant: 'info' });
  };

  const setLine = (id: string, patch: Partial<BillLine>) => setForm((f) => ({ ...f, lines: f.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionTitle title="Recurring bills" sub="Rent, subscriptions, retainers: record the vendor bill each period. Bills are recorded as unpaid. Nothing is paid automatically." />
        <div className="flex gap-2">
          <Button variant="outline" className="gap-1.5" onClick={runNow} title="Record any bills that are due now"><RefreshCw className="h-4 w-4" /> Run due now</Button>
          <Button className="gap-1.5" onClick={openCreate} disabled={vendors.length === 0}><Plus className="h-4 w-4" /> New schedule</Button>
        </div>
      </div>

      {vendors.length === 0 && <Card className="p-4 text-sm text-muted-foreground">Add a vendor under Vendors &amp; AP first; each schedule belongs to a vendor.</Card>}

      {rows.length === 0 && vendors.length > 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          <Repeat className="mx-auto mb-2 h-6 w-6 text-primary" />
          No recurring bills yet. Set one up for rent, software subscriptions or retainers and Borga records the bill every period, catching up any that were missed.
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
                      {r.estimated && <Badge variant="outline" className="text-amber-600">estimated amount</Badge>}
                    </p>
                    <p className="text-xs text-muted-foreground">{r.vendorName} · {money(amount)} {cadence(r)} · due {r.dueDays} days after the bill date</p>
                    <p className="mt-1 text-xs">
                      {r.status === 'ended' ? 'Schedule finished.' : r.status === 'paused' ? 'Paused: nothing is recorded until you resume.' : next ? `Next bill ${next}.` : 'No further bills.'}
                      {' '}Recorded so far: <strong>{r.generatedCount}</strong>{r.maxOccurrences ? ` of ${r.maxOccurrences}` : ''}{r.lastGeneratedIso ? ` · last ${r.lastGeneratedIso}` : ''}.
                    </p>
                  </div>
                  <div className="flex gap-1">
                    {r.status !== 'ended' && (
                      <Button size="sm" variant="outline" className="gap-1" onClick={() => updateRecurringBill(r.id, { status: r.status === 'active' ? 'paused' : 'active' })}>
                        {r.status === 'active' ? <><Pause className="h-3.5 w-3.5" /> Pause</> : <><Play className="h-3.5 w-3.5" /> Resume</>}
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => openEdit(r)} title="Edit"><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => setConfirmDelete(r)} title="Delete schedule"><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
                {generated.length > 0 && (
                  <details className="mt-3 text-xs">
                    <summary className="cursor-pointer font-medium">Recorded bills ({generated.length})</summary>
                    <ul className="mt-2 divide-y rounded-lg border">
                      {generated.slice(0, 20).map((b) => (
                        <li key={b.id} className="flex items-center justify-between px-3 py-1.5">
                          <span>{b.number} · dated {b.received}</span>
                          <span className="text-muted-foreground">{money(b.amount)} · {b.voidedAt ? 'void' : b.status}</span>
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
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit recurring bill' : 'New recurring bill'}</DialogTitle>
            <DialogDescription>Each period a bill is recorded as unpaid, ready for your normal payment approval.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Vendor">
                <Select value={form.vendorId || undefined} onValueChange={pickVendor}>
                  <SelectTrigger><SelectValue placeholder="Choose a vendor" /></SelectTrigger>
                  <SelectContent>{vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Schedule name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Office rent" /></Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Repeat">
                <Select value={form.frequency} onValueChange={(v) => setForm({ ...form, frequency: v as RecurringFrequency })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{(Object.keys(FREQUENCY_LABEL) as RecurringFrequency[]).map((f) => <SelectItem key={f} value={f}>{FREQUENCY_LABEL[f]}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Every N periods"><Input type="number" min={1} max={24} value={form.every} onChange={(e) => setForm({ ...form, every: Number(e.target.value) || 1 })} /></Field>
              <Field label="First bill date" hint="Later bills keep this day of the month"><DateInput value={form.startDateIso} onChange={(v) => setForm({ ...form, startDateIso: v })} /></Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Ends">
                <Select value={form.endMode} onValueChange={(v) => setForm({ ...form, endMode: v as EndMode })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="never">Never</SelectItem>
                    <SelectItem value="date">On a date</SelectItem>
                    <SelectItem value="count">After N bills</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {form.endMode === 'date' && <Field label="Last date"><DateInput value={form.endDateIso} onChange={(v) => setForm({ ...form, endDateIso: v })} /></Field>}
              {form.endMode === 'count' && <Field label="Number of bills"><Input type="number" min={1} value={form.maxOccurrences} onChange={(e) => setForm({ ...form, maxOccurrences: Number(e.target.value) || 1 })} /></Field>}
              <Field label="Payment terms (days)" hint="Defaults from the vendor"><Input type="number" min={0} value={form.dueDays} onChange={(e) => setForm({ ...form, dueDays: Number(e.target.value) || 0 })} /></Field>
            </div>

            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Lines <span className="font-normal">(use <code>{'{period}'}</code> for the month, e.g. &quot;Rent for {'{period}'}&quot;)</span></p>
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
            <p className="text-right text-sm">Each bill: <strong>{money(Math.round(total * 100) / 100)}</strong> <span className="text-xs text-muted-foreground">({money(subtotal)} + {taxRate}% tax)</span></p>

            <label className="flex items-start justify-between gap-4 rounded-lg border px-3 py-2.5">
              <span>
                <span className="block text-sm font-medium">The amount varies (utilities, usage)</span>
                <span className="block text-xs text-muted-foreground">Each bill is flagged &quot;ESTIMATE: confirm against the vendor&apos;s invoice before paying&quot;.</span>
              </span>
              <Switch checked={form.estimated} onCheckedChange={(v) => setForm({ ...form, estimated: v })} />
            </label>

            <div className="grid grid-cols-3 gap-3">
              <Field label="Settlement">
                <Select value={form.paymentMethod} onValueChange={(v) => setForm({ ...form, paymentMethod: v as PaymentMethod })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{(Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[]).map((m) => <SelectItem key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Project"><ProjectSelect value={form.projectId} onChange={(v) => setForm({ ...form, projectId: v })} /></Field>
              <Field label="Expense account"><AccountSelect value={form.accountId} onChange={(v) => setForm({ ...form, accountId: v })} types={['expense', 'cost']} /></Field>
            </div>
            <Field label="Notes on each bill"><Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={!valid}>{editingId ? 'Save changes' : 'Create schedule'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete schedule?</DialogTitle>
            <DialogDescription>&quot;{confirmDelete?.name}&quot; stops recording bills. Bills it already recorded are kept.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => { if (confirmDelete) deleteRecurringBill(confirmDelete.id); setConfirmDelete(null); }}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
