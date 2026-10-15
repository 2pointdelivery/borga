import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Offline outbox: a save that fails for network reasons is queued on the
 * device and re-sent in order the next time the app reaches the server.
 * Only /api/borga/data saves are queued (they carry the whole list and a
 * baseVersion). Refusals that are NOT network errors (409 conflict, 403, 413)
 * are never queued — re-sending them cannot succeed and would hide the
 * problem from the user.
 */

const KEY = 'borga.outbox.v1';
const MAX_ITEMS = 50;

export interface OutboxItem {
  id: string;
  ws: string;
  entity: string;
  value: unknown;
  baseVersion?: number;
  queuedAt: string;
  /** Readable label for the "N unsent changes" line. */
  label: string;
}

export async function readOutbox(): Promise<OutboxItem[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as OutboxItem[]) : [];
    return Array.isArray(list) ? list.slice(0, MAX_ITEMS) : [];
  } catch {
    return [];
  }
}

async function writeOutbox(items: OutboxItem[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
  } catch {
    // Storage full: the newest item still returns false to its caller, which shows a toast.
  }
}

/** Queue one failed save (network errors only). Newest first, capped. */
export async function enqueueOutbox(item: Omit<OutboxItem, 'id' | 'queuedAt'>): Promise<number> {
  const items = await readOutbox();
  const next: OutboxItem[] = [{ ...item, id: `ob-${Date.now().toString(36)}`, queuedAt: new Date().toISOString() }, ...items];
  await writeOutbox(next);
  return next.length;
}

export function isNetworkError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  // Our own api layer throws Error("Request failed (status)") for HTTP responses;
  // fetch itself throws TypeError for connection failures. Both are retryable.
  // Real refusals carry the server's own message and are NOT retried here.
  return e instanceof TypeError || /^Request failed \(\d+\)$/.test(e.message);
}

export interface FlushResult {
  sent: number;
  remaining: number;
}

/**
 * Re-send everything queued, oldest first (storage is newest-first; order
 * matters: later edits of the same entity must overwrite earlier ones).
 * Stops at the first failure so order is preserved. A 409 conflict counts as
 * resolved — the server moved on, and keeping a stale edit queued forever
 * would just fail again; the web client shows the fresh copy on next load.
 */
export async function flushOutbox(
  send: (item: OutboxItem) => Promise<{ ok: boolean; conflict?: boolean }>,
): Promise<FlushResult> {
  const stored = await readOutbox();          // newest first
  const ordered = stored.slice().reverse();   // oldest first
  let sent = 0;
  let stopAt = ordered.length;                // everything after (and incl.) this index stays
  for (let i = 0; i < ordered.length; i++) {
    try {
      const r = await send(ordered[i]);
      if (r.ok || r.conflict) sent++;
      else { stopAt = i; break; }
    } catch {
      stopAt = i;
      break;
    }
  }
  const survivors = ordered.slice(stopAt).reverse(); // back to newest-first
  await writeOutbox(survivors);
  return { sent, remaining: survivors.length };
}
