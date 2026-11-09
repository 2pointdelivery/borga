import test from 'node:test';
import assert from 'node:assert/strict';
import { assignOwner, openLoad, ruleMatches, ruleSummary } from './borga/lead-assign';
import type { LeadAssignmentRule } from './borga/data';

const rule = (over: Partial<LeadAssignmentRule> = {}): LeadAssignmentRule => ({
  id: 'r-1', name: 'Big web leads', stage: 'any', sourceContains: '', assignee: '', ...over,
});

const lead = { stage: 'new' as const, source: 'Web — Form', value: 5000 };

test('rules match on stage, source substring, and minimum value', () => {
  assert.equal(ruleMatches(rule(), lead), true);
  assert.equal(ruleMatches(rule({ stage: 'proposal' }), lead), false);
  assert.equal(ruleMatches(rule({ sourceContains: 'referral' }), lead), false);
  assert.equal(ruleMatches(rule({ sourceContains: 'WEB' }), lead), true);
  assert.equal(ruleMatches(rule({ minValue: 10000 }), lead), false);
  assert.equal(ruleMatches(rule({ minValue: 1000 }), lead), true);
});

test('first matching rule wins; a named owner beats nothing', () => {
  const rules = [rule({ name: 'catch-all', assignee: 'Ama' }), rule({ assignee: 'Kwame' })];
  assert.equal(assignOwner(rules, lead, []), 'Ama');
  assert.equal(assignOwner([], lead, []), null);
  assert.equal(assignOwner([rule({ assignee: '  ' })], lead, []), null);
});

test('round-robin pools go to the least-loaded member, stable on ties', () => {
  const rules = [rule({ roundRobin: ['Ama', 'Kwame', 'Yaw'] })];
  const open = [
    { ownerId: 'Ama', stage: 'new' },
    { ownerId: 'Ama', stage: 'qualified' },
    { ownerId: 'Kwame', stage: 'new' },
  ];
  assert.equal(assignOwner(rules, lead, open), 'Yaw');
  assert.equal(assignOwner(rules, lead, []), 'Ama');
  // won/lost do not count as load
  const withClosed = [...open, { ownerId: 'Yaw', stage: 'won' }, { ownerId: 'Yaw', stage: 'lost' }];
  assert.equal(assignOwner(rules, lead, withClosed), 'Yaw');
  assert.deepEqual([...openLoad(open).entries()].sort(), [['Ama', 2], ['Kwame', 1]]);
});

test('summaries read like the rule', () => {
  assert.equal(ruleSummary(rule({ name: 'x', assignee: 'Ama' })), 'every lead → Ama');
  assert.equal(
    ruleSummary(rule({ stage: 'proposal', sourceContains: 'web', minValue: 1000, roundRobin: ['A', 'B'] })),
    'stage is proposal + source contains "web" + value ≥ 1,000 → round-robin A, B',
  );
});
