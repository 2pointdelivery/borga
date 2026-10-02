import 'server-only';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { z } from 'zod';
import {
  getBorgaState,
  setBorgaState,
  deleteBorgaState,
  getBorgaStatesByPrefix,
  insertBorgaStateIfAbsent,
  listBorgaKeys,
} from './persistence';
import { userWsKey } from './keys';
import { encryptSecret, decryptSecret } from './secrets';
import { sendThreadedEmail, isEmailConfigured } from '@/lib/auth/mailer';
import type { ProactiveNotice } from './data';
import {
  DEFAULT_TICKET_SETTINGS,
  EMAIL_RE,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  TICKET_TYPES,
  TRANSITIONS,
  computeSla,
  htmlToText,
  isAutomatedMail,
  isDoneStatus,
  normalizeSubject,
  policyFor,
  stripQuotedReply,
  ticketToken,
  tokenFromSubject,
  type Ticket,
  type TicketComment,
  type TicketPriority,
  type TicketSettings,
  type TicketSource,
  type TicketStatus,
  type TicketSummary,
  type TicketType,
} from './tickets';

// ---------------------------------------------------------------------------
// Keys. Tickets live one-per-row under the `t::` namespace (NOT `u::`) so the
// dashboard's bulk hydrate (`u::<user>::ws::<ws>::` prefix) never loads them,
// and concurrent edits to different tickets never overwrite each other.

const ticketPrefix = (u: string, ws: string) => `t::${u}::${ws}::tk::`;
const ticketKey = (u: string, ws: string, id: string) => `${ticketPrefix(u, ws)}${id}`;
const midKey = (u: string, ws: string, messageId: string) =>
  `t::${u}::${ws}::mid::${createHash('sha1').update(messageId.trim().toLowerCase()).digest('hex')}`;
const settingsKey = (u: string, ws: string) => userWsKey(u, ws, 'ticketSettings');

const now = () => new Date().toISOString();
const rid = (p: string) => `${p}-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;

// ---------------------------------------------------------------------------
// Settings (server copy also holds the IMAP password and the inbound token)

export interface StoredTicketSettings extends TicketSettings {
  imapPassEnc?: string;
  inboundToken: string;
}

export type PublicTicketSettings = TicketSettings & { hasImapPassword: boolean; inboundToken: string };

export async function loadSettings(u: string, ws: string): Promise<StoredTicketSettings> {
  const stored = await getBorgaState<Partial<StoredTicketSettings>>(settingsKey(u, ws));
  const merged: StoredTicketSettings = {
    ...DEFAULT_TICKET_SETTINGS,
    ...stored,
    mailbox: { ...DEFAULT_TICKET_SETTINGS.mailbox, ...stored?.mailbox },
    businessHours: { ...DEFAULT_TICKET_SETTINGS.businessHours, ...stored?.businessHours },
    slaPolicies: stored?.slaPolicies?.length ? stored.slaPolicies : DEFAULT_TICKET_SETTINGS.slaPolicies,
    inboundToken: stored?.inboundToken || randomBytes(24).toString('hex'),
  };
  if (!stored?.inboundToken) await setBorgaState(settingsKey(u, ws), merged);
  return merged;
}

export function toPublicSettings(s: StoredTicketSettings): PublicTicketSettings {
  const { imapPassEnc, ...rest } = s;
  return { ...rest, hasImapPassword: !!imapPassEnc };
}

const minutes = z.number().int().min(1).max(525_600);
const targetSchema = z.object({ firstResponseMin: minutes, resolutionMin: minutes });
const hhmm = z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/);

export const settingsPatchSchema = z.object({
  keyPrefix: z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/),
  defaultSlaPolicyId: z.string().max(64),
  escalationEmail: z.string().max(254).refine((v) => v === '' || EMAIL_RE.test(v)),
  businessHours: z.object({
    utcOffsetMin: z.number().int().min(-720).max(840),
    days: z.array(z.number().int().min(0).max(6)).max(7),
    start: hhmm,
    end: hhmm,
  }),
  slaPolicies: z.array(z.object({
    id: z.string().min(1).max(64),
    name: z.string().min(1).max(80),
    businessHoursOnly: z.boolean(),
    targets: z.object({ critical: targetSchema, high: targetSchema, medium: targetSchema, low: targetSchema }),
  })).min(1).max(10),
  mailbox: z.object({
    enabled: z.boolean(),
    address: z.string().max(254).refine((v) => v === '' || EMAIL_RE.test(v)),
    displayName: z.string().max(80),
    imapHost: z.string().max(255),
    imapPort: z.number().int().min(1).max(65535),
    imapSecure: z.boolean(),
    imapUser: z.string().max(255),
    folder: z.string().min(1).max(120),
    autoAck: z.boolean(),
  }),
}).partial();

export async function saveSettings(
  u: string,
  ws: string,
  patch: z.infer<typeof settingsPatchSchema>,
  opts: { imapPassword?: string; regenerateToken?: boolean } = {},
): Promise<PublicTicketSettings> {
  const cur = await loadSettings(u, ws);
  const next: StoredTicketSettings = {
    ...cur,
    ...patch,
    mailbox: { ...cur.mailbox, ...patch.mailbox },
    businessHours: { ...cur.businessHours, ...patch.businessHours },
  };
  if (!next.slaPolicies.some((p) => p.id === next.defaultSlaPolicyId)) next.defaultSlaPolicyId = next.slaPolicies[0].id;
  if (opts.imapPassword !== undefined) next.imapPassEnc = opts.imapPassword ? encryptSecret(opts.imapPassword) : undefined;
  if (opts.regenerateToken) next.inboundToken = randomBytes(24).toString('hex');
  await setBorgaState(settingsKey(u, ws), next);
  return toPublicSettings(next);
}

export function verifyInboundToken(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Tickets

export async function getTicket(u: string, ws: string, id: string): Promise<Ticket | null> {
  if (!/^[A-Z][A-Z0-9]{1,9}-\d{1,9}$/.test(id)) return null;
  return getBorgaState<Ticket>(ticketKey(u, ws, id));
}

async function saveTicket(u: string, ws: string, t: Ticket): Promise<Ticket> {
  const next = { ...t, updatedAt: now(), comments: t.comments.slice(-300), messageIds: t.messageIds.slice(-60) };
  await setBorgaState(ticketKey(u, ws, t.id), next);
  return next;
}

export function summarize(t: Ticket): TicketSummary {
  const { comments, ...rest } = t;
  const last = comments[comments.length - 1];
  return { ...rest, commentCount: comments.length, lastActivityAt: last?.at ?? t.updatedAt };
}

export async function listTickets(u: string, ws: string): Promise<Ticket[]> {
  const rows = await getBorgaStatesByPrefix(ticketPrefix(u, ws));
  return Object.values(rows as Record<string, Ticket>).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function sysComment(body: string, author = 'System'): TicketComment {
  return { id: rid('c'), at: now(), kind: 'system', author, body };
}

export const createInputSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  description: z.string().max(20_000).default(''),
  type: z.enum(TICKET_TYPES as [TicketType, ...TicketType[]]).default('request'),
  priority: z.enum(TICKET_PRIORITIES as [TicketPriority, ...TicketPriority[]]).default('medium'),
  requesterName: z.string().trim().max(120).default(''),
  requesterEmail: z.string().trim().toLowerCase().max(254).refine((v) => v === '' || EMAIL_RE.test(v)).default(''),
  assignee: z.string().trim().max(120).default(''),
  labels: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  projectId: z.string().max(64).optional(),
  customerId: z.string().max(64).optional(),
  slaPolicyId: z.string().max(64).optional(),
});
export type CreateTicketInput = z.input<typeof createInputSchema>;

export async function createTicket(
  u: string,
  ws: string,
  raw: CreateTicketInput,
  ctx: { source: TicketSource; actor: string; messageId?: string; extraComments?: TicketComment[] },
): Promise<Ticket> {
  const input = createInputSchema.parse(raw);
  const settings = await loadSettings(u, ws);
  const t0 = now();
  const base: Omit<Ticket, 'id' | 'number'> = {
    subject: input.subject,
    description: input.description,
    type: input.type,
    priority: input.priority,
    status: 'open',
    source: ctx.source,
    requesterName: input.requesterName || input.requesterEmail.split('@')[0] || 'Unknown',
    requesterEmail: input.requesterEmail,
    participants: [],
    assignee: input.assignee,
    labels: input.labels,
    projectId: input.projectId,
    customerId: input.customerId,
    slaPolicyId: input.slaPolicyId && settings.slaPolicies.some((p) => p.id === input.slaPolicyId) ? input.slaPolicyId : settings.defaultSlaPolicyId,
    createdAt: t0,
    updatedAt: t0,
    firstResponseAt: null,
    resolvedAt: null,
    closedAt: null,
    reopenCount: 0,
    pauses: [],
    messageIds: ctx.messageId ? [ctx.messageId] : [],
    notified: {},
    timeSpentMin: 0,
    comments: [sysComment(`Ticket created via ${ctx.source}.`, ctx.actor), ...(ctx.extraComments ?? [])],
  };

  // Atomic numbering: the ticket row itself is the lock (insert-if-absent).
  let n = settings.nextNumber;
  for (let attempt = 0; attempt < 25; attempt++, n++) {
    const id = `${settings.keyPrefix}-${n}`;
    const ticket: Ticket = { ...base, id, number: n };
    if (await insertBorgaStateIfAbsent(ticketKey(u, ws, id), ticket)) {
      const latest = await loadSettings(u, ws);
      if (latest.nextNumber <= n) await setBorgaState(settingsKey(u, ws), { ...latest, nextNumber: n + 1 });
      if (ctx.messageId) await setBorgaState(midKey(u, ws, ctx.messageId), { ticketId: id });
      return ticket;
    }
  }
  throw new Error('Could not allocate a ticket number');
}

export const updateInputSchema = z.object({
  subject: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(20_000).optional(),
  type: z.enum(TICKET_TYPES as [TicketType, ...TicketType[]]).optional(),
  priority: z.enum(TICKET_PRIORITIES as [TicketPriority, ...TicketPriority[]]).optional(),
  status: z.enum(TICKET_STATUSES as [TicketStatus, ...TicketStatus[]]).optional(),
  assignee: z.string().trim().max(120).optional(),
  labels: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
  projectId: z.string().max(64).nullable().optional(),
  customerId: z.string().max(64).nullable().optional(),
  slaPolicyId: z.string().max(64).optional(),
  addTimeMin: z.number().int().min(1).max(1440).optional(),
});
export type UpdateTicketInput = z.infer<typeof updateInputSchema>;

/** Applies a status change with workflow validation, SLA pause bookkeeping and audit comments. */
function applyStatus(t: Ticket, to: TicketStatus, actor: string): string | null {
  if (to === t.status) return null;
  if (!TRANSITIONS[t.status].includes(to)) return `Cannot move a ticket from "${t.status}" to "${to}".`;
  const at = now();
  const from = t.status;
  if (to === 'pending') t.pauses = [...t.pauses, { from: at }];
  if (from === 'pending') t.pauses = t.pauses.map((p) => (p.to ? p : { ...p, to: at }));
  if (to === 'resolved') t.resolvedAt = t.resolvedAt ?? at;
  if (to === 'closed') {
    t.closedAt = at;
    t.resolvedAt = t.resolvedAt ?? at;
  }
  if (isDoneStatus(from) && !isDoneStatus(to)) {
    t.resolvedAt = null;
    t.closedAt = null;
    t.reopenCount += 1;
  }
  t.status = to;
  t.comments.push(sysComment(`Status: ${from} → ${to}`, actor));
  return null;
}

export async function updateTicket(u: string, ws: string, id: string, patch: UpdateTicketInput, actor: string): Promise<{ ticket?: Ticket; error?: string }> {
  const t = await getTicket(u, ws, id);
  if (!t) return { error: 'Ticket not found' };
  const settings = await loadSettings(u, ws);
  const before = { priority: t.priority, assignee: t.assignee, status: t.status };

  if (patch.status) {
    const err = applyStatus(t, patch.status, actor);
    if (err) return { error: err };
  }
  if (patch.subject !== undefined) t.subject = patch.subject;
  if (patch.description !== undefined) t.description = patch.description;
  if (patch.type) t.type = patch.type;
  if (patch.priority) t.priority = patch.priority;
  if (patch.assignee !== undefined) t.assignee = patch.assignee;
  if (patch.labels) t.labels = patch.labels;
  if (patch.projectId !== undefined) t.projectId = patch.projectId ?? undefined;
  if (patch.customerId !== undefined) t.customerId = patch.customerId ?? undefined;
  if (patch.slaPolicyId && settings.slaPolicies.some((p) => p.id === patch.slaPolicyId)) t.slaPolicyId = patch.slaPolicyId;
  if (patch.addTimeMin) t.timeSpentMin += patch.addTimeMin;

  if (t.priority !== before.priority) {
    t.comments.push(sysComment(`Priority: ${before.priority} → ${t.priority}`, actor));
    t.notified = {}; // new targets → escalation thresholds re-arm
  }
  if (t.assignee !== before.assignee) t.comments.push(sysComment(`Assignee: ${before.assignee || 'unassigned'} → ${t.assignee || 'unassigned'}`, actor));

  const saved = await saveTicket(u, ws, t);
  if (patch.status) {
    // Keep the optional Supermemory index in step: resolved tickets become searchable examples, reopened ones are removed.
    const wasDone = isDoneStatus(before.status);
    const nowDone = isDoneStatus(saved.status);
    if (nowDone) void import('./supermemory-sync').then((m) => m.indexTicket(u, ws, saved.id)).catch(() => undefined);
    else if (wasDone) void import('./supermemory-sync').then((m) => m.unindexTicket(u, ws, saved.id)).catch(() => undefined);
  }
  if (patch.status === 'resolved' && saved.requesterEmail && settings.mailbox.enabled) {
    void sendToRequester(u, ws, settings, saved, `Your request ${saved.id} has been marked resolved. Reply to this email if you still need help and we will reopen it.`, false);
  }
  return { ticket: saved };
}

// ---------------------------------------------------------------------------
// Outbound mail (threaded)

function fromHeader(s: TicketSettings): string | undefined {
  return s.mailbox.address ? `${s.mailbox.displayName.replace(/[<>"\r\n]/g, '') || 'Support'} <${s.mailbox.address}>` : undefined;
}

const escapeHtml = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function sendToRequester(
  u: string,
  ws: string,
  settings: TicketSettings,
  t: Ticket,
  body: string,
  auto: boolean,
): Promise<{ messageId?: string; delivery: 'sent' | 'failed' | 'not-configured' }> {
  if (!t.requesterEmail) return { delivery: 'failed' };
  if (!(await isEmailConfigured({ userId: u, ws }))) return { delivery: 'not-configured' };
  const refs = t.messageIds.slice(-20);
  const r = await sendThreadedEmail({
    to: t.requesterEmail,
    subject: `Re: ${ticketToken(t.id)} ${normalizeSubject(t.subject)}`,
    text: body,
    html: `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.5;white-space:pre-wrap">${escapeHtml(body)}</div>`,
    from: fromHeader(settings),
    replyTo: settings.mailbox.address || undefined,
    inReplyTo: refs[refs.length - 1],
    references: refs,
    headers: auto ? { 'Auto-Submitted': 'auto-replied', 'X-Auto-Response-Suppress': 'All' } : undefined,
  }, { userId: u, ws });
  if (!r.ok) return { delivery: 'failed' };
  if (r.messageId) {
    t.messageIds.push(r.messageId);
    await setBorgaState(midKey(u, ws, r.messageId), { ticketId: t.id });
  }
  return { messageId: r.messageId, delivery: 'sent' };
}

export async function addComment(
  u: string,
  ws: string,
  id: string,
  input: { kind: 'public' | 'internal'; body: string; author: string; setStatus?: TicketStatus },
): Promise<{ ticket?: Ticket; error?: string }> {
  const t = await getTicket(u, ws, id);
  if (!t) return { error: 'Ticket not found' };
  const body = input.body.trim().slice(0, 20_000);
  if (!body) return { error: 'Comment is empty' };
  const settings = await loadSettings(u, ws);
  const comment: TicketComment = { id: rid('c'), at: now(), kind: input.kind, author: input.author, body };

  if (input.kind === 'public') {
    t.firstResponseAt = t.firstResponseAt ?? comment.at;
    if (t.requesterEmail) {
      const sent = await sendToRequester(u, ws, settings, t, body, false);
      comment.delivery = sent.delivery;
      if (sent.messageId) comment.messageId = sent.messageId;
    } else {
      comment.delivery = 'failed';
    }
  }
  t.comments.push(comment);
  const wasDone = isDoneStatus(t.status);
  if (input.setStatus) {
    const err = applyStatus(t, input.setStatus, input.author);
    if (err) return { error: err };
  }
  const saved = await saveTicket(u, ws, t);
  if (input.setStatus && isDoneStatus(saved.status)) void import('./supermemory-sync').then((m) => m.indexTicket(u, ws, saved.id)).catch(() => undefined);
  else if (input.setStatus && wasDone) void import('./supermemory-sync').then((m) => m.unindexTicket(u, ws, saved.id)).catch(() => undefined);
  return { ticket: saved };
}

// ---------------------------------------------------------------------------
// Inbound mail → ticket / comment

export interface InboundEmail {
  from: string;
  fromName?: string;
  subject: string;
  text?: string;
  html?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
  headers?: Record<string, string>;
}

export type IngestResult =
  | { ok: true; action: 'created' | 'replied'; ticketId: string }
  | { ok: true; action: 'ignored'; reason: string };

// Per-sender flood guard for new tickets (per process; good enough to blunt mail loops).
const senderHits = new Map<string, number[]>();
const MAX_NEW_TICKETS_PER_SENDER_HOUR = 10;
function floodLimited(key: string): boolean {
  const cutoff = Date.now() - 3_600_000;
  const hits = (senderHits.get(key) ?? []).filter((x) => x > cutoff);
  if (hits.length >= MAX_NEW_TICKETS_PER_SENDER_HOUR) {
    senderHits.set(key, hits);
    return true;
  }
  hits.push(Date.now());
  senderHits.set(key, hits);
  if (senderHits.size > 5000) senderHits.clear();
  return false;
}

function cleanId(v: string | undefined): string | undefined {
  const s = v?.trim();
  return s && s.length <= 500 ? s : undefined;
}

async function findThread(u: string, ws: string, mail: InboundEmail, fromEmail: string, settings: TicketSettings): Promise<Ticket | null> {
  // 1. Headers: In-Reply-To / References point at a Message-ID we know belongs to a ticket.
  const refs = [mail.inReplyTo, ...(mail.references ?? [])].map(cleanId).filter((x): x is string => !!x).slice(-20);
  for (const ref of refs.reverse()) {
    const hit = await getBorgaState<{ ticketId?: string }>(midKey(u, ws, ref));
    if (hit?.ticketId) {
      const t = await getTicket(u, ws, hit.ticketId);
      if (t) return t;
    }
  }
  // 2. Subject token "[SUP-12]" — only honoured for the requester or a known participant,
  //    so guessing ticket numbers cannot be used to inject comments into someone else's ticket.
  const tok = tokenFromSubject(mail.subject);
  if (tok && tok.prefix === settings.keyPrefix) {
    const t = await getTicket(u, ws, `${tok.prefix}-${tok.number}`);
    if (t && (t.requesterEmail === fromEmail || t.participants.includes(fromEmail))) return t;
  }
  return null;
}

export async function ingestEmail(u: string, ws: string, mail: InboundEmail): Promise<IngestResult> {
  const settings = await loadSettings(u, ws);
  if (!settings.mailbox.enabled) return { ok: true, action: 'ignored', reason: 'mailbox disabled' };

  const fromEmail = mail.from.trim().toLowerCase().replace(/^.*<([^>]+)>.*$/, '$1');
  if (!EMAIL_RE.test(fromEmail)) return { ok: true, action: 'ignored', reason: 'invalid sender' };
  if (fromEmail === settings.mailbox.address.toLowerCase()) return { ok: true, action: 'ignored', reason: 'own address (loop guard)' };
  const headers = Object.fromEntries(Object.entries(mail.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
  if (isAutomatedMail(headers, fromEmail)) return { ok: true, action: 'ignored', reason: 'automated mail' };

  const messageId = cleanId(mail.messageId);
  if (messageId && !(await insertBorgaStateIfAbsent(midKey(u, ws, messageId), { at: now() }))) {
    return { ok: true, action: 'ignored', reason: 'duplicate message' };
  }

  try {
    return await routeMail(u, ws, mail, settings, fromEmail, messageId);
  } catch (e) {
    // Release the dedupe claim so a bridge retry is processed instead of dropped as a duplicate.
    if (messageId) await deleteBorgaState(midKey(u, ws, messageId));
    throw e;
  }
}

async function routeMail(u: string, ws: string, mail: InboundEmail, settings: StoredTicketSettings, fromEmail: string, messageId: string | undefined): Promise<IngestResult> {
  const text = stripQuotedReply(mail.text?.trim() ? mail.text : htmlToText(mail.html ?? '')).slice(0, 20_000) || '(empty message)';
  const name = (mail.fromName ?? '').replace(/[\r\n]/g, ' ').trim().slice(0, 120);
  const thread = await findThread(u, ws, mail, fromEmail, settings);

  if (thread) {
    const reopen = thread.status === 'pending' || isDoneStatus(thread.status);
    thread.comments.push({ id: rid('c'), at: now(), kind: 'email-in', author: name || fromEmail, authorEmail: fromEmail, body: text, messageId });
    if (messageId) thread.messageIds.push(messageId);
    if (fromEmail !== thread.requesterEmail && !thread.participants.includes(fromEmail)) thread.participants = [...thread.participants, fromEmail].slice(0, 20);
    const wasDone = isDoneStatus(thread.status);
    if (reopen) applyStatus(thread, 'open', 'Email reply');
    await saveTicket(u, ws, thread);
    if (wasDone && reopen) void import('./supermemory-sync').then((m) => m.unindexTicket(u, ws, thread.id)).catch(() => undefined);
    if (messageId) await setBorgaState(midKey(u, ws, messageId), { ticketId: thread.id });
    return { ok: true, action: 'replied', ticketId: thread.id };
  }

  if (floodLimited(`${u}:${ws}:${fromEmail}`)) return { ok: true, action: 'ignored', reason: 'sender rate limit' };

  const ticket = await createTicket(
    u,
    ws,
    { subject: normalizeSubject(mail.subject).slice(0, 200), description: text, requesterEmail: fromEmail, requesterName: name },
    { source: 'email', actor: name || fromEmail, messageId },
  );
  if (settings.mailbox.autoAck && (await isEmailConfigured({ userId: u, ws }))) {
    const fresh = (await getTicket(u, ws, ticket.id)) ?? ticket;
    const sent = await sendToRequester(
      u,
      ws,
      settings,
      fresh,
      `Hi ${fresh.requesterName},\n\nWe received your request and opened ticket ${fresh.id}. Reply to this email to add more details.\n\n— ${settings.mailbox.displayName || 'Support'}`,
      true,
    );
    if (sent.delivery === 'sent') await saveTicket(u, ws, { ...fresh, comments: [...fresh.comments, sysComment('Acknowledgement emailed to requester.')] });
  }
  void import('./email-notify').then((m) => m.notifyEvent(u, ws, 'ticket_new', { ticketId: ticket.id, subject: ticket.subject, from: name ? `${name} <${fromEmail}>` : fromEmail, priority: ticket.priority })).catch(() => undefined);
  return { ok: true, action: 'created', ticketId: ticket.id };
}

// ---------------------------------------------------------------------------
// IMAP polling (for mailboxes without a push webhook)

const POLL_LIMIT = 25;

export async function pollMailbox(u: string, ws: string): Promise<{ ok: boolean; fetched: number; created: number; replied: number; error?: string }> {
  const settings = await loadSettings(u, ws);
  const mb = settings.mailbox;
  const fail = async (error: string) => {
    await setBorgaState(settingsKey(u, ws), { ...(await loadSettings(u, ws)), mailbox: { ...mb, lastPolledAt: now(), lastError: error } });
    return { ok: false, fetched: 0, created: 0, replied: 0, error };
  };
  if (!mb.enabled) return { ok: true, fetched: 0, created: 0, replied: 0 };
  if (!mb.imapHost || !mb.imapUser || !settings.imapPassEnc) return fail('IMAP host, user and password are required.');
  const pass = decryptSecret(settings.imapPassEnc);
  if (!pass) return fail('Stored IMAP password could not be decrypted — re-enter it.');

  const { ImapFlow } = await import('imapflow');
  const { simpleParser } = await import('mailparser');
  const client = new ImapFlow({
    host: mb.imapHost,
    port: mb.imapPort,
    secure: mb.imapSecure,
    auth: { user: mb.imapUser, pass },
    logger: false,
    greetingTimeout: 15_000,
    socketTimeout: 45_000,
  });
  client.on('error', () => undefined); // surfaced through the awaited calls below

  let fetched = 0;
  let created = 0;
  let replied = 0;
  try {
    await client.connect();
    const lock = await client.getMailboxLock(mb.folder || 'INBOX');
    try {
      const uids = ((await client.search({ seen: false }, { uid: true })) || []).slice(0, POLL_LIMIT);
      for (const uid of uids) {
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (!msg || !msg.source) continue;
        fetched++;
        const parsed = await simpleParser(msg.source);
        const headers: Record<string, string> = {};
        parsed.headers.forEach((v, k) => {
          headers[k] = typeof v === 'string' ? v : Array.isArray(v) ? v.join(', ') : (v as { text?: string })?.text ?? '';
        });
        const refs = Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : [];
        const sender = parsed.from?.value?.[0];
        const r = await ingestEmail(u, ws, {
          from: sender?.address ?? '',
          fromName: sender?.name,
          subject: parsed.subject ?? '',
          text: parsed.text,
          html: typeof parsed.html === 'string' ? parsed.html : undefined,
          messageId: parsed.messageId,
          inReplyTo: parsed.inReplyTo,
          references: refs,
          headers,
        });
        if (r.action === 'created') created++;
        if (r.action === 'replied') replied++;
        await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
      }
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (e) {
    try {
      client.close();
    } catch {
      // already closed
    }
    const err = e as Error & { authenticationFailed?: boolean; responseText?: string; code?: string };
    return fail(
      err.authenticationFailed ? 'IMAP login failed. Check the username and password (Gmail/Outlook need an app password).'
        : err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT' ? `Cannot reach ${mb.imapHost}:${mb.imapPort} (${err.code}). Check host, port and TLS.`
        : err.responseText || err.message || 'IMAP error',
    );
  }
  await setBorgaState(settingsKey(u, ws), { ...(await loadSettings(u, ws)), mailbox: { ...mb, lastPolledAt: now(), lastError: undefined } });
  return { ok: true, fetched, created, replied };
}

// ---------------------------------------------------------------------------
// SLA sweep: marks first-time at-risk / breach crossings, leaves an audit
// comment, raises an in-app notice and (optionally) emails the escalation address.

export async function sweepSla(u: string, ws: string): Promise<{ checked: number; atRisk: number; breached: number }> {
  const settings = await loadSettings(u, ws);
  const open = (await listTickets(u, ws)).filter((t) => !isDoneStatus(t.status));
  const out = { checked: open.length, atRisk: 0, breached: 0 };
  const notices: ProactiveNotice[] = [];
  const emails: string[] = [];

  for (const t of open) {
    const sla = computeSla(t, policyFor(t, settings), settings.businessHours);
    const checks = [
      { clock: sla.response, label: 'first response', risk: 'responseRisk', breach: 'responseBreach' },
      { clock: sla.resolution, label: 'resolution', risk: 'resolutionRisk', breach: 'resolutionBreach' },
    ] as const;
    let dirty = false;
    const newlyBreached: string[] = [];
    for (const c of checks) {
      if (c.clock.state === 'breached' && !t.notified[c.breach]) {
        t.notified[c.breach] = now();
        t.comments.push(sysComment(`SLA breached: ${c.label} target of ${c.clock.targetMin} min exceeded.`));
        out.breached++;
        dirty = true;
        notices.push(mkNotice(`SLA breached — ${t.id}`, `${t.subject} (${t.priority}) missed its ${c.label} target.`, 'urgent'));
        newlyBreached.push(c.label);
        emails.push(`${t.id} "${t.subject}" breached its ${c.label} SLA (${t.priority}).`);
      } else if (c.clock.state === 'at-risk' && !t.notified[c.risk]) {
        t.notified[c.risk] = now();
        out.atRisk++;
        dirty = true;
        notices.push(mkNotice(`SLA at risk — ${t.id}`, `${t.subject} is past 75% of its ${c.label} target.`, 'noteworthy'));
      }
    }
    if (dirty) await saveTicket(u, ws, t);
    // One email per ticket, even when both the response and the resolution clock are breached.
    if (newlyBreached.length) void import('./email-notify').then((m) => m.notifyEvent(u, ws, 'sla_breach', { ticketId: t.id, subject: t.subject, priority: t.priority, which: newlyBreached.join(' + ') })).catch(() => undefined);
  }

  if (notices.length) {
    const key = userWsKey(u, ws, 'notices');
    const existing = (await getBorgaState<ProactiveNotice[]>(key)) ?? [];
    await setBorgaState(key, [...notices, ...existing].slice(0, 100));
  }
  if (emails.length && settings.escalationEmail && (await isEmailConfigured({ userId: u, ws }))) {
    await sendThreadedEmail({
      to: settings.escalationEmail,
      subject: `[SLA] ${emails.length} breach${emails.length === 1 ? '' : 'es'} need attention`,
      text: emails.join('\n'),
      from: fromHeader(settings),
      headers: { 'Auto-Submitted': 'auto-generated' },
    }, { userId: u, ws });
  }
  return out;
}

function mkNotice(title: string, body: string, severity: ProactiveNotice['severity']): ProactiveNotice {
  return { id: rid('n'), title, body, severity, source: 'scheduler', createdAt: now(), readAt: null };
}

/** Read-only token lookup for the public inbound endpoint (never creates rows for unknown workspaces). */
export async function readInboundToken(u: string, ws: string): Promise<string | null> {
  const stored = await getBorgaState<{ inboundToken?: string }>(settingsKey(u, ws));
  return stored?.inboundToken ?? null;
}

/** Cron enumeration: every workspace that has ticket settings stored. */
export async function listTicketWorkspaces(): Promise<Array<{ userId: string; ws: string }>> {
  const keys = await listBorgaKeys('u::%::ws::%::ticketSettings');
  const out: Array<{ userId: string; ws: string }> = [];
  for (const k of keys) {
    const m = /^u::([^:]+)::ws::([^:]+)::ticketSettings$/.exec(k);
    if (m) out.push({ userId: m[1], ws: m[2] });
  }
  return out;
}
