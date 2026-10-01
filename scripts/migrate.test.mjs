// Integration test for scripts/migrate.mjs and drizzle/0001. Needs a MySQL server where DATABASE_URL's user may create databases:
//
//   DATABASE_URL=mysql://user:pass@localhost:3306/anything node --test scripts/migrate.test.mjs
//
// Every scenario runs in its own throwaway database (borga_migtest_*), dropped afterwards.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('Set DATABASE_URL to a MySQL server where the user can create databases.');
const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, 'migrate.mjs');
const realFolder = path.resolve(here, '..', 'drizzle');

const created = [];
const urlFor = (db) => { const u = new URL(adminUrl); u.pathname = `/${db}`; return u.toString(); };

async function newDb() {
  const name = `borga_migtest_${randomBytes(4).toString('hex')}`;
  const admin = await mysql.createConnection(adminUrl);
  await admin.query(`create database \`${name}\` character set utf8mb4`);
  await admin.end();
  created.push(name);
  return { name, url: urlFor(name) };
}

after(async () => {
  const admin = await mysql.createConnection(adminUrl);
  for (const n of created) await admin.query(`drop database if exists \`${n}\``);
  await admin.end();
});

/** Runs the migration script as a real child process, exactly as the container does. */
function run(url, args = [], env = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [script, ...args], { env: { ...process.env, DATABASE_URL: url, ...env } });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code, out }));
  });
}

/** A migrations folder holding only the first migration, to build the "old" schema a real database starts from. */
function onlyFirstMigration() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'borga-mig-'));
  fs.mkdirSync(path.join(dir, 'meta'));
  const journal = JSON.parse(fs.readFileSync(path.join(realFolder, 'meta', '_journal.json'), 'utf8'));
  journal.entries = journal.entries.slice(0, 1);
  fs.writeFileSync(path.join(dir, 'meta', '_journal.json'), JSON.stringify(journal));
  fs.copyFileSync(path.join(realFolder, `${journal.entries[0].tag}.sql`), path.join(dir, `${journal.entries[0].tag}.sql`));
  return dir;
}

async function q(url, sql, params) {
  const c = await mysql.createConnection(url);
  try { return (await c.query(sql, params))[0]; } finally { await c.end(); }
}

const indexInfo = (url) => q(url, "select index_name n, non_unique nu from information_schema.statistics where table_schema = database() and table_name = 'borga_users' and column_name = 'email'");
const columns = async (url) => (await q(url, "select column_name c from information_schema.columns where table_schema = database() and table_name = 'borga_users'")).map((r) => r.c);
const applied = async (url) => (await q(url, 'select count(*) n from `__drizzle_migrations`'))[0].n;

test('a fresh empty database gets the full schema, and a second run changes nothing', async () => {
  const db = await newDb();
  const first = await run(db.url);
  assert.equal(first.code, 0, first.out);
  assert.match(first.out, /schema verified/);
  assert.equal(await applied(db.url), 2);
  const idx = await indexInfo(db.url);
  assert.deepEqual(idx.map((i) => [i.n, Number(i.nu)]), [['idx_users_email', 0]]);
  assert.ok((await columns(db.url)).includes('reset_token'));
  const second = await run(db.url);
  assert.equal(second.code, 0, second.out);
  assert.match(second.out, /up to date/);
  assert.equal(await applied(db.url), 2);
});

test('a database that only has migration 0000 is upgraded, keeping its data', async () => {
  const db = await newDb();
  const old = await run(db.url, [], { MIGRATIONS_DIR: onlyFirstMigration() });
  assert.equal(old.code, 1, 'old-schema run stops at the schema check because 0001 is missing');
  assert.equal(await applied(db.url), 1);
  await q(db.url, "insert into borga_users (id, email, name, password_hash, created_at) values ('u1', 'keep@example.test', 'Keep', 'h', now())");
  const up = await run(db.url);
  assert.equal(up.code, 0, up.out);
  assert.equal((await q(db.url, 'select count(*) n from borga_users'))[0].n, 1);
  assert.deepEqual((await indexInfo(db.url)).map((i) => Number(i.nu)), [0]);
  assert.ok((await columns(db.url)).includes('reset_token_expires'));
});

test("the state of the real development database (0000 recorded, reset columns already added by hand, plain email index) migrates cleanly", async () => {
  const db = await newDb();
  await run(db.url, [], { MIGRATIONS_DIR: onlyFirstMigration() });
  await q(db.url, 'alter table borga_users add reset_token varchar(255) default null, add reset_token_expires datetime default null');
  for (let i = 0; i < 21; i++) await q(db.url, 'insert into borga_users (id, email, name, password_hash, created_at) values (?, ?, ?, ?, now())', [`u${i}`, `user${i}@example.test`, `U${i}`, 'h']);
  assert.deepEqual((await indexInfo(db.url)).map((i) => Number(i.nu)), [1], 'precondition: plain index');
  const r = await run(db.url);
  assert.equal(r.code, 0, r.out);
  assert.equal((await q(db.url, 'select count(*) n from borga_users'))[0].n, 21, 'no rows lost');
  assert.deepEqual((await indexInfo(db.url)).map((i) => Number(i.nu)), [0], 'index is now unique');
  assert.equal(await applied(db.url), 2);
});

test('duplicate emails are refused up front and nothing is changed', async () => {
  const db = await newDb();
  await run(db.url, [], { MIGRATIONS_DIR: onlyFirstMigration() });
  await q(db.url, "insert into borga_users (id, email, name, password_hash, created_at) values ('a', 'Same@Example.test', 'A', 'h', now()), ('b', 'same@example.test', 'B', 'h', now())");
  const r = await run(db.url);
  assert.equal(r.code, 1);
  assert.match(r.out, /same@example\.test \(2 accounts\)/);
  assert.match(r.out, /Nothing was changed/);
  assert.equal(await applied(db.url), 1, '0001 must not be recorded');
  assert.deepEqual((await indexInfo(db.url)).map((i) => [i.n, Number(i.nu)]), [['idx_users_email', 1]], 'the original index is still there');
  assert.ok(!(await columns(db.url)).includes('reset_token'), 'no column was added');
  // After the duplicate is removed the same command succeeds.
  await q(db.url, "delete from borga_users where id = 'b'");
  const fixed = await run(db.url);
  assert.equal(fixed.code, 0, fixed.out);
});

test('the database itself now refuses a second account with the same email, in any letter case', async () => {
  const db = await newDb();
  assert.equal((await run(db.url)).code, 0);
  await q(db.url, "insert into borga_users (id, email, name, password_hash, created_at) values ('a', 'who@example.test', 'A', 'h', now())");
  await assert.rejects(() => q(db.url, "insert into borga_users (id, email, name, password_hash, created_at) values ('b', 'WHO@Example.TEST', 'B', 'h', now())"), /Duplicate entry/);
});

test('--dry-run lists what would run and changes nothing', async () => {
  const db = await newDb();
  const r = await run(db.url, ['--dry-run']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /2 pending/);
  assert.match(r.out, /dry run: nothing changed/);
  assert.equal(await applied(db.url), 0);
  assert.equal((await q(db.url, "select count(*) n from information_schema.tables where table_schema = database() and table_name = 'borga_users'"))[0].n, 0);
});

test('two runs at the same time are serialised and both succeed', async () => {
  const db = await newDb();
  const [a, b] = await Promise.all([run(db.url), run(db.url)]);
  assert.equal(a.code, 0, a.out);
  assert.equal(b.code, 0, b.out);
  assert.equal(await applied(db.url), 2, 'each migration is recorded exactly once');
  assert.deepEqual((await indexInfo(db.url)).map((i) => Number(i.nu)), [0]);
});

test('tables that were not created by these migrations are not overwritten', async () => {
  const db = await newDb();
  await q(db.url, 'create table borga_users (id varchar(36) primary key, email varchar(255) not null)');
  const r = await run(db.url);
  assert.equal(r.code, 1);
  assert.match(r.out, /not created by these migrations/);
});
