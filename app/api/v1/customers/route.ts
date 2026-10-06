import { NextResponse, type NextRequest } from 'next/server';
import { guardV1 } from '@/lib/borga/api-auth';
import { getBorgaState } from '@/lib/borga/persistence';
import { userWsKey } from '@/lib/borga/keys';
import type { Customer } from '@/lib/borga/data';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const g = await guardV1(req);
  if ('res' in g) return g.res;
  const { auth, ws } = g;
  const userId = auth.userId;
  const customers = (await getBorgaState<Customer[]>(userWsKey(userId, ws, 'customers'))) ?? [];
  return NextResponse.json({
    ok: true,
    customers: customers.slice(0, 100).map((c) => ({
      id: c.id, name: c.name, industry: c.industry, email: c.email, phone: c.phone,
      city: c.city, country: c.country, status: c.status, owner: c.owner,
    })),
  });
}
