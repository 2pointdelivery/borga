import 'server-only';
import { getBorgaState, setBorgaState } from './persistence';
import { userWsKey } from './keys';
import { KNOWLEDGE_SEED, type KnowledgeEntry } from './data';
import { contentHash, kbCustomId, kbDoc, ticketCustomId, ticketDoc } from './supermemory-core';
import { flushOutbox, outboxSize, smAdd, smFor, smPassages, smRemove, type AddOutcome } from './supermemory';
import { getTicket, listTickets } from './tickets-server';
import { isDoneStatus } from './tickets';

/**
 * Keeps Supermemory's copy of the knowledge base and of resolved tickets in step with Borga's.
 * Each sync records a content hash per item, so only new/changed items are sent and removed
 * items are deleted remotely. Runs from the cron sync job and from "Sync now".
 */

interface SyncState {
  hashes: Record<string, string>;
  lastSyncAt?: string;
  lastError?: string;
}

const kbStateKey = (u: string, ws: string) => `t::${u}::${ws}::smkb`;
const ticketStateKey = (u: string, ws: string) => `t::${u}::${ws}::smtickets`;
const MAX_PER_RUN = 60;

export async function syncKnowledge(u: string, ws: string): Promise<{ added: number; removed: number; queued: number; rejected: number; total: number } | null> {
  if (!(await smFor(u, ws, 'knowledge'))) return null;
  const kb = (await getBorgaState<KnowledgeEntry[]>(userWsKey(u, ws, 'knowledge'))) ?? KNOWLEDGE_SEED;
  const state = (await getBorgaState<SyncState>(kbStateKey(u, ws))) ?? { hashes: {} };
  const hashes = { ...state.hashes };
  const tally: Record<AddOutcome, number> = { sent: 0, queued: 0, skipped: 0, rejected: 0 };
  let removed = 0;

  let budget = MAX_PER_RUN;
  for (const entry of kb) {
    const h = contentHash(`${entry.title}\n${entry.answer}`);
    if (hashes[entry.id] === h) continue;
    if (budget-- <= 0) break; // the rest goes next run
    const out = await smAdd(u, ws, 'knowledge', (tag) => kbDoc(tag, entry));
    tally[out]++;
    if (out === 'sent' || out === 'queued') hashes[entry.id] = h; // queued items are delivered by the outbox
  }
  const live = new Set(kb.map((e) => e.id));
  for (const id of Object.keys(hashes)) {
    if (live.has(id)) continue;
    if (await smRemove(u, ws, 'knowledge', kbCustomId(id))) {
      delete hashes[id];
      removed++;
    }
  }
  await setBorgaState(kbStateKey(u, ws), { hashes, lastSyncAt: new Date().toISOString(), lastError: tally.rejected ? `${tally.rejected} entr${tally.rejected === 1 ? 'y was' : 'ies were'} rejected by Supermemory` : undefined } satisfies SyncState);
  return { added: tally.sent, removed, queued: tally.queued, rejected: tally.rejected, total: kb.length };
}

/** Indexes tickets that have been resolved/closed (contact details are redacted in `ticketDoc`). */
export async function syncTickets(u: string, ws: string): Promise<{ added: number; queued: number; rejected: number; total: number } | null> {
  if (!(await smFor(u, ws, 'tickets'))) return null;
  const state = (await getBorgaState<SyncState>(ticketStateKey(u, ws))) ?? { hashes: {} };
  const hashes = { ...state.hashes };
  const done = (await listTickets(u, ws)).filter((t) => isDoneStatus(t.status));
  const tally: Record<AddOutcome, number> = { sent: 0, queued: 0, skipped: 0, rejected: 0 };
  let budget = MAX_PER_RUN;
  for (const t of done) {
    const h = contentHash(`${t.updatedAt}|${t.status}|${t.comments.length}`);
    if (hashes[t.id] === h) continue;
    if (budget-- <= 0) break;
    const out = await smAdd(u, ws, 'tickets', (tag) => ticketDoc(tag, t));
    tally[out]++;
    if (out === 'sent' || out === 'queued') hashes[t.id] = h;
  }
  await setBorgaState(ticketStateKey(u, ws), { hashes, lastSyncAt: new Date().toISOString() } satisfies SyncState);
  return { added: tally.sent, queued: tally.queued, rejected: tally.rejected, total: done.length };
}

/** Index one ticket right away (called when it is resolved or closed). Never throws. */
export async function indexTicket(u: string, ws: string, id: string): Promise<void> {
  try {
    const t = await getTicket(u, ws, id);
    if (!t || !isDoneStatus(t.status)) return;
    await smAdd(u, ws, 'tickets', (tag) => ticketDoc(tag, t));
    const state = (await getBorgaState<SyncState>(ticketStateKey(u, ws))) ?? { hashes: {} };
    await setBorgaState(ticketStateKey(u, ws), { ...state, hashes: { ...state.hashes, [t.id]: contentHash(`${t.updatedAt}|${t.status}|${t.comments.length}`) } });
  } catch (e) {
    console.warn('[supermemory] index ticket failed', (e as Error).message);
  }
}

/** Remove a ticket's indexed copy (e.g. reopened: it is no longer a "resolved" example). */
export async function unindexTicket(u: string, ws: string, id: string): Promise<void> {
  try {
    await smRemove(u, ws, 'tickets', ticketCustomId(id));
    const state = await getBorgaState<SyncState>(ticketStateKey(u, ws));
    if (state?.hashes[id]) {
      const { [id]: _drop, ...rest } = state.hashes;
      void _drop;
      await setBorgaState(ticketStateKey(u, ws), { ...state, hashes: rest });
    }
  } catch (e) {
    console.warn('[supermemory] unindex ticket failed', (e as Error).message);
  }
}

export interface SmSyncStatus {
  kb: { lastSyncAt: string | null; indexed: number; lastError: string | null };
  tickets: { lastSyncAt: string | null; indexed: number };
  outbox: number;
}

export async function syncStatus(u: string, ws: string): Promise<SmSyncStatus> {
  const [kb, tk, outbox] = await Promise.all([
    getBorgaState<SyncState>(kbStateKey(u, ws)),
    getBorgaState<SyncState>(ticketStateKey(u, ws)),
    outboxSize(u, ws),
  ]);
  return {
    kb: { lastSyncAt: kb?.lastSyncAt ?? null, indexed: Object.keys(kb?.hashes ?? {}).length, lastError: kb?.lastError ?? null },
    tickets: { lastSyncAt: tk?.lastSyncAt ?? null, indexed: Object.keys(tk?.hashes ?? {}).length },
    outbox,
  };
}

/** One full pass: retry queued writes, then sync knowledge and tickets. Used by cron and "Sync now". */
export async function runSupermemorySync(u: string, ws: string) {
  const flushed = await flushOutbox(u, ws);
  const kb = await syncKnowledge(u, ws);
  const tickets = await syncTickets(u, ws);
  return { flushed, kb, tickets };
}

/** Forget all sync bookkeeping (after a purge) so a later re-enable re-sends everything. */
export async function resetSyncState(u: string, ws: string): Promise<void> {
  await Promise.all([setBorgaState(kbStateKey(u, ws), { hashes: {} }), setBorgaState(ticketStateKey(u, ws), { hashes: {} })]);
}

export interface SimilarTicket {
  ticketId: string;
  title: string;
  excerpt: string;
  score: number;
}

/** Past resolved tickets that resemble a problem description. Null when the feature/source is off. */
export async function findSimilarTickets(u: string, ws: string, query: string, excludeId?: string, limit = 4): Promise<SimilarTicket[] | null> {
  const passages = await smPassages(u, ws, 'tickets', 'ticket', query, limit + 2);
  if (!passages) return null;
  return passages
    .filter((p) => String(p.metadata.ticketId ?? '') !== excludeId)
    .slice(0, limit)
    .map((p) => ({ ticketId: String(p.metadata.ticketId ?? ''), title: p.title || String(p.metadata.ticketId ?? ''), excerpt: p.text.slice(0, 400), score: p.score }));
}
