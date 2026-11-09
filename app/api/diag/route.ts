import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * Client-side error boundaries (app/app/error.tsx, app/global-error.tsx,
 * PageErrorBoundary) report uncaught render errors here so they land in
 * server logs instead of only the user's own browser console. Intentionally
 * unauthenticated (a crashed client may not have a valid session) and
 * fire-and-forget — callers use keepalive + swallow failures.
 */
export async function POST(req: Request) {
  // The body is only ever a few KB of error text: refuse anything bigger
  // before reading it so the sink itself cannot be used for memory exhaustion.
  if (Number(req.headers.get('content-length') ?? 0) > 32_768) {
    return NextResponse.json({ ok: true });
  }
  try {
    const text = await req.text();
    console.error('[client-error-boundary]', text.slice(0, 4000));
  } catch {
    // ignore malformed bodies — this endpoint must never itself throw
  }
  return NextResponse.json({ ok: true });
}
