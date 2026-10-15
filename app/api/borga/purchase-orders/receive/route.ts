import { NextResponse, type NextRequest } from 'next/server';
import { sessionUserId, featureGate } from '@/lib/borga/features-server';
import { getBorgaState, setBorgaState } from '@/lib/borga/persistence';
import { userWsKey } from '@/lib/borga/keys';
import { receivePO, type PurchaseOrder } from '@/lib/borga/procurement';
import { emitEvent } from '@/lib/borga/emit-event';
import type { StockMovement, Warehouse } from '@/lib/borga/inventory';

export const runtime = 'nodejs';

// POST { ws, poId, warehouseId?, lines: [{ index, qty }] } — receive goods → PO status + stock-in movements at actual cost.
export async function POST(req: NextRequest) {
  const userId = await sessionUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { ws?: string; poId?: string; warehouseId?: string; lines?: Array<{ index: number; qty: number }> } | null;
  if (!body?.ws || !body?.poId || !Array.isArray(body.lines)) return NextResponse.json({ ok: false, error: 'ws, poId and lines required' }, { status: 400 });
  const gate = await featureGate('procurement', userId, body.ws);
  if (gate) return gate;
  const poKey = userWsKey(userId, body.ws, 'purchaseOrders');
  const pos = (await getBorgaState<PurchaseOrder[]>(poKey)) ?? [];
  const po = pos.find((p) => p.id === body.poId);
  if (!po) return NextResponse.json({ ok: false, error: 'purchase order not found' }, { status: 404 });
  const warehouses = (await getBorgaState<Warehouse[]>(userWsKey(userId, body.ws, 'warehouses'))) ?? [];
  const warehouseId = body.warehouseId ?? warehouses.find((w) => w.active)?.id ?? warehouses[0]?.id;
  if (!warehouseId) return NextResponse.json({ ok: false, error: 'No warehouse: create one under Inventory → Warehouses first.' }, { status: 400 });
  try {
    const { po: next, movements } = receivePO(po, { received: body.lines, warehouseId, reference: po.number });
    await setBorgaState(poKey, pos.map((p) => (p.id === po.id ? next : p)));
    if (movements.length > 0) {
      const mKey = userWsKey(userId, body.ws, 'stockMovements');
      const existing = (await getBorgaState<StockMovement[]>(mKey)) ?? [];
      const rows: StockMovement[] = movements.map((m, i) => ({
        id: `sm-${Date.now().toString(36)}-${i}`, itemId: m.itemId, warehouseId: m.warehouseId,
        qty: m.qty, unitCost: m.unitCost, reason: 'purchase' as const, reference: m.reference, at: m.at,
      }));
      await setBorgaState(mKey, [...rows, ...existing]);
    }
    await emitEvent(userId, body.ws, 'purchase-order.received', { poId: po.id, status: next.status, movements: movements.length });
    return NextResponse.json({ ok: true, poId: po.id, status: next.status, movements: movements.length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Could not receive PO.' }, { status: 400 });
  }
}
