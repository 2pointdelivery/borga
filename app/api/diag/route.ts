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
  try {
    const text = await req.text();
    console.error('[client-error-boundary]', text.slice(0, 4000));
  } catch {
    // ignore malformed bodies — this endpoint must never itself throw
  }
  return NextResponse.json({ ok: true });
}
