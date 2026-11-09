import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { guardV1 } from '@/lib/borga/api-auth';
import { getBorgaState, setBorgaState } from '@/lib/borga/persistence';
import { userWsKey } from '@/lib/borga/keys';
import type { KnowledgeCategoryId, KnowledgeEntry } from '@/lib/borga/data';

export const runtime = 'nodejs';

const CATEGORIES: KnowledgeCategoryId[] = ['company', 'services', 'customers', 'funding', 'content', 'process'];

const createKnowledgeSchema = z.object({
  category: z.enum(CATEGORIES as [KnowledgeCategoryId, ...KnowledgeCategoryId[]]).default('company'),
  title: z.string().trim().min(1).max(200),
  answer: z.string().trim().min(1).max(5000),
  source: z.string().trim().max(120).default('API'),
});

export async function GET(req: NextRequest) {
  const g = await guardV1(req);
  if ('res' in g) return g.res;
  const entries = (await getBorgaState<KnowledgeEntry[]>(userWsKey(g.auth.userId, g.ws, 'knowledge'))) ?? [];
  const category = new URL(req.url).searchParams.get('category');
  const rows = (category ? entries.filter((e) => e.category === category) : entries)
    .slice(0, 100)
    .map((e) => ({
      id: e.id,
      category: e.category,
      title: e.title,
      answer: e.answer,
      source: e.source,
      updatedAt: e.updatedAt,
    }));
  return NextResponse.json({ ok: true, knowledge: rows });
}

export async function POST(req: NextRequest) {
  const g = await guardV1(req);
  if ('res' in g) return g.res;
  const parsed = createKnowledgeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid knowledge entry: title and answer are required.' }, { status: 400 });
  }
  const key = userWsKey(g.auth.userId, g.ws, 'knowledge');
  const entries = (await getBorgaState<KnowledgeEntry[]>(key)) ?? [];
  const d = parsed.data;
  const entry: KnowledgeEntry = {
    id: `kb-${Date.now().toString(36)}${randomBytes(3).toString('hex')}`,
    category: d.category,
    title: d.title,
    answer: d.answer,
    source: d.source,
    updatedAt: new Date().toISOString().slice(0, 10),
  };
  await setBorgaState(key, [entry, ...entries]);
  return NextResponse.json({ ok: true, entry }, { status: 201 });
}
