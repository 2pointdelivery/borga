// Per-workspace Stripe merchant (separate account per workspace, per user decision).
// The platform subscription (billing.ts) stays deployment-wide; customer AR uses the workspace's own Stripe secret
// stored in the encrypted Connections store under provider `stripe` (secret key + webhook secret + publishable key).
// Pure helpers + thin REST calls reusing the form-encoding in stripe.ts.
import { formEncode } from './stripe';

export interface MerchantCreds { secretKey: string; webhookSecret?: string; publishableKey?: string; }
export type Fetch = typeof fetch;

async function postForm(f: Fetch, secretKey: string, path: string, params: Record<string, unknown>, idempotencyKey?: string) {
  const headers: Record<string, string> = { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await f(`https://api.stripe.com/v1${path}`, { method: 'POST', headers, body: formEncode(params) });
  const json = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (!res.ok) throw new Error((json.error as { message?: string })?.message ?? `Stripe ${res.status}`);
  return json;
}

/** One-off payment link for an invoice/quote: returns the hosted URL. Amount in major units + ISO currency. */
export async function createInvoicePaymentLink(
  f: Fetch, creds: MerchantCreds,
  i: { invoiceId: string; ws: string; amount: number; currency: string; description: string },
): Promise<{ url: string; sessionId: string }> {
  const cents = Math.round(i.amount * 100);
  const session = await postForm(f, creds.secretKey, '/checkout/sessions', {
    mode: 'payment',
    line_items: [{ quantity: 1, price_data: { currency: i.currency.toLowerCase(), unit_amount: cents, product_data: { name: i.description.slice(0, 80) } } }],
    success_url: `https://app/pay/success?invoice=${encodeURIComponent(i.invoiceId)}`,
    cancel_url: `https://app/pay/cancel?invoice=${encodeURIComponent(i.invoiceId)}`,
    metadata: { borga_ws: i.ws, borga_invoice: i.invoiceId },
    payment_intent_data: { metadata: { borga_ws: i.ws, borga_invoice: i.invoiceId } },
  }, `inv-pay-${i.ws}-${i.invoiceId}`);
  if (!session.url) throw new Error('Stripe did not return a checkout address.');
  return { url: session.url as string, sessionId: session.id as string };
}

export function merchantConfigured(c: Partial<MerchantCreds> | null | undefined): boolean {
  return !!c?.secretKey && c.secretKey.startsWith('sk_');
}
