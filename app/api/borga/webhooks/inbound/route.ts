import { NextResponse, type NextRequest } from 'next/server';
import { isValidUserId, isValidWsId } from '@/lib/borga/keys';
import { sessionUserId } from '@/lib/borga/features-server';
import { authorizeInbound, getEventsToken, ingestEvent, listInboundEvents } from '@/lib/borga/events-server';

export const runtime = 'nodejs';

/**
 * External events that trigger agents.
 *
 *   POST /api/borga/webhooks/inbound?u=<userId>&ws=<workspaceId>&source=github&event=push
 *        Authorization: Bearer <events token>        (shown in Orchestration → Webhooks)
 *     or X-Hub-Signature-256 / X-Signature-256 / X-Borga-Signature = HMAC-SHA256 of the raw
 *        body with the secret of one of the workspace's active webhooks (GitHub/Stripe style)
 *   GET  ?ws=   (logged in)  recent events
 *   POST ?ws=&action=token&regenerate=1 (logged in) returns/rotates the events token
 *
 * The POST path is cookie-exempt in proxy.ts; unsigned/untokened requests get 401.
 */

const MAX_BYTES = 1_000_000;
const clean = (v: string | null, max: number) => (v ?? '').slice(0, max).replace(/[^a-z0-9._-]/gi, '');

export async function POST(req: NextRequest) {
  const sp = new URL(req.url).searchParams;

  // Token management for the dashboard (session required).
  if (sp.get('action') === 'token') {
    const userId = await sessionUserId(req);
    const ws = sp.get('ws');
    if (!userId || !isValidWsId(ws)) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    if (req.headers.get('x-borga-client') !== 'borga-dashboard') return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
    return NextResponse.json({ ok: true, token: await getEventsToken(userId, ws, sp.get('regenerate') === '1'), userId });
  }

  const u = sp.get('u');
  const ws = sp.get('ws');
  if (!isValidUserId(u) || !isValidWsId(ws)) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BYTES) return NextResponse.json({ ok: false, error: 'Payload too large' }, { status: 413 });

  const raw = await req.text();
  if (!raw) return NextResponse.json({ ok: false, error: 'Empty body' }, { status: 400 });
  if (raw.length > MAX_BYTES) return NextResponse.json({ ok: false, error: 'Payload too large' }, { status: 413 });
  if (!(await authorizeInbound(u, ws, raw, req.headers))) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = { raw: raw.slice(0, 2000) }; // form-encoded / plain text senders
  }
  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const source = clean(sp.get('source'), 50) || 'unknown';
  const event = clean(sp.get('event') || String(p.type ?? p.event ?? p.action ?? 'unknown'), 100) || 'unknown';

  const r = await ingestEvent(u, ws, source, event, payload);
  return NextResponse.json({ ok: true, event, source, ...r }, { status: 202 });
}

export async function GET(req: NextRequest) {
  const userId = await sessionUserId(req);
  const ws = new URL(req.url).searchParams.get('ws');
  if (!userId || !isValidWsId(ws)) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const events = await listInboundEvents(userId, ws);
  return NextResponse.json({ ok: true, events: events.slice(0, 50), total: events.length });
}
