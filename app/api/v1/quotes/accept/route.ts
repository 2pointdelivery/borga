import { NextResponse, type NextRequest } from 'next/server';
import { guardV1 } from '@/lib/borga/api-auth';
import { featureGate } from '@/lib/borga/features-server';
import { getBorgaState, setBorgaState } from '@/lib/borga/persistence';
import { userWsKey, userWorkspacesKey } from '@/lib/borga/keys';
import { acceptQuote, type Quote } from '@/lib/borga/quotes';
import { rateFor, EMPTY_FX, type FxRates } from '@/lib/borga/fx';
import { emitEvent } from '@/lib/borga/emit-event';
import type { Invoice, Project, Workspace } from '@/lib/borga/data';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const g = await guardV1(req);
  if ('res' in g) return g.res;
  const gate = await featureGate('quotes', g.auth.userId, g.ws);
  if (gate) return gate;
  const body = (await req.json().catch(() => null)) as { quoteId?: string; target?: 'invoice' | 'project' | 'both' } | null;
  if (!body?.quoteId) return NextResponse.json({ ok: false, error: 'quoteId required' }, { status: 400 });
  const target = body.target ?? 'both';
  const qKey = userWsKey(g.auth.userId, g.ws, 'quotes');
  const quotes = (await getBorgaState<Quote[]>(qKey)) ?? [];
  const q = quotes.find((x) => x.id === body.quoteId);
  if (!q) return NextResponse.json({ ok: false, error: 'quote not found' }, { status: 404 });
  const invoices = (await getBorgaState<Invoice[]>(userWsKey(g.auth.userId, g.ws, 'invoices'))) ?? [];
  const projects = (await getBorgaState<Project[]>(userWsKey(g.auth.userId, g.ws, 'projects'))) ?? [];
  try {
    const projectId = `p-${Date.now().toString(36)}`;
    const workspaces = (await getBorgaState<Workspace[]>(userWorkspacesKey(g.auth.userId))) ?? [];
    const wsCurrency = (workspaces.find((w) => w.id === g.ws)?.currency ?? 'USD').toUpperCase();
    const fx = (await getBorgaState<FxRates>(userWsKey(g.auth.userId, g.ws, 'fxRates'))) ?? EMPTY_FX;
    const docCcy = (q.currency ?? '').toUpperCase();
    const fxRate = docCcy && docCcy !== wsCurrency ? rateFor(fx, docCcy, wsCurrency) : 1;
    const { quote, invoice, project } = acceptQuote(q, { invoiceNumber: `INV-${invoices.length + 1}`, projectId, wsCurrency, fxRate: fxRate ?? undefined });
    await setBorgaState(qKey, quotes.map((x) => (x.id === q.id ? quote : x)));
    if (target === 'invoice' || target === 'both') await setBorgaState(userWsKey(g.auth.userId, g.ws, 'invoices'), [invoice as unknown as Invoice, ...invoices]);
    if (target === 'project' || target === 'both') await setBorgaState(userWsKey(g.auth.userId, g.ws, 'projects'), [{ ...project } as unknown as Project, ...projects]);
    await emitEvent(g.auth.userId, g.ws, 'quote.accepted', { quoteId: q.id, total: invoice.amount });
    return NextResponse.json({ ok: true, quoteId: q.id, invoiceId: invoice.id, projectId, total: invoice.amount }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Could not accept quote.' }, { status: 400 });
  }
}
