'use client';
import { useMemo, useState } from 'react';
import { Eye } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SectionTitle } from '../bits';
import { useBorga } from '@/lib/borga/store';
import {
  calcPayroll, monthlyGross, payrollCountryFor, defaultPayrollMapping, validateMapping,
  suggestedPayrollAccounts, summarizePayrollHistory, nextUnpaidMonth,
  type PayrollCountry, type PayrollGLMapping,
} from '@/lib/borga/payroll-engine';
import { AccountSelect } from '../form-widgets';
import { FormDialog, FieldGrid, TextField } from '../form-kit';
import { FilterPills, TableSearch, TableToolbar, CrudTable, IdCell, TextCell, AmountCell, StatusBadge, EmptyRow, IconBtn, RowActions } from '../data-table';
import { brandedDocHtml, openPrintWindow, csvWithHeader, downloadTextFile } from '@/lib/borga/report-template';
import type { PayrollRun } from '@/lib/borga/data';

interface RunFigures { gross: number; tax: number; net: number; employer: number; estimated: boolean; }

/** Table figures for a run: stored detail when present, otherwise recomputed with the run's country (labeled estimate). */
function runFigures(run: PayrollRun, fallbackCountry: PayrollCountry): RunFigures {
  if (run.detail && run.detail.length > 0) {
    const sum = (f: (d: NonNullable<PayrollRun['detail']>[number]) => number) => run.detail!.reduce((t, d) => t + f(d), 0);
    return {
      gross: run.total,
      tax: Math.round(sum((d) => d.employeeTax) * 100) / 100,
      net: Math.round(sum((d) => d.net) * 100) / 100,
      employer: Math.round(sum((d) => d.employerCost) * 100) / 100,
      estimated: false,
    };
  }
  let tax = 0, employer = 0;
  for (const l of run.lines) {
    const c = calcPayroll({ country: (run.country as PayrollCountry) ?? fallbackCountry, gross: l.amount });
    tax += c.employeeTax; employer += c.employerCost;
  }
  tax = Math.round(tax * 100) / 100;
  employer = Math.round(employer * 100) / 100;
  return { gross: run.total, tax, net: Math.round((run.total - tax) * 100) / 100, employer, estimated: true };
}

export function PayrollTab() {
  const {
    activeWorkspaceId, activeWorkspace, employees, payrollRuns, coa, addAccount,
    payrollSettings, setPayrollSettings, hydrate,
  } = useBorga();
  const ws = activeWorkspace();
  // Payroll type follows the onboarding country; the user can still override per run.
  const auto = payrollCountryFor(ws?.country) ?? 'US';
  const [override, setOverride] = useState<PayrollCountry | null>(null);
  const country = override ?? auto;
  const [gross, setGross] = useState('5000');
  const [monthKey, setMonthKey] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showMapping, setShowMapping] = useState(false);
  const [showRelease, setShowRelease] = useState(false);
  const [viewRun, setViewRun] = useState<PayrollRun | null>(null);
  const [slip, setSlip] = useState<{ run: PayrollRun; employeeId: string } | null>(null);
  const [filter, setFilter] = useState<'all' | 'released' | 'draft'>('all');
  const [query, setQuery] = useState('');

  const c = calcPayroll({ country, gross: Number(gross) || 0 });
  const active = employees.filter((e) => e.status === 'active');
  const missingSalary = active.filter((e) => !(Number(e.salary ?? 0) > 0));

  // Smart presets resolve against the chart of accounts; the saved mapping wins per line.
  const { mapping: preset, missing } = useMemo(() => defaultPayrollMapping(coa, country), [coa, country]);
  const saved = payrollSettings?.country === country ? payrollSettings.mapping : null;
  const mapping: PayrollGLMapping = useMemo(() => ({
    ...preset,
    ...(saved ?? {}),
    taxPayables: { ...preset.taxPayables, ...(saved?.taxPayables ?? {}) },
    employerPayables: { ...preset.employerPayables, ...(saved?.employerPayables ?? {}) },
  }), [preset, saved]);
  const problems = useMemo(() => validateMapping(mapping, coa.map((a) => a.id)), [mapping, coa]);
  const suggestions = useMemo(() => suggestedPayrollAccounts(country, coa.map((a) => a.code ?? '')), [coa, country]);

  const setLine = (patch: {
    salaryExpense?: string; clearing?: string; netPayable?: string; employerExpense?: string;
    taxPayables?: Record<string, string | undefined>; employerPayables?: Record<string, string | undefined>;
  }) => {
    // Clearing a line removes the override so the country preset applies again.
    const mergeLines = (base: Record<string, string>, over?: Record<string, string | undefined>) => {
      const next = { ...base };
      for (const [k, v] of Object.entries(over ?? {})) {
        if (typeof v === 'string' && v.length > 0) next[k] = v;
        else delete next[k];
      }
      return next;
    };
    const { taxPayables, employerPayables, ...top } = patch;
    const topDefined = Object.fromEntries(
      Object.entries(top).filter(([, v]) => typeof v === 'string' && (v as string).length > 0),
    ) as Partial<PayrollGLMapping>;
    setPayrollSettings({
      country,
      mapping: {
        ...mapping, ...topDefined,
        taxPayables: mergeLines(mapping.taxPayables, taxPayables),
        employerPayables: mergeLines(mapping.employerPayables, employerPayables),
      },
    });
  };
  const resetMapping = () => setPayrollSettings({ country, mapping: preset });
  const createAccounts = () => {
    for (const a of suggestions) {
      addAccount({ id: `gl-${a.code}`, code: a.code, name: a.name, type: a.type });
    }
    setMsg(`${suggestions.length} payroll accounts created in Accounting — the mapping below now points at them.`);
  };

  const accountName = (id: string) => coa.find((a) => a.id === id)?.name ?? '— pick an account —';
  const empLines = c.lines.filter((l) => !/employer/i.test(l.label));
  const erLines = c.lines.filter((l) => /employer/i.test(l.label));

  // ── History table ──────────────────────────────────────────────────────────
  const filtered = payrollRuns
    .filter((r) => (filter === 'all' ? true : r.status === filter))
    .filter((r) => (query ? `${r.periodLabel} ${r.monthKey}`.toLowerCase().includes(query.toLowerCase()) : true))
    .sort((a, b) => b.monthKey.localeCompare(a.monthKey));
  const summary = useMemo(() => summarizePayrollHistory(payrollRuns), [payrollRuns]);
  const figs = useMemo(() => new Map(filtered.map((r) => [r.id, runFigures(r, country)] as const)), [filtered, country]);

  const exportCsv = () => {
    if (!ws) return;
    const rows: string[][] = [['Period', 'Employee', 'Gross', 'Withholding tax', 'Take-home', 'Employer cost']];
    for (const r of filtered) {
      const det = r.detail;
      if (det && det.length > 0) {
        for (const d of det) rows.push([r.periodLabel || r.monthKey, d.employeeName, String(d.gross), String(d.employeeTax), String(d.net), String(d.employerCost)]);
      } else {
        for (const l of r.lines) {
          const cc = calcPayroll({ country: (r.country as PayrollCountry) ?? country, gross: l.amount });
          rows.push([r.periodLabel || r.monthKey, l.name, String(l.amount), String(Math.round(cc.employeeTax * 100) / 100), String(Math.round(cc.net * 100) / 100), String(Math.round(cc.employerCost * 100) / 100)]);
        }
      }
    }
    downloadTextFile('payroll-history.csv', csvWithHeader(ws, 'Payroll history', 'All periods', rows));
  };

  // ── Release flow ───────────────────────────────────────────────────────────
  const releasedKeys = payrollRuns.filter((r) => r.status === 'released').map((r) => r.monthKey);
  const openRelease = () => {
    setMonthKey(nextUnpaidMonth(releasedKeys));
    setShowRelease(true);
  };
  const releaseTotals = useMemo(() => {
    const rows = active.filter((e) => Number(e.salary ?? 0) > 0).map((e) => monthlyGross(Number(e.salary ?? 0)));
    const grossT = rows.reduce((t, g) => t + g, 0);
    return { people: rows.length, gross: Math.round(grossT * 100) / 100 };
  }, [active]);

  const post = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/borga/payroll/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
        body: JSON.stringify({ ws: activeWorkspaceId, monthKey, country, mapping }),
      });
      const d = await r.json() as { ok?: boolean; error?: string; runId?: string; gross?: number; net?: number; journalIds?: string[] };
      if (d.ok) {
        setMsg(`Paid ${d.runId}: gross ${d.gross}, take-home ${d.net} — 4 journals posted (${(d.journalIds ?? []).length}), one each for gross, withholdings, net pay and employer share.`);
        setShowRelease(false);
      } else setMsg(`Failed: ${d.error}`);
      void hydrate();
    } finally { setBusy(false); }
  };

  // ── Payslip ────────────────────────────────────────────────────────────────
  const printSlip = () => {
    if (!ws || !slip) return;
    const run = slip.run;
    const det = run.detail?.find((d) => d.employeeId === slip.employeeId);
    const line = run.lines.find((l) => l.employeeId === slip.employeeId);
    const name = det?.employeeName ?? line?.name ?? 'Employee';
    const grossV = det?.gross ?? line?.amount ?? 0;
    const calc = det ? null : calcPayroll({ country: (run.country as PayrollCountry) ?? country, gross: grossV });
    const taxV = det?.employeeTax ?? calc?.employeeTax ?? 0;
    const netV = det?.net ?? calc?.net ?? 0;
    const erV = det?.employerCost ?? calc?.employerCost ?? 0;
    const row = (k: string, v: string) => `<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #eee;font-size:13px;"><span>${k}</span><strong>${v}</strong></div>`;
    openPrintWindow(brandedDocHtml({
      ws, title: 'Payslip', subtitle: `${name} — ${run.periodLabel || run.monthKey}`,
      metaRight: [`Period: ${run.periodLabel || run.monthKey}`, `Employee: ${name}`, `Run: ${run.id}`],
      bodyHtml: `${row('Gross pay', grossV.toFixed(2))}${row('Withholding tax', taxV.toFixed(2))}${row('Take-home pay', netV.toFixed(2))}${row('Employer contributions', erV.toFixed(2))}`,
      footerNote: det ? undefined : 'Figures recomputed with current rates (run predates per-employee breakdowns).',
    }), `Payslip ${run.monthKey} ${name}`);
  };

  const viewDetail = viewRun ? { run: viewRun, f: figs.get(viewRun.id) ?? runFigures(viewRun, country) } : null;

  return (
    <div className="space-y-4">
      <SectionTitle title="Payroll" sub={`Pay your team for the month. Salaries come from the HR directory, taxes are worked out for ${ws?.country ?? 'your country'} (${country}), and every line lands on the ledger account you choose.`} />
      {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
      <Card className="p-4">
        <p className="text-sm font-semibold">How this works (3 steps)</p>
        <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm text-muted-foreground">
          <li><strong className="text-foreground">Check salaries</strong> in the Directory tab — everyone active needs a yearly salary; a month&apos;s pay is a twelfth of it.</li>
          <li><strong className="text-foreground">Check where the money goes</strong> — each tax and contribution points at a ledger account (presets filled in, change any).</li>
          <li><strong className="text-foreground">Pay the month</strong> — each month can only be paid once; four balanced journals post automatically.</li>
        </ol>
        <p className="mt-1 text-xs text-muted-foreground">💡 Tip: Time Clock hours stay informational — pay always uses HR salaries, so overtime never sneaks into a run by accident.</p>
      </Card>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Paid out, all time (gross)', value: summary.ytdGross.toFixed(2) },
          { label: 'Take-home', value: summary.ytdNet.toFixed(2) },
          { label: 'Employer cost', value: summary.ytdEmployer.toFixed(2) },
          { label: 'Runs · People', value: `${summary.runCount} · ${summary.headcount}` },
        ].map((k) => (
          <Card key={k.label} className="p-4">
            <p className="text-xs text-muted-foreground">{k.label}</p>
            <p className="mt-0.5 text-2xl font-semibold">{k.value}</p>
          </Card>
        ))}
      </div>
      {summary.estimated && <p className="text-xs text-muted-foreground">💡 Take-home and employer totals are partly recomputed — runs from before this update kept gross only.</p>}

      {/* Toolbar */}
      <TableToolbar>
        <FilterPills options={['all', 'released', 'draft'] as const} value={filter} onChange={setFilter} />
        <TableSearch value={query} onChange={setQuery} placeholder="Search periods…" />
        <Button variant="outline" onClick={exportCsv} disabled={filtered.length === 0}>Export CSV</Button>
        <Button onClick={openRelease}>＋ Pay a month</Button>
      </TableToolbar>

      {/* Runs table */}
      <CrudTable headers={['Period', 'People', <span key="g" className="block text-right">Gross</span>, <span key="t" className="block text-right">Withheld</span>, <span key="n" className="block text-right">Take-home</span>, <span key="e" className="block text-right">Employer</span>, 'Status', 'Journals']}>
        {filtered.map((r) => {
          const f = figs.get(r.id) ?? runFigures(r, country);
          const journals = r.journalIds ?? (r.journalId ? [r.journalId] : []);
          return (
            <tr key={r.id} className="border-b last:border-0 hover:bg-muted/20">
              <IdCell sub={f.estimated ? 'recomputed with current rates' : `paid ${r.releasedAt?.slice(0, 10) ?? r.monthKey}`}>{r.periodLabel || r.monthKey}</IdCell>
              <TextCell className="text-right">{r.lines.length}</TextCell>
              <AmountCell value={f.gross.toFixed(2)} />
              <AmountCell value={f.tax.toFixed(2)} />
              <AmountCell value={f.net.toFixed(2)} />
              <AmountCell value={f.employer.toFixed(2)} />
              <StatusBadge className={r.status === 'released' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-muted text-muted-foreground'}>{r.status}</StatusBadge>
              <TextCell className="text-right">{journals.length || '—'}</TextCell>
              <td className="px-2 py-2.5">
                <RowActions>
                  <IconBtn title="View run detail + payslips" onClick={() => setViewRun(r)}>
                    <Eye className="h-3.5 w-3.5" />
                  </IconBtn>
                </RowActions>
              </td>
            </tr>
          );
        })}
        {filtered.length === 0 && <EmptyRow colSpan={9}>No pay runs match — pay your first month with “＋ Pay a month”.</EmptyRow>}
      </CrudTable>

      {/* Preview + mapping (kept, collapsible mapping) */}
      <Card className="p-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold">Preview — one person earning</p>
          <input className="border rounded px-2 w-28" value={gross} onChange={(e) => setGross(e.target.value)} placeholder="Monthly pay" />
          <span className="text-muted-foreground">({country})</span>
          {(['US', 'CA', 'GH', 'DK'] as PayrollCountry[]).map((x) => (
            <button key={x} onClick={() => setOverride(x === auto ? null : x)} className={x === country ? 'font-bold underline' : ''} title={x === auto ? 'Your onboarding country' : `Preview as ${x}`}>{x}{x === auto ? ' •' : ''}</button>
          ))}
        </div>
        <p className="mt-1">Pay <strong>{c.gross.toFixed(2)}</strong> → taxes {c.employeeTax.toFixed(2)} → take-home <strong>{c.net.toFixed(2)}</strong> · costs you {c.employerCost.toFixed(2)} total</p>
        {c.lines.map((l) => <p key={l.label} className="text-muted-foreground">{l.label}: {l.amount.toFixed(2)}</p>)}
      </Card>

      <Card className="p-4">
        <button className="text-sm font-semibold" onClick={() => setShowMapping((v) => !v)}>
          {showMapping ? '▾' : '▸'} Where the money goes — ledger accounts (GL mapping)
        </button>
        <p className="mt-0.5 text-xs text-muted-foreground">Each line below is the account its journal posts to. Presets follow your country — change any line, it saves automatically.</p>
        {showMapping && (
          <div className="mt-2 space-y-2 text-sm">
            {missing.length > 0 && (
              <div className="rounded-lg bg-amber-500/10 p-2 text-xs text-amber-700">
                {missing.map((m) => <p key={m}>⚠ {m}</p>)}
                {suggestions.length > 0 && (
                  <Button size="sm" variant="outline" className="mt-1" onClick={createAccounts}>
                    Create {suggestions.length} dedicated accounts ({suggestions.map((a) => a.name).join(', ')})
                  </Button>
                )}
              </div>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              <label>Gross salaries → <AccountSelect value={mapping.salaryExpense} onChange={(v) => setLine({ salaryExpense: v })} types={['expense']} /></label>
              <label>Payroll clearing → <AccountSelect value={mapping.clearing} onChange={(v) => setLine({ clearing: v })} types={['liability']} /></label>
              <label>Take-home owed → <AccountSelect value={mapping.netPayable} onChange={(v) => setLine({ netPayable: v })} types={['liability']} /></label>
              <label>Employer cost → <AccountSelect value={mapping.employerExpense} onChange={(v) => setLine({ employerExpense: v })} types={['expense']} /></label>
            </div>
            <p className="font-medium">Withholdings (taken from pay)</p>
            {empLines.map((l) => (
              <label key={l.label} className="block">{l.label} ({l.amount.toFixed(2)} on preview) → <AccountSelect value={mapping.taxPayables[l.label] ?? ''} onChange={(v) => setLine({ taxPayables: { [l.label]: v } })} types={['liability']} /></label>
            ))}
            {erLines.length > 0 && <p className="font-medium">Employer contributions (extra cost to you)</p>}
            {erLines.map((l) => (
              <label key={l.label} className="block">{l.label} ({l.amount.toFixed(2)} on preview) → <AccountSelect value={mapping.employerPayables[l.label] ?? ''} onChange={(v) => setLine({ employerPayables: { [l.label]: v } })} types={['liability']} /></label>
            ))}
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={resetMapping}>Reset to country presets</Button>
            </div>
            <p className="text-xs text-muted-foreground">Currently: gross → {accountName(mapping.salaryExpense)} · clearing → {accountName(mapping.clearing)} · take-home → {accountName(mapping.netPayable)} · employer → {accountName(mapping.employerExpense)}</p>
          </div>
        )}
      </Card>

      {/* Release dialog */}
      <FormDialog
        open={showRelease}
        onOpenChange={setShowRelease}
        title="Pay a month"
        description="Everyone active is paid a twelfth of their yearly salary. Each month can only be paid once."
        submitLabel={`Pay ${monthKey || 'month'} now`}
        onSubmit={post}
        submitDisabled={busy || missingSalary.length > 0 || problems.length > 0}
        wide
      >
        <FieldGrid cols={2}>
          <TextField label="Month to pay" value={monthKey} onChange={setMonthKey} type="month" hint="YYYY-MM — already-paid months are refused." />
          <div className="text-sm">
            <p className="mb-1 text-xs text-muted-foreground">Payroll type</p>
            <p>{country} {override ? '(you overrode the onboarding country)' : `(from onboarding: ${ws?.country ?? 'not set'})`}</p>
          </div>
        </FieldGrid>
        {missingSalary.length > 0 && (
          <p className="text-sm text-amber-600">These people still need a yearly salary in the Directory tab: {missingSalary.map((e) => e.name).join(', ')}</p>
        )}
        <div className="rounded-lg border">
          <div className="grid grid-cols-[1fr_96px] gap-2 border-b px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <span>Employee</span><span className="text-right">This month</span>
          </div>
          {active.filter((e) => Number(e.salary ?? 0) > 0).map((e) => (
            <div key={e.id} className="grid grid-cols-[1fr_96px] gap-2 border-b px-3 py-1.5 text-sm last:border-0">
              <span>{e.name}</span>
              <span className="text-right">{monthlyGross(Number(e.salary ?? 0)).toFixed(2)}</span>
            </div>
          ))}
          <div className="grid grid-cols-[1fr_96px] gap-2 px-3 py-1.5 text-sm font-semibold">
            <span>Total gross ({releaseTotals.people} people)</span>
            <span className="text-right">{releaseTotals.gross.toFixed(2)}</span>
          </div>
        </div>
        {problems.length > 0 && <p className="text-sm text-amber-600">Fix the ledger mapping first: {problems.join(' ')}</p>}
        <p className="text-xs text-muted-foreground">💡 Paying posts 4 journals (gross · withholdings · net pay · employer share) and reminds you in Filing.</p>
      </FormDialog>

      {/* Run detail dialog */}
      <FormDialog
        open={!!viewDetail}
        onOpenChange={(o) => { if (!o) setViewRun(null); }}
        title={viewDetail ? `Pay run — ${viewDetail.run.periodLabel || viewDetail.run.monthKey}` : 'Pay run'}
        description={viewDetail ? `Paid ${viewDetail.run.releasedAt?.slice(0, 10) ?? viewDetail.run.monthKey} · ${viewDetail.f.estimated ? 'figures recomputed with current rates' : 'as posted'}` : undefined}
        submitLabel="Close"
        submitPrefix=""
        hideCancel
        onSubmit={() => setViewRun(null)}
        wide
      >
        {viewDetail && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: 'Gross', value: viewDetail.f.gross.toFixed(2) },
                { label: 'Withholdings', value: viewDetail.f.tax.toFixed(2) },
                { label: 'Take-home', value: viewDetail.f.net.toFixed(2) },
                { label: 'Employer cost', value: viewDetail.f.employer.toFixed(2) },
              ].map((k) => (
                <Card key={k.label} className="p-3">
                  <p className="text-xs text-muted-foreground">{k.label}</p>
                  <p className="text-lg font-semibold">{k.value}</p>
                </Card>
              ))}
            </div>
            <div className="rounded-lg border">
              <div className="grid grid-cols-[1fr_80px_80px_80px_80px_64px] gap-2 border-b px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <span>Employee</span><span className="text-right">Gross</span><span className="text-right">Tax</span><span className="text-right">Take-home</span><span className="text-right">Employer</span><span />
              </div>
              {(viewDetail.run.detail ?? viewDetail.run.lines.map((l) => {
                const cc = calcPayroll({ country: (viewDetail.run.country as PayrollCountry) ?? country, gross: l.amount });
                return { employeeId: l.employeeId, employeeName: l.name, gross: l.amount, employeeTax: Math.round(cc.employeeTax * 100) / 100, employerCost: Math.round(cc.employerCost * 100) / 100, net: Math.round(cc.net * 100) / 100 };
              })).map((d) => (
                <div key={d.employeeId} className="grid grid-cols-[1fr_80px_80px_80px_80px_64px] items-center gap-2 border-b px-3 py-1.5 last:border-0">
                  <span>{d.employeeName}</span>
                  <span className="text-right">{d.gross.toFixed(2)}</span>
                  <span className="text-right">{d.employeeTax.toFixed(2)}</span>
                  <span className="text-right font-medium">{d.net.toFixed(2)}</span>
                  <span className="text-right text-muted-foreground">{d.employerCost.toFixed(2)}</span>
                  <Button size="sm" variant="ghost" onClick={() => setSlip({ run: viewDetail.run, employeeId: d.employeeId })}>Payslip</Button>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Journals: {((viewDetail.run.journalIds ?? (viewDetail.run.journalId ? [viewDetail.run.journalId] : []))).join(', ') || '—'} · Include {viewDetail.run.monthKey} in Filing → payroll worksheet.
            </p>
          </div>
        )}
      </FormDialog>

      {/* Payslip dialog */}
      <FormDialog
        open={!!slip}
        onOpenChange={(o) => { if (!o) setSlip(null); }}
        title="Payslip"
        description={slip ? `${slip.run.periodLabel || slip.run.monthKey}` : undefined}
        submitLabel="Print"
        submitPrefix=""
        hideCancel
        onSubmit={printSlip}
      >
        {slip && (() => {
          const run = slip.run;
          const det = run.detail?.find((d) => d.employeeId === slip.employeeId);
          const line = run.lines.find((l) => l.employeeId === slip.employeeId);
          const name = det?.employeeName ?? line?.name ?? 'Employee';
          const grossV = det?.gross ?? line?.amount ?? 0;
          const calc = det ? null : calcPayroll({ country: (run.country as PayrollCountry) ?? country, gross: grossV });
          const rows: Array<[string, string]> = [
            ['Employee', name],
            ['Period', run.periodLabel || run.monthKey],
            ['Gross pay', grossV.toFixed(2)],
            ['Withholding tax', ((det?.employeeTax ?? calc?.employeeTax) ?? 0).toFixed(2)],
            ['Take-home pay', ((det?.net ?? calc?.net) ?? 0).toFixed(2)],
            ['Employer contributions', ((det?.employerCost ?? calc?.employerCost) ?? 0).toFixed(2)],
          ];
          return (
            <div>
              {rows.map(([k, v]) => (
                <div key={k} className="flex justify-between border-b py-1.5 text-sm last:border-0">
                  <span className="text-muted-foreground">{k}</span><strong>{v}</strong>
                </div>
              ))}
              {!det && <p className="mt-1 text-xs text-muted-foreground">Recomputed with current rates (this run predates per-employee breakdowns).</p>}
            </div>
          );
        })()}
      </FormDialog>
    </div>
  );
}
