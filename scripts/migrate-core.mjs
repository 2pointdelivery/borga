// Pure helpers for scripts/migrate.mjs (no I/O), so they can be unit tested.
import { createHash } from 'node:crypto';

/** drizzle writes `--> statement-breakpoint` between statements; a migration file is run statement by statement. */
export function splitStatements(sql) {
  return sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Same hash drizzle-kit stores in __drizzle_migrations.hash, so the two tools can share one history table. */
export function hashMigration(sql) {
  return createHash('sha256').update(sql).digest('hex');
}

/**
 * Which journal entries still have to run. drizzle orders by the `when` timestamp: anything newer than the latest
 * recorded migration is pending.
 */
export function pendingMigrations(journalEntries, lastAppliedAt) {
  const last = lastAppliedAt == null ? -Infinity : Number(lastAppliedAt);
  return [...journalEntries].filter((e) => Number(e.when) > last).sort((a, b) => Number(a.when) - Number(b.when));
}

/** Readable list for the duplicate-email abort message. */
export function formatDuplicates(rows) {
  return rows.map((r) => `  ${r.e} (${r.n} accounts)`).join('\n');
}

export const UNIQUE_EMAIL_MIGRATION = '0001_windy_pestilence';

/** What a finished schema must look like; checked after migrating so a silent partial result fails loudly. */
export const EXPECTED = {
  tables: ['borga_users', 'borga_state'],
  userColumns: ['id', 'email', 'name', 'password_hash', 'reset_token', 'reset_token_expires', 'created_at'],
  uniqueEmailIndex: 'idx_users_email',
};

/** Checks a snapshot of the live schema ({tables, userColumns, emailIndexes:[{name, unique}]}) against EXPECTED. */
export function verifySchema(snapshot) {
  const problems = [];
  for (const t of EXPECTED.tables) if (!snapshot.tables.includes(t)) problems.push(`table ${t} is missing`);
  for (const c of EXPECTED.userColumns) if (!snapshot.userColumns.includes(c)) problems.push(`borga_users.${c} is missing`);
  const idx = snapshot.emailIndexes.find((i) => i.name === EXPECTED.uniqueEmailIndex);
  if (!idx) problems.push(`index ${EXPECTED.uniqueEmailIndex} is missing`);
  else if (!idx.unique) problems.push(`index ${EXPECTED.uniqueEmailIndex} exists but is not unique`);
  return problems;
}
