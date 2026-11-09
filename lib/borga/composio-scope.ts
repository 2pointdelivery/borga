import { createHash } from 'node:crypto';

/**
 * Composio keeps connected accounts (a company's Gmail, social pages...) under an "entity" id inside one project. While the
 * deployment's own key is in use that project is shared by every company, so entity ids are prefixed with a hash of the signed-in
 * user: only accounts under that prefix are ever listed, used or changed. A company that brings its own Composio key has its own
 * project and needs no prefix (pass `shared: false`).
 */
export function composioScope(userId: string | null | undefined, shared = true): string {
  return shared && userId ? `u${createHash('sha256').update(userId).digest('hex').slice(0, 12)}-` : '';
}

/** Prefix an entity id, once (an id that already carries the prefix, e.g. from a held approval, is kept). */
export function scopedEntity(scope: string, raw?: string): string {
  const id = (raw ?? 'default').trim() || 'default';
  return scope && !id.startsWith(scope) ? `${scope}${id}` : id;
}

/** True when a Composio account (any of its owner-id spellings) belongs to this scope. Always true when there is no scope. */
export function inScope(scope: string, account: Record<string, unknown>): boolean {
  return !scope || String(account.user_id ?? account.userId ?? account.entity_id ?? '').startsWith(scope);
}
