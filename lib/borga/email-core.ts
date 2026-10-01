import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Workspace email updates: event definitions, settings, templates, digest model and unsubscribe
 * tokens. Pure (no I/O) so every rule here is unit-tested. All dynamic text is HTML-escaped.
 */

// ---------------------------------------------------------------------------
// Events and settings

export type EmailEventId = 'sla_breach' | 'ticket_new' | 'approval_requested' | 'recurring_invoices' | 'recurring_bills' | 'agent_urgent';

export interface EmailEventDef {
  id: EmailEventId;
  label: string;
  description: string;
  /** The browser may trigger it through /api/borga/email (the server cannot see these happen). */
  clientTriggered: boolean;
}

export const EMAIL_EVENTS: EmailEventDef[] = [
  { id: 'approval_requested', label: 'Approval needed', description: 'An agent or automation is waiting for your yes (payments, outbound messages, workflows).', clientTriggered: true },
  { id: 'sla_breach', label: 'Support SLA breached', description: 'A ticket missed its first-response or resolution target.', clientTriggered: false },
  { id: 'ticket_new', label: 'New support ticket by email', description: 'A customer email opened a ticket in the Support Desk.', clientTriggered: false },
  { id: 'recurring_invoices', label: 'Recurring invoices drafted', description: 'Scheduled invoices were created as drafts, ready for you to review and send.', clientTriggered: true },
  { id: 'recurring_bills', label: 'Recurring bills recorded', description: 'Scheduled vendor bills were recorded as unpaid.', clientTriggered: true },
  { id: 'agent_urgent', label: 'Urgent agent alert', description: 'A scheduled agent check flagged something urgent.', clientTriggered: false },
];

export const EMAIL_EVENT_IDS = EMAIL_EVENTS.map((e) => e.id) as EmailEventId[];
export const CLIENT_EMAIL_EVENTS = EMAIL_EVENTS.filter((e) => e.clientTriggered).map((e) => e.id) as EmailEventId[];

export type DigestFrequency = 'off' | 'daily' | 'weekly';

export interface EmailSettings {
  /** Master switch. Nothing is ever sent while this is off. */
  enabled: boolean;
  recipients: string[];
  replyTo: string;
  events: Record<EmailEventId, boolean>;
  digest: { frequency: DigestFrequency; /** Local hour (0-23) in the company's timezone. */ hour: number; /** Skip the email when there is nothing to report. */ skipIfEmpty: boolean };
  /** Public address of this Borga instance, captured from the browser; used for links in emails. */
  appUrl?: string;
}

export const DEFAULT_EMAIL_SETTINGS: EmailSettings = {
  enabled: false,
  recipients: [],
  replyTo: '',
  events: { sla_breach: true, ticket_new: true, approval_requested: true, recurring_invoices: true, recurring_bills: true, agent_urgent: true },
  digest: { frequency: 'daily', hour: 8, skipIfEmpty: true },
};

export const MAX_RECIPIENTS = 10;
export const EMAIL_RE = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;

export function normalizeRecipients(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of list) {
    const e = String(v).trim().toLowerCase();
    if (!EMAIL_RE.test(e) || e.length > 254 || seen.has(e)) continue;
    seen.add(e);
    out.push(e);
    if (out.length >= MAX_RECIPIENTS) break;
  }
  return out;
}

export function mergeSettings(stored: Partial<EmailSettings> | null | undefined): EmailSettings {
  const d = DEFAULT_EMAIL_SETTINGS;
  return {
    ...d,
    ...stored,
    recipients: normalizeRecipients(stored?.recipients ?? d.recipients),
    events: { ...d.events, ...(stored?.events ?? {}) },
    digest: { ...d.digest, ...(stored?.digest ?? {}), hour: Math.min(23, Math.max(0, Math.round(Number(stored?.digest?.hour ?? d.digest.hour)) || 0)) },
  };
}

// ---------------------------------------------------------------------------
// Unsubscribe tokens (signed, per recipient and workspace)

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const unb64 = (s: string) => Buffer.from(s, 'base64url').toString('utf8');
const sig = (secret: string, data: string) => createHmac('sha256', secret).update(data).digest('base64url');

export function makeUnsubToken(secret: string, userId: string, ws: string, email: string): string {
  const payload = b64(`${userId}|${ws}|${email.toLowerCase()}`);
  return `${payload}.${sig(secret, payload)}`;
}

export function readUnsubToken(secret: string, token: string): { userId: string; ws: string; email: string } | null {
  const [payload, mac] = token.split('.');
  if (!payload || !mac) return null;
  const expected = sig(secret, payload);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const [userId, ws, email] = unb64(payload).split('|');
  return userId && ws && email ? { userId, ws, email } : null;
}

// ---------------------------------------------------------------------------
// Rendering

export interface MailContext {
  workspaceName: string;
  /** Accent colour, #rrggbb. */
  accent: string;
  /** Public base URL of Borga (no trailing slash), when known. */
  appUrl?: string;
  unsubscribeUrl?: string;
}

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

export const esc = (v: unknown): string =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const safeColor = (c: string) => (/^#[0-9a-fA-F]{6}$/.test(c) ? c : '#6366f1');
const clip = (v: unknown, n: number) => String(v ?? '').replace(/[\r\n]+/g, ' ').slice(0, n);

export function fmtMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: /^[A-Z]{3}$/.test(currency) ? currency : 'USD', maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

interface Block {
  heading?: string;
  /** Plain lines; each becomes a paragraph or list row. */
  lines?: string[];
  rows?: Array<{ left: string; right?: string }>;
}

function layout(ctx: MailContext, title: string, intro: string, blocks: Block[], cta?: { label: string; path: string }): { html: string; text: string } {
  const accent = safeColor(ctx.accent);
  const link = cta && ctx.appUrl ? `${ctx.appUrl}${cta.path}` : '';
  const body = blocks
    .map((b) => {
      const parts: string[] = [];
      if (b.heading) parts.push(`<h2 style="margin:22px 0 8px;font-size:15px;color:#111827;">${esc(b.heading)}</h2>`);
      for (const l of b.lines ?? []) parts.push(`<p style="margin:6px 0;font-size:14px;line-height:1.55;color:#374151;">${esc(l)}</p>`);
      if (b.rows?.length) {
        parts.push(
          `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:6px 0;">${b.rows
            .map((r) => `<tr><td style="padding:7px 0;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;">${esc(r.left)}</td>${r.right !== undefined ? `<td align="right" style="padding:7px 0;border-bottom:1px solid #e5e7eb;font-size:14px;color:#374151;white-space:nowrap;">${esc(r.right)}</td>` : ''}</tr>`)
            .join('')}</table>`,
        );
      }
      return parts.join('');
    })
    .join('');
  const button = link ? `<p style="margin:24px 0 6px;"><a href="${esc(link)}" style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:8px;">${esc(cta!.label)}</a></p>` : '';
  const unsub = ctx.unsubscribeUrl ? ` <a href="${esc(ctx.unsubscribeUrl)}" style="color:#6b7280;">Unsubscribe</a>.` : '';
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;background:#f3f4f6;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(intro)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;">
<tr><td style="background:${accent};padding:16px 24px;color:#ffffff;font-size:15px;font-weight:700;">${esc(ctx.workspaceName)}</td></tr>
<tr><td style="padding:24px;">
<h1 style="margin:0 0 6px;font-size:20px;line-height:1.3;color:#111827;">${esc(title)}</h1>
<p style="margin:0 0 4px;font-size:14px;line-height:1.55;color:#374151;">${esc(intro)}</p>
${body}${button}
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #e5e7eb;font-size:12px;line-height:1.5;color:#6b7280;">You get this because email updates are on for <strong>${esc(ctx.workspaceName)}</strong> in Borga (Settings → Email updates).${unsub}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    `${ctx.workspaceName}`,
    '',
    title,
    intro,
    ...blocks.flatMap((b) => ['', ...(b.heading ? [b.heading] : []), ...(b.lines ?? []), ...(b.rows ?? []).map((r) => `- ${r.left}${r.right !== undefined ? `: ${r.right}` : ''}`)]),
    ...(link ? ['', `${cta!.label}: ${link}`] : []),
    '',
    `You get this because email updates are on for ${ctx.workspaceName} in Borga (Settings → Email updates).${ctx.unsubscribeUrl ? ` Unsubscribe: ${ctx.unsubscribeUrl}` : ''}`,
  ].join('\n');
  return { html, text };
}

const list = (v: unknown, max = 12): string[] => (Array.isArray(v) ? v.map((x) => clip(x, 40)).filter(Boolean).slice(0, max) : []);

/** Dedupe key: one email per underlying thing (a ticket, an approval, a batch of numbers). */
export function eventDedupeKey(event: EmailEventId, data: Record<string, unknown>): string {
  switch (event) {
    case 'sla_breach':
    case 'ticket_new':
      return `${event}:${clip(data.ticketId, 40)}:${clip(data.which, 20)}`;
    case 'approval_requested':
      return `${event}:${clip(data.id, 60)}`;
    case 'recurring_invoices':
    case 'recurring_bills':
      return `${event}:${list(data.numbers, 50).join(',')}`;
    case 'agent_urgent':
      return `${event}:${clip(data.title, 120)}:${clip(data.at, 40)}`;
  }
}

export function renderEvent(event: EmailEventId, data: Record<string, unknown>, ctx: MailContext, currency = 'USD'): RenderedMail {
  const p = (s: string) => `[${clip(ctx.workspaceName, 40)}] ${s}`;
  let subject: string;
  let r: { html: string; text: string };
  switch (event) {
    case 'sla_breach':
      subject = p(`SLA breached on ${clip(data.ticketId, 20)}`);
      r = layout(ctx, `SLA breached: ${clip(data.ticketId, 20)}`, `${clip(data.subject, 160)} missed its ${clip(data.which, 30) || 'service-level'} target.`, [{ rows: [{ left: 'Priority', right: clip(data.priority, 20) || 'n/a' }, { left: 'Ticket', right: clip(data.ticketId, 20) }] }], { label: 'Open the Support Desk', path: '/app' });
      break;
    case 'ticket_new':
      subject = p(`New ticket ${clip(data.ticketId, 20)}: ${clip(data.subject, 80)}`);
      r = layout(ctx, `New ticket ${clip(data.ticketId, 20)}`, `${clip(data.subject, 160)}`, [{ rows: [{ left: 'From', right: clip(data.from, 80) || 'unknown' }, { left: 'Priority', right: clip(data.priority, 20) || 'medium' }] }], { label: 'Open the Support Desk', path: '/app' });
      break;
    case 'approval_requested': {
      const amount = Number(data.amount);
      subject = p(`Approval needed: ${clip(data.title, 90)}`);
      r = layout(
        ctx,
        'Waiting for your approval',
        clip(data.title, 200),
        [{ lines: [clip(data.description, 400)].filter(Boolean), rows: [{ left: 'Requested by', right: clip(data.submittedBy, 60) || 'an agent' }, ...(Number.isFinite(amount) && amount > 0 ? [{ left: 'Amount', right: fmtMoney(amount, currency) }] : [])] }, { lines: ['Nothing runs until you approve it.'] }],
        { label: 'Review the approval', path: '/app' },
      );
      break;
    }
    case 'recurring_invoices': {
      const n = list(data.numbers);
      subject = p(`${n.length} recurring invoice${n.length === 1 ? '' : 's'} drafted`);
      r = layout(ctx, 'Recurring invoices drafted', 'These drafts are ready for review. Nothing was sent to your customers.', [{ heading: 'Drafts', rows: n.map((x) => ({ left: x })) }], { label: 'Review invoices', path: '/app' });
      break;
    }
    case 'recurring_bills': {
      const n = list(data.numbers);
      subject = p(`${n.length} recurring bill${n.length === 1 ? '' : 's'} recorded`);
      r = layout(ctx, 'Recurring bills recorded', 'These vendor bills were recorded as unpaid. Nothing was paid.', [{ heading: 'Bills', rows: n.map((x) => ({ left: x })) }], { label: 'Review bills', path: '/app' });
      break;
    }
    case 'agent_urgent':
      subject = p(`Urgent: ${clip(data.title, 100)}`);
      r = layout(ctx, clip(data.title, 160), 'A scheduled agent check flagged this as urgent.', [{ lines: [clip(data.body, 600)] }], { label: 'Open Borga', path: '/app' });
      break;
  }
  return { subject, ...r };
}

export function renderTest(ctx: MailContext): RenderedMail {
  const r = layout(ctx, 'Email updates are working', `This is a test message for ${ctx.workspaceName}. If you can read it, approvals, alerts and the digest will reach this address.`, [{ lines: ['You can change what is sent in Settings → Email updates.'] }], { label: 'Open Borga', path: '/app' });
  return { subject: `[${clip(ctx.workspaceName, 40)}] Test email`, ...r };
}

// ---------------------------------------------------------------------------
// Digest

const isoDate = (s: string | undefined): string | null => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);
const addDaysIso = (iso: string, d: number) => new Date(Date.parse(iso + 'T00:00:00Z') + d * 86_400_000).toISOString().slice(0, 10);

export interface DigestInput {
  todayIso: string;
  currency: string;
  invoices: Array<{ number: string; client: string; amount: number; due: string; status: string; voidedAt?: string }>;
  bills: Array<{ number: string; vendorName: string; amount: number; due: string; status: string; voidedAt?: string }>;
  approvals: Array<{ title: string; amount: number; status: string; submittedBy: string }>;
  tickets: { open: number; breached: number; atRisk: number; unassigned: number } | null;
  finance: Array<{ amount: number; kind: string; dateIso?: string; voidedAt?: string }>;
}

export interface DigestModel {
  overdueInvoices: { count: number; total: number; top: Array<{ label: string; due: string; amount: number }> };
  billsDue: { overdue: number; soon: number; total: number; top: Array<{ label: string; due: string; amount: number }> };
  approvals: { count: number; top: Array<{ title: string; amount: number }> };
  tickets: DigestInput['tickets'];
  month: { revenue: number; expenses: number };
  /** True when there is something that needs attention (not merely informational). */
  needsAttention: boolean;
}

export function buildDigestModel(i: DigestInput): DigestModel {
  const overdue = i.invoices
    .filter((x) => !x.voidedAt && (x.status === 'sent' || x.status === 'overdue'))
    .map((x) => ({ x, due: isoDate(x.due) }))
    .filter((v) => v.due && v.due < i.todayIso)
    .sort((a, b) => (a.due as string).localeCompare(b.due as string));
  const horizon = addDaysIso(i.todayIso, 7);
  const payable = i.bills
    .filter((b) => !b.voidedAt && b.status !== 'paid')
    .map((b) => ({ b, due: isoDate(b.due) }))
    .filter((v) => v.due && v.due <= horizon)
    .sort((a, b) => (a.due as string).localeCompare(b.due as string));
  const pending = i.approvals.filter((a) => a.status === 'pending');
  const monthPrefix = i.todayIso.slice(0, 7);
  const inMonth = i.finance.filter((f) => !f.voidedAt && (f.dateIso ?? '').startsWith(monthPrefix));
  const sum = (kind: (k: string) => boolean) => Math.round(inMonth.filter((f) => kind(f.kind)).reduce((s, f) => s + f.amount, 0) * 100) / 100;
  const model: DigestModel = {
    overdueInvoices: {
      count: overdue.length,
      total: Math.round(overdue.reduce((s, v) => s + v.x.amount, 0) * 100) / 100,
      top: overdue.slice(0, 5).map((v) => ({ label: `${v.x.number} · ${v.x.client}`, due: v.due as string, amount: v.x.amount })),
    },
    billsDue: {
      overdue: payable.filter((v) => (v.due as string) < i.todayIso).length,
      soon: payable.filter((v) => (v.due as string) >= i.todayIso).length,
      total: Math.round(payable.reduce((s, v) => s + v.b.amount, 0) * 100) / 100,
      top: payable.slice(0, 5).map((v) => ({ label: `${v.b.number} · ${v.b.vendorName}`, due: v.due as string, amount: v.b.amount })),
    },
    approvals: { count: pending.length, top: pending.slice(0, 5).map((a) => ({ title: a.title, amount: a.amount })) },
    tickets: i.tickets,
    month: { revenue: sum((k) => k === 'revenue'), expenses: sum((k) => k === 'expense' || k === 'cost') },
    needsAttention: false,
  };
  model.needsAttention = model.overdueInvoices.count > 0 || model.billsDue.overdue + model.billsDue.soon > 0 || model.approvals.count > 0 || (model.tickets?.breached ?? 0) > 0 || (model.tickets?.atRisk ?? 0) > 0;
  return model;
}

export function renderDigest(m: DigestModel, ctx: MailContext, currency: string, period: 'daily' | 'weekly', dateLabel: string): RenderedMail {
  const blocks: Block[] = [];
  if (m.approvals.count) blocks.push({ heading: `Waiting for your approval (${m.approvals.count})`, rows: m.approvals.top.map((a) => ({ left: a.title, right: a.amount > 0 ? fmtMoney(a.amount, currency) : undefined })) });
  if (m.overdueInvoices.count) blocks.push({ heading: `Overdue invoices (${m.overdueInvoices.count}, ${fmtMoney(m.overdueInvoices.total, currency)})`, rows: m.overdueInvoices.top.map((x) => ({ left: `${x.label} (due ${x.due})`, right: fmtMoney(x.amount, currency) })) });
  if (m.billsDue.overdue + m.billsDue.soon) blocks.push({ heading: `Bills to pay (${m.billsDue.overdue} overdue, ${m.billsDue.soon} due within 7 days)`, rows: m.billsDue.top.map((x) => ({ left: `${x.label} (due ${x.due})`, right: fmtMoney(x.amount, currency) })) });
  if (m.tickets && (m.tickets.open || m.tickets.breached)) {
    blocks.push({ heading: 'Support Desk', rows: [{ left: 'Open tickets', right: String(m.tickets.open) }, { left: 'SLA breached', right: String(m.tickets.breached) }, { left: 'At risk', right: String(m.tickets.atRisk) }, { left: 'Unassigned', right: String(m.tickets.unassigned) }] });
  }
  blocks.push({ heading: 'This month so far', rows: [{ left: 'Revenue recorded', right: fmtMoney(m.month.revenue, currency) }, { left: 'Expenses recorded', right: fmtMoney(m.month.expenses, currency) }] });
  const intro = m.needsAttention ? 'Here is what needs your attention.' : 'Nothing needs your attention right now.';
  const r = layout(ctx, `Your ${period} update`, `${dateLabel}. ${intro}`, blocks, { label: 'Open Borga', path: '/app' });
  return { subject: `[${clip(ctx.workspaceName, 40)}] ${period === 'weekly' ? 'Weekly' : 'Daily'} update: ${m.needsAttention ? 'items need attention' : 'all clear'}`, ...r };
}

/** The company's local clock, for deciding when a digest is due. */
export function localClock(now: Date, timeZone: string | undefined): { dateIso: string; hour: number; weekday: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(now);
    const g = (t: string) => parts.find((x) => x.type === t)?.value ?? '';
    const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(g('weekday'));
    return { dateIso: `${g('year')}-${g('month')}-${g('day')}`, hour: Number(g('hour')) % 24, weekday: wd };
  } catch {
    return { dateIso: now.toISOString().slice(0, 10), hour: now.getUTCHours(), weekday: now.getUTCDay() };
  }
}

/** Period key for dedupe, or null when the digest is not due right now. */
export function digestPeriodKey(settings: EmailSettings['digest'], now: Date, timeZone: string | undefined): string | null {
  if (settings.frequency === 'off') return null;
  const c = localClock(now, timeZone);
  if (c.hour < settings.hour) return null;
  if (settings.frequency === 'weekly') {
    if (c.weekday !== 1) return null; // Mondays
    return `week:${c.dateIso}`;
  }
  return `day:${c.dateIso}`;
}
