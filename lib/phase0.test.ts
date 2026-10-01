import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { twilioSignature, verifyMetaSignature, verifyTwilioSignature } from './borga/webhook-signatures';
import { EMPTY_SYNC_STATE, STALE_RUN_MS, afterRun, backoffMs, isDue } from './borga/sync-core';
import { runProviderTest } from './borga/provider-tests';
import { PROVIDERS, maskSecret } from './borga/providers';

test('Meta signature accepts the exact body and rejects tampering or a missing header', () => {
  const body = '{"entry":[{"id":"1"}]}';
  const sig = `sha256=${createHmac('sha256', 's3cret').update(body).digest('hex')}`;
  assert.equal(verifyMetaSignature(body, sig, 's3cret'), true);
  assert.equal(verifyMetaSignature(body + ' ', sig, 's3cret'), false);
  assert.equal(verifyMetaSignature(body, sig, 'other'), false);
  assert.equal(verifyMetaSignature(body, null, 's3cret'), false);
  assert.equal(verifyMetaSignature(body, sig, ''), false);
});

test('Twilio signature follows the documented algorithm (url + sorted params, HMAC-SHA1, base64)', () => {
  // Reference vector from Twilio's security docs.
  const url = 'https://mycompany.com/myapp.php?foo=1&bar=2';
  const params = { CallSid: 'CA1234567890ABCDE', Caller: '+14158675310', Digits: '1234', From: '+14158675310', To: '+18005551212' };
  const sig = twilioSignature(url, params, '12345');
  assert.equal(sig, 'GvWf1cFY/Q7PnoempGyD5oXAezc=');
  assert.equal(verifyTwilioSignature(url, params, sig, '12345'), true);
  assert.equal(verifyTwilioSignature(url, { ...params, Digits: '9999' }, sig, '12345'), false);
  assert.equal(verifyTwilioSignature(url.replace('https', 'http'), params, sig, '12345'), false);
});

test('backoff doubles from 5 minutes and caps at 6 hours', () => {
  assert.equal(backoffMs(1), 5 * 60_000);
  assert.equal(backoffMs(2), 10 * 60_000);
  assert.equal(backoffMs(3), 20 * 60_000);
  assert.equal(backoffMs(30), 6 * 3_600_000);
});

test('job state: success resets failures, failure schedules a retry, running guard expires', () => {
  const t0 = Date.UTC(2026, 9, 1, 12);
  const failed = afterRun(EMPTY_SYNC_STATE, false, 'boom', 3_600_000, t0);
  assert.equal(failed.failures, 1);
  assert.equal(isDue(failed, t0 + 60_000), false);
  assert.equal(isDue(failed, t0 + 5 * 60_000), true);
  const failedTwice = afterRun(failed, false, 'boom', 3_600_000, t0);
  assert.equal(failedTwice.failures, 2);
  const ok = afterRun(failedTwice, true, null, 3_600_000, t0);
  assert.equal(ok.failures, 0);
  assert.equal(ok.lastError, null);
  assert.equal(isDue(ok, t0 + 3_599_000), false);
  assert.equal(isDue(ok, t0 + 3_600_000), true);
  const running = { ...EMPTY_SYNC_STATE, runningSince: new Date(t0).toISOString() };
  assert.equal(isDue(running, t0 + 1000), false);
  assert.equal(isDue(running, t0 + STALE_RUN_MS + 1), true);
});

const reply = (status: number, json: unknown) => async () => new Response(JSON.stringify(json), { status });

test('Twilio test: bad credentials, wrong number, success', async () => {
  const v = { accountSid: 'AC' + 'a'.repeat(32), authToken: 'b'.repeat(32), phoneNumber: '+14155550100' };
  assert.equal((await runProviderTest('twilio', v, reply(401, {}) as typeof fetch)).ok, false);
  const calls: string[] = [];
  const f = (async (url: string) => {
    calls.push(String(url));
    return String(url).includes('IncomingPhoneNumbers')
      ? new Response(JSON.stringify({ incoming_phone_numbers: [] }), { status: 200 })
      : new Response(JSON.stringify({ status: 'active', type: 'Full' }), { status: 200 });
  }) as typeof fetch;
  const wrongNumber = await runProviderTest('twilio', v, f);
  assert.equal(wrongNumber.ok, false);
  assert.match(wrongNumber.message, /not a number on this Twilio account/);
  const f2 = (async (url: string) =>
    String(url).includes('IncomingPhoneNumbers')
      ? new Response(JSON.stringify({ incoming_phone_numbers: [{}] }), { status: 200 })
      : new Response(JSON.stringify({ status: 'active', type: 'Full' }), { status: 200 })) as typeof fetch;
  assert.equal((await runProviderTest('twilio', v, f2)).ok, true);
});

test('Meta test reports asset-level failures; Google needs OAuth then customer access; ChatGPT Ads is honest', async () => {
  const meta = { appId: '12345', appSecret: 'x', accessToken: 't', adAccountId: '999999' };
  const f = (async (url: string) =>
    String(url).includes('/act_999999') ? new Response(JSON.stringify({ error: { message: 'no access' } }), { status: 403 }) : new Response(JSON.stringify({ id: '1', name: 'Sys' }), { status: 200 })) as typeof fetch;
  const m = await runProviderTest('meta', meta, f);
  assert.equal(m.ok, false);
  assert.match(m.details!.join(' '), /Ad account not accessible: no access/);

  const g = { developerToken: 'd', clientId: 'c', clientSecret: 's', refreshToken: 'r', customerId: '123-456-7890' };
  const badOauth = (async () => new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Token revoked' }), { status: 400 })) as typeof fetch;
  assert.match((await runProviderTest('google_ads', g, badOauth)).message, /Token revoked/);
  const good = (async (url: string) =>
    String(url).includes('oauth2') ? new Response(JSON.stringify({ access_token: 'a' }), { status: 200 }) : new Response(JSON.stringify({ resourceNames: ['customers/1234567890'] }), { status: 200 })) as typeof fetch;
  assert.equal((await runProviderTest('google_ads', g, good)).ok, true);

  assert.equal((await runProviderTest('chatgpt_ads', { apiKey: 'k' })).ok, false);
});

test('network failures become readable results, never throws', async () => {
  const boom = (async () => {
    throw new Error('ECONNRESET');
  }) as typeof fetch;
  const r = await runProviderTest('linkedin', { clientId: 'a', clientSecret: 'b', accessToken: 'c', adAccountId: '1234' }, boom);
  assert.equal(r.ok, false);
  assert.match(r.message, /ECONNRESET/);
});

test('provider registry: required fields are unique and secrets are masked', () => {
  for (const p of PROVIDERS) assert.equal(new Set(p.fields.map((f) => f.key)).size, p.fields.length);
  assert.equal(maskSecret('abcd1234efgh'), '••••efgh');
  assert.equal(maskSecret('short'), '••••');
});

import { isPrivateIp, assertPublicHttpsUrl } from './borga/safe-url';

test('SSRF guard blocks private, loopback, link-local and non-https targets', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111']) assert.equal(isPrivateIp(ip), false, ip);
  await assert.rejects(() => assertPublicHttpsUrl('http://example.com/hook'), /https/);
  await assert.rejects(() => assertPublicHttpsUrl('https://127.0.0.1/hook'), /private/);
  await assert.rejects(() => assertPublicHttpsUrl('https://[::1]/hook'), /private/);
  await assert.rejects(() => assertPublicHttpsUrl('https://169.254.169.254/latest/meta-data'), /private/);
  await assert.rejects(() => assertPublicHttpsUrl('https://localhost/hook'), /private/);
});

test('Supermemory connection test: rejected key, rate limit, success', async () => {
  assert.equal((await runProviderTest('supermemory', { apiKey: 'k' }, reply(401, {}) as typeof fetch)).ok, false);
  assert.match((await runProviderTest('supermemory', { apiKey: 'k' }, reply(429, {}) as typeof fetch)).message, /rate limited/);
  assert.equal((await runProviderTest('supermemory', { apiKey: 'k' }, reply(200, { memories: [], pagination: {} }) as typeof fetch)).ok, true);
});
