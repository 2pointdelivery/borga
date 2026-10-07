import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { sessionUserId } from '@/lib/borga/features-server';
import { isValidWsId } from '@/lib/borga/keys';
import { workspaceSmtp } from '@/lib/borga/smtp-server';
import { sendThreadedEmail } from '@/lib/auth/mailer';

export const runtime = 'nodejs';

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

const body = z.object({
  to: z.string().max(254).regex(EMAIL),
  subject: z.string().max(300),
  body: z.string().min(1).max(20_000),
  replyTo: z.string().max(254).regex(EMAIL).optional(),
});

async function guard(req: NextRequest) {
  const userId = await sessionUserId(req);
  const ws = new URL(req.url).searchParams.get('ws');
  if (!userId) return { res: NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 }) } as const;
  if (!isValidWsId(ws)) return { res: NextResponse.json({ ok: false, error: 'ws required' }, { status: 400 }) } as const;
  return { userId, ws } as const;
}

/** GET ?ws= -> whether the company has its own mail server set up (the fallback when no Gmail is connected). */
export async function GET(req: NextRequest) {
  const g = await guard(req);
  if ('res' in g) return g.res;
  const own = await workspaceSmtp(g.userId, g.ws);
  return NextResponse.json({ ok: true, smtp: !!own, from: own?.fromAddress ?? null });
}

/**
 * POST ?ws= -> send one message from the company's own mail server.
 * Only the company's own server is used: the deployment's shared sender is for the platform's mail, not for people to send
 * arbitrary messages through.
 */
export async function POST(req: NextRequest) {
  const g = await guard(req);
  if ('res' in g) return g.res;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'A valid recipient and a message are required.' }, { status: 400 });
  if (!(await workspaceSmtp(g.userId, g.ws))) {
    return NextResponse.json({ ok: false, error: 'No mail server is set up. Add one under Integrations → Connected Apps, or connect Gmail there.' }, { status: 409 });
  }
  const m = parsed.data;
  const r = await sendThreadedEmail({ to: m.to, subject: m.subject || '(no subject)', text: m.body, replyTo: m.replyTo }, { userId: g.userId, ws: g.ws });
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ ok: false, error: r.error ?? 'The mail server did not accept the message.' }, { status: 502 });
}
