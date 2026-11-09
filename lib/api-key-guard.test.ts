import test from 'node:test';
import assert from 'node:assert/strict';
import { hashApiKey, keyOwnerAllowed, verifyApiKeyWithLookup, type ApiKeyLookup, type ApiKeyRecord } from './borga/api-keys';

/** Minimal stand-in for the record `verifyApiKey` matched. */
const hit = { userId: 'user-1', key: { id: 'key-1' } };

test('a key whose owner still exists is allowed', async () => {
  assert.equal(await keyOwnerAllowed(hit, async () => false), true);
  assert.equal(await keyOwnerAllowed({ userId: 'user-2' }, async (id) => id !== 'user-2'), true);
});

test('a key belonging to a deleted user is refused', async () => {
  assert.equal(await keyOwnerAllowed(hit, async () => true), false);
  const seen: string[] = [];
  assert.equal(
    await keyOwnerAllowed(hit, async (id) => {
      seen.push(id);
      return true;
    }),
    false,
  );
  assert.deepEqual(seen, ['user-1'], 'the check is made against the key owner, not the caller');
});

test('a database error while checking the owner fails open', async () => {
  assert.equal(
    await keyOwnerAllowed(hit, async () => {
      throw new Error('database is down');
    }),
    true,
  );
});

const SECRET = 'borga_test_secret_value';
const NOW = '2026-06-01T00:00:00.000Z';
const record: ApiKeyRecord = {
  id: 'key-1',
  name: 'Test key',
  prefix: 'borga_test…',
  hash: hashApiKey(SECRET),
  wsIds: ['ws-1'],
  createdAt: '2026-01-01T00:00:00.000Z',
  lastUsedAt: null,
  revokedAt: null,
};

function lookup(overrides: Partial<ApiKeyLookup> = {}): ApiKeyLookup {
  return {
    owners: async () => ['user-1'],
    keysOf: async () => [record],
    userGone: async () => false,
    ...overrides,
  };
}

test('verifyApiKey refuses a deleted owner\'s key', async () => {
  const seen: string[] = [];
  const found = await verifyApiKeyWithLookup(
    SECRET,
    lookup({
      userGone: async (id) => {
        seen.push(id);
        return true;
      },
    }),
    NOW,
  );
  assert.equal(found, null);
  assert.deepEqual(seen, ['user-1'], 'the check is made against the key owner');
});

test('verifyApiKey accepts a live owner\'s key and rejects the wrong secret', async () => {
  const found = await verifyApiKeyWithLookup(SECRET, lookup(), NOW);
  assert.equal(found?.userId, 'user-1');
  assert.equal(found?.key.id, 'key-1');
  assert.equal(await verifyApiKeyWithLookup('borga_wrong_secret', lookup(), NOW), null);
});

test('verifyApiKey fails open when the owner lookup errors', async () => {
  const found = await verifyApiKeyWithLookup(
    SECRET,
    lookup({
      userGone: async () => {
        throw new Error('database is down');
      },
    }),
    NOW,
  );
  assert.equal(found?.userId, 'user-1', 'an outage must not revoke every key at once');
});

test('no matched key is never allowed', async () => {
  let calls = 0;
  assert.equal(
    await keyOwnerAllowed(null, async () => {
      calls += 1;
      return false;
    }),
    false,
  );
  assert.equal(calls, 0, 'a miss does not need an owner lookup');
});
