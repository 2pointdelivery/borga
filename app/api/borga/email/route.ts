import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { loadFeatures, sessionUserId } from '@/lib/borga/features-server';
import { isValidWsId } from '@/lib/borga/keys';
import { isEmailConfigured } from '@/lib/auth/mailer';
import { getUserById } from '@/lib/auth/queries';
import { CLIENT_EMAIL_EVENTS, EMAIL_EVENTS, EMAIL_EVENT_IDS, normalizeRecipients, type EmailEventId } from '@/lib/borga/email-core';
import { appBaseUrl, loadEmailSettings, notifyEvent, readMailLog, saveEmailSettings, sendDigest, sendTestEmail } from '@/lib/borga/email-notify';

export const runtime = 'nodejs';

const settingsPatch = z.object({
  enabled: z.boolean(),
  recipients: z.array(z.string().max(254)).max(20),
  replyTo: z.string().max(254).refine((v) => v === '' || /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v)),
  events: z.object(Object.fromEntries(EMAIL_EVENT_IDS.map((id) => [id, z.boolean()])) as Record<EmailEventId, z.ZodBoolean>).partial(),
  digest: z.object({ frequency: z.enum(['off', 'daily', 'weekly']), hour: z.number().int().min(0).max(23), skipIfEmpty: z.boolean() }).partial(),
}).partial();

const body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('saveSettings'), settings: settingsPatch }),
  z.object({ action: z.literal('sendTest'), to: z.string().max(254).optional() }),
  z.object({ action: z.literal('digestNow') }),
  // Events only the browser can see (approvals created in the UI, recurring runs). Validated and size-limited.
  z.object({ action: z.literal('notify'), event: z.enum(CLIENT_EMAIL_EVENTS as [EmailEventId, ...EmailEventId[]]), data: z.record(z.unknown()).refine((d) => JSON.stringify(d).length < 4000) }),
]);

function origin(req: NextRequest): string | undefined {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!host) return undefined;
  const proto = req.headers.get('x-forwarded-proto') ?? new URL(req.url).protocol.replace(':', '');
  return `${proto}://${host}`;
}

async function guard(req: NextRequest) {
  const userId = await sessionUserId(req);
  const ws = new URL(req.url).searchParams.get('ws');
  if (!userId) return { res: NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 }) } as const;
  if (!isValidWsId(ws)) return { res: NextResponse.json({ ok: false, error: 'ws required' }, { status: 400 }) } as const;
  return { userId, ws } as const;
}

export async function GET(req: NextRequest) {
  const g = await guard(req);
  if ('res' in g) return g.res;
  const [settings, smtp, log, user, flags] = await Promise.all([
    loadEmailSettings(g.userId, g.ws),
    isEmailConfigured({ userId: g.userId, ws: g.ws }),
    readMailLog(g.userId, g.ws),
    getUserById(g.userId),
    loadFeatures(g.userId, g.ws),
  ]);
  return NextResponse.json({
    ok: true,
    featureOn: flags.flags.emailUpdates,
    smtpConfigured: smtp,
    settings,
    appUrl: appBaseUrl(settings) ?? null,
    ownerEmail: user?.email ?? null,
    events: EMAIL_EVENTS,
    log: log.slice(0, 20),
  });
}

export async function POST(req: NextRequest) {
  const g = await guard(req);
  if ('res' in g) return g.res;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid request' }, { status: 400 });
  const b = parsed.data;
  const { userId, ws } = g;

  switch (b.action) {
    case 'saveSettings': {
      const cur = await loadEmailSettings(userId, ws);
      const patch = { ...b.settings } as Parameters<typeof saveEmailSettings>[2];
      const turningOn = b.settings.enabled === true && !cur.enabled;
      // First time on with nobody listed: start with the account owner so the first email has somewhere to go.
      const willHave = patch.recipients !== undefined ? normalizeRecipients(patch.recipients) : cur.recipients;
      if (turningOn && willHave.length === 0) {
        const user = await getUserById(userId);
        if (user?.email) patch.recipients = [user.email];
      }
      if (!process.env.APP_URL) patch.appUrl = origin(req); // remembered so cron-sent emails can link back
      return NextResponse.json({ ok: true, settings: await saveEmailSettings(userId, ws, patch) });
    }
    case 'sendTest': {
      const settings = await loadEmailSettings(userId, ws);
      const user = await getUserById(userId);
      const to = b.to ? normalizeRecipients([b.to]) : settings.recipients.length ? settings.recipients : user?.email ? [user.email] : [];
      if (!to.length) return NextResponse.json({ ok: false, error: 'Add a recipient first.' }, { status: 400 });
      if (!(await isEmailConfigured({ userId, ws }))) return NextResponse.json({ ok: false, error: 'No mail server is set up. Add your SMTP server under Integrations → Connections first.' }, { status: 409 });
      const r = await sendTestEmail(userId, ws, to);
      return NextResponse.json({ ok: r.sent > 0, ...r, to, error: r.sent > 0 ? undefined : r.skipped ?? 'The mail server rejected the message.' });
    }
    case 'digestNow': {
      if (!(await loadEmailSettings(userId, ws)).enabled) return NextResponse.json({ ok: false, error: 'Turn email updates on first.' }, { status: 409 });
      const r = await sendDigest(userId, ws, { force: true });
      return NextResponse.json({ ok: r.sent > 0, ...r, error: r.sent > 0 ? undefined : r.skipped ?? 'Nothing was sent.' });
    }
    case 'notify': {
      if (!(await loadFeatures(userId, ws)).flags.emailUpdates) return NextResponse.json({ ok: true, skipped: 'off' });
      const r = await notifyEvent(userId, ws, b.event, b.data);
      return NextResponse.json({ ok: true, ...r });
    }
  }
}
