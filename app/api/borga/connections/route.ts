import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { sessionUserId } from '@/lib/borga/features-server';
import { isValidWsId } from '@/lib/borga/keys';
import { PROVIDERS, PROVIDER_IDS, type ProviderId } from '@/lib/borga/providers';
import { deleteConnection, listConnectionStatuses, saveConnection, testConnection } from '@/lib/borga/connections-server';

export const runtime = 'nodejs';

const provider = z.enum(PROVIDER_IDS as [ProviderId, ...ProviderId[]]);

const body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save'), provider, values: z.record(z.string().max(2048)), clear: z.array(z.string().max(64)).max(20).optional() }),
  z.object({ action: z.literal('test'), provider }),
  z.object({ action: z.literal('delete'), provider }),
]);

function publicOrigin(req: NextRequest): string {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? new URL(req.url).host;
  const proto = req.headers.get('x-forwarded-proto') ?? new URL(req.url).protocol.replace(':', '');
  return `${proto}://${host}`;
}

export async function GET(req: NextRequest) {
  const userId = await sessionUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const ws = new URL(req.url).searchParams.get('ws');
  if (!isValidWsId(ws)) return NextResponse.json({ ok: false, error: 'ws required' }, { status: 400 });
  const origin = publicOrigin(req);
  return NextResponse.json({
    ok: true,
    providers: PROVIDERS,
    statuses: await listConnectionStatuses(userId, ws),
    webhookUrls: {
      meta: `${origin}/api/borga/hooks/meta?u=${userId}&ws=${ws}`,
      twilio: `${origin}/api/borga/hooks/twilio?u=${userId}&ws=${ws}`,
    },
  });
}

export async function POST(req: NextRequest) {
  const userId = await sessionUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const ws = new URL(req.url).searchParams.get('ws');
  if (!isValidWsId(ws)) return NextResponse.json({ ok: false, error: 'ws required' }, { status: 400 });

  let parsed;
  try {
    parsed = body.safeParse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid request' }, { status: 400 });
  const b = parsed.data;

  switch (b.action) {
    case 'save': {
      const r = await saveConnection(userId, ws, b.provider, b.values, b.clear);
      return r.ok ? NextResponse.json({ ok: true, status: r.status }) : NextResponse.json({ ok: false, error: r.error }, { status: 400 });
    }
    case 'test':
      return NextResponse.json({ ok: true, result: await testConnection(userId, ws, b.provider) });
    case 'delete':
      return NextResponse.json({ ok: await deleteConnection(userId, ws, b.provider) });
  }
}
