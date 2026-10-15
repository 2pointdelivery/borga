import type { GlAccount, JournalEntry } from './data';
import { isDebitNormal } from './accounting-labels';

/**
 * Financial report math, pure and server-safe: one source of truth for the
 * dashboard's P&L (ReportsCenter renders it) and the scheduled report email
 * (report-schedules-server sends it). Posted journals only; normal-side
 * balances per IFRS/US GAAP/ASPE conventions (isDebitNormal).
 */

export interface PlRow {
  accountId: string;
  code: string;
  name: string;
  amount: number;
}

export interface ProfitAndLoss {
  revenueRows: PlRow[];
  costRows: PlRow[];
  expenseRows: PlRow[];
  totalRevenue: number;
  totalCost: number;
  totalExpenses: number;
  grossProfit: number;
  netIncome: number;
}

type JournalLike = Pick<JournalEntry, 'status' | 'dateIso'> & {
  lines: Array<Pick<JournalEntry['lines'][number], 'accountId' | 'debit' | 'credit'>>;
};

/** Net debit−credit delta per account for posted entries within [from, to] (inclusive, date-order safe: from > to yields nothing). */
export function periodDeltas(journals: JournalLike[], from: string, to: string): Map<string, number> {
  const map = new Map<string, number>();
  const lo = from <= to ? from : to;
  const hi = from <= to ? to : from;
  for (const j of journals) {
    if (j.status !== 'posted' || j.dateIso < lo || j.dateIso > hi) continue;
    for (const l of j.lines) map.set(l.accountId, (map.get(l.accountId) ?? 0) + l.debit - l.credit);
  }
  return map;
}

/** Normal-side balance rows for one account type, zero rows dropped, biggest first. */
function rowsOfType(coa: GlAccount[], type: GlAccount['type'], deltas: Map<string, number>): PlRow[] {
  return coa
    .filter((a) => a.type === type && !a.archived)
    .map((a) => {
      const raw = deltas.get(a.id) ?? 0;
      return { accountId: a.id, code: a.code, name: a.name, amount: isDebitNormal(a.type) ? raw : -raw };
    })
    .filter((r) => r.amount !== 0)
    .sort((x, y) => Math.abs(y.amount) - Math.abs(x.amount));
}

/** Profit & Loss for the period: revenue − cost of sales − operating expenses. */
export function buildProfitAndLoss(coa: GlAccount[], journals: JournalLike[], from: string, to: string): ProfitAndLoss {
  const deltas = periodDeltas(journals, from, to);
  const revenueRows = rowsOfType(coa, 'revenue', deltas);
  const costRows = rowsOfType(coa, 'cost', deltas);
  const expenseRows = rowsOfType(coa, 'expense', deltas);
  const totalRevenue = revenueRows.reduce((s, r) => s + r.amount, 0);
  const totalCost = costRows.reduce((s, r) => s + r.amount, 0);
  const totalExpenses = expenseRows.reduce((s, r) => s + r.amount, 0);
  const grossProfit = totalRevenue - totalCost;
  return { revenueRows, costRows, expenseRows, totalRevenue, totalCost, totalExpenses, grossProfit, netIncome: grossProfit - totalExpenses };
}
