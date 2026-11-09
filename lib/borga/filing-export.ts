// A filing as a spreadsheet: the form's own lines (filing-templates.ts) with the books' figures dropped in, the worksheet behind them,
// a checklist and sign-off. Built once as plain sheets, then written as .xlsx or as CSV, so both carry exactly the same content.

import type { Workspace } from './data';
import { currencyDigits } from './currencies';
import type { FilingFigures } from './filing-figures';
import { fillTemplate, templateFor } from './filing-templates';
import type { FilingRecord, Jurisdiction, Obligation, Period } from './filing-catalog';

export type Cell = null | string | number | { v: string | number | null; bold?: boolean; fill?: string; wrap?: boolean; amount?: boolean };
export interface SheetSpec {
  name: string;
  /** column widths, in characters */
  widths: number[];
  rows: Cell[][];
}

const CHECKLIST: Record<string, string[]> = {
  salesTax: [
    'Every invoice and bill dated in the period is entered, and none is entered twice.',
    'Invoices still marked draft, and bills not yet received, are left out on purpose.',
    'Each purchase claimed has a valid supplier invoice and was for the business.',
    'Zero-rated, exempt and out-of-province or foreign sales are treated the way the authority expects.',
    'The totals agree with the sales and purchases accounts in the ledger.',
    'Any amount owing is paid by the due date, even if the return is filed later.',
  ],
  income: [
    'Revenue and expenses agree with the ledger and the bank statements for the whole year.',
    'Payroll, depreciation, interest, owner pay and non-deductible items are added.',
    'Losses and credits carried forward from earlier years are applied.',
    'Instalments already paid during the year are credited.',
    'Related-party and foreign transactions the form asks about are disclosed.',
  ],
  payroll: [
    'Every person paid in the period is on the payroll list, with the right start and end dates.',
    'Tax withheld and employer contributions come from the payroll provider, not from this file.',
    'Remittances are paid by the due date, and slips agree with the year\'s totals.',
  ],
  none: ['The amount and the due date are confirmed with the authority\'s notice or online account.'],
};

export interface ExportArgs {
  company: Pick<Workspace, 'name' | 'legalName' | 'businessNumber' | 'taxNumber' | 'addressLine' | 'city' | 'state' | 'country'>;
  jurisdiction: Pick<Jurisdiction, 'country' | 'regionName'>;
  ob: Obligation;
  period: Period;
  label: string;
  due: string | null;
  figures: FilingFigures | null;
  record?: FilingRecord;
  currency: string;
  generatedOn: string;
}

const H = (v: string): Cell => ({ v, bold: true, fill: '#E8EEF4' });
const B = (v: string): Cell => ({ v, bold: true });

export function buildFilingSheets(a: ExportArgs): SheetSpec[] {
  const { company: c, ob, period, due, figures: f, record, currency } = a;
  const tpl = templateFor(ob);
  const addr = [c.addressLine, c.city, c.state, c.country].filter(Boolean).join(', ');
  const status = record ? `${record.status.replace('-', ' ')}${record.filedOn ? ` on ${record.filedOn}` : ''}${record.reference ? `, confirmation ${record.reference}` : ''}` : 'open';

  const form: Cell[][] = [
    [{ v: tpl.title, bold: true }],
    [`${ob.name}${ob.form ? `, form ${ob.form}` : ''} · ${ob.authority}`],
    [],
    [B('Company')],
    ['Legal name', c.legalName || c.name],
    ...(c.businessNumber ? [['Business number', c.businessNumber] as Cell[]] : []),
    ...(c.taxNumber ? [['Tax / VAT / EIN number', c.taxNumber] as Cell[]] : []),
    ...(addr ? [['Address', addr] as Cell[]] : []),
    ['Jurisdiction', [a.jurisdiction.country, a.jurisdiction.regionName].filter(Boolean).join(' · ')],
    ['Reporting currency', currency],
    [],
    [B('This filing')],
    ['Period', `${period.start} to ${period.end} (${a.label})`],
    ['Due', due ? `${due}${record?.dueOverride ? ' (set by the company)' : ''}` : 'to be confirmed'],
    ['Status', status],
    ...(record?.preparer ? [['Prepared by', record.preparer] as Cell[]] : []),
    ...(record?.reviewer ? [['Reviewed by', record.reviewer] as Cell[]] : []),
    [],
    [H('Line'), H('Description'), H(`Amount (${currency})`), H('Where it comes from / what to enter')],
  ];
  for (const r of fillTemplate(tpl, f)) {
    if (r.section) form.push([{ v: r.label, bold: true }]);
    else form.push([r.ref, { v: r.label, wrap: true }, r.amount === null ? null : { v: r.amount, amount: !r.count }, { v: r.source, wrap: true }]);
  }
  form.push([]);
  if (ob.note) form.push([{ v: ob.note, wrap: true }]);
  for (const n of f?.notes ?? []) form.push([{ v: n, wrap: true }]);
  if (f && f.skippedUndated > 0) form.push([{ v: `${f.skippedUndated} document(s) have a date that is not a calendar date and are left out.`, wrap: true }]);
  form.push([]);
  form.push([B('Sign-off')]);
  form.push(['Prepared by', '', 'Date', '']);
  form.push(['Reviewed by', '', 'Date', '']);
  form.push(['Filed by', '', 'Date', '']);
  form.push([]);
  form.push([{
    v: `Prepared from the company's own records on ${a.generatedOn}. This is a worksheet laid out like the form, not the tax return itself and not tax advice. The figures come from invoices, bills and the people list only, forms change from year to year, and the due date is the general rule. Check the line numbers against the current form${ob.url ? ` (${ob.url})` : ''} and confirm the figures with the authority or your accountant before filing.`,
    wrap: true,
  }]);

  const sheets: SheetSpec[] = [{ name: 'Filing', widths: [20, 58, 18, 58], rows: form }];

  if (f) {
    sheets.push({
      name: 'Worksheet', widths: [64, 18],
      rows: [[H('Figure'), H(`Amount (${currency})`)], ...f.lines.map((l): Cell[] => [{ v: l.label, bold: l.strong }, { v: l.amount, amount: !l.count, bold: l.strong }])],
    });
  }
  const list = CHECKLIST[f?.basis ?? ob.figures] ?? CHECKLIST.none;
  sheets.push({ name: 'Checklist', widths: [8, 90, 12], rows: [[H('Done'), H('Before filing'), H('Initials')], ...list.map((t): Cell[] => ['☐', { v: t, wrap: true }, ''])] });
  return sheets;
}

// ── CSV ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

const valueOf = (c: Cell): string | number | null => (c !== null && typeof c === 'object' ? c.v : c);
const isAmount = (c: Cell) => c !== null && typeof c === 'object' && c.amount === true;

/** A text cell that a spreadsheet would run as a formula (starts with = + - @) is made harmless with a leading apostrophe. */
export function csvSafe(s: string): string {
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

function csvCell(c: Cell, digits: number): string {
  const v = valueOf(c);
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') return isAmount(c) ? v.toFixed(digits) : String(v);
  return `"${csvSafe(v).replace(/"/g, '""')}"`;
}

/** All sheets in one CSV, one after another, each under its own title row. UTF-8 with a byte order mark so Excel reads accents right. */
export function toCsv(sheets: SheetSpec[], currency: string): string {
  const digits = currencyDigits(currency);
  const lines: string[] = [];
  sheets.forEach((s, i) => {
    if (i > 0) lines.push('', `"${s.name.toUpperCase()}"`);
    for (const row of s.rows) lines.push(row.map((c) => csvCell(c, digits)).join(','));
  });
  return '﻿' + lines.join('\r\n') + '\r\n';
}

// ── Excel ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The sheets in the shape write-excel-file takes. Amounts are numbers (so Excel can add them) shown with the currency's own decimals. */
export function toExcelSheets(sheets: SheetSpec[], currency: string) {
  const digits = currencyDigits(currency);
  const format = `#,##0${digits > 0 ? '.' + '0'.repeat(digits) : ''}`;
  return sheets.map((s) => ({
    data: s.rows.map((row) =>
      row.map((c) => {
        if (c === null || c === undefined || c === '') return null;
        if (typeof c === 'string') return c.length > 60 ? { value: c, wrap: true } : { value: c };
        if (typeof c === 'number') return { value: c };
        if (c.v === null || c.v === '') return null;
        const cell: Record<string, unknown> = { value: c.v };
        if (c.bold) cell.fontWeight = 'bold';
        if (c.fill) cell.backgroundColor = c.fill;
        if (c.wrap) { cell.wrap = true; cell.alignVertical = 'top'; }
        if (c.amount && typeof c.v === 'number') { cell.format = format; cell.align = 'right'; }
        return cell;
      }),
    ),
    sheet: s.name,
    columns: s.widths.map((width) => ({ width })),
  }));
}

export function exportFileName(company: string, obId: string, key: string, ext: 'xlsx' | 'csv'): string {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'company';
  return `${slug(company)}-${obId}-${key.replace('#', '-')}.${ext}`;
}
