import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOrgTree, departmentTable, depthCounts } from './borga/org-chart';
import { formatStartedAt, toMonthInput, type Employee } from './borga/data';

const emp = (p: Partial<Employee> & { id: string; name: string }): Employee => ({
  role: 'Member', department: 'General', email: '', employmentType: 'full-time',
  status: 'active', salary: 0, location: 'Remote', startedAt: 'Jan 2024', performance: 75,
  ...p,
});

test('roots are people with no (or unknown) manager; reports nest under them', () => {
  const tree = buildOrgTree([
    emp({ id: 'a', name: 'Ada' }),
    emp({ id: 'b', name: 'Bo', manager: 'Ada' }),
    emp({ id: 'c', name: 'Cy', manager: 'Bo' }),
    emp({ id: 'd', name: 'Di', manager: 'Nobody here' }),
  ]);
  assert.deepEqual(tree.map((n) => n.employee.id), ['a', 'd']);
  assert.deepEqual(tree[0].reports.map((n) => n.employee.id), ['b']);
  assert.deepEqual(tree[0].reports[0].reports.map((n) => n.employee.id), ['c']);
  assert.deepEqual(depthCounts(tree), [2, 1, 1]);
});

test('self-reports and cycles are cut instead of looping', () => {
  const tree = buildOrgTree([
    emp({ id: 'a', name: 'Ada', manager: 'Ada' }),
    emp({ id: 'b', name: 'Bo', manager: 'Cy' }),
    emp({ id: 'c', name: 'Cy', manager: 'Bo' }),
  ]);
  assert.deepEqual(tree.map((n) => n.employee.id), ['a', 'b'], 'the cycle breaks at one link');
  assert.deepEqual(tree[1].reports.map((n) => n.employee.id), ['c'], 'nobody disappears');
});

test('manager matching ignores case; offboarded people are out', () => {
  const tree = buildOrgTree([
    emp({ id: 'a', name: 'Ada' }),
    emp({ id: 'b', name: 'Bo', manager: 'ada' }),
    emp({ id: 'c', name: 'Cy', manager: 'Ada', status: 'offboarded' }),
  ]);
  assert.deepEqual(tree[0].reports.map((n) => n.employee.id), ['b']);
  assert.equal(depthCounts(tree).reduce((s, n) => s + n, 0), 2);
});

test('department heads are whoever reports outside the department', () => {
  const rows = departmentTable([
    emp({ id: 'a', name: 'Ada', department: 'Design', role: 'Designer', manager: 'Bo' }),
    emp({ id: 'b', name: 'Bo', department: 'Design', role: 'Design Lead' }),
    emp({ id: 'c', name: 'Cy', department: 'Sales', role: 'Rep', manager: 'Bo' }),
  ]);
  assert.deepEqual(rows.map((r) => r.name), ['Design', 'Sales']);
  assert.equal(rows[0].head?.id, 'b');
  assert.equal(rows[0].members.length, 2);
  assert.equal(rows[1].head?.id, 'c', 'Cy reports outside Sales, so structurally heads it');
});

test('start-date helpers round-trip month inputs without timezone traps', () => {
  assert.equal(formatStartedAt('2026-03'), 'Mar 2026');
  assert.equal(formatStartedAt('Jan 2024'), 'Jan 2024', 'display values pass through');
  assert.equal(toMonthInput('Mar 2026'), '2026-03');
  assert.equal(toMonthInput('2026-03'), '2026-03');
  assert.equal(toMonthInput(''), '');
  assert.equal(toMonthInput('sometime'), '');
});
