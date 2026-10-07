import 'server-only';
import { getBorgaState, setBorgaState } from './persistence';
import { userWsKey } from './keys';
import { enqueueRun, getJob } from './run-queue';
import { loadSettings } from './heartbeat-settings';
import { addNotice } from './notices';
import { inQuietHours } from './heartbeat';
import { paymentRequired } from './billing-server';
import { loadFeatures } from './features-server';
import { anyModelReady } from './llm-fallback';
import { AGENTS, type ActivityEvent, type Agent, type Invoice, type Lead, type Task } from './data';
import {
  MAX_BATCH, MAX_RUNS_PER_DAY, MAX_RUNS_PER_SCAN, TICKET_FRESH_MS, agentTasks, invoicePriority, invoicesBatchGoal, isLowValueTicket, leadPriority,
  leadsBatchGoal, normalizeLedger, overdueInvoices, pruneLedger, resolveAutomations, routeAgent, shouldRetry, staleLeads, taskGoal,
  taskPriority, ticketGoal, ticketPriority, unassignedTasks, withinDailyCap, type Ledger,
} from './automation-core';

/**
 * Automatic delegation, applied. Borga is the dispatcher: it reads what changed in a company (a new ticket, a lead nobody has
 * touched, an overdue invoice, a task nobody owns), decides which specialist should handle it with fixed rules (no model is asked to
 * decide), and puts that work on the run queue in priority order. Specialists with nothing assigned stay idle.
 *
 * Calls to the AI model are the cost, so this is built to make as few as possible:
 *   - nothing is dispatched unless a model is actually ready (not paused, not missing a key), and nothing during quiet hours
 *   - auto-replies and no-reply mail are not worth a run
 *   - leads and invoices for the same agent go together in one run, not one run each
 *   - each item is dispatched once (a ledger), a failed run is retried a few times at most, and there are hourly and daily caps
 *   - save-triggered scans are throttled; the heartbeat catches anything they skip
 *   - automatic runs go through one lane in the queue, highest priority first
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

// A save can come every few seconds while someone types; a scan that just ran has already seen it.
const THROTTLE_MS = 20_000;
const lastScan = new Map<string, number>();
const pending = new Set<string>();

export interface ScanResult { dispatched: string[]; skipped?: string }

async function context(u: string, ws: string) {
  const settings = await loadSettings(ws, u);
  if (settings?.heartbeatPaused === true) return { off: 'paused' } as const;
  if (await paymentRequired(u, ws).catch(() => null)) return { off: 'subscription needed' } as const;
  if (!(await loadFeatures(u, ws)).flags.automations) return { off: 'turned off in Settings → Features' } as const;
  // No model that can answer right now (none set up, or every one paused after failing): do not queue work that would only fail.
  if (!(await anyModelReady({ ws, userId: u }))) return { off: 'no AI model is ready' } as const;
  const agents = (await stateOf<Agent[]>(u, ws, 'agents')) ?? AGENTS;
  return {
    automations: resolveAutomations(settings?.automations),
    agents,
    quiet: inQuietHours(new Date(), settings?.quietHours ?? null),
  } as const;
}

/** Borga's hand-off, visible in the activity feed. Best effort: it never holds up the work. */
async function logHandoff(u: string, ws: string, to: Agent, what: string, priority: number): Promise<void> {
  try {
    const key = userWsKey(u, ws, 'activity');
    const existing = (await getBorgaState<ActivityEvent[]>(key)) ?? [];
    const entry: ActivityEvent = {
      id: `e-borga-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      agentId: 'a-borga',
      agentName: 'Borga',
      actor: 'agent',
      kind: 'handoff',
      message: `Borga assigned ${what} to ${to.name} (P${priority}).`,
    };
    await setBorgaState(key, [entry, ...existing].slice(0, 200));
  } catch {
    /* the feed is best effort */
  }
}

/** Already dispatched and not worth another go. A run that ended in an error is tried again later, a few times. */
async function handled(u: string, ws: string, led: Ledger, key: string): Promise<boolean> {
  if (!led.done[key]) return false;
  const job = led.jobs[key];
  if (!job || !job.id) return true;
  const status = (await getJob(job.id, ws, u).catch(() => null))?.status ?? null;
  return !shouldRetry(led, key, Date.now(), status);
}

interface DispatchOptions { urgent?: boolean; priority: 0 | 1 | 2 | 3; maxSteps: number; what: string }

/** Puts one run on the queue for the given items (one or several) and records it. False when a budget is spent or it could not be queued. */
async function dispatch(u: string, ws: string, led: Ledger, keys: string[], agent: Agent, goal: string, o: DispatchOptions): Promise<boolean> {
  const now = new Date();
  const cap = withinDailyCap(led, now.toISOString().slice(0, 10), now.toISOString().slice(0, 13));
  Object.assign(led, cap.ledger);
  if (!cap.ok) {
    // Say so once a day: otherwise work just quietly stops and nobody knows why.
    const day = now.toISOString().slice(0, 10);
    if (led.capNotice !== day) {
      led.capNotice = day;
      const hourly = led.runsToday < MAX_RUNS_PER_DAY;
      void addNotice({
        id: `n-cap-${Date.now()}`,
        title: hourly ? 'Automatic work is pacing itself' : 'Automatic work paused for today',
        body: hourly
          ? `${led.runsThisHour} automatic runs started this hour, the most allowed. The rest wait for the next hour so a burst does not use up the AI budget.`
          : `${led.runsToday} automatic runs have been used today, the most allowed. New tickets, leads, invoices and tasks are picked up again tomorrow, or you can start any of them yourself.`,
        severity: 'noteworthy',
        source: 'agent',
        createdAt: now.toISOString(),
        readAt: null,
      }, ws, u).catch(() => undefined);
    }
    return false;
  }
  let jobId = '';
  try {
    jobId = (await enqueueRun({ agentId: agent.id, agentName: agent.name, goal, triggeredBy: 'automation', ws, userId: u, urgent: o.urgent, priority: o.priority, maxSteps: o.maxSteps })).id;
  } catch (e) {
    console.error('[automation] could not enqueue', keys, e);
    return false;
  }
  for (const key of keys) {
    led.done[key] = Date.now();
    led.jobs[key] = { id: jobId, tries: (led.jobs[key]?.tries ?? 0) + 1 };
    led.assigned[key] = agent.id;
  }
  led.runsToday += 1;
  led.runsThisHour += 1;
  await logHandoff(u, ws, agent, o.what, o.priority);
  return true;
}

/** Records an item as seen without spending a run on it. */
function skip(led: Ledger, key: string): void {
  led.done[key] = Date.now();
}

/** A new ticket: assign it to the support agent (unless a person already owns it) and have that agent triage it. */
export async function onTicketCreated(u: string, ws: string, t: { id: string; subject: string; priority: string; assignee: string; requesterEmail?: string }): Promise<ScanResult> {
  return serialize(`${u}|${ws}`, async () => {
    const ctx = await context(u, ws);
    if ('off' in ctx) return { dispatched: [], skipped: ctx.off };
    if (!ctx.automations.ticketTriage) return { dispatched: [], skipped: 'ticket triage is off' };
    const urgent = t.priority === 'critical';
    if (ctx.quiet && !urgent) return { dispatched: [], skipped: 'quiet hours' }; // the next scan picks it up
    const led = normalizeLedger(await getBorgaState<Ledger>(ledgerKey(u, ws)));
    const key = `ticket:${t.id}`;
    if (await handled(u, ws, led, key)) return { dispatched: [], skipped: 'already handled' };
    if (isLowValueTicket(t)) {
      skip(led, key);
      await setBorgaState(ledgerKey(u, ws), pruneLedger(led));
      return { dispatched: [], skipped: 'an automatic message, not worth a run' };
    }
    const agent = routeAgent(ctx.agents, 'support');
    if (!agent) return { dispatched: [], skipped: 'no support agent' };
    if (!t.assignee) {
      const { updateTicket } = await import('./tickets-server');
      await updateTicket(u, ws, t.id, { assignee: agent.name }, `${agent.name} (automation)`).catch(() => undefined);
    }
    const ok = await dispatch(u, ws, led, [key], agent, ticketGoal(t), { urgent, priority: ticketPriority(t.priority), maxSteps: 5, what: `ticket ${t.id}` });
    await setBorgaState(ledgerKey(u, ws), pruneLedger(led));
    return { dispatched: ok ? [key] : [], skipped: ok ? undefined : 'a run budget is spent' };
  });
}

type OverdueList = ReturnType<typeof overdueInvoices>;

/** Everything else, by scanning the company's saved state. `scopes` limits the scan to what just changed. */
export async function runAutomations(
  u: string, ws: string, scopes: Scope[] = ['tickets', 'leads', 'invoices', 'tasks'], opts: { throttle?: boolean } = {},
): Promise<ScanResult> {
  const throttleKey = `${u}|${ws}|${scopes.join(',')}`;
  const since = Date.now() - (lastScan.get(throttleKey) ?? 0);
  if (opts.throttle && since < THROTTLE_MS) {
    // Too soon after the last scan: not dropped, but run once when the window is over, however many saves came in meanwhile.
    if (!pending.has(throttleKey)) {
      pending.add(throttleKey);
      setTimeout(() => {
        pending.delete(throttleKey);
        void runAutomations(u, ws, scopes).catch((e) => console.error('[automation] scan failed', e));
      }, THROTTLE_MS - since + 500);
    }
    return { dispatched: [], skipped: 'scanned a moment ago; one more scan is queued' };
  }
  return serialize(`${u}|${ws}`, async () => {
    lastScan.set(throttleKey, Date.now());
    const ctx = await context(u, ws);
    if ('off' in ctx) return { dispatched: [], skipped: ctx.off };
    const { automations, agents, quiet } = ctx;
    const led = normalizeLedger(await getBorgaState<Ledger>(ledgerKey(u, ws)));
    const loaded = JSON.stringify(led);
    const now = Date.now();
    const dispatched: string[] = [];
    let changed = false;
    let runs = 0;
    const room = () => runs < MAX_RUNS_PER_SCAN;

    // Tickets nobody owns that arrived while nothing was listening (email polling, the API).
    if (scopes.includes('tickets') && automations.ticketTriage) {
      const support = routeAgent(agents, 'support');
      if (support) {
        const { listTickets, updateTicket } = await import('./tickets-server');
        const fresh = (await listTickets(u, ws).catch(() => []))
          .filter((t) => t.status === 'open' && now - Date.parse(t.createdAt) < TICKET_FRESH_MS)
          .sort((a, b) => ticketPriority(a.priority) - ticketPriority(b.priority))
          .slice(0, 20);
        for (const t of fresh) {
          if (!room()) break;
          const key = `ticket:${t.id}`;
          // Ours to handle: a ticket nobody owns, or one this engine took whose triage run failed and is due another try.
          if (t.assignee && !led.done[key]) continue;
          if (await handled(u, ws, led, key)) continue;
          if (isLowValueTicket(t)) { skip(led, key); changed = true; continue; }
          if (quiet && t.priority !== 'critical') continue;
          if (!t.assignee) await updateTicket(u, ws, t.id, { assignee: support.name }, `${support.name} (automation)`).catch(() => undefined);
          if (await dispatch(u, ws, led, [key], support, ticketGoal(t), { urgent: t.priority === 'critical', priority: ticketPriority(t.priority), maxSteps: 5, what: `ticket ${t.id}` })) {
            dispatched.push(key); changed = true; runs++;
          }
        }
      }
    }

    if (scopes.includes('leads')) {
      const leads = (await stateOf<Lead[]>(u, ws, 'leads')) ?? [];
      const stamp = new Date(now).toISOString();
      for (const l of leads) if (!led.firstSeen[l.id]) { led.firstSeen[l.id] = stamp; changed = true; }
      const sales = automations.leadFollowUp && !quiet ? routeAgent(agents, 'sales') : null;
      if (sales && room()) {
        const due: ReturnType<typeof staleLeads> = [];
        for (const s of staleLeads(leads, now, led.firstSeen)) {
          if (due.length >= MAX_BATCH) break;
          if (!(await handled(u, ws, led, s.key))) due.push(s);
        }
        if (due.length) {
          const priority = Math.min(...due.map((d) => leadPriority(d.lead))) as 0 | 1 | 2 | 3;
          if (await dispatch(u, ws, led, due.map((d) => d.key), sales, leadsBatchGoal(due, sales.name), { priority, maxSteps: 3 + due.length, what: due.length === 1 ? `the follow-up with ${due[0].lead.name}` : `${due.length} lead follow-ups` })) {
            dispatched.push(...due.map((d) => d.key)); changed = true; runs++;
          }
        }
      }
    }

    if (scopes.includes('invoices') && automations.overdueInvoices && !quiet && room()) {
      const finance = routeAgent(agents, 'finance');
      if (finance) {
        const invoices = (await stateOf<Invoice[]>(u, ws, 'invoices')) ?? [];
        const due: OverdueList = [];
        for (const o of overdueInvoices(invoices, now)) {
          if (due.length >= MAX_BATCH) break;
          if (!(await handled(u, ws, led, o.key))) due.push(o);
        }
        if (due.length) {
          const priority = Math.min(...due.map(invoicePriority)) as 0 | 1 | 2 | 3;
          if (await dispatch(u, ws, led, due.map((d) => d.key), finance, invoicesBatchGoal(due), { priority, maxSteps: 3 + due.length, what: due.length === 1 ? `invoice ${due[0].invoice.number}` : `${due.length} overdue invoices` })) {
            dispatched.push(...due.map((d) => d.key)); changed = true; runs++;
          }
        }
      }
    }

    if (scopes.includes('tasks')) {
      const tasks = (await stateOf<Task[]>(u, ws, 'tasks')) ?? [];
      // the first look only records what already exists: old tasks are not suddenly worked all at once
      if (led.baselineTasks === null) {
        // a task created in the last few minutes is new, not backlog (task ids carry their creation time)
        const recent = (id: string) => { const ms = Number(/(\d{13})/.exec(id)?.[1]); return Number.isFinite(ms) && now - ms < 10 * 60_000; };
        led.baselineTasks = tasks.filter((t) => !recent(t.id)).map((t) => t.id).slice(0, 2000);
        changed = true;
      }
      if (!quiet) {
        const existing = new Set(led.baselineTasks);
        // by priority, so P0 goes out first when the scan can only dispatch a few
        const work: Array<{ task: Task; agent: Agent; key: string; byBorga?: string[] }> = [
          ...(automations.agentTasks ? agentTasks(tasks, agents) : []),
          ...(automations.borgaAssigns ? unassignedTasks(tasks, agents).map((a) => ({ task: a.task, agent: a.assignment.agent, key: a.key, byBorga: a.assignment.matched })) : []),
        ].sort((a, b) => taskPriority(a.task) - taskPriority(b.task));
        for (const w of work) {
          if (!room()) break;
          if (existing.has(w.task.id) || (await handled(u, ws, led, w.key))) continue;
          const goal = w.byBorga ? `${taskGoal(w.task)} Borga assigned this to you because it matches your skills (${w.byBorga.slice(0, 4).join(', ')}).` : taskGoal(w.task);
          if (await dispatch(u, ws, led, [w.key], w.agent, goal, { priority: taskPriority(w.task), maxSteps: 5, what: `the task "${w.task.title.slice(0, 60)}"` })) {
            dispatched.push(w.key); changed = true; runs++;
          }
        }
      }
    }

    if (changed || dispatched.length || JSON.stringify(led) !== loaded) await setBorgaState(ledgerKey(u, ws), pruneLedger(led));
    return { dispatched };
  });
}

/** Fire-and-forget: a save or a new ticket must never wait for, or fail because of, an automation. */
export function runAutomationsSoon(u: string, ws: string, scopes: Scope[]): void {
  void runAutomations(u, ws, scopes, { throttle: true }).catch((e) => console.error('[automation] scan failed', e));
}
