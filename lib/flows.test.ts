import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cronDensity,
  evalCondition,
  matchConditions,
  newFlowId,
  nextCronRun,
  parseCronField,
  renderGoal,
  validateFlow,
  type Flow,
} from './borga/flows-core';

test('condition operators compare case-insensitively, numerically, and by presence', () => {
  const ctx = { priority: 'High', subject: 'Invoice total looks wrong', amount: 2500, idleDays: 9, company: '' };
  assert.equal(evalCondition({ field: 'priority', op: 'equals', value: 'high' }, ctx), true);
  assert.equal(evalCondition({ field: 'priority', op: 'equals', value: 'low' }, ctx), false);
  assert.equal(evalCondition({ field: 'priority', op: 'not_equals', value: 'low' }, ctx), true);
  assert.equal(evalCondition({ field: 'subject', op: 'contains', value: 'invoice total' }, ctx), true);
  assert.equal(evalCondition({ field: 'subject', op: 'contains', value: '' }, ctx), false);
  assert.equal(evalCondition({ field: 'amount', op: 'greater_than', value: '1000' }, ctx), true);
  assert.equal(evalCondition({ field: 'amount', op: 'less_than', value: '1000' }, ctx), false);
  assert.equal(evalCondition({ field: 'subject', op: 'greater_than', value: '1000' }, ctx), false);
  assert.equal(evalCondition({ field: 'idleDays', op: 'greater_than', value: 'many' }, ctx), false);
  assert.equal(evalCondition({ field: 'company', op: 'exists', value: '' }, ctx), false);
  assert.equal(evalCondition({ field: 'subject', op: 'exists', value: '' }, ctx), true);
  assert.equal(evalCondition({ field: 'missing', op: 'equals', value: 'x' }, ctx), false);
  assert.equal(evalCondition({ field: 'missing', op: 'not_equals', value: 'x' }, ctx), false);
  assert.equal(matchConditions([
    { field: 'priority', op: 'equals', value: 'high' },
    { field: 'amount', op: 'greater_than', value: '1000' },
  ], ctx), true);
  assert.equal(matchConditions([{ field: 'priority', op: 'equals', value: 'low' }], ctx), false);
  assert.equal(matchConditions([], ctx), true);
});

test('goals interpolate {{fields}}; unknown fields vanish', () => {
  assert.equal(renderGoal('Chase {{number}} for {{amount}} from {{client}}{{nope}}!', { number: 'INV-1', amount: 50, client: 'Acme' }), 'Chase INV-1 for 50 from Acme!');
  assert.equal(renderGoal('No placeholders', {}), 'No placeholders');
  assert.equal(renderGoal('{{ spaced }}', { spaced: 'yes' }), 'yes');
});

test('cron fields parse steps, ranges, lists and names', () => {
  assert.deepEqual([...parseCronField('*', 0, 59)!].slice(0, 3), [0, 1, 2]);
  assert.deepEqual([...parseCronField('*/15', 0, 59)!], [0, 15, 30, 45]);
  assert.deepEqual([...parseCronField('9-17', 0, 23)!], [9, 10, 11, 12, 13, 14, 15, 16, 17]);
  assert.deepEqual([...parseCronField('1,15', 1, 31)!], [1, 15]);
  assert.deepEqual([...parseCronField('mon-fri', 0, 7, { mon: 1, fri: 5 })!], [1, 2, 3, 4, 5]);
  assert.equal(parseCronField('60', 0, 59), null);
  assert.equal(parseCronField('*/0', 0, 59), null);
  assert.equal(parseCronField('5-2', 0, 59), null);
  assert.equal(parseCronField('bogus', 0, 59), null);
  assert.equal(parseCronField('', 0, 59), null);
});

test('cron expressions find the next run with standard day semantics', () => {
  const mon0800 = Date.parse('2026-01-05T00:00:00.000Z'); // a Monday
  assert.equal(nextCronRun('0 8 * * mon', mon0800), '2026-01-05T08:00:00.000Z');
  assert.equal(nextCronRun('0 8 * * mon', Date.parse('2026-01-05T09:00:00.000Z')), '2026-01-12T08:00:00.000Z');
  assert.equal(nextCronRun('*/30 9 * * *', Date.parse('2026-01-05T09:10:00.000Z')), '2026-01-05T09:30:00.000Z');
  assert.equal(nextCronRun('0 0 1 * *', Date.parse('2026-01-15T00:00:00.000Z')), '2026-02-01T00:00:00.000Z');
  assert.equal(nextCronRun('0 0 * * 7', mon0800), '2026-01-11T00:00:00.000Z'); // 7 means Sunday
  assert.equal(nextCronRun('not a cron', mon0800), null);
  assert.equal(nextCronRun('0 8 * * * *', mon0800), null); // six fields rejected
});

test('cron density reports the minutes between fires', () => {
  assert.equal(cronDensity('* * * * *'), 1);
  assert.equal(cronDensity('0 8 * * *'), 1440);
  assert.equal(cronDensity('0 8 * * mon'), 10080);
  assert.equal(cronDensity('bogus'), null);
});

test('validation refuses what cannot run', () => {
  const base: Flow = {
    id: newFlowId(), name: 'Chase big invoices', enabled: true,
    trigger: { kind: 'event', event: 'invoice.overdue' },
    conditions: [{ field: 'amount', op: 'greater_than', value: '1000' }],
    actions: [{ kind: 'notify', severity: 'noteworthy', title: 'Big invoice overdue: {{number}}', body: '{{client}} owes {{amount}}' }],
    createdAt: '', updatedAt: '', lastRunAt: null, runCount: 0, day: '', runsToday: 0, nextRun: null,
  };
  assert.deepEqual(validateFlow(base), []);
  assert.ok(validateFlow({ ...base, name: '  ' }).includes('Name the workflow.'));
  assert.ok(validateFlow({ ...base, trigger: { kind: 'cron', expr: 'bogus' } }).some((e) => e.includes('cron')));
  assert.ok(validateFlow({ ...base, conditions: [{ field: 'bogus', op: 'equals', value: 'x' }] }).some((e) => e.includes('Unknown field')));
  assert.ok(validateFlow({ ...base, conditions: [{ field: 'amount', op: 'greater_than', value: 'lots' }] }).some((e) => e.includes('not a number')));
  assert.ok(validateFlow({ ...base, actions: [] }).some((e) => e.includes('at least one action')));
  assert.ok(validateFlow({ ...base, actions: [{ kind: 'run_agent', agentId: '', goal: '', }] }).length >= 2);
});
