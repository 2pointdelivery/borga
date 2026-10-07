import test from 'node:test';
import assert from 'node:assert/strict';
import { composioScope, inScope, scopedEntity } from './borga/composio-scope';

test('each user gets their own prefix, and a company with its own key gets none', () => {
  const a = composioScope('user-a');
  const b = composioScope('user-b');
  assert.match(a, /^u[0-9a-f]{12}-$/);
  assert.notEqual(a, b);
  assert.equal(composioScope('user-a'), a, 'stable');
  assert.equal(composioScope('user-a', false), '');
  assert.equal(composioScope(null), '');
});

test('entity ids are prefixed once, so a held approval can be replayed', () => {
  const s = composioScope('user-a');
  assert.equal(scopedEntity(s, 'workspace-inbox'), `${s}workspace-inbox`);
  assert.equal(scopedEntity(s, `${s}workspace-inbox`), `${s}workspace-inbox`);
  assert.equal(scopedEntity(s, ''), `${s}default`);
  assert.equal(scopedEntity('', 'x'), 'x');
});

test('only accounts under the caller prefix are in scope, whatever the field is called', () => {
  const s = composioScope('user-a');
  const other = composioScope('user-b');
  assert.ok(inScope(s, { user_id: `${s}workspace-inbox` }));
  assert.ok(inScope(s, { userId: `${s}x` }));
  assert.ok(inScope(s, { entity_id: `${s}x` }));
  assert.ok(!inScope(s, { user_id: `${other}workspace-inbox` }));
  assert.ok(!inScope(s, { user_id: 'workspace-inbox' }), 'an unscoped legacy account is not anyone\'s');
  assert.ok(!inScope(s, {}));
  assert.ok(inScope('', { user_id: 'anything' }), 'no scope, no filtering');
});
