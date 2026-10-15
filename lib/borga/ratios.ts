// Full financial-ratios pack from posted journals + CoA. Pure, tested.
// Account types expected: asset, liability, equity, revenue, expense (+ cash flag via code prefix 10xx or name).
import type { GlAccount, JournalEntry } from './data';

export interface RatioInput { code: string; type: string; balance: number; }
export interface RatioRow { id: string; label: string; value: number | null; formula: string; inputs: Record<string, number>; }

function balances(coa: GlAccount[], journals: JournalEntry[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const j of journals) {
    if (j.status !== 'posted') continue;
    for (const l of j.lines ?? []) {
      const a = coa.find((c) => c.id === l.accountId);
      if (!a) continue;
      const net = (l.debit ?? 0) - (l.credit ?? 0);
      // asset/expense are debit-normal; flip revenue/liability/equity to positive-balance convention
      const bal = a.type === 'asset' || a.type === 'expense' ? net : -net;
      m.set(a.id, (m.get(a.id) ?? 0) + bal);
    }
  }
  return m;
}
const sumBy = (coa: GlAccount[], bal: Map<string, number>, pred: (a: GlAccount) => boolean) =>
  coa.filter(pred).reduce((t, a) => t + (bal.get(a.id) ?? 0), 0);
const isCurrent = (a: GlAccount) => a.type === 'asset' && /^1[01]/.test(a.code ?? '');
const isCurrentLiab = (a: GlAccount) => a.type === 'liability' && /^20/.test(a.code ?? '');

export function computeRatios(coa: GlAccount[], journals: JournalEntry[]): RatioRow[] {
  const bal = balances(coa, journals);
  const assets = sumBy(coa, bal, (a) => a.type === 'asset');
  const liab = sumBy(coa, bal, (a) => a.type === 'liability');
  const equity = sumBy(coa, bal, (a) => a.type === 'equity');
  const revenue = sumBy(coa, bal, (a) => a.type === 'revenue');
  const expense = sumBy(coa, bal, (a) => a.type === 'expense');
  const cogs = sumBy(coa, bal, (a) => a.type === 'expense' && /cogs|cost of/i.test(a.name ?? ''));
  const inventory = sumBy(coa, bal, (a) => a.type === 'asset' && /invent/i.test(a.name ?? ''));
  const receivables = sumBy(coa, bal, (a) => a.type === 'asset' && /receiv/i.test(a.name ?? ''));
  const payables = sumBy(coa, bal, (a) => a.type === 'liability' && /payable/i.test(a.name ?? ''));
  const cash = sumBy(coa, bal, (a) => a.type === 'asset' && (/cash|bank/i.test(a.name ?? '') || /^10/.test(a.code ?? '')));
  const curA = sumBy(coa, bal, (a) => (a.type === 'asset' && isCurrent(a)) || /receiv|cash|invent/i.test(a.name ?? ''));
  const curL = liab > 0 ? sumBy(coa, bal, (a) => a.type === 'liability' && (isCurrentLiab(a) || /payable/i.test(a.name ?? ''))) || liab : 0;
  const net = revenue - expense;
  const r = (id: string, label: string, value: number | null, formula: string, inputs: Record<string, number>): RatioRow =>
    ({ id, label, value: value === null || !Number.isFinite(value) ? null : value, formula, inputs });
  return [
    r('current', 'Current ratio', curL ? curA / curL : null, 'currentAssets / currentLiabilities', { curA, curL }),
    r('quick', 'Quick ratio', curL ? (curA - inventory) / curL : null, '(currentAssets − inventory) / currentLiabilities', { curA, inventory, curL }),
    r('cash', 'Cash ratio', curL ? cash / curL : null, 'cash / currentLiabilities', { cash, curL }),
    r('wc', 'Working capital', curA - curL, 'currentAssets − currentLiabilities', { curA, curL }),
    r('gross', 'Gross margin %', revenue ? ((revenue - cogs) / revenue) * 100 : null, '(revenue − COGS) / revenue × 100', { revenue, cogs }),
    r('net', 'Net margin %', revenue ? (net / revenue) * 100 : null, 'netIncome / revenue × 100', { net, revenue }),
    r('roe', 'Return on equity %', equity ? (net / equity) * 100 : null, 'netIncome / equity × 100', { net, equity }),
    r('roa', 'Return on assets %', assets ? (net / assets) * 100 : null, 'netIncome / assets × 100', { net, assets }),
    r('de', 'Debt-to-equity', equity ? liab / equity : null, 'totalLiabilities / equity', { liab, equity }),
    r('dr', 'Debt ratio', assets ? liab / assets : null, 'totalLiabilities / assets', { liab, assets }),
    r('art', 'Receivables turnover', receivables ? revenue / receivables : null, 'revenue / receivables', { revenue, receivables }),
    r('apt', 'Payables turnover', payables ? (cogs || expense) / payables : null, 'COGS / payables', { cogs, expense, payables }),
    r('it', 'Inventory turns', inventory ? (cogs || expense) / inventory : null, 'COGS / inventory', { cogs, expense, inventory }),
    r('at', 'Asset turnover', assets ? revenue / assets : null, 'revenue / assets', { revenue, assets }),
  ];
}
