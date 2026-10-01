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
