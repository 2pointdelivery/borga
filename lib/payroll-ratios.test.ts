import test from 'node:test';
import assert from 'node:assert/strict';
import { calcPayroll } from './borga/payroll-engine';
import { computeRatios } from './borga/ratios';
import { quoteTotal, isExpired } from './borga/quotes';
import { threeWayMatch } from './borga/procurement';

test('payroll GH/US math + confirm flag', () => {
  const gh = calcPayroll({ country: 'GH', gross: 2000 });
  assert.ok(gh.employeeTax > 0 && gh.net < 2000 && gh.confirm === true);
  const us = calcPayroll({ country: 'US', gross: 5000 });
  assert.ok(us.employerCost > 5000);
});

test('ratios pack has 14 rows with formulas', () => {
  const coa: any[] = [
    { id: 'c', code: '1010', name: 'Cash bank', type: 'asset' },
    { id: 'r', code: '1100', name: 'Receivables', type: 'asset' },
    { id: 'p', code: '2000', name: 'Payables', type: 'liability' },
    { id: 'e', code: '3000', name: 'Equity', type: 'equity' },
    { id: 'rev', code: '4000', name: 'Revenue', type: 'revenue' },
    { id: 'xp', code: '5000', name: 'Salaries', type: 'expense' },
  ];
  const journals: any[] = [{ status: 'posted', lines: [
    { accountId: 'c', debit: 10000, credit: 0 }, { accountId: 'e', debit: 0, credit: 10000 },
    { accountId: 'r', debit: 4000, credit: 0 }, { accountId: 'rev', debit: 0, credit: 4000 },
    { accountId: 'xp', debit: 1000, credit: 0 }, { accountId: 'c', debit: 0, credit: 1000 },
  ] }];
  const rows = computeRatios(coa, journals);
  assert.equal(rows.length, 14);
  for (const x of rows) assert.ok(x.formula && x.inputs);
});

test('quote totals + expiry + 3-way match', () => {
  const q: any = { lines: [{ qty: 2, unitPrice: 100, taxRate: 10 }], status: 'sent', validUntil: '2020-01-01' };
  assert.equal(quoteTotal(q), 220);
  assert.equal(isExpired(q), true);
  const m = threeWayMatch({ id: 'x', number: 'PO-1', vendorId: 'v', vendorName: 'V', lines: [{ label: 'A', qty: 5, unitCost: 10, receivedQty: 5 }], status: 'received', orderedAt: '2026-01-01' }, 50);
  assert.equal(m.ok, true);
});
