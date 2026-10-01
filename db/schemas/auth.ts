import { varchar, datetime, mysqlTable, uniqueIndex } from 'drizzle-orm/mysql-core';

// Application users. Passwords are stored hashed with scrypt (see lib/auth/password).
export const users = mysqlTable(
  'borga_users',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    email: varchar('email', { length: 255 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    resetToken: varchar('reset_token', { length: 255 }),
    resetTokenExpires: datetime('reset_token_expires'),
    createdAt: datetime('created_at').notNull(),
  },
  (t) => ({
    emailIdx: uniqueIndex('idx_users_email').on(t.email),
  }),
);

export type UserRow = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
