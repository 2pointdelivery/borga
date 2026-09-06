import { NextResponse, type NextRequest } from 'next/server';
import { getBorgaState, setBorgaState, scopedKey } from '@/lib/borga/persistence';
import { verifySessionToken, sessionCookieName } from '@/lib/auth/session';
import { userWsKey } from '@/lib/borga/keys';
import { INITIAL_SCHEDULED_TASKS, type ScheduledTask, type ScheduleInterval } from '@/lib/borga/data';

export const runtime = 'nodejs';

async function getUserId(req: NextRequest): Promise<string | null> {
  const c = req.cookies.get(sessionCookieName());
  const token = typeof c === 'string' ? c : c?.value;
  return verifySessionToken(token);
}

const VALID_INTERVALS: ScheduleInterval[] = ['hourly', 'daily', 'weekly', 'monthly'];

function computeNextRun(interval: ScheduleInterval, fromNow = true): string {
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

function wsOf(body: Record<string, unknown>): string | null {
  const ws = body.ws;
  return typeof ws === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(ws) ? ws : null;
}

function tasksKey(ws: string | null | undefined, userId: string | null | undefined): string {
  return ws && userId ? userWsKey(userId, ws, 'scheduledTasks') : scopedKey(ws, 'scheduledTasks');
}

async function loadTasks(ws: string | null | undefined, userId: string | null | undefined): Promise<ScheduledTask[]> {
  const key = tasksKey(ws, userId);
  const stored = await getBorgaState<ScheduledTask[]>(key);
  if (stored && stored.length > 0) return stored;
  // Seed defaults with computed nextRun
  const seeded = INITIAL_SCHEDULED_TASKS.map((t) => ({
    ...t,
    nextRun: t.enabled ? computeNextRun(t.interval) : null,
  }));
  await setBorgaState(key, seeded);
  return seeded;
}

async function saveTasks(tasks: ScheduledTask[], ws: string | null | undefined, userId: string | null | undefined): Promise<void> {
  await setBorgaState(tasksKey(ws, userId), tasks.slice(0, 50));
}

// GET  list all scheduled tasks (optionally workspace-scoped)
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const wsParam = url.searchParams.get('ws');
  const ws = wsParam && /^[a-zA-Z0-9_-]{1,64}$/.test(wsParam) ? wsParam : null;
  const userId = await getUserId(req);
  const tasks = await loadTasks(ws, userId);
  return NextResponse.json({ ok: true, tasks });
}

// POST  manage scheduled tasks and trigger tick
export async function POST(req: NextRequest) {
  const csrfHeader = req.headers.get('X-Borga-Client');
  const userId = await getUserId(req);
  // Forwarded to the internal agent-run call so a scheduled/triggered run
  // authenticates as the same user whose session fired this tick — without
  // this, the run has no session and silently falls back to a legacy,
  // disconnected storage key (see lib/borga/tools.ts's key() helper).
  const cookieHeader = req.headers.get('cookie') ?? '';

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 });
  }

  const action = String(body.action ?? 'list');
  const ws = wsOf(body);

  if (action === 'create') {
    const tasks = await loadTasks(ws, userId);
    const interval = VALID_INTERVALS.includes(body.interval as ScheduleInterval)
      ? (body.interval as ScheduleInterval)
      : 'daily';
    const enabled = body.enabled !== false;
    const task: ScheduledTask = {
      id: `sched-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      name: String(body.name ?? 'Unnamed task').slice(0, 100),
      agentId: String(body.agentId ?? 'a-borga').slice(0, 50),
      goal: String(body.goal ?? '').slice(0, 1000),
      interval,
      enabled,
      lastRun: null,
      nextRun: enabled ? computeNextRun(interval) : null,
      runCount: 0,
    };
    if (!task.goal) return NextResponse.json({ ok: false, error: 'goal is required' }, { status: 400 });
    await saveTasks([task, ...tasks], ws, userId);
    return NextResponse.json({ ok: true, task });
  }

  if (action === 'update') {
    const id = String(body.id ?? '');
    const tasks = await loadTasks(ws, userId);
    const idx = tasks.findIndex((t) => t.id === id);
    if (idx === -1) return NextResponse.json({ ok: false, error: 'Task not found' }, { status: 404 });

    const prev = tasks[idx];
    const patch: Partial<ScheduledTask> = {};
    if (body.name) patch.name = String(body.name).slice(0, 100);
    if (body.goal) patch.goal = String(body.goal).slice(0, 1000);
    if (body.agentId) patch.agentId = String(body.agentId).slice(0, 50);
    if (VALID_INTERVALS.includes(body.interval as ScheduleInterval)) patch.interval = body.interval as ScheduleInterval;
    if (typeof body.enabled === 'boolean') {
      patch.enabled = body.enabled;
      patch.nextRun = body.enabled ? computeNextRun(patch.interval ?? prev.interval) : null;
    }

    const updated = { ...prev, ...patch };
    tasks[idx] = updated;
    await saveTasks(tasks, ws, userId);
    return NextResponse.json({ ok: true, task: updated });
  }

  if (action === 'delete') {
    const id = String(body.id ?? '');
    const tasks = await loadTasks(ws, userId);
    const filtered = tasks.filter((t) => t.id !== id);
    await saveTasks(filtered, ws, userId);
    return NextResponse.json({ ok: true, deleted: tasks.length - filtered.length });
  }

  if (action === 'toggle') {
    const id = String(body.id ?? '');
    const tasks = await loadTasks(ws, userId);
    const updated = tasks.map((t) => {
      if (t.id !== id) return t;
      const enabled = !t.enabled;
      return { ...t, enabled, nextRun: enabled ? computeNextRun(t.interval) : null };
    });
    await saveTasks(updated, ws, userId);
    const task = updated.find((t) => t.id === id);
    return NextResponse.json({ ok: true, task });
  }

  // tick — find due tasks, trigger them, return list of triggered task IDs
  if (action === 'tick') {
    const now = new Date();
    const tasks = await loadTasks(ws, userId);
    const due = tasks.filter((t) => t.enabled && t.nextRun && new Date(t.nextRun) <= now);

    if (!due.length) {
      return NextResponse.json({ ok: true, triggered: [], checked: tasks.length });
    }

    const triggered: string[] = [];
    const origin = req.url ? new URL(req.url).origin : '';

    for (const task of due) {
      try {
        // Fire the agent run endpoint (non-streaming)
        const agentRunUrl = `${origin}/api/borga/agent/run`;
        await fetch(agentRunUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard', Cookie: cookieHeader },
          body: JSON.stringify({
            agentId: task.agentId,
            goal: task.goal,
            maxSteps: 6,
            stream: false,
            triggeredBy: 'scheduler',
            ws,
          }),
          signal: AbortSignal.timeout(90000),
        }).catch(() => null); // fire and forget

        triggered.push(task.id);
      } catch {
        // Best-effort
      }
    }

    // Update lastRun and nextRun for all due tasks
    const updatedTasks = tasks.map((t) => {
      if (!triggered.includes(t.id)) return t;
      return {
        ...t,
        lastRun: now.toISOString(),
        nextRun: computeNextRun(t.interval),
        runCount: t.runCount + 1,
        lastResult: `Triggered at ${now.toLocaleTimeString()}`,
      };
    });
    await saveTasks(updatedTasks, ws, userId);

    return NextResponse.json({ ok: true, triggered, checked: tasks.length });
  }

  // trigger — manually trigger a specific task
  if (action === 'trigger') {
    const id = String(body.id ?? '');
    const tasks = await loadTasks(ws, userId);
    const task = tasks.find((t) => t.id === id);
    if (!task) return NextResponse.json({ ok: false, error: 'Task not found' }, { status: 404 });

    const origin = req.url ? new URL(req.url).origin : '';
    const agentRunUrl = `${origin}/api/borga/agent/run`;

    // Non-streaming run — synchronous
    try {
      const runRes = await fetch(agentRunUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard', Cookie: cookieHeader },
        body: JSON.stringify({
          agentId: task.agentId,
          goal: task.goal,
          maxSteps: 6,
          stream: false,
          triggeredBy: 'scheduler',
          ws,
        }),
        signal: AbortSignal.timeout(90000),
      });
      const runData = await runRes.json() as { ok?: boolean; run?: { summary?: string } };

      const now = new Date();
      const updated = tasks.map((t) =>
        t.id === id
          ? { ...t, lastRun: now.toISOString(), runCount: t.runCount + 1, lastResult: runData.run?.summary ?? 'Completed' }
          : t,
      );
      await saveTasks(updated, ws, userId);

      return NextResponse.json({ ok: true, taskId: id, run: runData.run });
    } catch (e) {
      return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
}
