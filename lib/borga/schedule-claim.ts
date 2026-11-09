/**
 * Claim a due scheduled run with a conditional write, so two beats (the
 * in-process autopilot and the cron endpoint, or two app processes) cannot
 * enqueue the same occurrence twice.
 *
 * The claim key is one row per scheduled task; its value is the due slot
 * (`<taskId>:<nextRun>`) plus when it was claimed. A claim for the *same* slot
 * refuses a second enqueue while it is fresh; a stale claim (the run was
 * enqueued but the follow-up task write never landed) may be retaken after
 * CLAIM_TTL_MS, so a task can never wedge forever.
 *
 * Pure with injected storage so the concurrency behaviour is unit-tested
 * without a database: `writeIfVersion` is the persistence layer's optimistic
 * write (expected = 0 means "insert only if absent").
 */

export const CLAIM_TTL_MS = 10 * 60 * 1000;

export interface ClaimRow {
  value: unknown;
  version: number;
}

export interface ClaimDeps {
  read(key: string): Promise<ClaimRow | null>;
  /** Optimistic write: fails when the stored version is not `expected` (0 = row must not exist). */
  writeIfVersion(key: string, value: unknown, expected: number): Promise<{ ok: true } | { ok: false }>;
}

interface ClaimValue {
  slot: string;
  at: number;
}

function readClaim(row: ClaimRow | null): ClaimValue | null {
  const v = row?.value;
  if (!v || typeof v !== 'object') return null;
  const slot = (v as { slot?: unknown }).slot;
  const at = (v as { at?: unknown }).at;
  if (typeof slot !== 'string' || typeof at !== 'number' || !Number.isFinite(at)) return null;
  return { slot, at };
}

/**
 * True when this caller won the right to enqueue `slot` for `key`.
 * False means another beat already has it (fresh claim), or lost the race.
 */
export async function claimScheduledSlot(
  deps: ClaimDeps,
  key: string,
  slot: string,
  now = Date.now(),
): Promise<boolean> {
  const row = await deps.read(key);
  const existing = readClaim(row);
  if (existing && existing.slot === slot && now - existing.at < CLAIM_TTL_MS) return false;
  const value: ClaimValue = { slot, at: now };
  const res = await deps.writeIfVersion(key, value, row?.version ?? 0);
  return res.ok;
}

/** Give a claim back when the enqueue that it guarded failed, so the next beat retries. */
export async function releaseScheduledSlot(deps: ClaimDeps, key: string, slot: string): Promise<boolean> {
  const row = await deps.read(key);
  const existing = readClaim(row);
  if (!row || !existing || existing.slot !== slot) return false;
  // Overwrite with a marker that no slot matches, so the next claim succeeds.
  const res = await deps.writeIfVersion(key, { slot: '', at: 0 }, row.version);
  return res.ok;
}
