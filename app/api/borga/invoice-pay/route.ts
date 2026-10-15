import { NextResponse, type NextRequest } from 'next/server';
import { sessionUserId } from '@/lib/borga/features-server';
import { getConnection } from '@/lib/borga/connections-server';
import { createInvoicePaymentLink } from '@/lib/borga/stripe-merchant';
import { getBorgaState } from '@/lib/borga/persistence';
import { userWsKey } from '@/lib/borga/keys';
import type { Invoice } from '@/lib/borga/data';

export const runtime = 'nodejs';

// POST { ws, invoiceId } → hosted Stripe Checkout URL using THIS workspace's merchant key.
export async function POST(req: NextRequest) {
  const userId = await sessionUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { ws?: string; invoiceId?: string } | null;
  if (!body?.ws || !body?.invoiceId) return NextResponse.json({ ok: false, error: 'ws and invoiceId required' }, { status: 400 });
  const creds = await getConnection(userId, body.ws, 'stripe');
  if (!creds?.secretKey) return NextResponse.json({ ok: false, error: 'Connect Stripe for this workspace first (Integrations → Connections).' }, { status: 400 });
  const invoices = (await getBorgaState<Invoice[]>(userWsKey(userId, body.ws, 'invoices'))) ?? [];
  const inv = invoices.find((i) => i.id === body.invoiceId);
  if (!inv) return NextResponse.json({ ok: false, error: 'invoice not found' }, { status: 404 });
  try {
    const link = await createInvoicePaymentLink(fetch, { secretKey: creds.secretKey }, {
      invoiceId: inv.id, ws: body.ws, amount: inv.amount, currency: 'USD', description: `Invoice ${inv.number} — ${inv.client}`,
    });
    return NextResponse.json({ ok: true, ...link });
  } catch (e) {
    // Upstream reason codes stay server-side (vibe-check #15).
    console.error('[invoice-pay] Stripe failed:', e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: 'Could not create the Stripe checkout. Check the workspace Stripe key and try again.' }, { status: 502 });
  }
}
