import type { Agent, Invoice, Lead, Task } from './data';

/**
 * Automatic delegation: which agent picks up which event, and when. Pure (no I/O) so every rule is unit-tested; automations.ts
 * applies it (loads state, enqueues the runs). Four flows, each switchable per company:
 *   - ticketTriage    a new support ticket is assigned to the support agent, which triages it and drafts a reply for a human
 *   - leadFollowUp    a lead nobody has touched for a few days gets a follow-up task and a drafted message from the sales agent
 *   - overdueInvoices an overdue invoice gets a collections reminder drafted by the finance agent
 *   - agentTasks      a task assigned to an agent is worked by that agent
 */

export interface AutomationSettings {
  ticketTriage: boolean;
  leadFollowUp: boolean;
  overdueInvoices: boolean;
  agentTasks: boolean;
  borgaAssigns: boolean;
}

export const DEFAULT_AUTOMATIONS: AutomationSettings = { ticketTriage: true, leadFollowUp: true, overdueInvoices: true, agentTasks: true, borgaAssigns: true };

export function resolveAutomations(s?: Partial<AutomationSettings> | null): AutomationSettings {
  return {
    ticketTriage: s?.ticketTriage !== false,
    leadFollowUp: s?.leadFollowUp !== false,
    overdueInvoices: s?.overdueInvoices !== false,
    agentTasks: s?.agentTasks !== false,
    borgaAssigns: s?.borgaAssigns !== false,
  };
}

export const AUTOMATION_LABELS: Array<{ id: keyof AutomationSettings; label: string; detail: string }> = [
  { id: 'ticketTriage', label: 'Support tickets', detail: 'New tickets go to the support agent, which triages them and drafts a reply for you to send.' },
  { id: 'leadFollowUp', label: 'Lead follow-up', detail: 'A lead with no contact for a few days gets a follow-up task and a drafted message from the sales agent.' },
  { id: 'overdueInvoices', label: 'Overdue invoices', detail: 'The finance agent drafts a payment reminder for each overdue invoice.' },
  { id: 'agentTasks', label: 'Tasks assigned to agents', detail: 'A task assigned to an agent is worked by that agent as soon as it is saved.' },
  { id: 'borgaAssigns', label: 'Borga assigns open tasks', detail: 'Borga reads each new unassigned task and hands it to the specialist whose skills match, without asking a model. Tasks nobody fits are left for a person.' },
];

/** Caps that keep an automation from running away with the company's AI budget. */
export const MAX_RUNS_PER_SCAN = 3;
export const MAX_RUNS_PER_DAY = 30;
/** And no more than this many in any one hour, so a burst of saves cannot spend the day's budget at once. */
export const MAX_RUNS_PER_HOUR = 8;
/** Items one run may cover. Similar items go to the same agent together, so the prompt and tools are paid for once, not once per item. */
export const MAX_BATCH = 3;
/** A run that failed (model down, rate limited) is tried again after this long, up to this many times in all. */
export const RETRY_AFTER_MS = 5 * 60_000;
export const MAX_TRIES = 3;

/** Whether a dispatched item should be tried again: only when its run ended in an error, enough time has passed, and tries remain. */
export function shouldRetry(l: Ledger, key: string, nowMs: number, jobStatus: string | null | undefined): boolean {
  const at = l.done[key];
  const job = l.jobs[key];
  if (!at || !job) return false;
  return jobStatus === 'error' && job.tries < MAX_TRIES && nowMs - at >= RETRY_AFTER_MS;
}
/** Tickets older than this are left alone (a backlog is not "new"). */
export const TICKET_FRESH_MS = 3 * 86_400_000;

export type Topic = 'support' | 'sales' | 'finance';

const ROUTES: Record<Topic, { id: string; department: string }> = {
  support: { id: 'a-support', department: 'Support' },
  sales: { id: 'a-sales', department: 'Sales' },
  finance: { id: 'a-finance', department: 'Finance' },
};

/** The agent that owns a topic: the named lead, else anyone in the department, else the orchestrator. Never an offline agent. */
export function routeAgent(agents: Agent[], topic: Topic): Agent | null {
  const live = agents.filter((a) => a.status !== 'offline');
  const r = ROUTES[topic];
  return live.find((a) => a.id === r.id) ?? live.find((a) => a.department === r.department) ?? live.find((a) => a.id === 'a-borga') ?? null;
}

/** Days with no contact after which a lead of each stage is chased. */
export const LEAD_STALE_DAYS: Record<string, number> = { new: 2, qualified: 4, proposal: 5 };

const DAY = 86_400_000;
const ms = (iso: string | undefined | null) => {
  const n = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(n) ? n : null;
};

export interface StaleLead { lead: Lead; idleDays: number; key: string }

/**
 * Open leads nobody has touched for longer than their stage allows. The clock starts at the last contact, else when the lead was
 * created, else when it was first seen by this engine (so existing leads are not all chased at once the day it is switched on).
 * The key changes every further stale period, so a lead that stays untouched is chased again, but not on every scan.
 */
export function staleLeads(leads: Lead[], nowMs: number, firstSeen: Record<string, string>): StaleLead[] {
  const out: StaleLead[] = [];
  for (const lead of leads) {
    const limit = LEAD_STALE_DAYS[lead.stage];
    if (!limit) continue;
    const base = ms(lead.lastContactAt) ?? ms(lead.createdAt) ?? ms(firstSeen[lead.id]);
    if (base === null) continue;
    const idle = (nowMs - base) / DAY;
    if (idle < limit) continue;
    out.push({ lead, idleDays: Math.floor(idle), key: `lead:${lead.id}:${lead.stage}:${Math.floor(idle / limit)}` });
  }
  return out.sort((a, b) => b.idleDays - a.idleDays);
}

export interface OverdueInvoice { invoice: Invoice; daysOverdue: number; key: string }

/** Sent or overdue invoices past their due date; re-chased once a week. */
export function overdueInvoices(invoices: Invoice[], nowMs: number): OverdueInvoice[] {
  const out: OverdueInvoice[] = [];
  for (const invoice of invoices) {
    if (invoice.voidedAt || (invoice.status !== 'sent' && invoice.status !== 'overdue')) continue;
    const due = ms(invoice.due);
    if (due === null) continue;
    const late = (nowMs - due) / DAY;
    if (late < 1) continue;
    out.push({ invoice, daysOverdue: Math.floor(late), key: `invoice:${invoice.id}:w${Math.floor(late / 7)}` });
  }
  return out.sort((a, b) => b.daysOverdue - a.daysOverdue);
}

/** Tasks assigned to an agent by name or id that nobody has started. */
export function agentTasks(tasks: Task[], agents: Agent[]): Array<{ task: Task; agent: Agent; key: string }> {
  const out: Array<{ task: Task; agent: Agent; key: string }> = [];
  for (const task of tasks) {
    if (task.status !== 'todo' || !task.assignee || task.source === 'agent') continue;
    const who = task.assignee.trim().toLowerCase();
    const agent = agents.find((a) => a.status !== 'offline' && (a.id.toLowerCase() === who || a.name.toLowerCase() === who));
    if (agent) out.push({ task, agent, key: `task:${task.id}` });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Ledger: what has already been dispatched, so a scan never repeats itself.

export interface Ledger {
  /** the day the user was told a run limit paused automatic work (told once a day) */
  capNotice?: string;
  /** key → the specialist Borga handed it to (shown in the activity feed) */
  assigned: Record<string, string>;
  /** the hour (UTC, "2026-10-10T12") and how many runs were dispatched in it */
  hour: string;
  runsThisHour: number;
  /** key → when it was dispatched (ms) */
  done: Record<string, number>;
  /** key → the run that was dispatched and how many times it has been tried, so a failed run can be retried a few times */
  jobs: Record<string, { id: string; tries: number }>;
  /** lead id → first time the engine saw it (ISO) */
  firstSeen: Record<string, string>;
  /** tasks that existed when the engine first looked: never auto-run, only new ones are */
  baselineTasks: string[] | null;
  day: string;
  runsToday: number;
}

export const emptyLedger = (): Ledger => ({ assigned: {}, hour: '', runsThisHour: 0, done: {}, jobs: {}, firstSeen: {}, baselineTasks: null, day: '', runsToday: 0 });

export function normalizeLedger(raw: Partial<Ledger> | null | undefined): Ledger {
  const l = emptyLedger();
  if (!raw) return l;
  return {
    assigned: raw.assigned && typeof raw.assigned === 'object' ? raw.assigned : l.assigned,
    hour: typeof raw.hour === 'string' ? raw.hour : '',
    capNotice: typeof raw.capNotice === 'string' ? raw.capNotice : undefined,
    runsThisHour: Number(raw.runsThisHour) || 0,
    done: raw.done && typeof raw.done === 'object' ? raw.done : l.done,
    jobs: raw.jobs && typeof raw.jobs === 'object' ? raw.jobs : l.jobs,
    firstSeen: raw.firstSeen && typeof raw.firstSeen === 'object' ? raw.firstSeen : l.firstSeen,
    baselineTasks: Array.isArray(raw.baselineTasks) ? raw.baselineTasks : null,
    day: typeof raw.day === 'string' ? raw.day : '',
    runsToday: Number(raw.runsToday) || 0,
  };
}

/** Keep the ledger bounded: newest entries win. */
export function pruneLedger(l: Ledger, max = 600): Ledger {
  const keys = Object.keys(l.done);
  if (keys.length <= max) return l;
  const keep = keys.sort((a, b) => l.done[b] - l.done[a]).slice(0, max);
  return { ...l, done: Object.fromEntries(keep.map((k) => [k, l.done[k]])), jobs: Object.fromEntries(keep.filter((k) => l.jobs[k]).map((k) => [k, l.jobs[k]])) };
}

/** Whether another run may be dispatched now (today's and this hour's budgets), with the ledger rolled to the current day and hour. */
export function withinDailyCap(l: Ledger, today: string, hourKey: string = ''): { ok: boolean; ledger: Ledger } {
  let ledger = l.day === today ? l : { ...l, day: today, runsToday: 0 };
  if (hourKey && ledger.hour !== hourKey) ledger = { ...ledger, hour: hourKey, runsThisHour: 0 };
  return { ok: ledger.runsToday < MAX_RUNS_PER_DAY && (!hourKey || ledger.runsThisHour < MAX_RUNS_PER_HOUR), ledger };
}

// ---------------------------------------------------------------------------
// Goals handed to the agents. Each names the tools to use and what must stay with a human.

const clip = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export function ticketGoal(t: { id: string; subject: string; priority: string; requesterEmail?: string }): string {
  return `A new support ticket ${t.id} just arrived: "${clip(t.subject, 120)}" (priority ${t.priority}${t.requesterEmail ? `, from ${clip(t.requesterEmail, 80)}` : ''}). Triage it now: read it with list_tickets, call find_similar_tickets for how similar ones were solved, then use update_ticket to set the right priority and status and add an internal note on the likely cause and next step, and use draft_ticket_reply to prepare a reply for a human to review. You cannot email the customer. If it needs another department (billing, engineering, security), delegate that part to the specialist. Finish with SUMMARY.`;
}

export function leadGoal(l: StaleLead, agentName: string): string {
  const { lead, idleDays } = l;
  return `Lead follow-up: ${clip(lead.name, 80)}${lead.company ? ` at ${clip(lead.company, 80)}` : ''} (lead ${lead.id}, stage ${lead.stage}, value ${lead.value}) has had no contact for ${idleDays} days. Read the lead with query_state (entity "leads"), then create_task titled "Follow up with ${clip(lead.name, 60)}" assigned to ${agentName}, due within 2 days, whose detail (under 1000 characters) is the concrete next step plus a short, personal draft message built only from what the lead record says (their problem if diagnosed, their stage). Record what you learned with store_memory. Do not send anything: sending needs a human approval. Finish with SUMMARY.`;
}

export function invoiceGoal(o: OverdueInvoice): string {
  const { invoice, daysOverdue } = o;
  return `Invoice ${invoice.number} to ${clip(invoice.client, 80)} for ${invoice.amount} was due ${invoice.due} and is ${daysOverdue} days overdue. Use query_state (entity "finance") if you need context, then create_task "Chase invoice ${invoice.number}" whose detail (under 1000 characters) is a polite, firm payment reminder (amount, due date, how to pay) that a person can send as written. Do not send it and do not change the invoice. If it is more than 60 days overdue, also create_approval for escalation. Finish with SUMMARY.`;
}

export function taskGoal(t: Task): string {
  return `A task was assigned to you: "${clip(t.title, 120)}" (task ${t.id}, priority ${t.priority}${t.due ? `, due ${clip(t.due, 40)}` : ''}). ${clip(t.detail, 400)} Do the part you can with your own tools (research, drafting, looking up the real numbers), move the task forward with update_task (id ${t.id}) as you go, and delegate anything outside your department to its specialist. Hold anything that sends or spends for approval. Finish with SUMMARY saying what is done and what a person still has to do.`;
}

// ---------------------------------------------------------------------------
// Priority: the run queue claims P0 before P3, so what matters most is handled first.

type P = 0 | 1 | 2 | 3;
const PMAP: Record<string, P> = { P0: 0, P1: 1, P2: 2, P3: 3 };
const lift = (p: P, by: number): P => Math.max(0, p - by) as P;

export function ticketPriority(priority: string): P {
  return priority === 'critical' ? 0 : priority === 'high' ? 1 : priority === 'medium' ? 2 : 3;
}

/** A lead's own priority, one step higher when a lot of money rides on it. */
export function leadPriority(l: Lead): P {
  const base = PMAP[l.priority] ?? 2;
  return l.value >= 10_000 ? lift(base, 1) : base;
}

/** Overdue money gets more urgent the older and larger it is. */
export function invoicePriority(o: OverdueInvoice): P {
  if (o.daysOverdue >= 45 || o.invoice.amount >= 10_000) return 1;
  if (o.daysOverdue >= 14 || o.invoice.amount >= 2_000) return 2;
  return 3;
}

export const taskPriority = (t: Task): P => PMAP[t.priority] ?? 2;

// ---------------------------------------------------------------------------
// Work that is not worth a model call.

/** Auto-replies, bounces and no-reply senders: a ticket nobody can answer, opened by a machine. */
export function isLowValueTicket(t: { subject?: string; requesterEmail?: string }): boolean {
  const from = (t.requesterEmail ?? '').toLowerCase();
  const subject = (t.subject ?? '').trim().toLowerCase();
  if (/(^|[._+-])(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounce[sd]?)(@|[._+-])/.test(from)) return true;
  return /^(re:\s*|fwd?:\s*)*(out of office|automatic reply|auto[- ]?reply|undeliverable|delivery status notification|mail delivery|failure notice)/.test(subject);
}

// ---------------------------------------------------------------------------
// Borga assigns open tasks to the specialist whose skills match. Deterministic: no model is asked.

const STOP = new Set(['owns', 'every', 'before', 'after', 'keep', 'real', 'name', 'list', 'plain', 'each', 'when', 'what', 'only', 'never', 'always', 'them', 'they', 'more', 'most', 'also', 'such', 'both', 'does', 'done', 'goes', 'sure', 'want', 'with', 'from', 'that', 'this', 'have', 'will', 'your', 'their', 'about', 'into', 'over', 'then', 'than', 'task', 'tasks', 'please', 'need', 'needs', 'make', 'send', 'check', 'update', 'create', 'review', 'prepare', 'work', 'week', 'today', 'month', 'team', 'company']);
const stem = (w: string) => (w.length > 5 && w.endsWith('ing') ? w.slice(0, -3) : w.length > 4 && w.endsWith('es') ? w.slice(0, -2) : w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w);
const wordsOf = (text: string) => new Set((text.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) ?? []).filter((w) => !STOP.has(w)).map(stem));

export interface Assignment { agent: Agent; score: number; matched: string[] }

/** The specialist whose skills, role and department overlap most with the task, or null when nobody fits well enough (two shared words). */
export function specialistFor(task: Pick<Task, 'title' | 'detail' | 'tags'>, agents: Agent[]): Assignment | null {
  const want = wordsOf(`${task.title} ${task.detail ?? ''} ${(task.tags ?? []).join(' ')}`);
  if (want.size === 0) return null;
  let best: Assignment | null = null;
  let bestRank = Infinity;
  agents.forEach((agent, i) => {
    if (agent.id === 'a-borga' || agent.status === 'offline') return;
    // what the agent is for: its skills, role and department, and in its own words (description and instructions) what it handles
    const have = wordsOf(`${(agent.skills ?? []).join(' ')} ${agent.role} ${agent.department} ${agent.type ?? ''} ${agent.description ?? ''} ${agent.instructions ?? ''}`);
    const matched = [...want].filter((w) => have.has(w));
    if (!matched.length) return;
    // a department lead (a-sales) beats one of the extra specialists on a tie; then the order they are listed in
    const rank = (agent.id.split('-').length - 1) * 1000 + i;
    if (!best || matched.length > best.score || (matched.length === best.score && rank < bestRank)) {
      best = { agent, score: matched.length, matched };
      bestRank = rank;
    }
  });
  const found = best as Assignment | null;
  return found && found.score >= 2 ? found : null;
}

const NOBODY = new Set(['', 'unassigned', 'borga', 'a-borga']);

/** New tasks nobody owns that matter enough to work on (P0 to P2), each with the specialist Borga would give it to. */
export function unassignedTasks(tasks: Task[], agents: Agent[]): Array<{ task: Task; assignment: Assignment; key: string }> {
  const out: Array<{ task: Task; assignment: Assignment; key: string }> = [];
  for (const task of tasks) {
    if (task.status !== 'todo' || task.source === 'agent' || !NOBODY.has((task.assignee ?? '').trim().toLowerCase())) continue;
    if (taskPriority(task) > 2) continue;
    const assignment = specialistFor(task, agents);
    if (assignment) out.push({ task, assignment, key: `task:${task.id}` });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Several items for one agent go in one run.

export function leadsBatchGoal(items: StaleLead[], agentName: string): string {
  if (items.length === 1) return leadGoal(items[0], agentName);
  const lines = items.map(({ lead, idleDays }) => `- ${clip(lead.name, 60)}${lead.company ? ` at ${clip(lead.company, 60)}` : ''} (lead ${lead.id}, stage ${lead.stage}, value ${lead.value}, ${idleDays} days without contact${lead.diagnosis?.problem ? `; their problem: ${clip(lead.diagnosis.problem, 100)}` : ''})`);
  return `Lead follow-up for ${items.length} leads that have had no contact. Read them with query_state (entity "leads") once, then for EACH lead below create_task titled "Follow up with <name>" assigned to ${agentName}, due within 2 days, whose detail (under 1000 characters) is the concrete next step plus a short personal draft message built only from what the lead record says. Record what you learned with store_memory. Do not send anything: sending needs a human approval. Finish with SUMMARY listing the tasks you created.\n${lines.join('\n')}`;
}

export function invoicesBatchGoal(items: OverdueInvoice[]): string {
  if (items.length === 1) return invoiceGoal(items[0]);
  const lines = items.map(({ invoice, daysOverdue }) => `- ${invoice.number} to ${clip(invoice.client, 60)}, ${invoice.amount}, due ${invoice.due} (${daysOverdue} days overdue)`);
  return `${items.length} invoices are overdue. For EACH one below create_task "Chase invoice <number>" whose detail (under 1000 characters) is a polite, firm payment reminder (amount, due date, how to pay) that a person can send as written. Do not send anything and do not change an invoice. For any more than 60 days overdue also create_approval for escalation. Finish with SUMMARY listing the tasks you created.\n${lines.join('\n')}`;
}
