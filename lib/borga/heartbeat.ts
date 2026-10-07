import 'server-only';
import { getBorgaState, setBorgaState, listBorgaKeys, scopedKey } from './persistence';
import { userWsKey } from './keys';
import { INITIAL_SCHEDULED_TASKS, type ScheduledTask, type ScheduleInterval, type ProactiveNotice } from './data';
import { enqueueRun } from './run-queue';
import { loadSettings, DEFAULT_QUIET } from './heartbeat-settings';
import { addNotice } from './notices';

// Settings + notices moved to their own modules: the run queue needs both and
// heartbeat needs the queue — re-exported here so every existing import keeps working.
export { DEFAULT_QUIET, loadSettings, settingsKey } from './heartbeat-settings';
export { noticesKey, loadNotices, addNotice } from './notices';

/**
 * Always-on home: the heartbeat as a plain library. The browser tick, the
 * scheduler route, and the cron entrypoint are all thin callers of
 * tickWorkspace — the loop doesn't care which machine it's on. Relocation is
 * a new caller, not a rewrite. Due tasks no longer run inline: they enqueue
 * on the run queue and the worker pool executes them (visible, cancellable,
 * concurrency-bounded), then updates each task's stats when the run lands.
 */

export const OVERLAP_STALE_MS = 15 * 60 * 1000;

export function computeNextRun(interval: ScheduleInterval): string {
  const d = new Date();
  switch (interval) {
    case 'hourly': d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1); break;
    case 'daily': d.setDate(d.getDate() + 1); d.setHours(8, 0, 0, 0); break;
    case 'weekly': d.setDate(d.getDate() + (7 - d.getDay() + 1) % 7 || 7); d.setHours(8, 0, 0, 0); break;
    case 'monthly': d.setMonth(d.getMonth() + 1); d.setDate(1); d.setHours(8, 0, 0, 0); break;
  }
  return d.toISOString();
}

export function tasksKey(ws: string | null | undefined, userId: string | null | undefined): string {
  return ws && userId ? userWsKey(userId, ws, 'scheduledTasks') : scopedKey(ws, 'scheduledTasks');
}

export async function loadTasks(ws: string | null | undefined, userId: string | null | undefined): Promise<ScheduledTask[]> {
  const key = tasksKey(ws, userId);
  const stored = await getBorgaState<ScheduledTask[]>(key);
  if (stored && stored.length > 0) return stored;
  const seeded = INITIAL_SCHEDULED_TASKS.map((t) => ({
    ...t,
    nextRun: t.enabled ? computeNextRun(t.interval) : null,
  }));
  await setBorgaState(key, seeded);
  return seeded;
}

export async function saveTasks(tasks: ScheduledTask[], ws: string | null | undefined, userId: string | null | undefined): Promise<void> {
  await setBorgaState(tasksKey(ws, userId), tasks.slice(0, 50));
}

function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Non-urgent checks wait out the quiet window; urgent ones pass. */
export function inQuietHours(now: Date, quiet?: { start: string; end: string } | null): boolean {
  const q = quiet ?? DEFAULT_QUIET;
  const s = toMinutes(q.start) ?? toMinutes(DEFAULT_QUIET.start)!;
  const e = toMinutes(q.end) ?? toMinutes(DEFAULT_QUIET.end)!;
  const cur = now.getHours() * 60 + now.getMinutes();
  return s <= e ? cur >= s && cur < e : cur >= s || cur < e;
}

export function isRunning(task: ScheduledTask, nowMs = Date.now()): boolean {
  return !!task.runningSince && nowMs - new Date(task.runningSince).getTime() < OVERLAP_STALE_MS;
}

export interface TickResult {
  paused?: boolean;
  triggered: string[];
  held: string[];
  skippedOverlap: string[];
  checked: number;
}

/**
 * One heartbeat beat for one workspace. Kill switch first, overlap-skip
 * second, quiet-hours defer third. Due tasks are enqueued on the run queue —
 * the pool executes them and updates the task row (runCount, lastResult) on
 * completion, so a slow run never blocks the tick.
 */
export async function tickWorkspace(ws: string | null, userId: string | null): Promise<TickResult> {
  const now = new Date();
  const settings = await loadSettings(ws, userId);
  if (settings?.heartbeatPaused === true) {
    return { paused: true, triggered: [], held: [], skippedOverlap: [], checked: 0 };
  }
  // Hand fresh work to the agents that own it (stale leads, overdue invoices, unowned tickets). Never blocks the beat.
  if (ws && userId) void import('./automations').then((m) => m.runAutomations(userId, ws)).catch((e) => console.error('[automation] scan failed', e));
  const tasks = await loadTasks(ws, userId);
  const due = tasks.filter((t) => t.enabled && t.nextRun && new Date(t.nextRun) <= now);
  if (!due.length) return { triggered: [], held: [], skippedOverlap: [], checked: tasks.length };

  const quiet = inQuietHours(now, settings?.quietHours ?? null);
  const triggered: string[] = [];
  const held: string[] = [];
  const skippedOverlap: string[] = [];

  for (const task of due) {
    if (isRunning(task, now.getTime())) {
      skippedOverlap.push(task.id);
      continue;
    }
    if (quiet && !task.urgent) {
      held.push(task.id);
      const notice: ProactiveNotice = {
        id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        title: `Held for quiet hours — ${task.name}`,
        body: `Due at ${now.toLocaleTimeString()} but quiet hours are on. It will run after the window.`,
        severity: 'info',
        source: 'scheduler',
        taskId: task.id,
        createdAt: now.toISOString(),
        readAt: null,
      };
      await addNotice(notice, ws, userId);
      continue;
    }
    try {
      await enqueueRun({ agentId: task.agentId, goal: task.goal, triggeredBy: 'scheduler', ws, userId, urgent: task.urgent, schedTaskId: task.id, maxSteps: 6 });
      triggered.push(task.id);
      // Mark running + push nextRun now so the next tick can't double-fire a slow run.
      await setBorgaState(tasksKey(ws, userId), (await loadTasks(ws, userId)).map((t) => (t.id === task.id ? { ...t, runningSince: now.toISOString(), nextRun: computeNextRun(t.interval) } : t)));
    } catch {
      // Enqueue failed — leave the marker clear so the next tick retries.
    }
  }

  const latest = await loadTasks(ws, userId);
  const updated = latest.map((t) => {
    if (held.includes(t.id)) return { ...t, lastResult: `Held for quiet hours at ${now.toLocaleTimeString()} — runs after the window.` };
    if (skippedOverlap.includes(t.id)) return t;
    if (!triggered.includes(t.id)) return { ...t, runningSince: null };
    return t; // already marked runningSince + nextRun at enqueue time
  });
  await saveTasks(updated, ws, userId);
  return { triggered, held, skippedOverlap, checked: tasks.length };
}

/** Manual trigger: bypasses quiet hours (user is present), keeps overlap guard. Enqueues and returns immediately. */
export async function triggerTask(ws: string | null, userId: string | null, id: string): Promise<{ ok: boolean; jobId?: string; error?: string }> {
  const tasks = await loadTasks(ws, userId);
  const task = tasks.find((t) => t.id === id);
  if (!task) return { ok: false, error: 'Task not found' };
  if (isRunning(task)) return { ok: false, error: 'That check is still running — skipped to avoid overlap.' };
  const now = new Date();
  await setBorgaState(tasksKey(ws, userId), tasks.map((t) => (t.id === id ? { ...t, runningSince: now.toISOString() } : t)));
  try {
    const job = await enqueueRun({ agentId: task.agentId, goal: task.goal, triggeredBy: 'scheduler', ws, userId, urgent: task.urgent, schedTaskId: id, maxSteps: 6 });
    return { ok: true, jobId: job.id };
  } catch (e) {
    const latest = await loadTasks(ws, userId);
    await saveTasks(latest.map((t) => (t.id === id ? { ...t, runningSince: null } : t)), ws, userId);
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Cron enumeration: every workspace with a schedule, derived from stored
 * scheduledTasks keys (`u::<userId>::ws::<ws>::scheduledTasks`). No session
 * needed — the cron secret authorizes the sweep, per-ws keys scope the work.
 */
export async function listScheduledWorkspaces(): Promise<Array<{ ws: string; userId: string }>> {
  const keys = await listBorgaKeys('u::%::ws::%::scheduledTasks'); // keys only, not every row's JSON
  const out: Array<{ ws: string; userId: string }> = [];
  for (const key of keys) {
    const m = /^u::([^:]+)::ws::([^:]+)::scheduledTasks$/.exec(key);
    if (m) out.push({ userId: m[1], ws: m[2] });
  }
  return out;
}
