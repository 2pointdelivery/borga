import { NextResponse, type NextRequest } from 'next/server';
import { guardV1 } from '@/lib/borga/api-auth';
import { featureGate } from '@/lib/borga/features-server';
import { getBorgaState } from '@/lib/borga/persistence';
import { userWsKey } from '@/lib/borga/keys';
import { poTotal, type PurchaseOrder } from '@/lib/borga/procurement';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const g = await guardV1(req);
  if ('res' in g) return g.res;
  const gate = await featureGate('procurement', g.auth.userId, g.ws);
  if (gate) return gate;
  const pos = (await getBorgaState<PurchaseOrder[]>(userWsKey(g.auth.userId, g.ws, 'purchaseOrders'))) ?? [];
  const status = new URL(req.url).searchParams.get('status');
  return NextResponse.json({
    ok: true,
    purchaseOrders: (status ? pos.filter((p) => p.status === status) : pos).slice(0, 100).map((p) => ({
      id: p.id, vendor: p.vendorName, status: p.status, total: poTotal(p), billId: p.billId ?? null,
    })),
  });
}
