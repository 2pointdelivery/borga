import test from 'node:test';
import assert from 'node:assert/strict';
import { REPORT_DATASETS, datasetOf, runCustomReport, validateCustomReport, type CustomReport } from './borga/custom-report';

const invoices = [
  { id: 'i1', number: 'INV-1', client: 'Acme', amount: 1000, status: 'sent', issued: '2026-10-01', due: '2026-10-15' },
  { id: 'i2', number: 'INV-2', client: 'Acme', amount: 250, status: 'paid', issued: '2026-10-02', due: '2026-10-16' },
  { id: 'i3', number: 'INV-3', client: 'Kumasi', amount: 5000, status: 'sent', issued: '2026-10-03', due: '2026-10-20' },
  { id: 'i4', number: 'INV-4', client: 'Globex', amount: 700, status: 'overdue', issued: '2026-09-28', due: '2026-10-01' },
];

const report = (over: Partial<CustomReport> = {}): CustomReport => ({
  id: 'cr-1', name: 'Open invoices', dataset: 'invoices', columns: ['number', 'client', 'amount', 'status'],
  filters: [], createdAt: '', updatedAt: '', ...over,
});

test('every dataset has fields and a persistence entity', () => {
  for (const d of REPORT_DATASETS) {
    assert.ok(d.fields.length >= 4, d.id);
    assert.ok(d.entity, d.id);
  }
  assert.equal(datasetOf('invoices')?.label, 'Invoices');
  assert.equal(datasetOf('nope'), null);
});

test('default columns are every field; explicit columns keep their order', () => {
  const all = runCustomReport(report({ columns: [] }), invoices);
  assert.deepEqual(all.columns.map((c) => c.key), ['number', 'client', 'amount', 'status', 'issued', 'due']);
  const picked = runCustomReport(report({ columns: ['status', 'amount'] }), invoices);
  assert.deepEqual(picked.columns.map((c) => c.key), ['status', 'amount']);
  assert.deepEqual(picked.rows[0], ['sent', 1000]);
});

test('text filters: equals, not_equals, contains are case-insensitive', () => {
  assert.equal(runCustomReport(report({ filters: [{ field: 'client', op: 'equals', value: 'acme' }] }), invoices).rowCount, 2);
  assert.equal(runCustomReport(report({ filters: [{ field: 'client', op: 'not_equals', value: 'ACME' }] }), invoices).rowCount, 2);
  assert.equal(runCustomReport(report({ filters: [{ field: 'client', op: 'contains', value: 'um' }] }), invoices).rowCount, 1);
  assert.equal(runCustomReport(report({ filters: [{ field: 'client', op: 'contains', value: '' }] }), invoices).rowCount, 4, 'empty contains matches all');
});

test('money filters compare numbers; junk values never filter', () => {
  assert.equal(runCustomReport(report({ filters: [{ field: 'amount', op: 'greater_than', value: '800' }] }), invoices).rowCount, 2);
  assert.equal(runCustomReport(report({ filters: [{ field: 'amount', op: 'less_than', value: '1000' }] }), invoices).rowCount, 2);
  assert.equal(runCustomReport(report({ filters: [{ field: 'amount', op: 'greater_than', value: 'lots' }] }), invoices).rowCount, 4);
});

test('filters AND together; unknown fields and datasets never crash', () => {
  const r = runCustomReport(report({ filters: [
    { field: 'status', op: 'equals', value: 'sent' },
    { field: 'amount', op: 'greater_than', value: '2000' },
  ] }), invoices);
  assert.deepEqual(r.rows.map((x) => x[0]), ['INV-3']);
  assert.equal(runCustomReport(report({ filters: [{ field: 'nope', op: 'equals', value: 'x' }] }), invoices).rowCount, 4);
  assert.deepEqual(runCustomReport(report({ dataset: 'nope' as never }), invoices), { columns: [], rows: [], rowCount: 0 });
});

test('grouping aggregates count and the money column, biggest first', () => {
  const r = runCustomReport(report({ groupBy: 'client' }), invoices);
  assert.ok(r.groups);
  assert.deepEqual(r.groups, [
    { value: 'Acme', count: 2, sum: 1250 },
    { value: 'Kumasi', count: 1, sum: 5000 },
    { value: 'Globex', count: 1, sum: 700 },
  ]);
  assert.equal(r.totals?.count, 4);
  assert.equal(r.totals?.sum, 6950);
  assert.equal(r.rowCount, 3, 'grouped rows, not records');
});

test('validation names everything that cannot run', () => {
  assert.deepEqual(validateCustomReport(report()), []);
  assert.ok(validateCustomReport({ name: '  ', dataset: 'invoices' }).length > 0);
  assert.ok(validateCustomReport({ name: 'x', dataset: 'nope' as never }).length > 0);
  assert.ok(validateCustomReport({ name: 'x', dataset: 'invoices', columns: ['bogus'] }).length > 0);
  assert.ok(validateCustomReport({ name: 'x', dataset: 'invoices', filters: [{ field: 'amount', op: 'greater_than', value: '' }] }).length > 0);
  assert.ok(validateCustomReport({ name: 'x', dataset: 'invoices', groupBy: 'bogus' }).length > 0);
});
