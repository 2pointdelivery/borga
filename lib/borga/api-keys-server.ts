import 'server-only';
import { randomBytes } from 'crypto';
import { getBorgaState, listBorgaKeys, setBorgaState } from './persistence';
import { API_KEY_PREFIX, hashApiKey, parseBearerSecret, safeEqual, toPublic, type ApiKeyPublic, type ApiKeyRecord } from './api-keys';

export { API_KEY_PREFIX, hashApiKey, parseBearerSecret, safeEqual, toPublic };
export type { ApiKeyPublic, ApiKeyRecord };

const storeKey = (userId: string) => `t::${userId}::apikeys`;

export async function listApiKeys(userId: string): Promise<ApiKeyRecord[]> {
  return (await getBorgaState<ApiKeyRecord[]>(storeKey(userId))) ?? [];
}

export async function createApiKey(userId: string, name: string, wsIds: string[]): Promise<{ record: ApiKeyPublic; secret: string }> {
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

/** Finds the live key matching a presented secret. Scans owners (acceptable at this scale); compares hashes in constant time. */
export async function verifyApiKey(secret: string): Promise<{ userId: string; key: ApiKeyRecord } | null> {
  const wanted = hashApiKey(secret);
  for (const k of await listBorgaKeys('t::%::apikeys')) {
    const m = /^t::([^:]+)::apikeys$/.exec(k);
    if (!m) continue;
    const rows = (await getBorgaState<ApiKeyRecord[]>(k)) ?? [];
    for (const r of rows) {
      if (r.revokedAt || !safeEqual(r.hash, wanted)) continue;
      return { userId: m[1], key: r };
    }
  }
  return null;
}

export async function touchApiKey(userId: string, id: string): Promise<void> {
  const all = await listApiKeys(userId);
  const ix = all.findIndex((k) => k.id === id);
  if (ix < 0) return;
  all[ix] = { ...all[ix], lastUsedAt: new Date().toISOString() };
  await setBorgaState(storeKey(userId), all);
}
