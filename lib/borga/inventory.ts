import { currencyDigits } from './currencies';
import type { FinanceEntry, JournalEntry, GlAccount, PaymentMethod as LedgerPaymentMethod } from './data';

/**
 * Inventory domain: catalog (products AND services), EAN-13 internal barcodes,
 * stock movements with weighted-average costing, warehouse/store locations and
 * point-of-sale sale math. Pure (no I/O) — one implementation shared by the
 * store, the tabs, the API route and the tests.
 *
 * Service alignment: an item of type "service" simply does not track stock —
 * it can be sold at the POS and invoiced, but no barcode, no movements, no
 * costing. A company that only provides services sees a services catalog; a
 * company that deals in goods gets the full stock/warehouse/POS machinery.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ItemType = 'product' | 'service';

export interface InventoryItem {
  id: string;
  name: string;
  type: ItemType;
  /** Stock-keeping unit code, editable. Auto-generated as INV-#### on create. */
  sku: string;
  /** EAN-13 internal barcode (2xxxxxxxxxxxxxC) — products only. */
  barcode: string;
  category: string;
  description: string;
  unit: string;
  costPrice: number;
  price: number;
  /** Percent (0..100) applied at the POS and on invoices. */
  taxRate: number;
  /** Products track stock; services never do. */
  trackStock: boolean;
  reorderPoint: number;
  active: boolean;
  createdAtIso: string;
  /** Preferred supplier (Vendors & AP) — products only. */
  supplierId?: string;
}

export type WarehouseKind = 'warehouse' | 'store';

export interface Warehouse {
  id: string;
  name: string;
  code: string;
  kind: WarehouseKind;
  address: string;
  active: boolean;
}

export type MovementReason = 'purchase' | 'sale' | 'adjustment' | 'transfer-in' | 'transfer-out' | 'return';

export interface StockMovement {
  id: string;
  itemId: string;
  warehouseId: string;
  /** Signed quantity: positive = in, negative = out. */
  qty: number;
  /** Unit cost for stock-in movements; feeds the weighted average. */
  unitCost?: number;
  reason: MovementReason;
  /** POS sale number, purchase reference, ... */
  reference?: string;
  note?: string;
  at: string;
}

export interface PosSaleLine {
  itemId: string;
  name: string;
  qty: number;
  unitPrice: number;
  /** Line discount percent 0..100. */
  discountPct: number;
  taxRate: number;
  /** Populated by buildPosSale. */
  lineSubtotal: number;
  lineDiscount: number;
  /** Allocated share of the sale-level discount. */
  saleDiscount: number;
  lineTax: number;
  lineTotal: number;
  /** Weighted-average unit cost at sale time (products; 0 for services). */
  unitCost: number;
  /** Extended COGS for the line (qty × unitCost). */
  lineCogs: number;
  trackStock: boolean;
}

export type PaymentMethod = 'cash' | 'card' | 'mobile';

export interface PosSale {
  id: string;
  /** Human number, e.g. POS-000042. */
  number: string;
  warehouseId: string;
  lines: PosSaleLine[];
  subtotal: number;
  discountTotal: number;
  /** Sale-level discount applied across the cart after line discounts. */
  saleDiscountPct: number;
  saleDiscount: number;
  taxTotal: number;
  total: number;
  /** Cost of goods sold at weighted-average cost. */
  cogsTotal: number;
  payment: PaymentMethod;
  amountPaid: number;
  changeDue: number;
  cashier: string;
  /** Linked customer; absent means a walk-in. */
  customerId?: string | null;
  customerName?: string;
  at: string;
  status: 'completed' | 'refunded';
  refundedAt?: string;
}

// ---------------------------------------------------------------------------
// EAN-13 internal barcodes — the 2xxxxxxxxxxxx range is reserved for
// in-store use, so auto-assigned codes never collide with a supplier's GS1
// barcodes and scan fine on any standard reader.
// ---------------------------------------------------------------------------

const EAN13_FIRST = '2';

/** Standard EAN-13 modulo-10 check digit for 12 data digits. */
export function ean13CheckDigit(data12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = Number(data12[i]);
    if (!Number.isInteger(d) || d < 0) throw new Error('EAN-13 needs 12 digits');
    sum += d * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

/** Full internal EAN-13 for a workspace-local sequence (0-based). */
export function internalBarcode(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 0 || sequence > 99_999_999_999) throw new Error('sequence out of range');
  const data12 = EAN13_FIRST + String(sequence).padStart(11, '0');
  return data12 + ean13CheckDigit(data12);
}

export function isEan13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  return ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

/** Next free sequence given the items that already carry an internal barcode. */
export function nextBarcodeSequence(items: Array<{ barcode: string; type: ItemType }>): number {
  let max = -1;
  for (const it of items) {
    if (it.type === 'service' || !it.barcode) continue;
    const m = /^2(\d{11})\d$/.exec(it.barcode);
    if (!m) continue;
    const seq = Number(m[1]);
    if (seq > max) max = seq;
  }
  return max + 1;
}

/** Unique auto-assigned barcode for a new item. */
export function assignBarcode(items: Array<{ barcode: string; type: ItemType }>): string {
  return internalBarcode(nextBarcodeSequence(items));
}

// EAN-13 bar patterns for a scannable SVG rendering.
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGGL', 'LGLGLG', 'LGGLGL'];

/** 95 modules ('1' = bar, '0' = space) of a valid EAN-13, guards included. */
export function ean13Bars(code: string): string {
  if (!isEan13(code)) throw new Error('not a valid EAN-13');
  let bits = '101'; // left guard
  const first = Number(code[0]);
  const parity = PARITY[first];
  for (let i = 1; i <= 6; i++) {
    const d = Number(code[i]);
    bits += parity[i - 1] === 'L' ? L[d] : G[d];
  }
  bits += '01010'; // middle guard
  for (let i = 7; i <= 12; i++) {
    bits += R[Number(code[i])];
  }
  bits += '101'; // right guard
  return bits;
}

// ---------------------------------------------------------------------------
// Money — totals follow each currency's ISO decimals
// ---------------------------------------------------------------------------

export function roundMoney(amount: number, currency: string): number {
  const d = currencyDigits(currency);
  const f = 10 ** d;
  return Math.round((amount + Number.EPSILON) * f) / f;
}

// ---------------------------------------------------------------------------
// Stock + costing (weighted average)
// ---------------------------------------------------------------------------

export interface ItemCosting {
  qtyOnHand: number;
  avgCost: number;
  stockValue: number;
}

/**
 * Weighted-average cost from the full movement ledger — the ledger is the
 * source of truth, so this is idempotent and repairs any drift. Movements in
 * chronological order; stock-in at cost moves the average, stock-out keeps it;
 * an adjustment with a unit cost re-values what remains.
 */
export function recomputeCosting(movements: StockMovement[], itemId: string): ItemCosting {
  const chrono = [...movements.filter((m) => m.itemId === itemId)].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  let qty = 0;
  let value = 0;
  for (const m of chrono) {
    if (m.qty > 0) {
      const cost = m.unitCost ?? 0;
      qty += m.qty;
      value += m.qty * cost;
    } else if (m.qty < 0) {
      const out = Math.min(-m.qty, qty); // can never take stock below zero in the math
      qty -= out;
      value -= out * (qty + out > 0 ? value / (qty + out) : 0);
    }
  }
  const avg = qty > 0 ? value / qty : 0;
  return { qtyOnHand: qty, avgCost: roundMoney(avg, 'XXX'), stockValue: roundMoney(value, 'XXX') };
}

/** On-hand quantity per warehouse. */
export function stockByWarehouse(movements: StockMovement[], itemId: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of movements) {
    if (m.itemId !== itemId) continue;
    out[m.warehouseId] = (out[m.warehouseId] ?? 0) + m.qty;
  }
  return out;
}

export function totalOnHand(movements: StockMovement[], itemId: string): number {
  return movements.filter((m) => m.itemId === itemId).reduce((n, m) => n + m.qty, 0);
}

export type StockStatus = 'out' | 'low' | 'ok' | 'n-a';

export function stockStatus(item: InventoryItem, onHand: number): StockStatus {
  if (!item.trackStock) return 'n-a';
  if (onHand <= 0) return 'out';
  if (onHand <= item.reorderPoint) return 'low';
  return 'ok';
}

export interface WarehouseValuation {
  warehouseId: string;
  itemLines: number;
  stockValue: number;
}

/** Inventory value per location (weighted-average cost × on-hand), plus the grand total. */
export function valuation(movements: StockMovement[], items: InventoryItem[], warehouseIds?: string[]): { warehouses: WarehouseValuation[]; total: number } {
  const byWarehouse = new Map<string, Map<string, number>>();
  for (const m of movements) {
    if (!byWarehouse.has(m.warehouseId)) byWarehouse.set(m.warehouseId, new Map());
    const per = byWarehouse.get(m.warehouseId)!;
    per.set(m.itemId, (per.get(m.itemId) ?? 0) + m.qty);
  }
  const costOf = new Map(items.map((it) => [it.id, recomputeCosting(movements, it.id)]));
  const warehouses: WarehouseValuation[] = [];
  let total = 0;
  for (const [warehouseId, per] of byWarehouse) {
    if (warehouseIds && !warehouseIds.includes(warehouseId)) continue;
    let value = 0;
    let lines = 0;
    for (const [itemId, qty] of per) {
      if (qty <= 0) continue;
      lines++;
      value += qty * (costOf.get(itemId)?.avgCost ?? 0);
    }
    warehouses.push({ warehouseId, itemLines: lines, stockValue: roundMoney(value, 'XXX') });
    total += value;
  }
  return { warehouses, total: roundMoney(total, 'XXX') };
}

// ---------------------------------------------------------------------------
// Point of sale
// ---------------------------------------------------------------------------

export interface CartInput {
  itemId: string;
  qty: number;
  discountPct?: number;
  /** Override the catalog price (price changes don't rewrite history). */
  unitPrice?: number;
}

export interface BuildSaleInput {
  lines: CartInput[];
  items: InventoryItem[];
  movements: StockMovement[];
  warehouseId: string;
  payment: PaymentMethod;
  amountPaid?: number;
  /** Sale-level discount percent 0..100, applied after line discounts. */
  saleDiscountPct?: number;
  cashier: string;
  /** Linked customer; omit or null for a walk-in. */
  customerId?: string | null;
  customerName?: string;
  currency: string;
  now?: string;
  id: string;
  number: string;
}

export interface BuildSaleResult {
  ok: true;
  sale: PosSale;
  /** Stock-out movements to append for tracked items (the caller persists them). */
  movements: StockMovement[];
}

export type BuildSaleError =
  | { ok: false; error: 'empty-cart' }
  | { ok: false; error: 'unknown-item'; itemId: string }
  | { ok: false; error: 'insufficient-stock'; itemId: string; name: string; available: number; wanted: number }
  | { ok: false; error: 'underpaid'; total: number; paid: number };

/** Compute a complete POS sale with stock checks, WAC-based COGS, sale-level discount and currency-rounded totals. */
export function buildPosSale(input: BuildSaleInput): BuildSaleResult | BuildSaleError {
  if (!input.lines.length) return { ok: false, error: 'empty-cart' };
  const byId = new Map(input.items.map((i) => [i.id, i]));
  const r = (n: number) => roundMoney(n, input.currency);
  const salePct = Math.max(0, Math.min(100, input.saleDiscountPct ?? 0));

  const lines: PosSaleLine[] = [];
  const movements: StockMovement[] = [];
  let subtotal = 0;
  let discountTotal = 0;
  let taxTotal = 0;
  let cogsTotal = 0;
  const now = input.now ?? new Date().toISOString();

  // Aggregate cart quantities per item first so stock is checked once.
  const qtyByItem = new Map<string, number>();
  for (const l of input.lines) {
    qtyByItem.set(l.itemId, (qtyByItem.get(l.itemId) ?? 0) + l.qty);
  }
  for (const [itemId, wanted] of qtyByItem) {
    const item = byId.get(itemId);
    if (!item || !item.active) return { ok: false, error: 'unknown-item', itemId };
    if (item.trackStock) {
      const available = stockByWarehouse(input.movements, itemId)[input.warehouseId] ?? 0;
      if (wanted > available) {
        return { ok: false, error: 'insufficient-stock', itemId, name: item.name, available, wanted };
      }
    }
  }

  // Pass 1: per-line money before the sale-level discount.
  const drafts = input.lines.map((l) => {
    const item = byId.get(l.itemId)!;
    const unitPrice = l.unitPrice ?? item.price;
    const discountPct = Math.max(0, Math.min(100, l.discountPct ?? 0));
    const lineSubtotal = r(unitPrice * l.qty);
    const lineDiscount = r(lineSubtotal * (discountPct / 100));
    const lineNet = r(lineSubtotal - lineDiscount);
    const avgCost = item.trackStock ? recomputeCosting(input.movements, item.id).avgCost : 0;
    return { l, item, lineSubtotal, lineDiscount, lineNet, unitPrice: r(unitPrice), discountPct, avgCost, lineCogs: r(avgCost * l.qty) };
  });
  const netTotal = drafts.reduce((n, d) => n + d.lineNet, 0);

  // Pass 2: allocate the sale-level discount across lines proportional to their net.
  let saleDiscount = 0;
  for (const d of drafts) {
    const saleDisc = netTotal > 0 ? r(d.lineNet * (salePct / 100)) : 0;
    const taxable = r(d.lineNet - saleDisc);
    const lineTax = r(taxable * (d.item.taxRate / 100));
    const lineTotal = r(taxable + lineTax);

    lines.push({
      itemId: d.item.id,
      name: d.item.name,
      qty: d.l.qty,
      unitPrice: d.unitPrice,
      discountPct: d.discountPct,
      taxRate: d.item.taxRate,
      lineSubtotal: d.lineSubtotal,
      lineDiscount: d.lineDiscount,
      saleDiscount: saleDisc,
      lineTax,
      lineTotal,
      unitCost: d.avgCost,
      lineCogs: d.lineCogs,
      trackStock: d.item.trackStock,
    });

    subtotal = r(subtotal + d.lineSubtotal);
    discountTotal = r(discountTotal + d.lineDiscount);
    saleDiscount = r(saleDiscount + saleDisc);
    taxTotal = r(taxTotal + lineTax);
    cogsTotal = r(cogsTotal + d.lineCogs);

    if (d.item.trackStock) {
      movements.push({
        id: `mov-${input.id}-${d.item.id}`,
        itemId: d.item.id,
        warehouseId: input.warehouseId,
        qty: -d.l.qty,
        reason: 'sale',
        reference: input.number,
        at: now,
      });
    }
  }

  const total = r(subtotal - discountTotal - saleDiscount + taxTotal);
  const amountPaid = input.payment === 'cash' ? r(input.amountPaid ?? total) : total;
  if (amountPaid + 1e-9 < total) return { ok: false, error: 'underpaid', total, paid: amountPaid };

  const sale: PosSale = {
    id: input.id,
    number: input.number,
    warehouseId: input.warehouseId,
    lines,
    subtotal,
    discountTotal,
    saleDiscountPct: salePct,
    saleDiscount,
    taxTotal,
    total,
    cogsTotal,
    payment: input.payment,
    amountPaid,
    changeDue: r(Math.max(0, amountPaid - total)),
    cashier: input.cashier,
    customerId: input.customerId ?? null,
    customerName: input.customerName?.trim() || undefined,
    at: now,
    status: 'completed',
  };
  return { ok: true, sale, movements };
}

/** Stock movements that reverse a completed sale (used by refunds). */
export function refundMovements(sale: PosSale, now: string): StockMovement[] {
  return sale.lines
    .filter((l) => l.trackStock)
    .map((l) => ({
      id: `mov-refund-${sale.id}-${l.itemId}`,
      itemId: l.itemId,
      warehouseId: sale.warehouseId,
      qty: l.qty,
      unitCost: l.unitCost,
      reason: 'return' as const,
      reference: sale.number,
      note: 'Refund',
      at: now,
    }));
}

/** Next POS sale number for the register, e.g. POS-000042. */
export function nextPosNumber(sales: PosSale[]): string {
  let max = 0;
  for (const s of sales) {
    const m = /^POS-(\d+)$/.exec(s.number);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `POS-${String(max + 1).padStart(6, '0')}`;
}

// ---------------------------------------------------------------------------
// System connections — POS sales post to the ledger (finance entries) and the
// double-entry journals, exactly the way invoice settlements do: revenue
// (net of tax) splits Sales vs Service per line, tax owes to Sales Tax
// Payable, goods cost leaves Inventory for COGS. Refunds post mirrored
// reversals — the audit trail keeps the originals.
// ---------------------------------------------------------------------------

/** POS payment method -> the ledger's payment methods (card has no ledger equivalent yet). */
export function ledgerPaymentMethod(p: PaymentMethod): LedgerPaymentMethod | undefined {
  return p === 'cash' ? 'cash' : p === 'mobile' ? 'mobile-wallet' : undefined;
}

const account = (coa: GlAccount[], pred: (a: GlAccount) => boolean): GlAccount | undefined => coa.find(pred);

const cashAccount = (coa: GlAccount[]) => account(coa, (a) => a.isCash === true);
const salesRevenueAccount = (coa: GlAccount[]) => account(coa, (a) => a.type === 'revenue' && /sales/i.test(a.name));
const serviceRevenueAccount = (coa: GlAccount[]) => account(coa, (a) => a.type === 'revenue' && /service/i.test(a.name));
const taxPayableAccount = (coa: GlAccount[]) => account(coa, (a) => a.type === 'liability' && /sales tax/i.test(a.name));
const cogsAccount = (coa: GlAccount[]) => account(coa, (a) => /cost of goods/i.test(a.name));
const inventoryAccount = (coa: GlAccount[]) => account(coa, (a) => a.type === 'asset' && a.name === 'Inventory');

/** Ledger entries for a completed sale: revenue at the register + COGS expense. */
export function saleFinanceEntries(sale: PosSale, nowIso: string): FinanceEntry[] {
  const out: FinanceEntry[] = [{
    id: `fin-pos-${sale.id}-rev`,
    label: `${sale.number} — ${sale.customerName ?? 'Walk-in'}${sale.saleDiscountPct ? ` (−${sale.saleDiscountPct}%)` : ''}`,
    amount: sale.total,
    category: 'Point of Sale',
    kind: 'revenue',
    dateIso: sale.at.slice(0, 10),
    paymentMethod: ledgerPaymentMethod(sale.payment),
    createdAt: nowIso,
    source: 'auto',
    externalRef: sale.number,
  }];
  if (sale.cogsTotal > 0) {
    out.push({
      id: `fin-pos-${sale.id}-cogs`,
      label: `${sale.number} — cost of goods sold`,
      amount: sale.cogsTotal,
      category: 'Cost of Goods Sold',
      kind: 'expense',
      dateIso: sale.at.slice(0, 10),
      createdAt: nowIso,
      source: 'auto',
      externalRef: sale.number,
    });
  }
  return out;
}

/** Ledger reversals for a refund — negative amounts, same pattern as invoice voids. */
export function refundFinanceEntries(sale: PosSale, nowIso: string): FinanceEntry[] {
  const out: FinanceEntry[] = [{
    id: `fin-pos-${sale.id}-rev-refund`,
    label: `Reversal — ${sale.number} refunded (${sale.customerName ?? 'Walk-in'})`,
    amount: -Math.abs(sale.total),
    category: 'Point of Sale',
    kind: 'revenue',
    dateIso: nowIso.slice(0, 10),
    paymentMethod: ledgerPaymentMethod(sale.payment),
    createdAt: nowIso,
    source: 'auto',
    externalRef: sale.number,
  }];
  if (sale.cogsTotal > 0) {
    out.push({
      id: `fin-pos-${sale.id}-cogs-refund`,
      label: `Reversal — ${sale.number} goods returned to stock`,
      amount: -Math.abs(sale.cogsTotal),
      category: 'Cost of Goods Sold',
      kind: 'expense',
      dateIso: nowIso.slice(0, 10),
      createdAt: nowIso,
      source: 'auto',
      externalRef: sale.number,
    });
  }
  return out;
}

const jeDate = (iso: string) => new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });

/**
 * Double-entry postings for a completed sale (skipped cleanly when the chart
 * of accounts lacks the needed accounts):
 *   Dr Cash total | Cr Sales/Service Revenue (net per line type) | Cr Sales Tax Payable
 *   Dr COGS | Cr Inventory (goods cost, when any)
 */
export function saleJournals(sale: PosSale, coa: GlAccount[], nowIso: string): JournalEntry[] {
  const out: JournalEntry[] = [];
  const cash = cashAccount(coa);
  const tax = taxPayableAccount(coa);
  const salesRev = salesRevenueAccount(coa);
  const svcRev = serviceRevenueAccount(coa);
  const revenue = svcRev && !salesRev ? svcRev : salesRev; // prefer Sales; fall back to Service-only COAs
  if (cash && revenue) {
    const productNet = sale.lines.filter((l) => l.trackStock).reduce((n, l) => n + l.lineSubtotal - l.lineDiscount - l.saleDiscount, 0);
    const serviceNet = sale.lines.filter((l) => !l.trackStock).reduce((n, l) => n + l.lineSubtotal - l.lineDiscount - l.saleDiscount, 0);
    const lines: JournalEntry['lines'] = [{ accountId: cash.id, debit: sale.total, credit: 0 }];
    if (productNet > 0 && salesRev) lines.push({ accountId: salesRev.id, debit: 0, credit: roundMoney(productNet, 'XXX') });
    if (serviceNet > 0 && svcRev) lines.push({ accountId: svcRev.id, debit: 0, credit: roundMoney(serviceNet, 'XXX') });
    if (sale.taxTotal > 0 && tax) lines.push({ accountId: tax.id, debit: 0, credit: sale.taxTotal });
    out.push({
      id: `je-pos-${sale.id}`,
      date: jeDate(sale.at),
      dateIso: sale.at.slice(0, 10),
      memo: `POS ${sale.number} — ${sale.customerName ?? 'Walk-in'}`,
      description: `Point-of-sale settlement for ${sale.number} (${sale.payment}).`,
      reference: sale.number,
      status: 'posted',
      createdAt: nowIso,
      auto: 'pos',
      lines,
    });
  }
  const cogs = cogsAccount(coa);
  const inv = inventoryAccount(coa);
  if (sale.cogsTotal > 0 && cogs && inv) {
    out.push({
      id: `je-pos-${sale.id}-cogs`,
      date: jeDate(sale.at),
      dateIso: sale.at.slice(0, 10),
      memo: `POS ${sale.number} — cost of goods sold`,
      description: `Goods cost recognised for ${sale.number}; inventory relieved at weighted-average cost.`,
      reference: sale.number,
      status: 'posted',
      createdAt: nowIso,
      auto: 'pos',
      lines: [
        { accountId: cogs.id, debit: sale.cogsTotal, credit: 0 },
        { accountId: inv.id, debit: 0, credit: sale.cogsTotal },
      ],
    });
  }
  return out;
}

/** Mirrored journal postings for a refund. */
export function refundJournals(sale: PosSale, coa: GlAccount[], nowIso: string): JournalEntry[] {
  const mirrored: JournalEntry[] = saleJournals(sale, coa, nowIso).map((je) => ({
    ...je,
    id: `${je.id}-refund`,
    memo: `Reversal — ${je.memo}`,
    description: `Refund of ${sale.number}: mirrored posting of the original ${je.auto === 'pos' ? 'POS' : ''} journal.`,
    createdAt: nowIso,
    auto: 'pos-refund',
    lines: je.lines.map((l) => ({ accountId: l.accountId, debit: l.credit, credit: l.debit })),
  }));
  return mirrored;
}

// ---------------------------------------------------------------------------
// AI + fallback descriptions
// ---------------------------------------------------------------------------

/** Deterministic description when no LLM is configured — factual, never fake. */
export function templateDescription(item: Pick<InventoryItem, 'name' | 'type' | 'category' | 'unit' | 'price'>, currency: string, symbol = ''): string {
  const price = `${symbol}${item.price.toFixed(currencyDigits(currency))}`;
  if (item.type === 'service') {
    return item.category
      ? `${item.name} — professional ${item.category.toLowerCase()} service, billed at ${price} per ${item.unit}. Delivered by our team with a clear scope and turnaround agreed up front.`
      : `${item.name} — professional service, billed at ${price} per ${item.unit}. Delivered by our team with a clear scope and turnaround agreed up front.`;
  }
  return item.category
    ? `${item.name} — ${item.category.toLowerCase()}, priced at ${price} per ${item.unit}. In stock at our locations and ready for same-day pickup or delivery where available.`
    : `${item.name} — priced at ${price} per ${item.unit}. In stock at our locations and ready for same-day pickup or delivery where available.`;
}

/** The prompt sent to the workspace model for AI product descriptions. */
export function descriptionPrompt(item: Pick<InventoryItem, 'name' | 'type' | 'category' | 'unit' | 'price'>, companyName: string, currency: string): string {
  const kind = item.type === 'service' ? 'service' : 'product';
  return [
    `Write a short catalog description for a ${kind} sold by ${companyName}.`,
    `Name: ${item.name}`,
    item.category ? `Category: ${item.category}` : '',
    `Unit: ${item.unit}`,
    `Price: ${item.price} ${currency}`,
    '',
    'Two or three sentences, plain text only. Lead with what it is and the concrete benefit, mention who it is for, and end with a practical note (stock availability, or how the service is delivered). No markdown, no headings, no emoji, no slogans, no quotation marks around the name.',
  ].filter(Boolean).join('\n');
}

// ---------------------------------------------------------------------------
// Services alignment: a company that only provides services gets its
// onboarding-captured services as catalog items on first load.
// ---------------------------------------------------------------------------

export function serviceItemsFromTracks(tracks: Array<{ lines?: Array<{ name?: string; service?: string }> }>): InventoryItem[] {
  const byKey = new Map<string, string>();
  for (const t of tracks) {
    for (const l of t.lines ?? []) {
      const n = (l.service ?? l.name ?? '').trim();
      if (n && n !== '—') {
        const k = n.toLowerCase();
        if (!byKey.has(k)) byKey.set(k, n); // first casing wins
      }
    }
  }
  const now = new Date().toISOString();
  let i = 0;
  return [...byKey.values()].map((name) => ({
    id: `item-svc-${++i}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30)}`,
    name,
    type: 'service' as const,
    sku: '',
    barcode: '',
    category: 'Services',
    description: '',
    unit: 'engagement',
    costPrice: 0,
    price: 0,
    taxRate: 0,
    trackStock: false,
    reorderPoint: 0,
    active: true,
    createdAtIso: now,
  })).slice(0, 24);
}

// ---------------------------------------------------------------------------
// Seeds
// ---------------------------------------------------------------------------

export const INITIAL_WAREHOUSES: Warehouse[] = [
  { id: 'wh-main', name: 'Main Store', code: 'STORE-01', kind: 'store', address: '', active: true },
];
