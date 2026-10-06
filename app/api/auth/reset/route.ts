import { isEmailConfigured, sendEmail } from '@/lib/auth/mailer';
import { renderPasswordChanged } from '@/lib/auth/email-templates';
import { appOrigin } from '@/lib/auth/app-url';
import { NextResponse } from 'next/server';
import { hashPassword, hashToken } from '@/lib/auth/password';
import { getUserByResetToken, updatePassword } from '@/lib/auth/queries';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const token = String(body?.token ?? '').trim();
    const password = String(body?.password ?? '');

    if (!token) {
      return NextResponse.json({ ok: false, error: 'Missing reset token.' }, { status: 400 });
    }
    if (password.length > 200) {
      return NextResponse.json({ ok: false, error: 'Password must be at most 200 characters.' }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ ok: false, error: 'Password must be at least 8 characters.' }, { status: 400 });
    }

    // Look up by the hashed form of the supplied token so the raw token never
    // touches the database query directly.
    const user = await getUserByResetToken(hashToken(token));
    if (!user) {
      return NextResponse.json({ ok: false, error: 'This reset link is invalid or has expired.' }, { status: 400 });
    }

    await updatePassword(user.id, hashPassword(password));
    // A reset is usually done because someone else may have access: end every session that exists.
    await (await import('@/lib/auth/session-revocation')).revokeAllSessions(user.id).catch(() => undefined);
    // Tell the owner, so a reset they did not ask for is noticed.
    const origin = appOrigin(req);
    if (origin) {
      void (async () => {
        if (!(await isEmailConfigured())) return;
        const mail = renderPasswordChanged({ name: user.name, signInUrl: `${origin}/login` });
        await sendEmail({ to: user.email, subject: mail.subject, html: mail.html, text: mail.text });
      })().catch(() => undefined);
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: 'Could not reset password.' }, { status: 500 });
  }
}
