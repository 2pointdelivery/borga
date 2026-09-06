import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users, type NewUser, type UserRow } from '@/db/schemas/auth';

export async function createUser(input: { id: string; email: string; name: string; passwordHash: string }): Promise<UserRow> {
  const row: NewUser = {
    id: input.id,
    email: input.email.toLowerCase().trim(),
    name: input.name.trim(),
    passwordHash: input.passwordHash,
    createdAt: new Date(),
  };
  await db.insert(users).values(row).onDuplicateKeyUpdate({
    set: { name: row.name, passwordHash: row.passwordHash },
  });
  const inserted = await getUserByEmail(row.email);
  if (!inserted) throw new Error('Failed to create user');
  return inserted;
}

export async function getUserByEmail(email: string): Promise<UserRow | null> {
  const rows = await db.select().from(users).where(eq(users.email, email.toLowerCase().trim())).limit(1);
  return rows[0] ?? null;
}

export async function getUserById(id: string): Promise<UserRow | null> {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function setResetToken(userId: string, tokenHash: string, expires: Date): Promise<void> {
  await db.update(users).set({ resetToken: tokenHash, resetTokenExpires: expires }).where(eq(users.id, userId));
}

export async function getUserByResetToken(tokenHash: string): Promise<{ id: string; email: string; name: string } | null> {
  const rows = await db
    .select({ id: users.id, email: users.email, name: users.name, resetTokenExpires: users.resetTokenExpires })
    .from(users)
    .where(eq(users.resetToken, tokenHash))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (!row.resetTokenExpires || row.resetTokenExpires.getTime() < Date.now()) return null;
  return { id: row.id, email: row.email, name: row.name };
}

export async function updatePassword(userId: string, passwordHash: string): Promise<void> {
  await db.update(users).set({ passwordHash, resetToken: null, resetTokenExpires: null }).where(eq(users.id, userId));
}
