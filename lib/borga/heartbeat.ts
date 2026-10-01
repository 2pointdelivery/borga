import 'server-only';
import { getBorgaState, setBorgaState, listBorgaKeys, scopedKey } from './persistence';
import { userWsKey } from './keys';
import { INITIAL_SCHEDULED_TASKS, INITIAL_NOTICES, type ScheduledTask, type ScheduleInterval, type SettingsState, type ProactiveNotice } from './data';
import { buildAgentContext } from './agent-context';
import { executeAgentRun, persistRun, auditRun } from './agent-runner';

/**
 * Always-on home: the heartbeat as a plain library. The browser tick, the
 * scheduler route, and the cron entrypoint are all thin callers of
 * tickWorkspace — the loop doesn't care which machine it's on. Relocation is
 * a new caller, not a rewrite.
 */

export const DEFAULT_QUIET = { start: '22:00', end: '07:00' };
export const OVERLAP_STALE_MS = 15 * 60 * 1000;

export function computeNextRun(interval: ScheduleInterval, fromNow = true): string {
  const now = new Date();
  const d = fromNow ? new Date(now) : new Date(now);
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

export function noticesKey(ws: string | null | undefined, userId: string | null | undefined): string {
  return ws && userId ? userWsKey(userId, ws, 'notices') : scopedKey(ws, 'notices');
}

export function settingsKey(ws: string | null | undefined, userId: string | null | undefined): string {
  return ws && userId ? userWsKey(userId, ws, 'settings') : scopedKey(ws, 'settings');
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

export async function loadNotices(ws: string | null | undefined, userId: string | null | undefined): Promise<ProactiveNotice[]> {
  return (await getBorgaState<ProactiveNotice[]>(noticesKey(ws, userId))) ?? [...INITIAL_NOTICES];
}

export async function addNotice(notice: ProactiveNotice, ws: string | null | undefined, userId: string | null | undefined): Promise<void> {
  const existing = await loadNotices(ws, userId);
  await setBorgaState(noticesKey(ws, userId), [notice, ...existing].slice(0, 100));
  if (notice.severity === 'urgent' && ws && userId) void import('./email-notify').then((m) => m.notifyEvent(userId, ws, 'agent_urgent', { title: notice.title, body: notice.body, at: notice.createdAt })).catch(() => undefined);
}

export async function loadSettings(ws: string | null | undefined, userId: string | null | undefined): Promise<SettingsState | null> {
  return (await getBorgaState<SettingsState>(settingsKey(ws, userId))) ?? null;
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
 * second, quiet-hours defer third. In-process runs with explicit ws/userId —
 * no browser session required, so cron and laptop tick share this exactly.
 */
export async function tickWorkspace(ws: string | null, userId: string | null, companyName = 'the company'): Promise<TickResult> {
  const now = new Date();
  const settings = await loadSettings(ws, userId);
  if (settings?.heartbeatPaused === true) {
    return { paused: true, triggered: [], held: [], skippedOverlap: [], checked: 0 };
  }
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
      await addNotice({
        id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        title: `Held for quiet hours — ${task.name}`,
        body: `Due at ${now.toLocaleTimeString()} but quiet hours are on. It will run after the window.`,
        severity: 'info',
        source: 'scheduler',
        taskId: task.id,
        createdAt: now.toISOString(),
        readAt: null,
      }, ws, userId);
      continue;
    }
    await setBorgaState(tasksKey(ws, userId), (await loadTasks(ws, userId)).map((t) => (t.id === task.id ? { ...t, runningSince: now.toISOString() } : t)));
    try {
      const ctx = await buildAgentContext(task.agentId, ws, userId, task.goal);
      const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const run = await executeAgentRun(runId, task.agentId, ctx?.agent.name ?? task.agentId, task.goal, 6, ctx, 'scheduler', now.toISOString(), ws, companyName, userId);
      await persistRun(run, ws, userId);
      await auditRun(run, ctx?.agent.model || null, null, task.goal.length, ws, userId);
      triggered.push(task.id);
      await addNotice({
        id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        title: task.urgent ? `Urgent check ran — ${task.name}` : task.name,
        body: (run.summary ?? `Ran at ${now.toLocaleTimeString()}.`).slice(0, 500),
        severity: task.urgent ? 'urgent' : 'noteworthy',
        source: 'scheduler',
        taskId: task.id,
        runId: run.id,
        createdAt: now.toISOString(),
        readAt: null,
      }, ws, userId);
    } catch {
      // Best-effort; marker cleared below
    }
  }

  const latest = await loadTasks(ws, userId);
  const updated = latest.map((t) => {
    if (held.includes(t.id)) return { ...t, lastResult: `Held for quiet hours at ${now.toLocaleTimeString()} — runs after the window.` };
    if (skippedOverlap.includes(t.id)) return t;
    if (!triggered.includes(t.id)) return { ...t, runningSince: null };
    return { ...t, lastRun: now.toISOString(), nextRun: computeNextRun(t.interval), runCount: t.runCount + 1, lastResult: `Triggered at ${now.toLocaleTimeString()}`, runningSince: null };
  });
  await saveTasks(updated, ws, userId);
  return { triggered, held, skippedOverlap, checked: tasks.length };
}

/** Manual trigger: bypasses quiet hours (user is present), keeps overlap guard. */
export async function triggerTask(ws: string | null, userId: string | null, id: string, companyName = 'the company'): Promise<{ ok: boolean; run?: { id?: string; summary?: string }; error?: string }> {
  const tasks = await loadTasks(ws, userId);
  const task = tasks.find((t) => t.id === id);
  if (!task) return { ok: false, error: 'Task not found' };
  if (isRunning(task)) return { ok: false, error: 'That check is still running — skipped to avoid overlap.' };
  try {
    await setBorgaState(tasksKey(ws, userId), tasks.map((t) => (t.id === id ? { ...t, runningSince: new Date().toISOString() } : t)));
    const ctx = await buildAgentContext(task.agentId, ws, userId, task.goal);
    const now = new Date();
    const run = await executeAgentRun(`run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, task.agentId, ctx?.agent.name ?? task.agentId, task.goal, 6, ctx, 'scheduler', now.toISOString(), ws, companyName, userId);
    await persistRun(run, ws, userId);
    await auditRun(run, ctx?.agent.model || null, null, task.goal.length, ws, userId);
    const latest = await loadTasks(ws, userId);
    await saveTasks(latest.map((t) => (t.id === id ? { ...t, lastRun: now.toISOString(), runCount: t.runCount + 1, lastResult: run.summary ?? 'Completed', runningSince: null } : t)), ws, userId);
    await addNotice({
      id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: task.name,
      body: (run.summary ?? 'Completed manually.').slice(0, 500),
      severity: 'noteworthy',
      source: 'scheduler',
      taskId: id,
      runId: run.id,
      createdAt: now.toISOString(),
      readAt: null,
    }, ws, userId);
    return { ok: true, run: { id: run.id, summary: run.summary } };
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
