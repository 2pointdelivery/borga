import { timingSafeEqual } from 'crypto';

/**
 * Postmark deliverability: pure rules for the HTTP-API sender, the inbound
 * event webhooks (bounce / complaint / delivery / open / click), the shared
 * suppression list, and per-message status transitions. I/O lives in
 * postmark-server.ts; the route is app/api/borga/webhooks/postmark.
 */

export type SuppressionReason = 'hard-bounce' | 'spam-complaint' | 'postmark-suppressed';

export interface SuppressionRecord {
  reason: SuppressionReason;
  /** ISO timestamp of the event that suppressed the address. */
  at: string;
  /** Postmark MessageID that triggered it, when known. */
  messageId?: string;
  /** First workspace that saw the bounce (for the dashboard note). */
  workspace?: string;
}

/** Deployment-wide suppression map: lowercased address -> record. */
export type SuppressionMap = Record<string, SuppressionRecord>;

/** Bounded so one bad import can never grow the row forever. */
export const MAX_SUPPRESSIONS = 2000;

export function normalizeAddress(v: unknown): string | null {
  const e = String(v ?? '').trim().toLowerCase();
  return /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/.test(e) && e.length <= 254 ? e : null;
}

/** Add (or refresh) a suppression. Oldest entries fall off past the cap. */
export function suppress(map: SuppressionMap, email: string, rec: SuppressionRecord): SuppressionMap {
  const next: SuppressionMap = { ...map, [email]: rec };
  const keys = Object.keys(next);
  if (keys.length <= MAX_SUPPRESSIONS) return next;
  for (const k of keys.slice(0, keys.length - MAX_SUPPRESSIONS)) delete next[k];
  return next;
}

export function unsuppress(map: SuppressionMap, email: string): { map: SuppressionMap; removed: boolean } {
  if (!map[email]) return { map, removed: false };
  const next = { ...map };
  delete next[email];
  return { map: next, removed: true };
}

// ---------------------------------------------------------------------------
// Webhook events (Postmark JSON, one object per POST)

export type PostmarkOutcome =
  | { kind: 'suppress'; email: string; reason: SuppressionReason; messageId?: string }
  | { kind: 'track'; messageId: string; status: 'delivered' | 'opened' | 'clicked'; at: string }
  | { kind: 'soft'; email: string; messageId?: string }
  | { kind: 'ignore' };

const HARD_TYPES = new Set(['HardBounce', 'BadDomain', 'SpamNotification', 'VirusNotification', 'Unknown']);

/**
 * Classify one Postmark webhook body. Suppression-worthy: hard bounces and
 * spam complaints. Soft/transient bounces are reported, never suppressed
 * (Postmark retries those itself). Anything unrecognised is ignored so a new
 * Postmark event type cannot 500 the endpoint into a retry storm.
 */
export function classifyPostmarkEvent(body: unknown): PostmarkOutcome {
  if (!body || typeof body !== 'object') return { kind: 'ignore' };
  const b = body as Record<string, unknown>;
  const recordType = b.RecordType;
  const messageId = typeof b.MessageID === 'string' ? b.MessageID : undefined;
  if (recordType === 'Bounce') {
    const email = normalizeAddress(b.Email);
    if (!email) return { kind: 'ignore' };
    if (typeof b.Type === 'string' && HARD_TYPES.has(b.Type)) return { kind: 'suppress', email, reason: 'hard-bounce', messageId };
    return { kind: 'soft', email, messageId };
  }
  if (recordType === 'SpamComplaint') {
    const email = normalizeAddress(b.Email);
    if (!email) return { kind: 'ignore' };
    return { kind: 'suppress', email, reason: 'spam-complaint', messageId };
  }
  if (recordType === 'Delivery' || recordType === 'Open' || recordType === 'Click') {
    if (!messageId) return { kind: 'ignore' };
    const at = [b.DeliveredAt, b.ReceivedAt].find((v) => typeof v === 'string') ?? new Date().toISOString();
    const status = recordType === 'Delivery' ? 'delivered' : recordType === 'Open' ? 'opened' : 'clicked';
    return { kind: 'track', messageId, status, at: at as string };
  }
  return { kind: 'ignore' };
}

// ---------------------------------------------------------------------------
// Per-message delivery status (stored on the workspace mail-log entry)

export type MailStatus = 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'complained';

/** Forward-only transitions: opens/clicks never walk a bounced message back to life. */
export function nextMailStatus(current: MailStatus | undefined, event: MailStatus): MailStatus {
  if (current === 'bounced' || current === 'complained') return current;
  if (event === 'sent') return current ?? 'sent';
  const rank: Record<MailStatus, number> = { sent: 0, delivered: 1, opened: 2, clicked: 3, bounced: 4, complained: 4 };
  const next = event === 'delivered' ? 'delivered' : event === 'opened' ? 'opened' : event === 'clicked' ? 'clicked' : event === 'bounced' ? 'bounced' : 'complained';
  return rank[next] >= rank[current ?? 'sent'] ? next : (current ?? 'sent');
}

// ---------------------------------------------------------------------------
// Sender payload

export interface PostmarkMessage {
  From: string;
  To: string;
  Subject: string;
  TextBody: string;
  HtmlBody?: string;
  ReplyTo?: string;
  Headers?: Array<{ Name: string; Value: string }>;
  TrackOpens: boolean;
  TrackLinks: 'None' | 'HtmlAndText';
  MessageStream: 'outbound';
  Metadata: { u: string; ws: string };
}

/** Build the POST /email body. Metadata round-trips the owner so inbound events route without an index. */
export function buildPostmarkMessage(args: {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  headers?: Record<string, string>;
  tracking: boolean;
  owner: { u: string; ws: string };
}): PostmarkMessage {
  return {
    From: args.from,
    To: args.to,
    Subject: args.subject,
    TextBody: args.text,
    ...(args.html ? { HtmlBody: args.html } : {}),
    ...(args.replyTo ? { ReplyTo: args.replyTo } : {}),
    Headers: Object.entries(args.headers ?? {}).map(([Name, Value]) => ({ Name, Value })),
    TrackOpens: args.tracking,
    TrackLinks: args.tracking ? 'HtmlAndText' : 'None',
    MessageStream: 'outbound',
    Metadata: { u: args.owner.u, ws: args.owner.ws },
  };
}

/** Postmark answers 200 with ErrorCode 0 on acceptance; anything else (or non-JSON) is a refusal. */
export function parsePostmarkSendResponse(status: number, body: unknown): { ok: boolean; messageId?: string; error?: string } {
  if (status !== 200 || !body || typeof body !== 'object') return { ok: false, error: `Postmark refused the message (HTTP ${status}).` };
  const b = body as Record<string, unknown>;
  if (b.ErrorCode === 0 && typeof b.MessageID === 'string') return { ok: true, messageId: b.MessageID };
  const code = typeof b.ErrorCode === 'number' ? b.ErrorCode : '?';
  const msg = typeof b.Message === 'string' ? b.Message : 'unknown error';
  // 300/406: Postmark's own suppression (inactive recipient) — the address belongs on our list too.
  return { ok: false, error: `Postmark ${code}: ${msg}` };
}

/** Which refusal codes mean "never try this address again". */
export function isSuppressionRefusal(error: string): boolean {
  return /Postmark (300|406)\b/.test(error);
}

// ---------------------------------------------------------------------------
// Webhook authentication (HTTP Basic, credentials set in Postmark's webhook config)

export function parseBasicAuth(header: string | null): { user: string; pass: string } | null {
  if (!header || !header.startsWith('Basic ')) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
  } catch {
    return null;
  }
  const i = decoded.indexOf(':');
  if (i < 0) return null;
  return { user: decoded.slice(0, i), pass: decoded.slice(i + 1) };
}

/** Constant-time credential check so a wrong user and a wrong password look identical. */
export function verifyWebhookAuth(header: string | null, expectedUser: string, expectedPass: string): boolean {
  const got = parseBasicAuth(header);
  if (!got || !expectedUser || !expectedPass) return false;
  const a = Buffer.from(`Basic ${Buffer.from(`${got.user}:${got.pass}`).toString('base64')}`);
  const b = Buffer.from(`Basic ${Buffer.from(`${expectedUser}:${expectedPass}`).toString('base64')}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Owner metadata echoed by Postmark webhooks. Validated before it ever touches a key. */
export function parseOwnerMetadata(body: unknown): { u: string; ws: string } | null {
  const m = (body as Record<string, unknown> | null)?.Metadata as Record<string, unknown> | undefined;
  if (!m || typeof m.u !== 'string' || typeof m.ws !== 'string') return null;
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(m.u) || !/^[A-Za-z0-9_-]{1,64}$/.test(m.ws)) return null;
  return { u: m.u, ws: m.ws };
}
