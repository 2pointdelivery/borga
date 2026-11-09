import { createHash, timingSafeEqual } from 'crypto';
import { isValidWsId } from './keys';

/**
 * User API keys for the public Borga API (Authorization: Bearer borga_...).
 * Pure helpers (no I/O, no server-only imports) so they can be unit tested;
 * storage lives in lib/borga/api-keys-server.ts. Only the sha256 hash is ever
 * stored; the secret itself is shown once at creation and can never be read back.
 */

export const API_KEY_PREFIX = 'borga_';

export interface ApiKeyRecord {
  id: string;
  name: string;
  /** First characters of the secret (borga_…xxxx) so the owner can recognise it. */
  prefix: string;
  hash: string;
  /** Workspace ids this key may access. */
  wsIds: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  /** Optional expiry (ISO date). An expired key verifies as invalid — rotation without revocation. */
  expiresAt?: string | null;
}

export type ApiKeyPublic = Omit<ApiKeyRecord, 'hash'>;

/** An expired key verifies as invalid — expiry is a silent revoke for rotation. Pure. */
export function isExpiredKey(r: Pick<ApiKeyRecord, 'expiresAt'>, nowIso = new Date().toISOString()): boolean {
  return !!r.expiresAt && r.expiresAt.slice(0, 10) <= nowIso.slice(0, 10);
}

export function hashApiKey(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

/** Parses an Authorization header into the raw secret, or null. */
export function parseBearerSecret(header: string | null): string | null {
  if (!header) return null;
  const m = /^\s*Bearer\s+(\S+)\s*$/i.exec(header);
  if (!m || !m[1].startsWith(API_KEY_PREFIX)) return null;
  return m[1];
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function toPublic(r: ApiKeyRecord): ApiKeyPublic {
  // Explicit allowlist (not a rest spread) so a future sensitive field can never leak by accident.
  return { id: r.id, name: r.name, prefix: r.prefix, wsIds: r.wsIds, createdAt: r.createdAt, lastUsedAt: r.lastUsedAt, revokedAt: r.revokedAt, expiresAt: r.expiresAt ?? null };
}

/**
 * A key is only as good as the account behind it. `userGone` is injected (and uncached) so a deleted owner is refused on
 * the very next call; a database error there fails open so an outage cannot revoke every key holder at once. Pure, so both
 * behaviours are unit-tested.
 */
export async function keyOwnerAllowed<T extends { userId: string }>(
  hit: T | null,
  userGone: (userId: string) => Promise<boolean>,
): Promise<boolean> {
  if (!hit) return false;
  try {
    return !(await userGone(hit.userId));
  } catch {
    return true;
  }
}

/**
 * Storage for the verification loop, injected so the deleted-owner rule is
 * tested without a database. The server module owns the real lookup.
 */
export interface ApiKeyLookup {
  /** Every user id that has an API-key entry. */
  owners(): Promise<string[]>;
  /** Stored keys for one owner. */
  keysOf(userId: string): Promise<ApiKeyRecord[]>;
  /** True when the account behind the key no longer exists (must be uncached). */
  userGone(userId: string): Promise<boolean>;
}

/**
 * The verification loop: a matched key is only good while its owner still
 * exists, checked immediately before it is accepted (a deleted account must
 * not keep a working credential). A database error fails open via
 * `keyOwnerAllowed`, so an outage cannot revoke every key holder at once.
 */
export async function verifyApiKeyWithLookup(
  secret: string,
  lookup: ApiKeyLookup,
  nowIso = new Date().toISOString(),
): Promise<{ userId: string; key: ApiKeyRecord } | null> {
  const wanted = hashApiKey(secret);
  for (const owner of await lookup.owners()) {
    const rows = await lookup.keysOf(owner);
    for (const r of rows) {
      if (r.revokedAt || isExpiredKey(r, nowIso) || !safeEqual(r.hash, wanted)) continue;
      if (!(await keyOwnerAllowed({ userId: owner }, lookup.userGone))) return null;
      return { userId: owner, key: r };
    }
  }
  return null;
}

/** The ?ws= workspace must be valid and, for API keys, inside the key's scope. */
export function wsAllowed(wsParam: string | null, keyWsIds?: string[]): string | null {
  if (!isValidWsId(wsParam)) return null;
  if (keyWsIds && !keyWsIds.includes(wsParam)) return null;
  return wsParam;
}
