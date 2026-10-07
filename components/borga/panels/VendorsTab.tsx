'use client';

import { fmtMoney } from '@/lib/borga/currencies';
import { useMemo, useState } from 'react';
import {
  Plus, Trash2, Pencil, Truck, ReceiptText, CircleDollarSign, Download, Mail, Send, X, Ban,
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
  PAYMENT_TERMS_LABEL, PAYMENT_METHODS, PAYMENT_METHOD_LABEL, computeVendorRisk, VENDOR_RISK_STYLE,
  INITIAL_TAX_PROFILES, DEFAULT_TAX_PROFILE_ID,
  AUTONOMOUS_PAYMENT_APPROVAL_THRESHOLD,
  type Vendor, type Bill, type BillLine, type PaymentTerms, type PaymentMethod,
} from '@/lib/borga/data';
import { useBorga } from '@/lib/borga/store';
import { sendCompanyEmail } from '@/lib/borga/send-mail-client';
import { toast } from '@/lib/toast-bus';
import { findBillDuplicates, type DuplicateFlag } from '@/lib/borga/duplicates';
import { SectionTitle } from '../bits';
import { SearchSelect } from '../SearchSelect';
import { ConfirmDialog } from '../ConfirmDialog';
import { DateInput, Field, ProjectSelect, AccountSelect, TaxProfilesMultiSelect, CountrySelect, CityInput } from '../form-widgets';
import { billHtml, openPrintWindow, csvWithHeader, downloadTextFile } from '@/lib/borga/report-template';
import { cn } from '@/lib/utils';

interface VendorForm {
  name: string; service: string; email: string; phone: string;
  website: string; terms: PaymentTerms; status: 'active' | 'paused'; since: string;
  legalName: string; tradingName: string; addressLine: string; city: string;
  country: string; billingAddress: string; contactName: string; contactEmail: string;
  contactPhone: string; taxNumber: string;
}

interface BillForm {
  vendorId: string; number: string;
  received: string; due: string; status: Bill['status'];
  taxProfileIds: string[]; externalRef?: string;
  paymentMethod: PaymentMethod; notes: string; description: string; lines: BillLine[];
  projectId?: string; accountId?: string;
}

const EMPTY_VENDOR: VendorForm = {
  name: '', service: '', email: '', phone: '', website: '', terms: 'net30', status: 'active', since: '',
  legalName: '', tradingName: '', addressLine: '', city: '', country: '',
  billingAddress: '', contactName: '', contactEmail: '', contactPhone: '', taxNumber: '',
};

let billLineSeq = 0;
const nextBillLine = () => { billLineSeq += 1; return `bl-${Date.now().toString(36)}-${billLineSeq}`; };

function emptyBill(vendorId: string, defaultTaxProfileId?: string): BillForm {
  return {
    vendorId, number: '',
    received: new Date().toISOString().slice(0, 10),
    due: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    status: 'unpaid', taxProfileIds: defaultTaxProfileId ? [defaultTaxProfileId] : [], externalRef: '', paymentMethod: 'bank-transfer', notes: '', description: '',
    lines: [{ id: nextBillLine(), description: '', qty: 1, unitPrice: 0 }],
  };
}

export function VendorsTab() {
  const {
    vendors, addVendor, updateVendor, deleteVendor,
    bills, addBill, updateBill, setBillStatus, deleteBill, voidBill, payBill,
    composio, log, activeWorkspace, activeWorkspaceId,
    taxProfiles, defaultTaxProfileId,
    settings, addApproval,
  } = useBorga();

  const currency = activeWorkspace()?.currency ?? 'USD';
  const money = (n: number) => fmtMoney(n, currency);

  const [vendorDialogOpen, setVendorDialogOpen] = useState(false);
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);
  const [vendorForm, setVendorForm] = useState<VendorForm>(EMPTY_VENDOR);

  const [billDialogOpen, setBillDialogOpen] = useState(false);
  const [editingBill, setEditingBill] = useState<Bill | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<{ kind: 'bill' | 'vendor'; id: string; name: string } | null>(null);
  const [billForm, setBillForm] = useState<BillForm>(() => emptyBill(vendors[0]?.id ?? '', DEFAULT_TAX_PROFILE_ID));

    const [payTarget, setPayTarget] = useState<Bill | null>(null);
  const [payMethod, setPayMethod] = useState<PaymentMethod>('bank-transfer');
  const [confirmDuplicateBill, setConfirmDuplicateBill] = useState<{ data: Omit<Bill, 'id'> & { number: string }; flags: DuplicateFlag[] } | null>(null);  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [payExternalRef, setPayExternalRef] = useState('');
  const [emailTarget, setEmailTarget] = useState<Bill | null>(null);
  const [emailForm, setEmailForm] = useState({ to: '', subject: '', body: '' });
  const [emailState, setEmailState] = useState<'idle' | 'sending' | 'sent' | 'fallback'>('idle');

  const outstanding = bills.filter((b) => b.status !== 'paid').reduce((s, b) => s + b.amount, 0);
  const unpaidCount = bills.filter((b) => b.status === 'unpaid').length;

  const risks = useMemo(
    () => new Map(vendors.map((v) => [v.id, computeVendorRisk(v.id, bills.map((b) => ({ vendorId: b.vendorId, status: b.status, amount: b.amount })))])),
    [vendors, bills],
  );

  const openBill = (b?: Bill) => {
    if (b) {
      setEditingBill(b);
      setBillForm({
        vendorId: b.vendorId, number: b.number,
        received: b.received, due: b.due, status: b.status,
        taxProfileIds: b.taxProfileIds ?? (b.taxProfileId ? [b.taxProfileId] : []),
        externalRef: b.externalRef ?? '',
        paymentMethod: b.paymentMethod ?? 'bank-transfer',
        notes: b.notes ?? '',
        description: b.description ?? '',
        lines: b.lines?.length ? b.lines : [{ id: nextBillLine(), description: 'Services / goods received', qty: 1, unitPrice: b.amount }],
        projectId: b.projectId,
        accountId: b.accountId,
      });
    } else {
      setEditingBill(null);
      const def = taxProfiles.find((t) => t.id === defaultTaxProfileId) ?? INITIAL_TAX_PROFILES.find((t) => t.id === DEFAULT_TAX_PROFILE_ID);
      setBillForm(emptyBill(vendors[0]?.id ?? '', def?.id));
    }
    setBillDialogOpen(true);
  };

  const submitVendor = () => {
    if (!vendorForm.name.trim()) return;
    const extra: Partial<Vendor> = {
      legalName: vendorForm.legalName.trim() || undefined,
      tradingName: vendorForm.tradingName.trim() || undefined,
      addressLine: vendorForm.addressLine.trim() || undefined,
      city: vendorForm.city.trim() || undefined,
      country: vendorForm.country.trim() || undefined,
      billingAddress: vendorForm.billingAddress.trim() || undefined,
      contactName: vendorForm.contactName.trim() || undefined,
      contactEmail: vendorForm.contactEmail.trim() || undefined,
      contactPhone: vendorForm.contactPhone.trim() || undefined,
      taxNumber: vendorForm.taxNumber.trim() || undefined,
    };
    if (editingVendor) {
      const riskLevel = computeVendorRisk(editingVendor.id, bills.map((b) => ({ vendorId: b.vendorId, status: b.status, amount: b.amount }))).level;
      updateVendor(editingVendor.id, {
        name: vendorForm.name.trim(), service: vendorForm.service.trim(),
        email: vendorForm.email.trim(), phone: vendorForm.phone.trim(),
        website: vendorForm.website.trim(), terms: vendorForm.terms, status: vendorForm.status,
        ...extra, riskLevel,
      });
      log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'task', message: `Vendor updated: ${vendorForm.name.trim()} (risk ${riskLevel}).` });
    } else {
      addVendor({
        id: `v-${Date.now()}`,
        name: vendorForm.name.trim(),
        service: vendorForm.service.trim(),
        email: vendorForm.email.trim(),
        phone: vendorForm.phone.trim(),
        website: vendorForm.website.trim(),
        terms: vendorForm.terms,
        status: vendorForm.status,
        since: new Date().toLocaleDateString([], { month: 'short', year: 'numeric' }),
        ...extra,
        riskLevel: 'low',
      });
      log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'task', message: `Vendor onboarded: ${vendorForm.name.trim()} (${PAYMENT_TERMS_LABEL[vendorForm.terms]}).` });
    }
    setVendorDialogOpen(false);
    setEditingVendor(null);
  };

  const billTaxRate = useMemo(
    () => taxProfiles.filter((t) => billForm.taxProfileIds.includes(t.id)).reduce((s, t) => s + t.rate, 0),
    [taxProfiles, billForm.taxProfileIds],
  );

  const billTotals = useMemo(() => {
    const subtotal = billForm.lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0);
    const tax = (subtotal * billTaxRate) / 100;
    return { subtotal, tax, total: subtotal + tax };
  }, [billForm.lines, billTaxRate]);

  const submitBill = () => {
    const vendor = vendors.find((v) => v.id === billForm.vendorId);
    if (!vendor || billTotals.total <= 0) return;
    const lines = billForm.lines.filter((l) => l.description.trim() || l.unitPrice);
    if (lines.length === 0) return;
    const subtotal = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0);
    const total = subtotal + (subtotal * billTaxRate) / 100;
    const profileNames = taxProfiles.filter((t) => billForm.taxProfileIds.includes(t.id)).map((t) => t.name).join(' + ');
    const shared = {
      vendorId: vendor.id, vendorName: vendor.name, number: billForm.number.trim(),
      amount: Math.round(total * 100) / 100, received: billForm.received, due: billForm.due,
      status: billForm.status, lines, taxRate: billTaxRate,
      taxProfileIds: billForm.taxProfileIds,
      taxProfileId: billForm.taxProfileIds[0],
      taxProfileName: profileNames || undefined,
      externalRef: billForm.externalRef?.trim() || undefined,
      notes: billForm.notes.trim() || undefined,
      description: billForm.description.trim() || undefined,
      paymentMethod: billForm.paymentMethod,
      projectId: billForm.projectId,
      accountId: billForm.accountId,
    };
    if (editingBill) {
      updateBill(editingBill.id, shared);
      log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'task', message: `Bill ${billForm.number.trim()} updated — ${lines.length} line(s), total ${money(Math.round(total * 100) / 100)}.` });
    } else {
      const number = shared.number || `BILL-${Date.now().toString().slice(-4)}`;
      const flags = findBillDuplicates({ id: '', vendorId: vendor.id, vendorName: vendor.name, number, amount: shared.amount, received: shared.received, externalRef: shared.externalRef }, bills);
      const exact = flags.find((f) => f.level === 'exact');
      if (exact) {
        toast({ title: 'Duplicate bill blocked', description: exact.message, variant: 'error' });
        log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'system', kind: 'system', message: `Duplicate bill blocked: ${number} from ${vendor.name} — ${exact.message}` });
        return;
      }
      const likely = flags.filter((f) => f.level === 'likely');
      if (likely.length) {
        setConfirmDuplicateBill({ data: { ...shared, number }, flags: likely });
        return;
      }
      addBill({ id: `b-${Date.now()}`, ...shared, number });
      log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'task', message: `Bill recorded from ${vendor.name}: ${money(Math.round(total * 100) / 100)} (${PAYMENT_METHOD_LABEL[billForm.paymentMethod]}).` });
    }
    setBillDialogOpen(false);
    setEditingBill(null);
  };

  const doConfirmDuplicateBill = () => {
    const p = confirmDuplicateBill;
    if (!p) return;
    addBill({ id: `b-${Date.now()}`, ...p.data });
    addApproval({
      id: `ap-${Date.now().toString(36)}`,
      title: `Possible duplicate bill — review ${p.data.number} (${p.data.vendorName})`,
      description: `Recorded despite matching ${p.flags.map((f) => f.matchLabel).join('; ')} for ${money(p.data.amount)}. Please confirm it is a separate bill, not a double entry.`,
      category: 'spend',
      amount: p.data.amount,
      status: 'pending',
      submittedBy: 'Sage',
      createdAt: new Date().toISOString(),
    });
    log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'system', message: `Bill ${p.data.number} recorded over a duplicate warning — routed to the approval queue for review.` });
    setConfirmDuplicateBill(null);
    setBillDialogOpen(false);
    setEditingBill(null);
  };

  const doPay = () => {
    if (!payTarget) return;
    if (settings.autonomousMode && payTarget.amount >= AUTONOMOUS_PAYMENT_APPROVAL_THRESHOLD) {
      addApproval({
        id: `ap-${Date.now().toString(36)}`,
        title: `Payment approval — ${payTarget.vendorName} (${payTarget.number})`,
        description: `Autonomous mode held this ${money(payTarget.amount)} payment to ${payTarget.vendorName} for sign-off before it leaves the company.`,
        category: 'spend',
        amount: payTarget.amount,
        status: 'pending',
        submittedBy: 'Sage',
        createdAt: new Date().toISOString(),
        pendingPayment: { kind: 'bill', targetId: payTarget.id, method: payMethod, paidOnIso: payDate, externalRef: payExternalRef.trim() || undefined },
      });
      log({ agentId: 'a-finance', agentName: 'Sage', actor: 'agent', kind: 'system', message: `Payment to ${payTarget.vendorName} (${money(payTarget.amount)}) held for approval — autonomous mode is on.` });
    } else {
      payBill(payTarget.id, payMethod, payDate, payExternalRef.trim() || undefined);
    }
    setPayTarget(null);
    setPayExternalRef('');
  };

  const downloadPdf = (b: Bill) => {
    const ws = activeWorkspace();
    if (!ws) return;
    openPrintWindow(billHtml(b, ws), `Bill ${b.number}`);
    log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'sync', message: `Bill ${b.number} downloaded as branded PDF.` });
  };

  const openEmail = (b: Bill) => {
    const v = vendors.find((x) => x.id === b.vendorId);
    setEmailTarget(b);
    setEmailForm({
      to: v?.email ?? '',
      subject: `Remittance advice — Bill ${b.number} from ${activeWorkspace()?.name ?? ''}`,
      body: `Hi ${b.vendorName},\n\nPlease find remittance for bill ${b.number} in the amount of ${money(b.amount)} (due ${b.due}).\n\nSettlement method: ${PAYMENT_METHOD_LABEL[b.paymentMethod ?? 'bank-transfer']}.\n\nRegards,\n${activeWorkspace()?.name ?? ''}`,
    });
    setEmailState('idle');
  };

  const sendEmail = async () => {
    const b = emailTarget;
    if (!b || !emailForm.to.trim()) return;
    if (settings.autonomousMode) {
      addApproval({
        id: `ap-${Date.now().toString(36)}`,
        title: `Outbound email approval — ${emailForm.to}`,
        description: `Autonomous mode held this remittance to ${emailForm.to} for sign-off before it leaves the company: "${emailForm.subject}".`,
        category: 'other',
        amount: 0,
        status: 'pending',
        submittedBy: 'Nova',
        createdAt: new Date().toISOString(),
        pendingSend: { kind: 'bill-email', targetId: b.id, to: emailForm.to.trim(), subject: emailForm.subject, body: `${emailForm.body}\n\n—\n${activeWorkspace()?.legalName ?? activeWorkspace()?.name ?? ''} — ${activeWorkspace()?.email ?? ''}` },
      });
      log({ agentId: 'a-comms', agentName: 'Nova', actor: 'agent', kind: 'system', message: `Email to ${emailForm.to} held for approval before sending — autonomous mode is on.` });
      setEmailTarget(null);
      return;
    }
    setEmailState('sending');
    try {
      const r = await sendCompanyEmail({
        ws: activeWorkspaceId, to: emailForm.to, subject: emailForm.subject, composioKey: composio.apiKey,
        body: `${emailForm.body}\n\n—\n${activeWorkspace()?.legalName ?? activeWorkspace()?.name ?? ''} — ${activeWorkspace()?.email ?? ''}`,
      });
      if (r.ok) {
        setEmailState('sent');
        updateBill(b.id, { status: b.status === 'unpaid' ? 'scheduled' : b.status });
        log({ agentId: 'a-comms', agentName: 'Nova', actor: 'user', kind: 'task', message: `Bill ${b.number} remittance emailed to ${emailForm.to} via ${r.via ?? 'Gmail'}.` });
        setTimeout(() => setEmailTarget(null), 1400);
        return;
      }
      throw new Error(r.note ?? 'send failed');
    } catch {
      const ws = activeWorkspace();
      window.location.href = `mailto:${encodeURIComponent(emailForm.to)}?subject=${encodeURIComponent(emailForm.subject)}&body=${encodeURIComponent(emailForm.body)}`;
      setEmailState('fallback');
      log({ agentId: 'a-comms', agentName: 'Nova', actor: 'system', kind: 'system', message: `Gmail link unavailable (${ws?.name ?? 'workspace'} has no linked Gmail) — bill ${b.number} handed to your mail client.` });
    }
  };

  const exportCsv = () => {
    const ws = activeWorkspace();
    if (!ws) return;
    const rows = [
      ['number', 'vendor', 'received', 'due', 'subtotal', 'tax_rate', 'tax_profile', 'total', 'external_ref', 'status', 'payment_method', 'paid_at'],
      ...bills.map((b) => [
        b.number, b.vendorName, b.received, b.due,
        String(b.amount), String(b.taxRate ?? 0), b.taxProfileName ?? '', String(b.amount),
        b.externalRef ?? '',
        b.status, PAYMENT_METHOD_LABEL[b.paidMethod ?? b.paymentMethod ?? 'bank-transfer'], b.paidAt ?? '',
      ]),
    ];
    downloadTextFile(`bills-${new Date().toISOString().slice(0, 10)}.csv`, csvWithHeader(ws, 'Payables register', `${bills.length} bills`, rows));
    log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'sync', message: `${bills.length} bills exported with company header.` });
  };

  return (
    <div className="borga-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle title="Vendors & payables" sub={`${vendors.length} vendors — ${money(outstanding)} outstanding across ${unpaidCount} unpaid bill${unpaidCount === 1 ? '' : 's'}`} />
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCsv}>
            <Download className="h-4 w-4" /> Export
          </Button>
          <Button variant="outline" onClick={() => openBill()}>
            <ReceiptText className="h-4 w-4" /> New bill
          </Button>
          <Button onClick={() => { setEditingVendor(null); setVendorForm(EMPTY_VENDOR); setVendorDialogOpen(true); }}>
            <Plus className="h-4 w-4" /> New vendor
          </Button>
        </div>
      </div>

      {/* AP summary */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-3">
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><CircleDollarSign className="h-3.5 w-3.5" /> Outstanding AP</p>
          <p className="mt-1 text-xl font-semibold">{money(outstanding)}</p>
        </Card>
        <Card className="p-3">
          <p className="text-[11px] text-muted-foreground">Scheduled</p>
          <p className="mt-1 text-xl font-semibold">{money(bills.filter((b) => b.status === 'scheduled').reduce((s, b) => s + b.amount, 0))}</p>
        </Card>
        <Card className="p-3">
          <p className="text-[11px] text-muted-foreground">Paid to date</p>
          <p className="mt-1 text-xl font-semibold">{money(bills.filter((b) => b.status === 'paid').reduce((s, b) => s + b.amount, 0))}</p>
        </Card>
      </div>

      {/* Bills */}
      <Card className="overflow-hidden">
        <div className="border-b bg-muted/40 px-4 py-2.5">
          <p className="text-sm font-semibold">Bills</p>
        </div>
        <table className="w-full text-sm">
          <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Vendor</th>
              <th className="hidden px-4 py-2 font-medium sm:table-cell">Number</th>
              <th className="hidden px-4 py-2 font-medium md:table-cell">Received → Due</th>
              <th className="hidden px-4 py-2 font-medium lg:table-cell">Method</th>
              <th className="px-4 py-2 text-right font-medium">Amount</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="w-16 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {bills.map((b) => {
              const risk = risks.get(b.vendorId);
              return (
                <tr key={b.id} className="border-b last:border-0 hover:bg-muted/20">
                  <td className="px-4 py-2.5">
                    <p className="font-medium">{b.vendorName}</p>
                    {risk && risk.level !== 'low' && (
                      <span className={cn('mt-0.5 inline-block rounded px-1 py-0.5 text-[9px] font-semibold ring-1', VENDOR_RISK_STYLE[risk.level])}>
                        {risk.level} risk
                      </span>
                    )}
                  </td>
                  <td className="hidden px-4 py-2.5 text-muted-foreground sm:table-cell">
                    <span className={cn(b.voidedAt && 'line-through opacity-50')}>{b.number}</span>
                    {b.voidedAt && <span className="ml-1 inline-block rounded bg-rose-500/10 px-1 py-0.5 text-[9px] font-semibold uppercase text-rose-600 ring-1 ring-rose-500/30">voided</span>}
                    {b.externalRef && <span className="block text-[10px] font-normal text-muted-foreground">ext {b.externalRef}</span>}
                  </td>
                  <td className="hidden px-4 py-2.5 text-muted-foreground md:table-cell">{b.received} → {b.due}</td>
                  <td className="hidden px-4 py-2.5 text-xs text-muted-foreground lg:table-cell">
                    {PAYMENT_METHOD_LABEL[b.paidMethod ?? b.paymentMethod ?? 'bank-transfer']}
                    {b.paidAt && <span className="block text-[10px]">paid {new Date(b.paidAt).toLocaleDateString()}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs">
                    {money(b.amount)}
                    {b.taxProfileName && <span className="block text-[10px] font-normal text-muted-foreground">{b.taxProfileName} {b.taxRate ?? 0}%</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <Select value={b.status} onValueChange={(v) => setBillStatus(b.id, v as Bill['status'])}>
                      <SelectTrigger className={cn(
                        'h-6 w-24 border-0 bg-transparent px-1.5 py-0.5 text-[10px] font-semibold shadow-none outline-none [&>svg]:hidden',
                        b.status === 'paid'
                          ? 'bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/30'
                          : b.status === 'scheduled'
                            ? 'bg-sky-500/10 text-sky-600 ring-1 ring-sky-500/30'
                            : 'bg-amber-500/10 text-amber-600 ring-1 ring-amber-500/30',
                      )}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unpaid">unpaid</SelectItem>
                        <SelectItem value="scheduled">scheduled</SelectItem>
                        <SelectItem value="paid">paid</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="flex justify-end gap-0.5">
                      {/* Lock rule: only unpaid drafts delete — scheduled/paid void with audit trace. */}
                      {b.status === 'unpaid' && !b.voidedAt && (
                        <button
                          onClick={() => setConfirmTarget({ kind: 'bill', id: b.id, name: b.number })}
                          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          title="Delete draft bill"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                      {b.status !== 'unpaid' && !b.voidedAt && (
                        <button
                          onClick={() => { const r = window.prompt(`Void bill ${b.number}? The record is kept for the audit trail.`, 'Duplicate entry'); if (r !== null) voidBill(b.id, r ?? undefined); }}
                          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-amber-500/10 hover:text-amber-600"
                          title="Void bill (kept for audit)"
                        >
                          <Ban className="h-3 w-3" />
                        </button>
                      )}
                      {b.status !== 'paid' && !b.voidedAt && (
                        <button
                          onClick={() => { setPayTarget(b); setPayMethod(b.paymentMethod ?? 'bank-transfer'); setPayDate(new Date().toISOString().slice(0, 10)); }}
                          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-emerald-500/10 hover:text-emerald-600"
                          title="Mark paid (auto-posts to finance)"
                        >
                          <CircleDollarSign className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button onClick={() => openEmail(b)} className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary" title="Email remittance">
                        <Mail className="h-3 w-3" />
                      </button>
                      <button onClick={() => downloadPdf(b)} className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary" title="Download branded PDF">
                        <Download className="h-3 w-3" />
                      </button>
                      <button onClick={() => openBill(b)} disabled={!!b.voidedAt} className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary disabled:opacity-30" title={b.voidedAt ? 'Voided bills are immutable' : 'Edit bill'}>
                        <Pencil className="h-3 w-3" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {bills.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-xs text-muted-foreground">No bills recorded.</td></tr>
            )}
          </tbody>
        </table>
      </Card>

      {/* Vendors */}
      <Card className="overflow-hidden">
        <div className="border-b bg-muted/40 px-4 py-2.5">
          <p className="flex items-center gap-1.5 text-sm font-semibold"><Truck className="h-3.5 w-3.5" /> Vendor directory</p>
        </div>
        <table className="w-full text-sm">
          <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Vendor</th>
              <th className="hidden px-4 py-2 font-medium md:table-cell">Service</th>
              <th className="hidden px-4 py-2 font-medium lg:table-cell">Contact</th>
              <th className="px-4 py-2 font-medium">Terms</th>
              <th className="px-4 py-2 font-medium">Risk</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="w-16 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {vendors.map((v) => {
              const vendorBills = bills.filter((b) => b.vendorId === v.id && b.status !== 'paid');
              const r = risks.get(v.id);
              return (
                <tr key={v.id} className="border-b last:border-0 hover:bg-muted/20">
                  <td className="px-4 py-2.5">
                    <p className="font-medium">{v.name}</p>
                    <p className="text-[11px] text-muted-foreground">since {v.since}{vendorBills.length ? ` — ${money(vendorBills.reduce((s, b) => s + b.amount, 0))} open` : ''}</p>
                  </td>
                  <td className="hidden px-4 py-2.5 text-muted-foreground md:table-cell">{v.service}</td>
                  <td className="hidden px-4 py-2.5 text-muted-foreground lg:table-cell">
                    <p>{v.email}</p>
                    <p className="text-[11px]">{v.phone}</p>
                  </td>
                  <td className="px-4 py-2.5">
                    <Select value={v.terms} onValueChange={(val) => updateVendor(v.id, { terms: val as PaymentTerms })}>
                      <SelectTrigger className="h-7 w-[110px] text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(Object.keys(PAYMENT_TERMS_LABEL) as PaymentTerms[]).map((t) => (
                          <SelectItem key={t} value={t}>{PAYMENT_TERMS_LABEL[t]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 py-2.5">
                    {r ? (
                      <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium ring-1', VENDOR_RISK_STYLE[r.level])}>
                        {r.level} — {Math.round(r.overdueShare * 100)}%
                      </span>
                    ) : '…'}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={cn(
                      'rounded-full px-2 py-0.5 text-[10px] font-medium ring-1',
                      v.status === 'active' ? 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/30' : 'bg-muted text-muted-foreground ring-border',
                    )}>
                      {v.status}
                    </span>
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="flex justify-end gap-0.5">
                      <button onClick={() => { setEditingVendor(v); setVendorForm({ name: v.name, service: v.service, email: v.email, phone: v.phone, website: v.website, terms: v.terms, status: v.status, since: v.since, legalName: v.legalName ?? '', tradingName: v.tradingName ?? '', addressLine: v.addressLine ?? '', city: v.city ?? '', country: v.country ?? '', billingAddress: v.billingAddress ?? '', contactName: v.contactName ?? '', contactEmail: v.contactEmail ?? '', contactPhone: v.contactPhone ?? '', taxNumber: v.taxNumber ?? '' }); setVendorDialogOpen(true); }} className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary" title="Edit vendor">
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button onClick={() => setConfirmTarget({ kind: 'vendor', id: v.id, name: v.name })} className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Remove vendor">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {vendors.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-xs text-muted-foreground">No vendors yet.</td></tr>
            )}
          </tbody>
        </table>
      </Card>

      {/* Vendor dialog */}
      <Dialog open={vendorDialogOpen} onOpenChange={(o) => { setVendorDialogOpen(o); if (!o) setEditingVendor(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingVendor ? `Edit ${editingVendor.name}` : 'New vendor'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Vendor name *</label>
                <Input value={vendorForm.name} onChange={(e) => setVendorForm({ ...vendorForm, name: e.target.value })} placeholder="Acme Supplies" className="mt-1" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Service / category</label>
                <Input value={vendorForm.service} onChange={(e) => setVendorForm({ ...vendorForm, service: e.target.value })} placeholder="Office supplies" className="mt-1" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Email</label>
                <Input type="email" value={vendorForm.email} onChange={(e) => setVendorForm({ ...vendorForm, email: e.target.value })} placeholder="ap@acme.com" className="mt-1" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Phone</label>
                <Input value={vendorForm.phone} onChange={(e) => setVendorForm({ ...vendorForm, phone: e.target.value })} placeholder="+1 555 0400" className="mt-1" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Website</label>
                <Input value={vendorForm.website} onChange={(e) => setVendorForm({ ...vendorForm, website: e.target.value })} placeholder="acme.com" className="mt-1" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Payment terms</label>
                <Select value={vendorForm.terms} onValueChange={(v) => setVendorForm({ ...vendorForm, terms: v as PaymentTerms })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PAYMENT_TERMS_LABEL) as PaymentTerms[]).map((t) => (
                      <SelectItem key={t} value={t}>{PAYMENT_TERMS_LABEL[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Status</label>
                <Select value={vendorForm.status} onValueChange={(v) => setVendorForm({ ...vendorForm, status: v as VendorForm['status'] })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="paused">Paused</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Legal name</label>
                <Input value={vendorForm.legalName} onChange={(e) => setVendorForm({ ...vendorForm, legalName: e.target.value })} placeholder="Acme Supplies Inc." className="mt-1" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Trading name</label>
                <Input value={vendorForm.tradingName} onChange={(e) => setVendorForm({ ...vendorForm, tradingName: e.target.value })} placeholder="Acme" className="mt-1" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Address</label>
              <Input value={vendorForm.addressLine} onChange={(e) => setVendorForm({ ...vendorForm, addressLine: e.target.value })} placeholder="123 Market St, Suite 400" className="mt-1" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">City</label>
                <div className="mt-1"><CityInput country={vendorForm.country} value={vendorForm.city} onChange={(v) => setVendorForm({ ...vendorForm, city: v })} /></div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Country</label>
                <div className="mt-1"><CountrySelect value={vendorForm.country} onChange={(v) => setVendorForm({ ...vendorForm, country: v, city: '' })} /></div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Tax number</label>
                <Input value={vendorForm.taxNumber} onChange={(e) => setVendorForm({ ...vendorForm, taxNumber: e.target.value })} placeholder="VAT / GST" className="mt-1" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Billing address (if different)</label>
              <Input value={vendorForm.billingAddress} onChange={(e) => setVendorForm({ ...vendorForm, billingAddress: e.target.value })} placeholder="PO Box 9001, Springfield" className="mt-1" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Contact person</label>
                <Input value={vendorForm.contactName} onChange={(e) => setVendorForm({ ...vendorForm, contactName: e.target.value })} placeholder="Jordan Lee" className="mt-1" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Contact email</label>
                <Input type="email" value={vendorForm.contactEmail} onChange={(e) => setVendorForm({ ...vendorForm, contactEmail: e.target.value })} placeholder="ap@acme.com" className="mt-1" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Contact phone</label>
                <Input value={vendorForm.contactPhone} onChange={(e) => setVendorForm({ ...vendorForm, contactPhone: e.target.value })} placeholder="+1 555 0100" className="mt-1" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={submitVendor} disabled={!vendorForm.name.trim()}>
              {editingVendor ? 'Save changes' : 'Add vendor'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bill dialog */}
      <Dialog open={billDialogOpen} onOpenChange={(o) => { setBillDialogOpen(o); if (!o) setEditingBill(null); }}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingBill ? `Edit bill ${editingBill.number}` : 'Record a bill'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Vendor *" className="col-span-2">
                <SearchSelect
                  options={vendors.map((v) => ({ value: v.id, label: v.name, detail: v.service }))}
                  value={billForm.vendorId}
                  onChange={(v) => setBillForm({ ...billForm, vendorId: v })}
                  placeholder="Choose…"
                  searchPlaceholder="Search vendors"
                  clearable={false}
                />
              </Field>
              <Field label="Bill number">
                <Input value={billForm.number} onChange={(e) => setBillForm({ ...billForm, number: e.target.value })} placeholder="BILL-1001" />
              </Field>
            </div>

            <Field label="Transaction description *" hint="A clear description of what this bill is for — required for audit-ready, IFRS-aligned records.">
              <Textarea rows={2} value={billForm.description} onChange={(e) => setBillForm({ ...billForm, description: e.target.value })} placeholder="e.g. August cloud hosting — AWS production environment" />
            </Field>

            {/* Line items */}
            <div className="rounded-xl border p-3">
              <div className="grid grid-cols-[1fr_64px_96px_96px_28px] items-center gap-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                <span>Description</span><span className="text-right">Qty</span><span className="text-right">Unit price</span><span className="text-right">Amount</span><span />
              </div>
              <div className="space-y-2">
                {billForm.lines.map((line, idx) => (
                  <div key={line.id} className="grid grid-cols-[1fr_64px_96px_96px_28px] items-center gap-2">
                    <Input value={line.description} onChange={(e) => setBillForm({ ...billForm, lines: billForm.lines.map((l) => (l.id === line.id ? { ...l, description: e.target.value } : l)) })} placeholder={idx === 0 ? 'e.g. Cloud hosting — August' : 'Line description'} className="h-8 text-xs" />
                    <Input type="number" min={0} step="any" value={line.qty} onChange={(e) => setBillForm({ ...billForm, lines: billForm.lines.map((l) => (l.id === line.id ? { ...l, qty: Number(e.target.value) || 0 } : l)) })} className="h-8 text-right text-xs" />
                    <Input type="number" min={0} step="any" value={line.unitPrice} onChange={(e) => setBillForm({ ...billForm, lines: billForm.lines.map((l) => (l.id === line.id ? { ...l, unitPrice: Number(e.target.value) || 0 } : l)) })} className="h-8 text-right text-xs" />
                    <span className="text-right font-mono text-xs">{money((Number(line.qty) || 0) * (Number(line.unitPrice) || 0))}</span>
                    <button type="button" onClick={() => setBillForm({ ...billForm, lines: billForm.lines.filter((l) => l.id !== line.id) })} disabled={billForm.lines.length <= 1} className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground enabled:hover:text-destructive disabled:opacity-30" title="Remove line">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex items-center justify-between border-t pt-2">
                <Button size="sm" variant="ghost" className="h-7 gap-1" onClick={() => setBillForm({ ...billForm, lines: [...billForm.lines, { id: nextBillLine(), description: '', qty: 1, unitPrice: 0 }] })}>
                  <Plus className="h-3 w-3" /> Add line
                </Button>
                <div className="space-y-0.5 text-right text-xs">
                  <p className="text-muted-foreground">Subtotal <span className="ml-2 font-mono text-foreground">{money(billTotals.subtotal)}</span></p>
                  <p className="text-muted-foreground">Tax ({billTaxRate}%) <span className="ml-2 inline-block w-16 font-mono text-foreground">{money(billTotals.tax)}</span></p>
                  <p className="font-semibold">Total <span className="ml-2 inline-block w-20 font-mono">{money(billTotals.total)}</span></p>
                </div>
              </div>
            </div>

            <Field label="Taxes" hint="Select every tax that applies — rates stack (e.g. GST + PST).">
              <TaxProfilesMultiSelect taxProfiles={taxProfiles} selectedIds={billForm.taxProfileIds} onChange={(ids) => setBillForm({ ...billForm, taxProfileIds: ids })} />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="GL account" hint="The expense/cost account this bill posts against.">
                <AccountSelect value={billForm.accountId} onChange={(v) => setBillForm({ ...billForm, accountId: v })} types={['expense', 'cost']} />
              </Field>
              <Field label="Project">
                <ProjectSelect value={billForm.projectId} onChange={(v) => setBillForm({ ...billForm, projectId: v })} />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="Received">
                <DateInput value={billForm.received} onChange={(v) => setBillForm({ ...billForm, received: v })} />
              </Field>
              <Field label="Due">
                <DateInput value={billForm.due} onChange={(v) => setBillForm({ ...billForm, due: v })} />
              </Field>
              <Field label="Status">
                <Select value={billForm.status} onValueChange={(v) => setBillForm({ ...billForm, status: v as Bill['status'] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unpaid">Unpaid</SelectItem>
                    <SelectItem value="scheduled">Scheduled</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Payment method">
                <Select value={billForm.paymentMethod} onValueChange={(v) => setBillForm({ ...billForm, paymentMethod: v as PaymentMethod })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((m) => (
                      <SelectItem key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field label="Notes">
              <Textarea rows={2} value={billForm.notes} onChange={(e) => setBillForm({ ...billForm, notes: e.target.value })} placeholder="Payment terms, PO number, thank-you note…" />
            </Field>
            <Field label="External reference">
              <Input value={billForm.externalRef ?? ''} onChange={(e) => setBillForm({ ...billForm, externalRef: e.target.value })} placeholder="Vendor invoice no., PO, cheque…" />
            </Field>
          </div>
          <DialogFooter>
            <Button onClick={submitBill} disabled={!billForm.vendorId || billTotals.total <= 0}>
              <ReceiptText className="mr-1 h-3.5 w-3.5" />
              {editingBill ? 'Save changes' : 'Record bill'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pay dialog */}
      <Dialog open={!!payTarget} onOpenChange={(o) => { if (!o) setPayTarget(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Record payment — {payTarget?.number}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {payTarget && `${payTarget.vendorName} — ${money(payTarget.amount)}`} — selecting a method automatically posts the payment to the finance ledger and journal (DR Accounts Payable / CR Cash & Bank).
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
            <DialogTitle>Email remittance — {emailTarget?.number}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="To *">
              <Input type="email" value={emailForm.to} onChange={(e) => setEmailForm({ ...emailForm, to: e.target.value })} placeholder="vendor@company.com" />
            </Field>
            <Field label="Subject">
              <Input value={emailForm.subject} onChange={(e) => setEmailForm({ ...emailForm, subject: e.target.value })} />
            </Field>
            <Field label="Message">
              <Textarea rows={6} value={emailForm.body} onChange={(e) => setEmailForm({ ...emailForm, body: e.target.value })} />
            </Field>
            <p className="text-[11px] text-muted-foreground">
              Sent through the company&apos;s Gmail, or its own mail server (SMTP) when Gmail isn&apos;t linked. If neither is set up, the message opens in your mail client instead.
            </p>
            {emailState === 'sent' && <p className="text-xs font-medium text-emerald-600">Remittance emailed — bill marked scheduled. The payment itself still needs to be made.</p>}
            {emailState === 'fallback' && <p className="text-xs font-medium text-amber-600">Opened in your mail client (Gmail not linked for this workspace).</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailTarget(null)}>Cancel</Button>
            <Button className="gap-1.5" onClick={() => void sendEmail()} disabled={!emailForm.to.trim() || emailState === 'sending'}>
              <Send className="h-3.5 w-3.5" /> {emailState === 'sending' ? 'Sending…' : 'Send remittance'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirmTarget}
        onOpenChange={(o) => { if (!o) setConfirmTarget(null); }}
        title={confirmTarget?.kind === 'bill' ? `Delete bill ${confirmTarget?.name ?? ''}?` : `Remove vendor "${confirmTarget?.name ?? ''}"?`}
        description={confirmTarget?.kind === 'bill'
          ? 'The unpaid draft bill is removed. Scheduled and paid bills void with an audit trail instead.'
          : (() => {
              const open = bills.filter((b) => b.vendorId === confirmTarget?.id && b.status !== 'paid');
              return open.length
                ? `${confirmTarget?.name ?? 'The vendor'} has ${open.length} open bill${open.length !== 1 ? 's' : ''} — they lose their vendor link. The vendor is removed anyway.`
                : 'The vendor is removed. Paid bill history keeps the name for reference.';
            })()}
        confirmLabel={confirmTarget?.kind === 'bill' ? 'Delete bill' : 'Remove vendor'}
        onConfirm={() => {
          if (!confirmTarget) return;
          if (confirmTarget.kind === 'bill') {
            if (deleteBill(confirmTarget.id)) log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'system', message: `Bill ${confirmTarget.name} deleted.` });
          } else {
            deleteVendor(confirmTarget.id);
            log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'system', message: `Vendor ${confirmTarget.name} removed.` });
          }
          setConfirmTarget(null);
        }}
      />

      <ConfirmDialog
        open={!!confirmDuplicateBill}
        onOpenChange={(o) => { if (!o) setConfirmDuplicateBill(null); }}
        title="Possible duplicate bill — record anyway?"
        description={confirmDuplicateBill ? `This looks like ${confirmDuplicateBill.flags.map((f) => f.matchLabel).join('; ')} for ${money(confirmDuplicateBill.data.amount)}. Recording it raises a review approval so someone confirms it is a separate bill.` : ''}
        confirmLabel="Record + flag for review"
        onConfirm={doConfirmDuplicateBill}
      />
    </div>
  );
}
