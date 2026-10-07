import { json, varchar, datetime, bigint, mysqlTable } from 'drizzle-orm/mysql-core';

// Borga persists each domain collection as a JSON document keyed by entity name.
// This keeps the app's schema flexible while still being genuinely DB-backed.
export const borgaState = mysqlTable('borga_state', {
  key: varchar('key', { length: 255 }).primaryKey(),
  value: json('value').notNull(),
  updatedAt: datetime('updated_at').notNull(),
  // Bumped on every write. The dashboard saves with the version it last read; a stale save is refused (409) instead of
  // silently overwriting a newer one made in another tab, on another device, or by an agent.
  version: bigint('version', { mode: 'number', unsigned: true }).notNull().default(1),
});

export type BorgaStateRow = typeof borgaState.$inferSelect;
