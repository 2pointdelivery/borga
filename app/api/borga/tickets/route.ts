import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { featureGate, sessionUserId } from '@/lib/borga/features-server';
import { isValidWsId } from '@/lib/borga/keys';
import { TICKET_STATUSES, type TicketStatus } from '@/lib/borga/tickets';
import {
  addComment,
  createInputSchema,
  createTicket,
  getTicket,
  listTickets,
  loadSettings,
  pollMailbox,
  saveSettings,
  settingsPatchSchema,
  summarize,
  sweepSla,
  toPublicSettings,
  updateInputSchema,
  updateTicket,
} from '@/lib/borga/tickets-server';

export const runtime = 'nodejs';

// Sweeping writes only on first-time threshold crossings, but avoid doing the
// scan on every poll of the dashboard.
const lastSweep = new Map<string, number>();
const SWEEP_EVERY_MS = 30_000;

const actorSchema = z.string().trim().max(80).default('Agent');

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), ticket: createInputSchema, actor: actorSchema }),
  z.object({ action: z.literal('update'), id: z.string().max(40), patch: updateInputSchema, actor: actorSchema }),
  z.object({
    action: z.literal('comment'),
    id: z.string().max(40),
    kind: z.enum(['public', 'internal']),
    body: z.string().max(20_000),
    setStatus: z.enum(TICKET_STATUSES as [TicketStatus, ...TicketStatus[]]).optional(),
    actor: actorSchema,
  }),
  z.object({
    action: z.literal('saveSettings'),
    settings: settingsPatchSchema,
    imapPassword: z.string().max(512).optional(),
    regenerateToken: z.boolean().optional(),
  }),
  z.object({ action: z.literal('pollMailbox') }),
  z.object({ action: z.literal('similar'), id: z.string().max(40) }),
  z.object({ action: z.literal('sweep') }),
]);

function inboundUrl(req: NextRequest, userId: string, ws: string): string {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? new URL(req.url).host;
  const proto = req.headers.get('x-forwarded-proto') ?? new URL(req.url).protocol.replace(':', '');
  return `${proto}://${host}/api/borga/tickets/inbound?u=${userId}&ws=${ws}`;
}

async function guard(req: NextRequest, ws: string | null) {
  const userId = await sessionUserId(req);
  if (!userId) return { res: NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 }) } as const;
  if (!isValidWsId(ws)) return { res: NextResponse.json({ ok: false, error: 'ws required' }, { status: 400 }) } as const;
  const gate = await featureGate('tickets', userId, ws);
  if (gate) return { res: gate } as const;
  return { userId, ws } as const;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const g = await guard(req, url.searchParams.get('ws'));
  if ('res' in g) return g.res;
  const { userId, ws } = g;

  const id = url.searchParams.get('id');
  if (id) {
    const ticket = await getTicket(userId, ws, id);
    return ticket ? NextResponse.json({ ok: true, ticket }) : NextResponse.json({ ok: false, error: 'Ticket not found' }, { status: 404 });
  }

  const sweepKey = `${userId}:${ws}`;
  if (Date.now() - (lastSweep.get(sweepKey) ?? 0) > SWEEP_EVERY_MS) {
    lastSweep.set(sweepKey, Date.now());
    await sweepSla(userId, ws).catch((e) => console.error('[tickets] sweep failed', e));
  }
  const [tickets, settings] = await Promise.all([listTickets(userId, ws), loadSettings(userId, ws)]);
  return NextResponse.json({ ok: true, tickets: tickets.slice(0, 1000).map(summarize), settings: { ...toPublicSettings(settings), inboundUrl: inboundUrl(req, userId, ws) }, serverTime: new Date().toISOString() });
}

export async function POST(req: NextRequest) {
  const ws = new URL(req.url).searchParams.get('ws');
  const g = await guard(req, ws);
  if ('res' in g) return g.res;
  const { userId } = g;

  let parsed;
  try {
    parsed = bodySchema.safeParse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid request', issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`) }, { status: 400 });
  }
  const b = parsed.data;

  try {
    switch (b.action) {
      case 'create':
        return NextResponse.json({ ok: true, ticket: await createTicket(userId, g.ws, b.ticket, { source: 'web', actor: b.actor }) });
      case 'update': {
        const r = await updateTicket(userId, g.ws, b.id, b.patch, b.actor);
        return r.error ? NextResponse.json({ ok: false, error: r.error }, { status: r.error === 'Ticket not found' ? 404 : 409 }) : NextResponse.json({ ok: true, ticket: r.ticket });
      }
      case 'comment': {
        const r = await addComment(userId, g.ws, b.id, { kind: b.kind, body: b.body, author: b.actor, setStatus: b.setStatus });
        return r.error ? NextResponse.json({ ok: false, error: r.error }, { status: r.error === 'Ticket not found' ? 404 : 409 }) : NextResponse.json({ ok: true, ticket: r.ticket });
      }
      case 'saveSettings':
        return NextResponse.json({ ok: true, settings: { ...(await saveSettings(userId, g.ws, b.settings, { imapPassword: b.imapPassword, regenerateToken: b.regenerateToken })), inboundUrl: inboundUrl(req, userId, g.ws) } });
      case 'similar': {
        const t = await getTicket(userId, g.ws, b.id);
        if (!t) return NextResponse.json({ ok: false, error: 'Ticket not found' }, { status: 404 });
        const { findSimilarTickets } = await import('@/lib/borga/supermemory-sync');
        const similar = await findSimilarTickets(userId, g.ws, t.subject + '\n' + t.description, t.id, 3);
        return NextResponse.json({ ok: true, enabled: similar !== null, similar: similar ?? [] });
      }
      case 'pollMailbox':
        return NextResponse.json(await pollMailbox(userId, g.ws));
      case 'sweep':
        return NextResponse.json({ ok: true, ...(await sweepSla(userId, g.ws)) });
    }
  } catch (e) {
    console.error('[tickets] action failed', e);
    return NextResponse.json({ ok: false, error: 'Request failed' }, { status: 500 });
  }
}
