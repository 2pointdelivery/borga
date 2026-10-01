// Optimistic-concurrency test (T21). Runs against a LIVE server and its database:
//
//   BASE_URL=http://localhost:13000 node --test scripts/concurrency.test.mjs
//
// The target must allow open signup (SIGNUP_MODE=open) and have migration 0002 applied. Optional: DATABASE_URL lets the test
// delete the users it creates.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const BASE = (process.env.BASE_URL ?? '').replace(/\/$/, '');
if (!BASE) throw new Error('Set BASE_URL, e.g. BASE_URL=http://localhost:13000');
const tag = randomBytes(4).toString('hex');
const users = {};

async function call(who, method, path, body) {
  const headers = { 'X-Borga-Client': 'borga-dashboard' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (who) headers.Cookie = who.cookie;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}

async function signup(label) {
  const res = await fetch(`${BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `Conc ${label}`, email: `conc-${label}-${tag}@example.test`, password: 'concurrency-test-1' }),
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 403) throw new Error('Signup is closed on the target. Start it with SIGNUP_MODE=open for this test.');
  assert.equal(res.status, 200, JSON.stringify(json));
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('borga_session='));
  return { id: json.user.id, ws: json.workspaceId, cookie };
}

const save = (u, entity, value, baseVersion) => call(u, 'POST', '/api/borga/data', { entity, ws: u.ws, value, ...(baseVersion === undefined ? {} : { baseVersion }) });
const versions = async (u) => (await call(u, 'GET', `/api/borga/data?ws=${u.ws}`)).json.versions;
const stored = async (u) => (await call(u, 'GET', `/api/borga/data?ws=${u.ws}`)).json;

before(async () => {
  users.A = await signup('a');
  users.B = await signup('b');
});

after(async () => {
  if (!process.env.DATABASE_URL) return;
  const mysql = (await import('mysql2/promise')).default;
  const c = await mysql.createConnection(process.env.DATABASE_URL);
  for (const u of Object.values(users)) {
    await c.query('delete from borga_state where `key` like ?', [`u::${u.id}::%`]);
    await c.query('delete from borga_users where id = ?', [u.id]);
  }
  await c.end();
});

test('GET reports the version of every stored entity (and of the company list)', async () => {
  const { A } = users;
  const reg = await call(A, 'GET', '/api/borga/data');
  assert.equal(typeof reg.json.versions.workspaces, 'number', 'the signup created the company list');
  const v = await versions(A);
  assert.deepEqual(Object.keys(v).filter((k) => k === 'goals'), [], 'nothing stored yet for goals');
});

test('first save expects no row (version 0); the next must name the version it read', async () => {
  const { A } = users;
  const first = await save(A, 'goals', [{ id: 'g1', t: 'one' }], 0);
  assert.equal(first.status, 200);
  assert.equal(first.json.version, 1);
  assert.equal((await versions(A)).goals, 1);
  const second = await save(A, 'goals', [{ id: 'g1', t: 'two' }], 1);
  assert.equal(second.status, 200);
  assert.equal(second.json.version, 2);
});

test('a stale save is refused with 409, nothing is overwritten, and the current copy comes back', async () => {
  const { A } = users;
  const stale = await save(A, 'goals', [{ id: 'g1', t: 'from a stale tab' }], 1); // goals is at version 2
  assert.equal(stale.status, 409);
  assert.equal(stale.json.error, 'conflict');
  assert.equal(stale.json.current.version, 2);
  assert.deepEqual(stale.json.current.value, [{ id: 'g1', t: 'two' }]);
  assert.deepEqual((await stored(A)).goals, [{ id: 'g1', t: 'two' }], 'the stored data is unchanged');
  assert.equal((await versions(A)).goals, 2, 'a refused save does not move the version');
});

test('a first save conflicts when the row already exists', async () => {
  const { A } = users;
  const r = await save(A, 'goals', [{ id: 'x' }], 0);
  assert.equal(r.status, 409);
});

test('two saves from the same version at the same time: exactly one is applied', async () => {
  const { A } = users;
  const v = (await versions(A)).goals;
  const [r1, r2] = await Promise.all([save(A, 'goals', [{ id: 'g1', t: 'racer 1' }], v), save(A, 'goals', [{ id: 'g1', t: 'racer 2' }], v)]);
  assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
  assert.equal((await versions(A)).goals, v + 1, 'exactly one write landed');
});

test('a change made by the server (an agent, the scheduler) makes an older copy stale', async () => {
  const { A } = users;
  const before = await save(A, 'scheduledTasks', [], 0); // the dashboard's own copy
  assert.equal(before.status, 200);
  const created = await call(A, 'POST', '/api/borga/scheduler', { action: 'create', ws: A.ws, name: 'by the server', goal: 'g' });
  assert.equal(created.status, 200, created.text);
  assert.ok((await versions(A)).scheduledTasks > 1, 'the server write bumped the version');
  const stale = await save(A, 'scheduledTasks', [], 1);
  assert.equal(stale.status, 409, 'a save based on the older copy must not erase the server-made task');
  assert.ok(JSON.stringify(stale.json.current.value).includes('by the server'));
});

test('an unconditional save (older clients) still works and moves the version, so later stale saves conflict', async () => {
  const { A } = users;
  const v = (await versions(A)).goals;
  const legacy = await save(A, 'goals', [{ id: 'legacy' }]);
  assert.equal(legacy.status, 200);
  assert.equal((await versions(A)).goals, v + 1);
  assert.equal((await save(A, 'goals', [{ id: 'stale' }], v)).status, 409);
});

test('the company list is versioned the same way', async () => {
  const { A } = users;
  const reg = (await call(A, 'GET', '/api/borga/data')).json;
  const v = reg.versions.workspaces;
  const ok = await call(A, 'POST', '/api/borga/data', { entity: 'workspaces', value: reg.workspaces, baseVersion: v });
  assert.equal(ok.status, 200);
  const stale = await call(A, 'POST', '/api/borga/data', { entity: 'workspaces', value: reg.workspaces, baseVersion: v });
  assert.equal(stale.status, 409);
});

test("another user's data and versions are separate", async () => {
  const { A, B } = users;
  assert.deepEqual(Object.keys(await versions(B)), [], "B has stored nothing, and A's versions are not visible");
  const r = await save({ ...B, ws: A.ws }, 'goals', [{ id: 'b' }], 0);
  assert.equal(r.status, 200, "B's first save into A's workspace id lands in B's own space");
  assert.notEqual((await stored(A)).goals?.[0]?.id, 'b');
});

test('a malformed baseVersion is rejected (400), never treated as "no check"', async () => {
  const { A } = users;
  const before = (await versions(A)).goals;
  for (const bad of ['1', -1, 1.5, null]) {
    const r = await call(A, 'POST', '/api/borga/data', { entity: 'goals', ws: A.ws, value: [{ id: 'bad' }], baseVersion: bad });
    assert.equal(r.status, 400, String(bad));
  }
  assert.equal((await versions(A)).goals, before, 'nothing was written');
});
