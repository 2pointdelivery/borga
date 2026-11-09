import assert from 'node:assert/strict';
import test from 'node:test';
import { stripClientPrivileges } from './borga/client-privileges';

test('a crafted workspace save cannot add operator, billing or isPro fields', () => {
  const out = stripClientPrivileges('workspaces', [
    { id: 'acme', name: 'Acme', plan: 'starter', role: 'owner', isPro: true, isOperator: true, comped: true, billing: { paid: true } },
  ]) as Array<Record<string, unknown>>;
  // 'starter' is not a WorkspacePlan, so it is dropped deliberately along with
  // the privilege fields; every real plan is covered by lib/save-value.test.ts.
  assert.deepEqual(out[0], { id: 'acme', name: 'Acme' });
});

test('an invented plan is not a plan', () => {
  const out = stripClientPrivileges('workspaces', [{ id: 'acme', plan: 'unlimited-free-forever' }]) as Array<Record<string, unknown>>;
  assert.equal('plan' in out[0], false);
});

test('settings cannot smuggle plan or entitlement fields', () => {
  const out = stripClientPrivileges('settings', { crmUrl: '', plan: 'enterprise', entitlements: ['all'], role: 'admin' }) as Record<string, unknown>;
  assert.deepEqual(out, { crmUrl: '' });
});

test('nested privilege fields are dropped too', () => {
  const out = stripClientPrivileges('settings', { notifications: { tasks: true, isPro: true } }) as Record<string, unknown>;
  assert.deepEqual(out, { notifications: { tasks: true } });
});

test('other entities are passed through untouched', () => {
  const value = [{ id: 'x', role: 'manager' }];
  assert.equal(stripClientPrivileges('employees', value), value);
});
