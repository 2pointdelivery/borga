// Purchase orders: order → receive → 3-way match to bill. Pure.
import type { Bill } from './data';
export type POStatus = 'draft' | 'ordered' | 'partial' | 'received' | 'billed' | 'void';
export interface POLine { itemId?: string; label: string; qty: number; unitCost: number; receivedQty?: number; }
export interface PurchaseOrder {
  id: string; number: string; vendorId: string; vendorName: string;
  lines: POLine[]; status: POStatus; orderedAt: string; billId?: string;
  /** Ordering currency (ISO). Absent = workspace currency. Carried onto the bill. */
  currency?: string;
  /** When the goods should arrive (shown on the order, drives overdue hints). */
  expectedIso?: string;
  /** Delivery instructions, dock notes, anything the supplier should know. */
  notes?: string;
}
export const EMPTY_POS: PurchaseOrder[] = [];
export function poTotal(p: PurchaseOrder): number {
  return p.lines.reduce((t, l) => t + Math.max(0, l.qty) * Math.max(0, l.unitCost), 0);
}
export function poReceivedTotal(p: PurchaseOrder): number {
  return p.lines.reduce((t, l) => t + Math.min(Math.max(0, l.qty), Math.max(0, l.receivedQty ?? 0)) * Math.max(0, l.unitCost), 0);
}
/** 3-way match: every line received in full and bill total equals PO total (tolerance 1 cent). */
export function threeWayMatch(p: PurchaseOrder, billTotal: number): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  for (const l of p.lines) {
    if ((l.receivedQty ?? 0) < l.qty) reasons.push(`${l.label}: received ${l.receivedQty ?? 0} of ${l.qty}`);
  }
  if (Math.abs(poTotal(p) - billTotal) > 0.01) reasons.push(`bill ${billTotal.toFixed(2)} ≠ PO ${poTotal(p).toFixed(2)}`);
  return { ok: reasons.length === 0, reasons };
}

/** Builds the vendor bill for a fully-received PO (bill total = PO total, so the match holds by construction). */
export function billForPO(p: PurchaseOrder, o: { billNumber: string; dueIso: string; wsCurrency?: string; fxRate?: number }): { bill: Bill } {
  const match = threeWayMatch(p, poTotal(p));
  if (!match.ok) throw new Error(`PO is not fully received: ${match.reasons.join('; ')}`);
  if (p.billId) throw new Error('PO already has a bill.');
  const foreign = poTotal(p);
  const wsCurrency = (o.wsCurrency ?? '').toUpperCase();
  const docCcy = (p.currency ?? '').toUpperCase();
  const rate = docCcy && wsCurrency && docCcy !== wsCurrency ? (o.fxRate ?? null) : 1;
  if (docCcy && wsCurrency && docCcy !== wsCurrency && !(rate !== null && rate > 0)) {
    throw new Error(`No ${docCcy} → ${wsCurrency} exchange rate. Refresh Exchange rates first.`);
  }
  const total = Math.round(foreign * (rate ?? 1) * 100) / 100;
  return {
    bill: {
      id: `b-${Date.now().toString(36)}`, vendorId: p.vendorId, vendorName: p.vendorName,
      number: o.billNumber, amount: total, received: p.orderedAt, due: o.dueIso, status: 'unpaid',
      lines: p.lines.map((l, i) => ({ id: `bl-${i}`, description: `${p.number} — ${l.label} × ${l.qty}`, qty: l.qty, unitPrice: l.unitCost, itemId: l.itemId })),
      externalRef: `po:${p.id}`,
      currency: docCcy && wsCurrency && docCcy !== wsCurrency ? docCcy : undefined,
      fxRate: docCcy && wsCurrency && docCcy !== wsCurrency ? (rate as number) : undefined,
      foreignAmount: docCcy && wsCurrency && docCcy !== wsCurrency ? Math.round(foreign * 100) / 100 : undefined,
    },
  };
}

/** Receive goods: applies received quantities, returns updated PO + stock-in movements at actual unit cost. */
export function receivePO(p: PurchaseOrder, o: { received: Array<{ index: number; qty: number }>; warehouseId: string; at?: string; reference?: string }): {
  po: PurchaseOrder;
  movements: Array<{ itemId: string; warehouseId: string; qty: number; unitCost: number; reason: 'purchase'; reference: string; at: string }>;
} {
  if (p.status === 'void' || p.status === 'billed') throw new Error(`PO cannot be received (status: ${p.status}).`);
  const at = o.at ?? new Date().toISOString();
  const lines = p.lines.map((l) => ({ ...l }));
  const movements: Array<{ itemId: string; warehouseId: string; qty: number; unitCost: number; reason: 'purchase'; reference: string; at: string }> = [];
  for (const r of o.received) {
    const line = lines[r.index];
    if (!line) throw new Error(`No line at index ${r.index}.`);
    const add = Math.max(0, Math.floor(r.qty));
    if (add <= 0) continue;
    const remaining = Math.max(0, line.qty - (line.receivedQty ?? 0));
    const take = Math.min(add, remaining);
    if (take <= 0) continue;
    line.receivedQty = (line.receivedQty ?? 0) + take;
    if (line.itemId) {
      movements.push({ itemId: line.itemId, warehouseId: o.warehouseId, qty: take, unitCost: line.unitCost, reason: 'purchase', reference: o.reference ?? p.number, at });
    }
  }
  const fully = lines.every((l) => (l.receivedQty ?? 0) >= l.qty);
  const any = lines.some((l) => (l.receivedQty ?? 0) > 0);
  const po: PurchaseOrder = { ...p, lines, status: fully ? 'received' : any ? 'partial' : p.status };
  return { po, movements };
}
