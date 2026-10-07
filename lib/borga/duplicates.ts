import type { Bill, FinanceEntry, Invoice } from './data';

/**
 * Duplicate-payment validation. Pure (no I/O) so the same rules guard the
 * dashboard, the API and the tests.
 *
 * Two levels:
 * - exact: the same document recorded twice (same number / reference). The
 *   action is blocked outright — recording it again can never be right.
 * - likely: same counterparty + same amount within 30 days. The action needs
 *   an explicit confirm and raises a review approval; it is not blocked
 *   because repeat billing (retainers, tranches) is legitimate.
 */

export interface DuplicateFlag {
  level: 'exact' | 'likely';
  message: string;
  matchId: string;
  matchLabel: string;
}

const DAY = 86_400_000;
const WINDOW_DAYS = 30;

const sameMoney = (a: number, b: number) => Math.abs(a - b) < 0.005;
const withinDays = (a: string | undefined, b: string | undefined, days: number) => {
  if (!a || !b) return false;
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  return Number.isFinite(ta) && Number.isFinite(tb) && Math.abs(ta - tb) <= days * DAY;
};
const sameText = (a: string | undefined, b: string | undefined) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

type InvoiceLike = Pick<Invoice, 'id' | 'number' | 'client' | 'amount' | 'issued' | 'externalRef'> & { voidedAt?: string | null };

export function findInvoiceDuplicates(candidate: InvoiceLike, all: InvoiceLike[]): DuplicateFlag[] {
  const out: DuplicateFlag[] = [];
  for (const o of all) {
    if (o.id === candidate.id || o.voidedAt) continue;
    if (sameText(o.number, candidate.number)) {
      out.push({ level: 'exact', message: `Invoice number ${o.number} already exists (${o.client}, ${o.amount}).`, matchId: o.id, matchLabel: `${o.number} — ${o.client}` });
      continue;
    }
    if (sameText(o.client, candidate.client) && sameMoney(o.amount, candidate.amount) && withinDays(o.issued, candidate.issued, WINDOW_DAYS)) {
      out.push({ level: 'likely', message: `${o.client} was already invoiced ${o.amount} around ${o.issued} (${o.number}).`, matchId: o.id, matchLabel: `${o.number} — ${o.client}` });
    }
  }
  return out;
}

type BillLike = Pick<Bill, 'id' | 'vendorId' | 'vendorName' | 'number' | 'amount' | 'received' | 'externalRef'> & { voidedAt?: string | null };

export function findBillDuplicates(candidate: BillLike, all: BillLike[]): DuplicateFlag[] {
  const out: DuplicateFlag[] = [];
  for (const o of all) {
    if (o.id === candidate.id || o.voidedAt) continue;
    if (o.vendorId === candidate.vendorId && sameText(o.number, candidate.number)) {
      out.push({ level: 'exact', message: `Bill ${o.number} from ${o.vendorName} is already recorded.`, matchId: o.id, matchLabel: `${o.number} — ${o.vendorName}` });
      continue;
    }
    if (candidate.externalRef && sameText(o.externalRef, candidate.externalRef)) {
      out.push({ level: 'exact', message: `Reference ${candidate.externalRef} is already on bill ${o.number} (${o.vendorName}).`, matchId: o.id, matchLabel: `${o.number} — ${o.vendorName}` });
      continue;
    }
    if (o.vendorId === candidate.vendorId && sameMoney(o.amount, candidate.amount) && withinDays(o.received, candidate.received, WINDOW_DAYS)) {
      out.push({ level: 'likely', message: `${o.vendorName} already billed ${o.amount} around ${o.received} (${o.number}).`, matchId: o.id, matchLabel: `${o.number} — ${o.vendorName}` });
    }
  }
  return out;
}

type EntryLike = Pick<FinanceEntry, 'id' | 'externalRef'>;

/** A non-blank external reference (cheque, PO, transfer ref) must never post twice. */
export function findFinanceRefDuplicates(externalRef: string, selfId: string | null, all: EntryLike[]): DuplicateFlag[] {
  const ref = externalRef.trim().toLowerCase();
  if (!ref) return [];
  return all
    .filter((e) => e.id !== selfId && sameText(e.externalRef, ref))
    .map((e) => ({
      level: 'exact' as const,
      message: `Reference "${externalRef.trim()}" is already posted on another ledger entry.`,
      matchId: e.id,
      matchLabel: e.id,
    }));
}

/** Month bucket 'YYYY-MM' for payroll runs; a released run per month means that month is paid. */
export function payrollReleasedForMonth(runs: Array<{ monthKey: string; status: string }>, monthKey: string): boolean {
  return runs.some((r) => r.monthKey === monthKey && r.status === 'released');
}
