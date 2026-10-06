import { NextResponse, type NextRequest } from 'next/server';
import { guardV1 } from '@/lib/borga/api-auth';
import { getBorgaState } from '@/lib/borga/persistence';
import { userWsKey } from '@/lib/borga/keys';
import type { Invoice } from '@/lib/borga/data';

export const runtime = 'nodejs';

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
    .map((i) => ({
      id: i.id, number: i.number, client: i.client, amount: i.amount,
      status: i.status, issued: i.issued, due: i.due,
    }));
  return NextResponse.json({ ok: true, invoices: rows });
}
