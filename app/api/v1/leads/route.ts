import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { guardV1 } from '@/lib/borga/api-auth';
import { getBorgaState, setBorgaState } from '@/lib/borga/persistence';
import { userWsKey } from '@/lib/borga/keys';
import type { Lead, LeadStage, Priority } from '@/lib/borga/data';

export const runtime = 'nodejs';

const LEAD_STAGES: LeadStage[] = ['new', 'qualified', 'proposal', 'won', 'lost'];
const LEAD_PRIORITIES: Priority[] = ['P0', 'P1', 'P2', 'P3'];

const createLeadSchema = z.object({
  name: z.string().trim().min(1).max(120),
  company: z.string().trim().max(120).default(''),
  email: z.string().trim().max(254).default(''),
  phone: z.string().trim().max(40).default(''),
  value: z.coerce.number().min(0).max(1_000_000_000).default(0),
  stage: z.enum(LEAD_STAGES as [LeadStage, ...LeadStage[]]).default('new'),
  source: z.string().trim().max(80).default('API'),
  ownerId: z.string().max(64).default(''),
  priority: z.enum(LEAD_PRIORITIES as [Priority, ...Priority[]]).default('P2'),
});

const summary = (l: Lead) => ({
  id: l.id, name: l.name, company: l.company, email: l.email, phone: l.phone,
  value: l.value, stage: l.stage, source: l.source, priority: l.priority,
});

export async function GET(req: NextRequest) {
  const g = await guardV1(req);
  if ('res' in g) return g.res;
  const { auth, ws } = g;
  const userId = auth.userId;
  const leads = (await getBorgaState<Lead[]>(userWsKey(userId, ws, 'leads'))) ?? [];
  return NextResponse.json({ ok: true, leads: leads.slice(0, 100).map(summary) });
}

export async function POST(req: NextRequest) {
  const g = await guardV1(req);
  if ('res' in g) return g.res;
  const { auth, ws } = g;
  const userId = auth.userId;
  const parsed = createLeadSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid lead: name is required.' }, { status: 400 });
  const key = userWsKey(userId, ws, 'leads');
  const leads = (await getBorgaState<Lead[]>(key)) ?? [];
  const lead: Lead = {
    id: `l-${Date.now().toString(36)}${randomBytes(3).toString('hex')}`,
    ...parsed.data,
  };
  await setBorgaState(key, [lead, ...leads]);
  return NextResponse.json({ ok: true, lead: summary(lead) }, { status: 201 });
}
