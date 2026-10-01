import type { Bill, BillLine, Invoice, InvoiceLine, PaymentMethod, PaymentTerms, TaxProfile } from './data';

/**
 * Recurring sales invoices: pure scheduling + invoice building (no store, no I/O).
 *
 * Occurrence n (0-based) falls at start + n * every <unit>. Computing from the anchor,
 * not from the previous run, keeps a "31st of the month" schedule on the 31st whenever the
 * month has one (Jan 31 -> Feb 28 -> Mar 31) instead of drifting to the 28th forever.
 * `generatedCount` is the number of occurrences already produced, so a missed stretch
 * is caught up in order and a re-run never duplicates one.
 */

export type RecurringFrequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly';
export type RecurringStatus = 'active' | 'paused' | 'ended';

export const FREQUENCY_LABEL: Record<RecurringFrequency, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
};

/** The schedule part shared by recurring invoices and recurring bills. */
export interface RecurringSchedule {
  status: RecurringStatus;
  frequency: RecurringFrequency;
  /** Every N units (every 2 weeks, every 3 months, ...). */
  every: number;
  /** ISO date of the first occurrence. */
  startDateIso: string;
  /** Stop after this date (inclusive). */
  endDateIso?: string;
  /** Stop after this many documents. */
  maxOccurrences?: number;
  generatedCount: number;
  lastGeneratedIso?: string;
}

export interface RecurringInvoice extends RecurringSchedule {
  id: string;
  name: string;
  client: string;
  customerId?: string;
  projectId?: string;
  accountId?: string;
  lines: InvoiceLine[];
  taxProfileIds: string[];
  paymentMethod: PaymentMethod;
  notes?: string;
  description?: string;
  /** Payment terms: due date = issue date + dueDays. */
  dueDays: number;
  createdAt: string;
}

const DAY = 86_400_000;

const parse = (iso: string): { y: number; m: number; d: number } => {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m: m - 1, d };
};
const fmt = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number): number => Date.UTC(y, m, d);
const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** ISO date + whole days. */
export function addDays(iso: string, days: number): string {
  const { y, m, d } = parse(iso);
  return fmt(utc(y, m, d) + days * DAY);
}

/** Date of occurrence `n` (0-based). */
export function occurrenceDate(startIso: string, frequency: RecurringFrequency, every: number, n: number): string {
  const { y, m, d } = parse(startIso);
  if (frequency === 'weekly') return fmt(utc(y, m, d) + n * every * 7 * DAY);
  const months = (frequency === 'monthly' ? 1 : frequency === 'quarterly' ? 3 : 12) * every * n;
  const total = y * 12 + m + months;
  const ty = Math.floor(total / 12);
  const tm = total % 12;
  return fmt(utc(ty, tm, Math.min(d, daysInMonth(ty, tm))));
}

/** True once no further occurrence may be generated. */
export function isFinished(rec: Pick<RecurringInvoice, 'generatedCount' | 'maxOccurrences' | 'endDateIso' | 'startDateIso' | 'frequency' | 'every'>): boolean {
  if (rec.maxOccurrences !== undefined && rec.generatedCount >= rec.maxOccurrences) return true;
  if (rec.endDateIso && occurrenceDate(rec.startDateIso, rec.frequency, rec.every, rec.generatedCount) > rec.endDateIso) return true;
  return false;
}

/** Next occurrence date, or null when the schedule is finished. */
export function nextRunIso(rec: RecurringSchedule): string | null {
  return isFinished(rec) ? null : occurrenceDate(rec.startDateIso, rec.frequency, rec.every, rec.generatedCount);
}

export interface DueRun {
  index: number;
  dateIso: string;
}

/**
 * Occurrences that are due (date <= today) and not yet generated, oldest first.
 * `cap` bounds a catch-up after a long absence so one visit cannot create hundreds of invoices.
 */
export function dueRuns(rec: RecurringSchedule, todayIso: string, cap = 12): DueRun[] {
  if (rec.status !== 'active') return [];
  const out: DueRun[] = [];
  let probe = { ...rec };
  while (out.length < cap && !isFinished(probe)) {
    const dateIso = occurrenceDate(rec.startDateIso, rec.frequency, rec.every, probe.generatedCount);
    if (dateIso > todayIso) break;
    out.push({ index: probe.generatedCount, dateIso });
    probe = { ...probe, generatedCount: probe.generatedCount + 1 };
  }
  return out;
}

/** Next unused "#N" number (the app's manual invoices start at #2200). */
export function nextInvoiceNumber(invoices: Pick<Invoice, 'number'>[]): string {
  let max = 2199;
  for (const i of invoices) {
    const m = /^#?(\d+)$/.exec(i.number.trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `#${max + 1}`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** {period} -> "October 2026", {date} -> the issue date. Lets one template say "Hosting for {period}". */
export function fillTokens(text: string, dateIso: string): string {
  const { y, m } = parse(dateIso);
  return text.replace(/\{period\}/g, `${MONTHS[m]} ${y}`).replace(/\{date\}/g, dateIso);
}

export const recurringRef = (recId: string, index: number): string => `rec:${recId}:${index}`;

/** Builds the draft invoice for one occurrence. Always a draft: nothing is sent without a human. */
export function buildInvoice(rec: RecurringInvoice, run: DueRun, number: string, taxProfiles: Pick<TaxProfile, 'id' | 'name' | 'rate'>[], idSeed: string): Invoice {
  const profiles = taxProfiles.filter((t) => rec.taxProfileIds.includes(t.id));
  const taxRate = profiles.reduce((s, t) => s + t.rate, 0);
  const lines = rec.lines.map((l, i) => ({ ...l, id: `il-${idSeed}-${i}`, description: fillTokens(l.description, run.dateIso) }));
  const subtotal = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0);
  const total = subtotal + (subtotal * taxRate) / 100;
  return {
    id: `inv-${idSeed}`,
    number,
    client: rec.client,
    amount: Math.round(total * 100) / 100,
    status: 'draft',
    issued: run.dateIso,
    due: addDays(run.dateIso, Math.max(0, rec.dueDays)),
    notes: rec.notes ? fillTokens(rec.notes, run.dateIso) : undefined,
    description: rec.description ? fillTokens(rec.description, run.dateIso) : undefined,
    lines,
    taxRate,
    taxProfileIds: rec.taxProfileIds,
    taxProfileId: rec.taxProfileIds[0],
    taxProfileName: profiles.map((t) => t.name).join(' + ') || undefined,
    externalRef: recurringRef(rec.id, run.index),
    paymentMethod: rec.paymentMethod,
    customerId: rec.customerId,
    projectId: rec.projectId,
    accountId: rec.accountId,
  };
}

// ---------------------------------------------------------------------------
// Recurring vendor bills (Accounts Payable)

export interface RecurringBill extends RecurringSchedule {
  id: string;
  name: string;
  vendorId: string;
  vendorName: string;
  lines: BillLine[];
  taxProfileIds: string[];
  paymentMethod: PaymentMethod;
  notes?: string;
  description?: string;
  projectId?: string;
  /** Expense / cost account the generated bills post against. */
  accountId?: string;
  /** Payment terms: due date = bill date + dueDays. */
  dueDays: number;
  /** Variable amounts (utilities, usage): each bill is flagged to be checked against the vendor's real invoice. */
  estimated: boolean;
  createdAt: string;
}

export const recurringBillRef = (recId: string, index: number): string => `rec:${recId}:${index}`;

export const TERMS_DAYS: Record<PaymentTerms, number> = { 'due-on-receipt': 0, net15: 15, net30: 30, net60: 60 };

/** Next unused "BILL-n" number. */
export function nextBillNumber(bills: Pick<Bill, 'number'>[]): string {
  let max = 1000;
  for (const b of bills) {
    const m = /^BILL-(\d+)$/i.exec(b.number.trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `BILL-${max + 1}`;
}

/**
 * Builds the bill for one occurrence. It is only ever RECORDED as unpaid: the system never
 * pays a bill by itself (payment stays a deliberate, approval-gated action).
 */
export function buildBill(rec: RecurringBill, run: DueRun, number: string, taxProfiles: Pick<TaxProfile, 'id' | 'name' | 'rate'>[], idSeed: string): Bill {
  const profiles = taxProfiles.filter((t) => rec.taxProfileIds.includes(t.id));
  const taxRate = profiles.reduce((s, t) => s + t.rate, 0);
  const lines = rec.lines.map((l, i) => ({ ...l, id: `bl-${idSeed}-${i}`, description: fillTokens(l.description, run.dateIso) }));
  const subtotal = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0);
  const total = subtotal + (subtotal * taxRate) / 100;
  const note = [rec.notes ? fillTokens(rec.notes, run.dateIso) : '', rec.estimated ? "ESTIMATE: confirm the amount against the vendor's actual invoice before paying." : ''].filter(Boolean).join('\n');
  return {
    id: `b-${idSeed}`,
    vendorId: rec.vendorId,
    vendorName: rec.vendorName,
    number,
    amount: Math.round(total * 100) / 100,
    received: run.dateIso,
    due: addDays(run.dateIso, Math.max(0, rec.dueDays)),
    status: 'unpaid',
    lines,
    taxRate,
    taxProfileIds: rec.taxProfileIds,
    taxProfileId: rec.taxProfileIds[0],
    taxProfileName: profiles.map((t) => t.name).join(' + ') || undefined,
    externalRef: recurringBillRef(rec.id, run.index),
    notes: note || undefined,
    description: rec.description ? fillTokens(rec.description, run.dateIso) : undefined,
    paymentMethod: rec.paymentMethod,
    projectId: rec.projectId,
    accountId: rec.accountId,
  };
}
