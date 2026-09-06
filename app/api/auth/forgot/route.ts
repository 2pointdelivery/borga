import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { hashToken } from '@/lib/auth/password';
import { getUserByEmail, setResetToken } from '@/lib/auth/queries';
import { isEmailConfigured, sendEmail, buildResetEmailHtml } from '@/lib/auth/mailer';

export const runtime = 'nodejs';

const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const email = String(body?.email ?? '').toLowerCase().trim();
    if (!email) {
      return NextResponse.json({ ok: false, error: 'Email is required.' }, { status: 400 });
    }

    const user = await getUserByEmail(email);
    // Always return success to avoid leaking which emails are registered.
    if (!user) {
      return NextResponse.json({ ok: true });
    }

    const token = randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + RESET_TTL_MS);
    await setResetToken(user.id, hashToken(token), expires);

    const origin = new URL(req.url).origin;
    const resetUrl = `${origin}/reset?token=${token}`;

    // When SMTP is configured, deliver a real email and keep the link server-side.
    // Otherwise (local dev) surface the link directly so the flow is still usable.
    let emailed = false;
    if (await isEmailConfigured()) {
      emailed = await sendEmail({
        to: user.email,
        subject: 'Reset your Borga password',
        html: buildResetEmailHtml({ name: user.name, resetUrl }),
      });
    }

    return NextResponse.json({ ok: true, devResetUrl: emailed ? undefined : resetUrl });
  } catch {
    return NextResponse.json({ ok: false, error: 'Could not process request.' }, { status: 500 });
  }
}
