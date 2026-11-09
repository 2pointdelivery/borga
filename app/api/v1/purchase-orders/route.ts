import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { guardV1 } from '@/lib/borga/api-auth';
import { featureGate } from '@/lib/borga/features-server';
import { getBorgaState, setBorgaState } from '@/lib/borga/persistence';
import { userWsKey } from '@/lib/borga/keys';
import { poTotal, type PurchaseOrder } from '@/lib/borga/procurement';

export const runtime = 'nodejs';

const poLineSchema = z.object({
  itemId: z.string().max(64).optional(),
  label: z.string().trim().min(1).max(200),
  qty: z.coerce.number().positive().max(1_000_000),
  unitCost: z.coerce.number().min(0).max(1_000_000_000),
});

const createPoSchema = z.object({
  vendorId: z.string().trim().min(1).max(64),
  vendorName: z.string().trim().min(1).max(140),
  expectedIso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  currency: z.string().trim().max(8).optional(),
  notes: z.string().trim().max(1000).optional(),
  lines: z.array(poLineSchema).min(1).max(50),
});

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
      id: p.id,
      number: p.number,
      vendor: p.vendorName,
      status: p.status,
      total: poTotal(p),
      billId: p.billId ?? null,
    })),
  });
}

export async function POST(req: NextRequest) {
  const g = await guardV1(req);
  if ('res' in g) return g.res;
  const gate = await featureGate('procurement', g.auth.userId, g.ws);
  if (gate) return gate;
  const parsed = createPoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid purchase order: vendorId, vendorName, and lines are required.' }, { status: 400 });
  }
  const key = userWsKey(g.auth.userId, g.ws, 'purchaseOrders');
  const pos = (await getBorgaState<PurchaseOrder[]>(key)) ?? [];
  const d = parsed.data;
  const po: PurchaseOrder = {
    id: `po-${Date.now().toString(36)}${randomBytes(3).toString('hex')}`,
    number: `PO-${pos.length + 1}`,
    vendorId: d.vendorId,
    vendorName: d.vendorName,
    lines: d.lines,
    status: 'draft',
    orderedAt: new Date().toISOString().slice(0, 10),
    expectedIso: d.expectedIso,
    currency: d.currency,
    notes: d.notes,
  };
  await setBorgaState(key, [po, ...pos]);
  return NextResponse.json(
    {
      ok: true,
      purchaseOrder: {
        id: po.id,
        number: po.number,
        vendor: po.vendorName,
        status: po.status,
        total: poTotal(po),
      },
    },
    { status: 201 },
  );
}
