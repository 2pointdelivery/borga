import { NextResponse, type NextRequest } from 'next/server';
import { applyStripeEvent } from '@/lib/borga/billing-server';
import { parseEvent, verifyStripeSignature } from '@/lib/borga/stripe';

export const runtime = 'nodejs';

const MAX_BODY = 1_000_000;

/**
 * Stripe's webhook. It carries no session, so it is authenticated by the signature over the raw body with STRIPE_WEBHOOK_SECRET
 * (and refused when it is more than five minutes old). A bad signature is a 400; a failure while applying a good event is a 500, so
 * Stripe retries it.
 */
export async function POST(req: NextRequest) {
  const secret = (process.env.STRIPE_WEBHOOK_SECRET ?? '').trim();
  if (!secret) return NextResponse.json({ ok: false, error: 'Billing webhook is not configured.' }, { status: 503 });
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY) return NextResponse.json({ ok: false, error: 'Too large.' }, { status: 413 });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ ok: false, error: 'Too large.' }, { status: 413 });
  if (!verifyStripeSignature(raw, req.headers.get('stripe-signature'), secret, Math.floor(Date.now() / 1000))) {
    return NextResponse.json({ ok: false, error: 'Bad signature.' }, { status: 400 });
  }
  const event = parseEvent(raw);
  if (!event) return NextResponse.json({ ok: false, error: 'Bad event.' }, { status: 400 });
  try {
    const out = await applyStripeEvent(event);
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    console.error('Stripe webhook failed:', event.type, (e as Error).message);
    return NextResponse.json({ ok: false, error: 'Could not apply the event.' }, { status: 500 });
  }
}
