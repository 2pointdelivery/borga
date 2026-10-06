import test from 'node:test';
import assert from 'node:assert/strict';
import { AllModelsFailed, ProviderHealth, classifyFailure, planOrder, runWithFallback, statusOf, type Candidate } from './borga/llm-fallback-core';

const cand = (providerId: string, model = 'm'): Candidate => ({ providerId, model, apiKey: 'k', baseUrl: 'https://x' });
const keyOf = (c: Candidate) => `t|${c.providerId}`;
const A = cand('llm-groq'), B = cand('llm-openrouter'), C = cand('llm-gemini');

test('the status is read out of provider error messages', () => {
  assert.equal(statusOf('Groq is rate limiting requests right now (429)'), 429);
  assert.equal(statusOf('OpenRouter returned an error (402): {}'), 402);
  assert.equal(statusOf('Groq is temporarily down (upstream 503: overloaded)'), 503);
  assert.equal(statusOf('something odd'), null);
});

test('failures are classified, and problems that do not fix themselves wait longest', () => {
  assert.equal(classifyFailure('Groq is rate limiting requests right now (429)').kind, 'rate-limit');
  assert.equal(classifyFailure('Pollinations now asks for an API key or payment before it will answer (402).').kind, 'payment');
  assert.equal(classifyFailure('Groq refused the request (401). Check the API key').kind, 'auth');
  assert.equal(classifyFailure("Muse's address was refused: Only https:// URLs are allowed.").kind, 'refused');
  assert.equal(classifyFailure('X is temporarily down (upstream 503)').kind, 'outage');
  assert.equal(classifyFailure('fetch failed').kind, 'network');
  assert.equal(classifyFailure('', true).kind, 'empty');
  assert.ok(classifyFailure('refused the request (401)').cooldownMs > classifyFailure('rate limiting (429)').cooldownMs);
  assert.ok(classifyFailure('rate limiting (429)').cooldownMs > classifyFailure('fetch failed').cooldownMs);
});

test('a failing model is skipped until its pause is over, then tried again', () => {
  let t = 1_000_000;
  const h = new ProviderHealth(() => t);
  assert.equal(h.coolingUntil('a'), 0);
  assert.equal(h.fail('a', 60_000, 'rate-limit').newlyDown, true, 'the first failure is news');
  assert.ok(h.coolingUntil('a') > t);
  t += 30_000;
  assert.equal(h.fail('a', 60_000, 'rate-limit').newlyDown, false, 'a repeat while it is already down is not');
  t += 10 * 60_000;
  assert.equal(h.coolingUntil('a'), 0, 'recovered after the pause');
  h.ok('a');
  assert.equal(h.snapshot().length, 0);
});

test('consecutive failures double the pause, capped at 15 minutes', () => {
  let t = 0;
  const h = new ProviderHealth(() => t);
  const until = [1, 2, 3, 4, 5, 6].map(() => { const r = h.fail('a', 60_000, 'rate-limit'); const d = r.until - t; t = r.until + 1; return d; });
  assert.deepEqual(until.slice(0, 3), [60_000, 120_000, 240_000]);
  assert.equal(Math.max(...until), 15 * 60_000);
});

test('the requested model goes first, healthy before paused, one try per provider, and a paused-only list still gets tried', () => {
  const h = new ProviderHealth(() => 0);
  assert.deepEqual(planOrder(A, [B, C], h, keyOf).map((c) => c.providerId), ['llm-groq', 'llm-openrouter', 'llm-gemini']);
  assert.deepEqual(planOrder(A, [A, B, { ...B, model: 'other' }], h, keyOf).map((c) => c.providerId), ['llm-groq', 'llm-openrouter'], 'no duplicates');
  h.fail(keyOf(A), 60_000, 'rate-limit');
  assert.deepEqual(planOrder(A, [B, C], h, keyOf).map((c) => c.providerId), ['llm-openrouter', 'llm-gemini', 'llm-groq'], 'the paused one goes last');
  h.fail(keyOf(B), 10 * 60_000, 'auth');
  h.fail(keyOf(C), 10 * 60_000, 'auth');
  assert.deepEqual(planOrder(A, [B, C], h, keyOf).map((c) => c.providerId), ['llm-groq', 'llm-openrouter', 'llm-gemini'], 'all paused: soonest to recover first');
  assert.equal(planOrder(null, [B, C], new ProviderHealth(() => 0), keyOf).length, 2, 'works with no requested model');
  assert.equal(planOrder(A, [B, C], new ProviderHealth(() => 0), keyOf, 1).length, 1, 'fallback off: one try only');
});

test('when the first model fails the next one answers, and the failure is remembered', async () => {
  const h = new ProviderHealth(() => 0);
  const calls: string[] = [];
  const attempt = async (c: Candidate) => {
    calls.push(c.providerId);
    if (c.providerId === 'llm-groq') throw new Error('Groq is rate limiting requests right now (429)');
    return `answer from ${c.providerId}`;
  };
  const r = await runWithFallback([A, B, C], attempt, h, keyOf);
  assert.equal(r.text, 'answer from llm-openrouter');
  assert.equal(r.switched, true);
  assert.deepEqual(r.failures.map((f) => [f.providerId, f.kind]), [['llm-groq', 'rate-limit']]);
  assert.deepEqual(r.newlyDown.map((f) => f.providerId), ['llm-groq']);
  assert.deepEqual(calls, ['llm-groq', 'llm-openrouter'], 'stops at the first answer');
  // the next request skips the model that just failed
  calls.length = 0;
  const plan = planOrder(A, [B, C], h, keyOf);
  const r2 = await runWithFallback(plan, attempt, h, keyOf);
  assert.equal(r2.used.providerId, 'llm-openrouter');
  assert.deepEqual(calls, ['llm-openrouter'], 'no wasted call on the paused model');
  assert.equal(r2.switched, false, 'it was the first model asked, so nothing switched this time');
});

test('an empty answer counts as a failure', async () => {
  const r = await runWithFallback([A, B], async (c) => (c.providerId === 'llm-groq' ? '   ' : 'real answer'), new ProviderHealth(() => 0), keyOf);
  assert.equal(r.used.providerId, 'llm-openrouter');
  assert.equal(r.failures[0].kind, 'empty');
});

test('a model that answers is healthy again', async () => {
  const h = new ProviderHealth(() => 0);
  h.fail(keyOf(A), 60_000, 'rate-limit');
  const r = await runWithFallback([A], async () => 'back', h, keyOf);
  assert.equal(r.text, 'back');
  assert.equal(h.coolingUntil(keyOf(A)), 0);
});

test('when every model fails the error says which and why', async () => {
  await assert.rejects(
    runWithFallback([A, B], async (c) => { throw new Error(c.providerId === 'llm-groq' ? 'Groq is rate limiting requests right now (429)' : 'OpenRouter refused the request (401)'); }, new ProviderHealth(() => 0), keyOf, (id) => id.replace('llm-', '')),
    (e: unknown) => {
      assert.ok(e instanceof AllModelsFailed);
      assert.match(e.message, /groq \(it is rate limiting requests\)/);
      assert.match(e.message, /openrouter \(it refused the API key\)/);
      assert.equal(e.failures.length, 2);
      return true;
    },
  );
  await assert.rejects(runWithFallback([], async () => 'x', new ProviderHealth(), keyOf), /No AI model is available/);
});

import { looksGarbled } from './borga/llm-fallback-core';

test('a model that no longer exists is replaced by another model of the same provider, and the provider stays healthy', async () => {
  const h = new ProviderHealth(() => 0);
  const gone = 'Groq returned an error (404): {"error":{"message":"The model `llama-3.3-70b-versatile` does not exist or you do not have access to it.","code":"model_not_found"}}';
  assert.equal(classifyFailure(gone).kind, 'model');
  const tried: string[] = [];
  const attempt = async (c: Candidate) => { tried.push(`${c.providerId}:${c.model}`); if (c.model === 'llama-3.3-70b-versatile' || c.model === 'also-gone') throw new Error(gone); return 'ok'; };
  const r = await runWithFallback([cand('llm-groq', 'llama-3.3-70b-versatile'), B], attempt, h, keyOf, undefined, async () => ['also-gone', 'gpt-oss-20b']);
  assert.equal(r.used.providerId, 'llm-groq', 'the same provider answered, with a working model');
  assert.equal(r.used.model, 'gpt-oss-20b');
  assert.deepEqual(tried, ['llm-groq:llama-3.3-70b-versatile', 'llm-groq:also-gone', 'llm-groq:gpt-oss-20b']);
  assert.equal(r.switched, false, 'no other provider was needed');
  assert.equal(h.coolingUntil(keyOf(A)), 0, 'a missing model does not pause a provider whose key works');
});

test('when a provider has no working model left, the next provider answers', async () => {
  const gone = 'X returned an error (404): model_not_found';
  const r = await runWithFallback([A, B], async (c) => { if (c.providerId === 'llm-groq') throw new Error(gone); return 'from openrouter'; }, new ProviderHealth(() => 0), keyOf, undefined, async () => ['m2', 'm3']);
  assert.equal(r.used.providerId, 'llm-openrouter');
  assert.equal(r.failures[0].kind, 'model');
});

test('garbled output is not an answer', async () => {
  assert.equal(looksGarbled('⚔'.repeat(200)), true);
  assert.equal(looksGarbled('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), true);
  assert.equal(looksGarbled('I will read the ticket now and then draft a reply for a person to review before anything is sent.'), false);
  assert.equal(looksGarbled('ok'), false, 'short answers are fine');
  const r = await runWithFallback([A, B], async (c) => (c.providerId === 'llm-groq' ? '⚔'.repeat(200) : 'a real answer'), new ProviderHealth(() => 0), keyOf);
  assert.equal(r.used.providerId, 'llm-openrouter');
  assert.equal(r.failures[0].kind, 'garbled');
});
