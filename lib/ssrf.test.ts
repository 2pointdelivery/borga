import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchPublic, readTextCapped } from './borga/safe-url';

const realFetch = globalThis.fetch;
function stubFetch(handler: (url: string) => Response) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const u = String(input);
    calls.push(u);
    return handler(u);
  }) as typeof fetch;
  return calls;
}

test('private, loopback, metadata and IPv6 targets are refused before any request is made', async () => {
  const calls = stubFetch(() => new Response('should not be reached'));
  try {
    for (const u of ['http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.5/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://192.168.1.1/', 'http://2130706433/']) {
      await assert.rejects(() => fetchPublic(u, {}, { allowHttp: true }), /private|internal/i, u);
    }
    assert.deepEqual(calls, []);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('http is refused unless explicitly allowed, and embedded credentials are refused', async () => {
  stubFetch(() => new Response('ok'));
  try {
    await assert.rejects(() => fetchPublic('http://8.8.8.8/'), /https/i);
    await assert.rejects(() => fetchPublic('https://user:pw@8.8.8.8/'), /credentials/i);
    const res = await fetchPublic('http://8.8.8.8/', {}, { allowHttp: true });
    assert.equal(await res.text(), 'ok');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a public page that redirects to an internal address is blocked at the redirect hop', async () => {
  const calls = stubFetch((u) =>
    u.startsWith('https://8.8.8.8')
      ? new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } })
      : new Response('SECRET'),
  );
  try {
    await assert.rejects(() => fetchPublic('https://8.8.8.8/start', {}, { allowHttp: true }), /private|internal/i);
    assert.deepEqual(calls, ['https://8.8.8.8/start']);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('public redirects are followed, with a hop limit', async () => {
  stubFetch((u) =>
    u.endsWith('/a') ? new Response(null, { status: 301, headers: { location: '/b' } }) : u.endsWith('/b') ? new Response('final') : new Response('x'),
  );
  try {
    const res = await fetchPublic('https://8.8.8.8/a');
    assert.equal(await res.text(), 'final');
  } finally {
    globalThis.fetch = realFetch;
  }
  stubFetch(() => new Response(null, { status: 302, headers: { location: '/loop' } }));
  try {
    await assert.rejects(() => fetchPublic('https://8.8.8.8/loop'), /redirects/i);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('readTextCapped stops reading at the limit', async () => {
  const big = new Response('a'.repeat(5000));
  const text = await readTextCapped(big, 1000);
  assert.ok(text.length <= 1000 && text.length > 0);
  assert.equal(await readTextCapped(new Response('hello')), 'hello');
});

test('assertPublicUrl refuses the internal forms a hostname regex misses', async () => {
  const { assertPublicUrl } = await import('./borga/safe-url');
  for (const u of ['http://[::1]/', 'http://169.254.169.254/latest/meta-data/', 'http://2130706433/', 'http://user:pw@8.8.8.8/', 'ftp://8.8.8.8/']) {
    await assert.rejects(() => assertPublicUrl(u, { allowHttp: true }), u);
  }
  await assert.rejects(() => assertPublicUrl('http://8.8.8.8/'), 'plain http is refused unless allowed');
  assert.equal((await assertPublicUrl('https://8.8.8.8/')).hostname, '8.8.8.8');
});
