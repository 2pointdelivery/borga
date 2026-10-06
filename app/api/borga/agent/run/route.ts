import { NextResponse, type NextRequest } from 'next/server';
import { buildAgentContext } from '@/lib/borga/agent-context';
import { enqueueRun, getJob } from '@/lib/borga/run-queue';
import { isTerminal } from '@/lib/borga/run-queue-core';
import { getBorgaState, scopedKey } from '@/lib/borga/persistence';
import { verifySessionToken, sessionCookieName } from '@/lib/auth/session';
import { userWsKey } from '@/lib/borga/keys';
import { paymentRequired } from '@/lib/borga/billing-server';
import type { AgentRun, RunJob, AgentRunStep } from '@/lib/borga/data';

function isValidWsId(ws: unknown): ws is string {
  return typeof ws === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(ws);
}

async function getUserId(req: NextRequest): Promise<string | null> {
  const c = req.cookies.get(sessionCookieName());
  const token = typeof c === 'string' ? c : c?.value;
  return verifySessionToken(token);
}

export const runtime = 'nodejs';

// Execution, persistence, and audit live in lib/borga (runner + queue) —
// this route only enqueues and streams. Every run (manual, scheduled,
// webhook, plan) goes through the same worker pool.
const MAX_STEPS = 8;
const POLL_MS = 400;
const STREAM_DEADLINE_MS = 10 * 60_000;
const KEEPALIVE_MS = 15_000;

function sendEvent(controller: ReadableStreamDefaultController, data: object): void {
  const encoded = new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
  controller.enqueue(encoded);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Translate one persisted job step into the SSE event shape the dashboard reader expects. */
function stepEvent(step: AgentRunStep): Record<string, unknown> | null {
  switch (step.type) {
    case 'thought': return { type: 'thought', content: step.content };
    case 'tool_call': return { type: 'tool_call', tool: step.tool, params: step.params };
    case 'tool_result': return { type: 'tool_result', tool: step.tool, ok: !/^ERROR:/.test(step.content), data: step.result };
    case 'summary': return { type: 'summary', content: step.content };
    default: return null;
  }
}

export async function POST(req: NextRequest) {
  const csrfHeader = req.headers.get('X-Borga-Client');
  if (csrfHeader !== 'borga-dashboard') {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  let body: { agentId?: string; goal?: string; maxSteps?: number; stream?: boolean; triggeredBy?: string; ws?: string; companyName?: string; urgent?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }

  const agentId = body.agentId ?? 'a-borga';
  const goal = String(body.goal ?? '').trim().slice(0, 4000);
  const maxSteps = Math.min(body.maxSteps ?? MAX_STEPS, MAX_STEPS);
  const stream = body.stream !== false;
  const triggeredBy = (body.triggeredBy as AgentRun['triggeredBy']) ?? 'user';
  const ws = isValidWsId(body.ws) ? body.ws : null;
  const companyName = (body.companyName ?? 'the company').slice(0, 80);

  if (!goal) {
    return NextResponse.json({ ok: false, error: 'goal is required' }, { status: 400 });
  }

  // An unpaid workspace may not spend LLM calls: the paywall in the dashboard is not the only gate.
  if (userId && ws) {
    const unpaid = await paymentRequired(userId, ws);
    if (unpaid) return NextResponse.json({ ok: false, error: unpaid.error, billing: unpaid.billing }, { status: 402 });
  }

  // Load agent context — a run against a missing agent 404s here, before queueing.
  const ctx = await buildAgentContext(agentId, ws, userId, goal);
  if (!ctx) {
    return NextResponse.json({ ok: false, error: `Agent "${agentId}" not found` }, { status: 404 });
  }

  const job = await enqueueRun({
    agentId,
    agentName: ctx.agent.name,
    goal,
    triggeredBy,
    ws,
    userId,
    companyName,
    maxSteps,
    urgent: body.urgent === true,
  });

  if (!stream) {
    // Non-streaming: wait for the worker to finish (bounded), then return the job.
    const deadline = Date.now() + STREAM_DEADLINE_MS;
    let current: RunJob | null = job;
    while (current && !isTerminal(current) && Date.now() < deadline && !req.signal.aborted) {
      await sleep(POLL_MS);
      current = await getJob(job.id, ws, userId);
    }
    return NextResponse.json({ ok: true, job: current ?? job });
  }

  // Streaming SSE: follow the queued job's persisted progress step by step.
  const readable = new ReadableStream({
    async start(controller) {
      const startedAt = Date.now();
      let emittedSteps = 0;
      let lastKeepalive = Date.now();
      try {
        sendEvent(controller, { type: 'start', runId: job.id, jobId: job.id, agentId, agentName: ctx.agent.name, goal });

        for (;;) {
          if (req.signal.aborted) break;
          const current = await getJob(job.id, ws, userId);
          if (!current) {
            sendEvent(controller, { type: 'error', error: 'Job disappeared from the queue.' });
            break;
          }

          const steps = current.steps ?? [];
          while (emittedSteps < steps.length) {
            const evt = stepEvent(steps[emittedSteps]);
            if (evt) sendEvent(controller, evt);
            emittedSteps++;
          }

          if (isTerminal(current)) {
            const summaryStep = [...steps].reverse().find((s) => s.type === 'summary');
            const summary = summaryStep?.content ?? current.error ?? '';
            if (current.status === 'error') {
              sendEvent(controller, { type: 'error', error: current.error ?? 'Run failed' });
            } else {
              // The summary step was already streamed as it landed — only
              // emit it here when no summary step ever arrived (e.g. a stop).
              if (!summaryStep) sendEvent(controller, { type: 'summary', content: summary });
              sendEvent(controller, {
                type: 'complete',
                runId: current.runId ?? current.id,
                jobId: current.id,
                summary,
                steps: steps.length,
                status: current.status === 'cancelled' ? 'cancelled' : 'complete',
              });
            }
            break;
          }

          if (Date.now() - startedAt > STREAM_DEADLINE_MS) {
            sendEvent(controller, { type: 'error', error: 'Run exceeded the 10-minute streaming window — it keeps running in the queue.' });
            break;
          }
          if (Date.now() - lastKeepalive > KEEPALIVE_MS) {
            controller.enqueue(new TextEncoder().encode(': keepalive\n\n'));
            lastKeepalive = Date.now();
          }
          await sleep(POLL_MS);
        }
      } catch (e) {
        try { sendEvent(controller, { type: 'error', error: (e as Error).message }); } catch { /* stream already closed */ }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

// GET /api/borga/agent/run — list recent runs
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const agentId = searchParams.get('agentId') ?? '';
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 50);
  const wsParam = searchParams.get('ws');
  const ws = isValidWsId(wsParam) ? wsParam : null;
  const userId = await getUserId(req);

  const key = ws && userId ? userWsKey(userId, ws, 'agentRuns') : scopedKey(ws, 'agentRuns');
  const runs = (await getBorgaState<AgentRun[]>(key)) ?? [];
  const filtered = agentId ? runs.filter((r) => r.agentId === agentId) : runs;
  return NextResponse.json({ ok: true, runs: filtered.slice(0, limit) });
}
