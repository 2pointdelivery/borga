import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { loadFeatures, sessionUserId } from '@/lib/borga/features-server';
import { isValidWsId } from '@/lib/borga/keys';
import { getConnection, listConnectionStatuses } from '@/lib/borga/connections-server';
import { getApiKey } from '@/lib/borga/secrets';
import { loadSmSettings, saveSmSettings, smProfileFacts, smPurge } from '@/lib/borga/supermemory';
import { resetSyncState, runSupermemorySync, syncStatus } from '@/lib/borga/supermemory-sync';

export const runtime = 'nodejs';

const body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('saveSettings'), settings: z.object({ memory: z.boolean(), knowledge: z.boolean(), tickets: z.boolean(), profile: z.boolean() }).partial() }),
  z.object({ action: z.literal('syncNow') }),
  z.object({ action: z.literal('profile') }),
  z.object({ action: z.literal('purge'), confirm: z.literal('DELETE') }),
]);

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
  const { userId, ws } = g;
  const [flags, own, deployKey, settings, status, statuses] = await Promise.all([
    loadFeatures(userId, ws),
    getConnection(userId, ws, 'supermemory'),
    getApiKey('SUPERMEMORY_API_KEY'),
    loadSmSettings(userId, ws),
    syncStatus(userId, ws),
    listConnectionStatuses(userId, ws),
  ]);
  const conn = statuses.find((s) => s.provider === 'supermemory');
  return NextResponse.json({
    ok: true,
    featureOn: flags.flags.supermemory,
    featureLocked: flags.locked.includes('supermemory'),
    keySource: own?.apiKey ? 'workspace' : deployKey ? 'deployment' : 'none',
    connection: conn ? { configured: conn.configured, display: conn.fields.find((f) => f.key === 'apiKey')?.display ?? '', lastTest: conn.lastTest } : null,
    settings,
    status,
  });
}

export async function POST(req: NextRequest) {
  const g = await guard(req);
  if ('res' in g) return g.res;
  const { userId, ws } = g;
  let parsed;
  try {
    parsed = body.safeParse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid request' }, { status: 400 });
  const b = parsed.data;

  if (b.action === 'saveSettings') return NextResponse.json({ ok: true, settings: await saveSmSettings(userId, ws, b.settings) });

  if (!(await loadFeatures(userId, ws)).flags.supermemory) {
    return NextResponse.json({ ok: false, error: 'Supermemory is turned off. Enable it under Settings → Features.' }, { status: 409 });
  }
  switch (b.action) {
    case 'syncNow': {
      const r = await runSupermemorySync(userId, ws);
      return NextResponse.json({ ok: true, ...r, status: await syncStatus(userId, ws) });
    }
    case 'profile':
      return NextResponse.json({ ok: true, facts: await smProfileFacts(userId, ws, 15) });
    case 'purge': {
      const r = await smPurge(userId, ws);
      if (r.ok) await resetSyncState(userId, ws);
      return NextResponse.json({ ...r, status: await syncStatus(userId, ws) }, { status: r.ok ? 200 : 502 });
    }
  }
}
