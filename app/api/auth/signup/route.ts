import { isEmailConfigured, sendEmail } from '@/lib/auth/mailer';
import { renderWelcome } from '@/lib/auth/email-templates';
import { appOrigin } from '@/lib/auth/app-url';
import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createSessionToken, sessionCookieName, sessionMaxAge, isSecureContext } from '@/lib/auth/session';
import { hashPassword } from '@/lib/auth/password';
import { createUser, getUserByEmail } from '@/lib/auth/queries';
import { setBorgaState, getBorgaState, insertBorgaStateIfAbsent, deleteBorgaState } from '@/lib/borga/persistence';
import { checkInvite, decideSignup, hashInviteCode, inviteKey, inviteUsedKey, signupMode, type InviteRecord } from '@/lib/auth/signup-policy';
import { userWorkspacesKey } from '@/lib/borga/keys';
import { makeOnboarding, type Workspace } from '@/lib/borga/data';

export const runtime = 'nodejs';

const COLORS = ['#6366f1', '#0ea5e9', '#059669', '#f59e0b', '#ec4899', '#8b5cf6'];

/** Lets the signup page know whether to ask for an invite code. */
export async function GET() {
  return NextResponse.json({ ok: true, mode: signupMode(process.env) });
}

export async function POST(req: Request) {
  let claimed: string | null = null;
  try {
    const body = await req.json().catch(() => null);
    const email = String(body?.email ?? '').toLowerCase().trim();
    const password = String(body?.password ?? '');
    const name = String(body?.name ?? '').trim();

    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return NextResponse.json({ ok: false, error: 'A valid email is required.' }, { status: 400 });
    }
    if (password.length > 200) {
      return NextResponse.json({ ok: false, error: 'Password must be at most 200 characters.' }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ ok: false, error: 'Password must be at least 8 characters.' }, { status: 400 });
    }
    if (!name) {
      return NextResponse.json({ ok: false, error: 'Your name is required.' }, { status: 400 });
    }

    // Decide access before looking the email up, so an uninvited visitor cannot probe which emails have accounts.
    const inviteCode = String(body?.inviteCode ?? '').trim();
    const decision = decideSignup(signupMode(process.env), email, inviteCode.length > 0, process.env);
    if (!decision.allow) {
      return NextResponse.json({ ok: false, error: decision.error }, { status: decision.status });
    }
    let inviteHash: string | null = null;
    if (decision.consumeInvite) {
      inviteHash = hashInviteCode(inviteCode);
      const check = checkInvite(await getBorgaState<InviteRecord>(inviteKey(inviteHash)), email, Date.now());
      if (!check.ok) return NextResponse.json({ ok: false, error: check.error }, { status: 403 });
    }

    const existing = await getUserByEmail(email);
    if (existing) {
      return NextResponse.json({ ok: false, error: 'An account with this email already exists.' }, { status: 409 });
    }

    // Single use: only one concurrent signup can claim the code. Released again if account creation fails.
    if (inviteHash) {
      const won = await insertBorgaStateIfAbsent(inviteUsedKey(inviteHash), { email, at: Date.now() });
      if (!won) return NextResponse.json({ ok: false, error: 'That invite code has already been used.' }, { status: 403 });
      claimed = inviteHash;
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
      createdAtIso: new Date().toISOString(),
      onboarding: makeOnboarding(),
    };
    await setBorgaState(userWorkspacesKey(user.id), [ws]);

    // A short welcome, in the background: a mail server being slow or absent must never hold up or fail signup.
    const appUrl = appOrigin(req);
    if (appUrl) {
      void (async () => {
        if (!(await isEmailConfigured())) return;
        const mail = renderWelcome({ name: user.name, companyName: ws.name, appUrl: `${appUrl}/app` });
        await sendEmail({ to: user.email, subject: mail.subject, html: mail.html, text: mail.text });
      })().catch(() => undefined);
    }

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
    if (claimed) await deleteBorgaState(inviteUsedKey(claimed)).catch(() => false);
    return NextResponse.json({ ok: false, error: 'Could not create account. Try again.' }, { status: 500 });
  }
}
