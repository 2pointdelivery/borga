'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Plus, Trash2, Pencil, ReceiptText, Download, Search, Mail, Send, CircleDollarSign, X, Ban, BellRing,
} from 'lucide-react';
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
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  INVOICE_STATUS_STYLE,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABEL,
  fmtNum,
  INITIAL_TAX_PROFILES,
  DEFAULT_TAX_PROFILE_ID,
  type Invoice,
  type InvoiceLine,
  type InvoiceStatus,
  type PaymentMethod,
} from '@/lib/borga/data';
import { CURRENCY_SYMBOL } from '@/lib/borga/data';
import { invoiceHtml, openPrintWindow, csvWithHeader, downloadTextFile } from '@/lib/borga/report-template';
import { useBorga } from '@/lib/borga/store';
import { SectionTitle } from '../bits';
import { DateInput, Field, ProjectSelect, AccountSelect, TaxProfilesMultiSelect } from '../form-widgets';
import { cn } from '@/lib/utils';

interface InvoiceForm {
  number: string;
  client: string;
  status: InvoiceStatus;
  issued: string;
  due: string;
  taxProfileIds: string[];
  externalRef?: string;
  paymentMethod: PaymentMethod;
  notes: string;
  description: string;
  lines: InvoiceLine[];
  projectId?: string;
  accountId?: string;
}

// Module-scope helper keeps impure clock access out of component render.
function dueSoonCutoff(): number {
  return Date.now() + 30 * 86400000;
}

let idSeq = 0;
function nextLineId(): string {
  idSeq += 1;
  return `il-${Date.now().toString(36)}-${idSeq}`;
}

function emptyForm(number: string, defaultTaxProfileId?: string): InvoiceForm {
  return {
    number, client: '', status: 'draft',
    issued: new Date().toISOString().slice(0, 10),
    due: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    taxProfileIds: defaultTaxProfileId ? [defaultTaxProfileId] : [], externalRef: '', paymentMethod: 'bank-transfer', notes: '', description: '',
    lines: [
      { id: nextLineId(), description: '', qty: 1, unitPrice: 0 },
      { id: nextLineId(), description: '', qty: 1, unitPrice: 0 },
    ],
  };
}

export function InvoiceTab() {
  const {
    invoices, addInvoice, updateInvoice, deleteInvoice, voidInvoice, payInvoice, runDunningSweep,
    customers, composio, log, activeWorkspace,
    taxProfiles, defaultTaxProfileId,
    settings, addApproval,
  } = useBorga();
  const currency = activeWorkspace()?.currency ?? 'USD';
  const money = (n: number) => `${CURRENCY_SYMBOL[currency]}${fmtNum(n)}`;

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Invoice | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Invoice | null>(null);
  const [payTarget, setPayTarget] = useState<Invoice | null>(null);
  const [payMethod, setPayMethod] = useState<PaymentMethod>('bank-transfer');
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [payExternalRef, setPayExternalRef] = useState('');
  const [emailTarget, setEmailTarget] = useState<Invoice | null>(null);
  const [emailForm, setEmailForm] = useState({ to: '', subject: '', body: '' });
  const [emailState, setEmailState] = useState<'idle' | 'sending' | 'sent' | 'fallback'>('idle');
  const [form, setForm] = useState<InvoiceForm>(() => emptyForm('#2200', DEFAULT_TAX_PROFILE_ID));

  useEffect(() => {
    if (editing) {
      setForm({
        number: editing.number,
        client: editing.client,
        status: editing.status,
        issued: editing.issued,
        due: editing.due,
        taxProfileIds: editing.taxProfileIds ?? (editing.taxProfileId ? [editing.taxProfileId] : []),
        externalRef: editing.externalRef ?? '',
        paymentMethod: editing.paymentMethod ?? 'bank-transfer',
        notes: editing.notes ?? '',
        description: editing.description ?? '',
        lines: editing.lines?.length ? editing.lines : [
          { id: nextLineId(), description: 'Services rendered', qty: 1, unitPrice: editing.amount },
        ],
        projectId: editing.projectId,
        accountId: editing.accountId,
      });
      setPayExternalRef('');
    }
  }, [editing]);

  const openCreate = () => {
    setEditing(null);
    const def = taxProfiles.find((t) => t.id === defaultTaxProfileId) ?? INITIAL_TAX_PROFILES.find((t) => t.id === DEFAULT_TAX_PROFILE_ID);
    setForm(emptyForm(`#${2200 + invoices.length}`, def?.id));
    setCreateOpen(true);
  };

  const formTaxRate = useMemo(
    () => taxProfiles.filter((t) => form.taxProfileIds.includes(t.id)).reduce((s, t) => s + t.rate, 0),
    [taxProfiles, form.taxProfileIds],
  );

  const formTotals = useMemo(() => {
    const subtotal = form.lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0);
    const tax = (subtotal * formTaxRate) / 100;
    return { subtotal, tax, total: subtotal + tax };
  }, [form.lines, formTaxRate]);

  const submit = () => {
    if (!form.client.trim() || form.lines.length === 0) return;
    const lines = form.lines.filter((l) => l.description.trim() || l.unitPrice);
    if (lines.length === 0) return;
    const subtotal = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0);
    const total = subtotal + (subtotal * formTaxRate) / 100;
    const profileNames = taxProfiles.filter((t) => form.taxProfileIds.includes(t.id)).map((t) => t.name).join(' + ');
    const base: Invoice = {
      id: editing?.id ?? `inv-${Date.now().toString(36)}`,
      number: form.number.trim() || `#${2200 + invoices.length}`,
      client: form.client.trim(),
      amount: Math.round(total * 100) / 100,
      status: form.status,
      issued: form.issued,
      due: form.due,
      notes: form.notes.trim() || undefined,
      description: form.description.trim() || undefined,
      lines,
      taxRate: formTaxRate,
      taxProfileIds: form.taxProfileIds,
      taxProfileId: form.taxProfileIds[0],
      taxProfileName: profileNames || undefined,
      externalRef: form.externalRef?.trim() || undefined,
      paymentMethod: form.paymentMethod,
      customerId: editing?.customerId,
      projectId: form.projectId,
      accountId: form.accountId,
    };
    if (editing) {
      updateInvoice(editing.id, base);
      log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'task', message: `Invoice ${base.number} updated — ${lines.length} line(s), total ${money(base.amount)}.` });
    } else {
      addInvoice(base);
      log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'task', message: `Invoice ${base.number} created for ${base.client} — ${lines.length} line(s), total ${money(base.amount)}, settlement via ${PAYMENT_METHOD_LABEL[base.paymentMethod ?? 'bank-transfer']}.` });
    }
    setCreateOpen(false);
    setEditing(null);
  };

  const doPay = () => {
    if (!payTarget) return;
    payInvoice(payTarget.id, payMethod, payDate, payExternalRef.trim() || undefined);
    setPayTarget(null);
    setPayExternalRef('');
  };

  const downloadPdf = (inv: Invoice) => {
    const ws = activeWorkspace();
    if (!ws) return;
    openPrintWindow(invoiceHtml(inv, ws), `Invoice ${inv.number}`);
    log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'sync', message: `Invoice ${inv.number} downloaded as branded PDF.` });
  };

  const openEmail = (inv: Invoice) => {
    setEmailTarget(inv);
    setEmailForm({
      to: customers.find((c) => c.name.toLowerCase() === inv.client.toLowerCase())?.email ?? '',
      subject: `Invoice ${inv.number} from ${activeWorkspace()?.name ?? ''}`,
      body: `Hi ${inv.client},\n\nPlease find invoice ${inv.number} for ${money(inv.amount)} (due ${inv.due}).\n\nSettlement method: ${PAYMENT_METHOD_LABEL[inv.paymentMethod ?? 'bank-transfer']}.\n\nKind regards,\n${activeWorkspace()?.name ?? ''}`,
    });
    setEmailState('idle');
  };

  /** Send via the company's linked Gmail (composio.dev OAuth); falls back to mailto. */
  const sendEmail = async () => {
    const inv = emailTarget;
    if (!inv || !emailForm.to.trim()) return;
    if (settings.autonomousMode) {
      addApproval({
        id: `ap-${Date.now().toString(36)}`,
        title: `Outbound email approval — ${emailForm.to}`,
        description: `Autonomous mode held this email to ${emailForm.to} for sign-off before it leaves the company: "${emailForm.subject}".`,
        category: 'other',
        amount: 0,
        status: 'pending',
        submittedBy: 'Atlas',
        createdAt: new Date().toISOString(),
        pendingSend: { kind: 'invoice-email', targetId: inv.id, to: emailForm.to.trim(), subject: emailForm.subject, body: `${emailForm.body}\n\n—\n${activeWorkspace()?.legalName ?? activeWorkspace()?.name ?? ''} — ${activeWorkspace()?.email ?? ''}` },
      });
      log({ agentId: 'a-sales', agentName: 'Atlas', actor: 'agent', kind: 'system', message: `Email to ${emailForm.to} held for approval before sending — autonomous mode is on.` });
      setEmailTarget(null);
      return;
    }
    setEmailState('sending');
    try {
      const res = await fetch('/api/borga/composio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
        body: JSON.stringify({
          action: 'execute',
          appName: 'GMAIL_SEND_EMAIL',
          entityId: 'workspace-inbox',
          apiKey: composio.apiKey,
          params: {
            recipient_email: emailForm.to.trim(),
            subject: emailForm.subject,
            body: `${emailForm.body}\n\n—\n${activeWorkspace()?.legalName ?? activeWorkspace()?.name ?? ''} — ${activeWorkspace()?.email ?? ''}`,
          },
        }),
      });
      const d = (await res.json()) as { ok?: boolean; error?: string };
      if (d.ok) {
        setEmailState('sent');
        updateInvoice(inv.id, { sentAt: new Date().toISOString(), status: inv.status === 'draft' ? 'sent' : inv.status });
        log({ agentId: 'a-comms', agentName: 'Nova', actor: 'user', kind: 'task', message: `Invoice ${inv.number} emailed to ${emailForm.to} via Gmail (composio.dev).` });
        setTimeout(() => setEmailTarget(null), 1400);
        return;
      }
      throw new Error(d.error ?? 'send failed');
    } catch {
      // Fallback: open the user's mail client with the message pre-filled.
      const ws = activeWorkspace();
      const mailto = `mailto:${encodeURIComponent(emailForm.to)}?subject=${encodeURIComponent(emailForm.subject)}&body=${encodeURIComponent(emailForm.body)}`;
      window.location.href = mailto;
      setEmailState('fallback');
      log({
        agentId: 'a-comms', agentName: 'Nova', actor: 'system', kind: 'system',
        message: `Gmail link unavailable (${ws?.name ?? 'workspace'} has no linked Gmail) — invoice ${inv.number} handed to your mail client instead.`,
      });
    }
  };

  const exportCsv = () => {
    const ws = activeWorkspace();
    if (!ws) return;
    const rows = [
      ['number', 'client', 'issued', 'due', 'subtotal', 'tax_rate', 'tax_profile', 'total', 'external_ref', 'status', 'payment_method', 'paid_at'],
      ...filteredInvoices.map((i) => [
        i.number, i.client, i.issued, i.due,
        String(i.amount), String(i.taxRate ?? 0), i.taxProfileName ?? '', String(i.amount),
        i.externalRef ?? '',
        i.status, PAYMENT_METHOD_LABEL[i.paidMethod ?? i.paymentMethod ?? 'bank-transfer'], i.paidAt ?? '',
      ]),
    ];
    downloadTextFile(`invoices-${new Date().toISOString().slice(0, 10)}.csv`, csvWithHeader(ws, 'Invoice register', `${filteredInvoices.length} invoices`, rows));
    log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'sync', message: `${filteredInvoices.length} invoices exported with company header.` });
  };

  // ── Advanced: stats, search, filters ──────────────────────────────────────
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'draft' | 'paid'>('all');

  const stats = useMemo(() => {
    const unpaid = invoices.filter((i) => i.status === 'sent' || i.status === 'overdue');
    const totalUnpaid = unpaid.reduce((s, i) => s + i.amount, 0);
    const overdueAmount = invoices.filter((i) => i.status === 'overdue').reduce((s, i) => s + i.amount, 0);
    const paid = invoices.filter((i) => i.status === 'paid');
    const nonDraft = invoices.filter((i) => i.status !== 'draft');
    const avgTotal = nonDraft.length ? nonDraft.reduce((s, i) => s + i.amount, 0) / nonDraft.length : 0;
    const soonCutoff = dueSoonCutoff();
    const dueSoon = unpaid.filter((i) => {
      const d = new Date(`${i.due} ${new Date().getFullYear()}`);
      return !Number.isNaN(d.getTime()) && d.getTime() <= soonCutoff;
    });
    return {
      totalUnpaid,
      overdueAmount,
      dueSoonAmount: dueSoon.reduce((s, i) => s + i.amount, 0),
      avgTotal,
      paidCount: paid.length,
      paidAmount: paid.reduce((s, i) => s + i.amount, 0),
    };
  }, [invoices]);

  const filteredInvoices = useMemo(
    () =>
      invoices.filter((i) => {
        if (statusFilter === 'open' && !(i.status === 'sent' || i.status === 'overdue')) return false;
        if (statusFilter === 'draft' && i.status !== 'draft') return false;
        if (statusFilter === 'paid' && i.status !== 'paid') return false;
        if (query && !`${i.number} ${i.client} ${i.issued} ${i.due}`.toLowerCase().includes(query.toLowerCase())) return false;
        return true;
      }),
    [invoices, statusFilter, query],
  );

  return (
    <div className="borga-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle title="Invoicing" sub={`${invoices.length} invoices — ${money(stats.totalUnpaid)} open${stats.overdueAmount ? ` — ${money(stats.overdueAmount)} overdue` : ''}`} />
        <div className="flex gap-2">
          {stats.overdueAmount > 0 && (
            <Button
              variant="outline"
              title="Create chase tasks for every overdue invoice (deduped)"
              onClick={() => {
                const n = runDunningSweep();
                if (!n) log({ agentId: 'a-comms', agentName: 'Nova', actor: 'agent', kind: 'sync', message: 'Dunning sweep: all overdue invoices already have active chase tasks.' });
              }}
            >
              <BellRing className="h-4 w-4" /> Dunning sweep
            </Button>
          )}
          <Button variant="outline" onClick={exportCsv}>
            <Download className="h-4 w-4" /> Export
          </Button>
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> New invoice
          </Button>
        </div>
      </div>

      {/* Stats header */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="p-3">
          <p className="text-[11px] text-muted-foreground">Total unpaid</p>
          <p className="mt-1 text-xl font-semibold">{money(stats.totalUnpaid)}</p>
          {stats.overdueAmount > 0 && <p className="text-[10px] text-rose-500">includes {money(stats.overdueAmount)} overdue</p>}
        </Card>
        <Card className="p-3">
          <p className="text-[11px] text-muted-foreground">Due within 30 days</p>
          <p className="mt-1 text-xl font-semibold">{money(stats.dueSoonAmount)}</p>
        </Card>
        <Card className="p-3">
          <p className="text-[11px] text-muted-foreground">Average invoice total</p>
          <p className="mt-1 text-xl font-semibold">{money(stats.avgTotal)}</p>
          <p className="text-[10px] text-muted-foreground">excludes drafts</p>
        </Card>
        <Card className="p-3">
          <p className="text-[11px] text-muted-foreground">Collected to date</p>
          <p className="mt-1 text-xl font-semibold">{money(stats.paidAmount)}</p>
          <p className="text-[10px] text-muted-foreground">{stats.paidCount} invoices settled</p>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg bg-muted p-1 text-xs">
          {(['all', 'open', 'draft', 'paid'] as const).map((f) => (
            <button key={f} onClick={() => setStatusFilter(f)} className={cn('rounded-md px-4 py-1.5 font-medium capitalize', statusFilter === f ? 'bg-background shadow-sm' : 'text-muted-foreground')}>
              {f}
            </button>
          ))}
        </div>
        <div className="relative ml-auto w-full sm:w-56">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search invoices…" className="pl-8 text-xs" />
        </div>
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-medium">Invoice</th>
              <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Client</th>
              <th className="hidden px-4 py-2.5 font-medium md:table-cell">Issued → Due</th>
              <th className="hidden px-4 py-2.5 font-medium lg:table-cell">Method</th>
              <th className="px-4 py-2.5 text-right font-medium">Amount</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="w-44 px-2 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {filteredInvoices.map((i) => (
              <tr key={i.id} className="border-b last:border-0 hover:bg-muted/20">
                <td className="px-4 py-2.5 font-medium">
                  {i.number}
                  {i.externalRef && <span className="block text-[10px] font-normal text-muted-foreground">ext {i.externalRef}</span>}
                </td>
                <td className="hidden px-4 py-2.5 text-muted-foreground sm:table-cell">{i.client}</td>
                <td className="hidden px-4 py-2.5 text-muted-foreground md:table-cell">{i.issued} → {i.due}</td>
                <td className="hidden px-4 py-2.5 text-xs text-muted-foreground lg:table-cell">
                  {PAYMENT_METHOD_LABEL[i.paidMethod ?? i.paymentMethod ?? 'bank-transfer']}
                  {i.paidAt && <span className="block text-[10px]">paid {new Date(i.paidAt).toLocaleDateString()}</span>}
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-xs">
                  {money(i.amount)}
                  {i.taxProfileName && <span className="block text-[10px] font-normal text-muted-foreground">{i.taxProfileName} {i.taxRate ?? 0}%</span>}
                </td>
                <td className="px-4 py-2.5">
                  <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-semibold ring-1', i.voidedAt ? 'bg-rose-500/10 text-rose-600 ring-rose-500/30' : INVOICE_STATUS_STYLE[i.status])}>{i.voidedAt ? 'voided' : i.status}</span>
                </td>
                <td className="px-2 py-2.5">
                  <div className="flex justify-end gap-0.5">
                    {i.status !== 'paid' && !i.voidedAt && (
                      <button onClick={() => { setPayTarget(i); setPayMethod(i.paymentMethod ?? 'bank-transfer'); setPayDate(new Date().toISOString().slice(0, 10)); }} className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-emerald-500/10 hover:text-emerald-600" title="Mark paid (auto-posts to finance)">
                        <CircleDollarSign className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {!i.voidedAt && (
                      <button onClick={() => openEmail(i)} className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary" title="Email invoice">
                        <Mail className="h-3 w-3" />
                      </button>
                    )}
                    <button onClick={() => downloadPdf(i)} disabled={!!i.voidedAt} className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary disabled:opacity-30" title="Download branded PDF">
                      <Download className="h-3 w-3" />
                    </button>
                    {/* Lock rule: only drafts edit — issued/paid invoices are immutable. */}
                    {i.status === 'draft' ? (
                      <button
                        onClick={() => setEditing(i)}
                        className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary"
                        title="Edit draft invoice"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    ) : null}
                    {/* Lock rule: drafts delete; issued/paid invoices void with audit trace. */}
                    {i.status === 'draft' ? (
                      <button
                        onClick={() => setConfirmDelete(i)}
                        className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        title="Delete draft invoice"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    ) : !i.voidedAt ? (
                      <button
                        onClick={() => { const r = window.prompt(`Void invoice ${i.number}? The record is kept for the audit trail${i.status === 'paid' ? ' and a reversal will be posted' : ''}.`, 'Cancelled by client'); if (r !== null) voidInvoice(i.id, r ?? undefined); }}
                        className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-amber-500/10 hover:text-amber-600"
                        title="Void invoice (kept for audit)"
                      >
                        <Ban className="h-3 w-3" />
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
            {filteredInvoices.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-xs text-muted-foreground">No invoices match.</td></tr>
            )}
          </tbody>
        </table>
      </Card>

      {/* Create / edit dialog with line items */}
      <Dialog open={createOpen || !!editing} onOpenChange={(o) => { if (!o) { setCreateOpen(false); setEditing(null); } }}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit invoice ${editing.number}` : 'New invoice'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Number">
                <Input value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} placeholder="#2223" />
              </Field>
              <Field label="Client *" className="col-span-2">
                <Input list="invoice-customers" value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} placeholder="Acme Industries" />
                <datalist id="invoice-customers">
                  {customers.map((c) => (
                    <option key={c.id} value={c.name} />
                  ))}
                </datalist>
              </Field>
            </div>

            <Field label="Transaction description *" hint="A clear description of what this invoice is for — required for audit-ready, IFRS-aligned records.">
              <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. September freight services — Vancouver–Calgary lane" />
            </Field>

            {/* Line items */}
            <div className="rounded-xl border p-3">
              <div className="grid grid-cols-[1fr_64px_96px_96px_28px] items-center gap-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                <span>Description</span><span className="text-right">Qty</span><span className="text-right">Unit price</span><span className="text-right">Amount</span><span />
              </div>
              <div className="space-y-2">
                {form.lines.map((line, idx) => (
                  <div key={line.id} className="grid grid-cols-[1fr_64px_96px_96px_28px] items-center gap-2">
                    <Input
                      value={line.description}
                      onChange={(e) => setForm({ ...form, lines: form.lines.map((l) => (l.id === line.id ? { ...l, description: e.target.value } : l)) })}
                      placeholder={idx === 0 ? 'e.g. Freight services — Vancouver run' : 'Line description'}
                      className="h-8 text-xs"
                    />
                    <Input
                      type="number" min={0} step="any" value={line.qty}
                      onChange={(e) => setForm({ ...form, lines: form.lines.map((l) => (l.id === line.id ? { ...l, qty: Number(e.target.value) || 0 } : l)) })}
                      className="h-8 text-right text-xs"
                    />
                    <Input
                      type="number" min={0} step="any" value={line.unitPrice}
                      onChange={(e) => setForm({ ...form, lines: form.lines.map((l) => (l.id === line.id ? { ...l, unitPrice: Number(e.target.value) || 0 } : l)) })}
                      className="h-8 text-right text-xs"
                    />
                    <span className="text-right font-mono text-xs">{money((Number(line.qty) || 0) * (Number(line.unitPrice) || 0))}</span>
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, lines: form.lines.filter((l) => l.id !== line.id) })}
                      disabled={form.lines.length <= 1}
                      className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground enabled:hover:text-destructive disabled:opacity-30"
                      title="Remove line"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex items-center justify-between border-t pt-2">
                <Button size="sm" variant="ghost" className="h-7 gap-1" onClick={() => setForm({ ...form, lines: [...form.lines, { id: nextLineId(), description: '', qty: 1, unitPrice: 0 }] })}>
                  <Plus className="h-3 w-3" /> Add line
                </Button>
                <div className="space-y-0.5 text-right text-xs">
                  <p className="text-muted-foreground">Subtotal <span className="ml-2 font-mono text-foreground">{money(formTotals.subtotal)}</span></p>
                  <p className="text-muted-foreground">Tax ({formTaxRate}%) <span className="ml-2 inline-block w-16 font-mono text-foreground">{money(formTotals.tax)}</span></p>
                  <p className="font-semibold">Total <span className="ml-2 inline-block w-20 font-mono">{money(formTotals.total)}</span></p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="Issued">
                <DateInput value={form.issued} onChange={(v) => setForm({ ...form, issued: v })} />
              </Field>
              <Field label="Due">
                <DateInput value={form.due} onChange={(v) => setForm({ ...form, due: v })} />
              </Field>
              <Field label="Status">
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as InvoiceStatus })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="sent">Sent</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="overdue">Overdue</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Payment method">
                <Select value={form.paymentMethod} onValueChange={(v) => setForm({ ...form, paymentMethod: v as PaymentMethod })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((m) => (
                      <SelectItem key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field label="Taxes" hint="Select every tax that applies — rates stack (e.g. GST + PST).">
              <TaxProfilesMultiSelect taxProfiles={taxProfiles} selectedIds={form.taxProfileIds} onChange={(ids) => setForm({ ...form, taxProfileIds: ids })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="GL account" hint="The revenue account this invoice recognizes against.">
                <AccountSelect value={form.accountId} onChange={(v) => setForm({ ...form, accountId: v })} types={['revenue']} />
              </Field>
              <Field label="Project">
                <ProjectSelect value={form.projectId} onChange={(v) => setForm({ ...form, projectId: v })} />
              </Field>
            </div>
            <Field label="External reference">
              <Input value={form.externalRef ?? ''} onChange={(e) => setForm({ ...form, externalRef: e.target.value })} placeholder="PO number, client ref, cheque…" />
            </Field>
            <Field label="Notes">
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Payment terms, bank details, thank-you note…" />
            </Field>
          </div>
          <DialogFooter>
            <Button onClick={submit} disabled={!form.client.trim() || formTotals.total <= 0}>
              <ReceiptText className="mr-1 h-3.5 w-3.5" />
              {editing ? 'Save changes' : 'Create invoice'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mark paid dialog */}
      <Dialog open={!!payTarget} onOpenChange={(o) => { if (!o) setPayTarget(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Record payment — {payTarget?.number}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {payTarget && `${payTarget.client} — ${money(payTarget.amount)}`} — selecting a method automatically posts the receipt to the finance ledger and journal (DR Cash & Bank / CR Accounts Receivable).
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Payment method">
              <Select value={payMethod} onValueChange={(v) => setPayMethod(v as PaymentMethod)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Paid on">
              <DateInput value={payDate} onChange={setPayDate} />
            </Field>
          </div>
          <Field label="External reference">
            <Input value={payExternalRef} onChange={(e) => setPayExternalRef(e.target.value)} placeholder="Cheque / bank txn / receipt no." />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayTarget(null)}>Cancel</Button>
            <Button className="gap-1.5" onClick={doPay}>
              <CircleDollarSign className="h-3.5 w-3.5" /> Post payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Email dialog */}
      <Dialog open={!!emailTarget} onOpenChange={(o) => { if (!o) setEmailTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Email invoice {emailTarget?.number}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="To *">
              <Input type="email" value={emailForm.to} onChange={(e) => setEmailForm({ ...emailForm, to: e.target.value })} placeholder="client@company.com" />
            </Field>
            <Field label="Subject">
              <Input value={emailForm.subject} onChange={(e) => setEmailForm({ ...emailForm, subject: e.target.value })} />
            </Field>
            <Field label="Message">
              <Textarea rows={6} value={emailForm.body} onChange={(e) => setEmailForm({ ...emailForm, body: e.target.value })} />
            </Field>
            <p className="text-[11px] text-muted-foreground">
              Sent through the company&apos;s linked Gmail (composio.dev OAuth). If Gmail isn&apos;t linked, the message opens in your mail client instead.
            </p>
            {emailState === 'sent' && <p className="text-xs font-medium text-emerald-600">Sent — invoice marked as sent.</p>}
            {emailState === 'fallback' && <p className="text-xs font-medium text-amber-600">Opened in your mail client (Gmail not linked for this workspace).</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailTarget(null)}>Cancel</Button>
            <Button className="gap-1.5" onClick={() => void sendEmail()} disabled={!emailForm.to.trim() || emailState === 'sending'}>
              <Send className="h-3.5 w-3.5" /> {emailState === 'sending' ? 'Sending…' : 'Send invoice'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!confirmDelete} onOpenChange={(o) => { if (!o) setConfirmDelete(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete invoice {confirmDelete?.number}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This removes the invoice for {confirmDelete?.client} ({confirmDelete ? money(confirmDelete.amount) : ''}) from the register.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => { if (confirmDelete) { deleteInvoice(confirmDelete.id); log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'system', message: `Invoice ${confirmDelete.number} deleted.` }); } setConfirmDelete(null); }}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
