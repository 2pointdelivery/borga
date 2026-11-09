import test from 'node:test';
import assert from 'node:assert/strict';
import { CLAIM_TTL_MS, claimScheduledSlot, releaseScheduledSlot, type ClaimDeps } from './borga/schedule-claim';

/**
 * In-memory stand-in for `getBorgaRowOrThrow` + `setBorgaStateIfVersion`.
 * `writeIfVersion` refuses when the stored version is not the expected one,
 * which is exactly the guarantee the real optimistic write provides.
 */
function memoryDeps(): ClaimDeps & { rows: Map<string, { value: unknown; version: number }> } {
  const rows = new Map<string, { value: unknown; version: number }>();
  return {
    rows,
    read: async (key) => {
      const row = rows.get(key);
      return row ? { value: structuredClone(row.value), version: row.version } : null;
    },
    writeIfVersion: async (key, value, expected) => {
      const current = rows.get(key)?.version ?? 0;
      if (current !== expected) return { ok: false as const };
      rows.set(key, { value: structuredClone(value), version: current + 1 });
      return { ok: true as const };
    },
  };
}

const KEY = 'u::user-1::ws::ws-1::scheduledClaim::task-1';
const SLOT = 'task-1:2026-11-07T08:00:00.000Z';

test('concurrent beats enqueue a due slot exactly once', async () => {
  const deps = memoryDeps();
  const results = await Promise.all(
    Array.from({ length: 20 }, () => claimScheduledSlot(deps, KEY, SLOT)),
  );
  assert.equal(results.filter(Boolean).length, 1, 'exactly one caller wins the claim');
  assert.equal(deps.rows.size, 1);
});

test('the same slot cannot be claimed twice, a later slot can', async () => {
  const deps = memoryDeps();
  assert.equal(await claimScheduledSlot(deps, KEY, SLOT), true);
  assert.equal(await claimScheduledSlot(deps, KEY, SLOT), false, 'second beat is refused');
  assert.equal(await claimScheduledSlot(deps, KEY, 'task-1:2026-11-08T08:00:00.000Z'), true, 'next occurrence is fine');
});

test('a stale claim can be retaken, but only by one caller', async () => {
  const deps = memoryDeps();
  const t0 = Date.now();
  assert.equal(await claimScheduledSlot(deps, KEY, SLOT, t0), true);
  assert.equal(await claimScheduledSlot(deps, KEY, SLOT, t0 + CLAIM_TTL_MS + 1), true, 'stale claim does not wedge the task');
  const later = t0 + 3 * CLAIM_TTL_MS;
  const results = await Promise.all(
    Array.from({ length: 10 }, () => claimScheduledSlot(deps, KEY, SLOT, later)),
  );
  assert.equal(results.filter(Boolean).length, 1, 'retaking a stale claim is still single-winner');
});

test('a failed enqueue releases the claim so the next beat retries', async () => {
  const deps = memoryDeps();
  assert.equal(await claimScheduledSlot(deps, KEY, SLOT), true);
  assert.equal(await claimScheduledSlot(deps, KEY, SLOT), false);
  assert.equal(await releaseScheduledSlot(deps, KEY, SLOT), true);
  assert.equal(await claimScheduledSlot(deps, KEY, SLOT), true);
});

test('releasing only affects the matching slot', async () => {
  const deps = memoryDeps();
  assert.equal(await claimScheduledSlot(deps, KEY, SLOT), true);
  assert.equal(await releaseScheduledSlot(deps, KEY, 'task-1:other-slot'), false);
  assert.equal(await claimScheduledSlot(deps, KEY, SLOT), false, 'the live claim is untouched');
});
