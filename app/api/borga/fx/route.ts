import { NextResponse, type NextRequest } from 'next/server';
import { sessionUserId } from '@/lib/borga/features-server';
import { getBorgaState, setBorgaState } from '@/lib/borga/persistence';
import { userWsKey } from '@/lib/borga/keys';
import { refreshFx } from '@/lib/borga/fx-server';
import { EMPTY_FX, type FxRates } from '@/lib/borga/fx';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const userId = await sessionUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const ws = new URL(req.url).searchParams.get('ws') ?? '';
  const key = userWsKey(userId, ws, 'fxRates');
  try {
    const rates = await refreshFx();
    await setBorgaState(key, rates);
    return NextResponse.json({ ok: true, rates });
  } catch {
    const kept = (await getBorgaState<FxRates>(key)) ?? EMPTY_FX;
    return NextResponse.json(
      { ok: false, error: 'Bank of Canada FX API unreachable — kept the saved table.', rates: kept },
      { status: 502 },
    );
  }
}

/** Save a hand-kept rates table (manual fallback when offline or for exotic currencies). */
export async function POST(req: NextRequest) {
  const userId = await sessionUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { ws?: string; base?: string; rates?: Record<string, number> } | null;
  if (!body?.ws || typeof body.rates !== 'object' || !body.rates) {
    return NextResponse.json({ ok: false, error: 'ws and rates required' }, { status: 400 });
  }
  const clean: Record<string, number> = {};
  for (const [k, v] of Object.entries(body.rates)) {
    const code = k.trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(code) && typeof v === 'number' && Number.isFinite(v) && v > 0) clean[code] = v;
  }
  const rates: FxRates = {
    base: (body.base ?? 'EUR').toUpperCase(),
    date: new Date().toISOString().slice(0, 10),
    rates: { [body.base?.toUpperCase() ?? 'EUR']: 1, ...clean },
    source: 'manual',
  };
  await setBorgaState(userWsKey(userId, body.ws, 'fxRates'), rates);
  return NextResponse.json({ ok: true, rates });
}
