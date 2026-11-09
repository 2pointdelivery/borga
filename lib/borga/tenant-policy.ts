/**
 * Pure tenant policy, separated from the database-backed guard so it can be
 * unit-tested without a server. See tenant-guard.ts for how it is enforced.
 */

const USER_ID = '[A-Za-z0-9_-]{1,64}';
const WS_ID = '[A-Za-z0-9_-]{1,64}';
// Each key shape is matched explicitly: a missing `ws::` segment is not a
// tenant key, it is a bug (or a probe), and must not name a workspace.
const U_KEY = new RegExp(`^u::(${USER_ID})::ws::(${WS_ID})::`);
const C_KEY = new RegExp(`^c::(${USER_ID})::(${WS_ID})::`);
const T_KEY = new RegExp(`^t::(${USER_ID})::(${WS_ID})::`);
const RESERVED_OWNERS = new Set(['admin', 'billing', 'shared_services', 'operator']);

/**
 * The owner a stored key belongs to, or null for deployment-wide keys
 * (`api_secrets`, `borga_ping`, `u::<id>::workspaces`, invite/admin records).
 */
export function tenantOf(key: string): { userId: string; ws: string } | null {
  if (typeof key !== 'string' || key.length > 512) return null;
  const m = U_KEY.exec(key) ?? C_KEY.exec(key) ?? T_KEY.exec(key);
  if (!m) return null;
  if (RESERVED_OWNERS.has(m[1])) return null;
  return { userId: m[1], ws: m[2] };
}

/** A workspace is allowed only when it is listed in that user's registry. */
export function tenantAllowed(workspaceIds: readonly string[] | null, ws: string): boolean {
  // null = no registry row (an account from before the registry existed).
  if (workspaceIds === null) return true;
  // An empty registry is also legacy/cleared; there is no company to protect.
  if (workspaceIds.length === 0) return true;
  return workspaceIds.includes(ws);
}

/** Workspaces whose stored ids this key may touch (one key, one workspace). */
export function tenantsInKey(key: string): string[] {
  const owner = tenantOf(key);
  return owner ? [owner.ws] : [];
}
