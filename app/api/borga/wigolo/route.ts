import { NextResponse } from 'next/server';
import { getApiKey } from '@/lib/borga/secrets';
import { sessionUserId } from '@/lib/borga/features-server';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';

/** Server-side health check for a configured wigolo daemon (github.com/KnockOutEZ/wigolo). */
export async function GET(req: NextRequest) {
  // Defense in depth (vibe-check #3): proxy-gated, re-checked here (the base
  // URL + reachability are deployment details, not public info).
  if (!(await sessionUserId(req))) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const base = ((await getApiKey('WIGOLO_BASE_URL')) || 'http://127.0.0.1:3333').replace(/\/$/, '');
  const token = await getApiKey('WIGOLO_API_TOKEN');
  try {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${base}/health`, { headers, signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      return NextResponse.json({ ok: false, base, error: `wigolo responded with ${res.status}` }, { status: 502 });
    }
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json({ ok: true, base, health: data });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      base,
      error: `Could not reach wigolo at ${base}. Run "npx wigolo init" then "npx wigolo serve" and try again. (${(e as Error).message})`,
    }, { status: 502 });
  }
}
