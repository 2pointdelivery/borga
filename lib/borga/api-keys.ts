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
}

export type ApiKeyPublic = Omit<ApiKeyRecord, 'hash'>;

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
  return { id: r.id, name: r.name, prefix: r.prefix, wsIds: r.wsIds, createdAt: r.createdAt, lastUsedAt: r.lastUsedAt, revokedAt: r.revokedAt };
}

/** The ?ws= workspace must be valid and, for API keys, inside the key's scope. */
export function wsAllowed(wsParam: string | null, keyWsIds?: string[]): string | null {
  if (!isValidWsId(wsParam)) return null;
  if (keyWsIds && !keyWsIds.includes(wsParam)) return null;
  return wsParam;
}
