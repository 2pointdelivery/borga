import 'server-only';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { getBorgaState, setBorgaState } from './persistence';
import { userWsKey } from './keys';
import { encryptSecret, decryptSecret } from './secrets';
import { WEBHOOK_AGENT_ROUTING, type ActivityEvent, type Webhook } from './data';
import { buildAgentContext } from './agent-context';
import { executeAgentRun, persistRun, auditRun } from './agent-runner';
import { loadFeatures } from './features-server';

/**
 * Inbound business events (GitHub, Stripe, bookings, ...) that trigger agent runs.
 * Authenticated per workspace by a bearer token OR the HMAC secret of one of the
 * workspace's registered webhooks; all state lives under the same user-scoped keys
 * the dashboard reads. (The old route used un-prefixed keys and required a login
 * cookie, so no external sender could ever reach it.)
 */

interface StoredToken {
  enc: string;
}
const tokenKey = (u: string, ws: string) => `c::${u}::${ws}::events`;

export async function getEventsToken(u: string, ws: string, regenerate = false): Promise<string> {
  if (!regenerate) {
    const stored = await getBorgaState<StoredToken>(tokenKey(u, ws));
    const t = stored ? decryptSecret(stored.enc) : '';
    if (t) return t;
  }
  const token = randomBytes(24).toString('hex');
  await setBorgaState(tokenKey(u, ws), { enc: encryptSecret(token) });
  return token;
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/** Bearer token, or an HMAC-SHA256 signature matching any active registered webhook secret. */
export async function authorizeInbound(u: string, ws: string, raw: string, headers: Headers): Promise<boolean> {
  const bearer = headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  const stored = await getBorgaState<StoredToken>(tokenKey(u, ws));
  const token = stored ? decryptSecret(stored.enc) : '';
  if (bearer && token && safeEqual(bearer, token)) return true;

  const sig = (headers.get('x-hub-signature-256') ?? headers.get('x-signature-256') ?? headers.get('x-borga-signature') ?? '').trim().replace(/^sha256=/, '');
  if (!sig) return false;
  const hooks = (await getBorgaState<Webhook[]>(userWsKey(u, ws, 'webhooks'))) ?? [];
  return hooks.some((w) => {
    if (!w.secret || w.secret.startsWith('—') || w.active === false) return false;
    return safeEqual(sig, createHmac('sha256', w.secret).update(raw, 'utf8').digest('hex'));
  });
}

export interface InboundEvent {
  id: string;
  source: string;
  event: string;
  payload: unknown;
  receivedAt: string;
  agentId: string;
  processed: boolean;
  taskCreated?: boolean;
}

const queueKey = (u: string, ws: string) => userWsKey(u, ws, 'webhook_queue');

export async function listInboundEvents(u: string, ws: string): Promise<InboundEvent[]> {
  return ((await getBorgaState<{ deliveries: InboundEvent[] }>(queueKey(u, ws))) ?? { deliveries: [] }).deliveries;
}

export function eventToGoal(source: string, event: string, payload: unknown): string {
  const p = (payload ?? {}) as Record<string, unknown>;
  const s = (v: unknown, d: string) => String(v ?? d);

  if (event === 'booking.created') return `A new booking was received from ${s(p.client, 'a client')} (ref: ${s(p.ref, 'TBD')}). Review the booking, assign a driver if available, update the booking status, and log the activity.`;
  if (event === 'booking.delivered') return `Booking ${s(p.ref ?? p.id, '')} has been delivered. Update the booking status to delivered, check the SLA was met, and log the delivery confirmation.`;
  if (event === 'sla.breached') return `SLA breach detected for ${s(p.ref ?? p.id, '')}. Create a P0 task to investigate the breach, notify the relevant team, store the incident as an observation, and update the SLA metrics.`;
  if (event === 'client.created' || event === 'hubspot.contact.created') return `A new ${source} contact was created: ${s(p.name ?? p.email, 'Unknown')}. Add them as a lead, create a follow-up task, and send a welcome sequence task to the sales team.`;
  if (event === 'hubspot.deal.stage_changed') return `A HubSpot deal stage changed: contact ${s(p.name ?? p.deal_id, '')} moved to "${s(p.stage ?? p.new_stage, 'unknown')}". Update the corresponding lead in Borga and create any required follow-up tasks.`;
  if (event === 'payment.received' || event === 'stripe.payment_intent.succeeded') return `Payment received: $${s(p.amount ?? p.amount_received, '0')} from ${s(p.customer ?? p.client, 'unknown')}. Update the invoice status, log the payment, and check if any outstanding AR is now resolved.`;
  if (event === 'stripe.invoice.payment_failed') return `Payment failed for invoice ${s(p.invoice_id ?? p.id, '')} from ${s(p.customer, 'unknown')}. Create a P0 task to follow up, draft a payment reminder, and log the incident.`;
  if (event === 'github.push') return `A GitHub push was received on branch "${s(p.branch ?? p.ref, 'main')}" by ${s(p.pusher ?? p.author, 'a contributor')}. Review the changes, create any required testing tasks, and log the deployment activity.`;
  if (event === 'github.issue') return `A GitHub issue was ${s(p.action, 'opened')}: "${s(p.issue_title ?? p.title, 'Issue')}". Create a task to address it, assign to the engineering team, and set appropriate priority.`;
  if (event === 'support.ticket') return `A new support ticket was received from ${s(p.customer ?? p.email, 'a customer')}: "${s(p.subject ?? p.title, 'Support request')}". Create a ticket with create_ticket, triage its priority, and draft (do not send) a first reply.`;
  return `Received a "${event}" event from ${source} with payload: ${JSON.stringify(payload).slice(0, 300)}. Process this event appropriately: create any needed tasks, update relevant records, and log the activity.`;
}

export async function ingestEvent(u: string, ws: string, source: string, event: string, payload: unknown): Promise<{ eventId: string; routedTo: string; status: 'processing' | 'held-heartbeat-paused' | 'feature-off' }> {
  const routingKey = `${source}.${event}`.toLowerCase();
  const agentId = WEBHOOK_AGENT_ROUTING[routingKey] ?? WEBHOOK_AGENT_ROUTING[event] ?? WEBHOOK_AGENT_ROUTING[`${source}.default`] ?? 'a-borga';
  const entry: InboundEvent = { id: `wh-in-${Date.now()}-${randomBytes(2).toString('hex')}`, source, event, payload, receivedAt: new Date().toISOString(), agentId, processed: false };

  const queue = await listInboundEvents(u, ws);
  await setBorgaState(queueKey(u, ws), { deliveries: [entry, ...queue].slice(0, 200) });

  const actKey = userWsKey(u, ws, 'activity');
  const activity = (await getBorgaState<ActivityEvent[]>(actKey)) ?? [];
  const act: ActivityEvent = { id: `e-wh-${Date.now()}`, time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }), agentId, agentName: 'System', actor: 'system', kind: 'sync', message: `Inbound webhook: ${source}.${event} → routed to ${agentId}` };
  await setBorgaState(actKey, [act, ...activity].slice(0, 200));

  // Kill switches: heartbeat pause and the agents feature hold events instead of running them.
  const settings = await getBorgaState<{ heartbeatPaused?: boolean }>(userWsKey(u, ws, 'settings'));
  if (settings?.heartbeatPaused === true) return { eventId: entry.id, routedTo: agentId, status: 'held-heartbeat-paused' };
  if (!(await loadFeatures(u, ws)).flags.agents) return { eventId: entry.id, routedTo: agentId, status: 'feature-off' };

  void (async () => {
    let ok = false;
    try {
      const goal = eventToGoal(source, event, payload);
      const ctx = await buildAgentContext(agentId, ws, u, goal);
      const startedAt = new Date().toISOString();
      const run = await executeAgentRun(`run-${Date.now()}-${randomBytes(2).toString('hex')}`, agentId, ctx?.agent.name ?? agentId, goal, 4, ctx, 'webhook', startedAt, ws, 'the company', u);
      await persistRun(run, ws, u);
      await auditRun(run, ctx?.agent.model || null, null, goal.length, ws, u);
      ok = run.status !== 'error';
    } catch (e) {
      console.error('[inbound-event] agent run failed', e);
    }
    const latest = await listInboundEvents(u, ws);
    await setBorgaState(queueKey(u, ws), { deliveries: latest.map((x) => (x.id === entry.id ? { ...x, processed: true, taskCreated: ok } : x)) });
  })();

  return { eventId: entry.id, routedTo: agentId, status: 'processing' };
}
