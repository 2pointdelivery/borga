import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

process.env.SESSION_SECRET = 'proxy-test-secret-0123456789abcdef0123456789';
delete process.env.BORGA_ADMIN_TOKEN;

// Loaded after SESSION_SECRET is set (the session module reads it when signing).
let proxy: typeof import('../proxy').proxy;
let createSessionToken: typeof import('./auth/session').createSessionToken;
let sessionCookieName: typeof import('./auth/session').sessionCookieName;
before(async () => {
  ({ proxy } = await import('../proxy'));
  ({ createSessionToken, sessionCookieName } = await import('./auth/session'));
});

const BASE = 'http://localhost:13000';
let ipCounter = 0;
// Each request gets its own client IP so the in-memory rate limiter never couples tests together.
const ip = () => `10.9.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

function req(path: string, init: { method?: string; cookie?: string; headers?: Record<string, string>; ip?: string } = {}) {
  const headers: Record<string, string> = { 'x-forwarded-for': init.ip ?? ip(), ...(init.headers ?? {}) };
  if (init.cookie) headers.cookie = `${sessionCookieName()}=${init.cookie}`;
  return new NextRequest(`${BASE}${path}`, { method: init.method ?? 'GET', headers });
}

/** A response that is NextResponse.next() (request allowed on) carries this header; a rejection does not. */
const passedThrough = (r: Response) => r.headers.get('x-middleware-next') === '1';

test('API calls without a session are rejected', async () => {
  for (const [path, method] of [['/api/borga/data', 'GET'], ['/api/borga/config', 'POST'], ['/api/borga/tickets', 'GET'], ['/api/borga/operator/invites', 'POST']] as const) {
    const r = await proxy(req(path, { method }));
    assert.equal(r.status, 401, `${method} ${path}`);
  }
});

test('the scheduler endpoint is reachable without a session (the route checks CRON_SECRET itself)', async () => {
  assert.equal(passedThrough(await proxy(req('/api/borga/cron', { method: 'POST' }))), true);
  assert.equal(passedThrough(await proxy(req('/api/borga/cron', { method: 'GET' }))), true);
  // other verbs and sibling paths are not exempt
  assert.equal((await proxy(req('/api/borga/cron', { method: 'DELETE' }))).status, 401);
  assert.equal((await proxy(req('/api/borga/cron/extra', { method: 'POST' }))).status, 401);
});

test('every session-less public endpoint is exempt, and only those', async () => {
  const open: [string, string][] = [
    ['/api/borga/hooks/meta', 'POST'],
    ['/api/borga/hooks/twilio', 'POST'],
    ['/api/borga/tickets/inbound', 'POST'],
    ['/api/borga/webhooks/inbound', 'POST'],
    ['/api/borga/email/unsubscribe', 'GET'],
    ['/api/borga/voice/call/twiml', 'POST'],
    ['/api/borga/voice/call/audio', 'GET'],
  ];
  for (const [path, method] of open) assert.equal(passedThrough(await proxy(req(path, { method }))), true, `${method} ${path}`);
  // same family of paths, wrong verb or sibling, stays closed
  for (const [path, method] of [['/api/borga/tickets/inbound', 'GET'], ['/api/borga/webhooks/inbound', 'DELETE'], ['/api/borga/webhooks/dispatch', 'POST'], ['/api/borga/voice/call', 'POST']] as const) {
    assert.equal((await proxy(req(path, { method }))).status, 401, `${method} ${path}`);
  }
});

test('a valid session passes reads; writes also need the CSRF header', async () => {
  const cookie = await createSessionToken('user-1');
  assert.equal(passedThrough(await proxy(req('/api/borga/data', { cookie }))), true);
  const noHeader = await proxy(req('/api/borga/data', { method: 'POST', cookie }));
  assert.equal(noHeader.status, 403);
  const withHeader = await proxy(req('/api/borga/data', { method: 'POST', cookie, headers: { 'x-borga-client': 'borga-dashboard' } }));
  assert.equal(passedThrough(withHeader), true);
});

test('forged, tampered and expired session cookies are rejected', async () => {
  const good = await createSessionToken('user-2');
  const [uid, exp, sig] = good.split('.');
  for (const bad of [`${uid}.${exp}.${sig.slice(0, -2)}xx`, `other-user.${exp}.${sig}`, 'garbage', `${uid}.1.${sig}`]) {
    assert.equal((await proxy(req('/api/borga/data', { cookie: bad }))).status, 401, bad);
  }
});

test('/app pages redirect to login without a session', async () => {
  const r = await proxy(req('/app/finance'));
  assert.equal(r.status, 307);
  assert.match(r.headers.get('location') ?? '', /\/login\?next=%2Fapp%2Ffinance/);
});

test('sign-in and sign-up are rate limited per IP, per route', async () => {
  const same = '203.0.113.7';
  const codes: number[] = [];
  for (let i = 0; i < 12; i++) codes.push((await proxy(req('/api/auth/login', { method: 'POST', ip: same }))).status);
  assert.deepEqual(codes.slice(0, 10).filter((c) => c === 429), []);
  assert.deepEqual(codes.slice(10), [429, 429]);
  // another route and another IP are unaffected
  assert.notEqual((await proxy(req('/api/auth/signup', { method: 'POST', ip: same }))).status, 429);
  assert.notEqual((await proxy(req('/api/auth/login', { method: 'POST', ip: '203.0.113.8' }))).status, 429);
  // reads (the signup page asks for the mode) are not counted
  for (let i = 0; i < 15; i++) assert.notEqual((await proxy(req('/api/auth/signup', { method: 'GET', ip: '203.0.113.9' }))).status, 429);
});
