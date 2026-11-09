import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { guardV1 } from '@/lib/borga/api-auth';
import { getBorgaState, setBorgaState } from '@/lib/borga/persistence';
import { userWsKey } from '@/lib/borga/keys';
import type { Project, ProjectStatus } from '@/lib/borga/data';

export const runtime = 'nodejs';

const STATUSES: ProjectStatus[] = ['planning', 'active', 'on-hold', 'completed', 'cancelled'];

const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(140),
  description: z.string().trim().max(1000).default(''),
  status: z.enum(STATUSES as [ProjectStatus, ...ProjectStatus[]]).default('active'),
  budgetAmount: z.coerce.number().min(0).max(1_000_000_000).default(0),
  ownerId: z.string().trim().max(64).default(''),
  customerId: z.string().trim().max(64).optional(),
  startDate: z.string().max(20).optional(),
  targetDate: z.string().max(20).optional(),
});

const summary = (p: Project) => ({
  id: p.id,
  name: p.name,
  description: p.description,
  status: p.status,
  budgetAmount: p.budgetAmount,
  ownerId: p.ownerId ?? '',
  customerId: p.customerId ?? null,
});

export async function GET(req: NextRequest) {
  const g = await guardV1(req);
  if ('res' in g) return g.res;
  const { auth, ws } = g;
  const projects = (await getBorgaState<Project[]>(userWsKey(auth.userId, ws, 'projects'))) ?? [];
  const status = new URL(req.url).searchParams.get('status');
  const rows = (status ? projects.filter((p) => p.status === status) : projects).slice(0, 100).map(summary);
  return NextResponse.json({ ok: true, projects: rows });
}

export async function POST(req: NextRequest) {
  const g = await guardV1(req);
  if ('res' in g) return g.res;
  const { auth, ws } = g;
  const parsed = createProjectSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid project: name is required.' }, { status: 400 });
  }
  const key = userWsKey(auth.userId, ws, 'projects');
  const projects = (await getBorgaState<Project[]>(key)) ?? [];
  const d = parsed.data;
  const today = new Date().toISOString().slice(0, 10);
  const project: Project = {
    id: `proj-${Date.now().toString(36)}${randomBytes(3).toString('hex')}`,
    name: d.name,
    description: d.description,
    status: d.status,
    budgetAmount: d.budgetAmount,
    ownerId: d.ownerId || undefined,
    customerId: d.customerId || undefined,
    startDateIso: d.startDate ?? today,
    targetDateIso: d.targetDate,
    createdAt: today,
  };
  await setBorgaState(key, [project, ...projects]);
  return NextResponse.json({ ok: true, project: summary(project) }, { status: 201 });
}
