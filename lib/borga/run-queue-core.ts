import type { RunJob, RunJobStatus, PlannedStep } from './data';

/**
 * Pure state machine for the run queue — no I/O, so it is unit-testable and
 * importable anywhere (client or server). The persisted queue lives in
 * run-queue.ts; every mutation here is a plain object transition.
 */

/** How long a "running" job may look stuck before a fresh process requeues it. */
export const RECLAIM_STALE_MS = 15 * 60 * 1000;

/**
 * Short grace for jobs whose worker is gone entirely (server restart / HMR):
 * the pool reuses w1..wN ids on boot, so an old "running" row can look owned
 * by a live worker. Anything still running past this window with no worker
 * actually holding it is requeued instead of stuck.
 */
export const RECLAIM_ORPHAN_MS = 60 * 1000;

/** Upper bound on stored jobs (older terminal jobs are pruned first). */
export const MAX_QUEUE_JOBS = 200;

const TRIGGER_RANK: Record<RunJob['triggeredBy'], number> = {
  user: 0,
  scheduler: 1,
  webhook: 2,
  handoff: 3,
};

/** Lower sorts first: urgent jobs, then user > scheduler > webhook > handoff, then FIFO. */
export function jobRank(job: RunJob): number {
  return (job.urgent ? 0 : 1) * 1000 + TRIGGER_RANK[job.triggeredBy] * 100 + (Date.parse(job.enqueuedAt) % 1e12);
}

/** The next queued job a worker should claim, or null when the queue is empty. */
export function nextQueuedJob(jobs: RunJob[]): RunJob | null {
  const queued = jobs.filter((j) => j.status === 'queued' && !j.cancelRequested);
  if (!queued.length) return null;
  return queued.reduce((best, j) => (jobRank(j) < jobRank(best) ? j : best));
}

/** A queued job the user cancelled leaves the queue immediately. */
export function cancelQueued(job: RunJob, now: string): RunJob {
  return { ...job, status: 'cancelled' as RunJobStatus, completedAt: now, cancelRequested: false };
}

/** A running job only gets the request flag; the worker honors it between steps. */
export function requestCancel(job: RunJob): RunJob {
  return { ...job, cancelRequested: true };
}

export function claim(job: RunJob, workerId: string, now: string): RunJob {
  return { ...job, status: 'running' as RunJobStatus, workerId, startedAt: now, cancelRequested: false };
}

export function completeJob(job: RunJob, runId: string, now: string): RunJob {
  return { ...job, status: 'complete' as RunJobStatus, runId, completedAt: now, error: null, cancelRequested: false };
}

export function failJob(job: RunJob, error: string, now: string): RunJob {
  return { ...job, status: 'error' as RunJobStatus, error, completedAt: now, cancelRequested: false };
}

/** A running job that stopped at a step boundary because cancel was requested. */
export function stoppedJob(job: RunJob, now: string): RunJob {
  return { ...job, status: 'cancelled' as RunJobStatus, completedAt: now, cancelRequested: false };
}

/** Reset a failed job back to the queue (keeps the history in one row). */
export function retryJob(job: RunJob): RunJob {
  return { ...job, status: 'queued' as RunJobStatus, error: null, cancelRequested: false, startedAt: null, completedAt: null, workerId: null, steps: [] };
}

export interface QueuedJobPatch {
  goal?: string;
  agentId?: string;
  agentName?: string;
  urgent?: boolean;
  maxSteps?: number;
}

/**
 * Edit a queued job before a worker picks it up: goal, agent, urgency and
 * step budget. Running/terminal jobs are never rewritten — the worker owns
 * them by then (returns null so callers can 409).
 */
export function updateQueued(job: RunJob, patch: QueuedJobPatch, maxSteps = 8): RunJob | null {
  if (job.status !== 'queued') return null;
  const next: RunJob = { ...job };
  if (typeof patch.goal === 'string' && patch.goal.trim()) next.goal = patch.goal.trim().slice(0, 2000);
  if (typeof patch.agentId === 'string' && patch.agentId.trim()) next.agentId = patch.agentId.trim().slice(0, 50);
  if (typeof patch.agentName === 'string' && patch.agentName.trim()) next.agentName = patch.agentName.trim().slice(0, 80);
  if (typeof patch.urgent === 'boolean') next.urgent = patch.urgent;
  if (typeof patch.maxSteps === 'number' && Number.isFinite(patch.maxSteps)) {
    next.maxSteps = Math.max(1, Math.min(maxSteps, Math.floor(patch.maxSteps)));
  }
  return next;
}

/**
 * A "running" job whose worker has vanished (server restart, dev HMR) is
 * reclaimable once it has been running past the stale window — the queue is
 * persisted, so the work resumes instead of being lost.
 */
export function isReclaimable(job: RunJob, nowMs: number, knownWorkerIds: Set<string>, staleMs = RECLAIM_STALE_MS): boolean {
  if (job.status !== 'running' || !job.startedAt) return false;
  if (knownWorkerIds.has(job.workerId ?? '')) return false;
  return nowMs - new Date(job.startedAt).getTime() > staleMs;
}

/** Put a reclaimable job back in the queue as if it had never started. */
export function requeueStale(job: RunJob): RunJob {
  return { ...job, status: 'queued' as RunJobStatus, workerId: null, startedAt: null, steps: job.steps ?? [] };
}

export function isTerminal(job: RunJob): boolean {
  return job.status === 'complete' || job.status === 'error' || job.status === 'cancelled';
}

/**
 * Queue read order for the UI: active work first (queued by rank, running
 * oldest-first), then terminal jobs newest-first.
 */
export function queueViewOrder(jobs: RunJob[]): RunJob[] {
  const queued = jobs.filter((j) => j.status === 'queued').sort((a, b) => jobRank(a) - jobRank(b));
  const running = jobs.filter((j) => j.status === 'running').sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
  const terminal = jobs.filter(isTerminal).sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)));
  return [...running, ...queued, ...terminal];
}

/** Keep the stored queue bounded: prune oldest terminal jobs first, cap queued ones never. */
export function trimJobs(jobs: RunJob[]): RunJob[] {
  const terminal = jobs.filter(isTerminal);
  const active = jobs.filter((j) => !isTerminal(j));
  const keep = Math.max(0, MAX_QUEUE_JOBS - active.length);
  terminal.sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)));
  return [...active, ...terminal.slice(0, keep)];
}

export interface PlanValidation {
  ok: boolean;
  error?: string;
}

/**
 * Validate an edited plan before it is queued: every step must name a real
 * tool, carry an object of params and a sane thought; the whole plan must fit
 * the runner's step budget.
 */
export function validatePlanSteps(steps: unknown, validToolNames: string[], maxSteps = 12): PlanValidation {
  if (!Array.isArray(steps) || steps.length === 0) return { ok: false, error: 'A plan needs at least one step.' };
  if (steps.length > maxSteps) return { ok: false, error: `A plan can have at most ${maxSteps} steps.` };
  const names = new Set(validToolNames);
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i] as Partial<PlannedStep>;
    if (!s || typeof s !== 'object') return { ok: false, error: `Step ${i + 1} is not an object.` };
    if (typeof s.toolName !== 'string' || !names.has(s.toolName)) {
      return { ok: false, error: `Step ${i + 1}: unknown tool "${String(s.toolName)}".` };
    }
    if (s.params == null || typeof s.params !== 'object' || Array.isArray(s.params)) {
      return { ok: false, error: `Step ${i + 1}: params must be an object.` };
    }
    if (typeof s.thought !== 'string' || !s.thought.trim()) {
      return { ok: false, error: `Step ${i + 1}: every step needs a thought.` };
    }
  }
  return { ok: true };
}
