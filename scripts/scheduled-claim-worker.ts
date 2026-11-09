/**
 * One contender in the live two-process scheduled-claim race.
 *
 * It imports the real `claimScheduledSlot` and backs its injected storage with
 * the real `borga_state` table, so the optimistic write (insert-if-absent /
 * update-where-version) is exercised against MySQL itself, not an in-memory
 * stand-in. A win is recorded in the probe table the parent creates; that row
 * is the "enqueue". Two workers run this at the same instant for the same due
 * slots, and the parent asserts every slot was enqueued exactly once.
 *
 * Environment (set by scheduled-claim-concurrency.test.mjs):
 *   DATABASE_URL, CLAIM_PREFIX, CLAIM_TABLE, CLAIM_SLOTS, CLAIM_SLOT_TIME, CLAIM_START_AT
 */
import mysql from 'mysql2/promise';
import { claimScheduledSlot, type ClaimDeps } from '../lib/borga/schedule-claim';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const workerId = process.argv[2] ?? 'worker';
  const prefix = process.env.CLAIM_PREFIX ?? '';
  const table = process.env.CLAIM_TABLE ?? '';
  const count = Number(process.env.CLAIM_SLOTS ?? '0');
  const slotTime = process.env.CLAIM_SLOT_TIME ?? '';
  const startAt = Number(process.env.CLAIM_START_AT ?? '0');

  if (!/^[a-z0-9_]+$/.test(table)) throw new Error('CLAIM_TABLE must be a plain identifier');
  if (!prefix || !slotTime || !Number.isInteger(count) || count < 1) {
    throw new Error('CLAIM_PREFIX, CLAIM_SLOT_TIME and CLAIM_SLOTS are required');
  }

  const db = await mysql.createConnection(url);

  const deps: ClaimDeps = {
    read: async (key) => {
      const [rows] = await db.query('SELECT value, version FROM borga_state WHERE `key` = ? LIMIT 1', [key]);
      const row = (rows as Array<{ value: unknown; version: number | string }>)[0];
      if (!row) return null;
      return {
        value: typeof row.value === 'string' ? JSON.parse(row.value) : row.value,
        version: Number(row.version),
      };
    },
    writeIfVersion: async (key, value, expected) => {
      const json = JSON.stringify(value);
      if (expected <= 0) {
        const [h] = await db.query(
          'INSERT IGNORE INTO borga_state (`key`, value, updated_at, version) VALUES (?, ?, NOW(), 1)',
          [key, json],
        );
        return (h as { affectedRows?: number }).affectedRows === 1 ? ({ ok: true } as const) : ({ ok: false } as const);
      }
      const [h] = await db.query(
        'UPDATE borga_state SET value = ?, updated_at = NOW(), version = version + 1 WHERE `key` = ? AND version = ?',
        [json, key, expected],
      );
      return (h as { affectedRows?: number }).affectedRows === 1 ? ({ ok: true } as const) : ({ ok: false } as const);
    },
  };

  // Start both workers together so the first reads and writes truly overlap.
  const pause = startAt - Date.now();
  if (pause > 0) await new Promise((r) => setTimeout(r, pause));

  let enqueued = 0;
  let duplicates = 0;
  let lost = 0;
  const errors: string[] = [];

  for (let i = 0; i < count; i++) {
    const taskId = `task-${String(i).padStart(3, '0')}`;
    const slot = `${taskId}:${slotTime}`;
    const key = `${prefix}${taskId}`;
    try {
      // A little jitter keeps the two processes interleaving on every key rather
      // than marching through the list in lockstep.
      if (i % 4 === 0) await new Promise((r) => setTimeout(r, Math.random() * 2));
      const won = await claimScheduledSlot(deps, key, slot);
      if (!won) {
        lost += 1;
        continue;
      }
      const [h] = await db.query(`INSERT IGNORE INTO ${table} (slot, worker) VALUES (?, ?)`, [slot, workerId]);
      if ((h as { affectedRows?: number }).affectedRows === 1) enqueued += 1;
      else duplicates += 1;
    } catch (error) {
      errors.push(`${taskId}: ${(error as Error)?.message ?? String(error)}`);
    }
  }

  await db.end();
  console.log(`__RESULT__${JSON.stringify({ workerId, enqueued, duplicates, lost, errors })}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
