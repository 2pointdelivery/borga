import { NextResponse, type NextRequest } from 'next/server';
import { verifySessionToken, sessionCookieName } from '@/lib/auth/session';
import { signPayloadId } from '@/lib/borga/secrets';
import { defaultChoices, normalizeChoice, CONSENT_VERSION, type ConsentRegion } from '@/lib/borga/consent';
import { CONSENT_COOKIE, effectiveConsent } from '@/lib/borga/consent-server';
import { getBorgaState, setBorgaState } from '@/lib/borga/persistence';
import { userKey } from '@/lib/borga/keys';

export const runtime = 'nodejs';

async function getUserId(req: NextRequest): Promise<string | null> {
  const c = req.cookies.get(sessionCookieName());
  const token = typeof c === 'string' ? c : c?.value;
  return verifySessionToken(token);
}

const toBase64Url = (s: string) =>
  Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function cookieValue(choice: object): string {
  const payload = toBase64Url(JSON.stringify(choice));
  return `${payload}.${signPayloadId(payload)}`;
}

/** Current choice (and whether policy moved on). Reports when the server-side record was last written. */
export async function GET(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const { choice, gpc, needsRefresh } = await effectiveConsent();
  const record = await getBorgaState<{ at: string; version: number }>(userKey(userId, 'consent'));
  return NextResponse.json({ ok: true, choice, gpc, needsRefresh, recordedAt: record?.at ?? null });
}

/** Save the visitor's choice. GPC always wins over analytics/advertising. The choice is also
 *  written to a per-user server record so the audit trail survives cookie clearing. */
export async function POST(req: NextRequest) {
  const userId = await getUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  let body: { region?: unknown; choices?: Record<string, unknown> } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body.' }, { status: 400 });
  }
  const region: ConsentRegion = body.region === 'africa' || body.region === 'north-america' ? body.region : 'europe';
  const base = normalizeChoice({ region, choices: body.choices ?? defaultChoices(region), source: 'banner' });
  if (!base) return NextResponse.json({ ok: false, error: 'Invalid choice.' }, { status: 400 });
  const gpc = req.headers.get('sec-gpc') === '1';
  const choice = gpc
    ? { ...base, choices: { ...base.choices, analytics: false, advertising: false }, at: new Date().toISOString() }
    : { ...base, at: new Date().toISOString() };
  // Server-side record: consent evidence must not live in a cookie alone
  // (GDPR Art. 7(1) proof-of-consent survives cookie clearing).
  try {
    await setBorgaState(userKey(userId, 'consent'), { choice, version: CONSENT_VERSION, at: choice.at });
  } catch {
    // The signed cookie is still set; the record is best-effort evidence.
  }
  const res = NextResponse.json({ ok: true, choice, gpc });
  res.cookies.set(CONSENT_COOKIE, cookieValue(choice), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 365 * 86400,
  });
  return res;
}
