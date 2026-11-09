// Live two-process scheduled-claim race. Needs the app's MySQL (DATABASE_URL,
// read from .env if present) and an existing `borga_state` table:
//
//   pnpm test:claim-concurrency
//
// Two separate Node processes start at the same instant and both call the real
// claimScheduledSlot for the same due slots, backed by the real borga_state
// optimistic write. Each winner records one "enqueue" row. The test fails if a
// slot is enqueued twice, if any slot is missed, or if a worker errors.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('Set DATABASE_URL (or put it in .env) to run the live scheduled-claim test.');
}

const tag = randomBytes(4).toString('hex');
const table = `borga_claim_probe_${tag}`;
const prefix = `u::claim-${tag}::ws::ws-${tag}::scheduledClaim::`;
const SLOTS = 40;
const SLOT_TIME = '2026-11-08T08:00:00.000Z';
const workerPath = path.resolve('scripts/scheduled-claim-worker.ts');

let db;

function runWorker(workerId, startAt) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', workerPath, workerId], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL,
        CLAIM_PREFIX: prefix,
        CLAIM_TABLE: table,
        CLAIM_SLOTS: String(SLOTS),
        CLAIM_SLOT_TIME: SLOT_TIME,
        CLAIM_START_AT: String(startAt),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${workerId} exited ${code}: ${(err || out).slice(-1200)}`));
        return;
      }
      const line = out.split(/\r?\n/).find((l) => l.startsWith('__RESULT__'));
      if (!line) {
        reject(new Error(`${workerId} printed no result: ${(out + err).slice(-1200)}`));
        return;
      }
      resolve(JSON.parse(line.slice('__RESULT__'.length)));
    });
  });
}

before(async () => {
  db = await mysql.createConnection(DATABASE_URL);
  await db.query(`CREATE TABLE ${table} (slot VARCHAR(191) PRIMARY KEY, worker VARCHAR(32) NOT NULL)`);
});

after(async () => {
  if (!db) return;
  await db.query('DELETE FROM borga_state WHERE `key` LIKE ?', [`${prefix}%`]);
  await db.query(`DROP TABLE IF EXISTS ${table}`);
  await db.end();
});

test('two processes racing the scheduled claim enqueue each due slot exactly once', async () => {
  const startAt = Date.now() + 1500;
  const results = await Promise.all([runWorker('A', startAt), runWorker('B', startAt)]);
  const [a, b] = results;

  assert.deepEqual([...a.errors, ...b.errors], [], 'no worker hit an error');
  assert.equal(a.duplicates + b.duplicates, 0, 'a slot was enqueued more than once');
  assert.equal(a.enqueued + b.enqueued, SLOTS, 'every due slot was enqueued exactly once');

  const [rows] = await db.query(`SELECT slot, COUNT(*) AS n FROM ${table} GROUP BY slot ORDER BY slot`);
  assert.equal(rows.length, SLOTS, 'one enqueue row per due slot');
  assert.equal(rows.filter((r) => Number(r.n) !== 1).length, 0, 'no slot has more than one enqueue');

  const [claims] = await db.query('SELECT `key` FROM borga_state WHERE `key` LIKE ?', [`${prefix}%`]);
  assert.equal(claims.length, SLOTS, 'one claim row per scheduled task');
});
