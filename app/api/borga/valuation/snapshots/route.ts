import { NextResponse, type NextRequest } from 'next/server';
import { sessionUserId, featureGate } from '@/lib/borga/features-server';
import { getBorgaState, setBorgaState } from '@/lib/borga/persistence';
import { userWsKey } from '@/lib/borga/keys';
import { EMPTY_SNAPSHOTS, takeSnapshot, type ValuationSnapshot } from '@/lib/borga/valuation-history';
import { deriveValuation, type FinanceEntry, type KnowledgeEntry, type ValuationConfig, type Workspace } from '@/lib/borga/data';
import { userWorkspacesKey } from '@/lib/borga/keys';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const userId = await sessionUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const ws = new URL(req.url).searchParams.get('ws') ?? '';
  const gate = await featureGate('valuation', userId, ws);
  if (gate) return gate;
  const snaps = (await getBorgaState<ValuationSnapshot[]>(userWsKey(userId, ws, 'valuationSnapshots'))) ?? EMPTY_SNAPSHOTS;
  return NextResponse.json({ ok: true, snapshots: snaps.slice(0, 120) });
}

// POST { ws, note? } — snapshots live derived FMV so history is real (replaces illustrative chart).
export async function POST(req: NextRequest) {
  const userId = await sessionUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { ws?: string; note?: string } | null;
  if (!body?.ws) return NextResponse.json({ ok: false, error: 'ws required' }, { status: 400 });
  const gate = await featureGate('valuation', userId, body.ws);
  if (gate) return gate;
  const finance = (await getBorgaState<FinanceEntry[]>(userWsKey(userId, body.ws, 'finance'))) ?? [];
  const knowledge = (await getBorgaState<KnowledgeEntry[]>(userWsKey(userId, body.ws, 'knowledge'))) ?? [];
  const config = (await getBorgaState<ValuationConfig>(userWsKey(userId, body.ws, 'valuation'))) ?? null;
  const workspaces = (await getBorgaState<Workspace[]>(userWorkspacesKey(userId))) ?? [];
  const wsRow = workspaces.find((w) => w.id === body.ws) ?? null;
  const v = deriveValuation(finance, knowledge, wsRow, config);
  const snap = takeSnapshot(v, 'manual', body.note);
  const key = userWsKey(userId, body.ws, 'valuationSnapshots');
  const existing = (await getBorgaState<ValuationSnapshot[]>(key)) ?? [];
  await setBorgaState(key, [snap, ...existing].slice(0, 120));
  return NextResponse.json({ ok: true, snapshot: snap }, { status: 201 });
}
