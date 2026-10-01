import test from 'node:test';
import assert from 'node:assert/strict';
import { splitStatements, hashMigration, pendingMigrations, formatDuplicates, verifySchema } from './migrate-core.mjs';

test('statements are split on drizzle breakpoints and empty parts are dropped', () => {
  const sql = 'CREATE TABLE a (x int);--> statement-breakpoint\n  \nALTER TABLE a ADD y int;--> statement-breakpoint\n';
  assert.deepEqual(splitStatements(sql), ['CREATE TABLE a (x int);', 'ALTER TABLE a ADD y int;']);
  assert.deepEqual(splitStatements('   '), []);
});

test('the hash is the sha256 hex digest drizzle-kit stores', () => {
  assert.equal(hashMigration('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('pending migrations are those newer than the latest applied one, in order', () => {
  const entries = [{ tag: 'b', when: 200 }, { tag: 'a', when: 100 }, { tag: 'c', when: 300 }];
  assert.deepEqual(pendingMigrations(entries, null).map((e) => e.tag), ['a', 'b', 'c']);
  assert.deepEqual(pendingMigrations(entries, '100').map((e) => e.tag), ['b', 'c']);
  assert.deepEqual(pendingMigrations(entries, 300), []);
});

test('duplicate emails are listed readably', () => {
  assert.equal(formatDuplicates([{ e: 'a@x.test', n: 2 }, { e: 'b@x.test', n: 3 }]), '  a@x.test (2 accounts)\n  b@x.test (3 accounts)');
});

test('schema verification names every missing piece and rejects a non-unique email index', () => {
  const good = {
    tables: ['borga_users', 'borga_state'],
    userColumns: ['id', 'email', 'name', 'password_hash', 'reset_token', 'reset_token_expires', 'created_at'],
    stateColumns: ['key', 'value', 'updated_at', 'version'],
    emailIndexes: [{ name: 'idx_users_email', unique: true }],
  };
  assert.deepEqual(verifySchema(good), []);
  const bad = { tables: ['borga_users'], userColumns: ['id', 'email'], emailIndexes: [{ name: 'idx_users_email', unique: false }] };
  const problems = verifySchema(bad);
  assert.ok(problems.includes('table borga_state is missing'));
  assert.ok(problems.includes('borga_users.reset_token is missing'));
  assert.ok(problems.some((p) => p.includes('not unique')));
  assert.ok(problems.includes('borga_state.version is missing'));
  assert.ok(verifySchema({ ...good, emailIndexes: [] }).some((p) => p.includes('index idx_users_email is missing')));
});
