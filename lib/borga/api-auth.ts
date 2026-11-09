import 'server-only';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { featureGate, sessionUserId } from './features-server';
import { parseBearerSecret, touchApiKey, verifyApiKey, type ApiKeyRecord } from './api-keys-server';
import { wsAllowed } from './api-keys';
import { KeyThrottle } from './api-throttle';

// Per-credential throttle (vibe-check #10): 120 calls/min per API key or per
// session user, on top of the proxy's per-IP bucket. Kept on globalThis so a
// dev reload does not reset it.
const g = globalThis as typeof globalThis & { __borgaV1Throttle?: KeyThrottle };
const v1Throttle = (g.__borgaV1Throttle ??= new KeyThrottle(120));

export interface V1Auth {
  userId: string;
  /** Present when the caller used an API key instead of a session. */
  key?: ApiKeyRecord;
}

/**
 * Public API authentication: a session cookie (dashboard callers) or
 * `Authorization: Bearer borga_...`. Returns the user plus, for keys, the
 * record (for workspace scoping). Touches lastUsedAt fire-and-forget.
 */
export async function authenticateV1(req: NextRequest): Promise<V1Auth | null> {
  const session = await sessionUserId(req);
  if (session) return { userId: session };
  const secret = parseBearerSecret(req.headers.get('authorization'));
  if (!secret) return null;
  const hit = await verifyApiKey(secret);
  if (!hit) return null;
  void touchApiKey(hit.userId, hit.key.id);
  return { userId: hit.userId, key: hit.key };
}

/** Shared guard for public v1 routes: auth (?ws= + session or key) or an error response. */
export async function guardV1(req: NextRequest): Promise<{ auth: V1Auth; ws: string } | { res: NextResponse }> {
  const auth = await authenticateV1(req);
  if (!auth) return { res: NextResponse.json({ ok: false, error: 'unauthorized: sign in or pass Authorization: Bearer borga_...' }, { status: 401 }) };
  // Session-cookie writes need the dashboard header, like every other state-changing
  // route (proxy.ts). Bearer-key callers are exempt: the secret itself is the CSRF defence.
  if (!auth.key && req.method !== 'GET' && req.headers.get('x-borga-client') !== 'borga-dashboard') {
    return { res: NextResponse.json({ ok: false, error: 'session writes must carry the X-Borga-Client header — or use an API key' }, { status: 403 }) };
  }
  const ws = wsAllowed(new URL(req.url).searchParams.get('ws'), auth.key?.wsIds);
  if (!ws) return { res: NextResponse.json({ ok: false, error: "a valid ?ws= workspace id is required (and must be inside this key's scope)" }, { status: 400 }) };
  // Per-credential throttle: a leaked key (or one session across many IPs)
  // cannot burn the shared IP bucket alone.
  const verdict = v1Throttle.take(`v1:${auth.userId}:${auth.key?.id ?? 'session'}`);
  if (verdict.limited) {
    return { res: NextResponse.json({ ok: false, error: 'Too many requests. Slow down and try again.' }, { status: 429, headers: { 'Retry-After': String(verdict.retryAfterSec) } }) };
  }
  // The public API is part of Developer tools: a company that switched them off (Settings → Features) is not reachable through it.
  const off = await featureGate('developers', auth.userId, ws);
  if (off) return { res: off };
  return { auth, ws };
}
