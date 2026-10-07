#!/usr/bin/env node
// Applies the SQL migrations in ./drizzle to the database in DATABASE_URL.
//
//   node scripts/migrate.mjs             apply pending migrations
//   node scripts/migrate.mjs --dry-run   show what would run, change nothing
//
// Safe to run any number of times and from two places at once (a MySQL named lock serialises runs). It records history
// in drizzle's own __drizzle_migrations table, so `drizzle-kit migrate` and this script agree on what has run.
// Back up first: MySQL DDL is not transactional, so a migration that fails halfway cannot be rolled back (deploy/update.sh
// takes a backup before every update).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { splitStatements, hashMigration, pendingMigrations, formatDuplicates, verifySchema, UNIQUE_EMAIL_MIGRATION } from './migrate-core.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const folder = process.env.MIGRATIONS_DIR ?? path.resolve(here, '..', 'drizzle');
const dryRun = process.argv.includes('--dry-run');
const log = (m) => console.log(`[migrate] ${m}`);

async function connect(url) {
  let lastErr;
  for (let i = 1; i <= 30; i++) {
    try {
      return await mysql.createConnection({ uri: url, multipleStatements: false });
    } catch (e) {
      lastErr = e;
      log(`database not ready (${e.code ?? e.message}), retry ${i}/30`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw lastErr;
}

async function tableExists(conn, name) {
  const [r] = await conn.query('select 1 from information_schema.tables where table_schema = database() and table_name = ? limit 1', [name]);
  return r.length > 0;
}

/** Aborts before any change when the data would make a migration fail halfway. */
async function preflight(conn, tag) {
  if (tag === UNIQUE_EMAIL_MIGRATION && (await tableExists(conn, 'borga_users'))) {
    const [dups] = await conn.query('select lower(email) as e, count(*) as n from borga_users group by lower(email) having n > 1');
    if (dups.length) {
      throw new Error(
        `${tag} makes email unique, but these emails belong to more than one account:\n${formatDuplicates(dups)}\n` +
          'Merge or delete the extra accounts (keep the one people actually use), then run this again. Nothing was changed.',
      );
    }
  }
}

async function schemaSnapshot(conn) {
  const [tables] = await conn.query('select table_name as t from information_schema.tables where table_schema = database()');
  const [cols] = await conn.query("select column_name as c from information_schema.columns where table_schema = database() and table_name = 'borga_users'");
  const [stateCols] = await conn.query("select column_name as c from information_schema.columns where table_schema = database() and table_name = 'borga_state'");
  const [idx] = await conn.query("select distinct index_name as n, non_unique as nu from information_schema.statistics where table_schema = database() and table_name = 'borga_users' and column_name = 'email'");
  return {
    tables: tables.map((r) => r.t),
    userColumns: cols.map((r) => r.c),
    stateColumns: stateCols.map((r) => r.c),
    emailIndexes: idx.map((r) => ({ name: r.n, unique: Number(r.nu) === 0 })),
  };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set.');
  const journal = JSON.parse(fs.readFileSync(path.join(folder, 'meta', '_journal.json'), 'utf8'));

  const conn = await connect(url);
  let locked = false;
  try {
    const [lock] = await conn.query("select get_lock('borga_migrate', 120) as ok");
    locked = lock[0].ok === 1;
    if (!locked) throw new Error('Another migration is running and did not finish within 2 minutes.');

    await conn.query('create table if not exists `__drizzle_migrations` (id serial primary key, hash text not null, created_at bigint)');
    const [last] = await conn.query('select created_at from `__drizzle_migrations` order by created_at desc limit 1');
    const [appliedCount] = await conn.query('select count(*) as n from `__drizzle_migrations`');

    // Tables with no recorded history means the schema was made some other way; replaying CREATE TABLE would fail.
    if (appliedCount[0].n === 0 && (await tableExists(conn, 'borga_users'))) {
      throw new Error('borga_users exists but __drizzle_migrations is empty, so the database was not created by these migrations. Restore a backup into an empty database, or record the baseline by hand, before migrating.');
    }

    const pending = pendingMigrations(journal.entries, last[0]?.created_at ?? null);
    if (!pending.length) {
      log('database is up to date.');
    } else {
      log(`${pending.length} pending: ${pending.map((p) => p.tag).join(', ')}`);
      if (dryRun) {
        log('dry run: nothing changed.');
        return;
      }
      for (const m of pending) {
        await preflight(conn, m.tag);
        const sql = fs.readFileSync(path.join(folder, `${m.tag}.sql`), 'utf8');
        const statements = splitStatements(sql);
        log(`applying ${m.tag} (${statements.length} statements)`);
        for (const [i, st] of statements.entries()) {
          try {
            await conn.query(st);
          } catch (e) {
            throw new Error(`${m.tag}, statement ${i + 1}/${statements.length} failed: ${e.message}\n  ${st.slice(0, 200)}\nThe migration is NOT recorded as applied and earlier statements in it may have run; restore the backup taken before the update.`);
          }
        }
        await conn.query('insert into `__drizzle_migrations` (hash, created_at) values (?, ?)', [hashMigration(sql), m.when]);
        log(`applied ${m.tag}`);
      }
    }

    if (dryRun) return;
    const problems = verifySchema(await schemaSnapshot(conn));
    if (problems.length) throw new Error(`schema check failed after migrating:\n  - ${problems.join('\n  - ')}`);
    log('schema verified (users table, reset-token columns, unique email index, row versions).');
  } finally {
    if (locked) await conn.query("select release_lock('borga_migrate')").catch(() => undefined);
    await conn.end().catch(() => undefined);
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(`[migrate] FAILED: ${e.message}`);
    process.exit(1);
  },
);
