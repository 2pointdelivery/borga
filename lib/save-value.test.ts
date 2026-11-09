import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareEntityForSave } from './borga/save-value';
import { WORKSPACE_PLANS, isWorkspacePlan } from './borga/client-privileges';
import type { WorkspacePlan } from './borga/data';

// Written against the type as well as the value: if WorkspacePlan gains a
// member, this map stops typechecking, mirroring the whitelist in
// client-privileges.ts. Both are checked here through the real save transform.
const REAL_PLANS: Record<WorkspacePlan, true> = {
  trial: true,
  growth: true,
  scale: true,
  enterprise: true,
};

test('every real workspace plan survives the save path', () => {
  const plans = Object.keys(REAL_PLANS) as WorkspacePlan[];
  assert.deepEqual(Object.keys(WORKSPACE_PLANS).sort(), [...plans].sort(), 'whitelist and model agree');
  const saved = prepareEntityForSave(
    'workspaces',
    plans.map((plan, i) => ({ id: `ws-${i}`, name: `Company ${i}`, plan })),
  ) as Array<Record<string, unknown>>;
  assert.deepEqual(saved.map((w) => w.plan), plans);
  for (const plan of plans) assert.equal(isWorkspacePlan(plan), true, `${plan} is a real plan`);
});

test('a workspace save still strips client privilege fields, nested ones included', () => {
  const saved = prepareEntityForSave('workspaces', [
    {
      id: 'ws-a',
      name: 'A',
      plan: 'trial',
      role: 'admin',
      isPro: true,
      isOperator: true,
      comped: true,
      billing: { paid: true },
      entitlements: ['everything'],
      extra: { role: 'owner', keep: 1 },
    },
  ]) as Array<Record<string, unknown>>;
  const w = saved[0];
  for (const field of ['role', 'isPro', 'isOperator', 'comped', 'billing', 'entitlements']) {
    assert.ok(!(field in w), `${field} is stripped`);
  }
  assert.equal(w.plan, 'trial', 'the real plan is not a privilege field');
  assert.equal((w.extra as Record<string, unknown>).role, undefined);
  assert.equal((w.extra as Record<string, unknown>).keep, 1);
});

test('an unknown plan value is dropped deliberately, not stored', () => {
  const saved = prepareEntityForSave('workspaces', [{ id: 'ws-b', plan: 'ultimate' }]) as Array<Record<string, unknown>>;
  assert.ok(!('plan' in saved[0]));
  assert.equal(saved[0].id, 'ws-b');
});

test('settings saves never keep a claimed plan or pro flag', () => {
  assert.deepEqual(
    prepareEntityForSave('settings', { plan: 'trial', isPro: true, heartbeatPaused: true }),
    { heartbeatPaused: true },
  );
});

test('money entities are recalculated by the same save path', () => {
  const saved = prepareEntityForSave(
    'invoices',
    [{ id: 'inv-1', lines: [{ qty: 2, unitPrice: 50 }], taxRate: 10, amount: 1 }],
    'USD',
  ) as Array<Record<string, unknown>>;
  assert.equal(saved[0].amount, 110, 'lines + tax decide the amount, not the client total');
});
