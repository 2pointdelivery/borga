import { NextResponse, type NextRequest } from 'next/server';
import { guardV1 } from '@/lib/borga/api-auth';
import { featureGate } from '@/lib/borga/features-server';
import { getBorgaState, setBorgaState } from '@/lib/borga/persistence';
import { userWsKey } from '@/lib/borga/keys';
import { quoteTotal, type Quote } from '@/lib/borga/quotes';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const g = await guardV1(req);
  if ('res' in g) return g.res;
  const gate = await featureGate('quotes', g.auth.userId, g.ws);
  if (gate) return gate;
  const quotes = (await getBorgaState<Quote[]>(userWsKey(g.auth.userId, g.ws, 'quotes'))) ?? [];
  const status = new URL(req.url).searchParams.get('status');
  return NextResponse.json({
    ok: true,
    quotes: (status ? quotes.filter((q) => q.status === status) : quotes).slice(0, 100).map((q) => ({
      id: q.id, customer: q.customerName, amount: quoteTotal(q), status: q.status, validUntil: q.validUntil,
    })),
  });
}

export async function POST(req: NextRequest) {
  const g = await guardV1(req);
  if ('res' in g) return g.res;
  const gate = await featureGate('quotes', g.auth.userId, g.ws);
  if (gate) return gate;
  const body = (await req.json().catch(() => null)) as { customerId?: string; lines?: Quote['lines']; validUntil?: string } | null;
  if (!body?.customerId || !Array.isArray(body.lines) || body.lines.length === 0) {
    return NextResponse.json({ ok: false, error: 'customerId and lines are required.' }, { status: 400 });
  }
  const quotes = (await getBorgaState<Quote[]>(userWsKey(g.auth.userId, g.ws, 'quotes'))) ?? [];
  const q: Quote = {
    id: `q-${Date.now().toString(36)}`, number: `Q-${quotes.length + 1}`, customerId: body.customerId,
    customerName: body.customerId, lines: body.lines, status: 'draft', version: 1,
    issued: new Date().toISOString().slice(0, 10), validUntil: body.validUntil ?? new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
  };
  await setBorgaState(userWsKey(g.auth.userId, g.ws, 'quotes'), [q, ...quotes]);
  return NextResponse.json({ ok: true, quote: { id: q.id, total: quoteTotal(q) } }, { status: 201 });
}
