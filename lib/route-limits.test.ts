import assert from 'node:assert/strict';
import test from 'node:test';
import { resetRouteLimits, takeRouteLimit } from './borga/route-limits';

test('a mail sender is allowed its quota then throttled with a retry time', () => {
  resetRouteLimits();
  for (let i = 0; i < 30; i++) {
    assert.equal(takeRouteLimit('mail', 'u1/ws').limited, false, `attempt ${i + 1}`);
  }
  const verdict = takeRouteLimit('mail', 'u1/ws');
  assert.equal(verdict.limited, true);
  assert.ok(verdict.retryAfterSec >= 1 && verdict.retryAfterSec <= 3600);
});

test('other sessions and other buckets are unaffected', () => {
  resetRouteLimits();
  for (let i = 0; i < 31; i++) takeRouteLimit('mail', 'u1/ws');
  assert.equal(takeRouteLimit('mail', 'u2/ws').limited, false);
  assert.equal(takeRouteLimit('emailTest', 'u1/ws').limited, false);
});

test('the test-email bucket is tighter than a normal send', () => {
  resetRouteLimits();
  for (let i = 0; i < 10; i++) assert.equal(takeRouteLimit('emailTest', 'u1/ws').limited, false);
  assert.equal(takeRouteLimit('emailTest', 'u1/ws').limited, true);
});
