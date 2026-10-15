import { NextResponse, type NextRequest } from 'next/server';
import { sessionUserId, featureGate } from '@/lib/borga/features-server';
import { getBorgaState, setBorgaState } from '@/lib/borga/persistence';
import { userWsKey, userWorkspacesKey } from '@/lib/borga/keys';
import { billForPO, poTotal, type PurchaseOrder } from '@/lib/borga/procurement';
import { rateFor, EMPTY_FX, type FxRates } from '@/lib/borga/fx';
import { emitEvent } from '@/lib/borga/emit-event';
import type { Bill, Workspace } from '@/lib/borga/data';

export const runtime = 'nodejs';

// POST { ws, poId, dueIso? } — 3-way match must hold; creates the vendor bill and marks the PO billed.
export async function POST(req: NextRequest) {
  const userId = await sessionUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { ws?: string; poId?: string; dueIso?: string } | null;
  if (!body?.ws || !body?.poId) return NextResponse.json({ ok: false, error: 'ws and poId required' }, { status: 400 });
  const gate = await featureGate('procurement', userId, body.ws);
  if (gate) return gate;
  const poKey = userWsKey(userId, body.ws, 'purchaseOrders');
  const pos = (await getBorgaState<PurchaseOrder[]>(poKey)) ?? [];
  const po = pos.find((p) => p.id === body.poId);
  if (!po) return NextResponse.json({ ok: false, error: 'purchase order not found' }, { status: 404 });
  const bills = (await getBorgaState<Bill[]>(userWsKey(userId, body.ws, 'bills'))) ?? [];
  try {
    const workspaces = (await getBorgaState<Workspace[]>(userWorkspacesKey(userId))) ?? [];
    const wsCurrency = (workspaces.find((w) => w.id === body.ws)?.currency ?? 'USD').toUpperCase();
    const fx = (await getBorgaState<FxRates>(userWsKey(userId, body.ws, 'fxRates'))) ?? EMPTY_FX;
    const docCcy = (po.currency ?? '').toUpperCase();
    const fxRate = docCcy && docCcy !== wsCurrency ? rateFor(fx, docCcy, wsCurrency) : 1;
    const { bill } = billForPO(po, {
      billNumber: `BILL-${bills.length + 1}`,
      dueIso: body.dueIso ?? new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
      wsCurrency, fxRate: fxRate ?? undefined,
    });
    await setBorgaState(userWsKey(userId, body.ws, 'bills'), [bill, ...bills]);
    await setBorgaState(poKey, pos.map((p) => (p.id === po.id ? { ...p, status: 'billed' as const, billId: bill.id } : p)));
    await emitEvent(userId, body.ws, 'bill.due', { billId: bill.id, poId: po.id, total: poTotal(po) });
    return NextResponse.json({ ok: true, billId: bill.id, total: poTotal(po) }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Could not create bill.' }, { status: 400 });
  }
}
