import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifySessionToken, sessionCookieName } from '@/lib/auth/session';
import { isValidUserId } from '@/lib/borga/keys';
import { clientIp } from '@/lib/auth/client-ip';

function reqToken(req: NextRequest): string | undefined {
  const c = req.cookies.get(sessionCookieName());
  if (!c) return undefined;
  if (typeof c === 'string') return c;
  if (typeof c === 'object' && 'value' in c) return (c as { value: string }).value;
  return undefined;
}

// Simple in-memory fixed-window rate limiter (per Edge isolate).
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 120;
const AUTH_MAX_REQUESTS = 10; // per IP per minute for each /api/auth/* route
const SWEEP_INTERVAL_MS = 5 * 60_000;
const MAX_TRACKED_KEYS = 50_000; // hard cap — a long-lived isolate must never grow this unbounded
const hits = new Map<string, { count: number; reset: number }>();
let lastSweep = 0;

// Expired windows are never otherwise removed, so a long-lived isolate would
// accumulate one entry per (ip, route-bucket) pair forever. Sweep periodically,
// and hard-evict the oldest entries if something still blows past the cap.
function sweepExpired(now: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS && hits.size < MAX_TRACKED_KEYS) return;
  lastSweep = now;
  for (const [k, v] of hits) {
    if (v.reset < now) hits.delete(k);
  }
  if (hits.size > MAX_TRACKED_KEYS) {
    const excess = hits.size - MAX_TRACKED_KEYS;
    let i = 0;
    for (const k of hits.keys()) {
      if (i++ >= excess) break;
      hits.delete(k);
    }
  }
}

function rateLimited(req: NextRequest, max: number = MAX_REQUESTS): boolean {
  // The right-most forwarded value, which the client cannot choose (the left-most was client-controlled: rotating it gave
  // unlimited fresh buckets). See lib/auth/client-ip.ts.
  const ip = clientIp(req.headers);
  const bucket = req.nextUrl.pathname.split('/').slice(0, 4).join('/');
  const key = `${ip}:${bucket}`;
  const now = Date.now();
  sweepExpired(now);
  const rec = hits.get(key);
  if (!rec || rec.reset < now) {
    hits.set(key, { count: 1, reset: now + WINDOW_MS });
    return false;
  }
  rec.count += 1;
  return rec.count > max;
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Sign-in, sign-up, password reset and the client error sink are reachable without a session,
  // so they get a much tighter per-IP limit (brute force, signup/email spam, log flooding).
  if (pathname.startsWith('/api/auth/') || pathname === '/api/diag') {
    if (req.method === 'POST' && rateLimited(req, pathname === '/api/diag' ? 30 : AUTH_MAX_REQUESTS)) {
      return NextResponse.json({ ok: false, error: 'Too many requests. Wait a minute and try again.' }, { status: 429 });
    }
    return NextResponse.next();
  }

  // --- Page-level auth gating ---
  if (!pathname.startsWith('/api/borga')) {
    const uid = await verifySessionToken(reqToken(req));
    const authed = !!uid && isValidUserId(uid);

    if (pathname.startsWith('/app')) {
      if (!authed) {
        const url = new URL('/login', req.url);
        url.searchParams.set('next', pathname + req.nextUrl.search);
        return NextResponse.redirect(url);
      }
      return NextResponse.next();
    }

    if (pathname === '/') {
      if (authed) return NextResponse.redirect(new URL('/app', req.url));
      return NextResponse.next();
    }

    return NextResponse.next();
  }

  // --- API surface (/api/borga) ---
  const res = NextResponse.next();

  // Rate limit all Borga API traffic.
  if (rateLimited(req)) {
    return NextResponse.json({ ok: false, error: 'Too many requests' }, { status: 429 });
  }

  // Twilio's own servers fetch these two endpoints when a real outbound call
  // connects (TwiML, then the ElevenLabs audio to <Play>) — they carry no
  // session cookie of ours. They authenticate themselves via a signed,
  // server-generated id instead (see lib/borga/secrets.ts verifyPayloadSignature),
  // so it's safe to skip the cookie check here specifically for them.
  const isVoiceCallWebhook = pathname === '/api/borga/voice/call/twiml' || pathname === '/api/borga/voice/call/audio';
  if (isVoiceCallWebhook) {
    return res;
  }

  // Inbound mail bridges (Postmark / Mailgun / Cloudflare Email Worker) post here
  // without our session cookie. The route authenticates them with the
  // per-workspace inbound token (constant-time compare) and stays rate limited above.
  if (pathname === '/api/borga/tickets/inbound' && req.method === 'POST') {
    return res;
  }

  // Scheduler (systemd timer, cron-job.org): carries no session cookie, so the route itself checks
  // `Authorization: Bearer $CRON_SECRET` (and answers 401 when CRON_SECRET is unset). Without this
  // exemption the gate below rejected every scheduled run and no background job ever ran.
  if (pathname === '/api/borga/cron' && (req.method === 'POST' || req.method === 'GET')) {
    return res;
  }

  // Stripe's subscription webhook: authenticated inside the route by the signature over the raw body.
  if (pathname === '/api/borga/billing/webhook' && req.method === 'POST') {
    return res;
  }

  // Provider webhooks (Meta, Twilio): authenticated inside the route by the provider's
  // HMAC signature against the tenant's stored credentials; rate limited above.
  if (pathname.startsWith('/api/borga/hooks/') && (req.method === 'POST' || req.method === 'GET')) {
    return res;
  }

  // External business events (GitHub, Stripe, bookings): bearer token or webhook HMAC,
  // checked inside the route. The same path's token-management action checks the session itself.
  if (pathname === '/api/borga/webhooks/inbound' && req.method === 'POST') {
    return res;
  }

  // Email unsubscribe links (footer + RFC 8058 one-click): authenticated by the signed token in the URL.
  if (pathname === '/api/borga/email/unsubscribe' && (req.method === 'GET' || req.method === 'POST')) {
    return res;
  }

  // Authentication gate — full HMAC signature verification (Edge runtime).
  const uid = await verifySessionToken(reqToken(req));
  if (!uid || !isValidUserId(uid)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  res.headers.set('x-user-id', uid);

  // Restrict methods to those the routes actually expose.
  if (!['GET', 'POST', 'OPTIONS'].includes(req.method)) {
    return NextResponse.json({ ok: false, error: 'Method not allowed' }, { status: 405 });
  }

  // Optional shared-secret gate for mutations. Enabled only when
  // BORGA_ADMIN_TOKEN is set; external automations send it as a Bearer token.
  const authToken = process.env.BORGA_ADMIN_TOKEN;
  const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  if (isWrite) {
    if (authToken) {
      const auth = req.headers.get('authorization') ?? '';
      if (auth !== `Bearer ${authToken}`) {
        return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
      }
    } else {
      // CSRF guard: the dashboard must attach this custom header to every write.
      // Browsers won't send a custom header cross-site without CORS preflight
      // (which we don't allow), so a malicious page can't mutate app state.
      if (req.headers.get('x-borga-client') !== 'borga-dashboard') {
        return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
      }
    }
  }

  return res;
}

export const config = {
  matcher: ['/', '/app/:path*', '/api/borga/:path*', '/api/auth/:path*', '/api/diag'],
};
