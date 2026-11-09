import { NextResponse, type NextRequest } from 'next/server';
import { guardV1 } from '@/lib/borga/api-auth';
import { featureGate } from '@/lib/borga/features-server';
import { createInputSchema, createTicket, listTickets, summarize, updateInputSchema, updateTicket } from '@/lib/borga/tickets-server';

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
    // Never leak DB/driver detail to API consumers (vibe-check #15).
    console.error('[v1/tickets] create failed:', e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: 'Could not create ticket.' }, { status: 500 });
  }
}

/**
 * PATCH /api/v1/tickets?ws=… — update status, priority, assignee, labels or
 * project on an existing ticket. Same workflow validation as the dashboard
 * (illegal status moves are refused with the reason), audited with the caller.
 */
export async function PATCH(req: NextRequest) {
  const g = await guardV1(req);
  if ('res' in g) return g.res;
  const { auth, ws } = g;
  const userId = auth.userId;
  const gate = await featureGate('tickets', userId, ws);
  if (gate) return gate;
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!id) return NextResponse.json({ ok: false, error: 'ticket id is required (?id=…).' }, { status: 400 });
  const parsed = updateInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ ok: false, error: 'Provide at least one of status, priority, assignee, labels or projectId.' }, { status: 400 });
  }
  try {
    const actor = auth.key ? `API key ${auth.key.name}` : 'API';
    const r = await updateTicket(userId, ws, id, parsed.data, actor);
    if (r.error) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
    if (!r.ticket) return NextResponse.json({ ok: false, error: 'Ticket not found.' }, { status: 404 });
    return NextResponse.json({ ok: true, ticket: summarize(r.ticket) });
  } catch (e) {
    console.error('[v1/tickets] update failed:', e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: 'Could not update ticket.' }, { status: 500 });
  }
}
