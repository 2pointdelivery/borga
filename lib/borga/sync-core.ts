/** Pure scheduling rules for background sync jobs (unit-tested). */

export interface SyncJobState {
  lastRunAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  /** Consecutive failures; reset on success. */
  failures: number;
  /** Earliest next attempt (ISO). */
  nextRunAt: string | null;
  runningSince: string | null;
}

export const EMPTY_SYNC_STATE: SyncJobState = { lastRunAt: null, lastOkAt: null, lastError: null, failures: 0, nextRunAt: null, runningSince: null };

const BASE_BACKOFF_MS = 5 * 60_000;
const MAX_BACKOFF_MS = 6 * 3_600_000;
/** A run claimed longer ago than this is considered crashed and may be retaken. */
export const STALE_RUN_MS = 15 * 60_000;

/** 5 min, 10, 20 … capped at 6 h. */
export function backoffMs(failures: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** Math.max(0, failures - 1), MAX_BACKOFF_MS);
}

export function isDue(state: SyncJobState, now: number): boolean {
  if (state.runningSince && now - new Date(state.runningSince).getTime() < STALE_RUN_MS) return false;
  return !state.nextRunAt || new Date(state.nextRunAt).getTime() <= now;
}

export function afterRun(prev: SyncJobState, ok: boolean, error: string | null, everyMs: number, now: number): SyncJobState {
  const at = new Date(now).toISOString();
  if (ok) {
    return { lastRunAt: at, lastOkAt: at, lastError: null, failures: 0, nextRunAt: new Date(now + everyMs).toISOString(), runningSince: null };
  }
  const failures = prev.failures + 1;
  return { ...prev, lastRunAt: at, lastError: (error ?? 'failed').slice(0, 500), failures, nextRunAt: new Date(now + backoffMs(failures)).toISOString(), runningSince: null };
}
