import { NextResponse, type NextRequest } from 'next/server';
import { isEmailConfigured, sendEmail } from '@/lib/auth/mailer';
import { sessionUserId } from '@/lib/borga/features-server';
import { getUserById } from '@/lib/auth/queries';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const userId = await sessionUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const me = await getUserById(userId);
  if (!me) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  let body: { to?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body.' }, { status: 400 });
  }

  // The shared SMTP account must not be usable to mail arbitrary people: test mail goes to the caller only.
  const to = String(body.to ?? me.email).trim();
  if (to.toLowerCase() !== me.email.toLowerCase()) {
    return NextResponse.json({ ok: false, error: 'The test email can only be sent to your own account address.' }, { status: 403 });
  }

  if (!(await isEmailConfigured())) {
    return NextResponse.json({ ok: false, error: 'SMTP is not configured. Add the SMTP_* settings and a From Address first.' }, { status: 400 });
  }

  const ok = await sendEmail({
    to,
    subject: 'Borga SMTP test',
    html: `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#111;padding:24px;">
      <h1 style="font-size:18px;">SMTP test successful</h1>
      <p>This is a test message from your Borga mailer. If you received it, your SMTP configuration is working.</p>
    </body></html>`,
  });

  if (ok) {
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ ok: false, error: 'Failed to send test email. Check the SMTP credentials and server logs.' }, { status: 500 });
}
