import { NextResponse, type NextRequest } from 'next/server';
import { isEmailConfigured, sendThreadedEmail } from '@/lib/auth/mailer';
import { sessionUserId } from '@/lib/borga/features-server';
import { isValidWsId } from '@/lib/borga/keys';
import { getUserById } from '@/lib/auth/queries';
import { workspaceSmtp } from '@/lib/borga/smtp-server';

export const runtime = 'nodejs';

/**
 * POST /api/borga/smtp-test { ws? }: sends a test message to the signed-in person's own address, through the company's own mail
 * server when it has one (ws), otherwise the deployment's shared sender. It can only ever mail the caller, so it cannot be used to
 * send to other people.
 */
export async function POST(req: NextRequest) {
  const userId = await sessionUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const me = await getUserById(userId);
  if (!me) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  let body: { to?: string; ws?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body.' }, { status: 400 });
  }

  const to = String(body.to ?? me.email).trim();
  if (to.toLowerCase() !== me.email.toLowerCase()) {
    return NextResponse.json({ ok: false, error: 'The test email can only be sent to your own account address.' }, { status: 403 });
  }
  const ctx = isValidWsId(body.ws) ? { userId, ws: body.ws } : undefined;
  if (!(await isEmailConfigured(ctx))) {
    return NextResponse.json({ ok: false, error: 'No mail server is set up yet. Add your SMTP server first.' }, { status: 400 });
  }
  const own = ctx ? await workspaceSmtp(ctx.userId, ctx.ws) : null;

  const r = await sendThreadedEmail({
    to,
    subject: 'Borga email test',
    text: 'This is a test message from Borga. If you received it, your mail server is working.',
    html: `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#111;padding:24px;">
      <h1 style="font-size:18px;">Email test successful</h1>
      <p>This is a test message from Borga, sent ${own ? `through your own mail server (${own.host})` : 'through the shared sender'}. If you received it, mail is working.</p>
    </body></html>`,
  }, ctx);
  if (r.ok) return NextResponse.json({ ok: true, via: own ? own.host : 'shared' });
  return NextResponse.json({ ok: false, error: 'The mail server did not accept the message. Check the settings and press Test connection.' }, { status: 502 });
}
