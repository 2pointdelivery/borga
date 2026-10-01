/**
 * Per-process cache of "is Supermemory live for this workspace, and with what key/settings".
 * Lives in its own module so the connection store and the feature store can invalidate it
 * (on key save/delete, flag toggle, settings change) without importing the Supermemory client.
 */
export interface CachedSmCtx {
  key: string;
  tag: string;
  settings: { memory: boolean; knowledge: boolean; tickets: boolean; profile: boolean };
}

export const ctxCache = new Map<string, { at: number; ctx: CachedSmCtx | null }>();

export function invalidateSmContext(userId: string, ws: string): void {
  ctxCache.delete(userId + '/' + ws);
}
