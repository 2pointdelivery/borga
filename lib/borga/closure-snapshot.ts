// Balance-sheet tracking for book closure: a point-in-time balance sheet at
// the period end plus every outstanding balance-sheet item (open AR/AP,
// unreconciled bank lines, subledger gaps, pending FX revaluation, unposted
// depreciation), each with the count, the money at stake and a deep link to
// where it is resolved. Pure — tested in lib/closure-snapshot.test.ts.

import { revalueDocs, type FxRates } from './fx';
import { subledgerTieOut } from './accruals';

// ── Balance sheet at a date ───────────────────────────────────────────────────

export interface BsTotals {
  assets: number;
  liabilities: number;
  equity: number;
  /** Assets − (Liabilities + Equity): 0 on balanced books. */
  diff: number;
  balanced: boolean;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Totals every posted journal up to `throughIso` into an assets/liabilities/equity check. */
export function balanceSheetAt(
  coa: Array<{ id: string; type: string }>,
  journals: Array<{ status: string; dateIso: string; lines: Array<{ accountId: string; debit: number; credit: number }> }>,
  throughIso: string,
): BsTotals {
  const deltas = new Map<string, number>();
  journals
    .filter((j) => j.status === 'posted' && j.dateIso <= throughIso)
    .forEach((j) => j.lines.forEach((l) => deltas.set(l.accountId, (deltas.get(l.accountId) ?? 0) + l.debit - l.credit)));
  let assets = 0, liabilities = 0, equity = 0;
  for (const [accountId, delta] of deltas) {
    const acct = coa.find((a) => a.id === accountId);
    if (!acct) continue;
    if (acct.type === 'asset') assets += delta;            // debit-normal
    else if (acct.type === 'liability') liabilities -= delta; // credit-normal
    else if (acct.type === 'equity') equity -= delta;        // credit-normal
  }
  const diff = round(assets - (liabilities + equity));
  return { assets: round(assets), liabilities: round(liabilities), equity: round(equity), diff, balanced: Math.abs(diff) < 0.005 };
}

// ── Outstanding balance-sheet items ──────────────────────────────────────────

export interface OutstandingItem {
  id: string;
  label: string;
  /** Records behind the number. */
  count: number;
  /** Money at stake in workspace currency, where it means something. */
  amount: number | null;
  /** Extra line for the row (aging, net direction, which month is missing). */
  note?: string;
  href: { page: string; tab: string };
}

export interface OutstandingInput {
  invoices: Array<{ status: string; amount: number; voidedAt?: string; due?: string; currency?: string; fxRate?: number; foreignAmount?: number }>;
  bills: Array<{ status: string; amount: number; voidedAt?: string; due?: string; currency?: string; fxRate?: number; foreignAmount?: number }>;
  bankTxns: Array<{ status: string; amount: number }>;
  journals: Array<{ status: string; dateIso: string; externalRef?: string; lines: Array<{ accountId: string; debit: number; credit: number }> }>;
  coa: Array<{ id: string; type: string; name: string }>;
  fixedAssets: {
    assets: Array<{ acquiredOn: string; availableFrom?: string; events: Array<{ kind: string }> }>;
    runs: Array<{ period: string }>;
  };
  wsCurrency: string;
  fxRates: FxRates;
  /** Period end (YYYY-MM-DD) — the balance sheet date and the depreciation month checked. */
  periodEnd: string;
}

function resolveArAp(coa: OutstandingInput['coa']): { ar: string; ap: string } | null {
  const ar = coa.find((a) => a.type === 'asset' && /receiv/i.test(a.name ?? ''))?.id;
  const ap = coa.find((a) => a.type === 'liability' && /accounts payable/i.test(a.name ?? ''))?.id
    ?? coa.find((a) => a.type === 'liability' && /payable/i.test(a.name ?? '') && !/tax/i.test(a.name ?? ''))?.id;
  return ar && ap ? { ar, ap } : null;
}

/** Every outstanding balance-sheet item, worst first, each with its deep link. */
export function outstandingBalanceSheetItems(o: OutstandingInput): OutstandingItem[] {
  const items: OutstandingItem[] = [];

  // Open AR — sent or overdue, never voided.
  const openAr = o.invoices.filter((i) => !i.voidedAt && (i.status === 'sent' || i.status === 'overdue'));
  const overdueAr = openAr.filter((i) => i.status === 'overdue');
  const arTotal = openAr.reduce((s, i) => s + i.amount, 0);
  items.push({
    id: 'ar',
    label: 'Open customer invoices (AR)',
    count: openAr.length,
    amount: round(arTotal),
    note: overdueAr.length ? `${overdueAr.length} overdue` : undefined,
    href: { page: 'sales', tab: 'invoices' },
  });

  // Open AP — unpaid or scheduled, never voided.
  const openAp = o.bills.filter((b) => !b.voidedAt && (b.status === 'unpaid' || b.status === 'scheduled'));
  const apTotal = openAp.reduce((s, b) => s + b.amount, 0);
  items.push({
    id: 'ap',
    label: 'Unpaid vendor bills (AP)',
    count: openAp.length,
    amount: round(apTotal),
    href: { page: 'finance', tab: 'vendors' },
  });

  // Unreconciled bank lines — count plus net movement.
  const bank = o.bankTxns.filter((t) => t.status === 'unmatched');
  const bankNet = bank.reduce((s, t) => s + t.amount, 0);
  items.push({
    id: 'bank',
    label: 'Unreconciled bank lines',
    count: bank.length,
    amount: round(bankNet),
    note: bankNet >= 0 ? 'money in, unreconciled' : 'money out, unreconciled',
    href: { page: 'finance', tab: 'banking' },
  });

  // Subledger tie-out: open AR/AP vs their ledger accounts.
  const ids = resolveArAp(o.coa);
  if (ids) {
    const tie = subledgerTieOut({
      invoices: o.invoices.map((i) => ({ status: i.status, amount: i.amount, voidedAt: i.voidedAt })),
      bills: o.bills.map((b) => ({ status: b.status, amount: b.amount })),
      journals: o.journals,
      arAccountId: ids.ar,
      apAccountId: ids.ap,
    });
    if (Math.abs(tie.ar.diff) >= 0.01 || Math.abs(tie.ap.diff) >= 0.01) {
      items.push({
        id: 'tieout',
        label: 'Books ≠ paperwork (AR/AP tie-out)',
        count: (Math.abs(tie.ar.diff) >= 0.01 ? 1 : 0) + (Math.abs(tie.ap.diff) >= 0.01 ? 1 : 0),
        amount: round(Math.abs(tie.ar.diff) + Math.abs(tie.ap.diff)),
        note: `AR off ${tie.ar.diff.toFixed(2)} · AP off ${tie.ap.diff.toFixed(2)}`,
        href: { page: 'finance', tab: 'accounting' },
      });
    }
  }

  // FX revaluation pending on open foreign balances.
  const fxDocs = [
    ...openAr
      .filter((i) => (i.currency ?? '').toUpperCase() !== o.wsCurrency.toUpperCase() && (i.currency ?? '') !== '')
      .map((i) => ({ id: String(i.amount) + (i.due ?? ''), number: '', kind: 'invoice' as const, foreignAmount: i.foreignAmount ?? i.amount, currency: (i.currency ?? '').toUpperCase(), fxRate: i.fxRate ?? 1, openWs: i.amount })),
    ...openAp
      .filter((b) => (b.currency ?? '').toUpperCase() !== o.wsCurrency.toUpperCase() && (b.currency ?? '') !== '')
      .map((b) => ({ id: String(b.amount) + (b.due ?? ''), number: '', kind: 'bill' as const, foreignAmount: b.foreignAmount ?? b.amount, currency: (b.currency ?? '').toUpperCase(), fxRate: b.fxRate ?? 1, openWs: b.amount })),
  ];
  const fxLines = revalueDocs(fxDocs, o.wsCurrency, o.fxRates);
  if (fxLines.length > 0) {
    items.push({
      id: 'fx',
      label: 'FX revaluation pending',
      count: fxLines.length,
      amount: round(fxLines.reduce((s, l) => s + Math.abs(l.diff), 0)),
      note: `${fxLines.reduce((s, l) => s + (l.diff > 0 ? 1 : 0), 0)} gain · ${fxLines.reduce((s, l) => s + (l.diff < 0 ? 1 : 0), 0)} loss at today's rates`,
      href: { page: 'finance', tab: 'accounting' },
    });
  }

  // Depreciation posted for the closing month?
  const month = o.periodEnd.slice(0, 7);
  const depreciable = o.fixedAssets.assets.filter((a) => {
    const disposed = a.events.some((e) => e.kind === 'disposal');
    const ready = (a.availableFrom ?? '').trim() !== '' ? a.availableFrom as string : a.acquiredOn;
    return !disposed && ready <= o.periodEnd;
  });
  const postedThisMonth = o.fixedAssets.runs.some((r) => r.period === month);
  if (depreciable.length > 0 && !postedThisMonth) {
    items.push({
      id: 'depreciation',
      label: `Depreciation not posted for ${month}`,
      count: depreciable.length,
      amount: null,
      note: 'Post it from the Fixed Assets register so the closing books carry the charge',
      href: { page: 'finance', tab: 'assets' },
    });
  }

  return items;
}
