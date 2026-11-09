import test from 'node:test';
import assert from 'node:assert/strict';
import { currentHolder, decide, delegate, escalate, escalationDue } from './borga/approval-chain';
import type { Approval } from './borga/data';

const approval = (over: Partial<Approval> = {}): Approval => ({
  id: 'ap-1', title: 'Pay landlord', description: 'Rent', category: 'spend', amount: 500,
  status: 'pending', submittedBy: 'Ledger', createdAt: '2026-10-01T00:00:00.000Z', ...over,
});

test('holder falls back from delegatee to assignee to nobody', () => {
  assert.equal(currentHolder(approval()), null);
  assert.equal(currentHolder(approval({ assignee: 'Ama' })), 'Ama');
  assert.equal(currentHolder(approval({ assignee: 'Ama', delegatedTo: 'Kwame' })), 'Kwame');
});

test('delegation moves the holder and records the hand', () => {
  const r = delegate(approval({ assignee: 'Ama' }), 'Ama', 'Kwame', 'Out sick');
  assert.ok(r.approval);
  assert.equal(r.approval.delegatedTo, 'Kwame');
  assert.equal(r.approval.status, 'pending');
  assert.deepEqual(r.approval.history?.map((h) => h.action), ['delegated']);
  assert.equal(delegate(approval({ assignee: 'Ama' }), 'Yaw', 'Kwame').error, 'Ama holds this approval, not Yaw.');
  assert.equal(delegate(approval({ assignee: 'Ama' }), 'Ama', 'Ama').error, 'It is already theirs.');
  assert.equal(delegate(approval({ assignee: 'Ama' }), 'Ama', '  ').error, 'Name who it goes to.');
  assert.equal(delegate(approval({ status: 'approved', assignee: 'Ama' }), 'Ama', 'Kwame').error, 'Only pending approvals can be delegated.');
});

test('only the holder decides; the decision is recorded', () => {
  const r = decide(approval({ assignee: 'Ama' }), 'Ama', 'approved');
  assert.ok(r.approval);
  assert.equal(r.approval.status, 'approved');
  assert.equal(decide(approval({ assignee: 'Ama' }), 'Yaw', 'approved').error, 'Waiting on Ama, not Yaw.');
  assert.equal(decide(approval({ status: 'rejected' }), 'Ama', 'approved').error, 'Already rejected.');
  // unassigned: anyone named decides (single-user dashboard honesty)
  assert.ok(decide(approval(), 'Owner', 'rejected').approval);
  // owner override decides anyway and says so in history
  const o = decide(approval({ assignee: 'Ama' }), 'Owner', 'approved', undefined, { ownerOverride: true });
  assert.ok(o.approval);
  assert.equal(o.approval.status, 'approved');
  assert.ok(o.approval.history?.[0].by.includes('owner'));
});

test('escalation fires once, past due, to the named escalation', () => {
  const past = '2026-10-01T00:00:00.000Z';
  const now = Date.parse('2026-10-20T00:00:00.000Z');
  assert.equal(escalationDue(approval({ dueAt: past, escalateTo: 'Manager' }), now), true);
  assert.equal(escalationDue(approval({ dueAt: '2026-12-01T00:00:00.000Z', escalateTo: 'Manager' }), now), false);
  assert.equal(escalationDue(approval({ dueAt: past }), now), false, 'nowhere to escalate');
  assert.equal(escalationDue(approval({ dueAt: past, escalateTo: 'Manager', escalatedAt: past }), now), false, 'once only');
  assert.equal(escalationDue(approval({ dueAt: past, escalateTo: 'Manager', status: 'approved' }), now), false);
  const e = escalate(approval({ assignee: 'Ama', dueAt: past, escalateTo: 'Manager' }), new Date(now));
  assert.ok(e);
  assert.equal(e.delegatedTo, 'Manager');
  assert.ok(e.escalatedAt);
  assert.deepEqual(e.history?.map((h) => h.action), ['escalated']);
  assert.equal(escalate(approval({ dueAt: '2026-12-01T00:00:00.000Z', escalateTo: 'Manager' }), new Date(now)), null);
});
