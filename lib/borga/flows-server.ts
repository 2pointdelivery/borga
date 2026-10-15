import 'server-only';
import { getBorgaState, setBorgaState } from './persistence';
import { userWsKey } from './keys';
import { computeNextRun } from './heartbeat';
import { enqueueRun } from './run-queue';
import { addNotice } from './notices';
import { notifyEvent } from './email-notify';
import { loadFeatures } from './features-server';
import { overdueInvoices, staleLeads } from './automation-core';
import type { Agent, Invoice, Lead } from './data';
import {
  FLOW_EVENT_IDS,
  MAX_FLOW_FIRES,
  MAX_FLOW_RUNS,
  MAX_FLOW_RUNS_PER_DAY,
  matchConditions,
  newFlowId,
  nextCronRun,
  renderGoal,
  validateFlow,
  type Flow,
  type FlowAction,
  type FlowContext,
  type FlowEventId,
  type FlowRun,
} from './flows-core';

/**
 * User-built workflow execution. Event flows fire from producers (ticket
 * created, automation scans, SLA sweeps, urgent notices); schedule/cron
 * flows fire from the heartbeat tick. Every fire is capped per flow per
 * day, recorded in history, and never throws into its producer.
 */

const flowsKey = (u: string, ws: string): string => userWsKey(u, ws, 'flows');
const runsKey = (u: string, ws: string): string => userWsKey(u, ws, 'flowRuns');
const firesKey = (u: string, ws: string): string => userWsKey(u, ws, 'flowFires');

function normalizeFlow(f: Partial<Flow>): Flow | null {
  if (!f || typeof f.id !== 'string' || !f.trigger) return null;
  const now = new Date().toISOString();
  return {
    id: f.id,
    name: typeof f.name === 'string' ? f.name.slice(0, 80) : 'Untitled flow',
    enabled: f.enabled !== false,
    trigger: f.trigger,
    conditions: Array.isArray(f.conditions) ? f.conditions : [],
    actions: Array.isArray(f.actions) ? f.actions : [],
    createdAt: typeof f.createdAt === 'string' ? f.createdAt : now,
    updatedAt: now,
    lastRunAt: typeof f.lastRunAt === 'string' ? f.lastRunAt : null,
    runCount: Number(f.runCount) || 0,
    day: typeof f.day === 'string' ? f.day : '',
    runsToday: Number(f.runsToday) || 0,
    nextRun: typeof f.nextRun === 'string' ? f.nextRun : null,
  };
}

export async function loadFlows(u: string, ws: string): Promise<Flow[]> {
  const raw = (await getBorgaState<Flow[]>(flowsKey(u, ws)).catch(() => null)) ?? [];
  return raw.map(normalizeFlow).filter((f): f is Flow => !!f);
}

export async function saveFlows(u: string, ws: string, flows: Flow[]): Promise<boolean> {
  return setBorgaState(flowsKey(u, ws), flows);
}

export async function loadFlowRuns(u: string, ws: string): Promise<FlowRun[]> {
  return (await getBorgaState<FlowRun[]>(runsKey(u, ws)).catch(() => null)) ?? [];
}

async function recordRun(u: string, ws: string, run: FlowRun): Promise<void> {
  const runs = await loadFlowRuns(u, ws);
  await setBorgaState(runsKey(u, ws), [run, ...runs].slice(0, MAX_FLOW_RUNS)).catch(() => false);
}

async function alreadyFired(u: string, ws: string, key: string): Promise<boolean> {
  const fires = (await getBorgaState<string[]>(firesKey(u, ws)).catch(() => null)) ?? [];
  return fires.includes(key);
}

async function markFired(u: string, ws: string, key: string): Promise<void> {
  const fires = (await getBorgaState<string[]>(firesKey(u, ws)).catch(() => null)) ?? [];
  await setBorgaState(firesKey(u, ws), [...fires.filter((k) => k !== key), key].slice(-MAX_FLOW_FIRES)).catch(() => false);
}

function todayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** User flows follow the one automation master switch (Settings → Features). Heartbeat-paused workspaces never beat. */
async function automationsOn(u: string, ws: string): Promise<boolean> {
  try {
    const { loadSettings } = await import('./heartbeat-settings');
    const settings = await loadSettings(ws, u);
    if (settings?.heartbeatPaused === true) return false;
    return (await loadFeatures(u, ws)).flags.automations !== false;
  } catch {
    return false;
  }
}

async function agentName(u: string, ws: string, agentId: string): Promise<string> {
  const agents = (await getBorgaState<Agent[]>(userWsKey(u, ws, 'agents')).catch(() => null)) ?? [];
  return agents.find((a) => a.id === agentId)?.name ?? agentId;
}

export interface FireResult {
  fired: boolean;
  flowId: string;
  actions: string[];
  runIds: string[];
  skipped?: string;
}

/** Execute one flow's actions. Agent goals interpolate {{fields}} from the event context. */
async function executeActions(u: string, ws: string, flow: Flow, ctx: FlowContext): Promise<{ actions: string[]; runIds: string[] }> {
  const actions: string[] = [];
  const runIds: string[] = [];
  for (const a of flow.actions) {
    if (a.kind === 'run_agent') {
      const goal = renderGoal(a.goal, ctx);
      const job = await enqueueRun({
        agentId: a.agentId,
        agentName: await agentName(u, ws, a.agentId),
        goal,
        triggeredBy: 'automation',
        ws,
        userId: u,
        urgent: a.urgent,
        priority: a.priority ?? 2,
        maxSteps: 6,
      });
      actions.push(`agent ${a.agentId}`);
      runIds.push(job.id);
    } else if (a.kind === 'notify') {
      await addNotice(
        {
          id: `fl-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
          title: renderGoal(a.title, ctx),
          body: renderGoal(a.body, ctx),
          severity: a.severity,
          source: 'agent',
          createdAt: new Date().toISOString(),
          readAt: null,
        },
        ws,
        u,
      );
      actions.push(`notice ${a.severity}`);
    } else if (a.kind === 'email') {
      await notifyEvent(u, ws, a.event, { ...ctx } as Record<string, unknown>);
      actions.push(`email ${a.event}`);
    }
  }
  return { actions, runIds };
}

function stampRun(flow: Flow, now: Date): Flow {
  const day = todayKey(now);
  return {
    ...flow,
    lastRunAt: now.toISOString(),
    runCount: flow.runCount + 1,
    day,
    runsToday: flow.day === day ? flow.runsToday + 1 : 1,
  };
}

/**
 * Fire every enabled flow listening to `event` whose conditions hold.
 * `dedupeKey` (e.g. the automation ledger key) makes re-delivery safe.
 */
export async function fireEvent(u: string, ws: string, event: FlowEventId, ctx: FlowContext, dedupeKey?: string): Promise<FireResult[]> {
  const out: FireResult[] = [];
  if (!(await automationsOn(u, ws))) return out;
  let flows: Flow[];
  try {
    flows = await loadFlows(u, ws);
  } catch {
    return out;
  }
  const now = new Date();
  const day = todayKey(now);
  let dirty = false;
  for (const flow of flows) {
    if (!flow.enabled || flow.trigger.kind !== 'event' || flow.trigger.event !== event) continue;
    if (!matchConditions(flow.conditions, ctx)) continue;
    if (flow.day === day && flow.runsToday >= MAX_FLOW_RUNS_PER_DAY) {
      out.push({ fired: false, flowId: flow.id, actions: [], runIds: [], skipped: 'daily-cap' });
      continue;
    }
    const key = dedupeKey ? `flow:${flow.id}:${dedupeKey}` : null;
    if (key && (await alreadyFired(u, ws, key))) continue;
    try {
      const { actions, runIds } = await executeActions(u, ws, flow, ctx);
      const stamped = stampRun(flow, now);
      Object.assign(flow, stamped);
      dirty = true;
      if (key) await markFired(u, ws, key);
      await recordRun(u, ws, {
        id: `fr-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
        flowId: flow.id,
        flowName: flow.name,
        at: now.toISOString(),
        trigger: event,
        matched: true,
        actions,
        runIds,
      });
      out.push({ fired: true, flowId: flow.id, actions, runIds });
    } catch (e) {
      await recordRun(u, ws, {
        id: `fr-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
        flowId: flow.id,
        flowName: flow.name,
        at: now.toISOString(),
        trigger: event,
        matched: true,
        actions: [],
        runIds: [],
        error: (e as Error).message,
      });
      out.push({ fired: false, flowId: flow.id, actions: [], runIds: [], skipped: 'error' });
    }
  }
  if (dirty) await saveFlows(u, ws, flows).catch(() => false);
  return out;
}

/** Fire due schedule/cron flows (called from the heartbeat tick). Conditions need an event, so schedules run unconditionally. */
export async function tickFlows(u: string, ws: string, now: Date = new Date()): Promise<FireResult[]> {
  const out: FireResult[] = [];
  if (!(await automationsOn(u, ws))) return out;
  let flows: Flow[];
  try {
    flows = await loadFlows(u, ws);
  } catch {
    return out;
  }
  const day = todayKey(now);
  let dirty = false;
  for (const flow of flows) {
    if (!flow.enabled || flow.trigger.kind === 'event') continue;
    // Advance a missing nextRun without firing: enabling a flow must not replay the past.
    if (!flow.nextRun) {
      flow.nextRun = flow.trigger.kind === 'schedule' ? computeNextRun(flow.trigger.schedule) : nextCronRun(flow.trigger.expr, now.getTime());
      dirty = true;
      continue;
    }
    if (Date.parse(flow.nextRun) > now.getTime()) continue;
    if (flow.day === day && flow.runsToday >= MAX_FLOW_RUNS_PER_DAY) {
      flow.nextRun = flow.trigger.kind === 'schedule' ? computeNextRun(flow.trigger.schedule) : nextCronRun(flow.trigger.expr, now.getTime());
      dirty = true;
      out.push({ fired: false, flowId: flow.id, actions: [], runIds: [], skipped: 'daily-cap' });
      continue;
    }
    try {
      const { actions, runIds } = await executeActions(u, ws, flow, {});
      const label = flow.trigger.kind === 'schedule' ? `schedule:${flow.trigger.schedule}` : `cron:${flow.trigger.expr}`;
      Object.assign(flow, {
        ...stampRun(flow, now),
        nextRun: flow.trigger.kind === 'schedule' ? computeNextRun(flow.trigger.schedule) : nextCronRun(flow.trigger.expr, now.getTime()),
      });
      dirty = true;
      await recordRun(u, ws, {
        id: `fr-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
        flowId: flow.id,
        flowName: flow.name,
        at: now.toISOString(),
        trigger: label,
        matched: true,
        actions,
        runIds,
      });
      out.push({ fired: true, flowId: flow.id, actions, runIds });
    } catch {
      out.push({ fired: false, flowId: flow.id, actions: [], runIds: [], skipped: 'error' });
      flow.nextRun = flow.trigger.kind === 'schedule' ? computeNextRun(flow.trigger.schedule) : nextCronRun(flow.trigger.expr, now.getTime());
      dirty = true;
    }
  }
  if (dirty) await saveFlows(u, ws, flows).catch(() => false);
  return out;
}

/** Scan-derived events (stale leads, overdue invoices) for user flows. Independent of the built-in
 *  dispatch: notify/email-only flows keep working with no model configured. Re-fire follows the same
 *  period counters as the built-in chasers (stale period, overdue week), deduped by fired keys. */
export async function scanFlowEvents(u: string, ws: string, now: Date = new Date()): Promise<FireResult[]> {
  const out: FireResult[] = [];
  if (!(await automationsOn(u, ws))) return out;
  try {
    const leads = (await getBorgaState<Lead[]>(userWsKey(u, ws, 'leads')).catch(() => null)) ?? [];
    for (const s of staleLeads(leads, now.getTime(), {})) {
      const r = await fireEvent(u, ws, 'lead.stale', {
        leadId: s.lead.id,
        name: s.lead.name,
        company: s.lead.company ?? '',
        stage: s.lead.stage,
        value: s.lead.value,
        idleDays: s.idleDays,
      }, s.key);
      out.push(...r);
    }
    const invoices = (await getBorgaState<Invoice[]>(userWsKey(u, ws, 'invoices')).catch(() => null)) ?? [];
    for (const o of overdueInvoices(invoices, now.getTime())) {
      const r = await fireEvent(u, ws, 'invoice.overdue', {
        invoiceId: o.invoice.id,
        number: o.invoice.number,
        client: o.invoice.client,
        amount: o.invoice.amount,
        daysOverdue: o.daysOverdue,
      }, o.key);
      out.push(...r);
    }
  } catch {
    /* scans are best effort */
  }
  return out;
}

/** One heartbeat beat for user flows: due schedules/crons plus scan-derived events. */
export async function beatFlows(u: string, ws: string, now: Date = new Date()): Promise<FireResult[]> {
  const [a, b] = await Promise.all([tickFlows(u, ws, now), scanFlowEvents(u, ws, now)]);
  return [...a, ...b];
}

/** Validate + store one flow (create or replace by id). Schedule/cron triggers get their first nextRun. */
export async function putFlow(u: string, ws: string, input: Partial<Flow> & { id?: string }): Promise<{ flow?: Flow; errors?: string[] }> {
  const errors = validateFlow(input);
  // Schedules have no event context: conditions would never match, so they are refused instead of silently dead.
  if (input.trigger && input.trigger.kind !== 'event' && (input.conditions ?? []).length > 0) {
    errors.push('Schedules run on time, not on data: conditions need an event trigger.');
  }
  if (errors.length) return { errors };
  const flows = await loadFlows(u, ws);
  const now = new Date().toISOString();
  const id = typeof input.id === 'string' && input.id ? input.id.slice(0, 64) : newFlowId();
  const prev = flows.find((f) => f.id === id);
  const trigger = input.trigger!;
  const flow: Flow = {
    id,
    name: input.name!.trim().slice(0, 80),
    enabled: input.enabled !== false,
    trigger,
    conditions: input.conditions ?? [],
    actions: input.actions as FlowAction[],
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    lastRunAt: prev?.lastRunAt ?? null,
    runCount: prev?.runCount ?? 0,
    day: prev?.day ?? '',
    runsToday: prev?.runsToday ?? 0,
    nextRun: trigger.kind === 'event'
      ? null
      : prev && JSON.stringify(prev.trigger) === JSON.stringify(trigger) && prev.nextRun
        ? prev.nextRun
        : trigger.kind === 'schedule'
          ? computeNextRun(trigger.schedule)
          : nextCronRun(trigger.expr, Date.now()),
  };
  const next = prev ? flows.map((f) => (f.id === id ? flow : f)) : [...flows, flow].slice(-50);
  if (!(await saveFlows(u, ws, next))) return { errors: ['Could not save (database unavailable).'] };
  return { flow };
}

export async function deleteFlow(u: string, ws: string, id: string): Promise<boolean> {
  const flows = await loadFlows(u, ws);
  const next = flows.filter((f) => f.id !== id);
  if (next.length === flows.length) return false;
  return saveFlows(u, ws, next);
}

export { FLOW_EVENT_IDS, validateFlow };
