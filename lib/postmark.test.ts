import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPostmarkMessage,
  classifyPostmarkEvent,
  isSuppressionRefusal,
  nextMailStatus,
  normalizeAddress,
  parseBasicAuth,
  parseOwnerMetadata,
  parsePostmarkSendResponse,
  suppress,
  unsuppress,
  verifyWebhookAuth,
} from './borga/postmark-core';

test('addresses normalize to lowercase; junk is rejected', () => {
  assert.equal(normalizeAddress('  WHO@Example.TEST '), 'who@example.test');
  assert.equal(normalizeAddress('not-an-email'), null);
  assert.equal(normalizeAddress('a@b'), null);
  assert.equal(normalizeAddress(null), null);
});

test('suppression adds, refreshes, caps, and removes', () => {
  const rec = { reason: 'hard-bounce' as const, at: '2026-01-01T00:00:00.000Z' };
  let m = suppress({}, 'a@example.test', rec);
  assert.deepEqual(m['a@example.test'], rec);
  m = suppress(m, 'a@example.test', { ...rec, reason: 'spam-complaint' });
  assert.equal(m['a@example.test'].reason, 'spam-complaint');
  let big = m;
  for (let i = 0; i < 2500; i++) big = suppress(big, `u${i}@example.test`, rec);
  assert.equal(Object.keys(big).length, 2000);
  const { map, removed } = unsuppress(big, 'u2499@example.test');
  assert.equal(removed, true);
  assert.equal(unsuppress(map, 'missing@example.test').removed, false);
});

test('hard bounces and complaints suppress; soft bounces do not; unknown events are ignored', () => {
  for (const type of ['HardBounce', 'BadDomain', 'SpamNotification', 'Unknown']) {
    const r = classifyPostmarkEvent({ RecordType: 'Bounce', Type: type, Email: 'x@example.test', MessageID: 'm-1' });
    assert.equal(r.kind, 'suppress', type);
    assert.equal((r as { reason: string }).reason, 'hard-bounce');
  }
  assert.equal(classifyPostmarkEvent({ RecordType: 'Bounce', Type: 'SoftBounce', Email: 'x@example.test' }).kind, 'soft');
  assert.equal(classifyPostmarkEvent({ RecordType: 'Bounce', Type: 'Transient', Email: 'x@example.test' }).kind, 'soft');
  const c = classifyPostmarkEvent({ RecordType: 'SpamComplaint', Email: 'y@example.test', MessageID: 'm-2' });
  assert.deepEqual(c, { kind: 'suppress', email: 'y@example.test', reason: 'spam-complaint', messageId: 'm-2' });
  assert.equal(classifyPostmarkEvent({ RecordType: 'Bounce', Type: 'HardBounce', Email: 'junk' }).kind, 'ignore');
  assert.equal(classifyPostmarkEvent({ RecordType: 'SubscriptionChange' }).kind, 'ignore');
  assert.equal(classifyPostmarkEvent(null).kind, 'ignore');
  assert.equal(classifyPostmarkEvent('string').kind, 'ignore');
});

test('delivery, open and click track by message id', () => {
  assert.deepEqual(classifyPostmarkEvent({ RecordType: 'Delivery', MessageID: 'm-1', DeliveredAt: '2026-01-01T00:00:00.000Z' }), {
    kind: 'track', messageId: 'm-1', status: 'delivered', at: '2026-01-01T00:00:00.000Z',
  });
  const o = classifyPostmarkEvent({ RecordType: 'Open', MessageID: 'm-1', ReceivedAt: '2026-01-02T00:00:00.000Z' });
  assert.equal(o.kind, 'track');
  const k = classifyPostmarkEvent({ RecordType: 'Click', MessageID: 'm-1', ReceivedAt: '2026-01-03T00:00:00.000Z' });
  assert.equal((k as { status: string }).status, 'clicked');
  assert.equal(classifyPostmarkEvent({ RecordType: 'Open' }).kind, 'ignore');
});

test('mail status only moves forward; bounce and complaint are terminal', () => {
  assert.equal(nextMailStatus(undefined, 'delivered'), 'delivered');
  assert.equal(nextMailStatus('sent', 'opened'), 'opened');
  assert.equal(nextMailStatus('opened', 'clicked'), 'clicked');
  assert.equal(nextMailStatus('clicked', 'opened'), 'clicked');
  assert.equal(nextMailStatus('opened', 'delivered'), 'opened');
  assert.equal(nextMailStatus('delivered', 'bounced'), 'bounced');
  assert.equal(nextMailStatus('bounced', 'opened'), 'bounced');
  assert.equal(nextMailStatus('clicked', 'complained'), 'complained');
  assert.equal(nextMailStatus('complained', 'delivered'), 'complained');
});

test('send response: ErrorCode 0 accepted; refusals reported; 300/406 suppress', () => {
  assert.deepEqual(parsePostmarkSendResponse(200, { ErrorCode: 0, MessageID: 'm-9' }), { ok: true, messageId: 'm-9' });
  const refused = parsePostmarkSendResponse(200, { ErrorCode: 300, Message: 'Inactive recipient.' });
  assert.equal(refused.ok, false);
  assert.equal(isSuppressionRefusal(refused.error!), true);
  assert.equal(isSuppressionRefusal(parsePostmarkSendResponse(200, { ErrorCode: 406, Message: 'Inactive.' }).error!), true);
  assert.equal(isSuppressionRefusal(parsePostmarkSendResponse(200, { ErrorCode: 400, Message: 'Bad sender.' }).error!), false);
  assert.equal(parsePostmarkSendResponse(500, null).ok, false);
  assert.equal(parsePostmarkSendResponse(200, 'garbage').ok, false);
});

test('basic auth parses and verifies in constant time', () => {
  const good = `Basic ${Buffer.from('hookuser:hookpass').toString('base64')}`;
  assert.deepEqual(parseBasicAuth(good), { user: 'hookuser', pass: 'hookpass' });
  assert.equal(parseBasicAuth('Bearer x'), null);
  assert.equal(parseBasicAuth('Basic !!!'), null);
  assert.equal(parseBasicAuth(null), null);
  assert.equal(verifyWebhookAuth(good, 'hookuser', 'hookpass'), true);
  assert.equal(verifyWebhookAuth(good, 'hookuser', 'wrong'), false);
  assert.equal(verifyWebhookAuth(good, 'other', 'hookpass'), false);
  assert.equal(verifyWebhookAuth(null, 'hookuser', 'hookpass'), false);
  assert.equal(verifyWebhookAuth(good, '', ''), false);
});

test('owner metadata validates before touching keys', () => {
  assert.deepEqual(parseOwnerMetadata({ Metadata: { u: 'u_abc-123', ws: 'ws-1' } }), { u: 'u_abc-123', ws: 'ws-1' });
  assert.equal(parseOwnerMetadata({ Metadata: { u: '../evil', ws: 'ws-1' } }), null);
  assert.equal(parseOwnerMetadata({ Metadata: { u: 'u1' } }), null);
  assert.equal(parseOwnerMetadata({}), null);
  assert.equal(parseOwnerMetadata(null), null);
});

test('message body carries tracking flags and owner metadata', () => {
  const m = buildPostmarkMessage({
    from: 'Borga <n@x.test>', to: 'a@x.test', subject: 's', text: 't', html: '<p>t</p>',
    replyTo: 'r@x.test', headers: { 'List-Unsubscribe': '<https://x/un>' }, tracking: true, owner: { u: 'u1', ws: 'w1' },
  });
  assert.equal(m.TrackOpens, true);
  assert.equal(m.TrackLinks, 'HtmlAndText');
  assert.deepEqual(m.Metadata, { u: 'u1', ws: 'w1' });
  assert.deepEqual(m.Headers, [{ Name: 'List-Unsubscribe', Value: '<https://x/un>' }]);
  const plain = buildPostmarkMessage({ from: 'f', to: 't', subject: 's', text: 't', tracking: false, owner: { u: 'u1', ws: 'w1' } });
  assert.equal(plain.TrackOpens, false);
  assert.equal(plain.TrackLinks, 'None');
  assert.equal(plain.HtmlBody, undefined);
});
