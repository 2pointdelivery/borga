import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { sessionUserId, featureGate } from '@/lib/borga/features-server';
import { isValidWsId } from '@/lib/borga/keys';
import { ownsWorkspaceStrict } from '@/lib/borga/workspace-access';
import { twilioCredentials } from '@/lib/borga/provider-keys';

export const runtime = 'nodejs';

const PHONE_RE = /^\+?[1-9]\d{6,14}$/;

const SmsBody = z.object({
  ws: z.string().min(1).max(64),
  to: z.string().min(7).max(24),
  body: z.string().min(1).max(1600),
});

function normalizePhone(raw: string): string {
  const digits = raw.replace(/[\s\-()]/g, '');
  return digits.startsWith('+') ? digits : `+${digits}`;
}

export async function POST(req: NextRequest) {
  const userId = await sessionUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const parsed = SmsBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'A valid recipient phone number and SMS body are required.' }, { status: 400 });
  }

  const { ws, to, body } = parsed.data;
  if (!isValidWsId(ws)) {
    return NextResponse.json({ ok: false, error: 'Invalid workspace id.' }, { status: 400 });
  }

  if (!(await ownsWorkspaceStrict(userId, ws))) {
    return NextResponse.json({ ok: false, error: 'forbidden_workspace' }, { status: 403 });
  }

  const off = await featureGate('inbox', userId, ws);
  if (off) return off;

  const normalizedTo = normalizePhone(to);
  if (!PHONE_RE.test(normalizedTo)) {
    return NextResponse.json({ ok: false, error: 'Enter a valid E.164 phone number (e.g. +15551234567).' }, { status: 400 });
  }

  const creds = await twilioCredentials(userId, ws);
  if (!creds) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Twilio SMS is not configured — add your Twilio credentials under Integrations → Connections.',
      },
      { status: 409 },
    );
  }

  try {
    const auth = Buffer.from(`${creds.sid}:${creds.token}`).toString('base64');
    const form = new URLSearchParams({
      To: normalizedTo,
      From: creds.from,
      Body: body.trim(),
    });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(creds.sid)}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `Twilio rejected the SMS (HTTP ${res.status}). Check your Twilio sender number and credentials under Integrations → Connections.` },
        { status: 502 },
      );
    }

    const data = (await res.json().catch(() => ({}))) as { sid?: string };
    return NextResponse.json({ ok: true, sid: data.sid ?? '' });
  } catch {
    return NextResponse.json({ ok: false, error: 'Could not reach Twilio to send the SMS.' }, { status: 502 });
  }
}
