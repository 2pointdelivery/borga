/**
 * Server-side price arithmetic. ONE place that turns lines, a tax rate and a
 * discount into money. Routes that persist or send a priced document call this
 * and ignore any total the browser sent, so a crafted request cannot make an
 * invoice, bill, POS receipt or emailed document say a different amount from
 * the lines it contains.
 *
 * Pure (no I/O) so every rule here is unit-tested; the browser may use the same
 * helpers for previews, but the server's answer is the one that is stored.
 */

import type { Bill, Invoice } from './data';
import { roundMoney } from './inventory';

export type PricedLine = { qty: number; unitPrice: number };

const num = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? n : 0);
const qty = (n: unknown): number => Math.max(0, num(n));
const price = (n: unknown): number => Math.max(0, num(n));
const pct = (n: unknown): number => Math.max(0, Math.min(100, num(n)));

export interface DocumentTotals {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
}

/** Sum of qty × unit price, before discount and tax. */
export function linesSubtotal(lines: readonly PricedLine[], currency = 'USD'): number {
  return roundMoney(lines.reduce((t, l) => t + qty(l.qty) * price(l.unitPrice), 0), currency);
}

/**
 * Totals for a document with a subtotal-level discount and a tax rate applied
 * to the discounted subtotal. The discount is capped at the subtotal so it can
 * never turn a document into a negative price or an accidental refund.
 */
/** Face value → workspace currency at the document's snapshotted rate. */
export function convertToWorkspace(face: number, fxRate: number, currency = 'USD'): number {
  return roundMoney(num(face) * num(fxRate), currency);
}

export function documentTotals(
  lines: readonly PricedLine[],
  opts: { taxRate?: number; discountAmount?: number; currency?: string } = {},
): DocumentTotals {
  const currency = opts.currency ?? 'USD';
  const subtotal = linesSubtotal(lines, currency);
  const discount = Math.min(subtotal, roundMoney(Math.max(0, num(opts.discountAmount)), currency));
  const taxable = Math.max(0, subtotal - discount);
  const tax = roundMoney((taxable * pct(opts.taxRate)) / 100, currency);
  return { subtotal, discount, tax, total: roundMoney(taxable + tax, currency) };
}

/**
 * Invoice/bill totals. `amount` is stored in the workspace currency while the
 * document may be issued in another: the face value is lines + tax, converted
 * at the fx rate the document already carries. When there are no lines (a
 * legacy or hand-entered record) nothing is invented — the stored amount stays.
 */
function pricedDocument(
  doc: { lines?: readonly PricedLine[]; taxRate?: number; currency?: string; fxRate?: number },
  currency: string,
): { amount: number; foreignAmount?: number } | null {
  if (!doc.lines || doc.lines.length === 0) return null;
  const face = documentTotals(doc.lines, { taxRate: doc.taxRate, currency }).total;
  const docCurrency = typeof doc.currency === 'string' ? doc.currency.trim().toUpperCase() : '';
  const foreign = docCurrency !== '' && docCurrency !== currency.toUpperCase();
  if (!foreign) return { amount: face };
  const rate = num(doc.fxRate);
  if (!(rate > 0)) return null; // a foreign document without a rate is not ours to guess
  return { amount: convertToWorkspace(face, rate, currency), foreignAmount: face };
}

export function normalizeInvoice(invoice: Invoice, currency = 'USD'): Invoice {
  const priced = pricedDocument(invoice, currency);
  if (!priced) return invoice;
  return {
    ...invoice,
    amount: priced.amount,
    ...(priced.foreignAmount !== undefined ? { foreignAmount: priced.foreignAmount } : {}),
  };
}

export function normalizeBill(bill: Bill, currency = 'USD'): Bill {
  const priced = pricedDocument(bill, currency);
  if (!priced) return bill;
  return {
    ...bill,
    amount: priced.amount,
    ...(priced.foreignAmount !== undefined ? { foreignAmount: priced.foreignAmount } : {}),
  };
}

/** Entity names whose stored totals the server recalculates on every save. */
export const MONEY_ENTITIES = ['invoices', 'bills', 'posSales'] as const;

// ---------------------------------------------------------------------------
// Point of sale: rebuild every money field from the recorded line inputs.
// Same arithmetic as buildPosSale, applied to a sale that arrived from a
// client, so the persisted receipt cannot disagree with its own lines.
// ---------------------------------------------------------------------------

export interface PosSaleLike {
  lines?: Array<{ qty?: number; unitPrice?: number; discountPct?: number; taxRate?: number; [k: string]: unknown }>;
  saleDiscountPct?: number;
  subtotal?: number;
  discountTotal?: number;
  saleDiscount?: number;
  taxTotal?: number;
  total?: number;
  [k: string]: unknown;
}

export function normalizePosSale(sale: PosSaleLike, currency = 'USD'): PosSaleLike {
  if (!Array.isArray(sale.lines) || sale.lines.length === 0) return sale;
  const r = (n: number) => roundMoney(n, currency);
  const salePct = pct(sale.saleDiscountPct);
  const drafts = sale.lines.map((l) => {
    const lineSubtotal = r(qty(l.qty) * price(l.unitPrice));
    const lineDiscount = r((lineSubtotal * pct(l.discountPct)) / 100);
    return { l, lineSubtotal, lineDiscount, net: r(lineSubtotal - lineDiscount) };
  });
  const netTotal = drafts.reduce((t, d) => t + d.net, 0);
  let subtotal = 0;
  let discountTotal = 0;
  let saleDiscount = 0;
  let taxTotal = 0;
  let total = 0;
  const lines = drafts.map((d) => {
    const shared = netTotal > 0 ? r((d.net * salePct) / 100) : 0;
    const taxable = r(d.net - shared);
    const lineTax = r((taxable * pct(d.l.taxRate)) / 100);
    const lineTotal = r(taxable + lineTax);
    subtotal += d.lineSubtotal;
    discountTotal += d.lineDiscount;
    saleDiscount += shared;
    taxTotal += lineTax;
    total += lineTotal;
    return { ...d.l, lineSubtotal: d.lineSubtotal, lineDiscount: d.lineDiscount, saleDiscount: shared, lineTax, lineTotal };
  });
  return {
    ...sale,
    lines,
    subtotal: r(subtotal),
    discountTotal: r(discountTotal),
    saleDiscount: r(saleDiscount),
    taxTotal: r(taxTotal),
    total: r(total),
  };
}

/**
 * Recalculate a whole saved list for a money entity. Unknown shapes pass
 * through untouched (older records without lines keep their stored amount).
 */
export function normalizeMoneyEntity(entity: string, value: unknown, currency = 'USD'): unknown {
  if (!Array.isArray(value)) return value;
  if (entity === 'invoices') return value.map((v) => (v && typeof v === 'object' ? normalizeInvoice(v as Invoice, currency) : v));
  if (entity === 'bills') return value.map((v) => (v && typeof v === 'object' ? normalizeBill(v as Bill, currency) : v));
  if (entity === 'posSales') return value.map((v) => (v && typeof v === 'object' ? normalizePosSale(v as PosSaleLike, currency) : v));
  return value;
}
