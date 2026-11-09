import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptQuote, quoteDiscount, quoteTotal } from './borga/quotes';
import { receivePO, billForPO } from './borga/procurement';
import { releasePayrollRun, payrollCountryFor, defaultPayrollMapping, validateMapping, monthlyGross, aggregatePayrollCalcs, suggestedPayrollAccounts, summarizePayrollHistory, nextUnpaidMonth } from './borga/payroll-engine';
import { postPayrollSplit } from './borga/postings';
import { takeSnapshot, edgarComps, peerMedian, monthSnapshotted } from './borga/valuation-history';
import { applyOwnershipPct, allocatedPct, sharesForPct, roundMath, updateShareClass, deleteShareClass, classUsage, EMPTY_CAP_TABLE, type CapTableState } from './borga/cap-table';

test('quote accept writes invoice+project, blocks double-convert + expired', () => {
  const q: any = {
    id: 'q1', number: 'Q-1', customerId: 'c1', customerName: 'Acme',
    lines: [{ label: 'Build', qty: 2, unitPrice: 100, taxRate: 10 }],
    status: 'sent', version: 1, issued: '2026-01-01', validUntil: '2099-01-01',
  };
  const { quote, invoice, project } = acceptQuote(q, { invoiceNumber: 'INV-1', projectId: 'p1', todayIso: '2026-06-01' });
  assert.equal(quote.status, 'converted');
  assert.equal(invoice.amount, 220);
  assert.equal(invoice.externalRef, 'quote:q1:v1');
  assert.equal(project.budgetAmount, 200);
  assert.throws(() => acceptQuote({ ...q, status: 'draft' }, { invoiceNumber: 'INV-2', projectId: 'p2', todayIso: '2026-06-01' }));
  assert.throws(() => acceptQuote({ ...q, validUntil: '2020-01-01' }, { invoiceNumber: 'INV-2', projectId: 'p2', todayIso: '2026-06-01' }));
});

test('PO receive moves stock at actual cost, caps at ordered qty', () => {
  const po: any = { id: 'po1', number: 'PO-1', vendorId: 'v', vendorName: 'V', lines: [{ itemId: 'i1', label: 'Widget', qty: 10, unitCost: 5 }], status: 'ordered', orderedAt: '2026-01-01' };
  const { po: p1, movements } = receivePO(po, { received: [{ index: 0, qty: 6 }], warehouseId: 'w1' });
  assert.equal(p1.status, 'partial');
  assert.equal(movements[0].qty, 6);
  assert.equal(movements[0].unitCost, 5);
  const { po: p2 } = receivePO(p1, { received: [{ index: 0, qty: 99 }], warehouseId: 'w1' });
  assert.equal(p2.status, 'received');
  assert.equal(p2.lines[0].receivedQty, 10);
});

test('payroll release is once-per-month + snapshot carries FMV', () => {
  const rows = [{ id: 'e1', name: 'Ada', gross: 5000 }];
  const { run, totals } = releasePayrollRun({ monthKey: '2026-10', periodLabel: 'October 2026', country: 'US', rows, existingMonthKeys: [] });
  assert.equal(run.status, 'released');
  assert.ok(totals.gross === 5000 && totals.net < 5000);
  assert.throws(() => releasePayrollRun({ monthKey: '2026-10', periodLabel: 'x', country: 'US', rows, existingMonthKeys: ['2026-10'] }));
  const s = takeSnapshot({ fmv: 2.7, revenue: 1.9, multiple: 1.4, ev: 2.8, impliedShare: 0.27, momentum: 70, floor: 1, ceiling: 6, growthPct: 40, netDebt: 0.1, sharesM: 10, growthSource: 'trailing-actuals' }, 'manual');
  assert.equal(s.fmv, 2.7);
  assert.equal(s.source, 'manual');
});

test('payroll GL presets resolve on stock CoA; split journals balance; clearing nets zero', () => {
  const coa = [
    { id: 'gl-5000', type: 'expense', name: 'Payroll Expense', code: '5000' },
    { id: 'gl-2300', type: 'liability', name: 'Payroll Liabilities', code: '2300' },
  ];
  const { mapping, missing } = defaultPayrollMapping(coa, 'GH');
  assert.equal(mapping.salaryExpense, 'gl-5000');
  assert.equal(mapping.clearing, 'gl-2300');
  assert.equal(validateMapping(mapping, coa.map((a) => a.id)).length, 0);
  assert.ok(missing.length > 0); // dedicated PAYE/SSNIT accounts suggested, not silently assumed
  assert.equal(monthlyGross(60000), 5000);
  const agg = aggregatePayrollCalcs([{ gross: 2000 }], 'GH');
  const taxTotal = agg.employee.reduce((t, l) => t + l.amount, 0);
  const net = 2000 - taxTotal;
  const split = postPayrollSplit({
    runId: 'pr-2026-10', gross: 2000, employeeLines: agg.employee, net,
    employerLines: agg.employer,
    accounts: {
      salaryExpense: 'gl-5000', clearing: 'gl-2300', netPayable: 'gl-2300', employerExpense: 'gl-5000',
      taxPayables: Object.fromEntries(agg.employee.map((l) => [l.label, 'gl-2300'])),
      employerPayables: Object.fromEntries(agg.employer.map((l) => [l.label, 'gl-2300'])),
    },
  });
  const bal = (lines: Array<{ debit: number; credit: number }>) =>
    Math.abs(lines.reduce((t, l) => t + l.debit - l.credit, 0)) < 0.005;
  assert.ok(bal(split.gross.lines) && bal(split.tax.lines) && bal(split.net.lines) && bal(split.employer.lines));
  const clearingNet = [split.gross, split.tax, split.net]
    .flatMap((j) => j.lines)
    .filter((l) => (l as { accountId: string }).accountId === 'gl-2300')
    .reduce((t, l) => t + l.debit - l.credit, 0);
  void clearingNet;
  // clearing: credited gross, debited tax + net → zero
  const cIn = [split.tax, split.net].flatMap((j) => j.lines).filter((l) => (l as { accountId: string }).accountId === 'gl-2300').reduce((t, l) => t + l.debit, 0);
  const cOut = split.gross.lines.filter((l) => (l as { accountId: string }).accountId === 'gl-2300').reduce((t, l) => t + l.credit, 0);
  assert.ok(Math.abs(cIn - cOut) < 0.01);
  assert.ok(suggestedPayrollAccounts('GH', ['2300']).some((a) => a.name.includes('PAYE')));
  assert.throws(() => postPayrollSplit({
    runId: 'x', gross: 100, employeeLines: [{ label: 'Mystery', amount: 10 }], net: 90, employerLines: [],
    accounts: { salaryExpense: 'gl-5000', clearing: 'gl-2300', netPayable: 'gl-2300', employerExpense: 'gl-5000', taxPayables: {}, employerPayables: {} },
  }));
});
test('payroll country follows onboarding country names', () => {
  assert.equal(payrollCountryFor('United States'), 'US');
  assert.equal(payrollCountryFor('USA'), 'US');
  assert.equal(payrollCountryFor('canada'), 'CA');
  assert.equal(payrollCountryFor('Ghana'), 'GH');
  assert.equal(payrollCountryFor('Danmark'), 'DK');
  assert.equal(payrollCountryFor('Denmark'), 'DK');
  assert.equal(payrollCountryFor('France'), null);
  assert.equal(payrollCountryFor(null), null);
});

test('cap table % ownership writes shares, tracks allocation', () => {
  assert.equal(sharesForPct(60), 6_000_000);
  let s: CapTableState = { ...EMPTY_CAP_TABLE, stakeholders: [{ id: 'a', name: 'A', kind: 'founder' as const }, { id: 'b', name: 'B', kind: 'founder' as const }] };
  s = applyOwnershipPct(s, 'a', 60);
  s = applyOwnershipPct(s, 'b', 40);
  assert.equal(Math.round(allocatedPct(s)), 100);
  s = applyOwnershipPct(s, 'b', 50);
  assert.ok(allocatedPct(s) > 100);
  assert.throws(() => applyOwnershipPct(s, 'ghost', 10));
});

test('comps work fully offline on manual peers (fetch never called)', async () => {
  const throwingFetch = (() => { throw new Error('no network'); }) as unknown as typeof fetch;
  const out = await edgarComps(throwingFetch, [], {}, { manualPeers: [{ ticker: 'ACME', evRev: 2 }, { ticker: 'BETA', evRev: 4 }] });
  assert.equal(out.medianEvRev, 4);
  assert.equal(out.sampleSize, 2);
  assert.ok(out.source.includes('native'));
});

test('PO bill drafts only after full receipt, once', () => {
  const po: any = { id: 'po9', number: 'PO-9', vendorId: 'v', vendorName: 'V', lines: [{ label: 'W', qty: 4, unitCost: 10, receivedQty: 4 }], status: 'received', orderedAt: '2026-01-01' };
  const { bill } = billForPO(po, { billNumber: 'BILL-1', dueIso: '2026-12-31' });
  const bl = bill.lines ?? [];
  assert.equal(bl[0].qty * bl[0].unitPrice, 40);
  assert.equal(bill.externalRef, 'po:po9');
  assert.equal(bill.amount, 40);
  assert.throws(() => billForPO({ ...po, lines: [{ label: 'W', qty: 4, unitCost: 10, receivedQty: 1 }] }, { billNumber: 'B', dueIso: '2026-12-31' }));
  assert.throws(() => billForPO({ ...po, billId: 'b-1' }, { billNumber: 'B', dueIso: '2026-12-31' }));
});

test('peer median + monthly snapshot guard', () => {  assert.equal(peerMedian([{ id: '1', ticker: 'A', name: 'A', evRev: 1, updatedAt: '' }, { id: '2', ticker: 'B', name: 'B', evRev: 3, updatedAt: '' }, { id: '3', ticker: 'C', name: 'C', evRev: 2, updatedAt: '' }]), 2);
  assert.equal(peerMedian([]), null);
  assert.equal(monthSnapshotted([{ at: '2026-10-05T00:00:00.000Z', fmv: 1, revenue: 1, multiple: 1, ev: 1, source: 'cron' }], '2026-10-09T00:00:00.000Z'), true);
  assert.equal(monthSnapshotted([], '2026-10-09T00:00:00.000Z'), false);
});

test('round math: post = pre + early money + new cash, dilution visible', () => {  const s: CapTableState = {
    ...EMPTY_CAP_TABLE,
    stakeholders: [{ id: 'a', name: 'A', kind: 'founder' as const }],
    holdings: [{ stakeholderId: 'a', classId: 'common', shares: 10_000_000 }],
    safes: [{ id: 's1', stakeholderId: 'a', amount: 200_000, cap: 10_000_000, kind: 'safe' as const }],
  };
  const m = roundMath(s, { preMoney: 2_680_000, pricePerShare: 0.268, newMoney: 500_000, preMoneyShares: 10_000_000 });
  assert.equal(m.postMoney, 2_680_000 + 200_000 + 500_000);
  assert.ok(m.convertingShares > 0 && m.newShares > 0);
  assert.ok(m.fdPost > m.fdPre);
  const row = m.rows.find((r) => r.stakeholderId === 'a');
  assert.ok(row && row.postPct < row.prePct); // dilution shows
  assert.ok(row.convertedShares > 0);
});

test('quote discount comes off before tax', () => {  const base: any = { lines: [{ label: 'X', qty: 2, unitPrice: 100, taxRate: 10 }], status: 'draft' };
  assert.equal(quoteDiscount({ ...base }), 0);
  const d = { ...base, discountPct: 10 };
  assert.equal(quoteDiscount(d), 20);
  assert.equal(quoteTotal(d), 198); // 200 − 20 discount + 18 tax on the discounted base
});

test('payroll history summary + next unpaid month', () => {  const runs = [
    { monthKey: '2026-09', total: 4000, status: 'released', lines: [{ amount: 2000 }, { amount: 2000 }], detail: [{ gross: 2000, employeeTax: 200, employerCost: 2200, net: 1800 }, { gross: 2000, employeeTax: 200, employerCost: 2200, net: 1800 }] },
    { monthKey: '2026-10', total: 4000, status: 'released', lines: [{ amount: 2000 }, { amount: 2000 }] },
  ];
  const s = summarizePayrollHistory(runs);
  assert.equal(s.runCount, 2);
  assert.equal(s.ytdGross, 8000);
  assert.equal(s.ytdNet, 3600);
  assert.equal(s.estimated, true); // October predates detail
  assert.equal(s.headcount, 2);
  assert.equal(s.lastMonthKey, '2026-10');
  assert.equal(summarizePayrollHistory(runs, '2026').runCount, 2);
  assert.equal(summarizePayrollHistory(runs, '2025').runCount, 0);
  assert.equal(nextUnpaidMonth([], '2026-10-09T00:00:00.000Z'), '2026-10');
  assert.equal(nextUnpaidMonth(['2026-08'], '2026-10-09T00:00:00.000Z'), '2026-10'); // catch up
  assert.equal(nextUnpaidMonth(['2026-10'], '2026-10-09T00:00:00.000Z'), '2026-11');
  assert.equal(nextUnpaidMonth(['2026-12'], '2026-10-09T00:00:00.000Z'), '2027-01');
});

test('share types edit and guarded delete', () => {
  let s: CapTableState = {
    ...EMPTY_CAP_TABLE,
    stakeholders: [{ id: 'a', name: 'A', kind: 'founder' as const }],
    holdings: [{ stakeholderId: 'a', classId: 'common', shares: 100 }],
  };
  assert.equal(classUsage(s, 'common'), 1);
  s = updateShareClass(s, 'common', { name: 'Common Shares', seniority: 0, liquidationMultiple: null });
  assert.equal(s.classes[0].name, 'Common Shares');
  assert.throws(() => deleteShareClass(s, 'common')); // holdings point at it
  s = { ...s, classes: [...s.classes, { id: 'pref', name: 'Preferred', seniority: 1 }] };
  s = deleteShareClass(s, 'pref');
  assert.equal(s.classes.length, 1);
  assert.throws(() => deleteShareClass(s, 'common')); // last one + still used
  assert.throws(() => updateShareClass(s, 'ghost', { name: 'X' }));
});
