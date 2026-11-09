import { NextResponse, type NextRequest } from 'next/server';
import { verifySessionToken, sessionCookieName } from '@/lib/auth/session';
import { isValidUserId, isValidWsId } from '@/lib/borga/keys';
import { paymentRequired } from '@/lib/borga/billing-server';
import { WebsiteError, readWebsite } from '@/lib/borga/website-server';

export const runtime = 'nodejs';
export const maxDuration = 60;

async function getUserId(req: NextRequest): Promise<string | null> {
  const c = req.cookies.get(sessionCookieName());
  const token = typeof c === 'string' ? c : c?.value;
  return verifySessionToken(token);
}

const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

// Reading a site makes up to six outbound requests, so it is limited per person: ten reads an hour.
const reads = new Map<string, number[]>();
function throttled(userId: string): boolean {
  const now = Date.now();
  const recent = (reads.get(userId) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= 10) { reads.set(userId, recent); return true; }
  reads.set(userId, [...recent, now]);
  if (reads.size > 5000) for (const [k, v] of reads) if (!v.some((t) => now - t < 3_600_000)) reads.delete(k);
  return false;
}

// POST /api/borga/website { ws, url }: reads the site and returns entries to review. Nothing is saved here.
export async function POST(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId || !isValidUserId(userId)) return bad('unauthorized', 401);
  let body: { ws?: unknown; url?: unknown };
  try { body = (await req.json()) as typeof body; } catch { return bad('Invalid JSON.'); }
  if (!isValidWsId(body.ws)) return bad('Workspace id required.');
  if (typeof body.url !== 'string') return bad('A website address is required.');
  const unpaid = await paymentRequired(userId, body.ws);
  if (unpaid) return NextResponse.json({ ok: false, error: unpaid.error, billing: unpaid.billing }, { status: 402 });
  if (throttled(userId)) return bad('You have read several sites in the last hour. Try again later.', 429);
  try {
    return NextResponse.json({ ok: true, ...(await readWebsite(body.url)) });
  } catch (e) {
    if (e instanceof WebsiteError) return bad(e.message, 422);
    return bad('Could not read that website.', 502);
  }
}
