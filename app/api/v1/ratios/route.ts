import { NextResponse, type NextRequest } from 'next/server';
import { guardV1 } from '@/lib/borga/api-auth';
import { getBorgaState } from '@/lib/borga/persistence';
import { userWsKey } from '@/lib/borga/keys';
import { computeRatios } from '@/lib/borga/ratios';
import type { GlAccount, JournalEntry } from '@/lib/borga/data';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const g = await guardV1(req);
  if ('res' in g) return g.res;
  const coa = (await getBorgaState<GlAccount[]>(userWsKey(g.auth.userId, g.ws, 'coa'))) ?? [];
  const journals = (await getBorgaState<JournalEntry[]>(userWsKey(g.auth.userId, g.ws, 'journals'))) ?? [];
  return NextResponse.json({ ok: true, ratios: computeRatios(coa, journals) });
}
