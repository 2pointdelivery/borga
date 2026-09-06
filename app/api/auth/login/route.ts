import { NextResponse } from 'next/server';
import { createSessionToken, sessionCookieName, sessionMaxAge, isSecureContext } from '@/lib/auth/session';
import { verifyPassword } from '@/lib/auth/password';
import { getUserByEmail } from '@/lib/auth/queries';
import { getBorgaState } from '@/lib/borga/persistence';
import { userWorkspacesKey } from '@/lib/borga/keys';
import { type Workspace } from '@/lib/borga/data';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const email = String(body?.email ?? '').toLowerCase().trim();
    const password = String(body?.password ?? '');

    if (!email || !password) {
      return NextResponse.json({ ok: false, error: 'Email and password are required.' }, { status: 400 });
    }

    const user = await getUserByEmail(email);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return NextResponse.json({ ok: false, error: 'Invalid email or password.' }, { status: 401 });
    }

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
