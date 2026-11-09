// Accrual postings: issuing an invoice books revenue before cash arrives
// (DR Accounts Receivable / CR Revenue / CR Tax Payable); recording a bill
// books the obligation (DR Expense / CR Accounts Payable). Payments settle
// against the same AR/AP accounts, so the subledger always ties to the ledger.
// Pure (no I/O) — tested in lib/accruals.test.ts.
import type { JournalEntry, Invoice } from './data';

export interface CoaRef { id: string; type: string; name: string; isCash?: boolean; }

const uid = (p: string) => `${p}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

function pick(coa: CoaRef[], type: string, re: RegExp): CoaRef | undefined {
  return coa.find((a) => a.type === type && re.test(a.name ?? ''));
}

export interface AccrualAccounts {
  ar: string;
  revenue: string;
  taxPayable: string;
}

export function resolveAccrualAccounts(coa: CoaRef[]): AccrualAccounts | null {
  const ar = pick(coa, 'asset', /receiv/i)?.id;
  const revenue = pick(coa, 'revenue', /./)?.id;
  const taxPayable = pick(coa, 'liability', /tax payable|sales tax|vat|gst/i)?.id
    ?? coa.find((a) => a.type === 'liability')?.id;
  if (!ar || !revenue || !taxPayable) return null;
  return { ar, revenue, taxPayable };
}

function splitTax(total: number, taxRate: number): { net: number; tax: number } {
  const r = Math.max(0, taxRate) / 100;
  const net = Math.round((total / (1 + r)) * 100) / 100;
  return { net, tax: Math.round((total - net) * 100) / 100 };
}

/** Accrual journal for a sent invoice. Null when accounts are missing. Idempotent via externalRef. */
export function accrueInvoice(
  inv: Pick<Invoice, 'id' | 'number' | 'client' | 'amount' | 'issued' | 'taxRate'>,
  coa: CoaRef[],
  dateIso?: string,
): JournalEntry | null {
  const acc = resolveAccrualAccounts(coa);
  if (!acc || !(inv.amount > 0)) return null;
  const { net, tax } = splitTax(inv.amount, inv.taxRate ?? 0);
  return {
    id: uid('je-acc'), date: inv.issued, dateIso: dateIso ?? new Date().toISOString().slice(0, 10),
    memo: `Invoice ${inv.number} issued — ${inv.client}`,
    description: `Accrued revenue for invoice ${inv.number} (${inv.client}). Reversed if voided before payment.`,
    reference: inv.number, status: 'posted', createdAt: new Date().toISOString(),
    externalRef: `invoice:${inv.id}:accrual`, auto: 'accrual',
    lines: [
      { accountId: acc.ar, debit: inv.amount, credit: 0 },
      { accountId: acc.revenue, debit: 0, credit: net },
      ...(tax > 0 ? [{ accountId: acc.taxPayable, debit: 0, credit: tax }] : []),
    ],
  } as unknown as JournalEntry;
}

/** Accrual journal for a recorded bill. Null when accounts are missing. Idempotent via externalRef. */
export function accrueBill(
  bill: { id: string; number: string; vendorName: string; amount: number; accountId?: string; received: string },
  coa: CoaRef[],
): JournalEntry | null {
  if (!(bill.amount > 0)) return null;
  // Prefer a real Accounts Payable account — a bare /payable/ match would grab Sales Tax Payable first.
  const ap = pick(coa, 'liability', /accounts payable/i)?.id
    ?? coa.find((a) => a.type === 'liability' && /payable/i.test(a.name ?? '') && !/tax/i.test(a.name ?? ''))?.id
    ?? coa.find((a) => a.type === 'liability')?.id;
  const expense = (bill.accountId && coa.some((a) => a.id === bill.accountId)
    ? bill.accountId
    : pick(coa, 'expense', /./)?.id ?? pick(coa, 'cost', /./)?.id);
  if (!ap || !expense) return null;
  return {
    id: uid('je-acc'), date: bill.received, dateIso: bill.received,
    memo: `Bill ${bill.number} recorded — ${bill.vendorName}`,
    description: `Accrued obligation for bill ${bill.number} (${bill.vendorName}). Reversed if voided before payment.`,
    reference: bill.number, status: 'posted', createdAt: new Date().toISOString(),
    externalRef: `bill:${bill.id}:accrual`, auto: 'accrual',
    lines: [
      { accountId: expense, debit: bill.amount, credit: 0 },
      { accountId: ap, debit: 0, credit: bill.amount },
    ],
  } as unknown as JournalEntry;
}

/** Reversal of an accrual (void before payment). */
export function reverseAccrual(kind: 'invoice' | 'bill', ref: string, number: string, amount: number, lines: JournalEntry['lines']): JournalEntry {
  return {
    id: uid('je-rev'), date: new Date().toISOString().slice(0, 10), dateIso: new Date().toISOString().slice(0, 10),
    memo: `Reversal — ${kind} ${number} voided before payment`,
    description: `Automatic reversal of the ${kind} accrual for voided ${kind} ${number}.`,
    reference: number, status: 'posted', createdAt: new Date().toISOString(),
    auto: 'reversal', externalRef: ref,
    lines: lines.map((l) => ({ accountId: l.accountId, debit: l.credit, credit: l.debit })),
  } as unknown as JournalEntry;
}

// ── Subledger tie-out ────────────────────────────────────────────────────────
// Open AR should equal posted AR-account debits minus credits from accruals
// less settlements; same for AP. Anything else is a data-integrity flag.

export interface TieOutRow {
  account: 'AR' | 'AP';
  expected: number;
  actual: number;
  diff: number;
  openDocs: number;
}

export function subledgerTieOut(o: {
  invoices: Array<{ status: string; amount: number; voidedAt?: string }>;
  bills: Array<{ status: string; amount: number }>;
  journals: Array<{ status: string; externalRef?: string; lines: Array<{ accountId: string; debit: number; credit: number }> }>;
  arAccountId: string;
  apAccountId: string;
}): { ar: TieOutRow; ap: TieOutRow } {
  const openAr = o.invoices
    .filter((i) => !i.voidedAt && (i.status === 'sent' || i.status === 'overdue'))
    .reduce((t, i) => t + i.amount, 0);
  const openAp = o.bills
    .filter((b) => b.status === 'unpaid' || b.status === 'scheduled')
    .reduce((t, b) => t + b.amount, 0);
  const bal = (id: string) => o.journals
    .filter((j) => j.status === 'posted')
    .flatMap((j) => j.lines)
    .filter((l) => l.accountId === id)
    .reduce((t, l) => t + l.debit - l.credit, 0);
  const arBal = bal(o.arAccountId);
  const apBal = -bal(o.apAccountId); // liability credit-normal → positive owed
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    ar: { account: 'AR', expected: r(openAr), actual: r(arBal), diff: r(arBal - openAr), openDocs: o.invoices.filter((i) => !i.voidedAt && (i.status === 'sent' || i.status === 'overdue')).length },
    ap: { account: 'AP', expected: r(openAp), actual: r(apBal), diff: r(apBal - openAp), openDocs: o.bills.filter((b) => b.status === 'unpaid' || b.status === 'scheduled').length },
  };
}
