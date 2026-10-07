import { NextResponse, type NextRequest } from 'next/server';
import { verifySessionToken, sessionCookieName } from '@/lib/auth/session';
import { isValidUserId, isValidWsId } from '@/lib/borga/keys';
import { billingInfo, billingUserMessage, refreshBilling, startCheckout, startPortal } from '@/lib/borga/billing-server';

export const runtime = 'nodejs';

async function getUserId(req: NextRequest): Promise<string | null> {
  const c = req.cookies.get(sessionCookieName());
  const token = typeof c === 'string' ? c : c?.value;
  return verifySessionToken(token);
}

const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

/** Where Stripe sends the user back to. APP_URL when it is set (we may be behind a proxy), otherwise this request's own origin. */
const base = (req: NextRequest) => (process.env.APP_URL ?? '').trim().replace(/\/+$/, '') || req.nextUrl.origin;

// GET /api/borga/billing?ws=… : what this workspace is charged, and whether it may be used.
export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId || !isValidUserId(userId)) return bad('unauthorized', 401);
  const ws = req.nextUrl.searchParams.get('ws');
  if (!isValidWsId(ws)) return bad('Workspace id required.');
  return NextResponse.json({ ok: true, billing: await billingInfo(userId, ws) });
}

// POST /api/borga/billing { ws, action: 'checkout' | 'portal' | 'refresh' }
export async function POST(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId || !isValidUserId(userId)) return bad('unauthorized', 401);
  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; } catch { return bad('Invalid JSON.'); }
  const ws = body.ws;
  if (!isValidWsId(ws)) return bad('Workspace id required.');
  try {
    switch (body.action) {
      case 'checkout': {
        const r = await startCheckout(userId, ws, { successUrl: `${base(req)}/app?billing=success`, cancelUrl: `${base(req)}/app?billing=cancel` });
        return NextResponse.json({ ok: true, url: r.url });
      }
      case 'portal': {
        const r = await startPortal(userId, ws, `${base(req)}/app`);
        return NextResponse.json({ ok: true, url: r.url });
      }
      case 'refresh':
        return NextResponse.json({ ok: true, billing: await refreshBilling(userId, ws) });
      default:
        return bad('Unknown action.');
    }
  } catch (e) {
    const m = billingUserMessage(e);
    return bad(m.message, m.status);
  }
}
