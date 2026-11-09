import assert from 'node:assert/strict';
import test from 'node:test';
import { tenantAllowed, tenantOf, tenantsInKey } from './borga/tenant-policy';

test('tenant keys name their owner and workspace', () => {
  assert.deepEqual(tenantOf('u::u1::ws::acme::invoices'), { userId: 'u1', ws: 'acme' });
  assert.deepEqual(tenantOf('c::u1::acme::smtp'), { userId: 'u1', ws: 'acme' });
  assert.deepEqual(tenantOf('t::u1::acme::billing'), { userId: 'u1', ws: 'acme' });
});

test('deployment-wide keys have no tenant owner', () => {
  for (const key of ['api_secrets', 'borga_ping', 'u::u1::workspaces', 't::admin::config', 'invite::abc', 't::billing::startedOn']) {
    assert.equal(tenantOf(key), null, key);
  }
});

test('malformed and oversized keys are not treated as tenant rows', () => {
  assert.equal(tenantOf('u::u1::ws::'), null);
  assert.equal(tenantOf('u::u1::ws::acme::invoices'.padEnd(600, 'x')), null);
  assert.deepEqual(tenantOf('u::u1::ws::acme::invoices'), { userId: 'u1', ws: 'acme' });
});

test('only a workspace in the registry is allowed', () => {
  assert.equal(tenantAllowed(['acme', 'other'], 'acme'), true);
  assert.equal(tenantAllowed(['acme'], 'other'), false);
});

test('legacy accounts (no registry or an empty one) are allowed', () => {
  assert.equal(tenantAllowed(null, 'acme'), true);
  assert.equal(tenantAllowed([], 'acme'), true);
});

test('one key names one workspace', () => {
  assert.deepEqual(tenantsInKey('u::u1::ws::acme::settings'), ['acme']);
  assert.deepEqual(tenantsInKey('api_secrets'), []);
});
