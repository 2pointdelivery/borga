import { NextResponse, type NextRequest } from 'next/server';
import { operatorFromRequest } from '@/lib/auth/operator';
import { getBorgaState, setBorgaState, insertBorgaStateIfAbsent, listBorgaKeys } from '@/lib/borga/persistence';
import { INVITE_TTL_MS, hashInviteCode, inviteKey, inviteUsedKey, newInviteCode, type InviteRecord } from '@/lib/auth/signup-policy';

export const runtime = 'nodejs';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const forbidden = () => NextResponse.json({ ok: false, error: 'Only the deployment administrator can manage invites.' }, { status: 403 });

function origin(req: NextRequest): string {
  const app = (process.env.APP_URL ?? '').trim().replace(/\/$/, '');
  return app || req.nextUrl.origin;
}

/** Recent invites: who they are for and whether they were used. Codes are never stored, so they cannot be listed. */
export async function GET(req: NextRequest) {
  if (!(await operatorFromRequest(req))) return forbidden();
  const keys = (await listBorgaKeys('invite::%')).slice(-100);
  const items = await Promise.all(
    keys.map(async (k) => {
      const hash = k.slice('invite::'.length);
      const [rec, used] = await Promise.all([getBorgaState<InviteRecord>(k), getBorgaState<unknown>(inviteUsedKey(hash))]);
      return rec ? { id: hash.slice(0, 12), email: rec.email, createdAt: rec.createdAt, expiresAt: rec.expiresAt, used: used !== null } : null;
    }),
  );
  const invites = items.filter((i): i is NonNullable<typeof i> => i !== null).sort((a, b) => b.createdAt - a.createdAt);
  return NextResponse.json({ ok: true, invites });
}

export async function POST(req: NextRequest) {
  const op = await operatorFromRequest(req);
  if (!op) return forbidden();
  const body = (await req.json().catch(() => null)) as { action?: string; email?: string; id?: string } | null;

  if (body?.action === 'revoke') {
    const id = String(body.id ?? '');
    if (!/^[0-9a-f]{12}$/.test(id)) return NextResponse.json({ ok: false, error: 'Invalid invite id.' }, { status: 400 });
    const key = (await listBorgaKeys(`invite::${id}%`))[0];
    if (!key) return NextResponse.json({ ok: false, error: 'Invite not found.' }, { status: 404 });
    await setBorgaState(inviteUsedKey(key.slice('invite::'.length)), { revokedBy: op.userId, at: Date.now() });
    return NextResponse.json({ ok: true });
  }

  const email = String(body?.email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return NextResponse.json({ ok: false, error: 'A valid email address is required.' }, { status: 400 });

  const code = newInviteCode();
  const now = Date.now();
  const rec: InviteRecord = { email, createdBy: op.userId, createdAt: now, expiresAt: now + INVITE_TTL_MS };
  const stored = await insertBorgaStateIfAbsent(inviteKey(hashInviteCode(code)), rec);
  if (!stored) return NextResponse.json({ ok: false, error: 'Could not create the invite. Try again.' }, { status: 503 });

  const link = `${origin(req)}/signup?invite=${encodeURIComponent(code)}&email=${encodeURIComponent(email)}`;
  return NextResponse.json({ ok: true, code, link, email, expiresAt: rec.expiresAt });
}
