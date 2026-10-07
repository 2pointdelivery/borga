import test from 'node:test';
import assert from 'node:assert/strict';
import { findBillDuplicates, findFinanceRefDuplicates, findInvoiceDuplicates, payrollReleasedForMonth } from './borga/duplicates';

test('same invoice number is an exact duplicate, voided and self are ignored', () => {
  const all = [
    { id: 'a', number: 'INV-1', client: 'Acme', amount: 100, issued: '2026-09-01' },
    { id: 'b', number: 'INV-2', client: 'Acme', amount: 100, issued: '2026-09-01', voidedAt: '2026-09-02' },
  ];
  const exact = findInvoiceDuplicates({ id: '', number: 'inv-1', client: 'Acme', amount: 100, issued: '2026-09-01' }, all);
  assert.equal(exact.length, 1);
  assert.equal(exact[0].level, 'exact');
  const self = findInvoiceDuplicates({ id: 'a', number: 'INV-1', client: 'Acme', amount: 100, issued: '2026-09-01' }, all);
  assert.deepEqual(self, [], 'editing the same record is not a duplicate');
});

test('same client and amount within 30 days is likely, outside is fine', () => {
  const all = [{ id: 'a', number: 'INV-1', client: 'Acme', amount: 500, issued: '2026-09-01' }];
  const near = findInvoiceDuplicates({ id: '', number: 'INV-9', client: 'acme', amount: 500, issued: '2026-09-20' }, all);
  assert.equal(near.length, 1);
  assert.equal(near[0].level, 'likely');
  const far = findInvoiceDuplicates({ id: '', number: 'INV-9', client: 'Acme', amount: 500, issued: '2026-11-15' }, all);
  assert.deepEqual(far, []);
  const otherClient = findInvoiceDuplicates({ id: '', number: 'INV-9', client: 'Globex', amount: 500, issued: '2026-09-20' }, all);
  assert.deepEqual(otherClient, []);
});

test('bills match on vendor number, reference, or vendor amount window', () => {
  const all = [
    { id: 'a', vendorId: 'v1', vendorName: 'Paper Co', number: 'B-100', amount: 250, received: '2026-09-05', externalRef: 'PO-7' },
  ];
  const num = findBillDuplicates({ id: '', vendorId: 'v1', vendorName: 'Paper Co', number: 'b-100', amount: 1, received: '2026-10-01' }, all);
  assert.equal(num[0]?.level, 'exact');
  const ref = findBillDuplicates({ id: '', vendorId: 'v9', vendorName: 'Other', number: 'B-999', amount: 1, received: '2026-10-01', externalRef: 'po-7' }, all);
  assert.equal(ref[0]?.level, 'exact', 'a shared vendor reference is exact even across vendors');
  const likely = findBillDuplicates({ id: '', vendorId: 'v1', vendorName: 'Paper Co', number: 'B-101', amount: 250, received: '2026-09-20' }, all);
  assert.equal(likely[0]?.level, 'likely');
  const otherVendor = findBillDuplicates({ id: '', vendorId: 'v2', vendorName: 'Ink Co', number: 'B-101', amount: 250, received: '2026-09-20' }, all);
  assert.deepEqual(otherVendor, [], 'same amount at another vendor is not a duplicate');
});

test('a blank reference never matches; matching ignores case', () => {
  const all = [{ id: 'a', externalRef: 'CHQ-1' }];
  assert.deepEqual(findFinanceRefDuplicates('', null, all), []);
  assert.deepEqual(findFinanceRefDuplicates('   ', null, all), []);
  assert.equal(findFinanceRefDuplicates('chq-1', null, all).length, 1);
  assert.deepEqual(findFinanceRefDuplicates('CHQ-1', 'a', all), [], 'self excluded');
});

test('a released payroll month blocks further releases', () => {
  const runs = [
    { monthKey: '2026-09', status: 'released' },
    { monthKey: '2026-10', status: 'draft' },
  ];
  assert.equal(payrollReleasedForMonth(runs, '2026-09'), true);
  assert.equal(payrollReleasedForMonth(runs, '2026-10'), false, 'drafts do not block');
  assert.equal(payrollReleasedForMonth(runs, '2026-11'), false);
  assert.equal(payrollReleasedForMonth([], '2026-09'), false);
});
