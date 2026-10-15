// Payroll engine v1: gross from salary/hours + country employer+employee rules (starter rates, confirm with accountant).
// Countries: USA, Canada, Ghana, Denmark. Pure math, tested.
export type PayrollCountry = 'US' | 'CA' | 'GH' | 'DK';

/** Maps the onboarding country name ("USA", "United States", "canada", "GH", "Danmark") to a payroll engine. Null = unknown. */
export function payrollCountryFor(country?: string | null): PayrollCountry | null {
  const c = (country ?? '').trim().toLowerCase().replace(/\./g, '');
  if (['us', 'usa', 'united states', 'united states of america'].includes(c)) return 'US';
  if (['ca', 'canada'].includes(c)) return 'CA';
  if (['gh', 'ghana'].includes(c)) return 'GH';
  if (['dk', 'denmark', 'danmark'].includes(c)) return 'DK';
  return null;
}
export interface PayrollInput {
  country: PayrollCountry; gross: number; // period gross for the employee
  state?: string;
}
export interface PayrollCalc { gross: number; employeeTax: number; employerCost: number; net: number; lines: Array<{ label: string; amount: number }>; confirm: boolean; }

// Simplified starter rates — every result carries confirm:true (needs payroll professional review).
export function calcPayroll(i: PayrollInput): PayrollCalc {
  const g = Math.max(0, i.gross);
  const lines: Array<{ label: string; amount: number }> = [];
  let employeeTax = 0; let employerCost = g;
  if (i.country === 'US') {
    const fica = g * 0.0765; employeeTax += fica; lines.push({ label: 'FICA 7.65%', amount: fica });
    const futa = g * 0.006; employerCost += g * 0.0765 + futa; lines.push({ label: 'Employer FICA+FUTA', amount: g * 0.0765 + futa });
  } else if (i.country === 'CA') {
    const cpp = Math.min(g, 68500 / 12) * 0.0595; const ei = Math.min(g, 63500 / 12) * 0.0166;
    employeeTax += cpp + ei; lines.push({ label: 'CPP', amount: cpp }, { label: 'EI', amount: ei });
    employerCost += cpp * 1.0 + ei * 1.4; lines.push({ label: 'Employer CPP+EI×1.4', amount: cpp + ei * 1.4 });
  } else if (i.country === 'GH') {
    const ssnitEmp = g * 0.055; employeeTax += ssnitEmp; lines.push({ label: 'SSNIT employee 5.5%', amount: ssnitEmp });
    const ssnitEr = g * 0.13; employerCost += ssnitEr; lines.push({ label: 'SSNIT employer 13%', amount: ssnitEr });
    const paye = g > 490 ? (g - 490) * 0.25 : 0; employeeTax += paye; lines.push({ label: 'PAYE (starter bands)', amount: paye });
  } else {
    const am = g * 0.08; employeeTax += am; lines.push({ label: 'AM-bidrag 8%', amount: am });
    employerCost += 0; lines.push({ label: 'A-skat withheld (rates vary)', amount: 0 });
  }
  return { gross: g, employeeTax, employerCost, net: g - employeeTax, lines, confirm: true };
}

export interface PayrollRunLine { employeeId: string; employeeName: string; gross: number; employeeTax: number; employerCost: number; net: number; }
export function buildPayrollLines(rows: Array<{ id: string; name: string; gross: number }>, country: PayrollCountry): PayrollRunLine[] {
  return rows.map((r) => {
    const c = calcPayroll({ country, gross: r.gross });
    return { employeeId: r.id, employeeName: r.name, gross: c.gross, employeeTax: c.employeeTax, employerCost: c.employerCost, net: c.net };
  });
}

/** HR salaries are stored annual (Employee.salary) — a month's pay is a twelfth. */
export function monthlyGross(annualSalary: number): number {
  return Math.max(0, annualSalary) / 12;
}

// ── GL mapping: every pay line points at a ledger account ────────────────────
// Smart presets resolve against the chart of accounts; anything without a good
// match falls back to Payroll Liabilities and is listed in `missing` so the
// user can create dedicated accounts or re-point the line.

export interface PayrollGLMapping {
  salaryExpense: string;
  clearing: string;
  netPayable: string;
  employerExpense: string;
  /** calc-line label → accountId, for each employee-tax (withholding) line. */
  taxPayables: Record<string, string>;
  /** calc-line label → accountId, for each employer-contribution line. */
  employerPayables: Record<string, string>;
}

export interface PayrollSettings {
  country: PayrollCountry;
  mapping: PayrollGLMapping;
}

interface CoaRef { id: string; type: string; name: string; code?: string; }

function findAccount(coa: CoaRef[], type: string, re: RegExp): string | null {
  return coa.find((a) => a.type === type && re.test(a.name ?? ''))?.id ?? null;
}

/** Keywords per payroll country for matching withholding lines to ledger accounts. */
function taxKeywords(country: PayrollCountry, label: string): RegExp {
  const l = label.toLowerCase();
  if (country === 'GH') {
    if (l.includes('paye')) return /paye|income tax|withholding/i;
    if (l.includes('ssnit')) return /ssnit|social security|pension|tier/i;
  } else if (country === 'US') {
    if (l.includes('fica')) return /fica|social security|medicare/i;
    if (l.includes('futa')) return /futa|unemployment/i;
  } else if (country === 'CA') {
    if (l.includes('cpp')) return /cpp|canada pension|pension/i;
    if (l.includes('ei')) return /\bei\b|employment insurance/i;
  } else {
    if (l.includes('am-bidrag') || l.includes('am–')) return /am-bidrag|labour market|withholding/i;
    if (l.includes('a-skat')) return /a-skat|income tax|withholding/i;
  }
  return /payroll|withholding|tax payable/i;
}

export function defaultPayrollMapping(coa: CoaRef[], country: PayrollCountry): { mapping: PayrollGLMapping; missing: string[] } {
  const missing: string[] = [];
  const generic = findAccount(coa, 'liability', /payroll/i) ?? coa.find((a) => a.type === 'liability')?.id ?? '';
  const salaryExpense = findAccount(coa, 'expense', /payroll|salar|wage/i) ?? coa.find((a) => a.type === 'expense')?.id ?? '';
  const clearing = findAccount(coa, 'liability', /clearing/i) ?? generic;
  const sample = calcPayroll({ country, gross: 1000 });
  const taxPayables: Record<string, string> = {};
  for (const line of sample.lines) {
    // employee-side lines only here; employer lines are handled below
    if (/employer/i.test(line.label)) continue;
    const hit = findAccount(coa, 'liability', taxKeywords(country, line.label));
    taxPayables[line.label] = hit ?? generic;
    if (!hit) missing.push(`“${line.label}” → using ${generic ? 'Payroll Liabilities' : 'no liability account'} — create a dedicated account or re-point the line.`);
  }
  const employerPayables: Record<string, string> = {};
  for (const line of sample.lines.filter((l) => /employer/i.test(l.label))) {
    const hit = findAccount(coa, 'liability', taxKeywords(country, line.label));
    employerPayables[line.label] = hit ?? generic;
    if (!hit) missing.push(`“${line.label}” → using ${generic ? 'Payroll Liabilities' : 'no liability account'} — create a dedicated account or re-point the line.`);
  }
  if (!salaryExpense) missing.push('No expense account found for gross salaries.');
  if (!generic) missing.push('No liability account found for payables.');
  return {
    mapping: {
      salaryExpense, clearing, netPayable: generic, employerExpense: salaryExpense,
      taxPayables, employerPayables,
    },
    missing,
  };
}

/** Dedicated payroll accounts to create when the CoA has no good match (codes avoid the stock ranges). */export function suggestedPayrollAccounts(country: PayrollCountry, existingCodes: string[]): Array<{ code: string; name: string; type: 'liability' | 'expense' }> {
  const want: Array<{ code: string; name: string; type: 'liability' | 'expense' }> = [
    { code: '2310', name: 'Payroll Clearing', type: 'liability' },
    { code: '2320', name: 'Net Wages Payable', type: 'liability' },
  ];
  const taxNames = country === 'GH'
    ? ['PAYE Payable', 'SSNIT Payable (Employee)', 'SSNIT Payable (Employer)']
    : country === 'US'
      ? ['FICA Payable', 'FUTA Payable']
      : country === 'CA'
        ? ['CPP Payable', 'EI Payable']
        : ['A-tax Payable', 'AM-bidrag Payable'];
  let code = 2330;
  for (const name of taxNames) {
    while (existingCodes.includes(String(code))) code += 10;
    want.push({ code: String(code), name, type: 'liability' });
    code += 10;
  }
  return want.filter((a) => !existingCodes.includes(a.code));
}

/** Per-label totals across all employees (labels are identical per country): employee withholdings + employer lines. */
export function aggregatePayrollCalcs(rows: Array<{ gross: number }>, country: PayrollCountry): {
  employee: Array<{ label: string; amount: number }>;
  employer: Array<{ label: string; amount: number }>;
} {
  const emp = new Map<string, number>();
  const er = new Map<string, number>();
  for (const r of rows) {
    for (const l of calcPayroll({ country, gross: r.gross }).lines) {
      const m = /employer/i.test(l.label) ? er : emp;
      m.set(l.label, (m.get(l.label) ?? 0) + l.amount);
    }
  }
  const clean = (m: Map<string, number>) => [...m.entries()]
    .filter(([, a]) => a > 0.004)
    .map(([label, amount]) => ({ label, amount: Math.round(amount * 100) / 100 }));
  return { employee: clean(emp), employer: clean(er) };
}

/** Every mapped account must be set and exist in the chart of accounts. */
export function validateMapping(m: PayrollGLMapping, coaIds: string[]): string[] {
  const problems: string[] = [];
  const need: Array<[string, string]> = [
    ['Gross salaries', m.salaryExpense],
    ['Payroll clearing', m.clearing],
    ['Net wages payable', m.netPayable],
    ['Employer cost expense', m.employerExpense],
  ];
  for (const [label, id] of need) {
    if (!id) problems.push(`${label}: no account chosen.`);
    else if (!coaIds.includes(id)) problems.push(`${label}: account is gone from the chart — pick again.`);
  }
  for (const [label, id] of [...Object.entries(m.taxPayables), ...Object.entries(m.employerPayables)]) {
    if (!id) problems.push(`“${label}”: no account chosen.`);
    else if (!coaIds.includes(id)) problems.push(`“${label}”: account is gone from the chart — pick again.`);
  }
  return problems;
}

/** Release a monthly run: one monthKey exactly once; totals feed the ledger posting + filing hint. */
export function releasePayrollRun(o: { monthKey: string; periodLabel: string; country: PayrollCountry; rows: Array<{ id: string; name: string; gross: number }>; existingMonthKeys: string[] }): {
  run: { id: string; monthKey: string; periodLabel: string; lines: PayrollRunLine[]; gross: number; employerCost: number; net: number; status: 'released' };
  totals: { gross: number; employeeTax: number; employerCost: number; net: number };
} {
  if (!/^\d{4}-\d{2}$/.test(o.monthKey)) throw new Error('monthKey must be YYYY-MM.');
  if (o.existingMonthKeys.includes(o.monthKey)) throw new Error(`Month ${o.monthKey} was already released.`);
  if (o.rows.length === 0) throw new Error('No employees to pay.');
  const lines = buildPayrollLines(o.rows, o.country);
  const totals = lines.reduce((t, l) => ({ gross: t.gross + l.gross, employeeTax: t.employeeTax + l.employeeTax, employerCost: t.employerCost + l.employerCost, net: t.net + l.net }), { gross: 0, employeeTax: 0, employerCost: 0, net: 0 });
  return {
    run: { id: `pr-${o.monthKey}`, monthKey: o.monthKey, periodLabel: o.periodLabel, lines, gross: totals.gross, employerCost: totals.employerCost, net: totals.net, status: 'released' },
    totals,
  };
}

// ── History: table figures and KPIs ──────────────────────────────────────────

export interface HistoryRunLike {
  monthKey: string;
  total: number;
  status: string;
  lines: Array<{ amount: number }>;
  detail?: Array<{ gross: number; employeeTax: number; employerCost: number; net: number }>;
}

export interface PayrollHistorySummary {
  runCount: number;
  ytdGross: number;
  ytdNet: number;
  ytdEmployer: number;
  headcount: number;
  lastMonthKey: string;
  /** True when some runs predate per-employee detail (net/employer recomputed, labeled estimate in the UI). */
  estimated: boolean;
}

/** Year-to-date (or year-filtered) totals for the KPI strip. */
export function summarizePayrollHistory(runs: HistoryRunLike[], year?: string): PayrollHistorySummary {
  const rows = (year ? runs.filter((r) => r.monthKey.startsWith(`${year}-`)) : runs)
    .filter((r) => r.status === 'released')
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey));
  let estimated = false;
  let ytdGross = 0, ytdNet = 0, ytdEmployer = 0;
  for (const r of rows) {
    ytdGross += r.total;
    if (r.detail) {
      ytdNet += r.detail.reduce((t, d) => t + d.net, 0);
      ytdEmployer += r.detail.reduce((t, d) => t + d.employerCost, 0);
    } else if (rows.length > 0) {
      estimated = true;
    }
  }
  const headcount = rows.length ? Math.max(...rows.map((r) => r.lines.length)) : 0;
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    runCount: rows.length, ytdGross: round(ytdGross), ytdNet: round(ytdNet),
    ytdEmployer: round(ytdEmployer), headcount,
    lastMonthKey: rows.length ? rows[rows.length - 1].monthKey : '',
    estimated,
  };
}

/** Default month for the next run: the month after the latest released one (catching up to the current month when behind). */
export function nextUnpaidMonth(releasedKeys: string[], todayIso = new Date().toISOString().slice(0, 10)): string {
  const current = todayIso.slice(0, 7);
  if (releasedKeys.length === 0) return current;
  const latest = [...releasedKeys].sort().pop() as string;
  if (latest < current) return current;
  const [y, m] = latest.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}
