/**
 * Client-side save queue with optimistic concurrency. Pure (the network call is injected) so it can be unit tested.
 *
 * Each entity (a whole list such as invoices) is saved as one document with a version. The queue:
 *  - saves one entity at a time and keeps only the newest value while a save is in flight, so a user's own quick edits never
 *    conflict with each other;
 *  - sends the version it last saw; the server refuses a save whose version is stale (another tab, device or an agent saved first);
 *  - on a refusal, compares the server's copy with what it was about to save. Identical content (compared canonically, because
 *    MySQL reorders JSON keys) means both sides agree, so it adopts the new version quietly. Different content is a real
 *    conflict: nothing is overwritten, the entity is blocked, and onConflict tells the user, until the entity is reloaded.
 *  - append-only feeds (the activity timeline) may supply a merge hook: both sides' entries are unioned and retried, so a
 *    busy background agent never blocks the feed or raises a banner for trivia.
 */

export type SendResult =
  | { status: 'ok'; version: number }
  | { status: 'conflict'; current: { version: number; value: unknown } | null }
  /** Network failure or server down: not a conflict. The next save of the entity tries again. */
  | { status: 'error' }
  /** Refused for a reason the sender already reported to the user (too large, signed out): not sent again, not a conflict. */
  | { status: 'rejected' };

export interface SaveQueueHooks<P> {
  send(id: string, payload: P, baseVersion: number): Promise<SendResult>;
  /** The value inside a payload, for comparing with the server's copy. */
  valueOf(payload: P): unknown;
  /**
   * Merge a refused local value with the server's newer copy. Return null when
   * the entity cannot be merged (the refusal becomes a real conflict). Only
   * used for append-only feeds where union-by-id loses nothing.
   */
  merge?(id: string, localValue: unknown, serverValue: unknown): unknown | null;
  /** Rebuilds a payload around a merged value for the retry. */
  withValue?(payload: P, value: unknown): P;
  onConflict(id: string, payload: P): void;
  onError(id: string): void;
}

/** JSON with object keys sorted, so two documents with the same content compare equal whatever the key order. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

export class SaveQueue<P> {
  private versions = new Map<string, number>();
  private blocked = new Set<string>();
  private latest = new Map<string, P>();
  private running = new Map<string, Promise<void>>();

  constructor(private hooks: SaveQueueHooks<P>) {}

  /** Records the versions the server reported for one scope (for example one company). Replaces that scope and unblocks it. */
  setVersions(scope: string, versions: Record<string, number>): void {
    for (const id of [...this.versions.keys()]) if (id.startsWith(scope)) this.versions.delete(id);
    this.unblockScope(scope);
    for (const [entity, v] of Object.entries(versions)) this.versions.set(scope + entity, v);
  }

  unblockScope(scope: string): void {
    for (const id of [...this.blocked]) if (id.startsWith(scope)) this.blocked.delete(id);
  }

  version(id: string): number {
    return this.versions.get(id) ?? 0;
  }

  /**
   * Another tab in this browser saved and broadcast its version: adopt it so
   * our next save goes out from the fresh version instead of spuriously
   * conflicting. Never unblocks an entity already in real conflict, and never
   * moves a version backwards.
   */
  noteVersion(id: string, version: number): void {
    if (this.blocked.has(id)) return;
    if (Number.isInteger(version) && version > this.version(id)) this.versions.set(id, version);
  }

  isBlocked(id: string): boolean {
    return this.blocked.has(id);
  }

  /** Queues a save. Resolves when this entity has nothing left to send. A blocked entity is not sent (the caller keeps it locally). */
  save(id: string, payload: P): Promise<void> {
    if (this.blocked.has(id)) return Promise.resolve();
    this.latest.set(id, payload);
    const running = this.running.get(id);
    if (running) return running;
    const p = this.drain(id).finally(() => this.running.delete(id));
    this.running.set(id, p);
    return p;
  }

  /** Resolves when every entity has finished sending. */
  async idle(): Promise<void> {
    while (this.running.size) await Promise.all([...this.running.values()]);
  }

  private async drain(id: string): Promise<void> {
    // Merged retries per drain: if the server keeps moving under us, stop
    // merging and surface a real conflict instead of spinning.
    let merges = 0;
    while (this.latest.has(id)) {
      const payload = this.latest.get(id) as P;
      this.latest.delete(id);
      const r = await this.hooks.send(id, payload, this.version(id));
      if (r.status === 'ok') {
        this.versions.set(id, r.version);
        continue;
      }
      if (r.status === 'rejected') {
        this.latest.delete(id);
        return;
      }
      if (r.status === 'error') {
        this.hooks.onError(id);
        this.latest.delete(id);
        return;
      }
      if (r.current && canonicalJson(r.current.value) === canonicalJson(this.hooks.valueOf(payload))) {
        // Someone else saved the very same content (or this tab did, through a server call): nothing is lost, adopt the version.
        this.versions.set(id, r.current.version);
        continue;
      }
      if (r.current && merges < 2) {
        const merged = this.hooks.merge?.(id, this.hooks.valueOf(payload), r.current.value);
        if (merged !== null && merged !== undefined) {
          merges++;
          this.versions.set(id, r.current.version);
          // A newer edit may have landed while the merge was computed: never
          // clobber it — it saves fresh from the adopted version anyway.
          if (!this.latest.has(id)) {
            this.latest.set(id, this.hooks.withValue ? this.hooks.withValue(payload, merged) : payload);
          }
          continue;
        }
      }
      this.blocked.add(id);
      this.latest.delete(id);
      this.hooks.onConflict(id, payload);
      return;
    }
  }
}

/**
 * Union of two newest-first feed arrays by entry id: local entries first,
 * then server-only entries, capped. Both sides only ever append, so nothing
 * is lost and nothing deleted comes back — except when the local side is an
 * explicit clear (empty), which must win and therefore refuses to merge.
 */
export function unionAppendOnly(localValue: unknown, serverValue: unknown, cap: number): Array<{ id?: unknown }> | null {
  if (!Array.isArray(localValue) || !Array.isArray(serverValue)) return null;
  if (localValue.length === 0) return null;
  const seen = new Set<unknown>();
  for (const e of localValue) {
    const entry = e as { id?: unknown } | null;
    if (entry && entry.id != null) seen.add(entry.id);
  }
  const extra = (serverValue as Array<{ id?: unknown } | null>).filter(
    (e): e is { id?: unknown } => !!e && (e.id == null || !seen.has(e.id)),
  );
  return [...(localValue as Array<{ id?: unknown }>), ...extra].slice(0, cap);
}
