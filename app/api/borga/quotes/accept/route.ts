import { NextResponse, type NextRequest } from 'next/server';
import { sessionUserId, featureGate } from '@/lib/borga/features-server';
import { getBorgaState, setBorgaState } from '@/lib/borga/persistence';
import { userWsKey, userWorkspacesKey } from '@/lib/borga/keys';
import { acceptQuote, type Quote } from '@/lib/borga/quotes';
import { rateFor, EMPTY_FX, type FxRates } from '@/lib/borga/fx';
import { emitEvent } from '@/lib/borga/emit-event';
import type { Invoice, Project, Workspace } from '@/lib/borga/data';

export const runtime = 'nodejs';

// POST { ws, quoteId, target: 'invoice' | 'project' | 'both' } — sent → converted + writes invoice/project.
export async function POST(req: NextRequest) {
  const userId = await sessionUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { ws?: string; quoteId?: string; target?: 'invoice' | 'project' | 'both' } | null;
  if (!body?.ws || !body?.quoteId) return NextResponse.json({ ok: false, error: 'ws and quoteId required' }, { status: 400 });
  const gate = await featureGate('quotes', userId, body.ws);
  if (gate) return gate;
  const target = body.target ?? 'both';
  const qKey = userWsKey(userId, body.ws, 'quotes');
  const quotes = (await getBorgaState<Quote[]>(qKey)) ?? [];
  const q = quotes.find((x) => x.id === body.quoteId);
  if (!q) return NextResponse.json({ ok: false, error: 'quote not found' }, { status: 404 });
  const invoices = (await getBorgaState<Invoice[]>(userWsKey(userId, body.ws, 'invoices'))) ?? [];
  const projects = (await getBorgaState<Project[]>(userWsKey(userId, body.ws, 'projects'))) ?? [];
  try {
    const projectId = `p-${Date.now().toString(36)}`;
    const invoiceNumber = `INV-${invoices.length + 1}`;
    // Foreign quotes convert at the FX table rate (snapshotted onto the invoice).
    const workspaces = (await getBorgaState<Workspace[]>(userWorkspacesKey(userId))) ?? [];
    const wsCurrency = (workspaces.find((w) => w.id === body.ws)?.currency ?? 'USD').toUpperCase();
    const fx = (await getBorgaState<FxRates>(userWsKey(userId, body.ws, 'fxRates'))) ?? EMPTY_FX;
    const docCcy = (q.currency ?? '').toUpperCase();
    const fxRate = docCcy && docCcy !== wsCurrency ? rateFor(fx, docCcy, wsCurrency) : 1;
    const { quote, invoice, project } = acceptQuote(q, { invoiceNumber, projectId, wsCurrency, fxRate: fxRate ?? undefined });
    await setBorgaState(qKey, quotes.map((x) => (x.id === q.id ? quote : x)));
    let invoiceId: string | undefined; let createdProjectId: string | undefined;
    if (target === 'invoice' || target === 'both') {
      await setBorgaState(userWsKey(userId, body.ws, 'invoices'), [{ ...invoice, id: invoice.id }, ...invoices]);
      invoiceId = invoice.id;
    }
    if (target === 'project' || target === 'both') {
      await setBorgaState(userWsKey(userId, body.ws, 'projects'), [{ ...project, id: projectId }, ...projects]);
      createdProjectId = projectId;
    }
    await emitEvent(userId, body.ws, 'quote.accepted', { quoteId: q.id, invoiceId, projectId: createdProjectId, total: invoice.amount });
    return NextResponse.json({ ok: true, quoteId: q.id, invoiceId, projectId: createdProjectId, total: invoice.amount });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Could not accept quote.' }, { status: 400 });
  }
}
