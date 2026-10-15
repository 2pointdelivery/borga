import { NextResponse, type NextRequest } from 'next/server';
import { guardV1 } from '@/lib/borga/api-auth';
import { featureGate } from '@/lib/borga/features-server';
import { getBorgaState, setBorgaState } from '@/lib/borga/persistence';
import { userWsKey } from '@/lib/borga/keys';
import { EMPTY_CAP_TABLE, type CapTableState } from '@/lib/borga/cap-table';

export const runtime = 'nodejs';

// POST /api/v1/equity/safes — alias documented in Developers; same store as holdings.
export async function POST(req: NextRequest) {
  const g = await guardV1(req);
  if ('res' in g) return g.res;
  const gate = await featureGate('capTable', g.auth.userId, g.ws);
  if (gate) return gate;
  const body = (await req.json().catch(() => null)) as { stakeholderId?: string; amount?: number; cap?: number; discount?: number; mfn?: boolean; kind?: 'safe' | 'note' } | null;
  const amount = body?.amount;
  if (!body?.stakeholderId || !(amount !== undefined && amount > 0)) {
    return NextResponse.json({ ok: false, error: 'stakeholderId and positive amount are required.' }, { status: 400 });
  }
  const key = userWsKey(g.auth.userId, g.ws, 'capTable');
  const s = (await getBorgaState<CapTableState>(key)) ?? EMPTY_CAP_TABLE;
  // No orphan records: the stakeholder must exist on the same cap table (vibe-check #4).
  if (!s.stakeholders.some((t) => t.id === body.stakeholderId)) {
    return NextResponse.json({ ok: false, error: 'stakeholderId does not exist on this workspace cap table.' }, { status: 400 });
  }
  const safe = {
    id: `safe-${Date.now().toString(36)}`, stakeholderId: body.stakeholderId, amount,
    cap: body.cap, discount: body.discount, mfn: body.mfn, kind: body.kind ?? 'safe',
  };
  await setBorgaState(key, { ...s, safes: [...s.safes, safe] });
  return NextResponse.json({ ok: true, safe: { id: safe.id } }, { status: 201 });
}
