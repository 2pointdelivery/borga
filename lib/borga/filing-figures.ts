// The numbers behind a filing: what the books say for one period. These are a worksheet for the person (or accountant) who prepares
// the return, not the return itself. They come from invoices, bills and the People list only, so anything booked some other way
// (journals, bank-only expenses, depreciation, owner draws) is not in them, and the screen says so.
//
// Every number is also published under a name in `values` (sales, taxCharged, netTax...), which is how the form templates
// (filing-templates.ts) pick the amount for each line of a real form.

import type { Bill, Employee, Invoice, TaxCategory, TaxProfile } from './data';
import { daysBetween, isIso, type FigureBasis, type Obligation, type Period } from './filing-catalog';

export interface FigureLine {
  label: string;
  amount: number;
  /** Shown bold: a subtotal or the bottom line. */
  strong?: boolean;
  /** Not money (a count). */
  count?: boolean;
}

export interface FilingFigures {
  basis: FigureBasis;
  lines: FigureLine[];
  /**
   * The same numbers by name. Sales tax: sales, taxCharged, purchases, taxPaid, netTax (positive = to pay, negative = refund), plus
   * taxCharged.<category> and taxPaid.<category> (gst, vat, sales, custom...). Income: revenue, expenses, profit. Payroll: employees, grossPay.
   */
  values: Record<string, number>;
  notes: string[];
  /** Documents left out because their date is not a calendar date. */
  skippedUndated: number;
}

export interface FigureInput {
  invoices: Invoice[];
  bills: Bill[];
  employees: Employee[];
  taxProfiles: TaxProfile[];
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const inPeriod = (d: string | undefined, p: Period) => isIso(d) && d >= p.start && d <= p.end;

interface TaxLine {
  rate: number;
  amount: number;
  category?: TaxCategory;
}

interface Taxed {
  net: number;
  /** tax by profile name */
  tax: Map<string, TaxLine>;
}

/** Splits a document total (net + tax) into the net amount and the tax of each profile on it. */
function split(total: number, rate: number | undefined, profileIds: string[] | undefined, legacyId: string | undefined, label: string | undefined, profiles: TaxProfile[]): Taxed {
  const ids = profileIds?.length ? profileIds : legacyId ? [legacyId] : [];
  const found = ids.map((id) => profiles.find((p) => p.id === id)).filter((p): p is TaxProfile => !!p);
  const combined = found.length ? found.reduce((s, p) => s + p.rate, 0) : rate ?? 0;
  const net = combined > 0 ? total / (1 + combined / 100) : total;
  const tax = new Map<string, TaxLine>();
  if (combined > 0) {
    if (found.length) for (const p of found) tax.set(p.name, { rate: p.rate, amount: net * (p.rate / 100), category: p.category });
    else tax.set(label || 'Tax', { rate: combined, amount: net * (combined / 100) });
  }
  return { net, tax };
}

interface Bucket {
  /** by profile name */
  byName: Map<string, { rate: number; amount: number }>;
  /** by tax category */
  byCat: Map<string, number>;
}

function addTax(into: Bucket, t: Taxed, wanted: (cat: TaxCategory | undefined) => boolean) {
  for (const [name, v] of t.tax) {
    if (!wanted(v.category)) continue;
    const cur = into.byName.get(name);
    into.byName.set(name, { rate: v.rate, amount: (cur?.amount ?? 0) + v.amount });
    const c = v.category ?? 'other';
    into.byCat.set(c, (into.byCat.get(c) ?? 0) + v.amount);
  }
}

const newBucket = (): Bucket => ({ byName: new Map(), byCat: new Map() });
const total = (b: Bucket) => [...b.byName.values()].reduce((s, v) => s + v.amount, 0);

function salesTaxFigures(ob: Obligation, p: Period, d: FigureInput): FilingFigures {
  const cats = ob.taxCategories;
  // a tax with no known category (an old invoice that only kept a rate) is kept rather than silently dropped
  const wanted = (c: TaxCategory | undefined) => !cats || cats.length === 0 || c === undefined || cats.includes(c);
  const invoices = d.invoices.filter((i) => i.status !== 'draft' && !i.voidedAt);
  const bills = d.bills.filter((b) => !b.voidedAt);
  const dated = invoices.filter((i) => inPeriod(i.issued, p));
  const datedBills = bills.filter((b) => inPeriod(b.received, p));
  const skippedUndated = invoices.filter((i) => !isIso(i.issued)).length + bills.filter((b) => !isIso(b.received)).length;

  let sales = 0;
  const collected = newBucket();
  for (const i of dated) {
    const t = split(i.amount, i.taxRate, i.taxProfileIds, i.taxProfileId, i.taxProfileName, d.taxProfiles);
    sales += t.net;
    addTax(collected, t, wanted);
  }
  let purchases = 0;
  const paid = newBucket();
  for (const b of datedBills) {
    const t = split(b.amount, b.taxRate, b.taxProfileIds, b.taxProfileId, b.taxProfileName, d.taxProfiles);
    purchases += t.net;
    addTax(paid, t, wanted);
  }
  const lines: FigureLine[] = [{ label: `Sales, before tax (${dated.length} invoice${dated.length === 1 ? '' : 's'})`, amount: r2(sales) }];
  for (const [name, v] of collected.byName) lines.push({ label: `Tax charged: ${name} (${v.rate}%)`, amount: r2(v.amount) });
  lines.push({ label: 'Total tax charged on sales', amount: r2(total(collected)), strong: true });
  lines.push({ label: `Purchases, before tax (${datedBills.length} bill${datedBills.length === 1 ? '' : 's'})`, amount: r2(purchases) });
  for (const [name, v] of paid.byName) lines.push({ label: `Tax paid on purchases: ${name} (${v.rate}%)`, amount: r2(v.amount) });
  lines.push({ label: 'Total tax paid on purchases (credit you may claim)', amount: r2(total(paid)), strong: true });
  const net = total(collected) - total(paid);
  lines.push({ label: net >= 0 ? 'Net tax to pay' : 'Net refund claimed', amount: r2(Math.abs(net)), strong: true });

  const values: Record<string, number> = {
    sales: r2(sales), taxCharged: r2(total(collected)), purchases: r2(purchases), taxPaid: r2(total(paid)), netTax: r2(net),
  };
  for (const [c, v] of collected.byCat) values[`taxCharged.${c}`] = r2(v);
  for (const [c, v] of paid.byCat) values[`taxPaid.${c}`] = r2(v);

  const notes = [
    'Based on invoices by issue date and bills by received date (accrual basis). If you file on a cash basis, use the dates the payments were made instead.',
    'The tax on a purchase is only claimable if you hold a valid supplier invoice and the purchase was for the business. Your accountant decides what is claimable.',
  ];
  if (cats && cats.length) notes.push('Only the tax profiles that belong on this return are listed. Sales is every invoice in the period, including zero-rated and exempt ones.');
  return { basis: 'salesTax', lines, values, notes, skippedUndated };
}

function incomeFigures(p: Period, d: FigureInput): FilingFigures {
  const invoices = d.invoices.filter((i) => i.status !== 'draft' && !i.voidedAt);
  const bills = d.bills.filter((b) => !b.voidedAt);
  const inv = invoices.filter((i) => inPeriod(i.issued, p));
  const bil = bills.filter((b) => inPeriod(b.received, p));
  const skippedUndated = invoices.filter((i) => !isIso(i.issued)).length + bills.filter((b) => !isIso(b.received)).length;
  const revenue = inv.reduce((s, i) => s + split(i.amount, i.taxRate, i.taxProfileIds, i.taxProfileId, i.taxProfileName, d.taxProfiles).net, 0);
  const expenses = bil.reduce((s, b) => s + split(b.amount, b.taxRate, b.taxProfileIds, b.taxProfileId, b.taxProfileName, d.taxProfiles).net, 0);
  return {
    basis: 'income',
    lines: [
      { label: `Revenue from invoices, before tax (${inv.length})`, amount: r2(revenue) },
      { label: `Expenses from bills, before tax (${bil.length})`, amount: r2(expenses) },
      { label: 'Indicative profit before adjustments', amount: r2(revenue - expenses), strong: true },
    ],
    values: { revenue: r2(revenue), expenses: r2(expenses), profit: r2(revenue - expenses) },
    notes: [
      'This is a starting point, not taxable income. Payroll, depreciation (capital cost allowance), owner pay, interest, non-deductible items, carried-forward losses and credits are not here. Your accountant prepares the return from the full books.',
    ],
    skippedUndated,
  };
}

function payrollFigures(p: Period, d: FigureInput): FilingFigures {
  const active = d.employees.filter((e) => e.status === 'active' || e.status === 'on-leave' || e.status === 'onboarding');
  const months = Math.max(1, Math.round((daysBetween(p.start, p.end) + 1) / 30.4375));
  const gross = active.reduce((s, e) => s + (e.salary || 0), 0) * (months / 12);
  return {
    basis: 'payroll',
    lines: [
      { label: 'Employees on the payroll list', amount: active.length, count: true },
      { label: `Gross pay for ${months} month${months === 1 ? '' : 's'} (annual salaries ÷ 12, indicative)`, amount: r2(gross), strong: true },
    ],
    values: { employees: active.length, grossPay: r2(gross) },
    notes: [
      'Estimated from the salaries on the People page. The amount to remit (income tax withheld, pension, employment insurance, employer contributions) depends on the tax tables and each person\'s pay run, which this app does not calculate. Take those figures from your payroll provider or accountant.',
    ],
    skippedUndated: 0,
  };
}

export function figuresFor(ob: Obligation, p: Period, d: FigureInput): FilingFigures | null {
  switch (ob.figures) {
    case 'salesTax': return salesTaxFigures(ob, p, d);
    case 'income': return incomeFigures(p, d);
    case 'payroll': return payrollFigures(p, d);
    default: return null;
  }
}

export type { FigureBasis };
