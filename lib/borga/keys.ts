// Key conventions for per-user, per-workspace data in the borga_state table.
// Every entity a user owns is namespaced by their user id so companies are
// fully isolated between accounts.

export const WS_PREFIX = 'ws::';

export function userKey(userId: string, suffix: string): string {
  return `u::${userId}::${suffix}`;
}

export function userWorkspacesKey(userId: string): string {
  return userKey(userId, 'workspaces');
}

export function userWsKey(userId: string, wsId: string, entity: string): string {
  return `u::${userId}::${WS_PREFIX}${wsId}::${entity}`;
}

export function isValidUserId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(id);
}

export function isValidWsId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
}
