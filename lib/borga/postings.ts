// Central ledger posting helpers: every money movement posts balanced journals linked to its source.
// P0 fix: payInvoice/payBill/payroll/SAFE-convert/bank-match no longer live only in the flat FinanceEntry list.
import type { JournalEntry } from './data';

const uid = (p: string) => `${p}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
const iso = () => new Date().toISOString().slice(0, 10);

export function postInvoicePayment(o: { invoiceId: string; amount: number; cashAccountId: string; arAccountId: string; memo?: string }): JournalEntry {
  return {
    id: uid('j'), date: iso(), dateIso: iso(), memo: o.memo ?? `Invoice ${o.invoiceId} paid`,
    lines: [
      { accountId: o.cashAccountId, debit: o.amount, credit: 0 },
      { accountId: o.arAccountId, debit: 0, credit: o.amount },
    ],
    status: 'posted', externalRef: `invoice:${o.invoiceId}:paid`,
  } as unknown as JournalEntry;
}

export function postBillPayment(o: { billId: string; amount: number; cashAccountId: string; apAccountId: string }): JournalEntry {
  return {
    id: uid('j'), date: iso(), dateIso: iso(), memo: `Bill ${o.billId} paid`,
    lines: [
      { accountId: o.apAccountId, debit: o.amount, credit: 0 },
      { accountId: o.cashAccountId, debit: 0, credit: o.amount },
    ],
    status: 'posted', externalRef: `bill:${o.billId}:paid`,
  } as unknown as JournalEntry;
}

export function postPayroll(o: { runId: string; gross: number; employerCost: number; salaryAccountId: string; payableAccountId: string }): JournalEntry {
  const total = o.gross + Math.max(0, o.employerCost - o.gross);
  return {
    id: uid('j'), date: iso(), dateIso: iso(), memo: `Payroll ${o.runId}`,
    lines: [
      { accountId: o.salaryAccountId, debit: total, credit: 0 },
      { accountId: o.payableAccountId, debit: 0, credit: total },
    ],
    status: 'posted', externalRef: `payroll:${o.runId}`, auto: 'payroll',
  } as unknown as JournalEntry;
}

// ── Split payroll posting: four balanced journals per run ────────────────────
// gross:        DR salary expense / CR clearing
// withholdings: DR clearing / CR each tax payable (PAYE, SSNIT, FICA, …)
// net pay:      DR clearing / CR net wages payable  (clearing nets to zero)
// employer:     DR employer expense / CR each employer payable
// Amounts are rounded to cents; the net line absorbs sub-cent dust so every
// journal balances exactly.

const cents = (n: number) => Math.round(n * 100) / 100;

export interface PayrollSplitAccounts {
  salaryExpense: string;
  clearing: string;
  netPayable: string;
  employerExpense: string;
  taxPayables: Record<string, string>;
  employerPayables: Record<string, string>;
}

export interface PayrollSplitInput {
  runId: string;
  gross: number;
  employeeLines: Array<{ label: string; amount: number }>;
  net: number;
  employerLines: Array<{ label: string; amount: number }>;
  accounts: PayrollSplitAccounts;
}

export interface PayrollSplitJournals { gross: JournalEntry; tax: JournalEntry; net: JournalEntry; employer: JournalEntry; }

export function postPayrollSplit(o: PayrollSplitInput): PayrollSplitJournals {
  const gross = cents(o.gross);
  const taxLines = o.employeeLines.map((l) => ({ ...l, amount: cents(l.amount) }));
  const taxTotal = cents(taxLines.reduce((t, l) => t + l.amount, 0));
  const net = cents(gross - taxTotal); // dust settles here: clearing always nets to zero
  const employerLines = o.employerLines.map((l) => ({ ...l, amount: cents(l.amount) }));
  const employerTotal = cents(employerLines.reduce((t, l) => t + l.amount, 0));
  const mk = (memo: string, ref: string, lines: JournalEntry['lines']): JournalEntry => ({
    id: uid('j'), date: iso(), dateIso: iso(), memo,
    lines, status: 'posted', externalRef: ref, auto: 'payroll',
  } as unknown as JournalEntry);
  const a = o.accounts;
  for (const l of taxLines) if (!a.taxPayables[l.label]) throw new Error(`No account mapped for “${l.label}”.`);
  for (const l of employerLines) if (!a.employerPayables[l.label]) throw new Error(`No account mapped for “${l.label}”.`);
  return {
    gross: mk(`Payroll ${o.runId} — gross pay`, `payroll:${o.runId}:gross`, [
      { accountId: a.salaryExpense, debit: gross, credit: 0 },
      { accountId: a.clearing, debit: 0, credit: gross },
    ]),
    tax: mk(`Payroll ${o.runId} — withholdings`, `payroll:${o.runId}:tax`, [
      { accountId: a.clearing, debit: taxTotal, credit: 0 },
      ...taxLines.map((l) => ({ accountId: a.taxPayables[l.label], debit: 0, credit: l.amount })),
    ]),
    net: mk(`Payroll ${o.runId} — net pay`, `payroll:${o.runId}:net`, [
      { accountId: a.clearing, debit: net, credit: 0 },
      { accountId: a.netPayable, debit: 0, credit: net },
    ]),
    employer: mk(`Payroll ${o.runId} — employer contributions`, `payroll:${o.runId}:employer`, [
      { accountId: a.employerExpense, debit: employerTotal, credit: 0 },
      ...employerLines.map((l) => ({ accountId: a.employerPayables[l.label], debit: 0, credit: l.amount })),
    ]),
  };
}

export function postSafeConversion(o: { safeId: string; amount: number; equityAccountId: string; apAccountId: string }): JournalEntry {
  return {
    id: uid('j'), date: iso(), dateIso: iso(), memo: `SAFE ${o.safeId} converted`,
    lines: [
      { accountId: o.apAccountId, debit: o.amount, credit: 0 },
      { accountId: o.equityAccountId, debit: 0, credit: o.amount },
    ],
    status: 'posted', externalRef: `safe:${o.safeId}:converted`,
  } as unknown as JournalEntry;
}

