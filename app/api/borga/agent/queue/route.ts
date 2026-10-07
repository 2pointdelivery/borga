import { NextResponse, type NextRequest } from 'next/server';
import { verifySessionToken, sessionCookieName } from '@/lib/auth/session';
import { cancelJob, retryJob, rerunJob, listQueue, enqueueRun, setWorkerCount, updateQueuedJob, MAX_WORKERS } from '@/lib/borga/run-queue';
import { MAX_RUN_STEPS } from '@/lib/borga/agent-runner';
import type { AgentRun } from '@/lib/borga/data';

export const runtime = 'nodejs';

/**
 * The run queue's dashboard surface: what is queued, which worker is busy,
 * and the controls (cancel, retry, re-run, worker count, enqueue).
 * All actions are session-authenticated; the queue itself is persisted
 * per user+workspace by lib/borga/run-queue.ts.
 */

async function getUserId(req: NextRequest): Promise<string | null> {
  const c = req.cookies.get(sessionCookieName());
  const token = typeof c === 'string' ? c : c?.value;
  return verifySessionToken(token);
}

function isValidWsId(ws: unknown): ws is string {
  return typeof ws === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(ws);
}

// GET — queue snapshot: jobs in view order, worker states, configured count.
export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const wsParam = new URL(req.url).searchParams.get('ws');
  const ws = isValidWsId(wsParam) ? wsParam : null;
  const snapshot = await listQueue(ws, userId);
  return NextResponse.json({ ok: true, ...snapshot });
}

// POST — actions on the queue.
export async function POST(req: NextRequest) {
  if (req.headers.get('X-Borga-Client') !== 'borga-dashboard') {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 });
  }

  const action = String(body.action ?? '');
  const ws = isValidWsId(body.ws) ? body.ws : null;

  if (action === 'cancel' || action === 'retry' || action === 'rerun') {
    const id = String(body.id ?? '');
    if (!id) return NextResponse.json({ ok: false, error: 'id is required' }, { status: 400 });
    const job = action === 'cancel'
      ? await cancelJob(id, ws, userId)
      : action === 'retry'
      ? await retryJob(id, ws, userId)
      : await rerunJob(id, ws, userId);
    if (!job) return NextResponse.json({ ok: false, error: 'Job not found' }, { status: 404 });
    return NextResponse.json({ ok: true, job });
  }

  if (action === 'setWorkers') {
    const n = Number(body.count ?? 0);
    if (!Number.isInteger(n) || n < 1 || n > MAX_WORKERS) {
      return NextResponse.json({ ok: false, error: `count must be 1..${MAX_WORKERS}` }, { status: 400 });
    }
    const count = await setWorkerCount(ws, userId, n);
    return NextResponse.json({ ok: true, configured: count });
  }

  if (action === 'enqueue') {
    const agentId = String(body.agentId ?? 'a-borga').slice(0, 50);
    const goal = String(body.goal ?? '').trim().slice(0, 2000);
    const triggeredBy = (['user', 'scheduler', 'webhook', 'handoff'].includes(String(body.triggeredBy))
      ? body.triggeredBy
      : 'user') as AgentRun['triggeredBy'];
    const plannedSteps = Array.isArray(body.plannedSteps) ? body.plannedSteps : undefined;
    const rawSteps = Number(body.maxSteps);
    const maxSteps = Number.isFinite(rawSteps)
      ? Math.max(1, Math.min(MAX_RUN_STEPS, Math.floor(rawSteps)))
      : undefined;
    if (!goal && !plannedSteps?.length) {
      return NextResponse.json({ ok: false, error: 'goal is required' }, { status: 400 });
    }
    try {
      const job = await enqueueRun({
        agentId,
        goal: goal || 'Execute the edited plan.',
        triggeredBy,
        ws,
        userId,
        urgent: body.urgent === true,
        plannedSteps: plannedSteps as { thought: string; toolName: string; params: Record<string, unknown> }[] | undefined,
        companyName: String(body.companyName ?? 'the company').slice(0, 80),
        maxSteps,
      });
      return NextResponse.json({ ok: true, job });
    } catch (e) {
      return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
    }
  }

  // Edit a queued job before a worker claims it. Running/terminal jobs 409.
  if (action === 'update') {
    const id = String(body.id ?? '');
    if (!id) return NextResponse.json({ ok: false, error: 'id is required' }, { status: 400 });
    const patch: { goal?: string; agentId?: string; agentName?: string; urgent?: boolean; maxSteps?: number } = {};
    if (typeof body.goal === 'string') patch.goal = body.goal;
    if (typeof body.agentId === 'string') patch.agentId = body.agentId;
    if (typeof body.agentName === 'string') patch.agentName = body.agentName;
    if (typeof body.urgent === 'boolean') patch.urgent = body.urgent;
    if (body.maxSteps !== undefined) {
      const n = Number(body.maxSteps);
      if (!Number.isFinite(n)) return NextResponse.json({ ok: false, error: 'maxSteps must be a number' }, { status: 400 });
      patch.maxSteps = n;
    }
    const { job, reason } = await updateQueuedJob(id, ws, userId, patch);
    if (reason === 'not-found' || !job) return NextResponse.json({ ok: false, error: 'Job not found' }, { status: 404 });
    if (reason === 'not-queued') {
      return NextResponse.json({ ok: false, error: `Only queued jobs can be edited (job is ${job.status}).` }, { status: 409 });
    }
    return NextResponse.json({ ok: true, job });
  }

  return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
}
