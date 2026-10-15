import { NextResponse, type NextRequest } from 'next/server';
import { sessionUserId, featureGate } from '@/lib/borga/features-server';
import { getBorgaState, setBorgaState } from '@/lib/borga/persistence';
import { userWsKey, userWorkspacesKey } from '@/lib/borga/keys';
import {
  releasePayrollRun, aggregatePayrollCalcs, monthlyGross,
  defaultPayrollMapping, validateMapping,
  payrollCountryFor, type PayrollCountry, type PayrollGLMapping,
} from '@/lib/borga/payroll-engine';
import { postPayrollSplit } from '@/lib/borga/postings';
import { emitEvent } from '@/lib/borga/emit-event';
import type { Employee, JournalEntry, PayrollRun, Workspace, GlAccount } from '@/lib/borga/data';

export const runtime = 'nodejs';

// POST { ws, monthKey: YYYY-MM, country?, mapping? (partial override) }
// Gross comes from HR annual salaries ÷ 12. Posts four balanced journals
// (gross / withholdings / net / employer), one per group, each line mapped
// to its ledger account. Releases each month exactly once.
export async function POST(req: NextRequest) {
  const userId = await sessionUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => null)) as {
    ws?: string; monthKey?: string; country?: PayrollCountry; mapping?: Partial<PayrollGLMapping>;
  } | null;
  if (!body?.ws || !body?.monthKey) return NextResponse.json({ ok: false, error: 'ws and monthKey (YYYY-MM) required' }, { status: 400 });
  const gate = await featureGate('payroll', userId, body.ws);
  if (gate) return gate;
  // Payroll type follows the onboarding country unless the caller overrides it.
  let country = body.country ?? null;
  if (!country) {
    const workspaces = (await getBorgaState<Workspace[]>(userWorkspacesKey(userId))) ?? [];
    country = payrollCountryFor(workspaces.find((w) => w.id === body.ws)?.country) ?? 'US';
  }
  const employees = (await getBorgaState<Employee[]>(userWsKey(userId, body.ws, 'employees'))) ?? [];
  const active = employees.filter((e) => e.status === 'active');
  if (active.length === 0) return NextResponse.json({ ok: false, error: 'No active employees to pay.' }, { status: 400 });
  const coa = (await getBorgaState<GlAccount[]>(userWsKey(userId, body.ws, 'coa'))) ?? [];
  const coaIds = coa.map((a) => a.id);
  // Smart presets first, saved mapping second, request override last.
  const preset = defaultPayrollMapping(coa, country);
  const saved = (await getBorgaState<{ mapping?: PayrollGLMapping }>(userWsKey(userId, body.ws, 'payrollSettings')))?.mapping;
  const mapping: PayrollGLMapping = {
    ...preset.mapping,
    ...(saved ?? {}),
    ...(body.mapping ?? {}),
    taxPayables: { ...preset.mapping.taxPayables, ...(saved?.taxPayables ?? {}), ...(body.mapping?.taxPayables ?? {}) },
    employerPayables: { ...preset.mapping.employerPayables, ...(saved?.employerPayables ?? {}), ...(body.mapping?.employerPayables ?? {}) },
  };
  const problems = validateMapping(mapping, coaIds);
  if (problems.length > 0) return NextResponse.json({ ok: false, error: `Fix the ledger mapping first: ${problems.join(' ')}` }, { status: 400 });
  const runKey = userWsKey(userId, body.ws, 'payrollRuns');
  const existing = (await getBorgaState<PayrollRun[]>(runKey)) ?? [];
  try {
    // HR salaries are annual — a month's pay is a twelfth. Time Clock stays informational.
    const rows = active.map((e) => ({ id: e.id, name: e.name, gross: Math.round(monthlyGross(Number(e.salary ?? 0)) * 100) / 100 }));
    if (rows.some((r) => !(r.gross > 0))) return NextResponse.json({ ok: false, error: 'Every active employee needs an annual salary > 0 in HR → Directory.' }, { status: 400 });
    const { run, totals } = releasePayrollRun({
      monthKey: body.monthKey, periodLabel: body.monthKey, country, rows,
      existingMonthKeys: existing.filter((r) => r.status === 'released').map((r) => r.monthKey),
    });
    const agg = aggregatePayrollCalcs(rows, country);
    const net = Math.round((totals.gross - agg.employee.reduce((t, l) => t + l.amount, 0)) * 100) / 100;
    const split = postPayrollSplit({
      runId: run.id, gross: totals.gross, employeeLines: agg.employee, net,
      employerLines: agg.employer,
      accounts: {
        salaryExpense: mapping.salaryExpense, clearing: mapping.clearing,
        netPayable: mapping.netPayable, employerExpense: mapping.employerExpense,
        taxPayables: mapping.taxPayables, employerPayables: mapping.employerPayables,
      },
    });
    const payrollRun: PayrollRun = {
      id: run.id, monthKey: run.monthKey, periodLabel: run.periodLabel,
      lines: run.lines.map((l) => ({ employeeId: l.employeeId, name: l.employeeName, amount: l.gross })),
      total: totals.gross, status: 'released', createdAt: new Date().toISOString(), releasedAt: new Date().toISOString(),
      journalId: split.gross.id, journalIds: [split.gross.id, split.tax.id, split.net.id, split.employer.id],
      country,
      detail: run.lines.map((l) => ({
        employeeId: l.employeeId, employeeName: l.employeeName,
        gross: l.gross, employeeTax: l.employeeTax, employerCost: l.employerCost, net: l.net,
      })),
    };
    await setBorgaState(runKey, [payrollRun, ...existing]);
    const jKey = userWsKey(userId, body.ws, 'journals');
    const journals = (await getBorgaState<JournalEntry[]>(jKey)) ?? [];
    const fresh = [split.gross, split.tax, split.net, split.employer].filter((j) => !journals.some((x) => x.externalRef === j.externalRef));
    if (fresh.length > 0) await setBorgaState(jKey, [...fresh, ...journals]);
    await emitEvent(userId, body.ws, 'payroll.posted', { runId: run.id, monthKey: run.monthKey, gross: totals.gross, net, journals: payrollRun.journalIds, filingHint: `Include ${run.monthKey} in Filing → payroll worksheet.` });
    return NextResponse.json({ ok: true, runId: run.id, journalIds: payrollRun.journalIds, ...totals, net });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Could not post payroll.' }, { status: 400 });
  }
}
