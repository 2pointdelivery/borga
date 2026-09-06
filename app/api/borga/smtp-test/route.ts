import { NextResponse } from 'next/server';
import { isEmailConfigured, sendEmail } from '@/lib/auth/mailer';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  let body: { to?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body.' }, { status: 400 });
  }

  const to = String(body.to ?? '').trim();
  if (!to) {
    return NextResponse.json({ ok: false, error: 'A recipient email (to) is required.' }, { status: 400 });
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
