'use client';

import { Fragment, useMemo, useState } from 'react';
import { Plus, Trash2, Copy, Download, Printer, TrendingUp, Wand2, CalendarRange } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ACCOUNT_TYPE_STYLE,
  CURRENCY_SYMBOL,
  fmtNum,
  fiscalYearMonths,
  computeAccountMonthlyActuals,
  forecastRemainingMonths,
  rollBudgetForward,
  resolveLineGrowthPct,
  DEFAULT_BUDGET_ASSUMPTIONS,
  type Budget,
  type BudgetLine,
  type AccountType,
} from '@/lib/borga/data';
import { brandedDocHtml, openPrintWindow, csvWithHeader, downloadTextFile } from '@/lib/borga/report-template';
import { useBorga } from '@/lib/borga/store';
import { SectionTitle } from '../bits';
import { cn } from '@/lib/utils';

const MONTH_LABEL = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const BUDGET_ROW_TYPES: AccountType[] = ['revenue', 'expense'];

export function BudgetTab() {
  const { budgets, addBudget, updateBudget, deleteBudget, setBudgetLine, setBudgetLineGrowth, applyBudgetForecast, coa, journals, activeWorkspace, log } = useBorga();
  const currency = activeWorkspace()?.currency ?? 'USD';
  const money = (n: number) => `${n < 0 ? '−' : ''}${CURRENCY_SYMBOL[currency]}${fmtNum(Math.abs(n))}`;

  const [selectedId, setSelectedId] = useState<string>(budgets[0]?.id ?? '');
  const budget = budgets.find((b) => b.id === selectedId) ?? budgets[0];

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', fiscalYear: new Date().getFullYear() });
  const [showForecast, setShowForecast] = useState(true);
  const [yearsToGenerate, setYearsToGenerate] = useState('3');

  const months = useMemo(() => (budget ? fiscalYearMonths(budget.fiscalYear) : []), [budget]);
  const currentMonth = new Date().toISOString().slice(0, 7);
  const elapsedMonths = useMemo(() => months.filter((m) => m <= currentMonth), [months, currentMonth]);

  const rows = useMemo(() => {
    if (!budget) return [];
    return BUDGET_ROW_TYPES.flatMap((type) =>
      coa
        .filter((a) => a.type === type)
        .map((account) => {
          const line = budget.lines.find((l) => l.accountId === account.id);
          const monthly = line?.monthly ?? {};
          const actuals = computeAccountMonthlyActuals(journals, coa, account.id, `${budget.fiscalYear}-01-01`, `${budget.fiscalYear}-12-31`);
          const forecast = forecastRemainingMonths(actuals, months, elapsedMonths);
          return { account, monthly, actuals, forecast };
        }),
    );
  }, [budget, coa, journals, months, elapsedMonths]);

  const colTotals = useMemo(() => {
    const budgeted: Record<string, number> = {};
    const actual: Record<string, number> = {};
    const forecast: Record<string, number> = {};
    months.forEach((m) => {
      budgeted[m] = rows.reduce((s, r) => s + (r.monthly[m] ?? 0), 0);
      actual[m] = rows.reduce((s, r) => s + (r.actuals[m] ?? 0), 0);
      forecast[m] = rows.reduce((s, r) => s + (r.forecast[m] ?? 0), 0);
    });
    return { budgeted, actual, forecast };
  }, [rows, months]);

  const annualBudgeted = months.reduce((s, m) => s + (colTotals.budgeted[m] ?? 0), 0);
  const annualForecast = months.reduce((s, m) => s + (colTotals.forecast[m] ?? 0), 0);

  const createBudget = () => {
    if (!form.name.trim()) return;
    const b: Budget = {
      id: `bud-${Date.now()}`,
      name: form.name.trim(),
      fiscalYear: form.fiscalYear,
      status: 'draft',
      lines: [],
      createdAt: new Date().toISOString(),
    };
    addBudget(b);
    setSelectedId(b.id);
    setCreateOpen(false);
    setForm({ name: '', fiscalYear: new Date().getFullYear() });
    log({ agentId: 'a-finance', agentName: 'Sage', actor: 'user', kind: 'system', message: `Budget "${b.name}" (FY${b.fiscalYear}) created.` });
  };

  /** Roll one budget forward into the next fiscal year, continuing its growth assumptions unless they've since been changed. */
  const rollForward = (source: Budget): Budget => {
    const nextYear = source.fiscalYear + 1;
    const fromMonths = fiscalYearMonths(source.fiscalYear);
    const toMonths = fiscalYearMonths(nextYear);
    const assumptions = source.assumptions ?? DEFAULT_BUDGET_ASSUMPTIONS;
    const resolve = (line: BudgetLine) => resolveLineGrowthPct(line, coa.find((a) => a.id === line.accountId)?.type, assumptions);
    return {
      id: `bud-${Date.now()}-${nextYear}`,
      name: `FY${nextYear} Operating Budget`,
      fiscalYear: nextYear,
      status: 'draft',
      lines: rollBudgetForward(source.lines, fromMonths, toMonths, resolve),
      createdAt: new Date().toISOString(),
      notes: `Forecast forward from ${source.name} (revenue +${assumptions.revenueGrowthPct}%, expense +${assumptions.expenseGrowthPct}% MoM, or each account's own override).`,
      assumptions,
    };
  };

  const duplicateToNextYear = () => {
    if (!budget) return;
    const b = rollForward(budget);
    addBudget(b);
    setSelectedId(b.id);
    log({ agentId: 'a-finance', agentName: 'Sage', actor: 'user', kind: 'system', message: `Budget "${budget.name}" rolled forward into FY${b.fiscalYear}.` });
  };

  const generateYears = () => {
    if (!budget) return;
    const n = Number(yearsToGenerate) || 3;
    let source = budget;
    let last: Budget | null = null;
    for (let i = 0; i < n; i++) {
      const next = rollForward(source);
      addBudget(next);
      source = next;
      last = next;
    }
    if (last) setSelectedId(last.id);
    log({ agentId: 'a-finance', agentName: 'Sage', actor: 'user', kind: 'system', message: `Generated ${n} year${n === 1 ? '' : 's'} of forecast budgets from "${budget.name}" (FY${budget.fiscalYear + 1}–FY${budget.fiscalYear + n}).` });
  };

  const exportCsv = () => {
    if (!budget) return;
    const ws = activeWorkspace();
    if (!ws) return;
    const head = ['Account', 'Type', ...MONTH_LABEL, 'Annual total'];
    const body: string[][] = rows.map((r) => [
      r.account.name,
      r.account.type,
      ...months.map((m) => String(r.monthly[m] ?? 0)),
      String(months.reduce((s, m) => s + (r.monthly[m] ?? 0), 0)),
    ]);
    body.push(['Total', '', ...months.map((m) => String(colTotals.budgeted[m] ?? 0)), String(annualBudgeted)]);
    const csv = csvWithHeader(ws, `Budget — ${budget.name}`, `FY${budget.fiscalYear}`, [head, ...body]);
    downloadTextFile(`budget-fy${budget.fiscalYear}.csv`, csv);
  };

  const printBudget = () => {
    if (!budget) return;
    const ws = activeWorkspace();
    if (!ws) return;
    const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const headRow = `<tr><th>Account</th>${MONTH_LABEL.map((m) => `<th class="num">${m}</th>`).join('')}<th class="num">Annual</th></tr>`;
    const bodyRows = rows
      .map((r) => `<tr><td>${esc(r.account.name)}</td>${months.map((m) => `<td class="num">${money(r.monthly[m] ?? 0)}</td>`).join('')}<td class="num">${money(months.reduce((s, m) => s + (r.monthly[m] ?? 0), 0))}</td></tr>`)
      .join('');
    const totalRow = `<tr class="total-row"><td>Total</td>${months.map((m) => `<td class="num">${money(colTotals.budgeted[m] ?? 0)}</td>`).join('')}<td class="num">${money(annualBudgeted)}</td></tr>`;
    const body = `<div class="section-title">Budget — FY${budget.fiscalYear}</div><table>${headRow}${bodyRows}${totalRow}</table>`;
    openPrintWindow(brandedDocHtml({ ws, title: 'Budget', subtitle: budget.name, bodyHtml: body }), 'Budget');
  };

  return (
    <div className="borga-fade-up space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle title="Budgeting & forecasting" sub="Plan by account, month, and fiscal year — then track it against actuals" />
        <div className="flex gap-2">
          <Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> New budget</Button>
        </div>
      </div>

      <Card className="flex flex-wrap items-end gap-3 p-4">
        <div>
          <p className="text-[11px] font-medium text-muted-foreground">Budget</p>
          <Select value={budget?.id ?? ''} onValueChange={setSelectedId}>
            <SelectTrigger className="mt-1 w-64"><SelectValue placeholder="Select a budget" /></SelectTrigger>
            <SelectContent>
              {budgets.map((b) => (
                <SelectItem key={b.id} value={b.id}>{b.name} — FY{b.fiscalYear}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {budget && (
          <>
            <Select value={budget.status} onValueChange={(v) => updateBudget(budget.id, { status: v as Budget['status'] })}>
              <SelectTrigger className="mt-1 w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => setShowForecast((v) => !v)}>
              <TrendingUp className="h-4 w-4" /> {showForecast ? 'Hide forecast' : 'Show forecast'}
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv}><Download className="h-4 w-4" /> CSV</Button>
            <Button variant="outline" size="sm" onClick={printBudget}><Printer className="h-4 w-4" /> Print</Button>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-destructive hover:text-destructive"
              onClick={() => deleteBudget(budget.id)}
            >
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          </>
        )}
      </Card>

      {budget && (
        <Card className="p-4">
          <p className="text-sm font-semibold">Forecast assumptions</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Default month-over-month growth applied when generating the forecast — override any single account in the "Growth %" column of the grid below.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">Revenue growth (MoM %)</p>
              <Input
                key={`${budget.id}-rev-growth-${budget.assumptions?.revenueGrowthPct ?? DEFAULT_BUDGET_ASSUMPTIONS.revenueGrowthPct}`}
                type="number"
                step="0.1"
                defaultValue={budget.assumptions?.revenueGrowthPct ?? DEFAULT_BUDGET_ASSUMPTIONS.revenueGrowthPct}
                className="mt-1 w-28"
                onBlur={(e) => updateBudget(budget.id, {
                  assumptions: {
                    revenueGrowthPct: Number(e.target.value) || 0,
                    costGrowthPct: budget.assumptions?.costGrowthPct ?? DEFAULT_BUDGET_ASSUMPTIONS.costGrowthPct,
                    expenseGrowthPct: budget.assumptions?.expenseGrowthPct ?? DEFAULT_BUDGET_ASSUMPTIONS.expenseGrowthPct,
                  },
                })}
              />
            </div>
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">Expense growth (MoM %)</p>
              <Input
                key={`${budget.id}-exp-growth-${budget.assumptions?.expenseGrowthPct ?? DEFAULT_BUDGET_ASSUMPTIONS.expenseGrowthPct}`}
                type="number"
                step="0.1"
                defaultValue={budget.assumptions?.expenseGrowthPct ?? DEFAULT_BUDGET_ASSUMPTIONS.expenseGrowthPct}
                className="mt-1 w-28"
                onBlur={(e) => updateBudget(budget.id, {
                  assumptions: {
                    revenueGrowthPct: budget.assumptions?.revenueGrowthPct ?? DEFAULT_BUDGET_ASSUMPTIONS.revenueGrowthPct,
                    costGrowthPct: Number(e.target.value) || 0,
                    expenseGrowthPct: Number(e.target.value) || 0,
                  },
                })}
              />
            </div>
            <Button variant="outline" size="sm" onClick={() => applyBudgetForecast(budget.id)} title="Fill every month after the first using these assumptions (or each account's own override)">
              <Wand2 className="h-4 w-4" /> Generate forecast from month 1
            </Button>
            <Button variant="outline" size="sm" onClick={duplicateToNextYear}><Copy className="h-4 w-4" /> Roll forward to FY{budget.fiscalYear + 1}</Button>
            <div className="flex items-center gap-1.5">
              <Select value={yearsToGenerate} onValueChange={setYearsToGenerate}>
                <SelectTrigger className="w-16"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['3', '4', '5'].map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={generateYears} title="Chain these assumptions forward to generate multiple years of budgets">
                <CalendarRange className="h-4 w-4" /> Generate years
              </Button>
            </div>
          </div>
        </Card>
      )}

      {!budget && (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          No budgets yet. Create one to start planning by account and month.
        </Card>
      )}

      {budget && (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Account</th>
                <th className="px-2 py-2 text-right font-medium" title="Month-over-month growth applied when generating the forecast for this account">Growth %</th>
                {MONTH_LABEL.map((m) => (
                  <th key={m} className="px-2 py-2 text-right font-medium">{m}</th>
                ))}
                <th className="px-3 py-2 text-right font-medium">Annual</th>
              </tr>
            </thead>
            <tbody>
              {BUDGET_ROW_TYPES.map((type) => {
                const typeRows = rows.filter((r) => r.account.type === type);
                if (typeRows.length === 0) return null;
                return (
                  <Fragment key={`h-${type}`}>
                    <tr>
                      <td colSpan={15} className="bg-muted/20 px-3 py-1.5">
                        <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-semibold capitalize ring-1', ACCOUNT_TYPE_STYLE[type])}>{type}</span>
                      </td>
                    </tr>
                    {typeRows.map((r) => {
                      const annual = months.reduce((s, m) => s + (r.monthly[m] ?? 0), 0);
                      const line = budget.lines.find((l) => l.accountId === r.account.id);
                      const effectiveGrowth = resolveLineGrowthPct(
                        line ?? { id: '', accountId: r.account.id, monthly: {} },
                        r.account.type,
                        budget.assumptions ?? DEFAULT_BUDGET_ASSUMPTIONS,
                      );
                      return (
                        <tr key={r.account.id} className="border-b last:border-0 hover:bg-muted/20">
                          <td className="px-3 py-1.5 whitespace-nowrap">
                            <span className="mr-1.5 font-mono text-[10px] text-muted-foreground">{r.account.code}</span>{r.account.name}
                          </td>
                          <td className="px-1 py-1">
                            <Input
                              key={`${budget.id}-${r.account.id}-growth-${effectiveGrowth}`}
                              type="number"
                              step="0.1"
                              defaultValue={effectiveGrowth}
                              title={line?.growthPct === undefined ? 'Using the type-level default — edit to override just this account' : 'Custom override for this account'}
                              className={cn('h-7 w-16 text-right font-mono text-xs', line?.growthPct === undefined && 'text-muted-foreground')}
                              onBlur={(e) => setBudgetLineGrowth(budget.id, r.account.id, Number(e.target.value) || 0)}
                            />
                          </td>
                          {months.map((m) => {
                            const elapsed = elapsedMonths.includes(m);
                            return (
                              <td key={m} className="px-1 py-1 text-right">
                                <Input
                                  key={`${budget.id}-${r.account.id}-${m}-${r.monthly[m] ?? 0}`}
                                  type="number"
                                  defaultValue={r.monthly[m] ?? ''}
                                  placeholder="0"
                                  className="h-7 w-20 text-right font-mono text-xs"
                                  onBlur={(e) => setBudgetLine(budget.id, r.account.id, m, Number(e.target.value) || 0)}
                                />
                                {showForecast && elapsed && r.actuals[m] !== undefined && (
                                  <p className="mt-0.5 text-[10px] text-muted-foreground">{money(r.actuals[m] ?? 0)} actual</p>
                                )}
                                {showForecast && !elapsed && r.forecast[m] !== undefined && (
                                  <p className="mt-0.5 text-[10px] text-amber-600">{money(r.forecast[m] ?? 0)} fcst</p>
                                )}
                              </td>
                            );
                          })}
                          <td className="px-3 py-1.5 text-right font-mono text-xs font-medium">{money(annual)}</td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
              <tr className="bg-muted/40 font-semibold">
                <td className="px-3 py-2">Total</td>
                <td className="px-2 py-2" />
                {months.map((m) => (
                  <td key={m} className="px-2 py-2 text-right font-mono text-xs">{money(colTotals.budgeted[m] ?? 0)}</td>
                ))}
                <td className="px-3 py-2 text-right font-mono text-xs">{money(annualBudgeted)}</td>
              </tr>
              {showForecast && (
                <tr className="bg-amber-500/5 text-amber-700">
                  <td className="px-3 py-2 text-xs font-medium">Forecast (run-rate)</td>
                  <td className="px-2 py-2" />
                  {months.map((m) => (
                    <td key={m} className="px-2 py-2 text-right font-mono text-xs">{money(colTotals.forecast[m] ?? 0)}</td>
                  ))}
                  <td className="px-3 py-2 text-right font-mono text-xs">{money(annualForecast)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New budget</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Name</p>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder={`FY${form.fiscalYear} Operating Budget`} />
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Fiscal year</p>
              <Input
                type="number"
                value={form.fiscalYear}
                onChange={(e) => setForm((f) => ({ ...f, fiscalYear: Number(e.target.value) || f.fiscalYear }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={createBudget}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
