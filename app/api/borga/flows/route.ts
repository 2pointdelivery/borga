import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { sessionUserId } from '@/lib/borga/features-server';
import { isValidWsId } from '@/lib/borga/keys';
import { ownsWorkspace } from '@/lib/borga/workspace-access';
import {
  FLOW_EVENT_META,
  cronDensity,
  matchConditions,
  renderGoal,
  type Flow,
  type FlowAction,
  type FlowCondition,
  type FlowContext,
  type FlowTrigger,
} from '@/lib/borga/flows-core';
import { deleteFlow, fireEvent, loadFlowRuns, loadFlows, putFlow } from '@/lib/borga/flows-server';

export const runtime = 'nodejs';

// User-built workflows: list / save / delete / toggle / test (dry-run against
// sample data) / run (fire once now) / history. Session-scoped to the caller's
// own workspaces; validation refuses flows that cannot run.

const triggerSchema = z.union([
  z.object({ kind: z.literal('event'), event: z.string().max(40) }),
  z.object({ kind: z.literal('schedule'), schedule: z.enum(['hourly', 'daily', 'weekly', 'monthly']) }),
  z.object({ kind: z.literal('cron'), expr: z.string().max(100) }),
]);

const conditionSchema = z.object({
  field: z.string().max(40),
  op: z.enum(['equals', 'not_equals', 'contains', 'greater_than', 'less_than', 'exists']),
  value: z.string().max(500),
});

const actionSchema = z.union([
  z.object({ kind: z.literal('run_agent'), agentId: z.string().max(50), goal: z.string().max(2000), priority: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).optional(), urgent: z.boolean().optional() }),
  z.object({ kind: z.literal('notify'), severity: z.enum(['info', 'noteworthy', 'urgent']), title: z.string().max(120), body: z.string().max(1000) }),
  z.object({ kind: z.literal('email'), event: z.enum(['sla_breach', 'ticket_new', 'approval_requested', 'recurring_invoices', 'recurring_bills', 'agent_urgent']) }),
]);

const flowSchema = z.object({
  id: z.string().max(64).optional(),
  name: z.string().max(80),
  enabled: z.boolean().optional(),
  trigger: triggerSchema,
  conditions: z.array(conditionSchema).max(10),
  actions: z.array(actionSchema).max(10),
});

const postSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save'), ws: z.string(), flow: flowSchema }),
  z.object({ action: z.literal('delete'), ws: z.string(), id: z.string().max(64) }),
  z.object({ action: z.literal('toggle'), ws: z.string(), id: z.string().max(64), enabled: z.boolean() }),
  z.object({ action: z.literal('test'), ws: z.string(), flow: flowSchema }),
  z.object({ action: z.literal('run'), ws: z.string(), id: z.string().max(64) }),
  z.object({ action: z.literal('history'), ws: z.string() }),
]);

async function guard(req: NextRequest, ws: string) {
  const userId = await sessionUserId(req);
  if (!userId) return { res: NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 }) } as const;
  if (!isValidWsId(ws) || !(await ownsWorkspace(userId, ws))) {
    return { res: NextResponse.json({ ok: false, error: 'forbidden_workspace' }, { status: 403 }) } as const;
  }
  return { userId } as const;
}

export async function GET(req: NextRequest) {
  const ws = new URL(req.url).searchParams.get('ws') ?? '';
  const g = await guard(req, ws);
  if ('res' in g) return g.res;
  const flows = await loadFlows(g.userId, ws);
  const runs = await loadFlowRuns(g.userId, ws);
  return NextResponse.json({
    ok: true,
    flows,
    runs: runs.slice(0, 20),
    events: Object.entries(FLOW_EVENT_META).map(([id, m]) => ({ id, ...m })),
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as unknown;
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  const g = await guard(req, parsed.data.ws);
  if ('res' in g) return g.res;
  const { userId, ws } = { userId: g.userId, ws: parsed.data.ws };
  const b = parsed.data;

  if (b.action === 'save') {
    // Zod checks shape; putFlow's validateFlow checks semantics (event ids, fields, cron).
    const r = await putFlow(userId, ws, b.flow as Partial<Flow> & { id?: string });
    if (r.errors) return NextResponse.json({ ok: false, errors: r.errors }, { status: 400 });
    const density = r.flow!.trigger.kind === 'cron' ? cronDensity(r.flow!.trigger.expr) : null;
    return NextResponse.json({ ok: true, flow: r.flow, cronMinutes: density });
  }

  if (b.action === 'delete') {
    const ok = await deleteFlow(userId, ws, b.id);
    return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
  }

  if (b.action === 'toggle') {
    const flows = await loadFlows(userId, ws);
    const f = flows.find((x) => x.id === b.id);
    if (!f) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
    const r = await putFlow(userId, ws, { ...f, enabled: b.enabled });
    if (r.errors) return NextResponse.json({ ok: false, errors: r.errors }, { status: 400 });
    return NextResponse.json({ ok: true, flow: r.flow });
  }

  if (b.action === 'test') {
    // Dry-run: evaluate against the event's sample data, report what would run. Nothing executes.
    const trigger = b.flow.trigger as FlowTrigger;
    if (trigger.kind !== 'event') {
      return NextResponse.json({ ok: true, matched: true, note: 'Schedules run on time, unconditionally — nothing to match.' });
    }
    const sample = FLOW_EVENT_META[trigger.event as keyof typeof FLOW_EVENT_META]?.sample ?? {};
    const matched = matchConditions(b.flow.conditions as FlowCondition[], sample);
    const preview = (b.flow.actions as FlowAction[]).map((a) => {
      if (a.kind === 'run_agent') return `agent ${a.agentId}: ${renderGoal(a.goal, sample as FlowContext).slice(0, 140)}`;
      if (a.kind === 'notify') return `notice ${a.severity}: ${renderGoal(a.title, sample as FlowContext).slice(0, 140)}`;
      return `email ${a.event}`;
    });
    return NextResponse.json({ ok: true, matched, sample, preview });
  }

  if (b.action === 'run') {
    const flows = await loadFlows(userId, ws);
    const f = flows.find((x) => x.id === b.id);
    if (!f) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
    if (f.trigger.kind === 'event') {
      const sample = FLOW_EVENT_META[f.trigger.event]?.sample ?? {};
      const fired = await fireEvent(userId, ws, f.trigger.event, sample, `manual:${Date.now()}`);
      return NextResponse.json({ ok: true, fired });
    }
    const flowsServer = await import('@/lib/borga/flows-server');
    // Force due now, then tick: run-once for schedules without waiting for the clock.
    const now = new Date();
    await flowsServer.saveFlows(userId, ws, flows.map((x) => (x.id === b.id ? { ...x, nextRun: now.toISOString() } : x)));
    const fired = await flowsServer.tickFlows(userId, ws, new Date(now.getTime() + 1000));
    return NextResponse.json({ ok: true, fired: fired.filter((r) => r.flowId === b.id) });
  }

  const runs = await loadFlowRuns(userId, ws);
  return NextResponse.json({ ok: true, runs: runs.slice(0, 50) });
}
