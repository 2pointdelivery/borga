import { json, varchar, datetime, mysqlTable } from 'drizzle-orm/mysql-core';

// Borga persists each domain collection as a JSON document keyed by entity name.
// This keeps the app's schema flexible while still being genuinely DB-backed.
export const borgaState = mysqlTable('borga_state', {
  key: varchar('key', { length: 255 }).primaryKey(),
  value: json('value').notNull(),
  updatedAt: datetime('updated_at').notNull(),
});

export type BorgaStateRow = typeof borgaState.$inferSelect;
