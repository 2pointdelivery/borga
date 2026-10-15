import 'server-only';
import { getBorgaState } from './persistence';
import { userWorkspacesKey } from './keys';
import type { Workspace } from './data';

/**
 * SaaS workspace rule, in one place: a caller may only touch workspaces in
 * their own registry. Returns true when the workspace is owned, or when
 * ownership cannot be established (no registry yet — legacy accounts predate
 * it — or the read failed, where refusing would lock a user out of their own
 * data during a database hiccup). Callers enforce only on a definitive "no".
 */
export async function ownsWorkspace(userId: string, ws: string): Promise<boolean> {
  const list = await getBorgaState<Workspace[]>(userWorkspacesKey(userId)).catch(() => null);
  if (!list || list.length === 0) return true;
  return list.some((w) => w.id === ws);
}
