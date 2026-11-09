import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { guardV1 } from '@/lib/borga/api-auth';
import { getBorgaState, setBorgaState } from '@/lib/borga/persistence';
import { userWsKey } from '@/lib/borga/keys';
import type { Invoice } from '@/lib/borga/data';
import { documentTotals } from '@/lib/borga/pricing';

export const runtime = 'nodejs';

const invoiceLineSchema = z.object({
  description: z.string().trim().min(1).max(200),
  qty: z.coerce.number().positive().max(1_000_000),
  unitPrice: z.coerce.number().min(0).max(1_000_000_000),
});

const createInvoiceSchema = z.object({
  client: z.string().trim().min(1).max(140),
  customerId: z.string().trim().max(64).optional(),
  amount: z.coerce.number().min(0).max(1_000_000_000).optional(),
  due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(['draft', 'sent', 'paid', 'overdue']).default('draft'),
  currency: z.string().trim().max(8).optional(),
  lines: z.array(invoiceLineSchema).max(50).optional(),
});

const summary = (i: Invoice) => ({
  id: i.id,
  number: i.number,
  client: i.client,
  amount: i.amount,
  status: i.status,
  issued: i.issued,
  due: i.due,
});

export async function GET(req: NextRequest) {
  const g = await guardV1(req);
  if ('res' in g) return g.res;
  const { auth, ws } = g;
  const userId = auth.userId;
  const invoices = (await getBorgaState<Invoice[]>(userWsKey(userId, ws, 'invoices'))) ?? [];
  const status = new URL(req.url).searchParams.get('status');
  const rows = (status ? invoices.filter((i) => i.status === status) : invoices)
    .filter((i) => !i.voidedAt)
    .slice(0, 100)
    .map(summary);
  return NextResponse.json({ ok: true, invoices: rows });
}

export async function POST(req: NextRequest) {
  const g = await guardV1(req);
  if ('res' in g) return g.res;
  const { auth, ws } = g;
  const parsed = createInvoiceSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid invoice: client is required.' }, { status: 400 });
  }
  const key = userWsKey(auth.userId, ws, 'invoices');
  const invoices = (await getBorgaState<Invoice[]>(key)) ?? [];
  const d = parsed.data;
  // With lines, the server's own arithmetic decides the amount; a caller-sent
  // `amount` is only used for a hand-entered invoice that has no lines at all.
  const totalAmount = d.lines?.length
    ? documentTotals(d.lines, { currency: d.currency }).total
    : Math.round(Math.max(0, d.amount ?? 0) * 100) / 100;
  if (totalAmount <= 0) {
    return NextResponse.json({ ok: false, error: 'Invoice amount or positive line items are required.' }, { status: 400 });
  }
  const today = new Date().toISOString().slice(0, 10);
  const defaultDue = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const inv: Invoice = {
    id: `inv-${Date.now().toString(36)}${randomBytes(3).toString('hex')}`,
    number: `INV-${1000 + invoices.length + 1}`,
    client: d.client,
    customerId: d.customerId,
    amount: totalAmount,
    status: d.status,
    issued: today,
    due: d.due ?? defaultDue,
    currency: d.currency,
    lines: d.lines?.map((l, idx) => ({
      id: `il-${Date.now().toString(36)}-${idx}`,
      description: l.description,
      qty: l.qty,
      unitPrice: l.unitPrice,
    })),
  };
  await setBorgaState(key, [inv, ...invoices]);
  return NextResponse.json({ ok: true, invoice: summary(inv) }, { status: 201 });
}
