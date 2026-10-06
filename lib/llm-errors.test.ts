import test from 'node:test';
import assert from 'node:assert/strict';
import { friendlyLlmError, isRetryableLlmStatus, LLM_MAX_ATTEMPTS, llmRetryDelayMs } from './borga/llm-errors';

test('transient upstream statuses are retried; client errors are not', () => {
  for (const s of [429, 500, 502, 503, 529]) assert.equal(isRetryableLlmStatus(s), true, String(s));
  for (const s of [200, 400, 401, 403, 404, 422]) assert.equal(isRetryableLlmStatus(s), false, String(s));
});

test('retry budget is bounded', () => {
  assert.equal(LLM_MAX_ATTEMPTS, 3);
  assert.ok(llmRetryDelayMs(1) > 0 && llmRetryDelayMs(2) >= llmRetryDelayMs(1));
});

test('a provider-side disk-full 500 names the outage instead of dumping JSON', () => {
  const msg = friendlyLlmError(
    'Pollinations',
    500,
    '{"error":"ENOSPC: no space left on device, write","status":500,"deprecation_notice":"NOTE: ..."}',
  );
  assert.match(msg, /Pollinations is temporarily down/);
  assert.match(msg, /ENOSPC/);
  assert.match(msg, /Integrations → AI & Voice/);
  assert.ok(msg.length < 400, 'message stays short instead of dumping the whole upstream body');
});

test('rate limits suggest waiting or adding a key', () => {
  const msg = friendlyLlmError('LLM7', 429, '{"error":"rate limited"}');
  assert.match(msg, /rate limiting/);
  assert.match(msg, /API key/);
});

test('auth failures point at the key, other errors stay short', () => {
  assert.match(friendlyLlmError('Groq', 401, 'invalid api key'), /API key/);
  const long = friendlyLlmError('Groq', 400, `x${'y'.repeat(500)}`);
  assert.ok(long.length < 300, 'upstream bodies are truncated');
  assert.match(friendlyLlmError('Groq', 503, ''), /Try again shortly/);
});
