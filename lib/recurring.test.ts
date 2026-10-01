import test from 'node:test';
import assert from 'node:assert/strict';
import { TERMS_DAYS, addDays, buildBill, buildInvoice, nextBillNumber, recurringBillRef, type RecurringBill, dueRuns, fillTokens, isFinished, nextInvoiceNumber, nextRunIso, occurrenceDate, recurringRef, type RecurringInvoice } from './borga/recurring';

const base: RecurringInvoice = {
  id: 'r1', name: 'Hosting', status: 'active', client: 'Acme', lines: [{ id: 'l', description: 'Hosting for {period}', qty: 2, unitPrice: 50 }],
  taxProfileIds: ['gst'], paymentMethod: 'bank-transfer', frequency: 'monthly', every: 1, startDateIso: '2026-01-31', dueDays: 14, generatedCount: 0, createdAt: '2026-01-01T00:00:00Z',
};

test('monthly schedules anchor on the start day and clamp short months without drifting', () => {
  const d = (n: number) => occurrenceDate('2026-01-31', 'monthly', 1, n);
  assert.deepEqual([0, 1, 2, 3].map(d), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  assert.equal(occurrenceDate('2028-01-31', 'monthly', 1, 1), '2028-02-29'); // leap year
  assert.equal(occurrenceDate('2026-11-15', 'monthly', 1, 3), '2027-02-15'); // crosses the year
});

test('weekly, every-N, quarterly and yearly cadences', () => {
  assert.equal(occurrenceDate('2026-10-01', 'weekly', 2, 3), '2026-11-12');
  assert.equal(occurrenceDate('2026-10-01', 'monthly', 2, 2), '2027-02-01');
  assert.equal(occurrenceDate('2026-01-15', 'quarterly', 1, 3), '2026-10-15');
  assert.equal(occurrenceDate('2028-02-29', 'yearly', 1, 1), '2029-02-28');
  assert.equal(occurrenceDate('2028-02-29', 'yearly', 1, 4), '2032-02-29');
});

test('dueRuns catches up missed periods in order and never repeats generated ones', () => {
  const runs = dueRuns(base, '2026-04-02');
  assert.deepEqual(runs.map((r) => r.dateIso), ['2026-01-31', '2026-02-28', '2026-03-31']);
  assert.deepEqual(runs.map((r) => r.index), [0, 1, 2]);
  const after = dueRuns({ ...base, generatedCount: 3 }, '2026-04-02');
  assert.deepEqual(after, []);
  assert.equal(dueRuns(base, '2026-01-30').length, 0); // not yet due
});

test('paused and ended schedules generate nothing; catch-up is capped', () => {
  assert.equal(dueRuns({ ...base, status: 'paused' }, '2030-01-01').length, 0);
  assert.equal(dueRuns({ ...base, status: 'ended' }, '2030-01-01').length, 0);
  assert.equal(dueRuns({ ...base, frequency: 'weekly' }, '2030-01-01').length, 12);
  assert.equal(dueRuns({ ...base, frequency: 'weekly' }, '2030-01-01', 3).length, 3);
});

test('end conditions: max occurrences and end date', () => {
  assert.equal(dueRuns({ ...base, maxOccurrences: 2 }, '2026-12-31').length, 2);
  assert.equal(isFinished({ ...base, maxOccurrences: 2, generatedCount: 2 }), true);
  const ending = { ...base, endDateIso: '2026-03-15' };
  assert.deepEqual(dueRuns(ending, '2026-12-31').map((r) => r.dateIso), ['2026-01-31', '2026-02-28']);
  assert.equal(nextRunIso({ ...ending, generatedCount: 2 }), null);
  assert.equal(nextRunIso(base), '2026-01-31');
});

test('invoice numbers continue from the highest existing #N', () => {
  assert.equal(nextInvoiceNumber([]), '#2200');
  assert.equal(nextInvoiceNumber([{ number: '#2200' }, { number: '#2231' }, { number: 'INV-9' }]), '#2232');
  assert.equal(nextInvoiceNumber([{ number: '2300' }]), '#2301');
});

test('buildInvoice makes a tagged, priced draft with tax, due date and period tokens', () => {
  const inv = buildInvoice(base, { index: 1, dateIso: '2026-02-28' }, '#2200', [{ id: 'gst', name: 'GST', rate: 5 }, { id: 'pst', name: 'PST', rate: 7 }], 'abc');
  assert.equal(inv.status, 'draft');
  assert.equal(inv.amount, 105); // 2 x 50 = 100 + 5% GST (PST not selected)
  assert.equal(inv.taxRate, 5);
  assert.equal(inv.issued, '2026-02-28');
  assert.equal(inv.due, '2026-03-14');
  assert.equal(inv.externalRef, recurringRef('r1', 1));
  assert.equal(inv.lines![0].description, 'Hosting for February 2026');
  assert.equal(inv.lines![0].id, 'il-abc-0');
});

test('helpers', () => {
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(fillTokens('{period} / {date}', '2026-10-05'), 'October 2026 / 2026-10-05');
});

const bill: RecurringBill = {
  id: 'rb1', name: 'Office rent', status: 'active', vendorId: 'v1', vendorName: 'Landlord Ltd', lines: [{ id: 'l', description: 'Rent for {period}', qty: 1, unitPrice: 2000 }],
  taxProfileIds: ['gst'], paymentMethod: 'bank-transfer', frequency: 'monthly', every: 1, startDateIso: '2026-10-01', dueDays: 15, estimated: false, generatedCount: 0, createdAt: '2026-09-01T00:00:00Z',
};

test('bills share the invoice schedule rules (catch-up, end, pause)', () => {
  assert.deepEqual(dueRuns(bill, '2026-12-15').map((r) => r.dateIso), ['2026-10-01', '2026-11-01', '2026-12-01']);
  assert.equal(dueRuns({ ...bill, status: 'paused' }, '2030-01-01').length, 0);
  assert.equal(dueRuns({ ...bill, maxOccurrences: 1 }, '2030-01-01').length, 1);
  assert.equal(nextRunIso({ ...bill, generatedCount: 3 }), '2027-01-01');
});

test('buildBill records an UNPAID bill with terms, tax, tokens and a recurrence tag', () => {
  const b = buildBill(bill, { index: 2, dateIso: '2026-12-01' }, 'BILL-1001', [{ id: 'gst', name: 'GST', rate: 5 }], 'x');
  assert.equal(b.status, 'unpaid');
  assert.equal(b.paidAt, undefined);
  assert.equal(b.amount, 2100);
  assert.equal(b.received, '2026-12-01');
  assert.equal(b.due, '2026-12-16');
  assert.equal(b.externalRef, recurringBillRef('rb1', 2));
  assert.equal(b.lines![0].description, 'Rent for December 2026');
  assert.equal(b.notes, undefined);
});

test('estimated bills carry a confirm-before-paying note; numbers continue from the highest BILL-n', () => {
  const b = buildBill({ ...bill, estimated: true, notes: 'Meter {period}' }, { index: 0, dateIso: '2026-10-01' }, 'BILL-1002', [], 'y');
  assert.match(b.notes!, /Meter October 2026/);
  assert.match(b.notes!, /ESTIMATE/);
  assert.equal(nextBillNumber([]), 'BILL-1001');
  assert.equal(nextBillNumber([{ number: 'BILL-1004' }, { number: 'BILL-12' }, { number: 'X-9' }]), 'BILL-1005');
  assert.deepEqual(TERMS_DAYS, { 'due-on-receipt': 0, net15: 15, net30: 30, net60: 60 });
});
