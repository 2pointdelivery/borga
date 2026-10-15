import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPushPayload,
  isValidSubscription,
  mergeSubscriptions,
  noticeTarget,
  pushUrgency,
  resolvePushGate,
  shouldPush,
  validateVapidEnv,
  type StoredPushSubscription,
} from './borga/push-core';
import type { ProactiveNotice } from './borga/data';

const notice = (over: Partial<ProactiveNotice> = {}): ProactiveNotice => ({
  id: 'n-1',
  title: 'SLA breached — SUP-42',
  body: 'First response missed its target.',
  severity: 'urgent',
  source: 'scheduler',
  createdAt: new Date().toISOString(),
  readAt: null,
  ...over,
});

test('subscriptions need an https endpoint and both keys', () => {
  const good = { endpoint: 'https://fcm.googleapis.com/fake', keys: { p256dh: 'x', auth: 'y' } };
  assert.equal(isValidSubscription(good), true);
  assert.equal(isValidSubscription({ ...good, endpoint: 'http://evil.test/x' }), false);
  assert.equal(isValidSubscription({ ...good, endpoint: 'not a url' }), false);
  assert.equal(isValidSubscription({ endpoint: 'https://x.test', keys: { p256dh: '', auth: 'y' } }), false);
  assert.equal(isValidSubscription({ endpoint: 'https://x.test' }), false);
  assert.equal(isValidSubscription(null), false);
});

test('urgency wakes the device for urgent only', () => {
  assert.equal(pushUrgency('urgent'), 'high');
  assert.equal(pushUrgency('noteworthy'), 'normal');
  assert.equal(pushUrgency('info'), 'normal');
});

test('notices deep-link to runs, planner, or overview', () => {
  assert.deepEqual(noticeTarget({ runId: 'r-1', taskId: undefined }), { page: 'ai', tab: 'runs' });
  assert.deepEqual(noticeTarget({ runId: undefined, taskId: 't-1' }), { page: 'ai', tab: 'planner' });
  assert.deepEqual(noticeTarget({ runId: undefined, taskId: undefined }), { page: 'overview', tab: 'command' });
});

test('payload truncates long titles and collapses by notice tag', () => {
  const p = buildPushPayload(notice({ title: `  ${'A'.repeat(200)}  `, body: 'b'.repeat(500) }), 'https://borga.test/');
  assert.ok(p.title.length <= 60, p.title);
  assert.ok(p.body.length <= 180, p.body);
  assert.equal(p.tag, 'borga-n-1');
  assert.equal(p.url, 'https://borga.test/app');
  assert.equal(p.severity, 'urgent');
});

test('push prefs default on; info never pushes; unsubscribed never pushes', () => {
  const gate = resolvePushGate(undefined);
  assert.deepEqual(gate, { pushUrgent: true, pushNoteworthy: true });
  assert.equal(shouldPush(gate, 'urgent', 1), true);
  assert.equal(shouldPush(gate, 'noteworthy', 1), true);
  assert.equal(shouldPush(gate, 'info', 5), false);
  assert.equal(shouldPush(gate, 'urgent', 0), false);
  const off = resolvePushGate({ tasks: true, handoffs: true, sync: false, voice: false, kpi: false, pushUrgent: false, pushNoteworthy: false });
  assert.equal(shouldPush(off, 'urgent', 2), false);
  assert.equal(shouldPush(off, 'noteworthy', 2), false);
});

test('subscriptions dedupe by endpoint, newest first, bounded', () => {
  const mk = (endpoint: string, createdAt: string): StoredPushSubscription => ({ endpoint, keys: { p256dh: 'p', auth: 'a' }, createdAt, userAgent: null });
  const existing = [mk('https://a.test/1', '2026-01-01T00:00:00.000Z'), mk('https://a.test/2', '2026-01-02T00:00:00.000Z')];
  const merged = mergeSubscriptions(existing, { endpoint: 'https://a.test/1', keys: { p256dh: 'p2', auth: 'a2' } }, 'ua', '2026-01-03T00:00:00.000Z');
  assert.deepEqual(merged.map((s) => s.endpoint), ['https://a.test/1', 'https://a.test/2']);
  assert.equal(merged[0].createdAt, '2026-01-03T00:00:00.000Z');
  const many = Array.from({ length: 30 }, (_, i) => mk(`https://a.test/${i}`, '2026-01-01T00:00:00.000Z'));
  assert.equal(mergeSubscriptions(many, { endpoint: 'https://new.test', keys: { p256dh: 'p', auth: 'a' } }, null, '2026-01-03T00:00:00.000Z').length, 20);
});

test('VAPID env validation accepts generated keys and rejects junk', () => {
  const pub = 'B'.repeat(87);
  const priv = 'C'.repeat(43);
  assert.deepEqual(validateVapidEnv({ VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv, VAPID_SUBJECT: 'mailto:ops@example.test' }), { ok: true });
  assert.equal(validateVapidEnv({}).ok, false);
  assert.equal(validateVapidEnv({ VAPID_PUBLIC_KEY: 'short', VAPID_PRIVATE_KEY: priv }).ok, false);
  assert.equal(validateVapidEnv({ VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: 'x'.repeat(43).replace(/x/g, '!') }).ok, false);
  assert.equal(validateVapidEnv({ VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv, VAPID_SUBJECT: 'not-a-contact' }).ok, false);
});
