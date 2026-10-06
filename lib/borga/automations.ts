import 'server-only';
import { getBorgaState, setBorgaState } from './persistence';
import { userWsKey } from './keys';
import { enqueueRun, getJob } from './run-queue';
import { loadSettings } from './heartbeat-settings';
import { paymentRequired } from './billing-server';
import { loadFeatures } from './features-server';
import { AGENTS, type Agent, type Invoice, type Lead, type Task } from './data';
import {
  MAX_RUNS_PER_SCAN, TICKET_FRESH_MS, agentTasks, invoiceGoal, leadGoal, normalizeLedger, overdueInvoices, pruneLedger,
  resolveAutomations, routeAgent, shouldRetry, staleLeads, taskGoal, ticketGoal, withinDailyCap, type Ledger,
} from './automation-core';

/**
 * Automatic delegation, applied. A scan loads a company's state, decides with the pure rules in automation-core which agent should
 * pick up what, and enqueues those agent runs on the normal run queue (visible and cancellable under AI Platform → Runs & Queue).
 * It runs when a ticket is created, when leads, tasks or invoices are saved, and on every heartbeat tick. A ledger remembers what
 * was already dispatched, so nothing is handed over twice, and daily and per-scan caps bound the cost.
 */

type Scope = 'tickets' | 'leads' | 'invoices' | 'tasks';

const ledgerKey = (u: string, ws: string) => userWsKey(u, ws, 'automationLedger');
const stateOf = async <T>(u: string, ws: string, entity: string): Promise<T | null> => getBorgaState<T>(userWsKey(u, ws, entity));

// One scan at a time per company: the ledger is read, changed and written back.
const locks = new Map<string, Promise<unknown>>();
function serialize<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(id) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(id, next.catch(() => undefined));
  return next;
}

export interface ScanResult { dispatched: string[]; skipped?: string }

async function context(u: string, ws: string) {
  const settings = await loadSettings(ws, u);
  if (settings?.heartbeatPaused === true) return { off: 'paused' } as const;
  if (await paymentRequired(u, ws).catch(() => null)) return { off: 'subscription needed' } as const;
  if (!(await loadFeatures(u, ws)).flags.automations) return { off: 'turned off in Settings → Features' } as const;
  const agents = (await stateOf<Agent[]>(u, ws, 'agents')) ?? AGENTS;
  return { automations: resolveAutomations(settings?.automations), agents } as const;
}

/** Already dispatched and not worth another go. A run that ended in an error is tried again later, a few times. */
async function handled(u: string, ws: string, led: Ledger, key: string): Promise<boolean> {
  if (!led.done[key]) return false;
  const job = led.jobs[key];
  if (!job || !job.id) return true;
  const status = (await getJob(job.id, ws, u).catch(() => null))?.status ?? null;
  return !shouldRetry(led, key, Date.now(), status);
}

async function dispatch(
  u: string, ws: string, led: Ledger, key: string, agent: Agent, goal: string, urgent = false,
): Promise<boolean> {
  const cap = withinDailyCap(led, new Date().toISOString().slice(0, 10));
  Object.assign(led, cap.ledger);
  if (!cap.ok) return false;
  let jobId = '';
  try {
    jobId = (await enqueueRun({ agentId: agent.id, goal, triggeredBy: 'automation', ws, userId: u, urgent, maxSteps: 6 })).id;
  } catch (e) {
    console.error('[automation] could not enqueue', key, e);
    return false;
  }
  led.done[key] = Date.now();
  led.jobs[key] = { id: jobId, tries: (led.jobs[key]?.tries ?? 0) + 1 };
  led.runsToday += 1;
  return true;
}

/** A new ticket: assign it to the support agent (unless a person already owns it) and have that agent triage it. */
export async function onTicketCreated(u: string, ws: string, t: { id: string; subject: string; priority: string; assignee: string; requesterEmail?: string }): Promise<ScanResult> {
  return serialize(`${u}|${ws}`, async () => {
    const ctx = await context(u, ws);
    if ('off' in ctx) return { dispatched: [], skipped: ctx.off };
    if (!ctx.automations.ticketTriage) return { dispatched: [], skipped: 'ticket triage is off' };
    const led = normalizeLedger(await getBorgaState<Ledger>(ledgerKey(u, ws)));
    const key = `ticket:${t.id}`;
    if (await handled(u, ws, led, key)) return { dispatched: [], skipped: 'already handled' };
    const agent = routeAgent(ctx.agents, 'support');
    if (!agent) return { dispatched: [], skipped: 'no support agent' };
    if (!t.assignee) {
      const { updateTicket } = await import('./tickets-server');
      await updateTicket(u, ws, t.id, { assignee: agent.name }, `${agent.name} (automation)`).catch(() => undefined);
    }
    const ok = await dispatch(u, ws, led, key, agent, ticketGoal(t), t.priority === 'critical');
    await setBorgaState(ledgerKey(u, ws), pruneLedger(led));
    return { dispatched: ok ? [key] : [], skipped: ok ? undefined : 'daily limit reached' };
  });
}

/** Everything else, by scanning the company's saved state. `scopes` limits the scan to what just changed. */
export async function runAutomations(u: string, ws: string, scopes: Scope[] = ['tickets', 'leads', 'invoices', 'tasks']): Promise<ScanResult> {
  return serialize(`${u}|${ws}`, async () => {
    const ctx = await context(u, ws);
    if ('off' in ctx) return { dispatched: [], skipped: ctx.off };
    const { automations, agents } = ctx;
    const led = normalizeLedger(await getBorgaState<Ledger>(ledgerKey(u, ws)));
    const now = Date.now();
    const dispatched: string[] = [];
    let changed = false;

    // tickets that arrived while nothing was listening (email polling, API) and still have no owner
    if (scopes.includes('tickets') && automations.ticketTriage) {
      const support = routeAgent(agents, 'support');
      if (support) {
        const { listTickets, updateTicket } = await import('./tickets-server');
        const fresh = (await listTickets(u, ws).catch(() => []))
          .filter((t) => t.status === 'open' && now - Date.parse(t.createdAt) < TICKET_FRESH_MS)
          .slice(0, 20);
        let n = 0;
        for (const t of fresh) {
          if (n >= MAX_RUNS_PER_SCAN) break;
          const key = `ticket:${t.id}`;
          // Ours to handle: a ticket nobody owns, or one this engine took whose triage run failed and is due another try.
          // A ticket a person already owns, that was never dispatched here, is left alone.
          if (t.assignee && !led.done[key]) continue;
          if (await handled(u, ws, led, key)) continue;
          if (!t.assignee) await updateTicket(u, ws, t.id, { assignee: support.name }, `${support.name} (automation)`).catch(() => undefined);
          if (await dispatch(u, ws, led, key, support, ticketGoal(t), t.priority === 'critical')) { dispatched.push(key); changed = true; n++; }
        }
      }
    }

    if (scopes.includes('leads')) {
      const leads = (await stateOf<Lead[]>(u, ws, 'leads')) ?? [];
      const stamp = new Date(now).toISOString();
      for (const l of leads) if (!led.firstSeen[l.id]) { led.firstSeen[l.id] = stamp; changed = true; }
      if (automations.leadFollowUp) {
        const sales = routeAgent(agents, 'sales');
        if (sales) {
          let n = 0;
          for (const s of staleLeads(leads, now, led.firstSeen)) {
            if (n >= MAX_RUNS_PER_SCAN) break;
            if (await handled(u, ws, led, s.key)) continue;
            if (await dispatch(u, ws, led, s.key, sales, leadGoal(s, sales.name))) { dispatched.push(s.key); changed = true; n++; }
          }
        }
      }
    }

    if (scopes.includes('invoices') && automations.overdueInvoices) {
      const finance = routeAgent(agents, 'finance');
      if (finance) {
        const invoices = (await stateOf<Invoice[]>(u, ws, 'invoices')) ?? [];
        let n = 0;
        for (const o of overdueInvoices(invoices, now)) {
          if (n >= 2) break;
          if (await handled(u, ws, led, o.key)) continue;
          if (await dispatch(u, ws, led, o.key, finance, invoiceGoal(o))) { dispatched.push(o.key); changed = true; n++; }
        }
      }
    }

    if (scopes.includes('tasks')) {
      const tasks = (await stateOf<Task[]>(u, ws, 'tasks')) ?? [];
      // the first look only records what already exists: old tasks are not suddenly worked all at once
      if (led.baselineTasks === null) {
        led.baselineTasks = tasks.map((t) => t.id).slice(0, 2000);
        changed = true;
      } else if (automations.agentTasks) {
        const existing = new Set(led.baselineTasks);
        let n = 0;
        for (const a of agentTasks(tasks, agents)) {
          if (n >= MAX_RUNS_PER_SCAN) break;
          if (existing.has(a.task.id) || (await handled(u, ws, led, a.key))) continue;
          if (await dispatch(u, ws, led, a.key, a.agent, taskGoal(a.task))) { dispatched.push(a.key); changed = true; n++; }
        }
      }
    }

    if (changed) await setBorgaState(ledgerKey(u, ws), pruneLedger(led));
    return { dispatched };
  });
}

/** Fire-and-forget: a save or a new ticket must never wait for, or fail because of, an automation. */
export function runAutomationsSoon(u: string, ws: string, scopes: Scope[]): void {
  void runAutomations(u, ws, scopes).catch((e) => console.error('[automation] scan failed', e));
}
