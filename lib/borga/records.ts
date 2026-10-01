import 'server-only';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { deleteBorgaState, getBorgaState, getBorgaStatesByPrefix, insertBorgaStateIfAbsent, setBorgaState } from './persistence';

/**
 * Server-authoritative, one-row-per-record store for new features (recognition
 * contracts, fundraising deals, ad daily rows, call logs, ...). Avoids the
 * dashboard's whole-array last-write-wins persistence: edits to different records
 * never overwrite each other, and the server is the only writer.
 *
 * Key: t::<user>::<ws>::rec::<collection>::<id>   (kept out of the `u::` hydrate keyspace)
 */

const COLLECTION_RE = /^[a-z][a-zA-Z0-9]{1,31}$/;

export interface RecordBase {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export class RecordStore<T extends RecordBase> {
  constructor(
    private readonly collection: string,
    private readonly schema: z.ZodType<T>,
  ) {
    if (!COLLECTION_RE.test(collection)) throw new Error(`Invalid collection name: ${collection}`);
  }

  private prefix(u: string, ws: string) {
    return `t::${u}::${ws}::rec::${this.collection}::`;
  }

  newId(): string {
    return `${this.collection.slice(0, 3)}-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  }

  async get(u: string, ws: string, id: string): Promise<T | null> {
    const row = await getBorgaState<unknown>(this.prefix(u, ws) + id);
    const parsed = row ? this.schema.safeParse(row) : null;
    return parsed?.success ? parsed.data : null;
  }

  /** Creates with a caller-chosen or generated id; fails (null) if the id exists. */
  async create(u: string, ws: string, data: Omit<T, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<T | null> {
    const now = new Date().toISOString();
    const rec = this.schema.parse({ ...data, id: data.id ?? this.newId(), createdAt: now, updatedAt: now });
    return (await insertBorgaStateIfAbsent(this.prefix(u, ws) + rec.id, rec)) ? rec : null;
  }

  /** Read-modify-write one record. The mutator throws to abort. */
  async update(u: string, ws: string, id: string, mutate: (cur: T) => T): Promise<T | null> {
    const cur = await this.get(u, ws, id);
    if (!cur) return null;
    const next = this.schema.parse({ ...mutate(cur), id: cur.id, createdAt: cur.createdAt, updatedAt: new Date().toISOString() });
    await setBorgaState(this.prefix(u, ws) + id, next);
    return next;
  }

  async remove(u: string, ws: string, id: string): Promise<boolean> {
    return deleteBorgaState(this.prefix(u, ws) + id);
  }

  async list(u: string, ws: string): Promise<T[]> {
    const rows = await getBorgaStatesByPrefix(this.prefix(u, ws));
    const out: T[] = [];
    for (const v of Object.values(rows)) {
      const p = this.schema.safeParse(v);
      if (p.success) out.push(p.data);
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}
