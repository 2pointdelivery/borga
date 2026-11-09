import 'server-only';
import { randomBytes } from 'crypto';
import { getBorgaState, listBorgaKeys, setBorgaState } from './persistence';
import { API_KEY_PREFIX, hashApiKey, isExpiredKey, parseBearerSecret, safeEqual, toPublic, verifyApiKeyWithLookup, type ApiKeyLookup, type ApiKeyPublic, type ApiKeyRecord } from './api-keys';
import { sessionUserGone } from '@/lib/auth/session-guard';

export { API_KEY_PREFIX, hashApiKey, isExpiredKey, parseBearerSecret, safeEqual, toPublic };
export type { ApiKeyPublic, ApiKeyRecord };

const storeKey = (userId: string) => `t::${userId}::apikeys`;

export async function listApiKeys(userId: string): Promise<ApiKeyRecord[]> {
  return (await getBorgaState<ApiKeyRecord[]>(storeKey(userId))) ?? [];
}

export async function createApiKey(
  userId: string,
  name: string,
  wsIds: string[],
  opts: { expiresInDays?: number } = {},
): Promise<{ record: ApiKeyPublic; secret: string }> {
  const secret = `${API_KEY_PREFIX}${randomBytes(24).toString('base64url')}`;
  const now = new Date().toISOString();
  const record: ApiKeyRecord = {
    id: `key-${Date.now().toString(36)}${randomBytes(3).toString('hex')}`,
    name,
    prefix: `${secret.slice(0, 10)}…${secret.slice(-4)}`,
    hash: hashApiKey(secret),
    wsIds,
    createdAt: now,
    lastUsedAt: null,
    revokedAt: null,
    // Optional rotation deadline: after it, the key verifies as invalid without a revoke event.
    expiresAt: opts.expiresInDays && opts.expiresInDays > 0
      ? new Date(Date.now() + opts.expiresInDays * 86_400_000).toISOString().slice(0, 10)
      : null,
  };
  const all = await listApiKeys(userId);
  await setBorgaState(storeKey(userId), [...all, record]);
  return { record: toPublic(record), secret };
}

export async function revokeApiKey(userId: string, id: string): Promise<boolean> {
  const all = await listApiKeys(userId);
  const ix = all.findIndex((k) => k.id === id);
  if (ix < 0 || all[ix].revokedAt) return false;
  all[ix] = { ...all[ix], revokedAt: new Date().toISOString() };
  await setBorgaState(storeKey(userId), all);
  return true;
}

/** One owner key namespace per user; the pure loop decides whether a match is acceptable. */
const apiKeyLookup: ApiKeyLookup = {
  owners: async () => {
    const owners: string[] = [];
    for (const k of await listBorgaKeys('t::%::apikeys')) {
      const m = /^t::([^:]+)::apikeys$/.exec(k);
      if (m) owners.push(m[1]);
    }
    return owners;
  },
  keysOf: async (userId) => (await getBorgaState<ApiKeyRecord[]>(storeKey(userId))) ?? [],
  // The same uncached lookup the cookie path uses, so a deleted owner's key is refused with the ordinary 401 on the next call.
  userGone: sessionUserGone,
};

/** Finds the live key matching a presented secret. Scans owners (acceptable at this scale); compares hashes in constant time.
 *  Revoked and expired keys verify as invalid — an expiry is a silent revoke for rotation. */
export async function verifyApiKey(secret: string, nowIso = new Date().toISOString()): Promise<{ userId: string; key: ApiKeyRecord } | null> {
  return verifyApiKeyWithLookup(secret, apiKeyLookup, nowIso);
}

export async function touchApiKey(userId: string, id: string): Promise<void> {
  const all = await listApiKeys(userId);
  const ix = all.findIndex((k) => k.id === id);
  if (ix < 0) return;
  all[ix] = { ...all[ix], lastUsedAt: new Date().toISOString() };
  await setBorgaState(storeKey(userId), all);
}
