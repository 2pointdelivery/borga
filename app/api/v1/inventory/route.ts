import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { guardV1 } from '@/lib/borga/api-auth';
import { getBorgaState, setBorgaState } from '@/lib/borga/persistence';
import { userWsKey } from '@/lib/borga/keys';
import { assignBarcode, totalOnHand, type InventoryItem, type StockMovement } from '@/lib/borga/inventory';

export const runtime = 'nodejs';

const createItemSchema = z.object({
  name: z.string().trim().min(1).max(140),
  sku: z.string().trim().max(64).default(''),
  type: z.enum(['product', 'service']).default('product'),
  category: z.string().trim().max(80).default('General'),
  unit: z.string().trim().max(32).default('ea'),
  price: z.coerce.number().min(0).max(1_000_000_000).default(0),
  costPrice: z.coerce.number().min(0).max(1_000_000_000).default(0),
  taxRate: z.coerce.number().min(0).max(100).default(0),
  trackStock: z.boolean().default(true),
  reorderPoint: z.coerce.number().min(0).max(1_000_000).default(0),
  reorderQty: z.coerce.number().min(0).max(1_000_000).default(0),
  active: z.boolean().default(true),
});

export async function GET(req: NextRequest) {
  const g = await guardV1(req);
  if ('res' in g) return g.res;
  const { auth, ws } = g;
  const [items, movements] = await Promise.all([
    getBorgaState<InventoryItem[]>(userWsKey(auth.userId, ws, 'inventoryItems')),
    getBorgaState<StockMovement[]>(userWsKey(auth.userId, ws, 'stockMovements')),
  ]);
  const rows = (items ?? []).slice(0, 100).map((it) => ({
    id: it.id,
    sku: it.sku,
    name: it.name,
    type: it.type,
    category: it.category,
    price: it.price,
    costPrice: it.costPrice,
    onHand: it.trackStock ? totalOnHand(movements ?? [], it.id) : null,
    active: it.active,
  }));
  return NextResponse.json({ ok: true, items: rows });
}

export async function POST(req: NextRequest) {
  const g = await guardV1(req);
  if ('res' in g) return g.res;
  const { auth, ws } = g;
  const parsed = createItemSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid catalog item: name is required.' }, { status: 400 });
  }
  const key = userWsKey(auth.userId, ws, 'inventoryItems');
  const items = (await getBorgaState<InventoryItem[]>(key)) ?? [];
  const d = parsed.data;
  const item: InventoryItem = {
    id: `it-${Date.now().toString(36)}${randomBytes(3).toString('hex')}`,
    sku: d.sku || `SKU-${items.length + 101}`,
    barcode: d.type === 'product' ? assignBarcode(items) : '',
    name: d.name,
    description: '',
    category: d.category,
    unit: d.unit,
    type: d.type,
    price: d.price,
    costPrice: d.costPrice,
    taxRate: d.taxRate,
    trackStock: d.type === 'product' ? d.trackStock : false,
    reorderPoint: d.reorderPoint,
    active: d.active,
    createdAtIso: new Date().toISOString(),
  };
  await setBorgaState(key, [item, ...items]);
  return NextResponse.json(
    {
      ok: true,
      item: {
        id: item.id,
        sku: item.sku,
        name: item.name,
        type: item.type,
        price: item.price,
        costPrice: item.costPrice,
        active: item.active,
      },
    },
    { status: 201 },
  );
}
