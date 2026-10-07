'use client';

import { fmtMoney } from '@/lib/borga/currencies';
import { useMemo, useState } from 'react';
import { Plus, Trash2, Download, Search, Ban, Pencil } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type FinanceEntry, type FinanceKind, type PaymentMethod } from '@/lib/borga/data';
import { useBorga } from '@/lib/borga/store';
import { findFinanceRefDuplicates } from '@/lib/borga/duplicates';
import { SectionTitle } from '../bits';
import { Field, ProjectSelect, AccountSelect } from '../form-widgets';
import { ConfirmDialog } from '../ConfirmDialog';
import { cn } from '@/lib/utils';

const KIND_STYLE: Record<FinanceKind, string> = {
  revenue: 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/30',
  expense: 'bg-rose-500/10 text-rose-600 ring-rose-500/30',
  invoice: 'bg-sky-500/10 text-sky-600 ring-sky-500/30',
  credit: 'bg-violet-500/10 text-violet-600 ring-violet-500/30',
};

const PAGE_SIZE = 12;

let entrySeq = 0;
/** Unique ledger-entry ids without touching the clock inside the component body. */
const nextEntryId = () => `f-${Date.now().toString(36)}-${(entrySeq += 1)}`;

export function LedgerTab() {
  const { finance, addFinanceEntry, updateFinanceEntry, deleteFinanceEntry, voidFinanceEntry, addApproval, log, activeWorkspace, coa } = useBorga();
  const [entryOpen, setEntryOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<FinanceEntry | null>(null);
  const [confirmDeleteEntry, setConfirmDeleteEntry] = useState<FinanceEntry | null>(null);
  const [confirmDuplicateRef, setConfirmDuplicateRef] = useState<{ entry: FinanceEntry; matches: number } | null>(null);
  const [form, setForm] = useState({ label: '', amount: '', category: '', kind: 'expense' as FinanceKind, externalRef: '', dueDate: '', paymentMethod: 'bank-transfer' as PaymentMethod, projectId: undefined as string | undefined, accountId: undefined as string | undefined });
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | FinanceKind>('all');
  const [page, setPage] = useState(0);

  const currency = activeWorkspace()?.currency ?? 'USD';
  const money = (n: number) => fmtMoney(n, currency);

  const filtered = useMemo(
    () =>
      finance.filter((f) => {
        if (kindFilter !== 'all' && f.kind !== kindFilter) return false;
        if (query && !`${f.label} ${f.category} ${f.kind}`.toLowerCase().includes(query.toLowerCase())) return false;
        return true;
      }),
    [finance, kindFilter, query],
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const paged = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const exportCsv = () => {
      const rows = [
        ['label', 'category', 'kind', `amount_${currency}`, 'due_date', 'payment_method', 'external_ref'],
        ...filtered.map((f) => [f.label, f.category, f.kind, String(f.amount), f.dueDateIso ?? '', f.paymentMethod ?? '', f.externalRef ?? '']),
      ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ledger-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'sync', message: `${filtered.length} ledger entries exported.` });
  };

  const doConfirmDuplicateRef = () => {
    const p = confirmDuplicateRef;
    if (!p) return;
    addFinanceEntry(p.entry);
    addApproval({
      id: `ap-dup-${p.entry.id}`,
      title: `Possible duplicate posting — review ref "${p.entry.externalRef ?? ''}"`,
      description: `Recorded despite reference "${p.entry.externalRef ?? ''}" already being posted (${p.matches} match${p.matches === 1 ? '' : 'es'}). Please confirm it is a separate posting, not a double entry.`,
      category: 'spend',
      amount: p.entry.amount,
      status: 'pending',
      submittedBy: 'Ledger',
      createdAt: new Date().toISOString(),
    });
    log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'system', message: `Ledger entry recorded over a duplicate-reference warning (${p.entry.externalRef ?? ''}) — routed to the approval queue for review.` });
    setConfirmDuplicateRef(null);
    resetForm();
    setEntryOpen(false);
  };

  const submit = () => {
    if (!form.label.trim()) return;
    if (editingEntry) {
      const ok = updateFinanceEntry(editingEntry.id, {
        label: form.label.trim(),
        amount: Number(form.amount) || 0,
        category: form.category.trim() || 'General',
        kind: form.kind,
        dueDateIso: form.dueDate.trim() || undefined,
        paymentMethod: form.paymentMethod,
        externalRef: form.externalRef.trim() || undefined,
        projectId: form.projectId,
        accountId: form.accountId,
      });
      if (ok) log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'task', message: `Ledger entry updated: ${form.label.trim()}.` });
      resetForm();
      setEntryOpen(false);
    } else {
      const entry: FinanceEntry = {
        id: nextEntryId(),
        label: form.label.trim(),
        amount: Number(form.amount) || 0,
        category: form.category.trim() || 'General',
        kind: form.kind,
        dateIso: new Date().toISOString().slice(0, 10),
        dueDateIso: form.dueDate.trim() || undefined,
        paymentMethod: form.paymentMethod,
        createdAt: new Date().toISOString(),
        externalRef: form.externalRef.trim() || undefined,
        projectId: form.projectId,
        accountId: form.accountId,
      };
      const ref = entry.externalRef?.trim() ?? '';
      if (ref) {
        const matches = findFinanceRefDuplicates(ref, null, finance);
        if (matches.length) {
          setConfirmDuplicateRef({ entry, matches: matches.length });
          return;
        }
      }
      addFinanceEntry(entry);
      log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'task', message: `Finance entry recorded: ${form.label.trim()} (${form.kind}, ${PAYMENT_METHOD_LABEL[form.paymentMethod]}).` });
      resetForm();
      setEntryOpen(false);
    }
  };

  const resetForm = () => {
    setForm({ label: '', amount: '', category: '', kind: 'expense', externalRef: '', dueDate: '', paymentMethod: 'bank-transfer', projectId: undefined, accountId: undefined });
    setEditingEntry(null);
  };

  const openNew = () => {
    resetForm();
    setEntryOpen(true);
  };

  const openEdit = (entry: FinanceEntry) => {
    setEditingEntry(entry);
    setForm({
      label: entry.label,
      amount: String(entry.amount),
      category: entry.category,
      kind: entry.kind,
      externalRef: entry.externalRef ?? '',
      dueDate: entry.dueDateIso ?? '',
      paymentMethod: entry.paymentMethod ?? 'bank-transfer',
      projectId: entry.projectId,
      accountId: entry.accountId,
    });
    setEntryOpen(true);
  };

  return (
    <div className="borga-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle title="Transaction ledger" sub={`${finance.length} entries — ${filtered.length} matching current filters`} />
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCsv}>
            <Download className="h-4 w-4" /> Export
          </Button>
          <Button onClick={openNew}>
            <Plus className="h-4 w-4" /> New entry
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} placeholder="Search entries…" className="pl-8" />
        </div>
        <Select value={kindFilter} onValueChange={(v) => { setKindFilter(v as typeof kindFilter); setPage(0); }}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="revenue">Revenue</SelectItem>
            <SelectItem value="expense">Expense</SelectItem>
            <SelectItem value="invoice">Receivable</SelectItem>
            <SelectItem value="credit">Credit</SelectItem>
          </SelectContent>
        </Select>
        <span className="ml-auto text-xs text-muted-foreground">
          Page {safePage + 1} of {pageCount}
        </span>
        <Button size="sm" variant="outline" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>Prev</Button>
        <Button size="sm" variant="outline" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>Next</Button>
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-medium">Entry</th>
              <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Category</th>
              <th className="hidden px-4 py-2.5 font-medium md:table-cell">Due</th>
              <th className="px-4 py-2.5 font-medium">Type</th>
              <th className="hidden px-4 py-2.5 font-medium lg:table-cell">Method</th>
              <th className="px-4 py-2.5 text-right font-medium">Amount</th>
              <th className="w-8 px-2 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {paged.map((f) => (
              <tr key={f.id} className="border-b last:border-0 hover:bg-muted/20">
                <td className="px-4 py-2.5 font-medium">
                  <span className={cn(f.voidedAt && 'line-through opacity-50')}>{f.label}</span>
                  {f.voidedAt && (
                    <span className="ml-1.5 inline-block rounded bg-rose-500/10 px-1 py-0.5 text-[9px] font-semibold uppercase text-rose-600 ring-1 ring-rose-500/30">voided</span>
                  )}
                  {f.dateIso && <span className="block text-[10px] font-normal text-muted-foreground">{f.dateIso}{f.createdAt ? ` · ${new Date(f.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}</span>}
                  {f.externalRef && <span className="block text-[10px] text-muted-foreground">ext {f.externalRef}</span>}
                  {f.taxProfileName && <span className="block text-[10px] text-muted-foreground">{f.taxProfileName}</span>}
                </td>
                <td className="hidden px-4 py-2.5 text-muted-foreground sm:table-cell">
                  {f.category}
                  {f.accountId && (
                    <span className="block text-[10px] text-sky-600">{coa.find((a) => a.id === f.accountId)?.code} — {coa.find((a) => a.id === f.accountId)?.name}</span>
                  )}
                </td>
                <td className="hidden px-4 py-2.5 text-muted-foreground md:table-cell">{f.dueDateIso ?? '—'}</td>
                <td className="px-4 py-2.5">
                  <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase ring-1', KIND_STYLE[f.kind])}>{f.kind}</span>
                </td>
                <td className="hidden px-4 py-2.5 text-xs text-muted-foreground lg:table-cell">
                  {PAYMENT_METHOD_LABEL[f.paymentMethod ?? 'bank-transfer']}
                </td>
                <td className={cn('px-4 py-2.5 text-right font-mono text-xs', f.kind === 'expense' ? 'text-rose-500' : 'text-emerald-600')}>
                  {f.kind === 'expense' ? '−' : '+'}{money(f.amount)}
                </td>
                <td className="px-2 py-2.5">
                  {/* Lock rule: manual drafts delete; auto-posted / voidable entries void in place. */}
                  {f.source === 'auto' && !f.voidedAt ? (
                    <button
                      onClick={() => { const r = window.prompt(`Void "${f.label}"? A reason is kept on the audit trail.`, 'Entered in error'); if (r !== null) voidFinanceEntry(f.id, r ?? undefined); }}
                      className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-amber-500/10 hover:text-amber-600"
                      title="Void entry (system-posted — kept for audit)"
                    >
                      <Ban className="h-3 w-3" />
                    </button>
                  ) : !f.voidedAt ? (
                    <>
                      <button
                        onClick={() => openEdit(f)}
                        className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary"
                        title="Edit draft entry"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => setConfirmDeleteEntry(f)}
                        className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        title="Delete draft entry"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
            {paged.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-xs text-muted-foreground">No entries match.</td></tr>
            )}
          </tbody>
        </table>
      </Card>

      <Dialog open={entryOpen} onOpenChange={(o) => { setEntryOpen(o); if (!o) resetForm(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingEntry ? 'Edit ledger entry' : 'New ledger entry'}</DialogTitle>
            <DialogDescription>
              {editingEntry ? 'Manual drafts can be edited freely — auto-posted entries are locked and must be voided.' : undefined}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Transaction description *</label>
              <Textarea rows={2} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Enterprise licence — Acme" className="mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Amount ({currency})</label>
                <Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="5000" className="mt-1" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Category</label>
                <Input list="ledger-categories" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Sales" className="mt-1" />
                <datalist id="ledger-categories">
                  {[...new Set(finance.map((f) => f.category))].filter(Boolean).sort().map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">External reference</label>
              <Input value={form.externalRef} onChange={(e) => setForm({ ...form, externalRef: e.target.value })} placeholder="Cheque / PO / bank txn" className="mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Due date</label>
                <Input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className="mt-1" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Payment method</label>
                <Select value={form.paymentMethod} onValueChange={(v) => setForm({ ...form, paymentMethod: v as PaymentMethod })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((m) => (
                      <SelectItem key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Type</label>
                <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v as FinanceKind })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="revenue">Revenue</SelectItem>
                    <SelectItem value="expense">Expense</SelectItem>
                    <SelectItem value="invoice">Receivable</SelectItem>
                    <SelectItem value="credit">Credit</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Field label="Project">
                <ProjectSelect value={form.projectId} onChange={(v) => setForm({ ...form, projectId: v })} />
              </Field>
            </div>
            <Field label="GL account" hint="Links this entry to the chart of accounts for accurate reporting.">
              <AccountSelect value={form.accountId} onChange={(v) => setForm({ ...form, accountId: v })} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { resetForm(); setEntryOpen(false); }}>Cancel</Button>
            <Button onClick={submit} disabled={!form.label.trim()}>{editingEntry ? 'Save changes' : 'Save entry'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirmDeleteEntry}
        onOpenChange={(o) => { if (!o) setConfirmDeleteEntry(null); }}
        title="Delete this draft entry?"
        description={confirmDeleteEntry ? `"${confirmDeleteEntry.label}" (${confirmDeleteEntry.kind}) is removed from the ledger.` : ''}
        confirmLabel="Delete entry"
        onConfirm={() => {
          if (!confirmDeleteEntry) return;
          if (!deleteFinanceEntry(confirmDeleteEntry.id)) voidFinanceEntry(confirmDeleteEntry.id, 'Deleted via ledger');
          setConfirmDeleteEntry(null);
        }}
      />

      <ConfirmDialog
        open={!!confirmDuplicateRef}
        onOpenChange={(o) => { if (!o) setConfirmDuplicateRef(null); }}
        title="Reference already posted — record anyway?"
        description={confirmDuplicateRef ? `Reference "${confirmDuplicateRef.entry.externalRef ?? ''}" is already on ${confirmDuplicateRef.matches} ledger entr${confirmDuplicateRef.matches === 1 ? 'y' : 'ies'}. Recording it raises a review approval so someone confirms it is a separate posting.` : ''}
        confirmLabel="Record + flag for review"
        onConfirm={doConfirmDuplicateRef}
      />
    </div>
  );
}
