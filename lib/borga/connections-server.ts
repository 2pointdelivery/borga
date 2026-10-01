import 'server-only';
import { randomBytes } from 'crypto';
import { getBorgaState, setBorgaState, deleteBorgaState, listBorgaKeys } from './persistence';
import { encryptSecret, decryptSecret } from './secrets';
import { PROVIDERS, getProvider, maskSecret, type ProviderDef, type ProviderId } from './providers';
import { runProviderTest, type TestResult } from './provider-tests';
import { invalidateSmContext } from './sm-cache';

/**
 * Per-user, per-workspace integration credentials, encrypted at rest (AES-256-GCM,
 * same key as the global secret store). Lives under `c::` so the dashboard's bulk
 * hydrate never loads it. Plain values never leave the server.
 */

interface StoredConnection {
  enc: string; // encrypted JSON of field values
  updatedAt: string;
  /** Webhook challenge token we generate (Meta); not a credential. */
  verifyToken?: string;
  lastTest?: TestResult & { at: string };
}

const connKey = (u: string, ws: string, id: ProviderId) => `c::${u}::${ws}::${id}`;

function readValues(stored: StoredConnection | null): Record<string, string> {
  if (!stored) return {};
  try {
    return JSON.parse(decryptSecret(stored.enc) || '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

/** Decrypted credentials for server-side use (sync jobs, webhooks, calls). */
export async function getConnection(u: string, ws: string, id: ProviderId): Promise<Record<string, string> | null> {
  const stored = await getBorgaState<StoredConnection>(connKey(u, ws, id));
  const values = readValues(stored);
  return Object.keys(values).length ? values : null;
}

export async function getVerifyToken(u: string, ws: string, id: ProviderId): Promise<string | null> {
  return (await getBorgaState<StoredConnection>(connKey(u, ws, id)))?.verifyToken ?? null;
}

export interface FieldStatus {
  key: string;
  /** Masked for secrets, plain for non-secrets, empty when unset. */
  display: string;
  set: boolean;
}

export interface ConnectionStatus {
  provider: ProviderId;
  configured: boolean;
  missing: string[];
  fields: FieldStatus[];
  updatedAt: string | null;
  verifyToken: string | null;
  lastTest: (TestResult & { at: string }) | null;
}

function toStatus(def: ProviderDef, stored: StoredConnection | null): ConnectionStatus {
  const values = readValues(stored);
  const fields = def.fields.map((f) => {
    const v = values[f.key] ?? '';
    return { key: f.key, set: !!v, display: !v ? '' : f.secret ? maskSecret(v) : v };
  });
  const missing = def.fields.filter((f) => f.required && !values[f.key]).map((f) => f.key);
  return {
    provider: def.id,
    configured: !!stored && missing.length === 0,
    missing,
    fields,
    updatedAt: stored?.updatedAt ?? null,
    verifyToken: stored?.verifyToken ?? null,
    lastTest: stored?.lastTest ?? null,
  };
}

export async function listConnectionStatuses(u: string, ws: string): Promise<ConnectionStatus[]> {
  return Promise.all(PROVIDERS.map(async (p) => toStatus(p, await getBorgaState<StoredConnection>(connKey(u, ws, p.id)))));
}

/** Validates against the provider's field patterns. Returns an error message or null. */
export function validateValues(def: ProviderDef, values: Record<string, string>): string | null {
  for (const f of def.fields) {
    const v = values[f.key];
    if (v === undefined || v === '') continue;
    if (v.length > 2048) return `${f.label} is too long.`;
    if (f.pattern && !new RegExp(f.pattern).test(v)) return `${f.label} is not in the expected format.`;
  }
  return null;
}

/**
 * Merge-save. A blank value for an existing secret keeps the stored one; an
 * explicit `clear` list removes fields. Required fields must be present after the merge.
 */
export async function saveConnection(
  u: string,
  ws: string,
  id: ProviderId,
  incoming: Record<string, string>,
  clear: string[] = [],
): Promise<{ ok: true; status: ConnectionStatus } | { ok: false; error: string }> {
  const def = getProvider(id);
  if (!def) return { ok: false, error: 'Unknown provider' };
  const allowed = new Set(def.fields.map((f) => f.key));
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(incoming)) if (allowed.has(k) && typeof v === 'string') cleaned[k] = v.trim();
  const err = validateValues(def, cleaned);
  if (err) return { ok: false, error: err };

  const existing = await getBorgaState<StoredConnection>(connKey(u, ws, id));
  const merged = { ...readValues(existing) };
  for (const [k, v] of Object.entries(cleaned)) if (v !== '') merged[k] = v;
  for (const k of clear) delete merged[k];
  const missing = def.fields.filter((f) => f.required && !merged[f.key]).map((f) => f.label);
  if (missing.length) return { ok: false, error: `Missing required: ${missing.join(', ')}` };

  const stored: StoredConnection = {
    enc: encryptSecret(JSON.stringify(merged)),
    updatedAt: new Date().toISOString(),
    verifyToken: existing?.verifyToken ?? (def.webhook === 'meta' ? randomBytes(16).toString('hex') : undefined),
  };
  await setBorgaState(connKey(u, ws, id), stored);
  if (id === 'supermemory') invalidateSmContext(u, ws);
  return { ok: true, status: toStatus(def, stored) };
}

export async function deleteConnection(u: string, ws: string, id: ProviderId): Promise<boolean> {
  if (id === 'supermemory') invalidateSmContext(u, ws);
  return deleteBorgaState(connKey(u, ws, id));
}

export async function testConnection(u: string, ws: string, id: ProviderId): Promise<TestResult & { at: string }> {
  const stored = await getBorgaState<StoredConnection>(connKey(u, ws, id));
  const values = readValues(stored);
  const def = getProvider(id);
  let result: TestResult;
  if (!stored || !def || def.fields.some((f) => f.required && !values[f.key])) result = { ok: false, message: 'Save all required fields first.' };
  else if (id === 'company_engine') {
    // Company API: guarded, paginated client (same code the CRM pull uses).
    const { engineConfigFrom, testEngine } = await import('./engine-http');
    const cfg = engineConfigFrom(values);
    result = cfg ? await testEngine(cfg) : { ok: false, message: 'Save the API base URL first.' };
  } else result = await runProviderTest(id, values);
  const withTime = { ...result, at: new Date().toISOString() };
  if (stored) await setBorgaState(connKey(u, ws, id), { ...stored, lastTest: withTime });
  return withTime;
}

/** Cron enumeration: workspaces that have any connection. */
export async function listConnectionWorkspaces(): Promise<Array<{ userId: string; ws: string }>> {
  const seen = new Set<string>();
  const out: Array<{ userId: string; ws: string }> = [];
  const add = (userId: string, ws: string) => {
    if (seen.has(`${userId}/${ws}`)) return;
    seen.add(`${userId}/${ws}`);
    out.push({ userId, ws });
  };
  for (const k of await listBorgaKeys('c::%')) {
    const m = /^c::([^:]+)::([^:]+)::[a-z_]+$/.exec(k);
    if (m) add(m[1], m[2]);
  }
  // A workspace that switched a feature on has a features row even without any saved connection
  // (e.g. Supermemory using the deployment-wide key).
  for (const k of await listBorgaKeys('u::%::ws::%::features')) {
    const m = /^u::([^:]+)::ws::([^:]+)::features$/.exec(k);
    if (m) add(m[1], m[2]);
  }
  // Workspaces with email updates configured (the digest job must reach them).
  for (const k of await listBorgaKeys('u::%::ws::%::emailSettings')) {
    const m = /^u::([^:]+)::ws::([^:]+)::emailSettings$/.exec(k);
    if (m) add(m[1], m[2]);
  }
  return out;
}
