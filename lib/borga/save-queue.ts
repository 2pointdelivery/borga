/**
 * Client-side save queue with optimistic concurrency. Pure (the network call is injected) so it can be unit tested.
 *
 * Each entity (a whole list such as invoices) is saved as one document with a version. The queue:
 *  - saves one entity at a time and keeps only the newest value while a save is in flight, so a user's own quick edits never
 *    conflict with each other;
 *  - sends the version it last saw; the server refuses a save whose version is stale (another tab, device or an agent saved first);
 * - on a refusal, compares the server's copy with what it was about to save. Identical content (compared canonically, because
 *    MySQL reorders JSON keys) means both sides agree, so it adopts the new version quietly. Different content goes to the
 *    merge hook: id-keyed lists merge record-by-record against the last synced value (only same-field collisions keep the
 *    server and are reported); anything unmergeable is a real conflict: nothing is overwritten, the entity is blocked, and
 *    onConflict tells the user, until the entity is reloaded.
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
   * Merge a refused local value with the server's newer copy, given the last
   * synced value both sides started from. Return null when the entity cannot
   * be merged (the refusal becomes a real conflict). The queue retries the
   * merged value from the server's version (bounded: see drain).
   */
  merge?(id: string, localValue: unknown, serverValue: unknown, baseValue: unknown): MergeOutcome | null;
  /** Rebuilds a payload around a merged value for the retry. */
  withValue?(payload: P, value: unknown): P;
  onConflict(id: string, payload: P): void;
  /** A merge that overrode the tab's own edits on some fields (server won). */
  onMerged?(id: string, conflicts: MergeConflict[]): void;
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
  /** Last synced (server-acknowledged) value per entity, canonicalised: the merge base. */
  private bases = new Map<string, string>();

  constructor(private hooks: SaveQueueHooks<P>) {}

  /** Records the versions the server reported for one scope (for example one company). Replaces that scope and unblocks it. */
  setVersions(scope: string, versions: Record<string, number>): void {
    for (const id of [...this.versions.keys()]) if (id.startsWith(scope)) this.versions.delete(id);
    // New sync point: bases from before the reload no longer describe what both sides share.
    for (const id of [...this.bases.keys()]) if (id.startsWith(scope)) this.bases.delete(id);
    this.unblockScope(scope);
    for (const [entity, v] of Object.entries(versions)) this.versions.set(scope + entity, v);
  }

  unblockScope(scope: string): void {
    for (const id of [...this.blocked]) if (id.startsWith(scope)) this.blocked.delete(id);
  }

  version(id: string): number {
    return this.versions.get(id) ?? 0;
  }

  /** Remember the last synced value (canonical JSON) of an entity: the 3-way merge base. */
  setBase(id: string, value: unknown): void {
    this.bases.set(id, canonicalJson(value));
  }

  /** The merge base as a value (parsed lazily, only when a refusal actually merges). */
  private baseValue(id: string): unknown {
    const raw = this.bases.get(id);
    if (raw === undefined) return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }

  /** Forget one scope's bases (workspace switch). Versions are handled by setVersions. */
  clearBases(scope: string): void {
    for (const id of [...this.bases.keys()]) if (id.startsWith(scope)) this.bases.delete(id);
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
        this.bases.set(id, canonicalJson(this.hooks.valueOf(payload)));
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
        const merged = this.hooks.merge?.(id, this.hooks.valueOf(payload), r.current.value, this.baseValue(id));
        if (merged) {
          merges++;
          this.versions.set(id, r.current.version);
          this.bases.set(id, canonicalJson(merged.merged));
          if (merged.conflicts.length) this.hooks.onMerged?.(id, merged.conflicts);
          // A newer edit may have landed while the merge was computed: never
          // clobber it — it saves fresh from the adopted version anyway.
          if (!this.latest.has(id)) {
            this.latest.set(id, this.hooks.withValue ? this.hooks.withValue(payload, merged.merged) : payload);
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

// ---------------------------------------------------------------------------
// 3-way record merge for id-keyed lists (invoices, tasks, leads, ...).
//
// base = the last synced value both sides started from. Per record:
//   - only one side changed it (or added it) -> that side wins, nothing lost
//   - both sides changed different fields -> each keeps its fields, nothing lost
//   - both sides changed the same field -> the server wins and the field is
//     reported (the only case that still loses a local edit)
//   - one side deleted it (absent) while the other left it untouched -> the
//     delete wins; while the other changed it -> the change wins (a delete
//     never silently discards someone else's edit)

export interface MergeConflict {
  /** Record id. */
  id: string;
  /** Human label (name/title/number/…) for the banner. */
  label: string;
  /** Fields where both sides edited and the server won. */
  fields: string[];
}

export interface MergeOutcome {
  merged: unknown[];
  conflicts: MergeConflict[];
}

type Rec = Record<string, unknown>;

function asRecList(v: unknown): Rec[] | null {
  if (!Array.isArray(v)) return null;
  for (const e of v) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
    if (typeof (e as Rec).id !== 'string') return null;
  }
  return v as Rec[];
}

function same(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

/** "INV-104", "Ama Serwaa", … — first human key present, else the id. */
export function recordLabel(rec: Rec): string {
  for (const k of ['name', 'title', 'subject', 'number', 'label']) {
    const v = rec[k];
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 60);
  }
  return `#${String(rec.id).slice(0, 24)}`;
}

export function mergeRecords(baseValue: unknown, localValue: unknown, serverValue: unknown): MergeOutcome | null {
  const base = asRecList(baseValue);
  const local = asRecList(localValue);
  const server = asRecList(serverValue);
  if (!local || !server) return null;
  const b = new Map((base ?? []).map((r) => [r.id as string, r]));
  const l = new Map(local.map((r) => [r.id as string, r]));
  const s = new Map(server.map((r) => [r.id as string, r]));
  const merged: Rec[] = [];
  const conflicts: MergeConflict[] = [];
  const pushConflict = (id: string, rec: Rec, fields: string[]) => {
    if (fields.length) conflicts.push({ id, label: recordLabel(rec), fields: [...new Set(fields)].slice(0, 8) });
  };

  // Server order first (keeps the saved arrangement), then local-only additions at the end.
  for (const [, srec] of s) {
    const lrec = l.get(srec.id as string);
    const brec = b.get(srec.id as string);
    if (!lrec) {
      // Absent locally: deleted here (was in base) or never seen (not in base, local is older than base — impossible
      // when base is the last sync, so treat missing-base as deleted-here). Either way the delete wins — unless the
      // server changed it since base, in which case the edit wins over the delete.
      if (brec && !same(srec, brec)) {
        merged.push(srec);
      } else if (!brec) {
        merged.push(srec);
      }
      continue;
    }
    if (!brec) {
      // Added on both sides under one id: keep when identical, else the server wins and says so.
      if (same(lrec, srec)) merged.push(srec);
      else {
        merged.push(srec);
        pushConflict(srec.id as string, srec, Object.keys(srec).filter((k) => !same(lrec[k], srec[k])));
      }
      continue;
    }
    if (same(lrec, brec)) {
      merged.push(srec);
      continue;
    }
    if (same(srec, brec)) {
      merged.push(lrec);
      continue;
    }
    // Changed on both sides: field-level merge, server wins field conflicts.
    const out: Rec = { ...srec };
    const fields: string[] = [];
    for (const k of new Set([...Object.keys(lrec), ...Object.keys(srec), ...Object.keys(brec)])) {
      const fl = lrec[k];
      const fs = srec[k];
      const fb = brec[k];
      if (same(fl, fb)) out[k] = fs;
      else if (same(fs, fb)) out[k] = fl;
      else {
        out[k] = fs;
        fields.push(k);
      }
    }
    merged.push(out);
    pushConflict(srec.id as string, out, fields);
  }
  for (const [id, lrec] of l) {
    if (s.has(id)) continue;
    const brec = b.get(id);
    if (brec && same(lrec, brec)) continue; // deleted on the server, untouched here: the delete wins
    if (!brec || !same(lrec, brec)) merged.push(lrec); // added here, or changed here while deleted there: the edit wins
  }
  return { merged, conflicts };
}
