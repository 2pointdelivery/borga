import 'server-only';
import { getBorgaState, setBorgaState, scopedKey } from './persistence';
import { userWsKey } from './keys';
import { buildAgentContext, resolveLlm } from './agent-context';
import { executeAgentRun, executePlannedSteps, persistRun, auditRun, MAX_RUN_STEPS } from './agent-runner';
import { TOOL_NAMES } from './tools';
import { addNotice } from './notices';
import { loadSettings, settingsKey } from './heartbeat-settings';
import type { RunJob, AgentRun, AgentRunStep, PlannedStep, ScheduledTask, SettingsState } from './data';
import * as core from './run-queue-core';

/**
 * The run queue: every agent run (manual, scheduled, webhook, edited plan) is
 * a persisted job drained by a small in-process worker pool. One execution
 * path — enqueue → claim → run → persist/audit — that the Runs & Queue tab
 * makes visible: queued order, which worker is busy, live steps, cancel and
 * retry. The queue lives in the database, so a server restart requeues stale
 * running jobs instead of losing them.
 */

export const DEFAULT_WORKERS = 3;
export const MAX_WORKERS = 8;
const POLL_IDLE_MS = 1000;
const MAX_JOB_STEPS_STORED = 60;

export function queueKey(userId: string | null | undefined, ws: string | null | undefined): string {
  return ws && userId ? userWsKey(userId, ws, 'runQueue') : scopedKey(ws, 'runQueue');
}

export async function loadJobs(ws: string | null | undefined, userId: string | null | undefined): Promise<RunJob[]> {
  return (await getBorgaState<RunJob[]>(queueKey(userId, ws))) ?? [];
}

async function saveJobs(jobs: RunJob[], ws: string | null, userId: string | null): Promise<void> {
  await setBorgaState(queueKey(userId, ws), core.trimJobs(jobs));
}

export async function getJob(id: string, ws: string | null, userId: string | null): Promise<RunJob | null> {
  return (await loadJobs(ws, userId)).find((j) => j.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// Worker pools — module state keyed by `${userId}|${ws}`. Claims are
// serialized per pool with a promise chain: within one process only one
// worker can hold the claim lock at a time, so load-modify-save is sound.
// ---------------------------------------------------------------------------

interface WorkerState {
  id: string;
  busyJobId: string | null;
  busyGoal: string | null;
  startedAt: string | null;
}

interface Pool {
  workers: Map<string, WorkerState>;
  desired: number;
  claimLock: Promise<unknown>;
  running: boolean;
}

// Global registry: Next.js dev HMR reloads this module, and two live worker
// pools would race on claims against the same database row. Anchoring the
// pools on globalThis keeps exactly one pool per user+workspace per process.
const POOLS = ((globalThis as { __borgaRunPools?: Map<string, Pool> }).__borgaRunPools ??= new Map<string, Pool>());

function poolKey(ws: string | null, userId: string | null): string {
  return `${userId ?? 'anon'}|${ws ?? 'global'}`;
}

async function workerCount(ws: string | null, userId: string | null): Promise<number> {
  const settings = await loadSettings(ws, userId);
  const n = settings?.queueWorkers ?? DEFAULT_WORKERS;
  return Math.max(1, Math.min(MAX_WORKERS, Math.floor(n)));
}

export async function setWorkerCount(ws: string | null, userId: string | null, n: number): Promise<number> {
  const clamped = Math.max(1, Math.min(MAX_WORKERS, Math.floor(n)));
  const key = settingsKey(ws, userId);
  const settings = (await getBorgaState<SettingsState>(key)) ?? ({ notifications: { tasks: true, handoffs: true, sync: false, voice: false }, crmUrl: '' } as SettingsState);
  await setBorgaState(key, { ...settings, queueWorkers: clamped });
  ensureWorkers(ws, userId, clamped);
  return clamped;
}

/**
 * Live snapshot for the Runs & Queue tab. Never returns empty when a count is
 * configured — a missing pool (cold boot) reports idle workers so the UI
 * always shows the pool as running instead of "starts with the next job".
 */
export function workersSnapshot(ws: string | null, userId: string | null, configuredFallback?: number): WorkerState[] {
  const pool = POOLS.get(poolKey(ws, userId));
  if (!pool) {
    const n = Math.max(1, Math.min(MAX_WORKERS, Math.floor(configuredFallback ?? DEFAULT_WORKERS)));
    return Array.from({ length: n }, (_, i) => ({ id: `w${i + 1}`, busyJobId: null, busyGoal: null, startedAt: null }));
  }
  if (pool.workers.size === 0) {
    return Array.from({ length: pool.desired }, (_, i) => ({ id: `w${i + 1}`, busyJobId: null, busyGoal: null, startedAt: null }));
  }
  return [...pool.workers.values()];
}

function ensureWorkers(ws: string | null, userId: string | null, desired?: number): void {
  const key = poolKey(ws, userId);
  let pool = POOLS.get(key);
  if (!pool) {
    pool = { workers: new Map(), desired: desired ?? DEFAULT_WORKERS, claimLock: Promise.resolve(), running: false };
    POOLS.set(key, pool);
  }
  if (typeof desired === 'number') pool.desired = desired;
  let index = pool.workers.size;
  while (pool.workers.size < pool.desired) {
    index++;
    const id = `w${index}`;
    pool.workers.set(id, { id, busyJobId: null, busyGoal: null, startedAt: null });
    void workerLoop(key, id);
  }
  if (!pool.running) void pumpLoop(key);
}

/** Serialize claim attempts within one pool so two workers never claim the same job. */
function withClaimLock(pool: Pool, fn: () => Promise<void>): Promise<void> {
  const next = pool.claimLock.then(fn, fn);
  pool.claimLock = next.catch(() => undefined);
  return next;
}

async function claimNext(ws: string | null, userId: string | null, workerId: string, pool: Pool): Promise<RunJob | null> {
  let claimed: RunJob | null = null;
  await withClaimLock(pool, async () => {
    const jobs = await loadJobs(ws, userId);
    const now = new Date();
    let next = jobs;

    // Requeue jobs whose worker vanished (server restart / HMR). Two cases:
    // 1. worker id unknown to this pool (old pool died) → reclaim past the
    //    short orphan window; 2. worker id reused on boot (w1..wN collide
    //    with the old run) but no live worker actually holds the job → the
    //    row would look owned forever, so reclaim it too.
    const known = new Set(pool.workers.keys());
    const busyJobIds = new Set([...pool.workers.values()].map((w) => w.busyJobId).filter(Boolean) as string[]);
    let reclaimed = false;
    next = jobs.map((j) => {
      if (core.isReclaimable(j, now.getTime(), known)) {
        reclaimed = true;
        return core.requeueStale(j);
      }
      if (j.status === 'running' && j.startedAt && !busyJobIds.has(j.id)) {
        const age = now.getTime() - new Date(j.startedAt).getTime();
        if (age > core.RECLAIM_ORPHAN_MS) {
          reclaimed = true;
          return core.requeueStale(j);
        }
      }
      return j;
    });
    if (reclaimed) await saveJobs(next, ws, userId);

    const job = core.nextQueuedJob(next);
    if (!job) return;
    const nowIso = now.toISOString();
    claimed = core.claim(job, workerId, nowIso);
    await saveJobs(next.map((j) => (j.id === job.id ? claimed! : j)), ws, userId);
  });
  return claimed;
}

async function updateJob(ws: string | null, userId: string | null, id: string, fn: (job: RunJob) => RunJob): Promise<RunJob | null> {
  const jobs = await loadJobs(ws, userId);
  let updated: RunJob | null = null;
  const next = jobs.map((j) => {
    if (j.id !== id) return j;
    updated = fn(j);
    return updated;
  });
  await saveJobs(next, ws, userId);
  return updated;
}

// Step appends are read-modify-write on the whole jobs array; unserialized
// they would race each other (and the terminal write), losing live progress.
// A per-job promise chain keeps them ordered and lets runJob flush before
// finalizing the job.
const STEP_CHAINS = new Map<string, Promise<void>>();

function appendStepToJob(ws: string | null, userId: string | null, jobId: string, step: AgentRunStep): void {
  const prev = STEP_CHAINS.get(jobId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(async () => {
    try {
      const jobs = await loadJobs(ws, userId);
      const saved = jobs.map((j) => (j.id === jobId ? { ...j, steps: [...(j.steps ?? []), step].slice(-MAX_JOB_STEPS_STORED) } : j));
      await saveJobs(saved, ws, userId);
    } catch {
      // Live progress is best-effort; the run record itself is persisted on finish.
    }
  });
  STEP_CHAINS.set(jobId, next);
}

/** Wait until every queued step-append for a job has landed (called before the terminal write). */
async function flushSteps(jobId: string): Promise<void> {
  await (STEP_CHAINS.get(jobId) ?? Promise.resolve()).catch(() => undefined);
  STEP_CHAINS.delete(jobId);
}

async function jobCancelRequested(ws: string | null, userId: string | null, jobId: string): Promise<boolean> {
  const job = await getJob(jobId, ws, userId);
  return job?.cancelRequested === true;
}

/** Update the ScheduledTask that enqueued this job once the run lands. */
async function finalizeScheduledTask(job: RunJob, run: AgentRun, ws: string | null, userId: string | null): Promise<void> {
  if (!job.schedTaskId) return;
  try {
    const key = ws && userId ? userWsKey(userId, ws ?? '', 'scheduledTasks') : scopedKey(ws, 'scheduledTasks');
    const tasks = (await getBorgaState<ScheduledTask[]>(key)) ?? [];
    const now = new Date().toISOString();
    await setBorgaState(key, tasks.map((t) => (t.id === job.schedTaskId
      ? { ...t, lastRun: now, runCount: t.runCount + 1, lastResult: (run.summary ?? 'Completed').slice(0, 300), runningSince: null }
      : t)));
    await addNotice({
      id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: job.urgent ? `Urgent check ran — ${job.goal.slice(0, 60)}` : `Scheduled run finished — ${job.goal.slice(0, 60)}`,
      body: (run.summary ?? 'Completed.').slice(0, 500),
      severity: job.urgent ? 'urgent' : 'noteworthy',
      source: 'scheduler',
      taskId: job.schedTaskId,
      runId: run.id,
      createdAt: now,
      readAt: null,
    }, ws, userId);
  } catch {
    // Best-effort stats update
  }
}

async function runJob(job: RunJob, ws: string | null, userId: string | null): Promise<void> {
  const nowIso = () => new Date().toISOString();
  const hooks = {
    onStep: (step: AgentRunStep) => void appendStepToJob(ws, userId, job.id, step),
    shouldStop: () => jobCancelRequested(ws, userId, job.id),
  };

  let run: AgentRun;
  try {
    const ctx = await buildAgentContext(job.agentId, ws, userId, job.goal);
    if (!ctx) throw new Error(`Agent "${job.agentId}" not found`);
    // The queue shows the real agent name once the worker has looked it up.
    if (ctx.agent.name && ctx.agent.name !== job.agentName) {
      await updateJob(ws, userId, job.id, (j) => ({ ...j, agentName: ctx.agent.name }));
    }
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    if (job.plannedSteps?.length) {
      run = await executePlannedSteps(runId, job.agentId, ctx.agent.name, job.goal, job.plannedSteps, ctx, job.triggeredBy, job.startedAt ?? nowIso(), ws, userId, hooks);
    } else {
      run = await executeAgentRun(runId, job.agentId, ctx.agent.name, job.goal, Math.min(job.maxSteps ?? MAX_RUN_STEPS, MAX_RUN_STEPS), ctx, job.triggeredBy, job.startedAt ?? nowIso(), ws, job.companyName ?? 'the company', userId, hooks);
    }
    await flushSteps(job.id); // live steps land before the terminal write
    await persistRun(run, ws, userId);
    const provider = await resolveLlm(ctx.agent.model || null, ws, userId);
    await auditRun(run, provider?.model ?? null, provider?.providerId ?? null, job.goal.length, ws, userId);
    await finalizeScheduledTask(job, run, ws, userId);
  } catch (e) {
    const error = (e as Error).message || 'Run failed';
    console.error(`[run-queue] job ${job.id} failed:`, error);
    await flushSteps(job.id);
    await updateJob(ws, userId, job.id, (j) => core.failJob(j, error, nowIso()));
    return;
  }

  const cancelled = await jobCancelRequested(ws, userId, job.id);
  await updateJob(ws, userId, job.id, (j) => {
    if (run.status === 'stopped' || cancelled) return core.stoppedJob(j, nowIso());
    if (run.status === 'error') return core.failJob(j, run.summary ?? 'Run failed', nowIso());
    return core.completeJob(j, run.id, nowIso());
  });
}

async function workerLoop(key: string, workerId: string): Promise<void> {
  // Pool key format is `${userId}|${ws}` — round-tripped back apart.
  const [userId, ws] = key.split('|');
  const u = userId === 'anon' ? null : userId;
  const w = ws === 'global' ? null : ws;
  for (;;) {
    try {
      const pool = POOLS.get(key);
      if (!pool) return;
      const me = pool.workers.get(workerId);
      if (!me || pool.desired < Number(workerId.slice(1))) {
        pool.workers.delete(workerId); // worker count lowered — this worker retires
        return;
      }
      let job: RunJob | null = null;
      try {
        job = await claimNext(w, u, workerId, pool);
      } catch (e) {
        console.error(`[run-queue] worker ${workerId} claim failed:`, (e as Error)?.message ?? e);
        await new Promise((r) => setTimeout(r, POLL_IDLE_MS));
        continue;
      }
      if (!job) {
        await new Promise((r) => setTimeout(r, POLL_IDLE_MS));
        continue;
      }
      me.busyJobId = job.id;
      me.busyGoal = job.goal;
      me.startedAt = new Date().toISOString();
      try {
        await runJob(job, w, u);
      } catch (e) {
        console.error(`[run-queue] worker ${workerId} job ${job.id} crashed:`, (e as Error)?.message ?? e);
      } finally {
        me.busyJobId = null;
        me.busyGoal = null;
        me.startedAt = null;
      }
    } catch (e) {
      // Never let a worker die: back off and re-enter the loop.
      console.error(`[run-queue] worker ${workerId} loop error:`, (e as Error)?.message ?? e);
      await new Promise((r) => setTimeout(r, POLL_IDLE_MS));
    }
  }
}

/** Keeps the pool alive and its size in sync with settings; exits with the event loop when idle. */
async function pumpLoop(key: string): Promise<void> {
  const pool = POOLS.get(key);
  if (!pool) return;
  if (pool.running) return; // one pump per pool — HMR re-entry must not stack loops
  pool.running = true;
  const [userId, ws] = key.split('|');
  const u = userId === 'anon' ? null : userId;
  const w = ws === 'global' ? null : ws;
  for (;;) {
    try {
      const desired = await workerCount(w, u);
      if (desired !== pool.desired) {
        pool.desired = desired;
        let index = 0;
        for (const id of [...pool.workers.keys()]) {
          index++;
          if (index > desired) pool.workers.delete(id); // loops see the delete and retire
        }
        ensureWorkers(w, u, desired);
      }
    } catch (e) {
      console.error('[run-queue] pump loop error:', (e as Error)?.message ?? e);
    }
    await new Promise((r) => setTimeout(r, 30_000));
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface EnqueueOptions {
  agentId: string;
  agentName?: string;
  goal: string;
  triggeredBy: AgentRun['triggeredBy'];
  ws?: string | null;
  userId?: string | null;
  urgent?: boolean;
  /** 0 (most important) to 3. See RunJob.priority. */
  priority?: 0 | 1 | 2 | 3;
  schedTaskId?: string;
  plannedSteps?: PlannedStep[];
  companyName?: string;
  maxSteps?: number;
}

/** Enqueue a run. Workers are started lazily — this call never blocks on them. */
export async function enqueueRun(opts: EnqueueOptions): Promise<RunJob> {
  const { ws = null, userId = null } = opts;
  if (opts.plannedSteps?.length) {
    const v = core.validatePlanSteps(opts.plannedSteps, TOOL_NAMES);
    if (!v.ok) throw new Error(v.error);
  }
  const jobs = await loadJobs(ws, userId);
  const job: RunJob = {
    id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    agentId: opts.agentId,
    agentName: opts.agentName ?? opts.agentId,
    goal: opts.goal.slice(0, 2000),
    triggeredBy: opts.triggeredBy,
    status: 'queued',
    enqueuedAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    workerId: null,
    runId: null,
    error: null,
    cancelRequested: false,
    urgent: opts.urgent,
    priority: opts.priority,
    schedTaskId: opts.schedTaskId ?? null,
    plannedSteps: opts.plannedSteps,
    steps: [],
    maxSteps: opts.maxSteps,
  };
  await saveJobs([...jobs, job], ws, userId);
  ensureWorkers(ws, userId);
  return job;
}

/**
 * Edit a queued job before a worker claims it (goal, agent, urgency, step
 * budget). Returns null when the job is missing, { job: null, reason } when
 * it already left the queue. Running jobs stop via cancelJob instead.
 */
export async function updateQueuedJob(
  id: string, ws: string | null, userId: string | null,
  patch: { goal?: string; agentId?: string; agentName?: string; urgent?: boolean; maxSteps?: number },
): Promise<{ job: RunJob | null; reason?: 'not-found' | 'not-queued' }> {
  const job = await getJob(id, ws, userId);
  if (!job) return { job: null, reason: 'not-found' };
  if (job.status !== 'queued') return { job, reason: 'not-queued' };
  const updated = core.updateQueued(job, patch, MAX_RUN_STEPS);
  if (!updated) return { job, reason: 'not-queued' };
  await updateJob(ws, userId, id, () => updated);
  return { job: updated };
}

/** Cancel a job: queued jobs leave immediately, running ones stop at the next step boundary. */
export async function cancelJob(id: string, ws: string | null, userId: string | null): Promise<RunJob | null> {
  const job = await getJob(id, ws, userId);
  if (!job) return null;
  if (job.status === 'queued') return updateJob(ws, userId, id, (j) => core.cancelQueued(j, new Date().toISOString()));
  if (job.status === 'running') return updateJob(ws, userId, id, (j) => core.requestCancel(j));
  return job;
}

/** Requeue a failed job with the same id (history stays in one row). */
export async function retryJob(id: string, ws: string | null, userId: string | null): Promise<RunJob | null> {
  const job = await getJob(id, ws, userId);
  if (!job || job.status !== 'error') return job;
  const updated = await updateJob(ws, userId, id, (j) => core.retryJob(j));
  ensureWorkers(ws, userId);
  return updated;
}

/** Enqueue a fresh copy of any finished job. */
export async function rerunJob(id: string, ws: string | null, userId: string | null): Promise<RunJob | null> {
  const job = await getJob(id, ws, userId);
  if (!job) return null;
  return enqueueRun({
    agentId: job.agentId,
    agentName: job.agentName,
    goal: job.goal,
    triggeredBy: 'user',
    ws,
    userId,
    urgent: job.urgent,
    plannedSteps: job.plannedSteps,
    maxSteps: job.maxSteps,
  });
}

/** Queue + worker snapshot for the UI, newest-first within status groups. */
export async function listQueue(ws: string | null, userId: string | null): Promise<{ jobs: RunJob[]; workers: WorkerState[]; configured: number }> {
  ensureWorkers(ws, userId);
  const configured = await workerCount(ws, userId);
  // Touch the pool so the first snapshot already reports live workers.
  ensureWorkers(ws, userId, configured);
  const jobs = core.queueViewOrder(await loadJobs(ws, userId));
  return { jobs, workers: workersSnapshot(ws, userId, configured), configured };
}
