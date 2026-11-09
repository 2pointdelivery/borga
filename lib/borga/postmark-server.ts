import 'server-only';
import { getBorgaState, setBorgaState } from './persistence';
import { getApiKey } from './secrets';
import {
  buildPostmarkMessage,
  classifyPostmarkEvent,
  isSuppressionRefusal,
  nextMailStatus,
  normalizeAddress,
  parseOwnerMetadata,
  parsePostmarkSendResponse,
  suppress,
  unsuppress,
  verifyWebhookAuth,
  type MailStatus,
  type PostmarkMessage,
  type SuppressionMap,
  type SuppressionReason,
} from './postmark-core';
import type { MailLogEntry } from './email-notify';

/**
 * Postmark deliverability over the HTTP API (no SDK): sending with open/click
 * tracking, a deployment-wide suppression list fed by bounce/complaint
 * webhooks, and per-message status updates on the workspace mail log.
 *
 * Selection order in the mailer stays: workspace SMTP -> Postmark ->
 * shared SMTP/MailDog, so a company that runs its own server never moves.
 */

const SUPPRESSION_KEY = 't::email::suppression';

export async function postmarkToken(): Promise<string> {
  return (await getApiKey('POSTMARK_API_KEY')).trim();
}

export async function isPostmarkConfigured(): Promise<boolean> {
  return (await postmarkToken()).length > 0;
}

export async function postmarkFrom(): Promise<string> {
  return (await getApiKey('EMAIL_FROM')).trim();
}

// ---------------------------------------------------------------------------
// Suppression list (deployment-wide: a dead address is dead for everyone)

export async function loadSuppressions(): Promise<SuppressionMap> {
  return (await getBorgaState<SuppressionMap>(SUPPRESSION_KEY).catch(() => null)) ?? {};
}

export async function isSuppressed(email: string): Promise<SuppressionReason | null> {
  const at = normalizeAddress(email);
  if (!at) return null;
  return (await loadSuppressions())[at]?.reason ?? null;
}

async function recordSuppression(email: string, reason: SuppressionReason, opts: { messageId?: string; workspace?: string }): Promise<void> {
  const map = await loadSuppressions();
  await setBorgaState(
    SUPPRESSION_KEY,
    suppress(map, email, { reason, at: new Date().toISOString(), ...(opts.messageId ? { messageId: opts.messageId } : {}), ...(opts.workspace ? { workspace: opts.workspace } : {}) }),
  ).catch(() => false);
}

export async function removeSuppression(email: string): Promise<boolean> {
  const at = normalizeAddress(email);
  if (!at) return false;
  const { map, removed } = unsuppress(await loadSuppressions(), at);
  if (removed) await setBorgaState(SUPPRESSION_KEY, map).catch(() => false);
  return removed;
}

// ---------------------------------------------------------------------------
// Sending

export interface PostmarkSendArgs {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  headers?: Record<string, string>;
  tracking: boolean;
  owner: { u: string; ws: string };
}

export async function sendViaPostmark(args: PostmarkSendArgs): Promise<{ ok: boolean; messageId?: string; error?: string; tokenMissing?: boolean }> {
  const token = await postmarkToken();
  if (!token) return { ok: false, error: 'Postmark is not configured.', tokenMissing: true };
  let msg: PostmarkMessage;
  try {
    msg = buildPostmarkMessage(args);
  } catch {
    return { ok: false, error: 'Could not build the message.' };
  }
  let res: Response;
  try {
    res = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: { 'X-Postmark-Server-Token': token, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(msg),
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    return { ok: false, error: `Postmark unreachable: ${(e as Error).message}` };
  }
  const body = await res.json().catch(() => null);
  const parsed = parsePostmarkSendResponse(res.status, body);
  if (!parsed.ok && parsed.error && isSuppressionRefusal(parsed.error) && normalizeAddress(args.to)) {
    // Postmark's own suppression agrees the address is dead: mirror it so we stop asking.
    await recordSuppression(normalizeAddress(args.to)!, 'postmark-suppressed', { workspace: args.owner.ws });
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Inbound webhook application (route verified Basic auth already)

export interface WebhookOutcome {
  applied: 'suppressed' | 'tracked' | 'soft' | 'ignored';
  email?: string;
  messageId?: string;
  status?: MailStatus;
}

/** Apply one verified Postmark event. Never throws: the route must answer fast and never 500 a parseable event. */
export async function applyPostmarkEvent(body: unknown): Promise<WebhookOutcome> {
  const outcome = classifyPostmarkEvent(body);
  if (outcome.kind === 'ignore') return { applied: 'ignored' };
  if (outcome.kind === 'soft') return { applied: 'soft', email: outcome.email, messageId: outcome.messageId };
  if (outcome.kind === 'suppress') {
    await recordSuppression(outcome.email, outcome.reason, { messageId: outcome.messageId }).catch(() => undefined);
    if (outcome.messageId) await markMessage(outcome.messageId, body, outcome.reason === 'spam-complaint' ? 'complained' : 'bounced').catch(() => undefined);
    return { applied: 'suppressed', email: outcome.email, messageId: outcome.messageId };
  }
  await markMessage(outcome.messageId, body, outcome.status).catch(() => undefined);
  return { applied: 'tracked', messageId: outcome.messageId, status: outcome.status as MailStatus };
}

/** Route a tracked/suppressed message to its owner's mail log via the echoed Metadata. */
async function markMessage(messageId: string, body: unknown, status: MailStatus): Promise<void> {
  const owner = parseOwnerMetadata(body);
  if (!owner) return;
  const key = `t::${owner.u}::${owner.ws}::maillog`;
  const log = (await getBorgaState<MailLogEntry[]>(key).catch(() => null)) ?? [];
  let changed = false;
  const next = log.map((e) => {
    if (e.messageId !== messageId) return e;
    changed = true;
    return { ...e, status: nextMailStatus(e.status, status), statusAt: new Date().toISOString() };
  });
  if (changed) await setBorgaState(key, next.slice(0, 100)).catch(() => false);
}

/** Webhook credential check against the deployment env (set in Postmark's webhook config). */
export function verifyPostmarkWebhook(header: string | null): boolean {
  return verifyWebhookAuth(header, (process.env.POSTMARK_WEBHOOK_USER ?? '').trim(), (process.env.POSTMARK_WEBHOOK_PASS ?? '').trim());
}

export function postmarkWebhookConfigured(): boolean {
  return !!(process.env.POSTMARK_WEBHOOK_USER ?? '').trim() && !!(process.env.POSTMARK_WEBHOOK_PASS ?? '').trim();
}
