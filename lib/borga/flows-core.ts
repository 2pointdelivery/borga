/**
 * User-built workflows: trigger -> conditions (AND) -> actions. Pure (no I/O);
 * flows-server.ts loads state, evaluates, and executes. Sits next to the five
 * hardcoded automation flows (automation-core.ts) and reuses their budgets'
 * spirit with its own per-flow daily cap.
 */

export type FlowEventId = 'ticket.created' | 'lead.stale' | 'invoice.overdue' | 'sla.breach' | 'notice.urgent';

export type FlowTrigger =
  | { kind: 'event'; event: FlowEventId }
  | { kind: 'schedule'; schedule: 'hourly' | 'daily' | 'weekly' | 'monthly' }
  | { kind: 'cron'; expr: string };

export type FlowOperator = 'equals' | 'not_equals' | 'contains' | 'greater_than' | 'less_than' | 'exists';

export interface FlowCondition {
  field: string;
  op: FlowOperator;
  value: string;
}

export type FlowAction =
  | { kind: 'run_agent'; agentId: string; goal: string; priority?: 0 | 1 | 2 | 3; urgent?: boolean }
  | { kind: 'notify'; severity: 'info' | 'noteworthy' | 'urgent'; title: string; body: string }
  | { kind: 'email'; event: 'sla_breach' | 'ticket_new' | 'approval_requested' | 'recurring_invoices' | 'recurring_bills' | 'agent_urgent' };

export interface Flow {
  id: string;
  name: string;
  enabled: boolean;
  trigger: FlowTrigger;
  conditions: FlowCondition[];
  actions: FlowAction[];
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  runCount: number;
  /** ISO day ("2026-10-15") + runs fired that day: the runaway guard. */
  day: string;
  runsToday: number;
  /** Next fire for schedule/cron triggers (advanced at fire time, like scheduled tasks). */
  nextRun: string | null;
}

export interface FlowRun {
  id: string;
  flowId: string;
  flowName: string;
  at: string;
  trigger: string;
  matched: boolean;
  actions: string[];
  runIds: string[];
  test?: boolean;
  error?: string;
}

/** Flat event facts. Conditions read these fields; goals interpolate them as {{field}}. */
export type FlowContext = Record<string, string | number>;

export const FLOW_EVENT_IDS: FlowEventId[] = ['ticket.created', 'lead.stale', 'invoice.overdue', 'sla.breach', 'notice.urgent'];

export const FLOW_EVENT_META: Record<FlowEventId, { label: string; detail: string; fields: string[]; sample: FlowContext }> = {
  'ticket.created': {
    label: 'Ticket created',
    detail: 'A new support ticket arrives.',
    fields: ['ticketId', 'subject', 'priority', 'requesterEmail'],
    sample: { ticketId: 'SUP-42', subject: 'Invoice total looks wrong', priority: 'high', requesterEmail: 'sam@example.test' },
  },
  'lead.stale': {
    label: 'Lead gone stale',
    detail: 'A lead passes its stage contact limit (same clock as the built-in follow-up).',
    fields: ['leadId', 'name', 'company', 'stage', 'value', 'idleDays'],
    sample: { leadId: 'l-7', name: 'Ama Serwaa', company: 'Accra Foods', stage: 'proposal', value: 12000, idleDays: 6 },
  },
  'invoice.overdue': {
    label: 'Invoice overdue',
    detail: 'A sent invoice passes its due date.',
    fields: ['invoiceId', 'number', 'client', 'amount', 'daysOverdue'],
    sample: { invoiceId: 'in-3', number: 'INV-104', client: 'Kumasi Retail', amount: 2500, daysOverdue: 9 },
  },
  'sla.breach': {
    label: 'SLA breached',
    detail: 'A ticket crosses a response or resolution target.',
    fields: ['ticketId', 'subject', 'priority'],
    sample: { ticketId: 'SUP-9', subject: 'Outage at Tema site', priority: 'critical' },
  },
  'notice.urgent': {
    label: 'Urgent notice',
    detail: 'Anything the system flags urgent (filing overdue, funding deadline, agent alert).',
    fields: ['title', 'body'],
    sample: { title: 'Filing overdue — VAT return', body: 'The Q3 VAT return missed its due date.' },
  },
};

/** A flow may not fire more than this many times a day: a `* * * * *` typo must not spend the AI budget. */
export const MAX_FLOW_RUNS_PER_DAY = 20;
/** History and fired-key caps so the rows stay small. */
export const MAX_FLOW_RUNS = 50;
export const MAX_FLOW_FIRES = 200;

// ---------------------------------------------------------------------------
// Conditions (AND: every row must hold)

export function evalCondition(c: FlowCondition, ctx: FlowContext): boolean {
  const raw = ctx[c.field];
  if (c.op === 'exists') return raw !== undefined && raw !== null && String(raw).trim() !== '';
  if (raw === undefined || raw === null) return false;
  const left = String(raw);
  const want = (c.value ?? '').trim();
  switch (c.op) {
    case 'equals': return left.toLowerCase() === want.toLowerCase();
    case 'not_equals': return left.toLowerCase() !== want.toLowerCase();
    case 'contains': return want !== '' && left.toLowerCase().includes(want.toLowerCase());
    case 'greater_than':
    case 'less_than': {
      const a = Number(left);
      const b = Number(want);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
      return c.op === 'greater_than' ? a > b : a < b;
    }
  }
}

export function matchConditions(conditions: FlowCondition[], ctx: FlowContext): boolean {
  return conditions.every((c) => evalCondition(c, ctx));
}

/** Fill {{field}} placeholders from the event context. Unknown fields become empty, never the literal. */
export function renderGoal(template: string, ctx: FlowContext): string {
  return template.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_, k: string) => (ctx[k] === undefined || ctx[k] === null ? '' : String(ctx[k]))).slice(0, 2000);
}

// ---------------------------------------------------------------------------
// Cron expressions (standard 5-field, UTC)

const MONTH_NAMES: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const DOW_NAMES: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

function num(tok: string, names: Record<string, number>): number | null {
  const t = tok.trim().toLowerCase();
  if (t in names) return names[t];
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  return null;
}

/** Parse one field into the matching values, or null when the field is invalid. `*` means the whole range. */
export function parseCronField(field: string, min: number, max: number, names: Record<string, number> = {}): Set<number> | null {
  const out = new Set<number>();
  const parts = field.trim().split(',');
  if (parts.length === 0) return null;
  for (const part of parts) {
    if (!part.trim()) return null;
    const [range, stepRaw] = part.split('/');
    const step = stepRaw === undefined ? 1 : num(stepRaw, {});
    if (step === null || step < 1 || step > max - min + 1) return null;
    let lo: number;
    let hi: number;
    if (range === '' || range === '*') {
      lo = min;
      hi = max;
    } else if (range.includes('-')) {
      const [aRaw, bRaw] = range.split('-');
      const a = num(aRaw, names);
      const b = num(bRaw, names);
      if (a === null || b === null || a < min || b > max || a > b) return null;
      lo = a;
      hi = b;
    } else {
      const v = num(range, names);
      if (v === null || v < min || v > max) return null;
      lo = v;
      hi = stepRaw === undefined ? v : max;
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out.size ? out : null;
}

export interface ParsedCron {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  domRestricted: boolean;
  dowRestricted: boolean;
}

export function parseCron(expr: string): ParsedCron | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const minute = parseCronField(parts[0], 0, 59);
  const hour = parseCronField(parts[1], 0, 23);
  const dom = parseCronField(parts[2], 1, 31);
  const month = parseCronField(parts[3], 1, 12, MONTH_NAMES);
  const dowRaw = parseCronField(parts[4], 0, 7, DOW_NAMES);
  if (!minute || !hour || !dom || !month || !dowRaw) return null;
  const dow = new Set([...dowRaw].map((d) => (d === 7 ? 0 : d)));
  return {
    minute, hour, dom, month, dow,
    domRestricted: parts[2] !== '*',
    dowRestricted: parts[4] !== '*',
  };
}

/** Next matching minute after `fromMs` (exclusive), as ISO, or null when nothing matches within a year. */
export function nextCronRun(expr: string, fromMs: number): string | null {
  const c = parseCron(expr);
  if (!c) return null;
  let t = Math.floor(fromMs / 60000) * 60000 + 60000;
  const limit = t + 366 * 24 * 60 * 60000;
  while (t <= limit) {
    const d = new Date(t);
    const dow = d.getUTCDay();
    const dayMatch = c.domRestricted && c.dowRestricted
      ? c.dom.has(d.getUTCDate()) || c.dow.has(dow)
      : c.dom.has(d.getUTCDate()) && c.dow.has(dow);
    if (c.minute.has(d.getUTCMinutes()) && c.hour.has(d.getUTCHours()) && c.month.has(d.getUTCMonth() + 1) && dayMatch) {
      return new Date(t).toISOString();
    }
    t += 60000;
  }
  return null;
}

/** Rough minutes between fires (for the "every minute?!" warning). Null when unparseable. */
export function cronDensity(expr: string): number | null {
  const c = parseCron(expr);
  if (!c) return null;
  const first = nextCronRun(expr, Date.parse('2026-01-01T00:00:00.000Z'));
  if (!first) return null;
  const second = nextCronRun(expr, Date.parse(first));
  if (!second) return null;
  return Math.round((Date.parse(second) - Date.parse(first)) / 60000);
}

// ---------------------------------------------------------------------------
// Validation (the API and UI share it: a flow that cannot run is refused at save)

export function validateFlow(f: Partial<Flow>): string[] {
  const errors: string[] = [];
  if (!f.name || !f.name.trim()) errors.push('Name the workflow.');
  else if (f.name.trim().length > 80) errors.push('The name is too long (80 characters).');
  const t = f.trigger;
  if (!t || (t.kind !== 'event' && t.kind !== 'schedule' && t.kind !== 'cron')) {
    errors.push('Pick a trigger.');
  } else if (t.kind === 'event') {
    if (!FLOW_EVENT_IDS.includes(t.event)) errors.push('Pick a valid event.');
  } else if (t.kind === 'schedule') {
    if (!['hourly', 'daily', 'weekly', 'monthly'].includes(t.schedule)) errors.push('Pick a valid schedule.');
  } else if (!parseCron(t.expr ?? '')) {
    errors.push('The cron expression is not valid (5 fields: minute hour day month weekday, e.g. "0 8 * * mon").');
  }
  const fields = t?.kind === 'event' && FLOW_EVENT_META[t.event] ? FLOW_EVENT_META[t.event].fields : null;
  for (const cond of f.conditions ?? []) {
    if (fields && !fields.includes(cond.field)) errors.push(`Unknown field "${cond.field}" for this event.`);
    if (!['equals', 'not_equals', 'contains', 'greater_than', 'less_than', 'exists'].includes(cond.op)) errors.push(`Unknown comparison for "${cond.field}".`);
    if (cond.op !== 'exists' && !(cond.value ?? '').trim()) errors.push(`Give "${cond.field}" a value to compare against.`);
    if ((cond.op === 'greater_than' || cond.op === 'less_than') && cond.value.trim() !== '' && !Number.isFinite(Number(cond.value))) {
      errors.push(`"${cond.field}" compares numbers: "${cond.value}" is not a number.`);
    }
  }
  if (!(f.actions ?? []).length) errors.push('Add at least one action.');
  for (const a of f.actions ?? []) {
    if (a.kind === 'run_agent') {
      if (!a.agentId.trim()) errors.push('Pick the agent that runs.');
      if (!a.goal.trim()) errors.push('Write the goal the agent gets.');
    } else if (a.kind === 'notify') {
      if (!a.title.trim()) errors.push('Give the notification a title.');
    } else if (a.kind !== 'email') {
      errors.push('Unknown action.');
    }
  }
  return errors;
}

export function newFlowId(): string {
  return `flow-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
