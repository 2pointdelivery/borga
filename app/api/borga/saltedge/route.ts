import { NextResponse, type NextRequest } from 'next/server';
import { verifySessionToken, sessionCookieName } from '@/lib/auth/session';
import { isValidUserId, isValidWsId } from '@/lib/borga/keys';
import { featureGate } from '@/lib/borga/features-server';
import { paymentRequired } from '@/lib/borga/billing-server';
import { completeConnect, disconnectBank, saltEdgeStatus, startConnect, syncConnection, userMessage } from '@/lib/borga/saltedge-server';

export const runtime = 'nodejs';

async function getUserId(req: NextRequest): Promise<string | null> {
  const c = req.cookies.get(sessionCookieName());
  const token = typeof c === 'string' ? c : c?.value;
  return verifySessionToken(token);
}

const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

/** The page Salt Edge sends the user back to. APP_URL when it is set (we may be behind a proxy), otherwise this request's own origin. */
function returnUrl(req: NextRequest): string {
  const base = (process.env.APP_URL ?? '').trim().replace(/\/+$/, '') || req.nextUrl.origin;
  return `${base}/app?saltedge=return`;
}

// GET /api/borga/saltedge?ws=… : is it set up, and which banks are connected.
export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId || !isValidUserId(userId)) return bad('unauthorized', 401);
  const ws = req.nextUrl.searchParams.get('ws');
  if (!isValidWsId(ws)) return bad('Workspace id required.');
  const off = await featureGate('bankFeeds', userId, ws);
  if (off) return off;
  return NextResponse.json({ ok: true, ...(await saltEdgeStatus(userId, ws)) });
}

// POST /api/borga/saltedge { ws, action: 'connect' | 'complete' | 'sync' | 'disconnect', ... }
export async function POST(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId || !isValidUserId(userId)) return bad('unauthorized', 401);
  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; } catch { return bad('Invalid JSON.'); }
  const ws = body.ws;
  if (!isValidWsId(ws)) return bad('Workspace id required.');
  const off = await featureGate('bankFeeds', userId, ws);
  if (off) return off;
  const unpaid = await paymentRequired(userId, ws);
  if (unpaid) return NextResponse.json({ ok: false, error: unpaid.error, billing: unpaid.billing }, { status: 402 });
  const currency = typeof body.currency === 'string' && /^[A-Za-z]{3}$/.test(body.currency) ? body.currency.toUpperCase() : 'USD';
  const str = (v: unknown, max = 80) => (typeof v === 'string' ? v.slice(0, max) : undefined);

  try {
    switch (body.action) {
      case 'connect': {
        const r = await startConnect(userId, ws, {
          returnTo: returnUrl(req), daysBack: typeof body.daysBack === 'number' ? body.daysBack : undefined,
          countryCode: str(body.country, 2), providerCode: str(body.providerCode), locale: str(body.locale, 5),
        });
        return NextResponse.json({ ok: true, connectUrl: r.connectUrl, expiresAt: r.expiresAt });
      }
      case 'complete': {
        const r = await completeConnect(userId, ws, { connectionId: str(body.connectionId, 64), currency });
        return NextResponse.json({ ok: true, feed: r.feed, connection: r.connection });
      }
      case 'sync': {
        const id = str(body.connectionId, 64);
        if (!id) return bad('connectionId required.');
        const r = await syncConnection(userId, ws, { connectionId: id, currency });
        return NextResponse.json({ ok: true, feed: r.feed, connection: r.connection, refresh: r.refresh });
      }
      case 'disconnect': {
        const id = str(body.connectionId, 64);
        if (!id) return bad('connectionId required.');
        await disconnectBank(userId, ws, id);
        return NextResponse.json({ ok: true });
      }
      default:
        return bad('Unknown action.');
    }
  } catch (e) {
    const m = userMessage(e);
    return bad(m.message, m.status);
  }
}
