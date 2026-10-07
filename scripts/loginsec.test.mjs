// Sign-in hardening test (T15). Runs against a LIVE server and its database:
//
//   BASE_URL=http://localhost:13000 node --test scripts/loginsec.test.mjs
//
// The target must allow open signup (SIGNUP_MODE=open). Optional: DATABASE_URL lets the test delete the users it creates.
// The test plays the part of the reverse proxy by sending X-Forwarded-For itself: the right-most value is the "real peer".
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const BASE = (process.env.BASE_URL ?? '').replace(/\/$/, '');
if (!BASE) throw new Error('Set BASE_URL, e.g. BASE_URL=http://localhost:13000');
const tag = randomBytes(4).toString('hex');
const created = [];
let peer = 0;
const freshPeer = () => `198.51.${Math.floor(peer / 250) % 250}.${(peer++ % 250) + 1}`;

async function login(email, password, xff) {
  const t0 = performance.now();
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': xff ?? freshPeer() },
    body: JSON.stringify({ email, password }),
  });
  const ms = performance.now() - t0;
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json, ms, retryAfter: res.headers.get('retry-after') };
}

async function signup(label) {
  const email = `loginsec-${label}-${tag}@example.test`;
  const res = await fetch(`${BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': freshPeer() },
    body: JSON.stringify({ name: `L ${label}`, email, password: 'right-password-1' }),
  });
  if (res.status === 403) throw new Error('Signup is closed on the target. Start it with SIGNUP_MODE=open for this test.');
  assert.equal(res.status, 200, await res.text());
  created.push(email);
  return email;
}

after(async () => {
  if (!process.env.DATABASE_URL || !created.length) return;
  const mysql = (await import('mysql2/promise')).default;
  const c = await mysql.createConnection(process.env.DATABASE_URL);
  for (const email of created) {
    const [u] = await c.query('select id from borga_users where email = ?', [email]);
    for (const x of u) await c.query('delete from borga_state where `key` like ?', [`u::${x.id}::%`]);
    await c.query('delete from borga_users where email = ?', [email]);
  }
  await c.end();
});

test('rotating a spoofed X-Forwarded-For value does not escape the per-IP limit', async () => {
  const realPeer = '203.0.113.200';
  const statuses = [];
  for (let i = 0; i < 12; i++) statuses.push((await login(`nobody${i}-${tag}@example.test`, 'x', `10.${i}.${i}.${i}, ${realPeer}`)).status);
  assert.deepEqual(statuses.slice(0, 10).filter((s) => s === 429), [], 'the first ten are answered');
  assert.deepEqual(statuses.slice(10), [429, 429], 'the 11th and 12th from the same real peer are blocked');
  // a different real peer is a different client
  assert.notEqual((await login(`other-${tag}@example.test`, 'x', `10.0.0.1, 203.0.113.201`)).status, 429);
});

test('one account is locked after repeated failures from many different addresses, even for the right password', async () => {
  const email = await signup('lock');
  for (let i = 0; i < 8; i++) {
    const r = await login(email, `wrong-${i}`); // a new peer each time, so only the per-account lock can stop this
    assert.equal(r.status, 401, `attempt ${i + 1}`);
  }
  const locked = await login(email, 'wrong-again');
  assert.equal(locked.status, 429);
  assert.ok(Number(locked.retryAfter) > 0, 'Retry-After tells the client when to come back');
  const right = await login(email, 'right-password-1');
  assert.equal(right.status, 429, 'the correct password must not bypass the lock');
  // other accounts are not affected
  const other = await signup('free');
  assert.equal((await login(other, 'right-password-1')).status, 200);
});

test('a missing account looks the same as a wrong password, in message and in time', async () => {
  const users = [await signup('t1'), await signup('t2'), await signup('t3'), await signup('t4')];
  const known = [];
  const unknown = [];
  for (let i = 0; i < 5; i++) {
    for (const email of users) {
      const k = await login(email, `wrong-${i}`);
      assert.equal(k.status, 401);
      known.push(k.ms);
    }
    for (let j = 0; j < 4; j++) {
      const u = await login(`ghost-${i}-${j}-${tag}@example.test`, `wrong-${i}`);
      assert.equal(u.status, 401);
      assert.equal(u.json.error, 'Invalid email or password.');
      unknown.push(u.ms);
    }
  }
  const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const ratio = median(unknown) / median(known);
  console.log(`   median ms: wrong password on a real account ${median(known).toFixed(1)}, unknown email ${median(unknown).toFixed(1)} (ratio ${ratio.toFixed(2)})`);
  // Before the fix an unknown email skipped the slow password hash entirely (ratio near 0.02).
  assert.ok(ratio > 0.5, `an unknown email answers far faster than a real one (ratio ${ratio.toFixed(2)}): timing reveals which emails exist`);
});
