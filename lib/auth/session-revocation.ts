import 'server-only';
import { createHash } from 'node:crypto';
import { getBorgaState, setBorgaState } from '@/lib/borga/persistence';

/**
 * Server-side revocation for the stateless session cookie.
 *
 * A token is `<userId>.<expiry>.<signature>` and lives for 30 days, so on its own nothing could end it early. Two things can:
 *   - validFrom: every token issued before this moment is dead (password reset, "sign out everywhere"). The issue time is the
 *     expiry minus the lifetime, so no token format change is needed and existing sessions keep working.
 *   - denied: tokens that were individually signed out, remembered until they would have expired anyway.
 * One small record per user, cached for a few seconds so an authenticated request does not hit the database every time.
 */

interface Record_ { validFrom: number; denied: Array<{ h: string; exp: number }> }

const CACHE_MS = 10_000;
const MAX_DENIED = 50;
const g = globalThis as typeof globalThis & { __borgaSessionRev?: Map<string, { at: number; rec: Record_ }> };
const cache = (g.__borgaSessionRev ??= new Map());

const keyOf = (userId: string) => `auth::sessions::${userId}`;
const hashOf = (token: string) => createHash('sha256').update(token).digest('hex').slice(0, 32);

async function load(userId: string, fresh = false): Promise<Record_> {
  const hit = cache.get(userId);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.rec;
  const stored = await getBorgaState<Record_>(keyOf(userId)).catch(() => null);
  const rec: Record_ = { validFrom: Number(stored?.validFrom) || 0, denied: Array.isArray(stored?.denied) ? stored!.denied : [] };
  cache.set(userId, { at: Date.now(), rec });
  return rec;
}

async function save(userId: string, rec: Record_): Promise<void> {
  const now = Date.now();
  rec.denied = rec.denied.filter((d) => d.exp > now).slice(-MAX_DENIED);
  cache.set(userId, { at: now, rec });
  await setBorgaState(keyOf(userId), rec);
}

/** True when this (otherwise valid) token was signed out or predates the user's last "sign out everywhere". */
export async function isSessionRevoked(userId: string, token: string, expiresAt: number, lifetimeMs: number): Promise<boolean> {
  const rec = await load(userId);
  if (expiresAt - lifetimeMs < rec.validFrom) return true;
  const h = hashOf(token);
  return rec.denied.some((d) => d.h === h);
}

/** Sign out one browser: this token stops working everywhere, immediately. */
export async function revokeToken(userId: string, token: string, expiresAt: number): Promise<void> {
  const rec = await load(userId, true);
  rec.denied.push({ h: hashOf(token), exp: expiresAt });
  await save(userId, rec);
}

/** Sign out every device: all tokens issued up to now stop working. */
export async function revokeAllSessions(userId: string): Promise<void> {
  const rec = await load(userId, true);
  rec.validFrom = Date.now();
  rec.denied = [];
  await save(userId, rec);
}
