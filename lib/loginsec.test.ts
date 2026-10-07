import test from 'node:test';
import assert from 'node:assert/strict';
import { clientIp, looksLikeIp } from './auth/client-ip';
import { LoginThrottle, MAX_FAILURES, WINDOW_MS } from './auth/login-throttle';

const h = (obj: Record<string, string>) => ({ get: (n: string) => obj[n.toLowerCase()] ?? null });

test('the client address is the right-most forwarded value, which a client cannot choose', () => {
  assert.equal(clientIp(h({ 'x-forwarded-for': '203.0.113.7' })), '203.0.113.7');
  // a client sends its own value; the proxy appends the real address last
  assert.equal(clientIp(h({ 'x-forwarded-for': '1.2.3.4, 198.51.100.9' })), '198.51.100.9');
  assert.equal(clientIp(h({ 'x-forwarded-for': '9.9.9.9,8.8.8.8 , 198.51.100.9' })), '198.51.100.9');
});

test('rotating a spoofed left-most value does not change the key', () => {
  const keys = new Set(['10.0.0.1', '10.0.0.2', '10.0.0.3', 'a-b-c'].map((spoof) => clientIp(h({ 'x-forwarded-for': `${spoof}, 198.51.100.9` }))));
  assert.deepEqual([...keys], ['198.51.100.9']);
});

test('free text and oversized values never become limiter keys', () => {
  assert.equal(clientIp(h({ 'x-forwarded-for': 'not-an-ip' })), 'unknown');
  assert.equal(clientIp(h({ 'x-forwarded-for': '1.2.3.4, <script>' })), 'unknown');
  assert.equal(clientIp(h({ 'x-forwarded-for': '999.1.1.1' })), 'unknown');
  assert.equal(clientIp(h({ 'x-forwarded-for': 'a'.repeat(500) })), 'unknown');
  assert.equal(clientIp(h({})), 'unknown');
});

test('falls back to x-real-ip, accepts IPv6, and normalises case', () => {
  assert.equal(clientIp(h({ 'x-real-ip': '192.0.2.5' })), '192.0.2.5');
  assert.equal(clientIp(h({ 'x-forwarded-for': '2001:DB8::1' })), '2001:db8::1');
  assert.equal(clientIp(h({ 'x-forwarded-for': '', 'x-real-ip': '192.0.2.5' })), '192.0.2.5');
  assert.equal(looksLikeIp('::1'), true);
  assert.equal(looksLikeIp('example.com'), false);
});

function clock() {
  let t = 1_000_000;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

test('an account locks after the maximum number of failures, case-insensitively', () => {
  const c = clock();
  const th = new LoginThrottle(c.now);
  for (let i = 0; i < MAX_FAILURES - 1; i++) { th.recordFailure('Ada@Example.com'); c.advance(1000); }
  assert.equal(th.check('ada@example.com').locked, false, 'one attempt left');
  th.recordFailure('ada@example.com');
  const v = th.check(' ADA@example.com ');
  assert.equal(v.locked, true);
  assert.ok(v.locked && v.retryAfterSec > 0 && v.retryAfterSec <= WINDOW_MS / 1000);
});

test('the lock lifts once the oldest failures age out of the window', () => {
  const c = clock();
  const th = new LoginThrottle(c.now);
  for (let i = 0; i < MAX_FAILURES; i++) th.recordFailure('a@x.test');
  assert.equal(th.check('a@x.test').locked, true);
  c.advance(WINDOW_MS - 1);
  assert.equal(th.check('a@x.test').locked, true);
  c.advance(2);
  assert.equal(th.check('a@x.test').locked, false);
});

test('a successful sign-in clears the count; other accounts are unaffected', () => {
  const th = new LoginThrottle(clock().now);
  for (let i = 0; i < MAX_FAILURES - 1; i++) th.recordFailure('a@x.test');
  th.recordSuccess('a@x.test');
  for (let i = 0; i < MAX_FAILURES - 1; i++) th.recordFailure('a@x.test');
  assert.equal(th.check('a@x.test').locked, false, 'the earlier failures no longer count');
  for (let i = 0; i < MAX_FAILURES; i++) th.recordFailure('b@x.test');
  assert.equal(th.check('b@x.test').locked, true);
  assert.equal(th.check('c@x.test').locked, false);
});

test('emails with no account are counted the same way, so the lock reveals nothing', () => {
  const th = new LoginThrottle(clock().now);
  for (let i = 0; i < MAX_FAILURES; i++) th.recordFailure('nobody-here@x.test');
  const v = th.check('nobody-here@x.test');
  assert.equal(v.locked, true);
});

test('memory stays bounded under an attack with endless fresh emails', () => {
  const c = clock();
  const th = new LoginThrottle(c.now);
  for (let i = 0; i < 30_000; i++) th.recordFailure(`bot${i}@x.test`);
  // the throttle still works for new emails after being flooded
  for (let i = 0; i < MAX_FAILURES; i++) th.recordFailure('real@x.test');
  assert.equal(th.check('real@x.test').locked, true);
  assert.equal(th.check('fresh@x.test').locked, false);
});
