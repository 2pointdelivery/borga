import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { borgaState } from '@/db/schemas/borga';
import { tenantAllowed, tenantOf } from './tenant-policy';

export { tenantAllowed, tenantOf } from './tenant-policy';

/**
 * Row-level security, as close as MySQL can get.
 *
 * MySQL 8 / MariaDB have no `CREATE POLICY` / `ENABLE ROW LEVEL SECURITY`, so
 * isolation cannot be delegated to the engine. Instead every tenant-scoped row
 * (`borga_state` is the one table holding workspaces) is guarded here, and the
 * persistence layer calls this for every single-key read, write and delete.
 * The key itself names its owner:
 *
 *   u::<userId>::ws::<wsId>::<entity>   workspace state
 *   c::<userId>::<wsId>::<provider>     encrypted integration credentials
 *   t::<userId>::<wsId>::<entity>       billing and similar records
 *
 * The signed session supplies the userId when the key is built, so a browser
 * cannot name another owner; this guard closes the remaining hole: a key whose
 * workspace is not in that user's own registry (a forged ws id, a deleted
 * company, or a bug in a caller).
 *
 * Legacy accounts (no registry row, or an empty registry) are allowed: before
 * the registry existed every entity used a workspace-scoped key without one.
 * A definitive mismatch is denied, and a database error while reading the
 * registry is denied too (fail closed) — the underlying query would fail anyway.
 */

export class TenantAccessError extends Error {
  constructor(message = 'forbidden_workspace') {
    super(message);
    this.name = 'TenantAccessError';
  }
}

interface RegistryEntry {
  at: number;
  ids: string[] | null;
  error: boolean;
}

const TTL_MS = 30_000;
const ERROR_TTL_MS = 5_000;
const g = globalThis as typeof globalThis & { __borgaTenantRegistry?: Map<string, RegistryEntry> };
const cache = (g.__borgaTenantRegistry ??= new Map<string, RegistryEntry>());
const inFlight = new Map<string, Promise<RegistryEntry>>();

/** Called after a workspace registry is saved (create/rename/delete). */
export function invalidateTenantCache(userId?: string): void {
  if (userId) cache.delete(userId);
  else cache.clear();
}

async function loadRegistry(userId: string): Promise<RegistryEntry> {
  try {
    const rows = await db
      .select({ value: borgaState.value })
      .from(borgaState)
      .where(eq(borgaState.key, `u::${userId}::workspaces`))
      .limit(1);
    if (!rows[0]) return { at: Date.now(), ids: null, error: false };
    const raw = rows[0].value;
    const list = Array.isArray(raw) ? (raw as Array<{ id?: unknown }>) : [];
    const ids = list.map((w) => (w && typeof w.id === 'string' ? w.id : '')).filter(Boolean);
    return { at: Date.now(), ids, error: false };
  } catch (error) {
    console.error(`Tenant registry read failed for ${userId}:`, error);
    return { at: Date.now(), ids: null, error: true };
  }
}

async function registryFor(userId: string): Promise<RegistryEntry> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < (hit.error ? ERROR_TTL_MS : TTL_MS)) return hit;
  const pending = inFlight.get(userId);
  if (pending) return pending;
  const p = loadRegistry(userId).then((entry) => {
    cache.set(userId, entry);
    inFlight.delete(userId);
    return entry;
  });
  inFlight.set(userId, p);
  return p;
}

/**
 * Enumeration-time check: may this user's background work touch that
 * workspace? Uses the same cached registry as assertTenantKey and fails closed
 * on a registry read error (the next beat retries). Deleted or renamed
 * companies leave schedule/queue rows behind; sweeping those keys would only
 * raise TenantAccessError, so callers filter with this first.
 */
export async function tenantWorkspaceAllowed(userId: string, ws: string): Promise<boolean> {
  const registry = await registryFor(userId);
  if (registry.error) return false;
  return tenantAllowed(registry.ids, ws);
}

/**
 * Throws TenantAccessError unless the key's owner may touch that workspace.
 * Non-tenant keys (deployment-wide settings, secrets, invites) pass untouched.
 */
export async function assertTenantKey(key: string): Promise<void> {
  const owner = tenantOf(key);
  if (!owner) return;
  const registry = await registryFor(owner.userId);
  if (registry.error) throw new TenantAccessError('tenant_registry_unavailable');
  if (!tenantAllowed(registry.ids, owner.ws)) throw new TenantAccessError('forbidden_workspace');
}
