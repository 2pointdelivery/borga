import 'server-only';
import { createHash } from 'crypto';
import { deleteBorgaState, getBorgaState, insertBorgaStateIfAbsent, setBorgaState } from './persistence';
import { userWsKey, userWorkspacesKey } from './keys';
import { isEmailConfigured, sendThreadedEmail } from '@/lib/auth/mailer';
import { getApiKey } from './secrets';
import { loadFeatures } from './features-server';
import { loadSettings as loadTicketSettings, listTickets } from './tickets-server';
import { computeSla, isDoneStatus, policyFor } from './tickets';
import type { Approval, Bill, FinanceEntry, Invoice, Workspace } from './data';
import {
  buildDigestModel,
  digestPeriodKey,
  eventDedupeKey,
  localClock,
  makeUnsubToken,
  mergeSettings,
  normalizeRecipients,
  readUnsubToken,
  renderDigest,
  renderEvent,
  renderTest,
  type EmailEventId,
  type EmailSettings,
  type MailContext,
  type RenderedMail,
} from './email-core';

/**
 * Transactional email updates, scoped to one company workspace. Recipients, event switches and the
 * digest schedule are per workspace; nothing is sent unless that workspace turned updates on and
 * SMTP is configured. Everything here is non-throwing: a mail problem never breaks the feature
 * that raised the event.
 */

const settingsKey = (u: string, ws: string) => userWsKey(u, ws, 'emailSettings');
const logKey = (u: string, ws: string) => `t::${u}::${ws}::maillog`;
const claimKey = (u: string, ws: string, k: string) => `t::${u}::${ws}::mail::${createHash('sha1').update(k).digest('hex')}`;

export async function loadEmailSettings(u: string, ws: string): Promise<EmailSettings> {
  return mergeSettings(await getBorgaState<Partial<EmailSettings>>(settingsKey(u, ws)));
}

export async function saveEmailSettings(u: string, ws: string, patch: Partial<EmailSettings>): Promise<EmailSettings> {
  const cur = await loadEmailSettings(u, ws);
  const next = mergeSettings({
    ...cur,
    ...patch,
    events: { ...cur.events, ...(patch.events ?? {}) },
    digest: { ...cur.digest, ...(patch.digest ?? {}) },
    recipients: patch.recipients !== undefined ? normalizeRecipients(patch.recipients) : cur.recipients,
  });
  await setBorgaState(settingsKey(u, ws), next);
  return next;
}

// ---------------------------------------------------------------------------
// Delivery log

export interface MailLogEntry {
  at: string;
  event: string;
  subject: string;
  recipients: number;
  sent: number;
  ok: boolean;
  note?: string;
}

export async function readMailLog(u: string, ws: string): Promise<MailLogEntry[]> {
  return (await getBorgaState<MailLogEntry[]>(logKey(u, ws))) ?? [];
}

async function appendLog(u: string, ws: string, e: MailLogEntry): Promise<void> {
  const cur = await readMailLog(u, ws);
  await setBorgaState(logKey(u, ws), [e, ...cur].slice(0, 100));
}

const MAX_MAILS_PER_HOUR = 30;

// ---------------------------------------------------------------------------
// Sending

interface Info {
  name: string;
  color: string;
  currency: string;
  timezone?: string;
  email?: string;
}

async function workspaceInfo(u: string, ws: string): Promise<Info> {
  const list = (await getBorgaState<Workspace[]>(userWorkspacesKey(u))) ?? [];
  const w = list.find((x) => x.id === ws);
  return { name: w?.name ?? 'Your company', color: w?.color ?? '#6366f1', currency: w?.currency ?? 'USD', timezone: w?.timezone, email: w?.email };
}

const unsubSecret = () => process.env.BORGA_SECRET_KEY || process.env.SESSION_SECRET || 'dev-insecure-session-secret-change-me';

export function appBaseUrl(settings: EmailSettings): string | undefined {
  const raw = (process.env.APP_URL || settings.appUrl || '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^\s]+$/.test(raw) ? raw : undefined;
}

async function fromHeader(name: string): Promise<string | undefined> {
  const from = await getApiKey('EMAIL_FROM');
  if (!from) return undefined;
  const addr = /<([^>]+)>/.exec(from)?.[1] ?? from;
  return `"${name.replace(/["<>\r\n]/g, '').slice(0, 60)} via Borga" <${addr.trim()}>`;
}

export interface DeliverResult {
  sent: number;
  failed: number;
  skipped?: 'off' | 'no-smtp' | 'no-recipients' | 'duplicate' | 'rate-limited';
}

async function deliver(
  u: string,
  ws: string,
  settings: EmailSettings,
  info: Info,
  label: string,
  render: (ctx: MailContext) => RenderedMail,
  opts: { dedupeKey?: string; recipients?: string[]; ignoreMaster?: boolean } = {},
): Promise<DeliverResult> {
  if (!settings.enabled && !opts.ignoreMaster) return { sent: 0, failed: 0, skipped: 'off' };
  const recipients = opts.recipients ?? settings.recipients;
  if (!recipients.length) return { sent: 0, failed: 0, skipped: 'no-recipients' };
  if (!(await isEmailConfigured())) return { sent: 0, failed: 0, skipped: 'no-smtp' };

  const hourAgo = Date.now() - 3_600_000;
  const recent = (await readMailLog(u, ws)).filter((e) => e.ok && Date.parse(e.at) > hourAgo).length;
  if (recent >= MAX_MAILS_PER_HOUR) return { sent: 0, failed: 0, skipped: 'rate-limited' };

  let claim: string | null = null;
  if (opts.dedupeKey) {
    claim = claimKey(u, ws, opts.dedupeKey);
    if (!(await insertBorgaStateIfAbsent(claim, { at: new Date().toISOString() }))) return { sent: 0, failed: 0, skipped: 'duplicate' };
  }

  const base = appBaseUrl(settings);
  const from = await fromHeader(info.name);
  const replyTo = settings.replyTo || info.email || undefined;
  let sent = 0;
  let failed = 0;
  let subject = label;
  for (const to of recipients) {
    const unsubscribeUrl = base ? `${base}/api/borga/email/unsubscribe?t=${makeUnsubToken(unsubSecret(), u, ws, to)}` : undefined;
    const mail = render({ workspaceName: info.name, accent: info.color, appUrl: base, unsubscribeUrl });
    subject = mail.subject;
    const r = await sendThreadedEmail({
      to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      from,
      replyTo,
      headers: {
        'Auto-Submitted': 'auto-generated',
        'X-Auto-Response-Suppress': 'All',
        ...(unsubscribeUrl ? { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : {}),
      },
    });
    if (r.ok) sent++;
    else failed++;
  }
  if (sent === 0 && claim) await deleteBorgaState(claim); // nothing went out: let the next attempt try again
  await appendLog(u, ws, { at: new Date().toISOString(), event: label, subject, recipients: recipients.length, sent, ok: sent > 0, note: failed ? `${failed} failed` : undefined });
  return { sent, failed };
}

/** Raises one transactional event for a workspace. Never throws. */
export async function notifyEvent(u: string, ws: string, event: EmailEventId, data: Record<string, unknown>): Promise<DeliverResult> {
  try {
    if (!(await loadFeatures(u, ws)).flags.emailUpdates) return { sent: 0, failed: 0, skipped: 'off' };
    const settings = await loadEmailSettings(u, ws);
    if (!settings.enabled || !settings.events[event]) return { sent: 0, failed: 0, skipped: 'off' };
    const info = await workspaceInfo(u, ws);
    return await deliver(u, ws, settings, info, event, (ctx) => renderEvent(event, data, ctx, info.currency), { dedupeKey: eventDedupeKey(event, data) });
  } catch (e) {
    console.warn('[email] notify failed', event, (e as Error).message);
    return { sent: 0, failed: 1 };
  }
}

export async function sendTestEmail(u: string, ws: string, to: string[]): Promise<DeliverResult> {
  const settings = await loadEmailSettings(u, ws);
  const info = await workspaceInfo(u, ws);
  return deliver(u, ws, settings, info, 'test', (ctx) => renderTest(ctx), { recipients: to, ignoreMaster: true });
}

// ---------------------------------------------------------------------------
// Digest

async function digestInput(u: string, ws: string, todayIso: string, currency: string) {
  const read = <T,>(entity: string) => getBorgaState<T[]>(userWsKey(u, ws, entity)).then((v) => v ?? []);
  const [invoices, bills, approvals, finance, tickets] = await Promise.all([
    read<Invoice>('invoices'),
    read<Bill>('bills'),
    read<Approval>('approvals'),
    read<FinanceEntry>('finance'),
    listTickets(u, ws).catch(() => []),
  ]);
  let summary: { open: number; breached: number; atRisk: number; unassigned: number } | null = null;
  if (tickets.length) {
    const ts = await loadTicketSettings(u, ws);
    summary = { open: 0, breached: 0, atRisk: 0, unassigned: 0 };
    for (const t of tickets.filter((x) => !isDoneStatus(x.status))) {
      const worst = computeSla(t, policyFor(t, ts), ts.businessHours).worst;
      summary.open++;
      if (worst === 'breached') summary.breached++;
      if (worst === 'at-risk') summary.atRisk++;
      if (!t.assignee) summary.unassigned++;
    }
  }
  return { todayIso, currency, invoices, bills, approvals, finance, tickets: summary };
}

/** Sends the digest when it is due (company-local hour + period not yet sent). `force` sends now regardless. */
export async function sendDigest(u: string, ws: string, opts: { force?: boolean; now?: Date } = {}): Promise<DeliverResult & { needsAttention?: boolean }> {
  try {
    if (!(await loadFeatures(u, ws)).flags.emailUpdates) return { sent: 0, failed: 0, skipped: 'off' };
    const settings = await loadEmailSettings(u, ws);
    if (!settings.enabled) return { sent: 0, failed: 0, skipped: 'off' };
    const info = await workspaceInfo(u, ws);
    const now = opts.now ?? new Date();
    const key = opts.force ? `force:${now.getTime()}` : digestPeriodKey(settings.digest, now, info.timezone);
    if (!key) return { sent: 0, failed: 0, skipped: 'off' };
    const clock = localClock(now, info.timezone);
    const model = buildDigestModel(await digestInput(u, ws, clock.dateIso, info.currency));
    if (!opts.force && settings.digest.skipIfEmpty && !model.needsAttention) return { sent: 0, failed: 0, skipped: 'off', needsAttention: false };
    const period = settings.digest.frequency === 'weekly' ? 'weekly' : 'daily';
    const label = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: info.timezone || 'UTC' }).format(now);
    const r = await deliver(u, ws, settings, info, `${period}-digest`, (ctx) => renderDigest(model, ctx, info.currency, period, label), { dedupeKey: opts.force ? undefined : `digest:${key}` });
    return { ...r, needsAttention: model.needsAttention };
  } catch (e) {
    console.warn('[email] digest failed', (e as Error).message);
    return { sent: 0, failed: 1 };
  }
}

/** Cron entry: whatever is due for this workspace right now. */
export async function runEmailJobs(u: string, ws: string): Promise<DeliverResult> {
  return sendDigest(u, ws);
}

// ---------------------------------------------------------------------------
// Unsubscribe

/** Removes one recipient from one workspace (link in the email footer / List-Unsubscribe). */
export async function unsubscribeByToken(token: string): Promise<{ ok: boolean; workspace?: string; email?: string }> {
  const t = readUnsubToken(unsubSecret(), token);
  if (!t) return { ok: false };
  const settings = await loadEmailSettings(t.userId, t.ws);
  if (settings.recipients.includes(t.email)) await saveEmailSettings(t.userId, t.ws, { recipients: settings.recipients.filter((r) => r !== t.email) });
  const info = await workspaceInfo(t.userId, t.ws);
  return { ok: true, workspace: info.name, email: t.email };
}
