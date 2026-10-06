import { NextResponse, type NextRequest } from 'next/server';
import { guardV1 } from '@/lib/borga/api-auth';
import { featureGate } from '@/lib/borga/features-server';
import { createInputSchema, createTicket, listTickets, summarize } from '@/lib/borga/tickets-server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const g = await guardV1(req);
  if ('res' in g) return g.res;
  const { auth, ws } = g;
  const userId = auth.userId;
  const gate = await featureGate('tickets', userId, ws);
  if (gate) return gate;
  const status = new URL(req.url).searchParams.get('status');
  const tickets = await listTickets(userId, ws);
  const rows = (status ? tickets.filter((t) => t.status === status) : tickets).slice(0, 100).map(summarize);
  return NextResponse.json({ ok: true, tickets: rows });
}

export async function POST(req: NextRequest) {
  const g = await guardV1(req);
  if ('res' in g) return g.res;
  const { auth, ws } = g;
  const userId = auth.userId;
  const gate = await featureGate('tickets', userId, ws);
  if (gate) return gate;
  const parsed = createInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Invalid ticket: subject is required.' }, { status: 400 });
  try {
    const ticket = await createTicket(userId, ws, parsed.data, { source: 'api', actor: auth.key ? `API key ${auth.key.name}` : 'API' });
    return NextResponse.json({ ok: true, ticket: summarize(ticket) }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Could not create ticket.' }, { status: 500 });
  }
}
