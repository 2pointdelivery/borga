import { NextResponse, type NextRequest } from 'next/server';
import { getBorgaState, setBorgaState } from '@/lib/borga/persistence';
import { verifySessionToken, sessionCookieName } from '@/lib/auth/session';
import { type ScheduledTask, type ScheduleInterval } from '@/lib/borga/data';
import {
  computeNextRun, loadTasks, saveTasks, loadNotices, loadSettings,
  settingsKey, noticesKey, tickWorkspace, triggerTask, DEFAULT_QUIET,
} from '@/lib/borga/heartbeat';

export const runtime = 'nodejs';

async function getUserId(req: NextRequest): Promise<string | null> {
  const c = req.cookies.get(sessionCookieName());
  const token = typeof c === 'string' ? c : c?.value;
  return verifySessionToken(token);
}

const VALID_INTERVALS: ScheduleInterval[] = ['hourly', 'daily', 'weekly', 'monthly'];

function wsOf(body: Record<string, unknown>): string | null {
  const ws = body.ws;
  return typeof ws === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(ws) ? ws : null;
}

// GET — list all scheduled tasks (optionally workspace-scoped)
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const wsParam = url.searchParams.get('ws');
  const ws = wsParam && /^[a-zA-Z0-9_-]{1,64}$/.test(wsParam) ? wsParam : null;
  const userId = await getUserId(req);
  const tasks = await loadTasks(ws, userId);
  return NextResponse.json({ ok: true, tasks });
}

// POST — manage scheduled tasks and trigger tick (thin caller of lib/borga/heartbeat)
export async function POST(req: NextRequest) {
  const userId = await getUserId(req);

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

  // Tier 5 heartbeat controls — durable settings, never literals.
  if (action === 'heartbeat') {
    const settings = await loadSettings(ws, userId);
    return NextResponse.json({
      ok: true,
      paused: settings?.heartbeatPaused === true,
      quietHours: settings?.quietHours ?? DEFAULT_QUIET,
    });
  }

  // Seed full defaults when no settings row exists yet — a partial row would
  // hydrate over DEFAULT_SETTINGS and break readers of notifications/crmUrl.
  const SETTINGS_SEED = { notifications: { tasks: true, handoffs: true, sync: false, voice: true, kpi: false }, crmUrl: '' };

  if (action === 'setHeartbeat') {
    const key = settingsKey(ws, userId);
    const settings = (await getBorgaState<Record<string, unknown>>(key)) ?? { ...SETTINGS_SEED };
    const next = { ...settings, heartbeatPaused: body.paused !== false };
    await setBorgaState(key, next);
    return NextResponse.json({ ok: true, paused: next.heartbeatPaused });
  }

  if (action === 'setQuietHours') {
    const start = String(body.start ?? '').trim();
    const end = String(body.end ?? '').trim();
    if (!/^(\d{1,2}):(\d{2})$/.test(start) || !/^(\d{1,2}):(\d{2})$/.test(end)) {
      return NextResponse.json({ ok: false, error: 'start/end must be HH:MM (24h).' }, { status: 400 });
    }
    const key = settingsKey(ws, userId);
    const settings = (await getBorgaState<Record<string, unknown>>(key)) ?? { ...SETTINGS_SEED };
    const next = { ...settings, quietHours: { start, end } };
    await setBorgaState(key, next);
    return NextResponse.json({ ok: true, quietHours: (next as { quietHours: unknown }).quietHours });
  }

  // Held inbox: what the heartbeat surfaced while you were away. Dismissible.
  if (action === 'notices') {
    return NextResponse.json({ ok: true, notices: await loadNotices(ws, userId) });
  }

  if (action === 'dismissNotice') {
    const id = String(body.id ?? '');
    const existing = await loadNotices(ws, userId);
    await setBorgaState(noticesKey(ws, userId), existing.filter((n) => n.id !== id));
    return NextResponse.json({ ok: true, dismissed: existing.length - (await loadNotices(ws, userId)).length });
  }

  // tick — one beat for this workspace, via the shared heartbeat lib.
  if (action === 'tick') {
    const companyName = String(body.companyName ?? 'the company').slice(0, 80);
    const result = await tickWorkspace(ws, userId, companyName);
    return NextResponse.json({ ok: true, ...result });
  }

  // trigger — manual run of one task (bypasses quiet hours, keeps overlap guard).
  if (action === 'trigger') {
    const id = String(body.id ?? '');
    const companyName = String(body.companyName ?? 'the company').slice(0, 80);
    const result = await triggerTask(ws, userId, id, companyName);
    if (!result.ok) {
      const status = result.error === 'Task not found' ? 404 : result.error?.includes('still running') ? 409 : 500;
      return NextResponse.json({ ok: false, error: result.error }, { status });
    }
    return NextResponse.json({ ok: true, taskId: id, run: result.run });
  }

  return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
}

// Re-export for the cron entrypoint (single shared tick implementation).
export { tickWorkspace, triggerTask };
