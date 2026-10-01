import { NextResponse, type NextRequest } from 'next/server';
import { isValidUserId, isValidWsId } from '@/lib/borga/keys';
import { getConnection, getVerifyToken } from '@/lib/borga/connections-server';
import { claimEvent, dispatchHook, hashBody, releaseEvent } from '@/lib/borga/hooks-server';
import { verifyMetaSignature, verifyTwilioSignature } from '@/lib/borga/webhook-signatures';

export const runtime = 'nodejs';

/**
 * Public provider webhooks (cookie-exempt in proxy.ts). Tenant comes from ?u=&ws=;
 * authenticity from the provider's own signature using the tenant's stored
 * credentials. Unknown tenant, missing credentials and bad signatures all answer 401
 * so nothing about which workspaces exist is revealed.
 *
 *   /api/borga/hooks/meta?u=&ws=     GET = Meta verification challenge, POST = events
 *   /api/borga/hooks/twilio?u=&ws=   POST = call/voicemail status callbacks
 */

const MAX_BYTES = 1_000_000;
const deny = () => NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

function tenant(req: NextRequest): { u: string; ws: string } | null {
  const url = new URL(req.url);
  const u = url.searchParams.get('u');
  const ws = url.searchParams.get('ws');
  return isValidUserId(u) && isValidWsId(ws) ? { u, ws } : null;
}

/** The public URL Twilio signed, rebuilt from proxy headers. */
function publicUrl(req: NextRequest): string {
  const u = new URL(req.url);
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? u.host;
  const proto = req.headers.get('x-forwarded-proto') ?? u.protocol.replace(':', '');
  return `${proto}://${host}${u.pathname}${u.search}`;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const t = tenant(req);
  if (provider !== 'meta' || !t) return deny();
  const sp = new URL(req.url).searchParams;
  const expected = await getVerifyToken(t.u, t.ws, 'meta');
  if (sp.get('hub.mode') === 'subscribe' && expected && sp.get('hub.verify_token') === expected) {
    return new NextResponse(sp.get('hub.challenge') ?? '', { status: 200 });
  }
  return deny();
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const t = tenant(req);
  if (!t || (provider !== 'meta' && provider !== 'twilio')) return deny();
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BYTES) return NextResponse.json({ ok: false, error: 'Payload too large' }, { status: 413 });

  const raw = await req.text();
  if (raw.length > MAX_BYTES) return NextResponse.json({ ok: false, error: 'Payload too large' }, { status: 413 });

  let payload: Record<string, unknown>;
  let eventId: string;

  if (provider === 'meta') {
    const creds = await getConnection(t.u, t.ws, 'meta');
    if (!creds?.appSecret || !verifyMetaSignature(raw, req.headers.get('x-hub-signature-256'), creds.appSecret)) return deny();
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
    }
    eventId = hashBody(raw);
  } else {
    const creds = await getConnection(t.u, t.ws, 'twilio');
    const form = Object.fromEntries(new URLSearchParams(raw)) as Record<string, string>;
    if (!creds?.authToken || !verifyTwilioSignature(publicUrl(req), form, req.headers.get('x-twilio-signature'), creds.authToken)) return deny();
    payload = form;
    // A status callback repeats per state change, so key on the SID + state.
    eventId = `${form.CallSid ?? form.MessageSid ?? hashBody(raw)}:${form.CallStatus ?? form.MessageStatus ?? form.RecordingStatus ?? ''}`;
  }

  if (!(await claimEvent(t.u, t.ws, provider, eventId))) return NextResponse.json({ ok: true, duplicate: true });

  try {
    const handled = await dispatchHook({ userId: t.u, ws: t.ws, provider, payload, eventId });
    return NextResponse.json({ ok: true, handlers: handled });
  } catch (e) {
    console.error(`[hooks/${provider}] handler failed`, e);
    // Release the claim and answer 5xx so the provider's retry is processed.
    await releaseEvent(t.u, t.ws, provider, eventId);
    return NextResponse.json({ ok: false, error: 'handler failed' }, { status: 500 });
  }
}
