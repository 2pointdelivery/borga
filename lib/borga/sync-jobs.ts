import 'server-only';
import { getBorgaState, setBorgaState } from './persistence';
import { afterRun, EMPTY_SYNC_STATE, isDue, type SyncJobState } from './sync-core';
import { loadFeatures } from './features-server';
import type { FeatureId } from './features';

/**
 * Background sync jobs (ad platforms, market comps, scheduled posts, ...). Later
 * phases call `registerSyncJob`; the cron endpoint calls `runDueSyncJobs` for every
 * workspace that has a connection. Each job keeps its own state (last run, error,
 * exponential backoff) so one failing provider never blocks the others.
 */

export interface SyncJob {
  id: string;
  /** Skipped while this feature flag is off. */
  feature: FeatureId;
  everyMs: number;
  run: (ctx: { userId: string; ws: string }) => Promise<void>;
}

const jobs = new Map<string, SyncJob>();

export function registerSyncJob(job: SyncJob): void {
  jobs.set(job.id, job);
}

export const listSyncJobs = (): SyncJob[] => [...jobs.values()];

const stateKey = (u: string, ws: string, id: string) => `t::${u}::${ws}::sync::${id}`;

export async function getSyncStates(u: string, ws: string): Promise<Array<{ id: string; feature: FeatureId; everyMs: number; state: SyncJobState }>> {
  return Promise.all(listSyncJobs().map(async (j) => ({ id: j.id, feature: j.feature, everyMs: j.everyMs, state: (await getBorgaState<SyncJobState>(stateKey(u, ws, j.id))) ?? EMPTY_SYNC_STATE })));
}

export async function runSyncJob(u: string, ws: string, job: SyncJob, force = false): Promise<{ ran: boolean; ok?: boolean; error?: string }> {
  const prev = (await getBorgaState<SyncJobState>(stateKey(u, ws, job.id))) ?? EMPTY_SYNC_STATE;
  if (!force && !isDue(prev, Date.now())) return { ran: false };
  await setBorgaState(stateKey(u, ws, job.id), { ...prev, runningSince: new Date().toISOString() });
  try {
    await job.run({ userId: u, ws });
    await setBorgaState(stateKey(u, ws, job.id), afterRun(prev, true, null, job.everyMs, Date.now()));
    return { ran: true, ok: true };
  } catch (e) {
    const msg = (e as Error).message || 'failed';
    await setBorgaState(stateKey(u, ws, job.id), afterRun(prev, false, msg, job.everyMs, Date.now()));
    return { ran: true, ok: false, error: msg };
  }
}

export async function runDueSyncJobs(u: string, ws: string): Promise<Record<string, unknown>> {
  const flags = (await loadFeatures(u, ws)).flags;
  const out: Record<string, unknown> = {};
  for (const job of listSyncJobs()) {
    out[job.id] = flags[job.feature] ? await runSyncJob(u, ws, job) : { ran: false, skipped: `feature "${job.feature}" is off` };
  }
  return out;
}
