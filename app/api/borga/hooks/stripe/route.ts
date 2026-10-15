import { NextResponse, type NextRequest } from 'next/server';
import { verifyStripeSignature, parseEvent } from '@/lib/borga/stripe';
import { getConnection } from '@/lib/borga/connections-server';
import { getBorgaState, setBorgaState } from '@/lib/borga/persistence';
import { userWsKey } from '@/lib/borga/keys';
import { listBorgaKeys } from '@/lib/borga/persistence';
import { postInvoicePayment } from '@/lib/borga/postings';
import type { Invoice, JournalEntry } from '@/lib/borga/data';

export const runtime = 'nodejs';

// Per-workspace merchant webhook: secret comes from the workspace's own Stripe connection.
// Security posture (vibe-check #13):
// - every failure path answers the same 401 shape (no 404-vs-401 oracle about who connected Stripe)
// - the signature is verified before any state change; nothing is trusted from metadata alone
// - the paid amount is compared to the invoice total (an underpaid session never marks paid)
// - refunds reopen the invoice; failures leave it untouched (still `sent`)

const deny = () => NextResponse.json({ ok: false, error: 'invalid webhook' }, { status: 401 });

function eventAmountCents(obj: Record<string, any>): number | null {
  const v = obj.amount_total ?? obj.amount_received ?? obj.amount;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const sig = req.headers.get('stripe-signature');
  const ev = parseEvent(raw);
  if (!ev) return deny();
  const meta = (ev.data.object as Record<string, any>).metadata ?? {};
  const ws = meta.borga_ws as string | undefined;
  const invoiceId = meta.borga_invoice as string | undefined;
  // No Borga metadata: not our event (e.g. a provider test ping) — acknowledge, change nothing.
  if (!ws || !invoiceId) return NextResponse.json({ ok: true, skipped: true });
  // Locate owning user by scanning stripe connection keys for this ws (keys are c::<u>::<ws>::stripe).
  // From here on every failure is the same 401 so callers can't probe who connected what.
  const keys = await listBorgaKeys('c::').catch(() => [] as string[]);
  const ownerKey = keys.find((k) => k.endsWith(`::${ws}::stripe`));
  const userId = ownerKey?.split('::')[1];
  const creds = userId ? await getConnection(userId, ws, 'stripe').catch(() => null) : null;
  const now = Math.floor(Date.now() / 1000);
  if (!userId || !verifyStripeSignature(raw, sig, creds?.webhookSecret ?? '', now)) {
    return deny();
  }
  const invKey = userWsKey(userId, ws, 'invoices');
  const invoices = (await getBorgaState<Invoice[]>(invKey)) ?? [];
  const inv = invoices.find((i) => i.id === invoiceId);
  if (!inv) return deny();

  if (ev.type === 'checkout.session.completed' || ev.type === 'payment_intent.succeeded') {
    const paidCents = eventAmountCents(ev.data.object as Record<string, any>);
    const needCents = Math.round(((inv as { amount?: number }).amount ?? 0) * 100);
    if (paidCents === null || paidCents < needCents) {
      console.error(`[stripe-hook] underpaid session for invoice ${invoiceId} (${paidCents} < ${needCents})`);
      return deny();
    }
    const next = invoices.map((i) => (i.id === invoiceId ? { ...i, status: 'paid' as const, paidAt: new Date().toISOString(), paidMethod: 'stripe' as const } : i));
    await setBorgaState(invKey, next);
    const jKey = userWsKey(userId, ws, 'journals');
    const journals = (await getBorgaState<JournalEntry[]>(jKey)) ?? [];
    if (!journals.some((j) => j.externalRef === `invoice:${invoiceId}:paid`)) {
      await setBorgaState(jKey, [postInvoicePayment({
        invoiceId, amount: (inv as { amount?: number }).amount ?? 0,
        cashAccountId: 'cash', arAccountId: 'ar',
      }), ...journals]);
    }
  } else if (ev.type === 'charge.refunded' || ev.type === 'charge.dispute.created') {
    // Money went back: reopen the invoice instead of leaving it paid.
    await setBorgaState(invKey, invoices.map((i) => (i.id === invoiceId ? { ...i, status: 'sent' as const } : i)));
  }
  // Anything else (payment_failed, etc.): acknowledged, invoice untouched.
  return NextResponse.json({ ok: true });
}
