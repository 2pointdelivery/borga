import test from 'node:test';
import assert from 'node:assert/strict';
import {
  claim, completeJob, failJob, cancelQueued, requestCancel, retryJob, stoppedJob,
  isReclaimable, requeueStale, isTerminal, nextQueuedJob, jobRank, queueViewOrder, trimJobs,
  validatePlanSteps, MAX_QUEUE_JOBS, RECLAIM_STALE_MS,
} from './borga/run-queue-core';
import { planFromGoal } from './borga/plan-from-goal';
import { TOOL_NAMES } from './borga/tool-names';
import type { RunJob } from './borga/data';

function job(p: Partial<RunJob> = {}): RunJob {
  return {
    id: 'job-1',
    agentId: 'a-borga',
    agentName: 'Borga',
    goal: 'Test goal',
    triggeredBy: 'user',
    status: 'queued',
    enqueuedAt: '2026-10-03T10:00:00.000Z',
    ...p,
  };
}

test('claim marks a job running with its worker', () => {
  const now = '2026-10-03T10:00:01.000Z';
  const claimed = claim(job(), 'w1', now);
  assert.equal(claimed.status, 'running');
  assert.equal(claimed.workerId, 'w1');
  assert.equal(claimed.startedAt, now);
  assert.equal(claimed.cancelRequested, false);
});

test('queued jobs cancel immediately; running jobs only get the request flag', () => {
  const now = '2026-10-03T10:00:02.000Z';
  const cancelled = cancelQueued(job(), now);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.completedAt, now);

  const running = requestCancel(claim(job(), 'w1', now));
  assert.equal(running.status, 'running');
  assert.equal(running.cancelRequested, true);
  // and the worker resolves it as stopped at the boundary
  const stopped = stoppedJob(running, now);
  assert.equal(stopped.status, 'cancelled');
  assert.equal(stopped.cancelRequested, false);
});

test('complete and fail transitions are terminal', () => {
  const now = '2026-10-03T10:00:03.000Z';
  assert.equal(isTerminal(completeJob(claim(job(), 'w1', now), 'run-1', now)), true);
  const failed = failJob(claim(job(), 'w1', now), 'boom', now);
  assert.equal(isTerminal(failed), true);
  assert.equal(failed.error, 'boom');
});

test('retry resets a failed job back to queued with clean execution fields', () => {
  const now = '2026-10-03T10:00:04.000Z';
  const retried = retryJob(failJob(claim(job(), 'w1', now), 'boom', now));
  assert.equal(retried.status, 'queued');
  assert.equal(retried.error, null);
  assert.equal(retried.startedAt, null);
  assert.equal(retried.completedAt, null);
  assert.equal(retried.workerId, null);
  assert.equal(isTerminal(retried), false);
});

test('urgent jobs rank first, then user > scheduler > webhook, then FIFO', () => {
  const base = '2026-10-03T10:00:00.000Z';
  const webhook = job({ id: 'wh', triggeredBy: 'webhook', enqueuedAt: base });
  const sched = job({ id: 'sch', triggeredBy: 'scheduler', enqueuedAt: base });
  const user = job({ id: 'usr', triggeredBy: 'user', enqueuedAt: base });
  const urgentSched = job({ id: 'urg', triggeredBy: 'scheduler', urgent: true, enqueuedAt: base });
  const later = job({ id: 'late', triggeredBy: 'user', enqueuedAt: '2026-10-03T10:00:05.000Z' });

  const pick = (jobs: RunJob[]) => nextQueuedJob(jobs)?.id;
  assert.equal(pick([webhook, sched, user, urgentSched]), 'urg');
  assert.equal(pick([webhook, sched, user]), 'usr');
  assert.equal(pick([webhook, sched]), 'sch');
  assert.equal(pick([user, later]), 'usr'); // FIFO within one rank
  assert.equal(nextQueuedJob([cancelQueued(user, base)]), null); // cancelled queued jobs are never claimed
});

test('jobRank is strictly ordered for the queue view', () => {
  const a = job({ triggeredBy: 'user', enqueuedAt: '2026-10-03T10:00:00.000Z' });
  const b = job({ triggeredBy: 'scheduler', enqueuedAt: '2026-10-03T10:00:00.000Z' });
  assert.ok(jobRank(a) < jobRank(b));
  const u = job({ triggeredBy: 'scheduler', urgent: true, enqueuedAt: '2026-10-03T10:00:00.000Z' });
  assert.ok(jobRank(u) < jobRank(a));
});

test('stale running jobs from dead workers are reclaimable; live ones are not', () => {
  const nowMs = Date.parse('2026-10-03T11:00:00.000Z');
  const staleStarted = new Date(nowMs - RECLAIM_STALE_MS - 1000).toISOString();
  const freshStarted = new Date(nowMs - 1000).toISOString();

  const stale = claim(job(), 'w9', staleStarted);
  const fresh = claim(job(), 'w1', freshStarted);

  assert.equal(isReclaimable(stale, nowMs, new Set(['w1'])), true);
  assert.equal(isReclaimable(fresh, nowMs, new Set(['w1'])), false); // worker still alive
  assert.equal(isReclaimable(claim(job(), 'w9', freshStarted), nowMs, new Set(['w1'])), false); // too recent

  const requeued = requeueStale(stale);
  assert.equal(requeued.status, 'queued');
  assert.equal(requeued.workerId, null);
  assert.equal(requeued.startedAt, null);
});

test('queueViewOrder shows running first, queued by rank, terminal newest-first', () => {
  const now = '2026-10-03T10:00:10.000Z';
  const running = claim(job({ id: 'r1' }), 'w1', now);
  const queued = job({ id: 'q1', triggeredBy: 'scheduler' });
  const done = completeJob(claim(job({ id: 'd1' }), 'w1', '2026-10-03T10:00:00.000Z'), 'run-1', '2026-10-03T10:00:09.000Z');
  const doneOlder = completeJob(claim(job({ id: 'd2' }), 'w1', '2026-10-03T10:00:00.000Z'), 'run-2', '2026-10-03T10:00:05.000Z');

  const ordered = queueViewOrder([doneOlder, queued, done, running]).map((j) => j.id);
  assert.deepEqual(ordered, ['r1', 'q1', 'd1', 'd2']);
});

test('trimJobs never drops active work and caps stored jobs', () => {
  const base = '2026-10-03T10:00:00.000Z';
  const active = Array.from({ length: 5 }, (_, i) => job({ id: `a${i}` }));
  // Distinct completion times: t0 is oldest, t219 is newest.
  const terminal = Array.from({ length: MAX_QUEUE_JOBS + 20 }, (_, i) =>
    completeJob(claim(job({ id: `t${i}` }), 'w1', base), `run-${i}`, new Date(Date.parse(base) + i * 1000).toISOString()));
  const kept = trimJobs([...active, ...terminal]);
  assert.equal(kept.length, MAX_QUEUE_JOBS);
  assert.ok(kept.every((j) => j.id.startsWith('a') || j.status === 'complete'));
  // all active work survives
  for (let i = 0; i < 5; i++) assert.ok(kept.some((j) => j.id === `a${i}`));
  // newest terminal jobs survive, oldest are pruned
  assert.ok(kept.some((j) => j.id === `t${MAX_QUEUE_JOBS + 19}`));
  assert.ok(!kept.some((j) => j.id === 't0'));
});

test('validatePlanSteps rejects bad plans and accepts good ones', () => {
  const good = [{ thought: 'Do it', toolName: 'log_activity', params: { message: 'hi' } }];
  assert.equal(validatePlanSteps(good, TOOL_NAMES).ok, true);
  assert.equal(validatePlanSteps([], TOOL_NAMES).ok, false);
  assert.equal(validatePlanSteps([{ thought: 'x', toolName: 'not_a_tool', params: {} }], TOOL_NAMES).ok, false);
  assert.equal(validatePlanSteps([{ thought: 'x', toolName: 'log_activity', params: 'nope' }], TOOL_NAMES).ok, false);
  assert.equal(validatePlanSteps([{ thought: '', toolName: 'log_activity', params: {} }], TOOL_NAMES).ok, false);
  const tooMany = Array.from({ length: 13 }, () => good[0]);
  assert.equal(validatePlanSteps(tooMany, TOOL_NAMES).ok, false);
});

test('planFromGoal routes goals to the right tools and every tool it emits exists', () => {
  const kpi = planFromGoal('Review KPIs and flag below-target metrics');
  assert.ok(kpi.some((s) => s.toolName === 'query_state'));

  const leads = planFromGoal('Qualify and follow up on the lead pipeline');
  assert.ok(leads.some((s) => s.toolName === 'query_state'));
  assert.ok(leads.some((s) => s.toolName === 'create_task'));

  const generic = planFromGoal('Something completely unrelated');
  assert.ok(generic.length >= 3);
  assert.ok(generic.every((s) => TOOL_NAMES.includes(s.toolName)), 'plan steps must name real tools');

  // Same-shaped steps are exactly what validatePlanSteps accepts for "execute as-is".
  assert.equal(validatePlanSteps(generic, TOOL_NAMES).ok, true);
});

test('the client-safe tool list is unique and matches the planner needs', () => {
  assert.ok(TOOL_NAMES.length > 20);
  assert.equal(new Set(TOOL_NAMES).size, TOOL_NAMES.length);
  for (const must of ['create_task', 'query_state', 'log_activity', 'store_memory', 'delegate']) {
    assert.ok(TOOL_NAMES.includes(must), must);
  }
});
