'use client';

import { fmtMoney, currencyDigits } from '@/lib/borga/currencies';
import { Fragment, useMemo, useState } from 'react';
import {
  Download,
  Printer,
  Scale,
  TrendingUp,
  Waves,
  Landmark,
  Gauge,
  Table2,
  ArrowLeftRight,
  Layers,
  FileText,
  FileSpreadsheet,
  Sparkles,
  Target,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ACCOUNT_TYPE_STYLE, type GlAccount } from '@/lib/borga/data';
import { ACCOUNT_SIDE_HINT, DR_CR_LEGEND, NORMAL_SIDE_SHORT, isDebitNormal, splitDrCr } from '@/lib/borga/accounting-labels';
import { computeAccountMonthlyActuals, getAccountingStandard, computeProjectActualSpend, PROJECT_STATUS_LABEL, deriveValuation } from '@/lib/borga/data';
import { deriveBusinessInsights } from '@/lib/borga/insights';
import { brandedDocHtml, openPrintWindow, csvWithHeader, downloadTextFile } from '@/lib/borga/report-template';
import { useBorga } from '@/lib/borga/store';
import { SectionTitle } from '../bits';
import { AccountSelect } from '../form-widgets';
import { SearchSelect } from '../SearchSelect';
import { cn } from '@/lib/utils';

type ReportId = 'pl' | 'bs' | 'cf' | 'equity' | 'ratios' | 'tb' | 'acct-txn' | 'acct-bal' | 'budget-actual';

const REPORTS: { id: ReportId; label: string; icon: typeof FileText; blurb: string }[] = [
  { id: 'pl', label: 'Profit & Loss', icon: TrendingUp, blurb: 'Revenue, expenses and net income for the period' },
  { id: 'bs', label: 'Balance Sheet', icon: Scale, blurb: 'Assets, liabilities and equity as of a date' },
  { id: 'cf', label: 'Cash Flow', icon: Waves, blurb: 'Direct-method cash movements by activity' },
  { id: 'equity', label: 'Equity Statement', icon: Landmark, blurb: "Movements in owners' equity for the period." },
  { id: 'ratios', label: 'Financial Ratios', icon: Gauge, blurb: 'Liquidity, leverage, profitability and efficiency' },
  { id: 'tb', label: 'Trial Balance', icon: Table2, blurb: 'Debit and credit balances per account as of a date' },
  { id: 'acct-txn', label: 'Account Transactions', icon: ArrowLeftRight, blurb: 'Ledger activity and running balance per account' },
  { id: 'acct-bal', label: 'Account Balances', icon: Layers, blurb: 'Opening → movement → closing for every account' },
  { id: 'budget-actual', label: 'Budget vs. Actuals', icon: Target, blurb: 'Annual comparison of budgeted and actual by account, with variance' },
];

/** Normal balance side lives in accounting-labels (IFRS double-entry: Dr normal = asset | cost | expense). */

function isoAddDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isoStartOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}


export function ReportsCenter() {
  const { journals, coa, closures, activeWorkspace, log, budgets,
    finance, invoices, bills, vendors, customers, leads, goals, bankTxns, bankAccounts, employees,
    projects, fundraising, knowledge, valuation, agents } = useBorga();
  const currency = activeWorkspace()?.currency ?? 'USD';
  const money = (n: number) => fmtMoney(n, currency);
  const standard = getAccountingStandard(activeWorkspace()?.country);
  const reportLabel = (id: ReportId): string => {
    if (id === 'pl') return standard.statementNames.incomeStatement;
    if (id === 'bs') return standard.statementNames.balanceSheet;
    if (id === 'cf') return standard.statementNames.cashFlow;
    if (id === 'equity') return standard.statementNames.equity;
    return REPORTS.find((r) => r.id === id)?.label ?? id;
  };

  const today = new Date().toISOString().slice(0, 10);
  const [report, setReport] = useState<ReportId>('pl');
  const [from, setFrom] = useState(isoStartOfMonth(today));
  const [to, setTo] = useState(today);
  const [detail, setDetail] = useState<'summary' | 'details'>('details');
  const [txnAccount, setTxnAccount] = useState<string>('');
  const [budgetActualId, setBudgetActualId] = useState<string>('');
  const activeBudget = budgets.find((b) => b.id === budgetActualId) ?? budgets[0];
  // Keep the selected account valid across workspace switches.
  const safeTxnAccount = coa.some((a) => a.id === txnAccount) ? txnAccount : coa[0]?.id ?? '';

  // Effective period — always ordered so filters can never invert.
  const effFrom = from <= to ? from : to;
  const effTo = from <= to ? to : from;

  const posted = useMemo(() => journals.filter((j) => j.status === 'posted'), [journals]);
  const accountById = useMemo(() => new Map(coa.map((a) => [a.id, a])), [coa]);

  // Latest closure strictly before `to` — earnings since then are "current".
  const lastClosureEnd = useMemo(() => {
    const relevant = closures
      .filter((c) => c.endDate <= effTo)
      .sort((a, b) => (a.endDate < b.endDate ? 1 : -1));
    return relevant[0]?.endDate ?? null;
  }, [closures, to]);

  /** Net debit−credit delta per account for entries with from ≤ dateIso ≤ to. */
  const periodDeltas = useMemo(() => {
    const map = new Map<string, number>();
    posted
      .filter((j) => j.dateIso >= effFrom && j.dateIso <= effTo)
      .forEach((j) => j.lines.forEach((l) => map.set(l.accountId, (map.get(l.accountId) ?? 0) + l.debit - l.credit)));
    return map;
  }, [posted, from, to]);

  /** Cumulative debit−credit per account for all posted entries ≤ to. */
  const cumulativeDeltas = useMemo(() => {
    const map = new Map<string, number>();
    posted
      .filter((j) => j.dateIso <= effTo)
      .forEach((j) => j.lines.forEach((l) => map.set(l.accountId, (map.get(l.accountId) ?? 0) + l.debit - l.credit)));
    return map;
  }, [posted, to]);

  /** Deltas before `from` (opening positions). */
  const openingDeltas = useMemo(() => {
    const map = new Map<string, number>();
    posted
      .filter((j) => j.dateIso < effFrom)
      .forEach((j) => j.lines.forEach((l) => map.set(l.accountId, (map.get(l.accountId) ?? 0) + l.debit - l.credit)));
    return map;
  }, [posted, from]);

  /** Normal-side balance for an account given a delta map. */
  const bal = (accountId: string, deltas: Map<string, number>): number => {
    const acct = accountById.get(accountId);
    if (!acct) return 0;
    const raw = deltas.get(accountId) ?? 0;
    return isDebitNormal(acct.type) ? raw : -raw;
  };

  const sumType = (type: GlAccount['type'], deltas: Map<string, number>) =>
    coa.filter((a) => a.type === type).reduce((s, a) => s + Math.max(0, bal(a.id, deltas)), 0);

  // ── P&L ────────────────────────────────────────────────────────────────────
  const pl = useMemo(() => {
    const revenueRows = coa.filter((a) => a.type === 'revenue').map((a) => ({ account: a, amount: bal(a.id, periodDeltas) })).filter((r) => r.amount !== 0);
    const costRows = coa.filter((a) => a.type === 'cost').map((a) => ({ account: a, amount: bal(a.id, periodDeltas) })).filter((r) => r.amount !== 0);
    const expenseRows = coa.filter((a) => a.type === 'expense').map((a) => ({ account: a, amount: bal(a.id, periodDeltas) })).filter((r) => r.amount !== 0);
    const totalRevenue = revenueRows.reduce((s, r) => s + r.amount, 0);
    const totalCost = costRows.reduce((s, r) => s + r.amount, 0);
    const totalExpenses = expenseRows.reduce((s, r) => s + r.amount, 0);
    const grossProfit = totalRevenue - totalCost;
    return {
      revenueRows, costRows, expenseRows, totalRevenue, totalCost, totalExpenses,
      grossProfit, netIncome: grossProfit - totalExpenses,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coa, periodDeltas]);

  // Prior equal-length period comparison
  const plPrior = useMemo(() => {
    const spanDays = Math.max(1, Math.round((new Date(effTo).getTime() - new Date(effFrom).getTime()) / 86400000));
    const pFrom = isoAddDays(effFrom, -(spanDays + 1));
    const pTo = isoAddDays(effFrom, -1);
    const map = new Map<string, number>();
    posted
      .filter((j) => j.dateIso >= pFrom && j.dateIso <= pTo)
      .forEach((j) => j.lines.forEach((l) => map.set(l.accountId, (map.get(l.accountId) ?? 0) + l.debit - l.credit)));
    const rev = coa.filter((a) => a.type === 'revenue').reduce((s, a) => s + Math.max(0, -(map.get(a.id) ?? 0)), 0);
    const cost = coa.filter((a) => a.type === 'cost').reduce((s, a) => s + Math.max(0, map.get(a.id) ?? 0), 0);
    const exp = coa.filter((a) => a.type === 'expense').reduce((s, a) => s + Math.max(0, map.get(a.id) ?? 0), 0);
    return { revenue: rev, cost, expenses: exp, net: rev - cost - exp };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coa, posted, from, to]);

  // ── Balance sheet ─────────────────────────────────────────────────────────
  const bs = useMemo(() => {
    const assets = coa.filter((a) => a.type === 'asset').map((a) => ({ account: a, amount: bal(a.id, cumulativeDeltas) })).filter((r) => r.amount !== 0);
    const liabilities = coa.filter((a) => a.type === 'liability').map((a) => ({ account: a, amount: bal(a.id, cumulativeDeltas) })).filter((r) => r.amount !== 0);
    const equityAccounts = coa.filter((a) => a.type === 'equity').map((a) => ({ account: a, amount: bal(a.id, cumulativeDeltas) })).filter((r) => r.amount !== 0);

    // Net income earned since the last book closure (or since inception).
    const niFrom = lastClosureEnd ? isoAddDays(lastClosureEnd, 1) : '0000-01-01';
    let currentEarnings = 0;
    posted
      .filter((j) => j.dateIso > niFrom && j.dateIso <= effTo && !j.closesPeriod)
      .forEach((j) =>
        j.lines.forEach((l) => {
          const acct = accountById.get(l.accountId);
          if (!acct) return;
          // Earnings = credits to revenue (Cr normal) minus debits to costs/expenses (Dr normal).
          if (acct.type === 'revenue') currentEarnings += -l.debit + l.credit;
          if (acct.type === 'cost' || acct.type === 'expense') currentEarnings -= l.debit - l.credit;
        }),
      );
    // Closing entries already moved prior earnings into retained earnings.
    const totalAssets = assets.reduce((s, r) => s + r.amount, 0);
    const totalLiabilities = liabilities.reduce((s, r) => s + r.amount, 0);
    const totalEquityAccounts = equityAccounts.reduce((s, r) => s + r.amount, 0);
    const totalEquity = totalEquityAccounts + currentEarnings;
    return {
      assets, liabilities, equityAccounts, currentEarnings,
      totalAssets, totalLiabilities, totalEquity,
      balanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coa, cumulativeDeltas, posted, to, lastClosureEnd, accountById]);

  // ── Cash flow (direct method) ─────────────────────────────────────────────
  const cf = useMemo(() => {
    const cashAccounts = coa.filter((a) => a.isCash);
    const cashIds = new Set(cashAccounts.map((a) => a.id));
    const rows: { activity: 'operating' | 'investing' | 'financing'; label: string; amount: number }[] = [];
    posted
      .filter((j) => j.dateIso >= effFrom && j.dateIso <= effTo)
      .forEach((j) => {
        const cashLine = j.lines.find((l) => cashIds.has(l.accountId));
        if (!cashLine) return;
        const cashMove = cashLine.debit - cashLine.credit; // +in / −out
        if (cashMove === 0) return;
        const counter = j.lines.find((l) => l !== cashLine && l.accountId !== cashLine.accountId);
        const counterAcct = counter ? accountById.get(counter.accountId) : undefined;
        const activity: 'operating' | 'investing' | 'financing' =
          !counterAcct
            ? 'operating'
            : counterAcct.type === 'revenue' || counterAcct.type === 'expense'
              ? 'operating'
              : counterAcct.type === 'asset'
                ? 'investing'
                : 'financing';
        rows.push({ activity, label: j.memo, amount: cashMove });
      });
    const openingCash = cashAccounts.reduce((s, a) => s + bal(a.id, openingDeltas), 0);
    const net = rows.reduce((s, r) => s + r.amount, 0);
    const byActivity = (k: 'operating' | 'investing' | 'financing') => rows.filter((r) => r.activity === k);
    return { rows, openingCash, net, closingCash: openingCash + net, byActivity };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coa, posted, from, to, openingDeltas, accountById]);

  // ── Agent variance commentary + cross-module insight feed ────────────────
  const insights = useMemo(
    () => deriveBusinessInsights({ finance, invoices, bills, vendors, customers, leads, goals, journals: posted, bankTxns, bankAccounts, employees }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [finance, invoices, bills, vendors, customers, leads, posted, bankTxns, bankAccounts, employees],
  );

  const commentary = useMemo(() => {
    const pct = (cur: number, prev: number) =>
      Math.abs(prev) > 0.01 ? Math.round(((cur - Math.abs(prev)) / Math.abs(prev)) * 1000) / 10 : null;
    const out: string[] = [];
    const revDelta = pct(pl.totalRevenue, plPrior.revenue);
    out.push(
      `Revenue closed at ${money(pl.totalRevenue)} for ${effFrom} → ${effTo}${revDelta !== null ? ` — ${revDelta >= 0 ? 'up' : 'down'} ${Math.abs(revDelta)}% against the prior comparable period (${money(plPrior.revenue)})` : ''}.`,
    );
    if (pl.totalRevenue && plPrior.revenue) {
      const gm = Math.round((pl.grossProfit / pl.totalRevenue) * 1000) / 10;
      const gmPrev = Math.round(((plPrior.revenue - plPrior.cost) / plPrior.revenue) * 1000) / 10;
      out.push(
        `Gross margin prints ${gm}% versus ${gmPrev}% last period — ${gm >= gmPrev ? 'unit economics are improving; protect pricing on renewals' : 'COGS is creeping; renegotiate the top two cost lines before quarter end'}.`,
      );
    }
    const netDelta = pct(pl.netIncome, plPrior.net);
    out.push(
      `Net income lands at ${money(pl.netIncome)}${netDelta !== null ? ` (${netDelta >= 0 ? '+' : ''}${netDelta}% vs prior)` : ''}, on operating expenses of ${money(pl.totalExpenses)}.`,
    );
    out.push(
      `Cash closes at ${money(cf.closingCash)}; the period generated ${money(cf.net)} of net cash (${cf.byActivity('operating').length} operating movements).`,
    );
    insights
      .filter((i) => i.severity === 'critical' || i.severity === 'watch')
      .slice(0, 3)
      .forEach((i) => out.push(`${i.title} — recommended action: ${i.action}`));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pl, plPrior, cf, coa, insights, effFrom, effTo]);

  /** Branded multi-section PDF: exec summary, P&L, balance sheet, cash flow, agent commentary. */
  const openBoardPack = () => {
    const ws = activeWorkspace();
    if (!ws) return;
    const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const row = (label: string, amount: number, cls = '') =>
      `<tr class="${cls}"><td>${esc(label)}</td><td class="num">${money(amount)}</td></tr>`;
    const body = `
      <div class="section-title">Executive summary</div>
      <table>
        ${row('Revenue', pl.totalRevenue)}
        ${row('Gross profit', pl.grossProfit)}
        ${row('Net income', pl.netIncome)}
        ${row('Closing cash', cf.closingCash)}
      </table>
      <div class="section-title">Profit &amp; loss — ${esc(effFrom)} → ${esc(effTo)}</div>
      <table>
        ${pl.revenueRows.map((r) => row(r.account.name, r.amount)).join('')}
        <tr class="total-row"><td>Total revenue</td><td class="num">${money(pl.totalRevenue)}</td></tr>
        ${pl.costRows.map((r) => row(r.account.name, r.amount)).join('')}
        ${row('Gross profit', pl.grossProfit, 'total-row')}
        ${pl.expenseRows.map((r) => row(r.account.name, r.amount)).join('')}
        <tr class="grand"><td>Net income</td><td class="num">${money(pl.netIncome)}</td></tr>
      </table>
      <div class="section-title">Balance sheet — as of ${esc(effTo)}</div>
      <table>
        ${bs.assets.slice(0, 8).map((r) => row(r.account.name, r.amount)).join('')}
        ${row('Total assets', bs.totalAssets, 'total-row')}
        ${bs.liabilities.slice(0, 6).map((r) => row(r.account.name, r.amount)).join('')}
        ${row('Total liabilities + equity', bs.totalLiabilities + bs.totalEquity, 'grand')}
      </table>
      <div class="section-title">Cash flow — direct method</div>
      <table>
        ${row('Opening cash', cf.openingCash)}
        ${row('Net movement', cf.net)}
        ${row('Closing cash', cf.closingCash, 'total-row')}
      </table>
      <div class="section-title">Variance commentary — prepared by Atlas</div>
      <div class="notes">${commentary.map((c) => `<div style="margin-bottom:7px;">• ${esc(c)}</div>`).join('')}</div>
    `;
    openPrintWindow(brandedDocHtml({ ws, title: 'Board pack', subtitle: `${effFrom} → ${effTo}`, bodyHtml: body }), 'Board pack');
    log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'agent', kind: 'sync', message: `Board pack generated for ${effFrom} → ${effTo} with P&L, balance sheet, cash flow and ${commentary.length} commentary notes.` });
  };

  /**
   * Full Board of Directors report: financial statements under the company's
   * accounting framework, notes to the accounts, and a company-wide review
   * (sales & customers, vendors & AP, people, projects, fundraising, and
   * valuation) auto-compiled from the live data across every module.
   */
  const generateBODReport = () => {
    const ws = activeWorkspace();
    if (!ws) return;
    const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const row = (label: string, amount: number | string, cls = '') =>
      `<tr class="${cls}"><td>${esc(label)}</td><td class="num">${typeof amount === 'number' ? money(amount) : esc(amount)}</td></tr>`;

    // Budget vs. actuals (current fiscal year, if a budget exists)
    const fy = new Date(effTo).getFullYear();
    const fyBudget = budgets.find((b) => b.fiscalYear === fy);
    let budgetSection = '<p class="notes">No budget on file for the current fiscal year.</p>';
    if (fyBudget) {
      const fromIso = `${fy}-01-01`, toIso = `${fy}-12-31`;
      const revLines = fyBudget.lines.filter((l) => coa.find((a) => a.id === l.accountId)?.type === 'revenue');
      const expLines = fyBudget.lines.filter((l) => coa.find((a) => a.id === l.accountId)?.type === 'expense');
      const sumBudgeted = (lines: typeof revLines) => lines.reduce((s, l) => s + Object.values(l.monthly).reduce((a, b) => a + b, 0), 0);
      const sumActual = (lines: typeof revLines) => lines.reduce((s, l) => s + Object.values(computeAccountMonthlyActuals(journals, coa, l.accountId, fromIso, toIso)).reduce((a, b) => a + b, 0), 0);
      const revBudgeted = sumBudgeted(revLines), revActual = sumActual(revLines);
      const expBudgeted = sumBudgeted(expLines), expActual = sumActual(expLines);
      budgetSection = `<table>
        <tr><th>Line</th><th class="num">Budgeted</th><th class="num">Actual</th><th class="num">Variance</th></tr>
        <tr><td>Revenue</td><td class="num">${money(revBudgeted)}</td><td class="num">${money(revActual)}</td><td class="num">${money(revActual - revBudgeted)}</td></tr>
        <tr><td>Operating expense</td><td class="num">${money(expBudgeted)}</td><td class="num">${money(expActual)}</td><td class="num">${money(expActual - expBudgeted)}</td></tr>
      </table>`;
    }

    // Sales & customers
    const openPipeline = leads.filter((l) => l.stage !== 'won' && l.stage !== 'lost').reduce((s, l) => s + l.value, 0);
    const closedWon = leads.filter((l) => l.stage === 'won').reduce((s, l) => s + l.value, 0);

    // Vendors & AP
    const outstandingAP = bills.filter((b) => b.status !== 'paid').reduce((s, b) => s + b.amount, 0);

    // People
    const activeHeadcount = employees.filter((e) => e.status === 'active').length;
    const annualPayroll = employees.reduce((s, e) => s + e.salary, 0);

    // Projects
    const activeProjects = projects.filter((p) => p.status === 'active' || p.status === 'planning');
    const projectRows = projects.map((p) => {
      const actual = computeProjectActualSpend(finance, p.id);
      return row(`${p.name} (${PROJECT_STATUS_LABEL[p.status]})`, `${money(actual)} / ${money(p.budgetAmount)}`);
    }).join('');

    // Fundraising
    const fundraisingTotal = fundraising.reduce((s, f) => s + f.amount, 0);

    // Valuation
    const val = deriveValuation(finance, knowledge, ws, valuation);

    const body = `
      <div class="section-title">Accounting framework</div>
      <table>
        ${row('Framework', standard.label)}
        ${row('Standard-setter / regulator', standard.regulator)}
        ${row('Country of incorporation', ws.country || 'Not set')}
      </table>

      <div class="section-title">Executive summary — ${esc(effFrom)} → ${esc(effTo)}</div>
      <table>
        ${row('Revenue', pl.totalRevenue)}
        ${row('Net income', pl.netIncome)}
        ${row('Closing cash', cf.closingCash)}
        ${row('Active headcount', activeHeadcount)}
        ${row('Active / planned projects', activeProjects.length)}
        ${row('Open sales pipeline', openPipeline)}
      </table>

      <div class="section-title">${esc(standard.statementNames.incomeStatement)} — ${esc(effFrom)} → ${esc(effTo)}</div>
      <table>
        ${pl.revenueRows.map((r) => row(r.account.name, r.amount)).join('')}
        <tr class="total-row"><td>Total revenue</td><td class="num">${money(pl.totalRevenue)}</td></tr>
        ${pl.costRows.map((r) => row(r.account.name, r.amount)).join('')}
        ${row('Gross profit', pl.grossProfit, 'total-row')}
        ${pl.expenseRows.map((r) => row(r.account.name, r.amount)).join('')}
        ${row('Total operating expenses', pl.totalExpenses, 'total-row')}
        <tr class="grand"><td>Net income</td><td class="num">${money(pl.netIncome)}</td></tr>
      </table>

      <div class="section-title">${esc(standard.statementNames.balanceSheet)} — as of ${esc(effTo)}</div>
      <table>
        ${bs.assets.map((r) => row(r.account.name, r.amount)).join('')}
        ${row('Total assets', bs.totalAssets, 'total-row')}
        ${bs.liabilities.map((r) => row(r.account.name, r.amount)).join('')}
        ${row('Total equity', bs.totalEquity, 'total-row')}
        ${row('Total liabilities + equity', bs.totalLiabilities + bs.totalEquity, 'grand')}
      </table>

      <div class="section-title">${esc(standard.statementNames.cashFlow)}</div>
      <table>
        ${row('Opening cash', cf.openingCash)}
        ${row('Net movement', cf.net)}
        ${row('Closing cash', cf.closingCash, 'total-row')}
      </table>

      <div class="section-title">Budget vs. actuals — FY${fy}</div>
      ${budgetSection}

      <div class="section-title">Notes to the accounts</div>
      <div class="notes">
        ${standard.policyNotes.map((n) => `<div style="margin-bottom:6px;">${esc(n)}</div>`).join('')}
        <div style="margin-top:8px;">This report is auto-compiled from the company's live ledger, CRM, HR, project and fundraising records and has not been audited.</div>
      </div>

      <div class="section-title">Sales &amp; customers</div>
      <table>
        ${row('Customer accounts', customers.length)}
        ${row('Open pipeline', openPipeline)}
        ${row('Closed-won (period)', closedWon)}
        ${row('Open invoices (AR)', invoices.filter((i) => i.status !== 'paid' && i.status !== 'draft').reduce((s, i) => s + i.amount, 0))}
      </table>

      <div class="section-title">Vendors &amp; accounts payable</div>
      <table>
        ${row('Active vendors', vendors.filter((v) => v.status === 'active').length)}
        ${row('Outstanding AP', outstandingAP)}
      </table>

      <div class="section-title">People</div>
      <table>
        ${row('Active headcount', activeHeadcount)}
        ${row('Annualised payroll', annualPayroll)}
        ${row('AI agent fleet', agents.length)}
      </table>

      <div class="section-title">Projects</div>
      <table>${projectRows || '<tr><td>No projects on file.</td></tr>'}</table>

      <div class="section-title">Fundraising</div>
      <table>
        ${row('Opportunities tracked', fundraising.length)}
        ${row('Total potential funding', fundraisingTotal)}
      </table>

      <div class="section-title">Company valuation</div>
      <table>
        ${row('Fair market value (blended)', val.fmv)}
        ${row('Revenue multiple applied', `${val.multiple}×`)}
        ${row('Implied growth', `${val.growthPct}% (${val.growthSource === 'trailing-actuals' ? "from the company's own trailing revenue" : 'industry-proxy estimate — not enough ledger history yet'})`)}
        ${row('Range (bear – bull)', `${money(val.floor)}  –  ${money(val.ceiling)}`)}
      </table>
      <div class="notes">This is a comparable-multiple estimate grounded in the company's own ledger and industry revenue-multiple bands, not a live market data feed — see Company → Valuation for methodology and to override with a current comparable-transaction multiple.</div>

      <div class="section-title">Governance &amp; risk commentary — prepared by Atlas</div>
      <div class="notes">${commentary.map((c) => `<div style="margin-bottom:7px;">• ${esc(c)}</div>`).join('')}</div>
    `;
    openPrintWindow(brandedDocHtml({ ws, title: 'Board of Directors Report', subtitle: `${standard.label} — ${effFrom} → ${effTo}`, bodyHtml: body }), 'Board of Directors Report');
    log({ agentId: 'a-strategy', agentName: 'Elara', actor: 'agent', kind: 'sync', message: `Full Board of Directors report generated for ${effFrom} → ${effTo} under ${standard.label}.` });
  };

  // ── Equity statement ──────────────────────────────────────────────────────
  const equityStmt = useMemo(() => {
    const opening = coa.filter((a) => a.type === 'equity').reduce((s, a) => s + bal(a.id, openingDeltas), 0);
    const rows = coa
      .filter((a) => a.type === 'equity' && periodDeltas.get(a.id))
      .map((a) => ({ account: a, movement: bal(a.id, periodDeltas) }));
    const contributions = rows.reduce((s, r) => s + Math.max(0, r.movement), 0);
    const drawings = rows.reduce((s, r) => s + Math.min(0, r.movement), 0);
    const closing = opening + contributions + drawings + pl.netIncome;
    return { opening, rows, contributions, drawings, netIncome: pl.netIncome, closing };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coa, openingDeltas, periodDeltas, pl.netIncome]);

  // ── Ratios ────────────────────────────────────────────────────────────────
  const ratios = useMemo(() => {
    const totalCurrentAssets = sumType('asset', cumulativeDeltas); // simplified: all assets treated as current
    const cash = coa.filter((a) => a.isCash).reduce((s, a) => s + bal(a.id, cumulativeDeltas), 0);
    const ar = coa.filter((a) => a.name.toLowerCase().includes('receivable')).reduce((s, a) => s + bal(a.id, cumulativeDeltas), 0);
    const totalLiabilities = sumType('liability', cumulativeDeltas);
    const totalEquity = bs.totalEquity;
    const totalAssets = bs.totalAssets;
    const revenue = pl.totalRevenue;
    const netIncome = pl.netIncome;
    const div = (a: number, b: number): number | null => (b === 0 ? null : a / b);
    const periodDays = Math.max(1, Math.round((new Date(effTo).getTime() - new Date(effFrom).getTime()) / 86400000));
    const list: { name: string; value: number | null; fmt: 'x' | '%' | 'd' | 'money'; formula: string; good?: (v: number) => boolean }[] = [
      { name: 'Current ratio', value: div(totalCurrentAssets, totalLiabilities), fmt: 'x', formula: 'Current assets ÷ current liabilities', good: (v) => v >= 1.5 },
      { name: 'Quick ratio', value: div(cash + ar, totalLiabilities), fmt: 'x', formula: '(Cash + receivables) ÷ current liabilities', good: (v) => v >= 1 },
      { name: 'Working capital', value: totalCurrentAssets - totalLiabilities, fmt: 'money', formula: 'Current assets − current liabilities' },
      { name: 'Debt-to-equity', value: div(totalLiabilities, totalEquity), fmt: 'x', formula: 'Total liabilities ÷ total equity', good: (v) => v <= 2 },
      { name: 'Net profit margin', value: div(netIncome, revenue), fmt: '%', formula: 'Net income ÷ revenue', good: (v) => v >= 0.1 },
      { name: 'Return on assets', value: div(netIncome, totalAssets), fmt: '%', formula: 'Net income ÷ total assets', good: (v) => v >= 0.05 },
      { name: 'Return on equity', value: div(netIncome, totalEquity), fmt: '%', formula: 'Net income ÷ total equity', good: (v) => v >= 0.1 },
      { name: 'AR turnover (annualised)', value: revenue > 0 ? div((revenue * 365) / periodDays, ar) : null, fmt: 'x', formula: 'Annualised revenue ÷ accounts receivable', good: (v) => v >= 4 },
      { name: 'Days sales outstanding', value: ar > 0 && revenue > 0 ? div((ar * periodDays), revenue) : null, fmt: 'd', formula: 'AR ÷ revenue × period days', good: (v) => v <= 45 },
    ];
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coa, cumulativeDeltas, pl, bs, from, to]);

  // ── Trial balance report ──────────────────────────────────────────────────
  // Double-entry (IFRS): the balance's *sign* decides the column — net debits
  // go to Dr, net credits to Cr — so total Dr always equals total Cr.
  const tbRows = useMemo(
    () =>
      coa
        .map((a) => {
          const { dr, cr } = splitDrCr(cumulativeDeltas.get(a.id) ?? 0);
          return { account: a, debits: dr, credits: cr };
        })
        .filter((r) => r.debits || r.credits),
    [coa, cumulativeDeltas],
  );

  // ── Account transactions ──────────────────────────────────────────────────
  // Dr / Cr columns are the actual posted amounts; the running balance is the
  // true balance (debit-positive — a negative running balance is a credit balance).
  const acctTxn = useMemo(() => {
    const acct = accountById.get(safeTxnAccount);
    if (!acct) return null;
    const starting = openingDeltas.get(safeTxnAccount) ?? 0;
    let running = starting;
    const rows = posted
      .filter((j) => j.dateIso >= from && j.dateIso <= to && j.lines.some((l) => l.accountId === txnAccount))
      .sort((a, b) => (a.dateIso < b.dateIso ? -1 : 1))
      .map((j) => {
        const line = j.lines.find((l) => l.accountId === safeTxnAccount)!;
        running += line.debit - line.credit;
        return { date: j.dateIso, memo: j.memo, reference: j.reference, debit: line.debit, credit: line.credit, running };
      });
    return { acct, starting, rows };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txnAccount, accountById, openingDeltas, posted, from, to]);

  // ── Account balances ──────────────────────────────────────────────────────
  /** Gross posted debits / credits per account for from ≤ dateIso ≤ to. */
  const periodDrCr = useMemo(() => {
    const map = new Map<string, { dr: number; cr: number }>();
    posted
      .filter((j) => j.dateIso >= effFrom && j.dateIso <= effTo)
      .forEach((j) =>
        j.lines.forEach((l) => {
          const cur = map.get(l.accountId) ?? { dr: 0, cr: 0 };
          cur.dr += l.debit;
          cur.cr += l.credit;
          map.set(l.accountId, cur);
        }),
      );
    return map;
  }, [posted, effFrom, effTo]);

  // True double-entry balances: starting/ending are actual balances
  // (debit-positive — negative is a credit balance); Dr / Cr are what was posted.
  const acctBal = useMemo(
    () =>
      coa.map((a) => {
        const starting = openingDeltas.get(a.id) ?? 0;
        const move = periodDrCr.get(a.id) ?? { dr: 0, cr: 0 };
        const movement = move.dr - move.cr;
        return { account: a, starting, debit: move.dr, credit: move.cr, movement, ending: starting + movement };
      }),
    [coa, openingDeltas, periodDrCr],
  );

  // ── Budget vs. Actuals ────────────────────────────────────────────────────
  const budgetActual = useMemo(() => {
    if (!activeBudget) return null;
    const fromIso = `${activeBudget.fiscalYear}-01-01`;
    const toIso = `${activeBudget.fiscalYear}-12-31`;
    const rows = activeBudget.lines
      .map((line) => {
        const account = accountById.get(line.accountId);
        if (!account) return null;
        const budgeted = Object.values(line.monthly).reduce((s, v) => s + v, 0);
        const actualByMonth = computeAccountMonthlyActuals(journals, coa, account.id, fromIso, toIso);
        const actual = Object.values(actualByMonth).reduce((s, v) => s + v, 0);
        const variance = actual - budgeted;
        const variancePct = budgeted !== 0 ? (variance / Math.abs(budgeted)) * 100 : null;
        return { account, budgeted, actual, variance, variancePct };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    const byType = (type: GlAccount['type']) => rows.filter((r) => r.account.type === type);
    const sum = (list: typeof rows, key: 'budgeted' | 'actual' | 'variance') => list.reduce((s, r) => s + r[key], 0);
    return { rows, byType, sum };
     
  }, [activeBudget, journals, coa, accountById]);

  const preset = (kind: 'month' | 'quarter' | 'year' | 'lastyear' | 'all') => {
    const now = new Date();
    if (kind === 'month') {
      setFrom(isoStartOfMonth(today));
      setTo(today);
    } else if (kind === 'quarter') {
      const q = Math.floor(now.getUTCMonth() / 3);
      const start = new Date(Date.UTC(now.getUTCFullYear(), q * 3, 1));
      setFrom(start.toISOString().slice(0, 10));
      setTo(today);
    } else if (kind === 'year') {
      setFrom(`${today.slice(0, 4)}-01-01`);
      setTo(today);
    } else if (kind === 'lastyear') {
      const y = Number(today.slice(0, 4)) - 1;
      setFrom(`${y}-01-01`);
      setTo(`${y}-12-31`);
    } else {
      setFrom('2000-01-01');
      setTo(today);
    }
  };

  const reportFileSlug = () => {
    const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'company';
    return `${slug(activeWorkspace()?.name ?? 'report')}-${report}-${effFrom}-to-${effTo}`;
  };

  /** Company identity block shared by the CSV and Excel exports (mirrors csvWithHeader). */
  const csvCompanyLines = (ws: NonNullable<ReturnType<typeof activeWorkspace>>, docTitle: string): string[] => [
    ws.legalName || ws.name,
    docTitle,
    `${effFrom} → ${effTo}`,
    [ws.addressLine ?? '', ws.city ?? '', ws.state ?? '', ws.country ?? ''].filter(Boolean).join(', '),
    [ws.businessNumber && `Business No: ${ws.businessNumber}`, ws.taxNumber && `Tax No: ${ws.taxNumber}`]
      .filter(Boolean).join('  |  '),
    [ws.email ?? '', ws.website ?? ''].filter(Boolean).join('  | '),
    `Generated ${new Date().toLocaleString()}`,
  ];

  /**
   * One grid per report — headers plus rows with real numbers so Excel can
   * add them. CSV, Excel and Print all derive from it, so the three exports
   * can never disagree with each other.
   */
  const buildReportGrid = (): { title: string; columns: string[]; rows: Array<Array<string | number>> } => {
    const title = reportLabel(report);
    const amt = `Amount (${currency})`;
    type Row = Array<string | number>;
    if (report === 'pl') {
      return {
        title,
        columns: ['Section', 'Account', amt],
        rows: [
          ...pl.revenueRows.map((r): Row => ['Revenue', r.account.name, r.amount]),
          ['Revenue', 'Total revenue', pl.totalRevenue],
          ...pl.costRows.map((r): Row => ['Cost of sales', r.account.name, r.amount]),
          ['Cost of sales', 'Total cost of sales', pl.totalCost],
          ['', 'Gross profit', pl.grossProfit],
          ...pl.expenseRows.map((r): Row => ['Expenses', r.account.name, r.amount]),
          ['Expenses', 'Total operating expenses', pl.totalExpenses],
          ['', 'NET INCOME', pl.netIncome],
        ],
      };
    }
    if (report === 'bs') {
      return {
        title,
        columns: ['Section', 'Account', amt],
        rows: [
          ...bs.assets.map((r): Row => ['Assets', r.account.name, r.amount]),
          ['Assets', 'Total assets', bs.totalAssets],
          ...bs.liabilities.map((r): Row => ['Liabilities', r.account.name, r.amount]),
          ['Liabilities', 'Total liabilities', bs.totalLiabilities],
          ...bs.equityAccounts.map((r): Row => ['Equity', r.account.name, r.amount]),
          ['Equity', 'Current earnings', bs.currentEarnings],
          ['Equity', 'Total equity', bs.totalEquity],
        ],
      };
    }
    if (report === 'cf') {
      return {
        title,
        columns: ['Activity', 'Memo', amt],
        rows: [
          ...(['operating', 'investing', 'financing'] as const).flatMap((k): Row[] =>
            cf.byActivity(k).map((r): Row => [k, r.label, r.amount]),
          ),
          ['', 'Opening cash', cf.openingCash],
          ['', 'Net change', cf.net],
          ['', 'Closing cash', cf.closingCash],
        ],
      };
    }
    if (report === 'equity') {
      return {
        title,
        columns: ['Line', amt],
        rows: [
          ['Opening equity', equityStmt.opening],
          ...equityStmt.rows.map((r): Row => [r.account.name, r.movement]),
          ['Net income', equityStmt.netIncome],
          ['Closing equity', equityStmt.closing],
        ],
      };
    }
    if (report === 'ratios') {
      return {
        title,
        columns: ['Ratio', 'Value', 'Formula'],
        rows: ratios.map((r): Row => [r.name, r.value === null ? '' : fmtRatio(r), r.formula]),
      };
    }
    if (report === 'tb') {
      return {
        title,
        columns: ['Code', 'Account', 'Type', 'Dr', 'Cr'],
        rows: tbRows.map((r): Row => [r.account.code, r.account.name, r.account.type, r.debits, r.credits]),
      };
    }
    if (report === 'acct-txn' && acctTxn) {
      return {
        title,
        columns: ['Date', 'Memo', 'Dr', 'Cr', 'Running balance'],
        rows: [
          ['', 'Starting balance', '', '', acctTxn.starting],
          ...acctTxn.rows.map((r): Row => [r.date, r.memo, r.debit, r.credit, r.running]),
        ],
      };
    }
    if (report === 'acct-bal') {
      return {
        title,
        columns: ['Code', 'Account', 'Starting balance', 'Dr', 'Cr', 'Net movement', 'Ending balance'],
        rows: acctBal.map((r): Row => [r.account.code, r.account.name, r.starting, r.debit, r.credit, r.movement, r.ending]),
      };
    }
    if (report === 'budget-actual' && budgetActual && activeBudget) {
      return {
        title: `Budget vs Actuals — ${activeBudget.name} (FY${activeBudget.fiscalYear})`,
        columns: ['Account', 'Type', 'Budgeted', 'Actual', 'Variance', 'Variance %'],
        rows: budgetActual.rows.map((r): Row => [
          r.account.name, r.account.type, r.budgeted, r.actual, r.variance,
          r.variancePct === null ? '' : `${r.variancePct.toFixed(1)}%`,
        ]),
      };
    }
    return { title, columns: [], rows: [] };
  };

  /** Branded CSV export: the company identity block plus the active report. */
  const exportCsv = () => {
    const ws = activeWorkspace();
    if (!ws) return;
    const grid = buildReportGrid();
    const body = [grid.columns, ...grid.rows].map((r) => r.map((c) => String(c)));
    // Byte order mark so Excel reads accents correctly.
    const csv = '﻿' + csvWithHeader(ws, grid.title, `${effFrom} → ${effTo}`, body);
    downloadTextFile(`${reportFileSlug()}.csv`, csv, 'text/csv');
    log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'sync', message: `${grid.title} exported as CSV (${effFrom} → ${effTo}).` });
  };

  /** Branded Excel export (.xlsx): company block on top, amounts as real numbers. */
  const exportExcel = async () => {
    const ws = activeWorkspace();
    if (!ws) return;
    const grid = buildReportGrid();
    const digits = currencyDigits(currency);
    const numFormat = `#,##0${digits > 0 ? '.' + '0'.repeat(digits) : ''}`;
    const numCell = (v: number) => ({ value: v, format: numFormat, align: 'right' as const });
    const txtCell = (v: string, bold = false) => (bold ? { value: v, fontWeight: 'bold' as const } : { value: v });
    const data = [
      ...csvCompanyLines(ws, grid.title).map((l) => [txtCell(l, true)]),
      [],
      grid.columns.map((c) => txtCell(c, true)),
      ...grid.rows.map((r) => r.map((c) => (c === '' ? null : typeof c === 'number' ? numCell(c) : txtCell(c)))),
    ];
    // Loaded on demand: the spreadsheet writer is only needed when someone exports.
    const { default: writeExcelFile } = await import('write-excel-file/browser');
    const blob = await writeExcelFile([{
      sheet: grid.title.slice(0, 31) || 'Report',
      columns: grid.columns.map((_, i) => ({ width: grid.columns.length > 4 ? 20 : i === 1 ? 44 : i === 0 ? 26 : 22 })),
      data,
    }] as never).toBlob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${reportFileSlug()}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'sync', message: `${grid.title} exported as Excel (${effFrom} → ${effTo}).` });
  };

  /** Print the active report through the company-branded template (Save as PDF). */
  const printReport = () => {
    const ws = activeWorkspace();
    if (!ws) return;
    const grid = buildReportGrid();
    const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const cell = (c: string | number) =>
      typeof c === 'number' ? `<td class="num">${money(c)}</td>` : `<td>${esc(c)}</td>`;
    const body = `
      <table>
        <thead><tr>${grid.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>${grid.rows.map((r) => `<tr>${r.map(cell).join('')}</tr>`).join('')}</tbody>
      </table>
      <div class="notes">Prepared from the posted general ledger of ${esc(ws.legalName || ws.name)} — ${esc(effFrom)} → ${esc(effTo)}. Figures in ${esc(currency)}.</div>
    `;
    openPrintWindow(brandedDocHtml({ ws, title: grid.title, subtitle: `${effFrom} → ${effTo}`, bodyHtml: body }), grid.title);
    log({ agentId: 'a-finance', agentName: 'Ledger', actor: 'user', kind: 'sync', message: `${grid.title} sent to print (${effFrom} → ${effTo}).` });
  };

  const fmtRatio = (r: { value: number | null; fmt: 'x' | '%' | 'd' | 'money' }): string => {
    if (r.value === null) return '…';
    if (r.fmt === 'x') return `${r.value.toFixed(2)}×`;
    if (r.fmt === '%') return `${(r.value * 100).toFixed(1)}%`;
    if (r.fmt === 'd') return `${Math.round(r.value)} days`;
    return money(r.value);
  };

  const Row = ({ label, value, strong, indent, note }: { label: string; value: number | string; strong?: boolean; indent?: boolean; note?: string }) => (
    <div className={cn('flex items-center justify-between border-b py-2 last:border-0', strong && 'border-t-2 border-foreground/20 font-semibold', indent && 'pl-4')}>
      <span className={cn('text-sm', strong ? 'font-semibold' : 'text-foreground/90')}>
        {label}
        {note && <span className="ml-2 text-[11px] font-normal text-muted-foreground">{note}</span>}
      </span>
      <span className={cn('font-mono text-sm', typeof value === 'number' && value < 0 && 'text-rose-500')}>{typeof value === 'number' ? money(value) : value}</span>
    </div>
  );

  return (
    <div className="borga-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle title="Financial reports" sub={`Generated from the posted general ledger — ${activeWorkspace()?.name ?? ''}`} />
        <div className="flex gap-2">
          <Button variant="outline" onClick={generateBODReport} title="Full Board of Directors report: financial statements, notes to the accounts, and a company-wide review">
            <FileText className="h-4 w-4" /> Full BOD report
          </Button>
          <Button variant="outline" onClick={openBoardPack} title="Branded PDF: exec summary, P&L, balance sheet, cash flow and agent commentary">
            <Sparkles className="h-4 w-4" /> Board pack
          </Button>
          <Button variant="outline" onClick={exportCsv} title="Branded CSV of the active report with the company header">
            <Download className="h-4 w-4" /> Export CSV
          </Button>
          <Button variant="outline" onClick={exportExcel} title="Branded Excel workbook (.xlsx) of the active report with the company header">
            <FileSpreadsheet className="h-4 w-4" /> Export Excel
          </Button>
          <Button variant="outline" onClick={printReport} title="Print the active report through the company-branded template (Save as PDF)">
            <Printer className="h-4 w-4" /> Print
          </Button>
        </div>
      </div>

      <Card className="flex flex-wrap items-center justify-between gap-2 p-3">
        <p className="text-xs text-muted-foreground">
          Reporting under <span className="font-medium text-foreground">{standard.label}</span>
        </p>
        <Badge variant="outline" className="text-[10px]">{standard.framework}</Badge>
      </Card>

      {/* Agent variance commentary */}
      <Card className="p-4">
        <p className="flex items-center gap-1.5 text-sm font-semibold"><Sparkles className="h-4 w-4 text-violet-500" /> Atlas commentary — {effFrom} → {effTo}</p>
        <ul className="mt-2 space-y-1.5">
          {commentary.map((c, i) => (
            <li key={i} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-violet-500" /> {c}
            </li>
          ))}
        </ul>
      </Card>

      {/* Report picker */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
        {REPORTS.map((r) => {
          const Icon = r.icon;
          return (
            <button
              key={r.id}
              onClick={() => setReport(r.id)}
              title={r.blurb}
              className={cn(
                'flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition-colors',
                report === r.id ? 'border-primary/50 bg-primary/5 text-foreground' : 'text-muted-foreground hover:bg-muted/40',
              )}
            >
              <Icon className={cn('h-4 w-4', report === r.id && 'text-primary')} />
              <span className="text-[11px] font-medium leading-tight">{reportLabel(r.id)}</span>
            </button>
          );
        })}
      </div>


      {/* Period controls */}
      <Card className="flex flex-wrap items-end gap-3 p-4">
        <div>
          <p className="text-[11px] font-medium text-muted-foreground">From</p>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 w-40" />
        </div>
        <div>
          <p className="text-[11px] font-medium text-muted-foreground">To</p>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 w-40" />
        </div>
        <div className="pb-0.5">
          <div className="flex flex-wrap gap-1.5">
            {(['month', 'quarter', 'year', 'lastyear', 'all'] as const).map((k) => (
              <Button key={k} size="sm" variant="outline" className="h-8 text-xs" onClick={() => preset(k)}>
                {k === 'month' ? 'This month' : k === 'quarter' ? 'This quarter' : k === 'year' ? 'This year' : k === 'lastyear' ? 'Last year' : 'All time'}
              </Button>
            ))}
          </div>
        </div>
        {lastClosureEnd && (
          <Badge variant="outline" className="ml-auto text-[10px]">
            Books closed through {lastClosureEnd}
          </Badge>
        )}
      </Card>

      {/* Summary / details toggle (analytical reports) */}
      {['pl', 'bs', 'cf', 'equity', 'acct-bal'].includes(report) && (
        <div className="flex justify-center">
          <div className="flex rounded-lg bg-muted p-1 text-xs">
            {(['summary', 'details'] as const).map((m) => (
              <button key={m} onClick={() => setDetail(m)} className={cn('rounded-md px-4 py-1.5 font-medium capitalize', detail === m ? 'bg-background shadow-sm' : 'text-muted-foreground')}>
                {m}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── P&L ─────────────────────────────────────────────────────────────── */}
      {report === 'pl' && (
        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold">{standard.statementNames.incomeStatement}</h3>
              <p className="text-xs text-muted-foreground">{effFrom} → {effTo}</p>
            </div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-600">Revenue</p>
            {detail === 'details' && pl.revenueRows.map((r) => <Row key={r.account.id} label={r.account.name} value={r.amount} indent />)}
            <Row label="Total revenue" value={pl.totalRevenue} strong />
            <p className="mb-1 mt-4 text-[11px] font-semibold uppercase tracking-wide text-amber-600">Cost of sales</p>
            {detail === 'details' && pl.costRows.map((r) => <Row key={r.account.id} label={r.account.name} value={r.amount} indent />)}
            <Row label="Total cost of sales" value={pl.totalCost} strong />
            <div className="mt-4">
              <Row label="Gross profit" value={pl.grossProfit} strong />
            </div>
            <p className="mb-1 mt-4 text-[11px] font-semibold uppercase tracking-wide text-rose-500">Operating expenses</p>
            {detail === 'details' && pl.expenseRows.map((r) => <Row key={r.account.id} label={r.account.name} value={r.amount} indent />)}
            <Row label="Total operating expenses" value={pl.totalExpenses} strong />
            <div className="mt-4">
              <Row label="Net income" value={pl.netIncome} strong />
            </div>
          </Card>
          <Card className="h-fit p-5">
            <p className="text-sm font-semibold">Prior period</p>
            <p className="text-[11px] text-muted-foreground">Equal-length comparison</p>
              <div className="mt-3 space-y-2.5 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Revenue</span><span className="font-mono text-xs">{money(plPrior.revenue)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Cost of sales</span><span className="font-mono text-xs">{money(plPrior.cost)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Expenses</span><span className="font-mono text-xs">{money(plPrior.expenses)}</span></div>
                <div className="flex justify-between border-t pt-2 font-semibold"><span>Net income</span><span className="font-mono text-xs">{money(plPrior.net)}</span></div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Change</span>
                <span>{plPrior.net !== 0 ? `${(((pl.netIncome - plPrior.net) / Math.abs(plPrior.net)) * 100).toFixed(0)}%` : '…'}</span>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* ── Balance Sheet ───────────────────────────────────────────────────── */}
      {report === 'bs' && (
        <div className="space-y-4">
          <Card className="grid grid-cols-3 divide-x p-4 text-center">
            <div>
              <p className="text-xs text-muted-foreground">Total Assets</p>
              <p className="text-xl font-bold">{money(bs.totalAssets)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Liabilities</p>
              <p className="text-xl font-bold">{money(bs.totalLiabilities)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Net Assets (Equity)</p>
              <p className={cn('text-xl font-bold', bs.balanced ? 'text-emerald-600' : 'text-destructive')}>{money(bs.totalEquity)}</p>
            </div>
          </Card>
          {!bs.balanced && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2.5 text-xs text-destructive">
              Out of balance by {money(bs.totalAssets - bs.totalLiabilities - bs.totalEquity)} — post or correct journal entries to reconcile.
            </p>
          )}
          {detail === 'details' ? (
            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="p-5">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-sky-600">Assets</p>
                {bs.assets.map((r) => <Row key={r.account.id} label={r.account.name} value={r.amount} indent />)}
                <Row label="Total assets" value={bs.totalAssets} strong />
              </Card>
              <Card className="p-5">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-amber-600">Liabilities</p>
                {bs.liabilities.map((r) => <Row key={r.account.id} label={r.account.name} value={r.amount} indent />)}
                <Row label="Total liabilities" value={bs.totalLiabilities} strong />
              </Card>
              <Card className="p-5">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-violet-600">Equity</p>
                {bs.equityAccounts.map((r) => <Row key={r.account.id} label={r.account.name} value={r.amount} indent />)}
                <Row label="Current earnings" value={bs.currentEarnings} indent note={lastClosureEnd ? `since ${lastClosureEnd}` : 'since inception'} />
                <Row label="Total equity" value={bs.totalEquity} strong />
              </Card>
            </div>
          ) : (
            <Card className="p-5">
              <Row label="Total assets" value={bs.totalAssets} />
              <Row label="Total liabilities" value={bs.totalLiabilities} />
              <Row label="Total equity (incl. current earnings)" value={bs.totalEquity} />
              <Row label="Liabilities + equity" value={bs.totalLiabilities + bs.totalEquity} strong />
            </Card>
          )}
        </div>
      )}

      {/* ── Cash Flow ───────────────────────────────────────────────────────── */}
      {report === 'cf' && (
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-base font-semibold">{standard.statementNames.cashFlow} (direct method)</h3>
            <p className="text-xs text-muted-foreground">{effFrom} → {effTo}</p>
          </div>
          {(['operating', 'investing', 'financing'] as const).map((k) => {
            const rows = cf.byActivity(k);
            const total = rows.reduce((s, r) => s + r.amount, 0);
            const label = k === 'operating' ? 'Operating activities' : k === 'investing' ? 'Investing activities' : 'Financing activities';
            return (
              <div key={k} className="mb-4">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
                {rows.length === 0 && <p className="py-1 pl-4 text-xs text-muted-foreground">No movements</p>}
                {detail === 'details' && rows.map((r, i) => <Row key={`${k}-${i}`} label={r.label} value={r.amount} indent />)}
                <Row label={`Net cash from ${k} activities`} value={total} strong />
              </div>
            );
          })}
          <Row label="Opening cash & equivalents" value={cf.openingCash} />
          <Row label="Net change in cash" value={cf.net} />
          <Row label="Closing cash & equivalents" value={cf.closingCash} strong />
        </Card>
      )}

      {/* ── Equity statement ────────────────────────────────────────────────── */}
      {report === 'equity' && (
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-base font-semibold">{standard.statementNames.equity}</h3>
            <p className="text-xs text-muted-foreground">{effFrom} → {effTo}</p>
          </div>
          <Row label="Opening equity" value={equityStmt.opening} />
          {detail === 'details' && equityStmt.rows.map((r) => (
            <Row key={r.account.id} label={r.account.name} value={r.movement} indent note={r.movement >= 0 ? 'contribution' : 'drawings'} />
          ))}
          <Row label="Net income for the period" value={equityStmt.netIncome} indent />
          <Row label="Closing equity" value={equityStmt.closing} strong />
        </Card>
      )}

      {/* ── Ratios ──────────────────────────────────────────────────────────── */}
      {report === 'ratios' && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {ratios.map((r) => {
            const healthy = r.good && r.value !== null ? r.good(r.value) : null;
            return (
              <Card key={r.name} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium">{r.name}</p>
                  {healthy !== null && (
                    <Badge className={cn('text-[9px]', healthy ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600')}>
                      {healthy ? 'healthy' : 'watch'}
                    </Badge>
                  )}
                </div>
                <p className="mt-1.5 text-2xl font-bold">{fmtRatio(r)}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{r.formula}</p>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── Trial balance ───────────────────────────────────────────────────── */}
      {report === 'tb' && (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-2.5">
            <p className="text-sm font-semibold">Trial Balance — as of {effTo}</p>
            <Badge variant="outline" className="text-[10px]">post-closing entries included</Badge>
          </div>
          <p className="border-b bg-muted/20 px-4 py-1.5 text-[11px] text-muted-foreground" title={DR_CR_LEGEND}>
            Double-entry (IFRS): net debit balances → Dr, net credit balances → Cr. {DR_CR_LEGEND}
          </p>
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr><th className="px-4 py-2 font-medium">Account</th><th className="px-4 py-2 font-medium">Type</th><th className="px-4 py-2 text-right font-medium" title="Debit balance">Dr</th><th className="px-4 py-2 text-right font-medium" title="Credit balance">Cr</th></tr>
            </thead>
            <tbody>
              {tbRows.map((r) => (
                <tr key={r.account.id} className="border-b last:border-0 hover:bg-muted/20" title={ACCOUNT_SIDE_HINT[r.account.type]}>
                  <td className="px-4 py-2"><span className="mr-2 font-mono text-xs text-muted-foreground">{r.account.code}</span>{r.account.name}</td>
                  <td className="px-4 py-2"><span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-semibold capitalize ring-1', ACCOUNT_TYPE_STYLE[r.account.type])}>{r.account.type}</span></td>
                  <td className="px-4 py-2 text-right font-mono text-xs">{r.debits ? money(r.debits) : '…'}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">{r.credits ? money(r.credits) : '…'}</td>
                </tr>
              ))}
              <tr className="bg-muted/40 font-semibold">
                <td className="px-4 py-2" colSpan={2}>Totals</td>
                <td className="px-4 py-2 text-right font-mono text-xs">{money(tbRows.reduce((s, r) => s + r.debits, 0))}</td>
                <td className="px-4 py-2 text-right font-mono text-xs">{money(tbRows.reduce((s, r) => s + r.credits, 0))}</td>
              </tr>
            </tbody>
          </table>
        </Card>
      )}

      {/* ── Account transactions ────────────────────────────────────────────── */}
      {report === 'acct-txn' && (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-end gap-3 border-b bg-muted/40 px-4 py-3">
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">Account</p>
              <AccountSelect
                value={acctTxn?.acct?.id ?? safeTxnAccount}
                onChange={(v) => setTxnAccount(v ?? safeTxnAccount)}
                placeholder="Select account…"
              />
            </div>
            {acctTxn && (
              <p className="ml-auto text-xs text-muted-foreground" title={acctTxn.acct ? ACCOUNT_SIDE_HINT[acctTxn.acct.type] : undefined}>
                {acctTxn.acct ? `${acctTxn.acct.name} — ${NORMAL_SIDE_SHORT[acctTxn.acct.type]} · ` : ''}
                Starting balance <span className="font-mono">{money(acctTxn.starting)}</span> — {acctTxn.rows.length} entries
              </p>
            )}
          </div>
          {acctTxn && (
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr><th className="px-4 py-2 font-medium">Date</th><th className="px-4 py-2 font-medium">Description</th><th className="px-4 py-2 text-right font-medium" title="Debits posted">Dr</th><th className="px-4 py-2 text-right font-medium" title="Credits posted">Cr</th><th className="px-4 py-2 text-right font-medium" title="True balance (debit-positive; negative = credit balance)">Running balance</th></tr>
              </thead>
              <tbody>
                {acctTxn.rows.map((r, i) => (
                  <tr key={i} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="whitespace-nowrap px-4 py-2 text-xs">{r.date}</td>
                    <td className="px-4 py-2">{r.memo}{r.reference && <span className="ml-2 text-[11px] text-muted-foreground">ref {r.reference}</span>}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">{r.debit ? money(r.debit) : '…'}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">{r.credit ? money(r.credit) : '…'}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs font-medium" title={r.running < 0 ? 'Credit balance' : 'Debit balance'}>{money(r.running)}{r.running !== 0 ? <span className="ml-1 text-[10px] font-normal text-muted-foreground">{r.running < 0 ? 'Cr' : 'Dr'}</span> : null}</td>
                  </tr>
                ))}
                {acctTxn.rows.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-xs text-muted-foreground">No activity in this period.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {/* ── Account balances ────────────────────────────────────────────────── */}
      {report === 'acct-bal' && (
        <Card className="overflow-x-auto">
          <p className="border-b bg-muted/20 px-4 py-1.5 text-[11px] text-muted-foreground" title={DR_CR_LEGEND}>
            Double-entry (IFRS): Dr and Cr are what was posted; negative starting / ending / net = credit balance. {DR_CR_LEGEND}
          </p>
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Account</th>
                <th className="px-4 py-2 text-right font-medium" title="Balance at the start of the period (negative = credit balance)">Starting</th>
                <th className="px-4 py-2 text-right font-medium" title="Debits posted in the period">Dr</th>
                <th className="px-4 py-2 text-right font-medium" title="Credits posted in the period">Cr</th>
                <th className="px-4 py-2 text-right font-medium" title="Dr minus Cr for the period">Net movement</th>
                <th className="px-4 py-2 text-right font-medium" title="Balance at the end of the period (negative = credit balance)">Ending</th>
              </tr>
            </thead>
            <tbody>
              {(['asset', 'liability', 'equity', 'revenue', 'cost', 'expense'] as const).map((type) => {
                const allRows = acctBal.filter((r) => r.account.type === type && (r.starting || r.debit || r.credit || r.ending));
                if (allRows.length === 0) return null;
                const rows = detail === 'summary'
                  ? [{
                      account: { id: `${type}-total`, code: '', name: `Total ${type}s`, type },
                      starting: allRows.reduce((s2, r) => s2 + r.starting, 0),
                      debit: allRows.reduce((s2, r) => s2 + r.debit, 0),
                      credit: allRows.reduce((s2, r) => s2 + r.credit, 0),
                      movement: allRows.reduce((s2, r) => s2 + r.movement, 0),
                      ending: allRows.reduce((s2, r) => s2 + r.ending, 0),
                    }]
                  : allRows;
                return (
                  <Fragment key={`h-${type}`}>
                    <tr className="bg-muted/20">
                      <td colSpan={6} className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground" title={ACCOUNT_SIDE_HINT[type]}>{type}s · {NORMAL_SIDE_SHORT[type]}</td>
                    </tr>
                    {rows.map((r) => (
                      <tr key={r.account.id} className="border-b last:border-0 hover:bg-muted/20" title={ACCOUNT_SIDE_HINT[r.account.type as keyof typeof ACCOUNT_SIDE_HINT]}>
                        <td className="px-4 py-2"><span className="mr-2 font-mono text-xs text-muted-foreground">{r.account.code}</span>{r.account.name}</td>
                        <td className="px-4 py-2 text-right font-mono text-xs" title={r.starting < 0 ? 'Credit balance' : 'Debit balance'}>{money(r.starting)}{r.starting !== 0 ? <span className="ml-1 text-[10px] font-normal text-muted-foreground">{r.starting < 0 ? 'Cr' : 'Dr'}</span> : null}</td>
                        <td className="px-4 py-2 text-right font-mono text-xs">{r.debit ? money(r.debit) : '…'}</td>
                        <td className="px-4 py-2 text-right font-mono text-xs">{r.credit ? money(r.credit) : '…'}</td>
                        <td className={cn('px-4 py-2 text-right font-mono text-xs', r.movement < 0 && 'text-rose-500')}>{money(r.movement)}</td>
                        <td className="px-4 py-2 text-right font-mono text-xs font-medium" title={r.ending < 0 ? 'Credit balance' : 'Debit balance'}>{money(r.ending)}{r.ending !== 0 ? <span className="ml-1 text-[10px] font-normal text-muted-foreground">{r.ending < 0 ? 'Cr' : 'Dr'}</span> : null}</td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {/* ── Budget vs. Actuals ──────────────────────────────────────────────── */}
      {report === 'budget-actual' && (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/40 px-4 py-3">
            <p className="text-sm font-semibold">Budget vs. Actuals — annual</p>
            <SearchSelect
              options={budgets.map((b) => ({ value: b.id, label: b.name, detail: `FY${b.fiscalYear} · ${b.status}` }))}
              value={activeBudget?.id ?? ''}
              onChange={(v) => setBudgetActualId(v)}
              placeholder="Select a budget"
              searchPlaceholder="Search budgets"
              clearable={false}
              className="w-64"
            />
          </div>
          {!activeBudget && (
            <p className="px-4 py-8 text-center text-xs text-muted-foreground">No budgets yet — create one in Finance → Budgeting.</p>
          )}
          {activeBudget && budgetActual && (
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Account</th>
                  <th className="px-4 py-2 text-right font-medium">Budgeted</th>
                  <th className="px-4 py-2 text-right font-medium">Actual</th>
                  <th className="px-4 py-2 text-right font-medium">Variance</th>
                  <th className="px-4 py-2 text-right font-medium">Variance %</th>
                </tr>
              </thead>
              <tbody>
                {(['revenue', 'expense'] as const).map((type) => {
                  const typeRows = budgetActual.byType(type);
                  if (typeRows.length === 0) return null;
                  return (
                    <Fragment key={type}>
                      <tr className="bg-muted/20">
                        <td colSpan={5} className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{type}</td>
                      </tr>
                      {typeRows.map((r) => (
                        <tr key={r.account.id} className="border-b last:border-0 hover:bg-muted/20">
                          <td className="px-4 py-2"><span className="mr-2 font-mono text-xs text-muted-foreground">{r.account.code}</span>{r.account.name}</td>
                          <td className="px-4 py-2 text-right font-mono text-xs">{money(r.budgeted)}</td>
                          <td className="px-4 py-2 text-right font-mono text-xs">{money(r.actual)}</td>
                          <td className={cn('px-4 py-2 text-right font-mono text-xs', r.variance < 0 && 'text-rose-500')}>{money(r.variance)}</td>
                          <td className="px-4 py-2 text-right font-mono text-xs">{r.variancePct === null ? '…' : `${r.variancePct.toFixed(1)}%`}</td>
                        </tr>
                      ))}
                      <tr className="bg-muted/40 font-semibold">
                        <td className="px-4 py-2">{`Total ${type}`}</td>
                        <td className="px-4 py-2 text-right font-mono text-xs">{money(budgetActual.sum(typeRows, 'budgeted'))}</td>
                        <td className="px-4 py-2 text-right font-mono text-xs">{money(budgetActual.sum(typeRows, 'actual'))}</td>
                        <td className="px-4 py-2 text-right font-mono text-xs">{money(budgetActual.sum(typeRows, 'variance'))}</td>
                        <td className="px-4 py-2" />
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  );
}
