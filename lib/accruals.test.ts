import test from 'node:test';
import assert from 'node:assert/strict';
import { accrueInvoice, accrueBill, reverseAccrual, subledgerTieOut, resolveAccrualAccounts } from './borga/accruals';

const COA = [
  { id: 'ar', type: 'asset', name: 'Accounts Receivable' },
  { id: 'rev', type: 'revenue', name: 'Sales Revenue' },
  { id: 'tax', type: 'liability', name: 'Sales Tax Payable' },
  { id: 'ap', type: 'liability', name: 'Accounts Payable' },
  { id: 'exp', type: 'expense', name: 'Office' },
];

test('invoice accrual splits net + tax and balances', () => {
  const j: any = accrueInvoice({ id: 'i1', number: 'INV-1', client: 'Acme', amount: 110, issued: '2026-01-01', taxRate: 10 }, COA);
  assert.ok(j);
  assert.equal(j.externalRef, 'invoice:i1:accrual');
  const dr = j.lines.reduce((t: number, l: any) => t + l.debit, 0);
  const cr = j.lines.reduce((t: number, l: any) => t + l.credit, 0);
  assert.equal(dr, cr);
  assert.equal(dr, 110);
  assert.equal(j.lines.find((l: any) => l.accountId === 'rev').credit, 100);
  assert.equal(j.lines.find((l: any) => l.accountId === 'tax').credit, 10);
});

test('bill accrual expenses to the chosen account', () => {
  const j: any = accrueBill({ id: 'b1', number: 'B-1', vendorName: 'V', amount: 50, accountId: 'exp', received: '2026-01-01' }, COA);
  assert.ok(j);
  assert.equal(j.lines[0].accountId, 'exp');
  assert.equal(j.lines[1].accountId, 'ap');
});

test('missing accounts refuse instead of guessing', () => {
  assert.equal(accrueInvoice({ id: 'x', number: 'N', client: 'C', amount: 10, issued: '2026-01-01' }, []), null);
  assert.equal(resolveAccrualAccounts([]), null);
});

test('reversal flips every line', () => {
  const j: any = accrueInvoice({ id: 'i1', number: 'INV-1', client: 'Acme', amount: 110, issued: '2026-01-01', taxRate: 10 }, COA);
  const r: any = reverseAccrual('invoice', 'invoice:i1:accrual-rev', 'INV-1', 110, j.lines);
  assert.equal(r.lines.length, j.lines.length);
  for (let i = 0; i < j.lines.length; i++) {
    assert.equal(r.lines[i].accountId, j.lines[i].accountId);
    assert.equal(r.lines[i].debit, j.lines[i].credit);
    assert.equal(r.lines[i].credit, j.lines[i].debit);
  }
  const net = r.lines.reduce((t: number, l: any) => t + l.debit - l.credit, 0);
  assert.equal(net, 0); // a flipped balanced journal still balances
});

test('tie-out agrees when postings are complete, flags gaps', () => {
  const acc: any = accrueInvoice({ id: 'i1', number: 'INV-1', client: 'A', amount: 100, issued: '2026-01-01' }, COA);
  const invoices = [{ status: 'sent', amount: 100 }];
  const journals = [{ status: 'posted', externalRef: 'invoice:i1:accrual', lines: acc.lines }];
  const t = subledgerTieOut({ invoices, bills: [], journals, arAccountId: 'ar', apAccountId: 'ap' });
  assert.equal(t.ar.diff, 0);
  assert.equal(t.ar.expected, 100);
  // a settlement without accrual leaves a gap the tie-out must flag
  // (books show −100 owed against a 100 open invoice: a 200 gap)
  const t2 = subledgerTieOut({
    invoices, bills: [],
    journals: [{ status: 'posted', lines: [{ accountId: 'ar', debit: 0, credit: 100 }] }],
    arAccountId: 'ar', apAccountId: 'ap',
  });
  assert.equal(t2.ar.diff, -200);
});
