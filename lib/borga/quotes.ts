// Quotes & estimates: versioning, totals, expiry, accept→invoice/project. Pure.
export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'expired' | 'converted';
export interface QuoteLine { label: string; qty: number; unitPrice: number; taxRate?: number; /** Catalog item this line was picked from (pre-fills label/price; free-text lines leave it empty). */ itemId?: string; }
export interface Quote {
  id: string; number: string; customerId: string; customerName: string;
  customerEmail?: string;
  /** The lead this quote grew out of (lead → quote → invoice chain). */
  leadId?: string;
  /** Quoting currency (ISO). Absent = workspace currency. Carried onto the invoice on accept. */
  currency?: string;
  lines: QuoteLine[]; status: QuoteStatus; version: number;
  issued: string; validUntil: string; notes?: string;
  /** Overall discount % applied to the subtotal before tax (0–100). */
  discountPct?: number;
  /** Plain-language payment terms shown on the quote (e.g. "50% deposit, balance on delivery"). */
  paymentTerms?: string;
  convertedInvoiceId?: string; convertedProjectId?: string;
}
export const EMPTY_QUOTES: Quote[] = [];
export function quoteSubtotal(q: Quote): number {
  return q.lines.reduce((t, l) => t + Math.max(0, l.qty) * Math.max(0, l.unitPrice), 0);
}
/** Discount amount on the subtotal (clamped 0–100%). */
export function quoteDiscount(q: Quote): number {
  const pct = Math.max(0, Math.min(100, q.discountPct ?? 0));
  return (quoteSubtotal(q) * pct) / 100;
}
function discountedSubtotal(q: Quote): number {
  return quoteSubtotal(q) - quoteDiscount(q);
}
export function quoteTax(q: Quote): number {
  const base = quoteSubtotal(q) > 0 ? discountedSubtotal(q) / quoteSubtotal(q) : 0;
  return q.lines.reduce((t, l) => t + Math.max(0, l.qty) * Math.max(0, l.unitPrice) * base * Math.max(0, l.taxRate ?? 0) / 100, 0);
}
export function quoteTotal(q: Quote): number { return discountedSubtotal(q) + quoteTax(q); }
export function isExpired(q: Quote, todayIso = new Date().toISOString().slice(0, 10)): boolean {
  return q.status !== 'accepted' && q.status !== 'converted' && q.validUntil < todayIso;
}
export function nextVersion(q: Quote): Quote {
  return { ...q, version: q.version + 1, status: 'draft' };
}

/** Accept a sent quote: validates expiry + status, returns updated quote + invoice/project drafts. */
export function acceptQuote(q: Quote, o: { invoiceNumber: string; projectId: string; todayIso?: string; wsCurrency?: string; fxRate?: number }): {
  quote: Quote;
  invoice: { id: string; number: string; client: string; customerId: string; amount: number; status: 'draft'; issued: string; due: string; lines: Array<{ id: string; description: string; qty: number; unitPrice: number; itemId?: string }>; projectId: string; externalRef: string; currency?: string; fxRate?: number; foreignAmount?: number };
  project: { id: string; name: string; description: string; status: 'planning'; customerId: string; budgetAmount: number; createdAt: string };
} {
  const today = o.todayIso ?? new Date().toISOString().slice(0, 10);
  if (q.status !== 'sent') throw new Error(`Only sent quotes can be accepted (status: ${q.status}).`);
  if (isExpired(q, today)) throw new Error('Quote has expired.');
  if (q.convertedInvoiceId) throw new Error('Quote was already converted.');
  const foreign = quoteTotal(q);
  const wsCurrency = (o.wsCurrency ?? '').toUpperCase();
  const docCcy = (q.currency ?? '').toUpperCase();
  // Foreign quotes convert at the rate resolved by the caller (FX table snapshot); same-currency passes through.
  const rate = docCcy && wsCurrency && docCcy !== wsCurrency ? (o.fxRate ?? null) : 1;
  if (docCcy && wsCurrency && docCcy !== wsCurrency && !(rate !== null && rate > 0)) {
    throw new Error(`No ${docCcy} → ${wsCurrency} exchange rate. Refresh Exchange rates first.`);
  }
  const total = Math.round(foreign * (rate ?? 1) * 100) / 100;
  const invoiceId = `in-${Date.now().toString(36)}`;
  const invoice = {
    id: invoiceId, number: o.invoiceNumber, client: q.customerName, customerId: q.customerId,
    amount: total, status: 'draft' as const, issued: today,
    due: q.validUntil >= today ? q.validUntil : today,
    lines: q.lines.map((l, i) => ({ id: `l-${i}`, description: l.label, qty: l.qty, unitPrice: l.unitPrice, itemId: l.itemId })),
    projectId: o.projectId, externalRef: `quote:${q.id}:v${q.version}`,
    currency: docCcy && wsCurrency && docCcy !== wsCurrency ? docCcy : undefined,
    fxRate: docCcy && wsCurrency && docCcy !== wsCurrency ? (rate as number) : undefined,
    foreignAmount: docCcy && wsCurrency && docCcy !== wsCurrency ? Math.round(foreign * 100) / 100 : undefined,
  };
  const project = {
    id: o.projectId, name: `Project — ${q.number}`, description: q.notes ?? `Delivered from quote ${q.number} v${q.version}`,
    status: 'planning' as const, customerId: q.customerId, budgetAmount: quoteSubtotal(q), createdAt: new Date().toISOString(),
  };
  const quote: Quote = { ...q, status: 'converted', convertedInvoiceId: invoiceId, convertedProjectId: o.projectId };
  return { quote, invoice, project };
}
