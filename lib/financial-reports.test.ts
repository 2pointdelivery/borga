import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProfitAndLoss, periodDeltas } from './borga/financial-reports';
import type { GlAccount, JournalEntry } from './borga/data';

const coa: GlAccount[] = [
  { id: 'a-rev', code: '4000', name: 'Sales', type: 'revenue' },
  { id: 'a-cos', code: '5000', name: 'Cost of sales', type: 'cost' },
  { id: 'a-rent', code: '6100', name: 'Rent', type: 'expense' },
  { id: 'a-cash', code: '1000', name: 'Cash', type: 'asset' },
  { id: 'a-old', code: '4900', name: 'Old revenue', type: 'revenue', archived: true },
];

const j = (id: string, dateIso: string, status: JournalEntry['status'], lines: Array<[string, number, number]>): JournalEntry => ({
  id, date: dateIso, dateIso, memo: 'm', status,
  lines: lines.map(([accountId, debit, credit], i) => ({ id: `l-${i}`, accountId, debit, credit })),
}) as unknown as JournalEntry;

const journals: JournalEntry[] = [
  j('in-1', '2026-10-02', 'posted', [['a-rev', 0, 12000], ['a-cash', 12000, 0]]),
  j('in-2', '2026-10-03', 'posted', [['a-cos', 4000, 0], ['a-rent', 2000, 0], ['a-cash', 0, 6000]]),
  j('in-3', '2026-10-04', 'draft', [['a-rev', 0, 999], ['a-cash', 999, 0]]), // drafts never count
  j('in-4', '2026-10-11', 'posted', [['a-rev', 0, 3000], ['a-cash', 3000, 0]]), // outside the period
  j('in-5', '2026-10-05', 'posted', [['a-old', 0, 777], ['a-cash', 777, 0]]), // archived account never rows
];

test('periodDeltas sums posted entries in range and nothing else', () => {
  const d = periodDeltas(journals, '2026-10-01', '2026-10-07');
  assert.equal(d.get('a-rev'), -12000, 'revenue accumulates as credits (negative delta)');
  assert.equal(d.get('a-cos'), 4000);
  assert.equal(d.get('a-rent'), 2000);
  assert.equal(d.get('a-cash'), 6777, '12000 in − 6000 out + 777 from the archived-account entry');
  assert.ok(!d.has('a-old') || d.get('a-old') === -777, 'archived account still nets but never rows');
  const inverted = periodDeltas(journals, '2026-10-07', '2026-10-01');
  assert.deepEqual([...inverted.entries()], [...d.entries()], 'an inverted range orders itself and matches');
});

test('buildProfitAndLoss turns normal-side balances into a P&L with gross and net', () => {
  const pl = buildProfitAndLoss(coa, journals, '2026-10-01', '2026-10-07');
  assert.deepEqual(pl.revenueRows.map((r) => r.accountId), ['a-rev'], 'archived account dropped, draft ignored');
  assert.deepEqual(pl.costRows.map((r) => r.amount), [4000]);
  assert.deepEqual(pl.expenseRows.map((r) => r.amount), [2000]);
  assert.equal(pl.totalRevenue, 12000);
  assert.equal(pl.grossProfit, 8000);
  assert.equal(pl.netIncome, 6000);
  assert.ok(!pl.revenueRows.some((r) => r.accountId === 'a-old'));
  // rows are biggest-first for readability
  const wide = buildProfitAndLoss(
    [...coa],
    [j('x1', '2026-01-02', 'posted', [['a-rev', 0, 100]]), j('x2', '2026-01-02', 'posted', [['a-rev', 0, 900]])],
    '2026-01-01', '2026-01-31',
  );
  assert.equal(wide.revenueRows[0].amount, 1000);
});

test('an empty period is an honest zero, not NaN', () => {
  const pl = buildProfitAndLoss(coa, journals, '2027-01-01', '2027-01-31');
  assert.deepEqual(pl, {
    revenueRows: [], costRows: [], expenseRows: [],
    totalRevenue: 0, totalCost: 0, totalExpenses: 0, grossProfit: 0, netIncome: 0,
  });
});


import { nextReportRun, normalizeHour, reportPeriod, reportPeriodKey, validateReportSchedule } from './borga/report-schedules-core';

test('normalizeHour clamps junk to the default', () => {
  assert.equal(normalizeHour(17), 17);
  assert.equal(normalizeHour('9'), 9);
  assert.equal(normalizeHour(-3), 8);
  assert.equal(normalizeHour(99), 8);
  assert.equal(normalizeHour('junk', 12), 12);
});

test('reportPeriod covers trailing 7 days weekly, month-to-date monthly, today daily', () => {
  assert.deepEqual(reportPeriod('weekly', '2026-10-15'), { from: '2026-10-09', to: '2026-10-15', label: '2026-10-09 to 2026-10-15' });
  assert.deepEqual(reportPeriod('monthly', '2026-10-15'), { from: '2026-10-01', to: '2026-10-15', label: 'October 2026' });
  assert.deepEqual(reportPeriod('daily', '2026-10-15'), { from: '2026-10-15', to: '2026-10-15', label: '2026-10-15' });
});

test('reportPeriodKey dedupes one email per cadence window', () => {
  assert.equal(reportPeriodKey('monthly', '2026-10-15'), reportPeriodKey('monthly', '2026-10-31'));
  assert.notEqual(reportPeriodKey('weekly', '2026-10-15'), reportPeriodKey('weekly', '2026-10-16'));
  assert.notEqual(reportPeriodKey('daily', '2026-10-15'), reportPeriodKey('daily', '2026-10-16'));
});

test('nextReportRun lands on the first matching hour at or after the target hour', () => {
  // Thu 2026-10-15 09:30 UTC -> weekly (Mon) fires Mon 2026-10-19 at 10:00 (hour=10 passed at 09:30? no: 10>9 so Mon 10:00)
  assert.equal(nextReportRun('weekly', 10, Date.parse('2026-10-15T09:30:00Z')), '2026-10-19T10:00:00.000Z');
  // After the hour already passed on a Monday, the next match is next Monday
  assert.equal(nextReportRun('weekly', 8, Date.parse('2026-10-19T09:00:00Z')), '2026-10-26T08:00:00.000Z');
  // Monthly from mid-month lands on the 1st
  assert.equal(nextReportRun('monthly', 8, Date.parse('2026-10-15T00:00:00Z')), '2026-11-01T08:00:00.000Z');
  // Daily later today when the hour has not passed, tomorrow when it has
  assert.equal(nextReportRun('daily', 20, Date.parse('2026-10-15T09:30:00Z')), '2026-10-15T20:00:00.000Z');
  assert.equal(nextReportRun('daily', 5, Date.parse('2026-10-15T09:30:00Z')), '2026-10-16T05:00:00.000Z');
});

test('validateReportSchedule refuses what cannot run', () => {
  assert.deepEqual(validateReportSchedule({ report: 'pl', name: 'Weekly P&L', cadence: 'weekly', hour: 8 }), []);
  assert.ok(validateReportSchedule({ report: 'bs' as never, name: 'x', cadence: 'daily', hour: 8 }).length > 0);
  assert.ok(validateReportSchedule({ report: 'pl', name: '', cadence: 'weekly', hour: 8 }).length > 0);
  assert.ok(validateReportSchedule({ report: 'pl', name: 'x', cadence: 'hourly' as never, hour: 8 }).length > 0);
  assert.ok(validateReportSchedule({ report: 'pl', name: 'x', cadence: 'daily', hour: 24 }).length > 0);
});

