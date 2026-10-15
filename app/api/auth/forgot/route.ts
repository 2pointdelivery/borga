import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { hashToken } from '@/lib/auth/password';
import { LoginThrottle } from '@/lib/auth/login-throttle';
import { getUserByEmail, setResetToken } from '@/lib/auth/queries';
import { isEmailConfigured, sendEmail } from '@/lib/auth/mailer';
import { renderPasswordReset } from '@/lib/auth/email-templates';
import { appOrigin } from '@/lib/auth/app-url';

export const runtime = 'nodejs';

const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

// Per-email throttle (vibe-check #10): reset-mail spraying across many
// addresses is capped like sign-in guessing. Same trade-off as login: an
// attacker can rate-limit someone else's address for the window.
const g = globalThis as typeof globalThis & { __borgaForgotThrottle?: LoginThrottle };
const throttle = (g.__borgaForgotThrottle ??= new LoginThrottle());

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const email = String(body?.email ?? '').toLowerCase().trim();
    if (!email) {
      return NextResponse.json({ ok: false, error: 'Email is required.' }, { status: 400 });
    }
    const verdict = throttle.check(email);
    if (verdict.locked) {
      return NextResponse.json(
        { ok: false, error: 'Too many reset requests. Try again later.' },
        { status: 429, headers: { 'Retry-After': String(verdict.retryAfterSec) } },
      );
    }
    throttle.recordFailure(email);

    const user = await getUserByEmail(email);
    // Always return success to avoid leaking which emails are registered.
    if (!user) {
      return NextResponse.json({ ok: true });
    }

    const token = randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + RESET_TTL_MS);
    await setResetToken(user.id, hashToken(token), expires);

    const origin = appOrigin(req);
    const resetUrl = origin ? `${origin}/reset?token=${token}` : null;

    // The link only ever goes to the mailbox of the account. It is shown in the response only when developing without a mail
    // server: in production that would let anyone take over any account by typing its address.
    let emailed = false;
    if (resetUrl && (await isEmailConfigured())) {
      const mail = renderPasswordReset({ name: user.name, resetUrl, ttlMinutes: RESET_TTL_MS / 60_000 });
      emailed = await sendEmail({ to: user.email, subject: mail.subject, html: mail.html, text: mail.text });
    }
    if (!emailed) console.warn(`[auth] password reset requested but no email could be sent (${resetUrl ? 'mail server not configured or refused it' : 'APP_URL is not set'}).`);

    const showDevLink = !emailed && !!resetUrl && process.env.NODE_ENV !== 'production';
    return NextResponse.json({ ok: true, devResetUrl: showDevLink ? resetUrl : undefined });
  } catch {
    return NextResponse.json({ ok: false, error: 'Could not process request.' }, { status: 500 });
  }
}
