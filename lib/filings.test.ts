import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addMonths, addDays, daysBetween, isIso, fiscalYearEnd, filingsOf, dueStateOf, jurisdictionOf, builtInObligations, applicableObligations,
  provinceCode, usStateCode, filingCountryOf, levelLabel, DEFAULT_FILING_PROFILE, type Obligation, type FilingProfile,
} from './borga/filing-catalog';
import { figuresFor } from './borga/filing-figures';
import type { Bill, Employee, Invoice, TaxProfile } from './borga/data';

const DEC: { month: number; day: number } = { month: 12, day: 31 };
const profile = (over: Partial<FilingProfile> = {}): FilingProfile => ({ ...DEFAULT_FILING_PROFILE, ...over });
const find = (country: string, state: string, id: string): Obligation => {
  const ob = builtInObligations(jurisdictionOf(country, state)).find((o) => o.id === id);
  assert.ok(ob, `${id} should exist for ${country}/${state}`);
  return ob;
};
const dues = (ob: Obligation, p: FilingProfile, fye = DEC, from = '2025-12-31', to = '2027-12-31') => filingsOf(ob, p, fye, from, to);

// ── date arithmetic ───────────────────────────────────────────────────────────────────────────────────────────────────

test('month arithmetic keeps end-of-month periods at end of month and clamps short months', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2027-01-31', 1), '2027-02-28');
  assert.equal(addMonths('2027-12-31', 2), '2028-02-29', 'leap year');
  assert.equal(addMonths('2026-06-30', 6), '2026-12-31', 'a June 30 year end is the last day of June, so +6 is the last day of December');
  assert.equal(addMonths('2026-03-15', 1), '2026-04-15');
  assert.equal(addMonths('2025-12-31', 4, 15), '2026-04-15');
  assert.equal(addMonths('2025-12-31', -12), '2024-12-31');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(daysBetween('2026-01-01', '2026-01-31'), 30);
  assert.equal(isIso('2026-02-30'), false);
  assert.equal(isIso('Feb 28'), false);
  assert.equal(isIso('2026-02-28'), true);
});

// ── jurisdiction ──────────────────────────────────────────────────────────────────────────────────────────────────────

test('country, province and state are recognised by name or code, with accents', () => {
  assert.equal(filingCountryOf('Canada'), 'CA');
  assert.equal(filingCountryOf('United States'), 'US');
  assert.equal(filingCountryOf('Ghana'), 'GH');
  assert.equal(filingCountryOf('France'), 'OTHER');
  assert.equal(provinceCode('Québec'), 'QC');
  assert.equal(provinceCode('ontario'), 'ON');
  assert.equal(provinceCode('BC'), 'BC');
  assert.equal(provinceCode('Texas'), '');
  assert.equal(usStateCode('Texas'), 'TX');
  assert.equal(usStateCode('ca'), 'CA');
  assert.equal(usStateCode(''), '');
  assert.equal(levelLabel('GH', 'federal'), 'National');
  assert.equal(levelLabel('CA', 'federal'), 'Federal');
});

// ── Canada ────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('Canada: T2 is due 6 months after the year end, GST/HST one month after the period', () => {
  const t2 = find('Canada', 'Ontario', 'ca-t2');
  assert.deepEqual(dues(t2, profile()).map((d) => d.due), ['2026-06-30', '2027-06-30', '2028-06-30']);
  const june = dues(t2, profile(), { month: 6, day: 30 }, '2026-06-30', '2026-06-30');
  assert.equal(june[0].due, '2026-12-31');

  const gst = find('Canada', 'Ontario', 'ca-gsthst');
  const monthly = dues(gst, profile({ salesTaxFrequency: 'monthly' }), DEC, '2026-01-31', '2026-02-28');
  assert.deepEqual(monthly.map((d) => [d.period.end, d.due]), [['2026-01-31', '2026-02-28'], ['2026-02-28', '2026-03-31']]);
  const quarterly = dues(gst, profile({ salesTaxFrequency: 'quarterly' }), DEC, '2026-01-01', '2026-12-31');
  assert.deepEqual(quarterly.map((d) => [d.period.end, d.due]), [['2026-03-31', '2026-04-30'], ['2026-06-30', '2026-07-31'], ['2026-09-30', '2026-10-31'], ['2026-12-31', '2027-01-31']]);
  const annual = dues(gst, profile({ salesTaxFrequency: 'annual' }), DEC, '2026-12-31', '2026-12-31');
  assert.equal(annual[0].due, '2027-03-31');
  assert.equal(annual[0].period.start, '2026-01-01');
});

test('fiscal quarters follow the year end, not the calendar', () => {
  const gst = find('Canada', 'Alberta', 'ca-gsthst');
  const q = dues(gst, profile({ salesTaxFrequency: 'quarterly' }), { month: 1, day: 31 }, '2026-01-01', '2026-12-31');
  assert.deepEqual(q.map((d) => d.period.end), ['2026-01-31', '2026-04-30', '2026-07-31', '2026-10-31']);
  assert.equal(q[1].period.start, '2026-02-01');
});

test('Canada: T4 is due the end of February, and payroll remittances on the 15th', () => {
  assert.deepEqual(dues(find('Canada', 'Ontario', 'ca-t4'), profile(), DEC, '2027-12-31', '2027-12-31').map((d) => d.due), ['2028-02-29']);
  const pay = dues(find('Canada', 'Ontario', 'ca-payroll'), profile(), DEC, '2026-01-31', '2026-01-31');
  assert.equal(pay[0].due, '2026-02-15');
});

test('Quebec files its own combined return, Alberta its own corporate return, Ontario neither', () => {
  const qc = builtInObligations(jurisdictionOf('Canada', 'Quebec')).map((o) => o.id);
  assert.ok(qc.includes('qc-qst') && qc.includes('qc-co17') && qc.includes('qc-rl1'));
  assert.ok(!qc.includes('ca-gsthst'), 'the Revenu Québec return replaces the federal GST/HST return');
  const ab = builtInObligations(jurisdictionOf('Canada', 'Alberta')).map((o) => o.id);
  assert.ok(ab.includes('ab-at1') && ab.includes('ca-gsthst'));
  const on = builtInObligations(jurisdictionOf('Canada', 'Ontario')).map((o) => o.id);
  assert.ok(!on.includes('qc-co17') && !on.includes('ab-at1'));
  assert.equal(jurisdictionOf('Canada', 'Yukon').notes.some((n) => /no territorial sales tax/.test(n)), true);
});

test('which obligations apply depends on entity type, employees and tax registration', () => {
  const j = jurisdictionOf('Canada', 'Ontario');
  const ids = (p: FilingProfile, ctx: { employees: boolean; registered: boolean }) => applicableObligations(j, p, ctx).map((o) => o.id);
  const corp = ids(profile(), { employees: false, registered: true });
  assert.ok(corp.includes('ca-t2') && corp.includes('ca-gsthst') && !corp.includes('ca-t4') && !corp.includes('ca-t1-business'));
  const sole = ids(profile({ entityType: 'sole-proprietor' }), { employees: true, registered: false });
  assert.ok(sole.includes('ca-t1-business') && sole.includes('ca-t4') && !sole.includes('ca-t2') && !sole.includes('ca-gsthst'));
});

// ── United States ─────────────────────────────────────────────────────────────────────────────────────────────────────

test('United States: 1120 on the 15th of the 4th month, 1120-S and 1065 on the 15th of the 3rd', () => {
  assert.equal(dues(find('United States', 'Texas', 'us-1120'), profile(), DEC, '2025-12-31', '2025-12-31')[0].due, '2026-04-15');
  assert.equal(dues(find('United States', 'Texas', 'us-1120'), profile(), { month: 6, day: 30 }, '2026-06-30', '2026-06-30')[0].due, '2026-10-15');
  assert.equal(dues(find('United States', 'Texas', 'us-1120s'), profile(), DEC, '2025-12-31', '2025-12-31')[0].due, '2026-03-15');
  assert.equal(dues(find('United States', 'Texas', 'us-1065'), profile(), DEC, '2025-12-31', '2025-12-31')[0].due, '2026-03-15');
});

test('United States: estimated tax instalments and the quarterly payroll return', () => {
  const corp = dues(find('United States', 'Texas', 'us-est-corp'), profile(), DEC, '2026-12-31', '2026-12-31');
  assert.deepEqual(corp.map((d) => d.due), ['2026-04-15', '2026-06-15', '2026-09-15', '2026-12-15']);
  assert.match(corp[0].label, /Instalment 1 of 4/);
  const sole = dues(find('United States', 'Texas', 'us-est-sole'), profile(), DEC, '2026-12-31', '2026-12-31');
  assert.deepEqual(sole.map((d) => d.due), ['2026-04-15', '2026-06-15', '2026-09-15', '2027-01-15']);
  const q = dues(find('United States', 'Texas', 'us-941'), profile(), DEC, '2026-03-31', '2026-12-31');
  assert.deepEqual(q.map((d) => d.due), ['2026-04-30', '2026-07-31', '2026-10-31', '2027-01-31']);
});

test('United States: states with their own rules replace the generic state return; the rest are entered by hand', () => {
  const tx = builtInObligations(jurisdictionOf('United States', 'Texas')).map((o) => o.id);
  assert.ok(tx.includes('us-tx-franchise') && !tx.includes('us-state-income'));
  assert.equal(dues(find('United States', 'Texas', 'us-tx-franchise'), profile(), DEC, '2025-12-31', '2025-12-31')[0].due, '2026-05-15');
  const ca = builtInObligations(jurisdictionOf('United States', 'California')).map((o) => o.id);
  assert.ok(ca.includes('us-ca-100') && !ca.includes('us-state-income'));
  assert.equal(dues(find('United States', 'California', 'us-ca-100'), profile(), DEC, '2025-12-31', '2025-12-31')[0].due, '2026-04-15');
  const ohio = find('United States', 'Ohio', 'us-state-income');
  const row = dues(ohio, profile(), DEC, '2025-12-31', '2025-12-31')[0];
  assert.equal(row.due, null, 'no built-in date: the user enters it');
  assert.equal(dueStateOf(row.due, undefined, '2026-01-10'), 'needs-date');
  assert.equal(dueStateOf(row.due, { key: 'x', status: 'filed' }, '2026-01-10'), 'filed');
  assert.equal(dueStateOf(row.due, { key: 'x', status: 'not-required' }, '2026-01-10'), 'not-required');
  assert.equal(dueStateOf(row.due, { key: 'x', status: 'filed', dueOverride: '2026-05-01' }, '2026-01-10'), 'filed');
  assert.equal(dueStateOf(null, undefined, '2026-01-10'), 'needs-date');
  assert.equal(dueStateOf(null, { key: 'x', status: 'not-required' }, '2026-01-10'), 'not-required');
  assert.equal(builtInObligations(jurisdictionOf('United States', '')).some((o) => o.level === 'state'), false, 'no state set, no state filings');
});

// ── Ghana and elsewhere ───────────────────────────────────────────────────────────────────────────────────────────────

test('Ghana: VAT monthly, income tax 4 months after the year end, provisional tax quarterly, PAYE on the 15th', () => {
  assert.equal(dues(find('Ghana', 'Greater Accra', 'gh-vat'), profile(), DEC, '2026-01-31', '2026-01-31')[0].due, '2026-02-28');
  assert.equal(dues(find('Ghana', 'Greater Accra', 'gh-cit'), profile(), DEC, '2025-12-31', '2025-12-31')[0].due, '2026-04-30');
  assert.deepEqual(dues(find('Ghana', 'Greater Accra', 'gh-provisional'), profile(), DEC, '2026-12-31', '2026-12-31').map((d) => d.due), ['2026-03-31', '2026-06-30', '2026-09-30', '2026-12-31']);
  assert.equal(dues(find('Ghana', 'Greater Accra', 'gh-paye'), profile(), DEC, '2026-03-31', '2026-03-31')[0].due, '2026-04-15');
  const j = jurisdictionOf('Ghana', 'Ashanti');
  assert.equal(j.regionLevel, null, 'Ghana has no provincial level');
  assert.equal(builtInObligations(j).some((o) => o.level === 'provincial' || o.level === 'state'), false);
});

test('another country has no built-in filings but can add its own', () => {
  const j = jurisdictionOf('France', 'Île-de-France');
  assert.equal(builtInObligations(j).length, 0);
  const p = profile({ custom: [{ id: 'c1', name: 'TVA return', authority: 'DGFiP', level: 'federal', frequency: 'monthly', periodBasis: 'fiscal', monthsAfter: 1, day: 20 }] });
  const list = applicableObligations(j, p, { employees: false, registered: true });
  assert.equal(list.length, 1);
  assert.equal(dues(list[0], p, DEC, '2026-01-31', '2026-01-31')[0].due, '2026-02-20');
});

test('fiscal year end defaults to December 31 and ignores nonsense', () => {
  assert.deepEqual(fiscalYearEnd(undefined), { month: 12, day: 31 });
  assert.deepEqual(fiscalYearEnd({ fiscalYearEndMonth: 3, fiscalYearEndDay: 31 }), { month: 3, day: 31 });
  assert.deepEqual(fiscalYearEnd({ fiscalYearEndMonth: 13, fiscalYearEndDay: 0 }), { month: 12, day: 31 });
});

test('a filing is overdue the day after its date, due soon within 30 days, otherwise upcoming', () => {
  assert.equal(dueStateOf('2026-03-31', undefined, '2026-04-01'), 'overdue');
  assert.equal(dueStateOf('2026-03-31', undefined, '2026-03-31'), 'due-soon');
  assert.equal(dueStateOf('2026-03-31', undefined, '2026-03-01'), 'due-soon');
  assert.equal(dueStateOf('2026-03-31', undefined, '2026-02-01'), 'upcoming');
  assert.equal(dueStateOf('2026-03-31', { key: 'k', status: 'filed' }, '2026-06-01'), 'filed');
  assert.equal(dueStateOf('2026-03-31', { key: 'k', status: 'not-required' }, '2026-06-01'), 'not-required');
  assert.equal(dueStateOf('2026-03-31', { key: 'k', status: 'filed', dueOverride: '2026-09-01' }, '2026-06-01'), 'filed');
  assert.equal(dueStateOf(null, { key: 'k', status: 'filed', dueOverride: '2026-09-01' } as never, '2026-06-01'), 'filed');
  assert.equal(dueStateOf('2026-03-31', { key: 'k', status: 'filed', dueOverride: 'bad' } as never, '2026-06-01'), 'filed');
});

// ── figures ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const PROFILES: TaxProfile[] = [
  { id: 'gst', name: 'GST', rate: 5, category: 'gst' },
  { id: 'pst', name: 'PST', rate: 7, category: 'sales' },
  { id: 'hst', name: 'HST', rate: 13, category: 'gst' },
];
const inv = (over: Partial<Invoice>): Invoice => ({ id: 'i', number: 'INV-1', client: 'A', amount: 0, status: 'sent', issued: '2026-01-10', due: '2026-02-10', ...over });
const bill = (over: Partial<Bill>): Bill => ({ id: 'b', vendorId: 'v', vendorName: 'V', number: 'B1', amount: 0, received: '2026-01-12', due: '2026-02-12', status: 'unpaid', ...over });
const period = { start: '2026-01-01', end: '2026-03-31', key: '2026-03-31' };
const line = (f: ReturnType<typeof figuresFor>, label: RegExp) => f?.lines.find((l) => label.test(l.label))?.amount;

test('sales tax worksheet splits each document into net and tax, by profile, and nets credits off', () => {
  const ob = find('Canada', 'Ontario', 'ca-gsthst');
  const f = figuresFor(ob, period, {
    invoices: [
      inv({ amount: 113, taxProfileIds: ['hst'] }),
      inv({ amount: 105, taxProfileIds: ['gst'], id: 'i2' }),
      inv({ amount: 999, status: 'draft', id: 'd' }),
      inv({ amount: 999, voidedAt: '2026-01-20', id: 'v' }),
      inv({ amount: 999, issued: '2025-12-31', id: 'old' }),
      inv({ amount: 50, issued: 'Feb 28', id: 'undated' }),
    ],
    bills: [bill({ amount: 56.5, taxProfileIds: ['hst'] })],
    employees: [], taxProfiles: PROFILES,
  });
  assert.ok(f);
  assert.equal(line(f, /^Sales, before tax/), 200, '100 net from the HST invoice and 100 from the GST one');
  assert.equal(line(f, /Tax charged: HST/), 13);
  assert.equal(line(f, /Tax charged: GST/), 5);
  assert.equal(line(f, /Total tax charged/), 18);
  assert.equal(line(f, /Purchases, before tax/), 50);
  assert.equal(line(f, /Total tax paid on purchases/), 6.5);
  assert.equal(line(f, /Net tax to pay/), 11.5);
  assert.equal(f.skippedUndated, 1, 'a document with a display date is counted, not guessed at');
});

test('a return only lists the tax profiles that belong on it', () => {
  const f = figuresFor(find('Canada', 'British Columbia', 'bc-pst'), period, {
    invoices: [inv({ amount: 112, taxProfileIds: ['gst', 'pst'] })], bills: [], employees: [], taxProfiles: PROFILES,
  });
  assert.equal(line(f, /Tax charged: PST/), 7);
  assert.equal(line(f, /Tax charged: GST/), undefined);
  assert.equal(line(f, /Net tax to pay/), 7);
});

test('a refund is shown as a refund, not a negative payment', () => {
  const f = figuresFor(find('Canada', 'Ontario', 'ca-gsthst'), period, { invoices: [], bills: [bill({ amount: 113, taxProfileIds: ['hst'] })], employees: [], taxProfiles: PROFILES });
  assert.equal(line(f, /Net refund claimed/), 13);
  assert.equal(line(f, /Net tax to pay/), undefined);
});

test('an old invoice that only kept a rate still has its tax split out', () => {
  const f = figuresFor(find('Canada', 'Ontario', 'ca-gsthst'), period, { invoices: [inv({ amount: 115, taxRate: 15 })], bills: [], employees: [], taxProfiles: PROFILES });
  assert.equal(line(f, /Sales, before tax/), 100);
  assert.equal(line(f, /Total tax charged/), 15);
});

test('income worksheet is revenue minus expenses before tax, and says what it leaves out', () => {
  const f = figuresFor(find('Canada', 'Ontario', 'ca-t2'), period, {
    invoices: [inv({ amount: 226, taxProfileIds: ['hst'] })], bills: [bill({ amount: 56.5, taxProfileIds: ['hst'] })], employees: [], taxProfiles: PROFILES,
  });
  assert.equal(line(f, /Revenue/), 200);
  assert.equal(line(f, /Expenses/), 50);
  assert.equal(line(f, /Indicative profit/), 150);
  assert.match(f!.notes.join(' '), /not taxable income/);
});

test('payroll worksheet counts people on the payroll and estimates gross pay for the period, never the amount to remit', () => {
  const emp = (status: Employee['status'], salary: number): Employee => ({ id: status + salary, name: 'E', role: 'r', department: 'd', email: 'e@x.co', employmentType: 'full-time', status, salary, location: 'x', startedAt: 'Jan 2024', performance: 80 });
  const f = figuresFor(find('Canada', 'Ontario', 'ca-t4'), { start: '2026-01-01', end: '2026-12-31', key: '2026-12-31' }, {
    invoices: [], bills: [], taxProfiles: PROFILES, employees: [emp('active', 60_000), emp('offboarded', 90_000), emp('on-leave', 12_000)],
  });
  assert.equal(line(f, /Employees on the payroll list/), 2);
  assert.equal(line(f, /Gross pay for 12 months/), 72_000);
  assert.match(f!.notes.join(' '), /does not calculate/);
  assert.equal(figuresFor(find('United States', 'Texas', 'us-est-corp'), period, { invoices: [], bills: [], employees: [], taxProfiles: [] }), null, 'instalments have no worksheet');
});

// ── the list a company sees ───────────────────────────────────────────────────────────────────────────────────────────

import { planFilings, summarize, effectiveDue } from './borga/filing-plan';
import { normalizeFilings, recordKey } from './borga/filing-catalog';

const plan = (country: string, state: string, over: Partial<Parameters<typeof planFilings>[0]> = {}) =>
  planFilings({
    jurisdiction: jurisdictionOf(country, state), profile: profile(), ctx: { employees: false, registered: true }, fye: DEC,
    today: '2026-10-01', trackedFrom: '2026-10-01', records: [], ...over,
  });

test('a company that just joined sees what is coming, not a year of overdue returns', () => {
  const rows = plan('Canada', 'Ontario');
  assert.equal(summarize(rows).overdue, 0);
  assert.ok(rows.some((r) => r.ob.id === 'ca-gsthst' && r.due === '2026-10-31'), 'the GST/HST return for July–September is due 31 October');
  assert.ok(!rows.some((r) => r.ob.id === 'ca-t2' && r.due === '2026-06-30'), 'the T2 that was due before they joined is not tracked');
  assert.ok(rows.some((r) => r.ob.id === 'ca-t2' && r.due === '2027-06-30'), 'but next year\'s is');
});

test('moving the start date back brings earlier filings in as overdue until they are marked filed', () => {
  const rows = plan('Canada', 'Ontario', { trackedFrom: '2026-01-01' });
  const t2 = rows.find((r) => r.ob.id === 'ca-t2' && r.due === '2026-06-30')!;
  assert.equal(t2.state, 'overdue');
  const key = recordKey('ca-t2', t2.filing.key);
  const marked = plan('Canada', 'Ontario', { trackedFrom: '2026-01-01', records: [{ key, status: 'filed', filedOn: '2026-06-20', reference: 'ABC123' }] });
  assert.equal(marked.find((r) => r.ob.id === 'ca-t2' && r.due === '2026-06-30')!.state, 'filed');
  assert.ok(summarize(marked).overdue < summarize(rows).overdue);
});

test('a monthly return shows its next due date and anything within the horizon, not every month of the year', () => {
  const rows = plan('Canada', 'Ontario', { profile: profile({ salesTaxFrequency: 'monthly' }) }).filter((r) => r.ob.id === 'ca-gsthst');
  assert.ok(rows.length >= 2 && rows.length <= 7, `got ${rows.length}`);
  assert.equal(rows[0].due, '2026-10-31');
});

test('a user date overrides the rule, and a record survives that its date is outside the tracked window', () => {
  assert.equal(effectiveDue('2026-04-30', { key: 'k', status: 'filed', dueOverride: '2026-06-01' }), '2026-06-01');
  assert.equal(effectiveDue('2026-04-30', { key: 'k', status: 'filed', dueOverride: 'nonsense' }), '2026-04-30');
  assert.equal(effectiveDue(null, undefined), null);
  const rows = plan('United States', 'Ohio', { trackedFrom: '2026-10-01', today: '2026-12-20' });
  const generic = rows.find((r) => r.ob.id === 'us-state-income');
  assert.ok(generic, 'a state return with no known date appears once its year is nearly over');
  assert.equal(generic.state, 'needs-date');
});

test('saved filings are normalised: a damaged value becomes a usable empty state', () => {
  assert.deepEqual(normalizeFilings(undefined).records, []);
  assert.deepEqual(normalizeFilings('junk').profile.custom, []);
  assert.equal(normalizeFilings({ profile: { entityType: 'wizard', salesTaxFrequency: 'weekly', trackedFrom: 'Feb 28' }, records: [{ key: 'a', status: 'filed' }, { key: 'b', status: 'maybe' }, null] }).profile.entityType, 'corporation');
  const n = normalizeFilings({ profile: { entityType: 's-corp', salesTaxFrequency: 'monthly', trackedFrom: '2026-02-01', confirmed: true, hasEmployees: true, custom: [{ id: 'x' }] }, records: [{ key: 'a', status: 'filed' }, { key: 'b', status: 'maybe' }, null] });
  assert.equal(n.profile.entityType, 's-corp');
  assert.equal(n.profile.salesTaxFrequency, 'monthly');
  assert.equal(n.profile.trackedFrom, '2026-02-01');
  assert.equal(n.profile.hasEmployees, true);
  assert.equal(n.profile.custom.length, 0, 'an incomplete custom filing is dropped');
  assert.deepEqual(n.records.map((r) => r.key), ['a']);
});

test('a filing with no computable date is not listed for a period that ended before tracking began', () => {
  const rows = plan('Ghana', 'Greater Accra', { today: '2026-10-01', trackedFrom: '2026-10-01' });
  assert.ok(!rows.some((r) => r.ob.id === 'gh-permit'), 'last year\'s permit renewal is not a task for a company that joined in October');
  const later = plan('Ghana', 'Greater Accra', { today: '2026-12-10', trackedFrom: '2026-10-01' });
  assert.ok(later.some((r) => r.ob.id === 'gh-permit' && r.state === 'needs-date'), 'this year\'s shows up as the year end approaches');
});

// ── reminders, stages and the filing pack ─────────────────────────────────────────────────────────────────────────────

import { dueReminders, MAX_REMINDERS_PER_SWEEP } from './borga/filing-plan';

const on = (today: string, over: Partial<Parameters<typeof planFilings>[0]> = {}) => plan('Canada', 'Ontario', { today, trackedFrom: '2026-01-01', ...over });
const gst = (rows: ReturnType<typeof on>) => rows.filter((r) => r.ob.id === 'ca-gsthst');

test('a reminder is raised once per step: 30, 14, 7 and 1 days out, then weekly once overdue', () => {
  // the Jul–Sep GST/HST return is due 2026-10-31
  const at = (today: string, sent: string[] = []) => dueReminders(gst(on(today)), new Set(sent)).filter((r) => r.id.startsWith('ca-gsthst|2026-09-30'));
  const r30 = at('2026-10-01');
  assert.equal(r30.length, 1);
  assert.equal(r30[0].id, 'ca-gsthst|2026-09-30@30');
  assert.equal(r30[0].severity, 'info');
  assert.equal(at('2026-10-01', [r30[0].id]).length, 0, 'not raised twice');
  assert.equal(at('2026-10-20')[0].id, 'ca-gsthst|2026-09-30@14');
  assert.equal(at('2026-10-27')[0].id, 'ca-gsthst|2026-09-30@7', 'only the current step, not 30 and 14 as well');
  assert.equal(at('2026-10-27')[0].severity, 'noteworthy');
  assert.equal(at('2026-10-31')[0].title, 'Due today: GST/HST return');
  const late = at('2026-11-05');
  assert.equal(late[0].id, 'ca-gsthst|2026-09-30@overdue-0');
  assert.equal(late[0].severity, 'urgent');
  assert.match(late[0].body, /5 days ago/);
  assert.equal(at('2026-11-12')[0].id, 'ca-gsthst|2026-09-30@overdue-1', 'and again a week later');
});

test('nothing is raised for a filing that is filed, not required, or has no date, and a stage is mentioned', () => {
  const rows = on('2026-10-27');
  const row = gst(rows).find((r) => r.filing.key === '2026-09-30')!;
  const key = recordKey('ca-gsthst', row.filing.key);
  assert.equal(dueReminders(gst(on('2026-10-27', { records: [{ key, status: 'filed' }] })), new Set()).filter((r) => r.id.startsWith('ca-gsthst|2026-09-30')).length, 0);
  assert.equal(dueReminders(gst(on('2026-10-27', { records: [{ key, status: 'not-required' }] })), new Set()).filter((r) => r.id.startsWith('ca-gsthst|2026-09-30')).length, 0);
  const staged = dueReminders(gst(on('2026-10-27', { records: [{ key, status: 'review', preparer: 'Sam' }] })), new Set()).find((r) => r.id.startsWith('ca-gsthst|2026-09-30'));
  assert.match(staged!.body, /waiting for review/);
  const ohio = plan('United States', 'Ohio', { today: '2026-12-20', trackedFrom: '2026-10-01' });
  assert.equal(dueReminders(ohio.filter((r) => r.state === 'needs-date'), new Set()).length, 0);
});

test('a stage keeps the filing open: it still counts as overdue and keeps its due date', () => {
  const base = on('2026-11-05');
  const row = gst(base).find((r) => r.filing.key === '2026-09-30')!;
  const key = recordKey('ca-gsthst', row.filing.key);
  const staged = gst(on('2026-11-05', { records: [{ key, status: 'preparing' }] })).find((r) => r.filing.key === '2026-09-30')!;
  assert.equal(staged.state, 'overdue');
  assert.equal(staged.record?.status, 'preparing');
  assert.equal(normalizeFilings({ records: [{ key: 'a', status: 'review' }, { key: 'b', status: 'preparing' }, { key: 'c', status: 'nope' }] }).records.length, 2);
});

test('a catch-up never raises more than the cap, most urgent first', () => {
  const rows = plan('Ghana', 'Greater Accra', { today: '2026-12-01', trackedFrom: '2026-01-01', profile: profile({ salesTaxFrequency: 'monthly' }), ctx: { employees: true, registered: true } });
  const out = dueReminders(rows, new Set());
  assert.ok(out.length <= MAX_REMINDERS_PER_SWEEP);
  assert.equal(out[0].severity, 'urgent', 'overdue filings come first');
});

// ── Denmark ───────────────────────────────────────────────────────────────────────────────────────────────────────────

import { taxRegionFor, TAX_PRESETS } from './borga/data';
import { hasOwnTemplate, templateFor, fillTemplate } from './borga/filing-templates';
import { buildFilingSheets, toCsv, toExcelSheets, csvSafe, exportFileName } from './borga/filing-export';

test('Denmark: VAT by the period Skattestyrelsen assigns, corporate tax 6 months after year end, acontoskat in March and November', () => {
  assert.equal(filingCountryOf('Denmark'), 'DK');
  assert.equal(filingCountryOf('Danmark'), 'DK');
  assert.equal(taxRegionFor('Denmark'), 'DK');
  assert.equal(TAX_PRESETS.DK.profiles[0].rate, 25);
  const moms = find('Denmark', '', 'dk-moms');
  assert.equal(dues(moms, profile({ salesTaxFrequency: 'monthly' }), DEC, '2026-01-31', '2026-01-31')[0].due, '2026-02-25');
  const q = dues(moms, profile({ salesTaxFrequency: 'quarterly' }), DEC, '2026-03-31', '2026-12-31');
  assert.deepEqual(q.map((d) => d.due), ['2026-06-01', '2026-09-01', '2026-12-01', '2027-03-01']);
  const h = dues(moms, profile({ salesTaxFrequency: 'semiannual' }), DEC, '2026-06-30', '2026-12-31');
  assert.deepEqual(h.map((d) => [d.period.start, d.period.end, d.due]), [['2026-01-01', '2026-06-30', '2026-09-01'], ['2026-07-01', '2026-12-31', '2027-03-01']]);
  assert.equal(h[0].label, 'Jan–Jun 2026');
  assert.equal(dues(find('Denmark', '', 'dk-corp-tax'), profile(), DEC, '2025-12-31', '2025-12-31')[0].due, '2026-06-30');
  assert.deepEqual(dues(find('Denmark', '', 'dk-acontoskat'), profile(), DEC, '2026-12-31', '2026-12-31').map((d) => d.due), ['2026-03-20', '2026-11-20']);
  assert.equal(dues(find('Denmark', '', 'dk-payroll'), profile(), DEC, '2026-01-31', '2026-01-31')[0].due, '2026-02-10');
  assert.equal(dues(find('Denmark', '', 'dk-annual-report'), profile(), DEC, '2025-12-31', '2025-12-31')[0].due, '2026-05-31');
  assert.equal(dues(find('Denmark', '', 'dk-sole'), profile(), DEC, '2025-12-31', '2025-12-31')[0].due, '2026-07-01');
  const j = jurisdictionOf('Denmark', 'Capital Region');
  assert.equal(j.regionLevel, null);
  assert.equal(levelLabel('DK', 'federal'), 'National');
  assert.equal(normalizeFilings({ profile: { salesTaxFrequency: 'semiannual' } }).profile.salesTaxFrequency, 'semiannual');
});

// ── form templates ────────────────────────────────────────────────────────────────────────────────────────────────────

const ALL_PLACES: Array<[string, string]> = [
  ...['Alberta', 'British Columbia', 'Manitoba', 'Ontario', 'Quebec', 'Saskatchewan', 'Nova Scotia'].map((p): [string, string] => ['Canada', p]),
  ...['California', 'Texas', 'Ohio'].map((s): [string, string] => ['United States', s]),
  ['Ghana', 'Greater Accra'], ['Denmark', ''],
];
const VALUE_KEYS: Record<string, RegExp> = {
  salesTax: /^(sales|taxCharged|purchases|taxPaid|netTax|(taxCharged|taxPaid)\.[a-z]+)$/,
  income: /^(revenue|expenses|profit)$/,
  payroll: /^(employees|grossPay)$/,
  none: /^$/,
};

test('every built-in filing in Canada, the United States, Denmark and Ghana has its own form template', () => {
  let n = 0;
  for (const [country, state] of ALL_PLACES) {
    for (const ob of builtInObligations(jurisdictionOf(country, state))) {
      n++;
      assert.ok(hasOwnTemplate(ob.id) || ob.figures === 'none', `${country}/${state}: ${ob.id} (${ob.name}) has no template`);
    }
  }
  assert.ok(n >= 50, `checked ${n} filings`);
});

test('a template line only takes a figure its kind of return actually produces', () => {
  for (const [country, state] of ALL_PLACES) {
    for (const ob of builtInObligations(jurisdictionOf(country, state))) {
      for (const r of templateFor(ob).rows) {
        if (r.section || !r.value) continue;
        assert.match(r.value, VALUE_KEYS[ob.figures], `${ob.id}: line "${r.label}" uses ${r.value}, but this is a ${ob.figures} return`);
      }
    }
  }
});

test('the GST34 template has the form line numbers in order and the right amounts on them', () => {
  const ob = find('Canada', 'Ontario', 'ca-gsthst');
  const f = figuresFor(ob, period, { invoices: [inv({ amount: 113, taxProfileIds: ['hst'] })], bills: [bill({ amount: 56.5, taxProfileIds: ['hst'] })], employees: [], taxProfiles: PROFILES });
  const rows = fillTemplate(templateFor(ob), f).filter((r) => !r.section);
  assert.deepEqual(rows.map((r) => r.ref), ['101', '103', '104', '105', '106', '107', '108', '109', '110', '111', '112', '113A']);
  const at = (ref: string) => rows.find((r) => r.ref === ref)!.amount;
  assert.equal(at('101'), 100);
  assert.equal(at('103'), 13);
  assert.equal(at('105'), 13);
  assert.equal(at('106'), 6.5);
  assert.equal(at('109'), 6.5);
  assert.equal(at('113A'), 6.5);
  assert.equal(at('104'), null, 'adjustments are for the preparer, never invented');
  assert.equal(at('110'), null);
});

test('the Danish VAT template has Salgsmoms, Købsmoms and the four Rubrik boxes', () => {
  const ob = find('Denmark', '', 'dk-moms');
  const f = figuresFor(ob, period, { invoices: [inv({ amount: 125, taxProfileIds: ['dk'] })], bills: [bill({ amount: 62.5, taxProfileIds: ['dk'] })], employees: [], taxProfiles: [{ id: 'dk', name: 'Moms', rate: 25, category: 'vat' }] });
  const rows = fillTemplate(templateFor(ob), f);
  const label = (re: RegExp) => rows.find((r) => re.test(r.label))!;
  assert.equal(label(/^Salgsmoms/).amount, 25);
  assert.equal(label(/^Købsmoms/).amount, 12.5);
  assert.equal(label(/^Moms i alt/).amount, 12.5);
  assert.deepEqual(rows.map((r) => r.ref).filter(Boolean), ['Rubrik A', 'Rubrik B', 'Rubrik C', 'Rubrik D']);
});

test('the US and Ghana templates carry their form lines, and a tax category with nothing in it is a zero', () => {
  const us = templateFor(find('United States', 'Texas', 'us-1120')).rows.map((r) => r.ref).filter(Boolean);
  assert.deepEqual(us, ['Line 1a', 'Line 2', 'Line 11', 'Line 27', 'Line 28', 'Line 30', 'Line 31']);
  assert.deepEqual(templateFor(find('United States', 'Texas', 'us-941')).rows.map((r) => r.ref).filter(Boolean), ['Line 1', 'Line 2', 'Line 3', 'Line 5a', 'Line 5c', 'Line 10', 'Line 13', 'Line 14']);
  const gh = find('Ghana', 'Greater Accra', 'gh-vat');
  const f = figuresFor(gh, period, { invoices: [inv({ amount: 115, taxProfileIds: ['v'] })], bills: [], employees: [], taxProfiles: [{ id: 'v', name: 'VAT', rate: 15, category: 'vat' }] });
  const rows = fillTemplate(templateFor(gh), f);
  assert.equal(rows.find((r) => /^Output VAT/.test(r.label))!.amount, 15);
  assert.equal(rows.find((r) => /^NHIL/.test(r.label))!.amount, 0, 'no levy was charged: zero, not blank');
});

// ── export: CSV and Excel ─────────────────────────────────────────────────────────────────────────────────────────────

const exportArgs = (over: Record<string, unknown> = {}) => {
  const ob = find('Canada', 'Ontario', 'ca-gsthst');
  const f = figuresFor(ob, period, { invoices: [inv({ amount: 113, taxProfileIds: ['hst'] })], bills: [bill({ amount: 56.5, taxProfileIds: ['hst'] })], employees: [], taxProfiles: PROFILES });
  return {
    company: { name: 'Maple', legalName: 'Maple Inc.', taxNumber: '123456789RT0001', country: 'Canada', state: 'Ontario', city: 'Toronto' },
    jurisdiction: { country: 'CA' as const, regionName: 'Ontario' }, ob, period, label: 'Jan–Mar 2026', due: '2026-04-30', figures: f,
    record: { key: 'k', status: 'review' as const, preparer: 'Sam', reviewer: 'Lee' }, currency: 'CAD', generatedOn: '2026-04-01', ...over,
  };
};

test('the export is the form: header, lines, worksheet, checklist and sign-off, in three sheets', () => {
  const sheets = buildFilingSheets(exportArgs());
  assert.deepEqual(sheets.map((s) => s.name), ['Filing', 'Worksheet', 'Checklist']);
  const text = JSON.stringify(sheets[0].rows);
  for (const needle of ['GST/HST return for registrants (GST34)', 'Maple Inc.', '123456789RT0001', '2026-04-30', 'Prepared by', 'Sam', 'Lee', '113A', 'Sign-off', 'not tax advice']) assert.ok(text.includes(needle), needle);
  assert.ok(buildFilingSheets(exportArgs({ figures: null, ob: find('United States', 'Texas', 'us-est-corp') })).every((s) => s.name !== 'Worksheet'), 'no worksheet when there are no figures');
});

test('CSV: byte order mark, CRLF, amounts at the currency decimals, quotes doubled, formulas defused', () => {
  const csv = toCsv(buildFilingSheets(exportArgs()), 'CAD');
  assert.ok(csv.startsWith('﻿'));
  assert.ok(csv.includes('\r\n') && !/[^\r]\n/.test(csv));
  assert.match(csv, /"101","Sales and other revenue",100\.00,/);
  assert.match(csv, /"113A",.*,6\.50,/);
  assert.match(toCsv(buildFilingSheets(exportArgs()), 'JPY'), /"101","Sales and other revenue",100,/, 'yen has no decimals');
  assert.match(toCsv(buildFilingSheets(exportArgs()), 'KWD'), /"101","Sales and other revenue",100\.000,/, 'dinar has three');
  assert.equal(csvSafe('=HYPERLINK("http://x")'), "'=HYPERLINK(\"http://x\")");
  assert.equal(csvSafe('+1'), "'+1");
  assert.equal(csvSafe('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(csvSafe('Maple'), 'Maple');
  const evil = toCsv(buildFilingSheets(exportArgs({ company: { name: 'x', legalName: '=cmd|"/c calc"!A1', country: 'Canada' } })), 'CAD');
  assert.ok(evil.includes('"\'=cmd|""/c calc""!A1"'), 'a company name cannot run as a formula in the CSV');
  assert.equal(exportFileName('Maple Inc.!', 'ca-gsthst', '2026-03-31', 'csv'), 'maple-inc-ca-gsthst-2026-03-31.csv');
  assert.equal(exportFileName('', 'us-est-corp', '2026-12-31#2', 'xlsx'), 'company-us-est-corp-2026-12-31-2.xlsx');
});

test('Excel: a real .xlsx file with three sheets, numeric amounts and the form lines', async () => {
  const { default: writeExcelFile } = await import('write-excel-file/node');
  const { unzipSync, strFromU8 } = await import('fflate');
  const buf: Buffer = await writeExcelFile(toExcelSheets(buildFilingSheets(exportArgs()), 'CAD') as never).toBuffer();
  assert.equal(buf.subarray(0, 2).toString(), 'PK', 'a zip container, which is what .xlsx is');
  const files = unzipSync(new Uint8Array(buf));
  const names = Object.keys(files);
  assert.ok(names.includes('[Content_Types].xml') && names.includes('xl/workbook.xml'));
  assert.equal(names.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).length, 3);
  const workbook = strFromU8(files['xl/workbook.xml']);
  for (const n of ['Filing', 'Worksheet', 'Checklist']) assert.ok(workbook.includes(`name="${n}"`), n);
  const all = names.filter((n) => n.endsWith('.xml')).map((n) => strFromU8(files[n])).join('\n');
  assert.ok(all.includes('GST/HST return for registrants (GST34)'));
  assert.ok(all.includes('Sales and other revenue'));
  assert.match(all, /<v>100<\/v>/, 'the sales figure is a number Excel can add up');
  assert.match(all, /#,##0\.00/, 'amounts are shown with the currency decimals');
});
