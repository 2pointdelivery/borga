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
      this.blocked.add(id);
      this.latest.delete(id);
      this.hooks.onConflict(id, payload);
      return;
    }
  }
}
