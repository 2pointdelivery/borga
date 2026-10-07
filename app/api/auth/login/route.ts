import { NextResponse } from 'next/server';
import { createSessionToken, sessionCookieName, sessionMaxAge, isSecureContext } from '@/lib/auth/session';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { LoginThrottle } from '@/lib/auth/login-throttle';
import { getUserByEmail } from '@/lib/auth/queries';
import { getBorgaState } from '@/lib/borga/persistence';
import { userWorkspacesKey } from '@/lib/borga/keys';
import { type Workspace } from '@/lib/borga/data';

export const runtime = 'nodejs';

// One throttle per server process (kept on globalThis so a dev reload does not reset it).
const g = globalThis as typeof globalThis & { __borgaLoginThrottle?: LoginThrottle; __borgaDummyHash?: string };
const throttle = (g.__borgaLoginThrottle ??= new LoginThrottle());

/**
 * A password hash to check against when the email has no account, so a missing account takes as long to answer as a wrong
 * password. Without this, the slow hash only ran for real accounts and response time revealed which emails are registered.
 */
const dummyHash = () => (g.__borgaDummyHash ??= hashPassword('borga-timing-equaliser'));

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const email = String(body?.email ?? '').toLowerCase().trim();
    const password = String(body?.password ?? '');

    if (password.length > 200 || email.length > 254) {
      return NextResponse.json({ ok: false, error: 'Invalid email or password.' }, { status: 401 });
    }
    if (!email || !password) {
      return NextResponse.json({ ok: false, error: 'Email and password are required.' }, { status: 400 });
    }

    // Per-account lock (the proxy already limits per IP): stops one account being guessed from many addresses.
    const verdict = throttle.check(email);
    if (verdict.locked) {
      return NextResponse.json(
        { ok: false, error: `Too many failed sign-in attempts. Try again in ${Math.ceil(verdict.retryAfterSec / 60)} minute(s), or reset your password.` },
        { status: 429, headers: { 'Retry-After': String(verdict.retryAfterSec) } },
      );
    }

    const user = await getUserByEmail(email);
    const passwordOk = verifyPassword(password, user ? user.passwordHash : dummyHash());
    if (!user || !passwordOk) {
      throttle.recordFailure(email);
      return NextResponse.json({ ok: false, error: 'Invalid email or password.' }, { status: 401 });
    }
    throttle.recordSuccess(email);

    const workspaces = (await getBorgaState<Workspace[]>(userWorkspacesKey(user.id)).catch(() => [])) ?? [];
    const token = await createSessionToken(user.id);
    const res = NextResponse.json({
      ok: true,
      user: { id: user.id, email: user.email, name: user.name },
      workspaceId: workspaces[0]?.id ?? '',
    });
    res.cookies.set(sessionCookieName(), token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: isSecureContext(req),
      maxAge: Math.floor(sessionMaxAge() / 1000),
    });
    return res;
  } catch {
    return NextResponse.json({ ok: false, error: 'Could not sign in. Try again.' }, { status: 500 });
  }
}
