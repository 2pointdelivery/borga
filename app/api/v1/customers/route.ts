import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { guardV1 } from '@/lib/borga/api-auth';
import { getBorgaState, setBorgaState } from '@/lib/borga/persistence';
import { userWsKey } from '@/lib/borga/keys';
import type { Customer, CustomerStatus } from '@/lib/borga/data';

export const runtime = 'nodejs';

const STATUSES: CustomerStatus[] = ['prospect', 'active', 'churned'];

const createCustomerSchema = z.object({
  name: z.string().trim().min(1).max(140),
  industry: z.string().trim().max(100).default('General'),
  website: z.string().trim().max(200).default(''),
  email: z.string().trim().max(254).default(''),
  phone: z.string().trim().max(40).default(''),
  addressLine: z.string().trim().max(200).default(''),
  city: z.string().trim().max(100).default(''),
  state: z.string().trim().max(100).default(''),
  country: z.string().trim().max(100).default('United States'),
  status: z.enum(STATUSES as [CustomerStatus, ...CustomerStatus[]]).default('active'),
  owner: z.string().trim().max(80).default('Atlas'),
  notes: z.string().trim().max(2000).default(''),
});

const summary = (c: Customer) => ({
  id: c.id,
  name: c.name,
  industry: c.industry,
  email: c.email,
  phone: c.phone,
  city: c.city,
  country: c.country,
  status: c.status,
  owner: c.owner,
});

export async function GET(req: NextRequest) {
  const g = await guardV1(req);
  if ('res' in g) return g.res;
  const { auth, ws } = g;
  const userId = auth.userId;
  const customers = (await getBorgaState<Customer[]>(userWsKey(userId, ws, 'customers'))) ?? [];
  return NextResponse.json({
    ok: true,
    customers: customers.slice(0, 100).map(summary),
  });
}

export async function POST(req: NextRequest) {
  const g = await guardV1(req);
  if ('res' in g) return g.res;
  const { auth, ws } = g;
  const parsed = createCustomerSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid customer: name is required.' }, { status: 400 });
  }
  const key = userWsKey(auth.userId, ws, 'customers');
  const customers = (await getBorgaState<Customer[]>(key)) ?? [];
  const customer: Customer = {
    id: `c-${Date.now().toString(36)}${randomBytes(3).toString('hex')}`,
    createdAt: new Date().toISOString().slice(0, 10),
    ...parsed.data,
  };
  await setBorgaState(key, [customer, ...customers]);
  return NextResponse.json({ ok: true, customer: summary(customer) }, { status: 201 });
}
