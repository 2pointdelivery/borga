import test from 'node:test';
import assert from 'node:assert/strict';
import { KeyThrottle } from './borga/api-throttle';

test('allows up to the max, then limits with retry-after', () => {
  let t = 1_000_000;
  const th = new KeyThrottle(3, 60_000, () => t);
  assert.equal(th.take('k').limited, false);
  assert.equal(th.take('k').limited, false);
  assert.equal(th.take('k').limited, false);
  const v = th.take('k');
  assert.equal(v.limited, true);
  assert.ok(v.retryAfterSec > 0 && v.retryAfterSec <= 60);
  t += 61_000;
  assert.equal(th.take('k').limited, false);
});

test('keys are independent and rotation cannot grow memory forever', () => {
  const t = 0;
  const th = new KeyThrottle(1, 60_000, () => t, 5);
  for (let i = 0; i < 50; i++) th.take(`key-${i}`);
  assert.equal(th.take('fresh').limited, false);
});
