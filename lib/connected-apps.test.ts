import test from 'node:test';
import assert from 'node:assert/strict';
import {
  commsChannelForToolkit,
  connectionIdForToolkit,
  normalizeAccount,
  toolkitStatus,
} from './borga/connected-apps';

const ACCOUNTS = [
  { id: 'ca-1', appName: 'gmail', status: 'ACTIVE', entityId: 'default' },
  { id: 'ca-2', appName: 'linkedin', status: 'ACTIVE', entityId: 'ws-1' },
  { id: 'ca-3', appName: 'linkedin', status: 'EXPIRED', entityId: 'default' },
];

test('toolkit status reads ACTIVE accounts, preferring the workspace entity', () => {
  assert.deepEqual(toolkitStatus(ACCOUNTS, 'gmail'), { connected: true, accountId: 'ca-1', status: 'ACTIVE' });
  assert.deepEqual(toolkitStatus(ACCOUNTS, 'linkedin', 'ws-1'), { connected: true, accountId: 'ca-2', status: 'ACTIVE' });
  assert.deepEqual(toolkitStatus(ACCOUNTS, 'twitter'), { connected: false });
});

test('raw Composio items normalize to toolkit slugs', () => {
  assert.deepEqual(
    normalizeAccount({ id: 'x', toolkit: { slug: 'LinkedIn' }, status: 'ACTIVE', user_id: 'u1' }),
    { id: 'x', appName: 'linkedin', status: 'ACTIVE', entityId: 'u1' },
  );
  assert.deepEqual(normalizeAccount({ status: 'off' }), { id: undefined, appName: '', status: 'off', entityId: '' });
});

test('connection-card ids match the cards the Tools tab renders (no ghost duplicates)', () => {
  assert.equal(connectionIdForToolkit('LinkedIn'), 'cn-linkedin');
  assert.equal(connectionIdForToolkit('gmail'), 'cn-gmail');
  assert.equal(connectionIdForToolkit('acme-crm'), 'cn-tk-acme-crm');
  assert.equal(commsChannelForToolkit('gmail'), 'email');
  assert.equal(commsChannelForToolkit('twilio'), 'sms');
  assert.equal(commsChannelForToolkit('whatsapp'), 'whatsapp');
  assert.equal(commsChannelForToolkit('telegram'), 'telegram');
  assert.equal(commsChannelForToolkit('linkedin'), null);
});
