import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createSessionToken, sessionCookieName, sessionMaxAge, isSecureContext } from '@/lib/auth/session';
import { hashPassword } from '@/lib/auth/password';
import { createUser, getUserByEmail } from '@/lib/auth/queries';
import { setBorgaState } from '@/lib/borga/persistence';
import { userWorkspacesKey } from '@/lib/borga/keys';
import { makeOnboarding, type Workspace } from '@/lib/borga/data';

export const runtime = 'nodejs';

const COLORS = ['#6366f1', '#0ea5e9', '#059669', '#f59e0b', '#ec4899', '#8b5cf6'];

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const email = String(body?.email ?? '').toLowerCase().trim();
    const password = String(body?.password ?? '');
    const name = String(body?.name ?? '').trim();

    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return NextResponse.json({ ok: false, error: 'A valid email is required.' }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ ok: false, error: 'Password must be at least 8 characters.' }, { status: 400 });
    }
    if (!name) {
      return NextResponse.json({ ok: false, error: 'Your name is required.' }, { status: 400 });
    }

    const existing = await getUserByEmail(email);
    if (existing) {
      return NextResponse.json({ ok: false, error: 'An account with this email already exists.' }, { status: 409 });
    }

    const user = await createUser({
      id: randomUUID(),
      email,
      name,
      passwordHash: hashPassword(password),
    });

    // Seed a starter company workspace and kick off onboarding immediately.
    const ws: Workspace = {
      id: `ws-${randomUUID().slice(0, 8)}`,
      name: `${name.split(' ')[0]}'s Company`,
      industry: '',
      plan: 'trial',
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      currency: 'USD',
      createdAt: new Date().toLocaleDateString([], { month: 'short', year: 'numeric' }),
      onboarding: makeOnboarding(),
    };
    await setBorgaState(userWorkspacesKey(user.id), [ws]);

    const token = await createSessionToken(user.id);
    const res = NextResponse.json({
      ok: true,
      user: { id: user.id, email: user.email, name: user.name },
      workspaceId: ws.id,
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
    return NextResponse.json({ ok: false, error: 'Could not create account. Try again.' }, { status: 500 });
  }
}
