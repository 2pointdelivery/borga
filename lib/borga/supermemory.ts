import 'server-only';
import { z } from 'zod';
import { getBorgaState, setBorgaState } from './persistence';
import { userWsKey } from './keys';
import { getConnection } from './connections-server';
import { getApiKey } from './secrets';
import { loadFeatures } from './features-server';
import { RecordStore, type RecordBase } from './records';
import { ctxCache, invalidateSmContext } from './sm-cache';
import {
  OUTBOX_MAX_ATTEMPTS,
  smBase,
  breakerAllows,
  breakerRecord,
  containerTag,
  docPassages,
  flattenProfile,
  outboxDelayMs,
  pickFacts,
  type Breaker,
  type SmAddBody,
  type SmDocHit,
  type SmMemoryHit,
  type SmProfileBucketEntry,
  type SmSource,
} from './supermemory-core';

/**
 * Supermemory integration. Design rules:
 *  - Optional and off by default (feature flag `supermemory`, plus a key). Borga's own stores stay
 *    the source of truth; Supermemory adds semantic recall. Every function here is non-throwing:
 *    when it is off, slow or down, callers get "nothing" and carry on exactly as before.
 *  - One container tag per user+workspace. No cross-tag queries.
 *  - Writes that fail transiently go to an outbox and are retried by a sync job.
 */

export interface SmSettings {
  /** Mirror agent memories and recall them before runs. */
  memory: boolean;
  /** Index the knowledge base and retrieve passages instead of stuffing every entry in. */
  knowledge: boolean;
  /** Index resolved support tickets (contact details redacted) for similar-ticket lookup. */
  tickets: boolean;
  /** Add the "what we know about this company" profile to agent prompts. */
  profile: boolean;
}

export const DEFAULT_SM_SETTINGS: SmSettings = { memory: true, knowledge: true, tickets: false, profile: true };

const settingsKey = (u: string, ws: string) => userWsKey(u, ws, 'smSettings');

export async function loadSmSettings(u: string, ws: string): Promise<SmSettings> {
  return { ...DEFAULT_SM_SETTINGS, ...((await getBorgaState<Partial<SmSettings>>(settingsKey(u, ws))) ?? {}) };
}

export async function saveSmSettings(u: string, ws: string, patch: Partial<SmSettings>): Promise<SmSettings> {
  const next = { ...(await loadSmSettings(u, ws)), ...patch };
  await setBorgaState(settingsKey(u, ws), next);
  invalidateSmContext(u, ws);
  return next;
}

// ---------------------------------------------------------------------------
// Context: is the integration live for this workspace, and with which key?

type SmCtx = { key: string; tag: string; settings: SmSettings };
const CTX_TTL_MS = 10_000;

/** Workspace connection first, then a deployment-wide SUPERMEMORY_API_KEY. */
async function resolveKey(u: string, ws: string): Promise<string> {
  const own = await getConnection(u, ws, 'supermemory');
  return own?.apiKey || (await getApiKey('SUPERMEMORY_API_KEY'));
}

export async function smContext(u: string, ws: string): Promise<SmCtx | null> {
  const ck = `${u}/${ws}`;
  const hit = ctxCache.get(ck);
  if (hit && Date.now() - hit.at < CTX_TTL_MS) return hit.ctx;
  let ctx: SmCtx | null = null;
  try {
    if ((await loadFeatures(u, ws)).flags.supermemory) {
      const key = await resolveKey(u, ws);
      if (key) ctx = { key, tag: containerTag(u, ws), settings: await loadSmSettings(u, ws) };
    }
  } catch {
    ctx = null;
  }
  ctxCache.set(ck, { at: Date.now(), ctx });
  if (ctxCache.size > 500) ctxCache.clear();
  return ctx;
}

/** Context for one data source; null when that source is switched off. */
export async function smFor(u: string, ws: string, source: keyof SmSettings): Promise<SmCtx | null> {
  const ctx = await smContext(u, ws);
  return ctx && ctx.settings[source] ? ctx : null;
}

// ---------------------------------------------------------------------------
// HTTP with timeout + circuit breaker

const breakers = new Map<string, Breaker>();

interface CallResult {
  ok: boolean;
  status: number;
  json?: unknown;
  /** True for network errors, timeouts, 429 and 5xx: worth retrying later. */
  transient: boolean;
  error?: string;
}

export async function smCall(key: string, method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown, timeoutMs = 6000, f: typeof fetch = fetch): Promise<CallResult> {
  const bk = key.slice(-8);
  const state = breakers.get(bk) ?? { failures: 0, openUntil: 0 };
  if (!breakerAllows(state, Date.now())) return { ok: false, status: 0, transient: true, error: 'Supermemory temporarily skipped after repeated failures' };
  try {
    const res = await f(`${smBase()}${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    const transient = res.status === 429 || res.status >= 500;
    breakers.set(bk, breakerRecord(state, !transient, Date.now()));
    return { ok: res.ok, status: res.status, json, transient, error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (e) {
    breakers.set(bk, breakerRecord(state, false, Date.now()));
    return { ok: false, status: 0, transient: true, error: (e as Error).name === 'TimeoutError' ? 'timeout' : (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Outbox: failed writes wait here and are retried by the sync job

const outboxSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  body: z.custom<SmAddBody>(),
  attempts: z.number(),
  nextAttemptAt: z.string(),
  lastError: z.string().optional(),
}) satisfies z.ZodType<RecordBase & { body: SmAddBody; attempts: number; nextAttemptAt: string; lastError?: string }>;

type OutboxItem = z.infer<typeof outboxSchema>;
const outbox = new RecordStore<OutboxItem>('smOutbox', outboxSchema);

async function enqueue(u: string, ws: string, body: SmAddBody, error?: string): Promise<void> {
  // One pending item per customId: the newest content wins.
  const existing = (await outbox.list(u, ws)).find((x) => x.body.customId === body.customId);
  if (existing) await outbox.update(u, ws, existing.id, (cur) => ({ ...cur, body, lastError: error }));
  else await outbox.create(u, ws, { body, attempts: 0, nextAttemptAt: new Date(Date.now() + 60_000).toISOString(), lastError: error });
}

export async function flushOutbox(u: string, ws: string, max = 25): Promise<{ sent: number; pending: number; dropped: number }> {
  const ctx = await smContext(u, ws);
  const items = await outbox.list(u, ws);
  if (!ctx) return { sent: 0, pending: items.length, dropped: 0 };
  let sent = 0;
  let dropped = 0;
  const due = items.filter((i) => new Date(i.nextAttemptAt).getTime() <= Date.now()).slice(0, max);
  for (const item of due) {
    const r = await addNow(ctx, item.body);
    if (r.ok) {
      await outbox.remove(u, ws, item.id);
      sent++;
    } else if (!r.transient || item.attempts + 1 >= OUTBOX_MAX_ATTEMPTS) {
      await outbox.remove(u, ws, item.id); // permanent rejection or out of attempts
      dropped++;
    } else {
      const attempts = item.attempts + 1;
      await outbox.update(u, ws, item.id, (cur) => ({ ...cur, attempts, nextAttemptAt: new Date(Date.now() + outboxDelayMs(attempts)).toISOString(), lastError: r.error }));
    }
  }
  return { sent, pending: (await outbox.list(u, ws)).length, dropped };
}

export async function outboxSize(u: string, ws: string): Promise<number> {
  return (await outbox.list(u, ws)).length;
}

// ---------------------------------------------------------------------------
// Operations (all non-throwing)

async function addNow(ctx: SmCtx, body: SmAddBody): Promise<CallResult> {
  // Replacing a document: Supermemory documents a separate update path, so delete-then-add keeps content current.
  await smCall(ctx.key, 'DELETE', `/v3/documents/${encodeURIComponent(body.customId)}`);
  return smCall(ctx.key, 'POST', '/v3/documents', body, 10_000);
}

export type AddOutcome = 'sent' | 'queued' | 'skipped' | 'rejected';

/**
 * Adds or replaces a document. `sent` = stored now; `queued` = transient failure, the outbox will retry;
 * `skipped` = integration or source is off; `rejected` = the API refused it (not retried).
 */
export async function smAdd(u: string, ws: string, source: keyof SmSettings, build: (tag: string) => SmAddBody): Promise<AddOutcome> {
  const ctx = await smFor(u, ws, source);
  if (!ctx) return 'skipped';
  const body = build(ctx.tag);
  const r = await addNow(ctx, body);
  if (r.ok) return 'sent';
  if (r.transient) {
    await enqueue(u, ws, body, r.error).catch(() => undefined);
    return 'queued';
  }
  console.warn('[supermemory] write rejected', r.status, body.customId);
  return 'rejected';
}

/** Removes one mirrored document (e.g. a memory the user deleted). */
export async function smRemove(u: string, ws: string, source: keyof SmSettings, customId: string): Promise<boolean> {
  const ctx = await smFor(u, ws, source);
  if (!ctx) return false;
  const r = await smCall(ctx.key, 'DELETE', `/v3/documents/${encodeURIComponent(customId)}`);
  return r.ok || r.status === 404;
}

/** Current, relevant facts for a query (agent memory). */
export async function smRecall(u: string, ws: string, query: string, limit = 12, timeoutMs = 4000): Promise<string[]> {
  const ctx = await smFor(u, ws, 'memory');
  if (!ctx || !query.trim()) return [];
  const r = await smCall(ctx.key, 'POST', '/v4/search', { q: query.slice(0, 500), containerTag: ctx.tag, limit: Math.min(100, limit * 2) }, timeoutMs);
  const results = (r.json as { results?: SmMemoryHit[] } | undefined)?.results;
  return r.ok && Array.isArray(results) ? pickFacts(results, limit) : [];
}

export interface Passage {
  id: string;
  title: string;
  text: string;
  score: number;
  metadata: Record<string, unknown>;
}

/** Relevant passages from indexed documents of one kind (knowledge base or past tickets). */
export async function smPassages(u: string, ws: string, settingKey: 'knowledge' | 'tickets', source: SmSource, query: string, limit = 6, timeoutMs = 4000): Promise<Passage[] | null> {
  const ctx = await smFor(u, ws, settingKey);
  if (!ctx || !query.trim()) return null;
  const r = await smCall(
    ctx.key,
    'POST',
    '/v3/search',
    { q: query.slice(0, 500), containerTag: ctx.tag, limit, filters: { AND: [{ key: 'source', value: source }] }, onlyMatchingChunks: true, rerank: true },
    timeoutMs,
  );
  const results = (r.json as { results?: SmDocHit[] } | undefined)?.results;
  return r.ok && Array.isArray(results) ? docPassages(results, limit) : null;
}

const profileCache = new Map<string, { at: number; facts: string[] }>();
const PROFILE_TTL_MS = 5 * 60_000;

/** Short "what we know" list for prompts; cached because it changes slowly. */
export async function smProfileFacts(u: string, ws: string, limit = 10): Promise<string[]> {
  const ctx = await smFor(u, ws, 'profile');
  if (!ctx) return [];
  const hit = profileCache.get(ctx.tag);
  if (hit && Date.now() - hit.at < PROFILE_TTL_MS) return hit.facts;
  const r = await smCall(ctx.key, 'POST', '/v4/profile', { containerTag: ctx.tag }, 4000);
  const buckets = (r.json as { buckets?: Record<string, SmProfileBucketEntry[]> } | undefined)?.buckets;
  const facts = r.ok ? flattenProfile(buckets, limit) : [];
  if (r.ok) profileCache.set(ctx.tag, { at: Date.now(), facts });
  if (profileCache.size > 500) profileCache.clear();
  return facts;
}

/** Deletes everything stored for this workspace (right to erasure / switching the integration off). */
export async function smPurge(u: string, ws: string): Promise<{ ok: boolean; deletedDocuments?: number; error?: string }> {
  const ctx = await smContext(u, ws);
  if (!ctx) return { ok: false, error: 'Supermemory is not enabled for this workspace.' };
  const r = await smCall(ctx.key, 'DELETE', `/v3/container-tags/${encodeURIComponent(ctx.tag)}`, undefined, 15_000);
  profileCache.delete(ctx.tag);
  const json = r.json as { deletedDocumentsCount?: number } | undefined;
  return r.ok ? { ok: true, deletedDocuments: json?.deletedDocumentsCount } : { ok: false, error: r.error };
}

export { invalidateSmContext };
