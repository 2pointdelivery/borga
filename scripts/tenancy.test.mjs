// Cross-tenant isolation test (T12). Runs against a LIVE server and its database:
//
//   BASE_URL=http://localhost:13000 node --test scripts/tenancy.test.mjs
//
// The target must allow open signup and must not list the test users as operators, e.g. a production build started with
//   SIGNUP_MODE=open BORGA_OPERATOR_EMAILS=nobody@example.test
// (plus the usual required secrets). Optional: DATABASE_URL lets the test delete the two users it creates.
//
// What it proves: user A seeds data in their workspace through the real routes; user B then calls every session route
// with A's workspace id and A's user id and must never see A's data, and nothing B writes may reach A.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const BASE = (process.env.BASE_URL ?? '').replace(/\/$/, '');
if (!BASE) throw new Error('Set BASE_URL, e.g. BASE_URL=http://localhost:13000');

const tag = randomBytes(4).toString('hex');
const MARK_A = `TENANT-A-${tag}`;
const MARK_B = `TENANT-B-${tag}`;
const MAIL_A = `a-${tag}@example.test`;
const MAIL_B = `b-${tag}@example.test`;

const users = {};
const sentinel = { aTicketId: '' };

async function call(who, method, path, body, extraHeaders = {}) {
  const headers = { 'X-Borga-Client': 'borga-dashboard', ...extraHeaders };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (who) headers.Cookie = who.cookie;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, text, json };
}

async function signup(label) {
  const email = `tenancy-${label}-${tag}@example.test`;
  const res = await fetch(`${BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `Tenant ${label}`, email, password: 'tenancy-test-pass-1' }),
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 403) throw new Error('Signup is closed on the target. Start it with SIGNUP_MODE=open for this test.');
  assert.equal(res.status, 200, `signup ${label}: ${JSON.stringify(json)}`);
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('borga_session='));
  assert.ok(cookie, 'session cookie');
  return { label, email, id: json.user.id, ws: json.workspaceId, cookie };
}

const seen = (r, ...needles) => needles.filter((n) => r.text.includes(n));

before(async () => {
  users.A = await signup('a');
  users.B = await signup('b');
  const { A } = users;

  // WhatsApp ships switched off (T30); turn it on for the two workspaces this suite exercises it through.
  for (const u of [users.A, users.B]) {
    const on = await call(u, 'POST', '/api/borga/features', { ws: u.ws, id: 'whatsapp', enabled: true });
    assert.equal(on.status, 200, 'enable whatsapp');
  }

  // ── A seeds data through the real routes ────────────────────────────────────────────────────────────────────────
  const goals = await call(A, 'POST', '/api/borga/data', { entity: 'goals', ws: A.ws, value: [{ id: 'g-a', title: MARK_A }] });
  assert.equal(goals.status, 200, 'A seeds goals');
  const knowledge = await call(A, 'POST', '/api/borga/data', { entity: 'knowledge', ws: A.ws, value: [{ id: 'k-a', title: MARK_A, body: MARK_A }] });
  assert.equal(knowledge.status, 200, 'A seeds knowledge');
  const wa = await call(A, 'POST', '/api/borga/data', { entity: 'whatsapp', ws: A.ws, value: { connected: true, phone: MARK_A, waId: 'wa-a', lastSync: 'now' } });
  assert.equal(wa.status, 200, 'A seeds whatsapp config');

  const ticket = await call(A, 'POST', `/api/borga/tickets?ws=${A.ws}`, { action: 'create', ticket: { subject: MARK_A, description: MARK_A } });
  assert.equal(ticket.status, 200, `A creates a ticket: ${ticket.text.slice(0, 200)}`);
  sentinel.aTicketId = ticket.json?.ticket?.id ?? ticket.json?.id ?? '';
  assert.ok(sentinel.aTicketId, 'ticket id returned');

  const feat = await call(A, 'POST', '/api/borga/features', { ws: A.ws, id: 'projects', enabled: false });
  assert.equal(feat.status, 200, `A turns a feature off: ${feat.text.slice(0, 200)}`);

  const mail = await call(A, 'POST', `/api/borga/email?ws=${A.ws}`, { action: 'saveSettings', settings: { enabled: true, recipients: [MAIL_A] } });
  assert.equal(mail.status, 200, `A saves email settings: ${mail.text.slice(0, 200)}`);

  const mem = await call(A, 'POST', '/api/borga/memory', { action: 'store', ws: A.ws, memory: { content: MARK_A, agentId: 'a1', kind: 'fact' } });
  assert.equal(mem.status, 200, 'A stores a memory');

  const task = await call(A, 'POST', '/api/borga/scheduler', { action: 'create', ws: A.ws, name: MARK_A, goal: MARK_A });
  assert.equal(task.status, 200, 'A creates a scheduled task');

  const conn = await call(A, 'POST', `/api/borga/connections?ws=${A.ws}`, { action: 'save', provider: 'supermemory', values: { apiKey: `sm_${MARK_A}` } });
  assert.equal(conn.status, 200, `A saves a connection: ${conn.text.slice(0, 200)}`);
});

after(async () => {
  if (!process.env.DATABASE_URL) return;
  const mysql = (await import('mysql2/promise')).default;
  const c = await mysql.createConnection(process.env.DATABASE_URL);
  for (const u of Object.values(users)) {
    await c.query('delete from borga_state where `key` like ?', [`u::${u.id}::%`]);
    await c.query('delete from borga_state where `key` like ? or `key` like ?', [`t::${u.id}::%`, `c::${u.id}::%`]);
    await c.query('delete from borga_users where id = ?', [u.id]);
  }
  await c.end();
});

// A's own view must work, otherwise "B sees nothing" proves nothing.
test('control: A can read back everything A seeded', async () => {
  const { A } = users;
  const data = await call(A, 'GET', `/api/borga/data?ws=${A.ws}`);
  assert.ok(seen(data, MARK_A).length, 'A sees own goals/knowledge');
  const tickets = await call(A, 'GET', `/api/borga/tickets?ws=${A.ws}`);
  assert.ok(seen(tickets, MARK_A).length, 'A sees own ticket');
  const mem = await call(A, 'GET', `/api/borga/memory?ws=${A.ws}`);
  assert.ok(seen(mem, MARK_A).length, 'A sees own memory');
  const sched = await call(A, 'GET', `/api/borga/scheduler?ws=${A.ws}`);
  assert.ok(seen(sched, MARK_A).length, 'A sees own task');
  const email = await call(A, 'GET', `/api/borga/email?ws=${A.ws}`);
  assert.ok(seen(email, MAIL_A).length, 'A sees own email recipients');
  const feats = await call(A, 'GET', `/api/borga/features?ws=${A.ws}`);
  assert.equal(feats.json?.flags?.projects ?? feats.json?.features?.projects, false, 'A sees own feature override');
  const wa = await call(A, 'GET', `/api/borga/whatsapp?ws=${A.ws}`);
  assert.equal(wa.json?.config?.connected, true, 'A sees own whatsapp state (dashboard key and route key agree)');
  assert.equal(wa.json?.config?.phone, MARK_A);
});

const READS = [
  ['data', (w) => `/api/borga/data?ws=${w}`],
  ['tickets', (w) => `/api/borga/tickets?ws=${w}`],
  ['features', (w) => `/api/borga/features?ws=${w}`],
  ['email', (w) => `/api/borga/email?ws=${w}`],
  ['connections', (w) => `/api/borga/connections?ws=${w}`],
  ['memory', (w) => `/api/borga/memory?ws=${w}`],
  ['scheduler', (w) => `/api/borga/scheduler?ws=${w}`],
  ['whatsapp', (w) => `/api/borga/whatsapp?ws=${w}`],
  ['supermemory', (w) => `/api/borga/supermemory?ws=${w}`],
  ['engine', (w) => `/api/borga/engine?ws=${w}`],
  ['sync', (w) => `/api/borga/sync?ws=${w}`],
];

test("B reading A's workspace id never sees A's data (with and without A's user id in the query)", async () => {
  const { A, B } = users;
  for (const [name, path] of READS) {
    for (const extra of ['', `&u=${A.id}&userId=${A.id}&uid=${A.id}`]) {
      const r = await call(B, 'GET', path(A.ws) + extra);
      assert.ok(r.status < 500, `${name}: server error ${r.status}`);
      assert.deepEqual(seen(r, MARK_A, MAIL_A, A.id), [], `${name}${extra ? ' (+A id)' : ''} leaked A's data`);
    }
  }
});

test("B cannot read A's whatsapp state or feature overrides through A's workspace id", async () => {
  const { A, B } = users;
  const wa = await call(B, 'GET', `/api/borga/whatsapp?ws=${A.ws}`);
  assert.notEqual(wa.json?.config?.connected, true);
  const feats = await call(B, 'GET', `/api/borga/features?ws=${A.ws}`);
  assert.notEqual(feats.json?.flags?.projects ?? feats.json?.features?.projects, false, "B must see defaults, not A's override");
});

test("B cannot open, change or comment on A's ticket by id", async () => {
  const { A, B } = users;
  const id = sentinel.aTicketId;
  const get = await call(B, 'GET', `/api/borga/tickets?ws=${A.ws}&id=${encodeURIComponent(id)}`);
  assert.deepEqual(seen(get, MARK_A), [], 'ticket body leaked');
  const upd = await call(B, 'POST', `/api/borga/tickets?ws=${A.ws}`, { action: 'update', id, patch: { subject: MARK_B } });
  assert.notEqual(upd.status, 200, `update must not succeed: ${upd.text.slice(0, 160)}`);
  const com = await call(B, 'POST', `/api/borga/tickets?ws=${A.ws}`, { action: 'comment', id, kind: 'public', body: MARK_B });
  assert.notEqual(com.status, 200, `comment must not succeed: ${com.text.slice(0, 160)}`);
});

test("everything B writes into A's workspace id lands in B's own space and never reaches A", async () => {
  const { A, B } = users;
  const writes = [
    call(B, 'POST', '/api/borga/data', { entity: 'goals', ws: A.ws, value: [{ id: 'g-b', title: MARK_B }] }),
    call(B, 'POST', `/api/borga/tickets?ws=${A.ws}`, { action: 'create', ticket: { subject: MARK_B } }),
    call(B, 'POST', '/api/borga/features', { ws: A.ws, id: 'projects', enabled: true }),
    call(B, 'POST', `/api/borga/email?ws=${A.ws}`, { action: 'saveSettings', settings: { recipients: [MAIL_B] } }),
    call(B, 'POST', '/api/borga/memory', { action: 'store', ws: A.ws, memory: { content: MARK_B, agentId: 'a1', kind: 'fact' } }),
    call(B, 'POST', '/api/borga/memory', { action: 'clear', ws: A.ws }),
    call(B, 'POST', '/api/borga/scheduler', { action: 'create', ws: A.ws, name: MARK_B, goal: MARK_B }),
    call(B, 'POST', `/api/borga/connections?ws=${A.ws}`, { action: 'delete', provider: 'supermemory' }),
    call(B, 'POST', `/api/borga/supermemory?ws=${A.ws}`, { action: 'purge', confirm: 'DELETE' }),
  ];
  for (const r of await Promise.all(writes)) assert.ok(r.status < 500, `server error ${r.status}: ${r.text.slice(0, 120)}`);

  // A's view afterwards: still all A's data, none of B's.
  const data = await call(A, 'GET', `/api/borga/data?ws=${A.ws}`);
  assert.ok(seen(data, MARK_A).length, "A's goals/knowledge must survive");
  assert.deepEqual(seen(data, MARK_B), [], "B's goal reached A");
  const tickets = await call(A, 'GET', `/api/borga/tickets?ws=${A.ws}`);
  assert.ok(seen(tickets, MARK_A).length && !seen(tickets, MARK_B).length, 'tickets: A keeps own, gets none of B');
  const feats = await call(A, 'GET', `/api/borga/features?ws=${A.ws}`);
  assert.equal(feats.json?.flags?.projects ?? feats.json?.features?.projects, false, "B changed A's feature flag");
  const mail = await call(A, 'GET', `/api/borga/email?ws=${A.ws}`);
  assert.ok(seen(mail, MAIL_A).length && !seen(mail, MAIL_B).length, 'email settings');
  const mem = await call(A, 'GET', `/api/borga/memory?ws=${A.ws}`);
  assert.ok(seen(mem, MARK_A).length && !seen(mem, MARK_B).length, "B's memory write/clear must not touch A");
  const sched = await call(A, 'GET', `/api/borga/scheduler?ws=${A.ws}`);
  assert.ok(seen(sched, MARK_A).length && !seen(sched, MARK_B).length, 'scheduled tasks');
  const conn = await call(A, 'GET', `/api/borga/connections?ws=${A.ws}`);
  assert.ok(conn.text.includes('supermemory'), 'connections listing still works');
  assert.ok(!/"supermemory"[^}]*"configured":\s*false/.test(conn.text), "B deleted A's saved connection");
});

test("an A-only secret saved in A's connections is never shown to B", async () => {
  const { A, B } = users;
  const r = await call(B, 'GET', `/api/borga/connections?ws=${A.ws}`);
  assert.deepEqual(seen(r, `sm_${MARK_A}`, MARK_A), []);
  const own = await call(A, 'GET', `/api/borga/connections?ws=${A.ws}`);
  assert.deepEqual(seen(own, `sm_${MARK_A}`), [], "even A's own listing must not echo the secret");
});

test('public endpoints do not accept another tenant\'s credentials', async () => {
  const { A, B } = users;
  // Positive control: B's own inbound token works for B (anything but 401).
  const bTickets = await call(B, 'GET', `/api/borga/tickets?ws=${B.ws}`);
  const bToken = bTickets.json?.settings?.inboundToken;
  assert.ok(bToken, "B's inbound token");
  const own = await call(null, 'POST', `/api/borga/tickets/inbound?u=${B.id}&ws=${B.ws}`, { from: 'x@example.test', subject: 'hi', text: 'hi' }, { Authorization: `Bearer ${bToken}` });
  assert.notEqual(own.status, 401, 'control: B token must work on B');
  // B's token against A's mailbox, no token, and a made-up token.
  for (const headers of [{ Authorization: `Bearer ${bToken}` }, {}, { Authorization: 'Bearer not-a-token' }]) {
    const r = await call(null, 'POST', `/api/borga/tickets/inbound?u=${A.id}&ws=${A.ws}`, { from: 'x@example.test', subject: MARK_B, text: MARK_B }, headers);
    assert.equal(r.status, 401, `inbound into A's workspace must be refused (${Object.keys(headers).join(',') || 'no token'})`);
  }
  const tickets = await call(A, 'GET', `/api/borga/tickets?ws=${A.ws}`);
  assert.deepEqual(seen(tickets, MARK_B), [], 'no ticket may have been created in A');
  // Provider webhook verification with no stored credentials for A.
  const hook = await call(null, 'GET', `/api/borga/hooks/meta?u=${A.id}&ws=${A.ws}&hub.mode=subscribe&hub.verify_token=guess&hub.challenge=12345`);
  assert.ok([401, 403, 404].includes(hook.status), `hook verify must fail, got ${hook.status}`);
  assert.ok(!hook.text.includes('12345'), 'challenge must not be echoed');
});

test('shared deployment-wide secrets cannot be changed by a non-operator', async () => {
  const { B } = users;
  const cfg = await call(B, 'POST', '/api/borga/config', { action: 'delete', envVar: 'OPENAI_API_KEY' });
  assert.equal(cfg.status, 403, 'config');
  const wa = await call(B, 'POST', '/api/borga/whatsapp', { action: 'configure', ws: B.ws, persistKey: true, accessToken: 'x'.repeat(40) });
  assert.equal(wa.status, 403, 'whatsapp persistKey');
  const inv = await call(B, 'POST', '/api/borga/operator/invites', { email: 'someone@example.test' });
  assert.equal(inv.status, 403, 'invites');
});

test('requests without a session see nothing on any of these routes', async () => {
  const { A } = users;
  for (const [name, path] of READS) {
    const r = await call(null, 'GET', path(A.ws));
    assert.equal(r.status, 401, `${name} without a session`);
  }
});
