// A small Stripe REST client and webhook verifier, with no SDK: the few calls the subscription needs, `fetch` injected so they are tested
// against a fake. Card details never touch this app: payment happens on Stripe's own hosted page (Checkout), and the customer
// portal manages cards and cancellation.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { BILLING_CURRENCY, PRICE_CENTS_PER_USER } from './billing';

export const STRIPE_BASE = 'https://api.stripe.com/v1';

export class StripeError extends Error {
  constructor(public status: number, public type: string, message: string, public code?: string) {
    super(message);
    this.name = 'StripeError';
  }
}

/** Stripe's form encoding: nested objects as a[b][c]=v, arrays as a[0][b]=v. Undefined and null are left out. */
export function formEncode(params: Record<string, unknown>): string {
  const parts: string[] = [];
  const add = (key: string, v: unknown) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) v.forEach((x, i) => add(`${key}[${i}]`, x));
    else if (typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) add(`${key}[${k}]`, x);
    else parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  };
  for (const [k, v] of Object.entries(params)) add(k, v);
  return parts.join('&');
}

type Fetch = typeof fetch;

export interface StripeClient {
  request<T = Record<string, any>>(method: 'GET' | 'POST', path: string, params?: Record<string, unknown>, idempotencyKey?: string): Promise<T>;
}

export function createStripe(secretKey: string, opts: { fetch?: Fetch; base?: string; timeoutMs?: number } = {}): StripeClient {
  const f = opts.fetch ?? fetch;
  const base = opts.base ?? STRIPE_BASE;
  return {
    async request<T>(method: 'GET' | 'POST', path: string, params: Record<string, unknown> = {}, idempotencyKey?: string): Promise<T> {
      const body = formEncode(params);
      const url = method === 'GET' && body ? `${base}${path}?${body}` : `${base}${path}`;
      const headers: Record<string, string> = { Authorization: `Bearer ${secretKey}` };
      if (method === 'POST') headers['Content-Type'] = 'application/x-www-form-urlencoded';
      if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
      const res = await f(url, { method, headers, body: method === 'POST' ? body : undefined, signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000) });
      const json = (await res.json().catch(() => ({}))) as Record<string, any>;
      if (!res.ok) {
        const e = (json.error ?? {}) as { type?: string; message?: string; code?: string };
        throw new StripeError(res.status, e.type ?? `http_${res.status}`, e.message ?? `Stripe returned HTTP ${res.status}.`, e.code);
      }
      return json as T;
    },
  };
}

// ── the subscription calls ────────────────────────────────────────────────────────────────────────────────────────────

export async function createCustomer(s: StripeClient, i: { email?: string; name?: string; userId: string; ws: string }): Promise<string> {
  const c = await s.request<{ id: string }>('POST', '/customers', { email: i.email, name: i.name, metadata: { borga_user: i.userId, borga_ws: i.ws } }, `cus-${i.userId}-${i.ws}`);
  return c.id;
}

export interface CheckoutInput {
  customerId: string;
  seats: number;
  userId: string;
  ws: string;
  workspaceName: string;
  successUrl: string;
  cancelUrl: string;
}

/** A hosted Checkout page for a monthly subscription of `seats` users at the per-user price. */
export async function createCheckoutSession(s: StripeClient, i: CheckoutInput): Promise<{ id: string; url: string }> {
  const metadata = { borga_user: i.userId, borga_ws: i.ws };
  const r = await s.request<{ id: string; url?: string }>('POST', '/checkout/sessions', {
    mode: 'subscription',
    customer: i.customerId,
    client_reference_id: `${i.userId}:${i.ws}`,
    line_items: [{
      quantity: i.seats,
      price_data: {
        currency: BILLING_CURRENCY, unit_amount: PRICE_CENTS_PER_USER, recurring: { interval: 'month' },
        product_data: { name: 'Borga workspace: per user, per month', description: `${i.workspaceName}: ${i.seats} user${i.seats === 1 ? '' : 's'}` },
      },
    }],
    success_url: i.successUrl,
    cancel_url: i.cancelUrl,
    metadata,
    subscription_data: { metadata },
  });
  if (!r.url) throw new StripeError(502, 'api_error', 'Stripe did not return a checkout address.');
  return { id: r.id, url: r.url };
}

export interface StripeSubscription {
  id: string;
  status: string;
  current_period_end?: number;
  items?: { data?: Array<{ id: string; quantity?: number; current_period_end?: number }> };
  metadata?: Record<string, string>;
  customer?: string | { id: string };
}

export const retrieveSubscription = (s: StripeClient, id: string) => s.request<StripeSubscription>('GET', `/subscriptions/${encodeURIComponent(id)}`);

export interface StripeCheckoutSession {
  id: string;
  status?: string;
  payment_status?: string;
  subscription?: string | StripeSubscription | null;
  customer?: string | { id: string } | null;
  metadata?: Record<string, string>;
  client_reference_id?: string | null;
}

export const retrieveCheckoutSession = (s: StripeClient, id: string) => s.request<StripeCheckoutSession>('GET', `/checkout/sessions/${encodeURIComponent(id)}`, { expand: ['subscription'] });

export async function setSeats(s: StripeClient, itemId: string, seats: number): Promise<void> {
  await s.request('POST', `/subscription_items/${encodeURIComponent(itemId)}`, { quantity: seats, proration_behavior: 'create_prorations' });
}

export async function createPortalSession(s: StripeClient, customerId: string, returnUrl: string): Promise<string> {
  const r = await s.request<{ url?: string }>('POST', '/billing_portal/sessions', { customer: customerId, return_url: returnUrl });
  if (!r.url) throw new StripeError(502, 'api_error', 'Stripe did not return a portal address.');
  return r.url;
}

// ── webhooks ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, any> };
}

/**
 * Checks a webhook's Stripe-Signature header: `t=<time>,v1=<hex>`, where v1 is HMAC-SHA256 of `<t>.<raw body>` with the endpoint secret.
 * A signature from more than `toleranceSec` ago is refused, so a captured request cannot be replayed later.
 */
export function verifyStripeSignature(rawBody: string, header: string | null, secret: string, nowSec: number, toleranceSec = 300): boolean {
  if (!header || !secret) return false;
  const parts = header.split(',').map((p) => p.trim().split('='));
  const t = parts.find(([k]) => k === 't')?.[1];
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v).filter(Boolean);
  const ts = Number(t);
  if (!t || !Number.isFinite(ts) || sigs.length === 0) return false;
  if (Math.abs(nowSec - ts) > toleranceSec) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest();
  return sigs.some((hex) => {
    const got = Buffer.from(hex, 'hex');
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

export function signForTest(rawBody: string, secret: string, tSec: number): string {
  return `t=${tSec},v1=${createHmac('sha256', secret).update(`${tSec}.${rawBody}`).digest('hex')}`;
}

export function parseEvent(rawBody: string): StripeEvent | null {
  try {
    const e = JSON.parse(rawBody) as StripeEvent;
    return e && typeof e.id === 'string' && typeof e.type === 'string' && e.data && typeof e.data === 'object' ? e : null;
  } catch {
    return null;
  }
}
