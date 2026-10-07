import test from 'node:test';
import assert from 'node:assert/strict';
import { API_KEY_PREFIX, hashApiKey, parseBearerSecret, safeEqual, toPublic, wsAllowed } from './borga/api-keys';

test('bearer parsing accepts only borga_ secrets', () => {
  assert.equal(parseBearerSecret('Bearer borga_abc123'), 'borga_abc123');
  assert.equal(parseBearerSecret('bearer borga_abc123'), 'borga_abc123');
  assert.equal(parseBearerSecret('Bearer sk-other'), null);
  assert.equal(parseBearerSecret('Bearer '), null);
  assert.equal(parseBearerSecret(null), null);
  assert.equal(parseBearerSecret('Basic borga_abc123'), null);
});

test('hashing is deterministic hex and safeEqual resists length leaks', () => {
  const h1 = hashApiKey(`${API_KEY_PREFIX}secret`);
  const h2 = hashApiKey(`${API_KEY_PREFIX}secret`);
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{64}$/);
  assert.notEqual(h1, hashApiKey(`${API_KEY_PREFIX}other`));
  assert.equal(safeEqual(h1, h2), true);
  assert.equal(safeEqual(h1, hashApiKey('x')), false);
  assert.equal(safeEqual('short', h1), false);
});

test('public records never carry the hash', () => {
  const pub = toPublic({
    id: 'key-1', name: 'Site', prefix: 'borga_abcd…wxyz', hash: 'deadbeef',
    wsIds: ['ws1'], createdAt: '2026-01-01', lastUsedAt: null, revokedAt: null,
  });
  assert.ok(!('hash' in pub));
  assert.equal(pub.prefix, 'borga_abcd…wxyz');
});

test('workspace scoping: valid id required, keys stay inside their scope', () => {
  assert.equal(wsAllowed('ws-1', undefined), 'ws-1', 'sessions are not scope-limited');
  assert.equal(wsAllowed('ws-1', ['ws-1', 'ws-2']), 'ws-1');
  assert.equal(wsAllowed('ws-9', ['ws-1']), null, 'a key cannot reach outside its scope');
  assert.equal(wsAllowed(null, undefined), null);
  assert.equal(wsAllowed('', undefined), null);
  assert.equal(wsAllowed('ws/../evil', undefined), null);
  assert.equal(wsAllowed('ws-1', []), null, 'an empty scope admits nothing');
});
