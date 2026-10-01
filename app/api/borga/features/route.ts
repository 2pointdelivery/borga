import { NextResponse, type NextRequest } from 'next/server';
import { FEATURES, isFeatureId } from '@/lib/borga/features';
import { loadFeatures, setFeatureOverride, sessionUserId } from '@/lib/borga/features-server';
import { isValidWsId } from '@/lib/borga/keys';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const userId = await sessionUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const ws = new URL(req.url).searchParams.get('ws');
  if (!isValidWsId(ws)) return NextResponse.json({ ok: false, error: 'ws required' }, { status: 400 });
  const { flags, locked } = await loadFeatures(userId, ws);
  return NextResponse.json({ ok: true, catalog: FEATURES, flags, locked });
}

export async function POST(req: NextRequest) {
  const userId = await sessionUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  let body: { ws?: unknown; id?: unknown; enabled?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 });
  }
  if (!isValidWsId(body.ws) || !isFeatureId(body.id) || typeof body.enabled !== 'boolean') {
    return NextResponse.json({ ok: false, error: 'ws, id and enabled are required' }, { status: 400 });
  }
  const current = await loadFeatures(userId, body.ws);
  if (current.locked.includes(body.id)) {
    return NextResponse.json({ ok: false, error: 'This feature is disabled by the deployment (BORGA_FEATURES_OFF).' }, { status: 409 });
  }
  const saved = await setFeatureOverride(userId, body.ws, body.id, body.enabled);
  if (!saved) return NextResponse.json({ ok: false, error: 'Could not save' }, { status: 500 });
  const next = await loadFeatures(userId, body.ws);
  return NextResponse.json({ ok: true, flags: next.flags, locked: next.locked });
}
