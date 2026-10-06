/**
 * Support-desk domain model + SLA engine. Pure and isomorphic (no server-only
 * imports) so the browser renders the same SLA numbers the server sweeps on.
 */

export type TicketType = 'incident' | 'request' | 'bug' | 'task' | 'question';
export type TicketPriority = 'critical' | 'high' | 'medium' | 'low';
export type TicketStatus = 'open' | 'in-progress' | 'pending' | 'resolved' | 'closed';
export type TicketSource = 'web' | 'email' | 'api';

export const TICKET_TYPES: TicketType[] = ['incident', 'request', 'bug', 'task', 'question'];
export const TICKET_PRIORITIES: TicketPriority[] = ['critical', 'high', 'medium', 'low'];
export const TICKET_STATUSES: TicketStatus[] = ['open', 'in-progress', 'pending', 'resolved', 'closed'];

export const STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Open',
  'in-progress': 'In progress',
  pending: 'Pending customer',
  resolved: 'Resolved',
  closed: 'Closed',
};

/** Jira-style workflow: which statuses each status may move to. */
export const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  open: ['in-progress', 'pending', 'resolved', 'closed'],
  'in-progress': ['open', 'pending', 'resolved'],
  pending: ['open', 'in-progress', 'resolved'],
  resolved: ['open', 'closed'],
  closed: ['open'],
};

export const isDoneStatus = (s: TicketStatus): boolean => s === 'resolved' || s === 'closed';

export interface TicketComment {
  id: string;
  at: string;
  /** public = emailed to the requester; internal = team-only note; email-in = inbound message; system = audit trail */
  kind: 'public' | 'internal' | 'email-in' | 'system';
  author: string;
  authorEmail?: string;
  body: string;
  messageId?: string;
  /** Outbound delivery result for public replies. */
  delivery?: 'sent' | 'failed' | 'not-configured';
}

export interface TicketPause {
  from: string;
  to?: string;
}

export interface Ticket {
  id: string; // also the key, e.g. SUP-12
  number: number;
  subject: string;
  description: string;
  type: TicketType;
  priority: TicketPriority;
  status: TicketStatus;
  source: TicketSource;
  requesterName: string;
  requesterEmail: string;
  /** Extra addresses seen on the thread (cc / other repliers) — allowed to reply by token. */
  participants: string[];
  assignee: string; // free text / employee name; '' = unassigned
  labels: string[];
  projectId?: string;
  customerId?: string;
  slaPolicyId: string;
  createdAt: string;
  updatedAt: string;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  reopenCount: number;
  pauses: TicketPause[];
  /** Message-IDs of every email on this thread, for In-Reply-To matching. */
  messageIds: string[];
  /** Escalation bookkeeping so each threshold notifies once. */
  notified: { responseRisk?: string; responseBreach?: string; resolutionRisk?: string; resolutionBreach?: string };
  timeSpentMin: number;
  comments: TicketComment[];
}

/** List rows omit the comment bodies. */
export type TicketSummary = Omit<Ticket, 'comments'> & { commentCount: number; lastActivityAt: string };

// ---------------------------------------------------------------------------
// SLA policy + business hours

export interface SlaTarget {
  firstResponseMin: number;
  resolutionMin: number;
}

export interface SlaPolicy {
  id: string;
  name: string;
  /** When true the clocks only run inside business hours. */
  businessHoursOnly: boolean;
  targets: Record<TicketPriority, SlaTarget>;
}

export interface BusinessHours {
  /** Minutes east of UTC for the support team's location (e.g. 60 = UTC+1). */
  utcOffsetMin: number;
  /** 0 = Sunday … 6 = Saturday. */
  days: number[];
  start: string; // HH:MM
  end: string; // HH:MM
}

export const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  utcOffsetMin: 0,
  days: [1, 2, 3, 4, 5],
  start: '09:00',
  end: '17:00',
};

export const DEFAULT_SLA_POLICIES: SlaPolicy[] = [
  {
    id: 'sla-standard',
    name: 'Standard (business hours)',
    businessHoursOnly: true,
    targets: {
      critical: { firstResponseMin: 30, resolutionMin: 4 * 60 },
      high: { firstResponseMin: 60, resolutionMin: 8 * 60 },
      medium: { firstResponseMin: 4 * 60, resolutionMin: 24 * 60 },
      low: { firstResponseMin: 8 * 60, resolutionMin: 72 * 60 },
    },
  },
  {
    id: 'sla-premium',
    name: 'Premium (24×7)',
    businessHoursOnly: false,
    targets: {
      critical: { firstResponseMin: 15, resolutionMin: 2 * 60 },
      high: { firstResponseMin: 30, resolutionMin: 4 * 60 },
      medium: { firstResponseMin: 2 * 60, resolutionMin: 12 * 60 },
      low: { firstResponseMin: 4 * 60, resolutionMin: 48 * 60 },
    },
  },
];

export interface MailboxSettings {
  enabled: boolean;
  /** Address customers write to; replies are sent from it and it is ignored as a sender (loop guard). */
  address: string;
  displayName: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  imapUser: string;
  folder: string;
  /** Send an automatic "we got your request" reply to new email tickets. */
  autoAck: boolean;
  lastPolledAt?: string;
  lastError?: string;
}

export interface TicketSettings {
  keyPrefix: string;
  nextNumber: number;
  defaultSlaPolicyId: string;
  slaPolicies: SlaPolicy[];
  businessHours: BusinessHours;
  /** Breach / at-risk alerts are emailed here in addition to the in-app notice. */
  escalationEmail: string;
  mailbox: MailboxSettings;
}

export const DEFAULT_TICKET_SETTINGS: TicketSettings = {
  keyPrefix: 'SUP',
  nextNumber: 1,
  defaultSlaPolicyId: 'sla-standard',
  slaPolicies: DEFAULT_SLA_POLICIES,
  businessHours: DEFAULT_BUSINESS_HOURS,
  escalationEmail: '',
  mailbox: {
    enabled: false,
    address: '',
    displayName: 'Support',
    imapHost: '',
    imapPort: 993,
    imapSecure: true,
    imapUser: '',
    folder: 'INBOX',
    autoAck: true,
  },
};

// ---------------------------------------------------------------------------
// SLA math

const MIN = 60_000;
const DAY = 86_400_000;
const HORIZON_DAYS = 120;
export const AT_RISK_PCT = 0.75;

function hhmm(s: string, fallback: number): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return fallback;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return v >= 0 && v <= 24 * 60 ? v : fallback;
}

type Seg = [number, number];

/** Business-hour segments (epoch ms) overlapping [fromMs, toMs]. */
export function businessSegments(fromMs: number, toMs: number, bh: BusinessHours): Seg[] {
  const out: Seg[] = [];
  if (toMs <= fromMs) return out;
  const offset = bh.utcOffsetMin * MIN;
  const startMin = hhmm(bh.start, 9 * 60);
  const endMin = hhmm(bh.end, 17 * 60);
  if (endMin <= startMin) return out;
  let day = Math.floor((fromMs + offset) / DAY) * DAY; // local-midnight, expressed on the shifted axis
  const last = Math.floor((toMs + offset) / DAY) * DAY;
  for (; day <= last; day += DAY) {
    if (!bh.days.includes(new Date(day).getUTCDay())) continue;
    const s = Math.max(day + startMin * MIN - offset, fromMs);
    const e = Math.min(day + endMin * MIN - offset, toMs);
    if (e > s) out.push([s, e]);
  }
  return out;
}

function cutPauses(segs: Seg[], pauses: Array<[number, number]>): Seg[] {
  let cur = segs;
  for (const [ps, pe] of pauses) {
    const next: Seg[] = [];
    for (const [s, e] of cur) {
      if (pe <= s || ps >= e) {
        next.push([s, e]);
        continue;
      }
      if (ps > s) next.push([s, ps]);
      if (pe < e) next.push([pe, e]);
    }
    cur = next;
  }
  return cur;
}

function pauseRanges(pauses: TicketPause[], nowMs: number): Array<[number, number]> {
  return pauses.map((p) => [new Date(p.from).getTime(), p.to ? new Date(p.to).getTime() : nowMs] as [number, number]);
}

/** Milliseconds of SLA time between start and end (business hours and pauses respected). */
export function elapsedMs(startMs: number, endMs: number, pauses: TicketPause[], bh: BusinessHours | null, nowMs: number): number {
  if (endMs <= startMs) return 0;
  const base: Seg[] = bh ? businessSegments(startMs, endMs, bh) : [[startMs, endMs]];
  return cutPauses(base, pauseRanges(pauses, nowMs)).reduce((n, [s, e]) => n + (e - s), 0);
}

/** The instant a target is reached, or null while the clock is paused / out of horizon. */
export function dueAtMs(startMs: number, targetMin: number, pauses: TicketPause[], bh: BusinessHours | null): number | null {
  if (pauses.some((p) => !p.to)) return null; // currently paused: no meaningful due date
  const end = startMs + HORIZON_DAYS * DAY;
  const base: Seg[] = bh ? businessSegments(startMs, end, bh) : [[startMs, end]];
  let remaining = targetMin * MIN;
  for (const [s, e] of cutPauses(base, pauseRanges(pauses, end))) {
    const len = e - s;
    if (len >= remaining) return s + remaining;
    remaining -= len;
  }
  return null;
}

export type SlaState = 'running' | 'at-risk' | 'breached' | 'met' | 'met-late' | 'paused';

export interface SlaClock {
  targetMin: number;
  elapsedMin: number;
  pct: number;
  state: SlaState;
  dueAt: string | null;
}

export interface SlaStatus {
  response: SlaClock;
  resolution: SlaClock;
  /** Worst live state across both clocks, for badges and sorting. */
  worst: SlaState;
}

type SlaInput = Pick<Ticket, 'createdAt' | 'firstResponseAt' | 'resolvedAt' | 'status' | 'pauses' | 'priority'>;

function clock(startMs: number, stopMs: number | null, targetMin: number, pauses: TicketPause[], bh: BusinessHours | null, nowMs: number, paused: boolean): SlaClock {
  const end = stopMs ?? nowMs;
  const elapsed = elapsedMs(startMs, end, pauses, bh, nowMs);
  const target = Math.max(1, targetMin);
  const pct = elapsed / (target * MIN);
  const due = stopMs === null ? dueAtMs(startMs, target, pauses, bh) : null;
  let state: SlaState;
  if (stopMs !== null) state = pct <= 1 ? 'met' : 'met-late';
  else if (paused) state = 'paused';
  else if (pct >= 1) state = 'breached';
  else if (pct >= AT_RISK_PCT) state = 'at-risk';
  else state = 'running';
  return { targetMin: target, elapsedMin: Math.round(elapsed / MIN), pct, state, dueAt: due === null ? null : new Date(due).toISOString() };
}

export function computeSla(t: SlaInput, policy: SlaPolicy, bh: BusinessHours, nowMs = Date.now()): SlaStatus {
  const hours = policy.businessHoursOnly ? bh : null;
  const target = policy.targets[t.priority];
  const start = new Date(t.createdAt).getTime();
  const responseStop = t.firstResponseAt ?? t.resolvedAt;
  const response = clock(start, responseStop ? new Date(responseStop).getTime() : null, target.firstResponseMin, [], hours, nowMs, false);
  const resolution = clock(start, t.resolvedAt ? new Date(t.resolvedAt).getTime() : null, target.resolutionMin, t.pauses, hours, nowMs, t.status === 'pending');
  const order: SlaState[] = ['breached', 'at-risk', 'paused', 'running', 'met-late', 'met'];
  const worst = order.find((s) => response.state === s || resolution.state === s) ?? 'running';
  return { response, resolution, worst };
}

export function policyFor(t: Pick<Ticket, 'slaPolicyId'>, s: TicketSettings): SlaPolicy {
  return s.slaPolicies.find((p) => p.id === t.slaPolicyId)
    ?? s.slaPolicies.find((p) => p.id === s.defaultSlaPolicyId)
    ?? s.slaPolicies[0]
    ?? DEFAULT_SLA_POLICIES[0];
}

export function fmtDuration(min: number): string {
  if (min < 60) return `${Math.max(0, Math.round(min))}m`;
  if (min < 24 * 60) {
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(min / (24 * 60));
  const h = Math.round((min % (24 * 60)) / 60);
  return h ? `${d}d ${h}h` : `${d}d`;
}

// ---------------------------------------------------------------------------
// Per-ticket insights: rule-based readouts derived only from the ticket's own
// fields and its live SLA clocks. Nothing is invented — every line names a
// fact (owner, clock state, reopen count, idle time) and the action it implies.

export interface TicketInsight {
  tone: 'danger' | 'warn' | 'info';
  text: string;
}

type InsightInput = Pick<
  Ticket,
  'status' | 'priority' | 'assignee' | 'createdAt' | 'updatedAt' | 'firstResponseAt' | 'resolvedAt' | 'reopenCount' | 'source' | 'requesterEmail' | 'comments'
>;

export function ticketInsights(t: InsightInput, sla: SlaStatus, nowMs: number): TicketInsight[] {
  const out: TicketInsight[] = [];
  const done = isDoneStatus(t.status);
  const idleMin = Math.max(0, (nowMs - new Date(t.updatedAt).getTime()) / MIN);

  if (!done && !t.assignee) {
    out.push(
      t.priority === 'critical'
        ? { tone: 'danger', text: 'Critical and unowned — assign an owner now.' }
        : { tone: 'warn', text: 'No owner yet — assign someone so it does not sit.' },
    );
  }
  if (!done && !t.firstResponseAt) {
    const c = sla.response;
    if (c.state === 'breached') out.push({ tone: 'danger', text: `First response breached by ${fmtDuration(c.elapsedMin - c.targetMin)}.` });
    else if (c.state === 'at-risk') out.push({ tone: 'warn', text: `First response at risk — ${fmtDuration(Math.max(0, c.targetMin - c.elapsedMin))} of SLA time left.` });
  }
  if (!done) {
    const c = sla.resolution;
    if (c.state === 'breached') out.push({ tone: 'danger', text: `Resolution breached by ${fmtDuration(c.elapsedMin - c.targetMin)}.` });
    else if (c.state === 'at-risk') out.push({ tone: 'warn', text: `Resolution at risk — ${fmtDuration(Math.max(0, c.targetMin - c.elapsedMin))} of SLA time left.` });
  }
  if (t.reopenCount > 0) {
    out.push({ tone: 'warn', text: `Reopened ${t.reopenCount}× — fix the root cause, not just the symptom.` });
  }
  if (!done && t.status === 'pending') {
    out.push({ tone: 'info', text: `Waiting on the customer since ${new Date(t.updatedAt).toLocaleDateString()}.` });
  }
  if (!done && idleMin >= 3 * 24 * 60) {
    out.push({ tone: 'warn', text: `No movement in ${fmtDuration(idleMin)} — nudge it forward.` });
  }
  if (t.source === 'email' && !t.requesterEmail) {
    out.push({ tone: 'warn', text: 'No requester email — replies are saved but cannot be delivered.' });
  }
  if (done && sla.resolution.state === 'met-late') {
    out.push({ tone: 'info', text: `Resolved over SLA (${fmtDuration(sla.resolution.elapsedMin)} vs ${fmtDuration(sla.resolution.targetMin)} target) — worth a retro.` });
  }
  const order: Record<TicketInsight['tone'], number> = { danger: 0, warn: 1, info: 2 };
  return out.sort((a, b) => order[a.tone] - order[b.tone]).slice(0, 5);
}

// ---------------------------------------------------------------------------
// Email ↔ ticket helpers

export function ticketToken(id: string): string {
  return `[${id}]`;
}

/** Extracts "[SUP-12]" style tokens from a subject line. */
export function tokenFromSubject(subject: string): { prefix: string; number: number } | null {
  const m = /\[([A-Z][A-Z0-9]{1,9})-(\d{1,9})\]/.exec(subject);
  return m ? { prefix: m[1], number: Number(m[2]) } : null;
}

export function normalizeSubject(subject: string): string {
  return subject.replace(/^\s*((re|fwd?|aw|sv)\s*:\s*)+/i, '').replace(/\[[A-Z][A-Z0-9]{1,9}-\d{1,9}\]\s*/g, '').trim() || '(no subject)';
}

/** Drops quoted reply history so threads show only what the sender just wrote. */
export function stripQuotedReply(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*On .{5,200}wrote:\s*$/i.test(line) || /^\s*-{2,}\s*(original message|forwarded message)\s*-{2,}/i.test(line) || /^_{5,}\s*$/.test(line)) break;
    if (/^\s*From:\s.+/i.test(line) && /^\s*(Sent|Date):/i.test(lines[i + 1] ?? '')) break;
    if (/^\s*>/.test(line)) continue;
    out.push(line);
  }
  return out.join('\n').trim();
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const AUTO_SENDER = /^(mailer-daemon|postmaster|no-?reply|donotreply|do-not-reply|bounce[s]?)@/i;

/** True for bounces, out-of-office and list mail — never turn these into tickets or replies. */
export function isAutomatedMail(headers: Record<string, string>, fromEmail: string): boolean {
  const h = (k: string) => (headers[k] ?? '').toLowerCase();
  if (AUTO_SENDER.test(fromEmail)) return true;
  if (h('auto-submitted') && h('auto-submitted') !== 'no') return true;
  if (/bulk|junk|list|auto_reply/.test(h('precedence'))) return true;
  if (h('x-auto-response-suppress')) return true;
  if (h('list-id') || h('list-unsubscribe')) return true;
  return false;
}

export const EMAIL_RE = /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/;
