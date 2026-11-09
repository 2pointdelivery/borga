import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRICE_CENTS_PER_USER, MAX_SEATS, PAST_DUE_GRACE_DAYS, EMPTY_BILLING, billableSeats, monthlyCents, formatUsd, evaluateAccess, billingModeOf, type BillingRecord, type AccessInput,
} from './borga/billing';
import { formEncode, createStripe, createCheckoutSession, createCustomer, createPortalSession, setSeats, retrieveCheckoutSession, verifyStripeSignature, signForTest, parseEvent, StripeError } from './borga/stripe';
import { applySubscription } from './borga/billing-apply';
import { checkBootEnv } from './borga/boot-checks';

// ── price and users ───────────────────────────────────────────────────────────────────────────────────────────────────

test('the price is $2 per user per month, with the owner as the first user', () => {
  assert.equal(PRICE_CENTS_PER_USER, 200);
  assert.equal(billableSeats([], 'owner@x.com'), 1);
  assert.equal(billableSeats(['a@x.com', 'b@x.com'], 'owner@x.com'), 3);
  assert.equal(billableSeats(['A@X.com', 'a@x.com ', 'owner@x.com', ' OWNER@x.com', ''], 'owner@x.com'), 2, 'the same person is one seat, and the owner is not counted twice');
  assert.equal(billableSeats(Array.from({ length: 900 }, (_, i) => `u${i}@x.com`), 'o@x.com'), MAX_SEATS);
  assert.equal(monthlyCents(1), 200);
  assert.equal(monthlyCents(5), 1000);
  assert.equal(monthlyCents(0), 200, 'never less than one user');
  assert.equal(formatUsd(200), '$2.00');
  assert.equal(formatUsd(123_400), '$1,234.00');
});

test('billing is off unless it is explicitly set to enforce', () => {
  assert.equal(billingModeOf({}), 'off');
  assert.equal(billingModeOf({ BILLING_MODE: 'enforce' }), 'enforce');
  assert.equal(billingModeOf({ BILLING_MODE: ' Enforce ' }), 'enforce');
  assert.equal(billingModeOf({ BILLING_MODE: 'yes' }), 'off', 'anything else is off: a typo must not lock everybody out');
});

// ── who may use a workspace ───────────────────────────────────────────────────────────────────────────────────────────

const base = (over: Partial<AccessInput> = {}): AccessInput => ({
  mode: 'enforce', record: { ...EMPTY_BILLING }, workspaceCreatedIso: '2026-12-10T09:00:00Z', startedOn: '2026-12-01', graceDays: 14, isOperator: false, now: new Date('2026-12-20T12:00:00Z'), ...over,
});
const rec = (over: Partial<BillingRecord>): BillingRecord => ({ ...EMPTY_BILLING, updatedAt: '2026-12-15T00:00:00Z', ...over });

test('with billing off everything is allowed; operators and comped workspaces do not pay', () => {
  assert.deepEqual(evaluateAccess(base({ mode: 'off' })), { access: 'allowed', reason: 'billing-off' });
  assert.equal(evaluateAccess(base({ isOperator: true })).reason, 'operator');
  assert.equal(evaluateAccess(base({ record: rec({ comped: true }) })).reason, 'comped');
  assert.equal(evaluateAccess(base({ isOperator: true, mode: 'off' })).reason, 'billing-off');
});

test('a new workspace that has not paid is blocked: it pays before it is set up', () => {
  const r = evaluateAccess(base());
  assert.deepEqual(r, { access: 'blocked', reason: 'unpaid' });
  assert.equal(evaluateAccess(base({ record: rec({ status: 'incomplete' }) })).access, 'blocked', 'a checkout that was started but not paid');
  assert.equal(evaluateAccess(base({ record: rec({ status: 'unpaid' }) })).access, 'blocked');
  assert.equal(evaluateAccess(base({ record: rec({ status: 'canceled' }) })).reason, 'canceled');
});

test('an active subscription opens it', () => {
  assert.deepEqual(evaluateAccess(base({ record: rec({ status: 'active', seats: 3 }) })), { access: 'allowed', reason: 'paid' });
});

test('a failed payment keeps working for a week, then holds the workspace', () => {
  const since = '2026-12-15T00:00:00Z';
  const during = evaluateAccess(base({ record: rec({ status: 'past_due', pastDueSince: since }) }));
  assert.equal(during.access, 'allowed');
  assert.equal(during.reason, 'past-due');
  assert.equal(during.graceEndsOn, '2026-12-22');
  const after = evaluateAccess(base({ record: rec({ status: 'past_due', pastDueSince: since }), now: new Date(`2026-12-${15 + PAST_DUE_GRACE_DAYS}T00:00:01Z`) }));
  assert.deepEqual(after, { access: 'blocked', reason: 'past-due-expired' });
});

test('a company that existed before billing started gets a grace period to subscribe, then is blocked', () => {
  const early = new Date('2026-12-10T00:00:00Z');
  const old = base({ workspaceCreatedIso: '2026-06-01T00:00:00Z', now: early });
  const inside = evaluateAccess(old);
  assert.equal(inside.access, 'allowed');
  assert.equal(inside.reason, 'legacy-grace');
  assert.equal(inside.graceEndsOn, '2026-12-14', 'billing began on the 1st with 14 days: the last open day is the 14th');
  assert.deepEqual(evaluateAccess({ ...old, now: new Date('2026-12-15T00:00:00Z') }), { access: 'blocked', reason: 'unpaid' });
  assert.equal(evaluateAccess({ ...old, now: new Date('2026-12-13T23:00:00Z') }).access, 'allowed');
  assert.equal(evaluateAccess(base({ workspaceCreatedIso: undefined, now: early })).reason, 'legacy-grace', 'a workspace with no creation timestamp predates billing');
  assert.equal(evaluateAccess(base({ workspaceCreatedIso: 'Oct 2026', now: early })).reason, 'legacy-grace', 'a month label is not a timestamp');
  assert.equal(evaluateAccess(base({ workspaceCreatedIso: '2026-12-01T00:00:00Z', now: early })).reason, 'unpaid', 'created the day billing began: it pays first');
  assert.equal(evaluateAccess(base({ workspaceCreatedIso: '2026-11-30T23:59:59Z', now: early })).reason, 'legacy-grace');
});

// ── Stripe requests ───────────────────────────────────────────────────────────────────────────────────────────────────

interface Req { method: string; url: URL; headers: Record<string, string>; form: URLSearchParams }
function fakeStripe(answer: (r: Req) => { status?: number; json: unknown }) {
  const calls: Req[] = [];
  const f: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const r: Req = { method: String(init?.method ?? 'GET'), url, headers: (init?.headers ?? {}) as Record<string, string>, form: new URLSearchParams(String(init?.body ?? '')) };
    calls.push(r);
    const a = answer(r);
    return new Response(JSON.stringify(a.json), { status: a.status ?? 200 });
  };
  return { stripe: createStripe('sk_test_abcdefghijk', { fetch: f }), calls };
}

test('Stripe\'s form encoding nests objects and arrays, skips empty values and escapes', () => {
  const s = formEncode({ a: 1, b: 'x y&z', c: { d: 'e', f: { g: true } }, h: [{ i: 1 }, { i: 2 }], j: undefined, k: null, l: ['p', 'q'] });
  assert.equal(decodeURIComponent(s.replace(/\+/g, ' ')), 'a=1&b=x y&z&c[d]=e&c[f][g]=true&h[0][i]=1&h[1][i]=2&l[0]=p&l[1]=q');
  assert.equal(s.includes('x%20y%26z'), true);
});

test('checkout: a monthly subscription for the number of users at $2, tagged with the workspace, on a hosted page', async () => {
  const { stripe, calls } = fakeStripe(() => ({ json: { id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' } }));
  const r = await createCheckoutSession(stripe, { customerId: 'cus_9', seats: 3, userId: 'u1', ws: 'ws-a', workspaceName: 'Accra Works', successUrl: 'https://app/s', cancelUrl: 'https://app/c' });
  assert.deepEqual(r, { id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' });
  const c = calls[0];
  assert.equal(c.method, 'POST');
  assert.equal(c.url.pathname, '/v1/checkout/sessions');
  assert.equal(c.headers.Authorization, 'Bearer sk_test_abcdefghijk');
  assert.equal(c.headers['Content-Type'], 'application/x-www-form-urlencoded');
  const f = c.form;
  assert.equal(f.get('mode'), 'subscription');
  assert.equal(f.get('customer'), 'cus_9');
  assert.equal(f.get('line_items[0][quantity]'), '3');
  assert.equal(f.get('line_items[0][price_data][unit_amount]'), '200');
  assert.equal(f.get('line_items[0][price_data][currency]'), 'usd');
  assert.equal(f.get('line_items[0][price_data][recurring][interval]'), 'month');
  assert.match(f.get('line_items[0][price_data][product_data][description]') ?? '', /Accra Works: 3 users/);
  assert.equal(f.get('metadata[borga_user]'), 'u1');
  assert.equal(f.get('metadata[borga_ws]'), 'ws-a');
  assert.equal(f.get('subscription_data[metadata][borga_ws]'), 'ws-a', 'the subscription itself carries the workspace, so later events can be matched');
  assert.equal(f.get('success_url'), 'https://app/s');
  assert.equal(f.get('cancel_url'), 'https://app/c');
  assert.equal(f.get('client_reference_id'), 'u1:ws-a');
  const one = fakeStripe(() => ({ json: { id: 'cs_2', url: 'https://x' } }));
  await createCheckoutSession(one.stripe, { customerId: 'c', seats: 1, userId: 'u', ws: 'w', workspaceName: 'N', successUrl: 'a', cancelUrl: 'b' });
  assert.match(one.calls[0].form.get('line_items[0][price_data][product_data][description]') ?? '', /1 user$/);
});

test('customers, the portal, seat changes and reads use the right calls; Stripe errors surface with their message', async () => {
  const cust = fakeStripe(() => ({ json: { id: 'cus_1' } }));
  assert.equal(await createCustomer(cust.stripe, { email: 'a@b.co', name: 'Acme', userId: 'u1', ws: 'w1' }), 'cus_1');
  assert.equal(cust.calls[0].headers['Idempotency-Key'], 'cus-u1-w1', 'a retry cannot create a second customer');
  assert.equal(cust.calls[0].form.get('metadata[borga_user]'), 'u1');

  const portal = fakeStripe(() => ({ json: { url: 'https://billing.stripe.com/p/x' } }));
  assert.equal(await createPortalSession(portal.stripe, 'cus_1', 'https://app/app'), 'https://billing.stripe.com/p/x');
  assert.equal(portal.calls[0].form.get('return_url'), 'https://app/app');

  const seats = fakeStripe(() => ({ json: {} }));
  await setSeats(seats.stripe, 'si_1', 4);
  assert.equal(seats.calls[0].url.pathname, '/v1/subscription_items/si_1');
  assert.equal(seats.calls[0].form.get('quantity'), '4');
  assert.equal(seats.calls[0].form.get('proration_behavior'), 'create_prorations');

  const get = fakeStripe(() => ({ json: { id: 'cs_1' } }));
  await retrieveCheckoutSession(get.stripe, 'cs_1');
  assert.equal(get.calls[0].method, 'GET');
  assert.equal(get.calls[0].url.searchParams.get('expand[0]'), 'subscription');

  const bad = fakeStripe(() => ({ status: 402, json: { error: { type: 'card_error', message: 'Your card was declined.', code: 'card_declined' } } }));
  await assert.rejects(createPortalSession(bad.stripe, 'c', 'u'), (e: unknown) => e instanceof StripeError && e.status === 402 && e.code === 'card_declined' && /declined/.test(e.message));
  const nourl = fakeStripe(() => ({ json: { id: 'cs' } }));
  await assert.rejects(createCheckoutSession(nourl.stripe, { customerId: 'c', seats: 1, userId: 'u', ws: 'w', workspaceName: 'N', successUrl: 'a', cancelUrl: 'b' }), /checkout address/);
});

// ── webhooks ──────────────────────────────────────────────────────────────────────────────────────────────────────────

test('a webhook is accepted only with a fresh, correct signature over the exact body', () => {
  const secret = 'whsec_testtesttesttesttest';
  const body = JSON.stringify({ id: 'evt_1', type: 'invoice.paid', data: { object: {} } });
  const now = 1_800_000_000;
  const good = signForTest(body, secret, now);
  assert.equal(verifyStripeSignature(body, good, secret, now), true);
  assert.equal(verifyStripeSignature(body + ' ', good, secret, now), false, 'a changed body');
  assert.equal(verifyStripeSignature(body, good, 'whsec_other_other_other_x', now), false, 'a different secret');
  assert.equal(verifyStripeSignature(body, good, secret, now + 301), false, 'too old: a captured request cannot be replayed');
  assert.equal(verifyStripeSignature(body, good, secret, now - 301), false, 'from the future');
  assert.equal(verifyStripeSignature(body, good, secret, now + 299), true, 'inside the tolerance');
  assert.equal(verifyStripeSignature(body, null, secret, now), false);
  assert.equal(verifyStripeSignature(body, '', secret, now), false);
  assert.equal(verifyStripeSignature(body, `t=${now}`, secret, now), false, 'no signature');
  assert.equal(verifyStripeSignature(body, 'v1=abc', secret, now), false, 'no timestamp');
  assert.equal(verifyStripeSignature(body, `t=${now},v1=zz`, secret, now), false, 'not hex');
  assert.equal(verifyStripeSignature(body, `t=${now},v1=${'0'.repeat(64)}`, secret, now), false);
  assert.equal(verifyStripeSignature(body, good, '', now), false, 'no secret configured');
  const rotated = `${good},v1=${'1'.repeat(64)}`;
  assert.equal(verifyStripeSignature(body, rotated, secret, now), true, 'one good signature among several is enough (secret rotation)');
});

test('events are parsed only when they have the shape we use', () => {
  assert.deepEqual(parseEvent('{"id":"e","type":"x","data":{"object":{"a":1}}}')?.data.object, { a: 1 });
  assert.equal(parseEvent('not json'), null);
  assert.equal(parseEvent('{"id":1,"type":"x","data":{}}'), null);
  assert.equal(parseEvent('{"id":"e","type":"x"}'), null);
});

// ── applying what Stripe says ─────────────────────────────────────────────────────────────────────────────────────────

test('a subscription becomes a billing record: status, users, item, period end and customer', () => {
  const sub = { id: 'sub_1', status: 'active', current_period_end: 1_800_000_000, items: { data: [{ id: 'si_1', quantity: 3 }] }, customer: 'cus_1' };
  const r = applySubscription({ ...EMPTY_BILLING, checkoutSessionId: 'cs_1' }, sub);
  assert.deepEqual([r.status, r.subscriptionId, r.subscriptionItemId, r.seats, r.customerId, r.checkoutSessionId], ['active', 'sub_1', 'si_1', 3, 'cus_1', 'cs_1']);
  assert.equal(r.currentPeriodEnd, new Date(1_800_000_000 * 1000).toISOString());
  assert.equal(r.pastDueSince, undefined);
  assert.equal(applySubscription(EMPTY_BILLING, { ...sub, status: 'trialing' }).status, 'active');
  assert.equal(applySubscription(EMPTY_BILLING, { ...sub, status: 'incomplete_expired' }).status, 'canceled');
  assert.equal(applySubscription(EMPTY_BILLING, { ...sub, status: 'paused' }).status, 'unpaid');
  assert.equal(applySubscription(EMPTY_BILLING, { ...sub, status: 'mystery' }).status, 'unpaid', 'an unknown status is not treated as paid');
  assert.equal(applySubscription(EMPTY_BILLING, { id: 's', status: 'active', items: { data: [{ id: 'i', quantity: 2, current_period_end: 1_900_000_000 }] }, customer: { id: 'cus_2' } }).currentPeriodEnd, new Date(1_900_000_000 * 1000).toISOString(), 'newer API versions put the period end on the item');
});

test('the first failed payment starts the grace clock and later ones do not restart it; paying clears it', () => {
  const sub = { id: 'sub_1', status: 'past_due', items: { data: [{ id: 'si_1', quantity: 1 }] } };
  const first = applySubscription({ ...EMPTY_BILLING, status: 'active' }, sub, new Date('2026-12-15T10:00:00Z'));
  assert.equal(first.pastDueSince, '2026-12-15T10:00:00.000Z');
  const again = applySubscription(first, sub, new Date('2026-12-18T10:00:00Z'));
  assert.equal(again.pastDueSince, '2026-12-15T10:00:00.000Z');
  assert.equal(applySubscription(again, { ...sub, status: 'active' }).pastDueSince, undefined);
  assert.equal(applySubscription({ ...EMPTY_BILLING, seats: 5 }, { id: 's', status: 'active' }).seats, 5, 'no item in the event: the known user count stays');
});

// ── startup checks ────────────────────────────────────────────────────────────────────────────────────────────────────

const GOOD: Record<string, string> = {
  DATABASE_URL: 'mysql://u:p@h/db', SESSION_SECRET: 'a'.repeat(31) + 'b' + 'c1d2e3f4', BORGA_SECRET_KEY: '0123456789abcdef'.repeat(4).replace(/^0/, '9'), BORGA_OPERATOR_EMAILS: 'ops@acme.co',
  CRON_SECRET: 'cron-secret-with-enough-length-1234', SMTP_HOST: 'smtp.acme.co', APP_URL: 'https://app.acme.co',
};
test('billing and Salt Edge settings are validated at startup', () => {
  assert.deepEqual(checkBootEnv(GOOD).errors, [], 'the baseline is valid');
  const on = (extra: Record<string, string>) => checkBootEnv({ ...GOOD, BILLING_MODE: 'enforce', ...extra });
  assert.ok(on({}).errors.some((e) => /needs STRIPE_SECRET_KEY/.test(e)), 'enforcing billing without Stripe would lock everyone out');
  assert.ok(on({ STRIPE_SECRET_KEY: 'sk_live_abcdefghijklmnop' }).errors.some((e) => /STRIPE_WEBHOOK_SECRET/.test(e)));
  assert.ok(on({ STRIPE_SECRET_KEY: 'nonsense', STRIPE_WEBHOOK_SECRET: 'whsec_abcdefghijklmnopqrst' }).errors.some((e) => /does not look like a Stripe secret key/.test(e)));
  assert.ok(on({ STRIPE_SECRET_KEY: 'sk_live_abcdefghijklmnop', STRIPE_WEBHOOK_SECRET: 'nope' }).errors.some((e) => /whsec_/.test(e)));
  const ok = on({ STRIPE_SECRET_KEY: 'sk_live_abcdefghijklmnop', STRIPE_WEBHOOK_SECRET: 'whsec_abcdefghijklmnopqrst', BILLING_STARTS_ON: '2026-12-01' });
  assert.deepEqual(ok.errors, []);
  assert.equal(on({ STRIPE_SECRET_KEY: 'sk_test_abcdefghijklmnop', STRIPE_WEBHOOK_SECRET: 'whsec_abcdefghijklmnopqrst' }).warnings.some((w) => /TEST key/.test(w)), true);
  assert.ok(on({ STRIPE_SECRET_KEY: 'sk_live_abcdefghijklmnop', STRIPE_WEBHOOK_SECRET: 'whsec_abcdefghijklmnopqrst', BILLING_STARTS_ON: 'soon' }).errors.some((e) => /BILLING_STARTS_ON/.test(e)));
  assert.ok(checkBootEnv({ ...GOOD, BILLING_MODE: 'sometimes' }).errors.some((e) => /BILLING_MODE/.test(e)));
  assert.ok(checkBootEnv({ ...GOOD, STRIPE_SECRET_KEY: 'sk_live_abcdefghijklmnop' }).warnings.some((w) => /not charged/.test(w)));

  assert.ok(checkBootEnv({ ...GOOD, SALTEDGE_APP_ID: 'x' }).errors.some((e) => /both be set/.test(e)));
  assert.deepEqual(checkBootEnv({ ...GOOD, SALTEDGE_APP_ID: 'x', SALTEDGE_SECRET: 'y' }).errors, []);
  assert.ok(checkBootEnv({ ...GOOD, SALTEDGE_PRIVATE_KEY: 'not a key' }).errors.some((e) => /PEM/.test(e)));
  assert.deepEqual(checkBootEnv({ ...GOOD, SALTEDGE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----' }).errors, []);
  assert.ok(checkBootEnv({ ...GOOD, SALTEDGE_BASE_URL: 'http://x' }).warnings.some((w) => /ignored in production/.test(w)));
});
