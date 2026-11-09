import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { sessionUserId } from '@/lib/borga/features-server';
import { getBorgaState, setBorgaState } from '@/lib/borga/persistence';
import type { FeatureRequest } from '@/lib/borga/data';

export const runtime = 'nodejs';

const storeKey = (userId: string) => `t::${userId}::featurerequests`;

const AREAS = ['Sales', 'Marketing', 'Finance', 'Support Desk', 'Projects', 'AI Platform', 'Integrations', 'Mobile', 'API & Webhooks', 'Other'] as const;

const createSchema = z.object({
  action: z.literal('create'),
  title: z.string().trim().min(4).max(120),
  details: z.string().trim().max(2000).default(''),
  area: z.enum(AREAS).default('Other'),
});

const removeSchema = z.object({
  action: z.literal('remove'),
  id: z.string().max(64),
});

export async function GET(req: NextRequest) {
  const userId = await sessionUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const requests = (await getBorgaState<FeatureRequest[]>(storeKey(userId))) ?? [];
  return NextResponse.json({ ok: true, requests, areas: AREAS });
}

export async function POST(req: NextRequest) {
  const userId = await sessionUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const parsed = z.discriminatedUnion('action', [createSchema, removeSchema]).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'action must be create {title, details?, area?} or remove {id}' }, { status: 400 });

  const key = storeKey(userId);
  const all = (await getBorgaState<FeatureRequest[]>(key)) ?? [];
  const input = parsed.data;
  if (input.action === 'remove') {
    await setBorgaState(key, all.filter((r) => r.id !== input.id));
    return NextResponse.json({ ok: true });
  }
  const record: FeatureRequest = {
    id: `fr-${Date.now().toString(36)}${randomBytes(3).toString('hex')}`,
    title: input.title,
    details: input.details,
    area: input.area,
    status: 'received',
    createdAt: new Date().toISOString(),
  };
  await setBorgaState(key, [record, ...all].slice(0, 200));
  return NextResponse.json({ ok: true, request: record }, { status: 201 });
}
