import { NextResponse } from 'next/server';
import { getBorgaState, setBorgaState } from '@/lib/borga/persistence';
import { WEBHOOK_AGENT_ROUTING, type ActivityEvent, type Webhook } from '@/lib/borga/data';

export const runtime = 'nodejs';

const WS_PREFIX = 'ws::';

/** Resolve a workspace-scoped key when a valid `ws` id is supplied. */
function scopedKey(ws: string | null, entity: string): string {
  return ws ? `${WS_PREFIX}${ws}::${entity}` : entity;
}

interface InboundEvent {
  id: string;
  source: string;
  event: string;
  payload: unknown;
  receivedAt: string;
  agentId: string;
  processed: boolean;
  taskCreated?: boolean;
}

// Validate HMAC-SHA256 webhook signature
async function verifySignature(body: string, signature: string, secret: string): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
    );
    // Strip sha256= prefix if present
    const sigHex = signature.replace(/^sha256=/, '');
    const sigBytes = new Uint8Array(sigHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
    return await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(body));
  } catch {
    return false;
  }
}

// Build a goal string for the agent based on the event
function eventToGoal(source: string, event: string, payload: unknown): string {
  const p = payload as Record<string, unknown>;

  if (event === 'booking.created') {
    return `A new booking was received from ${String(p.client ?? 'a client')} (ref: ${String(p.ref ?? 'TBD')}). Review the booking, assign a driver if available, update the booking status, and log the activity.`;
  }
  if (event === 'booking.delivered') {
    return `Booking ${String(p.ref ?? p.id ?? '')} has been delivered. Update the booking status to delivered, check the SLA was met, and log the delivery confirmation.`;
  }
  if (event === 'sla.breached') {
    return `SLA breach detected for ${String(p.ref ?? p.id ?? '')}. Create a P0 task to investigate the breach, notify the relevant team, store the incident as an observation, and update the SLA metrics.`;
  }
  if (event === 'client.created' || event === 'hubspot.contact.created') {
    return `A new ${source} contact was created: ${String(p.name ?? p.email ?? 'Unknown')}. Add them as a lead, create a follow-up task, and send a welcome sequence task to the sales team.`;
  }
  if (event === 'hubspot.deal.stage_changed') {
    return `A HubSpot deal stage changed: contact ${String(p.name ?? p.deal_id ?? '')} moved to "${String(p.stage ?? p.new_stage ?? 'unknown')}". Update the corresponding lead in Borga and create any required follow-up tasks.`;
  }
  if (event === 'payment.received' || event === 'stripe.payment_intent.succeeded') {
    return `Payment received: $${String(p.amount ?? p.amount_received ?? '0')} from ${String(p.customer ?? p.client ?? 'unknown')}. Update the invoice status, log the payment, and check if any outstanding AR is now resolved.`;
  }
  if (event === 'stripe.invoice.payment_failed') {
    return `Payment failed for invoice ${String(p.invoice_id ?? p.id ?? '')} from ${String(p.customer ?? 'unknown')}. Create a P0 task to follow up, draft a payment reminder, and log the incident.`;
  }
  if (event === 'github.push') {
    return `A GitHub push was received on branch "${String(p.branch ?? p.ref ?? 'main')}" by ${String(p.pusher ?? p.author ?? 'a contributor')}. Review the changes, create any required testing tasks, and log the deployment activity.`;
  }
  if (event === 'github.issue') {
    return `A GitHub issue was ${String(p.action ?? 'opened')}: "${String(p.issue_title ?? p.title ?? 'Issue')}". Create a task to address it, assign to the engineering team, and set appropriate priority.`;
  }
  if (event === 'support.ticket') {
    return `A new support ticket was received from ${String(p.customer ?? p.email ?? 'a customer')}: "${String(p.subject ?? p.title ?? 'Support request')}". Create a support task, assign to the right agent, and acknowledge receipt.`;
  }

  // Generic fallback
  return `Received a "${event}" event from ${source} with payload: ${JSON.stringify(payload).slice(0, 300)}. Process this event appropriately: create any needed tasks, update relevant records, and log the activity.`;
}

export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const source = (searchParams.get('source') ?? 'unknown').slice(0, 50).replace(/[^a-z0-9._-]/gi, '');
  const eventType = searchParams.get('event') ?? '';
  // Tenant routing: events posted with ?ws=<id> land in that company's feed.
  const wsParam = searchParams.get('ws');
  const ws = wsParam && /^[a-zA-Z0-9_-]{1,64}$/.test(wsParam) ? wsParam : null;

  // Read raw body for signature verification
  const rawBody = await req.text();
  if (!rawBody) {
    return NextResponse.json({ ok: false, error: 'Empty body' }, { status: 400 });
  }

  let payload: unknown = {};
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // Some webhooks send form-encoded or plain text — store as string
    payload = { raw: rawBody.slice(0, 2000) };
  }

  // Extract event type from header or payload if not in query
  const p = payload as Record<string, unknown>;
  const event = (eventType || String(p.type ?? p.event ?? p.action ?? 'unknown')).slice(0, 100);

  // Check if any registered webhook for this source has a secret to verify
  const webhooks = (await getBorgaState<Webhook[]>(scopedKey(ws, 'webhooks'))) ?? [];
  const matchingHook = webhooks.find((w) => {
    const hookSource = w.url.includes(source) || w.event.includes(source) || w.name.toLowerCase().includes(source.toLowerCase());
    return hookSource && w.secret && !w.secret.startsWith('—…');
  });

  if (matchingHook?.secret) {
    const sig = req.headers.get('X-Hub-Signature-256') ??
                req.headers.get('X-Signature-256') ??
                req.headers.get('X-Borga-Signature') ?? '';
    if (sig) {
      const valid = await verifySignature(rawBody, sig, matchingHook.secret);
      if (!valid) {
        return NextResponse.json({ ok: false, error: 'Invalid webhook signature' }, { status: 401 });
      }
    }
  }

  // Route to the responsible agent
  const routingKey = `${source}.${event}`.toLowerCase();
  const agentId = WEBHOOK_AGENT_ROUTING[routingKey]
    ?? WEBHOOK_AGENT_ROUTING[event]
    ?? WEBHOOK_AGENT_ROUTING[`${source}.default`]
    ?? 'a-borga';

  const receivedAt = new Date().toISOString();
  const inboundEvent: InboundEvent = {
    id: `wh-in-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    source, event, payload, receivedAt, agentId,
    processed: false,
  };

  // Log to activity feed
  const activity = (await getBorgaState<ActivityEvent[]>(scopedKey(ws, 'activity'))) ?? [];
  const actEntry: ActivityEvent = {
    id: `e-wh-${Date.now()}`,
    time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    agentId,
    agentName: 'System',
    actor: 'system',
    kind: 'sync',
    message: `Inbound webhook: ${source}.${event} → routed to ${agentId}`,
  };
  await setBorgaState(scopedKey(ws, 'activity'), [actEntry, ...activity].slice(0, 200));

  // Store the inbound event in the webhook queue
  const queue = (await getBorgaState<{ deliveries: InboundEvent[] }>(scopedKey(ws, 'webhook_queue'))) ?? { deliveries: [] };
  queue.deliveries = [inboundEvent, ...queue.deliveries].slice(0, 200);
  await setBorgaState(scopedKey(ws, 'webhook_queue'), queue);

  // Fire the agent run asynchronously (fire-and-forget) — don't block the webhook response
  const goal = eventToGoal(source, event, payload);
  const origin = new URL(req.url).origin;

  fetch(`${origin}/api/borga/agent/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Borga-Client': 'borga-dashboard' },
    body: JSON.stringify({
      agentId,
      goal,
      maxSteps: 4,
      stream: false,
      triggeredBy: 'webhook',
    }),
    signal: AbortSignal.timeout(60000),
  }).then(async (r) => {
    // Mark event as processed
    const runData = await r.json().catch(() => ({})) as { ok?: boolean; run?: { summary?: string } };
    const q = (await getBorgaState<{ deliveries: InboundEvent[] }>(scopedKey(ws, 'webhook_queue'))) ?? { deliveries: [] };
    q.deliveries = q.deliveries.map((e) =>
      e.id === inboundEvent.id
        ? { ...e, processed: true, taskCreated: runData.ok === true }
        : e,
    );
    await setBorgaState(scopedKey(ws, 'webhook_queue'), q);
  }).catch(() => null);

  return NextResponse.json({
    ok: true,
    eventId: inboundEvent.id,
    event,
    source,
    routedTo: agentId,
    status: 'processing',
  }, { status: 202 });
}

// GET  list recent inbound events (optionally workspace-scoped)
export async function GET(req: Request) {
  const url = new URL(req.url);
  const wsParam = url.searchParams.get('ws');
  const ws = wsParam && /^[a-zA-Z0-9_-]{1,64}$/.test(wsParam) ? wsParam : null;
  const queue = (await getBorgaState<{ deliveries: InboundEvent[] }>(scopedKey(ws, 'webhook_queue'))) ?? { deliveries: [] };
  return NextResponse.json({
    ok: true,
    events: queue.deliveries.slice(0, 50),
    total: queue.deliveries.length,
  });
}
