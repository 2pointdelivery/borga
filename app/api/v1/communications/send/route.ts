import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { guardV1 } from '@/lib/borga/api-auth';
import { featureGate } from '@/lib/borga/features-server';
import { isEmailConfigured, sendThreadedEmail } from '@/lib/auth/mailer';
import { twilioCredentials } from '@/lib/borga/provider-keys';
import { takeRouteLimit } from '@/lib/borga/route-limits';

export const runtime = 'nodejs';

const sendSchema = z.object({
  channel: z.enum(['email', 'sms']),
  to: z.string().trim().min(3).max(254),
  subject: z.string().trim().max(300).default(''),
  body: z.string().trim().min(1).max(10_000),
});

export async function POST(req: NextRequest) {
  const g = await guardV1(req);
  if ('res' in g) return g.res;
  const gate = await featureGate('inbox', g.auth.userId, g.ws);
  if (gate) return gate;

  const parsed = sendSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid payload: channel (email|sms), to, and body are required.' }, { status: 400 });
  }

  const { channel, to, subject, body } = parsed.data;
  const ctx = { userId: g.auth.userId, ws: g.ws };

  if (channel === 'email') {
    // The public API must not become a mail relay either: cap sends per credential + workspace.
    const limit = takeRouteLimit('mail', `v1:${g.auth.key?.id ?? 'session'}:${g.auth.userId}:${g.ws}`);
    if (limit.limited) {
      return NextResponse.json(
        { ok: false, error: 'Email rate limit reached. Try again later.' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } },
      );
    }
    if (!(await isEmailConfigured(ctx))) {
      return NextResponse.json({ ok: false, error: 'Email (SMTP/Postmark) is not configured for this workspace.' }, { status: 409 });
    }
    const r = await sendThreadedEmail({ to, subject: subject || '(no subject)', text: body }, ctx);
    if (!r.ok) {
      return NextResponse.json({ ok: false, error: r.error ?? 'Email send failed.' }, { status: 502 });
    }
    return NextResponse.json({ ok: true, channel: 'email', delivered: true, messageId: r.messageId ?? `m-${Date.now()}` });
  }

  // SMS via Twilio
  const creds = await twilioCredentials(g.auth.userId, g.ws);
  if (!creds) {
    return NextResponse.json({ ok: false, error: 'Twilio SMS is not configured for this workspace.' }, { status: 409 });
  }
  const normalizedPhone = to.replace(/[\s\-()]/g, '').replace(/^(?!\+)/, '+');
  try {
    const auth = Buffer.from(`${creds.sid}:${creds.token}`).toString('base64');
    const form = new URLSearchParams({ To: normalizedPhone, From: creds.from, Body: body });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(creds.sid)}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `Twilio rejected the SMS (HTTP ${res.status}).` }, { status: 502 });
    }
    const data = (await res.json().catch(() => ({}))) as { sid?: string };
    return NextResponse.json({ ok: true, channel: 'sms', delivered: true, messageId: data.sid ?? `sms-${Date.now()}` });
  } catch {
    return NextResponse.json({ ok: false, error: 'Could not reach Twilio.' }, { status: 502 });
  }
}
