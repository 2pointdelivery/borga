import 'server-only';
import { getBorgaRowOrThrow } from './persistence';
import { userWorkspacesKey } from './keys';
import type { Workspace } from './data';

/**
 * SaaS workspace rule, in one place: a caller may only touch workspaces in
 * their own registry. Legacy accounts (no registry row, or an empty one) are
 * still allowed — they predate the registry and have no other way in.
 *
 * Strict on errors: a database failure while reading the registry denies
 * instead of allowing. The persistence layer's tenant guard (assertTenantKey)
 * already fails closed underneath every read and write, so a transient error
 * cannot turn into cross-tenant access here either.
 */
export async function ownsWorkspace(userId: string, ws: string): Promise<boolean> {
  return ownsWorkspaceStrict(userId, ws);
}

/**
 * The strict twin used by route guards: a read failure denies instead of
 * allowing. Legacy accounts (no registry row, or an empty one) are still
 * allowed — they predate the registry and have no other way in.
 */
export async function ownsWorkspaceStrict(userId: string, ws: string): Promise<boolean> {
  try {
    const row = await getBorgaRowOrThrow(userWorkspacesKey(userId));
    const list = Array.isArray(row?.value) ? (row.value as Workspace[]) : [];
    if (list.length === 0) return true;
    return list.some((w) => w.id === ws);
  } catch (error) {
    console.error(`Workspace ownership check failed for ${userId}:`, error);
    return false;
  }
}
